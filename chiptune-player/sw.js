// v9 - serve novo chip-core.wasm do soltune
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
  // Redireciona qualquer chip-core*.wasm para o novo soltune
  if (url.indexOf('chip-core') !== -1 && url.indexOf('.wasm') !== -1) {
    var wasmUrl = 'https://niemann333.github.io/registro-gamer/chiptune-player/chip-core.wasm';
    event.respondWith(fetch(wasmUrl, { mode: 'cors', credentials: 'omit' }));
    return;
  }
  if (url.indexOf('chiptune.app/') !== -1) {
    event.respondWith(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    return;
  }
});
