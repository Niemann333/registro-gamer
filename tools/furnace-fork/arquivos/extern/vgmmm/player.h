// Playback engine: turns pattern data into YM2612 / SN76489 register writes, one tick at a time.
#pragma once
#include <cstdint>

#include "song.h"

struct PlayerChannel {
    int ins;                // current instrument (1-based), -1 = unset
    int vol;                // 0..0xf8 (pattern volume * 8)
    int tl[4];              // operator total levels before channel volume is applied
    int alg;
    int arpPhase;
    int pitch;              // 1/32 semitone units
    int portaTarget;
    int vibOffset;
    int arpOffset;
    int reserved;
    int vibPhase;
    int fx[4];              // effect types of the current row
    int arpParam;           // 0xff = off
    int portaUp;
    int portaDown;
    int tonePorta;
    int vibParam;
    int volSlide;
    int cutTick;
    int delayTick;
    int retrig;
    int pan;
    uint8_t reloadIns;
    uint8_t volDirty;
    uint8_t freqDirty;
    uint8_t pad;
    int psgPeriod;          // NB: indexed by PSG channel 0..3, stored in the first four entries
    int psgVol;
};

struct Player {
    int speedEven, speedOdd, interleave;
    int tick, order, pattern, row;
    int interleaveCount, oddFlag;
    PlayerChannel ch[CHANNELS];
    uint8_t ch3Special;     // FM channel 3 per-operator frequency mode
    int ch3Offset[3];
    uint8_t singleRow;      // play one row, then stop
    uint8_t loopPattern;    // stay in the current pattern
    uint8_t autoStop;
    int saveEven, saveOdd, saveInterleave, saveOddFlag, saveInterleaveCount, loopRow, loopOrder;
    int loopCount;
    uint8_t loopJump;
    int pendingIns;         // instrument edited in the UI whose registers must be refreshed
    int solo;               // only key this channel (-1 = all)
    int dacSample, dacPos;
    uint8_t dacLog;         // log DAC starts as VGM 1.60 stream commands
    int dacRetrig, dacCut, dacDelay, dacPending;
    uint8_t ggStereo, ggStereoSent;
    uint8_t noiseMode;
    uint8_t playing;
};

// Queue of register writes produced by one tick.
enum { REG_FM0 = 0, REG_FM1 = 1, REG_PSG = 2, REG_GG_STEREO = 3, REGQ_MAX = 0xffff };
struct RegWrite {
    uint8_t type, reg, val;
};
extern RegWrite g_regq[REGQ_MAX];
extern int g_regqCount;
extern int g_regqRead;

// Software ADSR used for the PSG channels (index 4 drives the second PSG for instrument preview).
struct PsgEnv {
    int state;              // 0 attack, 1 decay, 2 sustain, 3 release
    float attack, decay, sustain, release;
    float scale;
    float sustainLevel;
    float level;
    uint8_t lastOut;
};
extern PsgEnv g_psgEnv[5];
extern float g_psgRateTab[32];

extern Player g_player;
extern int g_fnumTab[12 * 32];          // FM F-numbers, 32 steps per semitone
extern int g_psgPeriodTab[8 * 12 * 32]; // PSG tone periods
extern int g_vibTab[16 * 32];           // vibrato offsets by depth
extern volatile uint8_t g_rendering;    // set while the audio thread is inside audio_render

void tables_init(void);
void regq_push(uint8_t type, uint8_t reg, uint8_t val);
void fm_write(int ch, int reg, int val);
void fm_key(int ch, int v);
void fm_set_volume(int ch);
void psg_queue_volume(unsigned ch, uint8_t vol);
void psg_env_init(void);
void psg_env_tick(void);

void player_channels_reset(void);
void player_seek_state(int order, int row);
void player_start(int order, int row, uint8_t singleRow, uint8_t loopPattern, uint8_t autoStop, int solo);
void player_stop(void);
bool player_auto_stop(void);
bool player_is_playing(void);
void player_set_position(int order);
void player_refresh_instrument(int ins);
int player_tick(bool exporting);        // returns 1 when the loop position is reached

void dac_set_log_mode(uint8_t on);
void dac_start(int sample);
void dac_stop(void);
void dac_tick_emul(void);

// ---- chips.cpp
bool chips_init(int fmClock, int psgClock, unsigned rate);
void chips_shutdown(void);
void chips_reset(void);
void chips_set_mute(unsigned mask);
void chips_render_mode(bool rendering, bool allChannels);
void chips_set_balance(int fm, int psg);
void chips_ym_write(int port, uint8_t v);           // main YM2612, a = 0..3
void chips_psg_write(uint8_t v);                    // main SN76489
void chips_psg_stereo(uint8_t v);                   // Game Gear stereo register
void chips_ym2_write(int port, uint8_t v);          // preview YM2612
void chips_psg2_write(uint8_t v);                   // preview PSG
void chips_psg2_set_mute(int mask);
unsigned chips_get_mute(void);
void chips_flush_queue(int16_t *out, int frames);   // send queued writes to the chips, then render
void audio_render(int16_t *out, int frames);        // runs the player and renders stereo frames
float chips_fm_level(int ch);
float chips_psg_level(int ch);
const char *chips_about_fm(void);
const char *chips_about_psg(void);
extern unsigned g_outputRate;
extern int g_frameCounter;
extern uint8_t g_clipped;
extern uint8_t g_testSignal;
extern int g_outputVolume, g_fmVolume;

// ---- vgmexport.cpp (the DAC logger writes into the VGM being built)
void vgm_put(uint8_t b);
void vgm_put32(uint32_t v);
extern int g_vgmSampleOffset[MAX_SAMPLES];
extern int g_vgmSampleLen[MAX_SAMPLES];
