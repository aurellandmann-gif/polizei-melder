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

db.exec(`CREATE TABLE IF NOT EXISTS bans(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, value TEXT NOT NULL, reason TEXT, label TEXT, created INTEGER, until INTEGER);
CREATE TABLE IF NOT EXISTS mod_log(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, user_id INTEGER, name TEXT, action TEXT, detail TEXT);`);
for (const c of ['last_seen INTEGER', 'last_ip TEXT', 'last_dev TEXT', 'banned INTEGER DEFAULT 0', 'ban_until INTEGER', 'ban_reason TEXT'])
  try { db.exec('ALTER TABLE users ADD COLUMN ' + c); } catch {}
for (const c of ['flag INTEGER DEFAULT 0', 'reason TEXT'])
  try { db.exec('ALTER TABLE reports ADD COLUMN ' + c); } catch {}

let webpush = null; try { webpush = require('web-push'); } catch {}
db.exec('CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT); CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, user_id INTEGER, sub TEXT, lat REAL, lng REAL, radius INTEGER, created INTEGER);');
let vapid = null;
if (webpush) {
  try {
    const get = k => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v;
    let pub = process.env.VAPID_PUBLIC || get('vp'), priv = process.env.VAPID_PRIVATE || get('vs');
    if (!pub || !priv) { const g = webpush.generateVAPIDKeys(); pub = g.publicKey; priv = g.privateKey;
      db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('vp', pub); db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('vs', priv); }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || ('mailto:' + (process.env.CONTACT_EMAIL || 'kontakt@example.com')), pub, priv); vapid = pub;
  } catch (e) { console.error('Push deaktiviert:', e.message); }
}
const distKm = (a, b, c, d) => { const r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const EMO = { 'Geschwindigkeitskontrolle (Radar/Laser)': '📸', 'Verkehrskontrolle / Anhaltung': '🛑', 'Unfallaufnahme': '💥', 'Straßensperre / Umleitung': '🚧', 'Streife unterwegs': '🚓', 'Stau / Rückstau': '🚗', 'Wildwechsel / Gefahr': '🦌', 'Baustelle': '👷', 'Sonstiges': 'ℹ️' };
function notify(r, author) {
  if (!vapid || author.trust <= -5) return;
  for (const s of db.prepare('SELECT * FROM push_subs WHERE user_id IS NOT ?').all(author.id)) {
    const d = distKm(s.lat, s.lng, r.lat, r.lng); if (d > s.radius) continue;
    const body = [r.loc, r.dest ? 'Richtung ' + r.dest : '', d.toFixed(1).replace('.', ',') + ' km von deinem Gebiet'].filter(Boolean).join(' · ');
    webpush.sendNotification(JSON.parse(s.sub), JSON.stringify({ title: (EMO[r.cat] || '') + ' ' + r.cat, body, url: '/' }), { TTL: 3600, urgency: 'high' })
      .catch(e => { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint); });
  }
}
const hashPw = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  const salt = crypto.randomBytes(16).toString('hex'), hash = hashPw(process.env.ADMIN_PASS, salt);
  const ex = db.prepare('SELECT id FROM users WHERE name=?').get(process.env.ADMIN_USER);
  if (ex) db.prepare("UPDATE users SET salt=?,hash=?,role='admin' WHERE id=?").run(salt, hash, ex.id);
  else db.prepare("INSERT INTO users(name,salt,hash,role,trust,created) VALUES(?,?,?,'admin',100,?)").run(process.env.ADMIN_USER, salt, hash, Date.now());
}

const STATIC = { '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'], '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png'], '/impressum': ['impressum.html', 'text/html; charset=utf-8'], '/datenschutz': ['datenschutz.html', 'text/html; charset=utf-8'] };
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
const presence = new Map(), ipDevs = new Map();
setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM reports WHERE t < ?').run(now - 24 * 3600 * 1000);
  db.prepare('DELETE FROM sessions WHERE created < ?').run(now - 30 * 864e5);
  db.prepare('DELETE FROM mod_log WHERE t < ?').run(now - 14 * 864e5);
  db.prepare('DELETE FROM bans WHERE until IS NOT NULL AND until < ?').run(now);
  db.prepare('UPDATE users SET banned=0 WHERE banned=1 AND ban_until IS NOT NULL AND ban_until < ?').run(now);
  for (const [k, v] of presence) if (now - v.t > 4 * 3600e3) presence.delete(k);
  hits.clear(); ipDevs.clear();
}, 600000);

