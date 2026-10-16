const picks = [];
/* A building is drawn as many meshes — walls, cap, roof, towers. Selection has
   to act on the building, not on whichever triangle the ray happened to hit. */
/* Nothing to do with the festival, so they stay out of the way of the pointer. */
/* Not things you click: a free-standing wall takes part in nothing and the
   music school's hall belongs to the neighbours. The access booth used to be
   here too, on the argument that the way in is something you are told about
   rather than something you interrogate — but it is the first thing anyone
   looks for on arriving, and being told about it is exactly what pressing it
   does. */
const NO_SELECT = new Set(['b-adjacent-hall-escola-musica','b-fontanet-garden-wall']);
/* Blue is for things that help you place yourself rather than places the
   festival occupies — landmarks, and the way in. */
const LANDMARK = new Set(['b-main-entrance-access-control']);
/* Where the search stands the camera for each building, written by hand with
   sembrar-vistas.py for a first draft. Angles and a distance, never a position:
   a building can be re-traced but it does not move, so what is worth writing
   down is where to stand relative to it. */
const VIEWS = __VISTAS__;
/* The festival's own kit, as opposed to the venue: food trucks, stages, the
   art tent, toilets. Traced in Figma and imported by leer-evento.py, plus
   whatever was written by hand in servicios.json for things nobody traced.
   All of it is PROVISIONAL — a build-out can move the week before, and every
   height in it is invented, so it says so wherever it appears. */
const EVENT = __EVENTO__;
const FEST = (D.festival && D.festival.vols) || {};
const FEST_SLABS = (D.festival && D.festival.slabs) || {};
const GROUP = {};
const keyOf = v => v.of || v.id;
const profiledEdges = vid => new Set(
  (D.walls||[]).filter(w=>w.vol===vid && w.profile).map(w=>w.edge));
function own(v, mesh){ (GROUP[keyOf(v)] = GROUP[keyOf(v)] || []).push(mesh); }
const WALLS = {};
(D.walls||[]).forEach(w => (WALLS[w.vol] = WALLS[w.vol] || {})[w.edge] = w.holes);

/* A hole cut in a panel laid over a solid prism just shows the prism behind it,
   so any volume that carries openings is built hollow instead: a cap on top and
   one panel per edge, cut where it needs cutting, with a dark liner set back
   behind the cut faces. */
function facePanel(P, i, base, top, holes, profile){
  const n=P.length, a=P[i], b=P[(i+1)%n];
  const L=Math.hypot(b[0]-a[0], b[1]-a[1]);
  const ux=(b[0]-a[0])/L, uz=(b[1]-a[1])/L;
  /* Outward is decided by the polygon's winding, not by where its centroid
     lies. On a re-entrant corner the centroid sits on the wrong side, the
     panel faced in, its reveal came out in front and a hole cut in it would
     have been mirrored. Rosa's short wall by the staff office was the case
     (2026-09-14); on the 53 walls that already carry holes the two rules
     agree, so nothing else moved. Polygons come in both windings. */
  let area2=0;
  for(let k=0;k<n;k++){ const p=P[k], q=P[(k+1)%n]; area2 += p[0]*q[1]-q[0]*p[1]; }
  let nx, nz;
  if(area2>0){ nx=uz; nz=-ux; } else { nx=-uz; nz=ux; }
  const s=new THREE.Shape();
  s.moveTo(0,base); s.lineTo(L,base);
  if(profile){
    /* A gable front carries on above the eaves and is squared off at the top,
       so the wall itself has to follow that outline: the lights in the gable
       sit above the eaves line and would otherwise be cut in half. */
    const {eave, apex, flat} = profile, f = Math.min(flat, L*0.6);
    s.lineTo(L, eave); s.lineTo((L+f)/2, apex); s.lineTo((L-f)/2, apex); s.lineTo(0, eave);
  } else {
    s.lineTo(L,top); s.lineTo(0,top);
  }
  s.closePath();
  (holes||[]).forEach(o=>{
    if(o.circle){
      const p=new THREE.Path();
      p.absarc(o.off + o.w/2, o.sill + o.h/2, o.w/2, 0, Math.PI*2, false);
      s.holes.push(p);
      return;
    }
    if(o.semi){
      const p=new THREE.Path(), r=o.w/2, cx=o.off+r, cy=o.sill+o.h-r;
      p.moveTo(o.off, o.sill); p.lineTo(o.off+o.w, o.sill); p.lineTo(o.off+o.w, cy);
      p.absarc(cx, cy, r, 0, Math.PI, false);
      p.lineTo(o.off, o.sill); p.closePath();
      s.holes.push(p);
      return;
    }
    const p=new THREE.Path(), x0=o.off, x1=o.off+o.w, y0=o.sill, y1=o.sill+o.h;
    p.moveTo(x0, y1-(o.arch||0));
    if(o.arch>0) p.quadraticCurveTo((x0+x1)/2, y1+o.arch, x1, y1-o.arch);
    else p.lineTo(x1, y1);
    p.lineTo(x1,y0); p.lineTo(x0,y0); p.closePath();
    s.holes.push(p);
  });
  return {geo:new THREE.ShapeGeometry(s, 12), a, ux, uz, nx, nz, L};
}
const faceBasis=(ux,uz,nx,nz)=>new THREE.Matrix4().makeBasis(
  new THREE.Vector3(ux,0,uz), new THREE.Vector3(0,1,0), new THREE.Vector3(nx,0,nz));
