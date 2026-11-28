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
// com o FM3 estendido) nativa do Furnace: padrões, instrumentos (sequências viram macros) e efeitos traduzidos,
// com o tempo, o vibrato e os slides de nota na matemática do BambooTracker (rgBTNative). O .btm original fica
// guardado (rgBTData): ligando rgBT o tocador do próprio BambooTracker toca (rgBT.cpp).

#include "fileOpsCommon.h"
#include "../../baseutils.h"
#include "../../../extern/bambootracker/rgbt.h"
#include <functional>
#include <deque>
#include <map>

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

// a tabela de períodos do SSG do BambooTracker é feita para 8 MHz: com o chip a 7,9872 MHz toca ~3 cents abaixo
#define RG_BT_SSG_DETUNE (-3)

// efeito do BambooTracker -> efeito do Furnace que faz a mesma coisa (modo nativo, com rgBTNative)
static int rgBTFxNative(const char* id, int v, int src, short* fx, short* val) {
  if (!id[0]) return 0;
  int vv=(v<0)?0:v;
  char a=id[0], b=id[1];
  auto one=[&](int f, int x) { fx[0]=f; val[0]=x&0xff; return 1; };
  // volume do BambooTracker sobe/desce 1 por tique a cada dígito; o 0Axy do Furnace anda 1/4
  auto slide=[&](int hi, int lo) {
    if (hi && !lo) return one(0x0a,MIN(15,hi*4)<<4);
    if (!hi) return one(0x0a,MIN(15,lo*4));
    return 0;
  };
  if (a=='0') {
    switch (b) {
      case '0': case '1': case '2': case '3': case '4': return one(b-'0',vv);
      case 'B': return one(0x0b,vv);
      case 'D': return one(0x0d,vv);
      case '7': return one(0x07,vv); // tremolo (forma diferente)
      case '8':
        if (src==rgbt::RHYTHM || src==rgbt::FM || src==rgbt::ADPCM) return one(0x08,((vv&2)?0xf0:0)|((vv&1)?0x0f:0));
        return 0;
      case 'A': {
        int hi=vv>>4, lo=vv&15;
        // o FM do BambooTracker é atenuação: subir = menos atenuação
        return slide(hi,lo);
      }
      case 'C': return one(0xff,0);
      case 'F':
        if (vv<0x20) return one(0x0f,MAX(1,vv));
        return one(0xfd,vv); // tempo (numerador do tempo virtual, com o denominador 150)
      case 'G': return one(0xed,vv);
      case 'H': return (src==rgbt::SSG)?one(0x29,vv):0;
      case 'I': return (src==rgbt::SSG)?one(0x24,vv):0;
      case 'J': return (src==rgbt::SSG)?one(0x23,vv):0;
      case 'K': return (vv&15)?one(0x0c,vv&15):0;
      case 'P': {
        // afinação em 1/32 de semitom (80 = centro); E5 do Furnace anda 1/128
        int d=(vv-0x80)*4+((src==rgbt::SSG)?RG_BT_SSG_DETUNE:0);
        return one(0xe5,MAX(0,MIN(255,0x80+d)));
      }
      case 'Q': return one(0xe1,vv);
      case 'R': return one(0xe2,vv);
      case 'S': return one(0xfc,vv);
      case 'V':
        if (src==rgbt::RHYTHM) return one(0x1f,vv);
        return 0;
      case 'W': return (src==rgbt::SSG)?one(0x21,vv):0;
      default: return 0;
    }
  }
  if (a=='E' && b=='S') return one(0xec,vv);
  if (src==rgbt::FM) {
    if (a=='F' && b=='B') return one(0x11,vv&7);
    if (a=='T' && b>='1' && b<='4') return one(0x12+(b-'1'),vv&0x7f);
    if (a=='M' && b=='L') return one(0x16,vv);
  }
  return 0;
}

