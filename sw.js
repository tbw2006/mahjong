/**
 * 雅趣麻将 Service Worker：静态资源缓存（stale-while-revalidate）。
 * WebSocket 不在 SW 拦截范围，联机不依赖缓存。
 */
const CACHE = 'mahjong-v1';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/core/protocol.js',
  './src/core/tiles.js',
  './src/core/rules.js',
  './src/core/scoring.js',
  './src/core/engine.js',
  './src/core/bots.js',
  './src/render/renderer.js',
  './src/ui/ui.js',
  './src/ui/audio.js',
  './src/net/network.js',
  './assets/tiles/Back.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
