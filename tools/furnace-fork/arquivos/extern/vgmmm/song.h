// Song data model of VGM Music Maker 1.1.
//
// The layout of Song mirrors the original program's memory image byte for byte (the original
// keeps these tables in consecutive globals and occasionally reads across their borders, e.g.
// "instrument 0" reads the tail of the last pattern), so the structs must not be reordered.
#pragma once
#include <cstddef>
#include <cstdint>

enum {
    CHANNELS = 10,          // 6 FM + 3 PSG tone + 1 PSG noise
    FM_CHANNELS = 6,
    MAX_ROWS = 256,
    MAX_PATTERNS = 256,
    MAX_ORDERS = 256,
    MAX_INSTRUMENTS = 255,
    MAX_SAMPLES = 255,
    NOTE_EMPTY = 0xff,
    NOTE_OFF = 0xfe,
};

struct Cell {
    int16_t note;           // 0..11 semitone, NOTE_OFF, NOTE_EMPTY
    int8_t octave;
    int8_t volume;          // 0 = none, 1..31
    uint8_t fx[4];          // effect type per effect column
    uint8_t param[4];       // effect parameter per effect column
    int16_t ins;            // 0 = none, else instrument number + 1
};

struct Pattern {
    Cell cell[MAX_ROWS][CHANNELS];
    int32_t length;
};

struct Operator {
    uint8_t mult;
    int8_t dt;              // -3..3
    uint8_t tl;
    uint8_t rs;
    uint8_t ar;
    uint8_t dr;             // bit 7 = AM enable
    uint8_t sr;
    uint8_t rr;
    uint8_t sl;
    uint8_t ssg;
};

struct Instrument {
    Operator op[4];
    uint8_t alg;
    uint8_t fb;
    uint8_t ams;
    uint8_t fms;
    char name[17];
};

struct Sample {
    int32_t data;           // index into g_sampleData, -1 = none
    uint8_t volume;         // 0x80 = 100%
    int32_t tune;
    char name[17];
};

struct Order {
    uint8_t pattern;
    uint8_t speedEven;      // speeds in effect at the start of this position (song_calc_timing)
    uint8_t speedOdd;
    uint8_t interleave;
    int32_t startTick;
};

struct Song {
    Pattern pattern[MAX_PATTERNS];
    Instrument ins[MAX_INSTRUMENTS];
    Sample sample[MAX_SAMPLES];
    Order order[MAX_ORDERS];
    uint16_t orderLen;
    uint16_t loopPos;
    uint32_t fmClock;
    uint32_t psgClock;
    uint32_t fps;
    uint32_t speedEven;
    uint32_t speedOdd;
    uint32_t interleave;
    uint32_t sampleRate;
    char name[0x40];
    char author[0x40];
    char message[0x180];
    uint16_t dateCreated;
    uint16_t dateModified;
    uint16_t saveCount;
    uint16_t pad;
};

static_assert(sizeof(Cell) == 14, "Cell layout");
static_assert(sizeof(Pattern) == 0x8c04, "Pattern layout");
static_assert(sizeof(Instrument) == 0x3d, "Instrument layout");
static_assert(sizeof(Sample) == 0x20, "Sample layout");
static_assert(offsetof(Song, ins) == 0x8c0400, "Song layout");
static_assert(offsetof(Song, sample) == 0x8c40c4, "Song layout");
static_assert(offsetof(Song, order) == 0x8c60a4, "Song layout");
static_assert(offsetof(Song, orderLen) == 0x8c68a4, "Song layout");
static_assert(offsetof(Song, fmClock) == 0x8c68a8, "Song layout");
static_assert(sizeof(Song) == 0x8c6acc, "Song layout");

struct SampleData {
    uint8_t *raw;           // WAV data as loaded (8 or 16 bit mono)
    uint8_t *conv;          // unsigned 8-bit at the module's sample rate, 0x80-terminated
    int32_t rawLen;         // bytes
    int32_t rate;
    int32_t bits;
    int32_t convLen;
};

