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

#include "rgexport.h"
#include "../engine.h"
#include "../ta-log.h"
#include <map>
#include <unordered_map>

// a song that never ends is cut after this many ticks (1 hour at 60Hz)
#define RG_MAX_TICKS (60*60*60)

void DivExportRG::fail(const String& why) {
  logAppend("ERROR: "+why);
  failed=true;
  running=false;
}

bool DivExportRG::capture(const std::vector<int>& sys) {
  ticks.clear();
  loopTick=-1;
  tickRate=e->curSubSong->hz;
  if (tickRate<=0) tickRate=60;

  e->stop();
  e->repeatPattern=false;
  e->setOrder(0);
  logAppend("playing and logging register writes...");

  bool ok=true;
  e->synchronizedSoft([&]() {
    double origRate=e->got.rate;
    e->got.rate=44100;

    e->calcSongTimestamps();
    int loopOrder=e->curSubSong->ts.loopStart.order;
    int loopRow=e->curSubSong->ts.loopStart.row;
    bool loopable=e->curSubSong->ts.isLoopable;
    logAppendf("loop point: %d %d%s",loopOrder,loopRow,loopable?"":" (song ends)");
    e->warnings="";

    e->curOrder=0;
    e->freelance=false;
    e->playing=false;
    e->extValuePresent=false;
    e->remainingLoops=-1;

    for (int i: sys) {
      e->disCont[i].dispatch->toggleRegisterDump(true);
      e->disCont[i].dispatch->getRegisterWrites().clear();
    }
    e->playSub(false);

    std::vector<RGWrite> pre;
    auto collect=[&](std::vector<RGWrite>& out) {
      for (int i: sys) {
        std::vector<DivRegWrite>& writes=e->disCont[i].dispatch->getRegisterWrites();
        for (DivRegWrite& w: writes) out.push_back(RGWrite(i,w.addr,w.val));
        writes.clear();
      }
    };
    collect(pre);

    while (true) {
      if (loopTick<0 && loopable && loopOrder==e->curOrder && loopRow==e->curRow) {
        if ((e->ticks-((e->tempoAccum+e->virtualTempoN)/e->virtualTempoD))<=0) {
          loopTick=(int)ticks.size();
        }
      }
      if (e->nextTick(false,true) || !e->playing) break;
      ticks.push_back(pre);
      pre.clear();
      collect(ticks.back());
      if (ticks.size()>=RG_MAX_TICKS) {
        logAppend("song too long; cutting at one hour");
        break;
      }
      if (mustAbort) {
        ok=false;
        break;
      }
    }
    if (ticks.empty()) ticks.push_back(pre);
    if (!loopable) loopTick=-1;

    for (int i=0; i<e->song.systemLen; i++) {
      e->disCont[i].dispatch->getRegisterWrites().clear();
    }
    for (int i: sys) e->disCont[i].dispatch->toggleRegisterDump(false);
    e->got.rate=origRate;
    e->remainingLoops=-1;
    e->playing=false;
    e->freelance=false;
    e->extValuePresent=false;
  });
  logAppendf("%d ticks at %.2fHz, loop at tick %d",(int)ticks.size(),tickRate,loopTick);
  return ok;
}

DivDispatch* DivExportRG::dispatchOf(int sys) {
  return e->disCont[sys].dispatch;
}

const unsigned char* DivExportRG::sampleMem(int sys, int index, size_t& len) {
  DivDispatch* d=e->disCont[sys].dispatch;
  len=d->getSampleMemUsage(index);
  return (const unsigned char*)d->getSampleMem(index);
}

