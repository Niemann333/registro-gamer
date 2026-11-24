# Tracker do blog (fork do Furnace) — onde parou (23/11/2026, madrugada)

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

## SNSF — PRONTO (23/11, noite)
- Exportador no fork (snsf.cpp, snsfdrv.s, snsfspc.asm; .inc por scripts/rg-snsfinc.py e rg-asmspc.py). 30/30 demos SNES
  exportam; semelhança com o Furnace 0,99-1,00 em 28 (tetristheme 0,95 e very chill snes 0,94 — iguais ao SPC).
  Exportação no navegador = idêntica à da linha de comando. SPC que não cabe agora sugere SNSF.
- Player: chiptune-player/rg-snsf.js/.wasm (fonte e build em tools/snsf-player), motor "SNSF" em rg-player.js
  (player.html ?v=18); gadgets (i18n/src chiptune.html e mobile.html) aceitam .snsf/.minisnsf/.snsflib.
- Depois: formatos/ferramentas do OpenMPT (MOD/XM/S3M/IT/MPTM
  para músicas de samples + ferramentas de sample), aprovado pelo usuário. Também: avisos de "adaptar formato" em
  outros exportadores quando aparecerem (pedido do usuário).
- Pendência de reprodutibilidade: nsfdrv.asm e spcdrv.asm dependem de constantes passadas por fora ao montador
  (os .inc estão certos); colocar as constantes dentro dos .asm.

## HES, KSS e AY — PRONTOS (23/11, madrugada)
- **HES** (ROM → "PC Engine HES"): hes.cpp + hesdrv.asm (HuC6280, montado com rg-asm6502.py; `tam` como bytes).
  Driver em $E000, registro em bancos de 8 KB (janela $4000), interrupção do timer com acumulador de 24 bits
  (~4 chamadas por tique), referências de 24 bits. 10/10 demos de PC Engine: 0,94-0,99 no gme.
- **KSS** (ROM → "MSX KSS"): kss.cpp + kssdrv.asm (Z80, z80asm + scripts/rg-z80inc.py). PSG, SCC, OPLL e Y8950
  (com a memória ADPCM enviada no início). Bancos de 8 KB na janela $A000. Clock do AY ajustado ao do MSX
  (ayconv.h). Cada chamada do PLAY é dividida em passos com espera contada (16+ por quadro), então qualquer taxa de
  tique toca no tempo certo. Demos de MSX: 0,92-0,99 no libkss (kss2wav).
- **AY** (ROM → "ZX Spectrum AY"): ay.cpp + aydrv.asm (Z80 em $4100, pilha logo abaixo). ZXAYEMUL v3, um AY,
  períodos convertidos para 1773400 Hz, mesmo esquema de passos do KSS a 50 Hz. Registro até $FFFF (~48 KB).
  11/11 demos de AY-3-8910 cabem: 0,95-0,99 no gme. Se não couber, o erro sugere VGM ou KSS.
- Player: .hes vai para o Game Music Emu (chip-players.js aceita "hes"); .kss continua no NEZplug; .ay já tocava.
  Gadget do PC aceita .hes (o do celular já aceitava). Studio mostra HES / KSS / AY nos formatos de volta.
- Traduções em po/pt_BR.po.

## OpenMPT, parte 1: exportar MOD / S3M / XM / IT / MPTM — PRONTO (24/11)
- ROM → "ProTracker MOD", "Scream Tracker S3M", "FastTracker XM", "Impulse Tracker IT", "OpenMPT MPTM" (module.cpp).
  Chips aceitos: Amiga e PCM genérico (os outros chips da música são ignorados com aviso).
- Dois modos (opção na janela de exportação; na linha de comando `-romconf mode=editable`):
  - **fiel** (padrão): grava o estado de cada canal em cada tique (sample, frequência, volume, pan, início de nota)
    e escreve uma linha por tique. Velocidade 2 (andamento = 5 × taxa de tique) para slides normais no meio da linha;
    acima de 51 Hz, velocidade 1 com slides finos. A afinação segue com slides extra-finos (1/64 de semitom) e as
    samples ganham uma afinação de referência que deixa os inícios de nota em notas inteiras. Ondas do Amiga viram
    samples (repetidas são juntadas; se passar do limite, as menos usadas se juntam às mais parecidas).
    MOD: samples reamostradas por oitava para caber em 128 KB e nas 3 oitavas do ProTracker.
    MPTM: andamento até 1000 e fracionário (bloco "STPM" com DT.. e DTFR + bloco "228" vazio) → qualquer taxa exata.
    Resultado (openmpt123 × Furnace): IT/XM/S3M/MPTM 0,95–1,00; MOD 0,78–0,94 (formato limitado).
  - **editável**: os padrões viram padrões (uma posição da ordem por posição), instrumentos viram instrumentos
    (IT/MPTM/XM: mapa de samples por nota, macro de volume → envelope de volume, macro de arpejo → envelope de pitch
    no IT), efeitos traduzidos (00, 01, 02, 03, 04, 05/06, 07, 08/80, 09/0F, 0A, 0B, 0C, 0D, 90, EC, ED, F0, F1-F4,
    F8/F9, FA). Efeitos contínuos do Furnace são repetidos a cada linha; o que não cabe vai para a coluna de volume
    ou fica de fora (o log conta). Resultado: 0,96–1,00 nas músicas sem síntese de onda.
