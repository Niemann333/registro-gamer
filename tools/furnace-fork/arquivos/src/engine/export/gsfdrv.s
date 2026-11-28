@ driver GSF do Tracker do Registro Gamer (Game Boy Advance, ARM7TDMI)
@ toca a música já mixada (8 bits com sinal, como o mixer de software dos jogos de GBA) pelos
@ canais de som direto A (esquerda) e B (direita): timer 0 dá a taxa e os DMA 1 e 2 enchem as FIFOs.
@ o timer 1 (em cascata) conta as amostras tocadas; no fim, os DMA voltam para o ponto de loop.
  .syntax unified
  .arm
  .text
  .globl _start
_start:
  b start
  .space 0xbc                 @ cabeçalho do cartucho (0x04-0xBF)
tbl:
  .word 0                     @ +C0 som da esquerda (FIFO A)
  .word 0                     @ +C4 som da direita (FIFO B; igual ao da esquerda se for mono)
  .word 0                     @ +C8 fim (em amostras)
  .word 0xffffffff            @ +CC ponto de loop (em amostras; FFFFFFFF = a música acaba)
  .word 0                     @ +D0 recarga do timer 0 (65536 - ciclos por amostra)
start:
  mov r12, #0x04000000
  add r9, r12, #0x100          @ timers
  adr r11, tbl
  @ som ligado, PSG mudo, som direto A só na esquerda e B só na direita, 100%, FIFOs zeradas
  mov r0, #0x80
  strh r0, [r12, #0x84]
  mov r0, #0
  strh r0, [r12, #0x80]
  ldr r0, =0x9a0c
  strh r0, [r12, #0x82]
  @ timers parados
  mov r0, #0
  strh r0, [r9, #2]
  strh r0, [r9, #6]
  @ DMA 1 → FIFO A, DMA 2 → FIFO B
  ldr r0, [r11, #0]
  str r0, [r12, #0xbc]
  ldr r0, =0x040000a0
  str r0, [r12, #0xc0]
  ldr r0, [r11, #4]
  str r0, [r12, #0xc8]
  ldr r0, =0x040000a4
  str r0, [r12, #0xcc]
  ldr r1, =0xb640             @ ligado, repete, 32 bits, início pela FIFO, destino fixo
  mov r0, #4
  strh r0, [r12, #0xc4]
  strh r0, [r12, #0xd0]
  strh r1, [r12, #0xc6]
  strh r1, [r12, #0xd2]
  @ timer 1 conta as estouradas do timer 0 (= amostras tocadas)
  mov r0, #0
  strh r0, [r9, #4]
  mov r0, #0x84
  strh r0, [r9, #6]
  ldr r0, [r11, #0x10]
  strh r0, [r9, #0]
  mov r0, #0x80
  strh r0, [r9, #2]
  mov r4, #0                  @ amostras tocadas
  mov r5, #0                  @ última leitura do timer 1
  ldr r6, [r11, #8]           @ fim
  ldr r10, =0xffff
poll:
  ldrh r0, [r9, #4]
  sub r1, r0, r5
  and r1, r1, r10
  mov r5, r0
  add r4, r4, r1
  cmp r4, r6
  blo poll
  @ chegou ao fim
  ldr r7, [r11, #0xc]
  cmn r7, #1
  beq parar
  sub r2, r4, r6              @ d = amostras além do fim
  @ para os DMA e esvazia as FIFOs: o que o DMA já tinha lido adiante é jogado fora, e a leitura
  @ recomeça em loop + d (com erro de no máximo 2 amostras: o DMA lê de 4 em 4 bytes)
  mov r0, #0
  strh r0, [r12, #0xc6]
  strh r0, [r12, #0xd2]
  ldr r0, =0x9a0c
  strh r0, [r12, #0x82]
  add r8, r7, r2              @ (o esvaziar da FIFO adianta 2 amostras: loop + d - 2, arredondado)
  bic r8, r8, #3
  ldr r0, [r11, #0]
  add r0, r0, r8
  str r0, [r12, #0xbc]
  ldr r0, [r11, #4]
  add r0, r0, r8
  str r0, [r12, #0xc8]
  ldr r1, =0xb640
  strh r1, [r12, #0xc6]
  strh r1, [r12, #0xd2]
  add r4, r7, r2              @ continua contando a partir do loop
  b poll
parar:
  mov r0, #0
  strh r0, [r12, #0xc6]
  strh r0, [r12, #0xd2]
  strh r0, [r9, #2]
  strh r0, [r12, #0x84]
fim:
  b fim
  .ltorg
