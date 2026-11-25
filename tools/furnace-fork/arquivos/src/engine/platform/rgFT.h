/**
 * Registro Gamer: regras do FamiTracker/0CC usadas pelos chips de expansão no modo FamiTracker
 * (compatFlags.rgFamiTracker). O 2A03 (nes.cpp) tem a versão original destas regras.
 *
 * Cada chip guarda um DivRGFTChan junto do seu canal e chama estas funções nos mesmos pontos
 * onde o nes.cpp aplica as regras (nota, volume, macro de volume, arpejo, pitch, portamento).
 */

#ifndef _RG_FT_H
#define _RG_FT_H

#include "../dispatch.h"

struct DivRGFTChan {
  // último valor da macro (sequência) de volume do instrumento; 15 = sem sequência
  int macVol;
  // o volume do canal tem fração (> 0 mesmo com a parte inteira 0): vem do value2 de DIV_CMD_VOLUME
  bool volNZ;
  // duty padrão (último Vxx): cada nota nova volta a ele
  int defDuty;
  DivRGFTChan():
    macVol(15),
    volNZ(true),
    defDuty(0) {}
};

// volume do 0CC (CChannelHandler::CalculateVolume + LimitVolume): instrumento x canal / 15,
// nunca 0 se os dois forem > 0 (o "volume" do canal conta a fração dos slides)
static inline int rgFTVolMul(int chanVol, int macVol, bool volNZ, int maxVol=15) {
  int v=(chanVol*macVol)/15;
  if (v<0) v=0;
  if (v>maxVol) v=maxVol;
  if (v==0 && macVol>0 && (chanVol>0 || volNZ)) v=1;
  return v;
}

// volume do 0CC no Sunsoft 5B: canal + instrumento - 15 (mesma regra do "nunca 0")
static inline int rgFTVolAdd(int chanVol, int macVol, bool volNZ, int maxVol=15) {
  int v=chanVol+macVol-15;
  if (v<0) v=0;
  if (v>maxVol) v=maxVol;
  if (v==0 && macVol>0 && (chanVol>0 || volNZ)) v=1;
  return v;
}

// volume do dente de serra do VRC6 com sequência de 64 passos (CVRC6Sawtooth::CalculateVolume)
static inline int rgFTVolSaw64(int chanVol, int macVol, bool volNZ) {
  int v=((macVol+1)*(chanVol+1)-1)/16;
  if (v<0) v=0;
  if (v>63) v=63;
  if (v==0 && macVol>0 && (chanVol>0 || volNZ)) v=1;
  return v;
}

// DIV_CMD_LEGATO com value2=1 (arpejo do efeito 0xy): não mexe na nota base e é ignorado
// enquanto a sequência de arpejo do instrumento roda. devolve true se tratou o comando.
template<typename T> static inline bool rgFTLegato(bool ft, T& ch, const DivCommand& c, int delta=0) {
  if (!ft || c.value2!=1) return false;
  if (!ch.std.arp.has) {
    ch.baseFreq=ch.calcBaseFreq(c.value+delta);
    ch.freqChanged=true;
  }
  return true;
}

// sequência de pitch relativa: no FamiTracker mexe no próprio período (portamento, arpejo e nota nova absorvem).
// devolve true se tratou. o importador já inverte o sinal para os chips de período.
template<typename T> static inline bool rgFTPitchMacro(bool ft, T& ch, int maxBase) {
  if (!ft || !ch.std.pitch.mode) return false;
  ch.baseFreq-=ch.std.pitch.val;
  if (ch.baseFreq<0) ch.baseFreq=0;
  if (ch.baseFreq>maxBase) ch.baseFreq=maxBase;
  ch.freqChanged=true;
  return true;
}

// slides 1xx/2xx (NOTE_PORTA para notas fora da faixa): no FamiTracker só param no limite do registrador
static inline int rgFTPortaDest(bool ft, int note, int destFreq, int maxBase) {
  if (!ft) return destFreq;
  if (note>155) return 1;
  if (note<60) return maxBase;
  return destFreq;
}

#endif
