// RG: VGM Music Maker dentro do Furnace (compatFlags.rgVGMMM).
// A música continua sendo do Furnace (padrões, instrumentos, amostras: dá para ver e editar), mas quem toca é o
// tocador do próprio VGMMM (extern/vgmmm): a cada tique ele gera as escritas nos registradores do YM2612 e do
// SN76489, e elas vão direto para os chips do Furnace. Ao tocar, o módulo do VGMMM é remontado a partir da
// música do Furnace (rgVgeBuild), então as edições valem.

#include "engine.h"
#include "rgVgeMap.h"
#include "platform/genesis.h"
#include "platform/sms.h"
#include "../../extern/vgmmm/rgvge.h"

void DivEngine::rgVgeSetup() {
  bool on=song.compatFlags.rgVGMMM && song.systemLen>=2 &&
    song.system[0]==DIV_SYSTEM_YM2612 && song.system[1]==DIV_SYSTEM_SMS &&
    disCont[0].dispatch!=NULL && disCont[1].dispatch!=NULL;
  if (song.systemLen>=1 && song.system[0]==DIV_SYSTEM_YM2612 && disCont[0].dispatch!=NULL) {
    ((DivPlatformGenesis*)disCont[0].dispatch)->rgVge=on;
  }
  if (song.systemLen>=2 && song.system[1]==DIV_SYSTEM_SMS && disCont[1].dispatch!=NULL) {
    ((DivPlatformSMS*)disCont[1].dispatch)->rgVge=on;
  }
  rgVgeOn=on;
}

// comprimento do padrão: 0Dxx nas colunas de efeito a partir da quinta (posto pelo importador)
static int rgVgePatLen(DivSubSong* sub, int p) {
  int len=sub->patLen;
  for (int ch=0; ch<rgvge::CHANNELS; ch++) {
    DivPattern* pat=sub->pat[ch].getPattern(p,false);
    if (pat==NULL) continue;
    for (int row=0; row<len; row++) {
      for (int f=4; f<DIV_MAX_EFFECTS; f++) {
        if (pat->newData[row][DIV_PAT_FX(f)]==0x0d) {
          len=row+1;
          break;
        }
      }
    }
  }
  if (len<1) len=1;
  if (len>rgvge::MAX_ROWS) len=rgvge::MAX_ROWS;
  return len;
}

// o .vge original guardado na música (importação nova): carrega no VGMMM
static bool rgVgeLoadOriginal(DivConfig& f) {
  {
    String data=f.getString("rgVgeData","");
    if (!data.empty()) {
      std::string bin;
      unsigned int acc=0;
      int bits=0;
      for (char ch: data) {
        int v;
        if (ch>='A' && ch<='Z') v=ch-'A';
        else if (ch>='a' && ch<='z') v=ch-'a'+26;
        else if (ch>='0' && ch<='9') v=ch-'0'+52;
        else if (ch=='+') v=62;
        else if (ch=='/') v=63;
        else continue;
        acc=(acc<<6)|v;
        bits+=6;
        if (bits>=8) {
          bits-=8;
          bin+=(char)((acc>>bits)&0xff);
        }
      }
      if (rgvge::load((const unsigned char*)bin.data(),bin.size())==0) return true;
    }
  }
  return false;
}

