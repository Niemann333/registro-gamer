// Module data: creation, .vge load/save, order list and pattern housekeeping.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>

#include "player.h"
#include "song.h"

Song g_song;
SampleData g_sampleData[MAX_SAMPLES];
bool g_defaultInstrument = true;

static uint16_t date_now_system(void)
{
    time_t t = time(nullptr);
    struct tm tmv;
#ifdef _WIN32
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    return (uint16_t)(((tmv.tm_year + 1900) % 100) | (tmv.tm_mday & 0x1f) << 11 | (tmv.tm_mon & 0xf) << 7);
}

uint16_t (*g_dateNow)(void) = date_now_system;

uint16_t date_now(void)
{
    return g_dateNow();
}

void date_to_str(char *dst, unsigned date)
{
    if (date == 0) {
        strcpy(dst, "--.--.--");
        return;
    }
    unsigned month = ((date >> 7) & 0xf) + 1;
    unsigned day = date >> 11;
    unsigned year = date & 0x7f;
    sprintf(dst, "%u%u.%u%u.%u%u", day / 10, day % 10, month / 10, month % 10, year / 10, year % 10);
}

void pattern_clear(int pat)
{
    Pattern *p = &g_song.pattern[pat];
    memset(p, 0, sizeof(Pattern));
    p->length = 0x40;
    for (int row = 0; row < MAX_ROWS; row++)
        for (int ch = 0; ch < CHANNELS; ch++)
            p->cell[row][ch].note = NOTE_EMPTY;
}

static void song_header_defaults(void)
{
    g_song.fps = 50;
    g_song.fmClock = 7600489;
    g_song.psgClock = 3546894;
    g_song.speedEven = 3;
    g_song.speedOdd = 3;
    g_song.interleave = 1;
    g_song.sampleRate = 11025;
    g_song.saveCount = 0;
    g_song.dateCreated = date_now();
    g_song.dateModified = 0;
    g_song.orderLen = 1;
    for (int i = 0; i < MAX_PATTERNS; i++)
        pattern_clear(i);
}

void song_new(void)
{
    memset(&g_song, 0, sizeof(Song));
    song_header_defaults();
    for (int i = 0; i < MAX_INSTRUMENTS; i++)
        ins_clear(&g_song.ins[i]);
    for (int i = 0; i < MAX_SAMPLES; i++)
        sample_clear(&g_song.sample[i]);
    player_channels_reset();
    if (g_defaultInstrument) {
        ins_from_vgi(&g_song.ins[0], g_defaultInsVgi);
        memcpy(g_song.ins[0].name, "default", 8);
    }
}

void song_clear(void)
{
    memset(&g_song.fmClock, 0, sizeof(Song) - offsetof(Song, fmClock));
    song_header_defaults();
    player_channels_reset();
}

// ---------------------------------------------------------------- .vge

