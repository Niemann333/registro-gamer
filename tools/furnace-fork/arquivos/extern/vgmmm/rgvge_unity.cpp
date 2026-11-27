// RG: núcleo do VGM Music Maker (extern/vgmmm) num namespace próprio + a ponte rgvge.h
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <ctime>
#include <cstdint>
#include <cstddef>
#include <vector>
#include "rgvge.h"

namespace rgvgmmm {
#include "song.h"
#include "player.h"

// o tocador chama estas funções do chips.cpp/vgmexport.cpp do programa; aqui as escritas vão para a fila
static int rgLatch[2]={0,0};
void chips_reset(void) {}
void chips_psg2_write(uint8_t) {}
void chips_ym_write(int port, uint8_t v) {
  if (port&1) {
    regq_push((uint8_t)((port>>1)&1),(uint8_t)rgLatch[(port>>1)&1],v);
  } else {
    rgLatch[(port>>1)&1]=v;
  }
}
void vgm_put(uint8_t) {}
void vgm_put32(uint32_t) {}
int g_vgmSampleOffset[MAX_SAMPLES];
int g_vgmSampleLen[MAX_SAMPLES];

#include "pack.cpp"
#include "song.cpp"
#include "sample.cpp"
#include "instrument.cpp"
#include "player.cpp"

// song_load() lendo da memória em vez de um arquivo (mesma lógica)
static int rgSongLoadMem(const uint8_t* src, long size) {
  song_new();
  if (size<16 || (memcmp(src,"VGEfmtV3",8)!=0 && memcmp(src,"VGEfmtV2",8)!=0 && memcmp(src,"VGEfmtV1",8)!=0)) return 2;
  uint8_t* buf=(uint8_t*)malloc(size);
  if (buf==nullptr) return 3;
  memcpy(buf,src,size);
  int version=buf[7]-'0';
  int songLen=rd32(buf+8);
  int smpLen=rd32(buf+12);
  if (songLen<0 || smpLen<0 || (long)songLen+smpLen+16>size || !song_unpack(buf+16,songLen,version)) {
    song_new();
    free(buf);
    return 2;
  }
  Packer pk;
  pack_init(&pk,buf+16+songLen,smpLen,true);
  for (int i=0; i<MAX_SAMPLES; i++) {
    sample_data_free(i);
    g_sampleData[i].rawLen=(int)pack_read32(&pk);
    g_sampleData[i].rate=(int)pack_read16(&pk);
    g_sampleData[i].bits=pack_read_byte(&pk);
  }
  long off=16L+songLen+smpLen;
  for (int i=0; i<MAX_SAMPLES; i++) {
    SampleData* d=&g_sampleData[i];
    if (d->rawLen!=0) {
      if (d->rawLen<0 || off+d->rawLen>size) {
        d->rawLen=0;
        continue;
      }
      d->raw=(uint8_t*)malloc(d->rawLen);
      memcpy(d->raw,buf+off,d->rawLen);
      off+=d->rawLen;
    }
  }
  free(buf);
  samples_convert_all();
  return 0;
}

static std::vector<int>* rgDacOut=nullptr;
static void rgDacEvent(int s) {
  if (rgDacOut) rgDacOut->push_back(s);
}
static bool rgInit=false;
static void rgEnsureInit() {
  if (rgInit) return;
  rgInit=true;
  tables_init();
  sample_data_init();
  psg_env_init();
  g_rgDacHook=rgDacEvent;
}
static void rgFlush(std::vector<rgvge::Write>& out) {
  for (int i=0; i<g_regqCount; i++) {
    rgvge::Write w;
    w.type=g_regq[i].type;
    w.reg=g_regq[i].reg;
    w.val=g_regq[i].val;
    out.push_back(w);
  }
  g_regqCount=0;
  g_regqRead=0;
}
}

using namespace rgvgmmm;

