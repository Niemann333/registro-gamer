#!/usr/bin/env python3
"""
Registro Gamer — mapa de subfaixas.

Arquivos como NSF, GBS, SID, SAP e KSS guardam várias músicas dentro de um só
arquivo. Este script descobre quais são, com nome e duração, para o gadget já
mostrar as faixas separadas dentro da pasta:

  1. .m3u da mesma pasta (formato Knurek "arquivo::GBS,3,Nome,1:30,,10" ou
     foobar "nsf://2:caminho" com #EXTINF) — nome, duração e ordem certos
  2. cabeçalho do arquivo (NSF, NSFE, GBS, SID, SAP) — só a quantidade

Grava chiptune-player/subfaixas.json:
  { "pasta": { "arquivo.nsf": [[indice, "nome", duracao_ms], ...] } }

Uso: python3 tools/gerar_subfaixas.py
"""
import os, re, json, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'Chiptunes')
SAIDA = os.path.join(RAIZ, 'chiptune-player', 'subfaixas.json')
MULTI = {'nsf', 'nsfe', 'gbs', 'sid', 'sap', 'kss', 'ay', 'hes'}

def ler_texto(p):
    b = open(p, 'rb').read()
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try: return b.decode(enc)
        except UnicodeDecodeError: pass
    return b.decode('latin-1', 'replace')

def tempo_ms(s):
    s = (s or '').strip()
    if not s: return 0
    try:
        p = s.split(':'); t = 0.0
        for x in p: t = t * 60 + float(x)
        return int(t * 1000)
    except ValueError:
        return 0

def cabecalho(p, ext):
    """(quantidade, primeira) ou (None, None)."""
    try: d = open(p, 'rb').read()
    except OSError: return None, None
    if ext == 'nsf' and d[:5] == b'NESM\x1a': return d[6], max(0, d[7] - 1)
    if ext == 'gbs' and d[:3] == b'GBS': return d[4], max(0, d[5] - 1)
    if ext == 'sid' and d[:4] in (b'PSID', b'RSID'):
        return int.from_bytes(d[0x0e:0x10], 'big'), max(0, int.from_bytes(d[0x10:0x12], 'big') - 1)
    if ext == 'nsfe' and d[:4] == b'NSFE':
        i = 4; n = None; first = 0; nomes = []; tempos = []
        while i + 8 <= len(d):
            ln = int.from_bytes(d[i:i+4], 'little'); tag = d[i+4:i+8]; ch = d[i+8:i+8+ln]
            if tag == b'INFO' and ln >= 9:
                n = ch[8]; first = ch[9] if ln > 9 else 0
            elif tag == b'tlbl':
                nomes = [x.decode('latin-1', 'replace') for x in ch.split(b'\0')]
            elif tag == b'time':
                tempos = [int.from_bytes(ch[k:k+4], 'little', signed=True) for k in range(0, len(ch) - 3, 4)]
            elif tag == b'NEND': break
            i += 8 + ln
        return n, first, nomes, tempos
    if ext == 'sap':
        txt = d[:4096].split(b'\xff\xff')[0].decode('latin-1', 'replace')
        m = re.search(r'^SONGS\s+(\d+)', txt, re.M)
        n = int(m.group(1)) if m else 1
        m = re.search(r'^DEFSONG\s+(\d+)', txt, re.M)
        times = [tempo_ms(x.split()[0]) for x in re.findall(r'^TIME\s+(.+)$', txt, re.M)]
        return n, int(m.group(1)) if m else 0, [], times
    return None, None

def ler_m3u(pasta):
    """Lista de (arquivo_ref, numero_texto, nome, duracao_ms, formato, origem)."""
    ent = []
    for f in sorted(os.listdir(pasta)):
        if not f.lower().endswith('.m3u'): continue
        linhas = ler_texto(os.path.join(pasta, f)).splitlines()
        extinf = None
        for l in linhas:
            l = l.strip()
            if not l: continue
            if l.upper().startswith('#EXTINF:'):
                m = re.match(r'#EXTINF:\s*(-?\d+)\s*,(.*)', l, re.I)
                extinf = (int(m.group(1)) * 1000 if m and int(m.group(1)) > 0 else 0, m.group(2).strip() if m else '')
                continue
            if l.startswith('#'): continue
            m = re.match(r'^(.*?)::(\w+)\s*,\s*(\$?[0-9A-Fa-f]+)\s*,?(.*)$', l)
            if m:
                ref, fmt, num, resto = m.group(1).strip(), m.group(2).upper(), m.group(3), m.group(4)
                # resto: nome,tempo,loop,fade  (o nome pode ter vírgulas escapadas com \,)
                partes = re.split(r'(?<!\\),', resto)
                nome = partes[0].replace('\\,', ',').strip() if partes else ''
                dur = tempo_ms(partes[1]) if len(partes) > 1 else 0
                if extinf and not nome: nome = extinf[1]
                if extinf and not dur: dur = extinf[0]
                ent.append((ref, num, nome, dur, fmt, f)); extinf = None; continue
            m = re.match(r'^\w+://(\d+):(.*)$', l)          # foobar: nsf://3:D:\...\arquivo.nsf
            if m:
                ref = re.split(r'[\\/]', m.group(2))[-1]
                ent.append((ref, '#' + m.group(1), extinf[1] if extinf else '', extinf[0] if extinf else 0, 'FB', f))
                extinf = None
    return ent

