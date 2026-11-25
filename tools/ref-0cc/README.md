# Referência do 0CC-FamiTracker (para medir a fidelidade do Furnace)

O 0CC-FamiTracker v0.3.15.3 (https://github.com/HertzDevil/0CC-FamiTracker, tag v0.3.15.3) traz a pasta
`0ccft-ext`, que compila o núcleo fora do Windows. Aqui ficam duas ferramentas sobre ele:

- `occnsf entrada.ftm saida.nsf [máquina] [nsfe]` — exporta NSF/NSFE com o compilador do próprio 0CC.
- `occrender entrada.ftm saida.log segundos [faixa]` — toca o módulo com o **player do editor do 0CC**
  (o mesmo que se ouve no programa) e grava cada escrita nos chips ("tempo chip registrador valor").

- `occwav entrada.ftm saida.wav segundos` — o **áudio** do 0CC (APU e mixer dele, igual ao WAV exportado pelo
  programa). `OCC_SOLO=n` toca só um chip (0 2A03, 1 VRC6, 2 VRC7, 3 FDS, 4 MMC5, 5 N163, 6 S5B), `OCC_SUB=n` só um
  canal desse chip, `OCC_REGTEST=1` toca notas fixas para medir os níveis do mixer.

Para compilar: clonar a tag, copiar `occnsf.cpp`, `occrender.cpp`, `occwav.cpp` e `rgpre.h` para `0ccft-ext/`, aplicar
`0cc-ajustes.patch` (o player usa as configurações padrão em vez de nenhuma) e `CMakeLists.diff`
(arquivos que faltam na lista, sem -Werror, cabeçalhos padrão forçados, os dois executáveis), e então
`mkdir build && cd build && cmake .. && make occnsf occrender occwav`.

Comparação dos chips de expansão (registradores e áudio):
- o tocador nativo do fork (`build-rgp/furnace arq saida.raw segundos`) grava as escritas de todos os chips com
  `RGF_REGLOG=arquivo` (`RGF_CHUNK=16` para músicas com taxa alta); `RGF_SYSSOLO=n`/`RGF_SYSCH=n` tocam só um sistema/canal.
- `regcmp.py ref.log fur.reg chip` (vrc6 vrc7 fds mmc5 n163 s5b; `EXP=` byte de expansões, `RATE=` taxa) — diferenças por quadro.
- `solocmp.py arquivo.ftm [segundos]` — nível e semelhança espectral de cada chip, 0CC x Furnace.

Comparação do 2A03:
- `vgmlog.py arq.vgm saida.log` — escritas do Furnace (VGM exportado com `furnace -loops 0 -direct -vgmout`).
- `apucmp.py ref.log teste.log [quadros] [mostrar]` — estado de cada canal quadro a quadro; `RATE=` com a taxa da música.
- `comparar-um.sh arquivo.ftm` — faz tudo e resume; `trechos.py` lista os trechos diferentes.
- `ftmblocks.py` / `ftmpos.py` — leem o .ftm (sequências, instrumentos, efeitos de uma ordem/linha).
