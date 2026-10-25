// Service worker: legger appens filer i hurtigbuffer slik at den virker uten nett etter første innlasting.
// Brukerdata ligger i IndexedDB og påvirkes ikke av denne.
const VERSION = 'hvv-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/store.js', 'js/ui.js', 'js/qr.js', 'js/ai.js', 'js/items.js', 'js/places.js', 'js/ops.js', 'js/demo.js',
  'vendor/qrcode.js', 'vendor/jsQR.js', 'vendor/jspdf.umd.min.js', 'vendor/anthropic.mjs',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Nett først for appfilene (så oppdateringer kommer raskt), hurtigbuffer når nettet mangler.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
