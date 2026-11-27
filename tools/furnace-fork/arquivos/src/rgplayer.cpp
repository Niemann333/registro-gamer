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

// Registro Gamer: Furnace's engine as a module player for the blog's Chiptune Player.
// plays everything Furnace opens: .fur, .dmf, .ftm, .0cc, .dnm, .eft, .tfm, .tfe, .fc, .mod, .s3m, .xm, .it...
// built with -DRG_PLAYER=ON (no interface, no audio backend: the page asks for audio with rgf_render).

#include "engine/engine.h"
#include "ta-log.h"
#include <fmt/printf.h>
#include <string.h>
#include <stdlib.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define RGF_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define RGF_EXPORT extern "C"
#endif

// main.cpp is not part of this build
void reportError(String what) {
  logE("%s",what);
}

static DivEngine* e=NULL;
static int sampleRate=44100;
static String strBuf;

RGF_EXPORT int rgf_init(int rate) {
  if (e!=NULL) return 1;
  sampleRate=rate;
  logLevel=LOGLEVEL_WARN;
#ifndef __EMSCRIPTEN__
  if (getenv("RGF_LOG")) {
    initLog(stderr);
    logLevel=atoi(getenv("RGF_LOG"));
  }
#endif
  e=new DivEngine;
  e->setAudio(DIV_AUDIO_DUMMY);
  e->setView(DIV_STATUS_NOTHING);
  e->preInit(true);
  if (!e->init()) return 0;
  // RG: teste de núcleos de emulação (RGF_CONF=chave=valor,chave=valor), só no binário nativo
#ifndef __EMSCRIPTEN__
  if (getenv("RGF_CONF")) {
    String c=getenv("RGF_CONF");
    size_t p=0;
    while (p<c.size()) {
      size_t q=c.find(',',p); if (q==String::npos) q=c.size();
      String kv=c.substr(p,q-p); size_t eq=kv.find('=');
      if (eq!=String::npos) e->setConf(kv.substr(0,eq),atoi(kv.substr(eq+1).c_str()));
      p=q+1;
    }
  }
#endif
  return 1;
}

// data is copied; nameHint helps with formats that have no magic (.tfe, .mod)
RGF_EXPORT int rgf_load(const unsigned char* data, int len, const char* nameHint) {
  if (e==NULL || len<=0) return 0;
  unsigned char* buf=new unsigned char[len];
  memcpy(buf,data,len);
  if (!e->load(buf,len,nameHint)) {
    return 0;
  }
  return e->rgPlayStart(sampleRate)?1:0;
}

RGF_EXPORT const char* rgf_error() {
  strBuf=(e==NULL)?String("not initialized"):e->getLastError();
  return strBuf.c_str();
}

RGF_EXPORT int rgf_subsongs() {
  return (e==NULL)?0:(int)e->song.subsong.size();
}

RGF_EXPORT int rgf_subsong(int i) {
  if (e==NULL || i<0 || i>=(int)e->song.subsong.size()) return 0;
  e->changeSongP(i);
  return e->rgPlayStart(sampleRate)?1:0;
}

// nome da subfaixa i (sem trocar a música que está tocando)
RGF_EXPORT const char* rgf_subsong_name(int i) {
  if (e==NULL || i<0 || i>=(int)e->song.subsong.size()) return "";
  strBuf=e->song.subsong[i]->name;
  return strBuf.c_str();
}

RGF_EXPORT int rgf_restart() {
  return (e!=NULL && e->rgPlayStart(sampleRate))?1:0;
}

// jumps to ms without rendering; returns where it landed (ms)
RGF_EXPORT double rgf_seek(double ms) {
  if (e==NULL) return 0;
  return e->rgPlaySeek(ms/1000.0)*1000.0;
}

// renders n frames into l and r; returns 0 when the song has stopped
RGF_EXPORT int rgf_render(float* l, float* r, int n) {
  if (e==NULL) return 0;
  return e->rgPlayRender(l,r,n)?1:0;
}

// times in milliseconds: [total, loop start, loops (0/1)]
RGF_EXPORT void rgf_times(double* out) {
  double total=0, loopStart=0;
  bool loops=false;
  if (e!=NULL) e->rgPlayTimes(total,loopStart,loops);
  out[0]=total*1000.0;
  out[1]=loopStart*1000.0;
  out[2]=loops?1:0;
}

