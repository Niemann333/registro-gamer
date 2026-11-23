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
// the player (siddrv.asm) sits at $0800; the register log follows, split in one stream per
// voice (plus one for each SID's filter and volume), each compressed, up to $FFF9 (the RAM under
// I/O and KERNAL is read by switching it in for each byte). CIA 1 timer A sets the tick rate.
//
// log format:
// - $00-$58 vv: write vv to $D400+cmd (2nd SID at $D420, 3rd at $D440)
// - $E0 lo hi nl nh: play nh:nl bytes of log found at hi:lo, then come back (nested up to 3 levels)
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "sid.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>
#include <stdlib.h>

#include "siddrv.inc"

#define SID_LOAD 0x0800
#define SID_END 0xfffa

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
  progress[0].amount=0.5f;
  logAppend("packing the register log...");

  // one stream per voice (3 per SID) and one for each SID's filter and volume:
  // each voice repeats its own patterns, so the streams compress much better than one mixed log
  int nStr=sys.size()*4;
  std::vector<std::vector<Tok>> tok(nStr);
  std::vector<int> pending(nStr,0), loopTok(nStr,-1);
  std::map<unsigned int,unsigned int> last;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      for (int k=0; k<nStr; k++) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        loopTok[k]=(int)tok[k].size();
      }
      last.clear();
    }
    std::vector<std::vector<Tok>> f(nStr);
    for (RGWrite& w: ticks[t]) {
      if (w.addr>0x18) continue;
      int n=0;
      for (size_t k=0; k<sys.size(); k++) if (sys[k]==w.sys) n=k;
      unsigned int reg=w.addr+n*0x20;
      // control registers (gate, test, sync) must be written even when they repeat
      bool always=(w.addr==0x04 || w.addr==0x0b || w.addr==0x12);
      std::map<unsigned int,unsigned int>::iterator it=last.find(reg);
      if (!always && it!=last.end() && it->second==w.val) continue;
      last[reg]=w.val;
      Tok c;
      c.push_back(reg);
      c.push_back(w.val&0xff);
      f[n*4+((w.addr<21)?(w.addr/7):3)].push_back(c);
    }
    for (int k=0; k<nStr; k++) {
      if (!f[k].empty()) {
        putWait(tok[k],pending[k]);
        pending[k]=0;
        tok[k].insert(tok[k].end(),f[k].begin(),f[k].end());
      }
      pending[k]++;
    }
  }
  size_t nCmds=0;
  for (int k=0; k<nStr; k++) {
    putWait(tok[k],pending[k]);
    tok[k].push_back(Tok(1,0xff));
    nCmds+=tok[k].size();
  }

  // memory: player at $0800, then the state of each stream (20 bytes), then the streams up to $FFF9
  unsigned int saveAt=SID_LOAD+sizeof(sidDriver);
  unsigned int dataStart=saveAt+nStr*20;
  std::vector<unsigned char> img(sidDriver,sidDriver+sizeof(sidDriver));
  img.resize(dataStart-SID_LOAD,0);
  std::vector<unsigned char> log;
  for (int k=0; k<nStr; k++) {
    int lo=-1;
    unsigned int start=dataStart+log.size();
    std::vector<unsigned char> o=pack(tok[k],loopTok[k],start,3,lo);
    unsigned char* st=&img[saveAt-SID_LOAD+k*20];
    st[0]=start&0xff;
    st[1]=start>>8;
    if (lo>=0 && loopTick>=0) {
      st[6]=(start+lo)&0xff;
      st[7]=(start+lo)>>8;
    }
    log.insert(log.end(),o.begin(),o.end());
  }
  size_t cap=SID_END-dataStart;
  logAppendf("log: %d commands -> %d bytes (%d bytes free)",(int)nCmds,(int)log.size(),(int)cap);
  if (log.size()>cap) {
    fail(fmt::sprintf(_("the song does not fit in the C64's memory: the log needs %d bytes but only %d are free"),(int)log.size(),(int)cap));
    return;
  }

  img[6]=nStr;
  double clock=pal?985248.0:1022727.0;
  int timer=(int)(clock/tickRate+0.5);
  if (timer>65535) {
    timer=65535;
    logAppend("WARNING: tick rate too low; the song will play faster");
  }
  img[7]=timer&0xff;
  img[8]=timer>>8;
  img.insert(img.end(),log.begin(),log.end());

  // PSID v4 header (big endian)
  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSID",4);
  writeBE16(w,4); // version
  writeBE16(w,0x7c); // data offset
  writeBE16(w,0); // load address: in the data
  writeBE16(w,SID_LOAD);
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