uint8_t *song_pack(int *outLen)
{
    Packer pk;
    if (g_song.saveCount != 0xffff)
        g_song.saveCount++;
    g_song.dateModified = date_now();
    if (pack_init(&pk, nullptr, 0, true) == nullptr)
        return nullptr;
    pack_write32(&pk, g_song.fmClock);
    pack_write32(&pk, g_song.psgClock);
    pack_write16(&pk, g_song.fps);
    pack_write_byte(&pk, g_song.speedEven);
    pack_write_byte(&pk, g_song.speedOdd);
    pack_write_byte(&pk, g_song.interleave);
    pack_write16(&pk, g_song.sampleRate);
    pack_write16(&pk, g_song.dateCreated);
    pack_write16(&pk, g_song.dateModified);
    pack_write16(&pk, g_song.saveCount);
    pack_write_byte(&pk, g_song.orderLen);
    pack_write_byte(&pk, g_song.loopPos);
    pack_write_str(&pk, g_song.author, 0x40);
    pack_write_str(&pk, g_song.name, 0x40);
    pack_write_str(&pk, g_song.message, 0x180);
    for (int i = 0; i < MAX_ORDERS; i++)
        pack_write_byte(&pk, g_song.order[i].pattern);
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        if (!ins_is_empty(&g_song.ins[i])) {
            pack_write_str(&pk, g_song.ins[i].name, 0x10);
        } else {
            for (int j = 0; j < 0x10; j++)
                pack_write_byte(&pk, 0xff);
        }
    }
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        const Instrument *ins = &g_song.ins[i];
        pack_write_byte(&pk, ins->alg);
        pack_write_byte(&pk, ins->fb);
        pack_write_byte(&pk, (unsigned)ins->ams << 4 | ins->fms);
        for (int o = 0; o < 4; o++) {
            const Operator *op = &ins->op[o];
            pack_write_byte(&pk, op->mult);
            pack_write_byte(&pk, (uint8_t)op->dt);
            pack_write_byte(&pk, op->tl ^ 0x7f);
            pack_write_byte(&pk, op->rs);
            pack_write_byte(&pk, op->ar ^ 0x1f);
            pack_write_byte(&pk, op->dr ^ 0x1f);
            pack_write_byte(&pk, op->sr ^ 0x1f);
            pack_write_byte(&pk, op->rr ^ 0xf);
            pack_write_byte(&pk, op->sl);
            pack_write_byte(&pk, op->ssg);
        }
    }
    for (int i = 0; i < MAX_SAMPLES; i++) {
        if (!sample_is_empty(&g_song.sample[i])) {
            pack_write_str(&pk, g_song.sample[i].name, 0x10);
        } else {
            for (int j = 0; j < 0x10; j++)
                pack_write_byte(&pk, 0xff);
        }
    }
    for (int i = 0; i < MAX_SAMPLES; i++) {
        const Sample *s = &g_song.sample[i];
        if (s->data < 0) {
            pack_write_byte(&pk, 0xff);
            pack_write_byte(&pk, 0xff);
            pack_write16(&pk, 0xffff);
        } else {
            pack_write_byte(&pk, s->data);
            pack_write_byte(&pk, s->volume);
            pack_write16(&pk, (unsigned)s->tune);
        }
    }
    for (int i = 0; i < MAX_PATTERNS; i++)
        pack_write_byte(&pk, g_song.pattern[i].length);
    for (int i = 0; i < MAX_PATTERNS; i++) {
        const Pattern *pat = &g_song.pattern[i];
        for (int ch = 0; ch < CHANNELS; ch++) {
            for (int row = 0; row < MAX_ROWS; row++) {
                const Cell *c = &pat->cell[row][ch];
                unsigned n = (unsigned)(int)c->note;
                if ((int)n < 0xc)
                    n += c->octave * 0xc;
                pack_write_byte(&pk, n ^ 0xff);
            }
            for (int row = 0; row < MAX_ROWS; row++)
                pack_write_byte(&pk, (unsigned)(int)pat->cell[row][ch].volume);
            for (int row = 0; row < MAX_ROWS; row++)
                pack_write_byte(&pk, (unsigned)(int)pat->cell[row][ch].ins);
            for (int f = 0; f < 4; f++) {
                for (int row = 0; row < MAX_ROWS; row++)
                    pack_write_byte(&pk, pat->cell[row][ch].fx[f]);
                for (int row = 0; row < MAX_ROWS; row++)
                    pack_write_byte(&pk, pat->cell[row][ch].param[f]);
            }
        }
    }
    pack_flush(&pk);
    *outLen = pk.pos;
    return pk.buf;
}