void DivEngine::rgVgeBuild() {
  DivSubSong* sub=curSubSong;
  DivConfig& f=song.systemFlags[0];
  // o .vge original guardado na música (importação nova): o VGMMM toca a partir dele
  if (rgVgeLoadOriginal(f)) return;
  rgvge::clear();
  rgvge::Header h;
  rgvge::getHeader(h);
  h.fmClock=f.getInt("rgVgeFM",7600489);
  h.psgClock=f.getInt("rgVgePSG",3546894);
  h.fps=(unsigned int)round(sub->hz);
  if (h.fps<1) h.fps=50;
  h.speedEven=f.getInt("rgVgeSpeedE",sub->speeds.val[0]);
  h.speedOdd=f.getInt("rgVgeSpeedO",sub->speeds.val[sub->speeds.len>1?sub->speeds.len-1:0]);
  h.interleave=f.getInt("rgVgeInter",MAX(1,sub->speeds.len/2));
  h.sampleRate=f.getInt("rgVgeRate",22050);
  h.orderLen=MAX(1,MIN(sub->ordersLen,rgvge::MAX_ORDERS));
  h.loopPos=f.getInt("rgVgeLoop",0);
  if (h.loopPos<0 || h.loopPos>=h.orderLen) h.loopPos=0;
  h.dateCreated=f.getInt("rgVgeCreated",0);
  h.dateModified=f.getInt("rgVgeModified",0);
  h.saveCount=f.getInt("rgVgeSaves",0);
  memset(h.name,0,sizeof(h.name));
  memset(h.author,0,sizeof(h.author));
  memset(h.message,0,sizeof(h.message));
  strncpy(h.name,song.name.c_str(),64);
  strncpy(h.author,song.author.c_str(),64);
  strncpy(h.message,song.notes.c_str(),384);
  rgvge::setHeader(h);

  bool done[256];
  memset(done,0,sizeof(done));
  for (int i=0; i<h.orderLen; i++) {
    int p=sub->orders.ord[0][i]&255;
    rgvge::setOrderPattern(i,p);
    if (done[p]) continue;
    done[p]=true;
    int len=rgVgePatLen(sub,p);
    rgvge::setPatternLength(p,len);
    for (int ch=0; ch<rgvge::CHANNELS; ch++) {
      DivPattern* pat=sub->pat[ch].getPattern(sub->orders.ord[ch][i],false);
      for (int row=0; row<len; row++) {
        rgvge::Cell c;
        c.note=rgvge::NOTE_EMPTY;
        c.octave=0;
        c.volume=0;
        c.ins=0;
        for (int k=0; k<4; k++) {
          c.fx[k]=0;
          c.param[k]=0;
        }
        if (pat!=NULL) {
          short n=pat->newData[row][DIV_PAT_NOTE];
          if (n==DIV_NOTE_OFF || n==DIV_NOTE_REL || n==DIV_MACRO_REL) {
            c.note=rgvge::NOTE_OFF;
          } else if (n>=60 && n<180) {
            c.note=(n-60)%12;
            c.octave=(n-60)/12;
          }
          short v=pat->newData[row][DIV_PAT_VOL];
          if (v>=0) c.volume=rgVgeVolFromFur(ch,v);
          short in=pat->newData[row][DIV_PAT_INS];
          if (in>=0 && in<rgvge::MAX_INSTRUMENTS) c.ins=in+1;
          for (int k=0; k<4; k++) {
            short fx=pat->newData[row][DIV_PAT_FX(k)];
            if (fx<0) continue;
            unsigned char ofx, op;
            if (rgVgeFxFromFur(fx,pat->newData[row][DIV_PAT_FXVAL(k)],ofx,op)) {
              c.fx[k]=ofx;
              c.param[k]=op;
            }
          }
        }
        rgvge::setCell(p,row,ch,c);
      }
    }
  }

  // instrumentos FM do Furnace -> VGMMM (mesmo número)
  for (int i=0; i<MIN(song.insLen,(int)rgvge::MAX_INSTRUMENTS); i++) {
    DivInstrument* ins=song.ins[i];
    if (ins==NULL) continue;
    rgvge::Ins vi;
    memset(&vi,0,sizeof(vi));
    vi.alg=ins->fm.alg&7;
    vi.fb=ins->fm.fb&7;
    vi.ams=ins->fm.ams&3;
    vi.fms=ins->fm.fms&7;
    for (int j=0; j<4; j++) {
      const DivInstrumentFM::Operator& o=ins->fm.op[j];
      vi.op[j].mult=o.mult&15;
      vi.op[j].dt=(signed char)((o.dt&7)-3);
      vi.op[j].tl=o.tl&0x7f;
      vi.op[j].rs=o.rs&3;
      vi.op[j].ar=o.ar&31;
      vi.op[j].dr=(o.dr&31)|(o.am?0x80:0);
      vi.op[j].sr=o.d2r&31;
      vi.op[j].rr=o.rr&15;
      vi.op[j].sl=o.sl&15;
      vi.op[j].ssg=o.ssgEnv&15;
    }
    strncpy(vi.name,ins->name.c_str(),16);
    vi.name[16]=0;
    rgvge::setIns(i,vi);
  }
}

struct RGVgeBufs {
  std::vector<rgvge::Write> w;
  std::vector<int> dac;
};

void DivEngine::rgVgeApply(void* writes, void* dac) {
  std::vector<rgvge::Write>& w=*(std::vector<rgvge::Write>*)writes;
  std::vector<int>& d=*(std::vector<int>*)dac;
  DivPlatformGenesis* fm=(DivPlatformGenesis*)disCont[0].dispatch;
  DivPlatformSMS* psg=(DivPlatformSMS*)disCont[1].dispatch;
  for (rgvge::Write& i: w) {
    if (i.type<2) {
      fm->rgVgeWrite((i.type<<8)|i.reg,i.val);
    } else if (i.type==2) {
      psg->rgVgeWrite(i.val);
    } else if (i.type==3) {
      psg->rgVgeStereo(i.val);
    }
  }
  int rate=song.systemFlags[0].getInt("rgVgeRate",22050);
  for (int s: d) fm->rgVgeDac(s,rate);
}

void DivEngine::rgVgeStart(int order, int row) {
  rgVgeBuild();
  RGVgeBufs b;
  if (order<0 || order>=curSubSong->ordersLen) order=0;
  rgvge::start(order,row,b.w,b.dac);
  rgVgeApply(&b.w,&b.dac);
  rgVgeFirstTick=true;
  // no VGMMM o primeiro tique só vem depois de um tique de áudio (chips.cpp, audio_render)
  rgVgeWait=true;
  curOrder=order;
  curRow=row;
  prevOrder=order;
  prevRow=row;
}

