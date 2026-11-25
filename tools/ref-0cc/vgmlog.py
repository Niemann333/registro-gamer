# vgmlog.py arq.vgm saida.txt -> "tempo chip reg valor" (só NES APU por enquanto: chip 1)
import sys,struct,gzip
d=open(sys.argv[1],'rb').read()
if d[:2]==b'\x1f\x8b': d=gzip.decompress(d)
ver=struct.unpack('<I',d[8:12])[0];off=0x34+struct.unpack('<I',d[0x34:0x38])[0] if ver>=0x150 else 0x40
p=off;t=0;out=[]
while p<len(d):
  c=d[p]
  if c==0x66: break
  if c==0x61: t+=struct.unpack('<H',d[p+1:p+3])[0];p+=3
  elif c==0x62: t+=735;p+=1
  elif c==0x63: t+=882;p+=1
  elif 0x70<=c<=0x7f: t+=(c&15)+1;p+=1
  elif c==0xb4:
    a=d[p+1];v=d[p+2];p+=3
    if a<0x20: out.append('%.6f 1 %x %d'%(t/44100,0x4000+a,v))
    elif a==0x3f: out.append('%.6f 1 %x %d'%(t/44100,0x4023,v))
    else: out.append('%.6f 2 %x %d'%(t/44100,0x4040+a-0x20 if a<0x60 else 0x4080+a-0x60,v))
  elif c==0x67:
    sz=struct.unpack('<I',d[p+3:p+7])[0];p+=7+sz
  elif c in (0x90,0x91,0x95): p+=5
  elif c==0x92: p+=6
  elif c==0x93: p+=11
  elif c==0x94: p+=2
  elif 0x30<=c<=0x3f or c==0x4f or c==0x50: p+=2
  elif 0x40<=c<=0x4e or 0x51<=c<=0x5f or 0xa0<=c<=0xbf: p+=3
  elif 0xc0<=c<=0xdf: p+=4
  elif 0xe0<=c<=0xff: p+=5
  elif 0x80<=c<=0x8f: t+=c&15;p+=1
  else: print('cmd?',hex(c),p);break
open(sys.argv[2],'w').write('\n'.join(out)+'\n')
