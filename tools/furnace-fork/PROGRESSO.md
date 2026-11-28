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
- 0CC: o importador do Furnace já lê grooves, PARAMS_EXTRA e taxas até 1000 Hz. NOVO (24/11): DETUNETABLES —
  a afinação de cada chip é medida em cents; a do 2A03 vira a afinação da música e os outros chips, se ficarem a
  meio semitom ou mais dela, têm as notas transpostas. O arquivo 0CC do acervo (DJ Maximum - Lights of are Minds.ftm,
  28 canais com as 6 expansões) tem todas as tabelas em +39 cents → afinação 450,04 Hz. O importador agora avisa
  no log quais efeitos do FamiTracker não têm equivalente (FDS volume/auto-FM, Mxy, VRC7 patch etc.); esse arquivo
  não usa nenhum. Sem um NSF exportado pelo próprio 0CC não dá para comparar o som.

## Fidelidade aos trackers originais (24/11) — EM ANDAMENTO, bem avançado
Pedido: "os módulos abertos no Furnace têm que tocar igual ao tracker de origem".
- Módulos (referência OpenMPT, 32 arquivos do acervo): IT/S3M/XM saíam 1,3×–2,5× mais altos e o IT estourava.
  Agora: volume global/mix volume (IT), master volume (S3M), nível do FT2 (XM), atenuação dentro do ES5506,
  lei de pan (linear; raiz quadrada no FT2), surround S91/XA4 (efeito novo 1Fxx do ES5506, fase invertida),
  S8x até 0xFF, Px do XM = x*16. Volume 0,89–1,10 do OpenMPT; largura estéreo igual. Teste: /tmp/modcmp/ratio.sh.
  Falta: volume global Vxx/Wxx (o Furnace não tem); XM salvos pelo ModPlug com nome de FT2 (nível diferente).
- FamiTracker/0CC: referência = player do próprio 0CC compilado aqui (tools/ref-0cc). Opção de compatibilidade
  nova `rgFamiTracker` (song.h, salva no .fur), ligada pelo importador. Comparação quadro a quadro do 2A03:
  antes "Time To Go Home" tinha >50% dos quadros diferentes; agora 0. Dos 31 módulos do acervo, 2A03 idêntico
  em ~22, quase idêntico no resto (G00 do driver; Hellpath.dnm; N163 cover; 2 VRC6 com diferenças de altura).
  Regras implementadas: ver a mensagem do commit 0044.
- 25/11: Axy exato (0Axy em oitavos no modo FamiTracker), sequência de pitch relativa no próprio período,
  vibrato antigo na fase 48, tempo 0 ≠ tempo 150 (flag rgFTTempo0). Agora 26 dos 31 módulos com o 2A03 idêntico;
  restam: penguins 3 quadros, Strut 27, gastly 3 (G00 do driver), Captain Houkin 304 (ruído não reescrito em
  algumas notas — investigar prevFreq do canal de ruído), Hellpath.dnm (o 0CC não é referência certa para .dnm:
  precisa do Dn-FamiTracker), laser.ftm (o 0CC não abre).
- 25/11 (tarde): ruído com vibrato/arpejo, 000/1xx/2xx/Qxy/Rxy substituem o 3xx da mesma linha, sweep de hardware,
  notas limitadas a C-0..B-7, slides até o limite do registrador. 30 de 31 módulos com o 2A03 idêntico
  (laser.ftm comparado com OCC_LENIENT=1). Falta só Hellpath.dnm (precisa de referência do Dn-FamiTracker,
  que só compila no Windows/MFC — pedir WAV/NSF ao usuário).
- Exportar áudio (WAV etc.) na web abortava a página: o Furnace usava std::thread, e a build web não tem threads.
  Agora roda numa fiber (ASYNCIFY), ~25 ms por quadro da interface (wavOps.cpp rgExportStep/rgExportYield).
