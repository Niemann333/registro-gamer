/* =====================================================================
 * Registro Gamer — Player único de chiptunes
 *
 * Roda dentro do iframe do gadget (player.html). Uma única página e um
 * único AudioContext para todos os formatos:
 *   • Chip Player JS (chip-core.wasm): VGM/VGZ, SPC, NSF, GBS, AY, MOD/S3M/XM/IT, SID, MIDI
 *   • Players de Juergen Wothke: PSF (PS1), GSF (GBA), USF (N64), 2SF (DS), KSS (MSX)
 *   • ASAP: SAP (Atari 8-bit)
 *
 * O áudio dos motores próprios passa por um buffer de ~1 s (AudioWorklet):
 * se a página engasgar por um instante, o som continua saindo do buffer.
 * O ritmo de renderização é ditado pelo próprio áudio (não por timers),
 * então continua funcionando com a aba em segundo plano / tela apagada.
 *
 * Protocolo (gadget → player):
 *   load {url, loops, sub}   pause   resume   seek {ms}   volume {level}
 *   voicemask {mask}   subtune {index}   loops {count}   stop
 *   mediainfo {title, artist, album}   ms-state {state}
 * Respostas (player → gadget):
 *   ready   loaded {...}   position {posMs, durMs}   visdata {osc, fft}
 *   ended   error {msg}   ms-action {action}
 * ===================================================================== */
