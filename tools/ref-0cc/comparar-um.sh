# one.sh arquivo -> compara Furnace x NSF do 0CC (só 2A03), uma linha de resumo
f="$1"; b=/tmp/ftall/$(echo "$f" | md5sum | cut -c1-8); cp "$f" $b.ftm
exp=$(python3 -c "
import struct,sys
d=open('$b.ftm','rb').read();i=d.index(b'PARAMS');print(d[i+24])")
OCC_LENIENT=1 timeout 60 /home/claude/work/occ315/0ccft-ext/build/occnsf $b.ftm $b.nsf >$b.occ.txt 2>&1 || { echo "OCC-FALHOU exp=$exp | $f"; exit; }
secs=$(python3 -c "print(min(180,max(30,0)))")
# referência: o player do próprio 0CC (o mesmo do editor); o NSF fica como segunda referência
OCC_LENIENT=1 timeout 120 /home/claude/work/occ315/0ccft-ext/build/occrender $b.ftm $b.ref.log 120 >$b.rate.txt 2>&1 || node /home/claude/work/nsflog.js $b.nsf $b.ref.log 120 2>/dev/null
timeout 120 /home/claude/furnace/build-cli/furnace -loops 0 -direct -vgmout $b.vgm $b.ftm >/dev/null 2>&1
python3 /home/claude/work/vgmlog.py $b.vgm $b.fur.log
export RATE=$(grep -o "taxa [0-9.]*" $b.rate.txt 2>/dev/null | cut -d' ' -f2); [ -z "$RATE" ] && RATE=60
r=$(python3 /home/claude/work/apucmp.py $b.ref.log $b.fur.log 7200 2>&1 | grep -v "DMC.addr" | awk 'NR==1{n=$0;next}{split($1,a,":");printf "%s=%s ",a[1],$2}' )
echo "exp=$exp $r | $(basename "$f")"
