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

// Registro Gamer: Sony PlayStation SPU (24 ADPCM voices, 512KB of sound RAM).

#ifndef _PSX_H
#define _PSX_H

#include "../dispatch.h"
#include "../../fixedQueue.h"

// the SPU itself (registers as 16-bit words at 1F801C00h, byte offset 0-3FEh)
struct PSXSPUCore {
  struct Voice {
    unsigned int addr, repeat, counter;
    int pos;
    short dec[28];
    short hist[4];
    int s1, s2;
    unsigned char flags;
    // ADSR: 0 off, 1 attack, 2 decay, 3 sustain, 4 release
    int phase, level, wait;
    bool on;
  };
  unsigned char* ram;
  unsigned short regs[0x200];
  Voice v[24];
  unsigned int endx;
  void reset();
  void write(unsigned short addr, unsigned short val);
  void keyOn(int i);
  void keyOff(int i);
  void decode(Voice& vo);
  void advance(int i);
  void envelope(int i);
  // renders one sample at 44100Hz; chOut gets each voice's output (for the oscilloscope)
  void tick(int& outL, int& outR, int* chOut);
};

class DivPlatformPSX: public DivDispatch {
  struct Channel: public SharedChannel {
    int sample;
    int panL, panR;
    int macroVolMul;
    Channel(bool linear=true):
      SharedChannel(127,linear),
      sample(-1),
      panL(255),
      panR(255),
      macroVolMul(64) {}
  };
  Channel chan[24];
  DivDispatchOscBuffer* oscBuf[24];
  bool isMuted[24];
  struct QueuedWrite {
    unsigned short addr;
    unsigned short val;
    QueuedWrite(): addr(0), val(0) {}
    QueuedWrite(unsigned short a, unsigned short v): addr(a), val(v) {}
  };
  FixedQueue<QueuedWrite,2048> writes;
  DivPitchTableManager samplePitchTable;

  unsigned char* sampleMem;
  size_t sampleMemLen;
  unsigned int* sampleOff;
  bool* sampleLoaded;
  PSXSPUCore spu;
  DivMemoryComposition memCompo;
  unsigned short regPool[0x200];
  unsigned int konMask, koffMask;
  friend void putDispatchChip(void*,int);
  friend void putDispatchChan(void*,int,int);

  void writeOutVol(int ch);

  public:
    void acquire(short** buf, size_t len) override;
    int dispatch(DivCommand c) override;
    SharedChannel* getChanState(int chan) override;
    DivMacroInt* getChanMacroInt(int ch) override;
    unsigned short getPan(int chan) override;
    DivDispatchOscBuffer* getOscBuffer(int chan) override;
    unsigned char* getRegisterPool() override;
    int getRegisterPoolSize() override;
    int getRegisterPoolDepth() override;
    void reset() override;
    void forceIns() override;
    void tick(bool sysTick=true) override;
    void muteChannel(int ch, bool mute) override;
    int getOutputCount() override;
    bool hasSoftPan(int ch) override;
    void notifyInsChange(int ins) override;
    void notifyInsDeletion(void* ins) override;
    void notifyPitchTable(int sample=-1) override;
    unsigned int getMaxFreq(int ch) override;
    void poke(unsigned int addr, unsigned short val) override;
    void poke(std::vector<DivRegWrite>& wlist) override;
    const char** getRegisterSheet() override;
    const void* getSampleMem(int index=0) override;
    size_t getSampleMemCapacity(int index=0) override;
    size_t getSampleMemUsage(int index=0) override;
    bool isSampleLoaded(int index, int sample) override;
    const DivMemoryComposition* getMemCompo(int index) override;
    void renderSamples(int chipID) override;
    void setFlags(const DivConfig& flags) override;
    int init(DivEngine* parent, int channels, int sugRate, const DivConfig& flags) override;
    void quit() override;
    DivPlatformPSX();
    ~DivPlatformPSX();
};

#endif