bool song_unpack(uint8_t *buf, int len, int version)
{
    Packer pk;
    pack_init(&pk, buf, len, true);
    if (version < 3) {
        g_song.fmClock = 7600489;
        g_song.psgClock = 3546894;
        g_song.fps = 50;
    } else {
        g_song.fmClock = pack_read32(&pk);
        g_song.psgClock = pack_read32(&pk);
        g_song.fps = pack_read16(&pk);
    }
    g_song.speedEven = pack_read_byte(&pk);
    g_song.speedOdd = pack_read_byte(&pk);
    g_song.interleave = pack_read_byte(&pk);
    g_song.sampleRate = pack_read16(&pk);
    g_song.dateCreated = pack_read16(&pk);
    g_song.dateModified = pack_read16(&pk);
    g_song.saveCount = pack_read16(&pk);
    g_song.orderLen = pack_read_byte(&pk);
    if (g_song.orderLen == 0)
        g_song.orderLen = 0x100;
    g_song.loopPos = pack_read_byte(&pk);
    pack_read_bytes(&pk, g_song.author, 0x40);
    pack_read_bytes(&pk, g_song.name, 0x40);
    pack_read_bytes(&pk, g_song.message, 0x180);
    for (int i = 0; i < MAX_ORDERS; i++)
        g_song.order[i].pattern = pack_read_byte(&pk);
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        char *name = g_song.ins[i].name;
        pack_read_bytes(&pk, name, 0x10);
        if ((uint8_t)name[0] == 0xff) {
            memset(name, 0, 0x10);
            memcpy(name, "empty", 6);
        }
    }
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        Instrument *ins = &g_song.ins[i];
        ins->alg = pack_read_byte(&pk);
        ins->fb = pack_read_byte(&pk);
        uint8_t b = pack_read_byte(&pk);
        ins->ams = (b >> 4) & 3;
        ins->fms = b & 7;
        for (int o = 0; o < 4; o++) {
            Operator *op = &ins->op[o];
            op->mult = pack_read_byte(&pk);
            op->dt = (int8_t)pack_read_byte(&pk);
            op->tl = pack_read_byte(&pk) ^ 0x7f;
            op->rs = pack_read_byte(&pk);
            op->ar = pack_read_byte(&pk) ^ 0x1f;
            op->dr = pack_read_byte(&pk) ^ 0x1f;
            op->sr = pack_read_byte(&pk) ^ 0x1f;
            op->rr = pack_read_byte(&pk) ^ 0xf;
            op->sl = pack_read_byte(&pk);
            op->ssg = pack_read_byte(&pk);
        }
    }
    for (int i = 0; i < MAX_SAMPLES; i++) {
        char *name = g_song.sample[i].name;
        pack_read_bytes(&pk, name, 0x10);
        if ((uint8_t)name[0] == 0xff) {
            memset(name, 0, 0x10);
            memcpy(name, "empty", 6);
        }
    }
    for (int i = 0; i < MAX_SAMPLES; i++) {
        Sample *s = &g_song.sample[i];
        unsigned d = pack_read_byte(&pk);
        s->data = (int)d;
        if (d == 0xff)
            s->data = -1;
        s->volume = pack_read_byte(&pk);
        if (version < 2)
            s->tune = 0;
        else
            s->tune = (int16_t)pack_read16(&pk);
    }
    for (int i = 0; i < MAX_PATTERNS; i++) {
        unsigned l = pack_read_byte(&pk);
        g_song.pattern[i].length = (int)l;
        if (l == 0)
            g_song.pattern[i].length = 0x100;
    }
    for (int i = 0; i < MAX_PATTERNS; i++) {
        Pattern *pat = &g_song.pattern[i];
        for (int ch = 0; ch < CHANNELS; ch++) {
            for (int row = 0; row < MAX_ROWS; row++) {
                Cell *c = &pat->cell[row][ch];
                unsigned n = pack_read_byte(&pk) ^ 0xff;
                if (n < 0x80) {
                    c->note = (int16_t)(n % 0xc);
                    c->octave = (int8_t)(n / 0xc);
                } else {
                    c->note = (int16_t)n;
                    c->octave = 0;
                }
            }
            for (int row = 0; row < MAX_ROWS; row++)
                pat->cell[row][ch].volume = (int8_t)pack_read_byte(&pk);
            for (int row = 0; row < MAX_ROWS; row++)
                pat->cell[row][ch].ins = pack_read_byte(&pk);
            for (int f = 0; f < 4; f++) {
                for (int row = 0; row < MAX_ROWS; row++)
                    pat->cell[row][ch].fx[f] = pack_read_byte(&pk);
                for (int row = 0; row < MAX_ROWS; row++)
                    pat->cell[row][ch].param[f] = pack_read_byte(&pk);
            }
        }
    }
    return abs(pk.pos - len) < 1;
}

static void fwrite32(FILE *f, uint32_t v)
{
    uint8_t b[4];
    wr32(b, v);
    fwrite(b, 4, 1, f);
}

