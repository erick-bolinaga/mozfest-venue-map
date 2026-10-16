#!/usr/bin/env python3
"""Put the façades on the walls: fachadas.json + vols → `walls` and `openings`.

    python3 leer-fachadas.py [--check | --write | --sembrar]

The SVG has no windows. A façade was a composition in the lost code — a rhythm
of holes on a wall, each with its joinery — and what survived of it was the
OUTPUT: 791 holes in `walls`, positioned along their wall, and 791 `openings`
frozen at world coordinates. Frozen is the problem: when the two parts of
Viola were nudged by hand, their 33 openings stayed where the old wall was,
11–22 cm off the new one. Nothing noticed.

So the façade becomes hand data, fachadas.json, and the world coordinates
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

    --check    build from fachadas.json, compare against modelo.json, change nothing
    --write    replace walls and openings in modelo.json
    --sembrar  write fachadas.json from the model, once, pairing each opening
               with its hole

Run after leer-volumenes.py, always: the walls may have moved.
"""
import json, math, pathlib, sys

here = pathlib.Path(__file__).parent

AGUJERO = ['off', 'w', 'h', 'sill', 'arch', 'circle', 'semi']
CARPINTERIA = ['label', 'panes', 'door', 'fanlight', 'panelled', 'banded', 'rail',
               'panel', 'frame', 'fan', 'push']
# The order the model writes an opening in, kept so a diff stays readable.
HUECO = ['label', 'w', 'h', 'sill', 'arch', 'panes', 'door', 'fanlight', 'panelled', 'banded',
         'rail', 'circle', 'semi', 'panel', 'frame', 'fan', 'x', 'z', 'nx', 'nz', 'push']
# A hole may overrun its wall by this much before it "does not fit". Not zero:
# the corner windows of Espai Vertical overrun theirs by 14–17 cm and always
# have, and they read fine. Beyond this, an edge has moved.
HOLGURA = 0.20


def arista(P, i):
    """Start, unit direction, length and outward normal of edge i of polygon P."""
    n = len(P)
    a, b = P[i], P[(i + 1) % n]
    l = math.dist(a, b)
    ux, uz = (b[0] - a[0]) / l, (b[1] - a[1]) / l
    area2 = sum(P[k][0] * P[(k + 1) % n][1] - P[(k + 1) % n][0] * P[k][1] for k in range(n))
    nx, nz = (uz, -ux) if area2 > 0 else (-uz, ux)
    return a, (ux, uz), l, (nx, nz)


def construir(fachadas, vols):
    """walls and openings from the hand file and the current polygons."""
    walls, openings, malos = [], [], []
    for f in fachadas:
        v = vols.get(f['vol'])
        if v is None:
            malos.append(f"{f['vol']}: el volumen ya no existe"); continue
        P = v['poly']
        if not 0 <= f['edge'] < len(P):
            malos.append(f"{f['vol']} arista {f['edge']}: el polígono tiene {len(P)} aristas"); continue
        a, (ux, uz), l, (nx, nz) = arista(P, f['edge'])
        if l < 0.15:
            malos.append(f"{f['vol']} arista {f['edge']}: mide {l:.2f} m"); continue
        fuera = [h for h in f['holes'] if h['off'] < -HOLGURA or h['off'] + h['w'] > l + HOLGURA]
        if fuera:
            malos.append(f"{f['vol']} arista {f['edge']}: mide {l:.2f} m y {len(fuera)} hueco(s) "
                         f"no caben (hasta {max(h['off'] + h['w'] for h in fuera):.2f} m)")
            continue
        walls.append({'vol': f['vol'], 'edge': f['edge'], 'len': round(l, 3),
                      'holes': [{k: h.get(k) for k in AGUJERO} for h in f['holes']],
                      'profile': f.get('profile')})
        for h in f['holes']:
            t = h['off'] + h['w'] / 2
            o = {k: h.get(k) for k in HUECO if k not in ('x', 'z', 'nx', 'nz')}
            o['x'] = round(a[0] + ux * t, 3)
            o['z'] = round(a[1] + uz * t, 3)
            o['nx'] = round(nx, 4); o['nz'] = round(nz, 4)
            o['push'] = h.get('push') or 0.0
            openings.append({k: o[k] for k in HUECO})
    if malos:
        sys.exit('fachadas.json no encaja con los volúmenes de ahora:\n  ' + '\n  '.join(malos)
                 + '\n  Reasignar la arista es cosa de quien trazó; el lector no adivina.')
    return walls, openings


