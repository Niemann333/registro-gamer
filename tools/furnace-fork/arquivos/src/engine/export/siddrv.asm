; driver SID do Tracker do Registro Gamer (6502). Por SID, 11 fluxos de comandos: frequência, largura de pulso e
; controle/ADSR de cada voz, corte do filtro e ressonância/volume.
; A cada interrupção do timer A da CIA 1 o PLAY primeiro escreve no SID as escritas já prontas do tique (fila de
; 256), sempre no mesmo instante, e depois usa o tempo que sobra até a próxima interrupção (o timer B da CIA 1
; conta esse tempo) para adiantar os tiques seguintes na fila: os tiques pesados (início de padrão, muitas notas
; juntas) não atrasam o som, a fila absorve.
; Para gastar pouco tempo por tique, só se mexe no que muda: cada fluxo em espera fica numa lista do tique em que
; volta a ler comandos (256 listas, uma por tique), e os fluxos de valor que andam sozinhos (rampa, LAG>1) ficam
; numa lista de ativos, cada um com a rotina certa para o seu caso (MODE).
; Durante o PLAY fica $01=$35 (RAM em $A000-$BFFF e $E000-$FFFF, E/S em $D000): os fluxos ficam depois das
; tabelas até $CFFF e de $E000 até $FFF9.
; montar: python3 scripts/rg-asm6502.py siddrv.asm sidDriver "comentário" > siddrv.inc
;
; comandos de todos os fluxos:
;   E0 lo hi nl nh  toca nh:nl bytes que estão em hi:lo e volta (aninhado; a pilha de cada fluxo é do tamanho que ele usa)
;   E1 lo hi nn     o mesmo, com até 255 bytes
;   F0-FD           fim do tique; espera cmd-F0 tiques a mais
;   FE nn           fim do tique; espera nn tiques a mais (nn até 254)
;   FF              volta ao ponto de repetição (ou acaba)
; fluxo de registradores (controle/ADSR, ressonância/volume):
;   00-07 vv        escreve vv no registrador REG+cmd
; fluxo de valor (16 bits: frequência, pulso; 11 bits: corte): a cada tique, inclusive os de espera,
; VAL = (valor de LAG tiques atrás) + DELTA, e VAL vai para os registradores. os comandos mudam LAG e DELTA:
;   00-3F           LAG=1, DELTA=cmd-$20 (-32..31)
;   40-47 dd        LAG=cmd-$3F (1..8), DELTA=dd (-128..127)
;   48-4F lo hi     LAG=cmd-$47 (1..8), DELTA=hi:lo
;   80 lo hi        VAL=hi:lo, LAG=1, DELTA=0
; TYPE: 0 registradores, 1 valor de 16 bits, 2 corte do filtro (11 bits: 3 em REG, 8 em REG+1); +$80 guarda o histórico
; (os 8 últimos valores, para LAG>1; a posição GPOS é a mesma para todos e anda um a cada tique).
; MODE (fluxos de valor ativos): 1 rampa 16 bits, 2 rampa do corte, 3 com histórico 16 bits, 4 com histórico corte,
; 5 parado com histórico (guarda o valor até o histórico inteiro ser ele, depois sai da lista).

PTR = $E0
END = $E2
T0 = $E4
T1 = $E5
T2 = $E6
T3 = $E7
B01 = $E8
NS = 33

.org $0800
  jmp INIT
  jmp PLAY
NSTR: .byte 0
TIMERLO: .byte 0
TIMERHI: .byte 0
MARGIN: .byte 0
ROOM: .byte 0
INIT:
  lda TIMERLO
  sta $DC04
  lda TIMERHI
  sta $DC05
  lda $01
  sta B01
  lda #$35
  sta $01
  lda #0
  sta TIMED
  jsr DECODE
  lda B01
  sta $01
  rts

PLAY:
  lda $01
  sta B01
  lda #$35
  sta $01
  lda $DC04       ; o timer B da CIA 1 conta o tempo que falta até a próxima interrupção (o que o timer A
  sta $DC06       ; ainda tem) e para no zero: quando ele para, acabou o tempo deste PLAY
  lda $DC05
  sta $DC07
  lda #$19
  sta $DC0F
  lda READY
  bne pl1
  lda #2          ; a fila não tem o tique inteiro: adianta agora até o fim dele
  sta TIMED
  jsr DECODE
pl1:
  dec READY
  ldy RP
fl:
  lda BREG,y
  bmi fle
  tax
  lda BVAL,y
  sta $D400,x
  iny
  jmp fl
fle:
  iny
  sty RP
  lda #1
  sta TIMED
  sta CHK
  jsr DECODE
  lda B01
  sta $01
  rts

