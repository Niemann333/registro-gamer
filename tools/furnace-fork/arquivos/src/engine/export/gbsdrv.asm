; driver GBS do Tracker do Registro Gamer: repete as escritas gravadas nos registradores de som (FF10-FF3F)
; o log fica nos bancos de 16 KB a partir do banco 1, lido pela janela 4000-7FFF (banco trocado em 2000)
; comandos: 00-2F vv escreve vv em FF10+cmd · F0-FD fim do tique e espera cmd-F0 tiques · FE nn espera nn · FF repete/acaba
.org $0400
INIT:
  ld a,#1
  ld (BANK),a
  ld ($2000),a
  ld a,#$00
  ld (PTRL),a
  ld a,#$40
  ld (PTRH),a
  xor a
  ld (WAIT),a
  ld (ENDF),a
  ret
GB:
  ld a,(PTRL)
  ld l,a
  ld a,(PTRH)
  ld h,a
  ld a,(hl+)
  push af
  ld a,l
  ld (PTRL),a
  ld a,h
  cp #$80
  jr nz,gbok
  ld a,(BANK)
  inc a
  ld (BANK),a
  ld ($2000),a
  ld a,#$40
gbok:
  ld (PTRH),a
  pop af
  ret
PLAY:
  ld a,(ENDF)
  or a
  jr nz,pret
  ld a,(WAIT)
  or a
  jr z,next
  dec a
  ld (WAIT),a
pret:
  ret
next:
  call GB
  cp #$30
  jr nc,notreg
  add a,#$10
  ld c,a
  call GB
  ldh ($ff00+c),a
  jr next
notreg:
  cp #$F0
  jr c,next
  cp #$FE
  jr c,waitk
  jr z,waitn
  ld a,(HASLOOP)
  or a
  jr z,endsong
  ld a,(LOOPBANK)
  ld (BANK),a
  ld ($2000),a
  ld a,(LOOPLO)
  ld (PTRL),a
  ld a,(LOOPHI)
  ld (PTRH),a
  jr next
waitk:
  sub #$F0
  ld (WAIT),a
  ret
waitn:
  call GB
  ld (WAIT),a
  ret
endsong:
  ld a,#1
  ld (ENDF),a
  xor a
  ldh ($25),a
  ret
.org $04F0
HASLOOP: .byte 0
LOOPBANK: .byte 0
LOOPLO: .byte 0
LOOPHI: .byte 0
