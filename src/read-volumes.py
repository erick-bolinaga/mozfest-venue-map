#!/usr/bin/env python3
"""Pull the traced footprints from map.svg into model.json: `vols` and `roofs`.

    python3 read-volumes.py [--check | --write | --seed]

The last piece of the lost SVG pipeline. The SVG holds the footprints — every
`b-`, `p-b-` and `t-b-` layer — and NOTHING else: no heights, no roof types.
Those were data in the lost code, so now they are data in volumes.json,
written by hand and seeded once from the model that survived. A footprint
without an entry there stops the build: heights are guessed by a person, not
by a script.

What the lost code did to a footprint was measured back from the model on
2026-09-14, not remembered: every polygon is scaled about the mean of its
vertices so that the mean vertex radius grows by 0.30 m. That is "the 30 cm
fattening" that closes the joints between volumes. It reproduces 48 of the 50
volumes to under a centimetre; the two parts of Viola had been nudged by hand
afterwards (5–7 cm) and this puts them back where the SVG says.

A part the SVG cannot hold well can be GENERATED instead: an entry in
volumes.json with `shape` and no layer in the SVG. Today there is one type,
`capsula` — a rectangle whose short ends are full semicircles — for the
structure on the roof of b-refence-e. It is computed from its building's
footprint (a share of its length and width, pushed toward a corner with a
margin), so it follows the building when that is retraced, and a re-export
from Figma cannot lose it. Its base is the top of the building unless given.

Identity is the layer name. `p-b-<building>-<part>` belongs to the LONGEST
`b-` layer that prefixes it — `p-b-rosa-lobby-main` is Rosa's lobby, not
Rosa — and once a building has parts its own body is not drawn, unless every
part says `added` (the canopy of Can Fontanet adds to the hall, it does not
replace it). `t-b-<building>-<n>` is a roof drawn over a single volume.

    --check    read the SVG, compare against model.json, change nothing
    --write    replace vols and roofs in model.json
    --seed  write volumes.json from the model's current attributes, once

After --write, run read-facades.py: openings are positioned on the walls, and
the walls may have moved.
"""
import json, math, pathlib, re, statistics, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('read_svg', here / 'read-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

FATTENING = 0.30          # metres added to the mean vertex radius
DUPLICATE = 0.01        # vertices closer than this are one vertex (reference-d has a 2 mm pair)
# Per-volume attributes that live in volumes.json, in the order the model writes them.
ATTRIBUTES = ['h', 'base', 'roof', 'rise', 'est', 'name', 'gable_toward', 'hip_inset',
             'low_toward', 'slope', 'hi']
ROOF_ATTRIBUTES = ['y', 'rise', 'hip']


def dedupe(P):
    """Drop repeated vertices, including a closing one equal to the first."""
    out = []
    for p in P:
        if not out or math.dist(p, out[-1]) > DUPLICATE:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) <= DUPLICATE:
        out.pop()
    return out


