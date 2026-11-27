// RG (Furnace): troca o chip OPNA do BambooTracker por um que só guarda as escritas nos registradores.
// O som sai do YM2608 do próprio Furnace (rgbt.cpp manda essas escritas para ele). A memória do ADPCM
// (escrita pelo registrador 0x108) fica aqui e vira a memória do ADPCM-B do Furnace.
#pragma once

#include <cstdint>
#include <cstddef>
#include <memory>
#include <vector>

struct RealChipInterfaceGeneratorFunc
{
	using FuncPtr = void (*)();
	RealChipInterfaceGeneratorFunc(FuncPtr fp) : fp_(fp) {}
	FuncPtr operator()() const { return fp_; }
private:
	FuncPtr fp_;
};

enum class RealChipInterfaceType : int
{
	NONE = 0,
	SCCI = 1,
	C86CTL = 2
};

namespace chip
{
enum class OpnaEmulator
{
	Mame,
	Nuked,
	Ymfm,
	First = Mame,
	Last = Ymfm,
};

enum class ResamplerType : int
{
	Linear = 0,
	BlipBuf,
	FastBlipBuf,
};

class AbstractResampler
{
public:
	virtual ~AbstractResampler() = default;
};

class BlipResampler : public AbstractResampler
{
public:
	explicit BlipResampler(bool fast = false) { (void)fast; }
};

class LinearResampler : public AbstractResampler
{
};

class AbstractRegisterWriteLogger
{
public:
	virtual ~AbstractRegisterWriteLogger() = default;
	virtual void recordRegisterChange(uint32_t offset, uint8_t value) = 0;
};

struct RegWrite
{
	uint16_t addr;
	uint8_t val;
};

class OPNA
{
public:
	OPNA(OpnaEmulator emu, int clock, int rate, size_t maxDuration, size_t dramSize,
		 std::unique_ptr<AbstractResampler> fmResampler = nullptr,
		 std::unique_ptr<AbstractResampler> ssgResampler = nullptr,
		 std::shared_ptr<AbstractRegisterWriteLogger> logger = nullptr);

	void reset();
	void setImmediateWriteMode(bool enabled) noexcept { immediate_ = enabled; }
	bool isImmediateWriteMode() const noexcept { return immediate_; }
	void setForcedWriteMode(bool enabled) noexcept { (void)enabled; }
	void setRegister(uint32_t offset, uint8_t value);
	uint8_t getRegister(uint32_t offset) const { return regs_[offset & 0x1ff]; }
	void setVolumeFM(double dB) { volumeFm_ = dB; }
	double getVolumeFM() const noexcept { return volumeFm_; }
	void setVolumeSSG(double dB) { volumeSsg_ = dB; }
	double getVolumeSSG() const noexcept { return volumeSsg_; }
	size_t getDRAMSize() const noexcept { return dram_.size(); }
	void setMasterVolume(int percentage) { masterVolume_ = percentage; }
	bool mix(int16_t* stream, size_t nSamples);
	void setRate(int rate) { rate_ = rate; }
	int getRate() const noexcept { return rate_; }
	void setMaxDuration(size_t duration) { duration_ = duration; }
	size_t getMaxDuration() const noexcept { return duration_; }
	void setFmResampler(std::unique_ptr<AbstractResampler> resampler) { (void)resampler; }
	void setSsgResampler(std::unique_ptr<AbstractResampler> resampler) { (void)resampler; }
	void setRegisterWriteLogger(std::shared_ptr<AbstractRegisterWriteLogger> logger = nullptr) { logger_ = logger; }
	void connectToRealChip(RealChipInterfaceType type, RealChipInterfaceGeneratorFunc* f) { (void)type; if (f) delete f; }
	RealChipInterfaceType getRealChipInterfaceType() const { return RealChipInterfaceType::NONE; }
	bool hasConnectedToRealChip() const { return false; }

	// RG: escritas desde a última vez (memória do ADPCM fora)
	std::vector<RegWrite> writes;
	// memória do ADPCM (DRAM de 256 KiB)
	std::vector<uint8_t> dram_;
	bool dramChanged = false;

private:
	bool immediate_ = false;
	double volumeFm_ = 0, volumeSsg_ = 0;
	int masterVolume_ = 100;
	int rate_;
	size_t duration_;
	uint8_t regs_[0x200] = {};
	size_t memPtr_ = 0;
	std::shared_ptr<AbstractRegisterWriteLogger> logger_;
};
}
