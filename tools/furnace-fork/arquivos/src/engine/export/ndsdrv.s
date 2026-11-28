@ driver 2SF do Tracker do Registro Gamer (Nintendo DS, ARM7)
@ as samples já estão na RAM principal (vão junto com o binário do ARM9); a cada tique, medido pelo
@ timer 0 (33,5 MHz / 64), repete as escritas nos registradores de som gravadas (formato em 2sf.cpp)
  .syntax unified
  .arm
  .text
  .globl _start
_start:
  b start
tbl:
  .word 0                     @ +4  início do registro (log)
  .word 0                     @ +8  ponto de repetição (0 = a música acaba)
  .word 0                     @ +12 duração do tique em contagens do timer × 256
  .word 0                     @ +16 endereço das samples (a posição 0 da memória de samples do Furnace)
  .word 0                     @ +20 pilha das referências
start:
  ldr sp, =0x0380fd00
  adr r9, _start
  ldr r10, =0x04000400        @ registradores de som
  ldr r11, =0x04000100        @ timer 0
  @ alto-falantes ligados
  ldr r0, =0x04000304
  mov r1, #1
  strh r1, [r0]
  @ timer 0 livre, 33,5 MHz / 64
  mov r0, #0
  strh r0, [r11, #2]
  strh r0, [r11]
  mov r0, #0x81
  strh r0, [r11, #2]
  ldr r4, [r9, #4]            @ posição no registro
  mov r5, #0                  @ profundidade das referências
  ldr r6, [r9, #20]           @ pilha das referências
  mov r7, #0                  @ bytes que faltam na referência atual
  mov r8, #0                  @ tiques de espera
  mov r3, #0                  @ acumulador do tempo
  ldrh r12, [r11]             @ última leitura do timer
main:
  ldrh r0, [r11]
  sub r1, r0, r12
  mov r1, r1, lsl #16
  mov r12, r0
  add r3, r3, r1, lsr #8      @ (delta & FFFF) × 256
  ldr r1, [r9, #12]
  cmp r3, r1
  blo main
  sub r3, r3, r1
  cmp r8, #0
  subne r8, r8, #1
  bne main
cmd:
  bl gb
  cmp r0, #0xd0
  blo wreg
  beq wany
  cmp r0, #0xd1
  beq wctl
  cmp r0, #0xd2
  beq wsad
  cmp r0, #0xd3
  beq wh
  cmp r0, #0xd4
  beq ww
  cmp r0, #0xe0
  beq ref
  cmp r0, #0xf0
  blo cmd
  cmp r0, #0xfe
  sublo r8, r0, #0xf0
  blo main
  beq wlong
  @ FF: volta ao ponto de repetição ou acaba
  ldr r0, [r9, #8]
  cmp r0, #0
  movne r4, r0
  bne cmd
  mov r0, #0
  str r0, [r10, #0x100]
fim:
  b fim
wlong:
  bl gb
  mov r8, r0
  b main
wreg:                         @ 00-CF vv: registrador 0x00-0xCF
  mov r2, r0
  bl gb
  strb r0, [r10, r2]
  b cmd
wany:                         @ D0 rr vv: registrador 0x00-0xFF
  bl gb
  mov r2, r0
  bl gb
  strb r0, [r10, r2]
  b cmd
wctl:                         @ D1 rr vv: registrador 0x100-0x1FF
  bl gb
  add r2, r0, #0x100
  bl gb
  strb r0, [r10, r2]
  b cmd
wsad:                         @ D2 cc o0 o1 o2: endereço da sample do canal cc (relativo às samples)
  bl gb
  mov r2, r0, lsl #4
  add r2, r2, #4
  bl gb
  mov r1, r0
  bl gb
  orr r1, r1, r0, lsl #8
  bl gb
  orr r1, r1, r0, lsl #16
  ldr r0, [r9, #16]
  add r1, r1, r0
  str r1, [r10, r2]
  b cmd
wh:                           @ D3 rr lo hi: registrador de 16 bits (frequência, início do loop)
  bl gb
  mov r2, r0
  bl gb
  mov r1, r0
  bl gb
  orr r1, r1, r0, lsl #8
  strh r1, [r10, r2]
  b cmd
ww:                           @ D4 rr b0 b1 b2: registrador de 32 bits (tamanho)
  bl gb
  mov r2, r0
  bl gb
  mov r1, r0
  bl gb
  orr r1, r1, r0, lsl #8
  bl gb
  orr r1, r1, r0, lsl #16
  str r1, [r10, r2]
  b cmd
ref:                          @ E0 a0 a1 a2 nl nh: toca nh:nl bytes do registro a partir de a2:a1:a0
  bl gb
  mov r1, r0
  bl gb
  orr r1, r1, r0, lsl #8
  bl gb
  orr r1, r1, r0, lsl #16
  bl gb
  mov r2, r0
  bl gb
  orr r2, r2, r0, lsl #8
  add r0, r6, r5, lsl #3
  str r4, [r0]
  str r7, [r0, #4]
  add r5, r5, #1
  ldr r0, [r9, #4]
  add r4, r0, r1
  mov r7, r2
  b cmd
gb:                           @ próximo byte do registro (volta da referência quando ela acaba)
  ldrb r0, [r4], #1
  cmp r5, #0
  bxeq lr
  subs r7, r7, #1
  bxne lr
  sub r5, r5, #1
  add r4, r6, r5, lsl #3      @ (sem registrador temporário: quem chama guarda valores em r1 e r2)
  ldr r7, [r4, #4]
  ldr r4, [r4]
  bx lr
  .ltorg
