const CACHE = "morentia-v14";
const CORE = [
  "./", "./index.html", "./css/styles.css", "./js/app.js", "./js/catalog.js", "./js/engine.js",
  "./js/ai.js", "./js/p2p.js", "./js/xlsx.js", "./manifest.webmanifest", "./assets/icon.svg",
  "./assets/art/kalassir.jpg", "./assets/art/aqaba.jpg", "./assets/art/algarie.jpg", "./assets/art/neutral.jpg",
  "./vendor/xlsx.full.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === self.location.origin) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match("./index.html"))));
});
