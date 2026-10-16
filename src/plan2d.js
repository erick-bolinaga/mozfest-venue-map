/* ---------- the floor plan, as SVG ----------
   A floor drawn flat, inside the sheet, with no WebGL and no camera.

   IT IS DRAWN IN MODEL METRES — the very numbers stored in model.json, not the
   world coordinates three.js uses. Those two spaces differ by a translation:
   shapeOf() subtracts the site centre (CX, CZ) on its way into the scene. The
   plan skips that subtraction on purpose, so a click on a room hands back the
   same metres the model was written in.

   That matters beyond today. When the organiser starts dropping volunteers onto
   a plan, the position they save has to survive a retrace of map.svg — and CX
   and CZ are recomputed from the bounding box of every volume, so a new traced
   shed at the edge of the site moves them. Model metres do not move. World
   coordinates would silently shift everything ever saved.

   Nothing here is declared with a name the template already uses: this file is
   inlined into the same script, so a second `esc` or `inPoly` would not shadow
   the first, it would refuse to parse. Everything local is prefixed `plan`. */

/* Air around the outline, in metres, so a room touching the edge is not clipped
   by its own stroke. */
const PLAN_PAD = 1.2;

/* Point in polygon, ray casting. The template has its own; this one exists so
   the module can be read, moved or tested without dragging the template along. */
