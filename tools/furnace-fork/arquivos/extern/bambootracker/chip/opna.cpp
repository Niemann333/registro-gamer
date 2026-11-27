// RG (Furnace): OPNA de mentira (ver opna.hpp)
#include "opna.hpp"
#include <cstring>

namespace chip
{
OPNA::OPNA(OpnaEmulator emu, int clock, int rate, size_t maxDuration, size_t dramSize,
		   std::unique_ptr<AbstractResampler> fmResampler, std::unique_ptr<AbstractResampler> ssgResampler,
		   std::shared_ptr<AbstractRegisterWriteLogger> logger)
	: dram_(dramSize, 0), rate_(rate), duration_(maxDuration), logger_(logger)
{
	(void)emu; (void)clock; (void)fmResampler; (void)ssgResampler;
}

void OPNA::reset()
{
	memset(regs_, 0, sizeof(regs_));
	memPtr_ = 0;
	// o chip do BambooTracker é zerado no reset; aqui só fica marcado para o Furnace
	writes.push_back({ 0xffff, 0 });
}

void OPNA::setRegister(uint32_t offset, uint8_t value)
{
	offset &= 0x1ff;
	if (logger_) logger_->recordRegisterChange(offset, value);
	// gravação na memória do ADPCM: 0x100 com os bits de gravação/memória, dados em 0x108
	if (offset == 0x108 && (regs_[0x100] & 0x60) == 0x60) {
		if (memPtr_ < dram_.size()) dram_[memPtr_++] = value;
		dramChanged = true;
		return;
	}
	regs_[offset] = value;
	if (offset == 0x102 || offset == 0x103) {
		memPtr_ = (static_cast<size_t>(regs_[0x103]) << 8 | regs_[0x102]) << 5;
	}
	writes.push_back({ static_cast<uint16_t>(offset), value });
}

bool OPNA::mix(int16_t* stream, size_t nSamples)
{
	memset(stream, 0, nSamples * 2 * sizeof(int16_t));
	return true;
}
}
