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


// Registro Gamer: 2SF export (Nintendo DS).
// the 2SF holds a DS cartridge image: the ARM9 binary (an idle loop, followed by the samples and the
// register log, all copied to main RAM at 02000000h) and the ARM7 binary (ndsdrv.s, in ARM7 WRAM),
// which replays the log on the DS sound registers. a tick happens when timer 0 (33.5MHz/64) has
// counted the length of a tick (kept as a fraction, so the average speed is exact).
//
// log format:
// - $00-$CF vv: write vv to sound register 04000400h+cmd
// - $D0 rr vv: same, for registers $00-$FF
// - $D1 rr vv: same, for registers $100-$1FF
// - $D2 cc o0 o1 o2: set the sample address of channel cc (offset in the sample memory)
// - $D3 rr lo hi: 16-bit write (timer, loop start); $D4 rr b0 b1 b2: 32-bit write (length)
//   (the emulators used by 2SF players ignore byte writes to these registers)
// - $E0 a0 a1 a2 nl nh: play nh:nl bytes of log found at offset a2:a1:a0, then come back
// - $F0-$FD: end of tick, then wait cmd-$F0 more ticks
// - $FE nn: end of tick, then wait nn more ticks
// - $FF: jump to the loop point (or stop if the song ends)

#include "nds2sf.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <zlib.h>
#include <map>
#include <math.h>

#include "ndsdrv.inc"

#define NDS_ARM9_RAM 0x02000000
#define NDS_SAMPLES 0x02000400
#define NDS_RAM_LIMIT 0x023f0000
#define NDS_ARM7_RAM 0x03800000
#define NDS_REFSTACK 0x0380e000
#define NDS_TIMER_HZ (33513982.0/64.0)

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

static unsigned short crc16(const unsigned char* d, size_t n) {
  unsigned int c=0xffff;
  for (size_t i=0; i<n; i++) {
    c^=d[i];
    for (int k=0; k<8; k++) c=(c&1)?((c>>1)^0xa001):(c>>1);
  }
  return c&0xffff;
}

void DivExport2SF::run() {
  int sysNDS=-1;
  for (int i=0; i<e->song.systemLen; i++) {
    if (e->song.system[i]==DIV_SYSTEM_NDS && sysNDS<0) {
      sysNDS=i;
    } else {
      logAppendf("WARNING: chip %d (%s) is not part of the Nintendo DS sound; ignored",i,e->getSystemName(e->song.system[i]));
    }
  }
  if (sysNDS<0) {
    fail(_("no Nintendo DS chip in this song"));
    return;
  }
  std::vector<int> sys;
  sys.push_back(sysNDS);
  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.5f;
  logAppend("packing the register log...");

  std::vector<Tok> tok;
  int loopTok=-1, pending=0;
  std::map<unsigned int,unsigned int> last;
  unsigned int sad[16], wide[256];
  memset(sad,0,sizeof(sad));
  memset(wide,0,sizeof(wide));
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(tok,pending);
      pending=0;
      loopTok=(int)tok.size();
      last.clear();
    }
    std::vector<Tok> f;
    for (RGWrite& w: ticks[t]) {
      unsigned int a=w.addr, v=w.val&0xff;
      if (a>=0x200) continue;
      Tok c;
      if (a<0x100 && (a&15)>=4 && (a&15)<=7) {
        // sample address: the 4 bytes come in order; sent once complete, relative to the samples
        int ch=a>>4;
        int sh=((a&15)-4)*8;
        sad[ch]=(sad[ch]&~(0xffu<<sh))|(v<<sh);
        if ((a&15)!=7) continue;
        unsigned int off=sad[ch]&0xfffffc;
        c.push_back(0xd2);
        c.push_back(ch);
        c.push_back(off&0xff);
        c.push_back((off>>8)&0xff);
        c.push_back((off>>16)&0xff);
        f.push_back(c);
        continue;
      }
      if (a<0x100 && (a&15)>=8) {
        // timer (8-9), loop start (A-B), length (C-F): bytes come in order, sent as one write
        unsigned int r=(a&15)>=0xc?(a&0xfc):(a&0xfe);
        int sh=(a-r)*8;
        wide[r]=(wide[r]&~(0xffu<<sh))|(v<<sh);
        bool lastByte=((a&15)>=0xc)?((a&3)==3):((a&1)==1);
        if (!lastByte) continue;
        unsigned int key=0x1000+r;
        std::map<unsigned int,unsigned int>::iterator it=last.find(key);
        if (it!=last.end() && it->second==wide[r]) continue;
        last[key]=wide[r];
        if ((a&15)>=0xc) {
          c.push_back(0xd4);
          c.push_back(r);
          c.push_back(wide[r]&0xff);
          c.push_back((wide[r]>>8)&0xff);
          c.push_back((wide[r]>>16)&0xff);
        } else {
          c.push_back(0xd3);
          c.push_back(r);
          c.push_back(wide[r]&0xff);
          c.push_back((wide[r]>>8)&0xff);
        }
        f.push_back(c);
        continue;
      }
      // master volume at half: the DS mixer (and the emulators of the 2SF players) is twice as loud
      // as the Tracker's DS core, and clips; this keeps the level heard in the Tracker
      if (a==0x100) v=(v&0x7f)>>1;
      bool always=(a<0x100 && (a&15)==3);
      std::map<unsigned int,unsigned int>::iterator it=last.find(a);
      if (!always && it!=last.end() && it->second==v) continue;
      last[a]=v;
      if (a<0xd0) {
        c.push_back(a);
      } else if (a<0x100) {
        c.push_back(0xd0);
        c.push_back(a);
      } else {
        c.push_back(0xd1);
        c.push_back(a-0x100);
      }
      c.push_back(v);
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

  // ARM9 binary: idle loop, samples, log
  std::vector<unsigned char> arm9(NDS_SAMPLES-NDS_ARM9_RAM,0);
  put32(arm9,0,0xeafffffe);
  size_t smpLen=0;
  const unsigned char* smpMem=sampleMem(sysNDS,0,smpLen);
  if (smpMem!=NULL && smpLen>0) arm9.insert(arm9.end(),smpMem,smpMem+smpLen);
  while (arm9.size()&3) arm9.push_back(0);
  unsigned int logAddr=NDS_ARM9_RAM+arm9.size();
  arm9.insert(arm9.end(),log.begin(),log.end());
  while (arm9.size()&3) arm9.push_back(0);
  logAppendf("samples: %d bytes; log: %d commands -> %d bytes",(int)smpLen,(int)tok.size(),(int)log.size());
  if (NDS_ARM9_RAM+arm9.size()>NDS_RAM_LIMIT) {
    fail(fmt::sprintf(_("the song does not fit in the 4MB of the Nintendo DS's RAM (%d KB)"),(int)(arm9.size()/1024)));
    return;
  }

  // ARM7 binary: the player
  std::vector<unsigned char> arm7(sizeof(ndsDriver),0);
  memcpy(arm7.data(),ndsDriver,sizeof(ndsDriver));
  double period=NDS_TIMER_HZ*256.0/tickRate;
  if (period>4e9) period=4e9;
  put32(arm7,4,logAddr);
  put32(arm7,8,(loopOut>=0)?(logAddr+loopOut):0);
  put32(arm7,12,(unsigned int)(period+0.5));
  put32(arm7,16,NDS_SAMPLES);
  put32(arm7,20,NDS_REFSTACK);
  while (arm7.size()&3) arm7.push_back(0);

  // cartridge: header, ARM9, ARM7
  std::vector<unsigned char> rom(0x200,0);
  memcpy(&rom[0],"REGISTROGAME",12);
  memcpy(&rom[0x0c],"RGTK",4);
  memcpy(&rom[0x10],"01",2);
  unsigned int arm9Off=0x200;
  rom.insert(rom.end(),arm9.begin(),arm9.end());
  while (rom.size()&0x1ff) rom.push_back(0);
  unsigned int arm7Off=rom.size();
  rom.insert(rom.end(),arm7.begin(),arm7.end());
  while (rom.size()&0x1ff) rom.push_back(0);
  put32(rom,0x20,arm9Off);
  put32(rom,0x24,NDS_ARM9_RAM);
  put32(rom,0x28,NDS_ARM9_RAM);
  put32(rom,0x2c,arm9.size());
  put32(rom,0x30,arm7Off);
  put32(rom,0x34,NDS_ARM7_RAM);
  put32(rom,0x38,NDS_ARM7_RAM);
  put32(rom,0x3c,arm7.size());
  put32(rom,0x80,rom.size());
  put32(rom,0x84,0x200);
  unsigned short hc=crc16(rom.data(),0x15e);
  rom[0x15e]=hc&0xff;
  rom[0x15f]=hc>>8;

  // 2SF program: load offset, size, ROM
  std::vector<unsigned char> prog(8,0);
  put32(prog,0,0);
  put32(prog,4,rom.size());
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

  double secs=(double)ticks.size()/tickRate;
  if (loopOut>=0 && loopTick>=0) secs+=(double)(ticks.size()-loopTick)/tickRate;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("PSF\x24",4);
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
  tags+="2sfby=Registro Gamer Tracker (Furnace)\n";
  w->writeText(tags);

  output.push_back(DivROMExportOutput("export.2sf",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
