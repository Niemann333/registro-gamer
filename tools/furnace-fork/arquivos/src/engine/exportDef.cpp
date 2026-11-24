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

DivROMExportDef* DivEngine::romExportDefs[DIV_ROM_MAX];

const DivROMExportDef* DivEngine::getROMExportDef(DivROMExportOptions opt) {
  return romExportDefs[opt];
}

bool DivEngine::isROMExportViable(DivROMExportOptions opt)
{
  const DivROMExportDef* newDef=getROMExportDef(opt);
  if (newDef==NULL) {
    return false;
  }

  unsigned char sysReqCount[DIV_SYSTEM_MAX];
  memset(sysReqCount,0,DIV_SYSTEM_MAX);
  for (int i=0; i<song.systemLen; i++) {
    sysReqCount[song.system[i]]++;
  }

  unsigned char defReqCount[DIV_SYSTEM_MAX];
  memset(defReqCount,0,DIV_SYSTEM_MAX);
  for (DivSystem j: newDef->requisites) {
    defReqCount[j]++;
  }

  switch (newDef->requisitePolicy) {
    case DIV_REQPOL_EXACT:
      for (int j=0; j<DIV_SYSTEM_MAX; j++) {
        if (defReqCount[j]!=sysReqCount[j]) {
          return false;
        }
      }
      break;
    case DIV_REQPOL_ANY:
      for (int j=0; j<DIV_SYSTEM_MAX; j++) {
        if (defReqCount[j]>sysReqCount[j]) {
          return false;
        }
      }
      break;
    case DIV_REQPOL_LAX:
      for (DivSystem j: newDef->requisites) {
        if (defReqCount[j]<=sysReqCount[j]) {
          return true;
        }
      }
      return false;
  }
  return true;
}

