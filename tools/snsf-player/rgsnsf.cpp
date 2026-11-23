// Registro Gamer: tocador de SNSF (SNES Sound Format) para o Chiptune Player, sobre o snsf9x (Snes9x).
// o JavaScript carrega os arquivos na ordem do psflib (_lib primeiro, depois o próprio arquivo, depois _lib2...)
// e chama snsf_add_psf para cada um; snsf_start liga o emulador e snsf_render devolve áudio estéreo 16 bits.
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <vector>
#include <zlib.h>
#include "snsf9x/snsf9x/SNESSystem.h"

static std::vector<uint8_t> rom, sram;
static bool baseSet=false;
static uint32_t base=0;
static SNESSystem* sys=NULL;
static std::vector<int16_t> fifo;
static size_t fifoPos=0;

static uint32_t le32(const uint8_t* p) { return p[0]|(p[1]<<8)|(p[2]<<16)|((uint32_t)p[3]<<24); }

struct Out: public SNESSoundOut {
  void write(const void* samples, unsigned long bytes) {
    const int16_t* s=(const int16_t*)samples;
    fifo.insert(fifo.end(),s,s+bytes/2);
  }
};
static Out out;

extern "C" {

void snsf_begin() {
  rom.clear(); sram.clear(); baseSet=false; base=0;
  if (sys) { delete sys; sys=NULL; }
  fifo.clear(); fifoPos=0;
}

// um arquivo .snsf/.minisnsf/.snsflib inteiro; devolve 0 se deu certo
int snsf_add_psf(const uint8_t* f, int len) {
  if (len<16 || memcmp(f,"PSF",3)!=0 || f[3]!=0x23) return -1;
  uint32_t rsv=le32(f+4), prg=le32(f+8);
  if (16ULL+rsv+prg>(unsigned)len) return -2;
  const uint8_t* r=f+16;
  const uint8_t* p=f+16+rsv;
  if (prg>0) {
    uLongf cap=prg*4+65536;
    std::vector<uint8_t> exe;
    int z;
    while (true) {
      exe.resize(cap);
      uLongf got=cap;
      z=uncompress(exe.data(),&got,p,prg);
      if (z==Z_BUF_ERROR && cap<(64u<<20)) { cap*=2; continue; }
      if (z!=Z_OK) return -3;
      exe.resize(got);
      break;
    }
    if (exe.size()>=8) {
      uint32_t ofs=le32(&exe[0]), sz=le32(&exe[4]);
      if (sz>exe.size()-8) return -4;
      if (!baseSet) { base=ofs; baseSet=true; } else ofs+=base;
      if (rom.size()<ofs+sz) rom.resize(ofs+sz,0);
      memcpy(&rom[ofs],&exe[8],sz);
    }
  }
  // seção reservada: blocos [tipo][tamanho]; tipo 0 = SRAM [deslocamento][dados]
  uint32_t at=0;
  while (at+8<=rsv) {
    uint32_t type=le32(r+at), size=le32(r+at+4);
    if (at+8+size>rsv) break;
    if (type==0 && size>=4) {
      uint32_t ofs=le32(r+at+8), n=size-4;
      if (ofs+n<=0x20000) {
        if (sram.size()<ofs+n) sram.resize(ofs+n,0);
        memcpy(&sram[ofs],r+at+12,n);
      }
    }
    at+=8+size;
  }
  return 0;
}

int snsf_start(int rate) {
  if (rom.empty()) return -1;
  if (sys) delete sys;
  sys=new SNESSystem;
  if (!sys->Load(rom.data(),rom.size(),sram.empty()?NULL:sram.data(),sram.size())) return -2;
  sys->soundSampleRate=rate;
  sys->SoundInit(&out);
  sys->SoundReset();
  sys->Init();
  sys->Reset();
  fifo.clear(); fifoPos=0;
  return 0;
}

// quadros estéreo (2 x int16 cada)
int snsf_render(int16_t* buf, int frames) {
  if (!sys) return 0;
  size_t need=(size_t)frames*2;
  int guard=0;
  while (fifo.size()-fifoPos<need && guard<100000) {
    if (fifoPos>0) { fifo.erase(fifo.begin(),fifo.begin()+fifoPos); fifoPos=0; }
    sys->soundEnableFlag=0xff;
    sys->CPULoop();
    guard++;
  }
  size_t n=fifo.size()-fifoPos;
  if (n>need) n=need;
  memcpy(buf,&fifo[fifoPos],n*2);
  fifoPos+=n;
  if (n<need) memset(buf+n,0,(need-n)*2);
  return (int)(n/2);
}

}
#ifdef RG_DEBUG
#include "snsf9x/snsf9x/snes9x/apu/SNES_SPC.h"
extern SNES_SPC* spc_core;
extern "C" void snsf_dump(const char* fn) {
  static unsigned char b[0x10200];
  SNES_SPC::init_header(b);
  spc_core->save_spc(b);
  FILE* f=fopen(fn,"wb"); fwrite(b,1,sizeof(b),f); fclose(f);
}
#endif
