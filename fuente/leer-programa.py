#!/usr/bin/env python3
"""Baja el programa real de MozFest desde Accelevents y lo cuelga de su sala.

    python3 leer-programa.py [--check | --write] [--desde fichero.json]

CÓRRELO AL EMPEZAR CADA SESIÓN DE TRABAJO. El programa lo edita la
organización cuando quiere, y `--check` no escribe nada: dice si cambió algo
desde la última vez. Así se ve una sesión añadida o una sala movida el mismo
día en que ocurre, y no tres semanas después.

La API es pública y no pide credenciales. Pagina de diez en diez salvo que se
le pida un tamaño; `size` es el parámetro que entiende, y ni `length` ni
`limit` ni `pageSize` hacen nada, así que devuelven diez y parece que el
evento tiene diez sesiones.

Una sesión dice en qué sala está con un texto tipo `B2 Room` o `Main Stage`.
El código de delante es el que manda, porque es el que usa el programa; si no
hay código, se prueba el texto entero contra los nombres del documento. La
correspondencia código -> sala trazada vive en mozfest-recinto.json, y una
sala que no exista NO se escribe: armar.py pararía la construcción, que es lo
correcto, pero el aviso se da aquí y con nombre.

Lo que la organización retira tarda a veces en salir de la API. Esas sesiones
van a mano en retiradas.json, por sessionId, y no se cuelgan; el `--check`
dice si la API las sigue trayendo y avisa cuando ya sobran.

    --check          leer la API, comparar con sesiones.json, no escribir nada
    --write          escribir sesiones.json
    --desde ARCHIVO  leer de un volcado en vez de la red, para trabajar sin ella
"""
import json, pathlib, re, sys, urllib.request, collections, datetime

here = pathlib.Path(__file__).parent
API = ('https://apiro.accelevents.com/r/events/mozilla-festival-2026'
       '/session/v2/get-all-sessions?size=500')
DIAS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


