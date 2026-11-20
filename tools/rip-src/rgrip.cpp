// Lê NSF/GBS/KSS/SAP/SPC/HES/AY com o game-music-emu e grava cada escrita nos chips de som (tempo, chip, registrador, valor).
// O Chiptune Studio transforma esse registro em notas e timbres.
#include "gme/gme.h"
#include "gme/Spc_Dsp.h"
#include "gme/rg_log.h"
#include <vector>
#include <stdint.h>
#include <string.h>
#include <emscripten.h>
#include <stdlib.h>
extern "C" {
#include "aopsf/psx_external.h"
}
#include "2sftowav/src/vio2sf/desmume/types.h"
#include "2sftowav/src/vio2sf/desmume/state.h"
extern "C" void rg_nds_reset();

double rg_base = 0, rg_rate = 1;
static std::vector<double> L;
static std::vector<uint8_t> BLOB;
struct Smp { int start, len, blobOff; uint32_t hash; };
static std::vector<Smp> SMPS;
static Music_Emu* EMU = 0;
static int MAXLOG = 6000000;

extern "C" void rg_log(int chip, int addr, int data, double clk) {
  if ((int)L.size() >= MAXLOG) return;
  L.push_back((rg_base + clk) / rg_rate); L.push_back(chip); L.push_back(addr); L.push_back(data);
}
// SPC: escrita no DSP; no KEY ON, guarda o sample BRR que a voz vai tocar (do jeito que está na RAM agora)
extern "C" void rg_spc_write(const unsigned char* ram, const void* dspv, double clk, int reg, int data) {
  const Spc_Dsp* dsp = (const Spc_Dsp*) dspv;
  rg_log(9, reg, data, clk);
  if (reg != 0x4C || !data) return;
  int dir = dsp->read(0x5D) * 0x100;
  for (int v = 0; v < 8; v++) {
    if (!(data & (1 << v))) continue;
    int srcn = dsp->read(v * 16 + 4), e = (dir + srcn * 4) & 0xFFFF;
    int start = ram[e] | (ram[(e + 1) & 0xFFFF] << 8), loop = ram[(e + 2) & 0xFFFF] | (ram[(e + 3) & 0xFFFF] << 8);
    int len = 0; uint32_t h = 2166136261u;
    while (len < 0x10000) {
      int hb = ram[(start + len) & 0xFFFF];
      for (int k = 0; k < 9; k++) h = (h ^ ram[(start + len + k) & 0xFFFF]) * 16777619u;
      len += 9;
      if (hb & 1) break;
    }
    int id = -1;
    for (int k = (int)SMPS.size() - 1; k >= 0; k--) if (SMPS[k].start == start && SMPS[k].len == len && SMPS[k].hash == h) { id = k; break; }
    if (id < 0) {
      Smp s; s.start = start; s.len = len; s.hash = h; s.blobOff = (int)BLOB.size();
      for (int k = 0; k < len; k++) BLOB.push_back(ram[(start + k) & 0xFFFF]);
      SMPS.push_back(s); id = (int)SMPS.size() - 1;
      rg_log(11, id, s.blobOff, clk); rg_log(12, len, (loop - start) & 0xFFFF, clk);
    }
    rg_log(10, v, id, clk);
  }
}
// bytes avulsos (sample do DPCM): vão para o BLOB; o registro diz onde estão
extern "C" void rg_bytes(int chip, int addr, int len, const unsigned char* p, double clk) {
  if ((int)BLOB.size() + len > 64 * 1024 * 1024) return;
  rg_log(chip, addr, (int)BLOB.size(), clk); rg_log(chip + 1, len, 0, clk);
  for (int k = 0; k < len; k++) BLOB.push_back(p[k]);
}
extern "C" void rg_spc_dump(const void* dspv) {
  const Spc_Dsp* dsp = (const Spc_Dsp*) dspv;
  for (int r = 0; r < 128; r++) if (r != 0x4C && r != 0x5C) rg_log(9, r, dsp->read(r), 0);
}

