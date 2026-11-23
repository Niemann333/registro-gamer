# Tocador de SNSF do Chiptune Player

`rg-snsf.js` / `rg-snsf.wasm` (em `chiptune-player/`) tocam arquivos `.snsf` / `.minisnsf` (com as bibliotecas
`.snsflib`) no navegador. É o [snsf9x](https://github.com/loveemu/snsf9x) (núcleo do Snes9x, por loveemu)
compilado com o emscripten, mais `rgsnsf.cpp` (carrega os arquivos PSF e entrega o áudio).

- `sh build.sh pasta_do_zlib` gera o `rg-snsf.js/.wasm` e o `snsfwav` (teste nativo:
  `./snsfwav saida.wav segundos arquivo.snsf [mais arquivos na ordem de carga]`).
- Mudanças no snsf9x: `snes9x/port.h` (wasm é little endian) e `snes9x/apu/SPC_DSP.cpp` (o caminho de mistura
  usado fora do x86 transformava amostras positivas em ruído).
- Licença: a do Snes9x (uso não comercial, veja `snsf9x/snes9x/` e o repositório do snsf9x); o núcleo do SPC é
  de blargg (LGPL).
