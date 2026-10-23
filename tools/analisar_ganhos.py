#!/usr/bin/env python3
"""
Registro Gamer — pré-análise de volume dos chiptunes.

Renderiza cada faixa offline (os chips são determinísticos: o mesmo arquivo gera
sempre as mesmas ondas), mede o volume das PARTES MAIS ALTAS da música e grava
um ganho fixo por faixa em chiptune-player/ganhos.json.

O gadget aplica esse ganho do começo ao fim da faixa: intro baixa continua baixa,
refrão forte continua forte — só o volume geral da faixa é igualado às outras.

Formatos: VGM/VGZ (libvgm/vgm2wav), SPC/NSF/NSFE/GBS/AY/HES (libgme via
ffmpeg), MOD/S3M/XM/IT (libopenmpt via ffmpeg). Os demais ficam com o auto
volume ao vivo do gadget.

Uso:  python3 tools/analisar_ganhos.py [--vgm2wav caminho] [--tudo]
      (sem --tudo, só analisa faixas novas que ainda não estão no JSON)
"""
import os, sys, json, subprocess, argparse, time
import numpy as np
from multiprocessing import Pool

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA = os.path.join(RAIZ, 'Chiptunes')
SAIDA = os.path.join(RAIZ, 'chiptune-player', 'ganhos.json')

ALVO     = -16.0   # LUFS das partes altas (escala do player no navegador)
MAX_UP   = 15.0
MAX_DOWN = -15.0
TETO_PICO = 1.5    # dB que o pico pode passar de 0 dBFS (o limitador suave absorve)
SR = 44100
MAX_SEG = 300      # segundos máximos analisados por faixa

# Diferença medida entre o render offline e o player do navegador (Chip Player JS):
# o navegador toca cerca de 6 dB mais baixo (libvgm/libgme) e 3.8 dB (libopenmpt).
OFFSET = {'vgm': -6.0, 'gme': -6.0, 'mpt': -3.8}

EXT_VGM = {'vgm', 'vgz'}
# KSS e SAP tocam em players próprios (kss.html / sap.html), ficam com o modo ao vivo
EXT_GME = {'spc', 'nsf', 'nsfe', 'gbs', 'ay', 'hes'}
EXT_MPT = {'mod', 's3m', 'xm', 'it', 'mptm'}
MULTI   = {'nsf', 'nsfe', 'gbs', 'ay', 'hes'}   # vários subsongs num arquivo

VGM2WAV = 'vgm2wav'

# ── K-weighting (ITU-R BS.1770) ──
def _biquad(b, a, x):
    from scipy.signal import lfilter
    return lfilter(b, a, x, axis=0)

def k_weight(x, fs):
    # high-shelf +4 dB @ 1681 Hz
    G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    K = np.tan(np.pi * fc / fs); Vh = 10 ** (G / 20); Vb = Vh ** 0.499666774155
    a0 = 1 + K / Q + K * K
    b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    a = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    x = _biquad(b, a, x)
    # high-pass @ 38 Hz
    Q, fc = 0.5003270373253953, 38.13547087613982
    K = np.tan(np.pi * fc / fs)
    b = [1, -2, 1]
    a = [1, 2 * (K * K - 1) / (1 + K / Q + K * K), (1 - K / Q + K * K) / (1 + K / Q + K * K)]
    return _biquad(b, a, x)

