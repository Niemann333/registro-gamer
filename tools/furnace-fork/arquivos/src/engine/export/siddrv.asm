; driver SID do Tracker do Registro Gamer: a cada interrupção do timer A da CIA 1 repete as escritas gravadas no SID
; comandos: 00-58 vv escreve vv em D400+cmd (SID 2 em D420, SID 3 em D440) · E0 lo hi nl nh toca nh:nl bytes de hi:lo e volta
; F0-FD fim do tique e espera cmd-F0 tiques · FE nn espera nn · FF repete/acaba
.org $1000
  jmp INIT
  jmp PLAY
STREAMLO: .byte 0
STREAMHI: .byte 0
LOOPLO: .byte 0
LOOPHI: .byte 0
HASLOOP: .byte 0
TIMERLO: .byte 0
TIMERHI: .byte 0
INIT:
  lda STREAMLO
  sta PTR
  lda STREAMHI
  sta PTRH
  lda #0
  sta WAIT
  sta DEPTH
  lda TIMERLO
  sta $DC04
  lda TIMERHI
  sta $DC05
  rts
GB:
  ldy #0
  lda (PTR),y
  inc PTR
  bne gb1
  inc PTRH
gb1:
  pha
  lda DEPTH
  beq gbe
  lda RCNT
  bne gb2
  dec RCNTH
gb2:
  dec RCNT
  lda RCNT
  ora RCNTH
  bne gbe
  dec DEPTH
  lda DEPTH
  asl
  asl
  tax
  lda STK,x
  sta PTR
  lda STK1,x
  sta PTRH
  lda STK2,x
  sta RCNT
  lda STK3,x
  sta RCNTH
gbe:
  pla
  rts
PLAY:
  lda WAIT
  beq next
  dec WAIT
  rts
next:
  jsr GB
  cmp #$60
  bcc reg
  cmp #$E0
  beq ref
  cmp #$F0
  bcc next
  cmp #$FE
  bcc waitk
  beq waitn
  lda HASLOOP
  beq endsong
  lda LOOPLO
  sta PTR
  lda LOOPHI
  sta PTRH
  jmp next
reg:
  tax
  jsr GB
  sta $D400,x
  jmp next
ref:
  jsr GB
  sta T0
  jsr GB
  sta T1
  jsr GB
  sta T2
  jsr GB
  sta T3
  lda DEPTH
  asl
  asl
  tax
  lda PTR
  sta STK,x
  lda PTRH
  sta STK1,x
  lda RCNT
  sta STK2,x
  lda RCNTH
  sta STK3,x
  inc DEPTH
  lda T0
  sta PTR
  lda T1
  sta PTRH
  lda T2
  sta RCNT
  lda T3
  sta RCNTH
  jmp next
waitk:
  sec
  sbc #$F0
  sta WAIT
  rts
waitn:
  jsr GB
  sta WAIT
  rts
endsong:
  lda #0
  sta $D418
  sta $D438
  sta $D458
  lda #$FF
  sta WAIT
  lda PTR
  bne es1
  dec PTRH
es1:
  dec PTR
  rts
