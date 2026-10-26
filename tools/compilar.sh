#!/bin/sh
# Compila o rgloop: detector de loop de NSF/NSFe/GBS/KSS/SAP/AY/SID.
# Usa o Game_Music_Emu e a libsidplayfp com um "grampo" que registra cada
# escrita nos registradores do chip de som (gme-reglog.patch / sidplayfp-reglog.patch).
#
# Uso: sh tools/rgloop/compilar.sh [pasta_de_trabalho]
# Precisa de: git, cmake, g++, make, autoconf, automake, libtool, zlib.
set -e
AQUI=$(cd "$(dirname "$0")" && pwd)
W=${1:-/tmp/rgloop-build}
mkdir -p "$W" && cd "$W"

# versões fixas (as mesmas que geraram o loops.json)
GME_COMMIT=f68963b1de0633149b05732113d3c3113c6f63a1
SIDFP_COMMIT=32f0924202b0ea02a3434274256a7b169b43259c
XA_COMMIT=3be092964c80b10564f600325b1e4ff455387140

pega() {  # repo pasta commit
	if [ ! -d "$2/.git" ]; then git clone -q "$1" "$2"; fi
	(cd "$2" && git fetch -q origin "$3" 2>/dev/null || true; git checkout -q -f "$3" && git clean -qfdx)
}

# 1) Game_Music_Emu
pega https://github.com/libgme/game-music-emu.git gme "$GME_COMMIT"
(cd gme && git apply "$AQUI/gme-reglog.patch")
cmake -S gme -B gme/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
	-DGME_BUILD_EXAMPLES=OFF -DGME_BUILD_TESTING=OFF >/dev/null
cmake --build gme/build -j 4 --target gme_static >/dev/null

# 2) xa (assembler 6502 que a libsidplayfp usa para montar o driver do PSID)
pega https://github.com/fachat/xa65.git xa65 "$XA_COMMIT"
(cd xa65/xa && make -s xa >/dev/null)
PATH="$W/xa65/xa:$PATH"; export PATH

# 3) libsidplayfp
pega https://github.com/libsidplayfp/libsidplayfp.git sidplayfp "$SIDFP_COMMIT"
(cd sidplayfp && git submodule -q update --init --recursive && git apply "$AQUI/sidplayfp-reglog.patch" \
	&& autoreconf -fi >/dev/null 2>&1 && ./configure -q --disable-shared --enable-static >/dev/null \
	&& make -s -j 4 >/dev/null 2>&1)

# 4) rgloop
S=sidplayfp
g++ -O2 -w -I"$W/gme" -I"$S/src" -I"$S/src/builders/sidlite-builder" -I"$S" \
	"$AQUI/rgloop.cpp" "$W/gme/gme/rg_reglog.cpp" "$W/gme/build/gme/libgme.a" \
	"$S/src/builders/sidlite-builder/.libs/libsidplayfp-sidlite.a" \
	"$S/src/builders/sidlite-builder/sidlite/.libs/libsidlite.a" \
	"$S/src/.libs/libsidplayfp.a" -lz -lpthread -o "$W/rgloop"
echo "$W/rgloop"
