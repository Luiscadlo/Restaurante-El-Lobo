// ⚙️ CONFIGURACIÓN → «Respaldo» → ¿cada cuánto se hace el respaldo completo? (semanal · mensual · trimestral)
// Todo contra el backend falso (que imita sql/configuracion_respaldo_frecuencia.sql: la clave respaldo_frecuencia solo acepta esos tres
// textos): nada toca tu Supabase real. Se comprueba, desde la pantalla, que:
//   · SIN nada guardado todo sigue como siempre: aviso semanal desde el día elegido (por defecto, el domingo);
//   · guardar «Mensual» o «Trimestral» (solo administrador, con confirmación, UNA fila nueva) cambia el aviso al instante;
//   · el caso del dueño: respaldo hecho el sábado 31-oct de noche y hoy domingo 1-nov → semanal avisa «hace 1 día», mensual NO avisa;
//   · el aviso mensual sale el último día del mes y no antes; el trimestral, el último día de marzo / junio / septiembre / diciembre;
//   · el aviso rojo nunca sale antes de 7 (semanal), 35 (mensual) o 100 (trimestral) días, aunque la configuración diga menos;
//   · un valor guardado que no sirve (p. ej. «diario») se ignora y rige lo de siempre;
//   · las reglas de la pantalla, del servidor falso y de la base real dan el mismo veredicto y el mismo mensaje (casos compartidos).
const { test, expect } = require('@playwright/test');
const { abrirSistema, validarConfiguracion } = require('./helpers/backend-falso');
const { datos: DATOS_BASE } = require('./fixtures/datos');
const { aceptarAvisos } = require('./helpers/ventanas');
const CASOS = require('./fixtures/casos-respaldo.json').casos;

const K = 'respaldo_frecuencia';
const copia = x => JSON.parse(JSON.stringify(x));
const irA = (page, id) => page.evaluate(i => showTab(i, document.querySelector(`.tab[onclick*="showTab('${i}'"]`)), id);
const escrituras = (reg, tabla, metodo) => reg.escrituras.filter(e => e.tabla === tabla && (!metodo || e.metodo === metodo));
const toasts = page => page.locator('.toast');
const fila = (id, clave, valor, desde = '2026-10-10T10:00:00-05:00') => ({ id, clave, valor, vigente_desde: desde, creado_por: 'luis', creado_en: desde });

// `hoy` = día simulado (14:00 de Bogotá); `ultimo` = fecha del último respaldo completo (undefined = nunca); `cfg` = filas de configuración.
async function abrir(page, { hoy = '2026-11-01', ultimo, cfg = [], usuario = 'admin' } = {}) {
  aceptarAvisos(page);
  const datos = copia(DATOS_BASE);
  datos.config = ultimo === undefined ? [] : [{ clave: 'ultimo_respaldo', valor: { fecha: ultimo } }];
  datos.configuracion = cfg;
  const reg = await abrirSistema(page, { datos, usuario, fecha: new Date(`${hoy}T14:00:00-05:00`) });
  return reg;
}
const aviso = page => page.locator('#aviso-respaldo');

test.describe('las reglas dicen lo mismo en la pantalla, el servidor falso y la base (casos compartidos)', () => {
  for (const caso of CASOS) {
    test(caso.id, async ({ page }) => {
      await abrir(page);
      const pantalla = await page.evaluate(([clave, valor]) => cfgValidar(clave, valor), [caso.clave, caso.valor]);
      expect(pantalla).toBe(caso.mensaje);
      const servidor = validarConfiguracion(caso.clave, caso.valor);
      expect(servidor ? servidor.message : null).toBe(caso.mensaje);
    });
  }
});

test.describe('sin nada guardado: como siempre (semanal)', () => {
  test('en Configuración se ve «Semanal» y que es el valor de siempre', async ({ page }) => {
    await abrir(page);
    await irA(page, 'config');
    await expect(page.locator(`#cfg-${K}`)).toHaveValue('semanal');
    await expect(page.locator(`#cfg-hoy-${K}`)).toContainText('Hoy: Semanal');
    await expect(page.locator(`#cfg-hoy-${K}`)).toContainText('el valor de siempre');
    await expect(page.locator(`#cfg-guardar-${K}`)).toBeDisabled();
  });

  test('domingo 1-nov con el respaldo del sábado 31-oct: avisa «Toca el respaldo semanal — hace 1 día»', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-01', ultimo: '2026-10-31' });
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('Toca el respaldo semanal');
    await expect(aviso(page)).toContainText('hace 1 día.');
  });

  test('nunca se ha hecho un respaldo: avisa, sea cual sea la frecuencia', async ({ page }) => {
    await abrir(page, { cfg: [fila(1, K, 'trimestral')] });
    await expect(aviso(page)).toContainText('Todavía no se ha hecho ningún respaldo completo.');
  });
});

