#!/usr/bin/env python3
"""
Registro Gamer — volume medido antes (chiptune-player/ganhos.json).

Abre o próprio player do site num navegador sem tela (Chromium), toca cada faixa
"no silêncio", o mais rápido que o emulador conseguir, e mede o volume das
partes altas da música (loudness K-weighted, janelas de 3 s, percentil 90).
Como quem mede é o mesmo motor que toca no blog, o número já sai na escala
certa, para TODOS os formatos: VGM, SPC, NSF, GBS, KSS, SAP, SID, PSF, GSF,
USF, 2SF, MOD/S3M/XM/IT e MIDI — e cada subsom de NSF/GBS/KSS/SID tem o seu.

O gadget aplica esse ganho fixo assim que a faixa começa (também com a aba em
segundo plano). O modo "ao vivo" só fica para arquivo que ainda não foi medido.

Grava:
  { "v": 2, "alvo": -16,
    "g": { "pasta": { "faixa.vgz": -3.1, "jogo.nsf": { "0": 1.2, "9": 3.0 } } } }
e ganhos-hash.json com o SHA-1 de cada arquivo (para medir de novo só o que mudou).

Uso:
  pip install playwright && python -m playwright install --with-deps chromium
  python3 tools/medir_volume.py [--tudo] [--jobs 2]
"""
import os, sys, json, time, hashlib, argparse, threading, asyncio, urllib.parse, functools
import http.server, socketserver

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'Chiptunes')
SAIDA = os.path.join(RAIZ, 'chiptune-player', 'ganhos.json')
SUBS = os.path.join(RAIZ, 'chiptune-player', 'subfaixas.json')
HASH = os.path.join(RAIZ, 'chiptune-player', 'ganhos-hash.json')   # só para saber o que mudou (o blog não baixa)

ALVO = -16.0       # loudness das partes altas (escala do player do site)
MAX_UP, MAX_DOWN = 15.0, -15.0
TETO_PICO = 1.5    # dB que o pico pode passar de 0 dBFS (o limitador suave absorve)
MAX_MS = 150000    # no máximo 2,5 min por faixa (ou até o fim do 1º loop)
TEMPO_LIMITE = 240 # s por faixa antes de desistir

EXTS = {'vgm', 'vgz', 'gym', 'spc', 'nsf', 'nsfe', 'gbs', 'ay', 'hes', 'mod', 's3m', 'xm', 'it', 'mptm',
        'sid', 'mid', 'midi', 'psf', 'minipsf', 'psf2', 'minipsf2', 'gsf', 'minigsf', 'usf', 'miniusf',
        '2sf', 'mini2sf', 'kss', 'sap'}
MULTI = {'nsf', 'nsfe', 'gbs', 'ay', 'hes', 'kss', 'sap', 'sid'}   # vários subsons num arquivo


def sha1(p):
    h = hashlib.sha1()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def servidor():
    class Quieto(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quieto, directory=RAIZ)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, 'http://127.0.0.1:%d/' % srv.server_address[1]


def ganho(r):
    if not r or r.get('p90') is None:
        return None
    g = ALVO - r['p90']
    g = min(g, TETO_PICO - r['peakDb'])        # não estoura o pico
    return round(max(MAX_DOWN, min(MAX_UP, g)), 1)


