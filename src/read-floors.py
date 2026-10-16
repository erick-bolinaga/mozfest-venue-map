#!/usr/bin/env python3
"""Pull the traced floors and rooms from map.svg into model.json.

    python3 read-floors.py [--check | --write]

This is the half of the lost SVG pipeline that produces `floors`. The trace
never went anywhere — map.svg still holds all 16 `f-` layers and all 111 `r-`
layers — so what was lost was only the reader. Everything else in model.json
(volumes, walls, openings, roofs) is still produced by the part that is still
missing, and this file does not touch any of it.

It EXTENDS rather than rewrites. A room already in the model keeps the name and
the kind it has, because those were settled once and re-deriving them would
silently move rooms between the sheet and the bubble on a re-import. Only rooms
the model has never seen get their name and kind derived here. That way running
this after a re-trace can add and reshape, and can never quietly restyle.

    --check   read the SVG, compare against model.json, change nothing
    --write   merge the floors back into model.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('read_svg', here / 'read-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)

# Same vocabulary the plans already use. `session` is the fallback and not
# `service`, which is what the original importer did — see the note at the
# bottom of --check about the rooms that fallback mis-sorted.
KINDS = [
    (r'stair|lift|corridor|distribuidor|passadis|access|passage', 'circulation'),
    (r'toilet|wc|sanitari|kitchen|green-room|storage',            'service'),
    (r'office|oficina|despatx|crew',                     'crew'),
    (r'stage|main-hall|scenary',                         'stage'),
    (r'workshop|lab$|-lab-',                             'workshop'),
    (r'art',                                             'art'),
    (r'foyer|reception|vestibule|social|house',          'social'),
    (r'comedor|cafe|bar|tempesta',                       'food'),
]

def kind_of(slug):
    for pat, k in KINDS:
        if re.search(pat, slug, re.I):
            return k
    return 'session'

def label(raw, building):
    """The text in brackets is the name, as everywhere else in this project.
    A layer with both keeps both: `room-2 (Interview set)` reads as
    `Room 2 — Interview set`, because the slug is what is written on the door
    and the bracket is what it is being used for.

    The building is passed in rather than matched by pattern, because the same
    ambiguity that forces the f- layers to be read first bites here too: a
    generic `b-<something>-` would cut `r-01-b-rosa-lobby-outdoor-access` at
    b-rosa and call the room `lobby outdoor access`.

    A room layer named after its own building has no slug at all — it is the
    single room that fills it, like the lobby hall of Can Fontanet or Rosa's
    foyer. Then the bracket is the whole name, with nothing to join it to."""
    br = re.search(r'\(([^)]*)\)', raw)
    slug = re.sub(r'\s*\([^)]*\)', '', raw)
    slug = re.sub(r'^r-\d+-' + re.escape(building) + '-?', '', slug)
    name = br.group(1).strip() if br else ''
    tidy = slug.replace('-', ' ').strip()
    tidy = tidy[:1].upper() + tidy[1:]
    if not tidy:
        if name:
            return name
        tidy = building[2:].replace('-', ' ')
        return tidy[:1].upper() + tidy[1:]
    return tidy + (' — ' + name if name else '')

def read(svg):
    """Group the f-/r-/v- layers into floors. A floor is keyed by its level and
    its building, both of which are in the layer name: f-03-b-rosa is the third
    traced level of b-rosa, and r-03-b-rosa-<room> is a room on it.

    The building cannot be read off a room layer by pattern, because both the
    building and the room may carry hyphens and the split is ambiguous:
    r-01-b-rosa-lobby-outdoor-access is a room of b-rosa-lobby, not the room
    `lobby-outdoor-access` of b-rosa. So the f- layers are read FIRST — those
    are unambiguous, being nothing but a level and a building — and every room
    is then filed under the longest building that its own name starts with."""
    layers = [(s, re.sub(r'\s*\([^)]*\)', '', s['id'] or '')) for s in L.shapes(ET.parse(svg).getroot())]
    buildings = sorted({m.group(1) for _, i in layers
                        if (m := re.match(r'^f-\d+-(b-.+)$', i))}, key=len, reverse=True)
    floors = {}
    for s, bare in layers:
        raw = s['id'] or ''
        m = re.match(r'^([frv])-(\d+)-(b-.+)$', bare)
        if not m or len(s['px']) < 3:
            continue
        kind, level, tail = m.groups()
        if kind == 'f':
            building, room_slug = tail, None
        else:
            building = next((e for e in buildings if tail == e or tail.startswith(e + '-')), None)
            if not building:
                continue                   # not a building of ours
            # A room layer whose name IS the building's is the single room that
            # fills it — the lobby hall of Can Fontanet is one room and one
            # building, and it carries no suffix to tell them apart.
            room_slug = tail[len(building) + 1:] if len(tail) > len(building) else ''
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        p = floors.setdefault((building, level), {'b': building, 'level': level,
                                             'outline': None, 'voids': [], 'rooms': []})
        if kind == 'f':
            p['outline'] = poly
            p['_flabel'] = re.search(r'\(([^)]*)\)', raw)
        elif kind == 'v':
            p['voids'].append(poly)
        else:
            p['rooms'].append({'id': bare, 'raw': raw, 'poly': poly,
                               'area': round(abs(L.area([tuple(q) for q in poly])), 1)})
    return floors

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    floors = read(here / 'map.svg')
    # What the model already knows, so a re-read never restyles what is settled.
    old = {(f['b'], f['level']): f for f in model['floors']}
    # Keyed by the id WITHOUT the bracket, because the id is the identity and
    # the bracket is a label: the pipeline that was lost stripped it from
    # Viola's rooms and left it inside Salvia's, so the model carries both
    # shapes. Matching on the stripped form recognises a room either way.
    old_rooms = {re.sub(r'\s*\([^)]*\)', '', r['id']): r
                    for f in model['floors'] for r in f['rooms']}

    out, new, reshaped, gone, renamed_floors = [], [], [], [], []
    for k in sorted(floors):
        p = floors[k]
        if not p['outline']:
            print(f'warning: {p["b"]} level {p["level"]} has rooms and no f- outline')
            continue
        v = old.get(k)
        fl = {'b': p['b'],
              'feat': v['feat'] if v else p['b'],
              'level': p['level'],
              'name': (p['_flabel'].group(1).strip() if p.get('_flabel')
                       else (v['name'] if v else 'Level ' + p['level'])),
              'outline': p['outline'], 'voids': p['voids'], 'rooms': []}
        # A floor's name comes from its bracket, and a new bracket renames it:
        # say so, because a plan called 'Second floor' by the trace and 'First
        # floor' by the organisation's document is a volunteer on the wrong floor.
        if v and v['name'] != fl['name']:
            renamed_floors.append(f"{p['b']} {p['level']}: '{v['name']}' -> '{fl['name']}'")
        for r in sorted(p['rooms'], key=lambda r: -r['area']):
            o = old_rooms.get(r['id'])
            slug = re.sub(r'^r-\d+-' + re.escape(p['b']) + '-?', '', r['id'])
            # No slug means the room is the whole building, so the bracket is
            # all there is to go on: 'D2 Foyer' is what makes it a foyer.
            br = re.search(r'\(([^)]*)\)', r['raw'])
            hint = slug or (br.group(1) if br else '')
            fl['rooms'].append({'id': r['id'],
                                'name': o['name'] if o else label(r['raw'], p['b']),
                                'kind': o['kind'] if o else kind_of(hint),
                                'poly': r['poly'], 'area': r['area']})
            if not o:
                new.append(r['id'])
            elif abs(o['area'] - r['area']) > 0.15:
                reshaped.append(f'{r["id"]}  {o["area"]} -> {r["area"]} m2')
        out.append(fl)

    seen = {r['id'] for f in out for r in f['rooms']}
    gone = sorted(set(old_rooms) - seen)
    stripped = [(o['id'], k) for k, o in old_rooms.items() if o['id'] != k and k in seen]

    print(f'{len(out)} floors, {sum(len(f["rooms"]) for f in out)} rooms read from the SVG')
    for t, xs in (('new', new), ('reshaped', reshaped), ('no longer there', gone),
                  ('id stripped of its bracket', [f'{a} -> {b}' for a, b in stripped]),
                  ('floors renamed by their label', renamed_floors)):
        print(f'  {t}: {len(xs)}')
        for x in xs[:12]:
            print(f'     {x}')
    if mode == '--write':
        model['floors'] = out
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated')
    else:
        print('(--check: nothing written)')

if __name__ == '__main__':
    main()