test.describe('con «Mensual» guardado', () => {
  const MENSUAL = [fila(1, K, 'mensual')];

  test('el caso del dueño: respaldo del 31-oct y hoy domingo 1-nov → NO avisa', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-01', ultimo: '2026-10-31', cfg: MENSUAL });
    await expect(aviso(page)).toBeHidden();
  });

  test('a mitad de mes tampoco avisa (aunque el respaldo tenga 20 días)', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-20', ultimo: '2026-10-31', cfg: MENSUAL });
    await expect(aviso(page)).toBeHidden();
  });

  test('el último día del mes (30-nov) avisa con el texto mensual', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-30', ultimo: '2026-10-31', cfg: MENSUAL });
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page)).toContainText('Toca el respaldo mensual');
    await expect(aviso(page)).toContainText('hace 30 días.');
    await expect(aviso(page).locator('.alert.info')).toHaveCount(1);                           // ámbar, no rojo
  });

  test('el 1-dic sigue avisando hasta que haya un respaldo hecho desde el 30-nov', async ({ page, context }) => {
    await abrir(page, { hoy: '2026-12-01', ultimo: '2026-10-31', cfg: MENSUAL });
    await expect(aviso(page)).toContainText('Toca el respaldo mensual');
    const otra = await context.newPage();
    await abrir(otra, { hoy: '2026-12-01', ultimo: '2026-11-30', cfg: MENSUAL });             // lo hizo al cerrar la noche del 30
    await expect(otra.locator('#aviso-respaldo')).toBeHidden();
    const otra2 = await context.newPage();
    await abrir(otra2, { hoy: '2026-12-01', ultimo: '2026-12-01', cfg: MENSUAL });            // o el primero del mes antes de abrir
    await expect(otra2.locator('#aviso-respaldo')).toBeHidden();
  });

  test('se pone rojo a los 35 días (no a los 10 de la configuración semanal)', async ({ page }) => {
    await abrir(page, { hoy: '2026-12-05', ultimo: '2026-10-31', cfg: MENSUAL });             // 35 días
    await expect(aviso(page)).toContainText('Hace 35 días no se hace respaldo completo.');
    await expect(aviso(page).locator('.alert.warning')).toHaveCount(1);
  });
});

test.describe('con «Trimestral» guardado', () => {
  const TRIM = [fila(1, K, 'trimestral')];

  test('respaldo del 30-sep: no avisa en octubre, noviembre ni el 30-dic', async ({ page, context }) => {
    for (const hoy of ['2026-10-05', '2026-11-20', '2026-12-30']) {
      const p = await context.newPage();
      await abrir(p, { hoy, ultimo: '2026-09-30', cfg: TRIM });
      await expect(p.locator('#aviso-respaldo'), hoy).toBeHidden();
    }
  });

  test('el 31-dic avisa con el texto trimestral; el 1-ene también, hasta que se haga', async ({ page, context }) => {
    await abrir(page, { hoy: '2026-12-31', ultimo: '2026-09-30', cfg: TRIM });
    await expect(aviso(page)).toContainText('Toca el respaldo trimestral');
    const p = await context.newPage();
    await abrir(p, { hoy: '2027-01-05', ultimo: '2026-09-30', cfg: TRIM });                    // 97 días: todavía ámbar (el rojo es desde 100)
    await expect(p.locator('#aviso-respaldo')).toContainText('Toca el respaldo trimestral');
    const q = await context.newPage();
    await abrir(q, { hoy: '2027-01-05', ultimo: '2026-12-31', cfg: TRIM });
    await expect(q.locator('#aviso-respaldo')).toBeHidden();
  });

  test('se pone rojo a los 100 días', async ({ page }) => {
    await abrir(page, { hoy: '2027-01-08', ultimo: '2026-09-30', cfg: TRIM });                // 100 días
    await expect(aviso(page)).toContainText('Hace 100 días no se hace respaldo completo.');
  });
});

