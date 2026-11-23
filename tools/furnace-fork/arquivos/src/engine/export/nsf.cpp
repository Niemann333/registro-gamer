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

// Registro Gamer: NSF export (NES + FDS/VRC6/VRC7/N163/MMC5).
// the file is a bankswitched NSF: bank 0 holds the player (nsfdrv.asm), the register
// log follows from bank 1 (read through $9000-$9FFF) and the DPCM sample memory comes
// last, mapped at $C000-$FFFF in 16KB pages as the song switches them.
//
// log format (one byte command + operands):
// - $00-$17 vv: write vv to $4000+cmd
// - $80 lo hi vv: write vv to address hi:lo (FDS, VRC6, MMC5)
// - $81 rr vv: VRC7 register rr
// - $82 aa vv: N163 internal RAM aa
// - $83 bb: DPCM page bb (16KB) at $C000
// - $F0-$FD: end of frame, then wait cmd-$F0 more frames
// - $FE nn: end of frame, then wait nn more frames
// - $FF: jump to the loop point (or stop if the song ends)

#include "nsf.h"
#include "../engine.h"
#include "../ta-log.h"
#include <fmt/printf.h>
#include <map>

#include "nsfdrv.inc"

#define NSF_INIT 0x8010
#define NSF_PLAY 0x8077

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

