#include "/home/claude/furnace/extern/vgmmm/rgvge.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
int main(int c,char**v){
  FILE*f=fopen(v[1],"rb");std::vector<unsigned char> b(10<<20);size_t n=fread(b.data(),1,b.size(),f);fclose(f);
  printf("load %d\n",rgvge::load(b.data(),n));
  std::vector<rgvge::Write> w;std::vector<int> d;
  rgvge::start(0,0,w,d);
  int T=atoi(v[2]);
  for(int t=0;t<=T;t++){
    if(t>0){w.clear();d.clear();int o,r;bool nr;rgvge::tick(w,d,o,r,nr);}
    printf("T%d",t);for(auto&x:w)printf(" %d:%02x=%02x",x.type,x.reg,x.val);for(int s:d)printf(" D%d",s);printf("\n");
  }
}
