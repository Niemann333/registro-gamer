// RG: núcleo do BambooTracker (extern/bambootracker) num namespace próprio + a ponte rgbt.h
#include <algorithm>
#include <array>
#include <bitset>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <deque>
#include <exception>
#include <functional>
#include <iterator>
#include <limits>
#include <map>
#include <memory>
#include <mutex>
#include <numeric>
#include <set>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#include "rgbt.h"

namespace rgbtcore {
#include "chip/opna.cpp"
#include "note.cpp"
#include "tick_counter.cpp"
#include "module/effect.cpp"
#include "module/step.cpp"
#include "module/pattern.cpp"
#include "module/track.cpp"
#include "module/song.cpp"
#include "module/module.cpp"
#include "instrument/abstract_instrument_property.cpp"
#include "instrument/effect_iterator.cpp"
#include "instrument/envelope_fm.cpp"
#define DEF_PARAMS DEF_PARAMS_LFO
#include "instrument/lfo_fm.cpp"
#undef DEF_PARAMS
#include "instrument/sample_adpcm.cpp"
#include "instrument/sequence_property.cpp"
#include "instrument/instrument.cpp"
#include "instrument/instruments_manager.cpp"
#include "io/binary_container.cpp"
#include "io/io_utils.cpp"
#include "io/btm_io.cpp"
#include "io/module_io.cpp"
#include "opna_controller.cpp"
#include "playback.cpp"

// mesma conta do BambooTracker (bamboo_tracker.cpp, checkNextPositionOfLastStepAndStepSize):
// onde a música volta depois do último passo
static void rgEndPosition(Song& song, int& endOrder, int& endStep) {
  endOrder=0;
  endStep=0;
  std::vector<TrackAttribute> attribs=song.getTrackAttributes();
  std::unordered_set<int> orderStepMap;
  int lastOrder=static_cast<int>(song.getOrderSize())-1;
  for (int curOrder=0; !orderStepMap.count(curOrder); curOrder=endOrder) {
    orderStepMap.insert(curOrder);
    endOrder=(endOrder+1)%(lastOrder+1);
    endStep=0;
    for (auto attrib: attribs) {
      Step& step=song.getTrack(attrib.number).getPatternFromOrderNumber(curOrder)
                 .getStep(static_cast<int>(song.getPatternSizeFromOrderNumber(curOrder))-1);
      for (int i=0; i<Step::N_EFFECT; ++i) {
        Effect&& eff=effect_utils::validateEffect(attrib.source,step.getEffect(i));
        switch (eff.type) {
          case EffectType::PositionJump:
            if (eff.value<=lastOrder) {
              endOrder=eff.value;
              endStep=0;
            }
            break;
          case EffectType::SongEnd:
            endOrder=-1;
            endStep=-1;
            return;
          case EffectType::PatternBreak:
            if (curOrder==lastOrder && eff.value<static_cast<int>(song.getPatternSizeFromOrderNumber(0))) {
              endOrder=0;
              endStep=eff.value;
            } else if (eff.value<static_cast<int>(song.getPatternSizeFromOrderNumber(curOrder+1))) {
              endOrder=curOrder+1;
              endStep=eff.value;
            }
            break;
          default:
            break;
        }
      }
    }
  }
}
}

using namespace rgbtcore;

namespace rgbt {

struct Player::Impl {
  std::shared_ptr<InstrumentsManager> instMan;
  std::shared_ptr<TickCounter> tickCounter;
  std::shared_ptr<Module> mod;
  std::shared_ptr<OPNAController> opnaCtrl;
  std::unique_ptr<PlaybackManager> playback;
  int songNum=0;
  int endOrder=0, endStep=0;
  int lastOrder=-1, lastStep=-1;

