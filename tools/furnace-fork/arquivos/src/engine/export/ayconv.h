// Registro Gamer: AY-3-8910 register writes for a console with another AY clock (KSS: MSX, AY: ZX Spectrum).
// the tone, noise and envelope periods are rescaled so the pitch stays the same; writes that change nothing
// are dropped (except the envelope shape, which restarts the envelope).
#ifndef _RG_AYCONV_H
#define _RG_AYCONV_H

#include <vector>
#include <math.h>

struct RGAYConv {
  double f; // target clock / source clock
  int in[16], out[16];
  bool clamped;
  RGAYConv(double ratio): f(ratio), clamped(false) {
    for (int i=0; i<16; i++) in[i]=0;
    forget();
  }
  void forget() {
    for (int i=0; i<16; i++) out[i]=-1;
  }
  bool exact() const { return fabs(f-1.0)<0.0005; }
  int scale(int v, int maxV) {
    if (exact()) return v;
    int r=(int)floor(v*f+0.5);
    if (v>0 && r<1) r=1;
    if (r>maxV) {
      r=maxV;
      clamped=true;
    }
    return r;
  }
  void put(std::vector<std::pair<int,int>>& o, int r, int v) {
    if (r!=13 && out[r]==v) return;
    out[r]=v;
    o.push_back(std::make_pair(r,v));
  }
  // returns the writes to make on the target chip
  void write(int r, int v, std::vector<std::pair<int,int>>& o) {
    if (r<0 || r>15) return;
    in[r]=v&0xff;
    if (r<6) {
      int ch=r>>1;
      int p=scale(in[ch*2]|((in[ch*2+1]&15)<<8),4095);
      put(o,ch*2,p&0xff);
      put(o,ch*2+1,(p>>8)|(in[ch*2+1]&0xf0));
    } else if (r==6) {
      put(o,6,scale(in[6]&31,31)|(in[6]&0xe0));
    } else if (r==11 || r==12) {
      int p=scale(in[11]|(in[12]<<8),65535);
      put(o,11,p&0xff);
      put(o,12,p>>8);
    } else {
      put(o,r,in[r]);
    }
  }
};

#endif