def render(path, ext, track=None):
    if ext in EXT_VGM:
        r = subprocess.run([VGM2WAV, '--samplerate', str(SR), '--loops', '1', '--fade', '0', path, '-'],
                           capture_output=True, timeout=600)
        raw = r.stdout; i = raw.find(b'data')
        if i < 0: return None
        raw = raw[i + 8:]; raw = raw[:len(raw) // 4 * 4]
        return np.frombuffer(raw, dtype=np.int16).reshape(-1, 2).astype(np.float32) / 32768
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error']
    if track is not None: cmd += ['-track_index', str(track)]
    cmd += ['-i', path, '-t', str(MAX_SEG), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True, timeout=600)
    if not r.stdout: return None
    raw = r.stdout[:len(r.stdout) // 8 * 8]
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)

def num_tracks(path):
    r = subprocess.run(['ffprobe', '-hide_banner', '-loglevel', 'error', '-show_entries',
                        'format_tags=tracks', '-of', 'default=nw=1:nk=1', path], capture_output=True, text=True)
    try: return max(1, min(64, int(r.stdout.strip().splitlines()[0])))
    except Exception: return 1

def short_term(x):
    """Loudness de curto prazo (janelas de 3 s, passo 1 s) e pico."""
    x = x[:SR * MAX_SEG]
    if len(x) < SR // 4: return [], 0.0
    pk = float(np.abs(x).max())
    y = k_weight(x.astype(np.float64), SR)
    p = (y ** 2).sum(axis=1)                       # soma dos canais
    win = min(len(p), 3 * SR); hop = SR
    c = np.concatenate([[0.0], np.cumsum(p)])
    vals = []
    for s in range(0, max(1, len(p) - win + 1), hop):
        ms = (c[s + win] - c[s]) / win
        if ms > 0: vals.append(-0.691 + 10 * np.log10(ms))
    return [v for v in vals if v > -70], pk

def analisar(args):
    rel, = args
    path = os.path.join(RAIZ, rel)
    ext = rel.rsplit('.', 1)[-1].lower()
    eng = 'vgm' if ext in EXT_VGM else ('mpt' if ext in EXT_MPT else 'gme')
    try:
        tracks = [None]
        if ext in MULTI:
            n = num_tracks(path); tracks = list(range(n)) if n > 1 else [None]
        vals, pk = [], 0.0
        for t in tracks:
            x = render(path, ext, t)
            if x is None or not len(x): continue
            v, p = short_term(x); vals += v; pk = max(pk, p)
        if not vals: return rel, None
        off = OFFSET[eng]
        alto = float(np.percentile(vals, 90)) + off          # nível das partes altas
        pico = 20 * np.log10(pk + 1e-9) + off
        g = ALVO - alto
        g = min(g, TETO_PICO - pico)                          # não estoura o pico
        g = max(MAX_DOWN, min(MAX_UP, g))
        return rel, round(g, 1)
    except Exception as e:
        print('ERRO', rel, e, file=sys.stderr)
        return rel, None

def main():
    global VGM2WAV
    ap = argparse.ArgumentParser()
    ap.add_argument('--vgm2wav', default='vgm2wav')
    ap.add_argument('--tudo', action='store_true', help='reanalisa tudo')
    ap.add_argument('--proc', type=int, default=os.cpu_count() or 2)
    a = ap.parse_args(); VGM2WAV = a.vgm2wav

    atual = {}
    if os.path.exists(SAIDA) and not a.tudo:
        try:
            d = json.load(open(SAIDA, encoding='utf-8'))
            for pasta, arqs in d.get('g', {}).items():
                for nome, g in arqs.items(): atual[pasta + '/' + nome] = g
        except Exception: pass

    todos = []
    for dp, _, fs in os.walk(PASTA):
        for f in fs:
            e = f.rsplit('.', 1)[-1].lower()
            if e in EXT_VGM | EXT_GME | EXT_MPT:
                todos.append(os.path.relpath(os.path.join(dp, f), RAIZ).replace(os.sep, '/'))
    todos.sort()
    existe = set(todos)
    atual = {k: v for k, v in atual.items() if k in existe}   # remove faixas apagadas
    fila = [t for t in todos if t not in atual]
    print('%d faixas, %d novas para analisar' % (len(todos), len(fila)))

    t0 = time.time()
    with Pool(a.proc) as pool:
        for i, (rel, g) in enumerate(pool.imap_unordered(analisar, [(r,) for r in fila], chunksize=4)):
            if g is not None: atual[rel] = g
            if (i + 1) % 100 == 0: print('  %d/%d  (%.0fs)' % (i + 1, len(fila), time.time() - t0), flush=True)

    agrup = {}
    for rel, g in sorted(atual.items()):
        pasta, nome = rel.rsplit('/', 1)
        agrup.setdefault(pasta, {})[nome] = g
    out = {'v': 1, 'alvo': ALVO, 'g': agrup}
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('OK: %d ganhos em %s' % (len(atual), os.path.relpath(SAIDA, RAIZ)))

if __name__ == '__main__':
    main()
