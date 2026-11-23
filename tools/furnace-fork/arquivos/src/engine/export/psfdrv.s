# driver PSF do Tracker do Registro Gamer (PlayStation, MIPS R3000)
# copia os samples para a RAM da SPU e, a cada tique do contador 2 (sysclk/8),
# repete as escritas de registrador gravadas (formato em psf.cpp)
  .set noreorder
  .set noat
  .text
  .globl _start
_start:
  j start
  nop
tbl:
  .word 0          # +8  início do log
  .word 0          # +12 ponto de repetição (0 = a música acaba)
  .word 0          # +16 samples (imagem da RAM da SPU a partir de 1000h)
  .word 0          # +20 tamanho dos samples em bytes
  .word 0          # +24 alvo do contador 2 (sysclk/8) | quantas vezes ele chega ao alvo por tique << 16
  .word 0          # +28 pilha das referências
start:
  lui $s4, 0x1F80
  ori $s4, $s4, 0x1C00
  la $a2, _start
  lw $a0, 16($a2)
  lw $a1, 20($a2)
  # transferência manual para a RAM da SPU (endereço 1000h)
  li $t0, 0x8000
  sh $t0, 0x1AA($s4)
  li $t0, 4
  sh $t0, 0x1AC($s4)
  li $t0, 0x200
  sh $t0, 0x1A6($s4)
up:
  blez $a1, updone
  nop
  li $t1, 32
chunk:
  lhu $t0, 0($a0)
  addiu $a0, $a0, 2
  addiu $a1, $a1, -2
  sh $t0, 0x1A8($s4)
  addiu $t1, $t1, -1
  blez $a1, flush
  nop
  bgtz $t1, chunk
  nop
flush:
  li $t0, 0x8010
  sh $t0, 0x1AA($s4)
busy:
  lhu $t0, 0x1AE($s4)
  nop
  andi $t0, $t0, 0x400
  bnez $t0, busy
  nop
  li $t0, 0x8000
  sh $t0, 0x1AA($s4)
  b up
  nop
updone:
  li $t0, 0xC000
  sh $t0, 0x1AA($s4)
  # contador 2 a sysclk/8, voltando a zero no alvo; a cada alvo atingido o bit 11 do modo acende
  lui $a3, 0x1F80
  ori $a3, $a3, 0x1120
  lw $t1, 24($a2)
  nop
  andi $t0, $t1, 0xFFFF
  sh $t0, 8($a3)
  li $t0, 0x248
  sh $t0, 4($a3)
  srl $fp, $t1, 16
  lw $s0, 8($a2)
  lw $s2, 28($a2)
  move $s1, $zero
  move $s3, $zero
  move $s5, $zero
  move $s7, $zero
main:
  lhu $t0, 4($a3)
  nop
  andi $t0, $t0, 0x800
  beqz $t0, main
  nop
  addiu $s7, $s7, 1
  sltu $t2, $s7, $fp
  bnez $t2, main
  nop
  move $s7, $zero
  beqz $s5, cmd
  nop
  b main
  addiu $s5, $s5, -1
cmd:
  jal gb
  nop
  move $t3, $v0
  sltiu $t2, $t3, 0xE0
  bnez $t2, regval
  nop
  li $t2, 0xE0
  beq $t3, $t2, ref
  nop
  li $t2, 0xE1
  bne $t3, $t2, notE1
  nop
  jal gb
  nop
  b regval
  move $t3, $v0
notE1:
  sltiu $t2, $t3, 0xF0
  bnez $t2, cmd
  nop
  sltiu $t2, $t3, 0xFE
  beqz $t2, notwait
  nop
  b main
  addiu $s5, $t3, -0xF0
notwait:
  li $t2, 0xFE
  bne $t3, $t2, loopop
  nop
  jal gb
  nop
  b main
  move $s5, $v0
loopop:
  lw $t6, 12($a2)
  nop
  beqz $t6, endsong
  nop
  b cmd
  move $s0, $t6
endsong:
  li $t0, 0xFFFF
  sh $t0, 0x18C($s4)
  li $t0, 0xFF
  sh $t0, 0x18E($s4)
  addiu $s0, $s0, -1
  b main
  li $s5, 255
regval:
  jal gb
  nop
  move $t4, $v0
  jal gb
  nop
  sll $v0, $v0, 8
  or $t4, $t4, $v0
  sll $t3, $t3, 1
  addu $t3, $t3, $s4
  b cmd
  sh $t4, 0($t3)
ref:
  jal gb
  nop
  move $t4, $v0
  jal gb
  nop
  sll $v0, $v0, 8
  or $t4, $t4, $v0
  jal gb
  nop
  sll $v0, $v0, 16
  or $t4, $t4, $v0
  jal gb
  nop
  move $t5, $v0
  jal gb
  nop
  sll $v0, $v0, 8
  or $t5, $t5, $v0
  sll $t0, $s1, 3
  addu $t0, $t0, $s2
  sw $s0, 0($t0)
  sw $s3, 4($t0)
  addiu $s1, $s1, 1
  lw $t6, 8($a2)
  nop
  addu $s0, $t6, $t4
  b cmd
  move $s3, $t5
gb:
  lbu $v0, 0($s0)
  addiu $s0, $s0, 1
  beqz $s1, gbret
  nop
  addiu $s3, $s3, -1
  bnez $s3, gbret
  nop
  addiu $s1, $s1, -1
  sll $t0, $s1, 3
  addu $t0, $t0, $s2
  lw $s0, 0($t0)
  lw $s3, 4($t0)
  nop
gbret:
  jr $ra
  nop
