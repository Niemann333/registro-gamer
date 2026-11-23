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
// the log is split in 9 streams (one per voice and one for the rest), each compressed by
// pointing repeated parts back at earlier ones, so that a song fits in the little memory there is.
//
// log format:
// - $00-$7F vv: write vv to DSP register cmd
// - $82 lo hi nn data...: copy nn bytes to RAM at hi:lo (sample directory)
// - $83 dl dh sl sh nn: copy nn bytes from sh:sl to dh:dl (wavetables, kept once each in a pool)
// - $84 / $85: key this stream's voice on / off (written to KON/KOFF at the end of the tick)
// - $E0 lo hi nl nh: play nh:nl bytes of log found at hi:lo, then come back (nested up to 3 levels)
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "spc.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>
#include <algorithm>
#include <stdlib.h>

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
  // wavetables written while the song plays are kept once each in a pool after the samples
  size_t poolBase=SPC_TAB+smpLen;
  std::vector<unsigned char> pool;
  std::map<Tok,unsigned int> poolIdx;
  std::vector<bool> ramKnown(65536,true);

  // commands, split in 9 streams: one per voice (its registers, sample directory entry,
  // wavetable and key on/off) and one for the rest. each voice repeats its own patterns,
  // so the streams compress much better than one mixed log.
  #define SPC_STREAMS 9
  auto streamOf=[](unsigned int a) -> int {
    if (a>=0x400 && a<0x420) return (a-0x400)>>2;          // sample directory entry of a voice
    if (a>=0x420 && a<0x420+8*144) return (a-0x420)/144;    // wavetable area of a voice
    return 8;
  };
  std::vector<std::vector<Tok>> tok(SPC_STREAMS);
  std::vector<int> pending(SPC_STREAMS,0), loopTok(SPC_STREAMS,-1);
  int maxEDL=0;
  std::map<unsigned int,unsigned int> lastDSP;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      for (int k=0; k<SPC_STREAMS; k++) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        loopTok[k]=(int)tok[k].size();
      }
      lastDSP.clear();
      for (size_t k=0; k<ramKnown.size(); k++) ramKnown[k]=false;
    }
    std::vector<std::vector<Tok>> f(SPC_STREAMS);
    Tok run;
    unsigned int runStart=0, runNext=0;
    // a run of RAM writes: long ones (wavetables) are kept once in the pool and copied from there;
    // short ones (sample directory) are written byte by byte, skipping what is already there
    auto flushRun=[&]() {
      if (run.empty()) return;
      std::vector<Tok>& out=f[streamOf(runStart)];
      if (run.size()>=16) {
        bool same=true;
        for (size_t k=0; k<run.size(); k++) {
          if (!ramKnown[runStart+k] || ram[runStart+k]!=run[k]) {
            same=false;
            break;
          }
        }
        if (!same) {
          std::map<Tok,unsigned int>::iterator it=poolIdx.find(run);
          unsigned int at;
          if (it==poolIdx.end()) {
            at=pool.size();
            poolIdx[run]=at;
            pool.insert(pool.end(),run.begin(),run.end());
          } else {
            at=it->second;
          }
          for (size_t k=0; k<run.size(); k+=255) {
            size_t n=MIN((size_t)255,run.size()-k);
            unsigned int dst=runStart+k, src=poolBase+at+k;
            Tok c;
            c.push_back(0x83);
            c.push_back(dst&0xff);
            c.push_back(dst>>8);
            c.push_back(src&0xff);
            c.push_back(src>>8);
            c.push_back(n);
            out.push_back(c);
          }
          for (size_t k=0; k<run.size(); k++) {
            ram[runStart+k]=run[k];
            ramKnown[runStart+k]=true;
          }
        }
        run.clear();
        return;
      }
      Tok c;
      for (size_t k=0; k<=run.size(); k++) {
        bool keep=(k<run.size()) && !(ramKnown[runStart+k] && ram[runStart+k]==run[k]);
        if (keep) {
          if (c.empty()) {
            c.push_back(0x82);
            c.push_back((runStart+k)&0xff);
            c.push_back((runStart+k)>>8);
            c.push_back(0);
          }
          c.push_back(run[k]);
          c[3]++;
          ram[runStart+k]=run[k];
          ramKnown[runStart+k]=true;
        } else if (!c.empty()) {
          out.push_back(c);
          c.clear();
        }
      }
      run.clear();
    };
    for (RGWrite& w: ticks[t]) {
      if (w.addr<0x80) {
        flushRun();
        if (w.addr==0x7d && (int)(w.val&15)>maxEDL) maxEDL=w.val&15;
        if (w.addr==0x4c || w.addr==0x5c) {
          // key on/off: each voice sets its own bit; the player writes the masks at the end of the tick
          for (int v=0; v<8; v++) {
            if (w.val&(1<<v)) f[v].push_back(Tok(1,(unsigned char)(w.addr==0x4c?0x84:0x85)));
          }
          continue;
        }
        bool always=(w.addr==0x7c);
        std::map<unsigned int,unsigned int>::iterator it=lastDSP.find(w.addr);
        if (!always && it!=lastDSP.end() && it->second==w.val) continue;
        lastDSP[w.addr]=w.val;
        Tok c;
        c.push_back(w.addr);
        c.push_back(w.val&0xff);
        f[((w.addr&15)<10)?(w.addr>>4):8].push_back(c);
      } else if (w.addr>=0x10000 && w.addr<0x20000) {
        unsigned int a=w.addr&0xffff;
        if (run.empty() || a!=runNext || streamOf(a)!=streamOf(runStart)) {
          flushRun();
          runStart=a;
        }
        run.push_back(w.val&0xff);
        runNext=a+1;
      }
    }
    flushRun();
    for (int k=0; k<SPC_STREAMS; k++) {
      if (!f[k].empty()) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        tok[k].insert(tok[k].end(),f[k].begin(),f[k].end());
      }
      pending[k]++;
    }
  }
  for (int k=0; k<SPC_STREAMS; k++) {
    putWait(tok[k],pending[k]);
    tok[k].push_back(Tok(1,0xff));
  }

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
  size_t dataStart=poolBase+pool.size();
  if (dataStart<65536) memcpy(&ram[poolBase],pool.data(),MIN(pool.size(),65536-poolBase));

  // compress each stream: repeated runs of commands become references to their first copy.
  // the streams are independent, so each goes to whichever free area of RAM it fits in:
  // after the samples, the tail of RAM above the echo buffer ($F808-$FFFF; the player turns
  // the boot ROM off) and the gap after the player ($0384-$03FF)
  progress[0].amount=0.7f;
  size_t freeEnd=0xf800-maxEDL*2048;
  struct Area {
    size_t start, end, used;
  };
  std::vector<Area> areas;
  if (freeEnd>dataStart) areas.push_back({dataStart,freeEnd,0});
  areas.push_back({0xf808,0x10000,0});
  areas.push_back({SPC_DRV+sizeof(spcDriver)+3,SPC_TAB,0});
  size_t cap=0;
  for (Area& ar: areas) cap+=ar.end-ar.start;

  std::vector<size_t> sSize(SPC_STREAMS);
  size_t nCmds=0, total=0;
  for (int k=0; k<SPC_STREAMS; k++) {
    int lo=-1;
    sSize[k]=pack(tok[k],loopTok[k],0,3,lo).size();
    nCmds+=tok[k].size();
    total+=sSize[k];
  }
  logAppendf("samples: %d bytes; waves: %d bytes; log: %d commands -> %d bytes (%d bytes free)",(int)smpLen,(int)pool.size(),(int)nCmds,(int)total,(int)cap);
  // biggest stream first, each in the first area with room
  std::vector<int> order;
  for (int k=0; k<SPC_STREAMS; k++) order.push_back(k);
  std::sort(order.begin(),order.end(),[&](int x, int y) { return sSize[x]>sSize[y]; });
  std::vector<unsigned int> sStart(SPC_STREAMS,0), sLoop(SPC_STREAMS,0);
  for (int k: order) {
    bool placed=false;
    for (Area& ar: areas) {
      if (ar.end-ar.start-ar.used>=sSize[k]) {
        sStart[k]=ar.start+ar.used;
        ar.used+=sSize[k];
        placed=true;
        break;
      }
    }
    if (!placed) {
      fail(fmt::sprintf(_("the song does not fit in the SNES sound RAM: the log needs %d bytes but only %d are free after the samples and the echo buffer.\nexport it as SNSF instead (ROM export, \"SNES SNSF\"): there the song stays in the ROM and only the samples need to fit."),(int)total,(int)cap));
      return;
    }
  }
  for (int k=0; k<SPC_STREAMS; k++) {
    int lo=-1;
    std::vector<unsigned char> o=pack(tok[k],loopTok[k],sStart[k],3,lo);
    if (lo>=0 && loopTick>=0) sLoop[k]=sStart[k]+lo;
    memcpy(&ram[sStart[k]],o.data(),o.size());
  }
  bool looping=(loopTick>=0);

  // state of each stream (page zero, $30+n*20): pointer, wait, level, count, loop point, ref stack
  for (int k=0; k<SPC_STREAMS; k++) {
    unsigned char* st=&ram[0x30+k*20];
    st[0]=sStart[k]&0xff;
    st[1]=sStart[k]>>8;
    st[6]=sLoop[k]&0xff;
    st[7]=sLoop[k]>>8;
  }

  // player
  memcpy(&ram[SPC_DRV],spcDriver,sizeof(spcDriver));
  int timer=(int)(8000.0/tickRate+0.5);
  if (timer<1) timer=1;
  if (timer>256) {
    timer=256;
    logAppend("WARNING: tick rate below 31.25Hz; the song will play faster");
  }
  ram[SPC_DRV+4]=timer&0xff;

  // DSP: everything off until the log starts; echo buffer pointed away from the player
  unsigned char dsp[128];
  memset(dsp,0,128);
  dsp[0x6c]=0xe0;
  dsp[0x6d]=0xf8; // echo buffer (4 bytes when off) at $F800, outside the log areas
  dsp[0x5d]=SPC_TAB>>8;

  // header
  double secs=(double)ticks.size()/tickRate;
  if (looping) secs=(double)ticks.size()/tickRate+(double)(ticks.size()-loopTick)/tickRate;
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
  putText(&hdr[0xac],looping?"10000":"0",5);
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
