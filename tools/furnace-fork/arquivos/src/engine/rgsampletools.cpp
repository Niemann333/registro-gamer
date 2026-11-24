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

#include "rgsampletools.h"
#include "../ta-utils.h"
#include <math.h>
#include <vector>
#include <string.h>

static bool rgEditable(DivSample* s) {
  if (s==NULL) return false;
  if (s->depth==DIV_SAMPLE_DEPTH_8BIT) return s->data8!=NULL;
  if (s->depth==DIV_SAMPLE_DEPTH_16BIT) return s->data16!=NULL;
  return false;
}

static std::vector<float> rgRead(DivSample* s) {
  std::vector<float> v(s->samples);
  for (unsigned int i=0; i<s->samples; i++) {
    v[i]=(s->depth==DIV_SAMPLE_DEPTH_8BIT)?(s->data8[i]/128.0f):(s->data16[i]/32768.0f);
  }
  return v;
}

static void rgPut(DivSample* s, unsigned int i, float x) {
  if (s->depth==DIV_SAMPLE_DEPTH_8BIT) {
    float y=round(x*128.0f);
    s->data8[i]=(signed char)CLAMP(y,-128.0f,127.0f);
  } else {
    float y=round(x*32768.0f);
    s->data16[i]=(short)CLAMP(y,-32768.0f,32767.0f);
  }
}

static void rgFix(DivSample* s, unsigned int& start, unsigned int& end) {
  if (end>s->samples || end<=start) {
    start=0;
    end=s->samples;
  }
}

bool rgSampleRemoveDC(DivSample* s, unsigned int start, unsigned int end) {
  if (!rgEditable(s) || s->samples==0) return false;
  rgFix(s,start,end);
  std::vector<float> v=rgRead(s);
  double sum=0;
  for (unsigned int i=start; i<end; i++) sum+=v[i];
  float avg=(float)(sum/MAX(1u,end-start));
  for (unsigned int i=start; i<end; i++) rgPut(s,i,v[i]-avg);
  return true;
}

bool rgSampleDeclick(DivSample* s, unsigned int start, unsigned int end, int len) {
  if (!rgEditable(s) || s->samples==0) return false;
  rgFix(s,start,end);
  std::vector<float> v=rgRead(s);
  unsigned int n=MIN((unsigned int)MAX(1,len),(end-start)/2);
  for (unsigned int i=0; i<n; i++) {
    float g=0.5f-0.5f*cos(M_PI*(i+0.5)/n);
    rgPut(s,start+i,v[start+i]*g);
    rgPut(s,end-1-i,v[end-1-i]*g);
  }
  return true;
}

double rgSampleDetectPitch(DivSample* s) {
  if (!rgEditable(s) || s->samples<64) return 0;
  std::vector<float> v=rgRead(s);
  double rate=MAX(1,s->centerRate);
  // a window from the loop (if any) or from after the attack
  size_t len=MIN((size_t)8192,v.size());
  size_t from=0;
  if (s->isLoopable() && s->loopEnd>s->loopStart && (size_t)(s->loopEnd-s->loopStart)>=256) {
    from=s->loopStart;
    len=MIN(len,(size_t)(s->loopEnd-s->loopStart));
  } else if (v.size()>len) {
    from=MIN(v.size()-len,v.size()/8);
  }
  int minLag=MAX(2,(int)(rate/4000.0));
  int maxLag=MIN((int)(len/2),(int)(rate/25.0));
  if (maxLag<=minLag+2) return 0;
  // YIN: cumulative mean normalized difference
  size_t W=len-maxLag;
  std::vector<double> d(maxLag+1,0.0);
  for (int tau=1; tau<=maxLag; tau++) {
    double acc=0;
    for (size_t j=0; j<W; j++) {
      double x=v[from+j]-v[from+j+tau];
      acc+=x*x;
    }
    d[tau]=acc;
  }
  std::vector<double> cm(maxLag+1,1.0);
  double run=0;
  for (int tau=1; tau<=maxLag; tau++) {
    run+=d[tau];
    cm[tau]=(run>0)?(d[tau]*tau/run):1.0;
  }
  int best=-1;
  for (int tau=minLag; tau<maxLag; tau++) {
    if (cm[tau]<0.15) {
      while (tau+1<maxLag && cm[tau+1]<cm[tau]) tau++;
      best=tau;
      break;
    }
  }
  if (best<0) {
    double bv=1e30;
    for (int tau=minLag; tau<maxLag; tau++) {
      if (cm[tau]<bv) {
        bv=cm[tau];
        best=tau;
      }
    }
    if (bv>0.5) return 0;
  }
  double t=best;
  if (best>minLag && best+1<maxLag) {
    double a=cm[best-1], b=cm[best], c=cm[best+1];
    double den=a-2*b+c;
    if (fabs(den)>1e-12) t=best+0.5*(a-c)/den;
  }
  return rate/t;
}

