// v8 - intercepta soundfonts do gifx.co e redireciona para GitHub
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  // Redireciona bundle estático
  if (url.indexOf('niemann333.github.io/static/') !== -1) {
    event.respondWith(fetch(url.replace(
      'niemann333.github.io/static/',
      'niemann333.github.io/registro-gamer/chiptune-player/static/'
    )));
    return;
  }
  // Redireciona soundfonts do gifx.co para nosso GitHub
  if (url.indexOf('gifx.co/soundfonts/') !== -1 || url.indexOf('/soundfonts/') !== -1) {
    var filename = url.split('/').pop();
    var localUrl = 'https://niemann333.github.io/registro-gamer/chiptune-player/soundfonts/' + filename;
    event.respondWith(
      fetch(localUrl, { mode: 'cors', credentials: 'omit' })
        .catch(function() {
          return new Response('', { status: 404 });
        })
    );
    return;
  }
  // Bloqueia chiptune.app silenciosamente (falha por CORS)
  if (url.indexOf('chiptune.app/') !== -1) {
    event.respondWith(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    return;
  }
});
