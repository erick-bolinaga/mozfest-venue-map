#!/usr/bin/env python3
"""Assemble the viewer: viewer/ + model + vendored deps -> fabraicoats-3d.html

    python3 build.py [out.html]          the working build, comments and all
    python3 build.py --dist [out.html]   the clean deliverable -> dist/index.html
    python3 build.py --public [out]     the visitor's map, for participants
                                            -> dist/public/index.html

Everything the viewer needs lives in these files, so this is also the recovery
procedure: with viewer/, model.json and vendor/ you can rebuild the whole thing
from nothing. The result opens with no network — the venue may have none on the
day. To refresh vendor/: python3 fetch-vendor.py

The viewer's own code is viewer/: one classic <script>, cut into files by section
and concatenated back in the order VIEWER lists. Not ES modules, on purpose —
the sections share top-level constants and the test bench reaches them as
globals — so the cut is textual and every piece must start and end at the top
level (`node --check` on a piece alone says whether it does).

--dist is the same page with what does not run taken out: the design rationale
in the comments, the indentation, the blank lines. minify.py does that per
language and build.py refuses to write the file unless node agrees the clean
JS still parses. Same behaviour by construction, so the bench measures it too:
HTML=dist/index.html tools/with-chrome.sh node tools/check-viewer.js

--public is --dist seen from the visitor's rung and stripped of what that rung
does not need — volunteer posts and zones, staff names, working notes — with a
notice saying it is unofficial. Everything about it lives in public_version.py
and public/; the two builds above come out exactly as they did without it.
Its bench: tools/with-chrome.sh node tools/check-public.js
"""
import json, re, shutil, subprocess, sys, pathlib, tempfile, urllib.parse
from minify import minify, minify_js

here = pathlib.Path(__file__).parent
PUBLIC = '--public' in sys.argv
DIST = '--dist' in sys.argv or PUBLIC
_args = [a for a in sys.argv[1:] if a not in ('--dist', '--public')]
out  = (pathlib.Path(_args[0]) if _args
        else here.parent / 'dist' / 'public' / 'index.html' if PUBLIC
        else here.parent / 'dist' / 'index.html' if DIST
        else here.parent / 'fabraicoats-3d.html')
if PUBLIC:
    import public_version

# The viewer, in the order the pieces go into the page. Each is a contiguous
# slice of what was one file; the html pieces carry the tags that open and
# close the <style> and <script> the .css and .js pieces sit in.
VIEWER = [
    'head.html',    # doctype, head, the embedded fonts' <style>
    'styles.css',
    'body.html',      # the markup, and the <script> tags three.js and ours go in
    'data.js',         # the payloads, the profile ladder, ?dev=1
    'scene.js',        # renderer, cameras, lights, horizon
    'geometry.js',     # shape helpers and the shared materials
    'roofs.js',     # pitched roofs
    'buildings.js',     # every building: walls, caps, roofs, what is pickable
    'openings.js',        # façade openings and their joinery
    'details.js',      # cage, pitch, wire, canopies, the event's kit, trees, a figure
    'stations.js',       # where a volunteer post is and which space it belongs to
    'venue.js',       # chimney, zone tints, street names, the floor plans' home
    'camera.js',        # orbit, home view, touch
    'selection.js',     # picking and the site bubble
    'panel.js',         # the sheet: tabs, floors, days, rooms
    'interface.js',      # chrome: theme, layers, fullscreen, popovers, escape
    'search.js',      # search, and src/plan2d.js goes in here
    'routes.js',         # routes from A to B: the grid search and the route card
    'settings.js',       # text size, the ?dev=1 readout
    'placing.js',       # placing volunteers
    'boot.js',      # the opening flight
    'render.js',        # static merge and the on-demand render loop
    'foot.html',
]

