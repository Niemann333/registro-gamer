// rg-stats: conta as páginas vistas do blog e do Chiptune Studio (Worker rg-stats no Cloudflare).
// Uso: <script src=".../rg-stats.js" data-site="blog|studio" async></script>
// Ações nos gadgets: window.rgEv('gadget', 'ação', 'item') — antes do script carregar, as chamadas ficam em
// window.rgEvQ (cada gadget define um rgEv provisório que só guarda na fila). Cliques nos gadgets também são
// contados sozinhos (gadget = parte da página onde foi o clique, item = texto do botão/link).
// Nada fica guardado no navegador: a sessão é só desta aba (memória).
(function () {
  if (window.__rgStats) return;
  window.__rgStats = 1;
  // quem pediu para não ser contado (aviso de privacidade → "não contar minhas visitas", ou o sinal
  // Global Privacy Control / Do Not Track do navegador) não manda nada
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
  // ---------- eventos dos gadgets (vão em lotes) ----------
  var evs = [], evTotal = 0, evTimer = 0, ultimoClique = 0;
  function corta(t, n) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function ev(g, a, d) {
    if (!g || !a || evTotal >= 400) return;
    evTotal++;
    evs.push([corta(g, 24), corta(a, 40), corta(d, 200), Date.now()]);
    if (!evTimer) evTimer = setTimeout(function () { evTimer = 0; mandaEventos(false); }, 4000);
  }
  function mandaEventos(beacon) {
    if (!evs.length || !cur || !cur.id) return;
    var agora = Date.now();
    var lote = evs.splice(0, 40).map(function (e) { return [e[0], e[1], e[2], agora - e[3]]; });
    post('/e', { id: cur.id, k: cur.k, ev: lote }, beacon);
    if (evs.length && !evTimer) evTimer = setTimeout(function () { evTimer = 0; mandaEventos(false); }, 1000);
  }
  window.rgEv = function (g, a, d) { ev(g, a, d); };
  (window.rgEvQ || []).forEach(function (x) { ev(x[0], x[1], x[2]); });
  window.rgEvQ = [];
  // cliques: em que gadget e no quê
  var GADGETS = [
    ['#rgcp, #page-chiptune, #ct-app', 'player'], ['#rg-side, #rg-modal-bar, #page-shelf, #game-modal', 'estante'],
    ['#rg-archive, #page-archive', 'arquivo'], ['#rg-labels, #page-tags', 'filtragem'], ['#rg-sw', 'busca'],
    ['#rg-estudio, #nb-estudio', 'studio'], ['#rg-feed, #paginacao-numerada, #rg-lightbox, #page-blog', 'feed'],
    ['.nb, .mnav, #mnav', 'menu']
  ];
  function gadgetDe(el) {
    if (site === 'studio') return /tracker/i.test(location.pathname) ? 'tracker' : 'studio';
    for (var i = 0; i < GADGETS.length; i++) { try { if (el.closest(GADGETS[i][0])) return GADGETS[i][1]; } catch (e) {} }
    return '';
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('a,button,[role=button],li,label,summary,select,input[type=checkbox],input[type=radio],.bcard,[onclick],[data-rg-ev]');
    if (!el) return;
    var g = gadgetDe(el);
    if (!g) return; // (a tela do tracker é um canvas: os cliques nela não entram, só os botões da barra)
    var agora = Date.now();
    if (agora - ultimoClique < 250) return;
    ultimoClique = agora;
    var txt = el.getAttribute('data-rg-ev') || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '';
    ev(g, 'clique', corta(txt, 80));
  }, true);
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
    if (cur) { aviso(true); mandaEventos(true); }
    var v = { s: site, p: pagina(), r: document.referrer && document.referrer.indexOf(location.origin) !== 0 ? document.referrer : '',
      sid: sid, l: navigator.language || '', w: screen.width + 'x' + screen.height, e: embed ? 1 : 0 };
    var me2 = cur = { p: v.p, id: 0, k: '' };
    visT = 0; visDesde = visivel() ? Date.now() : 0;
    var r = post('/v', v);
    if (r && r.then) r.then(function (j) { if (j && j.id && cur === me2) { me2.id = j.id; me2.k = j.k; mandaEventos(false); } });
  }
  document.addEventListener('visibilitychange', function () {
    if (visivel()) { visDesde = Date.now(); }
    else { if (visDesde) { visT += Date.now() - visDesde; visDesde = 0; } aviso(true); mandaEventos(true); }
  });
  window.addEventListener('pagehide', function () { aviso(true); mandaEventos(true); });
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