test.describe('la regla en detalle (vencimiento y nivel)', () => {
  test('el último día que «tocaba» tener un respaldo, para cada frecuencia', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => {
      const v = (f, hoy, dia = 0) => vencimientoRespaldo(f, hoy, dia);
      return {
        mensual: ['2026-11-01', '2026-11-15', '2026-11-29', '2026-11-30', '2026-12-01', '2027-01-01', '2028-03-01', '2027-03-01'].map(h => v('mensual', h)),
        trimestral: ['2026-11-01', '2026-12-30', '2026-12-31', '2027-01-01', '2027-02-15', '2027-03-31', '2027-04-01'].map(h => v('trimestral', h)),
        semanal: ['2026-11-01', '2026-11-04', '2026-10-31'].map(h => v('semanal', h)),
        semanalViernes: ['2026-11-01', '2026-11-06', '2026-11-07'].map(h => v('semanal', h, 5)),
      };
    });
    expect(r.mensual).toEqual(['2026-10-31', '2026-10-31', '2026-10-31', '2026-11-30', '2026-11-30', '2026-12-31', '2028-02-29', '2027-02-28']);
    expect(r.trimestral).toEqual(['2026-09-30', '2026-09-30', '2026-12-31', '2026-12-31', '2026-12-31', '2027-03-31', '2027-03-31']);
    expect(r.semanal).toEqual(['2026-11-01', '2026-11-01', '2026-10-25']);
    expect(r.semanalViernes).toEqual(['2026-10-30', '2026-11-06', '2026-11-06']);
  });

  test('semanal da lo mismo que la regla en días de siempre', async ({ page }) => {
    await abrir(page);
    const difs = await page.evaluate(() => {
      const malos = [];
      for (let dow = 0; dow < 7; dow++) for (let diaResp = 0; diaResp < 7; diaResp++) for (const dias of [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 25]) {
        // un «hoy» cualquiera con ese día de la semana (2026-11-01 es domingo)
        const hoy = new Date(Date.UTC(2026, 10, 1 + dow)).toISOString().slice(0, 10);
        const ult = new Date(Date.UTC(2026, 10, 1 + dow - dias)).toISOString().slice(0, 10);
        const viejo = nivelAvisoRespaldo(dias, dow, diaResp, 10), nuevo = nivelAvisoRespaldoPorFrecuencia(ult, hoy, 'semanal', diaResp, 10);
        if (viejo !== nuevo) malos.push({ dow, diaResp, dias, viejo, nuevo });
      }
      return malos;
    });
    expect(difs).toEqual([]);
  });

  test('el rojo nunca sale antes del mínimo de cada frecuencia y el ámbar solo lo da un respaldo anterior al vencimiento', async ({ page }) => {
    await abrir(page);
    const r = await page.evaluate(() => {
      const n = (u, hoy, f) => nivelAvisoRespaldoPorFrecuencia(u, hoy, f, 0, 10);
      return [
        n('2026-10-31', '2026-12-04', 'mensual'), n('2026-10-31', '2026-12-05', 'mensual'),                // 34 → ámbar · 35 → rojo
        n('2026-09-30', '2027-01-07', 'trimestral'), n('2026-09-30', '2027-01-08', 'trimestral'),         // 99 → ámbar · 100 → rojo
        n('2026-10-31', '2026-11-01', 'semanal'), n('2026-10-31', '2026-11-01', 'mensual'),
        n('2026-12-01', '2026-11-30', 'mensual'),                                                          // respaldo «del futuro»: no avisa
        n('', '2026-11-01', 'mensual'), n(null, '2026-11-01', 'semanal'),
        n('2026-10-31', '2026-11-01', 'diario'),                                                           // frecuencia ilegible → semanal
      ];
    });
    expect(r).toEqual(['ambar', 'rojo', 'ambar', 'rojo', 'ambar', null, null, 'ambar', 'ambar', 'ambar']);
  });

  test('un valor guardado que no sirve («diario») se ignora: rige lo de siempre', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-01', ultimo: '2026-10-31', cfg: [fila(1, K, 'diario')] });
    expect(await page.evaluate(() => CFG.v('respaldo_frecuencia'))).toBe('semanal');
    await expect(aviso(page)).toContainText('Toca el respaldo semanal');
  });
});

