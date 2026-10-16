/* ---------- routes from A to B ----------
   Outside only, for now: from where you are to the nearest public door of the
   building you want, and one line of text for the floors. No turns in words —
   the line on the map shows them, and there is a volunteer on every floor.
   Spec: docs/superpowers/specs/2026-09-29-rutas-a-b-design.md

   ROUTES (data.js) is a 0.5 m grid of where people can walk, built by build.py
   from src/routes.py, and the doors a route may use. The search is A* in
   eight directions without cutting a corner, from every door of the origin to
   every door of the destination at once, so the nearest pair wins by itself. */
const ROUTE_GRID = (() => {
  const b = atob(ROUTES.bits), u = new Uint8Array(b.length);
  for(let k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
  return u;
})();
const ROUTE_W = ROUTES.width, ROUTE_H = ROUTES.height, ROUTE_C = ROUTES.cell;
const ROUTE_WALK = 1.2;             /* walking pace, m/s */

function routeCell(x, z){
  return [Math.floor((x - ROUTES.x0) / ROUTE_C), Math.floor((z - ROUTES.z0) / ROUTE_C)];
}
function routeIsOpen(i, j){
  if(i < 0 || j < 0 || i >= ROUTE_W || j >= ROUTE_H) return false;
  const k = j * ROUTE_W + i;
  return (ROUTE_GRID[k >> 3] >> (k & 7)) & 1;
}
const routeCentre = (i, j) => [ROUTES.x0 + (i + .5) * ROUTE_C, ROUTES.z0 + (j + .5) * ROUTE_C];

/* The nearest open cell to a point, for an origin tapped or searched that sits
   on something — a stall, a wall. Rings outwards, up to ten metres. */
function routeFreeNear(x, z){
  const [i0, j0] = routeCell(x, z);
  for(let r = 0; r <= 20; r++)
    for(let di = -r; di <= r; di++)
      for(let dj = -r; dj <= r; dj++)
        if(Math.max(Math.abs(di), Math.abs(dj)) === r && routeIsOpen(i0 + di, j0 + dj))
          return [i0 + di, j0 + dj];
  return null;
}

/* A* with several starts and several goals. Returns the cells of the path,
   start first, or null. */
function routeSearch(starts, goals){
  const N = ROUTE_W * ROUTE_H;
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const isGoal = new Set(goals.map(([i, j]) => j * ROUTE_W + i));
  const h = (i, j) => {
    let m = Infinity;
    for(const [a, b] of goals){
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
  starts.forEach(([i, j]) => { const k = j * ROUTE_W + i; g[k] = 0; push(h(i, j), k); });
  while(heap.length){
    const k = pop();
    if(done[k]) continue;
    done[k] = 1;
    if(isGoal.has(k)){
      const out = [];
      for(let c = k; c !== -1; c = from[c]) out.push([c % ROUTE_W, (c / ROUTE_W) | 0]);
      return out.reverse();
    }
    const i = k % ROUTE_W, j = (k / ROUTE_W) | 0;
    for(let di = -1; di <= 1; di++) for(let dj = -1; dj <= 1; dj++){
      if(!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if(!routeIsOpen(ni, nj)) continue;
      /* A diagonal step past a closed corner would clip the building. */
      if(di && dj && !(routeIsOpen(i + di, j) && routeIsOpen(i, j + dj))) continue;
      const nk = nj * ROUTE_W + ni, c = g[k] + (di && dj ? Math.SQRT2 : 1);
      if(c < g[nk]){ g[nk] = c; from[nk] = k; push(c + h(ni, nj), nk); }
    }
  }
  return null;
}

/* A grid path zigzags. Keep a corner only where the straight line to the next
   point would leave the open cells: that is the whole of "string pulling". */
function routeSees(a, b){
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (ROUTE_C * .4)));
  for(let s = 0; s <= n; s++){
    const [i, j] = routeCell(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n);
    if(!routeIsOpen(i, j)) return false;
  }
  return true;
}
function routeStraighten(pts){
  if(pts.length < 3) return pts;
  const out = [pts[0]];
  let anchor = pts[0];
  for(let k = 2; k < pts.length; k++){
    if(!routeSees(anchor, pts[k])){ anchor = pts[k - 1]; out.push(anchor); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ---- where things are */
const routeFloorOf = id => D.floors.find(f => (f.rooms || []).some(r => r.id === id)) || null;
const routeDoorsOf = feat => ROUTES.doors.filter(p => p.buildings.includes(feat));
/* A place, resolved: the building it is in (if any), the floor, and the cells
   a route may start or end on — with the door each cell belongs to. */
function routePlace(l){
  if(l.type === 'door'){
    const p = ROUTES.doors.find(x => x.id === l.id);
    return p ? {feat: null, level: null, cells: [{c: routeCell(p.ax, p.az), door: p}], name: p.name} : null;
  }
  if(l.type === 'room' || l.type === 'building'){
    const f = l.type === 'room' ? routeFloorOf(l.id) : null;
    if(l.type === 'room' && !f) return null;
    const feat = f ? f.feat : l.id;
    const room = f && f.rooms.find(r => r.id === l.id);
    return {feat, level: f ? f.level : null, floor: f ? f.name : null,
            cells: routeDoorsOf(feat).map(p => ({c: routeCell(p.ax, p.az), door: p})),
            name: room ? room.name : featLabel(feat)};
  }
  if(l.type === 'point'){
    const c = routeFreeNear(l.x, l.z);
    return c ? {feat: null, level: null, cells: [{c, door: null}], name: l.name || 'Here'} : null;
  }
  return null;
}

/* Up or down, from one floor order to another, saying the floor you arrive
   at. Orders are the model's levels ('01', '02'…) or a door's own, like the
   '01.5' of Can Fontanet's lobby: strings that compare in the right order. */
function routeUpDown(from, to, name){
  if(!from || !to || !name || from === to) return null;
  return (to > from ? 'Go up to the ' : 'Go down to the ') + name;
}
/* The floor a door opens on, in the building it is being used for. */
const routeDoorFloor = (x, feat) => (x && x.door && x.door.floors && x.door.floors[feat]) || {};
/* "Building D" if the destination's MozFest code says so; the venue's name
   for the building otherwise. */
function routeBuilding(feat, roomId){
  const code = roomId && MOZROOM[roomId] && MOZROOM[roomId].code;
  const letter = code && (code.match(/^[A-Z]/) || [])[0];
  return featLabel(feat) + (letter ? ' (' + letter + ')' : '');
}

/* From one building into the next through a door they share: down to that
   door's floor on one side, up or down to the room on the other. */
function routeThrough(A, B, exit, entry){
  const pa = routeDoorFloor(exit, A.feat), pb = routeDoorFloor(entry, B.feat);
  const lines = [routeUpDown(A.level, pa.order, pa.name), routeUpDown(pb.order, B.level, B.floor)].filter(Boolean);
  return {points: [], metres: 0, door: entry ? entry.door : null, steps: lines.length ? lines : ["It's right here."]};
}

/* The one entry point. from and to are {type:'door'|'room'|'building'|'point', id?, x?, z?}.
   Returns {points:[[x,z]...], metres, door, steps:[lines]} or {error}. */
function routeBetween(from, to){
  const A = routePlace(from), B = routePlace(to);
  if(!A || !B) return {error: 'That place is not on the map.', points: [], steps: []};
  /* Same building: nothing to walk outside, only the stairs. */
  if(A.feat && A.feat === B.feat){
    if(!B.level) return {points: [], metres: 0, door: null, steps: ["You're already in this building."]};
    const s = routeUpDown(A.level || routeDoorFloor(B.cells[0], B.feat).order, B.level, B.floor);
    return {points: [], metres: 0, door: null, steps: [s || "It's on this floor."]};
  }
  /* One door for both: the lobby of Can Fontanet opens on the lobby and the
     museum, D0 Main on its lobby and La Fàbrica, and a door can be where you
     stand. There is nothing to walk — only floors, through that door. */
  const shared = A.cells.find(a => a.door && B.cells.some(b => b.door && b.door.id === a.door.id));
  if(shared) return routeThrough(A, B, shared, shared);
  if(!A.cells.length) return {error: 'No public door to leave ' + A.name + ' by.', points: [], steps: []};
  if(!B.cells.length) return {error: 'No public door into ' + B.name + '.', points: [], steps: []};
  /* A door that leads straight to the destination's floor is preferred — the
     side door of Espai Vertical faces the stairs down to level −1. */
  let goals = B.cells;
  const direct = B.floor ? B.cells.filter(x => x.door && [].concat(x.door.towards || []).includes(B.floor)) : [];
  if(direct.length) goals = direct;
  const path = routeSearch(A.cells.map(x => x.c), goals.map(x => x.c));
  if(!path) return {error: 'No way through to ' + B.name + ' on the map.', points: [], steps: []};
  const first = path[0], last = path[path.length - 1];
  const exit = A.cells.find(x => x.c[0] === first[0] && x.c[1] === first[1]);
  const entry = goals.find(x => x.c[0] === last[0] && x.c[1] === last[1]);
  /* Two doors on the same cell: as good as one door. */
  if(path.length < 2) return routeThrough(A, B, exit, entry);
  const points = routeStraighten(path.map(([i, j]) => routeCentre(i, j)));
  let metres = 0;
  for(let k = 1; k < points.length; k++) metres += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  const lines = [];
  const pa = routeDoorFloor(exit, A.feat), pb = routeDoorFloor(entry, B.feat);
  const down = A.level && routeUpDown(A.level, pa.order, pa.name);
  if(down) lines.push(down);
  lines.push(entry && entry.door && B.feat
    ? 'Walk to ' + routeBuilding(B.feat, to.type === 'room' ? to.id : null) + ' · ' + entry.door.name
    : 'Walk to ' + B.name);
  const up = B.level && routeUpDown(pb.order, B.level, B.floor);
  if(up) lines.push(up);
  lines.push(Math.max(5, Math.round(metres / 5) * 5) + ' m · ' + Math.max(1, Math.round(metres / ROUTE_WALK / 60)) + ' min');
  return {points: points, metres: metres, door: entry ? entry.door : null, steps: lines};
}

/* ---------- the route, on screen ----------
   Where you start is the Main entrance until you say otherwise, and ?desde=
   says otherwise from a link: a QR on a sign can carry the room it stands in. */
let routeFrom = {type: 'door', id: 'e-Main', name: 'Main entrance'};
let routeTo = null;
/* 'from' or 'to' while the search is choosing one end of the route;
   search.js hands the hit to routeChosen. */
let choosingPlace = null;

const routeGroup = new THREE.Group();
scene.add(routeGroup);
const ROUTE_ORANGE = 0xEF6C1F;
const matRoute = new THREE.MeshBasicMaterial({color: ROUTE_ORANGE, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2});
const matRouteStart = new THREE.MeshBasicMaterial({color: 0x17181B, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4});
/* The ink dot alone vanished on the dark theme's ground: a white ring round it
   shows on both. */
const matRouteRing = new THREE.MeshBasicMaterial({color: 0xffffff, side: THREE.DoubleSide,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3});
const ROUTE_Y = 0.18;
const ROUTE_PITCH = 1.15;          /* about 66° down */
/* Closer than this the four-storey mills along a route stand in front of it:
   measured on the Main entrance → D3 route at 1280 × 860. */
const ROUTE_DIST_MIN = 130;               /* above the flat blocks and areas (0.04, 0.09) */
const routeRibbons = () => routeGroup.children.filter(m => m.userData.ribbon).length;

/* A flat ribbon 2 m wide — any narrower and it is a thread from where the
   camera frames a whole route: a quad per stretch and a disc at every bend, so
   the corners close without mitring. One mesh, one draw call. */
function routeRibbon(points, a = 1.0){
  const pos = [], P = points.map(([x, z]) => [x - CX, z - CZ]);
  const tri = (p, q, r) => pos.push(p[0], ROUTE_Y, p[1], q[0], ROUTE_Y, q[1], r[0], ROUTE_Y, r[1]);
  for(let k = 1; k < P.length; k++){
    const [ax, az] = P[k - 1], [bx, bz] = P[k], L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / L * a, nz = (bx - ax) / L * a;
    tri([ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz]);
    tri([ax + nx, az + nz], [bx - nx, bz - nz], [ax - nx, az - nz]);
  }
  P.forEach(([x, z]) => routeDisc(tri, x, z, a));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, matRoute);
  m.userData.ribbon = true; m.renderOrder = 5;
  return m;
}
function routeDisc(tri, x, z, r, n = 16){
  for(let s = 0; s < n; s++){
    const t0 = s / n * 2 * Math.PI, t1 = (s + 1) / n * 2 * Math.PI;
    tri([x, z], [x + r * Math.cos(t0), z + r * Math.sin(t0)], [x + r * Math.cos(t1), z + r * Math.sin(t1)]);
  }
}
/* Where you start, in ink; where you arrive, a bigger orange dot at the door. */
function routeMarker([x, z], r, mat, lift = .01){
  const pos = [];
  routeDisc((p, q, s) => pos.push(p[0], ROUTE_Y + lift, p[1], q[0], ROUTE_Y + lift, q[1], s[0], ROUTE_Y + lift, s[1]), x - CX, z - CZ, r, 24);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, mat); m.renderOrder = 6;
  return m;
}
function routeStartMark(p){
  const ring = routeMarker(p, 1.8, matRouteRing, .01), dot = routeMarker(p, 1.2, matRouteStart, .02);
  ring.userData.start = dot.userData.start = true;
  dot.renderOrder = 7;
  return [ring, dot];
}
function routeRemoveRibbon(){
  routeGroup.children.slice().forEach(m => { routeGroup.remove(m); m.geometry.dispose(); });
}

/* The card, and the route on the map once both ends are known. Opened from the
   menu it starts without a destination: the card waits with an empty To. */
function routeShow(){
  routeRemoveRibbon();
  $('#routeFromName').textContent = routeFrom.name;
  $('#routeToBtn').toggleAttribute('data-empty', !routeTo);
  $('#routeToName').textContent = routeTo ? routeTo.name : 'Choose destination';
  const ol = $('#routeText');
  $('#route').hidden = false;
  if(!routeTo){ ol.replaceChildren(); closeSheet(); invalidate(); return; }
  const r = routeBetween(routeFrom, routeTo);
  ol.replaceChildren(...(r.error ? [r.error] : r.steps).map(t => {
    const li = document.createElement('li'); li.textContent = t;
    if(r.error) li.className = 'error';
    else if(/ m · \d+ min$/.test(t)) li.className = 'dist';
    return li;
  }));
  if(r.points && r.points.length >= 2){
    routeGroup.add(routeRibbon(r.points),
                  ...routeStartMark(r.points[0]),
                  routeMarker(r.points[r.points.length - 1], 2.0, matRoute));
    flyTo(routeFraming(r.points), 640);
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
function routeFraming(points){
  const [ax, az] = points[0], [bx, bz] = points[points.length - 1];
  const dx = bx - ax, dz = bz - az;
  /* camera.js: the camera sits at target + dist·(cos p·sin y, sin p, cos p·cos y),
     so on the ground "up the screen" is (−sin y, −cos y), "right" (cos y, −sin y). */
  const y = Math.atan2(-dx, -dz);
  const p = view === '2d' ? pitch : ROUTE_PITCH;
  const up = [-Math.sin(y), -Math.cos(y)], right = [Math.cos(y), -Math.sin(y)];
  const project = e => points.map(([x, z]) => x * e[0] + z * e[1]);
  const pu = project(up), pr = project(right);
  const height = Math.max(...pu) - Math.min(...pu), width = Math.max(...pr) - Math.min(...pr);
  const cx = points.reduce((s, q) => s + q[0], 0) / points.length, cz = points.reduce((s, q) => s + q[1], 0) / points.length;
  const tv = Math.tan(persp.fov * Math.PI / 360), th = tv * innerWidth / innerHeight;
  const room = 0.62;               /* the share of the screen height above the card */
  /* Far enough for the wider of the two fits, and never closer than the orbit allows. */
  const dist = Math.max(DIST_MIN, Math.min(DIST_MAX,
    Math.max(width / 2 * 1.25 / th, height / 2 * 1.25 * Math.sin(p) / (tv * room), ROUTE_DIST_MIN)));
  /* Nudge the target toward the camera, so the route rides up out of the card. */
  const nudge = dist * tv / Math.sin(p) * (1 - room) * 0.9;
  return {yaw: y, pitch: p, dist, tx: cx - up[0] * nudge - CX, ty: 0, tz: cz - up[1] * nudge - CZ};
}
function routeClose(){
  if(choosingPlace) openPop('search', false);
  routeTo = null;
  routeRemoveRibbon();
  $('#route').hidden = true;
  invalidate();
}

/* A room as the card names it: its MozFest code first, when it has one. */
function routeRoomName(id){
  const f = routeFloorOf(id), room = f && f.rooms.find(r => r.id === id), mk = MOZROOM[id];
  return (mk && mk.code ? mk.code + ' · ' : '') + (room ? room.name : id);
}
/* A search result, as either end of a route. A building with no public door
   of its own (the Main entrance's kiosk) is reached from, and left by, the
   open ground nearest to it instead. */
function routeFromHit(hit){
  const centroid = poly => [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  if(hit.data && hit.data.kind === 'door') return {type: 'door', id: hit.data.id, name: hit.label};
  if(hit.floor && hit.data && hit.data.kind === 'room')
    return {type: 'room', id: hit.data.id, name: routeRoomName(hit.data.id)};
  if(hit.data && hit.data.id && hit.data.kind !== 'event' && hit.data.id !== 'chimney'){
    const feat = hit.data.of || hit.data.id;
    if(routeDoorsOf(feat).length) return {type: 'building', id: feat, name: hit.label};
  }
  if(!hit.poly) return null;
  const [x, z] = centroid(hit.poly);
  return {type: 'point', x, z, name: hit.label};
}

/* One listener for every "How to get there", wherever the card that drew it. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-route]');
  if(!b) return;
  const [kind, rest] = b.dataset.route.split(/:(.*)/s);
  if(kind === 'room'){
    routeTo = {type: kind, id: rest, name: routeRoomName(rest)};
  } else if(kind === 'building' && sheetTab.feat === rest && sheetTab.room){
    /* The building's button goes to the room chosen on its plan, if there is
       one right now; asked when pressed, because the plan changes under it. */
    routeTo = {type: 'room', id: sheetTab.room, name: routeRoomName(sheetTab.room)};
  } else if(kind === 'building'){
    routeTo = {type: kind, id: rest, name: featLabel(rest)};
  } else if(kind === 'point'){
    const [x, z, ...n] = rest.split(',');
    routeTo = {type: kind, x: +x, z: +z, name: n.join(',')};
  } else return;
  routeShow();
});
$('#routeClose').onclick = routeClose;
/* Either end is chosen with the search, which then answers with a place
   instead of flying there. */
const Q_HINT = $('#q').placeholder;
function routeChoose(end){
  choosingPlace = end;
  $('#q').value = '';
  $('#q').placeholder = end === 'from' ? 'Where are you? e.g. Main entrance' : 'Where to? e.g. Espai Vertical';
  runSearch();
  openPop('search', true);
}
function routeChosen(hit){
  const end = choosingPlace, l = routeFromHit(hit);
  openPop('search', false);
  if(!l) return;
  if(end === 'from') routeFrom = l; else routeTo = l;
  routeShow();
}
$('#routeFromBtn').onclick = () => routeChoose('from');
$('#routeToBtn').onclick = () => routeChoose('to');
/* From the menu: the usual origin, no destination yet, and the search open to
   choose one. */
$('#routeMenuBtn .glyph').innerHTML = ROUTE_ICON;
$('#routeMenuBtn').onclick = () => {
  routeTo = null;
  routeShow();
  routeChoose('to');
};
/* However the search closes — a pick, Escape, the button — it stops choosing. */
new MutationObserver(() => {
  if($('#search').dataset.open !== 'true' && choosingPlace){ choosingPlace = null; $('#q').placeholder = Q_HINT; }
}).observe($('#search'), {attributes: true, attributeFilter: ['data-open']});

/* ?from=D3 — a MozFest room code, a door id or a building. Anything else is
   ignored and the Main entrance stays: a stale QR must not break the map.
   ?desde= is its name until 2026-10-16, still read so no link breaks. */
(() => {
  const params = new URLSearchParams(location.search);
  const q = (params.get('from') || params.get('desde') || '').trim();
  if(!q) return;
  const code = Object.entries(MOZROOM).find(([, m]) => m && m.code && m.code.toUpperCase() === q.toUpperCase());
  if(code && routeFloorOf(code[0])){
    const room = routeFloorOf(code[0]).rooms.find(r => r.id === code[0]);
    routeFrom = {type: 'room', id: code[0], name: code[1].code + ' · ' + room.name};
    return;
  }
  const p = ROUTES.doors.find(x => x.id === q);
  if(p){ routeFrom = {type: 'door', id: p.id, name: p.name}; return; }
  if(routeDoorsOf(q).length) routeFrom = {type: 'building', id: q, name: featLabel(q)};
})();