// ── PSF (PlayStation): registradores do SPU; no KEY ON, guarda o sample ADPCM da voz (do jeito que está na RAM do SPU) ──
extern "C" { double rg_spu_samples = 0; }
static uint16_t PSXR[256];
static PSX_STATE* PSX = 0;
static std::vector<short> AUD; static int KEEPAUD = 0;
extern "C" void rg_psx_spu(const unsigned char* ram, uint32_t a, uint16_t d) {
  double t = rg_spu_samples / 44100.0;
  rg_log(30, a, d, t);
  PSXR[(a >> 1) & 255] = d;
  if ((a != 0x188 && a != 0x18A) || !d) return;
  for (int bit = 0; bit < 16; bit++) {
    if (!(d & (1 << bit))) continue;
    int v = bit + (a == 0x18A ? 16 : 0); if (v >= 24) continue;
    int start = PSXR[(v * 16 + 6) >> 1] * 8, len = 0, loop = -1; uint32_t h = 2166136261u; bool rep = false;
    while (len < 0x80000) {
      int fl = ram[(start + len + 1) & 0x7FFFF];
      if (fl & 4) loop = len;
      for (int k = 0; k < 16; k++) h = (h ^ ram[(start + len + k) & 0x7FFFF]) * 16777619u;
      len += 16;
      if (fl & 1) { rep = (fl & 2) != 0; break; }
    }
    if (rep && loop < 0) { int lsa = PSXR[(v * 16 + 0xE) >> 1] * 8 - start; if (lsa >= 0 && lsa < len) loop = lsa; }
    if (!rep) loop = -1;
    int id = -1;
    for (int k = (int)SMPS.size() - 1; k >= 0; k--) if (SMPS[k].start == start && SMPS[k].len == len && SMPS[k].hash == h) { id = k; break; }
    if (id < 0) {
      Smp sm; sm.start = start; sm.len = len; sm.hash = h; sm.blobOff = (int)BLOB.size();
      for (int k = 0; k < len; k++) BLOB.push_back(ram[(start + k) & 0x7FFFF]);
      SMPS.push_back(sm); id = (int)SMPS.size() - 1;
      rg_log(32, id, sm.blobOff, t); rg_log(33, len, loop, t);
    }
    rg_log(31, v, id, t);
  }
}

