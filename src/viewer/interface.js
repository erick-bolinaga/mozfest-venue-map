/* ---------- ui ---------- */
/* ---------- chrome ----------
   Every control on screen is one of two things: a .seg button that shows a
   choice, or an .ico button that does something. Keeping to two kinds is what
   makes the dock, the theme switch and the menu feel like one instrument. */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Which theme is up, so the single button knows what its press should do. */
let lightOn = false;
function applyTheme(light){
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  theme = light ? THEME.light : THEME.dark;
  scene.background = new THREE.Color(theme.bg);
  scene.fog.color  = new THREE.Color(theme.bg);
  ground.material.color.set(theme.ground);
  matBlk.color.set(theme.blk); matOpen.color.set(theme.open);
  lineBlk.color.set(theme.blkLine); lineOpen.color.set(theme.openLine);
  labMats.forEach(m=>{ m.map = light ? m.userData.light : m.userData.dark; m.needsUpdate = true; });
  THEMED.forEach(([m,k])=>m.color.set(theme[k]));
  key.color.set(theme.key); fill.color.set(theme.fill); hemi.color.set(theme.hemi);
  lightOn = light;
  /* A row in the menu with a tick, like the other switches there: it reports
     what is on rather than what pressing it would do. The lone icon button it
     used to be had to do the opposite, and needed explaining. */
  $('#themeBtn').setAttribute('aria-checked', String(light));
  /* Changing the theme touches the colour of every material and the
     background, and does not move the camera: the redraw has to be asked for. */
  invalidate();
}
/* Which theme to open in was decided in the <head>, before anything painted:
   the saved choice if there is one, else the system's. Here that decision
   reaches the 3D, which the CSS cannot. Only the press writes — like the text
   size — and while nothing is saved the viewer keeps following the system, so
   a phone that goes dark at dusk takes the map with it (Erick, 2026-09-14). */
const THEME_KEY = 'mozfest-theme';
let chosenTheme = null;
try{ chosenTheme = localStorage.getItem(THEME_KEY); }catch(_){}
applyTheme(document.documentElement.dataset.theme === 'light');
matchMedia('(prefers-color-scheme: light)').addEventListener('change', e=>{
  if(!chosenTheme) applyTheme(e.matches);
});
$('#themeBtn').onclick = ()=>{
  applyTheme(!lightOn);
  chosenTheme = lightOn ? 'light' : 'dark';
  try{ localStorage.setItem(THEME_KEY, chosenTheme); }catch(_){}
};

/* Camera moves are eased rather than cut, so jumping to a room from search
   reads as travel and you keep your bearings. */
let camAnim = null;
/* Yaw has no bounds: a few laps of dragging leave it far from zero, and a
   heading read off the screen can come back wrapped by a whole turn. Moving to
   an absolute heading must therefore take the short way round instead of
   unwinding every turn in between — 305 degrees the wrong way is a spin, the
   same heading 55 degrees the right way is a settle. */
