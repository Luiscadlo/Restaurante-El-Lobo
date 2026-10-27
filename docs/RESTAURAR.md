# Restaurar un respaldo de El Lobo (y comprobar que sirve)

> **Un respaldo que nunca se ha restaurado no es un respaldo, es una esperanza.** Esta guía tiene dos caminos:
> **(A) el camino normal, desde el propio sistema** — dos botones en **Datos**: «♻️ Restaurar desde un respaldo» y «🧹 Empezar de cero»;
> **(B) el camino técnico, desde Supabase** — para el ensayo estricto fila por fila y como plan B si algo se complica.

Leyenda: 🗄 Supabase · 💬 el chat con Claude · 🖥 tu computador · 🌐 el sistema

## ¿Qué necesito hacer?

| Situación | Qué hacer |
|---|---|
| Se dañó o se borró información y quiero **volver a un respaldo** | **Camino A**, «Restaurar desde un respaldo» |
| Terminé las pruebas / quiero **entregar el sistema vacío** | **Camino A**, «Empezar de cero» |
| Quiero **llenar la réplica de pruebas** con datos reales recientes | Hacer un respaldo en el sistema real y **restaurarlo con el botón en la réplica** (Camino A, en la réplica) |
| **Se perdió el proyecto de Supabase** completo | «Si el proyecto de Supabase se pierde» (abajo): proyecto nuevo + unos SQL + el botón |
| Se dañó algo **de Supabase por dentro** (permisos, estructura) | Eso es técnico: avisa a quien mantiene el sistema |

# Camino A — Desde el sistema (el normal)

## Una sola vez: instalar las dos funciones en Supabase

Los botones llaman a dos funciones de la base de datos que **solo puede usar el administrador** (`lobo_restaurar_respaldo` y `lobo_empezar_de_cero`). Se instalan una vez:

1. 🗄 SQL Editor → **New query** → pega todo `sql/restaurar_respaldo.sql` → **Run**. Es seguro correrlo más de una vez y **no toca ningún dato**.
2. Debe terminar con una fila: `funciones = 2 · anon_puede_ejecutar = 0 · bitacora = 1`.
3. Para deshacerlo: `sql/rollback_restaurar.sql` (quita las dos funciones; la bitácora se conserva).

Para correrlo en **producción**, hazlo con el restaurante sin servicio, como cualquier SQL (`docs/RUNBOOK.md`). Requiere que `sql/rls_seguridad.sql` ya esté instalado (si no, se detiene con un mensaje claro y no cambia nada).

## «♻️ Restaurar desde un respaldo»

🌐 Entra como **administrador** → pestaña **Datos** → tarjeta «Restaurar desde un respaldo».

> **Usa solo el archivo original** `ElLobo_respaldo_completo_AAAA-MM-DD.json` que crea «Hacer respaldo completo». **No lo abras, no lo edites, no lo guardes con otro programa** (Excel, Word, Bloc de notas…) ni le cambies el formato: un archivo modificado se rechaza y, si lo cambias a mano, pierdes esos datos. El Excel de «Exportar datos» **no sirve** para restaurar.

1. Elige el archivo `.json`. El sistema lo **revisa** (que sea un respaldo de El Lobo, completo, sin recortes ni modificaciones) y te muestra: *«Hoy el sistema tiene X pedidos; el respaldo trae Y»*, tabla por tabla, y que **lo posterior al respaldo se perderá**.
2. Pulsa **«Restaurar este respaldo…»**. Se abre una ventana roja que repite lo que va a pasar.
3. Escribe la palabra **RESTAURAR** y **tu contraseña de administrador**. (La contraseña se comprueba con el servicio de acceso; no se guarda ni se envía a la función de restaurar.)
4. Pulsa **«Restaurar ahora»**. El sistema, en este orden:
   1. comprueba tu contraseña;
   2. **descarga una copia de lo que hay ahora** (`ElLobo_respaldo_ANTES_de_restaurar_AAAA-MM-DD_HHMM.json`). Si esa copia no se puede guardar completa, **se detiene y no cambia nada**;
   3. recién entonces le pide a la base que **reemplace todo** por el contenido del archivo, **todo o nada** (si algo falla a la mitad, queda exactamente como estaba);
   4. vuelve a leer todo, y te muestra el antes y el ahora de cada tabla.
5. **Guarda la copia «ANTES_de…»** fuera del repositorio hasta que confirmes que todo está bien. Es tu botón de «deshacer»: se restaura con este mismo procedimiento.

Hazlo con el restaurante **sin servicio** y sin nadie más usando el sistema. Los **usuarios y contraseñas no cambian** (no están en el respaldo). Las **mesas** quedan como las trae el respaldo.

