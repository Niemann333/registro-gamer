import sys,struct,subprocess
vge,vgm=sys.argv[1],sys.argv[2]
b=open(vgm,'rb').read()
off=0x34+struct.unpack_from('<I',b,0x34)[0]
fps=None
ticks=[[]];acc=0;i=off
rate=44100
while i<len(b):
  c=b[i]
  if c in(0x52,0x53): ticks[-1].append('%d:%02x=%02x'%(c-0x52,b[i+1],b[i+2]));i+=3
  elif c==0x50: ticks[-1].append('2:00=%02x'%b[i+1]);i+=2
  elif c==0x4f: ticks[-1].append('3:00=%02x'%b[i+1]);i+=2
  elif c==0x61: acc+=struct.unpack_from('<H',b,i+1)[0];i+=3
  elif c==0x62: acc+=735;i+=1
  elif c==0x63: acc+=882;i+=1
  elif 0x70<=c<=0x7f: acc+=(c&15)+1;i+=1
  elif 0x80<=c<=0x8f: acc+=(c&15);i+=1
  elif c==0x66: break
  elif c==0x67: i+=7+struct.unpack_from('<I',b,i+3)[0]
  elif c==0x90: i+=5
  elif c==0x91: i+=5
  elif c==0x92: i+=6
  elif c==0x93: ticks[-1].append('DS%d'%0);i+=11
  elif c==0x94: ticks[-1].append('DX');i+=2
  elif c==0x95: i+=5
  elif c==0xe0: i+=5
  else: print('cmd?',hex(c));break
  while acc>=440:   # tique = 882 (50) ou 735 (60)
    if acc>=735: 
      t=882 if acc>=882 else 735
      acc-=t; ticks.append([])
    else: break
N=len(ticks)-1
out=subprocess.run(['/tmp/vgr/h',vge,str(N+1)],capture_output=True,text=True).stdout.split('\n')[1:]
mine={}
for l in out:
  if not l: continue
  p=l.split(' ');t=int(p[0][1:]);mine[t]=[x if not x.startswith('D') else ('DX' if x=='D-1' else 'DS0') for x in p[1:]]
bad=0;first=None
for t in range(N):
  a=ticks[t];m=(mine.get(0,[])+mine.get(1,[])) if t==0 else mine.get(t+1,[])
  # o export põe 0x2b etc do DAC; compara sem as linhas do DAC
  fa=[x for x in a if not x.startswith('0:2a') and not x.startswith('0:2b')];fm=[x for x in m if not x.startswith('3:') and not x.startswith('0:2b')]
  da=[x for x in fa if x[0]=='D'];dm=[x for x in fm if x[0]=='D'];fa=[x for x in fa if x[0]!='D'];fm=[x for x in fm if x[0]!='D']
  if fa!=fm or da!=dm:
    bad+=1
    if first is None: first=(t,fa,fm)
print('ticks',N,'diferentes',bad,'primeiro',first and (first[0],[x for x in first[1] if x not in first[2]][:8],[x for x in first[2] if x not in first[1]][:8]))
