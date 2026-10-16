# Recinte Fabra i Coats · 3D map for MozFest 2026

An unofficial 3D map of the Recinte Fabra i Coats (Carrer de Sant Adrià 20,
Sant Andreu, Barcelona), where the Mozilla Festival takes place on 28–30
October 2026. Made by a community volunteer, Erick León Bolinaga.

**It is not a survey.** The scale was taken from photos and printed plans;
footprints and floor plans are the most reliable part, most heights are
estimated, and the festival set-up is provisional and can still change. The
printed map is the official one.

## Build

    cd src
    python3 build.py --public      # -> dist/public/index.html, the public map

The page is a single HTML file with everything embedded (Three.js, fonts,
data): it makes no network request, sets no cookie and needs no server. If
`src/vendor/` is missing, `python3 fetch-vendor.py` fetches it once.
`python3 build.py` builds the full viewer as `fabraicoats-3d.html`.

## How the model is made

The venue was traced in Figma and exported as `src/map.svg`; the
`read-*.py` readers turn its layers into `model.json` (volumes, roofs,
facades, floors, rooms, the festival's set-up), and hand-written JSON adds
what a drawing cannot say (heights, windows, names). `build.py` joins the 23
pieces of `src/viewer/` with the data into one page and checks it.

## Tests

    python3 tools/test-grid.py
    tools/with-chrome.sh node tools/check-public.js
    tools/with-chrome.sh node tools/check-routes.js

The browser checks need Chrome; `with-chrome.sh` runs it headless in its own
process group and closes it.

## Licence

Mozilla Public License 2.0 (`LICENSE`). Three.js, the fonts and the Mozilla
logos keep their own terms: see `NOTICE.md`.
