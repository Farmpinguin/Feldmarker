// Pabst Precision Farming Kit – Feldmarker (nur Handy, ohne Server)
'use strict';

const CATS = [
  { name: 'Maus', v: '--maus' },
  { name: 'Unkraut', v: '--unkraut' },
  { name: 'Sonstiges', v: '--sonst' }
];
const MAX_ACC = 10;      // m – schlechter: Punkt wird abgelehnt
const GOOD_ACC = 3;      // m – bis hier grün
const MAX_AGE = 5000;    // ms – älterer GPS-Fix gilt als veraltet
const LS_PTS = 'fmh_points', LS_FIELDS = 'fmh_fields', LS_SES = 'fmh_session';

const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = (n, d) => n.toFixed(d).replace('.', ',');
const dayOf = t => new Date(t).toLocaleDateString('sv-SE');   // JJJJ-MM-TT in Ortszeit
const today = () => dayOf(Date.now());
const hm = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } }
let storageWarned = false;
function save(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch (e) {
    if (!storageWarned) { toast('Speicher voll – bitte Felder exportieren und löschen'); storageWarned = true; }
    return false;
  }
}
function uid() {
  try { return crypto.randomUUID(); }
  catch (e) { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
}
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

// Browser bitten, die Daten nicht von selbst zu löschen
try { navigator.storage?.persist?.(); } catch (e) {}

// ------------------------------------------------------------ Zustand
let points = load(LS_PTS, []);          // {uid, sid, cat, lat, lon, acc, t}
let fields = load(LS_FIELDS, []);       // {sid, name, start, ende, exported}
let session = load(LS_SES, null);       // aktuelles Feld {sid, start}
let fix = null, lastKey = null, viewSid = null;

function newSession() {
  session = { sid: uid(), start: Date.now() };
  save(LS_SES, session);
}

function closeSession(name) {
  const own = points.filter(p => p.sid === session.sid);
  let f = null;
  if (own.length) {
    f = { sid: session.sid, name: name || '', start: own[0].t, ende: Date.now(), exported: false };
    fields.unshift(f);
    save(LS_FIELDS, fields);
  }
  newSession();
  return f;
}

if (!session) newSession();
else if (dayOf(session.start) !== today()) {
  // Feld vom Vortag nicht abgeschlossen: ohne Namen abschließen, neu beginnen
  closeSession('');
}

// ------------------------------------------------------------ Sprachausgabe
const LS_VOICE = 'fmh_voice';
let voiceOn = load(LS_VOICE, true);
let deVoice = null;
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    deVoice = vs.find(v => v.lang === 'de-DE' && v.localService) || vs.find(v => v.lang && v.lang.startsWith('de')) || null;
  } catch (e) {}
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

// urgent: laufende Ansage abbrechen (für Punkt-Bestätigungen, damit nichts hinterherhinkt)
function say(text, urgent) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  try {
    if (urgent) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.rate = 1.1; u.volume = 1;
    if (deVoice) u.voice = deVoice;
    speechSynthesis.speak(u);
  } catch (e) {}
}

function renderVoice() {
  const b = $('voice');
  b.textContent = voiceOn ? 'Sprache an' : 'Sprache aus';
  b.classList.toggle('primary', voiceOn);
}

// GPS-Wechsel erst ansagen, wenn der neue Zustand 3 s stabil ist (kein Geplapper beim Wackeln)
const GPS_WORDS = { GUT: 'GPS gut', MITTEL: 'GPS mittel', SCHLECHT: 'GPS schlecht', KEIN: 'Kein GPS' };
let gpsSaid = null, gpsCand = null, gpsCandSince = 0;
function gpsVoiceTick() {
  const t = quality().t;
  if (gpsSaid === null) {                       // erster Fix: einmal ansagen, sobald es GPS gibt
    if (t !== 'KEIN') { gpsSaid = t; say(GPS_WORDS[t] + (t === 'SCHLECHT' ? '' : ', bereit')); }
    return;
  }
  if (t === gpsSaid) { gpsCand = null; return; }
  if (t !== gpsCand) { gpsCand = t; gpsCandSince = Date.now(); return; }
  if (Date.now() - gpsCandSince >= 3000) {
    gpsSaid = t; gpsCand = null;
    say(GPS_WORDS[t]);
  }
}

