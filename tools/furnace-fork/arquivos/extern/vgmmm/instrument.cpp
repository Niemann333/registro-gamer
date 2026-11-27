// FM instruments: defaults and the instrument file formats the editor can read.
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "song.h"

const uint8_t g_defaultInsVgi[43] = {
    4, 0, 0,
    0, 3, 127, 0, 31, 31, 31, 15, 0, 0,
    1, 3, 15, 0, 31, 31, 8, 15, 0, 0,
    0, 3, 127, 0, 31, 31, 31, 15, 0, 0,
    1, 3, 16, 0, 31, 31, 10, 15, 0, 0,
};

void ins_clear(Instrument *ins)
{
    memset(ins, 0, sizeof(Instrument));
    memcpy(ins->name, "empty", 6);
    for (int i = 0; i < 4; i++) {
        ins->op[i].tl = 0x7f;
        ins->op[i].ar = 0x1f;
        ins->op[i].dr = 0x1f;
        ins->op[i].sr = 0x1f;
        ins->op[i].rr = 0xf;
    }
}

bool ins_is_empty(const Instrument *ins)
{
    Instrument blank;
    ins_clear(&blank);
    return memcmp(ins, &blank, sizeof(Instrument)) == 0;
}

static void ins_op_add_tl(Instrument *ins, int op, int delta)
{
    int v = ins->op[op].tl + delta;
    if (v < 0)
        v = 0;
    if (v > 0x7f)
        v = 0x7f;
    ins->op[op].tl = (uint8_t)v;
}

// Changes the level of the carrier operators of the instrument's algorithm.
void ins_change_volume(Instrument *ins, int delta)
{
    if (ins->alg == 7)
        ins_op_add_tl(ins, 0, delta);
    if (ins->alg > 4)
        ins_op_add_tl(ins, 1, delta);
    if (ins->alg > 3)
        ins_op_add_tl(ins, 2, delta);
    ins_op_add_tl(ins, 3, delta);
}

// Detune: register value (0..7) <-> signed amount (-3..3)
int dt_from_reg(int v)
{
    switch (v) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 3;
    case 5: return -1;
    case 6: return -2;
    case 7: return -3;
    default: return 0;
    }
}

int dt_to_reg(int v)
{
    switch (v) {
    case 1: return 1;
    case 2: return 2;
    case 3: return 3;
    case -3: return 7;
    case -2: return 6;
    case -1: return 5;
    default: return 0;
    }
}

// Ten bytes per operator as stored in .vgi/.tfi files.
static void op_from_tfi(Operator *op, const uint8_t *p)
{
    op->mult = p[0] & 0xf;
    op->dt = (int8_t)((p[1] & 7) - 3);
    op->tl = p[2] & 0x7f;
    op->rs = p[3] & 3;
    op->ar = p[4] & 0x1f;
    op->dr = p[5] & 0x9f;
    op->sr = p[6] & 0x1f;
    op->rr = p[7] & 0xf;
    op->sl = p[8] & 0xf;
    op->ssg = p[9] & 0xf;
}

void ins_from_vgi(Instrument *ins, const uint8_t *vgi)
{
    ins->alg = vgi[0];
    ins->fb = vgi[1];
    ins->ams = (vgi[2] >> 4) & 3;
    ins->fms = vgi[2] & 7;
    for (int i = 0; i < 4; i++)
        op_from_tfi(&ins->op[i], vgi + 3 + i * 10);
}

enum { FMT_NONE, FMT_VGI, FMT_TFI, FMT_DAT, FMT_Y12, FMT_INS, FMT_BIN };