bool song_save(const char *filename)
{
    int songLen = 0;
    sample_data_gc();
    uint8_t *songBuf = song_pack(&songLen);
    if (songBuf == nullptr)
        return false;
    Packer pk;
    if (pack_init(&pk, nullptr, 0, true) == nullptr) {
        free(songBuf);
        return false;
    }
    for (int i = 0; i < MAX_SAMPLES; i++) {
        const SampleData *d = &g_sampleData[i];
        if (d->raw == nullptr) {
            pack_write32(&pk, 0);
            pack_write16(&pk, 0);
            pack_write_byte(&pk, 0);
        } else {
            pack_write32(&pk, (unsigned)d->rawLen);
            pack_write16(&pk, (unsigned)d->rate);
            pack_write_byte(&pk, (unsigned)d->bits);
        }
    }
    pack_flush(&pk);
    int smpLen = pk.pos;
    FILE *f = fopen(filename, "wb");
    if (f == nullptr) {
        free(songBuf);
        free(pk.buf);
        return false;
    }
    fwrite("VGEfmtV3", 8, 1, f);
    fwrite32(f, (uint32_t)songLen);
    fwrite32(f, (uint32_t)smpLen);
    fwrite(songBuf, songLen, 1, f);
    fwrite(pk.buf, smpLen, 1, f);
    free(songBuf);
    free(pk.buf);
    for (int i = 0; i < MAX_SAMPLES; i++) {
        if (g_sampleData[i].raw != nullptr)
            fwrite(g_sampleData[i].raw, g_sampleData[i].rawLen, 1, f);
    }
    fclose(f);
    return true;
}

int song_load(const char *filename)
{
    FILE *f = fopen(filename, "rb");
    if (f == nullptr)
        return 1;
    song_new();
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = (uint8_t *)malloc(size > 0 ? size : 1);
    if (buf == nullptr) {
        fclose(f);
        return 3;
    }
    if (fread(buf, 1, size, f) != (size_t)size)
        size = 0;
    fclose(f);
    if (size < 16 || (memcmp(buf, "VGEfmtV3", 8) != 0 && memcmp(buf, "VGEfmtV2", 8) != 0 &&
                      memcmp(buf, "VGEfmtV1", 8) != 0)) {
        free(buf);
        return 2;
    }
    int version = buf[7] - '0';
    int songLen = rd32(buf + 8);
    int smpLen = rd32(buf + 12);
    if (songLen < 0 || smpLen < 0 || (long)songLen + smpLen + 16 > size ||
        !song_unpack(buf + 16, songLen, version)) {
        song_new();
        free(buf);
        return 2;
    }
    Packer pk;
    pack_init(&pk, buf + 16 + songLen, smpLen, true);
    for (int i = 0; i < MAX_SAMPLES; i++) {
        sample_data_free(i);
        g_sampleData[i].rawLen = (int)pack_read32(&pk);
        g_sampleData[i].rate = (int)pack_read16(&pk);
        g_sampleData[i].bits = pack_read_byte(&pk);
    }
    long off = 16L + songLen + smpLen;
    for (int i = 0; i < MAX_SAMPLES; i++) {
        SampleData *d = &g_sampleData[i];
        if (d->rawLen != 0) {
            if (d->rawLen < 0 || off + d->rawLen > size) {      // truncated file
                d->rawLen = 0;
                continue;
            }
            d->raw = (uint8_t *)malloc(d->rawLen);
            memcpy(d->raw, buf + off, d->rawLen);
            off += d->rawLen;
        }
    }
    free(buf);
    samples_convert_all();
    return 0;
}

// ---------------------------------------------------------------- timing

// Speed effect (0x0f) handling shared by the two timing scans below.
static inline void timing_scan_row(const Cell *row, unsigned *even, unsigned *odd, unsigned *interleave)
{
    for (int ch = 0; ch < CHANNELS; ch++) {
        for (int f = 0; f < 4; f++) {
            if (row[ch].fx[f] == 0x0f) {
                uint8_t p = row[ch].param[f];
                if ((p & 0xf0) == 0) {
                    *interleave = p & 0xf;
                } else {
                    *even = p >> 4;
                    *odd = p & 0xf;
                    if (*even == 0)
                        *even = 1;
                    if ((p & 0xf) == 0)
                        *odd = 1;
                }
            }
        }
    }
}

