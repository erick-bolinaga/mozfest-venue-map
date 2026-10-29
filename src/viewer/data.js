const D = __DATA__;

/* Developer mode is not a rung on the profile ladder: it is a different
   audience of one. It carries what only the person building this needs — the
   layer id a shape came from, a height and whether it was measured or guessed.
   Turned on with ?dev=1, which is deliberately not discoverable, because for
   everyone else it is noise in front of the thing they came to look at. */
const DEV = new URLSearchParams(location.search).has('dev');

/* ---------- the profile ladder (spec section 3) ----------
   One variable, and everything asks "do I reach this rung?". The four nest —
   each is the one below plus something — so four separate interfaces would be
   four times the code and four places to forget something.

   None of these is a door yet. Rungs 0 and 1 are to become a menu choice and 2
   and 3 a credential, and neither is built. What IS needed now is to look at
   the map through each of them, so ?as= is honoured ONLY next to ?dev=1:
   impersonation is a workbench tool and must never become the way in. */
const LADDER = ['visitor', 'volunteer', 'captain', 'organiser'];
const asked = new URLSearchParams(location.search).get('as');
const AS = DEV && LADDER.includes(asked) ? asked : null;
/* With no ?as= everybody stands on the volunteer rung, the developer included
   (Erick, 2026-09-30): the map is for captains and volunteers, so what they
   see is what opens. The visitor's view is still one ?dev=1&as=visitor away.
   The address bar says what is being looked at and nothing is inferred, which
   is the whole point of driving this from the URL instead of a badge. */
const RUNG_DEFAULT = LADDER.indexOf('volunteer');
const RUNG = AS ? LADDER.indexOf(AS) : RUNG_DEFAULT;
const atLeast = name => RUNG >= LADDER.indexOf(name);
/* The developer's own instruments — layer ids, heights and where they came
   from, the camera readout — are not a rung: they belong to nobody on the
   ladder. They go the moment you look through someone else's eyes, because
   seeing exactly what a visitor sees is the only thing the selector is for. */
const WORKBENCH = DEV && !AS;

/* A building carries up to two names: what it is called at the venue, and the
   plant MozFest gave it — Museum Can Fontanet is Mimosa. Both are written by
   hand in names.json and kept out of the traced model, which is regenerated
   from the SVG and would lose them. Either name can be missing. */
const NAMES = __NAMES__;
/* The programme, by room id. REAL since 2026-09-10: read-programme.py pulls it
   from Accelevents, the organisation's own scheduler, and hangs each session
   off the room its code maps to. Re-run that at the start of a session — the
   programme is edited whenever the organisation likes. Same
   reasoning as the names: written by hand, so kept out of the traced model that
   gets regenerated from the SVG. build.py refuses to build if a key here names
   a room the model does not have, because a session filed under a room nobody
   can reach simply never appears. */
const SESSIONS = __SESSIONS__;
/* The booths and art pieces of the app's Expo, from src/booths.json: the list
   is the API's, where each one stands is by hand (2026-10-29). Only the placed
   ones arrive, each with the room or piece of kit it hangs from. */
const BOOTHS = __BOOTHS__;
/* What MozFest calls each traced room, from src/venue.json.
   The venue's name and MozFest's are two names for the same room — Aula 9 is
   Escolta, and Rosa's foyer is D2 — and which one is which matters when
   someone says either of them over the radio. Until now only the buildings
   could show both. */
const MOZROOM = __MOZFEST__;
/* Routes from A to B: a 0.5 m grid of where people can walk (a bitmask, row by
   row) and the doors a route may use, with the floor each one opens on. Built
   by build.py from src/routes.py and src/doors.json; searched in
   routes.js. */
const ROUTES = __ROUTES__;
/* Where each volunteer goes, from src/stations.json. A post with a `room` is
   indoors and is drawn on that floor's plan; without one it is outdoors and
   stands on the venue. They are placed from the viewer itself and saved by
   pasting the JSON into that file: placing is by eye and by plan, keeping it
   is git's job. Each carries the code, the place and the priority from the
   Book of Answers, which numbers by zone (since 2026-10-16). */
const STATIONS = __STATIONS__;
/* The file's notes, so the viewer can hand it back whole. */
const STATIONS_README = __STATIONS_README__;
/* A drag on the plan ends in a click that must not pick a room. */
var planDragged = false;
/* A part beats its building, for the venue name and for the MozFest key alike.
   Salvia's two halves are the Habitatge and Espai Vertical, and only Espai
   Vertical is Building F; of Àster, only L'Harmonia is Building B. While the
   keys were flower names the whole building shared one, and that is what
   would now call Àster's nave Building B. */
const siteName = (id, of) => (NAMES[id] || {}).site || (NAMES[of] || {}).site || null;
const mozKey   = (id, of) => (NAMES[id] || {}).key || (NAMES[of] || {}).key || null;

