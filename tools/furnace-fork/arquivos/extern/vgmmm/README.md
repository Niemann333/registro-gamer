# VGM Music Maker (núcleo do tocador)

Cópia de `src/core` de https://github.com/Drozerix/VGMMM — reconstrução em C++ do VGM Music Maker 1.1 do Shiru
(publicada com a permissão dele, segundo o README do projeto). Usada pelo importador de .vge do Furnace (fork do
Registro Gamer) para tocar os módulos exatamente como o programa original: o tocador gera as escritas nos
registradores do YM2612 e do SN76489 a cada tique, e o Furnace as manda para os chips.

Mudança local: `player.cpp` chama `g_rgDacHook` em `dac_start`/`dac_stop` (o DAC toca pelo Furnace).
Tudo é compilado dentro do namespace `rgvgmmm` por `rgvge_unity.cpp`.
