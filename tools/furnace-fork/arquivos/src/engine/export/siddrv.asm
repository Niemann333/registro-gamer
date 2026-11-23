; driver SID do Tracker do Registro Gamer: um fluxo de comandos por voz (3 por SID) + 1 geral por SID,
; tocados a cada interrupção do timer A da CIA 1. o estado de cada fluxo fica em SAVE+n*20 e é trazido para a página zero.
; os dados podem ficar de $0800 até $FFF9: a leitura liga a RAM toda ($01=$34) só durante o byte lido.
; comandos: 00-58 vv escreve vv em D400+cmd (SID 2 em D420, SID 3 em D440) · E0 lo hi nl nh toca nh:nl bytes de hi:lo e volta
; F0-FD fim do tique e espera cmd-F0 tiques · FE nn espera nn · FF volta à repetição (ou acaba)
.org $0800
  jmp INIT
  jmp PLAY
NSTR: .byte 0
TIMERLO: .byte 0
TIMERHI: .byte 0
INIT:
  lda TIMERLO
  sta $DC04
  lda TIMERHI
  sta $DC05
  rts
PLAY:
  ldx #0
  stx SIDX
tl:
  stx XSAV
  ldy #0
ld:
  lda SAVE,x
  sta WORK,y
  inx
  iny
  cpy #20
  bne ld
  jsr FRAME
  ldx XSAV
  ldy #0
sv:
  lda WORK,y
  sta SAVE,x
  inx
  iny
  cpy #20
  bne sv
  inc SIDX
  lda SIDX
  cmp NSTR
  bne tl
  rts
GB:
  ldy #0
  ldx $01
  lda #$34
  sta $01
  lda (PTR),y
  stx $01
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
FRAME:
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
  lda LOOPL
  ora LOOPH
  beq endsong
  lda LOOPL
  sta PTR
  lda LOOPH
  sta PTRH
  jmp next
reg:
  sta REGT
  jsr GB
  ldx REGT
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
SAVE:
