/* ============================================================================
 * scoreTerritorial.ts
 * ----------------------------------------------------------------------------
 * Score Territorial de Oportunidad: indice sintetico (0-100) por provincia que
 * combina demanda per capita, tamano de mercado, tendencia interanual y una
 * penalizacion por anomalias territoriales (IVTM).
 *
 * Flujo:
 *   A. Agregacion provincial a partir de df_mapa_densidad.csv (snapshot del
 *      ultimo mes disponible) para ratio medio y matriculaciones brutas.
 *      Tendencia a partir de df_mensual_marca_lugar.csv (anio mas reciente vs
 *      dos anios antes) cargado en streaming.
 *   B. Normalizacion min-max de las tres dimensiones a [0, 100].
 *   C. Score ponderado: demanda 0.40 + mercado 0.30 + tendencia 0.25.
 *   D. Penalizacion IVTM: -5 por anomalia confirmada, -2 por cada potencial
 *      (ratio > 3 * mediana provincial), capado a -6 en potenciales.
 * ============================================================================
 */

import type { MapDensityRow } from "../types";

export type ScoreRow = {
  provincia: string;
  score_final: number;
  score_demanda: number;
  score_mercado: number;
  score_tendencia: number;
  penalizacion_ivtm: number;
  ranking: number;
  matriculaciones_brutas: number;
  ratio_medio: number;
  crecimiento: number; // % interanual (anio N vs anio N-2)
  anomalias_confirmadas: string[];
  anomalias_potenciales: string[];
  dimension_dominante: "Demanda" | "Mercado" | "Tendencia";
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

const ANOMALIAS_CONFIRMADAS: { nombre: string; provincia: string | null }[] = [
  { nombre: "AGUILAR DE SEGARRA", provincia: null },
  { nombre: "RAJADELL", provincia: null },
  { nombre: "TORRENT", provincia: "GIRONA" },
];

function parseNumLoose(v: any): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NA" || s.toUpperCase() === "NULL") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function mediana(vals: number[]): number {
  if (!vals.length) return 0;
  const arr = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

// ──────────────────────────────────────────────────────────────────────────
// Carga provincias.geojson → Map<provCode, provName>
// ──────────────────────────────────────────────────────────────────────────
export async function cargarProvinciasLookup(): Promise<Map<string, string>> {
  const res = await fetch("/provincias.geojson?v=4");
  if (!res.ok) throw new Error("No se pudo cargar provincias.geojson");
  const geo = await res.json();
  const m = new Map<string, string>();
  for (const f of geo.features ?? []) {
    const cod = String(f.properties?.prov ?? "").padStart(2, "0");
    const name = String(f.properties?.name ?? "");
    if (cod && name) m.set(cod, name);
  }
  return m;
}

// ──────────────────────────────────────────────────────────────────────────
// Streaming de df_mensual_marca_lugar.csv para crecimiento interanual.
// Devuelve Map<provCode, Map<anio, totalMatriculaciones>>.
// ──────────────────────────────────────────────────────────────────────────
export async function cargarTendenciaProvincial(
  provLookup: Map<string, string>,
  onProgress?: (msg: string) => void
): Promise<Map<string, Map<number, number>>> {
  onProgress?.("Cargando series temporales provinciales...");
  // En desarrollo se usa el archivo local servido por Vite; en producción
  // se inyecta una URL externa (Google Drive) vía VITE_CSV_MARCA_LUGAR_URL.
  const CSV_URL =
    (import.meta.env.VITE_CSV_MARCA_LUGAR_URL as string | undefined) ||
    "/df_mensual_marca_lugar.csv";
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) throw new Error("No se pudo cargar df_mensual_marca_lugar.csv");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let headers: string[] | null = null;
  let idxCod = -1;
  let idxFecha = -1;
  let idxAno = -1;
  let idxMat = -1;
  let idxMarca = -1;

  const byProv = new Map<string, Map<number, number>>();

  const splitCSVLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
      } else if (c === "," && !inQ) {
        out.push(cur); cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  };

  const processLine = (line: string) => {
    if (!line) return;
    if (!headers) {
      headers = splitCSVLine(line).map((h) => h.trim().replace(/^"|"$/g, ""));
      idxCod = headers.findIndex((h) => h.toLowerCase() === "cod_ine");
      idxFecha = headers.findIndex((h) => h.toLowerCase().startsWith("fecha"));
      idxAno = headers.findIndex((h) => h.toLowerCase() === "año" || h.toLowerCase() === "ano");
      idxMat = headers.findIndex((h) => h.toLowerCase() === "matriculaciones");
      idxMarca = headers.findIndex((h) => h.toLowerCase() === "marca");
      return;
    }
    const cols = splitCSVLine(line);
    const marca = idxMarca >= 0 ? (cols[idxMarca] ?? "").trim() : "";
    if (marca && marca.toUpperCase() === "TOTAL MARCAS") return; // evitar doble conteo

    const cod = String(cols[idxCod] ?? "").padStart(5, "0");
    if (cod.length !== 5) return;
    const provCode = cod.substring(0, 2);
    if (!provLookup.has(provCode)) return;

    let ano: number | null = null;
    if (idxAno >= 0) ano = parseNumLoose(cols[idxAno]);
    if (!ano && idxFecha >= 0) {
      const fecha = String(cols[idxFecha] ?? "").slice(0, 10);
      if (/^\d{4}/.test(fecha)) ano = parseInt(fecha.slice(0, 4));
    }
    if (!ano) return;

    const mat = parseNumLoose(cols[idxMat]) ?? 0;
    if (!mat) return;

    let m = byProv.get(provCode);
    if (!m) { m = new Map(); byProv.set(provCode, m); }
    m.set(ano, (m.get(ano) ?? 0) + mat);
  };

  let chunks = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const raw = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      processLine(raw);
    }
    chunks++;
    if (chunks % 20 === 0) onProgress?.(`Procesando series temporales... (${chunks * 64} KB)`);
  }
  if (buf.length) processLine(buf);
  return byProv;
}

