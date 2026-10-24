# Manual de operación (RUNBOOK) — El Lobo

Para quien opera el sistema, no para quien programa. Cada sección es independiente. Leyenda: 🗄 Supabase · 🌐 el sistema · 🖥 GitHub / Claude Code · 💬 el chat con Claude.

## Piezas del sistema (qué hay y dónde está)

| Pieza | Dónde | Quién la controla |
|---|---|---|
| La pantalla (el sistema) | GitHub Pages, desde la rama `main` del repositorio | Los dueños, vía pull request |
| Los datos y los usuarios | Supabase (proyecto del restaurante) | Los dueños |
| El código y la historia de cambios | https://github.com/Luiscadlo/Restaurante-El-Lobo (público) | Los dueños |
| Respaldo semanal automático | Tarea programada "Respaldo semanal El Lobo" (domingos 10:53 p. m., hora de Bogotá): baja las tablas y **entrega el JSON como archivo en el chat** | Claude / los dueños |

Si Supabase se cae, el sistema no abre (muestra el error de conexión). Si GitHub Pages se cae, el enlace no carga. Ambos son servicios externos; no hay nada que reiniciar de nuestro lado.

## Roles y usuarios

| Rol | Quién | Qué puede |
|---|---|---|
| `admin` | Cada dueño/familiar, con su **propio** correo | Todo. Entrando directo o autorizando desde caja. |
| `caja` | Un usuario compartido, el del mostrador | Pedidos, Pendientes, Fiados, Cierre (Día a día), Inventario, Menú. Lo demás pide autorización de un dueño. |
| `respaldo` | Solo el respaldo automático | Leer todo. No entra a la pantalla ni escribe. |

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

**Hay tres capas** (ninguna reemplaza a las otras):

1. **Botón Exportar** (encabezado, pide acceso de administrador): descarga un JSON con **todas** las tablas. Al terminar, apaga el aviso de respaldo. Guárdalo **fuera del repositorio** (carpeta privada, nube personal).
2. **Aviso en pantalla:** si pasan más de 7 días sin respaldo se pone ámbar; desde 10 días, rojo.
3. **Respaldo semanal automático** (domingos de noche): llega como archivo al chat. Tras activar la seguridad (RLS), esta tarea debe entrar con el usuario `respaldo`; mientras no se actualice, **falla** y el respaldo debe hacerse a mano con el botón Exportar.

Además, **Datos → Exportar datos a Excel** genera el Excel para el modelo financiero (no es un respaldo completo de la base).

> El plan gratuito de Supabase **no** incluye copias diarias propias. Un respaldo cuenta como *verificado* solo después de restaurarlo en un proyecto de pruebas (guía de restauración: se escribe con el Prompt H; hasta entonces, la restauración no está probada).

## Desplegar un cambio al sistema

1. 🖥 El cambio llega como **pull request** (nunca directo a `main`).
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
- Si un cierre quedó mal: solo un administrador puede corregir cierres o pedidos de días anteriores (restricción **de pantalla**; ver las limitaciones en `docs/MATRIZ_PERMISOS.md`).
- Todo lo que se elimina o se descuenta queda en **Auditoría** (solo administradores).

## Si algo falla — guía rápida

| Síntoma | Qué hacer |
|---|---|
| El enlace viejo (`Contabildad`) muestra "Este enlace cambió" | Normal: guardar el enlace nuevo de la raíz y borrar el viejo de favoritos. |
| Pantalla de entrada no deja pasar a nadie | ¿Se activó RLS sin crear usuarios con rol? Revisa el `select email, raw_app_meta_data ->> 'rol' from auth.users`. Último recurso: `sql/rollback_rls.sql`. |
| La caja no puede cobrar tras un cambio | Puede ser un permiso faltante. Abre la consola (F12) y busca peticiones con error 403; pásaselas a Claude. Reversa: arriba. |
| El respaldo semanal no llegó | Revisa la tarea programada; si falló por permisos, hacer Exportar a mano y avisar a Claude para actualizarla. |
| Un número del Tablero no cuadra | No lo corrijas a mano: compáralo contra los cierres del día; pásale a Claude el día, el turno y la cifra esperada. |
| Se subió por error un archivo con datos o una clave | **Avisa de inmediato**: se debe cambiar la clave, y quitar el archivo del historial (no basta borrarlo). |

## Lo que está pendiente (fuera de este manual)

- Guía de restauración de respaldos y su prueba en un proyecto aparte (Prompt H).
- Confirmación del contador sobre impuestos y facturación electrónica.
- Activar la tarea de respaldo con el usuario `respaldo` (al desplegar la seguridad).
