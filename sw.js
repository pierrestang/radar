// Radar — service worker : app utilisable hors ligne, mises à jour récupérées en priorité.
const CACHE = 'radar-v36';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'shared/ics.js', 'shared/gist.js', 'shared/translate.js', 'vendor/ical.min.js', 'fond.js', 'polices/Newsreader.woff2', 'manifest.webmanifest', 'icons/icon-64.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API GitHub : jamais en cache
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
