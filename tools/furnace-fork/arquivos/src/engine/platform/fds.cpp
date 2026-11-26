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

#include "../../../extern/dnft-apu/rgdn.h"
#include "fds.h"
#include "sound/nes/cpu_inline.h"
#include "../engine.h"
#include "sound/nes_nsfplay/nes_fds.h"
#include <math.h>

#define CHIP_FREQBASE 262144

#define rWrite(a,v) if (!skipRegisterWrites) {doWrite(a,v); regPool[(a)&0x7f]=v; if (dumpWrites) {addWrite(a,v);} if (rgDn) rgDn->write(rgDnChip,(a),(v)); }

const char* regCheatSheetFDS[]={
  "IOCtrl", "4023",
  "Wave", "4040",
  "Volume", "4080",
  "FreqL", "4082",
  "FreqH", "4083",
  "ModCtrl", "4084",
  "ModCount", "4085",
  "ModFreqL", "4086",
  "ModFreqH", "4087",
  "ModWrite", "4088",
  "WaveCtrl", "4089",
  "EnvSpeed", "408A",
  "ReadVol", "4090",
  "ReadPos", "4091",
  "ReadModV", "4092",
  "ReadModP", "4093",
  "ReadModCG", "4094",
  "ReadModInc", "4095",
  "ReadWave", "4096",
  "ReadModCount", "4097",
  NULL
};

const char** DivPlatformFDS::getRegisterSheet() {
  return regCheatSheetFDS;
}

void DivPlatformFDS::acquire_puNES(short* buf, size_t len) {
  oscBuf->begin(len);
  for (size_t i=0; i<len; i++) {
    extcl_apu_tick_FDS(fds);
    int sample=isMuted[0]?0:fds->snd.main.output;
    if (sample>32767) sample=32767;
    if (sample<-32768) sample=-32768;
    buf[i]=sample;
    if (++writeOscBuf>=32) {
      writeOscBuf=0;
      oscBuf->putSample(i,sample*3);
    }
  }
  oscBuf->end(len);
}

// RG: filtro do modo FamiTracker (um polo real + um par de polos com Q=1 = Butterworth de 3ª ordem)
int DivPlatformFDS::rgLowPass(int s) {
  double x=s;
  rgLPz=rgLPp*x+rgLPq*rgLPz;
  double y=rgLPb0*rgLPz+rgLPb1*rgLPx1+rgLPb2*rgLPx2-rgLPa1*rgLPy1-rgLPa2*rgLPy2;
  rgLPx2=rgLPx1; rgLPx1=rgLPz;
  rgLPy2=rgLPy1; rgLPy1=y;
  return (int)y;
}

void DivPlatformFDS::acquire_NSFPlay(short* buf, size_t len) {
  int out[2];
  oscBuf->begin(len);
  for (size_t i=0; i<len; i++) {
    fds_NP->Tick(16);
    fds_NP->Render(out);
    int sample=isMuted[0]?0:(out[0]<<1);
    if (rgLPOn) sample=rgLowPass(sample);
    if (sample>32767) sample=32767;
    if (sample<-32768) sample=-32768;
    buf[i]=sample;
    oscBuf->putSample(i,sample*3);
  }
  oscBuf->end(len);
}

void DivPlatformFDS::doWrite(unsigned short addr, unsigned char data) {
  if (useNP) {
    fds_NP->Write(addr,data);
  } else {
    fds_wr_mem(fds,addr,data);
  }
}

void DivPlatformFDS::acquire(short** buf, size_t len) {
  if (useNP) {
    acquire_NSFPlay(buf[0],len);
  } else {
    acquire_puNES(buf[0],len);
  }
}

void DivPlatformFDS::updateWave() {
  // TODO: master volume
  rWrite(0x4089,0x80);
  for (int i=0; i<64; i++) {
    rWrite(0x4040+i,ws.output[i]);
  }
  rWrite(0x4089,0);
}

