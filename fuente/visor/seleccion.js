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
  /* El raycaster de r128 no mira `visible`: las zonas apagadas seguirían
     recibiendo el clic. Lo que no se ve no se toca, y se pregunta subiendo
     por los padres porque es el grupo entero el que se apaga. */
  const seVe = o => { for(; o; o = o.parent) if(!o.visible) return false; return true; };
  const hit = ray.intersectObjects(picks, false).find(h => seVe(h.object));
  /* Colocando, el suelo LIBRE pone un puesto y un edificio se abre igual que
     siempre. Y sólo en 2D: Erick lo fijó así porque en 3D un clic sobre un
     tejado es ambiguo —¿el suelo de debajo, la cubierta, la planta de
     arriba?— y en planta no hay nada que decidir.

     El edificio se pregunta ANTES que el suelo. Se preguntaba sólo al suelo,
     y el rayo atraviesa el edificio y llega a él: pulsar Rosa ponía un puesto
     en su huella, el sheet no abría nunca y las plantas —donde ya se podía
     colocar— eran inalcanzables. Abrir el edificio es el camino a su plano.

     Y una zona es suelo: colocando, su tinte no roba el clic al puesto. */
  const zona = hit && hit.object.userData.kind === 'zone';
  if(colocando && view === '2d' && (!hit || zona)){
    const suelo = ray.intersectObject(ground, false)[0];
    if(suelo){ colocarEn(suelo.point.x + CX, suelo.point.z + CZ, null); return; }
  }
  /* Con el dedo, un toque que no da con nada —o sólo con el tinte de una
     zona— elige el puesto que quede a menos de 24 px EN PANTALLA. A vista de
     recinto un puesto son dos píxeles y ninguna geometría lo arregla; la
     tolerancia en píxeles no depende del zoom. Sólo el dedo: el ratón apunta
     donde apunta (Erick, 2026-09-14, desde el móvil). */
  if((!hit || zona) && ultimoPuntero === 'touch' && !colocando){
    const cerca = puestoCerca(e.clientX, e.clientY, 24);
    if(cerca){ select(cerca); return; }
  }
  select(hit ? hit.object : null);
});
function puestoCerca(cx, cy, px){
  let mejor = null, d0 = px;
  crewGroup.children.forEach(g => {
    const v = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
    v.y += 0.9; v.project(camera);
    if(v.z > 1) return;
    const d = Math.hypot((v.x + 1) / 2 * innerWidth - cx, (1 - v.y) / 2 * innerHeight - cy);
    if(d < d0){ d0 = d; mejor = g.userData.fam && g.userData.fam[0]; }
  });
  return mejor;
}

/* ---------- la burbuja del recinto ---------- */
/* Treinta de las ochenta cosas que se pueden pulsar no tienen dentro más que
   un nombre: la guardería está trazada en veinte volúmenes y el CITC en seis,
   y cada uno de ellos abría un panel entero para decir una línea. Eso no es
   una ficha, es una etiqueta, y una etiqueta se enseña donde está la cosa.

   El predicado no llama a sheetParts aunque sea justo lo que decide si hay
   panel: esa función mueve sheetTab.level y sheetTab.day al pasar, y usarla
   para preguntar cambiaría la planta abierta como efecto secundario. Se
   pregunta a las dos cosas puras de las que ella misma depende. */
const worldTip = document.querySelector('.worldtip');
/* Un solo criterio, y se dice en una frase: el panel se abre cuando hay algo
   que explorar dentro —plantas o sesiones— y todo lo demás es un rótulo.

   La primera versión traía además una cláusula «salvo lo del montaje», y era
   indefendible: un food truck enseñaba 39 px de contenido en una tarjeta de
   745, exactamente igual que el CITC, y no hay nada dentro de uno que no esté
   dentro del otro. Erick lo vio preguntando por la tienda de merch. */
const esRotulo = u => {
  if(!u || !u.id) return false;
  const k = u.of || u.id;
  return !floorsOf(k).length && !sessionsIn(k).length;
};
/* El centro del objeto, proyectado a la pantalla. Detrás de la cámara la
   proyección se da la vuelta y devuelve un punto delante, así que ese caso se
   descarta en vez de dibujar la burbuja en el sitio equivocado. */
/* Con var y no con const, a propósito: applyCam() corre en el arranque,
   cientos de líneas antes de aquí, y una const seguiría en su zona muerta —
   leerla lanzaría. Con var vale undefined, y la guarda de placeWorldTip sale
   antes de tocar nada. */
var tipMesh = null;
/* Colocar y enseñar son dos cosas distintas porque el buscador vuela la cámara
   DESPUÉS de elegir: la burbuja se pintaba donde estaba el objeto al pulsar y
   se quedaba ahí mientras el recinto se movía debajo. Los gestos de quien mira
   la cierran, así que esto sólo llega a correr durante un vuelo. */
