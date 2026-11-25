# Referência do 0CC-FamiTracker (para medir a fidelidade do Furnace)

O 0CC-FamiTracker v0.3.15.3 (https://github.com/HertzDevil/0CC-FamiTracker, tag v0.3.15.3) traz a pasta
`0ccft-ext`, que compila o núcleo fora do Windows. Aqui ficam duas ferramentas sobre ele:

- `occnsf entrada.ftm saida.nsf [máquina] [nsfe]` — exporta NSF/NSFE com o compilador do próprio 0CC.
- `occrender entrada.ftm saida.log segundos [faixa]` — toca o módulo com o **player do editor do 0CC**
  (o mesmo que se ouve no programa) e grava cada escrita nos chips ("tempo chip registrador valor").

Para compilar: clonar a tag, copiar `occnsf.cpp`, `occrender.cpp` e `rgpre.h` para `0ccft-ext/`, aplicar
`0cc-ajustes.patch` (o player usa as configurações padrão em vez de nenhuma) e `CMakeLists.diff`
(arquivos que faltam na lista, sem -Werror, cabeçalhos padrão forçados, os dois executáveis), e então
`mkdir build && cd build && cmake .. && make occnsf occrender`.

Comparação (só o 2A03 por enquanto):
- `vgmlog.py arq.vgm saida.log` — escritas do Furnace (VGM exportado com `furnace -loops 0 -direct -vgmout`).
- `apucmp.py ref.log teste.log [quadros] [mostrar]` — estado de cada canal quadro a quadro; `RATE=` com a taxa da música.
- `comparar-um.sh arquivo.ftm` — faz tudo e resume; `trechos.py` lista os trechos diferentes.
- `ftmblocks.py` / `ftmpos.py` — leem o .ftm (sequências, instrumentos, efeitos de uma ordem/linha).
