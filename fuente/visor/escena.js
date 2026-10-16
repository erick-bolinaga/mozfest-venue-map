/* ---------- scene ---------- */
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* Without this the renderer writes linear values straight to an sRGB screen,
   which lifts every midtone and is why the whole scene read as washed out. */
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

/* Two cameras, because 2D is a parallel projection and not the perspective one
   tipped over: under a plan, two rooms of the same size must measure the same
   on screen wherever they sit, and perspective cannot promise that. Which one
   is live is a variable, so the render loop and the picker follow along. */
const persp = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.5, 4000);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 6000);
let camera = persp;

/* site centre, so the model sits at the origin */
let X0=1e9,Z0=1e9,X1=-1e9,Z1=-1e9;
[...D.vols, ...D.blocks].forEach(v=>v.poly.forEach(p=>{X0=Math.min(X0,p[0]);X1=Math.max(X1,p[0]);
                                     Z0=Math.min(Z0,p[1]);Z1=Math.max(Z1,p[1]);}));
const CX=(X0+X1)/2, CZ=(Z0+Z1)/2, SPAN=Math.max(X1-X0, Z1-Z0);

const THEME = {
  dark:  { bg:0x15171B, ground:0x24272B, part:0x6E7684, roof:0x93472F, ctx:0x2B3038,
           brick:0xC6B3AA, salmon:0xA5705E, salmonPale:0xC2907C, bone:0xBFBAAC,
           cap:0x6C3324, zinc:0xA6AEB8,
           blk:0x39414D, blkLine:0x5C6675, open:0x2E4033, openLine:0x50705A,
           slab:0x8A93A2, key:0xFFF4E0, fill:0x38445C, hemi:0x223044 },
  light: { bg:0xE6E2D8, ground:0x6E6E6C, part:0xB3AC9D, roof:0xB85F42, ctx:0xC2BBAC,
           brick:0xFFF2EA, salmon:0xC98C77, salmonPale:0xDFB09E, bone:0xF0EADC,
           cap:0x8D4632, zinc:0xC3C9D0,
           blk:0xB6AE9B, blkLine:0x2E2A22, open:0xAFC0A8, openLine:0x25301F,
           slab:0x9A9282, key:0xFFFFFF, fill:0xC8D2E4, hemi:0xE4E0D6 }
};
let theme = THEME.dark;

/* A soft key. The contrast between a lit face and a shaded one comes from the
   ratio between this and the ambient terms, so the fill and hemisphere are
   kept high rather than the key kept low on its own. */
const key = new THREE.DirectionalLight(theme.key, 0.45);
key.position.set(-120, 190, 90);
key.castShadow = true;
key.shadow.mapSize.set(2048,2048);
key.shadow.radius = 4;
key.shadow.bias = -0.0006;
const d = SPAN*0.7;
Object.assign(key.shadow.camera, {left:-d, right:d, top:d, bottom:-d, near:1, far:900});
scene.add(key);
const fill = new THREE.DirectionalLight(theme.fill, .55); fill.position.set(140,80,-110); scene.add(fill);
const hemi = new THREE.HemisphereLight(theme.hemi, 0x4A4E56, .90); scene.add(hemi);

/* ---------- lighting per view ----------
   Seen from an angle, a long shadow reads as a shadow because you can see the
   height that cast it. Straight down that cue is gone and the same shadow reads
   as a second building lying beside the first. So the plan gets its own light:
   the key swings almost overhead, which shortens a 26 m building's shadow from
   about 20 m to under 6 m — a drop under the roof rather than a smear beside
   it — and the key-to-ambient ratio drops, because that ratio is what sets the
   contrast between a lit face and a shaded one, not the key on its own.

   Kept off the vertical by twelve degrees on purpose: a directional light
   pointing straight down leaves its shadow camera without a usable up vector,
   the same degeneracy that keeps the plan camera at 89 rather than 90. */
const LIGHTING = {
  '3d': {key:.45, hemi:.90, at:[-120, 190,  90]},
  '2d': {key:.26, hemi:1.20, at:[ -70, 400,  50]}
};
let lightMix = 0;                                   /* 0 = oblique, 1 = plan */
function applyLighting(){
  const a = LIGHTING['3d'], b = LIGHTING['2d'], m = lightMix;
  key.intensity  = a.key  + (b.key  - a.key ) * m;
  hemi.intensity = a.hemi + (b.hemi - a.hemi) * m;
  key.position.set(a.at[0] + (b.at[0]-a.at[0])*m,
                   a.at[1] + (b.at[1]-a.at[1])*m,
                   a.at[2] + (b.at[2]-a.at[2])*m);
}
applyLighting();

/* ---------- horizon ----------
   The ground has to dissolve, never end. A square ground plane ends: pull back
   and you see its four straight edges, because a fixed size in metres cannot
   keep up with a camera distance that is free to grow. Same reason the site
   used to wash out at full zoom-out — the model crossed a fog band that was
   also pinned to fixed world distances.

   So the disc rides with the camera and the fog band is measured from it. Two
   constraints keep it honest, and both are checked in the arithmetic below:
     the model never fogs      FOG_CLEAR > half-diagonal of the site (~0.7·SPAN)
     the rim never shows       GROUND_R  > DIST_MAX + fog.far(DIST_MAX)
     the rim stays in frustum  DIST_MAX + GROUND_R < camera.far (4000 m) */
const DIST_MIN  = SPAN*0.12;   // 42 m   how close the orbit may get
const DIST_MAX  = SPAN*2.5;    // 881 m  how far it may pull back
const FOG_CLEAR = SPAN*0.8;    // 282 m  fog-free shell around the camera
const FOG_DEPTH = SPAN*1.8;    // 634 m  how long the dissolve takes past it
const GROUND_R  = SPAN*8;      // 2818 m > DIST_MAX + 5.1·SPAN = 7.6·SPAN  ✓
                               //   and DIST_MAX + GROUND_R = 3699 m < 4000 ✓

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(GROUND_R, 96),
  new THREE.MeshStandardMaterial({color:theme.ground, roughness:1}));
ground.rotation.x = -Math.PI/2; ground.position.y = -0.05; ground.receiveShadow = true;
scene.add(ground);
scene.fog = new THREE.Fog(theme.bg, 1, 2);   // real distances come from applyCam

