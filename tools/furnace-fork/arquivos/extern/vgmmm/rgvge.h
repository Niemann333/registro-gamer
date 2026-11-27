// RG: ponte entre o Furnace e o tocador do VGM Music Maker (extern/vgmmm).
// Nada daqui expõe os tipos do VGMMM: o núcleo fica no namespace rgvgmmm (rgvge_unity.cpp).
// O módulo do VGMMM é um só (variável global do programa original), então só existe uma música por vez.
#ifndef _RGVGE_H
#define _RGVGE_H

#include <vector>
#include <cstddef>

namespace rgvge {
  enum {
    CHANNELS=10,     // FM 1-6, PSG 1-3, ruído
    MAX_ROWS=256,
    MAX_PATTERNS=256,
    MAX_ORDERS=256,
    MAX_INSTRUMENTS=255,
    MAX_SAMPLES=255,
    NOTE_EMPTY=0xff,
    NOTE_OFF=0xfe
  };

  struct Write {
    unsigned char type; // 0/1 = YM2612 parte 0/1, 2 = SN76489, 3 = estéreo do Game Gear
    unsigned char reg, val;
  };

  struct Cell {
    short note;          // 0..11, NOTE_OFF, NOTE_EMPTY
    signed char octave;
    signed char volume;  // 0 = nada, 1..31
    unsigned char fx[4];
    unsigned char param[4];
    short ins;           // 0 = nada, senão instrumento+1
  };

  struct Op {
    unsigned char mult;
    signed char dt;      // -3..3
    unsigned char tl, rs, ar;
    unsigned char dr;    // bit 7 = AM
    unsigned char sr, rr, sl, ssg;
  };

  struct Ins {
    Op op[4];
    unsigned char alg, fb, ams, fms;
    char name[17];
  };

  struct Header {
    unsigned int fmClock, psgClock, fps;
    unsigned int speedEven, speedOdd, interleave;
    unsigned int sampleRate;
    int orderLen, loopPos;
    char name[65], author[65], message[385];
    unsigned short dateCreated, dateModified, saveCount;
  };

  // lê um .vge (0 = certo, 2 = formato errado, 3 = sem memória)
  int load(const unsigned char* buf, size_t len);
  // música vazia
  void clear();

  void getHeader(Header& h);
  void setHeader(const Header& h);
  int orderPattern(int i);
  void setOrderPattern(int i, int p);
  int patternLength(int p);
  void setPatternLength(int p, int len);
  void getCell(int p, int row, int ch, Cell& c);
  void setCell(int p, int row, int ch, const Cell& c);
  bool insEmpty(int i);
  void getIns(int i, Ins& ins);
  void setIns(int i, const Ins& ins);
  // amostra já convertida (8 bits sem sinal na taxa da música, sem o 0x80 do fim); NULL se vazia
  const unsigned char* sampleData(int i, int& len);
  const char* sampleName(int i);

  // tocador: começa na posição; as escritas iniciais saem em out
  void start(int order, int row, std::vector<Write>& out, std::vector<int>& dac);
  // um tique: escritas em out, DAC em dac (amostra que começou ou -1 = parou);
  // order/row = linha que este tique leu (newRow = true quando é o primeiro tique dela).
  // devolve true quando o tocador passa pelo ponto de volta (laço)
  bool tick(std::vector<Write>& out, std::vector<int>& dac, int& order, int& row, bool& newRow);
  bool playing();
}

#endif
