#!/usr/bin/env python3
"""Put the façades on the walls: facades.json + vols → `walls` and `openings`.

    python3 read-facades.py [--check | --write | --seed]

The SVG has no windows. A façade was a composition in the lost code — a rhythm
of holes on a wall, each with its joinery — and what survived of it was the
OUTPUT: 791 holes in `walls`, positioned along their wall, and 791 `openings`
frozen at world coordinates. Frozen is the problem: when the two parts of
Viola were nudged by hand, their 33 openings stayed where the old wall was,
11–22 cm off the new one. Nothing noticed.

So the façade becomes hand data, facades.json, and the world coordinates
become derived. A wall is `(vol, edge)`. Each of its holes says where it sits
ALONG the wall (`off`, from the edge's first vertex) and what it is (`w`, `h`,
`sill`, `arch`, `circle`, `semi`) and what joinery it carries (`label`,
`panes`, `door`, `fanlight`, `panelled`, `banded`, `rail`, `panel`, `frame`,
`fan`, `push`). From that and the volume's polygon this writes the two things
the viewer reads: `walls` (the holes, to cut the panels) and `openings` (the
joinery at its world position, facing out). The rule was measured back from
the model, not remembered: centre = a + u·(off + w/2), ON the wall line, with
n the outward normal by the polygon's winding. `push` is carried along as
data and not applied: the four openings that carry a real one (12 cm, the
corners of Espai Vertical) sit on their wall line in the model all the same,
and the viewer never reads it. 758 of the 791 came out to the millimetre; the
33 others were Viola's.

A re-traced building keeps its façades as long as its edges keep their count
and order. When they do not, this STOPS and says which wall no longer fits —
reassigning an edge is a decision for whoever traced, not for a script.

    --check    build from facades.json, compare against model.json, change nothing
    --write    replace walls and openings in model.json
    --seed  write facades.json from the model, once, pairing each opening
               with its hole

Run after read-volumes.py, always: the walls may have moved.
"""
import json, math, pathlib, sys

here = pathlib.Path(__file__).parent

HOLE_KEYS = ['off', 'w', 'h', 'sill', 'arch', 'circle', 'semi']
JOINERY_KEYS = ['label', 'panes', 'door', 'fanlight', 'panelled', 'banded', 'rail',
               'panel', 'frame', 'fan', 'push']
# The order the model writes an opening in, kept so a diff stays readable.
OPENING_KEYS = ['label', 'w', 'h', 'sill', 'arch', 'panes', 'door', 'fanlight', 'panelled', 'banded',
         'rail', 'circle', 'semi', 'panel', 'frame', 'fan', 'x', 'z', 'nx', 'nz', 'push']
# A hole may overrun its wall by this much before it "does not fit". Not zero:
# the corner windows of Espai Vertical overrun theirs by 14–17 cm and always
# have, and they read fine. Beyond this, an edge has moved.
CLEARANCE = 0.20


def edge(P, i):
    """Start, unit direction, length and outward normal of edge i of polygon P."""
    n = len(P)
    a, b = P[i], P[(i + 1) % n]
    l = math.dist(a, b)
    ux, uz = (b[0] - a[0]) / l, (b[1] - a[1]) / l
    area2 = sum(P[k][0] * P[(k + 1) % n][1] - P[(k + 1) % n][0] * P[k][1] for k in range(n))
    nx, nz = (uz, -ux) if area2 > 0 else (-uz, ux)
    return a, (ux, uz), l, (nx, nz)


