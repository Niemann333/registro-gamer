// RG: BambooTracker dentro do Furnace (compatFlags.rgBT).
// O importador (fileOps/btm.cpp) põe os padrões e instrumentos na música do Furnace (para ver) e guarda o .btm
// original nas opções do YM2608 (rgBTData). Na hora de tocar, quem toca é o próprio BambooTracker
// (extern/bambootracker): a cada tique ele gera as escritas nos registradores do YM2608, e elas vão direto
// para o chip do Furnace. A memória do ADPCM também é a que o BambooTracker monta.

#include "engine.h"
#include <map>
#include "../baseutils.h"
#include "platform/ym2608.h"
#include "../../extern/bambootracker/rgbt.h"

// base64 -> bytes (o taDecodeBase64 do Furnace pula os bytes zero; aqui é binário)
static std::string rgBTDecode(const String& in) {
  std::string out;
  out.reserve(in.size()*3/4);
  unsigned int acc=0;
  int bits=0;
  for (char c: in) {
    int v;
    if (c>='A' && c<='Z') v=c-'A';
    else if (c>='a' && c<='z') v=c-'a'+26;
    else if (c>='0' && c<='9') v=c-'0'+52;
    else if (c=='+') v=62;
    else if (c=='/') v=63;
    else continue;
    acc=(acc<<6)|v;
    bits+=6;
    if (bits>=8) {
      bits-=8;
      out+=(char)((acc>>bits)&0xff);
    }
  }
  return out;
}

static DivPlatformYM2608* rgBTChip(DivEngine* e, DivSong& song, DivDispatchContainer* disCont) {
  if (song.systemLen<1) return NULL;
  if (song.system[0]!=DIV_SYSTEM_YM2608 && song.system[0]!=DIV_SYSTEM_YM2608_EXT) return NULL;
  if (disCont[0].dispatch==NULL) return NULL;
  return (DivPlatformYM2608*)disCont[0].dispatch;
}

void DivEngine::rgBTSetup() {
  DivPlatformYM2608* ym=rgBTChip(this,song,disCont);
  bool on=song.compatFlags.rgBT && ym!=NULL && !song.systemFlags[0].getString("rgBTData","").empty();
  if (ym!=NULL) ym->rgBT=on;
  rgBTOn=on;
  // memória do ADPCM já na hora (a exportação para VGM grava a memória antes de tocar)
  if (on && rgBTEnsure()) {
    size_t len=0;
    const unsigned char* mem=rgBTPlayer->dram(len);
    ym->rgBTSetMem(mem,len);
  }
}

void DivEngine::rgBTRelease() {
  if (rgBTPlayer!=NULL) {
    delete rgBTPlayer;
    rgBTPlayer=NULL;
  }
  rgBTLoaded="";
}

// carrega o .btm guardado na música (só quando mudou)
bool DivEngine::rgBTEnsure() {
  String data=song.systemFlags[0].getString("rgBTData","");
  if (data.empty()) return false;
  if (rgBTPlayer!=NULL && rgBTLoaded==data) return true;
  if (rgBTPlayer==NULL) rgBTPlayer=new rgbt::Player;
  std::string bin=rgBTDecode(data);
  std::string msg;
  if (!rgBTPlayer->load((const unsigned char*)bin.data(),bin.size(),msg)) {
    logE("BambooTracker: %s",msg.c_str());
    rgBTLoaded="";
    return false;
  }
  rgBTLoaded=data;
  return true;
}

void DivEngine::rgBTApply(void* writes) {
  std::vector<rgbt::Write>& w=*(std::vector<rgbt::Write>*)writes;
  DivPlatformYM2608* ym=rgBTChip(this,song,disCont);
  if (ym==NULL) return;
  for (rgbt::Write& i: w) {
    if (i.addr==0xffff) continue; // o chip do BambooTracker foi zerado (o Furnace já zerou o dele)
    ym->rgBTWrite(i.addr,i.val);
  }
}

void DivEngine::rgBTStart(int order, int row) {
  curOrder=order;
  curRow=row;
  prevOrder=order;
  prevRow=row;
  if (!rgBTEnsure()) return;
  std::vector<rgbt::Write> w;
  int sub=0;
  for (size_t i=0; i<song.subsong.size(); i++) {
    if (song.subsong[i]==curSubSong) sub=i;
  }
  rgBTPlayer->start(sub,order,row,w);
  DivPlatformYM2608* ym=rgBTChip(this,song,disCont);
  if (ym!=NULL) {
    size_t len=0;
    const unsigned char* mem=rgBTPlayer->dram(len);
    ym->rgBTSetMem(mem,len);
  }
  rgBTApply(&w);
}

