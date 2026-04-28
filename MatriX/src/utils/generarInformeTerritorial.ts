/* ============================================================================
 * generarInformeTerritorial.ts
 * ----------------------------------------------------------------------------
 * Genera un informe PDF territorial (7 secciones) con diseno ejecutivo
 * (azul marino + dorado) a partir de los CSVs del dashboard.
 *   PORTADA
 *   1. Panorama nacional: evolucion historica
 *   2. Panorama nacional: analisis predictivo (Motor 1 + w_opt)
 *   3. Analisis de mercado por marcas (HHI, top 10, mayor crecimiento)
 *   4. Analisis territorial: posicionamiento provincial
 *   5. Analisis territorial: estructura de mercado provincial
 *   6. Analisis territorial: distribucion municipal
 *   7. Detector de anomalias + conclusiones ejecutivas
 *
 * Los CSVs ligeros se cargan directamente.  df_mensual_marca_lugar.csv
 * (~150 MB) se carga en streaming y se filtra al vuelo por provincia.
 * ============================================================================
 */

import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";
import Papa from "papaparse";
import { calcularScoreTerritorial, type ScoreRow } from "./scoreTerritorial";
import { getGrupo } from "./gruposEmpresariales";
import {
  calcularEscenario,
  factorAmortiguacion,
  getEscenarioActivo,
  type EventoCatalogo,
  type PrediccionEscenarioRow,
} from "./simuladorEscenarios";

// ============================================================================
// TIPOS
// ============================================================================

export type ProgresoCallback = (mensaje: string) => void;

type MapDensityRaw = {
  cod_ine?: string | number;
  fecha: string;
  municipio: string;
  matriculaciones: number;
  ratio_x1000: number;
};

type PredictionRaw = {
  fecha_mes: string;
  real: number | null;
  prediccion: number | null;
  pred_prophet: number | null;
};

type DailyRaw = {
  fecha: string;
  dow: string;
  laborable: number;
  w_opt: number;
  real: number | null;
};

type MonthlyTotalRaw = {
  Ano: number;
  Mes: number;
  Turismos: number;
};

type BrandRaw = {
  fecha_mes: string;
  ano: number;
  marca: string;
  matriculaciones: number;
};

type MunicipioProv = {
  cod_ine: string;
  municipio: string;
  matriculaciones: number;
  ratio_x1000: number;
};

type AlertaMotor1 = {
  tipo: "Pico" | "Valle" | "Tendencia" | "Salto brusco";
  mes: string;
  valor: number;
  recomendacion: string;
};

type PatronDia = {
  dia: string;
  pesoW: number;
  pctAprox: number;
};

type ResumenProvincia = {
  provincia: string;
  anio: number;
  anioMapa: string;
  // Panorama nacional
  monthlyNacional: { fecha: string; matriculaciones: number }[];
  kpiNacional: { totalAnio: number; variacionPct: number; mesPico: string; mesPicoVal: number };
  introNacional: string;
  // Predictivo
  forecastSerie: { fecha: string; real: number | null; pred: number | null }[];
  alertasMotor1: AlertaMotor1[];
  patronSemanal: PatronDia[];
  introPredictivo: string;
  diasMayorPeso: string[];
  pctDiasMayor: number;
  // Marcas nacional
  top10MarcasNacional: { marca: string; matriculaciones: number; cuota: number; posicion: number }[];
  hhi: number;
  hhiInterp: string;
  introMarcas: string;
  marcaMayorCrecimiento: { marca: string; variacionPct: number; matAnioPrev: number; matAnio: number } | null;
  // Territorial
  totalProvincial: number;
  totalNacional: number;
  mediaNacional: number;
  ranking: number;
  ratioProv: number;
  ratioNacional: number;
  desvRatioPct: number;
  serieMensualProv: { fecha: string; matriculaciones: number }[];
  serieMensualMediaProv: { fecha: string; media: number }[];
  introTerritorial: string;
  // Marcas provincial
  top10MarcasProv: { marca: string; matriculaciones: number; cuota: number; posicionProv: number; posicionNac: number; diff: number }[];
  interpretacionMixMarcas: string;
  // Grupos empresariales provincial (consolidacion marca -> grupo)
  gruposProv: { grupo: string; total: number; cuota: number }[];
  interpretacionGruposProv: string;
  // Municipal
  municipiosRatioDesc: MunicipioProv[];
  municipiosVolumenDesc: MunicipioProv[];
  municipiosRatioAscFiltrado: MunicipioProv[];
  // Anomalias + conclusiones
  anomaliasConfirmadas: string[];
  anomaliasPotenciales: { municipio: string; ratio: number; mediana: number; factor: number }[];
  conclusionPosicionamiento: string;
  conclusionTendencia: string;
  conclusionTerritorial: string;
  recomendacion: string;
  // Score territorial (opcional)
  scoreInfo: {
    row: ScoreRow;
    totalProvincias: number;
    mediaNacional: number;
  } | null;
};

// ============================================================================
// CONSTANTES
// ============================================================================

const PALETA = {
  navy: "#0A1628",
  gold: "#C9A84C",
  cardBg: "#F8F9FA",
  pageBg: "#FFFFFF",
  text: "#4A5568",
  textDark: "#1A202C",
  subtle: "#CBD5E0",
  borde: "#E2E8F0",
  exito: "#059669",
  peligro: "#dc2626",
  aviso: "#d97706",
};

const MESES_ES = [
  "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MUNICIPIOS_IVTM_BONIFICADOS = [
  { nombre: "AGUILAR DE SEGARRA", provincia: null as string | null },
  { nombre: "RAJADELL", provincia: null as string | null },
  { nombre: "TORRENT", provincia: "GIRONA" },
];

// Orden de paginacion del PDF y progreso
const SECCIONES_PROGRESO = [
  "Cargando datos nacionales...",
  "Generando panorama histórico...",
  "Calculando predicciones...",
  "Analizando mercado de marcas...",
  "Procesando datos provinciales...",
  "Analizando distribución municipal...",
  "Detectando anomalías...",
  "Componiendo informe final...",
];

// ============================================================================
// UTILIDADES BASICAS
// ============================================================================

const norm = (s: unknown): string =>
  String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const parseNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === "NA" || s.toUpperCase() === "NULL") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const fmtInt = (n: number) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("es-ES", { maximumFractionDigits: 0 });

const fmtDec = (n: number, d = 2) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("es-ES", {
    minimumFractionDigits: 0, maximumFractionDigits: d,
  });

const formatMesLabel = (fechaYYYY_MM_DD: string): string => {
  const m = parseInt(fechaYYYY_MM_DD.slice(5, 7));
  const y = fechaYYYY_MM_DD.slice(0, 4);
  return `${MESES_ES[m] ?? "?"} ${y}`;
};

const formatMesCorto = (fechaYYYY_MM_DD: string): string => {
  const m = parseInt(fechaYYYY_MM_DD.slice(5, 7));
  const y = fechaYYYY_MM_DD.slice(2, 4);
  return `${(MESES_ES[m] ?? "").slice(0, 3)}-${y}`;
};

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  } as Record<string, string>)[c]);
}

// ============================================================================
// CONTENEDOR OCULTO + HTML2CANVAS + JSPDF
// ============================================================================

const PAGE_W_PX = 794;