RGF_EXPORT const char* rgf_info(int what) {
  if (e==NULL) return "";
  switch (what) {
    case 0: strBuf=e->song.name; break;
    case 1: strBuf=e->song.author; break;
    case 2: strBuf=e->song.category; break; // game
    case 3: strBuf=e->song.systemName; break;
    case 4: strBuf=e->curSubSong->name; break;
    case 5: strBuf=fmt::sprintf("%.2f",e->song.tuning); break;
    default: strBuf=""; break;
  }
  return strBuf.c_str();
}

RGF_EXPORT int rgf_channels() {
  return (e==NULL)?0:e->getTotalChannelCount();
}

RGF_EXPORT const char* rgf_channel_name(int c) {
  if (e==NULL) return "";
  strBuf=e->getChannelName(c);
  return strBuf.c_str();
}

RGF_EXPORT void rgf_mute(int c, int mute) {
  if (e!=NULL && c>=0 && c<e->getTotalChannelCount()) e->muteChannel(c,mute!=0);
}

// RG: converte a música carregada (subfaixa atual) em VGM, para o Chiptune Studio abrir módulos.
// Devolve o tamanho; o ponteiro sai por rgf_vgm_data(). Depois disso o tocador precisa de rgf_restart().
static unsigned char* vgmBuf=NULL;
static int vgmLen=0;
static int vgmKind=0; // 0 = VGM, 1 = NSF
RGF_EXPORT int rgf_vgm() {
  if (e==NULL) return 0;
  if (vgmBuf) { delete[] vgmBuf; vgmBuf=NULL; vgmLen=0; }
  vgmKind=0;
  // VRC6, N163 e MMC5 não existem no formato VGM: a música vira NSF (o Studio já abre NSF com as expansões)
  bool nesExp=false;
  for (int i=0; i<e->song.systemLen; i++) {
    DivSystem s=e->song.system[i];
    if (s==DIV_SYSTEM_VRC6 || s==DIV_SYSTEM_N163 || s==DIV_SYSTEM_MMC5) nesExp=true;
  }
  if (nesExp) {
    DivROMExport* x=e->buildROM(DIV_ROM_NSF);
    if (x!=NULL) {
      if (x->go(e)) {
        x->wait();
        if (!x->hasFailed() && !x->getResult().empty()) {
          SafeWriter* nw=x->getResult()[0].data;
          vgmLen=(int)nw->size();
          vgmBuf=new unsigned char[vgmLen];
          memcpy(vgmBuf,nw->getFinalBuf(),vgmLen);
          vgmKind=1;
        }
      }
      delete x;
      if (vgmKind==1) return vgmLen;
    }
  }
  SafeWriter* w=e->saveVGM(NULL,true,0x171,false,false);
  if (w==NULL) return 0;
  vgmLen=(int)w->size();
  vgmBuf=new unsigned char[vgmLen];
  memcpy(vgmBuf,w->getFinalBuf(),vgmLen);
  w->finish();
  delete w;
  return vgmLen;
}
RGF_EXPORT int rgf_vgm_kind() {
  return vgmKind;
}
RGF_EXPORT unsigned char* rgf_vgm_data() {
  return vgmBuf;
}
// avisos da última conversão (chips que o VGM não comporta etc.)
RGF_EXPORT const char* rgf_warnings() {
  strBuf=(e==NULL)?String(""):e->getWarnings();
  return strBuf.c_str();
}

