#!/usr/bin/env python3
"""Pull the traced footprints from mapa.svg into modelo.json: `vols` and `roofs`.

    python3 leer-volumenes.py [--check | --write | --sembrar]

The last piece of the lost SVG pipeline. The SVG holds the footprints — every
`b-`, `p-b-` and `t-b-` layer — and NOTHING else: no heights, no roof types.
Those were data in the lost code, so now they are data in volumenes.json,
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
volumenes.json with `forma` and no layer in the SVG. Today there is one kind,
`capsula` — a rectangle whose short ends are full semicircles — for the
structure on the roof of b-refence-e. It is computed from its building's
footprint (a share of its length and width, pushed toward a corner with a
margin), so it follows the building when that is retraced, and a re-export
from Figma cannot lose it. Its base is the top of the building unless given.

Identity is the layer name. `p-b-<building>-<part>` belongs to the LONGEST
`b-` layer that prefixes it — `p-b-rosa-lobby-main` is Rosa's lobby, not
Rosa — and once a building has parts its own body is not drawn, unless every
part says `anadido` (the canopy of Can Fontanet adds to the hall, it does not
replace it). `t-b-<building>-<n>` is a roof drawn over a single volume.

    --check    read the SVG, compare against modelo.json, change nothing
    --write    replace vols and roofs in modelo.json
    --sembrar  write volumenes.json from the model's current attributes, once

After --write, run leer-fachadas.py: openings are positioned on the walls, and
the walls may have moved.
"""
import json, math, pathlib, re, statistics, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

ENGORDE = 0.30          # metres added to the mean vertex radius
DUPLICADO = 0.01        # vertices closer than this are one vertex (reference-d has a 2 mm pair)
# Per-volume attributes that live in volumenes.json, in the order the model writes them.
ATRIBUTOS = ['h', 'base', 'roof', 'rise', 'est', 'name', 'gable_toward', 'hip_inset',
             'low_toward', 'slope', 'hi']
ATRIBUTOS_CUBIERTA = ['y', 'rise', 'hip']


def depurar(P):
    """Drop repeated vertices, including a closing one equal to the first."""
    out = []
    for p in P:
        if not out or math.dist(p, out[-1]) > DUPLICADO:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) <= DUPLICADO:
        out.pop()
    return out