def fatten(P, d=FATTENING):
    c = (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
    s = 1 + d / statistics.mean(math.dist(p, c) for p in P)
    return [(c[0] + s * (p[0] - c[0]), c[1] + s * (p[1] - c[1])) for p in P]


def layers(svg):
    """Every footprint layer, as {id: {'poly': [[x, z], ...], 'label': str}} in metres, fattened."""
    out = {}
    for s in L.shapes(ET.parse(svg).getroot()):
        raw = s.get('id') or ''
        cid = re.sub(r'\s*\(.*\)$', '', raw)
        if not re.match(r'(b|p-b|t-b)-', cid) or s.get('circle'):
            continue
        P = dedupe([(x / L.PX_PER_M, y / L.PX_PER_M) for x, y in s['px']])
        if len(P) < 3:
            continue
        bracket = re.search(r'\(([^)]*)\)', raw)
        out[cid] = {'poly': [[round(x, 3), round(z, 3)] for x, z in fatten(P)],
                    'label': bracket.group(1) if bracket else None}
    return out


def capsule(P, length, width, towards, margin, n=12):
    """A stadium shape inside footprint P: `length` and `width` are shares of P's
    length and width, along P's longest edge; it sits `margin` metres in from
    the end and the side nearest the point `towards`. Each round end is n segments."""
    k = max(range(len(P)), key=lambda i: math.dist(P[i], P[(i + 1) % len(P)]))
    a, b = P[k], P[(k + 1) % len(P)]
    L0 = math.dist(a, b)
    u = ((b[0] - a[0]) / L0, (b[1] - a[1]) / L0); v = (-u[1], u[0])
    pu = [p[0] * u[0] + p[1] * u[1] for p in P]; pv = [p[0] * v[0] + p[1] * v[1] for p in P]
    u0, u1, v0, v1 = min(pu), max(pu), min(pv), max(pv)
    cl, cw = length * (u1 - u0), width * (v1 - v0)
    hu, hv = towards[0] * u[0] + towards[1] * u[1], towards[0] * v[0] + towards[1] * v[1]
    cu = u0 + margin + cl / 2 if abs(hu - u0) < abs(hu - u1) else u1 - margin - cl / 2
    cv = v0 + margin + cw / 2 if abs(hv - v0) < abs(hv - v1) else v1 - margin - cw / 2
    r = cw / 2
    out = []
    for end, direction in ((cu + cl / 2 - r, 1), (cu - cl / 2 + r, -1)):
        for i in range(n + 1):
            t = -math.pi / 2 + math.pi * i / n
            du, dv = direction * r * math.cos(t), direction * r * math.sin(t)
            U, V = end + du, cv + dv
            out.append([round(U * u[0] + V * v[0], 3), round(U * u[1] + V * v[1], 3)])
    return out


def generated(all_layers, hand):
    """Footprints computed from the hand file (`shape`), as layers() writes them."""
    out = {}
    for i, m in hand.items():
        f = m.get('shape')
        if not f:
            continue
        if f.get('type') != 'capsule':
            sys.exit(f'{i}: shape «{f.get("type")}» does not exist; only «capsula»')
        if f['on'] not in all_layers:
            sys.exit(f'{i}: it is generated on «{f["on"]}», which is not in the SVG')
        if not i.startswith('p-' + f['on'] + '-'):
            sys.exit(f'{i}: a generated shape is a part of its building: p-{f["on"]}-…')
        out[i] = {'poly': capsule(all_layers[f['on']]['poly'], f['length'], f['width'], f['towards'], f['margin']),
                  'label': None}
    return out


def parent_of(pid, buildings):
    """`p-b-rosa-lobby-main` → `b-rosa-lobby`: the longest building layer it extends."""
    tail = pid[2:]                                   # strip the `p-`
    cands = [b for b in buildings if tail.startswith(b + '-')]
    return max(cands, key=len) if cands else None


def build(svg, hand):
    """vols and roofs from the SVG and the hand attributes. Stops on anything the
    hand file does not know, because the answer is a person's."""
    all_layers = layers(svg)
    all_layers.update(generated(all_layers, hand))
    buildings = [i for i in all_layers if i.startswith('b-')]
    parts = {i: parent_of(i, buildings) for i in all_layers if i.startswith('p-b-')}
    orphans = [i for i, p in parts.items() if p is None]
    if orphans:
        sys.exit('parts with no building (no b- layer prefixes them): ' + ', '.join(orphans))
    missing = [i for i in all_layers if i not in hand]
    # A building whose parts replace it needs no attributes of its own.
    replaced = {b for b in buildings if any(p == b and not hand.get(i, {}).get('added')
                                              for i, p in parts.items())}
    missing = [i for i in missing if i not in replaced]
    if missing:
        sys.exit('SVG volumes with no entry in volumes.json (heights and roof go by hand): '
                 + ', '.join(sorted(missing)))

    vols, roofs = [], []
    for cid, c in all_layers.items():
        if cid.startswith('t-b-'):
            of = parent_of('p-' + cid[2:], buildings)
            r = {'id': cid, 'of': of, 'poly': c['poly']}
            for k in ROOF_ATTRIBUTES:
                if k in hand[cid]:
                    r[k] = hand[cid][k]
            roofs.append(r)
            continue
        if cid in replaced:
            continue
        is_part = cid.startswith('p-b-')
        of = parts[cid] if is_part else cid
        m = hand[cid]
        kind = m.get('kind') or (hand.get(of, {}).get('kind') if is_part else None) or 'building'
        if is_part and kind != 'reference':
            kind = 'part'
        v = {'id': cid, 'of': of if (is_part or kind == 'building') else None, 'poly': c['poly']}
        if v['of'] is None:
            del v['of']
        for k in ATTRIBUTES:
            if k in m:
                v[k] = m[k]
        if m.get('shape') and 'base' not in m:
            v['base'] = hand[of]['h'] + hand[of].get('base', 0)    # sits on its building's roof
        v.setdefault('h', None)
        v['kind'] = kind
        v.setdefault('est', False)
        vols.append(v)
    return vols, roofs


def deviation(P, Q):
    """Largest vertex distance between two polygons, whatever their start or direction."""
    if len(P) != len(Q):
        return None
    P = [tuple(p) for p in P]; Q = [tuple(q) for q in Q]
    best = None
    for shift in range(len(P)):
        for rev in (False, True):
            R = (Q[::-1] if rev else Q); R = R[shift:] + R[:shift]
            e = max(math.dist(P[i], R[i]) for i in range(len(P)))
            if best is None or e < best:
                best = e
    return best


def compare(what, new, old):
    """Say what --write would change, in ids and centimetres."""
    vn = {v['id']: v for v in new}; vv = {v['id']: v for v in old}
    added = sorted(set(vn) - set(vv)); removed = sorted(set(vv) - set(vn))
    moved, changed = [], []
    for i in sorted(set(vn) & set(vv)):
        # The model that survived carries closing duplicates on a few polygons
        # (Viola) and a 2 mm pair snapped to one point (reference-d); the reader
        # writes them clean, so clean is what gets compared.
        d = deviation(vn[i]['poly'], dedupe(vv[i]['poly']))
        if d is None:
            moved.append(f'{i}: {len(dedupe(vv[i]["poly"]))} → {len(vn[i]["poly"])} vertices')
        elif d > 0.01:
            moved.append(f'{i}: {d * 100:.0f} cm')
        a = {k: x for k, x in vn[i].items() if k != 'poly' and x is not None}
        b = {k: x for k, x in vv[i].items() if k != 'poly' and x is not None}
        if a != b:
            changed.append(f'{i}: ' + ', '.join(f'{k} {b.get(k)!r} → {a.get(k)!r}'
                                                   for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)))
    print(f'{what}: {len(new)} in the SVG, {len(old)} in the model')
    for t, xs in (('added', added), ('removed', removed), ('moved', moved), ('attributes changed', changed)):
        print(f'  {t}: {len(xs)}')
        for x in xs[:20]:
            print(f'     {x}')
    return not (added or removed or moved or changed)


