/* Service worker de Scattergories · estrategia Stale-While-Revalidate.
   - Responde al instante con lo que hay en caché (carga rápida y 100% offline).
   - A la vez descarga la versión del servidor y actualiza la caché en segundo plano.
   - Si index.html ha cambiado, avisa a la página para ofrecer "Recargar".
   No hace falta cambiar ningún número de versión al editar los archivos. */
const CACHE = "tutti-frutti";
const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./fonts/atkinson-400.woff2",
  "./fonts/atkinson-700.woff2",
  "./fonts/bricolage.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  /* Borra cachés antiguas (por ejemplo "tutti-frutti-v1" de la versión anterior). */
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Avisa a la pestaña que se está abriendo. Puede que aún no esté lista, así que lo reintenta un poco. */
async function notifyUpdate(clientId) {
  for (let i = 0; i < 20 && clientId; i++) {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = all.find(x => x.id === clientId);
    if (c) { c.postMessage({ type: "app-updated" }); return; }
    await new Promise(r => setTimeout(r, 250));
  }
  (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage({ type: "app-updated" }));
}

/* Devuelve { response, done }: response sale de la caché al instante (si existe) y
   done termina cuando la copia nueva del servidor ya está guardada. */
async function staleWhileRevalidate(req, key, clientId) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key || req);
  /* Copia para comparar: la respuesta "cached" se entrega al navegador y su contenido se consume. */
  const previous = key && cached ? cached.clone() : null;
  const done = fetch(key || req, { cache: "no-cache" })
    .then(async res => {
      if (res && res.ok && res.type === "basic") {
        /* Para la página, compara con la copia anterior y avisa si ha cambiado. */
        let changed = false;
        if (previous) {
          const [a, b] = await Promise.all([previous.text(), res.clone().text()]);
          changed = a !== b;
        }
        await cache.put(key || req, res.clone());
        if (changed) await notifyUpdate(clientId);
      }
      return res;
    })
    .catch(() => null);
  if (cached) return { response: cached, done };
  const res = await done;
  return { response: res || (key ? await cache.match("./index.html") : Response.error()) || Response.error(), done };
}

function handle(e, key) {
  const work = staleWhileRevalidate(e.request, key, e.resultingClientId || e.clientId);
  e.respondWith(work.then(w => w.response));
  e.waitUntil(work.then(w => w.done));   // el SW sigue vivo hasta terminar de actualizar la caché
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  /* Todas las navegaciones comparten la misma entrada de caché: index.html */
  if (req.mode === "navigate") handle(e, new URL("./index.html", self.registration.scope).href);
  else handle(e);
});