bool DivEngine::rgBTTick() {
  if (rgBTPlayer==NULL || rgBTLoaded.empty()) return false;
  std::vector<rgbt::Write> w;
  int order=0, step=0;
  bool newStep=false, ended=false;
  bool looped=rgBTPlayer->tick(w,order,step,newStep,ended);
  rgBTApply(&w);
  if (ended) {
    shallStop=true;
    return true;
  }
  if (newStep && order>=0 && step>=0) {
    playPosLock.lock();
    prevOrder=order;
    prevRow=step;
    playPosLock.unlock();
    curOrder=order;
    curRow=step;
  }
  return looped;
}

// tempo de cada passo: o BambooTracker toca a música em silêncio uma vez (outro tocador, separado)
void DivEngine::rgBTTimestamps() {
  DivSubSong* sub=curSubSong;
  DivSongTimestamps& ts=sub->ts;
  for (int i=0; i<DIV_MAX_PATTERNS; i++) {
    if (ts.orders[i]) {
      delete[] ts.orders[i];
      ts.orders[i]=NULL;
    }
  }
  memset(ts.maxRow,0,DIV_MAX_PATTERNS);
  ts.totalTime=TimeMicros(0,0);
  ts.totalTicks=0;
  ts.totalRows=0;
  ts.isLoopDefined=true;
  ts.isLoopable=true;
  ts.loopStart.order=0;
  ts.loopStart.row=0;
  ts.loopStartTime=TimeMicros(0,0);

  String data=song.systemFlags[0].getString("rgBTData","");
  if (data.empty()) return;
  int subIdx=0;
  for (size_t i=0; i<song.subsong.size(); i++) {
    if (song.subsong[i]==sub) subIdx=i;
  }
  // a conta é cara (a música inteira em silêncio): guarda o resultado por módulo e subfaixa
  struct RGBTTiming {
    std::vector<int> ords, steps;
    std::vector<long> ticks;
    int loopOrder=0, loopStep=0;
    long total=0;
    bool loops=true;
  };
  static std::map<std::pair<size_t,int>,RGBTTiming> cache;
  std::pair<size_t,int> key(std::hash<std::string>()(data),subIdx);
  if (cache.find(key)==cache.end()) {
    if (cache.size()>16) cache.clear();
    RGBTTiming tm;
    rgbt::Player pl;
    std::string bin=rgBTDecode(data);
    std::string msg;
    if (!pl.load((const unsigned char*)bin.data(),bin.size(),msg)) return;
    pl.timing(subIdx,tm.ords,tm.steps,tm.ticks,tm.loopOrder,tm.loopStep,tm.total,tm.loops);
    cache[key]=tm;
  }
  RGBTTiming& tm=cache[key];
  std::vector<int>& ords=tm.ords;
  std::vector<int>& steps=tm.steps;
  std::vector<long>& ticks=tm.ticks;
  int loopOrder=tm.loopOrder, loopStep=tm.loopStep;
  long total=tm.total;
  bool loops=tm.loops;
  double hz=sub->hz;
  if (hz<1) hz=60;
  for (size_t i=0; i<ords.size(); i++) {
    int o=ords[i], r=steps[i];
    if (o<0 || o>=DIV_MAX_PATTERNS || r<0 || r>=DIV_MAX_ROWS) continue;
    if (ts.orders[o]==NULL) {
      ts.orders[o]=new TimeMicros[DIV_MAX_ROWS];
      for (int k=0; k<DIV_MAX_ROWS; k++) ts.orders[o][k].seconds=-1;
    }
    if (ts.orders[o][r].seconds>=0) continue;
    double t=(double)ticks[i]/hz;
    ts.orders[o][r]=TimeMicros((int)t,(int)((t-(int)t)*1000000.0));
    if (ts.maxRow[o]<r) ts.maxRow[o]=r;
    ts.totalRows++;
  }
  double t=(double)total/hz;
  ts.totalTime=TimeMicros((int)t,(int)((t-(int)t)*1000000.0));
  ts.totalTicks=total;
  ts.isLoopable=loops;
  ts.isLoopDefined=loops;
  if (loops) {
    ts.loopStart.order=loopOrder;
    ts.loopStart.row=loopStep;
    ts.loopStartTime=ts.getTimes(loopOrder,loopStep);
    if (ts.loopStartTime.seconds<0) ts.loopStartTime=TimeMicros(0,0);
  } else {
    ts.loopStartTime=ts.totalTime;
  }
  if (!ords.empty()) {
    ts.loopEnd.order=ords.back();
    ts.loopEnd.row=steps.back();
  }
}
