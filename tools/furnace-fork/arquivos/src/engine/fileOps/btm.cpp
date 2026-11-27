/**
 * Furnace Tracker - multi-system chiptune tracker
 * Copyright (C) 2021-2026 tildearrow and contributors
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// RG: importador de módulos do BambooTracker (.btm).
// O arquivo é lido pelo próprio código do BambooTracker (extern/bambootracker). A música vira YM2608 (ou YM2608
// com o FM3 estendido) com os padrões e instrumentos do módulo, para ver no Furnace; o .btm original fica
// guardado (rgBTData) e o tocador do BambooTracker toca (rgBT.cpp), então o som sai igual ao do programa.

#include "fileOpsCommon.h"
#include "../../baseutils.h"
#include "../../../extern/bambootracker/rgbt.h"

// efeito do BambooTracker -> código parecido do Furnace (só para mostrar; quem toca é o BambooTracker)
static bool rgBTFx(const char* id, int v, int src, short& fx, short& val) {
  if (!id[0] || v<0) {
    if (!id[0]) return false;
  }
  val=(v<0)?0:(v&0xff);
  char a=id[0], b=id[1];
  if (a=='0') {
    switch (b) {
      case '0': case '1': case '2': case '3': case '4': case '7': case 'A': case 'B': case 'D':
        fx=(b>='A')?(b-'A'+10):(b-'0');
        return true;
      case '8': // 01 direita, 02 esquerda, 03 centro
        fx=0x08;
        val=((v&2)?0xf0:0)|((v&1)?0x0f:0);
        return true;
      case 'C': fx=0xff; val=0; return true; // fim da música
      case 'F': fx=(v<0x20)?0x0f:0xf0; return true; // velocidade / tempo
      case 'G': fx=0xed; return true; // atraso da nota
      case 'H': fx=0x29; return true; // envelope automático (SSG)
      case 'I': fx=0x24; return true; // período do envelope (alto)
      case 'J': fx=0x23; return true; // período do envelope (baixo)
      case 'K': fx=0x0c; val=v&15; return true; // repetição
      case 'O': fx=0x09; return true; // groove
      case 'P': fx=0xe5; return true; // afinação (80 = centro)
      case 'Q': fx=0xe1; return true; // nota sobe
      case 'R': fx=0xe2; return true; // nota desce
      case 'S': fx=0xec; return true; // soltura da nota
      case 'V':
        if (src==rgbt::RHYTHM) { fx=0x1f; return true; } // volume geral do ritmo
        fx=0x20; // tom/ruído do SSG
        return true;
      case 'W': fx=0x21; return true; // altura do ruído
      default: return false;
    }
  }
  if (a=='E' && b=='S') { fx=0xec; return true; } // corte
  if (a=='F' && b=='B') { fx=0x11; return true; } // feedback
  if (a=='T' && b>='1' && b<='4') { fx=0x12+(b-'1'); return true; } // nível do operador
  if (a=='M' && b=='L') { fx=0x16; return true; } // multiplicador (xy)
  if (a=='R' && b=='R') { fx=0x52; return true; } // soltura do operador (xy)
  return false;
}

bool DivEngine::loadBTM(unsigned char* file, size_t len) {
  rgbt::Player pl;
  std::string msg;
  if (!pl.load(file,len,msg)) {
    lastError=String(_("invalid BambooTracker module: "))+msg;
    delete[] file;
    return false;
  }

  DivSong ds;
  ds.version=DIV_ENGINE_VERSION;
  ds.name=pl.title();
  ds.author=pl.author();
  ds.notes=pl.comment();
  if (!pl.copyright().empty()) {
    if (!ds.notes.empty()) ds.notes+="\n\n";
    ds.notes+=pl.copyright();
  }

  int songs=MAX(1,pl.songCount());
  bool ext=false;
  for (int s=0; s<songs; s++) {
    if (pl.songExtended(s)) ext=true;
  }
  ds.systemName="NEC PC-98 (YM2608)";
  ds.systemLen=1;
  ds.system[0]=ext?DIV_SYSTEM_YM2608_EXT:DIV_SYSTEM_YM2608;
  ds.systemFlags[0].set("clockSel",1); // 7,9872 MHz, como no BambooTracker
  ds.compatFlags.rgBT=true;
  ds.compatFlags.loopModality=2;
  // mixagem do BambooTracker (tipo de mixer do módulo, como a janela principal dele aplica), medida contra o WAV
  // do próprio BambooTracker: FM/ritmo/ADPCM 1,17x e SSG 1,59x mais altos no Furnace com SSG a 0 dB
  {
    double fmDb=0, ssgDb=0;
    switch (pl.mixerType()) {
      case 1: fmDb=pl.mixerFM(); ssgDb=pl.mixerSSG(); break;
      case 2: ssgDb=-5.5; break;
      case 3: ssgDb=-3.0; break;
      case 4: ssgDb=1.5; break;
      case 5: ssgDb=2.5; break;
      default: break;
    }
    ds.systemVol[0]=0.855f;
    ds.systemFlags[0].set("fmVol",(int)round(256.0*pow(10.0,fmDb/20.0)));
    ds.systemFlags[0].set("ssgVol",(int)round(94.0*pow(10.0,ssgDb/20.0)));
  }
  // o .btm original (o BambooTracker toca a partir dele)
  ds.systemFlags[0].set("rgBTData",taEncodeBase64(std::string((const char*)file,len)));

  int maxIns=-1;
  for (int s=0; s<songs; s++) {
    if (s>0) ds.subsong.push_back(new DivSubSong);
    DivSubSong* sub=ds.subsong[s];
    sub->name=pl.songTitle(s);
    sub->hz=MAX(1,pl.tickFrequency());
    sub->speeds.val[0]=MAX(1,pl.songSpeed(s));
    sub->speeds.len=1;
    int ords=MIN(pl.orderSize(s),DIV_MAX_PATTERNS);
    sub->ordersLen=MAX(1,ords);
    int patLen=1;
    for (int o=0; o<ords; o++) patLen=MAX(patLen,pl.patternSize(s,o));
    patLen=MIN(patLen,DIV_MAX_ROWS);
    sub->patLen=patLen;

    std::vector<rgbt::Track> tracks=pl.songTracks(s);
    bool songExt=pl.songExtended(s);
    for (size_t t=0; t<tracks.size(); t++) {
      // canal do Furnace para esta pista
      int ch=(int)t;
      if (ext && !songExt && t>=3) ch=(int)t+3;
      if (ch>=DIV_MAX_CHANS) continue;
      for (int o=0; o<ords; o++) {
        int pi=pl.patternIndex(s,(int)t,o);
        if (pi<0 || pi>=DIV_MAX_PATTERNS) continue;
        sub->orders.ord[ch][o]=pi;
        DivPattern* pat=sub->pat[ch].getPattern(pi,true);
        int plen=MIN(pl.patternSize(s,o),patLen);
        for (int r=0; r<plen; r++) {
          rgbt::Step st;
          pl.getStep(s,(int)t,o,r,st);
          if (st.note>=0) {
            int n=60+st.note;
            if (n<180) pat->newData[r][DIV_PAT_NOTE]=n;
          } else if (st.note==-2 || st.note==-7) {
            pat->newData[r][DIV_PAT_NOTE]=DIV_NOTE_OFF;
          }
          if (st.ins>=0) {
            pat->newData[r][DIV_PAT_INS]=st.ins;
            if (st.ins>maxIns) maxIns=st.ins;
          }
          if (st.vol>=0) {
            // volume do FM no BambooTracker é atenuação (00 = máximo)
            pat->newData[r][DIV_PAT_VOL]=(tracks[t].source==rgbt::FM)?(0x7f-MIN(st.vol,0x7f)):st.vol;
          }
          for (int k=0; k<4; k++) {
            short fx, val;
            if (rgBTFx(st.fx[k].id,st.fx[k].value,tracks[t].source,fx,val)) {
              pat->newData[r][DIV_PAT_FX(k)]=fx;
              pat->newData[r][DIV_PAT_FXVAL(k)]=val;
            }
          }
        }
        // padrão mais curto: 0D00 na quinta coluna do primeiro canal
        if (t==0 && plen<patLen && plen>0) {
          pat->newData[plen-1][DIV_PAT_FX(4)]=0x0d;
          pat->newData[plen-1][DIV_PAT_FXVAL(4)]=0;
        }
      }
    }
    for (int ch=0; ch<DIV_MAX_CHANS; ch++) sub->pat[ch].effectCols=4;
    sub->pat[0].effectCols=5;
  }

  // instrumentos (mesmo número do BambooTracker)
  std::vector<rgbt::InsInfo> insList=pl.instruments();
  for (auto& i: insList) maxIns=MAX(maxIns,i.number);
  // DT do registrador (0..7) -> DT do Furnace (3 = 0)
  const int dtFromReg[8]={3,4,5,6,3,2,1,0};
  for (int n=0; n<=maxIns; n++) {
    DivInstrument* ins=new DivInstrument;
    ins->type=DIV_INS_FM;
    for (auto& i: insList) {
      if (i.number!=n) continue;
      ins->name=i.name;
      if (i.type==0) {
        ins->type=DIV_INS_FM;
        ins->fm.alg=i.alg&7;
        ins->fm.fb=i.fb&7;
        for (int o=0; o<4; o++) {
          DivInstrumentFM::Operator& op=ins->fm.op[o];
          op.ar=i.ar[o]&31;
          op.dr=i.dr[o]&31;
          op.d2r=i.sr[o]&31;
          op.rr=i.rr[o]&15;
          op.sl=i.sl[o]&15;
          op.tl=i.tl[o]&127;
          op.rs=i.ks[o]&3;
          op.mult=i.ml[o]&15;
          op.dt=dtFromReg[i.dt[o]&7];
          op.ssgEnv=(i.ssgeg[o]<0)?0:(8|(i.ssgeg[o]&7));
          op.enable=i.opOn[o];
        }
      } else if (i.type==1) {
        ins->type=DIV_INS_AY;
      } else {
        ins->type=DIV_INS_ADPCMB;
      }
    }
    ds.ins.push_back(ins);
  }
  ds.insLen=ds.ins.size();

  // amostras do ADPCM (para ver; a memória do chip é a que o BambooTracker monta)
  std::vector<rgbt::SampleInfo> smp=pl.samples();
  int maxSmp=-1;
  for (auto& s: smp) maxSmp=MAX(maxSmp,s.number);
  for (int n=0; n<=maxSmp; n++) {
    DivSample* sm=new DivSample;
    sm->depth=DIV_SAMPLE_DEPTH_ADPCM_B;
    for (auto& s: smp) {
      if (s.number!=n || s.data.empty()) continue;
      sm->name=fmt::sprintf("ADPCM %.2X",n);
      // deltaN da nota raiz -> Hz (clock/144 * deltaN / 65536)
      sm->centerRate=MAX(1,(int)round((7987200.0/144.0)*(double)s.rootRate/65536.0));
      if (sm->init(s.data.size()*2)) {
        memcpy(sm->dataB,s.data.data(),MIN(s.data.size(),(size_t)sm->lengthB));
      }
    }
    ds.sample.push_back(sm);
  }
  ds.sampleLen=ds.sample.size();

  ds.initDefaultSystemChans();
  ds.recalcChans();

  if (active) quitDispatch();
  BUSY_BEGIN_SOFT;
  saveLock.lock();
  song.unload();
  song=ds;
  hasLoadedSomething=true;
  changeSong(0);
  saveLock.unlock();
  BUSY_END;
  if (active) {
    initDispatch();
    BUSY_BEGIN;
    renderSamples();
    reset();
    BUSY_END;
  }

  delete[] file;
  return true;
}
