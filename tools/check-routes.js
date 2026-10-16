/* Checks the routes from A to B: the engine (routeBetween) and, later, the card.
   Run it like the other bench:  tools/with-chrome.sh node tools/check-routes.js
   HTML=/other/path.html to check a different build. */
const path = require('path');
const { connect, evaluate } = require('./cdp.js');
const FILE = 'file://' + (process.env.HTML || path.resolve(__dirname, '..', 'fabraicoats-3d.html'));

/* Asked of the data, not pinned: the room behind a MozFest code today. */
const SPACES = require('../src/venue.json').spaces;
const MODEL = require('../src/model.json');
/* The kit as build.py merges it: a hand entry with the same id replaces the
   traced one, and one with 'retired' takes it away (2026-10-16). */
const KIT = (() => {
  const a = require('../src/event.json').items, b = require('../src/event-by-hand.json').items;
  const retired = new Set(b.filter(i => i.retired === true).map(i => i.id));
  const m = new Map();
  for (const it of [...a, ...b]) if (!retired.has(it.id)) m.set(it.id, it);
  return [...m.values()];
})();
const roomOf = code => SPACES[code].room;

/* The same obstacles src/routes.py closes the grid with. A route that
   crosses one of these has gone through a wall. */
const OBSTACLES = [
  ...MODEL.vols.filter(v => (v.base || 0) < 2).map(v => [v.id, v.poly]),
  ...KIT.filter(e => e.poly).map(e => [e.id, e.poly]),
];
const inside = ([x, z], P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/* Every quarter metre along the route: which obstacles does it enter? */
function crossings(points) {
  const out = new Set();
  for (let k = 1; k < points.length; k++) {
    const [ax, az] = points[k - 1], [bx, bz] = points[k];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
    for (let s = 0; s <= n; s++) {
      const p = [ax + (bx - ax) * s / n, az + (bz - az) * s / n];
      OBSTACLES.forEach(([id, P]) => { if (inside(p, P)) out.add(id); });
    }
  }
  return [...out];
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
};

(async () => {
  const { send, close } = await connect(FILE);
  await evaluate(send, `new Promise(r => { const t = () => document.readyState === 'complete' ? setTimeout(r, 1500) : setTimeout(t, 100); t(); })`);
  /* routeBetween answers {points, metres, door, steps} or {error}; the door
     comes back as its id. */
  const route = (from, to) => evaluate(send, `(() => {
    if (typeof routeBetween !== 'function') return {missing: true};
    const t0 = performance.now();
    const r = routeBetween(${JSON.stringify(from)}, ${JSON.stringify(to)});
    return Object.assign({ms: performance.now() - t0}, r, {door: r.door && r.door.id});
  })()`);
  const MAIN = {type: 'door', id: 'e-Main'};

  console.log('\nThe engine');
  const d3 = await route(MAIN, {type: 'room', id: roomOf('D3')});
  ok('routeBetween() exists', !d3.missing);
  if (d3.missing) { console.log(`\n${pass} pass, ${fail + 1} fail\n`); close(); process.exit(1); }
  ok('Main entrance → D3 ends at one of D0 Main\'s doors', /^d0-main-/.test(d3.door || ''), d3.door);
  ok('  ...and says to go up to the third floor', (d3.steps || []).some(t => t === 'Go up to the Third floor'), JSON.stringify(d3.steps));
  ok('  ...and gives metres and minutes', d3.metres > 20 && (d3.steps || []).some(t => / m · \d+ min$/.test(t)), `${Math.round(d3.metres)} m`);
  const crossed = crossings(d3.points || []);
  ok('  ...and goes through no volume and nothing of the kit', (d3.points || []).length >= 2 && crossed.length === 0, crossed.join(', '));
  ok('  ...in under 200 ms', d3.ms < 200, `${d3.ms.toFixed(0)} ms`);

  const same = await route({type: 'room', id: roomOf('D2')}, {type: 'room', id: roomOf('D3')});
  ok('D2 → D3, the same building: no line, only the floor',
     (same.points || []).length === 0 && JSON.stringify(same.steps) === JSON.stringify(['Go up to the Third floor']),
     JSON.stringify(same.steps));

  const f2 = await route(MAIN, {type: 'room', id: roomOf('F2')});
  ok('Main entrance → F2, in the basement: through the door of the stairs to −1', f2.door === 'e-salvia-to-minus-1', f2.door);
  ok('  ...and says to go down to the basement', (f2.steps || []).includes('Go down to the Basement'), JSON.stringify(f2.steps));
  ok('  ...going through nothing', crossings(f2.points || []).length === 0, crossings(f2.points || []).join(', '));

  /* Espai Vertical's stairs-and-lift door opens straight onto the stairs and
     the lift (Erick, 2026-09-30): for any floor but the ground one it is the
     way in. The Production Office is on the top floor. */
  const up = await route(MAIN, {type: 'room', id: 'r-05-b-salvia-production-office'});
  ok('Main entrance → the Production Office, upstairs: by the stairs and the lift', up.door === 'e-salvia-stairs-lift' &&
     (up.steps || []).some(t => /Stairs and lift/.test(t)) && (up.steps || []).includes('Go up to the Top floor'),
     JSON.stringify([up.door, up.steps]));
  const ground = await route(MAIN, {type: 'room', id: roomOf('F1')});
  ok('  ...and the ground floor is entered without going up or down', !(ground.steps || []).some(t => /^Go (up|down)/.test(t)),
     JSON.stringify([ground.door, ground.steps]));

  /* 0 Back is a way in for the public (Erick, 2026-09-30): a gate, found by the
     search and usable as either end of a route. */
  const back = await evaluate(send, `(() => {
    $('#q').value = '0 Back'; runSearch();
    const hit = hits.find(h => h.data && h.data.kind === 'door' && h.data.id === 'e-Secondary');
    const place = hit && routeFromHit(hit);
    const r = place && routeBetween(place, {type: 'building', id: 'b-viola'});
    $('#q').value = ''; runSearch();
    return {hit: !!hit, sub: hit && hit.sub, place, metres: r && Math.round(r.metres), text: r && r.steps};
  })()`);
  ok('0 Back can be searched for and serves as the origin', back.hit && back.place && back.place.type === 'door' && back.metres > 0 &&
     back.text.some(t => /^Walk to /.test(t)), JSON.stringify(back));

  const out = await route({type: 'room', id: roomOf('D3')}, {type: 'room', id: roomOf('E1')});
  ok('D3 → E1: first go down to the ground floor', (out.steps || [])[0] === 'Go down to the Ground floor', JSON.stringify(out.steps));
  ok('  ...and go in by Espai Bota\'s door', out.door === 'e-lotus-acces-recinte', out.door);
  ok('  ...going through nothing', (out.points || []).length >= 2 && crossings(out.points).length === 0, crossings(out.points || []).join(', '));

  /* Erick, 29-sep: between L'Harmonia and the music school there is a way
     through — venue ground, open to everyone. Without it the route went round
     the south of La Fàbrica: 243 m on the grid instead of 204. */
  const bota = await route(MAIN, {type: 'building', id: 'b-lotus'});
  ok('Main entrance → Espai Bota by the way between L\'Harmonia and the Escola de Música', bota.metres < 215, `${Math.round(bota.metres)} m`);

  const ref = await route(MAIN, {type: 'building', id: 'b-refence-e'});
  ok('to a building with no public door: an error, not an empty route', !!ref.error && !(ref.points || []).length, ref.error);

  const g1 = await route(MAIN, {type: 'room', id: roomOf('G1')});
  ok('Main entrance → G1: by the museum entrance, and up to the mezzanine',
     g1.door === 'e-fontanet-recinte' && (g1.steps || []).includes('Go up to the Mezzanine'), `${g1.door} ${JSON.stringify(g1.steps)}`);

  const g2 = await route(MAIN, {type: 'room', id: roomOf('G2')});
  ok('Main entrance → G2: from the lobby down to the museum\'s street level', (g2.steps || []).includes('Go down to the Street level'), JSON.stringify(g2.steps));
  const g1d3 = await route({type: 'room', id: roomOf('G1')}, {type: 'room', id: roomOf('D3')});
  ok('G1 → D3: first go down to the lobby', (g1d3.steps || [])[0] === 'Go down to the Lobby', JSON.stringify(g1d3.steps));
  const g0g1 = await route({type: 'room', id: roomOf('G0')}, {type: 'room', id: roomOf('G1')});
  ok('G0 → G1, which share a door: no line, just go up',
     (g0g1.points || []).length === 0 && JSON.stringify(g0g1.steps) === JSON.stringify(['Go up to the Mezzanine']), JSON.stringify(g0g1.steps));
  const d0d3 = await route({type: 'door', id: 'd0-main-1'}, {type: 'room', id: roomOf('D3')});
  ok('from a door of the destination itself: no line, just go up',
     (d0d3.points || []).length === 0 && JSON.stringify(d0d3.steps) === JSON.stringify(['Go up to the Third floor']), JSON.stringify(d0d3.steps));
  const own = await route({type: 'room', id: roomOf('D3')}, {type: 'building', id: 'b-rosa'});
  ok('to its own building it does not say «on this floor»', !(own.steps || []).some(t => /this floor/.test(t)), JSON.stringify(own.steps));

  console.log('\nThe card');
  const w = 'const w = ms => new Promise(r => setTimeout(r, ms));';
  /* Through the real card: search the room, open it, press the button. */
  const openAndPress = code => evaluate(send, `(async () => { ${w}
    const id = ${JSON.stringify(roomOf(code))};
    const room = D.floors.flatMap(f => f.rooms).find(r => r.id === id);
    $('#q').value = room.name; runSearch();
    const i = hits.findIndex(h => h.data && h.data.id === id && !h.badge);
    if(i < 0) return {button: false};
    document.querySelectorAll('#results button')[i].click(); await w(900);
    /* The search lands on the building with the room chosen on its plan: the
       building's own button takes you to that room. */
    const button = card.querySelector('[data-route]');
    /* And the room's card, the one a tap on the plan opens, carries one too. */
    /* pickRoom toggles: the search left the room chosen, so the first press
       would unchoose it. Unchoose, then choose, to open its card. */
    if(sheetTab.room === id){ pickRoom(id); await w(300); }
    pickRoom(id); await w(600);
    const inRoom = roomSheet.classList.contains('is-open') && !!roomBody.querySelector('[data-route="room:' + id + '"]');
    if(!button) return {button: false, inRoom};
    button.click(); await w(900);
    const routeCard = document.querySelector('#route');
    return {button: true, inRoom, to: routeTo && routeTo.id,
            visible: !!routeCard && !routeCard.hidden, text: routeCard ? routeCard.textContent : '',
            ribbons: typeof routeRibbons === 'function' ? routeRibbons() : -1,
            sheetClosed: !sheet.classList.contains('is-open')};
  })()`);
  const t = await openAndPress('D3');
  ok('the building\'s card, reached from the search on a room, carries «How to get there» to that room', t.button && t.to === roomOf('D3'), t.to);
  ok('  ...and so does the room\'s card', t.inRoom);
  ok('  ...and pressing it shows the route card', !!t.visible);
  ok('  ...with the floor and the origin', /Go up to the Third floor/.test(t.text || '') && /Main entrance/.test(t.text || ''), (t.text || '').slice(0, 120));
  ok('  ...one ribbon on the map', t.ribbons === 1, `${t.ribbons}`);
  ok('  ...and the panel steps aside so it can be seen', !!t.sheetClosed);
  const start = await evaluate(send, `routeGroup.children.some(m => m.userData.start && m.material.color.getHex() === 0xffffff)`);
  ok('  ...and the origin carries a light ring, visible in the dark theme too', start);

  /* The button lives on the title's line (Erick, 2026-09-30): an outlined pill
     with one word and an icon, to the right of the name and its subtitle, and
     clear of the sheet's close cross. Measured on the three cards that carry
     it, wide and at 390 px, where a long name has to wrap and not squeeze it. */
  const HEADER = `(async () => { ${w}
    const measure = (root, closeBtn) => {
      const b = root.querySelector('[data-route]'); if(!b) return {button: false};
      const head = b.closest('.card-head'), title = head && head.querySelector('.card-title');
      const rb = b.getBoundingClientRect(), rx = closeBtn.getBoundingClientRect();
      const rt = title ? title.getBoundingClientRect() : {top: 0, bottom: 0, right: 1e9};
      const cs = getComputedStyle(b);
      return {button: true, inHead: !!title && !!title.querySelector('h2,h3'),
        text: b.textContent.trim(), icon: !!b.querySelector('svg'),
        /* bare text is an anonymous flex item, which Firefox aligns off the icon */
        wrapped: [...b.childNodes].every(n => n.nodeType !== 3 || !n.textContent.trim()) && !!b.querySelector('span'),
        pill: parseFloat(cs.borderTopLeftRadius) >= rb.height / 2 - .5,
        outline: parseFloat(cs.borderTopWidth) > 0 && /rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor),
        sameLine: rb.top < rt.bottom && rb.bottom > rt.top && rb.left >= rt.right - .5,
        clashes: !(rb.right <= rx.left || rb.left >= rx.right || rb.bottom <= rx.top || rb.top >= rx.bottom),
        width: +rb.width.toFixed(1), fits: root.scrollWidth <= root.clientWidth + .5};
    };
    const search = async (q, pred) => { $('#q').value = q; runSearch();
      document.querySelectorAll('#results button')[Math.max(0, hits.findIndex(pred))].click(); await w(1100); };
    routeClose(); if(roomSheet.classList.contains('is-open')){ sheetTab.room = null; closeRoom(); } await w(200);
    await search('Building D', () => true);
    const building = measure(card, document.querySelector('.sheet-close'));
    /* Kit with nothing programmed answers with a bubble, not a card, so its
       card is asked for directly: it is the one the Music Stage will get when
       its sessions hang from it. */
    let kitData = null;
    scene.traverse(o => { if(!kitData && o.userData && o.userData.kind === 'event' && o.userData.ev && o.userData.ev.poly) kitData = o.userData; });
    select(null); await w(300); info(kitData); await w(700);
    const kit = measure(card, document.querySelector('.sheet-close'));
    await search('Lobby Can Fontanet', h => /Lobby Can Fontanet/.test(h.label));
    const longName = measure(card, document.querySelector('.sheet-close'));
    const id = ${JSON.stringify(roomOf('D3'))};
    const room = D.floors.flatMap(f => f.rooms).find(r => r.id === id);
    await search(room.name, h => h.data && h.data.id === id && !h.badge);
    if(sheetTab.room === id){ pickRoom(id); await w(300); } pickRoom(id); await w(700);
    const inRoom = measure(roomBody, document.querySelector('.room-close'));
    select(null); await w(400);
    return {building, kit, 'long name': longName, room: inRoom};
  })()`;
  for (const [label, width, height] of [['wide', 1280, 860], ['390 px', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    const c = await evaluate(send, HEADER);
    for (const [which, m] of Object.entries(c)) {
      ok(`${label}: on the ${which} card, the button sits on the title's line and does not touch the cross`,
         m.button && m.inHead && m.sameLine && !m.clashes && m.fits, JSON.stringify(m));
    }
    ok(`${label}:   ...it says «Directions» with an icon, in an outlined pill, and the word in its own element`,
       Object.values(c).every(m => m.text === 'Directions' && m.icon && m.pill && m.outline && m.wrapped),
       JSON.stringify(Object.values(c).map(m => [m.text, m.icon, m.pill, m.outline])));
    ok(`${label}:   ...and a long name does not shrink it`, c['long name'].width === c.building.width, `${c['long name'].width} / ${c.building.width}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');

  /* The building's button follows the plan: a room chosen goes to the room,
     none chosen goes to the building. */
  const follows = await evaluate(send, `(async () => { ${w}
    routeClose();
    const id = ${JSON.stringify(roomOf('D3'))};
    $('#q').value = 'Workshop'; runSearch();
    document.querySelectorAll('#results button')[hits.findIndex(h => h.data && h.data.id === id && !h.badge)].click(); await w(900);
    const ground = card.querySelector('[data-level="01"]');
    if(ground) ground.click(); await w(400);
    card.querySelector('[data-route]').click(); await w(600);
    return {type: routeTo && routeTo.type, room: sheetTab.room};
  })()`);
  ok('with the room unchosen, the building\'s button goes to the building', follows.type === 'building', JSON.stringify(follows));

  /* The one line of a same-building answer is the instruction, not a footnote. */
  const style = await evaluate(send, `(async () => { ${w}
    const look = () => { const li = document.querySelector('#routeText li'); const c = getComputedStyle(li); return [c.fontSize, c.color, c.listStyleType]; };
    routeFrom = {type: 'door', id: 'e-Main', name: 'Main entrance'};
    routeTo = {type: 'room', id: ${JSON.stringify(roomOf('D3'))}, name: 'D3'}; routeShow(); await w(200);
    const normal = look();
    routeFrom = {type: 'room', id: ${JSON.stringify(roomOf('D2'))}, name: 'D2'}; routeShow(); await w(200);
    const alone = look();
    return {normal, alone};
  })()`);
  ok('the single line of a same-building answer looks like a step, not like the metres note',
     JSON.stringify(style.normal) === JSON.stringify(style.alone), JSON.stringify(style));

  const change = await evaluate(send, `(async () => { ${w}
    document.querySelector('#routeFromBtn').click(); await w(200);
    const choosing = choosingPlace === 'from';
    $('#q').value = 'Espai Bota'; runSearch();
    const i = hits.findIndex(h => h.label === 'Espai Bota');
    document.querySelectorAll('#results button')[i].click(); await w(900);
    return {choosing, from: document.querySelector('#routeFromBtn').textContent,
            text: document.querySelector('#route').textContent, ribbons: routeRibbons()};
  })()`);
  ok('changing the origin opens the search to choose it', change.choosing);
  ok('  ...and with Espai Bota chosen, the route starts there', /Espai Bota/.test(change.from) && /Walk to Fabra i Coats \(D\)/.test(change.text), change.from);
  ok('  ...there is still a single ribbon', change.ribbons === 1, `${change.ribbons}`);

  const another = await evaluate(send, `(async () => { ${w}
    document.body.insertAdjacentHTML('beforeend', '<button id="routeTest" data-route="room:${roomOf('F2')}">x</button>');
    document.querySelector('#routeTest').click(); await w(900);
    document.querySelector('#routeTest').remove();
    return {text: document.querySelector('#route').textContent, ribbons: routeRibbons()};
  })()`);
  ok('asking for another route leaves a single ribbon', another.ribbons === 1 && /Basement/.test(another.text), `${another.ribbons}`);

  /* As check-viewer.js does it: mobile emulation widens the layout viewport. */
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
  const m390 = await evaluate(send, `(async () => { ${w} await w(600);
    const r = document.querySelector('#route').getBoundingClientRect();
    return {left: r.left, right: r.right, doc: document.documentElement.scrollWidth};
  })()`);
  ok('at 390 px the card fits and does not overflow', m390.left >= 0 && m390.right <= 390 && m390.doc <= 390, JSON.stringify(m390));
  await send('Emulation.clearDeviceMetricsOverride');

  const closed = await evaluate(send, `(async () => { ${w}
    document.querySelector('#routeClose').click(); await w(300);
    return {hidden: document.querySelector('#route').hidden, ribbons: routeRibbons()};
  })()`);
  ok('closing the route removes the card and the ribbon', closed.hidden && closed.ribbons === 0, JSON.stringify(closed));

  /* From the menu, both ends are yours to choose (Erick, 2026-09-30). The
     origin is the usual one; the destination starts empty and the search opens
     straight away to fill it. The card has the same two rows however it was
     opened, so the To row is there for a route from a card too. */
  console.log('\nGo from A to B, from the menu');
  const ab = await evaluate(send, `(async () => { ${w}
    const row = document.querySelector('#menu #routeMenuBtn');
    if(!row) return {row: false};
    const pick = async (q, pred) => { $('#q').value = q; runSearch();
      const i = hits.findIndex(pred); if(i < 0) return false;
      document.querySelectorAll('#results button')[i].click(); await w(900); return true; };
    const state = () => ({to: $('#routeToBtn').textContent, from: $('#routeFromBtn').textContent,
      shown: !$('#route').hidden, ribbons: routeRibbons(), steps: $('#routeText').textContent,
      searchOpen: $('#search').dataset.open === 'true', choosing: choosingPlace, hint: $('#q').placeholder});
    /* The origin a visitor chose earlier stays theirs; the test starts from the default. */
    routeFrom = {type: 'door', id: 'e-Main', name: 'Main entrance'};
    openPop('menu', true); row.click(); await w(300);
    const r = {row: true, text: row.textContent.trim(), menuClosed: $('#menu').dataset.open !== 'true', opened: state()};
    r.picked = await pick('Espai Bota', h => h.label === 'Espai Bota');
    r.chosen = state();
    $('#routeToBtn').click(); await w(200);
    r.changing = state();
    r.picked2 = await pick('Espai Vertical', h => h.label === 'Espai Vertical');
    r.other = state();
    routeClose(); openPop('menu', true); row.click(); await w(300);
    openPop(null, false); await w(200);
    r.unchosen = state();
    routeClose();
    return r;
  })()`);
  ok('the menu carries «Go from A to B»', ab.row && ab.text === 'Go from A to B', ab.text);
  ok('  ...which closes the menu and opens the card with the destination still to choose',
     ab.menuClosed && ab.opened && ab.opened.shown && /Choose destination/.test(ab.opened.to) && /Main entrance/.test(ab.opened.from) && ab.opened.ribbons === 0,
     JSON.stringify(ab.opened));
  ok('  ...and the search, open to choose it', ab.opened && ab.opened.searchOpen && ab.opened.choosing === 'to' && /Where to/.test(ab.opened.hint),
     JSON.stringify(ab.opened && [ab.opened.searchOpen, ab.opened.choosing, ab.opened.hint]));
  ok('  ...with Espai Bota chosen, the route there appears', ab.picked && /Espai Bota/.test(ab.chosen.to) && ab.chosen.ribbons === 1 && /Walk to Espai Bota/.test(ab.chosen.steps) && !ab.chosen.searchOpen,
     JSON.stringify(ab.chosen));
  ok('  ...and the destination is changed from its row', ab.changing.choosing === 'to' && ab.changing.searchOpen && ab.picked2 && /Espai Vertical/.test(ab.other.to) && ab.other.ribbons === 1,
     JSON.stringify([ab.changing.choosing, ab.picked2, ab.other.to, ab.other.ribbons]));
  ok('  ...closing the search without choosing leaves the card waiting, with no error',
     ab.unchosen.shown && /Choose destination/.test(ab.unchosen.to) && ab.unchosen.ribbons === 0 && !ab.unchosen.steps && !ab.unchosen.choosing,
     JSON.stringify(ab.unchosen));

  console.log('\nContrast');
  const CONTRAST = `(() => {
    const rgba = s => { const m = s.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
    const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
      return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
    const bg = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat(1);
    const routeCard = over(rgba(getComputedStyle(document.querySelector('#route')).backgroundColor), bg);
    const fromBtn = over(rgba(getComputedStyle(document.querySelector('#routeFromBtn')).backgroundColor), routeCard);
    /* The button is an outline now: its text reads against the sheet behind it. */
    select(GROUP['b-rosa'][0]);
    const btn = card.querySelector('.route-btn');
    const sheetBg = over(rgba(getComputedStyle(document.querySelector('.sheet-panel')).backgroundColor), bg);
    const cb = getComputedStyle(btn);
    const r = {button: ratio(rgba(cb.color), over(rgba(cb.backgroundColor), sheetBg)),
            change: ratio(rgba(getComputedStyle(document.querySelector('#routeFromBtn .change')).color), fromBtn)};
    select(null);
    return r;
  })()`;
  for (const scheme of ['dark', 'light']) {
    const tab = await connect(FILE, scheme);
    await evaluate(tab.send, `new Promise(r => setTimeout(r, 2500))`);
    await evaluate(tab.send, `(routeTo = {type: 'room', id: ${JSON.stringify(roomOf('D3'))}, name: 'D3'}, routeShow(), true)`);
    const c = await evaluate(tab.send, CONTRAST);
    ok(`${scheme} theme: the button is readable (≥ 4.5:1)`, c.button >= 4.5, c.button.toFixed(2));
    ok(`${scheme} theme: «Change» is readable (≥ 4.5:1)`, c.change >= 4.5, c.change.toFixed(2));
    await tab.close();
  }

  console.log('\n?from=');
  for (const [q, expected, name] of [['E1', {type: 'room', id: roomOf('E1')}, 'a MozFest code sets the origin in its room'],
                                     ['ZZ9', {type: 'door', id: 'e-Main'}, 'one that does not exist leaves the Main entrance']]) {
    const tab = await connect(FILE + '?from=' + q);
    await evaluate(tab.send, `new Promise(r => setTimeout(r, 2500))`);
    const o = await evaluate(tab.send, `typeof routeFrom === 'object' && routeFrom ? {type: routeFrom.type, id: routeFrom.id} : null`);
    ok(name, !!o && o.type === expected.type && o.id === expected.id, JSON.stringify(o));
    await tab.close();
  }

  console.log(`\n${pass} pass, ${fail} fail\n`);
  close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
