#!/usr/bin/env python3
"""
Registro Gamer — playlists fixas do blog.

Junta todos os arquivos de playlist da pasta Playlists/ (na raiz do repositório)
em chiptune-player/playlists-fixas.json, que os gadgets leem e mostram para
todo mundo na aba PLAYLISTS (com o 📌).

Para criar uma playlist fixa nova: salve a playlist pelo blog ("Salvar arquivo")
e envie o .playlist.json para a pasta Playlists/. O nome que aparece no blog é o
que está dentro do arquivo. A ordem segue o nome do arquivo (dá para numerar:
"01 - ...", "02 - ...").

Uso: python3 tools/gerar_playlists_fixas.py
"""
import os, re, json, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'Playlists')
SAIDA = os.path.join(RAIZ, 'chiptune-player', 'playlists-fixas.json')


def slug(nome):
    s = unicodedata.normalize('NFKD', nome).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'playlist'


def main():
    saida, ids = [], set()
    nomes = sorted(os.listdir(PASTA)) if os.path.isdir(PASTA) else []
    for arq in nomes:
        if not arq.lower().endswith('.json'):
            continue
        try:
            d = json.load(open(os.path.join(PASTA, arq), encoding='utf-8-sig'))
        except Exception as e:
            print('ignorado (não é JSON válido):', arq, e)
            continue
        faixas = d.get('faixas') if isinstance(d, dict) else None
        if not isinstance(faixas, list):
            print('ignorado (não é uma playlist do Registro Gamer):', arq)
            continue
        faixas = [f for f in faixas if isinstance(f, dict) and f.get('p')]
        base = re.sub(r'(\.playlist)?\.json$', '', arq, flags=re.I)
        nome = str(d.get('nome') or base)
        pid = slug(base)
        while pid in ids:
            pid += '-2'
        ids.add(pid)
        saida.append({'id': pid, 'nome': nome, 'faixas': faixas})
        print(f'{arq}: "{nome}", {len(faixas)} faixas')
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print(len(saida), 'playlists fixas ->', SAIDA)


if __name__ == '__main__':
    main()
