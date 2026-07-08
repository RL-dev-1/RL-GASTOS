// Bumpear en cada deploy que toque rl-gastos.html (o cualquier asset
// precacheado). El browser sólo detecta una versión nueva del SW si el
// contenido de ESTE archivo cambia — si sólo se edita rl-gastos.html y no se
// bumpea CACHE_VERSION acá, el cache-first de abajo sigue sirviendo la
// versión vieja indefinidamente.
const CACHE_VERSION = 'v4';
const CACHE_NAME = 'rl-gastos-' + CACHE_VERSION;

const PRECACHE = [
  '/rl-gastos.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: precache core assets. No hace skipWaiting acá — espera al mensaje
// SKIP_WAITING explícito de rl-gastos.html para no recargar de golpe otras
// pestañas abiertas a mitad de un registro.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
  );
});

// Mensaje desde rl-gastos.html cuando detecta un SW nuevo instalado: recién
// ahí se activa, para no interrumpir pestañas con trabajo en curso.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activate: remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin, network-first for Google Fonts
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Google Fonts: network-first, fallback to cache
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/rl-gastos.html'));
    })
  );
});
