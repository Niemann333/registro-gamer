// occnsf: abre um módulo do FamiTracker/0CC e exporta NSF (ou NSFE) com o compilador do próprio 0CC
#include "FamiTrackerModule.h"
#include "FamiTrackerEnv.h"
#include "SoundChipService.h"
#include "Compiler.h"
#include "SimpleFile.h"
#include "FamiTrackerDocIO.h"
#include "DocumentFile.h"
#include "ModuleException.h"
#include <iostream>
class CStdoutLog : public CCompilerLog {
public:
	void WriteLog(std::string_view text) override { std::cerr << text; }
	void Clear() override { }
};
int main(int argc, char **argv) try {
	if (argc < 3) { std::cerr << "uso: occnsf entrada.ftm saida.nsf [pal] [nsfe]\n"; return 1; }
	CFamiTrackerModule modfile;
	CDocumentFile in;
	in.Open(argv[1], std::ios::in | std::ios::binary);
	in.ValidateFile();
	std::cerr << "versão do arquivo: " << std::hex << in.GetFileVersion() << std::dec << "\n";
	if (!CFamiTrackerDocIO {in, module_error_level_t::MODULE_ERROR_DEFAULT}.Load(modfile)) { std::cerr << "falha ao carregar\n"; return 2; }
	int machine = argc > 3 ? atoi(argv[3]) : 0;
	bool nsfe = argc > 4 && atoi(argv[4]);
	CSimpleFile out(argv[2], std::ios::out | std::ios::binary);
	CCompiler compiler(modfile, std::make_unique<CStdoutLog>());
	if (nsfe) compiler.ExportNSFE(out, machine); else compiler.ExportNSF(out, machine);
	out.Close();
	return 0;
}
catch (CModuleException &e) { std::cerr << "erro no módulo: " << e.GetErrorString() << '\n'; return 3; }
catch (std::exception &e) { std::cerr << "exceção: " << e.what() << '\n'; return 1; }
