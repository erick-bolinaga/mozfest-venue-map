/* ---------- where a post is ----------
   A post carries no person's name. Its code and its place are written by the
   Book of Answers (stations.json); what is next to it — a door, the bar, the
   tent — is worked out from the point, by distance, and never written down.
   That way a post that moves changes its description by itself and nobody has
   to remember to correct it. Erick's decision, 2026-09-11. */
const inPolygon = (x, z, poly) => {
  let c = false;
  for(let i = 0, n = poly.length; i < n; i++){
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    if(((z1 > z) !== (z2 > z)) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) c = !c;
  }
  return c;
};
const zoneOf = (x, z) => { const q = D.zones.find(w => inPolygon(x, z, w.poly)); return q ? q.zid : null; };
/* A POST's zone is not that of the polygon it falls in: the Book numbers by
   the zone of the captain who covers it, and G goes with F. The Espai Vertical
   door (F0) falls in E's polygon and the overflow one (D5) does too, and both
   belong to another zone. Without a code — the test ones — the polygon does. */
const stationZone = p => p.code ? (p.code[0] === 'G' ? 'F' : p.code[0]) : zoneOf(p.x, p.z);
const polygonDistance = (x, z, poly) => {
  if(inPolygon(x, z, poly)) return 0;
  let d = Infinity;
  for(let i = 0, n = poly.length; i < n; i++){
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return d;
};
/* What a thing is called, with what exists at this point of start-up: the
   venue name written by hand — the part's before the building's, since
   Salvia's two halves are the Habitatge and Espai Vertical —, or the one the
   trace brought if it is not an id. */
const notAnId = t => t && !/^[a-z][a-z0-9-]*$/.test(t) ? t : null;
const buildingName = (id, of) => siteName(id, of || id) || notAnId(D.names[id]) || (of && notAnId(D.names[of])) || of || id;
/* The real footprints, one by one: a post is named after the part next to
   it, not after the whole building. */
const FOOTPRINTS = D.vols.filter(v => v.kind !== 'reference' && !/reference/.test(v.id));
/* And a building with parts, by the part nearest the point: Salvia only has
   names by part — the Habitatge and Espai Vertical — and the F0 door came out
   as "b-salvia door", and the F1 inside as "b-salvia". */
function buildingAt(b, x, z){
  const parts = FOOTPRINTS.filter(v => v.of === b);
  if(!parts.length) return buildingName(b);
  const v = parts.reduce((m, q) => polygonDistance(x, z, m.poly) <= polygonDistance(x, z, q.poly) ? m : q);
  return buildingName(v.id, v.of);
}
function whereIs(p){
  const zone = stationZone(p);
  if(p.room){
    const f = D.floors.find(f => f.rooms.some(r => r.id === p.room));
    const r = f && f.rooms.find(r => r.id === p.room);
    const mk = MOZROOM[p.room];
    return {zone, where: f ? [buildingAt(f.feat, p.x, p.z), f.name, r.name + (mk && mk.code ? ` (${mk.code})` : '')].join(' · ') : p.room};
  }
  const cand = [];
  /* A door gets a 3 m head start: a post beside a building is almost always
     at its door, and "FC ESCACS door" says more than "next to". */
  (D.entrances || []).forEach(e => cand.push({d: Math.hypot(p.x - e.x, p.z - e.z) - 3,
    txt: e.of ? `${buildingAt(e.of, e.x, e.z)} door (${e.label})` : `${e.label} entrance`}));
  EVENT.forEach(it => { if(it.poly){ const mk = MOZROOM[it.id];
    cand.push({d: polygonDistance(p.x, p.z, it.poly), txt: it.label + (mk && mk.code ? ` (${mk.code})` : '')}); } });
  D.blocks.forEach(b => { if(b.cls === 'area' && b.poly){ const mk = MOZROOM[b.id];
    cand.push({d: polygonDistance(p.x, p.z, b.poly),
               txt: notAnId(D.names[b.id]) || (mk && mk.code ? `${mk.code} ${mk.name || ''}`.trim() : b.id)}); } });
  FOOTPRINTS.forEach(v => cand.push({d: polygonDistance(p.x, p.z, v.poly), txt: 'next to ' + buildingName(v.id, v.of)}));
  cand.sort((a, b) => a.d - b.d);
  /* An outdoor post inside one of the event's volumes cannot be seen: the tent
     is solid and swallows it. It happened to the two in the Open Source House,
     one of them since the day it was placed, and from the 3D there was no way
     to tell. */
  const covered = EVENT.find(it => it.poly && it.h > 0 && inPolygon(p.x, p.z, it.poly));
  return {zone, inZone: !!zoneOf(p.x, p.z), covered: covered ? covered.label : null,
          where: cand.length ? cand[0].txt : ''};
}
/* A new id: the code without spaces and the first free number — E3-2,
   A0-Main-1. Several posts share a code on purpose: the Book puts three in the
   Open Source House and six on the Main Stage, and the code says WHERE and not
   WHO. */
function newStationId(code){
  const base = code.replace(/ /g, '-');
  let n = 1;
  while(STATIONS.some(p => p.id === base + '-' + n)) n++;
  return base + '-' + n;
}

/* ---------- the outdoor posts ----------
   In their own group and not in volGroup, for two reasons: they are redrawn
   whole every time one is placed or removed, and they must be kept out of the
   merge of the static scene — which would take them into a single mesh, and
   there would be no figure left to delete. */
const crewGroup = new THREE.Group();
crewGroup.userData.noMerge = true;
scene.add(crewGroup);
/* The ring at the foot: bright green and unlit — MeshBasic — so it stands out
   the same in both themes and from above, which is where the figure shrinks to
   a dot. At 0.16 m: above the ground (−0.05) and the zone tints (0.12), since
   two surfaces in the same plane take turns with the angle. Erick asked for
   the radii by eye; he adjusts them by looking at the result. */
const ringGeo = new THREE.RingGeometry(0.55, 0.9, 40); ringGeo.rotateX(-Math.PI/2);
/* And its colour is the Book's priority, in the Book's own three colours:
   green, keep it covered; yellow, cover it if possible; blue, it may be left
   empty if volunteers are short. Without a priority — the test ones —, green. */
const ringMat = c => new THREE.MeshBasicMaterial({color:c, side:THREE.DoubleSide, depthWrite:false});
const matRing = ringMat(0x2BE36A);
const matRingByPriority = {high: matRing, medium: ringMat(0xF2B705), low: ringMat(0x2F9BEF)};
/* The VCs — the six at accreditation, according to the organisation — wear the
   ring in the festival's orange, the same that marks the space MozFest
   occupies. It is not yet clear what VC means; they are told apart anyway,
   which is what Erick asked for on 2026-09-14. */
const matRingVC = ringMat(0xEF6C1F);
/* What gets touched: an invisible cylinder 1.5 m in radius and as tall as the
   figure. The figure measures 19 cm and the ring starts at 55 cm, and between
   the two there is a hole the finger went through without hitting anything. It
   used to be a disc on the ground; seen side-on, a disc is a line, and the ray
   of a tap from a low camera passed over it. It is not drawn — visible:false
   costs no draw call — but the ray does see it. At whole-venue view it is still
   a couple of pixels: that is what the click's on-screen tolerance in
   selection.js is for. */
const targetGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.75, 16);
const matTarget = new THREE.MeshBasicMaterial();
/* What shows of a post is the PLACE, just as the Book says it and as it is said
   over the radio — "Open Source House", "Food Village": the organisation,
   16 Oct, "volunteers should use the place names, not their station #s". The
   Book's code goes after, on the line saying what it is. Where several share
   a code and a place a count is shown — "2 of 3", in file order —; the serial
   number in the id is ours and is never shown. */
