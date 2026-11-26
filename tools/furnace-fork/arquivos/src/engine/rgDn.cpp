/**
 * Registro Gamer: áudio do Dn-FamiTracker 0.5.3 dentro do Furnace (compatFlags.rgDnAudio).
 *
 * Os chips do FamiTracker (2A03, VRC6, VRC7, FDS, MMC5, N163, Sunsoft 5B) continuam rodando no Furnace
 * (para os osciloscópios e as exportações), mas o som que sai é o do APU/mixer do Dn, alimentado com as
 * mesmas escritas de registrador. Ver extern/dnft-apu.
 */

#include "engine.h"
#include "../ta-log.h"
#include "../../extern/dnft-apu/rgdn.h"

static int rgDnChipOfSystem(DivSystem sys, const DivConfig& flags) {
  switch (sys) {
    case DIV_SYSTEM_NES: return RGDN_2A03;
    case DIV_SYSTEM_VRC6: return RGDN_VRC6;
    case DIV_SYSTEM_VRC7: return RGDN_VRC7;
    case DIV_SYSTEM_FDS: return RGDN_FDS;
    case DIV_SYSTEM_MMC5: return RGDN_MMC5;
    case DIV_SYSTEM_N163: return RGDN_N163;
    case DIV_SYSTEM_AY8910: return (flags.getInt("chipType",0)==2)?RGDN_S5B:-1;
    default: return -1;
  }
}

void DivEngine::rgDnRelease() {
  for (int i=0; i<DIV_MAX_CHIPS; i++) {
    if (rgDnSys[i] && i<song.systemLen && disCont[i].dispatch!=NULL) disCont[i].dispatch->rgDnAttach(NULL,-1);
    rgDnSys[i]=false;
  }
  if (rgDn!=NULL) {
    delete rgDn;
    rgDn=NULL;
  }
}

void DivEngine::rgDnSetup() {
  rgDnRelease();
  if (!song.compatFlags.rgDnAudio) return;
  int expansions=0;
  bool used[RGDN_CHIPS]={};
  int sysOf[RGDN_CHIPS];
  bool pal=false;
  for (int i=0; i<song.systemLen; i++) {
    if (disCont[i].dispatch==NULL) continue;
    int c=rgDnChipOfSystem(song.system[i],song.systemFlags[i]);
    if (c<0 || used[c]) continue;
    used[c]=true;
    sysOf[c]=i;
    if (c==RGDN_2A03 && song.systemFlags[i].getInt("clockSel",0)==1) pal=true;
    switch (c) {
      case RGDN_VRC6: expansions|=1; break;
      case RGDN_VRC7: expansions|=2; break;
      case RGDN_FDS: expansions|=4; break;
      case RGDN_MMC5: expansions|=8; break;
      case RGDN_N163: expansions|=16; break;
      case RGDN_S5B: expansions|=32; break;
      default: break;
    }
  }
  if (!used[RGDN_2A03]) return;
  // timbres próprios do VRC7 (do .dnm)
  unsigned char opll[19*8];
  bool hasOPLL=false;
  if (used[RGDN_VRC7]) {
    String hex=song.systemFlags[sysOf[RGDN_VRC7]].getString("rgDnOPLL","");
    if (hex.size()>=19*8*2) {
      for (int i=0; i<19*8; i++) opll[i]=(unsigned char)strtol(hex.substr(i*2,2).c_str(),NULL,16);
      hasOPLL=true;
    }
  }
  rgDn=new RGDnAPU;
  int hz=(int)round(curSubSong->hz);
  rgDn->setup(expansions,hz,got.rate,pal,song.compatFlags.rgDnVRC7Patch,song.compatFlags.rgDnSurvey,song.compatFlags.rgDnLevels,hasOPLL?opll:NULL);
  for (int c=0; c<RGDN_CHIPS; c++) {
    if (!used[c]) continue;
    int i=sysOf[c];
    rgDnSys[i]=true;
    disCont[i].dispatch->rgDnAttach(rgDn,c);
  }
  // canais mudos
  for (int i=0; i<song.chans; i++) {
    int s=song.dispatchOfChan[i];
    if (s>=0 && s<DIV_MAX_CHIPS && rgDnSys[s] && isMuted[i]) {
      int c=rgDnChipOfSystem(song.system[s],song.systemFlags[s]);
      rgDn->setMute(c,song.dispatchChanOfChan[i],true);
    }
  }
  logI("Dn-FamiTracker audio: expansions %d, %d Hz, rate %d",expansions,hz,(int)got.rate);
}
