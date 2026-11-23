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

// Registro Gamer: PSF export (Sony PlayStation SPU).
// the PSF holds a PS-X EXE: the player (psfdrv.s) at 80010000h, then the SPU RAM image
// (the ADPCM samples, uploaded to the SPU at start) and the register log. a tick happens
// every time root counter 2 (sysclk/8) reaches its target a set number of times.
//
// log format:
// - $00-$DF lo hi: write hi:lo to SPU register 1F801C00h+cmd*2
// - $E1 rr lo hi: same, for registers $E0-$FF (reverb)
// - $E0 a0 a1 a2 nl nh: play nh:nl bytes of log found at offset a2:a1:a0, then come back
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "psf.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <zlib.h>
#include <map>
#include <math.h>

#include "psfdrv.inc"

#define PSX_LOAD 0x80010000
#define PSX_STACK 0x801ffff0
#define PSX_REFSTACK 0x801fe000
#define PSX_LIMIT 0x801f0000
#define PSX_SPU_SAMPLES 0x1000

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

static void put32(std::vector<unsigned char>& v, size_t at, unsigned int x) {
  v[at]=x&0xff;
  v[at+1]=(x>>8)&0xff;
  v[at+2]=(x>>16)&0xff;
  v[at+3]=(x>>24)&0xff;
}

static String timeStr(double secs) {
  int s=(int)(secs+0.999);
  return fmt::sprintf("%d:%02d",s/60,s%60);
}

void DivExportPSF::run() {
  int sysPSX=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    if (e->song.system[i]==DIV_SYSTEM_PSX && sysPSX<0) {
      sysPSX=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the PlayStation sound; ignored",i,e->getSystemName(e->song.system[i]));
    }
  }
  if (sysPSX<0) {
    fail(_("no PlayStation SPU in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysPSX);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.5f;
  logAppend("packing the register log...");

  // commands
  std::vector<Tok> tok;
  int loopTok=-1, pending=0;
  std::map<unsigned int,unsigned int> last;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(tok,pending);
      pending=0;
      loopTok=(int)tok.size();
      last.clear();
    }
    std::vector<Tok> f;
    for (RGWrite& w: ticks[t]) {
      if (w.addr>=0x200) continue;
      unsigned int idx=w.addr>>1;
      bool always=(w.addr>=0x188 && w.addr<=0x18e);
      std::map<unsigned int,unsigned int>::iterator it=last.find(idx);
      if (!always && it!=last.end() && it->second==w.val) continue;
      last[idx]=w.val;
      Tok c;
      if (idx>=0xe0) {
        c.push_back(0xe1);
        c.push_back(idx);
      } else {
        c.push_back(idx);
      }
      c.push_back(w.val&0xff);
      c.push_back((w.val>>8)&0xff);
      f.push_back(c);
    }
    if (!f.empty()) {
      putWait(tok,pending);
      pending=0;
      tok.insert(tok.end(),f.begin(),f.end());
    }
    pending++;
  }
  putWait(tok,pending);
  tok.push_back(Tok(1,0xff));

  progress[0].amount=0.6f;
  int loopOut=-1;
  std::vector<unsigned char> log=pack(tok,loopTok,0,8,loopOut,3);

  // samples (SPU RAM from 1000h)
  size_t smpLen=0;
  const unsigned char* smpMem=sampleMem(sysPSX,0,smpLen);
  std::vector<unsigned char> smp;
  if (smpMem!=NULL && smpLen>PSX_SPU_SAMPLES) smp.assign(smpMem+PSX_SPU_SAMPLES,smpMem+smpLen);
  while (smp.size()&63) smp.push_back(0);

  // program image
  std::vector<unsigned char> text(sizeof(psfDriver),0);
  memcpy(text.data(),psfDriver,sizeof(psfDriver));
  while (text.size()&2047) text.push_back(0);
  unsigned int smpAddr=PSX_LOAD+text.size();
  text.insert(text.end(),smp.begin(),smp.end());
  while (text.size()&3) text.push_back(0);
  unsigned int logAddr=PSX_LOAD+text.size();
  text.insert(text.end(),log.begin(),log.end());
  while (text.size()&2047) text.push_back(0);
  logAppendf("samples: %d bytes; log: %d commands -> %d bytes",(int)smp.size(),(int)tok.size(),(int)log.size());
  if (PSX_LOAD+text.size()>PSX_LIMIT) {
    fail(fmt::sprintf(_("the song does not fit in the PlayStation's 2MB of RAM (%d KB)"),(int)(text.size()/1024)));
    return;
  }
  // root counter 2 runs at sysclk/8 and counts up to 65535: a long tick is split into equal parts
  double period=4233600.0/tickRate;
  unsigned int hits=(unsigned int)ceil(period/65535.0);
  if (hits<1) hits=1;
  unsigned int target=(unsigned int)(period/hits+0.5);
  if (target<1) target=1;
  if (target>65535) target=65535;
  put32(text,8,logAddr);
  put32(text,12,(loopOut>=0)?(logAddr+loopOut):0);
  put32(text,16,smpAddr);
  put32(text,20,smp.size());
  put32(text,24,target|(hits<<16));
  put32(text,28,PSX_REFSTACK);

  // PS-X EXE
  std::vector<unsigned char> exe(2048,0);
  memcpy(exe.data(),"PS-X EXE",8);
  put32(exe,0x10,PSX_LOAD);
  put32(exe,0x18,PSX_LOAD);
  put32(exe,0x1c,text.size());
  put32(exe,0x30,PSX_STACK);
  const char* region="Sony Computer Entertainment Inc. for North America area";
  memcpy(&exe[0x4c],region,strlen(region));
  exe.insert(exe.end(),text.begin(),text.end());

  // PSF
  progress[0].amount=0.8f;
  uLongf zLen=compressBound(exe.size());
  std::vector<unsigned char> z(zLen);
  if (compress2(z.data(),&zLen,exe.data(),exe.size(),9)!=Z_OK) {
    fail("could not compress the program");
    return;
  }
  z.resize(zLen);
  unsigned int crc=crc32(0L,z.data(),z.size());

  double secs=(double)ticks.size()/tickRate;
  if (loopOut>=0 && loopTick>=0) secs+=(double)(ticks.size()-loopTick)/tickRate;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSF\x01",4);
  w->writeI(0);
  w->writeI(z.size());
  w->writeI(crc);
  w->write(z.data(),z.size());
  String tags="[TAG]";
  if (!e->song.name.empty()) tags+="title="+e->song.name+"\n";
  if (!e->song.author.empty()) tags+="artist="+e->song.author+"\n";
  if (!e->song.category.empty()) tags+="game="+e->song.category+"\n";
  tags+="length="+timeStr(secs)+"\n";
  tags+=(loopOut>=0)?"fade=10\n":"fade=0\n";
  tags+="utf8=1\n";
  tags+="psfby=Registro Gamer Tracker (Furnace)\n";
  w->writeText(tags);

  output.push_back(DivROMExportOutput("export.psf",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
