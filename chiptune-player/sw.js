// Service worker desativado (v10). O player novo (player.html) não precisa dele.
// Esta versão só se remove, para não interferir nos arquivos do player.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.unregister());
});
