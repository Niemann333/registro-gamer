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

// Registro Gamer: SNSF export (SNES Sound Format: a SNES ROM inside a PSF, version 0x23).
// unlike the SPC (a snapshot of the 64KB sound RAM), the music here lives in the ROM, so it can be
// as long as wanted and the samples get almost all of the sound RAM:
// - snsfdrv.s (65816) uploads the SPC700 player (snsfspc.asm) to $0200 and the samples to $0400
//   through the boot loader of the sound chip, then streams the register log to it, 3 bytes at a time;
// - snsfspc.asm keeps a queue at $FC00-$FFFF and plays one tick of it at the song's rate (timer 0).
// the log uses the commands of the SPC export, in a single stream (see snsfspc.asm).
// the ROM is HiROM: the 65816 program at $00:8000 (file $8000), the data from $C1:0000 (file $10000).

#include "snsf.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <zlib.h>
#include <map>
#include <math.h>

#include "snsfdrv.inc"
#include "snsfspc.inc"

#define SNSF_TAB 0x400
#define SNSF_DATA 0x10000
#define SNSF_MAXROM 0x400000

typedef std::vector<unsigned char> Tok;

static void putWait(std::vector<unsigned char>& s, int frames) {
  while (frames>0) {
    int k=frames-1;
    if (k>255) k=255;
    if (k<=13) {
      s.push_back(0xf0+k);
    } else {
      s.push_back(0xfe);
      s.push_back(k);
    }
    frames-=k+1;
  }
}

static String timeStr(double secs) {
  int s=(int)(secs+0.999);
  return fmt::sprintf("%d:%02d",s/60,s%60);
}

static void put24(std::vector<unsigned char>& rom, unsigned int at, unsigned int fileOfs) {
  // HiROM: file offset -> $C0:0000 + offset
  unsigned int a=0xc00000+fileOfs;
  rom[at]=a&0xff;
  rom[at+1]=(a>>8)&0xff;
  rom[at+2]=(a>>16)&0xff;
}

