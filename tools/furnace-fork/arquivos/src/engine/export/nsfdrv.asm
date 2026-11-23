; driver NSF do Tracker do Registro Gamer: repete as escritas de registrador gravadas a cada quadro
; dados: janela $9000-$9FFF (banco trocado em $5FF9); samples DPCM em $C000-$FFFF (bancos em $5FFC-$5FFF)
.org $8000
LOOPBANK: .byte 0
LOOPLO: .byte 0
LOOPHI: .byte 0
HASLOOP: .byte 0
DPCMBASE: .byte 0
.org $8010
INIT:
  lda #0
  ldx #$13
clr:
  sta $4000,x
  dex
  bpl clr
  lda #$0F
  sta $4015
  lda #$40
  sta $4017
  lda #1
  sta BANK
  sta $5FF9
  lda #0
  sta PTR
  sta WAIT
  sta ENDF
  lda #$90
  sta PTRH
  lda #0
  jsr DPCMB
  rts
GB:
  ldy #0
  lda (PTR),y
  inc PTR
  bne gb1
  inc PTRH
  pha
  lda PTRH
  cmp #$A0
  bne gb2
  lda #$90
  sta PTRH
  inc BANK
  lda BANK
  sta $5FF9
gb2:
  pla
gb1:
  rts
DPCMB:
  asl
  asl
  clc
  adc DPCMBASE
  sta $5FFC
  clc
  adc #1
  sta $5FFD
  clc
  adc #1
  sta $5FFE
  clc
  adc #1
  sta $5FFF
  rts
PLAY:
  lda ENDF
  bne pret
  lda WAIT
  beq next
  dec WAIT
pret:
  rts
next:
  jsr GB
  cmp #$80
  bcc apu
  cmp #$F0
  bcs waitop
  cmp #$80
  beq gen
  cmp #$81
  beq vrc7
  cmp #$82
  beq n163
  cmp #$83
  beq dpcm
  jmp next
apu:
  tax
  jsr GB
  sta $4000,x
  jmp next
gen:
  jsr GB
  sta T0
  jsr GB
  sta T1
  jsr GB
  ldy #0
  sta (T0),y
  jmp next
vrc7:
  jsr GB
  sta $9010
  jsr GB
  sta $9030
  ldx #8
v7d:
  dex
  bne v7d
  jmp next
n163:
  jsr GB
  sta $F800
  jsr GB
  sta $4800
  jmp next
dpcm:
  jsr GB
  jsr DPCMB
  jmp next
waitop:
  cmp #$FF
  beq loopop
  cmp #$FE
  beq waitn
  sec
  sbc #$F0
  sta WAIT
  rts
waitn:
  jsr GB
  sta WAIT
  rts
loopop:
  lda HASLOOP
  beq endsong
  lda LOOPBANK
  sta BANK
  sta $5FF9
  lda LOOPLO
  sta PTR
  lda LOOPHI
  sta PTRH
  jmp next
endsong:
  lda #1
  sta ENDF
  lda #0
  sta $4015
  rts
