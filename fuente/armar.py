#!/usr/bin/env python3
"""Assemble the viewer: visor/ + model + vendored deps -> fabraicoats-3d.html

    python3 armar.py [salida.html]          the working build, comments and all
    python3 armar.py --dist [salida.html]   the clean deliverable -> dist/index.html
    python3 armar.py --publico [salida]     the visitor's map, for participants
                                            -> dist/publico/index.html

Everything the viewer needs lives in these files, so this is also the recovery
procedure: with visor/, modelo.json and vendor/ you can rebuild the whole thing
from nothing. The result opens with no network — the venue may have none on the
day. To refresh vendor/: python3 traer-dependencias.py

The viewer's own code is visor/: one classic <script>, cut into files by section
and concatenated back in the order VISOR lists. Not ES modules, on purpose —
the sections share top-level constants and the test bench reaches them as
globals — so the cut is textual and every piece must start and end at the top
level (`node --check` on a piece alone says whether it does).

--dist is the same page with what does not run taken out: the design rationale
in the comments, the indentation, the blank lines. limpiar.py does that per
language and armar.py refuses to write the file unless node agrees the clean
JS still parses. Same behaviour by construction, so the bench measures it too:
HTML=dist/index.html herramientas/con-chrome.sh node herramientas/medir-sheet.js

--publico is --dist seen from the visitor's rung and stripped of what that rung
does not need — volunteer posts and zones, staff names, working notes — with a
notice saying it is unofficial. Everything about it lives in version_publica.py
and publico/; the two builds above come out exactly as they did without it.
Its bench: herramientas/con-chrome.sh node herramientas/medir-publico.js
"""
import json, re, shutil, subprocess, sys, pathlib, tempfile
from limpiar import limpiar, limpiar_js

here = pathlib.Path(__file__).parent
PUBLICO = '--publico' in sys.argv
DIST = '--dist' in sys.argv or PUBLICO
_args = [a for a in sys.argv[1:] if a not in ('--dist', '--publico')]
out  = (pathlib.Path(_args[0]) if _args
        else here.parent / 'dist' / 'publico' / 'index.html' if PUBLICO
        else here.parent / 'dist' / 'index.html' if DIST
        else here.parent / 'fabraicoats-3d.html')
if PUBLICO:
    import version_publica

# The viewer, in the order the pieces go into the page. Each is a contiguous
# slice of what was one file; the html pieces carry the tags that open and
# close the <style> and <script> the .css and .js pieces sit in.
VISOR = [
    'cabecera.html',    # doctype, head, the embedded fonts' <style>
    'estilos.css',
    'cuerpo.html',      # the markup, and the <script> tags three.js and ours go in
    'datos.js',         # the payloads, the profile ladder, ?dev=1
    'escena.js',        # renderer, cameras, lights, horizon
    'geometria.js',     # shape helpers and the shared materials
    'cubiertas.js',     # pitched roofs
    'edificios.js',     # every building: walls, caps, roofs, what is pickable
    'huecos.js',        # façade openings and their joinery
    'detalles.js',      # cage, pitch, wire, canopies, the event's kit, trees, a figure
    'puestos.js',       # where a volunteer post is and which space it belongs to
    'recinto.js',       # chimney, zone tints, street names, the floor plans' home
    'camara.js',        # orbit, home view, touch
    'seleccion.js',     # picking and the site bubble
    'panel.js',         # the sheet: tabs, floors, days, rooms
    'interfaz.js',      # chrome: theme, layers, fullscreen, popovers, escape
    'buscador.js',      # search, and fuente/plano2d.js goes in here
    'rutas.js',         # routes from A to B: the grid search and the route card
    'ajustes.js',       # text size, the ?dev=1 readout
    'colocar.js',       # placing volunteers
    'arranque.js',      # the opening flight
    'render.js',        # static merge and the on-demand render loop
    'pie.html',
]

