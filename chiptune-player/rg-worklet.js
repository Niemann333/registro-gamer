/* Registro Gamer — buffer de áudio (AudioWorklet)
 * Guarda alguns segundos de áudio já renderizado e toca em tempo real.
 * Se a página travar por um instante, o áudio continua saindo do buffer. */
class RGRing extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 44100 * 4;                 // até 4 s guardados
    this.L = new Float32Array(this.cap);
    this.R = new Float32Array(this.cap);
    this.rd = 0; this.wr = 0; this.count = 0;
    this.played = 0; this.gen = 0; this.under = 0;
    this.tick = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'data') {
        if (m.gen !== this.gen) return;   // dado de uma faixa/seek antigo
        const n = m.l.length;
        for (let i = 0; i < n; i++) {
          if (this.count >= this.cap) break;
          this.L[this.wr] = m.l[i]; this.R[this.wr] = m.r[i];
          this.wr = (this.wr + 1) % this.cap; this.count++;
        }
      } else if (m.t === 'flush') {
        this.rd = this.wr = this.count = 0; this.played = 0; this.gen = m.gen; this.under = 0;
        this.report();
      }
    };
  }
  report() {
    this.port.postMessage({ t: 'st', gen: this.gen, played: this.played, buffered: this.count, under: this.under });
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const l = out[0], r = out[1] || out[0];
    const n = l.length;
    let i = 0;
    for (; i < n && this.count > 0; i++) {
      l[i] = this.L[this.rd]; r[i] = this.R[this.rd];
      this.rd = (this.rd + 1) % this.cap; this.count--;
    }
    this.played += i;
    if (i < n) { for (; i < n; i++) { l[i] = 0; r[i] = 0; } if (this.played > 0) this.under++; }
    if (++this.tick >= 16) { this.tick = 0; this.report(); }   // ~a cada 46 ms
    return true;
  }
}
registerProcessor('rg-ring', RGRing);
