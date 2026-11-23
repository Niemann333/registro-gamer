# Tracker do blog (fork do Furnace) — onde parou (23/11/2026, tarde)

Código-fonte: os `.patch` desta pasta, aplicados sobre o Furnace oficial
(`git clone https://github.com/tildearrow/furnace`, `git checkout $(cat BASE_COMMIT_tildearrow.txt)`, `git am *.patch`).
Build web: `emcmake cmake` + `emmake make furnace` → copiar `furnace.js` e `furnace.wasm` para `chiptune-player/`.

## Feito e testado
- **Exportar NSF** (Arquivo → exportar… → ROM → "NES NSF"): NES + DPCM + FDS/VRC6/VRC7/N163/MMC5.
  Player 6502 próprio (`src/engine/export/nsfdrv.asm`, montador `scripts/rg-asm6502.py`).
  Testado no gme: 0,92–0,99 de semelhança; NSF → Tracker → NSF de volta: 0,91–0,99. Testado também no navegador (arquivo gerado).
  Falta: PCM direto do VRC6/MMC5 (não exporta), Sunsoft 5B.
- **Exportar SPC** (ROM → "SNES SPC"): player SPC700 próprio (`spcdrv.asm`, `scripts/rg-asmspc.py`), log comprimido
  com referências aninhadas (`DivExportRG::pack`). 0,94–0,99 no gme. Limite: samples + música cabem em 64 KB;
  metade das demos do Furnace não cabe (samples grandes). Possível melhora: compressão melhor.
- **Chip novo "Sony PlayStation SPU"** (24 vozes ADPCM, ID 0x52 — não existe no Furnace oficial), `platform/psx.cpp`.
- **Exportar PSF** (ROM → "PlayStation PSF"): player MIPS (`psfdrv.s`, llvm-mc mipsel mips1 + ld.lld), contador 2 por alvo.
  Testado no aopsf: igual ao Tracker (1,00); PSF original → Tracker → PSF: 0,95–0,99, volume ~1,0.
- Importação no Studio: PSF agora vai para o chip PlayStation; 2SF → Nintendo DS; GSF → Game Boy + GBA MinMod.
- Exportação roda sem thread no navegador (`DivExportRG::start`).

- **Exportar GBS** (ROM → "Game Boy GBS"): player SM83 (`gbsdrv.asm`, `scripts/rg-asmgb.py`), log em bancos de 16 KB,
  timer a 4096 Hz/(256-TMA). 13 demos: 0,96–0,99 no gme; GBS do Pokémon → Tracker → GBS: 0,92.
- **Exportar SID** (ROM → "Commodore 64 SID"): PSID v4, até 3 SIDs, player 6502 (`siddrv.asm`) com timer da CIA,
  log comprimido. 6 de 8 demos cabem (limite $1000-$CFFF); conferido pelo ripador do Studio: 0,86–0,95.
- **Mais espaço no SPC e no SID** (23/11):
  - SPC: o registro virou 9 fluxos (um por voz + 1 geral), cada um comprimido à parte; ondas (wavetable) guardadas
    uma vez só e copiadas; fluxos espalhados nas áreas livres ($0384-$03FF, depois dos samples, $F808-$FFFF).
    Demos do Furnace que cabem: 18 de 30 (antes 12); som 0,94–0,99 no gme. As que não cabem têm samples enormes.
  - SID: um fluxo por voz + 1 de filtro/volume por SID; dados de $0800 até $FFF9 (lê a RAM sob E/S e KERNAL
    ligando $01=$34 só durante o byte). 63 KB livres (antes 48); 6 de 8 demos cabem, com logs ~40% menores.
- NSF exportado no navegador = idêntico ao da linha de comando (conferido byte a byte).
- Descrições e erros dos exportadores em português (po/pt_BR.po).

## Próximos passos
1. Exportadores ainda não feitos: HES (PC Engine), KSS (MSX), AY (ZX Spectrum), GSF/2SF (mais difíceis). SAP já existe (SAP-R).
2. SPC: as músicas que ainda não cabem são as de samples grandes (o limite é a RAM do próprio console).
3. Publicar o fork no GitHub (Niemann333/furnace) — GPL: o código do Tracker precisa estar disponível.

Fontes dos importadores do Studio: `tools/vgm-timbres.js`, `vgm-fur.js`, `fmt-import.js`, `sid-rip.js`, `estudio.src.html`, `build.py`;
rg-rip.js: `tools/rip-src/` (gme + aopsf + vio2sf + VBA/playgsf com ganchos).
