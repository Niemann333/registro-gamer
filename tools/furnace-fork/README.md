# Tracker do Registro Gamer — código-fonte

O Tracker do blog (`chiptune-player/tracker.html`, `furnace.js`, `furnace.wasm`) é o
[Furnace](https://github.com/tildearrow/furnace), criado por **tildearrow** e colaboradores,
com mudanças feitas para o blog. Como o Furnace, ele é software livre sob a licença
**GNU GPL versão 2 ou posterior** (o texto da licença vem no próprio Furnace, arquivo `LICENSE`).

## O que esta pasta tem

- `*.patch` — todas as mudanças do blog, em ordem, sobre a versão oficial do Furnace indicada
  em `BASE_COMMIT_tildearrow.txt`;
- `PROGRESSO.md` — o que já foi feito e o que falta.

## Mudanças principais

- versão para navegador (Emscripten): arquivos do acervo e do computador, modo celular, visual do blog, português;
- **exportação nos formatos originais dos consoles** (Arquivo → exportar… → ROM):
  NSF (NES + FDS/VRC6/VRC7/N163/MMC5), SPC (SNES), PSF (PlayStation), GBS (Game Boy), SID (Commodore 64);
  cada formato leva um pequeno programa próprio do console (`src/engine/export/*drv.*`) que repete
  as escritas de registrador gravadas da música;
- chip novo **Sony PlayStation SPU** (`src/engine/platform/psx.cpp`; ID de arquivo 0x52, que não existe no Furnace oficial).

## Como montar

```sh
git clone https://github.com/tildearrow/furnace
cd furnace
git checkout $(cat /caminho/para/tools/furnace-fork/BASE_COMMIT_tildearrow.txt)
git submodule update --init --recursive
git am /caminho/para/tools/furnace-fork/*.patch
```

Versão de linha de comando (para testar exportações, ex.: `furnace -romout musica.nsf musica.fur`):

```sh
mkdir build-cli && cd build-cli
cmake .. -DBUILD_GUI=OFF -DCMAKE_BUILD_TYPE=Release
make -j8 furnace
```

Versão para navegador (Emscripten 3.1.6), a que o blog usa:

```sh
mkdir build-web && cd build-web
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_GUI=ON -DUSE_SDL2=ON -DUSE_GLES=ON \
  -DWITH_RENDER_OPENGL=ON -DWITH_RENDER_SDL=ON -DUSE_FREETYPE=ON -DUSE_SNDFILE=ON -DUSE_MOMO=ON \
  -DWITH_JSON=ON -DWITH_LOCALE=ON -DUSE_RTMIDI=OFF -DWITH_PORTAUDIO=OFF -DWITH_JACK=OFF \
  -DWITH_DEMOS=OFF -DWITH_INSTRUMENTS=OFF -DWITH_WAVETABLES=OFF -DUSE_BACKWARD=OFF
emmake make -j4 furnace
```

Depois copie `furnace.js` e `furnace.wasm` para `chiptune-player/`.

Os programas de cada console já vêm montados nos arquivos `*.inc`; para remontar:
`scripts/rg-asm6502.py` (NSF, SID), `scripts/rg-asmspc.py` (SPC), `scripts/rg-asmgb.py` (GBS)
e `llvm-mc -triple=mipsel -mcpu=mips1` + `ld.lld -Ttext=0x80010000` (PSF).

Obrigado, tildearrow, por criar o melhor tracker de todos os tempos!
