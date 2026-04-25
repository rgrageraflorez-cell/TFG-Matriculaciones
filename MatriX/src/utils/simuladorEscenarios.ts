/**
 * simuladorEscenarios.ts
 * ────────────────────────────────────────────────────────────────
 * Simulador de escenarios macroeconómicos aplicados sobre la
 * predicción mensual Prophet (pred_prophet).
 *
 * Cada evento aporta un impacto base porcentual sobre la
 * predicción. Cuando se combinan varios eventos se aplica un
 * factor de amortiguación progresivo para evitar escenarios
 * irreales (1 evento = sin amortiguación; 5+ eventos = 60%).
 * ────────────────────────────────────────────────────────────────
 */

import type { PredictionRow } from "../types";

// ── Tipos públicos ─────────────────────────────────────────────
export type EventoId =
  | "moves"
  | "tipos_bce"
  | "recesion"
  | "boom"
  | "semiconductores"
  | "campana_sectorial";

export type EventoCatalogo = {
  id: EventoId;
  nombre: string;
  descripcion: string;
  /** Impacto base mensual en porcentaje (ya normalizado) aplicado sobre la predicción base. */
  impactoMensualPct: number;
  /** Texto corto para mostrar como badge (p.ej. "+8% mensual", "-12% anual"). */
  impactoLabel: string;
  /** Duración: número de meses desde el inicio del forecast; null = todos. */
  duracionMeses: number | null;
  /** Texto descriptivo de duración (badge secundario). */
  duracionLabel: string;
  /** "positivo" | "negativo" — para colorear badges y bordes. */
  signo: "positivo" | "negativo";
};

export type PrediccionEscenarioRow = PredictionRow & {
  pred_escenario: number | null;
};

export type ResumenEscenario = {
  numEventos: number;
  factorAmortiguacion: number;
  impactoNetoPct: number; // impacto medio aplicado (los de duración limitada ponderan menos)
  eventosActivos: EventoCatalogo[];
};

// ── Catálogo de eventos ────────────────────────────────────────
export const CATALOGO_EVENTOS: EventoCatalogo[] = [
  {
    id: "moves",
    nombre: "Plan MOVES activo",
    descripcion: "Incentivo público a la compra de vehículos electrificados.",
    impactoMensualPct: 8,
    impactoLabel: "+8% mensual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
  },
  {
    id: "tipos_bce",
    nombre: "Subida de tipos BCE (+100pb)",
    descripcion: "Contracción del crédito al consumo y financiación automovilística.",
    impactoMensualPct: -6,
    impactoLabel: "-6% mensual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "negativo",
  },
  {
    id: "recesion",
    nombre: "Recesión moderada (-2% PIB)",
    descripcion: "Calibrado sobre la contracción 2008-2009 de la serie histórica.",
    impactoMensualPct: -12 / 12, // -1% mensual equivalente
    impactoLabel: "-12% anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "negativo",
  },
  {
    id: "boom",
    nombre: "Boom post-crisis",
    descripcion: "Calibrado sobre la recuperación 2021-2022 de la serie histórica.",
    impactoMensualPct: 15 / 12, // +1.25% mensual equivalente
    impactoLabel: "+15% anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
  },
  {
    id: "semiconductores",
    nombre: "Escasez de semiconductores",
    descripcion: "Impacto transitorio sobre la disponibilidad de vehículos.",
    impactoMensualPct: -10,
    impactoLabel: "-10% mensual",
    duracionMeses: 3,
    duracionLabel: "Primeros 3 meses",
    signo: "negativo",
  },
  {
    id: "campana_sectorial",
    nombre: "Campaña promocional sectorial",
    descripcion: "Efecto de campañas coordinadas de fabricantes y concesionarios.",
    impactoMensualPct: 5,
    impactoLabel: "+5% mensual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
  },
];

// ── Amortiguación ──────────────────────────────────────────────
export function factorAmortiguacion(numEventos: number): number {
  if (numEventos <= 1) return 1.0;
  return Math.max(0.6, 1 - (numEventos - 1) * 0.1);
}

// ── Detección de forecast ──────────────────────────────────────
function esForecast(r: PredictionRow): boolean {
  if (r.tipo_periodo && r.tipo_periodo.toLowerCase() !== "historico" &&
      r.tipo_periodo.toLowerCase() !== "histórico") return true;
  // Fallback: forecast si real es null pero hay predicción
  return r.real === null && (r.pred_prophet !== null || r.prediccion !== null);
}

