# Manual de operación (RUNBOOK) — El Lobo

Para quien opera el sistema, no para quien programa. Cada sección es independiente. Leyenda: 🗄 Supabase · 🌐 el sistema · 🖥 GitHub / Claude Code · 💬 el chat con Claude.

## Piezas del sistema (qué hay y dónde está)

| Pieza | Dónde | Quién la controla |
|---|---|---|
| La pantalla (el sistema) | GitHub Pages, desde la rama `main` del repositorio | Los dueños, vía pull request |
| Los datos y los usuarios | Supabase (proyecto del restaurante) | Los dueños |
| El código y la historia de cambios | https://github.com/Luiscadlo/Restaurante-El-Lobo (público) | Los dueños |
| Respaldo semanal (manual) | Pestaña **Datos → 💾 Respaldo completo**: cada domingo un administrador descarga el JSON de todas las tablas. El sistema avisa si toca | Los dueños |

Si Supabase se cae, el sistema no abre (muestra el error de conexión). Si GitHub Pages se cae, el enlace no carga. Ambos son servicios externos; no hay nada que reiniciar de nuestro lado.

## Roles y usuarios

| Rol | Quién | Qué puede |
|---|---|---|
| `admin` | Cada dueño/familiar, con su **propio** correo | Todo. Entrando directo o autorizando desde caja. |
| `caja` | Un usuario compartido, el del mostrador | Pedidos, Pendientes, Fiados, Cierre (Día a día), Inventario, Menú. Lo demás pide autorización de un dueño. |
| `respaldo` | Reservado por si algún día el respaldo se automatiza (hoy no hay ninguno activo) | Leer todo. No entra a la pantalla ni escribe. |

Tabla completa de permisos: `docs/MATRIZ_PERMISOS.md`. **El rol vive en `app_metadata.rol` del usuario** (lo asigna un dueño en Supabase; el usuario no puede cambiarlo).

