# dncmp.py arquivo [seg] [bandas] -> por chip: nível fur/Dn, forma espectral e (opcional) diferença por banda (dB)
import subprocess,os,sys,wave,numpy as np,hashlib,re
f=sys.argv[1];sec=int(sys.argv[2]) if len(sys.argv)>2 else 60;bands=len(sys.argv)>3
rel=f if f.startswith('./') else ('./'+os.path.relpath(f,'/home/claude/niemann333/registro-gamer') if f.startswith('/home/claude/niemann333') else None)
h=hashlib.md5((rel+'\n').encode()).hexdigest()[:8] if rel else None
b='/tmp/ftall/'+h if h else None
if f.endswith('djm.ftm'): b='/tmp/ftall/54a52f0f'
rate=float(re.search(r'taxa ([0-9.]+)',open(b+'.rate.txt').read()).group(1))
names=['2A03','VRC6','VRC7','FDS','MMC5','N163','S5B'];bits={1:1,2:2,3:4,4:8,5:16,6:32}
d=open(f,'rb').read();i=d.index(b'PARAMS');exp=d[i+24]
only=os.environ.get('CHIPS')
present=[0]+[k for k in range(1,7) if exp&bits[k]]
if only: present=[k for k in present if str(k) in only.split(',')]
furorder=[0,1,4,5,3,2,6];furidx=[k for k in furorder if k==0 or exp&bits.get(k,0)]
W=4096
def spec(x): return np.array([np.abs(np.fft.rfft(x[i:i+W]*np.hanning(W))) for i in range(0,len(x)-W,W)])
for k in present:
  env=dict(os.environ,DN_SOLO=str(k))
  subprocess.run(['/home/claude/work/dnapu/dnwav',b+'.ref.log','/tmp/lv/dc_o.wav',str(rate),str(exp),str(sec)],env=env,capture_output=True)
  env=dict(os.environ,RGF_SYSSOLO=str(furidx.index(k)))
  subprocess.run(['/home/claude/furnace/build-rgp/furnace',f,'/tmp/lv/dc_f.raw',str(sec)],env=env,capture_output=True)
  w=wave.open('/tmp/lv/dc_o.wav');a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(float)
  bb=np.fromfile('/tmp/lv/dc_f.raw',dtype=np.int16).astype(float).reshape(-1,2).mean(axis=1)
  n=min(len(a),len(bb))
  best=max(range(-6000,6000,5),key=lambda dd: np.dot(a[8000:n-8000],bb[8000+dd:n-8000+dd]))
  b2=bb[best:] if best>0 else np.concatenate([np.zeros(-best),bb]);m=min(len(a),len(b2));a2=a[:m];b2=b2[:m]
  SA=spec(a2);SB=spec(b2);A=np.log1p(SA);B=np.log1p(SB);act=(SA.sum(axis=1)>1e3)
  sim=np.array([np.dot(A[i],B[i])/(np.linalg.norm(A[i])*np.linalg.norm(B[i])+1e-9) for i in range(len(A))])
  ra=np.sqrt((a2**2).mean());rb=np.sqrt((b2**2).mean())
  line='%-5s nível %.2f forma %.3f'%(names[k],rb/max(ra,1e-9),sim[act].mean() if act.any() else 0)
  if bands:
    FA=np.abs(np.fft.rfft(a2))**2;FB=np.abs(np.fft.rfft(b2))**2;fr=np.fft.rfftfreq(m,1/44100)
    e=[30,100,300,1000,2000,4000,8000,12000,16000,20000]
    line+='  '+' '.join('%d:%+.1f'%(lo,10*np.log10((FB[(fr>=lo)&(fr<hi)].sum()+1)/(FA[(fr>=lo)&(fr<hi)].sum()+1))) for lo,hi in zip(e,e[1:]))
  print(line,flush=True)