int song_calc_timing(void)
{
    int total = 0;
    bool useOdd = false;
    int count = 0;
    unsigned interleave = g_song.interleave;
    unsigned odd = g_song.speedOdd;
    unsigned even = g_song.speedEven;
    for (int pos = 0; pos < g_song.orderLen; pos++) {
        Order *o = &g_song.order[pos];
        o->startTick = total;
        o->speedEven = (uint8_t)even;
        o->speedOdd = (uint8_t)odd;
        o->interleave = (uint8_t)interleave;
        const Pattern *pat = &g_song.pattern[o->pattern];
        for (int row = 0; row < pat->length; row++) {
            timing_scan_row(pat->cell[row], &even, &odd, &interleave);
            total += (int)(useOdd ? odd : even);
            count++;
            if ((int)interleave <= count) {
                count = 0;
                useOdd = !useOdd;
            }
        }
    }
    return total;
}

int song_position_tick(int order, int row)
{
    const Order *o = &g_song.order[order];
    bool useOdd = false;
    int count = 0;
    int total = o->startTick;
    unsigned odd = o->speedOdd;
    unsigned even = o->speedEven;
    unsigned interleave = o->interleave;
    const Pattern *pat = &g_song.pattern[o->pattern];
    for (int r = 0; r < pat->length && r != row; r++) {
        timing_scan_row(pat->cell[r], &even, &odd, &interleave);
        total += (int)(useOdd ? odd : even);
        count++;
        if ((int)interleave <= count) {
            count = 0;
            useOdd = !useOdd;
        }
    }
    return total;
}

// ---------------------------------------------------------------- instruments / samples

int ins_find_empty(void)
{
    for (int i = 0; i < MAX_INSTRUMENTS; i++)
        if (ins_is_empty(&g_song.ins[i]))
            return i;
    return -1;
}

int sample_find_empty(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++)
        if (sample_is_empty(&g_song.sample[i]))
            return i;
    return -1;
}

void ins_swap_refs(int a, int b)
{
    if (a == b)
        return;
    for (int p = 0; p < MAX_PATTERNS; p++) {
        Pattern *pat = &g_song.pattern[p];
        for (int row = 0; row < pat->length; row++) {
            for (int ch = 0; ch < CHANNELS; ch++) {
                Cell *c = &pat->cell[row][ch];
                if (c->ins == a + 1)
                    c->ins = (int16_t)(b + 1);
                else if (c->ins == b + 1)
                    c->ins = (int16_t)(a + 1);
            }
        }
    }
}

void sample_swap_refs(unsigned a, unsigned b)
{
    if (a == b)
        return;
    for (int p = 0; p < MAX_PATTERNS; p++) {
        Pattern *pat = &g_song.pattern[p];
        for (int row = 0; row < pat->length; row++) {
            for (int ch = 0; ch < CHANNELS; ch++) {
                Cell *c = &pat->cell[row][ch];
                for (int f = 0; f < 4; f++) {
                    if (c->fx[f] == 0x1c) {
                        if (c->param[f] == a)
                            c->param[f] = (uint8_t)b;
                        else if (c->param[f] == b)
                            c->param[f] = (uint8_t)a;
                    }
                }
            }
        }
    }
}

int cleanup_unused_instruments(void)
{
    char used[0x100];
    memset(used, 0, sizeof(used));
    for (int p = 0; p < MAX_PATTERNS; p++) {
        const Pattern *pat = &g_song.pattern[p];
        for (int row = 0; row < pat->length; row++)
            for (int ch = 0; ch < CHANNELS; ch++)
                if (pat->cell[row][ch].ins != 0)
                    used[(uint8_t)(pat->cell[row][ch].ins - 1)] = 1;
    }
    int removed = 0;
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        if (!used[i] && !ins_is_empty(&g_song.ins[i])) {
            ins_clear(&g_song.ins[i]);
            removed++;
        }
    }
    return removed;
}

void rearrange_instruments(void)
{
    for (int i = 0; i < MAX_INSTRUMENTS; i++) {
        if (!ins_is_empty(&g_song.ins[i]))
            continue;
        int j = i;
        int found;
        do {
            j++;
            found = -1;
            if (j > 0xfe)
                break;
            found = j;
        } while (ins_is_empty(&g_song.ins[j]));
        if (found < 1)
            return;
        Instrument tmp = g_song.ins[i];
        g_song.ins[i] = g_song.ins[found];
        g_song.ins[found] = tmp;
        ins_swap_refs(i, found);
    }
}

