// sw.js — FUDE offline shell. Build-free static app → runtime caching, no precache
// manifest. After one online visit everything (code + the medians/index JSON) is cached,
// so it works fully offline. Asset freshness rides on the cache-bust ?v= token (new build
// → new URLs → cache miss → fetched fresh). Bump CACHE to evict everything on a SW change.
const CACHE = 'fude-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html']).catch(() => {})));
  // do NOT skipWaiting here — let the page show an update toast (see main.js)
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // HTML navigations: network-first (fresh build), fall back to cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const pre = await e.preloadResponse;
        if (pre) { caches.open(CACHE).then((c) => c.put(req, pre.clone())); return pre; }
        const net = await fetch(req);
        caches.open(CACHE).then((c) => c.put(req, net.clone()));
        return net;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  // assets, versioned data, fonts: cache-first (URLs are ?v=-fingerprinted / immutable)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const net = await fetch(req);
      if (net.ok || net.type === 'opaque') caches.open(CACHE).then((c) => c.put(req, net.clone()));
      return net;
    } catch {
      return hit || Response.error();
    }
  })());
});
