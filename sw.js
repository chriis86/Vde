// Service Worker: speichert die App auf dem Handy, damit sie ohne Internet startet.
const VERSION = "vde-v10";
const DATEIEN = ["./", "index.html", "jsQR.js", "qrcode.js", "drucker.js", "speicher.js", "nativ.js", "jspdf.umd.min.js", "protokoll.js",
                 "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSION).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
// Erst Netz versuchen (für Updates), sonst gespeicherte Version
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then(r => {
    const kopie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, kopie)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
