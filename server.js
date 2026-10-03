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

// einfaches Rate-Limit pro IP
const hits = new Map();
function limited(ip, key, max) {
  const k = ip + key, now = Date.now();
  const a = (hits.get(k) || []).filter(x => now - x < 600000);
  a.push(now); hits.set(k, a);
  return a.length > max;
}
setInterval(() => {
  db.prepare('DELETE FROM reports WHERE t < ?').run(Date.now() - 24 * 3600 * 1000);
  hits.clear();
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
    db.prepare(`UPDATE reports SET ${m[2]} = ${m[2]} + 1 WHERE id = ?`).run(+m[1]);
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, buf) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(buf);
    });
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => console.log('Läuft auf Port ' + PORT));
