#!/bin/sh
# tocador de SNSF do Chiptune Player: rg-snsf.js/.wasm (snsf9x/Snes9x + rgsnsf.cpp) e, para testes, snsfwav (nativo).
# precisa do emscripten e da fonte do zlib (por exemplo extern/zlib do Furnace). uso: sh build.sh pasta_do_zlib
# mudanças no snsf9x (marcadas "Registro Gamer"): snes9x/port.h trata wasm como little endian;
# snes9x/apu/SPC_DSP.cpp usa sempre o caminho de mistura que funciona (o outro estragava amostras fora do x86).
set -e
Z=${1:?informe a pasta do zlib, por exemplo furnace/extern/zlib}
S=snsf9x
SRC="$S/SNESSystem.cpp $S/snes9x/cpu.cpp $S/snes9x/cpuexec.cpp $S/snes9x/cpuops.cpp $S/snes9x/dma.cpp $S/snes9x/globals.cpp $S/snes9x/memmap.cpp $S/snes9x/ppu.cpp $S/snes9x/sdd1.cpp $S/snes9x/sa1.cpp $S/snes9x/apu/apu.cpp $S/snes9x/apu/SNES_SPC.cpp $S/snes9x/apu/SNES_SPC_misc.cpp $S/snes9x/apu/SNES_SPC_state.cpp $S/snes9x/apu/SPC_DSP.cpp $S/snes9x/apu/SPC_Filter.cpp"
ZS="$Z/adler32.c $Z/crc32.c $Z/inflate.c $Z/inffast.c $Z/inftrees.c $Z/uncompr.c $Z/zutil.c"
FL="-DNDEBUG -DHAVE_STDINT_H -DBLARGG_LITTLE_ENDIAN=1 -I$Z -I$S -I$S/snes9x -I$S/snes9x/apu -w"
emcc -O3 $FL rgsnsf.cpp $SRC $ZS -sMODULARIZE=1 -sEXPORT_NAME=RGSNSF -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,node \
  -sEXPORTED_FUNCTIONS=_snsf_begin,_snsf_add_psf,_snsf_start,_snsf_render,_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16 \
  -o ../../chiptune-player/rg-snsf.js
g++ -O2 $FL rgsnsf.cpp snsfwav.cpp $SRC -lz -o snsfwav || echo "(snsfwav nativo não compilou: precisa do zlib do sistema)"
