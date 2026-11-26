const CACHE_NAME = "ganadero-v49";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./ganaderov-icon.svg",
  "./ranch-cover.svg",
  "./config.js",
  "./app.js",
  "./login-scene.js",
  "./confirmar-correo.html",
  "./confirmar-correo.css",
  "./confirmar-correo.js",
  "./privacidad.html",
  "./terminos.html",
  "./eliminar-datos.html",
  "./legal.css"
];
const SUPABASE_SCRIPT = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    try {
      await cache.add(SUPABASE_SCRIPT);
    } catch (error) {
      console.warn("No se pudo guardar la biblioteca de sincronización para uso sin conexión.", error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("ganadero-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const request = event.request;
  const url = new URL(request.url);
  // Authentication and recovery query strings must not enter the offline cache.
  if (url.origin === self.location.origin && url.search) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (new URL(request.url).origin === self.location.origin) {
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    }
    if (request.url !== SUPABASE_SCRIPT) return fetch(request);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});


// A wake signal only: never persist tokens or send ranch operations from a
// worker without a verified authenticated session. Closed pages retain outbox.
self.addEventListener("sync", event => {
  if (event.tag !== "ganaderov-event-outbox-v1") return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:"window"});
    for (const client of windows) client.postMessage({type:"GANADEROV_SYNC_WAKE_V1"});
  })());
});
