// Leitor de VGM + conversores para MIDI e Furnace (Chiptune Studio · Registro Gamer)
// ===== Extrator de timbres de arquivos VGM =====
// Lê os registros dos chips e devolve os instrumentos que a música usa.
var RGVGM = (function () {
  'use strict';
  var FRAME = 735; // 1/60 s em amostras de 44100 Hz

  var PCMSTORE = { n: 0, map: {} };   // samples decodificados (fora do timbre, que vai e volta como JSON)
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function midiOf(f) { return f > 0 ? 69 + 12 * Math.log2(f / 440) : 0; }

  function gd3(b) {
    try {
      var off = u32(b, 0x14); if (!off) return {};
      off += 0x14;
      if (String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]) !== 'Gd3 ') return {};
      var len = u32(b, off + 8), p = off + 12, end = p + len, out = [], s = '';
      while (p + 1 < end && out.length < 11) {
        var c = b[p] | (b[p + 1] << 8); p += 2;
        if (c === 0) { out.push(s); s = ''; } else s += String.fromCharCode(c);
      }
      return { title: out[0] || '', game: out[2] || '', system: out[4] || '', author: out[6] || '' };
    } catch (e) { return {}; }
  }

  // ───────────── FM: família OPN (YM2612/2203/2608/2610) e OPM (YM2151) ─────────────
  var CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
  var OPN_OFF = [0, 8, 4, 12];      // op1..op4 → deslocamento no registrador
  var OPM_OFF = [0, 16, 8, 24];

  function FMChip(kind, chipName, clock, nch) {
    this.kind = kind; this.chip = chipName; this.clock = clock; this.nch = nch;
    this.regs = [new Uint8Array(256), new Uint8Array(256)];
    this.keyed = new Uint8Array(8);
    this.rate = kind === 'opm' ? clock / 64 : (chipName === 'YM2203' ? clock / 72 : clock / 144);
    this.dac = false;
  }
  FMChip.prototype.snapshotOPN = function (ch) {
    var port = ch >= 3 ? 1 : 0, c = ch % 3, R = this.regs[port], R0 = this.regs[0];
    var ops = [];
    for (var i = 0; i < 4; i++) {
      var o = OPN_OFF[i] + c;
      ops.push({
        dt: (R[0x30 + o] >> 4) & 7, mul: R[0x30 + o] & 15, tl: R[0x40 + o] & 127,
        ks: R[0x50 + o] >> 6, ar: R[0x50 + o] & 31, am: R[0x60 + o] >> 7, d1r: R[0x60 + o] & 31,
        d2r: R[0x70 + o] & 31, sl: R[0x80 + o] >> 4, rr: R[0x80 + o] & 15, ssg: R[0x90 + o] & 15, dt2: 0
      });
    }
    var fbalg = R[0xB0 + c], lr = R[0xB4 + c];
    var fnum = ((R[0xA4 + c] & 7) << 8) | R[0xA0 + c], block = (R[0xA4 + c] >> 3) & 7;
    var freq = fnum * this.rate * Math.pow(2, block - 1) / 1048576;
    var lfo = R0[0x22];
    return {
      alg: fbalg & 7, fb: (fbalg >> 3) & 7, ams: (lr >> 4) & 3, fms: lr & 7, ops: ops,
      lfo: (lfo & 8) ? (lfo & 7) : -1, note: midiOf(freq)
    };
  };
  FMChip.prototype.snapshotOPM = function (ch) {
    var R = this.regs[0], ops = [];
    for (var i = 0; i < 4; i++) {
      var o = OPM_OFF[i] + ch;
      ops.push({
        dt: (R[0x40 + o] >> 4) & 7, mul: R[0x40 + o] & 15, tl: R[0x60 + o] & 127,
        ks: R[0x80 + o] >> 6, ar: R[0x80 + o] & 31, am: R[0xA0 + o] >> 7, d1r: R[0xA0 + o] & 31,
        d2r: R[0xC0 + o] & 31, dt2: R[0xC0 + o] >> 6, sl: R[0xE0 + o] >> 4, rr: R[0xE0 + o] & 15, ssg: 0
      });
    }
    var con = R[0x20 + ch], kc = R[0x28 + ch], pa = R[0x38 + ch];
    var idx = [0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 10, 11, 11][kc & 15];
    var note = 61 + 12 * (((kc >> 4) & 7) - 4) + idx + 12 * Math.log2(this.clock / 3579545);
    return {
      alg: con & 7, fb: (con >> 3) & 7, ams: pa & 3, fms: (pa >> 4) & 7, ops: ops,
      lfo: -1, opmLfo: { frq: R[0x18], pmd: this.pmd || 0, amd: this.amd || 0, w: R[0x1B] & 3 }, note: note
    };
  };

  // ───────────── PSG: gravador genérico de envelopes (60 quadros/s) ─────────────
  // Cada canal informa, a cada quadro, volume (0..1), forma de onda e frequência.
  function PSGChan(owner, label, chip, rec) {
    this.owner = owner; this.label = label; this.chip = chip; this.REC = rec || null; this.id = chip + ' · ' + label;
    this.mOn = false; this.mNote = 0; this.mV = 0;
    this.vol = 0; this.freq = 0; this.wave = null; this.trig = false;
    this.rec = null; this.prevVol = 0; this.prevFreq = 0;
  }
  PSGChan.prototype.frame = function () {
    var v = this.vol, f = this.freq, w = this.wave;
    var audible = v > 0.001 && w;
    var start = false;
    if (audible) {
      if (this.trig) start = true;
      else if (!this.rec) start = true;
      else if (this.prevVol <= 0.001) start = true;
      else if (v - this.prevVol > 0.25) start = true;
      else if (this.prevFreq > 0 && f > 0 && Math.abs(Math.log2(f / this.prevFreq)) > 0.045 && this.rec.v.length >= 4 && w.k !== 'noise') start = true;
    }
    this.trig = false;
    if (start) {
      this.finish();
      this.rec = { w: w, v: [], d: [], note: w.k === 'noise' ? (w.nrate || 0) : midiOf(f) };
    }
    if (this.REC) {
      // notas para o MIDI: início, fim, afinação e volume a cada quadro
      var R = this.REC, ft = this.owner.ft;
      if (start) {
        if (this.mOn) R.push({ c: this.id, t: ft, k: 'off' });
        var ev = { c: this.id, t: ft, k: 'on', n: w.k === 'noise' ? 0 : midiOf(f), v: v, pan: 64 };
        if (w.k === 'noise') ev.noise = { ck: w.ck, r: w.nrate || 0, m: w.nmode, f: w.tf || 0 };
        R.push(ev); this.rec.evOn = ev;
        this.mOn = true; this.mNote = ev.n; this.mV = v;
      } else if (this.mOn) {
        if (v <= 0.001) { R.push({ c: this.id, t: ft, k: 'off' }); this.mOn = false; }
        else {
          if (w && w.k !== 'noise' && f > 0) { var nn = midiOf(f); if (Math.abs(nn - this.mNote) > 0.02) { R.push({ c: this.id, t: ft, k: 'pitch', n: nn }); this.mNote = nn; } }
          if (Math.abs(v - this.mV) > 0.01) { R.push({ c: this.id, t: ft, k: 'vol', v: v }); this.mV = v; }
        }
      }
    }
    if (this.rec) {
      if (this.rec.v.length < 240) { this.rec.v.push(v); this.rec.d.push(w ? (w.duty == null ? -1 : w.duty) : -1); }
      if (v <= 0.001 && this.rec.v.length > 1) { var z = 0, a = this.rec.v; for (var i = a.length - 1; i >= 0 && a[i] <= 0.001; i--) z++; if (z > 12) this.finish(); }
    }
    this.prevVol = v; this.prevFreq = f;
  };
  PSGChan.prototype.finish = function () {
    var r = this.rec; this.rec = null;
    if (!r || !r.v.length) return;
    var tb = this.owner.addPSG(this, r);
    if (r.evOn && tb) r.evOn.tb = tb;
  };

  function q(x) { return Math.round(x * 15); }

  function Collector() { this.map = {}; this.list = []; }
  Collector.prototype.add = function (key, make, chLabel, note, chip) {
    var t = this.map[key];
    if (!t) { t = make(); t.key = key; t.count = 0; t.chans = {}; t.lo = 999; t.hi = -999; t.chip = chip; t.notes = []; this.map[key] = t; this.list.push(t); }
    t.count++; t.chans[chLabel] = (t.chans[chLabel] || 0) + 1;
    if (note > 0) { t.lo = Math.min(t.lo, note); t.hi = Math.max(t.hi, note); if (t.notes.length < 400) t.notes.push(Math.round(note)); }
    return t;
  };
  Collector.prototype.addPSG = function (ch, r) {
    // corta silêncio do fim e repetições finais (o último valor fica "segurando" a nota)
    var v = r.v.slice(), d = r.d.slice();
    // volume da música (dinâmica) não muda o timbre: normaliza o pico para 1
    var pk = 0; v.forEach(function (x) { if (x > pk) pk = x; });
    if (pk <= 0.001) return;
    v = v.map(function (x) { return x / pk; });
    while (v.length > 1 && v[v.length - 1] <= 0.001 && v[v.length - 2] <= 0.001) { v.pop(); d.pop(); }
    while (v.length > 1 && q(v[v.length - 1]) === q(v[v.length - 2]) && d[d.length - 1] === d[d.length - 2]) { v.pop(); d.pop(); }
    if (v.length > 90) { v.length = 90; d.length = 90; }
    var w = r.w;
    var key = ch.chip + '|' + w.k + '|' + (w.k === 'wave' ? w.tbl.join('') : '') + '|' + (w.nmode || '') + '|' +
      v.map(q).join(',') + '|' + d.join(',');
    var env = v.map(function (x) { return Math.round(x * 1000) / 1000; });
    return this.add(key, function () {
      return { type: 'psg', wave: w.k, chipKind: w.ck, tbl: w.tbl || null, nmode: w.nmode || '', env: env, duty: d };
    }, ch.label, r.note, ch.chip);
  };

  // ───────────── leitura principal ─────────────
  function parse(buf, opts) {
    var REC = opts && opts.events ? [] : null;   // notas no tempo, para converter em MIDI
    var mchans = [];                            // canais encontrados (ordem de criação)
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'Vgm ') throw new Error('Arquivo não é VGM');
    var ver = u32(b, 8);
    var hdrLen = ver >= 0x150 ? 0x34 + u32(b, 0x34) : 0x40;
    if (ver >= 0x150 && u32(b, 0x34) === 0) hdrLen = 0x40;
    function hclk(o) { return (o + 4 <= hdrLen) ? (u32(b, o) & 0x3FFFFFFF) : 0; }
    // bit 30 do clock = a música usa dois chips iguais (ex.: arcade SegaSonic com dois YM2612)
    function hdual(o) { return (o + 4 <= hdrLen) && !!(u32(b, o) & 0x40000000) && hclk(o) > 0; }
    var info = gd3(b);
    var col = new Collector();
    col.ft = 0;
    function mchan(id, chip, label, kind) { if (REC) mchans.push({ id: id, chip: chip, label: label, kind: kind }); }
    var chans = [];
    var unsupported = [];

    var clk = {
      sn: hclk(0x0C), ym2413: hclk(0x10), ym2612: ver >= 0x110 ? hclk(0x2C) : hclk(0x10), ym2151: ver >= 0x110 ? hclk(0x30) : hclk(0x10),
      ym2203: hclk(0x44), ym2608: hclk(0x48), ym2610: hclk(0x4C), ay: hclk(0x74), gb: hclk(0x80), nes: hclk(0x84),
      huc: hclk(0xA4), ym3812: hclk(0x50), ym3526: hclk(0x54), y8950: hclk(0x58), ymf262: hclk(0x5C)
    };
    var dual = { ym3812: hdual(0x50), sn: hdual(0x0C), ym2612: ver >= 0x110 && hdual(0x2C), ym2151: ver >= 0x110 && hdual(0x30), ym2203: hdual(0x44), ay: hdual(0x74) };
    // antes da v1.10 o campo 0x10 vale para YM2413, YM2612 e YM2151: o que aparece nos comandos decide
    [['YM2413', 0x10], ['QSound', 0xB4], ['K051649', 0x9C], ['YMF278B', 0x60], ['YMZ280B', 0x68]].forEach(function (x) {
      if (x[0] === 'YM2413') return;
      if (hclk(x[1])) unsupported.push(x[0]);
    });

    // FM
    var fm = {};
    if (clk.ym2612) fm.ym2612 = new FMChip('opn', 'YM2612', clk.ym2612, 6);
    if (clk.ym2151) fm.ym2151 = new FMChip('opm', 'YM2151', clk.ym2151, 8);
    if (clk.ym2203) fm.ym2203 = new FMChip('opn', 'YM2203', clk.ym2203, 3);
    if (clk.ym2608) fm.ym2608 = new FMChip('opn', 'YM2608', clk.ym2608, 6);
    if (clk.ym2610) fm.ym2610 = new FMChip('opn', 'YM2610', clk.ym2610, 6);
    if (dual.ym2612) fm.ym2612b = new FMChip('opn', 'YM2612 #2', clk.ym2612, 6);
    if (dual.ym2151) fm.ym2151b = new FMChip('opm', 'YM2151 #2', clk.ym2151, 8);
    if (dual.ym2203) fm.ym2203b = new FMChip('opn', 'YM2203 #2', clk.ym2203, 3);
    Object.keys(fm).forEach(function (k) { fm[k].mcur = []; fm[k].mseen = []; });

    function fmKey(chip, ch, on) {
      var snap = chip.kind === 'opm' ? chip.snapshotOPM(ch) : chip.snapshotOPN(ch);
      var car = CARRIERS[snap.alg], minTL = 127;
      car.forEach(function (i) { minTL = Math.min(minTL, snap.ops[i].tl); });
      // volume da música mexe no TL das portadoras: normaliza para a mais alta = 0
      snap.ops.forEach(function (op, i) { if (car.indexOf(i) >= 0) op.tl -= minTL; });
      var key = chip.chip + '|' + snap.alg + '|' + snap.fb + '|' + snap.ams + '|' + snap.fms + '|' +
        snap.ops.map(function (o) { return [o.dt, o.mul, o.tl, o.ks, o.ar, o.am, o.d1r, o.d2r, o.sl, o.rr, o.ssg, o.dt2].join('.'); }).join('/');
      var lbl = 'FM ' + (ch + 1);
      var tbObj = col.add(key, function () {
        // afinação: se a portadora principal soa uma oitava acima/abaixo (MUL 0, 2, 4, 8), corrige o teclado
        var best = null;
        car.forEach(function (i) { var o = snap.ops[i]; if (!best || o.tl < best.tl || (o.tl === best.tl && (o.mul || 0.5) < (best.mul || 0.5))) best = o; });
        var mv = best.mul || 0.5, tune = 0;
        if ([0.5, 1, 2, 4, 8].indexOf(mv) >= 0) tune = -12 * Math.log2(mv);
        return { type: 'fm', tune: tune, fmKind: chip.kind, clock: chip.clock, rate: chip.rate, alg: snap.alg, fb: snap.fb, ams: snap.ams, fms: snap.fms,
                 ops: snap.ops, lfo: snap.lfo, opmLfo: snap.opmLfo || null };
      }, lbl, snap.note, chip.chip);
      if (REC) {
        var id = chip.chip + ' · ' + lbl, st = fmState(chip, ch);
        if (!chip.mseen[ch]) { chip.mseen[ch] = 1; mchan(id, chip.chip, lbl, 'fm'); }
        R0push({ c: id, t: t, k: 'on', n: st.n, v: st.v, pan: st.pan, tb: tbObj });
        chip.mcur[ch] = st;
      }
    }
    function R0push(e) { REC.push(e); }
    // estado atual de um canal FM: nota (com fração), volume (0..1) e pan (0..127)
    function fmState(chip, ch) {
      var R, n, alg, pan, lr;
      if (chip.kind === 'opm') {
        R = chip.regs[0];
        var kc = R[0x28 + ch], kf = R[0x30 + ch] >> 2;
        var idx = [0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 8, 9, 10, 11, 11][kc & 15];
        n = 61 + 12 * (((kc >> 4) & 7) - 4) + idx + kf / 64 + 12 * Math.log2(chip.clock / 3579545);
        alg = R[0x20 + ch] & 7; lr = R[0x20 + ch] >> 6;
      } else {
        var port = ch >= 3 ? 1 : 0, c = ch % 3; R = chip.regs[port];
        var fnum = ((R[0xA4 + c] & 7) << 8) | R[0xA0 + c], block = (R[0xA4 + c] >> 3) & 7;
        n = midiOf(fnum * chip.rate * Math.pow(2, block - 1) / 1048576);
        alg = R[0xB0 + c] & 7; lr = R[0xB4 + c] >> 6;
      }
      pan = lr === 3 || lr === 0 ? 64 : (lr === 2 ? (chip.kind === 'opm' ? 127 : 0) : (chip.kind === 'opm' ? 0 : 127));
      var minTL = 127, car = CARRIERS[alg];
      for (var i = 0; i < car.length; i++) {
        var o = car[i], tl = chip.kind === 'opm' ? R[0x60 + OPM_OFF[o] + ch] & 127 : R[0x40 + OPN_OFF[o] + (ch % 3)] & 127;
        if (tl < minTL) minTL = tl;
      }
      return { n: n, v: Math.pow(10, -minTL * 0.75 / 20), pan: pan };
    }
    function fmFrame(chip) {
      for (var ch = 0; ch < chip.nch; ch++) {
        var cur = chip.mcur[ch]; if (!cur || !chip.keyed[ch]) continue;
        var st = fmState(chip, ch), id = chip.chip + ' · FM ' + (ch + 1);
        if (Math.abs(st.n - cur.n) > 0.02 && st.n > 0) { REC.push({ c: id, t: col.ft, k: 'pitch', n: st.n }); cur.n = st.n; }
        if (Math.abs(st.v - cur.v) > 0.01) { REC.push({ c: id, t: col.ft, k: 'vol', v: st.v }); cur.v = st.v; }
        if (st.pan !== cur.pan) { REC.push({ c: id, t: col.ft, k: 'pan', pan: st.pan }); cur.pan = st.pan; }
      }
    }
    function fmOff(chip, ch) {
      if (REC && chip.mcur[ch]) { REC.push({ c: chip.chip + ' · FM ' + (ch + 1), t: t, k: 'off' }); chip.mcur[ch] = null; }
    }
    var seenOPLL = false;
    // ───────────── FM de 2 operadores: OPL (YM3526), OPL2 (YM3812), Y8950, OPL3 (YMF262) e OPLL (YM2413) ─────────────
    // cada canal tem 2 operadores (ou 4, no modo 4-op do OPL3) com forma de onda própria (seno, meio seno...)
    var OPL_SLOT = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21]; // operador → deslocamento no registrador
    var OPL_CHOP = [0, 1, 2, 6, 7, 8, 12, 13, 14];                                   // canal → 1º operador (o 2º é +3)
    var OPL_MUL = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
    // instrumentos de fábrica do YM2413 (1 a 15): o chip só deixa 1 timbre "do usuário"; os outros vêm prontos
    var OPLL_ROM = [null,
      [0x71, 0x61, 0x1e, 0x17, 0xd0, 0x78, 0x00, 0x17], [0x13, 0x41, 0x1a, 0x0d, 0xd8, 0xf7, 0x23, 0x13], [0x13, 0x01, 0x99, 0x00, 0xf2, 0xc4, 0x21, 0x23],
      [0x11, 0x61, 0x0e, 0x07, 0x8d, 0x64, 0x70, 0x27], [0x32, 0x21, 0x1e, 0x06, 0xe1, 0x76, 0x01, 0x28], [0x31, 0x22, 0x16, 0x05, 0xe0, 0x71, 0x00, 0x18],
      [0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07], [0x33, 0x21, 0x2d, 0x13, 0xb0, 0x70, 0x00, 0x07], [0x61, 0x61, 0x1b, 0x06, 0x64, 0x65, 0x10, 0x17],
      [0x41, 0x61, 0x0b, 0x18, 0x85, 0xf0, 0x81, 0x07], [0x33, 0x01, 0x83, 0x11, 0xea, 0xef, 0x10, 0x04], [0x17, 0xc1, 0x24, 0x07, 0xf8, 0xf8, 0x22, 0x12],
      [0x61, 0x50, 0x0c, 0x05, 0xd2, 0xf5, 0x40, 0x42], [0x01, 0x01, 0x55, 0x03, 0xe9, 0x90, 0x03, 0x02], [0x41, 0x41, 0x89, 0x03, 0xf1, 0xe4, 0xc0, 0x13]];
    var OPLL_NAMES = ['', 'Violino', 'Violão', 'Piano', 'Flauta', 'Clarinete', 'Oboé', 'Trompete', 'Órgão', 'Trompa', 'Sintetizador', 'Cravo', 'Vibrafone', 'Baixo sintetizado', 'Baixo acústico', 'Guitarra'];
    // bateria do modo ritmo (BD, SD, TOM, CY, HH) → notas de bateria do General MIDI
    var OPL_DRUM = [[16, 36, 'Bumbo'], [8, 38, 'Caixa'], [4, 45, 'Tom'], [2, 49, 'Prato'], [1, 42, 'Chimbal']];

    function OPLChip(kind, name, clock, nch) {
      this.kind = kind; this.chip = name; this.clock = clock; this.nch = nch;
      this.regs = [new Uint8Array(256), new Uint8Array(256)];
      this.keyed = new Uint8Array(nch); this.mcur = []; this.mseen = []; this.used = false; this.rhy = 0; this.drumSeen = false;
      // taxa interna (amostras/s) do chip: OPL/OPL2/OPLL = clock/72, OPL3 = clock/288
      this.rate = kind === 'opl3' ? clock / 288 : clock / 72;
    }
    function oplOp(R, slot) { // lê um operador dos registradores do OPL
      var o = OPL_SLOT[slot];
      return { am: R[0x20 + o] >> 7, vib: (R[0x20 + o] >> 6) & 1, egt: (R[0x20 + o] >> 5) & 1, ksr: (R[0x20 + o] >> 4) & 1, mul: R[0x20 + o] & 15,
        ksl: R[0x40 + o] >> 6, tl: R[0x40 + o] & 63, ar: R[0x60 + o] >> 4, dr: R[0x60 + o] & 15, sl: R[0x80 + o] >> 4, rr: R[0x80 + o] & 15, ws: R[0xE0 + o] & 7 };
    }
    function opllPatch(chip, ch) {
      var R = chip.regs[0], inst = R[0x30 + ch] >> 4, P = inst ? OPLL_ROM[inst] : [R[0], R[1], R[2], R[3], R[4], R[5], R[6], R[7]];
      function op(m) {
        var b0 = P[m], ar = P[4 + m];
        return { am: b0 >> 7, vib: (b0 >> 6) & 1, egt: (b0 >> 5) & 1, ksr: (b0 >> 4) & 1, mul: b0 & 15,
          ksl: m ? P[3] >> 6 : P[2] >> 6, tl: m ? (R[0x30 + ch] & 15) * 4 : P[2] & 63, ar: ar >> 4, dr: ar & 15, sl: P[6 + m] >> 4, rr: P[6 + m] & 15,
          ws: m ? (P[3] >> 4) & 1 : (P[3] >> 3) & 1 };
      }
      return { inst: inst, fb: P[3] & 7, ops: [op(0), op(1)] };
    }
    // OPL3: o canal está ligado em 4 operadores? (devolve o canal par 0..2 / 9..11, ou -1)
    function opl4of(chip, ch) {
      if (chip.kind !== 'opl3' || !(chip.regs[1][5] & 1)) return -1;
      var bank = ch >= 9 ? 1 : 0, c = ch % 9, en = chip.regs[1][4];
      for (var k = 0; k < 3; k++) if ((en >> (k + bank * 3)) & 1) { if (c === k) return ch; if (c === k + 3) return ch - 3; }
      return -1;
    }
    function oplSnapshot(chip, ch) {
      var snap;
      if (chip.kind === 'opll') {
        var pt = opllPatch(chip, ch);
        snap = { alg: 0, fb: pt.fb, ops: pt.ops, four: false, inst: pt.inst };
      } else {
        var bank = ch >= 9 ? 1 : 0, c = ch % 9, R = chip.regs[bank], s0 = OPL_CHOP[c];
        var four = opl4of(chip, ch) === ch;
        if (four) {
          var R2 = R, c2 = c + 3, t0 = OPL_CHOP[c2];
          snap = { four: true, fb: (R[0xC0 + c] >> 1) & 7, alg: (R[0xC0 + c] & 1) | ((R2[0xC0 + c2] & 1) << 1),
            ops: [oplOp(R, s0), oplOp(R, s0 + 3), oplOp(R2, t0), oplOp(R2, t0 + 3)] };
        } else snap = { four: false, fb: (R[0xC0 + c] >> 1) & 7, alg: R[0xC0 + c] & 1, ops: [oplOp(R, s0), oplOp(R, s0 + 3)] };
        // forma de onda: OPL2 só tem 4 (e só com o bit de liberar); OPL e Y8950, só seno
        snap.ops.forEach(function (o) {
          if (chip.kind === 'opl' || chip.kind === 'y8950') o.ws = 0;
          else if (chip.kind === 'opl2') o.ws = (chip.regs[0][1] & 0x20) ? o.ws & 3 : 0;
          else if (!(chip.regs[1][5] & 1)) o.ws &= 3;
        });
      }
      snap.dam = (chip.regs[0][0xBD] >> 7) & 1; snap.dvb = (chip.regs[0][0xBD] >> 6) & 1;
      return snap;
    }
    var OPL_CAR = [[1], [0, 1]], OPL_CAR4 = [[3], [0, 3], [1, 3], [0, 2, 3]];
    function oplCar(snap) { return snap.four ? OPL_CAR4[snap.alg] : OPL_CAR[snap.alg]; }
    // estado do canal agora: nota, volume (0..1) e pan
    function oplState(chip, ch) {
      var bank = ch >= 9 ? 1 : 0, c = ch % 9, R = chip.regs[bank], fnum, block, f, pan = 64, v;
      if (chip.kind === 'opll') {
        R = chip.regs[0]; fnum = R[0x10 + ch] | ((R[0x20 + ch] & 1) << 8); block = (R[0x20 + ch] >> 1) & 7;
        f = fnum * chip.rate * Math.pow(2, block) / 524288;
        v = Math.pow(10, -(R[0x30 + ch] & 15) * 3 / 20);
      } else {
        fnum = R[0xA0 + c] | ((R[0xB0 + c] & 3) << 8); block = (R[0xB0 + c] >> 2) & 7;
        f = fnum * chip.rate * Math.pow(2, block) / 1048576;
        var snap = oplSnapshot(chip, ch), car = oplCar(snap), minTL = 63;
        car.forEach(function (i) { minTL = Math.min(minTL, snap.ops[i].tl); });
        v = Math.pow(10, -minTL * 0.75 / 20);
        if (chip.kind === 'opl3') { var lr = (R[0xC0 + c] >> 4) & 3; pan = lr === 1 ? 0 : lr === 2 ? 127 : 64; }
      }
      return { n: midiOf(f), v: v, pan: pan };
    }
    function oplKey(chip, ch) {
      var snap = oplSnapshot(chip, ch), car = oplCar(snap), minTL = 63;
      car.forEach(function (i) { minTL = Math.min(minTL, snap.ops[i].tl); });
      // volume da música mexe no TL das portadoras: normaliza a mais alta para 0
      snap.ops.forEach(function (o, i) { if (car.indexOf(i) >= 0) o.tl -= minTL; });
      var st = oplState(chip, ch), lbl = 'FM ' + (ch + 1);
      var key = chip.chip + '|opl|' + snap.alg + '|' + snap.fb + '|' + (snap.four ? 4 : 2) + '|' + (snap.inst || 0) + '|' +
        snap.ops.map(function (o) { return [o.am, o.vib, o.egt, o.ksr, o.mul, o.ksl, o.tl, o.ar, o.dr, o.sl, o.rr, o.ws].join('.'); }).join('/');
      var tbObj = col.add(key, function () {
        // afinação: se a portadora soa uma oitava acima/abaixo (MUL 0, 2, 4, 8), corrige o teclado
        var best = null;
        car.forEach(function (i) { var o = snap.ops[i]; if (!best || o.tl < best.tl) best = o; });
        var mv = OPL_MUL[best.mul], tune = [0.5, 1, 2, 4, 8].indexOf(mv) >= 0 ? -12 * Math.log2(mv) : 0;
        return { type: 'opl', oplKind: chip.kind, clock: chip.clock, rate: chip.rate, alg: snap.alg, fb: snap.fb, four: snap.four, ops: snap.ops,
          dam: snap.dam, dvb: snap.dvb, tune: tune, opllInst: chip.kind === 'opll' ? snap.inst : undefined,
          presetName: chip.kind === 'opll' && snap.inst ? OPLL_NAMES[snap.inst] : undefined };
      }, lbl, st.n, chip.chip);
      if (REC) {
        var id = chip.chip + ' · ' + lbl;
        if (!chip.mseen[ch]) { chip.mseen[ch] = 1; mchan(id, chip.chip, lbl, 'fm'); }
        REC.push({ c: id, t: t, k: 'on', n: st.n, v: st.v, pan: st.pan, tb: tbObj });
        chip.mcur[ch] = st;
      }
    }
    function oplOff(chip, ch) {
      if (REC && chip.mcur[ch]) { REC.push({ c: chip.chip + ' · FM ' + (ch + 1), t: t, k: 'off' }); chip.mcur[ch] = null; }
    }
    function oplFrame(chip) {
      for (var ch = 0; ch < chip.nch; ch++) {
        var cur = chip.mcur[ch]; if (!cur || !chip.keyed[ch]) continue;
        var st = oplState(chip, ch), id = chip.chip + ' · FM ' + (ch + 1);
        if (Math.abs(st.n - cur.n) > 0.02 && st.n > 0) { REC.push({ c: id, t: col.ft, k: 'pitch', n: st.n }); cur.n = st.n; }
        if (Math.abs(st.v - cur.v) > 0.01) { REC.push({ c: id, t: col.ft, k: 'vol', v: st.v }); cur.v = st.v; }
        if (st.pan !== cur.pan) { REC.push({ c: id, t: col.ft, k: 'pan', pan: st.pan }); cur.pan = st.pan; }
      }
    }
    function oplDrums(chip, bits) { // modo ritmo: cada peça que acabou de bater vira uma nota de bateria
      var rising = bits & ~chip.rhy; chip.rhy = bits;
      if (!REC || !rising) return;
      var id = chip.chip + ' · Bateria';
      if (!chip.drumSeen) { chip.drumSeen = true; mchan(id, chip.chip, 'Bateria', 'noise'); }
      OPL_DRUM.forEach(function (d) { if (rising & d[0]) { REC.push({ c: id, t: t, k: 'on', n: d[1], v: 0.9, pan: 64, noise: { ck: 'drum', d: d[1] } }); REC.push({ c: id, t: t + 2205, k: 'off' }); } });
    }
    function oplWrite(chip, port, a, d) {
      chip.used = true;
      var R = chip.regs[port], old = R[a]; R[a] = d;
      if (chip.kind === 'opll') {
        if (a === 0x0E) { oplDrums(chip, (d & 0x20) ? d & 31 : 0); return; }
        if (a >= 0x20 && a <= 0x28) {
          var ch = a - 0x20, on = (d >> 4) & 1;
          if ((R[0x0E] & 0x20) && ch >= 6) return; // canais 7-9 viram bateria no modo ritmo
          if (on && !chip.keyed[ch]) oplKey(chip, ch);
          if (!on && chip.keyed[ch]) oplOff(chip, ch);
          chip.keyed[ch] = on;
        }
        return;
      }
      if (port === 0 && a === 0xBD) { oplDrums(chip, (d & 0x20) ? d & 31 : 0); return; }
      if (a >= 0xB0 && a <= 0xB8) {
        var c = a - 0xB0, ch2 = c + port * 9, on2 = (d >> 5) & 1;
        if (ch2 >= chip.nch) return;
        if (port === 0 && (chip.regs[0][0xBD] & 0x20) && c >= 6) return;
        var p4 = opl4of(chip, ch2);
        if (p4 >= 0 && p4 !== ch2) return;    // 2ª metade de um par de 4 operadores: quem manda é o 1º canal
        if (on2 && !chip.keyed[ch2]) oplKey(chip, ch2);
        if (!on2 && chip.keyed[ch2]) oplOff(chip, ch2);
        chip.keyed[ch2] = on2;
      }
    }
    var opl = {};
    if (clk.ym3812) opl.ym3812 = new OPLChip('opl2', 'YM3812', clk.ym3812, 9);
    if (dual.ym3812) opl.ym3812b = new OPLChip('opl2', 'YM3812 #2', clk.ym3812, 9);
    if (clk.ym3526) opl.ym3526 = new OPLChip('opl', 'YM3526', clk.ym3526, 9);
    if (clk.y8950) opl.y8950 = new OPLChip('y8950', 'Y8950', clk.y8950, 9);
    if (clk.ymf262) opl.ymf262 = new OPLChip('opl3', 'YMF262', clk.ymf262, 18);

    function opnWrite(chip, port, a, d) {
      chip.used = true;
      chip.regs[port][a] = d;
      if (port === 0 && a === 0x2B) chip.dac = !!(d & 0x80);
      if (DS && port === 0 && a === 0x2A && chip.chip === 'YM2612' && chip.dac) dsPush(t, d);
      if (port === 0 && a === 0x28) {
        var c = d & 7, ch = c >= 4 ? c - 1 : c;
        if (c === 3 || c === 7 || ch >= chip.nch) return;
        var on = (d >> 4) & 15;
        if (on && !chip.keyed[ch] && !(chip.dac && ch === 5 && chip.chip === 'YM2612')) fmKey(chip, ch);
        if (!on && chip.keyed[ch]) fmOff(chip, ch);
        chip.keyed[ch] = on ? 1 : 0;
      }
    }
    function opmWrite(chip, a, d) {
      chip.used = true;
      if (a === 0x19) { if (d & 0x80) chip.pmd = d & 127; else chip.amd = d & 127; }
      chip.regs[0][a] = d;
      if (a === 0x08) {
        var ch = d & 7, on = (d >> 3) & 15;
        if (on && !chip.keyed[ch]) fmKey(chip, ch);
        if (!on && chip.keyed[ch]) fmOff(chip, ch);
        chip.keyed[ch] = on ? 1 : 0;
      }
    }

    // ── SN76489 ──
    // SN76489 (um objeto por chip: a música pode ter dois)
    function makeSN(name) {
      // período 0: no PSG da Sega vale 1 (frequência máxima); no SN da TI vale 0x400 (bit 0 das flags, VGM 1.51+)
      var o = { clock: clk.sn, att: [15, 15, 15, 15], per: [0, 0, 0, 0], latch: 0, ltype: 0, noise: 0, ch: [],
        zero: ver >= 0x151 && b.length > 0x2B && (b[0x2B] & 1) ? 1024 : 1 };
      for (var i = 0; i < 4; i++) { var pc = new PSGChan(col, i < 3 ? 'PSG ' + (i + 1) : 'Ruído', name, REC); mchan(pc.id, pc.chip, pc.label, i < 3 ? 'psg' : 'noise'); o.ch.push(pc); chans.push(pc); }
      return o;
    }
    var sn = clk.sn ? makeSN('SN76489') : null;
    var sn2 = dual.sn ? makeSN('SN76489 #2') : null;
    function snVol(a) { return a >= 15 ? 0 : Math.pow(10, -2 * a / 20); }
    function snUpdate(sn) {
      for (var i = 0; i < 3; i++) {
        var c = sn.ch[i], p = sn.per[i] || 1024;
        c.vol = p <= 1 ? 0 : snVol(sn.att[i]); c.freq = sn.clock / (32 * p);
        c.wave = { k: 'pulse', ck: 'sn', duty: 2 };
      }
      var n = sn.ch[3]; n.vol = snVol(sn.att[3]);
      n.wave = { k: 'noise', ck: 'sn', nmode: (sn.noise & 4) ? 'white' : 'periodic', nrate: sn.noise & 3,
        tf: (sn.noise & 3) === 3 ? sn.clock / (32 * (sn.per[2] || sn.zero)) : 0 };
      n.freq = 0;
    }
    function snWrite(d, sn) {
      if (d & 0x80) {
        sn.latch = (d >> 5) & 3; sn.ltype = (d >> 4) & 1;
        if (sn.ltype) sn.att[sn.latch] = d & 15;
        else if (sn.latch === 3) { sn.noise = d & 7; sn.ch[3].trig = true; }
        else sn.per[sn.latch] = (sn.per[sn.latch] & 0x3F0) | (d & 15);
      } else {
        if (sn.ltype) sn.att[sn.latch] = d & 15;
        else if (sn.latch < 3) sn.per[sn.latch] = (sn.per[sn.latch] & 15) | ((d & 63) << 4);
        else { sn.noise = d & 7; sn.ch[3].trig = true; }
      }
      snUpdate(sn);
    }

    // ── NES APU ──
    var nes = null;
    var LEN = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30];
    var NNOISE = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
    if (clk.nes) {
      nes = { clock: clk.nes, r: new Uint8Array(32), en: 0, ch: [], env: [], len: [0, 0, 0, 0], lin: 0, linReload: false };
      ['Pulso 1', 'Pulso 2', 'Triângulo', 'Ruído NES'].forEach(function (l) { var pc = new PSGChan(col, l, 'NES APU', REC); mchan(pc.id, pc.chip, l, /Ruído/.test(l) ? 'noise' : 'psg'); nes.ch.push(pc); chans.push(pc); });
      for (var k = 0; k < 4; k++) nes.env.push({ v: 15, acc: 0 });
    }
    function nesWrite(a, d) {
      if (a > 0x17) return;
      nes.r[a] = d;
      var ch = a >> 2;
      if (a === 0x15) { nes.en = d; for (var i = 0; i < 4; i++) if (!(d & (1 << i))) nes.len[i] = 0; return; }
      if (ch < 4 && (a & 3) === 3) {
        if (nes.en & (1 << ch)) nes.len[ch] = LEN[d >> 3];
        nes.env[ch].v = 15; nes.env[ch].acc = 0;
        if (ch === 2) nes.linReload = true;
        nes.ch[ch].trig = true;
      }
    }
    function nesFrame() {
      // 4 "quartos de quadro" (240 Hz) e 2 "meios" (120 Hz) por quadro de 60 Hz
      for (var c = 0; c < 4; c++) {
        if (c === 2) continue;
        var base = c * 4, r0 = nes.r[base], e = nes.env[c];
        if (!(r0 & 0x10)) {
          e.acc += 4;
          var per = (r0 & 15) + 1;
          while (e.acc >= per) { e.acc -= per; if (e.v > 0) e.v--; else if (r0 & 0x20) e.v = 15; }
        }
        if (!(r0 & 0x20) && nes.len[c] > 0) nes.len[c] = Math.max(0, nes.len[c] - 2);
      }
      var r8 = nes.r[8];
      if (nes.linReload) { nes.lin = r8 & 127; } else if (nes.lin > 0) nes.lin = Math.max(0, nes.lin - 4);
      if (!(r8 & 0x80)) nes.linReload = false;
      if (!(r8 & 0x80) && nes.len[2] > 0) nes.len[2] = Math.max(0, nes.len[2] - 2);
      for (c = 0; c < 4; c++) {
        var pc = nes.ch[c], b0 = c * 4, on = (nes.en & (1 << c)) && nes.len[c] > 0;
        if (c < 2) {
          var t = nes.r[b0 + 2] | ((nes.r[b0 + 3] & 7) << 8);
          var vv = (nes.r[b0] & 0x10) ? (nes.r[b0] & 15) : nes.env[c].v;
          pc.vol = (on && t >= 8) ? vv / 15 : 0; pc.freq = nes.clock / (16 * (t + 1));
          pc.wave = { k: 'pulse', ck: 'nes', duty: nes.r[b0] >> 6 };
        } else if (c === 2) {
          var tt = nes.r[10] | ((nes.r[11] & 7) << 8);
          pc.vol = (on && nes.lin > 0 && tt >= 2) ? 1 : 0; pc.freq = nes.clock / (32 * (tt + 1));
          pc.wave = { k: 'tri', ck: 'nes', duty: null };
        } else {
          var nv = (nes.r[12] & 0x10) ? (nes.r[12] & 15) : nes.env[3].v;
          pc.vol = on ? nv / 15 : 0;
          pc.wave = { k: 'noise', ck: 'nes', nmode: (nes.r[14] & 0x80) ? 'periodic' : 'white', nrate: nes.r[14] & 15 };
          pc.freq = nes.clock / NNOISE[nes.r[14] & 15];
        }
      }
    }

    // ── Game Boy (DMG) ──
    var gb = null;
    if (clk.gb) {
      gb = { r: new Uint8Array(0x30), ch: [], env: [], len: [0, 0, 0, 0] };
      ['Pulso 1', 'Pulso 2', 'Onda', 'Ruído GB'].forEach(function (l) { var pc = new PSGChan(col, l, 'Game Boy', REC); mchan(pc.id, pc.chip, l, /Ruído/.test(l) ? 'noise' : 'psg'); gb.ch.push(pc); chans.push(pc); });
      for (var g = 0; g < 4; g++) gb.env.push({ v: 0, acc: 0, on: false });
    }
    function gbWrite(a, d) {
      if (a >= 0x30) return;
      gb.r[a] = d;
      var trigRegs = { 0x04: 0, 0x09: 1, 0x0E: 2, 0x13: 3 };
      if (a in trigRegs && (d & 0x80)) {
        var c = trigRegs[a], e = gb.env[c];
        e.on = true; e.acc = 0;
        if (c !== 2) { var nr2 = gb.r[[0x02, 0x07, 0, 0x11][c]]; e.v = nr2 >> 4; if ((nr2 & 0xF8) === 0) e.on = false; }
        else e.on = !!(gb.r[0x0A] & 0x80);
        var lr = [0x01, 0x06, 0x0B, 0x10][c];
        gb.len[c] = c === 2 ? 256 - gb.r[lr] : 64 - (gb.r[lr] & 63);
        gb.ch[c].trig = true;
      }
    }
    function gbFrame() {
      for (var c = 0; c < 4; c++) {
        var e = gb.env[c];
        if (c !== 2) {
          var nr2 = gb.r[[0x02, 0x07, 0, 0x11][c]], per = nr2 & 7;
          if (per && e.on) { e.acc += 64 / 60; while (e.acc >= per) { e.acc -= per; if (nr2 & 8) { if (e.v < 15) e.v++; } else if (e.v > 0) e.v--; } }
        }
        var lenEn = gb.r[[0x04, 0x09, 0x0E, 0x13][c]] & 0x40;
        if (lenEn && gb.len[c] > 0) { gb.len[c] -= 256 / 60; if (gb.len[c] <= 0) { gb.len[c] = 0; e.on = false; } }
      }
      for (c = 0; c < 2; c++) {
        var b0 = c ? 0x05 : 0x00, x = gb.r[b0 + 3] | ((gb.r[b0 + 4] & 7) << 8);
        gb.ch[c].vol = gb.env[c].on ? gb.env[c].v / 15 : 0; gb.ch[c].freq = 131072 / (2048 - x);
        gb.ch[c].wave = { k: 'pulse', ck: 'gb', duty: gb.r[b0 + 1] >> 6 };
      }
      var wx = gb.r[0x0D] | ((gb.r[0x0E] & 7) << 8), lvl = (gb.r[0x0C] >> 5) & 3;
      var tbl = []; for (var i = 0; i < 16; i++) { tbl.push(gb.r[0x20 + i] >> 4); tbl.push(gb.r[0x20 + i] & 15); }
      gb.ch[2].vol = (gb.env[2].on && (gb.r[0x0A] & 0x80)) ? [0, 1, 0.5, 0.25][lvl] : 0;
      gb.ch[2].freq = 65536 / (2048 - wx);
      gb.ch[2].wave = { k: 'wave', ck: 'gb', tbl: tbl, duty: null };
      var n3 = gb.r[0x12];
      gb.ch[3].vol = gb.env[3].on ? gb.env[3].v / 15 : 0;
      gb.ch[3].wave = { k: 'noise', ck: 'gb', nmode: (n3 & 8) ? 'periodic' : 'white', nrate: n3 >> 4 };
      gb.ch[3].freq = 0;
    }

    // ── HuC6280 (PC Engine / TurboGrafx-16): 6 canais de onda desenhada (32 passos de 5 bits); 5 e 6 também fazem ruído ──
    var huc = null;
    if (clk.huc) {
      huc = { clock: clk.huc, sel: 0, main: 0xFF, ch: [], c: [] };
      for (var hh = 0; hh < 6; hh++) {
        var hp = new PSGChan(col, 'Canal ' + (hh + 1), 'HuC6280', REC); mchan(hp.id, hp.chip, hp.label, 'psg'); huc.ch.push(hp); chans.push(hp);
        huc.c.push({ freq: 0, ctl: 0, bal: 0xFF, wave: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], idx: 0, noise: 0 });
      }
    }
    function hucWrite(a, d) {
      if (a === 0) { huc.sel = d & 7; return; }
      if (a === 1) { huc.main = d; return; }
      if (huc.sel > 5) return;
      var c = huc.c[huc.sel];
      if (a === 2) c.freq = (c.freq & 0xF00) | d;
      else if (a === 3) c.freq = (c.freq & 0xFF) | ((d & 15) << 8);
      else if (a === 4) {
        if ((c.ctl & 0x40) && !(d & 0x40)) c.idx = 0;          // saiu do modo DDA: volta ao começo da onda
        if (!(c.ctl & 0x80) && (d & 0x80)) huc.ch[huc.sel].trig = true;
        c.ctl = d;
      }
      else if (a === 5) c.bal = d;
      else if (a === 6) { if (!(c.ctl & 0x40)) { c.wave[c.idx & 31] = d & 31; c.idx = (c.idx + 1) & 31; } }
      else if (a === 7) { if (huc.sel >= 4) c.noise = d; }
    }
    function hucFrame() {
      var m = Math.max(huc.main >> 4, huc.main & 15);
      for (var i = 0; i < 6; i++) {
        var c = huc.c[i], pc = huc.ch[i];
        var on = (c.ctl & 0x80) && !(c.ctl & 0x40), vol = c.ctl & 31, bl = Math.max(c.bal >> 4, c.bal & 15);
        // 1,5 dB por passo no volume do canal; 3 dB por passo no balanço e no volume geral
        var att = (31 - vol) * 1.5 + (15 - bl) * 3 + (15 - m) * 3;
        pc.vol = on && vol && bl && m ? Math.pow(10, -att / 20) : 0;
        if (i >= 4 && (c.noise & 0x80)) { pc.wave = { k: 'noise', ck: 'pce', nmode: 'white', nrate: c.noise & 31 }; pc.freq = 0; }
        else {
          pc.freq = huc.clock / (32 * (c.freq || 0x1000));
          pc.wave = { k: 'wave', ck: 'pce', tbl: c.wave.map(function (x) { return Math.round(x * 15 / 31); }), duty: null };
        }
      }
    }

    // ── AY-3-8910 / SSG dos chips OPN ──
    function makeAY(clock, chipName) {
      var ay = { clock: clock, r: new Uint8Array(16), ch: [] };
      for (var i = 0; i < 3; i++) { var pc = new PSGChan(col, 'SSG ' + 'ABC'[i], chipName, REC); mchan(pc.id, chipName, pc.label, 'psg'); ay.ch.push(pc); chans.push(pc); }
      return ay;
    }
    function ayFrame(ay) {
      for (var i = 0; i < 3; i++) {
        var p = ay.r[i * 2] | ((ay.r[i * 2 + 1] & 15) << 8), mix = ay.r[7], amp = ay.r[8 + i];
        var toneOn = !(mix & (1 << i)), noiseOn = !(mix & (8 << i));
        var v = (amp & 16) ? 1 : (amp & 15) ? Math.pow(10, -(15 - (amp & 15)) * 1.5 / 20) : 0;
        var c = ay.ch[i];
        c.vol = (toneOn || noiseOn) ? v : 0;
        c.freq = ay.clock / (16 * (p || 1));
        c.wave = toneOn ? { k: 'pulse', ck: 'ay', duty: 2 } : { k: 'noise', ck: 'ay', nmode: 'white', nrate: ay.r[6] & 31 };
      }
    }
    var ays = [];
    var ay = clk.ay ? makeAY(clk.ay, 'AY-3-8910') : null; if (ay) ays.push(ay);
    var ay2 = dual.ay ? makeAY(clk.ay, 'AY-3-8910 #2') : null; if (ay2) ays.push(ay2);
    var ssg = {};
    ['ym2203', 'ym2608', 'ym2610'].forEach(function (n) { if (clk[n]) { ssg[n] = makeAY(clk[n] / 4, fm[n].chip + ' SSG'); ays.push(ssg[n]); } });

    // ───────────── chips de sample (PCM / ADPCM) ─────────────
    // O "timbre" é o próprio sample do jogo. A nota sai da afinação do sample (detectada) e da velocidade em que o chip toca;
    // sample sem afinação definida (bateria, voz) vira nota de bateria.
    var ROM = {};                  // tipo do bloco de dados do VGM → memória do chip (ROM de samples)
    function romPut(type, total, start, data) {
      var r = ROM[type];
      if (!r || r.length < Math.max(total, start + data.length)) { var nr = new Uint8Array(Math.max(total, start + data.length, r ? r.length : 0)); if (r) nr.set(r); r = ROM[type] = nr; }
      r.set(data, start);
    }
    var STREAMBLK = {};            // tipo do bloco (0x00-0x3F) → lista de blocos {data}
    var smpDone = {};              // amostras já decodificadas (pelo endereço)
    function pcmSample(chipName, key, decode, rate) {
      var k = chipName + '|' + key;
      if (smpDone[k]) return smpDone[k];
      var d = decode(); if (!d || d.data.length < 16) return (smpDone[k] = null);
      var data = d.data, srate = rate;
      // no máximo 4 s (e no máximo 32 kHz) para não pesar o navegador
      if (srate > 32000) { var f = Math.ceil(srate / 32000), nd = new Float32Array(Math.floor(data.length / f)); for (var i = 0; i < nd.length; i++) nd[i] = data[i * f]; data = nd; srate /= f; d.loop = d.loop >= 0 ? Math.floor(d.loop / f) : -1; }
      if (data.length > srate * 4) data = data.subarray(0, Math.floor(srate * 4));
      var id = 's' + (PCMSTORE.n++);
      var lp0 = d.loop >= 0 && d.loop < data.length ? d.loop : -1, info = pcmPitch(data, srate);
      if (!info.pitched && lp0 >= 0 && data.length - lp0 <= 1024 && data.length - lp0 >= 8) info = { pitched: true, note: midiOf(srate / (data.length - lp0)) };
      var s = { id: id, rate: srate, len: data.length, loop: d.loop >= 0 && d.loop < data.length ? d.loop : -1, base: info.pitched ? info.note : null, drum: info.pitched ? null : drumOf(data, srate) };
      PCMSTORE.map[id] = data;
      return (smpDone[k] = s);
    }
    // afinação do sample: autocorrelação num trecho depois do ataque
    function pcmPitch(x, rate) {
      var n = x.length, st = Math.min(Math.floor(rate * 0.03), Math.floor(n * 0.2)), W = Math.min(2048, n - st);
      if (W < 256) return { pitched: false };
      var minLag = Math.floor(rate / 1200), maxLag = Math.min(Math.floor(rate / 40), Math.floor(W / 2));
      var e0 = 0; for (var i = 0; i < W; i++) e0 += x[st + i] * x[st + i];
      if (e0 < 1e-6) return { pitched: false };
      var best = 0, bestLag = 0, prev = 1, rising = false, first = 0;
      for (var lag = minLag; lag <= maxLag; lag++) {
        var c = 0, e1 = 0;
        for (i = 0; i < W - lag; i++) { c += x[st + i] * x[st + i + lag]; e1 += x[st + i + lag] * x[st + i + lag]; }
        var r = c / Math.sqrt(e0 * e1 + 1e-12);
        if (r > prev) rising = true;
        if (rising && r < prev && prev > 0.8 && !first) { first = lag - 1; best = prev; bestLag = lag - 1; break; }
        if (r > best) { best = r; bestLag = lag; }
        prev = r;
      }
      if (best < 0.8 || !bestLag) return { pitched: false };
      return { pitched: true, note: midiOf(rate / bestLag) };
    }
    // peça de bateria pelo "brilho" (cruzamentos de zero) e pela duração
    function drumOf(x, rate) {
      var n = Math.min(x.length, Math.floor(rate * 0.25)), z = 0;
      for (var i = 1; i < n; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) z++;
      var zcr = z * rate / (2 * Math.max(1, n)), dur = x.length / rate;
      if (zcr < 250) return 36;               // bumbo
      if (zcr < 1500) return dur > 0.35 ? 45 : 38;  // tom / caixa
      return dur > 0.5 ? 49 : 42;             // prato / chimbal
    }
    // um canal de chip de sample: registra as notas (com o sample como timbre)
    function PCMChan(chipName, label) { this.chip = chipName; this.label = label; this.id = chipName + ' · ' + label; this.on = null; this.seen = false; this.nDrum = 0; this.nTone = 0; }
    PCMChan.prototype.keyOn = function (s, playRate, vol, pan, at) {
      if (!s) return;
      if (at != null) { var tsave = t; t = at; this.keyOn(s, playRate, vol, pan); t = tsave; pcmOutOfOrder = true; return; }
      this.keyOff();
      var drum = s.base == null, note = drum ? 60 : s.base + 12 * Math.log2(playRate / s.rate);
      var self = this;
      var tbObj = col.add(this.chip + '|pcm|' + s.id, function () {
        return { type: 'pcm', pcmId: s.id, rate: s.rate, len: s.len, loop: s.loop, base: s.base, drum: s.drum, tune: 0 };
      }, this.label, drum ? 0 : note, this.chip);
      if (drum) this.nDrum++; else this.nTone++;
      if (!REC) return;
      if (!this.seen) { this.seen = true; mchan(this.id, this.chip, this.label, 'pcm'); }
      var ev = { c: this.id, t: t, k: 'on', n: drum ? s.drum : note, v: vol, pan: pan == null ? 64 : pan, tb: tbObj };
      if (drum) ev.noise = { ck: 'drum', d: s.drum };
      REC.push(ev);
      this.on = { s: s, rate: playRate, n: note, v: vol, drum: drum };
    };
    PCMChan.prototype.keyOff = function (at) { if (this.on && REC) REC.push({ c: this.id, t: at != null ? at : t, k: 'off' }); this.on = null; };
    var pcmOutOfOrder = false;
    PCMChan.prototype.setRate = function (r) {
      var o = this.on; if (!o || o.drum || !REC || !r) return;
      var n = o.s.base + 12 * Math.log2(r / o.s.rate);
      if (Math.abs(n - o.n) > 0.05) { REC.push({ c: this.id, t: t, k: 'pitch', n: n }); o.n = n; }
    };
    PCMChan.prototype.setVol = function (v) { var o = this.on; if (!o || !REC) return; if (Math.abs(v - o.v) > 0.02) { REC.push({ c: this.id, t: t, k: 'vol', v: v }); o.v = v; } };
    var pcmChans = [];
    function pcmChanSet(chipName, n, label) { var a = []; for (var i = 0; i < n; i++) { var c = new PCMChan(chipName, label + ' ' + (i + 1)); a.push(c); pcmChans.push(c); } return a; }

    // ADPCM da OKI (Dialogic, 4 bits): OKIM6295 lê o nibble alto primeiro; OKIM6258, o baixo
    var OKI_STEP = [16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552];
    var OKI_IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
    function okiDecode(mem, start, end, lowFirst) {
      var n = Math.max(0, Math.min(end, mem.length) - start), out = new Float32Array(n * 2), sig = 0, idx = 0, o = 0;
      function nib(v) {
        var step = OKI_STEP[idx], diff = ((2 * (v & 7) + 1) * step) >> 3;
        sig += (v & 8) ? -diff : diff; if (sig > 2047) sig = 2047; else if (sig < -2048) sig = -2048;
        idx += OKI_IDX[v & 7]; if (idx < 0) idx = 0; else if (idx > 48) idx = 48;
        out[o++] = sig / 2048;
      }
      for (var i = 0; i < n; i++) { var by = mem[start + i]; if (lowFirst) { nib(by & 15); nib(by >> 4); } else { nib(by >> 4); nib(by & 15); } }
      return { data: out, loop: -1 };
    }

    // ── OKIM6295: 4 vozes, frases (samples) numa tabela na ROM ──
    var oki = null;
    if (hclk(0x98)) {
      var okc = hclk(0x98);
      oki = { clock: okc, pin7: (u32(b, 0x98) >> 31) & 1, cmd: -1, bank: 0, ch: pcmChanSet('OKIM6295', 4, 'Voz') };
    }
    function okiRate() { return oki.clock / (oki.pin7 ? 132 : 165); }
    var OKI_ATT = [0, -3.2, -6, -9.2, -12, -14.5, -18, -20.5, -24, -24, -24, -24, -24, -24, -24, -24];
    function okiWrite(a, d) {
      if (a === 0x0C) { oki.pin7 = d & 1; return; }
      if (a === 0x0E || a === 0x0F) { oki.bank = d; return; }
      if (a !== 0) return;
      if (oki.cmd >= 0) {
        var ph = oki.cmd, mem = ROM[0x8B]; oki.cmd = -1;
        if (!mem) return;
        var base = (oki.bank & 0x0F) * 0x40000, o = base + ph * 8;
        if (o + 6 > mem.length) return;
        var st = base + (((mem[o] << 16) | (mem[o + 1] << 8) | mem[o + 2]) & 0x3FFFF), en = base + (((mem[o + 3] << 16) | (mem[o + 4] << 8) | mem[o + 5]) & 0x3FFFF);
        if (en <= st) return;
        var s = pcmSample('OKIM6295', st, function () { return okiDecode(mem, st, en + 1, false); }, okiRate());
        var vol = Math.pow(10, OKI_ATT[d & 15] / 20);
        for (var v = 0; v < 4; v++) if (d & (0x10 << v)) oki.ch[v].keyOn(s, okiRate(), vol);
        return;
      }
      if (d & 0x80) { oki.cmd = d & 0x7F; return; }
      for (var w = 0; w < 4; w++) if (d & (0x08 << w)) oki.ch[w].keyOff();
    }

    // ── OKIM6258 (X68000): ADPCM mandado em fluxo (stream) pelo VGM: cada bloco iniciado = um sample ──
    var oki58 = null;
    if (hclk(0x90)) {
      var o58f = b.length > 0x94 ? b[0x94] : 0;
      oki58 = { clock: hclk(0x90), div: [1024, 768, 512, 512][o58f & 3], ch: pcmChanSet('OKIM6258', 1, 'ADPCM'), buf: new Uint8Array(1 << 16), tt: new Float64Array(1 << 16), n: 0 };
    }
    function oki58Rate() { return oki58.clock / oki58.div; }
    function oki58Write(a, d) {
      if (a === 0x0C) { oki58.div = [1024, 768, 512, 512][d & 3]; return; }
      if (a !== 1) return;
      if (oki58.n === oki58.buf.length) { var nb = new Uint8Array(oki58.n * 2); nb.set(oki58.buf); oki58.buf = nb; var nt = new Float64Array(oki58.n * 2); nt.set(oki58.tt); oki58.tt = nt; }
      oki58.buf[oki58.n] = d; oki58.tt[oki58.n] = t; oki58.n++;
    }
    // o driver manda ADPCM sem parar (silêncio entre os sons): recorta cada som pelo volume do sinal decodificado
    function oki58Finish() {
      if (!oki58 || oki58.n < 64) return;
      var N = oki58.n, sig = okiDecode(oki58.buf, 0, N, true).data, W = 32, nw = Math.floor(sig.length / W), rms = new Float32Array(nw), i, k;
      // tira o "desvio" lento do decodificador (o sinal anda devagar mesmo no silêncio)
      var avg = 0; for (i = 0; i < sig.length; i++) { avg += (sig[i] - avg) * 0.002; sig[i] -= avg; }
      for (k = 0; k < nw; k++) { var e = 0; for (i = 0; i < W; i++) e += sig[k * W + i] * sig[k * W + i]; rms[k] = Math.sqrt(e / W); }
      var sorted = Array.prototype.slice.call(rms).sort(function (a, b2) { return a - b2; });
      var thr = Math.max(0.01, sorted[Math.floor(nw * 0.3)] * 4, sorted[Math.floor(nw * 0.98)] * 0.08);
      var rate = oki58Rate(), regs = [], on = -1, quiet = 0;
      for (k = 0; k < nw; k++) {
        if (rms[k] > thr) { if (on < 0) on = k; quiet = 0; }
        else if (on >= 0 && ++quiet >= 12) { regs.push([on, k - quiet + 1]); on = -1; quiet = 0; }
      }
      if (on >= 0) regs.push([on, nw]);
      regs.forEach(function (r) {
        var a0 = r[0] * W, a1 = Math.min(sig.length, r[1] * W + W * 4), b0 = a0 >> 1;
        if (a1 - a0 < rate * 0.02) return;
        // mesmo som = mesmos bytes no começo
        var fp = []; for (var q = b0; q < Math.min(N, b0 + 40); q++) fp.push(oki58.buf[q]);
        var seg = sig.slice(a0, a1);
        var s = pcmSample('OKIM6258', fp.join('.'), function () { return { data: seg, loop: -1 }; }, rate);
        oki58.ch[0].keyOn(s, rate, 1, 64, oki58.tt[Math.min(N - 1, b0)]);
        oki58.ch[0].keyOff(oki58.tt[Math.min(N - 1, (a1 >> 1))]);
      });
    }

    // ── SegaPCM (arcades da Sega): 16 canais de 8 bits, afinação pelo registrador "delta" ──
    var spcm = null;
    if (hclk(0x38)) {
      spcm = { clock: hclk(0x38), ifr: u32(b, 0x3C), r: new Uint8Array(0x100), ch: pcmChanSet('SegaPCM', 16, 'Canal') };
      for (var spi = 0; spi < 16; spi++) spcm.r[0x86 + 8 * spi] = 1; // começa tudo desligado
      // banco: bits do registrador 0x86 (máscara e deslocamento vêm do cabeçalho)
      spcm.bshift = (spcm.ifr & 0x0F) || 12; spcm.bmask = 0x70 | ((spcm.ifr >> 16) & 0xFC);
    }
    function spcmRate(c) { return spcm.clock / 128 * spcm.r[0x07 + 8 * c] / 128; }
    function spcmWrite(a, d) {
      a &= 0x7FF; if (a >= 0x100) return;
      var old = spcm.r[a]; spcm.r[a] = d;
      var c = (a >> 3) & 15, reg = a & 0x87;
      if (reg === 0x84 || reg === 0x85) spcm.dirty = (spcm.dirty || 0) | (1 << c);
      if (reg === 0x86) {
        var was = !(old & 1), now = !(d & 1), dirty = (spcm.dirty || 0) & (1 << c);
        if (now && (!was || dirty)) {
          spcm.dirty &= ~(1 << c);
          var mem = ROM[0x80]; if (!mem) return;
          var bank = (d & spcm.bmask) << spcm.bshift;
          var st = bank + ((spcm.r[0x85 + 8 * c] << 8) | spcm.r[0x84 + 8 * c]), en = bank + ((spcm.r[0x06 + 8 * c] + 1) << 8);
          var lp = bank + ((spcm.r[0x05 + 8 * c] << 8) | spcm.r[0x04 + 8 * c]), loops = !(d & 2);
          if (en <= st || st >= mem.length) return;
          var s = pcmSample('SegaPCM', st + ':' + en + ':' + (loops ? lp : -1), function () {
            var n = Math.min(en, mem.length) - st, out = new Float32Array(n);
            for (var i = 0; i < n; i++) out[i] = (mem[st + i] - 128) / 128;
            return { data: out, loop: loops && lp >= st && lp < en ? lp - st : -1 };
          }, spcm.clock / 128);
          var vl = spcm.r[0x02 + 8 * c] & 0x7F, vr = spcm.r[0x03 + 8 * c] & 0x7F;
          spcm.ch[c].keyOn(s, spcmRate(c), Math.max(vl, vr) / 127, vl + vr ? Math.round(64 + 63 * (vr - vl) / (vl + vr)) : 64);
        } else if (!now && was) spcm.ch[c].keyOff();
      } else if (reg === 0x07) spcm.ch[c].setRate(spcmRate(c));
      else if (reg === 0x02 || reg === 0x03) spcm.ch[c].setVol(Math.max(spcm.r[0x02 + 8 * c] & 0x7F, spcm.r[0x03 + 8 * c] & 0x7F) / 127);
    }

    // ── K053260 (Konami): 4 canais, PCM de 8 bits ou ADPCM de 4 bits ──
    var k53 = null;
    var K53_DPCM = [0, 1, 2, 4, 8, 16, 32, 64, -128, -64, -32, -16, -8, -4, -2, -1];
    if (hclk(0xAC)) k53 = { clock: hclk(0xAC), r: new Uint8Array(0x40), ch: pcmChanSet('K053260', 4, 'Canal') };
    function k53Rate(c) { var o = 0x08 + c * 8, p = ((k53.r[o + 1] & 0x0F) << 8) | k53.r[o]; return k53.clock / (0x1000 - p) / 2; }
    function k53Write(a, d) {
      if (a >= 0x40) return;
      var old = k53.r[a]; k53.r[a] = d;
      if (a === 0x28) {
        for (var c = 0; c < 4; c++) {
          var on = d & (1 << c), was = old & (1 << c);
          if (on && !was) {
            var mem = ROM[0x8E]; if (!mem) continue;
            var o = 0x08 + c * 8, len = (k53.r[o + 3] << 8) | k53.r[o + 2], st = (k53.r[o + 6] << 16) | (k53.r[o + 5] << 8) | k53.r[o + 4];
            var adpcm = (k53.r[0x2A] >> (4 + c)) & 1, loops = (k53.r[0x2A] >> c) & 1;
            if (!len || st >= mem.length) continue;
            var s = pcmSample('K053260', st + ':' + len + ':' + adpcm, function () {
              var n = Math.min(len, mem.length - st), out, i;
              if (adpcm) { out = new Float32Array(n * 2); var acc = 0; for (i = 0; i < n * 2; i++) { var by = mem[st + (i >> 1)], nb = (i & 1) ? by >> 4 : by & 15; acc = ((acc + K53_DPCM[nb]) << 24) >> 24; out[i] = acc / 128; } }
              else { out = new Float32Array(n); for (i = 0; i < n; i++) out[i] = ((mem[st + i] << 24) >> 24) / 128; }
              return { data: out, loop: loops ? 0 : -1 };
            }, k53Rate(c));
            k53.ch[c].keyOn(s, k53Rate(c), (k53.r[o + 7] & 0x7F) / 127);
          } else if (!on && was) k53.ch[c].keyOff();
        }
      } else if (a >= 0x08 && a < 0x28) {
        var cc = (a - 0x08) >> 3, rr = (a - 0x08) & 7;
        if (rr <= 1) k53.ch[cc].setRate(k53Rate(cc)); else if (rr === 7) k53.ch[cc].setVol((d & 0x7F) / 127);
      }
    }

    // ── RF5C68 (Sega CD / System 18): 8 canais tocando de uma RAM de 64 KB; 0xFF marca o fim (e volta ao loop) ──
    var rf = null;
    if (hclk(0x40)) rf = { clock: hclk(0x40), ram: new Uint8Array(0x10000), sel: 0, bank: 0, on: 0xFF, c: [], ch: pcmChanSet('RF5C68', 8, 'Canal') };
    if (rf) for (var rfi = 0; rfi < 8; rfi++) rf.c.push({ env: 255, pan: 255, fd: 0, ls: 0, st: 0 });
    function rfRate(c) { return rf.clock / 384 * rf.c[c].fd / 2048; }
    function rfWrite(a, d) {
      var cur = rf.c[rf.sel];
      switch (a) {
        case 0x00: cur.env = d; rf.ch[rf.sel].setVol(d / 255); break;
        case 0x01: cur.pan = d; break;
        case 0x02: cur.fd = (cur.fd & 0xFF00) | d; rf.ch[rf.sel].setRate(rfRate(rf.sel)); break;
        case 0x03: cur.fd = (cur.fd & 0xFF) | (d << 8); rf.ch[rf.sel].setRate(rfRate(rf.sel)); break;
        case 0x04: cur.ls = (cur.ls & 0xFF00) | d; break;
        case 0x05: cur.ls = (cur.ls & 0xFF) | (d << 8); break;
        case 0x06: cur.st = d << 8; break;
        case 0x07: if (d & 0x40) rf.sel = d & 7; else rf.bank = (d & 15) << 12; break;
        case 0x08:
          var old = rf.on; rf.on = d;
          for (var c = 0; c < 8; c++) {
            var now = !(d & (1 << c)), was = !(old & (1 << c));
            if (now && !was) {
              var ch = rf.c[c], st = ch.st, ls = ch.ls;
              var fp = st + ':' + ls; for (var fq = 0; fq < 96; fq += 3) fp += ',' + rf.ram[(st + fq) & 0xFFFF];
              var s = pcmSample('RF5C68', fp, function () {
                // até achar o 0xFF (fim do sample); o byte tem sinal e módulo (bit 7 = positivo)
                var out = [], i = st;
                while (i < 0x10000 && rf.ram[i] !== 0xFF && out.length < 0x10000) { var v = rf.ram[i]; out.push((v & 0x80 ? (v & 0x7F) : -(v & 0x7F)) / 128); i++; }
                return { data: new Float32Array(out), loop: ls >= st && ls < i ? ls - st : -1 };
              }, rf.clock / 384);
              var pl = ch.pan & 15, pr = ch.pan >> 4;
              rf.ch[c].keyOn(s, rfRate(c), ch.env / 255, pl + pr ? Math.round(64 + 63 * (pr - pl) / (pl + pr)) : 64);
            } else if (!now && was) rf.ch[c].keyOff();
          }
          break;
      }
    }
    var rfVer = 0; // muda quando a RAM é reescrita (o mesmo endereço pode ter outro sample)
    function rfMem(a, d) { if (rf.ram[a & 0xFFFF] !== d) rfVer++; rf.ram[a & 0xFFFF] = d; }

    // ── C352 (Namco): 32 vozes, PCM de 8 bits ou mu-law ──
    var c352 = null;
    if (hclk(0xDC)) c352 = { clock: hclk(0xDC), div: (hdrLen > 0xD6 && b[0xD6]) ? b[0xD6] * 4 : 288, r: new Uint16Array(0x208), ch: pcmChanSet('C352', 32, 'Voz') };
    function c352Rate(v) { return c352.clock / c352.div * c352.r[v * 8 + 2] / 65536; }
    function c352Mulaw(x) { var s = x & 0x80 ? -1 : 1, e = (x >> 4) & 7, m = x & 15; return s * (((m << 1) + 33) << e) / 8192; }
    function c352Write(a, d) {
      if (a >= 0x208) return;
      c352.r[a] = d;
      if (a < 0x100) {
        var v = a >> 3, reg = a & 7;
        if (reg === 2) c352.ch[v].setRate(c352Rate(v));
        if (reg === 0) c352.ch[v].setVol(Math.max(d >> 8, d & 0xFF) / 255);
        if (reg === 3 && (d & 0x2000)) c352.ch[v].keyOff();
        return;
      }
      if (a === 0x202) { // dispara as vozes marcadas com KEYON
        var mem = ROM[0x92]; if (!mem) return;
        for (var vv = 0; vv < 32; vv++) {
          var fl = c352.r[vv * 8 + 3];
          if (!(fl & 0x4000)) continue;
          c352.r[vv * 8 + 3] = (fl & ~0x4000) | 0x8000;
          if (fl & 0x0010) continue; // ruído
          var bank = c352.r[vv * 8 + 4] & 0xFF, st = (bank << 16) | c352.r[vv * 8 + 5], en = (bank << 16) | c352.r[vv * 8 + 6], lp = (bank << 16) | c352.r[vv * 8 + 7];
          if (en <= st || st >= mem.length) continue;
          var mu = !!(fl & 0x0008), loops = !!(fl & 0x0003), pingpong = !!(fl & 0x0002);
          var s = pcmSample('C352', st + ':' + en + ':' + mu + ':' + (fl & 3), function () {
            var n = Math.min(en + 1, mem.length) - st, out = new Float32Array(pingpong ? n * 2 : n);
            for (var i = 0; i < n; i++) out[i] = mu ? c352Mulaw(mem[st + i]) : ((mem[st + i] << 24) >> 24) / 128;
            if (pingpong) for (i = 0; i < n; i++) out[n + i] = out[n - 1 - i]; // loop de ida e volta vira ida + volta
            var l0 = lp >= st && lp <= en ? lp - st : 0;
            return { data: out, loop: loops ? l0 : -1 };
          }, c352.clock / c352.div);
          var vr = c352.r[vv * 8];
          c352.ch[vv].keyOn(s, c352Rate(vv), Math.max(vr >> 8, vr & 0xFF) / 255);
        }
      }
    }

    // fluxos (streams) do VGM para chips de sample que não são o DAC do YM2612
    var strm = {}, strmF = {};
    function streamHit(sid, blk, len, freq) {
      var chipT = streamChip[sid];
      if (chipT === 0x17 && oki58) { // OKIM6258
        var key = 'b' + blk.id + ':' + blk.off + ':' + len;
        var s = pcmSample('OKIM6258', key, function () { return okiDecode(blk.data, blk.off, Math.min(blk.data.length, blk.off + len), true); }, freq ? freq * 2 : oki58Rate());
        oki58.ch[0].keyOn(s, freq ? freq * 2 : oki58Rate(), 1);
      }
    }

    // ── percorre os comandos ──
    var p = hdrLen, t = 0, nextFrame = FRAME, end = b.length, guard = 0;
    var dacSeek = null, dacLast = -1e9, dacSeen = false, streamChip = {};
    var PCM = opts && opts.pcm ? { bank: [], blocks: [], ids: {}, streamFreq: {}, streamBank: {} } : null;
    var pcmLen = 0, dacCur = null; // sample que o DAC está tocando agora (via 0x8n)
    // fluxo completo do DAC (valor + tempo de cada escrita), para recortar em samples exatos
    var DS = PCM ? { v: new Uint8Array(1 << 16), t: new Float64Array(1 << 16), n: 0, seeks: [], ptr: 0, st: null } : null;
    function dsPush(tt, v) {
      if (DS.n === DS.v.length) {
        var nv = new Uint8Array(DS.n * 2); nv.set(DS.v); DS.v = nv;
        var nt = new Float64Array(DS.n * 2); nt.set(DS.t); DS.t = nt;
      }
      DS.v[DS.n] = v; DS.t[DS.n] = tt; DS.n++;
    }
    function dsBank() { // banco de dados PCM até agora (em pedaços)
      return PCM.bank;
    }
    function bankByte(off) {
      var o = off;
      for (var k = 0; k < PCM.bank.length; k++) { var x = PCM.bank[k]; if (o < x.length) return x[o]; o -= x.length; }
      return 128;
    }
    // stream do VGM (0x93/0x95): gera as escritas até 'ate' (ou até o fim do bloco)
    function dsFlushStream(ate) {
      var S = DS.st; if (!S) return;
      var step = 44100 / S.f;
      while (S.i < S.len) {
        var tt = S.t0 + S.i * step;
        if (tt >= ate) return;
        if (fm.ym2612 && fm.ym2612.dac) dsPush(tt, bankByte(S.off + S.i));
        S.i++;
      }
      DS.st = null;
    }
    function dacEnd() {
      if (!PCM || !dacCur) return;
      var c = dacCur; dacCur = null;
      if (c.n < 8) return;
      var info = PCM.ids[c.id] || (PCM.ids[c.id] = { start: c.start, len: 0, rates: [] });
      if (c.n > info.len) info.len = c.n;
      if (c.t1 > c.t0) info.rates.push((c.n - 1) * 44100 / (c.t1 - c.t0));
    }
    function dacHit(id) {
      if (!REC || !fm.ym2612 || !fm.ym2612.dac) return;
      if (t - dacLast < 300 && id === dacHit.last) return;
      dacLast = t; dacHit.last = id;
      if (!dacSeen) { dacSeen = true; mchan('YM2612 · DAC', 'YM2612', 'DAC (samples)', 'dac'); }
      REC.push({ c: 'YM2612 · DAC', t: t, k: 'hit', id: id });
    }
    var eofOff = u32(b, 4) + 4; if (eofOff > 4 && eofOff < end) end = eofOff;
    function advance(n) {
      t += n;
      while (t >= nextFrame) {
        col.ft = nextFrame;
        nextFrame += FRAME;
        if (REC) for (var fk in fm) if (fm[fk].mcur.length) fmFrame(fm[fk]);
        if (REC) for (var ok in opl) if (opl[ok].mcur.length) oplFrame(opl[ok]);
        if (nes) nesFrame();
        if (gb) gbFrame();
        if (huc) hucFrame();
        for (var a = 0; a < ays.length; a++) ayFrame(ays[a]);
        for (var c = 0; c < chans.length; c++) chans[c].frame();
        if (++guard > 60 * 60 * 15) throw 'longo';
      }
    }
    try {
      while (p < end) {
        var c = b[p];
        if (c === 0x66) break;
        if (c === 0x51) {
          seenOPLL = true;
          if (!opl.ym2413 && clk.ym2413) opl.ym2413 = new OPLChip('opll', 'YM2413', clk.ym2413, 9);
          if (opl.ym2413) oplWrite(opl.ym2413, 0, b[p + 1], b[p + 2]);
          p += 3; continue;
        }
        if (c === 0x5A) { if (opl.ym3812) oplWrite(opl.ym3812, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xAA) { if (opl.ym3812b) oplWrite(opl.ym3812b, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5B) { if (opl.ym3526) oplWrite(opl.ym3526, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5C) { if (opl.y8950) oplWrite(opl.y8950, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5E || c === 0x5F) { if (opl.ymf262) oplWrite(opl.ymf262, c - 0x5E, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x50) { if (sn) snWrite(b[p + 1], sn); p += 2; continue; }
        if (c === 0x30) { if (sn2) snWrite(b[p + 1], sn2); p += 2; continue; }
        if (c === 0xA2 || c === 0xA3) { if (fm.ym2612b) opnWrite(fm.ym2612b, c - 0xA2, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xA4) { if (fm.ym2151b) opmWrite(fm.ym2151b, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xA5) { aa = b[p + 1]; if (fm.ym2203b && aa >= 0x10) opnWrite(fm.ym2203b, 0, aa, b[p + 2]); p += 3; continue; }
        if (c === 0xB7) { aa = b[p + 1]; if (oki58 && !(aa & 0x80)) oki58Write(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xB8) { aa = b[p + 1]; if (oki && !(aa & 0x80)) okiWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xC0) { if (spcm) spcmWrite(b[p + 1] | (b[p + 2] << 8), b[p + 3]); p += 4; continue; }
        if (c === 0xBA) { aa = b[p + 1]; if (k53 && !(aa & 0x80)) k53Write(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xB0) { if (rf) rfWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC1) { if (rf) rfMem(rf.bank + ((b[p + 1] | (b[p + 2] << 8)) & 0x0FFF), b[p + 3]); p += 4; continue; }
        if (c === 0xE1) { if (c352) c352Write((b[p + 1] << 8) | b[p + 2], (b[p + 3] << 8) | b[p + 4]); p += 5; continue; }
        if (c === 0xB9) { aa = b[p + 1]; if (huc && !(aa & 0x80)) hucWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0x52 || c === 0x53) { if (fm.ym2612) opnWrite(fm.ym2612, c - 0x52, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x54) { if (fm.ym2151) opmWrite(fm.ym2151, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x55) { var aa = b[p + 1]; if (fm.ym2203) { if (aa < 0x10) ssg.ym2203.r[aa] = b[p + 2]; else opnWrite(fm.ym2203, 0, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x56 || c === 0x57) { aa = b[p + 1]; if (fm.ym2608) { if (c === 0x56 && aa < 0x10) ssg.ym2608.r[aa] = b[p + 2]; else if (aa >= 0x20 || c === 0x56) opnWrite(fm.ym2608, c - 0x56, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x58 || c === 0x59) { aa = b[p + 1]; if (fm.ym2610) { if (c === 0x58 && aa < 0x10) ssg.ym2610.r[aa] = b[p + 2]; else if (aa >= 0x20) opnWrite(fm.ym2610, c - 0x58, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0xA0) { aa = b[p + 1]; if (aa & 0x80) { if (ay2) ay2.r[aa & 15] = b[p + 2]; } else if (ay) ay.r[aa & 15] = b[p + 2]; p += 3; continue; }
        if (c === 0xB3) { aa = b[p + 1]; if (gb && !(aa & 0x80)) gbWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xB4) { aa = b[p + 1]; if (nes && !(aa & 0x80)) nesWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0x61) { advance(b[p + 1] | (b[p + 2] << 8)); p += 3; continue; }
        if (c === 0x62) { advance(735); p++; continue; }
        if (c === 0x63) { advance(882); p++; continue; }
        if (c >= 0x70 && c <= 0x7F) { advance((c & 15) + 1); p++; continue; }
        if (c >= 0x80 && c <= 0x8F) {
          if (dacSeek !== null) {
            dacHit('o' + dacSeek);
            if (PCM && fm.ym2612 && fm.ym2612.dac) { dacEnd(); dacCur = { id: 'o' + dacSeek, start: dacSeek, n: 0, t0: t, t1: t }; }
            dacSeek = null;
          }
          if (dacCur) { dacCur.n++; dacCur.t1 = t; }
          if (DS && fm.ym2612 && fm.ym2612.dac) dsPush(t, bankByte(DS.ptr));
          if (DS) DS.ptr++;
          advance(c & 15); p++; continue;
        }
        if (c === 0xE0) { dacSeek = u32(b, p + 1); dacEnd(); if (DS) { DS.ptr = dacSeek; DS.seeks.push(t); } p += 5; continue; }
        if (c === 0x90) { streamChip[b[p + 1]] = b[p + 2] & 0x7F; p += 5; continue; }
        if (c === 0x91) { if (PCM) PCM.streamBank[b[p + 1]] = b[p + 2]; strm[b[p + 1]] = b[p + 2]; p += 5; continue; }
        if (c === 0x92) { if (PCM) PCM.streamFreq[b[p + 1]] = u32(b, p + 2); strmF[b[p + 1]] = u32(b, p + 2); p += 6; continue; }
        if (c === 0x95 && streamChip[b[p + 1]] !== 2) {
          var blks = STREAMBLK[strm[b[p + 1]]];
          var bk = blks && blks[b[p + 2] | (b[p + 3] << 8)];
          if (bk) streamHit(b[p + 1], bk, bk.data.length, strmF[b[p + 1]] || 0);
          p += 5; continue;
        }
        if (c === 0x93 && streamChip[b[p + 1]] !== 2) {
          var bl2 = STREAMBLK[strm[b[p + 1]]];
          if (bl2 && bl2.length) {
            // o deslocamento é dentro do banco todo (blocos do mesmo tipo em sequência)
            var whole = bl2.whole; if (!whole) { var tot = 0; bl2.forEach(function (x) { tot += x.data.length; }); whole = bl2.whole = { id: 'w', data: new Uint8Array(tot), off: 0 }; var oo = 0; bl2.forEach(function (x) { whole.data.set(x.data, oo); oo += x.data.length; }); }
            var so = u32(b, p + 2), lm = b[p + 6], sl = u32(b, p + 7), fq = strmF[b[p + 1]] || 0;
            var lnb = (lm & 15) === 2 ? Math.round(sl * (fq || 15625) / 1000 / 2) : (lm & 15) === 3 ? whole.data.length - so : sl;
            streamHit(b[p + 1], { id: 'w' + so, data: whole.data, off: so }, Math.max(0, Math.min(lnb, whole.data.length - so)), fq);
          }
          p += 11; continue;
        }
        if (c === 0x95) {
          var sid = b[p + 1], bid = b[p + 2] | (b[p + 3] << 8);
          if (streamChip[sid] === 2) {
            dacHit('b' + bid);
            if (DS && PCM.blocks[bid]) {
              dsFlushStream(t); DS.seeks.push(t);
              DS.st = { t0: t, f: PCM.streamFreq[sid] || 8000, off: PCM.blocks[bid].start, len: PCM.blocks[bid].len, i: 0 };
            }
            if (PCM && !PCM.ids['b' + bid]) PCM.ids['b' + bid] = { block: bid, rates: [PCM.streamFreq[sid] || 0] };
          }
          p += 5; continue;
        }
        if (c === 0x93) {
          if (streamChip[b[p + 1]] === 2) {
            dacHit('s' + u32(b, p + 2));
            if (DS) {
              var sOff = u32(b, p + 2), lm = b[p + 6], sLen = u32(b, p + 7);
              // modo de tamanho: 1 = comandos (bytes), 2 = ms, 3 = até o fim do banco
              var ln = (lm & 15) === 2 ? Math.round(sLen * (PCM.streamFreq[b[p + 1]] || 8000) / 1000) : (lm & 15) === 3 ? 1e9 : sLen;
              dsFlushStream(t); DS.seeks.push(t);
              DS.st = { t0: t, f: PCM.streamFreq[b[p + 1]] || 8000, off: sOff, len: Math.min(ln, Math.max(0, pcmLen - sOff)), i: 0 };
            }
          }
          p += 11; continue;
        }
        if (c === 0x94) { if (DS && DS.st) { dsFlushStream(t); DS.st = null; } p += 2; continue; }
        if (c === 0x67) {
          var bsz = u32(b, p + 3) & 0x7FFFFFFF, btype = b[p + 2];
          if (PCM && btype === 0x00) { PCM.blocks.push({ start: pcmLen, len: bsz }); PCM.bank.push(b.subarray(p + 7, p + 7 + bsz)); pcmLen += bsz; }
          if (btype >= 0x80 && btype < 0xC0 && bsz > 8) romPut(btype, u32(b, p + 7), u32(b, p + 11), b.subarray(p + 15, p + 7 + bsz));
          if (btype === 0xC0 && rf && bsz > 2) { var ra = b[p + 7] | (b[p + 8] << 8); for (var ri = 0; ri < bsz - 2; ri++) rfMem(ra + ri, b[p + 9 + ri]); }
          if (btype < 0x40 && btype !== 0x00) { (STREAMBLK[btype] = STREAMBLK[btype] || []).push({ id: (STREAMBLK[btype] || []).length, data: b.subarray(p + 7, p + 7 + bsz), off: 0 }); }
          p += 7 + bsz; continue;
        }
        if (c === 0x68) {
          // copia um pedaço do banco de dados para a RAM do chip (usado pelo RF5C68 do Sega CD / System 18)
          var ct = b[p + 2], rd = b[p + 3] | (b[p + 4] << 8) | (b[p + 5] << 16), wr = b[p + 6] | (b[p + 7] << 8) | (b[p + 8] << 16), cl = b[p + 9] | (b[p + 10] << 8) | (b[p + 11] << 16);
          if (!cl) cl = 0x1000000;
          var src = STREAMBLK[ct];
          if (ct === 0x01 && rf && src) {
            if (!src.whole || src.whole.n !== src.length) { var tot2 = 0; src.forEach(function (x) { tot2 += x.data.length; }); var wd = new Uint8Array(tot2), o2 = 0; src.forEach(function (x) { wd.set(x.data, o2); o2 += x.data.length; }); src.whole = { id: 'w', data: wd, off: 0, n: src.length }; }
            var W2 = src.whole.data;
            for (var ci = 0; ci < cl && rd + ci < W2.length; ci++) rfMem(wr + ci, W2[rd + ci]);
          }
          p += 12; continue;
        }
        if (c >= 0x90 && c <= 0x95) { p += [5, 5, 6, 11, 2, 5][c - 0x90]; continue; }
        if (c >= 0x30 && c <= 0x3F) { p += 2; continue; }
        if (c >= 0x40 && c <= 0x4E) { p += 3; continue; }
        if (c === 0x4F) { p += 2; continue; }
        if (c >= 0x51 && c <= 0x5F) { p += 3; continue; }
        if (c >= 0xA1 && c <= 0xBF) { p += 3; continue; }
        if (c >= 0xC0 && c <= 0xDF) { p += 4; continue; }
        if (c >= 0xE0) { p += 5; continue; }
        p++; // comando desconhecido
      }
    } catch (e) { if (e !== 'longo') throw e; }
    if (DS) dsFlushStream(t + 1);
    advance(FRAME);
    chans.forEach(function (c) { c.finish(); });
    dacEnd();
    if (REC) {
      for (var fk2 in fm) for (var ch2 = 0; ch2 < fm[fk2].nch; ch2++) fmOff(fm[fk2], ch2);
      for (var ok2 in opl) for (var ch3 = 0; ch3 < opl[ok2].nch; ch3++) oplOff(opl[ok2], ch3);
      pcmChans.forEach(function (c) { c.keyOff(); });
      oki58Finish();
      if (pcmOutOfOrder) REC.sort(function (x, y) { return x.t - y.t; });
      // canal de sample: se a maioria das notas for bateria, vai para o canal 10 do MIDI
      mchans.forEach(function (m) { if (m.kind !== 'pcm') return; var pc = pcmChans.filter(function (c) { return c.id === m.id; })[0]; m.kind = pc && pc.nDrum > pc.nTone ? 'noise' : 'psg'; });
      chans.forEach(function (c) { if (c.mOn) { REC.push({ c: c.id, t: t, k: 'off' }); c.mOn = false; } });
    }
    // papel (Melodia/Baixo/...) de todos os timbres, inclusive os que não vão para a lista
    col.list.forEach(function (x) {
      x.median = x.notes.length ? x.notes.slice().sort(function (a, b2) { return a - b2; })[x.notes.length >> 1] : 60;
      x.role = roleOf(x);
    });

    // ── organiza: os mais usados primeiro, nomes amigáveis ──
    var list = col.list.filter(function (x) {
      if (x.type === 'psg') return x.count >= 2 || col.list.length < 12;
      return true;
    });
    list.sort(function (a, b2) { return b2.count - a.count; });
    var perChip = {};
    list = list.filter(function (x) { perChip[x.chip] = (perChip[x.chip] || 0) + 1; return perChip[x.chip] <= (x.type === 'fm' || x.type === 'opl' || x.type === 'pcm' ? 40 : 16); });
    var num = {};
    list.forEach(function (x) {
      num[x.chip] = (num[x.chip] || 0) + 1;
      x.n = num[x.chip];
      x.chanList = Object.keys(x.chans).sort(function (a, b2) { return x.chans[b2] - x.chans[a]; });
      delete x.notes; delete x.key;
    });
    var chips = [];
    Object.keys(fm).forEach(function (k) { if (fm[k].used) chips.push(fm[k].chip); });
    Object.keys(opl).forEach(function (k) { if (opl[k].used) chips.push(opl[k].chip); });
    if (sn) chips.push('SN76489'); if (sn2) chips.push('SN76489 #2'); if (nes) chips.push('NES APU'); if (gb) chips.push('Game Boy');
    if (huc) chips.push('HuC6280');
    [[oki, 'OKIM6295'], [oki58, 'OKIM6258'], [spcm, 'SegaPCM'], [k53, 'K053260'], [rf, 'RF5C68'], [c352, 'C352']].forEach(function (x) {
      if (x[0] && x[0].ch.some(function (c) { return c.seen || c.nDrum || c.nTone; })) chips.push(x[1]);
    }); if (ay) chips.push('AY-3-8910'); if (ay2) chips.push('AY-3-8910 #2');
    var res = { info: info, chips: chips, unsupported: unsupported, timbres: list, seconds: t / 44100 };
    if (REC) {
      // só canais que tocaram alguma nota
      var used = {}; REC.forEach(function (e) { if (e.k === 'on' || e.k === 'hit') used[e.c] = (used[e.c] || 0) + 1; });
      res.midi = { events: REC, chans: mchans.filter(function (m) { return used[m.id]; }).map(function (m) { m.notes = used[m.id]; return m; }) };
    }
    if (PCM) {
      // junta os blocos em um banco só e resolve cada sample (início, tamanho, taxa)
      var bank = new Uint8Array(pcmLen), o = 0;
      PCM.bank.forEach(function (x) { bank.set(x, o); o += x.length; });
      var smp = {};
      Object.keys(PCM.ids).forEach(function (id) {
        var it = PCM.ids[id], st, ln;
        if (it.block != null) { var bl = PCM.blocks[it.block]; if (!bl) return; st = bl.start; ln = bl.len; }
        else { st = it.start; ln = it.len; }
        if (!ln || st >= bank.length) return;
        ln = Math.min(ln, bank.length - st);
        var r = it.rates.filter(function (x) { return x > 1000 && x < 60000; }).sort(function (a, b2) { return a - b2; });
        smp[id] = { data: bank.subarray(st, st + ln), rate: r.length ? Math.round(r[r.length >> 1]) : 8000 };
      });
      res.pcm = smp;
      // drivers que tocam uma batida por seek/stream já dão os samples certos (Object.keys(smp));
      // os que escrevem direto no DAC ou mixam em pedaços curtos são recortados do fluxo
      if (DS && DS.n) {
        var cut = dacSegments(DS);
        res.dacCut = cut; // alternativa (o conversor escolhe a que der menos samples)
        if (!cut.bySeek || !Object.keys(smp).length) { res.dacHits = cut.hits; cut.list.forEach(function (x) { res.pcm[x.id] = x; }); }
      }
      res.rateHz = ver >= 0x101 ? u32(b, 0x24) : 0;
      res.clocks = clk;
    }
    // tamanho e ponto de volta (loop) da música: o piano roll e o conversor usam
    res.loopSamples = u32(b, 0x20); res.totalSamples = u32(b, 0x18);
    return res;
  }

  function roleOf(x) {
    if (x.type === 'psg' && x.wave === 'noise') return 'Percussão';
    var shortEnv = x.type === 'psg' && x.env.length < 8 && x.env[x.env.length - 1] <= 0.001;
    if (x.type === 'fm') {
      var car = CARRIERS[x.alg], fast = true;
      car.forEach(function (i) { var o = x.ops[i]; if (o.d1r < 12 && !(o.sl === 15 || o.rr >= 12)) fast = false; if (o.d2r < 8 && o.sl < 15) fast = false; });
      if (fast && x.count > 2 && x.hi - x.lo < 6) return 'Percussão';
    }
    if (shortEnv && x.hi - x.lo < 5) return 'Percussão';
    if (x.median < 48) return 'Baixo';
    if (x.median < 62) return 'Acompanhamento';
    return 'Melodia';
  }

  // recorta o fluxo do DAC em pedaços (um por batida); pedaços iguais viram o mesmo sample
  function dacSegments(DS) {
    var n = DS.n, v = DS.v, tt = DS.t, k;
    var ord = false;
    for (k = 1; k < n; k++) if (tt[k] < tt[k - 1]) { ord = true; break; }
    if (ord) { // streams misturados com escrita direta: ordena por tempo
      var idx = []; for (k = 0; k < n; k++) idx.push(k);
      idx.sort(function (a, b) { return tt[a] - tt[b]; });
      var v2 = new Uint8Array(n), t2 = new Float64Array(n);
      idx.forEach(function (j, i) { v2[i] = v[j]; t2[i] = tt[j]; }); v = v2; tt = t2;
    }
    // corta nos "seeks" só quando o driver toca uma batida por seek (intervalos longos)
    var sk = DS.seeks, useSeek = false;
    if (sk.length > 2) {
      var gaps = []; for (k = 1; k < sk.length; k++) gaps.push(sk[k] - sk[k - 1]);
      gaps.sort(function (a, b) { return a - b; });
      useSeek = gaps[gaps.length >> 1] > 735 * 2.5;
    }
    var si = 0, segs = [], cur = null, quietFrom = -1;
    function close(e, byNext) { if (cur && e - cur.s >= 24) segs.push({ s: cur.s, e: e, next: !!byNext }); cur = null; }
    for (k = 0; k < n; k++) {
      var gap = k ? tt[k] - tt[k - 1] : 1e9, isSeek = false;
      if (useSeek) while (si < sk.length && sk[si] <= tt[k]) { isSeek = true; si++; }
      if (cur && (gap > 120 || isSeek)) { close(quietFrom >= 0 ? quietFrom : k, gap <= 120 && quietFrom < 0); quietFrom = -1; }
      var silent = Math.abs(v[k] - 128) <= 2;
      if (!cur) { if (silent && !isSeek) continue; cur = { s: k }; quietFrom = -1; }
      if (silent) { if (quietFrom < 0) quietFrom = k; else if (tt[k] - tt[quietFrom] > 441) { close(quietFrom); quietFrom = -1; } }
      else quietFrom = -1;
    }
    close(quietFrom >= 0 ? quietFrom : n);
    var byKey = {}, list = [], hits = [];
    // os pedaços cortados pela batida seguinte usam o sample inteiro (o Furnace corta igual, na nota seguinte)
    var full = segs.filter(function (g) { return !g.next; }).sort(function (a, b) { return (b.e - b.s) - (a.e - a.s); });
    function prefixOf(g) {
      var len = g.e - g.s;
      for (var q = 0; q < full.length; q++) {
        var f = full[q]; if (f.e - f.s <= len) break;
        var ok = true;
        for (var j = 0; j < len; j++) if (v[f.s + j] !== v[g.s + j]) { ok = false; break; }
        if (ok) return f;
      }
      return null;
    }
    segs.forEach(function (g) {
      if (g.next) { var f = prefixOf(g); if (f) { g.rs = g.s; g.re = g.e; g.s = f.s; g.e = f.e; } }
      var len = g.e - g.s, h = 2166136261;
      for (var j = g.s; j < g.e; j++) { h ^= v[j]; h = Math.imul(h, 16777619); }
      var key = len + ':' + (h >>> 0);
      var a0 = g.rs != null ? g.rs : g.s, a1 = g.re != null ? g.re : g.e;
      var dur = tt[a1 - 1] - tt[a0];
      var rate = dur > 0 ? (a1 - a0 - 1) * 44100 / dur : 8000;
      var it = byKey[key];
      if (!it) { it = byKey[key] = { id: 'd' + list.length, data: v.slice(g.s, g.e), rates: [] }; list.push(it); }
      it.rates.push(rate);
      hits.push({ t: tt[g.rs != null ? g.rs : g.s], id: it.id });
    });
    // junta pedaços quase iguais (mesma batida com 1-2 bytes de diferença por causa do tempo)
    function mad(x, y) {
      var m = Math.min(x.length, y.length), d = 0;
      for (var j = 0; j < m; j++) d += Math.abs(x[j] - y[j]);
      return d / (m || 1);
    }
    list.forEach(function (it) { it.uses = it.rates.length; });
    var order = list.slice().sort(function (a, b) { return b.uses - a.uses || b.data.length - a.data.length; });
    var reps = [], alias = {};
    order.forEach(function (it) {
      var hit = null;
      for (var q = 0; q < reps.length; q++) {
        var r = reps[q], la = it.data.length, lb = r.data.length;
        if (Math.abs(la - lb) > Math.max(8, 0.03 * Math.max(la, lb))) continue;
        if (mad(it.data, r.data) <= 2.5) { hit = r; break; }
      }
      if (hit) { alias[it.id] = hit; hit.rates = hit.rates.concat(it.rates); hit.uses += it.uses; if (it.data.length > hit.data.length) hit.data = it.data; }
      else { reps.push(it); alias[it.id] = it; }
    });
    // limite de samples: os raros vão para o mais parecido
    var MAXS = 100;
    reps.sort(function (a, b) { return b.uses - a.uses; });
    var keep = reps.slice(0, MAXS);
    reps.slice(MAXS).forEach(function (it) {
      var best = keep[0], bd = 1e9;
      keep.forEach(function (k) { var d = mad(it.data, k.data) + Math.abs(it.data.length - k.data.length) / 50; if (d < bd) { bd = d; best = k; } });
      Object.keys(alias).forEach(function (id) { if (alias[id] === it) alias[id] = best; });
    });
    hits.forEach(function (h) { h.id = alias[h.id].id; });
    keep.forEach(function (it) {
      var r = it.rates.sort(function (a, b) { return a - b; })[it.rates.length >> 1];
      it.rate = Math.max(1000, Math.min(60000, Math.round(r))); delete it.rates;
    });
    return { hits: hits, list: keep, bySeek: useSeek };
  }

  function inflate(u8) {
    if (u8[0] !== 0x1f || u8[1] !== 0x8b) return Promise.resolve(u8);
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  return { parse: parse, inflate: inflate, CARRIERS: CARRIERS, pcmData: function (id) { return PCMSTORE.map[id] || null; } };
})();


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
    if (tb.type === 'fm' || tb.type === 'opl') return tb.role === 'Melodia' ? 81 : 62; // Lead 2 (saw) / Synth Brass 1
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
      var o = open[e.c];
      if (e.k === 'on') {
        if (o) { o.end = e.t; }
        var tune = e.tb && (e.tb.type === 'fm' || e.tb.type === 'opl') ? -(e.tb.tune || 0) : 0; // altura real que o chip toca
        o = { t: e.t, end: null, n: e.n + tune, tune: tune, v: e.v, pan: e.pan, tb: e.tb, noise: e.noise, ev: [] };
        L.push(o); open[e.c] = o;
      } else if (!o) return;
      else if (e.k === 'off') { o.end = e.t; open[e.c] = null; }
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


/* ===== VGM → Furnace (.fur) — Registro Gamer =====
   Converte o resultado de RGVGM.parse(buf, {events:true, pcm:true}) num módulo do Furnace,
   com os timbres exatos dos chips (instrumentos FM com os registradores originais,
   envelopes do PSG como macro de volume, samples do DAC do jeito que estão no VGM).
   Fase 1: Mega Drive / Genesis (YM2612 + SN76489) e Master System (SN76489).
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

  // ---------- canais suportados ----------
  // mapa id do evento → índice do canal no Furnace, por sistema
  function layout(res) {
    var has = {};
    (res.chips || []).forEach(function (c) { has[(c.name || c.chip || c.id || c).toString()] = 1; });
    var ids = res.midi.chans.map(function (c) { return c.id; });
    var ym = ids.some(function (i) { return /^YM2612/.test(i); });
    var sn = ids.some(function (i) { return /^SN76489/.test(i); });
    var outros = ids.filter(function (i) { return !/^(YM2612|SN76489)/.test(i); }).map(function (b) { return b.split(' · ')[0]; })
      .concat(res.unsupported || []).filter(function (v, k, a) { return a.indexOf(v) === k; });
    if (!ym && !sn) throw new Error('Este VGM usa ' + (outros.length ? outros.join(', ') : 'um chip') +
      ', que o conversor para Furnace ainda não aceita. Por enquanto: Mega Drive e Master System (YM2612 e SN76489).');
    var L = { sys: [], map: {}, names: [], shorts: [], kind: [] };
    if (ym) {
      L.sys.push({ id: 0x83, n: 6, vol: 1, pan: 0, fr: 1 });
      for (var k = 1; k <= 6; k++) { L.map['YM2612 · FM ' + k] = k - 1; L.names.push('FM ' + k); L.shorts.push('F' + k); L.kind.push('fm'); }
      L.map['YM2612 · DAC'] = 5; L.names[5] = 'FM 6 / DAC'; L.shorts[5] = 'DAC';
    }
    if (sn || ym) {
      var o = L.names.length;
      L.sys.push({ id: 0x03, n: 4, vol: ym ? 0.5 : 1, pan: 0, fr: ym ? 0.5 : 1 });
      for (var j = 1; j <= 3; j++) { L.map['SN76489 · PSG ' + j] = o + j - 1; L.names.push('PSG ' + j); L.shorts.push('S' + j); L.kind.push('sn'); }
      L.map['SN76489 · Ruído'] = o + 3; L.names.push(tr('Ruído', 'Noise')); L.shorts.push('NO'); L.kind.push('noise');
    }
    L.chans = L.names.length;
    L.missing = outros;
    L.system = ym ? 'Sega Genesis/Mega Drive' : 'Sega Master System';
    return L;
  }

  // ---------- instrumentos ----------
  function insFM(w, tb, name) {
    var at = w.block('INS2'); w.s(228); w.s(1);
    var f = w.tag('NA') || 0; var a = w.n; w.s(0); w.str(name); patchS(w, a);
    w.tag('FM'); a = w.n; w.s(0);
    w.c(0xF0 | 4);
    w.c(((tb.alg & 7) << 4) | (tb.fb & 7));
    w.c(((tb.ams & 3) << 3) | (tb.fms & 7));
    w.c(0x20);
    w.c(0);
    // ordem do Furnace (registrador +0,+4,+8,+12) a partir da nossa (+0,+8,+4,+12)
    [0, 2, 1, 3].forEach(function (m) {
      var o = tb.ops[m];
      w.c(((DT[o.dt & 7] & 7) << 4) | (o.mul & 15));
      w.c(o.tl & 127);
      w.c(((o.ks & 3) << 6) | (o.ar & 31));
      w.c((o.am ? 128 : 0) | (o.d1r & 31));
      w.c((2 << 5) | (o.d2r & 31));
      w.c(((o.sl & 15) << 4) | (o.rr & 15));
      w.c(o.ssg & 15);
      w.c((o.dt2 & 3) << 3);
    });
    patchS(w, a);
    w.tag('EN');
    w.end(at);
  }
  function patchS(w, a) { var s = w.n, len = s - a - 2; w.n = a; w.s(len); w.n = s; }

  function insSTD(w, name, vols) {
    var at = w.block('INS2'); w.s(228); w.s(0);
    w.tag('NA'); var a = w.n; w.s(0); w.str(name); patchS(w, a);
    if (vols && vols.length) {
      w.tag('MA'); a = w.n; w.s(0);
      w.s(8);
      w.c(0); w.c(vols.length); w.c(255); w.c(255); w.c(0); w.c(0); w.c(0); w.c(1);
      vols.forEach(function (v) { w.c(v); });
      w.c(255);
      patchS(w, a);
    }
    w.tag('EN');
    w.end(at);
  }

  function insSample(w, name, smpIdx) {
    var at = w.block('INS2'); w.s(228); w.s(4);
    w.tag('NA'); var a = w.n; w.s(0); w.str(name); patchS(w, a);
    w.tag('SM'); a = w.n; w.s(0);
    w.s(smpIdx); w.c(2); w.c(0);
    patchS(w, a);
    w.tag('EN');
    w.end(at);
  }

  function sampleBlock(w, name, data, rate) {
    var at = w.block('SMP2');
    w.str(name);
    w.i(data.length); w.i(rate); w.i(rate);
    w.c(8); w.c(0); w.c(0); w.c(0);
    w.i(-1); w.i(-1);
    for (var k = 0; k < 4; k++) w.i(-1);
    var s = new Uint8Array(data.length);
    for (var j = 0; j < data.length; j++) s[j] = (data[j] - 128) & 255; // DAC sem sinal → 8 bits com sinal
    w.bytes(s);
    w.end(at);
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

  // ---------- conversão principal ----------
  // idioma dos nomes gravados no projeto (instrumentos, canais, comentário)
  var EN = false;
  function tr(pt, en) { return EN ? en : pt; }
  var ROLE_EN = { 'Percussão': 'Drums', 'Baixo': 'Bass', 'Melodia': 'Lead', 'Acompanhamento': 'Backing' };
  function role(r) { return EN ? ROLE_EN[r] || r : r; }
  function build(res, opts) {
    opts = opts || {};
    EN = opts.lang === 'en';
    if (!res || !res.midi) throw new Error('VGM sem eventos (chame RGVGM.parse com {events:true, pcm:true}).');
    var L = opts.layout || layout(res);
    var hz = res.rateHz === 50 ? 50 : 60;
    var spt = 44100 / hz;

    // instrumentos: timbres FM, timbres PSG e um por sample do DAC
    var insList = [], insOf = new Map(), smpList = [], smpOf = {};
    var nFM = 0, nPSG = 0, nNoise = 0;
    // batidas do DAC: recortes do fluxo (res.dacHits) quando existirem; senão os 'hit' dos eventos
    var events = res.midi.events;
    if (res.dacHits && res.dacHits.length) {
      events = events.filter(function (e) { return e.k !== 'hit'; })
        .concat(res.dacHits.map(function (h) { return { c: 'YM2612 · DAC', t: h.t, k: 'hit', id: h.id }; }))
        .sort(function (a, b) { return a.t - b.t; });
    }
    // assinatura do timbre (o que vai para o instrumento): timbres iguais viram um instrumento só
    function sigOf(t) {
      if (t.type === 'fm') return 'f' + [t.alg, t.fb, t.ams, t.fms].join(',') + '|' + t.ops.map(function (o) {
        return [DT[o.dt & 7], o.mul, o.tl, o.ks, o.ar, o.am ? 1 : 0, o.d1r, o.d2r, o.sl, o.rr, o.ssg & 15, o.dt2 & 3].join(',');
      }).join('|');
      return 's' + (envMacro(t.env) || []).join(',');
    }
    var bySig = {}, uses = new Map();
    events.forEach(function (e) {
      if (e.tb) uses.set(e.tb, (uses.get(e.tb) || 0) + 1);
      if (e.k === 'hit' && smpOf[e.id] == null && res.pcm && res.pcm[e.id]) {
        smpOf[e.id] = smpList.length;
        smpList.push({ id: e.id, name: tr('Bateria ', 'Drum ') + (smpList.length + 1), data: res.pcm[e.id].data, rate: res.pcm[e.id].rate });
      }
    });
    if (smpList.length > 160) throw new Error('Samples de bateria demais para um módulo (' + smpList.length + ').');
    // agrupa por assinatura, do mais usado para o menos usado
    var groups = [];
    Array.from(uses.keys()).forEach(function (t) {
      var k = sigOf(t), g = bySig[k];
      if (!g) { g = bySig[k] = { sig: k, tb: t, kind: t.type === 'fm' ? 'fm' : 'std', n: 0, members: [] }; groups.push(g); }
      g.n += uses.get(t); g.members.push(t);
    });
    groups.sort(function (a, b) { return b.n - a.n; });
    // limite do módulo: os timbres raros vão para o parecido mais próximo
    var room = 255 - smpList.length, kept = groups.slice(0, room), merged = 0;
    function dist(a, b) {
      if (a.kind !== b.kind) return 1e9;
      if (a.kind === 'std') {
        var x = envMacro(a.tb.env) || [15], y = envMacro(b.tb.env) || [15], d = 0;
        for (var i = 0; i < Math.max(x.length, y.length); i++) d += Math.abs((x[Math.min(i, x.length - 1)]) - (y[Math.min(i, y.length - 1)]));
        return d;
      }
      var p = a.tb, q = b.tb, dd = (p.alg !== q.alg ? 1000 : 0) + Math.abs(p.fb - q.fb) * 4;
      for (var o = 0; o < 4; o++) {
        var u = p.ops[o], w2 = q.ops[o];
        dd += Math.abs(u.tl - w2.tl) + Math.abs(u.ar - w2.ar) + Math.abs(u.d1r - w2.d1r) + Math.abs(u.d2r - w2.d2r) +
          Math.abs(u.sl - w2.sl) * 2 + Math.abs(u.rr - w2.rr) * 2 + (u.mul !== w2.mul ? 30 : 0) + ((u.dt & 3) !== (w2.dt & 3) ? 3 : 0);
      }
      return dd;
    }
    groups.forEach(function (g, gi) {
      var target = g;
      if (gi >= room) {
        var best = null, bd = 1e18;
        kept.forEach(function (k) { var d = dist(g, k); if (d < bd) { bd = d; best = k; } });
        target = best || kept[0]; merged++;
      }
      if (target.idx == null) {
        var t = target.tb, name;
        if (t.type === 'fm') name = 'FM ' + (++nFM) + (t.role ? ' · ' + role(t.role) : '');
        else if (t.wave === 'noise') name = tr('Ruído ', 'Noise ') + (++nNoise);
        else name = 'PSG ' + (++nPSG) + (t.role ? ' · ' + role(t.role) : '');
        target.idx = insList.length; insList.push({ kind: target.kind, tb: t, name: name });
      }
      g.members.forEach(function (t) { insOf.set(t, target.idx); });
    });
    smpList.forEach(function (s, k) { s.ins = insList.length; insList.push({ kind: 'smp', smp: k, name: s.name }); });

    // eventos por canal, em quadros
    var per = [];
    for (var c = 0; c < L.chans; c++) per.push([]);
    events.forEach(function (e) {
      var ch = L.map[e.c]; if (ch == null) return;
      if (e.k === 'hit' && smpOf[e.id] == null) return;
      per[ch].push({ f: Math.round(e.t / spt), e: e });
    });
    per.forEach(function (l) { l.sort(function (a, b) { return a.f - b.f; }); });

    var totalF = Math.ceil((res.totalSamples || 0) / spt);
    per.forEach(function (l) { if (l.length) totalF = Math.max(totalF, l[l.length - 1].f + 1); });

    // quadros por linha: o maior R em que quase não há duas notas na mesma linha do mesmo canal
    var onsets = per.map(function (l, ch) { var sh = L.kind[ch] !== 'fm' ? 1 : 0; return l.filter(function (x) { return x.e.k === 'on' || x.e.k === 'hit'; }).map(function (x) { return Math.max(0, x.f - sh); }); });
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
    function splitPitch(n) { var b = Math.round(n), f = Math.round((n - b) * 128); if (Math.abs(f) < 8) f = 0; return { b: b, f: f }; }
    for (c = 0; c < L.chans; c++) {
      var isFM = L.kind[c] === 'fm', isSN = !isFM;
      // no Furnace o PSG (SN76489) soa 2 oitavas acima do FM para a mesma nota escrita (convenção herdada do DefleMask):
      // escreve 2 oitavas abaixo para soar na altura original
      var nOff = isFM ? 48 : 24;
      var st = { vol: -1, fine: 0, leg: false, note: -1, pan: 0x11, noise: null };
      // agrupa os eventos do canal por linha
      var rows = new Map();
      per[c].forEach(function (x) {
        // o PSG do Furnace solta a nota um quadro depois: adianta um quadro para ficar no tempo certo
        var P = pos(isSN && x.f > 0 ? x.f - 1 : x.f);
        if (P.r > lastRow) return;
        var l = rows.get(P.r); if (!l) rows.set(P.r, l = []);
        l.push({ e: x.e, d: P.d });
      });
      var keys = Array.from(rows.keys()).sort(function (a, b) { return a - b; });
      var carry = { pitch: null, vol: null };
      var setPitch = function (cl, n, d, allowLegato) {
        var p = splitPitch(n);
        if (p.b !== st.note && st.note >= 0 && allowLegato) {
          if (!st.leg) { cl.fx[0xEA] = 0xFF; st.leg = true; }
          cl.note = clampNote(p.b + nOff); st.note = p.b;
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
            var n, ins, vol = -1, fixedNoise = false;
            if (e.k === 'hit') { n = 60; ins = smpList[smpOf[e.id]].ins; }
            else {
              ins = insOf.get(e.tb);
              if (e.noise) {
                var nm = (e.noise.r === 3 ? 0x10 : 0) | (e.noise.m === 'white' ? 1 : 0);
                if (nm !== st.noise) { cl.fx[0x20] = nm; st.noise = nm; }
                n = e.noise.r === 3 ? midiOfHz(e.noise.f || 440) : 60 + (2 - e.noise.r);
                fixedNoise = e.noise.r !== 3;
              } else n = e.n;
              // PSG: o envelope (macro) já começa no nível do 1º quadro; o volume da nota é o pico
              var e0 = !isFM && e.tb && e.tb.env && e.tb.env.length ? e.tb.env[0] : 1;
              vol = isFM ? fmVol(e.v) : snVol(e0 > 0.01 ? Math.min(1, e.v / e0) : e.v);
            }
            var p = splitPitch(n);
            cl.note = clampNote(p.b + (fixedNoise ? 48 : nOff)); cl.ins = ins; if (vol >= 0) { cl.vol = vol; st.vol = vol; }
            cl.d = d;
            if (d) cl.fx[0xED] = d; else delete cl.fx[0xED];
            delete cl.fx[0xEC];
            if (p.f !== st.fine) { cl.fx[0xE5] = 0x80 + p.f; st.fine = p.f; }
            if (st.leg) { cl.fx[0xEA] = 0; st.leg = false; }
            if (isFM && e.pan != null && e.k !== 'hit') {
              var pv = panOf(e.pan); if (pv !== st.pan) { cl.fx[0x08] = pv; st.pan = pv; }
            }
            if (e.tb && e.tb.type === 'fm' && e.tb.lfo != null) {
              var lv = e.tb.lfo < 0 ? 0 : 0x10 | (e.tb.lfo & 7);
              if (lv !== lfoNow) { cl.fx[0x10] = lv; lfoNow = lv; }
            }
            st.note = p.b; seenOn = true; lastPitch = null; lastVol = null;
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
            if (isSN && st.playing) return;
            var v2 = isFM ? fmVol(e.v) : snVol(e.v);
            if (seenOn || hasVol) lastVol = v2; // depois da nota/1º volume: vale na linha seguinte
            else if (!hasOn) { if (v2 !== st.vol) { cl.vol = v2; st.vol = v2; } hasVol = true; }
            else lastVol = v2;
          } else if (e.k === 'pitch') {
            if (seenOn || hasPitch || hasOn) lastPitch = e.n;
            else { setPitch(cl, e.n, d, true); hasPitch = true; }
          } else if (e.k === 'pan' && isFM) {
            var pv2 = panOf(e.pan);
            if (pv2 !== st.pan) { cl.fx[0x08] = pv2; st.pan = pv2; }
          }
        });
        // o que ficou do quadro anterior entra no começo desta linha (se a linha não tem o seu)
        if (!hasOn) {
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
    var waves = opts.waves || [];
    w.s(insList.length); w.s(waves.length); w.s(smpList.length);
    w.i(pats.length);
    var k;
    for (k = 0; k < 32; k++) w.c(k < L.sys.length ? L.sys[k].id : 0);
    for (k = 0; k < 32; k++) w.c(64);
    for (k = 0; k < 32; k++) w.c(0);
    for (k = 0; k < 32; k++) w.i(0);
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
      tr('\nLinha = ', '\nRow = ') + R + tr(' quadro(s) a ', ' frame(s) at ') + hz + ' Hz.');
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

    insList.forEach(function (it, j) {
      w.patchI(insPtr + j * 4, w.n);
      if (it.kind === 'fm') insFM(w, it.tb, it.name);
      else if (it.kind === 'std') insSTD(w, it.name, envMacro(it.tb.env));
      else insSample(w, it.name, it.smp);
    });
    waves.forEach(function (wv, j) {
      w.patchI(wavPtr + j * 4, w.n);
      var wb = w.block('WAVE'); w.str(''); w.i(wv.data.length); w.i(0); w.i(wv.max);
      wv.data.forEach(function (v) { w.i(v); }); w.end(wb);
    });
    smpList.forEach(function (s, j) { w.patchI(smpPtr + j * 4, w.n); sampleBlock(w, s.name, s.data, s.rate); });
    pats.forEach(function (p, j) {
      w.patchI(patPtr + j * 4, w.n);
      var pb = w.block('PATN');
      w.c(0); w.c(p.ch); w.s(p.idx); w.str('');
      w.bytes(p.body);
      w.end(pb);
    });

    return { bytes: w.out(), rowFrames: R, hz: hz, patLen: patLen, orders: nOrd, rows: lastRow + 1, loopRow: loopRow,
      fxStats: opts.debug ? fxStats : undefined, grid: opts.debug ? grid : undefined, lead: lead, missing: L.missing || [], instruments: insList.length, merged: merged, samples: smpList.length, patterns: pats.length, system: L.system };
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
    if (t.type === 'opl') {
      // Furnace: OPL = 14, OPLL = 13; no 4-op a ordem dos operadores é 1, 3, 2, 4
      var opll = t.oplKind === 'opll', n4 = t.four && !opll;
      w.c(opll ? 13 : 14); w.c(0);
      w.tag('NA'); var an = w.n; w.s(0); w.str(name); patchS(w, an);
      w.tag('FM'); an = w.n; w.s(0);
      var ord = n4 ? [0, 2, 1, 3] : [0, 1], en2 = 0;
      ord.forEach(function (m, i) { if (!t.ops[m].off) en2 |= 16 << i; });
      w.c(en2 | (n4 ? 4 : 2));
      w.c(((t.alg & (n4 ? 3 : 1)) << 4) | (t.fb & 7));
      w.c(0);
      w.c(n4 ? 32 : 0); w.c(0);
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
      patchS(w, an);
    } else if (t.type === 'fm') {
      w.c(t.fmKind === 'opm' ? 33 : 1); w.c(0);
      w.tag('NA'); var a = w.n; w.s(0); w.str(name); patchS(w, a);
      w.tag('FM'); a = w.n; w.s(0);
      var en = 0; [0, 2, 1, 3].forEach(function (m, i) { if (!t.ops[m].off) en |= 16 << i; });
      w.c(en | 4);
      w.c(((t.alg & 7) << 4) | (t.fb & 7));
      w.c(((t.ams & 3) << 3) | (t.fms & 7));
      w.c(0x20); w.c(0);
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
      var type = { sn: 0, gb: 2, ay: 6, nes: 34, pce: 5 }[t.chipKind] || 0;
      w.c(type); w.c(0);
      w.tag('NA'); a = w.n; w.s(0); w.str(name); patchS(w, a);
      if (type === 2) { w.tag('GB'); a = w.n; w.s(0); w.c(15); w.c(64); w.c(1); w.c(0); patchS(w, a); }
      var vmax = type === 5 ? 31 : 15; // PC Engine: volume de 0 a 31
      var vols = (t.env || [1]).slice(0, 255).map(function (x) { return Math.max(0, Math.min(vmax, Math.round(x * vmax))); });
      var mac = [[0, vols]];
      if (t.wave === 'pulse' && (t.chipKind === 'nes' || t.chipKind === 'gb')) {
        var d = (t.duty || []).slice(0, 255).map(function (x) { return x < 0 ? 2 : x & 3; });
        if (d.length) mac.push([2, d]);
      }
      if (t.wave === 'noise' && (t.chipKind === 'sn' || t.chipKind === 'nes')) mac.push([2, [t.nmode === 'periodic' ? (t.chipKind === 'sn' ? 0 : 1) : (t.chipKind === 'sn' ? 1 : 0)]]);
      w.tag('MA'); a = w.n; w.s(0); w.s(8);
      mac.forEach(function (m) {
        w.c(m[0]); w.c(m[1].length); w.c(255); w.c(255); w.c(0); w.c(0); w.c(0); w.c(1);
        m[1].forEach(function (v) { w.c(v); });
      });
      w.c(255);
      patchS(w, a);
    }
    w.tag('EN');
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