def build(facades, vols):
    """walls and openings from the hand file and the current polygons."""
    walls, openings, bad = [], [], []
    for f in facades:
        v = vols.get(f['vol'])
        if v is None:
            bad.append(f"{f['vol']}: the volume no longer exists"); continue
        P = v['poly']
        if not 0 <= f['edge'] < len(P):
            bad.append(f"{f['vol']} edge {f['edge']}: the polygon has {len(P)} edges"); continue
        a, (ux, uz), l, (nx, nz) = edge(P, f['edge'])
        if l < 0.15:
            bad.append(f"{f['vol']} edge {f['edge']}: it is {l:.2f} m long"); continue
        overrun = [h for h in f['holes'] if h['off'] < -CLEARANCE or h['off'] + h['w'] > l + CLEARANCE]
        if overrun:
            bad.append(f"{f['vol']} edge {f['edge']}: it is {l:.2f} m long and {len(overrun)} opening(s) "
                         f"do not fit (up to {max(h['off'] + h['w'] for h in overrun):.2f} m)")
            continue
        walls.append({'vol': f['vol'], 'edge': f['edge'], 'len': round(l, 3),
                      'holes': [{k: h.get(k) for k in HOLE_KEYS} for h in f['holes']],
                      'profile': f.get('profile')})
        for h in f['holes']:
            t = h['off'] + h['w'] / 2
            o = {k: h.get(k) for k in OPENING_KEYS if k not in ('x', 'z', 'nx', 'nz')}
            o['x'] = round(a[0] + ux * t, 3)
            o['z'] = round(a[1] + uz * t, 3)
            o['nx'] = round(nx, 4); o['nz'] = round(nz, 4)
            o['push'] = h.get('push') or 0.0
            openings.append({k: o[k] for k in OPENING_KEYS})
    if bad:
        sys.exit('facades.json does not fit the current volumes:\n  ' + '\n  '.join(bad)
                 + '\n  Reassigning the edge is for whoever traced it; the reader does not guess.')
    return walls, openings


def pair_up(model):
    """Every opening to its hole. Same size, same sill, on the same wall line — by
    the outward normal and the position along the edge; the distance OFF the
    wall is not required to be zero, because Viola's 33 sit 11–22 cm off theirs
    and this is exactly how they get back on."""
    vols = {v['id']: v for v in model['vols']}
    free = {}
    for wi, w in enumerate(model['walls']):
        for hi, h in enumerate(w['holes']):
            free[(wi, hi)] = h
    pairs, unpaired = {}, []
    for oi, o in enumerate(model['openings']):
        best = None
        for (wi, hi), h in free.items():
            if abs(h['w'] - o['w']) > 1e-3 or abs(h['h'] - o['h']) > 1e-3 or abs(h['sill'] - o['sill']) > 1e-3:
                continue
            w = model['walls'][wi]
            a, (ux, uz), l, (nx, nz) = edge(vols[w['vol']]['poly'], w['edge'])
            if nx * o['nx'] + nz * o['nz'] < 0.99:
                continue
            t = h['off'] + h['w'] / 2
            cx, cz = a[0] + ux * t, a[1] + uz * t
            along = (o['x'] - cx) * ux + (o['z'] - cz) * uz        # along the wall
            off_wall = (o['x'] - cx) * nx + (o['z'] - cz) * nz       # off the wall
            if abs(along) < 0.02 and abs(off_wall) < 0.5:
                if best is None or abs(off_wall) < best[0]:
                    best = (abs(off_wall), wi, hi)
        if best is None:
            unpaired.append(f"{o.get('label')} at ({o['x']}, {o['z']})"); continue
        pairs[oi] = (best[1], best[2]); del free[best[1:]]
    if unpaired or free:
        sys.exit(f'could not pair {len(unpaired)} openings with their holes '
                 f'({len(free)} holes without an opening): ' + '; '.join(unpaired[:8]))
    return pairs