def plantilla():
    """The pieces, joined. The folder must hold exactly the files listed: a
    stray file would be silently left out, a missing one silently skipped,
    and both are the kind of thing that costs an afternoon."""
    carpeta = here / 'visor'
    if not carpeta.is_dir():
        sys.exit('falta visor/: es el código del visor, no se genera')
    hay = {p.name for p in carpeta.iterdir() if p.is_file()}
    faltan = [n for n in VISOR if n not in hay]
    sobran = sorted(hay - set(VISOR))
    if faltan or sobran:
        sys.exit(f'visor/ no cuadra con la lista VISOR de armar.py'
                 + (f' · faltan: {", ".join(faltan)}' if faltan else '')
                 + (f' · sobran: {", ".join(sobran)}' if sobran else ''))
    piezas = [(n, (carpeta / n).read_text()) for n in VISOR]
    if PUBLICO:
        piezas = version_publica.piezas(piezas)
    if DIST:
        piezas = [(n, limpiar(n, s)) for n, s in piezas]
    return ''.join(s for _, s in piezas)

def sintaxis(js):
    """node --check on the clean script: the one thing a stripper can break
    that nothing else here would notice before the browser does."""
    node = shutil.which('node')
    if not node:
        sys.exit('--dist necesita node para comprobar la sintaxis del JS limpio')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(js); tmp = f.name
    r = subprocess.run([node, '--check', tmp], capture_output=True, text=True)
    pathlib.Path(tmp).unlink()
    if r.returncode:
        sys.exit('el JS limpio no pasa node --check:\n' + r.stderr[:800])

def need(path, hint):
    if not path.exists():
        sys.exit(f'falta {path.name}: {hint}')
    return path.read_text()

def logo(path):
    """Inline the festival mark. It is a solid tile with the design cut out of
    it, so the group fill paints the tile: handing that fill to currentColor is
    what lets one file serve both themes with no JavaScript at all."""
    s = need(path, 'es el logo del festival, expórtalo de Figma')
    s = s[s.index('<svg'):]                       # drop the xml prolog and doctype
    head = s.index('>') + 1                       # the pt size belongs to the export,
    s = re.sub(r'\s(?:width|height)="[^"]*"', '', s[:head]) + s[head:]   # the layout sets the box
    if 'fill="#000000"' not in s:
        sys.exit(f'{path.name}: no encuentro el fill del grupo, ¿cambió la exportación?')
    return s.replace('fill="#000000"', 'fill="currentColor"')

def mano(path, hint):
    """A hand-written JSON payload, kept out of modelo.json on purpose: that file
    is regenerated from mapa.svg, so anything written into it by hand is lost at
    the next trace. The commentary key is dropped on the way in."""
    d = json.loads(need(path, hint))
    d.pop('_leeme', None)
    return d

def nombres(path):
    """The hand-written names. A MozFest key that says "Building X" has to be
    the letter mozfest-recinto.json gives that building or that part: the Book
    of Answers calls L'Harmonia Building B, and a key left on Àster's nave
    would call the boiler room B too. An alias is just another name to search
    by, so it has to be text."""
    d = mano(path, 'son los nombres de los edificios, escritos a mano')
    rec = json.loads(need(here / 'mozfest-recinto.json', '')).get('edificios', {})
    malas = []
    for k, v in d.items():
        m = re.fullmatch(r'Building ([A-Z])', v.get('clave') or '')
        if m:
            e = rec.get(m.group(1)) or {}
            suyos = {e.get('edificio'), e.get('parte'), *e.get('tambien', [])} - {None}
            if k not in suyos:
                malas.append(f'{k}: «{v["clave"]}», y mozfest-recinto.json da esa letra a '
                             + (', '.join(sorted(suyos)) or 'nada'))
        if 'alias' in v and not (isinstance(v['alias'], list) and all(isinstance(a, str) for a in v['alias'])):
            malas.append(f'{k}: alias tiene que ser una lista de textos')
    if malas:
        sys.exit(f'{path.name}: ' + '\n  '.join(malas))
    return d

def vistas(path):
    """Where the search stands the camera for each building. Angles and a
    distance, never a position: a building may be re-traced but it does not
    move. Every key has to name a building that exists, or a view is written
    for a search result that can never happen."""
    d = mano(path, 'son las vistas por edificio, ejecuta python3 sembrar-vistas.py --write')
    casas = {v.get('of') or v['id'] for v in json.loads(MODELO)['vols']}
    casas.add('chimney')      # no es un volumen, pero se busca y se selecciona
    sueltas = [k for k in d if k not in casas]
    if sueltas:
        sys.exit(f'{path.name}: estos edificios no existen en el modelo: ' + ', '.join(sueltas))
    malas = [k for k, v in d.items()
             if not isinstance(v, dict) or not {'yaw', 'pitch', 'dist'} & set(v)
             or any(not isinstance(x, (int, float)) for x in v.values())]
    if malas:
        sys.exit(f'{path.name}: sin yaw/pitch/dist numéricos: ' + ', '.join(malas))
    return d

