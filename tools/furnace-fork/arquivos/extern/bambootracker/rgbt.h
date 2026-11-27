// RG: ponte entre o Furnace e o núcleo do BambooTracker (extern/bambootracker).
// O BambooTracker fica inteiro dentro do namespace rgbtcore (rgbt_unity.cpp); daqui só saem tipos simples.
#ifndef _RGBT_H
#define _RGBT_H

#include <vector>
#include <string>
#include <cstddef>

namespace rgbt {
  struct Write {
    unsigned short addr; // 0x000-0x1ff (parte A/B); 0xffff = o chip foi zerado
    unsigned char val;
  };

  struct Effect {
    char id[3];          // "0A", "T1", "ES"... ("" = nada)
    int value;           // -1 = nada
  };

  struct Step {
    int note;            // >=0 nota (oitava*12+semitom), -1 nada, -2 key off, -7 key cut, -3..-6 eco
    int ins;             // -1 nada
    int vol;             // -1 nada
    Effect fx[4];
  };

  enum SourceType { FM=0, SSG, RHYTHM, ADPCM };

  struct Track {
    SourceType source;
    int channel;         // canal dentro da fonte
  };

  struct InsInfo {
    int number;
    int type;            // 0 FM, 1 SSG, 2 ADPCM, 3 bateria ADPCM
    std::string name;
    // FM (para mostrar no Furnace)
    int alg, fb;
    int ar[4], dr[4], sr[4], rr[4], sl[4], tl[4], ks[4], ml[4], dt[4], ssgeg[4], am[4];
    bool opOn[4];
    int sample;          // ADPCM: número da amostra
  };

  // sequência do instrumento, já tocada pelo iterador do BambooTracker (um valor por tique)
  struct Seq {
    bool on=false;
    int type=0;               // 0 simples, 1 absoluta, 2 fixa, 3 relativa
    std::vector<int> val;     // valor bruto do BambooTracker
    std::vector<int> sub;     // subdado (envelope do SSG: período do envelope de hardware)
    int loop=-1;              // volta para cá enquanto a nota toca
    int rel=-1;               // ao soltar a nota pula para cá (o resto é a soltura)
  };

  struct InsDetail {
    int number=0;
    int type=0;
    Seq arp, pitch, pan;      // FM (todos os operadores), SSG e ADPCM
    Seq ssgWave, ssgTN, ssgEnv;
    Seq adpcmEnv;
    int rootKey=48;           // ADPCM: nota raiz (C4 = 48)
    int rootDeltaN=0;
    bool repeat=false;
    bool envReset=false;      // FM: zerar o envelope a cada nota
    bool lfoOn=false;
    int lfoFreq=0, lfoAMS=0, lfoPMS=0, lfoAM[4]={0,0,0,0};
    std::vector<std::string> unsupported;
  };

  struct SampleInfo {
    int number;
    std::string name;
    std::vector<unsigned char> data; // ADPCM-B
    int rootRate;        // taxa de reprodução (deltaN) da nota raiz
  };

  class Player {
    struct Impl;
    Impl* p;
    public:
      Player();
      ~Player();
      // lê o .btm; false = erro (msg)
      bool load(const unsigned char* buf, size_t len, std::string& msg);
      // informações do módulo
      std::string title();
      std::string author();
      std::string copyright();
      std::string comment();
      int tickFrequency();
      int songCount();
      std::string songTitle(int s);
      bool songExtended(int s);       // FM3 com 4 operadores separados
      int songTempo(int s);
      int songSpeed(int s);
      int songPatternSize(int s);
      std::vector<Track> songTracks(int s);
      int orderSize(int s);
      int patternIndex(int s, int track, int order);
      int patternSize(int s, int order);
      void getStep(int s, int track, int order, int step, Step& out);
      std::vector<InsInfo> instruments();
      std::vector<SampleInfo> samples();
      std::vector<InsDetail> instrumentDetails();
      int mixerType();                // 0 não definido, 1 personalizado, 2.. presets
      double mixerFM();               // dB
      double mixerSSG();              // dB

      // tocar a música s a partir de order/step: as escritas iniciais saem em out
      void start(int s, int order, int step, std::vector<Write>& out);
      // um tique (interrupção): devolve true quando passa pelo ponto de volta;
      // order/step = posição tocando, newStep = começou um passo neste tique, ended = a música acabou (0Cxx)
      bool tick(std::vector<Write>& out, int& order, int& step, bool& newStep, bool& ended);
      // memória do ADPCM (DRAM de 256 KiB) depois de start()
      const unsigned char* dram(size_t& len);
      // tempo (em tiques) de cada passo até o fim, e onde começa o laço
      void timing(int s, std::vector<int>& orderOut, std::vector<int>& stepOut, std::vector<long>& tickOut, int& loopOrder, int& loopStep, long& totalTicks, bool& loops);
  };
}

#endif
