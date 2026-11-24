"""Índice do Acervo para o Tracker (Chiptune Studio).

O Chiptune Player usa chiptunes-index.json, que só tem o que ele toca. O Tracker abre também
projetos (Furnace .fur, DefleMask .dmf, módulos, FamiTracker...) e importa chiptunes (VGM, NSF, SPC, PSF, SID...); então ele usa
este índice, com esses formatos. Gera chiptune-player/tracker-index.json.
"""
import json
import os

# o que o Furnace abre como projeto + VGM (importação) + instrumentos, wavetables e samples
EXT = {
    # projetos e módulos
    '.fur', '.dmf', '.mod', '.s3m', '.xm', '.it', '.ftm', '.0cc', '.dnm', '.eft', '.fc13', '.fc14',
    '.smod', '.fc', '.tfe', '.tfm',
    # importação
    '.vgm', '.vgz', '.mid', '.midi', '.kar', '.smf', '.fub',
    # chiptunes que o Tracker converte em projeto (os mesmos do Chiptune Studio)
    '.s98', '.nsf', '.nsfe', '.gbs', '.kss', '.sap', '.hes', '.ay', '.spc', '.sid', '.psf', '.minipsf',
    '.2sf', '.mini2sf', '.gsf', '.minigsf',
    # instrumentos
    '.fui', '.dmp', '.tfi', '.vgi', '.s3i', '.sbi', '.opli', '.opni', '.y12', '.bnk', '.ff', '.gyb',
    '.opm', '.wopl', '.wopn',
    # wavetables
    '.fuw', '.dmw',
}


def scan(path):
    result = []
    try:
        entries = sorted(os.scandir(path), key=lambda e: (e.is_file(), e.name))
    except Exception:
        return result
    for entry in entries:
        if entry.is_dir():
            kids = scan(entry.path)
            if kids:  # pasta sem nada que o Tracker abre não aparece
                result.append({"name": entry.name, "type": "dir", "path": entry.path, "children": kids})
        elif os.path.splitext(entry.name)[1].lower() in EXT:
            result.append({"name": entry.name, "type": "file", "path": entry.path})
    return result


if __name__ == '__main__':
    os.makedirs("chiptune-player", exist_ok=True)
    with open("chiptune-player/tracker-index.json", "w", encoding="utf-8") as f:
        json.dump(scan("Chiptunes"), f, ensure_ascii=False)
    print("Índice do Tracker gerado: chiptune-player/tracker-index.json")