def emparejar(modelo):
    """Every opening to its hole. Same size, same sill, on the same wall line — by
    the outward normal and the position along the edge; the distance OFF the
    wall is not required to be zero, because Viola's 33 sit 11–22 cm off theirs
    and this is exactly how they get back on."""
    vols = {v['id']: v for v in modelo['vols']}
    libres = {}
    for wi, w in enumerate(modelo['walls']):
        for hi, h in enumerate(w['holes']):
            libres[(wi, hi)] = h
    pares, sueltos = {}, []
    for oi, o in enumerate(modelo['openings']):
        mejor = None
        for (wi, hi), h in libres.items():
            if abs(h['w'] - o['w']) > 1e-3 or abs(h['h'] - o['h']) > 1e-3 or abs(h['sill'] - o['sill']) > 1e-3:
                continue
            w = modelo['walls'][wi]
            a, (ux, uz), l, (nx, nz) = arista(vols[w['vol']]['poly'], w['edge'])
            if nx * o['nx'] + nz * o['nz'] < 0.99:
                continue
            t = h['off'] + h['w'] / 2
            cx, cz = a[0] + ux * t, a[1] + uz * t
            lado = (o['x'] - cx) * ux + (o['z'] - cz) * uz        # along the wall
            fuera = (o['x'] - cx) * nx + (o['z'] - cz) * nz       # off the wall
            if abs(lado) < 0.02 and abs(fuera) < 0.5:
                if mejor is None or abs(fuera) < mejor[0]:
                    mejor = (abs(fuera), wi, hi)
        if mejor is None:
            sueltos.append(f"{o.get('label')} en ({o['x']}, {o['z']})"); continue
        pares[oi] = (mejor[1], mejor[2]); del libres[mejor[1:]]
    if sueltos or libres:
        sys.exit(f'no se han podido emparejar {len(sueltos)} huecos con sus agujeros '
                 f'({len(libres)} agujeros sin hueco): ' + '; '.join(sueltos[:8]))
    return pares


def sembrar(modelo):
    salida = here / 'fachadas.json'
    if salida.exists():
        sys.exit(f'{salida.name} ya existe: se siembra una vez y luego se edita a mano')
    pares = emparejar(modelo)
    por_muro = {}
    for oi, (wi, hi) in pares.items():
        por_muro.setdefault(wi, {})[hi] = modelo['openings'][oi]
    fachadas = []
    for wi, w in enumerate(modelo['walls']):
        holes = []
        for hi, h in enumerate(w['holes']):
            o = por_muro.get(wi, {}).get(hi, {})
            e = {k: h.get(k) for k in AGUJERO}
            for k in CARPINTERIA:
                if o.get(k) is not None:
                    e[k] = o[k]
            holes.append(e)
        fachadas.append({'vol': w['vol'], 'edge': w['edge'], 'profile': w.get('profile'), 'holes': holes})
    doc = {'_leeme': [
        'Las fachadas: qué huecos lleva cada muro y con qué carpintería. A MANO, y a',
        'propósito: el SVG no tiene ventanas, y el código que las componía se perdió.',
        '',
        "Un muro es (vol, edge): el volumen y el índice de su arista, contando desde el",
        "primer vértice del polígono. Cada hueco dice dónde está A LO LARGO del muro",
        "('off', en metros desde el primer vértice de la arista), qué es ('w', 'h',",
        "'sill', 'arch', 'circle', 'semi') y qué carpintería lleva ('label', 'panes',",
        "'door', 'fanlight', 'panelled', 'banded', 'rail', 'panel', 'frame', 'fan',",
        "'push'). Las coordenadas en el mundo NO se escriben: las calcula",
        'leer-fachadas.py del polígono de ahora, y así un edificio retrazado se lleva',
        'sus ventanas consigo. Si una arista deja de existir o los huecos no caben,',
        'el lector para y dice cuál.',
        '',
        "'profile' es el perfil de hastial del muro (eave, apex, flat), o null.",
    ], 'muros': fachadas}
    salida.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    print(f'{salida.name}: {len(fachadas)} muros, {sum(len(f["holes"]) for f in fachadas)} huecos, '
          f'sembrados desde el modelo')


