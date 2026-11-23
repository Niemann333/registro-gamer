; driver SPC do Tracker do Registro Gamer: a cada tique do timer 0 repete as escritas gravadas no S-DSP
; o log fica na RAM livre depois dos samples; comandos iguais aos de rgexport (ver spc.cpp)
.org $0200
INIT:
  mov $F1,#$00
  mov $FA,#TIMER
  mov $F1,#$01
  mov a,!STREAMLO
  mov PTR,a
  mov a,!STREAMHI
  mov PTRH,a
  mov WAIT,#0
  mov DEPTH,#0
main:
  mov a,$FD
  beq main
  mov CNT,a
fl:
  call !FRAME
  dbnz CNT,fl
  bra main
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
  bcs waitop
  cmp a,#$82
  beq blk
  cmp a,#$E0
  beq ref
  jmp !next
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
  bra next
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
  mov a,!HASLOOP
  beq endsong
  mov a,!LOOPLO
  mov PTR,a
  mov a,!LOOPHI
  mov PTRH,a
  jmp !next
endsong:
  mov $F2,#$5C
  mov $F3,#$FF
  mov WAIT,#$FF
  decw PTR
  ret
.org $03F0
STREAMLO: .byte 0
STREAMHI: .byte 0
LOOPLO: .byte 0
LOOPHI: .byte 0
HASLOOP: .byte 0
