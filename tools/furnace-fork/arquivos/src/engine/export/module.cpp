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

// Registro Gamer: "faithful" module export (MOD, S3M, XM, IT, MPTM).
// the song is played once and the state of every sample channel is recorded on every tick
// (sample, frequency, volume, panning, note starts). the module then plays one row per tick:
// a note starts the sample, the volume column holds the volume (or panning) and the effect column
// follows the pitch with fine slides (or regular slides, at speed 2), so macros, arpeggios, vibratos
// and slides all sound as in Furnace. the patterns are not meant for editing.

#include "module.h"
#include "../engine.h"
#include "../ta-log.h"
#include "../platform/amiga.h"
#include "../platform/pcmdac.h"
#include <fmt/printf.h>
#include <math.h>
#include <map>
#include <algorithm>
#include <string.h>

namespace {

// one sample of the module
struct MSmp {
  std::vector<short> data;
  bool bits16;
  int loopStart, loopEnd; // frames; loopEnd is exclusive
  int loopType; // 0: none, 1: forward, 2: ping-pong
  String name;
  bool isWave;
  double scale; // the data was resampled: play at freq/scale, offsets/scale
  long long uses;
  std::vector<double> freqs; // playback rates at note starts (for tuning)
  // tuning (filled in later): base0 = pitch (in model units) of note index 0
  double ref;
  int c5; // IT/S3M rate of the reference note
  int rel, fine; // XM relative note and finetune; MOD finetune in fine
  MSmp(): bits16(false), isWave(false), scale(1.0), uses(0), loopStart(0), loopEnd(0), loopType(0), ref(8363), c5(8363), rel(0), fine(0) {}
};

// state of one channel at one tick
struct MState {
  int smp;
  double freq;
  int vol, pan;
  bool trig;
  int off;
  MState(): smp(-1), freq(0), vol(0), pan(32), trig(false), off(0) {}
};

struct MSrc {
  int sys, ch, gch;
  DivSystem type;
};

// generic pattern cell
enum {
  FX_NONE=0,
  FX_OFFSET, // val: offset in units of 256 frames
  FX_PAN, // val: 0-64
  FX_SLIDE_XF, // val: signed amount (extra fine)
  FX_SLIDE_F, // val: signed amount (fine)
  FX_SLIDE_R, // val: signed amount (regular)
  FX_VOL, // val: 0-64 (MOD only)
  FX_JUMP, // val: order
  FX_BREAK, // val: row
  FX_ARP, // val: xy
  FX_TONEPORTA, // val: speed
  FX_VIBRATO, // val: xy
  FX_TREMOLO, // val: xy
  FX_VOLSLIDE, // val: signed amount per tick
  FX_FINEVOL, // val: signed amount (once)
  FX_SPEED, // val: ticks per row
  FX_TEMPO, // val: tempo
  FX_NOTECUT, // val: tick
  FX_NOTEDELAY, // val: tick
  FX_RETRIG // val: ticks
};

#define NOTE_NONE -1
#define NOTE_CUT -2
#define NOTE_OFF -3

// volume column kinds
enum {
  VC_NONE=0,
  VC_VOL,
  VC_PAN,
  VC_SLIDE_UP,
  VC_SLIDE_DOWN,
  VC_FINE_UP,
  VC_FINE_DOWN,
  VC_PORTA
};

struct Cell {
  int note, ins, vtype, vval, fx, fv;
  Cell(): note(NOTE_NONE), ins(0), vtype(0), vval(0), fx(FX_NONE), fv(0) {}
  bool operator<(const Cell& o) const {
    if (note!=o.note) return note<o.note;
    if (ins!=o.ins) return ins<o.ins;
    if (vtype!=o.vtype) return vtype<o.vtype;
    if (vval!=o.vval) return vval<o.vval;
    if (fx!=o.fx) return fx<o.fx;
    return fv<o.fv;
  }
  bool operator==(const Cell& o) const {
    return note==o.note && ins==o.ins && vtype==o.vtype && vval==o.vval && fx==o.fx && fv==o.fv;
  }
};

struct FmtSpec {
  const char* name;
  const char* ext;
  int maxChans, maxSamples, maxRows, fixedRows, maxOrders, maxPatterns, maxTempo, maxNote;
  bool hasVolCol, hasExtraFine, periods, hasRestart;
  int maxOffset; // in units of 256 frames
  int maxRegular; // biggest regular slide parameter
};

const FmtSpec specs[5]={
  // name, ext, chans, samples, rows, fixed, orders, patterns, tempo, notes, volcol, xfine, periods, restart, offset, regular
  {"MOD", ".mod", 32, 31, 64, 64, 128, 100, 255, 36, false, false, true, false, 255, 255},
  {"S3M", ".s3m", 32, 99, 64, 64, 255, 100, 255, 96, true, true, true, false, 255, 0xdf},
  {"XM", ".xm", 32, 128, 256, 0, 256, 256, 255, 96, true, true, false, true, 255, 255},
  {"IT", ".it", 64, 240, 200, 0, 255, 240, 255, 120, true, true, false, false, 255, 0xdf},
  {"MPTM", ".mptm", 64, 240, 1024, 0, 255, 240, 1000, 120, true, true, false, false, 255, 0xdf},
};

// ProTracker periods (finetune 0), notes C-1 to B-3
const int ptPeriods[36]={
  856,808,762,720,678,640,604,570,538,508,480,453,
  428,404,381,360,340,320,302,285,269,254,240,226,
  214,202,190,180,170,160,151,143,135,127,120,113
};

#define MOD_CLOCK 3546895.0
#define S3M_CLOCK 14317056.0

}

namespace {


// effect in the format's own numbering. returns false if the format has no such effect.
// MOD/XM: 0-F (+ XM 33 = X); S3M/IT: letters, A=1.
bool encFx(int fmt, int kind, int v, int& cmd, int& par) {
  bool pt=(fmt==RG_FMT_MOD || fmt==RG_FMT_XM);
  int av=abs(v);
  auto bcd=[](int x) { x=MIN(63,MAX(0,x)); return ((x/10)<<4)|(x%10); };
  cmd=-1;
  par=0;
  switch (kind) {
    case FX_NONE: return false;
    case FX_OFFSET: cmd=pt?9:15; par=MIN(255,v); break;
    case FX_PAN:
      if (fmt==RG_FMT_S3M) {
        cmd=19;
        par=0x80|MIN(15,(v*15+32)/64);
      } else {
        cmd=pt?8:24;
        par=MIN(255,v*4);
      }
      break;
    case FX_SLIDE_XF:
      if (fmt==RG_FMT_MOD) return false;
      if (fmt==RG_FMT_XM) {
        cmd=33;
        par=((v>0)?0x10:0x20)|MIN(15,av);
      } else {
        cmd=(v>0)?6:5;
        par=0xe0|MIN(15,av);
      }
      break;
    case FX_SLIDE_F:
      if (pt) {
        cmd=14;
        par=((v>0)?0x10:0x20)|MIN(15,av);
      } else {
        cmd=(v>0)?6:5;
        par=0xf0|MIN(15,av);
      }
      break;
    case FX_SLIDE_R:
      if (pt) {
        cmd=(v>0)?1:2;
        par=MIN(255,av);
      } else {
        cmd=(v>0)?6:5;
        par=MIN(0xdf,av);
      }
      break;
    case FX_VOL: if (fmt!=RG_FMT_MOD && fmt!=RG_FMT_XM) return false; cmd=12; par=MIN(64,MAX(0,v)); break;
    case FX_JUMP: cmd=pt?11:2; par=MIN(255,MAX(0,v)); break;
    case FX_BREAK: cmd=pt?13:3; par=(fmt==RG_FMT_IT || fmt==RG_FMT_MPTM)?MIN(255,v):bcd(v); break;
    case FX_ARP: cmd=pt?0:10; par=v&0xff; if (pt && par==0) return false; break;
    case FX_TONEPORTA: cmd=pt?3:7; par=MIN(255,MAX(1,v)); break;
    case FX_VIBRATO: cmd=pt?4:8; par=v&0xff; break;
    case FX_TREMOLO: cmd=pt?7:18; par=v&0xff; break;
    case FX_VOLSLIDE:
      cmd=pt?10:4;
      if (pt) {
        par=(v>0)?(MIN(15,av)<<4):MIN(15,av);
      } else {
        par=(v>0)?(MIN(14,av)<<4):MIN(14,av);
      }
      if (av==0) return false;
      break;
    case FX_FINEVOL:
      if (av==0) return false;
      if (pt) {
        cmd=14;
        par=((v>0)?0xa0:0xb0)|MIN(15,av);
      } else {
        cmd=4;
        par=(v>0)?((MIN(14,av)<<4)|15):(0xf0|MIN(14,av));
      }
      break;
    case FX_SPEED: cmd=pt?15:1; par=pt?MIN(31,MAX(1,v)):MIN(255,MAX(1,v)); break;
    case FX_TEMPO: cmd=pt?15:20; par=MIN(255,MAX(32,v)); break;
    case FX_NOTECUT: if (pt) { cmd=14; par=0xc0|MIN(15,v); } else { cmd=19; par=0xc0|MIN(15,v); } break;
    case FX_NOTEDELAY: if (pt) { cmd=14; par=0xd0|MIN(15,v); } else { cmd=19; par=0xd0|MIN(15,v); } break;
    case FX_RETRIG: if (pt) { cmd=14; par=0x90|MIN(15,v); } else { cmd=17; par=MIN(15,v); } break;
    default: return false;
  }
  return true;
}

// volume column byte (IT/MPTM and XM), -1: none
int encVol(int fmt, int vt, int v) {
  int cv=MIN(64,MAX(0,v));
  if (fmt==RG_FMT_XM) {
    switch (vt) {
      case VC_VOL: return 0x10+cv;
      case VC_PAN: return 0xc0+MIN(15,(cv*15+32)/64);
      case VC_SLIDE_UP: return 0x70+MIN(15,v);
      case VC_SLIDE_DOWN: return 0x60+MIN(15,v);
      case VC_FINE_UP: return 0x90+MIN(15,v);
      case VC_FINE_DOWN: return 0x80+MIN(15,v);
      case VC_PORTA: return 0xf0+MIN(15,MAX(1,(v+8)/16));
    }
    return -1;
  }
  switch (vt) {
    case VC_VOL: return cv;
    case VC_PAN: return 128+cv;
    case VC_SLIDE_UP: return 85+MIN(9,v);
    case VC_SLIDE_DOWN: return 95+MIN(9,v);
    case VC_FINE_UP: return 65+MIN(9,v);
    case VC_FINE_DOWN: return 75+MIN(9,v);
    case VC_PORTA: {
      static const int tab[10]={0,1,4,8,16,32,64,96,128,255};
      int k=1;
      while (k<9 && tab[k]<v) k++;
      return 193+k;
    }
  }
  return -1;
}

// an instrument (editable export of IT, MPTM and XM): note -> sample map and envelopes
struct MEnv {
  std::vector<std::pair<int,int>> pts; // (tick, value)
  int loopStart, loopEnd, susStart, susEnd;
  MEnv(): loopStart(-1), loopEnd(-1), susStart(-1), susEnd(-1) {}
};
struct MIns {
  String name;
  int keymap[120]; // bank sample for each note (-1: none)
  int transpose[120]; // note played for each note
  MEnv vol, pan, pitch;
  MIns() {
    for (int i=0; i<120; i++) {
      keymap[i]=-1;
      transpose[i]=i;
    }
  }
};

// everything needed to write a module
struct RGModOut {
  int fmt;
  String name;
  int nch;
  std::vector<int> chPan;
  int speed, tempo, tempoFrac;
  bool linear;
  std::vector<MSmp> bank;
  std::vector<MIns> ins;
  std::vector<Cell> grid; // rows*nch
  int rows;
  std::vector<int> starts; // rows where a new pattern must start (0 included)
  int endJump; // at the end, jump to this start (-1: none)
  int restart; // start where the song restarts (XM header; -1: none)
  std::vector<std::vector<int>> ctl; // (row, kind, value): effects that must go in some channel
  RGModOut(): fmt(0), nch(0), speed(6), tempo(125), tempoFrac(0), linear(true), rows(0), endJump(-1), restart(-1) {}
};

// splits the rows in patterns, removes duplicates and writes the file
SafeWriter* finishModule(RGModOut& mo, std::function<void(const String&)> logAppend, String& err) {
  int fmt=mo.fmt;
  const FmtSpec& sp=specs[fmt];
  std::vector<MSmp>& bank=mo.bank;
  int nch=mo.nch;
  std::vector<int>& chPan=mo.chPan;
  std::vector<Cell>& grid=mo.grid;
  int rows=mo.rows;
  int speed=mo.speed, tempo=mo.tempo, tempoFrac=mo.tempoFrac;
  String songName=mo.name;
  bool instMode=!mo.ins.empty();

  // pieces: each start begins a new one, and none is longer than the biggest pattern
  struct Chunk {
    int start, len, startIdx;
  };
  std::vector<Chunk> chunks;
  std::vector<int> starts=mo.starts;
  if (starts.empty() || starts[0]!=0) starts.insert(starts.begin(),0);
  for (size_t k=0; k<starts.size(); k++) {
    int end=(k+1<starts.size())?starts[k+1]:rows;
    int t=starts[k];
    bool first=true;
    while (t<end) {
      int e2=MIN(end,t+sp.maxRows);
      Chunk ch;
      ch.start=t;
      ch.len=e2-t;
      ch.startIdx=first?(int)k:-1;
      chunks.push_back(ch);
      first=false;
      t=e2;
    }
  }
  // control effects (pattern break for short fixed patterns, jump at the end)
  int ctlCh=-1;
  auto needCtl=[&](int t, int kind, int val) {
    for (int c=0; c<nch; c++) {
      Cell& o=grid[(size_t)t*nch+c];
      if (o.fx==FX_NONE) {
        o.fx=kind;
        o.fv=val;
        return;
      }
    }
    if (fmt!=RG_FMT_MOD && nch<sp.maxChans) {
      if (ctlCh<0) {
        // add a channel just for these effects
        std::vector<Cell> g2((size_t)rows*(nch+1));
        for (int r=0; r<rows; r++) {
          for (int c=0; c<nch; c++) g2[(size_t)r*(nch+1)+c]=grid[(size_t)r*nch+c];
        }
        grid.swap(g2);
        nch++;
        ctlCh=nch-1;
        chPan.push_back(32);
      }
      Cell& o=grid[(size_t)t*nch+ctlCh];
      o.fx=kind;
      o.fv=val;
      return;
    }
    // MOD: take over the effect of the last channel
    Cell& o=grid[(size_t)t*nch+nch-1];
    o.fx=kind;
    o.fv=val;
    logAppend("note: an effect was replaced by a jump/break effect");
  };
  for (std::vector<int>& c: mo.ctl) {
    if (c[0]>=0 && c[0]<rows) needCtl(c[0],c[1],c[2]);
  }
  for (size_t i=0; i<chunks.size(); i++) {
    int last=chunks[i].start+chunks[i].len-1;
    bool isLast=(i+1==chunks.size());
    bool hasJump=false;
    for (int c=0; c<nch; c++) {
      int f=grid[(size_t)last*nch+c].fx;
      if (f==FX_JUMP || f==FX_BREAK) hasJump=true;
    }
    if (isLast && mo.endJump>=0 && !(sp.hasRestart && mo.restart==mo.endJump)) {
      if (!hasJump) needCtl(last,FX_JUMP,-1-mo.endJump);
    } else if (sp.fixedRows && chunks[i].len<sp.fixedRows && !hasJump) {
      needCtl(last,FX_BREAK,0);
    }
  }
  if (sp.fixedRows) {
    for (Chunk& ch: chunks) {
      if (ch.len<sp.fixedRows) ch.len=sp.fixedRows; // rows after the break are empty and never play
    }
  }
  // dedupe
  std::vector<std::vector<Cell>> pats;
  std::vector<int> patLen;
  std::vector<int> order;
  std::vector<int> orderOfStart(starts.size(),0);
  std::map<std::vector<Cell>,int> patIndex;
  for (size_t i=0; i<chunks.size(); i++) {
    std::vector<Cell> p((size_t)chunks[i].len*nch);
    for (int r=0; r<chunks[i].len; r++) {
      int t=chunks[i].start+r;
      if (t>=rows) continue;
      if (chunks[i].start+r>=((size_t)i+1<chunks.size()?chunks[i+1].start:rows)) continue;
      for (int c=0; c<nch; c++) p[(size_t)r*nch+c]=grid[(size_t)t*nch+c];
    }
    if (chunks[i].startIdx>=0) orderOfStart[chunks[i].startIdx]=order.size();
    std::map<std::vector<Cell>,int>::iterator it=patIndex.find(p);
    if (it!=patIndex.end()) {
      order.push_back(it->second);
    } else {
      int idx=pats.size();
      patIndex[p]=idx;
      pats.push_back(p);
      patLen.push_back(chunks[i].len);
      order.push_back(idx);
    }
  }
  // jump targets: negative values point to a start
  for (std::vector<Cell>& p: pats) {
    for (Cell& o: p) {
      if (o.fx==FX_JUMP && o.fv<0) {
        int k=-1-o.fv;
        o.fv=(k>=0 && k<(int)orderOfStart.size())?orderOfStart[k]:0;
      }
    }
  }
  bool looping=(mo.restart>=0);
  int loopOrder=looping?orderOfStart[MIN((int)orderOfStart.size()-1,mo.restart)]:0;
  logAppend(fmt::sprintf("%d rows in %d patterns, %d orders",rows,(int)pats.size(),(int)order.size()));
  if ((int)order.size()>sp.maxOrders || (int)pats.size()>sp.maxPatterns) {
    err=fmt::sprintf(_("the song is too long for %s: it needs %d patterns and %d orders (up to %d and %d).\nexport it as XM, IT or MPTM, which have bigger patterns."),sp.name,(int)pats.size(),(int)order.size(),sp.maxPatterns,sp.maxOrders);
    return NULL;
  }

  SafeWriter* w=new SafeWriter;
  w->init();
  auto putName=[&](const String& s, int len) {
    for (int i=0; i<len; i++) w->writeC(i<(int)s.size()?s[i]:0);
  };
  auto clampVol=[](int v) { return MIN(64,MAX(0,v)); };

  if (fmt==RG_FMT_IT || fmt==RG_FMT_MPTM) {
    bool mptm=(fmt==RG_FMT_MPTM);
    int nsmp=bank.size(), npat=pats.size(), nord=order.size()+1, nins=mo.ins.size();
    w->write("IMPM",4);
    putName(songName,26);
    w->writeS(0x1004); // pattern highlight
    w->writeS(nord);
    w->writeS(nins);
    w->writeS(nsmp);
    w->writeS(npat);
    w->writeS(mptm?0x0891:0x0214);
    w->writeS(mptm?0x0888:0x0214);
    w->writeS(1|(mo.linear?8:0)|(instMode?4:0)); // stereo, linear slides, instruments
    w->writeS(0);
    w->writeC(128); // global volume
    w->writeC(48); // mix volume
    w->writeC(speed);
    w->writeC(MIN(255,tempo));
    w->writeC(128); // separation
    w->writeC(0);
    w->writeS(0); // message
    w->writeI(0);
    w->writeI(0);
    for (int c=0; c<64; c++) w->writeC(c<nch?chPan[c]:(32|128));
    for (int c=0; c<64; c++) w->writeC(64);
    for (int o: order) w->writeC(o);
    w->writeC(255);
    size_t insPtr=w->tell();
    for (int i=0; i<nins; i++) w->writeI(0);
    size_t smpPtr=w->tell();
    for (int i=0; i<nsmp; i++) w->writeI(0);
    size_t patPtr=w->tell();
    for (int i=0; i<npat; i++) w->writeI(0);
    // instruments
    auto putEnv=[&](const MEnv& en, int zero) {
      int n=MIN(25,(int)en.pts.size());
      unsigned char flg=0;
      if (n>0) flg|=1;
      if (en.loopStart>=0 && en.loopStart<n) flg|=2;
      if (en.susStart>=0 && en.susStart<n) flg|=4;
      w->writeC(flg);
      w->writeC(n);
      w->writeC(MAX(0,MIN(n-1,en.loopStart)));
      w->writeC(MAX(0,MIN(n-1,en.loopEnd)));
      w->writeC(MAX(0,MIN(n-1,en.susStart)));
      w->writeC(MAX(0,MIN(n-1,en.susEnd)));
      for (int k=0; k<25; k++) {
        if (k<n) {
          w->writeC((signed char)en.pts[k].second);
          w->writeS(en.pts[k].first);
        } else {
          w->writeC(zero);
          w->writeS(0);
        }
      }
      w->writeC(0);
    };
    for (int i=0; i<nins; i++) {
      MIns& in=mo.ins[i];
      size_t at=w->tell();
      w->seek(insPtr+4*i,SEEK_SET);
      w->writeI(at);
      w->seek(at,SEEK_SET);
      w->write("IMPI",4);
      putName("",12);
      w->writeC(0);
      w->writeC(0); // NNA: cut
      w->writeC(0);
      w->writeC(0);
      w->writeS(0); // fadeout
      w->writeC(0);
      w->writeC(60);
      w->writeC(128); // global volume
      w->writeC(32|128); // panning (off)
      w->writeC(0);
      w->writeC(0);
      w->writeS(0x0214);
      w->writeC(0);
      w->writeC(0);
      putName(in.name,26);
      w->writeC(0);
      w->writeC(0);
      w->writeC(0);
      w->writeC(0);
      w->writeS(0);
      for (int k=0; k<120; k++) {
        w->writeC(MIN(119,MAX(0,in.transpose[k])));
        w->writeC(in.keymap[k]>=0?in.keymap[k]+1:0);
      }
      putEnv(in.vol,0);
      putEnv(in.pan,0);
      putEnv(in.pitch,0);
      w->writeI(0);
    }
    // sample headers
    std::vector<size_t> dataPtr(nsmp);
    for (int i=0; i<nsmp; i++) {
      MSmp& m=bank[i];
      size_t at=w->tell();
      w->seek(smpPtr+4*i,SEEK_SET);
      w->writeI(at);
      w->seek(at,SEEK_SET);
      w->write("IMPS",4);
      putName("",12);
      w->writeC(0);
      w->writeC(64); // global volume
      unsigned char flg=1;
      if (m.bits16) flg|=2;
      if (m.loopType) flg|=0x10;
      if (m.loopType==2) flg|=0x40;
      w->writeC(flg);
      w->writeC(64); // default volume
      putName(m.name,26);
      w->writeC(1); // signed
      w->writeC(32); // default pan (off)
      w->writeI(m.data.size());
      w->writeI(m.loopType?m.loopStart:0);
      w->writeI(m.loopType?m.loopEnd:0);
      w->writeI(m.c5);
      w->writeI(0);
      w->writeI(0);
      dataPtr[i]=w->tell();
      w->writeI(0);
      w->writeC(0);
      w->writeC(0);
      w->writeC(0);
      w->writeC(0);
    }
    // patterns
    for (int i=0; i<npat; i++) {
      size_t at=w->tell();
      w->seek(patPtr+4*i,SEEK_SET);
      w->writeI(at);
      w->seek(at,SEEK_SET);
      std::vector<unsigned char> pd;
      for (int r=0; r<patLen[i]; r++) {
        for (int c=0; c<nch; c++) {
          const Cell& o=pats[i][(size_t)r*nch+c];
          unsigned char mask=0;
          if (o.note!=NOTE_NONE) mask|=1;
          if (o.ins) mask|=2;
          if (o.vtype) mask|=4;
          int cmd=0, par=0;
          if (!encFx(fmt,o.fx,o.fv,cmd,par)) cmd=0;
          int vb=encVol(fmt,o.vtype,o.vval);
          if (vb<0) mask&=~4;
          if (cmd) mask|=8;
          if (!mask) continue;
          pd.push_back((c+1)|0x80);
          pd.push_back(mask);
          if (mask&1) pd.push_back(o.note==NOTE_CUT?254:(o.note==NOTE_OFF?255:o.note));
          if (mask&2) pd.push_back(o.ins);
          if (mask&4) pd.push_back(vb);
          if (mask&8) {
            pd.push_back(cmd);
            pd.push_back(par);
          }
        }
        pd.push_back(0);
      }
      w->writeS(pd.size());
      w->writeS(patLen[i]);
      w->writeI(0);
      w->write(pd.data(),pd.size());
    }
    // sample data
    for (int i=0; i<nsmp; i++) {
      MSmp& m=bank[i];
      size_t at=w->tell();
      w->seek(dataPtr[i],SEEK_SET);
      w->writeI(at);
      w->seek(at,SEEK_SET);
      for (short v: m.data) {
        if (m.bits16) {
          w->writeS(v);
        } else {
          w->writeC((signed char)(v>>8));
        }
      }
    }
    // OpenMPT song extensions: tempo beyond 255 and fractional tempo
    if (mptm) {
      w->write("STPM",4);
      if (tempo>255) {
        w->write("..TD",4);
        w->writeS(4);
        w->writeI(tempo);
      }
      if (tempoFrac) {
        w->write("DTFR",4);
        w->writeS(4);
        w->writeI(tempoFrac);
      }
      // empty MPTM data block ("228" serialization with no items)
      size_t mptStart=w->tell();
      static const unsigned char ssb[31]={
        0x32,0x32,0x38,0x04,0x6d,0x70,0x74,0x6d,0x1f,0x08,0x00,0x00,0x00,0x00,0x00,0x00,
        0x00,0x00,0xc8,0x04,0x01,0x01,0x00,0x7f,0x00,0x00,0x00,0x00,0x00,0x00,0x00
      };
      w->write(ssb,31);
      w->writeI(mptStart);
    }
  } else if (fmt==RG_FMT_XM) {
    int nchXM=nch+(nch&1);
    w->write("Extended Module: ",17);
    putName(songName,20);
    w->writeC(0x1a);
    putName("Registro Gamer",20);
    w->writeS(0x0104);
    w->writeI(276);
    w->writeS(order.size());
    w->writeS(looping?loopOrder:0);
    w->writeS(nchXM);
    w->writeS(pats.size());
    w->writeS(mo.ins.empty()?bank.size():mo.ins.size());
    w->writeS(mo.linear?1:0); // linear frequencies
    w->writeS(speed);
    w->writeS(tempo);
    for (int i=0; i<256; i++) w->writeC(i<(int)order.size()?order[i]:0);
    for (size_t i=0; i<pats.size(); i++) {
      std::vector<unsigned char> pd;
      for (int r=0; r<patLen[i]; r++) {
        for (int c=0; c<nchXM; c++) {
          if (c>=nch) {
            pd.push_back(0x80);
            continue;
          }
          const Cell& o=pats[i][(size_t)r*nch+c];
          int note=0, ins=o.ins, vol=0, fx=-1, par=0;
          if (o.note==NOTE_CUT || o.note==NOTE_OFF) note=97;
          else if (o.note>=0) note=o.note+1;
          {
            int vb=encVol(fmt,o.vtype,o.vval);
            if (vb>=0) vol=vb;
          }
          if (!encFx(fmt,o.fx,o.fv,fx,par)) fx=-1;
          unsigned char mask=0x80;
          if (note) mask|=1;
          if (ins) mask|=2;
          if (vol) mask|=4;
          if (fx>=0) mask|=8|16;
          pd.push_back(mask);
          if (note) pd.push_back(note);
          if (ins) pd.push_back(ins);
          if (vol) pd.push_back(vol);
          if (fx>=0) {
            pd.push_back(fx);
            pd.push_back(par);
          }
        }
      }
      w->writeI(9);
      w->writeC(0);
      w->writeS(patLen[i]);
      w->writeS(pd.size());
      w->write(pd.data(),pd.size());
    }
    // instruments: one per sample (faithful export), or the song's instruments with their samples
    std::vector<MIns> xins=mo.ins;
    if (xins.empty()) {
      for (size_t i=0; i<bank.size(); i++) {
        MIns in;
        in.name=bank[i].name;
        for (int k=0; k<120; k++) in.keymap[k]=i;
        xins.push_back(in);
      }
    }
    for (size_t i=0; i<xins.size(); i++) {
      MIns& in=xins[i];
      std::vector<int> used;
      for (int k=0; k<96; k++) {
        if (in.keymap[k]>=0 && std::find(used.begin(),used.end(),in.keymap[k])==used.end()) used.push_back(in.keymap[k]);
      }
      if (used.size()>16) used.resize(16);
      w->writeI(263);
      putName(in.name,22);
      w->writeC(0);
      w->writeS(used.size());
      w->writeI(40);
      for (int k=0; k<96; k++) {
        int sl=0;
        for (size_t u=0; u<used.size(); u++) if (used[u]==in.keymap[k]) sl=u;
        w->writeC(sl);
      }
      int nv=MIN(12,(int)in.vol.pts.size());
      for (int k=0; k<12; k++) {
        w->writeS(k<nv?in.vol.pts[k].first:0);
        w->writeS(k<nv?in.vol.pts[k].second:0);
      }
      for (int k=0; k<12; k++) {
        w->writeS(0);
        w->writeS(0);
      }
      w->writeC(nv);
      w->writeC(0);
      w->writeC(MAX(0,MIN(nv-1,in.vol.susStart)));
      w->writeC(MAX(0,MIN(nv-1,in.vol.loopStart)));
      w->writeC(MAX(0,MIN(nv-1,in.vol.loopEnd)));
      w->writeC(0);
      w->writeC(0);
      w->writeC(0);
      unsigned char vt=0;
      if (nv>0) vt|=1;
      if (nv>0 && in.vol.susStart>=0 && in.vol.susStart<nv) vt|=2;
      if (nv>0 && in.vol.loopStart>=0 && in.vol.loopStart<nv) vt|=4;
      w->writeC(vt);
      w->writeC(0);
      for (int k=0; k<4; k++) w->writeC(0); // vibrato
      w->writeS(0); // fadeout
      for (int k=0; k<22; k++) w->writeC(0);
      for (int u: used) {
        MSmp& m=bank[u];
        int bytes=m.bits16?2:1;
        w->writeI(m.data.size()*bytes);
        w->writeI(m.loopType?m.loopStart*bytes:0);
        w->writeI(m.loopType?(m.loopEnd-m.loopStart)*bytes:0);
        w->writeC(64);
        w->writeC((signed char)m.fine);
        w->writeC((m.loopType&3)|(m.bits16?0x10:0));
        w->writeC(128);
        w->writeC((signed char)m.rel);
        w->writeC(0);
        putName(m.name,22);
      }
      for (int u: used) {
        MSmp& m=bank[u];
        int last=0;
        for (short v: m.data) {
          if (m.bits16) {
            w->writeS((short)(v-last));
            last=v;
          } else {
            int b=v>>8;
            w->writeC((signed char)(b-last));
            last=b;
          }
        }
      }
    }
  } else if (fmt==RG_FMT_S3M) {
    int nsmp=bank.size(), npat=pats.size(), nord=order.size();
    if (nord&1) nord++;
    putName(songName,28);
    w->writeC(0x1a);
    w->writeC(16);
    w->writeS(0);
    w->writeS(nord);
    w->writeS(nsmp);
    w->writeS(npat);
    w->writeS(0); // flags
    w->writeS(0x1320); // made with (ST 3.20)
    w->writeS(2); // unsigned samples
    w->write("SCRM",4);
    w->writeC(64); // global volume
    w->writeC(speed);
    w->writeC(tempo);
    w->writeC(0x80|48); // stereo, master volume
    w->writeC(0);
    w->writeC(252); // panning table present
    for (int k=0; k<10; k++) w->writeC(0);
    for (int c=0; c<32; c++) {
      if (c<nch) {
        w->writeC((chPan[c]<32)?(c&7):(8+(c&7)));
      } else {
        w->writeC(255);
      }
    }
    for (int i=0; i<nord; i++) w->writeC(i<(int)order.size()?order[i]:255);
    size_t smpPtr=w->tell();
    for (int i=0; i<nsmp; i++) w->writeS(0);
    size_t patPtr=w->tell();
    for (int i=0; i<npat; i++) w->writeS(0);
    for (int c=0; c<32; c++) w->writeC(c<nch?(0x20|MIN(15,(chPan[c]*15+32)/64)):0);
    auto align16=[&]() {
      while (w->tell()&15) w->writeC(0);
    };
    std::vector<size_t> dataPtr(nsmp);
    for (int i=0; i<nsmp; i++) {
      MSmp& m=bank[i];
      align16();
      size_t at=w->tell();
      w->seek(smpPtr+2*i,SEEK_SET);
      w->writeS(at>>4);
      w->seek(at,SEEK_SET);
      w->writeC(1);
      putName("",12);
      dataPtr[i]=w->tell();
      w->writeC(0);
      w->writeS(0);
      w->writeI(m.data.size());
      w->writeI(m.loopType?m.loopStart:0);
      w->writeI(m.loopType?m.loopEnd:0);
      w->writeC(64);
      w->writeC(0);
      w->writeC(0);
      w->writeC((m.loopType?1:0)|(m.bits16?4:0));
      w->writeI(m.c5);
      for (int k=0; k<12; k++) w->writeC(0);
      putName(m.name,28);
      w->write("SCRS",4);
    }
    for (int i=0; i<npat; i++) {
      align16();
      size_t at=w->tell();
      w->seek(patPtr+2*i,SEEK_SET);
      w->writeS(at>>4);
      w->seek(at,SEEK_SET);
      std::vector<unsigned char> pd;
      for (int r=0; r<64; r++) {
        for (int c=0; c<nch; c++) {
          const Cell& o=pats[i][(size_t)r*nch+c];
          int note=-1, cmd=0, par=0;
          if (o.note==NOTE_CUT || o.note==NOTE_OFF) note=254;
          else if (o.note>=0) note=((o.note/12)<<4)|(o.note%12);
          if (!encFx(fmt,o.fx,o.fv,cmd,par)) cmd=0;
          unsigned char what=0;
          if (note>=0 || o.ins) what|=0x20;
          if (o.vtype==VC_VOL) what|=0x40;
          if (cmd) what|=0x80;
          if (!what) continue;
          pd.push_back(what|c);
          if (what&0x20) {
            pd.push_back(note>=0?note:255);
            pd.push_back(o.ins);
          }
          if (what&0x40) pd.push_back(clampVol(o.vval));
          if (what&0x80) {
            pd.push_back(cmd);
            pd.push_back(par);
          }
        }
        pd.push_back(0);
      }
      w->writeS(pd.size()+2);
      w->write(pd.data(),pd.size());
    }
    for (int i=0; i<nsmp; i++) {
      MSmp& m=bank[i];
      align16();
      size_t at=w->tell();
      w->seek(dataPtr[i],SEEK_SET);
      w->writeC((at>>20)&0xff);
      w->writeS((at>>4)&0xffff);
      w->seek(at,SEEK_SET);
      for (short v: m.data) {
        if (m.bits16) {
          w->writeS((unsigned short)(v+32768));
        } else {
          w->writeC((unsigned char)((v>>8)+128));
        }
      }
    }
  } else {
    // MOD
    if (order.size()>128) {
      err="internal error: too many orders";
      delete w;
      return NULL;
    }
    putName(songName,20);
    for (int i=0; i<31; i++) {
      if (i<(int)bank.size()) {
        MSmp& m=bank[i];
        int len=MIN((int)m.data.size(),131070)&(~1);
        if ((int)m.data.size()>131070) logAppendf("WARNING: sample %d is longer than 128KB and was cut",i+1);
        putName(m.name,22);
        w->writeS_BE(len/2);
        w->writeC(m.fine&15);
        w->writeC(64);
        if (m.loopType && m.loopEnd>m.loopStart) {
          int ls=MIN(m.loopStart,len)/2;
          int ll=(MIN(m.loopEnd,len)/2)-ls;
          if (ll<1) ll=1;
          w->writeS_BE(ls);
          w->writeS_BE(ll);
        } else {
          w->writeS_BE(0);
          w->writeS_BE(1);
        }
      } else {
        putName("",22);
        w->writeS_BE(0);
        w->writeC(0);
        w->writeC(0);
        w->writeS_BE(0);
        w->writeS_BE(1);
      }
    }
    w->writeC(order.size());
    w->writeC(127);
    for (int i=0; i<128; i++) w->writeC(i<(int)order.size()?order[i]:0);
    if (nch==4) {
      w->write("M.K.",4);
    } else if (nch<10) {
      w->writeC('0'+nch);
      w->write("CHN",3);
    } else {
      w->writeC('0'+nch/10);
      w->writeC('0'+nch%10);
      w->write("CH",2);
    }
    for (size_t i=0; i<pats.size(); i++) {
      for (int r=0; r<64; r++) {
        for (int c=0; c<nch; c++) {
          const Cell& o=pats[i][(size_t)r*nch+c];
          int per=0, cmd=0, par=0;
          if (o.note>=0) {
            per=ptPeriods[MIN(35,o.note)];
          }
          if (!encFx(fmt,o.fx,o.fv,cmd,par)) {
            cmd=0;
            par=0;
          }
          if ((o.note==NOTE_CUT || o.note==NOTE_OFF) && cmd==0) {
            cmd=12;
            par=0;
          }
          int ins=o.ins;
          w->writeC((ins&0xf0)|((per>>8)&15));
          w->writeC(per&0xff);
          w->writeC(((ins&15)<<4)|cmd);
          w->writeC(par);
        }
      }
    }
    for (int i=0; i<(int)bank.size() && i<31; i++) {
      MSmp& m=bank[i];
      int len=MIN((int)m.data.size(),131070)&(~1);
      for (int k=0; k<len; k++) w->writeC((signed char)(m.data[k]>>8));
    }
  }

  return w;
}

}