; adianta os próximos tiques, um fluxo por vez, enquanto houver lugar na fila e tempo até a próxima interrupção
; (TIMED 0: sem olhar o tempo; 1: olhando o timer; 2: só até o fim do tique). PH: 0 começo do tique,
; 1 fluxos que voltam a ler comandos (lista do tique, NXT = o próximo), 2 fluxos de valor ativos (CUR)
DECODE:
  lda PH
  beq dtk
  cmp #2
  beq p2
  jmp p1
dtk:
  lda TIMED
  cmp #2
  beq dtk2
  lda WP          ; começa um tique novo só com lugar na fila para ele inteiro
  sec
  sbc RP
  cmp ROOM
  bcs dcx
dtk2:
  ldy TICK
  lda BHEAD,y
  sta NXT
  lda #$FF
  sta BHEAD,y
  lda #1
  sta PH
p1:
  ldx NXT
  cpx #$FF
  beq p1e
  lda NEXT,x
  sta NXT
  jsr RUNS
  dec CHK
  bne p1
  jsr CHKT
  bcc p1
dcx:
  rts
p1e:
  lda NACT
  sta CUR
  lda #2
  sta PH
p2:
  ldy CUR
  dey
  bmi dtend
  sty CUR
  ldx ACT,y
  lda UPF,x
  bne p2u
  lda MODE,x
  cmp #3
  bne p2a
  jmp H16
p2a:
  cmp #5
  bne p2b
  jmp HOLD
p2b:
  cmp #1
  bne p2c
  jmp R16
p2c:
  cmp #2
  beq p2rc
  jsr CALC        ; corte com histórico
  jsr PUSH
  jmp p2n
p2rc:
  jsr RAMP
  jmp p2n
p2u:
  lda #0          ; já calculado por um comando neste tique
  sta UPF,x
p2n:
  dec CHK
  bne p2j
  jsr CHKT
  bcs p2x
p2j:
  jmp p2
p2x:
  rts
dtend:
  ldy WP          ; fim do tique na fila
  lda #$FF
  sta BREG,y
  inc WP
  inc READY
  inc TICK
  lda GPOS
  clc
  adc #1
  and #7
  sta GPOS
  lda #0
  sta PH
  lda TIMED
  cmp #2
  beq dtx
  jmp dtk
dtx:
  rts

; com histórico, 16 bits: VAL = histórico[LAG] + DELTA, guarda e põe na fila
H16:
  lda GPOS
  sec
  sbc LAG,x
  and #7
  ora HB,x
  tay
  lda HISL,y
  clc
  adc DL,x
  sta VALL,x
  sta T0
  lda HISH,y
  adc DH,x
  sta T1
  lda GPOS
  ora HB,x
  tay
  lda T0
  sta HISL,y
  lda T1
  sta HISH,y
  ldy WP
  lda REG,x
  sta BREG,y
  lda T0
  sta BVAL,y
  iny
  lda T1
  cmp VALH,x
  beq h16a        ; byte alto igual: não precisa escrever
  sta VALH,x
  sta BVAL,y
  lda REG1,x
  sta BREG,y
  iny
h16a:
  sty WP
  jmp p2n
; parado com histórico: só guarda (depois de 8 tiques o histórico inteiro já é este valor)
HOLD:
  lda GPOS
  ora HB,x
  tay
  lda VALL,x
  sta HISL,y
  lda VALH,x
  sta HISH,y
  inc HCNT,x
  lda HCNT,x
  cmp #8
  bcc hd1
  jsr DEACT
hd1:
  jmp p2n
; rampa, 16 bits
R16:
  ldy WP
  lda REG,x
  sta BREG,y
  lda VALL,x
  clc
  adc DL,x
  sta VALL,x
  sta BVAL,y
  iny
  lda VALH,x
  adc DH,x
  cmp VALH,x
  beq r16a
  sta VALH,x
  sta BVAL,y
  lda REG1,x
  sta BREG,y
  iny
r16a:
  sty WP
  jmp p2n

; o tempo acabou? (C=1: parar). quem chama confere o timer a cada 4 passos (CHK)
CHKT:
  lda #4
  sta CHK
  lda TIMED
  cmp #1
  bne ck0
  lda $DC0F       ; timer B parado: passou da hora
  lsr a
  bcc ck1
  lda $DC07       ; páginas de 256 ciclos até a próxima interrupção
  cmp MARGIN
  bcc ck1
ck0:
  clc
  rts
ck1:
  sec
  rts

; lê os comandos do fluxo X até a próxima espera
RUNS:
  lda PTRL,x
  sta PTR
  lda PTRH,x
  sta PTR+1
  lda ENDL,x
  sta END
  lda ENDH,x
  sta END+1
  jmp next

; lê um byte do fluxo X (preserva X); no fim de uma referência volta para quem chamou
GB:
  ldy #0
  lda (PTR),y
  inc PTR
  bne gb1
  inc PTR+1
