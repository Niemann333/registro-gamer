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

// Registro Gamer: module export (MOD, S3M, XM, IT, MPTM) of songs made with sample chips.

#ifndef _RG_MODULE_H
#define _RG_MODULE_H

#include "rgexport.h"

enum RGModFormat {
  RG_FMT_MOD=0,
  RG_FMT_S3M,
  RG_FMT_XM,
  RG_FMT_IT,
  RG_FMT_MPTM
};

class DivExportModule: public DivExportRG {
  int fmt;
  void run();
  void runFaithful();
  void runEditable();
  public:
    DivExportModule(int f): fmt(f) {}
    ~DivExportModule() {}
};

#endif