**No hay duplicados ni mezcla:** la restauración **reemplaza** (vacía las tablas y carga el archivo); nunca suma. Si lo repites con el mismo archivo, el resultado es el mismo.

Un respaldo **viejo** que no trae `config` o `pedidos_descuentos` (tablas que se agregaron después) se acepta: esas dos tablas se dejan como están y la pantalla lo dice («no viene: se deja igual»).

## «🧹 Empezar de cero»

🌐 **Datos** → tarjeta roja «Empezar de cero». Sirve, por ejemplo, para terminar las pruebas y empezar a trabajar de verdad.

- Al pulsar, un **cartel rojo** explica todas las consecuencias: se borran **todos** los pedidos, fiados y abonos, cierres, aperturas, gastos, egresos, caja, ingresos extra, descuentos, notas, consumos, la auditoría de eliminados y la fecha del último respaldo. **No se puede deshacer** (salvo restaurando la copia que se descarga) y **se recomienda hacer antes un respaldo completo**.
- Se **conservan** las **mesas** (quedan libres) y, salvo que marques la casilla, el **inventario**. Los usuarios y contraseñas no cambian.
- Exige **siempre** tu contraseña de administrador y escribir **BORRAR TODO**.
- Antes de borrar, igual que al restaurar, **descarga una copia de todo** (`ElLobo_respaldo_ANTES_de_empezar_de_cero_…json`); si no se puede guardar, no borra nada.

## Qué pasa si algo sale mal (Camino A)

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| «Este archivo no se puede restaurar: …» | No es el `.json` original del respaldo, o se modificó o se cortó. **No se tocó nada.** | Usa el archivo tal como lo descargó el sistema, o elige otro respaldo. |
| «La contraseña no es correcta» | La contraseña no es la del administrador con sesión. No se tocó nada. | Vuelve a escribirla. |
| «No se pudo guardar la copia de lo que hay ahora… No se cambió nada» | No se pudo bajar todo para la copia previa (conexión). | Revisa la conexión y repite. |
| «Falta instalar la función de restauración en Supabase» | No se corrió `sql/restaurar_respaldo.sql` en este proyecto. | Córrelo (arriba) y repite. |
| «La base tardó demasiado y canceló la operación. No se cambió nada» | El respaldo es muy grande para el límite de tiempo. | Avisa a quien mantiene el sistema. |
| «Se cortó la conexión… **No se sabe si alcanzó a terminar**» | La conexión se cayó justo durante el reemplazo. | **No lo repitas todavía.** Recarga la página y mira en Datos cuántos pedidos hay: si coincide con el respaldo, terminó; si coincide con lo anterior, no se cambió nada. Tu copia «ANTES_de…» ya está descargada. |
| «Tu usuario no tiene permiso» | Solo el rol `admin` puede (lo exige la base, no solo la pantalla). | Entra con un usuario administrador. |

Cada restauración y cada «empezar de cero» deja una línea en una bitácora que **solo se ve desde Supabase** (`seguridad.restauraciones`: quién, cuándo, y cuántas filas había antes y después).

# Camino B — Desde Supabase (técnico: ensayo estricto, plan B)

## Qué hay (las piezas)

| Pieza | Para qué |
|---|---|
| `sql/consulta_esquema.sql` | Consulta de **solo lectura** que saca la estructura de la base (sin un solo dato). Se corre una vez y cada vez que cambie la estructura. |
| `herramientas/esquema_a_sql.py` | Convierte ese resultado en `sql/esquema_completo.sql`: el SQL que **crea** todas las tablas, llaves, índices, funciones… en un proyecto vacío. |
| `herramientas/respaldo_a_sql.py` | Convierte el respaldo (JSON) en archivos SQL para **pegar** en Supabase. **No necesita ninguna llave.** Comprueba la cantidad de filas de cada tabla. |
| `herramientas/restaurar_respaldo.py` | Carga el respaldo por internet con la llave de servicio del proyecto de destino y **compara fila por fila**. Es la forma más estricta; se usa en el ensayo. |

Los cuatro tienen pruebas automáticas (`npm run test:motor`) hechas contra un Postgres real y un Supabase falso.

## Paso 0 — Una sola vez: sacar la estructura de la base  *(estado: hecho el 2026-10-24, con las 17 tablas incluida `config`)*

1. 🗄 Supabase (el proyecto **de producción**) → **SQL Editor → New query**.
2. Pega todo `sql/consulta_esquema.sql` y pulsa **Run**. Es de solo lectura: no cambia nada y no trae datos.
3. El resultado es **una celda** llamada `esquema`. Cópiala completa (clic derecho → Copy) y pégasela a Claude en el chat. 💬
4. Claude la convierte en `sql/esquema_completo.sql`, la prueba en un Postgres de verdad (que quede igual) y la sube en un pull request. Desde ese día la estructura de la base **está escrita en el repositorio**.

