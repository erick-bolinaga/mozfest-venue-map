/* Checks the public build (build.py --public -> dist/public/index.html): the
   visitor's map that participants would see. What it must not carry, and that
   what it does carry still works.

       cd src && python3 build.py --public && python3 build.py --dist
       tools/with-chrome.sh node tools/check-public.js

   The forbidden words come from src/public/public.json, the same list the
   build refuses on, and every one of those checks is first run against
   dist/index.html — the volunteers' build, which does carry all of it. A check
   that finds nothing there proves nothing here. HTML=… and CONTROL=… point it
   at other files. */
const fs = require('fs');
const path = require('path');
const { connect, evaluate } = require('./cdp.js');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.env.HTML || path.join(ROOT, 'dist', 'public', 'index.html');
const CONTROL = process.env.CONTROL || path.join(ROOT, 'dist', 'index.html');
const CONF = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'public', 'public.json'), 'utf8'));
const SESSION_HITS = require('../src/sessions.json');
const MODEL = require('../src/model.json');
for (const f of [HTML, CONTROL])
  if (!fs.existsSync(f)) { console.error(`missing ${f}: cd src && python3 build.py --public && python3 build.py --dist`); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
};

/* The data payloads, read back from the running page: the same consts the
   build filled, under the names the viewer gives them. */
const PAYLOADS = ['D', 'NAMES', 'SESSIONS', 'VIEWS', 'EVENT', 'MOZROOM',
                  'ROUTES', 'STATIONS', 'STATIONS_README'];
const readData = send => evaluate(send, `({${PAYLOADS.map(n => `${n}: JSON.stringify(${n})`).join(',')}})`);

