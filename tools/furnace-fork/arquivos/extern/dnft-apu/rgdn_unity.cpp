// RG: o áudio do Dn-FamiTracker 0.5.3 (APU, mixer, NSFPlay 2A03, Mesen FDS/N163, emu2413 do Dn, Blip_Buffer do Dn)
// compilado inteiro dentro do namespace rgdn, para não colidir com as cópias de NSFPlay/emu2413 do próprio Furnace.
// Licença: GPLv3+ (Dn-FamiTracker), LGPL (Blip_Buffer). Ver LICENSE*.
#include <limits.h>
#include <algorithm>
#include <array>
#include <assert.h>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <functional>
#include <initializer_list>
#include <iosfwd>
#include <iterator>
#include <limits>
#include <math.h>
#include <memory>
#include <new>
#include <numeric>
#include <optional>
#include <stdarg.h>
#include <stdexcept>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <system_error>
#include <type_traits>
#include <utility>
#include <variant>
#include <vector>
#include <unordered_map>
#include "gsl/span"
#include "gsl/gsl_util"

#define RGDN_NO_EXTERN_C
// a ponte abaixo precisa mexer em partes internas (máscara do emu2413 do VRC7); só neste arquivo
#define private public
#define protected public
namespace rgdn {
#include "stdafx.h"
#include "RegisterState.cpp"
#include "Blip_Buffer/Blip_Buffer.cpp"
#include "APU/nsfplay/xgm/devices/Sound/nes_apu.cpp"
#include "APU/nsfplay/xgm/devices/Sound/nes_dmc.cpp"
#include "APU/digital-sound-antiques/emu2413.c"
#undef OPLL_TONE_NUM
#include "APU/SoundChip.cpp"
#include "APU/SoundChip2.cpp"
#include "APU/Square.cpp"
#include "APU/2A03.cpp"
#include "APU/VRC6.cpp"
#include "APU/MMC5.cpp"
#include "APU/S5B.cpp"
#include "APU/FDS.cpp"
#include "APU/N163.cpp"
#include "APU/VRC7.cpp"
#include "APU/Mixer.cpp"
#include "APU/APU.cpp"
}
#undef private
#undef protected

// ---------------------------------------------------------------------------------------------
// RG: ponte Furnace -> Dn (fora do namespace)
#include "../rgdn.h"

struct RGDnAPU::Impl: public rgdn::IAudioCallback {
  rgdn::CAPU* apu;
  std::vector<short> fifo;
  size_t fifoPos;
  struct Op { int chip; unsigned short addr; unsigned char val; };
  std::vector<Op> ops;
  int frameCycles;
  double frameSamples;
  bool pal;
  int expansions;
  // sombras dos registradores (valor real, sem o silêncio dos canais mudos)
  unsigned char reg2A03[0x18], regVRC6[3][3], regMMC5[0x16], regFDS80, n163[128], vrc7[64], s5b[16];
  int vrc7Port, s5bPort;
  bool mute[RGDN_CHIPS][8];
  void FlushBuffer(int16_t const* b, uint32_t n) override {
    fifo.insert(fifo.end(),b,b+n);
  }
  Impl(): apu(NULL), fifoPos(0), frameCycles(29829), frameSamples(735), pal(false), expansions(0), vrc7Port(0), s5bPort(0) {
    clearShadows();
    memset(mute,0,sizeof(mute));
  }
  ~Impl() { delete apu; }
  void clearShadows() {
    memset(reg2A03,0,sizeof(reg2A03)); memset(regVRC6,0,sizeof(regVRC6)); memset(regMMC5,0,sizeof(regMMC5));
    regFDS80=0x80; memset(n163,0,sizeof(n163)); memset(vrc7,0,sizeof(vrc7)); memset(s5b,0,sizeof(s5b));
    vrc7Port=0; s5bPort=0;
  }
  // valor que vai para o chip, com o silêncio dos canais mudos. devolve false para não escrever.
  bool filter(int chip, unsigned short addr, unsigned char& v) {
    switch (chip) {
      case RGDN_2A03:
        if (addr==0x4000 && mute[0][0]) v=(v&0xc0)|0x30;
        if (addr==0x4004 && mute[0][1]) v=(v&0xc0)|0x30;
        if (addr==0x4008 && mute[0][2]) v=0;
        if (addr==0x400c && mute[0][3]) v=(v&0xc0)|0x30;
        if (addr==0x4015 && mute[0][4]) v&=~0x10;
        if (addr==0x4011 && mute[0][4]) return false;
        break;
      case RGDN_VRC6:
        if (addr==0x9000 && mute[1][0]) v&=0xf0;
        if (addr==0xa000 && mute[1][1]) v&=0xf0;
        if (addr==0xb000 && mute[1][2]) v=0;
        break;
      case RGDN_MMC5:
        if (addr==0x5000 && mute[4][0]) v=(v&0xc0)|0x30;
        if (addr==0x5004 && mute[4][1]) v=(v&0xc0)|0x30;
        if (addr==0x5011 && mute[4][2]) return false;
        break;
      case RGDN_FDS:
        if (addr==0x4080 && mute[3][0]) v=0x80;
        break;
      case RGDN_S5B:
        if (addr==0xe000 && s5bPort>=8 && s5bPort<11 && mute[6][s5bPort-8]) v=0;
        break;
      default: break;
    }
    return true;
  }
  // VRC7: canais mudos pela máscara do emu2413 (silêncio total)
  void applyVRC7Mask() {
    if (!apu || !apu->m_pVRC7 || !apu->m_pVRC7->m_pOPLLInt) return;
    uint32_t m=0;
    for (int c=0; c<6; c++) if (mute[RGDN_VRC7][c]) m|=1u<<c;
    rgdn::OPLL_setMask(apu->m_pVRC7->m_pOPLLInt,m);
  }
  void queue(int chip, unsigned short addr, unsigned char val) {
    // sombras
    switch (chip) {
      case RGDN_2A03: if (addr>=0x4000 && addr<0x4018) reg2A03[addr-0x4000]=val; break;
      case RGDN_VRC6: if (addr>=0x9000 && addr<=0xb002 && (addr&0xfff)<3) regVRC6[(addr>>12)-9][addr&3]=val; break;
      case RGDN_MMC5: if (addr>=0x5000 && addr<0x5016) regMMC5[addr-0x5000]=val; break;
      case RGDN_FDS: if (addr==0x4080) regFDS80=val; break;
      case RGDN_VRC7: if (addr==0x9010) vrc7Port=val&0x3f; else if (addr==0x9030) vrc7[vrc7Port&0x3f]=val; break;
      case RGDN_S5B: if (addr==0xc000) s5bPort=val&15; else if (addr==0xe000) s5b[s5bPort&15]=val; break;
      default: break;
    }
    unsigned char v=val;
    if (!filter(chip,addr,v)) return;
    ops.push_back({chip,addr,v});
  }
  void renderFrame() {
    int used=0, prev=-1;
    for (Op& o: ops) {
      if (prev!=-1 && o.chip!=prev) {
        if (used+250<frameCycles) { apu->AddCycles(250); apu->Process(); used+=250; }
      }
      prev=o.chip;
      apu->Write(o.addr,o.val);
    }
    ops.clear();
    apu->AddCycles(frameCycles-used);
    apu->Process();
  }
};