- 25/11 (noite) — chips de expansão (pedido: DJ Maximum, WAV do Furnace x WAV do 0CC):
  * Mixagem do 0CC (CMixer): todos os chips menos o VRC7 multiplicados pelo produto das atenuações dos chips
    ligados (VRC6 0,80 · VRC7 0,64 · MMC5 0,83 · FDS 0,90 · N163 0,70 · S5B 0,50) e o N163 pelo "NamcoVolume"
    (cresce com os canais). O importador põe isso no volume de cada sistema (+ níveis medidos em 20 músicas).
    O WAV do Furnace saía ~7x mais alto e estourava; agora rms 1021 x 958 do 0CC, cada chip 0,93–1,07 do 0CC.
  * Triângulo: Sxx>=80 (contador linear), Exx (E00-E1F duração, EE0-EE3 envelope/laço) no 2A03 e no MMC5.
  * Tabelas de período/frequência do 0CC nota a nota com o detune em todos os chips (pitchTable initFT; N163 em
    unidades de tabela x4; FDS sem a transposição de 2 oitavas; VRC7 F-num no bloco da oitava).
  * Regras comuns em platform/rgFT.h (volume instrumento x canal / 15 nunca 0; 5B soma; dente de serra 64 passos;
    FDS ((i+1)(c+1)-1)/16; arpejo do efeito value2=1; pitch relativo no período; slides até o limite; nota com
    portamento volta volume/duty). Aplicadas no VRC6, MMC5, N163, FDS, VRC7 (opll) e 5B (ay).
  * VRC6: o 0CC não desliga o canal no fim da nota (só zera o volume). VRC7: sustain só no quadro da nota e na
    soltura (===), volume não reescrito com a nota parada, Pxx/vibrato 1 F-num, slide 1/4 F-num, núcleo emu2413
    com os timbres do 0CC (vrc7tone.h). 5B: ruído padrão (Wxx) volta a cada nota, escrito 1x por quadro.
    FDS: Hxx/Ixx/Jxx do 0CC (Jxy>=10 = modulação automática x/(y+1)), nota volta a modulação ao instrumento,
    tabela de modulação = valor do registrador (o importador tirava 3), sequência de pitch com o modo certo,
    núcleo NSFPlay + passa-baixas de 6 kHz (o 0CC filtra o FDS), volume até 32.
  * Tempo virtual exato no modo FamiTracker (400 Hz/224 Hz atrasavam ~1,3%: o importador dividia D por 2).
  * Ferramentas: occwav (áudio do próprio 0CC; OCC_SOLO=chip, OCC_SUB=canal, OCC_REGTEST), rgplayer com
    RGF_SYSSOLO/RGF_SYSCH/RGF_REGLOG/RGF_CHUNK/RGF_CONF, regcmp.py (registradores de todas as expansões).
  * Resultado: registradores idênticos ao 0CC no DJ Maximum (VRC6, VRC7, N163, MMC5; 5B e FDS só diferem com a
    nota parada); semelhança espectral por chip 0,967–0,990 nas 20 músicas com expansão; 2A03 sem regressão.
  * Falta: VRC7 com nível que muda por música (0,86–1,16: o 0CC usa um emu2413 antigo); atraso de modulação do
    FDS (o importador ignora); bias do FDS (Zxx); Hellpath.dnm (precisa do Dn-FamiTracker).

## Dn-FamiTracker como referência no lugar do 0CC (25/11) — PRONTO (o áudio), efeitos novos pendentes
- Pedido do usuário: trocar o 0CC pelo Dn-FamiTracker 0.5.3 (Gumball2415), com os emuladores mais novos dele.
- **APU do próprio Dn dentro do Furnace** (`extern/dnft-apu/`, cópia de Source/APU + Blip_Buffer do Dn, GPL):
  NSFPlay no 2A03, Mesen no FDS (passa-baixas 2 kHz) e no N163 (12 kHz, multiplexado), emu2413 1.5.2 com os timbres
  Nuke no VRC7, Blip_Buffer melhorado, filtros 30 Hz / 12 kHz / 24 dB. Tudo num arquivo só (`rgdn_unity.cpp`,
  namespace rgdn, C++17, sem PCH) + ponte `RGDnAPU` (rgdn.h).
- Como funciona: flag `rgDnAudio` (ligada em todo .ftm/.0cc/.dnm importado). As plataformas NES/VRC6/VRC7/FDS/
  MMC5/N163/5B continuam rodando (osciloscópio, exportações), mas repassam cada escrita de registrador para o APU do
  Dn; o motor gera um quadro do Dn a cada tick (`rgDn->tick()` em playback.cpp) e soma a saída mono no lugar da
  mixagem do patchbay. Mudo de canal = máscara do próprio APU (VRC7 por OPLL_setMask).
