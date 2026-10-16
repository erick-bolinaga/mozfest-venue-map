/* ---------- routes from A to B ----------
   Outside only, for now: from where you are to the nearest public door of the
   building you want, and one line of text for the floors. No turns in words —
   the line on the map shows them, and there is a volunteer on every floor.
   Spec: docs/superpowers/specs/2026-09-29-rutas-a-b-design.md

   RUTAS (datos.js) is a 0.5 m grid of where people can walk, built by armar.py
   from fuente/rutas.py, and the doors a route may use. The search is A* in
   eight directions without cutting a corner, from every door of the origin to
   every door of the destination at once, so the nearest pair wins by itself. */
const RUTA_REJ = (() => {
  const b = atob(RUTAS.bits), u = new Uint8Array(b.length);
  for(let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
  return u;
})();
const RUTA_W = RUTAS.ancho, RUTA_H = RUTAS.alto, RUTA_C = RUTAS.celda;
const RUTA_PASO = 1.2;             /* walking pace, m/s */

function rutaCelda(x, z){
  return [Math.floor((x - RUTAS.x0) / RUTA_C), Math.floor((z - RUTAS.z0) / RUTA_C)];
}
function rutaAbierta(i, j){
  if(i < 0 || j < 0 || i >= RUTA_W || j >= RUTA_H) return false;
  const k = j * RUTA_W + i;
  return (RUTA_REJ[k >> 3] >> (k & 7)) & 1;
}
const rutaCentro = (i, j) => [RUTAS.x0 + (i + .5) * RUTA_C, RUTAS.z0 + (j + .5) * RUTA_C];

/* The nearest open cell to a point, for an origin tapped or searched that sits
   on something — a stall, a wall. Rings outwards, up to ten metres. */
function rutaLibreCerca(x, z){
  const [i0, j0] = rutaCelda(x, z);
  for(let r = 0; r <= 20; r++)
    for(let di = -r; di <= r; di++)
      for(let dj = -r; dj <= r; dj++)
        if(Math.max(Math.abs(di), Math.abs(dj)) === r && rutaAbierta(i0 + di, j0 + dj))
          return [i0 + di, j0 + dj];
  return null;
}

/* A* with several starts and several goals. Returns the cells of the path,
   start first, or null. */
function rutaBuscar(inicios, metas){
  const N = RUTA_W * RUTA_H;
  const g = new Float32Array(N).fill(Infinity), de = new Int32Array(N).fill(-1), hecha = new Uint8Array(N);
  const esMeta = new Set(metas.map(([i, j]) => j * RUTA_W + i));
  const h = (i, j) => {
    let m = Infinity;
    for(const [a, b] of metas){
      const dx = Math.abs(a - i), dy = Math.abs(b - j);
      m = Math.min(m, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
    }
    return m;
  };
  /* binary heap of [f, k] */
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    for(let n = heap.length - 1; n > 0;){
      const p = (n - 1) >> 1;
      if(heap[p][0] <= heap[n][0]) break;
      [heap[p], heap[n]] = [heap[n], heap[p]]; n = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if(heap.length){
      heap[0] = last;
      for(let n = 0;;){
        const l = 2 * n + 1, r = l + 1; let m = n;
        if(l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if(r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if(m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]]; n = m;
      }
    }
    return top[1];
  };
  inicios.forEach(([i, j]) => { const k = j * RUTA_W + i; g[k] = 0; push(h(i, j), k); });
  while(heap.length){
    const k = pop();
    if(hecha[k]) continue;
    hecha[k] = 1;
    if(esMeta.has(k)){
      const out = [];
      for(let c = k; c !== -1; c = de[c]) out.push([c % RUTA_W, (c / RUTA_W) | 0]);
      return out.reverse();
    }
    const i = k % RUTA_W, j = (k / RUTA_W) | 0;
    for(let di = -1; di <= 1; di++) for(let dj = -1; dj <= 1; dj++){
      if(!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if(!rutaAbierta(ni, nj)) continue;
      /* A diagonal step past a closed corner would clip the building. */
      if(di && dj && !(rutaAbierta(i + di, j) && rutaAbierta(i, j + dj))) continue;
      const nk = nj * RUTA_W + ni, c = g[k] + (di && dj ? Math.SQRT2 : 1);
      if(c < g[nk]){ g[nk] = c; de[nk] = k; push(c + h(ni, nj), nk); }
    }
  }
  return null;
}

/* A grid path zigzags. Keep a corner only where the straight line to the next
   point would leave the open cells: that is the whole of "string pulling". */
function rutaVe(a, b){
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (RUTA_C * .4)));
  for(let s = 0; s <= n; s++){
    const [i, j] = rutaCelda(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n);
    if(!rutaAbierta(i, j)) return false;
  }
  return true;
}
function rutaEnderezar(pts){
  if(pts.length < 3) return pts;
  const out = [pts[0]];
  let ancla = pts[0];
  for(let k = 2; k < pts.length; k++){
    if(!rutaVe(ancla, pts[k])){ ancla = pts[k - 1]; out.push(ancla); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---- where things are */
const rutaPlantaDe = id => D.floors.find(f => (f.rooms || []).some(r => r.id === id)) || null;
const rutaPuertasDe = feat => RUTAS.puertas.filter(p => p.edificios.includes(feat));
/* A place, resolved: the building it is in (if any), the floor, and the cells
   a route may start or end on — with the door each cell belongs to. */
function rutaLugar(l){
  if(l.tipo === 'puerta'){
    const p = RUTAS.puertas.find(x => x.id === l.id);
    return p ? {feat: null, level: null, celdas: [{c: rutaCelda(p.ax, p.az), puerta: p}], nombre: p.nombre} : null;
  }
  if(l.tipo === 'sala' || l.tipo === 'edificio'){
    const f = l.tipo === 'sala' ? rutaPlantaDe(l.id) : null;
    if(l.tipo === 'sala' && !f) return null;
    const feat = f ? f.feat : l.id;
    const room = f && f.rooms.find(r => r.id === l.id);
    return {feat, level: f ? f.level : null, planta: f ? f.name : null,
            celdas: rutaPuertasDe(feat).map(p => ({c: rutaCelda(p.ax, p.az), puerta: p})),
            nombre: room ? room.name : featLabel(feat)};
  }
  if(l.tipo === 'punto'){
    const c = rutaLibreCerca(l.x, l.z);
    return c ? {feat: null, level: null, celdas: [{c, puerta: null}], nombre: l.nombre || 'Here'} : null;
  }
  return null;
}

/* Up or down, from one floor order to another, saying the floor you arrive
   at. Orders are the model's levels ('01', '02'…) or a door's own, like the
   '01.5' of Can Fontanet's lobby: strings that compare in the right order. */
function rutaSubeBaja(desde, hasta, nombre){
  if(!desde || !hasta || !nombre || desde === hasta) return null;
  return (hasta > desde ? 'Go up to the ' : 'Go down to the ') + nombre;
}
/* The floor a door opens on, in the building it is being used for. */
const rutaPlantaPuerta = (x, feat) => (x && x.puerta && x.puerta.plantas && x.puerta.plantas[feat]) || {};
/* "Building D" if the destination's MozFest code says so; the venue's name
   for the building otherwise. */
function rutaEdificio(feat, salaId){
  const code = salaId && MOZROOM[salaId] && MOZROOM[salaId].code;
  const letra = code && (code.match(/^[A-Z]/) || [])[0];
  return featLabel(feat) + (letra ? ' (' + letra + ')' : '');
}

/* From one building into the next through a door they share: down to that
   door's floor on one side, up or down to the room on the other. */
function rutaPorDentro(A, B, sale, entra){
  const pa = rutaPlantaPuerta(sale, A.feat), pb = rutaPlantaPuerta(entra, B.feat);
  const texto = [rutaSubeBaja(A.level, pa.orden, pa.nombre), rutaSubeBaja(pb.orden, B.level, B.planta)].filter(Boolean);
  return {puntos: [], metros: 0, puerta: entra ? entra.puerta : null, texto: texto.length ? texto : ["It's right here."]};
}

/* The one entry point. desde and hasta are {tipo:'puerta'|'sala'|'edificio'|'punto', id?, x?, z?}.
   Returns {puntos:[[x,z]...], metros, puerta, texto:[lines]} or {error}. */
function rutaEntre(desde, hasta){
  const A = rutaLugar(desde), B = rutaLugar(hasta);
  if(!A || !B) return {error: 'That place is not on the map.', puntos: [], texto: []};
  /* Same building: nothing to walk outside, only the stairs. */
  if(A.feat && A.feat === B.feat){
    if(!B.level) return {puntos: [], metros: 0, puerta: null, texto: ["You're already in this building."]};
    const s = rutaSubeBaja(A.level || rutaPlantaPuerta(B.celdas[0], B.feat).orden, B.level, B.planta);
    return {puntos: [], metros: 0, puerta: null, texto: [s || "It's on this floor."]};
  }
  /* One door for both: the lobby of Can Fontanet opens on the lobby and the
     museum, D0 Main on its lobby and La Fàbrica, and a door can be where you
     stand. There is nothing to walk — only floors, through that door. */
  const comun = A.celdas.find(a => a.puerta && B.celdas.some(b => b.puerta && b.puerta.id === a.puerta.id));
  if(comun) return rutaPorDentro(A, B, comun, comun);
  if(!A.celdas.length) return {error: 'No public door to leave ' + A.nombre + ' by.', puntos: [], texto: []};
  if(!B.celdas.length) return {error: 'No public door into ' + B.nombre + '.', puntos: [], texto: []};
  /* A door that leads straight to the destination's floor is preferred — the
     side door of Espai Vertical faces the stairs down to level −1. */
  let metas = B.celdas;
  const directa = B.planta ? B.celdas.filter(x => x.puerta && [].concat(x.puerta.hacia || []).includes(B.planta)) : [];
  if(directa.length) metas = directa;
  const camino = rutaBuscar(A.celdas.map(x => x.c), metas.map(x => x.c));
  if(!camino) return {error: 'No way through to ' + B.nombre + ' on the map.', puntos: [], texto: []};
  const ini = camino[0], fin = camino[camino.length - 1];
  const sale = A.celdas.find(x => x.c[0] === ini[0] && x.c[1] === ini[1]);
  const entra = metas.find(x => x.c[0] === fin[0] && x.c[1] === fin[1]);
  /* Two doors on the same cell: as good as one door. */
  if(camino.length < 2) return rutaPorDentro(A, B, sale, entra);
  const puntos = rutaEnderezar(camino.map(([i, j]) => rutaCentro(i, j)));
  let metros = 0;
  for(let k = 1; k < puntos.length; k++) metros += Math.hypot(puntos[k][0] - puntos[k - 1][0], puntos[k][1] - puntos[k - 1][1]);
  const texto = [];
  const pa = rutaPlantaPuerta(sale, A.feat), pb = rutaPlantaPuerta(entra, B.feat);
  const bajar = A.level && rutaSubeBaja(A.level, pa.orden, pa.nombre);
  if(bajar) texto.push(bajar);
  texto.push(entra && entra.puerta && B.feat
    ? 'Walk to ' + rutaEdificio(B.feat, hasta.tipo === 'sala' ? hasta.id : null) + ' · ' + entra.puerta.nombre
    : 'Walk to ' + B.nombre);
  const subir = B.level && rutaSubeBaja(pb.orden, B.level, B.planta);
  if(subir) texto.push(subir);
  texto.push(Math.max(5, Math.round(metros / 5) * 5) + ' m · ' + Math.max(1, Math.round(metros / RUTA_PASO / 60)) + ' min');
  return {puntos, metros, puerta: entra ? entra.puerta : null, texto};
}

/* ---------- the route, on screen ----------
   Where you start is the Main entrance until you say otherwise, and ?desde=
   says otherwise from a link: a QR on a sign can carry the room it stands in. */
let rutaOrigen = {tipo: 'puerta', id: 'e-Main', nombre: 'Main entrance'};
let rutaDestino = null;
/* 'origen' or 'destino' while the search is choosing one end of the route;
   buscador.js hands the hit to rutaElegido. */
let eligiendoLugar = null;

const rutaGrupo = new THREE.Group();
scene.add(rutaGrupo);
const RUTA_NARANJA = 0xEF6C1F;
const matRuta = new THREE.MeshBasicMaterial({color: RUTA_NARANJA, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2});
const matRutaInicio = new THREE.MeshBasicMaterial({color: 0x17181B, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4});
/* The ink dot alone vanished on the dark theme's ground: a white ring round it
   shows on both. */
const matRutaAro = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3});
const RUTA_Y = 0.18;
const RUTA_PITCH = 1.15;          /* about 66° down */
/* Closer than this the four-storey mills along a route stand in front of it:
   measured on the Main entrance → D3 route at 1280 × 860. */
const RUTA_DIST_MIN = 130;               /* above the flat blocks and areas (0.04, 0.09) */
const rutaCintas = () => rutaGrupo.children.filter(m => m.userData.cinta).length;

/* A flat ribbon 2 m wide — any narrower and it is a thread from where the
   camera frames a whole route: a quad per stretch and a disc at every bend, so
   the corners close without mitring. One mesh, one draw call. */
function rutaCinta(puntos, a = 1.0){
  const pos = [], P = puntos.map(([x, z]) => [x - CX, z - CZ]);
  const tri = (p, q, r) => pos.push(p[0], RUTA_Y, p[1], q[0], RUTA_Y, q[1], r[0], RUTA_Y, r[1]);
  for(let k = 1; k < P.length; k++){
    const [ax, az] = P[k - 1], [bx, bz] = P[k], L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / L * a, nz = (bx - ax) / L * a;
    tri([ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz]);
    tri([ax + nx, az + nz], [bx - nx, bz - nz], [ax - nx, az - nz]);
  }
  P.forEach(([x, z]) => rutaDisco(tri, x, z, a));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, matRuta);
  m.userData.cinta = true; m.renderOrder = 5;
  return m;
}
function rutaDisco(tri, x, z, r, n = 16){
  for(let s = 0; s < n; s++){
    const t0 = s / n * 2 * Math.PI, t1 = (s + 1) / n * 2 * Math.PI;
    tri([x, z], [x + r * Math.cos(t0), z + r * Math.sin(t0)], [x + r * Math.cos(t1), z + r * Math.sin(t1)]);
  }
}
/* Where you start, in ink; where you arrive, a bigger orange dot at the door. */
function rutaMarca([x, z], r, mat, alto = .01){
  const pos = [];
  rutaDisco((p, q, s) => pos.push(p[0], RUTA_Y + alto, p[1], q[0], RUTA_Y + alto, q[1], s[0], RUTA_Y + alto, s[1]), x - CX, z - CZ, r, 24);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, mat); m.renderOrder = 6;
  return m;
}
function rutaInicio(p){
  const aro = rutaMarca(p, 1.8, matRutaAro, .01), punto = rutaMarca(p, 1.2, matRutaInicio, .02);
  aro.userData.inicio = punto.userData.inicio = true;
  punto.renderOrder = 7;
  return [aro, punto];
}
function rutaQuitarCinta(){
  rutaGrupo.children.slice().forEach(m => { rutaGrupo.remove(m); m.geometry.dispose(); });
}

/* The card, and the route on the map once both ends are known. Opened from the
   menu it starts without a destination: the card waits with an empty To. */
function rutaMostrar(){
  rutaQuitarCinta();
  $('#rutaDesdeNombre').textContent = rutaOrigen.nombre;
  $('#rutaHasta').toggleAttribute('data-vacio', !rutaDestino);
  $('#rutaHastaNombre').textContent = rutaDestino ? rutaDestino.nombre : 'Choose destination';
  const ol = $('#rutaTexto');
  $('#ruta').hidden = false;
  if(!rutaDestino){ ol.replaceChildren(); closeSheet(); invalidate(); return; }
  const r = rutaEntre(rutaOrigen, rutaDestino);
  ol.replaceChildren(...(r.error ? [r.error] : r.texto).map(t => {
    const li = document.createElement('li'); li.textContent = t;
    if(r.error) li.className = 'error';
    else if(/ m · \d+ min$/.test(t)) li.className = 'dist';
    return li;
  }));
  if(r.puntos && r.puntos.length >= 2){
    rutaGrupo.add(rutaCinta(r.puntos),
                  ...rutaInicio(r.puntos[0]),
                  rutaMarca(r.puntos[r.puntos.length - 1], 2.0, matRuta));
    flyTo(rutaEncuadre(r.puntos), 640);
  }
  /* The map is the answer now: the sheet steps aside, the building stays lit. */
  closeSheet();
  invalidate();
}
/* Where the camera goes for a route: behind where you start, looking the way
   you will walk, so the route runs up the screen to the door. Tried across
   the screen on a wide one too, and the long naves beside the plaza stood in
   front of it; along it, they stand to the sides. It is looked down on,
   steeper than a building is
   framed, because a route is a line on the ground and at a low angle the first
   building along it hides it. The card covers the bottom of the screen, so
   the route is framed in what is left above it. */
function rutaEncuadre(puntos){
  const [ax, az] = puntos[0], [bx, bz] = puntos[puntos.length - 1];
  const dx = bx - ax, dz = bz - az;
  /* camera.js: the camera sits at target + dist·(cos p·sin y, sin p, cos p·cos y),
     so on the ground "up the screen" is (−sin y, −cos y), "right" (cos y, −sin y). */
  const y = Math.atan2(-dx, -dz);
  const p = view === '2d' ? pitch : RUTA_PITCH;
  const arriba = [-Math.sin(y), -Math.cos(y)], der = [Math.cos(y), -Math.sin(y)];
  const proy = e => puntos.map(([x, z]) => x * e[0] + z * e[1]);
  const pu = proy(arriba), pr = proy(der);
  const alto = Math.max(...pu) - Math.min(...pu), ancho = Math.max(...pr) - Math.min(...pr);
  const cx = puntos.reduce((s, q) => s + q[0], 0) / puntos.length, cz = puntos.reduce((s, q) => s + q[1], 0) / puntos.length;
  const tv = Math.tan(persp.fov * Math.PI / 360), th = tv * innerWidth / innerHeight;
  const hueco = 0.62;              /* the share of the screen height above the card */
  /* Far enough for the wider of the two fits, and never closer than the orbit allows. */
  const dist = Math.max(DIST_MIN, Math.min(DIST_MAX,
    Math.max(ancho / 2 * 1.25 / th, alto / 2 * 1.25 * Math.sin(p) / (tv * hueco), RUTA_DIST_MIN)));
  /* Nudge the target toward the camera, so the route rides up out of the card. */
  const baja = dist * tv / Math.sin(p) * (1 - hueco) * 0.9;
  return {yaw: y, pitch: p, dist, tx: cx - arriba[0] * baja - CX, ty: 0, tz: cz - arriba[1] * baja - CZ};
}
function rutaCerrar(){
  if(eligiendoLugar) openPop('search', false);
  rutaDestino = null;
  rutaQuitarCinta();
  $('#ruta').hidden = true;
  invalidate();
}

/* A room as the card names it: its MozFest code first, when it has one. */
function rutaNombreSala(id){
  const f = rutaPlantaDe(id), room = f && f.rooms.find(r => r.id === id), mk = MOZROOM[id];
  return (mk && mk.code ? mk.code + ' · ' : '') + (room ? room.name : id);
}
/* A search result, as either end of a route. A building with no public door
   of its own (the Main entrance's kiosk) is reached from, and left by, the
   open ground nearest to it instead. */
function rutaDeResultado(hit){
  const centro = poly => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  if(hit.data && hit.data.kind === 'puerta') return {tipo: 'puerta', id: hit.data.id, nombre: hit.label};
  if(hit.floor && hit.data && hit.data.kind === 'room')
    return {tipo: 'sala', id: hit.data.id, nombre: rutaNombreSala(hit.data.id)};
  if(hit.data && hit.data.id && hit.data.kind !== 'event' && hit.data.id !== 'chimney'){
    const feat = hit.data.of || hit.data.id;
    if(rutaPuertasDe(feat).length) return {tipo: 'edificio', id: feat, nombre: hit.label};
  }
  if(!hit.poly) return null;
  const [x, z] = centro(hit.poly);
  return {tipo: 'punto', x, z, nombre: hit.label};
}

/* One listener for every "How to get there", wherever the card that drew it. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ruta]');
  if(!b) return;
  const [tipo, resto] = b.dataset.ruta.split(/:(.*)/s);
  if(tipo === 'sala'){
    rutaDestino = {tipo, id: resto, nombre: rutaNombreSala(resto)};
  } else if(tipo === 'edificio' && sheetTab.feat === resto && sheetTab.room){
    /* The building's button goes to the room chosen on its plan, if there is
       one right now; asked when pressed, because the plan changes under it. */
    rutaDestino = {tipo: 'sala', id: sheetTab.room, nombre: rutaNombreSala(sheetTab.room)};
  } else if(tipo === 'edificio'){
    rutaDestino = {tipo, id: resto, nombre: featLabel(resto)};
  } else if(tipo === 'punto'){
    const [x, z, ...n] = resto.split(',');
    rutaDestino = {tipo, x: +x, z: +z, nombre: n.join(',')};
  } else return;
  rutaMostrar();
});
$('#rutaCerrar').onclick = rutaCerrar;
/* Either end is chosen with the search, which then answers with a place
   instead of flying there. */
