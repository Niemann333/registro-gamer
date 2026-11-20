// GSF (Game Boy Advance): roda o jogo no VBA do playgsf e grava
//  · as escritas nos canais "de Game Boy" do GBA (registradores 0x60-0x9F)
//  · o estado dos 12 canais de sample do driver MP2K/"Sappy" (o mais comum nos jogos de GBA), lido da RAM:
//    os canais Direct Sound são mixados pelo próprio programa, então as notas só aparecem na memória do driver
#include "VBA/System.h"
#include "VBA/Sound.h"
#include "VBA/Util.h"
#include "VBA/GBA.h"
#include "VBA/Globals.h"
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <vector>

extern "C" void rg_log(int chip, int addr, int data, double clk);
extern "C" void rg_bytes(int chip, int addr, int len, const unsigned char* p, double clk);
extern "C" void rg_aud_push(const short* p, int n);
extern double rg_base, rg_rate;
extern bool cpuIsMultiBoot;
extern int loadedsize;
extern "C" { extern int soundIndex; extern u16 soundFinalWave[]; extern int soundBufferLen; extern int soundInitialized; }

u8 *rg_gsf_img = 0; int rg_gsf_size = 0;

extern "C" {
double decode_pos_ms = 0; int seek_needed = -1;
int TrackLength = 0x7FFFFFFF, FadeLength = 0, IgnoreTrackLength = 1, DefaultLength = 150000, playforever = 1, TrailingSilence = 0;
int DetectSilence = 0, silencedetected = 0, silencelength = 5;
int cpupercent = 0, relvolume = 1000, defvolume = 1000, deflen = 0, deffade = 0;
void end_of_track(void) {}
int sndNumChannels = 2, sndSamplesPerSec = 44100, sndBitsPerSample = 16;
}

static long DONE = 0;
static int MP_ON = 0;
struct MpCh { u32 st, ev, fr, wav, ptr, key; };
static MpCh MC[12];
struct GSmp { u32 addr, size; uint32_t h; };
static std::vector<GSmp> GS;
static int KEEP = 0;

static u8* memp(u32 a) {
  switch (a >> 24) {
    case 2: return workRAM ? workRAM + (a & 0x3FFFF) : 0;
    case 3: return internalRAM ? internalRAM + (a & 0x7FFF) : 0;
    case 8: case 9: case 10: case 11: case 12: case 13: return rom && (int)(a & 0x1FFFFFF) < loadedsize ? rom + (a & 0x1FFFFFF) : 0;
  }
  return 0;
}
static u32 rd32(u32 a) { u8* p = memp(a); if (!p) return 0; return p[0] | (p[1] << 8) | (p[2] << 16) | ((u32)p[3] << 24); }
static u32 rd8(u32 a) { u8* p = memp(a); return p ? *p : 0; }

extern "C" void rg_gba_w(int size, int addr, int data) { rg_log(60 + (size == 2 ? 1 : 0), addr, data, soundIndex); }

// sample do MP2K: cabeçalho (tipo, laço, taxa*1024, início do laço, tamanho) + dados de 8 bits
static int mpSample(u32 w) {
  u32 type = rd8(w), st = rd8(w + 3), freq = rd32(w + 4), ls = rd32(w + 8), sz = rd32(w + 12);
  if (!memp(w + 16) || sz == 0 || sz > 0x400000) return -1;
  u32 n = type & 1 ? ((sz + 63) / 64) * 33 : sz;   // tipo 1: comprimido (blocos de 33 bytes para 64 amostras)
  if (!memp(w + 16 + n - 1)) return -1;
  uint32_t h = 2166136261u; u8* p = memp(w + 16);
  for (u32 k = 0; k < n; k += 7) h = (h ^ p[k]) * 16777619u;
  for (int k = (int)GS.size() - 1; k >= 0; k--) if (GS[k].addr == w && GS[k].size == sz && GS[k].h == h) return k;
  GSmp g; g.addr = w; g.size = sz; g.h = h; GS.push_back(g);
  int id = (int)GS.size() - 1;
  rg_bytes(70, id, (int)n, p, soundIndex);
  rg_log(72, (int)freq, (int)(ls | ((st & 0xC0) ? 0x80000000u : 0)), soundIndex);
  rg_log(73, (int)sz, (int)type, soundIndex);
  return id;
}

static void mpPoll() {
  u32 si = rd32(0x03007FF0);
  if (!memp(si)) return;
  u32 ident = rd32(si);
  if (ident - 0x68736D53u > 10) return;
  int maxCh = rd8(si + 6); if (maxCh > 12) maxCh = 12; if (maxCh <= 0) return;
  if (!MP_ON) { MP_ON = 1; rg_log(69, (int)rd32(si + 20), 0, soundIndex); }
  for (int c = 0; c < maxCh; c++) {
    u32 b = si + 0x50 + c * 0x40;   // SoundInfo.chans fica em +0x50, 0x40 bytes por canal
    u32 st = rd8(b), type = rd8(b + 1), evl = rd8(b + 11), evr = rd8(b + 10), key = rd8(b + 8) | (rd8(b + 17) << 8) | (rd8(b + 18) << 16);
    u32 fr = rd32(b + 32), wav = rd32(b + 36), ptr = rd32(b + 40);
    MpCh& m = MC[c];
    u32 ev = st | (evl << 8) | (evr << 16) | (type << 24);
    bool on = st != 0, was = m.st != 0;
    bool fresh = on && ((st & 0x80) || !was || wav != m.wav || (ptr < m.ptr && (st & 3) == 3 && (m.st & 3) != 3) || key != m.key);
    if (fresh) {
      int id = mpSample(wav);
      rg_log(63, c, (int)fr, soundIndex);
      rg_log(64, c, (int)key, soundIndex);
      rg_log(62, c, (int)ev, soundIndex);
      rg_log(65, c, id, soundIndex);          // canal liga com o sample id (usa os 3 anteriores)
    } else if (on) {
      if (fr != m.fr) rg_log(63, c, (int)fr, soundIndex);
      if (ev != m.ev) rg_log(62, c, (int)ev, soundIndex);
    } else if (was) rg_log(66, c, 0, soundIndex);   // canal calou
    m.st = st; m.ev = ev; m.fr = fr; m.wav = wav; m.ptr = ptr; m.key = key;
  }
}

extern "C" void writeSound(void) {
  mpPoll();
  int n = soundBufferLen / 2;
  if (KEEP) rg_aud_push((const short*)soundFinalWave, n);
  DONE += n / 2; rg_base = DONE;
}

extern "C" int gsf_run(unsigned char* img, int size, unsigned entry, double seconds, int keep) {
  KEEP = keep; DONE = 0; MP_ON = 0; memset(MC, 0, sizeof MC); GS.clear();
  rg_base = 0; rg_rate = 44100;
  cpuIsMultiBoot = (entry >> 24) == 2;
  rg_gsf_img = img; rg_gsf_size = size;
  if (rom != NULL) CPUCleanUp();
  int ok = CPULoadRom("rg.gsf");
  rg_gsf_img = 0;
  if (!ok) return -1;
  if (soundInitialized) soundReset(); else { soundInit(); soundInitialized = true; }
  CPUInit((char*)NULL, false); CPUReset();
  long total = (long)(seconds * 44100);
  while (DONE < total) CPULoop(250000);
  return 0;
}