test.describe('guardar la frecuencia desde Configuración', () => {
  test('pide confirmación, manda UNA petición (la frecuencia y los días del aviso rojo) y el aviso cambia al instante', async ({ page }) => {
    const reg = await abrir(page, { hoy: '2026-11-01', ultimo: '2026-10-31' });
    await expect(aviso(page)).toContainText('Toca el respaldo semanal');
    await page.evaluate(() => { window.__noAceptarAvisos = true; });                            // la confirmación la contesta esta prueba
    await irA(page, 'config');
    await page.locator(`#cfg-${K}`).selectOption('mensual');
    await expect(page.locator(`#cfg-guardar-${K}`)).toBeEnabled();
    await page.click(`#cfg-guardar-${K}`);
    await expect(page.locator('#sis-cuerpo')).toContainText('Cada cuánto se hace el respaldo');
    await expect(page.locator('#sis-cuerpo')).toContainText('Hoy: Semanal  →  Nuevo: Mensual');
    await expect(page.locator('#sis-cuerpo')).toContainText('Días para el aviso rojo: 10  →  35');   // se ajustó solo al elegir «Mensual»
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);                          // todavía no se guardó
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'Guardado: Cada cuánto se hace el respaldo = Mensual' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(1);
    expect(escrituras(reg, 'configuracion', 'POST')[0].cuerpo).toEqual([{ clave: K, valor: 'mensual' }, { clave: 'respaldo_rojo_dias', valor: 35 }]);
    await expect(page.locator(`#cfg-hoy-${K}`)).toContainText('Hoy: Mensual');
    await expect(page.locator(`#cfg-${K}`)).toHaveValue('mensual');                            // el selector se queda en «Mensual»
    await expect(page.locator(`#cfg-guardar-${K}`)).toBeDisabled();
    await expect(aviso(page)).toBeHidden();                                                    // y el aviso semanal de hoy desapareció
  });

  test('«Volver» en la confirmación no guarda nada', async ({ page }) => {
    const reg = await abrir(page);
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await irA(page, 'config');
    await page.locator(`#cfg-${K}`).selectOption('trimestral');
    await page.click(`#cfg-guardar-${K}`);
    await page.click('#sis-opciones button[data-eleccion="no"]');
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);
    expect(await page.evaluate(() => CFG.v('respaldo_frecuencia'))).toBe('semanal');
  });

  test('el cambio queda en el historial de Configuración, con quién y cuándo', async ({ page }) => {
    await abrir(page, { cfg: [fila(1, K, 'trimestral')] });
    await irA(page, 'config');
    const hist = page.locator('#config-historial');
    await expect(hist).toContainText('Cada cuánto se hace el respaldo');
    await expect(hist.locator('tbody tr').first()).toContainText('Trimestral');
    await expect(hist.locator('tbody tr').first()).toContainText('luis');
    await expect(page.locator(`#cfg-${K}`)).toHaveValue('trimestral');
  });

  test('el servidor rechaza un valor inventado con el mismo mensaje (y la pantalla no lo deja ni intentar)', async ({ page }) => {
    const reg = await abrir(page);
    const mal = await page.evaluate(() => cfgValidar('respaldo_frecuencia', 'diario'));
    expect(mal).toBe('La frecuencia del respaldo debe ser semanal, mensual o trimestral.');
    const r = await page.evaluate(async () => { try { await sbInsert('configuracion', { clave: 'respaldo_frecuencia', valor: 'diario' }); return 'guardó'; } catch (e) { return e.message; } });
    expect(r).toContain('La frecuencia del respaldo debe ser semanal, mensual o trimestral.');
    expect(escrituras(reg, 'configuracion', 'POST').filter(e => e.ok !== false && e.cuerpo && e.cuerpo.valor === 'diario').length).toBe(0);
  });

  test('caja no ve el aviso ni puede guardar la configuración', async ({ page }) => {
    await abrir(page, { hoy: '2026-11-01', ultimo: '2026-10-31', usuario: 'caja' });
    await expect(aviso(page)).toBeHidden();
  });
});