def template():
    """The pieces, joined. The folder must hold exactly the files listed: a
    stray file would be silently left out, a missing one silently skipped,
    and both are the kind of thing that costs an afternoon."""
    folder = here / 'viewer'
    if not folder.is_dir():
        sys.exit('viewer/ is missing: it is the viewer\'s code, nothing generates it')
    present = {p.name for p in folder.iterdir() if p.is_file()}
    missing = [n for n in VIEWER if n not in present]
    extra = sorted(present - set(VIEWER))
    if missing or extra:
        sys.exit(f'viewer/ does not match the VIEWER list in build.py'
                 + (f' · missing: {", ".join(missing)}' if missing else '')
                 + (f' · not listed: {", ".join(extra)}' if extra else ''))
    pieces = [(n, (folder / n).read_text()) for n in VIEWER]
    if PUBLIC:
        pieces = public_version.pieces(pieces)
    if DIST:
        pieces = [(n, minify(n, s)) for n, s in pieces]
    return ''.join(s for _, s in pieces)

def check_syntax(js):
    """node --check on the clean script: the one thing a stripper can break
    that nothing else here would notice before the browser does."""
    node = shutil.which('node')
    if not node:
        sys.exit('--dist needs node to check the syntax of the clean JS')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(js); tmp = f.name
    r = subprocess.run([node, '--check', tmp], capture_output=True, text=True)
    pathlib.Path(tmp).unlink()
    if r.returncode:
        sys.exit('the clean JS fails node --check:\n' + r.stderr[:800])

def need(path, hint):
    if not path.exists():
        sys.exit(f'{path.name} is missing: {hint}')
    return path.read_text()

def logo(path):
    """Inline the festival mark. It is a solid tile with the design cut out of
    it, so the group fill paints the tile: handing that fill to currentColor is
    what lets one file serve both themes with no JavaScript at all."""
    s = need(path, 'it is the festival logo, export it from Figma')
    s = s[s.index('<svg'):]                       # drop the xml prolog and doctype
    head = s.index('>') + 1                       # the pt size belongs to the export,
    s = re.sub(r'\s(?:width|height)="[^"]*"', '', s[:head]) + s[head:]   # the layout sets the box
    if 'fill="#000000"' not in s:
        sys.exit(f'{path.name}: cannot find the group fill, did the export change?')
    return s.replace('fill="#000000"', 'fill="currentColor"')

def favicon(path):
    """The same mark as the tab's icon, inlined as a data: URL. Without one the
    browser asks the host for /favicon.ico and logs the 404. An icon has no
    currentColor to inherit, so it takes the ink of each theme from the
    system's scheme, the way the page does before anything is saved."""
    s = logo(path).replace('fill="currentColor"', 'fill="#17181B"')
    head = s.index('>') + 1
    s = (s[:head] + '<style>@media (prefers-color-scheme:dark){g{fill:#EDE7DB}}</style>'
         + s[head:])
    # Single quotes inside, so the attribute's double ones need no escaping and
    # an address still ends where public_version.watch() expects it to.
    s = ' '.join(s.replace('"', "'").split())
    return 'data:image/svg+xml,' + urllib.parse.quote(s, safe=" '/=:;,(){}.-")

def by_hand(path, hint):
    """A hand-written JSON payload, kept out of model.json on purpose: that file
    is regenerated from map.svg, so anything written into it by hand is lost at
    the next trace. The commentary key is dropped on the way in."""
    d = json.loads(need(path, hint))
    d.pop('_readme', None)
    return d

def names(path):
    """The hand-written names. A MozFest key that says "Building X" has to be
    the letter venue.json gives that building or that part: the Book
    of Answers calls L'Harmonia Building B, and a key left on Àster's nave
    would call the boiler room B too. An alias is just another name to search
    by, so it has to be text."""
    d = by_hand(path, 'they are the buildings\' names, written by hand')
    venue_buildings = json.loads(need(here / 'venue.json', '')).get('buildings', {})
    bad = []
    for k, v in d.items():
        m = re.fullmatch(r'Building ([A-Z])', v.get('key') or '')
        if m:
            e = venue_buildings.get(m.group(1)) or {}
            its_ids = {e.get('building'), e.get('part'), *e.get('also', [])} - {None}
            if k not in its_ids:
                bad.append(f'{k}: «{v["key"]}», and venue.json gives that letter to '
                             + (', '.join(sorted(its_ids)) or 'nothing'))
        if 'alias' in v and not (isinstance(v['alias'], list) and all(isinstance(a, str) for a in v['alias'])):
            bad.append(f'{k}: alias has to be a list of strings')
    if bad:
        sys.exit(f'{path.name}: ' + '\n  '.join(bad))
    return d

