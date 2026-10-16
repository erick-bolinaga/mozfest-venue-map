#!/usr/bin/env python3
"""Pull the traced floors and rooms from mapa.svg into modelo.json.

    python3 leer-plantas.py [--check | --write]

This is the half of the lost SVG pipeline that produces `floors`. The trace
never went anywhere — mapa.svg still holds all 16 `f-` layers and all 111 `r-`
layers — so what was lost was only the reader. Everything else in modelo.json
(volumes, walls, openings, roofs) is still produced by the part that is still
missing, and this file does not touch any of it.

It EXTENDS rather than rewrites. A room already in the model keeps the name and
the kind it has, because those were settled once and re-deriving them would
silently move rooms between the sheet and the bubble on a re-import. Only rooms
the model has never seen get their name and kind derived here. That way running
this after a re-trace can add and reshape, and can never quietly restyle.

    --check   read the SVG, compare against modelo.json, change nothing
    --write   merge the floors back into modelo.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('leersvg', here / 'leer-svg.py')
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

def label(raw, edif):
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
    slug = re.sub(r'^r-\d+-' + re.escape(edif) + '-?', '', slug)
    nombre = br.group(1).strip() if br else ''
    tidy = slug.replace('-', ' ').strip()
    tidy = tidy[:1].upper() + tidy[1:]
    if not tidy:
        if nombre:
            return nombre
        tidy = edif[2:].replace('-', ' ')
        return tidy[:1].upper() + tidy[1:]
    return tidy + (' — ' + nombre if nombre else '')

def leer(svg):
    """Group the f-/r-/v- layers into floors. A floor is keyed by its level and
    its building, both of which are in the layer name: f-03-b-rosa is the third
    traced level of b-rosa, and r-03-b-rosa-<room> is a room on it.

    The building cannot be read off a room layer by pattern, because both the
    building and the room may carry hyphens and the split is ambiguous:
    r-01-b-rosa-lobby-outdoor-access is a room of b-rosa-lobby, not the room
    `lobby-outdoor-access` of b-rosa. So the f- layers are read FIRST — those
    are unambiguous, being nothing but a level and a building — and every room
    is then filed under the longest building that its own name starts with."""
    formas = [(s, re.sub(r'\s*\([^)]*\)', '', s['id'] or '')) for s in L.shapes(ET.parse(svg).getroot())]
    edificios = sorted({m.group(1) for _, i in formas
                        if (m := re.match(r'^f-\d+-(b-.+)$', i))}, key=len, reverse=True)
    pisos = {}
    for s, plano in formas:
        raw = s['id'] or ''
        m = re.match(r'^([frv])-(\d+)-(b-.+)$', plano)
        if not m or len(s['px']) < 3:
            continue
        tipo, nivel, cola = m.groups()
        if tipo == 'f':
            edif, resto = cola, None
        else:
            edif = next((e for e in edificios if cola == e or cola.startswith(e + '-')), None)
            if not edif:
                continue                   # not a building of ours
            # A room layer whose name IS the building's is the single room that
            # fills it — the lobby hall of Can Fontanet is one room and one
            # building, and it carries no suffix to tell them apart.
            resto = cola[len(edif) + 1:] if len(cola) > len(edif) else ''
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        p = pisos.setdefault((edif, nivel), {'b': edif, 'level': nivel,
                                             'outline': None, 'voids': [], 'rooms': []})
        if tipo == 'f':
            p['outline'] = poly
            p['_flabel'] = re.search(r'\(([^)]*)\)', raw)
        elif tipo == 'v':
            p['voids'].append(poly)
        else:
            p['rooms'].append({'id': plano, 'bruto': raw, 'poly': poly,
                               'area': round(abs(L.area([tuple(q) for q in poly])), 1)})
    return pisos

def main():
    modo = sys.argv[1] if len(sys.argv) > 1 else '--check'
    modelo = json.loads((here / 'modelo.json').read_text())
    pisos = leer(here / 'mapa.svg')
    # What the model already knows, so a re-read never restyles what is settled.
    viejo = {(f['b'], f['level']): f for f in modelo['floors']}
    # Keyed by the id WITHOUT the bracket, because the id is the identity and
    # the bracket is a label: the pipeline that was lost stripped it from
    # Viola's rooms and left it inside Salvia's, so the model carries both
    # shapes. Matching on the stripped form recognises a room either way.
    salas_viejas = {re.sub(r'\s*\([^)]*\)', '', r['id']): r
                    for f in modelo['floors'] for r in f['rooms']}

    salida, nuevas, movidas, perdidas, plantas_renombradas = [], [], [], [], []
    for k in sorted(pisos):
        p = pisos[k]
        if not p['outline']:
            print(f'aviso: {p["b"]} nivel {p["level"]} tiene salas y ningun contorno f-')
            continue
        v = viejo.get(k)
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
            plantas_renombradas.append(f"{p['b']} {p['level']}: '{v['name']}' -> '{fl['name']}'")
        for r in sorted(p['rooms'], key=lambda r: -r['area']):
            o = salas_viejas.get(r['id'])
            slug = re.sub(r'^r-\d+-' + re.escape(p['b']) + '-?', '', r['id'])
            # No slug means the room is the whole building, so the bracket is
            # all there is to go on: 'D2 Foyer' is what makes it a foyer.
            br = re.search(r'\(([^)]*)\)', r['bruto'])
            pista = slug or (br.group(1) if br else '')
            fl['rooms'].append({'id': r['id'],
                                'name': o['name'] if o else label(r['bruto'], p['b']),
                                'kind': o['kind'] if o else kind_of(pista),
                                'poly': r['poly'], 'area': r['area']})
            if not o:
                nuevas.append(r['id'])
            elif abs(o['area'] - r['area']) > 0.15:
                movidas.append(f'{r["id"]}  {o["area"]} -> {r["area"]} m2')
        salida.append(fl)

    vistas = {r['id'] for f in salida for r in f['rooms']}
    perdidas = sorted(set(salas_viejas) - vistas)
    renombradas = [(o['id'], k) for k, o in salas_viejas.items() if o['id'] != k and k in vistas]

    print(f'{len(salida)} plantas, {sum(len(f["rooms"]) for f in salida)} salas leidas del SVG')
    for t, xs in (('nuevas', nuevas), ('reformadas', movidas), ('ya no estan', perdidas),
                  ('id limpiado de parentesis', [f'{a} -> {b}' for a, b in renombradas]),
                  ('plantas renombradas por su rotulo', plantas_renombradas)):
        print(f'  {t}: {len(xs)}')
        for x in xs[:12]:
            print(f'     {x}')
    if modo == '--write':
        modelo['floors'] = salida
        (here / 'modelo.json').write_text(json.dumps(modelo, ensure_ascii=False) + '\n')
        print('modelo.json actualizado')
    else:
        print('(--check: no se ha escrito nada)')

if __name__ == '__main__':
    main()
