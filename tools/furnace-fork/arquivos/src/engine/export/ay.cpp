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

// Registro Gamer: AY export (ZXAYEMUL, ZX Spectrum 128 / AY-3-8910).
// the player (aydrv.asm, Z80) is loaded at $4100 and the register log right after it, up to $FFFF
// (repeated runs become nested references). the AY player calls the interrupt routine at 50Hz; a 32-bit
// each interrupt is split into timed steps, so any tick rate works (to about 1/16 of a frame).
// the log format is described in aydrv.asm.

#include "ay.h"
#include "ayconv.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <math.h>

#include "aydrv.inc"

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

#define ZX_AY_CLOCK 1773400.0

double rgAYClock(DivEngine* e, DivDispatch* d, int sys);

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

void DivExportAY::run() {
  int sysAY=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    if (s==DIV_SYSTEM_AY8910 && sysAY<0 && e->song.systemFlags[i].getInt("chipType",0)!=3) {
      sysAY=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the ZX Spectrum 128 sound (one AY-3-8910); ignored",i,e->getSystemName(s));
    }
  }
  if (sysAY<0) {
    fail(_("no AY-3-8910 in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysAY);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;
  logAppend("packing the register log...");

  double clk=rgAYClock(e,dispatchOf(sysAY),sysAY);
  RGAYConv ay(ZX_AY_CLOCK/clk);
  if (!ay.exact()) logAppendf("AY clock %.0fHz -> ZX Spectrum %.0fHz: periods rescaled",clk,ZX_AY_CLOCK);

  std::vector<Tok> tok;
  int loopTok=-1, pending=0;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putW(tok,pending);
      pending=0;
      loopTok=tok.size();
      ay.forget();
    }
    std::vector<Tok> f;
    for (RGWrite& w: ticks[t]) {
      std::vector<std::pair<int,int>> o;
      ay.write(w.addr,w.val&0xff,o);
      for (auto& p: o) {
        Tok c;
        c.push_back(p.first);
        c.push_back(p.second);
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
  if (ay.clamped) logAppend("WARNING: some AY periods are out of range at the ZX Spectrum clock");

  unsigned int logAt=AYDRIVER_DRVEND;
  int loopOut=-1;
  std::vector<unsigned char> s=pack(tok,loopTok,logAt,8,loopOut,2);
  size_t cap=0x10000-logAt;
  logAppendf("log: %d bytes (%d free)",(int)s.size(),(int)cap);
  if (s.size()>cap) {
    fail(fmt::sprintf(_("the song does not fit in the ZX Spectrum's memory: the log needs %d bytes but only %d are free.\nexport it as VGM instead (it has no size limit), or as KSS if it can be an MSX song."),(int)s.size(),(int)cap));
    return;
  }

  int steps=16, dly=1;
  unsigned int rate=0, acc0=0;
  rgZ80Steps(tickRate,50.0,3546900.0,steps,rate,dly,acc0);
  std::vector<unsigned char> blk(ayDriver,ayDriver+sizeof(ayDriver));
  auto at=[&](int addr) -> unsigned char& { return blk[addr-AYDRIVER_INIT]; };
  at(AYDRIVER_LOG)=logAt&0xff;
  at(AYDRIVER_LOG+1)=logAt>>8;
  for (int i=0; i<3; i++) at(AYDRIVER_RATE+i)=(rate>>(8*i))&0xff;
  for (int i=0; i<3; i++) at(AYDRIVER_ACCI+i)=(acc0>>(8*i))&0xff;
  at(AYDRIVER_STEPS)=steps;
  at(AYDRIVER_DLY)=dly&0xff;
  at(AYDRIVER_DLY+1)=dly>>8;
  if (loopOut>=0 && loopTick>=0) {
    at(AYDRIVER_LOOPP)=(logAt+loopOut)&0xff;
    at(AYDRIVER_LOOPP+1)=(logAt+loopOut)>>8;
  }
  blk.insert(blk.end(),s.begin(),s.end());

  // song length in 1/50 s (the loop played once more, then a fade)
  double secs=(double)ticks.size()/tickRate;
  bool looping=(loopTick>=0);
  if (looping) secs+=(double)(ticks.size()-loopTick)/tickRate;
  int len50=(int)MIN(65535.0,secs*50.0+0.5);

  // ZXAYEMUL file: pointers are signed 16-bit big endian offsets from the pointer itself
  std::vector<unsigned char> f;
  auto be16=[&](int v) { f.push_back((v>>8)&0xff); f.push_back(v&0xff); };
  std::vector<std::pair<size_t,size_t*>> fix;
  const char* tag="ZXAYEMUL";
  f.insert(f.end(),tag,tag+8);
  f.push_back(3); // file version
  f.push_back(0); // player version
  be16(0); // no special player
  size_t pAuthor=f.size(); be16(0);
  size_t pMisc=f.size(); be16(0);
  f.push_back(0); // songs-1
  f.push_back(0); // first song
  size_t pSongs=f.size(); be16(0);
  // song structure
  size_t songs=f.size();
  size_t pName=f.size(); be16(0);
  size_t pData=f.size(); be16(0);
  // song data
  size_t data=f.size();
  f.push_back(0); f.push_back(1); f.push_back(2); f.push_back(3); // channel order A B C, noise
  be16(len50);
  be16(looping?500:0); // fade
  f.push_back(0); f.push_back(0); // hi/lo registers
  size_t pPoints=f.size(); be16(0);
  size_t pAddr=f.size(); be16(0);
  size_t points=f.size();
  be16(AYDRIVER_INIT); // stack (grows down below the player)
  be16(AYDRIVER_INIT);
  be16(AYDRIVER_PLAY);
  size_t addrs=f.size();
  be16(AYDRIVER_INIT);
  be16(blk.size());
  size_t pBlk=f.size(); be16(0);
  be16(0); // end of the list
  auto putStrZ=[&](const String& str) -> size_t {
    size_t p=f.size();
    for (char c: str) f.push_back(c);
    f.push_back(0);
    return p;
  };
  size_t sAuthor=putStrZ(e->song.author);
  size_t sMisc=putStrZ("Registro Gamer Tracker (Furnace)");
  size_t sName=putStrZ(e->song.name.empty()?String("song"):e->song.name);
  size_t blkAt=f.size();
  f.insert(f.end(),blk.begin(),blk.end());
  auto rel=[&](size_t ptr, size_t target) {
    int d=(int)target-(int)ptr;
    f[ptr]=(d>>8)&0xff;
    f[ptr+1]=d&0xff;
  };
  rel(pAuthor,sAuthor);
  rel(pMisc,sMisc);
  rel(pSongs,songs);
  rel(pName,sName);
  rel(pData,data);
  rel(pPoints,points);
  rel(pAddr,addrs);
  rel(pBlk,blkAt);
  if (blkAt-pBlk>32767) {
    fail("internal error: AY data too far");
    return;
  }

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write(f.data(),f.size());
  output.push_back(DivROMExportOutput("export.ay",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