/* What you press is the building's silhouette, not whichever triangle the ray
   met. The panels have their openings cut out for real, and what fills an
   opening —bars, glazing, the dark liner— is baked and not in picks, so a click
   on a window fell through it and picked whatever lay beyond: the ground from
   up high (nothing), a generator or the next building through the back window
   at mid height, and only at street level the inside of the far wall, which is
   why it "worked" there (Erick, 2026-09-21). So every hollow volume also
   carries its solid prism, undrawn: the renderer skips a material with
   visible=false, the r128 raycaster does not look at it, and being in picks
   keeps it out of the bake. No draw calls, no shadow. It is not own()ed: there
   is nothing on it to recolour. */
const matSilueta = new THREE.MeshBasicMaterial({visible:false, side:THREE.DoubleSide});
function hollow(v, mat, group, pickable, capMat){
  const P=v.poly, base=v.base, top=v.h+v.base, spec=WALLS[v.id]||{};
  for(let i=0;i<P.length;i++){
    const wspec = (D.walls||[]).find(w=>w.vol===v.id && w.edge===i);
    const f=facePanel(P,i,base,top,spec[i], wspec && wspec.profile);
    if(f.L<0.15) continue;
    const m=new THREE.Mesh(f.geo, mat);
    m.applyMatrix4(faceBasis(f.ux,f.uz,f.nx,f.nz));
    m.position.set(f.a[0]-CX, 0, f.a[1]-CZ);
    m.castShadow=true; m.receiveShadow=true; m.userData=v;
    group.add(m); own(v,m); if(pickable && !NO_SELECT.has(v.id)) picks.push(m);
    if(spec[i]){
      const b=facePanel(P,i,base,top,null, wspec && wspec.profile);
      const r=new THREE.Mesh(b.geo, matReveal);
      r.applyMatrix4(faceBasis(b.ux,b.uz,b.nx,b.nz));
      r.position.set(b.a[0]-CX - b.nx*REVEAL, 0, b.a[1]-CZ - b.nz*REVEAL);
      group.add(r);
    }
  }
  const cap=new THREE.ShapeGeometry(shapeOf(P));
  cap.rotateX(Math.PI/2); cap.translate(0, top, 0);
  const cm=new THREE.Mesh(cap, capMat || mat);
  cm.castShadow=true; cm.receiveShadow=true; cm.userData=v;
  group.add(cm); own(v,cm); if(pickable && !NO_SELECT.has(v.id)) picks.push(cm);
  if(pickable && !NO_SELECT.has(v.id)){
    const s=new THREE.Mesh(prism(P, v.h, base), matSilueta);
    s.name='silueta'; s.castShadow=false; s.receiveShadow=false; s.userData=v;
    group.add(s); picks.push(s);
  }
}

