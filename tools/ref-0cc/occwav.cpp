// occwav: toca um módulo com o player e o emulador de som do próprio 0CC e grava WAV (mono, 16 bits)
// uso: occwav entrada.ftm saida.wav segundos [faixa]
// OCC_SOLO=0..6 (APU, VRC6, VRC7, FDS, MMC5, N163, S5B) toca só um chip; OCC_LENIENT=1 relaxa a validação
#include "FamiTrackerModule.h"
#include "FamiTrackerEnv.h"
#include "SoundChipService.h"
#include "SoundDriver.h"
#include "TempoCounter.h"
#include "PlayerCursor.h"
#include "SongData.h"
#include "ChannelOrder.h"
#include "APU/APU.h"
#include "APU/Types.h"
#include "Common.h"
#include "FamiTrackerDocIO.h"
#include "DocumentFile.h"
#include "ModuleException.h"
#include "SoundGenBase.h"
#include "InstrumentManager.h"
#include <iostream>
#include <cstdio>
#include <vector>
class CSink : public IAudioCallback {
public:
	std::vector<int16_t> out;
	void FlushBuffer(array_view<int16_t> b) override { out.insert(out.end(), b.begin(), b.end()); }
	bool PlayBuffer() override { return true; }
};
class CRgGen : public CSoundGenBase {
public:
	CFamiTrackerModule *mod = nullptr; int solo = -1;
	CInstrumentManager *GetInstrumentManager() const override { return mod->GetInstrumentManager(); }
	void OnTick() override { }
	void OnStepRow() override { }
	void OnPlayNote(stChannelID, const stChanNote &) override { }
	void OnUpdateRow(int, int) override { }
	bool IsChannelMuted(stChannelID id) const override { if (solo >= 0 && (int)value_cast(id.Chip) != solo) return true; const char *s = getenv("OCC_SUB"); return s && (int)id.Subindex != atoi(s); }
	bool ShouldStopPlayer() const override { return false; }
	int GetArpNote(stChannelID) const override { return -1; }
};
static void wavOut(const char *fn, const std::vector<int16_t> &d, int rate) {
	FILE *f = fopen(fn, "wb"); uint32_t n = d.size() * 2, v;
	fwrite("RIFF", 1, 4, f); v = 36 + n; fwrite(&v, 4, 1, f); fwrite("WAVEfmt ", 1, 8, f);
	v = 16; fwrite(&v, 4, 1, f); uint16_t s = 1; fwrite(&s, 2, 1, f); s = 1; fwrite(&s, 2, 1, f);
	v = rate; fwrite(&v, 4, 1, f); v = rate * 2; fwrite(&v, 4, 1, f); s = 2; fwrite(&s, 2, 1, f); s = 16; fwrite(&s, 2, 1, f);
	fwrite("data", 1, 4, f); fwrite(&n, 4, 1, f); fwrite(d.data(), 2, d.size(), f); fclose(f);
}
int main(int argc, char **argv) try {
	if (argc < 4) { std::cerr << "uso: occwav entrada.ftm saida.wav segundos [faixa]\n"; return 1; }
	CFamiTrackerModule modfile;
	CDocumentFile in;
	in.Open(argv[1], std::ios::in | std::ios::binary);
	in.ValidateFile();
	if (!CFamiTrackerDocIO {in, getenv("OCC_LENIENT") ? module_error_level_t::MODULE_ERROR_NONE : module_error_level_t::MODULE_ERROR_DEFAULT}.Load(modfile)) { std::cerr << "falha ao carregar\n"; return 2; }
	int track = argc > 4 ? atoi(argv[4]) : 0;
	const int RATE = 44100;
	CSink sink;
	CAPU apu(&sink);
	machine_t mach = modfile.GetMachine();
	apu.SetExternalSound(modfile.GetSoundChipSet());
	if (!apu.SetupSound(RATE, 1, mach)) { std::cerr << "SetupSound falhou\n"; return 4; }
	for (int i = 0; i < 8; i++) apu.SetChipLevel((chip_level_t)i, 0.0f);
	apu.SetupMixer(30, 12000, 24, 100);
	int frameRate = modfile.GetFrameRate();
	apu.ChangeMachineRate(mach, frameRate);
	apu.Reset();
	apu.Write(0x4015, 0x0F); apu.Write(0x4017, 0x00); apu.Write(0x4023, 0x02); apu.Write(0x5015, 0x03);
	CRgGen gen; gen.mod = &modfile; gen.solo = getenv("OCC_SOLO") ? atoi(getenv("OCC_SOLO")) : -1;
	CSoundDriver drv(&gen);
	drv.SetupTracks();
	drv.AssignModule(modfile);
	drv.LoadAPU(apu);
	auto tempo = std::make_shared<CTempoCounter>(modfile);
	drv.SetTempoCounter(tempo);
	drv.ConfigureDocument();
	drv.ResetTracks();
	tempo->LoadTempo(*modfile.GetSong(track));
	drv.StartPlayer(std::make_unique<CPlayerCursor>(*modfile.GetSong(track), track));
	int cyc = (int)((mach == machine_t::NTSC ? MASTER_CLOCK_NTSC : MASTER_CLOCK_PAL) / frameRate);
	int frames = (int)(atof(argv[3]) * frameRate);
	// OCC_REGTEST=1: em vez da música, 1 s de pulso v15, 1 s de triângulo, 1 s de ruído v15 (para medir os níveis do mixer)
	if (getenv("OCC_REGTEST")) {
		auto W = [&] (int a, int v) { apu.Write(a, v); };
		W(0x4015, 0x0F); W(0x4017, 0x40);
		for (int f = 0; f < frameRate * 3; f++) {
			int sec = f / (int)frameRate;
			if (f % (int)frameRate == 0) {
				W(0x4000, 0x30); W(0x4008, 0x00); W(0x400C, 0x30);
				if (sec == 0) { W(0x4000, 0xBF); W(0x4001, 0x08); W(0x4002, 0xFD); W(0x4003, 0x00); }
				if (sec == 1) { W(0x4008, 0xFF); W(0x400A, 0xFD); W(0x400B, 0x00); }
				if (sec == 2) { W(0x400C, 0x3F); W(0x400E, 0x04); W(0x400F, 0x00); }
			}
			apu.AddTime(cyc); apu.Process(); apu.EndFrame();
		}
		frames = 0;
	}
	for (int f = 0; f < frames; f++) {
		drv.Tick();
		// como CSoundGen::UpdateAPU: distribui o tempo do quadro entre os canais
		int cycles = cyc; sound_chip_t last = sound_chip_t::none;
		drv.ForeachTrack([&] (CChannelHandler &, CTrackerChannel &, stChannelID ID) {
			if (modfile.GetChannelOrder().HasChannel(ID)) {
				int Delay = (ID.Chip == last) ? 150 : 250;
				if (Delay < cycles) { cycles -= Delay; apu.AddTime(Delay); }
				last = ID.Chip;
			}
			apu.Process();
		});
		apu.AddTime(cycles); apu.Process(); apu.EndFrame();
	}
	wavOut(argv[2], sink.out, RATE);
	std::cerr << sink.out.size() / (double)RATE << " s\n";
	return 0;
}
catch (CModuleException &e) { std::cerr << "erro no módulo: " << e.GetErrorString() << '\n'; return 3; }
catch (std::exception &e) { std::cerr << "exceção: " << e.what() << '\n'; return 1; }