Cada vez que se agregue una tabla o columna nueva a Supabase, se repite este paso.

## Paso 1 — Crear el proyecto de pruebas

1. 🗄 supabase.com → **New project**. Nombre: `el-lobo-pruebas-restauracion`. Misma región que el de producción. Guarda la contraseña de la base en tu gestor de contraseñas. El plan gratuito normalmente permite 2 proyectos activos: producción + este (si Supabase te lo impide, pausa o borra un proyecto que no uses).
2. Espera a que termine de crearse (1–2 minutos).

## Paso 2 — Crear las tablas en el proyecto de pruebas

1. 🗄 (proyecto de **pruebas**) SQL Editor → pega todo `sql/esquema_completo.sql` → **Run**.
2. Al final devuelve una fila con pares «real / esperado»: cada par debe tener **los dos números iguales** y `tablas_sin_rls_real` debe ser 0.
3. Es seguro correrlo dos veces. Las tablas quedan **cerradas** (RLS activo y sin reglas) hasta que corras `sql/rls_seguridad.sql`.

## Paso 3 — Cargar el respaldo

Usa el JSON de la pestaña **Datos → 💾 Respaldo completo** (el que haces cada semana). Debe estar **fuera del repositorio**.

### Opción A — Sin llaves (recomendada para una emergencia real)
1. 💬 Dile a Claude: «genera los SQL de restauración» y pásale el respaldo. Claude corre `herramientas/respaldo_a_sql.py` y te entrega 1–3 archivos `ElLobo_restaurar_01_de_0N.sql`.
2. 🗄 (proyecto de pruebas) SQL Editor → pega el archivo 1 → **Run**; luego el 2, etc. Cada archivo es **todo o nada**: si falla, no entra nada de ese archivo.
3. El último termina con una tabla `tabla | filas | esperado | estado`: **todas** deben decir `OK`.
4. Si el destino ya tenía datos, el primer archivo se detiene con «El destino NO está vacío» y no cambia nada.

### Opción B — Estricta, con comparación fila por fila (la del ensayo)
1. 🗄 (proyecto de pruebas) Project Settings → **API Keys** (en algunas versiones del panel se llama **API**; las llaves clásicas están en «Legacy API Keys») → copia la llave **`service_role`** (o *secret*) **de este proyecto de pruebas**. Es una llave de administrador de ese proyecto: **nunca en el chat, ni en el código, ni en el repositorio**.
2. Entrégasela a Claude como **variable de entorno** `LOBO_LLAVE_SERVICIO` en la configuración del entorno de Claude Code (donde se definen variables de entorno), junto con `LOBO_URL_DESTINO=https://xxxx.supabase.co` (la dirección del proyecto de pruebas). Si no encuentras dónde, dímelo y lo resolvemos de otra forma (Opción A también sirve para el ensayo).
3. 💬 Claude corre primero el **simulacro** (por defecto no escribe nada): revisa el archivo y el destino. Si todo está bien, repite con `--ejecutar`.
4. Al final el programa compara **todas** las filas del destino contra el respaldo y escribe «Verificación completa: todo quedó idéntico».
5. Imprime un SQL de «último paso» (subir los contadores automáticos). 🗄 Córrelo en el SQL Editor del proyecto de pruebas: así el próximo pedido no choca con uno restaurado.

El programa se niega, sin tocar nada, si: la llave es la pública, es del proyecto de producción, el respaldo está cortado o incompleto, faltan tablas o columnas en el destino, o el destino ya tiene datos.

## Paso 4 — Comprobar que el sistema funciona con los datos restaurados  *(opcional, recomendado)*

1. 🗄 Corre `sql/rls_seguridad.sql` y después `sql/candado_dias.sql` en el proyecto de pruebas, y crea un usuario `admin` (ver `docs/DESPLIEGUE_SEGURIDAD.md`, pasos 1, 2 y 6b). Los datos ya están cargados: el candado de días solo limita al rol `caja`, no a la restauración.
2. 💬 Pídele a Claude la copia de pruebas del sistema apuntando a ese proyecto (`herramientas/generar_copia_pruebas.py`: cambia solo `SB_URL` y la llave **pública** de ese proyecto y pone el cartel «PRUEBAS»; ver `docs/PRUEBAS_REPLICA.md`). Guárdala **fuera** del repositorio y ábrela en tu computador, o publícala en la réplica. 🖥
3. Compara con producción: el **Tablero** de un mes (ingresos, egresos, resultado) y 2–3 cierres de días concretos deben dar **las mismas cifras**.

