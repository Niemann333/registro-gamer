// Run-length coded byte stream used by the .vge module format.
//
// A run of three or more equal bytes is stored as: the byte, the marker 0x80, then the run
// length as a little-endian base-128 number whose last digit has bit 7 set. A literal 0x80 is
// stored as 0x80 0x80 (a run length of zero).
#include <cstdlib>
#include <cstring>

#include "song.h"

uint8_t *pack_init(Packer *p, uint8_t *buf, int size, bool compress)
{
    if (buf == nullptr) {
        p->size = 0x8000;
        p->buf = (uint8_t *)malloc(0x8000);
    } else {
        p->buf = buf;
        p->size = size;
    }
    p->marker = 0x80;
    p->pos = 0;
    p->prev = 0x101;
    p->count = 0;
    p->compress = compress;
    return p->buf;
}

static inline uint8_t pack_get(Packer *p)
{
    // The original reads without a bounds check; a truncated file must not crash the port.
    if (p->pos >= p->size) {
        p->pos++;
        return 0x80;
    }
    return p->buf[p->pos++];
}

uint8_t pack_read_byte(Packer *p)
{
    uint8_t b;
    if (!p->compress) {
        b = pack_get(p);
    } else if (p->count < 2) {
        b = pack_get(p);
        if (b == (uint8_t)p->marker) {
            uint8_t shift = 0;
            p->count = 0;
            for (;;) {
                uint8_t c = pack_get(p);
                p->count |= (unsigned)(c & 0x7f) << (shift & 0x1f);
                if (c & 0x80)
                    break;
                shift += 7;
            }
            if (p->count == 0) {
                b = (uint8_t)p->marker;
            } else {
                p->count--;
                b = (uint8_t)p->prev;
            }
        } else {
            p->prev = b;
        }
    } else {
        p->count--;
        b = (uint8_t)p->prev;
    }
    return b;
}

static inline void pack_grow(Packer *p)
{
    if ((unsigned)(p->size - 8) < (unsigned)p->pos) {
        p->size += 0x8000;
        p->buf = (uint8_t *)realloc(p->buf, p->size);
    }
}

void pack_write(Packer *p, unsigned value)
{
    unsigned v = value & 0xff;
    if (!p->compress) {
        p->buf[p->pos++] = (uint8_t)value;
        pack_grow(p);
    } else if (v != (unsigned)p->prev || value > 0xff) {
        if (p->count > 2) {
            p->buf[p->pos++] = (uint8_t)p->marker;
            while (p->count != 0) {
                uint8_t last = p->count < 0x80 ? 0x80 : 0;
                p->buf[p->pos++] = (uint8_t)((p->count & 0x7f) | last);
                p->count >>= 7;
            }
        }
        if (p->count == 2)
            p->buf[p->pos++] = (uint8_t)p->prev;
        if (value <= 0xff) {
            p->count = 1;
            p->buf[p->pos++] = (uint8_t)value;
            if (v == (unsigned)p->marker) {
                p->buf[p->pos++] = 0x80;
                p->prev = 0x100;
            } else {
                p->prev = (int)v;
            }
            pack_grow(p);
        }
    } else {
        p->count++;
    }
}

void pack_write_byte(Packer *p, unsigned value)
{
    pack_write(p, value & 0xff);
}

void pack_flush(Packer *p)
{
    pack_write(p, 0xffffffff);
}

void pack_write_str(Packer *p, const char *s, int len)
{
    int n = (int)strlen(s);
    for (int i = 0; i < n; i++)
        pack_write_byte(p, (uint8_t)s[i]);
    for (int i = 0; i < len - n; i++)
        pack_write_byte(p, 0);
}

void pack_read_bytes(Packer *p, void *dst, int len)
{
    uint8_t *d = (uint8_t *)dst;
    for (int i = 0; i < len; i++)
        d[i] = pack_read_byte(p);
}

void pack_write16(Packer *p, unsigned v)
{
    pack_write_byte(p, v & 0xff);
    pack_write_byte(p, v >> 8);
}

unsigned pack_read16(Packer *p)
{
    unsigned lo = pack_read_byte(p);
    unsigned hi = pack_read_byte(p);
    return lo | hi << 8;
}

void pack_write32(Packer *p, unsigned v)
{
    pack_write_byte(p, v & 0xff);
    pack_write_byte(p, v >> 8 & 0xff);
    pack_write_byte(p, v >> 16 & 0xff);
    pack_write_byte(p, v >> 24);
}

unsigned pack_read32(Packer *p)
{
    unsigned b0 = pack_read_byte(p);
    unsigned b1 = pack_read_byte(p);
    unsigned b2 = pack_read_byte(p);
    unsigned b3 = pack_read_byte(p);
    return b0 | b1 << 8 | b2 << 16 | b3 << 24;
}
