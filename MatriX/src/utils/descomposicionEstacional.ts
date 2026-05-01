// Descomposición de variación YoY en componente estacional + residual estructural.
//
// El componente_estacional refleja cuánto suele variar este mes históricamente
// respecto a la media anual. Es la "señal esperable" del calendario.
//
// El residual_estructural es la diferencia entre lo observado y lo esperado:
// es el indicador de cambio real en el mercado, descontando el patrón calendario.
//
// Los umbrales de interpretación (±1) y magnitud (3, 8) son heurísticos y
// están calibrados sobre la dispersión observada en la serie histórica de
// matriculaciones nacionales 2021-2026. Para series más volátiles (provincias
// pequeñas, marcas minoritarias) los umbrales pueden infrainterpretar la
// magnitud. Revisión recomendada si se aplica a contextos distintos.

export type Interpretacion =
  | "mejor_de_lo_esperado"
  | "esperado"
  | "peor_de_lo_esperado";

export type MagnitudResidual = "pequeña" | "moderada" | "fuerte";

// Umbrales heuristicos. Documentados en el comentario superior.
export const UMBRAL_INTERPRETACION = 1;       // |residual| <= 1 => "esperado"
export const UMBRAL_MAGNITUD_MODERADA = 3;    // 3 <= |residual| < 8 => "moderada"
export const UMBRAL_MAGNITUD_FUERTE = 8;      // |residual| >= 8 => "fuerte"

export interface DescomposicionInput {
  /** Mes 1..12. */
  mes: number;
  /** Variación interanual total observada, en puntos porcentuales (-8 = -8%). */
  variacion_yoy: number;
  /**
   * Perfil estacional mensual: 12 valores, cada uno la desviación porcentual
   * típica del mes respecto a la media anual (mes_i / media_anual − 1) × 100.
   * Si se omite, devuelve componente_estacional = 0 (la descomposición es
   * idéntica a la YoY total, sin valor añadido).
   */
  perfil_estacional?: number[];
}

export interface DescomposicionOutput {
  yoy_total: number;
  componente_estacional: number;
  residual_estructural: number;
  interpretacion: Interpretacion;
  magnitud_residual: MagnitudResidual;
}

/**
 * Descompone una variación YoY en componente esperable por calendario y
 * residual estructural. Función pura, sin efectos.
 */
export function descomponerVariacion(
  input: DescomposicionInput,
): DescomposicionOutput {
  const { mes, variacion_yoy, perfil_estacional } = input;
  let componente_estacional = 0;
  if (
    perfil_estacional &&
    perfil_estacional.length === 12 &&
    mes >= 1 &&
    mes <= 12 &&
    Number.isFinite(perfil_estacional[mes - 1])
  ) {
    componente_estacional = perfil_estacional[mes - 1];
  }
  const residual_estructural = variacion_yoy - componente_estacional;

  const abs = Math.abs(residual_estructural);
  let interpretacion: Interpretacion;
  if (abs <= UMBRAL_INTERPRETACION) interpretacion = "esperado";
  else if (residual_estructural > 0) interpretacion = "mejor_de_lo_esperado";
  else interpretacion = "peor_de_lo_esperado";

  let magnitud_residual: MagnitudResidual;
  if (abs < UMBRAL_MAGNITUD_MODERADA) magnitud_residual = "pequeña";
  else if (abs < UMBRAL_MAGNITUD_FUERTE) magnitud_residual = "moderada";
  else magnitud_residual = "fuerte";

  return {
    yoy_total: variacion_yoy,
    componente_estacional,
    residual_estructural,
    interpretacion,
    magnitud_residual,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Cálculo del perfil estacional empírico (Plan B del brief)
// ────────────────────────────────────────────────────────────────────────────

// Perfil estacional empírico calculado en frontend por ausencia de
// descomposición Prophet exportada. Mediana de ratios mensuales sobre
// media anual, calculada sobre N años. Versión simplificada respecto a la
// descomposición aditiva de Prophet, pero suficiente para descomposición
// orientativa de variaciones YoY.
//
// Cuando la pipeline R exponga `fc$yearly` en un JSON, basta con sustituir
// `getPerfilEstacionalEmpirico()` por un fetch al JSON sin tocar el resto.

export interface PuntoSerie {
  /** YYYY-MM-DD o YYYY-MM. Se usan los 4 primeros chars como año y los chars 6-7 como mes. */
  fecha_mes: string;
  /** Valor observado del mes (matriculaciones). */
  valor: number;
}

export interface PerfilEstacionalCalculo {
  /** 12 desviaciones porcentuales por mes. NaN si un mes no tiene datos. */
  valores: number[];
  /** Años completos usados para el cálculo. */
  anios_usados: number[];
  /** Cuántos años aportaron datos completos por cada mes. */
  n_observaciones_por_mes: number[];
}

/**
 * Calcula el perfil estacional empírico a partir de una serie mensual.
 *
 * Algoritmo:
 *   1. Agrupa por año y exige 12 meses cerrados para cada año (años incompletos
 *      se descartan para no sesgar el promedio anual).
 *   2. Para cada año completo, calcula la media anual y los 12 ratios
 *      mes_i / media_anual.
 *   3. El perfil mensual es la mediana de los ratios entre años, expresada
 *      como desviación porcentual: (mediana - 1) × 100.
 *
 * La mediana es robusta a outliers anuales (p. ej. 2021 post-COVID).
 */
export function getPerfilEstacionalEmpirico(
  serie: PuntoSerie[],
): PerfilEstacionalCalculo {
  // Agrupar por año
  const porAnio = new Map<number, Map<number, number>>(); // anio -> mes -> valor
  for (const p of serie) {
    if (!p.fecha_mes || !Number.isFinite(p.valor)) continue;
    const anio = parseInt(p.fecha_mes.slice(0, 4), 10);
    const mes = parseInt(p.fecha_mes.slice(5, 7), 10);
    if (!Number.isFinite(anio) || mes < 1 || mes > 12) continue;
    let m = porAnio.get(anio);
    if (!m) {
      m = new Map();
      porAnio.set(anio, m);
    }
    m.set(mes, p.valor);
  }
  const anios_completos = [...porAnio.entries()]
    .filter(([, meses]) => meses.size === 12)
    .map(([a]) => a)
    .sort((a, b) => a - b);

  if (anios_completos.length === 0) {
    return {
      valores: new Array(12).fill(NaN),
      anios_usados: [],
      n_observaciones_por_mes: new Array(12).fill(0),
    };
  }

  // Para cada año completo, calcula ratio mensual (mes / media_anual)
  const ratiosPorMes: number[][] = Array.from({ length: 12 }, () => []);
  for (const anio of anios_completos) {
    const meses = porAnio.get(anio)!;
    const valores = [];
    for (let m = 1; m <= 12; m++) valores.push(meses.get(m)!);
    const mediaAnual = valores.reduce((s, v) => s + v, 0) / 12;
    if (mediaAnual <= 0) continue;
    for (let m = 1; m <= 12; m++) {
      ratiosPorMes[m - 1].push(valores[m - 1] / mediaAnual);
    }
  }

  const mediana = (arr: number[]): number => {
    if (arr.length === 0) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const valores = ratiosPorMes.map((arr) => {
    if (arr.length === 0) return NaN;
    return (mediana(arr) - 1) * 100;
  });

  return {
    valores,
    anios_usados: anios_completos,
    n_observaciones_por_mes: ratiosPorMes.map((arr) => arr.length),
  };
}
