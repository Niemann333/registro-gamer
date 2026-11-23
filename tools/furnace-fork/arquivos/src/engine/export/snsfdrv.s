; programa do SNES (65816) do SNSF do Tracker do Registro Gamer. ROM HiROM: este código fica no banco $00 em $8000
; (arquivo $8000); os dados (programa do SPC700, samples e o registro da música) ficam de $C1:0000 em diante.
; 1) manda o driver do SPC700 (snsfspc.asm) para $0200 e as samples para $0400 pelo carregador da ROM do APU (IPL);
; 2) depois manda o registro da música, 3 bytes por vez ($2141-$2143) com um contador em $2140, que o SPC devolve
;    quando guardou. o ritmo quem dita é o SPC (timer 0); aqui é só manter a fila dele cheia.
; montar: ca65 --cpu 65816 snsfdrv.s && ld65 -C snsfdrv.cfg snsfdrv.o -o snsfdrv.bin -Ln snsfdrv.lbl
.p816
.smart -

PTR = $00
END = $03
LOOPP = $06
SRC = $09
LEN = $0C
DEST = $0E
KICK = $10
CNT = $11

.segment "CODE"
; tabela preenchida pelo exportador (endereços de 24 bits)
TAB_LOG:     .res 3     ; começo do registro
TAB_END:     .res 3     ; fim do registro
TAB_LOOP:    .res 3     ; ponto de repetição (sem repetição: o último byte)
TAB_ARAM:    .res 3     ; samples e ondas para a RAM do SPC ($0400)
TAB_ARAMLEN: .res 2
TAB_DRV:     .res 3     ; driver do SPC700 ($0200)
TAB_DRVLEN:  .res 2
             .res 15

RESET:
  sei
  clc
  xce
  rep #$18
  .i16
  sep #$20
  .a8
  ldx #$1FFF
  txs
  lda #$80
  sta $2100
  stz $4200
  ; espera o carregador do APU
wr:
  lda $2140
  cmp #$AA
  bne wr
  lda $2141
  cmp #$BB
  bne wr
  lda #$CC
  sta KICK
  ; driver do SPC700 em $0200
  ldx TAB_DRV
  stx SRC
  lda TAB_DRV+2
  sta SRC+2
  ldx TAB_DRVLEN
  stx LEN
  ldx #$0200
  stx DEST
  jsr BLOCK
  ; samples em $0400
  ldx TAB_ARAM
  stx SRC
  lda TAB_ARAM+2
  sta SRC+2
  ldx TAB_ARAMLEN
  stx LEN
  ldx #$0400
  stx DEST
  jsr BLOCK
  ; começa o driver em $0200
  ldx #$0200
  stx $2142
  stz $2141
  lda KICK
  sta $2140
  ; espera o carregador aceitar (devolve KICK) e o driver dizer que está pronto ($2140 = 0)
acc:
  cmp $2140
  bne acc
rdy:
  lda $2140
  bne rdy
  ; registro da música
  ldx TAB_LOG
  stx PTR
  lda TAB_LOG+2
  sta PTR+2
  ldx TAB_END
  stx END
  lda TAB_END+2
  sta END+2
  ldx TAB_LOOP
  stx LOOPP
  lda TAB_LOOP+2
  sta LOOPP+2
  stz CNT
sl:
  jsr GETB
  sta $2141
  jsr GETB
  sta $2142
  jsr GETB
  sta $2143
  inc CNT
  lda CNT
  sta $2140
sw:
  cmp $2140
  bne sw
  bra sl

; um byte do registro; no fim volta ao ponto de repetição
GETB:
  lda [PTR]
  pha
  rep #$20
  .a16
  inc PTR
  sep #$20
  .a8
  bne g1
  inc PTR+2
g1:
  ldx PTR
  cpx END
  bne g3
  lda PTR+2
  cmp END+2
  bne g3
  ldx LOOPP
  stx PTR
  lda LOOPP+2
  sta PTR+2
g3:
  pla
  rts

; manda LEN bytes de SRC para DEST na RAM do SPC (protocolo do IPL)
BLOCK:
  ldx LEN
  beq bx
  ldx DEST
  stx $2142
  lda #1
  sta $2141
  lda KICK
  sta $2140
bk:
  cmp $2140
  bne bk
  ldy #0
bb:
  lda [SRC],y
  sta $2141
  tya
  sta $2140
bw:
  cmp $2140
  bne bw
  iny
  cpy LEN
  bne bb
  tya
  clc
  adc #2
  bne bk2
  inc a
bk2:
  sta KICK
bx:
  rts

NOINT:
  rti
