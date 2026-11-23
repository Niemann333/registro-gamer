; driver HES do Tracker do Registro Gamer (HuC6280, PC Engine). Fica no banco físico 0, visto em $E000 (MPR7).
; o registro da música fica dos bancos 1 em diante e é lido pela janela $4000-$5FFF (MPR2).
; o timer do HuC6280 (7,16 MHz / 1024 / (N+1)) chama a interrupção; um acumulador de 24 bits soma RATE a cada
; chamada e, quando passa de 2^24, toca um tique (assim qualquer taxa de tique funciona).
; página zero do HuC6280 = $2000 (banco de RAM $F8 no MPR1); E/S no MPR0 ($FF): PSG em $0800.
; montar: python3 scripts/rg-asm6502.py hesdrv.asm hesDriver "comentário" > hesdrv.inc
;
; registro: 00-09 vv = escreve vv no registrador do PSG ($0800+cmd); E0 a0 a1 a2 n0 n1 = toca n bytes que estão no
; deslocamento a do registro e volta (trechos repetidos, aninhados até 8); F0-FD = fim do tique e espera cmd-F0
; tiques a mais; FE nn = espera nn; FF = volta ao ponto de repetição (ou acaba)

PTR = $00
BANK = $02
ACC = $03
WAIT = $06
STOP = $07
DEPTH = $08
CNTL = $09
CNTH = $0A
T0 = $0B
T1 = $0C
STKB = $10
STKL = $18
STKH = $20
STKCL = $28
STKCH = $30

.org $E000
INIT:
  sei
  lda #1
  .byte $53, $04          ; tam #$04: banco 1 em $4000
  sta BANK
  lda #0
  sta PTR
  sta ACC
  sta ACC+1
  sta ACC+2
  sta WAIT
  sta STOP
  sta DEPTH
  lda #$40
  sta PTR+1
  lda TIMERN
  sta $0C00
  lda #1
  sta $0C01
  lda #$03                ; só a interrupção do timer
  sta $1402
  cli
  rts

TIRQ:
  sta $1403               ; reconhece o timer logo de cara
  pha
  txa
  pha
  tya
  pha
  lda BANK                ; garante o banco do registro em $4000
  .byte $53, $04
  clc
  lda ACC
  adc RATE
  sta ACC
  lda ACC+1
  adc RATE+1
  sta ACC+1
  lda ACC+2
  adc RATE+2
  sta ACC+2
  bcc tx
  jsr TICK
tx:
  pla
  tay
  pla
  tax
  pla
  rti

NOIRQ:
  rti

TICK:
  lda STOP
  bne tk9
  lda WAIT
  beq rd
  dec WAIT
tk9:
  rts
rd:
  jsr GB
  cmp #$F0
  bcs ctl
  cmp #$E0
  beq ref
  sta T1
  jsr GB
  ldx T1
  sta $0800,x
  jmp rd
ctl:
  cmp #$FE
  bcc wk
  beq wn
  ; FF: repetição ou fim
  lda LOOPB
  beq fim
  sta BANK
  .byte $53, $04
  lda LOOPL
  sta PTR
  lda LOOPH
  sta PTR+1
  jmp rd
wk:
  sbc #$EF                ; C=0: A-$F0
  sta WAIT
  rts
wn:
  jsr GB
  sta WAIT
  rts
fim:
  lda #1
  sta STOP
  lda #0
  sta $0801               ; volume geral zerado
  rts

; trecho repetido: guarda onde estava e vai para o deslocamento a (banco 1 + a/8192, $4000 + a%8192)
ref:
  jsr GB
  sta T0
  jsr GB
  pha
  jsr GB
  pha
  jsr GB
  pha
  jsr GB
  ldx DEPTH
  pha
  lda BANK
  sta STKB,x
  lda PTR
  sta STKL,x
  lda PTR+1
  sta STKH,x
  lda CNTL
  sta STKCL,x
  lda CNTH
  sta STKCH,x
  inx
  stx DEPTH
  pla
  sta CNTH
  pla
  sta CNTL
  pla                     ; a2
  asl a
  asl a
  asl a
  sta BANK
  pla                     ; a1
  pha
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  ora BANK
  clc
  adc #1
  sta BANK
  .byte $53, $04
  pla
  and #$1F
  ora #$40
  sta PTR+1
  lda T0
  sta PTR
  jmp rd

; um byte do registro (passa para o próximo banco no fim da janela; no fim de um trecho repetido, volta)
GB:
  ldy #0
  lda (PTR),y
  inc PTR
  bne gb1
  inc PTR+1
  ldy PTR+1
  cpy #$60
  bne gb1
  pha
  lda #$40
  sta PTR+1
  inc BANK
  lda BANK
  .byte $53, $04
  pla
gb1:
  ldy DEPTH
  beq gb9
  pha
  lda CNTL
  bne gb2
  dec CNTH
gb2:
  dec CNTL
  lda CNTL
  ora CNTH
  bne gb3
  ldx DEPTH
  dex
  stx DEPTH
  lda STKB,x
  sta BANK
  .byte $53, $04
  lda STKL,x
  sta PTR
  lda STKH,x
  sta PTR+1
  lda STKCL,x
  sta CNTL
  lda STKCH,x
  sta CNTH
gb3:
  pla
gb9:
  rts

TIMERN: .byte 0
RATE: .byte 0, 0, 0
LOOPB: .byte 0
LOOPL: .byte 0
LOOPH: .byte 0
