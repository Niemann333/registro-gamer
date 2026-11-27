import numpy as np,sys
r=np.fromfile(sys.argv[1],dtype=np.int16)[22:].astype(float).reshape(-1,2)
f=np.fromfile(sys.argv[2],dtype=np.int16).astype(float).reshape(-1,2)
n=min(len(r),len(f));r=r[:n];f=f[:n]
rm=r.mean(1);fm=f.mean(1)
# alinhamento
best=(0,0)
seg=slice(44100*5,44100*15)
for off in range(-2000,2001,1):
  a=rm[seg];b=np.roll(fm,off)[seg]
  c=np.dot(a,b)/np.sqrt(np.dot(a,a)*np.dot(b,b)+1e-9)
  if c>best[0]: best=(c,off)
off=best[1];fm2=np.roll(fm,off)
print('corr %.3f off %d | rms ref %.0f fur %.0f ratio %.3f'%(best[0],off,np.sqrt((rm**2).mean()),np.sqrt((fm**2).mean()),np.sqrt((fm**2).mean())/np.sqrt((rm**2).mean())))
# bandas
def bands(x):
  S=np.abs(np.fft.rfft(x[:2**21]))**2;fr=np.fft.rfftfreq(2**21,1/44100)
  out=[]
  for lo,hi in [(0,150),(150,500),(500,2000),(2000,6000),(6000,20000)]:
    out.append(10*np.log10(S[(fr>=lo)&(fr<hi)].sum()+1))
  return np.array(out)
print('bandas dB fur-ref',np.round(bands(fm)-bands(rm),1))
# corr por janelas de 1s
cs=[]
for k in range(0,n-44100,44100):
  a=rm[k:k+44100];b=fm2[k:k+44100]
  if np.dot(a,a)<1: continue
  cs.append(np.dot(a,b)/np.sqrt(np.dot(a,a)*np.dot(b,b)+1e-9))
print('corr 1s: mediana %.3f min %.3f'%(np.median(cs),min(cs)))
