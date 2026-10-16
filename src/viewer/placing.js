/* ---------- placing volunteers ----------
   Placing is by eye and by plan; keeping it is git's job. This is where posts
   are placed and copied; what really exists is whatever is pasted into
   src/stations.json.

   Posts are ALWAYS placed on a plan, never on the 3D: the map in 2D for the
   outdoors — which by convention is at the venue's ground level — and the
   floor plan for indoors. Erick's decision, and it gets the hard question out
   of the way: in 3D a click on a roof does not say which level it aims at.

   All of this EXISTS only for the organiser. For everyone else it is removed
   from the DOM, not hidden: a list of posts that can be read but not touched
   is not half a feature, it is a leak. */
var placing = false;
function placeAt(){}                 /* the real one is defined below when it applies */
{
  const row = $('#crewBtn'), pop = $('#crew');
  if(!atLeast('organiser')){
    if(row) row.remove();
    if(pop) pop.remove();
  } else {
    const DRAFT_KEY = 'mozfest-stations';
    const IN_FILE = STATIONS.length;
    let hasDraft = false;
    try{
      const g = localStorage.getItem(DRAFT_KEY);
      if(g){
        const d = JSON.parse(g);
        if(Array.isArray(d)){ STATIONS.length = 0; STATIONS.push(...d); hasDraft = true; }
      }
    }catch(_){}

    /* The draft lives in this browser and the file in the repository. That a
       draft exists is SAID, instead of letting the viewer silently show
       something that is not stored anywhere. */
    const saveDraft = ()=>{
      try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(STATIONS)); }catch(_){}
      hasDraft = true;
    };
    /* What gets saved: what the Book says — code, place, priority and, for the
       Main Stage ones, the team —, the room if it is indoors, and the point.
       Nothing else. And the WHOLE file is handed over, with its notes, so that
       whoever places posts sends it as it is and that file becomes
       src/stations.json without pasting anything into anything. */
    const forFile = () => STATIONS.map(p => Object.assign(
      {id:p.id, code:p.code, name:p.name, priority:p.priority},
      p.team ? {team:p.team} : {}, p.room ? {room:p.room} : {}, {x:p.x, z:p.z},
      p.vc ? {vc:true} : {}));
    const fileText = () => JSON.stringify({_readme: STATIONS_README, stations: forFile()}, null, 2) + '\n';

    /* Moving: the new point, and the room if it comes from the plan. The code
       does not change: since 16 Oct the Book sets it, not the place, and a post
       shifted by a metre is still the same post. */
    onStationMove = (id, x, z, room)=>{
      const p = STATIONS.find(q => q.id === id);
      if(!p) return;
      p.x = +x.toFixed(2); p.z = +z.toFixed(2);
      if(room) p.room = room;
      saveDraft(); drawStations(); retab(); drawStationList();
    };
    /* Dragging a post on the floor plan. The room is whichever lies underneath
       on release; outside every room, it goes back to where it was. */
    card.addEventListener('pointerdown', e=>{
      if(!placing || e.button !== 0) return;
      const g = e.target.closest('.plan-crew'), svg = g && g.closest('svg');
      if(!svg) return;
      e.preventDefault();
      const id = g.dataset.station, circles = g.querySelectorAll('circle');
      const a = +svg.dataset.turn, o = svg.dataset.origin.split(' ').map(Number);
      const c = Math.cos(-a), sn = Math.sin(-a);
      let last = null;
      g.classList.add('dragging');
      try{ svg.setPointerCapture(e.pointerId); }catch(_){}
      const onMove = ev=>{
        const q = planAt(svg, ev.clientX, ev.clientY);
        if(!q) return;
        const f = planTurn([q.x, q.z], c, sn, o[0], o[1]);
        circles.forEach(ci => { ci.setAttribute('cx', f[0].toFixed(2)); ci.setAttribute('cy', f[1].toFixed(2)); });
        last = {q, cx: ev.clientX, cy: ev.clientY};
      };
      const onRelease = ()=>{
        ['pointermove','pointerup','pointercancel'].forEach((t, i) => svg.removeEventListener(t, i ? onRelease : onMove));
        /* Look at what is underneath BEFORE giving the marker its
           pointer-events back: otherwise what is underneath is the marker, and
           never a room. */
        const under = last && document.elementFromPoint(last.cx, last.cy);
        g.classList.remove('dragging');
        if(!last) return;
        planDragged = true;                 /* the click that follows picks no room */
        const roomEl = under && under.closest('[data-room]');
        if(roomEl) onStationMove(id, last.q.x, last.q.z, roomEl.dataset.room);
        else retab();
      };
      svg.addEventListener('pointermove', onMove);
      svg.addEventListener('pointerup', onRelease);
      svg.addEventListener('pointercancel', onRelease);
    });

    /* A new one asks for its code, because the point no longer says it. The
       nearest post's code is offered, which is the usual case — one more in the
       Open Source House —, and if the code already exists its place, priority
       and team are copied; only a new code asks for those too. Whatever is not
       valid says so and places nothing: keeping quiet would be the worst
       answer. */
    const PRIORITIES = {high:'high', medium:'medium', low:'low'};
    placeAt = (x, z, room)=>{
      const nearest = STATIONS.filter(q => !!q.room === !!room && q.code)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      const code = (prompt('Station code, as the Book of Answers writes it (E3, A0 Main):',
                           nearest ? nearest.code : (zoneOf(x, z) || '')) || '').trim();
      if(!code) return;
      if(!/^[A-G]\d+( [A-Z][a-z]+)?$/.test(code)){
        alert(`Not placed: "${code}" is not a station code like E3 or A0 Main.`); return;
      }
      const same = STATIONS.find(q => q.code === code);
      const name = same ? same.name
        : (prompt(`Place for ${code}, as the Book describes it (said on the radio):`) || '').trim();
      if(!name) return;
      const priority = same ? same.priority
        : PRIORITIES[(prompt(`Priority of ${code} in the Book: high, medium or low`, 'high') || '').trim().toLowerCase()];
      if(!priority){ alert('Not placed: the priority is high, medium or low.'); return; }
      const p = Object.assign({id:newStationId(code), code, name, priority},
                              same && same.team ? {team:same.team} : {},
                              {x:+x.toFixed(2), z:+z.toFixed(2)});
      if(room) p.room = room;
      STATIONS.push(p);
      saveDraft(); drawStations(); retab(); drawStationList();
    };

    function drawStationList(){
      const list = $('#crewList');
      const inside = STATIONS.filter(p => p.room).length;
      $('#crewSummary').textContent = STATIONS.length
        ? `${STATIONS.length} placed \u00b7 ${inside} inside` : 'Nothing placed yet';
      if(!STATIONS.length){
        list.innerHTML = '';
      } else {
        list.innerHTML = STATIONS.map(p => {
          const w = whereIs(p);
          const code = p.code || p.id, count = stationCount(p);
          const name = [code, stationName(p), count].filter(Boolean).join(' ');
          const where = (w.covered ? `Hidden inside ${w.covered} \u2014 move it out \u00b7 ` : '')
                      + (w.inZone ? '' : 'Outside every zone \u2014 move it \u00b7 ')
                      + stationName(p) + ' \u00b7 ' + w.where;
          return `<div class="crew-row" data-p="${esc(p.id)}">` +
            `<span class="code${w.inZone && !w.covered ? '' : ' nozone'}">${esc(code)}` +
              (count ? `<span class="count">${esc(count)}</span>` : '') + `</span>` +
            (p.vc ? `<span class="vc" title="VC, as the organisation calls them">VC</span>` : '') +
            `<span class="where" title="${esc(where)}">${esc(where)}</span>` +
            `<button data-remove="${esc(p.id)}" aria-label="Remove ${esc(name)}">\u00D7</button>` +
            `</div>`; }).join('');
      }
      const notice = hasDraft
        ? `<p class="crew-hint">${STATIONS.length} placed \u00b7 draft in this browser, ` +
          `${IN_FILE} in stations.json. <button id="crewDiscard" ` +
          `style="background:none;border:0;color:var(--moz);font:inherit;cursor:pointer;padding:0">` +
          `Discard draft</button></p>` : '';
      list.insertAdjacentHTML('beforeend', notice);
      $('#crewJson').textContent = fileText();
    }

    $('#crewList').addEventListener('click', e=>{
      const q = e.target.closest('[data-remove]');
      if(q){
        const i = STATIONS.findIndex(x => x.id === q.dataset.remove);
        if(i >= 0){ STATIONS.splice(i,1); saveDraft(); drawStations(); retab(); drawStationList(); }
        return;
      }
      if(e.target.id === 'crewDiscard'){
        try{ localStorage.removeItem(DRAFT_KEY); }catch(_){}
        location.reload();
      }
    });

    row.onclick = ()=>{
      placing = !placing;
      row.setAttribute('aria-pressed', String(placing));
      document.body.dataset.placing = String(placing);
      pop.dataset.open = String(placing);
      $('#crewJson').hidden = !placing;
      if(placing){
        openPop(null,false); drawStationList();
        /* The list open where it fits; folded on a phone, where the panel
           covers the map being tapped. */
        $('#crewDetails').open = matchMedia('(min-width: 721px)').matches;
        /* Turning the mode on drops the map to 2D. Posts are always placed on
           a plan, so entering the mode means standing on one. Without this,
           whoever turned it on from the 3D would tap the venue and nothing
           would happen, which is the worst possible answer: it neither places
           nor says why. */
        setView('2d');
      }
    };

    /* Downloading the file: so whoever places posts sends it and that file IS
       src/stations.json. On a phone the browser saves or shares it, depending
       on the system. */
    $('#crewSave').onclick = ()=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([fileText()], {type:'application/json'}));
      a.download = 'stations.json';
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
    drawStations();
    drawStationList();
  }
}

