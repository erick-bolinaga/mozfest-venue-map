/* ---------- panel ---------- */
/* The panel is the body of a sheet, so info() goes on writing into one element
   and knows nothing about how that element arrives on screen. */
const sheet   = document.getElementById('sheet');
const panel   = sheet.querySelector('.sheet-panel');
const card    = sheet.querySelector('[data-sheet-body]');
const roomSheet = sheet.querySelector('.roomsheet');
const roomBody  = roomSheet.querySelector('[data-room-body]');
const roomTip   = sheet.querySelector('.roomtip');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* There is no back arrow. A room used to be a card of its own, reached from its
   building, so it needed one; now it is a sheet inside the building's sheet and
   its close takes you back to the plan it came from. Escape does the same, one
   layer at a time. */

/* The detent transition lasts .48s. While it runs the sheet swallows further
   scroll, so the momentum of one flick cannot flip it straight back again.

   The lock is for GESTURES only. A flick can be refused because refusing it
   changes nothing: the sheet simply stays where it is. A deliberate move —
   opening a room, choosing a floor, landing from a search — cannot be refused,
   because the thing it is making room for goes ahead either way and arrives
   somewhere it cannot be read. Measured on a 390x844 screen the 2026-09-19:
   a room opened at the middle detent showed a 42px strip, 18px of which was
   its own top padding. Blank, with nothing in it but the close button.
   That is the iOS report, and it is not an iOS bug — Safari only makes the
   gesture easy to fire by accident with its rubber band at the top of a card.

   `forced` is the difference. Every caller that is a gesture leaves it off. */
let detentLock = false, detentTimer = 0;
function shiftDetent(d, forced){
  if((detentLock && !forced) || panel.dataset.detent === d) return;
  panel.dataset.detent = d;
  detentLock = true;
  /* One timer, restarted. Two overlapping shifts used to arm two timeouts and
     the first to land cleared the lock while the second transition still ran. */
  clearTimeout(detentTimer);
  detentTimer = setTimeout(()=>{ detentLock = false; }, 480);
}

/* Three states, not two: closed, up, and still sliding down from a close that
   has not finished. Catching that third one is what stops a quick reopen from
   inheriting the detent of the sheet it interrupted. */
function openSheet(){
  if(sheet.open && sheet.classList.contains('is-open')) return;   /* already up */
  panel.dataset.detent = 'medium';
  if(!sheet.open){
    sheet.show();              /* show, never showModal — see the CSS */
    void panel.offsetHeight;   /* commit the closed transform before opening */
  }
  sheet.classList.add('is-open');
}
function closeSheet(){
  if(!sheet.open) return;
  closeRoom(); hideTip();
  sheet.classList.remove('is-open');
  const finish = ()=>{ if(!sheet.classList.contains('is-open')) sheet.close(); };
  if(reduceMotion) finish(); else setTimeout(finish, 500);
}

sheet.querySelector('.sheet-grabber').onclick = ()=>
  shiftDetent(panel.dataset.detent === 'large' ? 'medium' : 'large');
sheet.querySelector('[data-sheet-close]').onclick = ()=> select(null);
/* The room's own close puts you back on its plan, not out of the building. */
roomSheet.querySelector('[data-room-close]').onclick = ()=>{
  sheetTab.room = null; closeRoom(); retab();
};
/* The scrim is the rest of the dialog. Clicking it is the plain way of saying
   you are done, and done means nothing is selected any more.

   The test is `e.target === sheet` and NOT `!panel.contains(e.target)`. A click
   inside the panel redraws the card on its way up — picking a room rebuilds the
   whole thing — so by the time the event reaches here the node that was clicked
   has been thrown away, is inside nothing at all, and `contains` says false.
   That closed the sheet on every room you pressed. The dialog only ever is the
   target when the click landed on the scrim itself, which is the actual
   question being asked. */
sheet.addEventListener('click', e=>{ if(e.target === sheet) select(null); });

