// ===== Sintetizador do Estúdio (roda no AudioWorklet) =====
// FM de 4 operadores no estilo OPN/OPM (YM2612, YM2151...) e PSG (pulso, triângulo, onda, ruído).
var SINLEN = 4096, SIN = new Float32Array(SINLEN);
for (var i = 0; i < SINLEN; i++) SIN[i] = Math.sin(2 * Math.PI * i / SINLEN);
var ATT = new Float32Array(1024);                       // atenuação (passos de 0,094 dB) → amplitude
for (i = 0; i < 1024; i++) ATT[i] = i >= 1023 ? 0 : Math.pow(2, -i / 64);
var EG_INC = [
  [0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 1, 1, 0, 1], [0, 1, 1, 1, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 2, 1, 1, 1, 2], [1, 2, 1, 2, 1, 2, 1, 2], [1, 2, 2, 2, 1, 2, 2, 2],
  [2, 2, 2, 2, 2, 2, 2, 2], [2, 2, 2, 4, 2, 2, 2, 4], [2, 4, 2, 4, 2, 4, 2, 4], [2, 4, 4, 4, 2, 4, 4, 4],
  [4, 4, 4, 4, 4, 4, 4, 4], [4, 4, 4, 8, 4, 4, 4, 8], [4, 8, 4, 8, 4, 8, 4, 8], [4, 8, 8, 8, 4, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8]];
var DT_TAB = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8],
  [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 16, 16],
  [2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 22, 22, 22]];
var FKTAB = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3];
var CAR = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
var OPN_LFO_HZ = [3.98, 5.56, 6.02, 6.37, 6.88, 9.63, 48.1, 72.2];
var OPN_AM_DB = [0, 1.4, 5.9, 11.8], OPN_PM_C = [0, 3.4, 6.7, 10, 14, 20, 40, 80];
var OPM_AM_DB = [0, 2.8, 5.6, 11.25], OPM_PM_C = [0, 5, 10, 20, 50, 100, 400, 700];
var DT2 = [1, 1.4142, 1.5698, 1.7319];
var DUTY = [0.125, 0.25, 0.5, 0.75];
var DUTY8930 = [0.03125, 0.0625, 0.125, 0.25, 0.5, 0.75, 0.875, 0.9375, 0.96875];
var RR_MIN = 8;
var NES_TRI = []; for (i = 15; i >= 0; i--) NES_TRI.push(i); for (i = 0; i < 16; i++) NES_TRI.push(i);

function kcodeOf(p, f, note) {
  if (p.fmKind === 'opm') {
    var m = Math.round(note - 12 * Math.log2(p.clock / 3579545)) - 13;
    var o = Math.floor(m / 12), idx = ((m % 12) + 12) % 12;
    return Math.max(0, Math.min(31, o * 4 + Math.floor(idx / 3)));
  }
  for (var b = 0; b < 8; b++) {
    var fn = f * 1048576 / (p.rate * Math.pow(2, b - 1));
    if (fn < 2048) return b * 4 + FKTAB[Math.max(0, Math.min(15, fn >> 7))];
  }
  return 31;
}

// ── FM de 2 (ou 4) operadores da família OPL (YM3526, YM3812, Y8950, YMF262) e OPLL (YM2413) ──
var OPL_MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
var OPL_CAR = [[1], [0, 1]], OPL_CAR4 = [[3], [0, 3], [1, 3], [0, 2, 3]];
var KSL_DB = [0, 3, 1.5, 6];
function oplWave(ws, x) { // formas de onda do OPL2/OPL3 (x de 0 a 1)
  x -= Math.floor(x);
  switch (ws) {
    case 0: return SIN[(x * SINLEN) | 0];
    case 1: return x < 0.5 ? SIN[(x * SINLEN) | 0] : 0;                                  // meio seno
    case 2: return Math.abs(SIN[(x * SINLEN) | 0]);                                       // seno retificado
    case 3: return (x < 0.25 || (x >= 0.5 && x < 0.75)) ? Math.abs(SIN[(x * SINLEN) | 0]) : 0; // "quarto" de seno
    case 4: return x < 0.5 ? SIN[((x * 2) * SINLEN) | 0] : 0;                             // seno alternado (OPL3)
    case 5: return x < 0.5 ? Math.abs(SIN[((x * 2) * SINLEN) | 0]) : 0;                   // "camelo" (OPL3)
    case 6: return x < 0.5 ? 1 : -1;                                                      // quadrada (OPL3)
    default: return x < 0.5 ? Math.pow(2, -x * 16) : -Math.pow(2, -(1 - x) * 16);         // quadrada derivada (OPL3)
  }
}
function oplKc(p, f) { // bloco/oitava do OPL para a nota (usado pelo KSR)
  var bits = p.oplKind === 'opll' ? 19 : 20, top = p.oplKind === 'opll' ? 512 : 1024;
  for (var b = 0; b < 8; b++) { var fn = f * Math.pow(2, bits) / (p.rate * Math.pow(2, b)); if (fn < top) return b * 2 + (fn >= top / 2 ? 1 : 0); }
  return 15;
}


