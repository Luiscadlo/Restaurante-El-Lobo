// Reglas de plata del sistema, probadas sobre las funciones REALES del HTML.
//
// Cada valor esperado está calculado A MANO (ver los comentarios y tests/fixtures/datos.js),
// NO copiado de lo que devuelve la función: así, si una función tuviera un error, la prueba
// lo muestra en vez de congelarlo.
const { test, expect } = require('@playwright/test');
const { abrirSistema } = require('./helpers/backend-falso');

let reg;
test.beforeEach(async ({ page }) => {
  reg = await abrirSistema(page);
});
test.afterEach(() => {
  // Ninguna regla de plata debe lanzar errores de JavaScript ni escribir en la base.
  expect(reg.errores).toEqual([]);
  expect(reg.escrituras).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// repartirDescuento(filas, D): reparte un descuento D (pesos enteros) entre filas de un mismo
// pedido, proporcional al valor de lista. Debe sumar EXACTO D, sin filas negativas ni por
// encima de su valor de lista.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('repartirDescuento', () => {
  const rep = (page, valores, D) =>
    page.evaluate(([v, d]) => repartirDescuento(v.map(x => ({ valorLista: x })), d), [valores, D]);
  const falla = (page, valores, D) =>
    page.evaluate(([v, d]) => { try { repartirDescuento(v.map(x => ({ valorLista: x })), d); return null; } catch (e) { return e.message; } }, [valores, D]);

  test('reparto proporcional exacto: 3.000 sobre 10.000 y 20.000 → 1.000 y 2.000', async ({ page }) => {
    // 10000·3000/30000 = 1000 ; 20000·3000/30000 = 2000
    expect(await rep(page, [10000, 20000], 3000)).toEqual([1000, 2000]);
  });

  test('resto de redondeo: 1.000 sobre tres filas de 10.000 → 334, 333, 333', async ({ page }) => {
    // cada una: floor(10000·1000/30000) = 333 ; suman 999 ; el peso que falta va a la primera (empate → menor índice)
    expect(await rep(page, [10000, 10000, 10000], 1000)).toEqual([334, 333, 333]);
  });

  test('D = 0 → todas en 0', async ({ page }) => {
    expect(await rep(page, [5000, 7000], 0)).toEqual([0, 0]);
  });

  test('D = total del pedido → cada fila queda con todo su valor de lista', async ({ page }) => {
    expect(await rep(page, [5000, 7000], 12000)).toEqual([5000, 7000]);
  });

  test('una sola fila', async ({ page }) => {
    expect(await rep(page, [15000], 2000)).toEqual([2000]);
  });

  test('fila con valor 0 no recibe descuento', async ({ page }) => {
    // 0·500/10000 = 0 ; 10000·500/10000 = 500
    expect(await rep(page, [0, 10000], 500)).toEqual([0, 500]);
  });

  test('filas de 1 peso: el último peso va a la primera fila', async ({ page }) => {
    expect(await rep(page, [1, 1], 1)).toEqual([1, 0]);
    expect(await rep(page, [1, 1], 2)).toEqual([1, 1]);
  });

  test('sin filas: D = 0 → []', async ({ page }) => {
    expect(await rep(page, [], 0)).toEqual([]);
  });

  test('errores: D mayor que el total, negativo, decimal, o sin filas con D > 0', async ({ page }) => {
    expect(await falla(page, [10000, 5000], 15001)).toBeTruthy();   // supera el valor de lista
    expect(await falla(page, [10000, 5000], -1)).toBeTruthy();      // negativo
    expect(await falla(page, [10000, 5000], 1000.5)).toBeTruthy();  // no entero
    expect(await falla(page, [], 500)).toBeTruthy();                // nada que repartir
  });

  test('propiedad: 2.000 casos al azar (semilla fija) suman exacto, sin negativos ni pasar el valor de lista', async ({ page }) => {
    const r = await page.evaluate(() => {
      let s = 123456789;                       // generador con semilla → reproducible
      const azar = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const fallos = [];
      for (let t = 0; t < 2000; t++) {
        const k = 1 + Math.floor(azar() * 6);
        const filas = Array.from({ length: k }, () => ({ valorLista: Math.floor(azar() * 40) * 500 }));
        const total = filas.reduce((a, f) => a + f.valorLista, 0);
        const D = Math.floor(azar() * (total + 1));
        const out = repartirDescuento(filas, D);
        const suma = out.reduce((a, b) => a + b, 0);
        if (suma !== D || out.length !== k || out.some((x, i) => !Number.isInteger(x) || x < 0 || x > filas[i].valorLista)) {
          fallos.push({ filas, D, out });
        }
      }
      return { fallos: fallos.length, ejemplo: fallos[0] || null };
    });
    expect(r.fallos, JSON.stringify(r.ejemplo)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// efectivoDe / transferenciaDe / montoIngreso: cuánta plata aportó un pedido a cada columna.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('efectivoDe, transferenciaDe y montoIngreso', () => {
  const ef = (page, p) => page.evaluate(x => [efectivoDe(x), transferenciaDe(x)], p);

  test('efectivo, transferencia y dividido', async ({ page }) => {
    expect(await ef(page, { metodo: 'efectivo', monto_total: 15000 })).toEqual([15000, 0]);
    expect(await ef(page, { metodo: 'transferencia', monto_total: 16000 })).toEqual([0, 16000]);
    expect(await ef(page, { metodo: 'dividido', monto_total: 20000, monto_efectivo: 12000, monto_transferencia: 8000 })).toEqual([12000, 8000]);
  });

  test('gratis no aporta nada, ni en columnas ni como ingreso', async ({ page }) => {
    expect(await ef(page, { metodo: 'gratis', monto_total: 15000, es_gratis: true })).toEqual([0, 0]);
    expect(await page.evaluate(() => montoIngreso({ es_gratis: true, monto_total: 15000 }))).toBe(0);
    expect(await page.evaluate(() => montoIngreso({ es_gratis: false, monto_total: 15000 }))).toBe(15000);
  });

  test('fiado saldado con abonos NUEVOS (con fecha_pago) vale 0 en las columnas; el viejo (sin fecha_pago) cuenta normal', async ({ page }) => {
    const nuevo = { metodo: 'efectivo', monto_total: 15000, pagado_via_abono: true, fecha_pago: '2026-10-18' };
    const viejo = { metodo: 'efectivo', monto_total: 10000, pagado_via_abono: true, fecha_pago: null };
    expect(await ef(page, nuevo)).toEqual([0, 0]);
    expect(await ef(page, viejo)).toEqual([10000, 0]);
  });

  test('campos vacíos no dan NaN', async ({ page }) => {
    expect(await ef(page, { metodo: 'efectivo' })).toEqual([0, 0]);
    expect(await ef(page, { metodo: 'dividido' })).toEqual([0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcularSaldoFiado(clienteId) con los datos de ejemplo (cargados por loadState).
//   saldo = pedidos fiados pendientes − (abonos − pedidos ya pagados vía abono)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('calcularSaldoFiado', () => {
  test('cliente 1: pendientes 20.000+15.000, abonos 10.000+5.000+7.000+4.000 → saldo 9.000', async ({ page }) => {
    const s = await page.evaluate(() => calcularSaldoFiado(1));
    expect(s.totalPendiente).toBe(35000);
    expect(s.totalAbonos).toBe(26000);
    expect(s.totalPagadoViaAbono).toBe(0);
    expect(s.sobrante).toBe(26000);
    expect(s.saldo).toBe(9000);   // 35.000 − 26.000
  });

  test('cliente 2: su pedido de 15.000 ya se saldó con un abono de 15.000 → saldo 0', async ({ page }) => {
    const s = await page.evaluate(() => calcularSaldoFiado(2));
    expect(s.totalPendiente).toBe(0);
    expect(s.totalAbonos).toBe(15000);
    expect(s.totalPagadoViaAbono).toBe(15000);
    expect(s.sobrante).toBe(0);
    expect(s.saldo).toBe(0);
  });

  test('cliente sin movimientos → todo en 0', async ({ page }) => {
    const s = await page.evaluate(() => calcularSaldoFiado(99));
    expect(s).toEqual({ totalPendiente: 0, totalAbonos: 0, totalPagadoViaAbono: 0, sobrante: 0, saldo: 0 });
  });

  test('abonos que ya cubrieron pedidos completos dejan sobrante: debe 12.000, abonó 30.000, ya aplicó 20.000 → saldo 2.000', async ({ page }) => {
    const s = await page.evaluate(() => {
      ST.pendientes = [{ es_fiar: true, cliente_fiado_id: 5, monto_total: 12000 }];
      ST.ingresos = [{ cliente_fiado_id: 5, pagado_via_abono: true, monto_total: 20000 }];
      ST.abonosFiado = [{ cliente_fiado_id: 5, monto: 30000 }];
      return calcularSaldoFiado(5);
    });
    expect(s.sobrante).toBe(10000);  // 30.000 − 20.000
    expect(s.saldo).toBe(2000);      // 12.000 − 10.000
  });

  test('un abono mayor a la deuda deja saldo negativo (a favor del cliente)', async ({ page }) => {
    const s = await page.evaluate(() => {
      ST.pendientes = [{ es_fiar: true, cliente_fiado_id: 6, monto_total: 5000 }];
      ST.ingresos = [];
      ST.abonosFiado = [{ cliente_fiado_id: 6, monto: 8000 }];
      return calcularSaldoFiado(6);
    });
    expect(s.saldo).toBe(-3000);     // 5.000 − 8.000
  });
});

test.describe('gruposFiadoHuerfanos', () => {
  test('agrupa por grupo_pedido, ordena por fecha/hora y deja fuera los que sí tienen cliente', async ({ page }) => {
    const r = await page.evaluate(() => {
      ST.pendientes = [
        { id: 1, es_fiar: true, cliente_fiado_id: null, grupo_pedido: 'gA', fecha: '2026-10-02', hora: '10:05' },
        { id: 2, es_fiar: true, cliente_fiado_id: null, grupo_pedido: 'gA', fecha: '2026-10-02', hora: '10:00' },
        { id: 3, es_fiar: true, cliente_fiado_id: null, grupo_pedido: null, fecha: '2026-10-01', hora: '09:00' },
        { id: 4, es_fiar: true, cliente_fiado_id: 7, grupo_pedido: 'gB', fecha: '2026-10-03', hora: '11:00' },
        { id: 5, es_fiar: false, cliente_fiado_id: null, grupo_pedido: 'gC', fecha: '2026-10-03', hora: '11:00' },
      ];
      return gruposFiadoHuerfanos().map(g => g.orders.map(o => o.id));
    });
    // grupo sin grupo_pedido (id 3, 01-oct) primero; luego gA con sus pedidos por hora: 2 (10:00) y 1 (10:05)
    expect(r).toEqual([[3], [2, 1]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cierres: ajustesDeCierre y abonosDeCierre
// ─────────────────────────────────────────────────────────────────────────────
test.describe('ajustesDeCierre y abonosDeCierre', () => {
  const aj = (page, c) => page.evaluate(x => ajustesDeCierre(x), c);

  test('cierre ANTIGUO: solo ajuste_manual → va a efectivo', async ({ page }) => {
    expect(await aj(page, { ajuste_manual: 5000 })).toEqual({ efectivo: 5000, transferencia: 0, total: 5000 });
  });

  test('cierre NUEVO: ajustes separados; ajuste_manual se ignora si ajuste_efectivo existe', async ({ page }) => {
    // −3.000 + 2.000 = −1.000
    expect(await aj(page, { ajuste_efectivo: -3000, ajuste_transferencia: 2000, ajuste_manual: 999 }))
      .toEqual({ efectivo: -3000, transferencia: 2000, total: -1000 });
  });

  test('solo ajuste de transferencia', async ({ page }) => {
    expect(await aj(page, { ajuste_transferencia: 2500 })).toEqual({ efectivo: 0, transferencia: 2500, total: 2500 });
  });

  test('sin ajustes o con nulos → todo en 0', async ({ page }) => {
    expect(await aj(page, {})).toEqual({ efectivo: 0, transferencia: 0, total: 0 });
    expect(await aj(page, { ajuste_efectivo: null, ajuste_manual: null, ajuste_transferencia: null }))
      .toEqual({ efectivo: 0, transferencia: 0, total: 0 });
  });

  test('comportamiento actual: ajuste_efectivo = 0 explícito gana sobre un ajuste_manual viejo', async ({ page }) => {
    // Documenta lo que hace hoy el código (la columna nueva manda si no es nula, aunque sea 0).
    expect(await aj(page, { ajuste_efectivo: 0, ajuste_manual: 5000 })).toEqual({ efectivo: 0, transferencia: 0, total: 0 });
  });

  test('abonosDeCierre suma los abonos de efectivo y transferencia; cierres viejos o nulos → 0', async ({ page }) => {
    const ab = c => page.evaluate(x => abonosDeCierre(x), c);
    expect(await ab({ abonos_efectivo: 25000, abonos_transferencia: 0 })).toBe(25000);
    expect(await ab({ abonos_efectivo: 7000, abonos_transferencia: 4000 })).toBe(11000);
    expect(await ab({})).toBe(0);
    expect(await ab({ abonos_efectivo: null, abonos_transferencia: null })).toBe(0);
  });

  test('los cierres de ejemplo cuadran con las cuentas a mano', async ({ page }) => {
    const r = await page.evaluate(() => ST.cierresDia.map(c => ({ f: c.fecha, a: ajustesDeCierre(c).total, ab: abonosDeCierre(c) })));
    const por = Object.fromEntries(r.map(x => [x.f, x]));
    expect(por['2026-10-05']).toMatchObject({ a: 5000, ab: 0 });
    expect(por['2026-10-18']).toMatchObject({ a: -1000, ab: 25000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// calcularVentasFijas(fecha, turno) con los datos de ejemplo.
// Almuerzo del 20-oct:
//   pedidos pagados: efectivo 15.000 + dividido(12.000 efvo/8.000 transf) + efectivo con descuento 13.000
//                    + gratis 0 → efectivo 40.000 ; transferencia 16.000 + 8.000 = 24.000
//   desayuno: 30.000 efectivo + 10.000 transferencia (solo en el turno de almuerzo)
//   abonos con turno ese día: 7.000 efectivo + 4.000 transferencia (el abono viejo, sin turno, no cuenta)
//   → efectivo 40.000+30.000+7.000 = 77.000 ; transferencia 24.000+10.000+4.000 = 38.000
// ─────────────────────────────────────────────────────────────────────────────
test.describe('calcularVentasFijas', () => {
  test('almuerzo del 20-oct: pedidos + desayuno + abonos del turno', async ({ page }) => {
    const v = await page.evaluate(() => calcularVentasFijas('2026-10-20', 'almuerzo'));
    expect(v.efectivo).toBe(77000);
    expect(v.transferencia).toBe(38000);
    expect(v.cajaInicial).toBe(50000);
    expect(v.ventaDesayuno).toBe(40000);
    expect(v.ventaDesayunoEfectivo).toBe(30000);
    expect(v.ventaDesayunoTransferencia).toBe(10000);
    expect(v.abonosEfectivo).toBe(7000);
    expect(v.abonosTransferencia).toBe(4000);
    expect(v.abonos.length).toBe(2);
    expect(v.tieneApertura).toBe(true);
  });

  test('noche del 20-oct: sin apertura ni desayuno; solo un pedido de 18.000 en efectivo', async ({ page }) => {
    const v = await page.evaluate(() => calcularVentasFijas('2026-10-20', 'cena'));
    expect(v.efectivo).toBe(18000);
    expect(v.transferencia).toBe(0);
    expect(v.cajaInicial).toBe(0);
    expect(v.ventaDesayuno).toBe(0);
    expect(v.abonos.length).toBe(0);
    expect(v.tieneApertura).toBe(false);
  });

  test('almuerzo del 18-oct: solo abonos (10.000 + 15.000 en efectivo) y coincide con el cierre guardado', async ({ page }) => {
    const v = await page.evaluate(() => calcularVentasFijas('2026-10-18', 'almuerzo'));
    expect(v.efectivo).toBe(25000);
    expect(v.transferencia).toBe(0);
    const cierre = await page.evaluate(() => abonosDeCierre(ST.cierresDia.find(c => c.fecha === '2026-10-18')));
    expect(cierre).toBe(25000);
  });

  test('el fiado saldado con abonos nuevos NO suma plata el día del consumo (12-oct)', async ({ page }) => {
    const v = await page.evaluate(() => calcularVentasFijas('2026-10-12', 'almuerzo'));
    expect(v.efectivo).toBe(0);
    expect(v.transferencia).toBe(0);
  });

  test('fecha sin ningún movimiento → todo en 0', async ({ page }) => {
    const v = await page.evaluate(() => calcularVentasFijas('2026-01-01', 'almuerzo'));
    expect([v.efectivo, v.transferencia, v.cajaInicial, v.ventaDesayuno]).toEqual([0, 0, 0, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Descuentos: ¿están disponibles las columnas y la tabla en Supabase?
// ─────────────────────────────────────────────────────────────────────────────
test.describe('descuentosDisponibles', () => {
  test('con tabla y columna presentes → true', async ({ page }) => {
    expect(await page.evaluate(() => descuentosDisponibles())).toBe(true);
  });
  test('si pedidos_descuentos no existe (null) → false', async ({ page }) => {
    expect(await page.evaluate(() => { ST.pedidosDescuentos = null; return descuentosDisponibles(); })).toBe(false);
  });
  test('instalación nueva (sin pedidos y tabla presente) → se asume que sí', async ({ page }) => {
    expect(await page.evaluate(() => { ST.ingresos = []; ST.pendientes = []; ST.pedidosDescuentos = []; return descuentosDisponibles(); })).toBe(true);
  });
  test('si los pedidos no traen la columna "descuento" → false', async ({ page }) => {
    expect(await page.evaluate(() => { ST.ingresos = [{ id: 1 }]; ST.pedidosDescuentos = []; return descuentosDisponibles(); })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fechas y formato de pesos
// ─────────────────────────────────────────────────────────────────────────────
test.describe('fechas y formato', () => {
  test('toLocalDateStr usa la fecha LOCAL (no la de UTC)', async ({ page }) => {
    expect(await page.evaluate(() => toLocalDateStr(new Date(2026, 9, 5)))).toBe('2026-10-05');
    // 31-dic 23:30 en Bogotá ya es 01-ene en UTC; debe seguir siendo 31-dic.
    expect(await page.evaluate(() => toLocalDateStr(new Date(2026, 11, 31, 23, 30)))).toBe('2026-12-31');
  });

  test('fmt, fmtSigned y fmtAjuste', async ({ page }) => {
    const r = await page.evaluate(() => [fmt(1234567), fmt(-5000), fmtSigned(-5000), fmtSigned(5000), fmtAjuste(5000), fmtAjuste(-5000), fmtAjuste(0)]);
    expect(r).toEqual(['$1.234.567', '$5.000', '− $5.000', '$5.000', '+ $5.000', '− $5.000', '$0']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Antigüedad de fiados y pendientes (Prompt B). "Hoy" en las pruebas = martes 2026-10-20 y
// las 14:00. Todos los valores esperados salen de contar los días en el calendario a mano.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('antiguedadDias', () => {
  const dias = (page, fecha, hoy) => page.evaluate(([f, h]) => antiguedadDias(f, h), [fecha, hoy]);

  test('mismo día → 0 y día anterior → 1', async ({ page }) => {
    expect(await dias(page, '2026-10-20', '2026-10-20')).toBe(0);
    expect(await dias(page, '2026-10-19', '2026-10-20')).toBe(1);
  });

  test('sin segundo argumento usa el día de hoy (20-oct): del 10-oct son 10 días', async ({ page }) => {
    expect(await page.evaluate(() => antiguedadDias('2026-10-10'))).toBe(10);
  });

  test('cruce de mes: del 30-sep al 2-oct son 2 días; del 25-sep al 3-oct son 8 (5 + 3)', async ({ page }) => {
    expect(await dias(page, '2026-09-30', '2026-10-02')).toBe(2);
    expect(await dias(page, '2026-09-25', '2026-10-03')).toBe(8);
  });

  test('cruce de año y febrero (2026 no es bisiesto, 2028 sí)', async ({ page }) => {
    expect(await dias(page, '2025-12-30', '2026-01-02')).toBe(3);
    expect(await dias(page, '2026-02-28', '2026-03-01')).toBe(1);
    expect(await dias(page, '2028-02-28', '2028-03-01')).toBe(2);
  });

  test('fecha futura → número negativo', async ({ page }) => {
    expect(await dias(page, '2026-10-22', '2026-10-20')).toBe(-2);
  });

  test('fecha vacía, mal escrita o inexistente → null', async ({ page }) => {
    for (const mala of ['', null, undefined, 'abc', '20261020', '2026-13-01', '2026-02-31', '2026-10-5']) {
      expect(await dias(page, mala, '2026-10-20'), `fecha ${JSON.stringify(mala)}`).toBeNull();
    }
    expect(await dias(page, '2026-10-10', 'mañana')).toBeNull();
  });
});

test.describe('clasePorAntiguedad y claseFiado', () => {
  const clase = (page, d) => page.evaluate(x => clasePorAntiguedad(x), d);
  const claseF = (page, fecha, hoy) => page.evaluate(([f, h]) => claseFiado(f, h), [fecha, hoy]);

  test('los umbrales por defecto son 8, 15 y 25 días', async ({ page }) => {
    expect(await page.evaluate(() => [FIADO_AMARILLO_DIAS, FIADO_NARANJA_DIAS, FIADO_ROJO_DIAS])).toEqual([8, 15, 25]);
  });

  test('el día exacto del umbral ya cuenta en el color siguiente (7/8, 14/15, 24/25)', async ({ page }) => {
    expect(await clase(page, 0)).toBe('reciente');
    expect(await clase(page, 7)).toBe('reciente');
    expect(await clase(page, 8)).toBe('amarillo');
    expect(await clase(page, 14)).toBe('amarillo');
    expect(await clase(page, 15)).toBe('naranja');
    expect(await clase(page, 24)).toBe('naranja');
    expect(await clase(page, 25)).toBe('rojo');
    expect(await clase(page, 90)).toBe('rojo');
  });

  test('días negativos son "reciente"; sin número válido no se pinta nada (null)', async ({ page }) => {
    expect(await clase(page, -3)).toBe('reciente');
    for (const malo of [null, undefined, NaN, 'ocho']) {
      expect(await clase(page, malo), `dias ${String(malo)}`).toBeNull();
    }
  });

  test('claseFiado por fecha, dentro del mismo mes', async ({ page }) => {
    expect(await claseF(page, '2026-10-20', '2026-10-20')).toBe('reciente');
    expect(await claseF(page, '2026-10-12', '2026-10-20')).toBe('amarillo');   // 8 días
    expect(await claseF(page, '2026-10-05', '2026-10-20')).toBe('naranja');    // 15 días
    expect(await claseF(page, '2026-10-01', '2026-10-26')).toBe('rojo');       // 25 días
  });

  test('un fiado de un mes anterior es rojo aunque lleve pocos días (30-sep visto el 1-oct)', async ({ page }) => {
    expect(await claseF(page, '2026-09-30', '2026-10-01')).toBe('rojo');       // 1 día
    expect(await claseF(page, '2025-12-31', '2026-01-02')).toBe('rojo');       // cruce de año
    expect(await claseF(page, '2026-10-01', '2026-10-01')).toBe('reciente');   // mismo mes, mismo día
  });

  test('claseFiado con fecha vacía o inválida → null', async ({ page }) => {
    expect(await claseF(page, '', '2026-10-20')).toBeNull();
    expect(await claseF(page, '2026-02-31', '2026-10-20')).toBeNull();
  });
});

test.describe('tiempo abierto y chips', () => {
  test('minutosAbierto: hora del pedido → hora actual, nunca negativo, null si no es HH:MM', async ({ page }) => {
    const r = await page.evaluate(() => [
      minutosAbierto('12:30', '14:00'), minutosAbierto('9:05', '09:35'), minutosAbierto('14:00', '14:00'),
      minutosAbierto('15:00', '14:00'), minutosAbierto('', '14:00'), minutosAbierto('abc', '14:00'), minutosAbierto(null, '14:00'),
    ]);
    expect(r).toEqual([90, 30, 0, 0, null, null, null]);
  });

  test('textoTiempoAbierto', async ({ page }) => {
    const r = await page.evaluate(() => [0, 45, 60, 90, 125].map(textoTiempoAbierto));
    expect(r).toEqual(['0 min', '45 min', '1 h', '1 h 30 min', '2 h 5 min']);
  });

  test('chipFiadoHTML: texto y color según los días', async ({ page }) => {
    const chip = (f) => page.evaluate(x => chipFiadoHTML(x, '2026-10-20'), f);
    const hoy = await chip('2026-10-20');
    expect(hoy).toContain('de hoy');            expect(hoy).toContain('badge-green');
    const ayer = await chip('2026-10-19');
    expect(ayer).toContain('de ayer');          expect(ayer).toContain('badge-green');
    const doce = await chip('2026-10-08');      // 12 días → amarillo
    expect(doce).toContain('hace 12 días');     expect(doce).toContain('badge-accent');
    const quince = await chip('2026-10-05');    // 15 días → naranja
    expect(quince).toContain('hace 15 días');   expect(quince).toContain('badge-orange');
    const mesAnt = await chip('2026-09-29');    // 21 días y de otro mes → rojo
    expect(mesAnt).toContain('hace 21 días');   expect(mesAnt).toContain('badge-red'); expect(mesAnt).toContain('mes anterior');
    expect(await chip('')).toBe('');
  });

  test('chipPendienteHTML: de hoy → tiempo abierto; de ayer / de otro día → rojo', async ({ page }) => {
    const chip = (orders) => page.evaluate(o => chipPendienteHTML(o, '2026-10-20', '14:00'), orders);
    const hoy = await chip([{ fecha: '2026-10-20', hora: '12:30' }]);          // 90 min
    expect(hoy).toContain('1 h 30 min');  expect(hoy).toContain('badge-gray');
    // varios platos: cuenta desde el primero (hora más temprana): 13:20 → 40 min
    expect(await chip([{ fecha: '2026-10-20', hora: '13:40' }, { fecha: '2026-10-20', hora: '13:20' }])).toContain('40 min');
    const ayer = await chip([{ fecha: '2026-10-19', hora: '13:00' }]);
    expect(ayer).toContain('de ayer');    expect(ayer).toContain('badge-red');
    const otro = await chip([{ fecha: '2026-10-14', hora: '13:00' }]);
    expect(otro).toContain('de 14-10');   expect(otro).toContain('badge-red');
    expect(await chip([{ fecha: '2026-09-03', hora: '13:00' }])).toContain('de 03-09');
  });

  test('chipPendienteHTML: sin hora, sin fecha o fecha futura → sin chip', async ({ page }) => {
    const chip = (orders) => page.evaluate(o => chipPendienteHTML(o, '2026-10-20', '14:00'), orders);
    expect(await chip([{ fecha: '2026-10-20' }])).toBe('');
    expect(await chip([{ hora: '12:00' }])).toBe('');
    expect(await chip([{ fecha: '2026-10-25', hora: '12:00' }])).toBe('');
    expect(await chip([])).toBe('');
  });
});
