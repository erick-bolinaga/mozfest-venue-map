# Notas técnicas del modelo · Recinte Fabra i Coats

Lo aprendido construyendo Rosa. Sirve de referencia para los edificios que quedan.

---

## Dos superficies en el mismo plano se turnan, y eso parpadea

**45 pares de volúmenes** del modelo tienen la tapa exactamente a la misma
altura y las huellas solapadas. No es un descuido: son partes de un mismo
edificio que llegan arriba a la vez, más el engorde de 30 cm que cierra las
juntas y las hace solaparse por fuerza.

Cuando dos superficies caen en el mismo plano, ninguna está delante, y la que
gana el test de profundidad cambia con el ángulo y con el zoom. Se ve como un
parpadeo que aparece y desaparece al mover la vista.

**Casi ninguno se nota, y por eso llevaba ahí desde siempre**: los dos lados
suelen compartir material, y una pelea entre dos superficies idénticas es
invisible. La destapó la marquesina de Can Fontanet al pasar a chapa el
2026-09-10, porque enfrente tenía el rojizo del tapa del lobby.

Hacen falta las dos cosas, y por motivos distintos:

- **`matCap` cede la profundidad** (`polygonOffset`). Es la regla de la
  construcción: un tapa es la lámina que cierra un volumen, y lo que aparezca
  a esa misma altura está apoyado encima. Cubre los 45 pares de una vez y no
  toca la geometría. Pero es un sesgo del rasterizador y **no le llega al
  rayo**: al apuntar, el empate sigue.
- **Despegar la geometría.** La marquesina pasó de 22 a 26 cm de canto —
  arranca igual en 3,48, que es el número del que depende la regla de qué
  tapa qué, y su cara de arriba sube de 3,70 a 3,74. Con eso deja de haber
  empate, ni para dibujar ni para apuntar.

**Cómo se distingue de una oclusión**, que es lo que más despista al medirlo:
una pelea de profundidad **alterna** con el zoom sin patrón; un vecino tapando
da un **umbral monótono** —limpio hasta cierta distancia y tapado a partir de
ahí— y el rayo, que no sabe de `polygonOffset`, dice el nombre del vecino.
En Can Fontanet los ángulos que seguían saliendo rojizos eran `t-b-citc-1`,
una cubierta del CITC realmente delante.


## La cadena

```
frame-mozfest-map.svg          ← única fuente de verdad
   ├─ build_site.py     →  site.json     huellas, zonas, entradas, partes
   ├─ build_floors.py   →  floors.json   plantas y salas
   └─ build_three.py    →  three.json    volúmenes, cubiertas, huecos, muros
                             ↓
              three.html + datos = visor 3D
```

Escala confirmada: **5,8136 px/m**. Validada contra las cotas impresas del deck — el Art Tent da 288 m² exactos.

---

## Prefijos de capa

| | |
|---|---|
| `b-` | edificio |
| `p-b-<edificio>-<parte>` | volumen con cubierta propia |
| `f-NN-<edificio>` | contorno interior de una planta |
| `r-NN-<edificio>-<sala>` | sala |
| `v-NN-<edificio>-<hueco>` | vacío o atrio |
| `up-<edificio>-<escalera>` | flecha, trazada **siempre subiendo** |
| `e-<edificio>-<puerta>` | entrada |
| `a-` | área del recinto |
| `bb-` `ba-` | manzanas y edificios de fuera → **planos, sin volumen** |
| `b-reference-*` | edificios de referencia → volumen translúcido |
| `z-A` … `z-F` | zonas del evento |

**Regla de oro**: los muros no se dibujan. Son el hueco entre polígonos. Traza por la cara interior y el grosor sale solo.

---

## Cómo se define una fachada

No se enumeran ventanas: se declara una retícula y se generan.

```python
{'foot':'p-b-rosa-main', 'edge':6, 'expect':63.53,
 'label':'Rosa window', 'arch':0.12,
 'grid':{'cols':8,'rows':4,'w':...,'h':...,'sill':...,
         'vgap':...,'hgap':...,'edge':...,'panes':[3,4]}}
```

- `expect` guarda la longitud que tenía la cara al escribirla. Si retrazas el volumen, **avisa**.
- Mejor que `edge` fijo es `match_len` + `edge_offset`: localiza la cara por su longitud y sobrevive a un retrazado.
- `door` en un hueco lo baja al suelo con puerta abajo y cristal encima.

**Calibrar por foto**: rectángulo sobre una foto frontal + un ancho conocido del plano → px/m. Con eso salen alturas, ventanas y separaciones. El lobby (13,49 m de fachada) validó el método al centímetro: los cuatro huecos y sus separaciones sumaban exactamente esa cifra.

---

## Los quince errores que costaron tiempo

### Del SVG

1. **Los grupos de Figma se tragan el id.** Un `<g id="x">` con la geometría en un hijo sin nombre desaparecía sin dar error. El parser hereda el id hacia abajo.
2. **Figma duplica la geometría dentro del grupo.** Hay que descartar la repetición exacta.
3. **Las transformaciones se componen de derecha a izquierda.** `translate(...) rotate(...)` es translate(rotate(p)), no al revés.
4. **Una capa oculta no se exporta.** Bloquear es seguro; apagar el ojo, no. Cuidado con los grupos ocultos.
5. **Un `f-` con sufijo de sala sobrescribe el contorno de la planta.** El parser ahora lo descarta con aviso.

### De geometría

