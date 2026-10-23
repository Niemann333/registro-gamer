#!/usr/bin/env python3
"""
Copia a tag _refresh dos .psflib para as faixas (.psf/.minipsf) que não têm.

O player web (Highly Experimental) só lê _refresh da própria faixa; quando a tag
está só na lib, ele usa a região do executável (Europa = 50 Hz) e a música fica
lenta. Uso: python3 tools/psf_refresh.py "Chiptunes/.../Crash Team Racing"
"""
import os, re, sys

def tags(data):
    i = data.find(b'[TAG]')
    t = {}
    if i >= 0:
        for l in data[i + 5:].decode('utf8', 'replace').splitlines():
            if '=' in l:
                k, v = l.split('=', 1); t[k.strip().lower()] = v.strip()
    return i, t

for pasta in sys.argv[1:]:
    for f in sorted(os.listdir(pasta)):
        if not f.lower().endswith(('.psf', '.minipsf')): continue
        p = os.path.join(pasta, f); d = open(p, 'rb').read()
        i, t = tags(d)
        if '_refresh' in t: continue
        hz = None
        for k in sorted(k for k in t if re.fullmatch(r'_lib\d*', k)):
            lp = os.path.join(pasta, t[k])
            if os.path.exists(lp):
                _, lt = tags(open(lp, 'rb').read())
                if '_refresh' in lt: hz = lt['_refresh']
        if not hz: continue
        if i < 0: d = d + b'[TAG]_refresh=' + hz.encode() + b'\n'
        else:     d = d[:i + 5] + b'_refresh=' + hz.encode() + b'\n' + d[i + 5:]
        open(p, 'wb').write(d)
        print('%s: _refresh=%s' % (f, hz))
