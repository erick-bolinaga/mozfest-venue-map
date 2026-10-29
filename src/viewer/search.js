/* ---------- search ----------
   Everything the trace already names: 23 buildings and 111 rooms. A room match
   also opens the floor it sits on, otherwise flying there shows a closed roof. */
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- src/plan2d.js ---------- */
__PLAN2D__
/* ---------- end of src/plan2d.js ---------- */

/* Most buildings carry no label yet: D.names maps 112 of its 140 ids straight
   back to themselves, so resolving a name the way the panel does often yields a
   raw layer id. Rather than hide those — Espai Vertical is one of them — the id
   is tidied into something a person can read and search. As real names arrive
   from the Figma trace this quietly stops firing. */
const looksLikeId = s => /^[a-z][a-z0-9-]*$/.test(s) && s.includes('-');
const tidy = s => s.replace(/^p-b-|^b-/, '').replace(/-/g, ' ').replace(/^./, c=>c.toUpperCase());
const nameOf = v => {
  /* Never the parent's D.names entry: a part that has no name of its own is not
     called whatever its building is called. Inheriting it put a second, badly
     spelled "L' Harmonía" in the search, pointing at Àster's tower. */
  const raw = v.name || D.names[v.id] || v.id;
  /* A resolved name that is still an id adds nothing D.names did not already
     hold. The volume's own id is the more specific of the two — the parent says
     b-salvia where the part says p-b-salvia-espai-vertical — so tidy that one
     and Espai Vertical becomes findable without waiting on the Figma trace. */
  return looksLikeId(raw) ? tidy(v.id) : raw;
};
const bbox = poly => {
  let x0=1e9, z0=1e9, x1=-1e9, z1=-1e9;
  poly.forEach(p=>{ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]);
                    z0=Math.min(z0,p[1]); z1=Math.max(z1,p[1]); });
  return {x0, z0, x1, z1, area:(x1-x0)*(z1-z0)};
};
/* One entry per name, not one per volume: a building traced as nine parts must
   not return nine identical rows. The largest footprint wins as the one to fly to. */
/* Accents are dropped from both sides before matching. Half these names are
   Catalan — Àster, L'Harmonia, Camamilla — and nobody types the accent on a
   phone while walking. Searching for what you can hear has to work. */
const fold = t => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* The name a floor's building answers to. When the model says the festival
   occupies a volume inside it, that volume is the one: the floors that were
   traced are ITS floors, and it is what the card will be titled once you land
   there. Àster's family starts with the nave, so without this a Reception on a
   traced floor of L'Harmonia announced itself as "Edificio B". */
const featLabel = feat => {
  const v = D.vols.find(x => x.id === (FEST[feat] || [])[0])
         || D.vols.find(x => x.id === feat);
  return v ? (siteName(v.id, v.of || v.id) || nameOf(v)) : tidy(feat);
};

/* A space's MozFest code — D3, C1, the 0 of the main access — is what is said
   over the radio and printed on its sign, so it is searchable wherever the
   organisation's document puts one: rooms, the festival's kit, a few volumes.
   Only the code: the document's own names for its rooms ("Room", "Stage",
   "Reception") would drag other rooms in front of the one being asked for. */
const codeOf = id => (MOZROOM[id] && MOZROOM[id].code) || '';

