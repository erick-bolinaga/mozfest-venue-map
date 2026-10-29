#!/usr/bin/env python3
"""Fetch MozFest's real programme from Accelevents and hang it from its rooms.

    python3 read-programme.py [--check | --write] [--from file.json]

RUN IT AT THE START OF EVERY WORK SESSION. The organisation edits the
programme whenever it likes, and `--check` writes nothing: it says whether
anything changed since last time. That way an added session or a moved room
shows the same day it happens, not three weeks later.

The API is public and asks for no credentials. It pages ten at a time unless
asked for a size; `size` is the parameter it understands, and neither `length`
nor `limit` nor `pageSize` does anything, so they return ten and the event
seems to have ten sessions.

A session says which room it is in with a text like `B2 Room` or `Main Stage`.
The code in front is what decides, because it is what the programme uses; if
there is no code, the whole text is tried against the document's names. The
code -> traced room mapping lives in venue.json, and a room that does not
exist is NOT written: build.py would stop the build, which is right, but the
warning is given here and by name.

What the organisation withdraws sometimes takes a while to leave the API.
Those sessions go by hand in withdrawn.json, by sessionId, and are not hung;
`--check` says whether the API still brings them and warns once they are no
longer needed.

Some stages are published as BLOCKS: a session titled with its own place
(«Open Source House Stage», fourteen of them) whose real agenda is in its
description, a «10:00 to 10:25» line and the talk below it. The list carries
no description for any session, so each block is opened through its own
detail and becomes one row per talk, titled with the first line under its
time: what follows is a speaker or a subtitle, with nothing to tell which
(2026-10-29). agendas.json, by hand, fixes the titles that need it. A block
whose detail cannot be read stays whole.

    --check          read the API, compare with sessions.json, write nothing
    --write          write sessions.json
    --from FILE      read from a saved dump instead of the network, to work without one
    --force          write even if more than five sessions would go at once
"""
import json, pathlib, re, sys, urllib.request, collections, datetime, html

here = pathlib.Path(__file__).parent
API = ('https://apiro.accelevents.com/r/events/mozilla-festival-2026'
       '/session/v2/get-all-sessions?size=500')
DETAIL = 'https://apiro.accelevents.com/r/events/mozilla-festival-2026/session/{}'
WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
SLOT = re.compile(r'^(\d{1,2}):(\d{2})\s*(?:to|-|–)\s*(\d{1,2}):(\d{2})$')


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'mozfest-mapa/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def fetch(source=None):
    if source:
        return json.loads(pathlib.Path(source).read_text())
    return get(API)


def is_block(s):
    """A session titled with its own place is a block with an agenda inside."""
    title = (s.get('title') or '').strip().lower()
    return bool(title) and title == (s.get('locationName') or s.get('location') or '').strip().lower()


def title_of(line, block, start, hand):
    """The title a talk is shown with: its slot's, by hand; else the hand title
    whose key the line is or starts with (the longest); else the line."""
    if f'{block} {start}' in hand.get('slots', {}):
        return hand['slots'][f'{block} {start}']
    keys = [k for k in hand.get('titles', {}) if line == k or line.startswith(k + ' ')]
    return hand['titles'][max(keys, key=len)] if keys else line


def agenda(block, description, hand):
    """The talks in a block's description: (start, end, title), each titled with
    the first line under its time."""
    text = re.sub(r'<br\s*/?>|</(?:div|p|li|h\d)>', '\n', description or '')
    lines = [l.strip() for l in html.unescape(re.sub(r'<[^>]+>', '', text)).replace('\xa0', ' ').splitlines()]
    lines = [l for l in lines if l]
    talks = []
    for i, l in enumerate(lines):
        m = SLOT.match(l)
        if m and i + 1 < len(lines) and not SLOT.match(lines[i + 1]):
            h1, m1, h2, m2 = m.groups()
            start = f'{int(h1):02d}:{m1}'
            talks.append((start, f'{int(h2):02d}:{m2}', title_of(lines[i + 1], block, start, hand)))
    return talks


