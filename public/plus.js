// Polizei-Melder: Zusatzfunktionen (Version 3)
// Nutzt die globalen Funktionen und Variablen aus index.html und erweitert sie über kleine Wrapper.
(() => {
"use strict";
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const on = (k, def) => LS.get(k, def ? "1" : "0") === "1";
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmtD = d => d < 1 ? Math.round(d * 100) * 10 + " m" : d.toFixed(1).replace(".", ",") + " km";
const sayDist = d => d < 1 ? Math.max(50, Math.round(d * 20) * 50) + " Metern" : (d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d)) + " Kilometern";
const SAY = { [C[0][0]]: "Radarkontrolle", [C[1][0]]: "Verkehrskontrolle", [C[2][0]]: "Unfall", [C[3][0]]: "Straßensperre", [C[4][0]]: "Polizeistreife", [C[5][0]]: "Stau", [C[6][0]]: "Wildwechsel", [C[7][0]]: "Baustelle", [C[8][0]]: "Meldung" };
const say = c => SAY[c] || "Meldung";

// ---------- Haptik (Android; das iPhone erlaubt Web-Apps kein Vibrieren) ----------
const hap = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
document.addEventListener("pointerdown", e => { if (e.target.closest(".fab,.mt2,.tile,.vb,#dq button,.chip,.sw,.mb,.go,.cols button,.seg button")) hap(8); }, { passive: true });

// ---------- Sprachansagen ----------
let voiceDE = null;
const pickVoice = () => { const v = speechSynthesis.getVoices(); voiceDE = v.find(x => /de[-_]AT/i.test(x.lang)) || v.find(x => /^de/i.test(x.lang)) || null; };
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(t, vol = 1) {
  if (!on("voice", 1) || !("speechSynthesis" in window)) return;
  try { const u = new SpeechSynthesisUtterance(t); u.lang = "de-AT"; if (voiceDE) u.voice = voiceDE; u.volume = vol; u.rate = 1.03; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {}
}
// iOS spricht erst nach einer Berührung: einmal leer "vorsprechen"
document.addEventListener("pointerdown", () => { try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {} }, { once: true });

// Warnung: zusätzlich ansagen, Rand aufleuchten lassen und dem Melder "gewarnt" gutschreiben
const _showAlert = showAlert;
showAlert = function (r, d) {
  _showAlert(r, d);
  speak("Achtung, " + say(r.cat) + " in " + sayDist(d) + (r.dest ? ", Richtung " + r.dest : ""), d < .4 ? 1 : .85);
  const e = $("edge"); e.classList.remove("flash"); void e.offsetWidth; e.classList.add("flash");
  fetch("/api/reports/" + r.id + "/seen", H("POST")).catch(() => {});
};

// ---------- Fahrmodus: Countdown-Ring, Tempolimit, 3D, Sprache ----------
const RC = 2 * Math.PI * 27, near2 = new Set();
$("drf").style.strokeDasharray = RC; $("drf").style.strokeDashoffset = RC;
function ring(d, e) {
  const f = d == null ? 0 : Math.max(0, Math.min(1, 1 - d / 1.5)), col = d == null || d > 1 ? "#22c55e" : d > .5 ? "#eab308" : "#ef4444";
  $("drf").style.strokeDashoffset = RC * (1 - f); $("drf").style.stroke = col; $("dre").textContent = e;
}
const lim = { v: null, at: null, t: 0, busy: false, said: 0, over: 0 };
const LIMDEF = { "AT:urban": 50, "AT:rural": 100, "AT:motorway": 130, "AT:trunk": 100, "AT:living_street": 5, "DE:urban": 50, "DE:rural": 100, "DE:living_street": 7, "DE:motorway": null, walk: 7, none: null };
const parseMax = t => { if (!t) return undefined; const s = String(t).trim(); if (/^\d+$/.test(s)) return +s; const mph = s.match(/^(\d+)\s*mph$/); if (mph) return Math.round(mph[1] * 1.609); return s in LIMDEF ? LIMDEF[s] : undefined; };
function showLim() { const e = $("dlim"), v = lim.v; if (e.textContent !== String(v || "")) { e.textContent = v || ""; e.classList.remove("pop"); void e.offsetWidth; e.classList.add("pop"); } e.classList.toggle("on", !!v); }
async function limUpd() {
  // Tempolimit aus OpenStreetMap, höchstens alle 30 s oder nach 120 m
  if (!drive || !me || lim.busy || (lim.at && km(lim.at, me) < .12 && Date.now() - lim.t < 30000)) return;
  lim.busy = true; lim.at = me; lim.t = Date.now();
  try {
    const q = `[out:json][timeout:8];way(around:25,${me.lat.toFixed(5)},${me.lng.toFixed(5)})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link)$"];out tags;`;
    const j = await (await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q), { signal: AbortSignal.timeout(9000) })).json();
    let v;
    for (const w of j.elements || []) { const t = w.tags || {}; let x = parseMax(t.maxspeed); if (x === undefined && t.highway === "motorway") x = 130; if (x !== undefined) { v = x; break; } }
    lim.v = v === undefined ? null : v; showLim();
  } catch {}
  lim.busy = false;
}
dInfo = function (c) {
  const sp = c && c.speed != null && !isNaN(c.speed) ? Math.round(c.speed * 3.6) : null, over = sp != null && lim.v && sp > lim.v + 3;
  $("dspd").textContent = (sp == null ? "–" : sp) + " km/h"; $("dspd").classList.toggle("over", !!over);
  lim.over = over ? lim.over + 1 : 0;
  if (lim.over === 3 && Date.now() - lim.said > 60000) { lim.said = Date.now(); speak("Achtung, Tempolimit " + lim.v); }
  if (!me) { $("dnext").textContent = "Standort wird ermittelt…"; ring(null, "…"); return; }
  const hd = hdOf(c); let best = null, bd = 1e9;
  for (const r of rows) {
    if (user && r.author === user.name) continue; const d = km(me, r); if (d > 10 || d >= bd) continue;
    if (hd !== null && Math.abs(((bearing(me, r) - hd + 540) % 360) - 180) > 60) continue; best = r; bd = d;
  }
  const m = best && (M[best.cat] || M["Sonstiges"]);
  $("dnext").textContent = best ? m.s + "\n" + fmtD(bd) : "Nichts\n" + (hd === null ? "in der Nähe" : "voraus");
  ring(best ? bd : null, best ? m.e : "✓");
  const danger = !!best && bd < .3; document.body.classList.toggle("danger", danger);
  if (danger && !near2.has(best.id)) { near2.add(best.id); speak("Achtung, " + say(best.cat) + " in " + sayDist(bd)); hap([300, 120, 300]); }
};
const _dUpd = dUpd;
dUpd = function (c) { _dUpd(c); if (drive) limUpd(); };