void DivExportSNSF::run() {
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
  logAppend("building the register log...");

  // sound RAM: samples (and Furnace's sample directory and wave RAM) from $0400
  std::vector<unsigned char> ram(65536,0);
  size_t smpLen=0;
  const unsigned char* smp=(const unsigned char*)dispatchOf(sysSNES)->compileSampleMem(0,smpLen);
  if (smp!=NULL) {
    memcpy(&ram[SNSF_TAB],smp,MIN(smpLen,(size_t)(65536-SNSF_TAB)));
    delete[] smp;
  }
  std::vector<unsigned char> ramInit(ram);
  int maxEDL=0;
  for (std::vector<RGWrite>& tw: ticks) {
    for (RGWrite& w: tw) {
      if (w.addr==0x7d && (int)(w.val&15)>maxEDL) maxEDL=w.val&15;
    }
  }
  // wavetables written while the song plays are kept once each after the samples (if there is room)
  size_t poolBase=SNSF_TAB+smpLen;
  size_t ramEnd=0xf800-maxEDL*2048;
  std::vector<unsigned char> pool;
  std::map<Tok,unsigned int> poolIdx;
  std::vector<bool> ramKnown(65536,true);

  std::vector<unsigned char> log;
  int pending=0, loopOfs=-1;
  std::map<unsigned int,unsigned int> lastDSP;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(log,pending);
      pending=0;
      loopOfs=log.size();
      lastDSP.clear();
      for (size_t k=0; k<ramKnown.size(); k++) ramKnown[k]=false;
    }
    std::vector<unsigned char> f;
    Tok run;
    unsigned int runStart=0, runNext=0;
    auto flushRun=[&]() {
      if (run.empty()) return;
      bool same=true;
      for (size_t k=0; k<run.size(); k++) {
        if (!ramKnown[runStart+k] || ram[runStart+k]!=run[k]) {
          same=false;
          break;
        }
      }
      if (same) {
        run.clear();
        return;
      }
      if (run.size()>=16) {
        std::map<Tok,unsigned int>::iterator it=poolIdx.find(run);
        unsigned int at=0;
        bool inPool=false;
        if (it!=poolIdx.end()) {
          at=it->second;
          inPool=true;
        } else if (poolBase+pool.size()+run.size()<=ramEnd) {
          at=pool.size();
          poolIdx[run]=at;
          pool.insert(pool.end(),run.begin(),run.end());
          inPool=true;
        }
        if (inPool) {
          for (size_t k=0; k<run.size(); k+=255) {
            size_t n=MIN((size_t)255,run.size()-k);
            unsigned int dst=runStart+k, src=poolBase+at+k;
            f.push_back(0x83);
            f.push_back(dst&0xff);
            f.push_back(dst>>8);
            f.push_back(src&0xff);
            f.push_back(src>>8);
            f.push_back(n);
          }
          for (size_t k=0; k<run.size(); k++) {
            ram[runStart+k]=run[k];
            ramKnown[runStart+k]=true;
          }
          run.clear();
          return;
        }
      }
      // written byte by byte, skipping what is already there
      size_t k=0;
      while (k<run.size()) {
        if (ramKnown[runStart+k] && ram[runStart+k]==run[k]) {
          k++;
          continue;
        }
        size_t at=f.size();
        f.push_back(0x82);
        f.push_back((runStart+k)&0xff);
        f.push_back((runStart+k)>>8);
        f.push_back(0);
        while (k<run.size() && f[at+3]<255 && !(ramKnown[runStart+k] && ram[runStart+k]==run[k])) {
          f.push_back(run[k]);
          f[at+3]++;
          ram[runStart+k]=run[k];
          ramKnown[runStart+k]=true;
          k++;
        }
      }
      run.clear();
    };
    for (RGWrite& w: ticks[t]) {
      if (w.addr<0x80) {
        flushRun();
        if (w.addr==0x4c || w.addr==0x5c) {
          // key on/off: the player writes them at the end of the tick (key off as a pulse, before key on)
          if (w.val&0xff) {
            f.push_back(w.addr==0x4c?0x84:0x85);
            f.push_back(w.val&0xff);
          }
          continue;
        }
        bool always=(w.addr==0x7c);
        std::map<unsigned int,unsigned int>::iterator it=lastDSP.find(w.addr);
        if (!always && it!=lastDSP.end() && it->second==w.val) continue;
        lastDSP[w.addr]=w.val;
        f.push_back(w.addr);
        f.push_back(w.val&0xff);
      } else if (w.addr>=0x10000 && w.addr<0x20000) {
        unsigned int a=w.addr&0xffff;
        if (run.empty() || a!=runNext) {
          flushRun();
          runStart=a;
        }
        run.push_back(w.val&0xff);
        runNext=a+1;
      }
    }
    flushRun();
    if (!f.empty()) {
      putWait(log,pending);
      pending=0;
      log.insert(log.end(),f.begin(),f.end());
    }
    pending++;
  }
  putWait(log,pending);
  bool looping=(loopTick>=0 && loopOfs>=0);
  if (!looping) log.push_back(0xff);

  // ARAM image to upload: samples, then the wave pool
  std::vector<unsigned char> aram(ramInit.begin()+SNSF_TAB,ramInit.begin()+SNSF_TAB+smpLen);
  aram.insert(aram.end(),pool.begin(),pool.end());
  if (SNSF_TAB+aram.size()>ramEnd) {
    fail(fmt::sprintf(_("the samples do not fit in the SNES sound RAM: they need %d bytes but only %d are free with this echo size"),(int)aram.size(),(int)(ramEnd-SNSF_TAB)));
    return;
  }

  // SPC700 player, with the tick rate
  std::vector<unsigned char> spc(snsfSpcDriver,snsfSpcDriver+sizeof(snsfSpcDriver));
  double rateD=tickRate/2000.0*16777216.0;
  if (rateD>16777215.0) {
    rateD=16777215.0;
    logAppend("WARNING: tick rate above 2000Hz; the song will play slower");
  }
  unsigned int rate=(unsigned int)(rateD+0.5);
  spc[SNSFSPCDRIVER_RATE-0x200]=rate&0xff;
  spc[SNSFSPCDRIVER_RATE1-0x200]=(rate>>8)&0xff;
  spc[SNSFSPCDRIVER_RATE2-0x200]=(rate>>16)&0xff;

  // ROM
  progress[0].amount=0.7f;
  size_t dataSize=spc.size()+aram.size()+log.size();
  size_t romSize=0x20000;
  while (romSize<SNSF_DATA+dataSize) romSize<<=1;
  if (romSize>SNSF_MAXROM) {
    fail(fmt::sprintf(_("the song is too long for a SNES ROM: %d bytes of data (at most %d)"),(int)dataSize,SNSF_MAXROM-SNSF_DATA));
    return;
  }
  std::vector<unsigned char> rom(romSize,0);
  memcpy(&rom[0x8000],snsfDriver,sizeof(snsfDriver));
  size_t at=SNSF_DATA;
  unsigned int spcAt=at;
  memcpy(&rom[at],spc.data(),spc.size());
  at+=spc.size();
  unsigned int aramAt=at;
  if (!aram.empty()) memcpy(&rom[at],aram.data(),aram.size());
  at+=aram.size();
  unsigned int logAt=at;
  memcpy(&rom[at],log.data(),log.size());
  at+=log.size();
  put24(rom,SNSFDRV_TAB_LOG,logAt);
  put24(rom,SNSFDRV_TAB_END,at);
  put24(rom,SNSFDRV_TAB_LOOP,looping?(logAt+loopOfs):(at-1));
  put24(rom,SNSFDRV_TAB_ARAM,aramAt);
  rom[SNSFDRV_TAB_ARAMLEN]=aram.size()&0xff;
  rom[SNSFDRV_TAB_ARAMLEN+1]=(aram.size()>>8)&0xff;
  put24(rom,SNSFDRV_TAB_DRV,spcAt);
  rom[SNSFDRV_TAB_DRVLEN]=spc.size()&0xff;
  rom[SNSFDRV_TAB_DRVLEN+1]=(spc.size()>>8)&0xff;
  // header (HiROM, at $FFC0)
  {
    String title=e->song.name.empty()?String("REGISTRO GAMER"):e->song.name;
    for (int i=0; i<21; i++) {
      char c=(i<(int)title.size())?title[i]:' ';
      if (c<32 || c>126) c=' ';
      rom[0xffc0+i]=c;
    }
    rom[0xffd5]=0x21; // HiROM, slow
    rom[0xffd6]=0x00; // ROM only
    int sz=0;
    while ((1024U<<sz)<romSize) sz++;
    rom[0xffd7]=sz;
    rom[0xffd8]=0;
    rom[0xffd9]=0x01; // North America
    rom[0xffda]=0x00;
    rom[0xffdb]=0x00;
    // vectors: native NMI/IRQ/BRK/COP/ABORT and emulation ones do nothing; reset starts the program
    for (int v=0xffe4; v<0x10000; v+=2) {
      rom[v]=SNSFDRV_NOINT&0xff;
      rom[v+1]=SNSFDRV_NOINT>>8;
    }
    rom[0xfffc]=SNSFDRV_RESET&0xff;
    rom[0xfffd]=SNSFDRV_RESET>>8;
    rom[0xffdc]=0xff;
    rom[0xffdd]=0xff;
    rom[0xffde]=0;
    rom[0xffdf]=0;
    unsigned int sum=0;
    for (size_t i=0; i<romSize; i++) sum+=rom[i];
    sum&=0xffff;
    rom[0xffdc]=(sum^0xffff)&0xff;
    rom[0xffdd]=(sum^0xffff)>>8;
    rom[0xffde]=sum&0xff;
    rom[0xffdf]=sum>>8;
  }
  logAppendf("samples: %d bytes; waves: %d bytes; log: %d bytes; ROM: %d KB",(int)smpLen,(int)pool.size(),(int)log.size(),(int)(romSize>>10));

  // SNSF: program section = load offset, size, ROM
  progress[0].amount=0.8f;
  std::vector<unsigned char> prg(8,0);
  prg[4]=romSize&0xff;
  prg[5]=(romSize>>8)&0xff;
  prg[6]=(romSize>>16)&0xff;
  prg[7]=(romSize>>24)&0xff;
  prg.insert(prg.end(),rom.begin(),rom.end());
  uLongf zLen=compressBound(prg.size());
  std::vector<unsigned char> z(zLen);
  if (compress2(z.data(),&zLen,prg.data(),prg.size(),9)!=Z_OK) {
    fail("could not compress the ROM");
    return;
  }
  z.resize(zLen);
  unsigned int crc=crc32(0L,z.data(),z.size());

  // the boot loader of the sound chip takes about 25 microseconds per byte before the music starts
  double secs=(double)(aram.size()+spc.size())*25e-6+0.1;
  secs+=(double)ticks.size()/tickRate;
  if (looping) secs+=(double)(ticks.size()-loopTick)/tickRate;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSF\x23",4);
  w->writeI(0);
  w->writeI(z.size());
  w->writeI(crc);
  w->write(z.data(),z.size());
  String tags="[TAG]";
  if (!e->song.name.empty()) tags+="title="+e->song.name+"\n";
  if (!e->song.author.empty()) tags+="artist="+e->song.author+"\n";
  if (!e->song.category.empty()) tags+="game="+e->song.category+"\n";
  tags+="length="+timeStr(secs)+"\n";
  tags+=looping?"fade=10\n":"fade=0\n";
  tags+="utf8=1\n";
  tags+="snsfby=Registro Gamer Tracker (Furnace)\n";
  w->writeText(tags);

  output.push_back(DivROMExportOutput("export.snsf",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
