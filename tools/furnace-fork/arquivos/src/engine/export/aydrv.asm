; driver AY (ZXAYEMUL) do Tracker do Registro Gamer (Z80, ZX Spectrum 128). Fica em $4100 (pilha logo abaixo); o registro da música vem
; logo depois, até o fim da memória. o player chama INTERRUPT 50 vezes por segundo; o quadro é dividido em passos
; com espera contada em ciclos, e um acumulador de 24 bits decide em que passos tocam os tiques (qualquer taxa).
; montar: python3 scripts/rg-z80inc.py src/engine/export/aydrv.asm ayDriver "comentário"
;
; registro:
;   00-0F vv          AY: registrador cmd = vv (portas $FFFD/$BFFD)
;   E0 lo hi nl nh    toca n bytes que estão em hi:lo e volta (aninhado até 8)
;   F0-FD             fim do tique; espera cmd-F0 tiques a mais
;   FE nn             fim do tique; espera nn tiques a mais
;   FF                volta ao ponto de repetição (ou acaba)

        org $4100

INIT:   jp init_
PLAY:   jp play_

; parâmetros (o exportador preenche)
LOG:    defw 0
RATE:   defb 0, 0, 0, 0
STEPS:  defb 16
DLY:    defw 100
SC:     defb 0
LOOPP:  defw 0

; estado
PTR:    defw 0
CNT:    defw 0
DEPTH:  defb 0
WAIT:   defb 0
STOP:   defb 0
ACC:    defb 0, 0, 0, 0
ACCI:   defb 0, 0, 0
T1:     defb 0
STK:    defs 32

init_:  ld hl,(LOG)
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

play_:  ld a,(STEPS)            ; o quadro é dividido em STEPS passos iguais (DLY voltas de espera cada):
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
        jr z,ref
        ld (T1),a
        call GB
        ld e,a
        ld a,(T1)
        ld bc,$fffd
        out (c),a
        ld b,$bf
        out (c),e
        jr rd
ctl:    cp $fe
        jr c,wk
        jr z,wn
        ld hl,(LOOPP)           ; FF: repetição ou fim
        ld a,h
        or l
        jr z,fim
        ld (PTR),hl
        jr rd
wk:     sub $f0
        ld (WAIT),a
        ret
wn:     call GB
        ld (WAIT),a
        ret
fim:    ld a,1
        ld (STOP),a
        ld a,8                  ; silêncio: volumes zerados
        ld e,0
fi1:    ld bc,$fffd
        out (c),a
        ld b,$bf
        out (c),e
        inc a
        cp 11
        jr nz,fi1
        ret

; trecho repetido: guarda onde estava e vai para hi:lo
ref:    call GB
        ld (T1),a
        call GB
        push af
        call GB
        push af
        call GB                 ; nh
        ld b,a
        pop af                  ; nl
        ld c,a
        push bc
        ld a,(DEPTH)            ; empilha ponteiro e contador (4 bytes)
        add a,a
        add a,a
        ld e,a
        ld d,0
        ld hl,STK
        add hl,de
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
        pop bc
        ld (CNT),bc
        pop af                  ; hi
        ld h,a
        ld a,(T1)
        ld l,a
        ld (PTR),hl
        jp rd

; um byte do registro em A (no fim de um trecho repetido, volta)
GB:     ld hl,(PTR)
        ld a,(hl)
        inc hl
        ld (PTR),hl
        ld c,a
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
        add a,a
        add a,a
        ld e,a
        ld d,0
        ld hl,STK
        add hl,de
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