const getIp = req => String(req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 64);
const getDev = req => { const d = String(req.headers['x-dev'] || ''); return /^[a-f0-9]{16,40}$/.test(d) ? d : ''; };
const modlog = (u, action, detail) => db.prepare('INSERT INTO mod_log(t,user_id,name,action,detail) VALUES(?,?,?,?,?)').run(Date.now(), u ? u.id : null, u ? u.name : null, action, String(detail).slice(0, 300));

// ---- Präsenz (wer war wann online) ----
function touch(req, user) {
  const dev = getDev(req), ip = getIp(req); if (!dev) return;
  let set = ipDevs.get(ip); if (!set) { set = new Set(); ipDevs.set(ip, set); }
  if (!set.has(dev)) { if (set.size >= 6) return; set.add(dev); }
  const now = Date.now(); presence.set(dev, { t: now, uid: user ? user.id : null });
  if (user) {
    const u = db.prepare('SELECT last_seen FROM users WHERE id=?').get(user.id);
    if (u && (!u.last_seen || now - u.last_seen > 30000)) db.prepare('UPDATE users SET last_seen=?,last_ip=?,last_dev=? WHERE id=?').run(now, ip, dev, user.id);
  }
}
function stats() {
  const now = Date.now(); let n = 0, h1 = 0, h3 = 0;
  for (const v of presence.values()) { const a = now - v.t; if (a <= 180000) n++; if (a <= 3600e3) h1++; if (a <= 10800e3) h3++; }
  return { now: n, h1, h3 };
}
function banInfo(ip, dev, user) {
  if (user && user.banned) return user.ban_reason || 'Konto gesperrt';
  const b = db.prepare("SELECT reason FROM bans WHERE ((kind='ip' AND value=?) OR (kind='device' AND ?<>'' AND value=?)) AND (until IS NULL OR until>?) LIMIT 1").get(ip, dev, dev, Date.now());
  return b ? (b.reason || 'Zugang gesperrt') : null;
}

// ---- Plausibilitäts- und Spam-Prüfung ----
const SEVERE = ['arschloch', 'wichser', 'wixer', 'hurensohn', 'hure', 'fotze', 'schlampe', 'missgeburt', 'spast', 'spasti', 'mongo', 'vollidiot', 'nazi', 'kanake', 'neger', 'schwuchtel', 'nutte', 'ficken', 'fick', 'verpiss', 'huso', 'bastard', 'dreckssau', 'hitler', 'fuck', 'fucker', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'whore', 'retard'];
const MILD = ['scheisse', 'scheiss', 'kacke', 'idiot', 'trottel', 'depp', 'deppert', 'vollpfosten', 'arsch', 'damn'];
const PROMO = ['whatsapp', 'telegram', 'instagram', 'snapchat', 'tiktok', 'bitcoin', 'krypto', 'crypto', 'casino', 'gewinnspiel', 'gratis', 'follower', 'verdienen', 'investier'];
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|io|ly|me|xyz|info|shop|top|cc|tk)\b|\bt\.me\b|@[a-z0-9_]{3,}|\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b)/i;
const PHONE_RE = /(\+|00)?\d[\d\s\/().-]{8,}\d/;
const normTxt = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[5$]/g, 's').replace(/[^a-z\s]/g, ' ').replace(/(.)\1{2,}/g, '$1$1');
const hit = (t, list) => list.some(w => t === w || (w.length >= 6 && t.includes(w)));

