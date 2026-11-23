# Tracker do blog (fork do Furnace) — onde parou (23/11/2026, noite)

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
- **SID refeito (23/11, noite): todas as 8 demos do Furnace cabem, inclusive ChaosTune (antes 91 KB) e deadlock
  (antes 199 KB, 3 SIDs a 200 Hz).**
  - 11 fluxos por SID. Frequência, pulso e corte são "fluxos de valor": a cada tique, valor de N tiques atrás (1-8)
    + delta — portamento, vibrato, varredura de pulso e arpejo não custam bytes enquanto mantêm a forma.
  - Referências aninhadas até 12 níveis, curtas (E1); o empacotador tenta primeiro só referências que economizam
    12+ bytes (menos trabalho para o 6502) e baixa para 8, 4, 1 se a música não couber.
  - Player por eventos (listas por tique + lista de ativos) e fila de escritas: o PLAY escreve o tique pronto e usa
    o tempo até a próxima interrupção (timer B da CIA 1, modo one-shot) para adiantar. Onde o timer B não existe
    (ripador do Studio) funciona igual, sem adiantar.
  - Conferido por emulação 6502 (`/home/claude/work/sidp/verify.js`): estado dos registradores idêntico ao do
    Furnace em TODOS os tiques das 8 demos. Atraso das escritas: zero nas demos normais; deadlock 99% < 1,8 ms
    (máx 9,5 ms), ChaosTune máx 3,7 ms. sidplayfp: 0,97-0,98 de semelhança com o Furnace.
  - Ferramentas de teste: `RG_DUMP=arquivo` no furnace da linha de comando salva o registro capturado;
    verify.js (compara), prof.js (ciclos por rotina), win.js (carga em janelas).
- NSF exportado no navegador = idêntico ao da linha de comando (conferido byte a byte).
- Descrições e erros dos exportadores em português (po/pt_BR.po).

## SNSF — EM ANDAMENTO (parou 23/11 14:45, pausa até 17:00)
- FEITO no fork (commit "Exportar SNSF"): `src/engine/export/snsf.cpp/.h`, `snsfdrv.s` (65816, ca65/ld65 do pacote cc65;
  gerar .inc com `python3 scripts/rg-snsfinc.py`), `snsfspc.asm` (SPC700, `python3 scripts/rg-asmspc.py snsfspc.asm
  snsfSpcDriver "..." > snsfspc.inc`), registrado como DIV_ROM_SNSF em export.h/.cpp, exportDef.cpp, CMakeLists.
  - Correções já feitas: CMPW é 0x5A (estava 0x5E no rg-asmspc.py); esperar o IPL devolver o KICK antes de esperar o
    "pronto"; no INIT do SPC desligar a escrita do eco ANTES de zerar o DSP e esperar 256 ms (eco antigo apagava o driver).
  - Teste: `/home/claude/work/snsf/build/snsfwav saida.wav segundos arquivo.snsf` (snsf9x nativo; fonte em
    tools/snsf-player/rgsnsf.cpp + snsfwav.cpp; snsf9x clonado em /home/claude/work/snsf/snsf9x, compilar com
    -DNDEBUG -DHAVE_STDINT_H). Resultado em /home/claude/work/snsfx: as 30 demos SNES exportam (inclusive Breezy);
    semelhança com o Furnace 0,98-1,00 nas que testei depois das correções (falta rodar as 30 de novo).
- FALTA:
  1. Rodar as 30 demos de novo (loop em /home/claude/work/snsfx, resumo.txt) e conferir volumes.
  2. Tradução pt_BR das strings novas do snsf.cpp/exportDef (po/pt_BR.po + msgfmt) e mensagem no estudio (lista ROM).
  3. Build web (build-web: emmake make furnace), copiar furnace.js/wasm, testar no navegador (trx.py; usar
     ["eval","window.showSaveFilePicker=undefined"] para baixar).
  4. Player: compilar rgsnsf.cpp + snsf9x com emcc (SINGLE_FILE, -sUSE_ZLIB=1, exportar snsf_begin/add_psf/start/render)
     como chiptune-player/rg-snsf.js; motor novo em rg-player.js para .snsf/.minisnsf (carregar _lib antes, depois o
     arquivo, depois _lib2...; base do primeiro arquivo somada aos seguintes); tags length/fade.
  5. atualizar.sh, README (tabela de exportadores), commit/push.
- Depois: HES, KSS, AY (pedido do usuário). OpenMPT: usuário perguntou; respondi que dá para exportar MOD/XM/S3M/IT/MPTM
  de músicas com canais de sample e completar ferramentas de sample — perguntei se entra na fila depois de HES/KSS/AY.

## Próximos passos
1. Exportadores ainda não feitos: HES (PC Engine), KSS (MSX), AY (ZX Spectrum), GSF/2SF (mais difíceis). SAP já existe (SAP-R).
2. SPC: as músicas que ainda não cabem são as de samples grandes (o limite é a RAM do próprio console).
   → Plano: SNSF (pedido pelo usuário, "SNSF no tracker e player"): ROM de SNES com driver 65816 que manda samples
   pela porta do APU (protocolo IPL) e toca o registro direto da ROM; e tocador de SNSF (snsf9x/snes9x) no
   Chiptune Player. Formato: PSF versão 0x23; programa = [u32 deslocamento][u32 tamanho][ROM]; reservado = blocos
   [u32 tipo][u32 tamanho] (tipo 0 = SRAM [u32 deslocamento][dados]). Fonte do snsf9x: github.com/loveemu/snsf9x.
3. Publicar o fork no GitHub (Niemann333/furnace) — GPL: o código do Tracker precisa estar disponível.

Fontes dos importadores do Studio: `tools/vgm-timbres.js`, `vgm-fur.js`, `fmt-import.js`, `sid-rip.js`, `estudio.src.html`, `build.py`;
rg-rip.js: `tools/rip-src/` (gme + aopsf + vio2sf + VBA/playgsf com ganchos).
