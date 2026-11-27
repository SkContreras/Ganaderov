import {runBackgroundDelivery} from "./sync/background-universal.mjs";

const CACHE_NAME = "ganadero-v67";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./ganaderov-icon.svg",
  "./ranch-cover.svg",
  "./config.js",
  "./app.js",
  "./ui/photo-framing.mjs",
  "./sync/incremental-v1.mjs",
  "./sync/pull-v1.mjs",
  "./sync/local-crypto.mjs",
  "./sync/protected-store.mjs",
  "./sync/photo-outbox.mjs",
  "./sync/universal-outbox.mjs",
  "./sync/background-universal.mjs",
  "./sync/legacy-recovery.mjs",
  "./sync/conflict-resolution.mjs",
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
  const staticUrls = new Set(APP_FILES.map(path => new URL(path,self.registration.scope).href));
  if (request.headers.has("Authorization") || request.headers.has("apikey")) return;
  if (!staticUrls.has(url.href) && url.href !== SUPABASE_SCRIPT) return;
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


// A page may refresh its canonical snapshot after headless delivery. General
// Auth tokens never cross this channel or enter the worker's IndexedDB registry.
function wakeClient(client) {
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const finish=status=>{clearTimeout(timer);channel.port1.close();resolve(status);};
    const timer=setTimeout(()=>finish("deferred"),25000);
    channel.port1.onmessage=event=>finish(["drained","disabled","deferred"].includes(event.data?.status)?event.data.status:"deferred");
    try{client.postMessage({type:"GANADEROV_SYNC_WAKE_V1"},[channel.port2]);}
    catch(_){channel.port2.close();finish("deferred");}
  });
}
self.addEventListener("sync", event => {
  if (event.tag !== "ganaderov-event-outbox-v1") return;
  event.waitUntil((async () => {
    // This processor opens the encrypted universal queue itself. It does not
    // require an open tab; its limited capability is checked by the server for
    // every operation and can be revoked independently of an Auth access token.
    const delivery = await runBackgroundDelivery();
    const windows = await self.clients.matchAll({type:"window"});
    const statuses=await Promise.all(windows.map(wakeClient));
    if(delivery.status === "retry") throw new Error("Background delivery retained for retry");
    // Expired/revoked grants wait for a newly verified foreground session.
    if(delivery.status === "paused") return;
    if(windows.length && !statuses.includes("drained") &&
       !statuses.every(s=>s==="disabled") && delivery.status !== "drained") {
      throw new Error("Delivery deferred");
    }
  })());
});