const uniq = new Map();
D.vols.forEach(v=>{
  const k = v.of || v.id, site = siteName(v.id, k), moz = mozKey(v.id, k);
  const label = site || nameOf(v), b = bbox(v.poly);
  const cur = uniq.get(label);
  /* Every name is searchable: someone who only ever heard "Building D", or
     wrote it "Bldg D" the way the organisation does, and someone reading
     "Fabra i Coats" off a door must land in the same place. "Bldg A" used to
     answer "Nothing here matches that" — telling the map where you are has to
     find the building. The names ride along in `alias` rather than as entries
     of their own, so one building is one result. */
  const letter = /^Building ([A-Z])$/.exec(moz || '');
  const others = [...((NAMES[v.id] || {}).alias || []), ...((NAMES[k] || {}).alias || [])];
  if(!cur || b.area > cur.area)
    uniq.set(label, {label,
                     alias: [moz, letter && 'Bldg ' + letter[1], letter && 'Bldg. ' + letter[1],
                             ...others, codeOf(v.id)].filter(Boolean).join(' '),
                     sub: v.kind==='reference' ? 'Nearby building'
                        : letter ? moz : (moz ? 'Building · ' + moz : 'Building'),
                     poly:v.poly, data:v, area:b.area});
});
/* Things that exist in a building but were never traced — a boiler room, the
   institute next to Àster's tower. They earn a search entry of their own that
   points at the volume holding them, so someone who asks by name is at least
   put in front of the right building. The label says so: this is a reference,
   not a position. */
const REFS = Object.entries(NAMES).flatMap(([id, e]) =>
  (e.references || []).map(r => {
    const v = D.vols.find(x => x.id === id);
    if(!v) return null;
    const k = v.of || v.id;
    const where = siteName(v.id, k) || mozKey(v.id, k) || tidy(v.id);
    return {label:r, sub:'Reference · ' + where, poly:v.poly, data:v};
  }).filter(Boolean));

/* Sessions are searched by title, and land exactly where a room result lands:
   the building, that floor, that room chosen. No new path — a session IS
   somewhere, and the room card underneath the plan already lists what happens
   in it, so arriving there answers both where and when at once.
   The day goes in as an alias, so "Thu 29" pulls up that day's programme.
   The room name deliberately does NOT, or searching a room would return the
   room and then every session inside it.
   A lab says so, and answers to «lab»: the app gives labs a tab of their own
   and people ask for them by that name (2026-10-29). */
const sessionBadge = x => x.lab ? 'Lab' : 'Session';
const sessionAlias = x => x.day + (x.lab ? ' Lab' : '');
const SESSION_HITS = Object.entries(SESSIONS).flatMap(([id, list]) => {
  const f = D.floors.find(x => (x.rooms||[]).some(r => r.id === id));
  /* The Music Stage's sessions hang from the stage itself, a piece of the kit:
     they land on its card, on their day. */
  const e = !f && EVENT.find(x => x.id === id && x.poly);
  if(e) return list.map(x => ({
    label: x.title, badge: sessionBadge(x), date: x.date, alias: sessionAlias(x),
    sub: x.day + ' · ' + x.start + '–' + x.end + ' · ' + e.label,
    poly: e.poly, data: {id: e.id, kind: 'event', name: e.label, h: e.h, est: true, ev: e}
  }));
  if(!f) return [];
  const r = f.rooms.find(x => x.id === id);
  return list.map(x => ({
    label: x.title, badge: sessionBadge(x),
    sub: x.day + ' · ' + x.start + '–' + x.end + ' · ' + r.name +
         ' · ' + featLabel(f.feat),
    poly: r.poly, floor: f, alias: sessionAlias(x),
    data: {kind:'room', name:r.name, area:r.area, id:r.id}
  }));
});

/* Booths and art pieces land the same way: on their room's plan, or on their
   piece of the kit. People ask for them by name at the festival, and the
   programme does not have them (2026-10-29). The booths change every day (the
   organisation's list), so the line underneath starts with which days and at
   which numbered position, then the place the way the app says it, if it does.
   The days and the organisation behind a booth (its logo in the app) are
   searchable too: people ask for eQualitie, not «Rewilding the Net». */