#ifndef __EMSCRIPTEN__
// native test: rgplayer file.ftm out.raw seconds
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
int main(int argc, char** argv) {
  if (argc<4) return 1;
  FILE* f=fopen(argv[1],"rb");
  if (!f) return 1;
  fseek(f,0,SEEK_END);
  long n=ftell(f);
  fseek(f,0,SEEK_SET);
  unsigned char* d=new unsigned char[n];
  if (fread(d,1,n,f)!=(size_t)n) return 1;
  fclose(f);
  rgf_init(44100);
  if (!rgf_load(d,n,argv[1])) {
    fprintf(stderr,"load failed: %s\n",rgf_error());
    return 2;
  }
  double t[3];
  // teste: tocar com o tocador original (VGM Music Maker / BambooTracker)
  if (getenv("RGF_ORIG")) {
    if (e->song.systemFlags[0].getString("rgVgeData","")!="") e->song.compatFlags.rgVGMMM=true;
    if (e->song.systemFlags[0].getString("rgBTData","")!="") { e->song.compatFlags.rgBT=true; e->song.compatFlags.rgBTNative=false; }
    e->rgPlayStart(e->getAudioDescGot().rate);
  }
  if (getenv("RGF_VGM")) {
    int n=rgf_vgm();
    FILE* vf=fopen(getenv("RGF_VGM"),"wb");
    if (vf) { fwrite(rgf_vgm_data(),1,n,vf); fclose(vf); }
    fprintf(stderr,"vgm %d bytes (tipo %d); avisos: %s\n",n,rgf_vgm_kind(),rgf_warnings());
    fflush(stderr);
    _exit(0);
  }
  rgf_times(t);
  fprintf(stderr,"tuning %s\n",rgf_info(5));
  fprintf(stderr,"%s / %s / %s: %.1fs, loop %.1fs (%d), %d channels, %d subsongs\n",rgf_info(0),rgf_info(1),rgf_info(3),t[0]/1000,t[1]/1000,(int)t[2],rgf_channels(),rgf_subsongs());
  // RG_SOLO=n: toca só o canal n (para comparar canal a canal)
  if (getenv("RGF_SOLO")) {
    int solo=atoi(getenv("RGF_SOLO"));
    for (int i=0; i<rgf_channels(); i++) rgf_mute(i,i!=solo);
  }
  // RGF_SYSSOLO=n: toca só os canais do sistema (chip) n da música
  if (getenv("RGF_SYSSOLO")) {
    int solo=atoi(getenv("RGF_SYSSOLO"));
    int sub=getenv("RGF_SYSCH")?atoi(getenv("RGF_SYSCH")):-1;
    for (int i=0; i<rgf_channels(); i++) rgf_mute(i,e->song.dispatchOfChan[i]!=solo || (sub>=0 && e->song.dispatchChanOfChan[i]!=sub));
  }
  if (argc>4) fprintf(stderr,"seek -> %.3f s\n",rgf_seek(atof(argv[4])*1000.0)/1000.0);
  FILE* o=fopen(argv[2],"wb");
  int total=atoi(argv[3])*44100;
  // RGF_REGLOG=arquivo: registra as escritas de registrador de todos os chips ("tempo sistema endereço valor")
  FILE* rl=NULL;
  if (getenv("RGF_REGLOG")) {
    rl=fopen(getenv("RGF_REGLOG"),"w");
    for (int i=0; i<e->song.systemLen; i++) if (e->getDispatch(i)) e->getDispatch(i)->toggleRegisterDump(true);
  }
  if (rl) {
    float l2[128], r2[128];
    int ck=getenv("RGF_CHUNK")?CLAMP(atoi(getenv("RGF_CHUNK")),1,128):128;
    for (int done=0; done<total; done+=ck) {
      rgf_render(l2,r2,ck);
      for (int i=0; i<e->song.systemLen; i++) {
        if (!e->getDispatch(i)) continue;
        std::vector<DivRegWrite>& w=e->getDispatch(i)->getRegisterWrites();
        int mask=0xff;
        for (DivRegWrite& j: w) {
          if ((j.addr&0xffff0000)==0xfffe0000) { mask=j.addr&0xff; continue; }
          if (j.addr<0xffff0000) {
            if (mask!=0xff) fprintf(rl,"%.6f %d %x %d %d\n",done/44100.0,i,j.addr,j.val,mask);
            else fprintf(rl,"%.6f %d %x %d\n",done/44100.0,i,j.addr,j.val);
          }
          mask=0xff;
        }
        w.clear();
      }
    }
    fclose(rl);
    fclose(o);
    _exit(0);
  }
  float l[1024], r[1024];
  short s[2048];
  for (int done=0; done<total; done+=1024) {
    rgf_render(l,r,1024);
    for (int i=0; i<1024; i++) {
      float a=l[i], b=r[i];
      if (a>1) a=1;
      if (a<-1) a=-1;
      if (b>1) b=1;
      if (b<-1) b=-1;
      s[i*2]=(short)(a*32767);
      s[i*2+1]=(short)(b*32767);
    }
    fwrite(s,4,1024,o);
  }
  fclose(o);
  fflush(stderr);
  _exit(0);
}
#endif
