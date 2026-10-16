#!/usr/bin/env python3
"""Pull the entrances from mapa.svg into modelo.json.

    python3 leer-entradas.py [--check | --write]

An `e-` layer is a door: the venue's own gates (`e-Main`, `e-Secondary`) and
the doors of each building (`e-aster-main`, `e-lotus-acces-recinte`). They were
traced from the start and never reached the model. What wants them now is the
volunteer layer: a post is named by what it stands next to, and eight of the
twelve Erick placed stand at a door.

A door is a point. Some are drawn as a tiny polygon and five as a circle; both
come out as their centre, in model metres. `of` is the building the door
belongs to, found by the slug in its name (`e-aster-…` is Àster's) and, when
one slug covers two buildings — Can Fontanet's lobby and museum — by which
footprint is nearer. A door with no building is the venue's.

REPLACES rather than extends: a door that was re-traced moved on purpose.
"""
import json, math, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)


def _seg(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _poly_d(p, poly):
    return min(_seg(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def etiqueta(raw, slug):
    """`e-aster-la-tempesta-indoor-outdoor-access` -> `La tempesta indoor outdoor access`.
    The bracket wins when there is one, the way it does everywhere else."""
    br = re.search(r'\(([^)]*)\)', raw)
    if br:
        return br.group(1).strip()
    s = re.sub(r'\s*\([^)]*\)', '', raw).strip()
    s = re.sub(r'^e-', '', s)
    if slug:
        s = re.sub(rf'^{re.escape(slug)}-?', '', s)
    s = s.replace('_', ' ').replace('-', ' ').strip()
    return (s[:1].upper() + s[1:]) if s else 'Door'


def leer(svg, modelo):
    casas = {}                              # building id -> its footprints
    for v in modelo['vols']:
        if v.get('kind') == 'reference' or 'reference' in v['id']:
            continue
        casas.setdefault(v.get('of') or v['id'], []).append(v['poly'])
    out = []
    for s in L.shapes(ET.parse(svg).getroot()):
        raw = s['id'] or ''
        if not raw.startswith('e-') or not s['px']:
            continue
        pts = [(x / L.PX_PER_M, y / L.PX_PER_M) for x, y in s['px']]
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        eid = re.sub(r'\s*\([^)]*\)', '', raw).strip()
        m = re.match(r'e-([a-z]+)-', eid)
        slug = m.group(1) if m else None
        of = None
        if slug:
            cands = [b for b in casas if slug in b]
            if cands:
                of = min(cands, key=lambda b: min(_poly_d((cx, cy), poly) for poly in casas[b]))
        out.append({'id': eid, 'of': of, 'x': round(cx, 2), 'z': round(cy, 2),
                    'label': etiqueta(raw, slug)})
    return sorted(out, key=lambda e: e['id'])


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    nuevas = leer(here / 'mapa.svg', modelo)
    viejas = {e['id']: e for e in modelo.get('entrances', [])}

    print(f'{len(nuevas)} entradas leidas del SVG, {len(viejas)} en el modelo')
    sin = [e['id'] for e in nuevas if not e['of']]
    print(f'  del recinto (sin edificio): {", ".join(sin) or "ninguna"}')
    cambios = 0
    for e in nuevas:
        v = viejas.get(e['id'])
        if v is None:
            cambios += 1; print(f'  nueva  {e["id"]:44s} ({e["x"]:6.1f}, {e["z"]:6.1f})  {e["of"] or "recinto"}')
        elif v != e:
            cambios += 1; print(f'  cambia {e["id"]:44s} ({e["x"]:6.1f}, {e["z"]:6.1f})  {e["of"] or "recinto"}')
    for k in sorted(set(viejas) - {e['id'] for e in nuevas}):
        cambios += 1; print(f'  desaparece {k}')
    if not cambios:
        print('  ninguna cambio')

    if modo == '--write':
        modelo['entrances'] = nuevas
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado' if cambios else 'nada que cambiar')
    else:
        print('(--check: no se ha escrito nada)')


if __name__ == '__main__':
    main()