// RG: registrador 4084 (profundidade da modulação): o 0CC sempre desliga o envelope de modulação (bit 7) e usa a profundidade direta
unsigned char DivPlatformFDS::rgMod4084(int i) {
  if (parent->song.compatFlags.rgFamiTracker) return 0x80|chan[i].modDepth;
  return (chan[i].modOn<<7)|0x40|chan[i].modDepth;
}

// RG: volume do FDS no 0CC: ((instrumento+1)*(canal+1)-1)/16, até 32, nunca 0 se os dois forem > 0
int DivPlatformFDS::rgOutVol(int i) {
  int v=((chan[i].rg.macVol+1)*((chan[i].vol&15)+1)-1)/16;
  if (v<0) v=0;
  if (v>32) v=32;
  if (v==0 && chan[i].rg.macVol>0 && ((chan[i].vol&15)>0 || chan[i].rg.volNZ)) v=1;
  return v;
}

void DivPlatformFDS::tick(bool sysTick) {
  for (int i=0; i<1; i++) {
    chan[i].std.next();
    if (chan[i].std.vol.had) {
      // ok, why are the volumes like that?
      chan[i].outVol=VOL_SCALE_LINEAR_BROKEN(chan[i].vol,chan[i].std.vol.val,32);
      if (chan[i].outVol<0) chan[i].outVol=0;
      if (parent->song.compatFlags.rgFamiTracker) {
        chan[i].rg.macVol=CLAMP(chan[i].std.vol.val,0,32);
        chan[i].outVol=rgOutVol(i);
      }
      rWrite(0x4080,0x80|chan[i].outVol);
    }
    if (NEW_ARP_STRAT) {
      chan[i].handleArp();
    } else if (chan[i].std.arp.had && !chan[i].rawFreq) {
      // RG: no FamiTracker cada passo da sequência de arpejo redefine a frequência, mesmo durante portamento
      if (!chan[i].inPorta || parent->song.compatFlags.rgFamiTracker) {
        chan[i].baseFreq=chan[i].calcBaseFreq(parent->calcArp(chan[i].note,chan[i].std.arp.val));
      }
      chan[i].freqChanged=true;
    }
    /*
    if (chan[i].std.duty.had) {
      chan[i].duty=chan[i].std.duty.val;
      if (i==3) {
        if (parent->song.compatFlags.properNoiseLayout) {
          chan[i].duty&=1;
        } else if (chan[i].duty>1) {
          chan[i].duty=1;
        }
      }
      if (i!=2) {
        rWrite(0x4000+i*4,0x30|chan[i].outVol|((chan[i].duty&3)<<6));
      }
      if (i==3) { // noise
        chan[i].freqChanged=true;
      }
    }*/
    if (chan[i].std.wave.had) {
      if (chan[i].wave!=chan[i].std.wave.val || ws.activeChanged()) {
        chan[i].wave=chan[i].std.wave.val;
        ws.changeWave1(chan[i].wave);
        //if (!chan[i].keyOff) chan[i].keyOn=true;
      }
    }
    if (chan[i].std.pitch.had) {
      if (rgFTPitchMacro(parent->song.compatFlags.rgFamiTracker,chan[i],0xfff)) {
        // RG: pitch relativo na própria frequência
      } else if (chan[i].std.pitch.mode) {
        chan[i].pitch2+=chan[i].std.pitch.val;
        CLAMP_VAR(chan[i].pitch2,-32768,32767);
      } else {
        chan[i].pitch2=chan[i].std.pitch.val;
      }
      chan[i].freqChanged=true;
    }
    if (chan[i].active) {
      if (ws.tick()) {
        updateWave();
        if (!chan[i].keyOff) chan[i].keyOn=true;
      }
    }
    if (chan[i].std.ex1.had) { // mod depth
      chan[i].modOn=chan[i].std.ex1.val;
      chan[i].modDepth=chan[i].std.ex1.val;
      rWrite(0x4084,rgMod4084(i));
    }
    if (chan[i].std.ex2.had) { // mod speed
      chan[i].modFreq=chan[i].std.ex2.val;
      rWrite(0x4086,chan[i].modFreq&0xff);
      rWrite(0x4087,chan[i].modFreq>>8);
    }
    if (chan[i].std.ex3.had) { // mod position
      chan[i].modPos=chan[i].std.ex3.val;
      rWrite(0x4087,0x80|chan[i].modFreq>>8);
      rWrite(0x4085,chan[i].modPos);
      rWrite(0x4087,chan[i].modFreq>>8);
    }
    if (chan[i].sweepChanged) {
      chan[i].sweepChanged=false;
      if (i==0) {
        //rWrite(16+i*5,chan[i].sweep);
      }
    }
    if (chan[i].freqChanged || chan[i].keyOn || chan[i].keyOff) {
      chan[i].freq=chan[i].calcFreq();
      if (!chan[i].rawFreq) {
        if (chan[i].freq>4095) chan[i].freq=4095;
        if (chan[i].freq<0) chan[i].freq=0;
      }
      if (chan[i].keyOn) {
        // ???
      }
      if (chan[i].keyOff) {
        rWrite(0x4080,0x80);
      }
      rWrite(0x4082,chan[i].freq&0xff);
      rWrite(0x4083,(chan[i].freq>>8)&15);

      if (chan[i].autoModNum>0 && chan[i].autoModDen>0) {
        chan[i].modFreq=(chan[i].freq*chan[i].autoModNum)/chan[i].autoModDen;
        if (chan[i].modFreq>4095) chan[i].modFreq=4095;
        if (chan[i].modFreq<0) chan[i].modFreq=0;
        rWrite(0x4086,chan[i].modFreq&0xff);
        rWrite(0x4087,chan[i].modFreq>>8);
      }

      if (chan[i].keyOn) chan[i].keyOn=false;
      if (chan[i].keyOff) chan[i].keyOff=false;
      chan[i].freqChanged=false;
    }
  }
  // RG: as marcas de Hxx/Ixx/Jxx valem só para a linha deste quadro
  chan[0].rgFxDepth=false;
  chan[0].rgFxSpeed=false;
}

