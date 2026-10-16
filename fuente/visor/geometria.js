/* ---------- geometry ---------- */
const shapeOf = (poly, holes=[]) => {
  const s = new THREE.Shape();
  poly.forEach((p,i)=>{ const x=p[0]-CX, z=p[1]-CZ;
    i ? s.lineTo(x,z) : s.moveTo(x,z); });
  s.closePath();
  holes.forEach(h=>{ const hp=new THREE.Path();
    h.forEach((p,i)=>{ const x=p[0]-CX, z=p[1]-CZ; i?hp.lineTo(x,z):hp.moveTo(x,z); });
    hp.closePath(); s.holes.push(hp); });
  return s;
};
/* Shapes are built in XZ then rotated flat, so extrusion depth becomes height. */
function prism(poly, h, base, holes){
  const g = new THREE.ExtrudeGeometry(shapeOf(poly,holes), {depth:h, bevelEnabled:false});
  g.rotateX(Math.PI/2); g.translate(0, h+base, 0);
  g.computeVertexNormals();
  return g;
}

const volGroup = new THREE.Group(), ctxGroup = new THREE.Group(), blkGroup = new THREE.Group(),
      zoneGroup = new THREE.Group(),
      festGroup = new THREE.Group();
scene.add(volGroup, ctxGroup, blkGroup, zoneGroup, festGroup);

/* City blocks and open ground are painted flat. Extruding them would read as
   buildings, which is exactly the confusion they are meant to prevent. */
/* Flat fills alone vanish against the ground plane, so each one also gets an
   outline. Unlit materials keep them readable from any camera angle. */
const matBlk  = new THREE.MeshBasicMaterial({color:theme.blk});
const matOpen = new THREE.MeshBasicMaterial({color:theme.open});
const lineBlk = new THREE.LineBasicMaterial({color:theme.blkLine});
const lineOpen= new THREE.LineBasicMaterial({color:theme.openLine});
function ring(poly, y){
  const pts = poly.map(p=>new THREE.Vector3(p[0]-CX, y, p[1]-CZ));
  pts.push(pts[0].clone());
  return new THREE.BufferGeometry().setFromPoints(pts);
}
D.blocks.forEach(b=>{
  const isBlk = b.cls==='block', y = isBlk ? 0.04 : 0.09;
  const g = new THREE.ShapeGeometry(shapeOf(b.poly));
  g.rotateX(Math.PI/2); g.translate(0, y, 0);
  const m = new THREE.Mesh(g, isBlk?matBlk:matOpen);
  m.userData = {id:b.id, kind:'flat'};
  blkGroup.add(m);
  blkGroup.add(new THREE.Line(ring(b.poly, y+0.02), isBlk?lineBlk:lineOpen));
});

/* Four shared materials, no per-mesh clones: a clone would never hear about a
   theme change, which is exactly how the roofs ended up stuck on one colour. */
const matPart = new THREE.MeshStandardMaterial({color:theme.part, roughness:.85, metalness:.02});
const matCtx  = new THREE.MeshStandardMaterial({color:theme.ctx,  roughness:1, transparent:true, opacity:.95});
/* Roofs take their own tone. With the light this soft, a pitched surface in the
   same colour as the wall below reads as flat — and the two kinds of roof here
   are not the same material anyway: a pitched roof is rasilla, fired from much
   the same clay as the brick and so a shade lighter and redder, while a flat
   one is a deck and sits a shade darker than the wall it caps. */
const matPartRoof = new THREE.MeshStandardMaterial({color:theme.roof, roughness:.9, side:THREE.DoubleSide});
const matCtxRoof  = new THREE.MeshStandardMaterial({color:theme.ctx,  roughness:1, transparent:true, opacity:.95, side:THREE.DoubleSide});
const matWallTwoSided = new THREE.MeshStandardMaterial({color:theme.part, roughness:.85, metalness:.02, side:THREE.DoubleSide});
/* A flat colour reads as render, and nearly every building on this site is
   faced in exposed brick. The pattern is drawn here rather than fetched: a
   photograph of a facade would be hundreds of kilobytes and a request over a
   network this file is built to do without.

   It carries no colour of its own — white brick on darker mortar — so the
   wall's themed colour multiplies straight through it and the theme switch
   needs no new code at all.

   The panels are built in wall-local metres and ShapeGeometry hands those
   coordinates on as UVs, so a repeat here is a real course: 215 mm bricks,
   65 mm high, with 10 mm joints. */
