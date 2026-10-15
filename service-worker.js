const CACHE_NAME = "ganadero-v3";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./app.js"
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
