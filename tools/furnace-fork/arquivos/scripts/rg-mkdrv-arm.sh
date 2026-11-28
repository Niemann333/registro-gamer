#!/bin/sh
# monta um driver ARM e gera o .inc: mkdrv.sh fonte.s base nome-do-array saida.inc "comentario"
set -e
llvm-mc -triple=armv4t -filetype=obj -o /tmp/drv.o "$1"
ld.lld -Ttext=$2 -e _start -o /tmp/drv.elf /tmp/drv.o
llvm-objcopy -O binary /tmp/drv.elf /tmp/drv.bin
python3 - "$3" "$4" "$5" <<'PY'
import sys
b=open('/tmp/drv.bin','rb').read()
name,out,com=sys.argv[1:4]
lines=['// '+com+'; não editar à mão','static const unsigned char %s[%d]={'%(name,len(b))]
for i in range(0,len(b),16):
  lines.append('  '+', '.join('0x%02x'%x for x in b[i:i+16])+',')
lines.append('};')
open(out,'w').write('\n'.join(lines)+'\n')
print(len(b),'bytes')
PY
