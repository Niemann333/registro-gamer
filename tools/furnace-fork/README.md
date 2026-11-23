# Tracker do Registro Gamer — código-fonte

O Tracker do blog ([chiptune-player/tracker.html](../../chiptune-player/tracker.html), `furnace.js`, `furnace.wasm`) é o
[Furnace](https://github.com/tildearrow/furnace), criado por **tildearrow** e colaboradores,
com mudanças feitas para o blog. Como o Furnace, ele é software livre sob a licença
**GNU GPL versão 2 ou posterior** ([texto da licença](https://github.com/tildearrow/furnace/blob/master/LICENSE)).

Todo o código está aqui, de três jeitos:

| Para… | Use |
|---|---|
| **ler o código** direto no navegador | a pasta [`arquivos/`](arquivos/) — cada arquivo mudado ou criado, inteiro, no mesmo caminho do Furnace ([lista](arquivos/LISTA.txt): A = criado, M = mudado) |
| **ver o que mudou**, mudança por mudança | os arquivos `*.patch` desta pasta (em ordem) e [`sdl/`](sdl/) (uma mudança no SDL, submódulo do Furnace) |
| **compilar** | as instruções abaixo |

Versão oficial do Furnace usada como base: o commit em [`BASE_COMMIT_tildearrow.txt`](BASE_COMMIT_tildearrow.txt).
O que já foi feito e o que falta: [`PROGRESSO.md`](PROGRESSO.md).

## Novidades em relação ao Furnace oficial

**Exportação nos formatos originais dos consoles** (Arquivo → exportar… → ROM). Cada formato leva um
pequeno programa do próprio console que repete as escritas de registrador gravadas da música:

| Formato | Console | Exportador | Programa do console |
|---|---|---|---|
| NSF | NES + FDS/VRC6/VRC7/N163/MMC5 | [nsf.cpp](arquivos/src/engine/export/nsf.cpp) | [nsfdrv.asm](arquivos/src/engine/export/nsfdrv.asm) (6502) |
| SPC | Super Nintendo | [spc.cpp](arquivos/src/engine/export/spc.cpp) | [spcdrv.asm](arquivos/src/engine/export/spcdrv.asm) (SPC700) |
| PSF | PlayStation | [psf.cpp](arquivos/src/engine/export/psf.cpp) | [psfdrv.s](arquivos/src/engine/export/psfdrv.s) (MIPS) |
| GBS | Game Boy | [gbs.cpp](arquivos/src/engine/export/gbs.cpp) | [gbsdrv.asm](arquivos/src/engine/export/gbsdrv.asm) (SM83) |
| SID | Commodore 64 (até 3 SIDs) | [sid.cpp](arquivos/src/engine/export/sid.cpp) | [siddrv.asm](arquivos/src/engine/export/siddrv.asm) (6502) |

A parte comum (gravar a música tique a tique e comprimir) fica em
[rgexport.cpp](arquivos/src/engine/export/rgexport.cpp).

**Chip novo: Sony PlayStation SPU** — 24 vozes ADPCM com envelopes:
[psx.cpp](arquivos/src/engine/platform/psx.cpp). ID de arquivo 0x52, que não existe no Furnace oficial
(projetos com esse chip só abrem no Tracker do blog).

**Versão para navegador** (Emscripten): arquivos do acervo e do computador, modo celular, visual do blog e
tradução completa para o português ([po/pt_BR.po](arquivos/po/pt_BR.po)).

## Como compilar

```sh
git clone https://github.com/tildearrow/furnace
cd furnace
git checkout $(cat /caminho/para/tools/furnace-fork/BASE_COMMIT_tildearrow.txt)
git submodule update --init --recursive
git am /caminho/para/tools/furnace-fork/*.patch
(cd extern/SDL && git am /caminho/para/tools/furnace-fork/sdl/*.patch)
```

Linha de comando (para testar exportações, ex.: `furnace -romout musica.nsf musica.fur`):

```sh
mkdir build-cli && cd build-cli
cmake .. -DBUILD_GUI=OFF -DCMAKE_BUILD_TYPE=Release
make -j8 furnace
```

Navegador (Emscripten 3.1.6), a versão que o blog usa:

```sh
mkdir build-web && cd build-web
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_GUI=ON -DUSE_SDL2=ON -DUSE_GLES=ON \
  -DWITH_RENDER_OPENGL=ON -DWITH_RENDER_SDL=ON -DUSE_FREETYPE=ON -DUSE_SNDFILE=ON -DUSE_MOMO=ON \
  -DWITH_JSON=ON -DWITH_LOCALE=ON -DUSE_RTMIDI=OFF -DWITH_PORTAUDIO=OFF -DWITH_JACK=OFF \
  -DWITH_DEMOS=OFF -DWITH_INSTRUMENTS=OFF -DWITH_WAVETABLES=OFF -DUSE_BACKWARD=OFF
emmake make -j4 furnace
```

Depois copie `furnace.js` e `furnace.wasm` para `chiptune-player/`.

Os programas de cada console já vêm montados nos arquivos `*.inc`. Para remontar:
[rg-asm6502.py](arquivos/scripts/rg-asm6502.py) (NSF, SID), [rg-asmspc.py](arquivos/scripts/rg-asmspc.py) (SPC),
[rg-asmgb.py](arquivos/scripts/rg-asmgb.py) (GBS) e `llvm-mc -triple=mipsel -mcpu=mips1` + `ld.lld -Ttext=0x80010000` (PSF).
Exemplo: `python3 scripts/rg-asm6502.py src/engine/export/siddrv.asm sidDriver > src/engine/export/siddrv.inc`.

Esta pasta é regerada a partir do fork com [atualizar.sh](atualizar.sh).

Obrigado, tildearrow, por criar o melhor tracker de todos os tempos!
