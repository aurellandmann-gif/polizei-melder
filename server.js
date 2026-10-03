// Keine Abhängigkeiten nötig. Benötigt Node >= 22.5 (eingebautes SQLite).
// Admin-Konto: Umgebungsvariablen ADMIN_USER und ADMIN_PASS setzen.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const db = new DatabaseSync(process.env.DB_PATH || './reports.db');
db.exec(`
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL NOT NULL, lng REAL NOT NULL, loc TEXT, cat TEXT NOT NULL, note TEXT, t INTEGER NOT NULL, still INTEGER DEFAULT 0, gone INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT DEFAULT 'user', trust INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS votes(user_id INTEGER, report_id INTEGER, kind TEXT, PRIMARY KEY(user_id, report_id));`);
for (const c of ['dir INTEGER', 'dest TEXT', 'fake INTEGER DEFAULT 0', 'user_id INTEGER'])
  try { db.exec('ALTER TABLE reports ADD COLUMN ' + c); } catch {}

const hashPw = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  const salt = crypto.randomBytes(16).toString('hex'), hash = hashPw(process.env.ADMIN_PASS, salt);
  const ex = db.prepare('SELECT id FROM users WHERE name=?').get(process.env.ADMIN_USER);
  if (ex) db.prepare("UPDATE users SET salt=?,hash=?,role='admin' WHERE id=?").run(salt, hash, ex.id);
  else db.prepare("INSERT INTO users(name,salt,hash,role,trust,created) VALUES(?,?,?,'admin',100,?)").run(process.env.ADMIN_USER, salt, hash, Date.now());
}

const STATIC = { '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'], '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'] };
const CATS = ['Geschwindigkeitskontrolle (Radar/Laser)', 'Verkehrskontrolle / Anhaltung',
  'Unfallaufnahme', 'Straßensperre / Umleitung', 'Streife unterwegs',
  'Stau / Rückstau', 'Wildwechsel / Gefahr', 'Baustelle', 'Sonstiges'];
const TTL = 2 * 3600 * 1000, geoCache = new Map(), hits = new Map();

function limited(key, kind, max) {
  const k = key + kind, now = Date.now();
  const a = (hits.get(k) || []).filter(x => now - x < 600000);
  a.push(now); hits.set(k, a);
  return a.length > max;
}
setInterval(() => {
  db.prepare('DELETE FROM reports WHERE t < ?').run(Date.now() - 24 * 3600 * 1000);
  db.prepare('DELETE FROM sessions WHERE created < ?').run(Date.now() - 30 * 864e5);
  hits.clear();
}, 600000);

