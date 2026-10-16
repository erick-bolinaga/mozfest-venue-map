/* Checks the routes from A to B: the engine (rutaEntre) and, later, the card.
   Run it like the other bench:  herramientas/con-chrome.sh node herramientas/medir-rutas.js
   HTML=/otra/ruta.html to check a different build. */
const path = require('path');
const { connect, evaluate } = require('./cdp.js');
const FILE = 'file://' + (process.env.HTML || path.resolve(__dirname, '..', 'fabraicoats-3d.html'));

/* Asked of the data, not pinned: the room behind a MozFest code today. */
const REC = require('../fuente/mozfest-recinto.json').espacios;
const MODELO = require('../fuente/modelo.json');
/* The kit as armar.py merges it: a hand entry with the same id replaces the
   traced one, and one with 'retirado' takes it away (2026-10-16). */
const EVENTO = (() => {
  const a = require('../fuente/evento.json').items, b = require('../fuente/servicios.json').items;
  const fuera = new Set(b.filter(i => i.retirado === true).map(i => i.id));
  const m = new Map();
  for (const it of [...a, ...b]) if (!fuera.has(it.id)) m.set(it.id, it);
  return [...m.values()];
})();
const sala = code => REC[code].sala;

/* The same obstacles fuente/rutas.py closes the grid with. A route that
   crosses one of these has gone through a wall. */
