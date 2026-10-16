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
const LADDER = ['visitante', 'voluntario', 'capitan', 'organizador'];
const asked = new URLSearchParams(location.search).get('as');
const AS = DEV && LADDER.includes(asked) ? asked : null;
/* With no ?as= everybody stands on the volunteer rung, the developer included
   (Erick, 2026-09-30): the map is for captains and volunteers, so what they
   see is what opens. The visitor's view is still one ?dev=1&as=visitante away.
   The address bar says what is being looked at and nothing is inferred, which
   is the whole point of driving this from the URL instead of a badge. */
const RUNG_SIN_PARAMETROS = LADDER.indexOf('voluntario');
const RUNG = AS ? LADDER.indexOf(AS) : RUNG_SIN_PARAMETROS;
const atLeast = name => RUNG >= LADDER.indexOf(name);
/* The developer's own instruments — layer ids, heights and where they came
   from, the camera readout — are not a rung: they belong to nobody on the
   ladder. They go the moment you look through someone else's eyes, because
   seeing exactly what a visitor sees is the only thing the selector is for. */
const WORKBENCH = DEV && !AS;

/* A building carries up to two names: what it is called at the venue, and the
   plant MozFest gave it — Museum Can Fontanet is Mimosa. Both are written by
   hand in nombres.json and kept out of the traced model, which is regenerated
   from the SVG and would lose them. Either name can be missing. */
const NAMES = __NOMBRES__;
/* The programme, by room id. REAL since 2026-09-10: leer-programa.py pulls it
   from Accelevents, the organisation's own scheduler, and hangs each session
   off the room its code maps to. Re-run that at the start of a session — the
   programme is edited whenever the organisation likes. Same
   reasoning as the names: written by hand, so kept out of the traced model that
   gets regenerated from the SVG. armar.py refuses to build if a key here names
   a room the model does not have, because a session filed under a room nobody
   can reach simply never appears. */
const SESSIONS = __SESIONES__;
/* Cómo llama MozFest a cada sala trazada, desde fuente/mozfest-recinto.json.
   El nombre del recinto y el de MozFest son dos nombres de una misma sala
   —Aula 9 es Escolta, y el foyer de Rosa es D2— y quién dice cuál importa
   cuando alguien nombra uno de los dos por radio. Hasta ahora solo los
   edificios podían enseñar los dos. */
const MOZROOM = __MOZFEST__;
/* Routes from A to B: a 0.5 m grid of where people can walk (a bitmask, row by
   row) and the doors a route may use, with the floor each one opens on. Built
   by armar.py from fuente/rutas.py and fuente/puertas.json; searched in
   rutas.js. */
const RUTAS = __RUTAS__;
/* Dónde va cada voluntario, de fuente/voluntarios.json. Un puesto con `sala`
   es de dentro y se dibuja sobre el plano de esa planta; sin ella es de fuera
   y se planta en el recinto. Se colocan desde el propio visor y se guardan
   pegando el JSON en ese archivo: colocar es de ojo y de plano, guardarlo es
   de git. Cada uno lleva el código, el sitio y la prioridad del Book of
   Answers, que numera por zona (desde el 2026-10-16). */
const PUESTOS = __VOLUNTARIOS__;
/* Las notas del archivo, para devolverlo entero desde el visor. */
const PUESTOS_LEEME = __VOLUNTARIOS_LEEME__;
/* Un arrastre sobre el plano acaba en un clic que no debe elegir sala. */
var planArrastre = false;
/* A part beats its building, for the venue name and for the MozFest key alike.
   Salvia's two halves are the Habitatge and Espai Vertical, and only Espai
   Vertical is Building F; of Àster, only L'Harmonia is Building B. While the
   keys were flower names the whole building shared one, and that is what
   would now call Àster's nave Building B. */
const siteName = (id, of) => (NAMES[id] || {}).sitio || (NAMES[of] || {}).sitio || null;
const mozKey   = (id, of) => (NAMES[id] || {}).clave || (NAMES[of] || {}).clave || null;