- Ganchos novos: DivEngine::rgCmdHook (comandos para os chips) e DivExportRG::tickHook (depois de cada tique).
- Verificação: `openmpt123 --batch --render --no-float --samplerate 44100 --end-time 45 arquivo` + cmpwav.py.

## Ferramentas de sample — PRONTAS (24/11)
- Botão de chave inglesa no editor de samples: remover DC, tirar estalos das pontas, afinação automática (YIN),
  levar o loop ao cruzamento com zero, esticar o tempo (WSOLA) e mudar a altura. src/engine/rgsampletools.*.
- O "erro" da afinação automática não existia: eu tinha lido 363 Hz no print, mas era 263 Hz (o teste nativo com a
  sample real dá 263,3 Hz → 8233 Hz, o mesmo do navegador).

## Tocador de projetos de tracker no Chiptune Player — PRONTO (24/11)
- O motor do Furnace sem interface: src/rgplayer.cpp (API C rgf_*) + src/engine/rgplay.cpp, opção -DRG_PLAYER=ON.
- Build web (pasta build-rgpweb):
  `emcmake cmake .. -DBUILD_GUI=OFF -DRG_PLAYER=ON -DUSE_SDL2=OFF -DUSE_RTMIDI=OFF -DWITH_JSON=OFF -DCMAKE_BUILD_TYPE=Release
   -DWITH_INSTRUMENTS=OFF -DWITH_WAVETABLES=OFF -DWITH_LOCALE=OFF -DUSE_SNDFILE=ON -DWITH_OGG=OFF -DWITH_MPEG=OFF
   -DUSE_FREETYPE=OFF -DCMAKE_CXX_FLAGS=-fexceptions -DCMAKE_C_FLAGS=-fexceptions` e `emmake make furnace`
  → copiar furnace.js/.wasm como chiptune-player/rg-furnace.js/.wasm (4,4 MB). Native de teste: build-rgp
  (`./furnace arquivo saida.raw segundos`).
- rg-player.js: EXT_FUR (fur, dmf, ftm, 0cc, dnm, eft, tfm, tfe, fc, fc13, fc14, smod) → makeFurEngine (ring),
  com loop/duração pelo calcSongTimestamps, subsongs, canais com mute. 20 s renderizam em ~0,1 s.
- Os 70+ projetos do acervo (.ftm, .dnm, .tfe, .dmf, .fur) abrem e tocam. SMB .ftm × NSF original: 0,98.
- 0CC: o importador do Furnace já lê grooves, PARAMS_EXTRA e taxas até 1000 Hz; ignora DETUNETABLES,
  PARAMS_EMU, BOOKMARKS, JSON. Falta testar com arquivos .0cc do usuário.

## OpenMPT, próximos passos
- Ferramentas de sample (EM ANDAMENTO, fora do site): no fork, `git stash list` → "ferramentas de sample (em andamento)"
  (botão de chave inglesa no editor de samples: remover DC, tirar estalos, afinação automática, loop no cruzamento com
  zero, esticar o tempo, mudar a altura). Código DSP em src/engine/rgsampletools.* (cópia em /home/claude/work/stash).
  PROBLEMA: a afinação automática dá certo no teste nativo (363 Hz, afinação 435.93 → 5961 / 8430), mas no navegador
  dá 8233 nos dois modos. Investigar antes de publicar. O resto (WSOLA) foi testado e funciona.
- OPL4 (YMF278B): precisa da ROM yrw801 da Yamaha (direitos autorais) → o player avisa e pula (pedido do usuário).
- Soundfont gmgsx-plus.sf2: origem duvidosa; sugerido trocar por GeneralUser GS / FluidR3 (aguardando o usuário).
- Mais chips no modo fiel (ondas de PCE/SCC/Game Boy, pulsos, ruído) gerando samples.

## Próximos passos
1. Exportadores ainda não feitos: GSF/2SF (mais difíceis). SAP já existe (SAP-R).
2. SPC: as músicas que ainda não cabem são as de samples grandes (o limite é a RAM do próprio console).
   → Plano: SNSF (pedido pelo usuário, "SNSF no tracker e player"): ROM de SNES com driver 65816 que manda samples
   pela porta do APU (protocolo IPL) e toca o registro direto da ROM; e tocador de SNSF (snsf9x/snes9x) no
   Chiptune Player. Formato: PSF versão 0x23; programa = [u32 deslocamento][u32 tamanho][ROM]; reservado = blocos
   [u32 tipo][u32 tamanho] (tipo 0 = SRAM [u32 deslocamento][dados]). Fonte do snsf9x: github.com/loveemu/snsf9x.
3. Publicar o fork no GitHub (Niemann333/furnace) — GPL: o código do Tracker precisa estar disponível.

Fontes dos importadores do Studio: `tools/vgm-timbres.js`, `vgm-fur.js`, `fmt-import.js`, `sid-rip.js`, `estudio.src.html`, `build.py`;
rg-rip.js: `tools/rip-src/` (gme + aopsf + vio2sf + VBA/playgsf com ganchos).
