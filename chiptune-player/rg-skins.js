/* Registro Gamer — skins (visual) do Chiptune Studio e do Tracker.
   A escolha fica no navegador (localStorage "rgSkin") e vale para as duas páginas.
   Só guarda o nome da skin: nenhuma música ou projeto.
   A página diz qual é o seu visual padrão em <html data-skin-default="...">. */
(function () {
  if (window.rgSkins) return;
  var K = 'rgSkin';
  var LIST = [
    ['registro', 'Registro Gamer (verde)', 'Registro Gamer (green)'],
    ['studio', 'Chiptune Studio (azul-roxo)', 'Chiptune Studio (blue-purple)'],
    ['furnace', 'Furnace (original)', 'Furnace (original)'],
    ['famitracker', 'FamiTracker', 'FamiTracker'],
    ['openmpt', 'OpenMPT', 'OpenMPT']
  ];
  var html = document.documentElement;
  var def = html.getAttribute('data-skin-default') || 'registro';
  var fns = [];
  function valid(id) { for (var i = 0; i < LIST.length; i++) if (LIST[i][0] === id) return true; return false; }
  function saved() { try { var v = localStorage.getItem(K) || ''; return valid(v) ? v : ''; } catch (e) { return ''; } }
  function apply(id) { html.setAttribute('data-skin', id); }
  var S = window.rgSkins = {
    list: LIST,
    saved: saved,
    get: function () { return saved() || def; },
    name: function (id) { var en = window.rgI18n && rgI18n.lang === 'en'; for (var i = 0; i < LIST.length; i++) if (LIST[i][0] === id) return LIST[i][en ? 2 : 1]; return id; },
    // fromApp: a troca veio de dentro do Tracker (menu Configurações → skin)
    set: function (id, fromApp) {
      if (!valid(id)) return;
      try { localStorage.setItem(K, id); } catch (e) {}
      apply(id);
      fns.forEach(function (f) { try { f(id, !!fromApp); } catch (e) {} });
    },
    on: function (f) { fns.push(f); },
    // preenche um <select> com as skins
    fill: function (sel) {
      var cur = S.get();
      sel.innerHTML = LIST.map(function (s) { return '<option value="' + s[0] + '">' + S.name(s[0]) + '</option>'; }).join('');
      sel.value = cur;
    }
  };
  apply(S.get());
  // outra aba/página trocou a skin
  window.addEventListener('storage', function (e) { if (e.key === K && valid(e.newValue)) { apply(e.newValue); fns.forEach(function (f) { try { f(e.newValue, false); } catch (x) {} }); } });
})();