function crearContenedor(html: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${PAGE_W_PX}px`,
    `background:${PALETA.pageBg}`,
    "font-family:system-ui, -apple-system, 'Segoe UI', Inter, Roboto, sans-serif",
    `color:${PALETA.text}`,
    "padding:40px",
    "box-sizing:border-box",
    "z-index:-1",
  ].join(";");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
  return wrapper;
}

async function capturarYAnadirAlPdf(
  pdf: jsPDF,
  nodo: HTMLElement,
  esPrimeraPagina: boolean,
  cabecera: { provincia: string; anio: number },
  numeroPaginaInicial: number,
  dibujarHeader: boolean
): Promise<number> {
  // Captura a triple resolución para texto nítido. Se exporta como PNG sin
  // compresión de pérdida y se le pasa el flag FASTZIP a jsPDF.
  const canvas = await html2canvas(nodo, {
    scale: 3,
    useCORS: true,
    allowTaint: false,
    backgroundColor: "#FFFFFF",
    logging: false,
    imageTimeout: 0,
    removeContainer: true,
  });
  const imgData = canvas.toDataURL("image/png", 1.0);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margenSup = dibujarHeader ? 14 : 0;
  const margenInf = dibujarHeader ? 14 : 0;
  const areaH = pageH - margenSup - margenInf;
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  if (!esPrimeraPagina) pdf.addPage();

  if (imgH <= areaH) {
    if (dibujarHeader) dibujarCabecera(pdf, cabecera);
    pdf.addImage(imgData, "PNG", 0, margenSup, imgW, imgH, undefined, "FAST");
    if (dibujarHeader) dibujarPie(pdf, numeroPaginaInicial);
    return numeroPaginaInicial + 1;
  }

  // Paginacion automatica
  const scaleFactor = canvas.width / imgW;
  const sliceHpx = areaH * scaleFactor;
  let offsetPx = 0;
  let paginaActual = numeroPaginaInicial;
  let primeraIter = true;
  while (offsetPx < canvas.height) {
    if (!primeraIter) pdf.addPage();
    const sliceH = Math.min(sliceHpx, canvas.height - offsetPx);
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = sliceH;
    const ctx = off.getContext("2d");
    if (ctx) {
      ctx.drawImage(canvas, 0, offsetPx, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
    }
    const sliceData = off.toDataURL("image/png", 1.0);
    if (dibujarHeader) dibujarCabecera(pdf, cabecera);
    pdf.addImage(sliceData, "PNG", 0, margenSup, imgW, sliceH / scaleFactor, undefined, "FAST");
    if (dibujarHeader) dibujarPie(pdf, paginaActual);
    offsetPx += sliceH;
    paginaActual++;
    primeraIter = false;
  }
  return paginaActual;
}

function dibujarCabecera(pdf: jsPDF, cab: { provincia: string; anio: number }) {
  pdf.setFontSize(8);
  pdf.setTextColor(74, 85, 104);
  pdf.text(`INFORME · ${cab.provincia.toUpperCase()} · ${cab.anio}`, 10, 8);
  pdf.setDrawColor(201, 168, 76);
  pdf.setLineWidth(0.3);
  pdf.line(10, 10, pdf.internal.pageSize.getWidth() - 10, 10);
}

function dibujarPie(pdf: jsPDF, num: number) {
  const h = pdf.internal.pageSize.getHeight();
  const w = pdf.internal.pageSize.getWidth();
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.2);
  pdf.line(10, h - 10, w - 10, h - 10);
  pdf.setFontSize(8);
  pdf.setTextColor(74, 85, 104);
  pdf.text(`Página ${num}`, w / 2, h - 4, { align: "center" });
  pdf.setTextColor(201, 168, 76);
  pdf.text("CONFIDENCIAL", 10, h - 4);
}

// ============================================================================
// CARGA DE DATOS
// ============================================================================

async function cargarCsvGenerico<T>(
  url: string,
  mapper: (r: any) => T | null
): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true }).data as any[];
  const out: T[] = [];
  for (const r of parsed) {
    const m = mapper(r);
    if (m !== null) out.push(m);
  }
  return out;
}

const cargarMapaDensidad = (): Promise<MapDensityRaw[]> =>
  cargarCsvGenerico<MapDensityRaw>("/df_mapa_densidad.csv", (r) => {
    const fecha = String(r.fecha ?? "").slice(0, 10);
    const municipio = String(r.municipio ?? "").trim();
    if (!fecha || !municipio) return null;
    return {
      cod_ine: r.cod_ine,
      fecha,
      municipio,
      matriculaciones: parseNum(r.matriculaciones) ?? 0,
      ratio_x1000: parseNum(r.ratio_x1000) ?? 0,
    };
  });

const cargarMonthlyTotal = (): Promise<MonthlyTotalRaw[]> =>
  cargarCsvGenerico<MonthlyTotalRaw>("/df_mensual_agrupado.csv", (r) => {
    const ano = parseNum(r["Año"] ?? r.Año ?? r.Ano);
    const mes = parseNum(r.Mes);
    const t = parseNum(r.Turismos);
    if (!ano || !mes || t === null) return null;
    return { Ano: ano, Mes: mes, Turismos: t };
  });

const cargarPredicciones = async (): Promise<PredictionRaw[]> => {
  const rows = await cargarCsvGenerico<PredictionRaw>("/df_real_pred_mensual_total.csv", (r) => {
    const fecha = String(r.fecha_mes ?? "").slice(0, 10);
    if (!fecha) return null;
    return {
      fecha_mes: fecha,
      real: parseNum(r.real),
      prediccion: parseNum(r.prediccion),
      pred_prophet: parseNum(r.pred_prophet),
    };
  });
  return rows.sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
};

const cargarDiario = (): Promise<DailyRaw[]> =>
  cargarCsvGenerico<DailyRaw>("/df_md_diario.csv", (r) => {
    const fecha = String(r.fecha ?? "").slice(0, 10);
    if (!fecha) return null;
    return {
      fecha,
      dow: String(r.dow ?? ""),
      laborable: parseNum(r.laborable) ?? 0,
      w_opt: parseNum(r.w_opt) ?? 0,
      real: parseNum(r.real),
    };
  });

const cargarMarcasNacional = (): Promise<BrandRaw[]> =>
  cargarCsvGenerico<BrandRaw>("/df_mensual_marca.csv", (r) => {
    const fecha = String(r.fecha_mes ?? "").slice(0, 10);
    const ano = parseNum(r["Año"] ?? r.Año ?? r.Ano) ?? parseInt(fecha.slice(0, 4));
    const marca = String(r.marca ?? "").trim();
    const mat = parseNum(r.matriculaciones) ?? 0;
    if (!fecha || !marca || !ano) return null;
    if (marca === "TOTAL MARCAS") return null;
    return { fecha_mes: fecha, ano, marca, matriculaciones: mat };
  });

const cargarGeoJsonProvincias = async (): Promise<Map<string, string>> => {
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
};

// ============================================================================
// INDICE MUNICIPIO -> PROVINCIA
// ============================================================================

type MunicipioIndex = {
  byNombre: Map<string, { provCode: string; provincia: string; cod_ine: string }>;
  byProvincia: Map<string, Set<string>>;
};

function construirIndiceMunicipios(
  mapRows: MapDensityRaw[],
  provLookup: Map<string, string>
): MunicipioIndex {
  const byNombre = new Map<string, { provCode: string; provincia: string; cod_ine: string }>();
  const byProvincia = new Map<string, Set<string>>();
  for (const r of mapRows) {
    const cod = String(r.cod_ine ?? "").padStart(5, "0");
    if (cod.length !== 5) continue;
    const provCode = cod.substring(0, 2);
    const provincia = provLookup.get(provCode);
    if (!provincia) continue;
    const key = norm(r.municipio);
    if (!byNombre.has(key)) {
      byNombre.set(key, { provCode, provincia, cod_ine: cod });
    }
    let set = byProvincia.get(provincia);
    if (!set) {
      set = new Set<string>();
      byProvincia.set(provincia, set);
    }
    set.add(key);
  }
  return { byNombre, byProvincia };
}

// ============================================================================
// STREAMING DE df_mensual_marca_lugar.csv POR PROVINCIA
// ============================================================================

type FiltradoMarcaLugar = {
  serieMensual: Map<string, number>;         // YYYY-MM-01 -> total provincial (anio objetivo)
  marcaTotal: Map<string, number>;            // marca -> total prov (anio objetivo)
  serieNacionalTotal: Map<string, number>;    // YYYY-MM-01 -> total nacional (para media nacional)
  serieProvincia: Map<string, Map<string, number>>; // provincia -> (YYYY-MM -> total) (para media)
  yearlyByProv: Map<string, Map<number, number>>; // provincia -> (anio -> total) [para tendencia]
  totalProv: number;
};

async function streamMarcaLugar(
  provinciaObj: string,
  anioObj: number,
  anioTerritorial: string,
  muniIdx: MunicipioIndex,
  onProgreso?: ProgresoCallback
): Promise<FiltradoMarcaLugar> {
  const serieMensual = new Map<string, number>();
  const marcaTotal = new Map<string, number>();
  const serieNacionalTotal = new Map<string, number>();
  const serieProvincia = new Map<string, Map<string, number>>();
  const yearlyByProv = new Map<string, Map<number, number>>();
  let totalProv = 0;

  const munisProv = muniIdx.byProvincia.get(provinciaObj);
  if (!munisProv) {
    return { serieMensual, marcaTotal, serieNacionalTotal, serieProvincia, yearlyByProv, totalProv };
  }

  // Indice inverso muni_norm -> provincia_name para agregar por provincia
  const muniToProv = muniIdx.byNombre;

  onProgreso?.("Descargando df_mensual_marca_lugar.csv (~150 MB)...");
  // En desarrollo se usa el archivo local servido por Vite; en producción
  // se inyecta una URL externa (Google Drive) vía VITE_CSV_MARCA_LUGAR_URL.
  const CSV_URL =
    (import.meta.env.VITE_CSV_MARCA_LUGAR_URL as string | undefined) ||
    "/df_mensual_marca_lugar.csv";
  const res = await fetch(CSV_URL);
  if (!res.ok || !res.body) throw new Error("No se pudo descargar df_mensual_marca_lugar.csv");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let headers: string[] | null = null;
  let idxFecha = -1, idxMarca = -1, idxLugar = -1, idxMat = -1;
  let filasProcesadas = 0;
  let filasFiltradas = 0;
  const yearObjStr = String(anioObj);
  const yearTerrStr = String(anioTerritorial);
  let lastProgress = 0;

  const stripQuotes = (s: string) =>
    s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

  const parseHeader = (line: string) => {
    const cols = line.split(",").map((c) => stripQuotes(c.trim()));
    headers = cols;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i].toLowerCase();
      if (c === "fecha_mes") idxFecha = i;
      else if (c === "marca") idxMarca = i;
      else if (c === "lugar") idxLugar = i;
      else if (c === "matriculaciones") idxMat = i;
    }
    if (idxFecha < 0 || idxMarca < 0 || idxLugar < 0 || idxMat < 0) {
      throw new Error("df_mensual_marca_lugar.csv: columnas esperadas no encontradas");
    }
  };

  const procesarLinea = (line: string) => {
    if (!line) return;
    if (!headers) { parseHeader(line); return; }
    const cols: string[] = [];
    let i = 0, cur = "", inQ = false;
    while (i < line.length) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += ch; i++;
      } else {
        if (ch === ",") { cols.push(cur); cur = ""; i++; continue; }
        if (ch === '"' && cur.length === 0) { inQ = true; i++; continue; }
        cur += ch; i++;
      }
    }
    cols.push(cur);

    const fecha = (cols[idxFecha] ?? "").slice(0, 10);
    const anoRow = fecha.slice(0, 4);
    const lugar = cols[idxLugar] ?? "";
    const keyMuni = norm(lugar);
    const mat = parseNum(cols[idxMat]) ?? 0;

    // Nacional agregado por mes (para toda la serie del anioObj)
    if (anoRow === yearObjStr) {
      serieNacionalTotal.set(fecha, (serieNacionalTotal.get(fecha) ?? 0) + mat);
      // Provincia del lugar para serie por provincia
      const info = muniToProv.get(keyMuni);
      if (info) {
        let mp = serieProvincia.get(info.provincia);
        if (!mp) { mp = new Map<string, number>(); serieProvincia.set(info.provincia, mp); }
        mp.set(fecha, (mp.get(fecha) ?? 0) + mat);
      }
    }

    // Filtro provincia objetivo: serieMensual + marcaTotal en anioObj
    if (anoRow === yearObjStr && munisProv.has(keyMuni)) {
      const marca = String(cols[idxMarca] ?? "").trim();
      serieMensual.set(fecha, (serieMensual.get(fecha) ?? 0) + mat);
      marcaTotal.set(marca, (marcaTotal.get(marca) ?? 0) + mat);
      totalProv += mat;
      filasFiltradas++;
    }

    // Extensamos la nacional tambien con anioTerritorial para ranking si es distinto
    if (anoRow === yearTerrStr && anoRow !== yearObjStr) {
      // contabilizar en provincia solo para ranking territorial: usaremos mapa_densidad, asi que omitimos aqui
    }

    // Tendencia interanual: acumular totales por provincia y anio (todos los anios)
    if (/^\d{4}$/.test(anoRow)) {
      const info = muniToProv.get(keyMuni);
      if (info) {
        const anoN = parseInt(anoRow);
        let my = yearlyByProv.get(info.provincia);
        if (!my) { my = new Map<number, number>(); yearlyByProv.set(info.provincia, my); }
        my.set(anoN, (my.get(anoN) ?? 0) + mat);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      procesarLinea(raw);
      filasProcesadas++;
      if (filasProcesadas - lastProgress > 200000) {
        lastProgress = filasProcesadas;
        onProgreso?.(`Procesando CSV... ${fmtInt(filasProcesadas)} filas leídas, ${fmtInt(filasFiltradas)} de ${provinciaObj}`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  if (buffer.length) procesarLinea(buffer);

  onProgreso?.(`CSV procesado: ${fmtInt(filasProcesadas)} filas totales, ${fmtInt(filasFiltradas)} en ${provinciaObj}`);

  return { serieMensual, marcaTotal, serieNacionalTotal, serieProvincia, yearlyByProv, totalProv };
}

// ============================================================================
// MOTOR 1 — ALERTAS DE PREDICCION
// ============================================================================

function calcularAlertasMotor1(predicciones: PredictionRaw[]): AlertaMotor1[] {
  const alertas: AlertaMotor1[] = [];
  const future = predicciones.filter(
    (d) => d.real === null && (d.pred_prophet ?? d.prediccion) !== null
  );
  if (!future.length) return alertas;

  const getVal = (p: PredictionRaw) => (p.pred_prophet ?? p.prediccion) as number;

  const futMean = future.reduce((s, d) => s + getVal(d), 0) / future.length;

  const next6 = future.slice(0, 6);
  if (next6.length > 0) {
    // Pico
    const peak = next6.reduce((a, b) => (getVal(b) > getVal(a) ? b : a));
    const peakVal = getVal(peak);
    const pctAboveMean = ((peakVal - futMean) / futMean) * 100;
    alertas.push({
      tipo: "Pico",
      mes: formatMesLabel(peak.fecha_mes),
      valor: peakVal,
      recomendacion: `Demanda ${fmtDec(pctAboveMean)}% sobre la media prevista. Reforzar stock y capacidad logística con antelación.`,
    });

    // Valle
    const valley = next6.reduce((a, b) => (getVal(b) < getVal(a) ? b : a));
    if (valley.fecha_mes !== peak.fecha_mes) {
      const vVal = getVal(valley);
      const pctBelowMean = ((futMean - vVal) / futMean) * 100;
      alertas.push({
        tipo: "Valle",
        mes: formatMesLabel(valley.fecha_mes),
        valor: vVal,
        recomendacion: `Demanda ${fmtDec(pctBelowMean)}% bajo la media prevista. Ajustar pedidos y estimular la demanda con acciones comerciales.`,
      });
    }
  }

  // Tendencia
  if (future.length >= 6) {
    const first3Avg = future.slice(0, 3).reduce((s, d) => s + getVal(d), 0) / 3;
    const last3Avg = future.slice(-3).reduce((s, d) => s + getVal(d), 0) / 3;
    const trendPct = ((last3Avg - first3Avg) / first3Avg) * 100;
    const direction = trendPct > 2 ? "alcista" : trendPct < -2 ? "bajista" : "estable";
    alertas.push({
      tipo: "Tendencia",
      mes: `Horizonte 6 meses`,
      valor: last3Avg,
      recomendacion:
        direction === "alcista"
          ? `Crecimiento del ${fmtDec(Math.abs(trendPct))}%. Planificar incremento progresivo de inventario.`
          : direction === "bajista"
          ? `Contracción del ${fmtDec(Math.abs(trendPct))}%. Ajustar aprovisionamiento a la baja.`
          : `Variación del ${fmtDec(Math.abs(trendPct))}%. Mantener niveles actuales de stock.`,
    });
  }

  // Salto brusco mes a mes
  if (next6.length >= 2) {
    let maxJump = 0;
    let jumpFrom = "", jumpTo = "", jumpPred = 0;
    for (let i = 1; i < next6.length; i++) {
      const jump = getVal(next6[i]) - getVal(next6[i - 1]);
      if (jump > maxJump) {
        maxJump = jump;
        jumpFrom = next6[i - 1].fecha_mes;
        jumpTo = next6[i].fecha_mes;
        jumpPred = getVal(next6[i]);
      }
    }
    if (maxJump > 0 && jumpTo) {
      const pctJump = (maxJump / (jumpPred - maxJump)) * 100;
      alertas.push({
        tipo: "Salto brusco",
        mes: `${formatMesLabel(jumpFrom)} → ${formatMesLabel(jumpTo)}`,
        valor: jumpPred,
        recomendacion: `Incremento de +${fmtInt(Math.round(maxJump))} matriculaciones (+${fmtDec(pctJump)}%). Anticipar logística 4-6 semanas antes.`,
      });
    }
  }

  return alertas;
}

// ============================================================================
// PATRON INTRAMENSUAL — pesos w_opt del modelo MD
// ============================================================================

function calcularPatronSemanal(daily: DailyRaw[]): PatronDia[] {
  // w_opt es el peso del modelo MD. Agregamos la MEDIA de w_opt por dia
  // laborable observado en la serie completa, y convertimos a porcentaje
  // relativo (share) sobre la suma de pesos de dias laborables.
  const agg = new Map<string, { sum: number; count: number }>();
  for (const r of daily) {
    if (r.laborable !== 1) continue;
    const key = norm(r.dow);
    const entry = agg.get(key) ?? { sum: 0, count: 0 };
    entry.sum += r.w_opt;
    entry.count++;
    agg.set(key, entry);
  }
  const ordenDias = [
    { raw: "LUNES", label: "lunes" },
    { raw: "MARTES", label: "martes" },
    { raw: "MIERCOLES", label: "miércoles" },
    { raw: "JUEVES", label: "jueves" },
    { raw: "VIERNES", label: "viernes" },
  ];
  const medias = ordenDias.map(({ raw, label }) => {
    const e = agg.get(raw);
    return { dia: label, media: e && e.count > 0 ? e.sum / e.count : 0 };
  });
  const suma = medias.reduce((s, m) => s + m.media, 0) || 1;
  const resultado: PatronDia[] = medias
    .map((m) => ({
      dia: m.dia,
      pesoW: m.media,
      pctAprox: (m.media / suma) * 100,
    }))
    .sort((a, b) => b.pesoW - a.pesoW); // de mayor a menor peso
  return resultado;
}

// ============================================================================
// HHI + TOP 10 + CRECIMIENTO
// ============================================================================

function calcularHHI(brandRows: BrandRaw[], anio: number): {
  hhi: number; interp: string; top10: { marca: string; matriculaciones: number; cuota: number; posicion: number }[]; totalAnio: number;
} {
  const totales = new Map<string, number>();
  let totalAnio = 0;
  for (const r of brandRows) {
    if (r.ano !== anio) continue;
    totales.set(r.marca, (totales.get(r.marca) ?? 0) + r.matriculaciones);
    totalAnio += r.matriculaciones;
  }
  let hhi = 0;
  if (totalAnio > 0) {
    for (const v of totales.values()) {
      const s = (v / totalAnio) * 100;
      hhi += s * s;
    }
  }
  const interp =
    hhi > 2500 ? "mercado altamente concentrado"
    : hhi >= 1500 ? "concentración moderada"
    : "mercado competitivo";

  const sorted = [...totales.entries()]
    .sort((a, b) => b[1] - a[1]);
  const top10 = sorted.slice(0, 10).map(([marca, matriculaciones], i) => ({
    marca,
    matriculaciones,
    cuota: totalAnio > 0 ? (matriculaciones / totalAnio) * 100 : 0,
    posicion: i + 1,
  }));

  return { hhi, interp, top10, totalAnio };
}

function calcularMayorCrecimiento(
  brandRows: BrandRaw[], anio: number
): ResumenProvincia["marcaMayorCrecimiento"] {
  const prev = anio - 1;
  const byMarca = new Map<string, { cur: number; prev: number }>();
  for (const r of brandRows) {
    if (r.ano !== anio && r.ano !== prev) continue;
    let e = byMarca.get(r.marca);
    if (!e) { e = { cur: 0, prev: 0 }; byMarca.set(r.marca, e); }
    if (r.ano === anio) e.cur += r.matriculaciones;
    else e.prev += r.matriculaciones;
  }
  let best: ResumenProvincia["marcaMayorCrecimiento"] = null;
  for (const [marca, { cur, prev: pv }] of byMarca) {
    // Exigimos volumen minimo en ambos anios para evitar marcas anecdoticas
    if (pv < 1000 || cur < 1000) continue;
    const pct = ((cur - pv) / pv) * 100;
    if (!best || pct > best.variacionPct) {
      best = { marca, variacionPct: pct, matAnioPrev: pv, matAnio: cur };
    }
  }
  return best;
}

// ============================================================================
// POSICIONAMIENTO PROVINCIAL — RANKING Y RATIOS
// ============================================================================

function calcularRankingProvincial(
  mapRows: MapDensityRaw[],
  provLookup: Map<string, string>,
  anioMapa: string,
  provincia: string
): { ranking: number; totalProvincias: number } {
  const byProv = new Map<string, number>();
  for (const r of mapRows) {
    if (!r.fecha.startsWith(anioMapa)) continue;
    const cod2 = String(r.cod_ine ?? "").padStart(5, "0").substring(0, 2);
    const p = provLookup.get(cod2);
    if (!p) continue;
    byProv.set(p, (byProv.get(p) ?? 0) + r.matriculaciones);
  }
  const sorted = [...byProv.entries()].sort((a, b) => b[1] - a[1]);
  const idx = sorted.findIndex(([p]) => p === provincia);
  return { ranking: idx < 0 ? -1 : idx + 1, totalProvincias: sorted.length };
}

// ============================================================================
// SECCION HTML BUILDERS
// ============================================================================

function cabeceraSeccion(numero: number, titulo: string): string {
  return `
    <div style="display:flex; align-items:center; margin-bottom:16px; padding-bottom:10px; border-bottom:2px solid ${PALETA.navy};">
      <span style="font-size:11px; font-weight:700; color:#C4922A; text-transform:uppercase; letter-spacing:0.08em; margin-right:10px;">Sección ${numero}</span>
      <h2 style="margin:0; font-size:15px; font-weight:600; color:${PALETA.navy};">${escapeHtml(titulo)}</h2>
    </div>`;
}

function kpiCard(label: string, value: string, hint = ""): string {
  return `
    <div style="flex:1; background-color:#FFFFFF; border:1px solid ${PALETA.borde}; border-left:3px solid ${PALETA.navy}; padding:14px 16px; border-radius:3px;">
      <p style="margin:0 0 6px 0; font-size:9px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:#6B7280;">${escapeHtml(label)}</p>
      <p style="margin:0; font-size:22px; font-weight:700; color:${PALETA.navy}; line-height:1;">${escapeHtml(value)}</p>
      ${hint ? `<p style="margin:4px 0 0 0; font-size:11px; font-weight:500; color:${PALETA.text};">${escapeHtml(hint)}</p>` : ""}
    </div>`;
}

// ============================================================================
// SISTEMA EJECUTIVO DE TABLAS (consistente con la guia visual)
// ============================================================================
const TABLE_STYLE  = `width:100%; border-collapse:collapse; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:11px; margin-bottom:16px;`;
const THEAD_STYLE  = `background-color:${PALETA.navy}; color:#FFFFFF;`;
const TH_STYLE     = `padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;`;
const TH_CENTER    = TH_STYLE.replace("text-align:left", "text-align:center");
const TH_RIGHT     = TH_STYLE.replace("text-align:left", "text-align:right");
const TD_STYLE     = `padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; color:${PALETA.textDark}; font-size:11px; vertical-align:middle;`;
const TD_FIRST     = `padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; color:${PALETA.navy}; font-size:11px; font-weight:500; vertical-align:middle;`;
const TD_RIGHT     = TD_STYLE.replace("vertical-align:middle", "text-align:right; vertical-align:middle");
const TD_CENTER    = TD_STYLE.replace("vertical-align:middle", "text-align:center; vertical-align:middle");
const TD_POSITIVE  = TD_STYLE.replace(`color:${PALETA.textDark}`, `color:${PALETA.exito}; font-weight:600`);
const TD_NEGATIVE  = TD_STYLE.replace(`color:${PALETA.textDark}`, `color:${PALETA.peligro}; font-weight:600`);
const ROW_BG_EVEN  = "#F7F7F5";
const ROW_BG_ODD   = "#FFFFFF";
function rowBg(i: number): string { return i % 2 === 0 ? ROW_BG_ODD : ROW_BG_EVEN; }

function parrafoIntro(texto: string): string {
  return `<p style="margin:0 0 18px 0; padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.navy}; border-radius:6px; font-size:11px; line-height:1.55; color:${PALETA.textDark};">${texto}</p>`;
}

// --- PORTADA -----------------------------------------------------------------
function htmlPortada(r: ResumenProvincia): string {
  const hoy = new Date().toLocaleDateString("es-ES", {
    year: "numeric", month: "long", day: "numeric",
  });
  return `
    <div style="width:${PAGE_W_PX - 80}px; min-height:1050px; background:${PALETA.navy}; color:#ffffff; padding:60px 56px; box-sizing:border-box; position:relative; margin:-40px; overflow:hidden;">
      <div style="margin-top:40px;">
        <p style="margin:0; font-size:11px; color:${PALETA.gold}; letter-spacing:4px; font-weight:500;">SISTEMA DE ANÁLISIS DE MATRICULACIONES DGT</p>
      </div>

      <div style="margin-top:220px;">
        <h1 style="margin:0; font-size:40px; font-weight:300; letter-spacing:-0.5px; line-height:1.1; color:#ffffff;">
          INFORME DE<br/>MATRICULACIONES
        </h1>
        <div style="width:60px; height:2px; background:${PALETA.gold}; margin:28px 0;"></div>
        <h2 style="margin:0; font-size:46px; font-weight:700; letter-spacing:2px; color:${PALETA.gold}; text-transform:uppercase;">
          ${escapeHtml(r.provincia.toUpperCase())}
        </h2>
      </div>

      <div style="margin-top:180px; padding-top:22px; border-top:1px solid ${PALETA.gold};">
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px;">
          <div>
            <p style="margin:0 0 6px 0; font-size:9px; color:${PALETA.gold}; letter-spacing:2px; font-weight:500;">PERÍODO ANALIZADO</p>
            <p style="margin:0; font-size:16px; font-weight:500; color:#ffffff;">Año ${r.anio}</p>
          </div>
          <div>
            <p style="margin:0 0 6px 0; font-size:9px; color:${PALETA.gold}; letter-spacing:2px; font-weight:500;">FECHA DE GENERACIÓN</p>
            <p style="margin:0; font-size:16px; font-weight:500; color:#ffffff;">${escapeHtml(hoy)}</p>
          </div>
          <div>
            <p style="margin:0 0 6px 0; font-size:9px; color:${PALETA.gold}; letter-spacing:2px; font-weight:500;">ELABORADO POR</p>
            <p style="margin:0; font-size:16px; font-weight:500; color:#ffffff;">Dashboard DGT — TFG</p>
          </div>
        </div>
      </div>

      <p style="position:absolute; bottom:40px; left:56px; right:56px; text-align:center; margin:0; font-size:10px; color:#CBD5E0; letter-spacing:3px; font-weight:500;">
        CONFIDENCIAL — USO INTERNO
      </p>
    </div>`;
}

// --- SECCION 1 ---------------------------------------------------------------
function htmlSeccion1(r: ResumenProvincia): string {
  // Grafico de linea completo con area bajo la curva
  const serie = r.monthlyNacional;
  const W = 700, H = 300;
  const padL = 70, padR = 20, padT = 20, padB = 56;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(1, ...serie.map((s) => s.matriculaciones));
  const step = plotW / Math.max(1, serie.length - 1);
  const xOf = (i: number) => padL + i * step;
  const yOf = (v: number) => padT + plotH - (v / maxV) * plotH;
  const pts = serie.map((s, i) => `${xOf(i)},${yOf(s.matriculaciones)}`);
  const areaPath = serie.length
    ? `M ${xOf(0)},${padT + plotH} L ${pts.join(" L ")} L ${xOf(serie.length - 1)},${padT + plotH} Z`
    : "";
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxV * f, y: yOf(maxV * f) }));

  // Etiquetas X: una por año
  const etiquetasX: { x: number; label: string }[] = [];
  let lastYear = "";
  serie.forEach((s, i) => {
    const y = s.fecha.slice(0, 4);
    if (y !== lastYear) {
      etiquetasX.push({ x: xOf(i), label: y });
      lastYear = y;
    }
  });

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:${PALETA.cardBg}; border:1px solid ${PALETA.borde}; border-radius:10px;">
      ${yTicks.map((t) => `
        <line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="${PALETA.borde}" stroke-width="0.5"/>
        <text x="${padL - 8}" y="${t.y + 3}" fill="${PALETA.text}" font-size="9" text-anchor="end">${fmtInt(Math.round(t.v))}</text>
      `).join("")}
      <path d="${areaPath}" fill="${PALETA.navy}" fill-opacity="0.08"/>
      <polyline fill="none" stroke="${PALETA.navy}" stroke-width="2" points="${pts.join(" ")}"/>
      ${pts.map((p) => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="1.6" fill="${PALETA.navy}"/>`; }).join("")}
      ${etiquetasX.map((l) => `<text x="${l.x}" y="${H - padB + 16}" fill="${PALETA.text}" font-size="9" text-anchor="middle" font-weight="500">${l.label}</text>`).join("")}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${PALETA.text}" stroke-width="0.6"/>
    </svg>`;

  return `
    <div>
      ${cabeceraSeccion(1, "Panorama nacional: evolución histórica")}
      ${parrafoIntro(r.introNacional)}

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:22px;">
        ${kpiCard("Total matriculaciones", fmtInt(r.kpiNacional.totalAnio), `Año ${r.anio}`)}
        ${kpiCard("Variación interanual", `${r.kpiNacional.variacionPct >= 0 ? "+" : ""}${fmtDec(r.kpiNacional.variacionPct)}%`, `vs ${r.anio - 1}`)}
        ${kpiCard("Mes de mayor demanda", r.kpiNacional.mesPico || "—", `${fmtInt(r.kpiNacional.mesPicoVal)} matriculaciones`)}
      </div>

      <h3 style="margin:4px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Evolución mensual de matriculaciones en España</h3>
      ${svg}
    </div>`;
}

// --- SECCION 2 ---------------------------------------------------------------
function htmlSeccion2(r: ResumenProvincia): string {
  const serie = r.forecastSerie;
  const W = 700, H = 300;
  const padL = 70, padR = 20, padT = 20, padB = 56;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(1, ...serie.map((s) => Math.max(s.real ?? 0, s.pred ?? 0)));
  const step = plotW / Math.max(1, serie.length - 1);
  const xOf = (i: number) => padL + i * step;
  const yOf = (v: number) => padT + plotH - (v / maxV) * plotH;

  const realPts: string[] = [];
  const predPts: string[] = [];
  let idxCorte = -1;
  serie.forEach((s, i) => {
    const x = xOf(i);
    if (s.real !== null && s.real !== undefined) realPts.push(`${x},${yOf(s.real)}`);
    if (s.pred !== null && s.pred !== undefined) predPts.push(`${x},${yOf(s.pred)}`);
    if (idxCorte < 0 && s.real === null && s.pred !== null) idxCorte = i;
  });
  // Empalmar historia con forecast
  if (idxCorte > 0 && serie[idxCorte - 1].real !== null) {
    predPts.unshift(`${xOf(idxCorte - 1)},${yOf(serie[idxCorte - 1].real as number)}`);
  }
  const lineaCorteX = idxCorte >= 0 ? xOf(idxCorte) : null;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxV * f, y: yOf(maxV * f) }));
  const xLabels = serie.map((s, i) => ({ x: xOf(i), texto: formatMesCorto(s.fecha) }));
  const stepLabel = xLabels.length > 14 ? 2 : 1;

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:${PALETA.cardBg}; border:1px solid ${PALETA.borde}; border-radius:10px;">
      ${yTicks.map((t) => `
        <line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="${PALETA.borde}" stroke-width="0.5"/>
        <text x="${padL - 8}" y="${t.y + 3}" fill="${PALETA.text}" font-size="9" text-anchor="end">${fmtInt(Math.round(t.v))}</text>
      `).join("")}
      ${lineaCorteX !== null ? `
        <line x1="${lineaCorteX}" y1="${padT}" x2="${lineaCorteX}" y2="${padT + plotH}" stroke="${PALETA.text}" stroke-width="0.8" stroke-dasharray="3 3"/>
      ` : ""}
      ${realPts.length > 1 ? `<polyline fill="none" stroke="${PALETA.navy}" stroke-width="2.5" points="${realPts.join(" ")}"/>` : ""}
      ${predPts.length > 1 ? `<polyline fill="none" stroke="${PALETA.gold}" stroke-width="2.5" stroke-dasharray="5 4" points="${predPts.join(" ")}"/>` : ""}
      ${realPts.map((p) => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="1.8" fill="${PALETA.navy}"/>`; }).join("")}
      ${predPts.map((p) => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="1.8" fill="${PALETA.gold}"/>`; }).join("")}
      ${xLabels.filter((_, i) => i % stepLabel === 0).map((l) => `<text x="${l.x}" y="${H - padB + 18}" fill="${PALETA.text}" font-size="8" text-anchor="middle" transform="rotate(-35 ${l.x} ${H - padB + 18})">${l.texto}</text>`).join("")}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${PALETA.text}" stroke-width="0.6"/>
    </svg>`;

  const leyenda = `
    <p style="margin:10px 0 18px 0; font-size:10px; color:${PALETA.text};">
      <span style="display:inline-block; width:18px; height:2.5px; background:${PALETA.navy}; vertical-align:middle; margin-right:6px;"></span>Serie real
      <span style="display:inline-block; width:18px; height:2.5px; background:${PALETA.gold}; vertical-align:middle; margin:0 6px 0 18px; border-top:2px dashed ${PALETA.gold};"></span>Predicción Prophet
      <span style="display:inline-block; width:1px; height:12px; background:${PALETA.text}; vertical-align:middle; margin:0 6px 0 18px;"></span>Corte histórico/forecast
    </p>`;

  // Tabla alertas Motor 1
  const alertasFilas = r.alertasMotor1.length ? r.alertasMotor1.map((a, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : PALETA.cardBg};">
      <td style="padding:9px 12px; color:${PALETA.navy}; font-weight:600; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(a.tipo)}</td>
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(a.mes)}</td>
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; text-align:right; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(Math.round(a.valor))}</td>
      <td style="padding:9px 12px; color:${PALETA.text}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(a.recomendacion)}</td>
    </tr>`).join("") : `<tr><td colspan="4" style="padding:14px; text-align:center; color:${PALETA.text}; font-size:10px;">No se han detectado eventos relevantes en el horizonte de predicción.</td></tr>`;

  // Patron intramensual
  const patronFilas = r.patronSemanal.map((p) => `
    <tr style="border-bottom:1px solid ${PALETA.borde};">
      <td style="padding:9px 12px; text-transform:capitalize; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(p.dia)}</td>
      <td style="padding:9px 12px; text-align:right; font-weight:600; color:${PALETA.navy}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(p.pesoW, 3)}</td>
      <td style="padding:9px 12px; text-align:right; color:${PALETA.text}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(p.pctAprox, 1)}%</td>
    </tr>`).join("");

  return `
    <div>
      ${cabeceraSeccion(2, "Panorama nacional: análisis predictivo")}
      ${parrafoIntro(r.introPredictivo)}

      <h3 style="margin:4px 0 6px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Predicción Prophet — Próximos 6 meses</h3>
      ${svg}
      ${leyenda}

      <h3 style="margin:22px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Alertas automáticas (Motor 1)</h3>
      <table style="${TABLE_STYLE}">
        <thead style="${THEAD_STYLE}">
          <tr>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">TIPO</th>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MES AFECTADO</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">VALOR PREVISTO</th>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">RECOMENDACIÓN</th>
          </tr>
        </thead>
        <tbody>${alertasFilas}</tbody>
      </table>

      <h3 style="margin:22px 0 6px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Distribución intramensual de la demanda</h3>
      <p style="margin:0 0 10px 0; font-size:10px; color:${PALETA.text};">
        Pesos <code style="background:${PALETA.cardBg}; padding:1px 4px; border-radius:3px;">w_opt</code> del modelo MD agregados por día laborable (media sobre la serie completa), ordenados de mayor a menor peso.
      </p>
      <table style="${TABLE_STYLE} width:70%;">
        <thead style="${THEAD_STYLE}">
          <tr>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">DÍA</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">PESO w_opt MEDIO</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">% APROX.</th>
          </tr>
        </thead>
        <tbody>${patronFilas}</tbody>
      </table>
      <p style="margin:10px 0 0 0; font-size:11px; color:${PALETA.textDark};">
        La demanda se concentra especialmente los <strong style="color:${PALETA.navy}; text-transform:capitalize;">${escapeHtml(r.diasMayorPeso.join(" y "))}</strong>, acumulando aproximadamente el <strong style="color:${PALETA.gold};">${fmtDec(r.pctDiasMayor, 1)}%</strong> de las matriculaciones laborables.
      </p>
    </div>`;
}

