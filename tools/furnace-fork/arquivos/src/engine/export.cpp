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

#include "engine.h"

#include "export/amigaValidation.h"
#include "export/sapr.h"
#include "export/tiuna.h"
#include "export/zsm.h"
#include "export/ipod.h"
#include "export/grub.h"
#include "export/nsf.h"
#include "export/spc.h"
#include "export/psf.h"
#include "export/gsf.h"
#include "export/nds2sf.h"
#include "export/gbs.h"
#include "export/sid.h"
#include "export/snsf.h"
#include "export/hes.h"
#include "export/kss.h"
#include "export/ay.h"
#include "export/module.h"

DivROMExport* DivEngine::buildROM(DivROMExportOptions sys) {
  DivROMExport* exporter=NULL;
  switch (sys) {
    case DIV_ROM_AMIGA_VALIDATION:
      exporter=new DivExportAmigaValidation;
      break;
    case DIV_ROM_TIUNA:
      exporter=new DivExportTiuna;
      break;
    case DIV_ROM_ZSM:
      exporter=new DivExportZSM;
      break;
    case DIV_ROM_SAP_R:
      exporter=new DivExportSAPR;
      break;
    case DIV_ROM_IPOD:
      exporter=new DivExportiPod;
      break;
    case DIV_ROM_GRUB:
      exporter=new DivExportGRUB;
      break;
    case DIV_ROM_NSF:
      exporter=new DivExportNSF;
      break;
    case DIV_ROM_SPC:
      exporter=new DivExportSPC;
      break;
    case DIV_ROM_2SF:
      exporter=new DivExport2SF;
      break;
    case DIV_ROM_GSF:
      exporter=new DivExportGSF;
      break;
    case DIV_ROM_PSF:
      exporter=new DivExportPSF;
      break;
    case DIV_ROM_GBS:
      exporter=new DivExportGBS;
      break;
    case DIV_ROM_SID:
      exporter=new DivExportSID;
      break;
    case DIV_ROM_SNSF:
      exporter=new DivExportSNSF;
      break;
    case DIV_ROM_HES:
      exporter=new DivExportHES;
      break;
    case DIV_ROM_KSS:
      exporter=new DivExportKSS;
      break;
    case DIV_ROM_AY:
      exporter=new DivExportAY;
      break;
    case DIV_ROM_MOD:
      exporter=new DivExportModule(RG_FMT_MOD);
      break;
    case DIV_ROM_S3M:
      exporter=new DivExportModule(RG_FMT_S3M);
      break;
    case DIV_ROM_XM:
      exporter=new DivExportModule(RG_FMT_XM);
      break;
    case DIV_ROM_IT:
      exporter=new DivExportModule(RG_FMT_IT);
      break;
    case DIV_ROM_MPTM:
      exporter=new DivExportModule(RG_FMT_MPTM);
      break;
    default:
      exporter=new DivROMExport;
      break;
  }
  return exporter;
}
