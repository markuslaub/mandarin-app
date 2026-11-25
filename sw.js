/* Service Worker: App-Hülle offline, Pakete aus dem Paket-Cache */
var SHELL = 'mandarin-app-v1', PAKETE = 'mandarin-pakete-v1';
var FILES = ['./', 'index.html', 'app.js', 'dsp.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('mandarin-app-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/pakete/') >= 0 && !/katalog\.json$/.test(url.pathname)) {
    // Paketdateien: nur aus dem Cache, sonst Netz (Laden)
    e.respondWith(caches.open(PAKETE).then(function (c) { return c.match(e.request, { ignoreSearch: true }).then(function (r) { return r || fetch(e.request); }); }));
    return;
  }
  // Katalog und App-Hülle: Netz zuerst, bei Offline aus dem Cache
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok && !/katalog\.json$/.test(url.pathname)) { var cp = r.clone(); caches.open(SHELL).then(function (c) { c.put(e.request, cp); }); }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); }));
});