gb1:
  ldy PTR
  cpy END
  beq gb2
  rts
gb2:
  ldy PTR+1
  cpy END+1
  beq gbp
  rts
gbp:
  pha
  ldy SP,x
  dey
  tya
  sta SP,x
  lda SKPL,y
  sta PTR
  lda SKPH,y
  sta PTR+1
  lda SKEL,y
  sta END
  lda SKEH,y
  sta END+1
  pla
  rts

next:
  ldy #0
  lda (PTR),y
  inc PTR
  bne nx1
  inc PTR+1
nx1:
  ldy PTR
  cpy END
  bne nx3
  jsr gb2
nx3:
  cmp #$E0
  bcc nc
  jmp ctl
nc:
  ldy TYPE,x
  bne val
  clc
  adc REG,x
  sta T0
  jsr GB
  ldy WP
  sta BVAL,y
  lda T0
  sta BREG,y
  inc WP
  jmp next

; comandos de valor: mudam LAG e DELTA e calculam o valor deste tique
val:
  cmp #$40
  bcs v40
  sbc #$1F        ; C=0: A-$20
  sta DL,x
  and #$80
  beq vp
  lda #$FF
vp:
  sta DH,x
  lda #1
  sta LAG,x
  jmp vgo
v40:
  cmp #$48
  bcs v48
  sbc #$3E        ; C=0: A-$3F
  sta LAG,x
  jsr GB
  sta DL,x
  and #$80
  beq vp2
  lda #$FF
vp2:
  sta DH,x
  jmp vgo
v48:
  cmp #$80
  beq vabs
  sbc #$46        ; C=0: A-$47
  sta LAG,x
  jsr GB
  sta DL,x
  jsr GB
  sta DH,x
vgo:
  lda TYPE,x
  bmi vh
  jsr RAMP
  jmp vset
vh:
  jsr CALC
  jsr PUSH
  jmp vset
vabs:
  jsr GB
  sta VALL,x
  jsr GB
  sta VALH,x
  eor #$FF
  sta T3          ; escreve os dois bytes
  lda #1
  sta LAG,x
  lda #0
  sta DL,x
  sta DH,x
  jsr WRV
  lda TYPE,x
  bpl vset
  jsr PUSH
vset:
  lda #1
  sta UPF,x
  jsr SETM
  jmp next

ctl:
  cmp #$F0
  bcs wt
  cmp #$E1
  beq ref1
  bcc ref0
  jmp next
ref0:
  jsr GB
  sta T0
  jsr GB
  sta T1
  jsr GB
  sta T2
  jsr GB
  sta T3
  jmp refgo
ref1:
  jsr GB
  sta T0
  jsr GB
  sta T1
  jsr GB
  sta T2
  lda #0
  sta T3
refgo:
  ldy SP,x
  lda PTR
  sta SKPL,y
  lda PTR+1
  sta SKPH,y
  lda END
  sta SKEL,y
  lda END+1
  sta SKEH,y
  iny
  tya
  sta SP,x
  lda T0
  sta PTR
  clc
  adc T2
  sta END
  lda T1
  sta PTR+1
  adc T3
  sta END+1
  jmp next

wt:
  cmp #$FE
  bcc wk
  beq wn
  ; FF: repetição ou fim
  lda LOOPL,x
  ora LOOPH,x
  beq fim
  lda LOOPL,x
  sta PTR
  lda LOOPH,x
  sta PTR+1
  jmp next
wk:
  sbc #$EF        ; C=0: A-$F0 (tiques a mais)
  jmp sav
wn:
  jsr GB
sav:
  ; volta daqui a A+1 tiques: entra na lista daquele tique
  sec
  adc TICK
  tay
  lda BHEAD,y
  sta NEXT,x
  txa
  sta BHEAD,y
  lda PTR
  sta PTRL,x
  lda PTR+1
  sta PTRH,x
  lda END
  sta ENDL,x
  lda END+1
  sta ENDH,x
  rts
fim:
  lda ENDF        ; o volume é zerado uma vez só, pelo primeiro fluxo que acaba
  bne fm0
  inc ENDF
  ldy WP
  lda #$18
  sta BREG,y
  lda #0
  sta BVAL,y
  iny
  lda #$38
  sta BREG,y
  lda #0
  sta BVAL,y
  iny
  lda #$58
  sta BREG,y
  lda #0
  sta BVAL,y
  iny
  sty WP
fm0:
  lda #0
  sta DL,x
  sta DH,x
  lda #1
  sta LAG,x
  jsr DEACT
  lda PTR
  bne fm1
  dec PTR+1
fm1:
  dec PTR
  lda #254
  jmp sav