def open_blocks(data, online):
    """Each block becomes its talks, as sessions like the others; what cannot be
    opened stays as it came. Returns the sessions and what happened, to print."""
    hand = json.loads((here / 'agendas.json').read_text())
    out, opened, kept = [], [], []
    for s in data:
        if not is_block(s):
            out.append(s)
            continue
        try:
            talks = (agenda(s['sessionId'], get(DETAIL.format(s['sessionId'])).get('description'), hand)
                     if online else [])
        except Exception as e:
            talks, why = [], str(e)
        else:
            why = 'no network (--from)' if not online else 'no «10:00 to 10:25» lines in it'
        if not talks:
            out.append(s)
            kept.append((s, why))
            continue
        date = s['startTime'][:10]
        out += [{**s, 'title': t, 'startTime': f'{date} {a}', 'endTime': f'{date} {b}'} for a, b, t in talks]
        opened.append((s, len(talks)))
    return out, opened, kept


def rooms_by_code():
    """From the organisation's document: code -> traced room, and also
    name -> room, which is what saves `Main Stage`, which has no code.
    And the 'programme' places, which are not rooms: the Music Stage is a
    piece of the set-up, and is named without looking at the code."""
    d = json.loads((here / 'venue.json').read_text())
    by_code, by_name = {}, {}
    for name, e in d.get('programme', {}).items():
        if not name.startswith('_'):
            by_name['programme:' + name.strip().lower()] = e['place']
    for code, e in d.get('spaces', {}).items():
        room = e.get('room')
        if not isinstance(room, str):
            continue                       # an unordered pair is no use to hang anything from
        by_code[code.upper()] = room
        if e.get('name'):
            by_name[e['name'].strip().lower()] = room
    return by_code, by_name


def to_room(location, by_code, by_name):
    if not location:
        return None
    # A place named in 'programme' wins over its code: «C5 - Music Stage» is the
    # stage, whatever C5 means in this file.
    without_code = re.sub(r'^[A-Z]\d*(?![a-z])\s*[-–·:]?\s*', '', location.strip()).lower()
    if 'programme:' + without_code in by_name:
        return by_name['programme:' + without_code]
    m = re.match(r'^([A-Z]\d*)\b', location.strip())
    if m and m.group(1) in by_code:
        return by_code[m.group(1)]
    return by_name.get(location.strip().lower())


def load_withdrawn():
    """sessionId -> entry of withdrawn.json: what the organisation has already
    removed and the API still publishes."""
    d = json.loads((here / 'withdrawn.json').read_text())
    return {int(k): v for k, v in d.get('sessions', {}).items()}


def row(s):
    start = datetime.datetime.strptime(s['startTime'], '%Y/%m/%d %H:%M')
    end = datetime.datetime.strptime(s['endTime'],   '%Y/%m/%d %H:%M')
    return {'date': start.strftime('%Y-%m-%d'),
            'day':   f'{WEEKDAYS[start.weekday()]} {start.day}',
            'start': start.strftime('%H:%M'),
            'end':    end.strftime('%H:%M'),
            'title': (s.get('title') or '').strip(),
            # The app's «Labs» tab is the WORKSHOP format (2026-10-29: the 28
            # labs in Erick's screenshots, all WORKSHOP, and the 29th between two).
            **({'lab': True} if s.get('format') == 'WORKSHOP' else {})}


def convert(data, by_code, by_name, skip=()):
    """From the API's session to the row the viewer shows. No room, no row in
    the viewer: the programme hangs from the floor plan, and a room that does
    not exist would be a session nobody can find. But it is still programme —
    the closing party is off site —, so it goes apart, in `loose`, with its
    `place`, so --check sees whether it changes. What is in `skip` goes nowhere.
    ('(no room)' is the place of a session with no location: it is stored in
    sessions.json, so it stays as it is.)"""
    by_room, no_room, loose = collections.defaultdict(list), collections.Counter(), []
    for s in data:
        if s.get('sessionId') in skip:
            continue
        room = to_room(s.get('location'), by_code, by_name)
        if not room:
            place = s.get('location') or '(no room)'
            no_room[place] += 1
            loose.append({'place': place, **row(s)})
            continue
        by_room[room].append(row(s))
    order = lambda x: (x['date'], x['start'], x['title'])
    for v in by_room.values():
        v.sort(key=order)
    loose.sort(key=order)
    return dict(sorted(by_room.items())), no_room, loose


