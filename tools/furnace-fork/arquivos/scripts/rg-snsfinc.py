# monta o programa 65816 do SNSF (src/engine/export/snsfdrv.s) com o ca65/ld65 (pacote cc65) e gera snsfdrv.inc
# uso: python3 scripts/rg-snsfinc.py
import subprocess,tempfile,os,re
d=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','src','engine','export')
t=tempfile.mkdtemp()
subprocess.check_call(['ca65','-g','--cpu','65816','-o',t+'/a.o',d+'/snsfdrv.s'])
subprocess.check_call(['ld65','-C',d+'/snsfdrv.cfg',t+'/a.o','-o',t+'/a.bin','-Ln',t+'/a.lbl'])
code=open(t+'/a.bin','rb').read()
labs={}
for l in open(t+'/a.lbl'):
  m=re.match(r'al ([0-9A-F]+) \.(\w+)',l)
  if m and (m.group(2).isupper()): labs[m.group(2)]=int(m.group(1),16)
with open(d+'/snsfdrv.inc','w') as f:
  f.write('// gerado por snsfdrv.s (ca65/ld65, scripts/rg-snsfinc.py); não editar à mão\n')
  f.write('// banco $00 em $8000 (HiROM: arquivo $8000)\n')
  for k in sorted(labs): f.write('#define SNSFDRV_%s 0x%04x\n'%(k,labs[k]&0xffff))
  f.write('static const unsigned char snsfDriver[%d]={\n'%len(code))
  for i in range(0,len(code),16): f.write('  '+', '.join('0x%02x'%b for b in code[i:i+16])+',\n')
  f.write('};\n')
print('snsfdrv.inc: %d bytes'%len(code))
