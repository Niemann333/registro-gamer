/* Outros formatos para o Chiptune Studio (teclado, piano roll e timbres):
   módulos de tracker (MOD, S3M, XM, IT/MPTM), MIDI (com os sons do SoundFont do player) e S98 (log de registradores, vira VGM).
   Devolve o mesmo formato do leitor de VGM: { info, chips, timbres, midi: { chans, events }, ... } */
var RGFMT_MAKE = function (api) {
  'use strict';
  var SR = 44100;
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function s8(v) { return (v << 24) >> 24; }
  function str(b, o, n) { var s = ''; for (var i = 0; i < n && o + i < b.length; i++) { var c = b[o + i]; if (!c) break; s += String.fromCharCode(c < 32 ? 32 : c); } return s.replace(/\s+$/, ''); }
  function tag(b, o, n) { return String.fromCharCode.apply(null, Array.prototype.slice.call(b, o, o + n)); }

  // ───────────── detectar o formato ─────────────
  function detect(b, name) {
    var ext = String(name || '').toLowerCase().replace(/^.*\./, '');
    if (b.length >= 4 && tag(b, 0, 4) === 'MThd') return 'mid';
    if (b.length >= 20 && tag(b, 0, 4) === 'RIFF' && tag(b, 8, 4) === 'RMID') return 'mid';
    if (b.length >= 17 && tag(b, 0, 17) === 'Extended Module: ') return 'xm';
    if (b.length >= 4 && tag(b, 0, 4) === 'IMPM') return 'it';
    if (b.length >= 0x30 && tag(b, 0x2C, 4) === 'SCRM') return 's3m';
    if (b.length >= 3 && tag(b, 0, 3) === 'S98') return 's98';
    if (b.length >= 1084) {
      var t = tag(b, 1080, 4);
      if (/^(M\.K\.|M!K!|M&K!|FLT[48]|EXO[48]|OKTA|OCTA|CD81|CD61|N\.T\.|FEST|\d\dCH|\d\dCN|\dCHN|TDZ\d)$/.test(t)) return 'mod';
    }
    if (ext === 'mod' && b.length > 600) return 'mod15';
    return null;
  }

  // ───────────── resultado no formato do Studio ─────────────
  function Builder(fmtName) {
    this.col = new api.Collector(); this.REC = []; this.mchans = []; this.seen = {}; this.fmt = fmtName;
  }
  Builder.prototype.chan = function (id, chip, label, kind) { if (!this.seen[id]) { this.seen[id] = 1; this.mchans.push({ id: id, chip: chip, label: label, kind: kind }); } };
  Builder.prototype.finish = function (info, chips, total, loopAt) {
    var col = this.col, REC = this.REC;
    REC.sort(function (a, b) { return a.t - b.t || (a.k === 'off' ? -1 : b.k === 'off' ? 1 : 0); });
    col.list.forEach(function (x) {
      x.median = x.notes.length ? x.notes.slice().sort(function (a, b) { return a - b; })[x.notes.length >> 1] : 60;
      x.role = api.roleOf(x);
    });
    var list = col.list.slice().sort(function (a, b) { return b.count - a.count; });
    var num = {};
    list.forEach(function (x) {
      num[x.chip] = (num[x.chip] || 0) + 1; x.n = num[x.chip];
      x.chanList = Object.keys(x.chans).sort(function (a, b) { return x.chans[b] - x.chans[a]; });
      delete x.notes; delete x.key;
    });
    var used = {}; REC.forEach(function (e) { if (e.k === 'on') used[e.c] = (used[e.c] || 0) + 1; });
    var mch = this.mchans.filter(function (m) { return used[m.id]; }).map(function (m) { m.notes = used[m.id]; return m; });
    return { info: info, chips: chips, unsupported: [], timbres: list, seconds: total / SR, totalSamples: total, loopSamples: loopAt >= 0 ? total - loopAt : 0,
      midi: { events: REC, chans: mch }, format: this.fmt };
  };

  // sample (Float32 de -1 a 1) → timbre de sample do Studio, tocando na altura certa quando a nota é "base"
  function pcmTimbre(B, chip, key, data, rate, loop, base, name, chLabel, note) {
    // nomes vazios ou só de traços/sublinhados (comuns em módulos, que usam os nomes para recados) viram "Sample N"
    if (!name || !/[A-Za-z0-9\u00C0-\u024F].*[A-Za-z0-9\u00C0-\u024F]/.test(name)) name = 'Sample ' + ((String(key).match(/\d+/) || [''])[0]);
    return B.col.add(chip + '|' + key, function () {
      var s = api.store(data, rate, loop);
      var ratio = s.rate / rate;   // o leitor pode ter reduzido a taxa (acima de 32 kHz)
      return { type: 'pcm', pcmId: s.id, rate: s.rate, len: s.len, loop: s.loop, base: base, drum: null, tune: 0, name: name || undefined, refRate: rate * ratio };
    }, chLabel, note, chip);
  }
  // loop de ida e volta (ping-pong) vira loop normal: o trecho do loop é copiado ao contrário no fim
  function unrollPingPong(d, ls, le) {
    var seg = le - ls; if (seg < 2) return { data: d.subarray(0, le), loop: ls };
    var out = new Float32Array(le + seg - 1); out.set(d.subarray(0, le));
    for (var i = 0; i < seg - 1; i++) out[le + i] = d[le - 2 - i];
    return { data: out, loop: ls };
  }

  // ═════════════ motor de tracker (comum a MOD, S3M, XM e IT) ═════════════
  // S: { fmt, chip, nch, orders[], pats[] (rows → células {n, i, v, fx, p}), speed, tempo, linear, pan[], smp(ins, note) }
  // n: nota MIDI (60 = toca o sample na taxa de referência), 254 = corta, 255 = solta (key off), -1 = vazio
  // fx: letra no padrão do Impulse Tracker (A speed, B pula, C quebra, D volume, E/F porta, G porta p/ nota, H vibrato, J arpejo, K, L, O, Q, S…, T tempo, U, X pan)
  function runTracker(S, B) {
    var ch = [], i, total = 0, maxT = SR * 60 * 20;
    for (i = 0; i < S.nch; i++) ch.push({ id: S.chip + ' · ' + (S.label || 'Canal') + ' ' + (i + 1), lbl: (S.label || 'Canal') + ' ' + (i + 1), on: false, tb: null, sm: null, pm: 60, base: 60, vol: 64, pan: S.pan ? S.pan[i] : 64,
      gp: 0, gs: 0, gt: null, vs: 0, vd: 0, vp: 0, lastD: 0, lastEF: 0, lastJ: 0, lastQ: 0, loopRow: 0, loopCnt: 0, offAt: Infinity, ePm: null, eVol: null, cv: S.chanVol ? S.chanVol[i] : 64, muted: S.mute && S.mute[i] });
    var speed = S.speed || 6, tempo = S.tempo || 125, t = 0;
    var ord = 0, row = 0, visited = {}, loopAt = -1, guard = 0;
    function tickLen() { return SR * 2.5 / Math.max(32, tempo); }
    function P4(pm) { return 1712 * Math.pow(2, (60 - pm) / 12); }
    function fromP4(p) { return 60 + 12 * Math.log(1712 / Math.max(1, p)) / Math.LN2; }
    function slide(c, units) {   // units > 0 = sobe (na unidade do formato: período ×4 ou 1/64 de semitom)
      if (S.linear) c.pm += units / 64; else c.pm = fromP4(Math.max(56, P4(c.pm) - units));
    }
    function emitOff(c, at) { if (c.on) { B.REC.push({ c: c.id, t: Math.round(at), k: 'off' }); c.on = false; c.offAt = Infinity; } }
    function vOut(c) { return Math.max(0, Math.min(1, c.vol / 64 * (c.sv == null ? 1 : c.sv) * c.cv / 64)); }
    function noteOn(c, at) {
      if (!c.tb || c.muted) return;
      if (c.on) emitOff(c, at);
      B.chan(c.id, S.chip, c.lbl, c.tb.type === 'opl' ? 'fm' : 'psg');
      var n = c.pm;
      B.REC.push({ c: c.id, t: Math.round(at), k: 'on', n: n, v: vOut(c), pan: c.pan, tb: c.tb });
      c.on = true; c.ePm = n; c.eVol = vOut(c);
      // sample sem loop: a nota acaba quando o sample acaba
      if (c.sm && c.sm.loop < 0 && c.sm.len > 0) { var hz = c.sm.refRate * Math.pow(2, (n - c.base) / 12); c.offAt = at + c.sm.len / Math.max(1, hz) * SR; }
      else c.offAt = Infinity;
    }
    function track(c, at) {   // altura e volume que mudaram durante a nota
      if (!c.on) return;
      var p = c.pm + (c.arp || 0) + (c.vib || 0);
      if (Math.abs(p - c.ePm) > 0.02) { B.REC.push({ c: c.id, t: Math.round(at), k: 'pitch', n: p }); c.ePm = p; }
      var v = vOut(c);
      if (Math.abs(v - c.eVol) > 0.02) { B.REC.push({ c: c.id, t: Math.round(at), k: 'vol', v: v }); c.eVol = v; }
    }
    var SINE = []; for (i = 0; i < 64; i++) SINE.push(Math.sin(2 * Math.PI * i / 64));
    while (ord < S.orders.length && t < maxT && guard++ < 100000) {
      var pi = S.orders[ord];
      if (pi === 254) { ord++; row = 0; continue; }
      if (pi === 255 || pi == null) break;
      var pat = S.pats[pi];
      if (!pat || !pat.rows) { ord++; row = 0; continue; }
      if (row >= pat.rows) { ord++; row = 0; continue; }
      var key = ord * 256 + row, inLoop = ch.some(function (c) { return c.loopCnt > 0; });
      if (visited[key] != null && !inLoop) { loopAt = visited[key]; break; }
      if (visited[key] == null) visited[key] = t;
      var cells = pat.data[row] || [], jumpOrd = -1, breakRow = -1, patDelay = 0, loopTo = -1;
      // linha: primeiro os comandos que valem para a linha toda
      for (i = 0; i < S.nch; i++) {
        var x = cells[i]; if (!x || !x.fx) continue;
        if (x.fx === 'A' && x.p) speed = x.p;
        else if (x.fx === 'T' && x.p >= 0x20) tempo = x.p;
        else if (x.fx === 'B') { jumpOrd = x.p; if (breakRow < 0) breakRow = 0; }
        else if (x.fx === 'C') { breakRow = x.p; if (jumpOrd < 0) jumpOrd = ord + 1; }
        else if (x.fx === 'S' && (x.p >> 4) === 0xE && !patDelay) patDelay = x.p & 15;
        else if (x.fx === 'STOP') { jumpOrd = S.orders.length; breakRow = 0; }
      }
      var ticks = speed * (1 + patDelay);
      for (var tk = 0; tk < ticks; tk++) {
        var tick = tk % speed, at = t + tk * tickLen();
        for (i = 0; i < S.nch; i++) {
          var c = ch[i], cl = cells[i] || {}, fx = cl.fx || '', p = cl.p || 0, hi = p >> 4, lo = p & 15;
          if (c.on && c.offAt <= at) emitOff(c, c.offAt);
          var delay = fx === 'S' && hi === 0xD ? lo : 0;
          if (tk === delay && tk < speed && (cl.n != null && cl.n >= 0 || cl.i)) {
            // nota nova (ou só instrumento: volta o volume padrão)
            if (cl.i) { var ins = cl.i; c.ins = ins; }
            if (cl.n === 254 || cl.n === 255) { emitOff(c, at); }
            else {
              var porta = fx === 'G' || fx === 'L' || (cl.vfx === 'G');
              if (cl.n != null && cl.n >= 0) {
                var info = S.smp(c.ins, cl.n);
                if (porta && c.on) { c.gt = cl.n + (info ? info.rel || 0 : 0); }
                else if (info) {
                  c.tb = info.tb; c.sm = info.sm; c.base = info.base; c.sv = info.gv == null ? 1 : info.gv;
                  c.pm = cl.n + (info.rel || 0); c.vib = 0; c.arp = 0;
                  if (cl.i) c.vol = info.vol == null ? 64 : info.vol;
                  if (cl.v != null && cl.v >= 0) c.vol = cl.v;
                  if (info.pan != null) c.pan = info.pan;
                  noteOn(c, at);
                }
              } else if (cl.i) { var inf2 = S.smp(c.ins, null); if (inf2 && inf2.vol != null) c.vol = inf2.vol; }
            }
          }
          if (tk === 0 && cl.v != null && cl.v >= 0 && !(cl.n >= 0 && cl.n < 254)) c.vol = cl.v;
          // efeitos
          c.arp = 0;
          if (fx === 'D' || fx === 'K' || fx === 'L') {
            var dp = p || c.lastD; c.lastD = dp; var dh = dp >> 4, dl = dp & 15;
            if (dl === 0xF && dh) { if (tick === 0) c.vol += dh; }
            else if (dh === 0xF && dl) { if (tick === 0) c.vol -= dl; }
            else if (tick > 0 || (S.fmt === 'it' && false)) { if (dh) c.vol += dh; else c.vol -= dl; }
            c.vol = Math.max(0, Math.min(64, c.vol));
          }
          if (fx === 'E' || fx === 'F') {
            var ep = p || c.lastEF; c.lastEF = ep; var sg = fx === 'F' ? 1 : -1, eh = ep >> 4;
            if (eh === 0xF) { if (tick === 0) slide(c, sg * 4 * (ep & 15)); }
            else if (eh === 0xE) { if (tick === 0) slide(c, sg * (ep & 15)); }
            else if (tick > 0) slide(c, sg * 4 * ep);
          }
          if (fx === 'G' || fx === 'L' || cl.vfx === 'G') {
            var gp = fx === 'G' ? p : cl.vfx === 'G' ? cl.vp : 0; if (gp) c.gs = gp;
            if (tick > 0 && c.gt != null) {
              var tgt = c.gt, step = c.gs * 4;
              if (S.linear) { var dd = step / 64; c.pm = c.pm < tgt ? Math.min(tgt, c.pm + dd) : Math.max(tgt, c.pm - dd); }
              else { var a = P4(c.pm), b4 = P4(tgt); a = a > b4 ? Math.max(b4, a - step) : Math.min(b4, a + step); c.pm = fromP4(a); }
              if (Math.abs(c.pm - tgt) < 0.001) c.gt = null;
            }
          }
          if (fx === 'H' || fx === 'K' || fx === 'U') {
            if (fx !== 'K') { if (hi) c.vs = hi; if (lo) c.vd = lo; }
            if (tick > 0) c.vp = (c.vp + c.vs) & 63;
            c.vib = SINE[c.vp] * c.vd * (fx === 'U' ? 0.03 : 0.12);
          } else c.vib = 0;
          if (fx === 'J') { var jp = p || c.lastJ; c.lastJ = jp; var m3 = tick % 3; c.arp = m3 === 1 ? jp >> 4 : m3 === 2 ? jp & 15 : 0; }
          if (fx === 'M' && tick === 0) c.cv = Math.min(64, p);
          if (fx === 'X' && tick === 0) c.pan = Math.round(p * 127 / 255);
          if (fx === 'S' && tick === 0 && hi === 8) c.pan = Math.round(lo * 127 / 15);
          if (fx === 'S' && hi === 0xC && tick === lo && lo > 0) { c.vol = 0; emitOff(c, at); }
          if (fx === 'Q') { var qp = p || c.lastQ; c.lastQ = qp; var qn = qp & 15; if (qn && tick > 0 && tick % qn === 0 && c.on) noteOn(c, at); }
          if (fx === 'S' && tick === 0 && tk === 0 && hi === 0xB) {
            if (lo === 0) c.loopRow = row;
            else if (c.loopCnt === 0) { c.loopCnt = lo; loopTo = c.loopRow; }
            else if (--c.loopCnt > 0) loopTo = c.loopRow;
          }
          if (fx === 'KOFF' && tick === p) emitOff(c, at);
          // coluna de volume do XM/IT com slides
          if (cl.vfx === 'D' && tick > 0) c.vol = Math.max(0, Math.min(64, c.vol + cl.vp));
          if (cl.vfx === 'FD' && tick === 0) c.vol = Math.max(0, Math.min(64, c.vol + cl.vp));
          if (fx === 'T' && p < 0x20 && tick > 0) tempo = Math.max(32, Math.min(255, tempo + ((p >> 4) === 1 ? (p & 15) : -(p & 15))));
          track(c, at);
        }
      }
      t += ticks * tickLen();
      if (loopTo >= 0) { row = loopTo; continue; }
      if (jumpOrd >= 0) {
        if (jumpOrd <= ord && breakRow <= row && jumpOrd === ord && false) {}
        ord = jumpOrd; row = Math.max(0, breakRow);
        if (ord >= S.orders.length) break;
        continue;
      }
      row++;
      if (row >= pat.rows) { ord++; row = 0; }
    }
    total = Math.round(t);
    ch.forEach(function (c) { if (c.on) emitOff(c, Math.min(c.offAt, total)); });
    return { total: total, loopAt: loopAt >= 0 ? Math.round(loopAt) : -1 };
  }

  // ═════════════ MOD (ProTracker e parentes) ═════════════
  function readMOD(b, b15) {
    var nS = b15 ? 15 : 31, nch = 4;
    if (!b15) {
      var tg = tag(b, 1080, 4), m;
      if ((m = /^(\d)CHN$/.exec(tg))) nch = +m[1];
      else if ((m = /^(\d\d)C[HN]$/.exec(tg))) nch = +m[1];
      else if ((m = /^TDZ(\d)$/.exec(tg))) nch = +m[1];
      else if (/^(FLT8|EXO8|OKTA|OCTA|CD81)$/.test(tg)) nch = 8;
      else if (tg === 'CD61') nch = 6;
    }
    var smps = [], o = 20;
    for (var i = 0; i < nS; i++, o += 30) {
      smps.push({ name: str(b, o, 22), len: ((b[o + 22] << 8) | b[o + 23]) * 2, ft: s8((b[o + 24] & 15) << 4) >> 4, vol: Math.min(64, b[o + 25]),
        ls: ((b[o + 26] << 8) | b[o + 27]) * 2, ll: ((b[o + 28] << 8) | b[o + 29]) * 2 });
    }
    var songLen = b[o], orders = Array.prototype.slice.call(b, o + 2, o + 2 + 128).slice(0, songLen || 1);
    var nPat = 0; Array.prototype.slice.call(b, o + 2, o + 2 + 128).forEach(function (x) { if (x + 1 > nPat && x < 128) nPat = x + 1; });
    var po = b15 ? 600 : 1084, pats = [];
    for (var pidx = 0; pidx < nPat; pidx++) {
      var data = [];
      for (var r = 0; r < 64; r++) {
        var rowc = [];
        for (var c = 0; c < nch; c++) {
          var q = po + (pidx * 64 * nch + r * nch + c) * 4; if (q + 3 >= b.length) { rowc.push({}); continue; }
          var smp = (b[q] & 0xF0) | (b[q + 2] >> 4), per = ((b[q] & 15) << 8) | b[q + 1], ef = b[q + 2] & 15, pr = b[q + 3];
          var cell = { i: smp, n: per ? 60 + 12 * Math.log(428 / per) / Math.LN2 : -1 };
          if (cell.n >= 0) cell.n = Math.round(cell.n * 8) / 8;
          modFx(cell, ef, pr, false);
          rowc.push(cell);
        }
        data.push(rowc);
      }
      pats.push({ rows: 64, data: data });
    }
    var so = po + nPat * 64 * nch * 4;
    smps.forEach(function (s) { s.off = so; so += s.len; });
    return { title: str(b, 0, 20), nch: nch, smps: smps, orders: orders, pats: pats, b: b };
  }
  // efeito de MOD/XM → letra do Impulse Tracker
  function modFx(cell, ef, p, xm) {
    var hi = p >> 4, lo = p & 15;
    switch (ef) {
      case 0: if (p) { cell.fx = 'J'; cell.p = p; } break;
      case 1: cell.fx = 'F'; cell.p = Math.min(0xDF, p); break;
      case 2: cell.fx = 'E'; cell.p = Math.min(0xDF, p); break;
      case 3: cell.fx = 'G'; cell.p = p; break;
      case 4: cell.fx = 'H'; cell.p = p; break;
      case 5: cell.fx = 'L'; cell.p = hi ? hi << 4 : lo; break;
      case 6: cell.fx = 'K'; cell.p = hi ? hi << 4 : lo; break;
      case 8: cell.fx = 'X'; cell.p = p; break;
      case 9: cell.fx = 'O'; cell.p = p; break;
      case 0xA: cell.fx = 'D'; cell.p = hi ? hi << 4 : lo; break;
      case 0xB: cell.fx = 'B'; cell.p = p; break;
      case 0xC: cell.v = Math.min(64, p); break;
      case 0xD: cell.fx = 'C'; cell.p = xm ? hi * 10 + lo : hi * 10 + lo; break;
      case 0xE:
        switch (hi) {
          case 1: cell.fx = 'F'; cell.p = 0xF0 | lo; break;
          case 2: cell.fx = 'E'; cell.p = 0xF0 | lo; break;
          case 6: cell.fx = 'S'; cell.p = 0xB0 | lo; break;
          case 8: cell.fx = 'S'; cell.p = 0x80 | lo; break;
          case 9: cell.fx = 'Q'; cell.p = lo; break;
          case 0xA: cell.fx = 'D'; cell.p = (lo << 4) | 0xF; break;
          case 0xB: cell.fx = 'D'; cell.p = 0xF0 | lo; break;
          case 0xC: cell.fx = 'S'; cell.p = 0xC0 | lo; break;
          case 0xD: cell.fx = 'S'; cell.p = 0xD0 | lo; break;
          case 0xE: cell.fx = 'S'; cell.p = 0xE0 | lo; break;
        }
        break;
      case 0xF: if (p === 0 && !xm) { cell.fx = 'STOP'; } else if (p < 0x20) { cell.fx = 'A'; cell.p = p; } else { cell.fx = 'T'; cell.p = p; } break;
      case 0x14: if (xm) { cell.fx = 'KOFF'; cell.p = p; } break;   // XM: Kxx (solta a nota no tick xx)
      case 0x1B: if (xm) { cell.fx = 'Q'; cell.p = p; } break;     // XM: Rxy (repete a nota)
      case 0x21: if (xm) { cell.fx = hi === 1 ? 'F' : hi === 2 ? 'E' : ''; cell.p = 0xE0 | lo; } break; // X1/X2: porta extra fina
    }
  }
  function parseMOD(b, b15) {
    var M = readMOD(b, b15), B = new Builder('MOD');
    var chip = 'MOD', tbs = [];
    var S = { fmt: 'mod', chip: chip, nch: M.nch, orders: M.orders, pats: M.pats, speed: 6, tempo: 125, linear: false,
      pan: [], smp: function (ins, n) {
        var s = M.smps[(ins || 0) - 1]; if (!s || s.len < 4) return null;
        if (!tbs[ins]) {
          var len = Math.min(s.len, b.length - s.off); if (len < 4) return null;
          var d = new Float32Array(len); for (var k = 0; k < len; k++) d[k] = s8(b[s.off + k]) / 128;
          var lp = s.ll > 2 ? s.ls : -1; if (lp >= 0) d = d.subarray(0, Math.min(len, s.ls + s.ll));
          var base = 60 - s.ft / 8;
          tbs[ins] = { s: s, len: d.length, loop: lp, data: d, base: base };
        }
        var e = tbs[ins];
        var tb = pcmTimbre(B, chip, 'smp' + ins, e.data, 8363, e.loop, e.base, e.s.name || ('Sample ' + ins), null, n != null ? n : 0);
        return { tb: tb, sm: { refRate: 8363, len: e.len, loop: e.loop }, base: e.base, vol: e.s.vol, rel: 0 };
      } };
    for (var c = 0; c < M.nch; c++) S.pan.push((c & 3) === 0 || (c & 3) === 3 ? 32 : 96);   // Amiga: canais 1 e 4 à esquerda, 2 e 3 à direita
    var r = runTracker(S, B);
    fixChans(B);
    return B.finish({ title: M.title, system: M.nch + ' ' + 'canais' }, [chip + ' · ' + M.nch + ' ch'], r.total, r.loopAt);
  }
  // o Collector conta canais pelo rótulo passado na hora do add: acerta com os canais onde cada timbre tocou de verdade
  function fixChans(B) {
    var per = new Map(), lblOf = {};
    B.mchans.forEach(function (m) { lblOf[m.id] = m.label; });
    B.REC.forEach(function (e) {
      if (e.k !== 'on' || !e.tb) return;
      var m = per.get(e.tb); if (!m) per.set(e.tb, m = {});
      var lbl = lblOf[e.c] || e.c; m[lbl] = (m[lbl] || 0) + 1;
    });
    B.col.list.forEach(function (t) {
      var m = per.get(t);
      t.chans = m || {}; t.count = 0; t.notes = []; t.lo = 999; t.hi = -999;
    });
    B.REC.forEach(function (e) {
      if (e.k !== 'on' || !e.tb) return;
      var t = e.tb; t.count++;
      if (t.type !== 'pcm' || t.base != null) { t.lo = Math.min(t.lo, e.n); t.hi = Math.max(t.hi, e.n); if (t.notes.length < 400) t.notes.push(Math.round(e.n)); }
    });
    B.col.list = B.col.list.filter(function (t) { return t.count > 0; });
  }

  // ═════════════ S3M (Scream Tracker 3) ═════════════
  function parseS3M(b) {
    var B = new Builder('S3M');
    var ordNum = u16(b, 0x20), insNum = u16(b, 0x22), patNum = u16(b, 0x24), flags = u16(b, 0x26), ffi = u16(b, 0x2A);
    var speed = b[0x31] || 6, tempo = b[0x32] || 125, mv = b[0x33];
    var chset = [], chMap = [], nch = 0;
    for (var i = 0; i < 32; i++) { chset.push(b[0x40 + i]); if (b[0x40 + i] < 32) { chMap[i] = nch++; } else chMap[i] = -1; }
    var orders = Array.prototype.slice.call(b, 0x60, 0x60 + ordNum);
    var io = 0x60 + ordNum, insPtr = [], patPtr = [];
    for (i = 0; i < insNum; i++) insPtr.push(u16(b, io + i * 2) * 16);
    for (i = 0; i < patNum; i++) patPtr.push(u16(b, io + insNum * 2 + i * 2) * 16);
    var panO = io + insNum * 2 + patNum * 2, pan = [];
    for (i = 0; i < 32; i++) {
      if (chMap[i] < 0) continue;
      var p0 = chset[i] < 8 ? 3 : chset[i] < 16 ? 12 : 7;
      if (b[0x35] === 252 && (b[panO + i] & 0x20)) p0 = b[panO + i] & 15;
      if (!(mv & 0x80)) p0 = 7;   // mono
      pan[chMap[i]] = Math.round(p0 * 127 / 15);
    }
    var ins = [];
    for (i = 0; i < insNum; i++) {
      var o = insPtr[i]; if (!o || o + 0x50 > b.length) { ins.push(null); continue; }
      var typ = b[o], name = str(b, o + 0x30, 28) || str(b, o + 1, 12);
      if (typ === 1) {
        var mem = ((b[o + 0x0D] << 16) | u16(b, o + 0x0E)) * 16, len = u32(b, o + 0x10), ls = u32(b, o + 0x14), le = u32(b, o + 0x18);
        var fl = b[o + 0x1F], c2 = u32(b, o + 0x20) || 8363, w16 = fl & 4, st = fl & 2;
        var bps = (w16 ? 2 : 1) * (st ? 2 : 1); len = Math.min(len, Math.floor((b.length - mem) / bps));
        if (len < 2) { ins.push(null); continue; }
        var d = new Float32Array(len);
        for (var k = 0; k < len; k++) {
          var q = mem + k * (w16 ? 2 : 1);
          if (w16) { var v16 = u16(b, q); d[k] = (ffi === 2 ? v16 - 32768 : (v16 << 16) >> 16) / 32768; }
          else { var v8 = b[q]; d[k] = (ffi === 2 ? v8 - 128 : s8(v8)) / 128; }
        }
        var lp = (fl & 1) && le > ls && le <= len ? ls : -1; if (lp >= 0) d = d.subarray(0, le);
        ins.push({ pcm: true, name: name, d: d, loop: lp, rate: c2, vol: Math.min(64, b[o + 0x1C]) });
      } else if (typ === 2) {
        var R = function (k2) { return b[o + 0x10 + k2]; };
        var op = function (k2) {
          return { am: R(k2) >> 7, vib: (R(k2) >> 6) & 1, egt: (R(k2) >> 5) & 1, ksr: (R(k2) >> 4) & 1, mul: R(k2) & 15, ksl: R(2 + k2) >> 6, tl: R(2 + k2) & 63,
            ar: R(4 + k2) >> 4, dr: R(4 + k2) & 15, sl: R(6 + k2) >> 4, rr: R(6 + k2) & 15, ws: R(8 + k2) & 3 };
        };
        ins.push({ opl: { type: 'opl', oplKind: 'opl2', clock: 3579545, rate: 3579545 / 72, alg: R(10) & 1, fb: (R(10) >> 1) & 7, four: false, ops: [op(0), op(1)], dam: 0, dvb: 0, tune: 0, name: name },
          vol: Math.min(64, b[o + 0x1C]), rate: u32(b, o + 0x20) || 8363, name: name });
      } else ins.push(null);
    }
    var pats = [];
    for (i = 0; i < patNum; i++) {
      var po = patPtr[i], data = [];
      if (!po) { pats.push(null); continue; }
      var p = po + 2;
      for (var r = 0; r < 64; r++) {
        var rowc = [];
        while (p < b.length) {
          var w = b[p++]; if (!w) break;
          var cn = chMap[w & 31], cell = {};
          if (w & 32) { var nt = b[p++], ii = b[p++]; cell.n = nt === 255 ? -1 : nt === 254 ? 254 : (nt >> 4) * 12 + (nt & 15) + 12; cell.i = ii; }
          if (w & 64) { cell.v = Math.min(64, b[p++]); }
          if (w & 128) { var cmd = b[p++], inf = b[p++]; if (cmd >= 1 && cmd <= 26) { cell.fx = String.fromCharCode(64 + cmd); cell.p = inf; } }
          if (cell.fx === 'C') cell.p = (cell.p >> 4) * 10 + (cell.p & 15);
          if (cell.fx === 'V' || cell.fx === 'Z') delete cell.fx;
          if (cn >= 0) rowc[cn] = cell;
        }
        data.push(rowc);
      }
      pats.push({ rows: 64, data: data });
    }
    var tbs = {};
    var S = { fmt: 's3m', chip: 'S3M', nch: nch, orders: orders, pats: pats, speed: speed, tempo: tempo, linear: false, pan: pan,
      smp: function (ii, n) {
        var I = ins[(ii || 0) - 1]; if (!I) return null;
        if (I.opl) {
          var key = 'opl' + ii, tb = tbs[key];
          if (!tb) tb = tbs[key] = B.col.add('OPL2|' + key, function () { var x = JSON.parse(JSON.stringify(I.opl)); x.tune = oplTune(x); return x; }, null, 0, 'OPL2 (AdLib)');
          return { tb: tb, sm: null, base: 60, vol: I.vol, rel: 12 * Math.log(I.rate / 8363) / Math.LN2 };
        }
        var tb2 = pcmTimbre(B, 'S3M', 'smp' + ii, I.d, I.rate, I.loop, 60, I.name || ('Sample ' + ii), null, n != null ? n : 0);
        return { tb: tb2, sm: { refRate: I.rate, len: I.d.length, loop: I.loop }, base: 60, vol: I.vol, rel: 0 };
      } };
    var r2 = runTracker(S, B);
    fixChans(B);
    var chips = ['S3M · ' + nch + ' ch']; if (ins.some(function (x) { return x && x.opl; }) && B.col.list.some(function (t) { return t.type === 'opl'; })) chips.push('OPL2 (AdLib)');
    return B.finish({ title: str(b, 0, 28) }, chips, r2.total, r2.loopAt);
  }
  var OPL_MUL = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15];
  function oplTune(t) {
    var car = t.alg ? [0, 1] : [1], best = null;
    car.forEach(function (i) { var o = t.ops[i]; if (!best || o.tl < best.tl) best = o; });
    var mv = OPL_MUL[best.mul]; return [0.5, 1, 2, 4, 8].indexOf(mv) >= 0 ? -12 * Math.log(mv) / Math.LN2 : 0;
  }

  // ═════════════ XM (FastTracker 2) ═════════════
  function parseXM(b) {
    var B = new Builder('XM');
    var hs = u32(b, 60), songLen = u16(b, 64), nch = u16(b, 68), nPat = u16(b, 70), nIns = u16(b, 72), flags = u16(b, 74);
    var speed = u16(b, 76) || 6, tempo = u16(b, 78) || 125;
    var orders = Array.prototype.slice.call(b, 80, 80 + Math.min(256, songLen));
    var o = 60 + hs, pats = [];
    for (var pi = 0; pi < nPat; pi++) {
      var phl = u32(b, o), rows = u16(b, o + 5) || 64, psz = u16(b, o + 7), p = o + phl, end = p + psz, data = [];
      for (var r = 0; r < rows; r++) {
        var rowc = [];
        for (var c = 0; c < nch; c++) {
          var cell = {};
          if (p >= end) { rowc.push(cell); continue; }
          var f = b[p], nt = 0, ii = 0, vv = 0, ef = 0, pr = 0;
          if (f & 0x80) { p++; if (f & 1) nt = b[p++]; if (f & 2) ii = b[p++]; if (f & 4) vv = b[p++]; if (f & 8) ef = b[p++]; if (f & 16) pr = b[p++]; }
          else { nt = b[p]; ii = b[p + 1]; vv = b[p + 2]; ef = b[p + 3]; pr = b[p + 4]; p += 5; }
          if (nt === 97) cell.n = 255; else if (nt >= 1 && nt <= 96) cell.n = nt + 11;
          if (ii) cell.i = ii;
          if (vv >= 0x10 && vv <= 0x50) cell.v = vv - 0x10;
          else if (vv >= 0x60 && vv < 0x70) { cell.vfx = 'D'; cell.vp = -(vv & 15); }
          else if (vv >= 0x70 && vv < 0x80) { cell.vfx = 'D'; cell.vp = vv & 15; }
          else if (vv >= 0x80 && vv < 0x90) { cell.vfx = 'FD'; cell.vp = -(vv & 15); }
          else if (vv >= 0x90 && vv < 0xA0) { cell.vfx = 'FD'; cell.vp = vv & 15; }
          else if (vv >= 0xF0) { cell.vfx = 'G'; cell.vp = (vv & 15) << 4; }
          if (ef || pr) modFx(cell, ef, pr, true);
          rowc.push(cell);
        }
        data.push(rowc);
      }
      pats.push({ rows: rows, data: data });
      o = end;
    }
    var insts = [];
    for (var ii2 = 0; ii2 < nIns && o + 29 <= b.length; ii2++) {
      var isz = u32(b, o), iname = str(b, o + 4, 22), ns = u16(b, o + 27), I = { name: iname, smps: [], map: null };
      if (!ns) { o += isz; insts.push(I); continue; }
      var shs = u32(b, o + 29); I.map = Array.prototype.slice.call(b, o + 33, o + 33 + 96);
      var so = o + isz, sh = [];
      for (var s = 0; s < ns; s++, so += shs) {
        sh.push({ len: u32(b, so), ls: u32(b, so + 4), ll: u32(b, so + 8), vol: Math.min(64, b[so + 12]), ft: s8(b[so + 13]), type: b[so + 14], pan: b[so + 15], rel: s8(b[so + 16]), name: str(b, so + 18, 22) });
      }
      sh.forEach(function (S2) {
        var w16 = S2.type & 16, n = w16 ? S2.len >> 1 : S2.len, d = new Float32Array(n), acc = 0;
        for (var k = 0; k < n && so + (w16 ? k * 2 + 1 : k) < b.length; k++) {
          if (w16) { acc = (acc + ((u16(b, so + k * 2) << 16) >> 16)) & 0xFFFF; d[k] = ((acc << 16) >> 16) / 32768; }
          else { acc = (acc + b[so + k]) & 0xFF; d[k] = s8(acc) / 128; }
        }
        so += S2.len;
        var lt = S2.type & 3, ls = w16 ? S2.ls >> 1 : S2.ls, ll = w16 ? S2.ll >> 1 : S2.ll, lp = -1;
        if (lt && ll > 1 && ls + ll <= n) {
          if (lt === 2) { var u = unrollPingPong(d, ls, ls + ll); d = u.data; lp = u.loop; } else { d = d.subarray(0, ls + ll); lp = ls; }
        }
        I.smps.push({ d: d, loop: lp, vol: S2.vol, ft: S2.ft, rel: S2.rel, pan: S2.pan, name: S2.name });
      });
      o = so; insts.push(I);
    }
    var S = { fmt: 'xm', chip: 'XM', nch: nch, orders: orders, pats: pats, speed: speed, tempo: tempo, linear: !!(flags & 1), pan: [],
      smp: function (ii, n) {
        var I2 = insts[(ii || 0) - 1]; if (!I2 || !I2.smps.length) return null;
        var si = I2.map && n != null ? I2.map[Math.max(0, Math.min(95, Math.round(n) - 12))] || 0 : 0, sm = I2.smps[si] || I2.smps[0];
        if (!sm || sm.d.length < 2) return null;
        var base = 60 - sm.rel - sm.ft / 128;
        var tb = pcmTimbre(B, 'XM', 'i' + ii + 's' + si, sm.d, 8363, sm.loop, base, sm.name || I2.name || ('Instrumento ' + ii), null, n != null ? n : 0);
        return { tb: tb, sm: { refRate: 8363, len: sm.d.length, loop: sm.loop }, base: base, vol: sm.vol, pan: Math.round(sm.pan * 127 / 255), rel: 0 };
      } };
    for (var c2 = 0; c2 < nch; c2++) S.pan.push(64);
    var r2 = runTracker(S, B);
    fixChans(B);
    return B.finish({ title: str(b, 17, 20) }, ['XM · ' + nch + ' ch'], r2.total, r2.loopAt);
  }

  // ═════════════ IT / MPTM (Impulse Tracker, OpenMPT) ═════════════
  // descompressão IT 2.14/2.15 (amostras comprimidas)
  function itDecompress(b, off, len, w16, it215) {
    var out = new Float32Array(len), o = 0, p = off;
    while (o < len && p + 2 <= b.length) {
      var blkLen = u16(b, p); p += 2; var bp = p, bit = 0, end = p + blkLen; p = end;
      var blockN = Math.min(len - o, w16 ? 0x4000 : 0x8000), width = w16 ? 17 : 9, d1 = 0, d2 = 0, n = 0;
      function rd(nb) { var v = 0; for (var k = 0; k < nb; k++) { if (bp >= end) return v; v |= ((b[bp] >> bit) & 1) << k; if (++bit === 8) { bit = 0; bp++; } } return v; }
      while (n < blockN) {
        var v = rd(width), maxW = w16 ? 17 : 9;
        if (width < 7) {
          if (v === 1 << (width - 1)) { var nw = rd(w16 ? 4 : 3) + 1; width = nw < width ? nw : nw + 1; continue; }
        } else if (width < maxW) {
          var border = w16 ? (0xFFFF >> (17 - width)) - 8 : (0xFF >> (9 - width)) - 4;
          if (v > border && v <= border + (w16 ? 16 : 8)) { var nw2 = v - border; width = nw2 < width ? nw2 : nw2 + 1; continue; }
        } else {
          if (v & (w16 ? 0x10000 : 0x100)) { width = (v + 1) & (w16 ? 0xFF : 0xFF); continue; }
        }
        // valor com sinal na largura atual
        var sh = (w16 ? 32 : 32) - width, sv = (v << sh) >> sh;
        d1 += sv; d2 += d1;
        var val = it215 ? d2 : d1;
        out[o + n] = w16 ? ((val << 16) >> 16) / 32768 : ((val << 24) >> 24) / 128;
        n++;
      }
      o += blockN;
    }
    return out;
  }
  function parseIT(b) {
    var B = new Builder('IT');
    var ordNum = u16(b, 0x20), insNum = u16(b, 0x22), smpNum = u16(b, 0x24), patNum = u16(b, 0x26), cmwt = u16(b, 0x2A), flags = u16(b, 0x2C);
    var speed = b[0x32] || 6, tempo = b[0x33] || 125, useIns = flags & 4, linear = !!(flags & 8);
    var orders = Array.prototype.slice.call(b, 0xC0, 0xC0 + ordNum);
    var o = 0xC0 + ordNum, insOff = [], smpOff = [], patOff = [], i;
    for (i = 0; i < insNum; i++) insOff.push(u32(b, o + i * 4));
    for (i = 0; i < smpNum; i++) smpOff.push(u32(b, o + insNum * 4 + i * 4));
    for (i = 0; i < patNum; i++) patOff.push(u32(b, o + insNum * 4 + smpNum * 4 + i * 4));
    var pan = [], chVol = [], mute = [], nch = 0;
    for (i = 0; i < 64; i++) { var cp = b[0x40 + i]; mute.push(!!(cp & 128)); pan.push(cp === 100 ? 64 : Math.round(Math.min(64, cp & 127) * 127 / 64)); chVol.push(Math.min(64, b[0x80 + i])); }
    var smps = smpOff.map(function (so) {
      if (!so || tag(b, so, 4) !== 'IMPS') return null;
      var fl = b[so + 0x12], len = u32(b, so + 0x30), ls = u32(b, so + 0x34), le = u32(b, so + 0x38), c5 = u32(b, so + 0x3C) || 8363, sp = u32(b, so + 0x48), cvt = b[so + 0x2E];
      var ss = u32(b, so + 0x40), se = u32(b, so + 0x44);
      if (!(fl & 1) || !len) return { name: str(b, so + 0x14, 26), empty: true };
      var w16 = fl & 2, d;
      if (fl & 8) d = itDecompress(b, sp, len, w16, cvt & 4);
      else {
        d = new Float32Array(len); var sgn = cvt & 1;
        for (var k = 0; k < len; k++) {
          var q = sp + k * (w16 ? 2 : 1); if (q + (w16 ? 1 : 0) >= b.length) break;
          d[k] = w16 ? (sgn ? (u16(b, q) << 16) >> 16 : u16(b, q) - 32768) / 32768 : (sgn ? s8(b[q]) : b[q] - 128) / 128;
        }
      }
      var lp = -1;
      var lpFlag = fl & 16, ppFlag = fl & 64;
      if (!lpFlag && (fl & 32)) { lpFlag = 1; ls = ss; le = se; ppFlag = fl & 128; }   // só o loop de sustentação
      if (lpFlag && le > ls && le <= len) {
        if (ppFlag) { var u = unrollPingPong(d, ls, le); d = u.data; lp = u.loop; } else { d = d.subarray(0, le); lp = ls; }
      }
      return { name: str(b, so + 0x14, 26), d: d, loop: lp, rate: c5, vol: Math.min(64, b[so + 0x13]), gv: Math.min(64, b[so + 0x11]) / 64, dfp: b[so + 0x2F] };
    });
    var insts = insOff.map(function (io) {
      if (!io || tag(b, io, 4) !== 'IMPI') return null;
      var map = []; for (var k = 0; k < 120; k++) map.push([b[io + 0x40 + k * 2], b[io + 0x41 + k * 2]]);
      return { name: str(b, io + 0x20, 26), map: map, gv: cmwt >= 0x200 ? Math.min(128, b[io + 0x18]) / 128 : 1 };
    });
    var pats = patOff.map(function (po) {
      if (!po) return { rows: 64, data: [] };
      var plen = u16(b, po), rows = u16(b, po + 2), p = po + 8, end = p + plen, data = [], lastMask = [], last = [];
      for (var r = 0; r < rows; r++) {
        var rowc = [];
        while (p < end) {
          var cv = b[p++]; if (!cv) break;
          var c = (cv - 1) & 63, mask = lastMask[c] || 0, L = last[c] || (last[c] = {}), cell = {};
          if (cv & 128) mask = lastMask[c] = b[p++];
          if (mask & 1) { L.n = b[p++]; }
          if (mask & 2) { L.i = b[p++]; }
          if (mask & 4) { L.v = b[p++]; }
          if (mask & 8) { L.c = b[p++]; L.p = b[p++]; }
          if (mask & 17) cell.n = L.n > 119 ? (L.n === 254 ? 254 : 255) : L.n;
          if (mask & 34) cell.i = L.i;
          if (mask & 68) {
            var vv = L.v;
            if (vv <= 64) cell.v = vv;
            else if (vv >= 65 && vv <= 74) { cell.vfx = 'FD'; cell.vp = vv - 65; }
            else if (vv >= 75 && vv <= 84) { cell.vfx = 'FD'; cell.vp = -(vv - 75); }
            else if (vv >= 85 && vv <= 94) { cell.vfx = 'D'; cell.vp = vv - 85; }
            else if (vv >= 95 && vv <= 104) { cell.vfx = 'D'; cell.vp = -(vv - 95); }
            else if (vv >= 193 && vv <= 202) { cell.vfx = 'G'; cell.vp = [0, 1, 4, 8, 16, 32, 64, 96, 128, 255][vv - 193]; }
          }
          if (mask & 136) { if (L.c >= 1 && L.c <= 26) { cell.fx = String.fromCharCode(64 + L.c); cell.p = L.p; } }
          if (cell.fx === 'V' || cell.fx === 'W' || cell.fx === 'Y' || cell.fx === 'Z' || cell.fx === 'N' || cell.fx === 'P') delete cell.fx;
          if (c + 1 > nch) nch = c + 1;
          rowc[c] = cell;
        }
        data.push(rowc);
      }
      return { rows: rows, data: data };
    });
    nch = Math.max(1, nch);
    var S = { fmt: 'it', chip: 'IT', nch: nch, orders: orders, pats: pats, speed: speed, tempo: tempo, linear: linear, pan: pan.slice(0, nch), chanVol: chVol.slice(0, nch), mute: mute.slice(0, nch),
      smp: function (ii, n) {
        var si = ii, nn = n, iname = '';
        if (useIns) {
          var I = insts[(ii || 0) - 1]; if (!I) return null; iname = I.name;
          if (n == null) { var any = I.map.filter(function (m) { return m[1]; })[0]; si = any ? any[1] : 0; }
          else { var m2 = I.map[Math.max(0, Math.min(119, Math.round(n)))]; si = m2[1]; nn = m2[0] + (n - Math.round(n)); }
        }
        var sm = smps[(si || 0) - 1]; if (!sm || sm.empty || !sm.d || sm.d.length < 2) return null;
        var tb = pcmTimbre(B, 'IT', 's' + si, sm.d, sm.rate, sm.loop, 60, sm.name || iname || ('Sample ' + si), null, nn != null ? nn : 0);
        return { tb: tb, sm: { refRate: sm.rate, len: sm.d.length, loop: sm.loop }, base: 60, vol: sm.vol, gv: sm.gv, rel: nn != null && n != null ? nn - n : 0,
          pan: sm.dfp & 128 ? Math.round((sm.dfp & 127) * 127 / 64) : null };
      } };
    var r2 = runTracker(S, B);
    fixChans(B);
    return B.finish({ title: str(b, 4, 26) }, [(tag(b, 0x3C, 4) === 'OMPT' || /\.mptm$/i.test('') ? 'MPTM' : 'IT') + ' · ' + nch + ' ch'], r2.total, r2.loopAt);
  }

  // ═════════════ MIDI ═════════════
  // timbres: o sample de cada instrumento no SoundFont do player (o mesmo som que se ouve ao tocar a música)
  var GM = ['Piano de cauda', 'Piano acústico', 'Piano elétrico de cauda', 'Piano honky-tonk', 'Piano elétrico 1', 'Piano elétrico 2', 'Cravo', 'Clavinete', 'Celesta', 'Glockenspiel', 'Caixa de música', 'Vibrafone', 'Marimba', 'Xilofone', 'Sinos tubulares', 'Dulcimer',
    'Órgão de tubos (drawbar)', 'Órgão percussivo', 'Órgão de rock', 'Órgão de igreja', 'Harmônio', 'Acordeão', 'Gaita', 'Bandoneón', 'Violão de nylon', 'Violão de aço', 'Guitarra jazz', 'Guitarra limpa', 'Guitarra abafada', 'Guitarra com overdrive', 'Guitarra distorcida', 'Harmônicos de guitarra',
    'Baixo acústico', 'Baixo de dedo', 'Baixo com palheta', 'Baixo fretless', 'Baixo slap 1', 'Baixo slap 2', 'Baixo sintetizado 1', 'Baixo sintetizado 2', 'Violino', 'Viola', 'Violoncelo', 'Contrabaixo', 'Cordas em tremolo', 'Cordas em pizzicato', 'Harpa', 'Tímpanos',
    'Cordas 1', 'Cordas 2', 'Cordas sintetizadas 1', 'Cordas sintetizadas 2', 'Coro "aah"', 'Voz "ooh"', 'Voz sintetizada', 'Orquestra (golpe)', 'Trompete', 'Trombone', 'Tuba', 'Trompete com surdina', 'Trompa', 'Metais', 'Metais sintetizados 1', 'Metais sintetizados 2',
    'Sax soprano', 'Sax alto', 'Sax tenor', 'Sax barítono', 'Oboé', 'Corne inglês', 'Fagote', 'Clarinete', 'Flautim', 'Flauta', 'Flauta doce', 'Flauta de Pã', 'Garrafa soprada', 'Shakuhachi', 'Apito', 'Ocarina',
    'Lead quadrada', 'Lead serra', 'Lead calliope', 'Lead chiff', 'Lead charango', 'Lead voz', 'Lead quintas', 'Lead baixo+lead', 'Pad new age', 'Pad quente', 'Pad polissintetizador', 'Pad coro', 'Pad arco', 'Pad metálico', 'Pad halo', 'Pad varredura',
    'FX chuva', 'FX trilha sonora', 'FX cristal', 'FX atmosfera', 'FX brilho', 'FX goblins', 'FX ecos', 'FX ficção', 'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Gaita de foles', 'Rabeca', 'Shanai',
    'Sininho', 'Agogô', 'Tambor de aço', 'Bloco de madeira', 'Taiko', 'Tom melódico', 'Tambor sintetizado', 'Prato invertido', 'Ruído de traste', 'Respiração', 'Mar', 'Pássaro', 'Telefone', 'Helicóptero', 'Aplausos', 'Tiro'];
  var GMD = { 35: 'Bumbo acústico', 36: 'Bumbo', 37: 'Aro', 38: 'Caixa', 39: 'Palmas', 40: 'Caixa elétrica', 41: 'Tom chão grave', 42: 'Chimbal fechado', 43: 'Tom chão', 44: 'Chimbal no pé', 45: 'Tom grave', 46: 'Chimbal aberto', 47: 'Tom médio-grave', 48: 'Tom médio-agudo',
    49: 'Prato de ataque', 50: 'Tom agudo', 51: 'Prato de condução', 52: 'Prato chinês', 53: 'Cúpula do prato', 54: 'Pandeirola', 55: 'Prato splash', 56: 'Cowbell', 57: 'Prato de ataque 2', 59: 'Prato de condução 2', 60: 'Bongô agudo', 61: 'Bongô grave', 62: 'Conga abafada', 63: 'Conga aberta', 64: 'Conga grave', 69: 'Cabasa', 70: 'Maracas', 75: 'Claves', 76: 'Bloco agudo', 77: 'Bloco grave', 81: 'Triângulo aberto' };
  function parseSF2(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (tag(b, 0, 4) !== 'RIFF' || tag(b, 8, 4) !== 'sfbk') return null;
    var ck = {}, smpl = null;
    (function walk(o, end) {
      while (o + 8 <= end) {
        var id = tag(b, o, 4), sz = u32(b, o + 4);
        if (id === 'LIST') walk(o + 12, o + 8 + sz);
        else if (id === 'smpl') smpl = { o: o + 8, n: sz >> 1 };
        else ck[id] = { o: o + 8, sz: sz };
        o += 8 + sz + (sz & 1);
      }
    })(12, b.length);
    function recs(id, size) { var c = ck[id], a = []; if (!c) return a; for (var o = c.o; o + size <= c.o + c.sz; o += size) a.push(o); return a; }
    var phdr = recs('phdr', 38).map(function (o) { return { name: str(b, o, 20), prog: u16(b, o + 20), bank: u16(b, o + 22), bag: u16(b, o + 24) }; });
    var pbag = recs('pbag', 4).map(function (o) { return u16(b, o); });
    var pgen = recs('pgen', 4).map(function (o) { return [u16(b, o), u16(b, o + 2)]; });
    var inst = recs('inst', 22).map(function (o) { return { name: str(b, o, 20), bag: u16(b, o + 20) }; });
    var ibag = recs('ibag', 4).map(function (o) { return u16(b, o); });
    var igen = recs('igen', 4).map(function (o) { return [u16(b, o), u16(b, o + 2)]; });
    var shdr = recs('shdr', 46).map(function (o) { return { name: str(b, o, 20), st: u32(b, o + 20), en: u32(b, o + 24), ls: u32(b, o + 28), le: u32(b, o + 32), rate: u32(b, o + 36), key: b[o + 40], corr: s8(b[o + 41]) }; });
    function zones(bags, gens, from, to) {
      var out = [];
      for (var z = from; z < to; z++) {
        var g = {}; for (var k = bags[z]; k < bags[z + 1]; k++) if (gens[k]) g[gens[k][0]] = gens[k][1];
        out.push(g);
      }
      return out;
    }
    // procura o sample de (banco, programa, tecla)
    function find(bank, prog, key) {
      var p = -1; for (var i = 0; i < phdr.length - 1; i++) if (phdr[i].bank === bank && phdr[i].prog === prog) { p = i; break; }
      if (p < 0 && bank !== 128) for (i = 0; i < phdr.length - 1; i++) if (phdr[i].bank === 0 && phdr[i].prog === prog) { p = i; break; }
      if (p < 0 && bank === 128) for (i = 0; i < phdr.length - 1; i++) if (phdr[i].bank === 128) { p = i; break; }
      if (p < 0) return null;
      var pz = zones(pbag, pgen, phdr[p].bag, phdr[p + 1].bag);
      function inRange(g, k) { var r = g[43]; if (r == null) return true; return k >= (r & 255) && k <= (r >> 8); }
      for (var a = 0; a < pz.length; a++) {
        var g = pz[a]; if (g[41] == null || !inRange(g, key)) continue;
        var I = g[41]; if (!inst[I + 1]) continue;
        var iz = zones(ibag, igen, inst[I].bag, inst[I + 1].bag), glob = iz[0] && iz[0][53] == null ? iz[0] : {};
        for (var c = 0; c < iz.length; c++) {
          var h = iz[c]; if (h[53] == null || !inRange(h, key)) continue;
          var sh = shdr[h[53]]; if (!sh) continue;
          var m = {}; for (var kk in glob) m[kk] = glob[kk]; for (kk in h) m[kk] = h[kk];
          var root = m[58] != null && m[58] !== 65535 ? m[58] : sh.key, fine = (m[52] != null ? s8(m[52] & 255) : 0) + sh.corr + (g[52] != null ? s8(g[52] & 255) : 0);
          var coarse = (m[51] != null ? s8(m[51] & 255) : 0) + (g[51] != null ? s8(g[51] & 255) : 0);
          var st = sh.st + (m[0] || 0) + ((m[4] || 0) << 15), en = sh.en + ((m[1] || 0) - 0) + ((m[12] || 0) << 15);
          var ls = sh.ls + ((m[2] || 0)) + ((m[45] || 0) << 15), le = sh.le + ((m[3] || 0)) + ((m[50] || 0) << 15);
          var mode = (m[54] || 0) & 3;
          return { name: sh.name, inst: inst[I].name, st: st, en: en, ls: ls, le: le, rate: sh.rate, base: root - coarse - fine / 100, loop: mode === 1 || mode === 3 };
        }
      }
      return null;
    }
    function data(z) {
      var n = Math.max(0, Math.min(z.en, smpl.n) - z.st), d = new Float32Array(n);
      for (var i = 0; i < n; i++) { var q = smpl.o + (z.st + i) * 2; d[i] = ((u16(b, q) << 16) >> 16) / 32768; }
      return d;
    }
    return smpl ? { find: find, data: data } : null;
  }
  var SF2CACHE = null;
  function parseMID(b, opts) {
    var B = new Builder('MIDI');
    if (tag(b, 0, 4) === 'RIFF') { var q = 12; while (q + 8 < b.length && tag(b, q, 4) !== 'data') q += 8 + u32(b, q + 4); b = b.subarray(q + 8); }
    var ntrk = (b[10] << 8) | b[11], div = (b[12] << 8) | b[13], o = 8 + ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]);
    var evs = [], title = '';
    for (var tr = 0; tr < ntrk && o + 8 <= b.length; tr++) {
      if (tag(b, o, 4) !== 'MTrk') break;
      var len = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0, p = o + 8, end = Math.min(b.length, p + len), tick = 0, run = 0, seq = 0;
      function vlq() { var v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 127); } while (c & 128 && p < end); return v; }
      while (p < end) {
        tick += vlq();
        var st = b[p];
        if (st & 0x80) { p++; if (st < 0xF0) run = st; } else st = run;
        var t4 = st >> 4, chn = st & 15;
        if (st === 0xFF) { var mt = b[p++], ml = vlq(); if (mt === 0x51) evs.push({ tk: tick, k: 'tempo', us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2], s: seq++ }); if (mt === 3 && !title && tr === 0) title = str(b, p, ml); p += ml; if (mt === 0x2F) break; }
        else if (st === 0xF0 || st === 0xF7) { p += vlq(); }
        else if (t4 === 8 || t4 === 9) { var nt = b[p++], vel = b[p++]; evs.push({ tk: tick, k: t4 === 9 && vel ? 'on' : 'off', ch: chn, n: nt, v: vel, s: seq++, tr: tr }); }
        else if (t4 === 0xA) p += 2;
        else if (t4 === 0xB) { var cc = b[p++], cv = b[p++]; evs.push({ tk: tick, k: 'cc', ch: chn, cc: cc, v: cv, s: seq++ }); }
        else if (t4 === 0xC) { evs.push({ tk: tick, k: 'prog', ch: chn, v: b[p++], s: seq++ }); }
        else if (t4 === 0xD) p += 1;
        else if (t4 === 0xE) { var lsb = b[p++], msb = b[p++]; evs.push({ tk: tick, k: 'bend', ch: chn, v: ((msb << 7) | lsb) - 8192, s: seq++ }); }
        else p++;
      }
      o += 8 + len;
    }
    evs.sort(function (a, c) { return a.tk - c.tk || a.s - c.s; });
    // ticks → amostras (44,1 kHz) pelo mapa de tempo
    var us = 500000, lastTk = 0, lastT = 0, smpte = div & 0x8000;
    function at(tk) { if (smpte) { var fps = 256 - (div >> 8), tpf = div & 255; return tk / (fps * tpf) * SR; } return lastT + (tk - lastTk) * us / div / 1e6 * SR; }
    var C = []; for (var i = 0; i < 16; i++) C.push({ prog: 0, bank: 0, vol: 100, expr: 127, pan: 64, bend: 0, range: 2, rpn: 16383, voices: [] });
    var sf = opts && opts.sf2 ? (SF2CACHE && SF2CACHE.src === opts.sf2 ? SF2CACHE.sf : (SF2CACHE = { src: opts.sf2, sf: parseSF2(opts.sf2) }).sf) : null;
    var tbBy = {}, keysOf = {};
    // nota do meio de cada instrumento: o sample do SoundFont é o da região onde ele mais toca
    (function () {
      var pr = [], bk = []; for (var q2 = 0; q2 < 16; q2++) { pr.push(0); bk.push(0); }
      evs.forEach(function (e) {
        if (e.k === 'prog') pr[e.ch] = e.v; else if (e.k === 'cc' && e.cc === 0) bk[e.ch] = e.v;
        else if (e.k === 'on' && e.ch !== 9) { var kk = 'p' + bk[e.ch] + ':' + pr[e.ch]; (keysOf[kk] || (keysOf[kk] = [])).push(e.n); }
      });
    })();
    function timbreFor(chn, prog, bank, key) {
      var drum = chn === 9, k = drum ? 'd' + key : 'p' + bank + ':' + prog, chip = drum ? 'Bateria (GM)' : 'MIDI · GM';
      if (tbBy[k] !== undefined) return tbBy[k];
      var ks = keysOf[k]; if (ks && ks.length) { ks = ks.slice().sort(function (a, c) { return a - c; }); key = ks[ks.length >> 1]; }
      var z = sf ? sf.find(drum ? 128 : bank, drum ? (prog || 0) : prog, key) : null;
      var name = drum ? (GMD[key] || ('Percussão ' + key)) : (GM[prog] || ('Programa ' + (prog + 1)));
      if (!z) { tbBy[k] = null; return null; }
      var d = sf.data(z); if (d.length < 16) { tbBy[k] = null; return null; }
      var lp = z.loop && z.le > z.ls && z.le - z.st <= d.length ? z.ls - z.st : -1; if (lp >= 0) d = d.subarray(0, z.le - z.st);
      var tb = B.col.add(chip + '|' + k, function () {
        var s = api.store(d, z.rate, lp);
        return { type: 'pcm', pcmId: s.id, rate: s.rate, len: s.len, loop: s.loop, base: drum ? null : z.base, drum: drum ? key : null, tune: 0, name: name, gm: drum ? null : prog };
      }, null, 0, chip);
      tbBy[k] = tb; return tb;
    }
    var vc = 0;
    function voice(chn, n) {   // canais do MIDI tocam várias notas juntas: cada nota simultânea vai para uma "voz" do canal
      var c = C[chn];
      for (var vi = 0; vi < c.voices.length; vi++) if (c.voices[vi] == null) break;
      c.voices[vi] = n;
      var id = 'MIDI · ' + (chn === 9 ? 'Bateria' : 'Canal ' + (chn + 1)) + (vi ? ' · voz ' + (vi + 1) : '');
      B.chan(id, chn === 9 ? 'Bateria (GM)' : 'MIDI · GM', (chn === 9 ? 'Bateria' : 'Canal ' + (chn + 1)) + (vi ? ' · voz ' + (vi + 1) : ''), chn === 9 ? 'noise' : 'psg');
      return { id: id, vi: vi };
    }
    var open = {}, tEnd = 0;
    evs.forEach(function (e) {
      var t = Math.round(at(e.tk));
      if (e.k === 'tempo') { lastT = at(e.tk); lastTk = e.tk; us = e.us || 500000; return; }
      tEnd = Math.max(tEnd, t);
      var c = C[e.ch];
      if (e.k === 'prog') c.prog = e.v;
      else if (e.k === 'cc') {
        if (e.cc === 0) c.bank = e.v; else if (e.cc === 7) c.vol = e.v; else if (e.cc === 11) c.expr = e.v; else if (e.cc === 10) c.pan = e.v;
        else if (e.cc === 101) c.rpn = (e.v << 7) | (c.rpn & 127); else if (e.cc === 100) c.rpn = (c.rpn & 0x3F80) | e.v;
        else if (e.cc === 6 && c.rpn === 0) c.range = e.v;
        else if (e.cc === 123 || e.cc === 120) { Object.keys(open).forEach(function (kk) { if (+kk.split(':')[0] === e.ch) { var x = open[kk]; B.REC.push({ c: x.id, t: t, k: 'off' }); c.voices[x.vi] = null; delete open[kk]; } }); }
      } else if (e.k === 'bend') {
        c.bend = e.v / 8192 * c.range;
        Object.keys(open).forEach(function (kk) { var x = open[kk]; if (+kk.split(':')[0] === e.ch && e.ch !== 9) B.REC.push({ c: x.id, t: t, k: 'pitch', n: x.n + c.bend }); });
      } else if (e.k === 'on') {
        var kk2 = e.ch + ':' + e.n;
        if (open[kk2]) { var x0 = open[kk2]; B.REC.push({ c: x0.id, t: t, k: 'off' }); c.voices[x0.vi] = null; delete open[kk2]; }
        var tb = timbreFor(e.ch, c.prog, c.bank, e.n); if (!tb) return;
        var v = voice(e.ch, e.n), vel = e.v / 127 * (c.vol / 127) * (c.expr / 127);
        var ev = { c: v.id, t: t, k: 'on', n: e.ch === 9 ? e.n : e.n + c.bend, v: Math.max(0.05, vel), pan: c.pan, tb: tb };
        if (e.ch === 9) ev.noise = { ck: 'drum', d: e.n };
        B.REC.push(ev); open[kk2] = { id: v.id, vi: v.vi, n: e.n };
      } else if (e.k === 'off') {
        var kk3 = e.ch + ':' + e.n, x1 = open[kk3]; if (!x1) return;
        B.REC.push({ c: x1.id, t: t, k: 'off' }); c.voices[x1.vi] = null; delete open[kk3];
      }
    });
    Object.keys(open).forEach(function (kk) { B.REC.push({ c: open[kk].id, t: tEnd, k: 'off' }); });
    fixChans(B);
    var chips = ['MIDI']; if (!sf) chips.push('sem SoundFont');
    return B.finish({ title: title }, chips, tEnd + SR, -1);
  }

  // ═════════════ S98 (log de registradores de PC-88/98, X68000…) → VGM ═════════════
  function s98toVGM(b) {
    var ver = b[3] - 48, tn = u32(b, 4) || 10, td = u32(b, 8) || 1000, dumpO = u32(b, 0x14), loopO = u32(b, 0x18);
    var devs = [];
    if (ver >= 3 && u32(b, 0x1C)) { var n = u32(b, 0x1C); for (var i = 0; i < n; i++) { var o = 0x20 + i * 16; devs.push({ type: u32(b, o), clock: u32(b, o + 4) }); } }
    else if (ver >= 2 && u32(b, 0x1C)) { n = u32(b, 0x1C); for (i = 0; i < n; i++) { o = 0x20 + i * 16; devs.push({ type: u32(b, o), clock: u32(b, o + 4) }); } }
    if (!devs.length) devs.push({ type: 4, clock: 7987200 });
    // tipo do S98 → (deslocamento do clock no cabeçalho do VGM, comando da porta 0, comando da porta 1)
    var MAP = { 1: [0x74, 0xA0, 0xA0, 'ay'], 15: [0x74, 0xA0, 0xA0, 'ay'], 2: [0x44, 0x55, 0x55], 3: [0x2C, 0x52, 0x53], 4: [0x48, 0x56, 0x57], 5: [0x30, 0x54, 0x54], 6: [0x10, 0x51, 0x51], 7: [0x54, 0x5B, 0x5B], 8: [0x50, 0x5A, 0x5A], 9: [0x5C, 0x5E, 0x5F], 16: [0x0C, 0x50, 0x50, 'sn'] };
    var hdr = new Uint8Array(0x100), body = [], used = {}, devMap = [];
    devs.forEach(function (d, k) {
      var m = MAP[d.type]; if (!m) { devMap.push(null); return; }
      var second = !!used[m[0]]; used[m[0]] = (used[m[0]] || 0) + 1;
      if (used[m[0]] > 2) { devMap.push(null); return; }
      var clk = d.clock; if (m[3] === 'ay' && clk > 2500000) clk = Math.round(clk / 2);
      var cur = u32(hdr, m[0]); if (!cur) { hdr[m[0]] = clk & 255; hdr[m[0] + 1] = (clk >> 8) & 255; hdr[m[0] + 2] = (clk >> 16) & 255; hdr[m[0] + 3] = ((clk >>> 24) & 0x3F); }
      else hdr[m[0] + 3] |= 0x40;   // dois chips iguais
      devMap.push({ m: m, second: second });
    });
    var spt = SR * tn / td, acc = 0, p = dumpO, loopVgm = -1, total = 0, guard = 0;
    function wait(nTicks) { acc += nTicks * spt; var w = Math.floor(acc); acc -= w; total += w; while (w > 0) { var k = Math.min(65535, w); body.push(0x61, k & 255, k >> 8); w -= k; } }
    while (p < b.length && guard++ < 5e7) {
      if (p === loopO && loopO) loopVgm = body.length;
      var c = b[p];
      if (c === 0xFF) { wait(1); p++; continue; }
      if (c === 0xFE) { p++; var v = 0, sh = 0, x; do { x = b[p++]; v |= (x & 127) << sh; sh += 7; } while (x & 128); wait(v + 2); continue; }
      if (c === 0xFD) break;
      var dv = devMap[c >> 1], port = c & 1, reg = b[p + 1], val = b[p + 2]; p += 3;
      if (!dv) continue;
      var m2 = dv.m;
      if (m2[3] === 'sn') { body.push(dv.second ? 0x30 : 0x50, val); continue; }
      if (m2[3] === 'ay') { body.push(0xA0, (reg & 0x7F) | (dv.second ? 0x80 : 0), val); continue; }
      var cmd = port ? m2[2] : m2[1];
      if (m2[1] === m2[2] && port) continue;   // chip de uma porta só
      body.push(dv.second ? cmd + 0x50 : cmd, reg, val);
    }
    body.push(0x66);
    var out = new Uint8Array(0x100 + body.length);
    out.set(hdr); out.set(body, 0x100);
    out[0] = 0x56; out[1] = 0x67; out[2] = 0x6D; out[3] = 0x20;
    var eof = out.length - 4; out[4] = eof & 255; out[5] = (eof >> 8) & 255; out[6] = (eof >> 16) & 255; out[7] = eof >>> 24;
    out[8] = 0x71; out[9] = 0x01;   // versão 1.71
    out[0x18] = total & 255; out[0x19] = (total >> 8) & 255; out[0x1A] = (total >> 16) & 255; out[0x1B] = total >>> 24;
    out[0x34] = 0x100 - 0x34;
    if (loopVgm >= 0) { var lo2 = 0x100 + loopVgm - 0x1C; out[0x1C] = lo2 & 255; out[0x1D] = (lo2 >> 8) & 255; out[0x1E] = (lo2 >> 16) & 255; out[0x1F] = lo2 >>> 24; }
    // título (tag do S98 v3: "[S98]" seguido de linhas chave=valor)
    var info = {};
    if (ver >= 3 && u32(b, 0x10)) { try { var to = u32(b, 0x10), txt = new TextDecoder('utf-8').decode(b.subarray(to, Math.min(b.length, to + 4096))).split('\0')[0]; if (/^\[S98\]/.test(txt)) txt.replace(/^\[S98\]/, '').split(/\n/).forEach(function (l) { var mm = /^(\w+)=(.*)$/.exec(l.trim()); if (mm) info[mm[1].toLowerCase()] = mm[2]; }); } catch (e) {} }
    return { vgm: out, info: info };
  }

  // ═════════════ formatos com CPU (NSF, GBS, KSS, SAP, HES, AY, SPC) ═════════════
  // O rg-rip.wasm (game-music-emu) roda o programa da música e grava cada escrita nos chips de som.
  // Aqui o registro vira um VGM (chips que o VGM tem) com alguns comandos próprios, no tamanho padrão do VGM:
  // 0xD7 00 aa dd VRC6 · 0xD8 00 aa dd N163 · 0xD9 00 rr dd S-DSP · 0xDA 00 rr dd SID · 0xF0 vv il ih 00 S-DSP liga a voz com o sample n
  function ripKind(b) {
    var t4 = tag(b, 0, 4);
    if (tag(b, 0, 5) === 'NESM\x1a') return 'nsf';
    if (t4 === 'NSFE') return 'nsfe';
    if (tag(b, 0, 3) === 'GBS') return 'gbs';
    if (tag(b, 0, 5) === 'SAP\r\n') return 'sap';
    if (t4 === 'KSCC' || t4 === 'KSSX') return 'kss';
    if (t4 === 'HESM') return 'hes';
    if (tag(b, 0, 8) === 'ZXAYEMUL') return 'ay';
    if (tag(b, 0, 27) === 'SNES-SPC700 Sound File Data') return 'spc';
    if (t4 === 'PSID' || t4 === 'RSID') return 'sid';
    if (tag(b, 0, 3) === 'PSF' && b[3] === 0x01) return 'psf';
    if (tag(b, 0, 3) === 'PSF' && b[3] === 0x24) return '2sf';
    if (tag(b, 0, 3) === 'PSF' && b[3] === 0x22) return 'gsf';
    return null;
  }
  // ── PSF: cabeçalho, tags ([TAG]chave=valor) e o programa comprimido (zlib) ──
  function psfInfo(b) {
    if (tag(b, 0, 3) !== 'PSF') return null;
    var res = u32(b, 4), cs = u32(b, 8), o = 16 + res + cs, tags = {};
    if (o + 5 <= b.length && tag(b, o, 5) === '[TAG]') {
      var txt = ''; for (var i = o + 5; i < b.length; i++) txt += String.fromCharCode(b[i]);
      try { txt = decodeURIComponent(escape(txt)); } catch (e) {}
      txt.split(/\n/).forEach(function (l) { var m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(l); if (m) { var k = m[1].toLowerCase(); tags[k] = tags[k] ? tags[k] + '\n' + m[2] : m[2]; } });
    }
    return { ver: b[3], exe: b.subarray(16 + res, 16 + res + cs), res: b.subarray(16, 16 + res), tags: tags };
  }
  function psfSecs(tags) {   // "length" (m:ss.ms) + "fade"
    function p(x) { if (!x) return 0; var a = String(x).split(':'), s = 0; a.forEach(function (y) { s = s * 60 + parseFloat(String(y).replace(',', '.')) || s * 60; }); return s; }
    var l = p(tags.length), f = p(tags.fade); return l ? l + f : 0;
  }
  // ordem do PSF: _lib (e as libs dela), o próprio programa, depois _lib2, _lib3...
  // getFile(nome) → Promise<Uint8Array>; inflate(Uint8Array) → Promise<Uint8Array>
  function psfLoad(b, getFile, inflate, depth) {
    depth = depth || 0; if (depth > 8) return Promise.reject(new Error('_lib demais'));
    var I = psfInfo(b); if (!I) return Promise.reject(new Error('PSF inválido'));
    var out = [], resv = [], chain = Promise.resolve();
    function addLib(name) { chain = chain.then(function () { return getFile(name); }).then(function (lb) { return psfLoad(lb, getFile, inflate, depth + 1); }).then(function (r) { out = out.concat(r.sections); resv = resv.concat(r.reserved); }); }
    if (I.tags._lib) addLib(I.tags._lib);
    chain = chain.then(function () { return I.exe.length ? inflate(I.exe) : null; }).then(function (x) { if (x) out.push(x); resv.push(I.res); });
    for (var k = 2; k < 10 && I.tags['_lib' + k]; k++) addLib(I.tags['_lib' + k]);
    return chain.then(function () { return { sections: out, reserved: resv, tags: I.tags, ver: I.ver }; });
  }
  // 2SF: cada seção é [deslocamento u32][tamanho u32][dados] sobre a ROM do DS; a área reservada traz blocos 'SAVE' (zlib) do estado salvo
  function ndsImage(ld, inflate) {
    function lay(parts) {
      var n = 0; parts.forEach(function (p) { n = Math.max(n, p.o + p.d.length); });
      // a 2sflib costuma trazer a ROM inteira (dezenas de MB) num pedaço só: escreve os outros por cima dele, sem cópia nova
      if (parts.length && parts[0].o === 0 && parts[0].d.length >= n) { for (var j = 1; j < parts.length; j++) parts[0].d.set(parts[j].d, parts[j].o); return parts[0].d; }
      var o = new Uint8Array(n); parts.forEach(function (p) { o.set(p.d, p.o); }); return o;
    }
    var rom = [], save = [], chain = Promise.resolve();
    ld.sections.forEach(function (x) { if (x.length >= 8) { var ofs = u32(x, 0), sz = Math.min(u32(x, 4), x.length - 8); rom.push({ o: ofs, d: x.subarray(8, 8 + sz) }); } });
    ld.reserved.forEach(function (r) {
      var q = 0;
      while (q + 12 <= r.length) {
        var sz = u32(r, q + 4);
        if (tag(r, q, 4) === 'SAVE' && q + 12 + sz <= r.length) (function (z) { chain = chain.then(function () { return inflate(z); }).then(function (x) { if (x.length >= 8) save.push({ o: u32(x, 0), d: x.subarray(8, 8 + Math.min(u32(x, 4), x.length - 8)) }); }); })(r.subarray(q + 12, q + 12 + sz));
        q += 12 + sz;
      }
    });
    function num(k, d) { var v = ld.tags[k]; if (v == null || v === '') return d; v = parseInt(v, 10); return isNaN(v) ? d : v; }
    return chain.then(function () {
      return { rom: lay(rom), save: lay(save), frames: num('_frames', -1), clockdown: num('_clockdown', 0), a7: num('_vio2sf_arm7_clockdown_level', 0), a9: num('_vio2sf_arm9_clockdown_level', 0), sync: num('_vio2sf_sync_type', 0) };
    });
  }
  // GSF: cada seção é [entrada u32][endereço u32][tamanho u32][dados]; a 1ª (a _lib) diz onde o programa começa
  function gbaImage(ld) {
    var parts = [], n = 0;
    ld.sections.forEach(function (x) { if (x.length >= 12) { var o = u32(x, 4) & 0x1FFFFFF, sz = Math.min(u32(x, 8), x.length - 12); parts.push({ o: o, d: x.subarray(12, 12 + sz) }); n = Math.max(n, o + sz); } });
    if (!parts.length) return null;
    var img;
    if (parts[0].o === 0 && parts[0].d.length >= n) { img = parts[0].d; for (var j = 1; j < parts.length; j++) img.set(parts[j].d, parts[j].o); }
    else { img = new Uint8Array(n); parts.forEach(function (p) { img.set(p.d, p.o); }); }
    return { img: img, entry: u32(ld.sections[0], 0) };
  }
  function VgmW() { this.h = new Uint8Array(0x100); this.b = []; this.t = 0; }
  VgmW.prototype.clock = function (off, hz, flags) {
    var v = (Math.round(hz) & 0x3FFFFFFF) | (flags || 0);
    this.h[off] = v & 255; this.h[off + 1] = (v >> 8) & 255; this.h[off + 2] = (v >> 16) & 255; this.h[off + 3] = (v >>> 24) & 255;
  };
  VgmW.prototype.at = function (sec) {
    var to = Math.round(sec * SR), w = to - this.t;
    while (w > 0) { var k = Math.min(65535, w); this.b.push(0x61, k & 255, k >> 8); w -= k; }
    if (to > this.t) this.t = to;
  };
  VgmW.prototype.put = function () { for (var i = 0; i < arguments.length; i++) this.b.push(arguments[i] & 255); };
  VgmW.prototype.block = function (type, addr, bytes) {   // bloco de dados (RAM do NES etc.)
    var sz = bytes.length + 2; this.b.push(0x67, 0x66, type, sz & 255, (sz >> 8) & 255, (sz >> 16) & 255, (sz >>> 24) & 0x7F, addr & 255, (addr >> 8) & 255);
    for (var i = 0; i < bytes.length; i++) this.b.push(bytes[i]);
  };
  VgmW.prototype.out = function () {
    this.b.push(0x66);
    var o = new Uint8Array(0x100 + this.b.length); o.set(this.h); o.set(this.b, 0x100);
    o[0] = 0x56; o[1] = 0x67; o[2] = 0x6D; o[3] = 0x20;
    var eof = o.length - 4; o[4] = eof & 255; o[5] = (eof >> 8) & 255; o[6] = (eof >> 16) & 255; o[7] = eof >>> 24;
    o[8] = 0x71; o[9] = 0x01; o[0x34] = 0x100 - 0x34;
    o[0x18] = this.t & 255; o[0x19] = (this.t >> 8) & 255; o[0x1A] = (this.t >> 16) & 255; o[0x1B] = this.t >>> 24;
    return o;
  };
  var NES_NTSC = 1789773, NES_PAL = 1662607;
  // R = { log: Float64Array [t, chip, addr, data]..., blob: Uint8Array, info: {song, game, author, system} }
  function ripToVGM(kind, b, R) {
    var V = new VgmW(), L = R.log, n = L.length >> 2, i, info = { title: R.info.song || R.info.game || '', game: R.info.game || '', author: R.info.author || '', system: R.info.system || '' };
    var has = {}; for (i = 0; i < n; i++) has[L[i * 4 + 1]] = 1;
    if (kind === 'nsf' || kind === 'nsfe') {
      var pal = false, xf = 0;
      if (kind === 'nsf') { pal = (b[0x7A] & 3) === 1; xf = b[0x7B]; }
      else { var q = 4; while (q + 8 <= b.length) { var cid = tag(b, q + 4, 4), cl = u32(b, q); if (cid === 'INFO') { pal = (b[q + 8 + 6] & 3) === 1; xf = cl > 7 ? b[q + 8 + 7] : 0; } if (cid === 'NEND') break; q += 8 + cl; } }
      // só vale o chip extra que o cabeçalho anuncia E que a música usa de fato (cabeçalhos de NSF piratas trazem lixo)
      var used = 0;
      for (i = 0; i < n; i++) {
        if (L[i * 4 + 1] !== 2) continue; var ua = L[i * 4 + 2];
        if (ua >= 0x4040 && ua <= 0x409E) used |= 4; else if (ua >= 0x5000 && ua <= 0x5015) used |= 8;
        else if (ua >= 0x9000 && ua <= 0xB002 && (ua & 0x0FFF) <= 2) used |= 1; else if ((ua & 0xF800) === 0x4800) used |= 16;
        else if ((ua & 0xE000) === 0xE000 || (ua & 0xE000) === 0xC000) used |= 32; else if (ua === 0x9030) used |= 2;
      }
      xf &= used;
      var clk = pal ? NES_PAL : NES_NTSC;
      V.clock(0x84, clk, ((xf & 4) ? 0x80000000 : 0) | ((xf & 8) ? 0x40000000 : 0));
      if (xf & 2) V.clock(0x10, 3579545, 0x80000000);          // VRC7: YM2413 com os instrumentos do VRC7 (bit 31)
      if (xf & 32) { V.clock(0x74, clk, 0); V.h[0x78] = 0x10; }  // Sunsoft 5B (FME-7): AY/YM2149
      var nAddr = 0, fmeLatch = 0, vrc7Reg = 0, last4015 = 0, dmcSeen = {};
      for (i = 0; i < n; i++) {
        var t = L[i * 4], c = L[i * 4 + 1], a = L[i * 4 + 2], d = L[i * 4 + 3];
        if (c === 14) {   // bytes do DPCM: vira bloco de RAM do NES antes de o sample começar
          var len = L[i * 4 + 4 + 2], off = d, by = R.blob.subarray(off, off + len), h = 0;
          for (var k = 0; k < by.length; k++) h = (h * 31 + by[k]) | 0;
          if (dmcSeen[a] !== h) { dmcSeen[a] = h; V.at(t); V.block(0xC2, a, by); }
          i++; continue;
        }
        V.at(t);
        if (c === 1) { if (a >= 0x4000 && a <= 0x4017) V.put(0xB4, a - 0x4000, d); continue; }
        if (c !== 2) continue;
        if ((xf & 4) && a >= 0x4040 && a <= 0x407F) V.put(0xB4, a - 0x4000, d);                    // FDS: onda
        else if ((xf & 4) && a >= 0x4080 && a <= 0x409E) V.put(0xB4, 0x20 + (a - 0x4080), d);     // FDS: registradores
        else if ((xf & 4) && a === 0x4023) V.put(0xB4, 0x3F, d);
        else if ((xf & 8) && a >= 0x5000 && a <= 0x5007) V.put(0xB4, 0x80 | (a - 0x5000), d);     // MMC5: 2 pulsos → 2º NES
        else if ((xf & 8) && a === 0x5015) V.put(0xB4, 0x80 | 0x15, d & 3);
        else if ((xf & 1) && a >= 0x9000 && a <= 0xB002 && (a & 0x0FFF) <= 2) V.put(0xD7, 0, (((a >> 12) - 9) << 4) | (a & 3), d);   // VRC6
        else if ((xf & 16) && (a & 0xF800) === 0xF800) nAddr = d;                                   // N163: endereço (bit 7 = auto-incremento)
        else if ((xf & 16) && (a & 0xF800) === 0x4800) { V.put(0xD8, 0, nAddr & 0x7F, d); if (nAddr & 0x80) nAddr = 0x80 | ((nAddr + 1) & 0x7F); }
        else if ((xf & 32) && (a & 0xE000) === 0xC000) fmeLatch = d & 15;
        else if ((xf & 32) && (a & 0xE000) === 0xE000) V.put(0xA0, fmeLatch, d);
        else if ((xf & 2) && a === 0x9010) vrc7Reg = d;
        else if ((xf & 2) && a === 0x9030) V.put(0x51, vrc7Reg, d);
      }
      info.system = info.system || (pal ? 'NES (PAL)' : 'NES');
      if (xf & 8) var rename = { 'NES APU #2': 'MMC5' };   // os 2 pulsos do MMC5 entram como 2º NES
    } else if (kind === 'gbs') {
      V.clock(0x80, 4194304);
      for (i = 0; i < n; i++) { if (L[i * 4 + 1] !== 3) continue; var a2 = L[i * 4 + 2]; if (a2 < 0xFF10 || a2 > 0xFF3F) continue; V.at(L[i * 4]); V.put(0xB3, a2 - 0xFF10, L[i * 4 + 3]); }
      info.system = info.system || 'Game Boy';
    } else if (kind === 'sap') {
      var txt = ''; for (i = 0; i < Math.min(b.length, 4096); i++) { if (b[i] === 0xFF && b[i + 1] === 0xFF) break; txt += String.fromCharCode(b[i]); }
      var ntsc = /\nNTSC/.test(txt), stereo = /\nSTEREO/.test(txt);
      V.clock(0xB0, ntsc ? NES_NTSC : 1773447, stereo ? 0x40000000 : 0);
      for (i = 0; i < n; i++) { if (L[i * 4 + 1] !== 4) continue; var a3 = L[i * 4 + 2] - 0xD200; if (a3 < 0 || a3 > 0x1F) continue; V.at(L[i * 4]); V.put(0xBB, (a3 & 15) | (a3 & 16 ? 0x80 : 0), L[i * 4 + 3]); }
      info.system = info.system || 'Atari 8-bit';
    } else if (kind === 'kss') {
      var latch = 0, opllA = 0, mA = 0;
      var used = { ay: 0, sn: 0, opll: 0, ma: 0, scc: 0 };
      for (i = 0; i < n; i++) {
        var c3 = L[i * 4 + 1], p3 = L[i * 4 + 2];
        if (c3 === 6) used.scc = 1;
        else if (c3 === 5) { if (p3 === 0xA1) used.ay = 1; else if (p3 === 0x7E || p3 === 0x7F) used.sn = 1; else if (p3 === 0x7D || p3 === 0xF1) used.opll = 1; else if (p3 === 0xC1) used.ma = 1; }
      }
      if (used.ay) V.clock(0x74, 1789773); if (used.sn) V.clock(0x0C, 3579545); if (used.opll) V.clock(0x10, 3579545); if (used.ma) V.clock(0x58, 3579545); if (used.scc) V.clock(0x9C, 1789773);
      for (i = 0; i < n; i++) {
        var c4 = L[i * 4 + 1], a4 = L[i * 4 + 2], d4 = L[i * 4 + 3];
        V.at(L[i * 4]);
        if (c4 === 6) {
          if (a4 < 0x80) V.put(0xD2, 0, a4, d4);
          else if (a4 < 0x8A) V.put(0xD2, 1, a4 - 0x80, d4);
          else if (a4 < 0x8F) V.put(0xD2, 2, a4 - 0x8A, d4);
          else if (a4 === 0x8F) V.put(0xD2, 3, 0, d4);
          continue;
        }
        if (c4 !== 5) continue;
        if (a4 === 0xA0) latch = d4 & 15; else if (a4 === 0xA1) V.put(0xA0, latch, d4);
        else if (a4 === 0x7E || a4 === 0x7F) V.put(0x50, d4); else if (a4 === 0x06) V.put(0x4F, d4);
        else if (a4 === 0x7C || a4 === 0xF0) opllA = d4; else if (a4 === 0x7D || a4 === 0xF1) V.put(0x51, opllA, d4);
        else if (a4 === 0xC0) mA = d4; else if (a4 === 0xC1) V.put(0x5C, mA, d4);
      }
      info.system = info.system || 'MSX';
    } else if (kind === 'hes') {
      V.clock(0xA4, 3579545);
      for (i = 0; i < n; i++) { if (L[i * 4 + 1] !== 7) continue; var a5 = L[i * 4 + 2] & 0x1FFF; if (a5 < 0x800 || a5 > 0x809) continue; V.at(L[i * 4]); V.put(0xB9, a5 - 0x800, L[i * 4 + 3]); }
      info.system = info.system || 'PC Engine';
    } else if (kind === 'spc') {
      // SNES: registradores do DSP e "voz liga com o sample n"; os samples BRR (copiados da RAM na hora do KEY ON) vão à parte
      var smp = [];
      for (i = 0; i < n; i++) {
        var c6 = L[i * 4 + 1];
        if (c6 === 11) { smp[L[i * 4 + 2]] = { off: L[i * 4 + 3], len: L[i * 4 + 4 + 2], loop: L[i * 4 + 4 + 3] }; i++; continue; }
        V.at(L[i * 4]);
        if (c6 === 9) V.put(0xD9, 0, L[i * 4 + 2], L[i * 4 + 3]);
        else if (c6 === 10) V.put(0xF0, L[i * 4 + 2], L[i * 4 + 3] & 255, L[i * 4 + 3] >> 8, 0);
      }
      var spc = { blob: R.blob, smp: smp };
      if (b.length >= 0x2E && b[0x23] === 0x1A) {   // ID666: título, jogo, autor
        info.title = info.title || str(b, 0x2E, 32); info.game = info.game || str(b, 0x4E, 32);
      }
      info.system = info.system || 'Super Nintendo';
    } else if (kind === 'psf') {
      var psmp = [];
      for (i = 0; i < n; i++) {
        var c7 = L[i * 4 + 1];
        if (c7 === 32) { psmp[L[i * 4 + 2]] = { off: L[i * 4 + 3], len: L[i * 4 + 4 + 2], loop: L[i * 4 + 4 + 3] }; i++; continue; }
        V.at(L[i * 4]);
        if (c7 === 30) { var ra = L[i * 4 + 2], rd = L[i * 4 + 3]; V.put(0xE2, ra & 255, ra >> 8, rd & 255, rd >> 8); }
        else if (c7 === 31) { var vi = L[i * 4 + 3]; V.put(0xE3, L[i * 4 + 2], vi & 255, vi >> 8, 0); }
      }
      var psx = { blob: R.blob, smp: psmp };
      info.system = info.system || 'PlayStation';
    } else if (kind === '2sf') {
      // Nintendo DS: 16 canais; escritas nos registradores 0x400-0x4FF e "canal liga" com o sample copiado da RAM
      // no tamanho padrão (5 bytes): 0xE4 ss rr lo hi escrita (ss = 1/2 bytes, rr = registrador - 0x400) · 0xE6 parâmetros (32 bits)
      // 0xE7 início do loop · 0xE8 tamanho · 0xE9 timer · 0xE5 cc il ih 00 canal liga com o sample n (usa os 4 anteriores)
      var nsmp = [];
      for (i = 0; i < n; i++) {
        var c8 = L[i * 4 + 1];
        if (c8 === 50) { nsmp[L[i * 4 + 2]] = { off: L[i * 4 + 3], len: L[i * 4 + 4 + 2] }; i++; continue; }
        if (c8 >= 42 && c8 <= 44) {
          V.at(L[i * 4]); var na = L[i * 4 + 2] - 0x400, nv = L[i * 4 + 3] >>> 0;
          if (c8 === 42) V.put(0xE4, 1, na, nv, 0);
          else { V.put(0xE4, 2, na, nv, nv >> 8); if (c8 === 44) V.put(0xE4, 2, na + 2, nv >> 16, nv >>> 24); }
          continue;
        }
        if (c8 === 45 && i + 2 < n) {
          V.at(L[i * 4]); var nid = L[i * 4 + 3], tmr = L[i * 4 + 4 + 2], pk = L[i * 4 + 4 + 3] >>> 0, lps = L[i * 4 + 8 + 2], lln = L[i * 4 + 8 + 3] >>> 0;
          V.put(0xE6, pk, pk >> 8, pk >> 16, pk >>> 24); V.put(0xE7, lps, lps >> 8, 0, 0); V.put(0xE8, lln, lln >> 8, lln >> 16, lln >>> 24); V.put(0xE9, tmr, tmr >> 8, 0, 0);
          if (nid < 0) nid = 0xFFFF;
          V.put(0xE5, L[i * 4 + 2], nid, nid >> 8, 0);
          i += 2;
        }
      }
      var nds = { blob: R.blob, smp: nsmp };
      info.system = info.system || 'Nintendo DS';
    } else if (kind === 'gsf') {
      // Game Boy Advance: os 4 canais "de Game Boy" viram o Game Boy do VGM; os canais de sample do driver MP2K vêm em comandos próprios:
      // 0xEA v0 v1 v2 v3 (valor) · 0xEB cc op il ih: op 1 = frequência (Hz) · 2 = nota · 3 = estado/volume · 4 = liga com o sample n · 5 = cala
      var GBM = { 0x60: 0, 0x62: 1, 0x63: 2, 0x64: 3, 0x65: 4, 0x68: 6, 0x69: 7, 0x6C: 8, 0x6D: 9, 0x70: 0x0A, 0x72: 0x0B, 0x73: 0x0C, 0x74: 0x0D, 0x75: 0x0E, 0x78: 0x10, 0x79: 0x11, 0x7C: 0x12, 0x7D: 0x13, 0x80: 0x14, 0x81: 0x15, 0x84: 0x16 };
      var gsmp = [], gbOn = false, bank = [new Uint8Array(16), new Uint8Array(16)], play = 0, sent = null, pcmF = 0, gsLast = null;
      for (i = 0; i < n; i++) if (L[i * 4 + 1] === 60 || L[i * 4 + 1] === 61) { gbOn = true; break; }
      if (gbOn) V.clock(0x80, 4194304);
      var gbW = function (a, d) {
        if (a >= 0x90 && a <= 0x9F) { bank[play ^ 1][a - 0x90] = d; return; }   // escrita vai ao banco que não está tocando
        var r = GBM[a]; if (r == null) return;
        if (a === 0x70) { play = (d >> 6) & 1; d &= 0x80; }
        if (a === 0x70 || (a === 0x75 && (d & 0x80))) {   // onda que vai tocar → RAM de onda do Game Boy
          var w = bank[play], same = sent && sent.every(function (x, k) { return x === w[k]; });
          if (!same) { for (var k = 0; k < 16; k++) V.put(0xB3, 0x20 + k, w[k]); sent = Array.prototype.slice.call(w); }
        }
        V.put(0xB3, r, d);
      };
      var gv = function (v) { v >>>= 0; V.put(0xEA, v, v >> 8, v >> 16, v >>> 24); };
      for (i = 0; i < n; i++) {
        var c9 = L[i * 4 + 1], a9 = L[i * 4 + 2], d9 = L[i * 4 + 3];
        if (c9 === 70) { gsLast = { off: d9, len: L[i * 4 + 4 + 2] }; gsmp[a9] = gsLast; i++; continue; }
        if (c9 === 72) { if (gsLast) { gsLast.freq = a9 >>> 0; gsLast.ls = (d9 >>> 0) & 0x7FFFFFFF; gsLast.loop = (d9 >>> 0) >= 0x80000000; } continue; }
        if (c9 === 73) { if (gsLast) { gsLast.size = a9 >>> 0; gsLast.type = d9; } continue; }
        if (c9 === 69) { pcmF = a9; continue; }
        V.at(L[i * 4]);
        if (c9 === 60) gbW(a9, d9);
        else if (c9 === 61) { if (a9 !== 0x82) { gbW(a9, d9 & 255); gbW(a9 + 1, (d9 >> 8) & 255); } }
        else if (c9 === 63) { gv(d9); V.put(0xEB, a9, 1, 0, 0); }
        else if (c9 === 64) { gv(d9); V.put(0xEB, a9, 2, 0, 0); }
        else if (c9 === 62) { gv(d9); V.put(0xEB, a9, 3, 0, 0); }
        else if (c9 === 65) { var gid = d9 < 0 ? 0xFFFF : d9; V.put(0xEB, a9, 4, gid, gid >> 8); }
        else if (c9 === 66) V.put(0xEB, a9, 5, 0, 0);
      }
      var gba = { blob: R.blob, smp: gsmp, pcm: pcmF };
      info.system = info.system || 'Game Boy Advance';
    } else if (kind === 'sid') {
      for (i = 0; i < n; i++) { if (L[i * 4 + 1] !== 20) continue; V.at(L[i * 4]); V.put(0xDA, 0, L[i * 4 + 2], L[i * 4 + 3]); }
      info.system = 'Commodore 64 (SID ' + (R.info.model || '6581') + ')';
    } else if (kind === 'ay') {
      V.clock(0x74, 1773400);
      for (i = 0; i < n; i++) { if (L[i * 4 + 1] !== 8) continue; V.at(L[i * 4]); V.put(0xA0, L[i * 4 + 2] & 15, L[i * 4 + 3]); }
      info.system = info.system || 'ZX Spectrum';
    }
    V.at(R.seconds || (n ? L[(n - 1) * 4] : 0));
    return { vgm: V.out(), info: info, rename: typeof rename !== 'undefined' ? rename : null, spc: typeof spc !== 'undefined' ? spc : null, psx: typeof psx !== 'undefined' ? psx : null, nds: typeof nds !== 'undefined' ? nds : null, gba: typeof gba !== 'undefined' ? gba : null };
  }

  function parse(b, opts) {
    var f = detect(b, opts && opts.name);
    if (f === 'mod') return parseMOD(b, false);
    if (f === 'mod15') return parseMOD(b, true);
    if (f === 's3m') return parseS3M(b);
    if (f === 'xm') return parseXM(b);
    if (f === 'it') return parseIT(b);
    if (f === 'mid') return parseMID(b, opts);
    return null;
  }
  return { detect: detect, parse: parse, s98toVGM: s98toVGM, parseSF2: parseSF2, ripKind: ripKind, ripToVGM: ripToVGM, psfInfo: psfInfo, psfLoad: psfLoad, psfSecs: psfSecs, ndsImage: ndsImage, gbaImage: gbaImage };
};