def evento(gen, mano_):
    """Everything the festival brings and the venue does not have. Two halves:
    what was traced in Figma, regenerated from the SVG by leer-evento.py, and
    what was not, written by hand and meant to be edited by whoever is running
    the event. They are merged here so the viewer sees one list.

    A hand entry places itself either on a room, by id, or by a polygon in
    model metres. Naming a room that does not exist is the one mistake that
    would put a stall somewhere nobody can reach, so it stops the build.

    And one with 'retirado': true takes a traced piece away: the set-up
    changes the week before, and redrawing Figma to delete two squares is a
    detour (Erick, 2026-10-16: the giant games 1 and 2 go). Retiring an id
    that was never traced is a typo that would leave the piece standing, so
    that stops the build too."""
    a = mano(gen, 'lo genera python3 leer-evento.py --write')['items']
    b = mano(mano_, 'son los puntos del evento escritos a mano')['items']
    trazados = {it['id'] for it in a}
    retirar = {it['id'] for it in b if it.get('retirado') is True}
    if retirar - trazados:
        sys.exit(f"{mano_.name}: se retira lo que no está trazado: "
                 + ', '.join(sorted(retirar - trazados)))
    a = [it for it in a if it['id'] not in retirar]
    b = [it for it in b if it.get('retirado') is not True]
    salas = {r['id'] for f in json.loads(MODELO)['floors'] for r in f['rooms']}
    for it in b:
        if 'room' in it and it['room'] not in salas:
            sys.exit(f"{mano_.name}: {it.get('id')} dice estar en la sala "
                     f"{it['room']}, que no existe")
        if 'room' not in it and 'poly' not in it:
            sys.exit(f"{mano_.name}: {it.get('id')} no dice dónde está: "
                     f"hace falta 'room' o 'poly'")
        it.setdefault('est', True); it['src'] = 'mano'
    vistos = {}
    for it in a + b:                      # lo de mano gana sobre lo importado
        vistos[it['id']] = it
    return list(vistos.values())

