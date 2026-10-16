"""The public build: what armar.py --publico does on top of --dist.

    python3 armar.py --publico   ->  dist/publico/index.html

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
public-only code and styles live in publico/, and the texts in
publico/publico.json, which is the one place to change what the notice says.

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
CARPETA = here / 'publico'
CONF_PATH = CARPETA / 'publico.json'


def conf():
    if not CONF_PATH.exists():
        sys.exit(f'falta {CONF_PATH}: son los textos de la versión pública')
    c = json.loads(CONF_PATH.read_text())
    c.pop('_leeme', None)
    a = c.get('aviso', {})
    for k in ('corto', 'largo'):
        if not (isinstance(a.get(k), str) and a[k].strip()):
            sys.exit(f"{CONF_PATH.name}: aviso.{k} tiene que ser un texto")
    cod = a.get('codigo') or ''
    if cod and not re.fullmatch(r'https://[^\s"<>]+', cod):
        sys.exit(f"{CONF_PATH.name}: aviso.codigo tiene que ser una dirección https://, o vacío")
    return c


C = conf()
e = _html.escape


def _acerca():
    a = C['aviso']
    enlace = (f'<p><a href="{e(a["codigo"])}" target="_blank" rel="noopener">'
              f'{e(a.get("codigo_texto") or "Source code")}</a></p>'
              if a.get('codigo') else '')
    creditos = f'<p class="creditos">{e(a["creditos"])}</p>' if a.get('creditos') else ''
    return (f'  <div class="rule"></div>\n'
            f'  <div class="acerca" id="acerca">\n'
            f'    <p>{e(a["largo"])}</p>\n'
            f'    {enlace}{creditos}\n'
            f'  </div>\n')


# (piece, what is there, what goes instead, why). Each must match exactly once.
PARCHES = [
    ('datos.js',
     "const DEV = new URLSearchParams(location.search).has('dev');",
     "const DEV = false;",
     'sin banco de trabajo y sin ?as=: suplantar no puede ser una puerta'),
    ('datos.js',
     "const RUNG_SIN_PARAMETROS = LADDER.indexOf('voluntario');",
     "const RUNG_SIN_PARAMETROS = LADDER.indexOf('visitante');",
     'el peldaño del público es el de abajo'),
    ('panel.js',
     "    kit && kit.poly\n      ? rutaBoton(`punto:",
     "    kit && kit.poly && kit.kind !== 'crew'\n      ? rutaBoton(`punto:",
     'a un sitio solo para el personal no se manda a nadie'),
    ('cuerpo.html',
     '    <p>Recinte Fabra i Coats</p>\n',
     '    <p>Recinte Fabra i Coats</p>\n'
     f'    <p class="aviso">{e(C["aviso"]["corto"])}</p>\n',
     'el aviso corto, siempre a la vista'),
    ('cuerpo.html',
     '      <button id="uiUp" aria-label="Larger text">+</button>\n    </span>\n  </div>\n</div>\n',
     '      <button id="uiUp" aria-label="Larger text">+</button>\n    </span>\n  </div>\n'
     + _acerca() + '</div>\n',
     'el aviso largo, el enlace al código y los créditos, al final del menú'),
]

# The public-only pieces, and the piece each goes in right after.
EXTRAS = [('estilos.css', 'publico.css'), ('buscador.js', 'publico.js')]


def piezas(lista):
    """The viewer's pieces with the patches applied and the public-only pieces
    put in. Runs on the raw pieces, before limpiar, so a patch matches the
    source as it is written."""
    lista = list(lista)
    nombres = [n for n, _ in lista]
    for pieza, antes, despues, por in PARCHES:
        if pieza not in nombres:
            sys.exit(f'--publico: no hay pieza {pieza} ({por})')
        i = nombres.index(pieza)
        n = lista[i][1].count(antes)
        if n != 1:
            sys.exit(f'--publico: en {pieza} lo que se parchea aparece {n} veces y se esperaba 1 '
                     f'({por}). Si cambió el código, cambia el parche en version_publica.py:\n  '
                     + antes.splitlines()[0])
        lista[i] = (pieza, lista[i][1].replace(antes, despues))
    for tras, extra in EXTRAS:
        src = (CARPETA / extra).read_text()
        i = [n for n, _ in lista].index(tras)
        lista.insert(i + 1, (extra, src))
    return lista


STAFF = 'Staff only'
NOTAS = {'por', 'ojo', 'nota', 'notas', 'duda', 'fuente', 'confirmar', 'confirmado'}


def _sin_notas(x):
    """Every key a person wrote for another person, at any depth."""
    if isinstance(x, dict):
        return {k: _sin_notas(v) for k, v in x.items()
                if not k.startswith('_') and k not in NOTAS}
    if isinstance(x, list):
        return [_sin_notas(v) for v in x]
    return x


def datos(parts):
    """The payloads, reduced to what a visitor's map needs. Returns new parts."""
    p = dict(parts)
    D = _sin_notas(json.loads(p['__DATA__']))
    EV = _sin_notas(json.loads(p['__EVENTO__']))
    MZ = json.loads(p['__MOZFEST__'])
    NM = _sin_notas(json.loads(p['__NOMBRES__']))

    # The volunteer zones are how the organisation splits its crew; the
    # visitor's rung never draws them. Their names go with them.
    zonas = {'z-' + z['zid'] for z in D.get('zones', [])}
    D['zones'] = []
    D['names'] = {k: v for k, v in D.get('names', {}).items() if k not in zonas}

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
    usados = set()
    for v in MZ.values():
        if v.get('nombre') in C.get('renombrar', {}):
            usados.add(v['nombre']); v['nombre'] = C['renombrar'][v['nombre']]
    sobran = sorted(set(C.get('renombrar', {})) - usados)
    if sobran:
        print(f'aviso: {CONF_PATH.name}: renombrar ya no se usa para ' + ', '.join(sobran)
              + '; se puede quitar', file=sys.stderr)

    p['__DATA__'] = json.dumps(D, ensure_ascii=False)
    p['__EVENTO__'] = json.dumps(EV, ensure_ascii=False)
    p['__MOZFEST__'] = json.dumps(MZ, ensure_ascii=False)
    p['__NOMBRES__'] = json.dumps(NM, ensure_ascii=False)
    p['__VOLUNTARIOS__'] = '[]'
    p['__VOLUNTARIOS_LEEME__'] = '[]'

    nuevos = {v: f'staff-{i}' for i, v in enumerate(dict.fromkeys(staff), 1)}
    for k in DATOS:
        for viejo, nuevo in nuevos.items():
            p[k] = p[k].replace(json.dumps(viejo, ensure_ascii=False),
                                json.dumps(nuevo, ensure_ascii=False))
    return p