6. **Contar vértices dentro de un polígono miente** cuando dos formas comparten borde: un punto justo sobre la línea no está "dentro". Medir **distancia**, no pertenencia.
7. **La normal exterior por centroide falla en polígonos cóncavos.** En un borde entrante da la dirección contraria. Deducirla del **sentido de giro** del polígono.
8. **El determinante de la base indica si una cara será invisible.** Si al construir la base con (dirección, vertical, normal) sale negativo, la geometría queda espejada y mira hacia dentro.
9. **Una tapa horizontal girada +90° apunta al suelo.** El edificio se queda sin techo.
10. **Los triángulos de cubierta salían enrollados al revés** porque el producto vectorial de los ejes del rectángulo da hacia abajo en este sistema.

→ Solución general para 8, 9 y 10: **dibujar los cascarones a dos caras**.

### De renderizado

11. **Un agujero en un panel puesto sobre un prisma macizo no es un agujero**: se ve el prisma detrás. Los volúmenes con ventanas se construyen **huecos** — tapa arriba, un paño por lado, forro oscuro retranqueado.
12. **Codificación lineal de salida** sube todos los medios tonos y lava la escena. `outputEncoding = sRGBEncoding`.
13. **Los materiales clonados no se enteran del cambio de tema.** Usar materiales compartidos.
14. **El contraste luz/sombra depende de la proporción** entre direccional y ambiental, no de la intensidad absoluta.
15. **El descarte de caras tapadas debe comparar alturas**, no solo posición en planta. Una torre de 37 m junto a una nave de 26 sí tiene fachada vista arriba.

### De método

16. **Un script que aborta a mitad no guarda nada.** Si el archivo se escribe al final, un fallo en la comprobación número siete descarta las seis anteriores. Verificar después de cada cambio, no antes.
17. **Buscar en la salida filtrada esconde los errores.** Filtrar por las líneas que interesan ocultó un `NameError` durante dos rondas.
18. **Un valor fijo en el renderizador anula cualquier ajuste en los datos.** Un `+0.10` olvidado hizo inútiles cuatro rondas de afinado.

---

## Qué se traza y qué no

**Sí**: muros, puertas, escaleras, ascensores, baños, pilares de fundición, huecos de fachada.

**No**: mesas, sillas, escenarios, carpas, food trucks, redes de entrenamiento, carruajes de museo. Todo eso es capa de evento — cambia entre el montaje y el domingo.

---

## Volúmenes con ventanas ancladas

Retrazar estos rompe las fachadas. El aviso de `expect` lo detecta, pero mejor no tocarlos sin rehacer las reglas:

```
p-b-rosa-main            p-b-rosa-back-block-first
p-b-rosa-tower-stairs-1  p-b-rosa-back-block-last
p-b-rosa-tower-stairs-2  b-rosa-lobby / p-b-rosa-lobby-fence
```

## Huecos añadidos a mano (2026-09-14)

**`p-b-rosa-main`, arista 1** — la pared corta de 4,9 m junto a la caseta de
la oficina del personal, que mira al oeste. En el modelo era ciega, y en git lo fue siempre:
sus ventanas se perdieron con el lector de geometría. Erick las echó en falta
y se añadieron: una columna de cuatro, copiadas de la última columna de la
fachada larga (2,78 × 4,43 m, arco 0,12, alféizares 1,13 / 7,47 / 13,81 /
20,15) y centradas en el paño. **Una columna es suposición.** Viven en
`fachadas.json` (muro `p-b-rosa-main` arista 1), como todas las demás.

## El lector de geometría, de vuelta (2026-09-14)

El SVG trae las huellas y nada más. Lo que hacía el código perdido se midió
sobre el modelo, no se recordó:

- **Huellas**: cada polígono se escala desde la media de sus vértices de modo
  que el radio medio crece 0,30 m. 48 de 50 volúmenes al milímetro; las dos
  partes de Viola se habían retocado a mano (5–7 cm) y `b-reference-d` traía
  un par de vértices a 2 mm. `leer-volumenes.py` lo aplica; `volumenes.json`
  lleva lo que el SVG no sabe (altura, base, cubierta, pico, clase, nombre).
- **Huecos**: cada uno está sobre la línea de su muro, en `a + u·(off + w/2)`,
  mirando por la normal exterior según el sentido del polígono. `push` se
  guarda y no se aplica (nunca se aplicó). 758 de 791 al milímetro; los 33 de
  Viola estaban a 11–22 cm de su muro desde el retoque, y ahora se derivan
  sobre el muro de verdad. `fachadas.json` lleva cada muro `(vol, edge)` con
  sus huecos y carpintería; `leer-fachadas.py` escribe `walls` y `openings`.
- **Si una arista cambia** (otro número de vértices, un muro más corto que
  sus huecos, con 20 cm de holgura por las ventanas de esquina de Espai
  Vertical), `leer-fachadas.py` para y dice cuál. Reasignar es de quien
  traza.
- El banco vigila desde entonces que cada agujero cabe en su muro y que cada
  hueco está a menos de 2 cm de la línea de un muro que mira hacia él.

**Y la esquina es entrante.** El visor decidía el lado exterior de un paño
comparando con el centroide del polígono, que en un rincón cóncavo cae del
lado equivocado: el paño miraba hacia dentro, el forro del hueco salía por
fuera y un agujero descentrado habría salido en espejo. Ahora lo decide el
sentido del polígono (signo del área; los hay en los dos sentidos). En los
53 muros que ya tenían huecos las dos reglas coincidían; las cuatro aristas
donde discrepaban eran ciegas: esta, una de la nave de Àster, una de la
escuela de música y una de la marquesina de Can Fontanet.

