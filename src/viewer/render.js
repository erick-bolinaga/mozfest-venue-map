/* ---------- merging what never moves ---------- */
/* The split that really matters in this viewer is not which file each thing
   lives in: it is which things move and which do not.

   The site used to be drawn with 7,881 meshes and 7,524 draw calls per frame,
   for 64,136 triangles. Eight triangles per call. Triangles are not the
   problem; the problem is asking 7,524 times for something to be drawn, and
   that cost is paid by the CPU, not the graphics card. Nearly all of them were
   joinery bars: every mullion and every transom of the 787 openings was a mesh
   of its own.

   And none of them ever changes. So the line can be drawn without inventing
   anything: **static is whatever nobody can press and nobody recolours**.
   That means `picks` and the GROUP families; everything else can be baked into
   a single geometry per material.

   Merging happens INSIDE each top-level group and not at the scene root,
   because zoneGroup is switched off whole and taking its children out would
   take its switch away. And it is baked in that group's local space —not in
   world space— so that a group with a transform does not apply it twice. */
function concatGeometry(geos){
  let n = 0;
  for(const g of geos) n += g.attributes.position.count;
  const withUV = geos.every(g => g.attributes.uv);
  const pos = new Float32Array(n*3), nor = new Float32Array(n*3);
  const uv  = withUV ? new Float32Array(n*2) : null;
  let o = 0;
  for(const g of geos){
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o*3);
    if(g.attributes.normal) nor.set(g.attributes.normal.array, o*3);
    if(uv) uv.set(g.attributes.uv.array, o*2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  if(uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
function mergeStatic(){
  scene.updateMatrixWorld(true);
  const untouchable = new Set(picks);
  Object.values(GROUP).forEach(fam => fam.forEach(m => untouchable.add(m)));
  untouchable.add(ground);

  const topOf = o => { let p = o; while(p.parent && p.parent !== scene) p = p.parent; return p; };
  const batches = new Map();
  scene.traverse(o => {
    /* An instanced mesh is already a single draw call, and one with several
       materials would need groups per material: neither gains anything here. */
    if(!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    if(untouchable.has(o)) return;
    const anc = topOf(o);
    if(anc === o) return;                    /* hangs straight off the scene, nothing to join */
    /* A group can opt out: the volunteer stations are redrawn whole when one
       is placed, and once merged there would be no figure left to remove. */
    if(anc.userData && anc.userData.noMerge) return;
    const k = [anc.uuid, o.material.uuid, o.renderOrder, o.castShadow?1:0, o.receiveShadow?1:0].join('|');
    let b = batches.get(k);
    if(!b) batches.set(k, b = {anc, mat:o.material, order:o.renderOrder,
                               cast:o.castShadow, receive:o.receiveShadow, ms:[]});
    b.ms.push(o);
  });

  let before = 0, after = 0;
  const inv = new THREE.Matrix4(), m4 = new THREE.Matrix4();
  batches.forEach(b => {
    before += b.ms.length;
    if(b.ms.length < 2){ after += b.ms.length; return; }   /* a single mesh gains nothing */
    inv.copy(b.anc.matrixWorld).invert();
    const geos = b.ms.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
    });
    const merged = new THREE.Mesh(concatGeometry(geos), b.mat);
    merged.renderOrder = b.order;
    merged.castShadow = b.cast; merged.receiveShadow = b.receive;
    /* The intermediate geometries are copies already; the originals are NOT
       touched, because several meshes share geometry and freeing one would
       break the rest. */
    geos.forEach(g => g.dispose());
    b.ms.forEach(m => m.parent && m.parent.remove(m));
    b.anc.add(merged);
    after += 1;
  });
  return {before, after};
}
const MERGED = mergeStatic();

runIntro();

scene.background = new THREE.Color(theme.bg);

/* ---------- draw only when there is something to draw ---------- */
/* The loop used to redraw the whole site sixty times a second, whether
   anything had changed or not, and whether the window was in view or
   minimised. With 7,881 meshes that is some 7,500 draw calls per frame for
   64,000 triangles —eight triangles per call— and that cost is not paid by the
   graphics card, it is paid by the CPU asking for them one by one. Hence the
   60% with the window minimised.

   Now the scene is marked dirty when something really changes it: the camera,
   the selection, the theme or the window size. A camera animation goes through
   applyCam on every step, so it keeps itself going.

   If one day something changes the scene and it does not show until you touch
   the view, a call to invalidate() is missing there; the loop is not broken. */
/* var and not let for the same reason as tipMesh: applyCam() runs at start-up,
   a thousand lines before this one, and a let would still be in its dead zone. */
var dirty = true;
function invalidate(){ dirty = true; }
/* Minimised or in another tab there is nothing to show. rAF usually slows down
   on its own, but not always, and this does not rely on it doing so. */
document.addEventListener('visibilitychange', invalidate);
(function loop(){
  requestAnimationFrame(loop);
  if(document.hidden) return;
  stepCam();
  if(!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
})();
