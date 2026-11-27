// rg-stats: conta as páginas vistas do blog e do Chiptune Studio (Worker rg-stats no Cloudflare).
// Uso: <script src=".../rg-stats.js" data-site="blog|studio" async></script>
// Nada fica guardado no navegador: a sessão é só desta aba (memória).
(function () {
  if (window.__rgStats) return;
  window.__rgStats = 1;
  var API = 'https://rg-stats.luciano-333-games.workers.dev';
  var me = document.currentScript;
  var site = (me && me.getAttribute('data-site')) || 'blog';
  var sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  // dentro do blog (outro domínio) = embutido; dentro do link curto (mesmo domínio) não conta como embutido
  var embed = false;
  if (window.parent !== window) { try { embed = !window.parent.location.href; } catch (e) { embed = true; } }
  var cur = null, visT = 0, visDesde = 0, timer = 0;

  function post(path, obj, beacon) {
    var body = JSON.stringify(obj);
    try {
      if (beacon && navigator.sendBeacon) return navigator.sendBeacon(API + path, new Blob([body], { type: 'text/plain' }));
      return fetch(API + path, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit' })
        .then(function (r) { return r.json(); }).catch(function () {});
    } catch (e) {}
  }
  function visivel() { return document.visibilityState === 'visible'; }
  // tempo visível acumulado desde o último aviso
  function tomaTempo() {
    var t = visT;
    if (visDesde) { var n = Date.now(); t += n - visDesde; visDesde = n; }
    visT = 0;
    return t;
  }
  function aviso(beacon) {
    if (!cur || !cur.id) return;
    var t = tomaTempo();
    post('/p', { id: cur.id, k: cur.k, t: t }, beacon);
  }
  function pagina() {
    var p = location.pathname + location.search;
    if (site === 'studio') p = location.pathname.split('/').pop() || 'estudio.html';
    return p.slice(0, 300);
  }
  function nova() {
    if (cur) aviso(true);
    var v = { s: site, p: pagina(), r: document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : '',
      sid: sid, l: navigator.language || '', w: screen.width + 'x' + screen.height, e: embed ? 1 : 0 };
    var me2 = cur = { p: v.p, id: 0, k: '' };
    visT = 0; visDesde = visivel() ? Date.now() : 0;
    var r = post('/v', v);
    if (r && r.then) r.then(function (j) { if (j && j.id && cur === me2) { me2.id = j.id; me2.k = j.k; } });
  }
  document.addEventListener('visibilitychange', function () {
    if (visivel()) { visDesde = Date.now(); }
    else { if (visDesde) { visT += Date.now() - visDesde; visDesde = 0; } aviso(true); }
  });
  window.addEventListener('pagehide', function () { aviso(true); });
  timer = setInterval(function () { if (visivel()) aviso(false); }, 30000);
  // navegação sem recarregar (o Feed do blog troca o endereço com pushState)
  var last = location.pathname + location.search;
  function mudou() {
    var now = location.pathname + location.search;
    if (now !== last) { last = now; nova(); }
  }
  ['pushState'].forEach(function (k) {
    var o = history[k];
    if (!o) return;
    history[k] = function () { var r = o.apply(this, arguments); setTimeout(mudou, 0); return r; };
  });
  window.addEventListener('popstate', function () { setTimeout(mudou, 0); });
  nova();
})();