const stationName = p => p.name || p.code || p.id;
function stationCount(p){
  if(!p.code) return '';
  const same = STATIONS.filter(q => q.code === p.code && q.name === p.name);
  return same.length > 1 ? `${same.indexOf(p) + 1} of ${same.length}` : '';
}
const PRIORITY_LABEL = {high: 'High priority', medium: 'Medium priority', low: 'Low priority'};
/* The line saying what it is: "Volunteer post E3 · 2 of 3 · Medium priority".
   The Main Stage ones say their team, because they belong to no zone captain. */
const stationLine = p => [('Volunteer post ' + (p.code || '')).trim(), stationCount(p),
  PRIORITY_LABEL[p.priority], p.team ? p.team + ' team' : '', p.vc ? 'VC' : ''].filter(Boolean).join(' \u00b7 ');
const stationWhere = w => (w.zone ? `Zone ${w.zone}` : 'Outside every zone') + (w.where ? ` \u00b7 ${w.where}` : '');
function drawStations(){
  while(crewGroup.children.length) crewGroup.remove(crewGroup.children[0]);
  /* The previous pass's ones leave picks, or the ray would go on hitting
     meshes that are no longer in the scene. */
  for(let i = picks.length - 1; i >= 0; i--) if(picks[i].userData.kind === 'station') picks.splice(i, 1);
  STATIONS.filter(p => !p.room).forEach(p=>{
    const g = figure(p.h || 1.75, matStation);
    g.position.set(p.x-CX, 0, p.z-CZ);
    const ring = new THREE.Mesh(ringGeo, p.vc ? matRingVC : (matRingByPriority[p.priority] || matRing));
    ring.position.y = 0.16; g.add(ring);
    const hitbox = new THREE.Mesh(targetGeo, matTarget); hitbox.position.y = 1.75/2; hitbox.visible = false; g.add(hitbox);
    /* Pickable: every piece carries the post's data and the whole family, so
       the selection marks the figure and not just the head. The ring and the
       hitbox are not recoloured: they are the marker, not the figure. */
    const fam = g.children.filter(c => c !== ring && c !== hitbox);
    const w = whereIs(p);
    const u = {id:p.id, kind:'station', name:stationName(p), type:stationLine(p), fam, vc: !!p.vc,
               where: stationWhere(w)};
    g.userData = u;
    g.children.forEach(c => { c.userData = u; picks.push(c); });
    crewGroup.add(g);
  });
  /* Pickable right away: the ray reads matrixWorld, and that is only updated
     on drawing. Without this, dragging a freshly placed post before the next
     frame hit nothing and moved the venue. */
  crewGroup.updateMatrixWorld(true);
  invalidate();
}
drawStations();

