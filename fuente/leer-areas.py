#!/usr/bin/env python3
"""Pull the traced ground areas from mapa.svg into modelo.json.

    python3 leer-areas.py [--check | --write]

The third piece of the lost SVG pipeline. An `a-` layer is a patch of ground
the venue has and nothing is built on: a garden, a passage, a corridor between
buildings. The viewer paints them flat on purpose — extruding them would read
as buildings, which is exactly the confusion they prevent.

It EXTENDS and never rewrites, for a reason that matters here more than
anywhere else: the pipeline that was lost did not treat every `a-` layer the
same way. The cage became wire, the pitch became a football pitch, the garden
became a volume with a wall. Re-deriving those as flat ground would undo work
that cannot be recovered from the SVG. So an area the model already knows in
ANY form is left exactly as it is, and only genuinely new layers are added.

    --check   read the SVG, compare against modelo.json, change nothing
    --write   add the new areas to modelo.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)


def leer(svg):
    """Every a- layer, keyed by the id without its bracket. The bracket is the
    label, the way it is everywhere else in this project."""
    out = {}
    for s in L.shapes(ET.parse(svg).getroot()):
        raw = s['id'] or ''
        if not raw.startswith('a-') or len(s['px']) < 3:
            continue
        br = re.search(r'\(([^)]*)\)', raw)
        aid = re.sub(r'\s*\([^)]*\)', '', raw).strip()
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        if abs(L.area([tuple(p) for p in poly])) < 0.4:
            continue                       # a stray handle, not a patch of ground
        out[aid] = {'poly': poly, 'label': br.group(1).strip() if br else None,
                    'area': round(abs(L.area([tuple(p) for p in poly])), 1)}
    return out


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    areas = leer(here / 'mapa.svg')

    # Known in any form at all: as a block, as a volume, or merely as a name.
    # The cage and the pitch appear only in the last two, and re-adding them as
    # flat ground would double-draw them.
    conocidas = ({b['id'] for b in modelo['blocks']}
                 | {v['id'] for v in modelo['vols']}
                 | set(modelo['names']))
    nuevas = {k: v for k, v in areas.items() if k not in conocidas}

    # A bracket put on an area the model already knows renames it and nothing
    # else: the geometry stays as it was, the way the docstring promises.
    rotuladas = {k: v['label'] for k, v in areas.items()
                 if k in conocidas and v['label'] and modelo['names'].get(k) != v['label']}

    print(f'{len(areas)} areas leidas del SVG, {len(conocidas & set(areas))} ya en el modelo')
    print(f'  nuevas: {len(nuevas)}')
    for k, v in sorted(nuevas.items()):
        print(f'     {k:38s} {v["area"]:7.1f} m2   {v["label"] or "(sin rotulo)"}')
    print(f'  rotuladas: {len(rotuladas)}')
    for k, lab in sorted(rotuladas.items()):
        print(f'     {k:38s} {modelo["names"].get(k)!r} -> {lab!r}')

    if modo == '--write':
        for k, v in sorted(nuevas.items()):
            modelo['blocks'].append({'id': k, 'cls': 'area', 'poly': v['poly']})
            modelo['names'][k] = v['label'] or k
        for k, lab in rotuladas.items():
            modelo['names'][k] = lab
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado' if (nuevas or rotuladas) else 'nada que anadir')
    else:
        print('(--check: no se ha escrito nada)')


if __name__ == '__main__':
    main()
