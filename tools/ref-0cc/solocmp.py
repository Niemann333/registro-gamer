# solocmp.py arquivo [seg] -> por chip: nível fur/occ e semelhança espectral (forma), 0CC (occwav) x Furnace (rgplayer)
import subprocess,os,sys,wave,numpy as np
f=sys.argv[1];sec=int(sys.argv[2]) if len(sys.argv)>2 else 60
names=['2A03','VRC6','VRC7','FDS','MMC5','N163','S5B'];bits={1:1,2:2,3:4,4:8,5:16,6:32}
d=open(f,'rb').read();i=d.index(b'PARAMS');exp=d[i+24]
present=[0]+[k for k in range(1,7) if exp&bits[k]]
furorder=[0,1,4,5,3,2,6];furidx=[k for k in furorder if k in present]
W=4096
def spec(x): return np.array([np.abs(np.fft.rfft(x[i:i+W]*np.hanning(W))) for i in range(0,len(x)-W,W)])
for k in present:
  env=dict(os.environ,OCC_SOLO=str(k),OCC_LENIENT='1')
  subprocess.run(['/home/claude/work/occ315/0ccft-ext/build/occwav',f,'/tmp/lv/sc_o.wav',str(sec)],env=env,capture_output=True)
  env=dict(os.environ,RGF_SYSSOLO=str(furidx.index(k)))
  subprocess.run(['/home/claude/furnace/build-rgp/furnace',f,'/tmp/lv/sc_f.raw',str(sec)],env=env,capture_output=True)
  w=wave.open('/tmp/lv/sc_o.wav');a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float)
  b=np.fromfile('/tmp/lv/sc_f.raw',dtype=np.int16).astype(float).reshape(-1,2).mean(axis=1)
  n=min(len(a),len(b))
  best=max(range(-6000,6000,5),key=lambda dd: np.dot(a[8000:n-8000],b[8000+dd:n-8000+dd]))
  b2=b[best:] if best>0 else np.concatenate([np.zeros(-best),b]);m=min(len(a),len(b2));a2=a[:m];b2=b2[:m]
  SA=spec(a2);SB=spec(b2);A=np.log1p(SA);B=np.log1p(SB);act=(SA.sum(axis=1)>1e3)
  sim=np.array([np.dot(A[i],B[i])/(np.linalg.norm(A[i])*np.linalg.norm(B[i])+1e-9) for i in range(len(A))])
  ra=np.sqrt((a2**2).mean());rb=np.sqrt((b2**2).mean())
  print('%-5s nível %.2f forma %.3f'%(names[k],rb/max(ra,1e-9),sim[act].mean() if act.any() else 0),flush=True)
