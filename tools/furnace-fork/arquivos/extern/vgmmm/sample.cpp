// PCM samples: WAV import and conversion to the 8-bit stream the YM2612 DAC plays.
//
// The floating-point code mirrors the original x87 arithmetic (extended-precision
// intermediates, results rounded when stored to float) so converted data is bit-identical.
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "song.h"

typedef long double ld;

void sample_data_init(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++) {
        g_sampleData[i].raw = nullptr;
        g_sampleData[i].conv = nullptr;
    }
}

void sample_data_free(int idx)
{
    SampleData *d = &g_sampleData[idx];
    if (d->raw != nullptr) {
        free(d->raw);
        d->raw = nullptr;
    }
    if (d->conv != nullptr) {
        free(d->conv);
        d->conv = nullptr;
    }
}

// Frees sample data no sample slot refers to any more.
void sample_data_gc(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++) {
        bool unused = true;
        for (int j = 0; j < MAX_SAMPLES; j++) {
            if (g_song.sample[j].data == i) {
                unused = false;
                break;
            }
        }
        if (unused)
            sample_data_free(i);
    }
}

int sample_data_find_free(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++)
        if (g_sampleData[i].raw == nullptr)
            return i;
    return -1;
}

void sample_clear(Sample *s)
{
    memset(s, 0, sizeof(Sample));
    memcpy(s->name, "empty", 6);
    s->volume = 0x80;
    s->data = -1;
    sample_data_gc();
}

bool sample_is_empty(const Sample *s)
{
    if (s->data < 0)
        return true;
    return g_sampleData[s->data].raw == nullptr;
}

void samples_clear_all(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++)
        sample_clear(&g_song.sample[i]);
}

static inline uint8_t dac_byte(ld v)
{
    int o = (int)v + 0x80;
    if (o < 0)
        o = 0;
    if (o > 0xff)
        o = 0xff;
    if (o == 0x80)          // 0x80 is the end-of-sample marker
        o = 0x81;
    return (uint8_t)o;
}

void sample_convert(Sample *s)
{
    int idx = s->data;
    if (idx < 0)
        return;
    SampleData *d = &g_sampleData[idx];
    if (d->raw == nullptr)
        return;
    if (d->conv != nullptr) {
        free(d->conv);
        d->conv = nullptr;
    }
    int srcLen = d->rawLen;
    if (d->bits == 0x10)
        srcLen /= 2;
    const ld k255 = (ld)(1.0 / 255.0);
    ld r;
    if (s->tune < 0)
        r = (ld)d->rate / ((ld)2.0 - k255 * ((ld)s->tune + (ld)255.0));
    else
        r = (k255 * (ld)s->tune + (ld)1.0) * (ld)d->rate;
    float rate = (float)r;
    int dstLen;
    if ((ld)(int)g_song.sampleRate == (ld)rate)
        dstLen = srcLen;
    else
        dstLen = (int)((ld)(int)g_song.sampleRate * ((ld)srcLen / (ld)rate));
    if (dstLen < 0)
        dstLen = 0;
    uint8_t *dst = (uint8_t *)malloc((size_t)dstLen + 1);
    memset(dst, 0, (size_t)dstLen + 1);
    int count = 0;
    float vol = (float)((ld)s->volume * (ld)0.0078125);
    const uint8_t *raw = d->raw;
    float a = 0.0f, b = 0.0f;
    if ((int)(ld)rate == (int)g_song.sampleRate) {
        const uint8_t *p8 = raw;
        const uint8_t *p16 = raw;
        for (int i = 0; i < srcLen; i++) {
            if (d->bits == 8) {
                a = (float)(((ld)*p8 - (ld)128.0) * (ld)0.00390625);
                p16 += 2;
                p8 += 1;
            } else if (d->bits == 0x10) {
                a = (float)((ld)(int16_t)rd16(p16) * (ld)1.52587890625e-05);
                p16 += 2;
                p8 += 1;
            }
            dst[count++] = dac_byte((ld)a * (ld)vol * (ld)255.0);
        }
    } else {
        float outRate = (float)(int)g_song.sampleRate;
        float pos = 0.0f;
        for (int i = 0; i < dstLen; i++) {
            int ip = (int)(ld)pos;
            if (d->rawLen - 1 <= ip) {
                ip = d->rawLen - 2;
                pos = (float)ip;
            }
            if (ip < 0)
                ip = 0;
            if (d->bits == 8) {
                a = (float)(((ld)raw[ip] - (ld)128.0) * (ld)0.00390625);
                b = (float)(((ld)raw[ip + 1] - (ld)128.0) * (ld)0.00390625);
            } else if (d->bits == 0x10) {
                // The original clamps 16-bit positions with the byte length, so the interpolation
                // partner of the last sample lies past the buffer; treat that as silence.
                int o = ip * 2;
                a = o + 1 < d->rawLen ? (float)((ld)(int16_t)rd16(raw + o) * (ld)1.52587890625e-05) : 0.0f;
                b = o + 3 < d->rawLen ? (float)((ld)(int16_t)rd16(raw + o + 2) * (ld)1.52587890625e-05) : 0.0f;
            }
            ip = (int)(ld)pos;
            a = (float)(((ld)b - (ld)a) * ((ld)pos - (ld)ip) + (ld)a);
            pos = (float)((ld)rate / (ld)outRate + (ld)pos);
            dst[count++] = dac_byte((ld)a * (ld)vol * (ld)255.0);
        }
    }
    dst[count] = 0x80;
    d->conv = dst;
    d->convLen = count + 1;
}

