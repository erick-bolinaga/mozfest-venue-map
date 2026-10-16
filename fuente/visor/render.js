/* ---------- fundir lo estático ---------- */
/* La separación que de verdad importa en este visor no es en qué archivo vive
   cada cosa: es cuáles se mueven y cuáles no.

   El recinto se dibujaba con 7.881 mallas y 7.524 llamadas de dibujo por
   fotograma, para 64.136 triángulos. Ocho triángulos por llamada. Los
   triángulos no son el problema; el problema es pedir 7.524 veces que se
   dibuje, y ese coste lo paga la CPU, no la tarjeta. Casi todas eran barrotes
   de carpintería: cada montante y cada travesaño de los 787 huecos era su
   propia malla.

   Y ninguno de ellos cambia nunca. Así que la línea se puede trazar sin
   inventar nada: **es estático lo que nadie puede pulsar y nadie recolorea**.
   Eso son `picks` y las familias de GROUP; todo lo demás se puede hornear en
   una sola geometría por material.

   Se funde DENTRO de cada grupo de primer nivel y no en la raíz de la escena,
   porque zoneGroup se apaga entero y sacarle los hijos le quitaría el
   interruptor. Y se hornea en el espacio local de ese grupo —no en
   el del mundo— para que un grupo con transformación no la aplique dos veces. */
function concatenar(geos){
  let n = 0;
  for(const g of geos) n += g.attributes.position.count;
  const conUV = geos.every(g => g.attributes.uv);
  const pos = new Float32Array(n*3), nor = new Float32Array(n*3);
  const uv  = conUV ? new Float32Array(n*2) : null;
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
function fundirEstatico(){
  scene.updateMatrixWorld(true);
  const intocable = new Set(picks);
  Object.values(GROUP).forEach(fam => fam.forEach(m => intocable.add(m)));
  intocable.add(ground);

  const raiz = o => { let p = o; while(p.parent && p.parent !== scene) p = p.parent; return p; };
  const lotes = new Map();
  scene.traverse(o => {
    /* Una malla instanciada ya es una sola llamada de dibujo, y una con varios
       materiales necesitaría grupos por material: ni una ni otra ganan aquí. */
    if(!o.isMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
    if(intocable.has(o)) return;
    const anc = raiz(o);
    if(anc === o) return;                    /* ya cuelga de la escena, nada que juntar */
    /* Un grupo puede declararse fuera: los puestos de voluntario se redibujan
       enteros al colocar uno, y fundidos no habría figura que quitar. */
    if(anc.userData && anc.userData.noFundir) return;
    const k = [anc.uuid, o.material.uuid, o.renderOrder, o.castShadow?1:0, o.receiveShadow?1:0].join('|');
    let l = lotes.get(k);
    if(!l) lotes.set(k, l = {anc, mat:o.material, orden:o.renderOrder,
                             sombra:o.castShadow, recibe:o.receiveShadow, ms:[]});
    l.ms.push(o);
  });

  let antes = 0, despues = 0;
  const inv = new THREE.Matrix4(), m4 = new THREE.Matrix4();
  lotes.forEach(l => {
    antes += l.ms.length;
    if(l.ms.length < 2){ despues += l.ms.length; return; }   /* una sola no gana nada */
    inv.copy(l.anc.matrixWorld).invert();
    const geos = l.ms.map(m => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      return g.applyMatrix4(m4.multiplyMatrices(inv, m.matrixWorld));
    });
    const fundida = new THREE.Mesh(concatenar(geos), l.mat);
    fundida.renderOrder = l.orden;
    fundida.castShadow = l.sombra; fundida.receiveShadow = l.recibe;
    /* Las geometrías intermedias ya están copiadas; las originales NO se tocan,
       porque varias mallas comparten geometría y liberar una rompería el resto. */
    geos.forEach(g => g.dispose());
    l.ms.forEach(m => m.parent && m.parent.remove(m));
    l.anc.add(fundida);
    despues += 1;
  });
  return {antes, despues};
}
const FUNDIDO = fundirEstatico();

runIntro();

scene.background = new THREE.Color(theme.bg);

/* ---------- se dibuja cuando hay algo que dibujar ---------- */
/* El bucle redibujaba el recinto entero sesenta veces por segundo, hubiera
   cambiado algo o no, y siguiera la ventana a la vista o minimizada. Con 7.881
   mallas eso son unas 7.500 llamadas de dibujo por fotograma para 64.000
   triángulos —ocho triángulos por llamada— y ese coste no lo paga la tarjeta
   gráfica, lo paga la CPU pidiéndolas una a una. De ahí el 60% con la ventana
   minimizada.

   Ahora se marca la escena como sucia cuando algo la cambia de verdad: la
   cámara, la selección, el tema o el tamaño de la ventana. Una animación de
   cámara pasa por applyCam en cada paso, así que se mantiene sola.

   Si algún día algo cambia la escena y no se ve hasta que tocas la vista,
   falta una llamada a invalidate() ahí; no es que el bucle esté roto. */
/* Con var y no con let por lo mismo que tipMesh: applyCam() corre en el
   arranque, mil líneas antes de aquí, y una let seguiría en su zona muerta. */
var sucia = true;
function invalidate(){ sucia = true; }
/* Minimizada o en otra pestaña no hay nada que enseñar. rAF suele frenarse
   solo, pero no siempre, y esto no depende de que lo haga. */
document.addEventListener('visibilitychange', invalidate);
(function loop(){
  requestAnimationFrame(loop);
  if(document.hidden) return;
  stepCam();
  if(!sucia) return;
  sucia = false;
  renderer.render(scene, camera);
})();