void DivEngine::registerROMExports() {
  logD("registering ROM exports...");

  romExportDefs[DIV_ROM_AMIGA_VALIDATION]=new DivROMExportDef(
    "Amiga Validation", "tildearrow",
    "a test export for ensuring Amiga emulation is accurate. do not use!",
    NULL, NULL,
    {DIV_SYSTEM_AMIGA},
    true, DIV_REQPOL_EXACT
  );

  romExportDefs[DIV_ROM_ZSM]=new DivROMExportDef(
    "Commander X16 ZSM", "ZeroByteOrg and MooingLemur",
    "Commander X16 Zsound Music File.\n"
    "for use with Melodius, Calliope and/or ZSMKit:\n"
    "- https://github.com/mooinglemur/zsmkit (development)\n"
    "- https://github.com/mooinglemur/melodius (player)\n"
    "- https://github.com/ZeroByteOrg/calliope (player)\n",
    "ZSM file", ".zsm",
    {
      DIV_SYSTEM_YM2151, DIV_SYSTEM_VERA
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_TIUNA]=new DivROMExportDef(
    "Atari 2600 (TIunA)", "Natt Akuma",
    "advanced driver with software tuning support.\n"
    "see https://github.com/AYCEdemo/twin-tiuna for code.",
    "assembly files", ".asm",
    {
      DIV_SYSTEM_TIA
    },
    false, DIV_REQPOL_ANY
  );

  romExportDefs[DIV_ROM_SAP_R]=new DivROMExportDef(
    "Atari 8-bit SAP-R", "asiekierka",
    "SAP type R export for POKEY songs.\n"
    "register dump-based, unlike normal SAP.\n"
    "for playback, you may use:\n"
    "- Altirra\n"
    "- lzss-sap (https://github.com/dmsc/lzss-sap/)",
    "SAP files", ".sap",
    {
      DIV_SYSTEM_POKEY
    },
    false, DIV_REQPOL_EXACT
  );

  romExportDefs[DIV_ROM_IPOD]=new DivROMExportDef(
    "iPod .tone alarm", "AArt1256",
    "iPod Beeper (.tone) Alarm export\n"
    "for playback, you can drag the resulting file\n"
    "into iPod_Control/Tones to your iPod IN DISK MODE",
    "alarm tone files", ".tone",
    {
      DIV_SYSTEM_PCSPKR
    },
    false, DIV_REQPOL_ANY
  );

  romExportDefs[DIV_ROM_GRUB]=new DivROMExportDef(
    "GRUB_INIT_TUNE", "AArt1256",
    "GRUB_INIT_TUNE export\n"
    "for use with the GRUB bootloader using the \"play\" command",
    "Text/Binary files", ".txt",
    {
      DIV_SYSTEM_PCSPKR
    },
    false, DIV_REQPOL_ANY
  );

  // Registro Gamer: formatos originais dos consoles
  romExportDefs[DIV_ROM_NSF]=new DivROMExportDef(
    "NES NSF", "Registro Gamer",
    "NSF (NES Sound Format) export.\n"
    "plays on any NSF player and on real hardware.\n"
    "supports the NES APU with DPCM and the expansion chips\n"
    "FDS, VRC6, VRC7, Namco 163 and MMC5.\n"
    "register dump-based (the song is recorded tick by tick).",
    "NSF files", ".nsf",
    {
      DIV_SYSTEM_NES, DIV_SYSTEM_5E01, DIV_SYSTEM_FDS, DIV_SYSTEM_VRC6, DIV_SYSTEM_VRC7, DIV_SYSTEM_N163, DIV_SYSTEM_MMC5
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_SPC]=new DivROMExportDef(
    "SNES SPC", "Registro Gamer",
    "SPC (SNES sound RAM snapshot) export.\n"
    "plays on any SPC player and on real hardware.\n"
    "the samples and the song must fit in the 64KB of sound RAM.\n"
    "register dump-based (the song is recorded tick by tick and compressed).",
    "SPC files", ".spc",
    {
      DIV_SYSTEM_SNES
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_PSF]=new DivROMExportDef(
    "PlayStation PSF", "Registro Gamer",
    "PSF (PlayStation Sound Format) export.\n"
    "plays on any PSF player (Highly Experimental, foobar2000, etc.).\n"
    "the samples go to the 512KB of SPU RAM; the song to the 2MB of main RAM.\n"
    "register dump-based (the song is recorded tick by tick and compressed).",
    "PSF files", ".psf",
    {
      DIV_SYSTEM_PSX
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_GBS]=new DivROMExportDef(
    "Game Boy GBS", "Registro Gamer",
    "GBS (Game Boy Sound System) export.\n"
    "plays on any GBS player and on real hardware.\n"
    "register dump-based (the song is recorded tick by tick).",
    "GBS files", ".gbs",
    {
      DIV_SYSTEM_GB
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_SID]=new DivROMExportDef(
    "Commodore 64 SID", "Registro Gamer",
    "SID (PSID) export for the Commodore 64.\n"
    "plays on any SID player (sidplayfp, foobar2000, etc.) and on a real C64.\n"
    "up to 3 SID chips; the song must fit in the C64's memory.\n"
    "register dump-based (the song is recorded tick by tick and compressed).",
    "SID files", ".sid",
    {
      DIV_SYSTEM_C64_6581, DIV_SYSTEM_C64_8580
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_SNSF]=new DivROMExportDef(
    "SNES SNSF", "Registro Gamer",
    "SNSF (SNES Sound Format) export: a SNES ROM that plays the song.\n"
    "plays on any SNSF player (foobar2000, Winamp in_xsf, the blog's Chiptune Player, etc.).\n"
    "the song is kept in the ROM (up to 4MB), so only the samples must fit in the 64KB of sound RAM.\n"
    "register dump-based (the song is recorded tick by tick).",
    "SNSF files", ".snsf",
    {
      DIV_SYSTEM_SNES
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_HES]=new DivROMExportDef(
    "PC Engine HES", "Registro Gamer",
    "HES export for the PC Engine / TurboGrafx-16.\n"
    "plays on any HES player (foobar2000, Game Music Emu, the blog's Chiptune Player, etc.).\n"
    "up to about 1MB of song data.\n"
    "register dump-based (the song is recorded tick by tick).",
    "HES files", ".hes",
    {
      DIV_SYSTEM_PCE
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_KSS]=new DivROMExportDef(
    "MSX KSS", "Registro Gamer",
    "KSS export for the MSX: PSG (AY-3-8910), Konami SCC, FM-PAC (OPLL) and MSX-AUDIO (Y8950).\n"
    "plays on KSS players (foobar2000, NEZplug, the blog's Chiptune Player, etc.).\n"
    "up to about 1MB of song data.\n"
    "register dump-based (the song is recorded tick by tick).",
    "KSS files", ".kss",
    {
      DIV_SYSTEM_AY8910, DIV_SYSTEM_SCC, DIV_SYSTEM_SCC_PLUS, DIV_SYSTEM_OPLL, DIV_SYSTEM_OPLL_DRUMS, DIV_SYSTEM_Y8950, DIV_SYSTEM_Y8950_DRUMS
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_AY]=new DivROMExportDef(
    "ZX Spectrum AY", "Registro Gamer",
    "AY (ZXAYEMUL) export for the ZX Spectrum 128: one AY-3-8910.\n"
    "plays on AY players (foobar2000, AY_Emul, Game Music Emu, the blog's Chiptune Player, etc.).\n"
    "the song must fit in the Spectrum's memory (about 48KB, compressed).\n"
    "register dump-based (the song is recorded tick by tick).",
    "AY files", ".ay",
    {
      DIV_SYSTEM_AY8910
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_MOD]=new DivROMExportDef(
    "ProTracker MOD", "Registro Gamer",
    "MOD (ProTracker) export: 8-bit samples, up to 31 of them, 4 or more channels.\nthe most compatible module format, but the most limited: one effect column and no volume column.\nsongs must be short (128 orders of 64 rows, one row per tick).\n"
    "two modes: faithful (recorded tick by tick, sounds as in Furnace) or editable (patterns, instruments and effects converted, to keep editing in OpenMPT).\n"
    "works with sample chips: Amiga and Generic PCM.",
    "MOD files", ".mod",
    {
      DIV_SYSTEM_AMIGA, DIV_SYSTEM_PCM_DAC
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_S3M]=new DivROMExportDef(
    "Scream Tracker S3M", "Registro Gamer",
    "S3M (Scream Tracker 3) export: up to 99 samples and 32 channels, with a volume column.\npatterns have 64 rows (one row per tick), so long songs may not fit.\n"
    "two modes: faithful (recorded tick by tick, sounds as in Furnace) or editable (patterns, instruments and effects converted, to keep editing in OpenMPT).\n"
    "works with sample chips: Amiga and Generic PCM.",
    "S3M files", ".s3m",
    {
      DIV_SYSTEM_AMIGA, DIV_SYSTEM_PCM_DAC
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_XM]=new DivROMExportDef(
    "FastTracker XM", "Registro Gamer",
    "XM (FastTracker 2) export: up to 128 samples (8 or 16-bit) and 32 channels, with a volume column and linear slides.\nruns up to 51 ticks per second with full pitch accuracy (102 with fine slides only).\n"
    "two modes: faithful (recorded tick by tick, sounds as in Furnace) or editable (patterns, instruments and effects converted, to keep editing in OpenMPT).\n"
    "works with sample chips: Amiga and Generic PCM.",
    "XM files", ".xm",
    {
      DIV_SYSTEM_AMIGA, DIV_SYSTEM_PCM_DAC
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_IT]=new DivROMExportDef(
    "Impulse Tracker IT", "Registro Gamer",
    "IT (Impulse Tracker) export: up to 240 samples (8 or 16-bit; Impulse Tracker itself plays 99), 64 channels, ping-pong loops.\n"
    "two modes: faithful (recorded tick by tick, sounds as in Furnace) or editable (patterns, instruments and effects converted, to keep editing in OpenMPT).\n"
    "works with sample chips: Amiga and Generic PCM.",
    "IT files", ".it",
    {
      DIV_SYSTEM_AMIGA, DIV_SYSTEM_PCM_DAC
    },
    false, DIV_REQPOL_LAX
  );

  romExportDefs[DIV_ROM_MPTM]=new DivROMExportDef(
    "OpenMPT MPTM", "Registro Gamer",
    "MPTM (OpenMPT) export: like IT, but with bigger patterns (1024 rows) and tempo up to 1000, including fractional tempo, so any tick rate plays exactly.\n"
    "two modes: faithful (recorded tick by tick, sounds as in Furnace) or editable (patterns, instruments and effects converted, to keep editing in OpenMPT).\n"
    "works with sample chips: Amiga and Generic PCM.",
    "MPTM files", ".mptm",
    {
      DIV_SYSTEM_AMIGA, DIV_SYSTEM_PCM_DAC
    },
    false, DIV_REQPOL_LAX
  );
}
