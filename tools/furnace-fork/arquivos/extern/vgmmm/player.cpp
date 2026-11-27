// Playback engine (ported from the original player; effect numbering as in the editor):
//   00 arpeggio        01/02 portamento up/down   03 tone portamento   04 vibrato
//   05 porta+volslide  06 vibrato+volslide        08/09/0C/0D operator 1-4 level
//   0A volume slide    0B FM channel 3 special mode                    0E extended
//   0F speed           15 LFO    17 noise mode    19 panning    1A sample timing    1C play sample
//
// Floating-point expressions follow the original x87 code (extended intermediates, float stores).
#include <cmath>
#include <cstring>

#include "player.h"

typedef long double ld;

Player g_player;
RegWrite g_regq[REGQ_MAX];
int g_regqCount;
int g_regqRead;
PsgEnv g_psgEnv[5];
float g_psgRateTab[32];
int g_fnumTab[12 * 32];
int g_psgPeriodTab[8 * 12 * 32];
int g_vibTab[16 * 32];
volatile uint8_t g_rendering;

#define P g_player

// ---------------------------------------------------------------- tables

void tables_init(void)
{
    static const int fnum[14] = {645, 683, 724, 767, 812, 861, 912, 966, 1024, 1085, 1149, 1217, 1290, 1366};
    static const float psgFreq[14] = {2093.0f, 2217.46f, 2349.32f, 2489.02f, 2637.02f, 2793.83f, 2959.96f,
                                      3135.96f, 3322.44f, 3520.0f, 3729.31f, 3951.07f, 4186.01f, 4434.92f};
    int idx = 0;
    for (int n = 0; n < 12; n++) {
        float a = (float)fnum[n];
        float b = (float)fnum[n + 1];
        float step = (float)(((ld)b - (ld)a) * (ld)0.03125f);
        for (int i = 0; i < 32; i++) {
            g_fnumTab[idx++] = (int)(ld)a;
            a = (float)((ld)step + (ld)a);
        }
    }
    idx = 0;
    for (int oct = 0; oct < 8; oct++) {
        for (int n = 0; n < 12; n++) {
            float a = (float)((ld)psgFreq[n] * (ld)4.0f);
            float b = (float)((ld)psgFreq[n + 1] * (ld)4.0f);
            for (int k = 0; k < 7 - oct; k++) {
                a = (float)((ld)0.5f * (ld)a);
                b = (float)((ld)0.5f * (ld)b);
            }
            // the period table is always built for the default PSG clock
            a = (float)((ld)3546894 * (ld)0.0625f * (ld)0.5f / (ld)a);
            b = (float)((ld)3546894 * (ld)0.0625f * (ld)0.5f / (ld)b);
            float step = (float)(((ld)b - (ld)a) * (ld)0.03125f);
            for (int i = 0; i < 32; i++) {
                int v = (int)(ld)a;
                if (v < 0)
                    v = 0;
                if (v > 0x3ff)
                    v = 0x3ff;
                g_psgPeriodTab[idx++] = v;
                a = (float)((ld)step + (ld)a);
            }
        }
    }
    idx = 0;
    for (int depth = 0; depth < 16; depth++) {
        for (int i = 0; i < 32; i++) {
            double x = (double)((ld)i * (ld)0.19634954631328583f);
            float v = (float)(sinl((ld)x) * (ld)(depth * 2));
            g_vibTab[idx++] = (int)(ld)v;
        }
    }
}

// ---------------------------------------------------------------- register queue

void regq_push(uint8_t type, uint8_t reg, uint8_t val)
{
    if (g_regqCount < 0xfffd) {
        g_regq[g_regqCount].type = type;
        g_regq[g_regqCount].reg = reg;
        g_regq[g_regqCount].val = val;
        g_regqCount++;
    }
}

void fm_write(int ch, int reg, int val)
{
    if (ch < 3)
        regq_push(REG_FM0, (uint8_t)(reg + ch), (uint8_t)val);
    else
        regq_push(REG_FM1, (uint8_t)(reg + ch - 3), (uint8_t)val);
}

void fm_key(int ch, int v)
{
    static const uint8_t keyCh[8] = {0, 1, 2, 4, 5, 6, 0, 0};
    regq_push(REG_FM0, 0x28, (uint8_t)((v & 0xf0) | keyCh[ch & 7]));
}

void fm_set_volume(int ch)
{
    static const int volTab[32] = {0, 0, 88, 90, 91, 93, 95, 96, 97, 98, 100, 102, 104, 106, 107, 109,
                                   110, 112, 113, 114, 115, 116, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127};
    static const unsigned carrierMask[8] = {8, 8, 8, 8, 12, 14, 14, 15};
    PlayerChannel *c = &P.ch[ch];
    if (c->alg < 0)
        return;
    int v = volTab[(c->vol >> 3) & 0x1f];
    unsigned mask = carrierMask[c->alg & 7];
    int tl[4];
    for (int i = 0; i < 4; i++) {
        tl[i] = c->tl[i];
        if (mask & (1u << i))
            tl[i] = 0x7f - ((0x7f - tl[i]) * v) / 0x7f;
    }
    fm_write(ch, 0x40, tl[0]);
    fm_write(ch, 0x44, tl[1]);
    fm_write(ch, 0x48, tl[2]);
    fm_write(ch, 0x4c, tl[3]);
}