/* Scroll to grow: from medium a downward scroll takes it to large; at large,
   scrolling up with the content already at its top brings it back to medium.
   The same gesture by finger, with a threshold so a tap never counts. */
card.addEventListener('wheel', e=>{
  if(detentLock){ e.preventDefault(); return; }
  if(panel.dataset.detent === 'medium'){
    if(e.deltaY > 0){ e.preventDefault(); shiftDetent('large'); }
  } else if(e.deltaY < 0 && card.scrollTop <= 0){
    e.preventDefault(); shiftDetent('medium');
  }
}, {passive:false});
let touchY = null;
card.addEventListener('touchstart', e=>{
  touchY = e.touches[0] ? e.touches[0].clientY : null;
}, {passive:true});
card.addEventListener('touchmove', e=>{
  if(touchY === null || detentLock) return;
  const dy = touchY - (e.touches[0] ? e.touches[0].clientY : touchY);   /* >0 is a swipe up */
  if(panel.dataset.detent === 'medium'){
    if(dy > 24){ e.preventDefault(); shiftDetent('large'); touchY = null; }
  } else if(dy < -24 && card.scrollTop <= 0){
    e.preventDefault(); shiftDetent('medium'); touchY = null;
  }
}, {passive:false});
/* ---------- what the sheet shows ----------
   One card per building, and its body is tabbed:

     (Sessions) (Floors)             the two halves of what a building offers
      Wed 28 · Thu 29 · Fri 30   or  Street level · Mezzanine

   Sessions group by day because that is how anyone at a festival asks the
   question. Floors draw a plan, and picking a room on it raises a sheet of its
   own from the top of the tab panel down — over the plan, deliberately. What
   must not be lost is not the drawing but WHERE YOU ARE, and the building, its
   tabs and the floor you chose all stay above the ceiling. The plan is one
   press of the room's own close away.

   The rooms that are only a way through — stairs, lifts, toilets, crew — do not
   raise anything. They answer with a bubble carrying their name.

   The state lives in one object and not in the DOM, so a redraw puts back
   exactly what you were looking at. It resets when the building changes, and
   only then. */
let sheetTab = {feat:null, tab:'floors', day:null, level:null, room:null};

const floorsOf = feat => D.floors.filter(f => f.feat === feat);

/* Every session in a building, flattened out of the by-room map and carrying
   the room it happens in. Sorted by day and then by clock, which is the order a
   programme gets read in. */