extern Song g_song;
extern SampleData g_sampleData[MAX_SAMPLES];
extern bool g_defaultInstrument;        // put a default instrument into slot 0 of a new module
extern uint16_t (*g_dateNow)(void);     // packed current date; replaceable for tests

// Instrument N as the player addresses it (1-based; 0 and -1 deliberately alias pattern memory).
inline Instrument *ins_ptr(int n)
{
    return (Instrument *)((uint8_t *)g_song.ins + (ptrdiff_t)(n - 1) * (ptrdiff_t)sizeof(Instrument));
}

// ---- pack.cpp: RLE stream used inside .vge files
struct Packer {
    uint8_t *buf;
    int marker;
    int prev;
    unsigned count;
    int size;
    int pos;
    bool compress;
};
uint8_t *pack_init(Packer *p, uint8_t *buf, int size, bool compress);
uint8_t pack_read_byte(Packer *p);
void pack_write(Packer *p, unsigned value);     // value > 0xff flushes a pending run
void pack_write_byte(Packer *p, unsigned value);
void pack_flush(Packer *p);
void pack_write_str(Packer *p, const char *s, int len);
void pack_read_bytes(Packer *p, void *dst, int len);
void pack_write16(Packer *p, unsigned v);
unsigned pack_read16(Packer *p);
void pack_write32(Packer *p, unsigned v);
unsigned pack_read32(Packer *p);

// ---- song.cpp
uint16_t date_now(void);
void date_to_str(char *dst, unsigned date);     // "dd.mm.yy" or "--.--.--"
void pattern_clear(int pat);
void song_new(void);                            // everything
void song_clear(void);                          // song data only, keeps instruments and samples
uint8_t *song_pack(int *outLen);                 // malloc'ed image of the whole module (undo snapshots)
bool song_unpack(uint8_t *buf, int len, int version);
bool song_save(const char *filename);
int song_load(const char *filename);            // 0 ok, 1 can't open, 2 wrong format, 3 no memory
int song_calc_timing(void);                     // fills Order speed/startTick, returns length in ticks
int song_position_tick(int order, int row);

int ins_find_empty(void);
int sample_find_empty(void);
void ins_swap_refs(int a, int b);
void sample_swap_refs(unsigned a, unsigned b);
int cleanup_unused_instruments(void);
void rearrange_instruments(void);
void pattern_swap(unsigned a, unsigned b);
void rearrange_patterns(void);
bool order_delete(int pos);
bool order_insert(int pos, int mode);           // 0 same pattern, 1 new empty, 2 copy of next
bool order_swap(int a, int b);
void pattern_expand(int pat);
void pattern_shrink(int pat);

// ---- instrument.cpp
void ins_clear(Instrument *ins);
bool ins_is_empty(const Instrument *ins);
void ins_change_volume(Instrument *ins, int delta);
void ins_from_vgi(Instrument *ins, const uint8_t *vgi);
bool ins_load(Instrument *ins, const char *filename);   // .vgi .tfi .dat .y12 .ins .bin
bool ins_save_vgi(const Instrument *ins, const char *filename);
int dt_from_reg(int v);
int dt_to_reg(int v);
extern const uint8_t g_defaultInsVgi[43];

// ---- sample.cpp
void sample_data_init(void);
void sample_data_free(int idx);
void sample_data_gc(void);
int sample_data_find_free(void);
void sample_clear(Sample *s);
bool sample_is_empty(const Sample *s);
void samples_clear_all(void);
void sample_convert(Sample *s);
void samples_convert_all(void);
bool sample_load_wav(Sample *s, const char *filename, char *error);
bool sample_copy(const Sample *src, Sample *dst);
int samples_total_size(void);

inline int rd16(const uint8_t *p) { return p[0] + p[1] * 0x100; }
inline int rd32(const uint8_t *p) { return (int)(p[0] + p[1] * 0x100u + p[2] * 0x10000u + p[3] * 0x1000000u); }
inline void wr32(uint8_t *p, unsigned v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