bool ins_load(Instrument *ins, const char *filename)
{
    static const int opOrder[4] = {0, 2, 1, 3};
    char ext[3];
    size_t n = strlen(filename);
    if (n < 3)
        return false;
    memcpy(ext, filename + n - 3, 3);
    for (int i = 0; i < 3; i++)
        if (ext[i] > '@' && ext[i] < '[')
            ext[i] += ' ';
    int fmt = memcmp(ext, "vgi", 3) == 0 ? FMT_VGI : FMT_NONE;
    if (memcmp(ext, "tfi", 3) == 0) fmt = FMT_TFI;
    if (memcmp(ext, "dat", 3) == 0) fmt = FMT_DAT;
    if (memcmp(ext, "y12", 3) == 0) fmt = FMT_Y12;
    if (memcmp(ext, "ins", 3) == 0) fmt = FMT_INS;
    if (memcmp(ext, "bin", 3) == 0) fmt = FMT_BIN;

    FILE *f = fopen(filename, "rb");
    if (f == nullptr)
        return false;
    fseek(f, 0, SEEK_END);
    int size = (int)ftell(f);
    fseek(f, 0, SEEK_SET);
    switch (fmt) {
    case FMT_VGI: if (size != 0x2b) fmt = FMT_NONE; break;
    case FMT_TFI: if (size != 0x2a) fmt = FMT_NONE; break;
    case FMT_DAT: if (size != 0x34) fmt = FMT_NONE; break;
    case FMT_Y12: if (size != 0x80) fmt = FMT_NONE; break;
    case FMT_INS: if (size > 0xff) fmt = FMT_NONE; break;
    case FMT_BIN: if (size != 0x19) fmt = FMT_NONE; break;
    }
    if (fmt == FMT_NONE) {
        fclose(f);
        return false;
    }
    // zero padding so a short .ins file cannot be read out of bounds
    uint8_t *d = (uint8_t *)calloc((size_t)size + 0x200, 1);
    if (fread(d, 1, size, f) != (size_t)size) {
        fclose(f);
        free(d);
        return false;
    }
    fclose(f);

    switch (fmt) {
    case FMT_VGI:
        ins_clear(ins);
        ins_from_vgi(ins, d);
        break;
    case FMT_TFI:
        ins_clear(ins);
        ins->alg = d[0];
        ins->fb = d[1];
        for (int i = 0; i < 4; i++)
            op_from_tfi(&ins->op[i], d + 2 + i * 10);
        break;
    case FMT_DAT:       // pairs of (YM2612 register, value)
        ins_clear(ins);
        for (int i = 0; i < size; i += 2) {
            unsigned reg = d[i];
            uint8_t val = d[i + 1];
            unsigned base = reg & 0xfffffff3;
            if (base == 0x30) {
                Operator *op = &ins->op[(int)(reg - 0x30) >> 2];
                op->mult = val & 0xf;
                op->dt = (int8_t)dt_from_reg((val & 0x70) >> 4);
            } else if (base == 0x40) {
                ins->op[(int)(reg - 0x40) >> 2].tl = val & 0x7f;
            } else if (base == 0x50) {
                Operator *op = &ins->op[(int)(reg - 0x50) >> 2];
                op->ar = val & 0x1f;
                op->rs = val >> 6;
            } else if (base == 0x60) {
                ins->op[(int)(reg - 0x60) >> 2].dr = val & 0x9f;
            } else if (base == 0x70) {
                ins->op[(int)(reg - 0x70) >> 2].sr = val & 0x1f;
            } else if (base == 0x80) {
                Operator *op = &ins->op[(int)(reg - 0x80) >> 2];
                op->rr = val & 0xf;
                op->sl = val >> 4;
            } else if (reg == 0xb0) {
                ins->alg = val & 7;
                ins->fb = (val >> 3) & 7;
            }
        }
        break;
    case FMT_Y12:
        ins_clear(ins);
        for (int i = 0; i < 4; i++) {
            const uint8_t *p = d + i * 0x10;
            Operator *op = &ins->op[i];
            op->mult = p[0] & 0xf;
            op->dt = (int8_t)dt_from_reg(p[0] >> 4);
            op->tl = p[1] & 0x7f;
            op->rs = p[2] >> 6;
            op->ar = p[2] & 0x1f;
            op->dr = p[3] & 0x9f;
            op->sr = p[4] & 0x1f;
            op->rr = p[5] & 0xf;
            op->sl = p[5] >> 4;
        }
        ins->alg = d[0x40] & 7;
        ins->fb = d[0x41] & 7;
        break;
    case FMT_INS:
        if (memcmp(d, "MVSI1", 5) == 0) {
            ins_clear(ins);
            int off = 5;
            for (const uint8_t *p = d + 4; *p != 0; p++)
                off++;
            for (int i = 0; i < 4; i++) {
                int o = opOrder[i] + off;
                Operator *op = &ins->op[i];
                op->mult = d[o] & 0xf;
                op->dt = (int8_t)dt_from_reg(d[o] >> 4);
                op->tl = d[o + 4] & 0x7f;
                op->rs = d[o + 8] >> 6;
                op->ar = d[o + 8] & 0x1f;
                op->dr = d[o + 0xc] & 0x9f;
                op->sr = d[o + 0x10] & 0x1f;
                op->rr = d[o + 0x14] & 0xf;
                op->sl = d[o + 0x14] >> 4;
            }
            ins->alg = d[off + 0x18] & 7;
            ins->fb = (d[off + 0x18] >> 3) & 7;
        }
        break;
    case FMT_BIN: {
        ins_clear(ins);
        ins->alg = d[0] & 7;
        ins->fb = (d[0] >> 3) & 7;
        const uint8_t *p = d;
        for (int i = 0; i < 4; i++) {
            Operator *op = &ins->op[opOrder[i]];
            op->dt = (int8_t)dt_from_reg(p[1] >> 4);
            op->mult = p[1] & 0xf;
            op->ar = p[5] & 0x1f;
            op->rs = p[5] >> 6;
            op->dr = p[9] & 0x9f;
            op->sr = p[0xd] & 0x1f;
            op->rr = p[0x11] & 0xf;
            op->sl = p[0x11] >> 4;
            op->tl = p[0x15] & 0x7f;
            p++;
        }
        break;
    }
    }
    free(d);
    return true;
}

bool ins_save_vgi(const Instrument *ins, const char *filename)
{
    uint8_t d[43];
    d[0] = ins->alg;
    d[1] = ins->fb;
    d[2] = (uint8_t)(ins->ams << 4 | ins->fms);
    for (int i = 0; i < 4; i++) {
        const Operator *op = &ins->op[i];
        uint8_t *p = d + 3 + i * 10;
        p[0] = op->mult;
        p[1] = (uint8_t)(op->dt + 3);
        p[2] = op->tl;
        p[3] = op->rs;
        p[4] = op->ar;
        p[5] = op->dr;
        p[6] = op->sr;
        p[7] = op->rr;
        p[8] = op->sl;
        p[9] = op->ssg;
    }
    FILE *f = fopen(filename, "wb");
    if (f == nullptr)
        return false;
    fwrite(d, sizeof(d), 1, f);
    fclose(f);
    return true;
}