def engordar(P, d=ENGORDE):
    c = (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
    s = 1 + d / statistics.mean(math.dist(p, c) for p in P)
    return [(c[0] + s * (p[0] - c[0]), c[1] + s * (p[1] - c[1])) for p in P]


def capas(svg):
    """Every footprint layer, as {id: {'poly': [[x, z], ...], 'label': str}} in metres, fattened."""
    out = {}
    for s in L.shapes(ET.parse(svg).getroot()):
        raw = s.get('id') or ''
        cid = re.sub(r'\s*\(.*\)$', '', raw)
        if not re.match(r'(b|p-b|t-b)-', cid) or s.get('circle'):
            continue
        P = depurar([(x / L.PX_PER_M, y / L.PX_PER_M) for x, y in s['px']])
        if len(P) < 3:
            continue
        rot = re.search(r'\(([^)]*)\)', raw)
        out[cid] = {'poly': [[round(x, 3), round(z, 3)] for x, z in engordar(P)],
                    'label': rot.group(1) if rot else None}
    return out


def capsula(P, largo, ancho, hacia, margen, n=12):
    """A stadium shape inside footprint P: `largo` and `ancho` are shares of P's
    length and width, along P's longest edge; it sits `margen` metres in from
    the end and the side nearest the point `hacia`. Each round end is n segments."""
    k = max(range(len(P)), key=lambda i: math.dist(P[i], P[(i + 1) % len(P)]))
    a, b = P[k], P[(k + 1) % len(P)]
    L0 = math.dist(a, b)
    u = ((b[0] - a[0]) / L0, (b[1] - a[1]) / L0); v = (-u[1], u[0])
    pu = [p[0] * u[0] + p[1] * u[1] for p in P]; pv = [p[0] * v[0] + p[1] * v[1] for p in P]
    u0, u1, v0, v1 = min(pu), max(pu), min(pv), max(pv)
    cl, cw = largo * (u1 - u0), ancho * (v1 - v0)
    hu, hv = hacia[0] * u[0] + hacia[1] * u[1], hacia[0] * v[0] + hacia[1] * v[1]
    cu = u0 + margen + cl / 2 if abs(hu - u0) < abs(hu - u1) else u1 - margen - cl / 2
    cv = v0 + margen + cw / 2 if abs(hv - v0) < abs(hv - v1) else v1 - margen - cw / 2
    r = cw / 2
    out = []
    for extremo, sentido in ((cu + cl / 2 - r, 1), (cu - cl / 2 + r, -1)):
        for i in range(n + 1):
            t = -math.pi / 2 + math.pi * i / n
            du, dv = sentido * r * math.cos(t), sentido * r * math.sin(t)
            U, V = extremo + du, cv + dv
            out.append([round(U * u[0] + V * v[0], 3), round(U * u[1] + V * v[1], 3)])
    return out


def generadas(todo, mano):
    """Footprints computed from the hand file (`forma`), as capas() writes them."""
    out = {}
    for i, m in mano.items():
        f = m.get('forma')
        if not f:
            continue
        if f.get('tipo') != 'capsula':
            sys.exit(f'{i}: forma «{f.get("tipo")}» no existe; solo «capsula»')
        if f['sobre'] not in todo:
            sys.exit(f'{i}: se genera sobre «{f["sobre"]}», que no está en el SVG')
        if not i.startswith('p-' + f['sobre'] + '-'):
            sys.exit(f'{i}: una forma generada es una parte de su edificio: p-{f["sobre"]}-…')
        out[i] = {'poly': capsula(todo[f['sobre']]['poly'], f['largo'], f['ancho'], f['hacia'], f['margen']),
                  'label': None}
    return out


def padre_de(pid, edificios):
    """`p-b-rosa-lobby-main` → `b-rosa-lobby`: the longest building layer it extends."""
    cola = pid[2:]                                   # strip the `p-`
    cands = [b for b in edificios if cola.startswith(b + '-')]
    return max(cands, key=len) if cands else None


def construir(svg, mano):
    """vols and roofs from the SVG and the hand attributes. Stops on anything the
    hand file does not know, because the answer is a person's."""
    todo = capas(svg)
    todo.update(generadas(todo, mano))
    edificios = [i for i in todo if i.startswith('b-')]
    partes = {i: padre_de(i, edificios) for i in todo if i.startswith('p-b-')}
    huerfanas = [i for i, p in partes.items() if p is None]
    if huerfanas:
        sys.exit('partes sin edificio (no hay capa b- que las prefije): ' + ', '.join(huerfanas))
    faltan = [i for i in todo if i not in mano]
    # A building whose parts replace it needs no attributes of its own.
    sustituidos = {b for b in edificios if any(p == b and not mano.get(i, {}).get('anadido')
                                              for i, p in partes.items())}
    faltan = [i for i in faltan if i not in sustituidos]
    if faltan:
        sys.exit('volúmenes del SVG sin entrada en volumenes.json (alturas y cubierta van a mano): '
                 + ', '.join(sorted(faltan)))

    vols, roofs = [], []
    for cid, c in todo.items():
        if cid.startswith('t-b-'):
            of = padre_de('p-' + cid[2:], edificios)
            r = {'id': cid, 'of': of, 'poly': c['poly']}
            for k in ATRIBUTOS_CUBIERTA:
                if k in mano[cid]:
                    r[k] = mano[cid][k]
            roofs.append(r)
            continue
        if cid in sustituidos:
            continue
        es_parte = cid.startswith('p-b-')
        of = partes[cid] if es_parte else cid
        m = mano[cid]
        kind = m.get('kind') or (mano.get(of, {}).get('kind') if es_parte else None) or 'building'
        if es_parte and kind != 'reference':
            kind = 'part'
        v = {'id': cid, 'of': of if (es_parte or kind == 'building') else None, 'poly': c['poly']}
        if v['of'] is None:
            del v['of']
        for k in ATRIBUTOS:
            if k in m:
                v[k] = m[k]
        if m.get('forma') and 'base' not in m:
            v['base'] = mano[of]['h'] + mano[of].get('base', 0)    # sits on its building's roof
        v.setdefault('h', None)
        v['kind'] = kind
        v.setdefault('est', False)
        vols.append(v)
    return vols, roofs


def desvio(P, Q):
    """Largest vertex distance between two polygons, whatever their start or direction."""
    if len(P) != len(Q):
        return None
    P = [tuple(p) for p in P]; Q = [tuple(q) for q in Q]
    mejor = None
    for shift in range(len(P)):
        for rev in (False, True):
            R = (Q[::-1] if rev else Q); R = R[shift:] + R[:shift]
            e = max(math.dist(P[i], R[i]) for i in range(len(P)))
            if mejor is None or e < mejor:
                mejor = e
    return mejor


def comparar(nombre, nuevos, viejos):
    """Say what --write would change, in ids and centimetres."""
    vn = {v['id']: v for v in nuevos}; vv = {v['id']: v for v in viejos}
    entran = sorted(set(vn) - set(vv)); salen = sorted(set(vv) - set(vn))
    movidos, distintos = [], []
    for i in sorted(set(vn) & set(vv)):
        # The model that survived carries closing duplicates on a few polygons
        # (Viola) and a 2 mm pair snapped to one point (reference-d); the reader
        # writes them clean, so clean is what gets compared.
        d = desvio(vn[i]['poly'], depurar(vv[i]['poly']))
        if d is None:
            movidos.append(f'{i}: {len(depurar(vv[i]["poly"]))} → {len(vn[i]["poly"])} vértices')
        elif d > 0.01:
            movidos.append(f'{i}: {d * 100:.0f} cm')
        a = {k: x for k, x in vn[i].items() if k != 'poly' and x is not None}
        b = {k: x for k, x in vv[i].items() if k != 'poly' and x is not None}
        if a != b:
            distintos.append(f'{i}: ' + ', '.join(f'{k} {b.get(k)!r} → {a.get(k)!r}'
                                                   for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)))
    print(f'{nombre}: {len(nuevos)} en el SVG, {len(viejos)} en el modelo')
    for t, xs in (('entran', entran), ('salen', salen), ('se mueven', movidos), ('cambian de atributos', distintos)):
        print(f'  {t}: {len(xs)}')
        for x in xs[:20]:
            print(f'     {x}')
    return not (entran or salen or movidos or distintos)