function assess(user, d, lat, lng, gps) {
  const R = { risk: 0, reasons: [], reject: null, strike: false };
  const add = (n, why) => { R.risk += n; R.reasons.push(why); };
  const text = [d.loc, d.note, d.dest].join(' '), toks = normTxt(text).split(/\s+/).filter(Boolean);
  // 1) Inhalt
  if (toks.some(t => hit(t, SEVERE))) { R.reject = 'Bitte keine Beleidigungen oder unangemessenen Inhalte.'; R.strike = true; add(100, 'Beleidigung'); }
  const mild = toks.filter(t => hit(t, MILD)).length; if (mild) add(Math.min(70, mild * 35), 'Schimpfwort');
  if (URL_RE.test(text) || PHONE_RE.test(text) || toks.some(t => PROMO.some(w => t.includes(w)))) { R.reject = R.reject || 'Links, Telefonnummern und Werbung sind nicht erlaubt.'; R.strike = true; add(100, 'Spam/Link'); }
  const letters = text.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
  if (letters.length >= 10 && letters.replace(/[^A-ZÄÖÜ]/g, '').length / letters.length > 0.7) add(20, 'Nur Großbuchstaben');
  if (/(.)\1{4,}/.test(text)) add(30, 'Zeichen-Wiederholung');
  if (text.split(/\s+/).some(w => w.length > 25)) add(30, 'Unsinniger Text');
  // 2) Entfernung zum echten Standort des Melders
  const big = user.trust >= 20 ? 2 : 1, gl = gps ? +gps.lat : NaN, gn = gps ? +gps.lng : NaN;
  if (gl >= -90 && gl <= 90 && gn >= -180 && gn <= 180) {
    const gd = distKm(gl, gn, lat, lng);
    if (gd > 50 * big) { R.reject = R.reject || `Zu weit weg: Die Meldung ist ${Math.round(gd)} km von deinem Standort entfernt. Melden geht nur im Umkreis von ca. ${50 * big} km.`; add(100, `${Math.round(gd)} km entfernt`); }
    else if (gd > 20 * big) add(30, `${Math.round(gd)} km entfernt`);
  } else add(user.trust >= 5 ? 5 : 20, 'Kein Standort');
  // 3) Tempo und Wiederholungen
  const now = Date.now(), recent = db.prepare('SELECT t,lat,lng,note FROM reports WHERE user_id=? AND t>? ORDER BY t DESC LIMIT 10').all(user.id, now - 3600e3);
  if (recent[0] && now - recent[0].t < 45000) add(30, 'Zu schnell nacheinander');
  if (recent.filter(r => now - r.t < 300000).length >= 3) add(30, '3+ Meldungen in 5 Min.');
  if (recent[0]) { const dk = distKm(recent[0].lat, recent[0].lng, lat, lng), hrs = Math.max((now - recent[0].t) / 3600e3, 1 / 120); if (dk > 5 && dk / hrs > 200) add(60, 'Unmögliche Strecke'); }
  if (d.note && recent.some(r => r.note && r.note === d.note)) add(40, 'Gleicher Text wiederholt');
  // 4) Vertrauen
  if (now - (user.created || 0) < 600000) add(10, 'Neues Konto');
  if (user.trust <= -5) add(40, 'Niedriges Vertrauen'); else if (user.trust < 0) add(20, 'Negatives Vertrauen');
  if (user.trust >= 20) R.risk -= 30; else if (user.trust >= 5) R.risk -= 10;
  R.risk = Math.max(0, R.risk);
  return R;
}


