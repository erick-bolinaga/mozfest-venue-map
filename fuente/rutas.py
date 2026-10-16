"""The walking grid and the public doors, for routes from A to B in the viewer.

armar.py builds it and ships it as __RUTAS__; the viewer searches it (A*). The
spec is docs/superpowers/specs/2026-09-29-rutas-a-b-design.md.

A cell is 0.5 m. It is OPEN when its centre is inside one of the volunteer
zones — the organisation drew them to cover the event, so their union is where
people walk — and clear of everything that blocks the way by HOLGURA: every
volume that stands on the ground, the event's kit, the cages that reach the
ground and the fenced court behind La Fàbrica. Routes go around buildings,
never through them, for now.

Doors come from fuente/puertas.json, by hand: only a door marked public is
used. Its access cell is the nearest open cell to it, so a door drawn on a wall
—inside the fattened footprint, and closed— still has somewhere to arrive.
"""
import base64, math
from collections import deque

CELDA = 0.5
MARGEN = 4.0            # metres around the zones' box
HOLGURA = 0.3           # keep this far from an obstacle's edge
BASE_ALTA = 2.0         # a volume or cage that starts higher is overhead: walk under it
ACCESO_MAX = 3.0        # how far a door may be from its access cell
SALIDA_HUECO = 0.8      # D0 Main: the access point, this far out along the opening's normal
PLANTA_CALLE = ('ground', 'street', 'outdoor access', 'lobby')