- .dnm: bloco JSON (apu1…s5b-offset + use-survey-mix → `rgDnLevels`/`rgDnSurvey`, mixagem "de hardware" do Dn) e
  PARAMS_EMU (timbres próprios do VRC7 → flag `rgDnOPLL` do sistema VRC7) agora são lidos.
- Medido contra o APU do Dn alimentado pelos registradores do player (`tools/ref-dn/dnwav.cpp`, `dncmp.py`):
  VRC6/VRC7/FDS/MMC5/N163/5B forma 0,95–1,000 e nível 0,99–1,01 em 11 músicas; registradores 2A03 sem regressão.
  O nível do 2A03 varia (0,72–1,32) porque a referência não recebe a memória das amostras do DPCM.
- Falta: efeitos novos do Dn (Kxx harmônico, =xx reinício de fase, Nxy volume-alvo) — nenhum módulo do acervo usa;
  Mxy (volume atrasado, 3 vezes no DJ Maximum) ainda sem equivalente; caixa no diálogo de compatibilidade.

## Módulos no Chiptune Studio (26/11) — PRONTO
- O Studio agora abre .fur/.dmf/.ftm/.0cc/.dnm/.eft/.tfm/.tfe/.fc/.smod (acervo e arquivos locais). O rg-furnace.wasm
  ganhou `rgf_vgm()` / `rgf_vgm_data()` / `rgf_vgm_kind()`: grava a música carregada em VGM; com VRC6, N163 ou MMC5
  (que o VGM não tem) grava NSF pelo exportador do fork, e o Studio lê pelo caminho de NSF que já existia.
  Roda num Worker (o rg-furnace.js também se chama RGFUR, o mesmo nome do conversor de .fur da página).
- O Studio mostra os dois (módulo e chiptune com o mesmo nome) — pedido do usuário; só o Chiptune Player esconde o módulo.
- Exportador NSF do fork agora leva o Sunsoft 5B (AY8910 com chipType 2 → $C000/$E000, bit 5 das expansões):
  no Studio o DJ Maximum mostra os canais do 5B.
- Subfaixas: menu "Faixa" do Studio para módulos (`rgf_subsong_name`); o worker troca a subfaixa antes de gravar e o
  player toca a mesma. Nomes do FamiTracker (Latin-1) decodificados certo.
- Conserto no leitor de VGM: o comando 0x95 (início rápido de stream do DAC) usava `var sid` e apagava o SID
  (erro "reading '24'" em VGMs com stream do DAC, ex.: Obvious Hut).
- Testado: as 71 músicas de módulo do acervo convertem (só o Kaminari, Snoozetracker, o Furnace não abre).

## VGM Music Maker (.vge) e BambooTracker (.btm) no Furnace (27/11) — PRONTOS
Pedido: "dois formatos a mais para entrar no tracker: BTM (BambooTracker) e VGE (VGM Music Maker)".
- Mesmo caminho do Dn: o tocador do próprio programa toca; o Furnace mostra os padrões e manda as escritas nos chips.
- VGE: núcleo do VGMMM 1.1 (reconstrução do Drozerix, com permissão do Shiru) em extern/vgmmm (namespace rgvgmmm).
  Importador fileOps/vge.cpp (YM2612 + SN76489, relógios, velocidade par/ímpar, instrumentos, amostras já convertidas);
  opção rgVGMMM; rgVge.cpp remonta o módulo do VGMMM a partir dos padrões do Furnace ao tocar (edições valem; efeitos
  com tabela de ida e volta em rgVgeMap.h, tamanho do padrão = 0D00 na 5ª coluna). DAC pelo Furnace (rgVgeDac),
  mudo pelo pan/volume. Escritas idênticas ao VGM do próprio VGMMM nos 7 .vge do acervo (ida e volta pelo Furnace);
  áudio: nível 0,94–0,98, bandas ±1 dB (agudos −2 a −4 dB: núcleo YM2612 diferente), correlação 0,83–0,96.
- BTM: núcleo do BambooTracker (GPL2) em extern/bambootracker (namespace rgbtcore), com um OPNA de mentira que só
  guarda as escritas e a memória do ADPCM. Importador fileOps/btm.cpp (YM2608 ou YM2608 com FM3 estendido, subfaixas,
  padrões e instrumentos para ver); o .btm original fica em rgBTData (base64) e o BambooTracker toca a partir dele
  (rgBT.cpp; edições nos padrões não mudam o som). Tempos pelo próprio BambooTracker (tocado em silêncio, com cache).
  Mixer do módulo (PC-9801-86 etc.) aplicado: nível por pista 0,98–1,01 do WAV do BambooTracker, FM corr 0,994.
