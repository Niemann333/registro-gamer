; driver SPC700 do SNSF do Tracker do Registro Gamer (o lado do chip de som do SNES).
; o programa do SNES (snsfdrv.s) manda o registro da música, que fica na ROM, pelas portas do APU, 3 bytes por vez:
; dados em $F5-$F7 e um contador em $F4 (o SPC devolve o contador em $F4 quando guardou os 3 bytes). os bytes vão
; para uma fila em $FC00-$FFFF e os tiques saem dessa fila no ritmo do timer 0 (2 kHz, com acumulador de 24 bits:
; a cada 1/2000 s soma RATE e, quando passa de 2^24, toca um tique). assim a música pode ser do tamanho da ROM.
; montar: python3 scripts/rg-asmspc.py snsfspc.asm snsfSpcDriver "comentário" > snsfspc.inc
;
; comandos (os mesmos do SPC, num fluxo só):
;   00-7F vv        escreve vv no registrador do DSP
;   82 lo hi nn ... escreve nn bytes na RAM em hi:lo (diretório de samples, ondas)
;   83 dl dh sl sh nn  copia nn bytes de sh:sl para dh:dl (ondas guardadas uma vez na RAM)
;   84 mm / 85 mm   liga (KON) / desliga (KOFF) as vozes de mm no fim do tique (KOFF é um pulso, antes do KON)
;   F0-FD           fim do tique; espera cmd-F0 tiques a mais
;   FE nn           fim do tique; espera nn tiques a mais
;   FF              fim da música (silêncio)

RD = $10
RDH = $11
WR = $12
WRH = $13
ACC = $14
ACC1 = $15
ACC2 = $16
WAITC = $17
LASTC = $18
KONM = $19
KOFFM = $1A
CNT = $1B
DST = $1C
DSTH = $1D
SRC = $1E
SRCH = $1F
NB = $20
STOP = $21
T0 = $22

.org $0200
INIT:
  mov x,#$EF
  mov sp,x
  mov $F1,#$30
  mov a,#0
  mov RD,a
  mov WR,a
  mov a,#$FC
  mov RDH,a
  mov WRH,a
  mov a,#0
  mov ACC,a
  mov ACC1,a
  mov ACC2,a
  mov WAITC,a
  mov LASTC,a
  mov STOP,a
  ; DSP: primeiro o eco para de escrever (o eco que estava ligado poderia apagar este programa), depois tudo
  ; zerado, mudo, diretório em $0400
  mov $F2,#$6C
  mov $F3,#$E0
  mov $F2,#$7D
  mov $F3,#$00
  mov y,#0
dz:
  mov $F2,y
  mov a,y
  cmp a,#$6C
  beq dz2
  mov $F3,#0
dz2:
  inc y
  cmp y,#$80
  bne dz
  mov $F2,#$6C
  mov $F3,#$E0
  mov $F2,#$6D
  mov $F3,#$F8
  mov $F2,#$5D
  mov $F3,#$04
  mov $F2,#$5C
  mov $F3,#$FF
  mov $F2,#$5C
  mov $F3,#$00
  mov $FA,#4
  mov $F1,#$01
  mov $F4,#0
  ; o tamanho novo do eco (0) só vale quando o buffer antigo dá a volta (até 240 ms): espera 256 ms
  ; recebendo o começo do registro
  mov ACC,#0
  mov ACC1,#0
ew:
  call !SVC
  mov a,$FD
  clrc
  adc a,ACC
  mov ACC,a
  bcc ew
  inc ACC1
  mov a,ACC1
  cmp a,#2
  bne ew
  mov ACC,#0
  mov ACC1,#0
main:
  call !SVC
  mov a,$FD
  beq main
  mov CNT,a
ml:
  clrc
  mov a,ACC
  adc a,!RATE
  mov ACC,a
  mov a,ACC1
  adc a,!RATE1
  mov ACC1,a
  mov a,ACC2
  adc a,!RATE2
  mov ACC2,a
  bcc ml2
  call !TICK
ml2:
  dbnz CNT,ml
  bra main

; porta: o SNES deixou 3 bytes novos? guarda na fila (se couber) e avisa
SVC:
  mov a,$F4
  cmp a,LASTC
  beq sx
  mov a,WR
  setc
  sbc a,RD
  mov T0,a
  mov a,WRH
  sbc a,RDH
  and a,#3
  cmp a,#3
  bne sv1
  mov a,T0
  cmp a,#$FC
  bcs sx          ; fila cheia
sv1:
  mov y,#0
  mov a,$F5
  mov [WR]+y,a
  call !WINC
  mov a,$F6
  mov [WR]+y,a
  call !WINC
  mov a,$F7
  mov [WR]+y,a
  call !WINC
  mov a,$F4
  mov LASTC,a
  mov $F4,a
sx:
  ret
WINC:
  incw WR
  mov a,WRH
  bne wi1
  mov WRH,#$FC
wi1:
  ret

; um byte da fila (se estiver vazia, atende a porta até chegar)
GB:
  movw ya,RD
  cmpw ya,WR
  bne gb1
  call !SVC
  bra GB
gb1:
  mov y,#0
  mov a,[RD]+y
  push a
  incw RD
  mov a,RDH
  bne gb2
  mov RDH,#$FC
gb2:
  pop a
  ret

TICK:
  mov a,STOP
  bne tkx
  mov a,WAITC
  beq tk0
  dec WAITC
tkx:
  ret
tk0:
  mov KONM,#0
  mov KOFFM,#0
tk:
  call !GB
  cmp a,#$80
  bcs tk1
  mov $F2,a
  call !GB
  mov $F3,a
  bra tk
tk1:
  cmp a,#$F0
  bcs twt
  cmp a,#$84
  beq tkon
  cmp a,#$85
  beq tkof
  cmp a,#$82
  beq tram
  cmp a,#$83
  beq tcpy
  bra tk
tkon:
  call !GB
  or a,KONM
  mov KONM,a
  bra tk
tkof:
  call !GB
  or a,KOFFM
  mov KOFFM,a
  bra tk
tram:
  call !GB
  mov DST,a
  call !GB
  mov DSTH,a
  call !GB
  mov NB,a
tr1:
  call !GB
  mov y,#0
  mov [DST]+y,a
  incw DST
  dbnz NB,tr1
  bra tk
tcpy:
  call !GB
  mov DST,a
  call !GB
  mov DSTH,a
  call !GB
  mov SRC,a
  call !GB
  mov SRCH,a
  call !GB
  mov NB,a
  mov y,#0
tc1:
  mov a,[SRC]+y
  mov [DST]+y,a
  inc y
  dbnz NB,tc1
  bra tk
twt:
  cmp a,#$FE
  bcc twk
  beq twn
  ; FF: fim da música
  mov STOP,#1
  mov $F2,#$6C
  mov $F3,#$E0
  ret
twk:
  setc
  sbc a,#$F0
  mov WAITC,a
  bra tke
twn:
  call !GB
  mov WAITC,a
tke:
  ; KOFF em pulso (o DSP só vê a cada 2 amostras), depois KON
  mov $F2,#$5C
  mov a,KOFFM
  mov $F3,a
  mov x,#20
kd:
  dec x
  bne kd
  mov $F3,#$00
  mov $F2,#$4C
  mov a,KONM
  mov $F3,a
  ret

RATE:
  .byte 0
RATE1:
  .byte 0
RATE2:
  .byte 0