def comparar_muros(walls, viejos):
    a = {(w['vol'], w['edge']): w for w in walls}; b = {(w['vol'], w['edge']): w for w in viejos}
    entran = sorted(set(a) - set(b)); salen = sorted(set(b) - set(a))
    distintos = [k for k in sorted(set(a) & set(b))
                 if a[k]['holes'] != b[k]['holes'] or a[k].get('profile') != b[k].get('profile')
                 or abs(a[k]['len'] - b[k]['len']) > 0.01]
    print(f'muros: {len(walls)} nuevos, {len(viejos)} en el modelo · entran {len(entran)} · salen {len(salen)} '
          f'· cambian {len(distintos)}')
    for k in (entran + salen + distintos)[:10]:
        print(f'     {k[0]} arista {k[1]}')
    return not (entran or salen or distintos)


def comparar_huecos(openings, viejos):
    """Each new opening against the nearest old one of its kind — label, size,
    sill — because the lists are in different orders and a re-derived opening
    is the same opening a few centimetres over."""
    def clase(o): return (o.get('label'), round(o['w'], 3), round(o['h'], 3), round(o['sill'], 3))
    libres = {}
    for o in viejos:
        libres.setdefault(clase(o), []).append(o)
    movidos, sin_par, distintos = [], 0, 0
    for o in openings:
        cands = libres.get(clase(o)) or []
        if not cands:
            sin_par += 1; continue
        v = min(cands, key=lambda q: math.dist((o['x'], o['z']), (q['x'], q['z'])))
        cands.remove(v)
        d = math.dist((o['x'], o['z']), (v['x'], v['z']))
        if d > 0.01:
            movidos.append((o.get('label'), d))
        if {k: x for k, x in o.items() if k not in ('x', 'z', 'nx', 'nz')} != \
           {k: x for k, x in v.items() if k not in ('x', 'z', 'nx', 'nz')}:
            distintos += 1
    sobran = sum(len(c) for c in libres.values())
    print(f'huecos: {len(openings)} nuevos, {len(viejos)} en el modelo · sin pareja {sin_par} · sobran {sobran} '
          f'· se mueven más de 1 cm: {len(movidos)} · cambian de atributos: {distintos}')
    por = {}
    for l, d in movidos:
        por.setdefault(l, []).append(d)
    for l, ds in sorted(por.items(), key=lambda x: -len(x[1]))[:8]:
        print(f'     {l}: {len(ds)}, de {min(ds) * 100:.0f} a {max(ds) * 100:.0f} cm')
    return not (movidos or sin_par or sobran or distintos)


def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    if modo == '--sembrar':
        return sembrar(modelo)
    ruta = here / 'fachadas.json'
    if not ruta.exists():
        sys.exit('falta fachadas.json: python3 leer-fachadas.py --sembrar lo escribe desde el modelo')
    fachadas = json.loads(ruta.read_text())['muros']
    vols = {v['id']: v for v in modelo['vols']}
    walls, openings = construir(fachadas, vols)
    igual = comparar_muros(walls, modelo['walls'])
    igual = comparar_huecos(openings, modelo['openings']) and igual
    if modo == '--write':
        modelo['walls'] = walls; modelo['openings'] = openings
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado')
    else:
        print('(--check: no se ha escrito nada)' + ('' if igual else ' · --write aplicaría lo de arriba'))


if __name__ == '__main__':
    main()
