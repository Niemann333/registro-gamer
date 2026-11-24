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

// Registro Gamer: base for the console-format exporters (NSF, SPC, PSF).
// they all work the same way: play the song once, record every register write of
// the chips per tick, and pack that log together with a small native player program
// (6502 for NSF, SPC700 for SPC, MIPS for PSF) that replays it on the real hardware.

#ifndef _RG_EXPORT_H
#define _RG_EXPORT_H

#include "../export.h"
#include "../dispatch.h"
#include <thread>
#include <functional>
#include <vector>

struct RGWrite {
  int sys;
  unsigned int addr;
  unsigned int val;
  RGWrite(int s, unsigned int a, unsigned int v): sys(s), addr(a), val(v) {}
};

class DivExportRG: public DivROMExport {
  protected:
    DivEngine* e;
    std::thread* exportThread;
    DivROMExportProgress progress[2];
    bool running, failed, mustAbort;

    // capture result: writes of each tick (tick 0 also holds the chip reset writes)
    std::vector<std::vector<RGWrite>> ticks;
    // tick where the song loops back to (-1: song ends)
    int loopTick;
    // tick rate of the song
    double tickRate;
    // called after each captured tick (inside the engine lock), with the tick number
    std::function<void(int)> tickHook;

    virtual void run()=0;
    void fail(const String& why);
    // plays the song and records the register writes of the given systems
    bool capture(const std::vector<int>& sys);
    // dispatch of a system
    DivDispatch* dispatchOf(int sys);
    // sample memory of a system (after capture)
    const unsigned char* sampleMem(int sys, int index, size_t& len);
    // compresses a list of player commands: repeated runs become $E0 lo hi [hh] len_lo len_hi,
    // "play len bytes found at address hi:lo, then come back" (nested up to maxDepth levels).
    // base: address where the result will be loaded. loopTok: command where the loop starts;
    // its offset in the result goes to loopOut.
    // shortRef: refs up to 255 bytes become $E1 lo hi len, and a ref is used whenever it saves a byte
    // (the deepest nesting used goes to depthOut); tries: earlier copies looked at for each command.
    std::vector<unsigned char> pack(const std::vector<std::vector<unsigned char>>& tok, int loopTok, unsigned int base, int maxDepth, int& loopOut, int addrBytes=2, bool shortRef=false, int* depthOut=NULL, int tries=32, int minGain=1);
    // runs run() in a thread (or directly in the browser, which has no threads here)
    void start();
  public:
    bool go(DivEngine* e);
    bool isRunning();
    bool hasFailed();
    void abort();
    void wait();
    DivROMExportProgress getProgress(int index=0);
    virtual ~DivExportRG() {}
};

#endif