; escolhe o MODE do fluxo de valor e o põe na lista de ativos (ou tira, se não tem nada a fazer sozinho)
SETM:
  lda TYPE,x
  bmi smh
  lda DL,x        ; sem histórico: só a rampa (LAG é sempre 1)
  ora DH,x
  beq DEACT
  lda TYPE,x
  jmp smset       ; 1 rampa 16 bits, 2 rampa do corte
smh:
  lda LAG,x
  cmp #1
  bne smh2
  lda DL,x
  ora DH,x
  bne smh2
  lda #0          ; parado
  sta HCNT,x
  lda #5
  bne smset
smh2:
  lda TYPE,x
  and #$7F
  clc
  adc #2          ; 3 histórico 16 bits, 4 histórico corte
smset:
  sta MODE,x
ACTV:
  lda APOS,x
  bpl ac9
  ldy NACT
  txa
  sta ACT,y
  tya
  sta APOS,x
  inc NACT
ac9:
  rts
DEACT:
  ldy APOS,x
  bmi da9
  dec NACT
  stx T0
  ldx NACT
  lda ACT,x       ; o último da lista vai para o lugar deste
  sta ACT,y
  tax
  tya
  sta APOS,x
  ldx T0
  lda #$FF
  sta APOS,x
da9:
  rts
; VAL = VAL + DELTA e põe na fila (T3 = byte alto anterior)
RAMP:
  lda VALH,x
  sta T3
  lda VALL,x
  clc
  adc DL,x
  sta VALL,x
  lda VALH,x
  adc DH,x
  sta VALH,x
  jmp WRV
; VAL = valor de LAG tiques atrás + DELTA e põe na fila
CALC:
  lda LAG,x
  cmp #1
  beq RAMP        ; LAG=1: o valor de 1 tique atrás é o próprio VAL
  lda VALH,x
  sta T3
  lda GPOS
  sec
  sbc LAG,x
  and #7
  ora HB,x
  tay
  lda HISL,y
  clc
  adc DL,x
  sta VALL,x
  lda HISH,y
  adc DH,x
  sta VALH,x
WRV:
  ldy WP
  lda TYPE,x
  and #$7F
  cmp #2
  beq wcut
  lda REG,x
  sta BREG,y
  lda VALL,x
  sta BVAL,y
  iny
  lda VALH,x
  cmp T3
  beq wv1         ; byte alto igual: não precisa escrever
  sta BVAL,y
  lda REG1,x
  sta BREG,y
  iny
wv1:
  sty WP
  rts
wcut:
  lda REG,x
  sta BREG,y
  lda VALL,x
  and #7
  sta BVAL,y
  iny
  lda VALH,x
  sta T0
  lda VALL,x
  lsr T0
  ror a
  lsr T0
  ror a
  lsr T0
  ror a
  sta BVAL,y
  lda REG1,x
  sta BREG,y
  iny
  sty WP
  rts
; guarda o valor deste tique no histórico
PUSH:
  lda #0
  sta HCNT,x
  lda GPOS
  ora HB,x
  tay
  lda VALL,x
  sta HISL,y
  lda VALH,x
  sta HISH,y
  rts

GPOS: .byte 0
TICK: .byte 0
NACT: .byte 0
WP: .byte 0
RP: .byte 0
READY: .byte 0
TIMED: .byte 0
PH: .byte 0
NXT: .byte 0
CUR: .byte 0
CHK: .byte 1
ENDF: .byte 0

; tabelas (NS bytes cada; o exportador preenche): estado de cada fluxo
TABLES:
PTRL = TABLES
PTRH = TABLES+NS
NEXT = TABLES+NS*2
LOOPL = TABLES+NS*3
LOOPH = TABLES+NS*4
TYPE = TABLES+NS*5
REG = TABLES+NS*6
SP = TABLES+NS*7
ENDL = TABLES+NS*8
ENDH = TABLES+NS*9
VALL = TABLES+NS*10
VALH = TABLES+NS*11
DL = TABLES+NS*12
DH = TABLES+NS*13
LAG = TABLES+NS*14
HB = TABLES+NS*15
HCNT = TABLES+NS*16
APOS = TABLES+NS*17
UPF = TABLES+NS*18
ACT = TABLES+NS*19
MODE = TABLES+NS*20
REG1 = TABLES+NS*21
; pilhas das referências (256 entradas no total: retorno e fim), histórico (8 valores por fluxo),
; as 256 listas de fluxos que voltam em cada tique ($FF = vazia) e a fila de escritas (registrador, valor;
; $FF = fim do tique)
SKPL = TABLES+NS*22
SKPH = SKPL+256
SKEL = SKPL+512
SKEH = SKPL+768
HISL = SKPL+1024
HISH = SKPL+1280
BHEAD = SKPL+1536
BREG = SKPL+1792
BVAL = SKPL+2048
TABEND = SKPL+2304
