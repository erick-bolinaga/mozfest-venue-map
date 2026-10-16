/* ---------- pitched roofs ----------
   The ridge follows the long axis of the volume's minimum-area rectangle, so
   it stays right even when the traced footprint is a slightly skewed quad. */
function minRect(poly){
  let best=null;
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const ang=Math.atan2(b[1]-a[1], b[0]-a[0]), c=Math.cos(-ang), s=Math.sin(-ang);
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    poly.forEach(p=>{ const X=p[0]*c-p[1]*s, Y=p[0]*s+p[1]*c;
      x0=Math.min(x0,X); x1=Math.max(x1,X); y0=Math.min(y0,Y); y1=Math.max(y1,Y); });
    const w=x1-x0, hh=y1-y0;
    if(!best || w*hh<best.area) best={area:w*hh, ang, w, h:hh, cx:(x0+x1)/2, cy:(y0+y1)/2};
  }
  const c=Math.cos(best.ang), s=Math.sin(best.ang);
  const cx = best.cx*c - best.cy*s, cy = best.cx*s + best.cy*c;   // back to world
  let u=[c,s], v=[-s,c], a=best.w/2, b=best.h/2;
  if(a<b){ [u,v]=[v,u]; [a,b]=[b,a]; }        // u is always the long axis
  return {c:[cx,cy], u, v, a, b};
}
/* A hip roof is a gable with the ridge pulled in from both ends, so the short
   sides slope too. inset = 0 gives a plain gable. */
/* A shed roof: the top face tilts from yLow on the side facing `toward` up to
   yHigh on the opposite side. Repeated along a row these read as a sawtooth. */
/* Near-duplicate vertices make the triangulator emit NaN, and traced outlines
   are full of them: Viola alone has two 2 cm edges. */
function clean(poly, eps=0.03){
  const out=[];
  for(const p of poly){
    const q=out[out.length-1];
    if(!q || Math.hypot(p[0]-q[0], p[1]-q[1]) > eps) out.push(p);
  }
  while(out.length>2 && Math.hypot(out[0][0]-out[out.length-1][0],
                                  out[0][1]-out[out.length-1][1]) <= eps) out.pop();
  return out;
}
function shedRoof(rawPoly, yLow, yHigh, toward, slope){
  const poly = clean(rawPoly);
  if(poly.length < 3) return null;
  const r = minRect(poly);
  const alongLong = slope === 'long';
  const ax = alongLong ? r.u : r.v;
  const half = alongLong ? r.a : r.b;
  const tx = toward[0]-r.c[0], tz = toward[1]-r.c[1];
  /* Convention: the LOW eave is on the far side from `toward`, so the height
     grows as you move towards it. */
  const sgn = (tx*ax[0]+tz*ax[1]) > 0 ? 1 : -1;
  const span = Math.max(0.01, 2*half);
  const hOf = (x,z) => {
    const t = ((x-r.c[0])*ax[0] + (z-r.c[1])*ax[1]) * sgn;   // -half .. +half
    const k = Math.min(1, Math.max(0, (t + half) / span));
    return yLow + (yHigh - yLow) * k;
  };

  const tris = [];
  /* top surface: triangulate the outline, then lift each vertex onto the slope */
  const flat = new THREE.ShapeGeometry(shapeOf(poly));
  const pos = flat.attributes.position;
  /* ShapeGeometry is indexed: the triangles live in the index buffer, not in
     the order of the vertices. Reading the positions three at a time drops most
     of the surface and asks for vertices that are not there. */
  const idx = flat.index ? flat.index.array : null;
  const count = idx ? idx.length : pos.count;
  const vi = k => idx ? idx[k] : k;
  for(let i=0;i+2<count;i+=3){
    const t=[];
    for(let k=0;k<3;k++){
      const j=vi(i+k);
      const X=pos.getX(j), Z=pos.getY(j);              // shapeOf put z into y
      t.push([X, hOf(X+CX, Z+CZ), Z]);
    }
    tris.push(t[0],t[2],t[1]);
  }
  /* the wall strip between the flat top of the volume and the sloping roof */
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const ax0=a[0]-CX, az0=a[1]-CZ, bx0=b[0]-CX, bz0=b[1]-CZ;
    if(Math.hypot(bx0-ax0, bz0-az0) < 0.05) continue;
    const ha=hOf(a[0],a[1]), hb=hOf(b[0],b[1]);
    const A0=[ax0,yLow,az0], B0=[bx0,yLow,bz0], A1=[ax0,ha,az0], B1=[bx0,hb,bz0];
    tris.push(A0,B0,B1, A0,B1,A1);
  }
  const safe=[];
  for(let i=0;i<tris.length;i+=3){
    if(tris.slice(i,i+3).every(p=>p.every(Number.isFinite))) safe.push(...tris.slice(i,i+3));
  }
  if(!safe.length) return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(safe.flat(), 3));
  g.computeVertexNormals();
  return g;
}

/* A pitched roof is a ruled surface between the eaves and a ridge segment: each
   edge of the outline rises to whatever part of the ridge it faces. Splitting
   the outline along the ridge line instead left a hip roof with no vertex at
   the ridge at all, so it came out flat. */
/* Ruled from the eaves to the ridge, this only tiles a convex outline: on a
   plan with a notch — the nave has one where the tower sits — it leaves the
   roof open and throws out stray triangles. The hull closes the notch, which is
   what a roof does anyway. */