int DivPlatformFDS::dispatch(DivCommand c) {
  switch (c.cmd) {
    case DIV_CMD_NOTE_ON: {
      DivInstrument* ins=parent->getIns(chan[c.chan].ins,DIV_INS_FDS);
      if (c.value!=DIV_NOTE_NULL) {
        chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(c.value);
        chan[c.chan].freqChanged=true;
        chan[c.chan].note=c.value;
      }
      if (chan[c.chan].insChanged) {
        if (ins->fds.initModTableWithFirstWave) { // compatible
          if (chan[c.chan].wave==-1) {
            DivWavetable* wt=parent->getWave(0);
            for (int i=0; i<32; i++) {
              if (wt->max<1 || wt->len<1) {
                chan[c.chan].modTable[i]=0;
              } else {
                int data=wt->data[i*MIN(32,wt->len)/32]*7/wt->max;
                if (data<0) data=0;
                if (data>7) data=7;
                chan[c.chan].modTable[i]=data;
              }
            }
            rWrite(0x4087,0x80|chan[c.chan].modFreq>>8);
            for (int i=0; i<32; i++) {
              rWrite(0x4088,chan[c.chan].modTable[i]);
            }
            rWrite(0x4087,chan[c.chan].modFreq>>8);
          }
        } else { // The Familiar Way
          chan[c.chan].modDepth=ins->fds.modDepth;
          chan[c.chan].modOn=ins->fds.modDepth;
          chan[c.chan].modFreq=ins->fds.modSpeed;
          rWrite(0x4084,rgMod4084(c.chan));
          rWrite(0x4086,chan[c.chan].modFreq&0xff);

          rWrite(0x4087,0x80|chan[c.chan].modFreq>>8);
          for (int i=0; i<32; i++) {
            chan[c.chan].modTable[i]=ins->fds.modTable[i]&7;
            rWrite(0x4088,chan[c.chan].modTable[i]);
          }
          rWrite(0x4087,chan[c.chan].modFreq>>8);
        }
      }
      chan[c.chan].active=true;
      chan[c.chan].keyOn=true;
      chan[c.chan].macroInit(ins);
      if (!parent->song.compatFlags.brokenOutVol && !chan[c.chan].std.vol.will) {
        chan[c.chan].outVol=chan[c.chan].vol;
      }
      if (chan[c.chan].wave<0) {
        chan[c.chan].wave=0;
        ws.changeWave1(chan[c.chan].wave);
      }
      ws.init(ins,64,63,chan[c.chan].insChanged);
      if (parent->song.compatFlags.rgFamiTracker) {
        // RG: no 0CC cada nota volta a modulação (velocidade e profundidade) à do instrumento, menos o que a linha mudou
        if (c.value!=DIV_NOTE_NULL && ins->type==DIV_INS_FDS && !ins->fds.initModTableWithFirstWave) {
          if (!chan[c.chan].rgFxDepth) chan[c.chan].modDepth=ins->fds.modDepth;
          if (!chan[c.chan].rgFxSpeed) chan[c.chan].modFreq=ins->fds.modSpeed;
          rWrite(0x4084,rgMod4084(c.chan));
          if (!(chan[c.chan].autoModNum>0 && chan[c.chan].autoModDen>0)) {
            rWrite(0x4086,chan[c.chan].modFreq&0xff);
            rWrite(0x4087,(chan[c.chan].modFreq>>8)&15);
          }
        }
        // RG: nota nova: volume do instrumento do começo (31 sem sequência)
        chan[c.chan].rg.macVol=31;
        chan[c.chan].outVol=rgOutVol(c.chan);
        rWrite(0x4080,0x80|chan[c.chan].outVol);
        chan[c.chan].insChanged=false;
        break;
      }
      rWrite(0x4080,0x80|chan[c.chan].vol);
      chan[c.chan].insChanged=false;
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
        chan[c.chan].insChanged=true;
      }
      break;
    case DIV_CMD_VOLUME:
      if (parent->song.compatFlags.rgFamiTracker) {
        // RG: recalcula a saída com a macro (o FamiTracker refaz isso todo quadro)
        chan[c.chan].vol=c.value;
        chan[c.chan].rg.volNZ=(c.value2!=0);
        chan[c.chan].outVol=rgOutVol(c.chan);
        if (chan[c.chan].active) rWrite(0x4080,0x80|chan[c.chan].outVol);
        break;
      }
      if (chan[c.chan].vol!=c.value) {
        chan[c.chan].vol=c.value;
        if (!chan[c.chan].std.vol.has) {
          chan[c.chan].outVol=c.value;
        }
        rWrite(0x4080,0x80|chan[c.chan].vol);
      }
      break;
    case DIV_CMD_GET_VOLUME:
      return chan[c.chan].vol;
      break;
    case DIV_CMD_PITCH:
      chan[c.chan].pitch=c.value;
      chan[c.chan].freqChanged=true;
      break;
    case DIV_CMD_WAVE:
      if (chan[c.chan].wave!=c.value) {
        chan[c.chan].wave=c.value;
        ws.changeWave1(chan[c.chan].wave);
      }
      break;
    case DIV_CMD_FDS_MOD_DEPTH:
      if (parent->song.compatFlags.rgFamiTracker) {
        // RG: Hxx do 0CC: 00-3F profundidade; 80-FF com a modulação automática é o numerador
        if (c.value<0x40) {
          chan[c.chan].modDepth=c.value;
          chan[c.chan].rgFxDepth=true;
          rWrite(0x4084,rgMod4084(c.chan));
        } else if (c.value>=0x80 && chan[c.chan].autoModNum>0 && chan[c.chan].autoModDen>0) {
          chan[c.chan].autoModNum=c.value-0x80;
          chan[c.chan].freqChanged=true;
        }
        break;
      }
      chan[c.chan].modDepth=c.value;
      rWrite(0x4084,rgMod4084(c.chan));
      break;
    case DIV_CMD_FDS_MOD_HIGH:
      if (parent->song.compatFlags.rgFamiTracker) {
        // RG: Jxy do 0CC: >= 10 é a modulação automática (frequência x / (y+1)); senão o byte alto da velocidade
        chan[c.chan].rgFxSpeed=true;
        if (c.value>=0x10) {
          chan[c.chan].autoModNum=c.value>>4;
          chan[c.chan].autoModDen=(c.value&15)+1;
          chan[c.chan].freqChanged=true;
        } else {
          bool wasAuto=(chan[c.chan].autoModNum>0 && chan[c.chan].autoModDen>0);
          chan[c.chan].modFreq=((c.value&15)<<8)|(wasAuto?0:(chan[c.chan].modFreq&0xff));
          chan[c.chan].autoModNum=0;
          chan[c.chan].autoModDen=0;
          rWrite(0x4086,chan[c.chan].modFreq&0xff);
          rWrite(0x4087,chan[c.chan].modFreq>>8);
        }
        break;
      }
      chan[c.chan].modOn=c.value>>4;
      chan[c.chan].modFreq=((c.value&15)<<8)|(chan[c.chan].modFreq&0xff);
      rWrite(0x4084,rgMod4084(c.chan));
      rWrite(0x4087,chan[c.chan].modFreq>>8);
      break;
    case DIV_CMD_FDS_MOD_LOW:
      if (parent->song.compatFlags.rgFamiTracker) {
        // RG: Ixx do 0CC: byte baixo da velocidade e desliga a modulação automática
        chan[c.chan].rgFxSpeed=true;
        {
          bool wasAuto=(chan[c.chan].autoModNum>0 && chan[c.chan].autoModDen>0);
          chan[c.chan].modFreq=(wasAuto?0:(chan[c.chan].modFreq&0xf00))|c.value;
        }
        chan[c.chan].autoModNum=0;
        chan[c.chan].autoModDen=0;
        rWrite(0x4086,chan[c.chan].modFreq&0xff);
        rWrite(0x4087,chan[c.chan].modFreq>>8);
        break;
      }
      chan[c.chan].modFreq=(chan[c.chan].modFreq&0xf00)|c.value;
      rWrite(0x4086,chan[c.chan].modFreq&0xff);
      break;
    case DIV_CMD_FDS_MOD_POS:
      chan[c.chan].modPos=c.value&0x7f;
      rWrite(0x4087,0x80|chan[c.chan].modFreq>>8);
      rWrite(0x4085,chan[c.chan].modPos);
      rWrite(0x4087,chan[c.chan].modFreq>>8);
      break;
    case DIV_CMD_FDS_MOD_WAVE: {
      DivWavetable* wt=parent->getWave(c.value);
      for (int i=0; i<32; i++) {
        if (wt->max<1 || wt->len<1) {
          rWrite(0x4040+i,0);
        } else {
          int data=wt->data[i*MIN(32,wt->len)/32]*7/wt->max;
          if (data<0) data=0;
          if (data>7) data=7;
          chan[c.chan].modTable[i]=data;
        }
      }
      rWrite(0x4087,0x80|chan[c.chan].modFreq>>8);
      for (int i=0; i<32; i++) {
        rWrite(0x4088,chan[c.chan].modTable[i]);
      }
      rWrite(0x4087,chan[c.chan].modFreq>>8);
      break;
    }
    case DIV_CMD_FDS_MOD_AUTO:
      chan[c.chan].autoModNum=c.value>>4;
      chan[c.chan].autoModDen=c.value&15;
      chan[c.chan].freqChanged=true;
      chan[c.chan].modOn=(chan[c.chan].autoModNum && chan[c.chan].autoModDen);
      rWrite(0x4084,rgMod4084(c.chan));
      break;
    case DIV_CMD_NOTE_PORTA: {
      int destFreq=chan[c.chan].calcBaseFreq(c.value2);
      bool return2=false;
      // RG: no FamiTracker os slides 1xx/2xx só param no limite do registrador
      if (parent->song.compatFlags.rgFamiTracker) {
        if (c.value2>155) destFreq=0xfff;
        else if (c.value2<60) destFreq=0;
      }
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
    case DIV_CMD_LEGATO:
      if (c.chan==3) break;
      if (rgFTLegato(parent->song.compatFlags.rgFamiTracker,chan[c.chan],c)) break;
      chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(c.value+((HACKY_LEGATO_MESS)?(chan[c.chan].std.arp.val):(0)));
      chan[c.chan].freqChanged=true;
      chan[c.chan].note=c.value;
      break;
    case DIV_CMD_PRE_PORTA:
      if (chan[c.chan].active && c.value2) {
        if (parent->song.compatFlags.resetMacroOnPorta) chan[c.chan].macroInit(parent->getIns(chan[c.chan].ins,DIV_INS_FDS));
        // RG: no FamiTracker a nota com portamento também volta ao volume do instrumento
        if (parent->song.compatFlags.rgFamiTracker) {
          chan[c.chan].rg.macVol=31;
          chan[c.chan].outVol=rgOutVol(c.chan);
        }
      }
      // RG: no FamiTracker o slide parte da altura atual (inclusive a do arpejo)
      if (!chan[c.chan].inPorta && c.value && !parent->song.compatFlags.brokenPortaArp && chan[c.chan].std.arp.will && !NEW_ARP_STRAT && !parent->song.compatFlags.rgFamiTracker) chan[c.chan].baseFreq=chan[c.chan].calcBaseFreq(chan[c.chan].note);
      chan[c.chan].inPorta=c.value;
      break;
    case DIV_CMD_GET_VOLMAX:
      if (parent->song.compatFlags.rgFamiTracker) return 15; // RG: no FamiTracker o volume do canal é 0-15
      return 32;
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

void DivPlatformFDS::muteChannel(int ch, bool mute) {
  // RG: áudio do Dn-FamiTracker: silencia o canal no APU do Dn também
  if (rgDn) rgDn->setMute(rgDnChip,ch,mute);
  isMuted[ch]=mute;
}

void DivPlatformFDS::forceIns() {
  for (int i=0; i<1; i++) {
    chan[i].insChanged=true;
    chan[i].prevFreq=65535;
  }
  updateWave();
}

SharedChannel* DivPlatformFDS::getChanState(int ch) {
  return &chan[ch];
}

DivMacroInt* DivPlatformFDS::getChanMacroInt(int ch) {
  return &chan[ch].std;
}

DivDispatchOscBuffer* DivPlatformFDS::getOscBuffer(int ch) {
  return oscBuf;
}

unsigned char* DivPlatformFDS::getRegisterPool() {
  return regPool;
}

int DivPlatformFDS::getRegisterPoolSize() {
  return 128;
}

void DivPlatformFDS::reset() {
  for (int i=0; i<1; i++) {
    chan[i]=DivPlatformFDS::Channel(parent->song.compatFlags.linearPitch);
    chan[i].pitchTable=&pitchTable;
    chan[i].std.setEngine(parent);
  }
  ws.setEngine(parent);
  ws.init(NULL,64,63,false);
  if (dumpWrites) {
    softReset();
  }

  if (useNP) {
    fds_NP->Reset();
  } else {
    fds_reset(fds);
  }
  memset(regPool,0,128);

  rWrite(0x4023,0);
  rWrite(0x4023,0x83);
  rWrite(0x4089,0);
}

bool DivPlatformFDS::keyOffAffectsArp(int ch) {
  return true;
}

void DivPlatformFDS::setNSFPlay(bool use) {
  useNP=use;
}

void DivPlatformFDS::setFlags(const DivConfig& flags) {
  DivPitchTable::rgParseDetune(flags.getString("rgDetune",""),rgDetune);
  int clockSel=flags.getInt("clockSel",0);
  if (clockSel==2) { // Dendy
    chipClock=COLOR_PAL*2.0/5.0;
  } else if (clockSel==1) { // PAL
    chipClock=COLOR_PAL*3.0/8.0;
  } else { // NTSC
    chipClock=COLOR_NTSC/2.0;
  }
  CHECK_CUSTOM_CLOCK;
  if (useNP) {
    rate=chipClock/16;
    oscBuf->setRate(rate);
    fds_NP->SetClock(chipClock);
    fds_NP->SetRate(rate);
  } else {
    rate=chipClock;
    oscBuf->setRate(rate);
  }

  // RG: modo FamiTracker: passa-baixas de 6 kHz (medido contra o 0CC, que filtra o FDS com -48 dB a partir de 1 kHz no blip)
  rgLPOn=parent->song.compatFlags.rgFamiTracker && useNP;
  rgLPx1=rgLPx2=rgLPy1=rgLPy2=rgLPz=0;
  {
    double fc=6000.0;
    double k=tan(M_PI*fc/(double)rate);
    // um polo (z = p*x + q*z, ganho 1 em DC)
    rgLPq=(1.0-k)/(1.0+k);
    rgLPp=1.0-rgLPq;
    // par de polos, Q=1
    double Q=1.0;
    double n=1.0/(1.0+k/Q+k*k);
    rgLPb0=k*k*n;
    rgLPb1=2.0*rgLPb0;
    rgLPb2=rgLPb0;
    rgLPa1=2.0*(k*k-1.0)*n;
    rgLPa2=(1.0-k/Q+k*k)*n;
  }

  notifyPitchTable();
}

void DivPlatformFDS::notifyInsDeletion(void* ins) {
  for (int i=0; i<1; i++) {
    chan[i].std.notifyInsDeletion((DivInstrument*)ins);
  }
}

void DivPlatformFDS::notifyPitchTable(int sample) {
  pitchTable.init(parent->song.tuning,chipClock,CHIP_FREQBASE,0xffff,false,parent->song.compatFlags.linearPitch);
  // RG: modo FamiTracker: tabela do 0CC nota a nota: f*65536/(clock/16)+0.5+detune
  pitchTable.rgExact=false;
  if (parent->song.compatFlags.rgFamiTracker && !parent->song.compatFlags.linearPitch) {
    double clk=1789772.7272/16.0;
    for (int i=0; i<96; i++) {
      double f=parent->song.tuning*pow(2.0,(double)(i-45)/12.0);
      int v=(int)((f*65536.0)/clk+0.5+rgDetune[i]);
      if (v<0) v=0;
      pitchTable.rgExactTab[i+60]=v;
    }
    for (int i=0; i<60; i++) pitchTable.rgExactTab[i]=pitchTable.rgExactTab[60];
    for (int i=156; i<192; i++) pitchTable.rgExactTab[i]=pitchTable.rgExactTab[155];
    pitchTable.rgExact=true;
  }
}

unsigned int DivPlatformFDS::getMaxFreq(int ch) {
  return 0xffff;
}

float DivPlatformFDS::getPostAmp() {
  return useNP?2.0f:1.0f;
}

void DivPlatformFDS::poke(unsigned int addr, unsigned short val) {
  rWrite(addr,val);
}

void DivPlatformFDS::poke(std::vector<DivRegWrite>& wlist) {
  for (DivRegWrite& i: wlist) rWrite(i.addr,i.val);
}

int DivPlatformFDS::init(DivEngine* p, int channels, int sugRate, const DivConfig& flags) {
  parent=p;
  dumpWrites=false;
  skipRegisterWrites=false;
  writeOscBuf=0;
  // RG: modo FamiTracker: sempre o núcleo NSFPlay (o filtro do 0CC foi medido nele)
  if (parent->song.compatFlags.rgFamiTracker) useNP=true;
  if (useNP) {
    fds_NP=new xgm::NES_FDS;
  } else {
    fds=new struct _fds;
  }
  oscBuf=new DivDispatchOscBuffer;
  for (int i=0; i<1; i++) {
    isMuted[i]=false;
  }
  setFlags(flags);

  reset();
  return 1;
}

void DivPlatformFDS::quit() {
  delete oscBuf;
  if (useNP) {
    delete fds_NP;
  } else {
    delete fds;
  }
}

DivPlatformFDS::~DivPlatformFDS() {
}
