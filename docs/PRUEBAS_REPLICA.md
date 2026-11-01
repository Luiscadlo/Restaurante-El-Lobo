# La réplica de pruebas de El Lobo

Leyenda: 🗄 Supabase · 🖥 GitHub / Claude Code · 🌐 el sistema en el navegador · 💬 el chat con Claude

**Idea simple:** hay **dos sistemas**. El **real** (el del restaurante) y una **réplica** idéntica, con su propia base de datos y su propio enlace, donde se prueba todo antes. Los cambios y el SQL nuevo se prueban primero en la réplica —incluso en pleno servicio, porque no comparten nada con el real— y, cuando funcionan, se fusionan a `main` y se corren en producción.

| | Sistema real | Réplica de pruebas |
|---|---|---|
| Página | `luiscadlo.github.io/Restaurante-El-Lobo/` (rama `main`) | **Un archivo HTML en el computador del dueño** (no se publica en internet). Opcional: un repositorio aparte con su propio enlace |
| Base de datos | Supabase de producción | Supabase **Lobo-Pruebas** (otro proyecto) |
| Datos | Los reales | Una **copia de un respaldo** (o datos de ensayo) |
| Usuarios | `admin`, `caja` | Otros usuarios, con otras contraseñas |
| Cómo se reconoce | — | Cartel rojo «ENTORNO DE PRUEBAS» arriba, franja roja «PRUEBAS» abajo y título «🧪 PRUEBAS» |

## Cómo está hecha (para que nunca haya sorpresas)

La página de la réplica **sale del mismo archivo** del sistema real: la fabrica `herramientas/generar_copia_pruebas.py`. Solo cambia esto, y la herramienta lo verifica (si algo más cambiara, no escribe nada):

1. La dirección (`SB_URL`) y la llave **pública** (`SB_KEY`) del proyecto de pruebas, y la dirección que la política de seguridad de la página (`Content-Security-Policy`, `connect-src`) deja usar: la página solo puede hablar con el Supabase que lleva puesto, así que en la réplica esa línea también apunta al proyecto de pruebas.
2. Los nombres con que el navegador recuerda cosas (la sesión de caja, los avisos vistos). Las dos páginas viven en el mismo dominio (`luiscadlo.github.io`) y, sin este cambio, se pisarían la sesión guardada.
3. El título, los carteles de PRUEBAS y `noindex` (para que Google no la publique).
4. *(Solo en el «archivo único», ver el paso 7 del montaje)* el **Menú viaja dentro del archivo**: la pestaña Menú carga el generador del menú desde una carpeta hermana (`../Menu/`) y un archivo suelto —p. ej. en Descargas— no la tiene. En ese modo el Menú real se incrusta tal cual (la herramienta comprueba que se recupera idéntico y que no menciona nada de producción) y el botón «Abrir en pestaña aparte» lo abre desde el mismo archivo. Con la misma idea, **la librería de Excel** (`Contabilidad/librerias/xlsx.full.min.js`) se incrusta dentro del archivo (la página real la carga de esa carpeta, que un archivo suelto tampoco tiene): sin eso, en la réplica el botón «Exportar a Excel» no funcionaría. La herramienta comprueba que la librería incrustada es byte a byte la del repositorio.

Lo que la herramienta **se niega a hacer**: apuntar a producción (por la dirección o por la llave), usar una llave que no sea la «anon» pública del mismo proyecto (**la llave de servicio / secret jamás va en una página**), escribir dentro del repositorio del sistema, o dejar cualquier rastro de producción en la copia. Tiene pruebas automáticas (`tests/python/test_copia_pruebas.py` y `tests/copia-pruebas.spec.js`).

> **Seguridad:** la réplica tiene datos copiados del restaurante. La protege lo mismo que a producción: usuario y contraseña, y las reglas de la base (`sql/rls_seguridad.sql`). Usa contraseñas largas y **distintas** de las de producción, y deja cerrado el registro público de usuarios. Si algún día ya no la usas, bórrala (Project Settings → General → Delete project).

## Montaje (una sola vez)