let tilt = on("tilt", 0);
const TILT = 35, PERS = 1200;
dLayout = function () {
  if (!drive) return;
  // Kartenfläche größer als der Bildschirm: beim Drehen keine leeren Ecken, in 3D bis zum oberen Rand sichtbar
  // Eigene Position im freien Bereich zwischen Anzeige oben und Knöpfen unten (offsetTop ignoriert die Einblend-Animation)
  const top = $("dtop").offsetTop + $("dtop").offsetHeight, bot = $("dbot").offsetTop || innerHeight * .7;
  const W = innerWidth, Hh = innerHeight, cx = W / 2, cy = top + (bot - top) * (tilt ? .8 : .72), s = $("map").style;
  let R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, Hh - cy));
  if (tilt) { const a = TILT * Math.PI / 180; R = Math.max(R, 1.06 * cy * PERS / (PERS * Math.cos(a) - cy * Math.sin(a))); }
  const D = Math.ceil(2 * R);
  s.inset = "auto"; s.left = (cx - D / 2) + "px"; s.top = (cy - D / 2) + "px"; s.width = s.height = D + "px";
  $("dme").style.left = cx + "px"; $("dme").style.top = cy + "px";
  map.invalidateSize({ pan: false }); if (me) map.setView(me, map.getZoom(), { animate: false });
};
dRot = function (h) {
  hdU += ((h - hdU) % 360 + 540) % 360 - 180;
  $("map").style.transform = (tilt ? `perspective(${PERS}px) rotateX(${TILT}deg) ` : "") + "rotate(" + (-hdU) + "deg)";
  document.body.style.setProperty("--hd", hdU + "deg");
};
$("d3d").onclick = () => { tilt = !tilt; LS.set("tilt", tilt ? "1" : "0"); $("d3d").classList.toggle("on", tilt); document.body.classList.toggle("tilt", tilt); dLayout(); dRot(hdU); hap(15); };

// Sprachbefehle: Mikrofon-Knopf und "Hey Melder" (Dauerzuhören, nur wo unterstützt)
const SRc = window.SpeechRecognition || window.webkitSpeechRecognition;
function catFrom(t) { const l = t.toLowerCase(); for (const [k, ks, ex] of KW) if (ks.some(x => ex ? l.split(/\s+/).includes(x) : l.includes(x))) return k; return null; }
function voiceReport(c) { speak(say(c) + " wird gemeldet"); quickSend(c); }
const hey = {
  r: null, pause: false, on: false,
  start() { if (!SRc || this.on) return; this.on = true; this.kick(); },
  stop() { this.on = false; try { this.r && this.r.abort(); } catch {} this.r = null; },
  kick() {
    if (!this.on || this.pause || this.r || !drive || document.hidden) return;
    const s = new SRc(); s.lang = "de-AT"; s.continuous = true; s.interimResults = false;
    s.onresult = e => {
      const t = e.results[e.results.length - 1][0].transcript.toLowerCase(), i = t.indexOf("melder"); if (i < 0) return;
      const c = catFrom(t.slice(i + 6));
      if (c) voiceReport(c); else { try { s.abort(); } catch {} speak("Ja?"); setTimeout(listen, 700); }
    };
    s.onend = () => { this.r = null; setTimeout(() => this.kick(), 400); };
    s.onerror = e => { if (/not-allowed/.test(e.error)) { this.stop(); toast("Mikrofon nicht erlaubt"); } };
    try { s.start(); this.r = s; } catch {}
  }
};
function listen() {
  if (!SRc) return toast("Spracherkennung wird in diesem Browser nicht unterstützt");
  if (!user) return need();
  hey.pause = true; try { hey.r && hey.r.abort(); } catch {}
  const s = new SRc(); s.lang = "de-AT"; s.interimResults = false; s.maxAlternatives = 3;
  s.onresult = e => {
    const alts = [...e.results[0]].map(a => a.transcript), c = catFrom(alts.join(" "));
    if (c) voiceReport(c); else { speak("Nicht verstanden. Sag zum Beispiel: Radar."); toast("Nicht verstanden: „" + alts[0] + "“"); }
  };
  s.onend = () => { $("dmic").classList.remove("on"); hey.pause = false; hey.kick(); };
  s.onerror = () => {};
  try { s.start(); $("dmic").classList.add("on"); hap(20); toast("Sag z. B. „Radar“, „Kontrolle“ oder „Streife“"); } catch {}
}
$("dmic").onclick = listen;

const _setDrive = setDrive;
setDrive = function (v) {
  document.body.classList.toggle("tilt", v && tilt); $("d3d").classList.toggle("on", tilt);
  _setDrive(v);
  if (v) { dRot(hdU); speak("Fahrmodus aktiv. Gute Fahrt!"); if (on("hey", 0)) hey.start(); limUpd(); }
  else { hey.stop(); near2.clear(); document.body.classList.remove("danger", "tilt"); lim.v = null; showLim(); }
};
document.addEventListener("visibilitychange", () => { if (!document.hidden) hey.kick(); });

// ---------- Schütteln zum Melden ----------
let shT = 0, shN = 0, shL = 0, shOn = false;
function onMotion(e) {
  const a = e.acceleration && e.acceleration.x != null ? e.acceleration : null, g = e.accelerationIncludingGravity;
  const m = a ? Math.hypot(a.x, a.y, a.z) : g ? Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81) : 0, now = Date.now();
  if (m < 17) return;
  shN = now - shT < 700 ? shN + 1 : 1; shT = now;
  if (shN >= 3 && now - shL > 3000) { shL = now; shN = 0; shaken(); }
}
function shaken() {
  if (!on("shake", 0)) return; hap([60, 40, 60]);
  if (drive) { const q = $("dq"); q.classList.remove("pulse"); void q.offsetWidth; q.classList.add("pulse"); speak("Was möchtest du melden?"); return; }
  if (!user) return need();
  if (!$("modal").classList.contains("open")) { open(true); toast("📳 Was möchtest du melden?"); }
}
function shakeListen() { if (!shOn) { shOn = true; addEventListener("devicemotion", onMotion); } }
async function shakePerm(quiet) {
  if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
    try { if (await DeviceMotionEvent.requestPermission() !== "granted") throw 0; }
    catch { if (!quiet) { $("sshake").checked = false; LS.set("shake", "0"); toast("Bewegungssensor nicht erlaubt"); } return; }
  }
  shakeListen(); if (!quiet) toast("Schüttel dein Handy zum Melden 📳");
}
if (on("shake", 0)) {
  if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) document.addEventListener("pointerdown", () => shakePerm(true), { once: true });
  else shakeListen();
}

