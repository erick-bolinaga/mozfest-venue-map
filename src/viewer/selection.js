/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let selected=null;
renderer.domElement.addEventListener('click', e=>{
  if(moved) return;
  ptr.x = (e.clientX/innerWidth)*2-1; ptr.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr, camera);
  /* Every pick is a building now. Rooms left the 3D with the floor plans, and
     with them went the gate that had to stop a click on a glass wall from
     shutting the plan it was aimed at. */
  /* r128's raycaster ignores `visible`: zones turned off would go on
     receiving the click. What cannot be seen cannot be touched, and it is
     asked by climbing the parents because it is the whole group that is
     turned off. */
  const isShown = o => { for(; o; o = o.parent) if(!o.visible) return false; return true; };
  const hit = ray.intersectObjects(picks, false).find(h => isShown(h.object));
  /* While placing, FREE ground places a post and a building opens just as it
     always does. And only in 2D: Erick set it that way because in 3D a click
     on a roof is ambiguous — the ground below, the roof, the floor above? —
     and on a plan there is nothing to decide.

     The building is asked BEFORE the ground. Only the ground used to be
     asked, and the ray goes through the building and reaches it: pressing
     Rosa placed a post on its footprint, the sheet never opened and the
     floors — where placing already worked — were out of reach. Opening the
     building is the way to its plan.

     And a zone is ground: while placing, its tint does not steal the click
     from the post. */
  const onZone = hit && hit.object.userData.kind === 'zone';
  if(placing && view === '2d' && (!hit || onZone)){
    const groundHit = ray.intersectObject(ground, false)[0];
    if(groundHit){ placeAt(groundHit.point.x + CX, groundHit.point.z + CZ, null); return; }
  }
  /* With a finger, a tap that hits nothing — or only a zone's tint — picks
     the post within 24 px ON SCREEN. At whole-venue view a post is two pixels
     and no geometry fixes that; a tolerance in pixels does not depend on the
     zoom. Only the finger: the mouse points where it points (Erick,
     2026-09-14, from his phone). */
  if((!hit || onZone) && lastPointer === 'touch' && !placing){
    const near = stationNear(e.clientX, e.clientY, 24);
    if(near){ select(near); return; }
  }
  select(hit ? hit.object : null);
});
function stationNear(cx, cy, px){
  let best = null, d0 = px;
  crewGroup.children.forEach(g => {
    const v = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
    v.y += 0.9; v.project(camera);
    if(v.z > 1) return;
    const d = Math.hypot((v.x + 1) / 2 * innerWidth - cx, (1 - v.y) / 2 * innerHeight - cy);
    if(d < d0){ d0 = d; best = g.userData.fam && g.userData.fam[0]; }
  });
  return best;
}

/* ---------- the venue bubble ---------- */
/* Thirty of the eighty things that can be pressed hold nothing but a name:
   the nursery is traced in twenty volumes and the CITC in six, and each of
   them opened a whole panel to say one line. That is not a card, it is a
   label, and a label is shown where the thing is.

   The predicate does not call sheetParts even though that is exactly what
   decides whether there is a panel: that function moves sheetTab.level and
   sheetTab.day as it goes, and using it to ask would change the open floor as
   a side effect. It asks the two pure things that function itself depends
   on. */
const worldTip = document.querySelector('.worldtip');
/* One criterion, and it fits in one sentence: the panel opens when there is
   something to explore inside — floors or sessions — and everything else is a
   label.

   The first version also carried an "except the event's kit" clause, and it
   was indefensible: a food truck showed 39 px of content in a 745 px card,
   exactly like the CITC, and there is nothing inside one that is not inside
   the other. Erick saw it asking about the merch shop. */
const isLabel = u => {
  if(!u || !u.id) return false;
  const k = u.of || u.id;
  return !floorsOf(k).length && !sessionsIn(k).length;
};
/* The object's centre, projected onto the screen. Behind the camera the
   projection flips over and returns a point in front, so that case is
   discarded instead of drawing the bubble in the wrong place. */
/* With var and not const, on purpose: applyCam() runs at start-up, hundreds
   of lines before this, and a const would still be in its dead zone —
   reading it would throw. With var it is undefined, and placeWorldTip's guard
   returns before touching anything. */
var tipMesh = null;
/* Placing and showing are two different things because the search flies the
   camera AFTER the pick: the bubble was painted where the object was when
   pressed and stayed there while the venue moved underneath. The viewer's
   gestures close it, so this only ever gets to run during a flight. */
/* Centred over the thing and above it, but whole on screen: a bubble cut by
   the edge was half a name. It happened to everything near the edge, and with
   a post's, which is longer, it showed more (2026-10-16). The negative margin
   of .worldtip lifts it 8 px more. */
