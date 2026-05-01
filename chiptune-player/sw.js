// Service Worker — redireciona /static/ para /Chiptune-Player/static/
// Necessário porque o bundle tem publicPath baked-in como /static/js/

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Intercepta chunks do webpack buscando no path errado
  if (url.match(/niemann333\.github\.io\/static\//)) {
    var newUrl = url.replace(
      'niemann333.github.io/static/',
      'niemann333.github.io/Chiptune-Player/static/'
    );
    event.respondWith(fetch(newUrl));
  }
  // Soundfont e demais recursos: deixa passar normalmente
  // VGZ não precisa de soundfont — erro de soundfont é não-bloqueante
});