void samples_convert_all(void)
{
    for (int i = 0; i < MAX_SAMPLES; i++)
        sample_convert(&g_song.sample[i]);
}

static int find_tag(const uint8_t *buf, int from, int size, const char *tag, int len)
{
    for (int i = from; i < size - 4; i++)
        if (i + len <= size && memcmp(buf + i, tag, len) == 0)
            return i;
    return -1;
}

bool sample_load_wav(Sample *s, const char *filename, char *error)
{
    int slot = sample_data_find_free();
    if (slot < 0)
        return false;
    FILE *f = fopen(filename, "rb");
    if (f == nullptr)
        return false;
    fseek(f, 0, SEEK_END);
    int size = (int)ftell(f);
    if (size >= 0x100000) {
        strcpy(error, "File is too big.");
        fclose(f);
        return false;
    }
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = (uint8_t *)malloc(size > 0 ? size : 1);
    if (buf == nullptr) {
        fclose(f);
        return false;
    }
    if (fread(buf, 1, size, f) != (size_t)size)
        size = 0;
    fclose(f);

    int pos = find_tag(buf, 0, size, "RIFF", 4);
    if (pos < 0) {
        strcpy(error, "RIFF chunk is not found.");
        free(buf);
        return false;
    }
    pos = find_tag(buf, pos, size, "WAVEfmt ", 8);
    if (pos < 0 || pos + 0x1c > size) {
        strcpy(error, "WAVEfmt chunk is not found.");
        free(buf);
        return false;
    }
    if (rd16(buf + pos + 0xc) != 1) {
        strcpy(error, "Only unpacked PCM is supported.");
        free(buf);
        return false;
    }
    if (rd16(buf + pos + 0xe) != 1) {
        strcpy(error, "Only mono files are supported.");
        free(buf);
        return false;
    }
    int rate = rd32(buf + pos + 0x10);
    int bits = rd16(buf + pos + 0x1a);
    if (bits != 8 && bits != 0x10) {
        strcpy(error, "Only 8/16bit PCM are supported.");
        free(buf);
        return false;
    }
    pos = find_tag(buf, pos + 0x1c, size, "data", 4);
    if (pos < 0 || pos + 8 > size) {
        strcpy(error, "DATA chunk is not found.");
        free(buf);
        return false;
    }
    int len = rd32(buf + pos + 4);
    if (len < 0 || len > size - (pos + 8))      // a lying header must not overrun the file
        len = size - (pos + 8);
    SampleData *d = &g_sampleData[slot];
    s->data = slot;
    s->volume = 0x80;
    s->tune = 0;
    d->rawLen = len;
    d->bits = bits;
    d->rate = rate;
    d->raw = (uint8_t *)malloc(len > 0 ? len : 1);
    memcpy(d->raw, buf + pos + 8, len);
    free(buf);
    sample_convert(s);
    return true;
}

bool sample_copy(const Sample *src, Sample *dst)
{
    if (src->data < 0)
        return false;
    int slot = sample_data_find_free();
    if (slot < 0)
        return false;
    dst->data = slot;
    dst->volume = src->volume;
    memcpy(dst->name, src->name, 0x11);
    SampleData *from = &g_sampleData[src->data];
    SampleData *to = &g_sampleData[slot];
    to->rawLen = from->rawLen;
    to->rate = from->rate;
    to->bits = from->bits;
    to->raw = (uint8_t *)malloc(to->rawLen > 0 ? to->rawLen : 1);
    memcpy(to->raw, from->raw, from->rawLen);
    sample_convert(dst);
    return true;
}

int samples_total_size(void)
{
    int total = 0;
    for (int i = 0; i < MAX_SAMPLES; i++) {
        int idx = g_song.sample[i].data;
        if (idx >= 0 && g_sampleData[idx].raw != nullptr && g_sampleData[idx].conv != nullptr)
            total += g_sampleData[idx].convLen + 2;
    }
    return total;
}
