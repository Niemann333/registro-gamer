// RG: interface do áudio do Dn-FamiTracker 0.5.3 dentro do Furnace (implementação em rgdn_unity.cpp).
// O Furnace manda para cá as mesmas escritas de registrador que manda para os próprios chips, e o som
// sai pelo APU/mixer do Dn (NSFPlay 2A03, Mesen FDS/N163, emu2413 do Dn, VRC6/MMC5/5B do Dn, Blip_Buffer do Dn).
#ifndef _RGDN_H
#define _RGDN_H

#include <cstddef>

enum RGDnChip {
  RGDN_2A03=0,
  RGDN_VRC6,
  RGDN_VRC7,
  RGDN_FDS,
  RGDN_MMC5,
  RGDN_N163,
  RGDN_S5B,
  RGDN_CHIPS
};

class RGDnAPU {
  struct Impl;
  Impl* p;
  public:
    // expansions: bits do FamiTracker (1 VRC6, 2 VRC7, 4 FDS, 8 MMC5, 16 N163, 32 5B)
    // tickRate: taxa do motor (60, 50, 400...), sampleRate: taxa de saída
    // vrc7Patch: jogo de timbres do Dn (0 = Nuke, o padrão), survey: mixagem "por hardware" do Dn
    // levelOffsets: 8 ajustes de nível do módulo (centésimos de dB), como no .dnm; pode ser NULL
    // opllPatch: 19x8 bytes de timbres próprios do VRC7 (bloco PARAMS_EMU do .dnm), ou NULL
    void setup(int expansions, int tickRate, int sampleRate, bool pal, int vrc7Patch, bool survey, const short* levelOffsets, const unsigned char* opllPatch=NULL);
    // zera o APU e faz as escritas iniciais do Dn (CSoundGen::ResetAPU)
    void reset();
    // escrita no endereço da CPU do NES (4000-4017, 9000-B002, 9010/9030, 4040-408A, 5000-5015, F800/4800, C000/E000)
    void write(int chip, unsigned short addr, unsigned char val);
    // N163: escrita na RAM interna (endereço 0-7F) com máscara (o Furnace escreve meio byte de cada vez)
    void writeN163(unsigned char addr, unsigned char val, unsigned char mask);
    // memória de DPCM vista a partir de $C000 (janela do banco atual)
    void setSampleMem(const unsigned char* mem, size_t len);
    // silencia um canal de um chip (regrava o registrador de volume)
    void setMute(int chip, int chan, bool mute);
    // um tique do motor: gera o quadro do Dn com as escritas recebidas desde o último tique
    void tick();
    // entrega len amostras mono (16 bits) na taxa de saída, do que os tiques já geraram
    void render(short* out, size_t len);
    RGDnAPU();
    ~RGDnAPU();
};

#endif
