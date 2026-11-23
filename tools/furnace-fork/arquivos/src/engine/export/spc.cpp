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

// Registro Gamer: SPC export (SNES S-DSP).
// the SPC is a snapshot of the 64KB sound RAM: the player (spcdrv.asm) sits at $0200,
// Furnace's sample directory, wavetables and BRR samples start at $0400, and the
// register log fills the free RAM after the samples (up to the echo buffer).
// the log is compressed by pointing repeated parts back at earlier ones, so that a
// song that repeats its patterns fits in the little memory there is.
//
// log format:
// - $00-$7F vv: write vv to DSP register cmd
// - $82 lo hi nn data...: copy nn bytes to RAM at hi:lo (sample directory, wavetables)
// - $E0 lo hi nl nh: play nh:nl bytes of log found at hi:lo, then come back (nested up to 8 levels)
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "spc.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>

#include "spcdrv.inc"

#define SPC_DRV 0x200
#define SPC_TAB 0x400

typedef std::vector<unsigned char> Tok;

static void putWait(std::vector<Tok>& s, int frames) {
  while (frames>0) {
    int k=frames-1;
    if (k>255) k=255;
    if (k<=13) {
      s.push_back(Tok(1,(unsigned char)(0xf0+k)));
    } else {
      Tok t;
      t.push_back(0xfe);
      t.push_back(k);
      s.push_back(t);
    }
    frames-=k+1;
  }
}

static void putText(unsigned char* where, const String& str, size_t len) {
  memset(where,0,len);
  memcpy(where,str.c_str(),MIN(str.size(),len));
}

