// v5 - força reinstalação
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (url.indexOf('niemann333.github.io/static/') !== -1) {
    event.respondWith(fetch(url.replace(
      'niemann333.github.io/static/',
      'niemann333.github.io/registro-gamer/chiptune-player/static/'
    )));
  }
});
