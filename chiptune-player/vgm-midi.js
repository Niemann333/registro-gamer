// Leitor de VGM + conversores para MIDI e Furnace (Chiptune Studio · Registro Gamer)
// ===== Extrator de timbres de arquivos VGM =====
// Lê os registros dos chips e devolve os instrumentos que a música usa.
var RGVGM = (function () {
  'use strict';
  var FRAME = 735; // 1/60 s em amostras de 44100 Hz

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
    var info = gd3(b);
    var col = new Collector();
    col.ft = 0;
    function mchan(id, chip, label, kind) { if (REC) mchans.push({ id: id, chip: chip, label: label, kind: kind }); }
    var chans = [];
    var unsupported = [];

    var clk = {
      sn: hclk(0x0C), ym2413: hclk(0x10), ym2612: ver >= 0x110 ? hclk(0x2C) : hclk(0x10), ym2151: ver >= 0x110 ? hclk(0x30) : hclk(0x10),
      ym2203: hclk(0x44), ym2608: hclk(0x48), ym2610: hclk(0x4C), ay: hclk(0x74), gb: hclk(0x80), nes: hclk(0x84)
    };
    // antes da v1.10 o campo 0x10 vale para YM2413, YM2612 e YM2151: o que aparece nos comandos decide
    [['YM2413', 0x10], ['YM3812', 0x50], ['YM3526', 0x54], ['Y8950', 0x58], ['YMF262', 0x5C], ['SegaPCM', 0x38], ['RF5C68', 0x40],
     ['OKIM6295', 0x98], ['HuC6280', 0xA4], ['QSound', 0xB4], ['K051649', 0x9C], ['YMF278B', 0x60], ['YMZ280B', 0x68]].forEach(function (x) {
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
    var sn = null;
    if (clk.sn) {
      // período 0: no PSG da Sega vale 1 (frequência máxima); no SN da TI vale 0x400 (bit 0 das flags, VGM 1.51+)
      sn = { clock: clk.sn, att: [15, 15, 15, 15], per: [0, 0, 0, 0], latch: 0, ltype: 0, noise: 0, ch: [],
        zero: ver >= 0x151 && b.length > 0x2B && (b[0x2B] & 1) ? 1024 : 1 };
      for (var i = 0; i < 4; i++) { var pc = new PSGChan(col, i < 3 ? 'PSG ' + (i + 1) : 'Ruído', 'SN76489', REC); mchan(pc.id, pc.chip, pc.label, i < 3 ? 'psg' : 'noise'); sn.ch.push(pc); chans.push(pc); }
    }
    function snVol(a) { return a >= 15 ? 0 : Math.pow(10, -2 * a / 20); }
    function snUpdate() {
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
    function snWrite(d) {
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
      snUpdate();
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
    var ssg = {};
    ['ym2203', 'ym2608', 'ym2610'].forEach(function (n) { if (clk[n]) { ssg[n] = makeAY(clk[n] / 4, fm[n].chip + ' SSG'); ays.push(ssg[n]); } });

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
        if (nes) nesFrame();
        if (gb) gbFrame();
        for (var a = 0; a < ays.length; a++) ayFrame(ays[a]);
        for (var c = 0; c < chans.length; c++) chans[c].frame();
        if (++guard > 60 * 60 * 15) throw 'longo';
      }
    }
    try {
      while (p < end) {
        var c = b[p];
        if (c === 0x66) break;
        if (c === 0x51) { seenOPLL = true; p += 3; continue; }
        if (c === 0x50) { if (sn) snWrite(b[p + 1]); p += 2; continue; }
        if (c === 0x52 || c === 0x53) { if (fm.ym2612) opnWrite(fm.ym2612, c - 0x52, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x54) { if (fm.ym2151) opmWrite(fm.ym2151, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x55) { var aa = b[p + 1]; if (fm.ym2203) { if (aa < 0x10) ssg.ym2203.r[aa] = b[p + 2]; else opnWrite(fm.ym2203, 0, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x56 || c === 0x57) { aa = b[p + 1]; if (fm.ym2608) { if (c === 0x56 && aa < 0x10) ssg.ym2608.r[aa] = b[p + 2]; else if (aa >= 0x20 || c === 0x56) opnWrite(fm.ym2608, c - 0x56, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x58 || c === 0x59) { aa = b[p + 1]; if (fm.ym2610) { if (c === 0x58 && aa < 0x10) ssg.ym2610.r[aa] = b[p + 2]; else if (aa >= 0x20) opnWrite(fm.ym2610, c - 0x58, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0xA0) { aa = b[p + 1]; if (ay && !(aa & 0x80)) ay.r[aa & 15] = b[p + 2]; p += 3; continue; }
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
        if (c === 0x91) { if (PCM) PCM.streamBank[b[p + 1]] = b[p + 2]; p += 5; continue; }
        if (c === 0x92) { if (PCM) PCM.streamFreq[b[p + 1]] = u32(b, p + 2); p += 6; continue; }
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
          p += 7 + bsz; continue;
        }
        if (c === 0x68) { p += 12; continue; }
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
    list = list.filter(function (x) { perChip[x.chip] = (perChip[x.chip] || 0) + 1; return perChip[x.chip] <= (x.type === 'fm' ? 40 : 16); });
    var num = {};
    list.forEach(function (x) {
      num[x.chip] = (num[x.chip] || 0) + 1;
      x.n = num[x.chip];
      x.chanList = Object.keys(x.chans).sort(function (a, b2) { return x.chans[b2] - x.chans[a]; });
      delete x.notes; delete x.key;
    });
    var chips = [];
    Object.keys(fm).forEach(function (k) { if (fm[k].used) chips.push(fm[k].chip); });
    if (seenOPLL || (clk.ym2413 && ver >= 0x110)) unsupported.unshift('YM2413');
    if (sn) chips.push('SN76489'); if (nes) chips.push('NES APU'); if (gb) chips.push('Game Boy'); if (ay) chips.push('AY-3-8910');
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
      res.loopSamples = u32(b, 0x20); res.totalSamples = u32(b, 0x18);
      res.rateHz = ver >= 0x101 ? u32(b, 0x24) : 0;
      res.clocks = clk;
    }
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

  return { parse: parse, inflate: inflate, CARRIERS: CARRIERS };
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
    if (tb.type === 'fm') return tb.role === 'Melodia' ? 81 : 62; // Lead 2 (saw) / Synth Brass 1
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
        var tune = e.tb && e.tb.type === 'fm' ? -(e.tb.tune || 0) : 0; // altura real que o chip toca
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

  root.RGFUR = { build: build, fileName: fileName };
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