1. 🗄 **Crear el proyecto** (supabase.com → New project; nombre `Lobo-Pruebas`; región «Americas»; en *Security* dejar *Enable Data API* ✔, *Automatically expose new tables* ✔ y *Enable automatic RLS* sin marcar). Guardar la contraseña de la base en el gestor de contraseñas. El plan gratuito permite 2 proyectos activos: producción y este.
2. 🗄 **Crear las tablas:** SQL Editor → pegar todo `sql/esquema_completo.sql` → Run. Los pares «real / esperado» deben ser iguales y `tablas_sin_rls_real` = 0.
3. 🗄 **Cargar los datos** de un respaldo real. Camino corto: instalar las funciones (`sql/restaurar_respaldo.sql`, después de las reglas y el candado, pasos 4 y 5), crear el usuario admin (paso 6), abrir la copia (paso 7) y usar **Datos → Restaurar desde un respaldo**. Camino técnico (equivalente): `docs/RESTAURAR.md`, Camino B, Paso 3 (Claude genera los `ElLobo_restaurar_0N_de_0M.sql` con `herramientas/respaldo_a_sql.py`; se pegan en orden; todas las filas de la tabla final deben decir `OK`). Cualquiera de los dos es, a la vez, **el ensayo de restauración**.
4. 🗄 **Reglas de seguridad:** pegar `sql/rls_seguridad.sql` → Run. Debe dar `0 · 0 · 0 · 64 · 0`.
5. 🗄 **Candado de días:** pegar `sql/candado_dias.sql` → Run. Debe dar `candados = 7`.
6. 🗄 **Usuarios:** Authentication → Users → Add user → *Create new user* (marcar *Auto Confirm User*): `admin@elobo.test` y `caja@elobo.test`, con contraseñas largas y distintas de las de producción. Luego, en el SQL Editor, darles su rol (`docs/DESPLIEGUE_SEGURIDAD.md`, Paso 2). Cerrar el registro público (Paso 3 de esa guía).
7. 💬 **Generar la copia:** se le pasa a Claude la *Project URL* y la llave **anon** del proyecto de pruebas (Project Settings → API Keys → «Legacy API Keys» → anon public; son públicas, **nunca la service_role**). Claude ejecuta:
   `python herramientas/generar_copia_pruebas.py --url https://xxxx.supabase.co --llave-publica eyJ… --archivo-unico ARCHIVO_FUERA_DEL_REPOSITORIO.html`
   y entrega **un solo archivo HTML, con el Menú adentro**. **Es la opción que usa El Lobo:** el dueño lo guarda en su computador y lo abre con doble clic (en Chrome u Opera). No hace falta repositorio ni enlace público, porque las pruebas las hace una sola persona. Limitación: es una foto del sistema del momento en que se generó (cuando hay un cambio que probar, Claude entrega un archivo nuevo). *(Antes se entregaba la carpeta `Contabilidad/` suelta sin `Menu/` y la pestaña Menú salía con «No se ha podido acceder al archivo» —ERR_FILE_NOT_FOUND—: por eso existe el archivo único.)* La variante `-o CARPETA` (sitio con `index.html`, `Contabilidad/` y `Menu/`) es solo para publicar la réplica en un repositorio, en el paso 8.
8. 🖥 *(Opcional, solo si algún día se quiere un enlace propio o más de una persona prueba)* **Publicarla:** crear el repositorio **público** `Restaurante-El-Lobo-Pruebas` (vacío), activar *Settings → Pages → Deploy from a branch → `main` / (root)* y subir lo que genera la herramienta (con `-o ../Restaurante-El-Lobo-Pruebas`; si Claude no tiene acceso a ese repositorio, se suben los archivos desde la web de GitHub: *Add file → Upload files*). Quedaría en `luiscadlo.github.io/Restaurante-El-Lobo-Pruebas/`.
9. 🌐 **Comprobar:** abrir la copia (o el enlace, si se publicó). Debe verse el cartel rojo; entrar con `caja` y con `admin`; el Tablero de un mes completo debe dar **las mismas cifras** que producción para ese mes (si se cargó un respaldo).

## Flujo de cada cambio

1. 💬 Claude hace el cambio en una rama y corre todas las pruebas automáticas, como siempre.
2. 💬 Claude genera la copia de pruebas **desde esa rama** y se la entrega al dueño (o la publica, si hay repositorio de pruebas). Si el cambio trae **SQL**, también se corre primero en el SQL Editor del proyecto **Lobo-Pruebas** (nunca primero en producción).
3. 🌐 Se prueba en la réplica con los datos copiados, a cualquier hora, sin afectar el servicio. Para probar el candado de días, el cierre de la cena o el cambio de las 9:00 a. m. se usa el reloj real: la réplica tiene el mismo candado.
4. 🖥 Si funciona: se **fusiona el pull request** a `main` (el sistema real se actualiza en 1–2 minutos) y, si había SQL, se corre en producción con el restaurante sin servicio, como siempre (`docs/RUNBOOK.md`).
5. 💬 Claude entrega de nuevo la copia generada desde `main` (y la republica, si hay repositorio de pruebas) para que no quede una copia vieja con una prueba que ya pasó.
6. Si no funciona: se corrige en la rama y se repite desde el paso 2. Producción nunca se enteró.

**Regla:** cambios de pantalla pequeños (un texto, un color) pueden ir directo con las pruebas automáticas; todo lo que toque **SQL, permisos, cierres, fiados o cálculos de plata** pasa antes por la réplica.

## Mantenimiento

- **Refrescar los datos de la réplica** (volver a copiar el estado del restaurante): en el sistema **real**, Datos → **Hacer respaldo completo** (guarda el `.json` fuera del repositorio); luego, en la **réplica** (con el cartel rojo de PRUEBAS), entra como administrador → Datos → **Restaurar desde un respaldo**, elige ese archivo y confirma. Reemplaza todo lo que hubiera en la réplica, en segundos y sin pegar SQL. (Requiere haber corrido una vez `sql/restaurar_respaldo.sql` en el proyecto de pruebas.) No toques producción: nunca restaures un respaldo viejo encima del sistema real salvo que de verdad quieras volver a ese día.
- **Cambió la estructura de producción** (tabla o columna nueva): se corre el mismo SQL en la réplica **antes**; después se regenera `sql/esquema_completo.sql` (`docs/RESTAURAR.md`, Paso 0).
- **El proyecto gratuito se pausa** si pasa una semana sin uso: entra al panel de Supabase y pulsa *Restore project* (tarda 1–2 minutos; no se pierde nada).
- **Pasó mucho tiempo sin usarla:** antes de probar un cambio, comprueba que la réplica está al día con producción (mismo SQL aplicado, mismos usuarios con rol).

## Lo que la réplica NO es

- No es una copia de seguridad: los respaldos siguen siendo los de cada domingo (`docs/RUNBOOK.md`).
- No prueba la red, el celular ni el computador del mostrador, ni cuánta gente usa el sistema a la vez.
- No comparte usuarios ni contraseñas con producción (Supabase Auth es independiente en cada proyecto).