def seed(model):
    out_path = here / 'volumes.json'
    if out_path.exists():
        sys.exit(f'{out_path.name} already exists: it is seeded once and then edited by hand')
    hand = {'_readme': [
        'Lo que el SVG no sabe de cada volumen: altura, base, cubierta y su pico, si es',
        'referencia o edificio, y el nombre. A MANO, y a propósito: las alturas son a ojo.',
        '',
        "Clave = id de la capa del SVG (b-, p-b-, t-b-). 'kind' solo en capas b-:",
        "'building' o 'reference'; las partes lo heredan. 'added': true en una parte",
        'que se SUMA al cuerpo del edificio en vez de sustituirlo (la marquesina de Can',
        'Fontanet). Sin entrada aquí, read-volumes.py para.',
        '',
        "Las cubiertas t-b-: 'y' (altura del alero), 'rise' (pico), 'hip'.",
    ]}
    # A building replaced by its parts is not in the model, but its kind is
    # what the parts inherit: reference or building.
    ids = {v['id'] for v in model['vols']}
    for v in model['vols']:
        if v['id'].startswith('p-') and v.get('of') and v['of'] not in ids:
            hand.setdefault(v['of'], {'kind': 'reference' if v['kind'] == 'reference' else 'building'})
    for v in model['vols']:
        e = {}
        if not v['id'].startswith('p-'):
            e['kind'] = v['kind']
        for k in ATTRIBUTES:
            if v.get(k) is not None or k in ('h', 'base', 'roof', 'rise', 'est'):
                e[k] = v.get(k)
        hand[v['id']] = e
    # The one part that adds rather than replaces: its building is in the model too.
    for v in model['vols']:
        if v['kind'] == 'part' and any(b['id'] == v['of'] for b in model['vols']):
            hand[v['id']]['added'] = True
    for r in model['roofs']:
        hand[r['id']] = {k: r[k] for k in ROOF_ATTRIBUTES if k in r}
    out_path.write_text(json.dumps(hand, ensure_ascii=False, indent=1) + '\n')
    print(f'{out_path.name}: {len(hand) - 1} entries seeded from the model')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    if mode == '--seed':
        return seed(model)
    hand_path = here / 'volumes.json'
    if not hand_path.exists():
        sys.exit('volumes.json is missing: python3 read-volumes.py --seed writes it from the model')
    hand = json.loads(hand_path.read_text()); hand.pop('_readme', None)
    vols, roofs = build(here / 'map.svg', hand)
    # Keep the model's order for what it already has: nothing downstream should
    # care, and a diff that only reorders is noise.
    order = {v['id']: i for i, v in enumerate(model['vols'])}
    vols.sort(key=lambda v: order.get(v['id'], len(order)))
    roof_order = {r['id']: i for i, r in enumerate(model['roofs'])}
    roofs.sort(key=lambda r: roof_order.get(r['id'], len(roof_order)))

    same = compare('volumes', vols, model['vols'])
    same = compare('roofs', roofs, model['roofs']) and same
    if mode == '--write':
        model['vols'] = vols; model['roofs'] = roofs
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated · now: python3 read-facades.py --write')
    else:
        print('(--check: nothing written)' + ('' if same else ' · --write would apply the above'))


if __name__ == '__main__':
    main()
