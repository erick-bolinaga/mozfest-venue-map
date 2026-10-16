#!/usr/bin/env python3
"""Pull the event build-out from mapa.svg into evento.json.

    python3 leer-evento.py [--write]

The `ev-` and `m-` layers are the festival's own kit — food trucks, stages, toilets,
generators, the art tent — as opposed to the venue, which does not move. They
were traced in Figma months ago and never reached the model, because the
importer that used to do this was lost in a container reset.

This is GENERATED. Re-run it after re-tracing and it catches up; nothing here
should be edited by hand. Anything the festival adds that is NOT in the SVG —
a stall decided the week before, an information point moved on the day — goes
in servicios.json instead, which is hand-written and merged alongside.

The transform is a plain division: the model and the SVG share an origin, and
5.8136 px is one metre. Checked against buildings that are in both — the
lobby of Can Fontanet lands within 30 cm, which is the footprint inflation
the venue geometry carries and this does not: a free-standing food truck has
no joint with anything to close.
"""
import json, math, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

# Which of the venue's own room kinds each piece of kit belongs to, so it gets
# the colour and the wording the plans already use instead of a second
# vocabulary meaning the same things.
KINDS = [
    (r'accreditation|merch',                   'service'),
    (r'food-truck|^bar$|coffee|f&b|catering', 'food'),
    (r'stage',                                 'stage'),
    (r'domo|dome',                             'session'),
    (r'art-tent',                              'art'),
    (r'wc|toilet',                             'service'),
    (r'generator',                             'service'),
    (r'giant-games',                           'social'),
    (r'quiet|prayer|parents',                  'care'),
    (r'office|meeting',                        'crew'),
]
# Heights are INVENTED, every one of them: the trace is a footprint and carries
# no third dimension. They are here to give each thing a body you can see past
# and behind, not to describe it. Everything written by this file is marked as
# an estimate for that reason.
ALTO = {'food': 3.2, 'stage': 1.0, 'art': 4.5, 'service': 2.5,
        'social': 0.4, 'care': 2.6, 'crew': 2.6, 'session': 4.0}


def kind_of(slug):
    for pat, k in KINDS:
        if re.search(pat, slug, re.I):
            return k
    return 'service'


def label_of(raw):
    """The text in brackets is the name, the way it is everywhere else in this
    project. Without one, the slug is tidied: ev-food-truck-1 -> Food truck 1."""
    m = re.search(r'\(([^)]*)\)', raw)
    if m:
        return m.group(1).strip()
    s = re.sub(r'^(ev|m)-', '', raw)
    s = re.sub(r'_(\d+)$', r' \1', s).replace('-', ' ').replace('&', 'and').strip()
    return s[:1].upper() + s[1:]


def leer(svg):
    shapes = L.shapes(ET.parse(svg).getroot())
    out, seen = [], {}
    for s in shapes:
        raw = s['id'] or ''
        # Two prefixes, one meaning: ev- is the build-out, m- is Mozilla's own
        # front of house — accreditation and the merch store. Both are kit the
        # festival brings and takes away, so both land in the same list.
        if not (raw.startswith('ev-') or raw.startswith('m-')) or len(s['px']) < 3:
            continue
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        if L.area([tuple(p) for p in poly]) < 0.4:
            continue                       # a stray handle, not a thing
        # A layer traced as several shapes keeps the largest: these are props,
        # and the one that matters is the one you would walk into.
        if raw in seen and L.area([tuple(p) for p in seen[raw]['poly']]) >= L.area(
                [tuple(p) for p in poly]):
            continue
        k = kind_of(raw)
        seen[raw] = {'id': raw, 'label': label_of(raw), 'kind': k,
                     'h': ALTO[k], 'poly': poly, 'est': True, 'src': 'svg'}
    return [seen[k] for k in sorted(seen)]


def cuadrado(poly):
    """The angle of the longest edge, folded into a quarter turn."""
    best = (0, 0)
    for i in range(len(poly)):
        (ax, az), (bx, bz) = poly[i], poly[(i + 1) % len(poly)]
        d = math.hypot(bx - ax, bz - az)
        if d > best[0]:
            best = (d, math.degrees(math.atan2(bz - az, bx - ax)) % 90)
    return best[1]


items = leer(here / 'mapa.svg')

# The transform reader used to drop rotate() on the floor, and this map is drawn
# with 49 of them. Nothing looked broken: the shapes were the right size in the
# right place, all facing north on a site traced twelve degrees off the axes.
# So it is checked rather than trusted. A venue where everything squares up to
# the grid is a venue whose rotations were eaten.
torcidos = sum(1 for it in items if 0.5 < cuadrado(it['poly']) < 89.5)
if items and torcidos == 0:
    sys.exit('todas las formas salen a escuadra con los ejes, y el recinto está '
             'trazado a 12°: el lector se ha vuelto a comer las rotaciones')
por_tipo = {}
for it in items:
    por_tipo[it['kind']] = por_tipo.get(it['kind'], 0) + 1
for it in items:
    xs = [p[0] for p in it['poly']]; zs = [p[1] for p in it['poly']]
    print(f"{it['id']:44} {it['kind']:8} {it['h']:4} m  "
          f"{L.area([tuple(p) for p in it['poly']]):7.1f} m²  {it['label']}")
print(f"\n{len(items)} elementos · " + ', '.join(f'{k} {n}' for k, n in sorted(por_tipo.items())))

if '--write' in sys.argv:
    p = here / 'evento.json'
    p.write_text(json.dumps({
        '_leeme': ('GENERADO por leer-evento.py desde las capas ev- de mapa.svg. '
                   'No editar a mano: se pierde al reimportar. Lo que el evento '
                   'añada o mueva y no esté trazado va en servicios.json.'),
        'items': items}, ensure_ascii=False, indent=1) + '\n')
    print('escrito', p)
