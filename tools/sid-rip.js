/* SID (Commodore 64): roda o programa da música (6502) e grava cada escrita no chip de som.
   Só PSID/RSID simples: init + play (ou a interrupção que o próprio programa instala), a 50 Hz (PAL) ou no tempo do timer da CIA.
   Devolve o mesmo registro que o rg-rip.wasm: [tempo (s), chip 20, registrador, valor] ... */
var RGSID = (function () {
  'use strict';
  function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }

  function CPU(mem) {
    this.m = mem; this.a = 0; this.x = 0; this.y = 0; this.s = 0xFF; this.pc = 0; this.p = 0x24; this.cyc = 0;
  }
  var C = 1, Z = 2, I = 4, D = 8, B = 16, U = 32, V = 64, N = 128;
  // tabela de ciclos (aproximada; o tempo da música vem dos quadros, não de cada instrução)
  var CYC = [7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7, 6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7, 6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5, 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
    2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7, 2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7];
  CPU.prototype.rd = function (a) { return this.m.rd(a & 0xFFFF); };
  CPU.prototype.wr = function (a, v) { this.m.wr(a & 0xFFFF, v & 255); };
  CPU.prototype.push = function (v) { this.m.ram[0x100 | this.s] = v & 255; this.s = (this.s - 1) & 255; };
  CPU.prototype.pull = function () { this.s = (this.s + 1) & 255; return this.m.ram[0x100 | this.s]; };
  CPU.prototype.nz = function (v) { this.p = (this.p & ~(Z | N)) | (v & 255 ? 0 : Z) | (v & N); return v & 255; };
  CPU.prototype.step = function () {
    var op = this.rd(this.pc), pc = this.pc + 1, ad = 0, v, t, self = this;
    this.cyc += CYC[op];
    var mode = MODE[op];
    switch (mode) {   // endereço do operando
      case 1: ad = pc; pc += 1; break;                                                         // imediato
      case 2: ad = this.rd(pc); pc += 1; break;                                               // página zero
      case 3: ad = (this.rd(pc) + this.x) & 255; pc += 1; break;                              // zp,X
      case 4: ad = (this.rd(pc) + this.y) & 255; pc += 1; break;                              // zp,Y
      case 5: ad = this.rd(pc) | (this.rd(pc + 1) << 8); pc += 2; break;                      // absoluto
      case 6: ad = ((this.rd(pc) | (this.rd(pc + 1) << 8)) + this.x) & 0xFFFF; pc += 2; break;
      case 7: ad = ((this.rd(pc) | (this.rd(pc + 1) << 8)) + this.y) & 0xFFFF; pc += 2; break;
      case 8: t = (this.rd(pc) + this.x) & 255; ad = this.rd(t) | (this.rd((t + 1) & 255) << 8); pc += 1; break;      // (zp,X)
      case 9: t = this.rd(pc); ad = ((this.rd(t) | (this.rd((t + 1) & 255) << 8)) + this.y) & 0xFFFF; pc += 1; break; // (zp),Y
      case 10: t = this.rd(pc) | (this.rd(pc + 1) << 8); ad = this.rd(t) | (this.rd((t & 0xFF00) | ((t + 1) & 255)) << 8); pc += 2; break; // (ind)
      case 11: ad = pc; pc += 1; break;                                                        // relativo
    }
    this.pc = pc & 0xFFFF;
    var nm = NAME[op];
    switch (nm) {
      case 'LDA': this.a = this.nz(this.rd(ad)); break;
      case 'LDX': this.x = this.nz(this.rd(ad)); break;
      case 'LDY': this.y = this.nz(this.rd(ad)); break;
      case 'LAX': this.a = this.x = this.nz(this.rd(ad)); break;
      case 'STA': this.wr(ad, this.a); break;
      case 'STX': this.wr(ad, this.x); break;
      case 'STY': this.wr(ad, this.y); break;
      case 'SAX': this.wr(ad, this.a & this.x); break;
      case 'TAX': this.x = this.nz(this.a); break; case 'TAY': this.y = this.nz(this.a); break;
      case 'TXA': this.a = this.nz(this.x); break; case 'TYA': this.a = this.nz(this.y); break;
      case 'TSX': this.x = this.nz(this.s); break; case 'TXS': this.s = this.x; break;
      case 'PHA': this.push(this.a); break; case 'PHP': this.push(this.p | B | U); break;
      case 'PLA': this.a = this.nz(this.pull()); break; case 'PLP': this.p = (this.pull() & ~B) | U; break;
      case 'AND': this.a = this.nz(this.a & this.rd(ad)); break;
      case 'ORA': this.a = this.nz(this.a | this.rd(ad)); break;
      case 'EOR': this.a = this.nz(this.a ^ this.rd(ad)); break;
      case 'ADC': this.adc(this.rd(ad)); break;
      case 'SBC': this.adc(this.rd(ad) ^ 255); break;
      case 'CMP': this.cmp(this.a, this.rd(ad)); break; case 'CPX': this.cmp(this.x, this.rd(ad)); break; case 'CPY': this.cmp(this.y, this.rd(ad)); break;
      case 'BIT': v = this.rd(ad); this.p = (this.p & ~(Z | V | N)) | (v & this.a ? 0 : Z) | (v & (V | N)); break;
      case 'INC': v = this.nz(this.rd(ad) + 1); this.wr(ad, v); break;
      case 'DEC': v = this.nz(this.rd(ad) - 1); this.wr(ad, v); break;
      case 'INX': this.x = this.nz(this.x + 1); break; case 'INY': this.y = this.nz(this.y + 1); break;
      case 'DEX': this.x = this.nz(this.x - 1); break; case 'DEY': this.y = this.nz(this.y - 1); break;
      case 'ASL': case 'LSR': case 'ROL': case 'ROR':
        v = mode === 0 ? this.a : this.rd(ad);
        var c0 = this.p & C, res;
        if (nm === 'ASL') { res = v << 1; this.p = (this.p & ~C) | (v >> 7); }
        else if (nm === 'LSR') { res = v >> 1; this.p = (this.p & ~C) | (v & 1); }
        else if (nm === 'ROL') { res = (v << 1) | c0; this.p = (this.p & ~C) | (v >> 7); }
        else { res = (v >> 1) | (c0 << 7); this.p = (this.p & ~C) | (v & 1); }
        res = this.nz(res);
        if (mode === 0) this.a = res; else this.wr(ad, res);
        break;
      case 'SLO': v = this.rd(ad); this.p = (this.p & ~C) | (v >> 7); v = (v << 1) & 255; this.wr(ad, v); this.a = this.nz(this.a | v); break;
      case 'RLA': v = this.rd(ad); t = this.p & C; this.p = (this.p & ~C) | (v >> 7); v = ((v << 1) | t) & 255; this.wr(ad, v); this.a = this.nz(this.a & v); break;
      case 'SRE': v = this.rd(ad); this.p = (this.p & ~C) | (v & 1); v >>= 1; this.wr(ad, v); this.a = this.nz(this.a ^ v); break;
      case 'RRA': v = this.rd(ad); t = this.p & C; this.p = (this.p & ~C) | (v & 1); v = (v >> 1) | (t << 7); this.wr(ad, v); this.adc(v); break;
      case 'DCP': v = (this.rd(ad) - 1) & 255; this.wr(ad, v); this.cmp(this.a, v); break;
      case 'ISB': v = (this.rd(ad) + 1) & 255; this.wr(ad, v); this.adc(v ^ 255); break;
      case 'ANC': this.a = this.nz(this.a & this.rd(ad)); this.p = (this.p & ~C) | (this.a >> 7); break;
      case 'ALR': this.a &= this.rd(ad); this.p = (this.p & ~C) | (this.a & 1); this.a = this.nz(this.a >> 1); break;
      case 'ARR': this.a &= this.rd(ad); this.a = this.nz((this.a >> 1) | ((this.p & C) << 7)); this.p = (this.p & ~(C | V)) | ((this.a >> 6) & 1) | (((this.a >> 6) ^ (this.a >> 5)) & 1 ? V : 0); break;
      case 'AXS': v = (this.a & this.x) - this.rd(ad); this.p = (this.p & ~C) | (v >= 0 ? C : 0); this.x = this.nz(v); break;
      case 'JMP': this.pc = ad; break;
      case 'JSR': t = (this.pc - 1) & 0xFFFF; this.push(t >> 8); this.push(t); this.pc = ad; break;
      case 'RTS': t = this.pull(); t |= this.pull() << 8; this.pc = (t + 1) & 0xFFFF; break;
      case 'RTI': this.p = (this.pull() & ~B) | U; t = this.pull(); t |= this.pull() << 8; this.pc = t; break;
      case 'BRK': t = (this.pc + 1) & 0xFFFF; this.push(t >> 8); this.push(t); this.push(this.p | B | U); this.p |= I; this.pc = this.rd(0xFFFE) | (this.rd(0xFFFF) << 8); break;
      case 'BPL': this.br(!(this.p & N), ad); break; case 'BMI': this.br(this.p & N, ad); break;
      case 'BVC': this.br(!(this.p & V), ad); break; case 'BVS': this.br(this.p & V, ad); break;
      case 'BCC': this.br(!(this.p & C), ad); break; case 'BCS': this.br(this.p & C, ad); break;
      case 'BNE': this.br(!(this.p & Z), ad); break; case 'BEQ': this.br(this.p & Z, ad); break;
      case 'CLC': this.p &= ~C; break; case 'SEC': this.p |= C; break; case 'CLI': this.p &= ~I; break; case 'SEI': this.p |= I; break;
      case 'CLV': this.p &= ~V; break; case 'CLD': this.p &= ~D; break; case 'SED': this.p |= D; break;
      case 'NOP': if (mode) this.rd(ad); break;
      case 'KIL': this.pc = (this.pc - 1) & 0xFFFF; this.jam = true; break;
    }
  };
  CPU.prototype.br = function (cond, ad) { if (cond) { var o = this.rd(ad); this.pc = (this.pc + ((o << 24) >> 24)) & 0xFFFF; this.cyc++; } };
  CPU.prototype.cmp = function (r, v) { var t = r - v; this.p = (this.p & ~(C | Z | N)) | (t >= 0 ? C : 0) | (t & 255 ? 0 : Z) | (t & N); };
  CPU.prototype.adc = function (v) {
    if (this.p & D) {   // modo decimal (BCD)
      var lo = (this.a & 15) + (v & 15) + (this.p & C), hi = (this.a >> 4) + (v >> 4);
      if (lo > 9) { lo += 6; hi++; }
      if (hi > 9) hi += 6;
      var r = ((hi << 4) | (lo & 15)) & 255;
      this.p = (this.p & ~(C | Z | N | V)) | (hi > 15 ? C : 0) | (r ? 0 : Z) | (r & N);
      this.a = r; return;
    }
    var s = this.a + v + (this.p & C);
    this.p = (this.p & ~(C | V)) | (s > 255 ? C : 0) | ((~(this.a ^ v) & (this.a ^ s) & 0x80) ? V : 0);
    this.a = this.nz(s);
  };
  // decodificação: nome e modo de cada opcode (0 implícito/acumulador)
  var NAME = [], MODE = [];
  (function () {
    var t = {
      LDA: [[0xA9, 1], [0xA5, 2], [0xB5, 3], [0xAD, 5], [0xBD, 6], [0xB9, 7], [0xA1, 8], [0xB1, 9]], LDX: [[0xA2, 1], [0xA6, 2], [0xB6, 4], [0xAE, 5], [0xBE, 7]],
      LDY: [[0xA0, 1], [0xA4, 2], [0xB4, 3], [0xAC, 5], [0xBC, 6]], STA: [[0x85, 2], [0x95, 3], [0x8D, 5], [0x9D, 6], [0x99, 7], [0x81, 8], [0x91, 9]],
      STX: [[0x86, 2], [0x96, 4], [0x8E, 5]], STY: [[0x84, 2], [0x94, 3], [0x8C, 5]],
      ADC: [[0x69, 1], [0x65, 2], [0x75, 3], [0x6D, 5], [0x7D, 6], [0x79, 7], [0x61, 8], [0x71, 9]], SBC: [[0xE9, 1], [0xEB, 1], [0xE5, 2], [0xF5, 3], [0xED, 5], [0xFD, 6], [0xF9, 7], [0xE1, 8], [0xF1, 9]],
      AND: [[0x29, 1], [0x25, 2], [0x35, 3], [0x2D, 5], [0x3D, 6], [0x39, 7], [0x21, 8], [0x31, 9]], ORA: [[0x09, 1], [0x05, 2], [0x15, 3], [0x0D, 5], [0x1D, 6], [0x19, 7], [0x01, 8], [0x11, 9]],
      EOR: [[0x49, 1], [0x45, 2], [0x55, 3], [0x4D, 5], [0x5D, 6], [0x59, 7], [0x41, 8], [0x51, 9]], CMP: [[0xC9, 1], [0xC5, 2], [0xD5, 3], [0xCD, 5], [0xDD, 6], [0xD9, 7], [0xC1, 8], [0xD1, 9]],
      CPX: [[0xE0, 1], [0xE4, 2], [0xEC, 5]], CPY: [[0xC0, 1], [0xC4, 2], [0xCC, 5]], BIT: [[0x24, 2], [0x2C, 5]],
      INC: [[0xE6, 2], [0xF6, 3], [0xEE, 5], [0xFE, 6]], DEC: [[0xC6, 2], [0xD6, 3], [0xCE, 5], [0xDE, 6]],
      ASL: [[0x0A, 0], [0x06, 2], [0x16, 3], [0x0E, 5], [0x1E, 6]], LSR: [[0x4A, 0], [0x46, 2], [0x56, 3], [0x4E, 5], [0x5E, 6]],
      ROL: [[0x2A, 0], [0x26, 2], [0x36, 3], [0x2E, 5], [0x3E, 6]], ROR: [[0x6A, 0], [0x66, 2], [0x76, 3], [0x6E, 5], [0x7E, 6]],
      JMP: [[0x4C, 5], [0x6C, 10]], JSR: [[0x20, 5]], RTS: [[0x60, 0]], RTI: [[0x40, 0]], BRK: [[0x00, 0]],
      BPL: [[0x10, 11]], BMI: [[0x30, 11]], BVC: [[0x50, 11]], BVS: [[0x70, 11]], BCC: [[0x90, 11]], BCS: [[0xB0, 11]], BNE: [[0xD0, 11]], BEQ: [[0xF0, 11]],
      TAX: [[0xAA, 0]], TAY: [[0xA8, 0]], TXA: [[0x8A, 0]], TYA: [[0x98, 0]], TSX: [[0xBA, 0]], TXS: [[0x9A, 0]], PHA: [[0x48, 0]], PHP: [[0x08, 0]], PLA: [[0x68, 0]], PLP: [[0x28, 0]],
      INX: [[0xE8, 0]], INY: [[0xC8, 0]], DEX: [[0xCA, 0]], DEY: [[0x88, 0]],
      CLC: [[0x18, 0]], SEC: [[0x38, 0]], CLI: [[0x58, 0]], SEI: [[0x78, 0]], CLV: [[0xB8, 0]], CLD: [[0xD8, 0]], SED: [[0xF8, 0]],
      LAX: [[0xA7, 2], [0xB7, 4], [0xAF, 5], [0xBF, 7], [0xA3, 8], [0xB3, 9], [0xAB, 1]], SAX: [[0x87, 2], [0x97, 4], [0x8F, 5], [0x83, 8]],
      SLO: [[0x07, 2], [0x17, 3], [0x0F, 5], [0x1F, 6], [0x1B, 7], [0x03, 8], [0x13, 9]], RLA: [[0x27, 2], [0x37, 3], [0x2F, 5], [0x3F, 6], [0x3B, 7], [0x23, 8], [0x33, 9]],
      SRE: [[0x47, 2], [0x57, 3], [0x4F, 5], [0x5F, 6], [0x5B, 7], [0x43, 8], [0x53, 9]], RRA: [[0x67, 2], [0x77, 3], [0x6F, 5], [0x7F, 6], [0x7B, 7], [0x63, 8], [0x73, 9]],
      DCP: [[0xC7, 2], [0xD7, 3], [0xCF, 5], [0xDF, 6], [0xDB, 7], [0xC3, 8], [0xD3, 9]], ISB: [[0xE7, 2], [0xF7, 3], [0xEF, 5], [0xFF, 6], [0xFB, 7], [0xE3, 8], [0xF3, 9]],
      ANC: [[0x0B, 1], [0x2B, 1]], ALR: [[0x4B, 1]], ARR: [[0x6B, 1]], AXS: [[0xCB, 1]],
      NOP: [[0xEA, 0], [0x1A, 0], [0x3A, 0], [0x5A, 0], [0x7A, 0], [0xDA, 0], [0xFA, 0], [0x80, 1], [0x82, 1], [0x89, 1], [0xC2, 1], [0xE2, 1], [0x04, 2], [0x44, 2], [0x64, 2],
        [0x14, 3], [0x34, 3], [0x54, 3], [0x74, 3], [0xD4, 3], [0xF4, 3], [0x0C, 5], [0x1C, 6], [0x3C, 6], [0x5C, 6], [0x7C, 6], [0xDC, 6], [0xFC, 6]]
    };
    for (var i = 0; i < 256; i++) { NAME[i] = 'KIL'; MODE[i] = 0; }
    for (var k in t) t[k].forEach(function (x) { NAME[x[0]] = k; MODE[x[0]] = x[1]; });
  })();

  // ───── memória do C64 (RAM + E/S: SID, CIA, VIC) ─────
  function Mem(log) {
    this.ram = new Uint8Array(0x10000); this.sid = new Uint8Array(32); this.log = log; this.t = 0;
    this.ciaLat = 0x4025; this.ciaCtl = 0; this.raster = 0;
  }
  Mem.prototype.io = function () { var b = this.ram[1] & 7; return b !== 0 && b !== 4 && (b & 4); };   // E/S visível em $D000-$DFFF
  Mem.prototype.rd = function (a) {
    if (a >= 0xD000 && a < 0xE000 && this.io()) {
      if (a >= 0xD400 && a < 0xD800) { var r = a & 31; if (r === 0x1B) return (Math.random() * 256) | 0; if (r === 0x1C) return 0; return 0; }
      if (a === 0xD012) { this.raster = (this.raster + 1) % 312; return this.raster & 255; }
      if (a === 0xD011) return (this.raster >> 1) & 0x80;
      if (a === 0xDC04) return this.ciaLat & 255; if (a === 0xDC05) return this.ciaLat >> 8;
      if (a === 0xDC0D || a === 0xDD0D) return 0;
      return 0;
    }
    return this.ram[a];
  };
  Mem.prototype.wr = function (a, v) {
    if (a >= 0xD000 && a < 0xE000 && this.io()) {
      if (a >= 0xD400 && a < 0xD800) { var r = a & 31; if (r < 25) { this.sid[r] = v; this.log(r, v); } return; }
      if (a === 0xDC04) { this.ciaLat = (this.ciaLat & 0xFF00) | v; return; }
      if (a === 0xDC05) { this.ciaLat = (this.ciaLat & 0xFF) | (v << 8); return; }
      if (a === 0xDC0E) { this.ciaCtl = v; return; }
      return;
    }
    this.ram[a] = v;
  };

  // roda o programa: devolve { log: Float64Array, seconds, tracks, info }
  function rip(b, track, seconds) {
    var magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (magic !== 'PSID' && magic !== 'RSID') throw new Error('não é SID');
    var ver = u16be(b, 4), dataO = u16be(b, 6), load = u16be(b, 8), init = u16be(b, 10), play = u16be(b, 12), songs = u16be(b, 14), start = u16be(b, 16);
    var speed = ((b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21]) >>> 0;
    var flags = ver >= 2 && b.length > 0x77 ? u16be(b, 0x76) : 0, ntsc = ((flags >> 2) & 3) === 2;
    var str = function (o) { var s = ''; for (var i = 0; i < 32 && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };
    var info = { song: str(0x16), author: str(0x36), game: '', system: 'Commodore 64', model: ((flags >> 4) & 3) === 2 ? '8580' : '6581' };
    var p = dataO; if (!load) { load = b[p] | (b[p + 1] << 8); p += 2; }
    var song = track == null ? (start ? start - 1 : 0) : track; if (song >= songs) song = 0;
    var clock = ntsc ? 1022727 : 985248, L = [], cyc = 0, base = 0;
    // o volume geral ($D418) escrito milhares de vezes por segundo é sample digitalizado (digi): fica de fora
    var last18 = -1, t18 = -1;
    var mem = new Mem(function (r, v) {
      var tt = (base + cpu.cyc) / clock;
      if (r === 0x18) { if (v === last18 || tt - t18 < 0.002) return; last18 = v; t18 = tt; }
      if (L.length < 4e6) L.push(tt, 20, r, v);
    });
    mem.ram.set(b.subarray(p, Math.min(b.length, p + 0x10000 - load)), load);
    // ROM do KERNAL não existe: rotinas de saída de interrupção viram "PLA TAY PLA TAX PLA RTI"
    [0xEA31, 0xEA81, 0xEA7E, 0xFEBC].forEach(function (a) { mem.ram.set([0x68, 0xA8, 0x68, 0xAA, 0x68, 0x40], a); });
    mem.ram[0x0314] = 0x31; mem.ram[0x0315] = 0xEA; mem.ram[0xFFFE] = 0x48; mem.ram[0xFFFF] = 0xFF;
    mem.ram.set([0x48, 0x8A, 0x48, 0x98, 0x48, 0x6C, 0x14, 0x03], 0xFF48);   // entrada da IRQ do KERNAL
    mem.ram[1] = magic === 'PSID' && play && (init < 0xA000 || init >= 0xE000) ? 0x37 : 0x37;
    var cpu = new CPU(mem);
    var SENT = 0xFFF0; mem.ram[SENT] = 0x02;   // fim da chamada: instrução que trava (KIL)
    function call(addr, a, irq) {
      cpu.jam = false; cpu.s = 0xFF;
      var r = SENT - 1; cpu.push(r >> 8); cpu.push(r & 255);
      if (irq) { cpu.push(SENT >> 8); cpu.push(SENT & 255); cpu.push(cpu.p & ~16); }
      cpu.a = a || 0; cpu.pc = addr; cpu.p |= 4;
      var lim = cpu.cyc + 400000;
      while (!cpu.jam && cpu.pc !== SENT && cpu.cyc < lim) cpu.step();
    }
    call(init, song); base = 0;
    var useCia = speed & (1 << Math.min(31, song)), frames = 0, total = seconds * clock;
    var irqVec = function () { return (mem.ram[1] & 2) ? 0xFF48 : (mem.ram[0xFFFE] | (mem.ram[0xFFFF] << 8)); };
    var lastCyc = 0;
    while (cyc < total && frames < 60 * 60 * 20) {
      var period = useCia || (!play && mem.ciaLat !== 0x4025) ? (mem.ciaLat || 0x4025) + 1 : (ntsc ? 17045 : 19656);
      base = cyc; cyc += period; cpu.cyc = 0; frames++;
      if (play) call(play, 0); else call(irqVec(), 0, true);
    }
    return { log: new Float64Array(L), blob: new Uint8Array(0), info: info, seconds: seconds, tracks: songs, start: start ? start - 1 : 0, clock: clock };
  }
  function tracks(b) { return u16be(b, 14); }
  return { rip: rip, tracks: tracks };
})();
if (typeof module !== 'undefined') module.exports = RGSID;
