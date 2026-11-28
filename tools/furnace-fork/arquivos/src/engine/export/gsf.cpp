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


// Registro Gamer: GSF export (Game Boy Advance).
// the GBA has no sample channels of its own: its games mix the music in software into an 8-bit
// stream that two DMA channels feed to the "direct sound" FIFOs. this exporter does the same:
// the song (GBA DMA, GBA MinMod and the Game Boy channels) is mixed while it plays, stored in the
// ROM as 8-bit signed audio (left -> FIFO A, right -> FIFO B, or one stream for both if it is mono)
// and played by gsfdrv.s; timer 0 sets the rate and timer 1 counts the samples to find the loop.

#include "gsf.h"
#include "../engine.h"
#include "../ta-log.h"
#include "blip_buf.h"
#include <fmt/printf.h>
#include <zlib.h>
#include <math.h>

#include "gsfdrv.inc"

#define GBA_ROM 0x08000000
#define GBA_ROM_MAX (32*1024*1024)
#define GSF_PAD 256

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

struct GSFChip {
  DivDispatch* d;
  int outs;
  float vol;
  double acc;
  blip_t* bb[2];
  int prev[2];
  size_t pos;
  std::vector<short> buf[2];
};

void DivExportGSF::run() {
  std::vector<int> sys;
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    if (s==DIV_SYSTEM_GBA_DMA || s==DIV_SYSTEM_GBA_MINMOD || s==DIV_SYSTEM_GB) {
      sys.push_back(i);
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the Game Boy Advance sound; ignored",i,e->getSystemName(s));
    }
  }
  if (sys.empty()) {
    fail(_("no Game Boy Advance or Game Boy chip in this song"));
    return;
  }

  // rate: 32768Hz (512 cycles per sample, like many games) unless the song is too long for 32MB
  double est=0;
  e->synchronizedSoft([&]() {
    e->calcSongTimestamps();
    est=e->curSubSong->ts.totalTime.toDouble();
  });
  int cycles=512;
  double maxSecs=(double)(GBA_ROM_MAX-65536)/2.0;
  if (est>0 && est*16777216.0/cycles>maxSecs) {
    cycles=(int)ceil(est*16777216.0/maxSecs);
    if (cycles>2048) cycles=2048;
    logAppendf("long song (%.0f s): lowering the rate to %d Hz",est,16777216/cycles);
  }
  double outRate=16777216.0/cycles;

  std::vector<GSFChip> chips(sys.size());
  for (size_t k=0; k<sys.size(); k++) {
    GSFChip& c=chips[k];
    c.d=dispatchOf(sys[k]);
    c.outs=c.d->getOutputCount();
    if (c.outs>2) c.outs=2;
    if (c.outs<1) c.outs=1;
    c.vol=e->song.systemVol[sys[k]];
    c.acc=0;
    c.pos=0;
    for (int o=0; o<2; o++) {
      c.bb[o]=NULL;
      c.prev[o]=0;
      if (o<c.outs) {
        c.bb[o]=blip_new(8192);
        blip_set_rates(c.bb[o],c.d->rate,outRate);
        blip_set_dc(c.bb[o],1);
      }
    }
  }

  std::vector<float> mixL, mixR;
  std::vector<size_t> tickPos;
  short tmp[4096];
  tickHook=[&](int t) {
    size_t start=mixL.size();
    tickPos.push_back(start);
    for (GSFChip& c: chips) {
      if (c.pos<start) c.pos=start;
      c.acc+=(double)c.d->rate/tickRate;
      size_t n=(size_t)c.acc;
      c.acc-=n;
      // in pieces, so that each blip frame stays small
      size_t piece=(size_t)((double)c.d->rate*1500.0/outRate);
      if (piece<1) piece=1;
      while (n>0) {
        size_t m=n<piece?n:piece;
        n-=m;
        short* ptr[DIV_MAX_OUTPUTS];
        for (int o=0; o<DIV_MAX_OUTPUTS; o++) ptr[o]=NULL;
        for (int o=0; o<c.outs; o++) {
          if (c.buf[o].size()<m) c.buf[o].resize(m);
          ptr[o]=c.buf[o].data();
        }
        c.d->acquire(ptr,m);
        for (int o=0; o<c.outs; o++) {
          short* b=c.buf[o].data();
          for (size_t j=0; j<m; j++) {
            if (b[j]!=c.prev[o]) {
              blip_add_delta(c.bb[o],j,b[j]-c.prev[o]);
              c.prev[o]=b[j];
            }
          }
          blip_end_frame(c.bb[o],m);
        }
        int avail=blip_samples_avail(c.bb[0]);
        for (int o=1; o<c.outs; o++) {
          int a=blip_samples_avail(c.bb[o]);
          if (a<avail) avail=a;
        }
        if (avail<=0) continue;
        if (mixL.size()<c.pos+avail) {
          mixL.resize(c.pos+avail,0.0f);
          mixR.resize(c.pos+avail,0.0f);
        }
        for (int o=0; o<c.outs; o++) {
          int got=0;
          while (got<avail) {
            int want=avail-got;
            if (want>4096) want=4096;
            int r=blip_read_samples(c.bb[o],tmp,want,0);
            if (r<=0) break;
            for (int j=0; j<r; j++) {
              float v=tmp[j]*c.vol;
              if (c.outs==1) {
                mixL[c.pos+got+j]+=v;
                mixR[c.pos+got+j]+=v;
              } else if (o==0) {
                mixL[c.pos+got+j]+=v;
              } else {
                mixR[c.pos+got+j]+=v;
              }
            }
            got+=r;
          }
        }
        c.pos+=avail;
      }
    }
    if ((t&255)==0) progress[0].amount=0.5f*(est>0?fmin(1.0,(double)t/tickRate/est):0.0);
  };
  bool ok=capture(sys);
  tickHook=nullptr;
  for (GSFChip& c: chips) {
    for (int o=0; o<2; o++) if (c.bb[o]!=NULL) blip_delete(c.bb[o]);
  }
  if (!ok) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;

  size_t total=mixL.size();
  for (GSFChip& c: chips) if (c.pos<total) total=c.pos;
  mixL.resize(total);
  mixR.resize(total);
  if (total<64) {
    fail(_("the song has no sound"));
    return;
  }
  long long loopSmp=-1;
  if (loopTick>=0 && loopTick<(int)tickPos.size()) loopSmp=(long long)tickPos[loopTick];
  if (loopSmp>=(long long)total) loopSmp=-1;

  // 8 bits: the loudest point goes to the top
  bool mono=true;
  float peak=1.0f;
  for (size_t i=0; i<total; i++) {
    if (fabsf(mixL[i])>peak) peak=fabsf(mixL[i]);
    if (fabsf(mixR[i])>peak) peak=fabsf(mixR[i]);
    if (mono && fabsf(mixL[i]-mixR[i])>0.5f) mono=false;
  }
  float gain=127.0f/peak;
  auto q8=[&](float v) -> unsigned char {
    int x=(int)lrintf(v*gain);
    if (x<-128) x=-128;
    if (x>127) x=127;
    return (unsigned char)(signed char)x;
  };
  auto stream=[&](std::vector<float>& src, std::vector<unsigned char>& out) {
    out.resize(total+GSF_PAD);
    for (size_t i=0; i<total; i++) out[i]=q8(src[i]);
    // after the end: the start of the loop again (the DMA reads ahead), or silence
    for (size_t i=0; i<GSF_PAD; i++) {
      out[total+i]=(loopSmp>=0 && (size_t)loopSmp+i<total)?out[loopSmp+i]:0;
    }
  };

  std::vector<unsigned char> rom(sizeof(gsfDriver),0);
  memcpy(rom.data(),gsfDriver,sizeof(gsfDriver));
  while (rom.size()&255) rom.push_back(0);
  memcpy(&rom[0xa0],"REGISTROGAMER",12);
  memcpy(&rom[0xac],"RGTK01",6);
  std::vector<unsigned char> s;
  unsigned int addrL=GBA_ROM+rom.size(), addrR;
  stream(mixL,s);
  rom.insert(rom.end(),s.begin(),s.end());
  while (rom.size()&255) rom.push_back(0);
  if (mono) {
    addrR=addrL;
  } else {
    addrR=GBA_ROM+rom.size();
    stream(mixR,s);
    rom.insert(rom.end(),s.begin(),s.end());
    while (rom.size()&255) rom.push_back(0);
  }
  if (rom.size()>GBA_ROM_MAX) {
    fail(fmt::sprintf(_("the song does not fit in a 32MB Game Boy Advance ROM (%d KB)"),(int)(rom.size()/1024)));
    return;
  }
  put32(rom,0xc0,addrL);
  put32(rom,0xc4,addrR);
  put32(rom,0xc8,(unsigned int)total);
  put32(rom,0xcc,(loopSmp>=0)?(unsigned int)loopSmp:0xffffffff);
  put32(rom,0xd0,(unsigned int)(65536-cycles));
  logAppendf("%s, %d Hz, %d samples, loop at %d; ROM: %d KB",mono?"mono":"stereo",(int)outRate,(int)total,(int)loopSmp,(int)(rom.size()/1024));

  // GSF program: entry point, load address, size, ROM
  std::vector<unsigned char> prog(12,0);
  put32(prog,0,GBA_ROM);
  put32(prog,4,GBA_ROM);
  put32(prog,8,rom.size());
  prog.insert(prog.end(),rom.begin(),rom.end());

  progress[0].amount=0.8f;
  uLongf zLen=compressBound(prog.size());
  std::vector<unsigned char> z(zLen);
  if (compress2(z.data(),&zLen,prog.data(),prog.size(),9)!=Z_OK) {
    fail("could not compress the program");
    return;
  }
  z.resize(zLen);
  unsigned int crc=crc32(0L,z.data(),z.size());

  double secs=(double)total/outRate;
  if (loopSmp>=0) secs+=(double)(total-loopSmp)/outRate;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSF\x22",4);
  w->writeI(0);
  w->writeI(z.size());
  w->writeI(crc);
  w->write(z.data(),z.size());
  String tags="[TAG]";
  if (!e->song.name.empty()) tags+="title="+e->song.name+"\n";
  if (!e->song.author.empty()) tags+="artist="+e->song.author+"\n";
  if (!e->song.category.empty()) tags+="game="+e->song.category+"\n";
  tags+="length="+timeStr(secs)+"\n";
  tags+=(loopSmp>=0)?"fade=10\n":"fade=0\n";
  tags+="utf8=1\n";
  tags+="gsfby=Registro Gamer Tracker (Furnace)\n";
  w->writeText(tags);

  output.push_back(DivROMExportOutput("export.gsf",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
