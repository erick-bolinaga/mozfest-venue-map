#!/usr/bin/env python3
"""Pull the traced ground areas from map.svg into model.json.

    python3 read-areas.py [--check | --write]

The third piece of the lost SVG pipeline. An `a-` layer is a patch of ground
the venue has and nothing is built on: a garden, a passage, a corridor between
buildings. The viewer paints them flat on purpose — extruding them would read
as buildings, which is exactly the confusion they prevent.

It EXTENDS and never rewrites, for a reason that matters here more than
anywhere else: the pipeline that was lost did not treat every `a-` layer the
same way. The cage became wire, the pitch became a football pitch, the garden
became a volume with a wall. Re-deriving those as flat ground would undo work
that cannot be recovered from the SVG. So an area the model already knows in
ANY form is left exactly as it is, and only genuinely new layers are added.

    --check   read the SVG, compare against model.json, change nothing
    --write   add the new areas to model.json
"""
import json, pathlib, re, sys, importlib.util
import xml.etree.ElementTree as ET

here = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('read_svg', here / 'read-svg.py')
L = importlib.util.module_from_spec(spec); spec.loader.exec_module(L)


def read(svg):
    """Every a- layer, keyed by the id without its bracket. The bracket is the
    label, the way it is everywhere else in this project."""
    out = {}
    for s in L.shapes(ET.parse(svg).getroot()):
        raw = s['id'] or ''
        if not raw.startswith('a-') or len(s['px']) < 3:
            continue
        br = re.search(r'\(([^)]*)\)', raw)
        aid = re.sub(r'\s*\([^)]*\)', '', raw).strip()
        poly = [[round(x / L.PX_PER_M, 2), round(y / L.PX_PER_M, 2)] for x, y in s['px']]
        if abs(L.area([tuple(p) for p in poly])) < 0.4:
            continue                       # a stray handle, not a patch of ground
        out[aid] = {'poly': poly, 'label': br.group(1).strip() if br else None,
                    'area': round(abs(L.area([tuple(p) for p in poly])), 1)}
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    model = json.loads((here / 'model.json').read_text())
    areas = read(here / 'map.svg')

    # Known in any form at all: as a block, as a volume, or merely as a name.
    # The cage and the pitch appear only in the last two, and re-adding them as
    # flat ground would double-draw them.
    known = ({b['id'] for b in model['blocks']}
                 | {v['id'] for v in model['vols']}
                 | set(model['names']))
    new = {k: v for k, v in areas.items() if k not in known}

    # A bracket put on an area the model already knows renames it and nothing
    # else: the geometry stays as it was, the way the docstring promises.
    relabelled = {k: v['label'] for k, v in areas.items()
                 if k in known and v['label'] and model['names'].get(k) != v['label']}

    print(f'{len(areas)} areas read from the SVG, {len(known & set(areas))} already in the model')
    print(f'  new: {len(new)}')
    for k, v in sorted(new.items()):
        print(f'     {k:38s} {v["area"]:7.1f} m2   {v["label"] or "(no label)"}')
    print(f'  relabelled: {len(relabelled)}')
    for k, lab in sorted(relabelled.items()):
        print(f'     {k:38s} {model["names"].get(k)!r} -> {lab!r}')

    if mode == '--write':
        for k, v in sorted(new.items()):
            model['blocks'].append({'id': k, 'cls': 'area', 'poly': v['poly']})
            model['names'][k] = v['label'] or k
        for k, lab in relabelled.items():
            model['names'][k] = lab
        (here / 'model.json').write_text(json.dumps(model, ensure_ascii=False) + '\n')
        print('model.json updated' if (new or relabelled) else 'nothing to add')
    else:
        print('(--check: nothing written)')


if __name__ == '__main__':
    main()
