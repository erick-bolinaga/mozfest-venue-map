#!/usr/bin/env python3
"""Pull the entrances from map.svg into model.json.

    python3 read-entrances.py [--check | --write]

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
spec = importlib.util.spec_from_file_location('read_svg', here / 'read-svg.py')
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


def label_of(raw, slug):
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


def read(svg, model):
    buildings = {}                              # building id -> its footprints
    for v in model['vols']:
        if v.get('kind') == 'reference' or 'reference' in v['id']:
            continue
        buildings.setdefault(v.get('of') or v['id'], []).append(v['poly'])
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
            cands = [b for b in buildings if slug in b]
            if cands:
                of = min(cands, key=lambda b: min(_poly_d((cx, cy), poly) for poly in buildings[b]))
        out.append({'id': eid, 'of': of, 'x': round(cx, 2), 'z': round(cy, 2),
                    'label': label_of(raw, slug)})
    return sorted(out, key=lambda e: e['id'])


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    new = read(here / 'map.svg', model)
    old = {e['id']: e for e in model.get('entrances', [])}

    print(f'{len(new)} entrances read from the SVG, {len(old)} in the model')
    venue_doors = [e['id'] for e in new if not e['of']]
    print(f'  the venue\'s (no building): {", ".join(venue_doors) or "none"}')
    changes = 0
    for e in new:
        v = old.get(e['id'])
        if v is None:
            changes += 1; print(f'  new     {e["id"]:44s} ({e["x"]:6.1f}, {e["z"]:6.1f})  {e["of"] or "venue"}')
        elif v != e:
            changes += 1; print(f'  changed {e["id"]:44s} ({e["x"]:6.1f}, {e["z"]:6.1f})  {e["of"] or "venue"}')
    for k in sorted(set(old) - {e['id'] for e in new}):
        changes += 1; print(f'  gone {k}')
    if not changes:
        print('  no changes')

    if mode == '--write':
        model['entrances'] = new
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated' if changes else 'nothing to change')
    else:
        print('(--check: nothing written)')


if __name__ == '__main__':
    main()
