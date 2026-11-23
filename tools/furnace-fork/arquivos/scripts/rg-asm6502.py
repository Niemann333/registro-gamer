# mini montador 6502 dos drivers do Registro Gamer (NSF, SID), duas passadas com rótulos.
# uso: python3 rg-asm6502.py entrada.asm nome_da_tabela "comentário" > saida.inc
# sintaxe: rótulos "nome:", constantes "NOME = valor", .org, .byte, comentários com ";",
# expressões em Python com $hex, <expr (byte baixo) e >expr (byte alto) no modo imediato.
import re,sys
OPS={}
def _t(name,**m): OPS[name]=m
for n,b in (('ora',0x00),('and',0x20),('eor',0x40),('adc',0x60),('lda',0xA0),('cmp',0xC0),('sbc',0xE0)):
  _t(n,imm=b+0x09,zp=b+0x05,zpx=b+0x15,abs=b+0x0D,abx=b+0x1D,aby=b+0x19,izx=b+0x01,izy=b+0x11)
_t('sta',zp=0x85,zpx=0x95,abs=0x8D,abx=0x9D,aby=0x99,izx=0x81,izy=0x91)
for n,b in (('asl',0x00),('rol',0x20),('lsr',0x40),('ror',0x60)):
  _t(n,imp=b+0x0A,zp=b+0x06,zpx=b+0x16,abs=b+0x0E,abx=b+0x1E)
_t('inc',zp=0xE6,zpx=0xF6,abs=0xEE,abx=0xFE); _t('dec',zp=0xC6,zpx=0xD6,abs=0xCE,abx=0xDE)
_t('ldx',imm=0xA2,zp=0xA6,zpy=0xB6,abs=0xAE,aby=0xBE); _t('ldy',imm=0xA0,zp=0xA4,zpx=0xB4,abs=0xAC,abx=0xBC)
_t('stx',zp=0x86,zpy=0x96,abs=0x8E); _t('sty',zp=0x84,zpx=0x94,abs=0x8C)
_t('cpx',imm=0xE0,zp=0xE4,abs=0xEC); _t('cpy',imm=0xC0,zp=0xC4,abs=0xCC); _t('bit',zp=0x24,abs=0x2C)
_t('jmp',abs=0x4C,ind=0x6C); _t('jsr',abs=0x20)
for n,o in (('bpl',0x10),('bmi',0x30),('bvc',0x50),('bvs',0x70),('bcc',0x90),('bcs',0xB0),('bne',0xD0),('beq',0xF0)): _t(n,rel=o)
for n,o in (('brk',0x00),('clc',0x18),('cld',0xD8),('cli',0x58),('clv',0xB8),('dex',0xCA),('dey',0x88),('inx',0xE8),('iny',0xC8),
            ('nop',0xEA),('pha',0x48),('php',0x08),('pla',0x68),('plp',0x28),('rti',0x40),('rts',0x60),('sec',0x38),('sed',0xF8),
            ('sei',0x78),('tax',0xAA),('tay',0xA8),('tsx',0xBA),('txa',0x8A),('txs',0x9A),('tya',0x98)): _t(n,imp=o)
SIZE={'imp':1,'imm':2,'zp':2,'zpx':2,'zpy':2,'izx':2,'izy':2,'rel':2,'abs':3,'abx':3,'aby':3,'ind':3}

