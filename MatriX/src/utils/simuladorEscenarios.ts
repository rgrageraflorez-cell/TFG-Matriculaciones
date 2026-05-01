/**
 * simuladorEscenarios.ts
 * ────────────────────────────────────────────────────────────────
 * Simulador de escenarios macroeconómicos aplicados sobre la
 * predicción mensual Prophet (pred_prophet).
 *
 * Cada evento aporta un vector mensual de impacto en %. Los vectores
 * provienen de la calibración hecha en R (`calibrar_escenarios.R`)
 * y se sirven como `/escenarios_vectores.json`. Si la fetch falla,
 * el catálogo arranca con vectores constantes equivalentes a los
 * impactos medios anuales originales.
 *
 * Cuando se combinan varios eventos se aplica un factor de
 * amortiguación progresivo para evitar escenarios irreales
 * (1 evento = sin amortiguación; 5+ eventos = 60%).
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
  | "campana_sectorial"
  | "personalizado";

/** Forma del vector aplicado por el escenario personalizado del simulador. */
export type TipoImpacto = "gradual" | "sostenido" | "brusco";

export type EventoCatalogo = {
  id: EventoId;
  nombre: string;
  descripcion: string;
  /**
   * Vector de impacto mensual en porcentaje aplicado sobre la
   * predicción base.
   *  - Para eventos con `aplicacionPosicional = false` (mayoría):
   *    12 valores indexados por calendar month (idx 0 = enero, 11 = diciembre).
   *  - Para `aplicacionPosicional = true` (semiconductores):
   *    valores aplicados a los primeros N meses del forecast en orden.
   */
  impactoMensualPct: number[];
  /** Texto corto para mostrar como badge (p.ej. "+8% medio anual"). */
  impactoLabel: string;
  /** Duración: número de meses desde el inicio del forecast; null = todos. */
  duracionMeses: number | null;
  /** Texto descriptivo de duración (badge secundario). */
  duracionLabel: string;
  /** "positivo" | "negativo" — para colorear badges y bordes. */
  signo: "positivo" | "negativo";
  /**
   * Si true, los valores del vector se aplican posicionalmente
   * (índice 0 = primer mes del forecast). Solo para semiconductores.
   * Si false, se indexan por calendar month del forecast.
   */
  aplicacionPosicional: boolean;
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

// ── Catálogo por defecto ───────────────────────────────────────
// Vectores constantes equivalentes al impacto medio anual original.
// Se sustituyen al vuelo cuando se carga `escenarios_vectores.json`.
const v12 = (x: number): number[] => Array(12).fill(x);

export const CATALOGO_EVENTOS_DEFAULT: EventoCatalogo[] = [
  {
    id: "moves",
    nombre: "Plan MOVES activo",
    descripcion: "Incentivo público a la compra de vehículos electrificados.",
    impactoMensualPct: v12(8),
    impactoLabel: "+8% medio anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
    aplicacionPosicional: false,
  },
  {
    id: "tipos_bce",
    nombre: "Subida de tipos BCE (+100pb)",
    descripcion: "Contracción del crédito al consumo y financiación automovilística.",
    impactoMensualPct: v12(-6),
    impactoLabel: "−6% medio anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "negativo",
    aplicacionPosicional: false,
  },
  {
    id: "recesion",
    nombre: "Recesión moderada (-2% PIB)",
    descripcion: "Calibrado sobre la contracción 2020 de la serie histórica.",
    impactoMensualPct: v12(-12),
    impactoLabel: "−12% medio anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "negativo",
    aplicacionPosicional: false,
  },
  {
    id: "boom",
    nombre: "Boom post-crisis",
    descripcion: "Magnitud media de los rebotes tras crisis identificadas en 1990-2024 (1993, 2012, 2020); forma 2021-2022 atenuada al 50%.",
    impactoMensualPct: v12(9),
    impactoLabel: "+9% medio anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
    aplicacionPosicional: false,
  },
  {
    id: "semiconductores",
    nombre: "Escasez de semiconductores",
    descripcion: "Impacto transitorio sobre la disponibilidad de vehículos.",
    impactoMensualPct: [-7, -10, -13],
    impactoLabel: "media −10% (3 meses)",
    duracionMeses: 3,
    duracionLabel: "Primeros 3 meses",
    signo: "negativo",
    aplicacionPosicional: true,
  },
  {
    id: "campana_sectorial",
    nombre: "Campaña promocional sectorial",
    descripcion: "Efecto de campañas coordinadas de fabricantes y concesionarios.",
    impactoMensualPct: v12(5),
    impactoLabel: "+5% medio anual",
    duracionMeses: null,
    duracionLabel: "Todo el forecast",
    signo: "positivo",
    aplicacionPosicional: false,
  },
];

/** Catálogo "vivo" — se actualiza tras cargar el JSON calibrado. */
export const CATALOGO_EVENTOS: EventoCatalogo[] = CATALOGO_EVENTOS_DEFAULT.map((e) => ({
  ...e,
  impactoMensualPct: [...e.impactoMensualPct],
}));

// ── Carga del JSON calibrado ───────────────────────────────────
// Map id de UI → clave en el JSON.
const ID_A_JSON_KEY: Record<EventoId, string> = {
  moves: "plan_moves",
  tipos_bce: "subida_tipos",
  recesion: "recesion_moderada",
  boom: "boom_postcrisis",
  semiconductores: "semiconductores",
  campana_sectorial: "campana_promocional",
};

type EscenariosJson = {
  metadata?: { generado?: string; metodologia?: string; fuentes?: string[] };
  eventos: Record<
    string,
    {
      impacto_mensual: number[];
      impacto_medio_anual?: number;
      tipo?: string;
      periodo_referencia?: string;
      fuente?: string;
      duracion_meses?: number;
    }
  >;
};

let cachePromise: Promise<EventoCatalogo[]> | null = null;

export function cargarEscenariosCalibrados(): Promise<EventoCatalogo[]> {
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const res = await fetch("/escenarios_vectores.json", { cache: "no-cache" });
      if (!res.ok) return CATALOGO_EVENTOS_DEFAULT;
      const data: EscenariosJson = await res.json();
      const merged = CATALOGO_EVENTOS_DEFAULT.map((e) => {
        const key = ID_A_JSON_KEY[e.id];
        const cal = data.eventos?.[key];
        if (!cal || !Array.isArray(cal.impacto_mensual) || cal.impacto_mensual.length === 0) {
          return e;
        }
        const vec = cal.impacto_mensual.map(Number);
        const media = vec.reduce((s, v) => s + v, 0) / vec.length;
        const target = cal.impacto_medio_anual ?? media;
        const labelNum = Number(target.toFixed(1));
        const sign = labelNum >= 0 ? "+" : "−";
        const absStr = Math.abs(labelNum).toFixed(labelNum % 1 === 0 ? 0 : 1);
        const label =
          e.aplicacionPosicional
            ? `media ${sign}${absStr}% (${vec.length} meses)`
            : `${sign}${absStr}% medio anual`;
        return {
          ...e,
          impactoMensualPct: vec,
          impactoLabel: label,
        };
      });
      // Mutamos también la export viva por si algún consumidor la lee tarde.
      for (let i = 0; i < merged.length; i++) {
        CATALOGO_EVENTOS[i] = merged[i];
      }
      return merged;
    } catch {
      return CATALOGO_EVENTOS_DEFAULT;
    }
  })();
  return cachePromise;
}

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