def celda(r, x, z):
    return int((x - r['x0']) // r['celda']), int((z - r['z0']) // r['celda'])


def centro_de(r, i, j):
    return r['x0'] + (i + .5) * r['celda'], r['z0'] + (j + .5) * r['celda']


def abierta(r, i, j):
    if not (0 <= i < r['ancho'] and 0 <= j < r['alto']):
        return False
    return bool(r['_rej'][j * r['ancho'] + i])


# ---------------------------------------------------------------- rasterising
def _filas(P, r):
    """For each row whose centre line crosses polygon P: the cells whose centre
    is inside, as (j, i0, i1) spans. Even-odd scanline, so concave shapes and
    the zones' odd outlines come out right."""
    zs = [p[1] for p in P]
    j0 = max(0, int((min(zs) - r['z0']) // r['celda']))
    j1 = min(r['alto'] - 1, int((max(zs) - r['z0']) // r['celda']))
    for j in range(j0, j1 + 1):
        zc = r['z0'] + (j + .5) * r['celda']
        xs = []
        for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
            if (z1 > zc) != (z2 > zc):
                xs.append(x1 + (zc - z1) * (x2 - x1) / (z2 - z1))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            i0 = max(0, math.ceil((a - r['x0']) / r['celda'] - .5))
            i1 = min(r['ancho'] - 1, math.floor((b - r['x0']) / r['celda'] - .5))
            if i0 <= i1:
                yield j, i0, i1


def _pintar(rej, r, P, valor):
    for j, i0, i1 in _filas(P, r):
        rej[j * r['ancho'] + i0: j * r['ancho'] + i1 + 1] = bytes([valor]) * (i1 - i0 + 1)


def _bordes(rej, r, P, d):
    """Close every cell whose centre is within d of an edge of P."""
    for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz or 1e-9
        ia, ja = celda(r, min(x1, x2) - d, min(z1, z2) - d)
        ib, jb = celda(r, max(x1, x2) + d, max(z1, z2) + d)
        for j in range(max(0, ja), min(r['alto'], jb + 1)):
            for i in range(max(0, ia), min(r['ancho'], ib + 1)):
                cx, cz = centro_de(r, i, j)
                t = max(0, min(1, ((cx - x1) * dx + (cz - z1) * dz) / L2))
                if math.hypot(x1 + t * dx - cx, z1 + t * dz - cz) <= d:
                    rej[j * r['ancho'] + i] = 0


def obstaculos(modelo, evento):
    """Every polygon that blocks the way, with where it came from."""
    out = [(v['id'], v['poly']) for v in modelo['vols'] if (v.get('base') or 0) < BASE_ALTA]
    out += [(e['id'], e['poly']) for e in evento if e.get('poly')]
    areas = {b['id']: b['poly'] for b in modelo.get('blocks', [])}
    for c in modelo.get('cages', []):
        P = c.get('poly') or areas.get(c.get('area'))
        if P and c.get('y0', 0) < BASE_ALTA:
            out.append((c.get('label', 'cage'), P))
    if modelo.get('chimney'):
        out.append(('chimney', modelo['chimney']['poly']))
    p = modelo.get('pitch')
    if p:
        (cx, cz), (ux, uz), (vx, vz) = p['c'], p['u'], p['v']
        a, b = p['L'] / 2, p['W'] / 2
        out.append(('pitch', [[cx + sa * a * ux + sb * b * vx, cz + sa * a * uz + sb * b * vz]
                              for sa, sb in ((1, 1), (-1, 1), (-1, -1), (1, -1))]))
    return out


# ---------------------------------------------------------------- doors
def _planta_de_calle(modelo, feat):
    """The floor a door of this building opens on when puertas.json says
    nothing: the one named like street level, or the lowest. As {orden, nombre}:
    `orden` is the model's level, an order within the building and nothing more."""
    fl = sorted((f for f in modelo['floors'] if f['feat'] == feat), key=lambda f: f['level'])
    if not fl:
        return None
    f = next((f for f in fl if any(k in f['name'].lower() for k in PLANTA_CALLE)), fl[0])
    return {'orden': f['level'], 'nombre': f['name']}


def _acceso(r, x, z):
    """The nearest open cell to (x, z), within ACCESO_MAX; None if there is none."""
    i0, j0 = celda(r, x, z)
    tope = int(ACCESO_MAX / r['celda'])
    vistos, cola = {(i0, j0)}, deque([(i0, j0)])
    while cola:
        i, j = cola.popleft()
        if abierta(r, i, j):
            return centro_de(r, i, j)
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + di, j + dj)
            if n not in vistos and abs(n[0] - i0) <= tope and abs(n[1] - j0) <= tope:
                vistos.add(n); cola.append(n)
    return None


def _puertas(modelo, puertas, r, errores):
    ent = {e['id']: e for e in modelo['entrances']}
    out = []
    for pid, m in puertas.items():
        if pid.startswith('_'):
            continue
        if 'huecos' in m:
            vol = next((v for v in modelo['vols'] if v['id'] == m['huecos']['volumen']), None)
            if not vol:
                errores.append(f'{pid}: el volumen {m["huecos"]["volumen"]} no está en el modelo')
                continue
            P = vol['poly']
            huecos = [o for o in modelo['openings'] if o.get('label') == m['huecos']['etiqueta']
                      and not o.get('sill') and _en_borde((o['x'], o['z']), P)]
            if not huecos:
                errores.append(f'{pid}: ningún hueco «{m["huecos"]["etiqueta"]}» a ras de suelo en {vol["id"]}')
            sitios = [(f'{pid}-{k + 1}', o['x'], o['z'], o['x'] + SALIDA_HUECO * o['nx'], o['z'] + SALIDA_HUECO * o['nz'])
                      for k, o in enumerate(sorted(huecos, key=lambda o: (o['z'], o['x'])))]
            edificios = m['edificios']
        else:
            e = ent.get(pid)
            if not e:
                errores.append(f'{pid}: no hay entrada con ese id en el modelo')
                continue
            sitios = [(pid, e['x'], e['z'], e['x'], e['z'])]
            edificios = ([e['of']] if e['of'] else []) + m.get('sirve', [])
        # A typo here would not fail anywhere else: it would just quietly route
        # through the wrong floor, or never prefer the right door.
        conocidos = {f['feat'] for f in modelo['floors']} | {v['id'] for v in modelo['vols']}
        for f in edificios:
            if f not in conocidos:
                errores.append(f'{pid}: el edificio «{f}» no está en el modelo')
        nombres = {f['name'] for f in modelo['floors'] if f['feat'] in edificios}
        # 'hacia' is one floor, or several: a stair-and-lift core leads to all of them.
        for h in ([m['hacia']] if isinstance(m.get('hacia'), str) else m.get('hacia') or []):
            if h not in nombres:
                errores.append(f'{pid}: «hacia» dice «{h}», que no es una planta de {", ".join(edificios)}')
        for f in m.get('plantas', {}):
            if f not in edificios:
                errores.append(f'{pid}: «plantas» nombra «{f}», que no es uno de sus edificios')
        if not m.get('publica'):
            continue
        for sid, x, z, ax0, az0 in sitios:
            acc = _acceso(r, ax0, az0)
            if acc is None:
                errores.append(f'{sid}: ninguna celda libre a menos de {ACCESO_MAX} m')
                continue
            # One floor per building the door serves: the lobby of Can Fontanet
            # is the museum's way in, and in the museum it sits between Street
            # level and the Mezzanine — none of the museum's own floors.
            plantas = {f: (m.get('plantas') or {}).get(f) or _planta_de_calle(modelo, f) for f in edificios}
            out.append({'id': sid, 'nombre': m.get('nombre') or (ent.get(pid) or {}).get('label') or sid,
                        'edificios': edificios, 'x': round(x, 2), 'z': round(z, 2),
                        'ax': round(acc[0], 2), 'az': round(acc[1], 2),
                        'plantas': {f: v for f, v in plantas.items() if v}, 'hacia': m.get('hacia')})
    return out


def _en_borde(p, P, d=0.6):
    for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
        dx, dz = x2 - x1, z2 - z1
        t = max(0, min(1, ((p[0] - x1) * dx + (p[1] - z1) * dz) / ((dx * dx + dz * dz) or 1e-9)))
        if math.hypot(x1 + t * dx - p[0], z1 + t * dz - p[1]) <= d:
            return True
    return False


# ---------------------------------------------------------------- painted
PINTURA = 1.0           # the painter's cell, metres (herramientas/pisable)


def malla_pintura(r):
    """The painter's grid: 1 m cells from the same origin as the walking grid."""
    return {'x0': r['x0'], 'z0': r['z0'], 'celda': PINTURA,
            'ancho': math.ceil(r['ancho'] * r['celda'] / PINTURA),
            'alto': math.ceil(r['alto'] * r['celda'] / PINTURA)}


def _aplicar_pintado(rej, r, p):
    """What Erick painted in the pisable artifact: run-length [value, count]
    over its own grid, row by row; 1 walkable, 2 not, 0 leave it. Applied by
    position, not by index, so a painting still lands where it was painted
    after the walking grid grows or shrinks."""
    if not p or not p.get('rle'):
        return
    k = 0
    for v, n in p['rle']:
        if v:
            for q in range(k, k + n):
                I, J = q % p['ancho'], q // p['ancho']
                x, z = p['x0'] + I * p['celda'], p['z0'] + J * p['celda']
                i0 = max(0, math.ceil((x - r['x0']) / r['celda'] - .5))
                i1 = min(r['ancho'] - 1, math.ceil((x + p['celda'] - r['x0']) / r['celda'] - .5) - 1)
                j0 = max(0, math.ceil((z - r['z0']) / r['celda'] - .5))
                j1 = min(r['alto'] - 1, math.ceil((z + p['celda'] - r['z0']) / r['celda'] - .5) - 1)
                for j in range(j0, j1 + 1):
                    rej[j * r['ancho'] + i0: j * r['ancho'] + i1 + 1] = bytes([1 if v == 1 else 0]) * max(0, i1 - i0 + 1)
        k += n


# ---------------------------------------------------------------- build
def construir(modelo, evento, puertas, paso=None):
    zonas = [z['poly'] for z in modelo['zones']]
    xs = [p[0] for P in zonas for p in P]; zs = [p[1] for P in zonas for p in P]
    r = {'x0': round(min(xs) - MARGEN, 2), 'z0': round(min(zs) - MARGEN, 2), 'celda': CELDA}
    r['ancho'] = math.ceil((max(xs) - min(xs) + 2 * MARGEN) / CELDA)
    r['alto'] = math.ceil((max(zs) - min(zs) + 2 * MARGEN) / CELDA)
    rej = bytearray(r['ancho'] * r['alto'])
    for P in zonas:
        _pintar(rej, r, P, 1)
    # By hand (paso.json): ground people walk that no zone covers, and ground
    # inside a zone nobody can walk. Buildings and kit close over both.
    for a in (paso or {}).get('abrir', []):
        _pintar(rej, r, a['poly'], 1)
    for a in (paso or {}).get('cerrar', []):
        _pintar(rej, r, a['poly'], 0)
    _aplicar_pintado(rej, r, (paso or {}).get('pintado'))
    for _, P in obstaculos(modelo, evento):
        _pintar(rej, r, P, 0)
        _bordes(rej, r, P, HOLGURA)
    r['_rej'] = rej
    r['_salas'] = {room['id']: f['feat'] for f in modelo['floors'] for room in f['rooms']}
    errores = []
    r['puertas'] = _puertas(modelo, puertas, r, errores)
    r['_errores'] = errores
    bits = bytearray((len(rej) + 7) // 8)
    for k, v in enumerate(rej):
        if v:
            bits[k >> 3] |= 1 << (k & 7)
    r['bits'] = base64.b64encode(bytes(bits)).decode()
    return r


def alcanzables(r):
    """Door ids reachable from the Main entrance, flooding in eight directions
    without cutting a corner — the same moves the viewer's search makes."""
    main = next((p for p in r['puertas'] if p['id'] == 'e-Main'), None)
    if not main:
        return set()
    i0, j0 = celda(r, main['ax'], main['az'])
    visto = bytearray(r['ancho'] * r['alto'])
    visto[j0 * r['ancho'] + i0] = 1
    cola = deque([(i0, j0)])
    while cola:
        i, j = cola.popleft()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if not (di or dj):
                    continue
                ni, nj = i + di, j + dj
                if not abierta(r, ni, nj) or visto[nj * r['ancho'] + ni]:
                    continue
                if di and dj and not (abierta(r, i + di, j) and abierta(r, i, j + dj)):
                    continue
                visto[nj * r['ancho'] + ni] = 1
                cola.append((ni, nj))
    return {p['id'] for p in r['puertas']
            if visto[celda(r, p['ax'], p['az'])[1] * r['ancho'] + celda(r, p['ax'], p['az'])[0]]}


def validar(r, sesiones=None):
    """What stops the build. With the programme, also every building that has
    sessions and no public door the Main entrance reaches: its rooms would
    answer "How to get there" with an error on the day."""
    err = list(r['_errores'])
    llegan = alcanzables(r)
    faltan = sorted({p['id'] for p in r['puertas']} - llegan)
    if faltan:
        err.append('puertas públicas que no se alcanzan desde la Main entrance: ' + ', '.join(faltan))
    if sesiones:
        con_puerta = {f for p in r['puertas'] if p['id'] in llegan for f in p['edificios']}
        sin = sorted({r['_salas'][s] for s in sesiones if s in r['_salas']} - con_puerta)
        if sin:
            err.append('edificios con sesiones y ninguna puerta pública alcanzable: ' + ', '.join(sin))
    return err


def para_el_visor(r):
    return {k: v for k, v in r.items() if not k.startswith('_')}
