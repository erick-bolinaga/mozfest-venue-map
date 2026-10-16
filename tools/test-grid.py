#!/usr/bin/env python3
"""The walking grid and the doors, on the real model.

    python3 tools/test-grid.py
"""
import importlib.util, json, pathlib, sys, unittest

SRC = pathlib.Path(__file__).resolve().parent.parent / 'src'
sys.path.insert(0, str(SRC))
import routes  # noqa: E402

MODEL = json.loads((SRC / 'model.json').read_text())
SESSIONS = {k: v for k, v in json.loads((SRC / 'sessions.json').read_text()).items() if not k.startswith('_')}
KIT = (json.loads((SRC / 'event.json').read_text())['items'] +
       json.loads((SRC / 'event-by-hand.json').read_text())['items'])
DOORS = json.loads((SRC / 'doors.json').read_text())
WALKABLE = json.loads((SRC / 'walkable.json').read_text())
R = routes.build(MODEL, KIT, DOORS, WALKABLE)


def is_open(x, z):
    i, j = routes.cell_of(R, x, z)
    return routes.is_open(R, i, j)


def centre(vid):
    P = next(v for v in MODEL['vols'] if v['id'] == vid)['poly']
    return sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P)


class Grid(unittest.TestCase):
    def test_inside_la_fabrica_is_not_walkable(self):
        # La Fàbrica is drawn by its parts; the main one is its big body
        self.assertFalse(is_open(*centre('p-b-rosa-main')))

    def test_in_front_of_l_harmonias_door_is_walkable(self):
        m = next(e for e in MODEL['entrances'] if e['id'] == 'e-aster-main')
        self.assertTrue(is_open(m['x'] + 3, m['z']))

    def test_the_access_of_every_public_door_is_open(self):
        for p in R['doors']:
            with self.subTest(p['id']):
                self.assertTrue(is_open(p['ax'], p['az']))

    def test_every_public_door_is_reachable_from_the_main_entrance(self):
        missing = {p['id'] for p in R['doors']} - routes.reachable(R)
        self.assertEqual(missing, set())

    def test_d0_main_is_four_doors_of_la_fabrica(self):
        d0 = [p for p in R['doors'] if p['id'].startswith('d0-main')]
        self.assertEqual(len(d0), 4)
        for p in d0:
            self.assertIn('b-rosa', p['buildings'])
            self.assertGreater(p['ax'], p['x'])          # the plaza is east of the lobby

    def test_an_unknown_door_shows_up_in_validate(self):
        bad = dict(DOORS, **{'e-nonexistent': {'public': True}})
        self.assertTrue(any('e-nonexistent' in e for e in
                            routes.validate(routes.build(MODEL, KIT, bad))))

    def test_the_to_minus_1_door_opens_on_the_ground_floor_and_leads_to_the_basement(self):
        p = next(p for p in R['doors'] if p['id'] == 'e-salvia-to-minus-1')
        ground = next(f for f in MODEL['floors'] if f['feat'] == 'b-salvia' and f['name'] == 'Ground floor')
        self.assertEqual(p['floors']['b-salvia'], {'order': ground['level'], 'name': 'Ground floor'})
        self.assertEqual(p['towards'], 'Basement')

    def test_the_museum_door_opens_on_the_lobby_between_street_and_mezzanine(self):
        # Can Fontanet: Street level < Lobby < Mezzanine. The museum entrance
        # opens on the lobby, which is none of the museum's own floors.
        p = next(p for p in R['doors'] if p['id'] == 'e-fontanet-recinte')
        self.assertEqual(p['floors']['b-lobby-hall-can-fontanet'], {'order': '01', 'name': 'Lobby'})
        museum = p['floors']['b-mimosa-museum-can-fontanet']
        self.assertEqual(museum['name'], 'Lobby')
        self.assertTrue('01' < museum['order'] < '02', museum)

    def test_a_building_with_sessions_and_no_public_door_stops_the_build(self):
        closed = dict(DOORS, **{'e-viola-access': {'public': False}})
        err = routes.validate(routes.build(MODEL, KIT, closed), SESSIONS)
        self.assertTrue(any('b-viola' in e for e in err), err)

    def test_a_misspelt_reference_in_doors_json_shows_up_in_validate(self):
        bad = dict(DOORS)
        bad['e-salvia-to-minus-1'] = dict(DOORS['e-salvia-to-minus-1'], towards='Basment')
        bad['e-fontanet-recinte'] = dict(DOORS['e-fontanet-recinte'], serves=['b-nonexistent'])
        err = routes.validate(routes.build(MODEL, KIT, bad), SESSIONS)
        self.assertTrue(any('Basment' in e for e in err) and any('b-nonexistent' in e for e in err), err)

    def test_non_public_doors_do_not_travel(self):
        ids = {p['id'] for p in R['doors']}
        self.assertNotIn('e-lotus-sortida-emergencia', ids)
        self.assertNotIn('e-aster-sala-maquinaria-01', ids)

    def test_the_way_between_l_harmonia_and_the_music_school_is_walkable(self):
        self.assertTrue(is_open(182, 88))
        self.assertFalse(routes.is_open(routes.build(MODEL, KIT, DOORS), *routes.cell_of(R, 182, 88)))

    def test_painting_opens_and_closes_over_the_zones(self):
        # The painter (tools/walkable) works on 1 m cells over the same
        # origin: value 1 opens, 2 closes, 0 leaves the automatic grid.
        m = routes.paint_grid(R)
        def paint(x, z, v):
            I, J = int((x - m['x0']) // m['cell']), int((z - m['z0']) // m['cell'])
            cells = [0] * (m['width'] * m['height'])
            cells[J * m['width'] + I] = v
            return cells
        def rle(cells):
            out = []
            for v in cells:
                if out and out[-1][0] == v: out[-1][1] += 1
                else: out.append([v, 1])
            return out
        outside = (80.2, 40.2)                     # inside the grid, outside every zone, clear of buildings
        self.assertFalse(is_open(*outside))
        opened = routes.build(MODEL, KIT, DOORS, dict(WALKABLE, painted=dict(m, rle=rle(paint(*outside, 1)))))
        self.assertTrue(routes.is_open(opened, *routes.cell_of(opened, *outside)))
        m_ = next(e for e in MODEL['entrances'] if e['id'] == 'e-aster-main')
        plaza = (m_['x'] + 3.2, m_['z'] + 0.2)
        self.assertTrue(is_open(*plaza))
        closed = routes.build(MODEL, KIT, DOORS, dict(WALKABLE, painted=dict(m, rle=rle(paint(*plaza, 2)))))
        self.assertFalse(routes.is_open(closed, *routes.cell_of(closed, *plaza)))

    def test_0_back_is_a_public_entrance_with_no_building(self):
        # Erick, 2026-09-30: the public comes in by 0 Back too — there is a
        # volunteer on it. A gate of the venue, not a building's door.
        p = next(p for p in R['doors'] if p['id'] == 'e-Secondary')
        self.assertEqual((p['name'], p['buildings']), ('0 Back', []))

    def test_espai_verticals_stairs_and_lift_lead_to_every_floor_above_and_below(self):
        # Erick, 2026-09-30: that door opens straight onto the stairs and the lift.
        p = next(p for p in R['doors'] if p['id'] == 'e-salvia-stairs-lift')
        others = sorted(f['name'] for f in MODEL['floors'] if f['feat'] == 'b-salvia' and f['name'] != 'Ground floor')
        self.assertEqual(sorted(p['towards']), others)
        bad = dict(DOORS, **{'e-salvia-stairs-lift': dict(DOORS['e-salvia-stairs-lift'], towards=['Basement', 'Top flor'])})
        err = routes.validate(routes.build(MODEL, KIT, bad))
        self.assertTrue(any('Top flor' in e for e in err), err)

    def test_the_real_model_validates(self):
        self.assertEqual(routes.validate(R, SESSIONS), [])


if __name__ == '__main__':
    unittest.main(verbosity=1)