// Lee el % aplicable de un evento dado un mes de forecast (índice
// posicional dentro del horizonte y calendar month del row).
function impactoEventoMes(
  ev: EventoCatalogo,
  forecastIdx: number,
  calendarMonth: number /* 1..12 */,
): number {
  const vec = ev.impactoMensualPct;
  if (!vec || vec.length === 0) return 0;
  if (ev.aplicacionPosicional) {
    if (forecastIdx >= vec.length) return 0;
    return vec[forecastIdx];
  }
  // duracionMeses limita el horizonte (semánticamente solo lo usaba
  // semiconductores, pero lo respetamos para futuros eventos).
  if (ev.duracionMeses !== null && forecastIdx >= ev.duracionMeses) return 0;
  const idx = Math.max(1, Math.min(12, calendarMonth)) - 1;
  return vec[idx] ?? 0;
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
    const cm = parseInt(r.fecha_mes.slice(5, 7), 10) || 1;
    let impactoTotal = 0;
    for (const ev of eventosActivos) {
      impactoTotal += impactoEventoMes(ev, idx, cm) * factor;
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

  const forecastRows = predicciones
    .filter(esForecast)
    .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
  const nMeses = Math.max(forecastRows.length, 1);

  let sumaImpactos = 0;
  if (N > 0) {
    for (let i = 0; i < forecastRows.length; i++) {
      const cm = parseInt(forecastRows[i].fecha_mes.slice(5, 7), 10) || 1;
      for (const ev of eventosActivos) {
        sumaImpactos += impactoEventoMes(ev, i, cm) * factor;
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

// ── Escenario personalizado: construccion del vector ───────────────────────
// La suma de los valores dentro del rango activo siempre iguala `magnitud`,
// segun lo definido por el usuario. Posiciones fuera del rango son 0. El
// vector resultante se aplica luego con la misma logica multiplicativa que
// los eventos existentes (calcularEscenario), indexado por calendar month.

/**
 * Construye el vector mensual (12 posiciones, idx 0=enero ... 11=diciembre)
 * para un escenario personalizado.
 *
 * @param magnitud Impacto total acumulado del escenario en %; ej. 12 para
 *   +12% repartidos en el rango. Suma del vector en el rango = magnitud.
 * @param duracion Numero de meses de duracion del impacto (1..12). Si
 *   `mesInicio + duracion` excede el horizonte de 12, el caller debe haber
 *   recortado antes (validacion 4.4 del brief).
 * @param mesInicio Calendar month de inicio (1..12).
 * @param tipoImpacto "sostenido" (constante), "gradual" (rampa creciente),
 *   "brusco" (rampa decreciente).
 * @returns Array de 12 numeros con la distribucion mensual.
 */
export function buildCustomVector(
  magnitud: number,
  duracion: number,
  mesInicio: number,
  tipoImpacto: TipoImpacto,
): number[] {
  const out = new Array(12).fill(0);
  if (duracion <= 0 || !Number.isFinite(magnitud)) return out;
  const inicioIdx = Math.max(1, Math.min(12, mesInicio)) - 1;
  const fin = Math.min(12, inicioIdx + duracion);
  const len = fin - inicioIdx;
  if (len <= 0) return out;

  if (tipoImpacto === "sostenido" || len === 1) {
    // Constante: cada mes recibe magnitud / len.
    const v = magnitud / len;
    for (let i = inicioIdx; i < fin; i++) out[i] = v;
    return out;
  }

  // Pesos en rampa lineal sobre [1, 2, ..., len]. Suma = len*(len+1)/2.
  // Para "gradual" usamos pesos crecientes; para "brusco" decrecientes.
  const sumaPesos = (len * (len + 1)) / 2;
  for (let k = 0; k < len; k++) {
    const peso = tipoImpacto === "gradual" ? k + 1 : len - k;
    out[inicioIdx + k] = (magnitud * peso) / sumaPesos;
  }
  return out;
}