const OBST = [
  ...MODELO.vols.filter(v => (v.base || 0) < 2).map(v => [v.id, v.poly]),
  ...EVENTO.filter(e => e.poly).map(e => [e.id, e.poly]),
];
const dentro = ([x, z], P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/* Every quarter metre along the route: which obstacles does it enter? */
function cruza(puntos) {
  const out = new Set();
  for (let k = 1; k < puntos.length; k++) {
    const [ax, az] = puntos[k - 1], [bx, bz] = puntos[k];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
    for (let s = 0; s <= n; s++) {
      const p = [ax + (bx - ax) * s / n, az + (bz - az) * s / n];
      OBST.forEach(([id, P]) => { if (dentro(p, P)) out.add(id); });
    }
  }
  return [...out];
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
};

(async () => {
  const { send, close } = await connect(FILE);
  await evaluate(send, `new Promise(r => { const t = () => document.readyState === 'complete' ? setTimeout(r, 1500) : setTimeout(t, 100); t(); })`);
  const ruta = (desde, hasta) => evaluate(send, `(() => {
    if (typeof rutaEntre !== 'function') return {falta: true};
    const t0 = performance.now();
    const r = rutaEntre(${JSON.stringify(desde)}, ${JSON.stringify(hasta)});
    return Object.assign({ms: performance.now() - t0}, r, {puerta: r.puerta && r.puerta.id});
  })()`);
  const MAIN = {tipo: 'puerta', id: 'e-Main'};

  console.log('\nEl motor');
  const d3 = await ruta(MAIN, {tipo: 'sala', id: sala('D3')});
  ok('existe rutaEntre()', !d3.falta);
  if (d3.falta) { console.log(`\n${pass} pasan, ${fail + 1} fallan\n`); close(); process.exit(1); }
  ok('Main entrance → D3 acaba en una puerta de D0 Main', /^d0-main-/.test(d3.puerta || ''), d3.puerta);
  ok('  ...y dice que se sube a la tercera', (d3.texto || []).some(t => t === 'Go up to the Third floor'), JSON.stringify(d3.texto));
  ok('  ...y da metros y minutos', d3.metros > 20 && (d3.texto || []).some(t => / m · \d+ min$/.test(t)), `${Math.round(d3.metros)} m`);
  const cruces = cruza(d3.puntos || []);
  ok('  ...y no atraviesa ningún volumen ni nada del montaje', (d3.puntos || []).length >= 2 && cruces.length === 0, cruces.join(', '));
  ok('  ...en menos de 200 ms', d3.ms < 200, `${d3.ms.toFixed(0)} ms`);

  const mismo = await ruta({tipo: 'sala', id: sala('D2')}, {tipo: 'sala', id: sala('D3')});
  ok('D2 → D3, el mismo edificio: sin línea, solo la planta',
     (mismo.puntos || []).length === 0 && JSON.stringify(mismo.texto) === JSON.stringify(['Go up to the Third floor']),
     JSON.stringify(mismo.texto));

  const f2 = await ruta(MAIN, {tipo: 'sala', id: sala('F2')});
  ok('Main entrance → F2, en el sótano: por la puerta de la escalera al −1', f2.puerta === 'e-salvia-to-minus-1', f2.puerta);
  ok('  ...y dice que se baja al sótano', (f2.texto || []).includes('Go down to the Basement'), JSON.stringify(f2.texto));
  ok('  ...sin atravesar nada', cruza(f2.puntos || []).length === 0, cruza(f2.puntos || []).join(', '));

  /* Espai Vertical's stairs-and-lift door opens straight onto the stairs and
     the lift (Erick, 2026-09-30): for any floor but the ground one it is the
     way in. The Production Office is on the top floor. */
  const arriba = await ruta(MAIN, {tipo: 'sala', id: 'r-05-b-salvia-production-office'});
  ok('Main entrance → la Production Office, arriba: por la escalera y el ascensor', arriba.puerta === 'e-salvia-stairs-lift' &&
     (arriba.texto || []).some(t => /Stairs and lift/.test(t)) && (arriba.texto || []).includes('Go up to the Top floor'),
     JSON.stringify([arriba.puerta, arriba.texto]));
  const planta = await ruta(MAIN, {tipo: 'sala', id: sala('F1')});
  ok('  ...y a la planta baja se entra sin subir ni bajar', !(planta.texto || []).some(t => /^Go (up|down)/.test(t)),
     JSON.stringify([planta.puerta, planta.texto]));

  /* 0 Back is a way in for the public (Erick, 2026-09-30): a gate, found by the
     search and usable as either end of a route. */
  const atras = await evaluate(send, `(() => {
    $('#q').value = '0 Back'; runSearch();
    const hit = hits.find(h => h.data && h.data.kind === 'puerta' && h.data.id === 'e-Secondary');
    const lugar = hit && rutaDeResultado(hit);
    const r = lugar && rutaEntre(lugar, {tipo: 'edificio', id: 'b-viola'});
    $('#q').value = ''; runSearch();
    return {hit: !!hit, sub: hit && hit.sub, lugar, metros: r && Math.round(r.metros), texto: r && r.texto};
  })()`);
  ok('0 Back se busca y sirve de origen', atras.hit && atras.lugar && atras.lugar.tipo === 'puerta' && atras.metros > 0 &&
     atras.texto.some(t => /^Walk to /.test(t)), JSON.stringify(atras));

  const sale = await ruta({tipo: 'sala', id: sala('D3')}, {tipo: 'sala', id: sala('E1')});
  ok('D3 → E1: primero bajar a la planta baja', (sale.texto || [])[0] === 'Go down to the Ground floor', JSON.stringify(sale.texto));
  ok('  ...y entrar por la puerta de Espai Bota', sale.puerta === 'e-lotus-acces-recinte', sale.puerta);
  ok('  ...sin atravesar nada', (sale.puntos || []).length >= 2 && cruza(sale.puntos).length === 0, cruza(sale.puntos || []).join(', '));

  /* Erick, 29-sep: between L'Harmonia and the music school there is a way
     through — venue ground, open to everyone. Without it the route went round
     the south of La Fàbrica: 243 m on the grid instead of 204. */
  const bota = await ruta(MAIN, {tipo: 'edificio', id: 'b-lotus'});
  ok('Main entrance → Espai Bota por el paso entre L\'Harmonia y la Escola de Música', bota.metros < 215, `${Math.round(bota.metros)} m`);

  const ref = await ruta(MAIN, {tipo: 'edificio', id: 'b-refence-e'});
  ok('a un edificio sin puerta pública: un error, no una ruta vacía', !!ref.error && !(ref.puntos || []).length, ref.error);

  const g1 = await ruta(MAIN, {tipo: 'sala', id: sala('G1')});
  ok('Main entrance → G1: por la entrada del museo, y sube al altillo',
     g1.puerta === 'e-fontanet-recinte' && (g1.texto || []).includes('Go up to the Mezzanine'), `${g1.puerta} ${JSON.stringify(g1.texto)}`);

  const g2 = await ruta(MAIN, {tipo: 'sala', id: sala('G2')});
  ok('Main entrance → G2: del lobby se baja a la planta de calle del museo', (g2.texto || []).includes('Go down to the Street level'), JSON.stringify(g2.texto));
  const g1d3 = await ruta({tipo: 'sala', id: sala('G1')}, {tipo: 'sala', id: sala('D3')});
  ok('G1 → D3: primero bajar al lobby', (g1d3.texto || [])[0] === 'Go down to the Lobby', JSON.stringify(g1d3.texto));
  const g0g1 = await ruta({tipo: 'sala', id: sala('G0')}, {tipo: 'sala', id: sala('G1')});
  ok('G0 → G1, que comparten puerta: sin línea, solo subir',
     (g0g1.puntos || []).length === 0 && JSON.stringify(g0g1.texto) === JSON.stringify(['Go up to the Mezzanine']), JSON.stringify(g0g1.texto));
  const d0d3 = await ruta({tipo: 'puerta', id: 'd0-main-1'}, {tipo: 'sala', id: sala('D3')});
  ok('desde una puerta del propio destino: sin línea, solo subir',
     (d0d3.puntos || []).length === 0 && JSON.stringify(d0d3.texto) === JSON.stringify(['Go up to the Third floor']), JSON.stringify(d0d3.texto));
  const propio = await ruta({tipo: 'sala', id: sala('D3')}, {tipo: 'edificio', id: 'b-rosa'});
  ok('a su propio edificio no dice «on this floor»', !(propio.texto || []).some(t => /this floor/.test(t)), JSON.stringify(propio.texto));

  console.log('\nLa tarjeta');
  const w = 'const w = ms => new Promise(r => setTimeout(r, ms));';
  /* Through the real card: search the room, open it, press the button. */
  const abrirYPulsar = code => evaluate(send, `(async () => { ${w}
    const id = ${JSON.stringify(sala(code))};
    const room = D.floors.flatMap(f => f.rooms).find(r => r.id === id);
    $('#q').value = room.name; runSearch();
    const i = hits.findIndex(h => h.data && h.data.id === id && !h.badge);
    if(i < 0) return {boton: false};
    document.querySelectorAll('#results button')[i].click(); await w(900);
    /* The search lands on the building with the room chosen on its plan: the
       building's own button takes you to that room. */
    const boton = card.querySelector('[data-ruta]');
    /* And the room's card, the one a tap on the plan opens, carries one too. */
    /* pickRoom toggles: the search left the room chosen, so the first press
       would unchoose it. Unchoose, then choose, to open its card. */
    if(sheetTab.room === id){ pickRoom(id); await w(300); }
    pickRoom(id); await w(600);
    const enSala = roomSheet.classList.contains('is-open') && !!roomBody.querySelector('[data-ruta="sala:' + id + '"]');
    if(!boton) return {boton: false, enSala};
    boton.click(); await w(900);
    const tarjeta = document.querySelector('#ruta');
    return {boton: true, enSala, destino: rutaDestino && rutaDestino.id,
            visible: !!tarjeta && !tarjeta.hidden, texto: tarjeta ? tarjeta.textContent : '',
            cintas: typeof rutaCintas === 'function' ? rutaCintas() : -1,
            hojaCerrada: !sheet.classList.contains('is-open')};
  })()`);
  const t = await abrirYPulsar('D3');
  ok('la ficha del edificio, llegando del buscador a una sala, lleva «How to get there» a esa sala', t.boton && t.destino === sala('D3'), t.destino);
  ok('  ...y la ficha de la sala también', t.enSala);
  ok('  ...y pulsarlo enseña la tarjeta de ruta', !!t.visible);
  ok('  ...con la planta y el origen', /Go up to the Third floor/.test(t.texto || '') && /Main entrance/.test(t.texto || ''), (t.texto || '').slice(0, 120));
  ok('  ...una cinta en el mapa', t.cintas === 1, `${t.cintas}`);
  ok('  ...y el panel se retira para que se vea', !!t.hojaCerrada);
  const inicio = await evaluate(send, `rutaGrupo.children.some(m => m.userData.inicio && m.material.color.getHex() === 0xffffff)`);
  ok('  ...y el origen lleva un aro claro, que se ve también en tema oscuro', inicio);

  /* The button lives on the title's line (Erick, 2026-09-30): an outlined pill
     with one word and an icon, to the right of the name and its subtitle, and
     clear of the sheet's close cross. Measured on the three cards that carry
     it, wide and at 390 px, where a long name has to wrap and not squeeze it. */
  const CABECERA = `(async () => { ${w}
    const medir = (raiz, cerrar) => {
      const b = raiz.querySelector('[data-ruta]'); if(!b) return {boton: false};
      const cab = b.closest('.ficha-cab'), tit = cab && cab.querySelector('.ficha-tit');
      const rb = b.getBoundingClientRect(), rx = cerrar.getBoundingClientRect();
      const rt = tit ? tit.getBoundingClientRect() : {top: 0, bottom: 0, right: 1e9};
      const cs = getComputedStyle(b);
      return {boton: true, enCab: !!tit && !!tit.querySelector('h2,h3'),
        texto: b.textContent.trim(), icono: !!b.querySelector('svg'),
        /* bare text is an anonymous flex item, which Firefox aligns off the icon */
        envuelto: [...b.childNodes].every(n => n.nodeType !== 3 || !n.textContent.trim()) && !!b.querySelector('span'),
        pildora: parseFloat(cs.borderTopLeftRadius) >= rb.height / 2 - .5,
        contorno: parseFloat(cs.borderTopWidth) > 0 && /rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor),
        mismaLinea: rb.top < rt.bottom && rb.bottom > rt.top && rb.left >= rt.right - .5,
        choca: !(rb.right <= rx.left || rb.left >= rx.right || rb.bottom <= rx.top || rb.top >= rx.bottom),
        ancho: +rb.width.toFixed(1), cabe: raiz.scrollWidth <= raiz.clientWidth + .5};
    };
    const buscar = async (q, pred) => { $('#q').value = q; runSearch();
      document.querySelectorAll('#results button')[Math.max(0, hits.findIndex(pred))].click(); await w(1100); };
    rutaCerrar(); if(roomSheet.classList.contains('is-open')){ sheetTab.room = null; closeRoom(); } await w(200);
    await buscar('Building D', () => true);
    const edificio = medir(card, document.querySelector('.sheet-close'));
    /* Kit with nothing programmed answers with a bubble, not a card, so its
       card is asked for directly: it is the one the Music Stage will get when
       its sessions hang from it. */
    let kit = null;
    scene.traverse(o => { if(!kit && o.userData && o.userData.kind === 'event' && o.userData.ev && o.userData.ev.poly) kit = o.userData; });
    select(null); await w(300); info(kit); await w(700);
    const montaje = medir(card, document.querySelector('.sheet-close'));
    await buscar('Lobby Can Fontanet', h => /Lobby Can Fontanet/.test(h.label));
    const largo = medir(card, document.querySelector('.sheet-close'));
    const id = ${JSON.stringify(sala('D3'))};
    const room = D.floors.flatMap(f => f.rooms).find(r => r.id === id);
    await buscar(room.name, h => h.data && h.data.id === id && !h.badge);
    if(sheetTab.room === id){ pickRoom(id); await w(300); } pickRoom(id); await w(700);
    const enSala = medir(roomBody, document.querySelector('.room-close'));
    select(null); await w(400);
    return {edificio, montaje, largo, sala: enSala};
  })()`;
  for (const [nombre, ancho, alto] of [['ancho', 1280, 860], ['390 px', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', {width: ancho, height: alto, deviceScaleFactor: 1, mobile: false});
    const c = await evaluate(send, CABECERA);
    for (const [ficha, m] of Object.entries(c)) {
      ok(`${nombre}: en la ficha de ${ficha}, el botón va en la línea del título y no toca la cruz`,
         m.boton && m.enCab && m.mismaLinea && !m.choca && m.cabe, JSON.stringify(m));
    }
    ok(`${nombre}:   ...dice «Directions» con icono, en píldora de contorno, y la palabra en su propio elemento`,
       Object.values(c).every(m => m.texto === 'Directions' && m.icono && m.pildora && m.contorno && m.envuelto),
       JSON.stringify(Object.values(c).map(m => [m.texto, m.icono, m.pildora, m.contorno])));
    ok(`${nombre}:   ...y un nombre largo no lo encoge`, c.largo.ancho === c.edificio.ancho, `${c.largo.ancho} / ${c.edificio.ancho}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');

  /* The building's button follows the plan: a room chosen goes to the room,
     none chosen goes to the building. */
  const sigue = await evaluate(send, `(async () => { ${w}
    rutaCerrar();
    const id = ${JSON.stringify(sala('D3'))};
    $('#q').value = 'Workshop'; runSearch();
    document.querySelectorAll('#results button')[hits.findIndex(h => h.data && h.data.id === id && !h.badge)].click(); await w(900);
    const bajo = card.querySelector('[data-level="01"]');
    if(bajo) bajo.click(); await w(400);
    card.querySelector('[data-ruta]').click(); await w(600);
    return {tipo: rutaDestino && rutaDestino.tipo, sala: sheetTab.room};
  })()`);
  ok('con la sala desmarcada, el botón del edificio lleva al edificio', sigue.tipo === 'edificio', JSON.stringify(sigue));

  /* The one line of a same-building answer is the instruction, not a footnote. */
  const estilo = await evaluate(send, `(async () => { ${w}
    const fs = () => { const li = document.querySelector('#rutaTexto li'); const c = getComputedStyle(li); return [c.fontSize, c.color, c.listStyleType]; };
    rutaOrigen = {tipo: 'puerta', id: 'e-Main', nombre: 'Main entrance'};
    rutaDestino = {tipo: 'sala', id: ${JSON.stringify(sala('D3'))}, nombre: 'D3'}; rutaMostrar(); await w(200);
    const normal = fs();
    rutaOrigen = {tipo: 'sala', id: ${JSON.stringify(sala('D2'))}, nombre: 'D2'}; rutaMostrar(); await w(200);
    const sola = fs();
    return {normal, sola};
  })()`);
  ok('la línea sola de un mismo edificio se ve como un paso, no como la nota de metros',
     JSON.stringify(estilo.normal) === JSON.stringify(estilo.sola), JSON.stringify(estilo));

  const cambio = await evaluate(send, `(async () => { ${w}
    document.querySelector('#rutaDesde').click(); await w(200);
    const eligiendo = eligiendoLugar === 'origen';
    $('#q').value = 'Espai Bota'; runSearch();
    const i = hits.findIndex(h => h.label === 'Espai Bota');
    document.querySelectorAll('#results button')[i].click(); await w(900);
    return {eligiendo, desde: document.querySelector('#rutaDesde').textContent,
            texto: document.querySelector('#ruta').textContent, cintas: rutaCintas()};
  })()`);
  ok('cambiar el origen abre el buscador para elegirlo', cambio.eligiendo);
  ok('  ...y elegido Espai Bota, la ruta sale de allí', /Espai Bota/.test(cambio.desde) && /Walk to Fabra i Coats \(D\)/.test(cambio.texto), cambio.desde);
  ok('  ...sigue habiendo una sola cinta', cambio.cintas === 1, `${cambio.cintas}`);

  const otra = await evaluate(send, `(async () => { ${w}
    document.body.insertAdjacentHTML('beforeend', '<button id="rutaPrueba" data-ruta="sala:${sala('F2')}">x</button>');
    document.querySelector('#rutaPrueba').click(); await w(900);
    document.querySelector('#rutaPrueba').remove();
    return {texto: document.querySelector('#ruta').textContent, cintas: rutaCintas()};
  })()`);
  ok('pedir otra ruta deja una sola cinta', otra.cintas === 1 && /Basement/.test(otra.texto), `${otra.cintas}`);

  /* As medir-sheet.js does it: mobile emulation widens the layout viewport. */
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
  const m390 = await evaluate(send, `(async () => { ${w} await w(600);
    const r = document.querySelector('#ruta').getBoundingClientRect();
    return {izq: r.left, der: r.right, doc: document.documentElement.scrollWidth};
  })()`);
  ok('a 390 px la tarjeta cabe y no desborda', m390.izq >= 0 && m390.der <= 390 && m390.doc <= 390, JSON.stringify(m390));
  await send('Emulation.clearDeviceMetricsOverride');

  const cerrar = await evaluate(send, `(async () => { ${w}
    document.querySelector('#rutaCerrar').click(); await w(300);
    return {oculta: document.querySelector('#ruta').hidden, cintas: rutaCintas()};
  })()`);
  ok('cerrar la ruta quita la tarjeta y la cinta', cerrar.oculta && cerrar.cintas === 0, JSON.stringify(cerrar));

  /* From the menu, both ends are yours to choose (Erick, 2026-09-30). The
     origin is the usual one; the destination starts empty and the search opens
     straight away to fill it. The card has the same two rows however it was
     opened, so the To row is there for a route from a card too. */
  console.log('\nGo from A to B, desde el menú');
  const ab = await evaluate(send, `(async () => { ${w}
    const fila = document.querySelector('#menu #rutaMenuBtn');
    if(!fila) return {fila: false};
    const pick = async (q, pred) => { $('#q').value = q; runSearch();
      const i = hits.findIndex(pred); if(i < 0) return false;
      document.querySelectorAll('#results button')[i].click(); await w(900); return true; };
    const estado = () => ({hasta: $('#rutaHasta').textContent, desde: $('#rutaDesde').textContent,
      tarjeta: !$('#ruta').hidden, cintas: rutaCintas(), pasos: $('#rutaTexto').textContent,
      buscador: $('#search').dataset.open === 'true', eligiendo: eligiendoLugar, pista: $('#q').placeholder});
    /* The origin a visitor chose earlier stays theirs; the test starts from the default. */
    rutaOrigen = {tipo: 'puerta', id: 'e-Main', nombre: 'Main entrance'};
    openPop('menu', true); fila.click(); await w(300);
    const r = {fila: true, texto: fila.textContent.trim(), menu: $('#menu').dataset.open !== 'true', al: estado()};
    r.eligio = await pick('Espai Bota', h => h.label === 'Espai Bota');
    r.con = estado();
    $('#rutaHasta').click(); await w(200);
    r.cambiando = estado();
    r.eligio2 = await pick('Espai Vertical', h => h.label === 'Espai Vertical');
    r.otra = estado();
    rutaCerrar(); openPop('menu', true); fila.click(); await w(300);
    openPop(null, false); await w(200);
    r.sinElegir = estado();
    rutaCerrar();
    return r;
  })()`);
  ok('el menú lleva «Go from A to B»', ab.fila && ab.texto === 'Go from A to B', ab.texto);
  ok('  ...que cierra el menú y abre la tarjeta con el destino por elegir',
     ab.menu && ab.al && ab.al.tarjeta && /Choose destination/.test(ab.al.hasta) && /Main entrance/.test(ab.al.desde) && ab.al.cintas === 0,
     JSON.stringify(ab.al));
  ok('  ...y el buscador, abierto para elegirlo', ab.al && ab.al.buscador && ab.al.eligiendo === 'destino' && /Where to/.test(ab.al.pista),
     JSON.stringify(ab.al && [ab.al.buscador, ab.al.eligiendo, ab.al.pista]));
  ok('  ...elegido Espai Bota, sale la ruta hasta allí', ab.eligio && /Espai Bota/.test(ab.con.hasta) && ab.con.cintas === 1 && /Walk to Espai Bota/.test(ab.con.pasos) && !ab.con.buscador,
     JSON.stringify(ab.con));
  ok('  ...y el destino se cambia con su fila', ab.cambiando.eligiendo === 'destino' && ab.cambiando.buscador && ab.eligio2 && /Espai Vertical/.test(ab.otra.hasta) && ab.otra.cintas === 1,
     JSON.stringify([ab.cambiando.eligiendo, ab.eligio2, ab.otra.hasta, ab.otra.cintas]));
  ok('  ...cerrar el buscador sin elegir deja la tarjeta esperando, sin error',
     ab.sinElegir.tarjeta && /Choose destination/.test(ab.sinElegir.hasta) && ab.sinElegir.cintas === 0 && !ab.sinElegir.pasos && !ab.sinElegir.eligiendo,
     JSON.stringify(ab.sinElegir));

  console.log('\nContraste');
  const CONTRASTE = `(() => {
    const rgba = s => { const m = s.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const sobre = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
      return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const raiz = getComputedStyle(document.documentElement);
    const fondo = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat(1);
    const tarjeta = sobre(rgba(getComputedStyle(document.querySelector('#ruta')).backgroundColor), fondo);
    const desde = sobre(rgba(getComputedStyle(document.querySelector('#rutaDesde')).backgroundColor), tarjeta);
    /* The button is an outline now: its text reads against the sheet behind it. */
    select(GROUP['b-rosa'][0]);
    const btn = card.querySelector('.ruta-btn');
    const hoja = sobre(rgba(getComputedStyle(document.querySelector('.sheet-panel')).backgroundColor), fondo);
    const cb = getComputedStyle(btn);
    const r = {boton: ratio(rgba(cb.color), sobre(rgba(cb.backgroundColor), hoja)),
            cambiar: ratio(rgba(getComputedStyle(document.querySelector('#rutaDesde .cambiar')).color), desde)};
    select(null);
    return r;
  })()`;
  for (const esquema of ['dark', 'light']) {
    const tab = await connect(FILE, esquema);
    await evaluate(tab.send, `new Promise(r => setTimeout(r, 2500))`);
    await evaluate(tab.send, `(rutaDestino = {tipo: 'sala', id: ${JSON.stringify(sala('D3'))}, nombre: 'D3'}, rutaMostrar(), true)`);
    const c = await evaluate(tab.send, CONTRASTE);
    ok(`tema ${esquema}: el botón se lee (≥ 4,5:1)`, c.boton >= 4.5, c.boton.toFixed(2));
    ok(`tema ${esquema}: «Change» se lee (≥ 4,5:1)`, c.cambiar >= 4.5, c.cambiar.toFixed(2));
    await tab.close();
  }

  console.log('\n?desde=');
  for (const [q, esperado, nombre] of [['E1', {tipo: 'sala', id: sala('E1')}, 'un código MozFest fija el origen en su sala'],
                                       ['ZZ9', {tipo: 'puerta', id: 'e-Main'}, 'uno que no existe deja la Main entrance']]) {
    const tab = await connect(FILE + '?desde=' + q);
    await evaluate(tab.send, `new Promise(r => setTimeout(r, 2500))`);
    const o = await evaluate(tab.send, `typeof rutaOrigen === 'object' && rutaOrigen ? {tipo: rutaOrigen.tipo, id: rutaOrigen.id} : null`);
    ok(nombre, !!o && o.tipo === esperado.tipo && o.id === esperado.id, JSON.stringify(o));
    await tab.close();
  }

  console.log(`\n${pass} pasan, ${fail} fallan\n`);
  close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
