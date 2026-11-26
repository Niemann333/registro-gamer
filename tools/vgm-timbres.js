// ===== Extrator de timbres de arquivos VGM =====
// Lê os registros dos chips e devolve os instrumentos que a música usa.
var RGVGM = (function () {
  'use strict';
  var FRAME = 735; // 1/60 s em amostras de 44100 Hz

  var Y08_B64 = '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';
  var Y08_BIN = null;
  function Y08_ROM() { if (!Y08_BIN) { var bs = atob(Y08_B64); Y08_BIN = new Uint8Array(bs.length); for (var i = 0; i < bs.length; i++) Y08_BIN[i] = bs.charCodeAt(i); } return Y08_BIN; }
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
    var key = ch.chip + '|' + w.k + '|' + (w.k === 'wave' ? w.tbl.join('') : '') + '|' + (w.nmode || '') + '|' + (w.mk ? w.mk.duty + ':' + w.mk.lfsr + '|' : '') + (w.sd ? w.sd.ad + ':' + w.sd.sr + ':' + w.sd.wf + ':' + w.sd.ring + w.sd.sync + '|' : '') +
      v.map(q).join(',') + '|' + d.join(',');
    var env = v.map(function (x) { return Math.round(x * 1000) / 1000; });
    return this.add(key, function () {
      return { type: 'psg', wave: w.k, chipKind: w.ck, tbl: w.tbl || null, nmode: w.nmode || '', env: env, duty: d, raw: w.raw || null, rmax: w.rmax || 15, mk: w.mk || null, np: w.np || null, sd: w.sd || null };
    }, ch.label, r.note, ch.chip);
  };

  // ───────────── leitura principal ─────────────
  function parse1(buf, opts) {
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
    [['YM2413', 0x10]].forEach(function (x) {
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

    function fmKey(chip, ch, on, sub) {
      var snap = chip.kind === 'opm' ? chip.snapshotOPM(ch) : chip.snapshotOPN(ch);
      // canal 3 expandido (YM2612/OPN): cada operador tem a própria frequência; a nota é a do operador
      if (sub != null) snap.note = midiOf(ext3Freq(chip, sub));
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
        if (sub != null) {
          // canal 3 expandido: várias notas ao mesmo tempo no mesmo canal (sub = operador)
          st.n = midiOf(ext3Freq(chip, sub)); st.v = ext3Vol(chip, sub);
          R0push({ c: id, sub: sub, t: t, k: 'on', n: st.n, v: st.v, pan: st.pan, tb: tbObj });
          (chip.mext || (chip.mext = []))[sub] = st;
          return;
        }
        R0push({ c: id, t: t, k: 'on', n: st.n, v: st.v, pan: st.pan, tb: tbObj });
        chip.mcur[ch] = st;
      }
    }
    // canal 3 expandido do OPN: frequência de cada operador (op1 A9/AD, op2 AA/AE, op3 A8/AC, op4 A2/A6)
    var EXT3_LO = [0xA9, 0xAA, 0xA8, 0xA2], EXT3_HI = [0xAD, 0xAE, 0xAC, 0xA6];
    function ext3Freq(chip, op) {
      var R = chip.regs[0], hi = R[EXT3_HI[op]], fnum = ((hi & 7) << 8) | R[EXT3_LO[op]], block = (hi >> 3) & 7;
      return fnum * chip.rate * Math.pow(2, block - 1) / 1048576;
    }
    function ext3Vol(chip, op) { return Math.pow(10, -(chip.regs[0][0x40 + OPN_OFF[op] + 2] & 127) * 0.75 / 20); }
    function ext3Off(chip, op) {
      if (REC && chip.mext && chip.mext[op]) { REC.push({ c: chip.chip + ' · FM 3', sub: op, t: t, k: 'off' }); chip.mext[op] = null; }
    }
    // operadores ligados que soam (portadoras), sem repetir a mesma frequência: cada um é uma voz
    function ext3Key(chip, bits) {
      var alg = chip.regs[0][0xB2] & 7, car = CARRIERS[alg], prev = chip.ext3bits || 0, seen = {};
      for (var op = 0; op < 4; op++) {
        var on = (bits >> op) & 1, was = (prev >> op) & 1;
        if (!on && was) ext3Off(chip, op);
      }
      for (var op2 = 0; op2 < 4; op2++) {
        if (!((bits >> op2) & 1) || car.indexOf(op2) < 0) continue;
        var f = Math.round(ext3Freq(chip, op2) * 10);
        if (seen[f]) { if ((prev >> op2) & 1) continue; continue; }
        seen[f] = 1;
        if (!((prev >> op2) & 1) || !(chip.mext && chip.mext[op2])) fmKey(chip, 2, 1, op2);
      }
      chip.ext3bits = bits;
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
      // canal 3 expandido: altura e volume de cada voz (operador)
      if (chip.ch3sp && chip.mext) for (var eo = 0; eo < 4; eo++) {
        var ec = chip.mext[eo]; if (!ec) continue;
        var en = midiOf(ext3Freq(chip, eo)), ev = ext3Vol(chip, eo), eid = chip.chip + ' · FM 3';
        if (Math.abs(en - ec.n) > 0.02 && en > 0) { REC.push({ c: eid, sub: eo, t: col.ft, k: 'pitch', n: en }); ec.n = en; }
        if (Math.abs(ev - ec.v) > 0.01) { REC.push({ c: eid, sub: eo, t: col.ft, k: 'vol', v: ev }); ec.v = ev; }
      }
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
    // VRC7 (Konami): o mesmo FM do YM2413, com outros 15 instrumentos de fábrica (Nuke.YKT)
    var VRC7_ROM = [null,
      [0x03, 0x21, 0x05, 0x06, 0xe8, 0x81, 0x42, 0x27], [0x13, 0x41, 0x14, 0x0d, 0xd8, 0xf6, 0x23, 0x12], [0x11, 0x11, 0x08, 0x08, 0xfa, 0xb2, 0x20, 0x12],
      [0x31, 0x61, 0x0c, 0x07, 0xa8, 0x64, 0x61, 0x27], [0x32, 0x21, 0x1e, 0x06, 0xe1, 0x76, 0x01, 0x28], [0x02, 0x01, 0x06, 0x00, 0xa3, 0xe2, 0xf4, 0xf4],
      [0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07], [0x23, 0x21, 0x22, 0x17, 0xa2, 0x72, 0x01, 0x17], [0x35, 0x11, 0x25, 0x00, 0x40, 0x73, 0x72, 0x01],
      [0xb5, 0x01, 0x0f, 0x0f, 0xa8, 0xa5, 0x51, 0x02], [0x17, 0xc1, 0x24, 0x07, 0xf8, 0xf8, 0x22, 0x12], [0x71, 0x23, 0x11, 0x06, 0x65, 0x74, 0x18, 0x16],
      [0x01, 0x02, 0xd3, 0x05, 0xc9, 0x95, 0x03, 0x02], [0x61, 0x63, 0x0c, 0x00, 0x94, 0xc0, 0x33, 0xf6], [0x21, 0x72, 0x0d, 0x00, 0xc1, 0xd5, 0x56, 0x06]];
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
      var R = chip.regs[0], inst = R[0x30 + ch] >> 4, P = inst ? (chip.vrc7 ? VRC7_ROM : OPLL_ROM)[inst] : [R[0], R[1], R[2], R[3], R[4], R[5], R[6], R[7]];
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
          presetName: chip.kind === 'opll' && snap.inst ? (chip.vrc7 ? 'Instrumento ' + snap.inst + ' do VRC7' : OPLL_NAMES[snap.inst]) : undefined };
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
      // canal 3 em modo especial (bits 6-7 do 0x27): os 4 operadores viram vozes separadas
      if (port === 0 && a === 0x27) {
        var sp = (d & 0xC0) !== 0;
        if (sp !== !!chip.ch3sp) {
          if (chip.ch3sp) { for (var eo = 0; eo < 4; eo++) ext3Off(chip, eo); chip.ext3bits = 0; }
          else if (chip.keyed[2]) { fmOff(chip, 2); chip.keyed[2] = 0; }
          chip.ch3sp = sp;
        }
      }
      if (port === 0 && a === 0x28) {
        var c = d & 7, ch = c >= 4 ? c - 1 : c;
        if (c === 3 || c === 7 || ch >= chip.nch) return;
        var on = (d >> 4) & 15;
        if (ch === 2 && chip.ch3sp && chip.kind !== 'opm') { ext3Key(chip, on); chip.keyed[2] = on ? 1 : 0; return; }
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
    // DMC: samples de 1 bit (delta) lidos da memória do NES (bloco de dados 0xC2 do VGM)
    var DMC_RATE = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
    var nesRam = null, dmcCh = null, dmcUntil = 0;
    function dmcStart() {
      if (!nesRam) return;
      var st = 0xC000 + nes.r[0x12] * 64, len = nes.r[0x13] * 16 + 1, lvl = nes.r[0x11] & 127, loop = !!(nes.r[0x10] & 0x40);
      var rate = nes.clock / DMC_RATE[nes.r[0x10] & 15];
      if (!dmcCh) dmcCh = pcmChanSet('NES APU', 1, 'DPCM')[0];
      var s = pcmSample('NES APU', st + ':' + len + ':' + (nes.r[0x10] & 0x4F), function () {
        var out = new Float32Array(len * 8), v = lvl, o = 0;
        for (var i = 0; i < len; i++) { var by = nesRam[(st + i) & 0xFFFF]; for (var k = 0; k < 8; k++) { if ((by >> k) & 1) { if (v <= 125) v += 2; } else if (v >= 2) v -= 2; out[o++] = (v - 64) / 64; } }
        return { data: out, loop: loop ? 0 : -1 };
      }, rate);
      dmcCh.keyOn(s, rate, 1);
      dmcUntil = loop ? 1e15 : t + len * 8 / rate * 44100;
    }
    // ── canal extra do Famicom Disk System (FDS): onda desenhada de 64 passos (6 bits) com envelope de volume ──
    var fds = null;
    function fdsInit() {
      if (fds) return;
      fds = { w: new Uint8Array(64), ww: false, freq: 0, halt: true, envHalt: false, envDis: true, envUp: false, envSpd: 0, envOut: 0, envT: 0, mes: 0xE8, mv: 0, ch: null };
      fds.ch = new PSGChan(col, 'FDS', 'NES FDS', REC); mchan(fds.ch.id, fds.ch.chip, fds.ch.label, 'psg'); chans.push(fds.ch);
    }
    if (clk.nes && (u32(b, 0x84) & 0x80000000)) fdsInit();
    function fdsWrite(a, d) {   // VGM: 0x20-0x3E = $4080-$409E, 0x3F = $4023, 0x40-0x7F = $4040-$407F (onda)
      fdsInit();
      if (a >= 0x40) { if (fds.ww) fds.w[a - 0x40] = d & 63; return; }
      if (a === 0x3F) return;
      switch (a - 0x20) {
        case 0: fds.envDis = !!(d & 0x80); fds.envUp = !!(d & 0x40); fds.envSpd = d & 63; fds.envT = 0; if (fds.envDis) fds.envOut = fds.envSpd; break;
        case 2: fds.freq = (fds.freq & 0xF00) | d; break;
        case 3: fds.freq = (fds.freq & 0xFF) | ((d & 15) << 8); var wasH = fds.halt; fds.halt = !!(d & 0x80); fds.envHalt = !!(d & 0x40); if (wasH && !fds.halt) fds.ch.trig = true; break;
        case 9: fds.ww = !!(d & 0x80); fds.mv = d & 3; break;
        case 10: fds.mes = d; fds.envT = 0; break;
      }
    }
    function fdsFrame() {
      var cpu = nes ? nes.clock : 1789773;
      if (!fds.envDis && !fds.envHalt && !fds.halt && fds.mes) {
        fds.envT += cpu / 60; var per = (fds.envSpd + 1) * fds.mes * 8;
        while (fds.envT >= per) { fds.envT -= per; if (fds.envUp) { if (fds.envOut < 32) fds.envOut++; } else if (fds.envOut > 0) fds.envOut--; }
      }
      var pc = fds.ch, vol = Math.min(32, fds.envOut) / 32 * [1, 2 / 3, 0.5, 0.4][fds.mv];
      pc.vol = fds.halt || !fds.freq ? 0 : vol;
      pc.freq = cpu * fds.freq / 65536 / 64;
      var tbl = []; for (var i = 0; i < 32; i++) tbl.push(Math.round((fds.w[i * 2] + fds.w[i * 2 + 1]) / 2 * 15 / 63));
      pc.wave = { k: 'wave', ck: 'fds', tbl: tbl, duty: null, raw: Array.prototype.slice.call(fds.w), rmax: 63 };
    }
    function nesWrite(a, d) {
      if (a >= 0x20) { fdsWrite(a, d); return; }
      if (a > 0x17) return;
      if (a === 0x15) { if (!(d & 0x10)) { if (dmcCh) dmcCh.keyOff(); dmcUntil = 0; } else if (t >= dmcUntil) { nes.r[0x15] = d; dmcStart(); } }
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
      gb.ch[2].wave = { k: 'wave', ck: 'gb', tbl: tbl, duty: null, raw: tbl.slice(), rmax: 15 };
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
          pc.wave = { k: 'wave', ck: 'pce', tbl: c.wave.map(function (x) { return Math.round(x * 15 / 31); }), duty: null, raw: c.wave.slice(), rmax: 31 };
        }
      }
    }

    // ── K051649 / K052539 (SCC da Konami, cartuchos de MSX): 5 canais de onda desenhada (32 passos de 8 bits) ──
    var scc = null;
    if (hclk(0x9C)) {
      var sccName = (u32(b, 0x9C) & 0x80000000) ? 'K052539' : 'K051649';
      scc = { clock: hclk(0x9C), plus: sccName === 'K052539', w: [], per: [0, 0, 0, 0, 0], vol: [0, 0, 0, 0, 0], key: 0, ch: [] };
      for (var si = 0; si < 5; si++) {
        var spc = new PSGChan(col, 'Canal ' + (si + 1), sccName, REC); mchan(spc.id, spc.chip, spc.label, 'psg'); scc.ch.push(spc); chans.push(spc);
        scc.w.push(new Int8Array(32));
      }
    }
    function sccWrite(port, a, d) {
      if (port === 0 || port === 4) {          // forma de onda (no SCC comum, o canal 5 usa a onda do 4)
        var wc = a >> 5; if (wc > 4 || (port === 0 && wc > 3)) return;
        scc.w[wc][a & 31] = (d << 24) >> 24;
        if (port === 0 && !scc.plus && wc === 3) scc.w[4][a & 31] = (d << 24) >> 24;
      } else if (port === 1) {                  // frequência (12 bits)
        var fc = a >> 1; if (fc > 4) return;
        scc.per[fc] = (a & 1) ? (scc.per[fc] & 0xFF) | ((d & 15) << 8) : (scc.per[fc] & 0xF00) | d;
      } else if (port === 2) { if (a < 5) scc.vol[a] = d & 15; }
      else if (port === 3) {                    // liga / desliga
        for (var i = 0; i < 5; i++) if ((d & (1 << i)) && !(scc.key & (1 << i))) scc.ch[i].trig = true;
        scc.key = d;
      }
    }
    function sccFrame() {
      for (var i = 0; i < 5; i++) {
        var pc = scc.ch[i], on = (scc.key & (1 << i)) && scc.per[i] > 8;
        pc.vol = on ? scc.vol[i] / 15 : 0;
        pc.freq = scc.clock / (32 * (scc.per[i] + 1));
        pc.wave = { k: 'wave', ck: 'scc', tbl: Array.prototype.map.call(scc.w[i], function (x) { return Math.round((x + 128) * 15 / 255); }), duty: null, raw: Array.prototype.map.call(scc.w[i], function (x) { return x + 128; }), rmax: 255 };
      }
    }

    // ── VRC6 (Konami, cartucho do Famicom): 2 pulsos com 8 larguras (1/16 a 8/16) e 1 dente de serra ──
    // (só vem de NSF: o conversor grava como comando 0xD7 aa dd, aa = canal × 16 + registrador)
    var vrc6 = null;
    function vrc6Init() {
      vrc6 = { clock: (clk.nes || 1789773), r: [new Uint8Array(3), new Uint8Array(3), new Uint8Array(3)], ch: [] };
      ['Pulso 1', 'Pulso 2', 'Serra'].forEach(function (l) { var pc = new PSGChan(col, l, 'VRC6', REC); mchan(pc.id, pc.chip, l, 'psg'); vrc6.ch.push(pc); chans.push(pc); });
    }
    function vrc6Write(a, d) {
      var c = a >> 4, k = a & 15; if (c > 2 || k > 2) return;
      var was = vrc6.r[c][2] & 0x80; vrc6.r[c][k] = d;
      if (k === 2 && (d & 0x80) && !was) vrc6.ch[c].trig = true;
    }
    var SAW7 = []; for (var sw = 0; sw < 32; sw++) SAW7.push(Math.round(Math.floor(sw * 7 / 32) * 15 / 6));
    function vrc6Frame() {
      for (var c = 0; c < 3; c++) {
        var R = vrc6.r[c], pc = vrc6.ch[c], per = R[1] | ((R[2] & 15) << 8), on = (R[2] & 0x80) && per > 0;
        if (c < 2) {
          var mode = R[0] & 0x80;
          pc.vol = on ? (R[0] & 15) / 15 : 0;
          pc.freq = vrc6.clock / (16 * (per + 1));
          pc.wave = mode ? { k: 'wave', ck: 'vrc6', tbl: SAW7.map(function () { return 15; }), duty: null } : { k: 'pulse', ck: 'vrc6', duty: (R[0] >> 4) & 7 };
        } else {
          var acc = R[0] & 63;
          pc.vol = on ? Math.min(1, acc / 42) : 0;
          pc.freq = vrc6.clock / (14 * (per + 1));
          pc.wave = { k: 'wave', ck: 'vrc6', tbl: SAW7.slice(), duty: null };
        }
      }
    }
    // ── SID do Commodore 64 (vem de .sid): 3 vozes com triângulo, serra, pulso de largura variável e ruído, e envelope ADSR ──
    // (comando próprio 0xDA 00 rr dd; o envelope roda dentro do chip, então é refeito aqui quadro a quadro)
    var sid = null, SID_ATK = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
    var SAW32 = []; for (var sw2 = 0; sw2 < 32; sw2++) SAW32.push(Math.round(sw2 * 15 / 31));
    function sidInit() {
      sid = { clock: (opts && opts.sidClock) || 985248, r: new Uint8Array(32), ch: [], env: [] };
      for (var k = 0; k < 3; k++) { var pc = new PSGChan(col, 'Voz ' + (k + 1), 'SID', REC); mchan(pc.id, pc.chip, pc.label, 'psg'); sid.ch.push(pc); chans.push(pc); sid.env.push({ lvl: 0, st: 'rel' }); }
    }
    function sidWrite(a, d) {
      if (!sid) sidInit();
      a &= 31; if (a > 24) return;
      var v = Math.floor(a / 7);
      if (v < 3 && a % 7 === 4) {
        var old = sid.r[a];
        if ((d & 1) && !(old & 1)) { sid.env[v].st = 'atk'; sid.ch[v].trig = true; }
        else if (!(d & 1) && (old & 1)) sid.env[v].st = 'rel';
      }
      sid.r[a] = d;
    }
    function sidFrame() {
      var dt = FRAME / 44100 * 1000, master = (sid.r[0x18] & 15) / 15;
      for (var v = 0; v < 3; v++) {
        var o = v * 7, R = sid.r, e = sid.env[v], pc = sid.ch[v], ad = R[o + 5], sr = R[o + 6];
        var S = (sr >> 4) / 15, dec = SID_ATK[ad & 15] * 3, rel = SID_ATK[sr & 15] * 3;
        if (e.st === 'atk') { e.lvl += dt / SID_ATK[ad >> 4]; if (e.lvl >= 1) { e.lvl = 1; e.st = 'dec'; } }
        else if (e.st === 'dec') { e.lvl = S + (e.lvl - S) * Math.exp(-dt * 5 / dec); if (Math.abs(e.lvl - S) < 0.01) { e.lvl = S; e.st = 'sus'; } }
        else if (e.st === 'sus') { if (e.lvl > S) e.lvl = S; }
        else { e.lvl *= Math.exp(-dt * 5 / rel); if (e.lvl < 0.005) e.lvl = 0; }
        var ctl = R[o + 4], wf = ctl >> 4, F = R[o] | (R[o + 1] << 8), hz = F * sid.clock / 16777216;
        var pw = (R[o + 2] | ((R[o + 3] & 15) << 8)) / 4096, sd = { ad: ad, sr: sr, pw: R[o + 2] | ((R[o + 3] & 15) << 8), wf: wf, ring: (ctl >> 2) & 1, sync: (ctl >> 1) & 1 };
        pc.freq = hz;
        pc.vol = wf && !(ctl & 8) && F > 0 ? e.lvl * Math.max(0.25, master) : 0;
        if (wf & 8) pc.wave = { k: 'noise', ck: 'sid', nmode: 'white', nrate: Math.min(15, Math.round(Math.log2(hz + 1))), tf: hz, sd: sd };
        else if (wf & 4) pc.wave = { k: 'pulse', ck: 'sid', duty: Math.max(0, Math.min(15, Math.round((pw > 0.5 ? 1 - pw : pw) * 16) - 1)), sd: sd };
        else if (wf & 2) pc.wave = { k: 'wave', ck: 'sid', tbl: SAW32.slice(), duty: null, sd: sd };
        else pc.wave = { k: 'tri', ck: 'sid', duty: null, sd: sd };
      }
    }

    // ── Namco 163 (N163): até 8 canais de onda desenhada (amostras de 4 bits na RAM interna de 128 bytes) ──
    // (só vem de NSF: comando 0xD8 aa dd, aa = endereço na RAM interna)
    var n163 = null;
    function n163Init() {
      n163 = { clock: (clk.nes || 1789773), ram: new Uint8Array(128), ch: [] };
      for (var k = 0; k < 8; k++) { var pc = new PSGChan(col, 'Canal ' + (k + 1), 'N163', REC); mchan(pc.id, pc.chip, pc.label, 'psg'); n163.ch.push(pc); chans.push(pc); }
    }
    function n163Frame() {
      var R = n163.ram, nch = ((R[0x7F] >> 4) & 7) + 1;
      for (var k = 0; k < 8; k++) {
        var pc = n163.ch[k], act = k >= 8 - nch, o = 0x40 + k * 8;
        var F = R[o] | (R[o + 2] << 8) | ((R[o + 4] & 3) << 16), L = 256 - (R[o + 4] & 0xFC), wa = R[o + 6], v = R[o + 7] & 15;
        pc.vol = act && F > 0 ? v / 15 : 0;
        pc.freq = F * n163.clock / (15 * 65536 * nch * L);
        var raw = []; for (var i = 0; i < L; i++) { var q = (wa + i) & 255, by = R[(q >> 1) & 127]; raw.push(q & 1 ? by >> 4 : by & 15); }
        var tbl = []; for (i = 0; i < 32; i++) tbl.push(raw[Math.floor(i * L / 32)]);
        pc.wave = { k: 'wave', ck: 'n163', tbl: tbl, duty: null, raw: L !== 32 ? raw : null, rmax: 15, np: { pos: wa, len: L, nch: nch } };
      }
    }

    // ── VSU (Virtual Boy): 5 canais de onda desenhada (32 passos de 6 bits) + 1 de ruído, com envelope ──
    var vsu = null;
    if (hclk(0xC4)) {
      vsu = { clock: hclk(0xC4), w: [], r: [], env: [], ch: [] };
      for (var vi = 0; vi < 6; vi++) {
        var vpc = new PSGChan(col, vi < 5 ? 'Canal ' + (vi + 1) : 'Ruído', 'VSU', REC); mchan(vpc.id, vpc.chip, vpc.label, vi < 5 ? 'psg' : 'noise'); vsu.ch.push(vpc); chans.push(vpc);
        vsu.r.push(new Uint8Array(8)); vsu.env.push({ v: 0, acc: 0 });
        if (vi < 5) vsu.w.push(new Uint8Array(32));
      }
    }
    function vsuWrite(A, d) {
      A = (A << 2) & 0x7FF;                      // o VGM grava o endereço dividido por 4
      if (A < 0x280) { var i = A >> 2; vsu.w[i >> 5][i & 31] = d & 63; return; }
      if (A === 0x580) { if (d & 1) for (var s = 0; s < 6; s++) vsu.r[s][0] &= 0x7F; return; }
      if (A < 0x400 || A >= 0x580) return;
      var c = (A - 0x400) >> 6, k = (A >> 2) & 15; if (c > 5 || k > 7) return;
      vsu.r[c][k] = d;
      if (k === 0 && (d & 0x80)) { vsu.ch[c].trig = true; vsu.env[c].v = vsu.r[c][4] >> 4; vsu.env[c].acc = 0; }
      if (k === 4) { vsu.env[c].v = d >> 4; vsu.env[c].acc = 0; }
    }
    function vsuFrame() {
      for (var c = 0; c < 6; c++) {
        var R = vsu.r[c], e = vsu.env[c], pc = vsu.ch[c];
        if (R[5] & 1) {                          // envelope: um passo a cada (n+1) × 15,4 ms
          e.acc += 1000 / 60; var per = ((R[4] & 7) + 1) * 15.4;
          while (e.acc >= per) { e.acc -= per; if (R[4] & 8) { if (e.v < 15) e.v++; else if (R[5] & 2) e.v = R[4] >> 4; } else { if (e.v > 0) e.v--; else if (R[5] & 2) e.v = R[4] >> 4; } }
        }
        var lr = Math.max(R[1] >> 4, R[1] & 15), fq = R[2] | ((R[3] & 7) << 8);
        pc.vol = (R[0] & 0x80) && lr ? (e.v / 15) * (lr / 15) : 0;
        if (c === 5) { pc.wave = { k: 'noise', ck: 'vsu', nmode: 'white', nrate: (R[5] >> 4) & 7 }; pc.freq = 0; continue; }
        pc.freq = vsu.clock / ((2048 - fq) * 32);
        var wv = vsu.w[Math.min(4, R[6] & 7)];
        pc.wave = { k: 'wave', ck: 'vsu', tbl: Array.prototype.map.call(wv, function (x) { return Math.round(x * 15 / 63); }), duty: null, raw: Array.prototype.slice.call(wv), rmax: 63 };
      }
    }

    // ── WonderSwan: 4 canais de onda (32 passos de 4 bits, na RAM do console); o 4 também faz ruído ──
    var ws = null;
    if (hclk(0xC0)) {
      ws = { clock: hclk(0xC0), r: new Uint8Array(0x100), ram: new Uint8Array(0x4000), ch: [] };
      for (var wi = 0; wi < 4; wi++) { var wpc = new PSGChan(col, 'Canal ' + (wi + 1), 'WonderSwan', REC); mchan(wpc.id, wpc.chip, wpc.label, wi === 3 ? 'noise' : 'psg'); ws.ch.push(wpc); chans.push(wpc); }
    }
    function wsWrite(a, d) {
      var p = 0x80 + (a & 0x7F), old = ws.r[p]; ws.r[p] = d;
      if (p === 0x90) for (var i = 0; i < 4; i++) if ((d & (1 << i)) && !(old & (1 << i))) ws.ch[i].trig = true;
    }
    function wsFrame() {
      var R = ws.r, ctl = R[0x90], base = (R[0x8F] << 6) & 0x3FFF;
      for (var c = 0; c < 4; c++) {
        var pc = ws.ch[c], v = R[0x88 + c], on = (ctl & (1 << c)) && !(c === 1 && (ctl & 0x20));
        pc.vol = on ? Math.max(v >> 4, v & 15) / 15 : 0;
        if (c === 3 && (ctl & 0x80)) { pc.wave = { k: 'noise', ck: 'ws', nmode: 'white', nrate: R[0x8E] & 7 }; pc.freq = 0; continue; }
        var f = R[0x80 + c * 2] | ((R[0x81 + c * 2] & 7) << 8);
        pc.freq = ws.clock / ((2048 - f) * 32);
        var tbl = []; for (var i = 0; i < 16; i++) { var by = ws.ram[(base + c * 16 + i) & 0x3FFF]; tbl.push(by & 15); tbl.push(by >> 4); }
        pc.wave = { k: 'wave', ck: 'ws', tbl: tbl, duty: null, raw: tbl.slice(), rmax: 15 };
      }
    }

    // ── SAA1099 (Philips, SAM Coupé e placas de PC): 6 canais quadrados com 2 geradores de ruído ──
    var saa = null;
    if (hclk(0xC8)) {
      saa = { clock: hclk(0xC8), r: new Uint8Array(32), ch: [] };
      for (var sa = 0; sa < 6; sa++) { var spc2 = new PSGChan(col, 'Canal ' + (sa + 1), 'SAA1099', REC); mchan(spc2.id, spc2.chip, spc2.label, 'psg'); saa.ch.push(spc2); chans.push(spc2); }
    }
    function saaWrite(a, d) { if (a & 0x80) return; a &= 0x1F; var old = saa.r[a]; saa.r[a] = d; if (a === 0x14 || a === 0x15) for (var i = 0; i < 6; i++) if ((d & (1 << i)) && !(old & (1 << i))) saa.ch[i].trig = true; }
    function saaFrame() {
      var R = saa.r, en = R[0x1C] & 1;
      for (var c = 0; c < 6; c++) {
        var pc = saa.ch[c], amp = R[c], tone = R[0x14] & (1 << c), nz = R[0x15] & (1 << c);
        pc.vol = en && (tone || nz) ? Math.max(amp & 15, amp >> 4) / 15 : 0;
        if (tone) {
          var oc = (R[0x10 + (c >> 1)] >> ((c & 1) * 4)) & 7;
          pc.freq = saa.clock / 512 * Math.pow(2, oc) / (511 - R[0x08 + c]);
          pc.wave = { k: 'pulse', ck: 'saa', duty: 2 };
        } else { pc.wave = { k: 'noise', ck: 'saa', nmode: 'white', nrate: (R[0x16] >> (c < 3 ? 0 : 4)) & 3 }; pc.freq = 0; }
      }
    }

    // ── Pokey (Atari 8 bits e arcades da Atari): 4 canais de onda quadrada ou ruído ──
    var pokey = null;
    if (hclk(0xB0)) {
      pokey = { clock: hclk(0xB0), r: new Uint8Array(16), ch: [] };
      for (var pk = 0; pk < 4; pk++) { var ppc = new PSGChan(col, 'Canal ' + (pk + 1), 'Pokey', REC); mchan(ppc.id, ppc.chip, ppc.label, 'psg'); pokey.ch.push(ppc); chans.push(ppc); }
    }
    function pokeyWrite(a, d) { if (a & 0x80) return; a &= 15; var old = pokey.r[a]; pokey.r[a] = d; if (a < 8 && (a & 1) && !(old & 15) && (d & 15)) pokey.ch[a >> 1].trig = true; }
    function pokeyFrame() {
      var R = pokey.r, ac = R[8], base = (ac & 1) ? pokey.clock / 114 : pokey.clock / 28;
      for (var c = 0; c < 4; c++) {
        var pc = pokey.ch[c], audc = R[c * 2 + 1], dist = audc >> 5;
        var joined = (c === 1 && (ac & 0x10)) || (c === 3 && (ac & 0x08));
        var hidden = (c === 0 && (ac & 0x10)) || (c === 2 && (ac & 0x08));  // o canal de baixo do par só dá o tempo
        pc.vol = hidden || (audc & 0x10) ? 0 : (audc & 15) / 15;
        var fast = (c === 0 && (ac & 0x40)) || (c === 2 && (ac & 0x20)) || (joined && (ac & (c === 1 ? 0x40 : 0x20)));
        var per = joined ? (R[c * 2 - 2] | (R[c * 2] << 8)) : R[c * 2];
        var div = fast ? per + (joined ? 7 : 4) : per + 1;
        var clk = fast ? pokey.clock : base;
        if (dist === 5 || dist === 7) { pc.freq = clk / (2 * div); pc.wave = { k: 'pulse', ck: 'pokey', duty: 2 }; }
        else { pc.freq = 0; pc.wave = { k: 'noise', ck: 'pokey', nmode: dist === 6 || dist === 2 ? 'periodic' : 'white', nrate: Math.min(15, Math.round(Math.log2(clk / (2 * div)))) }; }
      }
    }

    // ── AY-3-8910 / SSG dos chips OPN ──
    function makeAY(clock, chipName, is8930) {
      var ay = { clock: clock, r: new Uint8Array(32), ch: [], x: !!is8930, mode: 0 };
      for (var i = 0; i < 3; i++) { var pc = new PSGChan(col, 'SSG ' + 'ABC'[i], chipName, REC); mchan(pc.id, chipName, pc.label, 'psg'); ay.ch.push(pc); chans.push(pc); }
      return ay;
    }
    // AY8930: no modo expandido (registrador 13 com 101x no nibble de cima) ganha um 2º banco de registradores,
    // período de 16 bits, volume de 5 bits, largura de pulso por canal (3,125% a 96,875%) e máscaras de ruído
    function ayX(ay) { return ay.x && (ay.mode & 0xE) === 0xA; }
    function ayW(ay, a, d) {
      a &= 15;
      if (a === 13) { var was = ayX(ay); ay.r[13] = d; if (ay.x) { ay.mode = d >> 4; if (was !== ayX(ay)) for (var i = 0; i < 13; i++) { ay.r[i] = 0; ay.r[i + 16] = 0; } } return; }
      ay.r[a + (ayX(ay) ? (ay.mode & 1) << 4 : 0)] = d;
    }
    function ayFrame(ay) {
      var X = ayX(ay);
      for (var i = 0; i < 3; i++) {
        var p = ay.r[i * 2] | ((ay.r[i * 2 + 1] & (X ? 0xFF : 15)) << 8), mix = ay.r[7], amp = ay.r[8 + i];
        var toneOn = !(mix & (1 << i)), noiseOn = !(mix & (8 << i));
        var v = X ? ((amp & 0x20) ? 1 : (amp & 31) ? Math.pow(10, -(31 - (amp & 31)) * 0.75 / 20) : 0)
                  : ((amp & 16) ? 1 : (amp & 15) ? Math.pow(10, -(15 - (amp & 15)) * 1.5 / 20) : 0);
        var c = ay.ch[i];
        c.vol = (toneOn || noiseOn) ? v : 0;
        c.freq = ay.clock / (16 * (p || 1));
        if (toneOn) c.wave = X ? { k: 'pulse', ck: 'ay8930', duty: Math.min(8, ay.r[0x16 + i] & 15) } : { k: 'pulse', ck: 'ay', duty: 2 };
        else c.wave = { k: 'noise', ck: 'ay', nmode: 'white', nrate: ay.r[6] & (X ? 0xFF : 31) };
      }
    }
    var ays = [];
    var is8930 = hdrLen > 0x78 && b[0x78] === 0x03, ayName = is8930 ? 'AY8930' : 'AY-3-8910';
    var ay = clk.ay ? makeAY(clk.ay, ayName, is8930) : null; if (ay) ays.push(ay);
    var ay2 = dual.ay ? makeAY(clk.ay, ayName + ' #2', is8930) : null; if (ay2) ays.push(ay2);
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
      return (smpDone[k] = storeSmp(d, rate));
    }
    // guarda um sample decodificado (Float32 de -1 a 1) e descobre a nota (ou a peça de bateria)
    function storeSmp(d, rate) {
      var data = d.data, srate = rate;
      // no máximo 4 s (e no máximo 32 kHz) para não pesar o navegador
      if (srate > 32000) { var f = Math.ceil(srate / 32000), nd = new Float32Array(Math.floor(data.length / f)); for (var i = 0; i < nd.length; i++) nd[i] = data[i * f]; data = nd; srate /= f; d.loop = d.loop >= 0 ? Math.floor(d.loop / f) : -1; }
      var maxSec = d.long ? 180 : 4;   // áudio em fluxo (gravado do jeito que tocou) pode ser longo
      if (data.length > srate * maxSec) data = data.subarray(0, Math.floor(srate * maxSec));
      var id = 's' + (PCMSTORE.n++);
      var lp0 = d.loop >= 0 && d.loop < data.length ? d.loop : -1, info = pcmPitch(data, srate);
      if (!info.pitched && lp0 >= 0 && data.length - lp0 <= 1024 && data.length - lp0 >= 8) info = { pitched: true, note: midiOf(srate / (data.length - lp0)) };
      var s = { id: id, r0: rate, rate: srate, len: data.length, loop: d.loop >= 0 && d.loop < data.length ? d.loop : -1, base: info.pitched ? info.note : null, drum: info.pitched ? null : drumOf(data, srate) };
      PCMSTORE.map[id] = data;
      return s;
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
      // um som com altura f cruza o zero pelo menos ~2f vezes por segundo: se cruza bem menos, a "altura" achada é falsa (bumbo, por exemplo)
      var mean = 0; for (i = 0; i < W; i++) mean += x[st + i]; mean /= W;
      var rms = Math.sqrt(e0 / W), hy = 0.25 * rms, side = 0, zc = 0; // cruzamentos com histerese: o chiado em volta do zero não conta
      for (i = 0; i < W; i++) { var xv = x[st + i] - mean; if (xv > hy && side <= 0) { if (side < 0) zc++; side = 1; } else if (xv < -hy && side >= 0) { if (side > 0) zc++; side = -1; } }
      if (rate / bestLag > 3 * (zc * rate / (2 * W))) return { pitched: false };
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
      var drum = s.base == null, note = drum ? 60 : s.base + 12 * Math.log2(playRate / (s.r0 || s.rate)); // r0: taxa antes de reduzir para 32 kHz
      var self = this; this.lastEv = null;
      var tbObj = col.add(this.chip + '|pcm|' + s.id, function () {
        return { type: 'pcm', pcmId: s.id, rate: s.rate, len: s.len, loop: s.loop, base: s.base, drum: s.drum, tune: 0 };
      }, this.label, drum ? 0 : note, this.chip);
      if (drum) this.nDrum++; else this.nTone++;
      if (!REC) return;
      if (!this.seen) { this.seen = true; mchan(this.id, this.chip, this.label, 'pcm'); }
      var ev = { c: this.id, t: t, k: 'on', n: drum ? s.drum : note, v: vol, pan: pan == null ? 64 : pan, tb: tbObj };
      if (drum) ev.noise = { ck: 'drum', d: s.drum };
      REC.push(ev);
      this.lastEv = ev; this.lastTb = tbObj;
      this.on = { s: s, rate: playRate, n: note, v: vol, drum: drum };
    };
    PCMChan.prototype.keyOff = function (at) { if (this.on && REC) REC.push({ c: this.id, t: at != null ? at : t, k: 'off' }); this.on = null; };
    var pcmOutOfOrder = false;
    PCMChan.prototype.setRate = function (r) {
      var o = this.on; if (!o || o.drum || !REC || !r) return;
      var n = o.s.base + 12 * Math.log2(r / (o.s.r0 || o.s.rate));
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

    // ── S-DSP do Super Nintendo (vem de SPC): 8 vozes de sample BRR, cada uma com volume esquerdo/direito e altura ──
    // comandos próprios: 0xD9 rr dd (registrador do DSP) e 0xF0 vv il ih (voz vv liga com o sample il|ih, guardado pelo rg-rip.wasm)
    var sdsp = null, SPCB = opts && opts.spc;
    var BRR_SH = [13, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 16, 16, 16, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 11];
    function brrDecode(buf, off, len, loopOff) {
      var nb = Math.floor(len / 9), out = new Float32Array(nb * 16), p1 = 0, p2 = 0, o = 0, loopFlag = false;
      for (var k = 0; k < nb; k++) {
        var q = off + k * 9, h = buf[q], rs = BRR_SH[h >> 4], ls = BRR_SH[(h >> 4) + 16], f = h & 0x0C;
        if (k === nb - 1) loopFlag = !!(h & 2);
        for (var j = 1; j < 9; j++) {
          var by = buf[q + j];
          for (var hn = 0; hn < 2; hn++) {
            var nyb = hn ? by & 15 : by >> 4, n16 = (nyb << 28) >> 16;
            var s16 = ((((n16 >> rs) & 0xFFFF) << ls) << 16) >> 16, pp2 = p2 >> 1;
            if (f >= 8) { s16 += p1 - pp2; if (f === 8) { s16 += pp2 >> 4; s16 += (p1 * -3) >> 6; } else { s16 += (p1 * -13) >> 7; s16 += (pp2 * 3) >> 4; } }
            else if (f) { s16 += p1 >> 1; s16 += (-p1) >> 5; }
            if (s16 > 32767) s16 = 32767; else if (s16 < -32768) s16 = -32768;
            s16 = ((s16 * 2) << 16) >> 16;
            out[o++] = s16 / 32768; p2 = p1; p1 = s16;
          }
        }
      }
      var lp = loopFlag && loopOff >= 0 && loopOff < len ? Math.floor(loopOff / 9) * 16 : -1;
      return { data: out, loop: lp };
    }
    // sample com loop sem altura detectada: o trecho do loop repete a forma de onda um número inteiro de vezes;
    // acha quantas (a maior divisão do loop que ainda se repete) e daí a nota
    function loopPitch(s) {
      s.loopTried = true;
      var d = PCMSTORE.map[s.id]; if (!d) return;
      var L0 = s.loop, Lp = d.length - L0; if (Lp < 32) return;
      var seg = d.subarray(L0), e = 0, i; for (i = 0; i < Lp; i++) e += seg[i] * seg[i];
      if (e / Lp < 1e-5) return;
      // autocorrelação circular do trecho do loop (ele toca em volta): o 1º pico forte é o período
      var tMin = Math.max(8, Math.floor(s.rate / 2500)), tMax = Math.min(Math.floor(Lp / 2), Math.floor(s.rate / 30)), R = [], mx = 0, tau;
      for (tau = tMin; tau <= tMax; tau++) { var c = 0; for (i = 0; i < Lp; i++) c += seg[i] * seg[(i + tau) % Lp]; c /= e; R[tau] = c; if (c > mx) mx = c; }
      if (mx < 0.55) return;
      var pick = -1;
      for (tau = tMin + 1; tau < tMax; tau++) if (R[tau] >= 0.9 * mx && R[tau] >= R[tau - 1] && R[tau] >= R[tau + 1]) { pick = tau; break; }
      if (pick < 0) return;
      var y0 = R[pick - 1], y1 = R[pick], y2 = R[pick + 1], den = y0 - 2 * y1 + y2, fr = den ? 0.5 * (y0 - y2) / den : 0;   // pico com interpolação
      var f0 = s.rate / (pick + fr); if (f0 < 20 || f0 > 4000) return;
      s.base = midiOf(f0); s.drum = null;
    }
    // ── SPU do PlayStation (vem de PSF): 24 vozes de sample ADPCM ──
    // comandos próprios: 0xE2 aL aH dL dH (registrador do SPU, 16 bits) e 0xE3 vv il ih 00 (voz vv liga com o sample n)
    var psxs = null, PSXB = opts && opts.psx;
    var PSX_F0 = [0, 60, 115, 98, 122], PSX_F1 = [0, 0, -52, -55, -60];
    function psxAdpcm(buf, off, len, loopOff) {
      var nb = len >> 4, out = new Float32Array(nb * 28), o1 = 0, o2 = 0, o = 0;
      for (var k = 0; k < nb; k++) {
        var q = off + k * 16, sh = buf[q] & 15, f = Math.min(4, (buf[q] >> 4) & 7); if (sh > 12) sh = 9;
        for (var j = 2; j < 16; j++) for (var hn = 0; hn < 2; hn++) {
          var nyb = hn ? buf[q + j] >> 4 : buf[q + j] & 15, sv = ((nyb << 28) >> 16) >> sh;
          sv += (o1 * PSX_F0[f] + o2 * PSX_F1[f] + 32) >> 6;
          if (sv > 32767) sv = 32767; else if (sv < -32768) sv = -32768;
          out[o++] = sv / 32768; o2 = o1; o1 = sv;
        }
      }
      return { data: out, loop: loopOff >= 0 ? (loopOff >> 4) * 28 : -1 };
    }
    function psxInit() { psxs = { r: new Uint16Array(256), ch: pcmChanSet('SPU', 24, 'Voz'), on: new Uint8Array(24), until: new Float64Array(24), kt: new Float64Array(24).fill(-1e9) }; }
    function psxRate(v) { return 44100 * Math.min(0x3FFF, psxs.r[v * 8 + 2]) / 4096; }
    function psxVol(v) {
      var f = function (x) { return x & 0x8000 ? 0x3FFF : Math.abs((x << 17) >> 17); };
      var l = f(psxs.r[v * 8]), r = f(psxs.r[v * 8 + 1]);
      return { v: Math.min(1, (l + r) / 0x7FFE * 1.4), pan: l + r ? Math.round(64 + 63 * (r - l) / (l + r)) : 64 };
    }
    function psxWrite(a, d) {
      if (!psxs) psxInit();
      a &= 0x1FE; psxs.r[a >> 1] = d;
      if (a < 0x180) {
        var v = a >> 4, k = a & 15;
        if (v < 24 && psxs.on[v]) {
          if (k === 4) psxs.ch[v].setRate(psxRate(v));
          else if (k < 4) {
            // muitos drivers ligam a voz e só depois escrevem o volume: logo depois do KEY ON, vale para a própria nota
            var pv = psxVol(v), le = psxs.ch[v].lastEv;
            if (t - psxs.kt[v] < 441 && le && le.t === psxs.kt[v]) { le.v = pv.v; le.pan = pv.pan; if (psxs.ch[v].on) psxs.ch[v].on.v = pv.v; }
            else psxs.ch[v].setVol(pv.v);
          }
        }
      } else if (a === 0x18C || a === 0x18E) {
        for (var i = 0; i < 16; i++) if (d & (1 << i)) { var vv = i + (a === 0x18E ? 16 : 0); if (vv < 24 && psxs.on[vv]) { psxs.ch[vv].keyOff(); psxs.on[vv] = 0; } }
      }
    }
    function psxKon(v, idx) {
      if (!psxs) psxInit();
      if (!PSXB || !PSXB.smp[idx] || v >= 24) return;
      var S = PSXB.smp[idx];
      var s = pcmSample('SPU', 'adpcm' + idx, function () { return psxAdpcm(PSXB.blob, S.off, S.len, S.loop); }, 44100);
      if (!s) return;
      var rate = psxRate(v), vv = psxVol(v); if (rate <= 0) return;
      if (s.base == null && s.loop >= 0 && !s.loopTried) loopPitch(s);
      psxs.ch[v].keyOn(s, rate, vv.v, vv.pan); psxs.on[v] = 1; psxs.kt[v] = t;
      psxs.until[v] = s.loop >= 0 ? 1e15 : t + s.len * (s.r0 || s.rate) / s.rate / rate * 44100;
    }
    function psxFrame() { for (var v = 0; v < 24; v++) if (psxs.on[v] && t >= psxs.until[v]) { psxs.ch[v].keyOff(psxs.until[v]); psxs.on[v] = 0; } }
    // ── SPU do Nintendo DS (vem de 2SF): 16 canais de sample (PCM8, PCM16, IMA-ADPCM); 8-13 também onda quadrada, 14-15 ruído ──
    // comandos próprios: 0xE4 ss rr lo hi (escrita), 0xE6/E7/E8/E9 (parâmetros, loop, tamanho, timer do KEY ON), 0xE5 cc il ih 00 (canal liga)
    var ndss = null, NDSB = opts && opts.nds, NDS_K = { p: 0, ls: 0, ln: 0, tm: 0 };
    var IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
    var IMA_IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
    function ndsDecode(buf, off, len, fmt, lsWords, rep) {
      var out, lp = -1, i;
      if (fmt === 0) { out = new Float32Array(len); for (i = 0; i < len; i++) out[i] = ((buf[off + i] << 24) >> 24) / 128; lp = lsWords * 4; }
      else if (fmt === 1) { var n2 = len >> 1; out = new Float32Array(n2); for (i = 0; i < n2; i++) out[i] = (((buf[off + 2 * i] | (buf[off + 2 * i + 1] << 8)) << 16) >> 16) / 32768; lp = lsWords * 2; }
      else {
        if (len < 4) return null;
        var sig = ((buf[off] | (buf[off + 1] << 8)) << 16) >> 16, idx = Math.min(88, buf[off + 2] & 127), o = 0;
        out = new Float32Array((len - 4) * 2);
        for (i = 4; i < len; i++) for (var hn = 0; hn < 2; hn++) {
          var v = hn ? buf[off + i] >> 4 : buf[off + i] & 15, st = IMA_STEP[idx], df = st >> 3;
          if (v & 1) df += st >> 2; if (v & 2) df += st >> 1; if (v & 4) df += st;
          sig += (v & 8) ? -df : df; if (sig > 32767) sig = 32767; else if (sig < -32768) sig = -32768;
          idx += IMA_IDX[v & 7]; if (idx < 0) idx = 0; else if (idx > 88) idx = 88;
          out[o++] = sig / 32768;
        }
        lp = Math.max(0, lsWords * 4 - 4) * 2;
      }
      return { data: out, loop: rep === 1 && lp < out.length ? lp : -1 };
    }
    function ndsPsg(duty) {   // onda quadrada de 8 passos (4 ciclos) em loop; tocada a 8× a frequência
      var o = new Float32Array(32); for (var i = 0; i < 32; i++) o[i] = (i & 7) <= duty ? 0.7 : -0.7; return { data: o, loop: 0 };
    }
    function ndsNoise() { var o = new Float32Array(32768), x = 0x7FFF; for (var i = 0; i < o.length; i++) { var c = x & 1; x >>= 1; if (c) x ^= 0x6000; o[i] = c ? -0.7 : 0.7; } return { data: o, loop: 0 }; }
    function ndsInit() { ndss = { r: new Uint8Array(256), ch: pcmChanSet('NDS', 16, 'Canal'), on: new Uint8Array(16), until: new Float64Array(16), mul: new Float64Array(16).fill(1) }; }
    var NDS_SH = [1, 0.5, 0.25, 0.0625];
    function ndsVol(c) { var r = ndsss(c), v = r & 127, ds = (r >> 8) & 3, pan = (r >> 16) & 127; return { v: Math.min(1, v / 127 * NDS_SH[ds] * 1.2), pan: pan }; }
    function ndsss(c) { var q = c * 16; return (ndss.r[q] | (ndss.r[q + 1] << 8) | (ndss.r[q + 2] << 16) | (ndss.r[q + 3] << 24)) >>> 0; }
    function ndsTmr(c) { return ndss.r[c * 16 + 8] | (ndss.r[c * 16 + 9] << 8); }
    function ndsWrite(sz, a, d) {
      if (!ndss) ndsInit();
      var was = [], c;
      c = a >> 4; var k = a & 15;
      ndss.r[a] = d & 255; if (sz === 2) ndss.r[(a + 1) & 255] = (d >> 8) & 255;
      if (c > 15 || !ndss.on[c]) return;
      var hi = k + sz - 1;
      if (k <= 3 && hi >= 0) {
        if (!(ndsss(c) & 0x80000000)) { ndss.ch[c].keyOff(); ndss.on[c] = 0; return; }
        if (k <= 2) { var vv = ndsVol(c); ndss.ch[c].setVol(vv.v); }
      } else if (k >= 8 && k <= 9) { var tm = ndsTmr(c); if (tm < 0x10000) ndss.ch[c].setRate(16756991 / (0x10000 - tm) * ndss.mul[c]); }
    }
    function ndsKon(c, idx) {
      if (!ndss) ndsInit(); if (c > 15) return;
      var P = NDS_K.p, vol = P & 127, ds = (P >> 7) & 3, pan = (P >> 9) & 127, rep = (P >> 16) & 3, fmt = (P >> 18) & 3, duty = (P >> 20) & 7;
      var tm = NDS_K.tm & 0xFFFF, rate = 16756991 / (0x10000 - tm), s = null, mul = 1;
      if (fmt === 3) {
        if (c >= 14) { s = pcmSample('NDS', 'noise', ndsNoise, 32768); if (s) { s.base = null; s.drum = 42; s.loopTried = true; } }
        else if (c >= 8) { s = pcmSample('NDS', 'psg' + duty, function () { return ndsPsg(duty); }, 8 * 440); if (s) { s.base = 69; s.drum = null; } }   // 8 passos por ciclo: a 3520 Hz, lá 440
      } else {
        if (!NDSB || idx === 0xFFFF || !NDSB.smp[idx]) return;
        var S = NDSB.smp[idx];
        s = pcmSample('NDS', 'smp' + idx + '_' + fmt + '_' + NDS_K.ls + '_' + rep, function () { return ndsDecode(NDSB.blob, S.off, S.len, fmt, NDS_K.ls, rep); }, rate);
      }
      if (!s || rate <= 0) return;
      if (ndss.on[c]) ndss.ch[c].keyOff();
      if (s.base == null && s.loop >= 0 && !s.loopTried) loopPitch(s);
      var v = Math.min(1, vol / 127 * NDS_SH[ds] * 1.2);
      ndss.mul[c] = mul;
      ndss.ch[c].keyOn(s, rate, v, pan); ndss.on[c] = 1;
      ndss.until[c] = s.loop >= 0 ? 1e15 : t + s.len * (s.r0 || s.rate) / s.rate / rate * 44100;
    }
    function ndsFrame() { for (var c = 0; c < 16; c++) if (ndss.on[c] && t >= ndss.until[c]) { ndss.ch[c].keyOff(ndss.until[c]); ndss.on[c] = 0; } }
    // ── Game Boy Advance (vem de GSF): os 12 canais de sample do driver MP2K, lidos da RAM do jogo ──
    // 0xEA valor de 32 bits · 0xEB cc op: 1 frequência (Hz), 2 nota, 3 estado/volume, 4 liga com o sample n, 5 cala
    var gbas = null, GBAB = opts && opts.gba, GBA_V = 0;
    function gbaDecode(S) {
      var buf = GBAB.blob, o = S.off, out, i;
      if (S.type & 1) {   // comprimido: blocos de 33 bytes = 1º valor + 64 diferenças de 4 bits
        var DT = [0, 1, 4, 9, 16, 25, 36, 49, -64, -49, -36, -25, -16, -9, -4, -1], nb = Math.floor(S.len / 33);
        out = new Float32Array(Math.min(S.size, nb * 64));
        for (var bk = 0, k = 0; bk < nb && k < out.length; bk++) {
          var q = o + bk * 33, v = (buf[q] << 24) >> 24;
          for (var j = 0; j < 64 && k < out.length; j++) {
            if (j) { var by = buf[q + 1 + (j >> 1)], nb4 = j & 1 ? by & 15 : by >> 4; v = (((v + DT[nb4]) << 24) >> 24); }
            out[k++] = v / 128;
          }
        }
      } else { var n0 = Math.min(S.size, S.len); out = new Float32Array(n0); for (i = 0; i < n0; i++) out[i] = ((buf[o + i] << 24) >> 24) / 128; }
      return { data: out, loop: S.loop && S.ls < out.length ? S.ls : -1 };
    }
    function gbaInit() { gbas = { ch: pcmChanSet('GBA', 12, 'Canal'), on: new Uint8Array(12), fr: new Float64Array(12), ev: new Uint32Array(12), key: new Uint32Array(12) }; }
    function gbaVol(c) { var e = gbas.ev[c], l = (e >> 8) & 255, r = (e >> 16) & 255; return { v: Math.min(1, (l + r) / 255 * 0.9), pan: l + r ? Math.round(64 + 63 * (r - l) / (l + r)) : 64 }; }
    function gbaCmd(c, op, id) {
      if (!gbas) gbaInit(); if (c > 11) return;
      if (op === 1) { gbas.fr[c] = GBA_V; if (gbas.on[c] && GBA_V > 0) gbas.ch[c].setRate(GBA_V); }
      else if (op === 2) gbas.key[c] = GBA_V;
      else if (op === 3) {
        gbas.ev[c] = GBA_V;
        if (gbas.on[c]) { var vv = gbaVol(c); gbas.ch[c].setVol(vv.v); }
      } else if (op === 4) {
        if (!GBAB || id === 0xFFFF || !GBAB.smp[id]) return;
        var S = GBAB.smp[id], fixed = (gbas.ev[c] >>> 24) & 8, rate = gbas.fr[c];
        var s = pcmSample('GBA', 'mp' + id, function () { return gbaDecode(S); }, S.freq > 0 ? S.freq / 1024 : GBAB.pcm || 13379);
        if (!s || rate <= 0) return;
        // o MP2K toca o sample na taxa do cabeçalho quando a nota é dó 4 (60): a nota do timbre é exata, sem adivinhar
        if (!fixed && S.freq > 0 && !s.gbaBase) { s.base = 60; s.drum = null; s.gbaBase = true; }
        if (gbas.on[c]) gbas.ch[c].keyOff();
        var v0 = gbaVol(c);
        gbas.ch[c].keyOn(s, rate, v0.v, v0.pan); gbas.on[c] = 1;
      } else if (op === 5) { if (gbas.on[c]) { gbas.ch[c].keyOff(); gbas.on[c] = 0; } }
    }
    function sdspInit() { sdsp = { r: new Uint8Array(128), ch: pcmChanSet('S-DSP', 8, 'Voz'), until: [0, 0, 0, 0, 0, 0, 0, 0], on: [0, 0, 0, 0, 0, 0, 0, 0] }; }
    function sdspRate(v) { return 32000 * (((sdsp.r[v * 16 + 3] & 0x3F) << 8) | sdsp.r[v * 16 + 2]) / 4096; }
    function sdspVol(v) { var l = (sdsp.r[v * 16] << 24) >> 24, r = (sdsp.r[v * 16 + 1] << 24) >> 24; return { v: Math.min(1, (Math.abs(l) + Math.abs(r)) / 254 * 1.4), pan: Math.abs(l) + Math.abs(r) ? Math.round(64 + 63 * (Math.abs(r) - Math.abs(l)) / (Math.abs(l) + Math.abs(r))) : 64 }; }
    function sdspWrite(a, d) {
      if (!sdsp) sdspInit();
      a &= 127; sdsp.r[a] = d;
      var v = a >> 4, k = a & 15;
      if (k < 4 && v < 8 && sdsp.on[v]) {
        if (k >= 2) sdsp.ch[v].setRate(sdspRate(v));
        else { var vv = sdspVol(v); sdsp.ch[v].setVol(vv.v); }
      }
      if (a === 0x5C) for (var i = 0; i < 8; i++) if ((d & (1 << i)) && sdsp.on[i]) { sdsp.ch[i].keyOff(); sdsp.on[i] = 0; }
    }
    function sdspKon(v, idx) {
      if (!sdsp) sdspInit();
      if (!SPCB || !SPCB.smp[idx]) return;
      var S = SPCB.smp[idx];
      var s = pcmSample('S-DSP', 'brr' + idx, function () { return brrDecode(SPCB.blob, S.off, S.len, S.loop); }, 32000);
      if (!s) return;
      var rate = sdspRate(v), vv = sdspVol(v);
      if (rate <= 0) return;
      if (s.base == null && s.loop >= 0 && !s.loopTried) loopPitch(s);
      sdsp.ch[v].keyOn(s, rate, vv.v, vv.pan); sdsp.on[v] = 1;
      sdsp.until[v] = s.loop >= 0 ? 1e15 : t + s.len * (s.r0 || s.rate) / s.rate / rate * 44100;   // sample sem loop: a voz cala no fim
    }
    function sdspFrame() { for (var v = 0; v < 8; v++) if (sdsp.on[v] && t >= sdsp.until[v]) { sdsp.ch[v].keyOff(sdsp.until[v]); sdsp.on[v] = 0; } }

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
    // o RF5C164 (Sega CD) é o mesmo chip com outro comando no VGM: os dois usam este código
    function makeRF(name, clock) {
      // wt: quando cada byte da RAM foi escrito; cap: o que cada canal está tocando de fato (para o áudio mandado em fluxo)
      var o = { name: name, clock: clock, ram: new Uint8Array(0x10000), wt: new Float64Array(0x10000).fill(-1), cap: [], sel: 0, bank: 0, on: 0xFF, c: [], ch: pcmChanSet(name, 8, 'Canal') };
      for (var i = 0; i < 8; i++) o.c.push({ env: 255, pan: 255, fd: 0, ls: 0, st: 0 });
      return o;
    }
    var rf = hclk(0x40) ? makeRF('RF5C68', hclk(0x40)) : null;
    var rf2 = hclk(0x6C) ? makeRF('RF5C164', hclk(0x6C)) : null;
    function rfRate(rf, c) { return rf.clock / 384 * rf.c[c].fd / 2048; }
    function rfWrite(rf, a, d) {
      var cur = rf.c[rf.sel];
      switch (a) {
        case 0x00: cur.env = d; rf.ch[rf.sel].setVol(d / 255); break;
        case 0x01: cur.pan = d; break;
        case 0x02: cur.fd = (cur.fd & 0xFF00) | d; rf.ch[rf.sel].setRate(rfRate(rf, rf.sel)); break;
        case 0x03: cur.fd = (cur.fd & 0xFF) | (d << 8); rf.ch[rf.sel].setRate(rfRate(rf, rf.sel)); break;
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
              var s = pcmSample(rf.name, fp, function () {
                // até achar o 0xFF (fim do sample); o byte tem sinal e módulo (bit 7 = positivo)
                var out = [], i = st;
                while (i < 0x10000 && rf.ram[i] !== 0xFF && out.length < 0x10000) { var v = rf.ram[i]; out.push((v & 0x80 ? (v & 0x7F) : -(v & 0x7F)) / 128); i++; }
                return { data: new Float32Array(out), loop: ls >= st && ls < i ? ls - st : -1 };
              }, rf.clock / 384);
              var pl = ch.pan & 15, pr = ch.pan >> 4;
              rf.ch[c].keyOn(s, rfRate(rf, c), ch.env / 255, pl + pr ? Math.round(64 + 63 * (pr - pl) / (pl + pr)) : 64);
              rf.cap[c] = { t0: t, addr: st, ls: ls, frac: 0, rate: rfRate(rf, c), buf: [], dirty: false, done: false, ev: s ? rf.ch[c].lastEv : null, tb: s ? rf.ch[c].lastTb : null,
                vol: ch.env / 255, pan: pl + pr ? Math.round(64 + 63 * (pr - pl) / (pl + pr)) : 64 };
            } else if (!now && was) { rfCapEnd(rf, c); rf.ch[c].keyOff(); }
          }
          break;
      }
    }
    var rfVer = 0; // muda quando a RAM é reescrita (o mesmo endereço pode ter outro sample)
    function rfMem(rf, a, d) { if (rf.ram[a & 0xFFFF] !== d) rfVer++; rf.ram[a & 0xFFFF] = d; rf.wt[a & 0xFFFF] = t; }
    // áudio em fluxo: o jogo vai escrevendo na RAM à frente do que o canal está tocando (Moonwalker, jogos de Sega CD...).
    // Cada canal ligado anda pela RAM no ritmo do chip e guarda os bytes que passam; se tocou algo escrito depois da nota começar,
    // a nota vira um sample com o áudio do jeito que tocou de fato
    function rfCapAdv(rf, n) {
      for (var c = 0; c < 8; c++) {
        var k = rf.cap[c]; if (!k || k.done) continue;
        k.frac += n * rfRate(rf, c) / 44100;
        while (k.frac >= 1) {
          k.frac--;
          var v = rf.ram[k.addr];
          if (v === 0xFF) { k.addr = k.ls & 0xFFFF; v = rf.ram[k.addr]; if (v === 0xFF) { k.done = true; break; } }
          if (rf.wt[k.addr] > k.t0) k.dirty = true;
          k.buf.push(v); k.addr = (k.addr + 1) & 0xFFFF;
          if (k.buf.length >= k.rate * 180) { k.done = true; break; }
        }
      }
    }
    function rfCapEnd(rf, c) {
      var k = rf.cap[c]; rf.cap[c] = null;
      if (!k || !k.dirty || k.buf.length < 64) return;
      var data = new Float32Array(k.buf.length);
      for (var i = 0; i < data.length; i++) { var v = k.buf[i]; data[i] = (v & 0x80 ? (v & 0x7F) : -(v & 0x7F)) / 128; }
      // o mesmo trecho tocado de novo (batida repetida, cortada em pontos diferentes) reaproveita o sample:
      // se um é o começo do outro, fica o mais longo (o fim da nota corta na hora certa)
      var B = k.buf, s2 = null, rr = Math.round(k.rate);
      rf.caps = rf.caps || [];
      for (var ci = 0; ci < rf.caps.length && !s2; ci++) {
        var A = rf.caps[ci]; if (A.rate !== rr) continue;
        var m = Math.min(A.buf.length, B.length), same = true;
        for (var j = 0; j < m; j++) if (A.buf[j] !== B[j]) { same = false; break; }
        if (!same) continue;
        if (B.length > A.buf.length) {   // o novo é mais longo: o sample guardado cresce
          A.buf = B; var sm = A.s, nd = data; if (sm.rate !== k.rate) { var ff = k.rate / sm.rate; nd = new Float32Array(Math.floor(data.length / ff)); for (j = 0; j < nd.length; j++) nd[j] = data[Math.floor(j * ff)]; }
          if (nd.length > sm.rate * 180) nd = nd.subarray(0, Math.floor(sm.rate * 180));
          PCMSTORE.map[sm.id] = nd; sm.len = nd.length; A.tbs.forEach(function (x) { x.len = nd.length; });
        }
        s2 = A.s;
      }
      var entry = null;
      if (!s2) {
        s2 = storeSmp({ data: data, loop: -1, long: true }, k.rate);
        if (!s2) return;
        entry = { rate: rr, buf: B, s: s2, tbs: [] }; rf.caps.push(entry);
      } else entry = rf.caps.filter(function (x) { return x.s === s2; })[0];
      if (s2.base != null) { s2.base = null; s2.drum = drumOf(PCMSTORE.map[s2.id], s2.rate); }   // toca na velocidade em que foi gravado
      var pc = rf.ch[c];
      if (!k.tb) {   // no começo da nota a RAM ainda não tinha um sample inteiro: a nota nasce agora, no tempo em que começou
        if (rf.ch[c].on) rf.ch[c].keyOff();
        pc.keyOn(s2, k.rate, k.vol, k.pan, k.t0);
        if (entry && pc.lastTb && entry.tbs.indexOf(pc.lastTb) < 0) entry.tbs.push(pc.lastTb);
        return;
      }
      var tb2 = col.add(pc.chip + '|pcm|' + s2.id, function () { return { type: 'pcm', pcmId: s2.id, rate: s2.rate, len: s2.len, loop: -1, base: null, drum: s2.drum, tune: 0, stream: true }; }, pc.label, 0, pc.chip);
      if (entry && entry.tbs.indexOf(tb2) < 0) entry.tbs.push(tb2);
      pc.nDrum++;
      // o sample de antes (o que estava na RAM quando a nota começou) sai, se ficou sem uso
      var old = k.tb;
      if (old && --old.count <= 0) { var li = col.list.indexOf(old); if (li >= 0) col.list.splice(li, 1); delete col.map[old.key]; }
      if (k.ev) { k.ev.tb = tb2; k.ev.n = s2.drum; k.ev.noise = { ck: 'drum', d: s2.drum }; }
    }

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

    // ── ADPCM dos YM2608 (PC-98) e YM2610 (Neo Geo) ──
    // ADPCM-B (DELTA-T): 1 voz com afinação; ADPCM-A (só YM2610): 6 vozes de samples fixos (bateria, vozes)
    var YDT_F = [57, 57, 57, 57, 77, 102, 128, 153];
    function ymDeltaT(mem, st, en) {
      var n = Math.max(0, Math.min(en, mem.length) - st), out = new Float32Array(n * 2), acc = 0, step = 127, o = 0;
      function nib(v) {
        var diff = ((2 * (v & 7) + 1) * step) >> 3;
        acc += (v & 8) ? -diff : diff; if (acc > 32767) acc = 32767; else if (acc < -32768) acc = -32768;
        step = (step * YDT_F[v & 7]) >> 6; if (step < 127) step = 127; else if (step > 24576) step = 24576;
        out[o++] = acc / 32768;
      }
      for (var i = 0; i < n; i++) { var by = mem[st + i]; nib(by >> 4); nib(by & 15); }
      return { data: out, loop: -1 };
    }
    var YA_INC = [-1, -1, -1, -1, 2, 5, 7, 9];
    function ymAdpcmA(mem, st, en) {
      var n = Math.max(0, Math.min(en, mem.length) - st), out = new Float32Array(n * 2), acc = 0, idx = 0, o = 0;
      function nib(v) {
        var diff = ((2 * (v & 7) + 1) * OKI_STEP[idx]) >> 3;
        acc = (((acc + ((v & 8) ? -diff : diff)) & 0xFFF) << 20) >> 20;
        idx += YA_INC[v & 7]; if (idx < 0) idx = 0; else if (idx > 48) idx = 48;
        out[o++] = acc / 2048;
      }
      for (var i = 0; i < n; i++) { var by = mem[st + i]; nib(by >> 4); nib(by & 15); }
      return { data: out, loop: -1 };
    }
    function panLR(v) { var l = v & 0x80, r = v & 0x40; return l && !r ? 0 : r && !l ? 127 : 64; }
    function DeltaT(chipName, clock, romType, fixedShift, div, mono) {
      this.div = div || 144; this.mono = !!mono;
      this.chip = chipName; this.clock = clock; this.rom = romType; this.fs = fixedShift; this.r = new Uint8Array(16); this.ch = pcmChanSet(chipName, 1, 'ADPCM-B'); this.used = false;
    }
    DeltaT.prototype.rate = function () { return this.clock / this.div * ((this.r[0x0A] << 8) | this.r[0x09]) / 65536; };
    DeltaT.prototype.write = function (a, d) {
      var R = this.r; R[a] = d; var ch = this.ch[0];
      if (a === 0x09 || a === 0x0A) { ch.setRate(this.rate()); return; }
      if (a === 0x0B) { ch.setVol(d / 255); return; }
      if (a !== 0x00) return;
      if ((d & 1) || !(d & 0x80)) { ch.keyOff(); return; }
      var mem = ROM[this.rom], sh = this.fs || ((R[1] & 3) ? 5 : 2), self = this;
      var st = ((R[3] << 8) | R[2]) << sh, en = (((R[5] << 8) | R[4]) + 1) << sh, rt = this.rate();
      if (!mem || en <= st || st >= mem.length || rt < 500) return;
      var rep = !!(d & 0x10);
      var s = pcmSample(this.chip, 'b' + st + ':' + en + ':' + rep, function () { var x = ymDeltaT(mem, st, en); x.loop = rep ? 0 : -1; return x; }, rt);
      this.used = true;
      ch.keyOn(s, rt, R[0x0B] / 255, this.mono ? 64 : panLR(R[1]));
    };
    var y08b = fm.ym2608 ? new DeltaT('YM2608', clk.ym2608, 0x81, 0) : null;
    var y10b = fm.ym2610 ? new DeltaT('YM2610', clk.ym2610, 0x83, 8) : null;
    var y89b = opl.y8950 ? new DeltaT('Y8950', clk.y8950, 0x88, 0, 72, true) : null; // Y8950 (MSX-Audio): ADPCM nos registradores 0x07-0x12 do OPL
    var y10a = fm.ym2610 ? { r: new Uint8Array(0x30), ch: pcmChanSet('YM2610', 6, 'ADPCM-A'), used: false } : null;
    function y10aWrite(a, d) {
      var R = y10a.r; R[a] = d;
      if (a !== 0x00) return;
      for (var i = 0; i < 6; i++) {
        if (!(d & (1 << i))) continue;
        if (d & 0x80) { y10a.ch[i].keyOff(); continue; }
        var mem = ROM[0x82]; if (!mem) return;
        var st = ((R[0x18 + i] << 8) | R[0x10 + i]) << 8, en = (((R[0x28 + i] << 8) | R[0x20 + i]) + 1) << 8;
        if (en <= st || st >= mem.length) continue;
        var rt = clk.ym2610 / 432;
        var s = pcmSample('YM2610', 'a' + st + ':' + en, function () { return ymAdpcmA(mem, st, en); }, rt);
        var att = ((63 - (R[0x01] & 63)) + (31 - (R[0x08 + i] & 31))) * 0.75;
        y10a.used = true;
        y10a.ch[i].keyOn(s, rt, Math.pow(10, -att / 20), panLR(R[0x08 + i]));
      }
    }
    // bateria interna do YM2608: 6 samples ADPCM gravados dentro do chip (não vêm no VGM).
    // Os dados abaixo são os mesmos que o Furnace usa (refeitos a partir da saída do chip real).
    var Y08_DRUM = [36, 38, 49, 42, 45, 37]; // bumbo, caixa, prato, chimbal, tom, aro
    var Y08_NAME = ['Bumbo', 'Caixa', 'Prato', 'Chimbal', 'Tom', 'Aro'];
    var Y08_POS = [0, 448, 1088, 7040, 7424, 8064, 8192];
    var y08r = null;
    function y08Rhythm(d) {
      if (!fm.ym2608) return;
      if (!y08r) { y08r = { ch: [] }; for (var c = 0; c < 6; c++) { var pc = new PCMChan('YM2608', 'Bateria · ' + Y08_NAME[c]); pcmChans.push(pc); y08r.ch.push(pc); } }
      for (var i = 0; i < 6; i++) {
        if (!(d & (1 << i))) continue;
        if (d & 0x80) { y08r.ch[i].keyOff(); continue; }
        var rom = Y08_ROM(), st = Y08_POS[i], en = Y08_POS[i + 1];
        var rt = clk.ym2608 / (i < 4 ? 432 : 864);     // bumbo, caixa, prato e chimbal a clock/432; tom e aro na metade
        var s = pcmSample('YM2608', 'ritmo' + i, function () { return ymAdpcmA(rom, st, en); }, rt);
        if (!s) continue;
        s.base = null; s.drum = Y08_DRUM[i];
        var R = fm.ym2608.regs[0], att = ((63 - (R[0x11] & 63)) + (31 - (R[0x18 + i] & 31))) * 0.75;
        y08r.ch[i].keyOn(s, rt, Math.pow(10, -att / 20), panLR(R[0x18 + i] || 0xC0));
      }
    }

    // ── QSound (Capcom CPS2): 16 vozes de PCM de 8 bits ──
    // escrita: 1 (endereço) marca uma nota nova, que começa quando 2 (passo) deixa de ser 0;
    // o banco de cada voz fica no registrador 0 da voz anterior (peculiaridade do chip)
    var qs = null;
    if (hclk(0xB4)) qs = { clock: hclk(0xB4), r: new Uint16Array(0x100), pend: [], pan: [], ch: pcmChanSet('QSound', 16, 'Voz') };
    function qsBase() { return qs.clock / 166; }
    function qsRate(c) { return qsBase() * qs.r[c * 8 + 2] / 4096; }
    function qsWrite(reg, d) {
      if (reg >= 0x80 && reg < 0x90) { var pp = Math.min(32, (d - 0x10) & 0x3F); qs.pan[reg - 0x80] = Math.round(pp * 127 / 32); return; }
      if (reg >= 0x80) return;
      qs.r[reg] = d;
      var c = reg >> 3, k = reg & 7, ch = qs.ch[c];
      if (k === 1) { qs.pend[c] = true; return; }
      if (k === 6) { if (!d) ch.keyOff(); else ch.setVol(Math.min(1, d / 4096)); return; }
      if (k !== 2 || !d) return;
      if (!qs.pend[c]) { ch.setRate(qsRate(c)); return; }
      qs.pend[c] = false;
      var mem = ROM[0x8F]; if (!mem || !qs.r[c * 8 + 6]) return;
      var bank = (qs.r[((c + 15) & 15) * 8] & 0x7F) << 16;
      var st = bank | qs.r[c * 8 + 1], en = bank | qs.r[c * 8 + 5], ll = qs.r[c * 8 + 4];
      if (en <= st) return;
      var s = pcmSample('QSound', st + ':' + en + ':' + ll, function () {
        var n = en - st, out = new Float32Array(n);
        for (var i = 0; i < n; i++) out[i] = ((mem[(st + i) % mem.length] << 24) >> 24) / 128;
        var lp = ll ? Math.max(0, n - ll) : -1;
        if (lp >= 0) { var mx = 0; for (i = lp; i < n; i++) mx = Math.max(mx, Math.abs(out[i])); if (mx < 0.03) lp = -1; } // laço mudo no fim = toca uma vez
        return { data: out, loop: lp };
      }, qsBase());
      ch.keyOn(s, qsRate(c), Math.min(1, qs.r[c * 8 + 6] / 4096), qs.pan[c]);
    }

    // ── YMZ280B (Yamaha, arcades da Cave e outros): 8 vozes de ADPCM / PCM de 8 ou 16 bits ──
    var ymz = null;
    if (hclk(0x68)) ymz = { clock: hclk(0x68), r: new Uint8Array(256), ch: pcmChanSet('YMZ280B', 8, 'Voz') };
    function ymzRate(c) { return ymz.clock / 384 * ((ymz.r[c * 4] | ((ymz.r[c * 4 + 1] & 1) << 8)) + 1) / 256; }
    function ymzPan(p) { p &= 15; return p <= 8 ? Math.round(p * 8) : Math.round(64 + (p - 8) * 9); }
    function ymzWrite(a, d) {
      var old = ymz.r[a]; ymz.r[a] = d;
      if (a >= 0x20) return;
      var c = a >> 2, k = a & 3, ch = ymz.ch[c];
      if (k === 0) { ch.setRate(ymzRate(c)); return; }
      if (k === 2) { ch.setVol(d / 255); return; }
      if (k !== 1) return;
      ch.setRate(ymzRate(c));
      if ((old & 0x80) && !(d & 0x80)) { ch.keyOff(); return; }
      if (!(d & 0x80) || (old & 0x80)) return;
      var mem = ROM[0x86], R = ymz.r, mode = (d >> 5) & 3, loopOn = !!(d & 0x10);
      if (!mem || !mode) return;
      function ad(o) { return (R[0x20 + c * 4 + o] << 16) | (R[0x40 + c * 4 + o] << 8) | R[0x60 + c * 4 + o]; }
      var st = ad(0), ls = ad(1), en = ad(3);
      if (en <= st || st >= mem.length) return;
      var per = mode === 1 ? 2 : mode === 2 ? 1 : 0.5; // amostras por byte
      var s = pcmSample('YMZ280B', st + ':' + en + ':' + mode + ':' + (loopOn ? ls : -1), function () {
        var x;
        if (mode === 1) x = ymDeltaT(mem, st, en);
        else {
          var n = Math.floor((Math.min(en, mem.length) - st) * per), out = new Float32Array(Math.max(0, n));
          for (var i = 0; i < n; i++) out[i] = mode === 2 ? ((mem[st + i] << 24) >> 24) / 128 : ((((mem[st + i * 2] << 8) | mem[st + i * 2 + 1]) << 16) >> 16) / 32768;
          x = { data: out };
        }
        x.loop = loopOn && ls >= st && ls < en ? Math.floor((ls - st) * per) : -1;
        return x;
      }, ymzRate(c));
      ch.keyOn(s, ymzRate(c), R[c * 4 + 2] / 255, ymzPan(R[c * 4 + 3]));
    }

    // ── YMF278B (OPL4, MSX Moonsound): parte FM igual ao OPL3 + 24 vozes de sample (ROM da Yamaha e RAM) ──
    var opl4 = null;
    if (hclk(0x60)) {
      opl4 = { clock: hclk(0x60), r: new Uint8Array(256), addr: 0, ch: pcmChanSet('YMF278B', 24, 'PCM') };
      // a parte FM roda a 33,8688 MHz / 684; o OPL3 a 14,318 MHz / 288: converte para a mesma conta
      opl.ymf278b = new OPLChip('opl3', 'YMF278B', opl4.clock * 288 / 684, 18);
    }
    function opl4Byte(a) {
      a &= 0x3FFFFF;
      var m = a < 0x200000 ? ROM[0x84] : ROM[0x87]; if (a >= 0x200000) a -= 0x200000;
      return m && a < m.length ? m[a] : 0;
    }
    function opl4Rate(c) {
      var R = opl4.r, fn = ((R[0x38 + c] & 7) << 7) | (R[0x20 + c] >> 1), oc = R[0x38 + c] >> 4; if (oc & 8) oc -= 16;
      return opl4.clock / 768 * Math.pow(2, oc) * (1024 + fn) / 1024;
    }
    function opl4Pan(p) { p &= 15; return p === 8 ? 64 : p < 8 ? Math.round(64 + p * 9) : Math.round(64 - (16 - p) * 9); }
    function opl4Write(a, d) {
      var R = opl4.r, old = R[a]; R[a] = d;
      if (a >= 0x03 && a <= 0x05) { opl4.addr = ((R[3] & 0x3F) << 16) | (R[4] << 8) | R[5]; return; }
      if (a === 0x06) {                          // escrita do processador na RAM de samples
        if (opl4.addr >= 0x200000) { var ra = opl4.addr - 0x200000; if (!ROM[0x87] || ROM[0x87].length <= ra) romPut(0x87, Math.max(0x200000, ra + 1), ra, new Uint8Array([d])); else ROM[0x87][ra] = d; }
        opl4.addr = (opl4.addr + 1) & 0x3FFFFF; return;
      }
      if (a < 0x08 || a >= 0xF8) return;
      var c = (a - 0x08) % 24, g = Math.floor((a - 0x08) / 24), ch = opl4.ch[c];
      if (g === 1 || g === 2) { ch.setRate(opl4Rate(c)); return; }
      if (g === 3) { ch.setVol(Math.pow(10, -((d >> 1) * 0.375) / 20)); return; }
      if (g !== 4) return;
      if ((old & 0x80) && !(d & 0x80)) { ch.keyOff(); return; }
      if (!(d & 0x80) || (old & 0x80)) return;
      var wn = R[0x08 + c] | ((R[0x20 + c] & 1) << 8);
      var ha = wn < 384 ? wn * 12 : ((R[2] >> 2) & 7) * 0x80000 + (wn - 384) * 12, h = [];
      for (var i = 0; i < 12; i++) h.push(opl4Byte(ha + i));
      var fmt = h[0] >> 6, st = ((h[0] & 0x3F) << 16) | (h[1] << 8) | h[2], lp = (h[3] << 8) | h[4], en = ((h[5] << 8) | h[6]) ^ 0xFFFF;
      if (!en || fmt === 3) return;
      var rt = opl4Rate(c);
      var s = pcmSample('YMF278B', fmt + ':' + st + ':' + lp + ':' + en, function () {
        var out = new Float32Array(en);
        for (var n = 0; n < en; n++) {
          var v;
          if (fmt === 0) v = ((opl4Byte(st + n) << 24) >> 24) * 256;
          else if (fmt === 2) v = ((opl4Byte(st + n * 2) << 8) | opl4Byte(st + n * 2 + 1)) << 16 >> 16;
          else { var o = st + (n >> 1) * 3, b1 = opl4Byte(o + 1); v = ((n & 1) ? (opl4Byte(o + 2) << 8) | ((b1 & 15) << 4) : (opl4Byte(o) << 8) | (b1 & 0xF0)) << 16 >> 16; }
          out[n] = v / 32768;
        }
        var l0 = lp < en ? lp : -1;
        if (l0 >= 0) { var mx = 0; for (n = l0; n < en; n++) mx = Math.max(mx, Math.abs(out[n])); if (mx < 0.02) l0 = -1; } // laço mudo no fim = toca uma vez
        return { data: out, loop: l0 };
      }, rt);
      ch.keyOn(s, rt, Math.pow(10, -((R[0x50 + c] >> 1) * 0.375) / 20), opl4Pan(d));
    }

    // ── GA20 (Irem): 4 vozes de PCM de 8 bits; o byte 0 marca o fim do sample ──
    var ga20 = null;
    if (hclk(0xE0)) ga20 = { clock: hclk(0xE0), r: new Uint8Array(32), ch: pcmChanSet('GA20', 4, 'Voz') };
    function ga20Rate(c) { return ga20.clock / 4 / Math.max(1, 0x100 - ga20.r[c * 8 + 4]); }
    function ga20Write(a, d) {
      a &= 0x1F; var R = ga20.r; R[a] = d; var c = a >> 3, k = a & 7, ch = ga20.ch[c];
      if (k === 4) { ch.setRate(ga20Rate(c)); return; }
      if (k === 5) { ch.setVol(d / (d + 10)); return; }
      if (k !== 6) return;
      if (!(d & 2)) { ch.keyOff(); return; }
      var mem = ROM[0x93]; if (!mem) return;
      var st = (R[c * 8] | (R[c * 8 + 1] << 8)) << 4;
      if (st >= mem.length) return;
      var s = pcmSample('GA20', st, function () {
        var out = [], i = st; while (i < mem.length && mem[i] !== 0 && out.length < 0x40000) { out.push((mem[i] - 0x80) / 128); i++; }
        return { data: new Float32Array(out), loop: -1 };
      }, ga20Rate(c));
      ch.keyOn(s, ga20Rate(c), R[c * 8 + 5] / (R[c * 8 + 5] + 10));
    }

    // ── X1-010 (Seta): 16 vozes; cada uma toca sample (PCM de 8 bits) ou onda desenhada de 128 passos com envelope ──
    var x1 = null;
    if (hclk(0xD8)) {
      x1 = { clock: hclk(0xD8), m: new Uint8Array(0x2000), ch: pcmChanSet('X1-010', 16, 'Voz'), w: [], env: new Float64Array(16) };
      for (var xi = 0; xi < 16; xi++) { var xpc = new PSGChan(col, 'Onda ' + (xi + 1), 'X1-010', REC); mchan(xpc.id, xpc.chip, xpc.label, 'psg'); x1.w.push(xpc); chans.push(xpc); }
    }
    function x1Tick() { return x1.clock / 512; }
    function x1Write(a, d) {
      a &= 0x1FFF; var M = x1.m, old = M[a]; M[a] = d;
      if (a >= 0x80) return;                       // 0x80+: formas de onda e envelopes (memória)
      var v = a >> 3, k = a & 7, o = v * 8, ch = x1.ch[v];
      if (k !== 0) { if (k === 1 && !(M[o] & 2)) ch.setVol(Math.max(d >> 4, d & 15) / 15); return; }
      var on = d & 1, was = old & 1;
      if (on && !was) {
        x1.env[v] = 0;
        if (d & 2) { x1.w[v].trig = true; return; } // onda desenhada: o quadro a quadro cuida
        var mem = ROM[0x91]; if (!mem) return;
        var st = M[o + 4] << 12, en = ((0xFF ^ M[o + 5]) + 1) << 12, rt = x1Tick() * (M[o + 2]) * ((d & 0x80) ? 1 : 2) / 32;
        if (en <= st || st >= mem.length || rt <= 0) return;
        var s = pcmSample('X1-010', st + ':' + en, function () {
          var n = Math.min(en, mem.length) - st, out = new Float32Array(n);
          for (var i = 0; i < n; i++) out[i] = ((mem[st + i] << 24) >> 24) / 128;
          return { data: out, loop: -1 };
        }, rt);
        ch.keyOn(s, rt, Math.max(M[o + 1] >> 4, M[o + 1] & 15) / 15);
      } else if (!on && was) ch.keyOff();
    }
    function x1Frame() {
      var M = x1.m, tk = x1Tick() / 60;
      for (var v = 0; v < 16; v++) {
        var o = v * 8, fl = M[o], pc = x1.w[v];
        if (!(fl & 1) || !(fl & 2)) { pc.vol = 0; continue; }
        var ev = 0x80 + (M[o + 5] & 0x1F) * 128 + ((x1.env[v] / 1024) & 127), eb = M[ev & 0x1FFF];
        x1.env[v] += M[o + 4] * tk;
        if ((fl & 4) && x1.env[v] >= 131072) { M[o] &= ~1; pc.vol = 0; continue; }
        x1.env[v] %= 131072;
        pc.vol = Math.max(eb >> 4, eb & 15) / 15;
        var fr = M[o + 2] | (M[o + 3] << 8);
        pc.freq = x1Tick() * fr * ((fl & 0x80) ? 1 : 2) / 262144;
        var wb = 0x1000 + (M[o + 1] & 0x1F) * 128, tbl = [];
        for (var i = 0; i < 32; i++) tbl.push(Math.round((((M[wb + i * 4] << 24) >> 24) + 128) * 15 / 255));
        var raw1 = []; for (i = 0; i < 128; i++) raw1.push(((M[wb + i] << 24) >> 24) + 128);
        pc.wave = { k: 'wave', ck: 'x1', tbl: tbl, duty: null, raw: raw1, rmax: 255 };
      }
    }

    // ── C140 (Namco System 2 / 21) e C219 (Namco NA-1/NA-2): 24 / 16 vozes de PCM de 8 bits ou comprimido ──
    var c140 = null;
    if (hclk(0xA8)) {
      var ctype = hdrLen > 0x96 ? b[0x96] : 0, cclk = hclk(0xA8);
      c140 = { type: ctype, base: cclk > 1000000 ? cclk / 384 : cclk, r: new Uint8Array(0x200), ch: pcmChanSet(ctype === 2 ? 'C219' : 'C140', ctype === 2 ? 16 : 24, 'Voz') };
    }
    // tabelas de compressão (as mesmas do Furnace / MAME)
    var C140_LAW = new Int16Array(256), C219_LAW = new Int16Array(256);
    (function () {
      for (var i = 0; i < 256; i++) {
        var ex = i & 7, ma = (i >> 3) & 15;
        C140_LAW[i] = (i & 0x80) ? (((ex ? 0xFE00 : 0xFF00) | (ma << 4)) << (ex ? ex - 1 : 0)) : (((ex ? 0x100 : 0) | (ma << 4)) << (ex ? ex - 1 : 0));
      }
      for (i = 0; i < 128; i++) {
        var cs = i < 16 ? 0x20 * i : i < 24 ? 0x200 + 0x40 * i - 0x400 : i < 48 ? 0x400 + 0x80 * i - 0xC00 : i < 100 ? 0x1000 + 0x100 * i - 0x3000 : 0x4400 + 0x200 * i - 0xC800;
        C219_LAW[i] = cs; C219_LAW[i + 128] = (~cs) & 0xFFE0;
      }
    })();
    function c140Rate(v) { return c140.base * 2 * ((c140.r[v * 16 + 2] << 8) | c140.r[v * 16 + 3]) / 65536; }
    function c140Write(a, d) {
      a &= 0x1FF; var R = c140.r; R[a] = d;
      if (a >= 0x180) return;
      var v = a >> 4, k = a & 15, ch = c140.ch[v], o = v * 16; if (!ch) return;
      if (k === 2 || k === 3) { ch.setRate(c140Rate(v)); return; }
      if (k === 0 || k === 1) { ch.setVol(Math.max(R[o], R[o + 1]) / 255); return; }
      if (k !== 5) return;
      if (!(d & 0x80)) { ch.keyOff(); return; }
      var mem = ROM[0x8D]; if (!mem) return;
      var c219 = c140.type === 2, st = (R[o + 6] << 8) | R[o + 7], en = (R[o + 8] << 8) | R[o + 9], lp = (R[o + 10] << 8) | R[o + 11];
      var comp = c219 ? !!(d & 1) : !!(d & 8), loop = !!(d & 0x10), inv = c219 && !!(d & 0x40);
      if (c219 && (d & 4)) return;                // voz de ruído: sem sample
      var bk = R[o + 4], bank = c140.type === 0 ? ((bk & 0x20) >> 2) | (bk & 7) : c140.type === 1 ? ((bk & 0x30) >> 1) | (bk & 7) : 0;
      function rd(x) { // x = posição do sample
        if (c219) return mem[(((R[[0x1F7, 0x1F1, 0x1F3, 0x1F5][v >> 2]] & 3) << 17) | ((x ^ 1) & 0x1FFFF)) % mem.length];
        return mem[((bank << 16) | (x & 0xFFFF)) % mem.length];
      }
      if (en <= st) return;
      var s0 = c219 ? st * 2 : st, n0 = c219 ? (en - st) * 2 : en - st;
      var s = pcmSample(c219 ? 'C219' : 'C140', bank + ':' + s0 + ':' + n0 + ':' + comp + ':' + inv + ':' + (loop ? lp : -1), function () {
        var out = new Float32Array(n0);
        for (var i = 0; i < n0; i++) {
          var x = rd(s0 + i), sv = comp ? (c219 ? C219_LAW[x] : C140_LAW[x]) : ((x << 24) >> 24) << 8;
          out[i] = (inv ? -sv : sv) / 32768;
        }
        var l0 = loop ? (c219 ? lp * 2 : lp) - s0 : -1;
        return { data: out, loop: l0 >= 0 && l0 < n0 ? l0 : -1 };
      }, c140.base * 2);
      var lv = R[o + 1], rv = R[o];
      ch.keyOn(s, c140Rate(v), Math.max(lv, rv) / 255, lv + rv ? Math.round(64 + 63 * (rv - lv) / (lv + rv)) : 64);
    }

    // ── K054539 (Konami): 8 vozes de PCM de 8/16 bits ou DPCM de 4 bits ──
    var k539 = null;
    if (hclk(0xA0)) k539 = { clock: hclk(0xA0), r: new Uint8Array(0x230), ch: pcmChanSet('K054539', 8, 'Voz') };
    var K539_DPCM = [0, 1, 4, 9, 16, 25, 36, 49, -64, -49, -36, -25, -16, -9, -4, -1];
    function k539Rate(c) { var o = c * 0x20, R = k539.r; return 48000 * (R[o] | (R[o + 1] << 8) | (R[o + 2] << 16)) / 65536; }
    function k539Vol(c) { return Math.pow(10, -36 * Math.min(0x40, k539.r[c * 0x20 + 3]) / 64 / 20); }
    function k539Write(a, d) {
      if (a >= 0x230) return;
      var R = k539.r; R[a] = d;
      if (a < 0x100) { var c0 = a >> 5, k = a & 0x1F; if (c0 < 8) { if (k <= 2) k539.ch[c0].setRate(k539Rate(c0)); else if (k === 3) k539.ch[c0].setVol(k539Vol(c0)); } return; }
      if (a === 0x215) { for (var j = 0; j < 8; j++) if (d & (1 << j)) k539.ch[j].keyOff(); return; }
      if (a !== 0x214) return;
      var mem = ROM[0x8C]; if (!mem) return;
      for (var c = 0; c < 8; c++) {
        if (!(d & (1 << c))) continue;
        var o = c * 0x20, st = R[o + 0x0C] | (R[o + 0x0D] << 8) | (R[o + 0x0E] << 16), lp = R[o + 8] | (R[o + 9] << 8) | (R[o + 10] << 16);
        var typ = (R[0x200 + c * 2] >> 2) & 3, loop = R[0x201 + c * 2] & 1;
        st %= mem.length;
        var s = pcmSample('K054539', st + ':' + typ + ':' + (loop ? lp : -1), function () {
          var out = [], i = st, lpi = -1;
          if (typ === 0) { while (mem[i % mem.length] !== 0x80 && out.length < 0x40000) { if (i === lp) lpi = out.length; out.push(((mem[i % mem.length] << 24) >> 24) / 128); i++; } }
          else if (typ === 1) { while (out.length < 0x40000) { var w = mem[i % mem.length] | (mem[(i + 1) % mem.length] << 8); if (w === 0x8000) break; if (i === lp) lpi = out.length; out.push(((w << 16) >> 16) / 32768); i += 2; } }
          else { var cur = 0; while (out.length < 0x40000) { var by = mem[i % mem.length]; if (by === 0x88) break; if (i === lp) lpi = out.length; for (var h = 0; h < 2; h++) { cur += K539_DPCM[h ? by >> 4 : by & 15] << 8; cur = Math.max(-32768, Math.min(32767, cur)); out.push(cur / 32768); } i++; } }
          return { data: new Float32Array(out), loop: loop ? Math.max(0, lpi) : -1 };
        }, k539Rate(c) || 48000);
        k539.ch[c].keyOn(s, k539Rate(c) || 48000, k539Vol(c));
      }
    }

    // ── MultiPCM (Sega Model 1/2): 28 vozes; cada sample tem um cabeçalho de 12 bytes na ROM (como no OPL4) ──
    var mpcm = null;
    if (hclk(0x88)) mpcm = { clock: hclk(0x88), slot: 0, reg: 0, r: [], bank0: 0, bank1: 0, ch: pcmChanSet('MultiPCM', 28, 'Voz') };
    if (mpcm) for (var mi = 0; mi < 28; mi++) mpcm.r.push(new Uint8Array(8));
    var MPCM_SLOT = [0, 1, 2, 3, 4, 5, 6, -1, 7, 8, 9, 10, 11, 12, 13, -1, 14, 15, 16, 17, 18, 19, 20, -1, 21, 22, 23, 24, 25, 26, 27, -1];
    function mpcmRate(c) { var R = mpcm.r[c], oc = R[3] >> 4, fn = ((R[3] & 15) << 6) | (R[2] >> 2); if (oc & 8) oc -= 16; return mpcm.clock / 224 * Math.pow(2, oc) * (1024 + fn) / 1024; }
    function mpcmWrite(port, d) {
      if (port === 1) { mpcm.slot = MPCM_SLOT[d & 0x1F]; return; }
      if (port === 2) { mpcm.reg = d > 7 ? 7 : d; return; }
      var c = mpcm.slot; if (c < 0) return;
      var R = mpcm.r[c], k = mpcm.reg, old = R[k], ch = mpcm.ch[c]; R[k] = d;
      if (k === 2 || k === 3) { ch.setRate(mpcmRate(c)); return; }
      if (k === 5) { ch.setVol(Math.pow(10, -((d >> 1) * 0.375) / 20)); return; }
      if (k !== 4) return;
      if ((old & 0x80) && !(d & 0x80)) { ch.keyOff(); return; }
      if (!(d & 0x80) || (old & 0x80)) return;
      var mem = ROM[0x89]; if (!mem) return;
      var sn = R[1] | ((R[2] & 1) << 8), h = mem.subarray(sn * 12, sn * 12 + 12); if (h.length < 12) return;
      var fmt = h[0] >> 6, st = ((h[0] & 0x3F) << 16) | (h[1] << 8) | h[2], lp = (h[3] << 8) | h[4], en = ((h[5] << 8) | h[6]) ^ 0xFFFF;
      if (st & 0x100000) st = (st & 0xFFFFF) | ((st & 0x080000) ? mpcm.bank1 : mpcm.bank0);
      if (!en) return;
      var rt = mpcmRate(c);
      var s = pcmSample('MultiPCM', fmt + ':' + st + ':' + lp + ':' + en, function () {
        var out = new Float32Array(en);
        for (var n = 0; n < en; n++) {
          var v;
          if (fmt & 1) { var o2 = st + (n >> 1) * 3, b1 = mem[(o2 + 1) % mem.length]; v = ((n & 1) ? (mem[(o2 + 2) % mem.length] << 8) | ((b1 & 15) << 4) : (mem[o2 % mem.length] << 8) | (b1 & 0xF0)) << 16 >> 16; }
          else v = ((mem[(st + n) % mem.length] << 24) >> 24) * 256;
          out[n] = v / 32768;
        }
        var l0 = lp < en ? lp : -1;
        if (l0 >= 0) { var mx = 0; for (n = l0; n < en; n++) mx = Math.max(mx, Math.abs(out[n])); if (mx < 0.02) l0 = -1; }
        return { data: out, loop: l0 };
      }, rt);
      var pn = R[0] >> 4;
      ch.keyOn(s, rt, Math.pow(10, -((R[5] >> 1) * 0.375) / 20), pn === 0 ? 64 : pn < 8 ? Math.round(64 + pn * 9) : Math.round(64 - (16 - pn) * 9));
    }

    // ── ES5506 (Ensoniq OTTO: Taito F3 e outros): 32 vozes de PCM de 16 bits; registradores de 32 bits escritos byte a byte ──
    var es6 = null;
    if (hclk(0xD0) && (u32(b, 0xD0) & 0x80000000)) {
      es6 = { clock: hclk(0xD0), latch: 0, page: 0, act: 0x1F, cr: new Uint32Array(32), fc: new Uint32Array(32), lv: new Uint32Array(32), rv: new Uint32Array(32), st: new Uint32Array(32), en: new Uint32Array(32), acc: new Uint32Array(32), on: [], ch: pcmChanSet('ES5506', 32, 'Voz') };
      for (var ei = 0; ei < 32; ei++) es6.cr[ei] = 3;
    }
    function es6Out() { return es6.clock / (16 * (es6.act + 1)); }
    function es6Rate(v) { return es6Out() * es6.fc[v] / 2048; }
    function es6Vol(x) { return Math.pow(2, (((x >>> 4) & 0xFFF) - 0xFFF) / 256); } // volume em escala logarítmica (6 dB a cada 256)
    function es6Write(a, d) {
      var sh = 24 - ((a & 3) << 3);
      es6.latch = ((es6.latch & ~(0xFF << sh)) | (d << sh)) >>> 0;
      if ((a & 3) !== 3) return;
      var reg = (a >> 2) & 15, v = es6.latch; es6.latch = 0;
      if (reg === 15) { es6.page = v & 0x7F; return; }
      if (reg >= 13 || (es6.page & 0x40)) return;
      var vc = es6.page & 31, ch = es6.ch[vc];
      if (es6.page & 0x20) {
        if (reg === 0) es6Cr(vc, v); else if (reg === 1) es6.st[vc] = v; else if (reg === 2) es6.en[vc] = v; else if (reg === 3) es6.acc[vc] = v;
        return;
      }
      if (reg === 0) es6Cr(vc, v);
      else if (reg === 1) { es6.fc[vc] = v & 0x1FFFF; ch.setRate(es6Rate(vc)); }
      else if (reg === 2 || reg === 4) { if (reg === 2) es6.lv[vc] = v; else es6.rv[vc] = v; ch.setVol(Math.max(es6Vol(es6.lv[vc]), es6Vol(es6.rv[vc]))); }
      else if (reg === 11) es6.act = Math.max(4, v & 31);
    }
    function es6Cr(vc, v) {
      es6.cr[vc] = v;
      var on = (v & 3) === 0, ch = es6.ch[vc];
      if (!on) { if (es6.on[vc]) ch.keyOff(); es6.on[vc] = false; return; }
      if (es6.on[vc]) return;
      es6.on[vc] = true;
      var mem = ROM['es' + ((v >> 14) & 3)]; if (!mem) return;
      var s0 = es6.acc[vc] >>> 11, ls = es6.st[vc] >>> 11, e0 = es6.en[vc] >>> 11, loop = !!(v & 8), rt = es6Rate(vc);
      if (e0 <= s0 || s0 * 2 >= mem.length || rt <= 0) return;
      var s = pcmSample('ES5506', ((v >> 14) & 3) + ':' + s0 + ':' + e0 + ':' + (loop ? ls : -1), function () {
        var n = Math.min(e0, (mem.length >> 1) - 1) - s0 + 1, out = new Float32Array(Math.max(0, n));
        for (var i = 0; i < n; i++) { var o = (s0 + i) * 2; out[i] = (((mem[o] | (mem[o + 1] << 8)) << 16) >> 16) / 32768; }
        return { data: out, loop: loop && ls >= s0 && ls < e0 ? ls - s0 : -1 };
      }, rt);
      var l = es6Vol(es6.lv[vc]), r = es6Vol(es6.rv[vc]);
      ch.keyOn(s, rt, Math.max(l, r), l + r ? Math.round(64 + 63 * (r - l) / (l + r)) : 64);
    }

    // ── YMF271 (OPX, Yamaha: arcades da Seibu, Jaleco...): 12 grupos de 4 slots; cada grupo é FM de 4, 3+1 ou 2×2 operadores
    //    (com 8 ligações a 16 algoritmos e várias formas de onda) ou PCM. FM vira timbre "opx"; PCM vira sample ──
    var OPX_FMTAB = [0, 1, 2, -1, 3, 4, 5, -1, 6, 7, 8, -1, 9, 10, 11, -1], OPX_PCMTAB = [0, 4, 8, -1, 12, 16, 20, -1, 24, 28, 32, -1, 36, 40, 44, -1];
    var opx = null;
    if (hclk(0x64)) {
      opx = { clock: hclk(0x64), latch: new Uint8Array(8), s: [], sync: new Uint8Array(12), rec: {}, pcm: {} };
      for (var oi = 0; oi < 48; oi++) opx.s.push({ kon: 0, dt: 0, mul: 0, tl: 127, ks: 0, ar: 0, d1r: 0, d2r: 0, d1l: 0, rr: 0, fnum: 0, block: 0, latch: 0, fb: 0, wave: 0, acc: 0, alg: 0, lv: [0, 0, 0, 0], pst: 0, pen: 0, plp: 0, pfs: 0, p12: 0 });
    }
    function opxVoice(bank, g) {
      switch (opx.sync[g]) {
        case 0: return bank === 0 ? [g, g + 12, g + 24, g + 36] : null;
        case 1: return bank === 0 ? [g, g + 24] : bank === 1 ? [g + 12, g + 36] : null;
        case 2: return bank === 0 ? [g, g + 12, g + 24] : bank === 3 ? [g + 36] : null;
        default: return [12 * bank + g];
      }
    }
    function opxBlock(s) { return ((s.block ^ 8) - 8); }
    function opxHz(s) { return 2 * s.fnum * Math.pow(2, opxBlock(s) - 7) * (opx.clock / 384) / 32768; }
    function opxRec(bank, g) { // um "canal" por (grupo, banco) que dá nota
      var id = 'YMF271 · G' + (g + 1) + (bank ? '.' + (bank + 1) : '');
      var r = opx.rec[id]; if (!r) r = opx.rec[id] = { id: id, label: 'Grupo ' + (g + 1) + (bank ? '.' + (bank + 1) : ''), seen: false, on: null };
      return r;
    }
    function opxOff(r) { if (r.on && REC) REC.push({ c: r.id, t: t, k: 'off' }); r.on = null; }
    function opxKeyOn(bank, g) {
      var sl = opxVoice(bank, g); if (!sl) return;
      var head = opx.s[sl[0]], r = opxRec(bank, g);
      var vol = Math.pow(2, -(head.lv[0] < 13 ? head.lv[0] : 16) / 2) * (head.lv[0] & 1 ? 0.75 : 1);
      var lvl = Math.max(head.lv[0] < 13 ? 1 : 0, head.lv[1] < 13 ? 1 : 0); if (!lvl) vol = 0;
      if (sl.length === 1 && head.wave === 7 && (sl[0] & 3) === 0) { opxPcm(sl[0], bank, g); return; }
      if (head.wave === 7) return;
      var n = sl.length, alg = n === 4 ? head.alg & 15 : n === 3 ? head.alg & 7 : n === 2 ? head.alg & 3 : 0;
      var ops = sl.map(function (k) { var s = opx.s[k]; return { ar: s.ar, d1r: s.d1r, d2r: s.d2r, rr: s.rr, sl: s.d1l, tl: s.tl, ks: s.ks, mul: s.mul, dt: s.dt, ws: s.wave > 6 ? 0 : s.wave, fb: s.fb, acc: s.acc }; });
      var note = midiOf(opxHz(head));
      var key = 'YMF271|opx|' + n + ':' + alg + '|' + ops.map(function (o) { return [o.ar, o.d1r, o.d2r, o.rr, o.sl, o.tl, o.ks, o.mul, o.dt, o.ws, o.fb, o.acc].join(','); }).join('|');
      var tbObj = col.add(key, function () { return { type: 'opx', mode: n, alg: alg, ops: ops, rate: opx.clock / 384, tune: 0 }; }, r.label, note, 'YMF271');
      opxOff(r);
      if (!REC) return;
      if (!r.seen) { r.seen = true; mchan(r.id, 'YMF271', r.label, 'fm'); }
      var ev = { c: r.id, t: t, k: 'on', n: note, v: Math.max(0.05, vol), pan: 64, tb: tbObj };
      REC.push(ev); r.on = { n: note, head: sl[0] };
    }
    function opxPcm(k, bank, g) {
      var s = opx.s[k], mem = ROM[0x85]; if (!mem) return;
      var key = 'pcm' + k;
      if (!opx.pcm[key]) opx.pcm[key] = pcmChanSet('YMF271', 1, 'PCM ' + (g + 1) + (bank ? '.' + (bank + 1) : ''))[0];
      var ch = opx.pcm[key], fs = opx.clock / 384;
      var step = (((s.fnum & 0x7FF) | 0x800) / 2048) * Math.pow(2, opxBlock(s)) * (s.mul ? s.mul : 0.5) / Math.pow(2, s.pfs);
      var rt = fs * step, st = s.pst, en = s.pen, lp = s.plp, b12 = s.p12;
      if (!en || st >= mem.length) return;
      var smp = pcmSample('YMF271', st + ':' + en + ':' + lp + ':' + b12, function () {
        var out = new Float32Array(en);
        for (var i = 0; i < en; i++) {
          var v;
          if (!b12) v = ((mem[(st + i) % mem.length] << 24) >> 24) << 4;
          else { var a3 = st + (i >> 1) * 3; v = (i & 1) ? (mem[(a3 + 2) % mem.length] << 4) | (mem[(a3 + 1) % mem.length] >> 4) : (mem[a3 % mem.length] << 4) | (mem[(a3 + 1) % mem.length] & 15); v = ((v & 0xFFF) ^ 0x800) - 0x800; }
          out[i] = v / 2048;
        }
        var l0 = lp < en ? lp : -1;
        if (l0 >= 0) { var mx = 0; for (i = l0; i < en; i++) mx = Math.max(mx, Math.abs(out[i])); if (mx < 0.02 || en - l0 < 4) l0 = -1; } // laço mudo no fim = toca uma vez
        return { data: out, loop: l0 };
      }, fs * (s.pfs ? 1 / Math.pow(2, s.pfs) : 1));
      ch.keyOn(smp, rt, Math.pow(10, -(s.tl * 0.75) / 20));
    }
    function opxSlotReg(k, reg, d) {
      var s = opx.s[k];
      switch (reg) {
        case 0x3: s.mul = d & 15; s.dt = (d >> 4) & 7; break;
        case 0x4: s.tl = d & 0x7F; break;
        case 0x5: s.ar = d & 31; s.ks = (d >> 5) & 7; break;
        case 0x6: s.d1r = d & 31; break;
        case 0x7: s.d2r = d & 31; break;
        case 0x8: s.rr = d & 15; s.d1l = (d >> 4) & 15; break;
        case 0x9: s.fnum = ((s.latch & 15) << 8) | d; s.block = s.latch >> 4; break;
        case 0xA: s.latch = d; break;
        case 0xB: s.wave = d & 7; s.fb = (d >> 4) & 7; s.acc = (d >> 7) & 1; break;
        case 0xC: s.alg = d & 15; break;
        case 0xD: s.lv[0] = d >> 4; s.lv[1] = d & 15; break;
        case 0xE: s.lv[2] = d >> 4; s.lv[3] = d & 15; break;
      }
    }
    function opxWrite(port, a, d) {
      if (port === 4) {                                   // atributos de PCM
        var k = OPX_PCMTAB[a & 15]; if (k < 0) return; var s = opx.s[k];
        switch (a >> 4) {
          case 0: s.pst = (s.pst & 0xFFFF00) | d; break; case 1: s.pst = (s.pst & 0xFF00FF) | (d << 8); break; case 2: s.pst = (s.pst & 0xFFFF) | ((d & 0x7F) << 16); break;
          case 3: s.pen = (s.pen & 0xFFFF00) | d; break; case 4: s.pen = (s.pen & 0xFF00FF) | (d << 8); break; case 5: s.pen = (s.pen & 0xFFFF) | ((d & 0x7F) << 16); break;
          case 6: s.plp = (s.plp & 0xFFFF00) | d; break; case 7: s.plp = (s.plp & 0xFF00FF) | (d << 8); break; case 8: s.plp = (s.plp & 0xFFFF) | ((d & 0x7F) << 16); break;
          case 9: s.pfs = d & 3; s.p12 = (d >> 2) & 1; break;
        }
        return;
      }
      if (port === 6) { if ((a & 0xF0) === 0) { var gg = OPX_FMTAB[a & 15]; if (gg >= 0) opx.sync[gg] = d & 3; } return; }
      if (port > 3) return;
      var g = OPX_FMTAB[a & 15], reg = a >> 4; if (g < 0) return;
      var bank = port, sl = opxVoice(bank, g);
      var bcast = (reg === 0 || reg === 9 || reg === 0xA || reg === 0xC || reg === 0xD || reg === 0xE) && sl && opx.sync[g] !== 3;
      if (reg !== 0) {
        if (bcast) sl.forEach(function (k) { opxSlotReg(k, reg, d); }); else opxSlotReg(12 * bank + g, reg, d);
        if (reg === 9 && sl) { var r = opxRec(bank, g); if (r.on && REC) { var nn = midiOf(opxHz(opx.s[sl[0]])); if (Math.abs(nn - r.on.n) > 0.05) { REC.push({ c: r.id, t: t, k: 'pitch', n: nn }); r.on.n = nn; } } }
        return;
      }
      if (!sl) { opx.s[12 * bank + g].kon = d & 1; return; }
      sl.forEach(function (k) { opx.s[k].kon = d & 1; });
      if (d & 1) opxKeyOn(bank, g);
      else { var hs = opx.s[sl[0]]; if (sl.length === 1 && hs.wave === 7) { var pc = opx.pcm['pcm' + sl[0]]; if (pc) pc.keyOff(); } else opxOff(opxRec(bank, g)); }
    }

    // ── ES5505 (Ensoniq OTTO, versão de 16 bits): 32 vozes; registradores de 16 bits ──
    var es5 = null;
    if (hclk(0xD0) && !(u32(b, 0xD0) & 0x80000000)) {
      es5 = { clock: hclk(0xD0), page: 0, act: 0x1F, cr: new Uint16Array(32), fc: new Uint16Array(32), lv: new Uint8Array(32), rv: new Uint8Array(32), st: new Uint32Array(32), en: new Uint32Array(32), acc: new Uint32Array(32), on: [], ch: pcmChanSet('ES5505', 32, 'Voz') };
      for (var e5 = 0; e5 < 32; e5++) es5.cr[e5] = 3;
    }
    function es5Rate(v) { return es5.clock / (16 * (es5.act + 1)) * es5.fc[v] / 512; }
    function es5Vol(x) { return Math.pow(2, (x - 255) / 16); }
    function es5Write(a, d) {
      var reg = a & 15;
      if (reg >= 12) { if (reg === 13) es5.act = Math.max(7, d & 31); else if (reg === 15) es5.page = d & 0x7F; return; }
      if (es5.page & 0x60) return;
      var vc = es5.page & 31, ch = es5.ch[vc];
      switch (reg) {
        case 0: es5Cr(vc, d); break;
        case 1: es5.fc[vc] = (d >> 1) & 0x7FFF; ch.setRate(es5Rate(vc)); break;
        case 2: es5.st[vc] = (es5.st[vc] & 0xFFFF) | ((d & 0x1FFF) << 16); break;
        case 3: es5.st[vc] = (es5.st[vc] & 0x1FFF0000) | (d & 0xFFE0); break;
        case 4: es5.en[vc] = (es5.en[vc] & 0xFFFF) | ((d & 0x1FFF) << 16); break;
        case 5: es5.en[vc] = (es5.en[vc] & 0x1FFF0000) | (d & 0xFFE0); break;
        case 8: es5.lv[vc] = d >> 8; ch.setVol(Math.max(es5Vol(es5.lv[vc]), es5Vol(es5.rv[vc]))); break;
        case 9: es5.rv[vc] = d >> 8; ch.setVol(Math.max(es5Vol(es5.lv[vc]), es5Vol(es5.rv[vc]))); break;
        case 10: es5.acc[vc] = (es5.acc[vc] & 0xFFFF) | ((d & 0x1FFF) << 16); break;
        case 11: es5.acc[vc] = (es5.acc[vc] & 0x1FFF0000) | d; break;
      }
    }
    function es5Cr(vc, v) {
      es5.cr[vc] = v;
      var on = (v & 3) === 0, ch = es5.ch[vc];
      if (!on) { if (es5.on[vc]) ch.keyOff(); es5.on[vc] = false; return; }
      if (es5.on[vc]) return;
      es5.on[vc] = true;
      var bk = (v >> 2) & 1, mem = ROM['es' + bk] || ROM['es0']; if (!mem) return;
      var s0 = es5.acc[vc] >>> 9, ls = es5.st[vc] >>> 9, e0 = es5.en[vc] >>> 9, loop = !!(v & 8), rt = es5Rate(vc);
      if (e0 <= s0 || s0 * 2 >= mem.length || rt <= 0) return;
      var s = pcmSample('ES5505', bk + ':' + s0 + ':' + e0 + ':' + (loop ? ls : -1), function () {
        var n = Math.min(e0, (mem.length >> 1) - 1) - s0 + 1, out = new Float32Array(Math.max(0, n));
        for (var i = 0; i < n; i++) { var o = (s0 + i) * 2; out[i] = (((mem[o] | (mem[o + 1] << 8)) << 16) >> 16) / 32768; }
        return { data: out, loop: loop && ls >= s0 && ls < e0 ? ls - s0 : -1 };
      }, rt);
      var l = es5Vol(es5.lv[vc]), r = es5Vol(es5.rv[vc]);
      ch.keyOn(s, rt, Math.max(l, r), l + r ? Math.round(64 + 63 * (r - l) / (l + r)) : 64);
    }

    // ── ES5503 (Ensoniq DOC: Apple IIgs): 32 osciladores lendo ondas/samples de 8 bits da RAM; o byte 0 encerra ──
    var es3 = null;
    if (hclk(0xCC)) es3 = { clock: hclk(0xCC), r: new Uint8Array(0x100), osc: 1, ram: new Uint8Array(0x20000), ch: pcmChanSet('ES5503', 32, 'Oscilador') };
    var ES3_SIZE = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768], ES3_WMASK = [0x1FF00, 0x1FE00, 0x1FC00, 0x1F800, 0x1F000, 0x1E000, 0x1C000, 0x18000];
    function es3Out() { return es3.clock / 8 / (es3.osc + 2); }
    function es3Step(o) { var R = es3.r, sz = (R[0xC0 + o] >> 3) & 7, res = R[0xC0 + o] & 7; return es3Out() * ((R[0x20 + o] << 8) | R[o]) / Math.pow(2, 9 + res - sz); } // amostras de onda por segundo
    function es3Write(a, d) {
      var R = es3.r, old = R[a]; R[a] = d;
      if (a === 0xE1) { es3.osc = ((d >> 1) & 0x1F) + 1; return; }
      if (a >= 0xE0) return;
      var o = a & 0x1F, g = a & 0xE0, ch = es3.ch[o];
      if (g === 0x00 || g === 0x20) { ch.setRate(es3Step(o)); return; }
      if (g === 0x40) { ch.setVol(d / 255); return; }
      if (g !== 0xA0) return;
      if ((d & 1) && !(old & 1)) { ch.keyOff(); return; }
      if ((d & 1) || !(old & 1)) return;   // liga quando o bit de parada (halt) cai
      var sz = (R[0xC0 + o] >> 3) & 7, len = ES3_SIZE[sz], base = (((R[0x80 + o] << 8) | ((R[0xC0 + o] & 0x40) ? 0x10000 : 0)) & ES3_WMASK[sz]);
      var mode = (d >> 1) & 3, rt = es3Step(o);
      if (rt <= 0) return;
      var s = pcmSample('ES5503', base + ':' + len + ':' + (mode === 0 ? 'L' : 'O') + ':' + es3.ram[base] + ':' + es3.ram[base + (len >> 1)], function () {
        var out = [], i = 0;
        for (; i < len; i++) { var x = es3.ram[(base + i) & 0x1FFFF]; if (!x) break; out.push((x - 0x80) / 128); }
        return { data: new Float32Array(out), loop: mode === 0 && i === len ? 0 : -1 }; // modo livre: a onda repete
      }, rt);
      ch.keyOn(s, rt, R[0x40 + o] / 255, (d >> 4) & 1 ? 127 : 0);
    }

    // ── uPD7759 (NEC: Sega System 16/18, Mega Drive Pico...): ADPCM com tabela de samples na ROM ──
    var UPD_STEP = [
      [0, 0, 1, 2, 3, 5, 7, 10, 0, 0, -1, -2, -3, -5, -7, -10], [0, 1, 2, 3, 4, 6, 8, 13, 0, -1, -2, -3, -4, -6, -8, -13],
      [0, 1, 2, 4, 5, 7, 10, 15, 0, -1, -2, -4, -5, -7, -10, -15], [0, 1, 3, 4, 6, 9, 13, 19, 0, -1, -3, -4, -6, -9, -13, -19],
      [0, 2, 3, 5, 8, 11, 15, 23, 0, -2, -3, -5, -8, -11, -15, -23], [0, 2, 4, 7, 10, 14, 19, 29, 0, -2, -4, -7, -10, -14, -19, -29],
      [0, 3, 5, 8, 12, 16, 22, 33, 0, -3, -5, -8, -12, -16, -22, -33], [1, 4, 7, 10, 15, 20, 29, 43, -1, -4, -7, -10, -15, -20, -29, -43],
      [1, 4, 8, 13, 18, 25, 35, 53, -1, -4, -8, -13, -18, -25, -35, -53], [1, 6, 10, 16, 22, 31, 43, 64, -1, -6, -10, -16, -22, -31, -43, -64],
      [2, 7, 12, 19, 27, 37, 51, 76, -2, -7, -12, -19, -27, -37, -51, -76], [2, 9, 16, 24, 34, 46, 64, 96, -2, -9, -16, -24, -34, -46, -64, -96],
      [3, 11, 19, 29, 41, 57, 79, 117, -3, -11, -19, -29, -41, -57, -79, -117], [4, 13, 24, 36, 50, 69, 96, 143, -4, -13, -24, -36, -50, -69, -96, -143],
      [4, 16, 29, 44, 62, 85, 118, 175, -4, -16, -29, -44, -62, -85, -118, -175], [6, 20, 36, 54, 76, 104, 144, 214, -6, -20, -36, -54, -76, -104, -144, -214]];
    var UPD_STATE = [-1, -1, 0, 0, 1, 2, 2, 3, -1, -1, 0, 0, 1, 2, 2, 3];
    // decodifica um sample a partir dos blocos (cabeçalho: silêncio / 256 nibbles / n nibbles / repetição); taxa de saída = clock / 4
    function updDecode(rd) {
      var out = [], smp = 0, st = 0, rep = 0, repAt = 0, pos = 0, firstValid = false, guard = 0;
      function nib(n, rate) { smp += UPD_STEP[st][n]; st += UPD_STATE[n]; if (st < 0) st = 0; else if (st > 15) st = 15; for (var k = 0; k < rate; k++) out.push(Math.max(-1, Math.min(1, smp / 256))); }
      while (out.length < 160000 * 3 && guard++ < 100000) {
        if (rep) { rep--; pos = repAt; }
        var h = rd(pos++); if (h == null) break;
        var kind = h & 0xC0;
        if (kind === 0x00) { if (h === 0 && firstValid) break; for (var z = 0; z < 256 * ((h & 0x3F) + 1); z++) out.push(0); smp = 0; st = 0; }
        else if (kind === 0xC0) { rep = (h & 7) + 1; repAt = pos; }
        else {
          var rate = (h & 0x3F) + 1, cnt = kind === 0x40 ? 256 : (rd(pos++) || 0) + 1;
          for (var i = 0; i < cnt; i += 2) { var by = rd(pos++); if (by == null) break; nib(by >> 4, rate); if (i + 1 < cnt) nib(by & 15, rate); }
        }
        if (h) firstValid = true;
      }
      return { data: new Float32Array(out), loop: -1 };
    }
    var upd = null;
    if (hclk(0x8C)) upd = { clock: hclk(0x8C), master: !!(u32(b, 0x8C) & 0x80000000), reset: 1, start: 1, fifo: 0, bank: 0, buf: null, until: 0, ch: pcmChanSet('uPD7759', 1, 'ADPCM') };
    function updFlush() { // modo escravo: o jogo mandou o sample byte a byte pela porta
      var B = upd.buf; upd.buf = null;
      if (!B || B.length < 8) return;
      var fp = B.length + ':'; for (var q = 5; q < Math.min(B.length, 45); q++) fp += B[q] + ',';
      var s = pcmSample('uPD7759', fp, function () { return updDecode(function (i) { return i + 5 < B.length ? B[i + 5] : null; }); }, upd.clock / 4);
      upd.ch[0].keyOn(s, upd.clock / 4, 1, 64, B.t);
    }
    function updWrite(a, d) {
      if (a === 0) { var o0 = upd.reset; upd.reset = d ? 1 : 0; if (o0 && !upd.reset) { if (upd.buf) updFlush(); upd.ch[0].keyOff(); upd.until = 0; } return; }
      if (a === 3) { upd.bank = d << 17; return; }
      if (a === 2) { upd.fifo = d; if (upd.buf) upd.buf.push(d); return; }
      if (a !== 1) return;
      var o1 = upd.start; upd.start = d ? 1 : 0;
      if (o1 || !upd.start || !upd.reset) return;
      if (!upd.master || !ROM[0x8A]) { if (upd.buf) updFlush(); upd.buf = []; upd.buf.t = t; return; }
      if (t < upd.until) return;                 // ainda tocando: o chip ignora
      var mem = ROM[0x8A], bs = upd.bank, req = upd.fifo;
      function rb(i) { var x = bs + i; return x < mem.length ? mem[x] : null; }
      if (req > rb(0)) return;
      var off = ((rb(req * 2 + 5) << 9) | (rb(req * 2 + 6) << 1)) + 1;
      var s = pcmSample('uPD7759', bs + ':' + req, function () { return updDecode(function (i) { return rb((off + i) & 0x1FFFF); }); }, upd.clock / 4);
      if (!s) return;
      upd.ch[0].keyOn(s, upd.clock / 4, 1);
      upd.until = t + s.len / s.rate * 44100;
    }

    // ── SCSP (Sega Saturn / ST-V): 32 slots de PCM de 8/16 bits lidos da RAM de som ──
    var scsp = null;
    if (hclk(0xB8)) scsp = { clock: hclk(0xB8), r: new Uint16Array(0x200), on: [], ch: pcmChanSet('SCSP', 32, 'Slot') };
    function scspRate(s) { var w = scsp.r[s * 16 + 8], oc = (w >> 11) & 15; if (oc & 8) oc -= 16; return 44100 * Math.pow(2, oc) * (1024 + (w & 0x3FF)) / 1024; }
    function scspVol(s) { var R = scsp.r, tl = R[s * 16 + 6] & 0xFF, dl = (R[s * 16 + 0xB] >> 13) & 7; return dl ? Math.pow(10, -(tl * 0.375 + (7 - dl) * 6) / 20) : Math.pow(10, -tl * 0.375 / 20); }
    function scspPan(s) { var p = (scsp.r[s * 16 + 0xB] >> 8) & 31; return p < 16 ? Math.round(64 + p * 4) : Math.round(64 - (p - 16) * 4); }
    function scspWrite(a, d) {
      if (a >= 0x400) return;
      var w = a >> 1, R = scsp.r;
      R[w] = (a & 1) ? (R[w] & 0xFF00) | d : (R[w] & 0x00FF) | (d << 8);
      var s = w >> 4, k = w & 15;
      if (k === 8) { scsp.ch[s].setRate(scspRate(s)); return; }
      if (k === 6 || k === 0xB) { scsp.ch[s].setVol(scspVol(s)); return; }
      if (k !== 0 || !(R[w] & 0x1000)) return;
      R[w] &= ~0x1000;                            // KYONEX: executa o liga/desliga de todos os slots
      var mem = ROM['scsp'];
      for (var i = 0; i < 32; i++) {
        var w0 = R[i * 16], kb = !!(w0 & 0x800);
        if (!kb) { if (scsp.on[i]) scsp.ch[i].keyOff(); scsp.on[i] = false; continue; }
        if (scsp.on[i]) continue;
        scsp.on[i] = true;
        if (!mem || ((w0 >> 7) & 3)) continue;     // 1 = ruído, 2/3 = silêncio
        var b8 = !!(w0 & 0x10), sa = ((w0 & 0xF) << 16) | R[i * 16 + 1], lsa = R[i * 16 + 2], lea = R[i * 16 + 3], lp = (w0 >> 5) & 3, rt = scspRate(i);
        if (!b8) sa &= 0x7FFFE;
        if (!lea) continue;
        var smp = pcmSample('SCSP', sa + ':' + b8 + ':' + lsa + ':' + lea + ':' + lp, function () {
          var n = lea + 1, out = new Float32Array(n);
          for (var j = 0; j < n; j++) {
            var o = b8 ? sa + j : sa + j * 2;
            out[j] = b8 ? ((mem[o % mem.length] << 24) >> 24) / 128 : ((((mem[o % mem.length] << 8) | mem[(o + 1) % mem.length]) << 16) >> 16) / 32768;
          }
          return { data: out, loop: lp && lsa < lea ? lsa : -1 };
        }, rt);
        scsp.ch[i].keyOn(smp, rt, scspVol(i), scspPan(i));
      }
    }

    // ── Mikey (Atari Lynx): 4 canais; cada um é um registrador de deslocamento (LFSR) com realimentação escolhida ──
    // dependendo das realimentações, o padrão repete rápido (vira uma onda com altura) ou demora (vira ruído)
    var mikey = null;
    if (hclk(0xE4)) {
      mikey = { r: new Uint8Array(0x60), ch: [] };
      for (var mk = 0; mk < 4; mk++) { var mpc = new PSGChan(col, 'Canal ' + (mk + 1), 'Mikey', REC); mchan(mpc.id, mpc.chip, mpc.label, 'psg'); mikey.ch.push(mpc); chans.push(mpc); }
    }
    var mikeyCache = {};
    function mikeyPattern(taps, shift, integ) {   // simula o LFSR até repetir; devolve o ciclo em níveis de 0 a 1 (ou null se for longo = ruído)
      var key = taps + ':' + shift + ':' + integ;
      if (key in mikeyCache) return mikeyCache[key];
      var seen = {}, sr = shift & 0xFFF, seq = [], res = null;
      for (var i = 0; i < 4200; i++) {
        if (seen[sr] != null) { var cyc = seq.slice(seen[sr]); res = cyc.length <= 256 ? cyc : null; break; }
        seen[sr] = i;
        var x = taps & sr, par = 0; while (x) { par ^= x & 1; x >>= 1; }
        sr = ((sr << 1) & 0xFFE) | (par ^ 1); seq.push(sr & 1);
      }
      if (res && integ) { // modo integrador: cada bit sobe ou desce o nível (vira triângulo/serra)
        var acc = 0, lv = [];
        for (var r2 = 0; r2 < 2; r2++) for (var j = 0; j < res.length; j++) { acc = Math.max(-1, Math.min(1, acc + (res[j] ? 0.25 : -0.25))); if (r2) lv.push((acc + 1) / 2); }
        res = lv;
      }
      return (mikeyCache[key] = res);
    }
    function mikeyWrite(a, d) {
      if (a >= 0x60) return;
      var old = mikey.r[a]; mikey.r[a] = d;
      if (a >= 0x20 && a < 0x40 && (a & 7) === 5 && (d & 8) && !(old & 8)) mikey.ch[(a >> 3) & 3].trig = true;
    }
    function mikeyFrame() {
      for (var c = 0; c < 4; c++) {
        var o = 0x20 + c * 8, R = mikey.r, pc = mikey.ch[c];
        var vol = Math.abs((R[o] << 24) >> 24), ctl = R[o + 5], fb = R[o + 1], other = R[o + 7];
        var taps = (fb & 0x3F) | ((fb & 0xC0) << 4) | (ctl & 0x80), shift = R[o + 3] | ((other & 0xF0) << 4);
        var clk = ctl & 7, rate = clk === 7 ? 0 : 1000000 / Math.pow(2, clk) / (R[o + 4] + 1);
        pc.vol = (ctl & 8) && rate ? vol / 127 : 0;
        var pat = mikeyPattern(taps, shift || 1, (ctl & 0x20) ? 1 : 0);
        // para o Furnace (Lynx): realimentação no formato do macro de duty (bits 0-5, 7, 10, 11 + integrador) e o valor inicial do LFSR
        var mk = { duty: (taps & 0x3F) | (((taps >> 7) & 1) << 6) | (((taps >> 10) & 1) << 7) | (((taps >> 11) & 1) << 8) | ((ctl & 0x20) ? 0x200 : 0), lfsr: (shift || 1) & 0xFFF, plen: pat ? pat.length : 0 };
        if (pat && pat.length >= 2) {
          pc.freq = rate / pat.length;
          var tbl = []; for (var i = 0; i < 32; i++) tbl.push(Math.round(pat[Math.floor(i * pat.length / 32)] * 15));
          pc.wave = { k: 'wave', ck: 'mikey', tbl: tbl, duty: null, mk: mk };
        } else { pc.freq = 0; pc.wave = { k: 'noise', ck: 'mikey', nmode: 'white', nrate: Math.min(15, Math.round(Math.log2(rate + 1))), tf: rate, mk: mk }; }
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
      } else if (chipT === 0x21 && ws) { // WonderSwan: voz de PCM de 8 bits mandada em fluxo
        if (!ws.pcm) ws.pcm = pcmChanSet('WonderSwan', 1, 'PCM')[0];
        var fr = freq || 24000;
        var s2 = pcmSample('WonderSwan', 'b' + blk.id + ':' + blk.off + ':' + len, function () {
          var out = new Float32Array(len); for (var i = 0; i < len; i++) out[i] = (blk.data[blk.off + i] - 128) / 128; return { data: out, loop: -1 };
        }, fr);
        ws.pcm.keyOn(s2, fr, 1);
      }
    }

    // ── percorre os comandos ──
    var UNSUP = {};
    var p = hdrLen, t = 0, nextFrame = FRAME, end = b.length, guard = 0;
    var dacSeek = null, dacLast = -1e9, dacSeen = false, streamChip = {};
    var PCM = opts && opts.pcm ? { bank: [], blocks: [], ids: {}, streamFreq: {}, streamBank: {} } : null;
    // PWM do 32X: o som sai como um fluxo de valores (como o DAC); vira 8 bits centrado em 128 para recortar igual
    var PW = PCM && hclk(0x70) ? { v: new Uint8Array(1 << 16), t: new Float64Array(1 << 16), n: 0, seeks: [], cyc: 0, L: 0, R: 0 } : null;
    function pwmWrite(r, v) {
      if (r === 1) { PW.cyc = v; return; }
      if (r === 2) { PW.L = v; return; }
      if (r === 3) PW.R = v; else if (r === 4) PW.L = PW.R = v; else return;
      var cy = PW.cyc || 0x5C3, x = Math.max(0, Math.min(255, Math.round((PW.L + PW.R) / 2 * 256 / cy)));
      if (PW.n === PW.v.length) { var nv = new Uint8Array(PW.n * 2); nv.set(PW.v); PW.v = nv; var nt = new Float64Array(PW.n * 2); nt.set(PW.t); PW.t = nt; }
      PW.v[PW.n] = x; PW.t[PW.n] = t; PW.n++;
    }
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
      if (rf) rfCapAdv(rf, n); if (rf2) rfCapAdv(rf2, n);
      t += n;
      while (t >= nextFrame) {
        col.ft = nextFrame;
        nextFrame += FRAME;
        if (REC) for (var fk in fm) if (fm[fk].mcur.length || fm[fk].mext) fmFrame(fm[fk]);
        if (REC) for (var ok in opl) if (opl[ok].mcur.length) oplFrame(opl[ok]);
        if (nes) nesFrame();
        if (fds) fdsFrame();
        if (gb) gbFrame();
        if (huc) hucFrame();
        if (scc) sccFrame();
        if (mikey) mikeyFrame();
        if (ws) wsFrame();
        if (saa) saaFrame();
        if (pokey) pokeyFrame();
        if (x1) x1Frame();
        if (vsu) vsuFrame();
        if (vrc6) vrc6Frame();
        if (sdsp) sdspFrame();
        if (sid) sidFrame();
        if (psxs) psxFrame();
        if (ndss) ndsFrame();
        if (n163) n163Frame();
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
          if (!opl.ym2413 && clk.ym2413) { var isV7 = !!(u32(b, 0x10) & 0x80000000); opl.ym2413 = new OPLChip('opll', isV7 ? 'VRC7' : 'YM2413', clk.ym2413, isV7 ? 6 : 9); opl.ym2413.vrc7 = isV7; }
          if (opl.ym2413) oplWrite(opl.ym2413, 0, b[p + 1], b[p + 2]);
          p += 3; continue;
        }
        if (c === 0x5A) { if (opl.ym3812) oplWrite(opl.ym3812, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xAA) { if (opl.ym3812b) oplWrite(opl.ym3812b, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5B) { if (opl.ym3526) oplWrite(opl.ym3526, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5C) { if (y89b && b[p + 1] >= 0x07 && b[p + 1] <= 0x12) y89b.write(b[p + 1] - 0x07, b[p + 1] === 0x08 ? (b[p + 2] & 0x0F) | 0x80 : b[p + 2]); if (opl.y8950) oplWrite(opl.y8950, 0, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x5E || c === 0x5F) { if (opl.ymf262) oplWrite(opl.ymf262, c - 0x5E, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x50) { if (sn) snWrite(b[p + 1], sn); p += 2; continue; }
        if (c === 0x30) { if (sn2) snWrite(b[p + 1], sn2); p += 2; continue; }
        if (c === 0xA2 || c === 0xA3) { if (fm.ym2612b) opnWrite(fm.ym2612b, c - 0xA2, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xA4) { if (fm.ym2151b) opmWrite(fm.ym2151b, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xA5) { aa = b[p + 1]; if (fm.ym2203b && aa >= 0x10) opnWrite(fm.ym2203b, 0, aa, b[p + 2]); p += 3; continue; }
        if (c === 0xB7) { aa = b[p + 1]; if (oki58 && !(aa & 0x80)) oki58Write(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xB8) { aa = b[p + 1]; if (oki && !(aa & 0x80)) okiWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xC0) { if (spcm && !(b[p + 2] & 0x80)) spcmWrite(b[p + 1] | (b[p + 2] << 8), b[p + 3]); p += 4; continue; }
        if (c === 0xBA) { aa = b[p + 1]; if (k53 && !(aa & 0x80)) k53Write(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0xB0) { if (rf && !(b[p + 1] & 0x80)) rfWrite(rf, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xB1) { if (rf2 && !(b[p + 1] & 0x80)) rfWrite(rf2, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC1) { if (rf && !(b[p + 2] & 0x80)) rfMem(rf, rf.bank + ((b[p + 1] | (b[p + 2] << 8)) & 0x0FFF), b[p + 3]); p += 4; continue; }
        if (c === 0xC2) { if (rf2 && !(b[p + 2] & 0x80)) rfMem(rf2, rf2.bank + ((b[p + 1] | (b[p + 2] << 8)) & 0x0FFF), b[p + 3]); p += 4; continue; }
        if (c === 0xD6) { if (es5 && !(b[p + 1] & 0x80)) es5Write(b[p + 1], (b[p + 2] << 8) | b[p + 3]); p += 4; continue; }
        if (c === 0xD5) { if (es3 && !(b[p + 1] & 0x80)) es3Write(b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xB6) { if (upd && !(b[p + 1] & 0x80)) updWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC5) { if (scsp && !(b[p + 1] & 0x80)) scspWrite(((b[p + 1] & 0x7F) << 8) | b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0x40) { if (mikey) mikeyWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xD1) { if (opx && !(b[p + 1] & 0x80)) opxWrite(b[p + 1] & 0x7F, b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xBE) { if (es6 && !(b[p + 1] & 0x80)) es6Write(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xBC) { if (ws && !(b[p + 1] & 0x80)) wsWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC6) { if (ws && !(b[p + 1] & 0x80)) ws.ram[((b[p + 1] << 8) | b[p + 2]) & 0x3FFF] = b[p + 3]; p += 4; continue; }
        if (c === 0xBD) { if (saa) saaWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xBB) { if (pokey) pokeyWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xBF) { if (ga20 && !(b[p + 1] & 0x80)) ga20Write(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC8) { if (x1 && !(b[p + 1] & 0x80)) x1Write((b[p + 1] << 8) | b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xD4) { if (c140 && !(b[p + 1] & 0x80)) c140Write((b[p + 1] << 8) | b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xD3) { if (k539 && !(b[p + 1] & 0x80)) k539Write((b[p + 1] << 8) | b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xB5) { if (mpcm && !(b[p + 1] & 0x80)) mpcmWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xC3) { if (mpcm && !(b[p + 1] & 0x80)) { var mbo = (b[p + 2] | (b[p + 3] << 8)) << 16; if (b[p + 1] & 1) mpcm.bank0 = mbo; if (b[p + 1] & 2) mpcm.bank1 = mbo; } p += 4; continue; }
        if (c === 0xB2) { if (PW && !(b[p + 1] & 0x80)) pwmWrite(b[p + 1] >> 4, ((b[p + 1] & 15) << 8) | b[p + 2]); p += 3; continue; }
        if (c === 0xD2) { if (scc && !(b[p + 1] & 0x80)) sccWrite(b[p + 1] & 0x7F, b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0xD9) { sdspWrite(b[p + 2], b[p + 3]); p += 4; continue; }                                   // S-DSP do SNES (comando próprio, vindo de SPC)
        if (c === 0xF0) { sdspKon(b[p + 1] & 7, b[p + 2] | (b[p + 3] << 8)); p += 5; continue; }              // S-DSP: voz liga com o sample n
        if (c === 0xD7) { if (!vrc6) vrc6Init(); vrc6Write(b[p + 2], b[p + 3]); p += 4; continue; }      // VRC6 (comando próprio, vindo de NSF)
        if (c === 0xD8) { if (!n163) n163Init(); n163.ram[b[p + 2] & 127] = b[p + 3]; p += 4; continue; }
        if (c === 0xE2) { psxWrite(b[p + 1] | (b[p + 2] << 8), b[p + 3] | (b[p + 4] << 8)); p += 5; continue; }     // SPU do PlayStation (vindo de PSF)
        if (c === 0xE3) { psxKon(b[p + 1], b[p + 2] | (b[p + 3] << 8)); p += 5; continue; }
        if (c === 0xE4) { ndsWrite(b[p + 1], b[p + 2], b[p + 3] | (b[p + 4] << 8)); p += 5; continue; }        // SPU do Nintendo DS (vindo de 2SF)
        if (c === 0xE6) { NDS_K.p = (b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16) | (b[p + 4] << 24)) >>> 0; p += 5; continue; }
        if (c === 0xE7) { NDS_K.ls = b[p + 1] | (b[p + 2] << 8); p += 5; continue; }
        if (c === 0xE8) { NDS_K.ln = (b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16)) >>> 0; p += 5; continue; }
        if (c === 0xE9) { NDS_K.tm = b[p + 1] | (b[p + 2] << 8); p += 5; continue; }
        if (c === 0xE5) { ndsKon(b[p + 1], b[p + 2] | (b[p + 3] << 8)); p += 5; continue; }
        if (c === 0xEA) { GBA_V = (b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16) | (b[p + 4] << 24)) >>> 0; p += 5; continue; }   // GBA: driver MP2K (vindo de GSF)
        if (c === 0xEB) { gbaCmd(b[p + 1], b[p + 2], b[p + 3] | (b[p + 4] << 8)); p += 5; continue; }
        if (c === 0xDA) { sidWrite(b[p + 2], b[p + 3]); p += 4; continue; }                                    // SID do C64 (comando próprio, vindo de .sid) // N163 (comando próprio, vindo de NSF)
        if (c === 0xC7) { if (vsu && !(b[p + 1] & 0x80)) vsuWrite((b[p + 1] << 8) | b[p + 2], b[p + 3]); p += 4; continue; }
        if (c === 0x5D) { if (ymz) ymzWrite(b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0xD0) { var op4 = b[p + 1] & 0x7F; if (opl4 && !(b[p + 1] & 0x80)) { if (op4 < 2) oplWrite(opl.ymf278b, op4, b[p + 2], b[p + 3]); else if (op4 === 2) opl4Write(b[p + 2], b[p + 3]); } p += 4; continue; }
        if (c === 0xC4) { if (qs) qsWrite(b[p + 3], (b[p + 1] << 8) | b[p + 2]); p += 4; continue; }
        if (c === 0xE1) { if (c352) c352Write((b[p + 1] << 8) | b[p + 2], (b[p + 3] << 8) | b[p + 4]); p += 5; continue; }
        if (c === 0xB9) { aa = b[p + 1]; if (huc && !(aa & 0x80)) hucWrite(aa & 0x7F, b[p + 2]); p += 3; continue; }
        if (c === 0x52 || c === 0x53) { if (fm.ym2612) opnWrite(fm.ym2612, c - 0x52, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x54) { if (fm.ym2151) opmWrite(fm.ym2151, b[p + 1], b[p + 2]); p += 3; continue; }
        if (c === 0x55) { var aa = b[p + 1]; if (fm.ym2203) { if (aa < 0x10) ssg.ym2203.r[aa] = b[p + 2]; else opnWrite(fm.ym2203, 0, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x56 || c === 0x57) { aa = b[p + 1]; if (fm.ym2608) { if (c === 0x57 && aa < 0x10) y08b.write(aa, b[p + 2]); else if (c === 0x56 && aa === 0x10) y08Rhythm(b[p + 2]); if (c === 0x56 && aa < 0x10) ssg.ym2608.r[aa] = b[p + 2]; else if (aa >= 0x20 || c === 0x56) opnWrite(fm.ym2608, c - 0x56, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0x58 || c === 0x59) { aa = b[p + 1]; if (fm.ym2610) { if (c === 0x58 && aa >= 0x10 && aa < 0x20) y10b.write(aa - 0x10, b[p + 2]); else if (c === 0x59 && aa < 0x30) y10aWrite(aa, b[p + 2]); if (c === 0x58 && aa < 0x10) ssg.ym2610.r[aa] = b[p + 2]; else if (aa >= 0x20) opnWrite(fm.ym2610, c - 0x58, aa, b[p + 2]); } p += 3; continue; }
        if (c === 0xA0) { aa = b[p + 1]; if (aa & 0x80) { if (ay2) ayW(ay2, aa, b[p + 2]); } else if (ay) ayW(ay, aa, b[p + 2]); p += 3; continue; }
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
        if (c === 0x90) { streamChip[b[p + 1]] = (b[p + 2] & 0x80) ? -1 : b[p + 2]; p += 5; continue; } // bit 7 = 2º chip (lido na 2ª passada)
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
          var stid = b[p + 1], bid = b[p + 2] | (b[p + 3] << 8);
          if (streamChip[stid] === 2) {
            dacHit('b' + bid);
            if (DS && PCM.blocks[bid]) {
              dsFlushStream(t); DS.seeks.push(t);
              DS.st = { t0: t, f: PCM.streamFreq[stid] || 8000, off: PCM.blocks[bid].start, len: PCM.blocks[bid].len, i: 0 };
            }
            if (PCM && !PCM.ids['b' + bid]) PCM.ids['b' + bid] = { block: bid, rates: [PCM.streamFreq[stid] || 0] };
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
          if ((u32(b, p + 3) & 0x80000000) && btype >= 0x40) { p += 7 + bsz; continue; } // dados do 2º chip: ficam para a 2ª passada
          if (PCM && btype === 0x00) { PCM.blocks.push({ start: pcmLen, len: bsz }); PCM.bank.push(b.subarray(p + 7, p + 7 + bsz)); pcmLen += bsz; }
          if (btype === 0x90 && bsz > 8) { var esa = u32(b, p + 11); romPut('es' + ((esa >>> 28) & 3), Math.min(u32(b, p + 7), 0x800000), esa & 0x0FFFFFFF, b.subarray(p + 15, p + 7 + bsz)); } // ES5506: 4 bancos
          else if (btype >= 0x80 && btype < 0xC0 && bsz > 8) romPut(btype, u32(b, p + 7), u32(b, p + 11), b.subarray(p + 15, p + 7 + bsz));
          if (btype === 0xC2 && nes && bsz > 2) { if (!nesRam) nesRam = new Uint8Array(0x10000); var na = b[p + 7] | (b[p + 8] << 8); nesRam.set(b.subarray(p + 9, p + 7 + bsz).subarray(0, 0x10000 - na), na); }
          if (btype === 0xE0 && bsz > 4) romPut('scsp', 0x80000, u32(b, p + 7), b.subarray(p + 11, p + 7 + bsz));
          if (btype === 0xE1 && es3 && bsz > 4) { var e3a = u32(b, p + 7); es3.ram.set(b.subarray(p + 11, p + 7 + bsz).subarray(0, Math.max(0, 0x20000 - e3a)), e3a & 0x1FFFF); }
          var rfB = btype === 0xC0 ? rf : btype === 0xC1 ? rf2 : null;
          if (rfB && bsz > 2) { var ra = b[p + 7] | (b[p + 8] << 8); for (var ri = 0; ri < bsz - 2; ri++) rfMem(rfB, ra + ri, b[p + 9 + ri]); }
          if (btype < 0x40 && btype !== 0x00) { (STREAMBLK[btype] = STREAMBLK[btype] || []).push({ id: (STREAMBLK[btype] || []).length, data: b.subarray(p + 7, p + 7 + bsz), off: 0 }); }
          p += 7 + bsz; continue;
        }
        if (c === 0x68) {
          // copia um pedaço do banco de dados para a RAM do chip (usado pelo RF5C68 do Sega CD / System 18)
          var ct = b[p + 2], rd = b[p + 3] | (b[p + 4] << 8) | (b[p + 5] << 16), wr = b[p + 6] | (b[p + 7] << 8) | (b[p + 8] << 16), cl = b[p + 9] | (b[p + 10] << 8) | (b[p + 11] << 16);
          if (!cl) cl = 0x1000000;
          var src = STREAMBLK[ct];
          var rfC = ct === 0x01 ? rf : ct === 0x02 ? rf2 : null;
          if (rfC && src) {
            if (!src.whole || src.whole.n !== src.length) { var tot2 = 0; src.forEach(function (x) { tot2 += x.data.length; }); var wd = new Uint8Array(tot2), o2 = 0; src.forEach(function (x) { wd.set(x.data, o2); o2 += x.data.length; }); src.whole = { id: 'w', data: wd, off: 0, n: src.length }; }
            var W2 = src.whole.data;
            for (var ci = 0; ci < cl && rd + ci < W2.length; ci++) rfMem(rfC, wr + ci, W2[rd + ci]);
          }
          p += 12; continue;
        }
        if (UNSUP[c] && unsupported.indexOf(UNSUP[c]) < 0) unsupported.push(UNSUP[c]); // chip que ainda não vira timbre
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
    [rf, rf2].forEach(function (r) { if (r) for (var rc = 0; rc < 8; rc++) rfCapEnd(r, rc); });
    dacEnd();
    if (REC) {
      for (var fk2 in fm) for (var ch2 = 0; ch2 < fm[fk2].nch; ch2++) fmOff(fm[fk2], ch2);
      for (var ok2 in opl) for (var ch3 = 0; ch3 < opl[ok2].nch; ch3++) oplOff(opl[ok2], ch3);
      if (upd && upd.buf) updFlush();
      if (opx) Object.keys(opx.rec).forEach(function (k) { opxOff(opx.rec[k]); });
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
    if (sn) chips.push('SN76489'); if (sn2) chips.push('SN76489 #2'); if (nes) chips.push('NES APU'); if (fds && col.list.some(function (tt) { return tt.chip === 'NES FDS'; })) chips.push('NES FDS'); if (gb) chips.push('Game Boy');
    if (huc) chips.push('HuC6280'); if (scc) chips.push(scc.plus ? 'K052539' : 'K051649'); if (vrc6) chips.push('VRC6'); if (n163) chips.push('N163'); if (sdsp) chips.push('S-DSP'); if (sid) chips.push('SID'); if (psxs) chips.push('SPU'); if (ndss) chips.push('NDS'); if (gbas) chips.push('GBA'); if (vsu) chips.push('VSU'); if (ws) chips.push('WonderSwan'); if (mikey) chips.push('Mikey'); if (opx && Object.keys(opx.rec).length) chips.push('YMF271'); if (opx && Object.keys(opx.pcm).length) chips.push('YMF271'); if (saa) chips.push('SAA1099'); if (pokey) chips.push('Pokey'); if (x1) chips.push('X1-010');
    [[oki, 'OKIM6295'], [oki58, 'OKIM6258'], [spcm, 'SegaPCM'], [k53, 'K053260'], [rf, 'RF5C68'], [rf2, 'RF5C164'], [c352, 'C352'], [qs, 'QSound'], [ymz, 'YMZ280B'], [opl4, 'YMF278B'], [ga20, 'GA20'], [x1, 'X1-010'], [c140, c140 && c140.type === 2 ? 'C219' : 'C140'], [k539, 'K054539'], [mpcm, 'MultiPCM'], [es6, 'ES5506'], [es5, 'ES5505'], [es3, 'ES5503'], [upd, 'uPD7759'], [scsp, 'SCSP']].forEach(function (x) {
      if (x[0] && x[0].ch.some(function (c) { return c.seen || c.nDrum || c.nTone; })) chips.push(x[1]);
    }); if (ay) chips.push(ayName); if (ay2) chips.push(ayName + ' #2');
    chips = chips.filter(function (x, i) { return chips.indexOf(x) === i; });
    // chips "raros" só entram se tocaram de fato (cabeçalhos antigos às vezes trazem lixo nesses campos)
    var RARE = ['WonderSwan', 'SAA1099', 'Pokey', 'Mikey', 'K051649', 'K052539', 'VSU', 'X1-010'];
    chips = chips.filter(function (x) { return RARE.indexOf(x) < 0 || col.list.some(function (tt) { return tt.chip === x; }); });
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
      dacTimbres(res);
      pwmTimbres(res);
      res.rateHz = ver >= 0x101 ? u32(b, 0x24) : 0;
      res.clocks = clk;
    }
    // samples do DAC do YM2612 (Mega Drive) viram timbres de sample, como os dos outros chips
    function dacTimbres(res) {
      var hits = res.dacHits && res.dacHits.length ? res.dacHits : (REC || []).filter(function (e) { return e.k === 'hit'; });
      segTimbres(res, hits, res.pcm, 'YM2612', 'DAC (samples)');
    }
    // pedaços recortados de um fluxo (DAC do YM2612, PWM do 32X) → timbres de sample
    function segTimbres(res, hits, map, chip, label) {
      var uses = {}; hits.forEach(function (h) { if (map[h.id]) uses[h.id] = (uses[h.id] || 0) + 1; });
      var ids = Object.keys(uses).sort(function (a, b2) { return uses[b2] - uses[a]; }).slice(0, 40);
      var n0 = res.timbres.filter(function (x) { return x.chip === chip; }).length, byId = {};
      ids.forEach(function (id) {
        var sp = map[id], u = sp.data, f = new Float32Array(u.length);
        for (var i = 0; i < u.length; i++) f[i] = (u[i] - 128) / 128;
        var s = storeSmp({ data: f, loop: -1 }, sp.rate || 8000); if (!s) return;
        var drum = s.base == null, ch = {}; ch[label] = uses[id];
        var tb = { type: 'pcm', pcmId: s.id, rate: s.rate, len: s.len, loop: s.loop, base: s.base, drum: s.drum, tune: 0,
          chip: chip, count: uses[id], chans: ch, chanList: [label], lo: drum ? 999 : s.base, hi: drum ? -999 : s.base, median: drum ? 60 : s.base, n: ++n0, dac: id };
        tb.role = drum ? 'Percussão' : roleOf(tb);
        res.timbres.push(tb); byId[id] = tb;
      });
      if (ids.length && res.chips.indexOf(chip) < 0) res.chips.push(chip);
      return byId;
    }
    function pwmTimbres(res) {
      if (!PW || !PW.n) return;
      var cut = dacSegments(PW), map = {};
      cut.list.forEach(function (x) { map[x.id] = x; });
      var byId = segTimbres(res, cut.hits, map, '32X PWM', 'PWM');
      // notas do PWM (para o MIDI e o Furnace): cada batida recortada vira uma nota do sample
      if (res.midi) {
        var id = '32X PWM · PWM', n = 0;
        cut.hits.forEach(function (h) {
          var tb = byId[h.id]; if (!tb) return; n++;
          var ev = { c: id, t: h.t, k: 'on', n: tb.base != null ? tb.base : tb.drum, v: 1, pan: 64, tb: tb };
          if (tb.base == null) ev.noise = { ck: 'drum', d: tb.drum };
          res.midi.events.push(ev);
        });
        if (n) { res.midi.events.sort(function (a, b2) { return a.t - b2.t; }); res.midi.chans.push({ id: id, chip: '32X PWM', label: 'PWM', kind: 'pcm', notes: n }); }
      }
    }
    // tamanho e ponto de volta (loop) da música: o piano roll e o conversor usam
    res.loopSamples = u32(b, 0x20); res.totalSamples = u32(b, 0x18);
    return res;
  }


  // ───────────── segunda cópia de um chip (placas com dois chips iguais) ─────────────
  // A 1ª leitura cuida do 1º chip (e dos pares que já têm suporte direto: YM2612, YM2151, YM2203, YM3812, SN76489, AY).
  // Para os outros, uma 2ª leitura usa uma cópia do VGM em que os comandos do 2º chip viram comandos "do 1º"
  // e os do 1º viram comandos vazios; os timbres e notas dela entram com " #2" no nome do chip.
  var DUAL2 = [ // [campo do clock no cabeçalho, chave, nomes dos chips nos timbres]
    [0x10, 'ym2413', ['YM2413']], [0x38, 'segapcm', ['SegaPCM']], [0x40, 'rf5c68', ['RF5C68']], [0x48, 'ym2608', ['YM2608', 'YM2608 SSG']],
    [0x4C, 'ym2610', ['YM2610', 'YM2610 SSG']], [0x54, 'ym3526', ['YM3526']], [0x58, 'y8950', ['Y8950']], [0x5C, 'ymf262', ['YMF262']],
    [0x60, 'ymf278b', ['YMF278B']], [0x64, 'ymf271', ['YMF271']], [0x68, 'ymz280b', ['YMZ280B']], [0x6C, 'rf5c164', ['RF5C164']], [0x70, 'pwm', ['32X PWM']],
    [0x80, 'gb', ['Game Boy']], [0x84, 'nes', ['NES APU', 'NES FDS']], [0x88, 'multipcm', ['MultiPCM']], [0x8C, 'upd7759', ['uPD7759']],
    [0x90, 'okim6258', ['OKIM6258']], [0x98, 'okim6295', ['OKIM6295']], [0x9C, 'k051649', ['K051649', 'K052539']], [0xA0, 'k054539', ['K054539']],
    [0xA4, 'huc6280', ['HuC6280']], [0xA8, 'c140', ['C140', 'C219']], [0xAC, 'k053260', ['K053260']], [0xB0, 'pokey', ['Pokey']], [0xB4, 'qsound', ['QSound']],
    [0xB8, 'scsp', ['SCSP']], [0xC0, 'ws', ['WonderSwan']], [0xC4, 'vsu', ['VSU']], [0xC8, 'saa', ['SAA1099']], [0xCC, 'es5503', ['ES5503']],
    [0xD0, 'es5506', ['ES5506', 'ES5505']], [0xD8, 'x1', ['X1-010']], [0xDC, 'c352', ['C352']], [0xE0, 'ga20', ['GA20']]];
  // comando → [chave do chip, posição do byte que leva o bit do 2º chip (0 = o próprio comando muda), novo comando]
  var CMD2 = {};
  [[0x51, 'ym2413'], [0x56, 'ym2608'], [0x57, 'ym2608'], [0x58, 'ym2610'], [0x59, 'ym2610'], [0x5B, 'ym3526'], [0x5C, 'y8950'], [0x5D, 'ymz280b'], [0x5E, 'ymf262'], [0x5F, 'ymf262']]
    .forEach(function (x) { CMD2[x[0]] = [x[1], -1]; CMD2[x[0] + 0x50] = [x[1], 0, x[0]]; });
  [[0xB0, 'rf5c68'], [0xB1, 'rf5c164'], [0xB2, 'pwm'], [0xB3, 'gb'], [0xB4, 'nes'], [0xB5, 'multipcm'], [0xB6, 'upd7759'], [0xB7, 'okim6258'], [0xB8, 'okim6295'],
   [0xB9, 'huc6280'], [0xBA, 'k053260'], [0xBB, 'pokey'], [0xBC, 'ws'], [0xBD, 'saa'], [0xBE, 'es5506'], [0xBF, 'ga20'],
   [0xC3, 'multipcm'], [0xC5, 'scsp'], [0xC6, 'ws'], [0xC7, 'vsu'], [0xC8, 'x1'],
   [0xD0, 'ymf278b'], [0xD1, 'ymf271'], [0xD2, 'k051649'], [0xD3, 'k054539'], [0xD4, 'c140'], [0xD5, 'es5503'], [0xD6, 'es5506'], [0xE1, 'c352']]
    .forEach(function (x) { CMD2[x[0]] = [x[1], 1]; });
  [[0xC0, 'segapcm'], [0xC1, 'rf5c68'], [0xC2, 'rf5c164']].forEach(function (x) { CMD2[x[0]] = [x[1], 2]; }); // endereço de 16 bits (byte de cima)
  var STREAM2 = { 0x00: 'sn', 0x02: 'ym2612', 0x05: 'rf5c68', 0x10: 'rf5c164', 0x14: 'nes', 0x17: 'okim6258', 0x18: 'okim6295', 0x21: 'ws' };
  function cmdLen(b, p) {
    var c = b[p];
    if (c === 0x67) return 7 + (u32(b, p + 3) & 0x7FFFFFFF);
    if (c === 0x68) return 12;
    if (c === 0x61) return 3; if (c === 0x62 || c === 0x63 || c === 0x66) return 1;
    if (c >= 0x70 && c <= 0x8F) return 1;
    if (c >= 0x90 && c <= 0x95) return [5, 5, 6, 11, 2, 5][c - 0x90];
    if (c >= 0x30 && c <= 0x3F) return 2; if (c === 0x4F || c === 0x50) return 2;
    if (c >= 0x40 && c <= 0x5F) return 3; if (c >= 0xA0 && c <= 0xBF) return 3;
    if (c >= 0xC0 && c <= 0xDF) return 4; if (c >= 0xE0) return 5;
    return 1;
  }
  function second(b, keys, start, end) {
    var o = new Uint8Array(b), p = start;
    var NOP = { 2: 0x31, 3: 0x41, 4: 0xC9, 5: 0xE2 };
    while (p < end) {
      var c = o[p], n = cmdLen(o, p);
      if (c === 0x66) break;
      if (c === 0x67) {
        var sz = u32(o, p + 3), bt = o[p + 2];
        if (bt >= 0x40) { if (sz & 0x80000000) o[p + 6] &= 0x7F; else o[p + 2] = 0x7F; } // só os dados do 2º chip
      } else if (c === 0x90) {
        var tt = o[p + 2]; if (keys[STREAM2[tt & 0x7F]]) o[p + 2] = (tt & 0x80) ? tt & 0x7F : 0x7F;
      } else if (CMD2[c] && keys[CMD2[c][0]]) {
        var m = CMD2[c];
        if (m[1] === -1) { o[p] = NOP[n]; o[p + 1] = 0; o[p + 2] = 0; }      // comando do 1º chip: vira vazio
        else if (m[1] === 0) o[p] = m[2];                                     // comando do 2º chip (0xA_): vira o do 1º
        else if (o[p + m[1]] & 0x80) o[p + m[1]] &= 0x7F;                      // bit 7 marca o 2º chip: tira o bit
        else { for (var k = 1; k < n; k++) o[p + k] = 0; o[p] = NOP[n]; }
      }
      p += n;
    }
    return o;
  }
  // outros formatos (MOD, S3M, XM, IT, MIDI, S98): fmt-import.js
  function storeExt(data, rate, loop) {
    var d = data, r = rate, lp = loop;
    if (r > 32000) { var f = Math.ceil(r / 32000), nd = new Float32Array(Math.floor(d.length / f)); for (var i = 0; i < nd.length; i++) nd[i] = d[i * f]; d = nd; r /= f; lp = lp >= 0 ? Math.floor(lp / f) : -1; }
    if (d.length > r * 180) d = d.subarray(0, Math.floor(r * 180));
    var id = 's' + (PCMSTORE.n++); PCMSTORE.map[id] = d;
    return { id: id, rate: r, len: d.length, loop: lp >= 0 && lp < d.length ? lp : -1 };
  }
  var FMT = typeof RGFMT_MAKE === 'function' ? RGFMT_MAKE({ Collector: Collector, roleOf: roleOf, store: storeExt }) : null;
  function parse(buf, opts) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (FMT && String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'Vgm ') {
      var rk = FMT.ripKind(b);
      if (rk) {
        // NSF/GBS/KSS/SAP/HES/AY/SPC: o registro das escritas (feito pelo rg-rip.wasm) vira VGM
        if (!opts || !opts.rip) throw new Error('rip');
        var cr = FMT.ripToVGM(rk, b, opts.rip), o2 = {}; for (var ok in opts) if (ok !== 'rip') o2[ok] = opts[ok];
        o2.spc = cr.spc || null; o2.psx = cr.psx || null; o2.nds = cr.nds || null; o2.gba = cr.gba || null; if (opts.rip.clock) o2.sidClock = opts.rip.clock;
        var rr = parse(cr.vgm, o2);
        rr.format = rk.toUpperCase();
        ['title', 'game', 'author', 'system'].forEach(function (k) { if (cr.info[k]) rr.info[k] = cr.info[k]; });
        if (cr.rename) Object.keys(cr.rename).forEach(function (from) {
          var to = cr.rename[from], fix = function (x) { return typeof x === 'string' && x.indexOf(from) === 0 ? to + x.slice(from.length) : x; };
          rr.chips = rr.chips.map(fix); rr.timbres.forEach(function (tt) { tt.chip = fix(tt.chip); });
          if (rr.midi) { rr.midi.chans.forEach(function (m) { m.chip = fix(m.chip); m.id = fix(m.id); }); rr.midi.events.forEach(function (e) { e.c = fix(e.c); }); }
        });
        return rr;
      }
      var fk = FMT.detect(b, opts && opts.name);
      if (fk === 's98') {
        var cv = FMT.s98toVGM(b), rs = parse(cv.vgm, opts);
        rs.format = 'S98';
        if (cv.info.title) rs.info.title = cv.info.title; if (cv.info.artist) rs.info.author = cv.info.artist; if (cv.info.game) rs.info.game = cv.info.game; if (cv.info.system) rs.info.system = cv.info.system;
        return rs;
      }
      if (fk) { var rf = FMT.parse(b, opts); if (rf) return rf; }
    }
    var res = parse1(b, opts);
    var ver = u32(b, 8), hl = ver >= 0x150 ? 0x34 + u32(b, 0x34) : 0x40; if (ver >= 0x150 && !u32(b, 0x34)) hl = 0x40;
    // chips do cabeçalho (na ordem do formato) e ganho de volume do arquivo: o conversor do Furnace usa para acertar o volume como o libvgm
    var HOFF = [0x0C, 0x10, 0x2C, 0x30, 0x38, 0x40, 0x44, 0x48, 0x4C, 0x50, 0x54, 0x58, 0x5C, 0x60, 0x64, 0x68, 0x6C, 0x70, 0x74, 0x80, 0x84, 0x88, 0x8C, 0x90, 0x98, 0x9C, 0xA0, 0xA4, 0xA8, 0xAC, 0xB0, 0xB4, 0xB8, 0xC0, 0xC4, 0xC8, 0xCC, 0xD0, 0xD8, 0xDC, 0xE0, 0xE4];
    var hch = []; HOFF.forEach(function (o, i) { if (o + 4 <= hl && o + 4 <= b.length) { var v = u32(b, o); if (v & 0x3FFFFFFF) hch.push([i, (v & 0x40000000) ? 2 : 1]); } });
    var vg = hl > 0x7C && ver >= 0x160 ? b[0x7C] : 0; vg = vg <= 0xC0 ? vg : vg === 0xC1 ? -0x40 : vg - 0x100;
    res.hdr = { ch: hch, vg: vg };
    var keys = {}, names = {}, any = false;
    DUAL2.forEach(function (d) { if (d[0] + 4 <= hl && (u32(b, d[0]) & 0x40000000) && (u32(b, d[0]) & 0x3FFFFFFF)) { keys[d[1]] = true; d[2].forEach(function (nm) { names[nm] = true; }); any = true; } });
    if (!any) return res;
    var start = hl, end = b.length, eof = u32(b, 4) + 4; if (eof > 4 && eof < end) end = eof;
    var r2 = parse1(second(b, keys, start, end), { events: opts && opts.events });
    var ren = {};
    r2.timbres.forEach(function (tt) { if (names[tt.chip]) { tt.chip += ' #2'; res.timbres.push(tt); } });
    r2.chips.forEach(function (c) { if (names[c] && res.chips.indexOf(c + ' #2') < 0) res.chips.push(c + ' #2'); });
    if (res.midi && r2.midi) {
      r2.midi.chans.forEach(function (m) { if (!names[m.chip]) return; var nid = m.id.replace(m.chip, m.chip + ' #2'); ren[m.id] = nid; m.id = nid; m.chip += ' #2'; res.midi.chans.push(m); });
      r2.midi.events.forEach(function (e) { if (ren[e.c]) { e.c = ren[e.c]; res.midi.events.push(e); } });
      res.midi.events.sort(function (x, y) { return x.t - y.t; });
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

  return { parse: parse, inflate: inflate, CARRIERS: CARRIERS, ripKind: function (b) { return FMT ? FMT.ripKind(b) : null; }, fmt: FMT, pcmData: function (id) { return PCMSTORE.map[id] || null; },
    detect: function (b, name) { b = b instanceof Uint8Array ? b : new Uint8Array(b); if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'Vgm ') return 'vgm'; return FMT ? FMT.detect(b, name) : null; } };
})();
if (typeof module !== 'undefined') module.exports = RGVGM;
