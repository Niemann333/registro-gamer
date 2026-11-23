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

// Registro Gamer: KSS export (MSX: PSG, SCC, FM-PAC/OPLL and MSX-AUDIO/Y8950).
// the player (kssdrv.asm, Z80) is loaded at $4000; the register log fills 8KB banks from bank $40,
// read through $A000-$BFFF. the KSS player calls PLAY at 60Hz (50Hz in PAL mode); a 32-bit accumulator
// splits each call into timed steps, so any tick rate works (to about 1/16 of a frame).
// the log format is described in kssdrv.asm.

#include "kss.h"
#include "ayconv.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>
#include <math.h>

#include "kssdrv.inc"

typedef std::vector<unsigned char> Tok;

// the frame is split in STEPS equal parts (DLY turns of a 26-cycle wait loop each, about 80% of the frame in all);
// each step adds RATE to a 24-bit accumulator and plays a tick when it passes 2^24
static void rgZ80Steps(double tickRate, double frameHz, double cpuHz, int& steps, unsigned int& rate, int& dly, unsigned int& acc0) {
  steps=(int)ceil(tickRate/frameHz)+1;
  if (steps<16) steps=16;
  if (steps>250) steps=250;
  double r=tickRate/(frameHz*steps)*16777216.0;
  if (r>16777215.0) r=16777215.0;
  rate=(unsigned int)(r+0.5);
  double stepT=cpuHz/frameHz*0.8/steps-110.0;
  dly=(int)(stepT/26.0);
  if (dly<1) dly=1;
  acc0=(16777216-rate)&0xffffff;
}

#define KSS_BANK 0x2000
#define KSS_FIRSTBANK 0x40
#define MSX_AY_CLOCK 1789772.5

static void putW(std::vector<Tok>& out, int frames) {
  while (frames>0) {
    int k=frames-1;
    if (k>255) k=255;
    Tok t;
    if (k<=13) {
      t.push_back(0xf0+k);
    } else {
      t.push_back(0xfe);
      t.push_back(k);
    }
    out.push_back(t);
    frames-=k+1;
  }
}

// effective tone clock of a Furnace AY (the YM2149 "half clock" and the Sunsoft 5B divide by 16)
double rgAYClock(DivEngine* e, DivDispatch* d, int sys) {
  int chipType=e->song.systemFlags[sys].getInt("chipType",0);
  bool half=(chipType==1 && e->song.systemFlags[sys].getBool("halfClock",false)) || chipType==2;
  return (double)d->chipClock/(half?2.0:1.0);
}