const planIn = (x, z, poly) => {
  let inside = false;
  for(let i = 0, n = poly.length; i < n; i++){
    const [xi, zi] = poly[i], [xj, zj] = poly[(i + n - 1) % n];
    if((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/* Convex hull, monotone chain. Only wanted for the squaring below. */
const planHull = pts => {
  const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if(p.length < 3) return p;
  const side = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const half = list => {
    const out = [];
    for(const q of list){
      while(out.length >= 2 && side(out[out.length-2], out[out.length-1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.slice().reverse()));
};

/* The turn that squares a floor to the frame it is drawn in.

   Nothing on this site is drawn square: the whole trace sits about twelve
   degrees off, because that is how the streets run. On the 3D that is right —
   it is the building where the building is. On a plan read inside a panel it is
   just a tilt, and it costs both legibility and room.

   The angle comes from the smallest-area rectangle that encloses the floor,
   which for any convex hull has a side lying along a hull edge, so trying every
   edge finds it. All four of that rectangle's sides square the floor equally
   well, so the one requiring the smallest turn is taken: at most 45 degrees,
   and the building keeps the orientation it has in the model rather than being
   stood on its end. */
const planSquare = outline => {
  const h = planHull(outline);
  let best = {area: Infinity, a: 0};
  for(let i = 0; i < h.length; i++){
    const A = h[i], B = h[(i + 1) % h.length];
    const a = Math.atan2(B[1] - A[1], B[0] - A[0]);
    const c = Math.cos(-a), s = Math.sin(-a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for(const [x, z] of h){
      const rx = x * c - z * s, rz = x * s + z * c;
      if(rx < x0) x0 = rx; if(rx > x1) x1 = rx;
      if(rz < z0) z0 = rz; if(rz > z1) z1 = rz;
    }
    const area = (x1 - x0) * (z1 - z0);
    if(area < best.area) best = {area, a};
  }
  let a = best.a;
  while(a >   Math.PI / 4) a -= Math.PI / 2;
  while(a <= -Math.PI / 4) a += Math.PI / 2;
  return a;
};

/* One point, turned about an origin. Handed its cosine and sine already so a
   whole floor costs two trigonometric calls rather than two per vertex. */
const planTurn = (p, c, s, ox, oz) => {
  const x = p[0] - ox, z = p[1] - oz;
  return [ox + x * c - z * s, oz + x * s + z * c];
};

const planBBox = polys => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  polys.forEach(p => p.forEach(([x, z]) => {
    if(x < x0) x0 = x; if(x > x1) x1 = x;
    if(z < z0) z0 = z; if(z > z1) z1 = z;
  }));
  return {x0, z0, x1, z1, w: x1 - x0, h: z1 - z0};
};

/* Three decimals is a tenth of a millimetre on site — far past what the trace
   knows — and it keeps the markup from doubling in size for nothing. */
const planRing = poly =>
  'M' + poly.map(([x, z]) => x.toFixed(3) + ' ' + z.toFixed(3)).join('L') + 'Z';

/* The run of solid room along one axis through a point: the polygon cut by a
   line, keeping the span the point actually falls in. `ax` 0 measures across,
   1 measures down.

   A bounding box will not do here. Every building on this site is traced some
   twelve degrees off square, so a rotated room's box is markedly wider than the
   room — which is exactly how a label came to be centred on its own room and
   spilling across two others. */
const planRun = (poly, p, ax) => {
  const o = 1 - ax, cut = p[o], at = p[ax], edge = [];
  for(let i = 0, n = poly.length; i < n; i++){
    const A = poly[i], B = poly[(i + 1) % n];
    if((A[o] > cut) === (B[o] > cut)) continue;
    edge.push(A[ax] + (cut - A[o]) * (B[ax] - A[ax]) / (B[o] - A[o]));
  }
  edge.sort((a, b) => a - b);
  for(let i = 0; i + 1 < edge.length; i += 2)
    if(edge[i] <= at && at <= edge[i + 1]) return edge[i + 1] - edge[i];
  return 0;
};

/* The area centroid, which for an L-shaped room can land outside the room. When
   it does the label is dropped rather than drawn somewhere it does not belong:
   a name floating in the corridor next door is worse than no name. */
const planCentre = poly => {
  let a = 0, cx = 0, cz = 0;
  for(let i = 0, n = poly.length; i < n; i++){
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if(Math.abs(a) < 1e-9) return null;
  const c = [cx / (3 * a), cz / (3 * a)];
  return planIn(c[0], c[1], poly) ? c : null;
};

/* Builds one floor. Returns markup, so the caller drops it in with innerHTML and
   listens once by delegation — the same shape as every other panel here.

   floor  a record out of D.floors: outline, voids, rooms
   sel    id of the room to draw as chosen, or null */
function plan2d(floor, sel){
  /* Squared before anything is measured, so the labels are fitted against the
     rooms as they will actually be drawn. The angle and the origin ride on the
     svg, because planAt has to undo exactly this to hand back model metres. */
  const raw = planBBox([floor.outline]);
  const ox = (raw.x0 + raw.x1) / 2, oz = (raw.z0 + raw.z1) / 2;
  const ang = planSquare(floor.outline);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const turn = poly => poly.map(p => planTurn(p, c, s, ox, oz));
  floor = {
    name: floor.name,
    outline: turn(floor.outline),
    voids: (floor.voids || []).map(turn),
    rooms: floor.rooms.map(r => Object.assign({}, r, {poly: turn(r.poly)}))
  };

  const box = planBBox([floor.outline]);
  const x0 = box.x0 - PLAN_PAD, z0 = box.z0 - PLAN_PAD;
  const w  = box.w + PLAN_PAD * 2, h = box.h + PLAN_PAD * 2;

  /* Type is sized against the viewBox, never in absolute metres. A 60 m nave and
     a 12 m room then carry labels of the same size ON SCREEN, which is the only
     size a reader cares about. Strokes get non-scaling-stroke instead, which is
     the same idea handed to the browser. */
  const fs = w / 42;

  /* The slab, with the double-height voids punched out of it. evenodd is what
     turns the inner rings into holes rather than into more floor. */
  const slab = planRing(floor.outline) +
    (floor.voids || []).map(planRing).join('');

  const rooms = floor.rooms.map(r => {
    const k = (D.kinds[r.kind] || {});
    const on = r.id === sel;
    return `<path class="plan-room${on ? ' is-on' : ''}" d="${planRing(r.poly)}"` +
      ` data-room="${esc(r.id)}" fill="${k.color || '#8A93A2'}"` +
      ` tabindex="0" role="button" aria-pressed="${on}"` +
      /* No <title>. It gave every room a native tooltip that popped up over the
         plan on the way to a click — a big box the page cannot style, covering
         the rooms around the one being pointed at. The name is on the room, in
         the card below it, and in aria-label for anyone listening. */
      ` aria-label="${esc(r.name)}, ${k.label || 'room'}, ${r.area} square metres">` +
      `</path>`;
  }).join('');

  /* A name is drawn whole or not at all. Truncating gave rows of "Esp…",
     "Dist…", "Toil…" — noise that names nothing and still eats the room's width.
     A room too small for its name keeps quiet and answers when tapped.

     Only the vertical test can be settled here. Whether the name FITS ACROSS is
     not guessed at: every label carries the room it has to fit in, and
     planFitLabels() measures the drawn text once the browser has it and drops
     the ones that do not. An estimated character width was wrong in both
     directions — it spilled long names across neighbours and it silenced "Sala
     maquinaria", which fits with room to spare. */
  const labels = floor.rooms.map(r => {
    const c = planCentre(r.poly);
    if(!c) return '';
    const room = (r.name || '').trim();
    if(!room || planRun(r.poly, c, 1) < fs * 1.25) return '';
    return `<text class="plan-label" x="${c[0].toFixed(2)}" y="${c[1].toFixed(2)}"` +
      ` font-size="${fs.toFixed(3)}" data-run="${planRun(r.poly, c, 0).toFixed(3)}"` +
      `>${esc(room)}</text>`;
  }).join('');

  /* What the festival puts INSIDE this floor: accreditation, a merch table, an
     information point. They are marked on the plan rather than drawn as
     geometry, because nobody traced them and their exact footprint is not the
     question — where in the room you find them is. A ring, at the centre of the
     room they were given, sized against the plan the same way the labels are. */
  const kit = (typeof EVENT === 'undefined' ? [] : EVENT)
    .filter(e => e.room && (floor.rooms || []).some(r => r.id === e.room))
    .map(e => {
      const r = floor.rooms.find(x => x.id === e.room);
      const c = planCentre(r.poly);
      if(!c) return '';
      const k = (D.kinds[e.kind] || {});
      return `<circle class="plan-kit" cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}"` +
        ` r="${(fs * .42).toFixed(3)}" fill="${k.color || '#8A93A2'}"` +
        ` role="img" aria-label="${esc(e.label)}, provisional"><title>${esc(e.label)}</title></circle>`;
    }).join('');

  /* The volunteer stations that fall on this floor. They go at the exact point
     where they were placed and NOT at the centre of the room, as the kit above
     does: inside a sixty-metre nave, "in the room" does not say where, and the
     spot is precisely the information. The turn into the squared frame is the
     same as the polygons', and the exact inverse of the one planAt makes. */
  const crew = (typeof STATIONS === 'undefined' ? [] : STATIONS)
    .filter(p => p.room && floor.rooms.some(r => r.id === p.room))
    .map(p => {
      const q = planTurn([p.x, p.z], c, s, ox, oz);
      /* The same ring the figure wears on the site, in its priority's colour,
         so a station is recognised the same way on the plan. Radii by eye,
         Erick's. */
      const cx = q[0].toFixed(2), cy = q[1].toFixed(2);
      /* The label is the place, then the code and the count; never the id. */
      const place = stationName(p), count = stationCount(p);
      const tail = [p.code, count].filter(Boolean).join(' \u00b7 ');
      return `<g class="plan-crew${p.vc ? ' vc' : ''}${p.priority ? ' prio-' + p.priority : ''}"` +
        ` data-station="${esc(p.id)}" role="img"` +
        ` aria-label="${esc(place)}, ${esc(stationLine(p))}">` +
        `<circle class="plan-crew-ring" cx="${cx}" cy="${cy}" r="${(fs * .8).toFixed(3)}"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${(fs * .46).toFixed(3)}"/>` +
        `<title>${esc(place)}${tail ? ' \u00b7 ' + esc(tail) : ''}</title></g>`;
    }).join('');

  return `<div class="plan" style="aspect-ratio:${(w / h).toFixed(4)}">` +
    `<svg viewBox="${x0.toFixed(2)} ${z0.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}"` +
    ` data-turn="${ang.toFixed(6)}" data-origin="${ox.toFixed(4)} ${oz.toFixed(4)}"` +
    ` role="group" aria-label="Plan of ${esc(floor.name)}">` +
    `<path class="plan-slab" fill-rule="evenodd" d="${slab}"/>` +
    `<g class="plan-rooms">${rooms}</g>` +
    `<g class="plan-kit-marks">${kit}</g>` +
    `<g class="plan-crew-marks">${crew}</g>` +
    `<g class="plan-labels" aria-hidden="true">${labels}</g>` +
    `</svg></div>`;
}

/* Drops every label wider than the room it sits in. getComputedTextLength gives
   the drawn width in user units — metres here, the same units data-run is in —
   so this is a measurement rather than an estimate of one. Call it once the svg
   is in the document; before that the text has no length to compute. */
function planFitLabels(svg){
  if(!svg) return;
  svg.querySelectorAll('.plan-label').forEach(t => {
    const room = +t.dataset.run * 0.94;
    let w = 0;
    try { w = t.getComputedTextLength(); } catch(e) { return; }
    if(w <= room) return;
    /* A name that misses by a little is set a little smaller rather than thrown
       away — the usual thing on a map, and the rooms it saves are the large ones
       whose names matter most. Text width scales with the size, so the factor
       that makes it fit is just the ratio. Below about four fifths it would be
       smaller than the plan's other names and read as a different kind of
       thing, so past that it goes. */
    const fs = parseFloat(t.getAttribute('font-size'));
    const smaller = fs * room / w;
    if(smaller >= fs * 0.78) t.setAttribute('font-size', smaller.toFixed(3));
    else t.remove();
  });
}

/* Screen point -> model metres, for the click that will one day drop a volunteer
   on this plan. Unused today and deliberately kept: it is the other half of the
   contract this module exists to hold, and writing it now is what stops the
   coordinate space from being guessed later. */
function planAt(svg, clientX, clientY){
  /* getScreenCTM carries the viewBox, the scale and the letterboxing that
     preserveAspectRatio's default introduces, so screen to user units is one
     inverse rather than three hand-written corrections. */
  const m = svg.getScreenCTM();
  if(!m) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  /* Then undo the squaring, because user units here are the squared frame and
     what everything downstream stores is model metres. */
  const a = +svg.dataset.turn, o = svg.dataset.origin.split(' ').map(Number);
  const back = planTurn([p.x, p.y], Math.cos(a), Math.sin(a), o[0], o[1]);
  return {x: back[0], z: back[1]};
}
