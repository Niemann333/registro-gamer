import sys,struct
d=open(sys.argv[1],'rb').read()
print(d[:18],hex(struct.unpack('<I',d[18:22])[0]))
p=22
while p<len(d)-3:
  bid=d[p:p+16].split(b'\0')[0];
  if bid==b'END': break
  ver,sz=struct.unpack('<II',d[p+16:p+24]);body=d[p+24:p+24+sz]
  print(bid.decode(),'v%d'%ver,sz, body[:48].hex() if bid in (b'PARAMS',b'FRAMES',b'HEADER') else '')
  p+=24+sz
p=22
while p<len(d)-3:
  bid=d[p:p+16].split(b'\0')[0]
  if bid==b'END': break
  ver,sz=struct.unpack('<II',d[p+16:p+24]);body=d[p+24:p+24+sz]
  if bid==b'SEQUENCES':
    n=struct.unpack('<I',body[:4])[0];q=4;seqs=[]
    for i in range(n):
      idx,typ=struct.unpack('<II',body[q:q+8]);ln=body[q+8];lp=struct.unpack('<i',body[q+9:q+13])[0];q+=13
      vals=list(struct.unpack('%db'%ln,body[q:q+ln]));q+=ln;seqs.append((idx,typ,lp,vals))
    for s in seqs:
      rel,setting=struct.unpack('<iI',body[q:q+8]);q+=8
      print('seq idx%d tipo%d loop%d rel%d set%d:'%(s[0],s[1],s[2],rel,setting),s[3][:40])
  p+=24+sz
FXS='FBDCE3?HI047PGZ12VYQRASXMHIJWHIJWHILOTZEZ9HIJ'
FX={k+1:c for k,c in enumerate(FXS)}
p=22;cols=None
while p<len(d)-3:
  bid=d[p:p+16].split(b'\0')[0]
  if bid==b'END': break
  ver,sz=struct.unpack('<II',d[p+16:p+24]);body=d[p+24:p+24+sz]
  if bid==b'HEADER':
    q=1+body[1:].index(0)+1;cols=[body[q+2*i+1]+1 for i in range(5)]
  if bid==b'PATTERNS' and len(sys.argv)>2:
    want=int(sys.argv[2]);q=0
    while q<len(body):
      tr,ch,pat,items=struct.unpack('<IIII',body[q:q+16]);q+=16
      for it in range(items):
        row=struct.unpack('<I',body[q:q+4])[0];note,octv,ins,vol=body[q+4:q+8];q+=8;fx=[]
        for k in range(cols[ch]):
          if body[q]: fx.append('%s%02X'%(FX.get(body[q],'?%d'%body[q]),body[q+1]))
          q+=2
        if ch==want and pat==(int(sys.argv[3]) if len(sys.argv)>3 else 0) and row<64: print('pat%d row%2d nota%d oit%d ins%d vol%d %s'%(pat,row,note,octv,ins,vol,fx))
  p+=24+sz
p=22;seqtab={}
while p<len(d)-3:
  bid=d[p:p+16].split(b'\0')[0]
  if bid==b'END': break
  ver,sz=struct.unpack('<II',d[p+16:p+24]);body=d[p+24:p+24+sz]
  if bid==b'INSTRUMENTS':
    n=struct.unpack('<I',body[:4])[0];q=4
    for k in range(n):
      idx=struct.unpack('<I',body[q:q+4])[0];typ=body[q+4];q+=5
      if typ!=1: print('ins',idx,'tipo',typ,'(não 2A03)');break
      sc=struct.unpack('<I',body[q:q+4])[0];q+=4;seq=[(body[q+2*i],body[q+2*i+1]) for i in range(sc)];q+=2*sc
      q+=96*(3 if ver>=6 else 2)
      nl=struct.unpack('<I',body[q:q+4])[0];name=body[q+4:q+4+nl];q+=4+nl
      print('ins',idx,name,'seqs(vol,arp,pitch,hipitch,duty):',['%d'%s[1] if s[0] else '-' for s in seq])
  p+=24+sz
