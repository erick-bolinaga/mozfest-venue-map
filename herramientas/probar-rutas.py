#!/usr/bin/env python3
"""The walking grid and the doors, on the real model.

    python3 herramientas/probar-rutas.py
"""
import importlib.util, json, pathlib, sys, unittest

FUENTE = pathlib.Path(__file__).resolve().parent.parent / 'fuente'
sys.path.insert(0, str(FUENTE))
import rutas  # noqa: E402

MODELO = json.loads((FUENTE / 'modelo.json').read_text())
SESIONES = {k: v for k, v in json.loads((FUENTE / 'sesiones.json').read_text()).items() if not k.startswith('_')}
EVENTO = (json.loads((FUENTE / 'evento.json').read_text())['items'] +
          json.loads((FUENTE / 'servicios.json').read_text())['items'])
PUERTAS = json.loads((FUENTE / 'puertas.json').read_text())
PASO = json.loads((FUENTE / 'paso.json').read_text())
R = rutas.construir(MODELO, EVENTO, PUERTAS, PASO)


def abierta(x, z):
    i, j = rutas.celda(R, x, z)
    return rutas.abierta(R, i, j)


def centro(vid):
    P = next(v for v in MODELO['vols'] if v['id'] == vid)['poly']
    return sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P)


class Cuadricula(unittest.TestCase):
    def test_dentro_de_la_fabrica_no_se_pisa(self):
        # La Fàbrica is drawn by its parts; the main one is its big body
        self.assertFalse(abierta(*centro('p-b-rosa-main')))

    def test_delante_de_la_puerta_de_l_harmonia_si(self):
        m = next(e for e in MODELO['entrances'] if e['id'] == 'e-aster-main')
        self.assertTrue(abierta(m['x'] + 3, m['z']))

    def test_el_acceso_de_cada_puerta_publica_esta_abierto(self):
        for p in R['puertas']:
            with self.subTest(p['id']):
                self.assertTrue(abierta(p['ax'], p['az']))

    def test_todas_las_puertas_publicas_se_alcanzan_desde_la_main_entrance(self):
        faltan = {p['id'] for p in R['puertas']} - rutas.alcanzables(R)
        self.assertEqual(faltan, set())

    def test_d0_main_son_cuatro_puertas_de_la_fabrica(self):
        d0 = [p for p in R['puertas'] if p['id'].startswith('d0-main')]
        self.assertEqual(len(d0), 4)
        for p in d0:
            self.assertIn('b-rosa', p['edificios'])
            self.assertGreater(p['ax'], p['x'])          # the plaza is east of the lobby

    def test_una_puerta_desconocida_sale_en_validar(self):
        malas = dict(PUERTAS, **{'e-no-existe': {'publica': True}})
        self.assertTrue(any('e-no-existe' in e for e in
                            rutas.validar(rutas.construir(MODELO, EVENTO, malas))))

    def test_la_puerta_to_minus_1_da_al_bajo_y_lleva_al_sotano(self):
        p = next(p for p in R['puertas'] if p['id'] == 'e-salvia-to-minus-1')
        bajo = next(f for f in MODELO['floors'] if f['feat'] == 'b-salvia' and f['name'] == 'Ground floor')
        self.assertEqual(p['plantas']['b-salvia'], {'orden': bajo['level'], 'nombre': 'Ground floor'})
        self.assertEqual(p['hacia'], 'Basement')

    def test_la_puerta_del_museo_da_al_lobby_entre_la_calle_y_el_altillo(self):
        # Can Fontanet: Street level < Lobby < Mezzanine. The museum entrance
        # opens on the lobby, which is none of the museum's own floors.
        p = next(p for p in R['puertas'] if p['id'] == 'e-fontanet-recinte')
        self.assertEqual(p['plantas']['b-lobby-hall-can-fontanet'], {'orden': '01', 'nombre': 'Lobby'})
        museo = p['plantas']['b-mimosa-museum-can-fontanet']
        self.assertEqual(museo['nombre'], 'Lobby')
        self.assertTrue('01' < museo['orden'] < '02', museo)

    def test_un_edificio_con_programa_sin_puerta_publica_para_la_construccion(self):
        cerrada = dict(PUERTAS, **{'e-viola-access': {'publica': False}})
        err = rutas.validar(rutas.construir(MODELO, EVENTO, cerrada), SESIONES)
        self.assertTrue(any('b-viola' in e for e in err), err)

    def test_una_referencia_mal_escrita_en_puertas_json_sale_en_validar(self):
        mala = dict(PUERTAS)
        mala['e-salvia-to-minus-1'] = dict(PUERTAS['e-salvia-to-minus-1'], hacia='Basment')
        mala['e-fontanet-recinte'] = dict(PUERTAS['e-fontanet-recinte'], sirve=['b-no-existe'])
        err = rutas.validar(rutas.construir(MODELO, EVENTO, mala), SESIONES)
        self.assertTrue(any('Basment' in e for e in err) and any('b-no-existe' in e for e in err), err)

    def test_las_no_publicas_no_viajan(self):
        ids = {p['id'] for p in R['puertas']}
        self.assertNotIn('e-lotus-sortida-emergencia', ids)
        self.assertNotIn('e-aster-sala-maquinaria-01', ids)

    def test_el_paso_entre_l_harmonia_y_la_escola_de_musica_se_pisa(self):
        self.assertTrue(abierta(182, 88))
        self.assertFalse(rutas.abierta(rutas.construir(MODELO, EVENTO, PUERTAS), *rutas.celda(R, 182, 88)))

    def test_lo_pintado_abre_y_cierra_encima_de_las_zonas(self):
        # The painter (herramientas/pisable) works on 1 m cells over the same
        # origin: value 1 opens, 2 closes, 0 leaves the automatic grid.
        m = rutas.malla_pintura(R)
        def pintar(x, z, v):
            I, J = int((x - m['x0']) // m['celda']), int((z - m['z0']) // m['celda'])
            celdas = [0] * (m['ancho'] * m['alto'])
            celdas[J * m['ancho'] + I] = v
            return celdas
        def rle(celdas):
            out = []
            for v in celdas:
                if out and out[-1][0] == v: out[-1][1] += 1
                else: out.append([v, 1])
            return out
        fuera = (80.2, 40.2)                       # inside the grid, outside every zone, clear of buildings
        self.assertFalse(abierta(*fuera))
        abre = rutas.construir(MODELO, EVENTO, PUERTAS, dict(PASO, pintado=dict(m, rle=rle(pintar(*fuera, 1)))))
        self.assertTrue(rutas.abierta(abre, *rutas.celda(abre, *fuera)))
        m_ = next(e for e in MODELO['entrances'] if e['id'] == 'e-aster-main')
        plaza = (m_['x'] + 3.2, m_['z'] + 0.2)
        self.assertTrue(abierta(*plaza))
        cierra = rutas.construir(MODELO, EVENTO, PUERTAS, dict(PASO, pintado=dict(m, rle=rle(pintar(*plaza, 2)))))
        self.assertFalse(rutas.abierta(cierra, *rutas.celda(cierra, *plaza)))

    def test_0_back_es_una_entrada_publica_sin_edificio(self):
        # Erick, 2026-09-30: the public comes in by 0 Back too — there is a
        # volunteer on it. A gate of the venue, not a building's door.
        p = next(p for p in R['puertas'] if p['id'] == 'e-Secondary')
        self.assertEqual((p['nombre'], p['edificios']), ('0 Back', []))

    def test_la_escalera_y_el_ascensor_de_espai_vertical_llevan_a_todas_las_plantas_de_arriba_y_abajo(self):
        # Erick, 2026-09-30: that door opens straight onto the stairs and the lift.
        p = next(p for p in R['puertas'] if p['id'] == 'e-salvia-stairs-lift')
        otras = sorted(f['name'] for f in MODELO['floors'] if f['feat'] == 'b-salvia' and f['name'] != 'Ground floor')
        self.assertEqual(sorted(p['hacia']), otras)
        mala = dict(PUERTAS, **{'e-salvia-stairs-lift': dict(PUERTAS['e-salvia-stairs-lift'], hacia=['Basement', 'Top flor'])})
        err = rutas.validar(rutas.construir(MODELO, EVENTO, mala))
        self.assertTrue(any('Top flor' in e for e in err), err)

    def test_el_modelo_real_valida(self):
        self.assertEqual(rutas.validar(R, SESIONES), [])


if __name__ == '__main__':
    unittest.main(verbosity=1)
