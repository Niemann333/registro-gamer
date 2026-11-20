#!/bin/bash
# build do rg-rip.js (game-music-emu + aopsf + vio2sf + VBA/playgsf); DEV=1 inclui o áudio de referência
cd "$(dirname "$0")"
SRCS=$(ls gme/gme/*.cpp | grep -v "Vgm_Emu\|Gym_Emu\|Ym2612\|Vgm_Emu_Impl")
EXP='"_malloc","_free","_rip_open","_rip_len","_rip_str","_rip_run","_rip_log","_rip_blob","_rip_blob_size","_psf_begin","_psf_section","_psf_run","_nds_run","_gba_run"'
RT='"HEAPU8","HEAPF64","UTF8ToString"'; OUT=out/rgrip.js
if [ -n "$DEV" ]; then EXP="$EXP"',"_rip_render","_rip_audio","_rip_keep_audio","_rip_audio_size"'; RT="$RT"',"HEAP16"'; OUT=out/rgrip-dev.js; fi
emcc -O2 -DNDEBUG -DBLARGG_LITTLE_ENDIAN=1 -Igme -Igme/gme -Igme/gme/ext -Iaopsf -I2sftowav/src/vio2sf rgrip.cpp $SRCS obj/*.o obj2/*.o obj3/*.o objz/*.o -s MODULARIZE=1 -s EXPORT_NAME=RGRIP -s ALLOW_MEMORY_GROWTH=1 -s ENVIRONMENT=web,worker,node -s EXPORTED_FUNCTIONS="[$EXP]" -s EXPORTED_RUNTIME_METHODS="[$RT]" -s SINGLE_FILE=1 -o $OUT