def views(path):
    """Where the search stands the camera for each building. Angles and a
    distance, never a position: a building may be re-traced but it does not
    move. Every key has to name a building that exists, or a view is written
    for a search result that can never happen."""
    d = by_hand(path, 'they are the per-building views, run python3 seed-views.py --write')
    buildings = {v.get('of') or v['id'] for v in json.loads(MODEL)['vols']}
    buildings.add('chimney')      # not a volume, but it is searched for and selected
    unknown = [k for k in d if k not in buildings]
    if unknown:
        sys.exit(f'{path.name}: these buildings do not exist in the model: ' + ', '.join(unknown))
    bad = [k for k, v in d.items()
             if not isinstance(v, dict) or not {'yaw', 'pitch', 'dist'} & set(v)
             or any(not isinstance(x, (int, float)) for x in v.values())]
    if bad:
        sys.exit(f'{path.name}: no numeric yaw/pitch/dist: ' + ', '.join(bad))
    return d

def event(gen, hand):
    """Everything the festival brings and the venue does not have. Two halves:
    what was traced in Figma, regenerated from the SVG by read-event.py, and
    what was not, written by hand and meant to be edited by whoever is running
    the event. They are merged here so the viewer sees one list.

    A hand entry places itself either on a room, by id, or by a polygon in
    model metres. Naming a room that does not exist is the one mistake that
    would put a stall somewhere nobody can reach, so it stops the build.

    And one with 'retired': true takes a traced piece away: the set-up
    changes the week before, and redrawing Figma to delete two squares is a
    detour (Erick, 2026-10-16: the giant games 1 and 2 go). Retiring an id
    that was never traced is a typo that would leave the piece standing, so
    that stops the build too."""
    a = by_hand(gen, 'python3 read-event.py --write generates it')['items']
    b = by_hand(hand, 'they are the event\'s points written by hand')['items']
    traced = {it['id'] for it in a}
    retired = {it['id'] for it in b if it.get('retired') is True}
    if retired - traced:
        sys.exit(f"{hand.name}: retires what is not traced: "
                 + ', '.join(sorted(retired - traced)))
    a = [it for it in a if it['id'] not in retired]
    b = [it for it in b if it.get('retired') is not True]
    rooms = {r['id'] for f in json.loads(MODEL)['floors'] for r in f['rooms']}
    for it in b:
        if 'room' in it and it['room'] not in rooms:
            sys.exit(f"{hand.name}: {it.get('id')} says it is in room "
                     f"{it['room']}, which does not exist")
        if 'room' not in it and 'poly' not in it:
            sys.exit(f"{hand.name}: {it.get('id')} does not say where it is: "
                     f"it needs 'room' or 'poly'")
        it.setdefault('est', True); it['src'] = 'by_hand'
    seen = {}
    for it in a + b:                      # the hand entry wins over the imported one
        seen[it['id']] = it
    return list(seen.values())

