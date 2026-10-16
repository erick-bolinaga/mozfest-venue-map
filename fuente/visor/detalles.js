/* ---------- louvre cage ----------
   A volume in its own right: dark glazing extruded over the footprint, wrapped
   in vertical bars on every edge. Bars are instanced, so the count is free.
   A cage with `valla` is a fence instead: hollow, so no glazing and no lid,
   just a see-through mesh on each edge and its posts. `area` takes the outline
   from a traced a- layer, so the fence follows it when it is retraced. */
/* Light and clearly see-through, so the bars read against it. */
const matGlass = new THREE.MeshStandardMaterial({color:0x8FA6B8, roughness:.12, metalness:.15,
  transparent:true, opacity:.28, side:THREE.DoubleSide});
const matLouvre= new THREE.MeshStandardMaterial({color:0x2E353F, roughness:.6, metalness:.35});
const matMalla = new THREE.MeshStandardMaterial({color:0x4B5563, roughness:.8, metalness:.3,
  transparent:true, opacity:.3, side:THREE.DoubleSide, depthWrite:false});
(D.cages||[]).forEach(c=>{
  const H = c.y1 - c.y0;
  const poly = c.poly || ((D.blocks.find(b=>b.id===c.area)||{}).poly);
  if(!poly) return;
  c = Object.assign({}, c, {poly});
  if(c.valla){
    for(let e=0;e<poly.length;e++){
      const a=poly[e], b=poly[(e+1)%poly.length];
      const L=Math.hypot(b[0]-a[0], b[1]-a[1]); if(L<0.2) continue;
      const g=new THREE.PlaneGeometry(L, H);
      const m=new THREE.Mesh(g, matMalla);
      m.position.set((a[0]+b[0])/2-CX, c.y0+H/2, (a[1]+b[1])/2-CZ);
      m.rotation.y = Math.atan2(-(b[1]-a[1]), b[0]-a[0]);
      m.userData = {id:c.label, kind:'fence'};
      volGroup.add(m);
    }
  } else {
    const glass = new THREE.Mesh(prism(c.poly, H, c.y0), matGlass);
    glass.userData = {id:c.label, kind:'cage', h:H};
    glass.castShadow = true;
    volGroup.add(glass); picks.push(glass);
  }

  /* one bar every `pitch` along every edge of the footprint */
  const slots = [];
  for(let e=0;e<c.poly.length;e++){
    const a=c.poly[e], b=c.poly[(e+1)%c.poly.length];
    const ax=a[0]-CX, az=a[1]-CZ, bx=b[0]-CX, bz=b[1]-CZ;
    const L=Math.hypot(bx-ax, bz-az); if(L<0.2) continue;
    const ux=(bx-ax)/L, uz=(bz-az)/L;
    const n=Math.max(1, Math.round(L/c.pitch));
    for(let i=0;i<n;i++){
      const t=(i+0.5)*L/n;
      slots.push([ax+ux*t, az+uz*t, Math.atan2(-uz, ux)]);
    }
  }
  const geo = new THREE.BoxGeometry(c.bar, H, c.bar*0.7);
  const bars = new THREE.InstancedMesh(geo, matLouvre, slots.length);
  bars.castShadow = true;
  const m4=new THREE.Matrix4(), q=new THREE.Quaternion(), sc=new THREE.Vector3(1,1,1);
  slots.forEach(([x,z,rot],i)=>{
    q.setFromAxisAngle(new THREE.Vector3(0,1,0), rot);
    m4.compose(new THREE.Vector3(x, c.y0 + H/2, z), q, sc);
    bars.setMatrixAt(i, m4);
  });
  bars.instanceMatrix.needsUpdate = true;
  volGroup.add(bars);
});

/* ---------- pitch markings ----------
   Drawn from the footprint rather than traced, so the lines are single, closed
   and in the right places. Futsal layout scaled to whatever the pitch measures. */
if(D.pitch){
  const p=D.pitch, mat=new THREE.LineBasicMaterial({color:0xEDE7DB, transparent:true, opacity:.75});
  const g=new THREE.Group(); g.position.y=0.12; scene.add(g);
  const at=(du,dv)=>new THREE.Vector3(
    p.c[0]+p.u[0]*du+p.v[0]*dv - CX, 0, p.c[1]+p.u[1]*du+p.v[1]*dv - CZ);
  const line=pts=>g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  const L=p.L/2, W=p.W/2;
  line([at(-L,-W),at(L,-W),at(L,W),at(-L,W),at(-L,-W)]);        // touchlines
  line([at(0,-W),at(0,W)]);                                      // halfway line
  const R=Math.min(3, p.W*0.26), circ=[];
  for(let i=0;i<=48;i++){ const t=i/48*Math.PI*2; circ.push(at(Math.cos(t)*R, Math.sin(t)*R)); }
  line(circ);
  const pa=Math.min(6, p.L*0.16), pb=Math.min(5, p.W*0.42);      // penalty areas
  [-1,1].forEach(s=>line([at(s*L,-pb),at(s*(L-pa),-pb),at(s*(L-pa),pb),at(s*L,pb)]));
}