void psg_queue_volume(unsigned ch, uint8_t vol)
{
    if ((int)vol != P.ch[ch].psgVol)
        regq_push(REG_PSG, 0, (uint8_t)(((ch & 3) << 5) | 0x80 | (vol & 0xf) | 0x10));
    P.ch[ch].psgVol = vol;
}

// ---------------------------------------------------------------- PSG envelopes

void psg_env_init(void)
{
    memset(g_psgEnv, 0, sizeof(g_psgEnv));
    for (int i = 0; i < 5; i++) {
        g_psgEnv[i].state = 3;
        g_psgEnv[i].level = 0.0f;
        g_psgEnv[i].lastOut = 0xff;
    }
    float v = 1.0f;
    for (int i = 0; i < 32; i++) {
        g_psgRateTab[31 - i] = v;
        v = (float)((ld)v * (ld)0.8f);
    }
    g_psgRateTab[0] = 0.0f;
}

static void psg_env_restart(int k)
{
    PsgEnv *e = &g_psgEnv[k];
    e->state = 0;
    e->level = e->attack < 1.0f ? 0.0f : 1.0f;
}

void psg_env_tick(void)
{
    for (unsigned k = 0; k < 5; k++) {
        PsgEnv *e = &g_psgEnv[k];
        switch (e->state) {
        case 0:
            e->level = (float)((ld)e->attack + (ld)e->level);
            if (1.0f <= e->level) {
                e->level = 1.0f;
                e->state = 1;
            }
            break;
        case 1:
            e->level = (float)((ld)e->level - (ld)e->decay);
            if (e->level <= e->sustainLevel) {
                e->level = e->sustainLevel;
                e->state = 2;
            }
            break;
        case 2:
            e->level = (float)((ld)e->level - (ld)e->sustain);
            if (e->level < 0.0f)
                e->level = 0.0f;
            break;
        case 3:
            e->level = (float)((ld)e->level - (ld)e->release);
            if (e->level < 0.0f)
                e->level = 0.0f;
            break;
        }
        int out = (int)((ld)15.0 - (ld)e->level * (ld)e->scale * (ld)15.0);
        uint8_t b = (uint8_t)out;
        if (k < 4) {
            if (out != (int)e->lastOut) {
                psg_queue_volume(k, b);
                e->lastOut = b;
            }
        } else {
            for (int c = 0; c < 4; c++)
                chips_psg2_write((uint8_t)((c << 5) | 0x80 | (b & 0xf) | 0x10));
        }
    }
}

// ---------------------------------------------------------------- DAC (sample channel)

void dac_set_log_mode(uint8_t on)
{
    P.dacSample = -1;
    P.dacLog = on;
}

// RG (Furnace): o DAC toca pelo Furnace; o tocador só avisa quando começa (amostra) ou para (-1)
void (*g_rgDacHook)(int sample) = nullptr;

void dac_start(int sample)
{
    if (g_rgDacHook)
        g_rgDacHook(sample);
    P.dacSample = sample;
    P.dacPos = 0;
    if (P.dacLog && sample >= 0) {
        vgm_put(0x52);
        vgm_put(0x2b);
        vgm_put(0x80);
        vgm_put(0x93);          // VGM 1.60: start stream 0 at offset, play "length" bytes
        vgm_put(0);
        vgm_put32((uint32_t)g_vgmSampleOffset[sample % MAX_SAMPLES]);
        vgm_put(1);
        vgm_put32((uint32_t)g_vgmSampleLen[sample % MAX_SAMPLES]);
    }
}

void dac_stop(void)
{
    if (g_rgDacHook)
        g_rgDacHook(-1);
    chips_ym_write(0, 0x2b);
    chips_ym_write(1, 0);
    P.dacSample = -1;
    if (P.dacLog) {
        vgm_put(0x94);          // stop stream 0
        vgm_put(0);
        vgm_put(0x52);
        vgm_put(0x2b);
        vgm_put(0);
    }
}

// Called at the module's sample rate while rendering audio.
void dac_tick_emul(void)
{
    if (P.dacSample < 0 || P.dacSample >= MAX_SAMPLES)
        return;
    int idx = g_song.sample[P.dacSample].data;
    if (idx < 0 || g_sampleData[idx].conv == nullptr)
        return;
    if (g_sampleData[idx].convLen <= P.dacPos) {
        chips_ym_write(0, 0x2b);
        chips_ym_write(1, 0);
        P.dacSample = -1;
        return;
    }
    if (P.dacPos == 0) {
        chips_ym_write(0, 0x2b);
        chips_ym_write(1, 0x80);
    }
    uint8_t v = g_sampleData[idx].conv[P.dacPos++];
    chips_ym_write(0, 0x2a);
    chips_ym_write(1, v);
    if (v == 0x80) {
        chips_ym_write(0, 0x2b);
        chips_ym_write(1, 0);
        P.dacSample = -1;
    }
}

