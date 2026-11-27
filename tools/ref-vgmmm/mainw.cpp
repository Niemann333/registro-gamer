#include <cstdio>
#include <cstdlib>
#include "song.h"
#include "export.h"
#include "player.h"
int main(int argc,char**argv){
  tables_init(); sample_data_init();
  int r=song_load(argv[1]); if(r){fprintf(stderr,"load err %d\n",r);return 2;}
  g_wavFadeOut=false;
  chips_init(g_song.fmClock,g_song.psgClock,44100);
  bool all=true; if(getenv("MUTE")){chips_set_mute(strtol(getenv("MUTE"),0,0));all=false;}
  bool ok=export_wav(argv[2],all,nullptr,nullptr);
  fprintf(stderr,"wav %d\n",ok); return ok?0:3;
}