## Paso 5 — Anotar el resultado y limpiar

1. Anota en el RUNBOOK (sección «Respaldos»): fecha del ensayo, respaldo usado, resultado (OK / qué falló).
2. 🗄 El proyecto de pruebas tiene **copias de los datos reales** (clientes que fían, ventas). Cuando termines: Project Settings → General → **Delete project**. Si vas a conservarlo, trátalo con el mismo cuidado que producción.
3. Si usaste la Opción B, elimina la variable de entorno de la llave.

## Si el proyecto de Supabase se pierde (desastre real)

1. 🗄 Crea un proyecto **nuevo** (el nombre y la dirección serán distintos).
2. 🗄 En su SQL Editor, en este orden: `sql/esquema_completo.sql` (crea las tablas; los pares «real / esperado» deben coincidir), `sql/rls_seguridad.sql`, `sql/candado_dias.sql` y `sql/restaurar_respaldo.sql`.
3. 🗄 Crea los usuarios (`admin` de cada dueño, `caja`, `respaldo`) con `docs/DESPLIEGUE_SEGURIDAD.md`. **Los usuarios y contraseñas NO están en el respaldo**: hay que crearlos de nuevo.
4. 💬 Claude actualiza la dirección y la llave **pública** en el sistema (`SB_URL`, `SB_KEY`) con un pull request, y el enlace permanente vuelve a funcionar. También actualiza la constante `REF_PRODUCCION` de `herramientas/restaurar_respaldo.py`.
5. 🌐 Entra como administrador → **Datos → Restaurar desde un respaldo** con el **último respaldo** que tengas. (Si prefieres el camino técnico, el Paso 3 de abajo carga el respaldo desde Supabase.)
6. Se pierde lo ocurrido **después del último respaldo**: por eso el aviso en pantalla insiste en respaldar cada semana.

## Si algo sale mal

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| `La tabla «x» no existe en el destino` | Falta correr el Paso 2 (o PostgREST aún no ve las tablas nuevas). | Corre `sql/esquema_completo.sql`; si ya lo hiciste espera 1 minuto o corre `notify pgrst, 'reload schema';`. |
| `le faltan columnas que trae el respaldo` | La estructura cambió después de generar `esquema_completo.sql`. | Repite el Paso 0 (Claude regenera el archivo). |
| `El destino NO está vacío` | Ya hay datos. Nunca se mezcla ni se borra. | Usa un proyecto nuevo, o (solo si es de **pruebas**) vacíalo con el SQL `truncate…` que imprime el programa. |
| `Esa es la llave PÚBLICA` / `Ese es el proyecto de PRODUCCIÓN` | Protecciones. | Usa la llave `service_role` del proyecto **de pruebas**. |
| `El respaldo se hizo INCOMPLETO` / `declara N filas…` | El archivo está dañado o el respaldo falló a medias. | No restaures ese archivo: haz un respaldo nuevo desde **Datos → Respaldo completo**. |
| `LA VERIFICACIÓN FALLÓ` / `DIFERENTE` | Algo no quedó idéntico. | **No uses ese proyecto.** Vacíalo, repite, y pásale la salida completa a Claude. |
| `violates foreign key` | Orden de carga o respaldo con datos huérfanos. | Pásale el mensaje a Claude (se puede dar el esquema con `--esquema` para ordenar por llaves). |

## Lo que la restauración NO incluye

- **Usuarios y contraseñas de Supabase Auth** (se recrean).
- Reglas de acceso viejas: a propósito. Las reglas las pone `sql/rls_seguridad.sql`.
- Tablas que el respaldo no trae (los respaldos antiguos omitían `pedidos_descuentos` y `pedidos_eliminados`; el programa avisa cuáles faltan).
- Lo que pasó después del último respaldo.

## Para quien mantiene el sistema

- El orden de carga se calcula con las llaves foráneas si se pasa `--esquema esquema.json`; sin él se usa una lista fija (padres antes que hijos).
- Una columna `identity ALWAYS` se crea como `BY DEFAULT` para poder conservar los mismos `id`. Las columnas calculadas (`generated … stored`) no se escriben: la base las recalcula.
- `herramientas/restaurar_respaldo.py` solo usa la biblioteca estándar de Python; ver `--help`. Códigos de salida: 0 bien · 1 diferencias al verificar · 2 rechazado por seguridad/configuración · 3 respaldo inválido · 4 falló la conexión o la carga.
- La constante `REF_PRODUCCION` de `herramientas/restaurar_respaldo.py` debe coincidir con `SB_URL` del sistema (una prueba lo vigila).
