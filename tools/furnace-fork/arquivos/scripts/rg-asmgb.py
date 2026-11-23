# mini montador SM83 (CPU do Game Boy) — só as instruções do driver GBS; duas passadas com rótulos
import re
PAT=[
 (r'ld a,\(hl\+\)$', [0x2A], ''),
 (r'ldh \(\$ff00\+c\),a$', [0xE2], ''),
 (r'ldh a,\((.+)\)$', [0xF0], 'b'),
 (r'ldh \((.+)\),a$', [0xE0], 'b'),
 (r'ld a,\((.+)\)$', [0xFA], 'w'),
 (r'ld \((.+)\),a$', [0xEA], 'w'),
 (r'ld a,#(.+)$', [0x3E], 'b'),
 (r'ld c,a$', [0x4F], ''),
 (r'ld l,a$', [0x6F], ''),
 (r'ld h,a$', [0x67], ''),
 (r'ld a,l$', [0x7D], ''),
 (r'ld a,h$', [0x7C], ''),
 (r'ld hl,#(.+)$', [0x21], 'w'),
 (r'xor a$', [0xAF], ''),
 (r'or a$', [0xB7], ''),
 (r'inc a$', [0x3C], ''),
 (r'dec a$', [0x3D], ''),
 (r'dec hl$', [0x2B], ''),
 (r'add a,#(.+)$', [0xC6], 'b'),
 (r'sub #(.+)$', [0xD6], 'b'),
 (r'cp #(.+)$', [0xFE], 'b'),
 (r'push af$', [0xF5], ''),
 (r'pop af$', [0xF1], ''),
 (r'ret$', [0xC9], ''),
 (r'call (.+)$', [0xCD], 'w'),
 (r'jp (.+)$', [0xC3], 'w'),
 (r'jr z,(.+)$', [0x28], 'r'),
 (r'jr nz,(.+)$', [0x20], 'r'),
 (r'jr c,(.+)$', [0x38], 'r'),
 (r'jr nc,(.+)$', [0x30], 'r'),
 (r'jr (.+)$', [0x18], 'r'),
]
def assemble(src,org,consts):
  lines=[]
  for l in src.split('\n'):
    l=l.split(';')[0].strip()
    if not l: continue
    m=re.match(r'^(\w+):\s*(.*)$',l)
    if m:
      lines.append(m.group(1)+':')
      if m.group(2): lines.append(m.group(2))
    else: lines.append(l)
  labs={}
  for p in range(2):
    pc=org; out=[]; labels={}
    def val(s):
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
        m=re.match(pat,l)
        if m: break
      else: raise Exception('não sei: '+l)
      b=list(op)
      if kind=='b': b.append(val(m.group(1))&255)
      elif kind=='w': v=val(m.group(1)); b+=[v&255,(v>>8)&255]
      elif kind=='r':
        r=val(m.group(1))-(pc+2)
        if p and not -128<=r<=127: raise Exception('desvio longe: '+l)
        b.append(r&255)
      out+=b; pc+=len(b)
    labs=labels
  return bytes(out),labs
