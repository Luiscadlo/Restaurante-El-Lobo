# Restaurar un respaldo de El Lobo (y comprobar que sirve)

> **Un respaldo que nunca se ha restaurado no es un respaldo, es una esperanza.** Esta guía sirve para dos cosas:
> **(1) el ensayo:** restaurar el último respaldo en un proyecto de pruebas y comprobar que todo quedó igual;
> **(2) el desastre:** reconstruir El Lobo en un proyecto nuevo si el de producción se pierde.
> **Nunca se restaura encima del proyecto de producción.** Los programas se niegan a hacerlo.

Leyenda: 🗄 Supabase · 💬 el chat con Claude · 🖥 tu computador

## Qué hay (las piezas)

| Pieza | Para qué |
|---|---|
| `sql/consulta_esquema.sql` | Consulta de **solo lectura** que saca la estructura de la base (sin un solo dato). Se corre una vez y cada vez que cambie la estructura. |
| `herramientas/esquema_a_sql.py` | Convierte ese resultado en `sql/esquema_completo.sql`: el SQL que **crea** todas las tablas, llaves, índices, funciones… en un proyecto vacío. |
| `herramientas/respaldo_a_sql.py` | Convierte el respaldo (JSON) en archivos SQL para **pegar** en Supabase. **No necesita ninguna llave.** Comprueba la cantidad de filas de cada tabla. |
| `herramientas/restaurar_respaldo.py` | Carga el respaldo por internet con la llave de servicio del proyecto de destino y **compara fila por fila**. Es la forma más estricta; se usa en el ensayo. |

Los cuatro tienen pruebas automáticas (`npm run test:motor`) hechas contra un Postgres real y un Supabase falso.

## Paso 0 — Una sola vez: sacar la estructura de la base  *(estado: hecho el 2026-10-24; pendiente repetirlo cuando exista la tabla `config`)*

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

Usa el JSON del botón **Exportar** (o el de la tarea semanal). Debe estar **fuera del repositorio**.

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

1. 🗄 Corre `sql/rls_seguridad.sql` en el proyecto de pruebas y crea un usuario `admin` (ver `docs/DESPLIEGUE_SEGURIDAD.md`, pasos 1 y 2).
2. 💬 Pídele a Claude una copia del sistema apuntando al proyecto de pruebas (cambia solo `SB_URL` y la llave **pública** de ese proyecto). Guárdala **fuera** del repositorio y ábrela en tu computador. 🖥
3. Compara con producción: el **Tablero** de un mes (ingresos, egresos, resultado) y 2–3 cierres de días concretos deben dar **las mismas cifras**.

## Paso 5 — Anotar el resultado y limpiar

1. Anota en el RUNBOOK (sección «Respaldos»): fecha del ensayo, respaldo usado, resultado (OK / qué falló).
2. 🗄 El proyecto de pruebas tiene **copias de los datos reales** (clientes que fían, ventas). Cuando termines: Project Settings → General → **Delete project**. Si vas a conservarlo, trátalo con el mismo cuidado que producción.
3. Si usaste la Opción B, elimina la variable de entorno de la llave.

## Si el proyecto de producción se pierde (desastre real)

1. 🗄 Crea un proyecto **nuevo** (el nombre y la dirección serán distintos).
2. Pasos 2 y 3 de arriba en el proyecto nuevo, con el **último respaldo** que tengas.
3. 🗄 Corre `sql/rls_seguridad.sql` y recrea los usuarios (`admin` de cada dueño, `caja`, `respaldo`) con `docs/DESPLIEGUE_SEGURIDAD.md`. **Los usuarios y contraseñas NO están en el respaldo**: hay que crearlos de nuevo.
4. 💬 Claude actualiza la dirección y la llave **pública** en el sistema (`SB_URL`, `SB_KEY`) con un pull request, y el enlace permanente vuelve a funcionar. También actualiza la tarea de respaldo semanal y la constante `REF_PRODUCCION` de `herramientas/restaurar_respaldo.py`.
5. Se pierde lo ocurrido **después del último respaldo**: por eso el aviso en pantalla insiste en respaldar cada semana.

## Si algo sale mal

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| `La tabla «x» no existe en el destino` | Falta correr el Paso 2 (o PostgREST aún no ve las tablas nuevas). | Corre `sql/esquema_completo.sql`; si ya lo hiciste espera 1 minuto o corre `notify pgrst, 'reload schema';`. |
| `le faltan columnas que trae el respaldo` | La estructura cambió después de generar `esquema_completo.sql`. | Repite el Paso 0 (Claude regenera el archivo). |
| `El destino NO está vacío` | Ya hay datos. Nunca se mezcla ni se borra. | Usa un proyecto nuevo, o (solo si es de **pruebas**) vacíalo con el SQL `truncate…` que imprime el programa. |
| `Esa es la llave PÚBLICA` / `Ese es el proyecto de PRODUCCIÓN` | Protecciones. | Usa la llave `service_role` del proyecto **de pruebas**. |
| `El respaldo se hizo INCOMPLETO` / `declara N filas…` | El archivo está dañado o la tarea de respaldo falló. | No restaures ese archivo: haz un respaldo nuevo con **Exportar**. |
| `LA VERIFICACIÓN FALLÓ` / `DIFERENTE` | Algo no quedó idéntico. | **No uses ese proyecto.** Vacíalo, repite, y pásale la salida completa a Claude. |
| `violates foreign key` | Orden de carga o respaldo con datos huérfanos. | Pásale el mensaje a Claude (se puede dar el esquema con `--esquema` para ordenar por llaves). |

## Lo que la restauración NO incluye

- **Usuarios y contraseñas de Supabase Auth** (se recrean).
- Reglas de acceso viejas: a propósito. Las reglas las pone `sql/rls_seguridad.sql`.
- Tablas que el respaldo no trae (la tarea semanal antigua omitía `pedidos_descuentos` y `pedidos_eliminados`; el programa avisa cuáles faltan).
- Lo que pasó después del último respaldo.

## Para quien mantiene el sistema

- El orden de carga se calcula con las llaves foráneas si se pasa `--esquema esquema.json`; sin él se usa una lista fija (padres antes que hijos).
- Una columna `identity ALWAYS` se crea como `BY DEFAULT` para poder conservar los mismos `id`. Las columnas calculadas (`generated … stored`) no se escriben: la base las recalcula.
- `herramientas/restaurar_respaldo.py` solo usa la biblioteca estándar de Python; ver `--help`. Códigos de salida: 0 bien · 1 diferencias al verificar · 2 rechazado por seguridad/configuración · 3 respaldo inválido · 4 falló la conexión o la carga.
- La constante `REF_PRODUCCION` de `herramientas/restaurar_respaldo.py` debe coincidir con `SB_URL` del sistema (una prueba lo vigila).