def _dentro(p, poly):
    """Point in polygon, on model metres. The zone of anything is this and only
    this: it is never written down, so it can never disagree with the point."""
    x, y = p; c = False; n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def voluntarios(path):
    """Dónde va cada voluntario, escrito a mano y colocado desde el visor.

    Un puesto con `sala` es de dentro y se dibuja sobre el plano de esa planta;
    sin ella es de fuera y se dibuja en el recinto. El edificio y la planta no
    se guardan: se deducen de la sala. Una sala que no existe para la
    construcción, por lo mismo que en el programa — un puesto colgado de una
    sala inalcanzable es un voluntario al que nadie encuentra, y en un mapa que
    se usa para orientarse eso es peor que no ponerlo.

    El código es el del Book of Answers, que desde el 2026-10-16 numera por
    ZONA: la letra es la zona del capitán que lo cubre y el número no tiene por
    qué ser un espacio («C2 Registration Tent exit» está en acreditación, y el
    espacio C2 es el Music Stage). Por eso ya no se calcula del punto, como se
    hacía desde el 13-sep: se escribe, y aquí se comprueba que esté entero.
    La zona del POLÍGONO tampoco manda: la puerta de Espai Vertical (F0) cae en
    el de la E y el del overflow (D5) también, y el Book los da a la F y a la D."""
    d = mano(path, 'es dónde va cada voluntario, escrito a mano')
    salas = {r['id']: r for f in json.loads(MODELO)['floors'] for r in f['rooms']}
    PRIOS = ('alta', 'media', 'baja')
    vistos, malos, sin_sitio, repes, fuera_sala = set(), [], [], [], []
    mal_vc, mal_codigo, mal_nombre, mal_prio, mal_id, mal_equipo = [], [], [], [], [], []
    for p in d.get('puestos', []):
        pid = p.get('id') or '(sin id)'
        if p.get('sala') and p['sala'] not in salas:
            malos.append(f"{pid} -> {p['sala']}")
        if not isinstance(p.get('x'), (int, float)) or not isinstance(p.get('z'), (int, float)):
            sin_sitio.append(pid)
            continue
        # El punto de uno de dentro cae en la sala que dice: el visor lo
        # garantiza al colocar, y esto lo garantiza cuando el archivo se toca
        # a mano o se pega de un borrador que no es de este modelo.
        if p.get('sala') in salas and salas[p['sala']].get('poly') \
                and not _dentro((p['x'], p['z']), salas[p['sala']]['poly']):
            fuera_sala.append(f"{pid} -> {p['sala']}")
        if p.get('id') in vistos:
            repes.append(p['id'])
        vistos.add(p.get('id'))
        p.setdefault('h', 1.75)
        # 'vc' es una marca, no un rango ni un texto: o es true o no está.
        if 'vc' in p and p['vc'] is not True:
            mal_vc.append(pid)
        # El código del Book: una letra de zona A-G, un número, y a veces lo
        # que lo distingue dentro de él — «A0 Main», «D0 Corridor».
        cod = p.get('codigo')
        if not isinstance(cod, str) or not re.fullmatch(r'[A-G]\d+( [A-Z][a-z]+)?', cod):
            mal_codigo.append(f'{pid}: {cod!r}')
            continue
        if not (isinstance(p.get('nombre'), str) and p['nombre'].strip()):
            mal_nombre.append(pid)
        if p.get('prioridad') not in PRIOS:
            mal_prio.append(f"{pid}: {p.get('prioridad')!r}")
        if 'equipo' in p and not (isinstance(p['equipo'], str) and p['equipo'].strip()):
            mal_equipo.append(pid)
        # El id es el código sin espacios y un correlativo: E3-2, A0-Main-1.
        if not re.fullmatch(re.escape(cod.replace(' ', '-')) + r'-\d+', str(p.get('id', ''))):
            mal_id.append(f'{pid} (código {cod})')
    for lista, msg in (
            (malos, 'estos puestos dicen estar en una sala que no existe'),
            (sin_sitio, 'estos puestos no dicen dónde están (faltan x o z)'),
            (repes, 'estos ids están repetidos'),
            (mal_vc, "'vc' es true o no está, nada más"),
            (mal_codigo, "'codigo' es el del Book: letra de zona, número y a veces una palabra, "
                         "como E3 o A0 Main"),
            (mal_nombre, "falta 'nombre', el sitio tal como lo dice el Book, que es lo que va por radio"),
            (mal_prio, "'prioridad' es alta, media o baja, el color del Book"),
            (mal_equipo, "'equipo' es un texto o no está"),
            (mal_id, "el id es el código sin espacios y un número, como E3-2 o A0-Main-1"),
            (fuera_sala, 'el punto de estos puestos no cae dentro de la sala que dicen; '
                         'vuelve a colocarlos desde el visor')):
        if lista:
            sys.exit(f'{path.name}: {msg}: ' + ', '.join(lista))
    return d.get('puestos', [])


def sesiones(path):
    """The programme, generated by leer-programa.py from the organisation's own
    scheduler. Every key has to name a room that exists — or a piece of the
    festival's kit, like the Music Stage — or the session is written into a
    place nobody can reach and simply never appears."""
    d = mano(path, 'es el programa de sesiones, ejecuta python3 leer-programa.py --write')
    # _sin_sala: sessions with nowhere on the map (the closing party is off
    # site). leer-programa.py keeps them to watch for changes; the viewer
    # never sees them.
    d = {k: v for k, v in d.items() if not k.startswith('_')}
    salas = {r['id'] for f in json.loads(MODELO)['floors'] for r in f['rooms']}
    salas |= {it['id'] for it in EVENTO}
    huerfanas = [k for k in d if k not in salas]
    if huerfanas:
        sys.exit(f'{path.name}: estas salas no existen en el modelo: ' + ', '.join(huerfanas))
    return d