/* ---------- wire enclosure ----------
   Posts and horizontal rails, nothing in between: the open cage round a
   five-a-side pitch, as opposed to the glazed screen over the lobby. */
const matWire = new THREE.MeshStandardMaterial({color:0x7A828E, roughness:.6, metalness:.55});
(D.wire||[]).forEach(w=>{
  const posts=[], rails=[];
  for(let e=0;e<w.poly.length;e++){
    const a=w.poly[e], b=w.poly[(e+1)%w.poly.length];
    const ax=a[0]-CX, az=a[1]-CZ, bx=b[0]-CX, bz=b[1]-CZ;
    const L=Math.hypot(bx-ax,bz-az); if(L<0.3) continue;
    const ux=(bx-ax)/L, uz=(bz-az)/L, rot=Math.atan2(-uz,ux);
    const n=Math.max(1, Math.round(L/w.pitch));
    for(let i=0;i<=n;i++) posts.push([ax+ux*i*L/n, az+uz*i*L/n]);
    for(let k=1;k<=w.rails;k++)
      rails.push([ax+ux*L/2, az+uz*L/2, rot, L, k*w.h/(w.rails+1)]);
  }
  const pg = new THREE.BoxGeometry(w.post, w.h, w.post);
  const pm = new THREE.InstancedMesh(pg, matWire, posts.length);
  pm.castShadow = true;
  const M=new THREE.Matrix4(), q=new THREE.Quaternion(), sc=new THREE.Vector3(1,1,1);
  posts.forEach(([x,z],i)=>{ M.compose(new THREE.Vector3(x, w.h/2, z), q, sc); pm.setMatrixAt(i,M); });
  pm.instanceMatrix.needsUpdate = true;
  volGroup.add(pm);

  rails.forEach(([x,z,rot,L,y])=>{
    const g=new THREE.BoxGeometry(L, w.post*0.55, w.post*0.55);
    const m=new THREE.Mesh(g, matWire);
    m.position.set(x,y,z); m.rotation.y = rot;
    volGroup.add(m);
  });
});

/* ---------- roofs drawn over a single volume ----------
   These are footprints of the roofs only: the building below stays one volume,
   which is all that matters when the inside is not being modelled. */
(D.roofs||[]).forEach(rf=>{
  const g = gableRoof(rf.poly, rf.y, rf.rise, rf.hip);
  if(!g) return;
  const m = new THREE.Mesh(g, matPartRoof);
  m.castShadow = true; m.receiveShadow = true;
  m.userData = {id:rf.id, of:rf.of, kind:'roof', h:rf.y+rf.rise};
  volGroup.add(m); picks.push(m);
  (GROUP[rf.of] = GROUP[rf.of] || []).push(m);
});

/* ---------- canopy slabs and low walls ----------
   Both are placed from outlines that already exist in the trace, so nothing
   here is guesswork about where they sit. */
(D.slabs||[]).forEach(sl=>{
  const m = new THREE.Mesh(prism(sl.poly, sl.t, sl.y), matPartRoof);
  m.castShadow = true; m.receiveShadow = true;
  m.userData = {id:sl.label, kind:'canopy', h:sl.y+sl.t};
  volGroup.add(m); picks.push(m);
});
(D.lowwalls||[]).forEach(lw=>{
  const m = new THREE.Mesh(prism(lw.poly, lw.h, 0), matPart);
  m.castShadow = true; m.receiveShadow = true;
  m.userData = {id:lw.label, kind:'wall', h:lw.h};
  volGroup.add(m); picks.push(m);
});

/* ---------- the event's own kit ----------
   Low solids in the colour of the room kind each one belongs to, so a food
   truck outside reads as the same category as a food room inside. Placed only
   where a polygon was traced: the ones that hang off a room by name have no
   position out here and belong on that room's plan instead. */
