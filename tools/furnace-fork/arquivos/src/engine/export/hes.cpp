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

// Registro Gamer: HES export (PC Engine / TurboGrafx-16).
// the player (hesdrv.asm, HuC6280) sits in physical bank 0, seen at $E000; the register log fills
// banks 1 and up, read through $4000-$5FFF. the HuC6280 timer interrupt drives a 24-bit accumulator,
// so any tick rate works.
//
// log format:
// - $00-$09 vv: write vv to PSG register $0800+cmd
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $E0 a0 a1 a2 n0 n1: play n bytes found at offset a of the log, then come back (nested up to 8)
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "hes.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>

typedef std::vector<unsigned char> Tok;

#include "hesdrv.inc"

#define HES_BANK 0x2000

void DivExportHES::run() {
  int sysPCE=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    if (e->song.system[i]==DIV_SYSTEM_PCE && sysPCE<0) {
      sysPCE=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the PC Engine sound; ignored",i,e->getSystemName(e->song.system[i]));
    }
  }
  if (sysPCE<0) {
    fail(_("no PC Engine chip in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysPCE);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;
  logAppend("packing the register log...");

  // PSG registers 2, 3, 5 and 7 belong to the selected channel (register 0): a write that changes nothing is
  // dropped, and the channel is only selected again when needed. registers 4 (control) and 6 (wave/DAC data)
  // act on every write, so all of them stay
  std::vector<Tok> tok;
  int loopTok=-1, pending=0, busiest=0;
  int sel=-1, outSel=-1;
  int chReg[8][16];
  int glob[16];
  auto forget=[&]() {
    for (int c=0; c<8; c++) for (int r=0; r<16; r++) chReg[c][r]=-1;
    for (int r=0; r<16; r++) glob[r]=-1;
    outSel=-1;
  };
  forget();
  auto putW=[&](std::vector<Tok>& out, int frames) {
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
  };
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putW(tok,pending);
      pending=0;
      loopTok=tok.size();
      forget();
    }
    std::vector<Tok> f;
    int n=0;
    for (RGWrite& w: ticks[t]) {
      if (w.addr>9) continue;
      int r=w.addr, v=w.val&0xff;
      n++;
      if (r==0) {
        sel=v&7;
        continue;
      }
      bool perChan=(r>=2 && r<=7);
      if (perChan && sel<0) sel=0;
      if (r==2 || r==3 || r==5 || r==7) {
        if (chReg[sel][r]==v) continue;
        chReg[sel][r]=v;
      } else if (!perChan) {
        if (glob[r]==v) continue;
        glob[r]=v;
      }
      if (perChan && outSel!=sel) {
        Tok c;
        c.push_back(0);
        c.push_back(sel);
        f.push_back(c);
        outSel=sel;
      }
      Tok c;
      c.push_back(r);
      c.push_back(v);
      f.push_back(c);
    }
    if (n>busiest) busiest=n;
    if (!f.empty()) {
      putW(tok,pending);
      pending=0;
      tok.insert(tok.end(),f.begin(),f.end());
    }
    pending++;
  }
  putW(tok,pending);
  tok.push_back(Tok(1,0xff));
  if (busiest>300) {
    logAppend("WARNING: some ticks write a lot (PCM samples?): sample playback is only as fine as the tick rate");
  }
  int loopOut=-1;
  std::vector<unsigned char> s;
  if (getenv("RG_NOPACK")) {
    for (size_t i=0; i<tok.size(); i++) {
      if ((int)i==loopTok) loopOut=s.size();
      s.insert(s.end(),tok[i].begin(),tok[i].end());
    }
  } else {
    s=pack(tok,loopTok,0,8,loopOut,3);
  }
  int loopOfs=(loopTick>=0)?loopOut:-1;
  int banks=(s.size()+HES_BANK-1)/HES_BANK;
  if (banks>127) {
    fail(fmt::sprintf(_("the song is too big for a HES (%d KB of the 1016 KB limit)"),banks*8));
    return;
  }
  logAppendf("log: %d bytes (%d banks of 8KB)",(int)s.size(),banks);

  // bank 0: player and the interrupt vectors
  std::vector<unsigned char> rom(HES_BANK,0);
  memcpy(rom.data(),hesDriver,sizeof(hesDriver));
  auto vec=[&](int at, int addr) {
    rom[at-0xe000]=addr&0xff;
    rom[at-0xe000+1]=addr>>8;
  };
  vec(0xfff6,HESDRIVER_NOIRQ);
  vec(0xfff8,HESDRIVER_NOIRQ);
  vec(0xfffa,HESDRIVER_TIRQ);
  vec(0xfffc,HESDRIVER_NOIRQ);
  vec(0xfffe,HESDRIVER_INIT);
  if (loopOfs>=0) {
    rom[HESDRIVER_LOOPB-0xe000]=1+loopOfs/HES_BANK;
    rom[HESDRIVER_LOOPL-0xe000]=(0x4000+(loopOfs%HES_BANK))&0xff;
    rom[HESDRIVER_LOOPH-0xe000]=(0x4000+(loopOfs%HES_BANK))>>8;
  }
  // timer at about 4 times the tick rate (7.16MHz/1024/(N+1)), the accumulator does the rest
  double timerBase=7159090.0/1024.0;
  int n=(int)(timerBase/(tickRate*4.0)+0.5)-1;
  if (n<0) n=0;
  if (n>127) n=127;
  double timerHz=timerBase/(n+1);
  double rateD=tickRate/timerHz*16777216.0;
  if (rateD>16777215.0) {
    rateD=16777215.0;
    logAppend("WARNING: tick rate too high; the song will play slower");
  }
  unsigned int rate=(unsigned int)(rateD+0.5);
  rom[HESDRIVER_TIMERN-0xe000]=n;
  rom[HESDRIVER_RATE-0xe000]=rate&0xff;
  rom[HESDRIVER_RATE-0xe000+1]=(rate>>8)&0xff;
  rom[HESDRIVER_RATE-0xe000+2]=(rate>>16)&0xff;
  rom.insert(rom.end(),s.begin(),s.end());
  while (rom.size()%HES_BANK) rom.push_back(0);

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("HESM",4);
  w->writeC(0); // version
  w->writeC(0); // first song
  w->writeS(HESDRIVER_INIT);
  static const unsigned char mpr[8]={0xff,0xf8,0x01,0x00,0x00,0x00,0x00,0x00};
  w->write(mpr,8);
  w->write("DATA",4);
  w->writeI(rom.size());
  w->writeI(0); // load address
  w->writeI(0);
  w->write(rom.data(),rom.size());

  output.push_back(DivROMExportOutput("export.hes",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