function placeTip(x, y){
  const m = 8, w = worldTip.offsetWidth / 2, h = worldTip.offsetHeight;
  worldTip.style.left = Math.min(Math.max(x, w + m), innerWidth - w - m) + 'px';
  worldTip.style.top = Math.max(y, h + 2 * m) + 'px';
}
function placeWorldTip(){
  if(!tipMesh) return;
  const box = new THREE.Box3().setFromObject(tipMesh);
  if(box.isEmpty()) return hideWorldTip();
  const p = box.getCenter(new THREE.Vector3());
  p.y = box.max.y;                       // at the top, not at the centre
  const v = p.clone().project(camera);
  if(v.z > 1) return hideWorldTip();
  placeTip((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight);
}
function tipContent(u){
  const k = u.of || u.id;
  const raw = siteName(u.id, k) || u.name || D.names[u.id] || u.id;
  /* The same as the panel showed, which was three lines: what it is called,
     what it is, and what MozFest calls it. All that changes is the size of the
     place where it is read. */
  const type = u.kind === 'event' && u.ev
    ? ((D.kinds || {})[u.ev.kind] || {}).label
    : u.kind === 'station' ? u.type
    : u.kind === 'zone' ? 'Volunteer zone' : null;
  const mk = MOZROOM[u.id];
  const key = mozKey(u.id, k) ||
    (mk ? [mk.code, mk.name].filter(Boolean).join(' · ') : null);
  const outside = u.kind === 'event' && u.ev ? outsideLine(u.ev.poly) : '';
  worldTip.innerHTML =
    `<strong>${esc(looksLikeId(raw) ? tidy(u.id) : raw)}</strong>` +
    (type ? `<span>${esc(type)}</span>` : '') +
    (key  ? `<span>${esc(key)}</span>`  : '') +
    (outside ? `<span>${esc(outside)}</span>` : '') +
    (u.where ? `<span>${esc(u.where)}</span>` : '');
}
function showWorldTip(mesh, u){
  tipContent(u);
  tipMesh = mesh;
  placeWorldTip();
  if(tipMesh) worldTip.dataset.on = 'true';
}
/* The same bubble, anchored to a point on the screen and not to a mesh: for a
   post's marker on a room's plan, which lives in the DOM. Without tipMesh,
   placeWorldTip leaves it where it is; the next tap anywhere else closes it,
   in interface.js. */
function showTipAt(x, y, u){
  tipContent(u);
  tipMesh = null;
  placeTip(x, y);
  worldTip.dataset.on = 'true';
}
function hideWorldTip(){ tipMesh = null; worldTip.dataset.on = 'false'; }

function select(mesh){
  (selected||[]).forEach(({m,orig})=>{ m.material = orig; });
  selected = null; festGroup.clear();
  /* It leaves here, so the invalidate() at the end never reaches it: without
     this the yellow stays on until something else asks for a redraw. */
  if(!mesh){ selKey = null; closeSheet(); card.innerHTML=''; hideWorldTip();
             invalidate(); return; }
  selKey = mesh.userData.of || mesh.userData.id;
  if(mesh.userData.id){
    const key = mesh.userData.of || mesh.userData.id;
    /* A post brings its family in userData: they are three loose pieces of a
       group that is redrawn whole, and they are not in GROUP, which is for
       buildings. */
    const fam = GROUP[key] || mesh.userData.fam || [mesh];
    const isRef = mesh.userData.kind==='reference' || LANDMARK.has(key);
    const fest = new Set(FEST[key] || []);
    selected = fam.map(m=>({m, orig:m.material}));
    fam.forEach(m=>{
      /* Whatever brings its own selected material — the zones — is not
         painted in the buildings' yellow. */
      m.material = m.userData.sel ? m.userData.sel
                 : isRef ? matSelRef
                 : (fest.has(m.userData.id) ? matSelFest : matSel);
    });
    /* The floors actually in use, marked on the ground: a building drawn as a
       single volume would otherwise go orange from end to end. */
    /* Nothing is drawn for a building that has no part of its own: the festival
       space has to be a traced volume, the way L'Harmonia is inside Aster.
       A block laid over the walls covered the windows and ignored the roof. */
  }
  /* It is marked in yellow as always — the gesture and its confirmation do
     not change — and all that changes is what it answers with. */
  if(isLabel(mesh.userData)){
    closeSheet(); card.innerHTML = '';
    /* A post's bubble is anchored to the whole figure, not to the piece that
       was pressed: that way it sits over the head and not over the foot. */
    showWorldTip(mesh.userData.fam ? mesh.parent : mesh, mesh.userData);
  } else {
    hideWorldTip();
    info(mesh.userData);
  }
  /* The readout names what is selected, and selecting moves no camera — so the
     line it prints has to be asked for here or it goes on naming the last one. */
  updateReadout();
  /* Selecting does not move the camera, so it does not go through applyCam:
     unless the redraw is asked for here, the yellow does not appear until you
     touch the view. */
  invalidate();
}

