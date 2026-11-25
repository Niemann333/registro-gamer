# ftmpos.py arq.ftm quadro canal -> mostra ordem/linha e as linhas do padrão perto
import sys,struct,subprocess
d=open(sys.argv[1],'rb').read();F=int(sys.argv[2]) if sys.argv[2]!='ord' else 0;CH=int(sys.argv[3])
exec(open('/home/claude/work/ftmblocks.py').read().split("p=22\nwhile")[0].split("print(d[:18]")[0])
FXS='FBDCE3?HI047PGZ12VYQRASXMHIJWHIJWHILOTZEZ9HIJ';FX={k+1:c for k,c in enumerate(FXS)}
blocks={};p=22
while p<len(d)-3:
  bid=d[p:p+16].split(b'\0')[0]
  if bid==b'END': break
  ver,sz=struct.unpack('<II',d[p+16:p+24]);blocks[bid]=(ver,d[p+24:p+24+sz]);p+=24+sz
NCH=struct.unpack('<I',blocks[b'PARAMS'][1][1:5])[0]
hb=blocks[b'HEADER'][1];NT=hb[0]+1;q=1
for t in range(NT): q=hb.index(0,q)+1
cols=[hb[q+i*(1+NT)+1]+1 for i in range(NCH)]
fb=blocks[b'FRAMES'][1];nf,spd,tmp,rows=struct.unpack('<4I',fb[:16]);fr=[list(fb[16+NCH*k:16+NCH*(k+1)]) for k in range(nf)]
pats={};b=blocks[b'PATTERNS'][1];q=0
while q<len(b):
  tr,ch,pat,items=struct.unpack('<IIII',b[q:q+16]);q+=16
  for it in range(items):
    row=struct.unpack('<I',b[q:q+4])[0];note,octv,ins,vol=b[q+4:q+8];q+=8;fx=[]
    for k in range(cols[ch]):
      if b[q] or b[q+1]: fx.append('%s%02X'%(FX.get(b[q],'?'),b[q+1]))
      q+=2
    pats[(ch,pat,row)]=(note,octv,ins,vol,fx)
if sys.argv[2]=='ord':
  for o in map(int,sys.argv[4].split(',')):
    print('ordem',o,'padrão',fr[o][CH])
    for r in range(rows):
      e=pats.get((CH,fr[o][CH],r))
      if e and (e[4] or len(sys.argv)>5): print('  linha',r,'nota%d oit%d ins%d vol%d'%e[:4],e[4])
  sys.exit()
# percorre (só speed fixo e Dxx; suficiente para esta música)
f=0;o=0;r=0;sp=spd
while True:
  ln=None
  for c in range(NCH):
    e=pats.get((c,fr[o][c],r))
    if e:
      for x in e[4]:
        if x[0]=='F' and int(x[1:],16)<0x20: sp=int(x[1:],16)
  if f<=F<f+sp: break
  f+=sp;jump=False
  for c in range(NCH):
    e=pats.get((c,fr[o][c],r))
    if e:
      for x in e[4]:
        if x[0]=='D': jump=True
  r+=1
  if jump or r>=rows: o=(o+1)%nf;r=0
print('quadro',F,'-> ordem',o,'linha',r,'(padrão %d do canal %d)'%(fr[o][CH],CH))
for rr in range(max(0,r-6),r+4):
  e=pats.get((CH,fr[o][CH],rr))
  if e: print('  linha',rr,'nota%d oit%d ins%d vol%d'%e[:4],e[4])
