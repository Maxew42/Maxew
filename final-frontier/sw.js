// Final Frontier service worker: cache-first app shell for offline play.
const CACHE = 'final-frontier-v1';
const SHELL = [
  '.', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'js/main.js', 'js/constants.js', 'js/util.js', 'js/parts.js', 'js/rocket.js',
  'js/sim.js', 'js/save.js', 'js/editor.js', 'js/flight.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin (fresh when online), cache fallback offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