async def trabalhador(nome, base, fila, res, total, feitos):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--mute-audio'])
        page = None

        async def abrir():
            nonlocal page
            if page:
                try: await page.close()
                except Exception: pass
            page = await b.new_page()
            await page.goto(base + 'chiptune-player/player.html?medir=1')
            await page.wait_for_function('window.RG && window.RG.measure', timeout=60000)

        await abrir()
        while True:
            try:
                rel, sub = fila.get_nowait()
            except Exception:
                break
            url = base + urllib.parse.quote(rel)
            t0 = time.time()
            try:
                r = await asyncio.wait_for(page.evaluate('(a)=>RG.measure(a[0],a[1],a[2])', [url, sub, MAX_MS]), TEMPO_LIMITE)
            except Exception as e:
                r = {'erro': str(e)[:120]}
                await abrir()                       # recomeça a página (motor travado)
            res[(rel, sub)] = r
            feitos[0] += 1
            g = ganho(r)
            print('[%d/%d] %s%s -> %s (%.1fs)' % (feitos[0], total, rel.split('/')[-1],
                  '' if sub is None else ' #%d' % sub, g if g is not None else (r or {}).get('erro', 'sem som'),
                  time.time() - t0), flush=True)
        await b.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tudo', action='store_true', help='mede tudo de novo')
    ap.add_argument('--jobs', type=int, default=2, help='navegadores em paralelo')
    a = ap.parse_args()

    antigo = {'g': {}, 'h': {}}
    if os.path.exists(SAIDA) and not a.tudo:
        try:
            antigo = json.load(open(SAIDA, encoding='utf-8'))
        except ValueError:
            pass
    g_ant = {}
    for pasta, arqs in antigo.get('g', {}).items():
        for nome, v in arqs.items():
            g_ant[pasta + '/' + nome] = v
    h_ant = {}
    if os.path.exists(HASH) and not a.tudo:
        try:
            h_ant = json.load(open(HASH, encoding='utf-8'))
        except ValueError:
            pass
    subs = json.load(open(SUBS, encoding='utf-8')) if os.path.exists(SUBS) else {}

    arquivos = []
    for dp, _, fs in os.walk(PASTA):
        for f in fs:
            if f.rsplit('.', 1)[-1].lower() in EXTS:
                arquivos.append(os.path.relpath(os.path.join(dp, f), RAIZ).replace(os.sep, '/'))
    arquivos.sort()

    novo_g, novo_h, fila_l = {}, {}, []
    for rel in arquivos:
        ext = rel.rsplit('.', 1)[-1].lower()
        h = sha1(os.path.join(RAIZ, rel))
        novo_h[rel] = h
        v = g_ant.get(rel)
        mudou = rel in h_ant and h_ant[rel] != h
        if ext in MULTI:
            pasta, nome = rel.rsplit('/', 1)
            lista = [s[0] for s in subs.get(pasta, {}).get(nome, [])] or [0]
            ja = v if isinstance(v, dict) and not mudou else {}
            novo_g[rel] = {k: x for k, x in ja.items() if int(k) in lista}
            for s in lista:
                if str(s) not in novo_g[rel]:
                    fila_l.append((rel, s))
        else:
            if isinstance(v, (int, float)) and not mudou:
                novo_g[rel] = v
            else:
                fila_l.append((rel, None))

    print('%d arquivos, %d faixas/subsons para medir' % (len(arquivos), len(fila_l)), flush=True)

    def gravar():
        agrup = {}
        for rel in sorted(novo_g):
            v = novo_g[rel]
            if v is None or v == {}:
                continue
            pasta, nome = rel.rsplit('/', 1)
            agrup.setdefault(pasta, {})[nome] = v
        out = {'v': 2, 'alvo': ALVO, 'g': agrup}
        for caminho, dados in ((SAIDA, out), (HASH, {k: novo_h[k] for k in sorted(novo_h)})):
            tmp = caminho + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(dados, f, ensure_ascii=False, separators=(',', ':'))
            os.replace(tmp, caminho)

    if fila_l:
        import queue
        fila = queue.Queue()
        for x in fila_l:
            fila.put(x)
        srv, base = servidor()
        res, feitos = {}, [0]

        async def tudo():
            ws = [trabalhador(i, base, fila, res, len(fila_l), feitos) for i in range(max(1, a.jobs))]
            salvar = asyncio.create_task(salvador())
            await asyncio.gather(*ws)
            salvar.cancel()

        async def salvador():          # grava o progresso de tempos em tempos
            while True:
                await asyncio.sleep(120)
                aplicar(); gravar()

        def aplicar():
            for (rel, sub), r in list(res.items()):
                g = ganho(r)
                if g is None:
                    continue
                if sub is None:
                    novo_g[rel] = g
                else:
                    if not isinstance(novo_g.get(rel), dict):
                        novo_g[rel] = {}
                    novo_g[rel][str(sub)] = g

        asyncio.run(tudo())
        aplicar()
        srv.shutdown()

    gravar()
    n = sum(len(v) if isinstance(v, dict) else 1 for v in novo_g.values() if v not in (None, {}))
    print('OK: %d ganhos em %s' % (n, os.path.relpath(SAIDA, RAIZ)))


if __name__ == '__main__':
    main()