bool DivEngine::rgVgeTick() {
  if (rgVgeWait) {
    rgVgeWait=false;
    return false;
  }
  RGVgeBufs b;
  int order=0, row=0;
  bool newRow=false;
  bool looped=rgvge::tick(b.w,b.dac,order,row,newRow);
  rgVgeApply(&b.w,&b.dac);
  if (newRow) {
    playPosLock.lock();
    prevOrder=order;
    prevRow=row;
    playPosLock.unlock();
    curOrder=order;
    curRow=row;
  }
  if (rgVgeFirstTick) {
    rgVgeFirstTick=false;
    return false;
  }
  return looped;
}

// tempo de cada linha contado como o VGMMM (song_calc_timing): velocidade par/ímpar e intercalação, efeito 0F
void DivEngine::rgVgeTimestamps() {
  DivSubSong* sub=curSubSong;
  DivSongTimestamps& ts=sub->ts;
  DivConfig& f=song.systemFlags[0];
  for (int i=0; i<DIV_MAX_PATTERNS; i++) {
    if (ts.orders[i]) {
      delete[] ts.orders[i];
      ts.orders[i]=NULL;
    }
  }
  memset(ts.maxRow,0,DIV_MAX_PATTERNS);
  double hz=sub->hz;
  if (hz<1) hz=50;
  unsigned int even=MAX(1,f.getInt("rgVgeSpeedE",6));
  unsigned int odd=MAX(1,f.getInt("rgVgeSpeedO",6));
  unsigned int inter=MAX(1,f.getInt("rgVgeInter",1));
  int loopPos=f.getInt("rgVgeLoop",0);
  if (loopPos<0 || loopPos>=sub->ordersLen) loopPos=0;
  bool useOdd=false;
  unsigned int count=0;
  uint64_t total=0;
  int rows=0;
  // com o original guardado, o comprimento e os 0F vêm dele (a conversão nativa marca os padrões de outro jeito)
  bool orig=rgVgeLoadOriginal(f);
  for (int o=0; o<sub->ordersLen; o++) {
    int p=sub->orders.ord[0][o];
    int len=orig?MAX(1,MIN(rgvge::MAX_ROWS,rgvge::patternLength(rgvge::orderPattern(o)))):rgVgePatLen(sub,p);
    ts.orders[o]=new TimeMicros[DIV_MAX_ROWS];
    for (int i=0; i<DIV_MAX_ROWS; i++) ts.orders[o][i].seconds=-1;
    for (int row=0; row<len; row++) {
      double t=(double)total/hz;
      ts.orders[o][row]=TimeMicros((int)t,(int)((t-(int)t)*1000000.0));
      // efeito 0F do VGMMM nesta linha (qualquer canal)
      if (orig) {
        int op=rgvge::orderPattern(o);
        for (int ch=0; ch<rgvge::CHANNELS; ch++) {
          rgvge::Cell cl;
          rgvge::getCell(op,row,ch,cl);
          for (int k=0; k<4; k++) {
            if (cl.fx[k]!=0x0f) continue;
            int v=cl.param[k];
            if ((v&0xf0)==0) {
              inter=v&15;
            } else {
              even=v>>4;
              odd=v&15;
              if (even==0) even=1;
              if ((v&15)==0) odd=1;
            }
          }
        }
      }
      for (int ch=0; ch<rgvge::CHANNELS && !orig; ch++) {
        DivPattern* pat=sub->pat[ch].getPattern(sub->orders.ord[ch][o],false);
        if (pat==NULL) continue;
        for (int k=0; k<4; k++) {
          if (pat->newData[row][DIV_PAT_FX(k)]==0x0f) {
            int v=pat->newData[row][DIV_PAT_FXVAL(k)];
            if (v<0) v=0;
            if ((v&0xf0)==0) {
              inter=v&15;
            } else {
              even=v>>4;
              odd=v&15;
              if (even==0) even=1;
              if ((v&15)==0) odd=1;
            }
          }
        }
      }
      total+=useOdd?odd:even;
      rows++;
      count++;
      if (inter<=count) {
        count=0;
        useOdd=!useOdd;
      }
    }
    ts.maxRow[o]=len-1;
  }
  double t=(double)total/hz;
  ts.totalTime=TimeMicros((int)t,(int)((t-(int)t)*1000000.0));
  ts.totalTicks=total;
  ts.totalRows=rows;
  ts.isLoopDefined=true;
  ts.isLoopable=true;
  ts.loopStart.order=loopPos;
  ts.loopStart.row=0;
  ts.loopEnd.order=MAX(0,sub->ordersLen-1);
  ts.loopEnd.row=MAX(0,ts.maxRow[ts.loopEnd.order]);
  ts.loopStartTime=ts.getTimes(loopPos,0);
}
