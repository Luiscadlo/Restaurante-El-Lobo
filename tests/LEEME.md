# Pruebas automáticas de El Lobo

Estas pruebas abren el sistema contable en un navegador de prueba, con **datos ficticios** y un
**Supabase falso**, y comprueban que todo sigue funcionando y que las cuentas de plata dan lo mismo
que dan a mano. **No tocan tu base de datos real ni salen a internet.** No forman parte del sistema:
GitHub Pages sigue publicando solo el sistema.

## Cómo correrlas

Hace falta Node.js (ya lo tienes si usas Claude Code) y, para el motor, Python.

La primera vez, en una terminal, en la carpeta del repositorio:

```
npm install
npx playwright install chromium
pip install -r requirements-dev.txt
```

Cada vez que quieras comprobar que todo está bien:

```
npm test              # el sistema web (humo + reglas de plata)
npm run test:motor    # el motor Python (modelo financiero)
```

Si todo está bien verás `passed` en verde. Si algo falla, copia el mensaje y pégaselo a Claude.

**Regla de oro:** corre `npm test` **antes de fusionar cualquier cambio a `main`**.

## Qué cubre cada archivo

| Archivo | Qué comprueba |
|---|---|
| `tests/humo.spec.js` | El sistema abre; pide exactamente las 15 tablas de siempre; las 12 pestañas abren sin errores; las pestañas con candado muestran su login sin sesión y su contenido con sesión de admin; abrir el sistema no escribe nada. |
| `tests/reglas.spec.js` | Las reglas de plata: reparto de descuentos, cuánto aporta cada pedido a efectivo y transferencia, saldo de fiados, ajustes y abonos de los cierres, ventas fijas de cada turno, fechas y formato de pesos. Los valores esperados están calculados a mano y comentados. |
| `tests/python/test_motor.py` | El motor del modelo financiero corre en modo demo sin errores, genera el Excel esperado y no deja archivos dentro del repo. |
| `tests/python/test_motor_funciones.py` | Descuentos y abonos de fiado en el motor, con datos inventados y cuentas a mano: ingreso por cierre (sin contar los abonos dos veces), desglose de ingresos sin pedido, fiados saldados con abonos, descuentos informativos, cuentas por cobrar, un Excel exportado de mentira de punta a punta y el libro generado (si hay LibreOffice, también recalcula las fórmulas). |

Ayudas (no son pruebas): `tests/helpers/backend-falso.js` (el Supabase falso),
`tests/helpers/sesion.js` (cómo se simula el acceso de administrador: **un solo lugar** que se cambia
cuando cambie el login) y `tests/fixtures/datos.js` (los datos de ejemplo).

## Los datos de ejemplo

Todo es inventado ("Cliente Uno (prueba)", etc.). "Hoy" en las pruebas es siempre el **martes
20-oct-2026**, para que los resultados no cambien con el día en que se corran. Las cuentas a mano
están en los comentarios de `tests/fixtures/datos.js` y de `tests/reglas.spec.js`: si cambias un dato
de ejemplo, vuelve a calcularlas.

## Cómo agregar una prueba nueva

1. Abre `tests/reglas.spec.js` y copia una prueba parecida.
2. Calcula el resultado esperado **a mano** y déjalo escrito en un comentario. **No copies lo que
   devuelve la función**: si la función tuviera un error, la prueba lo congelaría en vez de mostrarlo.
3. Corre `npm test`.
4. Si una prueba falla porque el cambio fue a propósito, actualiza la prueba y explica por qué.
   Si falla por otra razón, no la apagues: es un posible error.

## Lo que estas pruebas NO hacen

- No prueban cómo se ve el sistema en un celular real.
- No prueban las políticas de seguridad de Supabase (RLS): eso se prueba aparte, contra un proyecto
  de pruebas.
- No ejecutan flujos completos con guardado (vender, cobrar, cerrar): la base falsa responde "ok" a
  las escrituras pero no las recuerda. Eso viene en una segunda etapa.
- La librería de Excel (`xlsx`, que viene de internet) y las fuentes se reemplazan por respuestas
  vacías: la exportación a Excel del sistema no se prueba aquí.
- Una prueba en verde no es una garantía absoluta: solo cubre lo que está escrito. La lista de lo
  que falta cubrir está en la descripción del pull request.