/* Centrada sobre la cosa y encima de ella, pero entera en pantalla: una
   burbuja cortada por el borde era un nombre a medias. Pasaba con todo lo que
   quedara cerca del borde, y con la de un puesto, que es más larga, se notaba
   más (2026-10-16). El margen negativo de .worldtip la sube 8 px más. */
function ponerTip(x, y){
  const m = 8, w = worldTip.offsetWidth / 2, h = worldTip.offsetHeight;
  worldTip.style.left = Math.min(Math.max(x, w + m), innerWidth - w - m) + 'px';
  worldTip.style.top = Math.max(y, h + 2 * m) + 'px';
}
function placeWorldTip(){
  if(!tipMesh) return;
  const caja = new THREE.Box3().setFromObject(tipMesh);
  if(caja.isEmpty()) return hideWorldTip();
  const p = caja.getCenter(new THREE.Vector3());
  p.y = caja.max.y;                       // por la parte de arriba, no por el centro
  const v = p.clone().project(camera);
  if(v.z > 1) return hideWorldTip();
  ponerTip((v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight);
}
function tipContenido(u){
  const k = u.of || u.id;
  const raw = siteName(u.id, k) || u.name || D.names[u.id] || u.id;
  /* Lo mismo que enseñaba el panel, que eran tres líneas: cómo se llama, qué
     es, y cómo lo llama MozFest. Lo único que cambia es el tamaño del sitio
     donde se lee. */
  const tipo = u.kind === 'event' && u.ev
    ? ((D.kinds || {})[u.ev.kind] || {}).label
    : u.kind === 'puesto' ? u.tipo
    : u.kind === 'zone' ? 'Volunteer zone' : null;
  const mk = MOZROOM[u.id];
  const clave = mozKey(u.id, k) ||
    (mk ? [mk.code, mk.nombre].filter(Boolean).join(' · ') : null);
  worldTip.innerHTML =
    `<strong>${esc(looksLikeId(raw) ? tidy(u.id) : raw)}</strong>` +
    (tipo  ? `<span>${esc(tipo)}</span>`  : '') +
    (clave ? `<span>${esc(clave)}</span>` : '') +
    (u.donde ? `<span>${esc(u.donde)}</span>` : '');
}
function showWorldTip(mesh, u){
  tipContenido(u);
  tipMesh = mesh;
  placeWorldTip();
  if(tipMesh) worldTip.dataset.on = 'true';
}
/* La misma burbuja, anclada a un punto de la pantalla y no a una malla: para
   la marca de un puesto en el plano de una sala, que vive en el DOM. Sin
   tipMesh, placeWorldTip la deja donde está; la cierra el siguiente toque en
   cualquier otro sitio, en interfaz.js. */
function showTipAt(x, y, u){
  tipContenido(u);
  tipMesh = null;
  ponerTip(x, y);
  worldTip.dataset.on = 'true';
}
function hideWorldTip(){ tipMesh = null; worldTip.dataset.on = 'false'; }

function select(mesh){
  (selected||[]).forEach(({m,orig})=>{ m.material = orig; });
  selected = null; festGroup.clear();
  /* Sale por aquí, así que el invalidate() del final no le llega: sin esto el
     amarillo se queda puesto hasta que algo más pida un redibujo. */
  if(!mesh){ selKey = null; closeSheet(); card.innerHTML=''; hideWorldTip();
             invalidate(); return; }
  selKey = mesh.userData.of || mesh.userData.id;
  if(mesh.userData.id){
    const key = mesh.userData.of || mesh.userData.id;
    /* Un puesto trae su familia en userData: son tres piezas sueltas de un
       grupo que se redibuja entero, y no están en GROUP, que es de edificios. */
    const fam = GROUP[key] || mesh.userData.fam || [mesh];
    const isRef = mesh.userData.kind==='reference' || LANDMARK.has(key);
    const fest = new Set(FEST[key] || []);
    selected = fam.map(m=>({m, orig:m.material}));
    fam.forEach(m=>{
      /* Lo que trae su propio material de elegido —las zonas— no se pinta
         del amarillo de los edificios. */
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
  /* Se marca en amarillo igual que siempre —el gesto y su confirmación no
     cambian— y lo único que cambia es con qué se responde. */
  if(esRotulo(mesh.userData)){
    closeSheet(); card.innerHTML = '';
    /* La burbuja de un puesto se ancla a la figura entera, no a la pieza que
       se pulsó: así queda sobre la cabeza y no sobre el pie. */
    showWorldTip(mesh.userData.fam ? mesh.parent : mesh, mesh.userData);
  } else {
    hideWorldTip();
    info(mesh.userData);
  }
  /* The readout names what is selected, and selecting moves no camera — so the
     line it prints has to be asked for here or it goes on naming the last one. */
  updateReadout();
  /* Seleccionar no mueve la cámara, así que no pasa por applyCam: si no se
     pide el redibujo aquí, el amarillo no aparece hasta que toques la vista. */
  invalidate();
}

