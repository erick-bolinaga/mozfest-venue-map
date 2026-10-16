#!/usr/bin/env python3
"""Propose a viewing angle for every building, into views.json.

    python3 seed-views.py [--write]

A search result flies to a building, and "you can see it" is not the same as
"it looks good": Espai Bota sits behind Rosa, and the first unobstructed
heading only just clears the corner. So each building is scored rather than
merely checked — how MUCH of it is visible from a candidate view — and the best
one is written down.

What is written is angle, tilt and distance, never a position. Those survive a
re-trace: a building may be drawn more accurately tomorrow, but it does not
move, and where the camera should stand relative to it does not change.

The output is a starting point, not a verdict. Fly to a building in the viewer
with ?dev=1, compose the view by hand, and the readout prints the line for it
ready to paste over whatever this proposed.
"""
import json, math, pathlib, sys

here = pathlib.Path(__file__).parent
D = json.loads((here / 'model.json').read_text())

# The viewer's own framing, reproduced: same centre, same span, same distance.
xs = [p[0] for v in D['vols'] + D['blocks'] for p in v['poly']]
zs = [p[1] for v in D['vols'] + D['blocks'] for p in v['poly']]
SPAN = max(max(xs) - min(xs), max(zs) - min(zs))
HOME_YAW, HOME_PITCH = 0.956, 0.307


def prism(v):
    """A volume as its traced outline plus a top. NOT a bounding box: the site is
    drawn twelve degrees off square, so an axis-aligned box around a building
    reaches well past its walls and reports shadows it does not cast. That box
    said Can Fontanet's lobby could not be seen from anywhere on earth."""
    return {'id': v['id'], 'of': v.get('of') or v['id'], 'poly': v['poly'],
            'top': max(v.get('h') or 0, v.get('rise') or 0)}


PRISMS = [prism(v) for v in D['vols']]


def point_in(x, z, poly):
    c = False
    n = len(poly)
    for i in range(n):
        xi, zi = poly[i]; xj, zj = poly[(i - 1) % n]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
    return c


def seg_prism(a, b, k):
    """Where the segment crosses the outline, and whether it is under the roof
    while it is inside. Every crossing splits the segment; a midpoint that is
    inside AND below the top is the view being blocked."""
    ax, az, bx, bz = a[0], a[2], b[0], b[2]
    d1x, d1z = bx - ax, bz - az
    ts = [0.0, 1.0]
    poly = k['poly']
    n = len(poly)
    for i in range(n):
        px, pz = poly[i]; qx, qz = poly[(i + 1) % n]
        d2x, d2z = qx - px, qz - pz
        den = d1x * d2z - d1z * d2x
        if abs(den) < 1e-12:
            continue
        t = ((px - ax) * d2z - (pz - az) * d2x) / den
        u = ((px - ax) * d1z - (pz - az) * d1x) / den
        if 0 <= t <= 1 and 0 <= u <= 1:
            ts.append(t)
    ts.sort()
    for i in range(len(ts) - 1):
        t = (ts[i] + ts[i + 1]) / 2
        if point_in(ax + d1x * t, az + d1z * t, poly):
            if a[1] + (b[1] - a[1]) * t < k['top']:
                return True
    return False


def inside(p, k):
    return point_in(p[0], p[2], k['poly']) and 0 <= p[1] <= k['top']


def targets(v, n=24):
    """Points to try to see: the outline at mid height, plus the centre. A view
    that clears one corner of a building is not a view OF that building."""
    poly = v['poly']
    top = max(v.get('h') or 0, v.get('rise') or 0) or 6.0
    y = top * 0.45
    pts = []
    per = max(1, n // len(poly))
    for i in range(len(poly)):
        ax, az = poly[i]
        bx, bz = poly[(i + 1) % len(poly)]
        for s in range(per):
            t = s / per
            pts.append((ax + (bx - ax) * t, y, az + (bz - az) * t))
    cx = sum(p[0] for p in poly) / len(poly)
    cz = sum(p[1] for p in poly) / len(poly)
    pts.append((cx, y, cz))
    return pts


def score(v, yaw, pitch, dist, others):
    xs = [p[0] for p in v['poly']]; zs = [p[1] for p in v['poly']]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    cam = (cx + dist * math.cos(pitch) * math.sin(yaw),
           dist * math.sin(pitch),
           cz + dist * math.cos(pitch) * math.cos(yaw))
    # A camera standing inside something sees that thing's inside walls.
    if any(inside(cam, k) for k in PRISMS):
        return -1
    seen = 0
    for t in targets(v):
        if not any(seg_prism(cam, t, k) for k in others):
            seen += 1
    return seen


def best(v):
    xs = [p[0] for p in v['poly']]; zs = [p[1] for p in v['poly']]
    dist = max(SPAN * 0.16, max(max(xs) - min(xs), max(zs) - min(zs)) * 2.4)
    fam = v.get('of') or v['id']
    others = [k for k in PRISMS if k['of'] != fam]
    out = None
    for i in range(48):
        yaw = i * math.tau / 48
        for pitch in (0.30, 0.42, 0.55, 0.70):
            s = score(v, yaw, pitch, dist, others)
            if s < 0:
                continue
            # Ties go to the view closest to the opening shot, so the site keeps
            # one feel instead of spinning to a new angle for every result.
            turn = abs(math.atan2(math.sin(yaw - HOME_YAW), math.cos(yaw - HOME_YAW)))
            key = (-s, turn + abs(pitch - HOME_PITCH))
            if out is None or key < out[0]:
                out = (key, yaw, pitch, dist, s)
    return out


# One entry per building, on its largest volume — the same one the search flies to.
biggest = {}
for v in D['vols']:
    k = v.get('of') or v['id']
    xs = [p[0] for p in v['poly']]; zs = [p[1] for p in v['poly']]
    a = (max(xs) - min(xs)) * (max(zs) - min(zs))
    if k not in biggest or a > biggest[k][1]:
        biggest[k] = (v, a)

views, weak = {}, []
for k, (v, _) in sorted(biggest.items()):
    r = best(v)
    if not r:
        weak.append((k, 0, 0)); continue
    _, yaw, pitch, dist, s = r
    n = len(targets(v))
    views[k] = {'yaw': round(yaw, 3), 'pitch': round(pitch, 3), 'dist': round(dist)}
    pct = 100 * s / n
    if pct < 70:
        weak.append((k, s, n))
    print(f"{k:34} yaw {yaw*180/math.pi:6.1f}°  pitch {pitch*180/math.pi:4.1f}°  "
          f"dist {dist:4.0f} m   visible {pct:5.1f}%")

print(f"\n{len(views)} buildings")
if weak:
    print('under 70% visible, look at them:',
          ', '.join(f'{k} ({s}/{n})' for k, s, n in weak))

if '--write' in sys.argv:
    p = here / 'views.json'
    payload = {'_readme': ('Ángulo, inclinación y distancia desde la que el buscador '
                          'enseña cada edificio. Vuela con ?dev=1, compón la vista y '
                          'pega la línea que imprime el lector de cámara. '
                          'Propuesto por seed-views.py; corregir a mano es lo esperado.')}
    payload.update(views)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n')
    print('written', p)
