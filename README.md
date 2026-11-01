# Restaurante El Lobo — sistema contable y de mostrador

Sistema propio del restaurante El Lobo (Montería, Colombia): pedidos, cobros, fiados, cierres de turno, inventario, gastos, tablero financiero y menú del día. Es **un solo archivo HTML** (sin instalación ni paso de compilación) que guarda sus datos en **Supabase** y se publica con **GitHub Pages**.

**Enlace permanente:** https://luiscadlo.github.io/Restaurante-El-Lobo/

> Este repositorio es **público**. Por eso nunca se suben datos reales, contraseñas ni llaves de servicio (ver "Qué NO se sube").

## Mapa del repositorio

| Ruta | Qué es |
|---|---|
| `index.html` | Entrada permanente del sitio: lleva al sistema. Si algún día cambia una carpeta, solo se edita este archivo. |
| `Contabilidad/ElLobo-Sistema Contable.html` | **El sistema.** HTML + JavaScript puro; habla con Supabase por REST y Auth. |
| `Contabilidad/modelo-financiero/` | Motor en Python que arma el modelo financiero (Excel) con un export de datos. Se corre a mano en el computador; no es parte del sitio. Tiene su propio README. |
| `Contabilidad/README.md` | Notas del módulo de descuentos y de las migraciones ya aplicadas. |
| `404.html` | Página que GitHub muestra si alguien abre una dirección que ya no existe (p. ej. un favorito viejo de la carpeta `Contabildad/`, que se eliminó el 1-nov-2026): explica que el enlace cambió y ofrece un botón al enlace correcto. No redirige sola. |
| `Menu/` | Solo el generador del menú del día (`Menú diario-El Lobo.html`, un HTML autónomo que la pestaña Menú del sistema carga en un iframe: **no se puede quitar**). Los materiales de diseño que había junto a él ya no se suben (están en `.gitignore`). |
| `sql/` | Scripts para Supabase: `rls_seguridad.sql` (reglas de acceso), `rollback_rls.sql` (deshacerlas), `candado_dias.sql` (caja solo puede cambiar lo de hoy) y `rollback_candado.sql` (quitarlo), `matriz_permisos.json` (fuente de esas reglas), `consulta_esquema.sql` (saca la estructura de la base, solo lectura), `restaurar_respaldo.sql` (las dos funciones de los botones «Restaurar desde un respaldo» y «Empezar de cero», solo administrador) y `rollback_restaurar.sql` (quitarlas), y migraciones. |
| `herramientas/` | `generar_rls.py` (SQL de seguridad desde la matriz de permisos) las de restauración: `esquema_a_sql.py`, `respaldo_a_sql.py`, `restaurar_respaldo.py` (ver `docs/RESTAURAR.md`) y `generar_copia_pruebas.py` (la copia de pruebas / réplica —sitio en carpeta o «archivo único» con el Menú incrustado—, ver `docs/PRUEBAS_REPLICA.md`). |
| `tests/` | Pruebas automáticas (ver `tests/LEEME.md`). No se publican ni tocan datos reales. |
| `docs/` | Documentación: `RUNBOOK.md` (operación diaria), `CONFIGURACION.md` (la pestaña ⚙️ Configuración), `RESTAURAR.md` (restaurar un respaldo), `PRUEBAS_REPLICA.md` (la réplica de pruebas), `DESPLIEGUE_SEGURIDAD.md`, `MATRIZ_PERMISOS.md`, `ESPECIFICO_EL_LOBO.md`. |

## Cómo se despliega

GitHub Pages publica la rama `main` tal cual. Cada cambio llega a `main` por un **pull request** revisado y con las pruebas en verde; al fusionarlo, el sitio se actualiza solo en 1–2 minutos. No hay servidor propio: el único servicio externo es Supabase (base de datos y usuarios). Pasos y reversa en `docs/RUNBOOK.md`.

## Cómo se entra

Con usuario y contraseña (Supabase Auth). Hay tres roles: **admin** (cada dueño con su usuario), **caja** (un usuario compartido para el mostrador) y **respaldo** (solo lectura, reservado por si algún día el respaldo se automatiza; no entra a la pantalla). Las reglas las hace cumplir la base de datos (RLS), no la pantalla; además, un **candado de días** (`sql/candado_dias.sql`) impide que caja cambie datos de días anteriores. Detalle en `docs/MATRIZ_PERMISOS.md`.

## Pruebas

```
npm install && npx playwright install chromium   # solo la primera vez
pip install -r requirements-dev.txt              # solo la primera vez
npm test                                         # el sistema web
npm run test:motor                               # motor Python y seguridad de la base
```

Correr `npm test` **antes de fusionar cualquier cambio a `main`**. Qué cubre cada archivo: `tests/LEEME.md`.

## Qué NO se sube (el repositorio es público)

- Archivos `.xlsx` / `.xls` con datos del negocio (exports del sistema, modelos generados), sin excepciones.
- Respaldos `.json` (`ElLobo_respaldo_*.json`) y exports (`ElLobo_datos_*`, `datos_*.json`). Guárdalos **fuera** del repositorio.
- Contraseñas, y cualquier llave de Supabase distinta de la **pública** (`anon`, que va en el HTML por diseño). **Nunca** la llave `service_role`.
- Archivos de entorno (`.env`) o claves de usuarios.

El archivo `.gitignore` bloquea los casos comunes, pero no deshace lo que ya estuvo en el historial: ante la duda, no subas.

## Documentación

- Operación del día a día, usuarios, respaldos y qué hacer si algo falla: [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- Restaurar un respaldo con el botón de la pestaña Datos, empezar de cero, ensayo y desastre: [`docs/RESTAURAR.md`](docs/RESTAURAR.md)
- La réplica de pruebas (probar cambios sin tocar el sistema real): [`docs/PRUEBAS_REPLICA.md`](docs/PRUEBAS_REPLICA.md)
- Seguridad (usuarios y reglas de la base) paso a paso: [`docs/DESPLIEGUE_SEGURIDAD.md`](docs/DESPLIEGUE_SEGURIDAD.md)
- Quién puede hacer qué: [`docs/MATRIZ_PERMISOS.md`](docs/MATRIZ_PERMISOS.md)
- Pruebas: [`tests/LEEME.md`](tests/LEEME.md)
- Modelo financiero: [`Contabilidad/modelo-financiero/README.md`](Contabilidad/modelo-financiero/README.md)