void DivExportKSS::run() {
  int sysAY=-1, sysSCC=-1, sysFM=-1, sysAudio=-1;
  bool sccPlus=false;
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    if (s==DIV_SYSTEM_AY8910 && sysAY<0 && e->song.systemFlags[i].getInt("chipType",0)!=3) {
      sysAY=i;
    } else if ((s==DIV_SYSTEM_SCC || s==DIV_SYSTEM_SCC_PLUS) && sysSCC<0) {
      sysSCC=i;
      sccPlus=(s==DIV_SYSTEM_SCC_PLUS);
    } else if ((s==DIV_SYSTEM_OPLL || s==DIV_SYSTEM_OPLL_DRUMS) && sysFM<0) {
      sysFM=i;
    } else if ((s==DIV_SYSTEM_Y8950 || s==DIV_SYSTEM_Y8950_DRUMS) && sysAudio<0) {
      sysAudio=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the MSX sound (PSG, SCC, FM-PAC, MSX-AUDIO); ignored",i,e->getSystemName(s));
    }
  }
  if (sysAY<0 && sysSCC<0 && sysFM<0 && sysAudio<0) {
    fail(_("no MSX chip (AY-3-8910, SCC, OPLL or Y8950) in this song"));
    return;
  }
  std::vector<int> sys;
  if (sysAY>=0) sys.push_back(sysAY);
  if (sysSCC>=0) sys.push_back(sysSCC);
  if (sysFM>=0) sys.push_back(sysFM);
  if (sysAudio>=0) sys.push_back(sysAudio);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;
  logAppend("packing the register log...");

  RGAYConv ay(1.0);
  if (sysAY>=0) {
    double clk=rgAYClock(e,dispatchOf(sysAY),sysAY);
    ay.f=MSX_AY_CLOCK/clk;
    if (!ay.exact()) logAppendf("PSG clock %.0fHz -> MSX %.0fHz: periods rescaled",clk,MSX_AY_CLOCK);
  }
  if (sccPlus) logAppend("WARNING: SCC+ played as SCC: channels 4 and 5 share one wave");

  std::vector<Tok> tok;
  int loopTok=-1, pending=0;
  std::map<unsigned int,unsigned int> lastSCC, lastFM, lastAudio;
  // MSX-AUDIO: the ADPCM samples go to its memory first (memory write mode, from address 0)
  if (sysAudio>=0) {
    DivDispatch* d=dispatchOf(sysAudio);
    const unsigned char* mem=(const unsigned char*)d->getSampleMem(0);
    size_t len=d->getSampleMemUsage(0);
    if (mem!=NULL && len>0) {
      static const int setup[][2]={{0x07,0x01},{0x08,0x00},{0x09,0x00},{0x0a,0x00},{0x0b,0xff},{0x0c,0xff},{0x07,0x60}};
      for (auto& r: setup) {
        Tok c;
        c.push_back(0x41);
        c.push_back(r[0]);
        c.push_back(r[1]);
        tok.push_back(c);
      }
      for (size_t i=0; i<len; i+=255) {
        size_t n=MIN((size_t)255,len-i);
        Tok c;
        c.push_back(0x42);
        c.push_back(n);
        c.insert(c.end(),mem+i,mem+i+n);
        tok.push_back(c);
      }
      Tok c;
      c.push_back(0x41);
      c.push_back(0x07);
      c.push_back(0x01);
      tok.push_back(c);
      logAppendf("MSX-AUDIO ADPCM samples: %d bytes",(int)len);
    }
  }
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putW(tok,pending);
      pending=0;
      loopTok=tok.size();
      ay.forget();
      lastSCC.clear();
      lastFM.clear();
      lastAudio.clear();
    }
    std::vector<Tok> f;
    for (RGWrite& w: ticks[t]) {
      int v=w.val&0xff;
      if (w.sys==sysAY) {
        std::vector<std::pair<int,int>> o;
        ay.write(w.addr,v,o);
        for (auto& p: o) {
          Tok c;
          c.push_back(p.first);
          c.push_back(p.second);
          f.push_back(c);
        }
      } else if (w.sys==sysSCC) {
        int a=w.addr;
        if (sccPlus) {
          if (a<0x80) {
          } else if (a<0xa0) {
            continue; // the 5th wave does not exist on the SCC
          } else if (a<0xb0) {
            a-=0x20;
          } else {
            continue;
          }
        }
        if (a>=0x90) continue;
        std::map<unsigned int,unsigned int>::iterator it=lastSCC.find(a);
        if (it!=lastSCC.end() && it->second==(unsigned int)v) continue;
        lastSCC[a]=v;
        Tok c;
        c.push_back(0x80);
        c.push_back(a);
        c.push_back(v);
        f.push_back(c);
      } else if (w.sys==sysAudio) {
        if (w.addr>0xff) continue;
        bool always=(w.addr==0x07 || w.addr==0x0f);
        std::map<unsigned int,unsigned int>::iterator it=lastAudio.find(w.addr);
        if (!always && it!=lastAudio.end() && it->second==(unsigned int)v) continue;
        lastAudio[w.addr]=v;
        Tok c;
        c.push_back(0x41);
        c.push_back(w.addr);
        c.push_back(v);
        f.push_back(c);
      } else if (w.sys==sysFM) {
        if (w.addr>0x3f) continue;
        std::map<unsigned int,unsigned int>::iterator it=lastFM.find(w.addr);
        if (it!=lastFM.end() && it->second==(unsigned int)v) continue;
        lastFM[w.addr]=v;
        Tok c;
        c.push_back(0x40);
        c.push_back(w.addr);
        c.push_back(v);
        f.push_back(c);
      }
    }
    if (!f.empty()) {
      putW(tok,pending);
      pending=0;
      tok.insert(tok.end(),f.begin(),f.end());
    }
    pending++;
  }
  putW(tok,pending);
  tok.push_back(Tok(1,0xff));
  if (ay.clamped) logAppend("WARNING: some PSG periods are out of range at the MSX clock");

  int loopOut=-1;
  std::vector<unsigned char> s=pack(tok,loopTok,0,8,loopOut,3);
  int banks=(s.size()+KSS_BANK-1)/KSS_BANK;
  if (banks>127) {
    fail(fmt::sprintf(_("the song is too big for a KSS (%d KB of the 1016 KB limit)"),banks*8));
    return;
  }
  logAppendf("log: %d bytes (%d banks of 8KB)",(int)s.size(),banks);
  s.resize(banks*KSS_BANK,0);

  // the KSS player calls PLAY at 60Hz, or 50Hz in PAL mode (used when the song is near 50Hz)
  bool pal=(fabs(tickRate-50.0)<fabs(tickRate-60.0)) && fabs(tickRate-50.0)<1.0;
  double playHz=pal?50.0:60.0;
  int steps=16, dly=1;
  unsigned int rate=0, acc0=0;
  rgZ80Steps(tickRate,playHz,3579545.0,steps,rate,dly,acc0);

  std::vector<unsigned char> drv(kssDriver,kssDriver+sizeof(kssDriver));
  auto at=[&](int addr) -> unsigned char& { return drv[addr-KSSDRIVER_INIT]; };
  at(KSSDRIVER_FIRSTB)=KSS_FIRSTBANK;
  for (int i=0; i<3; i++) at(KSSDRIVER_RATE+i)=(rate>>(8*i))&0xff;
  for (int i=0; i<3; i++) at(KSSDRIVER_ACCI+i)=(acc0>>(8*i))&0xff;
  at(KSSDRIVER_STEPS)=steps;
  at(KSSDRIVER_DLY)=dly&0xff;
  at(KSSDRIVER_DLY+1)=dly>>8;
  if (loopOut>=0 && loopTick>=0) {
    at(KSSDRIVER_LOOPB)=KSS_FIRSTBANK+loopOut/KSS_BANK;
    at(KSSDRIVER_LOOPP)=(0xa000+(loopOut%KSS_BANK))&0xff;
    at(KSSDRIVER_LOOPP+1)=(0xa000+(loopOut%KSS_BANK))>>8;
  }
  at(KSSDRIVER_USESCC)=(sysSCC>=0)?1:0;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("KSCC",4);
  w->writeS(KSSDRIVER_INIT); // load address
  w->writeS(drv.size());
  w->writeS(KSSDRIVER_INIT);
  w->writeS(KSSDRIVER_PLAY);
  w->writeC(KSS_FIRSTBANK);
  w->writeC(0x80|banks); // 8KB banks
  w->writeC(0);
  w->writeC((sysFM>=0?0x01:0)|(sysAudio>=0?0x08:0)|(pal?0x40:0));
  w->write(drv.data(),drv.size());
  w->write(s.data(),s.size());

  output.push_back(DivROMExportOutput("export.kss",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