  Impl() {
    instMan=std::make_shared<InstrumentsManager>(true);
    tickCounter=std::make_shared<TickCounter>();
    mod=std::make_shared<Module>();
    // os mesmos parâmetros do BambooTracker (bamboo_tracker.cpp); o "chip" aqui só guarda as escritas
    opnaCtrl=std::make_shared<OPNAController>(chip::OpnaEmulator::Nuked,3993600*2,44100,40,chip::ResamplerType::BlipBuf);
    opnaCtrl->setImmediateWriteMode(false);
    playback=std::make_unique<PlaybackManager>(opnaCtrl,instMan,tickCounter,mod,true);
  }

  chip::OPNA* chipPtr() {
    return opnaCtrl->rgChip();
  }

  void flush(std::vector<Write>& out) {
    chip::OPNA* c=chipPtr();
    for (auto& w: c->writes) {
      Write o;
      o.addr=w.addr;
      o.val=w.val;
      out.push_back(o);
    }
    c->writes.clear();
  }

  // como BambooTracker::setCurrentSongNumber
  void setSong(int num) {
    songNum=num;
    auto& song=mod->getSong(songNum);
    SongStyle style=song.getStyle();
    playback->setSong(mod,songNum);
    opnaCtrl->reset();
    opnaCtrl->setMode(style.type);
    tickCounter->resetCount();
    tickCounter->setTempo(song.getTempo());
    tickCounter->setSpeed(song.getSpeed());
    tickCounter->setGroove(mod->getGroove(song.getGroove()));
    tickCounter->setGrooveState(song.isUsedTempo()?GrooveState::Invalid:GrooveState::ValidByGlobal);
    std::unordered_map<SoundSource,int> pairs={
      {SoundSource::FM,(int)Song::getFMChannelCount(style.type)},
      {SoundSource::SSG,3},
      {SoundSource::RHYTHM,6},
      {SoundSource::ADPCM,1},
    };
    for (auto& pair: pairs) {
      for (int ch=0; ch<pair.second; ++ch) opnaCtrl->setMuteState(pair.first,ch,false);
    }
  }