const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const readBody = req => new Promise(r => {
  let b = ''; req.on('data', c => { b += c; if (b.length > 4000) req.destroy(); });
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r(null); } });
});
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a[0]));
const getUser = req => {
  const t = cookie(req).sid; if (!t) return null;
  const row = db.prepare('SELECT u.id,u.name,u.role,u.trust,u.created,u.banned,u.ban_until,u.ban_reason FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.created>?').get(t, Date.now() - 30 * 864e5);
  if (!row) return null;
  row.banned = !!row.banned && (!row.ban_until || row.ban_until > Date.now());
  return row;
};
const sessionCookie = (req, uid) => {
  const tok = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tok, uid, Date.now());
  return { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` };
};
const pub = u => ({ name: u.name, role: u.role, trust: u.trust, banned: !!u.banned && (!u.ban_until || u.ban_until > Date.now()) });
const wOf = u => u && u.role === 'admin' ? 3 : u && u.trust >= 20 ? 2 : 1;
// Meldung verschwindet, wenn Gegenstimmen (Weg + Falsch) mindestens doppelt so viele sind wie Bestätigungen (Melder + Noch da).
const stateOf = (r, a) => { const pos = (r.flag ? 0.5 : wOf(a)) + (r.still || 0), neg = (r.gone || 0) + (r.fake || 0); return { hidden: neg >= 2 * pos, conf: pos / (pos + neg + 1) }; };
const addTrust = (uid, d) => { if (uid) db.prepare('UPDATE users SET trust = MAX(-50, MIN(500, trust + ?)) WHERE id=?').run(d, uid); };

http.createServer(async (req, res) => {
  const ip = getIp(req), dev = getDev(req);
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'GET' && req.headers['x-req'] !== '1') return send(res, 403, { error: 'Nicht erlaubt' });
    const user = getUser(req);
    if (req.method !== 'GET' && p !== '/api/logout' && !(req.method === 'DELETE' && p === '/api/me') && !(user && user.role === 'admin')) {
      const bi = banInfo(ip, dev, user);
      if (bi !== null) return send(res, 403, { error: 'Dein Zugang wurde gesperrt. Grund: ' + bi, banned: true });
    }

    if (req.method === 'GET' && p === '/api/push/key') return send(res, 200, vapid ? { key: vapid } : {});
    if (req.method === 'POST' && p === '/api/push/subscribe') {
      if (!user) return send(res, 401, { error: 'Bitte zuerst anmelden' });
      if (!vapid) return send(res, 503, { error: 'Push ist auf dem Server nicht aktiv' });
      if (limited('u' + user.id, 'push', 30)) return send(res, 429, { error: 'Zu viele Aktionen' });
      const d = await readBody(req), sub = d && d.sub, lat = +(d && d.lat), lng = +(d && d.lng), radius = Math.max(1, Math.min(100, +(d && d.radius) || 15));
      if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys || !(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return send(res, 400, { error: 'Ungültige Daten' });
      db.prepare('INSERT OR REPLACE INTO push_subs VALUES(?,?,?,?,?,?,?)').run(sub.endpoint, user.id, JSON.stringify(sub), lat, lng, radius, Date.now());
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/push/unsubscribe') {
      if (!user) return send(res, 401, { error: 'Bitte zuerst anmelden' });
      const d = await readBody(req); if (d && d.endpoint) db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(String(d.endpoint), user.id);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && p === '/api/config') return send(res, 200, { mapKey: process.env.MAP_KEY || null });
    if (req.method === 'GET' && p === '/api/me') { touch(req, user); return send(res, 200, user ? pub(user) : {}); }
    if (req.method === 'GET' && p === '/api/stats') { touch(req, user); return send(res, 200, stats()); }

    if (req.method === 'DELETE' && p === '/api/me') {
      if (!user) return send(res, 401, { error: 'Nicht angemeldet' });
      if (user.role === 'admin') return send(res, 403, { error: 'Admin-Konten werden in Render verwaltet' });
      for (const q of ['DELETE FROM reports WHERE user_id=?', 'DELETE FROM votes WHERE user_id=?', 'DELETE FROM sessions WHERE user_id=?', 'DELETE FROM push_subs WHERE user_id=?', 'DELETE FROM users WHERE id=?']) db.prepare(q).run(user.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (req.method === 'POST' && (p === '/api/register' || p === '/api/login')) {
      if (limited(ip, p, p === '/api/login' ? 10 : 5)) return send(res, 429, { error: 'Zu viele Versuche, bitte später erneut.' });
      const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
      const name = String(d.name || '').trim(), pass = String(d.pass || '');
      if (p === '/api/register') {
        if (d.consent !== true) return send(res, 400, { error: 'Bitte bestätige Datenschutz und Mindestalter' });
        if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return send(res, 400, { error: 'Name: 3–20 Zeichen (Buchstaben, Zahlen, _)' });
        if (pass.length < 8 || pass.length > 100) return send(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
        if (db.prepare('SELECT 1 FROM users WHERE name=?').get(name)) return send(res, 409, { error: 'Name ist schon vergeben' });
        if (dev && db.prepare('SELECT COUNT(*) c FROM users WHERE last_dev=? AND created>?').get(dev, Date.now() - 864e5).c >= 2) return send(res, 429, { error: 'Von diesem Gerät wurden heute schon Konten erstellt.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const r = db.prepare("INSERT INTO users(name,salt,hash,created,last_ip,last_dev,last_seen) VALUES(?,?,?,?,?,?,?)").run(name, salt, hashPw(pass, salt), Date.now(), ip, dev, Date.now());
        return send(res, 201, { name, role: 'user', trust: 0 }, sessionCookie(req, Number(r.lastInsertRowid)));
      }
      const u = db.prepare('SELECT * FROM users WHERE name=?').get(name);
      const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(pass, u.salt)), Buffer.from(u.hash));
      if (!ok) return send(res, 401, { error: 'Name oder Passwort falsch' });
      db.prepare('UPDATE users SET last_ip=?,last_dev=?,last_seen=? WHERE id=?').run(ip, dev, Date.now(), u.id);
      return send(res, 200, pub(u), sessionCookie(req, u.id));
    }

    if (req.method === 'POST' && p === '/api/logout') {
      const t = cookie(req).sid; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
    }

    if (req.method === 'GET' && p === '/api/leaderboard') {
      // Bestenliste: Nutzer mit den meisten Punkten (ohne Admins und gesperrte Konten)
      const now = Date.now(), W = "role<>'admin' AND trust>0 AND (banned IS NOT 1 OR (ban_until IS NOT NULL AND ban_until<?))";
      const top = db.prepare(`SELECT name, trust FROM users WHERE ${W} ORDER BY trust DESC, created ASC LIMIT 20`).all(now);
      let mine = null;
      if (user && user.role !== 'admin' && !user.banned && user.trust > 0)
        mine = { name: user.name, trust: user.trust, rank: db.prepare(`SELECT COUNT(*) c FROM users WHERE ${W} AND trust>?`).get(now, user.trust).c + 1 };
      return send(res, 200, { top, me: mine });
    }

    if (req.method === 'GET' && p === '/api/reports') {
      touch(req, user);
      const rows = db.prepare(`SELECT r.*, u.name AS author, u.trust AS atrust, u.role AS arole FROM reports r LEFT JOIN users u ON u.id=r.user_id
        WHERE r.t > ? ORDER BY r.t DESC LIMIT 300`).all(Date.now() - TTL);
      const out = [];
      for (const { user_id, reason, ...r } of rows) { const st = stateOf(r, { trust: r.atrust, role: r.arole }); if (!st.hidden) out.push({ ...r, conf: st.conf }); }
      return send(res, 200, out);
    }

    if (req.method === 'POST' && p === '/api/reports') {
      if (!user) return send(res, 401, { error: 'Bitte zuerst anmelden' });
      if (user.trust <= -10) return send(res, 403, { error: 'Dein Konto ist wegen vieler abgelehnter Meldungen gesperrt. Schreib uns, wenn das ein Irrtum ist.' });
      if (limited('u' + user.id, 'post', user.trust >= 20 ? 15 : 6)) return send(res, 429, { error: 'Zu viele Meldungen, bitte später erneut.' });
      const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
      const lat = +d.lat, lng = +d.lng;
      if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || !CATS.includes(d.cat)) return send(res, 400, { error: 'Ungültige Daten' });
      const dir = Number.isInteger(d.dir) && d.dir >= -1 && d.dir < 360 ? d.dir : null;
      const loc = clean(d.loc, 100), note = clean(d.note, 200), dest = clean(d.dest, 40);
      let flag = 0, reason = null;
      if (user.role !== 'admin') {
        const a = assess(user, { loc, note, dest }, lat, lng, d.gps);
        if (a.reject) {
          modlog(user, 'reject', a.reasons.join(', ') + ' | ' + [loc, note].join(' / '));
          if (a.strike) addTrust(user.id, -2);
          return send(res, 422, { error: a.reject, rejected: true });
        }
        const now = Date.now();
        const near = db.prepare('SELECT * FROM reports WHERE cat=? AND t>? ORDER BY t DESC LIMIT 50').all(d.cat, now - 20 * 60000).filter(r => distKm(r.lat, r.lng, lat, lng) < 0.3);
        if (near.some(r => r.user_id === user.id)) return send(res, 409, { error: 'Das hast du hier gerade schon gemeldet.' });
        if (near.length && a.risk < 50) {
          const t0 = near[0];
          try { db.prepare('INSERT INTO votes VALUES(?,?,?)').run(user.id, t0.id, 'still'); }
          catch { return send(res, 200, { ok: true, merged: true }); }
          db.prepare('UPDATE reports SET still = still + ? WHERE id=?').run(wOf(user), t0.id);
          addTrust(t0.user_id, 1);
          if (t0.flag && (t0.still || 0) + wOf(user) >= 2) db.prepare('UPDATE reports SET flag=0 WHERE id=?').run(t0.id);
          return send(res, 200, { ok: true, merged: true });
        }
        if (a.risk >= 50) { flag = 1; reason = a.reasons.join(', ').slice(0, 200); modlog(user, 'flag', reason + ' | ' + [loc, note].join(' / ')); }
      }
      db.prepare('INSERT INTO reports(lat,lng,loc,cat,note,t,dir,dest,user_id,flag,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(lat, lng, loc, d.cat, note, Date.now(), dir, dest, user.id, flag, reason);
      if (!flag) { try { notify({ lat, lng, loc, cat: d.cat, dest }, user); } catch (e) { console.error(e.message); } }
      return send(res, 201, { ok: true, flagged: !!flag });
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
      if (r2.flag && r2.still >= 2) db.prepare('UPDATE reports SET flag=0 WHERE id=?').run(r.id);
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

    if (p.startsWith('/api/admin/')) {
      if (!user || user.role !== 'admin') return send(res, 403, { error: 'Nur für Admins' });
      const now = Date.now();
      if (req.method === 'GET' && p === '/api/admin/overview') {
        const c = (q, ...a) => db.prepare(q).get(...a).c;
        return send(res, 200, { ...stats(), users: c('SELECT COUNT(*) c FROM users'), onlineUsers: c('SELECT COUNT(*) c FROM users WHERE last_seen>?', now - 180000),
          guests: [...presence.values()].filter(v => !v.uid && now - v.t <= 180000).length, active: c('SELECT COUNT(*) c FROM reports WHERE t>?', now - TTL),
          flagged: c('SELECT COUNT(*) c FROM reports WHERE flag=1 AND t>?', now - TTL),
          bans: c('SELECT COUNT(*) c FROM bans WHERE until IS NULL OR until>?', now) + c('SELECT COUNT(*) c FROM users WHERE banned=1 AND (ban_until IS NULL OR ban_until>?)', now) });
      }
      if (req.method === 'GET' && p === '/api/admin/users') {
        const q = '%' + clean(url.searchParams.get('q'), 30).replace(/[%_]/g, '') + '%';
        const rows = db.prepare('SELECT u.id,u.name,u.role,u.trust,u.created,u.last_seen,u.last_ip,u.last_dev,u.banned,u.ban_until,u.ban_reason,(SELECT COUNT(*) FROM reports r WHERE r.user_id=u.id) AS reports FROM users u WHERE u.name LIKE ? ORDER BY (u.last_seen IS NULL), u.last_seen DESC LIMIT 300').all(q);
        return send(res, 200, rows.map(x => ({ ...x, online: !!x.last_seen && now - x.last_seen < 180000, banned: !!x.banned && (!x.ban_until || x.ban_until > now), last_dev: x.last_dev ? x.last_dev.slice(0, 8) : '' })));
      }
      let am = p.match(/^\/api\/admin\/users\/(\d+)\/(points|role|unban)$/);
      if (req.method === 'POST' && am) {
        const t = db.prepare('SELECT id,name,role,trust FROM users WHERE id=?').get(+am[1]); if (!t) return send(res, 404, { error: 'Nutzer nicht gefunden' });
        const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
        if (am[2] === 'points') {
          const hasSet = d.set !== undefined && d.set !== null && d.set !== '' && Number.isFinite(+d.set);
          const nt = Math.max(-50, Math.min(500, Math.round(hasSet ? +d.set : t.trust + (+d.delta || 0))));
          db.prepare('UPDATE users SET trust=? WHERE id=?').run(nt, t.id);
          modlog(user, 'admin:punkte', `${t.name}: ${t.trust} → ${nt}`);
          return send(res, 200, { trust: nt });
        }
        if (am[2] === 'role') {
          if (t.id === user.id) return send(res, 400, { error: 'Du kannst deine eigene Rolle nicht ändern.' });
          const role = d.role === 'admin' ? 'admin' : 'user';
          db.prepare('UPDATE users SET role=? WHERE id=?').run(role, t.id);
          modlog(user, 'admin:rolle', `${t.name} → ${role}`);
          return send(res, 200, { role });
        }
        db.prepare('UPDATE users SET banned=0, ban_until=NULL, ban_reason=NULL WHERE id=?').run(t.id);
        modlog(user, 'admin:entsperrt', t.name);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/admin/ban') {
        const d = await readBody(req); if (!d) return send(res, 400, { error: 'Ungültig' });
        const t = db.prepare('SELECT * FROM users WHERE id=?').get(+d.userId); if (!t) return send(res, 404, { error: 'Nutzer nicht gefunden' });
        if (t.role === 'admin') return send(res, 403, { error: 'Admins können nicht gesperrt werden.' });
        if (d.ip && (!t.last_ip || t.last_ip === ip)) return send(res, 400, { error: t.last_ip ? 'Das ist deine eigene IP, du würdest dich selbst aussperren.' : 'Für diesen Nutzer ist noch keine IP bekannt.' });
        if (d.device && (!t.last_dev || t.last_dev === dev)) return send(res, 400, { error: t.last_dev ? 'Das ist dein eigenes Gerät.' : 'Für diesen Nutzer ist noch kein Gerät bekannt.' });
        const hours = Math.max(0, Math.min(24 * 365, +d.hours || 0)), until = hours ? now + hours * 3600e3 : null, reason = clean(d.reason, 120), done = [];
        if (d.account !== false) {
          db.prepare('UPDATE users SET banned=1, ban_until=?, ban_reason=? WHERE id=?').run(until, reason || null, t.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.id); db.prepare('DELETE FROM push_subs WHERE user_id=?').run(t.id); done.push('Konto');
        }
        if (d.ip) { db.prepare("INSERT INTO bans(kind,value,reason,label,created,until) VALUES('ip',?,?,?,?,?)").run(t.last_ip, reason, t.name, now, until); done.push('IP'); }
        if (d.device) { db.prepare("INSERT INTO bans(kind,value,reason,label,created,until) VALUES('device',?,?,?,?,?)").run(t.last_dev, reason, t.name, now, until); done.push('Gerät'); }
        if (d.deleteReports) { db.prepare('DELETE FROM reports WHERE user_id=?').run(t.id); done.push('Meldungen gelöscht'); }
        modlog(user, 'admin:sperre', `${t.name}: ${done.join(', ')}${hours ? ' (' + hours + ' Std.)' : ' (dauerhaft)'}${reason ? ' – ' + reason : ''}`);
        return send(res, 200, { ok: true, done });
      }
      if (req.method === 'GET' && p === '/api/admin/bans') {
        const accounts = db.prepare('SELECT id,name,ban_until,ban_reason FROM users WHERE banned=1 AND (ban_until IS NULL OR ban_until>?)').all(now);
        const rules = db.prepare('SELECT id,kind,value,reason,label,created,until FROM bans WHERE until IS NULL OR until>? ORDER BY id DESC').all(now);
        return send(res, 200, { accounts, rules: rules.map(r => ({ ...r, value: r.kind === 'device' ? r.value.slice(0, 8) : r.value })) });
      }
      am = p.match(/^\/api\/admin\/bans\/(\d+)$/);
      if (req.method === 'DELETE' && am) { db.prepare('DELETE FROM bans WHERE id=?').run(+am[1]); modlog(user, 'admin:sperre aufgehoben', 'Regel #' + am[1]); return send(res, 200, { ok: true }); }
      if (req.method === 'GET' && p === '/api/admin/flagged') {
        return send(res, 200, db.prepare('SELECT r.id,r.loc,r.cat,r.note,r.t,r.reason,u.name AS author FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE r.flag=1 AND r.t>? ORDER BY r.t DESC LIMIT 100').all(now - TTL));
      }
      am = p.match(/^\/api\/admin\/reports\/(\d+)\/approve$/);
      if (req.method === 'POST' && am) { db.prepare('UPDATE reports SET flag=0 WHERE id=?').run(+am[1]); modlog(user, 'admin:freigegeben', 'Meldung #' + am[1]); return send(res, 200, { ok: true }); }
      if (req.method === 'GET' && p === '/api/admin/log') return send(res, 200, db.prepare('SELECT t,name,action,detail FROM mod_log ORDER BY id DESC LIMIT 150').all());
      return send(res, 404, { error: 'Unbekannt' });
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
        res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': file[0] === 'index.html' || file[0] === 'sw.js' ? 'no-cache' : 'public, max-age=3600' });
        res.end(buf);
      });
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: 'Serverfehler' }); }
}).listen(PORT, () => console.log('Läuft auf Port ' + PORT));
