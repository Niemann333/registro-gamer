// Leitor de VGM + conversor para MIDI (Chiptune Studio · Registro Gamer)
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
        if (w.k === 'noise') ev.noise = { ck: w.ck, r: w.nrate || 0, m: w.nmode };
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
      sn = { clock: clk.sn, att: [15, 15, 15, 15], per: [0, 0, 0, 0], latch: 0, ltype: 0, noise: 0, ch: [] };
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
      n.wave = { k: 'noise', ck: 'sn', nmode: (sn.noise & 4) ? 'white' : 'periodic', nrate: sn.noise & 3 };
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
        if (c >= 0x80 && c <= 0x8F) { if (dacSeek !== null) { dacHit('o' + dacSeek); dacSeek = null; } advance(c & 15); p++; continue; }
        if (c === 0xE0) { dacSeek = u32(b, p + 1); p += 5; continue; }
        if (c === 0x90) { streamChip[b[p + 1]] = b[p + 2] & 0x7F; p += 5; continue; }
        if (c === 0x95) { if (streamChip[b[p + 1]] === 2) dacHit('b' + (b[p + 2] | (b[p + 3] << 8))); p += 5; continue; }
        if (c === 0x93) { if (streamChip[b[p + 1]] === 2) dacHit('s' + u32(b, p + 2)); p += 11; continue; }
        if (c === 0x67) { p += 7 + u32(b, p + 3) ; p -= 0; continue; }
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
    advance(FRAME);
    chans.forEach(function (c) { c.finish(); });
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
    if (nz.ck === 'sn') br = [1, 0.6, 0.3, 0.5][nz.r & 3];
    else if (nz.ck === 'ay') br = 1 - (nz.r & 31) / 31;
    else br = 1 - (nz.r & 15) / 15;
    if (br > 0.65) return dur > 0.6 ? 49 : dur > 0.22 ? 46 : 42;
    if (br > 0.35) return dur > 0.7 ? 49 : 38;
    return 36;
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
    var M = res.midi; if (!M) throw new Error('sem eventos');
    var want = {}; (opts.chans || M.chans.map(function (c) { return c.id; })).forEach(function (id) { want[id] = 1; });
    var chans = M.chans.filter(function (c) { return want[c.id]; });

    // 1) junta eventos em notas por canal
    var notes = {}; chans.forEach(function (c) { notes[c.id] = []; });
    var open = {}, dacCount = {};
    M.events.forEach(function (e) {
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
        var w = (nt.dac && dacRank.indexOf(nt.dac) === 0) || (nt.n && nt.n < 48 && !nt.noise) ? 2 : (nt.noise ? 0.5 : 1);
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
      { tick: 0, ord: 1, data: meta(0x01, utf8('Convertido de VGM pelo Chiptune Studio - Registro Gamer')) },
      { tick: 0, ord: 2, data: meta(0x51, [(Math.round(60e6 / bpm) >> 16) & 255, (Math.round(60e6 / bpm) >> 8) & 255, Math.round(60e6 / bpm) & 255]) },
      { tick: 0, ord: 3, data: meta(0x58, [4, 2, 24, 8]) }
    ];
    if (res.info && res.info.game) head.push({ tick: 0, ord: 4, data: meta(0x01, utf8(res.info.game + (res.info.author ? ' - ' + res.info.author : ''))) });
    var tracks = [track(head)], count = 0;

    chans.forEach(function (c) {
      var mc = midiCh[c.id], E = [], ord = 0;
      function add(tk, data) { E.push({ tick: tk, ord: ord++, data: data }); }
      add(0, meta(0x03, utf8(c.chip + ' ' + c.label)));
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
          var dn = nt.dac ? DAC_NOTES[Math.min(DAC_NOTES.length - 1, dacRank.indexOf(nt.dac))] : nt.noise ? noiseDrum(nt.noise, dur) : tonalDrum(nt.n);
          var dt1 = t0 + Math.max(12, Math.min(t1 - t0, Math.round(0.25 / spb * PPQ)));
          var prev = drumOff[dn];
          if (prev) { if (prev.tick > t0) prev.tick = t0; if (prev.tick <= prev.on) { prev.tick = prev.on + 1; if (prev.tick > t0) return; } }
          add(t0, [0x99, dn, vel(nt.v)]); add(dt1, [0x89, dn, 0]); count++;
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

