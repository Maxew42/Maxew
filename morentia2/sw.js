// Service worker : réseau d'abord, cache en secours.
//
// Volontairement pas « cache d'abord » : la table reste jouable hors-ligne,
// mais un rechargement pendant la mise au point sert toujours la version
// fraîche des règles et des cartes.
const CACHE = 'morentia-v1';

const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './lib/trystero-nostr.min.js', './lib/xlsx.full.min.js',
  './js/main.js',
  './js/data/schema.js', './js/data/catalog.js', './js/data/catalog-io.js',
  './js/data/catalog-default.js', './js/data/zip.js',
  './js/rules/constants.js', './js/rules/events.js', './js/rules/state.js',
  './js/rules/registry.js', './js/rules/engine.js', './js/rules/flow.js',
  './js/rules/effects/index.js', './js/rules/effects/helpers.js',
  './js/rules/effects/kalassir.js', './js/rules/effects/aqaba.js',
  './js/rules/effects/algarie.js', './js/rules/effects/market.js',
  './js/rules/effects/special.js', './js/rules/effects/places.js',
  './js/ui/card.js', './js/ui/art.js', './js/ui/board.js',
  './js/ui/anim.js', './js/ui/dnd.js', './js/ui/studio.js',
  './js/ai/ai.js', './js/net/net.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || caches.match('./index.html'))),
  );
});
