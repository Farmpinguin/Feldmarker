// Feldmarker (nur Handy) – Service Worker
// Mit Netz: immer die neueste Version von GitHub holen (am Browser-Cache vorbei).
// Ohne Netz: aus dem eigenen Speicher – die App läuft dann komplett offline.
const CACHE = 'feldmarker-handy-v5';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'export.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'
];
const LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([
    ...FILES.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})),
    ...LIBS.map(u => c.add(u).catch(() => {}))
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.includes('arcgisonline')) return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {        // Leaflet: Speicher zuerst
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }

  // eigene Dateien: Netz zuerst (max. 3 s), sonst Speicher
  e.respondWith(caches.open(CACHE).then(async c => {
    try {
      const r = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(3000)]);
      if (r.ok) c.put(req, r.clone());
      return r;
    } catch (err) {
      return (await c.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? c.match('./') : Response.error());
    }
  }));
});