def sembrar(modelo):
    salida = here / 'volumenes.json'
    if salida.exists():
        sys.exit(f'{salida.name} ya existe: se siembra una vez y luego se edita a mano')
    mano = {'_leeme': [
        'Lo que el SVG no sabe de cada volumen: altura, base, cubierta y su pico, si es',
        'referencia o edificio, y el nombre. A MANO, y a propósito: las alturas son a ojo.',
        '',
        "Clave = id de la capa del SVG (b-, p-b-, t-b-). 'kind' solo en capas b-:",
        "'building' o 'reference'; las partes lo heredan. 'anadido': true en una parte",
        'que se SUMA al cuerpo del edificio en vez de sustituirlo (la marquesina de Can',
        'Fontanet). Sin entrada aquí, leer-volumenes.py para.',
        '',
        "Las cubiertas t-b-: 'y' (altura del alero), 'rise' (pico), 'hip'.",
    ]}
    # A building replaced by its parts is not in the model, but its kind is
    # what the parts inherit: reference or building.
    ids = {v['id'] for v in modelo['vols']}
    for v in modelo['vols']:
        if v['id'].startswith('p-') and v.get('of') and v['of'] not in ids:
            mano.setdefault(v['of'], {'kind': 'reference' if v['kind'] == 'reference' else 'building'})
    for v in modelo['vols']:
        e = {}
        if not v['id'].startswith('p-'):
            e['kind'] = v['kind']
        for k in ATRIBUTOS:
            if v.get(k) is not None or k in ('h', 'base', 'roof', 'rise', 'est'):
                e[k] = v.get(k)
        mano[v['id']] = e
    # The one part that adds rather than replaces: its building is in the model too.
    for v in modelo['vols']:
        if v['kind'] == 'part' and any(b['id'] == v['of'] for b in modelo['vols']):
            mano[v['id']]['anadido'] = True
    for r in modelo['roofs']:
        mano[r['id']] = {k: r[k] for k in ATRIBUTOS_CUBIERTA if k in r}
    salida.write_text(json.dumps(mano, ensure_ascii=False, indent=1) + '\n')
    print(f'{salida.name}: {len(mano) - 1} entradas sembradas desde el modelo')


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    if modo == '--sembrar':
        return sembrar(modelo)
    mano_path = here / 'volumenes.json'
    if not mano_path.exists():
        sys.exit('falta volumenes.json: python3 leer-volumenes.py --sembrar lo escribe desde el modelo')
    mano = json.loads(mano_path.read_text()); mano.pop('_leeme', None)
    vols, roofs = construir(here / 'mapa.svg', mano)
    # Keep the model's order for what it already has: nothing downstream should
    # care, and a diff that only reorders is noise.
    orden = {v['id']: i for i, v in enumerate(modelo['vols'])}
    vols.sort(key=lambda v: orden.get(v['id'], len(orden)))
    orden_r = {r['id']: i for i, r in enumerate(modelo['roofs'])}
    roofs.sort(key=lambda r: orden_r.get(r['id'], len(orden_r)))

    igual = comparar('volúmenes', vols, modelo['vols'])
    igual = comparar('cubiertas', roofs, modelo['roofs']) and igual
    if modo == '--write':
        modelo['vols'] = vols; modelo['roofs'] = roofs
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado · ahora: python3 leer-fachadas.py --write')
    else:
        print('(--check: no se ha escrito nada)' + ('' if igual else ' · --write aplicaría lo de arriba'))


if __name__ == '__main__':
    main()