def seed(model):
    out_path = here / 'facades.json'
    if out_path.exists():
        sys.exit(f'{out_path.name} already exists: it is seeded once and then edited by hand')
    pairs = pair_up(model)
    by_wall = {}
    for oi, (wi, hi) in pairs.items():
        by_wall.setdefault(wi, {})[hi] = model['openings'][oi]
    facades = []
    for wi, w in enumerate(model['walls']):
        holes = []
        for hi, h in enumerate(w['holes']):
            o = by_wall.get(wi, {}).get(hi, {})
            e = {k: h.get(k) for k in HOLE_KEYS}
            for k in JOINERY_KEYS:
                if o.get(k) is not None:
                    e[k] = o[k]
            holes.append(e)
        facades.append({'vol': w['vol'], 'edge': w['edge'], 'profile': w.get('profile'), 'holes': holes})
    doc = {'_readme': [
        'Las fachadas: qué huecos lleva cada muro y con qué carpintería. A MANO, y a',
        'propósito: el SVG no tiene ventanas, y el código que las componía se perdió.',
        '',
        "Un muro es (vol, edge): el volumen y el índice de su arista, contando desde el",
        "primer vértice del polígono. Cada hueco dice dónde está A LO LARGO del muro",
        "('off', en metros desde el primer vértice de la arista), qué es ('w', 'h',",
        "'sill', 'arch', 'circle', 'semi') y qué carpintería lleva ('label', 'panes',",
        "'door', 'fanlight', 'panelled', 'banded', 'rail', 'panel', 'frame', 'fan',",
        "'push'). Las coordenadas en el mundo NO se escriben: las calcula",
        'read-facades.py del polígono de ahora, y así un edificio retrazado se lleva',
        'sus ventanas consigo. Si una arista deja de existir o los huecos no caben,',
        'el lector para y dice cuál.',
        '',
        "'profile' es el perfil de hastial del muro (eave, apex, flat), o null.",
    ], 'walls': facades}
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    print(f'{out_path.name}: {len(facades)} walls, {sum(len(f["holes"]) for f in facades)} openings, '
          f'seeded from the model')


def compare_walls(walls, old):
    a = {(w['vol'], w['edge']): w for w in walls}; b = {(w['vol'], w['edge']): w for w in old}
    added = sorted(set(a) - set(b)); removed = sorted(set(b) - set(a))
    changed = [k for k in sorted(set(a) & set(b))
                 if a[k]['holes'] != b[k]['holes'] or a[k].get('profile') != b[k].get('profile')
                 or abs(a[k]['len'] - b[k]['len']) > 0.01]
    print(f'walls: {len(walls)} new, {len(old)} in the model · added {len(added)} · removed {len(removed)} '
          f'· changed {len(changed)}')
    for k in (added + removed + changed)[:10]:
        print(f'     {k[0]} edge {k[1]}')
    return not (added or removed or changed)


def compare_openings(openings, old):
    """Each new opening against the nearest old one of its kind — label, size,
    sill — because the lists are in different orders and a re-derived opening
    is the same opening a few centimetres over."""
    def opening_class(o): return (o.get('label'), round(o['w'], 3), round(o['h'], 3), round(o['sill'], 3))
    free = {}
    for o in old:
        free.setdefault(opening_class(o), []).append(o)
    moved, unpaired, changed = [], 0, 0
    for o in openings:
        cands = free.get(opening_class(o)) or []
        if not cands:
            unpaired += 1; continue
        v = min(cands, key=lambda q: math.dist((o['x'], o['z']), (q['x'], q['z'])))
        cands.remove(v)
        d = math.dist((o['x'], o['z']), (v['x'], v['z']))
        if d > 0.01:
            moved.append((o.get('label'), d))
        if {k: x for k, x in o.items() if k not in ('x', 'z', 'nx', 'nz')} != \
           {k: x for k, x in v.items() if k not in ('x', 'z', 'nx', 'nz')}:
            changed += 1
    left_over = sum(len(c) for c in free.values())
    print(f'openings: {len(openings)} new, {len(old)} in the model · unpaired {unpaired} · left over {left_over} '
          f'· moved more than 1 cm: {len(moved)} · attributes changed: {changed}')
    by_label = {}
    for l, d in moved:
        by_label.setdefault(l, []).append(d)
    for l, ds in sorted(by_label.items(), key=lambda x: -len(x[1]))[:8]:
        print(f'     {l}: {len(ds)}, from {min(ds) * 100:.0f} to {max(ds) * 100:.0f} cm')
    return not (moved or unpaired or left_over or changed)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    if mode == '--seed':
        return seed(model)
    path = here / 'facades.json'
    if not path.exists():
        sys.exit('facades.json is missing: python3 read-facades.py --seed writes it from the model')
    facades = json.loads(path.read_text())['walls']
    vols = {v['id']: v for v in model['vols']}
    walls, openings = build(facades, vols)
    same = compare_walls(walls, model['walls'])
    same = compare_openings(openings, model['openings']) and same
    if mode == '--write':
        model['walls'] = walls; model['openings'] = openings
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated')
    else:
        print('(--check: nothing written)' + ('' if same else ' · --write would apply the above'))


if __name__ == '__main__':
    main()
