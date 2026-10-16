/* ---------- camera: hand-rolled orbit (no addon needed on r128) ---------- */
const target = new THREE.Vector3(0,0,0);
let yaw=-0.9, pitch=0.62, dist=SPAN*1.25;   /* replaced by home() once fitDist exists */
/* 89 degrees, not 90: at a right angle lookAt has no usable up vector and the
   view flips. The last degree is made up by the swap to the parallel camera,
   which has no such problem because its up is set explicitly. */
const PITCH_FLAT = 1.5533;
let view = '3d', wantView = '3d', pitch3d = 0.62;
function applyCam(){
  /* The flat limit is only lifted while heading into the plan; free orbit keeps
     its old ceiling so nobody lands on the degenerate angle by dragging. */
  pitch = Math.max(0.08, Math.min(wantView === '2d' ? PITCH_FLAT : 1.45, pitch));
  dist  = Math.max(DIST_MIN, Math.min(DIST_MAX, dist));
  /* Fog measured from where the camera actually is, so the site stays crisp at
     every zoom level and only the empty ground beyond it dissolves. */
  scene.fog.near = dist + FOG_CLEAR;
  scene.fog.far  = dist + FOG_CLEAR + FOG_DEPTH;
  /* The disc rides under the view. Panning cannot walk off its edge, and the
     rim keeps the same distance from the camera whatever the target does. */
  ground.position.x = target.x; ground.position.z = target.z;

  if(view === '2d'){
    /* Straight overhead, with screen-up following the heading so dragging still
       turns the plan instead of doing nothing. The frustum is sized to what the
       perspective camera saw at the target, so the swap does not jump in scale
       and the same wheel and pinch keep working as zoom. */
    camera.position.set(target.x, target.y + dist, target.z);
    camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const a = innerWidth/innerHeight, half = dist * Math.tan(persp.fov * Math.PI/360);
    camera.left = -half*a; camera.right = half*a; camera.top = half; camera.bottom = -half;
    camera.updateProjectionMatrix();
  } else {
    camera.up.set(0,1,0);
    camera.position.set(
      target.x + dist*Math.cos(pitch)*Math.sin(yaw),
      target.y + dist*Math.sin(pitch),
      target.z + dist*Math.cos(pitch)*Math.cos(yaw));
  }
  camera.lookAt(target);
  invalidate();
  /* Al FINAL, no al principio: la burbuja se proyecta con la cámara, y arriba
     la cámara todavía es la de antes de este mismo movimiento. Puesta arriba
     iba siempre un paso por detrás, que con el vuelo del buscador significa
     quedarse donde el objeto estaba al pulsar. Sólo hace algo si hay una
     burbuja, y eso sólo pasa durante un vuelo: los gestos de quien mira la
     cierran. */
  placeWorldTip();
  updateReadout();
  markHome();
}


/* ---------- camera readout ----------
   A working instrument, not decoration: it reports the live camera in exactly
   the shape HOME_VIEW takes, so a view worth keeping can be read off the screen
   and pasted straight back into the source. Elements are looked up on first use
   because applyCam runs before the chrome is wired. */
/* Declared HERE and not down beside `selected`, where it belongs by meaning.
   applyCam() runs during start-up, several hundred lines above that, and it
   calls updateReadout — which reads this. A `let` sitting next to `selected`
   would still be in its dead zone at that moment, and the throw would take the
   rest of the file with it while the page went on looking half alive. */
let selKey = null;
const RO = {};
function updateReadout(){
  if(RO.dead) return;
  if(!RO.box){
    RO.box = document.getElementById('readout');
    if(!RO.box){ RO.dead = true; return; }
    ['Yaw','Pitch','Dist','Ctr','Base','Code','View'].forEach(k=>RO[k] = document.getElementById('ro'+k));
  }
  if(RO.box.hidden) return;
  const bearing = ((yaw*180/Math.PI) % 360 + 360) % 360;
  RO.Yaw.textContent   = bearing.toFixed(1) + '\u00B0';
  RO.Pitch.textContent = (pitch*180/Math.PI).toFixed(1) + '\u00B0';
  RO.Dist.textContent  = Math.round(dist) + ' m';
  RO.Ctr.textContent   = target.x.toFixed(1) + ', ' + target.z.toFixed(1);
  /* De qué tamaño de letra parte todo. La escala entera cuelga de `1rem` en la
     raíz, y ese rem no es 16px fijos: es el ajuste del propio lector. Firefox
     de Android obedece además el tamaño de letra del SISTEMA y Chrome no, así
     que el mismo teléfono puede dar dos números distintos. Con esto se lee en
     vez de discutirlo: se abre con ?dev=1 en los dos y se comparan. */
  if(RO.Base){
    const base = parseFloat(getComputedStyle(document.documentElement).fontSize);
    /* El multiplicador se lee de la propiedad, no de una variable de JS: el
       regulador la escribe en la raíz y esa es la fuente de verdad. */
    const mult = parseFloat(getComputedStyle(document.documentElement)
                   .getPropertyValue('--ui-scale')) || 1;
    RO.Base.textContent = base.toFixed(1) + ' px × ' + mult.toFixed(2);
  }
  /* Report the heading folded into one turn, so a value copied out of here can
     never come back describing the long way round. */
  const canon = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  RO.Code.textContent  = '{yaw:' + canon.toFixed(3) + ', pitch:' + pitch.toFixed(3) +
    ', dist:' + Math.round(dist) + ', tx:' + target.x.toFixed(1) +
    ', tz:' + target.z.toFixed(1) + '}';
  /* And the same view in the shape vistas.json takes, named for whatever is
     selected: compose a view for a building, copy this line, paste it over what
     sembrar-vistas.py proposed. No position — that is the whole point of the
     file. */
  if(RO.View) RO.View.textContent = selKey
    ? '"' + selKey + '": {"yaw": ' + canon.toFixed(3) + ', "pitch": ' + pitch.toFixed(3) +
      ', "dist": ' + Math.round(dist) + '},'
    : 'select a building';
}
applyCam();
/* A single distance cannot frame the site on both a laptop and a phone held
   upright: the vertical field of view is fixed, so a narrow viewport sees a
   much narrower slice of the world and the recinte spills off both sides.
   Derive the distance from the aspect ratio instead of guessing one. */