- Studio (FUR_RE), Chiptune Player (rg-player.js, AUDIO, duplicados), índices (Actions e tracker) aceitam .vge/.btm.
- CONVERSÃO NATIVA (pedido: "o Furnace aplicar suas configurações", com opção de voltar ao tocador original):
  .vge e .btm abrem como música do Furnace (padrões/instrumentos/efeitos traduzidos); o original continua em
  rgVgeData/rgBTData. Caixa "Tocar com o programa original" em Informações da música e em Compatibilidade
  (DivEngine::rgSetOriginalPlayer liga rgVGMMM/rgBT e reinicia o chip). rgplayer: RGF_ORIG=1 toca o original.
  VGE (fileOps/vge.cpp): PSG do VGMMM = teto(envelope*volume) → instrumento por (instrumento, volume) com ADSR
  fino (bit 16 em open: frações do topo/sustain/fundo em val[9..11], macroInt.cpp) + volume fino no SN76489
  (flag de sistema rgFineVol, sms.cpp, DivEngine::rgChanVolume); ruído taxa 3 = período do tom 3 (20 1x);
  estéreo do PSG (Game Gear, chipType 3, 19xx → 08xy); systemVol 1,77 / 0,27. Registradores iguais ao tocador
  original (PSG tique a tique); espectro vs WAV do VGMMM: mediana 0,8–1,3 dB (o tocador original dá 0,7–1,1).
  BTM (fileOps/btm.cpp + Player::instrumentDetails em rgbt_unity.cpp: sequências tocadas pelo iterador do BT,
  laço e soltura detectados): flag rgBTNative (tempo do TickCounter do BT em float = rgBTRowLen, vibrato 04xy
  em triângulo 4x período, E1/E2 = 0Q/0R (y semitons em x tiques, não anda no 1º tique)); operadores S1 S2 S3 S4
  → op[] {0,2,1,3}; SSG +12 (tabela do BT uma oitava acima) e E5 7D (tabela de 8 MHz); ruído na macro duty =
  31-período; volMacroLinger desligado; ADPCM centerRate = deltaN da raiz na nota raiz (+60). Espectro vs WAV do
  BT: mediana 0,88 dB / p90 3,6 (original 0,62 / 2,5); por pista 0,1–0,5 dB (FM3 op2/op4 p90 ~8 dB no solo).
  Ainda não convertidos (avisa no log): envelope de hardware/ondas não quadradas do SSG, sequências de
  operador, arpejo/altura por operador, bateria de ADPCM, eco (^n) usa a 1ª ocorrência do padrão.
- Referências: tools/ref-vgmmm, tools/ref-bt.

## Skins (2026-11-28)
- src/gui/rgSkins.cpp: skins = cores (sobre a base do Furnace ou o verde do blog) + fontes + cantos/bordas;
  menu configurações → skin; a página chama rg_web_skin(id) e o Furnace avisa a página (Module.rgOnSkin).
  Skins: registro (verde, padrão no Tracker), studio (azul-roxo), furnace, famitracker (janela do Windows +
  editor preto/verde/amarelo, fonte DejaVu Sans Mono Bold em res/web/fonts), openmpt (editor branco, colunas
  coloridas, Proggy Clean).
- chiptune-player/rg-skins.js: lista e escolha guardada em localStorage "rgSkin" (só o nome), vale no Studio
  (CSS por html[data-skin]) e no Tracker (barra de cima + Furnace).

## OpenMPT, próximos passos
- Ferramentas de sample: PRONTAS e publicadas (ver a seção de 24/11; o "erro" da afinação automática no navegador
  não existia — 263 Hz → 8233 bate com o nativo).
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
3. Publicar o fork no GitHub (LucNiemann/furnace) — GPL: o código do Tracker precisa estar disponível.

Fontes dos importadores do Studio: `tools/vgm-timbres.js`, `vgm-fur.js`, `fmt-import.js`, `sid-rip.js`, `estudio.src.html`, `build.py`;
rg-rip.js: `tools/rip-src/` (gme + aopsf + vio2sf + VBA/playgsf com ganchos).