  // como BambooTracker::assignSampleADPCMRawSamples (todas as amostras cadastradas)
  void assignSamples() {
    opnaCtrl->clearSamplesADPCM();
    std::vector<int> idcs=instMan->getSampleADPCMEntriedIndices();
    for (auto sampNum: idcs) {
      size_t startAddr, stopAddr;
      if (opnaCtrl->storeSampleADPCM(instMan->getSampleADPCMRawSample(sampNum),startAddr,stopAddr)) {
        instMan->setSampleADPCMStartAddress(sampNum,startAddr);
        instMan->setSampleADPCMStopAddress(sampNum,stopAddr);
      }
    }
  }
};

Player::Player(): p(new Impl) {}
Player::~Player() {
  delete p;
}

bool Player::load(const unsigned char* buf, size_t len, std::string& msg) {
  try {
    p->playback->stopPlaySong();
    p->opnaCtrl->reset();
    p->instMan=std::make_shared<InstrumentsManager>(true);
    p->mod=std::make_shared<Module>();
    p->playback=std::make_unique<PlaybackManager>(p->opnaCtrl,p->instMan,p->tickCounter,p->mod,true);
    std::vector<uint8_t> v(buf,buf+len);
    io::BinaryContainer c(v);
    io::ModuleIO::getInstance().loadModule(c,p->mod,p->instMan);
    p->tickCounter->setInterruptRate(p->mod->getTickFrequency());
    p->setSong(0);
    p->assignSamples();
  } catch (std::exception& e) {
    msg=e.what();
    return false;
  } catch (...) {
    msg="erro";
    return false;
  }
  return true;
}

std::string Player::title() { return p->mod->getTitle(); }
std::string Player::author() { return p->mod->getAuthor(); }
std::string Player::copyright() { return p->mod->getCopyright(); }
std::string Player::comment() { return p->mod->getComment(); }
int Player::tickFrequency() { return (int)p->mod->getTickFrequency(); }
int Player::songCount() { return (int)p->mod->getSongCount(); }
std::string Player::songTitle(int s) { return p->mod->getSong(s).getTitle(); }
bool Player::songExtended(int s) { return p->mod->getSong(s).getStyle().type==SongType::FM3chExpanded; }
int Player::songTempo(int s) { return p->mod->getSong(s).getTempo(); }
int Player::songSpeed(int s) { return p->mod->getSong(s).getSpeed(); }
int Player::songPatternSize(int s) { return (int)p->mod->getSong(s).getDefaultPatternSize(); }

std::vector<Track> Player::songTracks(int s) {
  std::vector<Track> ret;
  for (auto& a: p->mod->getSong(s).getTrackAttributes()) {
    Track t;
    switch (a.source) {
      case SoundSource::FM: t.source=FM; break;
      case SoundSource::SSG: t.source=SSG; break;
      case SoundSource::RHYTHM: t.source=RHYTHM; break;
      default: t.source=ADPCM; break;
    }
    t.channel=a.channelInSource;
    ret.push_back(t);
  }
  return ret;
}

int Player::orderSize(int s) { return (int)p->mod->getSong(s).getOrderSize(); }
int Player::patternIndex(int s, int track, int order) {
  return p->mod->getSong(s).getTrack(track).getOrderInfo(order).patten;
}
int Player::patternSize(int s, int order) {
  return (int)p->mod->getSong(s).getPatternSizeFromOrderNumber(order);
}

void Player::getStep(int s, int track, int order, int step, Step& out) {
  rgbtcore::Step& st=p->mod->getSong(s).getTrack(track).getPatternFromOrderNumber(order).getStep(step);
  out.note=st.getNoteNumber();
  out.ins=st.getInstrumentNumber();
  out.vol=st.getVolume();
  for (int i=0; i<4; i++) {
    std::string id=st.getEffectId(i);
    out.fx[i].id[0]=id.size()>0?id[0]:0;
    out.fx[i].id[1]=id.size()>1?id[1]:0;
    out.fx[i].id[2]=0;
    if (id=="--") out.fx[i].id[0]=0;
    out.fx[i].value=st.getEffectValue(i);
  }
}

std::vector<InsInfo> Player::instruments() {
  std::vector<InsInfo> ret;
  for (int n: p->instMan->getInstrumentIndices()) {
    auto ins=p->instMan->getInstrumentSharedPtr(n);
    if (!ins) continue;
    InsInfo i;
    i.number=n;
    i.name=ins->getName();
    i.type=(int)ins->getType();
    i.alg=i.fb=0;
    i.sample=-1;
    for (int o=0; o<4; o++) {
      i.ar[o]=i.dr[o]=i.sr[o]=i.rr[o]=i.sl[o]=i.tl[o]=i.ks[o]=i.ml[o]=i.dt[o]=0;
      i.ssgeg[o]=-1;
      i.am[o]=0;
      i.opOn[o]=true;
    }
    if (ins->getType()==InstrumentType::FM) {
      int env=p->instMan->getInstrumentFMEnvelope(n);
      auto g=[&](FMEnvelopeParameter prm) { return p->instMan->getEnvelopeFMParameter(env,prm); };
      i.alg=g(FMEnvelopeParameter::AL);
      i.fb=g(FMEnvelopeParameter::FB);
      const FMEnvelopeParameter ps[4][9]={
        {FMEnvelopeParameter::AR1,FMEnvelopeParameter::DR1,FMEnvelopeParameter::SR1,FMEnvelopeParameter::RR1,FMEnvelopeParameter::SL1,FMEnvelopeParameter::TL1,FMEnvelopeParameter::KS1,FMEnvelopeParameter::ML1,FMEnvelopeParameter::DT1},
        {FMEnvelopeParameter::AR2,FMEnvelopeParameter::DR2,FMEnvelopeParameter::SR2,FMEnvelopeParameter::RR2,FMEnvelopeParameter::SL2,FMEnvelopeParameter::TL2,FMEnvelopeParameter::KS2,FMEnvelopeParameter::ML2,FMEnvelopeParameter::DT2},
        {FMEnvelopeParameter::AR3,FMEnvelopeParameter::DR3,FMEnvelopeParameter::SR3,FMEnvelopeParameter::RR3,FMEnvelopeParameter::SL3,FMEnvelopeParameter::TL3,FMEnvelopeParameter::KS3,FMEnvelopeParameter::ML3,FMEnvelopeParameter::DT3},
        {FMEnvelopeParameter::AR4,FMEnvelopeParameter::DR4,FMEnvelopeParameter::SR4,FMEnvelopeParameter::RR4,FMEnvelopeParameter::SL4,FMEnvelopeParameter::TL4,FMEnvelopeParameter::KS4,FMEnvelopeParameter::ML4,FMEnvelopeParameter::DT4}
      };
      const FMEnvelopeParameter ssg[4]={FMEnvelopeParameter::SSGEG1,FMEnvelopeParameter::SSGEG2,FMEnvelopeParameter::SSGEG3,FMEnvelopeParameter::SSGEG4};
      for (int o=0; o<4; o++) {
        i.ar[o]=g(ps[o][0]);
        i.dr[o]=g(ps[o][1]);
        i.sr[o]=g(ps[o][2]);
        i.rr[o]=g(ps[o][3]);
        i.sl[o]=g(ps[o][4]);
        i.tl[o]=g(ps[o][5]);
        i.ks[o]=g(ps[o][6]);
        i.ml[o]=g(ps[o][7]);
        i.dt[o]=g(ps[o][8]);
        i.ssgeg[o]=g(ssg[o]);
        i.opOn[o]=p->instMan->getEnvelopeFMOperatorEnabled(env,o);
      }
    } else if (ins->getType()==InstrumentType::ADPCM) {
      i.sample=p->instMan->getInstrumentADPCMSample(n);
    }
    ret.push_back(i);
  }
  return ret;
}

template<class U> static auto rgSubOf(const U& u, int) -> decltype(u.subdata, int()) { return (u.subdata&0x3ffff)|((int)u.type<<20); }
template<class U> static int rgSubOf(const U&, long) { return 0; }

// toca a sequência pelo próprio iterador: um valor por tique, até 256; acha o laço e a soltura
template<class ITF> static Seq rgRenderSeq(ITF mk, int type, bool hasSub) {
  Seq q;
  q.on=true;
  q.type=type;
  const int MAXN=240;
  std::vector<int> v, s;
  bool ended=false;
  {
    auto it=mk();
    it->front();
    for (int k=0; k<MAXN; k++) {
      if (it->hasEnded()) { ended=true; break; }
      auto d=it->data();
      v.push_back(d.data);
      s.push_back(hasSub?rgSubOf(d,0):0);
      it->next();
    }
  }
  if (!ended) {
    // menor laço [L, fim) que se repete até o fim do que foi tocado
    int n=(int)v.size();
    int bestL=-1, bestP=0;
    for (int P=1; P<=n/2 && bestL<0; P++) {
      for (int L=0; L+2*P<=n; L++) {
        bool ok=true;
        for (int i=L; i+P<n; i++) if (v[i]!=v[i+P] || s[i]!=s[i+P]) { ok=false; break; }
        if (ok) { bestL=L; bestP=P; break; }
      }
    }
    if (bestL>=0) {
      v.resize(bestL+bestP);
      s.resize(bestL+bestP);
      q.loop=bestL;
    }
  }
  // soltura: solta depois do que foi tocado
  {
    auto it=mk();
    it->front();
    for (int k=0; k<(int)v.size() && !it->hasEnded(); k++) it->next();
    it->release();
    std::vector<int> rv, rs;
    for (int k=0; k<64 && !it->hasEnded(); k++) {
      auto d=it->data();
      rv.push_back(d.data);
      rs.push_back(hasSub?rgSubOf(d,0):0);
      it->next();
    }
    if (!rv.empty() && v.size()+rv.size()<=250) {
      q.rel=(int)v.size();
      v.insert(v.end(),rv.begin(),rv.end());
      s.insert(s.end(),rs.begin(),rs.end());
    }
  }
  q.val=v;
  q.sub=s;
  return q;
}

std::vector<InsDetail> Player::instrumentDetails() {
  std::vector<InsDetail> ret;
  for (int n: p->instMan->getInstrumentIndices()) {
    auto ins=p->instMan->getInstrumentSharedPtr(n);
    if (!ins) continue;
    InsDetail d;
    d.number=n;
    d.type=(int)ins->getType();
    if (auto f=std::dynamic_pointer_cast<InstrumentFM>(ins)) {
      d.envReset=f->getEnvelopeResetEnabled(FMOperatorType::All);
      if (f->getArpeggioEnabled(FMOperatorType::All)) d.arp=rgRenderSeq([&](){ return f->getArpeggioSequenceIterator(FMOperatorType::All); },(int)f->getArpeggioType(FMOperatorType::All),false);
      if (f->getPitchEnabled(FMOperatorType::All)) d.pitch=rgRenderSeq([&](){ return f->getPitchSequenceIterator(FMOperatorType::All); },(int)f->getPitchType(FMOperatorType::All),false);
      if (f->getPanEnabled()) d.pan=rgRenderSeq([&](){ return f->getPanSequenceIterator(); },0,false);
      for (int pi=0; pi<(int)FMEnvelopeParameter::SSGEG4+1; pi++) {
        bool en=false;
        try { en=f->getOperatorSequenceEnabled((FMEnvelopeParameter)pi); } catch (...) { en=false; }
        if (en) { d.unsupported.push_back("sequência de operador"); break; }
      }
      if (f->getLFOEnabled()) {
        d.lfoOn=true;
        d.lfoFreq=f->getLFOParameter(FMLFOParameter::FREQ);
        d.lfoAMS=f->getLFOParameter(FMLFOParameter::AMS);
        d.lfoPMS=f->getLFOParameter(FMLFOParameter::PMS);
        d.lfoAM[0]=f->getLFOParameter(FMLFOParameter::AM1);
        d.lfoAM[1]=f->getLFOParameter(FMLFOParameter::AM2);
        d.lfoAM[2]=f->getLFOParameter(FMLFOParameter::AM3);
        d.lfoAM[3]=f->getLFOParameter(FMLFOParameter::AM4);
      }
      for (auto op: {FMOperatorType::Op1,FMOperatorType::Op2,FMOperatorType::Op3,FMOperatorType::Op4}) {
        if (f->getArpeggioEnabled(op) || f->getPitchEnabled(op)) { d.unsupported.push_back("arpejo/altura por operador"); break; }
      }
    } else if (auto g=std::dynamic_pointer_cast<InstrumentSSG>(ins)) {
      if (g->getWaveformEnabled()) d.ssgWave=rgRenderSeq([&](){ return g->getWaveformSequenceIterator(); },0,true);
      if (g->getToneNoiseEnabled()) d.ssgTN=rgRenderSeq([&](){ return g->getToneNoiseSequenceIterator(); },0,false);
      if (g->getEnvelopeEnabled()) d.ssgEnv=rgRenderSeq([&](){ return g->getEnvelopeSequenceIterator(); },0,true);
      if (g->getArpeggioEnabled()) d.arp=rgRenderSeq([&](){ return g->getArpeggioSequenceIterator(); },(int)g->getArpeggioType(),false);
      if (g->getPitchEnabled()) d.pitch=rgRenderSeq([&](){ return g->getPitchSequenceIterator(); },(int)g->getPitchType(),false);
    } else if (auto a=std::dynamic_pointer_cast<InstrumentADPCM>(ins)) {
      d.rootKey=a->getSampleRootKeyNumber();
      d.rootDeltaN=a->getSampleRootDeltaN();
      d.repeat=a->isSampleRepeatable();
      if (a->getEnvelopeEnabled()) d.adpcmEnv=rgRenderSeq([&](){ return a->getEnvelopeSequenceIterator(); },0,false);
      if (a->getArpeggioEnabled()) d.arp=rgRenderSeq([&](){ return a->getArpeggioSequenceIterator(); },(int)a->getArpeggioType(),false);
      if (a->getPitchEnabled()) d.pitch=rgRenderSeq([&](){ return a->getPitchSequenceIterator(); },(int)a->getPitchType(),false);
    } else {
      d.unsupported.push_back("bateria de ADPCM");
    }
    ret.push_back(d);
  }
  return ret;
}

std::vector<SampleInfo> Player::samples() {
  std::vector<SampleInfo> ret;
  for (int n: p->instMan->getSampleADPCMEntriedIndices()) {
    SampleInfo s;
    s.number=n;
    s.data=p->instMan->getSampleADPCMRawSample(n);
    s.rootRate=p->instMan->getSampleADPCMRootDeltaN(n);
    ret.push_back(s);
  }
  return ret;
}

int Player::mixerType() { return (int)p->mod->getMixerType(); }
double Player::mixerFM() { return p->mod->getCustomMixerFMLevel(); }
double Player::mixerSSG() { return p->mod->getCustomMixerSSGLevel(); }

void Player::start(int s, int order, int step, std::vector<Write>& out) {
  p->playback->stopPlaySong();
  if (s<0 || s>=songCount()) s=0;
  p->setSong(s);
  p->assignSamples();
  rgEndPosition(p->mod->getSong(s),p->endOrder,p->endStep);
  if (order<=0 && step<=0) {
    p->playback->startPlayFromStart();
  } else {
    p->playback->startPlayFromPosition(order,step);
  }
  p->lastOrder=-1;
  p->lastStep=-1;
  p->flush(out);
}

bool Player::tick(std::vector<Write>& out, int& order, int& step, bool& newStep, bool& ended) {
  int state=p->playback->streamCountUp();
  p->flush(out);
  order=p->playback->getPlayingOrderNumber();
  step=p->playback->getPlayingStepNumber();
  newStep=(state==0);
  ended=(order==-1 && step==-1);
  bool looped=false;
  if (newStep) {
    // voltou para o ponto de laço (pulou para trás, depois do último passo)
    if (p->lastOrder>=0 && order==p->endOrder && step==p->endStep &&
        (order<p->lastOrder || (order==p->lastOrder && step<=p->lastStep))) looped=true;
    p->lastOrder=order;
    p->lastStep=step;
  }
  return looped;
}

const unsigned char* Player::dram(size_t& len) {
  chip::OPNA* c=p->chipPtr();
  len=c->dram_.size();
  return c->dram_.data();
}

void Player::timing(int s, std::vector<int>& orderOut, std::vector<int>& stepOut, std::vector<long>& tickOut, int& loopOrder, int& loopStep, long& totalTicks, bool& loops) {
  std::vector<Write> dummy;
  start(s,0,0,dummy);
  loopOrder=p->endOrder;
  loopStep=p->endStep;
  loops=(loopOrder>=0);
  long t=0;
  // limite: 2 horas a 60 Hz
  for (long i=0; i<432000; i++) {
    int o, st;
    bool ns, ended;
    bool looped=tick(dummy,o,st,ns,ended);
    dummy.clear();
    if (ended) break;
    if (looped) break;
    if (ns) {
      orderOut.push_back(o);
      stepOut.push_back(st);
      tickOut.push_back(t);
    }
    t++;
  }
  totalTicks=t;
  p->playback->stopPlaySong();
}

}