void pattern_swap(unsigned a, unsigned b)
{
    if (a == b)
        return;
    Cell tmp[CHANNELS];
    for (int row = 0; row < MAX_ROWS; row++) {
        memcpy(tmp, g_song.pattern[a].cell[row], sizeof(tmp));
        memcpy(g_song.pattern[a].cell[row], g_song.pattern[b].cell[row], sizeof(tmp));
        memcpy(g_song.pattern[b].cell[row], tmp, sizeof(tmp));
    }
    int32_t l = g_song.pattern[a].length;
    g_song.pattern[a].length = g_song.pattern[b].length;
    g_song.pattern[b].length = l;
    for (int i = 0; i < g_song.orderLen; i++) {
        if (g_song.order[i].pattern == a)
            g_song.order[i].pattern = (uint8_t)b;
        else if (g_song.order[i].pattern == b)
            g_song.order[i].pattern = (uint8_t)a;
    }
}

void rearrange_patterns(void)
{
    int map[0x100];
    for (int i = 0; i < 0x100; i++)
        map[i] = -1;
    int count = 0;
    for (int i = 0; i < g_song.orderLen; i++) {
        bool found = false;
        uint8_t p = g_song.order[i].pattern;
        for (int j = 0; j < g_song.orderLen; j++) {
            if (g_song.order[j].pattern == p && map[j] < 0) {
                map[j] = count;
                found = true;
            }
        }
        if (found)
            count++;
    }
    for (int i = 0; i < g_song.orderLen; i++)
        pattern_swap((unsigned)map[i], g_song.order[i].pattern);
    for (int i = count; i < MAX_PATTERNS; i++)
        pattern_clear(i);
}

// ---------------------------------------------------------------- order list

bool order_delete(int pos)
{
    if (g_song.orderLen < 2)
        return false;
    if (pos >= g_song.orderLen)
        return false;
    // The original shifts 256 entries, pulling the bytes that follow the table into the last one.
    uint8_t *base = (uint8_t *)g_song.order;
    memmove(base + pos * sizeof(Order), base + (pos + 1) * sizeof(Order), (MAX_ORDERS - pos) * sizeof(Order));
    if (pos < g_song.loopPos)
        g_song.loopPos--;
    g_song.orderLen--;
    if (g_song.orderLen <= g_song.loopPos)
        g_song.loopPos = (uint16_t)(g_song.orderLen - 1);
    return true;
}

bool order_insert(int pos, int mode)
{
    if (g_song.orderLen >= 0x100)
        return false;
    for (int i = 0xff; pos < i && pos < 0xff; i--)
        g_song.order[i] = g_song.order[i - 1];
    g_song.orderLen++;
    int fresh = -1;
    if (mode != 0) {
        char used[0x100];
        memset(used, 0, sizeof(used));
        for (int i = 0; i < g_song.orderLen; i++)
            used[g_song.order[i].pattern] = 1;
        for (int i = 0; i < 0x100; i++) {
            if (!used[i]) {
                fresh = i;
                break;
            }
        }
        if (fresh < 0)
            mode = 0;
        else
            g_song.order[pos].pattern = (uint8_t)fresh;
    }
    if (mode == 1) {
        pattern_clear(fresh);
    } else if (mode == 2) {
        // pos == 255 reads one entry past the table in the original, i.e. the low byte of orderLen
        uint8_t next = ((uint8_t *)g_song.order)[(pos + 1) * sizeof(Order)];
        memcpy(&g_song.pattern[g_song.order[pos].pattern], &g_song.pattern[next], sizeof(Pattern));
    }
    if (pos < g_song.loopPos) {
        g_song.loopPos++;
        if (g_song.loopPos > 0xff)
            g_song.loopPos = 0x100;
    }
    return true;
}

bool order_swap(int a, int b)
{
    if (a < 0 || a >= g_song.orderLen)
        return false;
    if (b < 0 || b >= g_song.orderLen)
        return false;
    Order t = g_song.order[a];
    g_song.order[a] = g_song.order[b];
    g_song.order[b] = t;
    return true;
}