def recinto(path, evento_items):
    """The venue as the organisers name it (A1, B3, D4), against what was traced.
    Nothing here reaches the viewer: it is the table the programme hangs from,
    so a session can find its room. That is exactly why it has to be checked
    here — a re-trace renames or drops a room id and this table keeps pointing
    at it in silence, and the breakage only shows up as sessions that never
    appear. A space points at a room, at a whole volume, or at event kit."""
    d = mano(path, 'es el recinto según la organización, escrito a mano')
    salas = {r['id'] for f in json.loads(MODELO)['floors'] for r in f['rooms']}
    vols  = {v['id'] for v in json.loads(MODELO)['vols']}
    casas = {v.get('of') or v['id'] for v in json.loads(MODELO)['vols']}
    areas = {b['id'] for b in json.loads(MODELO)['blocks']}
    kit   = {it['id'] for it in evento_items}
    # Un espacio puede nombrar una puerta: las dos entradas del recinto no son
    # sala ni area, y sin embargo son donde se planta un voluntario.
    puertas = {e['id'] for e in json.loads(MODELO).get('entrances', [])}

    def refs(x):                       # una clave admite un id suelto o una lista
        return [] if x is None else (x if isinstance(x, list) else [x])

    rotas = []
    for code, e in d.get('espacios', {}).items():
        for campo, universo, que in (('sala',            salas, 'sala'),
                                     ('par_sin_ordenar', salas, 'sala'),
                                     ('candidatas',      salas, 'sala'),
                                     ('volumen',         vols,  'volumen'),
                                     ('area',            areas, 'area de suelo'),
                                     ('exterior',        kit,   'elemento del montaje'),
                                     ('entradas',        puertas, 'puerta')):
            rotas += [f'{code}: {que} {r}' for r in refs(e.get(campo)) if r not in universo]
    for nombre, e in d.get('programa', {}).items():
        if not nombre.startswith('_') and e.get('lugar') not in salas | kit:
            rotas.append(f'programa «{nombre}»: {e.get("lugar")}')
    for code, b in d.get('edificios', {}).items():
        rotas += [f'edificio {code}: {r}'         for r in refs(b.get('edificio')) if r not in casas]
        rotas += [f'edificio {code}: volumen {r}' for r in refs(b.get('parte'))    if r not in vols]
        rotas += [f'edificio {code}: entrada {r}' for r in refs(b.get('entradas')) if r not in puertas]
        rotas += [f'edificio {code}: tambien {r}' for r in refs(b.get('tambien')) if r not in casas]
    if rotas:
        sys.exit(f'{path.name}: estas referencias ya no existen en el modelo:\n  '
                 + '\n  '.join(rotas))

    # Y que las zonas nombren cosas de este mismo archivo: 'edificio-A' es la
    # letra en 'edificios', y 'C3' es un código en 'espacios'.
    sueltas = []
    for z, v in d.get('zonas', {}).items():
        for nombre in v.get('contiene', []):
            clave = nombre.split('-', 1)[1] if nombre.startswith(('edificio-', 'entrada-')) else nombre
            if clave not in d.get('edificios', {}) and clave not in d.get('espacios', {}):
                sueltas.append(f'zona {z}: {nombre}')
    if sueltas:
        sys.exit(f'{path.name}: estas zonas contienen algo que no está en el archivo: '
                 + ', '.join(sueltas))

    # Y que el trazo de las zonas diga lo mismo que el documento. La zona de un
    # puesto se calcula por punto en polígono y nunca se escribe, así que el
    # polígono ES la asignación: si la organización pone padres y bebés en D0 y
    # el polígono de la D no llega hasta ahí, todo puesto que se coloque en esa
    # franja sale sin zona. Pasó el 2026-09-11 con cinco elementos de D0 y una
    # sala de la B, y desde el código no se veía. Se comprueba el centro de cada
    # cosa que el documento pone en un espacio con zona: salas, volúmenes, suelo
    # y montaje. Los espacios C dicen su zona; los demás la heredan de su letra.
    zonas_poly = {z['zid']: z['poly'] for z in json.loads(MODELO).get('zones', [])}
    poly_de = {}
    poly_de.update({r['id']: r['poly'] for f in json.loads(MODELO)['floors'] for r in f['rooms'] if r.get('poly')})
    poly_de.update({v['id']: v['poly'] for v in json.loads(MODELO)['vols']})
    poly_de.update({b['id']: b['poly'] for b in json.loads(MODELO)['blocks'] if b.get('poly')})
    poly_de.update({it['id']: it['poly'] for it in evento_items if it.get('poly')})

    dentro = _dentro

    fuera = []
    for code, e in d.get('espacios', {}).items():
        z = e.get('zona') or d.get('edificios', {}).get(code[:1], {}).get('zona')
        if z not in zonas_poly:
            continue
        for campo in ('sala', 'par_sin_ordenar', 'volumen', 'area', 'exterior'):
            for rid in refs(e.get(campo)):
                poly = poly_de.get(rid)
                if not poly:
                    continue
                c = (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))
                if not dentro(c, zonas_poly[z]):
                    cae = [q for q, pl in zonas_poly.items() if dentro(c, pl)]
                    fuera.append(f'{code} {rid}: el documento lo pone en la zona {z} y el trazo '
                                 + (f'en la {", ".join(cae)}' if cae else 'en ninguna'))
    if fuera:
        sys.exit(f'{path.name}: el trazo de las zonas no cuadra con el documento; '
                 f'hay que retrazar la zona en Figma y pasar leer-zonas.py --write:\n  '
                 + '\n  '.join(fuera))

    # Lo unico de aqui que llega al visor: como llama MozFest a cada sala
    # trazada. El nombre del recinto y el de MozFest son dos nombres de una
    # misma sala — Aula 9 es Escolta— y hasta ahora solo los edificios podian
    # enseñar los dos. Una sala puede llevar dos codigos: F3 y F4 son la misma
    # pareja sin ordenar, y decir 'F3 / F4' es mas honesto que elegir uno.
    # Lo mismo para el montaje: el domo es C2 y los food trucks son C3. Los
    # espacios C no se trazan —el documento llama 'Space C outside' a todo el
    # exterior— y se resuelven etiquetando lo que hay dentro, asi que esta es
    # la unica forma que tiene una carpa de decir a que espacio pertenece.
    porsala = {}
    for code, e in sorted(d.get('espacios', {}).items()):
        for sid in (refs(e.get('sala')) + refs(e.get('par_sin_ordenar'))
                    + refs(e.get('volumen')) + refs(e.get('exterior')) + refs(e.get('area'))):
            if sid in salas or sid in vols or sid in kit or sid in areas:
                v = porsala.setdefault(sid, {'code': [], 'nombre': e.get('nombre')})
                v['code'].append(code)
    # Un codigo es una letra y unos digitos —A0, B4, D2—, una letra sola —D es
    # el Main Stage, 'D. Main Stage' en el deck— o un digito, que las entradas
    # son 0 y 1. Una clave compuesta como 'F-production' es etiqueta mia para
    # un espacio que el documento nombra sin numerar, y no vale para decir por
    # radio, asi que de esa solo sale el nombre.
    def codigos(cs):
        return ' / '.join(c for c in cs if re.fullmatch(r'[A-Z]\d*|\d+', c))
    return {k: {'code': codigos(v['code']), 'nombre': v['nombre']}
            for k, v in porsala.items()}