// ------------------------------------------------------------ GPS
if (!window.isSecureContext) $('https').hidden = false;

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(
    p => {
      fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
      renderGps(); updateMe();
    },
    err => {
      $('coord').textContent = err.code === 1
        ? 'Standort nicht erlaubt – im Browser für diese Seite freigeben'
        : 'Kein GPS-Signal';
      renderGps();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
} else {
  $('coord').textContent = 'Dieser Browser kann kein GPS';
}

function quality() {
  if (!fix || Date.now() - fix.t > MAX_AGE) return { t: 'KEIN', c: '--bad', ok: false, why: 'Kein aktuelles GPS' };
  if (fix.acc <= GOOD_ACC) return { t: 'GUT', c: '--ok', ok: true };
  if (fix.acc <= MAX_ACC) return { t: 'MITTEL', c: '--warn', ok: true };
  return { t: 'SCHLECHT', c: '--bad', ok: false, why: 'GPS zu ungenau – kurz stehen bleiben' };
}

function renderGps() {
  const q = quality();
  $('lamp').textContent = q.t;
  $('lamp').style.background = `var(${q.c})`;
  if (fix) {
    $('acc').innerHTML = `± ${fmt(fix.acc, 1)} <small>m Genauigkeit</small>`;
    $('coord').textContent = `${fix.lat.toFixed(6)}° N · ${fix.lon.toFixed(6)}° O`;
    const s = Math.round((Date.now() - fix.t) / 1000);
    $('age').textContent = s <= 1 ? 'gerade eben' : `vor ${s} s`;
  }
  document.querySelectorAll('.mk').forEach(b => b.classList.toggle('blocked', !q.ok));
  if (lastKey) {
    const s = Math.round((Date.now() - lastKey.t) / 1000);
    $('press').textContent = `Drücker: Taste ${lastKey.k} vor ${s} s`;
  }
}

// ------------------------------------------------------------ Punkte
function todays() { return points.filter(p => p.sid === session.sid).sort((a, b) => a.t - b.t); }
function fieldPoints(sid) { return points.filter(p => p.sid === sid).sort((a, b) => a.t - b.t); }

function addPoint(cat) {
  const q = quality();
  if (!q.ok) {
    buzz([500, 150, 500]);                 // langes Doppel-Brummen = nicht gesetzt
    toast(q.why);
    say(q.t === 'KEIN' ? 'Kein GPS. Nicht markiert' : 'GPS zu ungenau. Nicht markiert', true);
    return { ok: false, short: q.t === 'KEIN' ? 'KEIN GPS' : 'GPS SCHLECHT' };
  }
  const p = { uid: uid(), sid: session.sid, cat, lat: fix.lat, lon: fix.lon, acc: Math.round(fix.acc * 10) / 10, t: Date.now() };
  points.push(p);
  save(LS_PTS, points);
  viewSid = null;
  const b = $('b' + (cat + 1));
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  buzz(cat === 0 ? 120 : cat === 1 ? [90, 90, 90] : [90, 90, 90, 90, 90]);
  toast(`${CATS[cat].name} gesetzt (± ${fmt(p.acc, 1)} m)`);
  say(`${CATS[cat].name} markiert`, true);
  renderPoints();
  return { ok: true };
}

function undo() {
  const list = todays();
  const p = list[list.length - 1];
  if (!p) { toast('Keine Punkte zum Löschen'); say('Keine Punkte zum Löschen', true); return false; }
  points = points.filter(x => x.uid !== p.uid);
  save(LS_PTS, points);
  buzz(400);
  toast(`${CATS[p.cat].name}-Punkt gelöscht`);
  say(`${CATS[p.cat].name} gelöscht`, true);
  renderPoints();
  return true;
}

function renderPoints() {
  const list = todays();
  [0, 1, 2].forEach(c => $('c' + c).textContent = list.filter(p => p.cat === c).length);
  const ul = $('list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li><span></span><span class="t">Noch keine Punkte – Taste drücken</span><span></span></li>';
  }
  list.slice(-8).reverse().forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="sw" style="background:var(${CATS[p.cat].v})"></span>`
      + `<span>${CATS[p.cat].name} <span class="t">± ${fmt(p.acc, 1)} m</span></span>`
      + `<span class="t">${new Date(p.t).toLocaleTimeString('de-DE')}</span>`;
    ul.appendChild(li);
  });
  renderMapHead();
  drawMarkers();
  renderFields();
  renderState();
}

function renderState() {
  const n = fields.filter(f => !f.exported).length;
  const el = $('state');
  el.classList.toggle('pending', n > 0);
  el.textContent = n > 0 ? `${n} ${n === 1 ? 'Feld' : 'Felder'} nicht exportiert` : 'Alles exportiert';
}

// ------------------------------------------------------------ Abgeschlossene Felder
let armedDelete = null;

function renderFields() {
  const ul = $('fields');
  ul.innerHTML = '';
  if (!fields.length) {
    ul.innerHTML = '<li><span class="t">Noch keine abgeschlossenen Felder</span></li>';
    return;
  }
  fields.forEach(f => {
    const pts = fieldPoints(f.sid);
    const n = c => pts.filter(p => p.cat === c).length;
    const datum = new Date(f.start).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="fhead"><b></b><span class="badge ${f.exported ? 'ok' : ''}">${f.exported ? 'exportiert' : 'nicht exportiert'}</span></div>
      <div class="t">${datum} · ${hm(f.start)}–${hm(f.ende)} · Maus ${n(0)} · Unkraut ${n(1)} · Sonstiges ${n(2)}</div>
      <div class="factions">
        <button class="sec primary" data-a="share">Exportieren</button>
        <button class="sec" data-a="view">Karte</button>
        <button class="sec ${armedDelete === f.sid ? 'danger' : ''}" data-a="del">${armedDelete === f.sid ? 'Wirklich löschen?' : 'Löschen'}</button>
      </div>`;
    li.querySelector('b').textContent = f.name || 'Feld ohne Namen';
    li.querySelector('[data-a="share"]').addEventListener('click', () => exportField(f));
    li.querySelector('[data-a="view"]').addEventListener('click', () => {
      viewSid = f.sid; renderMapHead(); drawMarkers(true);
      $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    li.querySelector('[data-a="del"]').addEventListener('click', () => deleteField(f));
    ul.appendChild(li);
  });
}

function deleteField(f) {
  if (armedDelete !== f.sid) {
    armedDelete = f.sid;
    if (!f.exported) toast('Achtung: Dieses Feld ist noch nicht exportiert');
    renderFields();
    setTimeout(() => { if (armedDelete === f.sid) { armedDelete = null; renderFields(); } }, 4000);
    return;
  }
  armedDelete = null;
  fields = fields.filter(x => x.sid !== f.sid);
  points = points.filter(p => p.sid !== f.sid);
  save(LS_FIELDS, fields); save(LS_PTS, points);
  if (viewSid === f.sid) viewSid = null;
  toast(`${f.name || 'Feld'} gelöscht`);
  renderPoints();
}

async function exportField(f) {
  const pts = fieldPoints(f.sid);
  if (!pts.length) { toast('Dieses Feld hat keine Punkte'); return; }
  const kind = $('fmt').value;
  const base = `feldmarker_${FMExport.safeName(f.name || 'feld')}_${dayOf(f.start)}`;
  let file;
  if (kind === 'csv') file = new File([FMExport.csv(pts, f.name)], base + '.csv', { type: 'text/csv' });
  else if (kind === 'geojson') file = new File([FMExport.geojson(pts, f.name)], base + '.geojson', { type: 'application/geo+json' });
  else file = new File([FMExport.shapefileZip(pts, f.name, base)], base + '_shp.zip', { type: 'application/zip' });

  let done = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      done = true;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;      // Teilen abgebrochen
  }
  if (!done) {
    // Dateityp lässt sich nicht teilen (z. B. ZIP): in den Download-Ordner speichern
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${file.name} in „Downloads“ gespeichert`);
  }
  f.exported = true;
  save(LS_FIELDS, fields);
  renderFields(); renderState();
}

// ------------------------------------------------------------ Karte
let map = null, markerLayer = null, meDot = null, meCircle = null, follow = true, followTimer;
if (window.L) {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([48.5, 11.5], 6);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, maxNativeZoom: 19, attribution: 'Luftbild © Esri' }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => {
    follow = false;
    clearTimeout(followTimer);
    followTimer = setTimeout(() => { follow = true; updateMe(); }, 30000);
  });
} else {
  $('map').innerHTML = '<p class="t" style="padding:14px">Die Karte braucht beim ersten Öffnen Internet. Punkte setzen geht trotzdem.</p>';
  $('map').style.height = 'auto';
}

function renderMapHead() {
  if (viewSid) {
    const f = fields.find(x => x.sid === viewSid);
    const n = fieldPoints(viewSid).length;
    $('mapTitle').textContent = f ? (f.name || 'Feld ohne Namen') : 'Feld';
    $('total').textContent = `${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
    $('viewNote').hidden = false;
  } else {
    const n = todays().length;
    $('mapTitle').textContent = 'Aktuelles Feld';
    $('total').textContent = `seit ${hm(session.start)} · ${n} ${n === 1 ? 'Punkt' : 'Punkte'}`;
    $('viewNote').hidden = true;
  }
}

function drawMarkers(fit) {
  if (!markerLayer) return;
  markerLayer.clearLayers();
  const pts = viewSid ? fieldPoints(viewSid) : todays();
  pts.forEach(p => {
    L.circleMarker([p.lat, p.lon], {
      radius: 7, weight: 2, color: '#fff', fillColor: css(CATS[p.cat].v), fillOpacity: 1
    }).bindTooltip(`${CATS[p.cat].name} · ${new Date(p.t).toLocaleTimeString('de-DE')}`).addTo(markerLayer);
  });
  if (fit && pts.length) {
    follow = false;
    clearTimeout(followTimer);
    map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 19 });
  }
}

