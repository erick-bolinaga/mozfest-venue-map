#!/usr/bin/env python3
"""Fetch MozFest's booths and art pieces from Accelevents, keeping where each one is.

    python3 read-booths.py [--check | --write] [--from file.json]

The festival's app lists them under Expo: «Booths» and «Art and Installations».
The list is public, like the programme, but WHERE each one stands is not in it
—only two of the 62 carry a location— and the detail of each one asks for a
login. So the list comes from the API and the place goes by hand, read off the
app (Erick, 2026-10-29, at the festival: people kept asking for booths).

booths.json keeps both halves in one row per exhibitor, by its API id:
`name` and `kind` come from the API and are rewritten on every --write;
`where` (the place as the app says it), `place` (the room or the piece of
the festival's kit it hangs from, by id), `days` (date -> position, from the
organisation's «Art and Booths List»: the booths change every day) and `why`
are by hand and are never touched, like `alias`: the organisation behind a
booth, from its logo in the app, which is what people ask for. A row whose id starts with `hand-` is not
in the API at all and is kept as it is.
A row with no `place` is kept but the viewer does not show it: a search result
that cannot land is worse than none. What the app hides from its Expo
(`hideFromExpo`) is left out. Descriptions are not kept: they carry people's
names and emails, and the map only needs to say where.

    --check          read the API, compare with booths.json, write nothing
    --write          write booths.json, keeping every hand field
    --from FILE      read from a saved dump instead of the network
"""
import json, pathlib, sys, urllib.request

here = pathlib.Path(__file__).parent
API = ('https://api.accelevents.com/rest/event/mozilla-festival-2026'
       '/exhibitor?page=0&size=500&searchString=')
KINDS = {'Booths': 'booth', 'Art and Installations': 'art'}
HAND = ('where', 'place', 'why', 'days', 'alias')


def fetch(source=None):
    if source:
        return json.loads(pathlib.Path(source).read_text())
    req = urllib.request.Request(API, headers={'User-Agent': 'mozfest-mapa/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def by_hand(i):
    """A row the API does not have, written by hand from the organisation's own
    list (Tech for Palestine, 2026-10-29): its id says so, and it is kept."""
    return isinstance(i, str) and i.startswith('hand-')


def convert(data):
    """From the API's exhibitor to the generated half of a row."""
    rows = {}
    for e in data:
        if e.get('hideFromExpo'):
            continue
        cats = [KINDS.get(c) for c in e.get('categoryNames') or []]
        rows[e['id']] = {'id': e['id'], 'name': (e.get('exhibitorName') or '').strip(),
                         'kind': next((c for c in cats if c), 'booth'),
                         'api_location': (e.get('location') or '').strip()}
    return rows


def main():
    mode = '--write' if '--write' in sys.argv else '--check'
    source = sys.argv[sys.argv.index('--from') + 1] if '--from' in sys.argv else None
    try:
        raw = fetch(source)
    except Exception as e:
        sys.exit(f'could not read the booths: {e}\n  the API is {API}\n'
                 f'  with no network, use --from with a saved dump')
    data = raw.get('data') or []
    if raw.get('recordsTotal') and len(data) < raw['recordsTotal']:
        sys.exit(f"the API says there are {raw['recordsTotal']} and returned only {len(data)}: "
                 f'it is paging again, check the size parameter')

    path = here / 'booths.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    old_rows = {b['id']: b for b in old.get('booths', [])}
    new = convert(data)

    added = [new[i] for i in new if i not in old_rows]
    removed = [old_rows[i] for i in old_rows if i not in new and not by_hand(i)]
    renamed = [(old_rows[i], new[i]) for i in new
               if i in old_rows and (old_rows[i]['name'], old_rows[i]['kind'])
               != (new[i]['name'], new[i]['kind'])]
    print(f'{len(data)} in the API · {len(new)} shown in the app '
          f"({sum(r['kind'] == 'booth' for r in new.values())} booths, "
          f"{sum(r['kind'] == 'art' for r in new.values())} art)")
    for t, xs in (('added', added), ('removed', removed)):
        print(f'  {t}: {len(xs)}')
        for x in xs[:20]:
            print(f"     {x['id']}  {x['kind']:5}  {x['name'][:60]}")
    if renamed:
        print(f'  renamed: {len(renamed)}')
        for a, b in renamed:
            print(f"     {a['id']}  «{a['name'][:40]}» → «{b['name'][:40]}» ({b['kind']})")
    # The API's own location, when it has one, against the hand-written place.
    for i, r in new.items():
        h = old_rows.get(i, {})
        if r['api_location'] and r['api_location'] != h.get('api_location'):
            print(f"  the API now says where «{r['name'][:40]}» is: {r['api_location']}")
    unplaced = [r for i, r in new.items() if not old_rows.get(i, {}).get('place')]
    print(f'  without a place: {len(unplaced)} (not shown in the viewer)')

    if mode == '--write':
        rows = []
        for i, r in new.items():
            h = old_rows.get(i, {})
            rows.append({**r, **{k: h[k] for k in HAND if h.get(k)}})
        rows += [b for i, b in old_rows.items() if by_hand(i)]
        rows.sort(key=lambda r: (r['kind'], r['name'].lower()))
        out = {'_readme': old.get('_readme') or [
            'Los booths y las piezas de arte del festival, de la API pública de Accelevents',
            '(la sección Expo de la app), por read-booths.py.',
            '',
            'name, kind y api_location son de la API y se reescriben en cada --write.',
            'where (el sitio como lo dice la app), place (la sala o la pieza del montaje,',
            'por id), days (fecha -> posición, de la hoja «Art and Booths List» de la',
            'organización: los booths cambian cada día) y why son A MANO y read-booths.py',
            'no los toca nunca. Una fila sin place no sale en el visor. Una fila con id',
            '«hand-…» no está en la API y se conserva tal cual. Lo que la app oculta de su',
            'Expo no se escribe.',
        ], 'booths': rows}
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
        print('booths.json updated')
    else:
        print('(--check: nothing written)')


if __name__ == '__main__':
    main()