const ROJO = 'respaldo_rojo_dias';
test.describe('los días del aviso rojo se ajustan solos a la frecuencia y no bajan de su mínimo', () => {
  const rojo = page => page.locator(`#cfg-${ROJO}`);

  test('al elegir cada frecuencia el número salta a 10 / 35 / 100; al volver a la guardada, vuelve lo guardado', async ({ page }) => {
    await abrir(page);
    await irA(page, 'config');
    await expect(rojo(page)).toHaveValue('10');
    await page.locator(`#cfg-${K}`).selectOption('mensual');
    await expect(rojo(page)).toHaveValue('35');
    await page.locator(`#cfg-${K}`).selectOption('trimestral');
    await expect(rojo(page)).toHaveValue('100');
    await page.locator(`#cfg-${K}`).selectOption('semanal');
    await expect(rojo(page)).toHaveValue('10');                      // lo guardado
    await expect(page.locator(`#cfg-guardar-${ROJO}`)).toBeDisabled();
  });

  test('con «Trimestral» no deja guardar menos de 100 días, pero sí 120; con «Mensual», menos de 35 no, 40 sí', async ({ page }) => {
    const reg = await abrir(page);
    await irA(page, 'config');
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await page.locator(`#cfg-${K}`).selectOption('trimestral');
    await rojo(page).fill('60');                                      // el servidor lo aceptaría (7–400): lo frena la pantalla
    await page.click(`#cfg-guardar-${ROJO}`);
    await expect(toasts(page).filter({ hasText: 'Con respaldo trimestral los días para el aviso rojo no pueden ser menos de 100' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);
    await page.locator(`#cfg-${K}`).selectOption('mensual');
    await rojo(page).fill('34');
    await page.click(`#cfg-guardar-${K}`);                            // guardar la frecuencia con un número por debajo del mínimo
    await expect(toasts(page).filter({ hasText: 'Con respaldo mensual los días para el aviso rojo no pueden ser menos de 35' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')).toHaveLength(0);
    await rojo(page).fill('40');
    await page.click(`#cfg-guardar-${K}`);
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'aviso rojo a los 40 días' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')[0].cuerpo).toEqual([{ clave: K, valor: 'mensual' }, { clave: ROJO, valor: 40 }]);
  });

  test('trimestral con 100 días: se guardan las dos filas y el servidor las acepta (el tope ya no es 60)', async ({ page }) => {
    const reg = await abrir(page);
    await irA(page, 'config');
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await page.locator(`#cfg-${K}`).selectOption('trimestral');
    await page.click(`#cfg-guardar-${K}`);
    await expect(page.locator('#sis-cuerpo')).toContainText('Días para el aviso rojo: 10  →  100');
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'aviso rojo a los 100 días' })).toHaveCount(1);
    expect(await page.evaluate(() => [CFG.v('respaldo_frecuencia'), CFG.v('respaldo_rojo_dias')])).toEqual(['trimestral', 100]);
    await expect(rojo(page)).toHaveValue('100');
    await expect(page.locator(`#cfg-hoy-${ROJO}`)).toContainText('100 días');
    await expect(page.locator(`#cfg-guardar-${K}`)).toBeDisabled();
    await expect(page.locator(`#cfg-guardar-${ROJO}`)).toBeDisabled();
  });

  test('si una de las dos filas la rechaza el servidor, no se guarda NINGUNA (una sola petición)', async ({ page }) => {
    const reg = await abrir(page);
    reg.control.fallasEscritura.push({ tabla: 'configuracion', metodo: 'POST', tipo: 'servidor' });
    await irA(page, 'config');
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await page.locator(`#cfg-${K}`).selectOption('mensual');
    await page.click(`#cfg-guardar-${K}`);
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'No se pudo guardar' })).toHaveCount(1);
    expect(await page.evaluate(() => [CFG.v('respaldo_frecuencia'), CFG.v('respaldo_rojo_dias')])).toEqual(['semanal', 10]);
  });

  test('guardar solo los días (sin cambiar la frecuencia) sigue siendo una fila; más alto que el mínimo vale', async ({ page }) => {
    const reg = await abrir(page, { cfg: [fila(1, K, 'mensual'), fila(2, ROJO, 35)] });
    await irA(page, 'config');
    await page.evaluate(() => { window.__noAceptarAvisos = true; });
    await rojo(page).fill('50');
    await page.click(`#cfg-guardar-${ROJO}`);
    await page.click('#sis-opciones button[data-eleccion="si"]');
    await expect(toasts(page).filter({ hasText: 'Guardado: Días sin respaldo para el aviso rojo = 50' })).toHaveCount(1);
    expect(escrituras(reg, 'configuracion', 'POST')[0].cuerpo).toEqual({ clave: ROJO, valor: 50 });
  });

  test('la ayuda lo explica y el tope de la pantalla es 400, igual que el de la base', async ({ page }) => {
    await abrir(page);
    await irA(page, 'config');
    await expect(page.locator('.cfg-fila', { has: rojo(page) })).toContainText('se ajusta solo (semanal 10 · mensual 35 · trimestral 100)');
    expect(await page.evaluate(() => [cfgValidar('respaldo_rojo_dias', 400), cfgValidar('respaldo_rojo_dias', 401)])).toEqual([null, 'Los días para el aviso rojo del respaldo debe ser un número entero entre 7 y 400.']);
    expect(validarConfiguracion(ROJO, 401)).not.toBeNull();
    expect(validarConfiguracion(ROJO, 400)).toBeNull();
  });
});

test.describe('textos de la pestaña Datos', () => {
  test('ya no dice «cada domingo»: manda a la frecuencia elegida en Configuración', async ({ page }) => {
    await abrir(page);
    const texto = await page.evaluate(() => document.body.innerText);
    expect(texto).not.toContain('Hazlo cada domingo');
    expect(await page.evaluate(() => document.documentElement.innerHTML.includes('con la frecuencia que elegiste en'))).toBe(true);
  });
});
