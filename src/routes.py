"""The walking grid and the public doors, for routes from A to B in the viewer.

build.py builds it and ships it as __ROUTES__; the viewer searches it (A*). The
spec is docs/superpowers/specs/2026-09-29-rutas-a-b-design.md.

A cell is 0.5 m. It is OPEN when its centre is inside one of the volunteer
zones — the organisation drew them to cover the event, so their union is where
people walk — and clear of everything that blocks the way by CLEARANCE: every
volume that stands on the ground, the event's kit, the cages that reach the
ground and the fenced court behind La Fàbrica. Routes go around buildings,
never through them, for now.

Doors come from src/doors.json, by hand: only a door marked public is
used. Its access cell is the nearest open cell to it, so a door drawn on a wall
—inside the fattened footprint, and closed— still has somewhere to arrive.
"""
import base64, math
from collections import deque

CELL = 0.5
MARGIN = 4.0            # metres around the zones' box
CLEARANCE = 0.3           # keep this far from an obstacle's edge
HIGH_BASE = 2.0         # a volume or cage that starts higher is overhead: walk under it
MAX_ACCESS = 3.0        # how far a door may be from its access cell
OPENING_EXIT = 0.8      # D0 Main: the access point, this far out along the opening's normal
STREET_FLOOR = ('ground', 'street', 'outdoor access', 'lobby')


