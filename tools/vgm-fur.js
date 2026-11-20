/* ===== VGM → Furnace (.fur) — Registro Gamer =====
   Converte o resultado de RGVGM.parse(buf, {events:true, pcm:true}) num módulo do Furnace,
   com os timbres exatos dos chips (instrumentos FM com os registradores originais,
   envelopes do PSG como macro de volume, samples do DAC do jeito que estão no VGM).
   Todos os chips do VGM: cada chip vira o sistema equivalente do Furnace; chips que o Furnace não tem
   viram samples num ES5506 de reserva.
   Gera o formato da versão 228 (abre no Furnace 0.6.8 e mais novos). */
;(function (root) {
  'use strict';

  // ---------- escritor binário ----------
  function Wr() { this.b = new Uint8Array(1 << 16); this.n = 0; }
  Wr.prototype.need = function (k) {
    if (this.n + k <= this.b.length) return;
    var nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k + 1024)); nb.set(this.b.subarray(0, this.n)); this.b = nb;
  };
  Wr.prototype.c = function (v) { this.need(1); this.b[this.n++] = v & 255; };
  Wr.prototype.s = function (v) { this.c(v); this.c(v >> 8); };
  Wr.prototype.i = function (v) { this.c(v); this.c(v >> 8); this.c(v >> 16); this.c(v >>> 24); };
  Wr.prototype.f = function (v) { var a = new DataView(new ArrayBuffer(4)); a.setFloat32(0, v, true); for (var k = 0; k < 4; k++) this.c(a.getUint8(k)); };
  Wr.prototype.tag = function (t) { for (var k = 0; k < t.length; k++) this.c(t.charCodeAt(k)); };
  Wr.prototype.str = function (t) { // UTF-8 terminada em 0
    var u = unescape(encodeURIComponent(t || ''));
    for (var k = 0; k < u.length; k++) this.c(u.charCodeAt(k));
    this.c(0);
  };
  Wr.prototype.bytes = function (a) { this.need(a.length); this.b.set(a, this.n); this.n += a.length; };
  Wr.prototype.patchI = function (at, v) { var s = this.n; this.n = at; this.i(v); this.n = s; };
  Wr.prototype.out = function () { return this.b.slice(0, this.n); };
  // bloco "TAG" + tamanho (preenchido no fim)
  Wr.prototype.block = function (t) { this.tag(t); var at = this.n; this.i(0); return at; };
  Wr.prototype.end = function (at) { this.patchI(at, this.n - at - 4); };

  // ---------- conversões de volume ----------
  function dB(v) { return v > 0 ? -20 * Math.log(v) / Math.LN10 : 999; }
  function fmVol(v) { return Math.max(0, Math.min(127, 127 - Math.round(dB(v) / 0.75))); }
  function snVol(v) { return Math.max(0, Math.min(15, 15 - Math.round(dB(v) / 2))); }
  function midiOfHz(f) { return 69 + 12 * Math.log(f / 440) / Math.LN2; }

  // detune do hardware (0..7) → valor interno do Furnace (3 = sem detune)
  var DT = [3, 4, 5, 6, 3, 2, 1, 0];

  // ---------- famílias de canal (como cada tipo de canal do Furnace recebe notas, volume e instrumento) ----------
  // nOff: soma na nota MIDI para virar a nota do Furnace (0 = C-5); vmax/vol: coluna de volume; ins: tipo do instrumento
  function linV(m) { return function (v) { return Math.max(0, Math.min(m, Math.round(v * m))); }; }
  function dbV(m, step) { return function (v) { return Math.max(0, Math.min(m, m - Math.round(dB(v) / step))); }; }
  var FAM = {
    fm:    { ins: 'fm', it: 1, nOff: 48, vmax: 127, vol: fmVol, pan: 'fm' },
    opm:   { ins: 'fm', it: 33, nOff: 48, vmax: 127, vol: fmVol, pan: 'fm' },
    opl:   { ins: 'opl', it: 14, nOff: 48, vmax: 63, vol: dbV(63, 0.75), pan: null },
    opll:  { ins: 'opl', it: 13, nOff: 48, vmax: 15, vol: dbV(15, 3), pan: null },
    sn:    { ins: 'psg', it: 0, nOff: 24, vmax: 15, vol: snVol, early: 1 },
    ay:    { ins: 'psg', it: 6, nOff: 48, vmax: 15, vol: dbV(15, 1.5) },
    ay8930:{ ins: 'psg', it: 7, nOff: 48, vmax: 31, vol: dbV(31, 0.75) },
    gb:    { ins: 'psg', it: 2, nOff: 48, vmax: 15, vol: linV(15) },
    gbW:   { ins: 'psg', it: 2, nOff: 60, vmax: 15, vol: linV(15) },
    nes:   { ins: 'psg', it: 34, nOff: 36, vmax: 15, vol: linV(15) },
    nesT:  { ins: 'psg', it: 34, nOff: 48, vmax: 15, vol: linV(15) },
    pce:   { ins: 'psg', it: 5, nOff: 36, vmax: 31, vol: dbV(31, 1.5) },
    scc:   { ins: 'psg', it: 18, nOff: 36, vmax: 15, vol: linV(15) },
    vsu:   { ins: 'psg', it: 16, nOff: 48, vmax: 15, vol: linV(15) },
    ws:    { ins: 'psg', it: 22, nOff: 36, vmax: 15, vol: linV(15) },
    saa:   { ins: 'psg', it: 9, nOff: 48, vmax: 15, vol: linV(15) },
    pokey: { ins: 'psg', it: 20, nOff: 48, vmax: 15, vol: linV(15) },
    x1:    { ins: 'psg', it: 25, nOff: 36, vmax: 15, vol: linV(15) },
    fds:   { ins: 'psg', it: 15, nOff: 36, vmax: 32, vol: linV(32) },
    mikey: { ins: 'psg', it: 23, nOff: 12, vmax: 127, vol: linV(127), lynx: 1 },
    vrc6:  { ins: 'psg', it: 12, nOff: 36, vmax: 15, vol: linV(15) },
    vrc6S: { ins: 'psg', it: 26, nOff: 36, vmax: 42, vol: linV(42) },
    n163:  { ins: 'psg', it: 17, nOff: 36, vmax: 15, vol: linV(15), n163: 1 },
    c64:   { ins: 'psg', it: 3, nOff: 48, vmax: 15, vol: function () { return -1; }, c64: 1 },   // C64: volume é do chip todo; o envelope vem do ADSR
    dac:   { ins: 'smp', it: 4, nOff: 48, vmax: 127, vol: fmVol },
    rhythm:{ ins: 'rhythm', it: 37, nOff: 48, vmax: 31, vol: dbV(31, 0.75) },
    oplDrum:  { ins: 'opl', it: 14, nOff: 48, vmax: 63, vol: dbV(63, 0.75) },
    opllDrum: { ins: 'opl', it: 13, nOff: 48, vmax: 15, vol: dbV(15, 3) }
  };
  // canais de sample: tipo de instrumento do chip, volume máximo e se o chip toca numa taxa fixa (o sample é refeito nessa taxa)
  function pcmFam(it, vmax, opt) { opt = opt || {}; return { ins: 'smp', it: it, nOff: opt.nOff || 48, vmax: vmax, vol: opt.noVol ? function () { return -1; } : opt.db ? dbV(vmax, opt.db) : linV(vmax), fixed: opt.fixed || 0, pan: opt.pan ? 'pcm' : null }; }
  // canal 2 do WonderSwan: onda ou PCM (modo voz), conforme o timbre da nota
  FAM.ws2 = { ins: 'psg', it: 22, nOff: 36, vmax: 15, vol: linV(15), alt: pcmFam(4, 15, { nOff: 48 }) };

  // ---------- chips → sistemas do Furnace ----------
  // cada entrada devolve { id, n, name, ch: [{n: nome, s: curto, f: família}], at(label, ev) → índice do canal }
  function numOf(l) { var m = /(\d+)\s*$/.exec(l); return m ? +m[1] : 0; }
  function chans(list) { return list.map(function (x) { return { n: x[0], s: x[1], f: x[2] }; }); }
  function seq(n, name, short, f) { var a = []; for (var i = 1; i <= n; i++) a.push([name + ' ' + i, short + i, f]); return a; }
  var DRUM_OPL = { 36: 0, 35: 0, 38: 1, 40: 1, 45: 2, 47: 2, 48: 2, 50: 2, 41: 2, 43: 2, 49: 3, 51: 3, 57: 3, 42: 4, 44: 4, 46: 4, 37: 1, 39: 1 };
  function SYSDEF(base, labels, res) {
    var has = function (re) { return labels.some(function (l) { return re.test(l); }); };
    switch (base) {
      case 'YM2612': return { id: 0x83, name: 'YM2612', ch: chans(seq(6, 'FM', 'F', 'fm')), at: function (l) { return /DAC/.test(l) ? 5 : numOf(l) - 1; }, dac: 5 };
      case 'SN76489': return { id: 0x03, name: 'SN76489', ch: chans(seq(3, 'PSG', 'S', 'sn').concat([[tr('Ruído', 'Noise'), 'NO', 'sn']])), at: function (l) { return /Ruído/.test(l) ? 3 : numOf(l) - 1; } };
      case 'YM2151': return { id: 0x82, name: 'YM2151', ch: chans(seq(8, 'FM', 'F', 'opm')), at: function (l) { return numOf(l) - 1; } };
      case 'YM2203': return { id: 0x8d, name: 'YM2203', ch: chans(seq(3, 'FM', 'F', 'fm').concat(seq(3, 'SSG', 'S', 'ay'))),
        at: function (l) { var m = /SSG ([ABC])/.exec(l); return m ? 3 + 'ABC'.indexOf(m[1]) : numOf(l) - 1; } };
      case 'YM2608': return { id: 0x8e, name: 'YM2608', ch: chans(seq(6, 'FM', 'F', 'fm').concat(seq(3, 'SSG', 'S', 'ay'),
          [['Kick', 'BD', 'rhythm'], ['Snare', 'SD', 'rhythm'], ['Top', 'TP', 'rhythm'], ['HiHat', 'HH', 'rhythm'], ['Tom', 'TM', 'rhythm'], ['Rim', 'RM', 'rhythm'], ['ADPCM-B', 'PB', pcmFam(38, 255)]])),
        at: function (l) {
          var m = /SSG ([ABC])/.exec(l); if (m) return 6 + 'ABC'.indexOf(m[1]);
          if (/ADPCM-B/.test(l)) return 15;
          var r = ['Bumbo', 'Caixa', 'Prato', 'Chimbal', 'Tom', 'Aro'].findIndex(function (x) { return l.indexOf('· ' + x) >= 0 || l === 'Bateria · ' + x; }); if (r >= 0) return 9 + r;
          return numOf(l) - 1;
        } };
      case 'YM2610': {
        var B = has(/FM [14]$/);   // YM2610B usa os 6 canais FM
        if (B) return { id: 0x9e, name: 'YM2610B', ch: chans(seq(6, 'FM', 'F', 'fm').concat(seq(3, 'SSG', 'S', 'ay'), seq(6, 'ADPCM-A', 'PA', pcmFam(37, 31, { fixed: 18518, db: 0.75 })), [['ADPCM-B', 'PB', pcmFam(38, 255)]])),
          at: function (l) { var m = /SSG ([ABC])/.exec(l); if (m) return 6 + 'ABC'.indexOf(m[1]); if (/ADPCM-A/.test(l)) return 8 + numOf(l); if (/ADPCM-B/.test(l)) return 15; return numOf(l) - 1; } };
        return { id: 0xa5, name: 'YM2610', ch: chans(seq(4, 'FM', 'F', 'fm').concat(seq(3, 'SSG', 'S', 'ay'), seq(6, 'ADPCM-A', 'PA', pcmFam(37, 31, { fixed: 18518, db: 0.75 })), [['ADPCM-B', 'PB', pcmFam(38, 255)]])),
          at: function (l) { var m = /SSG ([ABC])/.exec(l); if (m) return 4 + 'ABC'.indexOf(m[1]); if (/ADPCM-A/.test(l)) return 6 + numOf(l); if (/ADPCM-B/.test(l)) return 13; return { 2: 0, 3: 1, 5: 2, 6: 3 }[numOf(l)]; } };
      }
      case 'YM2413': case 'YM3526': case 'YM3812': case 'Y8950': case 'YMF262': {
        var dr = has(/Bateria/), opll = base === 'YM2413', n = base === 'YMF262' ? 18 : 9, f = opll ? 'opll' : 'opl';
        var id = { YM2413: [0x89, 0xa7], YM3526: [0x8f, 0xa2], YM3812: [0x90, 0xa3], Y8950: [0xb2, 0xb3], YMF262: [0x91, 0xa4] }[base][dr ? 1 : 0];
        var nm = n - (dr ? 3 : 0), list = seq(nm, 'FM', 'F', f);
        if (dr) list = list.concat(opll ? [['Kick', 'BD', 'opllDrum'], ['Snare', 'SD', 'opllDrum'], ['Tom', 'TM', 'opllDrum'], ['Top', 'TP', 'opllDrum'], ['HiHat', 'HH', 'opllDrum']]
          : [['Kick/FM 7', 'BD', 'oplDrum'], ['Snare', 'SD', 'oplDrum'], ['Tom', 'TM', 'oplDrum'], ['Top', 'TP', 'oplDrum'], ['HiHat', 'HH', 'oplDrum']]);
        if (base === 'YMF262' && dr) list = seq(6, 'FM', 'F', f).concat(list.slice(6, 11), seq(9, 'FM', 'F', f).map(function (x, i) { return ['FM ' + (10 + i), 'F' + (10 + i), f]; }));
        if (base === 'Y8950') list.push(['ADPCM', 'P', pcmFam(38, 255)]);
        var drum0 = base === 'YMF262' && dr ? 6 : nm;
        return { id: id, name: base + (dr ? ' ' + tr('com bateria', 'with drums') : ''), ch: chans(list),
          at: function (l, e) {
            if (/ADPCM/.test(l)) return list.length - 1;
            if (/Bateria/.test(l)) { var k = e && e.noise ? DRUM_OPL[e.noise.d] : null; return drum0 + (k == null ? 0 : k); }
            var c = numOf(l) - 1; if (dr && c >= 6 && c < 9) return null;   // canais 7-9 viram bateria no modo ritmo
            if (base === 'YMF262' && dr && c >= 9) return c + 2;
            return c;
          } };
      }
      case 'YMF278B': return { id: 0xae, name: 'YMF278B (OPL4)', ch: chans(seq(18, 'FM', 'F', 'opl').concat(seq(24, 'PCM', 'P', pcmFam(28, 127, { pan: 1 })))),
        at: function (l) { return /PCM/.test(l) ? 17 + numOf(l) : numOf(l) - 1; } };
      case 'AY-3-8910': return { id: 0x80, name: 'AY-3-8910', ch: chans(seq(3, 'PSG', 'S', 'ay')), at: function (l) { var m = /SSG ([ABC])/.exec(l); return m ? 'ABC'.indexOf(m[1]) : null; } };
      case 'AY8930': return { id: 0x9a, name: 'AY8930', ch: chans(seq(3, 'PSG', 'S', 'ay8930')), at: function (l) { var m = /SSG ([ABC])/.exec(l); return m ? 'ABC'.indexOf(m[1]) : null; } };
      case 'Game Boy': return { id: 0x04, name: 'Game Boy', ch: chans([['Pulse 1', 'S1', 'gb'], ['Pulse 2', 'S2', 'gb'], ['Wave', 'WA', 'gbW'], ['Noise', 'NO', 'gb']]),
        at: function (l) { return /Ruído/.test(l) ? 3 : /Onda/.test(l) ? 2 : numOf(l) - 1; } };
      case 'NES APU': return { id: 0x06, name: 'NES', ch: chans([['Pulse 1', 'S1', 'nes'], ['Pulse 2', 'S2', 'nes'], ['Triangle', 'TR', 'nesT'], ['Noise', 'NO', 'nes'], ['DPCM', 'DMC', pcmFam(4, 15)]]),
        at: function (l) { return /DPCM/.test(l) ? 4 : /Ruído/.test(l) ? 3 : /Tri/.test(l) ? 2 : numOf(l) - 1; } };
      case 'VRC6': return { id: 0x88, name: 'VRC6', ch: chans([['Pulse 1', 'V1', 'vrc6'], ['Pulse 2', 'V2', 'vrc6'], ['Saw', 'VS', 'vrc6S']]), at: function (l) { return /Serra/.test(l) ? 2 : numOf(l) - 1; } };
      case 'N163': {
        // canais do N163: o Furnace numera a partir do último registrador (canal 8 do chip = 1º do Furnace)
        var nch = 1; (res.timbres || []).forEach(function (t) { if (t.chip === 'N163' && t.np) nch = Math.max(nch, t.np.nch || 1); });
        labels.forEach(function (l) { var k = numOf(l); if (k) nch = Math.max(nch, 9 - k); });
        return { id: 0x8c, name: 'Namco 163', flags: 'channels=' + (nch - 1), ch: chans(seq(8, 'Channel', 'N', 'n163')), at: function (l) { return 8 - numOf(l); } };
      }
      case 'VRC7': return { id: 0x9d, name: 'VRC7', ch: chans(seq(6, 'FM', 'F', 'opll')), at: function (l) { return numOf(l) - 1; } };
      case 'MMC5': return { id: 0x8b, name: 'MMC5', ch: chans([['Pulse 1', 'S1', 'nes'], ['Pulse 2', 'S2', 'nes'], ['PCM', 'PCM', pcmFam(4, 255)]]), at: function (l) { return /Pulso/.test(l) ? numOf(l) - 1 : null; } };
      case 'SID': { var m85 = /8580/.test((res.info && res.info.system) || ''); return { id: m85 ? 0x07 : 0x47, name: 'C64 (' + (m85 ? '8580' : '6581') + ')', ch: chans(seq(3, 'Channel', 'C', 'c64')), at: function (l) { return numOf(l) - 1; } }; }
      case 'S-DSP': return { id: 0x87, name: 'SNES', ch: chans(seq(8, 'Channel', 'C', pcmFam(29, 74, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      // Nintendo DS e GBA têm sistemas próprios no Furnace: o arquivo fica no console de origem (não no ES5506 de reserva)
      case 'NDS': return { id: 0xd6, name: 'Nintendo DS', ch: chans(seq(16, 'Channel', 'C', pcmFam(59, 127, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'GBA': { var gn = 1; labels.forEach(function (l) { gn = Math.max(gn, numOf(l)); }); return { id: 0xd8, name: 'GBA MinMod', flags: 'channels=' + gn, ch: chans(seq(16, 'Channel', 'C', pcmFam(61, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } }; }
      // PlayStation: sistema próprio do Tracker do blog (ID 0x52, não existe no Furnace oficial)
      case 'SPU': return { id: 0x52, name: 'Sony PlayStation SPU', ch: chans(seq(24, 'Voice', 'V', pcmFam(4, 100, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'NES FDS': return { id: 0x8a, name: 'FDS', ch: chans([['FDS', 'FDS', 'fds']]), at: function () { return 0; } };
      case 'HuC6280': return { id: 0x05, name: 'PC Engine', ch: chans(seq(6, 'Channel', 'C', 'pce')), at: function (l) { return numOf(l) - 1; } };
      case 'K051649': case 'K052539': return { id: base === 'K052539' ? 0xb4 : 0xa1, name: base === 'K052539' ? 'SCC+' : 'SCC', ch: chans(seq(5, 'Channel', 'C', 'scc')), at: function (l) { return numOf(l) - 1; } };
      case 'VSU': return { id: 0x9c, name: 'Virtual Boy', ch: chans(seq(5, 'Channel', 'C', 'vsu').concat([['Noise', 'NO', 'vsu']])), at: function (l) { return /Ruído/.test(l) ? 5 : numOf(l) - 1; } };
      case 'WonderSwan': return { id: 0x96, name: 'WonderSwan', ch: chans([['Wave', 'W1', 'ws'], ['Wave/PCM', 'W2', 'ws2'], ['Wave/Sweep', 'W3', 'ws'], ['Wave/Noise', 'W4', 'ws']]),
        at: function (l) { return /PCM/.test(l) ? 1 : numOf(l) - 1; } };   // o PCM do WonderSwan toca no canal 2 (modo voz)
      case 'Mikey': return { id: 0xa8, name: 'Atari Lynx', ch: chans(seq(4, 'Channel', 'C', 'mikey')), at: function (l) { return numOf(l) - 1; } };
      case 'OKIM6258': {
        // MSM6258 do Furnace: taxa = clock / 512 (4 MHz → 7812 Hz; 8 MHz → 15625 Hz, a do X68000); acima de 16 kHz fica no ES5506
        var mr = 0; (res.timbres || []).forEach(function (t) { if (t.chip === 'OKIM6258' && t.type === 'pcm') mr = Math.max(mr, t.rate || 0); });
        var opt = [[0, 7812.5], [1, 8000], [2, 15625], [3, 16000]].filter(function (o) { return o[1] >= mr * 0.98; })[0];
        if (!opt) return null;
        return { id: 0xab, name: 'MSM6258', flags: 'clockSel=' + opt[0], ch: chans([['ADPCM', 'A', pcmFam(35, 0, { fixed: opt[1], noVol: 1 })]]), at: function () { return 0; } };
      }
      case '32X PWM': return { id: 0xc0, name: 'PCM DAC (32X PWM)', ch: chans([['PWM', 'PWM', pcmFam(4, 255)]]), at: function () { return 0; } };
      case 'SAA1099': return { id: 0x97, name: 'SAA1099', ch: chans(seq(6, 'PSG', 'S', 'saa')), at: function (l) { return numOf(l) - 1; } };
      case 'Pokey': return { id: 0x94, name: 'POKEY', ch: chans(seq(4, 'Channel', 'C', 'pokey')), at: function (l) { return numOf(l) - 1; } };
      case 'X1-010': return { id: 0xb0, name: 'X1-010', ch: chans(seq(16, 'Channel', 'C', 'x1')), at: function (l) { return numOf(l) - 1; } };
      case 'SegaPCM': return { id: 0x9b, name: 'SegaPCM', ch: chans(seq(16, 'PCM', 'P', pcmFam(39, 127, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'OKIM6295': return { id: 0xaa, name: 'MSM6295', ch: chans(seq(4, 'ADPCM', 'A', pcmFam(36, 8, { fixed: 8000, db: 3 }))), at: function (l) { return numOf(l) - 1; } };
      case 'K053260': return { id: 0xcc, name: 'K053260', ch: chans(seq(4, 'PCM', 'P', pcmFam(50, 127, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'RF5C68': case 'RF5C164': return { id: 0x95, name: 'RF5C68', ch: chans(seq(8, 'PCM', 'P', pcmFam(42, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'C140': return { id: 0xce, name: 'C140', ch: chans(seq(24, 'PCM', 'P', pcmFam(53, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'C219': return { id: 0xcf, name: 'C219', ch: chans(seq(16, 'PCM', 'P', pcmFam(54, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'QSound': return { id: 0xe0, name: 'QSound', ch: chans(seq(16, 'PCM', 'P', pcmFam(40, 255, { pan: 1 })).concat(seq(3, 'ADPCM', 'A', pcmFam(40, 255)))), at: function (l) { return numOf(l) - 1; } };
      case 'YMZ280B': return { id: 0xb8, name: 'YMZ280B', ch: chans(seq(8, 'PCM', 'P', pcmFam(41, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'GA20': return { id: 0xc7, name: 'GA20', ch: chans(seq(4, 'PCM', 'P', pcmFam(46, 255))), at: function (l) { return numOf(l) - 1; } };
      case 'MultiPCM': return { id: 0x92, name: 'MultiPCM', ch: chans(seq(28, 'PCM', 'P', pcmFam(28, 127, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
      case 'ES5506': case 'ES5505': return { id: 0xb1, name: 'ES5506', ch: chans(seq(32, 'PCM', 'P', pcmFam(27, 255, { pan: 1 }))), at: function (l) { return numOf(l) - 1; } };
    }
    return null;   // sem sistema equivalente no Furnace: vai para os canais de sample de reserva (ES5506)
  }
  var FALLBACK_FAM = pcmFam(27, 255, { pan: 1, db: 0.376 });   // ES5506: volume em escala logarítmica (~0,38 dB por passo)
  // ---------- volume de cada chip, como no libvgm (o player de referência do VGM) ----------
  // CHIP_P: quanto o Furnace precisa de ganho para um chip soar como no libvgm (medido tocando cada chip sozinho nos dois);
  // o libvgm ainda pesa cada chip (tabela de volumes) e normaliza o conjunto em potências de 2 — o conversor refaz essa conta
  var CHIP_P = { YM2612: 0.68, SN76489: 0.37, YM2151: 1.02, OKIM6295: 1.32, HuC6280: 1.09, 'Game Boy': 1.45, K053260: 1.67, YM3812: 3.7, YM3526: 3.7, Y8950: 3.7,
    YMF262: 1.09, YM2413: 0.44, 'NES APU': 1.49, 'NES FDS': 1.49, QSound: 0.27, 'AY-3-8910': 4.8, AY8930: 4.8, SegaPCM: 2.27, YM2203: 0.97, YM2608: 1.1, YM2610: 1.22,
    '32X PWM': 0.89, YMZ280B: 1.66, K051649: 1.14, K052539: 1.14, GA20: 1.78, 'X1-010': 0.89, Pokey: 1.72, C140: 0.45, C219: 0.45, OKIM6258: 1.36,
    WonderSwan: 2.08, VSU: 3.57, RF5C68: 0.66, RF5C164: 0.66, YMF278B: 0.65, NDS: 2.25, GBA: 3.5, SPU: 1.0, 'S-DSP': 1.77, reserva: 0.56 };
  var HDR_IDX = { SN76489: 0, YM2413: 1, YM2612: 2, YM2151: 3, SegaPCM: 4, RF5C68: 5, YM2203: 6, YM2608: 7, YM2610: 8, YM3812: 9, YM3526: 10, Y8950: 11, YMF262: 12,
    YMF278B: 13, YMF271: 14, YMZ280B: 15, RF5C164: 16, '32X PWM': 17, 'AY-3-8910': 18, AY8930: 18, 'Game Boy': 19, 'NES APU': 20, 'NES FDS': 20, MultiPCM: 21,
    uPD7759: 22, OKIM6258: 23, OKIM6295: 24, K051649: 25, K052539: 25, K054539: 26, HuC6280: 27, C140: 28, C219: 28, K053260: 29, Pokey: 30, QSound: 31,
    SCSP: 32, WonderSwan: 33, VSU: 34, SAA1099: 35, ES5503: 36, ES5506: 37, ES5505: 37, 'X1-010': 38, C352: 39, GA20: 40, Mikey: 41 };
  var LV_CV = [0x80, 0x200, 0x100, 0x100, 0x180, 0xB0, 0x100, 0x80, 0x80, 0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0x98, 0x80, 0xE0, 0x100, 0xC0, 0x100, 0x40, 0x11E, 0x1C0,
    0x100, 0xA0, 0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0x20, 0x100, 0x100, 0x100, 0x40, 0x20, 0x100, 0x40, 0x280, 0x100];
  var LV_PB = [0x100, 0x80, 0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0x100, 0x200, 0x200, 0x200, 0x200, 0x100, 0x100, 0x1AF, 0x200, 0x100, 0x200, 0x400, 0x200, 0x400, 0x100, 0x200,
    0x200, 0x100, 0x100, 0x100, 0x180, 0x100, 0x100, 0x100, 0x800, 0x100, 0x100, 0x100, 0x800, 0x1000, 0x100, 0x800, 0x100, 0x200];
  function lvCv(i, n) { var v = LV_CV[i]; if (n > 1) v = Math.floor(v / n); if (i === 25) v = Math.floor(v * 8 / 5); if (i === 28) v = Math.floor((v * 2 + 1) / 3); return v; }
  function lvNorm(ch) {   // NormalizeOverallVolume do libvgm
    var est = 0;
    ch.forEach(function (c) { var i = c[0], n = c[1]; [0].concat(i >= 6 && i <= 8 ? [1] : []).forEach(function (ln) { var v = lvCv(i, n); if (ln && i === 6) v = Math.floor(v / 2); for (var k = 0; k < n; k++) est += Math.floor(Math.floor(2 * v * LV_PB[i] / 256) / 2); }); });
    var f = 1;
    if (est && est <= 0x180) while (est <= 0x180) { f *= 2; est *= 2; }
    else if (est > 0x300) while (est > 0x300) { f /= 2; est = Math.floor(est / 2); }
    return f;
  }
  var LV_K = 1 / (2 * 0.68);   // referência: o YM2612 do Mega Drive fica com volume 1
  // instrumentos padrão para as peças de bateria do OPL/OPLL (o VGM só diz qual peça bateu)
  var DOP = function (o) { var b = { ksr: 0, mul: 1, egt: 0, tl: 0, vib: 0, ar: 15, am: 0, ksl: 0, dr: 5, sl: 5, rr: 7, ws: 0 }; for (var k in o) b[k] = o[k]; return b; };
  var DEF_OPL = { type: 'opl', oplKind: 'opl2', alg: 0, fb: 0, four: false, ops: [DOP({ tl: 12 }), DOP({})] };
  var DEF_OPLL = { type: 'opl', oplKind: 'opll', alg: 0, fb: 0, four: false, ops: [DOP({ tl: 12 }), DOP({})] };

  function layout(res) {
    var L = { sys: [], map: {}, names: [], shorts: [], fam: [], route: {}, missing: [], fallback: [] };
    var byChip = {}, order = [];
    res.midi.chans.forEach(function (c) { var k = c.chip.replace(' SSG', ''); if (!byChip[k]) { byChip[k] = []; order.push(k); } byChip[k].push(c); }); // o SSG dos OPN fica no mesmo sistema
    // o DAC do YM2612 aparece como canal próprio: garante que o YM2612 exista
    if (res.dacHits && res.dacHits.length && !byChip.YM2612) { byChip.YM2612 = [{ id: 'YM2612 · DAC', label: 'DAC', chip: 'YM2612' }]; order.unshift('YM2612'); }
    if (!order.length) throw new Error(tr('Esta música não tem notas que dê para converter.', 'This song has no notes that can be converted.'));
    // YM2612 e SN76489 juntos = Mega Drive (o SN vai logo depois do YM, como no Furnace)
    var iY = order.indexOf('YM2612'), iS = order.indexOf('SN76489');
    if (iY > iS && iS >= 0) { order.splice(iY, 1); order.splice(iS, 0, 'YM2612'); }
    var fb = [];   // canais sem sistema no Furnace
    function addSys(def, chipName) {
      if (L.sys.length >= 32 || L.names.length + def.ch.length > 128) return null;
      var base = L.names.length;
      L.sys.push({ id: def.id, n: def.ch.length, vol: 1, pan: 0, fr: 0, name: def.name, flags: def.flags || '', key: chipName ? chipName.replace(/ #2$/, '') : 'reserva' });
      def.ch.forEach(function (c) { L.names.push(c.n + (chipName && / #2$/.test(chipName) ? ' #2' : '')); L.shorts.push(c.s); L.fam.push(typeof c.f === 'string' ? FAM[c.f] : c.f); });
      return base;
    }
    order.forEach(function (chip) {
      var base = chip.replace(/ #2$/, ''), cl = byChip[chip], labels = cl.map(function (c) { return c.label; });
      var def = SYSDEF(base, labels, res);
      if (!def) { cl.forEach(function (c) { fb.push(c); }); L.missing.push(chip); return; }
      // canais que o sistema do Furnace não tem (ex.: PCM do WonderSwan) vão para a reserva
      var own = cl.filter(function (c) { if (/Bateria/.test(c.label) || /^FM /.test(c.label) || def.at(c.label, null) != null) return true; fb.push(c); return false; });
      if (!own.length) return;
      var at = addSys(def, chip);
      if (at == null) { own.forEach(function (c) { fb.push(c); }); return; }
      own.forEach(function (c) { L.route[c.id] = { base: at, def: def, label: c.label }; });
    });
    // reserva: até 32 canais de sample por ES5506 (timbres de chips que o Furnace não tem viram samples)
    for (var i = 0; i < fb.length; i += 32) {
      var part = fb.slice(i, i + 32), def = { id: 0xb1, name: 'ES5506', ch: part.map(function (c, k) { return { n: c.chip + ' · ' + c.label, s: 'X' + (k + 1), f: FALLBACK_FAM }; }) };
      while (def.ch.length < 32) def.ch.push({ n: 'PCM ' + (def.ch.length + 1), s: 'P' + (def.ch.length + 1), f: FALLBACK_FAM });
      var at2 = addSys(def, null); if (at2 == null) break;
      part.forEach(function (c, k) { L.route[c.id] = { base: at2, def: { at: function () { return k; } }, label: c.label, fb: true }; L.fallback.push(c.chip); });
    }
    // volume de cada chip: medido tocando cada chip sozinho no Furnace e no libvgm (o player de referência do VGM),
    // para o equilíbrio entre os chips e o volume geral ficarem como no VGM original (YM2612 = referência)
    var hasYM = L.sys.some(function (s) { return s.id === 0x83; });
    var hd = res.hdr || { ch: [], vg: 0 }, nf = lvNorm(hd.ch), hg = Math.pow(2, hd.vg * 8 / 256);
    var nOf = function (key) { var i = HDR_IDX[key], c = hd.ch.filter(function (x) { return x[0] === i; })[0]; return c ? c[1] : 1; };
    L.sys.forEach(function (s) {
      var key = s.key, P = CHIP_P[key], cvr = 1;
      if (key === 'reserva' && L.fallback.length) { var fi = HDR_IDX[L.fallback[0]]; if (fi != null) cvr = lvCv(fi, 1) / 0x40; }
      if (!P) return;   // chip sem medição: fica em 1
      s.vol = Math.max(0.05, Math.min(8, LV_K * P * cvr * nf * hg / (key === 'reserva' ? 1 : nOf(key))));
    });
    L.chans = L.names.length;
    L.system = L.sys.map(function (s) { return s.name; }).filter(function (v, k, a) { return a.indexOf(v) === k; }).join(' + ');
    if (hasYM && L.sys.length <= 2 && L.sys.every(function (s) { return s.id === 0x83 || s.id === 0x03; })) L.system = 'Sega Genesis/Mega Drive';
    else if (L.sys.length === 1 && L.sys[0].id === 0x03) L.system = 'Sega Master System';
    L.missing = L.missing.filter(function (v, k, a) { return a.indexOf(v) === k; });
    L.fallback = L.fallback.filter(function (v, k, a) { return a.indexOf(v) === k; });
    return L;
  }
  // canal do Furnace de um evento
  function chanOf(L, e) {
    var r = L.route[e.c]; if (!r) return null;
    var k = r.def.at(r.label, e); if (k == null || k < 0) return null;
    return r.base + k;
  }

  // ---------- instrumentos ----------
  function patchS(w, a) { var s = w.n, len = s - a - 2; w.n = a; w.s(len); w.n = s; }
  // macros: [[código, valores, tamanho da palavra (0 = 8 bits sem sinal, 2 = 16 bits)]]
  function macros(w, mac) {
    if (!mac.length) return;
    w.tag('MA'); var a = w.n; w.s(0); w.s(8);
    mac.forEach(function (m) {
      var big = m[2] === 2;
      w.c(m[0]); w.c(m[1].length); w.c(255); w.c(255); w.c(0); w.c(big ? 0x80 : 0); w.c(0); w.c(1);
      m[1].forEach(function (v) { if (big) w.s(v); else w.c(v); });
    });
    w.c(255);
    patchS(w, a);
  }
  // corpo de um instrumento (tipo + blocos); usado no .fui e dentro do .fur
  // x: { it: tipo do Furnace, wave: índice da wavetable, smp: índice do sample, vmax }
  function insBody(w, t, name, x) {
    x = x || {};
    var a;
    if (x.kind === 'smp' || x.kind === 'rhythm') {
      w.s(x.it); w.tag('NA'); a = w.n; w.s(0); w.str(name); patchS(w, a);
      if (x.kind === 'smp') { w.tag('SM'); a = w.n; w.s(0); w.s(x.smp); w.c(2); w.c(0); patchS(w, a); }
      if (x.mac && x.mac.length) macros(w, x.mac);
      w.tag('EN'); return;
    }
    if (t.type === 'opl') {
      // Furnace: OPL = 14, OPLL = 13; no 4-op a ordem dos operadores é 1, 3, 2, 4
      var opll = t.oplKind === 'opll', n4 = t.four && !opll;
      w.s(x.it != null ? x.it : (opll ? 13 : 14));
      w.tag('NA'); a = w.n; w.s(0); w.str(name); patchS(w, a);
      w.tag('FM'); a = w.n; w.s(0);
      var ord = n4 ? [0, 2, 1, 3] : [0, 1], en2 = 0;
      ord.forEach(function (m, i) { if (!t.ops[m].off) en2 |= 16 << i; });
      w.c(en2 | (n4 ? 4 : 2));
      w.c(((t.alg & (n4 ? 3 : 1)) << 4) | (t.fb & 7));
      w.c(0);
      w.c((n4 ? 32 : 0) | (opll && t.opllInst ? t.opllInst & 31 : 0)); w.c(0);
      ord.forEach(function (m) {
        var o = t.ops[m];
        w.c((o.ksr ? 128 : 0) | (o.mul & 15));
        w.c((!opll && o.egt ? 128 : 0) | (o.tl & 63));
        w.c((o.vib ? 32 : 0) | (o.ar & 15));
        w.c((o.am ? 128 : 0) | ((o.ksl & 3) << 5) | (o.dr & 15));
        w.c(2 << 5);
        w.c(((o.sl & 15) << 4) | (o.rr & 15));
        w.c(opll && o.egt ? 8 : 0);
        w.c(o.ws & 7);
      });
      patchS(w, a);
    } else if (t.type === 'fm') {
      w.s(x.it != null ? x.it : (t.fmKind === 'opm' ? 33 : 1));
      w.tag('NA'); a = w.n; w.s(0); w.str(name); patchS(w, a);
      w.tag('FM'); a = w.n; w.s(0);
      var en = 0; [0, 2, 1, 3].forEach(function (m, i) { if (!t.ops[m].off) en |= 16 << i; });
      w.c(en | 4);
      w.c(((t.alg & 7) << 4) | (t.fb & 7));
      w.c(((t.ams & 3) << 3) | (t.fms & 7));
      w.c(0x20); w.c(0);
      // ordem do Furnace (registrador +0,+4,+8,+12) a partir da nossa (+0,+8,+4,+12)
      [0, 2, 1, 3].forEach(function (m) {
        var o = t.ops[m];
        w.c(((DT[o.dt & 7] & 7) << 4) | (o.mul & 15));
        w.c(o.tl & 127);
        w.c(((o.ks & 3) << 6) | (o.ar & 31));
        w.c((o.am ? 128 : 0) | (o.d1r & 31));
        w.c((2 << 5) | (o.d2r & 31));
        w.c(((o.sl & 15) << 4) | (o.rr & 15));
        w.c((o.ssg || 0) & 15);
        w.c(((o.dt2 || 0) & 3) << 3);
      });
      patchS(w, a);
    } else {
      var type = x.it != null ? x.it : ({ sn: 0, gb: 2, ay: 6, nes: 34, pce: 5, vsu: 16, scc: 18, ws: 22, saa: 9, pokey: 20, x1: 25, mikey: 23, ay8930: 7, fds: 15 }[t.chipKind] || 0);
      w.s(type);
      w.tag('NA'); a = w.n; w.s(0); w.str(name); patchS(w, a);
      if (type === 2) { w.tag('GB'); a = w.n; w.s(0); w.c(15); w.c(64); w.c(1); w.c(0); patchS(w, a); }
      if (type === 3) {   // C64: forma de onda, ADSR e largura do pulso do próprio SID
        var sd = t.sd || { ad: 0x09, sr: 0x00, pw: 2048, wf: t.wave === 'noise' ? 8 : t.wave === 'pulse' ? 4 : t.wave === 'tri' ? 1 : 2, ring: 0, sync: 0 };
        w.tag('64'); a = w.n; w.s(0);
        w.c(0x80 | (sd.wf & 15)); w.c((sd.sync ? 0x80 : 0) | (sd.ring ? 0x40 : 0)); w.c(sd.ad & 255); w.c(sd.sr & 255); w.s(sd.pw & 4095); w.s(0); w.c(0x10);   // 0x10: a largura do pulso do instrumento vale a cada nota
        patchS(w, a); w.tag('EN'); return;
      }
      if (type === 17) { w.tag('N1'); a = w.n; w.s(0); w.i(x.wave != null ? x.wave : -1); w.c(t.np ? t.np.pos : 0); w.c(t.np ? Math.min(252, t.np.len) : 32); w.c(1); w.c(0); patchS(w, a); }
      var vmax = x.vmax || (type === 5 ? 31 : type === 7 ? 31 : type === 15 ? 32 : 15); // PC Engine e AY8930: 0 a 31; FDS: 0 a 32
      var vols = (t.env || [1]).slice(0, 255).map(function (v) { return Math.max(0, Math.min(vmax, Math.round(v * vmax))); });
      while (vols.length > 1 && vols[vols.length - 1] === vols[vols.length - 2]) vols.pop();
      var mac = [];
      if (!(vols.length === 1 && vols[0] === vmax)) mac.push([0, vols]);
      if (t.wave === 'pulse' && (t.chipKind === 'nes' || t.chipKind === 'gb' || t.chipKind === 'ay8930' || t.chipKind === 'vrc6')) {
        var a89 = t.chipKind === 'ay8930', v6 = t.chipKind === 'vrc6';  // AY8930: largura do pulso de 0 a 8 vai no macro EX1 do Furnace; VRC6: 0 a 7
        var d = (t.duty || []).slice(0, 255).map(function (v) { return v < 0 ? (a89 ? 4 : v6 ? 7 : 2) : (a89 ? Math.min(8, v) : v6 ? v & 7 : v & 3); });
        while (d.length > 1 && d[d.length - 1] === d[d.length - 2]) d.pop();
        if (d.length) mac.push([a89 ? 5 : 2, d]);
      }
      if (t.wave === 'noise' && (t.chipKind === 'sn' || t.chipKind === 'nes')) mac.push([2, [t.nmode === 'periodic' ? (t.chipKind === 'sn' ? 0 : 1) : (t.chipKind === 'sn' ? 1 : 0)]]);
      if (x.wave != null && type !== 17) mac.push([3, [x.wave]]);
      if (type === 20) mac.push([3, [t.wave === 'noise' ? (t.nmode === 'periodic' ? 2 : 0) : 5]]); // POKEY: 5 = tom puro
      if (type === 6 || type === 7) mac.push([3, [t.wave === 'noise' ? 2 : 1]]);                      // AY: 1 = tom, 2 = ruído
      if (x.mac) mac = mac.concat(x.mac);
      macros(w, mac);
    }
    w.tag('EN');
  }
  function insBlock(w, t, name, x) { var at = w.block('INS2'); w.s(228); insBody(w, t, name, x); w.end(at); }

  // sample → SMP2 (16 bits; o Furnace converte para o formato de cada chip ao abrir)
  function sampleBlock(w, s) {
    var at = w.block('SMP2');
    w.str(s.name);
    var n = s.data.length;
    w.i(n); w.i(Math.round(s.rate)); w.i(Math.round(s.c4 || s.rate));
    w.c(s.u8 ? 8 : 16); w.c(0); w.c(0); w.c(0);
    if (s.loop != null && s.loop >= 0 && s.loop < n - 1) { w.i(s.loop); w.i(n); } else { w.i(-1); w.i(-1); }
    for (var k = 0; k < 4; k++) w.i(-1);
    if (s.u8) { // DAC do YM2612: sem sinal → 8 bits com sinal
      var b8 = new Uint8Array(n); for (var j = 0; j < n; j++) b8[j] = (s.data[j] - 128) & 255; w.bytes(b8);
    } else {
      var b16 = new Uint8Array(n * 2);
      for (var q = 0; q < n; q++) { var v = Math.max(-32768, Math.min(32767, Math.round(s.data[q] * 32767))); b16[q * 2] = v & 255; b16[q * 2 + 1] = (v >> 8) & 255; }
      w.bytes(b16);
    }
    w.end(at);
  }
  function resample(d, from, to) {
    if (Math.abs(from - to) < 1) return d;
    var n = Math.max(1, Math.floor(d.length * to / from)), o = new Float32Array(n), r = from / to;
    for (var i = 0; i < n; i++) { var x = i * r, k = Math.floor(x), f = x - k, a = d[Math.min(k, d.length - 1)], b = d[Math.min(k + 1, d.length - 1)]; o[i] = a + (b - a) * f; }
    return o;
  }

  // envelope normalizado (pico 1, um valor por quadro) → macro de volume 0..15 do SN
  function envMacro(env) {
    if (!env || !env.length) return null;
    var out = [];
    for (var k = 0; k < env.length && k < 255; k++) out.push(Math.max(0, 15 - Math.round(dB(env[k]) / 2)));
    // tira a cauda repetida (o último valor fica valendo)
    while (out.length > 1 && out[out.length - 1] === out[out.length - 2]) out.pop();
    if (out.length === 1 && out[0] === 15) return null;
    return out;
  }

  // ---------- timbres sem equivalente no Furnace → sample ----------
  // FM do YMF271 (OPX): toca a nota Dó 4 por 1,2 s no mesmo modelo do teclado do Studio
  var OPXA4 = [[[0, 4, 1, 2], 8, 0], [[0, 4, 1, 2], 8, 2], [[0, 5, 0, 2], 8, 0], [[0, 4, 0, 3], 8, 0], [[0, 0, 1, 6], 8, 0], [[0, 0, 1, 6], 8, 2],
    [[0, 0, 1, 2], 12, 0], [[0, 0, 1, 2], 12, 2], [[0, 4, 0, 2], 9, 0], [[0, 0, 0, 6], 9, 0], [[0, 0, 1, 0], 14, 0], [[0, 0, 1, 0], 14, 2],
    [[0, 1, 1, 1], 14, 0], [[0, 4, 0, 0], 11, 0], [[0, 0, 1, 2], 13, 0], [[0, 0, 0, 0], 15, 0]];
  var OPXA3 = [[[0, 4, 1], 2, 0], [[0, 4, 1], 2, 2], [[0, 5, 0], 2, 0], [[0, 4, 0], 3, 0], [[0, 0, 1], 6, 0], [[0, 0, 1], 6, 2], [[0, 0, 0], 7, 0], [[0, 0, 1], 7, 0]];
  var OPXA2 = [[[0, 1], 2, 0], [[0, 1], 2, 1], [[0, 0], 3, 0], [[0, 1], 3, 0]];
  var OPX_ML = [128, 64, 32, 16, 8, 256, 512, 1024];
  function opxWaveF(ws, x) {
    x -= Math.floor(x); var s = Math.sin(2 * Math.PI * x);
    switch (ws) { case 1: return s * Math.abs(s); case 2: return Math.abs(s); case 3: return x < 0.5 ? s : 0; case 4: return x < 0.5 ? Math.sin(4 * Math.PI * x) : 0; case 5: return x < 0.5 ? Math.abs(Math.sin(4 * Math.PI * x)) : 0; case 6: return 0.5; default: return s; }
  }
  function renderOPX(t, rate) {
    var n = t.ops.length, A = n === 4 ? OPXA4[t.alg & 15] : n === 3 ? OPXA3[t.alg & 7] : n === 2 ? OPXA2[t.alg & 3] : [[0], 1, 0];
    var f = 261.6256, len = Math.round(rate * 1.2), out = new Float32Array(len), ph = new Float64Array(n), o = new Float64Array(n), env = [], st = [], fb0 = 0, fb1 = 0;
    var dtRate = 44100 / rate;
    for (var k = 0; k < n; k++) { env.push(1023); st.push(0); }
    function rateOf(r) { return r ? Math.min(63, r) : 0; }
    var egc = 0, egAcc = 0;
    for (var i = 0; i < len; i++) {
      egAcc += 22050 / rate;
      while (egAcc >= 1) { egAcc -= 1; egc++;
        for (k = 0; k < n; k++) {
          var op = t.ops[k], r = rateOf([op.ar * 2, op.d1r * 2, op.d2r * 2, op.rr * 4][st[k]] || 0); if (!r || st[k] > 2) continue;
          var sh = r < 48 ? Math.max(0, 11 - (r >> 2)) : 0; if (egc & ((1 << sh) - 1)) continue;
          var inc = r < 48 ? [1, 1, 2, 2][r & 3] : Math.min(8, 1 << ((r - 48) >> 2));
          if (st[k] === 0) { env[k] -= Math.max(1, (env[k] * inc) >> 4); if (r >= 62 || env[k] <= 0) { env[k] = 0; st[k] = 1; } }
          else { env[k] += inc; var sl = op.sl === 15 ? 992 : op.sl * 32; if (st[k] === 1 && env[k] >= sl) st[k] = 2; if (env[k] >= 1023) env[k] = 1023; }
        }
      }
      var y = 0;
      for (k = 0; k < n; k++) {
        var lv = env[k] + (t.ops[k].tl << 3), amp = lv >= 1023 ? 0 : Math.pow(2, -lv / 64), mod = 0;
        if (k === 0) { var fbv = t.ops[0].fb & 7; mod = fbv ? (fb0 + fb1) * Math.pow(2, fbv - 7) : 0; }
        else { var sum = 0; for (var q = 0; q < n; q++) if (A[0][k] & (1 << q)) sum += o[q]; mod = sum * OPX_ML[t.ops[k].fb & 7] / 32; }
        var v = amp ? opxWaveF(t.ops[k].ws, ph[k] + mod) * amp : 0;
        o[k] = v; if (k === A[2]) { fb0 = fb1; fb1 = v; }
        if (A[1] & (1 << k)) y += v;
        ph[k] += f * (t.ops[k].mul ? t.ops[k].mul : 0.5) / rate;
      }
      out[i] = Math.max(-1, Math.min(1, y * 0.5));
    }
    // som que segura: repete o último trecho; som que some: toca uma vez
    var tail = 0; for (i = len - 2000; i < len; i++) tail = Math.max(tail, Math.abs(out[i]));
    return { data: out, rate: rate, loop: tail > 0.01 ? len - Math.round(rate / f) * 40 : -1, base: 60 };
  }
  // onda de 32 passos (PSG sem equivalente) → sample de um ciclo que repete
  function renderWave(t) {
    var tbl = t.tbl || [15, 0], rate = 32 * 261.6256 * 4, cyc = 128, d = new Float32Array(cyc * 4);
    if (t.wave === 'noise') { d = new Float32Array(16000); var lf = 1; for (var i = 0; i < d.length; i++) { lf = (lf >> 1) | ((((lf ^ (lf >> 1)) & 1)) << 14); d[i] = (lf & 1) ? 0.6 : -0.6; } return { data: d, rate: 16000, loop: 0, base: null }; }
    for (var j = 0; j < d.length; j++) d[j] = (tbl[Math.floor((j % cyc) * 32 / cyc)] / 7.5 - 1) * 0.7;
    return { data: d, rate: rate, loop: 0, base: 60 };
  }

  // ---------- conversão principal ----------
  // idioma dos nomes gravados no projeto (instrumentos, canais, comentário)
  var EN = false;
  function tr(pt, en) { return EN ? en : pt; }
  var ROLE_EN = { 'Percussão': 'Drums', 'Baixo': 'Bass', 'Melodia': 'Lead', 'Acompanhamento': 'Backing' };
  function role(r) { return EN ? ROLE_EN[r] || r : r; }
  var WAVE_SPEC = { pce: [32, 31], scc: [32, 255], vsu: [32, 63], ws: [32, 15], gb: [32, 15], fds: [64, 63], x1: [128, 255] };
  function build(res, opts) {
    opts = opts || {};
    EN = opts.lang === 'en';
    if (!res || !res.midi) throw new Error('VGM sem eventos (chame RGVGM.parse com {events:true, pcm:true}).');
    var L = opts.layout || layout(res);
    var hz = res.rateHz === 50 ? 50 : 60;
    var spt = 44100 / hz;
    var pcmData = (typeof RGVGM !== 'undefined' && RGVGM.pcmData) ? RGVGM.pcmData : function () { return null; };

    // batidas do DAC: recortes do fluxo (res.dacHits) quando existirem; senão os 'hit' dos eventos
    var events = res.midi.events;
    if (res.dacHits && res.dacHits.length) {
      events = events.filter(function (e) { return e.k !== 'hit'; })
        .concat(res.dacHits.map(function (h) { return { c: 'YM2612 · DAC', t: h.t, k: 'hit', id: h.id }; }))
        .sort(function (a, b) { return a.t - b.t; });
    }
    // eventos por canal do Furnace
    var per = [], famOfEv = [];
    for (var c = 0; c < L.chans; c++) per.push([]);
    events.forEach(function (e) {
      var ch = chanOf(L, e); if (ch == null || ch >= L.chans) return;
      per[ch].push({ f: Math.round(e.t / spt), e: e });
    });
    per.forEach(function (l) { l.sort(function (a, b) { return a.f - b.f; }); });

    // ---- instrumentos, wavetables e samples ----
    var insList = [], insBy = {}, smpList = [], smpBy = {}, waves = [], waveBy = {};
    var cnt = {};
    function nameFor(kind, t) { cnt[kind] = (cnt[kind] || 0) + 1; return kind + ' ' + cnt[kind] + (t && t.role ? ' · ' + role(t.role) : ''); }
    function waveIdx(t) {
      var sp = t.chipKind === 'n163' ? [(t.raw || t.tbl).length, 15] : WAVE_SPEC[t.chipKind]; if (!sp || !t.tbl) return null;
      var src = t.raw || t.tbl, mx = t.raw ? (t.rmax || 15) : 15, wd = sp[0], hi = sp[1], dv = [];
      for (var i = 0; i < wd; i++) { var v = src[Math.floor(i * src.length / wd)]; dv.push(Math.max(0, Math.min(hi, Math.round(v * hi / mx)))); }
      var key = t.chipKind + ':' + dv.join(',');
      if (waveBy[key] == null) { waveBy[key] = waves.length; waves.push({ data: dv, max: hi }); }
      return waveBy[key];
    }
    function addSample(key, mk) {
      if (smpBy[key] != null) return smpBy[key];
      var s = mk(); if (!s) return null;
      s.name = s.name || tr('Sample ', 'Sample ') + (smpList.length + 1);
      smpBy[key] = smpList.length; smpList.push(s); return smpBy[key];
    }
    // sample de um timbre "pcm": taxa C-4 para a nota escrita soar na altura certa
    function pcmSample(t, fam) {
      return addSample('p' + t.pcmId + ':' + (fam.fixed || 0), function () {
        var d = pcmData(t.pcmId); if (!d || !d.length) return null;
        var rate = t.rate, loop = t.loop;
        if (fam.fixed) { d = resample(d, rate, fam.fixed); loop = loop >= 0 ? Math.round(loop * fam.fixed / rate) : -1; rate = fam.fixed; }
        var c4 = t.base != null && !fam.fixed ? rate * Math.pow(2, (60 - t.base) / 12) : rate;
        return { data: d, rate: rate, c4: c4, loop: loop, name: (t.chip || '') + ' ' + (t.base == null ? tr('bateria', 'drum') : tr('sample', 'sample')) + ' ' + (smpList.length + 1) };
      });
    }
    function insFor(t, fam, chIdx) {
      if (!t && fam === FAM.oplDrum) t = DEF_OPL;
      if (!t && fam === FAM.opllDrum) t = DEF_OPLL;
      if (!t) return null;
      if (fam.alt && t.type === 'pcm') return insFor(t, fam.alt, chIdx);
      var key;
      if (fam === FALLBACK_FAM && t.type !== 'pcm') {
        // timbre de chip sem equivalente: vira sample
        key = 'fbk:' + (t.pcmId || JSON.stringify([t.type, t.alg, t.ops, t.tbl, t.wave]));
        if (insBy[key] == null) {
          var si;
          if (t.type === 'pcm') si = pcmSample(t, fam);
          else si = addSample(key, function () { var r = t.type === 'opx' ? renderOPX(t, 32000) : renderWave(t); r.c4 = r.base != null ? r.rate * Math.pow(2, (60 - r.base) / 12) : r.rate; r.name = (t.chip || '') + ' ' + (smpList.length + 1); return r; });
          if (si == null) return null;
          insBy[key] = insList.length; insList.push({ t: t, name: nameFor(t.type === 'opx' ? 'FM' : 'Sample', t), x: { kind: 'smp', it: fam.it, smp: si } });
        }
        return insBy[key];
      }
      if (fam.ins === 'smp') {
        if (t.type !== 'pcm') return null;
        var si2 = pcmSample(t, fam); if (si2 == null) return null;
        key = 's' + fam.it + ':' + si2;
        if (insBy[key] == null) { insBy[key] = insList.length; insList.push({ t: t, name: nameFor(t.base == null ? tr('Bateria', 'Drum') : 'Sample', t), x: { kind: 'smp', it: fam.it, smp: si2 } }); }
        return insBy[key];
      }
      if (fam.ins === 'rhythm') {
        key = 'rhythm'; if (insBy[key] == null) { insBy[key] = insList.length; insList.push({ t: t, name: tr('Bateria interna', 'Rhythm'), x: { kind: 'rhythm', it: 37 } }); }
        return insBy[key];
      }
      if (fam.ins === 'fm') {
        if (t.type !== 'fm') return null;
        key = 'f' + fam.it + '|' + [t.alg, t.fb, t.ams, t.fms].join(',') + '|' + t.ops.map(function (o) { return [DT[o.dt & 7], o.mul, o.tl, o.ks, o.ar, o.am ? 1 : 0, o.d1r, o.d2r, o.sl, o.rr, o.ssg & 15, o.dt2 & 3].join(','); }).join('|');
        if (insBy[key] == null) { insBy[key] = insList.length; insList.push({ t: t, name: nameFor('FM', t), x: { it: fam.it } }); }
        return insBy[key];
      }
      if (fam.ins === 'opl') {
        if (t.type !== 'opl') return null;
        key = 'o' + fam.it + '|' + JSON.stringify([t.alg, t.fb, t.four, t.ops]);
        if (insBy[key] == null) { insBy[key] = insList.length; insList.push({ t: t, name: nameFor('FM', t), x: { it: fam.it } }); }
        return insBy[key];
      }
      // PSG
      if (t.type !== 'psg') return null;
      var wi = t.wave === 'wave' && !fam.lynx ? waveIdx(t) : null;
      key = 'g' + fam.it + '|' + t.wave + '|' + t.nmode + '|' + (wi == null ? '' : wi) + '|' + (t.mk && fam.lynx ? t.mk.duty + ':' + t.mk.lfsr : '') + '|' + (t.env || []).map(function (v) { return Math.round(v * fam.vmax); }).join(',') + '|' + (t.duty || []).join(',');
      if (insBy[key] == null) {
        insBy[key] = insList.length;
        // Lynx: o som vem do LFSR (realimentação no macro de duty, valor inicial no EX1), não de uma wavetable
        var lx = fam.lynx && t.mk ? [[2, [t.mk.duty], 2], [5, [t.mk.lfsr], 2]] : null;
        insList.push({ t: t, name: nameFor(t.wave === 'noise' ? tr('Ruído', 'Noise') : t.wave === 'wave' ? tr('Onda', 'Wave') : 'PSG', t), x: { it: fam.it, wave: lx ? null : wi, vmax: fam.vmax, mac: lx } });
      }
      return insBy[key];
    }
    // DAC do YM2612 (batidas recortadas)
    var hitSmp = {};
    function hitIns(id) {
      if (hitSmp[id] != null) return hitSmp[id];
      var p = res.pcm && res.pcm[id]; if (!p) return (hitSmp[id] = null);
      var si = addSample('dac:' + id, function () { return { data: p.data, rate: p.rate, c4: p.rate, u8: true, loop: -1, name: tr('Bateria ', 'Drum ') + (smpList.length + 1) }; });
      hitSmp[id] = insList.length; insList.push({ t: null, name: tr('Bateria ', 'Drum ') + (cnt.dac = (cnt.dac || 0) + 1), x: { kind: 'smp', it: 4, smp: si } });
      return hitSmp[id];
    }
    // instrumento de cada nota (na ordem do tempo)
    for (c = 0; c < L.chans; c++) per[c].forEach(function (x) {
      var e = x.e;
      if (e.k === 'hit') x.ins = hitIns(e.id);
      else if (e.k === 'on') x.ins = insFor(e.tb, L.fam[c], c);
    });
    if (smpList.length > 255) throw new Error(tr('Samples demais para um módulo (', 'Too many samples for one module (') + smpList.length + ').');
    if (insList.length > 255) {
      // limite do módulo: os instrumentos de PSG mais raros juntam com o primeiro do mesmo tipo
      var uses = new Array(insList.length).fill(0);
      per.forEach(function (l) { l.forEach(function (x) { if (x.ins != null) uses[x.ins]++; }); });
      var ord = insList.map(function (_, i) { return i; }).sort(function (a, b) { return uses[b] - uses[a]; });
      var keep = {}, remap = {}, kept = [];
      ord.forEach(function (i, k) { if (k < 255) { keep[i] = kept.length; kept.push(insList[i]); } });
      ord.forEach(function (i) { if (keep[i] == null) { var it = insList[i].x.it, alt = kept.findIndex(function (y) { return y.x.it === it && y.x.kind === insList[i].x.kind; }); remap[i] = alt >= 0 ? alt : 0; } else remap[i] = keep[i]; });
      per.forEach(function (l) { l.forEach(function (x) { if (x.ins != null) x.ins = remap[x.ins]; }); });
      insList = kept;
    }

    var totalF = Math.ceil((res.totalSamples || 0) / spt);
    per.forEach(function (l) { if (l.length) totalF = Math.max(totalF, l[l.length - 1].f + 1); });

    // quadros por linha: o maior R em que quase não há duas notas na mesma linha do mesmo canal
    var onsets = per.map(function (l, ch) { var sh = L.fam[ch].early || 0; return l.filter(function (x) { return x.e.k === 'on' || x.e.k === 'hit'; }).map(function (x) { return Math.max(0, x.f - sh); }); });
    var nOn = onsets.reduce(function (s, l) { return s + l.length; }, 0) || 1;
    function bestPhase(R) {
      var h = new Array(R).fill(0);
      onsets.forEach(function (l) { l.forEach(function (f) { h[f % R]++; }); });
      var p = 0; for (var k = 1; k < R; k++) if (h[k] > h[p]) p = k;
      return p;
    }
    function collisions(R, p) {
      // devolve o total de notas que cairiam na mesma linha; um canal com muitas colisões desqualifica o R
      // conta só as colisões a mais do que já existem com 1 quadro por linha (essas não têm como evitar)
      var col = 0, worst = 0;
      onsets.forEach(function (l, ci) {
        var last = -1, cc = 0;
        l.forEach(function (f) { var r = Math.floor((f + (R - p) % R) / R); if (r === last) cc++; last = r; });
        cc -= base1[ci]; if (cc < 0) cc = 0;
        col += cc; if (l.length >= 20) worst = Math.max(worst, cc / l.length);
      });
      return worst > 0.01 ? 1e9 : col;
    }
    var base1 = onsets.map(function (l) { var last = -1, cc = 0; l.forEach(function (f) { if (f === last) cc++; last = f; }); return cc; });
    var R = opts.rowFrames || 0, phase = 0;
    if (!R) {
      R = 1;
      for (var cand = 16; cand >= 2; cand--) {
        var p = bestPhase(cand);
        if (collisions(cand, p) <= nOn * 0.004 && Math.ceil(totalF / cand) <= 256 * 256) { R = cand; break; }
      }
    }
    phase = R > 1 ? bestPhase(R) : 0;
    if (opts.rowFrames && opts.phase != null) phase = opts.phase;

    // em vez de cortar o começo, adianta a grade com um pouco de silêncio no início (o tempo relativo fica exato)
    var lead = (R - phase) % R;
    var lastRow = Math.max(0, Math.ceil((totalF + lead) / R) - 1);
    var rowsPerSec = hz / R;
    var patLen = opts.patLen || Math.max(32, Math.min(256, Math.round(rowsPerSec * 6 / 16) * 16));
    var nOrd = Math.ceil((lastRow + 1) / patLen);
    while (nOrd > 256 && patLen < 256) { patLen = Math.min(256, patLen * 2); nOrd = Math.ceil((lastRow + 1) / patLen); }
    if (nOrd > 256) { lastRow = 256 * patLen - 1; nOrd = 256; }

    // células: grid[canal][linha] = {note, ins, vol, fx:{código:valor}, d (atraso da nota)}
    var grid = [];
    for (c = 0; c < L.chans; c++) grid.push(new Map());
    function cell(ch, r) { var m = grid[ch], x = m.get(r); if (!x) { x = { fx: {} }; m.set(r, x); } return x; }
    function pos(f) { var g = Math.max(0, f + lead); return { r: Math.floor(g / R), d: g % R }; }

    var lfoNow = null, noteMax = 179;
    function clampNote(x) { return Math.max(0, Math.min(noteMax, x)); }
    function panOf(p) { return p < 32 ? 0x10 : p > 96 ? 0x01 : 0x11; }
    function panPcm(p) { var l = Math.round(Math.min(1, (127 - p) / 64) * 15), r = Math.round(Math.min(1, p / 63) * 15); return (l << 4) | r; }
    function splitPitch(n) { var b = Math.round(n), f = Math.round((n - b) * 128); if (Math.abs(f) < 8) f = 0; return { b: b, f: f }; }
    for (c = 0; c < L.chans; c++) {
      var F = L.fam[c], isFM = F.ins === 'fm' || F.ins === 'opl', isEnv = F.ins === 'psg', isSN = F === FAM.sn, isPCM = F.ins === 'smp' || F.ins === 'rhythm';
      var isAY = F === FAM.ay || F === FAM.ay8930;
      // no Furnace o PSG (SN76489) soa 2 oitavas acima do FM para a mesma nota escrita (convenção herdada do DefleMask):
      // escreve 2 oitavas abaixo para soar na altura original
      var nOff = F.nOff;
      var st = { vol: -1, fine: 0, leg: false, note: -1, pan: 0x11, noise: null, ay: 1, nf: -1, nOff: nOff, add: 0 };
      // agrupa os eventos do canal por linha
      var rows = new Map();
      per[c].forEach(function (x) {
        // o PSG do Furnace solta a nota um quadro depois: adianta um quadro para ficar no tempo certo
        var P = pos(F.early && x.f > 0 ? x.f - 1 : x.f);
        if (P.r > lastRow) return;
        var l = rows.get(P.r); if (!l) rows.set(P.r, l = []);
        l.push({ e: x.e, d: P.d, ins: x.ins });
      });
      var keys = Array.from(rows.keys()).sort(function (a, b) { return a - b; });
      var carry = { pitch: null, vol: null };
      var setPitch = function (cl, n, d, allowLegato) {
        if (st.G && st.G.ins === 'smp' && st.G.fixed) return;   // sample em taxa fixa: não muda de altura
        var p = splitPitch(n);
        if (p.b !== st.note && st.note >= 0 && allowLegato) {
          if (!st.leg) { cl.fx[0xEA] = 0xFF; st.leg = true; }
          cl.note = clampNote(p.b + st.nOff); st.note = p.b;
          if (d) { cl.fx[0xED] = d; cl.d = d; }
        }
        if (p.f !== st.fine && (p.b === st.note)) { cl.fx[0xE5] = 0x80 + p.f; st.fine = p.f; }
      };
      var visit = function (r) {
        var evs = rows.get(r) || [];
        var hasOn = evs.some(function (x) { return x.e.k === 'on' || x.e.k === 'hit'; });
        var hasPitch = false, hasVol = false, lastPitch = null, lastVol = null, seenOn = false;
        var cl = (evs.length || carry.pitch != null || carry.vol != null) ? cell(c, r) : null;
        evs.forEach(function (x) {
          var e = x.e, d = x.d;
          if (e.k === 'on' || e.k === 'hit') {
            if (x.ins == null) return;   // timbre que este canal não aceita
            var n, ins = x.ins, vol = -1, fixedNoise = false, drum = false;
            // canal que toca onda e PCM (WonderSwan): a nota de PCM segue a família de sample
            var G = e.tb && e.tb.type === 'pcm' && F.alt ? F.alt : F;
            st.G = G; st.nOff = G.nOff; st.add = 0;
            if (e.k === 'hit') { n = 60; }
            else {
              var tb = e.tb;
              if (isPCM || G !== F) {
                drum = !tb || tb.base == null || G.fixed || G.ins === 'rhythm';
                n = drum ? 60 : e.n;
                vol = G.vol(e.v);
              } else if (e.noise && isSN) {
                var nm = (e.noise.r === 3 ? 0x10 : 0) | (e.noise.m === 'white' ? 1 : 0);
                if (nm !== st.noise) { cl.fx[0x20] = nm; st.noise = nm; }
                n = e.noise.r === 3 ? midiOfHz(e.noise.f || 440) : 60 + (2 - e.noise.r);
                fixedNoise = e.noise.r !== 3;
              } else if (e.noise && e.noise.ck === 'drum') {
                n = 60;   // bateria do modo ritmo do OPL/OPLL: cada peça tem o seu canal
              } else if (e.noise && F.c64) {
                n = midiOfHz(e.noise.f || 440);   // ruído do SID: a altura é a frequência da voz
              } else if (e.noise && F.lynx) {
                n = midiOfHz(e.noise.f || 440);   // Lynx: a "nota" é o relógio do LFSR
              } else if (e.noise) {
                // ruído dos outros PSG: o modo vai em efeito; a "nota" vem da taxa do ruído
                if (isAY) { if (st.ay !== 2) { cl.fx[0x20] = 2; st.ay = 2; } var nr = e.noise.r & 31; if (nr !== st.nf) { cl.fx[0x21] = nr; st.nf = nr; } n = 60; }
                else { n = 84 - Math.min(15, e.noise.r || 0) * 2; }
                if (F === FAM.pce && st.noise !== 1) { cl.fx[0x11] = 1; st.noise = 1; }
                if (F === FAM.ws && st.noise !== 1) { cl.fx[0x11] = 1 + ((e.noise.r || 0) & 7); st.noise = 1; }
                if (F === FAM.saa && st.noise !== 1) { cl.fx[0x10] = 0x10; st.noise = 1; }
              } else {
                n = e.n;
                // Lynx (sem afinação): a nota é o relógio do LFSR; o tom sai dividido pelo tamanho do ciclo
                if (F.lynx && tb && tb.mk && tb.mk.plen > 1) { st.add = 12 * Math.log(tb.mk.plen) / Math.LN2; n += st.add; }
                if (isAY && st.ay !== 1) { cl.fx[0x20] = 1; st.ay = 1; }
                if ((F === FAM.pce || F === FAM.ws) && st.noise === 1) { cl.fx[0x11] = 0; st.noise = 0; }
                if (F === FAM.saa && st.noise !== 0) { cl.fx[0x10] = 0x01; st.noise = 0; }
              }
              if (!isPCM && G === F) {
                // PSG: o envelope (macro) já começa no nível do 1º quadro; o volume da nota é o pico
                var e0 = isEnv && tb && tb.env && tb.env.length ? tb.env[0] : 1;
                vol = isEnv ? F.vol(e0 > 0.01 ? Math.min(1, e.v / e0) : e.v) : F.vol(e.v);
              }
            }
            var p = splitPitch(n);
            cl.note = clampNote(p.b + (fixedNoise ? 48 : st.nOff)); cl.ins = ins; if (vol >= 0) { cl.vol = vol; st.vol = vol; }
            cl.d = d;
            if (d) cl.fx[0xED] = d; else delete cl.fx[0xED];
            delete cl.fx[0xEC];
            if (!drum && p.f !== st.fine) { cl.fx[0xE5] = 0x80 + p.f; st.fine = p.f; }
            if (st.leg) { cl.fx[0xEA] = 0; st.leg = false; }
            if (F.pan && e.pan != null && e.k !== 'hit') {
              var pv = F.pan === 'fm' ? panOf(e.pan) : panPcm(e.pan); if (pv !== st.pan) { cl.fx[0x08] = pv; st.pan = pv; }
            }
            if (e.tb && e.tb.type === 'fm' && e.tb.lfo != null && F === FAM.fm) {
              var lv = e.tb.lfo < 0 ? 0 : 0x10 | (e.tb.lfo & 7);
              if (lv !== lfoNow) { cl.fx[0x10] = lv; lfoNow = lv; }
            }
            st.note = drum ? -1 : p.b; seenOn = true; lastPitch = null; lastVol = null;
            st.playing = true;
          } else if (e.k === 'off') {
            st.playing = false;
            if (seenOn || (cl.note != null && cl.note !== 180)) {
              if (d > (cl.d || 0)) cl.fx[0xEC] = d; // acaba dentro da mesma linha
            } else if (!hasOn) {
              cl.note = 180; cl.d = d;
              if (d) cl.fx[0xED] = d;
            }
          } else if (e.k === 'vol') {
            // no PSG o envelope do timbre (macro de volume) já faz essas mudanças durante a nota
            if (isEnv && st.playing) return;
            var v2 = (st.G || F).vol(e.v); if (v2 < 0) return;
            if (seenOn || hasVol) lastVol = v2; // depois da nota/1º volume: vale na linha seguinte
            else if (!hasOn) { if (v2 !== st.vol) { cl.vol = v2; st.vol = v2; } hasVol = true; }
            else lastVol = v2;
          } else if (e.k === 'pitch') {
            if (st.note < 0) return;
            if (seenOn || hasPitch || hasOn) lastPitch = e.n + st.add;
            else { setPitch(cl, e.n + st.add, d, true); hasPitch = true; }
          } else if (e.k === 'pan' && F.pan) {
            var pv2 = F.pan === 'fm' ? panOf(e.pan) : panPcm(e.pan);
            if (pv2 !== st.pan) { cl.fx[0x08] = pv2; st.pan = pv2; }
          }
        });
        // o que ficou do quadro anterior entra no começo desta linha (se a linha não tem o seu)
        if (!hasOn && cl) {
          if (carry.pitch != null && !hasPitch) setPitch(cl, carry.pitch, 0, true);
          if (carry.vol != null && !hasVol && carry.vol !== st.vol) { cl.vol = carry.vol; st.vol = carry.vol; }
        }
        carry.pitch = lastPitch; carry.vol = lastVol;
      };
      for (var ki = 0; ki < keys.length; ki++) {
        visit(keys[ki]);
        var nx = keys[ki] + 1;
        if ((carry.pitch != null || carry.vol != null) && nx <= lastRow && (ki + 1 >= keys.length || keys[ki + 1] !== nx)) visit(nx);
      }
    }

    // repetição: na última linha, pula para o ponto de loop (ou para a música)
    var loopRow = -1;
    if (res.loopSamples > 0 && res.totalSamples > res.loopSamples) {
      var lf = Math.round((res.totalSamples - res.loopSamples) / spt);
      loopRow = Math.max(0, Math.floor((lf + lead) / R));
      if (loopRow > lastRow) loopRow = -1;
    }
    var endCell = cell(0, lastRow);
    if (loopRow >= 0) { endCell.fx[0x0B] = Math.floor(loopRow / patLen); endCell.fx[0x0D] = loopRow % patLen; }
    else endCell.fx[0xFF] = 0;

    var fxStats = {};
    grid.forEach(function (m, ch) { m.forEach(function (x) { Object.keys(x.fx).forEach(function (k) { var kk = ch + ':' + (+k).toString(16); fxStats[kk] = (fxStats[kk] || 0) + 1; }); }); });
    // colunas de efeito por canal
    var fxCols = [];
    for (c = 0; c < L.chans; c++) {
      var mx = 1;
      grid[c].forEach(function (x) { mx = Math.max(mx, Object.keys(x.fx).length); });
      fxCols.push(Math.min(8, mx));
    }

    // padrões por canal (iguais são reaproveitados)
    var pats = []; // {ch, idx, bytes}
    var orders = []; // orders[ch][o]
    for (c = 0; c < L.chans; c++) {
      var seen = {}, list = [];
      orders.push([]);
      for (var o = 0; o < nOrd; o++) {
        var pw = new Wr(), skip = 0;
        var flush = function () {
          while (skip > 0) {
            if (skip === 1) { pw.c(0); skip = 0; }
            else { var k = Math.min(skip, 128); pw.c(0x80 | (k - 2)); skip -= k; }
          }
        };
        for (var r = 0; r < patLen; r++) {
          var x = grid[c].get(o * patLen + r);
          var codes = x ? Object.keys(x.fx).map(Number) : [];
          if (!x || (x.note == null && x.ins == null && x.vol == null && !codes.length)) { skip++; continue; }
          flush();
          // ordem fixa das colunas: atraso primeiro, depois o resto
          codes.sort(function (a, b) { return (a === 0xED ? -1 : 0) - (b === 0xED ? -1 : 0) || a - b; });
          codes = codes.slice(0, fxCols[c]);
          var mask = 0, em = 0;
          if (x.note != null) mask |= 1;
          if (x.ins != null) mask |= 2;
          if (x.vol != null) mask |= 4;
          codes.forEach(function (cd, k) { em |= 3 << (k * 2); });
          if (em & 0xFF) mask |= 32;
          if (em & 0xFF00) mask |= 64;
          pw.c(mask);
          if (mask & 32) pw.c(em & 0xFF);
          if (mask & 64) pw.c(em >> 8);
          if (mask & 1) pw.c(x.note);
          if (mask & 2) pw.c(x.ins);
          if (mask & 4) pw.c(x.vol);
          codes.forEach(function (cd) { pw.c(cd); pw.c(x.fx[cd]); });
        }
        pw.c(0xFF);
        var body = pw.out(), key = Array.prototype.join.call(body, ',');
        if (seen[key] == null) {
          if (list.length >= 256) throw new Error('Padrões demais no canal ' + L.names[c] + '.');
          seen[key] = list.length; list.push(body);
        }
        orders[c].push(seen[key]);
      }
      list.forEach(function (b, k) { pats.push({ ch: c, idx: k, body: b }); });
    }

    // ---------- arquivo ----------
    var info = res.info || {};
    var w = new Wr();
    w.tag('-Furnace module-'); w.s(228); w.s(0); var infoPtrAt = w.n; w.i(0); w.i(0); w.i(0);
    var infoAt = w.n; w.patchI(infoPtrAt, infoAt);
    var ib = w.block('INFO');
    w.c(0); w.c(R); w.c(R); w.c(1);
    w.f(hz);
    w.s(patLen); w.s(nOrd);
    w.c(4); w.c(16);
    w.s(insList.length); w.s(waves.length); w.s(smpList.length);
    w.i(pats.length);
    var k;
    for (k = 0; k < 32; k++) w.c(k < L.sys.length ? L.sys[k].id : 0);
    for (k = 0; k < 32; k++) w.c(64);
    for (k = 0; k < 32; k++) w.c(0);
    var flagPtr = w.n; for (k = 0; k < 32; k++) w.i(0);   // ponteiros das configurações de cada chip (FLAG)
    w.str(info.title || ''); w.str(info.author || '');
    w.f(440);
    [0, 2, 2, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1].forEach(function (v) { w.c(v); });
    var insPtr = w.n; for (k = 0; k < insList.length; k++) w.i(0);
    var wavPtr = w.n; for (k = 0; k < waves.length; k++) w.i(0);
    var smpPtr = w.n; for (k = 0; k < smpList.length; k++) w.i(0);
    var patPtr = w.n; for (k = 0; k < pats.length; k++) w.i(0);
    for (c = 0; c < L.chans; c++) for (o = 0; o < nOrd; o++) w.c(orders[c][o]);
    for (c = 0; c < L.chans; c++) w.c(fxCols[c]);
    for (c = 0; c < L.chans; c++) w.c(3);
    for (c = 0; c < L.chans; c++) w.c(0);
    for (c = 0; c < L.chans; c++) w.str(L.names[c]);
    for (c = 0; c < L.chans; c++) w.str(L.shorts[c]);
    w.str(tr('Convertido de VGM pelo Chiptune Studio (Registro Gamer).', 'Converted from VGM by Chiptune Studio (Registro Gamer).') + (info.game ? tr('\nJogo: ', '\nGame: ') + info.game : '') +
      tr('\nLinha = ', '\nRow = ') + R + tr(' quadro(s) a ', ' frame(s) at ') + hz + ' Hz.' +
      (L.fallback.length ? tr('\nSem equivalente no Furnace (viraram samples no ES5506): ', '\nNo Furnace equivalent (turned into samples on the ES5506): ') + L.fallback.join(', ') + '.' : ''));
    w.f(1);
    [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 4, 0, 0, 1, 1, 0, 0, 0, 0, 2, 0, 1, 0, 0, 0].forEach(function (v) { w.c(v); });
    w.s(150); w.s(150);
    w.str(''); w.str(''); w.c(0); w.c(0); w.c(0); w.c(0);
    w.str(L.system); w.str(info.game || ''); w.str(''); w.str(''); w.str(''); w.str('');
    L.sys.forEach(function (s) { w.f(s.vol); w.f(s.pan); w.f(s.fr); });
    w.i(0); w.c(1);
    for (k = 0; k < 8; k++) w.c(0);
    w.c(1); w.c(R); for (k = 1; k < 16; k++) w.c(0);
    w.c(0);
    var adirPtr = w.n; w.i(0); w.i(0); w.i(0);
    w.end(ib);

    for (k = 0; k < 3; k++) { w.patchI(adirPtr + k * 4, w.n); var ab = w.block('ADIR'); w.i(0); w.end(ab); }
    L.sys.forEach(function (sy, j) { if (!sy.flags) return; w.patchI(flagPtr + j * 4, w.n); var fbk = w.block('FLAG'); w.str(sy.flags + '\n'); w.end(fbk); });

    insList.forEach(function (it, j) {
      w.patchI(insPtr + j * 4, w.n);
      insBlock(w, it.t || {}, it.name, it.x);
    });
    waves.forEach(function (wv, j) {
      w.patchI(wavPtr + j * 4, w.n);
      var wb = w.block('WAVE'); w.str(''); w.i(wv.data.length); w.i(0); w.i(wv.max);
      wv.data.forEach(function (v) { w.i(v); }); w.end(wb);
    });
    smpList.forEach(function (s, j) { w.patchI(smpPtr + j * 4, w.n); sampleBlock(w, s); });
    pats.forEach(function (p, j) {
      w.patchI(patPtr + j * 4, w.n);
      var pb = w.block('PATN');
      w.c(0); w.c(p.ch); w.s(p.idx); w.str('');
      w.bytes(p.body);
      w.end(pb);
    });

    return { bytes: w.out(), rowFrames: R, hz: hz, patLen: patLen, orders: nOrd, rows: lastRow + 1, loopRow: loopRow,
      fxStats: opts.debug ? fxStats : undefined, grid: opts.debug ? grid : undefined, lead: lead, missing: [], sampled: (L.fallback || []).filter(function (v, k, a) { return a.indexOf(v) === k; }), instruments: insList.length, merged: 0, samples: smpList.length, patterns: pats.length, system: L.system, waves: waves.length };
  }

  function fileName(res, fb) {
    var i = (res && res.info) || {};
    var n = (i.game ? i.game + ' - ' : '') + (i.title || fb || 'musica');
    return n.replace(/[\\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) + '.fur';
  }

  // ---------- instrumento avulso do Furnace (.fui) — usado pelo editor de timbres ----------
  var DT_INV = [7, 6, 5, 0, 1, 2, 3, 3];  // dt do Furnace (3 = sem desafinação) → nosso (bit 2 = negativo)
  function fui(t, name) {
    var w = new Wr();
    w.tag('FINS'); w.s(228);
    // Mikey (Lynx): leva a realimentação e o valor inicial do LFSR, que é o que dá o timbre no Furnace
    insBody(w, t, name, t.chipKind === 'mikey' && t.mk ? { vmax: 127, mac: [[2, [t.mk.duty], 2], [5, [t.mk.lfsr], 2]] } : {});
    return w.out();
  }
  // lê um .fui (ou o INS2 de dentro de um .fur) e devolve o timbre FM no formato do Chiptune Studio
  function readFui(u8) {
    var p = 0, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    function tag() { return String.fromCharCode(u8[p], u8[p + 1]); }
    var magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== 'FINS') throw new Error('not a Furnace instrument (.fui)');
    p = 4; var ver = dv.getUint16(p, true); p += 2; var type = u8[p]; p += 2;
    var t = null, name = '';
    while (p + 4 <= u8.length) {
      var tg = tag(); p += 2; if (tg === 'EN') break;
      var len = dv.getUint16(p, true); p += 2; var end = p + len;
      if (tg === 'NA') { var q = p; while (q < end && u8[q]) q++; name = new TextDecoder().decode(u8.subarray(p, q)); }
      else if (tg === 'FM' && (type === 13 || type === 14)) {
        // OPL / OPLL do Furnace → timbre OPL do Chiptune Studio
        var oen = u8[p], ocnt = (oen & 15) === 4 && type === 14 ? 4 : 2, ox = u8[p + 1], oo = p + 4 + (ver >= 224 ? 1 : 0), OP = [];
        for (var oi = 0; oi < ocnt; oi++) {
          var ob = u8.subarray(oo + oi * 8, oo + oi * 8 + 8);
          OP.push({ ksr: ob[0] >> 7, mul: ob[0] & 15, egt: type === 13 ? ((ob[6] & 8) ? 1 : 0) : ob[1] >> 7, tl: ob[1] & 63, vib: (ob[2] >> 5) & 1, ar: ob[2] & 15,
                    am: ob[3] >> 7, ksl: (ob[3] >> 5) & 3, dr: ob[3] & 15, sl: ob[5] >> 4, rr: ob[5] & 15, ws: ob[7] & 7, off: !(oen & (16 << oi)) });
        }
        var okind = type === 13 ? 'opll' : (OP.some(function (q) { return q.ws > 3; }) || ocnt === 4 ? 'opl3' : 'opl2'), oc = okind === 'opl3' ? 14318180 : 3579545;
        t = { type: 'opl', oplKind: okind, clock: oc, rate: okind === 'opl3' ? oc / 288 : oc / 72, alg: (ox >> 4) & (ocnt === 4 ? 3 : 1), fb: ox & 7,
              four: ocnt === 4, dam: 0, dvb: 0, tune: 0, ops: ocnt === 4 ? [OP[0], OP[2], OP[1], OP[3]] : OP, chip: { opll: 'YM2413', opl2: 'YM3812', opl3: 'YMF262' }[okind] };
      }
      else if (tg === 'FM') {
        var en = u8[p], cnt = en & 15, x = u8[p + 1];
        t = { type: 'fm', fmKind: type === 33 ? 'opm' : 'opn', alg: (x >> 4) & 7, fb: x & 7, ams: (u8[p + 2] >> 3) & 3, fms: u8[p + 2] & 7, lfo: -1, opmLfo: null, tune: 0, ops: [] };
        var o = p + 4 + (ver >= 224 ? 1 : 0), F = [];
        for (var i = 0; i < 4; i++) {
          var b = i < cnt ? u8.subarray(o + i * 8, o + i * 8 + 8) : new Uint8Array(8);
          F.push({ dt: DT_INV[(b[0] >> 4) & 7], mul: b[0] & 15, tl: b[1] & 127, ks: (b[2] >> 6) & 3, ar: b[2] & 31, am: (b[3] >> 7) & 1, d1r: b[3] & 31,
                   d2r: b[4] & 31, sl: (b[5] >> 4) & 15, rr: b[5] & 15, ssg: b[6] & 15, dt2: (b[7] >> 3) & 3, off: !(en & (16 << i)) });
        }
        t.ops = [F[0], F[2], F[1], F[3]];
      }
      p = end;
    }
    if (!t) throw new Error('only FM instruments can be opened for now');
    t.name = name;
    return t;
  }
  root.RGFUR = { build: build, fileName: fileName, fui: fui, readFui: readFui };
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this).RGFUR;
