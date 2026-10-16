#!/usr/bin/env python3
"""Pull the volunteer zones from map.svg into model.json.

    python3 read-zones.py [--check | --write]

The sixth reader of the lost SVG pipeline. A `z-<letter>` layer is one of the
organisation's zones A-F, traced by Erick from their 'Venue General Layout'
slide. The viewer paints them as flat tinted ground, and the volunteer layer
answers "which zone is this post in" by point-in-polygon on them — the zone is
never a field, so this polygon IS the assignment.

Unlike read-areas.py this REPLACES rather than extends: a zone that is traced
again has moved on purpose, and keeping the old outline would keep the old
assignment. The letter is the key and the colour comes from the fill.

    --check   read the SVG, say which zones changed, write nothing
    --write   put the zones from the SVG into model.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('read_svg', here / 'read-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)


def read(svg):
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
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    svg = read(here / 'map.svg')
    old = {z['zid']: z for z in model.get('zones', [])}

    changed = {}
    for zid, z in sorted(svg.items()):
        v = old.get(zid)
        if v is None:
            changed[zid] = 'new'
        elif v['poly'] != z['poly'] or v.get('color') != z['color']:
            changed[zid] = (f'{len(v["poly"])} -> {len(z["poly"])} vertices, '
                            f'{abs(L.area([tuple(p) for p in v["poly"]])):.0f} -> {z["area"]:.0f} m2')
    gone = sorted(set(old) - set(svg))

    print(f'{len(svg)} zones read from the SVG, {len(old)} in the model')
    for zid, what in changed.items():
        print(f'  changed {zid}: {what}')
    for zid in gone:
        print(f'  gone {zid}: it is in the model and no longer in the SVG')
    if not changed and not gone:
        print('  no changes')

    if mode == '--write':
        model['zones'] = [{'zid': z['zid'], 'color': z['color'], 'poly': z['poly']}
                           for _, z in sorted(svg.items())]
        for zid in svg:
            model['names'].setdefault('z-' + zid, 'z-' + zid)
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated' if (changed or gone) else 'nothing to change')
    else:
        print('(--check: nothing written)')


if __name__ == '__main__':
    main()