let firstFix = true;
function updateMe() {
  if (!map || !fix) return;
  const ll = [fix.lat, fix.lon];
  if (!meDot) {
    meCircle = L.circle(ll, { radius: fix.acc, weight: 1, color: '#1e88e5', fillOpacity: .12 }).addTo(map);
    meDot = L.circleMarker(ll, { radius: 7, weight: 3, color: '#fff', fillColor: '#1e88e5', fillOpacity: 1 }).addTo(map);
  } else {
    meDot.setLatLng(ll); meCircle.setLatLng(ll); meCircle.setRadius(fix.acc);
  }
  if (firstFix) { map.setView(ll, 18); firstFix = false; }
  else if (follow && !viewSid) map.panTo(ll, { animate: false });
}

$('viewBack').addEventListener('click', () => {
  viewSid = null; follow = true; renderMapHead(); drawMarkers(); updateMe();
});

// ------------------------------------------------------------ Drücker (Web Bluetooth)
const SVC_UUID  = 'a7c1f000-7f3e-4b8e-9c1a-5046464b4d01';
const BTN_UUID  = 'a7c1f000-7f3e-4b8e-9c1a-5046464b4d02';
const STAT_UUID = 'a7c1f000-7f3e-4b8e-9c1a-5046464b4d03';
const enc = new TextEncoder();
let bleDev = null, bleStat = null, bleBusy = false, lastSeq = -1;
let bleChain = Promise.resolve(), lastStatus = '', lastStatusAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setBle(state, text) {
  const b = $('ble');
  b.textContent = text;
  b.classList.toggle('primary', state === 'ok');
}

