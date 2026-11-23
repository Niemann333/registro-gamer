# mini montador SPC700 (só as instruções do driver SPC), duas passadas com rótulos
import re
# padrão -> (opcode, ordem dos operandos)   d=byte de página direta, i=imediato, a=endereço absoluto 16 bits, r=desvio relativo
PAT=[
 (r'mov x,a$',         0x5D, ''),
 (r'mov ([\w$]+)\+x,a$', 0xD4, 'd'),
 (r'mov a,([\w$]+)\+x$', 0xF4, 'd'),
 (r'inc ([\w$]+)$',     0xAB, 'd'),
 (r'mov a,#(.+)$',     0xE8, 'i'),
 (r'mov y,#(.+)$',     0x8D, 'i'),
 (r'mov x,#(.+)$',     0xCD, 'i'),
  (r'mov ([\w$]+),#(.+)$', 0x8F, 'id'),
 (r'mov a,\[([\w$]+)\]\+y$', 0xF7, 'd'),
 (r'mov \[([\w$]+)\]\+y,a$', 0xD7, 'd'),
 (r'mov a,!(.+)$',     0xE5, 'a'),
 (r'mov !(.+)\+x,a$',  0xD5, 'a'),
 (r'mov !(.+),a$',     0xC5, 'a'),
 (r'mov a,([\w$]+)$',     0xE4, 'd'),
 (r'mov ([\w$]+),a$',     0xC4, 'd'),
 (r'movw ya,([\w$]+)$',   0xBA, 'd'),
 (r'movw ([\w$]+),ya$',   0xDA, 'd'),
 (r'incw ([\w$]+)$',      0x3A, 'd'),
 (r'decw ([\w$]+)$',      0x1A, 'd'),
 (r'dec ([\w$]+)$',       0x8B, 'd'),
 (r'push a$',          0x2D, ''),
 (r'pop a$',           0xAE, ''),
 (r'cmp a,#(.+)$',     0x68, 'i'),
 (r'beq ([\w$]+)$',       0xF0, 'r'),
 (r'bne ([\w$]+)$',       0xD0, 'r'),
 (r'bcs ([\w$]+)$',       0xB0, 'r'),
 (r'bcc ([\w$]+)$',       0x90, 'r'),
 (r'bra ([\w$]+)$',       0x2F, 'r'),
 (r'dbnz ([\w$]+),([\w$]+)$',0x6E, 'dr'),
 (r'call !(.+)$',      0x3F, 'a'),
 (r'ret$',             0x6F, ''),
 (r'asl a$',           0x1C, ''),
 (r'setc$',            0x80, ''),
 (r'sbc a,#(.+)$',     0xA8, 'i'),
 (r'jmp !(.+)$',       0x5F, 'a'),
]
def assemble(src,org,consts):
  lines=[]
  for l in src.split('\n'):
    l=l.split(';')[0].strip()
    if not l: continue
    m=re.match(r'^([\w$]+):\s*(.*)$',l)
    if m:
      lines.append(m.group(1)+':')
      if m.group(2): lines.append(m.group(2))
    else: lines.append(l)
  labs={}
  for p in range(2):
    pc=org; out=[]; labels={}
    def val(s):
      s=s.strip()
      env=dict(consts); env.update(labs if p else {}); env.update(labels)
      for k in sorted(env,key=len,reverse=True): s=re.sub(r'\b'+re.escape(k)+r'\b',str(env[k]),s)
      s=s.replace('$','0x')
      try: return eval(s,{'__builtins__':{}})
      except Exception:
        if p: raise
        return 0
    for l in lines:
      if l.endswith(':'): labels[l[:-1]]=pc; continue
      if l.startswith('.org'): t=val(l[4:]); out+=[0]*(t-pc); pc=t; continue
      if l.startswith('.byte'): bs=[val(x)&255 for x in l[5:].split(',')]; out+=bs; pc+=len(bs); continue
      for pat,op,kind in PAT:
        m=re.match(pat,l.lower() if False else l)
        if m: break
      else: raise Exception('não sei: '+l)
      g=m.groups(); b=[op]
      if kind=='id': b+=[val(g[1])&255, val(g[0])&255]
      elif kind=='i' or kind=='d': b+=[val(g[0])&255]
      elif kind=='a': v=val(g[0]); b+=[v&255,(v>>8)&255]
      elif kind=='r':
        t=val(g[0]); r=t-(pc+2)
        if p and not -128<=r<=127: raise Exception('desvio longe: '+l)
        b+=[r&255]
      elif kind=='dr':
        t=val(g[1]); r=t-(pc+3)
        if p and not -128<=r<=127: raise Exception('desvio longe: '+l)
        b+=[val(g[0])&255, r&255]
      out+=b; pc+=len(b)
    labs=labels
  return bytes(out),labs