def cell_of(r, x, z):
    return int((x - r['x0']) // r['cell']), int((z - r['z0']) // r['cell'])


def centre_of(r, i, j):
    return r['x0'] + (i + .5) * r['cell'], r['z0'] + (j + .5) * r['cell']


def is_open(r, i, j):
    if not (0 <= i < r['width'] and 0 <= j < r['height']):
        return False
    return bool(r['_grid'][j * r['width'] + i])


# ---------------------------------------------------------------- rasterising
def _rows(P, r):
    """For each row whose centre line crosses polygon P: the cells whose centre
    is inside, as (j, i0, i1) spans. Even-odd scanline, so concave shapes and
    the zones' odd outlines come out right."""
    zs = [p[1] for p in P]
    j0 = max(0, int((min(zs) - r['z0']) // r['cell']))
    j1 = min(r['height'] - 1, int((max(zs) - r['z0']) // r['cell']))
    for j in range(j0, j1 + 1):
        zc = r['z0'] + (j + .5) * r['cell']
        xs = []
        for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
            if (z1 > zc) != (z2 > zc):
                xs.append(x1 + (zc - z1) * (x2 - x1) / (z2 - z1))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            i0 = max(0, math.ceil((a - r['x0']) / r['cell'] - .5))
            i1 = min(r['width'] - 1, math.floor((b - r['x0']) / r['cell'] - .5))
            if i0 <= i1:
                yield j, i0, i1


def _paint(grid, r, P, value):
    for j, i0, i1 in _rows(P, r):
        grid[j * r['width'] + i0: j * r['width'] + i1 + 1] = bytes([value]) * (i1 - i0 + 1)


def _edges(grid, r, P, d):
    """Close every cell whose centre is within d of an edge of P."""
    for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
        dx, dz = x2 - x1, z2 - z1
        L2 = dx * dx + dz * dz or 1e-9
        ia, ja = cell_of(r, min(x1, x2) - d, min(z1, z2) - d)
        ib, jb = cell_of(r, max(x1, x2) + d, max(z1, z2) + d)
        for j in range(max(0, ja), min(r['height'], jb + 1)):
            for i in range(max(0, ia), min(r['width'], ib + 1)):
                cx, cz = centre_of(r, i, j)
                t = max(0, min(1, ((cx - x1) * dx + (cz - z1) * dz) / L2))
                if math.hypot(x1 + t * dx - cx, z1 + t * dz - cz) <= d:
                    grid[j * r['width'] + i] = 0


def obstacles(model, event):
    """Every polygon that blocks the way, with where it came from."""
    out = [(v['id'], v['poly']) for v in model['vols'] if (v.get('base') or 0) < HIGH_BASE]
    out += [(e['id'], e['poly']) for e in event if e.get('poly')]
    areas = {b['id']: b['poly'] for b in model.get('blocks', [])}
    for c in model.get('cages', []):
        P = c.get('poly') or areas.get(c.get('area'))
        if P and c.get('y0', 0) < HIGH_BASE:
            out.append((c.get('label', 'cage'), P))
    if model.get('chimney'):
        out.append(('chimney', model['chimney']['poly']))
    p = model.get('pitch')
    if p:
        (cx, cz), (ux, uz), (vx, vz) = p['c'], p['u'], p['v']
        a, b = p['L'] / 2, p['W'] / 2
        out.append(('pitch', [[cx + sa * a * ux + sb * b * vx, cz + sa * a * uz + sb * b * vz]
                              for sa, sb in ((1, 1), (-1, 1), (-1, -1), (1, -1))]))
    return out


# ---------------------------------------------------------------- doors
def _street_floor(model, feat):
    """The floor a door of this building opens on when doors.json says
    nothing: the one named like street level, or the lowest. As {order, name}:
    `order` is the model's level, an order within the building and nothing more."""
    fl = sorted((f for f in model['floors'] if f['feat'] == feat), key=lambda f: f['level'])
    if not fl:
        return None
    f = next((f for f in fl if any(k in f['name'].lower() for k in STREET_FLOOR)), fl[0])
    return {'order': f['level'], 'name': f['name']}


def _access(r, x, z):
    """The nearest open cell to (x, z), within MAX_ACCESS; None if there is none."""
    i0, j0 = cell_of(r, x, z)
    limit = int(MAX_ACCESS / r['cell'])
    seen, queue = {(i0, j0)}, deque([(i0, j0)])
    while queue:
        i, j = queue.popleft()
        if is_open(r, i, j):
            return centre_of(r, i, j)
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + di, j + dj)
            if n not in seen and abs(n[0] - i0) <= limit and abs(n[1] - j0) <= limit:
                seen.add(n); queue.append(n)
    return None


def _doors(model, doors, r, errors):
    ent = {e['id']: e for e in model['entrances']}
    out = []
    for pid, m in doors.items():
        if pid.startswith('_'):
            continue
        if 'openings' in m:
            vol = next((v for v in model['vols'] if v['id'] == m['openings']['volume']), None)
            if not vol:
                errors.append(f'{pid}: volume {m["openings"]["volume"]} is not in the model')
                continue
            P = vol['poly']
            openings = [o for o in model['openings'] if o.get('label') == m['openings']['label']
                      and not o.get('sill') and _on_edge((o['x'], o['z']), P)]
            if not openings:
                errors.append(f'{pid}: no «{m["openings"]["label"]}» opening at ground level on {vol["id"]}')
            places = [(f'{pid}-{k + 1}', o['x'], o['z'], o['x'] + OPENING_EXIT * o['nx'], o['z'] + OPENING_EXIT * o['nz'])
                      for k, o in enumerate(sorted(openings, key=lambda o: (o['z'], o['x'])))]
            buildings = m['buildings']
        else:
            e = ent.get(pid)
            if not e:
                errors.append(f'{pid}: there is no entrance with that id in the model')
                continue
            places = [(pid, e['x'], e['z'], e['x'], e['z'])]
            buildings = ([e['of']] if e['of'] else []) + m.get('serves', [])
        # A typo here would not fail anywhere else: it would just quietly route
        # through the wrong floor, or never prefer the right door.
        known = {f['feat'] for f in model['floors']} | {v['id'] for v in model['vols']}
        for f in buildings:
            if f not in known:
                errors.append(f'{pid}: building «{f}» is not in the model')
        floor_names = {f['name'] for f in model['floors'] if f['feat'] in buildings}
        # 'towards' is one floor, or several: a stair-and-lift core leads to all of them.
        for h in ([m['towards']] if isinstance(m.get('towards'), str) else m.get('towards') or []):
            if h not in floor_names:
                errors.append(f'{pid}: «towards» says «{h}», which is not a floor of {", ".join(buildings)}')
        for f in m.get('floors', {}):
            if f not in buildings:
                errors.append(f'{pid}: «floors» names «{f}», which is not one of its buildings')
        if not m.get('public'):
            continue
        for sid, x, z, ax0, az0 in places:
            acc = _access(r, ax0, az0)
            if acc is None:
                errors.append(f'{sid}: no open cell within {MAX_ACCESS} m')
                continue
            # One floor per building the door serves: the lobby of Can Fontanet
            # is the museum's way in, and in the museum it sits between Street
            # level and the Mezzanine — none of the museum's own floors.
            floors = {f: (m.get('floors') or {}).get(f) or _street_floor(model, f) for f in buildings}
            out.append({'id': sid, 'name': m.get('name') or (ent.get(pid) or {}).get('label') or sid,
                        'buildings': buildings, 'x': round(x, 2), 'z': round(z, 2),
                        'ax': round(acc[0], 2), 'az': round(acc[1], 2),
                        'floors': {f: v for f, v in floors.items() if v}, 'towards': m.get('towards')})
    return out


def _on_edge(p, P, d=0.6):
    for (x1, z1), (x2, z2) in zip(P, P[1:] + P[:1]):
        dx, dz = x2 - x1, z2 - z1
        t = max(0, min(1, ((p[0] - x1) * dx + (p[1] - z1) * dz) / ((dx * dx + dz * dz) or 1e-9)))
        if math.hypot(x1 + t * dx - p[0], z1 + t * dz - p[1]) <= d:
            return True
    return False


# ---------------------------------------------------------------- painted
PAINT_CELL = 1.0           # the painter's cell, metres (tools/walkable)


def paint_grid(r):
    """The painter's grid: 1 m cells from the same origin as the walking grid."""
    return {'x0': r['x0'], 'z0': r['z0'], 'cell': PAINT_CELL,
            'width': math.ceil(r['width'] * r['cell'] / PAINT_CELL),
            'height': math.ceil(r['height'] * r['cell'] / PAINT_CELL)}


def _apply_painted(grid, r, p):
    """What Erick painted in the walkable artifact («Dónde se pisa»): run-length
    [value, count] over its own grid, row by row; 1 walkable, 2 not, 0 leave it.
    Applied by position, not by index, so a painting still lands where it was
    painted after the walking grid grows or shrinks."""
    if not p or not p.get('rle'):
        return
    k = 0
    for v, n in p['rle']:
        if v:
            for q in range(k, k + n):
                I, J = q % p['width'], q // p['width']
                x, z = p['x0'] + I * p['cell'], p['z0'] + J * p['cell']
                i0 = max(0, math.ceil((x - r['x0']) / r['cell'] - .5))
                i1 = min(r['width'] - 1, math.ceil((x + p['cell'] - r['x0']) / r['cell'] - .5) - 1)
                j0 = max(0, math.ceil((z - r['z0']) / r['cell'] - .5))
                j1 = min(r['height'] - 1, math.ceil((z + p['cell'] - r['z0']) / r['cell'] - .5) - 1)
                for j in range(j0, j1 + 1):
                    grid[j * r['width'] + i0: j * r['width'] + i1 + 1] = bytes([1 if v == 1 else 0]) * max(0, i1 - i0 + 1)
        k += n


# ---------------------------------------------------------------- build
def build(model, event, doors, walkable=None):
    zones = [z['poly'] for z in model['zones']]
    xs = [p[0] for P in zones for p in P]; zs = [p[1] for P in zones for p in P]
    r = {'x0': round(min(xs) - MARGIN, 2), 'z0': round(min(zs) - MARGIN, 2), 'cell': CELL}
    r['width'] = math.ceil((max(xs) - min(xs) + 2 * MARGIN) / CELL)
    r['height'] = math.ceil((max(zs) - min(zs) + 2 * MARGIN) / CELL)
    grid = bytearray(r['width'] * r['height'])
    for P in zones:
        _paint(grid, r, P, 1)
    # By hand (walkable.json): ground people walk that no zone covers, and ground
    # inside a zone nobody can walk. Buildings and kit close over both.
    for a in (walkable or {}).get('open', []):
        _paint(grid, r, a['poly'], 1)
    for a in (walkable or {}).get('close', []):
        _paint(grid, r, a['poly'], 0)
    _apply_painted(grid, r, (walkable or {}).get('painted'))
    for _, P in obstacles(model, event):
        _paint(grid, r, P, 0)
        _edges(grid, r, P, CLEARANCE)
    r['_grid'] = grid
    r['_rooms'] = {room['id']: f['feat'] for f in model['floors'] for room in f['rooms']}
    errors = []
    r['doors'] = _doors(model, doors, r, errors)
    r['_errors'] = errors
    bits = bytearray((len(grid) + 7) // 8)
    for k, v in enumerate(grid):
        if v:
            bits[k >> 3] |= 1 << (k & 7)
    r['bits'] = base64.b64encode(bytes(bits)).decode()
    return r


def reachable(r):
    """Door ids reachable from the Main entrance, flooding in eight directions
    without cutting a corner — the same moves the viewer's search makes."""
    main = next((p for p in r['doors'] if p['id'] == 'e-Main'), None)
    if not main:
        return set()
    i0, j0 = cell_of(r, main['ax'], main['az'])
    seen = bytearray(r['width'] * r['height'])
    seen[j0 * r['width'] + i0] = 1
    queue = deque([(i0, j0)])
    while queue:
        i, j = queue.popleft()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if not (di or dj):
                    continue
                ni, nj = i + di, j + dj
                if not is_open(r, ni, nj) or seen[nj * r['width'] + ni]:
                    continue
                if di and dj and not (is_open(r, i + di, j) and is_open(r, i, j + dj)):
                    continue
                seen[nj * r['width'] + ni] = 1
                queue.append((ni, nj))
    return {p['id'] for p in r['doors']
            if seen[cell_of(r, p['ax'], p['az'])[1] * r['width'] + cell_of(r, p['ax'], p['az'])[0]]}


def validate(r, sessions=None):
    """What stops the build. With the programme, also every building that has
    sessions and no public door the Main entrance reaches: its rooms would
    answer "How to get there" with an error on the day."""
    err = list(r['_errors'])
    reached = reachable(r)
    unreached = sorted({p['id'] for p in r['doors']} - reached)
    if unreached:
        err.append('public doors the Main entrance cannot reach: ' + ', '.join(unreached))
    if sessions:
        with_door = {f for p in r['doors'] if p['id'] in reached for f in p['buildings']}
        without = sorted({r['_rooms'][s] for s in sessions if s in r['_rooms']} - with_door)
        if without:
            err.append('buildings with sessions and no reachable public door: ' + ', '.join(without))
    return err


def for_viewer(r):
    return {k: v for k, v in r.items() if not k.startswith('_')}