// ---------- Route checken ----------
let routeL = null;
function segDist(p, a, b) {
  const kx = Math.cos(p.lat * Math.PI / 180) * 111.32, ky = 110.57;
  const ax = (a[1] - p.lng) * kx, ay = (a[0] - p.lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky, l = dx * dx + dy * dy;
  const f = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
  return [Math.hypot(ax + f * dx, ay + f * dy), f];
}
function routeClear() { if (routeL) { map.removeLayer(routeL); routeL = null; } }
async function routeCheck() {
  const q = $("rtq").value.trim(), b = $("rtb"); if (!q) return;
  b.textContent = ""; b.append(mkEl("div", "mu", "Route wird berechnet…"));
  const from = me || map.getCenter();
  let to = T.find(x => norm(x.n) === norm(q)) || T.find(x => norm(x.n).startsWith(norm(q)));
  if (!to) { try { const j = await (await fetch("/api/geocode?q=" + encodeURIComponent(q))).json(); if (typeof j.lat === "number") to = { lat: j.lat, lng: j.lng, n: j.name }; } catch {} }
  if (!to) { b.textContent = "Ziel nicht gefunden. Versuch es mit einem Ortsnamen."; return; }
  let r; try { r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(12000) })).json(); } catch {}
  if (!r || !r.routes || !r.routes[0]) { b.textContent = "Route konnte nicht berechnet werden."; return; }
  const rt = r.routes[0], g = rt.geometry.coordinates.map(c => [c[1], c[0]]), cum = [0];
  for (let i = 1; i < g.length; i++) cum[i] = cum[i - 1] + km({ lat: g[i - 1][0], lng: g[i - 1][1] }, { lat: g[i][0], lng: g[i][1] });
  // Meldungen höchstens 250 m neben der Strecke, mit Entfernung entlang der Strecke
  const hits = [];
  for (const rep of rows) {
    let best = 1e9, at = 0;
    for (let i = 1; i < g.length; i++) { const [d, f] = segDist(rep, g[i - 1], g[i]); if (d < best) { best = d; at = cum[i - 1] + f * (cum[i] - cum[i - 1]); } }
    if (best < .25) hits.push({ r: rep, at });
  }
  hits.sort((a, c) => a.at - c.at);
  routeClear();
  routeL = L.layerGroup([L.polyline(g, { color: "#fff", weight: 10, opacity: .95, interactive: false }), L.polyline(g, { color: "#2563eb", weight: 6, className: "rtl", interactive: false })]).addTo(map);
  b.textContent = "";
  const sum = mkEl("div", "rsum");
  sum.append(mkEl("b", "", hits.length ? hits.length + (hits.length === 1 ? " Meldung" : " Meldungen") + " auf der Strecke" : "✅ Strecke frei"),
    mkEl("span", "", "📏 " + Math.round(rt.distance / 1000) + " km · ⏱ " + Math.round(rt.duration / 60) + " Min. bis " + (to.n || q).split(",")[0]));
  b.append(sum);
  hits.forEach((h, i) => {
    const m = M[h.r.cat] || M["Sonstiges"], row = mkEl("div", "lbr"), n = mkEl("div", "nm");
    row.style.setProperty("--i", i); row.style.cursor = "pointer";
    n.append(mkEl("b", "", m.e + " " + (h.r.loc || m.s)), mkEl("small", "", m.s + " · " + ago(h.r.t)));
    row.append(n, mkEl("span", "pt", "nach " + fmtD(h.at)));
    row.onclick = () => { ovSet("rtm", false); map.setView([h.r.lat, h.r.lng], 15); };
    b.append(row);
  });
  const act = mkEl("div", "prow"), sh = mkEl("button", "btn", "🗺️ Auf der Karte zeigen"), cl = mkEl("button", "btn", "Route entfernen");
  sh.onclick = () => { ovSet("rtm", false); setTimeout(() => map.fitBounds(L.latLngBounds(g), { padding: [40, 40], paddingBottomRight: [40, innerHeight * .45] }), 350); };
  cl.onclick = () => { routeClear(); b.textContent = ""; toast("Route entfernt"); };
  act.append(sh, cl); b.append(act);
  if (drive) speak(hits.length ? hits.length + " Meldungen auf deiner Route" : "Deine Route ist frei");
}
$("rtgo").onclick = routeCheck; $("rtq").addEventListener("keydown", e => { if (e.key === "Enter") routeCheck(); });

// ---------- Hotspots (Heatmap) ----------
let heatL = null;
async function heatToggle(v) {
  if (v === undefined) v = !heatL;
  if (!v) { if (heatL) { map.removeLayer(heatL); heatL = null; } buildChips(); return; }
  if (heatL) return;
  let a; try { a = await (await fetch("/api/heat")).json(); if (!Array.isArray(a)) throw 0; } catch { return toast("Hotspots konnten nicht geladen werden"); }
  if (!map.getPane("heat")) { const p = map.createPane("heat"); p.style.zIndex = 350; p.style.pointerEvents = "none"; }
  const rnd = L.svg({ pane: "heat" }), mx = Math.max(1, ...a.map(x => x[2]));
  heatL = L.layerGroup(a.map(([la, ln, n]) => { const k = n / mx; return L.circle([la, ln], { renderer: rnd, radius: 240 + k * 300, stroke: false, fillColor: k > .66 ? "#dc2626" : k > .33 ? "#f97316" : "#facc15", fillOpacity: .3 + k * .4, interactive: false }); })).addTo(map);
  buildChips(); toast(a.length ? "🔥 Hotspots der letzten 30 Tage" : "Noch keine Hotspots. Dafür braucht es mehr Meldungen.");
}
const _buildChips = buildChips;
buildChips = function () { _buildChips(); const f = $("chips"); f.insertBefore(chip("🔥 Hotspots", !!heatL, () => heatToggle()), f.children[2] || null); };
buildChips();