(function () {
  'use strict';

  var BASE = location.href.split('?')[0].replace(/[^\/]*$/, '');
  self.RG_PLAYER_BASE = BASE;
  window.WASM_SEARCH_PATH = BASE;

  // O player de MIDI tenta abrir dispositivos MIDI do computador; não é necessário aqui
  try {
    var noMidi = function () {
      var empty = { size: 0, forEach: function () {}, get: function () {}, has: function () { return false; },
                    keys: function () { return [][Symbol.iterator](); }, values: function () { return [][Symbol.iterator](); },
                    entries: function () { return [][Symbol.iterator](); } };
      return Promise.resolve({ inputs: empty, outputs: empty, onstatechange: null, sysexEnabled: false });
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: noMidi, configurable: true, writable: true });
  } catch (e) {}

  var SR = 44100;
  var CHUNK = 4096;                 // quadros por bloco renderizado
  var AHEAD = Math.round(SR * 1.0); // manter ~1 s pronto no buffer
  var FADE_MS = 5000;
  var SILENCE_END_MS = 4000;        // silêncio contínuo (depois de já ter tocado) que encerra a faixa
  var NOSOUND_END_MS = 15000;       // faixa que nunca soou
  var DEFAULT_LEN_MS = 180000;      // duração padrão quando o arquivo não informa

  var EXT_CHIP = /\.(vgm|vgz|gym|spc|nsf|nsfe|gbs|ay|mod|s3m|xm|it|mptm|sid|mid|midi|smf)$/i;
  var EXT_WOTHKE = {
    psx: /\.(psf|minipsf|psf2|minipsf2)$/i,
    gsf: /\.(gsf|minigsf)$/i,
    n64: /\.(usf|miniusf)$/i,
    ds:  /\.(2sf|mini2sf)$/i,
    nez: /\.kss$/i
  };
  var EXT_SAP = /\.sap$/i;
  var EXT_AHX = /\.(ahx|thx)$/i;
  var EXT_OMPT = /\.mptm$/i;                 // OpenMPT: só o libopenmpt toca certo (tempo moderno, swing...)
  var EXT_MOD_FALLBACK = /\.(mod|s3m|xm|it)$/i; // se o libxmp não abrir, tenta o libopenmpt

  // ───────────────────────── utilidades ─────────────────────────
  function send(m) { try { parent.postMessage(m, '*'); } catch (e) {} }
  var statusEl = null;
  function status(t, cls) {
    if (!statusEl) statusEl = document.getElementById('status');
    if (statusEl) { statusEl.textContent = t; statusEl.className = cls || ''; }
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
  }
  function fileName(url) {
    var n = String(url).split('?')[0].split('/').pop();
    try { n = decodeURIComponent(n); } catch (e) {}
    return n;
  }
  function parseTime(s) {        // "1:23.5" | "83" | "83.5" → ms
    if (s == null || s === '') return 0;
    s = String(s).trim();
    var p = s.split(':'), t = 0;
    for (var i = 0; i < p.length; i++) t = t * 60 + (parseFloat(p[i].replace(',', '.')) || 0);
    return Math.round(t * 1000);
  }

  // ───────────────────────── áudio ─────────────────────────
  var ctx = null, bus = null, fadeGain = null, volGain = null, limiter = null, analyser = null;
  var volume = 1;
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    try { ctx = new AC({ sampleRate: SR, latencyHint: 'playback' }); }
    catch (e) { ctx = new AC(); }
    SR = ctx.sampleRate;
    AHEAD = Math.round(SR * 1.0);
    window._gPlayerAudioCtx = ctx;            // os players do Wothke usam este mesmo contexto
    bus = ctx.createGain();                    // entrada comum de todos os motores
    fadeGain = ctx.createGain();               // fade-out do fim da faixa
    volGain = ctx.createGain();                // volume do gadget (inclui o auto volume)
    volGain.gain.value = volume;
    limiter = ctx.createWaveShaper();          // limitador suave: linear até 0.8
    var N = 4096, curve = new Float32Array(N);
    for (var k = 0; k < N; k++) {
      var x = k * 2 / (N - 1) - 1, ax = Math.abs(x), T = 0.8;
      var y = ax <= T ? ax : T + (1 - T) * Math.tanh((ax - T) / (1 - T));
      curve[k] = x < 0 ? -y : y;
    }
    limiter.curve = curve; limiter.oversample = '2x';
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;
    bus.connect(fadeGain); fadeGain.connect(volGain); volGain.connect(limiter); limiter.connect(ctx.destination);
    // O analisador mede o som ANTES do volume: o auto volume do gadget precisa do nível original da música
    // (se medisse depois, ele "corrigiria" o próprio ganho e o volume que você escolheu)
    fadeGain.connect(analyser);
    return ctx;
  }
  function resumeCtx() { try { if (ctx && ctx.state !== 'running') ctx.resume(); } catch (e) {} }
  function setVolume(v) {
    volume = Math.max(0, Math.min(4, v));
    if (!volGain) return;
    try { volGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.04); } catch (e) { volGain.gain.value = volume; }
  }
  function setFade(v, secs) {
    if (!fadeGain) return;
    try {
      fadeGain.gain.cancelScheduledValues(ctx.currentTime);
      fadeGain.gain.setValueAtTime(fadeGain.gain.value, ctx.currentTime);
      if (secs > 0) fadeGain.gain.linearRampToValueAtTime(v, ctx.currentTime + secs);
      else fadeGain.gain.setValueAtTime(v, ctx.currentTime);
    } catch (e) { fadeGain.gain.value = v; }
  }

  // ───────────────────────── visualizador ─────────────────────────
  var visTimer = null;
  var oscBuf = null, fftBuf = null;
  function startVis() {
    if (visTimer) return;
    visTimer = setInterval(function () {
      if (!analyser || !ctx || ctx.state !== 'running' || document.hidden) return;
      if (!oscBuf) { oscBuf = new Uint8Array(analyser.fftSize); fftBuf = new Float32Array(analyser.frequencyBinCount); }
      analyser.getByteTimeDomainData(oscBuf);
      analyser.getFloatFrequencyData(fftBuf);
      var osc = new Uint8Array(256), fft = new Float32Array(128);
      var st = Math.floor(oscBuf.length / 256);
      for (var i = 0; i < 256; i++) osc[i] = oscBuf[i * st];
      for (var j = 0; j < 128; j++) fft[j] = fftBuf[Math.floor(j * fftBuf.length / 128)];
      send({ type: 'visdata', osc: osc, fft: fft });
    }, 33);
  }

  // ───────────────────────── buffer (worklet) ─────────────────────────
  var ring = { node: null, sp: null, gen: 0, rendered: 0, played: 0, ready: false, pending: null };
  function ensureRing() {
    if (ring.ready) return Promise.resolve();
    if (ring.pending) return ring.pending;
    ensureCtx();
    ring.pending = (ctx.audioWorklet ? ctx.audioWorklet.addModule(BASE + 'rg-worklet.js') : Promise.reject(new Error('sem worklet')))
      .then(function () {
        ring.node = new AudioWorkletNode(ctx, 'rg-ring', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        ring.node.port.onmessage = function (e) {
          var m = e.data;
          if (m.t !== 'st' || m.gen !== ring.gen) return;
          ring.played = m.played; ring.under = m.under;
          pump();
        };
        ring.node.connect(bus);
        ring.ready = true;
      })
      .catch(function () {
        // Navegador sem AudioWorklet: ScriptProcessor com buffer grande
        var q = [], qi = 0;
        ring.sp = ctx.createScriptProcessor(8192, 0, 2);
        ring.fallbackQueue = q;
        ring.sp.onaudioprocess = function (ev) {
          var l = ev.outputBuffer.getChannelData(0), r = ev.outputBuffer.getChannelData(1);
          var n = l.length, i = 0;
          while (i < n && q.length) {
            var c = q[0], take = Math.min(n - i, c.l.length - qi);
            l.set(c.l.subarray(qi, qi + take), i); r.set(c.r.subarray(qi, qi + take), i);
            i += take; qi += take; ring.played += take;
            if (qi >= c.l.length) { q.shift(); qi = 0; }
          }
          for (; i < n; i++) { l[i] = 0; r[i] = 0; }
          pump();
        };
        ring.flushFallback = function () { q.length = 0; qi = 0; };
        ring.sp.connect(bus);
        ring.ready = true;
      });
    return ring.pending;
  }
  function ringFlush() {
    ring.gen++; ring.rendered = 0; ring.played = 0;
    if (ring.node) ring.node.port.postMessage({ t: 'flush', gen: ring.gen });
    if (ring.flushFallback) ring.flushFallback();
  }
  function ringPush(l, r) {
    ring.rendered += l.length;
    if (ring.node) ring.node.port.postMessage({ t: 'data', gen: ring.gen, l: l, r: r }, [l.buffer, r.buffer]);
    else if (ring.fallbackQueue) ring.fallbackQueue.push({ l: l, r: r });
  }

  // ───────────────────────── estado da faixa ─────────────────────────
  // ───────────────────────── mapa de loops (loops.json) ─────────────────────────
  // Para NSF/GBS/SID/KSS/SAP o loop não vem no arquivo: ele foi medido antes
  // (tools/rgloop), observando os comandos enviados ao chip quadro a quadro.
  //   "Chiptunes/.../jogo.nsf": { "3": [introMs, loopMs], "7": [fimMs] }
  var loopMap = null, loopMapPromise = null;
  function loadLoopMap() {
    if (!loopMapPromise) {
      loopMapPromise = fetch(BASE + 'loops.json').then(function (r) { return r.ok ? r.json() : {}; })
        .catch(function () { return {}; })
        .then(function (j) { loopMap = j || {}; return loopMap; });
    }
    return loopMapPromise;
  }
  function loopInfoFor(url, sub) {
    if (!loopMap) return null;
    var u = String(url || '');
    try { u = decodeURIComponent(u); } catch (e) {}
    u = u.split('?')[0];
    var i = u.indexOf('Chiptunes/');
    if (i < 0) return null;
    var e = loopMap[u.slice(i)];
    var v = e && e[String(sub || 0)];
    return (v && v.length) ? v : null;
  }
  // índice que o mapa usa: o do player (SID: a música que está tocando de fato)
  function loopSubOf(engine, sub) {
    if (engine.cls === 'SIDPlayer') { try { return engine.subtune(); } catch (e) {} }
    return sub || 0;
  }

  var cur = null;        // { engine, url, loops, endFrame, ended, ... }
  var loadToken = 0;
  var lastPosSent = 0;
  var voiceMuted = false;

  function newTrackState(engine, url, loops) {
    return {
      engine: engine, url: url, loops: loops, token: loadToken,
      endFrame: -1, endedSent: false, heard: false, silentMs: 0, renderedMs: 0,
      fading: false, fadeStartPos: 0, posAtRender: 0, durMs: 0, ownDuration: false
    };
  }

  // Renderiza blocos até ter ~1 s pronto no buffer
  function pump() {
    var t = cur;
    if (!t || t.engine.kind !== 'ring' || t.endFrame >= 0) { checkRingEnd(); return; }
    if (t.engine.seeking && t.engine.seeking()) {   // ainda avançando até o ponto pedido
      if (!pump.espera) pump.espera = setTimeout(function () { pump.espera = 0; pump(); }, 30);
      return;
    }
    var guard = 0;
    while (!t.switching && ring.rendered - ring.played < AHEAD && guard++ < 16) {
      var l = new Float32Array(CHUNK), r = new Float32Array(CHUNK);
      var res;
      try { res = t.engine.render(l, r, CHUNK); }
      catch (e) { console.error(e); res = { ended: true }; }
      // VGM/SAP: posição pelo próprio relógio (o motor volta a contar do início do loop)
      t.clockMs = (t.clockMs || 0) + CHUNK / SR * 1000;
      var pos = t.ownDuration ? t.clockMs : t.engine.posMs();
      t.posAtRender = pos;
      // Fim por duração (VGM/SAP com loops, arquivos sem fim próprio)
      if (t.ownDuration && t.durMs > 0 && !t.fading && pos >= t.durMs) { t.fading = true; t.fadeStartPos = pos; }
      if (t.fading) {
        var fm = t.fadeMs || FADE_MS;
        var g0 = 1 - (pos - t.fadeStartPos) / fm;
        var g1 = 1 - (pos + CHUNK / SR * 1000 - t.fadeStartPos) / fm;
        for (var i = 0; i < CHUNK; i++) { var gg = g0 + (g1 - g0) * i / CHUNK; gg = gg < 0 ? 0 : gg; l[i] *= gg; r[i] *= gg; }
        if (g1 <= 0) res = { ended: true };
      }
      // Detecção de silêncio (faixas que terminam antes da duração informada)
      var s = 0;
      for (var k = 0; k < CHUNK; k += 4) s += l[k] * l[k] + r[k] * r[k];
      var silent = Math.sqrt(s / (CHUNK / 2)) < 0.0008;
      var ms = CHUNK / SR * 1000;
      t.renderedMs += ms;
      if (!silent) { t.heard = true; t.silentMs = 0; } else t.silentMs += ms;
      // KSS: muitas faixas do arquivo são mudas — pula para a próxima que tiver som
      if (t.engine.type === 'nez' && !t.overrideMs && !t.loopInfo && !t.heard && t.renderedMs > 2500 && t.engine.subtune() < 60) {
        ringPush(l, r);
        t.switching = true;
        Promise.resolve(t.engine.playSubtune(t.engine.subtune() + 1)).then(function () {
          t.switching = false; t.heard = false; t.renderedMs = 0; t.silentMs = 0; t.clockMs = 0;
          if (t === cur) pump();
        });
        break;
      }
      if (!voiceMuted && !t.fading) {
        if (t.heard && t.silentMs >= SILENCE_END_MS) res = { ended: true };
        if (!t.heard && t.renderedMs >= NOSOUND_END_MS) res = { ended: true };
      }
      ringPush(l, r);
      if (res && res.ended) { t.endFrame = ring.rendered; break; }
    }
    reportPosition();
    checkRingEnd();
  }
  function checkRingEnd() {
    var t = cur;
    if (!t || t.engine.kind !== 'ring' || t.endFrame < 0 || t.endedSent) return;
    if (ring.played >= t.endFrame) { t.endedSent = true; status('Fim', ''); send({ type: 'ended' }); }
  }
  function playedPosMs() {
    var t = cur; if (!t) return 0;
    if (t.engine.kind === 'ring') {
      var lagMs = (ring.rendered - ring.played) / SR * 1000;
      return Math.max(0, t.posAtRender - lagMs);
    }
    return t.engine.posMs();
  }
  function reportPosition(force) {
    var now = Date.now();
    if (!force && now - lastPosSent < 240) return;
    lastPosSent = now;
    var t = cur; if (!t) return;
    var pos = playedPosMs();
    if (t.endedSent) pos = Math.max(pos, t.durMs);
    send({ type: 'position', posMs: Math.round(pos), durMs: Math.round(t.reportDurMs || 0) });
  }

  // ───────────────────────── motor: Chip Player JS ─────────────────────────
  var chipCorePromise = null, chipPlayersPromise = null, chipInstances = {};
  function loadChipCore() {
    if (chipCorePromise) return chipCorePromise;
    var mods = {};
    var q = self.webpackChunkchip_player_js = self.webpackChunkchip_player_js || [];
    var origPush = q.push.bind(q);
    q.push = function (chunk) { var m = chunk[1]; for (var k in m) mods[k] = m[k]; return origPush(chunk); };
    chipCorePromise = loadScript(BASE + 'rg-core.js').then(function () {
      var req = function (id) {
        if (String(id) === '7584') return 'rg-core.wasm';
        var f = mods[id]; if (!f) return {};
        var mod = { exports: {} }; f(mod, mod.exports, req); return mod.exports;
      };
      req.d = function (ex, defs) { for (var k in defs) Object.defineProperty(ex, k, { enumerable: true, get: defs[k] }); };
      req.p = BASE; req.b = document.baseURI;
      var mod = { exports: {} };
      mods[2859](mod, mod.exports, req);
      return mod.exports.default({
        locateFile: function () { return BASE + 'rg-core.wasm'; },
        print: function () {}, printErr: function () {}
      });
    }).then(function (core) {
      // Funções que a versão atual dos players chama mas este chip-core.wasm não tem
      ['_lvgm_set_enhanced_stereo', '_lvgm_set_indefinite_playback', '_n64_set_indefinite_playback'].forEach(function (f) {
        if (typeof core[f] !== 'function') core[f] = function () { return 0; };
      });
      // Este chip-core.wasm renderiza o VGM em blocos fixos de 2048 quadros por chamada:
      // chama quantas vezes forem necessárias para encher o bloco pedido (CHUNK é múltiplo de 2048)
      var origLvgm = core._lvgm_render;
      core._lvgm_render = function (c, b, frames) {
        var done = 0, guard = 0;
        while (done < frames && guard++ < 64) {
          var r = origLvgm.call(core, c, b + done * 8, frames - done);
          if (!r || r <= 0) break;
          done += Math.floor(r / 8);
        }
        return done * 8;
      };
      // MOD/XM/IT: quantas vezes o módulo repete antes de terminar (botão loops)
      var origXmp = core._xmp_play_buffer;
      core._xmp_play_buffer = function (c, b, s, loop) { return origXmp.call(core, c, b, s, (cur && cur.loops) || 1); };
      return core;
    });
    return chipCorePromise;
  }
  function loadChipPlayers() {
    if (!chipPlayersPromise) chipPlayersPromise = loadScript(BASE + 'chip-players.js').then(function () { return self.RGChipPlayers; });
    return chipPlayersPromise;
  }
  function chipClassFor(ext) {
    if (/^(vgm|vgz|gym)$/.test(ext)) return 'VGMPlayer';
    if (/^(spc|nsf|nsfe|gbs|ay)$/.test(ext)) return 'GMEPlayer';
    if (/^(mod|s3m|xm|it|mptm)$/.test(ext)) return 'XMPPlayer';
    if (ext === 'sid') return 'SIDPlayer';
    return 'MIDIPlayer';
  }
  function readVgmHeader(u8) {
    try {
      var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      if (dv.getUint32(0, true) !== 0x206d6756) return null;
      var tot = dv.getUint32(0x18, true), lo = dv.getUint32(0x1C, true), ls = dv.getUint32(0x20, true);
      var has = lo > 0 && ls > 0;
      return { hasLoop: has, totalMs: tot / 44.1, introMs: Math.max(0, (tot - ls) / 44.1), loopMs: ls / 44.1 };
    } catch (e) { return null; }
  }
  function gunzipIfNeeded(u8) {
    if (u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
      var st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(st).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    return Promise.resolve(u8);
  }

  function makeChipEngine(core, P, cls, ext) {
    var key = cls;
    var player = chipInstances[key];
    if (!player) {
      player = new P[cls](core, SR, CHUNK, false);
      chipInstances[key] = player;
      // Os players às vezes suspendem o AudioContext durante operações pesadas; aqui não é preciso
      player.audioNode = { context: { state: 'closed' } };
      if (cls === 'SIDPlayer') player.getSidMetadata = function () {};   // sem servidor de durações
    }
    var st = { ended: false };
    // Quem decide a próxima faixa é o gadget: o player só avisa que terminou
    player.handleSongEnd = function () { st.ended = true; };
    var vgm = null, sidData = null, sidPath = '', sidSong = 0;
    // SID: o motor só toca a "música inicial" do cabeçalho (trocar de música depois de
    // carregar não funciona). Então a música escolhida vira a inicial e o arquivo é recarregado.
    function sidWithSong(data, i) {
      var d = new Uint8Array(data);
      var magic = String.fromCharCode(d[0], d[1], d[2], d[3]);
      if ((magic === 'PSID' || magic === 'RSID') && d.length > 0x11) {
        var n = (d[0x0E] << 8) | d[0x0F];
        var song = Math.max(1, Math.min(n || 1, i + 1));
        d[0x10] = song >> 8; d[0x11] = song & 0xFF;
      }
      return d;
    }
    var eng = {
      kind: 'ring', player: player, cls: cls,
      load: function (data, path, url, sub) {
        st.ended = false;
        if (cls === 'SIDPlayer') { sidData = data; sidPath = path; sidSong = sub || 0; data = sidWithSong(data, sidSong); }
        var r = player.loadData(data, path, {});
        return Promise.resolve(r).then(function () {
          if (cls === 'VGMPlayer') {
            return gunzipIfNeeded(data).then(function (raw) { vgm = readVgmHeader(raw); });
          }
        });
      },
      render: function (l, r, n) {
        if (st.ended) { l.fill(0); r.fill(0); return { ended: true }; }
        player.processAudio([l, r]);
        if (cls === 'MIDIPlayer') { for (var i = 0; i < n; i++) { l[i] *= 4; r[i] *= 4; } }   // o sintetizador de MIDI sai bem baixo (+12 dB)
        return { ended: st.ended };
      },
      posMs: function () { try { return player.getPositionMs() || 0; } catch (e) { return 0; } },
      durInfo: function (loops) {
        if (cls === 'VGMPlayer' && vgm) {
          var d = vgm.hasLoop ? vgm.introMs + vgm.loopMs * loops : vgm.totalMs;
          return { durMs: d, own: vgm.hasLoop, report: d + (vgm.hasLoop ? FADE_MS : 0),
                   hasLoop: vgm.hasLoop, introMs: vgm.introMs, loopMs: vgm.loopMs, totalMs: vgm.totalMs };
        }
        var dd = 0; try { dd = player.getDurationMs() || 0; } catch (e) {}
        var fade = (cls === 'GMEPlayer') ? FADE_MS : 0;
        if (cls === 'XMPPlayer') dd = dd * loops;
        if (!dd || dd <= 0) dd = 0;
        return { durMs: dd, own: false, report: dd ? dd + fade : 0 };
      },
      seek: function (ms) {
        try { player.seekMs(ms); } catch (e) {}
        // O motor original avança o SPC só quando o navegador está "ocioso" (requestIdleCallback),
        // o que numa página cheia pode levar segundos. Aqui o avanço é feito direto, em fatias
        // curtas (sem travar a página), até chegar no ponto pedido.
        if (cls === 'GMEPlayer' && player.seekTargetMs != null && player.core && player.gmeCtx) {
          try { cancelIdleCallback(player.seekRequestId); } catch (e) {}
          var core = player.core, alvo = player.seekTargetMs, id = {};
          st.seekId = id;
          var pos = 0; try { pos = player.getPositionMs() || 0; } catch (e) {}
          (function passo() {
            if (st.seekId !== id || player.seekTargetMs !== alvo) return;   // outro seek ou outra faixa
            var t0 = Date.now();
            try {
              while (Date.now() - t0 < 30) {
                pos = Math.min(pos + 5000, alvo);
                core._gme_seek_scaled(player.gmeCtx, pos);
                if (pos >= alvo) {
                  core._gme_set_tempo(player.gmeCtx, player.tempo || 1);
                  player.seekTargetMs = null; player.seekRequestId = null;
                  return;
                }
              }
            } catch (e) { player.seekTargetMs = null; return; }
            setTimeout(passo, 0);
          })();
        }
      },
      // SPC (Super Nintendo) não tem como pular direto: o motor avança a música em blocos
      // e, enquanto isso, toca em velocidade dobrada. Aqui o som fica parado até chegar
      // no ponto escolhido, e a música continua de lá em velocidade normal.
      seeking: function () { return cls === 'GMEPlayer' && player.seekTargetMs != null; },
      voices: function () {
        var mask = [], names = [], groups = [];
        try { mask = (player.getVoiceMask() || []).slice(); } catch (e) {}
        try { groups = player.getVoiceGroups() || []; } catch (e) {}
        if (groups.length) {
          var n = 0; groups.forEach(function (g) { g.voices.forEach(function (v) { names[v.idx] = v.name; n = Math.max(n, v.idx + 1); }); });
          mask = mask.slice(0, n);
        } else {
          for (var i = 0; i < mask.length; i++) { try { names.push(player.getVoiceName(i) || ('Ch ' + (i + 1))); } catch (e) { names.push('Ch ' + (i + 1)); } }
        }
        return { names: names, mask: mask, groups: groups };
      },
      setVoiceMask: function (m) {
        try {
          var full = (player.getVoiceMask() || []).slice();
          for (var i = 0; i < m.length && i < full.length; i++) full[i] = !!m[i];
          player.setVoiceMask(full.length ? full : m);
        } catch (e) {}
      },
      numSubtunes: function () { try { return player.getNumSubtunes() || 1; } catch (e) { return 1; } },
      subtune: function () { try { return player.getSubtune() || 0; } catch (e) { return 0; } },
      playSubtune: function (i) {
        st.ended = false;
        if (cls === 'SIDPlayer') { if (i === sidSong) return; sidSong = i; try { player.loadData(sidWithSong(sidData, i), sidPath, {}); } catch (e) {} return; }
        try { player.playSubtune(i); } catch (e) {}
      },
      title: function () { try { var m = player.getMetadata(); return m && (m.title || ''); } catch (e) { return ''; } },
      stop: function () { st.ended = true; try { player.stop(); } catch (e) {} }
    };
    return eng;
  }

  // ───────────────────────── motor: ASAP (SAP) ─────────────────────────
  var asapModPromise = null;
  function makeSapEngine() {
    if (!asapModPromise) asapModPromise = import(BASE + 'asap.js');
    var asap = null, mod = null, info = null, song = 0, buf = null, chans = 1, posMs = 0;
    return {
      kind: 'ring',
      load: function (data, path) {
        return asapModPromise.then(function (m) {
          mod = m; asap = new m.ASAP();
          asap.load(fileName(path), data, data.length);
          info = asap.getInfo(); chans = info.getChannels();
          song = info.getDefaultSong();
          asap.playSong(song, -1);
        });
      },
      render: function (l, r, n) {
        if (!buf || buf.length < n * chans * 2) buf = new Uint8Array(n * chans * 2);
        var got = asap.generate(buf, n * chans * 2, mod.ASAPSampleFormat.S16_L_E);
        var frames = Math.floor(got / (2 * chans));
        var dv = new DataView(buf.buffer);
        for (var i = 0; i < frames; i++) {
          var a = dv.getInt16(i * chans * 2, true) / 32768;
          var b = chans > 1 ? dv.getInt16(i * chans * 2 + 2, true) / 32768 : a;
          l[i] = a; r[i] = b;
        }
        for (var j = frames; j < n; j++) { l[j] = 0; r[j] = 0; }
        return { ended: frames < n };
      },
      posMs: function () { try { return asap.getPosition(); } catch (e) { return 0; } },
      durInfo: function (loops) {
        var d = -1, lp = false;
        try { d = info.getDuration(song); lp = info.getLoop(song); } catch (e) {}
        if (d <= 0) return { durMs: DEFAULT_LEN_MS, own: true, report: DEFAULT_LEN_MS + FADE_MS };
        var dd = lp ? d * loops : d;
        return { durMs: dd, own: true, report: dd + (lp ? FADE_MS : 0), hasLoop: lp };
      },
      seek: function (ms) { try { asap.seek(ms); } catch (e) {} },
      voices: function () {
        var n = chans === 2 ? 8 : 4, names = [], mask = [];
        for (var i = 0; i < n; i++) { names.push('Ch ' + (i + 1)); mask.push(true); }
        return { names: names, mask: mask, groups: [{ name: 'POKEY', voices: names.map(function (x, i) { return { idx: i, name: x }; }) }] };
      },
      setVoiceMask: function (m) {
        var bits = 0; for (var i = 0; i < m.length; i++) if (!m[i]) bits |= (1 << i);
        try { asap.mutePokeyChannels(bits & 0xFF); } catch (e) {}
      },
      numSubtunes: function () { try { return info.getSongs(); } catch (e) { return 1; } },
      subtune: function () { return song; },
      durations: function () { var a = []; try { for (var i = 0; i < info.getSongs(); i++) a.push(info.getDuration(i)); } catch (e) {} return a; },
      playSubtune: function (i) { song = i; try { asap.playSong(i, -1); } catch (e) {} },
      title: function () { try { return info.getTitle() || ''; } catch (e) { return ''; } },
      stop: function () {}
    };
  }

  // ───────────────────────── motor: AHX (Amiga, Abyss' Highest eXperience) ─────────────────────────
  // O replayer (ahx.js) só calcula o estado dos 4 canais a cada quadro do Amiga (50 Hz);
  // a mistura é feita aqui, em estéreo como no Amiga (canais 1 e 4 à esquerda, 2 e 3 à direita,
  // com um pouco de cada lado para não cansar no fone).
  var ahxPromise = null;
  function loadAhx() {
    if (!ahxPromise) ahxPromise = loadScript(BASE + 'ahx.js?v=1');
    return ahxPromise;
  }
  function makeAhxEngine() {
    var song = null, pl = null, frameLen = 0, fl = null, fr = null, fill = 0, fpos = 0;
    var pos = [0, 0, 0, 0], mask = [true, true, true, true], irqs = 0, info = null;
    var PAN = [0.8, 0.2, 0.2, 0.8];           // parte que vai para a esquerda, por canal
    var waves = null;
    function novoPlayer() {
      var p = AHXPlayer(waves); p.InitSong(song); p.InitSubsong(0); return p;
    }
    function irqMs() { return 20 / (song.SpeedMultiplier || 1); }
    // Simula a música sem gerar som para achar a introdução e o tamanho do loop
    function medir() {
      var p = novoPlayer(), n = 0, max = Math.round(15 * 60 * 1000 / irqMs()), loopIrq = -1;
      var restart = song.Restart || 0;
      while (n < max) {
        if (loopIrq < 0 && p.PosNr === restart && p.NoteNr === 0 && p.GetNewPosition) loopIrq = n;
        p.PlayIRQ(); n++;
        if (p.SongEndReached) break;
      }
      var total = n * irqMs();
      if (n >= max || total <= 0) return { durMs: DEFAULT_LEN_MS, hasLoop: false, introMs: 0, loopMs: 0, totalMs: DEFAULT_LEN_MS };
      var intro = loopIrq > 0 ? loopIrq * irqMs() : 0;
      return { hasLoop: true, introMs: intro, loopMs: Math.max(1, total - intro), totalMs: total };
    }
    function quadro() {          // gera 1 quadro do Amiga (1/50 s) em fl/fr
      var per = Math.floor(frameLen / song.SpeedMultiplier), k = 0;
      for (var i = 0; i < frameLen; i++) { fl[i] = 0; fr[i] = 0; }
      for (var f = 0; f < song.SpeedMultiplier; f++) {
        pl.PlayIRQ(); irqs++;
        var n = (f === song.SpeedMultiplier - 1) ? frameLen - k : per;
        for (var v = 0; v < 4; v++) {
          var vo = pl.Voices[v], vol = vo.VoiceVolume, prd = vo.VoicePeriod, buf = vo.VoiceBuffer;
          if (!vol || !prd || !mask[v] || !buf || !buf.length) continue;
          var delta = Math.floor(3579545.25 / prd * 65536 / SR), p = pos[v], lim = buf.length << 16;
          var gl = PAN[v] * vol / 64, gr = (1 - PAN[v]) * vol / 64;
          for (var i = 0; i < n; i++) {
            if (p >= lim) p -= lim;
            var smp = buf[p >> 16] | 0;
            fl[k + i] += smp * gl; fr[k + i] += smp * gr;
            p += delta;
          }
          pos[v] = p;
        }
        k += n;
      }
      for (var j = 0; j < frameLen; j++) { fl[j] /= 320; fr[j] /= 320; }   // folga para não estourar
      fill = frameLen; fpos = 0;
    }
    return {
      kind: 'ring',
      load: function (data) {
        var str = '';
        for (var i = 0; i < data.length; i += 8192) str += String.fromCharCode.apply(null, data.subarray(i, i + 8192));
        var ds = new dataType(); ds.data = str;
        song = new AHXSong(); song.InitSong(ds);
        if (!song.PositionNr || !song.Positions.length) throw new Error('AHX inválido');
        waves = waves || new AHXWaves();
        pl = novoPlayer();
        frameLen = Math.round(SR / 50); fl = new Float32Array(frameLen); fr = new Float32Array(frameLen);
        fill = 0; fpos = 0; irqs = 0; pos = [0, 0, 0, 0];
        info = medir();
      },
      render: function (l, r, n) {
        for (var i = 0; i < n; i++) {
          if (fpos >= fill) quadro();
          l[i] = fl[fpos]; r[i] = fr[fpos]; fpos++;
        }
        return { ended: false };
      },
      posMs: function () { return irqs * irqMs(); },
      durInfo: function (loops) {
        if (!info.hasLoop) return { durMs: info.durMs, own: true, report: info.durMs + FADE_MS };
        var d = info.introMs + info.loopMs * loops;
        return { durMs: d, own: true, report: d + FADE_MS, hasLoop: true, introMs: info.introMs, loopMs: info.loopMs, totalMs: info.totalMs };
      },
      seek: function (ms) {          // AHX é leve: refaz do começo sem gerar som até o ponto pedido
        pl = novoPlayer(); irqs = 0; pos = [0, 0, 0, 0]; fill = 0; fpos = 0;
        var alvo = Math.floor(Math.max(0, ms) / irqMs());
        while (irqs < alvo) { pl.PlayIRQ(); irqs++; }
      },
      voices: function () {
        var names = ['Ch 1', 'Ch 2', 'Ch 3', 'Ch 4'];
        return { names: names, mask: mask.slice(), groups: [{ name: 'Paula (AHX)', voices: names.map(function (x, i) { return { idx: i, name: x }; }) }] };
      },
      setVoiceMask: function (m) { for (var i = 0; i < 4; i++) mask[i] = m[i] !== false; },
      numSubtunes: function () { return 1; },
      subtune: function () { return 0; },
      durations: function () { return [info ? (info.hasLoop ? info.introMs + info.loopMs : info.durMs) : 0]; },
      playSubtune: function () {},
      title: function () { return (song && song.Name) || ''; },
      stop: function () {}
    };
  }

  // ───────────────────────── motor: libopenmpt (MPTM e módulos que o libxmp não abre) ─────────────────────────
  // libopenmpt.js é o build WebAssembly do libopenmpt do pacote chiptune3 (DrSnuggles, licença MIT).
  var omptPromise = null;
  function loadOmpt() {
    if (!omptPromise) {
      // import() montado em tempo de execução: navegadores antigos (TVs) que não conhecem import()
      // continuam lendo este arquivo normalmente; só o MPTM deixa de tocar neles.
      var importar;
      try { importar = new Function('u', 'return import(u)'); } catch (e) { return Promise.reject(e); }
      omptPromise = importar(BASE + 'libopenmpt.js?v=1').then(function (m) { return m.default(); })
        .catch(function (e) { omptPromise = null; throw e; });
    }
    return omptPromise;
  }
  function makeOmptEngine(lib) {
    var mod = 0, pL = 0, pR = 0, cap = 0, posSmp = 0, durS = 0, introS = 0, ended = false, loopsSet = -1;
    function cstr(txt) { var n = lib.lengthBytesUTF8(txt) + 1, p = lib._malloc(n); lib.stringToUTF8(txt, p, n); return p; }
    function meta(k) {
      try { var kp = cstr(k), rp = lib._openmpt_module_get_metadata(mod, kp); lib._free(kp);
        var t = rp ? lib.UTF8ToString(rp) : ''; if (rp) lib._openmpt_free_string(rp); return t; } catch (e) { return ''; }
    }
    function liberar() {
      if (mod) { try { lib._openmpt_module_destroy(mod); } catch (e) {} mod = 0; }
      if (pL) { lib._free(pL); lib._free(pR); pL = pR = 0; cap = 0; }
    }
    return {
      kind: 'ring',
      load: function (data) {
        liberar();
        var p = lib._malloc(data.length); lib.HEAPU8.set(data, p);
        mod = lib._openmpt_module_create_from_memory2(p, data.length, 0, 0, 0, 0, 0, 0, 0);
        lib._free(p);
        if (!mod) throw new Error('libopenmpt não abriu o arquivo');
        durS = lib._openmpt_module_get_duration_seconds(mod) || 0;
        // onde o loop recomeça (ordem/linha de reinício): o que vem antes é introdução
        try {
          var ro = lib._openmpt_module_get_restart_order(mod, 0), rr = lib._openmpt_module_get_restart_row(mod, 0);
          var t = lib._openmpt_module_get_time_at_position(mod, ro, rr);
          introS = (t > 0 && t < durS) ? t : 0;
        } catch (e) { introS = 0; }
        lib._openmpt_module_set_repeat_count(mod, 0);
        posSmp = 0; ended = false; loopsSet = -1;
      },
      render: function (l, r, n) {
        if (ended || !mod) { l.fill(0); r.fill(0); return { ended: true }; }
        if (cap < n) { if (pL) { lib._free(pL); lib._free(pR); } pL = lib._malloc(n * 4); pR = lib._malloc(n * 4); cap = n; }
        var got = lib._openmpt_module_read_float_stereo(mod, SR, n, pL, pR);
        l.set(lib.HEAPF32.subarray(pL >> 2, (pL >> 2) + got));
        r.set(lib.HEAPF32.subarray(pR >> 2, (pR >> 2) + got));
        if (got < n) { l.fill(0, got); r.fill(0, got); ended = true; }
        posSmp += got;
        return { ended: ended };
      },
      posMs: function () { return posSmp * 1000 / SR; },
      durInfo: function (loops) {
        loops = Math.max(1, loops || 1);
        if (mod && loopsSet !== loops) { lib._openmpt_module_set_repeat_count(mod, loops - 1); loopsSet = loops; }
        if (!durS) return { durMs: 0, own: false, report: 0 };
        var intro = introS * 1000, loopMs = (durS - introS) * 1000, d = intro + loopMs * loops;
        return { durMs: d, own: false, report: d, hasLoop: true, introMs: intro, loopMs: loopMs, totalMs: durS * 1000 };
      },
      seek: function (ms) {
        if (!mod || !durS) return;
        var s = Math.max(0, ms / 1000), loopS = durS - introS;
        // depois da 1a passada, o ponto equivalente dentro do trecho que repete
        var dentro = s < durS ? s : introS + ((s - introS) % (loopS || durS));
        lib._openmpt_module_set_position_seconds(mod, dentro);
        posSmp = Math.round(s * SR); ended = false;
      },
      voices: function () { return { names: [], mask: [], groups: [] }; },
      setVoiceMask: function () {},
      numSubtunes: function () { return 1; },
      subtune: function () { return 0; },
      durations: function () { return [durS * 1000]; },
      playSubtune: function () {},
      title: function () { return mod ? meta('title') : ''; },
      stop: function () { liberar(); }
    };
  }

  // ───────────────────────── motor: Wothke (PSF/GSF/USF/2SF/KSS) ─────────────────────────
  var spPromise = null, wothkeAdapters = {}, wothkeActive = null, wothkeScripts = {};
  var WOTHKE = {
    psx: { script: 'backend_psx.js', make: function () { return new PSXBackendAdapter(false); } },
    gsf: { script: 'backend_gsf.js', make: function () { return new GSFBackendAdapter(true); } },
    n64: { script: 'backend_n64.js', make: function () { return new N64BackendAdapter(); } },
    ds:  { script: 'backend_ds.js',  make: function () { return new DsBackendAdapter(); } },
    nez: { script: 'backend_nez.js', make: function () { return new NEZBackendAdapter(); } }
  };
  var wothkeEndCb = null;
  function ensureWothke(type) {
    ensureCtx();
    if (!spPromise) spPromise = loadScript(BASE + 'scriptprocessor_player.min.js');
    return spPromise.then(function () {
      if (!wothkeScripts[type]) wothkeScripts[type] = loadScript(BASE + WOTHKE[type].script);
      return wothkeScripts[type];
    }).then(function () {
      if (wothkeActive === type && window.player) return;
      var ad = wothkeAdapters[type];
      if (!ad) {
        ad = WOTHKE[type].make();
        try { ad.setProcessorBufSize(16384); } catch (e) {}   // buffer grande: não engasga
        wothkeAdapters[type] = ad;
      }
      return ScriptNodePlayer.initialize(ad, function () { if (wothkeEndCb) wothkeEndCb(); }, [], false, undefined)
        .then(function () {
          wothkeActive = type;
          hookWothkePlayer();
        });
    });
  }
  // O player do Wothke tem o próprio ScriptProcessor; aqui ele fica desligado e nós
  // puxamos as amostras dele para o mesmo buffer de ~1 s dos outros formatos.
  function hookWothkePlayer() {
    var p = window.player; if (!p) return;
    // O ScriptProcessor dele só é criado no primeiro loadMusicFromURL: desliga sempre que existir um novo
    var node = p._producerNode;
    if (node && !node._rgOff) {
      node._rgOff = true;
      try { node.onaudioprocess = null; } catch (e) {}
      try { node.disconnect(); } catch (e) {}
    }
    var gn = p._gainNode;
    if (gn && !gn._rgOff) { gn._rgOff = true; try { gn.disconnect(); } catch (e) {} }
    var tk = p._tickerNode;
    if (tk && !tk._rgOff) { tk._rgOff = true; try { tk.onaudioprocess = null; tk.disconnect(); } catch (e) {} }
  }

  function makeWothkeEngine(type) {
    var opts = {}, track = 0, durMs = 0, fadeMs = FADE_MS, ended = false;
    var L = null, R = null;
    var fake = { outputBuffer: { numberOfChannels: 2, getChannelData: function (c) { return c ? R : L; } } };
    var eng = {
      kind: 'ring', type: type,
      load: function (data, path, url, sub) {
        track = sub || 0;
        return ensureWothke(type).then(function () { return eng._open(url); });
      },
      _open: function (url) {
        ended = false;
        opts = type === 'nez' ? { track: track, timeout: 0 } : {};
        wothkeEndCb = function () { ended = true; };
        var pr = ScriptNodePlayer.loadMusicFromURL(url, opts);
        hookWothkePlayer();          // o processador dele acabou de ser criado: desliga já
        return pr.then(function () {
          var p = window.player;
          hookWothkePlayer();
          try { p.setVolume(1); } catch (e) {}
          try { if (p.isPaused && p.isPaused()) p.resume(); } catch (e) {}
          var info = {};
          try { info = p.getSongInfo() || {}; } catch (e) {}
          durMs = parseTime(info.length || info.songLength || '');
          fadeMs = info.fade ? Math.max(500, parseTime(info.fade)) : FADE_MS;
          if (!durMs) { var mx = 0; try { mx = p.getMaxPlaybackPosition(); } catch (e) {} durMs = mx > 0 ? mx : DEFAULT_LEN_MS; }
          try { eng.titleText = decodeURIComponent(info.title || ''); } catch (e) { eng.titleText = info.title || ''; }
        });
      },
      render: function (l, r, n) {
        if (ended) { l.fill(0); r.fill(0); return { ended: true }; }
        L = l; R = r;
        try { window.player._backendAdapter._transformer.genSamples(fake); }
        catch (e) { console.error(e); ended = true; }
        return { ended: ended };
      },
      posMs: function () { return 0; },          // usa o relógio próprio (ownDuration)
      durInfo: function () { return { durMs: durMs, own: true, report: durMs + fadeMs, fadeMs: fadeMs }; },
      seek: function (ms) { ended = false; try { window.player.seekPlaybackPosition(ms); } catch (e) {} },
      voices: function () { return { names: [], mask: [], groups: [] }; },
      setVoiceMask: function () {},
      numSubtunes: function () { return 1; },   // KSS não informa quantas faixas existem de verdade
      subtune: function () { return track; },
      playSubtune: function (i) { track = i; return eng._open(cur.url); },
      title: function () { return eng.titleText || ''; },
      stop: function () { ended = true; try { window.player.pause(); } catch (e) {} }
    };
    return eng;
  }

  // ───────────────────────── carregar faixa ─────────────────────────
  function stopCurrent() {
    var t = cur;
    cur = null;
    if (!t) return;
    try { t.engine.stop(); } catch (e) {}
    ringFlush();
  }

  // Cria o motor certo para o formato e carrega o arquivo (usado para tocar e para medir o volume)
  function openEngine(url, sub, stale) {
    var name = fileName(url), ext = (name.split('.').pop() || '').toLowerCase();
    var wtype = null;
    for (var k in EXT_WOTHKE) if (EXT_WOTHKE[k].test(name)) wtype = k;

    var enginePromise;
    if (wtype) {
      enginePromise = ensureRing().then(function () { return makeWothkeEngine(wtype); });
    } else if (EXT_SAP.test(name)) {
      enginePromise = ensureRing().then(function () { return makeSapEngine(); });
    } else if (EXT_AHX.test(name)) {
      enginePromise = Promise.all([ensureRing(), loadAhx()]).then(function () { return makeAhxEngine(); });
    } else if (EXT_OMPT.test(name)) {
      enginePromise = Promise.all([ensureRing(), loadOmpt()]).then(function (a) { return makeOmptEngine(a[1]); });
    } else if (EXT_CHIP.test(name)) {
      enginePromise = Promise.all([ensureRing(), loadChipCore(), loadChipPlayers()]).then(function (a) {
        return makeChipEngine(a[1], a[2], chipClassFor(ext), ext);
      });
    } else {
      enginePromise = Promise.reject(new Error('Formato não suportado'));
    }

    var engine, bytes = null;
    return enginePromise.then(function (e) {
      engine = e;
      if (stale()) throw 'stale';
      if (engine.type) return engine.load(null, url, url, sub);   // Wothke busca o arquivo (e as libs) sozinho
      // Os outros: o pausado do Wothke precisa parar
      try { if (window.player && window.player.pause) window.player.pause(); } catch (x) {}
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        if (stale()) throw 'stale';
        bytes = new Uint8Array(buf);
        return engine.load(bytes, name, url, sub);
      });
    }).catch(function (err) {
      // Módulo que o libxmp não abre (ex.: variantes do StarTrekker): tenta o libopenmpt
      if (err === 'stale' || !bytes || !EXT_MOD_FALLBACK.test(name)) throw err;
      try { if (engine && engine.stop) engine.stop(); } catch (x) {}
      return Promise.all([ensureRing(), loadOmpt()]).then(function (a) {
        if (stale()) throw 'stale';
        engine = makeOmptEngine(a[1]);
        return engine.load(bytes, name, url, sub);
      });
    }).then(function () { return engine; });
  }

  var pendingSeek = null;     // seek pedido enquanto a faixa ainda carregava
  function loadTrack(url, loops, sub, overrideMs) {
    var token = ++loadToken;
    var lmP = loadLoopMap();
    pendingSeek = null;
    ensureCtx(); resumeCtx(); startVis();
    stopCurrent();
    setFade(1, 0);
    voiceMuted = false;
    var name = fileName(url);
    status('Carregando ' + name.replace(/\.[^.]+$/, '') + '...', '');

    var engine;
    return openEngine(url, sub, function () { return token !== loadToken; }).then(function (e) {
      engine = e;
    }).then(function () { return lmP; }).then(function () {
      if (token !== loadToken) throw 'stale';
      var t = newTrackState(engine, url, loops);
      t.overrideMs = overrideMs > 0 ? overrideMs : 0;
      cur = t;
      if (engine.kind === 'ring') {
        if (sub && engine.numSubtunes() > 1) engine.playSubtune(sub);
        ringFlush();
      }
      t.loopInfo = loopInfoFor(url, loopSubOf(engine, sub));
      applyDuration();
      resumeCtx();
      var v = engine.voices();
      var info = t.lastInfo || engine.durInfo(loops);
      send({
        type: 'loaded',
        durMs: Math.round(t.reportDurMs || 0),
        hasLoop: !!info.hasLoop, introMs: info.introMs || 0, loopMs: info.loopMs || 0, totalMs: info.totalMs || 0,
        numSubtunes: engine.numSubtunes(), subtune: engine.subtune(),
        durations: engine.durations ? engine.durations() : null,
        voices: v, title: engine.title ? engine.title() : '', engine: engine.kind
      });
      status('♪ ' + name.replace(/\.[^.]+$/, ''), 'playing');
      if (pendingSeek != null) { var ps = pendingSeek; pendingSeek = null; doSeek(ps); }
      else if (engine.kind === 'ring') pump();
      reportPosition(true);
    }).catch(function (err) {
      if (err === 'stale') return;
      console.error(err);
      status('Erro: ' + (err && err.message || err), 'error');
      send({ type: 'error', msg: String(err && err.message || err) });
    });
  }

  function applyDuration() {
    var t = cur; if (!t) return;
    var info = t.engine.durInfo(t.loops);
    var li = t.loopInfo;
    if (li && li.length >= 2 && li[1] > 0) {
      // loop medido: introdução + N voltas, e o fade começa exatamente no fim da última volta
      var d = li[0] + li[1] * Math.max(1, t.loops);
      info = { durMs: d, own: true, report: d + FADE_MS, fadeMs: FADE_MS, hasLoop: true, introMs: li[0], loopMs: li[1] };
    } else if (li && li[0] > 0) {
      // a música termina sozinha: toca até o fim, sem repetir
      info = { durMs: li[0], own: true, report: li[0] + 600, fadeMs: 600 };
    } else if (t.overrideMs > 0) {          // duração vinda do mapa de subfaixas (.m3u)
      info = { durMs: t.overrideMs * Math.max(1, t.loops), own: true, report: t.overrideMs * Math.max(1, t.loops) + FADE_MS, fadeMs: FADE_MS };
    }
    t.lastInfo = info;
    // o GMEPlayer tem um fade interno no "play_length" (2:30 por padrão): quando a
    // duração é nossa, ele tem que tocar sem parar para o nosso fade valer
    try {
      var gp = t.engine.player;
      if (gp && t.engine.cls === 'GMEPlayer') { gp.params = gp.params || {}; gp.params.indefinitePlayback = !!info.own; }
    } catch (e) {}
    t.durMs = info.durMs || 0;
    t.ownDuration = !!info.own;
    t.reportDurMs = info.report || 0;
    t.fadeMs = info.fadeMs || FADE_MS;
  }

  function doSeek(ms) {
    var t = cur; if (!t) return;
    ms = Math.max(0, ms);
    t.engine.seek(ms);
    t.fading = false; t.endFrame = -1; t.endedSent = false; t.silentMs = 0; t.clockMs = ms;
    setFade(1, 0);
    ringFlush(); t.posAtRender = ms; pump();
    reportPosition(true);
  }

  // ───────────────────────── comandos do gadget ─────────────────────────
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !d.type) return;
    switch (d.type) {
      case 'load':
        if (d.url) loadTrack(d.url, Math.max(1, d.loops || 1), d.sub || 0, d.durMs || 0);
        break;
      case 'pause':
        try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (x) {}
        break;
      case 'resume':
        resumeCtx();
        break;
      case 'stop':
        stopCurrent();
        try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (x) {}
        break;
      case 'volume':
        if (typeof d.level === 'number') setVolume(d.level);
        break;
      case 'loops':
        if (cur && typeof d.count === 'number') {
          cur.loops = Math.max(1, d.count); applyDuration();
          if (cur.fading && cur.engine.kind === 'ring' && cur.posAtRender < cur.durMs) cur.fading = false;
          send({ type: 'duration', durMs: Math.round(cur.reportDurMs || 0) });
        }
        break;
      case 'seek':
        if (typeof d.ms === 'number') { if (cur) doSeek(d.ms); else pendingSeek = d.ms; }
        break;
      case 'subtune':
        if (cur && typeof d.index === 'number') {
          var tt = cur;
          tt.overrideMs = d.durMs > 0 ? d.durMs : 0;
          tt.fading = false; tt.endFrame = -1; tt.endedSent = false; tt.heard = false; tt.silentMs = 0; tt.renderedMs = 0; tt.clockMs = 0;
          setFade(1, 0); resumeCtx();
          Promise.resolve(tt.engine.playSubtune(d.index)).then(function () {
            if (tt !== cur) return;
            if (tt.engine.kind === 'ring') ringFlush();
            tt.loopInfo = loopInfoFor(tt.url, loopSubOf(tt.engine, d.index));
            applyDuration();
            var li2 = tt.lastInfo || {};
            send({ type: 'duration', durMs: Math.round(tt.reportDurMs || 0), hasLoop: !!li2.hasLoop, introMs: li2.introMs || 0, loopMs: li2.loopMs || 0 });
            if (tt.engine.kind === 'ring') pump();
          });
        }
        break;
      case 'voicemask':
        if (cur && d.mask) {
          voiceMuted = d.mask.some(function (v) { return !v; });
          cur.engine.setVoiceMask(d.mask);
        }
        break;
      case 'mediainfo':
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({ title: d.title || '', artist: d.artist || '', album: d.album || 'Registro Gamer' });
            var ms = navigator.mediaSession;
            ms.setActionHandler('nexttrack', function () { send({ type: 'ms-action', action: 'next' }); });
            ms.setActionHandler('previoustrack', function () { send({ type: 'ms-action', action: 'prev' }); });
            ms.setActionHandler('play', function () { send({ type: 'ms-action', action: 'play' }); });
            ms.setActionHandler('pause', function () { send({ type: 'ms-action', action: 'pause' }); });
            ms.playbackState = 'playing';
          } catch (x) {}
        }
        break;
      case 'ms-state':
        if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = d.state; } catch (x) {} }
        break;
    }
  });

  // ───────────────────── medição de volume (análise prévia) ─────────────────────
  // Usada pela ferramenta tools/medir_volume.py (navegador sem tela): toca a faixa
  // "no silêncio", o mais rápido possível, com o MESMO motor do site, e mede o
  // volume das partes altas (loudness K-weighted, janelas de 3 s, percentil 90).
  // Como é o próprio player que mede, o número já vem na escala certa do site.
  function kFilter() {   // ITU-R BS.1770 (shelf +4 dB @1681 Hz e passa-altas @38 Hz), 44,1 kHz
    function biq(b0, b1, b2, a1, a2) { var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      return function (x) { var y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }; }
    function sh() { var G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.9744509555319, K = Math.tan(Math.PI * fc / SR);
      var Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.499666774155), a0 = 1 + K / Q + K * K;
      return biq((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0); }
    function hp() { var Q = 0.5003270373253953, fc = 38.13547087613982, K = Math.tan(Math.PI * fc / SR), d = 1 + K / Q + K * K;
      return biq(1, -2, 1, 2 * (K * K - 1) / d, (1 - K / Q + K * K) / d); }
    var a = sh(), b = hp();
    return function (x) { return b(a(x)); };
  }
  function measureTrack(url, sub, maxMs) {
    var token = ++loadToken;
    stopCurrent();
    ensureCtx();
    var lmP = loadLoopMap(), engine;
    return openEngine(url, sub || 0, function () { return token !== loadToken; }).then(function (e) {
      engine = e; return lmP;
    }).then(function () {
      if (engine.kind === 'ring' && sub && engine.numSubtunes() > 1) engine.playSubtune(sub);
      try { if (engine.player && engine.cls === 'GMEPlayer') { engine.player.params = engine.player.params || {}; engine.player.params.indefinitePlayback = true; } } catch (x) {}
      // quanto medir: até o fim do 1º loop (ou o fim da música), no máximo maxMs
      var li = loopInfoFor(url, engine.cls === 'SIDPlayer' ? engine.subtune() : (sub || 0));
      var lim = maxMs || 150000;
      if (li && li.length >= 2 && li[1] > 0) lim = Math.min(lim, li[0] + li[1] + 1000);
      else if (li && li[0] > 0) lim = Math.min(lim, li[0] + 500);
      // MIDI: o banco de sons (soundfont) carrega em segundo plano; espera ele antes de medir
      if (engine.cls === 'MIDIPlayer') return new Promise(function (ok) { setTimeout(ok, 5000); }).then(function () { return lim; });
      return lim;
    }).then(function (lim) {
      var fL = kFilter(), fR = kFilter();
      var secPow = [], acc = 0, accN = 0, peak = 0, done = 0, total = Math.ceil(lim / 1000 * SR);
      var l = new Float32Array(CHUNK), r = new Float32Array(CHUNK), silentMs = 0, heard = false, t0 = Date.now();
      return new Promise(function (resolve) {
        function step() {
          if (token !== loadToken) return resolve(null);
          var end = false;
          for (var k = 0; k < 40 && !end; k++) {
            var res;
            try { res = engine.render(l, r, CHUNK); } catch (x) { res = { ended: true }; }
            var s = 0;
            for (var i = 0; i < CHUNK; i++) {
              var a = l[i], b = r[i];
              if (a > peak) peak = a; else if (-a > peak) peak = -a;
              if (b > peak) peak = b; else if (-b > peak) peak = -b;
              var x = fL(a), y = fR(b);
              acc += x * x + y * y; accN++;
              if (accN >= SR) { secPow.push(acc / accN); acc = 0; accN = 0; }
              s += a * a + b * b;
            }
            if (Math.sqrt(s / (2 * CHUNK)) < 0.0008) silentMs += CHUNK / SR * 1000; else { heard = true; silentMs = 0; }
            done += CHUNK;
            if ((res && res.ended) || done >= total || (heard && silentMs > SILENCE_END_MS) || (!heard && done > SR * 20)) end = true;
          }
          if (!end) return setTimeout(step, 0);
          try { engine.stop(); } catch (x) {}
          if (accN > SR / 4) secPow.push(acc / accN);
          var st = [];
          for (var j = 0; j + 3 <= secPow.length || (j === 0 && secPow.length); j++) {
            var w = secPow.slice(j, j + 3), m = 0; w.forEach(function (v) { m += v; }); m /= w.length;
            var lu = -0.691 + 10 * Math.log10(m + 1e-20);
            if (lu > -70) st.push(lu);
            if (j + 3 > secPow.length) break;
          }
          st.sort(function (a, b) { return a - b; });
          var p90 = st.length ? st[Math.min(st.length - 1, Math.floor(st.length * 0.9))] : null;
          resolve({ p90: p90, peakDb: 20 * Math.log10(peak + 1e-9), secs: done / SR, ms: Date.now() - t0 });
        }
        step();
      });
    }).catch(function (e) { return { erro: String(e && e.message || e) }; });
  }

  // Diagnóstico (console): RG.state()
  window.RG = { measure: measureTrack, state: function () { return { cur: cur, ring: { rendered: ring.rendered, played: ring.played, under: ring.under }, ctx: ctx && ctx.state }; },
                level: function () { if (!analyser) return 0; var b = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(b); var s = 0; for (var i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / b.length); } };

  // Remove o service worker antigo (ele redirecionava o chip-core.wasm para um arquivo inexistente)
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); });
  } catch (e) {}

  // Toca direto se a página foi aberta com ?url= (compatibilidade / teste)
  var qp = new URLSearchParams(location.search);
  status('Pronto', '');
  send({ type: 'ready' });
  if (qp.get('url')) loadTrack(qp.get('url'), parseInt(qp.get('loops') || '1', 10) || 1, parseInt(qp.get('sub') || '0', 10) || 0);
})();