int rgSampleAutoTune(DivSample* s, float tuning, bool toC, double* pitchOut) {
  double f=rgSampleDetectPitch(s);
  if (pitchOut) *pitchOut=f;
  if (f<=0) return 0;
  // C-4 should sound note "target" (a C, or the nearest note)
  double c4=tuning*pow(2.0,-9.0/12.0); // C-4 relative to A-4 (440Hz -> 261.63Hz)
  double semis=12.0*log2(f/c4);
  double want;
  if (toC) {
    want=12.0*round(semis/12.0);
  } else {
    want=round(semis);
  }
  double nr=s->centerRate*pow(2.0,(want-semis)/12.0);
  if (nr<100) nr=100;
  if (nr>1000000) nr=1000000;
  return (int)round(nr);
}

bool rgSampleSnapLoop(DivSample* s) {
  if (!rgEditable(s) || !s->isLoopable()) return false;
  std::vector<float> v=rgRead(s);
  int n=v.size();
  auto nearestRise=[&](int p) -> int {
    for (int dlt=0; dlt<n; dlt++) {
      for (int sg=-1; sg<=1; sg+=2) {
        int i=p+sg*dlt;
        if (i<1 || i>=n) continue;
        if (v[i-1]<0 && v[i]>=0) return i;
      }
    }
    return p;
  };
  int ls=nearestRise(s->loopStart);
  int le=nearestRise(s->loopEnd);
  if (le<=ls) return false;
  s->loopStart=ls;
  s->loopEnd=le;
  return true;
}

// WSOLA: overlap-add of windowed pieces, each one placed where it best continues the last
static std::vector<float> rgStretch(const std::vector<float>& in, double factor, double rate) {
  std::vector<float> out;
  int N=(int)(rate*0.04);
  if (N<64) N=64;
  if (N>4096) N=4096;
  N&=~1;
  int Hs=N/2;
  int D=N/4;
  size_t outLen=(size_t)round(in.size()*factor);
  if (outLen<1) return out;
  out.assign(outLen+N,0.0f);
  std::vector<float> wsum(outLen+N,0.0f);
  std::vector<float> win(N);
  for (int i=0; i<N; i++) win[i]=0.5f-0.5f*cos(2*M_PI*i/N);
  auto at=[&](long i) -> float { return (i>=0 && i<(long)in.size())?in[i]:0.0f; };
  long prev=0;
  for (size_t k=0; k*(size_t)Hs<outLen; k++) {
    long nominal=(long)round(k*Hs/factor);
    long best=nominal;
    if (k>0) {
      // the natural continuation of the previous piece
      long cont=prev+Hs;
      double bestC=-1e30;
      for (long dlt=-D; dlt<=D; dlt+=2) {
        long p=nominal+dlt;
        double c=0;
        for (int j=0; j<Hs; j+=2) c+=at(p+j)*at(cont+j);
        if (c>bestC) {
          bestC=c;
          best=p;
        }
      }
    }
    size_t o=k*Hs;
    for (int j=0; j<N; j++) {
      out[o+j]+=at(best+j)*win[j];
      wsum[o+j]+=win[j];
    }
    prev=best;
  }
  for (size_t i=0; i<out.size(); i++) {
    if (wsum[i]>1e-3) out[i]/=wsum[i];
  }
  out.resize(outLen);
  return out;
}

static void rgWriteAll(DivSample* s, const std::vector<float>& v) {
  s->resize(v.size());
  for (size_t i=0; i<v.size(); i++) rgPut(s,i,v[i]);
}

bool rgSampleTimeStretch(DivSample* s, double factor) {
  if (!rgEditable(s) || s->samples<16 || factor<=0.05 || factor>20) return false;
  std::vector<float> v=rgRead(s);
  std::vector<float> o=rgStretch(v,factor,MAX(1000,s->centerRate));
  if (o.empty()) return false;
  rgWriteAll(s,o);
  if (s->loopStart>=0) s->loopStart=MIN((int)o.size(),(int)round(s->loopStart*factor));
  if (s->loopEnd>=0) s->loopEnd=MIN((int)o.size(),(int)round(s->loopEnd*factor));
  return true;
}

bool rgSamplePitchShift(DivSample* s, double semitones) {
  if (!rgEditable(s) || s->samples<16) return false;
  double r=pow(2.0,semitones/12.0);
  std::vector<float> v=rgRead(s);
  // stretch by r, then read it r times faster (cubic interpolation)
  std::vector<float> st=rgStretch(v,r,MAX(1000,s->centerRate));
  if (st.empty()) return false;
  std::vector<float> o(v.size());
  auto at=[&](long i) -> float { return st[CLAMP(i,0L,(long)st.size()-1)]; };
  for (size_t i=0; i<o.size(); i++) {
    double x=i*r;
    long i0=(long)floor(x);
    float t=(float)(x-i0);
    float p0=at(i0-1), p1=at(i0), p2=at(i0+1), p3=at(i0+2);
    float a=-0.5f*p0+1.5f*p1-1.5f*p2+0.5f*p3;
    float b=p0-2.5f*p1+2.0f*p2-0.5f*p3;
    float c=-0.5f*p0+0.5f*p2;
    o[i]=((a*t+b)*t+c)*t+p1;
  }
  rgWriteAll(s,o);
  return true;
}