// ---------------------------------------------------------------- transport

void player_channels_reset(void)
{
    for (int i = 0; i < CHANNELS; i++) {
        PlayerChannel *c = &P.ch[i];
        c->ins = -1;
        c->vol = 0xf8;
        c->alg = -1;
        c->pitch = -1;
        c->portaTarget = -1;
        c->vibOffset = 0;
        c->arpOffset = 0;
        c->arpPhase = 0;
        c->arpParam = 0xff;
        c->portaUp = 0;
        c->portaDown = 0;
        c->volSlide = 0;
        c->vibParam = 0;
        c->reserved = 0;
        c->vibPhase = 0;
        c->tonePorta = 0;
        c->volDirty = 0;
        c->freqDirty = 0;
        c->pan = 0xc0;
        for (int j = 0; j < 4; j++) {
            c->tl[j] = 0x7f;
            c->fx[j] = 0;
        }
    }
    P.ch3Special = 0;
    for (int i = 0; i < 3; i++)
        P.ch3Offset[i] = 0;
    P.pendingIns = -1;
    psg_env_init();
}

static inline int pan_from_param(uint8_t p)
{
    if (p == 0)
        return 0xc0;
    return ((p & 0xf0) ? 0x80 : 0) | ((p & 0x0f) ? 0x40 : 0);
}

static inline void speed_effect(uint8_t p, bool withInterleaveReset)
{
    if (p == 0) {
        P.speedEven = (int)g_song.speedEven;
        P.speedOdd = (int)g_song.speedOdd;
        if (withInterleaveReset)
            P.interleave = (int)g_song.interleave;
    } else if ((p & 0xf0) == 0) {
        P.interleave = p & 0xf;
    } else {
        P.speedEven = p >> 4;
        P.speedOdd = p & 0xf;
        if (P.speedEven == 0)
            P.speedEven = 1;
        if ((p & 0xf) == 0)
            P.speedOdd = 1;
    }
}

// Works out instrument, volume and panning of every channel as if the song had been played
// up to (order, row), by scanning backwards.
void player_seek_state(int order, int row)
{
    char panFound[CHANNELS], volFound[CHANNELS], insFound[CHANNELS];
    memset(panFound, 0, sizeof(panFound));
    memset(volFound, 0, sizeof(volFound));
    memset(insFound, 0, sizeof(insFound));
    bool first = true;
    int found = 0;
    int startRow = row;
    for (int o = order; o >= 0; o--) {
        int pat = g_song.order[o].pattern;
        if (!first)
            row = g_song.pattern[pat].length - 1;
        first = false;
        for (int r = row; r >= 0; r--) {
            for (int ch = 0; ch < CHANNELS; ch++) {
                const Cell *cell = &g_song.pattern[pat].cell[r][ch];
                PlayerChannel *c = &P.ch[ch];
                if (!insFound[ch] && cell->ins != 0) {
                    found++;
                    c->ins = cell->ins;
                    insFound[ch] = 1;
                    if (found == 0x1e)
                        break;
                }
                if (!volFound[ch] && cell->volume != 0) {
                    found++;
                    c->vol = (int)cell->volume << 3;
                    volFound[ch] = 1;
                    if (found == 0x1e)
                        break;
                }
                if (!panFound[ch]) {
                    for (int f = 0; f < 4; f++) {
                        if (cell->fx[f] == 0x19) {
                            found++;
                            c->pan = pan_from_param(cell->param[f]);
                            panFound[ch] = 1;
                            if (found == 0x1e)
                                break;
                        }
                    }
                }
            }
            if (found == 0x1e)
                break;
        }
        if (found == 0x1e)
            break;
    }
    for (int ch = 0; ch < CHANNELS; ch++) {
        if (!insFound[ch])
            P.ch[ch].ins = 1;
        if (!volFound[ch])
            P.ch[ch].vol = 0xf8;
    }
    P.speedEven = g_song.order[order].speedEven;
    P.speedOdd = g_song.order[order].speedOdd;
    P.interleave = g_song.order[order].interleave;
    const Pattern *pat = &g_song.pattern[g_song.order[order].pattern];
    for (int r = 0; r < startRow; r++) {
        for (int ch = 0; ch < CHANNELS; ch++)
            for (int f = 0; f < 4; f++)
                if (pat->cell[r][ch].fx[f] == 0x0f)
                    speed_effect(pat->cell[r][ch].param[f], false);
        P.interleaveCount++;
        if (P.interleave <= P.interleaveCount) {
            P.interleaveCount = 0;
            P.oddFlag ^= 1;
        }
    }
}

