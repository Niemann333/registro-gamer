// teste: snsfwav saida.wav segundos arquivo... (na ordem de carga)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <stdint.h>
#include <stdio.h>
extern "C" { void snsf_dump(const char*); void snsf_begin(); int snsf_add_psf(const uint8_t*,int); int snsf_start(int); int snsf_render(int16_t*,int); }
int main(int argc, char** argv) {
  snsf_begin();
  for (int i=3; i<argc; i++) {
    FILE* f=fopen(argv[i],"rb"); if (!f) return 1;
    std::vector<uint8_t> d; int c; while ((c=fgetc(f))!=EOF) d.push_back(c); fclose(f);
    int r=snsf_add_psf(d.data(),d.size()); if (r) { fprintf(stderr,"erro %d em %s\n",r,argv[i]); return 1; }
  }
  if (snsf_start(44100)) { fprintf(stderr,"start falhou\n"); return 1; }
  int secs=atoi(argv[2]); int n=44100*secs;
  std::vector<int16_t> a(n*2);
  for (int i=0; i<n; i+=441) {
    snsf_render(&a[i*2], (n-i<441)?(n-i):441);
#ifdef RG_DEBUG
    { char fn[64]; sprintf(fn,"dump_%03d.spc",i/441); if (getenv("RG_DUMPS")) snsf_dump(fn); }
#endif
  }
#ifdef RG_DEBUG
  snsf_dump("dump.spc");
#endif
  FILE* o=fopen(argv[1],"wb");
  uint32_t ds=n*4; uint8_t h[44]={'R','I','F','F'}; 
  auto w32=[&](int at,uint32_t v){h[at]=v;h[at+1]=v>>8;h[at+2]=v>>16;h[at+3]=v>>24;};
  w32(4,36+ds); memcpy(h+8,"WAVEfmt ",8); w32(16,16); h[20]=1; h[22]=2; w32(24,44100); w32(28,44100*4); h[32]=4; h[34]=16; memcpy(h+36,"data",4); w32(40,ds);
  fwrite(h,1,44,o); fwrite(a.data(),2,n*2,o); fclose(o);
  return 0;
}