function bleSend(s) {
  const ch = bleStat;
  if (!ch) return;
  bleChain = bleChain.then(() =>
    (ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(enc.encode(s)) : ch.writeValue(enc.encode(s)))
  ).catch(() => {});
}

function statusString() {
  const q = quality();
  const list = todays();
  const n = c => list.filter(p => p.cat === c).length;
  const acc10 = fix && q.t !== 'KEIN' ? Math.round(fix.acc * 10) : -1;
  const qc = { GUT: 'G', MITTEL: 'M', SCHLECHT: 'S', KEIN: 'K' }[q.t];
  return `S${acc10};${qc};${n(0)};${n(1)};${n(2)};0`;
}

function bleStatusTick() {
  if (!bleStat) return;
  const s = statusString();
  if (s !== lastStatus || Date.now() - lastStatusAt > 2500) {
    bleSend(s); lastStatus = s; lastStatusAt = Date.now();
  }
}

function onDruecker(code) {
  lastKey = { k: code, t: Date.now() };
  if (code === 'u') {
    bleSend(undo() ? 'FU' : 'F!NICHTS DA');
  } else if ('123'.includes(code)) {
    const r = addPoint(+code - 1);
    bleSend(r.ok ? 'F' + code : 'F!' + r.short);
  }
  lastStatus = '';
  bleStatusTick();
  renderGps();
}

async function bleConnect(dev) {
  if (bleDev !== dev) {
    bleDev = dev;
    dev.addEventListener('gattserverdisconnected', onBleLost);
  }
  setBle('wait', 'Drücker verbindet…');
  const srv = await dev.gatt.connect();
  const svc = await srv.getPrimaryService(SVC_UUID);
  const btn = await svc.getCharacteristic(BTN_UUID);
  bleStat = await svc.getCharacteristic(STAT_UUID);
  btn.addEventListener('characteristicvaluechanged', e => {
    const v = e.target.value;
    if (v.byteLength < 2) return;
    const s = v.getUint8(0);
    if (s === lastSeq) return;
    lastSeq = s;
    onDruecker(String.fromCharCode(v.getUint8(1)));
  });
  await btn.startNotifications();
  setBle('ok', 'Drücker verbunden');
  say('Drücker verbunden');
  lastStatus = '';
  bleStatusTick();
}

