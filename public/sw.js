const CACHE = 'day-and-life-v3';
const ASSETS = ['/', '/css/base.css', '/css/app.css', '/js/config.js', '/js/api.js', '/js/state.js', '/js/views.js', '/js/drag.js', '/js/modal.js', '/js/stats.js', '/js/settings.js', '/js/main.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls: network only
  if (url.pathname.startsWith('/api/')) return;
  // Assets: cache first, fallback network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});
