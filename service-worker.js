const CACHE_NAME = "jira-solidtime-hub-v1";
const ASSETS = [
  "./",
  "./dashboard.html",
  "./kpi.html",
  "./styles.css",
  "./health-widget.js",
  "./health_widget.js",
  "./enhancements/dashboard-enhancements.css",
  "./enhancements/shortcut-manager.js",
  "./enhancements/dashboard-enhancements.js",
  "./enhancements/print.css",
  "./dashboard_dataset.csv"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
