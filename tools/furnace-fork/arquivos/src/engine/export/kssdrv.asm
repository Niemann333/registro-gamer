; driver KSS do Tracker do Registro Gamer (Z80, MSX). Fica em $4000 (dados sem banco); o registro da música fica em
; bancos de 8 KB a partir do banco $40, lidos pela janela $A000-$BFFF (escolhida escrevendo em $B000).
; o player chama PLAY 60 vezes por segundo (50 no modo PAL); o quadro é dividido em passos com espera contada em
; ciclos, e um acumulador de 24 bits decide em que passos tocam os tiques (assim qualquer taxa de tique funciona).
; montar: z80asm -i kssdrv.asm -o kssdrv.bin -L 2>labels (scripts/rg-z80inc.py faz tudo e gera o .inc)
;
; registro:
;   00-0F vv          PSG (AY-3-8910): registrador cmd = vv (portas $A0/$A1)
;   40 rr vv          FM-PAC (OPLL): registrador rr = vv (portas $7C/$7D)
;   41 rr vv          MSX-AUDIO (Y8950): registrador rr = vv (portas $C0/$C1)
;   42 nn ...         MSX-AUDIO: nn bytes para a memória de ADPCM (registrador $0F)
;   80 aa vv          SCC: $9800+aa = vv
;   E0 a0 a1 a2 n0 n1 toca n bytes que estão no deslocamento a do registro e volta (aninhado até 8)
;   F0-FD             fim do tique; espera cmd-F0 tiques a mais
;   FE nn             fim do tique; espera nn tiques a mais
;   FF                volta ao ponto de repetição (ou acaba)

        org $4000

INIT:   jp init_
PLAY:   jp play_

; parâmetros (o exportador preenche)
FIRSTB: defb $40
RATE:   defb 0, 0, 0, 0
STEPS:  defb 16
DLY:    defw 100
SC:     defb 0
LOOPB:  defb 0
LOOPP:  defw 0
USESCC: defb 0

; estado
BANK:   defb 0
PTR:    defw 0
CNT:    defw 0
DEPTH:  defb 0
WAIT:   defb 0
STOP:   defb 0
ACC:    defb 0, 0, 0, 0
ACCI:   defb 0, 0, 0
T1:     defb 0
TA:     defb 0, 0, 0, 0, 0
STK:    defs 40

init_:  ld a,(USESCC)
        or a
        jr z,in1
        ld a,$3f                ; liga o SCC
        ld ($9000),a
in1:    ld a,(FIRSTB)
        ld (BANK),a
        ld ($b000),a
        ld hl,$a000
        ld (PTR),hl
        xor a
        ld (DEPTH),a
        ld (WAIT),a
        ld (STOP),a
        ld hl,(ACCI)            ; o primeiro tique cai no primeiro passo
        ld (ACC),hl
        ld a,(ACCI+2)
        ld (ACC+2),a
        ret

play_:  ld a,(BANK)             ; a janela pode ter sido mexida
        ld ($b000),a
        ld a,(STEPS)            ; o quadro é dividido em STEPS passos iguais (DLY voltas de espera cada):
        ld (SC),a               ; a cada passo o acumulador soma RATE e, se passar de 2^24, toca um tique,
ps:     ld hl,(ACC)             ; assim os tiques caem perto da hora certa mesmo fora do ritmo do quadro
        ld de,(RATE)
        add hl,de
        ld (ACC),hl
        ld a,(ACC+2)
        ld hl,RATE+2
        adc a,(hl)
        ld (ACC+2),a
        jr nc,pn
        call TICK
pn:     ld a,(SC)
        dec a
        ld (SC),a
        ret z
        ld hl,(DLY)
pd:     dec hl
        ld a,h
        or l
        jr nz,pd
        jr ps

TICK:   ld a,(STOP)
        or a
        ret nz
        ld a,(WAIT)
        or a
        jr z,rd
        dec a
        ld (WAIT),a
        ret
rd:     call GB
        cp $f0
        jr nc,ctl
        cp $e0
        jp z,ref
        cp $80
        jr z,scc
        cp $40
        jr z,opll
        cp $41
        jr z,audio
        cp $42
        jr z,adpcm
        ld (T1),a               ; PSG
        call GB
        ld b,a
        ld a,(T1)
        out ($a0),a
        ld a,b
        out ($a1),a
        jr rd
