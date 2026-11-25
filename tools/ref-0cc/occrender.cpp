// occrender: toca um módulo com o player do próprio 0CC (o mesmo do editor) e registra as escritas nos chips
// saída: linhas "tempo chip registrador(hex) valor" (chip 1 = 2A03, 2 = expansões), um quadro a cada 1/taxa s
#include "FamiTrackerModule.h"
#include "FamiTrackerEnv.h"
#include "SoundChipService.h"
#include "SoundDriver.h"
#include "TempoCounter.h"
#include "PlayerCursor.h"
#include "SongData.h"
#include "ChannelOrder.h"
#include "APU/APUInterface.h"
#include "FamiTrackerDocIO.h"
#include "DocumentFile.h"
#include "ModuleException.h"
#include "SoundGenBase.h"
#include "InstrumentManager.h"
#include <iostream>
#include <cstdio>
class CLogAPU : public CAPUInterface {
public:
	FILE *out = nullptr; double t = 0; int n = 0;
	CSoundChip *GetSoundChip(sound_chip_t) const override { return nullptr; }
	void Write(uint16_t a, uint8_t v) override {
		int chip = (a >= 0x4000 && a <= 0x4017) ? 1 : 2;
		fprintf(out, "%.6f %d %x %d\n", t + (n++) * 1e-6, chip, a, v);
	}
};
// "SoundGen" mínimo: o player só precisa dos instrumentos do módulo
class CRgGen : public CSoundGenBase {
public:
	CFamiTrackerModule *mod = nullptr;
	CInstrumentManager *GetInstrumentManager() const override { return mod->GetInstrumentManager(); }
	void OnTick() override { }
	void OnStepRow() override { }
	void OnPlayNote(stChannelID, const stChanNote &) override { }
	void OnUpdateRow(int, int) override { }
	bool IsChannelMuted(stChannelID) const override { return false; }
	bool ShouldStopPlayer() const override { return false; }
	int GetArpNote(stChannelID) const override { return -1; }
};
int main(int argc, char **argv) try {
	if (argc < 4) { std::cerr << "uso: occrender entrada.ftm saida.log segundos [faixa]\n"; return 1; }
	CFamiTrackerModule modfile;
	CDocumentFile in;
	in.Open(argv[1], std::ios::in | std::ios::binary);
	in.ValidateFile();
	if (!CFamiTrackerDocIO {in, module_error_level_t::MODULE_ERROR_DEFAULT}.Load(modfile)) { std::cerr << "falha ao carregar\n"; return 2; }
	int track = argc > 4 ? atoi(argv[4]) : 0;
	CLogAPU apu; apu.out = fopen(argv[2], "w");
	CRgGen gen; gen.mod = &modfile;
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
	std::cerr << "canais " << modfile.GetChannelOrder().GetChannelCount() << ", tocando " << drv.IsPlaying() << "\n";
	double rate = modfile.GetFrameRate();
	int frames = (int)(atof(argv[3]) * rate);
	std::cerr << "taxa " << rate << " Hz, " << frames << " quadros\n";
	for (int f = 0; f < frames; f++) {
		apu.t = f / rate; apu.n = 0;
		drv.Tick();
	}
	fclose(apu.out);
	return 0;
}
catch (CModuleException &e) { std::cerr << "erro no módulo: " << e.GetErrorString() << '\n'; return 3; }
catch (std::exception &e) { std::cerr << "exceção: " << e.what() << '\n'; return 1; }