function sessionsIn(feat){
  const out = [];
  floorsOf(feat).forEach(f => f.rooms.forEach(r =>
    (SESSIONS[r.id] || []).forEach(s => out.push(Object.assign({}, s, {room:r, floor:f})))));
  /* A piece of the festival's kit with a programme of its own — the Music
     Stage — has its sessions under its own id, and no room to name. */
  (SESSIONS[feat] || []).forEach(s => out.push(Object.assign({}, s, {room:null, floor:null})));
  return out.sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/* Tabs, not a toggle. The shell is the one the 2D/3D switch wears, because it
   is the same gesture; what changes is the semantics underneath — aria-selected
   and a tablist, where a switch would say aria-pressed. */
const tabBtn = (val, label, on, kind) =>
  `<button role="tab" data-${kind}="${esc(val)}" aria-selected="${on}"` +
  /* Named as well as written, because the writing may be elided to fit. */
  ` aria-label="${esc(label)}" tabindex="${on ? 0 : -1}">${esc(label)}</button>`;

/* Returns the card's parts rather than one string, because they have different
   lifetimes. The tab row is built once per building and then left alone: the
   pill behind it only travels if it is the SAME element across a change, and
   rebuilding the row gave the browser a newborn with no position to leave from,
   so it landed on the new tab instantly every time. Everything under the row is
   cheap and gets rewritten. */
/* One row of sub-tabs, floors or days alike. Each button carries its own anchor
   name so the bubble behind them has something to aim at; the names are made
   here because a row is one to five buttons long and its values come from the
   trace, so they cannot be written into the stylesheet the way the two names of
   the tab row above can. */
function subRow(kind, items, chosen, label){
  const i = Math.max(0, items.findIndex(x => x.v === chosen));
  return `<div class="subrow"><div class="subtabs" role="tablist" aria-label="${label}">` +
    `<span class="sub-pill" aria-hidden="true" style="position-anchor:--sub-${i}"></span>` +
    items.map((x, n) =>
      `<button role="tab" data-${kind}="${esc(x.v)}" data-n="${n}"` +
      ` aria-selected="${n === i}" aria-label="${esc(x.t)}" tabindex="${n === i ? 0 : -1}"` +
      ` style="anchor-name:--sub-${n}">${esc(x.t)}</button>`).join('') +
    `</div></div>`;
}

/* Points the bubble at whichever sub-tab is chosen. Setting the property rather
   than redrawing the row is the whole trick: the bubble has to be the SAME
   element across a change or it has no position to travel from. */
function aimSubPill(){
  const row = card.querySelector('.subtabs');
  const on  = row && row.querySelector('[role="tab"][aria-selected="true"]');
  const pill= row && row.querySelector('.sub-pill');
  if(on && pill) pill.style.setProperty('position-anchor', '--sub-' + on.dataset.n);
}

function sheetParts(feat){
  const fls  = floorsOf(feat);
  const sess = sessionsIn(feat);
  if(!fls.length && !sess.length) return null;

  /* Only the days this building actually has something on. A tab that opens on
     "nothing today" is a tab that should not have been drawn. */
  const days = [];
  sess.forEach(s => { if(!days.some(d => d.date === s.date)) days.push({date:s.date, day:s.day}); });
  days.sort((a,b) => a.date.localeCompare(b.date));

  /* A tab is never bounced back. Pressing Sessions on a building with none
     used to land you silently on Floors again, which reads as a dead control;
     it says so instead. Which tab a card OPENS on is decided once, in info(),
     when the building changes. */
  /* A piece of the kit with a programme — the Music Stage — stands in the open:
     it has no floors to offer, so it gets its sessions and no tab row. */
  const sessionsOnly = !fls.length && EVENT.some(e => e.id === feat);
  const onFloors = !sessionsOnly && sheetTab.tab === 'floors';

  if(onFloors){
    if(fls.length && !fls.some(f => f.level === sheetTab.level)) sheetTab.level = fls[0].level;
  } else if(!days.some(d => d.date === sheetTab.day)){
    sheetTab.day = days.length ? days[0].date : null;
  }

  const tabs = sessionsOnly ? '' : `<div class="seg tabs" role="tablist" aria-label="What to show">` +
    `<div class="tab-pill" aria-hidden="true"></div>` +
    tabBtn('sessions', 'Sessions', !onFloors, 'tab') +
    tabBtn('floors',   'Floors',   onFloors,  'tab') + `</div>`;

  let subs = '', panel = '', sig = 'none';
  if(onFloors && !fls.length){
    panel = `<p class="hint">No plan has been traced for this building yet.</p>`;
  } else if(!onFloors && !days.length){
    panel = `<p class="hint">Nothing is programmed in this building.</p>`;
  } else if(onFloors){
    const f = fls.find(x => x.level === sheetTab.level) || fls[0];
    const room = f.rooms.find(r => r.id === sheetTab.room);
    /* A building with one floor is offered no choice of floor. A lone pill you
       cannot deselect is a control that does nothing, so the floor names itself
       above its plan and that is all. */
    subs = fls.length > 1
      ? subRow('level', fls.map(x => ({v:x.level, t:x.name})), f.level, 'Floor')
      : `<p class="planhead">${esc(f.name)}</p>`;
    sig = 'f:' + fls.map(x => x.level).join(',');
    panel = plan2d(f, room ? room.id : null);
  } else {
    const day  = days.find(d => d.date === sheetTab.day) || days[0];
    subs = subRow('day', days.map(d => ({v:d.date, t:d.day})), day.date, 'Day');
    sig  = 'd:' + days.map(d => d.date).join(',');
    const list = sess.filter(s => s.date === day.date);
    panel = `<div class="ses">` + list.map(s =>
      `<div><strong>${esc(s.title)}</strong><span>${esc(s.start)}–${esc(s.end)}` +
      `${s.room ? ' · ' + esc(s.room.name) : ''}${s.floor && s.floor.name ? ' · ' + esc(s.floor.name) : ''}</span></div>`).join('') +
      `</div>`;
  }
  return {tabs, onFloors, subs, panel, sig};
}

/* Everything under the tab row, redrawn. The row itself keeps its identity and
   only has its chosen tab moved, which is what lets the pill travel. */
function retab(u){
  const parts = sheetParts(sheetTab.feat);
  if(!parts) return;
  /* sheetTab.feat is the LAST building opened, not the one that is open:
     closing the sheet empties the card and leaves it set. Placing a post after
     closing a building called retab() on an empty card and blew up halfway —
     the post went into the list and the list was not repainted. */
  if(!card.querySelector('.tabrest')) return;
  /* The bubble's anchor lives in the plan, and the plan is rebuilt below. A
     bubble left pointing at a node that no longer exists falls back to its
     static position, which is the middle of nowhere. */
  hideTip();
  card.querySelectorAll('.tabs [role="tab"]').forEach(b => {
    const on = (b.dataset.tab === 'floors') === parts.onFloors;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  /* The row of sub-tabs is rebuilt only when it is a DIFFERENT row — Floors to
     Sessions swaps floors for dates. Choosing another floor leaves the same
     buttons standing and only moves the selection, which is what lets the
     bubble behind them travel instead of being born on top of its destination.
     The signature is what tells those two cases apart. */
  const rest = card.querySelector('.tabrest');
  if(rest.dataset.sig === parts.sig){
    rest.querySelectorAll('.subtabs [role="tab"]').forEach(b => {
      const on = b.dataset.level === sheetTab.level || b.dataset.day === sheetTab.day;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    aimSubPill();
    rest.querySelector('.tabpanel').innerHTML = parts.panel;
  } else {
    rest.dataset.sig = parts.sig;
    rest.innerHTML = parts.subs + `<div class="tabpanel" role="tabpanel">${parts.panel}</div>`;
  }
  planFitLabels(card.querySelector('.plan svg'));
  seeChosen();
}

/* The way there, as the three cards carry it: one word and the sign for it,
   an outline in the route's orange, on the line of the name (Erick,
   2026-09-30). Directions is what every map calls it, so it needs no reading. */
const ROUTE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 21.2 12 12 21.2 2.8 12Z"/>' +
  '<path d="M9.6 15.2v-2.4a2 2 0 0 1 2-2h4.2"/><path d="m13.9 8.7 2 2.1-2 2.1"/></svg>';
/* The word goes in its own element: bare text beside the icon is an anonymous
   flex item, and Firefox centres it differently from Chrome — the icon sat
   off the text in the room card (Erick, 2026-09-30). */
const routeButton = route => `<button class="route-btn" data-route="${route}">${ROUTE_ICON}<span>Directions</span></button>`;
/* A card's head: its names on the left, the button beside them. */
const cardHead = (names, button) =>
  `<div class="card-head"><div class="card-title">${names}</div>${button || ''}</div>`;

/* What goes inside the room sheet. There is no empty state any more: the sheet
   is simply not up when no room is chosen. */
function roomCard(r){
  const kind = (KIND[r.kind] || {}).label || 'Room';
  const ss   = SESSIONS[r.id] || [];
  /* The name leads, because it is the one thing anyone came here to confirm,
     and the kind follows it as the category it belongs to.

     No area and no floor. The floor is already named on the pill above the
     sheet, and the area in square metres is a logistics fact — this card is for
     working out where you are, not for laying out a room. */
  /* The layer a room came from and how big it is: the same workbench the
     building card already carries, and the rooms were the gap in it. It is what
     lets a traced room be matched by eye against the organisation's own floor
     plan, which is how the MozFest room codes get pinned to the trace. */
  const wr = !WORKBENCH ? '' :
    `<dl><dt>Layer</dt><dd>${esc(r.id)}</dd>` +
    `<dt>Area</dt><dd>${(r.area || 0).toFixed(1)} m\u00B2</dd></dl>`;
  /* The same row as the building's, for the same reason: they are two names for
     one thing, not a name and a subtitle. The code goes first because it is
     what the programme says, and the name after because it is what the signage
     will say. */
  const mk = MOZROOM[r.id];
  const label = mk ? [mk.code, mk.name].filter(Boolean).join(' · ') : '';
  const key = label ? `<div class="key"><span>MozFest</span>${esc(label)}</div>` : '';
  return `<div class="roomcard">` +
    cardHead(`<h3>${esc(r.name)}</h3><div class="meta">${esc(kind)}</div>` + key, routeButton(`room:${esc(r.id)}`)) + wr +
    (ss.length
      ? `<div class="ses">` + ss.map(s =>
          `<div><strong>${esc(s.title)}</strong><span>${esc(s.day)} · ${esc(s.start)}–${esc(s.end)}</span></div>`
        ).join('') + `</div>`
      : `<p class="hint">Nothing programmed in this room.</p>`) +
    `</div>`;
}

/* Which rooms answer with a sheet and which with a bubble. It is decided by
   what the trace says a room IS, never by whether the programme happens to
   have put something in it — a session room with nothing on that day would
   fall to the wrong side of that test.

   One predicate, because the volunteer profile widens it rather than replaces
   it: for someone working the festival the crew rooms ARE destinations. */
const PASSING = new Set(['circulation', 'service', 'crew']);
const hasDetail = r => !PASSING.has(r.kind) ||
  (r.kind === 'crew' && atLeast('volunteer'));

const curFloor = () => {
  const fls = floorsOf(sheetTab.feat);
  return fls.find(x => x.level === sheetTab.level) || fls[0];
};

/* The sheet is permanent and only its contents change, so going from one room
   to the next swaps the text without moving anything. */
function openRoom(r){
  /* The ceiling of this sheet is the top of the tab panel, and at the middle
     detent that is below the fold. So standing the panel up is not something a
     caller remembers to ask for and the lock may refuse — it is part of
     opening a room, it lives here, and it is forced. */
  shiftDetent('large', true);
  /* And the card goes back to the top. This sheet's ceiling comes from the
     height of .tabpanel, which is INSIDE the card: with the card scrolled down,
     Safari shifts that ceiling up by the same amount and the room swallows the
     very tabs it is meant to leave in view. With the card at zero the offset is
     zero and the ceiling falls where the design says, in Safari and Chrome
     alike. Nothing is lost: what sits above the room is the building's name
     and its tabs, which is exactly what is at the very top. */
  card.scrollTop = 0;
  roomBody.innerHTML = roomCard(r);
  roomBody.scrollTop = 0;
  roomSheet.removeAttribute('inert');
  roomSheet.classList.add('is-open');
}
function closeRoom(){
  roomSheet.classList.remove('is-open');
  roomSheet.setAttribute('inert', '');
}

/* The bubble is placed by laying an invisible box over the room and letting CSS
   anchor to that. JS only says WHERE the room is; which side the bubble takes,
   and the flip when that side has no space, are the stylesheet's business. */
function showTip(path, r){
  const plan = path.closest('.plan');
  if(!plan) return;
  const p = path.getBoundingClientRect(), q = plan.getBoundingClientRect();
  let a = plan.querySelector('.tip-anchor');
  if(!a){ a = document.createElement('div'); a.className = 'tip-anchor'; plan.appendChild(a); }
  a.style.left = (p.left - q.left) + 'px'; a.style.top    = (p.top - q.top) + 'px';
  a.style.width = p.width + 'px';         a.style.height = p.height + 'px';
  roomTip.textContent = r.name;
  roomTip.dataset.on = 'true';
}
function hideTip(){ roomTip.dataset.on = 'false'; }

/* One way in, whether the room was clicked or reached by keyboard. Returns the
   room's path AFTER the redraw, because the one that was pressed is gone by
   then and the keyboard needs somewhere to put focus back. */
function pickRoom(id){
  const f = curFloor();
  const room = f && f.rooms.find(x => x.id === id);
  if(!room) return null;
  const same = sheetTab.room === id;
  sheetTab.room = same ? null : id;
  retab();
  const again = card.querySelector('[data-room="' + CSS.escape(id) + '"]');
  if(same){ closeRoom(); return again; }
  if(hasDetail(room)){
    /* The panel stands up inside openRoom(): it is that sheet's own
       requirement, not a favour asked of it from out here. */
    openRoom(room);
  } else {
    closeRoom();
    if(again) showTip(again, room);
  }
  return again;
}

/* The sub-tab row scrolls, and a redraw puts it back at the start — so the floor
   you just chose could sit off the end of a row that is showing the first one.
   Nothing is scrolled when it is already in view, which keeps this from
   twitching on every redraw. */
function seeChosen(){
  const row = card.querySelector('.subtabs');
  const on  = row && row.querySelector('[aria-selected="true"]');
  if(!on) return;
  const r = row.getBoundingClientRect(), b = on.getBoundingClientRect();
  if(b.left < r.left || b.right > r.right)
    on.scrollIntoView({inline:'center', block:'nearest', behavior:'instant'});
}

function info(u){
  openSheet();
  const bkey  = u.of || u.id;
  const site  = siteName(u.id, bkey);
  const moz   = mozKey(u.id, bkey);
  /* The hand-written name wins, then whatever the trace called this volume,
     then D.names for this exact id — never the parent's. Inheriting the
     parent's entry is what put "L' Harmonía" on Àster's nave and tower, which
     are not L'Harmonia and have no name yet. Last of all the tidied id, so
     nothing ever surfaces as b-salvia. */
  const raw   = site || u.name || D.names[u.id] || u.id;
  const label = looksLikeId(raw) ? tidy(raw) : raw;
  /* A different building means a fresh card: the floor you had open in the last
     one is not a floor in this one. */
  if(sheetTab.feat !== bkey){ closeRoom(); sheetTab = {feat:bkey, day:null, level:null, room:null,
    /* Open on whichever half has something in it. Floors wins a tie: those are
       traced, and a floor is the surer of the two. */
    tab: floorsOf(bkey).length ? 'floors' : 'sessions'}; }

  /* What a building is made of — that it is a part rather than a whole, how
     tall it is, what shape its roof takes — is how this was built, not what
     anyone came to find out. It stays, behind ?dev=1, because correcting a
     guessed height still needs to be able to see it. */
  const workings = !WORKBENCH ? '' :
    `<dl>
       <dt>Height</dt><dd>${u.h} m${
         (D.derived||[]).includes(u.id) ? '<span class="est" style="color:var(--ev);border-color:var(--ev)">from photo</span>'
         : (u.est?'<span class="est">estimate</span>':'')}</dd>
       <dt>Roof</dt><dd>${u.roof||'—'}</dd>
       <dt>Layer</dt><dd>${u.id}</dd>
     </dl>`+
    ((D.derived||[]).includes(u.id)
      ? `<div class="note">Derived by calibrating a photo against this footprint. Good to about half a metre.</div>`
      : u.est?`<div class="note">This height is my guess, not a measurement. Correct it and the volume updates.</div>`:'');

  /* Everything the festival brings says so. The venue was surveyed; this was
     decided in a meeting and can be decided again the week before, and a food
     truck presented as firmly as a building is a promise nobody made. */
  const kit = u.kind === 'event' ? u.ev : null;
  const parts = sheetParts(bkey);
  card.innerHTML = cardHead(
    `<h2>${esc(label)}</h2>`+
    (kit ? `<div class="meta">${esc(((D.kinds||{})[kit.kind]||{}).label || 'Event')}</div>` : '')+
    /* Which festival space this belongs to. For a tent it is the only thing
       that places it: the C spaces are not traced — the document calls the
       whole outdoors "Space C outside" — and the dome is only known to be C2
       because it is labelled as such. */
    (!moz && MOZROOM[u.id]
      ? `<div class="key"><span>MozFest</span>${esc(
          [MOZROOM[u.id].code, MOZROOM[u.id].name].filter(Boolean).join(' · '))}</div>`
      : '')+
    (moz ? `<div class="key"><span>MozFest key</span>${esc(moz)}</div>` : '')+
    (kit && outsideLine(kit.poly) ? `<div class="key"><span>Outside</span>${esc(outsideLine(kit.poly))}</div>` : ''),
    /* A way there, when there is one: a building with a public door, or a
       piece of the festival's kit standing in the open. */
    kit && kit.poly
      ? routeButton(`point:${kit.poly.reduce((a,p)=>a+p[0],0)/kit.poly.length},` +
        `${kit.poly.reduce((a,p)=>a+p[1],0)/kit.poly.length},${esc(label)}`)
      : (!kit && routeDoorsOf(bkey).length
          /* With a room chosen on the plan it goes to that room — which floor
             is half the answer; routes.js decides when it is pressed. */
          ? routeButton(`building:${esc(bkey)}`) : ''))+
    (parts ? parts.tabs + `<div class="tabrest" data-sig="${parts.sig}">` +
       parts.subs + `<div class="tabpanel" role="tabpanel">${parts.panel}</div></div>` : '')+
    workings;

  /* Text has no measurable width until it is in the document, so the labels that
     do not fit their rooms are dropped here rather than in plan2d. */
  planFitLabels(card.querySelector('.plan svg'));
  seeChosen();

  /* One listener per redraw, on the card, rather than one per control: the card
     is rewritten whole on every change, so anything bound to a button inside it
     would have to be bound again anyway. */
  card.onclick = e => {
    if(planDragged){ planDragged = false; return; }
    const t = e.target.closest('[data-tab],[data-level],[data-day]');
    if(t){
      if(t.dataset.tab)   sheetTab.tab = t.dataset.tab;
      /* Another floor is another set of rooms, so whatever room was open is
         not on this plan any more. */
      if(t.dataset.level){ sheetTab.level = t.dataset.level; sheetTab.room = null; closeRoom(); }
      if(t.dataset.day)    sheetTab.day = t.dataset.day;
      retab(u);
      /* Give the plan the room the sheet has: a floor is worth seeing whole. */
      if(t.dataset.level) shiftDetent('large', true);
      return;
    }
    /* A post's marker: its name only showed on mouse hover, through the
       <title>, and a phone has no mouse. Tapping it opens the bubble over the
       marker, saying the same as it would on the venue (Erick, 2026-09-14). */
    const pc = e.target.closest('.plan-crew');
    if(pc){
      const p = STATIONS.find(q => q.id === pc.dataset.station);
      if(!p) return;
      const b = pc.getBoundingClientRect();
      showTipAt(b.left + b.width / 2, b.top, {id:p.id, kind:'station', name:stationName(p),
        type:stationLine(p), vc:!!p.vc, where:stationWhere(whereIs(p))});
      return;
    }
    const r = e.target.closest('[data-room]');
    if(!r) return;
    /* While placing, the exact point on the plan matters more than the room:
       planAt returns it in model metres, which is all that gets saved. The room
       is noted all the same, because it is what the post hangs from. */
    if(placing){
      const svg = card.querySelector('.plan svg');
      const q = svg && planAt(svg, e.clientX, e.clientY);
      if(q){ placeAt(q.x, q.z, r.dataset.room); return; }
    }
    pickRoom(r.dataset.room);
  };
  /* A room in the plan is a button, so it has to answer the keys a button
     answers. Space is prevented because its default is to scroll the sheet. */
  card.onkeydown = e => {
    if(e.key !== 'Enter' && e.key !== ' ') return;
    const r = e.target.closest('[data-room]');
    if(!r) return;
    e.preventDefault();
    const again = pickRoom(r.dataset.room);
    if(again) again.focus();
  };
}


