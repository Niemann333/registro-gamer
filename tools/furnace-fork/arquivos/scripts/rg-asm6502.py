# mini montador 6502 (só o necessário para o driver NSF), duas passadas com rótulos
import re,sys
OPS={ # (modo) -> opcode
 'lda':{'imm':0xA9,'zp':0xA5,'abs':0xAD,'izy':0xB1,'abx':0xBD},'sta':{'zp':0x85,'abs':0x8D,'izy':0x91,'abx':0x9D},
 'ldx':{'imm':0xA2,'zp':0xA6,'abs':0xAE},'ldy':{'imm':0xA0,'zp':0xA4},'stx':{'zp':0x86,'abs':0x8E},
 'cmp':{'imm':0xC9,'zp':0xC5},'ora':{'imm':0x09,'zp':0x05},'adc':{'imm':0x69,'abs':0x6D,'zp':0x65},'sbc':{'imm':0xE9},
 'inc':{'zp':0xE6},'dec':{'zp':0xC6},'jmp':{'abs':0x4C},'jsr':{'abs':0x20},
 'bne':{'rel':0xD0},'beq':{'rel':0xF0},'bcc':{'rel':0x90},'bcs':{'rel':0xB0},'bpl':{'rel':0x10},
 'rts':{'imp':0x60},'tax':{'imp':0xAA},'dex':{'imp':0xCA},'pha':{'imp':0x48},'pla':{'imp':0x68},'clc':{'imp':0x18},'sec':{'imp':0x38},'asl':{'imp':0x0A},'nop':{'imp':0xEA},'tay':{'imp':0xA8},'iny':{'imp':0xC8},
}
SIZE={'imp':1,'imm':2,'zp':2,'izy':2,'rel':2,'abs':3,'abx':3}
def assemble(src,org,consts):
  lines=[]
  for l in src.split('\n'):
    l=l.split(';')[0].strip()
    if not l: continue
    m=re.match(r'^(\w+):\s*(.+)$',l)
    if m: lines.append(m.group(1)+':'); lines.append(m.group(2))
    else: lines.append(l)
  def val(s,labels):
    s=s.strip()
    for k,v in list(consts.items())+list(labels.items()): s=re.sub(r'\b'+re.escape(k)+r'\b',str(v),s)
    s=s.replace('$','0x'); return eval(s)
  for p in range(2):
    pc=org; out=[]; labels={} if p==0 else labs
    for l in lines:
      if l.endswith(':'):
        labels[l[:-1]]=pc; continue
      if l.startswith('.org'):
        t=val(l[4:],labels); out+= [0]*(t-pc); pc=t; continue
      if l.startswith('.byte'):
        bs=[val(x,labels) if p else 0 for x in l[5:].split(',')]; out+=bs; pc+=len(bs); continue
      m=l.split(None,1); op=m[0].lower(); arg=m[1].strip() if len(m)>1 else ''
      modes=OPS[op]
      if 'imp' in modes and not arg: mode='imp'
      elif arg.startswith('#'): mode='imm'; arg=arg[1:]
      elif arg.endswith(',y') and arg.startswith('('): mode='izy'; arg=arg[1:-3]
      elif arg.endswith(',x'): mode='abx'; arg=arg[:-2]
      elif 'rel' in modes: mode='rel'
      else:
        try: v=val(arg,labels)
        except Exception: v=0x1000
        mode='zp' if v<256 and 'zp' in modes else 'abs'
      v=val(arg,labels) if (arg and p) else 0
      if mode=='rel': v=(v-(pc+2))&0xff if p else 0
      if mode not in modes: raise Exception('modo %s em %s'%(mode,l))
      b=[modes[mode]]+([v&0xff] if SIZE[mode]==2 else [v&0xff,(v>>8)&0xff] if SIZE[mode]==3 else [])
      out+=b; pc+=len(b)
    labs=labels
  return bytes(out),labs