### Agregar un usuario
1. 🗄 Authentication → Users → **Add user → Create new user** (marca *Auto Confirm User*).
2. 🗄 SQL Editor: asigna el rol (`admin`, `caja` o `respaldo`, en minúscula):
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"rol":"admin"}'::jsonb
   where email = 'correo@ejemplo.com';
   ```
3. La persona entra al sistema (si ya tenía una sesión abierta, que cierre sesión y vuelva a entrar).

### Quitar un usuario
🗄 Authentication → Users → el usuario → **Delete user**. Si se va alguien que conocía la clave **compartida de caja**, cambia esa contraseña (siguiente punto). Un dueño que se va: bórralo y revisa Auditoría de los últimos días.

### Olvidó o hay que cambiar una contraseña
🗄 Authentication → Users → el usuario → **Send password recovery**, o fija una nueva con SQL (la clave queda en el historial del editor: usa una larga y distinta, y bórrala del historial):
```sql
update auth.users set encrypted_password = crypt('NUEVA-CLAVE-LARGA', gen_salt('bf')) where email = 'correo@ejemplo.com';
```
Contraseñas: siempre en un gestor de contraseñas; nunca en el chat, en el código ni en mensajes.

### Un empleado dice "no me deja entrar"
- ¿"Correo o contraseña incorrectos"? Revisa mayúsculas; si hace falta, cambia la clave como arriba.
- ¿"Tu usuario todavía no tiene un rol asignado"? Falta el `update` de rol (arriba).
- ¿"Tu sesión venció"? Volver a entrar. (La sesión de caja se recuerda en cada equipo; **Salir** la borra.)
- ¿Sale error de conexión? Mira si hay internet y si Supabase está en línea (https://status.supabase.com).

## Respaldos

**Hay dos capas** (ninguna reemplaza a la otra) y un Excel aparte:

1. **Datos → 💾 Respaldo completo** (solo administrador): descarga un JSON con **todas** las tablas, comprueba que cada una trae todas sus filas y solo entonces anota la fecha del respaldo. Hazlo **cada domingo** y guarda el archivo **fuera del repositorio** (carpeta privada, nube personal).
2. **Aviso en pantalla** (solo administrador): desde cada domingo aparece en ámbar si todavía no hay un respaldo de esa semana, y se pone rojo a los 10 días. Se apaga solo al terminar bien un respaldo completo.

No hay respaldo automático: el que había se eliminó cuando se activó la seguridad (RLS), porque ya no podía leer con la llave pública. Detalle en `docs/DESPLIEGUE_SEGURIDAD.md` (Paso 8).

**Datos → Exportar datos a Excel** es otra cosa: genera el Excel para analizar o alimentar el modelo financiero. **No es un respaldo** y no sirve para restaurar la base.

### Restaurar un respaldo o empezar de cero (desde el propio sistema)

En **Datos** (solo administrador) hay dos tarjetas, con el mismo archivo `.json` que crea «Hacer respaldo completo»:

- **«♻️ Restaurar desde un respaldo»:** eliges el `.json`, el sistema lo revisa y te muestra «hoy hay X pedidos, el respaldo trae Y, perderás lo posterior»; para confirmar escribes **RESTAURAR** y tu contraseña. Antes de tocar nada descarga una copia de lo actual (`ElLobo_respaldo_ANTES_de_restaurar_…json`) y luego **reemplaza todo, todo o nada** (sin duplicados). **Usa solo el archivo original**: no lo abras ni lo edites ni lo guardes con otro programa.
- **«🧹 Empezar de cero»:** borra todos los datos de trabajo (conserva mesas e inventario, salvo que marques la casilla, y los usuarios). Cartel rojo con las consecuencias, **BORRAR TODO** y tu contraseña, y también descarga antes una copia de todo.

Hazlo siempre con el restaurante sin servicio. Requiere haber corrido una vez `sql/restaurar_respaldo.sql` (instala dos funciones que solo el administrador puede usar; deshacer: `sql/rollback_restaurar.sql`). Cada uso queda anotado en la bitácora `seguridad.restauraciones` (se lee desde Supabase). Guía completa y mensajes de error: [`docs/RESTAURAR.md`](RESTAURAR.md).

> El plan gratuito de Supabase **no** incluye copias diarias propias. Un respaldo cuenta como *verificado* solo después de restaurarlo en un proyecto de pruebas. Guía paso a paso (ensayo y desastre): [`docs/RESTAURAR.md`](RESTAURAR.md).
>
> **Último ensayo de restauración: 27-oct-2026 — OK.** Respaldo usado: `ElLobo_respaldo_completo_2026-10-26.json` (generado el 26-oct ~10:32, no incluye lo posterior). Se restauró en el proyecto de pruebas `Lobo-Pruebas` (Opción A: `esquema_completo.sql`, los 9 archivos `ElLobo_restaurar_0N_de_09.sql` en orden, luego `rls_seguridad.sql` y `candado_dias.sql`). Resultado: **las 16 tablas con `OK`** (filas = esperado: pedidos 4145, cierres_dia 108, gastos_dia 372, egresos 166, aperturas_turno 111, movimientos_caja 37, pedidos_eliminados 50, mesas 15, clientes_fiado 10, abonos_fiado 19, notas_dia 22, pedidos_descuentos 8, config 1, inventario/consumos/ingresos_extra 0) y el **Tablero de septiembre 2026 de la copia de pruebas dio las mismas cifras que el de producción**. No se hizo la comparación fila por fila de la Opción B. La base de pruebas se conserva como réplica (`docs/PRUEBAS_REPLICA.md`).

## Desplegar un cambio al sistema

1. 🖥 El cambio llega como **pull request** (nunca directo a `main`). Si toca SQL, permisos, cierres, fiados o cálculos de plata, se prueba **antes** en la réplica de pruebas (`docs/PRUEBAS_REPLICA.md`).
2. 🖥 Revisa los archivos cambiados y que las **pruebas estén en verde** (`npm test` y `npm run test:motor`).
3. Si el cambio toca la base de datos (un `.sql`), **córrelo en Supabase antes de fusionar** y haz un respaldo primero.
4. 🖥 Fusiona (*Merge pull request*). Anota el identificador (hash) del merge.
5. Espera 1–2 minutos y recarga los equipos (recarga forzada, o ventana privada si no cambia).
6. 🌐 Checklist rápido: entrar como caja, crear un pedido de prueba, cobrarlo, eliminarlo; entrar como dueño y abrir Tablero.

**Cambios que alteran el funcionamiento (entrada, permisos, cierres): solo con el restaurante sin servicio.**

### Deshacer un cambio publicado
🖥 En GitHub: abre el pull request fusionado → **Revert** → fusiona el pull request de reversa. (Línea de comandos: `git revert -m 1 <hash del merge>` y push.) El sitio vuelve al estado anterior en 1–2 minutos. Esto **no** revierte cambios hechos en Supabase.

## Seguridad de la base (RLS)

- Se activa con `sql/rls_seguridad.sql` y se **deshace** con `sql/rollback_rls.sql`. Guía completa: `docs/DESPLIEGUE_SEGURIDAD.md`.
- **Si todo se rompe tras activarlo:** corre primero `sql/rollback_rls.sql` en 🗄 SQL Editor; el sistema sigue funcionando con usuarios. Solo si hace falta volver a la pantalla anterior, revierte el merge. **Primero la base, después la pantalla.**
- Para cambiar permisos: edita `sql/matriz_permisos.json` → `python herramientas/generar_rls.py` → `python -m pytest tests/python/test_rls.py -q` y `npm test` → corre el SQL nuevo en Supabase (es seguro repetirlo).
- Prueba rápida de que la llave pública está cerrada: con la sesión cerrada, en la consola del navegador (F12):
  ```js
  fetch(SB_URL + '/rest/v1/pedidos?limit=1', { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(r => r.text()).then(console.log)
  ```
  Debe dar un error de permisos (o `[]`), **nunca filas**.

## Correr las pruebas

```
npm test              # el sistema web (≈ 1 minuto)
npm run test:motor    # motor Python y seguridad de la base (necesita PostgreSQL instalado para las de seguridad; si no está, se saltan)
```
Todo en verde antes de fusionar. Si algo falla, copia el mensaje completo y pásaselo a Claude; no apagues pruebas para que pasen. Qué cubre cada una: `tests/LEEME.md`.

## Cierre del día y datos

- Los pendientes se cierran el mismo día; los fiados se pagan dentro del mismo mes (regla del negocio, ver `Contabilidad/README.md`).
- Si un cierre quedó mal: solo un administrador puede corregir cierres o pedidos de días anteriores. La pantalla se lo pide y, con el **candado de días** activado (`sql/candado_dias.sql`), la base también lo rechaza para el usuario de caja. El día de negocio cambia a las **9:00 a. m.** (hora de Bogotá): la cena que pasa de medianoche se sigue cerrando como «de hoy» hasta las 8:59 a. m.; pasada esa hora, cerrarla le toca a un administrador. En la pantalla de Cierre, el calendario de caja no deja escoger días anteriores a ese día de negocio, y si llega a uno (por ejemplo escribiendo la fecha) lo ve bloqueado, con el aviso de entrar como administrador. Si caja ve el aviso «Caja solo puede cambiar lo de hoy…», es el candado y no una falla: entra como administrador. Detalle en `docs/MATRIZ_PERMISOS.md`.
- Todo lo que se elimina o se descuenta queda en **Auditoría** (solo administradores).

### Comparar el Excel con el Tablero (cuadre del mes)

El Excel (Datos → Excel) y el Tablero deben dar lo mismo, con **una diferencia que es normal**: los **préstamos** («Préstamos (no cuenta como egreso)») el Tablero no los cuenta como egreso y el Excel sí los lista. Para comparar:

- **Ingresos:** deben ser iguales.
- **Egresos:** compara el Tablero contra «egresos del Excel − préstamos». Si así da igual, está cuadrado; si todavía hay diferencia, copia las dos cifras y la categoría que no cuadra y pásaselas a Claude.

Último cuadre hecho (26-oct-2026): ingresos 19.289.600 = 19.289.600; egresos sin préstamos 15.914.402 = 15.914.402 (diferencia 0). El Excel sumaba además 33.000 de préstamos, que era toda la diferencia que se veía.

## Si algo falla — guía rápida

| Síntoma | Qué hacer |
|---|---|
| Con el enlace viejo (`Contabildad`) la pantalla tarda un instante en cargar | Es solo una redirección al sistema. Para saltarla, guarda el enlace nuevo (la raíz del sitio: `https://luiscadlo.github.io/Restaurante-El-Lobo/`) y borra el viejo de favoritos. |
| Se restauró y salió «Se cortó la conexión… No se sabe si alcanzó a terminar» | **No lo repitas.** Recarga y mira en Datos cuántos pedidos hay: si coincide con el respaldo, terminó; si no, no se cambió nada. La copia «ANTES_de…» ya se había descargado. Ver `docs/RESTAURAR.md`. |
| Pantalla de entrada no deja pasar a nadie | ¿Se activó RLS sin crear usuarios con rol? Revisa el `select email, raw_app_meta_data ->> 'rol' from auth.users`. Último recurso: `sql/rollback_rls.sql`. |
| La caja no puede cobrar tras un cambio | Puede ser un permiso faltante. Abre la consola (F12) y busca peticiones con error 403; pásaselas a Claude. Reversa: arriba. |
| El aviso de respaldo sigue en pantalla | Entra como administrador → **Datos → Respaldo completo**. El aviso solo se apaga cuando bajaron **todas** las filas de todas las tablas; si sale un error de conteo, ese archivo no sirve: repite el respaldo y, si vuelve a fallar, pásale el mensaje a Claude. |
| Un número del Tablero no cuadra | No lo corrijas a mano: compáralo contra los cierres del día; pásale a Claude el día, el turno y la cifra esperada. |
| Se subió por error un archivo con datos o una clave | **Avisa de inmediato**: se debe cambiar la clave, y quitar el archivo del historial (no basta borrarlo). |

## Lo que está pendiente (fuera de este manual)

- ~~Ensayo de restauración en un proyecto aparte~~ — hecho el 27-oct-2026 con un respaldo real (ver «Respaldos»). Repetirlo cuando cambie la estructura de la base o al menos una vez al año.
- Confirmación del contador sobre impuestos y facturación electrónica.
- Decidir si algún día se automatiza el respaldo (hoy es manual cada domingo; el usuario `respaldo` de solo lectura ya está previsto para eso).