extern "C" void rg_aud_push(const short* p, int n) { AUD.insert(AUD.end(), p, p + n); }
extern "C" int gsf_run(unsigned char* img, int size, unsigned entry, double seconds, int keep);
extern "C" {
EMSCRIPTEN_KEEPALIVE void rip_keep_audio(int k) { KEEPAUD = k; }
// GSF (Game Boy Advance): imagem da ROM (ou da RAM, em multiboot) montada pelo JavaScript
EMSCRIPTEN_KEEPALIVE int gba_run(unsigned char* img, int size, unsigned entry, double seconds) {
  L.clear(); BLOB.clear(); SMPS.clear(); AUD.clear();
  if (gsf_run(img, size, entry, seconds, KEEPAUD) < 0) return -1;
  return (int)L.size() / 4;
}
EMSCRIPTEN_KEEPALIVE int rip_audio_size() { return (int)AUD.size(); }
// 2SF (Nintendo DS): ROM e estado salvo montados pelo JavaScript (seções do PSF); roda o DS e grava o SPU
EMSCRIPTEN_KEEPALIVE int nds_run(unsigned char* rom, int romSize, unsigned char* save, int saveSize, int frames, int clockdown, int a7, int a9, int sync, double seconds) {
  L.clear(); BLOB.clear(); SMPS.clear(); rg_base = 0; rg_rate = 44100; rg_nds_reset();
  static NDS_state core; memset(&core, 0, sizeof core);
  if (state_init(&core)) return -1;
  core.dwInterpolation = 0; core.dwChannelMute = 0;
  core.initial_frames = frames; core.sync_type = sync;
  core.arm7_clockdown_level = a7 ? a7 : clockdown; core.arm9_clockdown_level = a9 ? a9 : clockdown;
  if (rom && romSize) state_setrom(&core, rom, romSize, 0);
  state_loadstate(&core, save, saveSize);
  static s16 buf[256]; long total = (long)(seconds * 44100);
  AUD.clear();
  for (long done = 0; done < total; done += 64) { rg_base = done; state_render(&core, buf, 64); if (KEEPAUD) AUD.insert(AUD.end(), buf, buf + 128); }
  state_deinit(&core);
  return (int)L.size() / 4;
}
EMSCRIPTEN_KEEPALIVE int psf_begin() { if (PSX) free(PSX); PSX = (PSX_STATE*) calloc(1, psx_get_state_size(1)); return PSX ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int psf_section(const unsigned char* b, int len, int first) { return PSX && psf_load_section(PSX, b, len, first) == 0 ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int psf_run(double seconds) {
  L.clear(); BLOB.clear(); SMPS.clear(); rg_base = 0; rg_rate = 1; rg_spu_samples = 0; memset(PSXR, 0, sizeof PSXR);
  if (!PSX || psf_start(PSX) != 1) return -1;
  static int16_t buf[4096]; long total = (long)(seconds * 44100);
  AUD.clear();
  for (long done = 0; done < total; done += 1024) { if (psf_gen(PSX, buf, 1024) < 0) break; if (KEEPAUD) AUD.insert(AUD.end(), buf, buf + 2048); }
  return (int)L.size() / 4;
}
EMSCRIPTEN_KEEPALIVE int rip_open(const unsigned char* data, int size) {
  if (EMU) { gme_delete(EMU); EMU = 0; }
  if (gme_open_data(data, size, &EMU, 44100)) return -1;
  return gme_track_count(EMU);
}
EMSCRIPTEN_KEEPALIVE int rip_len(int track) {   // duração (ms) que o arquivo informa; -1 se não informa
  gme_info_t* info; if (gme_track_info(EMU, &info, track)) return -1;
  int r = info->length > 0 ? info->length : (info->loop_length > 0 ? info->intro_length + info->loop_length * 2 : -1);
  gme_free_info(info); return r;
}
EMSCRIPTEN_KEEPALIVE const char* rip_str(int track, int which) {
  static char buf[512]; buf[0] = 0;
  gme_info_t* info; if (gme_track_info(EMU, &info, track)) return buf;
  const char* s = which == 0 ? info->song : which == 1 ? info->game : which == 2 ? info->author : which == 3 ? info->system : info->copyright;
  strncpy(buf, s ? s : "", 511); buf[511] = 0; gme_free_info(info); return buf;
}
EMSCRIPTEN_KEEPALIVE int rip_run(int track, double seconds) {
  L.clear(); BLOB.clear(); SMPS.clear(); rg_base = 0; rg_rate = 1;
  if (!EMU) return -1;
  gme_ignore_silence(EMU, 1);
  gme_set_autoload_playback_limit(EMU, 0);
  if (gme_start_track(EMU, track)) return -2;
  L.clear(); BLOB.clear(); SMPS.clear(); rg_base = 0;   // o que tocou na partida (antes do tempo 0) não conta
  static short buf[4096];
  long total = (long)(seconds * 44100);
  for (long done = 0; done < total; done += 2048) gme_play(EMU, 4096, buf);
  return (int)L.size() / 4;
}
// áudio do próprio game-music-emu (para conferir a conversão)
EMSCRIPTEN_KEEPALIVE int rip_render(int track, double seconds) {
  AUD.clear(); if (!EMU) return -1;
  gme_ignore_silence(EMU, 1); gme_set_autoload_playback_limit(EMU, 0);
  if (gme_start_track(EMU, track)) return -2;
  static short buf[4096]; long total = (long)(seconds * 44100);
  for (long done = 0; done < total; done += 2048) { gme_play(EMU, 4096, buf); AUD.insert(AUD.end(), buf, buf + 4096); }
  return (int)AUD.size();
}
EMSCRIPTEN_KEEPALIVE short* rip_audio() { return AUD.data(); }
EMSCRIPTEN_KEEPALIVE double* rip_log() { return L.data(); }
EMSCRIPTEN_KEEPALIVE uint8_t* rip_blob() { return BLOB.data(); }
EMSCRIPTEN_KEEPALIVE int rip_blob_size() { return (int)BLOB.size(); }
}
