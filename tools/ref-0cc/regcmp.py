# regcmp.py ref.log(occrender) fur.reg(RGF_REGLOG) chip [ini] [n] [desloc]
# chip: vrc6 mmc5 n163 fds vrc7 s5b -> estado dos registradores por quadro, contagem de diferenças e exemplos
import sys,math,os
RATE=float(os.environ.get('RATE','60'))
chip=sys.argv[3]
import os
exp=int(os.environ.get('EXP','63'))
order=[('vrc6',1),('mmc5',8),('n163',16),('fds',4),('vrc7',2),('s5b',32)]
furSys={};k=1
for nm,bit in order:
  if exp&bit: furSys[nm]=k;k+=1
def ref_frames():
  st={};fr={};port=0
  for l in open(sys.argv[1]):
    t,c,a,v=l.split();a=int(a,16);v=int(v)
    if c!='2': continue
    k=None
    if chip=='vrc6' and 0x9000<=a<=0xb002: k=a
    elif chip=='mmc5' and 0x5000<=a<=0x5015: k=a
    elif chip=='fds' and 0x4040<=a<=0x408a: k=a
    elif chip=='n163':
      if a==0xf800: port=v; continue
      if a==0x4800:
        k=port&0x7f
        if port&0x80: port=0x80|((port+1)&0x7f)
    elif chip=='vrc7':
      if a==0x9010: port=v; continue
      if a==0x9030: k=port
    elif chip=='s5b':
      if a==0xc000: port=v&15; continue
      if a==0xe000: k=port
    if k is None: continue
    st[k]=v; fr[int(float(t)*RATE+0.5)]=dict(st)
  return fr
def fur_frames():
  st={};fr={}
  s=str(furSys[chip])
  for l in open(sys.argv[2]):
    x=l.split();t,c,a,v=x[:4]
    if c!=s: continue
    a=int(a,16);v=int(v)
    if chip=='s5b': a&=15
    v&=0xff
    if len(x)>4:
      m=int(x[4]); v=(st.get(a,0)&~m)|(v&m)
    st[a]=v; fr[math.ceil(float(t)*RATE-1e-6)]=dict(st)
  return fr
A=ref_frames();B=fur_frames()
if chip=='n163':
  for D in (A,B):
    for f in D:
      st=D[f]
      for k in list(st):
        if k>=0x40 and (k&7)==7:
          if k==0x7f: st[0x80]=st[k]>>4
          st[k]=st[k]&15
ini=int(sys.argv[4]) if len(sys.argv)>4 else 0;n=int(sys.argv[5]) if len(sys.argv)>5 else 20
off=int(sys.argv[6]) if len(sys.argv)>6 else 0
la={};lb={};cnt={};ex=[];tot=0
for f in range(0,max(A)+1):
  la=A.get(f,la);lb=B.get(f+off,lb);tot+=1
  ks=sorted(set(la)|set(lb))
  d=[k for k in ks if la.get(k,0)!=lb.get(k,0)]
  for k in d: cnt[k]=cnt.get(k,0)+1
  if d and len(ex)<n and f>=ini: ex.append((f,' '.join('%x:%d/%d'%(k,la.get(k,0),lb.get(k,0)) for k in d)))
print(chip,'quadros',tot,'quadros com diferença',sum(1 for _ in ex) if False else '', 'por registrador (ref/fur):',' '.join('%x=%d'%(k,v) for k,v in sorted(cnt.items())))
for e in ex: print(e[0],e[1])
if len(sys.argv)>7:
  f0=int(sys.argv[7]);la={};lb={}
  for f in range(0,f0+12):
    la=A.get(f,la);lb=B.get(f+off,lb)
    if f>=f0: print(f,'ref',' '.join('%x:%d'%(k,v) for k,v in sorted(la.items())));print(f,'fur',' '.join('%x:%d'%(k,v) for k,v in sorted(lb.items())))