function fitDist(span){
  const half = (span/2) / Math.tan(persp.fov * Math.PI/360);
  return Math.min(DIST_MAX, half / Math.min(1, persp.aspect) * 1.04);
}
/* The view the map settles into. The opening flight lands here, Reset returns
   here, and a first load frames here. One place to edit, so the three can never
   drift apart — and the readout in the corner reports in exactly this shape,
   so a view you like can be pasted straight back in. */
const HOME_VIEW = {yaw:0.956, pitch:0.307, dist:188, tx:9.6, tz:-21.9};
/* The distance above was chosen on a wide window. A narrow one sees a narrower
   slice from the same spot, so it is pulled back in the same proportion fitDist
   uses: the composition survives a phone being turned upright. */
function homeDist(){
  return Math.min(DIST_MAX, HOME_VIEW.dist / Math.min(1, persp.aspect));
}

/* markHome lives down here, below HOME_VIEW, and not up beside applyCam where
   it is called from. applyCam runs during start-up — before this line — so a
   markHome sitting up there read HOME_VIEW, homeDist and its own two `let`s
   while every one of them was still in the temporal dead zone. The throw took
   the rest of the file with it: HOME_VIEW never got a value, `home` never got
   declared, and all that survived were the hoisted function declarations, so
   the page looked half alive rather than broken. Function declarations hoist;
   const and let do not. In a file this long that is not a detail.

/* Reset stands down while the view is already where reset would put it: a
   control that does nothing is worse than no control, because you press it and
   learn nothing from the fact that nothing happened.

   It is disabled rather than removed, so the keyboard stops only on controls
   that work and a screen reader says the button is unavailable instead of the
   button quietly ceasing to exist. The CSS collapses its width from there.

   Yaw is compared the short way round. It has no bounds — a few laps of
   dragging leave it thousands of radians from where it started — so a plain
   subtraction would report you nowhere near home while you are looking at
   exactly the home view. And 2D counts as away: reset returns to 3D, so there
   is something for it to do. */
let wasHome = null, resetEl = null;
/* The guard is a property ON the function, and that is the whole point: a
   function declaration is hoisted, so reading markHome.armed is safe at any
   moment of start-up, whereas any `let` used for the same job would itself be
   in the dead zone this is here to survive. Armed on the line below, once
   HOME_VIEW and the two variables above it actually hold values. */
