/* Checks the public build (armar.py --publico -> dist/publico/index.html): the
   visitor's map that participants would see. What it must not carry, and that
   what it does carry still works.

       cd fuente && python3 armar.py --publico && python3 armar.py --dist
       herramientas/con-chrome.sh node herramientas/medir-publico.js

   The forbidden words come from fuente/publico/publico.json, the same list the
   build refuses on, and every one of those checks is first run against
   dist/index.html — the volunteers' build, which does carry all of it. A check
   that finds nothing there proves nothing here. HTML=… and CONTROL=… point it
   at other files. */
const fs = require('fs');
const path = require('path');
const { connect, evaluate } = require('./cdp.js');

const RAIZ = path.resolve(__dirname, '..');
const HTML = process.env.HTML || path.join(RAIZ, 'dist', 'publico', 'index.html');
const CONTROL = process.env.CONTROL || path.join(RAIZ, 'dist', 'index.html');
const CONF = JSON.parse(fs.readFileSync(path.join(RAIZ, 'fuente', 'publico', 'publico.json'), 'utf8'));
const SESIONES = require('../fuente/sesiones.json');
const MODELO = require('../fuente/modelo.json');
for (const f of [HTML, CONTROL])
  if (!fs.existsSync(f)) { console.error(`falta ${f}: cd fuente && python3 armar.py --publico && python3 armar.py --dist`); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
};

/* The data payloads, read back from the running page: the same consts the
   build filled, under the names the viewer gives them. */
const PAYLOADS = ['D', 'NAMES', 'SESSIONS', 'VIEWS', 'EVENT', 'MOZROOM',
                  'RUTAS', 'PUESTOS', 'PUESTOS_LEEME'];
const leerDatos = send => evaluate(send, `({${PAYLOADS.map(n => `${n}: JSON.stringify(${n})`).join(',')}})`);

