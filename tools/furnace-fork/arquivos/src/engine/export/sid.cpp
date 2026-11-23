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

// Registro Gamer: SID export (Commodore 64, PSID v4, up to 3 SIDs).
// the player (siddrv.asm) sits at $0800; the register log follows up to $FFF9 (the RAM under
// I/O and KERNAL is read by switching it in for each byte). CIA 1 timer A sets the tick rate.
// each SID gets 11 streams of commands, each compressed on its own: frequency, pulse width and
// control/ADSR of each voice, filter cutoff and resonance/volume. frequency, pulse width and cutoff
// are "value" streams: every tick their value is the one some ticks ago (1 to 8) plus a delta, so
// slides, vibratos, pulse sweeps and arpeggios cost nothing while they keep the same shape.
// the command formats are described in siddrv.asm.

#include "sid.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>
#include <algorithm>
#include <stdlib.h>

#include "siddrv.inc"

#define SID_LOAD 0x0800
#define SID_END 0xfffa

typedef std::vector<unsigned char> Tok;

static void putWait(std::vector<Tok>& s, int frames) {
  while (frames>0) {
    int k=frames-1;
    if (k>254) k=254; // the player counts waits in 8 bits, including the current tick
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

static void putStr(SafeWriter* w, const String& str) {
  char buf[32];
  memset(buf,0,32);
  strncpy(buf,str.c_str(),31);
  w->write(buf,32);
}

static void writeBE16(SafeWriter* w, unsigned short v) {
  w->writeC(v>>8);
  w->writeC(v&0xff);
}

// driver tables (see siddrv.asm): NS bytes each, then the ref stacks and the value history
#define SID_NS 33
enum {
  ST_PTRL=0, ST_PTRH, ST_NEXT, ST_LOOPL, ST_LOOPH, ST_TYPE, ST_REG, ST_SP, ST_ENDL, ST_ENDH,
  ST_VALL, ST_VALH, ST_DL, ST_DH, ST_LAG, ST_HB, ST_HCNT, ST_APOS, ST_UPF, ST_ACT, ST_MODE, ST_REG1, ST_COUNT
};
#define SID_SKPL (SIDDRIVER_TABLES+SID_NS*ST_COUNT)
#define SID_BHEAD (SID_SKPL+1536)
#define SID_DATA (SID_SKPL+2304)
#define SID_LAGS 8

void DivExportSID::run() {
  std::vector<int> sys;
  bool model8580=false, pal=true;
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    if ((s==DIV_SYSTEM_C64_6581 || s==DIV_SYSTEM_C64_8580) && sys.size()<3) {
      if (sys.empty()) {
        model8580=(s==DIV_SYSTEM_C64_8580);
        pal=(e->song.systemFlags[i].getInt("clockSel",0)!=0);
      }
      sys.push_back(i);
    } else {
      logAppendf("WARNING: chip %d (%s) is not exported to SID; ignored",i,e->getSystemName(s));
    }
  }
  if (sys.empty()) {
    fail(_("no SID chip in this song"));
    return;
  }
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.4f;
  logAppend("packing the register log...");

  int nSID=sys.size();
  int nStr=nSID*11;
  size_t nT=ticks.size();
  // stream layout of each SID: 0 freq 1 pulse 2 control/ADSR of voice 1, 3-5 voice 2, 6-8 voice 3, 9 cutoff, 10 res/volume
  std::vector<int> sType(nStr,0), sReg(nStr,0);
  bool cutoffBits=true;
  for (std::vector<RGWrite>& tw: ticks) {
    for (RGWrite& w: tw) {
      if (w.addr==0x15 && w.val>7) cutoffBits=false;
    }
  }
  for (int n=0; n<nSID; n++) {
    for (int v=0; v<3; v++) {
      sType[n*11+v*3]=1; sReg[n*11+v*3]=n*0x20+v*7;
      sType[n*11+v*3+1]=1; sReg[n*11+v*3+1]=n*0x20+v*7+2;
      sType[n*11+v*3+2]=0; sReg[n*11+v*3+2]=n*0x20+v*7+4;
    }
    sType[n*11+9]=cutoffBits?2:1; sReg[n*11+9]=n*0x20+0x15;
    sType[n*11+10]=0; sReg[n*11+10]=n*0x20+0x17;
  }
  auto sidOf=[&](int s) -> int {
    for (int k=0; k<nSID; k++) if (sys[k]==s) return k;
    return 0;
  };
  // which stream a register belongs to
  auto streamOf=[](int r) -> int {
    if (r<21) return (r/7)*3+((r%7)<2?0:((r%7)<4?1:2));
    if (r<23) return 9;
    return 10;
  };

  // register state after each tick, and the byte commands of each tick
  std::vector<std::vector<Tok>> tok(nStr);
  std::vector<int> pending(nStr,0), loopTok(nStr,-1);
  std::vector<int> regs(nSID*32,-1);
  std::vector<int> lastB(nSID*32,-1);
  // value streams: wanted value per tick (-1: not written yet)
  std::vector<std::vector<int>> want(nStr);
  std::vector<std::vector<std::vector<Tok>>> perTick(nT);
  for (size_t t=0; t<nT; t++) {
    if ((int)t==loopTick) {
      for (int& x: lastB) x=-1;
    }
    perTick[t].resize(nStr);
    for (RGWrite& w: ticks[t]) {
      if (w.addr>0x18) continue;
      int n=sidOf(w.sys);
      int r=w.addr;
      regs[n*32+r]=w.val&0xff;
      int k=n*11+streamOf(r);
      if (sType[k]!=0) continue;
      if (lastB[n*32+r]==(int)(w.val&0xff)) continue;
      lastB[n*32+r]=w.val&0xff;
      Tok c;
      c.push_back(n*0x20+r-sReg[k]);
      c.push_back(w.val&0xff);
      perTick[t][k].push_back(c);
    }
    for (int k=0; k<nStr; k++) {
      if (sType[k]==0) continue;
      int lo=regs[sReg[k]], hi=regs[sReg[k]+1];
      int v=-1;
      if (lo>=0 || hi>=0) {
        if (lo<0) lo=0;
        if (hi<0) hi=0;
        v=(sType[k]==2)?((hi<<3)|(lo&7)):(lo|(hi<<8));
      }
      want[k].push_back(v);
    }
  }

  // value streams: each tick, VAL = (value LAG ticks ago) + DELTA. when that misses, pick the LAG and
  // DELTA that keep predicting right for the longest
  std::vector<bool> usesHist(nStr,false);
  // lag in effect at each tick of each value stream
  std::vector<std::vector<unsigned char>> lagAt(nStr);
  for (int k=0; k<nStr; k++) if (sType[k]!=0) lagAt[k].resize(nT,1);
  {
    std::vector<std::vector<int>> hist(nStr);
    std::vector<int> P(nStr,1), D(nStr,0);
    for (size_t t=0; t<nT; t++) {
      if ((int)t==loopTick) {
        for (int k=0; k<nStr; k++) {
          hist[k].clear();
          P[k]=1;
          D[k]=0;
        }
      }
      if ((t&1023)==0) progress[0].amount=0.4f+0.2f*(float)t/(float)nT;
      for (int k=0; k<nStr; k++) {
        if (sType[k]==0) continue;
        int v=want[k][t];
        if (v<0) continue;
        std::vector<int>& h=hist[k];
        std::vector<Tok>& f=perTick[t][k];
        if (!h.empty() && (int)h.size()>=P[k] && ((h[h.size()-P[k]]+D[k])&0xffff)==v) {
          h.push_back(v);
          if (h.size()>SID_LAGS*4) h.erase(h.begin(),h.begin()+SID_LAGS*3);
          continue;
        }
        if (h.empty()) {
          Tok c;
          c.push_back(0x80);
          c.push_back(v&0xff);
          c.push_back(v>>8);
          f.push_back(c);
          P[k]=1;
          D[k]=0;
          h.push_back(v);
          continue;
        }
        int bestRun=-1, bestCost=99, bestP=1, bestD=0;
        int maxP=MIN(SID_LAGS,(int)h.size());
        for (int p=1; p<=maxP; p++) {
          int d=(v-h[h.size()-p])&0xffff;
          int ds=(d>=0x8000)?(d-0x10000):d;
          int cost=(p==1 && ds>=-32 && ds<32)?1:((ds>=-128 && ds<128)?2:3);
          // how long does it keep predicting right?
          std::vector<int> hh(h.end()-maxP,h.end());
          hh.push_back(v);
          int run=0;
          for (size_t q=t+1; q<nT && q<t+64; q++) {
            if ((int)q==loopTick) break;
            int x=want[k][q];
            if (x<0 || ((hh[hh.size()-p]+d)&0xffff)!=x) break;
            hh.push_back(x);
            run++;
          }
          if (run>bestRun || (run==bestRun && cost<bestCost)) {
            bestRun=run;
            bestCost=cost;
            bestP=p;
            bestD=ds;
          }
        }
        Tok c;
        if (bestP==1 && bestD>=-32 && bestD<32) {
          c.push_back(0x20+bestD);
        } else if (bestD>=-128 && bestD<128) {
          c.push_back(0x3f+bestP);
          c.push_back(bestD&0xff);
        } else {
          c.push_back(0x47+bestP);
          c.push_back(bestD&0xff);
          c.push_back((bestD>>8)&0xff);
        }
        if (bestP>1) usesHist[k]=true;
        f.push_back(c);
        P[k]=bestP;
        D[k]=bestD&0xffff;
        h.push_back(v);
        if (h.size()>SID_LAGS*4) h.erase(h.begin(),h.begin()+SID_LAGS*3);
      }
      for (int k=0; k<nStr; k++) {
        if (sType[k]!=0 && want[k][t]>=0) lagAt[k][t]=P[k];
      }
    }
  }

  // into the streams, with the waits
  for (size_t t=0; t<nT; t++) {
    if ((int)t==loopTick) {
      for (int k=0; k<nStr; k++) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        loopTok[k]=(int)tok[k].size();
      }
    }
    for (int k=0; k<nStr; k++) {
      std::vector<Tok>& f=perTick[t][k];
      if (!f.empty()) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        tok[k].insert(tok[k].end(),f.begin(),f.end());
      }
      pending[k]++;
    }
  }
  // most SID writes a tick can make (every value stream may write 2 registers): the player only starts
  // working on a tick ahead when its write queue has that much room
  int maxWrites=0;
  {
    int nVal=0;
    for (int k=0; k<nStr; k++) if (sType[k]!=0) nVal++;
    for (size_t t=0; t<nT; t++) {
      int n=2*nVal+4;
      for (int k=0; k<nStr; k++) {
        if (sType[k]==0) n+=perTick[t][k].size();
      }
      if (n>maxWrites) maxWrites=n;
    }
  }
  perTick.clear();
  size_t nCmds=0;
  for (int k=0; k<nStr; k++) {
    putWait(tok[k],pending[k]);
    tok[k].push_back(Tok(1,0xff));
    nCmds+=tok[k].size();
  }
  // streams with nothing in them (unused voices, filter never touched) are left out: less work per tick
  {
    std::vector<int> act;
    for (int k=0; k<nStr; k++) {
      bool used=false;
      for (Tok& c: tok[k]) {
        if (c[0]<0xe0) {
          used=true;
          break;
        }
      }
      if (used || (k==nStr-1 && act.empty())) act.push_back(k);
    }
    std::vector<std::vector<Tok>> tok2;
    std::vector<int> loop2, type2, reg2;
    std::vector<bool> hist2;
    for (int k: act) {
      tok2.push_back(tok[k]);
      loop2.push_back(loopTok[k]);
      type2.push_back(sType[k]);
      reg2.push_back(sReg[k]);
      hist2.push_back(usesHist[k]);
    }
    tok=tok2;
    loopTok=loop2;
    sType=type2;
    sReg=reg2;
    usesHist=hist2;
    nStr=act.size();
  }

  // compress each stream. the ref stacks of all streams share 256 entries, so the deepest streams
  // are packed again with less nesting until they all fit
  progress[0].amount=0.6f;
  // repeated runs that save few bytes cost player time (each reference is a jump), so the packing first
  // keeps only references that save a lot, and accepts smaller ones only if the song does not fit otherwise
  int minGain=1;
  std::vector<int> maxD(nStr,12), depth(nStr,0);
  std::vector<std::vector<unsigned char>> packed(nStr);
  std::vector<int> loopOff(nStr,-1);
  auto packOne=[&](int k, unsigned int base) {
    int d=0, lo=-1;
    packed[k]=pack(tok[k],loopTok[k],base,maxD[k],lo,2,true,&d,128,minGain);
    depth[k]=d;
    loopOff[k]=lo;
  };
  // the player keeps $01=$35, so the streams go after its tables up to $CFFF and from $E000 to $FFF9
  // (biggest first, each where it fits)
  struct Area {
    unsigned int start, end, used;
  };
  std::vector<unsigned int> sStart(nStr,0);
  size_t total=0, cap=(0xd000-SID_DATA)+(SID_END-0xe000);
  auto place=[&]() -> bool {
    std::vector<Area> areas;
    areas.push_back({SID_DATA,0xd000,0});
    areas.push_back({0xe000,SID_END,0});
    std::vector<int> order;
    for (int k=0; k<nStr; k++) order.push_back(k);
    std::sort(order.begin(),order.end(),[&](int x, int y) { return packed[x].size()>packed[y].size(); });
    for (int k: order) {
      bool placed=false;
      for (Area& ar: areas) {
        if (ar.end-ar.start-ar.used>=packed[k].size()) {
          sStart[k]=ar.start+ar.used;
          ar.used+=packed[k].size();
          placed=true;
          break;
        }
      }
      if (!placed) return false;
    }
    return true;
  };
  static const int gains[]={12,8,4,1};
  bool fits=false;
  for (int gi=0; gi<4 && !fits; gi++) {
    minGain=gains[gi];
    progress[0].amount=0.6f+0.025f*gi;
    maxD.assign(nStr,12);
    for (int k=0; k<nStr; k++) packOne(k,0);
    // the ref stacks of all streams share 256 entries: the deepest streams are packed again with
    // less nesting until they all fit
    while (true) {
      int sum=0, big=0;
      for (int k=0; k<nStr; k++) {
        sum+=depth[k];
        if (depth[k]>depth[big]) big=k;
      }
      if (sum<=256) break;
      maxD[big]=depth[big]-1;
      packOne(big,0);
    }
    total=0;
    for (int k=0; k<nStr; k++) total+=packed[k].size();
    fits=place();
  }
  logAppendf("log: %d commands -> %d bytes (%d bytes free); references saving %d+ bytes",(int)nCmds,(int)total,(int)cap,minGain);
  if (!fits) {
    fail(fmt::sprintf(_("the song does not fit in the C64's memory: the log needs %d bytes but only %d are free"),(int)total,(int)cap));
    return;
  }
  for (int k=0; k<nStr; k++) {
    progress[0].amount=0.7f+0.25f*(float)k/(float)nStr;
    size_t before=packed[k].size();
    packOne(k,sStart[k]);
    if (packed[k].size()!=before) {
      fail("internal error: stream size changed when placed");
      return;
    }
  }

  // memory image: player, its tables, then the streams
  std::vector<unsigned char> img(sidDriver,sidDriver+sizeof(sidDriver));
  img.resize(SID_DATA-SID_LOAD,0);
  auto tab=[&](int which, int k) -> unsigned char& {
    return img[SIDDRIVER_TABLES+SID_NS*which+k-SID_LOAD];
  };
  int stackAt=0, histAt=0;
  for (int k=0; k<nStr; k++) {
    tab(ST_PTRL,k)=sStart[k]&0xff;
    tab(ST_PTRH,k)=sStart[k]>>8;
    if (loopOff[k]>=0 && loopTick>=0) {
      tab(ST_LOOPL,k)=(sStart[k]+loopOff[k])&0xff;
      tab(ST_LOOPH,k)=(sStart[k]+loopOff[k])>>8;
    }
    int type=sType[k];
    if (type!=0 && usesHist[k]) {
      type|=0x80;
      tab(ST_HB,k)=histAt;
      histAt+=8;
    }
    tab(ST_TYPE,k)=type;
    tab(ST_REG,k)=sReg[k];
    tab(ST_REG1,k)=sReg[k]+1;
    tab(ST_SP,k)=stackAt;
    stackAt+=depth[k];
    tab(ST_LAG,k)=1;
    tab(ST_APOS,k)=0xff;
    // every stream reads its first commands on tick 0
    tab(ST_NEXT,k)=(k+1<nStr)?(k+1):0xff;
  }
  for (int i=0; i<256; i++) img[SID_BHEAD+i-SID_LOAD]=0xff;
  img[SID_BHEAD-SID_LOAD]=0;
  for (int k=0; k<nStr; k++) {
    size_t at=sStart[k]-SID_LOAD;
    if (img.size()<at+packed[k].size()) img.resize(at+packed[k].size(),0);
    memcpy(&img[at],packed[k].data(),packed[k].size());
  }

  img[SIDDRIVER_NSTR-SID_LOAD]=nStr;
  double clock=pal?985248.0:1022727.0;
  int timer=(int)(clock/tickRate+0.5)-1;
  if (timer>65535) {
    timer=65535;
    logAppend("WARNING: tick rate too low; the song will play faster");
  }
  img[SIDDRIVER_TIMERLO-SID_LOAD]=timer&0xff;
  img[SIDDRIVER_TIMERHI-SID_LOAD]=timer>>8;
  // the player stops working ahead when less than this many 256-cycle pages are left before the next tick
  int margin=3;
  if (margin>(timer>>8)/2) margin=(timer>>8)/2;
  img[SIDDRIVER_MARGIN-SID_LOAD]=margin;
  img[SIDDRIVER_ROOM-SID_LOAD]=(maxWrites<240)?(255-maxWrites):0;
  logAppendf("tick rate %.2fHz; up to %d writes per tick",tickRate,maxWrites);

  // PSID v4 header (big endian)
  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSID",4);
  writeBE16(w,4); // version
  writeBE16(w,0x7c); // data offset
  writeBE16(w,0); // load address: in the data
  writeBE16(w,SID_LOAD); // init: jmp at the start of the player
  writeBE16(w,SID_LOAD+3);
  writeBE16(w,1); // songs
  writeBE16(w,1); // start song
  w->writeC(0); w->writeC(0); w->writeC(0); w->writeC(1); // speed: CIA timer
  putStr(w,e->song.name);
  putStr(w,e->song.author);
  putStr(w,"Registro Gamer Tracker (Furnace)");
  unsigned short flags=(pal?(1<<2):(2<<2))|(model8580?(2<<4):(1<<4));
  if (sys.size()>1) flags|=(model8580?(2<<6):(1<<6));
  if (sys.size()>2) flags|=(model8580?(2<<8):(1<<8));
  writeBE16(w,flags);
  w->writeC(0x04); // start page: the player may use $0400-$07FF (everything else is the song)
  w->writeC(0x04); // page length
  w->writeC(sys.size()>1?0x42:0); // 2nd SID at $D420
  w->writeC(sys.size()>2?0x44:0); // 3rd SID at $D440
  w->writeC(SID_LOAD&0xff);
  w->writeC(SID_LOAD>>8);
  w->write(img.data(),img.size());

  output.push_back(DivROMExportOutput("export.sid",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