static void gg_stereo_update(int ch)
{
    int sh = (ch - 6) & 0x1f;
    uint8_t v = (uint8_t)(P.ggStereo & ~(0x11 << sh));
    int bits = ((P.ch[ch].pan & 0x80) ? 0x10 : 0) | ((P.ch[ch].pan & 0x40) != 0);
    P.ggStereo = (uint8_t)(v | (bits << sh));
}

static void gg_stereo_flush(void)
{
    if (g_regqCount < 0xfffd && P.ggStereo != P.ggStereoSent) {
        P.ggStereoSent = P.ggStereo;
        regq_push(REG_GG_STEREO, 0, P.ggStereo);
    }
}

void player_start(int order, int row, uint8_t singleRow, uint8_t loopPattern, uint8_t autoStop, int solo)
{
    if (P.playing)
        return;
    memset(&P, 0, sizeof(P));
    player_channels_reset();
    P.singleRow = singleRow;
    P.loopPattern = loopPattern;
    P.autoStop = autoStop;
    P.interleaveCount = 0;
    P.oddFlag = 0;
    P.solo = solo;
    P.loopCount = 0x10;
    P.loopJump = 0;
    P.loopRow = -1;
    P.loopOrder = -1;
    P.ggStereo = 0xff;
    P.ggStereoSent = 0;
    P.noiseMode = 0;
    P.pendingIns = -1;
    if (P.speedEven < 1)
        P.speedEven = 1;
    if (P.speedOdd < 1)
        P.speedOdd = 1;
    if (P.interleave < 1)
        P.interleave = 1;
    if (g_song.orderLen <= order)
        order = 0;
    P.pattern = g_song.order[order].pattern;
    if (g_song.pattern[P.pattern].length <= row)
        row = g_song.pattern[P.pattern].length - 1;
    P.order = order;
    P.row = row;
    for (int i = 0; i < CHANNELS; i++) {
        P.ch[i].reloadIns = 1;
        P.ch[i].psgPeriod = -1;
        P.ch[i].psgVol = -1;
        P.ch[i].ins = -1;
    }
    player_seek_state(order, row);
    psg_env_init();
    chips_reset();
    g_regq[0] = {REG_FM0, 0x22, 0};
    g_regq[1] = {REG_FM0, 0x27, 0};
    g_regq[2] = {REG_FM0, 0x2b, 0};
    g_regqCount = 3;
    g_regqRead = 0;
    for (unsigned k = 0; k < 4; k++) {
        if (P.ch[k].psgVol != 0xf)
            regq_push(REG_PSG, 0, (uint8_t)(((k & 3) << 5) | 0x9f));
        P.ch[k].psgVol = 0xf;
        regq_push(REG_PSG, 0, (uint8_t)(((k & 3) << 5) | 0x80));
        if (((P.ch[k].psgPeriod >> 4) & 0x3f) != 0)
            regq_push(REG_PSG, 0, 0);
        P.ch[k].psgPeriod = 0;
    }
    for (int ch = 0; ch < CHANNELS; ch++) {
        if (ch < 6) {
            const Instrument *ins = ins_ptr(P.ch[ch].ins);
            fm_write(ch, 0xb4, (uint8_t)(ins->ams << 4 | ins->fms | (uint8_t)P.ch[ch].pan));
        } else {
            gg_stereo_update(ch);
        }
    }
    gg_stereo_flush();
    P.playing = 1;
}

void player_stop(void)
{
    P.playing = 0;
    // (the original waits here for the audio thread to leave audio_render; callers hold the audio lock)
    g_regqCount = 0;
    g_regqRead = 0;
    psg_env_init();
    chips_reset();
}

bool player_auto_stop(void)
{
    if (P.autoStop) {
        player_stop();
        P.autoStop = 0;
        return true;
    }
    return false;
}

bool player_is_playing(void)
{
    return P.playing != 0;
}

void player_set_position(int order)
{
    if (P.playing && order >= 0 && order < g_song.orderLen) {
        P.pattern = g_song.order[order].pattern;
        P.order = order;
        P.row = 0;
        P.tick = 0;
        P.oddFlag = 0;
        P.interleaveCount = 0;
    }
}

void player_refresh_instrument(int ins)
{
    P.pendingIns = ins;
}

// ---------------------------------------------------------------- tick

static void ins_write_mult(int ch, const Instrument *ins, int op, int mult)
{
    fm_write(ch, 0x30 + op * 4, (uint8_t)(dt_to_reg(ins->op[op].dt) << 4 | (mult & 0xf)));
}

static void note_restart(int ch)
{
    if (ch < 6) {
        fm_key(ch, 0);
        fm_key(ch, 0xf0);
    } else {
        psg_env_restart(ch - 6);
    }
}