## Chiptune → Áudio (conversor, 2026-11-28)
- `chiptune-player/audio.html`: converte chiptunes e módulos em MP3 (CBR 64–320 / VBR V0–V8), WAV (16/24/32 float), OGG Vorbis (q2–q10), FLAC (0/5/8, 16/24 bits), Opus (WebCodecs + Ogg próprio) e AIFF. Frequência 22–96 kHz, estéreo/mono, voltas do loop, fade, limite, normalizar (−1 dB), todas as subfaixas, vários arquivos de uma vez, .zip.
- O som vem do motor do Chiptune Player (`rg-player.js`, comando `render`: toca a faixa sem som, o mais rápido possível, com a mesma duração/loop/fade do player). Não passa pelo Tracker.
- Codificadores em `chiptune-player/enc/` (wasm-media-encoders e libflac.js, MIT).
- Botão "🔊 Chiptune → Áudio" na barra do Tracker; "⬇ Áudio" no Studio (já com a música escolhida, inclusive arquivo local).
- Testado: NSF, FUR, VGZ em todos os formatos (ffprobe confere taxa, bits, duração e pico −1 dB).

## Exportar GSF e 2SF (2026-11-28)
- **GSF (Game Boy Advance)** — `src/engine/export/gsf.cpp` + `gsfdrv.s` (ARM). Chips: GBA DMA, GBA MinMod e Game Boy. A música é mixada enquanto toca (acquire de cada chip + blip_buf) em áudio de 8 bits com sinal, como o mixer de software dos jogos de GBA, e tocada pelos canais de som direto (DMA 1 → FIFO A esquerda, DMA 2 → FIFO B direita; uma trilha só se for mono). Timer 0 = taxa (32768 Hz; menor se a música não couber em 32 MB), timer 1 em cascata conta as amostras; no fim o driver esvazia as FIFOs e volta os DMA para o ponto de loop (erro ≤ 2 amostras, o DMA lê de 4 em 4 bytes). Testado no motor GSF do Chiptune Player: correlação 0,99 com a trilha gravada.
- **2SF (Nintendo DS)** — `nds2sf.cpp` + `ndsdrv.s` (ARM7). Imagem de cartucho: ARM9 (laço parado + samples + registro em 02000000h) e ARM7 (driver em 03800000h) que repete as escritas do chip NDS a cada tique (timer 0, 33,5 MHz/64, fração acumulada). Frequência/loop/tamanho vão como escritas de 16/32 bits (o vio2sf ignora escritas de 8 bits nesses registradores). Volume geral pela metade: o mixer do DS (e o vio2sf) é 2× mais alto que o núcleo do Furnace e satura. Testado no vio2sf nativo (2sftowav) e no Chiptune Player.
- Driver ARM: `scripts/rg-mkdrv-arm.sh fonte.s endereço nome saída.inc "comentário"` (llvm-mc + ld.lld).
- Depuração: `RG_CHANGE_SYS=índice:fileID` (só nativo) troca um chip depois de abrir (ex.: `0:214` = Nintendo DS).

## BambooTracker: o que faltava (2026-11-28)
- **Bateria de ADPCM**: mapa de notas do instrumento (tecla → amostra e nota que dá deltaN = raiz × 2^(altura/12)); amostra com outra calibração ganha cópia; panorama de cada tecla vira 08xx junto da nota. Conferido: o chip recebe os mesmos deltaN do player original (±1).
- **Sequências de operador do FM**: AL, FB e AR/DR/SR/RR/SL/TL/KS/ML/DT/SSGEG por operador viram macros.
- **SSG**: envelope de hardware na sequência de envelope (forma ex2, período fixo ex5 ou proporcional ao tom ex3/alg) e as formas de onda triângulo/serra/serra invertida (com e sem máscara quadrada) pelo envelope automático. Nenhuma música de exemplo usa; feito pelas fórmulas do BambooTracker, sem comparação com o original.
- Falta: arpejo/altura por operador.

## Aviso de privacidade (2026-11-28)
- `chiptune-player/privacidade.html` (PT/EN): o que o contador guarda, 400 dias, Cloudflare, terceiros, direitos da LGPD. Botão "não contar minhas visitas" (`rgNoStats`); `rg-stats.js` respeita isso e o Global Privacy Control / Do Not Track. `rg-optout.html` faz o mesmo aberto direto (endereço das ferramentas).
- Página do Blogger: `tools/blog/pagina-privacidade.html` (moldura com altura automática). Mobile: link "🔒 Aviso de privacidade" no fim da aba Blog.