// ── FM do YMF271 (OPX): 1 a 4 operadores com ligação por tabela (16 algoritmos de 4 op, 8 de 3 op, 4 de 2 op) ──
// m[p] = máscara dos operadores que modulam p; car = máscara das portadoras; fb = posição que alimenta a realimentação do 1º
var OPX_ALG4 = [[[0, 4, 1, 2], 8, 0], [[0, 4, 1, 2], 8, 2], [[0, 5, 0, 2], 8, 0], [[0, 4, 0, 3], 8, 0], [[0, 0, 1, 6], 8, 0], [[0, 0, 1, 6], 8, 2],
  [[0, 0, 1, 2], 12, 0], [[0, 0, 1, 2], 12, 2], [[0, 4, 0, 2], 9, 0], [[0, 0, 0, 6], 9, 0], [[0, 0, 1, 0], 14, 0], [[0, 0, 1, 0], 14, 2],
  [[0, 1, 1, 1], 14, 0], [[0, 4, 0, 0], 11, 0], [[0, 0, 1, 2], 13, 0], [[0, 0, 0, 0], 15, 0]];
var OPX_ALG3 = [[[0, 4, 1], 2, 0], [[0, 4, 1], 2, 2], [[0, 5, 0], 2, 0], [[0, 4, 0], 3, 0], [[0, 0, 1], 6, 0], [[0, 0, 1], 6, 2], [[0, 0, 0], 7, 0], [[0, 0, 1], 7, 0]];
var OPX_ALG2 = [[[0, 1], 2, 0], [[0, 1], 2, 1], [[0, 0], 3, 0], [[0, 1], 3, 0]];
var OPX_MODLV = [128, 64, 32, 16, 8, 256, 512, 1024];
var OPX_RKS = [[0,0,0,0,0,2,4,8],[0,0,0,0,1,3,5,9],[0,0,0,1,2,4,6,10],[0,0,0,1,3,5,7,11],[0,0,1,2,4,6,8,12],[0,0,1,2,5,7,9,13],[0,0,1,3,6,8,10,14],[0,0,1,3,7,9,11,15],
  [0,1,2,4,8,10,12,16],[0,1,2,4,9,11,13,17],[0,1,2,5,10,12,14,18],[0,1,2,5,11,13,15,19],[0,1,3,6,12,14,16,20],[0,1,3,6,13,15,17,21],[0,1,3,7,14,16,18,22],[0,1,3,7,15,17,19,23],
  [0,2,4,8,16,18,20,24],[0,2,4,8,17,19,21,25],[0,2,4,9,18,20,22,26],[0,2,4,9,19,21,23,27],[0,2,5,10,20,22,24,28],[0,2,5,10,21,23,25,29],[0,2,5,11,22,24,26,30],[0,2,5,11,23,25,27,31],
  [0,3,6,12,24,26,28,31],[0,3,6,12,25,27,29,31],[0,3,6,13,26,28,30,31],[0,3,6,13,27,29,31,31],[0,3,7,14,28,30,31,31],[0,3,7,14,29,31,31,31],[0,3,7,15,30,31,31,31],[0,3,7,15,31,31,31,31]];
function opxAlg(p) { var n = p.ops.length; return n === 4 ? OPX_ALG4[p.alg & 15] : n === 3 ? OPX_ALG3[p.alg & 7] : n === 2 ? OPX_ALG2[p.alg & 3] : [[0], 1, 0]; }
function opxCar(p) { var a = opxAlg(p), c = []; for (var i = 0; i < p.ops.length; i++) if (a[1] & (1 << i)) c.push(i); return c; }
function opxWave(ws, x) { // formas de onda do OPX (x de 0 a 1)
  x -= Math.floor(x);
  var sv = SIN[(x * SINLEN) | 0];
  switch (ws) {
    case 1: return sv * Math.abs(sv);                                   // ±seno²
    case 2: return Math.abs(sv);                                        // seno retificado
    case 3: return x < 0.5 ? sv : 0;                                    // meio seno
    case 4: return x < 0.5 ? SIN[((x * 2) * SINLEN) | 0] : 0;           // seno dobrado na 1ª metade
    case 5: return x < 0.5 ? Math.abs(SIN[((x * 2) * SINLEN) | 0]) : 0; // idem, retificado
    case 6: return 0.5;                                                 // nível fixo (usado como modulador)
    default: return sv;
  }
}
function opxKc(f, fs) {
  for (var b = -8; b < 8; b++) { var fn = f * 32768 / (2 * fs * Math.pow(2, b - 7)); if (fn < 4096) return Math.max(0, b) * 4 + (fn < 0x780 ? 0 : fn < 0x900 ? 1 : fn < 0xA80 ? 2 : 3); }
  return 31;
}