/* A true perpendicular offset. Scaling about the centroid moves the corners but
   barely shifts the long edges, which is why the block stayed inside the walls
   and only showed through the window holes. */
function offsetPolygon(P, d){
  const n=P.length;
  let area=0;
  for(let i=0;i<n;i++) area += P[i][0]*P[(i+1)%n][1] - P[(i+1)%n][0]*P[i][1];
  const sgn = area > 0 ? 1 : -1;
  const lines=[];
  for(let i=0;i<n;i++){
    const a=P[i], b=P[(i+1)%n];
    const dx=b[0]-a[0], dz=b[1]-a[1], L=Math.hypot(dx,dz)||1;
    const nx=(dz/L)*sgn, nz=(-dx/L)*sgn;
    lines.push([a[0]+nx*d, a[1]+nz*d, dx/L, dz/L]);
  }
  const out=[];
  for(let i=0;i<n;i++){
    const p=lines[(i-1+n)%n], q=lines[i];
    const den = p[2]*q[3] - p[3]*q[2];
    if(Math.abs(den) < 1e-6){ out.push([q[0], q[1]]); continue; }
    const t = ((q[0]-p[0])*q[3] - (q[1]-p[1])*q[2]) / den;
    out.push([p[0]+p[2]*t, p[1]+p[3]*t]);
  }
  return out;
}
function convexHull(P){
  const p=[...P].sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  if(p.length<3) return P;
  const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[], up=[];
  for(const q of p){ while(lo.length>=2 && cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop(); lo.push(q); }
  for(let i=p.length-1;i>=0;i--){ const q=p[i];
    while(up.length>=2 && cr(up[up.length-2],up[up.length-1],q)<=0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function pitchedRoof(rawPoly, y, rise, hip, skipEdges, gableToward, hipInset){
  const src = clean(rawPoly);
  const poly = convexHull(src);
  if(poly.length < 3) return null;
  const r = minRect(poly);
  /* A half-hip: hipped at one end, gabled where it meets the neighbouring
     block, so the ridge runs right out to that wall. */
  /* A full hip pulls the ridge back by the half-width, which gives the 45°
     end. A fraction under one keeps the ridge closer to the wall. */
  const inset = hip ? r.b*(hipInset === undefined ? 1 : hipInset) : 0;
  let e0 = r.a - inset, e1 = r.a - inset;
  if(gableToward){
    const d = (gableToward[0]-r.c[0])*r.u[0] + (gableToward[1]-r.c[1])*r.u[1];
    if(d > 0) e1 = r.a; else e0 = r.a;
  }
  const R0 = [r.c[0]-r.u[0]*e0, r.c[1]-r.u[1]*e0];
  const R1 = [r.c[0]+r.u[0]*e1, r.c[1]+r.u[1]*e1];
  const half = Math.max(e0, e1);
  const span = Math.hypot(R1[0]-R0[0], R1[1]-R0[1]);
  const onRidge = p => {
    if(span < 1e-6) return R0;
    const t = ((p[0]-R0[0])*r.u[0] + (p[1]-R0[1])*r.u[1]) / span;
    const k = Math.min(1, Math.max(0, t));
    return [R0[0]+(R1[0]-R0[0])*k, R0[1]+(R1[1]-R0[1])*k];
  };
  const V = (p,h) => [p[0]-CX, h, p[1]-CZ];
  const tris=[];
  const skipMid = [];
  if(skipEdges && skipEdges.size){
    skipEdges.forEach(i=>{
      const a=src[i%src.length], b=src[(i+1)%src.length];
      skipMid.push([(a[0]+b[0])/2, (a[1]+b[1])/2]);
    });
  }
  for(let i=0;i<poly.length;i++){
    /* A face whose wall carries its own gable profile already draws that
       triangle; drawing it again buries whatever is cut into the wall. The hull
       renumbers the edges, so they are matched by where they sit. */
    const ma=poly[i], mb=poly[(i+1)%poly.length];
    const mm=[(ma[0]+mb[0])/2,(ma[1]+mb[1])/2];
    if(skipMid.some(s=>Math.hypot(s[0]-mm[0], s[1]-mm[1]) < 0.5)) continue;
    const A=poly[i], B=poly[(i+1)%poly.length];
    if(Math.hypot(B[0]-A[0], B[1]-A[1]) < 0.05) continue;
    const PA=onRidge(A), PB=onRidge(B);
    const a0=V(A,y), b0=V(B,y), a1=V(PA,y+rise), b1=V(PB,y+rise);
    if(Math.hypot(PA[0]-PB[0], PA[1]-PB[1]) < 1e-6) tris.push(a0,b0,a1);
    else tris.push(a0,b0,b1, a0,b1,a1);
  }
  const safe=[];
  for(let i=0;i<tris.length;i+=3)
    if(tris.slice(i,i+3).every(p=>p.every(Number.isFinite))) safe.push(...tris.slice(i,i+3));
  if(!safe.length) return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(safe.flat(), 3));
  g.computeVertexNormals();
  return g;
}
const gableRoof = (poly, y, rise, hip, skip, gt, hi) => pitchedRoof(poly, y, rise, hip, skip, gt, hi);

const matReveal = new THREE.MeshStandardMaterial({color:0x07090C, roughness:.95,
  side:THREE.DoubleSide});
const REVEAL = 0.22;                        // how far back the dark face sits