void DivExportModule::run() {
  if (conf.getString("mode","faithful")=="editable") {
    runEditable();
  } else {
    runFaithful();
  }
}

void DivExportModule::runFaithful() {
  const FmtSpec& sp=specs[fmt];
  // find the sample channels
  std::vector<MSrc> src;
  int totalChans=e->getTotalChannelCount();
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    int n=0;
    if (s==DIV_SYSTEM_AMIGA) {
      n=4;
    } else if (s==DIV_SYSTEM_PCM_DAC) {
      n=((DivPlatformPCMDAC*)dispatchOf(i))->chans;
    } else {
      logAppendf("WARNING: chip %d (%s) does not play samples the module can use; ignored",i,e->getSystemName(s));
      continue;
    }
    for (int j=0; j<n; j++) {
      MSrc m;
      m.sys=i;
      m.ch=j;
      m.type=s;
      m.gch=-1;
      for (int c=0; c<totalChans; c++) {
        if (e->song.dispatchOfChan[c]==i && e->song.dispatchChanOfChan[c]==j) {
          m.gch=c;
          break;
        }
      }
      src.push_back(m);
    }
  }
  if (src.empty()) {
    fail(_("no sample chip in this song (the module export works with Amiga and Generic PCM)"));
    return;
  }
  int nch=(int)src.size();
  if (nch>sp.maxChans) {
    fail(fmt::sprintf(_("the song has %d sample channels, but %s supports up to %d"),nch,sp.name,sp.maxChans));
    return;
  }

  // capture
  std::vector<MSmp> bank;
  std::map<int,int> bankOfSample;
  std::map<std::vector<short>,int> bankOfWave;
  std::vector<std::vector<MState>> st;
  std::vector<bool> cmdTrig(DIV_MAX_CHANS,false);
  std::vector<int> cmdPos(DIV_MAX_CHANS,-1);
  std::vector<bool> amigaOn(4*DIV_MAX_CHIPS,false);
  std::vector<MState> prev(nch);
  bool warnedWave=false;

  auto sampleToBank=[&](int si, bool amiga) -> int {
    std::map<int,int>::iterator it=bankOfSample.find(si);
    if (it!=bankOfSample.end()) return it->second;
    DivSample* s=e->getSample(si);
    MSmp m;
    m.name=s->name;
    if (amiga) {
      int end=s->getLoopEndPosition(DIV_SAMPLE_DEPTH_8BIT);
      if (end>(int)s->samples) end=s->samples;
      if (end<0) end=0;
      for (int k=0; k<end; k++) m.data.push_back(s->data8==NULL?0:(short)(s->data8[k]*256));
      m.bits16=false;
      if (s->isLoopable()) {
        m.loopType=1;
        m.loopStart=s->getLoopStartPosition(DIV_SAMPLE_DEPTH_8BIT)&(~1);
        m.loopEnd=end;
      }
    } else {
      int len=s->samples;
      if (s->data16!=NULL && s->depth!=DIV_SAMPLE_DEPTH_8BIT) {
        m.bits16=true;
        for (int k=0; k<len; k++) m.data.push_back(s->data16[k]);
      } else if (s->data8!=NULL) {
        for (int k=0; k<len; k++) m.data.push_back((short)(s->data8[k]*256));
      } else if (s->data16!=NULL) {
        m.bits16=true;
        for (int k=0; k<len; k++) m.data.push_back(s->data16[k]);
      }
      if (s->isLoopable()) {
        m.loopType=(s->loopMode==DIV_SAMPLE_LOOP_PINGPONG)?2:1;
        if (s->loopMode==DIV_SAMPLE_LOOP_BACKWARD) logAppendf("WARNING: sample %d loops backwards; exported as a forward loop",si);
        m.loopStart=s->loopStart;
        m.loopEnd=MIN(s->loopEnd,len);
        if (m.loopEnd<len) m.data.resize(m.loopEnd);
      }
    }
    if (m.data.empty()) m.data.push_back(0);
    int idx=(int)bank.size();
    bank.push_back(m);
    bankOfSample[si]=idx;
    return idx;
  };

  auto waveToBank=[&](const std::vector<short>& w) -> int {
    std::map<std::vector<short>,int>::iterator it=bankOfWave.find(w);
    if (it!=bankOfWave.end()) return it->second;
    MSmp m;
    m.name=fmt::sprintf("wave %d",(int)bankOfWave.size());
    m.isWave=true;
    m.data=w;
    m.loopType=1;
    m.loopStart=0;
    m.loopEnd=w.size();
    int idx=(int)bank.size();
    bank.push_back(m);
    bankOfWave[w]=idx;
    return idx;
  };

  e->rgCmdHook=[&](const DivCommand& c) {
    if (c.chan<0 || c.chan>=DIV_MAX_CHANS) return;
    if (c.cmd==DIV_CMD_NOTE_ON) {
      cmdTrig[c.chan]=true;
    } else if (c.cmd==DIV_CMD_SAMPLE_POS) {
      cmdTrig[c.chan]=true;
      cmdPos[c.chan]=c.value;
    }
  };
  tickHook=[&](int t) {
    std::vector<MState> row(nch);
    // Amiga: note starts and DMA from the register log
    std::map<int,std::vector<int>> amigaLoc; // sys -> first location written per channel (-1: none)
    for (RGWrite& w: ticks[t]) {
      if (e->song.system[w.sys]!=DIV_SYSTEM_AMIGA) continue;
      std::vector<int>& loc=amigaLoc[w.sys];
      if (loc.empty()) loc.resize(4,-1);
      if (w.addr==0x96) {
        for (int k=0; k<4; k++) {
          if (w.val&(1<<k)) amigaOn[w.sys*4+k]=(w.val&0x8000)?true:false;
        }
      } else if (w.addr>=0x200 && w.addr<0x204) {
        if (loc[w.addr-0x200]<0) loc[w.addr-0x200]=w.val;
      }
    }
    for (int i=0; i<nch; i++) {
      MSrc& m=src[i];
      MState& o=row[i];
      if (m.type==DIV_SYSTEM_AMIGA) {
        DivPlatformAmiga* a=(DivPlatformAmiga*)dispatchOf(m.sys);
        DivPlatformAmiga::Channel& c=a->chan[m.ch];
        int sep=e->song.systemFlags[m.sys].getInt("stereoSep",0)&127;
        o.pan=(m.ch==0 || m.ch==3)?(32-(32*sep)/127):(32+(32*sep)/127);
        bool on=amigaOn[m.sys*4+m.ch];
        std::map<int,std::vector<int>>::iterator li=amigaLoc.find(m.sys);
        int loc=(li==amigaLoc.end())?-1:li->second[m.ch];
        if (!on || c.freq<1) {
          o.smp=-1;
        } else {
          o.freq=(double)a->chipClock/(double)c.freq;
          o.vol=MIN(64,MAX(0,c.outVol));
          if (c.useWave) {
            int len=MIN(256,c.audLen*2);
            if (len<2) len=2;
            std::vector<short> w;
            for (int k=0; k<len; k++) w.push_back((short)((signed char)(c.ws.output[k]^0x80))*256);
            o.smp=waveToBank(w);
            if (loc>=0) o.trig=true;
            else if (prev[i].smp!=o.smp) o.trig=true;
            o.off=0;
          } else if (c.sample>=0 && c.sample<e->song.sampleLen) {
            o.smp=sampleToBank(c.sample,true);
            if (loc>=0 && loc!=0x400) {
              o.trig=true;
              o.off=c.audPos&(~1);
            }
            if (prev[i].smp!=o.smp && !o.trig) {
              o.trig=true;
              o.off=0;
            }
          } else {
            o.smp=-1;
          }
        }
      } else if (m.type==DIV_SYSTEM_PCM_DAC) {
        DivPlatformPCMDAC* p=(DivPlatformPCMDAC*)dispatchOf(m.sys);
        DivPlatformPCMDAC::Channel& c=p->chan[m.ch];
        int pl=c.panL, pr=c.panR;
        o.pan=(pl+pr>0)?((64*pr+(pl+pr)/2)/(pl+pr)):32;
        if (c.useWave) {
          if (!warnedWave) logAppend("WARNING: wavetable mode of Generic PCM is not exported");
          warnedWave=true;
          o.smp=-1;
        } else if (c.active && c.sample>=0 && c.sample<e->song.sampleLen) {
          // freq is a 16.16 step per output sample
          o.freq=(double)c.freq*(double)p->chipClock/65536.0;
          int vm=MAX(1,p->volMax);
          o.vol=(MIN(vm,c.vol)*MIN(c.envVol,64))/vm;
          o.smp=sampleToBank(c.sample,false);
          if (m.gch>=0 && cmdTrig[m.gch]) {
            o.trig=true;
            o.off=MAX(0,c.audPos);
          } else if (prev[i].smp!=o.smp) {
            o.trig=true;
            o.off=MAX(0,c.audPos);
          }
          if (o.freq<1) o.smp=-1;
        } else {
          o.smp=-1;
        }
      }
      if (o.smp>=0) bank[o.smp].uses++;
      if (o.smp>=0 && o.trig) bank[o.smp].freqs.push_back(o.freq);
    }
    for (int i=0; i<DIV_MAX_CHANS; i++) {
      cmdTrig[i]=false;
      cmdPos[i]=-1;
    }
    prev=row;
    st.push_back(row);
  };

  std::vector<int> capSys;
  for (MSrc& m: src) {
    if (m.type==DIV_SYSTEM_AMIGA && std::find(capSys.begin(),capSys.end(),m.sys)==capSys.end()) capSys.push_back(m.sys);
  }
  bool ok=capture(capSys);
  e->rgCmdHook=nullptr;
  tickHook=nullptr;
  if (!ok) {
    fail("aborted");
    return;
  }
  if (st.size()<ticks.size()) {
    fail("internal error: missing ticks");
    return;
  }
  progress[0].amount=0.5f;
  // too many waves (wavetable synths make a new one on every change): merge the least used ones into
  // the closest of the most used ones of the same length
  if ((int)bank.size()>sp.maxSamples) {
    int nWave=0;
    for (MSmp& m: bank) if (m.isWave) nWave++;
    int budget=sp.maxSamples-((int)bank.size()-nWave);
    if (budget>=1 && nWave>budget) {
      std::vector<int> waves;
      for (int i=0; i<(int)bank.size(); i++) if (bank[i].isWave) waves.push_back(i);
      std::sort(waves.begin(),waves.end(),[&](int a, int b) { return bank[a].uses>bank[b].uses; });
      std::vector<int> keep(waves.begin(),waves.begin()+budget);
      std::vector<int> remap(bank.size(),-1);
      for (int i=0; i<(int)bank.size(); i++) remap[i]=i;
      for (size_t k=budget; k<waves.size(); k++) {
        int a=waves[k];
        double best=1e300;
        int bi=-1;
        for (int c: keep) {
          if (bank[c].data.size()!=bank[a].data.size()) continue;
          double d=0;
          for (size_t j=0; j<bank[a].data.size(); j++) {
            double x=(double)bank[a].data[j]-(double)bank[c].data[j];
            d+=x*x;
          }
          if (d<best) {
            best=d;
            bi=c;
          }
        }
        if (bi<0) bi=keep[0];
        remap[a]=bi;
      }
      // renumber
      std::vector<int> newIdx(bank.size(),-1);
      std::vector<MSmp> nb;
      for (int i=0; i<(int)bank.size(); i++) {
        if (remap[i]==i) {
          newIdx[i]=nb.size();
          nb.push_back(bank[i]);
        }
      }
      for (int i=0; i<(int)bank.size(); i++) {
        if (remap[i]!=i) {
          MSmp& d=nb[newIdx[remap[i]]];
          d.freqs.insert(d.freqs.end(),bank[i].freqs.begin(),bank[i].freqs.end());
        }
      }
      for (std::vector<MState>& row: st) {
        for (MState& o: row) {
          if (o.smp>=0) o.smp=newIdx[remap[o.smp]];
        }
      }
      logAppendf("WARNING: %d different waves were merged into %d (%s supports up to %d samples)",nWave,budget,sp.name,sp.maxSamples);
      bank.swap(nb);
    }
  }
  // MOD: samples must fit 128KB and the 3 octaves of ProTracker: resample them an octave at a time
  if (fmt==RG_FMT_MOD) {
    for (size_t b=0; b<bank.size(); b++) {
      MSmp& m=bank[b];
      std::vector<double> fs=m.freqs;
      std::sort(fs.begin(),fs.end());
      double med=fs.empty()?11745.0:fs[fs.size()/2];
      int k=(int)round(log2(med/11745.0));
      while (((double)m.data.size()/pow(2.0,k))>131070.0) k++;
      if (k>4) k=4;
      if (k<-3) k=-3;
      if (k==0) continue;
      double r=pow(2.0,k);
      size_t nl=(size_t)ceil(m.data.size()/r);
      std::vector<short> nd(nl);
      for (size_t i=0; i<nl; i++) {
        if (k>0) {
          // average r source frames
          double acc=0;
          int cnt=0;
          for (int j=0; j<(int)r; j++) {
            size_t si=(size_t)(i*r)+j;
            if (si<m.data.size()) {
              acc+=m.data[si];
              cnt++;
            }
          }
          nd[i]=(short)(cnt?acc/cnt:0);
        } else {
          double x=i*r;
          size_t i0=(size_t)x;
          double fr=x-i0;
          double a=m.data[MIN(i0,m.data.size()-1)], c=m.data[MIN(i0+1,m.data.size()-1)];
          nd[i]=(short)(a+(c-a)*fr);
        }
      }
      m.data.swap(nd);
      m.loopStart=(int)(m.loopStart/r);
      m.loopEnd=MIN((int)(m.loopEnd/r),(int)m.data.size());
      m.scale=r;
      for (double& f: m.freqs) f/=r;
      logAppendf("sample %d resampled by %g to fit the MOD format",(int)b+1,1.0/r);
    }
  }
  if (fmt==RG_FMT_IT && bank.size()>99) logAppendf("WARNING: %d samples: more than Impulse Tracker itself supports (99); OpenMPT and other players are fine",(int)bank.size());
  if ((int)bank.size()>sp.maxSamples) {
    fail(fmt::sprintf(_("the song uses %d different samples (and waves), but %s supports up to %d"),(int)bank.size(),sp.name,sp.maxSamples));
    return;
  }
  if (bank.empty()) {
    fail(_("the song plays no samples"));
    return;
  }
  int rows=(int)st.size();

  // speed and tempo: one row per tick. speed 2 lets regular slides happen in the middle of the row.
  int speed=2;
  double tempoD=tickRate*2.5*speed;
  if (tempoD>sp.maxTempo+0.5) {
    speed=1;
    tempoD=tickRate*2.5;
  }
  if (tempoD>sp.maxTempo+0.5) {
    fail(fmt::sprintf(_("the song runs at %.2f ticks per second, too fast for %s (up to %.1f)%s"),tickRate,sp.name,sp.maxTempo/2.5,(fmt==RG_FMT_MPTM)?"":_(".\nexport it as MPTM, which goes up to 400 ticks per second.")));
    return;
  }
  if (tempoD<32) {
    fail(fmt::sprintf(_("the song runs at %.2f ticks per second, too slow for a module (at least 12.8)"),tickRate));
    return;
  }
  int tempo=(int)round(tempoD);
  int tempoFrac=0;
  if (fmt==RG_FMT_MPTM) {
    tempo=(int)floor(tempoD);
    tempoFrac=(int)round((tempoD-tempo)*10000.0);
    if (tempoFrac>=10000) {
      tempo++;
      tempoFrac=0;
    }
  } else if (fabs(tempo-tempoD)/tempoD>0.002) {
    logAppendf("WARNING: %.2f ticks per second become tempo %d (%.2f%% off)",tickRate,tempo,100.0*(tempo-tempoD)/tempoD);
  }
  logAppendf("speed %d, tempo %d%s",speed,tempo,tempoFrac?fmt::sprintf(".%04d",tempoFrac).c_str():"");

  // pitch model. units: linear formats use 1/64 semitone; period formats use minus the period.
  auto targetUnits=[&](double freq) -> double {
    if (freq<1) freq=1;
    if (fmt==RG_FMT_MOD) return -MOD_CLOCK/freq;
    if (fmt==RG_FMT_S3M) return -S3M_CLOCK/freq;
    return 768.0*log2(freq/8363.0);
  };

  // tuning of each sample: the reference rate keeps the note starts close to whole notes
  for (size_t b=0; b<bank.size(); b++) {
    MSmp& m=bank[b];
    std::vector<double> semis;
    double base=(fmt==RG_FMT_MOD)?(MOD_CLOCK/428.0):8363.0;
    for (double f: m.freqs) if (f>0) semis.push_back(12.0*log2(f/base));
    double frac=0, med=0;
    if (!semis.empty()) {
      double sx=0, sy=0;
      for (double s: semis) {
        sx+=cos(2*M_PI*s);
        sy+=sin(2*M_PI*s);
      }
      frac=atan2(sy,sx)/(2*M_PI);
      std::vector<double> sorted=semis;
      std::sort(sorted.begin(),sorted.end());
      med=sorted[sorted.size()/2];
    }
    double refSemis=frac+round(med-frac);
    if (fmt==RG_FMT_MOD) {
      // MOD: middle of the 3 octaves (F#-2) must sit near the median; finetune in 1/8 semitone
      double ft=round(frac*8.0);
      int fine=(int)ft;
      while (fine>7) fine-=8;
      while (fine<-8) fine+=8;
      m.fine=fine;
      m.ref=0;
    } else if (fmt==RG_FMT_XM) {
      double q=round(refSemis*128.0)/128.0;
      m.rel=(int)floor(q+0.5);
      m.fine=(int)round((q-m.rel)*128.0);
      if (m.fine>127) m.fine=127;
      if (m.fine<-128) m.fine=-128;
      if (m.rel>95) m.rel=95;
      if (m.rel<-96) m.rel=-96;
    } else {
      double r=8363.0*pow(2.0,refSemis/12.0);
      while (r>9999999) r/=2;
      while (r<256) r*=2;
      m.c5=(int)round(r);
    }
  }

  // pitch (in units) of note index n of sample b
  auto noteUnits=[&](int b, int n) -> double {
    const MSmp& m=bank[b];
    switch (fmt) {
      case RG_FMT_MOD: {
        // finetune shifts the period by 1/8 semitone steps
        double per=ptPeriods[n]*pow(2.0,-(double)m.fine/96.0);
        return -round(per);
      }
      case RG_FMT_S3M: {
        // C-4 (index 48) plays at the C2 speed
        double f=m.c5*pow(2.0,(n-48)/12.0);
        return -round(S3M_CLOCK/f);
      }
      case RG_FMT_XM:
        // C-4 (index 48) plays at 8363Hz, shifted by the relative note and finetune
        return 64.0*(n-48+m.rel)+m.fine/2.0;
      default:
        // IT: C-5 (index 60) plays at C5Speed
        return 768.0*log2(m.c5/8363.0)+64.0*(n-60);
    }
  };
  auto bestNote=[&](int b, double u) -> int {
    int best=0;
    double bd=1e30;
    for (int n=0; n<sp.maxNote; n++) {
      double d=fabs(noteUnits(b,n)-u);
      if (fmt==RG_FMT_MOD || fmt==RG_FMT_S3M) d=fabs(log2(noteUnits(b,n)/u));
      if (d<bd) {
        bd=d;
        best=n;
      }
    }
    return best;
  };
  // slide units per step of each kind
  int xfUnit=sp.hasExtraFine?1:0;
  int fUnit=(fmt==RG_FMT_MOD)?1:4;
  int rUnit=(fmt==RG_FMT_MOD)?1:4;

  // channel panning of the first row (IT, MPTM, S3M header)
  std::vector<int> chPan(nch,32);
  for (int c=0; c<nch; c++) {
    for (int t=0; t<rows; t++) {
      if (st[t][c].smp>=0) {
        chPan[c]=st[t][c].pan;
        break;
      }
    }
  }

  // build the rows
  std::vector<Cell> grid((size_t)rows*nch);
  int outOfRange=0, cutOffsets=0, lateFx=0;
  for (int c=0; c<nch; c++) {
    bool playing=false;
    int cs=-1, cv=-1, cp=-1;
    if (fmt==RG_FMT_IT || fmt==RG_FMT_MPTM || fmt==RG_FMT_S3M) cp=chPan[c];
    else if (fmt==RG_FMT_MOD) cp=((c&3)==0 || (c&3)==3)?0:64;
    else cp=32;
    double cu=0, pos=0;
    for (int t=0; t<rows; t++) {
      MState& s=st[t][c];
      Cell& o=grid[(size_t)t*nch+c];
      bool wantPan=false;
      if (s.smp<0) {
        if (playing) {
          o.note=NOTE_CUT;
          playing=false;
        }
        continue;
      }
      double sfreq=s.freq/bank[s.smp].scale;
      double tu=targetUnits(sfreq);
      bool trig=s.trig || !playing || s.smp!=cs;
      int trigOff=s.trig?(int)(s.off/bank[s.smp].scale):(int)pos;
      if (!s.trig && trig && playing && s.smp!=cs) trigOff=0;
      if (trig) {
        int n=bestNote(s.smp,tu);
        double nu=noteUnits(s.smp,n);
        if (fmt==RG_FMT_MOD || fmt==RG_FMT_S3M) {
          if (fabs(log2(nu/tu))>0.06) outOfRange++;
        } else if (fabs(nu-tu)>64) {
          outOfRange++;
        }
        o.note=n;
        o.ins=s.smp+1;
        cs=s.smp;
        cu=nu;
        if (fmt==RG_FMT_XM) cp=32; // the note brings the sample panning (center)
        pos=trigOff;
        playing=true;
        if (fmt==RG_FMT_MOD) {
          // MOD: the note sets the default volume (64)
          cv=64;
        } else {
          o.vtype=1;
          o.vval=s.vol;
          cv=s.vol;
        }
        if (trigOff>=256) {
          int ov=trigOff>>8;
          if (ov>sp.maxOffset) {
            ov=sp.maxOffset;
            cutOffsets++;
          }
          o.fx=FX_OFFSET;
          o.fv=ov;
        }
      }
      // volume
      if (s.vol!=cv) {
        if (sp.hasVolCol) {
          o.vtype=1;
          o.vval=s.vol;
          cv=s.vol;
        } else if (o.fx==FX_NONE) {
          o.fx=FX_VOL;
          o.fv=s.vol;
          cv=s.vol;
        }
      }
      // pitch
      double d=tu-cu;
      if (o.fx==FX_NONE && d!=0) {
        double ad=fabs(d);
        int sg=(d>0)?1:-1;
        if (xfUnit && ad>=0.5 && ad<=15.5) {
          int x=(int)round(ad);
          if (x>15) x=15;
          if (x>0) {
            o.fx=FX_SLIDE_XF;
            o.fv=sg*x;
            cu+=sg*x*xfUnit;
          }
        } else if (ad>=fUnit*0.5 && (ad<=fUnit*15.5 || speed<2)) {
          int x=(int)round(ad/fUnit);
          if (x>15) x=15;
          if (x>0) {
            o.fx=FX_SLIDE_F;
            o.fv=sg*x;
            cu+=sg*x*fUnit;
          }
        } else if (speed>=2 && ad>fUnit*15.5) {
          int x=(int)round(ad/(rUnit*(speed-1)));
          if (x>sp.maxRegular) x=sp.maxRegular;
          if (x>0) {
            o.fx=FX_SLIDE_R;
            o.fv=sg*x;
            cu+=sg*x*rUnit*(speed-1);
          }
        }
      } else if (d!=0 && fabs(d)>fUnit*2) {
        lateFx++;
      }
      // panning
      if (s.pan!=cp) wantPan=true;
      if (wantPan) {
        if (sp.hasVolCol && o.vtype==0 && fmt!=RG_FMT_S3M) {
          o.vtype=2;
          o.vval=s.pan;
          cp=s.pan;
        } else if (o.fx==FX_NONE) {
          o.fx=FX_PAN;
          o.fv=s.pan;
          cp=s.pan;
        }
      }
      // where the sample is (for restarts)
      pos+=sfreq/tickRate;
      const MSmp& m=bank[cs];
      if (m.loopType && pos>=m.loopEnd && m.loopEnd>m.loopStart) {
        pos=m.loopStart+fmod(pos-m.loopStart,(double)(m.loopEnd-m.loopStart));
      }
    }
  }
  if (outOfRange) logAppendf("WARNING: %d notes are outside of the %s note range",outOfRange,sp.name);
  if (cutOffsets) logAppendf("WARNING: %d sample offsets are beyond the reach of the offset effect",cutOffsets);
  if (lateFx) logAppendf("note: %d pitch changes had to wait for a free effect column",lateFx);
  progress[0].amount=0.7f;

  RGModOut mo;
  mo.fmt=fmt;
  mo.name=e->song.name;
  mo.nch=nch;
  mo.chPan=chPan;
  mo.speed=speed;
  mo.tempo=tempo;
  mo.tempoFrac=tempoFrac;
  mo.linear=true;
  mo.bank=bank;
  mo.grid.swap(grid);
  mo.rows=rows;
  mo.starts.push_back(0);
  int lp=(loopTick>0 && loopTick<rows)?loopTick:-1;
  if (lp>0) mo.starts.push_back(lp);
  if (loopTick>=0) {
    mo.endJump=(lp>0)?1:0;
    mo.restart=mo.endJump;
  }
  String err;
  SafeWriter* w=finishModule(mo,[this](const String& s) { logAppend(s); },err);
  if (w==NULL) {
    fail(err);
    return;
  }
  output.push_back(DivROMExportOutput(String("export")+sp.ext,w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}

// ---------------------------------------------------------------------------------------------
// editable export: the patterns of the song become the patterns of the module (one row per row),
// instruments become instruments (IT, MPTM, XM: sample map, volume envelope and, in IT/MPTM,
// the arpeggio macro as a pitch envelope) and the effects are translated.
// what the format can't do is left out, and the log says how much.

namespace {

// turns a macro into an envelope. kind 0: volume (0-64), 1: arpeggio (semitones -> IT pitch units)
MEnv macroToEnv(const DivInstrumentMacro& m, int kind, int volMax, int maxNodes) {
  MEnv en;
  if (m.len==0 || m.len>255) return en;
  if (m.open&6) return en; // ADSR/LFO macros
  int spd=MAX(1,(int)m.speed);
  int delay=m.delay;
  auto valOf=[&](int i) -> int {
    int v=m.val[i];
    if (kind==0) return MIN(64,MAX(0,(v*64+volMax/2)/MAX(1,volMax)));
    if (v&(1<<30)) return 0; // fixed note: not possible here
    v=(v<<2)>>2; // sign
    return MIN(32,MAX(-32,v*2));
  };
  std::vector<int> stepNode(m.len,0);
  if (delay>0) en.pts.push_back(std::make_pair(0,kind==0?64:0));
  for (int i=0; i<m.len; i++) {
    int x=delay+i*spd;
    int v=valOf(i);
    stepNode[i]=en.pts.size();
    en.pts.push_back(std::make_pair(x,v));
    bool changes=(i+1<m.len)?(valOf(i+1)!=v):(m.loop<m.len);
    if (spd>1 && changes) en.pts.push_back(std::make_pair(x+spd-1,v));
  }
  if (m.loop<m.len) {
    en.loopStart=stepNode[m.loop];
    en.loopEnd=en.pts.size()-1;
  }
  if (m.rel<m.len) {
    en.susStart=stepNode[m.rel];
    en.susEnd=stepNode[m.rel];
  }
  // too many nodes: drop the ones that matter least (keeping loop and sustain nodes)
  while ((int)en.pts.size()>maxNodes) {
    int best=-1;
    double bestErr=1e30;
    for (int i=1; i+1<(int)en.pts.size(); i++) {
      if (i==en.loopStart || i==en.loopEnd || i==en.susStart) continue;
      const std::pair<int,int>& a=en.pts[i-1];
      const std::pair<int,int>& b=en.pts[i];
      const std::pair<int,int>& c=en.pts[i+1];
      double t=(c.first==a.first)?0.0:(double)(b.first-a.first)/(c.first-a.first);
      double err=fabs(a.second+(c.second-a.second)*t-b.second);
      if (err<bestErr) {
        bestErr=err;
        best=i;
      }
    }
    if (best<0) {
      en.pts.resize(maxNodes);
      break;
    }
    en.pts.erase(en.pts.begin()+best);
    if (en.loopStart>best) en.loopStart--;
    if (en.loopEnd>best) en.loopEnd--;
    if (en.susStart>best) en.susStart--;
    if (en.susEnd>best) en.susEnd--;
  }
  if ((int)en.pts.size()>maxNodes) en.pts.resize(maxNodes);
  return en;
}

}

void DivExportModule::runEditable() {
  const FmtSpec& sp=specs[fmt];
  DivSubSong* sub=e->curSubSong;
  bool instMode=(fmt==RG_FMT_IT || fmt==RG_FMT_MPTM || fmt==RG_FMT_XM);
  bool linear=e->song.compatFlags.linearPitch!=0;
  int pss=MAX(1,(int)e->song.compatFlags.pitchSlideSpeed);

  // channels
  std::vector<MSrc> src;
  int totalChans=e->getTotalChannelCount();
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    int n=0;
    if (s==DIV_SYSTEM_AMIGA) {
      n=4;
    } else if (s==DIV_SYSTEM_PCM_DAC) {
      n=((DivPlatformPCMDAC*)dispatchOf(i))->chans;
    } else {
      logAppendf("WARNING: chip %d (%s) does not play samples the module can use; ignored",i,e->getSystemName(s));
      continue;
    }
    for (int j=0; j<n; j++) {
      MSrc m;
      m.sys=i;
      m.ch=j;
      m.type=s;
      m.gch=-1;
      for (int c=0; c<totalChans; c++) {
        if (e->song.dispatchOfChan[c]==i && e->song.dispatchChanOfChan[c]==j) {
          m.gch=c;
          break;
        }
      }
      if (m.gch>=0) src.push_back(m);
    }
  }
  if (src.empty()) {
    fail(_("no sample chip in this song (the module export works with Amiga and Generic PCM)"));
    return;
  }
  int nch=(int)src.size();
  if (nch>sp.maxChans) {
    fail(fmt::sprintf(_("the song has %d sample channels, but %s supports up to %d"),nch,sp.name,sp.maxChans));
    return;
  }
  progress[0].amount=0.1f;

  RGModOut mo;
  mo.fmt=fmt;
  mo.name=e->song.name;
  mo.nch=nch;
  mo.linear=linear;
  double tuneK=e->song.tuning/440.0;
  double centerRate=e->getCenterRate();

  // samples. noteOff: module note index = Furnace note + noteOff
  std::vector<MSmp> bank;
  std::vector<int> noteOff;
  std::map<int,int> bankOfSample;
  std::map<std::pair<int,int>,int> bankOfWave;
  int stretched=0;
  auto tune=[&](MSmp& m, double ref) -> int {
    // ref: playback rate of Furnace's C-4 (note 108)
    switch (fmt) {
      case RG_FMT_IT: case RG_FMT_MPTM:
        m.c5=(int)round(MIN(9999999.0,MAX(1.0,ref)));
        return -48;
      case RG_FMT_S3M:
        m.c5=(int)round(MIN(65535.0,MAX(1.0,ref)));
        return -60;
      case RG_FMT_XM: {
        double q=round(12.0*log2(ref/8363.0)*128.0)/128.0;
        m.rel=(int)floor(q+0.5);
        m.fine=(int)round((q-m.rel)*128.0);
        m.rel=MIN(95,MAX(-96,m.rel));
        m.fine=MIN(127,MAX(-128,m.fine));
        return -60;
      }
      default: {
        // MOD: index 0 = C-1 (period 856)
        double q=12.0*log2(ref/(MOD_CLOCK/856.0));
        int n0=(int)round(q);
        int fine=(int)round((q-n0)*8.0);
        if (fine>7) {
          fine-=8;
          n0++;
        }
        if (fine<-8) {
          fine+=8;
          n0--;
        }
        m.fine=fine;
        return n0-108;
      }
    }
  };
  auto sampleToBank=[&](int si, bool amiga) -> int {
    if (si<0 || si>=e->song.sampleLen) return -1;
    std::map<int,int>::iterator it=bankOfSample.find(si);
    if (it!=bankOfSample.end()) return it->second;
    DivSample* s=e->getSample(si);
    MSmp m;
    m.name=s->name;
    int len=s->samples;
    if (amiga) {
      int end=MIN((int)s->samples,s->getLoopEndPosition(DIV_SAMPLE_DEPTH_8BIT));
      for (int k=0; k<end; k++) m.data.push_back(s->data8==NULL?0:(short)(s->data8[k]*256));
      if (s->isLoopable()) {
        m.loopType=1;
        m.loopStart=s->getLoopStartPosition(DIV_SAMPLE_DEPTH_8BIT)&(~1);
        m.loopEnd=end;
      }
    } else {
      if (s->data16!=NULL && s->depth!=DIV_SAMPLE_DEPTH_8BIT) {
        m.bits16=true;
        for (int k=0; k<len; k++) m.data.push_back(s->data16[k]);
      } else if (s->data8!=NULL) {
        for (int k=0; k<len; k++) m.data.push_back((short)(s->data8[k]*256));
      }
      if (s->isLoopable()) {
        m.loopType=(s->loopMode==DIV_SAMPLE_LOOP_PINGPONG)?2:1;
        m.loopStart=s->loopStart;
        m.loopEnd=MIN(s->loopEnd,len);
        if (m.loopEnd<len) m.data.resize(m.loopEnd);
      }
    }
    if (m.data.empty()) m.data.push_back(0);
    if (fmt==RG_FMT_MOD) {
      // MOD: 128KB at most; halve the rate until it fits (the notes go up an octave each time)
      while (m.data.size()>131070) {
        std::vector<short> nd;
        for (size_t k=0; k+1<m.data.size(); k+=2) nd.push_back((m.data[k]+m.data[k+1])/2);
        m.data.swap(nd);
        m.loopStart/=2;
        m.loopEnd/=2;
        m.scale*=2;
        stretched++;
      }
    }
    double ref=8372.0*(s->centerRate>=1?s->centerRate:centerRate)/centerRate*tuneK;
    ref/=m.scale;
    int idx=(int)bank.size();
    noteOff.push_back(tune(m,ref));
    bank.push_back(m);
    bankOfSample[si]=idx;
    return idx;
  };
  auto waveToBank=[&](int wi, int len) -> int {
    if (wi<0 || wi>=e->song.waveLen) return -1;
    std::pair<int,int> key(wi,len);
    std::map<std::pair<int,int>,int>::iterator it=bankOfWave.find(key);
    if (it!=bankOfWave.end()) return it->second;
    DivWavetable* wt=e->song.wave[wi];
    MSmp m;
    m.name=fmt::sprintf("wave %d",wi);
    m.isWave=true;
    int wl=MAX(1,wt->len);
    int top=MAX(1,wt->max);
    if (len<2) len=wl;
    for (int k=0; k<len; k++) {
      int v=wt->data[(k*wl)/len];
      m.data.push_back((short)(((v*255)/top-128)*256));
    }
    m.loopType=1;
    m.loopStart=0;
    m.loopEnd=len;
    double ref=261.6255653*len*tuneK;
    int idx=(int)bank.size();
    noteOff.push_back(tune(m,ref));
    bank.push_back(m);
    bankOfWave[key]=idx;
    return idx;
  };

  // which instruments play on these channels
  std::vector<bool> chipIsAmiga(nch);
  std::vector<int> volMaxOf(nch,64);
  for (int c=0; c<nch; c++) {
    chipIsAmiga[c]=(src[c].type==DIV_SYSTEM_AMIGA);
    if (src[c].type==DIV_SYSTEM_PCM_DAC) volMaxOf[c]=MAX(1,((DivPlatformPCMDAC*)dispatchOf(src[c].sys))->volMax);
  }
  // sample of instrument ins at Furnace note fn (bank index, -1: none)
  auto bankFor=[&](int ins, int fn, bool amiga) -> int {
    if (ins<0 || ins>=e->song.insLen) return -1;
    DivInstrument* in=e->song.ins[ins];
    if (in->amiga.useWave) {
      int wl=amiga?((int)in->amiga.waveLen+1):0;
      return waveToBank(in->ws.wave1,wl);
    }
    return sampleToBank(in->amiga.getSample(fn),amiga);
  };

  // module instruments (IT, MPTM, XM)
  std::map<int,int> insOf;
  auto insToModule=[&](int ins, bool amiga, int volMax) -> int {
    if (ins<0 || ins>=e->song.insLen) return -1;
    std::map<int,int>::iterator it=insOf.find(ins);
    if (it!=insOf.end()) return it->second;
    DivInstrument* in=e->song.ins[ins];
    MIns mi;
    mi.name=in->name;
    int off=(fmt==RG_FMT_XM)?-60:-48;
    for (int n=0; n<120; n++) {
      int fn=n-off;
      mi.keymap[n]=bankFor(ins,fn,amiga);
    }
    int maxNodes=(fmt==RG_FMT_XM)?12:25;
    mi.vol=macroToEnv(in->std.volMacro,0,amiga?64:64,maxNodes);
    if (fmt!=RG_FMT_XM) mi.pitch=macroToEnv(in->std.arpMacro,1,0,maxNodes);
    (void)volMax;
    int idx=(int)mo.ins.size();
    mo.ins.push_back(mi);
    insOf[ins]=idx;
    return idx;
  };

  // speed and tempo
  int speed=MAX(1,(int)sub->speeds.val[0]);
  double hz=sub->hz;
  if (hz<=0) hz=60;
  double tempoD=hz*2.5*(double)MAX(1,(int)sub->virtualTempoN)/(double)MAX(1,(int)sub->virtualTempoD);
  if (tempoD>sp.maxTempo+0.5) {
    fail(fmt::sprintf(_("the song runs at %.2f ticks per second, too fast for %s (up to %.1f)%s"),tempoD/2.5,sp.name,sp.maxTempo/2.5,(fmt==RG_FMT_MPTM)?"":_(".\nexport it as MPTM, which goes up to 400 ticks per second.")));
    return;
  }
  if (tempoD<32) {
    fail(fmt::sprintf(_("the song runs at %.2f ticks per second, too slow for a module (at least 12.8)"),tempoD/2.5));
    return;
  }
  int tempo=(int)round(tempoD);
  int tempoFrac=0;
  if (fmt==RG_FMT_MPTM) {
    tempo=(int)floor(tempoD);
    tempoFrac=(int)round((tempoD-tempo)*10000.0);
    if (tempoFrac>=10000) {
      tempo++;
      tempoFrac=0;
    }
  }
  if (fmt==RG_FMT_MOD || fmt==RG_FMT_XM) {
    if (speed>31) speed=31;
  }
  mo.speed=speed;
  mo.tempo=tempo;
  mo.tempoFrac=tempoFrac;

  // channel panning
  for (int c=0; c<nch; c++) {
    int pan=32;
    if (src[c].type==DIV_SYSTEM_AMIGA) {
      int sep=e->song.systemFlags[src[c].sys].getInt("stereoSep",0)&127;
      pan=(src[c].ch==0 || src[c].ch==3)?(32-(32*sep)/127):(32+(32*sep)/127);
    }
    mo.chPan.push_back(pan);
  }

  // patterns
  int patLen=sub->patLen;
  int ordLen=sub->ordersLen;
  int rows=patLen*ordLen;
  mo.rows=rows;
  mo.grid.resize((size_t)rows*nch);
  for (int o=0; o<ordLen; o++) mo.starts.push_back(o*patLen);
  mo.restart=0;

  struct ChState {
    int arp, slide, porta, vib, trem, volslide, vol, ins, note, pan;
    ChState(): arp(0), slide(0), porta(0), vib(0), trem(0), volslide(0), vol(64), ins(-1), note(-1), pan(32) {}
  };
  int dropped=0, unsupported=0, outOfRange=0;
  bool grooveWarned=false;
  // slide speed (Furnace units) to the module's units at Furnace note fn
  auto slideTo=[&](int xx, int fn) -> int {
    if (xx<=0) return 0;
    if (fmt==RG_FMT_MOD || fmt==RG_FMT_S3M) {
      if (!linear) return xx;
      double semis=(double)xx*pss/128.0;
      double freq=8363.0*pow(2.0,(fn-108)/12.0);
      double per=MOD_CLOCK/freq;
      return MAX(1,(int)round(per*(pow(2.0,semis/12.0)-1.0)));
    }
    if (!linear) return xx;
    return MAX(1,(int)round((double)xx*pss/8.0));
  };
  for (int c=0; c<nch; c++) {
    ChState cs;
    cs.pan=mo.chPan[c];
    int gch=src[c].gch;
    bool amiga=chipIsAmiga[c];
    int volMax=volMaxOf[c];
    int fxCols=sub->pat[gch].effectCols;
    for (int o=0; o<ordLen; o++) {
      DivPattern* p=sub->pat[gch].getPattern(sub->orders.ord[gch][o],false);
      for (int r=0; r<patLen; r++) {
        int row=o*patLen+r;
        Cell& cell=mo.grid[(size_t)row*nch+c];
        short* d=p->newData[r];
        int note=d[DIV_PAT_NOTE];
        int ins=d[DIV_PAT_INS];
        int vol=d[DIV_PAT_VOL];
        if (ins>=0) cs.ins=ins;
        bool newNote=(note>=0 && note<180);
        bool portaRow=false;
        int noteDelay=-1, noteCut=-1, offset=-1, retrig=-1;
        int fineSlide=0, fineVol=0, panSet=-1;
        bool volSlideSet=false;
        for (int k=0; k<fxCols && k<DIV_MAX_EFFECTS; k++) {
          int fx=d[DIV_PAT_FX(k)];
          int fv=d[DIV_PAT_FXVAL(k)];
          if (fx<0) continue;
          if (fv<0) fv=0;
          switch (fx) {
            case 0x00: cs.arp=fv; break;
            case 0x01: cs.slide=fv; cs.porta=0; break;
            case 0x02: cs.slide=-fv; cs.porta=0; break;
            case 0x03: cs.porta=fv; cs.slide=0; break;
            case 0x04: cs.vib=(fv&15)?fv:0; break;
            case 0x05: cs.volslide=(fv>>4)?(fv>>4):-(fv&15); volSlideSet=true; break;
            case 0x06: cs.volslide=(fv>>4)?(fv>>4):-(fv&15); volSlideSet=true; break;
            case 0x07: cs.trem=(fv&15)?fv:0; break;
            case 0x08: {
              int l=fv>>4, rr=fv&15;
              panSet=(l+rr>0)?((64*rr+(l+rr)/2)/(l+rr)):32;
              break;
            }
            case 0x80: panSet=(fv*64+127)/255; break;
            case 0x09: case 0x0f:
              mo.ctl.push_back({row,FX_SPEED,fv});
              break;
            case 0xf0:
              mo.ctl.push_back({row,FX_TEMPO,fv});
              break;
            case 0x0a: cs.volslide=(fv>>4)?(fv>>4):-(fv&15); volSlideSet=true; break;
            case 0x0b: mo.ctl.push_back({row,FX_JUMP,-1-MIN(ordLen-1,fv)}); break;
            case 0x0c: retrig=fv; break;
            case 0x0d: mo.ctl.push_back({row,FX_BREAK,fv}); break;
            case 0x90: offset=fv; break;
            case 0xec: noteCut=fv; break;
            case 0xed: noteDelay=fv; break;
            case 0xf1: fineSlide=fv; break;
            case 0xf2: fineSlide=-fv; break;
            case 0xf3: case 0xf8: fineVol=fv; break;
            case 0xf4: case 0xf9: fineVol=-fv; break;
            case 0xfa: cs.volslide=(fv>>4)?((fv>>4)*4):-((fv&15)*4); volSlideSet=true; break;
            default:
              unsupported++;
              break;
          }
        }
        (void)volSlideSet;
        if (newNote && cs.porta>0) portaRow=true;
        // note
        int fn=newNote?note:cs.note;
        if (newNote) {
          int b=bankFor(cs.ins,note,amiga);
          int mn=note+((fmt==RG_FMT_MOD)?(b>=0?noteOff[b]:-108+24):(fmt==RG_FMT_XM||fmt==RG_FMT_S3M)?-60:-48);
          while (mn<0) {
            mn+=12;
            outOfRange++;
          }
          while (mn>=sp.maxNote) {
            mn-=12;
            outOfRange++;
          }
          cell.note=mn;
          cs.note=note;
          if (!portaRow) {
            if (instMode) {
              int mi=insToModule(cs.ins,amiga,volMax);
              cell.ins=(mi>=0)?mi+1:0;
            } else {
              cell.ins=(b>=0)?b+1:0;
            }
            // the note brings the default volume
            if (vol<0 && cs.vol!=64) vol=-2;
            if (fmt==RG_FMT_XM) cs.pan=32;
          }
        } else if (note==DIV_NOTE_OFF) {
          cell.note=NOTE_CUT;
        } else if (note==DIV_NOTE_REL || note==DIV_MACRO_REL) {
          if (instMode) cell.note=NOTE_OFF;
        }
        // volume
        if (vol>=0) cs.vol=MIN(64,(vol*64+volMax/2)/volMax);
        bool volUsed=false;
        if (vol>=0 || vol==-2) {
          if (sp.hasVolCol) {
            cell.vtype=VC_VOL;
            cell.vval=cs.vol;
            volUsed=true;
          }
        }
        // effects wanted on this row, most important first
        std::vector<std::pair<int,int>> want;
        if (noteDelay>=0) want.push_back(std::make_pair((int)FX_NOTEDELAY,noteDelay));
        if (offset>=0) want.push_back(std::make_pair((int)FX_OFFSET,offset));
        if (noteCut>=0) want.push_back(std::make_pair((int)FX_NOTECUT,noteCut));
        if (retrig>=0) want.push_back(std::make_pair((int)FX_RETRIG,retrig));
        if ((vol>=0 || vol==-2) && !sp.hasVolCol) want.push_back(std::make_pair((int)FX_VOL,cs.vol));
        if (cs.porta>0 && fn>=0) want.push_back(std::make_pair((int)FX_TONEPORTA,slideTo(cs.porta,fn)));
        if (cs.slide!=0 && fn>=0) want.push_back(std::make_pair((int)FX_SLIDE_R,(cs.slide>0?1:-1)*slideTo(abs(cs.slide),fn)));
        if (fineSlide!=0 && fn>=0) want.push_back(std::make_pair((int)FX_SLIDE_F,(fineSlide>0?1:-1)*MIN(15,slideTo(abs(fineSlide),fn))));
        if (cs.arp) want.push_back(std::make_pair((int)FX_ARP,cs.arp));
        if (cs.vib) want.push_back(std::make_pair((int)FX_VIBRATO,cs.vib));
        if (cs.volslide) want.push_back(std::make_pair((int)FX_VOLSLIDE,cs.volslide*64/MAX(1,amiga?64:volMax)==0?(cs.volslide>0?1:-1):cs.volslide*64/(amiga?64:volMax)));
        if (fineVol) want.push_back(std::make_pair((int)FX_FINEVOL,fineVol));
        if (panSet>=0 && panSet!=cs.pan) {
          want.push_back(std::make_pair((int)FX_PAN,panSet));
          cs.pan=panSet;
        }
        if (cs.trem) want.push_back(std::make_pair((int)FX_TREMOLO,cs.trem));
        for (std::pair<int,int>& wf: want) {
          int cmd, par;
          if (!encFx(fmt,wf.first,wf.second,cmd,par)) {
            // the volume column may take it
            if (wf.first==FX_PAN || wf.first==FX_VOLSLIDE || wf.first==FX_FINEVOL || wf.first==FX_TONEPORTA) {
              // handled below
            } else {
              continue;
            }
          }
          if (cell.fx==FX_NONE && encFx(fmt,wf.first,wf.second,cmd,par)) {
            cell.fx=wf.first;
            cell.fv=wf.second;
            continue;
          }
          if (instMode && !volUsed && sp.hasVolCol) {
            int vt=VC_NONE, vv=0;
            switch (wf.first) {
              case FX_PAN: vt=VC_PAN; vv=wf.second; break;
              case FX_VOLSLIDE: vt=(wf.second>0)?VC_SLIDE_UP:VC_SLIDE_DOWN; vv=abs(wf.second); break;
              case FX_FINEVOL: vt=(wf.second>0)?VC_FINE_UP:VC_FINE_DOWN; vv=abs(wf.second); break;
              case FX_TONEPORTA: vt=VC_PORTA; vv=wf.second; break;
            }
            if (vt!=VC_NONE) {
              cell.vtype=vt;
              cell.vval=vv;
              volUsed=true;
              continue;
            }
          }
          dropped++;
        }
      }
    }
    progress[0].amount=0.1f+0.6f*(c+1)/nch;
  }
  // grooves and alternating speeds: a speed change on every row
  if (sub->speeds.len>1) {
    bool same=true;
    for (int i=1; i<sub->speeds.len; i++) if (sub->speeds.val[i]!=sub->speeds.val[0]) same=false;
    if (!same) {
      if (!grooveWarned) logAppend("note: the song alternates speeds; every row gets a speed effect");
      grooveWarned=true;
      for (int row=0; row<rows; row++) {
        mo.ctl.push_back({row,FX_SPEED,(int)sub->speeds.val[(row%patLen)%sub->speeds.len]});
      }
    }
  }
  if ((int)bank.size()>sp.maxSamples) {
    fail(fmt::sprintf(_("the song uses %d different samples (and waves), but %s supports up to %d"),(int)bank.size(),sp.name,sp.maxSamples));
    return;
  }
  if (bank.empty()) {
    fail(_("the song plays no samples"));
    return;
  }
  if (fmt==RG_FMT_IT && bank.size()>99) logAppendf("WARNING: %d samples: more than Impulse Tracker itself supports (99); OpenMPT and other players are fine",(int)bank.size());
  if (stretched) logAppendf("note: %d samples were halved in rate to fit 128KB",stretched);
  if (outOfRange) logAppendf("WARNING: %d notes were moved by octaves to fit the %s note range",outOfRange,sp.name);
  if (dropped) logAppendf("note: %d effects did not fit in the columns of %s and were left out",dropped,sp.name);
  if (unsupported) logAppendf("note: %d effects have no equivalent in modules and were left out",unsupported);
  {
    bool waveSynth=false;
    for (int i=0; i<e->song.insLen; i++) {
      DivInstrument* in=e->song.ins[i];
      if (in->amiga.useWave && (in->std.waveMacro.len || in->ws.enabled)) waveSynth=true;
    }
    if (waveSynth) logAppend("note: wave macros and the wave synthesizer change the wave while it plays; only the first wave is kept (use the faithful mode to keep them)");
  }
  if (!instMode) {
    bool hasMacro=false;
    for (int i=0; i<e->song.insLen; i++) {
      if (e->song.ins[i]->std.volMacro.len || e->song.ins[i]->std.arpMacro.len) hasMacro=true;
    }
    if (hasMacro) logAppendf("note: %s has no envelopes, so instrument macros are left out (use the faithful mode to keep them)",sp.name);
  }
  mo.bank=bank;
  String err;
  SafeWriter* w=finishModule(mo,[this](const String& s) { logAppend(s); },err);
  if (w==NULL) {
    fail(err);
    return;
  }
  output.push_back(DivROMExportOutput(String("export")+sp.ext,w));
  progress[0].amount=1.0f;
  logAppend("finished!");
  running=false;
}
