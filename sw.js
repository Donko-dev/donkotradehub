/* DONKO TRADE HUB : service worker. Réseau d'abord, cache seulement hors ligne. Jamais de données de compte en cache. */
const CACHE = "donko-trade-hub-v6";
const SHELL = [
  "./index.html", "./dashboard.html", "./manifest.json",
  "./site.css", "./vitrine.js", "./i18n.js", "./app.js", "./robots.js",
  "./donko.png", "./icon-192.png", "./icon-512.png", "./favicon-64.png",
  "./logo-donko-trade-hub.png", "./logo-donko-syntix.jpg", "./logo-donko-gold.jpg",
  "./logo-donko-forex.jpg", "./logo-donko-crypto.jpg",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.includes("/api/")) return;
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
