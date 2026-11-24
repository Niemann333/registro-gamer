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

void DivEngine::rgPlayTimes(double& total, double& loopStart, bool& loops) {
  calcSongTimestamps();
  DivSongTimestamps& ts=curSubSong->ts;
  total=ts.totalTime.toDouble();
  loops=ts.isLoopable;
  loopStart=loops?ts.loopStartTime.toDouble():total;
}
