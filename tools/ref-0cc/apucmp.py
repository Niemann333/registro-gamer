# apucmp.py ref.log test.log [maxframes] — compara o estado do APU do NES quadro a quadro
import sys,collections,os
RATE=float(os.environ.get('RATE','60'))
def frames(fn,group):
  st={};fr=[];cur=None;lastT=None;trig=set()
  rows=[l.split() for l in open(fn) if l.strip()]
  def snap():
    s=dict(st);s['trig']=frozenset(trig);fr.append(s);trig.clear()
  for t,chip,reg,val in rows:
    t=float(t);reg=int(reg,16);val=int(val)
    if chip!='1': continue
    if group=='gap':
      if lastT is not None and t-lastT>0.004: snap()
    else:
      k=round(t*RATE)
      while len(fr)<k: snap()
    lastT=t
    st[reg]=val
    if reg in (0x4003,0x4007,0x400b,0x400f): trig.add(reg)
  snap()
  return fr
def view(s):
  g=lambda r:s.get(r,0)
  en=g(0x4015)
  out={}
  for i,b in ((0,0x4000),(1,0x4004)):
    on=(en>>i)&1
    v=g(b)&15 if on else 0
    out['P%d'%(i+1)]=(v, (g(b)>>6) if v else '-', (g(b+2)|((g(b+3)&7)<<8)) if v else '-', g(b+1) if v else '-')
  on=(en>>2)&1; lin=g(0x4008)&127
  out['TRI']=(1 if on and lin else 0, (g(0x400a)|((g(0x400b)&7)<<8)) if on and lin else '-')
  on=(en>>3)&1; v=g(0x400c)&15 if on else 0
  out['NOI']=(v, g(0x400e)&0x8f if v else '-')
  out['DMC']=((en>>4)&1, g(0x4010)&15, g(0x4012), g(0x4013))
  return out
A=frames(sys.argv[1],'gap');B=frames(sys.argv[2],'gap' if sys.argv[2].endswith('nsf.log') or 'occ' in sys.argv[2] or 'ref' in sys.argv[2] or 'trk' in sys.argv[2] else 'grid')
# alinha: primeiro quadro com algum volume
def first(F):
  for i,s in enumerate(F):
    v=view(s)
    if v['P1'][0] or v['P2'][0] or v['TRI'][0] or v['NOI'][0]: return i
  return 0
oa,ob=first(A),first(B)
best=(1e9,0)
for d in range(-min(ob,3),4):
  def nv(x):
    v=view(x);v['DMC']=v['DMC'][:2]+v['DMC'][3:];return v
  m=sum(nv(A[oa+i])!=nv(B[ob+d+i]) for i in range(0,300) if oa+i<len(A) and 0<=ob+d+i<len(B))
  best=min(best,(m,d))
ob+=best[1]
if len(sys.argv)>4:
  for i in range(int(sys.argv[4])):
    print(i,view(A[oa+i]),'|',view(B[ob+i]))
N=min(len(A)-oa,len(B)-ob,int(sys.argv[3]) if len(sys.argv)>3 else 10**9)
print('quadros ref %d, teste %d, comparando %d (deslocamento %d/%d)'%(len(A),len(B),N,oa,ob))
diff=collections.Counter();ex={}
for i in range(N):
  va,vb=view(A[oa+i]),view(B[ob+i])
  for ch in va:
    for k,name in enumerate(('vol','duty','per','sweep') if ch[0]=='P' else ('on','per') if ch=='TRI' else ('vol','per') if ch=='NOI' else ('on','rate','addr','len')):
      if k<len(va[ch]) and va[ch][k]!=vb[ch][k]:
        diff[(ch,name)]+=1
        ex.setdefault((ch,name),[]).append((i,va[ch],vb[ch]))
for k,c in sorted(diff.items(),key=lambda x:-x[1]):
  print('%s.%s: %d quadros (%.1f%%)  ex: %s'%(k[0],k[1],c,100*c/N,ex[k][:4]))
