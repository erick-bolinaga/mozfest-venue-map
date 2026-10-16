/* ---------- façade openings ----------
   Positions arrive already resolved to world coordinates with an outward
   normal, so nothing here depends on which polygon the wall came from.
   A dark panel proud of the wall reads the same as a real opening at this
   scale and costs nothing. */
/* Unlit black: a shaded material would sink into the wall tone in dark mode
   and wash out in light mode. Black reads the same under both. */
/* Sits inside the reveal, so no depth trickery is needed. */
const matGlazing = new THREE.MeshStandardMaterial({color:0x0A0F16, roughness:.3,
  metalness:.4, side:THREE.DoubleSide});
const holeEdge = new THREE.LineBasicMaterial({color:0x000000, transparent:true, opacity:.55});
/* A stilted head: the jambs carry on straight for a moment past the springing
   before the curve turns, which is what stops it reading as a plain half-round. */
function semiShape(w, h){
  const s=new THREE.Shape(), r=w/2, cy=h-r;
  s.moveTo(-r, 0); s.lineTo(r, 0); s.lineTo(r, cy);
  s.absarc(0, cy, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}
function openingShape(w, h, arch){
  const s = new THREE.Shape();
  s.moveTo(-w/2, 0);
  s.lineTo( w/2, 0);
  if(arch > 0){
    s.lineTo(w/2, h-arch);
    s.quadraticCurveTo(0, h+arch, -w/2, h-arch);   // apex lands at h
  } else {
    s.lineTo( w/2, h);
    s.lineTo(-w/2, h);
  }
  s.lineTo(-w/2, 0);
  return s;
}
const matBar = new THREE.MeshBasicMaterial({color:0xF2EEE6});
/* A ribbon of quads following the arch, so the head of the frame curves with
   the opening instead of cutting straight across it. */
function curvedBar(w, h, arch, t, mat){
  const N = 24, P0=[-w/2, h-arch], C=[0, h+arch], P2=[w/2, h-arch];
  const pts=[];
  for(let i=0;i<=N;i++){
    const s=i/N, u=1-s;
    pts.push([u*u*P0[0] + 2*u*s*C[0] + s*s*P2[0],
              u*u*P0[1] + 2*u*s*C[1] + s*s*P2[1]]);
  }
  const v=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[Math.max(0,i-1)], b=pts[Math.min(pts.length-1,i+1)];
    const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1;
    const nx=-dy/L*t/2, ny=dx/L*t/2;
    v.push([pts[i][0]-nx, pts[i][1]-ny], [pts[i][0]+nx, pts[i][1]+ny]);
  }
  const tris=[];
  for(let i=0;i+3<v.length;i+=2){
    tris.push(v[i],v[i+1],v[i+3], v[i],v[i+3],v[i+2]);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    tris.flatMap(p=>[p[0], p[1], 0]), 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
/* A ribbon following an arbitrary arc, for the concentric bars of a fanlight. */
function arcBar(cx, cy, r, a0, a1, t, mat){
  const N=24, v=[];
  for(let i=0;i<=N;i++){
    const a=a0+(a1-a0)*i/N, c=Math.cos(a), s=Math.sin(a);
    v.push([cx+c*(r-t/2), cy+s*(r-t/2)], [cx+c*(r+t/2), cy+s*(r+t/2)]);
  }
  const tris=[];
  for(let i=0;i+3<v.length;i+=2) tris.push(v[i],v[i+1],v[i+3], v[i],v[i+3],v[i+2]);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flatMap(p=>[p[0],p[1],0]), 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
const _frames = {};
const frameMat = hex => _frames[hex] || (_frames[hex] = new THREE.MeshBasicMaterial({color:new THREE.Color(hex)}));
(D.openings||[]).forEach(o=>{
  if(!o.panes && !o.fanlight && !o.panelled && !o.banded) return;                     // plain doorways carry no glazing
  const g = new THREE.ShapeGeometry(
    o.semi ? semiShape(o.w, o.h) : openingShape(o.w, o.h, o.arch||0), 12);
  const m = new THREE.Mesh(g, matGlazing);
  /* set back inside the reveal, so there is nothing to z-fight with */
  m.position.set(o.x - CX - o.nx*0.06, o.sill, o.z - CZ - o.nz*0.06);
  m.rotation.y = Math.atan2(o.nx, o.nz);
  m.userData = {id:o.label, kind:'opening', h:o.h, w:o.w, panes:o.panes};

  /* Glazing bars. When `door` is set the lower part is solid and only the
     strip above it is divided, with a transom marking the head of the door. */
  if(o.banded){
    /* A band across the top, three uprights in the middle, a band across the
       bottom: the uprights stop at the bands rather than running the full drop. */
    const q=o.banded, t=0.05, bm=frameMat(o.frame||'#F2EEE6');
    const bars=new THREE.Group(); bars.position.z=0.001;
    const y0=o.h*q.band, y1=o.h*(1-q.band);
    [[0,y0,o.w,t],[0,y1,o.w,t],[0,0,o.w,t*1.4],[0,o.h,o.w,t*1.4]].forEach(([bx,by,bw,bh])=>{
      const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
      b.position.set(bx,by,0); bars.add(b);
    });
    [[-o.w/2,o.h/2,t*1.4,o.h],[o.w/2,o.h/2,t*1.4,o.h]].forEach(([bx,by,bw,bh])=>{
      const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
      b.position.set(bx,by,0); bars.add(b);
    });
    for(let c=1;c<q.cols;c++){
      const b=new THREE.Mesh(new THREE.PlaneGeometry(t, y1-y0), bm);
      b.position.set(-o.w/2+c*o.w/q.cols, (y0+y1)/2, 0); bars.add(b);
    }
    bars.children.forEach(b=>b.renderOrder=4);
    m.add(bars);
  }
  else if(o.panelled){
    const q=o.panelled, t=0.05, bm=frameMat(o.frame||'#F2EEE6');
    const bars=new THREE.Group(); bars.position.z=0.001;
    const vb=(x,yc,hh,tt)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(tt||t,hh), bm);
      b.position.set(x,yc,0); bars.add(b); };
    const hb=(yc,ww,xx,tt)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(ww,tt||t), bm);
      b.position.set(xx||0,yc,0); bars.add(b); };
    const topH=o.h*q.topFrac, botH=o.h-topH, y0=botH;
    hb(y0, o.w);                                    // the band divide
    for(let c=1;c<q.top[0];c++) vb(-o.w/2+c*o.w/q.top[0], y0+topH/2, topH);
    for(let c=1;c<q.bottom;c++) vb(-o.w/2+c*o.w/q.bottom, botH/2, botH);
    /* each lower panel gets its own frame, and is quartered inside it */
    const pw=o.w/q.bottom, ins=q.inset;
    for(let c=0;c<q.bottom;c++){
      const cx=-o.w/2+(c+0.5)*pw;
      const x0=cx-pw/2+ins, x1=cx+pw/2-ins, ya=ins, yb=botH-ins;
      hb(ya, x1-x0, cx); hb(yb, x1-x0, cx);
      vb(x0, (ya+yb)/2, yb-ya); vb(x1, (ya+yb)/2, yb-ya);
      vb(cx, (ya+yb)/2, yb-ya);                     // the quartering
      hb((ya+yb)/2, x1-x0, cx);
    }
    const fw=t*1.4;
    [[-o.w/2, o.h/2, fw, o.h],[o.w/2, o.h/2, fw, o.h],
     [0, 0, o.w, fw],[0, o.h, o.w, fw]].forEach(([bx,by,bw,bh])=>{
      const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
      b.position.set(bx,by,0); bars.add(b);
    });
    bars.children.forEach(b=>b.renderOrder=4);
    m.add(bars);
  }
  else if(o.fanlight){
    const f=o.fanlight, t=0.07, bm=frameMat(o.frame||'#F2EEE6');
    const bars=new THREE.Group(); bars.position.z=0.001;
    const R=o.w/2;
    const pane=o.w/f.lower[0];
    const lowH0=pane*f.lower[1];
    const upH0 =pane*(f.ratio||1)*f.upper[1];      // only a touch taller than square
    const stilt=R*(f.stilt||0);                    // straight rise before the curve
    const cy=lowH0+upH0+stilt;                     // centre of the arc
    const vbar=(x,yc,hh)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(t,hh), bm);
      b.position.set(x,yc,0); bars.add(b); };
    const hbar=(yc,ww,xx)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(ww,t), bm);
      b.position.set(xx||0,yc,0); bars.add(b); };
    /* lower sash: square panes; the transom sits where they come out square */
    const lowH = lowH0;
    for(let c=1;c<f.lower[0];c++) vbar(-o.w/2+c*o.w/f.lower[0], lowH/2, lowH);
    for(let r=1;r<f.lower[1];r++) hbar(r*lowH/f.lower[1], o.w);
    hbar(lowH, o.w);                                // the transom itself
    /* upper section, up to the springing */
    const upH = upH0;
    /* The mullions carry on through the stilt to the centre of the arc; stopping
       them at the springing left a bare strip between the grid and the fan. */
    for(let c=1;c<f.upper[0];c++) vbar(-o.w/2+c*o.w/f.upper[0], lowH+(upH+stilt)/2, upH+stilt);
    for(let r=1;r<f.upper[1];r++) hbar(lowH+r*upH/f.upper[1], o.w);
    hbar(cy-stilt, o.w);                            // springing
    /* the fan: a small arch at the centre, then two rings of sectors */
    /* The two concentric bars have to spring from the mullions below, so their
       radii come from the column spacing rather than from a chosen fraction. */
    const rIn  = R*(f.inner !== undefined ? f.inner : 1 - 4/f.upper[0]);
    const rMid = R*(f.mid   !== undefined ? f.mid   : 1 - 2/f.upper[0]);
    bars.add(arcBar(0, cy, rIn,  0, Math.PI, t, bm));
    bars.add(arcBar(0, cy, rMid, 0, Math.PI, t, bm));
    for(let k=1;k<f.sectors;k++){
      const a=Math.PI*k/f.sectors, r0=rIn, r1=R;
      const b=new THREE.Mesh(new THREE.PlaneGeometry(t, r1-r0), bm);
      b.position.set(Math.cos(a)*(r0+r1)/2, cy+Math.sin(a)*(r0+r1)/2, 0);
      b.rotation.z = a - Math.PI/2;
      bars.add(b);
    }
    /* outer frame */
    const fw=t*1.3;
    [[-o.w/2, cy/2, fw, cy],[o.w/2, cy/2, fw, cy],[0, 0, o.w, fw]].forEach(([bx,by,bw,bh])=>{
      const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
      b.position.set(bx,by,0); bars.add(b);
    });
    bars.add(arcBar(0, cy, R, 0, Math.PI, fw, bm));
    bars.children.forEach(b=>b.renderOrder=4);
    m.add(bars);
  }
  else if(o.panes){
    const [cols, rows] = o.panes, t = 0.055;
    const bm = o.frame ? frameMat(o.frame) : matBar;
    const y0 = o.door || 0, yTop = o.h - o.arch;
    /* A fanlight is its own strip of glass over a transom, divided differently
       from the leaves below it. */
    const fanH = o.fan ? o.fan.h : 0;
    const y1 = yTop - fanH, span = y1 - y0;
    const n  = o.door ? rows : rows;
    const bars = new THREE.Group(); bars.position.z = 0.001;
    const vbar=(x,yc,hh)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(t,hh), bm);
      b.position.set(x, yc, 0); bars.add(b); };
    const hbar=(yc,ww)=>{ const b=new THREE.Mesh(new THREE.PlaneGeometry(ww,t), bm);
      b.position.set(0, yc, 0); bars.add(b); };
    for(let c=1;c<cols;c++) vbar(-o.w/2 + c*o.w/cols, y0 + span/2, span);
    for(let r=(o.door?0:1); r<n; r++) hbar(y0 + r*span/n, o.w);
    /* a heavier rail where the sash divides, over the ordinary glazing bar */
    if(o.rail){
      const b=new THREE.Mesh(new THREE.PlaneGeometry(o.w, t*2.2), bm);
      b.position.set(0, y0 + span*o.rail, 0); bars.add(b);
    }
    if(o.fan){
      hbar(y1, o.w);                                   // the transom
      for(let c=1;c<o.fan.cols;c++) vbar(-o.w/2 + c*o.w/o.fan.cols, y1 + fanH/2, fanH);
    }
    /* Outer frame: full height of the opening, with a curved head. */
    const fw = t*1.4;
    [[0, yTop/2, fw, yTop],[o.w, yTop/2, fw, yTop],[o.w/2, 0, o.w, fw]]
      .forEach(([bx,by,bw,bh])=>{
        const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
        b.position.set(-o.w/2+bx, by, 0); bars.add(b);
      });
    if(o.arch > 0.02) bars.add(curvedBar(o.w, o.h, o.arch, fw, bm));
    else { const b=new THREE.Mesh(new THREE.PlaneGeometry(o.w, fw), bm);
           b.position.set(0, yTop, 0); bars.add(b); }

    /* Where a door has a solid base, carry the meeting stile down through it so
       the two leaves read as two leaves. */
    if(o.door){
      const b=new THREE.Mesh(new THREE.PlaneGeometry(t*1.3, o.door), bm);
      b.position.set(0, o.door/2, 0); bars.add(b);
    }
    /* The solid panel below the glass gets a recessed outline, unless the door
       is a plain one. */
    if(o.door && o.panel !== false){
      const inset = 0.09, pw = o.w/cols - 2*inset;
      for(let c=0;c<cols;c++){
        const cx = -o.w/2 + (c+0.5)*o.w/cols;
        const py0 = inset, py1 = y0 - inset, ph = py1 - py0;
        if(ph <= 0.05) continue;
        [[cx-pw/2, (py0+py1)/2, t*0.7, ph],[cx+pw/2, (py0+py1)/2, t*0.7, ph],
         [cx, py0, pw, t*0.7],[cx, py1, pw, t*0.7]].forEach(([bx,by,bw,bh])=>{
          const b=new THREE.Mesh(new THREE.PlaneGeometry(bw,bh), bm);
          b.position.set(bx, by, 0); bars.add(b);
        });
      }
    }
    bars.children.forEach(b=>b.renderOrder=4);
    m.add(bars);
  }
  volGroup.add(m);
});