function Voice() { this.active = false; }

class EstudioSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = []; for (var i = 0; i < 16; i++) this.voices.push(new Voice());
    this.patch = null; this.bend = 0; this.sus = false; this.mod = 0; this.vol = 0.8; this.hold = true; this.transp = 0;
    this.lfoPh = 0; this.vibPh = 0; this.age = 0; this.dc = 0; this.dcPrev = 0;
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(d) {
    if (d.t === 'patch') {
      this.patch = d.p;
      // editor de timbres: as notas que já estão soando passam a usar os valores novos na hora
      if (d.live) for (var i = 0; i < 16; i++) { var v = this.voices[i]; if (v.active && v.p.type === d.p.type && ((d.p.type !== 'opl' && d.p.type !== 'opx') || v.p.ops.length === d.p.ops.length)) this.refresh(v, d.p); }
    }
    else if (d.t === 'on') this.noteOn(d.n, d.v);
    else if (d.t === 'off') this.noteOff(d.n);
    else if (d.t === 'bend') { this.bend = d.v; this.retune(); }
    else if (d.t === 'sus') { this.sus = d.on; if (!d.on) this.voices.forEach(v => { if (v.active && v.susHeld) { v.susHeld = false; this.release(v); } }); }
    else if (d.t === 'mod') this.mod = d.v;
    else if (d.t === 'vol') this.vol = d.v;
    else if (d.t === 'hold') this.hold = d.on;
    else if (d.t === 'transp') { this.transp = d.v; this.retune(); }
    else if (d.t === 'panic') this.voices.forEach(v => v.active = false);
  }
  refresh(v, p) {
    v.p = p;
    if (p.type === 'opl') { this.setFreq(v); this.oplParams(v); return; }
    if (p.type === 'pcm') { this.setFreq(v); return; }
    if (p.type === 'opx') { this.setFreq(v); this.opxParams(v); return; }
    if (p.type === 'fm') {
      this.setFreq(v);
      for (var k = 0; k < 4; k++) {
        var op = p.ops[k], ks = v.kc >> (3 - op.ks);
        var r = function (raw) { return raw === 0 ? 0 : Math.min(63, raw + ks); };
        v.rates[k] = [r(op.ar * 2), r(op.d1r * 2), r(op.d2r * 2), r(op.rr * 4 + 2)];
        v.sl[k] = op.sl === 15 ? 31 * 32 : op.sl * 32;
      }
      v.car = CAR[p.alg];
      var velAtt = vToAtt(v.vel);
      v.tl = p.ops.map(function (op, k) { return (op.tl << 3) + (v.car.indexOf(k) >= 0 ? velAtt : 0); });
      v.norm = carNorm(p, v.car);
      if (v.releasing) for (k = 0; k < 4; k++) v.rates[k][3] = Math.max(v.rates[k][3], RR_MIN * 4 + 2);
    } else {
      this.setFreq(v);
      var env = p.env;
      if (this.hold && p.wave !== 'noise') { var n = env.length; while (n > 1 && env[n - 1] <= 0.001) n--; env = env.slice(0, n); }
      v.envA = env; v.dutyA = p.duty;
    }
  }
  freqOf(n) { return 440 * Math.pow(2, (n - 69 + this.bend) / 12); }
  noteOn(n, vel) {
    var p = this.patch; if (!p) return;
    // mesma nota já tocando: reaproveita a voz (como o chip faria)
    var v = null, i;
    for (i = 0; i < 16; i++) if (this.voices[i].active && this.voices[i].note === n) { v = this.voices[i]; break; }
    if (!v) for (i = 0; i < 16; i++) if (!this.voices[i].active) { v = this.voices[i]; break; }
    if (!v) { v = this.voices[0]; for (i = 1; i < 16; i++) if (this.voices[i].age < v.age) v = this.voices[i]; }
    v.active = true; v.note = n; v.held = true; v.susHeld = false; v.age = ++this.age; v.p = p;
    v.vel = vel; v.gain = Math.pow(vel / 127, 1.6);
    v.rel = 1; v.releasing = false;
    if (p.type === 'fm') this.initFM(v); else if (p.type === 'opx') this.initOPX(v); else if (p.type === 'opl') this.initOPL(v); else if (p.type === 'pcm') this.initPCM(v); else this.initPSG(v);
  }
  // ── sample do jogo (chips PCM/ADPCM): toca na velocidade da nota; bateria toca sempre na altura original ──
  initPCM(v) { v.pos = 0; this.setFreq(v); }
  runPCM(v, vib) {
    var p = v.p, d = p.data; if (!d || !d.length) { v.active = false; return 0; }
    if (v.releasing) { v.rel -= 1 / (0.05 * sampleRate); if (v.rel <= 0) { v.active = false; return 0; } }
    var i = v.pos | 0, f = v.pos - i;
    if (i >= d.length - 1) {
      if (p.loop >= 0 && p.loop < d.length - 1) { v.pos = p.loop + (v.pos - (d.length - 1)); i = v.pos | 0; f = v.pos - i; }
      else { v.active = false; return 0; }
    }
    var x = d[i] + (d[i + 1] - d[i]) * f;
    v.pos += v.inc * vib;
    return x * v.gain * v.rel * 0.5;
  }
  noteOff(n) {
    for (var i = 0; i < 16; i++) { var v = this.voices[i]; if (v.active && v.note === n && v.held) { v.held = false; if (this.sus) v.susHeld = true; else this.release(v); } }
  }
  release(v) {
    v.releasing = true;
    if (v.p.type === 'opl' || v.p.type === 'opx') for (var j = 0; j < v.p.ops.length; j++) { v.st[j] = 3; v.rates[j][3] = Math.max(v.rates[j][3], RR_MIN * 4 + 2); }
    if (v.p.type === 'fm') for (var k = 0; k < 4; k++) {
      v.st[k] = 3;
      // teclado: soltou a tecla, a nota para. Muitos jogos usam RR 0 (o som ficaria eterno até a próxima nota),
      // então a soltura tem um mínimo de ~0,3 s. A música original e o .fur continuam com o valor de verdade.
      v.rates[k][3] = Math.max(v.rates[k][3], RR_MIN * 4 + 2);
    }
  }
  retune() { for (var i = 0; i < 16; i++) { var v = this.voices[i]; if (v.active) this.setFreq(v); } }
  setFreq(v) {
    var p = v.p, f = this.freqOf(v.note + (p.tune || 0) + this.transp);
    if (p.type === 'pcm') {
      var base = p.base != null ? p.base : 60;
      v.inc = (p.rate / sampleRate) * Math.pow(2, (v.note + (p.tune || 0) + this.transp + this.bend - base) / 12);
      return;
    }
    if (p.type === 'opx') {
      var fs = p.rate || 44100; v.kc = opxKc(f, fs);
      for (var q = 0; q < p.ops.length; q++) {
        var oo = p.ops[q], dd = DT_TAB[oo.dt & 3][v.kc] * fs / 1048576; if (oo.dt & 4) dd = -dd;
        v.inc[q] = Math.max(0, f + dd) * (oo.mul ? oo.mul : 0.5) / sampleRate;
      }
      return;
    }
    if (p.type === 'opl') {
      v.kc = oplKc(p, f); v.fhz = f;
      for (var j = 0; j < p.ops.length; j++) v.inc[j] = f * OPL_MULT[p.ops[j].mul & 15] / sampleRate;
      return;
    }
    if (p.type === 'fm') {
      var kc = kcodeOf(p, f, v.note + (p.tune || 0) + this.transp);
      v.kc = kc;
      for (var k = 0; k < 4; k++) {
        var op = p.ops[k], dt = DT_TAB[op.dt & 3][kc] * p.rate / 1048576;
        if (op.dt & 4) dt = -dt;
        var mul = op.mul ? op.mul : 0.5;
        v.inc[k] = Math.max(0, (f * (op.dt2 ? DT2[op.dt2] : 1) + dt)) * mul / sampleRate;
      }
    } else {
      v.inc = f / sampleRate;
      v.ninc = Math.min(1, (f * 24) / sampleRate);
    }
  }
  initFM(v) {
    var p = v.p;
    v.ph = new Float64Array(4); v.inc = new Float64Array(4); v.env = new Float64Array(4).fill(1023);
    v.st = new Int8Array(4); v.out = new Float64Array(4); v.fb0 = 0; v.fb1 = 0; v.egc = 0; v.egAcc = 0;
    v.lvl = new Float64Array(4);
    this.setFreq(v);
    v.rates = [];
    for (var k = 0; k < 4; k++) {
      var op = p.ops[k], ks = v.kc >> (3 - op.ks);
      var r = function (raw) { return raw === 0 ? 0 : Math.min(63, raw + ks); };
      v.rates.push([r(op.ar * 2), r(op.d1r * 2), r(op.d2r * 2), r(op.rr * 4 + 2)]);
      v.st[k] = 0; v.env[k] = 1023;
      v.sl = v.sl || []; v.sl[k] = op.sl === 15 ? 31 * 32 : op.sl * 32;
      if (v.rates[k][0] >= 62) { v.env[k] = 0; v.st[k] = 1; }
    }
    v.car = CAR[p.alg];
    // velocidade: atenua só as portadoras (como o volume do canal no chip)
    var velAtt = vToAtt(v.vel);
    v.tl = p.ops.map(function (op, k) { return (op.tl << 3) + (v.car.indexOf(k) >= 0 ? velAtt : 0); });
    v.norm = carNorm(p, v.car);
    v.egRate = p.rate / 3 / sampleRate;
  }
  initOPL(v) {
    var p = v.p, n = p.ops.length;
    v.ph = new Float64Array(n); v.inc = new Float64Array(n); v.env = new Float64Array(n).fill(1023);
    v.st = new Int8Array(n); v.out = new Float64Array(n); v.lvl = new Float64Array(n); v.fb0 = 0; v.fb1 = 0; v.egc = 0; v.egAcc = 0;
    this.setFreq(v);
    this.oplParams(v);
    for (var k = 0; k < n; k++) { v.st[k] = 0; v.env[k] = 1023; if (v.rates[k][0] >= 62) { v.env[k] = 0; v.st[k] = 1; } }
    v.egRate = p.rate / sampleRate; // o envelope do OPL anda a cada amostra do chip
  }
  oplParams(v) {
    var p = v.p, n = p.ops.length;
    v.rates = []; v.sl = [];
    for (var k = 0; k < n; k++) {
      var op = p.ops[k], rof = op.ksr ? v.kc : v.kc >> 2;
      var r = function (raw) { return raw === 0 ? 0 : Math.min(63, raw * 4 + rof); };
      // EGT ligado: segura no nível de sustentação; desligado: continua caindo (som percussivo)
      v.rates.push([r(op.ar), r(op.dr), op.egt ? 0 : r(op.rr), r(op.rr)]);
      v.sl.push(op.sl === 15 ? 31 * 32 : op.sl * 32);
    }
    if (v.releasing) for (k = 0; k < n; k++) v.rates[k][3] = Math.max(v.rates[k][3], RR_MIN * 4 + 2);
    v.car = p.four ? OPL_CAR4[p.alg & 3] : OPL_CAR[p.alg & 1];
    var velAtt = vToAtt(v.vel), oct = Math.max(0, (Math.log2((v.fhz || 261) / 261.6)) + 1);
    v.tl = p.ops.map(function (op, k) { return (op.tl << 3) + Math.round(KSL_DB[op.ksl & 3] * oct / 0.09375) + (v.car.indexOf(k) >= 0 ? velAtt : 0); });
    var s = 0; for (k = 0; k < v.car.length; k++) s += ATT[Math.min(1023, p.ops[v.car[k]].tl << 3)];
    v.norm = 1 / Math.max(1, s);
  }
  runOPL(v, vib) {
    var p = v.p, n = p.ops.length;
    v.egAcc += v.egRate;
    while (v.egAcc >= 1) { v.egAcc -= 1; this.egTick(v); }
    // tremolo (AM) a 3,7 Hz e vibrato a 6,1 Hz do próprio chip
    v.amPh = (v.amPh || 0) + 3.7 / sampleRate; if (v.amPh >= 1) v.amPh -= 1;
    v.vbPh = (v.vbPh || 0) + 6.1 / sampleRate; if (v.vbPh >= 1) v.vbPh -= 1;
    var amTri = v.amPh < 0.5 ? v.amPh * 2 : 2 - v.amPh * 2;
    var amOff = amTri * (p.dam ? 4.8 : 1) / 0.09375;
    var vbMul = Math.pow(2, (p.dvb ? 14 : 7) * Math.sin(2 * Math.PI * v.vbPh) / 1200);
    var k, a;
    for (k = 0; k < n; k++) {
      var op = p.ops[k];
      a = v.env[k] + v.tl[k] + (op.am ? amOff : 0);
      v.lvl[k] = (a >= 1023 || op.off) ? 0 : ATT[a | 0];
      v.ph[k] += v.inc[k] * vib * (op.vib ? vbMul : 1); if (v.ph[k] >= 1) v.ph[k] -= Math.floor(v.ph[k]);
    }
    function O(k, mod) { var l = v.lvl[k]; if (l === 0) return 0; return oplWave(p.ops[k].ws, v.ph[k] + mod) * l; }
    var fbm = p.fb ? (v.fb0 + v.fb1) * Math.pow(2, p.fb - 7) : 0;
    var o1 = O(0, fbm); v.fb0 = v.fb1; v.fb1 = o1;
    var outv;
    if (!p.four) outv = (p.alg & 1) ? o1 + O(1, 0) : O(1, o1 * 4);
    else switch (p.alg & 3) {
      case 0: outv = O(3, O(2, O(1, o1 * 4) * 4) * 4); break;            // 1→2→3→4
      case 1: outv = o1 + O(3, O(2, O(1, 0) * 4) * 4); break;            // 1 + (2→3→4)
      case 2: outv = O(1, o1 * 4) + O(3, O(2, 0) * 4); break;            // (1→2) + (3→4)
      default: outv = o1 + O(2, O(1, 0) * 4) + O(3, 0);                  // 1 + (2→3) + 4
    }
    outv *= v.norm;
    if (outv > 1) outv = 1; else if (outv < -1) outv = -1;
    if (v.releasing || !v.held) {
      var done = true; for (k = 0; k < v.car.length; k++) if (v.st[v.car[k]] !== 4 && v.env[v.car[k]] < 1000) { done = false; break; }
      if (done) v.active = false;
    } else if (v.car.every(function (c) { return v.env[c] >= 1000 && v.st[c] >= 2; })) v.active = false;
    return outv * 0.32;
  }
  initOPX(v) {
    var p = v.p, n = p.ops.length;
    v.ph = new Float64Array(n); v.inc = new Float64Array(n); v.env = new Float64Array(n).fill(1023);
    v.st = new Int8Array(n); v.out = new Float64Array(n); v.lvl = new Float64Array(n); v.fb0 = 0; v.fb1 = 0; v.egc = 0; v.egAcc = 0;
    this.setFreq(v);
    this.opxParams(v);
    for (var k = 0; k < n; k++) { v.st[k] = 0; v.env[k] = 1023; if (v.rates[k][0] >= 62) { v.env[k] = 0; v.st[k] = 1; } }
    v.egRate = (p.rate || 44100) / 2 / sampleRate; // o envelope do OPX anda a cada 2 amostras do chip
  }
  opxParams(v) {
    var p = v.p, n = p.ops.length;
    v.rates = []; v.sl = [];
    for (var k = 0; k < n; k++) {
      var op = p.ops[k], rks = OPX_RKS[v.kc & 31][op.ks & 7];
      var r = function (raw) { return raw === 0 ? 0 : Math.min(63, raw + rks); };
      v.rates.push([r(op.ar * 2), r(op.d1r * 2), r(op.d2r * 2), r(op.rr * 4)]);
      v.sl.push(op.sl === 15 ? 31 * 32 : op.sl * 32);
    }
    if (v.releasing) for (k = 0; k < n; k++) v.rates[k][3] = Math.max(v.rates[k][3], RR_MIN * 4 + 2);
    v.alg = opxAlg(p); v.car = opxCar(p);
    var velAtt = vToAtt(v.vel);
    v.tl = p.ops.map(function (op, k) { return (op.tl << 3) + (v.car.indexOf(k) >= 0 ? velAtt : 0); });
    v.norm = carNorm(p, v.car);
  }
  runOPX(v, vib) {
    var p = v.p, n = p.ops.length, A = v.alg, k, q;
    v.egAcc += v.egRate;
    while (v.egAcc >= 1) { v.egAcc -= 1; this.egTick(v); }
    for (k = 0; k < n; k++) {
      var a = v.env[k] + v.tl[k];
      v.lvl[k] = (a >= 1023 || p.ops[k].off) ? 0 : ATT[a | 0];
      v.ph[k] += v.inc[k] * vib; if (v.ph[k] >= 1) v.ph[k] -= Math.floor(v.ph[k]);
    }
    var outv = 0;
    for (k = 0; k < n; k++) {
      var mod = 0;
      if (k === 0) { var fb = p.ops[0].fb & 7; mod = fb ? (v.fb0 + v.fb1) * Math.pow(2, fb - 7) : 0; }
      else { var sum = 0; for (q = 0; q < n; q++) if (A[0][k] & (1 << q)) sum += v.out[q]; mod = sum * OPX_MODLV[p.ops[k].fb & 7] / 32; }
      var l = v.lvl[k], y = l ? opxWave(p.ops[k].ws, v.ph[k] + mod) * l : 0;
      v.out[k] = y;
      if (k === A[2]) { v.fb0 = v.fb1; v.fb1 = y; }
      if (A[1] & (1 << k)) outv += y;
    }
    outv *= v.norm;
    if (outv > 1) outv = 1; else if (outv < -1) outv = -1;
    if (v.releasing || !v.held) {
      var done = true; for (k = 0; k < v.car.length; k++) if (v.st[v.car[k]] !== 4 && v.env[v.car[k]] < 1000) { done = false; break; }
      if (done) v.active = false;
    } else if (v.car.every(function (c) { return v.env[c] >= 1000 && v.st[c] >= 2; })) v.active = false;
    return outv * 0.32;
  }
  egTick(v) {
    v.egc++;
    for (var k = 0; k < v.st.length; k++) {
      var st = v.st[k]; if (st === 4) continue;
      var rate = v.rates[k][st]; if (!rate) continue;
      var shift = rate < 48 ? Math.max(0, 11 - (rate >> 2)) : 0;
      if (v.egc & ((1 << shift) - 1)) continue;
      var row = rate < 48 ? (rate & 3) : Math.min(16, 4 + (rate - 48));
      var inc = EG_INC[row][(v.egc >> shift) & 7];
      var e = v.env[k];
      if (st === 0) {
        if (rate >= 62) e = 0; else e += ((~e) * inc) >> 4;
        if (e <= 0) { e = 0; v.st[k] = 1; }
      } else {
        e += inc;
        if (st === 1 && e >= v.sl[k]) v.st[k] = 2;
        if (e >= 1023) { e = 1023; if (st === 3) v.st[k] = 4; }
      }
      v.env[k] = e;
    }
  }
  initPSG(v) {
    var p = v.p;
    v.ph = 0; v.fi = 0; v.facc = 0; v.lfsr = 1; v.nacc = 0; v.nbit = 1;
    this.setFreq(v);
    var env = p.env;
    if (this.hold && p.wave !== 'noise') {   // tira o silêncio final para a nota segurar enquanto a tecla estiver apertada
      var n = env.length; while (n > 1 && env[n - 1] <= 0.001) n--;
      env = env.slice(0, n);
    }
    v.envA = env; v.dutyA = p.duty;
  }
  process(inputs, outputs) {
    var out = outputs[0], L = out[0], R = out[1] || out[0], N = L.length;
    var p = this.patch;
    var lfoHz = 0, amDb = 0, pmC = 0;
    for (var s = 0; s < N; s++) {
      var mix = 0;
      // LFO compartilhado (triângulo) e vibrato da roda de modulação
      this.vibPh += 5.5 / sampleRate; if (this.vibPh >= 1) this.vibPh -= 1;
      var vib = this.mod > 0 ? Math.pow(2, (this.mod * 50 * Math.sin(2 * Math.PI * this.vibPh)) / 1200) : 1;
      for (var i = 0; i < 16; i++) {
        var v = this.voices[i]; if (!v.active) continue;
        if (v.p.type === 'fm') mix += this.runFM(v, vib); else if (v.p.type === 'opx') mix += this.runOPX(v, vib); else if (v.p.type === 'opl') mix += this.runOPL(v, vib); else if (v.p.type === 'pcm') mix += this.runPCM(v, vib); else mix += this.runPSG(v, vib);
      }
      var y = mix * this.vol;
      // bloqueador de DC + limitador suave
      var dc = y - this.dcPrev + 0.9995 * this.dc; this.dcPrev = y; this.dc = dc; y = dc;
      if (y > 0.8) y = 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2); else if (y < -0.8) y = -0.8 + 0.2 * Math.tanh((y + 0.8) / 0.2);
      L[s] = y; R[s] = y;
    }
    return true;
  }
  runFM(v, vib) {
    var p = v.p;
    v.egAcc += v.egRate;
    while (v.egAcc >= 1) { v.egAcc -= 1; this.egTick(v); }
    // LFO do chip
    var amOff = 0, pm = 1;
    if (p.lfo >= 0 || p.opmLfo) {
      var hz, amDb, pmC;
      if (p.fmKind === 'opm') {
        var ol = p.opmLfo; hz = 0.008 * Math.pow(2, ol.frq * 12.69 / 255);
        amDb = OPM_AM_DB[p.ams] * ol.amd / 127; pmC = OPM_PM_C[p.fms] * ol.pmd / 127;
      } else { hz = OPN_LFO_HZ[p.lfo]; amDb = OPN_AM_DB[p.ams]; pmC = OPN_PM_C[p.fms]; }
      v.lph = (v.lph || 0) + hz / sampleRate; if (v.lph >= 1) v.lph -= 1;
      var tri = v.lph < 0.5 ? v.lph * 2 : 2 - v.lph * 2;
      amOff = tri * amDb / 0.09375;
      pm = Math.pow(2, (pmC * (tri * 2 - 1)) / 1200);
    }
    var fmul = pm * vib, o = v.out, k, a;
    for (k = 0; k < 4; k++) {
      a = v.env[k] + v.tl[k] + (p.ops[k].am ? amOff : 0);
      v.lvl[k] = (a >= 1023 || p.ops[k].off) ? 0 : ATT[a | 0];
      v.ph[k] += v.inc[k] * fmul; if (v.ph[k] >= 1) v.ph[k] -= Math.floor(v.ph[k]);
    }
    var fbm = p.fb ? (v.fb0 + v.fb1) * Math.pow(2, p.fb - 7) : 0;
    var o1 = op(v, 0, fbm); v.fb0 = v.fb1; v.fb1 = o1;
    var o2, o3, o4, outv;
    switch (p.alg) {
      case 0: o2 = op(v, 1, o1 * 4); o3 = op(v, 2, o2 * 4); o4 = op(v, 3, o3 * 4); outv = o4; break;
      case 1: o2 = op(v, 1, 0); o3 = op(v, 2, (o1 + o2) * 4); o4 = op(v, 3, o3 * 4); outv = o4; break;
      case 2: o2 = op(v, 1, 0); o3 = op(v, 2, o2 * 4); o4 = op(v, 3, (o1 + o3) * 4); outv = o4; break;
      case 3: o2 = op(v, 1, o1 * 4); o3 = op(v, 2, 0); o4 = op(v, 3, (o2 + o3) * 4); outv = o4; break;
      case 4: o2 = op(v, 1, o1 * 4); o3 = op(v, 2, 0); o4 = op(v, 3, o3 * 4); outv = o2 + o4; break;
      case 5: o2 = op(v, 1, o1 * 4); o3 = op(v, 2, o1 * 4); o4 = op(v, 3, o1 * 4); outv = o2 + o3 + o4; break;
      case 6: o2 = op(v, 1, o1 * 4); o3 = op(v, 2, 0); o4 = op(v, 3, 0); outv = o2 + o3 + o4; break;
      default: o2 = op(v, 1, 0); o3 = op(v, 2, 0); o4 = op(v, 3, 0); outv = o1 + o2 + o3 + o4;
    }
    outv *= v.norm;
    if (outv > 1) outv = 1; else if (outv < -1) outv = -1;
    // voz termina quando todas as portadoras se calaram
    if (v.releasing || !v.held) {
      var done = true; for (k = 0; k < v.car.length; k++) if (v.st[v.car[k]] !== 4 && v.env[v.car[k]] < 1000) { done = false; break; }
      if (done) v.active = false;
    } else if (v.car.every(function (c) { return v.env[c] >= 1000 && v.st[c] >= 2; })) v.active = false;
    return outv * 0.32;
  }
  runPSG(v, vib) {
    var p = v.p;
    // envelope gravado da música, a 60 quadros por segundo
    v.facc += 60 / sampleRate;
    if (v.facc >= 1) {
      v.facc -= 1;
      if (v.fi < v.envA.length - 1) v.fi++;
      else if (!v.held && !v.susHeld && !v.releasing) v.releasing = true;
    }
    if (v.releasing) { v.rel -= 1 / (0.06 * sampleRate); if (v.rel <= 0) { v.active = false; return 0; } }
    var e = v.envA[Math.min(v.fi, v.envA.length - 1)];
    if (e <= 0.001 && v.fi >= v.envA.length - 1) { v.active = false; return 0; }
    var x;
    if (p.wave === 'noise') {
      v.nacc += v.ninc * vib * 4;
      while (v.nacc >= 1) {
        v.nacc -= 1;
        var tap = p.nmode === 'periodic' ? 6 : 1;
        var bit = (v.lfsr ^ (v.lfsr >> tap)) & 1;
        v.lfsr = (v.lfsr >> 1) | (bit << 14);
        v.nbit = v.lfsr & 1;
      }
      x = v.nbit ? 0.7 : -0.7;
    } else {
      v.ph += v.inc * vib; if (v.ph >= 1) v.ph -= Math.floor(v.ph);
      if (p.wave === 'pulse') {
        var di = v.dutyA[Math.min(v.fi, v.dutyA.length - 1)];
        var duty = p.chipKind === 'sn' || p.chipKind === 'ay' ? 0.5 : p.chipKind === 'ay8930' ? DUTY8930[di < 0 ? 4 : Math.min(8, di)] : p.chipKind === 'vrc6' ? ((di < 0 ? 7 : Math.min(7, di)) + 1) / 16 : p.chipKind === 'sid' ? ((di < 0 ? 7 : Math.min(15, di)) + 1) / 16 : DUTY[di < 0 ? 2 : di];
        x = v.ph < duty ? 0.6 : -0.6;
      } else if (p.wave === 'tri') {
        x = (NES_TRI[(v.ph * 32) | 0] / 7.5 - 1) * 0.8;
      } else {
        x = (p.tbl[(v.ph * 32) | 0] / 7.5 - 1) * 0.6;
      }
    }
    return x * e * v.gain * v.rel * 0.45;
  }
}
function carNorm(p, car) { // soma das portadoras ligadas → divide para o timbre não sair estourado
  var s = 0;
  for (var i = 0; i < car.length; i++) { var op = p.ops[car[i]]; if (!op.off) s += ATT[Math.min(1023, op.tl << 3)]; }
  return 1 / Math.max(1, s);
}
function vToAtt(vel) { // curva de velocidade em passos de 0,094 dB (até ~30 dB)
  var g = Math.max(1, vel) / 127;
  return Math.round(-40 * Math.log10(g) * 0.75 / 0.09375);
}
function op(v, k, mod) {
  var l = v.lvl[k]; if (l === 0) { v.out[k] = 0; return 0; }
  var ph = v.ph[k] + mod;
  var idx = ((ph - Math.floor(ph)) * SINLEN) | 0;
  var y = SIN[idx] * l; v.out[k] = y; return y;
}
registerProcessor('estudio-synth', EstudioSynth);
