; driver SPC do Tracker do Registro Gamer: 9 fluxos de comandos (uma voz cada + 1 geral) tocados a cada tique do timer 0
; o estado de cada fluxo fica em SAVE+n*20 (ponteiro, espera, pilha das referências, repetição) e é trazido para a página zero
; comandos: 00-7F vv escreve vv no registrador do DSP · 82 lo hi nn dados… copia para a RAM · 83 dl dh sl sh nn copia de sh:sl
; 84 liga esta voz (KON) · 85 desliga esta voz (KOFF: pulso no fim do tique, antes do KON) · E0 lo hi nl nh toca nh:nl bytes de hi:lo e volta (até 3 níveis)
; F0-FD fim do tique e espera cmd-F0 tiques · FE nn espera nn · FF volta à repetição (ou acaba)
.org $0200
INIT:
  mov $F1,#$00
  mov $FA,#TIMER
  mov $F1,#$01
  mov KONM,#0
  mov KOFFM,#0
main:
  mov a,$FD
  beq main
  mov CNT,a
fl:
  call !TICK
  dbnz CNT,fl
  bra main
TICK:
  mov SIDX,#0
  mov VBIT,#1
  mov y,#0
tl:
  mov YSAV,y
  mov x,#0
ld:
  mov a,!SAVE+y
  mov WORK+x,a
  inc x
  inc y
  cmp x,#20
  bne ld
  call !FRAME
  mov y,YSAV
  mov x,#0
sv:
  mov a,WORK+x
  mov !SAVE+y,a
  inc x
  inc y
  cmp x,#20
  bne sv
  asl VBIT
  inc SIDX
  mov a,SIDX
  cmp a,#9
  bne tl
  mov $F2,#$5C
  mov a,KOFFM
  mov $F3,a
  mov x,#20
kdly:
  dec x
  bne kdly
  mov $F3,#$00
  mov $F2,#$4C
  mov a,KONM
  mov $F3,a
  mov KONM,#0
  mov KOFFM,#0
  ret
GB:
  mov y,#0
  mov a,[PTR]+y
  incw PTR
  push a
  mov a,DEPTH
  beq gbe
  decw RCNT
  bne gbe
  dec DEPTH
  mov a,DEPTH
  asl a
  asl a
  mov x,a
  mov a,STK+x
  mov PTR,a
  mov a,STK1+x
  mov PTRH,a
  mov a,STK2+x
  mov RCNT,a
  mov a,STK3+x
  mov RCNTH,a
gbe:
  pop a
  ret
FRAME:
  mov a,WAIT
  beq next
  dec WAIT
  ret
next:
  call !GB
  cmp a,#$80
  bcs notdsp
  mov $F2,a
  call !GB
  mov $F3,a
  bra next
notdsp:
  cmp a,#$F0
  bcc nwait
  jmp !waitop
nwait:
  cmp a,#$84
  beq kon
  cmp a,#$85
  beq koff
  cmp a,#$82
  beq blk
  cmp a,#$83
  beq cpy
  cmp a,#$E0
  beq ref
  bra next
kon:
  mov a,VBIT
  or a,KONM
  mov KONM,a
  bra next
koff:
  mov a,VBIT
  or a,KOFFM
  mov KOFFM,a
  bra next
blk:
  call !GB
  mov BLO,a
  call !GB
  mov BHI,a
  call !GB
  mov BCNT,a
blkl:
  call !GB
  mov y,#0
  mov [BLO]+y,a
  incw BLO
  dbnz BCNT,blkl
  jmp !next
cpy:
  call !GB
  mov BLO,a
  call !GB
  mov BHI,a
  call !GB
  mov TLO,a
  call !GB
  mov THI,a
  call !GB
  mov BCNT,a
cpyl:
  mov y,#0
  mov a,[TLO]+y
  mov [BLO]+y,a
  incw TLO
  incw BLO
  dbnz BCNT,cpyl
  jmp !next
ref:
  call !GB
  mov TLO,a
  call !GB
  mov THI,a
  call !GB
  mov LLO,a
  call !GB
  mov LHI,a
  mov a,DEPTH
  asl a
  asl a
  mov x,a
  mov a,PTR
  mov STK+x,a
  mov a,PTRH
  mov STK1+x,a
  mov a,RCNT
  mov STK2+x,a
  mov a,RCNTH
  mov STK3+x,a
  inc DEPTH
  movw ya,TLO
  movw PTR,ya
  movw ya,LLO
  movw RCNT,ya
  jmp !next
waitop:
  cmp a,#$FF
  beq loopop
  cmp a,#$FE
  beq waitn
  setc
  sbc a,#$F0
  mov WAIT,a
  ret
waitn:
  call !GB
  mov WAIT,a
  ret
loopop:
  mov a,LOOPL
  or a,LOOPH
  beq endsong
  movw ya,LOOPL
  movw PTR,ya
  jmp !next
endsong:
  mov a,SIDX
  cmp a,#8
  bne es2
  mov $F2,#$5C
  mov $F3,#$FF
es2:
  mov WAIT,#$FF
  decw PTR
  ret
