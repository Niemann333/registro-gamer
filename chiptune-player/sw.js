// Service Worker — redireciona /static/ para /registro-gamer/chiptune-player/static/
// Necessário porque o bundle tem publicPath baked-in como /static/js/

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  if (url.match(/niemann333\.github\.io\/static\//)) {
    var newUrl = url.replace(
      'niemann333.github.io/static/',
      'niemann333.github.io/registro-gamer/chiptune-player/static/'
    );
    event.respondWith(fetch(newUrl));
  }
});