/* What the build refuses, measured again from outside it. */
function prohibido(fuente, datos) {
  const malos = [];
  for (const n of CONF.prohibido.en_todo) {
    const c = (fuente.match(new RegExp(`\\b${n}\\b`, 'gi')) || []).length;
    if (c) malos.push(`«${n}» ×${c}`);
  }
  for (const [k, txt] of Object.entries(datos))
    for (const p of CONF.prohibido.en_datos) {
      const m = new RegExp(p, 'i').exec(txt);
      if (m) malos.push(`${k}: «${m[0]}»`);
    }
  return malos;
}
/* Every address in the file but the two namespaces (and the source link, if set). */
const NS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml']);
if (CONF.aviso.codigo) NS.add(CONF.aviso.codigo);
const direcciones = fuente => [...new Set(fuente.match(/https?:\/\/[^\s"'<>)]+/g) || [])].filter(u => !NS.has(u));
/* Our own script, the last one: three.js is a library and does carry fetch()
   in its loaders, which the viewer never calls. */
const propio = fuente => fuente.slice(fuente.lastIndexOf('<script>'), fuente.lastIndexOf('</script>'));
const RED = /\bfetch\s*\(|XMLHttpRequest|document\.cookie|sendBeacon|new\s+WebSocket|new\s+EventSource/;

async function arrancar(file, query = '') {
  const t = await connect('file://' + file + query);
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await evaluate(t.send, `typeof INDEX !== 'undefined' && !!document.querySelector('canvas') && document.readyState === 'complete'`); } catch {}
  }
  return t;
}

(async () => {
  const fuente = fs.readFileSync(HTML, 'utf8');
  const fuenteControl = fs.readFileSync(CONTROL, 'utf8');

  /* The public page, opened the way someone trying to climb the ladder would. */
  const pub = await arrancar(HTML, '?dev=1&as=organizador');
  const ev = e => evaluate(pub.send, e);
  await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});

  console.log('\n== control positivo: dist/index.html sí lo lleva ==');
  const ctl = await connect('file://' + CONTROL);
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await evaluate(ctl.send, `typeof INDEX !== 'undefined' && document.readyState === 'complete'`); } catch {}
  }
  const malosCtl = prohibido(fuenteControl, await leerDatos(ctl.send));
  ok('la lista de prohibidas encuentra algo en la versión de voluntarios', malosCtl.length > 0,
     `${malosCtl.length}: ${malosCtl.slice(0, 4).join(' · ')}…`);
  /* The public repository ships voluntarios.json empty: no build of it has a
     station to find, so the two station controls only apply where there are. */
  const hayPuestos = require('../fuente/voluntarios.json').puestos.length > 0;
  const ctlPuestos = await evaluate(ctl.send, `PUESTOS.length`);
  if (hayPuestos) ok('y la de voluntarios lleva puestos', ctlPuestos > 0, `${ctlPuestos}`);
  else console.log('  · sin puestos en este repositorio: los dos controles de puestos no aplican');
  const ctlZonas = await evaluate(ctl.send, `D.zones.length`);
  ok('y zonas', ctlZonas > 0, `${ctlZonas}`);
  const ctlStaff = await evaluate(ctl.send, `INDEX.filter(e => e.data && e.data.ev && e.data.ev.kind === 'crew').length +
    INDEX.filter(e => e.data && D.floors.some(f => f.rooms.some(r => r.id === e.data.id && r.kind === 'crew'))).length`);
  ok('y en su búsqueda hay sitios de personal', ctlStaff > 0, `${ctlStaff}`);
  if (hayPuestos) ok('y su código, sin filtrar, sí nombraría un puesto', /\b[A-G]\d-\d+\b/.test(JSON.stringify(await evaluate(ctl.send, `PUESTOS.map(p => p.id)`))));
  await ctl.close();

  console.log('\n== 3a · el peldaño es el del visitante, pida lo que pida la URL ==');
  const p = await ev(`({rung: RUNG, ladder: LADDER[RUNG], dev: DEV, as: AS, wb: WORKBENCH,
                       vol: atLeast('voluntario'), url: location.search})`);
  ok('con ?dev=1&as=organizador sigue en visitante', p.ladder === 'visitante', JSON.stringify(p));
  ok('sin banco de trabajo (DEV y WORKBENCH apagados)', p.dev === false && p.wb === false && p.as === null);
  ok('no hay fila de zonas, ni de lectura de cámara, ni de colocar', await ev(
    `!document.getElementById('zoneBtn') && !document.getElementById('roBtn') && !document.getElementById('crewBtn') && !document.getElementById('crew')`));
  ok('el panel de lectura de cámara sigue escondido', await ev(`document.getElementById('readout').hidden`));
  const filas = await ev(`[...document.querySelectorAll('#menu > .row, #menu > button')].map(b => b.id || b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 9))`);
  ok('el menú es ir de A a B, pantalla completa, tema y tamaño de letra', filas.includes('rutaMenuBtn') && filas.includes('themeBtn') && filas.length <= 5, filas.join(', '));

  console.log('\n== 3b · sin puestos ==');
  ok('PUESTOS vacío', await ev(`Array.isArray(PUESTOS) && PUESTOS.length === 0`));
  ok('PUESTOS_LEEME vacío', await ev(`Array.isArray(PUESTOS_LEEME) && PUESTOS_LEEME.length === 0`));
  ok('no se dibuja ningún puesto', await ev(`crewGroup.children.length === 0`));
  /* Since 2026-10-16 a station's code is the Book's, not computed from its
     point, so the index of spaces that did it is gone from every build. */
  ok('no hay índice de espacios', await ev(`typeof ESPACIOS === 'undefined'`));

  console.log('\n== 3c · sin zonas ==');
  ok('D.zones vacío', await ev(`Array.isArray(D.zones) && D.zones.length === 0`));
  ok('no se dibuja ninguna zona', await ev(`zoneGroup.children.length === 0`));
  ok('ni sus nombres', await ev(`!Object.keys(D.names).some(k => /^z-/.test(k))`));

  console.log('\n== 3d · lo del personal: «Staff only», sin nombre, sin búsqueda, sin ruta ==');
  const staff = await ev(`({
    salas: D.floors.flatMap(f => f.rooms.filter(r => r.kind === 'crew').map(r => [r.id, r.name])),
    kit: EVENT.filter(e => e.kind === 'crew').map(e => [e.id, e.label]),
    tipo: (D.kinds.crew || {}).label})`);
  const todos = [...staff.salas, ...staff.kit];
  ok('hay sitios de personal, y siguen en el mapa', staff.salas.length > 0 && staff.kit.length > 0, `${staff.salas.length} salas, ${staff.kit.length} del montaje`);
  ok('todos se llaman «Staff only»', todos.every(([, n]) => n === 'Staff only'), todos.filter(([, n]) => n !== 'Staff only').join(' · '));
  ok('y su id no dice nada: staff-N', todos.every(([id]) => /^staff-\d+$/.test(id)), todos.map(([id]) => id).join(' '));
  ok('el tipo va en blanco: la burbuja ya dice «Staff only»', staff.tipo === '', JSON.stringify(staff.tipo));
  ok('ningún sitio de personal tiene código MozFest', await ev(`Object.keys(MOZROOM).every(k => !/^staff-/.test(k))`));
  const buscar = q => ev(`(() => { document.getElementById('q').value = ${JSON.stringify(q)}; runSearch();
    return hits.map(h => h.label + ' | ' + h.sub); })()`);
  for (const q of ['Production', 'Staff', 'Despatx', 'Oficina', 'Interview'])
    ok(`buscar «${q}» no da nada`, (await buscar(q)).length === 0, (await buscar(q)).slice(0, 3).join(' · '));
  ok('ninguna entrada del buscador lleva a un sitio de personal', await ev(
    `INDEX.every(e => !(e.data && (/^staff-/.test(e.data.id || '') || (e.data.ev && e.data.ev.kind === 'crew'))))`));
  /* Control: the search does still find things. */
  ok('y buscar sigue funcionando («Main Stage»)', (await buscar('Main Stage')).length > 0);
  const tarjeta = id => ev(`(() => {
    const m = picks.find(x => x.userData && x.userData.id === ${JSON.stringify(id)});
    if(!m) return {falta: true};
    select(m);
    const r = {boton: !!document.querySelector('#sheet .ruta-btn'), tit: (card.querySelector('h2') || {}).textContent || null,
               burbuja: document.querySelector('.worldtip').dataset.on === 'true' ? document.querySelector('.worldtip').textContent : null};
    select(null);
    return r;
  })()`);
  const kitStaff = await tarjeta(staff.kit[0][0]);
  ok('la ficha de un elemento del personal no ofrece Directions', !kitStaff.falta && !kitStaff.boton, JSON.stringify(kitStaff));
  ok('y su burbuja dice «Staff only», una vez', kitStaff.burbuja === 'Staff only', JSON.stringify(kitStaff.burbuja));
  const kitEscenario = await tarjeta('ev-stage');
  ok('la de un elemento público sí (control)', kitEscenario.boton, JSON.stringify(kitEscenario));

  console.log('\n== 3e · sin notas de trabajo ==');
  const datos = await leerDatos(pub.send);
  const malos = prohibido(fuente, datos);
  ok('ninguna palabra prohibida (nombres en todo el archivo, notas y códigos de puesto en los datos)', malos.length === 0, malos.join(' · '));
  ok('ningún _leeme, _pendiente, por, ojo ni confirmar como clave en los datos',
     !Object.values(datos).some(t => /"(_leeme|_pendiente|_[a-z]+|por|ojo|nota|duda|confirmar)":/.test(t)));

  console.log('\n== 3f · el aviso ==');
  /* mobile:false, like medir-sheet.js: with mobile:true headless keeps a
     1280 px layout viewport and the phone is not what gets measured. */
  const aviso = async (w, h) => {
    await pub.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await new Promise(r => setTimeout(r, 400));
    return ev(`(() => {
      const a = document.querySelector('.brand .aviso'); if(!a) return {falta: true};
      const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
      const choca = ['searchBtn', 'menuBtn'].some(id => { const b = document.getElementById(id).getBoundingClientRect();
        return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; });
      return {texto: a.textContent, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right,
              vis: cs.visibility, op: +cs.opacity, disp: cs.display, choca, ancho: innerWidth,
              recorte: a.scrollWidth > a.clientWidth + 1, scroll: document.documentElement.scrollWidth > innerWidth};
    })()`);
  };
  for (const [nombre, w, h] of [['escritorio 1280', 1280, 900], ['móvil 390', 390, 844]]) {
    const a = await aviso(w, h);
    ok(`${nombre}: la página mide lo que se le pide`, a.ancho === w, `${a.ancho}px`);
    ok(`${nombre}: se ve, entero, arriba y sin tapar los botones`,
       !a.falta && a.w > 20 && a.h > 5 && a.vis === 'visible' && a.op > 0.5 && a.disp !== 'none'
       && a.top >= 0 && a.top < 120 && a.right <= a.ancho && !a.choca && !a.recorte,
       JSON.stringify(a));
    ok(`${nombre}: sin scroll horizontal`, !a.scroll);
    ok(`${nombre}: dice lo de publico.json`, a.texto === CONF.aviso.corto, a.texto);
    /* CAPTURAS=/a/carpeta leaves a picture of each size, for a person to look at. */
    if (process.env.CAPTURAS) {
      await ev(`(home(), invalidate(), true)`);
      await new Promise(r => setTimeout(r, 2500));
      const { data } = await pub.send('Page.captureScreenshot', {format: 'png'});
      const f = path.join(process.env.CAPTURAS, `publico-${w}.png`);
      fs.writeFileSync(f, Buffer.from(data, 'base64'));
      console.log(`    captura: ${f}`);
    }
  }
  await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  const acerca = await ev(`(() => { const a = document.getElementById('acerca'); return a && {texto: a.textContent.replace(/\\s+/g, ' ').trim(), enlaces: a.querySelectorAll('a').length}; })()`);
  ok('el aviso largo está al final del menú', acerca && acerca.texto.includes(CONF.aviso.largo), acerca && acerca.texto.slice(0, 80));
  ok(CONF.aviso.codigo ? 'con el enlace al código' : 'sin enlace al código mientras no haya repo público',
     acerca && acerca.enlaces === (CONF.aviso.codigo ? 1 : 0));
  ok('con los créditos de las fuentes', acerca && (!CONF.aviso.creditos || acerca.texto.includes(CONF.aviso.creditos)));
  const menuAbierto = await ev(`(() => { openPop('menu', true); const m = document.getElementById('menu').getBoundingClientRect();
    const a = document.getElementById('acerca').getBoundingClientRect(); openPop('menu', false);
    return {cabe: a.bottom <= innerHeight && a.right <= m.right + 0.5, a: a.bottom, h: innerHeight}; })()`);
  ok('abierto el menú, el aviso largo cabe en pantalla', menuAbierto.cabe, JSON.stringify(menuAbierto));
  if (process.env.CAPTURAS) {
    await pub.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    await ev(`(openPop('menu', true), true)`);
    await new Promise(r => setTimeout(r, 1200));
    const { data } = await pub.send('Page.captureScreenshot', {format: 'png'});
    const f = path.join(process.env.CAPTURAS, 'publico-390-menu.png');
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log(`    captura: ${f}`);
    await ev(`(openPop('menu', false), true)`);
    await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  }

  console.log('\n== 3g · sin red ==');
  const dirs = direcciones(fuente);
  ok('ninguna dirección http(s) salvo los namespaces', dirs.length === 0, dirs.slice(0, 3).join(' '));
  ok('control: el detector de direcciones sí encuentra una', direcciones('<a href="https://example.org/x">').length === 1);
  ok('nuestro código no llama a fetch, XHR, cookies, beacons ni sockets', !RED.test(propio(fuente)), (propio(fuente).match(RED) || [''])[0]);
  ok('control: el detector de red sí ve un fetch(', RED.test('x=fetch("a")'));
  /* And measured, not read: reload with the network watched. */
  const pedidas = [];
  pub.send.on('Network.requestWillBeSent', e => pedidas.push(e.request.url));
  await pub.send('Network.enable');
  await pub.send('Page.reload', {ignoreCache: true});
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await ev(`typeof INDEX !== 'undefined' && document.readyState === 'complete'`); } catch {}
  }
  await new Promise(r => setTimeout(r, 1500));
  const fuera = pedidas.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
  ok('al cargar no pide nada a la red', pedidas.length > 0 && fuera.length === 0,
     `${pedidas.length} peticiones, todas locales${fuera.length ? '; fuera: ' + fuera.slice(0, 3).join(' ') : ''}`);
  ok('sin cookies', await ev(`document.cookie === ''`));

  console.log('\n== y lo del visitante sigue funcionando ==');
  /* A session room the visitor would look for, asked of the data. */
  const salaPublica = Object.keys(SESIONES).find(k => !k.startsWith('_') &&
    MODELO.floors.some(f => f.rooms.some(r => r.id === k && r.kind !== 'crew')));
  const ruta = await ev(`(() => { const r = rutaEntre({tipo: 'puerta', id: 'e-Main'}, {tipo: 'sala', id: ${JSON.stringify(salaPublica)}});
    return r && {puntos: (r.puntos || []).length, metros: r.metros, error: r.error || null}; })()`);
  ok(`una ruta de la entrada a ${salaPublica} sale`, ruta && ruta.puntos > 1 && !ruta.error, JSON.stringify(ruta));
  ok('las sesiones están todas', await ev(`Object.values(SESSIONS).reduce((a, l) => a + l.length, 0)`) ===
     Object.entries(SESIONES).filter(([k]) => !k.startsWith('_')).reduce((a, [, l]) => a + l.length, 0));

  await pub.close();
  console.log(`\n${pass} pasan, ${fail} fallan\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
