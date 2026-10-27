"""The public build: what build.py --public does on top of --dist.

    python3 build.py --public   ->  dist/public/index.html

The map Mozilla would show to participants. It is the same viewer, seen from
the bottom rung of the ladder and carrying nothing that rung does not need:

- the rung is the visitor's, always: ?dev=1 and ?as= open nothing, so there is
  no workbench, no impersonation and no placing;
- no volunteer posts, no volunteer zones, no index to resolve a post's space;
- staff-only places keep their shape, are called «Staff only», lose their own
  name and id, and are no destination: out of the search, no Directions;
- no working notes in the data, and a notice that says what this map is.

Why a separate file and not the same file with parts hidden: anything a page
carries can be read with view-source, whatever the page decides to show. What
must not be published is not put in.

It touches nothing the working build reads. The changes to the viewer's code
are a short list of exact replacements, each of which must match once in the
piece it names, or the build stops: if the code they patch changes shape, the
build says so instead of shipping a visitor's map with the workbench on. The
public-only code and styles live in public/, and the texts in
public/public.json, which is the one place to change what the notice says.

Last, a guard over the finished page: names of people anywhere, working words
and post codes in the data, any address other than the SVG and XHTML
namespaces (and the source link, when there is one). Any of them stops the
build and says where.
"""
import html as _html
import json
import re
import sys
from pathlib import Path

here = Path(__file__).parent
FOLDER = here / 'public'
CONF_PATH = FOLDER / 'public.json'


def conf():
    if not CONF_PATH.exists():
        sys.exit(f'{CONF_PATH} is missing: it holds the public version\'s texts')
    c = json.loads(CONF_PATH.read_text())
    c.pop('_readme', None)
    a = c.get('notice', {})
    for k in ('short', 'long'):
        if not (isinstance(a.get(k), str) and a[k].strip()):
            sys.exit(f"{CONF_PATH.name}: notice.{k} has to be a text")
    code_url = a.get('code_url') or ''
    if code_url and not re.fullmatch(r'https://[^\s"<>]+', code_url):
        sys.exit(f"{CONF_PATH.name}: notice.code_url has to be an https:// address, or empty")
    return c


C = conf()
e = _html.escape


def _about():
    a = C['notice']
    link = (f'<p><a href="{e(a["code_url"])}" target="_blank" rel="noopener">'
              f'{e(a.get("code_text") or "Source code")}</a></p>'
              if a.get('code_url') else '')
    credits = f'<p class="credits">{e(a["credits"])}</p>' if a.get('credits') else ''
    return (f'  <div class="rule"></div>\n'
            f'  <div class="about" id="about">\n'
            f'    <p>{e(a["long"])}</p>\n'
            f'    {link}{credits}\n'
            f'  </div>\n')


# (piece, what is there, what goes instead, why). Each must match exactly once.
PATCHES = [
    ('data.js',
     "const DEV = new URLSearchParams(location.search).has('dev');",
     "const DEV = false;",
     'no workbench and no ?as=: impersonating cannot be a way in'),
    ('data.js',
     "const RUNG_DEFAULT = LADDER.indexOf('volunteer');",
     "const RUNG_DEFAULT = LADDER.indexOf('visitor');",
     "the public's rung is the bottom one"),
    ('panel.js',
     "    kit && kit.poly\n      ? routeButton(`point:",
     "    kit && kit.poly && kit.kind !== 'crew'\n      ? routeButton(`point:",
     'nobody is sent to a staff-only place'),
    ('body.html',
     '    <p>Recinte Fabra i Coats</p>\n',
     '    <p>Recinte Fabra i Coats</p>\n'
     f'    <p class="notice">{e(C["notice"]["short"])}</p>\n',
     'the short notice, always in sight'),
    ('body.html',
     '      <button id="uiUp" aria-label="Larger text">+</button>\n    </span>\n  </div>\n</div>\n',
     '      <button id="uiUp" aria-label="Larger text">+</button>\n    </span>\n  </div>\n'
     + _about() + '</div>\n',
     'the long notice, the source link and the credits, at the end of the menu'),
]

# The public-only pieces, and the piece each goes in right after.
EXTRAS = [('styles.css', 'public.css'), ('search.js', 'public.js')]


def pieces(items):
    """The viewer's pieces with the patches applied and the public-only pieces
    put in. Runs on the raw pieces, before minify, so a patch matches the
    source as it is written."""
    items = list(items)
    names = [n for n, _ in items]
    for piece, before, after, why in PATCHES:
        if piece not in names:
            sys.exit(f'--public: there is no piece {piece} ({why})')
        i = names.index(piece)
        n = items[i][1].count(before)
        if n != 1:
            sys.exit(f'--public: in {piece} the patched text appears {n} times, expected 1 '
                     f'({why}). If the code changed, change the patch in public_version.py:\n  '
                     + before.splitlines()[0])
        items[i] = (piece, items[i][1].replace(before, after))
    for after_piece, extra in EXTRAS:
        src = (FOLDER / extra).read_text()
        i = [n for n, _ in items].index(after_piece)
        items.insert(i + 1, (extra, src))
    return items


