# Recinte Fabra i Coats · 3D map for MozFest 2026

An unofficial 3D map of the Recinte Fabra i Coats (Carrer de Sant Adrià 20,
Sant Andreu, Barcelona), where the Mozilla Festival takes place on 28–30
October 2026. Made by a community volunteer, Erick León Bolinaga.

**It is not a survey.** The scale was taken from photos and printed plans;
footprints and floor plans are the most reliable part, most heights are
estimated, and the festival set-up is provisional and can still change. The
printed map is the official one.

## Build

    cd fuente
    python3 armar.py --publico      # -> dist/publico/index.html, the public map

The page is a single HTML file with everything embedded (Three.js, fonts,
data): it makes no network request, sets no cookie and needs no server. If
`fuente/vendor/` is missing, `python3 traer-dependencias.py` fetches it once.
`python3 armar.py` builds the full viewer as `fabraicoats-3d.html`.

## How the model is made

The venue was traced in Figma and exported as `fuente/mapa.svg`; the
`leer-*.py` readers turn its layers into `modelo.json` (volumes, roofs,
facades, floors, rooms, the festival's set-up), and hand-written JSON adds
what a drawing cannot say (heights, windows, names). `armar.py` joins the 23
pieces of `fuente/visor/` with the data into one page and checks it.

## Tests

    python3 herramientas/probar-rutas.py
    herramientas/con-chrome.sh node herramientas/medir-publico.js
    herramientas/con-chrome.sh node herramientas/medir-rutas.js

The browser checks need Chrome; `con-chrome.sh` runs it headless in its own
process group and closes it.

## Licence

Mozilla Public License 2.0 (`LICENSE`). Three.js, the fonts and the Mozilla
logos keep their own terms: see `NOTICE.md`.