// ──────────────────────────────────────────────────────────────────────────
// PASO PRINCIPAL
// ──────────────────────────────────────────────────────────────────────────
export async function calcularScoreTerritorial(
  mapRows: MapDensityRow[],
  provLookup: Map<string, string>,
  tendenciaProv: Map<string, Map<number, number>> | null,
  onProgress?: (msg: string) => void
): Promise<ScoreRow[]> {
  onProgress?.("Agregando datos provinciales...");

  // ── Snapshot del ultimo fecha disponible ──
  const fechas = Array.from(new Set(mapRows.map((d) => d.fecha)))
    .filter((f) => DATE_RE.test(f))
    .sort();
  const latestFecha = fechas[fechas.length - 1] ?? "";
  const snapshot = mapRows.filter((d) => d.fecha === latestFecha);

  // ── Agregacion provincial ──
  type ProvAgg = {
    provincia: string;
    provCode: string;
    ratios: number[];
    matTotal: number;
    muniMax: { nombre: string; ratio: number }[];
  };
  const agg = new Map<string, ProvAgg>();
  for (const r of snapshot) {
    const cod = String(r.cod_ine ?? "").padStart(5, "0");
    if (cod.length !== 5) continue;
    const provCode = cod.substring(0, 2);
    const provincia = provLookup.get(provCode);
    if (!provincia) continue;
    let e = agg.get(provCode);
    if (!e) {
      e = { provincia, provCode, ratios: [], matTotal: 0, muniMax: [] };
      agg.set(provCode, e);
    }
    if (r.ratio_x1000 > 0) e.ratios.push(r.ratio_x1000);
    e.matTotal += r.matriculaciones;
    e.muniMax.push({ nombre: r.municipio, ratio: r.ratio_x1000 });
  }

  // ── Construir datos base por provincia ──
  type Base = {
    provincia: string;
    provCode: string;
    ratio_medio: number;
    mat_brutas: number;
    crecimiento: number;
    anom_conf: string[];
    anom_pot: string[];
  };
  const base: Base[] = [];

  for (const [provCode, e] of agg) {
    const ratioMedio = e.ratios.length
      ? e.ratios.reduce((s, r) => s + r, 0) / e.ratios.length
      : 0;

    // Tendencia interanual
    let crecimiento = 0;
    if (tendenciaProv) {
      const seriePorAnio = tendenciaProv.get(provCode);
      if (seriePorAnio && seriePorAnio.size > 0) {
        const anios = Array.from(seriePorAnio.keys()).sort((a, b) => a - b);
        const anioN = anios[anios.length - 1];
        const anioPrev = anioN - 2;
        if (seriePorAnio.has(anioPrev)) {
          const vN = seriePorAnio.get(anioN) ?? 0;
          const vP = seriePorAnio.get(anioPrev) ?? 0;
          if (vP > 0) crecimiento = ((vN - vP) / vP) * 100;
        }
      }
    }

    // Anomalias confirmadas (hardcoded)
    const anomConf: string[] = [];
    const munisNombres = new Set(e.muniMax.map((m) => norm(m.nombre)));
    for (const a of ANOMALIAS_CONFIRMADAS) {
      const matchMuni = munisNombres.has(a.nombre);
      const matchProv = !a.provincia || norm(e.provincia) === a.provincia;
      if (matchMuni && matchProv) anomConf.push(a.nombre);
    }

    // Anomalias potenciales: ratio > 3 * mediana provincial
    const med = mediana(e.ratios);
    const anomPot: string[] = [];
    if (med > 0) {
      for (const m of e.muniMax) {
        if (m.ratio > 3 * med && !anomConf.includes(norm(m.nombre))) {
          anomPot.push(m.nombre);
        }
      }
    }

    base.push({
      provincia: e.provincia,
      provCode,
      ratio_medio: ratioMedio,
      mat_brutas: e.matTotal,
      crecimiento,
      anom_conf: anomConf,
      anom_pot: anomPot,
    });
  }

  onProgress?.("Normalizando dimensiones...");

  // ── Normalizacion min-max a [0, 100] ──
  const ratios = base.map((b) => b.ratio_medio);
  const mats = base.map((b) => b.mat_brutas);
  const crecs = base.map((b) => b.crecimiento);
  const rMin = Math.min(...ratios), rMax = Math.max(...ratios);
  const mMin = Math.min(...mats), mMax = Math.max(...mats);
  const cMin = Math.min(...crecs), cMax = Math.max(...crecs);

  const normalize = (v: number, min: number, max: number) =>
    max > min ? ((v - min) / (max - min)) * 100 : 50;

  onProgress?.("Calculando score final...");

  const filas: ScoreRow[] = base.map((b) => {
    const sDem = normalize(b.ratio_medio, rMin, rMax);
    const sMer = normalize(b.mat_brutas, mMin, mMax);
    const sTen = normalize(b.crecimiento, cMin, cMax);

    const scoreBase = sDem * 0.4 + sMer * 0.3 + sTen * 0.25;

    const penalConf = b.anom_conf.length * 5;
    const penalPot = Math.min(b.anom_pot.length * 2, 6);
    const penal = penalConf + penalPot;

    const scoreFinal = Math.max(0, scoreBase - penal);

    // Dimension dominante (ponderada, la contribucion efectiva al score)
    const contrib: [ScoreRow["dimension_dominante"], number][] = [
      ["Demanda", sDem * 0.4],
      ["Mercado", sMer * 0.3],
      ["Tendencia", sTen * 0.25],
    ];
    contrib.sort((a, b) => b[1] - a[1]);
    const dominante = contrib[0][0];

    return {
      provincia: b.provincia,
      score_final: Math.round(scoreFinal * 10) / 10,
      score_demanda: Math.round(sDem * 10) / 10,
      score_mercado: Math.round(sMer * 10) / 10,
      score_tendencia: Math.round(sTen * 10) / 10,
      penalizacion_ivtm: Math.round(penal * 10) / 10,
      ranking: 0,
      matriculaciones_brutas: b.mat_brutas,
      ratio_medio: Math.round(b.ratio_medio * 100) / 100,
      crecimiento: Math.round(b.crecimiento * 10) / 10,
      anomalias_confirmadas: b.anom_conf,
      anomalias_potenciales: b.anom_pot,
      dimension_dominante: dominante,
    };
  });

  filas.sort((a, b) => b.score_final - a.score_final);
  filas.forEach((f, i) => (f.ranking = i + 1));

  return filas;
}

// ──────────────────────────────────────────────────────────────────────────
// Escala de color 5 tonos: rojo → verde
// ──────────────────────────────────────────────────────────────────────────
const ESCALA_COLOR = [
  "#b91c1c", // rojo oscuro
  "#f97316", // naranja
  "#eab308", // amarillo
  "#84cc16", // verde claro
  "#15803d", // verde oscuro
];

export function colorForScore(score: number, minScore: number, maxScore: number): string {
  if (maxScore <= minScore) return ESCALA_COLOR[2];
  const t = (score - minScore) / (maxScore - minScore);
  const idx = Math.min(ESCALA_COLOR.length - 1, Math.max(0, Math.floor(t * ESCALA_COLOR.length)));
  return ESCALA_COLOR[idx];
}

export const ESCALA_COLORES_EXPORT = ESCALA_COLOR;