function shortWay(to){
  return yaw + (((to - yaw + Math.PI) % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI) - Math.PI;
}
function flyTo(to, ms, done){
  camAnim = {ms: ms||520, t0: performance.now(), done,
    from:{yaw, pitch, dist, tx:target.x, ty:target.y, tz:target.z, light:lightMix},
    to:{yaw: shortWay(to.yaw ?? yaw), pitch: to.pitch ?? pitch, dist: to.dist ?? dist,
        tx: to.tx ?? target.x, ty: to.ty ?? target.y, tz: to.tz ?? target.z,
        light: to.light ?? lightMix}};
}
function stepCam(){
  if(!camAnim) return;
  const k = Math.min(1, (performance.now() - camAnim.t0) / camAnim.ms);
  const e = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;      /* easeInOutCubic */
  const a = camAnim.from, b = camAnim.to;
  yaw   = a.yaw   + (b.yaw   - a.yaw)*e;
  pitch = a.pitch + (b.pitch - a.pitch)*e;
  dist  = a.dist  + (b.dist  - a.dist)*e;
  target.set(a.tx + (b.tx-a.tx)*e, a.ty + (b.ty-a.ty)*e, a.tz + (b.tz-a.tz)*e);
  lightMix = a.light + (b.light - a.light)*e;
  applyLighting();
  applyCam();
  /* Clear before calling back: the callback may start the next move, and it
     must not be wiped by the line that ends this one. A superseded animation
     never gets here, so its callback simply never fires. */
  if(k >= 1){ const done = camAnim.done; camAnim = null; if(done) done(); }
}

/* 2D is the same scene seen from straight above, not a second drawing, so the
   plan can never fall out of step with the model. */
function markView(v){ $$('#viewSeg button').forEach(b=>b.setAttribute('aria-pressed', b.dataset.view===v)); }
function setView(v){
  if(v === wantView) return;
  wantView = v; markView(v);
  if(v === '2d'){
    pitch3d = pitch;                       /* so leaving the plan returns the angle you had */
    flyTo({pitch: PITCH_FLAT, light: 1}, 560, ()=>{
      if(wantView !== '2d') return;        /* someone changed their mind mid-flight */
      view = '2d'; camera = ortho; applyCam();
    });
  } else {
    if(view === '2d'){ view = '3d'; camera = persp; pitch = PITCH_FLAT; }
    flyTo({pitch: pitch3d, light: 0}, 560);
  }
}
$$('#viewSeg button').forEach(b=> b.onclick = ()=> setView(b.dataset.view));
$('#resetBtn').onclick = ()=>{
  if(view === '2d' || wantView === '2d'){ view = wantView = '3d'; camera = persp; markView('3d'); }
  flyTo({yaw:HOME_VIEW.yaw, pitch:HOME_VIEW.pitch, dist:homeDist(),
         tx:HOME_VIEW.tx, ty:0, tz:HOME_VIEW.tz, light:0});
};

/* The zones toggle lives in the menu: a setting you change once, not a
   control you reach for while walking. It is the only layer toggle left.
   The surrounding buildings never had one: drawn the way they are, they sit
   back far enough not to compete with the site, so the choice was one nobody
   needed to make. The street names lost theirs (2026-09-14): in weeks of use
   nobody turned them off, so the switch was a row that only ever said "yes".

   And the zones are a volunteer's concern. The letters are how the
   organisation splits its crew, and a visitor has nothing to read into them,
   so from the ground rung the row is gone — removed from the DOM like the
   fullscreen row where the API is missing, not hidden — and a visitor's menu
   is full screen and accessibility, nothing else (Erick, 2026-09-14). The
   readout (?dev=1) and placing (rung 3) are gated the same way where they
   live. */
const zoneBtn = $('#zoneBtn');
if(!atLeast('volunteer')) zoneBtn.remove();
else {
  zoneBtn.setAttribute('aria-pressed', zoneGroup.visible);
  /* Changing .visible draws nothing on its own since the loop only paints a
     dirty scene: the zones switched on and did not show until the map was
     dragged. One redraw per press, and at rest it is still zero. */
  zoneBtn.onclick = ()=>{
    const on = !zoneGroup.visible;
    zoneGroup.visible = on; zoneBtn.setAttribute('aria-pressed', on); invalidate();
  };
}

/* Full screen. Where it is most welcome is the phone, which is where the
   browser bar eats a strip of the site.

   The row is REMOVED from the DOM where the API does not exist, not hidden:
   iPhone Safari has no requestFullscreen —the iPad does— and a row that does
   nothing is worse than no row. Besides, `[hidden]` would not be enough,
   because `.pop .row` is display:flex and beats it.

   And the state is read from the document, not from the last press: you can
   leave with Escape or the system gesture without going through this button,
   and then the tick has to clear itself. */
const fsBtn = $('#fsBtn');
const docRoot = document.documentElement;
const askFullscreen = docRoot.requestFullscreen || docRoot.webkitRequestFullscreen;
if(!askFullscreen){
  fsBtn.remove();
} else {
  const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
  const isFs  = ()=> !!(document.fullscreenElement || document.webkitFullscreenElement);
  const syncFs = ()=>{
    fsBtn.setAttribute('aria-pressed', String(isFs()));
    fsBtn.querySelector('.label').textContent = isFs() ? 'Exit full screen' : 'Full screen';
  };
  fsBtn.onclick = ()=>{
    /* It can fail —a permissions policy, a gesture the browser does not accept
       as valid— and then the only right thing is to leave the tick as it was. */
    try {
      const p = isFs() ? exitFs.call(document) : askFullscreen.call(docRoot);
      if(p && p.catch) p.catch(()=>{});
    } catch(e){}
  };
  ['fullscreenchange','webkitfullscreenchange'].forEach(e=>
    document.addEventListener(e, syncFs));
  syncFs();
}

/* One popover open at a time; click away or press Escape to close. */
function openPop(id, on){
  ['menu','search'].forEach(p=>{
    const o = (p===id) && on;
    $('#'+p).dataset.open = o;
    $('#'+p+'Btn').setAttribute('aria-expanded', o);
  });
  if(id==='search' && on) setTimeout(()=>$('#q').focus(), 30);
}
$('#menuBtn').onclick   = ()=> openPop('menu',   $('#menu').dataset.open   !== 'true');
$('#searchBtn').onclick = ()=> openPop('search', $('#search').dataset.open !== 'true');
/* Escape peels one layer at a time: whatever popover is open, then the room,
   then the building. Three presses to get from a room back to the site, and
   never a press that undoes more than you meant. */
addEventListener('keydown', e=>{
  if(e.key !== 'Escape') return;
  if($('#menu').dataset.open === 'true' || $('#search').dataset.open === 'true'){
    openPop(null, false);
  } else if(roomSheet.classList.contains('is-open')){
    sheetTab.room = null; closeRoom(); retab();
  } else if(sheet.open){ select(null); }
});
addEventListener('pointerdown', e=>{
  if(!e.target.closest('#menu,#search,#menuBtn,#searchBtn')) openPop(null, false);
  /* The bubble anchored to a mark on the plan has no mesh to follow: it closes
     on a touch anywhere else. The site's bubble follows its own rule. */
  if(!tipMesh && !e.target.closest('.plan-crew')) hideWorldTip();
}, true);

