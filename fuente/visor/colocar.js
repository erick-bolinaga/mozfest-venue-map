/* ---------- colocar voluntarios ----------
   Colocar es de ojo y de plano; guardarlo es de git. Aquí se coloca y se copia;
   lo que existe de verdad es lo que esté pegado en fuente/voluntarios.json.

   Se coloca SIEMPRE sobre un plano, nunca sobre el 3D: el mapa en 2D para lo
   de fuera —que por convenio está a nivel del suelo del recinto— y el plano de
   la planta para lo de dentro. Decisión de Erick, y quita de en medio la
   pregunta difícil: en 3D un clic sobre un tejado no dice a qué nivel apunta.

   Todo esto EXISTE sólo para el organizador. Para los demás se quita del DOM,
   no se oculta: una lista de puestos que se puede leer sin poder tocarla no es
   media función, es una filtración. */
var colocando = false;
function colocarEn(){}                 /* la de verdad se define abajo si procede */
{
  const fila = $('#crewBtn'), pop = $('#crew');
  if(!atLeast('organizador')){
    if(fila) fila.remove();
    if(pop) pop.remove();
  } else {
    const BORRADOR = 'mozfest-puestos';
    const DEL_ARCHIVO = PUESTOS.length;
    let hayBorrador = false;
    try{
      const g = localStorage.getItem(BORRADOR);
      if(g){
        const d = JSON.parse(g);
        if(Array.isArray(d)){ PUESTOS.length = 0; PUESTOS.push(...d); hayBorrador = true; }
      }
    }catch(_){}

    /* El borrador vive en este navegador y el archivo en el repositorio. Que
       exista uno se DICE, en vez de dejar que el visor enseñe en silencio algo
       que no está en ningún sitio. */
    const guardar = ()=>{
      try{ localStorage.setItem(BORRADOR, JSON.stringify(PUESTOS)); }catch(_){}
      hayBorrador = true;
    };
    /* Lo que se guarda: lo que dice el Book —código, sitio, prioridad y, en
       los del Main Stage, el equipo—, la sala si es de dentro, y el punto. Nada
       más. Y se entrega el ARCHIVO entero, con sus notas, para que quien
       coloque lo mande tal cual y ese archivo sea fuente/voluntarios.json sin
       pegar nada dentro de nada. */
    const paraArchivo = () => PUESTOS.map(p => Object.assign(
      {id:p.id, codigo:p.codigo, nombre:p.nombre, prioridad:p.prioridad},
      p.equipo ? {equipo:p.equipo} : {}, p.sala ? {sala:p.sala} : {}, {x:p.x, z:p.z},
      p.vc ? {vc:true} : {}));
    const archivo = () => JSON.stringify({_leeme: PUESTOS_LEEME, puestos: paraArchivo()}, null, 2) + '\n';

    /* Mover: el punto nuevo, y la sala si viene del plano. El código no
       cambia: desde el 16-oct lo dice el Book y no el sitio, y un puesto que
       se corre un metro sigue siendo el mismo puesto. */
    alMover = (id, x, z, sala)=>{
      const p = PUESTOS.find(q => q.id === id);
      if(!p) return;
      p.x = +x.toFixed(2); p.z = +z.toFixed(2);
      if(sala) p.sala = sala;
      guardar(); pintarPuestos(); retab(); pintarLista();
    };
    /* Arrastrar un puesto sobre el plano de la planta. La sala es la que queda
       debajo al soltar; fuera de toda sala, vuelve a donde estaba. */
    card.addEventListener('pointerdown', e=>{
      if(!colocando || e.button !== 0) return;
      const g = e.target.closest('.plan-crew'), svg = g && g.closest('svg');
      if(!svg) return;
      e.preventDefault();
      const id = g.dataset.puesto, circulos = g.querySelectorAll('circle');
      const a = +svg.dataset.turn, o = svg.dataset.origin.split(' ').map(Number);
      const c = Math.cos(-a), sn = Math.sin(-a);
      let ultimo = null;
      g.classList.add('arrastrando');
      try{ svg.setPointerCapture(e.pointerId); }catch(_){}
      const mueve = ev=>{
        const q = planAt(svg, ev.clientX, ev.clientY);
        if(!q) return;
        const f = planTurn([q.x, q.z], c, sn, o[0], o[1]);
        circulos.forEach(ci => { ci.setAttribute('cx', f[0].toFixed(2)); ci.setAttribute('cy', f[1].toFixed(2)); });
        ultimo = {q, cx: ev.clientX, cy: ev.clientY};
      };
      const suelta = ()=>{
        ['pointermove','pointerup','pointercancel'].forEach((t, i) => svg.removeEventListener(t, i ? suelta : mueve));
        /* Se mira qué hay debajo ANTES de devolverle los pointer-events a la
           marca: si no, lo que hay debajo es la marca, y nunca una sala. */
        const bajo = ultimo && document.elementFromPoint(ultimo.cx, ultimo.cy);
        g.classList.remove('arrastrando');
        if(!ultimo) return;
        planArrastre = true;                 /* el clic que sigue no elige sala */
        const sala = bajo && bajo.closest('[data-room]');
        if(sala) alMover(id, ultimo.q.x, ultimo.q.z, sala.dataset.room);
        else retab();
      };
      svg.addEventListener('pointermove', mueve);
      svg.addEventListener('pointerup', suelta);
      svg.addEventListener('pointercancel', suelta);
    });

    /* Uno nuevo pregunta su código, porque el punto ya no lo dice. Se
       propone el del puesto más cercano, que es lo normal —otro más en la Open
       Source House—, y si el código ya existe se copian su sitio, su prioridad
       y su equipo; solo uno nuevo pregunta también eso. Lo que no vale lo dice
       y no coloca nada: callarse sería la peor respuesta. */
    const PRIOS = {high:'alta', medium:'media', low:'baja'};
    colocarEn = (x, z, sala)=>{
      const cerca = PUESTOS.filter(q => !!q.sala === !!sala && q.codigo)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      const codigo = (prompt('Station code, as the Book of Answers writes it (E3, A0 Main):',
                             cerca ? cerca.codigo : (zonaDe(x, z) || '')) || '').trim();
      if(!codigo) return;
      if(!/^[A-G]\d+( [A-Z][a-z]+)?$/.test(codigo)){
        alert(`Not placed: "${codigo}" is not a station code like E3 or A0 Main.`); return;
      }
      const igual = PUESTOS.find(q => q.codigo === codigo);
      const nombre = igual ? igual.nombre
        : (prompt(`Place for ${codigo}, as the Book describes it (said on the radio):`) || '').trim();
      if(!nombre) return;
      const prioridad = igual ? igual.prioridad
        : PRIOS[(prompt(`Priority of ${codigo} in the Book: high, medium or low`, 'high') || '').trim().toLowerCase()];
      if(!prioridad){ alert('Not placed: the priority is high, medium or low.'); return; }
      const p = Object.assign({id:idNuevo(codigo), codigo, nombre, prioridad},
                              igual && igual.equipo ? {equipo:igual.equipo} : {},
                              {x:+x.toFixed(2), z:+z.toFixed(2)});
      if(sala) p.sala = sala;
      PUESTOS.push(p);
      guardar(); pintarPuestos(); retab(); pintarLista();
    };

    function pintarLista(){
      const lista = $('#crewList');
      const dentro = PUESTOS.filter(p => p.sala).length;
      $('#crewSummary').textContent = PUESTOS.length
        ? `${PUESTOS.length} placed \u00b7 ${dentro} inside` : 'Nothing placed yet';
      if(!PUESTOS.length){
        lista.innerHTML = '';
      } else {
        lista.innerHTML = PUESTOS.map(p => {
          const w = dondeEsta(p);
          const cod = p.codigo || p.id, cuenta = cuentaDelPuesto(p);
          const nombre = [cod, nombreDelPuesto(p), cuenta].filter(Boolean).join(' ');
          const donde = (w.tapado ? `Hidden inside ${w.tapado} \u2014 move it out \u00b7 ` : '')
                      + (w.enZona ? '' : 'Outside every zone \u2014 move it \u00b7 ')
                      + nombreDelPuesto(p) + ' \u00b7 ' + w.donde;
          return `<div class="crew-row" data-p="${esc(p.id)}">` +
            `<span class="codigo${w.enZona && !w.tapado ? '' : ' sinzona'}">${esc(cod)}` +
              (cuenta ? `<span class="cuenta">${esc(cuenta)}</span>` : '') + `</span>` +
            (p.vc ? `<span class="vc" title="VC, as the organisation calls them">VC</span>` : '') +
            `<span class="donde" title="${esc(donde)}">${esc(donde)}</span>` +
            `<button data-quitar="${esc(p.id)}" aria-label="Remove ${esc(nombre)}">\u00D7</button>` +
            `</div>`; }).join('');
      }
      const aviso = hayBorrador
        ? `<p class="crew-hint">${PUESTOS.length} placed \u00b7 draft in this browser, ` +
          `${DEL_ARCHIVO} in voluntarios.json. <button id="crewTirar" ` +
          `style="background:none;border:0;color:var(--moz);font:inherit;cursor:pointer;padding:0">` +
          `Discard draft</button></p>` : '';
      lista.insertAdjacentHTML('beforeend', aviso);
      $('#crewJson').textContent = archivo();
    }

    $('#crewList').addEventListener('click', e=>{
      const q = e.target.closest('[data-quitar]');
      if(q){
        const i = PUESTOS.findIndex(x => x.id === q.dataset.quitar);
        if(i >= 0){ PUESTOS.splice(i,1); guardar(); pintarPuestos(); retab(); pintarLista(); }
        return;
      }
      if(e.target.id === 'crewTirar'){
        try{ localStorage.removeItem(BORRADOR); }catch(_){}
        location.reload();
      }
    });

    fila.onclick = ()=>{
      colocando = !colocando;
      fila.setAttribute('aria-pressed', String(colocando));
      document.body.dataset.colocando = String(colocando);
      pop.dataset.open = String(colocando);
      $('#crewJson').hidden = !colocando;
      if(colocando){
        openPop(null,false); pintarLista();
        /* La lista abierta donde cabe; plegada en el móvil, donde el panel
           tapa el mapa que se está pulsando. */
        $('#crewDetails').open = matchMedia('(min-width: 721px)').matches;
        /* Encender el modo baja el mapa a 2D. Se coloca siempre sobre un plano,
           así que entrar en el modo es ponerse en uno. Sin esto, quien lo
           encendiera desde el 3D pulsaría el recinto y no pasaría nada, que es
           la peor respuesta posible: ni coloca ni dice por qué. */
        setView('2d');
      }
    };

    /* Bajar el archivo: para que quien coloque lo mande y ese archivo SEA
       fuente/voluntarios.json. En el móvil el navegador lo guarda o lo
       comparte, según el sistema. */
    $('#crewSave').onclick = ()=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([archivo()], {type:'application/json'}));
      a.download = 'voluntarios.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=> URL.revokeObjectURL(a.href), 1500);
    };
    $('#crewCopy').onclick = async ()=>{
      const b = $('#crewCopy'), txt = $('#crewJson').textContent;
      let ok = false;
      try{ await navigator.clipboard.writeText(txt); ok = true; }catch(_){}
      if(!ok){
        $('#crewDetails').open = true;
        const r = document.createRange(); r.selectNodeContents($('#crewJson'));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      b.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(()=>{ b.textContent = 'Copy'; }, 2200);
    };
    pintarPuestos();
    pintarLista();
  }
}

