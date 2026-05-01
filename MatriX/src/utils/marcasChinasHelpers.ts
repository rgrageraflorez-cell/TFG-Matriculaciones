/**
 * marcasChinasHelpers.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Funciones puras de agregación y derivación para la sección "Irrupción de
 * fabricantes chinos en el mercado español". Sin efectos, sin React.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { esMarcaChina, normalizarMarca } from "../config/marcasChinas";

export type FilaMarcaMes = {
  fecha_mes: string; // YYYY-MM-01
  marca: string;
  matriculaciones: number;
};

export type CuotaMensualPunto = {
  fecha_mes: string;
  total: number;        // matriculaciones totales del mes (todas las marcas)
  chinas: number;       // matriculaciones chinas del mes
  cuota_pct: number;    // chinas / total * 100
};

/**
 * Calcula la serie temporal mensual de cuota china agregada.
 * Para cada mes de la serie devuelve total, chinas y cuota porcentual.
 */
export function calcularSerieCuotaChina(
  filas: FilaMarcaMes[],
): CuotaMensualPunto[] {
  const acc = new Map<string, { total: number; chinas: number }>();
  for (const r of filas) {
    if (!r.fecha_mes || !Number.isFinite(r.matriculaciones)) continue;
    if (r.marca === "TOTAL MARCAS") continue;
    let entry = acc.get(r.fecha_mes);
    if (!entry) {
      entry = { total: 0, chinas: 0 };
      acc.set(r.fecha_mes, entry);
    }
    entry.total += r.matriculaciones;
    if (esMarcaChina(r.marca)) entry.chinas += r.matriculaciones;
  }
  return [...acc.entries()]
    .map(([fecha_mes, v]) => ({
      fecha_mes,
      total: v.total,
      chinas: v.chinas,
      cuota_pct: v.total > 0 ? (v.chinas / v.total) * 100 : 0,
    }))
    .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
}

/**
 * Cuota china mensual agregada para un mes concreto (YYYY-MM-01).
 * Helper conveniente para tests y para los KPIs.
 */
export function calcularCuotaChina(
  filas: FilaMarcaMes[],
  fecha_mes: string,
): number {
  let total = 0;
  let chinas = 0;
  for (const r of filas) {
    if (r.fecha_mes !== fecha_mes) continue;
    if (r.marca === "TOTAL MARCAS") continue;
    total += r.matriculaciones;
    if (esMarcaChina(r.marca)) chinas += r.matriculaciones;
  }
  return total > 0 ? (chinas / total) * 100 : 0;
}

export type DesgloseMarca = {
  marca: string;
  matric_anio: number;
  cuota_sobre_chinas: number; // % sobre total chinas del año
  cuota_sobre_total: number;  // % sobre total mercado del año
  esOtras: boolean;           // true si es la fila agrupada "Otras chinas"
};

/**
 * Construye el desglose por marca para un año dado.
 * Marcas con < umbralMin matriculaciones en ese año se agrupan en
 * "Otras chinas" (con nota al pie en la UI). Devuelve la lista ordenada
 * descendente por matriculaciones.
 */
export function buildDesgloseMarcas(
  filas: FilaMarcaMes[],
  anio: number,
  umbralMin: number = 10,
): DesgloseMarca[] {
  const yearStr = String(anio);
  let totalMercado = 0;
  let totalChinas = 0;
  // Agrupamos por marca NORMALIZADA para colapsar variantes ortograficas
  // del CSV (G.A.C./GAC, DONG FENG/DONGFENG). Para cada token normalizado
  // guardamos la variante con mas matriculaciones como "nombre canonico"
  // (la que se mostrara en la tabla).
  type Acc = { canonico: string; matric: number };
  const porMarcaNorm = new Map<string, Acc>();
  for (const r of filas) {
    if (!r.fecha_mes.startsWith(yearStr)) continue;
    if (r.marca === "TOTAL MARCAS") continue;
    if (!Number.isFinite(r.matriculaciones)) continue;
    totalMercado += r.matriculaciones;
    if (esMarcaChina(r.marca)) {
      totalChinas += r.matriculaciones;
      const norm = normalizarMarca(r.marca);
      const existing = porMarcaNorm.get(norm);
      if (!existing) {
        porMarcaNorm.set(norm, { canonico: r.marca, matric: r.matriculaciones });
      } else {
        const nuevo = existing.matric + r.matriculaciones;
        // Mantener la variante con mas matric como nombre canonico de la fila
        const canonico = r.matriculaciones > existing.matric ? r.marca : existing.canonico;
        porMarcaNorm.set(norm, { canonico, matric: nuevo });
      }
    }
  }
  const arr = [...porMarcaNorm.values()]
    .map((a) => [a.canonico, a.matric] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const grandes = arr.filter(([, n]) => n >= umbralMin);
  const pequenas = arr.filter(([, n]) => n < umbralMin);
  const filasOut: DesgloseMarca[] = grandes.map(([marca, n]) => ({
    marca,
    matric_anio: n,
    cuota_sobre_chinas: totalChinas > 0 ? (n / totalChinas) * 100 : 0,
    cuota_sobre_total: totalMercado > 0 ? (n / totalMercado) * 100 : 0,
    esOtras: false,
  }));
  if (pequenas.length > 0) {
    const sumOtras = pequenas.reduce((s, [, n]) => s + n, 0);
    filasOut.push({
      marca: `Otras chinas (${pequenas.length})`,
      matric_anio: sumOtras,
      cuota_sobre_chinas: totalChinas > 0 ? (sumOtras / totalChinas) * 100 : 0,
      cuota_sobre_total: totalMercado > 0 ? (sumOtras / totalMercado) * 100 : 0,
      esOtras: true,
    });
  }
  return filasOut;
}

/**
 * Detecta el primer mes con stockastically clear "aceleracion": un cambio
 * de pendiente > umbralPp puntos porcentuales sobre los siguientes
 * `ventana` meses comparado con los anteriores. Devuelve la fecha o null.
 *
 * Heuristica simple para evitar inventar anotaciones cuando no las hay.
 */
export function detectarAceleracion(
  serie: CuotaMensualPunto[],
  ventana: number = 3,
  umbralPp: number = 0.3,
): string | null {
  if (serie.length < ventana * 2 + 1) return null;
  for (let i = ventana; i < serie.length - ventana; i++) {
    const before = serie[i - ventana].cuota_pct;
    const at = serie[i].cuota_pct;
    const after = serie[i + ventana].cuota_pct;
    const slopeBefore = (at - before) / ventana;
    const slopeAfter = (after - at) / ventana;
    if (slopeAfter - slopeBefore > umbralPp) return serie[i].fecha_mes;
  }
  return null;
}