const boothWhen = b => {
  if(!b.when) return '';
  const p = b.when[0].position;
  return b.when.every(w => w.position === p)
    ? b.when.map(w => w.day).join(', ') + ' · position ' + p
    : b.when.map(w => w.day + ' (position ' + w.position + ')').join(', ');
};
const BOOTH_HITS = BOOTHS.map(b => {
  const badge = b.kind === 'art' ? 'Art' : 'Booth';
  const alias = [...(b.when || []).map(w => w.day), b.alias].filter(Boolean).join(' ');
  /* A piece of kit drawn on a room's plan lands on that room. */
  const e = EVENT.find(x => x.id === b.place);
  const room = e && !e.poly ? e.room : b.place;
  const f = D.floors.find(x => (x.rooms||[]).some(r => r.id === room));
  if(f){
    const r = f.rooms.find(x => x.id === room);
    return {label: b.name, badge, alias,
            sub: [boothWhen(b), b.where, b.where ? '' : codeOf(r.id), r.name, featLabel(f.feat)]
                   .filter(Boolean).join(' · '),
            poly: r.poly, floor: f,
            data: {kind:'room', name:r.name, area:r.area, id:r.id}};
  }
  if(e && e.poly) return {label: b.name, badge, alias,
    sub: [boothWhen(b), b.where, b.where ? '' : codeOf(e.id), e.label,
          outsideLine(e.poly) ? OUTSIDE_SPACE : ''].filter(Boolean).join(' · '),
    poly: e.poly, data: {id: e.id, kind: 'event', name: e.label, h: e.h, est: true, ev: e}};
  return null;
}).filter(Boolean);

const INDEX = [
  ...uniq.values(),
  /* Not a building and it has no floors, but it is what everyone navigates by
     and it answers to its name like everything else on the site. */
  ...(D.chimney ? [{label:'Chimney', sub:'Landmark', poly:D.chimney.poly,
                    data:{id:'chimney', kind:'landmark', name:'Chimney',
                          h:D.chimney.h, est:true}}] : []),
  /* The festival's kit. Everything here is provisional, and the row says so
     rather than presenting a food truck as firmly as a building. One that
     lives on a room lands on that room's plan; one with a polygon of its own
     lands on it in the 3D. */
  ...EVENT.map(e => {
    const f = e.room && D.floors.find(x => (x.rooms||[]).some(r => r.id === e.room));
    const r = f && f.rooms.find(x => x.id === e.room);
    const c = codeOf(e.id);
    /* And the festival's own name for the place, from its map: the radio says
       «Family Space» and «Food Village», never a code (the organisation,
       2026-10-16), and the tent is the Open Source House whatever the trace
       calls it. Unlike a room's «Room», these names say which place, so they
       are searchable. */
    const place = (MOZROOM[e.id] && MOZROOM[e.id].name) || '';
    return {label: e.label, badge: 'Provisional', alias: [c, place].filter(Boolean).join(' '),
            sub: (((D.kinds||{})[e.kind]||{}).label || 'Event') + (c ? ' · ' + c : '') +
                 (place && place !== e.label ? ' · ' + place : '') +
                 (r ? ' · ' + r.name + ' · ' + featLabel(f.feat) : '') +
                 (outsideLine(e.poly) ? ' · ' + OUTSIDE_SPACE : ''),
            poly: e.poly || (r && r.poly), floor: f || null,
            data: r ? {kind:'room', name:r.name, area:r.area, id:r.id}
                    : {id:e.id, kind:'event', name:e.label, h:e.h, est:true, ev:e}};
  }).filter(x => x.poly),
  ...REFS,
  /* The venue's own gates — 0 Back, where the public also comes in — are no
     building's door, so nothing else puts them in the search. A route can
     start or end at one; flying to it is all a plain search does. */
  ...ROUTES.doors.filter(p => !p.buildings.length).map(p => ({
    label: p.name, sub: 'Entrance',
    poly: [[p.x - 1.5, p.z - 1.5], [p.x + 1.5, p.z - 1.5], [p.x + 1.5, p.z + 1.5], [p.x - 1.5, p.z + 1.5]],
    data: {kind: 'door', id: p.id, name: p.name}}))
    .filter(e => !uniq.has(e.label)),
  /* A room says which building it is in. "Room on floor 03" was true of three
     different floors at once, and a floor number without a building names
     nowhere. */
  ...D.floors.flatMap(f=>(f.rooms||[]).map(r=>({
      label:r.name, alias:codeOf(r.id),
      sub:'Room · ' + (codeOf(r.id) ? codeOf(r.id) + ' · ' : '') + featLabel(f.feat) + ' · floor ' + f.level,
      poly:r.poly, floor:f,
      data:{kind:'room', name:r.name, area:r.area, id:r.id}}))),
  ...BOOTH_HITS,
  /* Last, so a building or a room outranks a talk that happens in it. */
  ...SESSION_HITS
];
/* Folded once here, not on every keystroke. */
INDEX.forEach(e=>{ e.hay = fold(e.label + ' ' + (e.alias || '')); });
function frame(poly){
  let x0=1e9, z0=1e9, x1=-1e9, z1=-1e9;
  poly.forEach(p=>{ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]);
                    z0=Math.min(z0,p[1]); z1=Math.max(z1,p[1]); });
  return {tx:(x0+x1)/2 - CX, ty:0, tz:(z0+z1)/2 - CZ,
          dist: Math.max(SPAN*0.16, Math.max(x1-x0, z1-z0) * 2.4),
          /* Half the diagonal: how far out the thing being flown to reaches, and
             therefore how short the sight line has to stop. */
          r: Math.hypot(x1-x0, z1-z0) / 2};
}

