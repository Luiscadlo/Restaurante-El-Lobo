# Lo específico de El Lobo y cómo está armado el sistema

> **Para qué sirve este documento:** dejar por escrito qué del sistema es propio de El Lobo (precios, platos, mesas, turnos, cuentas…) y cómo está armado, para convertirlo en un producto genérico (Fase 2) sin adivinar. Es **solo lectura del código**: no cambia nada del comportamiento.
>
> **Cómo se sacó:** con búsquedas y análisis automático del archivo `Contabilidad/ElLobo-Sistema Contable.html` (≈ 10.000 líneas, 561 KB), de `Contabilidad/modelo-financiero/generar_modelo_financiero.py` (4.691 líneas) y de `Menu/Menú diario-El Lobo.html`; las columnas de cada tabla se midieron además **abriendo el sistema con datos de prueba y registrando qué campos lee la pantalla** (no de memoria). Los números de línea corresponden a la versión de la rama `inventario-migracion` (sobre los PR #3, #6 y #7) y se mueven con cada cambio.
>
> **Límites honestos:** (1) lo que el código escribe se detectó leyendo cada llamada a la base; unas pocas escrituras se arman en variables y pueden faltar. (2) Lo que el código *lee* se midió abriendo las 12 pestañas con datos de ejemplo; un campo que solo se lee en un modal poco común puede no aparecer. (3) **La lista de columnas es lo que el código necesita; el esquema real de Supabase se confirma con `sql/consulta_esquema.sql` → `sql/esquema_completo.sql`** (Prompt H; el archivo se genera cuando se corra esa consulta). La lista está copiada en `tests/fixtures/columnas_usadas.json` y una prueba (`tests/python/test_cobertura_esquema.py`) la compara contra el esquema completo apenas exista.

> **Actualización del 24-oct-2026 (después de escribirlo).** Desde que se midió este inventario entraron cambios que lo dejan parcialmente desfasado:
> (1) **los números de línea** entre paréntesis (y el tamaño del archivo, ahora ≈ 10.300 líneas) **ya no coinciden**: sirven de pista, busca siempre por el nombre de la función;
> (2) **el encabezado ya no tiene Exportar/Importar**: el respaldo es **Datos → 💾 Respaldo completo** (manual, cada domingo), `importarDatos` y la importación de Excel **ya no existen**, y el Excel de Datos es solo para análisis;
> (3) nuevas piezas: aviso semanal de respaldo (`nivelAvisoRespaldo`), filtro por día en Auditoría (`fAuditoria`) y, en Fiados, el formulario «Registrar saldo a favor» (`registrarSaldoAFavor`, que comparte con la tarjeta del cliente el núcleo `registrarAbonoDeCliente`);
> (4) **la seguridad (RLS) ya está activa en producción** con los roles `admin` y `caja`; los conteos de funciones y de llamadas a la base que aparecen abajo son los de entonces (cambiaron poco);
> (5) el número de pruebas de la sección 7 es el de ese momento: el vigente se ve con `npx playwright test` (ver `tests/LEEME.md`).

## Resumen en 10 líneas

1. Es **un solo HTML** con 339 funciones globales, 84 variables globales y 353 manejadores en línea (`onclick=`, `onchange=`…) dentro del marcado. Sin módulos ni paso de compilación.
2. Todo lo propio de El Lobo está **mezclado dentro del código**: catálogo de platos, precios, número de mesas, reglas de turnos, nombres de cuentas y textos. Nada vive en configuración ni en la base de datos.
3. Hay **cuatro copias del catálogo de platos** que hay que mantener a mano: `PL` (sistema), `<option>` escritas en el marcado (precios de almuerzos), `_CATALOGO_CR` (motor Python) y `DEFAULT` (generador de menú).
4. Los precios de almuerzos están **duplicados**: la constante `PRECIOS` y las opciones del selector. (El recargo "para llevar", el empaque y el número de mesas ya no: salen de ⚙️ Configuración, `docs/CONFIGURACION.md`.)
5. La base tiene **17 tablas** (la 17.ª, `configuracion`, es de la etapa 1); el sistema habla con ellas por **5 funciones** de acceso (`sbGetAll`, `sbInsert`, `sbInsertConCuenta`, `sbPatch`, `sbDelete`) con 112 llamadas en total.
6. Las reglas de plata viven repartidas entre `calcularTotalPedido`, `repartirDescuento`, `recalcularResultadoCierre`, `calcularVentasFijas`, `calcularSaldoFiado` y `renderTablero`; de esas, solo algunas tienen prueba que las nombre (sección 7).
7. Los **domingos no laborables y los festivos de Colombia** solo existen en el motor Python; el sistema web no tiene esa regla.
8. Dependencias de internet: **una librería** (`xlsx`, para exportar a Excel) y **una hoja de fuentes** de Google, además de Supabase y GitHub Pages. No hay *service worker* ni *manifest*: **no es una PWA instalable y no funciona sin conexión**.
9. Para el producto, la parte más costosa de generalizar es el **catálogo de platos y los turnos**; la menos costosa, nombres y textos.
10. Riesgos técnicos principales (sección 6): funciones de 330 y 260 líneas, `renderAll()` que redibuja todo en cada acción, y 86 asignaciones a `innerHTML` con escape de textos solo parcial.

---

## 1. Todo lo fijo de El Lobo

### 1.1 Catálogo de platos y precios

| Qué | Dónde (línea) | Qué contiene / qué hace | Para el producto |
|---|---|---|---|
| `PL` | 2028 | Catálogo con código y nombre: `sopa` 9, `arroz` 5, `asado` 3, `acomp` 3, `proteina` 25 (códigos `SP01`, `AR01`, `AS01`, `AC01`, `PT01`…), y `comidaRapida` **49 productos con precio** en 10 categorías (PERROS, HAMBURGUESAS, ASADOS, PICADAS, SALCHIPAPAS, SANDWICH CUBANO, AREPAS, SUIZOS, ADICIONALES, BEBIDAS; códigos `PE01`, `HB01`, `CRA01`, `PI01`, `SL01`, `CU01`, `ARP01`, `SZ01`, `ADI01`, `BEB01`…). | Mover a una tabla del negocio (nombre, código, categoría, precio). Hoy cambiar un plato exige editar el código. |
| `LABELS` | 2100 | Nombre legible de cada tipo de pedido; incluye los 49 de comida rápida. | Derivado del catálogo. |
| `PRECIOS` | 2110 | Precio de los 8 tipos de almuerzo: `completo` 14.000, `seco` 12.000, `asado130` 17.000, `asado200` 20.000, `porcion-sopa` 6.000, `porcion-arroz` 4.000, `porcion-proteina` 8.000, `sopa-y-arroz` 11.000. Se usa en 5 sitios (línea 4022, 7517, 7554, 7723, 7753). | Configuración por negocio. |
| `<option>` del selector de almuerzos | `rebuildPedidoSelect`, 3857 (opciones en 3864–3871) | **Segunda copia de los mismos precios** (`data-monto="14000"`…), con textos como "Almuerzo Completo (con sopa) · $14.000". Si se cambia `PRECIOS` y no esto, la pantalla muestra un precio y cobra otro según el camino. | Un solo origen de precios. |
| `PRODUCTOS_EXTRA` | 2115 | 14 productos sueltos con precio (botella de agua 1.000, avena 4.000, papa francesa 5.000, ensalada 3.000, gratinado 5.000, jugo Hit 4.000, Caraqueña 4.000, agua de arroz 4.000, Bretaña 4.000, Pony Malta 4.000, Coca-Cola 400 ml 4.000, gaseosa pequeña 2.000, botella de agua grande 2.000, Coca-Cola 1,5 L 8.000). Alimenta el pop-up "Agregar producto" (`poblarCatalogoExtra`, `aplicarCatalogoExtra`). Algunos se repiten con `PL.comidaRapida` (`ADI01…03`, `BEB02`, `BEB03`). | Catálogo de extras configurable. |
| Tipos de almuerzo | 3864 y `LABELS` | Completo (con sopa), Seco (sin sopa), Asado 130 g, Asado 200 g, Porción de sopa / arroz / proteína, Sopa y arroz, Producto adicional (`extra`). Los componentes del plato (sopa, arroz, proteína, acompañamiento) salen de `PL`. | Configurable por negocio. |
| `PRECIOS`/`LABELS` en Python | motor: `LABEL_ALMUERZO`, `PLATOS_FUERTES` (`completo`, `seco`, `asado130`, `asado200`), `_CATALOGO_CR` | **Tercera copia** (el propio motor avisa: "ES UNA COPIA… hay que mantener esta lista sincronizada a mano"). | Leer del mismo catálogo. |
| `DEFAULT` del generador de menú | `Menu/Menú diario-El Lobo.html` | **Cuarta copia**: sopas 9, arroces 5, proteínas 27, acompañamientos 3. Ya **difiere** de `PL` (p. ej. "Tajadas" vs "Tajada madura"; incluye "Pollo Frito/BBQ" y "Pechuga en salsa" que `PL` no tiene). El catálogo editado se guarda en el navegador de cada equipo (`localStorage`, clave `elLobo_catalogo`), no en la base. | Compartir con el sistema y guardarlo en la base. **Actualización (etapa 3, 31-oct): ya no es una copia aparte.** La lista de platos vive en la configuración (`menu_platos`, 47 de base con código); Pedidos (`PL`) y el generador la leen de ahí (el sistema le deja la lista al generador en `localStorage['elLobo_menu_platos']`); `DEFAULT` queda solo como respaldo si el generador se abre sin haber abierto el sistema. Ver `docs/CONFIGURACION.md`. |

### 1.2 Cargos, mesas y ubicaciones

| Qué | Dónde | Qué hace | Para el producto |
|---|---|---|---|
| ~~`NUM_MESAS = 8`~~ → `numMesas()` | módulo CFG | **Ya configurable** (⚙️ Configuración, ver `docs/CONFIGURACION.md`): el mapa y los selectores se dibujan con un bucle `1…numMesas()`; de siempre: 8. **Ojo:** la tabla `mesas` trae 15 filas; subir el número crea las que falten. | ✅ Hecho (etapa 1). |
| `puedeParaLlevar` | 2152 | "Para llevar" aplica a mesas y "sin mesa", no a domicilio ni fiado. | Regla de negocio configurable. |
| ~~Recargo "para llevar" **$1.000**~~ → `recargoParaLlevar()` | módulo CFG | **Ya configurable** (de siempre: $1.000). Los pedidos nuevos usan el de hoy; **editar un pedido viejo** usa el que regía cuando se hizo (`recargoParaLlevar(p.created_at)`). | ✅ Hecho (etapa 1). |
| ~~`EMPAQUE_DOMICILIO = 1000`~~ → `valorEmpaque()` | módulo CFG | **Ya configurable** (de siempre: $1.000). Empaque desechable por **cada almuerzo** de un domicilio; solo en el turno de almuerzo (comida rápida no lo cobra). El valor del envío en sí se escribe a mano en cada pedido. | ✅ Hecho (etapa 1). |
| Ubicaciones | `selectedUbicacion` | `mesa_N`, `domicilio`, `sinmesa` (cliente de pie), `fiar` (fiado), `gratis`. | Núcleo del modelo de pedidos; lo "propio" son los nombres. |

### 1.3 Turnos, horarios y "consumo familiar"

| Qué | Dónde | Qué hace |
|---|---|---|
| `turnoFromHora` | 2840 | Dos turnos fijos: **almuerzo** de 09:00 a 16:59 y **cena** (comidas rápidas) el resto. Las etiquetas de pantalla dicen "9:00 am – 4:00 pm" y "5:00 pm – 2:00 am"; el corte real en código es a las 17:00, no a las 16:00. |
| `fechaTurnoDeCobro` | 2855 | Madrugada (antes de las 9:00): el cobro cuenta como **cena del día anterior**. |
| Turno "desayuno" | `aperturas_turno` | No es un turno de pedidos: se anota **venta de desayuno** (efectivo y transferencia) y **caja inicial** al abrir el turno. |
| `aplicarReglaGratisPorTurno` | 3945 | "Gratis" (regalo de la casa / consumo del dueño) **solo existe en la cena** (comidas rápidas). |
| `platos_familia` | `cierres_dia`, funciones `…PlatosFamilia…` (8779–8820) | Comidas que comió la familia; se piden al cerrar el turno (`platosFamiliaObligatorio` 8798: obligatorio salvo en cierres viejos que no traen el dato). El motor valora el almuerzo con un valor por comida por mes. |
| Cuentas de dinero | `CUENTA_LABELS` 2891 | Tres cuentas propias del negocio: `efectivo`, `transf_almuerzos`, `transf_rapidas` (transferencias separadas por turno). |
| Categorías de gasto | `CAT_LABELS` 2886 | nómina, proveedor, arriendo, servicios, desechables, otro, préstamo. El motor las reagrupa en 4 rubros (`MAPA_RUBRO`) y excluye `prestamo`. |
| Fechas | `today()`, `toLocalDateStr` | Usan la hora **del dispositivo** (no una zona fija); el código supone Colombia (UTC-5) y lo advierte en un comentario (2728). |
| Moneda y formato | `fmt` y `toLocaleString('es-CO')` | Pesos colombianos con punto de miles. |
| Egresos = dos tablas | `egresosCombinados` 7924 | La pestaña Egresos muestra juntos los de la tabla `egresos` y los gastos del cierre (`gastos_dia` con categoría, salvo `prestamo`); los segundos siempre salen del efectivo. |

### 1.4 Reglas de domingos y festivos

El sistema web **no tiene** ninguna regla de domingos ni festivos. Solo el motor Python las conoce: el **domingo es no laborable** (`NETWORKDAYS.INTL "0000001"`, el sábado sí opera) y descuenta los **festivos nacionales de Colombia** calculados por `festivos_colombia()` (Ley Emiliani + Semana Santa, Pascua por Meeus/Jones/Butcher). Editables en la hoja Inputs. Para un producto en otro país hay que parametrizar ambas cosas.

### 1.5 Nombre del negocio, textos e identificadores

| Qué | Dónde | Nota |
|---|---|---|
| Título y marca | `<title>El Lobo — Sistema Contable</title>` (6); "🐺 El Lobo" en 397, 403, 421 | Texto escrito en el marcado. |
| Menú | iframe `#menuFrame` (1148) y enlace (1146) a `../Menu/Menú diario-El Lobo.html`; título "Menú del Día - El Lobo", "🐺 Restaurante El Lobo" | App aparte, cargada en un iframe. |
| Producto "Hamburguesa Lobo" | `PL.comidaRapida` (`HB02`) | Nombre de un plato. |
| Proyecto de Supabase | `SB_URL` 2160, `SB_KEY` 2162 | La llave es la **pública** (`anon`). |
| Nombres de archivos exportados | `ElLobo_respaldo_completo_*.json` (3103), `ElLobo_datos_*.xlsx` (3316) | Y el motor espera la hoja con esos nombres. |
| Claves de almacenamiento | `ellobo.sesion.caja.v1` (2181), `elLobo_auditoria_vistos` (9786), candado `ellobo-auth` (2279), `elLobo_menu_platos` (lista de platos para el menú; antes `elLobo_catalogo`) | Prefijo propio del negocio. |
| Textos de pantalla | Todo el marcado | Todo en español de Colombia; no hay sistema de traducción. |
| Respaldo | ~~`RESPALDO_ROJO_DIAS = 10`~~ → `CFG.v('respaldo_rojo_dias')` y `CFG.v('respaldo_dia_semana')` | **Ya configurables** (de siempre: domingo y rojo a los 10 días). | ✅ Hecho (etapa 1). |

---

## 2. Mapa del sistema

### 2.1 Pestañas (12)

| Id interno | Etiqueta en pantalla | Candado | Función de dibujo | Tablas que lee al dibujarse (medido) |
|---|---|---|---|---|
| `ingresos` | Pedidos | no | `renderIngresos` | `aperturas_turno`, `cierres_dia`, `pedidos` |
| `pendientes` | Pendientes | no | `renderPendientes` | `mesas`, `pedidos (pendientes)` |
| `fiados` | Fiados | no | `renderFiados` | `abonos_fiado`, `clientes_fiado`, `pedidos` |
| `diaadia` | Cierre | no | `renderDiaADia` | `abonos_fiado`, `aperturas_turno`, `cierres_dia`, `clientes_fiado`, `gastos_dia`, `notas_dia`, `pedidos (pagados)` |
| `inventario` | Inventario | no | `renderInventario` | `consumos`, `inventario` |
| `menu` | Menú | no | (iframe) | ninguna |
| `dashboard` | 🔒 Tablero | admin | `renderTablero` | `abonos_fiado`, `aperturas_turno`, `cierres_dia`, `clientes_fiado`, `egresos`, `gastos_dia`, `inventario`, `pedidos` |
| `ingfin` | 🔒 Ingresos | admin | `renderIngresosFinanciero` | `cierres_dia`, `egresos`, `gastos_dia`, `ingresos_extra`, `pedidos (pagados)` |
| `egresos` | 🔒 Egresos | admin | `renderEgresos` | `egresos`, `gastos_dia` |
| `caja` | 🔒 Caja | admin | `renderCaja` | `cierres_dia`, `egresos`, `ingresos_extra`, `movimientos_caja` |
| `auditoria` | 🔒 Auditoría | admin | `renderAuditoria` | `cierres_dia`, `pedidos_descuentos`, `pedidos_eliminados` |
| `datos` | 🔒 Datos | admin | `renderDatosExport` | `aperturas_turno`, `cierres_dia`, `consumos`, `egresos`, `gastos_dia`, `ingresos_extra`, `notas_dia`, `pedidos (pagados)`, `pedidos_descuentos`, `pedidos_eliminados` |

Los formularios y ventanas (registro de pedidos, mapa de mesas, clientes de fiado) leen además `mesas` y `clientes_fiado`.

`renderAll()` (10025) vuelve a dibujar todas las pestañas visibles cada vez que algo cambia; `aplicarGateAdmin` decide si una pestaña con candado muestra su login o su contenido.

### 2.2 Módulos del archivo

| Rango de líneas | Bloque | Funciones | Qué hay |
|---|---|---|---|
| 2023–3455 | Bloque 1 | 86 | Catálogos, Supabase REST, **sesión (Auth)**, pantalla de entrada, estado `ST`, `loadState`, utilidades, formato de miles, pago dividido, "Gratis", **descuentos** (`repartirDescuento`), **respaldo completo y aviso**, init. |
| 3456–5090 | Bloque 2 | 69 | Formulario de **registro de pedidos** (ubicación, tipo, autocompletado, cliente fiado, `calcularTotalPedido`, `agregarIngreso`), detalle, eliminar, cambiar método de pago, mapa del salón, marcar pagado (mesa, domicilio, sin mesa, fiado, gratis), cancelar pendiente. |
| 5091–5817 | Descuento y Pendientes | 9 | Modal único de descuento (`aplicarDescuentoGrupo`) y `renderPendientes`. |
| 5818–6404 | Fiados e Ingresos | 15 | `renderFiados` (agrupado por cliente, abonos, saldo a favor) y `renderIngresos`. |
| 6405–7784 | Bloque 2.5 | 63 | Apertura de turno, **cierre manual**, notas del día, vuelto, pago dividido, revertir pagos, cambiar de mesa, agregar producto/comida a un pedido, editar pedido. |
| 7785–9377 | Bloque 3 | 64 | **Egresos**, inventario, **Tablero**, Ingresos (financiero), **Cierre del día** (`recalcularResultadoCierre`, `guardarCierre`). |
| 9378–9674 | Bloque 3.5 | 12 | **Caja** (acumulados, gastos generales, aportes de capital). |
| 9675–9819 | Acceso administrador | 8 | `adminAutenticado`, candados, autorizar, auditoría. |
| 9820–10064 | Bloque 4 | 13 | Gráficos comparativos del Tablero, tooltip, `showTab`, `renderAll`, `arrancar`. |

### 2.3 Estado y almacenamiento en el navegador

- **Estado global `ST`** (2574): `ingresos` y `pendientes` (ambos salen de `pedidos`, separados por `estado`), `inventario`, `consumos`, `gastosDia`, `mesas`, `cierresDia`, `aperturasTurno`, `notasDia`, `clientesFiado`, `abonosFiado`, `config`, y las de administrador `egresos`, `movimientosCaja`, `ingresosExtra`, `pedidosEliminados`, `pedidosDescuentos`. Se carga de una vez con `loadState()` (2667) y se mantiene en memoria; cada acción actualiza `ST` y la base.
- **Sesión:** `sesionBase` (quien entró) y `sesionAdmin` (administrador autorizado en el sitio; solo en memoria); `adminAutenticado` se deriva. Solo la sesión de caja se guarda en `localStorage`.
- En total hay 46 `let/var` y 38 `const` globales; casi todos los `let` son de interfaz (filtros, ids en edición, colas de pedido…).

### 2.4 Funciones de acceso a datos (112 llamadas)

| Función | Llamadas | Tablas |
|---|---|---|
| `sbGetAll` (lee todo con paginación de 5.000) | 16 | las 16 (una por tabla, en `loadState`/`pedirTablasAdmin`) |
| `sbInsert` | 31 | 12 tablas |
| `sbInsertConCuenta` (inserta y devuelve la cuenta) | 4 | `abonos_fiado`, `egresos`, `ingresos_extra`, `movimientos_caja` |
| `sbPatch` | 46 | 10 tablas (`pedidos` 21, `mesas` 12, `cierres_dia` 3, …) |
| `sbDelete` | 15 | 8 tablas |
| `sbGet` / `sbGetAllConTotal` | definidas; `sbGet` no se usa con tabla fija; `sbGetAllConTotal` la usa el respaldo | — |

Todas pasan por `sbFetch` (token del usuario, un reintento con renovación si la respuesta es 401).

**Cruce con los permisos (`sql/matriz_permisos.json`).** Las únicas operaciones que el código hace y que el rol `caja` **no** tiene son 11 combinaciones de operación y tabla, y todas son de pestañas de administrador: `registrarUltimoRespaldo` (escribe `config`), `agregarEgreso`/`guardarEdicionEgreso`/`eliminarEgreso`, `agregarIngresoExtra`/`guardarEdicionIngresoExtra`/`eliminarIngresoExtra`, `agregarMovimientoCaja`/`guardarEdicionMovimientoCaja`/`eliminarMovimientoCaja` y, dentro de `aplicarDescuentoGrupo`, el borrado de un egreso "Otro" (para caja la lista de candidatos viene solo de `gastos_dia`, ver decisión 2 de `docs/MATRIZ_PERMISOS.md`).

### 2.5 Tablas y columnas que el código realmente usa

Leyenda de cada columna: **L** la lee la pantalla · **E** el código la escribe al insertar · **M** la modifica con `PATCH` · **C** se usa para filtrar u ordenar · **P** aparece solo en los datos de prueba (el código no la usa) · **†** columna *opcional con respaldo*: si no existe en Supabase el código reintenta sin ella y avisa.

Esta lista es lo que el código **necesita**. El esquema real (tipos, restricciones, índices) se saca con `sql/consulta_esquema.sql` (ver `docs/RESTAURAR.md`, Paso 0).

| Tabla | N.º | Columnas (uso) |
|---|---|---|
| `pedidos` | 35 | `acomp` (EM), `arroz` (EM), `cantidad` (LEM), `cliente_fiado_id`† (LEM), `created_at` (C), `descuento`† (LM), `detalle` (LEM), `direccion`† (LE), `es_domicilio` (LEM), `es_fiar`† (LEM), `es_gratis`† (LEM), `es_sin_mesa`† (LEM), `estado` (EM), `fecha` (LEM), `fecha_original`† (M), `fecha_pago`† (LM), `grupo_pedido`† (LEM), `hora` (LE), `id` (LC), `mesa` (LEM), `metodo` (LEM), `monto_almuerzo` (LEM), `monto_domicilio` (LE), `monto_efectivo`† (LEM), `monto_total` (LEM), `monto_transferencia`† (LEM), `monto_unit` (EM), `motivo_descuento`† (M), `pagado_via_abono` (LM), `para_llevar` (LE), `pedido` (LEM), `proteina` (EM), `sopa` (EM), `turno`† (LE), `turno_pago`† (M) |
| `mesas` | 3 | `estado` (LM), `id` (P), `numero` (LC) |
| `clientes_fiado` | 3 | `created_at` (P), `id` (L), `nombre` (LEC) |
| `abonos_fiado` | 8 | `cliente_fiado_id`† (LE), `created_at` (P), `cuenta` (LE), `fecha` (LEC), `id` (P), `monto` (LE), `nota` (LE), `turno`† (LE) |
| `pedidos_eliminados` | 12 | `created_at` (LC), `detalle` (LE), `fecha` (LE), `hora` (LE), `id` (L), `metodo` (E), `monto_total` (LE), `motivo` (LE), `pedido` (LE), `pedido_id` (E), `turno`† (E), `ubicacion` (LE) |
| `pedidos_descuentos` | 18 | `ajuste_efectivo` (E), `ajuste_transferencia` (E), `cierre_ajustado` (LE), `created_at` (LC), `descuento`† (P), `descuento_anterior` (LE), `descuento_nuevo` (LE), `estado_pedido` (E), `fecha` (LE), `gastos_eliminados` (LE), `grupo_pedido`† (E), `hora` (LE), `id` (L), `motivo` (LE), `pedido_id` (P), `pedido_ids` (E), `turno`† (LE), `valor_lista` (LE) |
| `inventario` | 6 | `costo` (LEM), `id` (LC), `minimo` (LEM), `nombre` (LEC), `stock` (LEM), `unidad` (LEM) |
| `consumos` | 5 | `cantidad` (LE), `costo` (E), `fecha` (LEC), `nombre` (LE), `producto_id` (E) |
| `gastos_dia` | 6 | `categoria`† (LEM), `fecha` (LEC), `id` (LC), `monto` (LEM), `nombre` (LEM), `turno`† (LE) |
| `cierres_dia` | 15 | `abonos_efectivo` (L), `abonos_transferencia` (LEM), `ajuste_efectivo` (LEM), `ajuste_manual` (L), `ajuste_manual_nota` (LEM), `ajuste_transferencia` (LEM), `efectivo` (LEM), `fecha` (LEC), `gastos` (LEM), `id` (L), `manual` (EM), `platos_familia` (EM), `resultado` (EM), `transferencia` (LEM), `turno`† (LEC) |
| `aperturas_turno` | 7 | `caja_inicial` (LEM), `created_at` (C), `fecha` (LEC), `id` (P), `turno`† (LEC), `venta_desayuno` (LEM), `venta_desayuno_transferencia`† (LEM) |
| `notas_dia` | 4 | `created_at` (C), `fecha` (LE), `id` (C), `texto` (LE) |
| `config` | 3 | `actualizado_en` (M), `clave` (LEC), `valor` (LEM) |
| `egresos` | 8 | `cat` (LEM), `created_at` (C), `cuenta` (LEM), `description` (LEM), `fecha` (LEM), `id` (LC), `monto` (LEM), `turno`† (LEM) |
| `movimientos_caja` | 8 | `created_at` (C), `cuenta` (LEM), `cuenta_destino` (M), `descripcion` (LEM), `fecha` (LEM), `id` (LC), `monto` (LEM), `tipo` (LEM) |
| `ingresos_extra` | 5 | `cuenta` (LEM), `descripcion` (LEM), `fecha` (LEMC), `id` (LC), `monto` (LEM) |

**Cosas que conviene saber (para H y para el producto):**

- `pedidos` es la tabla central y la más ancha: **un pedido de varios platos son varias filas** que comparten `grupo_pedido`; `estado` (`pendiente`/`pagado`) separa Pendientes de Pedidos. `monto_almuerzo` y `monto_total` guardan el valor **ya con el descuento restado**; el valor de lista se reconstruye con `monto_almuerzo + descuento` (`valorListaFila`).
- Nombres **inconsistentes** que el producto debería normalizar: `egresos.description` (inglés) frente a `descripcion` en el resto; `egresos.cat` frente a `gastos_dia.categoria`; `turno` guarda `almuerzo`/`cena` en unas tablas y es opcional en otras.
- `pedidos_descuentos` y `pedidos_eliminados` son **registros de auditoría** (`pedido_ids` es un arreglo; `ubicacion`, `detalle`, `gastos_eliminados` guardan texto).
- `cierres_dia`: `ajuste_manual` es una columna **heredada** (un solo valor que hoy se separó en `ajuste_efectivo` y `ajuste_transferencia`); el código la sigue leyendo para cierres viejos. `abonos_efectivo` y `abonos_transferencia` son las plata de abonos de fiado dentro del turno.
- `config` es clave/valor (`clave`, `valor` JSON, `actualizado_en`); hoy solo guarda `ultimo_respaldo`.
- Las columnas † existen porque las funciones se agregaron por etapas; en el producto conviene **quitar esos reintentos** y exigir el esquema completo desde el inicio.
- Los datos de prueba (`tests/fixtures/datos.js`) para `pedidos_descuentos` usan columnas (`pedido_id`, `descuento`) que el código real no escribe: **conviene alinearlos** con la tabla real cuando se revise H.

---

## 3. Motor del modelo financiero (`Contabilidad/modelo-financiero/generar_modelo_financiero.py`)

Se corre a mano en el computador (no es parte del sitio): `python generar_modelo_financiero.py ElLobo_datos_AAAA-MM-DD.xlsx --hasta 2027-12 --mes 2026-09`, o `--demo` para datos de ejemplo. Otras opciones: `--meses-proyeccion`, `--inicio`, `--salida`. 4.691 líneas, 136 funciones, genera un libro de Excel con las hojas Cover, Outputs, Inputs, Model y los gráficos (catálogo en `CATALOGO_GRAFICOS.md`).

**Valores fijos de El Lobo:**

| Qué | Valor / dónde |
|---|---|
| `MES_INICIO_DATOS_REALES` | `"2026-09"`: todo lo anterior (agosto de 2026, mes de prueba) se ignora en todas las tablas. |
| Domingo no laborable | Hoja Model: `NETWORKDAYS.INTL "0000001"`; la proyección y los datos de ejemplo excluyen domingos (`dayofweek != 6`). |
| Festivos | `festivos_colombia(anio_inicio, anio_fin)`: 18 festivos nacionales. |
| Consumo familiar | Sección propia en Inputs y bloque "Consumo Familiar (ESTIMADO)" en Model; el almuerzo se valora con un valor por comida por mes; "Gratis" se valora a precio de venta. |
| `PLATOS_FUERTES` | `completo`, `seco`, `asado130`, `asado200` (base del ticket). |
| `_CATALOGO_CR` / `MAPA_CR_CATEGORIA` | Copia de las categorías de comida rápida (ver 1.1). |
| `MAPA_RUBRO`, `CATEGORIAS_EXCLUIDAS` | Agrupa categorías de gasto en 4 rubros; `prestamo` queda fuera. |
| `FILAS_MODEL_FIJAS` | Posición de filas de la hoja Model que Inputs necesita (validada con un `assert`). |
| Supuestos de demo | `datos_de_ejemplo()` genera 12 meses sintéticos sin domingos. |

**Hojas del export que consume** (nombres exactos): `Cierres_Dia`, `Pedidos_Pagados`, `Pedidos_Pendientes`, `Egresos`, `Gastos_Cierre` (= tabla `gastos_dia`), `Inventario`, `Movimientos_Caja`, `Abonos_Fiado`, `Aperturas_Turno`. Si la hoja no existe, la trata como vacía. **No usa** `Ingresos_Extra`, `Consumos`, `Notas_Dia`, `Pedidos_Eliminados`, `Descuentos_Log`, `Clientes_Fiado` aunque el export las incluye. El export (`exportarExcelCompleto`, 3271) agrega además `Info_Exportacion`.

Si cambia el nombre de una hoja o columna en el sistema, el motor se rompe en silencio o con un error de pandas: **el contrato entre los dos es el Excel**, y no hay prueba que lo vigile.

---

## 4. Dependencias externas

| Dependencia | Dónde | Qué pasa sin internet |
|---|---|---|
| `xlsx@0.18.5` desde `cdn.jsdelivr.net` (línea 9) | Exportar a Excel (Datos) | El botón de Excel falla (`XLSX` no está definido); el respaldo JSON, no. |
| Google Fonts (Syne, DM Mono; línea 8) | Tipografía | Cae a la fuente del sistema; solo cambia el aspecto. |
| Google Fonts (Playfair Display, Nunito) en el generador de menú | Tipografía del menú | Igual. |
| Supabase (`https://arxyfcquvsmfoxmbifne.supabase.co`) | Datos y usuarios (REST + Auth) | No abre / "Sin conexión con Supabase". Una sesión de caja guardada se intenta usar, pero sin datos no hay pantalla útil. |
| GitHub Pages | Publicación del sitio | No cargan los enlaces. |

No hay otras librerías ni frameworks. El generador de menú es autosuficiente: sus fuentes (DejaVuSans) y la imagen de plantilla van **incrustadas** en el propio HTML (de ahí sus 5 MB).

---

## 5. Archivos del repositorio que no son parte del sistema

| Archivo | Peso | Lo usa el sistema |
|---|---|---|
| `Menu/Menú diario-El Lobo.html` | 5,1 MB | **Sí** (iframe de la pestaña Menú) |
| `Menu/plantilla.png` | 8,9 MB | No (el generador lleva la plantilla incrustada) |
| `Menu/Fonts/` (Anton, Montserrat) | 7,6 MB | No (ningún archivo las referencia) |
| `Menu/Menu/COMIDAS EL LOBO - PUBLICIDAD.pptx` | 5,1 MB | No |
| `Menu/Menu/COMIDAS EL LOBO - PUBLICIDAD.jpg` | 0,16 MB | No |
| `Menu/platos.xlsx` y `Menu/Menu/platos.xlsx` | 10 KB cada una — **byte a byte idénticas** | No |
| `QR del lobo .docx` | 0,7 MB | No (contiene QR de pago) |

`Menu/` pesaba 26,9 MB de los ≈ 28,7 MB de archivos versionados; `Contabilidad/` pesa 0,9 MB. **Resuelto el 25-oct-2026 (decisión del dueño):** de `Menu/` solo se sigue versionando el generador (`Menú diario-El Lobo.html`, que la pestaña Menú necesita); todo lo demás de la tabla de arriba quedó fuera del repositorio (`.gitignore`) y sus archivos no se borraron del computador del dueño. Una prueba (`tests/menu-publicado.spec.js`) vigila que el generador nunca se excluya por accidente. El historial de git conserva además cosas viejas (una contraseña ya quemada, dos SQL de correcciones de datos y un respaldo de prueba); **no deben viajar al producto** (se exporta una copia limpia de la etiqueta, sin historial).

---

## 6. Riesgos técnicos

1. **Funciones muy largas.** 25 funciones pasan de 50 líneas, 9 de 100 y 3 de 200: `renderPendientes` (332), `agregarIngreso` (262), `renderTablero` (248), `aplicarDescuentoGrupo` (181), `renderFiados` (165), `guardarCierreManual` (118). Las que **mezclan cálculo de plata con dibujo** (`renderTablero`, `renderPendientes`, `renderFiados`) son las más difíciles de probar.
2. **La plata se calcula en el momento de dibujar y a partir de textos de campos.** `calcularTotalPedido` lee los valores directamente de los campos del formulario; no se puede probar sin abrir la página.
3. **Fuentes de verdad duplicadas:** precios (`PRECIOS` + opciones del selector), catálogo en 4 copias, recargo "para llevar" en 6 lugares, horario de turnos (etiqueta 4 pm vs corte a las 17:00).
4. **`renderAll()` redibuja las 11 pestañas con contenido** (las con candado solo muestran su login si no hay administrador; el Menú es un iframe) tras cada acción. Con más datos o más locales será lento.
5. **`innerHTML` en 86 sitios y escape de textos solo parcial y manual.** Hay algunos `replace(/"/g,'&quot;')` en valores de campos y un `replace(/</g,'&lt;')`, pero no existe una función de escape y la mayoría de los textos que escribe el personal (nombre de cliente, dirección, notas, motivos) se insertan tal cual en el HTML (p. ej. líneas 5643, 5937, 6021). Hoy el riesgo es bajo (usuarios de confianza), pero en un producto con muchos negocios es una vía de inyección: hay que escapar siempre o usar `textContent`.
6. **353 manejadores en línea (`onclick=`, `onchange=`…) en el marcado** y 84 variables globales: las funciones se llaman por nombre desde el HTML, lo que obliga a que todo sea global y complica pasar a módulos.
7. **Reintentos "sin la columna que falta"** repetidos 8 veces (pedidos, extras, apertura de turno, cierres, gastos…): código duplicado y difícil de seguir; hay que quitarlos al fijar un esquema único.
8. **Reglas implícitas en comentarios:** la mayor parte de las reglas de negocio (fiados se pagan en el mes, pendientes se cierran el mismo día, Tablero = Σ cierres, descuentos informativos) solo están en comentarios y en `Contabilidad/README.md`.
9. **Restricciones de "días anteriores"**: resueltas en el servidor con `sql/candado_dias.sql` (decisión 3 = B, ver `docs/MATRIZ_PERMISOS.md`); la pantalla conserva su propio aviso. Pendiente solo conocer sus casos límite (cena sin cerrar pasadas las 9:00 a. m., deshacer el cobro de un pendiente viejo que no es fiado).
10. **Control de versiones del esquema:** las migraciones `.sql` ya corridas se quitaron de la carpeta (siguen en el historial). Con H la estructura quedó escrita en `sql/esquema_completo.sql` (sacada con `sql/consulta_esquema.sql` el 2026-10-24, ya con la tabla `config` creada, y convertida con `herramientas/esquema_a_sql.py`). Cada vez que se agregue una tabla o columna en Supabase hay que regenerarlo.
11. **`confirm()`/`alert()`/`prompt()`: resuelto el 30-oct-2026.** El sistema ya no usa ningún aviso del navegador (se veían distinto en cada navegador/celular y el cuadro «¿A nombre de quién queda este fiado?» dejaba un fiado sin nombre al cancelar). Los 14 «¿Seguro?» salen en una ventana propia (`confirmarSistema`, sobre `ventanaSistema`, `#modal-sistema`: botón «Volver» por defecto en lo que borra, Esc = «Volver», un clic fuera no decide nada); el cliente de un fiado se elige en `elegirClienteFiado` (`#modal-elegir-cliente`: todos en orden alfabético, buscador y «+ Crear cliente nuevo»; «Volver» no registra nada); y el generador del menú tiene su propia ventana (`avisoMenu`). Una prueba (`tests/avisos-propios-y-selector.spec.js`) falla si alguien vuelve a escribir `alert(`, `confirm(` o `prompt(` en el sistema o en el menú. Lo único del navegador que queda es el selector de archivos de «Restaurar desde un respaldo» (no se puede reemplazar).
12. **El contrato con el motor Python es un Excel** con nombres de hoja y de columna fijos (sección 3) sin prueba que lo proteja.
13. **Hora del dispositivo:** si un equipo tiene mal el reloj o la zona horaria, los pedidos quedan con la fecha/turno equivocados.

---

## 7. Cobertura de pruebas

Hay 119 pruebas web (humo, reglas de plata, respaldo, seguridad, flujos del mostrador, aviso del enlace, secretos) y 17 de Python (motor y seguridad de la base). Detalle en `tests/LEEME.md`.

**Funciones de plata que ninguna prueba nombra** (heurística por nombre; varias se ejercitan **de forma indirecta** al recorrer los flujos, pero ninguna prueba las comprueba con cuentas hechas a mano):

| Prioridad | Función | Por qué importa |
|---|---|---|
| Alta | `recalcularResultadoCierre` (8913) | Calcula el resultado de cada cierre de turno. |
| Alta | `calcularTotalPedido` (4061) | Total de cada pedido: almuerzos + extras − descuento + envío + empaque. |
| Alta | `guardarCierreManual` | Cierre manual (turno que no quedó completo en el sistema): el formulario muestra lo que el sistema ya tiene (`resumenSistemaTurno`), arranca con esos totales y comparte los `gastos_dia` del turno — guarda por diferencia (quita lo marcado, inserta lo nuevo) y `gastos` del cierre sale siempre de la suma real de esas filas (sin préstamos). Guarda también `abonos_efectivo`/`abonos_transferencia`. Es la única puerta para corregirlo: `irADiaADia` (y los lápices de Ingresos/Egresos) lo redirigen a `editarCierreManual`. |
| Alta | `renderTablero` (8179) | Todas las cifras del Tablero (ingresos = Σ cierres, egresos, utilidad…). |
| Alta | `calcularAcumuladosCaja` (9412) | Saldos de la sección Caja. |
| Media | `aplicarSaldoAFavor`, `saldarFiadosConSaldoAFavor`, `gruposQueCubreSaldoAFavor`, `ofrecerSaldoAFavor` | Fiados saldados con saldo a favor; `ofrecerSaldoAFavor` es el aviso al dejar un fiado a nombre de un cliente (se llama desde `agregarIngreso`, `moverPedidoAFiado` y `asignarClienteAHuerfano`). `preguntarSaldoAlRegistrar` es la pregunta de Pedidos → «Fiar» con un cliente (antes de guardar: fiado = usar / volver; pagado inmediatamente = usar / cobrar normal / volver), `preguntarSaldoAntesDeFiar` la de Pendientes→Fiar y Fiados→Asignar (usar / volver, antes de mover) y `ventanaSistema` la ventana propia (`#modal-sistema`) con la que se hacen todas las preguntas de saldo a favor (y, vía `confirmarSistema`, todos los «¿Seguro?» del sistema). `proyectarSaldoAFavor` es el cálculo compartido (solo lee) que usan esa pregunta y el aviso verde del formulario (`actualizarAvisoSaldoFavorFormulario`): mismo orden del más viejo al más nuevo que `gruposQueCubreSaldoAFavor`. |
| Media | `marcarGrupoFiadoPagado`, `moverPedidoAFiado`, `marcarPedidoIndividualPagado`, `marcarGrupoDomicilioPagado`, `marcarGrupoSinMesaPagado`, `marcarGrupoGratisPagado` | Cobros por tipo de pedido. |
| Media | `calcularConsumoGratisTurno`, `calcularGastosTurno`, `cargarPlatosFamiliaDeCierre` | Piezas del cierre. |
| Media | `agregarEgreso`, `guardarEdicionEgreso`, `agregarIngresoExtra`, `agregarMovimientoCaja` y sus ediciones/borrados | Flujos de administrador (hoy las pruebas de flujos recorren solo el mostrador de caja). |
| Baja | `calcularVuelto`, `calcularVueltoPendiente`, `leerPagoDivididoIngreso`, `actualizarDivididoRestanteIngreso` | Ayudas de pantalla (no se guardan). |

**El contrato entre el sistema y el motor** (nombres de hojas y columnas del Excel) tampoco tiene prueba.

**Verificación contra `sql/esquema_completo.sql`:** el archivo existe desde el 2026-10-24 (sacado de la base real). `tests/python/test_cobertura_esquema.py` exige las 16 tablas y todas las columnas marcadas L, E, M o C (`tests/fixtures/columnas_usadas.json`), y avisa de las † (opcionales con respaldo) que falten; las heredadas (`ajuste_manual`) cuentan como requeridas porque el código las lee. Resultado con la base real: **todas las columnas que el código necesita existen** (la tabla `config` se creó ese mismo día con `sql/migracion_supabase_config.sql`).

**Hallazgos del esquema real (2026-10-24):**
- **Seguridad hoy:** 11 de las 16 tablas tienen RLS APAGADO y el rol `anon` (la llave pública que viaja en el HTML) tiene todos los permisos sobre las 16 tablas; las 5 que tienen RLS traen una regla «allow all». Es lo que cierra `sql/rls_seguridad.sql`.
- **Tabla vieja `el_lobo_data`** (`id`, `data`, `updated_at`): era el almacenamiento antiguo del sistema (todo en un solo bloque, constante `SB_TABLE` hasta finales de junio de 2026). Tiene UNA fila (`main`, 1,2 KB, última actualización 2026-06-26); el sistema ya no la usa y no entra en los respaldos. Se deja como está; el SQL de seguridad la cierra.
- **12 tablas usan `identity ALWAYS`** (no deja insertar con un `id` propio): `esquema_completo.sql` las crea «BY DEFAULT» para poder restaurar con los mismos `id`.
- **Columnas que existen y el código no usa:** `abonos_fiado.id/created_at`, `aperturas_turno.id`, `cierres_dia.created_at`, `clientes_fiado.telefono/created_at`, `consumos.id/created_at`, `gastos_dia.created_at`, `ingresos_extra.created_at`, `mesas.updated_at`, `pedidos.es_para_llevar/entrega_sopa/entrega_plato`. No estorban; los respaldos las conservan.
- **Restricciones de valores (CHECK) que la base hace cumplir:** `abonos_fiado.cuenta` ∈ {efectivo, transferencia}; `pedidos_eliminados.motivo` ∈ {eliminado, cancelado}; `egresos/ingresos_extra/movimientos_caja.cuenta` ∈ {efectivo, transf_rapidas, transf_almuerzos}; `turno` ∈ {almuerzo, cena}; `mesas.numero` 1–15. El ensayo `test_ensayo_esquema_real.py` descubrió que los datos de ejemplo de las pruebas rompían dos de ellas (corregido; el sistema en sí las respeta).
- `mesas` no tiene columna `id` (la llave es `numero`) y `pedidos_descuentos` guarda `pedido_ids` como texto, no `pedido_id`.

---

## Cómo se volvió a sacar este documento

1. Funciones y tamaños: análisis del archivo HTML (declaraciones `function` en la columna 0 y su llave de cierre).
2. Llamadas a datos y columnas escritas: lectura de cada llamada `sbInsert`/`sbPatch`/`sbInsertConCuenta`/`sbDelete`/`sbGetAll` con tabla literal (112 llamadas) y de los objetos que reciben.
3. Columnas leídas: se abrió el sistema como administrador con los datos de prueba (más una fila de ejemplo en las tablas que estaban vacías), se envolvieron las filas de cada tabla para registrar qué campos lee la pantalla y se visitaron las 12 pestañas.
4. Contrato con permisos: cruce de las operaciones del paso 2 con `sql/matriz_permisos.json`.
5. Cobertura: nombres de función contra el texto de todos los archivos de `tests/`.
