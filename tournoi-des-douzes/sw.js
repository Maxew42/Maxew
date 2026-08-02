// Service worker : réseau d'abord, cache en secours.
//
// Volontairement pas « cache d'abord » : le solo reste jouable hors-ligne, mais
// un rechargement pendant le développement sert toujours la version fraîche.
const CACHE = 'tournoi-des-douzes-v1';

const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png',
  './lib/trystero-nostr.min.js',
  './js/main.js', './js/play.js', './js/board.js', './js/dnd.js',
  './js/session.js', './js/engine.js', './js/rules.js', './js/ai.js',
  './js/cards.js', './js/net.js', './js/util.js',
  ...['alienor', 'background', 'david', 'goliath', 'gontran', 'henriette', 'jeanne',
    'laurent', 'le-pere-pair', 'morgane', 'quasi-maximus', 'rosalie', 'tracassin']
    .map(n => `./cards/${n}.webp`),
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