int player_tick(bool exporting)
{
    if (!P.playing) {
        psg_env_tick();
        return 0;
    }
    int looped = 0;
    if (g_song.loopPos == P.order && P.row == 0 && P.tick == 0) {
        looped = 1;
        if (exporting)
            for (int ch = 0; ch < CHANNELS; ch++)
                P.ch[ch].reloadIns = 1;
    }
    g_regqCount = 0;
    g_regqRead = 0;

    // an instrument was edited while playing: refresh the channels that use it
    if (P.pendingIns >= 0) {
        for (int ch = 0; ch < CHANNELS; ch++) {
            PlayerChannel *c = &P.ch[ch];
            if (P.pendingIns + 1 != c->ins)
                continue;
            const Instrument *ins = ins_ptr(c->ins);
            if (ch < 6) {
                fm_write(ch, 0xb0, (uint8_t)((ins->alg & 7) | (ins->fb & 7) << 3));
                for (int o = 0; o < 4; o++)
                    ins_write_mult(ch, ins, o, ins->op[o].mult);
                for (int o = 0; o < 4; o++)
                    c->tl[o] = ins->op[o].tl & 0x7f;
                c->volDirty = 1;
            } else {
                c->tl[3] = ins->op[3].tl & 0x7f;
                c->volDirty = 1;
            }
        }
        P.pendingIns = -1;
    }

    int dacTrigger = -1;
    if (P.tick == 0) {
        P.dacCut = -1;
        P.dacDelay = -1;
        P.dacRetrig = -1;
        for (int ch = 0; ch < CHANNELS; ch++) {
            const Cell *cell = &g_song.pattern[P.pattern].cell[P.row][ch];
            PlayerChannel *c = &P.ch[ch];
            c->cutTick = -1;
            c->delayTick = -1;
            c->retrig = -1;
            bool porta = false, delayed = false, customKey = false;

            // effects that must be known before the note is handled
            for (int f = 0; f < 4; f++) {
                uint8_t p = cell->param[f];
                unsigned hi = p & 0xf0;
                switch (cell->fx[f]) {
                case 0x03:
                    porta = true;
                    break;
                case 0x0b:
                    if (hi == 0) {
                        if (p == 0) {
                            if (P.ch3Special) {
                                P.ch3Special = 0;
                                regq_push(REG_FM0, 0x27, 0);
                            }
                        } else if (!P.ch3Special) {
                            P.ch3Special = 1;
                            regq_push(REG_FM0, 0x27, 0x40);
                        }
                    } else if (hi == 0x10) {
                        P.ch3Offset[0] = p & 0xf;
                    } else if (hi == 0x20) {
                        P.ch3Offset[1] = p & 0xf;
                    } else if (hi == 0x30) {
                        P.ch3Offset[2] = p & 0xf;
                    }
                    break;
                case 0x0e:
                    if (hi == 0xd0) {
                        if (p & 0xf) {
                            c->delayTick = p & 0xf;
                            delayed = true;
                        }
                    } else if (hi == 0x50) {
                        customKey = true;
                    } else if (hi == 0x90) {
                        if (p & 0xf)
                            c->retrig = p & 0xf;
                    } else if (hi == 0xc0) {
                        if (p & 0xf)
                            c->cutTick = p & 0xf;
                    } else if (hi == 0xe0) {
                        c->reloadIns = 1;
                    }
                    break;
                case 0x15:
                    if (p == 0)
                        regq_push(REG_FM0, 0x22, 0);
                    else
                        regq_push(REG_FM0, 0x22, (uint8_t)((p & 7) | 8));
                    break;
                case 0x17:
                    P.noiseMode = p != 0;
                    break;
                case 0x19:
                    c->pan = pan_from_param(p);
                    if (ch < 6) {
                        const Instrument *ins = ins_ptr(c->ins);
                        fm_write(ch, 0xb4, (uint8_t)(ins->ams << 4 | ins->fms | (uint8_t)c->pan));
                    } else {
                        gg_stereo_update(ch);
                    }
                    break;
                case 0x1a:
                    if (hi == 0x90)
                        P.dacRetrig = p & 0xf;
                    else if (hi == 0xc0)
                        P.dacCut = p & 0xf;
                    else if (hi == 0xd0)
                        P.dacDelay = p & 0xf;
                    break;
                case 0x1c: {
                    int s = p;
                    if (s == 0xff)
                        s = 0xfe;
                    dacTrigger = s;
                    P.dacPending = s;
                    break;
                }
                }
            }

            if (cell->note != NOTE_EMPTY) {
                if (cell->note == NOTE_OFF || !porta) {
                    if (ch < 6)
                        fm_key(ch, 0);
                    else
                        g_psgEnv[ch - 6].state = 3;
                }
                if (cell->note != NOTE_OFF) {
                    if ((cell->ins != 0 && cell->ins != c->ins) || c->reloadIns) {
                        int n = cell->ins;
                        if (n == 0 && c->ins > 0)
                            n = c->ins;
                        if (n == 0)
                            n = 1;
                        c->reloadIns = 0;
                        c->ins = n;
                        const Instrument *ins = ins_ptr(n);
                        if (cell->volume != 0)
                            c->vol = (int)cell->volume << 3;
                        c->volDirty = 1;
                        if (ch < 6) {
                            for (int o = 0; o < 4; o++)
                                c->tl[o] = ins->op[o].tl & 0x7f;
                            c->alg = ins->alg;
                            fm_write(ch, 0xb0, (uint8_t)((ins->alg & 7) | (ins->fb & 7) << 3));
                            fm_write(ch, 0xb4, (uint8_t)(ins->ams << 4 | ins->fms | (uint8_t)c->pan));
                            uint8_t mult[4] = {ins->op[0].mult, ins->op[1].mult, ins->op[2].mult, ins->op[3].mult};
                            for (int f = 0; f < 4; f++) {
                                if (cell->fx[f] == 0x0e) {
                                    uint8_t pp = cell->param[f];
                                    if ((pp & 0xf0) == 0x00) mult[0] = pp;
                                    if ((pp & 0xf0) == 0x10) mult[1] = pp;
                                    if ((pp & 0xf0) == 0x20) mult[2] = pp;
                                    if ((pp & 0xf0) == 0x30) mult[3] = pp;
                                }
                            }
                            for (int o = 0; o < 4; o++)
                                ins_write_mult(ch, ins, o, mult[o]);
                            for (int o = 0; o < 4; o++)
                                fm_write(ch, 0x50 + o * 4, (uint8_t)((ins->op[o].ar & 0x1f) | ins->op[o].rs << 6));
                            for (int o = 0; o < 4; o++)
                                fm_write(ch, 0x60 + o * 4, ins->op[o].dr & 0x9f);
                            for (int o = 0; o < 4; o++)
                                fm_write(ch, 0x70 + o * 4, ins->op[o].sr & 0x1f);
                            for (int o = 0; o < 4; o++)
                                fm_write(ch, 0x80 + o * 4, (uint8_t)((ins->op[o].rr & 0xf) | ins->op[o].sl << 4));
                            for (int o = 0; o < 4; o++)
                                fm_write(ch, 0x90 + o * 4, ins->op[o].ssg & 0xf);
                        } else {
                            // PSG channels take their envelope from operator 4 of the instrument
                            PsgEnv *e = &g_psgEnv[ch - 6];
                            c->tl[3] = ins->op[3].tl & 0x7f;
                            e->attack = g_psgRateTab[ins->op[3].ar & 0x1f];
                            e->decay = g_psgRateTab[ins->op[3].dr & 0x1f];
                            e->sustain = g_psgRateTab[ins->op[3].sr & 0x1f];
                            e->release = g_psgRateTab[(ins->op[3].rr & 0xf) * 2];
                            e->sustainLevel = (float)((ld)(1.0 / 15.0) * (ld)(0xf - (ins->op[3].sl & 0xf)));
                        }
                    }
                    int pitch = ((int)cell->octave * 0xc + (int)cell->note - 0xc) * 0x20;
                    if (porta) {
                        c->portaTarget = pitch;
                    } else {
                        c->arpPhase = 0;
                        c->arpParam = 0xff;
                        c->arpOffset = 0;
                        c->pitch = pitch;
                        c->reserved = 0;
                        c->vibOffset = 0;
                        c->freqDirty = 1;
                        if ((P.solo < 0 || ch == P.solo) && !delayed && !customKey) {
                            if (ch < 6)
                                fm_key(ch, 0xf0);
                            else
                                psg_env_restart(ch - 6);
                        }
                    }
                }
            }
            if (cell->volume != 0 && (int)cell->volume * 8 != c->vol) {
                c->vol = (int)cell->volume << 3;
                c->volDirty = 1;
            }

            // remaining effects
            for (int f = 0; f < 4; f++) {
                uint8_t p = cell->param[f];
                unsigned hi = p & 0xf0;
                const Instrument *ins = ins_ptr(c->ins);
                c->fx[f] = (int)(int8_t)cell->fx[f];
                switch (cell->fx[f]) {
                case 0x00:
                    if (p != 0)
                        c->arpParam = p;
                    c->arpPhase = 0;
                    break;
                case 0x01:
                    if (p != 0)
                        c->portaUp = p;
                    break;
                case 0x02:
                    if (p != 0)
                        c->portaDown = p;
                    break;
                case 0x03:
                    if (p != 0)
                        c->tonePorta = p;
                    break;
                case 0x04:
                    if (p & 0x0f)
                        c->vibParam = (c->vibParam & 0xf0) | (p & 0x0f);
                    if (p & 0xf0)
                        c->vibParam = (c->vibParam & 0x0f) | (p & 0xf0);
                    break;
                case 0x05:
                case 0x06:
                case 0x0a:
                    if (p != 0)
                        c->volSlide = p;
                    break;
                case 0x08:
                case 0x09:
                case 0x0c:
                case 0x0d: {
                    int o = cell->fx[f] == 0x08 ? 0 : cell->fx[f] == 0x09 ? 1 : cell->fx[f] == 0x0c ? 2 : 3;
                    if (c->tl[o] != (p & 0x7f)) {
                        c->tl[o] = p & 0x7f;
                        c->volDirty = 1;
                    }
                    break;
                }
                case 0x0e:
                    if (hi <= 0x30) {
                        if (ch < 6)
                            ins_write_mult(ch, ins, (int)(hi >> 4), p);
                    } else if (hi == 0x50) {
                        if (ch < 6)
                            fm_key(ch, (p & 0x0f) << 4);
                    } else if (hi == 0x60) {
                        if ((p & 0xf) == 0) {
                            if (P.loopRow != P.row || P.loopOrder != P.order) {
                                P.loopCount = 0;
                                P.saveEven = P.speedEven;
                                P.saveOdd = P.speedOdd;
                                P.saveInterleave = P.interleave;
                                P.saveOddFlag = P.oddFlag;
                                P.saveInterleaveCount = P.interleaveCount;
                                P.loopRow = P.row;
                                P.loopOrder = P.order;
                            }
                        } else if (P.loopCount < (int)(p & 0xf)) {
                            P.loopCount++;
                            if ((int)(p & 0xf) <= P.loopCount)
                                P.loopCount = 0x10;
                            P.loopJump = 1;
                        }
                    } else if (hi == 0xf0) {
                        if (ch < 6)
                            fm_write(ch, 0xb0, (uint8_t)((ins->alg & 7) | (p & 7) << 3));
                    }
                    break;
                case 0x0f:
                    speed_effect(p, true);
                    break;
                }
            }
        }

        if (!P.singleRow) {
            if (!P.loopJump) {
                P.row++;
                if (g_song.pattern[P.pattern].length <= P.row) {
                    P.row = 0;
                    if (!P.loopPattern) {
                        P.order++;
                        if (g_song.orderLen <= P.order)
                            P.order = g_song.loopPos;
                        P.pattern = g_song.order[P.order].pattern;
                    }
                }
            } else {
                P.loopJump = 0;
                P.speedEven = P.saveEven;
                P.speedOdd = P.saveOdd;
                P.interleave = P.saveInterleave;
                P.oddFlag = P.saveOddFlag;
                P.interleaveCount = P.saveInterleaveCount;
                P.row = P.loopRow;
                P.order = P.loopOrder;
                P.pattern = g_song.order[P.loopOrder].pattern;
            }
        }
    }

    gg_stereo_flush();

    if (P.dacDelay > 0) {
        dacTrigger = P.dacPending;
        if (P.dacDelay != P.tick)
            dacTrigger = -1;
    }
    if (P.dacRetrig > 0 && P.tick % P.dacRetrig == 0)
        dacTrigger = P.dacPending;
    if (dacTrigger >= 0)
        dac_start(dacTrigger);
    if (P.dacCut > 0 && P.dacCut == P.tick)
        dac_stop();

    for (int ch = 0; ch < CHANNELS; ch++) {
        PlayerChannel *c = &P.ch[ch];
        bool vibrato = false;
        // NB: everything in this loop runs once per effect column, as in the original
        for (int f = 0; f < 4; f++) {
            int fx = c->fx[f];
            if ((fx == 3 || fx == 5) && c->portaTarget >= 0) {
                int old = c->pitch;
                if (c->pitch < c->portaTarget) {
                    c->pitch += c->tonePorta;
                    if (c->portaTarget < c->pitch)
                        c->pitch = c->portaTarget;
                } else {
                    c->pitch -= c->tonePorta;
                    if (c->pitch < c->portaTarget)
                        c->pitch = c->portaTarget;
                }
                if (old != c->pitch)
                    c->freqDirty = 1;
            }
            if (fx == 4 || fx == 6) {
                vibrato = true;
                int old = c->vibOffset;
                c->vibOffset = g_vibTab[(c->vibPhase >> 1) + (c->vibParam & 0xf) * 0x20];
                c->vibPhase = ((c->vibParam >> 4) + c->vibPhase) & 0x3f;
                if (old != c->vibOffset)
                    c->freqDirty = 1;
            }
            if (fx == 1) {
                int old = c->pitch;
                c->pitch += c->portaUp;
                if (c->pitch > 0xbff)
                    c->pitch = 0xbff;
                if (old != c->pitch)
                    c->freqDirty = 1;
            } else if (fx == 2) {
                int old = c->pitch;
                c->pitch -= c->portaDown;
                if (c->pitch < 0)
                    c->pitch = 0;
                if (old != c->pitch)
                    c->freqDirty = 1;
            } else if (fx == 5 || fx == 6 || fx == 10) {
                int v = c->volSlide;
                if ((v & 0x0f) != 0 && c->vol > 0) {
                    c->vol -= v & 0xf;
                    if (c->vol < 0)
                        c->vol = 0;
                    c->volDirty = 1;
                }
                if ((v & 0xf0) != 0 && c->vol < 0xf8) {
                    c->vol += v >> 4;
                    if (c->vol > 0xf8)
                        c->vol = 0xf8;
                    c->volDirty = 1;
                }
            }
            if (c->arpParam == 0xff) {
                if (c->arpOffset != 0) {
                    c->arpOffset = 0;
                    c->freqDirty = 1;
                }
            } else {
                if (c->arpPhase == 0)
                    c->arpOffset = 0;
                else if (c->arpPhase == 1)
                    c->arpOffset = (c->arpParam & 0xf0) * 2;
                else if (c->arpPhase == 2)
                    c->arpOffset = (c->arpParam & 0x0f) << 5;
                c->arpPhase = (c->arpPhase + 1) % 3;
                c->freqDirty = 1;
            }
            if (c->retrig >= 0 && P.tick % c->retrig == 0)
                note_restart(ch);
            if (c->cutTick >= 0 && c->cutTick == P.tick) {
                if (ch < 6)
                    fm_key(ch, 0);
                else
                    g_psgEnv[ch - 6].state = 3;
            }
            if (c->delayTick >= 0 && c->delayTick == P.tick)
                note_restart(ch);
        }
        if (!vibrato && c->vibOffset != 0) {
            c->vibOffset = 0;
            c->vibPhase = 0;
            c->reserved = 0;
            c->freqDirty = 1;
        }

        if (c->freqDirty) {
            c->freqDirty = 0;
            if (ch < 6) {
                int mod = c->vibOffset + c->arpOffset;
                int pitch = c->pitch + mod;
                if (pitch < 0)
                    pitch = 0;
                if (pitch > 0xbff)
                    pitch = 0xbff;
                int fn = g_fnumTab[pitch % 0x180];
                uint8_t hi = (uint8_t)(((fn >> 8) & 7) | ((pitch >> 5) / 0xc) << 3);
                if (!P.ch3Special || ch != 2) {
                    fm_write(ch, 0xa4, hi);
                    fm_write(ch, 0xa0, (uint8_t)fn);
                } else {
                    static const uint8_t opReg[3][2] = {{0xac, 0xa8}, {0xae, 0xaa}, {0xad, 0xa9}};
                    regq_push(REG_FM0, 0xa6, hi);
                    regq_push(REG_FM0, 0xa2, (uint8_t)fn);
                    for (int k = 0; k < 3; k++) {
                        int p2 = P.ch[2].pitch + mod + P.ch3Offset[k] * 0x20;
                        if (p2 < 0)
                            p2 = 0;
                        if (p2 > 0xbff)
                            p2 = 0xbff;
                        int fn2 = g_fnumTab[p2 % 0x180];
                        regq_push(REG_FM0, opReg[k][0], (uint8_t)(((fn2 >> 8) & 7) | ((p2 >> 5) / 0xc) << 3));
                        regq_push(REG_FM0, opReg[k][1], (uint8_t)fn2);
                    }
                }
            } else if (ch < 9) {
                int pitch = c->pitch + c->vibOffset + c->arpOffset;
                if (pitch < 0)
                    pitch = 0;
                if (pitch > 0xbff)
                    pitch = 0xbff;
                int period = g_psgPeriodTab[pitch] + (int)ins_ptr(c->ins)->op[3].dt;
                if (period < 0)
                    period = 0;
                if (period > 0x3ff)
                    period = 0x3ff;
                unsigned k = (unsigned)(ch - 6);
                regq_push(REG_PSG, 0, (uint8_t)(((k & 3) << 5) | 0x80 | (period & 0xf)));
                if (((period >> 4) & 0x3f) != ((P.ch[k].psgPeriod >> 4) & 0x3f))
                    regq_push(REG_PSG, 0, (uint8_t)((period >> 4) & 0x3f));
                P.ch[k].psgPeriod = period;
            } else {
                regq_push(REG_PSG, 0, (uint8_t)((P.noiseMode ? 0 : 4) | 0xe0 | ((c->pitch >> 5) & 3)));
            }
        }
        if (c->volDirty) {
            c->volDirty = 0;
            if (ch < 6) {
                fm_set_volume(ch);
            } else {
                g_psgEnv[ch - 6].scale =
                    (float)((ld)(1.0 / 127.0) * (ld)(0x7f - (0x7f - ((0x7f - c->tl[3]) * (c->vol >> 1)) / 0x7f)));
            }
        }
    }
    psg_env_tick();

    if (P.singleRow) {
        P.playing = 0;
        return 0;
    }
    int speed = P.oddFlag ? P.speedOdd : P.speedEven;
    P.tick = (P.tick + 1) % speed;
    if (P.tick == 0) {
        P.interleaveCount++;
        if (P.interleave <= P.interleaveCount) {
            P.interleaveCount = 0;
            P.oddFlag ^= 1;
        }
    }
    return looped;
}