std::vector<unsigned char> DivExportRG::pack(const std::vector<std::vector<unsigned char>>& tok, int loopTok, unsigned int base, int maxDepth, int& loopOut, int addrBytes) {
  size_t n=tok.size();
  // give each distinct command a number
  std::vector<int> id(n), sz(n);
  {
    std::map<std::vector<unsigned char>,int> ids;
    for (size_t i=0; i<n; i++) {
      std::map<std::vector<unsigned char>,int>::iterator it=ids.find(tok[i]);
      if (it==ids.end()) {
        int nid=(int)ids.size();
        ids[tok[i]]=nid;
        id[i]=nid;
      } else {
        id[i]=it->second;
      }
      sz[i]=tok[i].size();
    }
  }
  // boundary[r]: offset in the output where command r starts an item (-1: inside an item)
  // depthAt[r]: nesting depth of the item starting at r
  std::vector<int> boundary(n+1,-1), depthAt(n+1,0), itemEnd(n+1,0);
  std::unordered_map<uint64_t,std::vector<int>> seen;
  auto keyOf=[&](size_t i) -> uint64_t {
    uint64_t a=(uint64_t)id[i];
    uint64_t b=(i+1<n)?(uint64_t)id[i+1]:0xffffffffULL;
    return (a<<32)^b;
  };
  std::vector<unsigned char> out;
  loopOut=-1;
  size_t i=0;
  long long budget=400000000LL;
  while (i<n) {
    boundary[i]=(int)out.size();
    if ((int)i==loopTok) loopOut=(int)out.size();
    int bestBytes=0, bestK=0, bestJ=-1, bestDepth=0;
    bool isEnd=(tok[i].size()==1 && tok[i][0]==0xff);
    if (!isEnd && budget>0) {
      std::unordered_map<uint64_t,std::vector<int>>::iterator it=seen.find(keyOf(i));
      if (it!=seen.end()) {
        std::vector<int>& cand=it->second;
        int tries=0;
        for (int ci=(int)cand.size()-1; ci>=0 && tries<32; ci--, tries++) {
          int j=cand[ci];
          int k=0, raw=0, depth=0;
          while (i+k<n && j+k<(int)i) {
            if (k>0 && (int)(i+k)==loopTok) break;
            if (id[j+k]!=id[i+k]) break;
            if (tok[i+k].size()==1 && tok[i+k][0]==0xff) break;
            // whole items only: j+k must start an item, and the item must end inside the match
            if (boundary[j+k]>=0) {
              if (depthAt[j+k]>depth) depth=depthAt[j+k];
            }
            raw+=sz[i+k];
            k++;
            budget--;
            if (boundary[j+k]>=0 || j+k==(int)i) {
              int span=((j+k==(int)i)?(int)out.size():boundary[j+k])-boundary[j];
              if (span>65535) break;
              if (raw>bestBytes && depth+1<=maxDepth) {
                bestBytes=raw;
                bestK=k;
                bestJ=j;
                bestDepth=depth+1;
              }
            }
          }
        }
      }
    }
    if (bestBytes>=8) {
      unsigned int addr=base+boundary[bestJ];
      int span=((bestJ+bestK==(int)i)?(int)out.size():boundary[bestJ+bestK])-boundary[bestJ];
      out.push_back(0xe0);
      out.push_back(addr&0xff);
      out.push_back((addr>>8)&0xff);
      if (addrBytes>2) out.push_back((addr>>16)&0xff);
      out.push_back(span&0xff);
      out.push_back(span>>8);
      depthAt[i]=bestDepth;
      seen[keyOf(i)].push_back(i);
      i+=bestK;
    } else {
      out.insert(out.end(),tok[i].begin(),tok[i].end());
      depthAt[i]=0;
      seen[keyOf(i)].push_back(i);
      i++;
    }
  }
  boundary[n]=(int)out.size();
  return out;
}

void DivExportRG::start() {
#ifdef __EMSCRIPTEN__
  // no threads in the browser build: export right away
  exportThread=NULL;
  run();
#else
  exportThread=new std::thread(&DivExportRG::run,this);
#endif
}

bool DivExportRG::go(DivEngine* eng) {
  progress[0].name="Progress";
  progress[0].amount=0.0f;
  e=eng;
  running=true;
  failed=false;
  mustAbort=false;
  exportThread=NULL;
  start();
  return true;
}

void DivExportRG::wait() {
  if (exportThread!=NULL) {
    exportThread->join();
    delete exportThread;
    exportThread=NULL;
  }
}

void DivExportRG::abort() {
  mustAbort=true;
  wait();
}

bool DivExportRG::isRunning() {
  return running;
}

bool DivExportRG::hasFailed() {
  return failed;
}

DivROMExportProgress DivExportRG::getProgress(int index) {
  if (index<0 || index>1) return progress[1];
  return progress[index];
}