def assemble(src,org,consts):
  consts=dict(consts)
  lines=[]
  for l in src.split('\n'):
    l=l.split(';')[0].strip()
    if not l: continue
    m=re.match(r'^(\w+)\s*=\s*(.+)$',l)
    if m: lines.append(('=',m.group(1),m.group(2))); continue
    m=re.match(r'^(\w+):\s*(.*)$',l)
    if m:
      lines.append((':',m.group(1)))
      if m.group(2): lines.append(('i',m.group(2)))
    else: lines.append(('i',l))
  def val(s,labels):
    s=s.strip()
    names=dict(consts); names.update(labels)
    s=re.sub(r'\$([0-9A-Fa-f]+)',r'0x\1',s)
    s=re.sub(r'\b([A-Za-z_]\w*)\b',lambda m: str(names[m.group(1)]) if m.group(1) in names else m.group(1),s)
    return eval(s,{'__builtins__':{}})
  labs={}
  for p in range(2):
    pc=org; out=[]; labels=dict(labs) if p else {}
    for l in lines:
      if l[0]=='=':
        try: consts[l[1]]=val(l[2],labels)
        except Exception:
          if p: raise
          consts[l[1]]=0x1000
        continue
      if l[0]==':':
        if p==0 and l[1] in labels: raise Exception('rótulo repetido: '+l[1])
        labels[l[1]]=pc; continue
      l=l[1]
      if l.startswith('.org'):
        t=val(l[4:],labels); out+=[0]*(t-pc); pc=t; continue
      if l.startswith('.byte'):
        bs=[(val(x,labels)&0xff) if p else 0 for x in l[5:].split(',')]; out+=bs; pc+=len(bs); continue
      if l.startswith('.word'):
        for x in l[5:].split(','):
          v=val(x,labels) if p else 0; out+=[v&0xff,(v>>8)&0xff]; pc+=2
        continue
      m=l.split(None,1); op=m[0].lower(); arg=m[1].strip() if len(m)>1 else ''
      if op not in OPS: raise Exception('instrução desconhecida: '+l)
      modes=OPS[op]
      def known(a):
        try: return val(a,labels)
        except Exception: return None
      if not arg or arg.lower()=='a':
        mode='imp'; arg=''
      elif arg.startswith('#'):
        mode='imm'; arg=arg[1:].strip()
        if arg.startswith('<'): arg='(%s)&255'%arg[1:]
        elif arg.startswith('>'): arg='((%s)>>8)&255'%arg[1:]
      elif 'rel' in modes: mode='rel'
      elif re.match(r'^\(.*\)\s*,\s*y$',arg,re.I): mode='izy'; arg=re.sub(r'\)\s*,\s*y$','',arg,flags=re.I)[1:]
      elif re.match(r'^\(.*,\s*x\)$',arg,re.I): mode='izx'; arg=re.sub(r',\s*x\)$','',arg,flags=re.I)[1:]
      elif arg.startswith('(') and arg.endswith(')') and 'ind' in modes: mode='ind'; arg=arg[1:-1]
      else:
        idx=''
        mm=re.match(r'^(.*),\s*([xy])$',arg,re.I)
        if mm: arg=mm.group(1).strip(); idx=mm.group(2).lower()
        v=known(arg)
        zp=(v is not None and 0<=v<256)
        if idx=='': mode='zp' if zp and 'zp' in modes else 'abs'
        elif idx=='x': mode='zpx' if zp and 'zpx' in modes else 'abx'
        else: mode='zpy' if zp and 'zpy' in modes else 'aby'
      if mode not in modes: raise Exception('modo %s não existe em: %s'%(mode,l))
      v=val(arg,labels) if (arg and p) else 0
      if mode=='rel' and p:
        d=v-(pc+2)
        if d<-128 or d>127: raise Exception('desvio longe demais (%d): %s'%(d,l))
        v=d&0xff
      b=[modes[mode]]+([v&0xff] if SIZE[mode]==2 else [v&0xff,(v>>8)&0xff] if SIZE[mode]==3 else [])
      out+=b; pc+=len(b)
    labs=labels
  return bytes(out),labs

if __name__=='__main__':
  src=open(sys.argv[1]).read()
  m=re.search(r'^\s*\.org\s+(\S+)',src,re.M)
  org=int(m.group(1).replace('$','0x'),0)
  code,labs=assemble(src,org,{})
  name=sys.argv[2]
  print('// gerado por %s (montador 6502 em scripts/rg-asm6502.py); não editar à mão'%sys.argv[1].split('/')[-1])
  if len(sys.argv)>3: print('// '+sys.argv[3])
  for k in sorted(labs):
    if k.isupper() and not k.startswith('L_'): print('#define %s_%s 0x%04x'%(name.upper(),k,labs[k]))
  print('static const unsigned char %s[%d]={'%(name,len(code)))
  for i in range(0,len(code),16): print('  '+', '.join('0x%02x'%b for b in code[i:i+16])+',')
  print('};')