# The payloads that are data, as opposed to code (three.js, plano2d, fonts, logo).
DATOS = ['__DATA__', '__NOMBRES__', '__SESIONES__', '__VISTAS__', '__EVENTO__',
         '__MOZFEST__', '__RUTAS__', '__VOLUNTARIOS__',
         '__VOLUNTARIOS_LEEME__']
NAMESPACES = {'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml'}


def vigilar(html, parts):
    """What the public file must never carry. Returns the list of problems."""
    malos = []
    for nombre in C['prohibido']['en_todo']:
        n = len(re.findall(r'\b%s\b' % re.escape(nombre), html, re.I))
        if n:
            malos.append(f'«{nombre}» aparece {n} veces en el archivo')
    for k in DATOS:
        for patron in C['prohibido']['en_datos']:
            m = re.search(patron, parts[k], re.I)
            if m:
                malos.append(f'{k}: «{m.group()}» (/{patron}/) en …'
                             + parts[k][max(0, m.start() - 50):m.end() + 50] + '…')
    permitidas = NAMESPACES | ({C['aviso']['codigo']} if C['aviso'].get('codigo') else set())
    for u in sorted(set(re.findall(r'https?://[^\s"\'<>)]+', html)) - permitidas):
        malos.append(f'una dirección: {u}')
    return malos