// sequência do BambooTracker -> macro do Furnace
static void rgBTMacro(DivInstrumentMacro& m, const rgbt::Seq& q, std::function<int(int,int)> conv) {
  if (!q.on || q.val.empty()) return;
  int n=MIN((int)q.val.size(),255);
  for (int i=0; i<n; i++) m.val[i]=conv(q.val[i],i);
  m.len=n;
  m.loop=(q.loop>=0 && q.loop<n)?q.loop:255;
  m.rel=(q.rel>=0 && q.rel<n)?q.rel:255;
  m.open=true;
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
  // nativo: o Furnace toca (rgBT=true volta ao tocador do BambooTracker)
  ds.compatFlags.rgBT=false;
  ds.compatFlags.rgBTNative=true;
  ds.compatFlags.loopModality=2;
  ds.compatFlags.linearPitch=1;
  ds.compatFlags.pitchSlideSpeed=4; // 1/32 de semitom por unidade, como o BambooTracker
  ds.compatFlags.newVolumeScaling=true; // atenuação somada (TL do portador + volume), como o BambooTracker
  // no BambooTracker, quando o envelope do SSG/ADPCM acaba, um volume novo vale sozinho (o envelope não pesa mais)
  ds.compatFlags.volMacroLinger=false;
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
  // bateria de ADPCM com teclas fora do centro: o panorama de cada tecla vai como 08xx junto da nota
  std::map<int,std::map<int,int>> kitPan;
  for (auto& d: pl.instrumentDetails()) {
    bool offCenter=false;
    for (auto& kk: d.kit) if (kk.pan!=3) offCenter=true;
    if (offCenter) for (auto& kk: d.kit) kitPan[d.number][kk.key]=kk.pan;
  }
  for (int s=0; s<songs; s++) {
    if (s>0) ds.subsong.push_back(new DivSubSong);
    DivSubSong* sub=ds.subsong[s];
    sub->name=pl.songTitle(s);
    sub->hz=MAX(1,pl.tickFrequency());
    sub->speeds.val[0]=MAX(1,pl.songSpeed(s));
    sub->speeds.len=1;
    // tempo do BambooTracker: linha = speed*150/tempo tiques (a 60 Hz); no Furnace o tempo virtual N/D
    sub->virtualTempoN=MAX(1,pl.songTempo(s));
    sub->virtualTempoD=MAX(1,(int)round(2.5*sub->hz));
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
      int src=tracks[t].source;
      std::deque<int> echo; // notas tocadas (a mais nova na frente), para ^0..^3
      int curIns=-1;
      std::vector<bool> done(DIV_MAX_PATTERNS,false);
      for (int o=0; o<ords; o++) {
        int pi=pl.patternIndex(s,(int)t,o);
        if (pi<0 || pi>=DIV_MAX_PATTERNS) continue;
        sub->orders.ord[ch][o]=pi;
        bool first=!done[pi];
        done[pi]=true;
        DivPattern* pat=sub->pat[ch].getPattern(pi,true);
        int plen=MIN(pl.patternSize(s,o),patLen);
        for (int r=0; r<plen; r++) {
          rgbt::Step st;
          pl.getStep(s,(int)t,o,r,st);
          int note=-1;
          if (st.note>=0) {
            note=st.note;
          } else if (st.note<=-3 && st.note>=-6) {
            // eco: repete uma nota anterior
            int k=-3-st.note;
            if (k<(int)echo.size()) note=echo[k];
          }
          if (note>=0) {
            echo.push_front(note);
            if (echo.size()>4) echo.pop_back();
          }
          if (st.ins>=0) curIns=st.ins;
          if (!first) continue;
          if (note>=0) {
            // a tabela de períodos do SSG do BambooTracker toca uma oitava acima da do FM para a mesma nota
            int n=60+note+((src==rgbt::SSG)?12:0);
            if (n<180) pat->newData[r][DIV_PAT_NOTE]=n;
          } else if (st.note==-2) {
            // key off: com soltura de macro quando o instrumento tem
            pat->newData[r][DIV_PAT_NOTE]=(src==rgbt::FM || src==rgbt::RHYTHM)?DIV_NOTE_OFF:DIV_NOTE_REL;
          } else if (st.note==-7) {
            pat->newData[r][DIV_PAT_NOTE]=DIV_NOTE_OFF;
          }
          if (st.ins>=0) {
            pat->newData[r][DIV_PAT_INS]=st.ins;
            if (st.ins>maxIns) maxIns=st.ins;
          }
          if (st.vol>=0) {
            // volume do FM no BambooTracker é atenuação (00 = máximo)
            pat->newData[r][DIV_PAT_VOL]=(src==rgbt::FM)?(0x7f-MIN(st.vol,0x7f)):st.vol;
          }
          int col=0;
          for (int k=0; k<4 && col<4; k++) {
            short fx[2], val[2];
            int nfx=rgBTFxNative(st.fx[k].id,st.fx[k].value,src,fx,val);
            for (int j=0; j<nfx && col<4; j++) {
              pat->newData[r][DIV_PAT_FX(col)]=fx[j];
              pat->newData[r][DIV_PAT_FXVAL(col)]=val[j];
              col++;
            }
          }
          if (src==rgbt::ADPCM && note>=0 && col<4 && kitPan.count(curIns)) {
            std::map<int,int>& kp=kitPan[curIns];
            std::map<int,int>::iterator kit=kp.find(note);
            if (kit!=kp.end()) {
              // panorama do BambooTracker: 1 direita, 2 esquerda, 3 os dois
              const int panFx[4]={0x00,0x0f,0xf0,0xff};
              pat->newData[r][DIV_PAT_FX(col)]=0x08;
              pat->newData[r][DIV_PAT_FXVAL(col)]=panFx[kit->second&3];
              col++;
            }
          }
        }
        // SSG: afinação da tabela do BambooTracker desde o começo
        if (first && o==0 && src==rgbt::SSG) {
          bool hasE5=false;
          for (int k=0; k<4; k++) if (pat->newData[0][DIV_PAT_FX(k)]==0xe5) hasE5=true;
          for (int k=0; k<4 && !hasE5; k++) {
            if (pat->newData[0][DIV_PAT_FX(k)]==-1) {
              pat->newData[0][DIV_PAT_FX(k)]=0xe5;
              pat->newData[0][DIV_PAT_FXVAL(k)]=0x80+RG_BT_SSG_DETUNE;
              break;
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
  std::vector<rgbt::InsDetail> insDet=pl.instrumentDetails();
  for (auto& i: insList) maxIns=MAX(maxIns,i.number);
  // calibração das amostras do ADPCM: a nota raiz (do BambooTracker) que toca com o deltaN da raiz.
  // a bateria usa a calibração da amostra quando bate (a diferença é um número inteiro de semitons);
  // se não bate, ganha uma cópia da amostra com a calibração dela
  std::vector<rgbt::SampleInfo> smp=pl.samples();
  int maxSmp=-1;
  for (auto& s: smp) maxSmp=MAX(maxSmp,s.number);
  std::map<int,std::pair<int,int>> calib;
  for (auto& d: insDet) {
    if (d.type!=2) continue;
    for (auto& ii: insList) if (ii.number==d.number && ii.sample>=0) calib[ii.sample]=std::make_pair(d.rootKey,d.rootDeltaN);
  }
  struct SmpCopy { int src, rootKey, rootDN; };
  std::vector<SmpCopy> smpCopies;
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
        // os operadores do BambooTracker vêm na ordem lógica (S1 S2 S3 S4); no Furnace op[] segue os registradores (S1 S3 S2 S4)
        const int opMap[4]={0,2,1,3};
        for (int o=0; o<4; o++) {
          DivInstrumentFM::Operator& op=ins->fm.op[opMap[o]];
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
      } else if (i.type==3) {
        // bateria: mapa de notas (tecla -> amostra e nota que dá o deltaN da tecla)
        ins->type=DIV_INS_ADPCMB;
        ins->amiga.useNoteMap=true;
        for (int k=0; k<180; k++) {
          ins->amiga.noteMap[k].map=-1;
          ins->amiga.noteMap[k].freq=k;
        }
        for (auto& d: insDet) {
          if (d.number!=n) continue;
          for (auto& kk: d.kit) {
            if (kk.sample<0 || kk.key<0 || kk.key+60>=180 || kk.rootDeltaN<=0) continue;
            int smpIdx=kk.sample, noteOut=kk.rootKey+kk.pitch;
            std::map<int,std::pair<int,int>>::iterator c=calib.find(kk.sample);
            if (c==calib.end()) {
              calib[kk.sample]=std::make_pair(kk.rootKey,kk.rootDeltaN);
            } else {
              double semis=12.0*log2((double)kk.rootDeltaN/(double)MAX(1,c->second.second));
              if (fabs(semis-round(semis))<0.02) {
                noteOut=c->second.first+kk.pitch+(int)round(semis);
              } else {
                int found=-1;
                for (size_t q=0; q<smpCopies.size(); q++) {
                  if (smpCopies[q].src==kk.sample && smpCopies[q].rootDN==kk.rootDeltaN) found=(int)q;
                }
                if (found<0) {
                  smpCopies.push_back(SmpCopy{kk.sample,kk.rootKey,kk.rootDeltaN});
                  found=(int)smpCopies.size()-1;
                }
                smpIdx=maxSmp+1+found;
                noteOut=smpCopies[found].rootKey+kk.pitch;
              }
            }
            ins->amiga.noteMap[kk.key+60].map=smpIdx;
            logD("BTM: bateria %.2X tecla %d: amostra %d (raiz %d, deltaN %d, altura %d, pan %d) -> nota %d",n,kk.key,smpIdx,kk.rootKey,kk.rootDeltaN,kk.pitch,kk.pan,noteOut);
            ins->amiga.noteMap[kk.key+60].freq=CLAMP(noteOut+60,0,179);
          }
        }
      } else {
        ins->type=DIV_INS_ADPCMB;
        ins->amiga.initSample=i.sample;
      }
    }
    // sequências -> macros
    for (auto& d: insDet) {
      if (d.number!=n) continue;
      for (auto& u: d.unsupported) logW("BTM: instrumento %.2X: %s ainda não é convertido",n,u.c_str());
      // arpejo: absoluta/relativa em notas (48 = 0), fixa = nota exata
      if (d.arp.on) {
        int acc=0;
        rgBTMacro(ins->std.arpMacro,d.arp,[&](int v, int) -> int {
          if (d.arp.type==2) return (v+((ins->type==DIV_INS_AY)?12:0))^0x40000000;
          if (d.arp.type==3) { acc+=v-48; return acc; }
          return v-48;
        });
      }
      // altura em 1/32 de semitom (127 = 0); no Furnace 1/128
      if (d.pitch.on) {
        rgBTMacro(ins->std.pitchMacro,d.pitch,[&](int v, int) -> int { return (v-127)*4; });
        if (d.pitch.type==3) ins->std.pitchMacro.mode=1;
      }
      // FM: sequências de parâmetro -> macros (AL/FB do instrumento, o resto por operador)
      if (ins->type==DIV_INS_FM) {
        const int opMap[4]={0,2,1,3};
        for (auto& os: d.opSeq) {
          int pi=os.first;
          const rgbt::Seq& q=os.second;
          if (pi==0) { rgBTMacro(ins->std.algMacro,q,[](int v, int) -> int { return v&7; }); continue; }
          if (pi==1) { rgBTMacro(ins->std.fbMacro,q,[](int v, int) -> int { return v&7; }); continue; }
          if (pi>=38 && pi<42) {
            rgBTMacro(ins->std.opMacros[opMap[pi-38]].ssgMacro,q,[](int v, int) -> int { return (v<0)?0:(8|(v&7)); });
            continue;
          }
          if (pi<2 || pi>=38) continue;
          int op=opMap[(pi-2)/9], k=(pi-2)%9;
          DivInstrumentSTD::OpMacro& om=ins->std.opMacros[op];
          switch (k) {
            case 0: rgBTMacro(om.arMacro,q,[](int v, int) -> int { return v&31; }); break;
            case 1: rgBTMacro(om.drMacro,q,[](int v, int) -> int { return v&31; }); break;
            case 2: rgBTMacro(om.d2rMacro,q,[](int v, int) -> int { return v&31; }); break;
            case 3: rgBTMacro(om.rrMacro,q,[](int v, int) -> int { return v&15; }); break;
            case 4: rgBTMacro(om.slMacro,q,[](int v, int) -> int { return v&15; }); break;
            case 5: rgBTMacro(om.tlMacro,q,[](int v, int) -> int { return v&127; }); break;
            case 6: rgBTMacro(om.rsMacro,q,[](int v, int) -> int { return v&3; }); break;
            case 7: rgBTMacro(om.multMacro,q,[](int v, int) -> int { return v&15; }); break;
            case 8: rgBTMacro(om.dtMacro,q,[&](int v, int) -> int { return dtFromReg[v&7]; }); break;
          }
        }
      }
      if (ins->type==DIV_INS_AY) {
        if (d.ssgTN.on) {
          // 0 tom, 1-32 ruído (período 32-x), 33-64 tom+ruído (64-x), 65 nada
          rgBTMacro(ins->std.waveMacro,d.ssgTN,[&](int v, int) -> int {
            if (v==0) return 1;
            if (v==65) return 0;
            return (v>32)?3:2;
          });
          bool noise=false;
          for (int v: d.ssgTN.val) if (v>0 && v<65) noise=true;
          if (noise) {
            int last=-1;
            // a macro de ruído do Furnace escreve 31-valor no registrador
            for (int v: d.ssgTN.val) if (v>0 && v<65) { last=31-((v>32)?(64-v):(32-v)); break; }
            rgBTMacro(ins->std.dutyMacro,d.ssgTN,[&](int v, int) -> int {
              if (v>0 && v<65) last=31-((v>32)?(64-v):(32-v));
              return last;
            });
          }
        }
        // envelope de hardware e formas de onda: o BambooTracker usa o envelope do SSG (registrador 0D) com o
        // período fixo (subdado "bruto") ou proporcional ao tom (subdado "razão": período = TP*r1/(r2*div),
        // div 32 nas formas de triângulo, 16 nas outras). No Furnace: bit 4 da macro de onda (envelope), ex2
        // (forma), ex5 (período fixo) e ex3/alg (envelope automático: período = TP*alg/(ex3*16)).
        // ondas: 1 triângulo (forma 0E, sem tom), 2 serra (0C), 3 serra invertida (08), 4-6 iguais com o tom
        // (máscara quadrada) por cima.
        int waveForm=0;
        if (d.ssgWave.on && !d.ssgWave.val.empty()) {
          waveForm=d.ssgWave.val[0];
          for (int v: d.ssgWave.val) if (v!=waveForm) {
            logW("BTM: instrumento %.2X: forma de onda do SSG que muda durante a nota; usando a primeira",n);
            break;
          }
          if (waveForm<0 || waveForm>6) waveForm=0;
          if (waveForm>=4) {
            for (size_t k=0; k<d.ssgWave.sub.size(); k++) {
              int sub=d.ssgWave.sub[k];
              if (((sub>>20)==2 && (sub&0xffff)!=0x0101) || (sub>>20)==1) {
                logW("BTM: instrumento %.2X: máscara quadrada com outra frequência ainda não é convertida (usando a da nota)",n);
                break;
              }
            }
          }
        }
        bool hardEnv=false, softEnv=false;
        if (d.ssgEnv.on) for (int v: d.ssgEnv.val) { if (v>=16) hardEnv=true; else softEnv=true; }
        auto setRatio=[&](int shape, int sub) {
          int div=(shape==0x0a || shape==0x0e)?32:16;
          if ((sub>>20)==1) {
            ins->std.ex5Macro.val[0]=sub&0xffff;
            ins->std.ex5Macro.len=1;
            ins->std.ex5Macro.open=true;
          } else {
            int r1=1, r2=1;
            if ((sub>>20)==2) { r1=(sub>>8)&0xff; r2=sub&0xff; }
            if (r1<1) r1=1;
            if (r2<1) r2=1;
            int num=r2*div/16;
            ins->std.ex3Macro.val[0]=num;
            ins->std.ex3Macro.len=1;
            ins->std.ex3Macro.open=true;
            ins->std.algMacro.val[0]=r1;
            ins->std.algMacro.len=1;
            ins->std.algMacro.open=true;
          }
        };
        int envBits=0;
        if (waveForm>=1) {
          const int shapeOf[7]={0,0x0e,0x0c,0x08,0x0e,0x0c,0x08};
          int shape=shapeOf[waveForm];
          ins->std.ex2Macro.val[0]=shape;
          ins->std.ex2Macro.len=1;
          ins->std.ex2Macro.open=true;
          // triângulo/serra: o envelope dá a nota (o "tom" do envelope)
          setRatio(shape,0);
          envBits=(waveForm>=4)?(4|1):4;
          if (hardEnv) logW("BTM: instrumento %.2X: forma de onda e envelope de hardware juntos; vale a forma de onda",n);
        } else if (hardEnv) {
          // envelope de hardware na sequência de envelope
          int firstShape=-1, firstSub=0;
          bool sameShape=true, sameSub=true;
          for (size_t k=0; k<d.ssgEnv.val.size(); k++) {
            int v=d.ssgEnv.val[k];
            if (v<16) continue;
            int sh=v-16+8, sb=(k<d.ssgEnv.sub.size())?d.ssgEnv.sub[k]:0;
            if (firstShape<0) { firstShape=sh; firstSub=sb; }
            if (sh!=firstShape) sameShape=false;
            if (sb!=firstSub) sameSub=false;
          }
          if (sameShape) {
            ins->std.ex2Macro.val[0]=firstShape;
            ins->std.ex2Macro.len=1;
            ins->std.ex2Macro.open=true;
          } else {
            int last=firstShape;
            rgBTMacro(ins->std.ex2Macro,d.ssgEnv,[&](int v, int) -> int { if (v>=16) last=v-16+8; return last; });
          }
          if (!sameSub) logW("BTM: instrumento %.2X: período do envelope de hardware que muda durante a nota; usando o primeiro",n);
          setRatio(firstShape,firstSub);
          envBits=4;
          if (softEnv) logW("BTM: instrumento %.2X: envelope que mistura volume e hardware; aproximado",n);
        }
        if (d.ssgEnv.on && waveForm==0) {
          rgBTMacro(ins->std.volMacro,d.ssgEnv,[&](int v, int) -> int { return (v<16)?v:15; });
        }
        if (envBits) {
          // a macro de onda ganha o bit do envelope (e perde o tom no triângulo/serra puros)
          if (ins->std.waveMacro.len>0) {
            for (int k=0; k<ins->std.waveMacro.len; k++) {
              int w=ins->std.waveMacro.val[k];
              ins->std.waveMacro.val[k]=(waveForm>=1 && waveForm<4)?((w&2)|4):(w|envBits);
            }
          } else if (hardEnv && softEnv && waveForm==0) {
            rgBTMacro(ins->std.waveMacro,d.ssgEnv,[&](int v, int) -> int { return (v>=16)?5:1; });
          } else {
            ins->std.waveMacro.val[0]=envBits;
            ins->std.waveMacro.len=1;
            ins->std.waveMacro.open=true;
          }
        }
      } else if (ins->type==DIV_INS_ADPCMB) {
        if (d.adpcmEnv.on) rgBTMacro(ins->std.volMacro,d.adpcmEnv,[&](int v, int) -> int { return v; });
      }
    }
    ds.ins.push_back(ins);
  }
  ds.insLen=ds.ins.size();

  // amostras do ADPCM (para ver; a memória do chip é a que o BambooTracker monta)
  for (int n=0; n<=maxSmp+(int)smpCopies.size(); n++) {
    DivSample* sm=new DivSample;
    sm->depth=DIV_SAMPLE_DEPTH_ADPCM_B;
    int srcN=(n>maxSmp)?smpCopies[n-maxSmp-1].src:n;
    for (auto& s: smp) {
      if (s.number!=srcN || s.data.empty()) continue;
      sm->name=(n>maxSmp)?fmt::sprintf("ADPCM %.2X (bateria)",srcN):fmt::sprintf("ADPCM %.2X",n);
      // o Furnace toca a amostra com deltaN = 65535*centerRate/8372 * f(nota)/(clock/144), f = 440*2^((nota-57)/12);
      // o BambooTracker toca a nota raiz com o deltaN da raiz
      int rootKey=48, rootDN=s.rootRate;
      if (n>maxSmp) {
        rootKey=smpCopies[n-maxSmp-1].rootKey;
        rootDN=smpCopies[n-maxSmp-1].rootDN;
      } else if (calib.count(n)) {
        rootKey=calib[n].first;
        rootDN=calib[n].second;
      }
      // nota no espaço do Furnace (60 = C-0): C-4 = 108 toca a 8372 "Hz" virtuais = centerRate
      double fRoot=440.0*pow(2.0,(double)(rootKey+60-57)/12.0);
      sm->centerRate=MAX(1,(int)round((double)rootDN*(7987200.0/144.0)*8372.0/(65535.0*fRoot)));
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
