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

// Registro Gamer: sample tools in the spirit of OpenMPT's sample editor.
// they work on 8 and 16-bit samples; start/end select a range (end exclusive).

#ifndef _RG_SAMPLE_TOOLS_H
#define _RG_SAMPLE_TOOLS_H

#include "sample.h"

// removes the DC offset (the average) of the range
bool rgSampleRemoveDC(DivSample* s, unsigned int start, unsigned int end);
// short fades at both ends of the range (removes clicks); len in frames
bool rgSampleDeclick(DivSample* s, unsigned int start, unsigned int end, int len);
// pitch of the sample (Hz) when it plays at its C-4 rate (centerRate); 0 if none was found
double rgSampleDetectPitch(DivSample* s);
// new centerRate so the sample sounds a C (toC) or the nearest note at C-4; 0 if no pitch was found
int rgSampleAutoTune(DivSample* s, float tuning, bool toC, double* pitchOut=NULL);
// moves the loop points to the nearest zero crossings (rising, like the start of a cycle)
bool rgSampleSnapLoop(DivSample* s);
// changes the length by factor without changing the pitch (overlap-add with waveform matching)
bool rgSampleTimeStretch(DivSample* s, double factor);
// changes the pitch by semitones without changing the length
bool rgSamplePitchShift(DivSample* s, double semitones);

#endif