namespace rgvge {

int load(const unsigned char* buf, size_t len) {
  rgEnsureInit();
  if (P.playing) player_stop();
  return rgSongLoadMem(buf,(long)len);
}

void clear() {
  rgEnsureInit();
  if (P.playing) player_stop();
  song_new();
}

static void cpyStr(char* dst, const char* src, int n) {
  memcpy(dst,src,n);
  dst[n]=0;
}

void getHeader(Header& h) {
  h.fmClock=g_song.fmClock;
  h.psgClock=g_song.psgClock;
  h.fps=g_song.fps;
  h.speedEven=g_song.speedEven;
  h.speedOdd=g_song.speedOdd;
  h.interleave=g_song.interleave;
  h.sampleRate=g_song.sampleRate;
  h.orderLen=g_song.orderLen;
  h.loopPos=g_song.loopPos;
  cpyStr(h.name,g_song.name,0x40);
  cpyStr(h.author,g_song.author,0x40);
  cpyStr(h.message,g_song.message,0x180);
  h.dateCreated=g_song.dateCreated;
  h.dateModified=g_song.dateModified;
  h.saveCount=g_song.saveCount;
}

void setHeader(const Header& h) {
  g_song.fmClock=h.fmClock;
  g_song.psgClock=h.psgClock;
  g_song.fps=h.fps;
  g_song.speedEven=h.speedEven;
  g_song.speedOdd=h.speedOdd;
  g_song.interleave=h.interleave;
  g_song.sampleRate=h.sampleRate;
  g_song.orderLen=(uint16_t)h.orderLen;
  g_song.loopPos=(uint16_t)h.loopPos;
  memcpy(g_song.name,h.name,0x40);
  memcpy(g_song.author,h.author,0x40);
  memcpy(g_song.message,h.message,0x180);
  g_song.dateCreated=h.dateCreated;
  g_song.dateModified=h.dateModified;
  g_song.saveCount=h.saveCount;
}

int orderPattern(int i) {
  return g_song.order[i&255].pattern;
}
void setOrderPattern(int i, int p) {
  g_song.order[i&255].pattern=(uint8_t)p;
}
int patternLength(int p) {
  return g_song.pattern[p&255].length;
}
void setPatternLength(int p, int len) {
  g_song.pattern[p&255].length=len;
}

void getCell(int p, int row, int ch, Cell& c) {
  const rgvgmmm::Cell& s=g_song.pattern[p&255].cell[row&255][ch%CHANNELS];
  c.note=s.note;
  c.octave=s.octave;
  c.volume=s.volume;
  for (int i=0; i<4; i++) {
    c.fx[i]=s.fx[i];
    c.param[i]=s.param[i];
  }
  c.ins=s.ins;
}
void setCell(int p, int row, int ch, const Cell& c) {
  rgvgmmm::Cell& s=g_song.pattern[p&255].cell[row&255][ch%CHANNELS];
  s.note=c.note;
  s.octave=c.octave;
  s.volume=c.volume;
  for (int i=0; i<4; i++) {
    s.fx[i]=c.fx[i];
    s.param[i]=c.param[i];
  }
  s.ins=c.ins;
}

bool insEmpty(int i) {
  return ins_is_empty(&g_song.ins[i%MAX_INSTRUMENTS]);
}
void getIns(int i, Ins& ins) {
  const Instrument& s=g_song.ins[i%MAX_INSTRUMENTS];
  for (int j=0; j<4; j++) {
    ins.op[j].mult=s.op[j].mult;
    ins.op[j].dt=s.op[j].dt;
    ins.op[j].tl=s.op[j].tl;
    ins.op[j].rs=s.op[j].rs;
    ins.op[j].ar=s.op[j].ar;
    ins.op[j].dr=s.op[j].dr;
    ins.op[j].sr=s.op[j].sr;
    ins.op[j].rr=s.op[j].rr;
    ins.op[j].sl=s.op[j].sl;
    ins.op[j].ssg=s.op[j].ssg;
  }
  ins.alg=s.alg;
  ins.fb=s.fb;
  ins.ams=s.ams;
  ins.fms=s.fms;
  cpyStr(ins.name,s.name,16);
}
void setIns(int i, const Ins& ins) {
  Instrument& s=g_song.ins[i%MAX_INSTRUMENTS];
  for (int j=0; j<4; j++) {
    s.op[j].mult=ins.op[j].mult;
    s.op[j].dt=ins.op[j].dt;
    s.op[j].tl=ins.op[j].tl;
    s.op[j].rs=ins.op[j].rs;
    s.op[j].ar=ins.op[j].ar;
    s.op[j].dr=ins.op[j].dr;
    s.op[j].sr=ins.op[j].sr;
    s.op[j].rr=ins.op[j].rr;
    s.op[j].sl=ins.op[j].sl;
    s.op[j].ssg=ins.op[j].ssg;
  }
  s.alg=ins.alg;
  s.fb=ins.fb;
  s.ams=ins.ams;
  s.fms=ins.fms;
  memcpy(s.name,ins.name,16);
  s.name[16]=0;
}

const unsigned char* sampleData(int i, int& len) {
  len=0;
  int idx=g_song.sample[i%MAX_SAMPLES].data;
  if (idx<0 || idx>=MAX_SAMPLES) return NULL;
  SampleData* d=&g_sampleData[idx];
  if (d->conv==nullptr) return NULL;
  // o tocador para no primeiro 0x80 (fim da amostra)
  int n=0;
  while (n<d->convLen && d->conv[n]!=0x80) n++;
  len=n;
  return d->conv;
}
const char* sampleName(int i) {
  return g_song.sample[i%MAX_SAMPLES].name;
}

void start(int order, int row, std::vector<Write>& out, std::vector<int>& dac) {
  rgEnsureInit();
  if (P.playing) player_stop();
  song_calc_timing();
  rgDacOut=&dac;
  player_start(order,row,0,0,0,-1);
  rgFlush(out);
  rgDacOut=nullptr;
}

bool tick(std::vector<Write>& out, std::vector<int>& dac, int& order, int& row, bool& newRow) {
  newRow=(P.tick==0);
  order=P.order;
  row=P.row;
  rgDacOut=&dac;
  int looped=player_tick(false);
  rgFlush(out);
  rgDacOut=nullptr;
  return looped!=0;
}

bool playing() {
  return P.playing!=0;
}

}