const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const readBody = req => new Promise(r => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 4000) req.destroy(); });
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r(null); } });
});
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]));
const getUser = req => {
  const t = cookie(req).sid; if (!t) return null;
  return db.prepare('SELECT u.id,u.name,u.role,u.trust FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.created>?').get(t, Date.now() - 30 * 864e5) || null;
};
const sessionCookie = (req, uid) => {
  const tok = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tok, uid, Date.now());
  return { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` };
};
const pub = u => ({ name: u.name, role: u.role, trust: u.trust });
const wOf = u => u && u.role === 'admin' ? 3 : u && u.trust >= 20 ? 2 : 1;
// Meldung verschwindet, wenn Gegenstimmen (Weg + Falsch) mindestens doppelt so viele sind wie Bestätigungen (Melder + Noch da).
const stateOf = (r, a) => { const pos = wOf(a) + (r.still || 0), neg = (r.gone || 0) + (r.fake || 0); return { hidden: neg >= 2 * pos, conf: pos / (pos + neg + 1) }; };
const addTrust = (uid, d) => { if (uid) db.prepare('UPDATE users SET trust = MAX(-50, MIN(500, trust + ?)) WHERE id=?').run(d, uid); };

http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'GET' && req.headers['x-req'] !== '1') return send(res, 403, { error: 'Nicht erlaubt' });
    const user = getUser(req);

    if (req.method === 'GET' && p === '/api/me') return send(res, 200, user ? pub(user) : {});

    if (req.method === 'POST' && (p === '/api/register' || p === '/api/login')) {
      if (limited(ip, p, p === '/api/login' ? 10 : 5)) return send(res, 429, { error: 'Zu viele Versuche, bitte später erneut.' });
      const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
      const name = String(d.name || '').trim(), pass = String(d.pass || '');
      if (p === '/api/register') {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return send(res, 400, { error: 'Name: 3–20 Zeichen (Buchstaben, Zahlen, _)' });
        if (pass.length < 8 || pass.length > 100) return send(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
        if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) return send(res, 409, { error: 'Name ist schon vergeben' });
        const salt = crypto.randomBytes(16).toString('hex');
        const r = db.prepare("INSERT INTO users(name,salt,hash,created) VALUES(?,?,?,?)").run(name, salt, hashPw(pass, salt), Date.now());
        return send(res, 201, { name, role: 'user', trust: 0 }, sessionCookie(req, Number(r.lastInsertRowid)));
      }
      const u = db.prepare('SELECT * FROM users WHERE name=?').get(name);
      const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(pass, u.salt)), Buffer.from(u.hash));
      if (!ok) return send(res, 401, { error: 'Name oder Passwort falsch' });
      return send(res, 200, pub(u), sessionCookie(req, u.id));
    }

    if (req.method === 'POST' && p === '/api/logout') {
      const t = cookie(req).sid; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (req.method === 'GET' && p === '/api/reports') {
      const rows = db.prepare(`SELECT r.*, u.name AS author, u.trust AS atrust, u.role AS arole FROM reports r LEFT JOIN users u ON u.id=r.user_id
        WHERE r.t > ? ORDER BY r.t DESC LIMIT 300`).all(Date.now() - TTL);
      const out = [];
      for (const { user_id, ...r } of rows) { const st = stateOf(r, { trust: r.atrust, role: r.arole }); if (!st.hidden) out.push({ ...r, conf: st.conf }); }
      return send(res, 200, out);
    }

    if (req.method === 'POST' && p === '/api/reports') {
      if (!user) return send(res, 401, { error: 'Bitte zuerst anmelden' });
      if (user.trust <= -10) return send(res, 403, { error: 'Dein Konto ist gesperrt' });
      if (limited('u' + user.id, 'post', user.trust >= 20 ? 15 : 5)) return send(res, 429, { error: 'Zu viele Meldungen, bitte später erneut.' });
      const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
      const lat = +d.lat, lng = +d.lng;
      if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || !CATS.includes(d.cat)) return send(res, 400, { error: 'Ungültige Daten' });
      const dir = Number.isInteger(d.dir) && d.dir >= -1 && d.dir < 360 ? d.dir : null;
      db.prepare('INSERT INTO reports(lat,lng,loc,cat,note,t,dir,dest,user_id) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(lat, lng, clean(d.loc, 100), d.cat, clean(d.note, 200), Date.now(), dir, clean(d.dest, 40), user.id);
      return send(res, 201, { ok: true });
    }

    let m = p.match(/^\/api\/reports\/(\d+)\/(still|gone|fake)$/);
    if (req.method === 'POST' && m) {
      if (!user) return send(res, 401, { error: 'Bitte zuerst anmelden' });
      if (limited('u' + user.id, 'vote', 60)) return send(res, 429, { error: 'Zu viele Aktionen' });
      const r = db.prepare('SELECT * FROM reports WHERE id=?').get(+m[1]);
      if (!r) return send(res, 404, { error: 'Meldung nicht gefunden' });
      if (r.user_id === user.id) return send(res, 403, { error: 'Eigene Meldungen kannst du nicht bewerten' });
      try { db.prepare('INSERT INTO votes VALUES(?,?,?)').run(user.id, r.id, m[2]); }
      catch { return send(res, 409, { error: 'Du hast schon abgestimmt' }); }
      const au = db.prepare('SELECT trust, role FROM users WHERE id=?').get(r.user_id);
      const before = stateOf(r, au), w = wOf(user);
      db.prepare(`UPDATE reports SET ${m[2]} = ${m[2]} + ? WHERE id=?`).run(w, r.id);
      if (m[2] === 'still') addTrust(r.user_id, 1);
      if (m[2] === 'fake') addTrust(r.user_id, -2);
      const r2 = db.prepare('SELECT * FROM reports WHERE id=?').get(r.id);
      if (!before.hidden && stateOf(r2, au).hidden && r2.fake > 0) addTrust(r.user_id, -3);
      return send(res, 200, { ok: true });
    }

    m = p.match(/^\/api\/reports\/(\d+)$/);
    if (req.method === 'DELETE' && m) {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Nur für Admins' });
      const r = db.prepare('SELECT user_id FROM reports WHERE id=?').get(+m[1]);
      if (r && url.searchParams.get('fake') === '1') addTrust(r.user_id, -5);
      db.prepare('DELETE FROM reports WHERE id=?').run(+m[1]);
      db.prepare('DELETE FROM votes WHERE report_id=?').run(+m[1]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/geocode') {
      const q = clean(url.searchParams.get('q'), 120);
      if (!q) return send(res, 400, { error: 'Leer' });
      if (limited(ip, 'geo', 20)) return send(res, 429, { error: 'Zu viele Suchen' });
      if (geoCache.has(q.toLowerCase())) return send(res, 200, geoCache.get(q.toLowerCase()));
      const api = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&viewbox=12.6,48.1,13.7,47.3&q=' + encodeURIComponent(q);
      return fetch(api, { headers: { 'User-Agent': 'polizei-melder/1.0', 'Accept-Language': 'de' }, signal: AbortSignal.timeout(6000) })
        .then(r => r.json()).then(a => {
          const out = a[0] ? { lat: +a[0].lat, lng: +a[0].lon, name: String(a[0].display_name).split(',').slice(0, 3).join(',') } : { notFound: true };
          if (geoCache.size > 500) geoCache.clear();
          geoCache.set(q.toLowerCase(), out); send(res, 200, out);
        }).catch(() => send(res, 502, { error: 'Suche nicht erreichbar' }));
    }

    const file = p === '/' || p === '/index.html' ? ['index.html', 'text/html; charset=utf-8'] : STATIC[p];
    if (req.method === 'GET' && file) {
      return fs.readFile(path.join(__dirname, 'public', file[0]), (e, buf) => {
        if (e) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': file[0] === 'index.html' ? 'no-cache' : 'public, max-age=3600' });
        res.end(buf);
      });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Serverfehler' }); }
}).listen(PORT, () => console.log('Läuft auf Port ' + PORT));
