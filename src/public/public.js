
/* ---------- the public build only ----------
   build.py --public puts this right after the search is built; the working
   build never sees it. Staff-only places stay on the map — they are there, and
   a gap in the drawing would be stranger than a label — but nobody is sent to
   them: out of the search, and so out of either end of a route, which is
   chosen with the search. The room card's own button never offers them
   (the visitor's rung gives crew rooms a bubble, not a card), and the kit's
   card is patched by build.py not to. */
{
  const STAFF = new Set([
    ...D.floors.flatMap(f => (f.rooms || []).filter(r => r.kind === 'crew').map(r => r.id)),
    ...EVENT.filter(e => e.kind === 'crew').map(e => e.id)]);
  for(let i = INDEX.length; i--;){
    const d = INDEX[i].data || {};
    if(STAFF.has(d.id) || (d.ev && d.ev.kind === 'crew')) INDEX.splice(i, 1);
  }
}
