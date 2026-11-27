import sys,subprocess,collections
vge,log,fps,N=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
fur=collections.defaultdict(list)
for l in open(log):
  p=l.split()
  t=float(p[0]);sysi=int(p[1]);a=int(p[2],16);v=int(p[3])
  k=int(round(t*fps*1000))//1000
  k=int(t*fps+0.5)
  if sysi==0:
    if (a&0xff) in (0x2a,0x2b): continue
    fur[k].append('%d:%02x=%02x'%(a>>8,a&0xff,v))
  else:
    fur[k].append('2:00=%02x'%v)
out=subprocess.run(['/tmp/vgr/h',vge,str(N)],capture_output=True,text=True).stdout.split('\n')[1:]
mine={}
for l in out:
  if not l: continue
  p=l.split(' ');t=int(p[0][1:]);mine[t]=[x for x in p[1:] if not x.startswith('D') and not x.startswith('3:') and not x.startswith('0:2b')]
bad=0;first=None
for t in range(1,N):
  if fur[t]!=mine.get(t,[]):
    bad+=1
    if first is None: first=(t,fur[t][:10],mine.get(t,[])[:10])
print('ticks',N,'diferentes',bad,first)
