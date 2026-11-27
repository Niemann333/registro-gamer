#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <vector>
#include <iterator>
#include "bamboo_tracker.hpp"
#include "configuration.hpp"
#include "io/binary_container.hpp"
#include "io/wav_container.hpp"
int main(int argc,char**argv){
  if(argc<3){fprintf(stderr,"btref in.btm out.wav [emu]\n");return 1;}
  auto cfg=std::make_shared<Configuration>();
  if(argc>3) cfg->setEmulator(atoi(argv[3]));
  BambooTracker bt(cfg);
  std::ifstream f(argv[1],std::ios::binary);std::vector<uint8_t> d((std::istreambuf_iterator<char>(f)),std::istreambuf_iterator<char>());
  io::BinaryContainer c(d);
  bt.loadModule(c);
  bt.assignSampleADPCMRawSamples();
  switch (bt.getModuleMixerType()) {
    case MixerType::CUSTOM: bt.setMasterVolumeFM(bt.getModuleCustomMixerFMLevel()); bt.setMasterVolumeSSG(bt.getModuleCustomMixerSSGLevel()); break;
    case MixerType::PC_9821_PC_9801_86: bt.setMasterVolumeFM(0); bt.setMasterVolumeSSG(-5.5); break;
    case MixerType::PC_9821_SPEAK_BOARD: bt.setMasterVolumeFM(0); bt.setMasterVolumeSSG(-3.0); break;
    case MixerType::PC_8801_VA2: bt.setMasterVolumeFM(0); bt.setMasterVolumeSSG(1.5); break;
    case MixerType::PC_8801_MKII_SR: bt.setMasterVolumeFM(0); bt.setMasterVolumeSSG(2.5); break;
    default: break;
  }
  fprintf(stderr,"mixer %d fm %.1f ssg %.1f\n",(int)bt.getModuleMixerType(),bt.getModuleCustomMixerFMLevel(),bt.getModuleCustomMixerSSGLevel());
  if (getenv("SOLO")) { int so=atoi(getenv("SOLO")); for (int t=0;t<19;t++) bt.setTrackMuteState(t,t!=so); }
  io::WavContainer w(44100);
  bt.exportToWav(w,getenv("LOOPS")?atoi(getenv("LOOPS")):1,[]{return false;});
  std::ofstream o(argv[2],std::ios::binary);
  for(auto it=w.begin();it!=w.end();++it) o.put((char)*it);
  fprintf(stderr,"ok\n");
  return 0;
}