tpl    = plantilla()
MODELO = need(here / 'modelo.json', 'es el modelo, no se genera')
# El montaje se arma una vez: lo lleva el visor y lo comprueba el recinto.
EVENTO  = evento(here / 'evento.json', here / 'servicios.json')
# No es una carga mas: es la tabla de la que colgara el programa, y se comprueba
# aqui para que un retrazado que mueva una sala pare la construccion. De vuelta
# trae lo unico que el visor necesita de ella, el codigo MozFest de cada sala.
MOZFEST = recinto(here / 'mozfest-recinto.json', EVENTO)
# Routes from A to B: the walking grid and the public doors (fuente/rutas.py,
# fuente/puertas.json). A door that does not exist, or a public door the Main
# entrance cannot reach, stops the build: a route that silently cannot be
# walked is worse than no route.
import rutas
RUTAS = rutas.construir(json.loads(MODELO), EVENTO,
                        json.loads(need(here / 'puertas.json', 'qué puertas usa una ruta, a mano')),
                        json.loads(need(here / 'paso.json', 'por dónde se anda fuera de las zonas, a mano')))
_err = rutas.validar(RUTAS, {k: v for k, v in json.loads(need(here / 'sesiones.json', '')).items()
                             if not k.startswith('_')})
if _err:
    sys.exit('puertas.json: ' + '\n  '.join(_err))