// --- SECCION 3 ---------------------------------------------------------------
function htmlSeccion3(r: ResumenProvincia): string {
  const cuotaMax = Math.max(1, ...r.top10MarcasNacional.map((b) => b.cuota));
  const filas = r.top10MarcasNacional.map((b, i) => {
    const barW = (b.cuota / cuotaMax) * 100;
    return `
      <tr style="background:${i % 2 === 0 ? "#ffffff" : PALETA.cardBg}; border-bottom:1px solid ${PALETA.borde};">
        <td style="padding:9px 12px; color:${PALETA.text}; font-size:11px; width:32px; text-align:center; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${b.posicion}</td>
        <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(b.marca)}</td>
        <td style="padding:9px 12px; text-align:right; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(b.matriculaciones)}</td>
        <td style="padding:9px 12px; width:200px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle; color:${PALETA.textDark};">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="flex:1; height:7px; background:${PALETA.borde}; border-radius:4px; overflow:hidden;">
              <div style="width:${barW}%; height:100%; background:${PALETA.gold};"></div>
            </div>
            <span style="font-size:10px; font-weight:600; color:${PALETA.navy}; min-width:40px; text-align:right;">${fmtDec(b.cuota, 1)}%</span>
          </div>
        </td>
      </tr>`;
  }).join("");

  const crec = r.marcaMayorCrecimiento;
  const crecCard = crec ? `
    <div style="padding:18px 20px; background:${PALETA.navy}; border-radius:10px; color:#ffffff;">
      <p style="margin:0 0 6px 0; font-size:9px; color:${PALETA.gold}; letter-spacing:2px; font-weight:600;">MARCA DE MAYOR CRECIMIENTO INTERANUAL</p>
      <p style="margin:0; font-size:26px; font-weight:700; color:#ffffff;">${escapeHtml(crec.marca)}</p>
      <p style="margin:4px 0 0 0; font-size:18px; color:${PALETA.gold}; font-weight:600;">${crec.variacionPct >= 0 ? "+" : ""}${fmtDec(crec.variacionPct, 1)}%</p>
      <p style="margin:8px 0 0 0; font-size:10px; color:#CBD5E0; line-height:1.5;">
        Pasa de <strong style="color:#ffffff;">${fmtInt(crec.matAnioPrev)}</strong> matriculaciones en ${r.anio - 1} a <strong style="color:#ffffff;">${fmtInt(crec.matAnio)}</strong> en ${r.anio}. Este crecimiento sostenido sugiere una ganancia clara de cuota de mercado dentro del segmento.
      </p>
    </div>` : `
    <div style="padding:16px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.text}; border-radius:6px;">
      <p style="margin:0; font-size:11px; color:${PALETA.text};">Sin datos suficientes del año anterior para identificar la marca de mayor crecimiento.</p>
    </div>`;

  return `
    <div>
      ${cabeceraSeccion(3, "Análisis de mercado por marcas")}
      ${parrafoIntro(r.introMarcas)}

      <h3 style="margin:4px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Top 10 marcas nacionales — ${r.anio}</h3>
      <table style="${TABLE_STYLE}">
        <thead style="${THEAD_STYLE}">
          <tr>
            <th style="padding:10px 12px; text-align:center; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF; width:32px;">#</th>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MARCA</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MATRICULACIONES</th>
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">CUOTA DE MERCADO</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>

      <div style="margin-top:22px;">${crecCard}</div>
    </div>`;
}

// --- SECCION 4 ---------------------------------------------------------------
function htmlSeccion4(r: ResumenProvincia): string {
  // Grafico comparativo: prov (dorado) vs media nacional (navy punteada)
  const prov = r.serieMensualProv;
  const media = r.serieMensualMediaProv;
  const W = 700, H = 280;
  const padL = 70, padR = 20, padT = 20, padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(
    1,
    ...prov.map((s) => s.matriculaciones),
    ...media.map((s) => s.media)
  );
  const step = plotW / Math.max(1, prov.length - 1);
  const xOf = (i: number) => padL + i * step;
  const yOf = (v: number) => padT + plotH - (v / maxV) * plotH;
  const provPts = prov.map((s, i) => `${xOf(i)},${yOf(s.matriculaciones)}`);
  const mediaPts = media.map((s, i) => `${xOf(i)},${yOf(s.media)}`);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: maxV * f, y: yOf(maxV * f) }));
  const xLabels = prov.map((s, i) => ({ x: xOf(i), texto: MESES_ES[parseInt(s.fecha.slice(5, 7))]?.slice(0, 3) ?? "" }));

  const svg = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:${PALETA.cardBg}; border:1px solid ${PALETA.borde}; border-radius:10px;">
      ${yTicks.map((t) => `
        <line x1="${padL}" y1="${t.y}" x2="${W - padR}" y2="${t.y}" stroke="${PALETA.borde}" stroke-width="0.5"/>
        <text x="${padL - 8}" y="${t.y + 3}" fill="${PALETA.text}" font-size="9" text-anchor="end">${fmtInt(Math.round(t.v))}</text>
      `).join("")}
      ${mediaPts.length > 1 ? `<polyline fill="none" stroke="${PALETA.navy}" stroke-width="2" stroke-dasharray="5 4" points="${mediaPts.join(" ")}"/>` : ""}
      ${provPts.length > 1 ? `<polyline fill="none" stroke="${PALETA.gold}" stroke-width="2.5" points="${provPts.join(" ")}"/>` : ""}
      ${provPts.map((p) => { const [x, y] = p.split(","); return `<circle cx="${x}" cy="${y}" r="2" fill="${PALETA.gold}"/>`; }).join("")}
      ${xLabels.map((l) => `<text x="${l.x}" y="${H - padB + 18}" fill="${PALETA.text}" font-size="9" text-anchor="middle" text-transform="capitalize">${escapeHtml(l.texto)}</text>`).join("")}
      <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="${PALETA.text}" stroke-width="0.6"/>
    </svg>`;

  return `
    <div>
      ${cabeceraSeccion(4, `${r.provincia.toUpperCase()} — Posicionamiento provincial`)}
      ${parrafoIntro(r.introTerritorial)}

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px; margin-bottom:22px;">
        ${kpiCard("Total provincial", fmtInt(r.totalProvincial), `Año ${r.anio}`)}
        ${kpiCard("Ranking nacional", r.ranking > 0 ? `${r.ranking}º` : "—", `de ${r.totalProvincias} provincias`)}
        ${kpiCard("Ratio x1.000 hab.", fmtDec(r.ratioProv, 2), `Media nacional ${fmtDec(r.ratioNacional, 2)}`)}
        ${kpiCard("Desviación ratio", `${r.desvRatioPct >= 0 ? "+" : ""}${fmtDec(r.desvRatioPct, 1)}%`, "vs media nacional")}
      </div>

      <h3 style="margin:4px 0 4px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Evolución provincial vs media nacional — ${r.anio}</h3>
      <p style="margin:0 0 10px 0; font-size:10px; color:${PALETA.text};">
        <span style="display:inline-block; width:18px; height:3px; background:${PALETA.gold}; vertical-align:middle; margin-right:6px;"></span>${escapeHtml(r.provincia)}
        <span style="display:inline-block; width:18px; height:2px; background:${PALETA.navy}; vertical-align:middle; margin:0 6px 0 18px; border-top:2px dashed ${PALETA.navy};"></span>Media nacional por provincia
      </p>
      ${svg}
    </div>`;
}

// --- SECCION 5 ---------------------------------------------------------------
function htmlSeccion5(r: ResumenProvincia): string {
  const cuotaMax = Math.max(1, ...r.top10MarcasProv.map((b) => b.cuota));
  const filas = r.top10MarcasProv.map((b, i) => {
    const barW = (b.cuota / cuotaMax) * 100;
    const diff = b.diff;
    const diffHtml = b.posicionNac < 0
      ? `<span style="color:${PALETA.text};">—</span>`
      : diff > 0
        ? `<span style="color:${PALETA.exito}; font-weight:700;">▲ ${diff}</span>`
        : diff < 0
        ? `<span style="color:${PALETA.peligro}; font-weight:700;">▼ ${Math.abs(diff)}</span>`
        : `<span style="color:${PALETA.text};">=</span>`;
    return `
      <tr style="background:${i % 2 === 0 ? "#ffffff" : PALETA.cardBg}; border-bottom:1px solid ${PALETA.borde};">
        <td style="padding:9px 12px; color:${PALETA.text}; font-size:11px; width:30px; text-align:center; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${b.posicionProv}</td>
        <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(b.marca)}</td>
        <td style="padding:9px 12px; text-align:right; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(b.matriculaciones)}</td>
        <td style="padding:9px 12px; width:160px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle; color:${PALETA.textDark};">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="flex:1; height:7px; background:${PALETA.borde}; border-radius:4px; overflow:hidden;">
              <div style="width:${barW}%; height:100%; background:${PALETA.gold};"></div>
            </div>
            <span style="font-size:10px; font-weight:600; color:${PALETA.navy}; min-width:38px; text-align:right;">${fmtDec(b.cuota, 1)}%</span>
          </div>
        </td>
        <td style="padding:9px 12px; text-align:center; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle; color:${PALETA.textDark};">${diffHtml}</td>
      </tr>`;
  }).join("");

  return `
    <div>
      ${cabeceraSeccion(5, `${r.provincia.toUpperCase()} — Estructura de mercado provincial`)}

      <h3 style="margin:4px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Top 10 marcas en ${escapeHtml(r.provincia)} — ${r.anio}</h3>
      ${r.top10MarcasProv.length === 0 ? `
        <div style="padding:16px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.text}; border-radius:6px;">
          <p style="margin:0; font-size:11px; color:${PALETA.text};">No se encontraron datos de marcas para esta provincia en el año analizado.</p>
        </div>
      ` : `
        <table style="${TABLE_STYLE}">
          <thead style="${THEAD_STYLE}">
            <tr>
              <th style="padding:10px 12px; text-align:center; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF; width:30px;">#</th>
              <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MARCA</th>
              <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MATRICULACIONES</th>
              <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">CUOTA PROV.</th>
              <th style="padding:10px 12px; text-align:center; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">DIF. vs RANKING NAC.</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      `}

      <p style="margin:18px 0 0 0; padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.gold}; border-radius:6px; font-size:11px; line-height:1.55; color:${PALETA.textDark};">
        ${r.interpretacionMixMarcas}
      </p>

      ${htmlSubseccionGruposEmpresariales(r)}
    </div>`;
}

// --- SUBSECCION grupos empresariales (dentro de Seccion 5) -------------------
function htmlSubseccionGruposEmpresariales(r: ResumenProvincia): string {
  if (!r.gruposProv || r.gruposProv.length === 0) {
    return `
      <h3 style="margin:22px 0 8px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Análisis por grupo empresarial</h3>
      <p style="margin:0; font-size:11px; color:${PALETA.text};">Sin datos suficientes para consolidar grupos en esta provincia.</p>
    `;
  }
  const filas = r.gruposProv.map((g, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : PALETA.cardBg}; border-bottom:1px solid ${PALETA.borde};">
      <td style="padding:9px 12px; color:${PALETA.text}; font-size:11px; width:30px; text-align:center; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${i + 1}</td>
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(g.grupo)}</td>
      <td style="padding:9px 12px; text-align:right; color:${PALETA.textDark}; font-size:11px; font-weight:600; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(g.total)}</td>
      <td style="padding:9px 12px; text-align:right; font-size:11px; font-weight:700; color:${PALETA.navy}; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(g.cuota, 1)}%</td>
    </tr>`).join("");
  return `
    <h3 style="margin:22px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Análisis por grupo empresarial</h3>
    <table style="${TABLE_STYLE}">
      <thead style="${THEAD_STYLE}">
        <tr>
          <th style="padding:10px 12px; text-align:center; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF; width:30px;">#</th>
          <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">GRUPO</th>
          <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MATRICULACIONES</th>
          <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">CUOTA</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="margin:14px 0 0 0; padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.navy}; border-radius:6px; font-size:11px; line-height:1.55; color:${PALETA.textDark};">
      ${r.interpretacionGruposProv}
    </p>`;
}

// --- SECCION 6 ---------------------------------------------------------------
function htmlSeccion6(r: ResumenProvincia): string {
  const filaRatio = r.municipiosRatioDesc.slice(0, 20).map((m, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : PALETA.cardBg}; border-bottom:1px solid ${PALETA.borde};">
      <td style="padding:9px 12px; color:${PALETA.text}; width:30px; font-size:11px; text-align:center; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${i + 1}</td>
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(m.municipio)}</td>
      <td style="padding:9px 12px; text-align:right; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(m.matriculaciones)}</td>
      <td style="padding:9px 12px; text-align:right; font-weight:700; color:${PALETA.gold}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(m.ratio_x1000, 2)}</td>
    </tr>`).join("");

  const topVol = r.municipiosVolumenDesc.slice(0, 5).map((m) => `
    <tr style="border-bottom:1px solid ${PALETA.borde};">
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(m.municipio)}</td>
      <td style="padding:9px 12px; text-align:right; font-weight:700; color:${PALETA.navy}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(m.matriculaciones)}</td>
      <td style="padding:9px 12px; text-align:right; color:${PALETA.text}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(m.ratio_x1000, 2)}</td>
    </tr>`).join("");

  const bottomRatio = r.municipiosRatioAscFiltrado.slice(0, 5).map((m) => `
    <tr style="border-bottom:1px solid ${PALETA.borde};">
      <td style="padding:9px 12px; color:${PALETA.textDark}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${escapeHtml(m.municipio)}</td>
      <td style="padding:9px 12px; text-align:right; color:${PALETA.text}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtInt(m.matriculaciones)}</td>
      <td style="padding:9px 12px; text-align:right; font-weight:700; color:${PALETA.peligro}; font-size:11px; border-bottom:1px solid ${PALETA.borde}; vertical-align:middle;">${fmtDec(m.ratio_x1000, 2)}</td>
    </tr>`).join("");

  const nota = r.anioMapa !== String(r.anio)
    ? `<p style="margin:0 0 14px 0; padding:10px 14px; background:#fef3c7; border-left:3px solid ${PALETA.aviso}; border-radius:6px; font-size:10px; color:${PALETA.textDark};">
        Datos municipales de <strong>${r.anioMapa}</strong> (últimos publicados en df_mapa_densidad). El resto del informe analiza ${r.anio}.
      </p>` : "";

  return `
    <div>
      ${cabeceraSeccion(6, `${r.provincia.toUpperCase()} — Distribución municipal`)}
      ${nota}

      <h3 style="margin:4px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Top 20 municipios por ratio per cápita</h3>
      ${r.municipiosRatioDesc.length === 0 ? `
        <div style="padding:16px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.text}; border-radius:6px;">
          <p style="margin:0; font-size:11px; color:${PALETA.text};">Sin datos municipales disponibles para esta provincia.</p>
        </div>
      ` : `
        <table style="${TABLE_STYLE} margin-bottom:28px;">
          <thead style="${THEAD_STYLE}">
            <tr>
              <th style="padding:10px 12px; text-align:center; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF; width:30px;">#</th>
              <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MUNICIPIO</th>
              <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">MATRICULACIONES</th>
              <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">RATIO x1.000</th>
            </tr>
          </thead>
          <tbody>${filaRatio}</tbody>
        </table>
      `}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div>
          <h4 style="margin:0 0 8px 0; font-size:12px; color:${PALETA.navy}; font-weight:600;">Núcleos de alta actividad</h4>
          <p style="margin:0 0 10px 0; font-size:9px; color:${PALETA.text};">Top 5 por volumen absoluto</p>
          <table style="${TABLE_STYLE}">
            <thead style="background-color:#F7F7F5; color:${PALETA.navy};">
              <tr>
                <th style="padding:9px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">MUNICIPIO</th>
                <th style="padding:9px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">VOL.</th>
                <th style="padding:9px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">RATIO</th>
              </tr>
            </thead>
            <tbody>${topVol || `<tr><td colspan="3" style="padding:10px; text-align:center; color:${PALETA.text}; font-size:10px;">—</td></tr>`}</tbody>
          </table>
        </div>
        <div>
          <h4 style="margin:0 0 8px 0; font-size:12px; color:${PALETA.peligro}; font-weight:600;">Zonas de baja penetración</h4>
          <p style="margin:0 0 10px 0; font-size:9px; color:${PALETA.text};">Top 5 menor ratio (min. 5 matriculaciones)</p>
          <table style="${TABLE_STYLE}">
            <thead style="background-color:#F7F7F5; color:${PALETA.navy};">
              <tr>
                <th style="padding:9px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">MUNICIPIO</th>
                <th style="padding:9px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">VOL.</th>
                <th style="padding:9px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:${PALETA.navy};">RATIO</th>
              </tr>
            </thead>
            <tbody>${bottomRatio || `<tr><td colspan="3" style="padding:10px; text-align:center; color:${PALETA.text}; font-size:10px;">—</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

// --- SECCION 7 ---------------------------------------------------------------
function htmlSeccion7(r: ResumenProvincia): string {
  const hayAnomalias = r.anomaliasConfirmadas.length > 0 || r.anomaliasPotenciales.length > 0;

  const conf = r.anomaliasConfirmadas.map((m) => `
    <div style="padding:14px 16px; background:#fef2f2; border:1px solid #fecaca; border-left:4px solid ${PALETA.peligro}; border-radius:8px; margin-bottom:10px;">
      <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:${PALETA.peligro};">⚠ ${escapeHtml(m)}</p>
      <p style="margin:0; font-size:10px; color:${PALETA.textDark}; line-height:1.5;">
        Municipio con bonificación IVTM documentada — el volumen de matriculaciones no refleja demanda orgánica local. No recomendado como referencia para decisiones de inversión o apertura de delegaciones.
      </p>
    </div>`).join("");

  const pot = r.anomaliasPotenciales.map((a) => `
    <div style="padding:14px 16px; background:#fffbeb; border:1px solid #fed7aa; border-left:4px solid ${PALETA.aviso}; border-radius:8px; margin-bottom:10px;">
      <p style="margin:0 0 4px 0; font-size:12px; font-weight:700; color:${PALETA.aviso};">⚠ ${escapeHtml(a.municipio)}</p>
      <p style="margin:0; font-size:10px; color:${PALETA.textDark}; line-height:1.5;">
        Ratio significativamente superior a la mediana provincial (${fmtDec(a.ratio, 2)} vs mediana ${fmtDec(a.mediana, 2)}, factor ${fmtDec(a.factor, 1)}×). Recomendado verificar origen de la demanda antes de tomar decisiones de inversión.
      </p>
    </div>`).join("");

  const sinAnomalias = `
    <div style="padding:14px 16px; background:#ecfdf5; border:1px solid #bbf7d0; border-left:4px solid ${PALETA.exito}; border-radius:8px;">
      <p style="margin:0; font-size:11px; color:${PALETA.textDark};">✓ No se han detectado anomalías territoriales en esta provincia.</p>
    </div>`;

  return `
    <div>
      ${cabeceraSeccion(7, "Detector de anomalías y recomendaciones")}

      <h3 style="margin:4px 0 10px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Anomalías territoriales</h3>
      ${!hayAnomalias ? sinAnomalias : `
        ${r.anomaliasConfirmadas.length ? `<p style="margin:4px 0 8px 0; font-size:11px; color:${PALETA.peligro}; font-weight:600;">Anomalías confirmadas</p>${conf}` : ""}
        ${r.anomaliasPotenciales.length ? `<p style="margin:16px 0 8px 0; font-size:11px; color:${PALETA.aviso}; font-weight:600;">Anomalías potenciales</p>${pot}` : ""}
      `}

      <h3 style="margin:26px 0 12px 0; font-size:13px; font-weight:600; color:${PALETA.navy};">Conclusiones ejecutivas</h3>

      <div style="padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.navy}; border-radius:6px; margin-bottom:10px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${PALETA.navy}; letter-spacing:1px;">POSICIONAMIENTO</p>
        <p style="margin:0; font-size:11px; line-height:1.55; color:${PALETA.textDark};">${r.conclusionPosicionamiento}</p>
      </div>

      <div style="padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.gold}; border-radius:6px; margin-bottom:10px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${PALETA.gold}; letter-spacing:1px;">TENDENCIA</p>
        <p style="margin:0; font-size:11px; line-height:1.55; color:${PALETA.textDark};">${r.conclusionTendencia}</p>
      </div>

      <div style="padding:14px 18px; background:${PALETA.cardBg}; border-left:3px solid ${PALETA.aviso}; border-radius:6px; margin-bottom:20px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${PALETA.aviso}; letter-spacing:1px;">TERRITORIAL</p>
        <p style="margin:0; font-size:11px; line-height:1.55; color:${PALETA.textDark};">${r.conclusionTerritorial}</p>
      </div>

      <div style="padding:20px 22px; background:${PALETA.navy}; border-radius:10px; color:#ffffff;">
        <p style="margin:0 0 8px 0; font-size:10px; color:${PALETA.gold}; letter-spacing:2px; font-weight:600;">RECOMENDACIÓN ACCIONABLE PRINCIPAL</p>
        <p style="margin:0; font-size:14px; font-weight:500; line-height:1.55; color:#ffffff;">${r.recomendacion}</p>
      </div>
    </div>`;
}

// --- SECCION 8 — Score Territorial de Oportunidad ---------------------------
function htmlSeccion8(r: ResumenProvincia): string {
  if (!r.scoreInfo) {
    return `
      <div>
        ${cabeceraSeccion(8, "Score Territorial de Oportunidad")}
        <p style="margin:0; font-size:11px; color:${PALETA.text};">No se ha podido calcular el score territorial para esta provincia.</p>
      </div>`;
  }

  const s = r.scoreInfo.row;
  const media = r.scoreInfo.mediaNacional;
  const total = r.scoreInfo.totalProvincias;

  const nivel = s.score_final >= 66 ? "alto" : s.score_final >= 33 ? "medio" : "bajo";
  const nivelColor = s.score_final >= 66 ? PALETA.exito : s.score_final >= 33 ? PALETA.aviso : PALETA.peligro;
  const vsMedia = s.score_final >= media ? "por encima" : "por debajo";

  const barra = (label: string, valor: number, color: string) => `
    <div style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; font-size:10px; color:${PALETA.text}; margin-bottom:4px;">
        <span style="font-weight:600; color:${PALETA.navy};">${escapeHtml(label)}</span>
        <span style="font-weight:700; color:${PALETA.navy};">${fmtDec(valor, 1)} / 100</span>
      </div>
      <div style="width:100%; height:10px; background:${PALETA.borde}; border-radius:6px; overflow:hidden;">
        <div style="width:${Math.max(0, Math.min(100, valor))}%; height:100%; background:${color}; border-radius:6px;"></div>
      </div>
    </div>`;

  const penalizacionHtml = s.penalizacion_ivtm > 0
    ? `
      <div style="margin-top:14px; padding:12px 14px; background:#fef2f2; border:1px solid #fecaca; border-left:4px solid ${PALETA.peligro}; border-radius:8px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${PALETA.peligro}; letter-spacing:1px;">PENALIZACIÓN IVTM</p>
        <p style="margin:0; font-size:11px; color:${PALETA.textDark};">
          Se han aplicado <strong>-${fmtDec(s.penalizacion_ivtm, 1)} puntos</strong> por anomalías territoriales detectadas
          ${s.anomalias_confirmadas.length ? ` (${s.anomalias_confirmadas.length} confirmada${s.anomalias_confirmadas.length > 1 ? "s" : ""})` : ""}
          ${s.anomalias_potenciales.length ? `${s.anomalias_confirmadas.length ? " y" : ""} ${s.anomalias_potenciales.length} potencial${s.anomalias_potenciales.length > 1 ? "es" : ""}` : ""}.
        </p>
      </div>`
    : "";

  return `
    <div>
      ${cabeceraSeccion(8, "Score Territorial de Oportunidad")}

      ${parrafoIntro(`El Score Territorial sintetiza <strong>demanda per cápita</strong>, <strong>tamaño de mercado</strong> y <strong>tendencia interanual</strong> en un único indicador comparable entre las ${total} provincias del territorio nacional.`)}

      <div style="display:grid; grid-template-columns:1fr 1.2fr; gap:18px; margin-bottom:18px;">
        <div style="padding:22px 24px; background:${PALETA.navy}; color:#ffffff; border-radius:12px; text-align:center;">
          <p style="margin:0 0 6px 0; font-size:10px; color:${PALETA.gold}; letter-spacing:2px; font-weight:600;">SCORE FINAL</p>
          <p style="margin:0; font-size:56px; font-weight:700; line-height:1; color:${PALETA.gold};">${fmtDec(s.score_final, 1)}</p>
          <p style="margin:6px 0 12px 0; font-size:10px; color:#cbd5e0;">sobre 100</p>
          <p style="margin:0; font-size:11px; color:#ffffff;">Posición <strong style="color:${PALETA.gold};">${s.ranking}</strong> de ${total} provincias</p>
        </div>

        <div style="padding:18px 20px; background:${PALETA.cardBg}; border:1px solid ${PALETA.borde}; border-radius:12px;">
          <p style="margin:0 0 14px 0; font-size:11px; font-weight:600; color:${PALETA.navy};">Dimensiones normalizadas</p>
          ${barra("Demanda (ratio medio)", s.score_demanda, PALETA.navy)}
          ${barra("Mercado (volumen)", s.score_mercado, PALETA.gold)}
          ${barra("Tendencia (crecimiento interanual)", s.score_tendencia, PALETA.exito)}
        </div>
      </div>

      ${penalizacionHtml}

      <div style="margin-top:18px; padding:16px 18px; background:${PALETA.cardBg}; border-left:3px solid ${nivelColor}; border-radius:6px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${nivelColor}; letter-spacing:1px;">INTERPRETACIÓN</p>
        <p style="margin:0; font-size:11px; line-height:1.55; color:${PALETA.textDark};">
          Con un score de <strong style="color:${PALETA.navy};">${fmtDec(s.score_final, 1)}</strong> sobre 100,
          <strong>${escapeHtml(r.provincia)}</strong> se posiciona como un mercado
          <strong style="color:${nivelColor};">${nivel} potencial</strong> dentro del territorio nacional,
          <strong>${vsMedia}</strong> de la media nacional (${fmtDec(media, 1)}).
        </p>
      </div>
    </div>`;
}

// ============================================================================
// SECCION ESCENARIOS (opcional, solo si hay simulador activo)
// ============================================================================

function htmlSeccionEscenarios(
  eventos: EventoCatalogo[],
  filas: PrediccionEscenarioRow[],
): string {
  const N = eventos.length;
  const factor = factorAmortiguacion(N);

  // Forecast rows (con ambas predicciones)
  const fc = filas.filter(
    (r) => r.pred_prophet !== null && r.pred_escenario !== null,
  );
  const prox6 = fc.slice(0, 6);

  // Impacto acumulado y variación media
  let acumulado = 0;
  let sumaPct = 0;
  let cnt = 0;
  for (const r of fc) {
    const diff = (r.pred_escenario as number) - (r.pred_prophet as number);
    acumulado += diff;
    if ((r.pred_prophet as number) !== 0) {
      sumaPct += (diff / (r.pred_prophet as number)) * 100;
      cnt++;
    }
  }
  const variacionPct = cnt > 0 ? sumaPct / cnt : 0;
  const signo = acumulado >= 0 ? "positivo" : "negativo";
  const signoColor = acumulado >= 0 ? PALETA.exito : PALETA.peligro;

  const listaEventos = eventos
    .map((ev) => {
      const col = ev.signo === "positivo" ? PALETA.exito : PALETA.peligro;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:${PALETA.cardBg}; border-left:3px solid ${col}; border-radius:6px; margin-bottom:8px;">
          <div>
            <p style="margin:0; font-size:11px; font-weight:600; color:${PALETA.navy};">${escapeHtml(ev.nombre)}</p>
            <p style="margin:2px 0 0 0; font-size:10px; color:${PALETA.text};">${escapeHtml(ev.duracionLabel)}</p>
          </div>
          <span style="font-size:11px; font-weight:700; color:${col};">${escapeHtml(ev.impactoLabel)}</span>
        </div>`;
    })
    .join("");

  const filasTabla = prox6
    .map((r) => {
      const base = Math.round(r.pred_prophet as number);
      const esc = Math.round(r.pred_escenario as number);
      const diff = esc - base;
      const pct = base !== 0 ? (diff / base) * 100 : 0;
      const col = diff >= 0 ? PALETA.exito : PALETA.peligro;
      return `
        <tr>
          <td style="padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; font-size:11px; color:${PALETA.textDark}; vertical-align:middle;">${escapeHtml(formatMesAnio(r.fecha_mes))}</td>
          <td style="padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; font-size:11px; text-align:right; color:${PALETA.textDark}; font-variant-numeric:tabular-nums; vertical-align:middle;">${fmtInt(base)}</td>
          <td style="padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; font-size:11px; text-align:right; font-weight:600; color:${PALETA.gold}; font-variant-numeric:tabular-nums; vertical-align:middle;">${fmtInt(esc)}</td>
          <td style="padding:9px 12px; border-bottom:1px solid ${PALETA.borde}; font-size:11px; text-align:right; font-weight:600; color:${col}; font-variant-numeric:tabular-nums; vertical-align:middle;">${diff >= 0 ? "+" : ""}${fmtInt(diff)} (${diff >= 0 ? "+" : ""}${fmtDec(pct, 1)}%)</td>
        </tr>`;
    })
    .join("");

  return `
    <div>
      ${cabeceraSeccion(9, "Análisis de Escenarios")}

      ${parrafoIntro(`Simulación del efecto combinado de <strong>${N}</strong> evento${N === 1 ? "" : "s"} macroeconómico${N === 1 ? "" : "s"} sobre la predicción Prophet. Factor de amortiguación aplicado: <strong>${fmtDec(factor * 100, 0)}%</strong>.`)}

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:18px;">
        <div>
          <p style="margin:0 0 10px 0; font-size:11px; font-weight:600; color:${PALETA.navy};">Eventos activos</p>
          ${listaEventos}
        </div>

        <div style="padding:18px 20px; background:${PALETA.navy}; color:#ffffff; border-radius:12px;">
          <p style="margin:0 0 6px 0; font-size:10px; color:${PALETA.gold}; letter-spacing:2px; font-weight:600;">IMPACTO NETO COMBINADO</p>
          <p style="margin:0; font-size:38px; font-weight:700; line-height:1; color:${PALETA.gold};">${acumulado >= 0 ? "+" : ""}${fmtInt(Math.round(acumulado))}</p>
          <p style="margin:6px 0 14px 0; font-size:10px; color:#cbd5e0;">matriculaciones sobre el horizonte</p>
          <p style="margin:0; font-size:11px; color:#ffffff;">Variación media mensual: <strong style="color:${PALETA.gold};">${variacionPct >= 0 ? "+" : ""}${fmtDec(variacionPct, 2)}%</strong></p>
        </div>
      </div>

      <p style="margin:0 0 8px 0; font-size:11px; font-weight:600; color:${PALETA.navy};">Próximos 6 meses — predicción base vs. escenario</p>
      <table style="${TABLE_STYLE} margin-bottom:18px;">
        <thead>
          <tr style="background:${PALETA.cardBg};">
            <th style="padding:10px 12px; text-align:left; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">Mes</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">Base (Prophet)</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">Escenario</th>
            <th style="padding:10px 12px; text-align:right; font-size:10px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; border:none; color:#FFFFFF;">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          ${filasTabla}
        </tbody>
      </table>

      <div style="padding:16px 18px; background:${PALETA.cardBg}; border-left:3px solid ${signoColor}; border-radius:6px;">
        <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; color:${signoColor}; letter-spacing:1px;">INTERPRETACIÓN</p>
        <p style="margin:0; font-size:11px; line-height:1.55; color:${PALETA.textDark};">
          Bajo el escenario simulado, se estima un impacto <strong style="color:${signoColor};">${signo}</strong> de
          <strong>${acumulado >= 0 ? "+" : ""}${fmtInt(Math.round(acumulado))}</strong> matriculaciones sobre el horizonte de predicción,
          representando una variación del <strong>${variacionPct >= 0 ? "+" : ""}${fmtDec(variacionPct, 2)}%</strong>
          respecto a la predicción base.
        </p>
      </div>
    </div>`;
}

