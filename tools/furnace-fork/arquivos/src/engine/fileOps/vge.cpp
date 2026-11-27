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
#include "../rgVgeMap.h"
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
  ds.compatFlags.rgVGMMM=true;
  ds.compatFlags.loopModality=2;
  // mixagem do VGMMM (chips.cpp: FM x(fmVolume*7+0x3c0)/256, PSG sem ganho): medida contra o WAV do próprio VGMMM
  ds.systemVol[0]=1.70f;
  ds.systemVol[1]=0.126f;

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

  // padrões usados
  bool used[256];
  memset(used,0,sizeof(used));
  int maxLen=1;
  for (int i=0; i<sub->ordersLen; i++) {
    int p=rgvge::orderPattern(i);
    used[p]=true;
    for (int ch=0; ch<rgvge::CHANNELS; ch++) sub->orders.ord[ch][i]=p;
    if (rgvge::patternLength(p)>maxLen) maxLen=rgvge::patternLength(p);
  }
  if (maxLen>DIV_MAX_ROWS) maxLen=DIV_MAX_ROWS;
  sub->patLen=maxLen;

  int maxIns=-1;
  bool fxUsed[rgvge::CHANNELS];
  memset(fxUsed,0,sizeof(fxUsed));
  for (int p=0; p<256; p++) {
    if (!used[p]) continue;
    int plen=MIN(rgvge::patternLength(p),maxLen);
    for (int ch=0; ch<rgvge::CHANNELS; ch++) {
      DivPattern* pat=sub->pat[ch].getPattern(p,true);
      for (int row=0; row<plen; row++) {
        rgvge::Cell c;
        rgvge::getCell(p,row,ch,c);
        if (c.note==rgvge::NOTE_OFF) {
          pat->newData[row][DIV_PAT_NOTE]=DIV_NOTE_OFF;
        } else if (c.note>=0 && c.note<12) {
          int n=60+c.octave*12+c.note;
          if (n>=0 && n<180) pat->newData[row][DIV_PAT_NOTE]=n;
        }
        if (c.volume>0) pat->newData[row][DIV_PAT_VOL]=rgVgeVolToFur(ch,c.volume);
        if (c.ins>0) {
          pat->newData[row][DIV_PAT_INS]=c.ins-1;
          if (c.ins-1>maxIns) maxIns=c.ins-1;
        }
        for (int f=0; f<4; f++) {
          short ofx, op;
          if (rgVgeFxToFur(c.fx[f],c.param[f],ofx,op)) {
            pat->newData[row][DIV_PAT_FX(f)]=ofx;
            pat->newData[row][DIV_PAT_FXVAL(f)]=op;
            fxUsed[ch]=true;
          }
        }
      }
      // padrão mais curto: 0D00 na quinta coluna do canal 1 (é por ele que o tamanho volta ao VGMMM)
      if (ch==0 && plen<maxLen) {
        pat->newData[plen-1][DIV_PAT_FX(4)]=0x0d;
        pat->newData[plen-1][DIV_PAT_FXVAL(4)]=0;
      }
    }
  }
  for (int ch=0; ch<rgvge::CHANNELS; ch++) sub->pat[ch].effectCols=4;
  sub->pat[0].effectCols=5;

  // instrumentos (o VGMMM usa o mesmo instrumento no PSG: envelope do operador 4)
  int lastIns=maxIns;
  for (int i=0; i<rgvge::MAX_INSTRUMENTS; i++) {
    if (!rgvge::insEmpty(i) && i>lastIns) lastIns=i;
  }
  if (lastIns<0) lastIns=0;
  for (int i=0; i<=lastIns; i++) {
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
      DivInstrumentFM::Operator& o=ins->fm.op[j];
      o.mult=vi.op[j].mult&15;
      o.dt=(vi.op[j].dt+3)&7;
      o.tl=vi.op[j].tl&0x7f;
      o.rs=vi.op[j].rs&3;
      o.ar=vi.op[j].ar&31;
      o.am=(vi.op[j].dr>>7)&1;
      o.dr=vi.op[j].dr&31;
      o.d2r=vi.op[j].sr&31;
      o.rr=vi.op[j].rr&15;
      o.sl=vi.op[j].sl&15;
      o.ssgEnv=vi.op[j].ssg&15;
    }
    ds.ins.push_back(ins);
  }
  ds.insLen=ds.ins.size();

  // amostras: já convertidas pelo VGMMM (volume e afinação aplicados) na taxa da música
  int lastSmp=-1;
  for (int i=0; i<rgvge::MAX_SAMPLES; i++) {
    int l=0;
    if (rgvge::sampleData(i,l)!=NULL && l>0) lastSmp=i;
  }
  for (int i=0; i<=lastSmp; i++) {
    DivSample* s=new DivSample;
    int l=0;
    const unsigned char* d=rgvge::sampleData(i,l);
    s->name=rgvge::sampleName(i);
    if (s->name=="empty") s->name="";
    s->centerRate=MAX(1,(int)h.sampleRate);
    s->legacyRate=s->centerRate;
    s->depth=DIV_SAMPLE_DEPTH_8BIT;
    if (d!=NULL && l>0) {
      if (s->init(l)) {
        for (int k=0; k<l; k++) s->data8[k]=(signed char)(d[k]-0x80);
      }
    }
    ds.sample.push_back(s);
  }
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