RGDnAPU::RGDnAPU(): p(new Impl) {}
RGDnAPU::~RGDnAPU() { delete p; }

void RGDnAPU::setup(int expansions, int tickRate, int sampleRate, bool pal, int vrc7Patch, bool survey, const short* levelOffsets, const unsigned char* opllPatch) {
  using namespace rgdn;
  delete p->apu;
  p->apu=new CAPU(p);
  p->pal=pal;
  p->expansions=expansions&63;
  int machine=pal?MACHINE_PAL:MACHINE_NTSC;
  if (tickRate<1) tickRate=pal?50:60;
  p->apu->SetupSound(sampleRate,1,machine);
  p->apu->ChangeMachineRate(machine,tickRate);
  p->frameCycles=(int)((pal?CAPU::BASE_FREQ_PAL:CAPU::BASE_FREQ_NTSC)/(unsigned)tickRate);
  p->frameSamples=(double)sampleRate/(double)tickRate;
  {
    CAPUConfig c(p->apu);
    c.SetExternalSound((uint8_t)p->expansions);
    if (vrc7Patch<0 || vrc7Patch>=CAPU::OPLL_TONE_NUM) vrc7Patch=0;
    std::vector<uint8_t> pb(CAPU::OPLL_DEFAULT_PATCHES[vrc7Patch],CAPU::OPLL_DEFAULT_PATCHES[vrc7Patch]+19*8);
    if (opllPatch) pb.assign(opllPatch,opllPatch+19*8);
    std::vector<std::string> pn(CAPU::OPLL_PATCHNAME_VRC7,CAPU::OPLL_PATCHNAME_VRC7+19);
    // valores padrão do Dn (Settings.cpp): N163 multiplexado, filtros 30 Hz / 12 kHz / 24 dB, FDS 2 kHz, N163 12 kHz
    c.SetupEmulation(true,vrc7Patch,opllPatch!=NULL,pb,pn);
    std::vector<int16_t> offs(8,0);
    if (levelOffsets) for (int i=0; i<8; i++) offs[i]=levelOffsets[i];
    c.SetupMixer(30,12000,24,100,survey,2000,12000,offs);
    if (survey) {
      // níveis "survey" padrão do Dn (Settings.cpp, centésimos de dB) mais o ajuste do módulo
      static const int SURVEY[8]={0,-20,0,1340,690,0,1540,-250};
      for (int i=0; i<CHIP_LEVEL_COUNT && i<8; i++) c.SetChipLevel((chip_level_t)i,(float)(SURVEY[i]+offs[i])/100.0f,true);
    } else {
      for (int i=0; i<CHIP_LEVEL_COUNT; i++) c.SetChipLevel((chip_level_t)i,0.0f,false);
    }
  }
  reset();
}

