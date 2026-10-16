/* ---------- dónde está un puesto ----------
   Un puesto no lleva nombre de persona. Su código y su sitio los escribe el
   Book of Answers (voluntarios.json); lo que tiene al lado —una puerta, el
   bar, la carpa— se calcula del punto, por distancia, y no se escribe nunca.
   Así un puesto que se mueve cambia de descripción solo y nadie tiene que
   acordarse de corregirla. Decisión de Erick, 2026-09-11. */
const enPoligono = (x, z, poly) => {
  let c = false;
  for(let i = 0, n = poly.length; i < n; i++){
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % n];
    if(((z1 > z) !== (z2 > z)) && x < (x2 - x1) * (z - z1) / (z2 - z1) + x1) c = !c;
  }
  return c;
};
const zonaDe = (x, z) => { const q = D.zones.find(w => enPoligono(x, z, w.poly)); return q ? q.zid : null; };
/* La zona de un PUESTO no es la del polígono donde cae: el Book numera por la
   zona del capitán que lo cubre, y G va con la F. La puerta de Espai Vertical
   (F0) cae en el polígono de la E y el del overflow (D5) también, y los dos
   son de otra zona. Sin código —los de prueba— vale el polígono. */
const zonaDelPuesto = p => p.codigo ? (p.codigo[0] === 'G' ? 'F' : p.codigo[0]) : zonaDe(p.x, p.z);
const distPoligono = (x, z, poly) => {
  if(enPoligono(x, z, poly)) return 0;
  let d = Infinity;
  for(let i = 0, n = poly.length; i < n; i++){
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return d;
};
/* Cómo se llama una cosa, con lo que hay a esta altura del arranque: el
   nombre del recinto escrito a mano —el de la parte antes que el del edificio,
   que las dos mitades de Salvia son el Habitatge y Espai Vertical—, o el que
   trajo el trazo si no es un id. */
const noEsId = t => t && !/^[a-z][a-z0-9-]*$/.test(t) ? t : null;
const casaNombre = (id, of) => siteName(id, of || id) || noEsId(D.names[id]) || (of && noEsId(D.names[of])) || of || id;
/* Las huellas de verdad, una a una: un puesto se nombra por la parte que tiene
   al lado, no por el edificio entero. */
const CASAS = D.vols.filter(v => v.kind !== 'reference' && !/reference/.test(v.id));
/* Y un edificio con partes, por la parte que tiene más cerca el punto: Salvia
   solo tiene nombre por partes —el Habitatge y Espai Vertical— y la puerta de
   F0 salía como «b-salvia door», y el F1 de dentro como «b-salvia». */
function casaEn(b, x, z){
  const partes = CASAS.filter(v => v.of === b);
  if(!partes.length) return casaNombre(b);
  const v = partes.reduce((m, q) => distPoligono(x, z, m.poly) <= distPoligono(x, z, q.poly) ? m : q);
  return casaNombre(v.id, v.of);
}
function dondeEsta(p){
  const zona = zonaDelPuesto(p);
  if(p.sala){
    const f = D.floors.find(f => f.rooms.some(r => r.id === p.sala));
    const r = f && f.rooms.find(r => r.id === p.sala);
    const mk = MOZROOM[p.sala];
    return {zona, donde: f ? [casaEn(f.feat, p.x, p.z), f.name, r.name + (mk && mk.code ? ` (${mk.code})` : '')].join(' · ') : p.sala};
  }
  const cand = [];
  /* Una puerta se lleva 3 m de ventaja: un puesto junto a un edificio casi
     siempre está en su puerta, y «FC ESCACS door» dice más que «next to». */
  (D.entrances || []).forEach(e => cand.push({d: Math.hypot(p.x - e.x, p.z - e.z) - 3,
    txt: e.of ? `${casaEn(e.of, e.x, e.z)} door (${e.label})` : `${e.label} entrance`}));
  EVENT.forEach(it => { if(it.poly){ const mk = MOZROOM[it.id];
    cand.push({d: distPoligono(p.x, p.z, it.poly), txt: it.label + (mk && mk.code ? ` (${mk.code})` : '')}); } });
  D.blocks.forEach(b => { if(b.cls === 'area' && b.poly){ const mk = MOZROOM[b.id];
    cand.push({d: distPoligono(p.x, p.z, b.poly),
               txt: noEsId(D.names[b.id]) || (mk && mk.code ? `${mk.code} ${mk.nombre || ''}`.trim() : b.id)}); } });
  CASAS.forEach(v => cand.push({d: distPoligono(p.x, p.z, v.poly), txt: 'next to ' + casaNombre(v.id, v.of)}));
  cand.sort((a, b) => a.d - b.d);
  /* Un puesto de fuera metido en un volumen del montaje no se ve: la carpa es
     sólida y se lo traga. Pasó con los dos de la Open Source House, uno desde
     el día que se colocó, y desde el 3D no había forma de saberlo. */
  const tapado = EVENT.find(it => it.poly && it.h > 0 && enPoligono(p.x, p.z, it.poly));
  return {zona, enZona: !!zonaDe(p.x, p.z), tapado: tapado ? tapado.label : null,
          donde: cand.length ? cand[0].txt : ''};
}
/* Id nuevo: el código sin espacios y el primer número libre — E3-2,
   A0-Main-1. Varios puestos comparten código a propósito: el Book pone tres en
   la Open Source House y seis en el Main Stage, y el código dice DÓNDE y no
   QUIÉN. */
function idNuevo(codigo){
  const base = codigo.replace(/ /g, '-');
  let n = 1;
  while(PUESTOS.some(p => p.id === base + '-' + n)) n++;
  return base + '-' + n;
}

/* ---------- los puestos de fuera ----------
   En su propio grupo y no en volGroup, por dos motivos: se redibujan enteros
   cada vez que se coloca o se quita uno, y hay que dejarlos fuera de la fusión
   de lo estático — que se los llevaría a una sola malla y ya no habría figura
   que borrar. */
const crewGroup = new THREE.Group();
crewGroup.userData.noFundir = true;
scene.add(crewGroup);
/* El aro del pie: verde vivo y sin luz —MeshBasic—, para que resalte igual en
   los dos temas y desde arriba, que es donde la figura se queda en un punto.
   A 0,16 m: por encima del suelo (−0,05) y de las tintas de zona (0,12), que
   dos superficies en el mismo plano se turnan con el ángulo. Los radios los
   pidió Erick a ojo; los ajusta él viendo el resultado. */
const geoAro = new THREE.RingGeometry(0.55, 0.9, 40); geoAro.rotateX(-Math.PI/2);
/* Y su color es la prioridad del Book, con sus mismos tres colores: verde,
   mantenerlo cubierto; amarillo, cubrirlo si se puede; azul, se puede quedar
   vacío si faltan voluntarios. Sin prioridad —los de prueba—, verde. */
const aroDe = c => new THREE.MeshBasicMaterial({color:c, side:THREE.DoubleSide, depthWrite:false});
const matAro = aroDe(0x2BE36A);
const matAroPrio = {alta: matAro, media: aroDe(0xF2B705), baja: aroDe(0x2F9BEF)};
/* Los VC —los seis de acreditación, según la organización— llevan el aro del
   naranja del festival, el mismo que marca el espacio que ocupa MozFest. Aún
   no está claro qué significa VC; se distinguen igual, que es lo que Erick
   pidió el 2026-09-14. */
const matAroVC = aroDe(0xEF6C1F);
/* Lo que se toca: un cilindro invisible de 1,5 m de radio y la altura de la
   figura. La figura mide 19 cm y el aro empieza a 55 cm, y entre los dos hay
   un agujero por el que el dedo pasaba sin dar con nada. Era un disco en el
   suelo; visto de lado, un disco es una raya, y el rayo de un toque desde una
   cámara baja pasaba por encima. No se dibuja —visible:false no cuesta una
   llamada— pero el rayo sí lo ve. A vista de recinto sigue siendo un par de
   píxeles: para eso está la tolerancia en pantalla del clic, en seleccion.js. */
const geoBlanco = new THREE.CylinderGeometry(1.5, 1.5, 1.75, 16);
const matBlanco = new THREE.MeshBasicMaterial();
/* Lo que se ve de un puesto es el SITIO, tal cual lo dice el Book y tal cual se
   dice por radio —«Open Source House», «Food Village»—: the organisation, 16-oct,
   «volunteers should use the place names, not their station #s». El código
   del Book va detrás, en la línea de qué es. Donde varios comparten código y
   sitio se enseña una cuenta —«2 of 3», por orden en el archivo—; el
   correlativo del id es nuestro y no se enseña nunca. */
const nombreDelPuesto = p => p.nombre || p.codigo || p.id;
function cuentaDelPuesto(p){
  if(!p.codigo) return '';
  const iguales = PUESTOS.filter(q => q.codigo === p.codigo && q.nombre === p.nombre);
  return iguales.length > 1 ? `${iguales.indexOf(p) + 1} of ${iguales.length}` : '';
}
const PRIORIDAD = {alta: 'High priority', media: 'Medium priority', baja: 'Low priority'};
/* La línea de qué es: «Volunteer post E3 · 2 of 3 · Medium priority». Los del
   Main Stage dicen su equipo, porque no son de ningún capitán de zona. */
const tipoDelPuesto = p => [('Volunteer post ' + (p.codigo || '')).trim(), cuentaDelPuesto(p),
  PRIORIDAD[p.prioridad], p.equipo ? p.equipo + ' team' : '', p.vc ? 'VC' : ''].filter(Boolean).join(' \u00b7 ');
const dondeDelPuesto = w => (w.zona ? `Zone ${w.zona}` : 'Outside every zone') + (w.donde ? ` \u00b7 ${w.donde}` : '');
function pintarPuestos(){
  while(crewGroup.children.length) crewGroup.remove(crewGroup.children[0]);
  /* Los de la pasada anterior salen de picks, o el rayo seguiría dando con
     mallas que ya no están en la escena. */
  for(let i = picks.length - 1; i >= 0; i--) if(picks[i].userData.kind === 'puesto') picks.splice(i, 1);
  PUESTOS.filter(p => !p.sala).forEach(p=>{
    const g = figura(p.h || 1.75, matPuesto);
    g.position.set(p.x-CX, 0, p.z-CZ);
    const aro = new THREE.Mesh(geoAro, p.vc ? matAroVC : (matAroPrio[p.prioridad] || matAro));
    aro.position.y = 0.16; g.add(aro);
    const blanco = new THREE.Mesh(geoBlanco, matBlanco); blanco.position.y = 1.75/2; blanco.visible = false; g.add(blanco);
    /* Pulsable: cada pieza lleva los datos del puesto y la familia entera,
       para que la selección marque la figura y no sólo la cabeza. El aro y el
       blanco no se recolorean: son la marca, no la figura. */
    const fam = g.children.filter(c => c !== aro && c !== blanco);
    const w = dondeEsta(p);
    const u = {id:p.id, kind:'puesto', name:nombreDelPuesto(p), tipo:tipoDelPuesto(p), fam, vc: !!p.vc,
               donde: dondeDelPuesto(w)};
    g.userData = u;
    g.children.forEach(c => { c.userData = u; picks.push(c); });
    crewGroup.add(g);
  });
  /* Pulsables desde ya: el rayo lee matrixWorld, y eso sólo se actualiza al
     dibujar. Sin esto, arrastrar un puesto recién puesto antes del siguiente
     fotograma daba con nada y movía el recinto. */
  crewGroup.updateMatrixWorld(true);
  invalidate();
}
pintarPuestos();

