// dnwav: toca um log de escritas de registrador ("tempo chip endereço valor", do occrender) no áudio do
// Dn-FamiTracker 0.5.3 (APU, mixer, NSFPlay 2A03, Mesen FDS/N163, emu2413 1.5) e grava um WAV mono 44100 Hz.
// uso: dnwav log.txt saida.wav taxa_hz expansoes [segundos]
//   DN_SOLO=chip  (0 2A03, 1 VRC6, 2 VRC7, 3 FDS, 4 MMC5, 5 N163, 6 S5B) só deixa passar as escritas desse chip
//   DN_VRC7PATCH=n (0 Nuke padrão), DN_SURVEY=1 mixagem por hardware
#include "stdafx.h"
#include "APU/APU.h"
#include "APU/Types.h"
#include <cstdlib>
#include <fstream>
#include <sstream>
struct Sink : IAudioCallback {
  std::vector<int16_t> out;
  void FlushBuffer(int16_t const *b, uint32_t n) override { out.insert(out.end(), b, b + n); }
};
static int chipOf(int a) {
  if (a >= 0x4000 && a <= 0x4017) return 0;
  if (a >= 0x4040 && a <= 0x409f) return 3;
  if (a == 0x9010 || a == 0x9030) return 2;
  if (a >= 0x9000 && a <= 0xb002) return 1;
  if (a >= 0x5000 && a <= 0x5015) return 4;
  if (a == 0x4800 || a == 0xf800) return 5;
  if (a == 0xc000 || a == 0xe000) return 6;
  return -1;
}
int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "uso: dnwav log saida.wav taxa expansoes [segundos]\n"); return 1; }
  double rate = atof(argv[3]); int exp = atoi(argv[4]); double secs = argc > 5 ? atof(argv[5]) : 1e9;
  int solo = getenv("DN_SOLO") ? atoi(getenv("DN_SOLO")) : -1;
  Sink sink; CAPU apu(&sink);
  apu.SetupSound(44100, 1, MACHINE_NTSC);
  apu.ChangeMachineRate(MACHINE_NTSC, (int)rate);
  {
    CAPUConfig c(&apu);
    c.SetExternalSound((uint8_t)exp);
    int patch = getenv("DN_VRC7PATCH") ? atoi(getenv("DN_VRC7PATCH")) : 0;
    std::vector<uint8_t> pb(CAPU::OPLL_DEFAULT_PATCHES[patch], CAPU::OPLL_DEFAULT_PATCHES[patch] + 19 * 8);
    std::vector<std::string> pn(CAPU::OPLL_PATCHNAME_VRC7, CAPU::OPLL_PATCHNAME_VRC7 + 19);
    c.SetupEmulation(true, patch, false, pb, pn);
    bool survey = getenv("DN_SURVEY") != nullptr;
    c.SetupMixer(30, 12000, 24, 100, survey, 2000, 12000, std::vector<int16_t>(8, 0));
    for (int i = 0; i < CHIP_LEVEL_COUNT; i++) c.SetChipLevel((chip_level_t)i, 0.0f, survey);
  }
  apu.Reset();
  auto W = [&](int a, int v) { apu.Write((uint16_t)a, (uint8_t)v); };
  W(0x4015, 0x0F); W(0x4017, 0x00); W(0x4023, 0x02); W(0x4023, 0x83); W(0xE7FF, 0x00); W(0x5015, 0x03);
  // lê o log e agrupa por quadro
  std::ifstream in(argv[1]); std::string line;
  struct Wr { int f, a, v; }; std::vector<Wr> ws;
  while (std::getline(in, line)) {
    std::istringstream ss(line); double t; int chip; std::string as; int v;
    if (!(ss >> t >> chip >> as >> v)) continue;
    int a = (int)strtol(as.c_str(), nullptr, 16);
    int f = (int)(t * rate + 1e-6);
    if (f >= secs * rate) break;
    if (solo >= 0 && chipOf(a) != solo && chipOf(a) >= 0) {
      // no solo, as escritas de volume dos outros chips viram silêncio: simplesmente não são feitas
      continue;
    }
    // DN_KEEP=n: no 2A03 deixa só o canal n (0-4), silenciando os outros como o Furnace faz
    if (getenv("DN_KEEP") && a >= 0x4000 && a <= 0x4017) {
      int k = atoi(getenv("DN_KEEP"));
      if (a == 0x4000 && k != 0) v = (v & 0xc0) | 0x30;
      if (a == 0x4004 && k != 1) v = (v & 0xc0) | 0x30;
      if (a == 0x4008 && k != 2) v = 0;
      if (a == 0x400c && k != 3) v = (v & 0xc0) | 0x30;
      if (a == 0x4015 && k != 4) v &= ~0x10;
      if (a == 0x4011 && k != 4) continue;
    }
    ws.push_back({f, a, v});
  }
  int frameCycles = (int)(1789773 / rate);
  size_t p = 0; int lastFrame = ws.empty() ? 0 : ws.back().f;
  int nFrames = (int)std::min<double>(secs * rate, lastFrame + 1);
  for (int f = 0; f < nFrames; f++) {
    int used = 0, prev = -1;
    while (p < ws.size() && ws[p].f == f) {
      int c = chipOf(ws[p].a);
      if (c != prev && prev != -1) { int d = (c == prev) ? 150 : 250; if (used + d < frameCycles) { apu.AddCycles(d); apu.Process(); used += d; } }
      prev = c;
      W(ws[p].a, ws[p].v); p++;
    }
    apu.AddCycles(frameCycles - used); apu.Process();
  }
  FILE *o = fopen(argv[2], "wb"); uint32_t n = sink.out.size() * 2, v32; uint16_t v16;
  fwrite("RIFF", 1, 4, o); v32 = 36 + n; fwrite(&v32, 4, 1, o); fwrite("WAVEfmt ", 1, 8, o);
  v32 = 16; fwrite(&v32, 4, 1, o); v16 = 1; fwrite(&v16, 2, 1, o); fwrite(&v16, 2, 1, o);
  v32 = 44100; fwrite(&v32, 4, 1, o); v32 = 88200; fwrite(&v32, 4, 1, o); v16 = 2; fwrite(&v16, 2, 1, o); v16 = 16; fwrite(&v16, 2, 1, o);
  fwrite("data", 1, 4, o); fwrite(&n, 4, 1, o); fwrite(sink.out.data(), 2, sink.out.size(), o); fclose(o);
  fprintf(stderr, "%.2f s\n", sink.out.size() / 44100.0);
  return 0;
}