function markHome(){
  if(!markHome.armed) return;
  const turn = a => Math.abs(((a + Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI);
  const now = view === '3d' && wantView === '3d'
    && turn(yaw - HOME_VIEW.yaw)         < 0.01
    && Math.abs(pitch - HOME_VIEW.pitch) < 0.01
    && Math.abs(dist - homeDist())       < 0.5
    && Math.abs(target.x - HOME_VIEW.tx) < 0.5
    && Math.abs(target.z - HOME_VIEW.tz) < 0.5;
  if(now === wasHome) return;
  wasHome = now;
  /* Looked up on first use: applyCam runs during start-up, and a const declared
     further down this file is not there yet when it does. */
  resetEl = resetEl || document.getElementById('resetBtn');
  if(resetEl) resetEl.disabled = now;
}
markHome.armed = true;

const home = ()=>{
  yaw = HOME_VIEW.yaw; pitch = HOME_VIEW.pitch; dist = homeDist();
  target.set(HOME_VIEW.tx, 0, HOME_VIEW.tz); applyCam();
};

/* Touch needs more than the mouse path: one finger orbits, two pinch to zoom
   and drag to pan. Without this the viewer has no zoom at all on a phone. */
const active = new Map();
let drag=null, moved=false, pinch=null;
/* Con qué se tocó por última vez. El clic que sigue no lo sabe, y el dedo
   merece más tolerancia que el ratón en dos sitios: cuánto puede temblar un
   toque antes de contar como arrastre, y a cuántos píxeles de un puesto
   sigue siendo «ese puesto». */
let ultimoPuntero = 'mouse';
/* Colocando, arrastrar un puesto lo mueve en vez de mover el recinto. La
   figura sigue al dedo y el punto se guarda al soltar, por el gancho alMover,
   que pone el bloque de colocar —es quien sabe guardar y repintar la lista. */
let mover = null;
var alMover = null;
const el = renderer.domElement;
const puestoBajo = e => {
  ptr.x = (e.clientX/innerWidth)*2-1; ptr.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr, camera);
  const h = ray.intersectObjects(picks, false)[0];
  return h && h.object.userData.kind === 'puesto' ? h.object.parent : null;
};
const sueloBajo = e => {
  ptr.x = (e.clientX/innerWidth)*2-1; ptr.y = -(e.clientY/innerHeight)*2+1;
  ray.setFromCamera(ptr, camera);
  const h = ray.intersectObject(ground, false)[0];
  return h ? {x: h.point.x + CX, z: h.point.z + CZ} : null;
};
const twoFinger = () => {
  const [a,b] = [...active.values()];
  return { d: Math.hypot(a.x-b.x, a.y-b.y),
           cx: (a.x+b.x)/2, cy: (a.y+b.y)/2 };
};
el.addEventListener('pointerdown', e=>{
  camAnim = null;          /* touching the map always beats a move in progress */
  ultimoPuntero = e.pointerType || 'mouse';
  active.set(e.pointerId, {x:e.clientX, y:e.clientY});
  /* Some pointers are already gone by the time this runs — a stylus lifted mid
     event, a synthetic event. Losing capture is survivable; losing the handler
     below it is not, so it must not throw. */
  try{ el.setPointerCapture(e.pointerId); }catch(_){}
  moved = false;
  mover = null;
  if(active.size === 2){
    const t = twoFinger();
    pinch = {d:t.d, cx:t.cx, cy:t.cy, dist, yaw, pitch};
    drag = null;
  } else if(active.size === 1){
    const g = colocando && view === '2d' && e.button === 0 ? puestoBajo(e) : null;
    if(g){ mover = {g, id: g.userData.id}; drag = null; hideWorldTip(); }
    else drag = {x:e.clientX, y:e.clientY, b:e.button, yaw, pitch, t:target.clone()};
  }
});
el.addEventListener('pointermove', e=>{
  if(!active.has(e.pointerId)) return;
  active.set(e.pointerId, {x:e.clientX, y:e.clientY});

  if(active.size === 2 && pinch){
    const t = twoFinger();
    moved = true;
    hideWorldTip();
    /* Separar y juntar sigue siendo el zoom. Lo que cambia es el centro: antes
       arrastraba el recinto y ahora lo gira, porque un dedo ya arrastra y
       tener las dos cosas repartidas es lo que hace que no haya que pensar. */
    dist = pinch.dist * (pinch.d / Math.max(t.d, 1));
    const dx = t.cx - pinch.cx, dy = t.cy - pinch.cy;
    yaw   = pinch.yaw   - dx*0.006;
    pitch = pinch.pitch + dy*0.006;
    applyCam();
    return;
  }
  if(mover){
    const q = sueloBajo(e);
    if(q){ mover.g.position.set(q.x - CX, 0, q.z - CZ); mover.a = q; moved = true; invalidate(); }
    return;
  }
  if(!drag) return;
  hideWorldTip();
  const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
  /* Cuatro píxeles valen para el ratón. Un dedo tiembla más al posarse, y
     con 4 px medio de los toques en el móvil contaban como arrastre y el
     clic se perdía (Erick, 2026-09-14). */
  if(Math.hypot(dx,dy) > (e.pointerType === 'touch' ? 12 : 4)) moved=true;
  /* El botón derecho gira; todo lo demás arrastra. «Todo lo demás» incluye el
     dedo, que llega con button 0, así que un dedo arrastra y dos giran sin
     escribir el caso táctil por separado. */
  if(drag.b===2){ yaw=drag.yaw-dx*0.006; pitch=drag.pitch+dy*0.006; }
  else{
    const s=dist*0.0016;
    target.copy(drag.t)
      .add(new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)).multiplyScalar(-dx*s))
      .add(new THREE.Vector3(Math.sin(yaw),0, Math.cos(yaw)).multiplyScalar(-dy*s));
  }
  applyCam();
});
function endPointer(e){
  active.delete(e.pointerId);
  if(mover){
    if(mover.a && alMover) alMover(mover.id, mover.a.x, mover.a.z, null);
    mover = null;
  }
  if(active.size < 2) pinch = null;
  if(active.size === 0) drag = null;
  else if(active.size === 1){
    const [p] = [...active.values()];
    drag = {x:p.x, y:p.y, b:0, yaw, pitch, t:target.clone()};
  }
}
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
renderer.domElement.addEventListener('contextmenu', e=>e.preventDefault());
renderer.domElement.addEventListener('wheel', e=>{
  camAnim = null; hideWorldTip();
  e.preventDefault(); dist *= e.deltaY>0 ? 1.1 : 1/1.1; applyCam();
}, {passive:false});