def bajar(desde=None):
    if desde:
        return json.loads(pathlib.Path(desde).read_text())
    req = urllib.request.Request(API, headers={'User-Agent': 'mozfest-mapa/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def salas_por_codigo():
    """Del documento de la organización: código -> sala trazada, y también
    nombre -> sala, que es lo que salva a `Main Stage`, que no lleva código.
    Y los lugares de 'programa', que no son salas: el Music Stage es una pieza
    del montaje, y se nombra sin mirar el código."""
    d = json.loads((here / 'mozfest-recinto.json').read_text())
    por_codigo, por_nombre = {}, {}
    for nombre, e in d.get('programa', {}).items():
        if not nombre.startswith('_'):
            por_nombre['programa:' + nombre.strip().lower()] = e['lugar']
    for code, e in d.get('espacios', {}).items():
        sala = e.get('sala')
        if not isinstance(sala, str):
            continue                       # una pareja sin ordenar no sirve para colgar nada
        por_codigo[code.upper()] = sala
        if e.get('nombre'):
            por_nombre[e['nombre'].strip().lower()] = sala
    return por_codigo, por_nombre


def a_sala(location, por_codigo, por_nombre):
    if not location:
        return None
    # A place named in 'programa' wins over its code: «C5 - Music Stage» is the
    # stage, whatever C5 means in this file.
    sin_codigo = re.sub(r'^[A-Z]\d*(?![a-z])\s*[-–·:]?\s*', '', location.strip()).lower()
    if 'programa:' + sin_codigo in por_nombre:
        return por_nombre['programa:' + sin_codigo]
    m = re.match(r'^([A-Z]\d*)\b', location.strip())
    if m and m.group(1) in por_codigo:
        return por_codigo[m.group(1)]
    return por_nombre.get(location.strip().lower())


def retiradas():
    """sessionId -> entrada de retiradas.json: lo que la organización ya quitó
    y la API sigue publicando."""
    d = json.loads((here / 'retiradas.json').read_text())
    return {int(k): v for k, v in d.get('sesiones', {}).items()}


def fila(s):
    ini = datetime.datetime.strptime(s['startTime'], '%Y/%m/%d %H:%M')
    fin = datetime.datetime.strptime(s['endTime'],   '%Y/%m/%d %H:%M')
    return {'fecha': ini.strftime('%Y-%m-%d'),
            'dia':   f'{DIAS[ini.weekday()]} {ini.day}',
            'inicio': ini.strftime('%H:%M'),
            'fin':    fin.strftime('%H:%M'),
            'titulo': (s.get('title') or '').strip()}


def convertir(data, por_codigo, por_nombre, fuera=()):
    """De la sesión de la API a la fila que enseña el visor. Sin sala no hay
    fila en el visor: el programa se cuelga de la planta, y una sala inexistente
    sería una sesión que nadie puede encontrar. Pero sigue siendo programa —la
    fiesta de cierre es fuera del recinto—, así que va aparte, en `sueltas`, con
    su `lugar`, para que el --check vea si cambia. Lo de `fuera` no va a ningún sitio."""
    salido, sin_sala, sueltas = collections.defaultdict(list), collections.Counter(), []
    for s in data:
        if s.get('sessionId') in fuera:
            continue
        sala = a_sala(s.get('location'), por_codigo, por_nombre)
        if not sala:
            lugar = s.get('location') or '(sin sala)'
            sin_sala[lugar] += 1
            sueltas.append({'lugar': lugar, **fila(s)})
            continue
        salido[sala].append(fila(s))
    orden = lambda x: (x['fecha'], x['inicio'], x['titulo'])
    for v in salido.values():
        v.sort(key=orden)
    sueltas.sort(key=orden)
    return dict(sorted(salido.items())), sin_sala, sueltas


def firma(d):
    """Una sesión es su sala, su día, su hora y su título. Con eso se sabe si
    lo que hay escrito sigue siendo lo que la organización publica. Las de
    `_sin_sala` firman con su lugar: no se ven, pero se vigilan igual."""
    return ({(sala, s['fecha'], s['inicio'], s['fin'], s['titulo'])
             for sala, ss in d.items() if not sala.startswith('_') for s in ss}
            | {(s['lugar'], s['fecha'], s['inicio'], s['fin'], s['titulo'])
               for s in d.get('_sin_sala', [])})


def main():
    modo = '--write' if '--write' in sys.argv else '--check'
    desde = None
    if '--desde' in sys.argv:
        desde = sys.argv[sys.argv.index('--desde') + 1]

    try:
        crudo = bajar(desde)
    except Exception as e:
        sys.exit(f'no se ha podido leer el programa: {e}\n'
                 f'  la API es {API}\n'
                 f'  sin red, usa --desde con un volcado guardado')

    data = crudo.get('data') or []
    total = crudo.get('recordsTotal')
    if total and len(data) < total:
        sys.exit(f'la API dice que hay {total} sesiones y solo ha devuelto {len(data)}: '
                 f'ha vuelto a paginar, revisa el parametro size')

    por_codigo, por_nombre = salas_por_codigo()
    fuera = retiradas()
    nuevo, sin_sala, sueltas = convertir(data, por_codigo, por_nombre, fuera)
    en_api = {s.get('sessionId'): s for s in data}

    viejo = json.loads((here / 'sesiones.json').read_text())
    leeme = viejo.pop('_leeme', None)
    a, b = firma(viejo), firma({**nuevo, '_sin_sala': sueltas})

    print(f'{len(data)} sesiones en la API · {sum(len(v) for v in nuevo.values())} '
          f'colgadas de {len(nuevo)} salas')
    for t, xs in (('entran', b - a), ('salen', a - b)):
        print(f'  {t}: {len(xs)}')
        for x in sorted(xs)[:14]:
            print(f'     {x[1]} {x[2]}  {x[4][:56]}   [{x[0]}]')
    if sin_sala:
        print(f'  sin sala trazada: {sum(sin_sala.values())} sesiones')
        for k, n in sin_sala.most_common():
            print(f'     {n:3d}  {k}')
    if fuera:
        print(f'  retiradas a mano: {len(fuera)} (retiradas.json)')
        for sid, r in sorted(fuera.items()):
            s = en_api.get(sid)
            if not s:
                print(f'     {sid}  la API ya no la trae: sobra en retiradas.json')
            elif (s.get('title') or '').strip() != r.get('titulo', '').strip():
                print(f'     {sid}  OJO: en la API se llama «{(s.get("title") or "")[:56]}», '
                      f'no «{r.get("titulo", "")[:56]}»')
            else:
                print(f'     {sid}  la API aún la trae: {r["titulo"][:56]}')

    if modo == '--write':
        salida = {'_leeme': [
            'Programa REAL de MozFest 2026, bajado de la API publica de Accelevents',
            'por leer-programa.py. GENERADO: no editar a mano, se pierde al reimportar.',
            '',
            'Cada clave es una sala trazada. La correspondencia entre el codigo que usa',
            'el programa (B2, D3) y la sala vive en mozfest-recinto.json.',
            '',
            'Las sesiones sin sala trazada van en _sin_sala, con su lugar: el visor no las',
            'ensena (la fiesta de cierre es fuera del recinto), pero leer-programa.py las',
            'vigila como a las demas y las lista al final para que se vea cuantas y de donde.',
        ]}
        salida.update(nuevo)
        salida['_sin_sala'] = sueltas
        (here / 'sesiones.json').write_text(
            json.dumps(salida, ensure_ascii=False, indent=1) + '\n')
        print('sesiones.json actualizado')
    else:
        print('(--check: no se ha escrito nada)')


if __name__ == '__main__':
    main()
