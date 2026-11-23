/**
 * Furnace Tracker - multi-system chiptune tracker
 * Copyright (C) 2021-2026 tildearrow and contributors
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// Registro Gamer: Sony PlayStation SPU.
// the core follows the hardware description in psx-spx (ADPCM blocks of 28 samples,
// ADSR envelope, 14-bit pitch where 1000h = 44100Hz). samples are encoded to the
// SPU ADPCM format when rendered, with the loop aligned to a block.

#include "psx.h"
#include "../engine.h"
#include "../../ta-log.h"
#include <math.h>

#define CHIP_FREQBASE 131072

#define PSX_RAM 0x80000
#define PSX_SILENCE 0x1000
#define PSX_SAMPLES 0x1010

#define rWrite(a,v) if (!skipRegisterWrites) {writes.push(QueuedWrite(a,v)); regPool[((a)>>1)&0x1ff]=(v); if (dumpWrites) {addWrite(a,v);} }
#define vWrite(c,a,v) rWrite(((c)<<4)+(a),v)

static const int psxF0[5]={0,60,115,98,122};
static const int psxF1[5]={0,0,-52,-55,-60};

const char* regCheatSheetPSX[]={
  "VxVolL", "x*10+0",
  "VxVolR", "x*10+2",
  "VxPitch", "x*10+4",
  "VxStart", "x*10+6",
  "VxADSR1", "x*10+8",
  "VxADSR2", "x*10+A",
  "VxLevel", "x*10+C",
  "VxRepeat", "x*10+E",
  "MainVolL", "180",
  "MainVolR", "182",
  "KeyOn", "188",
  "KeyOff", "18C",
  "Noise", "194",
  "Reverb", "198",
  "EndX", "19C",
  "Control", "1AA",
  NULL
};

const char** DivPlatformPSX::getRegisterSheet() {
  return regCheatSheetPSX;
}

// ---------------- SPU core ----------------

void PSXSPUCore::reset() {
  memset(regs,0,sizeof(regs));
  memset(v,0,sizeof(v));
  endx=0;
}

void PSXSPUCore::decode(Voice& vo) {
  unsigned int a=vo.addr&(PSX_RAM-16);
  unsigned char hdr=ram[a];
  int shift=hdr&15;
  int filter=(hdr>>4)&7;
  if (shift>12) shift=9;
  if (filter>4) filter=4;
  vo.flags=ram[a+1];
  if (vo.flags&4) vo.repeat=a;
  for (int i=0; i<28; i++) {
    int nib=(ram[a+2+(i>>1)]>>((i&1)<<2))&15;
    int t=((short)(nib<<12))>>shift;
    int s=t+((vo.s1*psxF0[filter]+vo.s2*psxF1[filter]+32)>>6);
    if (s>32767) s=32767;
    if (s<-32768) s=-32768;
    vo.s2=vo.s1;
    vo.s1=s;
    vo.dec[i]=s;
  }
}

void PSXSPUCore::keyOn(int i) {
  Voice& vo=v[i];
  vo.addr=(unsigned int)regs[(i<<3)+3]<<3;
  vo.repeat=vo.addr;
  vo.counter=0;
  vo.pos=0;
  vo.s1=0;
  vo.s2=0;
  vo.phase=1;
  vo.level=0;
  vo.wait=0;
  vo.on=true;
  endx&=~(1<<i);
  decode(vo);
  vo.hist[0]=vo.hist[1]=vo.hist[2]=0;
  vo.hist[3]=vo.dec[0];
}

void PSXSPUCore::keyOff(int i) {
  if (v[i].phase!=0) {
    v[i].phase=4;
    v[i].wait=0;
  }
}

void PSXSPUCore::write(unsigned short addr, unsigned short val) {
  unsigned short r=(addr>>1)&0x1ff;
  regs[r]=val;
  switch (addr&0x3fe) {
    case 0x188: for (int i=0; i<16; i++) if (val&(1<<i)) keyOn(i); break;
    case 0x18a: for (int i=0; i<8; i++) if (val&(1<<i)) keyOn(16+i); break;
    case 0x18c: for (int i=0; i<16; i++) if (val&(1<<i)) keyOff(i); break;
    case 0x18e: for (int i=0; i<8; i++) if (val&(1<<i)) keyOff(16+i); break;
    default: break;
  }
}

void PSXSPUCore::advance(int i) {
  Voice& vo=v[i];
  vo.pos++;
  if (vo.pos>=28) {
    vo.pos=0;
    if (vo.flags&1) {
      endx|=(1<<i);
      if (vo.flags&2) {
        vo.addr=vo.repeat;
      } else {
        // end without repeat: the voice goes silent
        vo.phase=0;
        vo.level=0;
        vo.on=false;
        vo.addr=vo.repeat;
      }
    } else {
      vo.addr=(vo.addr+16)&(PSX_RAM-1);
    }
    decode(vo);
  }
  vo.hist[0]=vo.hist[1];
  vo.hist[1]=vo.hist[2];
  vo.hist[2]=vo.hist[3];
  vo.hist[3]=vo.dec[vo.pos];
}

// one step of the ADSR envelope (psx-spx "SPU ADSR Envelope")
void PSXSPUCore::envelope(int i) {
  Voice& vo=v[i];
  if (vo.phase==0) return;
  unsigned short a1=regs[(i<<3)+4];
  unsigned short a2=regs[(i<<3)+5];
  bool expo=false, decrease=false;
  int shift=0, step=0;
  switch (vo.phase) {
    case 1: // attack
      expo=a1&0x8000;
      shift=(a1>>10)&31;
      step=7-((a1>>8)&3);
      break;
    case 2: // decay
      expo=true;
      decrease=true;
      shift=((a1>>4)&15)<<2;
      step=-8;
      break;
    case 3: // sustain
      expo=a2&0x8000;
      decrease=a2&0x4000;
      shift=(a2>>8)&31;
      step=decrease?(-8+((a2>>6)&3)):(7-((a2>>6)&3));
      break;
    case 4: // release
      expo=a2&0x20;
      decrease=true;
      shift=a2&31;
      step=-8;
      break;
  }
  if (vo.wait>0) {
    vo.wait--;
  } else {
    int cycles=1<<MAX(0,shift-11);
    int stepv=step<<MAX(0,11-shift);
    if (expo && !decrease && vo.level>0x6000) cycles*=4;
    if (expo && decrease) stepv=(stepv*vo.level)>>15;
    vo.wait=cycles-1;
    vo.level+=stepv;
    if (vo.level>0x7fff) vo.level=0x7fff;
    if (vo.level<0) vo.level=0;
  }
  switch (vo.phase) {
    case 1:
      if (vo.level>=0x7fff) {
        vo.phase=2;
        vo.wait=0;
      }
      break;
    case 2:
      if (vo.level<=(int)(((a1&15)+1)<<11)) {
        vo.phase=3;
        vo.wait=0;
      }
      break;
    case 4:
      if (vo.level<=0) {
        vo.phase=0;
        vo.on=false;
      }
      break;
  }
}

static inline int psxVol(unsigned short r) {
  // fixed volume: bit 15 clear, 15-bit signed value (only the fixed mode is used here)
  if (r&0x8000) return 0x3fff;
  return ((short)(r<<1))>>1;
}

void PSXSPUCore::tick(int& outL, int& outR, int* chOut) {
  int mixL=0, mixR=0;
  for (int i=0; i<24; i++) {
    Voice& vo=v[i];
    if (!vo.on) {
      chOut[i]=0;
      continue;
    }
    // linear interpolation between the last two samples
    int frac=vo.counter&0xfff;
    int smp=vo.hist[2]+(((vo.hist[3]-vo.hist[2])*frac)>>12);
    envelope(i);
    smp=(smp*vo.level)>>15;
    chOut[i]=smp;
    mixL+=(smp*psxVol(regs[(i<<3)+0]))>>14;
    mixR+=(smp*psxVol(regs[(i<<3)+1]))>>14;
    int pitch=regs[(i<<3)+2];
    if (pitch>0x3fff) pitch=0x3fff;
    vo.counter+=pitch;
    while (vo.counter>=0x1000) {
      vo.counter-=0x1000;
      advance(i);
      if (!vo.on) break;
    }
  }
  if (!(regs[0x1aa>>1]&0x4000)) {
    mixL=0;
    mixR=0;
  }
  // the level measured against Highly Experimental/aopsf playing the same registers
  outL=(((mixL*psxVol(regs[0x180>>1]))>>14)*177)>>7;
  outR=(((mixR*psxVol(regs[0x182>>1]))>>14)*177)>>7;
}

// ---------------- dispatch ----------------

void DivPlatformPSX::acquire(short** buf, size_t len) {
  for (int i=0; i<24; i++) oscBuf[i]->begin(len);
  while (!writes.empty()) {
    QueuedWrite w=writes.front();
    spu.write(w.addr,w.val);
    writes.pop();
  }
  int chOut[24];
  for (size_t h=0; h<len; h++) {
    int l, r;
    spu.tick(l,r,chOut);
    if (l>32767) l=32767;
    if (l<-32768) l=-32768;
    if (r>32767) r=32767;
    if (r<-32768) r=-32768;
    buf[0][h]=l;
    buf[1][h]=r;
    for (int i=0; i<24; i++) oscBuf[i]->putSample(h,chOut[i]>>1);
  }
  for (int i=0; i<24; i++) oscBuf[i]->end(len);
}

void DivPlatformPSX::writeOutVol(int ch) {
  int v=isMuted[ch]?0:(chan[ch].outVol*0x3fff/127);
  vWrite(ch,0,(v*chan[ch].panL/255)&0x3fff);
  vWrite(ch,2,(v*chan[ch].panR/255)&0x3fff);
}

void DivPlatformPSX::tick(bool sysTick) {
  konMask=0;
  koffMask=0;
  for (int i=0; i<24; i++) {
    chan[i].std.next();
    if (chan[i].std.vol.had) {
      chan[i].outVol=((chan[i].vol&0x7f)*MIN(chan[i].macroVolMul,chan[i].std.vol.val))/chan[i].macroVolMul;
      writeOutVol(i);
    }
    if (NEW_ARP_STRAT) {
      chan[i].handleArp();
    } else if (chan[i].std.arp.had) {
      if (!chan[i].inPorta) {
        chan[i].baseFreq=chan[i].calcBaseFreq(parent->calcArp(chan[i].note,chan[i].std.arp.val));
      }
      chan[i].freqChanged=true;
    }
    if (chan[i].std.pitch.had) {
      if (chan[i].std.pitch.mode) {
        chan[i].pitch2+=chan[i].std.pitch.val;
        CLAMP_VAR(chan[i].pitch2,-32768,32767);
      } else {
        chan[i].pitch2=chan[i].std.pitch.val;
      }
      chan[i].freqChanged=true;
    }
    if (chan[i].std.panL.had) {
      chan[i].panL=chan[i].std.panL.val&255;
      writeOutVol(i);
    }
    if (chan[i].std.panR.had) {
      chan[i].panR=chan[i].std.panR.val&255;
      writeOutVol(i);
    }
    if (chan[i].freqChanged || chan[i].keyOn || chan[i].keyOff) {
      chan[i].freq=chan[i].calcFreq();
      if (chan[i].freq<0) chan[i].freq=0;
      if (chan[i].freq>0x3fff) chan[i].freq=0x3fff;
      if (chan[i].keyOn) {
        unsigned int start=PSX_SILENCE;
        if (chan[i].sample>=0 && chan[i].sample<parent->song.sampleLen && sampleLoaded[chan[i].sample]) {
          start=sampleOff[chan[i].sample];
        }
        vWrite(i,6,start>>3);
        // instant attack, full sustain, short release (Furnace's macros shape the volume)
        vWrite(i,8,0x000f);
        vWrite(i,10,0x1fc8);
        writeOutVol(i);
        konMask|=1<<i;
        chan[i].keyOn=false;
      }
      if (chan[i].keyOff) {
        koffMask|=1<<i;
        chan[i].keyOff=false;
      }
      if (chan[i].freqChanged) {
        vWrite(i,4,chan[i].freq);
        chan[i].freqChanged=false;
      }
    }
  }
  if (koffMask&0xffff) rWrite(0x18c,koffMask&0xffff);
  if (koffMask>>16) rWrite(0x18e,koffMask>>16);
  if (konMask&0xffff) rWrite(0x188,konMask&0xffff);
  if (konMask>>16) rWrite(0x18a,konMask>>16);
}

int DivPlatformPSX::dispatch(DivCommand c) {
  switch (c.cmd) {
    case DIV_CMD_NOTE_ON: {
      DivInstrument* ins=parent->getIns(chan[c.chan].ins,DIV_INS_AMIGA);
      chan[c.chan].macroVolMul=ins->type==DIV_INS_AMIGA?64:127;
      if (c.value!=DIV_NOTE_NULL) {
        chan[c.chan].sample=ins->amiga.getSample(c.value);
        chan[c.chan].pitchTable=samplePitchTable.get(chan[c.chan].sample);
        chan[c.chan].sampleNote=c.value;
        c.value=ins->amiga.getFreq(c.value);
        chan[c.chan].sampleNoteDelta=c.value-chan[c.chan].sampleNote;
      }
      if (chan[c.chan].sample<0 || chan[c.chan].sample>=parent->song.sampleLen) {
        chan[c.chan].sample=-1;
      }
      if (c.value!=DIV_NOTE_NULL) {
        chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(c.value);
        chan[c.chan].freqChanged=true;
        chan[c.chan].note=c.value;
      }
      chan[c.chan].active=true;
      chan[c.chan].keyOn=true;
      chan[c.chan].macroInit(ins);
      if (!parent->song.compatFlags.brokenOutVol && !chan[c.chan].std.vol.will) {
        chan[c.chan].outVol=chan[c.chan].vol;
      }
      break;
    }
    case DIV_CMD_NOTE_OFF:
      chan[c.chan].active=false;
      chan[c.chan].keyOff=true;
      chan[c.chan].macroInit(NULL);
      break;
    case DIV_CMD_NOTE_OFF_ENV:
    case DIV_CMD_ENV_RELEASE:
      chan[c.chan].std.release();
      break;
    case DIV_CMD_INSTRUMENT:
      if (chan[c.chan].ins!=c.value || c.value2==1) {
        chan[c.chan].ins=c.value;
      }
      break;
    case DIV_CMD_VOLUME:
      if (chan[c.chan].vol!=c.value) {
        chan[c.chan].vol=c.value;
        if (!chan[c.chan].std.vol.has) {
          chan[c.chan].outVol=c.value;
          writeOutVol(c.chan);
        }
      }
      break;
    case DIV_CMD_GET_VOLUME:
      if (chan[c.chan].std.vol.has) {
        return chan[c.chan].vol;
      }
      return chan[c.chan].outVol;
      break;
    case DIV_CMD_PANNING:
      chan[c.chan].panL=c.value;
      chan[c.chan].panR=c.value2;
      writeOutVol(c.chan);
      break;
    case DIV_CMD_PITCH:
      chan[c.chan].pitch=c.value;
      chan[c.chan].freqChanged=true;
      break;
    case DIV_CMD_NOTE_PORTA: {
      int destFreq=chan[c.chan].calcBaseFreq(c.value2+chan[c.chan].sampleNoteDelta);
      bool return2=false;
      if (destFreq>chan[c.chan].baseFreq) {
        chan[c.chan].baseFreq+=c.value;
        if (chan[c.chan].baseFreq>=destFreq) {
          chan[c.chan].baseFreq=destFreq;
          return2=true;
        }
      } else {
        chan[c.chan].baseFreq-=c.value;
        if (chan[c.chan].baseFreq<=destFreq) {
          chan[c.chan].baseFreq=destFreq;
          return2=true;
        }
      }
      chan[c.chan].freqChanged=true;
      if (return2) {
        chan[c.chan].inPorta=false;
        return 2;
      }
      break;
    }
    case DIV_CMD_LEGATO: {
      chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(c.value+chan[c.chan].sampleNoteDelta+((HACKY_LEGATO_MESS)?(chan[c.chan].std.arp.val-12):(0)));
      chan[c.chan].freqChanged=true;
      chan[c.chan].note=c.value;
      break;
    }
    case DIV_CMD_PRE_PORTA:
      if (chan[c.chan].active && c.value2) {
        if (parent->song.compatFlags.resetMacroOnPorta) chan[c.chan].macroInit(parent->getIns(chan[c.chan].ins,DIV_INS_AMIGA));
      }
      if (!chan[c.chan].inPorta && c.value && !parent->song.compatFlags.brokenPortaArp && chan[c.chan].std.arp.will && !NEW_ARP_STRAT) chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(chan[c.chan].note);
      chan[c.chan].inPorta=c.value;
      break;
    case DIV_CMD_GET_VOLMAX:
      return 127;
      break;
    case DIV_CMD_MACRO_OFF:
      chan[c.chan].std.mask(c.value,true);
      break;
    case DIV_CMD_MACRO_ON:
      chan[c.chan].std.mask(c.value,false);
      break;
    case DIV_CMD_MACRO_RESTART:
      chan[c.chan].std.restart(c.value);
      break;
    default:
      break;
  }
  return 1;
}

void DivPlatformPSX::muteChannel(int ch, bool mute) {
  isMuted[ch]=mute;
  writeOutVol(ch);
}

void DivPlatformPSX::forceIns() {
  for (int i=0; i<24; i++) {
    chan[i].insChanged=true;
    chan[i].freqChanged=true;
    writeOutVol(i);
  }
}

SharedChannel* DivPlatformPSX::getChanState(int ch) {
  return &chan[ch];
}

DivMacroInt* DivPlatformPSX::getChanMacroInt(int ch) {
  return &chan[ch].std;
}

unsigned short DivPlatformPSX::getPan(int ch) {
  return (chan[ch].panL<<8)|chan[ch].panR;
}

DivDispatchOscBuffer* DivPlatformPSX::getOscBuffer(int ch) {
  return oscBuf[ch];
}

void DivPlatformPSX::reset() {
  writes.clear();
  memset(regPool,0,sizeof(regPool));
  spu.ram=sampleMem;
  spu.reset();
  for (int i=0; i<24; i++) {
    chan[i]=DivPlatformPSX::Channel(parent->song.compatFlags.linearPitch);
    chan[i].std.setEngine(parent);
  }
  rWrite(0x1aa,0xc000); // SPU on, unmuted
  rWrite(0x180,0x3fff); // main volume
  rWrite(0x182,0x3fff);
  rWrite(0x184,0); // reverb out
  rWrite(0x186,0);
  rWrite(0x190,0); // pitch modulation
  rWrite(0x192,0);
  rWrite(0x194,0); // noise
  rWrite(0x196,0);
  rWrite(0x198,0); // reverb
  rWrite(0x19a,0);
  for (int i=0; i<24; i++) {
    vWrite(i,0,0);
    vWrite(i,2,0);
    vWrite(i,4,0x1000);
    vWrite(i,6,PSX_SILENCE>>3);
    vWrite(i,8,0x000f);
    vWrite(i,10,0x1fc8);
  }
  rWrite(0x18c,0xffff);
  rWrite(0x18e,0x00ff);
}

int DivPlatformPSX::getOutputCount() {
  return 2;
}

bool DivPlatformPSX::hasSoftPan(int ch) {
  return true;
}

void DivPlatformPSX::notifyInsChange(int ins) {
  for (int i=0; i<24; i++) {
    if (chan[i].ins==ins) chan[i].insChanged=true;
  }
}

void DivPlatformPSX::notifyInsDeletion(void* ins) {
  for (int i=0; i<24; i++) chan[i].std.notifyInsDeletion((DivInstrument*)ins);
}

void DivPlatformPSX::notifyPitchTable(int sample) {
  samplePitchTable.update<Channel>(chan,24,parent->song.tuning,chipClock,CHIP_FREQBASE,0x3fff,false,parent->song.compatFlags.linearPitch,sample);
}

unsigned int DivPlatformPSX::getMaxFreq(int ch) {
  return 0x3fff;
}

void DivPlatformPSX::poke(unsigned int addr, unsigned short val) {
  rWrite(addr&0x3fe,val);
}

void DivPlatformPSX::poke(std::vector<DivRegWrite>& wlist) {
  for (DivRegWrite& i: wlist) rWrite(i.addr&0x3fe,i.val);
}

unsigned char* DivPlatformPSX::getRegisterPool() {
  return (unsigned char*)regPool;
}

int DivPlatformPSX::getRegisterPoolSize() {
  return 0x200;
}

int DivPlatformPSX::getRegisterPoolDepth() {
  return 16;
}

const void* DivPlatformPSX::getSampleMem(int index) {
  return index==0?sampleMem:NULL;
}

size_t DivPlatformPSX::getSampleMemCapacity(int index) {
  return index==0?PSX_RAM:0;
}

size_t DivPlatformPSX::getSampleMemUsage(int index) {
  return index==0?sampleMemLen:0;
}

bool DivPlatformPSX::isSampleLoaded(int index, int sample) {
  if (index!=0) return false;
  if (sample<0 || sample>=32768) return false;
  return sampleLoaded[sample];
}

const DivMemoryComposition* DivPlatformPSX::getMemCompo(int index) {
  if (index!=0) return NULL;
  return &memCompo;
}

// encodes 28 samples into one SPU ADPCM block, trying every filter and shift
static void psxEncodeBlock(const short* in, unsigned char* out, int& s1, int& s2, unsigned char flags) {
  long long bestErr=-1;
  int bestF=0, bestS=0;
  for (int f=0; f<5; f++) {
    for (int sh=0; sh<=12; sh++) {
      int t1=s1, t2=s2;
      long long err=0;
      for (int i=0; i<28; i++) {
        int pred=(t1*psxF0[f]+t2*psxF1[f]+32)>>6;
        int diff=in[i]-pred;
        int nib=(int)floor(((double)diff*(double)(1<<sh))/4096.0+0.5);
        if (nib>7) nib=7;
        if (nib<-8) nib=-8;
        int s=(((short)(nib<<12))>>sh)+pred;
        if (s>32767) s=32767;
        if (s<-32768) s=-32768;
        long long d=in[i]-s;
        err+=d*d;
        t2=t1;
        t1=s;
        if (bestErr>=0 && err>=bestErr) break;
      }
      if (bestErr<0 || err<bestErr) {
        bestErr=err;
        bestF=f;
        bestS=sh;
      }
    }
  }
  memset(out,0,16);
  out[0]=(bestS&15)|(bestF<<4);
  out[1]=flags;
  for (int i=0; i<28; i++) {
    int pred=(s1*psxF0[bestF]+s2*psxF1[bestF]+32)>>6;
    int diff=in[i]-pred;
    int nib=(int)floor(((double)diff*(double)(1<<bestS))/4096.0+0.5);
    if (nib>7) nib=7;
    if (nib<-8) nib=-8;
    int s=(((short)(nib<<12))>>bestS)+pred;
    if (s>32767) s=32767;
    if (s<-32768) s=-32768;
    s2=s1;
    s1=s;
    out[2+(i>>1)]|=(nib&15)<<((i&1)<<2);
  }
}

static int psxGcd(int a, int b) {
  while (b) {
    int t=a%b;
    a=b;
    b=t;
  }
  return a;
}

void DivPlatformPSX::renderSamples(int sysID) {
  memset(sampleMem,0,PSX_RAM);
  memset(sampleOff,0,32768*sizeof(unsigned int));
  memset(sampleLoaded,0,32768*sizeof(bool));

  memCompo=DivMemoryComposition();
  memCompo.name="SPU RAM";
  memCompo.entries.push_back(DivMemoryEntry(DIV_MEMORY_RESERVED,"Capture buffers",-1,0,PSX_SILENCE));
  memCompo.entries.push_back(DivMemoryEntry(DIV_MEMORY_RESERVED,"Silence",-1,PSX_SILENCE,PSX_SAMPLES));
  // silent block that loops on itself (idle voices point here)
  sampleMem[PSX_SILENCE+1]=7;

  size_t memPos=PSX_SAMPLES;
  for (int i=0; i<parent->song.sampleLen; i++) {
    DivSample* s=parent->song.sample[i];
    if (!s->renderOn[0][sysID]) continue;
    if (s->data16==NULL || s->samples<1) continue;

    // build the data with the loop on a 28-sample boundary
    std::vector<short> d;
    int loopIdx=-1;
    bool loop=s->isLoopable();
    if (loop) {
      int ls=s->loopStart, le=s->loopEnd;
      if (le>(int)s->samples) le=s->samples;
      int ll=le-ls;
      if (ll<1) {
        loop=false;
      } else {
        int pre=(28-(ls%28))%28;
        int reps=28/psxGcd(ll,28);
        if ((long long)reps*ll>(1<<20)) reps=1;
        d.assign(pre,0);
        d.insert(d.end(),s->data16,s->data16+ls);
        loopIdx=(int)d.size();
        for (int r=0; r<reps; r++) d.insert(d.end(),s->data16+ls,s->data16+le);
        while (d.size()%28) d.push_back(s->data16[ls]);
      }
    }
    if (!loop) {
      d.assign(s->data16,s->data16+s->samples);
      while (d.size()%28) d.push_back(0);
    }
    size_t blocks=d.size()/28;
    if (memPos+blocks*16>PSX_RAM) {
      logW("out of PlayStation SPU memory for sample %d!",i);
      break;
    }
    int s1=0, s2=0;
    for (size_t b=0; b<blocks; b++) {
      unsigned char flags=0;
      if (loop && (int)(b*28)==loopIdx) flags|=4;
      if (b==blocks-1) flags|=loop?3:1;
      psxEncodeBlock(&d[b*28],&sampleMem[memPos+b*16],s1,s2,flags);
    }
    sampleOff[i]=memPos;
    sampleLoaded[i]=true;
    memCompo.entries.push_back(DivMemoryEntry(DIV_MEMORY_SAMPLE,"Sample",i,memPos,memPos+blocks*16));
    memPos+=blocks*16;
  }
  sampleMemLen=memPos;
  memCompo.capacity=PSX_RAM;
  memCompo.used=sampleMemLen;
}

void DivPlatformPSX::setFlags(const DivConfig& flags) {
  chipClock=44100*32;
  CHECK_CUSTOM_CLOCK;
  rate=44100;
  for (int i=0; i<24; i++) oscBuf[i]->setRate(rate);
  memCompo.capacity=PSX_RAM;
  notifyPitchTable();
}

int DivPlatformPSX::init(DivEngine* p, int channels, int sugRate, const DivConfig& flags) {
  parent=p;
  samplePitchTable.init(parent);
  dumpWrites=false;
  skipRegisterWrites=false;
  for (int i=0; i<24; i++) {
    isMuted[i]=false;
    oscBuf[i]=new DivDispatchOscBuffer;
  }
  sampleMem=new unsigned char[PSX_RAM];
  memset(sampleMem,0,PSX_RAM);
  sampleMem[PSX_SILENCE+1]=7;
  sampleMemLen=PSX_SAMPLES;
  spu.ram=sampleMem;
  setFlags(flags);
  reset();
  return 24;
}

void DivPlatformPSX::quit() {
  delete[] sampleMem;
  for (int i=0; i<24; i++) delete oscBuf[i];
}

DivPlatformPSX::DivPlatformPSX():
  DivDispatch() {
  sampleOff=new unsigned int[32768];
  sampleLoaded=new bool[32768];
}

DivPlatformPSX::~DivPlatformPSX() {
  delete[] sampleOff;
  delete[] sampleLoaded;
  samplePitchTable.destroy<Channel>(chan,24);
}