// ---------- Wetter und Tag/Nacht ----------
const wx = { code: null, temp: null, day: 1, pr: 0, t: 0, warned: false };
const wxKind = c => c == null ? null : (c >= 71 && c <= 77) || c === 85 || c === 86 ? "snow" : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95 ? "rain" : c === 45 || c === 48 ? "fog" : null;
const wxIcon = (c, day) => c === 0 ? (day ? "☀️" : "🌙") : c <= 3 ? (day ? "⛅" : "☁️") : c <= 48 ? "🌫️" : c <= 57 ? "🌦️" : c <= 67 ? "🌧️" : c <= 77 ? "🌨️" : c <= 82 ? "🌧️" : c <= 86 ? "🌨️" : "⛈️";
async function wxLoad() {
  if (!me || Date.now() - wx.t < 15 * 60000) return; wx.t = Date.now();
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${me.lat.toFixed(3)}&longitude=${me.lng.toFixed(3)}&current=temperature_2m,weather_code,is_day,precipitation&timezone=auto`, { signal: AbortSignal.timeout(8000) })).json();
    const c = j.current; Object.assign(wx, { code: c.weather_code, temp: c.temperature_2m, day: c.is_day, pr: c.precipitation || 0 });
    let el = $("wxc"); if (!el) { el = mkEl("span", "wxc"); el.id = "wxc"; $("live").append(el); }
    el.textContent = wxIcon(wx.code, wx.day) + " " + Math.round(wx.temp) + "°";
    wxStart(); iceCheck();
  } catch {}
}
function iceCheck() {
  const c = wx.code, frosty = [56, 57, 66, 67].includes(c) || wxKind(c) === "snow";
  if (wx.warned || wx.temp == null || !on("wx", 1) || !(wx.temp <= 0 || (wx.temp <= 3 && (wx.pr > 0 || frosty)))) return;
  wx.warned = true;
  const a = $("alert"); a.textContent = "❄️ Glättegefahr: " + Math.round(wx.temp) + " °C" + (wx.pr > 0 ? " und Niederschlag" : "") + ". Fahr vorsichtig!";
  a.classList.add("on"); clearTimeout(showAlert.t); showAlert.t = setTimeout(() => a.classList.remove("on"), 8000);
  speak("Achtung, Glättegefahr. Fahr vorsichtig.");
}
// Regen, Schnee und Nebel als dezenter Effekt über der Karte
let wxRaf = 0, wxP = [];
function wxStart() {
  cancelAnimationFrame(wxRaf); const cv = $("wx"), x = cv.getContext("2d"), k = wxKind(wx.code);
  const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, Hh = innerHeight;
  cv.width = W * dpr; cv.height = Hh * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, Hh);
  if (!k || !on("wx", 1) || calm) return;
  wxP = Array.from({ length: k === "rain" ? 90 : k === "snow" ? 70 : 3 }, () => ({ x: Math.random() * W, y: Math.random() * Hh, s: Math.random(), w: Math.random() * 6.28 }));
  const drk = () => isDk();
  const f = () => {
    if (document.hidden) { wxRaf = requestAnimationFrame(f); return; }
    x.clearRect(0, 0, W, Hh);
    if (k === "rain") {
      x.strokeStyle = drk() ? "rgba(170,200,255,.35)" : "rgba(70,110,170,.35)"; x.lineWidth = 1.2; x.beginPath();
      for (const p of wxP) { const v = 9 + p.s * 7; p.y += v; p.x -= v * .18; if (p.y > Hh) { p.y = -20; p.x = Math.random() * (W + 80); } x.moveTo(p.x, p.y); x.lineTo(p.x + 3, p.y - 14 - p.s * 8); }
      x.stroke();
    } else if (k === "snow") {
      x.fillStyle = drk() ? "rgba(255,255,255,.8)" : "rgba(255,255,255,.95)";
      for (const p of wxP) { p.w += .02; p.y += .6 + p.s * 1.1; p.x += Math.sin(p.w) * .6; if (p.y > Hh) { p.y = -6; p.x = Math.random() * W; } x.beginPath(); x.arc(p.x, p.y, 1.4 + p.s * 2.2, 0, 6.28); x.fill(); }
    } else {
      for (const p of wxP) { p.x += .15 + p.s * .2; if (p.x > W + 300) p.x = -300; const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, 320); g.addColorStop(0, "rgba(200,210,220,.28)"); g.addColorStop(1, "rgba(200,210,220,0)"); x.fillStyle = g; x.fillRect(0, 0, W, Hh); }
    }
    wxRaf = requestAnimationFrame(f);
  };
  f();
}
addEventListener("resize", () => { if (wx.code != null) wxStart(); });

// Design: System, Sonne (dunkel nach Sonnenuntergang), Hell, Dunkel
function sunUp(lat, lng, d = new Date()) {
  const rad = Math.PI / 180, day = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5), g = 2 * Math.PI / 365 * (day - 1 + (d.getUTCHours() - 12) / 24);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
  if (isNaN(ha)) return true;
  const noon = 720 - 4 * lng - eq, m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m > noon - 4 * ha && m < noon + 4 * ha;
}
function applyTheme(animate) {
  const t = LS.get("theme", "auto"), r = document.documentElement, ll = me || { lat: 47.8095, lng: 13.055 };
  let cls = t === "light" ? "light" : t === "dark" ? "dark" : null;
  if (t === "sun") { cls = sunUp(ll.lat, ll.lng) ? "light" : "dark"; LS.set("sunDark", cls === "dark" ? "1" : "0"); }
  const was = isDk();
  r.classList.remove("light", "dark"); if (cls) r.classList.add(cls);
  if (was !== isDk()) {
    if (animate) { r.classList.add("thm"); setTimeout(() => r.classList.remove("thm"), 800); }
    tiles.setUrl(TL(isDk())); dark();
  }
  for (const mt of document.querySelectorAll('meta[name="theme-color"]')) { if (cls) mt.removeAttribute("media"); mt.content = isDk() ? "#0a0e16" : "#eef0f5"; }
}
function buildTheme() {
  const w = $("sth"), cur = LS.get("theme", "auto"); w.textContent = "";
  for (const [k, l] of [["auto", "System"], ["sun", "☀️ Sonne"], ["light", "Hell"], ["dark", "Dunkel"]]) {
    const b = mkEl("button", cur === k ? "on" : "", l); b.onclick = () => { LS.set("theme", k); buildTheme(); applyTheme(true); }; w.append(b);
  }
}
buildTheme(); applyTheme(false);

// App-Farbe
const COLS = [["std", "#2563eb", "#7c3aed", "#db2777", "Standard"], ["blau", "#0066b1", "#1e3a8a", "#e22718", "Blau-Rot"], ["rot", "#dc2626", "#f97316", "#facc15", "Racing-Rot"],
  ["mint", "#059669", "#10b981", "#22d3ee", "Mint"], ["gold", "#b45309", "#f59e0b", "#fde047", "Gold"], ["pink", "#db2777", "#a855f7", "#f472b6", "Pink"], ["graphit", "#334155", "#0f172a", "#64748b", "Graphit"]];
function applyCol(id) {
  const c = COLS.find(x => x[0] === id) || COLS[0], r = document.documentElement.style;
  if (c[0] === "std") for (const k of ["--grad", "--ac", "--g1", "--g2", "--g3"]) r.removeProperty(k);
  else { r.setProperty("--grad", `linear-gradient(135deg,${c[1]},${c[2]})`); r.setProperty("--g1", c[1]); r.setProperty("--g2", c[2]); r.setProperty("--g3", c[3]); if (c[0] !== "graphit") r.setProperty("--ac", c[1]); else r.removeProperty("--ac"); }
}
function buildCols() {
  const w = $("scol"), cur = LS.get("col", "std"); w.textContent = "";
  for (const c of COLS) {
    const b = mkEl("button", cur === c[0] ? "on" : ""); b.title = c[4]; b.setAttribute("aria-label", c[4]);
    b.style.background = `linear-gradient(135deg,${c[1]},${c[2]} 60%,${c[3]})`;
    b.onclick = () => { LS.set("col", c[0]); applyCol(c[0]); buildCols(); toast("🎨 " + c[4]); }; w.append(b);
  }
}
applyCol(LS.get("col", "std")); buildCols();

// Einstellungs-Schalter
for (const [id, k, def, fn] of [["svoice", "voice", 1, v => v && speak("Sprachansagen sind an")], ["shey", "hey", 0, v => { if (v && !SRc) toast("Wird in diesem Browser nicht unterstützt"); if (v && drive) hey.start(); if (!v) hey.stop(); }],
  ["sshake", "shake", 0, v => v && shakePerm(false)], ["swx", "wx", 1, () => wxStart()]]) {
  const el = $(id); el.checked = on(k, def); el.onchange = () => { LS.set(k, el.checked ? "1" : "0"); fn && fn(el.checked); };
}

// ---------- Abzeichen, Levels, Danke ----------
let celeQ = [], celeOn = false;
function confetti() {
  if (calm) return;
  const cv = $("cfc"), x = cv.getContext("2d"), dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, Hh = innerHeight;
  cv.width = W * dpr; cv.height = Hh * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = ["#3b82f6", "#8b5cf6", "#f43f5e", "#facc15", "#22c55e", "#ffffff"], P = [];
  for (let i = 0; i < 170; i++) { const a = -Math.PI / 2 + (Math.random() - .5) * 1.9, v = 9 + Math.random() * 11; P.push({ x: W / 2, y: Hh * .42, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.3, vr: (Math.random() - .5) * .35, w: 6 + Math.random() * 6, h: 9 + Math.random() * 9, c: cols[i % cols.length] }); }
  const t0 = performance.now();
  (function f(t) {
    x.clearRect(0, 0, W, Hh);
    for (const p of P) { p.vy += .32; p.vx *= .99; p.vy *= .995; p.x += p.vx; p.y += p.vy; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); x.restore(); }
    if (t - t0 < 3400) requestAnimationFrame(f); else x.clearRect(0, 0, W, Hh);
  })(t0);
}
function celebrate(o) { celeQ.push(o); if (!celeOn) celeNext(); }
function celeNext() {
  const o = celeQ.shift(), c = $("cele");
  if (!o) { celeOn = false; c.classList.remove("on"); return; }
  celeOn = true; $("cem").textContent = o.e; $("ctit").textContent = o.t; $("cnm").textContent = o.n; $("cds").textContent = o.d || "";
  c.classList.remove("on"); void c.offsetWidth; c.classList.add("on"); confetti(); hap([30, 50, 30, 50, 140]);
}
$("cgo").onclick = celeNext;
const LVL = (t, role) => role === "admin" ? 9 : t >= 20 ? 3 : t >= 5 ? 2 : t <= -5 ? 0 : 1;
function checkAch() {
  if (!user || !user.badges || !user.stats) return;
  const k = user.name, fresh = user.stats.reports === 0;
  const lv = LVL(user.trust, user.role), pl = LS.get("lvl:" + k, null);
  if (pl !== null && lv > +pl && user.role !== "admin") { const l = LV(user.trust); celebrate({ e: l[0].split(" ")[0], t: "Aufgestiegen!", n: l[0].slice(l[0].indexOf(" ") + 1), d: "Deine Bewertungen haben jetzt mehr Gewicht." }); }
  LS.set("lvl:" + k, lv);
  const got = user.badges.filter(b => b.got).map(b => b.id), prev = LS.get("bdg:" + k, fresh ? "[]" : null);
  if (prev !== null) { let p = []; try { p = JSON.parse(prev); } catch {} for (const b of user.badges) if (b.got && !p.includes(b.id)) celebrate({ e: b.e, t: "Neues Abzeichen!", n: b.n, d: b.d }); }
  LS.set("bdg:" + k, JSON.stringify(got));
  const w = user.stats.warned, pw = LS.get("wrn:" + k, fresh ? "0" : null);
  if (pw !== null && w > +pw) { const n = w - +pw; celebrate({ e: "🙌", t: "Danke!", n: n === 1 ? "Ein Fahrer wurde gewarnt" : n + " Fahrer wurden gewarnt", d: "Dank deiner Meldungen. Insgesamt schon " + w + "." }); }
  LS.set("wrn:" + k, w);
}
async function refreshMe() {
  if (!user) return;
  try { const j = await (await fetch("/api/me")).json(); if (j.name) { user = j; acct(); checkAch(); } } catch {}
}
const _quickSend = quickSend;
quickSend = async function (c) { await _quickSend(c); hap([20, 40, 20]); setTimeout(refreshMe, 900); };
const _vote = vote;
vote = async function (id, k) { await _vote(id, k); hap(15); };
$("send").addEventListener("click", () => setTimeout(refreshMe, 1800));

// Profilkarte im Menü: Farbe je Level und verdiente Abzeichen
const _menuProf = menuProf;
menuProf = function () {
  const pr = _menuProf(), pc = $("mprof").querySelector(".pc");
  if (pc && user) {
    pc.classList.add("lv-" + (user.role === "admin" ? "adm" : user.trust >= 20 ? "vert" : user.trust >= 5 ? "zuv" : "neu"));
    const got = (user.badges || []).filter(b => b.got);
    if (got.length) { const w = mkEl("div", "pbadges"); for (const b of got.slice(0, 7)) { const s = mkEl("span", "", b.e); s.title = b.n; w.append(s); } if (got.length > 7) w.append(mkEl("span", "", "+" + (got.length - 7))); pc.append(w); }
  }
  return pr;
};

// Erfolge-Fenster
async function bdRender() {
  const b = $("bdb"); b.textContent = ""; b.append(mkEl("div", "mu", "Lädt…"));
  await refreshMe(); b.textContent = "";
  if (!user || !user.badges) { b.append(mkEl("div", "mu", "Erfolge konnten nicht geladen werden.")); return; }
  const got = user.badges.filter(x => x.got).length;
  $("bdsub").textContent = got + " von " + user.badges.length + " Abzeichen freigeschaltet";
  user.badges.forEach((x, i) => {
    const d = mkEl("div", "bd" + (x.got ? " got" : "")); d.style.setProperty("--i", i);
    d.append(mkEl("div", "be", x.e), mkEl("b", "", x.n), mkEl("small", "", x.d));
    if (!x.got && x.max > 1) { const pb = mkEl("div", "bp"), pi = mkEl("i"); pi.style.width = (x.cur / x.max * 100) + "%"; pb.append(pi); d.append(pb, mkEl("small", "bc", x.cur + " / " + x.max)); }
    if (x.got) d.onclick = () => celebrate({ e: x.e, t: "Abzeichen", n: x.n, d: x.d });
    b.append(d);
  });
}

// ---------- Bestenliste mit Woche, Gesamt, Freunde ----------
let lbScope = "week";
function lbRowX(rk, u, v) { const r = lbRow(rk, u); r.querySelector(".pt").textContent = v + " Pkt"; if (u.crown) r.querySelector(".nm b").textContent = "👑 " + u.name; return r; }
lbRender = async function () {
  const t = $("lbt"); t.textContent = "";
  for (const [k, l] of [["week", "Diese Woche"], ["all", "Gesamt"], ["friends", "Freunde"]]) t.append(chip(l, lbScope === k, () => { lbScope = k; lbRender(); }));
  $("lbd").textContent = lbScope === "week" ? "Punkte, die diese Woche dazugekommen sind. Jeden Montag geht's von vorn los, der Sieger bekommt die 👑." : lbScope === "friends" ? "Du und deine Freunde im Vergleich (Gesamtpunkte)." : "Punkte gibt es, wenn andere deine Meldungen mit 👍 bestätigen. Falsche Meldungen kosten Punkte.";
  const b = $("lbb"); b.textContent = ""; b.append(mkEl("div", "mu", "Lädt…"));
  if (lbScope === "friends" && !user) { b.textContent = ""; b.append(mkEl("div", "mu", "Melde dich an, um Freunde hinzuzufügen.")); return; }
  let j; try { const x = await fetch("/api/leaderboard?scope=" + lbScope); j = await x.json(); if (!x.ok || !Array.isArray(j.top)) throw 0; } catch { b.textContent = "Bestenliste konnte nicht geladen werden."; return; }
  b.textContent = ""; const val = u => lbScope === "week" ? u.pts : u.trust;
  if (lbScope === "week" && j.weekStart) {
    const left = j.weekStart + 7 * 864e5 - Date.now(), dd = Math.floor(left / 864e5), hh = Math.floor(left % 864e5 / 3600e3);
    b.append(mkEl("div", "wk", "⏳ Neue Woche in " + (dd ? dd + " Tg. " : "") + hh + " Std."));
  }
  if (!j.top.length) b.append(mkEl("div", "empty", lbScope === "week" ? "Diese Woche hat noch niemand Punkte. Deine Chance! 🚀" : lbScope === "friends" ? "Noch keine Freunde. Füge welche hinzu!" : "Noch hat niemand Punkte gesammelt."));
  let rk = 0, prev = null;
  j.top.forEach((u, i) => { if (val(u) !== prev) { rk = i + 1; prev = val(u); } const r = lbRowX(rk, u, val(u)); r.style.setProperty("--i", i); b.append(r); });
  if (j.me && !j.top.some(u => u.name === j.me.name)) { const g = mkEl("div", "mu", "…"); g.style.textAlign = "center"; b.append(g, lbRowX(j.me.rank, j.me, val(j.me))); }
  if (lbScope === "friends") { const f = mkEl("button", "btn", "👥 Freunde verwalten"); f.onclick = () => { ovSet("lbm", false); MA.friends(); }; b.append(f); }
};

// ---------- Freunde ----------
async function frRender() {
  const b = $("frb"); b.textContent = ""; b.append(mkEl("div", "mu", "Lädt…"));
  let a; try { a = await (await fetch("/api/friends")).json(); if (!Array.isArray(a)) throw 0; } catch { b.textContent = "Freunde konnten nicht geladen werden."; return; }
  b.textContent = "";
  if (!a.length) { b.append(mkEl("div", "empty", "Noch keine Freunde. Gib oben einen Benutzernamen ein.")); return; }
  a.forEach((f, i) => {
    const r = mkEl("div", "lbr"), n = mkEl("div", "nm"), l = LV(f.trust, f.role); r.style.setProperty("--i", i);
    n.append(mkEl("b", "", (f.crown ? "👑 " : "") + f.name), mkEl("small", "", l[0] + " · " + f.wk + " Pkt diese Woche" + (f.mutual ? (f.online ? " · online" : "") : " · hat dich noch nicht hinzugefügt")));
    const x = mkEl("button", "btn", "Entfernen"); x.style.margin = "0";
    x.onclick = async () => { await fetch("/api/friends/" + encodeURIComponent(f.name), H("DELETE")).catch(() => {}); toast(f.name + " entfernt"); frRender(); sig = ""; load(); };
    if (f.mutual) r.append(mkEl("span", "dot" + (f.online ? " on" : "")));
    r.append(n, x); b.append(r);
  });
}
async function frAdd() {
  const n = $("frn").value.trim(); if (!n) return;
  try {
    const x = await fetch("/api/friends", H("POST", { name: n })), j = await x.json().catch(() => ({}));
    if (x.ok) { $("frn").value = ""; toast("⭐ " + j.name + " hinzugefügt"); hap(20); frRender(); sig = ""; load(); } else toast(j.error || "Fehler");
  } catch { toast("Keine Verbindung"); }
}
$("fra").onclick = frAdd; $("frn").addEventListener("keydown", e => { if (e.key === "Enter") frAdd(); });

// ---------- Teilen als Bild ----------
const logoImg = new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = "/icon.svg"; });
function rr(x, X, Y, W, Hh, R) { x.beginPath(); x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + Hh, R); x.arcTo(X + W, Y + Hh, X, Y + Hh, R); x.arcTo(X, Y + Hh, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath(); }
const loadImg = src => new Promise(r => { const i = new Image(); i.crossOrigin = "anonymous"; const t = setTimeout(() => r(null), 5000); i.onload = () => { clearTimeout(t); r(i); }; i.onerror = () => { clearTimeout(t); r(null); }; i.src = src; });
async function shareCanvas(cv, name, text) {
  const blob = await new Promise(r => cv.toBlob(r, "image/png")); if (!blob) throw 0;
  const f = new File([blob], name, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: "Polizei-Melder", text }); } catch {} return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast("📸 Bild gespeichert");
}
async function brand(x, W, y) {
  const lg = await logoImg; if (lg) x.drawImage(lg, 60, y, 84, 84);
  x.fillStyle = "#fff"; x.font = "800 44px system-ui,sans-serif"; x.fillText("Melder", 164, y + 56);
  x.fillStyle = "rgba(255,255,255,.6)"; x.font = "500 28px system-ui,sans-serif"; x.textAlign = "right"; x.fillText(location.host, W - 60, y + 54); x.textAlign = "left";
}
window.shareReport = async r => {
  const m = M[r.cat] || M["Sonstiges"], url = `https://www.google.com/maps?q=${r.lat},${r.lng}`, txt = m.s + (r.loc ? ": " + r.loc : "");
  toast("Bild wird erstellt…");
  try {
    const W = 1080, Hh = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = Hh; const x = cv.getContext("2d");
    const g = x.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#0b1022"); g.addColorStop(.6, "#1e1b4b"); g.addColorStop(1, "#3b0a2a"); x.fillStyle = g; x.fillRect(0, 0, W, Hh);
    await brand(x, W, 60);
    // Kartenausschnitt aus Kacheln
    const z = 15, n = 2 ** z, px = (r.lng + 180) / 360 * n * 256, s = Math.sin(r.lat * Math.PI / 180), py = (.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256;
    const X = 60, Y = 190, MW = W - 120, MH = 700, x0 = px - MW / 2, y0 = py - MH / 2;
    x.save(); rr(x, X, Y, MW, MH, 48); x.clip(); x.fillStyle = "#1f2937"; x.fillRect(X, Y, MW, MH);
    const jobs = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + MW) / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + MH) / 256); ty++)
      jobs.push(loadImg(TL(false).replace("{z}", z).replace("{x}", tx).replace("{y}", ty).replace("{r}", "")).then(i => { if (i) x.drawImage(i, X + tx * 256 - x0, Y + ty * 256 - y0); }));
    await Promise.all(jobs);
    const sh = x.createLinearGradient(0, Y + MH - 220, 0, Y + MH); sh.addColorStop(0, "rgba(11,16,34,0)"); sh.addColorStop(1, "rgba(11,16,34,.75)"); x.fillStyle = sh; x.fillRect(X, Y, MW, MH);
    x.restore();
    const cx = W / 2, cy = Y + MH / 2;
    for (const [rad, a] of [[120, .12], [80, .22]]) { x.beginPath(); x.arc(cx, cy, rad, 0, 6.29); x.fillStyle = `rgba(239,68,68,${a})`; x.fill(); }
    x.beginPath(); x.arc(cx, cy, 52, 0, 6.29); x.fillStyle = "#fff"; x.fill(); x.lineWidth = 10; x.strokeStyle = m.c; x.stroke();
    x.font = "54px system-ui,'Apple Color Emoji','Segoe UI Emoji',sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(m.e, cx, cy + 3);
    x.textAlign = "left"; x.textBaseline = "alphabetic";
    x.font = "800 34px system-ui,sans-serif"; x.fillStyle = m.c; rr(x, 60, 940, x.measureText(m.e + "  " + m.s).width + 48, 64, 32); x.fill();
    x.fillStyle = "#fff"; x.font = "800 34px system-ui,sans-serif"; x.fillText(m.e + "  " + m.s, 84, 984);
    x.font = "850 64px system-ui,sans-serif"; x.fillText((r.loc || "Ohne Ortsangabe").slice(0, 26), 60, 1090);
    x.fillStyle = "rgba(255,255,255,.75)"; x.font = "500 34px system-ui,sans-serif";
    x.fillText([ago(r.t), Math.round((r.conf == null ? .5 : r.conf) * 100) + " % sicher", r.dest ? "Richtung " + r.dest : ""].filter(Boolean).join("  ·  "), 60, 1150);
    x.fillStyle = "rgba(255,255,255,.5)"; x.font = "500 26px system-ui,sans-serif"; x.fillText("Gemeldet von der Community · Angaben ohne Gewähr", 60, 1270);
    await shareCanvas(cv, "meldung.png", txt + " " + url);
  } catch {
    navigator.share ? navigator.share({ title: "Polizei-Melder", text: txt, url }).catch(() => {}) : navigator.clipboard && navigator.clipboard.writeText(txt + " " + url).then(() => toast("Link kopiert"));
  }
};