opll:   call GB
        ld (T1),a
        call GB
        ld b,a
        ld a,(T1)
        out ($7c),a
        ld a,b
        out ($7d),a
        jr rd
audio:  call GB
        ld (T1),a
        call GB
        ld b,a
        ld a,(T1)
        out ($c0),a
        ld a,b
        out ($c1),a
        jp rd
adpcm:  call GB
        ld (T1),a
        ld a,$0f
        out ($c0),a
ad1:    call GB
        out ($c1),a
        ld a,(T1)
        dec a
        ld (T1),a
        jr nz,ad1
        jp rd
scc:    call GB
        ld (T1),a
        call GB
        ld b,a
        ld a,(T1)
        ld l,a
        ld h,$98
        ld (hl),b
        jp rd
ctl:    cp $fe
        jr c,wk
        jr z,wn
        ld a,(LOOPB)            ; FF: repetição ou fim
        or a
        jr z,fim
        ld (BANK),a
        ld ($b000),a
        ld hl,(LOOPP)
        ld (PTR),hl
        jp rd
wk:     sub $f0
        ld (WAIT),a
        ret
wn:     call GB
        ld (WAIT),a
        ret
fim:    ld a,1
        ld (STOP),a
        ld a,8                  ; silêncio: volumes do PSG, SCC desligado, teclas do FM soltas
        out ($a0),a
        xor a
        out ($a1),a
        ld a,9
        out ($a0),a
        xor a
        out ($a1),a
        ld a,10
        out ($a0),a
        xor a
        out ($a1),a
        ld ($988f),a
        ld b,9
        ld c,$20
fm1:    ld a,c
        out ($7c),a
        xor a
        out ($7d),a
        inc c
        djnz fm1
        ret

; trecho repetido: guarda onde estava e vai para o deslocamento a (banco FIRSTB + a/8192, $A000 + a%8192)
ref:    ld b,5
        ld de,TA
rf1:    push bc
        push de
        call GB
        pop de
        pop bc
        ld (de),a
        inc de
        djnz rf1
        ld a,(DEPTH)            ; empilha banco, ponteiro e contador
        call SLOT
        ld a,(BANK)
        ld (hl),a
        inc hl
        ld de,(PTR)
        ld (hl),e
        inc hl
        ld (hl),d
        inc hl
        ld de,(CNT)
        ld (hl),e
        inc hl
        ld (hl),d
        ld a,(DEPTH)
        inc a
        ld (DEPTH),a
        ld hl,(TA+3)
        ld (CNT),hl
        ld a,(TA+2)             ; banco = FIRSTB + a2*8 + a1/32
        add a,a
        add a,a
        add a,a
        ld b,a
        ld a,(TA+1)
        rlca
        rlca
        rlca
        and 7
        add a,b
        ld b,a
        ld a,(FIRSTB)
        add a,b
        ld (BANK),a
        ld ($b000),a
        ld a,(TA+1)
        and $1f
        or $a0
        ld h,a
        ld a,(TA)
        ld l,a
        ld (PTR),hl
        jp rd

; HL = STK + A*5
SLOT:   ld l,a
        ld h,0
        ld e,l
        ld d,h
        add hl,hl
        add hl,hl
        add hl,de
        ld de,STK
        add hl,de
        ret

; um byte do registro em A (passa para o próximo banco no fim da janela; no fim de um trecho repetido, volta)
GB:     ld hl,(PTR)
        ld a,(hl)
        inc hl
        ld c,a
        ld a,h
        cp $c0
        jr nz,gb1
        ld h,$a0
        ld a,(BANK)
        inc a
        ld (BANK),a
        ld ($b000),a
gb1:    ld (PTR),hl
        ld a,(DEPTH)
        or a
        jr z,gb9
        ld hl,(CNT)
        dec hl
        ld (CNT),hl
        ld a,h
        or l
        jr nz,gb9
        ld a,(DEPTH)            ; acabou o trecho: volta
        dec a
        ld (DEPTH),a
        call SLOT
        ld a,(hl)
        ld (BANK),a
        ld ($b000),a
        inc hl
        ld e,(hl)
        inc hl
        ld d,(hl)
        inc hl
        ld (PTR),de
        ld e,(hl)
        inc hl
        ld d,(hl)
        ld (CNT),de
gb9:    ld a,c
        ret
DRVEND:
