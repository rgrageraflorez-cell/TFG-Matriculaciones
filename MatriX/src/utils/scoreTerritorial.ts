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
// Streaming de df_mensual_marca_lugar.csv para series mensuales por provincia.
// El CSV no incluye cod_ine; trae el nombre del municipio en la columna 'lugar'.
// Cruzamos por nombre normalizado (mayusculas sin tildes) contra
// df_mapa_densidad.csv (que si trae cod_ine) para obtener el codigo de
// provincia.
//
// Devuelve Map<provCode, Map<"YYYY-MM", totalMatriculaciones>>.
// ──────────────────────────────────────────────────────────────────────────
export async function cargarTendenciaProvincial(
  provLookup: Map<string, string>,
  onProgress?: (msg: string) => void
): Promise<Map<string, Map<string, number>>> {
  // ── Helper de normalizacion (uppercase + sin tildes) ──
  const normTexto = (s: unknown) =>
    String(s ?? "")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();

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

  // ──────────────────────────────────────────────────────────────────────
  // PASO 1: cargar df_mapa_densidad.csv una sola vez para construir
  // muniNormalizado -> provCode.
  // ──────────────────────────────────────────────────────────────────────
  onProgress?.("Cargando referencia municipio→provincia...");
  const muniToProv = new Map<string, string>();
  {
    const resMapa = await fetch("/df_mapa_densidad.csv");
    if (!resMapa.ok) throw new Error("No se pudo cargar df_mapa_densidad.csv");
    const text = await resMapa.text();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) throw new Error("df_mapa_densidad.csv vacio");
    const header = splitCSVLine(lines[0]).map((h) => h.trim().replace(/^"|"$/g, ""));
    const iCod = header.findIndex((h) => h.toLowerCase() === "cod_ine");
    const iMuni = header.findIndex((h) => h.toLowerCase() === "municipio");
    if (iCod < 0 || iMuni < 0) throw new Error("df_mapa_densidad.csv sin columnas cod_ine/municipio");
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = splitCSVLine(line);
      const cod = String(cols[iCod] ?? "").padStart(5, "0");
      if (cod.length !== 5) continue;
      const provCode = cod.substring(0, 2);
      if (!provLookup.has(provCode)) continue;
      const key = normTexto(cols[iMuni]);
      if (!key) continue;
      // Si hay homonimos en provincias distintas, conserva el primero;
      // las colisiones solo afectan a un numero pequeno de municipios y
      // se diluyen al agregar a nivel provincial.
      if (!muniToProv.has(key)) muniToProv.set(key, provCode);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // PASO 2: streaming de df_mensual_marca_lugar.csv usando 'lugar'.
  // ──────────────────────────────────────────────────────────────────────
  onProgress?.("Cargando series temporales provinciales...");
  // En desarrollo se usa el archivo local servido por Vite; en producción
  // se inyecta una URL externa (Vercel Blob) vía VITE_CSV_MARCA_LUGAR_URL.
  const CSV_URL =
    (import.meta.env.VITE_CSV_MARCA_LUGAR_URL as string | undefined) ||
    "/df_mensual_marca_lugar.csv";
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) throw new Error("No se pudo cargar df_mensual_marca_lugar.csv");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let headers: string[] | null = null;
  let idxFecha = -1;
  let idxAno = -1;
  let idxMes = -1;
  let idxMat = -1;
  let idxMarca = -1;
  let idxLugar = -1;

  const byProv = new Map<string, Map<string, number>>();

  const processLine = (line: string) => {
    if (!line) return;
    if (!headers) {
      headers = splitCSVLine(line).map((h) => h.trim().replace(/^"|"$/g, ""));
      idxFecha = headers.findIndex((h) => h.toLowerCase().startsWith("fecha"));
      idxAno = headers.findIndex((h) => {
        const lo = h.toLowerCase();
        // soporta 'año', 'ano' y mojibakes tipo 'a?o' (cabecera mal codificada)
        return lo === "año" || lo === "ano" || /^a.o$/.test(lo);
      });
      idxMes = headers.findIndex((h) => h.toLowerCase() === "mes");
      idxMat = headers.findIndex((h) => h.toLowerCase() === "matriculaciones");
      idxMarca = headers.findIndex((h) => h.toLowerCase() === "marca");
      idxLugar = headers.findIndex((h) => h.toLowerCase() === "lugar");
      return;
    }
    const cols = splitCSVLine(line);
    const marca = idxMarca >= 0 ? (cols[idxMarca] ?? "").trim() : "";
    if (marca && marca.toUpperCase() === "TOTAL MARCAS") return; // evitar doble conteo

    if (idxLugar < 0) return;
    const provCode = muniToProv.get(normTexto(cols[idxLugar]));
    if (!provCode) return;

    // Año + mes: prioridad a fecha_mes (formato YYYY-MM-DD), luego columnas Año/Mes
    let ano: number | null = null;
    let mes: number | null = null;
    if (idxFecha >= 0) {
      const fecha = String(cols[idxFecha] ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}/.test(fecha)) {
        ano = parseInt(fecha.slice(0, 4));
        mes = parseInt(fecha.slice(5, 7));
      }
    }
    if ((!ano || !mes) && idxAno >= 0 && idxMes >= 0) {
      ano = parseNumLoose(cols[idxAno]);
      mes = parseNumLoose(cols[idxMes]);
    }
    if (!ano || !mes || mes < 1 || mes > 12) return;

    const mat = parseNumLoose(cols[idxMat]) ?? 0;
    if (!mat) return;

    const ymKey = `${ano}-${String(mes).padStart(2, "0")}`;
    let m = byProv.get(provCode);
    if (!m) { m = new Map(); byProv.set(provCode, m); }
    m.set(ymKey, (m.get(ymKey) ?? 0) + mat);
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
  // Compat: acepta el formato nuevo (TTM, claves "YYYY-MM") y el legacy
  // anual (claves number) para no romper consumidores existentes.
  tendenciaProv:
    | Map<string, Map<string, number>>
    | Map<string, Map<number, number>>
    | null,
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

  // ──────────────────────────────────────────────────────────────────────
  // Tendencia: TTM (trailing twelve months).
  //
  // Identificamos los 12 meses mas recientes con datos en el CSV y los
  // 12 inmediatamente anteriores. Para cada provincia con presencia en los
  // 24 meses calculamos:
  //   crec = (sum_actual - sum_base) / sum_base * 100
  // Las provincias con menos de 12 meses en cualquiera de los dos
  // periodos quedan con crecimiento = 0 y son EXCLUIDAS del ranking de
  // tendencia (no afectan al min-max y reciben score_tendencia neutro 50).
  //
  // Si en su lugar nos pasan el formato legacy anual (claves number),
  // mantenemos el calculo antiguo (anioN vs anioN-2) por compatibilidad.
  // ──────────────────────────────────────────────────────────────────────
  let monthsCurrent: string[] = [];
  let monthsBase: string[] = [];
  let formatoTTM = false;

  if (tendenciaProv && tendenciaProv.size > 0) {
    // Detectar formato por el tipo de la primera clave del primer Map
    const firstSerie = tendenciaProv.values().next().value as Map<unknown, number> | undefined;
    if (firstSerie && firstSerie.size > 0) {
      const firstKey = firstSerie.keys().next().value;
      formatoTTM = typeof firstKey === "string";
    }

    if (formatoTTM) {
      // Conjunto global de "YYYY-MM" presentes en el CSV
      const allMonths = new Set<string>();
      for (const m of (tendenciaProv as Map<string, Map<string, number>>).values()) {
        for (const k of m.keys()) allMonths.add(k);
      }
      const sortedMonths = [...allMonths].sort();
      if (sortedMonths.length >= 24) {
        monthsCurrent = sortedMonths.slice(-12);
        monthsBase = sortedMonths.slice(-24, -12);
      }
    }
  }

  const calcularCrecTTM = (provCode: string): { crec: number; valida: boolean } => {
    if (!formatoTTM || !tendenciaProv || monthsCurrent.length !== 12 || monthsBase.length !== 12) {
      return { crec: 0, valida: false };
    }
    const serie = (tendenciaProv as Map<string, Map<string, number>>).get(provCode);
    if (!serie) return { crec: 0, valida: false };
    let sumCur = 0;
    let sumBase = 0;
    for (const k of monthsCurrent) {
      const v = serie.get(k);
      if (v === undefined) return { crec: 0, valida: false };
      sumCur += v;
    }
    for (const k of monthsBase) {
      const v = serie.get(k);
      if (v === undefined) return { crec: 0, valida: false };
      sumBase += v;
    }
    if (sumBase <= 0) return { crec: 0, valida: false };
    return { crec: ((sumCur - sumBase) / sumBase) * 100, valida: true };
  };

  const calcularCrecLegacy = (provCode: string): { crec: number; valida: boolean } => {
    if (!tendenciaProv) return { crec: 0, valida: false };
    const serie = tendenciaProv.get(provCode) as Map<number, number> | undefined;
    if (!serie || serie.size === 0) return { crec: 0, valida: false };
    const anios = Array.from(serie.keys()).sort((a, b) => a - b);
    const anioN = anios[anios.length - 1];
    const anioPrev = anioN - 2;
    if (!serie.has(anioPrev)) return { crec: 0, valida: false };
    const vN = serie.get(anioN) ?? 0;
    const vP = serie.get(anioPrev) ?? 0;
    if (vP <= 0) return { crec: 0, valida: false };
    return { crec: ((vN - vP) / vP) * 100, valida: true };
  };

  // ── Construir datos base por provincia ──
  type Base = {
    provincia: string;
    provCode: string;
    ratio_medio: number;
    mat_brutas: number;
    crecimiento: number;
    tendencia_valida: boolean;
    anom_conf: string[];
    anom_pot: string[];
  };
  const base: Base[] = [];

  for (const [provCode, e] of agg) {
    const ratioMedio = e.ratios.length
      ? e.ratios.reduce((s, r) => s + r, 0) / e.ratios.length
      : 0;

    const { crec: crecimiento, valida: tendenciaValida } = formatoTTM
      ? calcularCrecTTM(provCode)
      : calcularCrecLegacy(provCode);

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
      tendencia_valida: tendenciaValida,
      anom_conf: anomConf,
      anom_pot: anomPot,
    });
  }

  onProgress?.("Normalizando dimensiones...");

  // ── Normalizacion min-max a [0, 100] ──
  // Nota: para la dimension de mercado (matriculaciones brutas) aplicamos
  // logaritmo natural antes de normalizar, para amortiguar la cola larga
  // que generan Madrid y Barcelona y evitar que el resto colapse a ~0.
  // La dimension de tendencia se calcula EXCLUSIVAMENTE sobre las
  // provincias con tendencia valida (12+12 meses completos en TTM).
  // Las invalidas reciben score_tendencia neutro = 50 sin afectar al
  // min-max del resto.
  const ratios = base.map((b) => b.ratio_medio);
  const mats = base.map((b) => b.mat_brutas);
  const crecsValidos = base.filter((b) => b.tendencia_valida).map((b) => b.crecimiento);
  const rMin = Math.min(...ratios), rMax = Math.max(...ratios);
  const mMin = Math.min(...mats), mMax = Math.max(...mats);
  const cMin = crecsValidos.length ? Math.min(...crecsValidos) : 0;
  const cMax = crecsValidos.length ? Math.max(...crecsValidos) : 0;

  const normalize = (v: number, min: number, max: number) =>
    max > min ? ((v - min) / (max - min)) * 100 : 50;

  // Normalizacion log-min-max para la dimension de mercado.
  const normalizeLog = (v: number, min: number, max: number) => {
    const logV = Math.log(v + 1);
    const logMin = Math.log(min + 1);
    const logMax = Math.log(max + 1);
    return logMax > logMin ? ((logV - logMin) / (logMax - logMin)) * 100 : 50;
  };

  onProgress?.("Calculando score final...");

  const filas: ScoreRow[] = base.map((b) => {
    const sDem = normalize(b.ratio_medio, rMin, rMax);
    const sMer = normalizeLog(b.mat_brutas, mMin, mMax);
    const sTen = b.tendencia_valida ? normalize(b.crecimiento, cMin, cMax) : 50;

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