void DivExportNSF::run() {
  int sysNES=-1, sysFDS=-1, sysVRC6=-1, sysVRC7=-1, sysN163=-1, sysMMC5=-1;
  std::vector<int> sys;
  for (int i=0; i<e->song.systemLen; i++) {
    int* slot=NULL;
    switch (e->song.system[i]) {
      case DIV_SYSTEM_NES: case DIV_SYSTEM_5E01: slot=&sysNES; break;
      case DIV_SYSTEM_FDS: slot=&sysFDS; break;
      case DIV_SYSTEM_VRC6: slot=&sysVRC6; break;
      case DIV_SYSTEM_VRC7: slot=&sysVRC7; break;
      case DIV_SYSTEM_N163: slot=&sysN163; break;
      case DIV_SYSTEM_MMC5: slot=&sysMMC5; break;
      default: break;
    }
    if (slot==NULL) {
      logAppendf("WARNING: chip %d (%s) does not exist on the NES; ignored",i,e->getSystemName(e->song.system[i]));
      continue;
    }
    if (*slot>=0) {
      logAppendf("WARNING: second %s ignored (an NSF has only one of each)",e->getSystemName(e->song.system[i]));
      continue;
    }
    *slot=i;
    sys.push_back(i);
  }
  if (sys.empty()) {
    fail(_("no NES chips in this song"));
    return;
  }

  if (!capture(sys)) {
    fail("aborted");
    return;
  }
  progress[0].amount=0.6f;
  logAppend("packing the register log...");

  // build the log
  std::vector<unsigned char> s;
  int loopOfs=-1, pending=0, maxPage=-1;
  bool streamPCM=false;
  // last value of each register, to drop writes that change nothing
  std::map<unsigned int,unsigned int> last;
  auto sideEffect=[&](const RGWrite& w) -> bool {
    if (w.sys==sysNES) return (w.addr==0x4003 || w.addr==0x4007 || w.addr==0x400b || w.addr==0x400f || w.addr==0x4011 || w.addr>=0x4015);
    if (w.sys==sysFDS) return w.addr>=0x4080;
    if (w.sys==sysMMC5) return (w.addr==0x5003 || w.addr==0x5007 || w.addr>=0x5010);
    return false;
  };
  for (size_t t=0; t<ticks.size(); t++) {
    if ((int)t==loopTick) {
      putWait(s,pending);
      pending=0;
      loopOfs=(int)s.size();
      // the player jumps here from the end of the song: don't trust what came before
      last.clear();
    }
    std::vector<unsigned char> f;
    for (RGWrite& w: ticks[t]) {
      if (w.addr<0x10000) {
        unsigned int key=(w.sys<<16)|w.addr;
        std::map<unsigned int,unsigned int>::iterator it=last.find(key);
        if (it!=last.end() && it->second==w.val && !sideEffect(w)) continue;
        last[key]=w.val;
      }
      if (w.sys==sysNES) {
        if (w.addr==0xffff0004) {
          f.push_back(0x83);
          f.push_back(w.val&0xff);
          if ((int)w.val>maxPage) maxPage=w.val;
        } else if (w.addr>=0x4000 && w.addr<=0x4017 && w.addr!=0x4014 && w.addr!=0x4016) {
          f.push_back(w.addr-0x4000);
          f.push_back(w.val&0xff);
        }
      } else if (w.sys==sysVRC7) {
        if (w.addr<0x40) {
          f.push_back(0x81);
          f.push_back(w.addr);
          f.push_back(w.val&0xff);
        }
      } else if (w.sys==sysN163) {
        if (w.addr<0x80) {
          f.push_back(0x82);
          f.push_back(w.addr);
          f.push_back(w.val&0xff);
        }
      } else if (w.addr<0x10000) {
        bool okAddr=false;
        if (w.sys==sysFDS) okAddr=(w.addr>=0x4040 && w.addr<=0x4097);
        if (w.sys==sysVRC6) okAddr=(w.addr>=0x9000 && w.addr<=0xb002);
        if (w.sys==sysMMC5) okAddr=(w.addr>=0x5000 && w.addr<=0x5015);
        if (okAddr) {
          f.push_back(0x80);
          f.push_back(w.addr&0xff);
          f.push_back(w.addr>>8);
          f.push_back(w.val&0xff);
        }
      } else if (w.sys==sysVRC6 && w.addr>=0xffff0000 && w.addr<0xfffffffe && (w.addr&0xff)==0) {
        streamPCM=true;
      }
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
  if (streamPCM) logAppend("WARNING: VRC6 PCM mode is streamed sample by sample and is not exported");

  // sample memory (DPCM)
  size_t dpcmLen=0;
  const unsigned char* dpcm=NULL;
  if (sysNES>=0) {
    dpcm=sampleMem(sysNES,0,dpcmLen);
    if (dpcm==NULL) dpcmLen=0;
  }
  if (maxPage<0 && dpcmLen>0) maxPage=0;
  if (dpcmLen>0 && (size_t)(maxPage+1)*16384<dpcmLen) maxPage=(dpcmLen-1)/16384;

  int logBanks=(s.size()+4095)/4096;
  int dpcmBase=1+logBanks;
  int dpcmBanks=(maxPage>=0)?(maxPage+1)*4:0;
  int totalBanks=dpcmBase+dpcmBanks;
  if (totalBanks>256) {
    fail(fmt::sprintf(_("the song is too big for an NSF (%d KB of the 1024 KB limit)"),totalBanks*4));
    return;
  }
  logAppendf("log: %d bytes (%d banks), DPCM: %d bytes",(int)s.size(),logBanks,(int)dpcmLen);

  // player bank
  unsigned char drv[4096];
  memset(drv,0,4096);
  memcpy(drv,nsfDriver,sizeof(nsfDriver));
  if (loopOfs>=0) {
    drv[0]=1+loopOfs/4096;
    drv[1]=(0x9000+(loopOfs&4095))&0xff;
    drv[2]=(0x9000+(loopOfs&4095))>>8;
    drv[3]=1;
  }
  drv[4]=(dpcmBanks>0)?dpcmBase:0;

  // header
  bool pal=false;
  if (sysNES>=0) pal=(e->song.systemFlags[sysNES].getInt("clockSel",0)==1);
  unsigned short speed=(unsigned short)MIN(65535,(int)(1000000.0/tickRate+0.5));
  unsigned char exp=0;
  if (sysVRC6>=0) exp|=1;
  if (sysVRC7>=0) exp|=2;
  if (sysFDS>=0) exp|=4;
  if (sysMMC5>=0) exp|=8;
  if (sysN163>=0) exp|=16;

  SafeWriter* w=new SafeWriter;
  w->init();
  w->write("NESM\x1a",5);
  w->writeC(1); // version
  w->writeC(1); // songs
  w->writeC(1); // first song
  w->writeS(0x8000); // load
  w->writeS(NSF_INIT);
  w->writeS(NSF_PLAY);
  putStr(w,e->song.name.empty()?"Furnace":e->song.name);
  putStr(w,e->song.author);
  putStr(w,e->song.systemName.empty()?"Registro Gamer Tracker":e->song.systemName);
  w->writeS(speed); // NTSC speed
  unsigned char banks[8]={0,1,0,0,0,0,0,0};
  if (dpcmBanks>0) for (int i=0; i<4; i++) banks[4+i]=dpcmBase+i;
  w->write(banks,8);
  w->writeS(speed); // PAL speed
  w->writeC(pal?1:0);
  w->writeC(exp);
  w->writeI(0);

  // data
  w->write(drv,4096);
  w->write(s.data(),s.size());
  for (size_t i=s.size(); i<(size_t)logBanks*4096; i++) w->writeC(0);
  if (dpcmBanks>0) {
    std::vector<unsigned char> d(dpcmBanks*4096,0);
    if (dpcm!=NULL) memcpy(d.data(),dpcm,MIN(dpcmLen,d.size()));
    w->write(d.data(),d.size());
  }

  output.push_back(DivROMExportOutput("export.nsf",w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
