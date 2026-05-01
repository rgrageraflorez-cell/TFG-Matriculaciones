// Doble filtro de fiabilidad para consultas marca×provincia.
//
// Filtro ABSOLUTO (n >= 10): mínimo defensivo contra extrapolaciones desde
// muestras catastróficas (n=1, n=2, n=3). No tiene base estadística estricta,
// es heurístico de seguridad.
//
// Filtro RELATIVO (n_provincia >= 1‰ del n_nacional_marca): evita penalizar
// artificialmente a marcas pequeñas. Para Ferrari (~600 unidades anuales
// nacionales), una provincia con 1 unidad pasa el filtro relativo (0.17%),
// pero queda bloqueada por el absoluto. Para Toyota (~85.000 unidades),
// una provincia con 50 unidades pasa absoluto pero NO relativo (0.06% < 0.1%),
// lo cual indica que la marca tiene cuota desproporcionadamente baja en esa
// provincia y el dato debe leerse con cautela.
//
// Los umbrales son heurísticos. Revisión recomendada tras 12 meses de uso.

export const UMBRAL_ABSOLUTO = 10;
export const UMBRAL_RELATIVO = 0.001; // 1‰ del nacional de la marca

/** Color de relleno para provincias con fiabilidad insuficiente en mapas. */
export const COLOR_NO_FIABLE = "#9CA3AF"; // slate-400, gris neutro (no rojo)

export type MotivoNoFiable =
  | "n_absoluto_bajo"
  | "n_relativo_bajo"
  | "sin_datos";

export interface FiabilidadInput {
  /** Matriculaciones de la marca en la provincia (período evaluado). */
  n_provincia: number;
  /** Matriculaciones nacionales totales de la marca (mismo período). */
  n_nacional_marca: number;
}

export interface FiabilidadOutput {
  fiable: boolean;
  motivo?: MotivoNoFiable;
  detalle: {
    n_provincia: number;
    n_nacional_marca: number;
    /** Cuota relativa: n_provincia / n_nacional_marca. NaN si no se puede calcular. */
    ratio_relativo: number;
    umbral_absoluto_aplicado: number;
    umbral_relativo_aplicado: number;
  };
}

/**
 * Evalúa si una consulta marca×provincia tiene muestra suficiente para
 * generar una métrica defendible. Función pura, sin efectos.
 *
 * Reglas:
 *   - n_provincia === 0  -> no fiable, motivo "sin_datos".
 *   - n_provincia <  10  -> no fiable, motivo "n_absoluto_bajo".
 *   - ratio < 1‰         -> no fiable, motivo "n_relativo_bajo".
 *   - en otro caso       -> fiable.
 */
export function evaluarFiabilidad(input: FiabilidadInput): FiabilidadOutput {
  const n = input.n_provincia;
  const N = input.n_nacional_marca;
  const ratio = N > 0 ? n / N : NaN;

  const detalle = {
    n_provincia: n,
    n_nacional_marca: N,
    ratio_relativo: ratio,
    umbral_absoluto_aplicado: UMBRAL_ABSOLUTO,
    umbral_relativo_aplicado: UMBRAL_RELATIVO,
  };

  if (n === 0) {
    return { fiable: false, motivo: "sin_datos", detalle };
  }
  if (n < UMBRAL_ABSOLUTO) {
    return { fiable: false, motivo: "n_absoluto_bajo", detalle };
  }
  if (!Number.isFinite(ratio) || ratio < UMBRAL_RELATIVO) {
    return { fiable: false, motivo: "n_relativo_bajo", detalle };
  }
  return { fiable: true, detalle };
}