parts = {
    '__DATA__':     MODELO,
    '__NOMBRES__':  json.dumps(nombres(here / 'nombres.json'), ensure_ascii=False),
    '__SESIONES__': json.dumps(sesiones(here / 'sesiones.json'), ensure_ascii=False),
    '__VISTAS__':   json.dumps(vistas(here / 'vistas.json'), ensure_ascii=False),
    '__EVENTO__':   json.dumps(EVENTO, ensure_ascii=False),
    '__MOZFEST__':  json.dumps(MOZFEST, ensure_ascii=False),
    # Con qué resuelve el visor el espacio de un puesto al colocarlo. Es el
    # MISMO índice con el que armar.py lo comprueba después, para que el
    # visor no pueda asignar un código que la construcción luego rechace.
    '__RUTAS__':    json.dumps(rutas.para_el_visor(RUTAS), ensure_ascii=False, separators=(',', ':')),
    '__VOLUNTARIOS__': json.dumps(voluntarios(here / 'voluntarios.json'),
                                  ensure_ascii=False),
    # Las notas del archivo van al visor tal cual, para que el botón de bajar
    # devuelva el archivo ENTERO y quien coloque lo mande sin pegar nada.
    '__VOLUNTARIOS_LEEME__': json.dumps(json.loads(need(here / 'voluntarios.json', ''))
                                        .get('_leeme', []), ensure_ascii=False),
    '__PLANO2D__':  (limpiar_js if DIST else str)(
                        need(here / 'plano2d.js', 'es el plano 2D de las plantas, no se genera')),
    '__THREE_JS__': need(here / 'vendor' / 'three.min.js', 'ejecuta python3 traer-dependencias.py'),
    '__FUENTES__':  need(here / 'vendor' / 'fuentes.css',  'ejecuta python3 traer-dependencias.py'),
    '__LOGO__':     logo(here / 'mozfest-logo.svg'),
}

# Check the template, never the output: the payloads are third-party blobs and
# three.js legitimately contains the string __THREE__ (its own global).
for marker in parts:
    if tpl.count(marker) != 1:
        sys.exit(f'{marker} aparece {tpl.count(marker)} veces en la plantilla, se esperaba 1')
# The public build may carry one link, to the source; vigilar() checks every
# address in its finished page instead, which is the stricter of the two.
if 'https://' in tpl and not PUBLICO:
    sys.exit('la plantilla aún pide algo por red: ' + re.search(r'https://\S{0,60}', tpl).group())

# The visitor's map carries only what the visitor's rung needs.
if PUBLICO:
    parts = version_publica.datos(parts)

# One pass, so a payload that happens to contain another marker cannot eat it.
html = re.sub('|'.join(parts), lambda m: parts[m.group()], tpl)

# And a last look before it is written: a public file is published for good.
if PUBLICO:
    _malos = version_publica.vigilar(html, parts)
    if _malos:
        sys.exit('--publico: esto no puede salir en la versión pública:\n  ' + '\n  '.join(_malos))

if DIST:
    # Our script only: three.js is minified upstream and untouched here.
    propio = html[html.rindex('<script>') + len('<script>'):html.rindex('</script>')]
    sintaxis(propio)
    out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
D = json.loads(parts['__DATA__'])
N = json.loads(parts['__NOMBRES__'])
S = json.loads(parts['__SESIONES__'])
V = json.loads(parts['__VISTAS__'])
EV = json.loads(parts['__EVENTO__'])
VOL = json.loads(parts['__VOLUNTARIOS__'])
dudosos = sum(1 for v in N.values() if v.get('confirmar'))
sesion  = sum(len(v) for v in S.values())
# Fuera y dentro por separado: se dibujan en sitios distintos, así que un
# puesto que cae del lado que no es se ve aquí antes que en la pantalla.
dentro  = sum(1 for p in VOL if p.get('sala'))
print(f"{out}  ·  {len(D['vols'])} volúmenes, {len(D['openings'])} huecos, "
      f"{len(D['floors'])} plantas  ·  {len(N)} nombres ({dudosos} por confirmar)"
      f"  ·  {sesion} sesiones en {len(S)} salas  ·  {len(V)} vistas"
      f"  ·  {len(EV)} del evento"
      f"  ·  {len(VOL)} puestos ({dentro} dentro)"
      f"  ·  {len(RUTAS['puertas'])} puertas, cuadrícula {RUTAS['ancho']}×{RUTAS['alto']}"
      f"  ·  {len(html)/1e6:.2f} MB, sin red" + (", limpio" if DIST else "")
      + (", público" if PUBLICO else ""))
