// Keine Abhängigkeiten nötig. Benötigt Node >= 22.5 (eingebautes SQLite).
const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const db = new DatabaseSync(process.env.DB_PATH || './reports.db');
db.exec(`CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, lat REAL NOT NULL, lng REAL NOT NULL,
  loc TEXT, cat TEXT NOT NULL, note TEXT, t INTEGER NOT NULL,
  still INTEGER DEFAULT 0, gone INTEGER DEFAULT 0)`);

const CATS = ['Geschwindigkeitskontrolle (Radar/Laser)', 'Verkehrskontrolle / Anhaltung',
  'Unfallaufnahme', 'Straßensperre / Umleitung', 'Streife unterwegs', 'Sonstiges'];
const TTL = 2 * 3600 * 1000;
const geoCache = new Map();

// einfaches Rate-Limit pro IP
const hits = new Map(), voteSeen = new Set();
function limited(ip, key, max) {
  const k = ip + key, now = Date.now();
  const a = (hits.get(k) || []).filter(x => now - x < 600000);
  a.push(now); hits.set(k, a);
  return a.length > max;
}
setInterval(() => {
  db.prepare('DELETE FROM reports WHERE t < ?').run(Date.now() - 24 * 3600 * 1000);
  hits.clear(); voteSeen.clear();
}, 600000);

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/reports') {
    const rows = db.prepare('SELECT * FROM reports WHERE t > ? AND gone < 3 ORDER BY t DESC LIMIT 300').all(Date.now() - TTL);
    return send(res, 200, rows);
  }

  if (req.method === 'POST' && url.pathname === '/api/reports') {
    if (limited(ip, 'post', 5)) return send(res, 429, { error: 'Zu viele Meldungen, bitte später erneut.' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(body); } catch { return send(res, 400, { error: 'Ungültig' }); }
      const lat = +d.lat, lng = +d.lng;
      if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) || !CATS.includes(d.cat))
        return send(res, 400, { error: 'Ungültige Daten' });
      db.prepare('INSERT INTO reports(lat,lng,loc,cat,note,t) VALUES(?,?,?,?,?,?)')
        .run(lat, lng, clean(d.loc, 100), d.cat, clean(d.note, 200), Date.now());
      send(res, 201, { ok: true });
    });
    return;
  }

  const m = url.pathname.match(/^\/api\/reports\/(\d+)\/(still|gone)$/);
  if (req.method === 'POST' && m) {
    if (limited(ip, 'vote', 40)) return send(res, 429, { error: 'Zu viele Aktionen' });
    const vk = ip + m[1] + m[2];
    if (voteSeen.has(vk)) return send(res, 409, { error: 'Schon abgestimmt' });
    voteSeen.add(vk);
    db.prepare(`UPDATE reports SET ${m[2]} = ${m[2]} + 1 WHERE id = ?`).run(+m[1]);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/health') return send(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/api/geocode') {
    const q = clean(url.searchParams.get('q'), 120);
    if (!q) return send(res, 400, { error: 'Leer' });
    if (limited(ip, 'geo', 20)) return send(res, 429, { error: 'Zu viele Suchen' });
    if (geoCache.has(q.toLowerCase())) return send(res, 200, geoCache.get(q.toLowerCase()));
    const api = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at'
      + '&viewbox=12.6,48.1,13.7,47.3&q=' + encodeURIComponent(q);
    fetch(api, { headers: { 'User-Agent': 'polizei-melder/1.0', 'Accept-Language': 'de' }, signal: AbortSignal.timeout(6000) })
      .then(r => r.json())
      .then(a => {
        const out = a[0] ? { lat: +a[0].lat, lng: +a[0].lon, name: String(a[0].display_name).split(',').slice(0, 3).join(',') } : { notFound: true };
        if (geoCache.size > 500) geoCache.clear();
        geoCache.set(q.toLowerCase(), out);
        send(res, 200, out);
      })
      .catch(() => send(res, 502, { error: 'Suche nicht erreichbar' }));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, buf) => {
      if (e) { res.writeHead(500); return res.end('Fehler'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); res.end(buf);
    });
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => console.log('Läuft auf Port ' + PORT));
