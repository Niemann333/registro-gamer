#include <cstdio>
#include <cstdlib>
#include "song.h"
#include "export.h"
#include "player.h"
int main(int argc,char**argv){
  if(argc<3){fprintf(stderr,"vgmmmref in.vge out.vgm [v150]\n");return 1;}
  tables_init(); sample_data_init();
  int r=song_load(argv[1]); if(r){fprintf(stderr,"load err %d\n",r);return 2;}
  bool ok=export_vgm(argv[2],0,false,argc>3,false);
  fprintf(stderr,"export %d\n",ok); return ok?0:3;
}