void DivExportSPC::run() {
  int sysSNES=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    if (e->song.system[i]==DIV_SYSTEM_SNES && sysSNES<0) {
      sysSNES=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the SNES sound; ignored",i,e->getSystemName(e->song.system[i]));
    }
  }
  if (sysSNES<0) {
    fail(_("no SNES chip in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysSNES);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.5f;
  logAppend("packing the register log...");

  // RAM image
  std::vector<unsigned char> ram(65536,0);
  size_t smpLen=0;
  const unsigned char* smp=(const unsigned char*)dispatchOf(sysSNES)->compileSampleMem(0,smpLen);
  if (smp!=NULL) {
    memcpy(&ram[SPC_TAB],smp,MIN(smpLen,65536-SPC_TAB));
    delete[] smp;
  }
  size_t dataStart=SPC_TAB+smpLen;
  std::vector<bool> ramKnown(65536,true);

  // tokens (one command each)
  std::vector<Tok> tok;
  int loopTok=-1, pending=0, maxEDL=0;
  std::map<unsigned int,unsigned int> lastDSP;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(tok,pending);
      pending=0;
      loopTok=(int)tok.size();
      lastDSP.clear();
      for (size_t k=0; k<ramKnown.size(); k++) ramKnown[k]=false;
    }
    std::vector<Tok> f;
    Tok run;
    unsigned int runStart=0, runNext=0;
    auto flushRun=[&]() {
      if (run.empty()) return;
      Tok c;
      c.push_back(0x82);
      c.push_back(runStart&0xff);
      c.push_back(runStart>>8);
      c.push_back(run.size());
      c.insert(c.end(),run.begin(),run.end());
      f.push_back(c);
      run.clear();
    };
    for (RGWrite& w: ticks[t]) {
      if (w.addr<0x80) {
        flushRun();
        if (w.addr==0x7d && (int)(w.val&15)>maxEDL) maxEDL=w.val&15;
        bool always=(w.addr==0x4c || w.addr==0x5c || w.addr==0x7c);
        std::map<unsigned int,unsigned int>::iterator it=lastDSP.find(w.addr);
        if (!always && it!=lastDSP.end() && it->second==w.val) continue;
        lastDSP[w.addr]=w.val;
        Tok c;
        c.push_back(w.addr);
        c.push_back(w.val&0xff);
        f.push_back(c);
      } else if (w.addr>=0x10000 && w.addr<0x20000) {
        unsigned int a=w.addr&0xffff;
        if (ramKnown[a] && ram[a]==(w.val&0xff)) continue;
        ram[a]=w.val&0xff;
        ramKnown[a]=true;
        if (run.empty() || a!=runNext || run.size()>=255) {
          flushRun();
          runStart=a;
        }
        run.push_back(w.val&0xff);
        runNext=a+1;
      }
    }
    flushRun();
    if (!f.empty()) {
      putWait(tok,pending);
      pending=0;
      tok.insert(tok.end(),f.begin(),f.end());
    }
    pending++;
  }
  putWait(tok,pending);
  tok.push_back(Tok(1,0xff));

  // the runtime writes went into the image above; start from the initial one again
  {
    size_t l2=0;
    const unsigned char* s2=(const unsigned char*)dispatchOf(sysSNES)->compileSampleMem(0,l2);
    memset(&ram[0],0,65536);
    if (s2!=NULL) {
      memcpy(&ram[SPC_TAB],s2,MIN(l2,65536-SPC_TAB));
      delete[] s2;
    }
  }

  // compress: repeated runs of commands become references to their first copy
  progress[0].amount=0.7f;
  int loopOut=-1;
  std::vector<unsigned char> out=pack(tok,loopTok,dataStart,8,loopOut);

  size_t freeEnd=0xf800-maxEDL*2048;
  size_t cap=(freeEnd>dataStart)?(freeEnd-dataStart):0;
  logAppendf("samples: %d bytes; log: %d commands -> %d bytes (%d bytes free)",(int)smpLen,(int)tok.size(),(int)out.size(),(int)cap);
  if (out.size()>cap) {
    fail(fmt::sprintf(_("the song does not fit in the SNES sound RAM: the log needs %d bytes but only %d are free after the samples and the echo buffer. try shorter samples or a shorter song"),(int)out.size(),(int)cap));
    return;
  }
  memcpy(&ram[dataStart],out.data(),out.size());

  // player
  memcpy(&ram[SPC_DRV],spcDriver,sizeof(spcDriver));
  int timer=(int)(8000.0/tickRate+0.5);
  if (timer<1) timer=1;
  if (timer>256) {
    timer=256;
    logAppend("WARNING: tick rate below 31.25Hz; the song will play faster");
  }
  ram[SPC_DRV+4]=timer&0xff;
  ram[0x3f0]=dataStart&0xff;
  ram[0x3f1]=dataStart>>8;
  if (loopOut>=0) {
    unsigned int la=dataStart+loopOut;
    ram[0x3f2]=la&0xff;
    ram[0x3f3]=la>>8;
    ram[0x3f4]=1;
  }

  // DSP: everything off until the log starts; echo buffer pointed away from the player
  unsigned char dsp[128];
  memset(dsp,0,128);
  dsp[0x6c]=0xe0;
  dsp[0x6d]=0xff;
  dsp[0x5d]=SPC_TAB>>8;

  // header
  double secs=(double)ticks.size()/tickRate;
  if (loopOut>=0 && loopTick>=0) secs=(double)ticks.size()/tickRate+(double)(ticks.size()-loopTick)/tickRate;
  int isecs=(int)(secs+1);
  if (isecs>999) isecs=999;
  unsigned char hdr[256];
  memset(hdr,0,256);
  memcpy(hdr,"SNES-SPC700 Sound File Data v0.30",33);
  hdr[0x21]=26;
  hdr[0x22]=26;
  hdr[0x23]=26;
  hdr[0x24]=30;
  hdr[0x25]=SPC_DRV&0xff;
  hdr[0x26]=SPC_DRV>>8;
  hdr[0x2b]=0xef;
  putText(&hdr[0x2e],e->song.name,32);
  putText(&hdr[0x4e],e->song.category.empty()?e->song.name:e->song.category,32);
  putText(&hdr[0x6e],"Registro Gamer",16);
  putText(&hdr[0x7e],"Furnace (Registro Gamer Tracker)",32);
  putText(&hdr[0xa9],fmt::sprintf("%d",isecs),3);
  putText(&hdr[0xac],(loopOut>=0)?"10000":"0",5);
  putText(&hdr[0xb1],e->song.author,32);

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write(hdr,256);
  w->write(ram.data(),65536);
  w->write(dsp,128);
  unsigned char tail[128];
  memset(tail,0,128);
  memcpy(&tail[64],&ram[0xffc0],64);
  w->write(tail,128);

  output.push_back(DivROMExportOutput("export.spc",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
