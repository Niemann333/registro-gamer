// ===== Conversor VGM → MIDI (Chiptune Studio · Registro Gamer) =====
// Usa as notas que o RGVGM registra (parse com { events: true }) e monta um .mid (formato 1).
var RGMIDI = (function () {
  'use strict';
  var PPQ = 480, SR = 44100;
  var DAC_NOTES = [36, 38, 42, 46, 49, 45, 48, 50, 39, 51, 41, 43, 47, 54, 56, 57];

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function vel(amp) { return clamp(Math.round(127 * Math.sqrt(Math.max(0, amp))), 1, 127); }

  // bateria (canal 10 do General MIDI)
  function noiseDrum(nz, dur) {
    if (nz.ck === 'drum') return nz.d; // bateria do modo ritmo do OPL/OPLL: a peça já vem certa
    var br; // brilho 0..1 (1 = chiado agudo)
    if (nz.ck === 'sn') {
      // ritmo do ruído: fixo (r 0-2) ou o do PSG 3 (r 3); quanto mais rápido, mais chiado
      var fz = (nz.r & 3) === 3 ? (nz.f || 1000) : 3579545 / (32 * (16 << (nz.r & 3)));
      br = Math.max(0, Math.min(1, Math.log(fz / 400) / Math.log(16)));
      if (nz.m === 'periodic') br *= 0.5; // ruído periódico soa mais "grave/zumbido"
    }
    else if (nz.ck === 'ay') br = 1 - (nz.r & 31) / 31;
    else br = 1 - (nz.r & 15) / 15;
    if (br > 0.65) return dur > 0.6 ? 49 : dur > 0.22 ? 46 : 42;
    if (br > 0.35) return dur > 0.7 ? 49 : 38;
    return 36;
  }

  // ── bateria do DAC: escuta cada sample e decide que peça ele é (bumbo, caixa, chimbal, tom…) ──
  function fft(re, im) {
    var n = re.length, i, j = 0, k, t;
    for (i = 1; i < n; i++) { var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < h; k++) {
          var a = i + k, b = a + h, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function drumFeats(data, rate) {
    var n = data.length, x = new Float64Array(n), k, j, mean = 0;
    for (k = 0; k < n; k++) mean += data[k]; mean /= n || 1;
    for (k = 0; k < n; k++) x[k] = (data[k] - mean) / 128;
    var w = Math.max(16, Math.round(rate * 0.005)), env = [], pk = 0;
    for (k = 0; k < n; k += w) { var s = 0, m = Math.min(n, k + w); for (j = k; j < m; j++) s += x[j] * x[j]; s = Math.sqrt(s / (m - k)); env.push(s); if (s > pk) pk = s; }
    var eff = 0;
    for (k = env.length - 1; k >= 0; k--) if (env[k] > pk * 0.12) { eff = (k + 1) * w / rate; break; }
    var bursts = 0, armed = true;
    for (k = 0; k < env.length; k++) { if (armed && env[k] > pk * 0.6) { bursts++; armed = false; } else if (env[k] < pk * 0.25) armed = true; }
    var N = 1024, lim = Math.min(n, Math.round(rate * 0.3)), spec = new Float64Array(N / 2);
    for (var st = 0; st < Math.max(lim, 1); st += N / 2) {
      var re = new Float64Array(N), im = new Float64Array(N);
      for (k = 0; k < N; k++) re[k] = (st + k < n ? x[st + k] : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (N - 1)));
      fft(re, im);
      for (k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
      if (st + N >= lim) break;
    }
    var tot = 0, cen = 0, high = 0, air = 0, pb = 1, hiCut = Math.min(5000, rate * 0.35);
    for (k = 1; k < N / 2; k++) {
      var f = k * rate / N, p = spec[k];
      tot += p; cen += f * p; if (f > hiCut) high += p; if (f > 1500) air += p; if (p > spec[pb]) pb = k;
    }
    // periodicidade: tom e tímpano têm altura definida; caixa e prato são ruído
    var a0 = Math.round(rate * 0.008), aw = Math.min(n - a0, Math.round(rate * 0.04)), per = 0;
    if (aw > 32) {
      var e0 = 0; for (k = 0; k < aw; k++) e0 += x[a0 + k] * x[a0 + k];
      for (var lag = Math.max(1, Math.round(rate / 1000)); lag <= Math.round(rate / 50) && a0 + lag + aw <= n; lag += 1) {
        var c = 0, e1 = 0; for (k = 0; k < aw; k++) { c += x[a0 + k] * x[a0 + k + lag]; e1 += x[a0 + k + lag] * x[a0 + k + lag]; }
        var r = c / Math.sqrt(e0 * e1 + 1e-12); if (r > per) per = r;
      }
    }
    tot = tot || 1;
    return { dur: n / rate, eff: eff, pk: pk, bursts: bursts, cen: cen / tot, high: high / tot, air: air / tot, per: per, peakHz: pb * rate / N };
  }
  // devolve {id: nota GM, ...} e a força relativa de cada sample (para a velocity)
  function classifyDrums(pcm, counts) {
    var S = [], out = {}, loud = {}, rest = [], maxPk = 0;
    Object.keys(counts).forEach(function (id) {
      var p = pcm && pcm[id]; if (!p || !p.data || p.data.length < 8) return;
      var f = drumFeats(p.data, p.rate || 8000); f.id = id; f.uses = counts[id]; S.push(f); if (f.pk > maxPk) maxPk = f.pk;
    });
    S.forEach(function (s) {
      loud[s.id] = maxPk ? Math.max(0.25, Math.sqrt(s.pk / maxPk)) : 1;
      if (maxPk && s.pk < maxPk * 0.08) out[s.id] = 0;                         // quase silêncio: não vira nota
      else if (s.dur < 0.03) out[s.id] = 37;                                            // estalo curtíssimo: aro
      else if (s.air > 0.45 || s.high > 0.3) out[s.id] = s.eff < 0.15 ? 42 : s.eff < 0.5 ? 46 : 49; // chimbal / prato
      else rest.push(s);
    });
    if (rest.length) {
      rest.sort(function (a, b) { return b.uses - a.uses; });
      // as duas peças mais tocadas: a mais grave é o bumbo, a outra a caixa
      var kick = rest[0], snare = null;
      if (rest[1]) { if (rest[1].cen < kick.cen) { snare = kick; kick = rest[1]; } else snare = rest[1]; if (snare.cen < kick.cen * 1.4) snare = null; }
      if (!snare && kick.cen > 500) { snare = kick; kick = null; }
      var sim = function (a, b) { return Math.abs(a.cen - b.cen) < 0.06 * Math.max(a.cen, b.cen) && Math.abs(a.dur - b.dur) < 0.12 * Math.max(a.dur, b.dur); };
      var toms = [];
      rest.forEach(function (s) {
        if (s === kick || (kick && sim(s, kick))) { out[s.id] = 36; return; }
        if (s === snare || (snare && sim(s, snare))) { out[s.id] = 38; return; }
        var twin = rest.some(function (o) { return o !== s && o !== kick && o !== snare && sim(o, s); }); // mesmo som em várias alturas
        if (kick && s.cen <= kick.cen * 1.3 && !twin) out[s.id] = 35;           // outro bumbo
        else if (twin || (s.per > 0.6 && s.air < 0.1 && (!kick || s.cen > kick.cen * 1.3))) toms.push(s);
        else if (s.bursts >= 3) out[s.id] = 39;                                  // palmas
        else if (s.eff > 0.9) out[s.id] = 49;                                    // prato / efeito longo
        else out[s.id] = 40;                                                     // outra caixa
      });
      var TOMS = [41, 43, 45, 47, 48, 50];
      toms.sort(function (a, b) { return a.peakHz - b.peakHz; });
      toms.forEach(function (s, i) { out[s.id] = TOMS[Math.min(5, Math.round(i * 5 / Math.max(1, toms.length - 1)))]; });
    }
    return { map: out, loud: loud };
  }
  function tonalDrum(n) { return n < 43 ? 36 : n < 55 ? 38 : n < 67 ? 47 : 42; }
  function program(tb) {
    if (!tb) return 80;
    if (tb.role === 'Baixo') return 38;              // Synth Bass 1
    if (tb.type === 'fm' || tb.type === 'opl' || tb.type === 'opx') return tb.role === 'Melodia' ? 81 : 62; // Lead 2 (saw) / Synth Brass 1
    return 80;                                        // Lead 1 (square)
  }

  // ── tempo: procura o BPM em que os ataques das notas caem na grade de semicolcheias ──
  function detectTempo(onsets) {
    if (onsets.length < 24) return null;
    onsets = onsets.slice(0, 4000);
    var best = 0, scores = [];
    for (var bpm = 70; bpm <= 180.001; bpm += 0.25) {
      var g = 60 / bpm / 4, re = 0, im = 0;
      for (var i = 0; i < onsets.length; i++) { var a = 2 * Math.PI * onsets[i] / g; re += Math.cos(a); im += Math.sin(a); }
      var s = Math.sqrt(re * re + im * im) / onsets.length;
      scores.push({ bpm: bpm, s: s, ph: Math.atan2(im, re) });
      if (s > best) best = s;
    }
    if (best < 0.55) return null;
    // entre os quase-empates, fica com o andamento mais lento (o dobro também "encaixa")
    for (var k = 0; k < scores.length; k++) if (scores[k].s >= best * 0.97) {
      var r = scores[k], g2 = 60 / r.bpm / 4, off = (r.ph / (2 * Math.PI)) * g2;
      return { bpm: Math.round(r.bpm * 100) / 100, score: best, grid: g2, offset: off };
    }
    return null;
  }

  // ── escrita do arquivo ──
  function vlq(n) { var b = [n & 127]; n >>= 7; while (n) { b.unshift((n & 127) | 128); n >>= 7; } return b; }
  function utf8(s) {
    var out = [];
    String(s || '').split('').forEach(function (ch) {
      var c = ch.charCodeAt(0);
      if (c < 256) out.push(c);
      else { var b = ch.normalize('NFD').charCodeAt(0); out.push(b < 128 ? b : 63); }
    });
    return out;
  }
  function track(evs) {
    evs.sort(function (a, b) { return a.tick - b.tick || a.ord - b.ord; });
    var out = [], last = 0;
    evs.forEach(function (e) { out.push.apply(out, vlq(Math.max(0, e.tick - last))); last = Math.max(last, e.tick); out.push.apply(out, e.data); });
    out.push(0, 0xFF, 0x2F, 0);
    var len = out.length;
    return [0x4D, 0x54, 0x72, 0x6B, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255].concat(out);
  }
  function meta(type, bytes) { return [0xFF, type].concat(vlq(bytes.length), bytes); }

  // res: resultado de RGVGM.parse(u8, { events: true })
  // opts: { chans: [ids] (padrão: todos), tempo: true/false }
  function build(res, opts) {
    opts = opts || {};
    var EN = opts.lang === 'en';
    var LW = { 'Pulso': 'Pulse', 'Triângulo': 'Triangle', 'Onda': 'Wave', 'Ruído': 'Noise' };
    var M = res.midi; if (!M) throw new Error('sem eventos');
    var want = {}; (opts.chans || M.chans.map(function (c) { return c.id; })).forEach(function (id) { want[id] = 1; });
    var chans = M.chans.filter(function (c) { return want[c.id]; });

    // 1) junta eventos em notas por canal
    var notes = {}; chans.forEach(function (c) { notes[c.id] = []; });
    var open = {}, dacCount = {};
    // batidas do DAC recortadas do fluxo (drivers que mixam em software), quando o leitor as tiver
    var EV = M.events;
    if (res.dacHits && res.dacHits.length) {
      var dacCh = null; M.events.some(function (e) { if (e.k === 'hit') { dacCh = e.c; return true; } return false; });
      if (dacCh) EV = M.events.filter(function (e) { return e.k !== 'hit'; })
        .concat(res.dacHits.map(function (h) { return { c: dacCh, t: h.t, k: 'hit', id: h.id }; }))
        .sort(function (a, b) { return a.t - b.t; });
    }
    EV.forEach(function (e) {
      if (!want[e.c]) return;
      var L = notes[e.c];
      if (e.k === 'hit') { L.push({ t: e.t, end: e.t + SR * 0.12, dac: e.id, v: 0.9, ev: [] }); dacCount[e.id] = (dacCount[e.id] || 0) + 1; return; }
      // canal 3 expandido do YM2612: cada operador (e.sub) é uma nota própria no mesmo canal
      var ok = e.sub != null ? e.c + '/' + e.sub : e.c;
      var o = open[ok];
      if (e.k === 'on') {
        if (o) { o.end = e.t; }
        var tune = e.tb && (e.tb.type === 'fm' || e.tb.type === 'opl' || e.tb.type === 'opx') ? -(e.tb.tune || 0) : 0; // altura real que o chip toca
        o = { t: e.t, end: null, n: e.n + tune, tune: tune, v: e.v, pan: e.pan, tb: e.tb, noise: e.noise, ev: [] };
        L.push(o); open[ok] = o;
      } else if (!o) return;
      else if (e.k === 'off') { o.end = e.t; open[ok] = null; }
      else if (e.k === 'pitch') o.ev.push({ t: e.t, n: e.n + o.tune });
      else o.ev.push(e);
    });
    var tEnd = res.seconds * SR;
    Object.keys(open).forEach(function (id) { if (open[id] && open[id].end == null) open[id].end = tEnd; });
    var dacRank = Object.keys(dacCount).sort(function (a, b) { return dacCount[b] - dacCount[a]; });
    // com os samples em mãos, cada um vira a peça que ele parece; sem eles, vai pela ordem de uso
    var drumCls = res.pcm ? classifyDrums(res.pcm, dacCount) : { map: {}, loud: {} };
    function dacNote(id) {
      var m = drumCls.map[id];
      return m != null ? m : DAC_NOTES[Math.min(DAC_NOTES.length - 1, dacRank.indexOf(id))];
    }

    // 2) tempo
    var onsets = [];
    chans.forEach(function (c) { notes[c.id].forEach(function (nt) { onsets.push(nt.t / SR); }); });
    onsets.sort(function (a, b) { return a - b; });
    var tp = opts.tempo === false ? null : detectTempo(onsets);
    var bpm = tp ? tp.bpm : 120, shift = 0;
    if (tp) {
      shift = ((-tp.offset % tp.grid) + tp.grid) % tp.grid;
      // começo do compasso: a posição (de 16) com mais ataques graves/bumbo
      var hist = new Array(16).fill(0);
      chans.forEach(function (c) { notes[c.id].forEach(function (nt) {
        var k = Math.round((nt.t / SR + shift) / tp.grid) % 16;
        var w = (nt.dac && dacNote(nt.dac) <= 36) || (nt.n && nt.n < 48 && !nt.noise) ? 2 : (nt.noise ? 0.5 : 1);
        hist[k] += w;
      }); });
      var kb = 0; for (var k = 1; k < 16; k += 1) if (hist[k] > hist[kb]) kb = k;
      kb = kb - (kb % 4); // alinha pelo tempo mais forte do grupo de 4
      shift += ((16 - kb) % 16) * tp.grid;
    }
    var spb = 60 / bpm; // segundos por semínima
    function tick(samples) { return Math.round((samples / SR + shift) / spb * PPQ); }

    // 3) canais MIDI: melodia em 1..16 (pula o 10); bateria no 10
    var midiCh = {}, nextCh = 0;
    chans.forEach(function (c) {
      if (c.kind === 'noise' || c.kind === 'dac') { midiCh[c.id] = 9; return; }
      if (nextCh === 9) nextCh++;
      midiCh[c.id] = nextCh % 16 === 9 ? 10 : nextCh % 16; nextCh++;
    });

    // 4) trilhas
    var title = (res.info && res.info.title) || 'Chiptune';
    var head = [
      { tick: 0, ord: 0, data: meta(0x03, utf8(title)) },
      { tick: 0, ord: 1, data: meta(0x01, utf8(EN ? 'Converted from VGM by Chiptune Studio - Registro Gamer' : 'Convertido de VGM pelo Chiptune Studio - Registro Gamer')) },
      { tick: 0, ord: 2, data: meta(0x51, [(Math.round(60e6 / bpm) >> 16) & 255, (Math.round(60e6 / bpm) >> 8) & 255, Math.round(60e6 / bpm) & 255]) },
      { tick: 0, ord: 3, data: meta(0x58, [4, 2, 24, 8]) }
    ];
    if (res.info && res.info.game) head.push({ tick: 0, ord: 4, data: meta(0x01, utf8(res.info.game + (res.info.author ? ' - ' + res.info.author : ''))) });
    var tracks = [track(head)], count = 0;

    chans.forEach(function (c) {
      var mc = midiCh[c.id], E = [], ord = 0;
      function add(tk, data) { E.push({ tick: tk, ord: ord++, data: data }); }
      add(0, meta(0x03, utf8(c.chip + ' ' + (EN ? String(c.label).replace(/Pulso|Triângulo|Onda|Ruído/g, function (w) { return LW[w]; }) : c.label))));
      if (mc !== 9) {
        // alcance do pitch bend = ±12 semitons
        add(0, [0xB0 | mc, 101, 0]); add(0, [0xB0 | mc, 100, 0]); add(0, [0xB0 | mc, 6, 12]); add(0, [0xB0 | mc, 38, 0]);
        add(0, [0xB0 | mc, 101, 127]); add(0, [0xB0 | mc, 100, 127]);
      }
      var prog = -1, bendNow = 8192, exprNow = 127, panNow = -1;
      var drumOff = {}; // bateria: fim de cada peça, para não sobrepor a mesma nota
      var LST = notes[c.id];
      LST.forEach(function (nt, i) {
        var t0 = tick(nt.t), t1 = Math.max(t0 + 1, tick(nt.end));
        var nx = LST[i + 1];
        if (nx && !nt.dac) { var tn = tick(nx.t); if (tn <= t0) return; if (t1 > tn) t1 = tn; }
        var dur = (nt.end - nt.t) / SR;
        var drum = mc === 9 || (nt.tb && nt.tb.role === 'Percussão');
        if (drum) {
          var dn = nt.dac ? dacNote(nt.dac) : nt.noise ? noiseDrum(nt.noise, dur) : tonalDrum(nt.n);
          if (!dn) return;
          var dt1 = t0 + Math.max(12, Math.min(t1 - t0, Math.round(0.25 / spb * PPQ)));
          var prev = drumOff[dn];
          if (prev) { if (prev.tick > t0) prev.tick = t0; if (prev.tick <= prev.on) { prev.tick = prev.on + 1; if (prev.tick > t0) return; } }
          add(t0, [0x99, dn, vel(nt.dac ? nt.v * (drumCls.loud[nt.dac] || 1) : nt.v)]); add(dt1, [0x89, dn, 0]); count++;
          drumOff[dn] = E[E.length - 1]; drumOff[dn].on = t0;
          return;
        }
        var pg = program(nt.tb);
        if (pg !== prog) { add(t0, [0xC0 | mc, pg]); prog = pg; }
        if (nt.pan !== undefined && nt.pan !== panNow) { add(t0, [0xB0 | mc, 10, nt.pan]); panNow = nt.pan; }
        if (exprNow !== 127) { add(t0, [0xB0 | mc, 11, 127]); exprNow = 127; }
        var key = clamp(Math.round(nt.n), 0, 127);
        function bendFor(n) { return clamp(Math.round(8192 + (n - key) / 12 * 8192), 0, 16383); }
        var bd = bendFor(nt.n);
        if (Math.abs(bd - bendNow) > 3) { add(t0, [0xE0 | mc, bd & 127, bd >> 7]); bendNow = bd; }
        add(t0, [0x90 | mc, key, vel(nt.v)]); count++;
        var curKey = key, vOn = nt.v;
        nt.ev.forEach(function (e) {
          var tk = Math.min(Math.max(t0, tick(e.t)), t1);
          if (e.n !== undefined) {
            if (Math.abs(e.n - curKey) > 11.5) { // passou do alcance do bend: começa outra nota
              add(tk, [0x80 | mc, curKey, 0]);
              curKey = key = clamp(Math.round(e.n), 0, 127);
              var b2 = bendFor(e.n); add(tk, [0xE0 | mc, b2 & 127, b2 >> 7]); bendNow = b2;
              add(tk, [0x90 | mc, curKey, vel(vOn)]); count++;
            } else {
              var b = bendFor(e.n);
              if (Math.abs(b - bendNow) > 3) { add(tk, [0xE0 | mc, b & 127, b >> 7]); bendNow = b; }
            }
          } else if (e.k === 'vol') {
            var x = clamp(Math.round(127 * Math.sqrt(e.v / Math.max(vOn, 1e-4))), 0, 127);
            if (Math.abs(x - exprNow) >= 2) { add(tk, [0xB0 | mc, 11, x]); exprNow = x; }
          } else if (e.k === 'pan') {
            if (e.pan !== panNow) { add(tk, [0xB0 | mc, 10, e.pan]); panNow = e.pan; }
          }
        });
        add(t1, [0x80 | mc, curKey, 0]);
      });
      // (os eventos já entram em ordem: o fim de uma nota vem antes do início da próxima no mesmo tick)
      tracks.push(track(E));
    });

    var hdr = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
    var total = hdr.length; tracks.forEach(function (t) { total += t.length; });
    var out = new Uint8Array(total), pos = 0;
    out.set(hdr, pos); pos += hdr.length;
    tracks.forEach(function (t) { out.set(t, pos); pos += t.length; });
    return { bytes: out, bpm: bpm, tempoDetectado: !!tp, notas: count, trilhas: chans.length };
  }

  function fileName(res, fallback) {
    var n = (res.info && res.info.title) || fallback || 'musica';
    return n.replace(/\.(vgm|vgz)$/i, '').replace(/[\\\/:*?"<>|]+/g, '_').trim() + '.mid';
  }

  return { build: build, fileName: fileName };
})();
if (typeof module !== 'undefined') module.exports = RGMIDI;