async function onBleLost() {
  bleStat = null;
  if (bleBusy) return;
  bleBusy = true;
  setBle('wait', 'Drücker getrennt – verbinde neu…');
  say('Drücker getrennt');
  buzz([200, 100, 200, 100, 200]);
  for (let i = 0; i < 120 && bleDev && !bleDev.gatt.connected; i++) {
    try { await bleConnect(bleDev); bleBusy = false; return; }
    catch (e) { await sleep(Math.min(2000 + i * 1000, 10000)); }
  }
  bleBusy = false;
  setBle('off', 'Drücker verbinden');
}

$('ble').addEventListener('click', async () => {
  if (!navigator.bluetooth) { toast('Bluetooth geht nur in Chrome und nur über https'); return; }
  if (bleDev && bleDev.gatt.connected) { toast('Drücker ist verbunden'); return; }
  try {
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [SVC_UUID] }] });
    await bleConnect(dev);
  } catch (e) {
    if (e.name !== 'NotFoundError') toast('Verbinden hat nicht geklappt – Drücker an?');
    setBle('off', 'Drücker verbinden');
  }
});

(async () => {
  try {
    if (!navigator.bluetooth?.getDevices) return;
    const devs = await navigator.bluetooth.getDevices();
    const dev = devs.find(d => (d.name || '').includes('Feldmarker')) || devs[0];
    if (!dev) return;
    bleDev = dev;
    dev.addEventListener('gattserverdisconnected', onBleLost);
    await bleConnect(dev);
  } catch (e) {
    if (bleDev) onBleLost(); else setBle('off', 'Drücker verbinden');
  }
})();

setInterval(bleStatusTick, 1000);

// ------------------------------------------------------------ Bedienung
document.querySelectorAll('.mk').forEach(b => b.addEventListener('click', () => addPoint(+b.dataset.cat)));
$('undo').addEventListener('click', undo);

$('close').addEventListener('click', () => {
  const list = todays();
  if (!list.length) { toast('Im aktuellen Feld sind noch keine Punkte'); return; }
  const n = c => list.filter(p => p.cat === c).length;
  $('closeSum').textContent = `Maus ${n(0)} · Unkraut ${n(1)} · Sonstiges ${n(2)}`;
  $('fieldName').value = '';
  $('closePanel').hidden = false;
  $('closePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('closeCancel').addEventListener('click', () => { $('closePanel').hidden = true; });

function finishField(andExport) {
  const name = $('fieldName').value.trim();
  const f = closeSession(name);
  $('closePanel').hidden = true;
  $('fieldName').blur();
  buzz([60, 60, 300]);
  lastStatus = '';
  viewSid = null;
  renderPoints();
  if (f) say(`Feld ${name} abgeschlossen. Neues Feld beginnt`.replace('  ', ' '));
  if (f && andExport) exportField(f);
  else toast(`${name ? '„' + name + '“' : 'Feld'} abgeschlossen – neues Feld läuft`);
}
$('closeShare').addEventListener('click', () => finishField(true));
$('closeOnly').addEventListener('click', () => finishField(false));
$('fieldName').addEventListener('keydown', e => { if (e.key === 'Enter') finishField(true); });

document.addEventListener('keydown', e => {
  if (e.repeat || e.target.matches('input, select, textarea')) return;
  const keys = { '1': 0, '2': 1, '3': 2 };
  if (e.key in keys) {
    lastKey = { k: e.key, t: Date.now() }; addPoint(keys[e.key]); e.preventDefault();
  } else if (e.key === 'u' || e.key === 'U') {
    lastKey = { k: 'u', t: Date.now() }; undo(); e.preventDefault();
  }
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 2500);
}

// Display wach halten
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen'); }
  catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
keepAwake();
setInterval(renderGps, 1000);
setInterval(gpsVoiceTick, 1000);

$('voice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  save(LS_VOICE, voiceOn);
  renderVoice();
  if (voiceOn) say('Sprachausgabe an', true);
  else try { speechSynthesis.cancel(); } catch (e) {}
});
renderVoice();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderPoints();
renderGps();
