/* the chimney: the thing everyone navigates by */
{
  const c = D.chimney, cx = c.poly.reduce((a,p)=>a+p[0],0)/c.poly.length - CX,
        cz = c.poly.reduce((a,p)=>a+p[1],0)/c.poly.length - CZ;
  /* Brick like everything else, but a cylinder's UVs run 0..1 around and 0..1
     up rather than in metres, so this one gets its own copy of the texture with
     the repeat worked out from the real girth and height. The image is shared;
     only the repeat differs. */
  const bt = brick.clone(); bt.needsUpdate = true;
  bt.repeat.set(Math.PI * (c.r0 + c.r1) / (2 * BRICK_W), c.h / (2 * BRICK_H));
  const matChimney = new THREE.MeshStandardMaterial({map:bt, color:theme.brick, roughness:.9});
  THEMED.push([matChimney, 'brick']);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r1, c.r0, c.h, 20), matChimney);
  m.position.set(cx, c.h/2, cz); m.castShadow = true;
  m.userData = {id:'chimney', kind:'landmark', name:'Chimney', h:c.h, est:true};
  /* Registered like a building so selection and the search can reach it by
     name. It is one mesh, but it is the thing the whole site is navigated by. */
  GROUP.chimney = [m];
  volGroup.add(m); picks.push(m);
}

/* zone tints on the ground. Pulsables (2026-09-14): una zona no tiene nada
   dentro que explorar, así que responde con la burbuja y su letra —«Zone C»—,
   que es como un voluntario aprende qué es la C con el mapa en la mano.
   Elegida, sube de opacidad en vez de ponerse amarilla: el color ES la zona,
   y pintarla de otro sería quitarle el nombre en el momento de decirlo. */
D.zones.forEach(z=>{
  const g = new THREE.ShapeGeometry(shapeOf(z.poly));
  g.rotateX(Math.PI/2); g.translate(0,.12,0);
  const mat = new THREE.MeshBasicMaterial(
    {color:new THREE.Color(z.color), transparent:true, opacity:.3, side:THREE.DoubleSide});
  const m = new THREE.Mesh(g, mat);
  m.userData = {id:'z-'+z.zid, kind:'zone', name:'Zone '+z.zid, sel:mat.clone()};
  m.userData.sel.opacity = .6;
  picks.push(m);
  zoneGroup.add(m);
});
zoneGroup.visible = false;

/* ---------- street names ----------
   Laid flat on the ground and rotated to follow each street, the way they read
   on the 2D map. Canvas textures avoid pulling in a font loader. */
const labGroup = new THREE.Group(); scene.add(labGroup);
const labMats = [];
function labelTexture(text, PX, glyph, halo){
  const pad = 26, tracking = PX*0.18;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `500 ${PX}px "IBM Plex Mono", monospace`;
  const w = Math.ceil(probe.measureText(text).width + tracking*text.length) + pad*2;
  const c = document.createElement('canvas');
  c.width = w; c.height = PX*2;
  const x = c.getContext('2d');
  x.font = `500 ${PX}px "IBM Plex Mono", monospace`;
  x.textBaseline = 'middle';
  x.lineWidth = PX*0.22; x.lineJoin = 'round';
  let cx = pad;
  for(const ch of text){
    if(halo){ x.strokeStyle = halo; x.strokeText(ch, cx, c.height/2); }
    x.fillStyle = glyph; x.fillText(ch, cx, c.height/2);
    cx += x.measureText(ch).width + tracking;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.encoding = THREE.sRGBEncoding;
  return {tex, ratio:c.width/c.height};
}
function makeLabel(text, fsMetres){
  const PX = 96;
  /* Two textures: over the dark ground a pale glyph needs a halo to read, over
     the light one the halo just muddies it, so that version goes without. */
  const dark  = labelTexture(text, PX, '#EDE7DB', 'rgba(0,0,0,.55)');
  const light = labelTexture(text, PX, '#26262A', null);
  const m = new THREE.MeshBasicMaterial({map:dark.tex, transparent:true, depthWrite:false, opacity:.95});
  m.userData = {dark:dark.tex, light:light.tex};
  labMats.push(m);
  const hM = fsMetres*1.9, wM = hM * dark.ratio;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), m);
  mesh.renderOrder = 5;
  return {mesh, wM};
}
/* Flip this to 1 if the street names run across the streets instead of along
   them. In SVG, y grows downward so rotate(a) turns text from +X toward +Y;
   once the plane is laid flat that same turn goes from +X toward -Z, so the
   angle has to be negated. */
const LABEL_SPIN = -1;
(D.labels||[]).forEach(l=>{
  const {mesh, wM} = makeLabel(l.text, l.fs);
  const a = l.a*Math.PI/180;
  mesh.rotation.set(-Math.PI/2, 0, 0);
  mesh.rotateZ(LABEL_SPIN * a);
  mesh.position.set(
    (l.x - CX) + Math.cos(a)*wM/2,
    0.18,
    (l.y - CZ) + Math.sin(a)*wM/2);
  labGroup.add(mesh);
});

/* ---------- rooms, and where a floor plan lives now ----------
   The plan used to be built here, in 3D: a translucent slab at an invented
   height with a prism per room, and the building around it turned to glass so
   you could see in. That is gone. A floor is drawn flat inside the sheet by
   plano2d(), which reads better and is the surface the organiser will drop
   volunteers onto.

   What went with it is worth naming, because it was not small: the glass and
   its per-mesh material clones, shellOf() and the footprint ownership it
   cached, the slab group, the four ways of leaving a floor, the pointer gate
   that stopped a click on a glass wall from shutting the very plan it was
   aimed at, and the room branch of select(). None of it was wrong. All of it
   existed to answer problems that arise only from putting a plan inside a 3D
   building — taking the plan out did not fix them, it retired them.

   The division that remains is clean. Outdoors is 3D: the site, the buildings,
   and the volunteers standing on the ground between them. Indoors is the plan
   in the sheet: rooms, and the volunteers posted in them. */
const KIND = D.kinds;

/* Kept although the glass that used them is gone. The volunteer layer has to
   decide which zone a dropped point falls into, and that is this, unchanged. */
const inPoly = (x, z, poly) => {
  let c = false;
  for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const nearPoly = (x, z, poly, r) => {
  for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    const dx = xj - xi, dz = zj - zi, L = dx*dx + dz*dz;
    const t = L ? Math.max(0, Math.min(1, ((x-xi)*dx + (z-zi)*dz) / L)) : 0;
    if(Math.hypot(x - (xi + t*dx), z - (zi + t*dz)) <= r) return true;
  }
  return false;
};

