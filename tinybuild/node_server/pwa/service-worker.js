const assets = __TINYBUILD_ASSETS__;
const version = __TINYBUILD_VERSION__;
const prefix = "tinybuild-" + self.registration.scope + "-";
const cacheName = prefix + version;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(assets))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(prefix) && key !== cacheName)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        if (
          response.ok &&
          assets.includes(new URL(event.request.url).pathname)
        ) {
          const cache = await caches.open(cacheName);
          await cache.put(event.request, response.clone());
        }
        return response;
      })
      .catch(
        async () =>
          (await caches.match(event.request)) ||
          (event.request.mode === "navigate" &&
            (await caches.match(
              assets.find((asset) => asset.endsWith(".html")) || "/",
            ))) ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
  );
});