D.vols.forEach(v=>{
  const isCtx = v.kind==='reference';
  if(WALLS[v.id]){
    /* Two-sided: a face whose outward normal ends up reversed would otherwise
       vanish, and the cap would face the ground. It also means the inside of a
       hollow volume still reads as surface rather than a void. */
    /* A named landmark is worth selecting even when it is context: it is how
       someone works out which building they are looking at. */
    hollow(v, isCtx ? matCtxRoof : (PAINTED[v.id] || matWallTwoSided),
           isCtx ? ctxGroup : volGroup,
           !isCtx || !!v.name, isCtx ? null : matCap);
    if(v.roof==='shed' && v.hi){
      const rg = shedRoof(v.poly, v.h + v.base, v.hi, v.low_toward, v.slope);
      if(rg){
        const rm = new THREE.Mesh(rg, isCtx ? matCtxRoof : matPartRoof);
        rm.castShadow = true; rm.userData = v;
        (isCtx ? ctxGroup : volGroup).add(rm); own(v,rm);
      }
    }
    if((v.roof==='gable'||v.roof==='hip'||v.roof==='halfhip') && v.rise>0){
      const rg = gableRoof(v.poly, v.h + v.base, v.rise,
              v.roof==='hip' || v.roof==='halfhip', profiledEdges(v.id), v.gable_toward, v.hip_inset);
      const rm = new THREE.Mesh(rg, isCtx ? matCtxRoof : matPartRoof);
      rm.castShadow = true; rm.userData = v;
      (isCtx ? ctxGroup : volGroup).add(rm); own(v,rm);
    }
    return;
  }
  const g = prism(v.poly, v.h, v.base);
  const mesh = new THREE.Mesh(g, isCtx ? matCtx : (PAINTED[v.id] || matPart));
  mesh.castShadow = !isCtx; mesh.receiveShadow = true;
  mesh.userData = v;
  (isCtx ? ctxGroup : volGroup).add(mesh); own(v,mesh);
  if(isCtx && v.name && !NO_SELECT.has(v.id)) picks.push(mesh);
  if(!isCtx){
    if(!NO_SELECT.has(v.id)) picks.push(mesh);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), edgeMat));
  }
  if(v.roof==='shed' && v.hi){
    const rg = shedRoof(v.poly, v.h + v.base, v.hi, v.low_toward, v.slope);
    if(rg){
      const rm = new THREE.Mesh(rg, isCtx ? matCtxRoof : matPartRoof);
      rm.castShadow = true; rm.receiveShadow = true; rm.userData = v;
      (isCtx ? ctxGroup : volGroup).add(rm); own(v,rm);
      if(!isCtx){ picks.push(rm); rm.add(new THREE.LineSegments(new THREE.EdgesGeometry(rg,20), edgeMat)); }
    }
  }
  if((v.roof==='gable'||v.roof==='hip'||v.roof==='halfhip') && v.rise>0){
    const rg = gableRoof(v.poly, v.h + v.base, v.rise,
              v.roof==='hip' || v.roof==='halfhip', profiledEdges(v.id), v.gable_toward, v.hip_inset);
    const rm = new THREE.Mesh(rg, isCtx ? matCtxRoof : matPartRoof);
    rm.castShadow = true; rm.receiveShadow = true;
    rm.userData = v;
    (isCtx ? ctxGroup : volGroup).add(rm); own(v,rm);
    if(!isCtx){ picks.push(rm);
      rm.add(new THREE.LineSegments(new THREE.EdgesGeometry(rg, 20), edgeMat)); }
  }
});