const BRICK_W = 0.225, BRICK_H = 0.075;        /* brick plus its joint */
function brickTexture(){
  const cols = 2, rows = 2, PX = 96;
  const c = document.createElement('canvas');
  c.width  = cols * PX;
  c.height = Math.round(rows * PX * BRICK_H / BRICK_W);
  const x = c.getContext('2d'), w = c.width / cols, h = c.height / rows;
  /* The colour lives in the texture, not in the material. Mortar is paler than
     the brick it holds, and a material tint can only ever darken, so a grey
     pattern multiplied by a red wall would give dark red joints — the one thing
     brickwork never looks like. What the theme supplies is a tint over this. */
  x.fillStyle = '#c9c0b6'; x.fillRect(0, 0, c.width, c.height);       /* mortar */
  const joint = Math.max(1, Math.round(h * .14));
  for(let r = 0; r < rows; r++){
    /* One tone per brick, fixed per column so the brick split across the tile
       edge gets the same tone on both sides and the seam does not show. */
    const tone = [...Array(cols)].map(()=> 0.88 + Math.random()*0.24);
    const off  = (r % 2) ? w / 2 : 0;
    for(let i = -1; i <= cols; i++){
      const k = tone[((i % cols) + cols) % cols];
      x.fillStyle = `rgb(${Math.round(166*k)},${Math.round(86*k)},${Math.round(66*k)})`;
      x.fillRect(i*w + off + joint/2, r*h + joint/2, w - joint, h - joint);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / (cols * BRICK_W), 1 / (rows * BRICK_H));
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.encoding = THREE.sRGBEncoding;
  return t;
}
const brick = brickTexture();
matPart.map = brick;          matPart.color.set(theme.brick);
matWallTwoSided.map = brick;  matWallTwoSided.color.set(theme.brick);

/* Not all of it is brick. The back of Àster is rendered and painted salmon,
   Espai Vertical is a paler shade of the same, and the library is bone white.
   Keyed by volume rather than by building, because two of these sit alongside
   brick halves of their own building. */
const paint = c => new THREE.MeshStandardMaterial({color:c, roughness:.9, metalness:.02,
                                                   side:THREE.DoubleSide});
const matSalmon = paint(theme.salmon), matSalmonPale = paint(theme.salmonPale),
      matBone   = paint(theme.bone);
/* La marquesina de Can Fontanet es chapa, no obra: lisa y metálica, lo único
   del recinto que devuelve el cielo en vez de absorberlo. Va aquí y no en un
   mapa de cubiertas aparte porque no tiene muros trazados — es una losa de 22
   cm que se dibuja como un prisma de una pieza, así que su material es el del
   volumen entero, cantos incluidos. Que los cantos también sean chapa es lo
   correcto: una marquesina metálica lo es por los cuatro lados. */
/* Poco metalness, y no mucho, aunque suene al revés. Un material metálico
   refleja el entorno y no tiene color difuso propio; esta escena no tiene mapa
   de entorno —sólo dos direccionales y una hemisférica— así que con
   metalness .8 no había nada que reflejar y la marquesina salía casi negra.
   Lo que aquí lee como chapa es la rugosidad baja, que da un brillo limpio, y
   un gris ligeramente frío. */
const matZinc = new THREE.MeshStandardMaterial({color:theme.zinc, roughness:.22, metalness:.25,
                                                side:THREE.DoubleSide});
const PAINTED = {'p-b-aster-nau': matSalmon,
                 'p-b-aster-tower': matSalmon,
                 'p-b-salvia-espai-vertical': matSalmonPale,
                 'b-camamilla': matBone,
                 'p-b-lobby-hall-can-fontanet-canopy': matZinc};
/* The cap closes the top of a volume, so on a flat-roofed building it is the
   roof. Brick belongs on what stands up, not on what you walk on, so the cap
   keeps its own plain material. */
/* El tapa cede la profundidad. Hay 45 pares de volúmenes en el modelo cuyas
   tapas caen exactamente a la misma altura y cuyas huellas se solapan —partes
   de un mismo edificio, más el engorde de 30 cm que cierra las juntas— y dos
   superficies en el mismo plano se pelean por quién se dibuja delante: la que
   gana cambia con el ángulo y con el zoom, y eso parpadea.

   Casi ninguno se veía porque los dos lados compartían material, y una pelea
   entre dos superficies idénticas es invisible. La marquesina de Can Fontanet
   la destapó en cuanto pasó a chapa contra este rojizo.

   La regla es la que dice la construcción: un tapa es la lámina que cierra un
   volumen, y lo que aparezca a esa misma altura está apoyado ENCIMA. Así que
   el tapa se retira un pelo en profundidad y deja ganar al otro, siempre y en
   todos los casos, sin tocar la geometría. */
const matCap = new THREE.MeshStandardMaterial({color:theme.cap, roughness:.9, metalness:.02,
                                               side:THREE.DoubleSide,
                                               polygonOffset:true,
                                               polygonOffsetFactor:1, polygonOffsetUnits:1});

const THEMED = [[matPart,'brick'],[matWallTwoSided,'brick'],[matCap,'cap'],[matPartRoof,'roof'],
                [matZinc,'zinc'],
                [matSalmon,'salmon'],[matSalmonPale,'salmonPale'],[matBone,'bone'],
                [matCtx,'ctx'],[matCtxRoof,'ctx']];
/* Selection uses the festival's own three colours: yellow for the building,
   orange for the part the festival actually occupies, blue for a landmark
   that is only there to help you place yourself. */
const mk = (c,e) => new THREE.MeshStandardMaterial({color:c, emissive:e,
  roughness:.6, side:THREE.DoubleSide});
const matSel     = mk(0xF5E31A, 0x3A3405);
const matSelFest = mk(0xEF6C1F, 0x3A1B06);
const matSelRef  = mk(0x7FE0F0, 0x123338);
const edgeMat = new THREE.LineBasicMaterial({color:0x000000, transparent:true, opacity:.28});