// ── Cálculo principal ──────────────────────────────────────────
export function calcularEscenario(
  predicciones: PredictionRow[],
  eventosActivos: EventoCatalogo[],
): PrediccionEscenarioRow[] {
  const N = eventosActivos.length;
  const factor = factorAmortiguacion(N);

  // Indexamos forecast para saber qué mes ocupa cada fila dentro del horizonte
  const sorted = [...predicciones].sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
  let forecastIdx = 0;
  const forecastIdxByFecha = new Map<string, number>();
  for (const r of sorted) {
    if (esForecast(r)) {
      forecastIdxByFecha.set(r.fecha_mes, forecastIdx);
      forecastIdx++;
    }
  }

  return sorted.map<PrediccionEscenarioRow>((r) => {
    if (!esForecast(r) || r.pred_prophet === null || N === 0) {
      return { ...r, pred_escenario: null };
    }
    const idx = forecastIdxByFecha.get(r.fecha_mes) ?? 0;
    let impactoTotal = 0;
    for (const ev of eventosActivos) {
      const activoEsteMes =
        ev.duracionMeses === null ? true : idx < ev.duracionMeses;
      if (!activoEsteMes) continue;
      impactoTotal += ev.impactoMensualPct * factor;
    }
    const ajustada = r.pred_prophet * (1 + impactoTotal / 100);
    return { ...r, pred_escenario: ajustada };
  });
}

// ── Resumen para el panel ──────────────────────────────────────
export function resumenEscenario(
  predicciones: PredictionRow[],
  eventosActivos: EventoCatalogo[],
): ResumenEscenario {
  const N = eventosActivos.length;
  const factor = factorAmortiguacion(N);

  // Impacto medio: para cada mes de forecast sumamos los impactos activos y promediamos
  const forecastRows = predicciones.filter(esForecast);
  const nMeses = Math.max(forecastRows.length, 1);
  let sumaImpactos = 0;
  if (N > 0) {
    for (let i = 0; i < forecastRows.length; i++) {
      for (const ev of eventosActivos) {
        const activo = ev.duracionMeses === null ? true : i < ev.duracionMeses;
        if (activo) sumaImpactos += ev.impactoMensualPct * factor;
      }
    }
  }
  const impactoNetoPct = N === 0 ? 0 : sumaImpactos / nMeses;

  return {
    numEventos: N,
    factorAmortiguacion: factor,
    impactoNetoPct,
    eventosActivos,
  };
}

// ── KPIs para el gráfico ───────────────────────────────────────
export type KpiEscenario = {
  impactoAcumulado: number;       // Σ(escenario - base) en unidades
  variacionMediaPct: number;      // media mensual (escenario vs base) en %
  mesMayorDivergencia: string;    // "YYYY-MM" o ""
  magnitudMayorDivergencia: number;
};

export function kpisEscenario(filas: PrediccionEscenarioRow[]): KpiEscenario {
  let acumulado = 0;
  let sumaPct = 0;
  let cnt = 0;
  let mesMayor = "";
  let magMayor = 0;
  for (const r of filas) {
    if (!esForecast(r) || r.pred_prophet === null || r.pred_escenario === null) continue;
    const diff = r.pred_escenario - r.pred_prophet;
    acumulado += diff;
    if (r.pred_prophet !== 0) {
      sumaPct += (diff / r.pred_prophet) * 100;
      cnt++;
    }
    if (Math.abs(diff) > Math.abs(magMayor)) {
      magMayor = diff;
      mesMayor = r.fecha_mes;
    }
  }
  return {
    impactoAcumulado: acumulado,
    variacionMediaPct: cnt > 0 ? sumaPct / cnt : 0,
    mesMayorDivergencia: mesMayor,
    magnitudMayorDivergencia: magMayor,
  };
}

// ── Estado global compartido con el generador de PDF ───────────
// Un pequeño store para que el generador de informes (invocado desde
// otra pestaña) pueda consultar el escenario activo sin añadir un
// parámetro a toda la cadena de llamadas.
type EscenarioSnapshot = {
  eventosActivos: EventoCatalogo[];
  predicciones: PredictionRow[];
};

let SNAPSHOT: EscenarioSnapshot | null = null;

export function setEscenarioActivo(s: EscenarioSnapshot | null): void {
  if (!s || s.eventosActivos.length === 0 || s.predicciones.length === 0) {
    SNAPSHOT = null;
    return;
  }
  SNAPSHOT = s;
}

export function getEscenarioActivo(): EscenarioSnapshot | null {
  return SNAPSHOT;
}