def limpar_nome(nome, fmt):
    n = (nome or '').strip()
    if not n: return ''
    if re.search(r'(^|\s-\s)Track\s+\d+$', n, re.I): return ''      # "Jogo - Track 3" (nome automático)
    m = re.search(r'\[\s*([^\]]+?)\s*\]\s*$', n)                    # "Jogo (C)Empresa [ Nome ]"
    if m and n.index('[') > 0: return m.group(1)
    n = re.sub(r'^\[[^\]]*\]\s*', '', n)                               # "[KNIGHTMARE] Nome"
    if ' | ' in n:                                                        # "Jogo | Nome | Compositor"
        p = [x.strip() for x in n.split(' | ')]
        return p[1] if len(p) >= 3 else p[-1]
    if '\u00a9' in n or '(C)' in n:                                       # Knurek: "Nome - Autor - Jogo - ©Data Empresa"
        p = n.split(' - ')
        if len(p) >= 4: return ' - '.join(p[:-3]).strip()
    return n

def mesmo_arquivo(ref, nome):
    a = ref.lower(); b = nome.lower()
    return a == b or os.path.splitext(a)[0] == os.path.splitext(b)[0]

def numero(txt):
    if txt.startswith('#'): return int(txt[1:]), True        # foobar: já começa em 0
    if txt.startswith('$'): return int(txt[1:], 16), True    # hexadecimal: já começa em 0
    return int(txt), False

def mapear(pasta, arquivos, rel):
    out = {}
    m3u = ler_m3u(pasta)
    for f in arquivos:
        ext = f.lower().rsplit('.', 1)[-1]
        p = os.path.join(pasta, f)
        meus = [e for e in m3u if mesmo_arquivo(e[0], f)]
        if not meus and len([x for x in arquivos if x.lower().rsplit('.', 1)[-1] == ext]) == 1:
            meus = [e for e in m3u if e[4] in (ext.upper(), 'FB', 'NSFE' if ext == 'nsfe' else ext.upper())]
        hdr = cabecalho(p, ext)
        total = hdr[0] if hdr else None
        faixas = []
        if meus:
            nums = [numero(e[1]) for e in meus]
            decimais = [n for n, zero in nums if not zero]
            # Knurek decimal: começa em 1, a não ser que apareça o 0 (KSS usa o número cru)
            menos1 = ext != 'kss' and decimais and 0 not in decimais and (total is None or max(decimais) >= total or min(decimais) >= 1)
            vistos = set()
            for (n, zero), e in zip(nums, meus):
                idx = n if (zero or not menos1) else n - 1
                if ext == 'kss': idx = n + 1          # o player de KSS (NEZplug) conta a partir de 1
                if idx in vistos or idx < 0: continue
                if total and ext != 'kss' and idx >= total: continue
                vistos.add(idx)
                dur = 0 if (e[4] == 'FB' and e[3] == 122000) else e[3]   # 2:02 = valor padrão do foobar, não é a duração real
                faixas.append([idx, limpar_nome(e[2], e[4]), dur])
        elif total and total > 1:
            nomes = hdr[2] if len(hdr) > 2 else []
            tempos = hdr[3] if len(hdr) > 3 else []
            for i in range(total):
                nome = nomes[i].strip() if i < len(nomes) and nomes[i].strip() else ''
                dur = tempos[i] if i < len(tempos) and tempos[i] > 0 else 0
                faixas.append([i, nome, dur])
        # tira o prefixo comum "Nome do Jogo - " quando todas as faixas têm
        nomes = [x[1] for x in faixas if x[1]]
        if len(nomes) > 1:
            pref = os.path.commonprefix(nomes)
            k = pref.rfind(' - ')
            if k > 0:
                for x in faixas:
                    if x[1].startswith(pref[:k + 3]): x[1] = x[1][k + 3:]
        if len(faixas) > 1 or (ext == 'kss' and faixas):
            out[f] = faixas
    return out

def main():
    total = {}
    nfx = 0
    for dp, _, fs in os.walk(PASTA):
        multi = sorted(f for f in fs if f.lower().rsplit('.', 1)[-1] in MULTI)
        if not multi: continue
        rel = os.path.relpath(dp, RAIZ).replace(os.sep, '/')
        m = mapear(dp, multi, rel)
        if m:
            total[rel] = m
            nfx += sum(len(v) for v in m.values())
    with open(SAIDA, 'w', encoding='utf-8') as fo:
        json.dump(total, fo, ensure_ascii=False, separators=(',', ':'))
    print('OK: %d arquivos com subfaixas, %d faixas -> %s' % (sum(len(v) for v in total.values()), nfx, os.path.relpath(SAIDA, RAIZ)))

if __name__ == '__main__':
    main()