/* ---------- is there anything in the way ----------
   Espai Bota sits behind Rosa. Flying to it with the heading left alone put the
   camera where Rosa fills the screen, and no amount of raising the angle got
   round that: it is not height that is in the way, it is a building.

   Rather than hand every building a view of its own — a table of numbers that
   goes stale the moment anything is re-traced — this measures. Buildings become
   boxes once, and a segment from the camera to the target is tested against
   them. Boxes, not meshes: whether a BUILDING blocks a view is the question,
   its windows and railings are not, and 51 box tests are instant where ten
   thousand mesh intersections are not. */
const BOXES = D.vols.map(v => {
  let x0=1e9, z0=1e9, x1=-1e9, z1=-1e9;
  v.poly.forEach(p=>{ x0=Math.min(x0,p[0]); x1=Math.max(x1,p[0]);
                      z0=Math.min(z0,p[1]); z1=Math.max(z1,p[1]); });
  return {x0:x0-CX, x1:x1-CX, z0:z0-CZ, z1:z1-CZ,
          y1: Math.max(v.h || 0, v.rise || 0)};
});
/* Slab method: the segment survives only if it is inside every pair of planes
   at once. */
function segBox(a, b, k){
  let t0 = 0, t1 = 1;
  const lo = [k.x0, 0, k.z0], hi = [k.x1, k.y1, k.z1];
  const p = [a.x, a.y, a.z], d = [b.x-a.x, b.y-a.y, b.z-a.z];
  for(let i = 0; i < 3; i++){
    if(Math.abs(d[i]) < 1e-9){ if(p[i] < lo[i] || p[i] > hi[i]) return false; continue; }
    let ta = (lo[i]-p[i])/d[i], tb = (hi[i]-p[i])/d[i];
    if(ta > tb){ const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if(t0 > t1) return false;
  }
  return true;
}
/* The camera goes exactly where applyCam would put it, and looks at the middle
   of what it flew to rather than at the ground under it. Boxes standing OVER
   the target are skipped — that is the building itself, and its own walls are
   not what is hiding it — and the segment stops short of the target's own
   envelope for the same reason. */
function sightBlocked(to, r, y, p){
  const mid = Math.max(3, r * 0.5);
  const aim = {x:to.tx, y:to.ty + mid, z:to.tz};
  const cam = {x:to.tx + to.dist*Math.cos(p)*Math.sin(y),
               y:to.ty + to.dist*Math.sin(p),
               z:to.tz + to.dist*Math.cos(p)*Math.cos(y)};
  const k = Math.max(0, 1 - r / Math.hypot(aim.x-cam.x, aim.y-cam.y, aim.z-cam.z));
  const end = {x:cam.x + (aim.x-cam.x)*k, y:cam.y + (aim.y-cam.y)*k,
               z:cam.z + (aim.z-cam.z)*k};
  return BOXES.some(b =>
    !(to.tx >= b.x0 - 1 && to.tx <= b.x1 + 1 && to.tz >= b.z0 - 1 && to.tz <= b.z1 + 1)
    && segBox(cam, end, b));
}
/* The heading you already have first, then eighths of a turn either side, so
   the view swings as little as it has to. Giving up returns the current heading,
   which is what this did before it could see. */
function clearView(to, r){
  const p = Math.max(pitch, HOME_VIEW.pitch);
  if(!sightBlocked(to, r, yaw, p)) return {yaw, pitch:p};
  for(let i = 1; i <= 8; i++)
    for(const d of [i, -i]){
      const y = yaw + d * Math.PI / 8;
      if(!sightBlocked(to, r, y, p)) return {yaw:y, pitch:p};
    }
  return {pitch:p};
}
let hits = [];
/* ---------- how well a match matches ----------
   Plain `includes` treats "AI" in "for AI Governance" and the "ai" buried in
   "Espai 3" as the same thing. They are not, and the site is full of the second
   kind: Espai, Stair, Main. Searching AI returned 92 rows, the first 40 of which
   were every Espai and every Stair on the site, and the two talks with AI in
   their title came 72nd and 90th — past the cut, so they did not exist. Typing
   "for AI" worked only because the noise could not follow the space.

   So a match is graded and the good ones float. Three grades, which is all this
   needs: the word itself, the start of a word, and somewhere inside one.
   Nothing is thrown away — "espai" still finds Espai 3 — it is only ordered. */
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Word edges, on text that fold() has already stripped to lowercase and
   unaccented. An apostrophe counts as an edge, so L'Harmonia answers to
   "harmonia" at the second grade and not the third. */
function grader(q){
  const e = rxEsc(q);
  const whole = new RegExp('(?:^|[^a-z0-9])' + e + '(?![a-z0-9])');
  const start = new RegExp('(?:^|[^a-z0-9])' + e);
  return hay => whole.test(hay) ? 3 : start.test(hay) ? 2 : hay.includes(q) ? 1 : 0;
}
function runSearch(){
  const q = fold($('#q').value.trim());
  const box = $('#results');
  if(!q){ hits = []; box.innerHTML = '<p>Search for buildings, rooms, sessions and booths</p>'; return; }
  const grade = grader(q);
  /* The index order is the tie-break, not the sort: within one grade a building
     still outranks a room and a room still outranks a talk that happens in it,
     which is the order INDEX is built in. sort() is stable, so keeping the
     position is enough to keep that. */
  hits = INDEX.map((e, i) => ({e, i, g: grade(e.hay)}))
              .filter(x => x.g > 0)
              .sort((a, b) => b.g - a.g || a.i - b.i)
              .slice(0, 40).map(x => x.e);
  /* Two kinds of row, told apart in the markup: the ones that carry a badge
     (sessions, the festival's kit) and the ones whose line underneath already
     says what they are. The name gets a span of its own so it is a grid cell
     and not a loose text run beside the badge. */
  box.innerHTML = hits.length
    ? hits.map((e,i)=>'<button data-i="'+i+'"'+(e.badge ? ' class="tagged"' : '')+'>'+
        '<span class="name">'+esc(e.label)+'</span>'+
        (e.badge ? '<span class="tag">'+esc(e.badge)+'</span>' : '')+
        '<span class="k">'+esc(e.sub)+'</span></button>').join('')
    : '<p>Nothing here matches that.</p>';
}
$('#q').oninput = runSearch;
$('#results').onclick = e=>{
  const b = e.target.closest('button'); if(!b) return;
  const hit = hits[+b.dataset.i]; if(!hit) return;
  /* Choosing either end of a route reuses the search: then the hit is a
     place for the route, not somewhere to fly to (routes.js). */
  if(choosingPlace){ routeChosen(hit); return; }
  /* A result has to land on something you can SEE. Two things were in the way:
     the angle, which stayed wherever it was and from a low one put the camera at
     street level inside the building it flew to, and the heading, which left
     Espai Bota behind Rosa for ever. The pitch gets a floor — the opening shot's
     own, already chosen to clear the site — and the heading is searched for.
     Neither applies in 2D: straight overhead already sees everything. */
  const to = frame(hit.poly);
  /* The written view wins. Searching found A heading with the building in
     shot, which is not the same as a good one — from one side of Rosa, Espai
     Bota only just cleared the corner. A building whose view has been composed
     by hand gets that one; the search stays as the answer for anything not in
     the table yet. A room keeps its own framing and borrows only the angle:
     what is worth seeing there is the building it sits in. */
  const key = hit.floor ? hit.floor.feat : (hit.data.of || hit.data.id);
  const v = VIEWS[key];
  /* A stall is seven metres across among four-storey mills. Framed on its own
     footprint the camera arrives on top of it and low, which answers "what does
     it look like" when the question was "where is it". So the kit is pulled back
     to where its block fits on screen, and looked down on rather than at. */
  if(hit.data && hit.data.kind === 'event'){
    to.dist = Math.max(to.dist, SPAN * 0.34);
    to.r = Math.max(to.r, 12);
  }
  const wantPitch = hit.data && hit.data.kind === 'event' ? 0.62 : pitch;
  const how = view === '2d' ? {}
    : v ? {yaw: v.yaw ?? yaw, pitch: v.pitch ?? pitch,
           ...(hit.floor ? {} : {dist: v.dist ?? to.dist})}
        : {...clearView(to, to.r), pitch: Math.max(wantPitch, HOME_VIEW.pitch)};
  flyTo({...to, ...how}, 640);
  if(hit.floor){
    /* A room cannot be selected in the 3D any more — it lives on its building's
       plan. So land on the building, with that floor open and that room chosen,
       which is where the room actually is.

       On the festival's own volume when the model names one, not on whichever
       part the family happens to list first: Àster's starts with the nave, and
       a room traced on L'Harmonia's floors was arriving titled "Edificio B". */
    const fam  = GROUP[hit.floor.feat] || [];
    const fest = (FEST[hit.floor.feat] || [])
      .map(id => fam.find(x => x.userData.id === id)).find(Boolean);
    const m = fest || fam[0];
    if(m){
      select(m);
      sheetTab.tab = 'floors';
      sheetTab.level = hit.floor.level;
      sheetTab.room = hit.data.id;
      info(m.userData);
      /* A plan you cannot see is not an answer. A room and a session both come
         to rest on a plan, so the sheet arrives at its full height; a building
         has nothing under the fold yet and keeps the middle detent. */
      shiftDetent('large', true);
    }
  } else if(hit.data.kind === 'door'){
    /* A gate has no card: arriving there is the answer. */
    select(null);
  } else {
    /* select(), not info(). info() alone drew the card and left the building
       grey — flown to, and not chosen. */
    const fam = GROUP[hit.data.of || hit.data.id] || [];
    const m = fam.find(x => x.userData.id === hit.data.id) || fam[0];
    if(m) select(m); else info(hit.data);
    /* A session of the Music Stage opens the stage's card on its own day. */
    if(hit.date && sheet.open){ sheetTab.tab = 'sessions'; sheetTab.day = hit.date; retab(); }
    /* Said out loud rather than left to whatever the last result did: a building
       has nothing below the fold yet, so it rests at the middle detent even when
       the sheet was standing full height from a room a moment ago. */
    shiftDetent('medium', true);
  }
  openPop(null, false);
};
runSearch();

