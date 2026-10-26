#!/usr/bin/env python3
"""
Registro Gamer — mapa de loops (chiptune-player/loops.json).

VGM traz no próprio arquivo onde o loop começa. NSF, NSFe, GBS, KSS, SAP, AY e
SID não: eles são o programa de música do jogo, que repete sozinho. Este script
roda cada faixa no emulador (tools/rgloop) e registra, quadro a quadro, o que a
música manda para o chip de som. Quando essa sequência passa a se repetir, ali
está o loop: a introdução acaba e a volta começa, com precisão de 1 quadro.

Grava:
  { "Chiptunes/.../jogo.nsf": { "3": [intro_ms, loop_ms], "7": [fim_ms] }, ... }
  [intro, loop]  a música repete: o player toca intro + N voltas e faz o fade
  [fim]          a música termina sozinha (vinheta, tema de fim): toca uma vez
O número é o mesmo que o gadget usa como subfaixa (KSS conta a partir de 1).

Só analisa arquivos novos ou alterados (guarda o SHA-1 em "_arquivos").

Uso: python3 tools/gerar_loops.py --rgloop /caminho/rgloop [--tudo] [--jobs 4]
"""
import os, sys, json, hashlib, argparse, subprocess
from concurrent.futures import ThreadPoolExecutor

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'Chiptunes')
SAIDA = os.path.join(RAIZ, 'chiptune-player', 'loops.json')
EXTS = {'.nsf', '.nsfe', '.gbs', '.kss', '.sap', '.ay', '.sid'}


def sha1(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def analisar(rgloop, caminho):
    """Roda o rgloop no arquivo inteiro e devolve {subfaixa: [..]}."""
    ext = os.path.splitext(caminho)[1].lower()
    try:
        out = subprocess.run([rgloop, caminho], capture_output=True, text=True, timeout=3600).stdout
    except subprocess.TimeoutExpired:
        return {}
    faixas = {}
    for linha in out.splitlines():
        try:
            t = json.loads(linha)
        except ValueError:
            continue
        if 't' not in t:
            continue
        n = t['t'] + 1 if ext == '.kss' else t['t']      # o player de KSS (NEZplug) conta a partir de 1
        # loops acima de 4 min quase sempre são várias voltas que não batem 100%
        # (variação de tempo do driver): melhor ficar com a duração do .m3u
        if 'loop' in t and 0 < t['loop'] <= 240000:
            faixas[str(n)] = [int(round(t['intro'])), int(round(t['loop']))]
        elif 'fim' in t and 500 <= t['fim'] <= 300000:
            faixas[str(n)] = [int(round(t['fim']))]
    return faixas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rgloop', required=True)
    ap.add_argument('--tudo', action='store_true', help='reanalisa todos os arquivos')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 2)
    a = ap.parse_args()

    mapa = {}
    if os.path.exists(SAIDA) and not a.tudo:
        try:
            mapa = json.load(open(SAIDA, encoding='utf-8'))
        except ValueError:
            mapa = {}
    hashes = mapa.pop('_arquivos', {})

    todos = []
    for raiz, _, arquivos in os.walk(PASTA):
        for nome in arquivos:
            if os.path.splitext(nome)[1].lower() in EXTS:
                todos.append(os.path.join(raiz, nome))
    todos.sort()
    chaves = {os.path.relpath(p, RAIZ).replace(os.sep, '/'): p for p in todos}

    # tira do mapa o que foi apagado do repositório
    for k in list(mapa):
        if k not in chaves:
            mapa.pop(k, None)
            hashes.pop(k, None)

    fila = []
    for k, p in chaves.items():
        h = sha1(p)
        if a.tudo or hashes.get(k) != h or k not in mapa:
            fila.append((k, p, h))
    print(f'{len(chaves)} arquivos, {len(fila)} para analisar')

    def tarefa(item):
        k, p, h = item
        return k, h, analisar(a.rgloop, p)

    with ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        for i, (k, h, faixas) in enumerate(ex.map(tarefa, fila), 1):
            mapa[k] = faixas
            hashes[k] = h
            nl = sum(1 for v in faixas.values() if len(v) == 2)
            print(f'[{i}/{len(fila)}] {k}: {nl} com loop, {len(faixas) - nl} com fim')

    saida = {k: mapa[k] for k in sorted(mapa)}
    saida['_arquivos'] = {k: hashes[k] for k in sorted(hashes) if k in saida}
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print('gravado', SAIDA)


if __name__ == '__main__':
    main()