void RGDnAPU::reset() {
  if (!p->apu) return;
  p->apu->Reset();
  p->fifo.clear();
  p->fifoPos=0;
  p->ops.clear();
  p->clearShadows();
  // CSoundGen::ResetAPU do Dn
  p->apu->Write(0x4015,0x0f);
  p->apu->Write(0x4017,0x00);
  p->apu->Write(0x4023,0x02);
  p->apu->Write(0x4023,0x83);
  p->apu->Write(0xe7ff,0x00);
  p->apu->Write(0x5015,0x03);
  p->applyVRC7Mask();
}

void RGDnAPU::write(int chip, unsigned short addr, unsigned char val) {
  if (!p->apu) return;
  p->queue(chip,addr,val);
}

void RGDnAPU::writeN163(unsigned char addr, unsigned char val, unsigned char mask) {
  if (!p->apu) return;
  addr&=0x7f;
  p->n163[addr]=(p->n163[addr]&~mask)|(val&mask);
  unsigned char v=p->n163[addr];
  // volume do canal (byte 7 de cada bloco de 8 a partir de 0x40): canal Furnace c = (0x7f-addr)/8
  if (addr>=0x40 && (addr&7)==7) {
    int c=(0x7f-addr)>>3;
    if (c>=0 && c<8 && p->mute[RGDN_N163][c]) v&=0xf0;
  }
  p->ops.push_back({RGDN_N163,0xf800,addr});
  p->ops.push_back({RGDN_N163,0x4800,v});
}

void RGDnAPU::setSampleMem(const unsigned char* mem, size_t len) {
  if (!p->apu) return;
  p->apu->WriteSample((const char*)mem,(int)len);
}

void RGDnAPU::setMute(int chip, int chan, bool m) {
  if (!p->apu || chip<0 || chip>=RGDN_CHIPS || chan<0 || chan>=8) return;
  if (p->mute[chip][chan]==m) return;
  p->mute[chip][chan]=m;
  // regrava o registrador de volume com o valor real (ou o silêncio)
  auto again=[&](int c, unsigned short a, unsigned char v) {
    unsigned char x=v;
    if (p->filter(c,a,x)) p->ops.push_back({c,a,x});
  };
  switch (chip) {
    case RGDN_2A03: {
      static const unsigned short A[5]={0x4000,0x4004,0x4008,0x400c,0x4015};
      if (chan<5) again(chip,A[chan],p->reg2A03[A[chan]-0x4000]);
      break;
    }
    case RGDN_VRC6: if (chan<3) again(chip,(unsigned short)(0x9000+chan*0x1000),p->regVRC6[chan][0]); break;
    case RGDN_MMC5: if (chan<2) again(chip,(unsigned short)(0x5000+chan*4),p->regMMC5[chan*4]); break;
    case RGDN_FDS: if (chan==0) again(chip,0x4080,p->regFDS80); break;
    case RGDN_N163: {
      unsigned char a=(unsigned char)(0x7f-chan*8);
      writeN163(a,p->n163[a],0);
      break;
    }
    case RGDN_VRC7: p->applyVRC7Mask(); break;
    case RGDN_S5B: if (chan<3) {
      int keep=p->s5bPort;
      p->ops.push_back({chip,0xc000,(unsigned char)(8+chan)});
      p->s5bPort=8+chan;
      again(chip,0xe000,p->s5b[8+chan]);
      p->s5bPort=keep;
      p->ops.push_back({chip,0xc000,(unsigned char)keep});
      break;
    }
    default: break;
  }
}

void RGDnAPU::tick() {
  if (!p->apu) return;
  // compacta a fila de saída e gera o quadro deste tique (com as escritas que chegaram nele)
  if (p->fifoPos>0) {
    p->fifo.erase(p->fifo.begin(),p->fifo.begin()+p->fifoPos);
    p->fifoPos=0;
  }
  // não deixa a fila crescer (tiques sem áudio pedido): fica no máximo com 2 quadros
  size_t cap=(size_t)(2*p->frameSamples)+64;
  if (p->fifo.size()>cap) p->fifo.erase(p->fifo.begin(),p->fifo.end()-cap);
  p->renderFrame();
}

void RGDnAPU::render(short* out, size_t len) {
  if (!p->apu) { memset(out,0,len*sizeof(short)); return; }
  size_t avail=p->fifo.size()-p->fifoPos;
  size_t k=std::min(len,avail);
  if (k) memcpy(out,p->fifo.data()+p->fifoPos,k*sizeof(short));
  p->fifoPos+=k;
  // falta de amostras (o quadro do Dn tem um pouquinho menos de ciclos que o tique): repete a última
  short last=k?out[k-1]:(p->fifo.empty()?0:p->fifo.back());
  for (size_t i=k; i<len; i++) out[i]=last;
}
