#include "/home/claude/furnace/extern/bambootracker/rgbt.h"
#include <cstdio>
#include <vector>
#include <fstream>
#include <iterator>
int main(int c,char**v){
  std::ifstream f(v[1],std::ios::binary);std::vector<unsigned char> d((std::istreambuf_iterator<char>(f)),std::istreambuf_iterator<char>());
  rgbt::Player p; std::string m;
  printf("load %d %s\n",p.load(d.data(),d.size(),m),m.c_str());
  printf("songs %d tick %d ext %d orders %d\n",p.songCount(),p.tickFrequency(),p.songExtended(0),p.orderSize(0));
  std::vector<int> o,s;std::vector<long> t;int lo,ls;long tot;bool lp;
  p.timing(0,o,s,t,lo,ls,tot,lp);
  printf("steps %zu total %ld loop %d:%d %d\n",o.size(),tot,lo,ls,lp);
  std::vector<rgbt::Write> w; p.start(0,0,0,w); printf("start writes %zu\n",w.size());
  for(int i=0;i<5;i++){w.clear();int a,b;bool ns,e;p.tick(w,a,b,ns,e);printf("tick %d: %zu writes pos %d:%d ns %d end %d\n",i,w.size(),a,b,ns,e);}
}