def signature(d):
    """A session is its room, its day, its time and its title. With that we
    know whether what is written is still what the organisation publishes.
    Those in `_no_room` sign with their place: they are not shown, but they are
    watched all the same."""
    return ({(room, s['date'], s['start'], s['end'], s['title'])
             for room, ss in d.items() if not room.startswith('_') for s in ss}
            | {(s['place'], s['date'], s['start'], s['end'], s['title'])
               for s in d.get('_no_room', [])})


def main():
    mode = '--write' if '--write' in sys.argv else '--check'
    source = None
    if '--from' in sys.argv:
        source = sys.argv[sys.argv.index('--from') + 1]

    try:
        raw = fetch(source)
    except Exception as e:
        sys.exit(f'could not read the programme: {e}\n'
                 f'  the API is {API}\n'
                 f'  with no network, use --from with a saved dump')

    data = raw.get('data') or []
    total = raw.get('recordsTotal')
    if total and len(data) < total:
        sys.exit(f'the API says there are {total} sessions and returned only {len(data)}: '
                 f'it is paging again, check the size parameter')

    by_code, by_name = rooms_by_code()
    withdrawn = load_withdrawn()
    in_api = {s.get('sessionId'): s for s in data}
    sessions, opened, kept = open_blocks(data, source is None)
    new, no_room, loose = convert(sessions, by_code, by_name, withdrawn)

    old = json.loads((here / 'sessions.json').read_text())
    readme = old.pop('_readme', None)
    a, b = signature(old), signature({**new, '_no_room': loose})

    print(f'{len(data)} sessions in the API · {sum(len(v) for v in new.values())} '
          f'hung from {len(new)} rooms')
    if opened:
        print(f'  blocks with an agenda inside: {len(opened)}, opened into '
              f'{sum(n for _, n in opened)} talks')
    for s, why in kept:
        print(f"  CAREFUL: block {s['sessionId']} ({s['startTime']}, {s['title'][:40]}) kept whole: {why}")
    for t, xs in (('added', b - a), ('removed', a - b)):
        print(f'  {t}: {len(xs)}')
        for x in sorted(xs)[:14]:
            print(f'     {x[1]} {x[2]}  {x[4][:56]}   [{x[0]}]')
    if no_room:
        print(f'  no traced room: {sum(no_room.values())} sessions')
        for k, n in no_room.most_common():
            print(f'     {n:3d}  {k}')
    if withdrawn:
        print(f'  withdrawn by hand: {len(withdrawn)} (withdrawn.json)')
        for sid, r in sorted(withdrawn.items()):
            s = in_api.get(sid)
            if not s:
                print(f'     {sid}  no longer in the API: drop it from withdrawn.json')
            elif (s.get('title') or '').strip() != r.get('title', '').strip():
                print(f'     {sid}  CAREFUL: the API calls it «{(s.get("title") or "")[:56]}», '
                      f'not «{r.get("title", "")[:56]}»')
            else:
                print(f'     {sid}  still in the API: {r["title"][:56]}')

    # During the festival the API sometimes answers with only the sessions still
    # to come: on 2026-10-29 at 11:30 one call brought 102 of 163, the next one
    # 163 again, and --write took the 61 already held out of sessions.json.
    # The organisation removes one or two at a time; dozens at once is the API.
    if mode == '--write' and len(a - b) > 5 and '--force' not in sys.argv:
        sys.exit(f'{len(a - b)} sessions would go at once: the API sometimes returns only the ones '
                 f'still to come. Nothing written; run it again, and --force if it is real')

    if mode == '--write':
        out = {'_readme': [
            'Programa REAL de MozFest 2026, bajado de la API publica de Accelevents',
            'por read-programme.py. GENERADO: no editar a mano, se pierde al reimportar.',
            '',
            'Cada clave es una sala trazada. La correspondencia entre el codigo que usa',
            'el programa (B2, D3) y la sala vive en venue.json.',
            '',
            'Las sesiones sin sala trazada van en _no_room, con su lugar: el visor no las',
            'ensena (la fiesta de cierre es fuera del recinto), pero read-programme.py las',
            'vigila como a las demas y las lista al final para que se vea cuantas y de donde.',
        ]}
        out.update(new)
        out['_no_room'] = loose
        (here / 'sessions.json').write_text(
            json.dumps(out, ensure_ascii=False, indent=1) + '\n')
        print('sessions.json updated')
    else:
        print('(--check: nothing written)')


if __name__ == '__main__':
    main()