const Q_PISTA = $('#q').placeholder;
function rutaElegir(para){
  eligiendoLugar = para;
  $('#q').value = '';
  $('#q').placeholder = para === 'origen' ? 'Where are you? e.g. Main entrance' : 'Where to? e.g. Espai Vertical';
  runSearch();
  openPop('search', true);
}
function rutaElegido(hit){
  const para = eligiendoLugar, l = rutaDeResultado(hit);
  openPop('search', false);
  if(!l) return;
  if(para === 'origen') rutaOrigen = l; else rutaDestino = l;
  rutaMostrar();
}
$('#rutaDesde').onclick = () => rutaElegir('origen');
$('#rutaHasta').onclick = () => rutaElegir('destino');
/* From the menu: the usual origin, no destination yet, and the search open to
   choose one. */
$('#rutaMenuBtn .glyph').innerHTML = ICONO_RUTA;
$('#rutaMenuBtn').onclick = () => {
  rutaDestino = null;
  rutaMostrar();
  rutaElegir('destino');
};
/* However the search closes — a pick, Escape, the button — it stops choosing. */
new MutationObserver(() => {
  if($('#search').dataset.open !== 'true' && eligiendoLugar){ eligiendoLugar = null; $('#q').placeholder = Q_PISTA; }
}).observe($('#search'), {attributes: true, attributeFilter: ['data-open']});

/* ?desde=D3 — a MozFest room code, a door id or a building. Anything else is
   ignored and the Main entrance stays: a stale QR must not break the map. */
(() => {
  const q = (new URLSearchParams(location.search).get('desde') || '').trim();
  if(!q) return;
  const code = Object.entries(MOZROOM).find(([, m]) => m && m.code && m.code.toUpperCase() === q.toUpperCase());
  if(code && rutaPlantaDe(code[0])){
    const room = rutaPlantaDe(code[0]).rooms.find(r => r.id === code[0]);
    rutaOrigen = {tipo: 'sala', id: code[0], nombre: code[1].code + ' · ' + room.name};
    return;
  }
  const p = RUTAS.puertas.find(x => x.id === q);
  if(p){ rutaOrigen = {tipo: 'puerta', id: p.id, nombre: p.nombre}; return; }
  if(rutaPuertasDe(q).length) rutaOrigen = {tipo: 'edificio', id: q, nombre: featLabel(q)};
})();
