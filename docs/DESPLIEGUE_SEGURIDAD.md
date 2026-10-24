# Despliegue de la seguridad (usuarios + reglas de acceso) — paso a paso

Esta guía deja a El Lobo con **usuarios con rol** y **la base de datos cerrada a la llave pública**. Se hace **una sola vez**, con el restaurante **sin servicio** (día libre o cerrado), y toma de 1 a 2 horas.

Leyenda: 🗄 Supabase (navegador) · 🌐 el sistema en el navegador/celular · 🖥 GitHub / Claude Code · 💬 el chat con Claude

> **Qué cambia para el equipo:** al abrir el sistema pide usuario y contraseña (solo el nombre corto, p. ej. `caja` o `luiscadlo`). El mostrador entra con el usuario `caja` (queda recordado en ese equipo). Las pestañas con candado las abre un dueño escribiendo **su** correo y contraseña, o entrando directo con su usuario.
> **Qué NO cambia:** las pantallas, los cálculos, los cierres ni el Menú.

## Qué hay en el repositorio para esto

| Archivo | Para qué |
|---|---|
| `docs/MATRIZ_PERMISOS.md` | Quién puede hacer qué (versión para leer). Si cambias una decisión, cambia aquí y en la matriz de abajo. |
| `sql/matriz_permisos.json` | La misma matriz en formato máquina: **fuente única**. |
| `herramientas/generar_rls.py` | Genera los dos SQL de abajo desde la matriz. No se editan a mano. |
| `sql/rls_seguridad.sql` | **Se corre en Supabase** para activar las reglas. Seguro de correr dos veces. |
| `sql/rollback_rls.sql` | **Deshacer**: quita las reglas y deja las tablas como estaban. |
| `tests/python/test_rls.py` | Prueba el SQL contra un Postgres de verdad (no toca tu Supabase). |

## Antes de empezar (no sigas si falta algo)

- [ ] El restaurante está **sin servicio** y nadie tiene pedidos abiertos. Los pendientes de ayer están cerrados.
- [ ] Hiciste un **respaldo completo reciente** (botón **Exportar** del encabezado) y lo guardaste **fuera del repositorio**.
- [ ] Ya corriste en Supabase `sql/migracion_supabase_config.sql` (tabla `config`, del respaldo/aviso). Si no, hazlo ahora: el sistema nuevo la lee.
- [ ] Decidiste las 3 decisiones de `docs/MATRIZ_PERMISOS.md` (si no respondes, quedan las opciones **A**).
- [ ] Tienes el **nombre corto** de cada dueño que tendrá usuario propio (p. ej. `luiscadlo`), y un gestor de contraseñas (o papel guardado bajo llave) para las claves.
- [ ] Tienes a mano `sql/rollback_rls.sql` (para deshacer si algo sale mal).

## Paso 1 — Crear los usuarios 🗄

Supabase → **Authentication → Users → Add user → Create new user**. Marca **Auto Confirm User**. Crea:

| Usuario | Para qué | Cuántos |
|---|---|---|
| uno por cada dueño/familiar | rol **admin** (entra a todo) | tantos como personas |
| `caja` → en Supabase `caja@elobo.test` | el mostrador, compartido | 1 |
| `respaldo` (p. ej. `respaldo@…`) | solo para la copia semanal automática; no entra a la pantalla | 1 |

- **Cómo se llaman:** en Supabase cada usuario se crea como `nombre@elobo.test` (p. ej. `luiscadlo@elobo.test`, `caja@elobo.test`, `respaldo@elobo.test`). En el sistema solo se escribe el nombre corto (`luiscadlo`) y la pantalla agrega `@elobo.test` por detrás (`DOMINIO_USUARIOS` en el HTML: debe coincidir con el dominio con que se crearon).
- El correo **no existe de verdad** (nunca se envía nada), así que no hay «olvidé mi contraseña» por correo: si alguien la olvida, se cambia en Supabase (Authentication → Users) o con el SQL de «Mantenimiento de los usuarios».
- Contraseñas **largas y distintas** (12 caracteres o más). Guárdalas en el gestor de contraseñas. **Nunca** en el chat ni en el código.

## Paso 2 — Darle su rol a cada usuario 🗄

Supabase → **SQL Editor → New query**. Pega esto cambiando los correos por los tuyos, y **Run**:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"admin"}'::jsonb
where email in ('luiscadlo@elobo.test');   -- un correo por cada dueño: 'otro@elobo.test', …

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"caja"}'::jsonb
where email = 'caja@elobo.test';

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"respaldo"}'::jsonb
where email = 'respaldo@elobo.test';

