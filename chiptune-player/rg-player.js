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
    bus.connect(fadeGain); fadeGain.connect(volGain); volGain.connect(limiter);
    limiter.connect(analyser); analyser.connect(ctx.destination);
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
      if (t.engine.type === 'nez' && !t.heard && t.renderedMs > 2500 && t.engine.subtune() < 60) {
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
    var vgm = null;
    var eng = {
      kind: 'ring', player: player, cls: cls,
      load: function (data, path) {
        st.ended = false;
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
      seek: function (ms) { try { player.seekMs(ms); } catch (e) {} },
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
      playSubtune: function (i) { st.ended = false; try { player.playSubtune(i); } catch (e) {} },
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
    if (p._rgHooked) return;
    p._rgHooked = true;
    try { p._producerNode.onaudioprocess = null; } catch (e) {}
    try { p._producerNode.disconnect(); } catch (e) {}
    try { p._gainNode.disconnect(); } catch (e) {}
    try { if (p._tickerNode) p._tickerNode.disconnect(); } catch (e) {}
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
        return ScriptNodePlayer.loadMusicFromURL(url, opts).then(function () {
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

  var pendingSeek = null;     // seek pedido enquanto a faixa ainda carregava
  function loadTrack(url, loops, sub) {
    var token = ++loadToken;
    pendingSeek = null;
    ensureCtx(); resumeCtx(); startVis();
    stopCurrent();
    setFade(1, 0);
    voiceMuted = false;
    var name = fileName(url), ext = (name.split('.').pop() || '').toLowerCase();
    status('Carregando ' + name.replace(/\.[^.]+$/, '') + '...', '');

    var wtype = null;
    for (var k in EXT_WOTHKE) if (EXT_WOTHKE[k].test(name)) wtype = k;

    var enginePromise;
    if (wtype) {
      enginePromise = ensureRing().then(function () { return makeWothkeEngine(wtype); });
    } else if (EXT_SAP.test(name)) {
      enginePromise = ensureRing().then(function () { return makeSapEngine(); });
    } else if (EXT_CHIP.test(name)) {
      enginePromise = Promise.all([ensureRing(), loadChipCore(), loadChipPlayers()]).then(function (a) {
        return makeChipEngine(a[1], a[2], chipClassFor(ext), ext);
      });
    } else {
      enginePromise = Promise.reject(new Error('Formato não suportado'));
    }

    var engine;
    return enginePromise.then(function (e) {
      engine = e;
      if (token !== loadToken) throw 'stale';
      // Players do Wothke buscam o arquivo (e as libs) sozinhos
      if (engine.type) return engine.load(null, url, url, sub);   // Wothke busca o arquivo (e as libs) sozinho
      // Os outros: o pausado do Wothke precisa parar
      try { if (window.player && window.player.pause) window.player.pause(); } catch (x) {}
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        if (token !== loadToken) throw 'stale';
        return engine.load(new Uint8Array(buf), name, url, sub);
      });
    }).then(function () {
      if (token !== loadToken) throw 'stale';
      var t = newTrackState(engine, url, loops);
      cur = t;
      if (engine.kind === 'ring') {
        if (sub && engine.numSubtunes() > 1) engine.playSubtune(sub);
        ringFlush();
      }
      applyDuration();
      resumeCtx();
      var v = engine.voices();
      var info = engine.durInfo(loops);
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
        if (d.url) loadTrack(d.url, Math.max(1, d.loops || 1), d.sub || 0);
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
          tt.fading = false; tt.endFrame = -1; tt.endedSent = false; tt.heard = false; tt.silentMs = 0; tt.renderedMs = 0; tt.clockMs = 0;
          setFade(1, 0); resumeCtx();
          Promise.resolve(tt.engine.playSubtune(d.index)).then(function () {
            if (tt !== cur) return;
            if (tt.engine.kind === 'ring') ringFlush();
            applyDuration();
            send({ type: 'duration', durMs: Math.round(tt.reportDurMs || 0) });
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

  // Diagnóstico (console): RG.state()
  window.RG = { state: function () { return { cur: cur, ring: { rendered: ring.rendered, played: ring.played, under: ring.under }, ctx: ctx && ctx.state }; },
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