def _inside(p, poly):
    """Point in polygon, on model metres. The zone of anything is this and only
    this: it is never written down, so it can never disagree with the point."""
    x, y = p; c = False; n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def stations(path):
    """Where each volunteer goes, written by hand and placed from the viewer.

    A post with a `room` is indoors and is drawn on that floor's plan; without
    one it is outdoors and is drawn on the venue. Its building and floor are not
    stored: they follow from the room. A room that does not exist stops the
    build, for the same reason as in the programme — a post hung from an
    unreachable room is a volunteer nobody finds, and on a map people use to
    find their way that is worse than leaving it out.

    The code is the Book of Answers', which since 2026-10-16 numbers by ZONE:
    the letter is the zone of the captain who covers it and the number need
    not be a space («C2 Registration Tent exit» is at accreditation, and space
    C2 is the Music Stage). That is why it is no longer computed from the
    point, as it was from 13-Sep: it is written, and checked here to be whole.
    The zone POLYGON does not decide either: the door of Espai Vertical (F0)
    falls in E's, and so does the overflow's (D5), and the Book gives them to
    F and D."""
    d = by_hand(path, 'it is where each volunteer goes, written by hand')
    rooms = {r['id']: r for f in json.loads(MODEL)['floors'] for r in f['rooms']}
    PRIORITIES = ('high', 'medium', 'low')
    seen, bad_room, no_position, repeated, outside_room = set(), [], [], [], []
    bad_vc, bad_code, bad_name, bad_priority, bad_id, bad_team = [], [], [], [], [], []
    for p in d.get('stations', []):
        pid = p.get('id') or '(no id)'
        if p.get('room') and p['room'] not in rooms:
            bad_room.append(f"{pid} -> {p['room']}")
        if not isinstance(p.get('x'), (int, float)) or not isinstance(p.get('z'), (int, float)):
            no_position.append(pid)
            continue
        # The point of an indoor post falls in the room it names: the viewer
        # guarantees it when placing, and this guarantees it when the file is
        # edited by hand or pasted from a draft that is not of this model.
        if p.get('room') in rooms and rooms[p['room']].get('poly') \
                and not _inside((p['x'], p['z']), rooms[p['room']]['poly']):
            outside_room.append(f"{pid} -> {p['room']}")
        if p.get('id') in seen:
            repeated.append(p['id'])
        seen.add(p.get('id'))
        p.setdefault('h', 1.75)
        # 'vc' is a flag, not a rank or a text: either it is true or it is absent.
        if 'vc' in p and p['vc'] is not True:
            bad_vc.append(pid)
        # The Book's code: a zone letter A-G, a number, and sometimes what
        # tells it apart within it — «A0 Main», «D0 Corridor».
        code = p.get('code')
        if not isinstance(code, str) or not re.fullmatch(r'[A-G]\d+( [A-Z][a-z]+)?', code):
            bad_code.append(f'{pid}: {code!r}')
            continue
        if not (isinstance(p.get('name'), str) and p['name'].strip()):
            bad_name.append(pid)
        if p.get('priority') not in PRIORITIES:
            bad_priority.append(f"{pid}: {p.get('priority')!r}")
        if 'team' in p and not (isinstance(p['team'], str) and p['team'].strip()):
            bad_team.append(pid)
        # The id is the code without spaces plus a running number: E3-2, A0-Main-1.
        if not re.fullmatch(re.escape(code.replace(' ', '-')) + r'-\d+', str(p.get('id', ''))):
            bad_id.append(f'{pid} (code {code})')
    for found, msg in (
            (bad_room, 'these posts say they are in a room that does not exist'),
            (no_position, 'these posts do not say where they are (x or z missing)'),
            (repeated, 'these ids are repeated'),
            (bad_vc, "'vc' is true or absent, nothing else"),
            (bad_code, "'code' is the Book's: zone letter, number and sometimes a word, "
                         "like E3 or A0 Main"),
            (bad_name, "'name' is missing: the place as the Book says it, which is what goes over the radio"),
            (bad_priority, "'priority' is high, medium or low, the Book's colour"),
            (bad_team, "'team' is a text or absent"),
            (bad_id, "the id is the code without spaces and a number, like E3-2 or A0-Main-1"),
            (outside_room, 'the point of these posts does not fall inside the room they name; '
                         'place them again from the viewer')):
        if found:
            sys.exit(f'{path.name}: {msg}: ' + ', '.join(found))
    return d.get('stations', [])


def sessions(path):
    """The programme, generated by read-programme.py from the organisation's own
    scheduler. Every key has to name a room that exists — or a piece of the
    festival's kit, like the Music Stage — or the session is written into a
    place nobody can reach and simply never appears."""
    d = by_hand(path, 'it is the programme of sessions, run python3 read-programme.py --write')
    # _no_room: sessions with nowhere on the map (the closing party is off
    # site). read-programme.py keeps them to watch for changes; the viewer
    # never sees them.
    d = {k: v for k, v in d.items() if not k.startswith('_')}
    rooms = {r['id'] for f in json.loads(MODEL)['floors'] for r in f['rooms']}
    rooms |= {it['id'] for it in EVENT}
    orphans = [k for k in d if k not in rooms]
    if orphans:
        sys.exit(f'{path.name}: these rooms do not exist in the model: ' + ', '.join(orphans))
    return d