-- Comprobación: cada correo debe aparecer con su rol (ninguno vacío)
select email, raw_app_meta_data ->> 'rol' as rol from auth.users order by 1;
```

- Los roles se escriben **exactamente** `admin`, `caja`, `respaldo` (en minúscula).
- Se usa `raw_app_meta_data` (**app**_metadata) a propósito: el usuario **no** puede cambiarlo. Nunca pongas el rol en `user_metadata`: ese sí lo puede editar el propio usuario.
- Si un usuario ya estaba abierto en algún equipo, tiene que **cerrar sesión y volver a entrar** para recibir su rol.

## Paso 3 — Cerrar el registro público 🗄

Supabase → **Authentication → Sign In / Providers** (el menú puede llamarse un poco distinto según la versión):

- [ ] Apaga **Allow new users to sign up** (que nadie pueda crearse una cuenta solo).
- [ ] Confirma que **Allow anonymous sign-ins** está **apagado**.
- [ ] Sube la **longitud mínima de contraseña** (12 si te lo permite).

## Paso 4 — Publicar el sistema nuevo (las reglas siguen apagadas) 🖥

1. En GitHub, abre el pull request **#6 `seguridad-login`**, revisa los cambios y **fusiónalo** a `main` (incluye el respaldo completo del PR #3; si #3 ya está fusionado, solo entra lo de seguridad).
2. Espera 1–2 minutos a que GitHub Pages publique.
3. 🌐 En cada equipo del restaurante abre el sistema con recarga forzada (o ventana privada). Debe salir la pantalla de **entrada**.

La base **todavía** está abierta a la llave pública (aún no corres el SQL de reglas). Es un paso intermedio seguro: ya se puede entrar con usuarios y todo funciona igual.

## Paso 5 — Probar los usuarios (reglas todavía apagadas) 🌐

- [ ] Entra con el usuario **caja**. Se ven Pedidos, Pendientes, Fiados, Cierre (Día a día), Inventario y Menú. Tablero, Ingresos, Egresos, Caja, Auditoría y Datos **no aparecen**. **Importar**, **Exportar**, **Cierre manual**, **Historial completo de cierres** ni el aviso de respaldo tampoco aparecen, y no hay ninguna cajita de usuario o contraseña a la vista.
- [ ] Pulsa **Salir** y entra como **dueño** (p. ej. `luiscadlo`): aparecen las seis secciones, además de Exportar, Importar, Cierre manual y el Historial completo de cierres.
- [ ] Prueba con una contraseña equivocada: debe rechazar.
- [ ] Recarga la página con la sesión de caja: sigue en caja sin pedir clave. El dueño entra directo y no se recuerda: al recargar hay que volver a entrar (por diseño).
- [ ] El usuario **respaldo** en la pantalla de entrada: debe decir que no entra a la pantalla.

Si algo de esto no pasa, **no sigas**: cuéntame qué viste (ver "Si algo sale mal").

## Paso 6 — Activar las reglas en la base 🗄

1. Abre `sql/rls_seguridad.sql` del repositorio, copia **todo** su contenido.
2. Supabase → **SQL Editor → New query** → pega → **Run**. Corre en una sola transacción: si algo falla, no queda nada a medias.
3. Al final muestra una fila con cinco números. Debe ser:

| tablas_sin_rls | vistas_sin_proteger | anon_con_permisos | politicas | reglas_ajenas_abiertas |
|---|---|---|---|---|
| 0 | 0 | 0 | 64 | 0 |

   Si ves otra cosa, **no sigas** y pégame el resultado.
   *(Tu base trae 5 reglas viejas «allow all» —aperturas_turno, ingresos_extra, movimientos_caja, notas_dia, pedidos_eliminados— que dejarían pasar a cualquiera con sesión por encima de las nuevas. Este SQL las retira solo y las guarda en `seguridad.politicas_previas`; por eso la última columna debe ser 0.)*
4. 🌐 Recarga todos los equipos (el sistema viejo en memoria ya no funcionaría; el nuevo sí).

## Paso 7 — Verificar que todo funciona 🌐

**Lo que debe seguir funcionando (con el usuario `caja`):**
- [ ] Pedido en mesa, pagado en efectivo.
- [ ] Domicilio pagado por transferencia.
- [ ] Fiado con abono parcial.
- [ ] Un descuento.
- [ ] Abrir turno, cierre de almuerzo y de noche.
- [ ] Inventario, consumos, notas, gastos del turno.
- [ ] Eliminar un pedido de prueba (cobrado y pendiente).

**Con un dueño (entrando directo):**
- [ ] Tablero, Ingresos, Egresos, Caja, Auditoría y Datos abren y muestran cifras.
- [ ] Auditoría muestra la eliminación que acabas de hacer (y el descuento).
- [ ] **Exportar** (respaldo completo) descarga el JSON con las 16 tablas.

**Que la llave pública ya no abre nada** — con la sesión cerrada (pantalla de entrada), abre la consola del navegador (F12 → Console; si pide, escribe `allow pasting` y Enter) y pega:

```js
fetch(SB_URL + '/rest/v1/pedidos?limit=1', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(r => r.text()).then(console.log)
```

Debe responder un error de permisos (o `[]`). **Nunca filas de pedidos.**

Después **borra los datos de "PRUEBA"** que hayas creado.

## Paso 8 — Respaldo semanal automático 💬

La tarea programada "Respaldo semanal El Lobo" hoy entra con la llave pública. **Dejó de poder leer** en cuanto corriste el Paso 6. Dos caminos:

- **Automático:** avísame (💬) y le pongo el usuario `respaldo` (solo lectura). Necesito su correo y contraseña; por eso conviene que sea un usuario *solo* para esto, que no sirve para entrar a la pantalla ni para escribir nada.
- **Manual:** cada semana, **Exportar** (encabezado) y guardar el archivo. La pantalla recuerda con un aviso cuando pasan los días.

## Si algo sale mal (tarjeta de reversa)

**Primero** actúa, **después** investiga.

1. 🗄 Corre `sql/rollback_rls.sql` (SQL Editor). Quita las reglas `lobo_*`, vuelve a crear las reglas viejas que había y deja cada tabla como estaba. **El sistema nuevo sigue funcionando con usuarios**; solo queda sin la cerradura de la base.
2. 🌐 Recarga los equipos y comprueba que se puede operar.
3. Solo si necesitas volver también a la **pantalla anterior** (sin usuarios): 🖥 `git revert -m 1 <hash del merge de seguridad>` y push. El orden es ese: primero la base, luego la pantalla (la pantalla vieja con las reglas activas no funciona).
4. 💬 Cuéntame qué falló.

El rollback no borra datos ni usuarios.

## Mantenimiento de los usuarios

**Agregar a otra persona:** Authentication → Users → Add user (con *Auto Confirm User*) y luego el `update` del Paso 2 con su correo y el rol.

**Cambiar el rol:** el mismo `update` del Paso 2 con el rol nuevo. La persona debe cerrar sesión y volver a entrar.

**Quitar a alguien (se fue del restaurante):** Authentication → Users → ese usuario → **Delete user**. Si era el usuario `caja` compartido, **cambia su contraseña** (abajo) para que quien se fue no siga entrando.

**Cambiar o recuperar una contraseña:** Authentication → Users → ese usuario → **Send password recovery**, o con SQL (la nueva clave queda en el historial del editor; usa una clave nueva y larga, y bórrala del historial):

```sql
update auth.users set encrypted_password = crypt('NUEVA-CLAVE-LARGA', gen_salt('bf')) where email = 'caja@elobo.test';
```

**Si cambias algo de permisos:** edita `sql/matriz_permisos.json`, corre `python herramientas/generar_rls.py`, corre `python -m pytest tests/python/test_rls.py -q` y `npm test`, actualiza `docs/MATRIZ_PERMISOS.md`, y vuelve a correr `sql/rls_seguridad.sql` en Supabase (es seguro repetirlo).

## Limitaciones que conviene recordar

- **Caja puede leer `pedidos` y `cierres_dia`** (hace falta para cobrar y cerrar turno): alguien técnico con esa cuenta podría consultar las ventas históricas. No ve compras, gastos ni caja.
- **Las restricciones de "días anteriores"** (solo admin corrige otros días) siguen siendo de pantalla, no del servidor (decisión 3).
- El plan gratuito de Supabase **no incluye** copias de seguridad diarias propias: por eso el respaldo semanal (Paso 8) es importante.
- Las contraseñas viejas del código siguen en el historial de GitHub (el repositorio es público): si alguna se usa en otro sitio, **cámbiala allá**.
