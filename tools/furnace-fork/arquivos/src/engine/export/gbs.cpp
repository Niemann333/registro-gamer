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

// Registro Gamer: GBS export (Game Boy).
// the player (gbsdrv.asm) sits at $0400 in bank 0; the register log fills ROM banks
// 1 and up, read through $4000-$7FFF. the timer interrupt sets the tick rate.
//
// log format:
// - $00-$2F vv: write vv to $FF10+cmd
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "gbs.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>

#include "gbsdrv.inc"

#define GBS_LOAD 0x400
#define GBS_INIT 0x400
#define GBS_PLAY 0x43e

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

static void putStr(SafeWriter* w, const String& str) {
  char buf[32];
  memset(buf,0,32);
  strncpy(buf,str.c_str(),31);
  w->write(buf,32);
}

void DivExportGBS::run() {
  int sysGB=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    if (e->song.system[i]==DIV_SYSTEM_GB && sysGB<0) {
      sysGB=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the Game Boy sound; ignored",i,e->getSystemName(e->song.system[i]));
    }
  }
  if (sysGB<0) {
    fail(_("no Game Boy chip in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysGB);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;
  logAppend("packing the register log...");

  std::vector<unsigned char> s;
  int loopOfs=-1, pending=0;
  std::map<unsigned int,unsigned int> last;
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(s,pending);
      pending=0;
      loopOfs=(int)s.size();
      last.clear();
    }
    std::vector<unsigned char> f;
    for (RGWrite& w: ticks[t]) {
      if (w.addr<0x10 || w.addr>0x3f) continue;
      // triggers, wave channel on/off and master on/off act even when the value repeats
      bool always=(w.addr==0x14 || w.addr==0x19 || w.addr==0x1a || w.addr==0x1e || w.addr==0x23 || w.addr==0x26);
      std::map<unsigned int,unsigned int>::iterator it=last.find(w.addr);
      if (!always && it!=last.end() && it->second==w.val) continue;
      last[w.addr]=w.val;
      f.push_back(w.addr-0x10);
      f.push_back(w.val&0xff);
    }
    if (!f.empty()) {
      putWait(s,pending);
      pending=0;
      s.insert(s.end(),f.begin(),f.end());
    }
    pending++;
  }
  putWait(s,pending);
  s.push_back(0xff);

  int banks=(s.size()+16383)/16384;
  if (banks>255) {
    fail(fmt::sprintf(_("the song is too big for a GBS (%d KB of the 4080 KB limit)"),banks*16));
    return;
  }
  logAppendf("log: %d bytes (%d banks of 16KB)",(int)s.size(),banks);

  // bank 0 from $0400: player
  std::vector<unsigned char> rom(0x4000-GBS_LOAD,0);
  memcpy(rom.data(),gbsDriver,sizeof(gbsDriver));
  if (loopOfs>=0) {
    rom[0xf0]=1;
    rom[0xf1]=1+loopOfs/16384;
    rom[0xf2]=(0x4000+(loopOfs%16384))&0xff;
    rom[0xf3]=(0x4000+(loopOfs%16384))>>8;
  }
  rom.insert(rom.end(),s.begin(),s.end());
  while ((rom.size()+GBS_LOAD)%16384) rom.push_back(0);

  // timer interrupt at 4096Hz/(256-TMA)
  int div=(int)(4096.0/tickRate+0.5);
  if (div<1) div=1;
  if (div>256) {
    div=256;
    logAppend("WARNING: tick rate below 16Hz; the song will play faster");
  }

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("GBS",3);
  w->writeC(1); // version
  w->writeC(1); // songs
  w->writeC(1); // first song
  w->writeS(GBS_LOAD);
  w->writeS(GBS_INIT);
  w->writeS(GBS_PLAY);
  w->writeS(0xfffe); // stack
  w->writeC((256-div)&0xff); // TMA
  w->writeC(0x04); // TAC: timer on, 4096Hz
  putStr(w,e->song.name);
  putStr(w,e->song.author);
  putStr(w,"Registro Gamer Tracker (Furnace)");
  w->write(rom.data(),rom.size());

  output.push_back(DivROMExportOutput("export.gbs",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