def venue(path, event_items):
    """The venue as the organisers name it (A1, B3, D4), against what was traced.
    Nothing here reaches the viewer: it is the table the programme hangs from,
    so a session can find its room. That is exactly why it has to be checked
    here — a re-trace renames or drops a room id and this table keeps pointing
    at it in silence, and the breakage only shows up as sessions that never
    appear. A space points at a room, at a whole volume, or at event kit."""
    d = by_hand(path, 'it is the venue as the organisation names it, written by hand')
    rooms = {r['id'] for f in json.loads(MODEL)['floors'] for r in f['rooms']}
    vols  = {v['id'] for v in json.loads(MODEL)['vols']}
    buildings = {v.get('of') or v['id'] for v in json.loads(MODEL)['vols']}
    areas = {b['id'] for b in json.loads(MODEL)['blocks']}
    kit   = {it['id'] for it in event_items}
    # A space may name a door: the venue's two entrances are neither a room
    # nor an area, and yet they are where a volunteer stands.
    doors = {e['id'] for e in json.loads(MODEL).get('entrances', [])}

    def refs(x):                       # a key takes a single id or a list
        return [] if x is None else (x if isinstance(x, list) else [x])

    broken = []
    for code, e in d.get('spaces', {}).items():
        for field, known, what in (('room',            rooms, 'room'),
                                     ('unordered_pair', rooms, 'room'),
                                     ('candidates',      rooms, 'room'),
                                     ('volume',         vols,  'volume'),
                                     ('area',            areas, 'ground area'),
                                     ('kit',        kit,   'set-up item'),
                                     ('entrances',        doors, 'door')):
            broken += [f'{code}: {what} {r}' for r in refs(e.get(field)) if r not in known]
    for name, e in d.get('programme', {}).items():
        if not name.startswith('_') and e.get('place') not in rooms | kit:
            broken.append(f'programme «{name}»: {e.get("place")}')
    for code, b in d.get('buildings', {}).items():
        broken += [f'building {code}: {r}'         for r in refs(b.get('building')) if r not in buildings]
        broken += [f'building {code}: volume {r}' for r in refs(b.get('part'))    if r not in vols]
        broken += [f'building {code}: entrance {r}' for r in refs(b.get('entrances')) if r not in doors]
        broken += [f'building {code}: also {r}' for r in refs(b.get('also')) if r not in buildings]
    if broken:
        sys.exit(f'{path.name}: these references no longer exist in the model:\n  '
                 + '\n  '.join(broken))

    # And the zones must name things in this same file: 'building-A' is the
    # letter in 'buildings', and 'C3' is a code in 'spaces'.
    unknown = []
    for z, v in d.get('zones', {}).items():
        for name in v.get('contains', []):
            key = name.split('-', 1)[1] if name.startswith(('building-', 'entrance-')) else name
            if key not in d.get('buildings', {}) and key not in d.get('spaces', {}):
                unknown.append(f'zone {z}: {name}')
    if unknown:
        sys.exit(f'{path.name}: these zones contain something that is not in the file: '
                 + ', '.join(unknown))

    # And the zones' trace must say the same as the document. A post's zone is
    # computed by point in polygon and never written, so the polygon IS the
    # assignment: if the organisation puts parents and babies in D0 and D's
    # polygon does not reach that far, every post placed in that strip comes
    # out with no zone. It happened on 2026-09-11 with five items of D0 and a
    # room of B, and nothing in the code showed it. The centre of everything
    # the document puts in a space with a zone is checked: rooms, volumes,
    # ground and set-up. The C spaces say their zone; the rest inherit it
    # from their letter.
    zone_polys = {z['zid']: z['poly'] for z in json.loads(MODEL).get('zones', [])}
    poly_of = {}
    poly_of.update({r['id']: r['poly'] for f in json.loads(MODEL)['floors'] for r in f['rooms'] if r.get('poly')})
    poly_of.update({v['id']: v['poly'] for v in json.loads(MODEL)['vols']})
    poly_of.update({b['id']: b['poly'] for b in json.loads(MODEL)['blocks'] if b.get('poly')})
    poly_of.update({it['id']: it['poly'] for it in event_items if it.get('poly')})

    inside = _inside

    outside = []
    for code, e in d.get('spaces', {}).items():
        z = e.get('zone') or d.get('buildings', {}).get(code[:1], {}).get('zone')
        if z not in zone_polys:
            continue
        for field in ('room', 'unordered_pair', 'volume', 'area', 'kit'):
            for rid in refs(e.get(field)):
                poly = poly_of.get(rid)
                if not poly:
                    continue
                c = (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
                if not inside(c, zone_polys[z]):
                    falls_in = [q for q, pl in zone_polys.items() if inside(c, pl)]
                    outside.append(f'{code} {rid}: the document puts it in zone {z} and the trace '
                                 + (f'in {", ".join(falls_in)}' if falls_in else 'in none'))
    if outside:
        sys.exit(f'{path.name}: the zones\' trace does not match the document; '
                 f'retrace the zone in Figma and run read-zones.py --write:\n  '
                 + '\n  '.join(outside))

    # The only thing from here that reaches the viewer: what MozFest calls each
    # traced room. The venue's name and MozFest's are two names for one room —
    # Aula 9 is Escolta — and until now only buildings could show both. A room
    # may carry two codes: F3 and F4 are the same unordered pair, and saying
    # 'F3 / F4' is more honest than picking one. The same goes for the set-up:
    # the dome is C2 and the food trucks are C3. The C spaces are not traced —
    # the document calls the whole outdoors 'Space C outside' — and are
    # resolved by labelling what is inside them, so this is the only way a
    # tent has to say which space it belongs to.
    by_room = {}
    for code, e in sorted(d.get('spaces', {}).items()):
        for sid in (refs(e.get('room')) + refs(e.get('unordered_pair'))
                    + refs(e.get('volume')) + refs(e.get('kit')) + refs(e.get('area'))):
            if sid in rooms or sid in vols or sid in kit or sid in areas:
                v = by_room.setdefault(sid, {'code': [], 'name': e.get('name')})
                v['code'].append(code)
    # A code is a letter and some digits — A0, B4, D2 —, a letter alone — D is
    # the Main Stage, 'D. Main Stage' in the deck — or a digit, since the
    # entrances are 0 and 1. A compound key like 'F-production' is my own label
    # for a space the document names without a number, and it is no use over
    # the radio, so only its name comes out.
    def codes(cs):
        return ' / '.join(c for c in cs if re.fullmatch(r'[A-Z]\d*|\d+', c))
    return {k: {'code': codes(v['code']), 'name': v['name']}
            for k, v in by_room.items()}


tpl    = template()
MODEL = need(here / 'model.json', 'it is the model, nothing generates it')
# The set-up is assembled once: the viewer carries it and the venue checks it.
EVENT  = event(here / 'event.json', here / 'event-by-hand.json')
# Not just another payload: it is the table the programme will hang from, and it
# is checked here so a re-trace that moves a room stops the build. What comes
# back is the one thing the viewer needs from it, the MozFest code of each room.
MOZFEST = venue(here / 'venue.json', EVENT)
# Routes from A to B: the walking grid and the public doors (src/routes.py,
# src/doors.json). A door that does not exist, or a public door the Main
# entrance cannot reach, stops the build: a route that silently cannot be
# walked is worse than no route.
import routes
ROUTES = routes.build(json.loads(MODEL), EVENT,
                        json.loads(need(here / 'doors.json', 'which doors a route uses, by hand')),
                        json.loads(need(here / 'walkable.json', 'where people walk outside the zones, by hand')))
_err = routes.validate(ROUTES, {k: v for k, v in json.loads(need(here / 'sessions.json', '')).items()
                             if not k.startswith('_')})
if _err:
    sys.exit('doors.json: ' + '\n  '.join(_err))

parts = {
    '__DATA__':     MODEL,
    '__NAMES__':  json.dumps(names(here / 'names.json'), ensure_ascii=False),
    '__SESSIONS__': json.dumps(sessions(here / 'sessions.json'), ensure_ascii=False),
    '__VIEWS__':   json.dumps(views(here / 'views.json'), ensure_ascii=False),
    '__EVENT__':   json.dumps(EVENT, ensure_ascii=False),
    '__MOZFEST__':  json.dumps(MOZFEST, ensure_ascii=False),
    # The walking grid and the public doors the viewer's route search uses:
    # the SAME result routes.validate() has just accepted, so the viewer can
    # never route through a door the build would have rejected.
    '__ROUTES__':    json.dumps(routes.for_viewer(ROUTES), ensure_ascii=False, separators=(',', ':')),
    '__STATIONS__': json.dumps(stations(here / 'stations.json'),
                                  ensure_ascii=False),
    # The file's notes go to the viewer as they are, so the download button
    # gives back the WHOLE file and whoever places sends it without pasting anything.
    '__STATIONS_README__': json.dumps(json.loads(need(here / 'stations.json', ''))
                                        .get('_readme', []), ensure_ascii=False),
    '__PLAN2D__':  (minify_js if DIST else str)(
                        need(here / 'plan2d.js', 'it is the floors\' 2D plan, nothing generates it')),
    '__THREE_JS__': need(here / 'vendor' / 'three.min.js', 'run python3 fetch-vendor.py'),
    '__FONTS__':  need(here / 'vendor' / 'fonts.css',  'run python3 fetch-vendor.py'),
    '__LOGO__':     logo(here / 'mozfest-logo.svg'),
    '__FAVICON__':  favicon(here / 'mozfest-logo.svg'),
}

# Check the template, never the output: the payloads are third-party blobs and
# three.js legitimately contains the string __THREE__ (its own global).
for marker in parts:
    if tpl.count(marker) != 1:
        sys.exit(f'{marker} appears {tpl.count(marker)} times in the template, expected 1')
# The public build may carry one link, to the source; watch() checks every
# address in its finished page instead, which is the stricter of the two.
if 'https://' in tpl and not PUBLIC:
    sys.exit('the template still asks for something over the network: ' + re.search(r'https://\S{0,60}', tpl).group())

# The visitor's map carries only what the visitor's rung needs.
if PUBLIC:
    parts = public_version.data(parts)

# One pass, so a payload that happens to contain another marker cannot eat it.
html = re.sub('|'.join(parts), lambda m: parts[m.group()], tpl)

# And a last look before it is written: a public file is published for good.
if PUBLIC:
    _bad = public_version.watch(html, parts)
    if _bad:
        sys.exit('--public: this cannot go out in the public version:\n  ' + '\n  '.join(_bad))

if DIST:
    # Our script only: three.js is minified upstream and untouched here.
    own = html[html.rindex('<script>') + len('<script>'):html.rindex('</script>')]
    check_syntax(own)
    out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
D = json.loads(parts['__DATA__'])
N = json.loads(parts['__NAMES__'])
S = json.loads(parts['__SESSIONS__'])
V = json.loads(parts['__VIEWS__'])
EV = json.loads(parts['__EVENT__'])
VOL = json.loads(parts['__STATIONS__'])
unconfirmed = sum(1 for v in N.values() if v.get('to_confirm'))
n_sessions  = sum(len(v) for v in S.values())
# Outdoors and indoors counted apart: they are drawn in different places, so a
# post that lands on the wrong side shows here before it does on screen.
indoors  = sum(1 for p in VOL if p.get('room'))
print(f"{out}  ·  {len(D['vols'])} volumes, {len(D['openings'])} openings, "
      f"{len(D['floors'])} floors  ·  {len(N)} names ({unconfirmed} to confirm)"
      f"  ·  {n_sessions} sessions in {len(S)} rooms  ·  {len(V)} views"
      f"  ·  {len(EV)} event items"
      f"  ·  {len(VOL)} stations ({indoors} indoors)"
      f"  ·  {len(ROUTES['doors'])} doors, grid {ROUTES['width']}×{ROUTES['height']}"
      f"  ·  {len(html)/1e6:.2f} MB, offline" + (", clean" if DIST else "")
      + (", public" if PUBLIC else ""))
