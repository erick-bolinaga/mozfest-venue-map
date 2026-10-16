#!/usr/bin/env python3
"""Pull the volunteer zones from mapa.svg into modelo.json.

    python3 leer-zonas.py [--check | --write]

The sixth reader of the lost SVG pipeline. A `z-<letter>` layer is one of the
organisation's zones A-F, traced by Erick from their 'Venue General Layout'
slide. The viewer paints them as flat tinted ground, and the volunteer layer
answers "which zone is this post in" by point-in-polygon on them — the zone is
never a field, so this polygon IS the assignment.

Unlike leer-areas.py this REPLACES rather than extends: a zone that is traced
again has moved on purpose, and keeping the old outline would keep the old
assignment. The letter is the key and the colour comes from the fill.

    --check   read the SVG, say which zones changed, write nothing
    --write   put the zones from the SVG into modelo.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)


def leer(svg):
    """Every z- layer, keyed by its letter, with the fill the trace gave it."""
    root = ET.parse(svg).getroot()
    fills = {e.get('id'): e.get('fill') for e in root.iter() if e.get('id')}
    out = {}
    for s in L.shapes(root):
        raw = s['id'] or ''
        m = re.fullmatch(r'z-([A-Z])', raw.strip())
        if not m or len(s['px']) < 3:
            continue
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        # Figma writes the first point again before the Z; the model keeps it once.
        if len(poly) > 3 and poly[-1] == poly[0]:
            poly.pop()
        out[m.group(1)] = {'zid': m.group(1), 'color': fills.get(raw) or '#888888', 'poly': poly,
                           'area': round(abs(L.area([tuple(p) for p in poly])), 1)}
    return out


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    svg = leer(here / 'mapa.svg')
    viejas = {z['zid']: z for z in modelo.get('zones', [])}

    cambian = {}
    for zid, z in sorted(svg.items()):
        v = viejas.get(zid)
        if v is None:
            cambian[zid] = 'nueva'
        elif v['poly'] != z['poly'] or v.get('color') != z['color']:
            cambian[zid] = (f'{len(v["poly"])} -> {len(z["poly"])} vertices, '
                            f'{abs(L.area([tuple(p) for p in v["poly"]])):.0f} -> {z["area"]:.0f} m2')
    sobran = sorted(set(viejas) - set(svg))

    print(f'{len(svg)} zonas leidas del SVG, {len(viejas)} en el modelo')
    for zid, que in cambian.items():
        print(f'  cambia {zid}: {que}')
    for zid in sobran:
        print(f'  desaparece {zid}: esta en el modelo y ya no en el SVG')
    if not cambian and not sobran:
        print('  ninguna cambio')

    if modo == '--write':
        modelo['zones'] = [{'zid': z['zid'], 'color': z['color'], 'poly': z['poly']}
                           for _, z in sorted(svg.items())]
        for zid in svg:
            modelo['names'].setdefault('z-' + zid, 'z-' + zid)
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado' if (cambian or sobran) else 'nada que cambiar')
    else:
        print('(--check: no se ha escrito nada)')


if __name__ == '__main__':
    main()
