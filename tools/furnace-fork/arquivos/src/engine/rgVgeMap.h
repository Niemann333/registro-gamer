// RG: VGM Music Maker <-> Furnace: efeitos, notas e volume nos dois sentidos.
// O importador (fileOps/vge.cpp) mostra os efeitos do VGMMM com os códigos parecidos do Furnace, e
// rgVge.cpp volta para os códigos do VGMMM na hora de tocar. As duas tabelas têm que ser o inverso uma da outra.
#ifndef _RGVGEMAP_H
#define _RGVGEMAP_H

// efeito do VGMMM -> Furnace; false = célula vazia (ou efeito que o VGMMM ignora)
static inline bool rgVgeFxToFur(unsigned char fx, unsigned char p, short& ofx, short& op) {
  op=p;
  switch (fx) {
    case 0x00: if (p==0) return false; ofx=0x00; return true; // arpejo (000 = vazio)
    case 0x01: case 0x02: case 0x03: case 0x04: case 0x0a: case 0x0f:
      ofx=fx; return true;
    case 0x05: ofx=0x06; return true; // portamento + volume
    case 0x06: ofx=0x05; return true; // vibrato + volume
    case 0x08: ofx=0x12; return true; // nível do operador 1..4
    case 0x09: ofx=0x13; return true;
    case 0x0c: ofx=0x14; return true;
    case 0x0d: ofx=0x15; return true;
    case 0x0b: ofx=0x18; return true; // canal 3 especial
    case 0x0e:
      switch (p>>4) {
        case 0: case 1: case 2: case 3: // multiplicador do operador
          ofx=0x16; op=(((p>>4)+1)<<4)|(p&15); return true;
        case 0x9: ofx=0x0c; op=p&15; return true; // reinício da nota
        case 0xc: ofx=0xec; op=p&15; return true; // corte
        case 0xd: ofx=0xed; op=p&15; return true; // atraso
        case 0xf: ofx=0x11; op=p&15; return true; // feedback
        default: ofx=0x0e; return true;
      }
    case 0x15: ofx=0x10; return true; // LFO
    case 0x17: ofx=0x20; return true; // modo do ruído
    case 0x19: ofx=0x08; return true; // pan
    case 0x1a: ofx=0x1a; return true; // tempo do DAC
    case 0x1c: ofx=0x1c; return true; // toca amostra
  }
  return false;
}

// efeito do Furnace -> VGMMM; false = não existe no VGMMM
static inline bool rgVgeFxFromFur(short fx, short p, unsigned char& ofx, unsigned char& op) {
  if (p<0) p=0;
  op=p&0xff;
  switch (fx) {
    case 0x00: case 0x01: case 0x02: case 0x03: case 0x04: case 0x0a: case 0x0f: case 0x0e: case 0x1a: case 0x1c:
      ofx=fx; return true;
    case 0x06: ofx=0x05; return true;
    case 0x05: ofx=0x06; return true;
    case 0x12: ofx=0x08; return true;
    case 0x13: ofx=0x09; return true;
    case 0x14: ofx=0x0c; return true;
    case 0x15: ofx=0x0d; return true;
    case 0x18: ofx=0x0b; return true;
    case 0x16: {
      int o=(p>>4)-1;
      if (o<0 || o>3) return false;
      ofx=0x0e; op=(o<<4)|(p&15); return true;
    }
    case 0x0c: ofx=0x0e; op=0x90|(p&15); return true;
    case 0xec: ofx=0x0e; op=0xc0|(p&15); return true;
    case 0xed: ofx=0x0e; op=0xd0|(p&15); return true;
    case 0x11: ofx=0x0e; op=0xf0|(p&15); return true;
    case 0x10: ofx=0x15; return true;
    case 0x20: ofx=0x17; return true;
    case 0x08: ofx=0x19; return true;
  }
  return false;
}

// volume: nos canais FM o 31 do VGMMM vira 7F (0x60+v); no PSG fica o número do VGMMM (1..31)
static inline int rgVgeVolToFur(int ch, int v) {
  if (v<=0) return -1;
  return (ch<6)?(0x60+v):v;
}
static inline int rgVgeVolFromFur(int ch, int v) {
  if (v<0) return 0;
  if (ch<6) {
    if (v>0x60) v-=0x60;
    else v=v/3;
  }
  if (v<1) v=1;
  if (v>31) v=31;
  return v;
}

#endif
