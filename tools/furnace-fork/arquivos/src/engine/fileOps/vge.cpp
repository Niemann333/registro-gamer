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

// RG: importador de módulos do VGM Music Maker (.vge, VGEfmtV1-3) do Shiru.
// O arquivo é lido pelo próprio código do VGMMM (extern/vgmmm) e vira uma música do Furnace com
// YM2612 + SN76489 (os 10 canais do VGMMM na mesma ordem). A opção rgVGMMM faz o tocador do VGMMM
// tocar a música (rgVge.cpp), então o som sai igual ao do programa original.

#include "fileOpsCommon.h"
#include <map>
#include "../rgVgeMap.h"
#include "../../baseutils.h"
#include "../../../extern/vgmmm/rgvge.h"

static String rgVgeDate(unsigned short d) {
  if (d==0) return "";
  return fmt::sprintf("%02d.%02d.%02d",d>>11,((d>>7)&15)+1,d&0x7f);
}

bool DivEngine::loadVGE(unsigned char* file, size_t len) {
  DivSong ds;
  rgvge::Header h;

  // o módulo do VGMMM é global: não pode ser lido enquanto outra música do VGMMM toca
  BUSY_BEGIN_SOFT;
  int r=rgvge::load(file,len);
  if (r!=0) {
    BUSY_END;
    lastError=(r==3)?_("out of memory"):_("invalid VGM Music Maker module!");
    delete[] file;
    return false;
  }
  rgvge::getHeader(h);

  ds.version=DIV_VERSION_TFE;
  ds.name=h.name;
  ds.author=h.author;
  ds.notes=h.message;
  for (size_t i=0; i<ds.notes.size(); i++) {
    if (ds.notes[i]=='\r') {
      ds.notes.erase(i,1);
      i--;
    }
  }
  ds.createdDate=rgVgeDate(h.dateCreated);
  ds.revisionDate=rgVgeDate(h.dateModified);
  ds.systemName="Sega Genesis/Mega Drive";
  ds.systemLen=2;
  ds.system[0]=DIV_SYSTEM_YM2612;
  ds.system[1]=DIV_SYSTEM_SMS;
  ds.compatFlags.rgVGMMM=false;
  // mixagem do VGMMM (chips.cpp: FM x(fmVolume*7+0x3c0)/256, PSG sem ganho): medida contra o WAV do próprio VGMMM
  ds.systemVol[0]=1.77f;
  ds.systemVol[1]=0.27f;

  // relógios (o VGMMM usa os do PAL por padrão)
  if (h.fmClock==7600489 || h.fmClock==7600490) {
    ds.systemFlags[0].set("clockSel",1);
  } else if (h.fmClock==7670453 || h.fmClock==7670454) {
    ds.systemFlags[0].set("clockSel",0);
  } else {
    ds.systemFlags[0].set("clockSel",0);
    ds.systemFlags[0].set("customClock",(int)h.fmClock);
  }
  if (h.psgClock==3546894 || h.psgClock==3546895) {
    ds.systemFlags[1].set("clockSel",1);
  } else if (h.psgClock==3579545) {
    ds.systemFlags[1].set("clockSel",0);
  } else {
    ds.systemFlags[1].set("clockSel",0);
    ds.systemFlags[1].set("customClock",(int)h.psgClock);
  }
  // cabeçalho do VGMMM (para montar o módulo de volta na hora de tocar)
  ds.systemFlags[0].set("rgVgeFM",(int)h.fmClock);
  ds.systemFlags[0].set("rgVgePSG",(int)h.psgClock);
  ds.systemFlags[1].set("rgFineVol",true);
  ds.systemFlags[0].set("rgVgeSpeedE",(int)h.speedEven);
  ds.systemFlags[0].set("rgVgeSpeedO",(int)h.speedOdd);
  ds.systemFlags[0].set("rgVgeInter",(int)h.interleave);
  ds.systemFlags[0].set("rgVgeRate",(int)h.sampleRate);
  ds.systemFlags[0].set("rgVgeLoop",h.loopPos);
  ds.systemFlags[0].set("rgVgeCreated",(int)h.dateCreated);
  ds.systemFlags[0].set("rgVgeModified",(int)h.dateModified);
  ds.systemFlags[0].set("rgVgeSaves",(int)h.saveCount);

  DivSubSong* sub=ds.subsong[0];
  sub->hz=(h.fps>0)?h.fps:50;
  sub->ordersLen=MIN(h.orderLen,DIV_MAX_PATTERNS);

  // velocidade par/ímpar com intercalação (como no TFM Music Maker): groove só para o Furnace mostrar
  int sE=MAX(1,(int)h.speedEven), sO=MAX(1,(int)h.speedOdd), il=MAX(1,(int)h.interleave);
  if (sE==sO) {
    sub->speeds.val[0]=sE;
    sub->speeds.len=1;
  } else {
    if (il>8) il=8;
    for (int i=0; i<il; i++) {
      sub->speeds.val[i]=sE;
      sub->speeds.val[i+il]=sO;
    }
    sub->speeds.len=il*2;
  }

  // ---- conversão para música do Furnace (o Furnace toca; com rgVGMMM ligado, toca o VGMMM a partir do original)
  // o arquivo original, para a opção "tocar com o VGM Music Maker"
  ds.systemFlags[0].set("rgVgeData",taEncodeBase64(std::string((const char*)file,len)));

  // volume do FM: o VGMMM usa uma tabela (fm_set_volume) e escala o TL dos carriers como o Furnace sem a
  // "nova escala de volume" (127-((127-tl)*v)/127): a tabela vai direto para a coluna de volume
  static const int vgeVolTab[32]={0,0,88,90,91,93,95,96,97,98,100,102,104,106,107,109,110,112,113,114,115,116,118,119,120,121,122,123,124,125,126,127};
  ds.compatFlags.newVolumeScaling=false;
  ds.compatFlags.linearPitch=1;
  ds.compatFlags.pitchSlideSpeed=4; // 1/32 de semitom por unidade, como o VGMMM
  // afinação: a tabela de F-num do VGMMM (A = 1085) é a do relógio NTSC; no relógio da música o FM sai um pouco
  // fora de 440. O PSG usa períodos calculados para 3546894 Hz. O Furnace afina pelo FM e o PSG ganha um E5.
  double fmA=1085.0*8.0*(double)h.fmClock/(144.0*1048576.0);
  double psgA=440.0*(double)h.psgClock/3546894.0;
  ds.tuning=(float)fmA;
  int psgE5=0x80+(int)round(1200.0*log2(psgA/fmA)*128.0/100.0);
  if (psgE5<0) psgE5=0;
  if (psgE5>255) psgE5=255;

  // padrões usados
  bool used[256];
  memset(used,0,sizeof(used));
  int maxLen=1;
  for (int i=0; i<sub->ordersLen; i++) {
    int p=rgvge::orderPattern(i);
    used[p]=true;
    if (rgvge::patternLength(p)>maxLen) maxLen=rgvge::patternLength(p);
  }
  if (maxLen>DIV_MAX_ROWS) maxLen=DIV_MAX_ROWS;
  sub->patLen=maxLen;

  // instrumentos FM: mesmo número do VGMMM
  int lastFM=0;
  for (int i=0; i<rgvge::MAX_INSTRUMENTS; i++) {
    if (!rgvge::insEmpty(i)) lastFM=i;
  }
  // amostras usadas (efeito 1C) e instrumentos usados no PSG
  bool smpUsed[256], psgUsed[256];
  bool psgPan=false; // o VGMMM faz estéreo no PSG (registro do Game Gear)
  memset(smpUsed,0,sizeof(smpUsed));
  memset(psgUsed,0,sizeof(psgUsed));
  for (int p=0; p<256; p++) {
    if (!used[p]) continue;
    for (int row=0; row<rgvge::patternLength(p); row++) {
      for (int ch=0; ch<rgvge::CHANNELS; ch++) {
        rgvge::Cell c;
        rgvge::getCell(p,row,ch,c);
        if (c.ins>0 && c.ins-1>lastFM) lastFM=c.ins-1;
        if (ch>=6 && c.ins>0) psgUsed[c.ins&255]=true;
        for (int k=0; k<4; k++) {
          if (c.fx[k]==0x1c) smpUsed[c.param[k]==0xff?0xfe:c.param[k]]=true;
          if (c.fx[k]==0x19 && ch>=6) psgPan=true;
        }
      }
    }
  }
  psgUsed[1]=true; // instrumento padrão do VGMMM
  if (psgPan) ds.systemFlags[1].set("chipType",3); // Game Gear: o mesmo PSG da Sega, com estéreo
  int nFM=lastFM+1;
  int psgIns[256];
  int smpIns[256];
  int nextIns=nFM;
  for (int i=0; i<256; i++) {
    psgIns[i]=-1;
    smpIns[i]=-1;
  }
  for (int i=0; i<256; i++) {
    int l=0;
    if (smpUsed[i] && rgvge::sampleData(i,l)!=NULL && l>0) smpIns[i]=nextIns++;
  }
  for (int i=1; i<256; i++) {
    if (psgUsed[i] && i-1<rgvge::MAX_INSTRUMENTS) psgIns[i]=1;
  }
  // PSG: o VGMMM multiplica o envelope pelo volume (15*nível*escala, arredondado para cima); o Furnace
  // soma atenuações. Para soar igual, cada par instrumento+volume vira um instrumento com o envelope já
  // na escala certa, e a coluna de volume fica no máximo.
  std::vector<std::pair<int,int>> psgList; // (instrumento do VGMMM, volume 0-31)
  std::map<int,int> psgMap;
  auto psgScale=[&](int n, int cv) -> double {
    rgvge::Ins vi;
    rgvge::getIns(n-1,vi);
    int tl=vi.op[3].tl&0x7f;
    return 15.0*(double)(((127-tl)*(cv*4))/127)/127.0;
  };
  auto psgFor=[&](int n, int cv) -> int {
    if (n<1 || n>255 || psgIns[n]<0) n=1;
    cv&=31;
    int key=(n<<5)|cv;
    auto it=psgMap.find(key);
    if (it!=psgMap.end()) return it->second;
    int idx=nextIns++;
    psgMap[key]=idx;
    psgList.push_back(std::make_pair(n,cv));
    return idx;
  };

  // estado de cada canal ao longo da música (memória dos efeitos do VGMMM)
  struct VgeCh {
    int ins=-1;          // instrumento do VGMMM (1..)
    int furIns=-1;       // instrumento posto no Furnace
    int vol=31;
    bool arp=false;
    int portaUp=0, portaDown=0, tonePorta=0, vibParam=0, volSlide=0;
    bool pUp=false, pDown=false, pTone=false, pVib=false, pSlide=false;
    bool dac=false;      // FM6 tocando amostra
    double psgS=-1;      // PSG: escala do instrumento posto
    int psgCv=31;        // PSG: volume (0-31) do instrumento posto
  } cs[rgvge::CHANNELS];
  bool written[256][DIV_MAX_ROWS];
  memset(written,0,sizeof(written));
  int maxCols[rgvge::CHANNELS];
  for (int ch=0; ch<rgvge::CHANNELS; ch++) maxCols[ch]=1;
  auto chFur=[&](int ch) -> int { return ch; };
  auto addFx=[&](std::vector<std::pair<short,short>>& v, short fx, short val) {
    for (auto& e: v) {
      if (e.first==fx) {
        e.second=val;
        return;
      }
    }
    v.push_back(std::make_pair(fx,val));
  };
  auto fmSlide=[&](std::vector<std::pair<short,short>>& v, int ch, int slide) {
    // VGMMM: desce (y) e sobe (x) 1/8 de volume por tique; no Furnace F3/F4 (1/256 por tique) ou 0A
    int net=(slide>>4)-(slide&15);
    // no PSG o volume do instrumento posto vale 15 no Furnace: a descida é relativa a ele
    double per=(ch<6)?(43.0*net):(480.0*net/(double)MAX(1,cs[ch].psgCv));
    int a=(int)round(fabs(per));
    if (net==0) {
      addFx(v,0x0a,0);
    } else if (a<=255) {
      addFx(v,(per>0)?0xf3:0xf4,a);
    } else {
      int q=MIN(15,(int)round(fabs(per)/64.0));
      addFx(v,0x0a,(per>0)?(q<<4):q);
    }
  };

  // ruído: modo atual no Furnace (branco/periódico, taxa fixa ou período do tom 3)
  bool nzWhite=true, nzCh3=false;
  int tone2Note=-1;
  auto nzFx=[&]() -> short { return (nzCh3?0x10:0x00)|(nzWhite?0x01:0x00); };
  for (int o=0; o<sub->ordersLen; o++) {
    int p=rgvge::orderPattern(o);
    for (int ch=0; ch<rgvge::CHANNELS; ch++) sub->orders.ord[ch][o]=p;
    int plen=MIN(rgvge::patternLength(p),maxLen);
    for (int row=0; row<plen; row++) {
      bool first=!written[p][row];
      written[p][row]=true;
      // efeitos globais desta linha (amostra, ruído) que vão para outros canais
      int dacTrig=-1, dacRetrig=-1, dacCut=-1, dacDelay=-1, noiseMode=-1;
      for (int ch=0; ch<rgvge::CHANNELS; ch++) {
        rgvge::Cell c;
        rgvge::getCell(p,row,ch,c);
        for (int k=0; k<4; k++) {
          unsigned char fx=c.fx[k], pp=c.param[k];
          if (fx==0x1c) dacTrig=(pp==0xff)?0xfe:pp;
          if (fx==0x1a) {
            if ((pp&0xf0)==0x90) dacRetrig=pp&15;
            if ((pp&0xf0)==0xc0) dacCut=pp&15;
            if ((pp&0xf0)==0xd0) dacDelay=pp&15;
          }
          if (fx==0x17) noiseMode=(pp!=0);
        }
      }
      for (int ch=0; ch<rgvge::CHANNELS; ch++) {
        rgvge::Cell c;
        rgvge::getCell(p,row,ch,c);
        VgeCh& s=cs[ch];
        short note=-1, ins=-1, vol=-1;
        std::vector<std::pair<short,short>> fxs;
        bool porta=false, hasArp=false, psgNoteVol=false;
        bool nUp=false, nDown=false, nTone=false, nVib=false, nSlide=false;
        for (int k=0; k<4; k++) {
          if (c.fx[k]==0x03) porta=true;
          if (c.fx[k]==0x00 && c.param[k]!=0) hasArp=true;
        }
        // começo da música: modo do ruído e afinação do PSG
        if (o==0 && row==0) {
          if (ch>=6) addFx(fxs,0xe5,psgE5);
          if (ch==9) addFx(fxs,0x20,nzFx());
        }
        // nota
        if (c.note==rgvge::NOTE_OFF) {
          if (ch<6) {
            if (!(ch==5 && s.dac)) note=DIV_NOTE_OFF;
          } else {
            note=DIV_NOTE_REL;
          }
        } else if (c.note>=0 && c.note<12) {
          // instrumento (o VGMMM usa o 1 quando nenhum foi escolhido)
          int n=s.ins;
          if (c.ins!=0) n=c.ins;
          if (n<=0) n=1;
          s.ins=n;
          int fi;
          if (ch<6) {
            fi=n-1;
          } else {
            int cv=(c.volume!=0)?c.volume:s.vol;
            fi=psgFor(n,cv);
            for (auto& e: psgMap) if (e.second==fi) { s.psgS=psgScale(e.first>>5,e.first&31); s.psgCv=e.first&31; break; }
            if (c.volume!=0) psgNoteVol=true;
          }
          if (c.ins!=0 || s.furIns!=fi || (ch==5 && s.dac)) ins=fi;
          s.furIns=fi;
          int semi=c.octave*12+c.note;
          if (ch<9) {
            note=60+semi-12;
          } else {
            // ruído: a nota escolhe a taxa (0-2) do jeito do VGMMM; o Furnace usa C/C#/D
            int rate=(semi-12)&3;
            bool wantCh3=(rate==3);
            if (wantCh3) {
              // taxa 3: o ruído segue o período do tom 3 (o que estiver nele; sem nota = período 0)
              note=(tone2Note>=0)?tone2Note:179;
            } else {
              note=60+c.octave*12+(2-rate);
            }
            if (wantCh3!=nzCh3) {
              nzCh3=wantCh3;
              addFx(fxs,0x20,nzFx());
            }
          }
          if (note<0) note=0;
          if (note>179) note=179;
          if (ch==8) tone2Note=note;
          if (!porta && s.arp && !hasArp) {
            addFx(fxs,0x00,0);
            s.arp=false;
          }
          if (ch==5 && s.dac) {
            // volta do DAC para o FM: volume do canal de novo
            s.dac=false;
            vol=vgeVolTab[s.vol&31];
          }
        }
        if (c.volume!=0) {
          s.vol=c.volume;
          if (ch<6) {
            if (!(ch==5 && s.dac)) vol=vgeVolTab[c.volume&31];
          } else if (psgNoteVol) {
            vol=15; // o volume já está no instrumento
          } else {
            // volume sem nota: o VGMMM reescala o envelope; aqui, atenuação relativa ao instrumento posto
            double sNow=(s.psgS>=0)?s.psgS:psgScale((s.ins>0)?s.ins:1,31);
            double sNew=psgScale((s.ins>0)?s.ins:1,c.volume);
            vol=(sNow>0)?(int)round(15.0*sNew/sNow):15;
            if (vol<0) vol=0;
            if (vol>15) vol=15;
          }
        }
        // efeitos
        for (int k=0; k<4; k++) {
          unsigned char fx=c.fx[k], pp=c.param[k];
          unsigned char hi=pp&0xf0;
          switch (fx) {
            case 0x00:
              if (pp!=0) {
                addFx(fxs,0x00,pp);
                s.arp=true;
              }
              break;
            case 0x01:
              if (pp) s.portaUp=pp;
              addFx(fxs,0x01,s.portaUp);
              nUp=true;
              break;
            case 0x02:
              if (pp) s.portaDown=pp;
              addFx(fxs,0x02,s.portaDown);
              nDown=true;
              break;
            case 0x03:
              if (pp) s.tonePorta=pp;
              addFx(fxs,0x03,s.tonePorta);
              nTone=true;
              break;
            case 0x04:
              if (pp&15) s.vibParam=(s.vibParam&0xf0)|(pp&15);
              if (pp&0xf0) s.vibParam=(s.vibParam&15)|(pp&0xf0);
              addFx(fxs,0x04,s.vibParam);
              nVib=true;
              break;
            case 0x05:
              if (pp) s.volSlide=pp;
              addFx(fxs,0x03,s.tonePorta);
              nTone=true;
              fmSlide(fxs,ch,s.volSlide);
              nSlide=true;
              break;
            case 0x06:
              if (pp) s.volSlide=pp;
              addFx(fxs,0x04,s.vibParam);
              nVib=true;
              fmSlide(fxs,ch,s.volSlide);
              nSlide=true;
              break;
            case 0x0a:
              if (pp) s.volSlide=pp;
              fmSlide(fxs,ch,s.volSlide);
              nSlide=true;
              break;
            case 0x08: if (ch<6) addFx(fxs,0x12,pp&0x7f); break;
            case 0x09: if (ch<6) addFx(fxs,0x14,pp&0x7f); break; // operador 2 do registro (S3) = OP3 no Furnace
            case 0x0c: if (ch<6) addFx(fxs,0x13,pp&0x7f); break;
            case 0x0d: if (ch<6) addFx(fxs,0x15,pp&0x7f); break;
            case 0x0e:
              if (hi<=0x30) {
                const int furOp[4]={1,3,2,4};
                if (ch<6) addFx(fxs,0x16,(furOp[hi>>4]<<4)|(pp&15));
              } else if (hi==0x90) {
                if (pp&15) addFx(fxs,0x0c,pp&15);
              } else if (hi==0xc0) {
                if (pp&15) addFx(fxs,(ch<6)?0xec:0xfc,pp&15);
              } else if (hi==0xd0) {
                if (pp&15) addFx(fxs,0xed,pp&15);
              } else if (hi==0xf0) {
                if (ch<6) addFx(fxs,0x11,pp&7);
              }
              break;
            case 0x0f:
              if (hi!=0 && (pp>>4)==MAX(1,pp&15)) addFx(fxs,0x0f,pp>>4);
              break;
            case 0x15:
              if (ch<6) addFx(fxs,0x10,pp?(0x10|(pp&7)):0);
              break;
            case 0x19:
              addFx(fxs,0x08,(pp==0)?0xff:(((pp&0xf0)?0xf0:0)|((pp&0x0f)?0x0f:0)));
              break;
          }
        }
        // efeitos do VGMMM só valem na linha em que aparecem: no Furnace eles continuam, então param aqui
        if (s.pUp && !nUp) addFx(fxs,0x01,0);
        if (s.pDown && !nDown) addFx(fxs,0x02,0);
        if (s.pTone && !nTone) addFx(fxs,0x03,0);
        if (s.pVib && !nVib) addFx(fxs,0x04,0);
        if (s.pSlide && !nSlide) addFx(fxs,0x0a,0);
        s.pUp=nUp;
        s.pDown=nDown;
        s.pTone=nTone;
        s.pVib=nVib;
        s.pSlide=nSlide;
        // amostras: sempre no FM6
        if (ch==5) {
          if (noiseMode>=0) {}
          if (dacTrig>=0 && smpIns[dacTrig&255]>=0) {
            note=60+48;
            ins=smpIns[dacTrig&255];
            vol=127;
            s.dac=true;
            s.furIns=ins;
          }
          if (dacRetrig>0) addFx(fxs,0x0c,dacRetrig);
          if (dacCut>0) addFx(fxs,0xec,dacCut);
          if (dacDelay>0) addFx(fxs,0xed,dacDelay);
        }
        if (ch==9 && noiseMode>=0 && nzWhite!=(noiseMode==0)) {
          nzWhite=(noiseMode==0);
          addFx(fxs,0x20,nzFx());
        }

        if (!first) continue;
        DivPattern* pat=sub->pat[chFur(ch)].getPattern(p,true);
        if (note>=0) pat->newData[row][DIV_PAT_NOTE]=note;
        if (ins>=0) pat->newData[row][DIV_PAT_INS]=ins;
        if (vol>=0) pat->newData[row][DIV_PAT_VOL]=vol;
        int k=0;
        for (auto& e: fxs) {
          if (k>=7) break;
          pat->newData[row][DIV_PAT_FX(k)]=e.first;
          pat->newData[row][DIV_PAT_FXVAL(k)]=e.second;
          k++;
        }
        if (k>maxCols[ch]) maxCols[ch]=k;
      }
    }
  }
  // padrão mais curto: 0D00 na última coluna livre do canal 1
  int endCol=MIN(7,maxCols[0]);
  for (int p=0; p<256; p++) {
    if (!used[p]) continue;
    int plen=MIN(rgvge::patternLength(p),maxLen);
    if (plen<maxLen) {
      DivPattern* pat=sub->pat[0].getPattern(p,true);
      pat->newData[plen-1][DIV_PAT_FX(endCol)]=0x0d;
      pat->newData[plen-1][DIV_PAT_FXVAL(endCol)]=0;
    }
  }
  // volta para o ponto de laço no fim (0Bxx); se o último padrão aparece em outro lugar, vira uma cópia
  if (h.loopPos>0 && sub->ordersLen>0) {
    int lastO=sub->ordersLen-1;
    int lp=sub->orders.ord[0][lastO];
    bool shared=false;
    for (int i=0; i<lastO; i++) {
      if (sub->orders.ord[0][i]==lp) shared=true;
    }
    if (shared) {
      int np=-1;
      for (int i=0; i<DIV_MAX_PATTERNS; i++) {
        if (!used[i]) {
          bool taken=false;
          for (int ch=0; ch<rgvge::CHANNELS; ch++) {
            if (sub->pat[ch].data[i]!=NULL) taken=true;
          }
          if (!taken) {
            np=i;
            break;
          }
        }
      }
      if (np>=0) {
        for (int ch=0; ch<rgvge::CHANNELS; ch++) {
          DivPattern* src=sub->pat[ch].getPattern(lp,true);
          DivPattern* dst=sub->pat[ch].getPattern(np,true);
          src->copyOn(dst);
          sub->orders.ord[ch][lastO]=np;
        }
        lp=np;
      }
    }
    int plen=MIN(rgvge::patternLength(rgvge::orderPattern(lastO)),maxLen);
    DivPattern* pat=sub->pat[0].getPattern(lp,true);
    int col=MIN(7,endCol+1);
    // o 0D00 do fim do padrão atrapalharia o pulo
    if (pat->newData[plen-1][DIV_PAT_FX(endCol)]==0x0d) {
      pat->newData[plen-1][DIV_PAT_FX(endCol)]=-1;
      pat->newData[plen-1][DIV_PAT_FXVAL(endCol)]=-1;
      col=endCol;
    }
    pat->newData[plen-1][DIV_PAT_FX(col)]=0x0b;
    pat->newData[plen-1][DIV_PAT_FXVAL(col)]=h.loopPos;
    if (col+1>maxCols[0]) maxCols[0]=col+1;
  }
  for (int ch=0; ch<rgvge::CHANNELS; ch++) sub->pat[ch].effectCols=MIN(8,MAX(1,maxCols[ch]));
  sub->pat[0].effectCols=MIN(8,MAX(sub->pat[0].effectCols,endCol+1));

  // instrumentos FM (o VGMMM guarda os operadores na ordem dos registradores, igual ao Furnace)
  for (int i=0; i<nFM; i++) {
    rgvge::Ins vi;
    rgvge::getIns(i,vi);
    DivInstrument* ins=new DivInstrument;
    ins->type=DIV_INS_FM;
    ins->name=vi.name;
    if (ins->name=="empty") ins->name="";
    ins->fm.alg=vi.alg&7;
    ins->fm.fb=vi.fb&7;
    ins->fm.ams=vi.ams&3;
    ins->fm.fms=vi.fms&7;
    for (int j=0; j<4; j++) {
      DivInstrumentFM::Operator& op=ins->fm.op[j];
      op.mult=vi.op[j].mult&15;
      op.dt=(vi.op[j].dt+3)&7;
      op.tl=vi.op[j].tl&0x7f;
      op.rs=vi.op[j].rs&3;
      op.ar=vi.op[j].ar&31;
      op.am=(vi.op[j].dr>>7)&1;
      op.dr=vi.op[j].dr&31;
      op.d2r=vi.op[j].sr&31;
      op.rr=vi.op[j].rr&15;
      op.sl=vi.op[j].sl&15;
      op.ssgEnv=vi.op[j].ssg&15;
    }
    ds.ins.push_back(ins);
  }
  // amostras (já convertidas pelo VGMMM na taxa da música) e um instrumento para cada uma
  for (int i=0; i<256; i++) {
    if (smpIns[i]<0) continue;
    DivSample* s=new DivSample;
    int l=0;
    const unsigned char* d=rgvge::sampleData(i,l);
    s->name=rgvge::sampleName(i);
    if (s->name=="empty" || s->name.empty()) s->name=fmt::sprintf("%.2X",i);
    s->centerRate=MAX(1,(int)h.sampleRate);
    s->legacyRate=s->centerRate;
    s->depth=DIV_SAMPLE_DEPTH_8BIT;
    if (d!=NULL && l>0 && s->init(l)) {
      for (int k=0; k<l; k++) s->data8[k]=(signed char)(d[k]-0x80);
    }
    DivInstrument* ins=new DivInstrument;
    ins->type=DIV_INS_AMIGA;
    ins->name=fmt::sprintf("DAC: %s",s->name);
    ins->amiga.initSample=ds.sample.size();
    ds.sample.push_back(s);
    ds.ins.push_back(ins);
  }
  // instrumentos do PSG: o VGMMM faz um ADSR por software com o operador 4 (macro ADSR do Furnace)
  {
    float rateTab[32];
    float v=1.0f;
    for (int i=0; i<32; i++) {
      rateTab[31-i]=v;
      v*=0.8f;
    }
    rateTab[0]=0.0f;
    for (auto& pe: psgList) {
      int n=pe.first, cv=pe.second;
      rgvge::Ins vi;
      rgvge::getIns(n-1,vi);
      DivInstrument* ins=new DivInstrument;
      ins->type=DIV_INS_STD;
      ins->name=fmt::sprintf("%s (PSG v%.2X)",(strcmp(vi.name,"empty")==0)?"":vi.name,cv);
      const rgvge::Op& o4=vi.op[3];
      // nível máximo = 15*escala (instrumento e volume), em 1/256 de passo
      double S=psgScale(n,cv);
      double full=S*256.0;
      int topP=(int)floor(full);
      int susP=(int)floor((15-(o4.sl&15))/15.0*full);
      DivInstrumentMacro& m=ins->std.volMacro;
      m.len=16; // ADSR: o Furnace guarda os parâmetros como 16 valores
      // ADSR fino (bit 16: fração do topo/sustain/fundo em val[9]/val[10]/val[11]). Com o volume fino
      // do SN76489 (rgFineVol), o nível sai como no VGMMM: teto(envelope*volume).
      m.open=3|16;
      m.val[0]=0;
      m.val[11]=0;
      m.val[1]=topP>>8;
      m.val[9]=topP&255;
      m.val[2]=(int)round(rateTab[o4.ar&31]*full);
      m.val[3]=0;
      m.val[4]=(int)round(rateTab[o4.dr&31]*full);
      m.val[5]=susP>>8;
      m.val[10]=susP&255;
      m.val[6]=0;
      m.val[7]=(int)round(rateTab[o4.sr&31]*full);
      m.val[8]=(int)round(rateTab[((o4.rr&15)*2)&31]*full);
      ds.ins.push_back(ins);
    }
  }
  ds.insLen=ds.ins.size();
  ds.sampleLen=ds.sample.size();
  BUSY_END;

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
