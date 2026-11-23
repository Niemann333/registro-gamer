# monta um driver Z80 (z80asm, pacote "z80asm") e gera o .inc com os bytes e os rótulos em maiúsculas
# uso: python3 scripts/rg-z80inc.py src/engine/export/kssdrv.asm kssDriver "comentário"
import subprocess,tempfile,os,re,sys
src,name=sys.argv[1],sys.argv[2]
t=tempfile.mkdtemp()
r=subprocess.run(['z80asm','-i',src,'-o',t+'/a.bin','-L'],capture_output=True,text=True)
if r.returncode: sys.stderr.write(r.stderr); sys.exit(1)
code=open(t+'/a.bin','rb').read()
labs={}
for l in r.stderr.splitlines():
  m=re.match(r'(\w+):\s+equ \$([0-9a-fA-F]+)',l)
  if m and m.group(1).isupper(): labs[m.group(1)]=int(m.group(2),16)
out=os.path.splitext(src)[0]+'.inc'
with open(out,'w') as f:
  f.write('// gerado por %s (z80asm, scripts/rg-z80inc.py); não editar à mão\n'%os.path.basename(src))
  if len(sys.argv)>3: f.write('// '+sys.argv[3]+'\n')
  for k in sorted(labs): f.write('#define %s_%s 0x%04x\n'%(name.upper(),k,labs[k]))
  f.write('static const unsigned char %s[%d]={\n'%(name,len(code)))
  for i in range(0,len(code),16): f.write('  '+', '.join('0x%02x'%b for b in code[i:i+16])+',\n')
  f.write('};\n')
print(out,len(code),'bytes')
