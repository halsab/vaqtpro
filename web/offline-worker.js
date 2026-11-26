const CACHE_NAME = 'vaqtpro-offline-v1';
const CACHE_PREFIX = 'vaqtpro-offline-';
const STATIC_FILE = /\.(?:css|ico|js|json|otf|png|svg|ttf|wasm|webmanifest)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const scope = self.registration.scope;
      await Promise.allSettled([
        cache.add(new URL('./', scope)),
        cache.add(new URL('assets/assets/geonames/places.json', scope)),
      ]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    (request.mode !== 'navigate' && !STATIC_FILE.test(url.pathname))
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (_) {
        return (await cache.match(request, { ignoreSearch: true })) ??
          Response.error();
      }
    })(),
  );
});