STAFF = 'Staff only'
NOTE_KEYS = {'why', 'caution', 'note', 'notes', 'doubt', 'source', 'to_confirm', 'confirmed'}


def _without_notes(x):
    """Every key a person wrote for another person, at any depth."""
    if isinstance(x, dict):
        return {k: _without_notes(v) for k, v in x.items()
                if not k.startswith('_') and k not in NOTE_KEYS}
    if isinstance(x, list):
        return [_without_notes(v) for v in x]
    return x


def shown(event):
    """The kit the public build carries: all but what is marked 'public_map':
    false, whose place is not to be shared. Not even as a staff-only shape, and
    not as cells of the walking grid either: build.py builds the public grid
    from this list, or the hidden kit would still be there for anyone decoding
    ROUTES, as rectangles nobody can walk through."""
    return [it for it in event if it.get('public_map') is not False]


def data(parts):
    """The payloads, reduced to what a visitor's map needs. Returns new parts."""
    p = dict(parts)
    D = _without_notes(json.loads(p['__DATA__']))
    EV = _without_notes(json.loads(p['__EVENT__']))
    MZ = json.loads(p['__MOZFEST__'])
    NM = _without_notes(json.loads(p['__NAMES__']))

    # The volunteer zones are how the organisation splits its crew; the
    # visitor's rung never draws them. Their names go with them.
    zones = {'z-' + z['zid'] for z in D.get('zones', [])}
    D['zones'] = []
    D['names'] = {k: v for k, v in D.get('names', {}).items() if k not in zones}

    # Kit marked 'public_map': false leaves whole; see shown().
    kept = shown(EV)
    hidden = {it['id'] for it in EV} - {it['id'] for it in kept}
    EV = kept
    MZ = {k: v for k, v in MZ.items() if k not in hidden}

    # Staff-only: the shape stays, the name and the id go. A crew id can carry
    # a person's name (it did), so every one becomes staff-N, everywhere.
    staff = []
    for f in D['floors']:
        for r in f.get('rooms', []):
            if r.get('kind') == 'crew':
                staff.append(r['id']); r['name'] = STAFF
    for it in EV:
        if it.get('kind') == 'crew':
            staff.append(it['id']); it['label'] = STAFF
    # The kind's label goes blank, not «Staff only» too: the bubble prints the
    # name and then the kind, and said the same thing twice.
    if 'crew' in D.get('kinds', {}):
        D['kinds']['crew']['label'] = ''
    MZ = {k: v for k, v in MZ.items() if k not in staff}

    # The organisation's names for its spaces, where one is a working note.
    used = set()
    for v in MZ.values():
        if v.get('name') in C.get('rename', {}):
            used.add(v['name']); v['name'] = C['rename'][v['name']]
    unused = sorted(set(C.get('rename', {})) - used)
    if unused:
        print(f'warning: {CONF_PATH.name}: rename is no longer used for ' + ', '.join(unused)
              + '; it can be removed', file=sys.stderr)

    p['__DATA__'] = json.dumps(D, ensure_ascii=False)
    p['__EVENT__'] = json.dumps(EV, ensure_ascii=False)
    p['__MOZFEST__'] = json.dumps(MZ, ensure_ascii=False)
    p['__NAMES__'] = json.dumps(NM, ensure_ascii=False)
    p['__STATIONS__'] = '[]'
    p['__STATIONS_README__'] = '[]'

    new_ids = {v: f'staff-{i}' for i, v in enumerate(dict.fromkeys(staff), 1)}
    for k in DATA_KEYS:
        for old, new in new_ids.items():
            p[k] = p[k].replace(json.dumps(old, ensure_ascii=False),
                                json.dumps(new, ensure_ascii=False))
    return p


# The payloads that are data, as opposed to code (three.js, plan2d, fonts, logo).
DATA_KEYS = ['__DATA__', '__NAMES__', '__SESSIONS__', '__VIEWS__', '__EVENT__',
         '__MOZFEST__', '__ROUTES__', '__STATIONS__',
         '__STATIONS_README__']
NAMESPACES = {'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml'}


def watch(html, parts):
    """What the public file must never carry. Returns the list of problems."""
    bad = []
    for name in C['forbidden']['everywhere']:
        n = len(re.findall(r'\b%s\b' % re.escape(name), html, re.I))
        if n:
            bad.append(f'«{name}» appears {n} times in the file')
    for k in DATA_KEYS:
        for pattern in C['forbidden']['in_data']:
            m = re.search(pattern, parts[k], re.I)
            if m:
                bad.append(f'{k}: «{m.group()}» (/{pattern}/) in …'
                             + parts[k][max(0, m.start() - 50):m.end() + 50] + '…')
    allowed = NAMESPACES | ({C['notice']['code_url']} if C['notice'].get('code_url') else set())
    for u in sorted(set(re.findall(r'https?://[^\s"\'<>)]+', html)) - allowed):
        bad.append(f'an address: {u}')
    return bad