const EVGROUP = [];
EVENT.filter(e => e.poly).forEach(e => {
  const col = ((D.kinds || {})[e.kind] || {}).color || '#8A93A2';
  const mat = new THREE.MeshStandardMaterial({color: new THREE.Color(col), roughness:.85});
  const m = new THREE.Mesh(prism(e.poly, e.h || 2.5, 0), mat);
  m.castShadow = true; m.receiveShadow = true;
  m.userData = {id:e.id, kind:'event', name:e.label, h:e.h || 2.5, est:true, ev:e};
  volGroup.add(m); picks.push(m); EVGROUP.push(m);
  GROUP[e.id] = [m];
});

/* ---------- rainwater downpipes ---------- */
[D.pipes, ...(D.pipes2||[])].filter(Boolean).forEach(p=>{
  const v=D.vols.find(x=>x.id===p.foot);
  if(v){
    const P=v.poly, n=P.length, a=P[p.edge%n], b=P[(p.edge+1)%n];
    const L=Math.hypot(b[0]-a[0], b[1]-a[1]);
    const ux=(b[0]-a[0])/L, uz=(b[1]-a[1])/L;
    let cx=0, cz=0; P.forEach(q=>{cx+=q[0]; cz+=q[1];}); cx/=n; cz/=n;
    let nx=-uz, nz=ux;
    if(((a[0]+b[0])/2-cx)*nx + ((a[1]+b[1])/2-cz)*nz < 0){ nx=-nx; nz=-nz; }
    const mat=new THREE.MeshStandardMaterial({color:0x4A4E55, roughness:.5, metalness:.6});
    const geo=new THREE.CylinderGeometry(p.r, p.r, p.h, 8);
    const pipes=new THREE.InstancedMesh(geo, mat, p.at.length);
    pipes.castShadow = true;
    const M=new THREE.Matrix4(), q=new THREE.Quaternion(), sc=new THREE.Vector3(1,1,1);
    p.at.forEach((t,i)=>{
      M.compose(new THREE.Vector3(
        a[0]-CX + ux*t + nx*(p.r+0.04), p.h/2, a[1]-CZ + uz*t + nz*(p.r+0.04)), q, sc);
      pipes.setMatrixAt(i, M);
    });
    pipes.instanceMatrix.needsUpdate = true;
    volGroup.add(pipes);
  }
});

/* ---------- trees ----------
   Trunk and a few overlapping crowns: enough to read as planting at this scale
   without becoming geometry to maintain. */
(D.trees||[]).forEach(t=>{
  const bark=new THREE.MeshStandardMaterial({color:0x5A4632, roughness:.95});
  const leaf=new THREE.MeshStandardMaterial({color:0x4E6B3C, roughness:.9, flatShading:true});
  const g=new THREE.Group();
  const th=t.h*0.42;
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(t.h*0.028, t.h*0.045, th, 8), bark);
  trunk.position.y=th/2; g.add(trunk);
  [[0, th+t.h*0.20, t.h*0.26],
   [t.h*0.10, th+t.h*0.34, t.h*0.20],
   [-t.h*0.09, th+t.h*0.33, t.h*0.18]].forEach(([dx,y,r])=>{
    const c=new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), leaf);
    c.position.set(dx, y, dx*0.4); g.add(c);
  });
  g.children.forEach(c=>{ c.castShadow=true; c.receiveShadow=true; });
  g.position.set(t.x-CX, 0, t.z-CZ);
  volGroup.add(g);
});

/* ---------- a figure for scale ----------
   1.75 m, so an opening can be judged against something familiar rather than
   against a number. La misma figura sirve para los puestos de voluntario, así
   que se hace una vez y se pinta de dos colores. */
const matFigura = new THREE.MeshStandardMaterial({color:0xD9A227, roughness:.7});
const matPuesto = new THREE.MeshStandardMaterial({color:0xC2452D, roughness:.7,
                                                  emissive:0x2A0E08});
function figura(h, mat){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.19,h*0.81,10), mat);
  body.position.y=h*0.405; g.add(body);
  const sh=new THREE.Mesh(new THREE.SphereGeometry(0.19,12,8), mat);
  sh.position.y=h*0.78; g.add(sh);
  const head=new THREE.Mesh(new THREE.SphereGeometry(h*0.066,14,10), mat);
  head.position.y=h*0.934; g.add(head);
  g.children.forEach(c=>c.castShadow=true);
  return g;
}
(D.figures||[]).forEach(f=>{
  const g = figura(f.h, matFigura);
  g.position.set(f.x-CX, 0, f.z-CZ);
  g.userData={id:'1.75 m', kind:'figure'};
  volGroup.add(g);
});