// ---------- Wochenrückblick ----------
let rc = null;
const nearestTown = c => T.reduce((a, t) => !a || km({ lat: c[0], lng: c[1] }, t) < km({ lat: c[0], lng: c[1] }, a) ? t : a, null).n;
const hourTxt = h => h == null ? null : h < 5 ? "nachts" : h < 11 ? "morgens" : h < 14 ? "mittags" : h < 18 ? "nachmittags" : h < 22 ? "abends" : "nachts";
async function rcRender() {
  const d = $("rcd"), s = $("rcs"); d.textContent = ""; s.textContent = ""; s.append(mkEl("div", "mu", "Lädt…"));
  try { const x = await fetch("/api/recap"); rc = await x.json(); if (!x.ok) throw 0; } catch { s.textContent = "Rückblick konnte nicht geladen werden."; return; }
  s.textContent = ""; const j = rc, cm = j.topCat && M[j.topCat];
  const cards = [
    { g: "linear-gradient(160deg,#1e3a8a,#7c3aed,#1e3a8a)", k: "Deine Woche", big: j.reports, u: j.reports === 1 ? "Meldung" : "Meldungen", t: j.reports ? "Stark! Damit hilfst du allen auf der Straße." : "Diese Woche noch nichts gemeldet. Die nächste Kontrolle gehört dir!" },
    { g: "linear-gradient(160deg,#9f1239,#f97316,#9f1239)", k: "Gewarnt", big: j.warned, u: j.warned === 1 ? "Fahrer" : "Fahrer", t: j.warned ? "…wurden dank dir rechtzeitig gewarnt. 🙌" : "Sobald andere vor deinen Meldungen gewarnt werden, zählt das hier." },
    { g: "linear-gradient(160deg,#065f46,#06b6d4,#065f46)", k: "Punkte gesammelt", big: j.points, u: "Punkte", t: j.weekRank ? "Platz " + j.weekRank + " in der Wochenwertung 🏆" : "Noch nicht in der Wochenwertung" },
    { g: "linear-gradient(160deg,#4c1d95,#db2777,#4c1d95)", k: "Dein Hotspot", bigT: j.topLoc || (j.center ? nearestTown(j.center) : "–"), t: [cm ? cm.e + " Am meisten: " + cm.s : null, j.topHour != null ? "🕐 Meist " + hourTxt(j.topHour) + " unterwegs" : null].filter(Boolean).join(" · ") || "Noch keine Daten" },
    { g: "linear-gradient(160deg,#0f172a,#1d4ed8,#0f172a)", k: "Abzeichen", big: j.badges, u: "freigeschaltet", t: "Weiter so! Nächste Woche gibt's einen neuen Rückblick." }];
  rc.cards = cards;
  cards.forEach(c => {
    const e = mkEl("div", "rc"); e.style.background = c.g; e.append(mkEl("small", "", c.k));
    if (c.bigT != null) e.append(mkEl("b", "rct", c.bigT)); else { const n = mkEl("b", "", "0"); n.dataset.n = c.big; e.append(n, mkEl("span", "", c.u)); }
    e.append(mkEl("p", "", c.t)); s.append(e); d.append(mkEl("i"));
  });
  // Zahlen zählen hoch, sobald eine Karte sichtbar ist; die Striche oben zeigen die aktuelle Karte
  const io = new IntersectionObserver(es => {
    for (const x of es) if (x.isIntersecting) {
      const n = x.target.querySelector("b[data-n]"); if (n && !n.dataset.done) { n.dataset.done = 1; countUp(n, +n.dataset.n); }
      const i = [...s.children].indexOf(x.target); [...d.children].forEach((k, q) => k.classList.toggle("on", q <= i));
    }
  }, { root: s, threshold: .6 });
  [...s.children].forEach(c => io.observe(c)); s.scrollLeft = 0;
}
$("rcsh").onclick = async () => {
  if (!rc || !rc.cards) return; toast("Bild wird erstellt…");
  try {
    const W = 1080, Hh = 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = Hh; const x = cv.getContext("2d");
    const g = x.createLinearGradient(0, 0, W, Hh); g.addColorStop(0, "#1e1b4b"); g.addColorStop(.55, "#4c1d95"); g.addColorStop(1, "#9f1239"); x.fillStyle = g; x.fillRect(0, 0, W, Hh);
    for (const [cx, cy, rad, a] of [[900, 200, 380, .1], [120, 1500, 460, .08]]) { x.beginPath(); x.arc(cx, cy, rad, 0, 6.29); x.fillStyle = `rgba(255,255,255,${a})`; x.fill(); }
    await brand(x, W, 80);
    x.fillStyle = "#fff"; x.font = "900 92px system-ui,sans-serif"; x.fillText("Meine Woche", 60, 330);
    x.fillStyle = "rgba(255,255,255,.7)"; x.font = "600 38px system-ui,sans-serif"; x.fillText(user ? "@" + user.name : "", 60, 395);
    const tiles = [["Meldungen", rc.reports], ["Fahrer gewarnt", rc.warned], ["Punkte", rc.points], ["Abzeichen", rc.badges]];
    tiles.forEach(([l, v], i) => {
      const X = 60 + (i % 2) * 495, Y = 480 + Math.floor(i / 2) * 400;
      x.fillStyle = "rgba(255,255,255,.12)"; rr(x, X, Y, 465, 360, 48); x.fill();
      x.fillStyle = "#fff"; x.font = "900 150px system-ui,sans-serif"; x.fillText(String(v), X + 40, Y + 210);
      x.fillStyle = "rgba(255,255,255,.8)"; x.font = "700 38px system-ui,sans-serif"; x.fillText(l, X + 44, Y + 300);
    });
    x.fillStyle = "rgba(255,255,255,.12)"; rr(x, 60, 1300, 960, 300, 48); x.fill();
    x.fillStyle = "rgba(255,255,255,.75)"; x.font = "700 34px system-ui,sans-serif"; x.fillText("MEIN HOTSPOT", 104, 1380);
    x.fillStyle = "#fff"; x.font = "850 72px system-ui,sans-serif"; x.fillText(String(rc.cards[3].bigT).slice(0, 22), 100, 1475);
    x.fillStyle = "rgba(255,255,255,.75)"; x.font = "600 34px system-ui,sans-serif"; x.fillText(rc.weekRank ? "🏆 Platz " + rc.weekRank + " der Woche" : "Gemeinsam sicher unterwegs", 104, 1550);
    x.fillStyle = "rgba(255,255,255,.6)"; x.font = "600 34px system-ui,sans-serif"; x.textAlign = "center"; x.fillText("Mach mit: " + location.host, W / 2, 1800);
    await shareCanvas(cv, "wochenrueckblick.png", "Meine Woche im Polizei-Melder 🚓 " + location.origin);
  } catch { toast("Bild konnte nicht erstellt werden"); }
};

// ---------- Menü-Aktionen und Fenster ----------
Object.assign(MA, {
  badges: () => user ? (ovSet("bdm", true), bdRender()) : need(),
  recap: () => user ? (ovSet("rcm", true), rcRender()) : need(),
  friends: () => user ? (ovSet("frm", true), frRender()) : need(),
  route: () => { ovSet("rtm", true); setTimeout(() => $("rtq").focus(), 450); },
  heat: () => heatToggle(true)
});
for (const [b, id] of [["bdx", "bdm"], ["frx", "frm"], ["rcx", "rcm"], ["rtx", "rtm"]]) $(b).onclick = () => ovSet(id, false);

// ---------- Start ----------
let lastLL = null;
setInterval(() => {
  if (!me) return;
  wxLoad();
  if (LS.get("theme", "auto") === "sun") applyTheme(true);
  if (!lastLL || km(lastLL, me) > 5) { lastLL = me; LS.set("lastll", me.lat.toFixed(3) + "," + me.lng.toFixed(3)); }
}, 20000);
setTimeout(() => { wxLoad(); applyTheme(false); refreshMe(); }, 2500);
setInterval(() => { if (!document.hidden) refreshMe(); }, 60000);
})();