/* What the build refuses, measured again from outside it. */
function forbidden(source, data) {
  const bad = [];
  for (const n of CONF.forbidden.everywhere) {
    const c = (source.match(new RegExp(`\\b${n}\\b`, 'gi')) || []).length;
    if (c) bad.push(`«${n}» ×${c}`);
  }
  for (const [k, txt] of Object.entries(data))
    for (const p of CONF.forbidden.in_data) {
      const m = new RegExp(p, 'i').exec(txt);
      if (m) bad.push(`${k}: «${m[0]}»`);
    }
  return bad;
}
/* Every address in the file but the two namespaces (and the source link, if set). */
const NS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml']);
if (CONF.notice.code_url) NS.add(CONF.notice.code_url);
const addresses = source => [...new Set(source.match(/https?:\/\/[^\s"'<>)]+/g) || [])].filter(u => !NS.has(u));
/* Our own script, the last one: three.js is a library and does carry fetch()
   in its loaders, which the viewer never calls. */
const ownScript = source => source.slice(source.lastIndexOf('<script>'), source.lastIndexOf('</script>'));
const NETWORK = /\bfetch\s*\(|XMLHttpRequest|document\.cookie|sendBeacon|new\s+WebSocket|new\s+EventSource/;

async function boot(file, query = '') {
  const t = await connect('file://' + file + query);
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await evaluate(t.send, `typeof INDEX !== 'undefined' && !!document.querySelector('canvas') && document.readyState === 'complete'`); } catch {}
  }
  return t;
}

(async () => {
  const source = fs.readFileSync(HTML, 'utf8');
  const controlSource = fs.readFileSync(CONTROL, 'utf8');

  /* The public page, opened the way someone trying to climb the ladder would. */
  const pub = await boot(HTML, '?dev=1&as=organiser');
  const ev = e => evaluate(pub.send, e);
  await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});

  console.log('\n== positive control: dist/index.html does carry it ==');
  const ctl = await connect('file://' + CONTROL);
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await evaluate(ctl.send, `typeof INDEX !== 'undefined' && document.readyState === 'complete'`); } catch {}
  }
  const badCtl = forbidden(controlSource, await readData(ctl.send));
  ok('the forbidden list finds something in the volunteers\' build', badCtl.length > 0,
     `${badCtl.length}: ${badCtl.slice(0, 4).join(' · ')}…`);
  /* The public repository ships stations.json empty: no build of it has a
     station to find, so the two station controls only apply where there are. */
  const hasStations = require('../src/stations.json').stations.length > 0;
  const ctlStations = await evaluate(ctl.send, `STATIONS.length`);
  if (hasStations) ok('and the volunteers\' build carries stations', ctlStations > 0, `${ctlStations}`);
  else console.log('  · no stations in this repository: the two station controls do not apply');
  const ctlZones = await evaluate(ctl.send, `D.zones.length`);
  ok('and zones', ctlZones > 0, `${ctlZones}`);
  const ctlStaff = await evaluate(ctl.send, `INDEX.filter(e => e.data && e.data.ev && e.data.ev.kind === 'crew').length +
    INDEX.filter(e => e.data && D.floors.some(f => f.rooms.some(r => r.id === e.data.id && r.kind === 'crew'))).length`);
  ok('and its search has staff places in it', ctlStaff > 0, `${ctlStaff}`);
  if (hasStations) ok('and its code, unfiltered, would name a station', /\b[A-G]\d-\d+\b/.test(JSON.stringify(await evaluate(ctl.send, `STATIONS.map(p => p.id)`))));
  /* Kit marked 'public_map': false is in the volunteers' build and only there.
     The public repository leaves it out too, so there the control does not apply. */
  const hasHidden = require('../src/event-by-hand.json').items.some(e => e.public_map === false);
  const ctlKit = await evaluate(ctl.send, `({n: EVENT.length, hidden: EVENT.filter(e => e.public_map === false).map(e => e.id),
    polys: EVENT.filter(e => e.public_map === false && e.poly).map(e => e.poly),
    grid: {bits: ROUTES.bits, width: ROUTES.width, height: ROUTES.height, x0: ROUTES.x0, z0: ROUTES.z0, cell: ROUTES.cell}})`);
  if (hasHidden) ok('and kit kept from the public', ctlKit.hidden.length > 0, ctlKit.hidden.join(' '));
  else console.log('  · no kit kept from the public in this repository: its control does not apply');
  await ctl.close();

  console.log('\n== 3a · the rung is the visitor\'s, whatever the URL asks for ==');
  const p = await ev(`({rung: RUNG, ladder: LADDER[RUNG], dev: DEV, as: AS, wb: WORKBENCH,
                       vol: atLeast('volunteer'), url: location.search})`);
  ok('with ?dev=1&as=organiser it stays a visitor', p.ladder === 'visitor', JSON.stringify(p));
  ok('no workbench (DEV and WORKBENCH off)', p.dev === false && p.wb === false && p.as === null);
  ok('no zones row, no camera readout row, no placing row', await ev(
    `!document.getElementById('zoneBtn') && !document.getElementById('roBtn') && !document.getElementById('crewBtn') && !document.getElementById('crew')`));
  ok('the camera readout panel stays hidden', await ev(`document.getElementById('readout').hidden`));
  const rows = await ev(`[...document.querySelectorAll('#menu > .row, #menu > button')].map(b => b.id || b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 9))`);
  ok('the menu is going from A to B, full screen, theme and text size', rows.includes('routeMenuBtn') && rows.includes('themeBtn') && rows.length <= 5, rows.join(', '));

  console.log('\n== 3b · no stations ==');
  ok('STATIONS empty', await ev(`Array.isArray(STATIONS) && STATIONS.length === 0`));
  ok('STATIONS_README empty', await ev(`Array.isArray(STATIONS_README) && STATIONS_README.length === 0`));
  ok('no station is drawn', await ev(`crewGroup.children.length === 0`));
  /* Since 2026-10-16 a station's code is the Book's, not computed from its
     point, so the index of spaces that did it is gone from every build:
     ESPACIOS was its name, SPACES would be its English one. */
  ok('no index of spaces', await ev(`typeof ESPACIOS === 'undefined' && typeof SPACES === 'undefined'`));

  console.log('\n== 3c · no zones ==');
  ok('D.zones empty', await ev(`Array.isArray(D.zones) && D.zones.length === 0`));
  ok('no zone is drawn', await ev(`zoneGroup.children.length === 0`));
  ok('nor their names', await ev(`!Object.keys(D.names).some(k => /^z-/.test(k))`));

  console.log('\n== 3d · staff places: «Staff only», no name, no search, no route ==');
  const staff = await ev(`({
    rooms: D.floors.flatMap(f => f.rooms.filter(r => r.kind === 'crew').map(r => [r.id, r.name])),
    kit: EVENT.filter(e => e.kind === 'crew').map(e => [e.id, e.label]),
    type: (D.kinds.crew || {}).label})`);
  const all = [...staff.rooms, ...staff.kit];
  ok('there are staff places, and they are still on the map', staff.rooms.length > 0 && staff.kit.length > 0, `${staff.rooms.length} rooms, ${staff.kit.length} of the kit`);
  ok('all of them are called «Staff only»', all.every(([, n]) => n === 'Staff only'), all.filter(([, n]) => n !== 'Staff only').join(' · '));
  ok('and their id says nothing: staff-N', all.every(([id]) => /^staff-\d+$/.test(id)), all.map(([id]) => id).join(' '));
  ok('the kind is blank: the bubble already says «Staff only»', staff.type === '', JSON.stringify(staff.type));
  ok('no staff place has a MozFest code', await ev(`Object.keys(MOZROOM).every(k => !/^staff-/.test(k))`));
  const search = q => ev(`(() => { document.getElementById('q').value = ${JSON.stringify(q)}; runSearch();
    return hits.map(h => h.label + ' | ' + h.sub); })()`);
  for (const q of ['Production', 'Staff', 'Despatx', 'Oficina', 'Interview'])
    ok(`searching «${q}» finds nothing`, (await search(q)).length === 0, (await search(q)).slice(0, 3).join(' · '));
  ok('no search entry leads to a staff place', await ev(
    `INDEX.every(e => !(e.data && (/^staff-/.test(e.data.id || '') || (e.data.ev && e.data.ev.kind === 'crew'))))`));
  /* Control: the search does still find things. */
  ok('and the search still works («Main Stage»)', (await search('Main Stage')).length > 0);
  const cardOf = id => ev(`(() => {
    const m = picks.find(x => x.userData && x.userData.id === ${JSON.stringify(id)});
    if(!m) return {missing: true};
    select(m);
    const r = {button: !!document.querySelector('#sheet .route-btn'), title: (card.querySelector('h2') || {}).textContent || null,
               bubble: document.querySelector('.worldtip').dataset.on === 'true' ? document.querySelector('.worldtip').textContent : null};
    select(null);
    return r;
  })()`);
  const kitStaff = await cardOf(staff.kit[0][0]);
  ok('the card of a staff kit item offers no Directions', !kitStaff.missing && !kitStaff.button, JSON.stringify(kitStaff));
  ok('and its bubble says «Staff only», once', kitStaff.bubble === 'Staff only', JSON.stringify(kitStaff.bubble));
  const kitStage = await cardOf('ev-stage');
  ok('a public kit item\'s card does (control)', kitStage.button, JSON.stringify(kitStage));
  /* Not even «Staff only»: a shape there would still say where. */
  const hid = await ev(`({left: EVENT.filter(e => e.public_map === false).map(e => e.id), n: EVENT.length})`);
  ok('the kit kept from the public is not there at all, not even as «Staff only»', hid.left.length === 0, hid.left.join(' '));
  ok('  ...the public kit is the volunteers\' minus exactly that', hid.n === ctlKit.n - ctlKit.hidden.length,
     `${hid.n} = ${ctlKit.n} − ${ctlKit.hidden.length}`);
  /* Nor as cells of the walking grid: decoded, ROUTES would draw the hidden kit
     as rectangles nobody walks through. The public grid must be the volunteers'
     with only those cells opened: each difference closed there and open here,
     each within the kit or its clearance (routes.py: 0.3 m, plus half a cell's
     diagonal). Without hidden kit the two grids are the same. */
  const pubGrid = await ev(`({bits: ROUTES.bits, width: ROUTES.width, height: ROUTES.height, x0: ROUTES.x0, z0: ROUTES.z0, cell: ROUTES.cell})`);
  const g = ctlKit.grid, cb = Buffer.from(g.bits, 'base64'), pb = Buffer.from(pubGrid.bits, 'base64');
  const sameFrame = ['width', 'height', 'x0', 'z0', 'cell'].every(k => g[k] === pubGrid[k]);
  const segDist = (x, z, [x1, z1], [x2, z2]) => {
    const dx = x2 - x1, dz = z2 - z1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - x1 - t * dx, z - z1 - t * dz);
  };
  const inPoly = (x, z, P) => P.reduce((c, a, i) => { const b = P[(i + 1) % P.length];
    return (a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0] ? !c : c; }, false);
  const nearKit = (x, z) => ctlKit.polys.some(P => inPoly(x, z, P)
    || P.some((a, i) => segDist(x, z, a, P[(i + 1) % P.length]) <= 0.3 + g.cell * Math.SQRT1_2));
  let diff = 0, wrongWay = 0, astray = 0;
  for (let k = 0; sameFrame && k < g.width * g.height; k++) {
    const c = (cb[k >> 3] >> (k & 7)) & 1, p = (pb[k >> 3] >> (k & 7)) & 1;
    if (c === p) continue;
    diff++;
    if (!(c === 0 && p === 1)) wrongWay++;
    if (!nearKit(g.x0 + (k % g.width + .5) * g.cell, g.z0 + (Math.floor(k / g.width) + .5) * g.cell)) astray++;
  }
  ok('the walking grid does not carry the hidden kit either: only its cells open up, nothing else changes',
     sameFrame && wrongWay === 0 && astray === 0 && (ctlKit.polys.length ? diff > 0 : diff === 0),
     `${diff} cells differ, ${wrongWay} the wrong way, ${astray} away from the kit`);

  console.log('\n== 3e · no working notes ==');
  const data = await readData(pub.send);
  const bad = forbidden(source, data);
  ok('no forbidden word (names in the whole file, notes and station codes in the data)', bad.length === 0, bad.join(' · '));
  ok('no _readme, _pending, why, caution, note, doubt or to_confirm as a key in the data',
     !Object.values(data).some(t => /"(_[a-z_]+|why|caution|note|notes|doubt|to_confirm)":/.test(t)));

  console.log('\n== 3f · the notice ==');
  /* mobile:false, like check-viewer.js: with mobile:true headless keeps a
     1280 px layout viewport and the phone is not what gets measured. */
  const notice = async (w, h) => {
    await pub.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
    await new Promise(r => setTimeout(r, 400));
    return ev(`(() => {
      const a = document.querySelector('.brand .notice'); if(!a) return {missing: true};
      const r = a.getBoundingClientRect(), cs = getComputedStyle(a);
      const clashes = ['searchBtn', 'menuBtn'].some(id => { const b = document.getElementById(id).getBoundingClientRect();
        return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom; });
      return {text: a.textContent, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right,
              vis: cs.visibility, op: +cs.opacity, disp: cs.display, clashes, width: innerWidth,
              clipped: a.scrollWidth > a.clientWidth + 1, scroll: document.documentElement.scrollWidth > innerWidth};
    })()`);
  };
  for (const [label, w, h] of [['desktop 1280', 1280, 900], ['mobile 390', 390, 844]]) {
    const a = await notice(w, h);
    ok(`${label}: the page is as wide as asked`, a.width === w, `${a.width}px`);
    ok(`${label}: it shows, whole, at the top and without covering the buttons`,
       !a.missing && a.w > 20 && a.h > 5 && a.vis === 'visible' && a.op > 0.5 && a.disp !== 'none'
       && a.top >= 0 && a.top < 120 && a.right <= a.width && !a.clashes && !a.clipped,
       JSON.stringify(a));
    ok(`${label}: no horizontal scroll`, !a.scroll);
    ok(`${label}: it says what public.json says`, a.text === CONF.notice.short, a.text);
    /* SCREENSHOTS=/a/folder leaves a picture of each size, for a person to look at. */
    if (process.env.SCREENSHOTS) {
      await ev(`(home(), invalidate(), true)`);
      await new Promise(r => setTimeout(r, 2500));
      const { data } = await pub.send('Page.captureScreenshot', {format: 'png'});
      const f = path.join(process.env.SCREENSHOTS, `public-${w}.png`);
      fs.writeFileSync(f, Buffer.from(data, 'base64'));
      console.log(`    screenshot: ${f}`);
    }
  }
  await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  const about = await ev(`(() => { const a = document.getElementById('about'); return a && {text: a.textContent.replace(/\\s+/g, ' ').trim(), links: a.querySelectorAll('a').length}; })()`);
  ok('the long notice is at the end of the menu', about && about.text.includes(CONF.notice.long), about && about.text.slice(0, 80));
  ok(CONF.notice.code_url ? 'with the link to the code' : 'no link to the code while there is no public repository',
     about && about.links === (CONF.notice.code_url ? 1 : 0));
  ok('with the fonts\' credits', about && (!CONF.notice.credits || about.text.includes(CONF.notice.credits)));
  const menuOpen = await ev(`(() => { openPop('menu', true); const m = document.getElementById('menu').getBoundingClientRect();
    const a = document.getElementById('about').getBoundingClientRect(); openPop('menu', false);
    return {fits: a.bottom <= innerHeight && a.right <= m.right + 0.5, a: a.bottom, h: innerHeight}; })()`);
  ok('with the menu open, the long notice fits on screen', menuOpen.fits, JSON.stringify(menuOpen));
  if (process.env.SCREENSHOTS) {
    await pub.send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: false});
    await ev(`(openPop('menu', true), true)`);
    await new Promise(r => setTimeout(r, 1200));
    const { data } = await pub.send('Page.captureScreenshot', {format: 'png'});
    const f = path.join(process.env.SCREENSHOTS, 'public-390-menu.png');
    fs.writeFileSync(f, Buffer.from(data, 'base64'));
    console.log(`    screenshot: ${f}`);
    await ev(`(openPop('menu', false), true)`);
    await pub.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  }

  console.log('\n== 3g · no network ==');
  const addrs = addresses(source);
  ok('no http(s) address but the namespaces', addrs.length === 0, addrs.slice(0, 3).join(' '));
  ok('control: the address detector does find one', addresses('<a href="https://example.org/x">').length === 1);
  ok('our code calls no fetch, XHR, cookies, beacons or sockets', !NETWORK.test(ownScript(source)), (ownScript(source).match(NETWORK) || [''])[0]);
  ok('control: the network detector does see a fetch(', NETWORK.test('x=fetch("a")'));
  /* And measured, not read: reload with the network watched. */
  const requested = [];
  pub.send.on('Network.requestWillBeSent', e => requested.push(e.request.url));
  await pub.send('Network.enable');
  await pub.send('Page.reload', {ignoreCache: true});
  for (let i = 0, up = false; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { up = await ev(`typeof INDEX !== 'undefined' && document.readyState === 'complete'`); } catch {}
  }
  await new Promise(r => setTimeout(r, 1500));
  const external = requested.filter(u => !u.startsWith('file://') && !u.startsWith('data:') && !u.startsWith('blob:'));
  ok('loading asks nothing of the network', requested.length > 0 && external.length === 0,
     `${requested.length} requests, all local${external.length ? '; external: ' + external.slice(0, 3).join(' ') : ''}`);
  ok('no cookies', await ev(`document.cookie === ''`));

  console.log('\n== and the visitor\'s side still works ==');
  /* A session room the visitor would look for, asked of the data. */
  const publicRoom = Object.keys(SESSION_HITS).find(k => !k.startsWith('_') &&
    MODEL.floors.some(f => f.rooms.some(r => r.id === k && r.kind !== 'crew')));
  const route = await ev(`(() => { const r = routeBetween({type: 'door', id: 'e-Main'}, {type: 'room', id: ${JSON.stringify(publicRoom)}});
    return r && {points: (r.points || []).length, metres: r.metres, error: r.error || null}; })()`);
  ok(`a route from the entrance to ${publicRoom} comes out`, route && route.points > 1 && !route.error, JSON.stringify(route));
  ok('the sessions are all there', await ev(`Object.values(SESSIONS).reduce((a, l) => a + l.length, 0)`) ===
     Object.entries(SESSION_HITS).filter(([k]) => !k.startsWith('_')).reduce((a, [, l]) => a + l.length, 0));

  await pub.close();
  console.log(`\n${pass} pass, ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