// Helper local para formatear "YYYY-MM-..." como "mes YYYY" (sección escenarios)
function formatMesAnio(fecha: string): string {
  const [y, m] = fecha.split("-");
  const idx = Math.max(1, Math.min(12, Number(m)));
  return `${MESES_ES[idx]} ${y}`;
}

// ============================================================================
// ORQUESTADOR PRINCIPAL
// ============================================================================

export async function generarInformeTerritorial(
  provincia: string,
  onProgreso?: ProgresoCallback
): Promise<void> {
  const progreso = onProgreso ?? (() => {});

  progreso(SECCIONES_PROGRESO[0]); // Cargando datos nacionales...
  const [mapRows, monthly, predicciones, daily, brandRows, provLookup] = await Promise.all([
    cargarMapaDensidad(),
    cargarMonthlyTotal(),
    cargarPredicciones(),
    cargarDiario(),
    cargarMarcasNacional(),
    cargarGeoJsonProvincias(),
  ]);

  // Anio objetivo: desempate más reciente
  const countByYear = new Map<number, number>();
  for (const r of monthly) countByYear.set(r.Ano, (countByYear.get(r.Ano) ?? 0) + 1);
  let anioObj = 0, maxCount = -1;
  for (const [ano, cnt] of countByYear) {
    if (cnt > maxCount || (cnt === maxCount && ano > anioObj)) {
      maxCount = cnt; anioObj = ano;
    }
  }
  if (!anioObj) throw new Error("No se pudo determinar el año a analizar en df_mensual_agrupado.csv.");

  // Anio territorial (mapa_densidad): año valido más reciente
  const yearsValidosMapa = [...new Set(mapRows
    .map((r) => r.fecha.slice(0, 4))
    .filter((y) => /^\d{4}$/.test(y))
  )].sort();
  const anioMapa = yearsValidosMapa.includes(String(anioObj))
    ? String(anioObj)
    : yearsValidosMapa[yearsValidosMapa.length - 1] ?? String(anioObj);

  progreso(SECCIONES_PROGRESO[1]); // Generando panorama historico...

  // Panorama nacional: todo el historico
  const monthlyNacional = monthly
    .map((m) => ({
      fecha: `${m.Ano}-${String(m.Mes).padStart(2, "0")}-01`,
      matriculaciones: m.Turismos,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // KPIs nacionales (año objetivo)
  const totalAnio = monthly.filter((m) => m.Ano === anioObj).reduce((s, m) => s + m.Turismos, 0);
  const totalAnioPrev = monthly.filter((m) => m.Ano === anioObj - 1).reduce((s, m) => s + m.Turismos, 0);
  const variacionPct = totalAnioPrev > 0 ? ((totalAnio - totalAnioPrev) / totalAnioPrev) * 100 : 0;
  const mesesAnio = monthly.filter((m) => m.Ano === anioObj);
  const mesPico = mesesAnio.length
    ? mesesAnio.reduce((a, b) => (b.Turismos > a.Turismos ? b : a))
    : null;

  const introNacional = `El mercado automovilístico español registró <strong style="color:${PALETA.navy};">${fmtInt(totalAnio)}</strong> matriculaciones en <strong>${anioObj}</strong>, lo que representa una variación del <strong style="color:${variacionPct >= 0 ? PALETA.exito : PALETA.peligro};">${variacionPct >= 0 ? "+" : ""}${fmtDec(variacionPct, 1)}%</strong> respecto al año anterior. ${mesPico ? `El mes de mayor demanda fue <strong style="color:${PALETA.gold};">${escapeHtml(MESES_ES[mesPico.Mes] ?? "")}</strong> con <strong>${fmtInt(mesPico.Turismos)}</strong> matriculaciones.` : ""}`;

  progreso(SECCIONES_PROGRESO[2]); // Calculando predicciones...

  // Predicciones: ultimos 12 meses historicos + 6 meses forecast
  const historicos = predicciones.filter((p) => p.real !== null);
  const futuros = predicciones.filter((p) => p.real === null && (p.pred_prophet ?? p.prediccion) !== null);
  const forecastSerie = [
    ...historicos.slice(-12).map((p) => ({ fecha: p.fecha_mes, real: p.real, pred: null as number | null })),
    ...futuros.slice(0, 6).map((p) => ({ fecha: p.fecha_mes, real: null as number | null, pred: p.pred_prophet ?? p.prediccion })),
  ];

  const alertasMotor1 = calcularAlertasMotor1(predicciones);

  // Intro predictivo - usando alerta de tendencia + pico
  const alertaTendencia = alertasMotor1.find((a) => a.tipo === "Tendencia");
  const alertaPico = alertasMotor1.find((a) => a.tipo === "Pico");
  let direccion = "estable";
  if (alertaTendencia) {
    if (alertaTendencia.recomendacion.includes("Crecimiento")) direccion = "alcista";
    else if (alertaTendencia.recomendacion.includes("Contracción")) direccion = "bajista";
  }
  const introPredictivo = `El modelo Prophet proyecta para los próximos 6 meses una tendencia <strong style="color:${direccion === "alcista" ? PALETA.exito : direccion === "bajista" ? PALETA.peligro : PALETA.gold};">${direccion}</strong>${alertaPico ? `, con una previsión de <strong style="color:${PALETA.navy};">${fmtInt(Math.round(alertaPico.valor))}</strong> matriculaciones en <strong>${escapeHtml(alertaPico.mes)}</strong> como punto máximo del horizonte analizado` : ""}.`;

  // Patron intramensual
  const patronSemanal = calcularPatronSemanal(daily);
  const diasMayorPeso = patronSemanal.slice(0, 2).map((p) => p.dia);
  const pctDiasMayor = patronSemanal.slice(0, 2).reduce((s, p) => s + p.pctAprox, 0);

  progreso(SECCIONES_PROGRESO[3]); // Analizando mercado de marcas...

  // HHI + top 10 + crecimiento nacional
  const { hhi, interp: hhiInterp, top10: top10Nacional, totalAnio: totalMarcas } = calcularHHI(brandRows, anioObj);
  const introMarcas = `Sobre un universo analizado de <strong style="color:${PALETA.navy};">${fmtInt(totalMarcas)}</strong> matriculaciones repartidas entre todas las marcas registradas en ${anioObj}, el índice de concentración Herfindahl-Hirschman (HHI) alcanza un valor de <strong style="color:${PALETA.gold};">${fmtInt(Math.round(hhi))}</strong>, lo que indica un <strong>${hhiInterp}</strong>.`;
  const marcaMayorCrecimiento = calcularMayorCrecimiento(brandRows, anioObj);

  progreso(SECCIONES_PROGRESO[4]); // Procesando datos provinciales...

  const muniIdx = construirIndiceMunicipios(mapRows, provLookup);
  if (!muniIdx.byProvincia.has(provincia)) {
    throw new Error(`Provincia no encontrada en el índice: ${provincia}`);
  }

  const filtrado = await streamMarcaLugar(provincia, anioObj, anioMapa, muniIdx, progreso);

  // Totales nacionales y media por provincia (del año objetivo)
  const numProv = provLookup.size || 52;
  const mediaNacional = totalAnio / numProv;

  // Serie mensual provincial (año objetivo)
  const serieMensualProv: { fecha: string; matriculaciones: number }[] = [];
  const serieMensualMediaProv: { fecha: string; media: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${anioObj}-${String(m).padStart(2, "0")}-01`;
    serieMensualProv.push({ fecha: key, matriculaciones: filtrado.serieMensual.get(key) ?? 0 });
    // Media = total nacional mes / num provincias
    const totalMes = filtrado.serieNacionalTotal.get(key) ?? 0;
    serieMensualMediaProv.push({ fecha: key, media: totalMes / numProv });
  }

  // Top 10 marcas provinciales + ranking diff
  const top10Prov = [...filtrado.marcaTotal.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const nacRanking = new Map<string, number>();
  {
    const totales = new Map<string, number>();
    for (const r of brandRows) {
      if (r.ano !== anioObj) continue;
      totales.set(r.marca, (totales.get(r.marca) ?? 0) + r.matriculaciones);
    }
    [...totales.entries()].sort((a, b) => b[1] - a[1]).forEach(([m], i) => nacRanking.set(m, i + 1));
  }
  const top10MarcasProv = top10Prov.map(([marca, matriculaciones], i) => {
    const posNac = nacRanking.get(marca) ?? -1;
    const posProv = i + 1;
    return {
      marca,
      matriculaciones,
      cuota: filtrado.totalProv > 0 ? (matriculaciones / filtrado.totalProv) * 100 : 0,
      posicionProv: posProv,
      posicionNac: posNac,
      diff: posNac > 0 ? posNac - posProv : 0, // positivo: sube en la provincia
    };
  });

  // ── Consolidacion por grupo empresarial (provincia) ──
  const gruposAcum = new Map<string, number>();
  for (const [marca, total] of filtrado.marcaTotal) {
    const g = getGrupo(marca);
    gruposAcum.set(g, (gruposAcum.get(g) ?? 0) + total);
  }
  const totalProvGrupos = [...gruposAcum.values()].reduce((s, v) => s + v, 0);
  const gruposProv = [...gruposAcum.entries()]
    .map(([grupo, total]) => ({
      grupo,
      total,
      cuota: totalProvGrupos > 0 ? (total / totalProvGrupos) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  let interpretacionGruposProv = "";
  if (gruposProv.length === 0) {
    interpretacionGruposProv = `No se han podido consolidar grupos empresariales para ${escapeHtml(provincia)} en este período.`;
  } else {
    const g1 = gruposProv[0];
    const g2 = gruposProv[1];
    const top3 = gruposProv.slice(0, 3).reduce((s, g) => s + g.cuota, 0);
    // Tres categorías: concentrado >=60, moderadamente concentrado 45-60, competitivo <45.
    const tipoMercado =
      top3 >= 60 ? "concentrado"
      : top3 >= 45 ? "moderadamente concentrado"
      : "competitivo";
    const colorMercado =
      top3 >= 60 ? PALETA.peligro
      : top3 >= 45 ? PALETA.aviso
      : PALETA.exito;
    interpretacionGruposProv =
      `El mercado de <strong>${escapeHtml(provincia)}</strong> está liderado por ` +
      `<strong style="color:${PALETA.navy};">${escapeHtml(g1.grupo)}</strong> ` +
      `con una cuota del <strong>${fmtDec(g1.cuota, 1)}%</strong>` +
      (g2 ? `, seguido de <strong>${escapeHtml(g2.grupo)}</strong> con <strong>${fmtDec(g2.cuota, 1)}%</strong>` : "") +
      `. Los tres primeros grupos concentran el <strong>${fmtDec(top3, 1)}%</strong> del mercado provincial, ` +
      `configurando un mercado <strong style="color:${colorMercado};">${tipoMercado}</strong>.`;
  }

  const liderProv = top10MarcasProv[0];
  const liderNac = [...nacRanking.entries()].find(([, p]) => p === 1)?.[0] ?? "";
  const interpretacionMixMarcas = !liderProv
    ? `No hay datos suficientes de marcas para generar una interpretación provincial en ${escapeHtml(provincia)}.`
    : liderProv.marca === liderNac
    ? `En <strong>${escapeHtml(provincia)}</strong>, <strong style="color:${PALETA.navy};">${escapeHtml(liderProv.marca)}</strong> ocupa la primera posición, coincidiendo con el líder nacional, lo que sugiere <strong>alineación con las tendencias de mercado globales</strong>.`
    : `En <strong>${escapeHtml(provincia)}</strong>, <strong style="color:${PALETA.navy};">${escapeHtml(liderProv.marca)}</strong> ocupa la primera posición frente a <strong>${escapeHtml(liderNac)}</strong> a nivel nacional, lo que sugiere <strong style="color:${PALETA.gold};">preferencias de mercado diferenciadas</strong> respecto al patrón nacional.`;

  progreso(SECCIONES_PROGRESO[5]); // Analizando distribucion municipal...

  // Agregacion municipal desde df_mapa_densidad
  const munisProvSet = muniIdx.byProvincia.get(provincia)!;
  const aggMuni = new Map<string, { municipio: string; cod_ine: string; matTotal: number; ratioSum: number; ratioCount: number }>();
  for (const r of mapRows) {
    if (!r.fecha.startsWith(anioMapa)) continue;
    const key = norm(r.municipio);
    if (!munisProvSet.has(key)) continue;
    const cod = String(r.cod_ine ?? "").padStart(5, "0");
    let e = aggMuni.get(key);
    if (!e) {
      e = { municipio: r.municipio, cod_ine: cod, matTotal: 0, ratioSum: 0, ratioCount: 0 };
      aggMuni.set(key, e);
    }
    e.matTotal += r.matriculaciones;
    if (r.ratio_x1000 > 0) { e.ratioSum += r.ratio_x1000; e.ratioCount++; }
  }
  const municipiosProv: MunicipioProv[] = [...aggMuni.values()].map((e) => ({
    cod_ine: e.cod_ine,
    municipio: e.municipio,
    matriculaciones: e.matTotal,
    ratio_x1000: e.ratioCount > 0 ? e.ratioSum / e.ratioCount : 0,
  }));
  const municipiosRatioDesc = [...municipiosProv].sort((a, b) => b.ratio_x1000 - a.ratio_x1000);
  const municipiosVolumenDesc = [...municipiosProv].sort((a, b) => b.matriculaciones - a.matriculaciones);
  const municipiosRatioAscFiltrado = [...municipiosProv]
    .filter((m) => m.matriculaciones >= 5)
    .sort((a, b) => a.ratio_x1000 - b.ratio_x1000);

  // Ratios provinciales / nacionales (usando anioMapa)
  const pobPorMuni = new Map<string, number>();
  for (const r of mapRows) {
    if (!r.fecha.startsWith(anioMapa)) continue;
    if (!r.ratio_x1000 || r.ratio_x1000 <= 0 || !r.matriculaciones) continue;
    const key = `${r.cod_ine}|${norm(r.municipio)}`;
    if (pobPorMuni.has(key)) continue;
    pobPorMuni.set(key, (r.matriculaciones / r.ratio_x1000) * 1000);
  }
  let matProvTotal = 0, matNacTotal = 0;
  for (const r of mapRows) {
    if (!r.fecha.startsWith(anioMapa)) continue;
    matNacTotal += r.matriculaciones;
    const cod2 = String(r.cod_ine ?? "").padStart(5, "0").substring(0, 2);
    if (provLookup.get(cod2) === provincia) matProvTotal += r.matriculaciones;
  }
  let pobProvTotal = 0, pobNacTotal = 0;
  for (const [key, pob] of pobPorMuni) {
    if (!(pob > 0)) continue;
    pobNacTotal += pob;
    const codIne = key.split("|")[0];
    const cod2 = String(codIne ?? "").padStart(5, "0").substring(0, 2);
    if (provLookup.get(cod2) === provincia) pobProvTotal += pob;
  }
  const ratioProv = pobProvTotal > 0 ? (matProvTotal / pobProvTotal) * 1000 : 0;
  const ratioNacional = pobNacTotal > 0 ? (matNacTotal / pobNacTotal) * 1000 : 0;
  const desvRatioPct = ratioNacional > 0 ? ((ratioProv - ratioNacional) / ratioNacional) * 100 : 0;

  // Ranking provincial por volumen (anioMapa)
  const { ranking, totalProvincias } = calcularRankingProvincial(mapRows, provLookup, anioMapa, provincia);
  // @ts-expect-error — totalProvincias se usa en resumen.ranking metadata
  const _tp = totalProvincias;

  const introTerritorial = `<strong>${escapeHtml(provincia)}</strong> registró <strong style="color:${PALETA.navy};">${fmtInt(filtrado.totalProv)}</strong> matriculaciones en ${anioObj}, ocupando el puesto <strong style="color:${PALETA.gold};">${ranking > 0 ? ranking + "º" : "—"}</strong> del ranking nacional por volumen sobre ${_tp} provincias. El ratio provincial se sitúa <strong style="color:${desvRatioPct >= 0 ? PALETA.exito : PALETA.peligro};">${desvRatioPct >= 0 ? "+" : ""}${fmtDec(desvRatioPct, 1)}%</strong> respecto a la media nacional.`;

  progreso(SECCIONES_PROGRESO[6]); // Detectando anomalias...

  // Anomalias
  const anomaliasConfirmadas: string[] = [];
  for (const reglaIVTM of MUNICIPIOS_IVTM_BONIFICADOS) {
    const provEsperada = reglaIVTM.provincia;
    if (provEsperada && norm(provEsperada) !== norm(provincia)) continue;
    const hit = municipiosProv.find((m) => norm(m.municipio) === reglaIVTM.nombre);
    if (hit) anomaliasConfirmadas.push(hit.municipio);
  }
  const ratiosVal = municipiosProv.map((m) => m.ratio_x1000).filter((v) => v > 0).sort((a, b) => a - b);
  const mediana = ratiosVal.length
    ? ratiosVal.length % 2 === 1
      ? ratiosVal[(ratiosVal.length - 1) / 2]
      : (ratiosVal[ratiosVal.length / 2 - 1] + ratiosVal[ratiosVal.length / 2]) / 2
    : 0;
  const anomaliasPotenciales: ResumenProvincia["anomaliasPotenciales"] = [];
  if (mediana > 0) {
    for (const m of municipiosProv) {
      if (m.ratio_x1000 > 3 * mediana) {
        anomaliasPotenciales.push({
          municipio: m.municipio, ratio: m.ratio_x1000, mediana, factor: m.ratio_x1000 / mediana,
        });
      }
    }
    anomaliasPotenciales.sort((a, b) => b.factor - a.factor);
  }

  // Conclusiones
  const clasif = desvRatioPct > 5 ? "un mercado por encima de la media nacional"
               : desvRatioPct < -5 ? "un mercado por debajo de la media nacional"
               : "un mercado en línea con la media nacional";
  const conclusionPosicionamiento = `<strong>${escapeHtml(provincia)}</strong> se clasifica como <strong style="color:${PALETA.navy};">${clasif}</strong>, con un ratio per cápita de <strong>${fmtDec(ratioProv, 2)}</strong> matriculaciones por cada 1.000 habitantes frente a la media nacional de <strong>${fmtDec(ratioNacional, 2)}</strong>. Ocupa el puesto <strong>${ranking > 0 ? ranking + "º" : "—"}</strong> por volumen entre las ${_tp} provincias analizadas.`;

  const conclusionTendencia = direccion === "alcista"
    ? `El mercado nacional prevé <strong style="color:${PALETA.exito};">crecimiento</strong> en el horizonte de 6 meses, lo que abre una ventana de <strong>oportunidad para captar cuota adicional</strong> en ${escapeHtml(provincia)} reforzando el aprovisionamiento con antelación.`
    : direccion === "bajista"
    ? `El mercado nacional prevé <strong style="color:${PALETA.peligro};">contracción</strong> en el horizonte de 6 meses, lo que obliga a ser <strong>prudente con nuevos aprovisionamientos</strong> y priorizar acciones comerciales para estimular la demanda en ${escapeHtml(provincia)}.`
    : `El mercado nacional se prevé <strong style="color:${PALETA.gold};">estable</strong> en el horizonte de 6 meses, sin cambios relevantes esperados en la demanda de ${escapeHtml(provincia)}.`;

  const conclusionTerritorial = anomaliasConfirmadas.length > 0
    ? `Se han identificado municipios con bonificación IVTM documentada (<strong>${anomaliasConfirmadas.join(", ")}</strong>). Estos núcleos <strong style="color:${PALETA.peligro};">distorsionan el análisis de demanda territorial</strong> y no deben usarse como referencia para decisiones de red.`
    : anomaliasPotenciales.length > 0
    ? `Se han detectado <strong>${anomaliasPotenciales.length}</strong> municipio(s) con ratio anómalo respecto a la mediana provincial. Se recomienda <strong>verificar estos casos</strong> antes de tomar decisiones de red.`
    : `No se han detectado anomalías territoriales significativas. El análisis municipal es <strong style="color:${PALETA.exito};">fiable</strong> a efectos de planificación.`;

  let recomendacion: string;
  if (anomaliasConfirmadas.length > 0) {
    recomendacion = `La presencia de municipios con bonificación IVTM en ${provincia} aconseja depurar el análisis de demanda antes de evaluar la apertura de nuevas delegaciones. Priorizar los municipios con ratio en línea con la mediana provincial para estimaciones comerciales fiables.`;
  } else if (direccion === "alcista" && desvRatioPct > 0) {
    recomendacion = `Dado que ${provincia} se sitúa un ${fmtDec(Math.abs(desvRatioPct), 1)}% por encima de la media nacional y el forecast prevé crecimiento, se recomienda reforzar stock con al menos 3 semanas de antelación sobre los meses más activos y priorizar las marcas con mayor crecimiento interanual.`;
  } else if (direccion === "bajista") {
    recomendacion = `Con una tendencia bajista prevista y un mercado provincial ${desvRatioPct >= 0 ? "por encima" : "por debajo"} de la media, se recomienda ajustar pedidos a proveedores y priorizar acciones comerciales para estimular la demanda en los municipios con mayor ratio provincial.`;
  } else {
    recomendacion = `En un mercado ${clasif} y con tendencia estable, se recomienda mantener el aprovisionamiento actual y focalizar el esfuerzo comercial en los municipios de mayor ratio identificados en la Sección 6.`;
  }

  // ── Score Territorial de Oportunidad ──
  let scoreInfo: ResumenProvincia["scoreInfo"] = null;
  try {
    // Convertir yearlyByProv (provincia-name) a Map<provCode, Map<anio, total>>
    const nameToCode = new Map<string, string>();
    for (const [code, name] of provLookup) nameToCode.set(name, code);
    const tendenciaByCode = new Map<string, Map<number, number>>();
    for (const [nombre, serie] of filtrado.yearlyByProv) {
      const code = nameToCode.get(nombre);
      if (code) tendenciaByCode.set(code, serie);
    }
    const allScores = await calcularScoreTerritorial(mapRows, provLookup, tendenciaByCode);
    const mine = allScores.find((s) => norm(s.provincia) === norm(provincia));
    if (mine) {
      const media = allScores.reduce((a, b) => a + b.score_final, 0) / allScores.length;
      scoreInfo = { row: mine, totalProvincias: allScores.length, mediaNacional: media };
    }
  } catch (e) {
    console.warn("[Informe] Score territorial no disponible:", e);
  }

  // Ensamblar resumen
  const resumen: ResumenProvincia = {
    provincia,
    anio: anioObj,
    anioMapa,
    monthlyNacional,
    kpiNacional: {
      totalAnio,
      variacionPct,
      mesPico: mesPico ? MESES_ES[mesPico.Mes] : "",
      mesPicoVal: mesPico?.Turismos ?? 0,
    },
    introNacional,
    forecastSerie,
    alertasMotor1,
    patronSemanal,
    introPredictivo,
    diasMayorPeso,
    pctDiasMayor,
    top10MarcasNacional: top10Nacional,
    hhi,
    hhiInterp,
    introMarcas,
    marcaMayorCrecimiento,
    totalProvincial: filtrado.totalProv,
    totalNacional: totalAnio,
    mediaNacional,
    ranking,
    ratioProv,
    ratioNacional,
    desvRatioPct,
    serieMensualProv,
    serieMensualMediaProv,
    introTerritorial,
    top10MarcasProv,
    interpretacionMixMarcas,
    gruposProv,
    interpretacionGruposProv,
    municipiosRatioDesc,
    municipiosVolumenDesc,
    municipiosRatioAscFiltrado,
    anomaliasConfirmadas,
    anomaliasPotenciales,
    conclusionPosicionamiento,
    conclusionTendencia,
    conclusionTerritorial,
    recomendacion,
    scoreInfo,
    // @ts-expect-error campo adicional no tipado estrictamente
    totalProvincias: _tp,
  };

  progreso(SECCIONES_PROGRESO[7]); // Componiendo informe final...

  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });

  // Secciones: [html, esPrimera, dibujarHeader]
  const secciones: { html: string; header: boolean; etiqueta: string }[] = [
    { html: htmlPortada(resumen), header: false, etiqueta: "Portada" },
    { html: htmlSeccion1(resumen), header: true, etiqueta: "Sección 1" },
    { html: htmlSeccion2(resumen), header: true, etiqueta: "Sección 2" },
    { html: htmlSeccion3(resumen), header: true, etiqueta: "Sección 3" },
    { html: htmlSeccion4(resumen), header: true, etiqueta: "Sección 4" },
    { html: htmlSeccion5(resumen), header: true, etiqueta: "Sección 5" },
    { html: htmlSeccion6(resumen), header: true, etiqueta: "Sección 6" },
    { html: htmlSeccion7(resumen), header: true, etiqueta: "Sección 7" },
    { html: htmlSeccion8(resumen), header: true, etiqueta: "Sección 8" },
  ];

  // Sección opcional 9: análisis de escenarios (solo si hay eventos activos)
  const escenarioActivo = getEscenarioActivo();
  if (escenarioActivo && escenarioActivo.eventosActivos.length > 0) {
    // Reutilizamos las predicciones ya cargadas si coinciden; si no, usamos el snapshot.
    const base = escenarioActivo.predicciones.length
      ? escenarioActivo.predicciones
      : predicciones.map((p) => ({
          fecha_mes: p.fecha_mes,
          real: p.real,
          prediccion: p.prediccion,
          pred_prophet: p.pred_prophet,
        }));
    const filas = calcularEscenario(base, escenarioActivo.eventosActivos);
    secciones.push({
      html: htmlSeccionEscenarios(escenarioActivo.eventosActivos, filas),
      header: true,
      etiqueta: "Sección 9",
    });
  }

  let paginaActual = 1;
  for (let i = 0; i < secciones.length; i++) {
    progreso(`Renderizando ${secciones[i].etiqueta}...`);
    const wrapper = crearContenedor(secciones[i].html);
    try {
      paginaActual = await capturarYAnadirAlPdf(
        pdf, wrapper, i === 0, { provincia, anio: anioObj }, paginaActual, secciones[i].header
      );
    } finally {
      document.body.removeChild(wrapper);
    }
    await new Promise((r) => setTimeout(r, 0));
  }

  progreso("Descargando...");
  const slug = norm(provincia).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  pdf.save(`informe_${slug}_${anioObj}.pdf`);
  progreso("Completado");
}
