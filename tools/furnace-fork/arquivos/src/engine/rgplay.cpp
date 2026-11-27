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

// Registro Gamer: headless playback used by the Chiptune Player build (rgplayer.cpp).

#include "engine.h"

bool DivEngine::rgPlayStart(int rate) {
  stop();
  repeatPattern=false;
  setOrder(0);
  remainingLoops=-1;
  got.rate=rate;
  quitDispatch();
  initDispatch(true);
  renderSamplesP();
  playSub(false);
  freelance=false;
  return playing;
}

bool DivEngine::rgHasOriginal() {
  return song.systemFlags[0].getString("rgVgeData","")!="" || song.systemFlags[0].getString("rgBTData","")!="";
}

void DivEngine::rgSetOriginalPlayer(bool on) {
  bool vge=song.systemFlags[0].getString("rgVgeData","")!="";
  bool bt=song.systemFlags[0].getString("rgBTData","")!="";
  if (!vge && !bt) return;
  bool wasPlaying=isPlaying();
  if (wasPlaying) stop();
  BUSY_BEGIN;
  if (vge) song.compatFlags.rgVGMMM=on;
  if (bt) {
    song.compatFlags.rgBT=on;
    song.compatFlags.rgBTNative=!on;
  }
  // as escritas do tocador original e as do Furnace usam o chip de jeitos diferentes: recomeça o chip
  quitDispatch();
  initDispatch();
  renderSamples();
  reset();
  BUSY_END;
  calcSongTimestamps();
}

bool DivEngine::rgPlayRender(float* l, float* r, unsigned int n) {
  float* out[2]={l,r};
  for (unsigned int i=0; i<n; i++) {
    l[i]=0;
    r[i]=0;
  }
  if (!playing) return false;
  nextBuf(NULL,out,0,2,n,true);
  return playing;
}

double DivEngine::rgPlaySeek(double sec) {
  if (!rgPlayStart(got.rate)) return 0;
  if (sec<=0) return 0;
  // RG: VGM Music Maker: o tocador do VGMMM começa direto na linha (como o "tocar daqui" do programa)
  if (rgVgeOn || rgBTOn) {
    calcSongTimestamps();
    DivSongTimestamps& ts=curSubSong->ts;
    int bo=0, br=0;
    double bt=-1;
    for (int o=0; o<curSubSong->ordersLen; o++) {
      for (int r=0; r<DIV_MAX_ROWS; r++) {
        TimeMicros t=ts.getTimes(o,r);
        if (t.seconds<0) continue;
        double d=t.toDouble();
        if (d<=sec && d>bt) {
          bt=d;
          bo=o;
          br=r;
        }
      }
    }
    curOrder=bo;
    playSub(false,br);
    return totalTime.toDouble();
  }
  // like playSub(): run the ticks with the chips' register writes muted, then make them write everything again
  skipping=true;
  for (int i=0; i<song.systemLen; i++) disCont[i].dispatch->setSkipRegisterWrites(true);
  while (playing && totalTime.toDouble()<sec) {
    if (nextTick(false)) break;
  }
  skipping=false;
  cmdStream.clear();
  for (int i=0; i<song.systemLen; i++) {
    disCont[i].dispatch->setSkipRegisterWrites(false);
    disCont[i].dispatch->forceIns();
  }
  return totalTime.toDouble();
}

void DivEngine::rgPlayTimes(double& total, double& loopStart, bool& loops) {
  calcSongTimestamps();
  DivSongTimestamps& ts=curSubSong->ts;
  total=ts.totalTime.toDouble();
  loops=ts.isLoopable;
  loopStart=loops?ts.loopStartTime.toDouble():total;
}
