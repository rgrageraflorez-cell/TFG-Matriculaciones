import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { MapDensityRow, GeoJsonType, PredictionRow, MonthlyBrandRow } from "./types";
import { parseNumber, normalizeName, formatInt, formatDec, formatMonth, fetchCsv } from "./utils.tsx";
import ScoreTerritorialSection from "./ScoreTerritorialSection";

// Names and colors matching 02_clustering_municipios.R
const CLUSTER_NAMES = [
  "Municipios rurales de baja demanda",
  "Periurbanos de alto poder adquisitivo",
  "Municipios pequeños alta demanda",
  "Grandes núcleos urbanos",
];

const CLUSTER_COLORS: Record<string, string> = {
  "Municipios rurales de baja demanda": "#e78ac3",
  "Periurbanos de alto poder adquisitivo": "#fc8d62",
  "Municipios pequeños alta demanda": "#8da0cb",
  "Grandes núcleos urbanos": "#66c2a5",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_LABELS = [
  "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

type MuniCluster = {
  municipio: string;
  cod_ine?: string | number;
  clusterName: string;
  ratio_x1000: number;
  matriculaciones: number;
  poblacion: number;
};

type ClusterStat = {
  cluster: string;
  municipios: number;
  ratioMedio: number;
  matriculacionesTotal: number;
  poblacionMedia: number;
};

type Insight = {
  category: "alerta" | "geografico" | "mercado" | "cluster";
  icon: string;
  title: string;
  text: string;
  priority: number; // lower = more important, shown first
};

const CATEGORY_STYLE: Record<string, { bg: string; border: string; badge: string; label: string }> = {
  alerta:     { bg: "bg-amber-50",   border: "border-amber-200", badge: "bg-amber-500",   label: "Alerta de demanda" },
  geografico: { bg: "bg-blue-50",    border: "border-blue-200",  badge: "bg-blue-500",    label: "Insight geográfico" },
  mercado:    { bg: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-500", label: "Insight de mercado" },
  cluster:    { bg: "bg-purple-50",  border: "border-purple-200", badge: "bg-purple-500",  label: "Perfil de cluster" },
};

export default function CognitivaTab() {
  const [mapData, setMapData] = useState<MapDensityRow[]>([]);
  const [predData, setPredData] = useState<PredictionRow[]>([]);
  const [brandData, setBrandData] = useState<MonthlyBrandRow[]>([]);
  const [geoJson, setGeoJson] = useState<GeoJsonType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMuni, setSelectedMuni] = useState<MuniCluster | null>(null);
  const [mapTooltip, setMapTooltip] = useState<{
    name: string; clusterName: string; ratio: number; x: number; y: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [map, geo, pred, brands] = await Promise.all([
          fetchCsv<MapDensityRow>("/df_mapa_densidad.csv", (r) => {
            const fecha = String(r.fecha ?? "").slice(0, 10);
            const muni = String(r.municipio ?? "").trim();
            if (!fecha || !muni || !DATE_RE.test(fecha)) return null;
            return {
              cod_ine: r.cod_ine,
              fecha,
              municipio: muni,
              matriculaciones: parseNumber(r.matriculaciones) ?? 0,
              ratio_x1000: parseNumber(r.ratio_x1000) ?? 0,
            };
          }),
          fetch("/provincias.geojson?v=4").then((r) => r.json()),
          fetchCsv<PredictionRow>("/df_real_pred_mensual_total.csv", (r) => {
            const fecha = String(r.fecha_mes ?? "").slice(0, 10);
            if (!fecha || !DATE_RE.test(fecha)) return null;
            return {
              fecha_mes: fecha,
              real: parseNumber(r.real),
              prediccion: parseNumber(r.prediccion),
              pred_prophet: parseNumber(r.pred_prophet),
              tipo_periodo: r.tipo_periodo ? String(r.tipo_periodo) : undefined,
            };
          }),
          fetchCsv<MonthlyBrandRow>("/df_mensual_marca.csv", (r) => {
            const fecha = String(r.fecha_mes ?? "").slice(0, 10);
            const marca = String(r.marca ?? "").trim();
            const mat = parseNumber(r.matriculaciones) ?? 0;
            if (!fecha || !marca || !DATE_RE.test(fecha)) return null;
            return { fecha_mes: fecha, marca, matriculaciones: mat };
          }),
        ]);
        if (!cancelled) {
          setMapData(map);
          setGeoJson(geo as GeoJsonType);
          setPredData(pred.sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes)));
          setBrandData(brands);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Error al cargar datos cognitivos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Latest map data ──
  const latestData = useMemo(() => {
    const allDates: string[] = mapData.map((d) => d.fecha);
    const uniqueDates: string[] = Array.from(new Set<string>(allDates)).filter((d) => DATE_RE.test(d)).sort();
    const latest = uniqueDates[uniqueDates.length - 1] ?? "";
    return mapData.filter((d) => d.fecha === latest);
  }, [mapData]);

  // ── Clustering ──
  const { clusterMap, clusterStats } = useMemo(() => {
    if (!latestData.length) return { clusterMap: new Map<string, MuniCluster>(), clusterStats: [] };

    const enriched = latestData.map((d) => {
      const poblacion = d.ratio_x1000 > 0
        ? Math.round(d.matriculaciones / d.ratio_x1000 * 1000)
        : 0;
      return { ...d, poblacion };
    });

    const ratios = enriched.map(d => d.ratio_x1000).filter(r => r > 0).sort((a, b) => a - b);
    const poblaciones = enriched.map(d => d.poblacion).filter(p => p > 0).sort((a, b) => a - b);

    const ratioP50 = ratios[Math.floor(ratios.length * 0.5)] ?? 1;
    const ratioP75 = ratios[Math.floor(ratios.length * 0.75)] ?? 2;
    const pobP75 = poblaciones[Math.floor(poblaciones.length * 0.75)] ?? 10000;
    const pobGrande = 50000;

    function assignCluster(ratio: number, pob: number): string {
      if (pob >= pobGrande) return "Grandes núcleos urbanos";
      if (ratio >= ratioP75 && pob < pobP75) return "Municipios pequeños alta demanda";
      if (ratio >= ratioP50 && pob >= pobP75 * 0.3) return "Periurbanos de alto poder adquisitivo";
      return "Municipios rurales de baja demanda";
    }

    const map = new Map<string, MuniCluster>();
    const statsAcc = new Map<string, { count: number; sumRatio: number; sumMat: number; sumPob: number }>();
    for (const name of CLUSTER_NAMES) {
      statsAcc.set(name, { count: 0, sumRatio: 0, sumMat: 0, sumPob: 0 });
    }

    for (const d of enriched) {
      const clusterName = assignCluster(d.ratio_x1000, d.poblacion);
      const entry: MuniCluster = {
        municipio: d.municipio,
        cod_ine: d.cod_ine,
        clusterName,
        ratio_x1000: d.ratio_x1000,
        matriculaciones: d.matriculaciones,
        poblacion: d.poblacion,
      };
      map.set(normalizeName(d.municipio), entry);
      const acc = statsAcc.get(clusterName)!;
      acc.count++;
      acc.sumRatio += d.ratio_x1000;
      acc.sumMat += d.matriculaciones;
      acc.sumPob += d.poblacion;
    }

    const stats: ClusterStat[] = CLUSTER_NAMES.map((name) => {
      const acc = statsAcc.get(name)!;
      return {
        cluster: name,
        municipios: acc.count,
        ratioMedio: acc.count > 0 ? acc.sumRatio / acc.count : 0,
        matriculacionesTotal: acc.sumMat,
        poblacionMedia: acc.count > 0 ? Math.round(acc.sumPob / acc.count) : 0,
      };
    });

    return { clusterMap: map, clusterStats: stats };
  }, [latestData]);

  // Province-level cluster lookup (dominant cluster per province, weighted by matriculaciones)
  const provClusterLookup = useMemo(() => {
    const provClusters: Record<string, Record<string, number>> = {};
    const provRatios: Record<string, { sum: number; count: number; mat: number }> = {};
    clusterMap.forEach((entry) => {
      const prov = String(entry.cod_ine ?? "").substring(0, 2);
      if (!prov || prov.length < 2) return;
      if (!provClusters[prov]) provClusters[prov] = {};
      // Weight by matriculaciones instead of counting municipalities
      provClusters[prov][entry.clusterName] = (provClusters[prov][entry.clusterName] || 0) + entry.matriculaciones;
      if (!provRatios[prov]) provRatios[prov] = { sum: 0, count: 0, mat: 0 };
      provRatios[prov].sum += entry.ratio_x1000;
      provRatios[prov].count++;
      provRatios[prov].mat += entry.matriculaciones;
    });
    const lookup: Record<string, { clusterName: string; ratio: number; mat: number }> = {};
    for (const [prov, clusters] of Object.entries(provClusters)) {
      const dominant = Object.entries(clusters).sort((a, b) => b[1] - a[1])[0][0];
      const r = provRatios[prov];
      lookup[prov] = { clusterName: dominant, ratio: r.count > 0 ? r.sum / r.count : 0, mat: r.mat };
    }
    return lookup;
  }, [clusterMap]);

  const globalMeanRatio = useMemo(() => {
    const nonZero = latestData.filter(d => d.ratio_x1000 > 0);
    if (!nonZero.length) return 0;
    return nonZero.reduce((s, d) => s + d.ratio_x1000, 0) / nonZero.length;
  }, [latestData]);

  // ══════════════════════════════════════════════════════════
  //  INSIGHTS ENGINE
  // ══════════════════════════════════════════════════════════

  // ── 1. Prediction peak alerts ──
  const predInsights = useMemo((): Insight[] => {
    if (!predData.length) return [];
    const results: Insight[] = [];

    // Future-only predictions (real === null)
    const future = predData.filter(d => d.real === null && d.prediccion !== null);
    if (!future.length) return [];

    // Historical average per month (for seasonality comparison)
    const historical = predData.filter(d => d.real !== null);
    const histByMonth = new Map<number, number[]>();
    for (const d of historical) {
      const m = new Date(d.fecha_mes).getMonth() + 1;
      if (!histByMonth.has(m)) histByMonth.set(m, []);
      histByMonth.get(m)!.push(d.real!);
    }
    const histAvgByMonth = new Map<number, number>();
    for (const [m, vals] of histByMonth) {
      histAvgByMonth.set(m, vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // Overall mean of future predictions
    const futMean = future.reduce((s, d) => s + d.prediccion!, 0) / future.length;

    // Find the PEAK month in the next 6 months
    const next6 = future.slice(0, 6);
    if (next6.length > 0) {
      const peak = next6.reduce((a, b) => (b.prediccion! > a.prediccion! ? b : a));
      const peakDate = new Date(peak.fecha_mes);
      const peakMonth = peakDate.getMonth() + 1;
      const peakYear = peakDate.getFullYear();
      const pctAboveMean = ((peak.prediccion! - futMean) / futMean) * 100;
      const histAvg = histAvgByMonth.get(peakMonth);
      const vsHist = histAvg ? ((peak.prediccion! - histAvg) / histAvg) * 100 : null;

      results.push({
        category: "alerta",
        icon: "^",
        priority: 0,
        title: `Pico de demanda previsto en ${MONTH_LABELS[peakMonth]} ${peakYear}`,
        text: `El modelo TBATS predice ${formatInt(Math.round(peak.prediccion!))} matriculaciones para ${MONTH_LABELS[peakMonth]} ${peakYear}, un ${formatDec(pctAboveMean)}% por encima de la media prevista. ${vsHist !== null ? `Comparado con la media histórica de ${MONTH_LABELS[peakMonth]} (${formatInt(Math.round(histAvg!))}), supone un ${vsHist >= 0 ? "+" : ""}${formatDec(vsHist)}%.` : ""} Recomendación: reforzar stock y capacidad logística con antelación.`,
      });

      // Find the VALLEY too
      const valley = next6.reduce((a, b) => (b.prediccion! < a.prediccion! ? b : a));
      if (valley.fecha_mes !== peak.fecha_mes) {
        const vDate = new Date(valley.fecha_mes);
        const vMonth = vDate.getMonth() + 1;
        const vYear = vDate.getFullYear();
        const pctBelowMean = ((futMean - valley.prediccion!) / futMean) * 100;
        results.push({
          category: "alerta",
          icon: "v",
          priority: 1,
          title: `Valle de demanda previsto en ${MONTH_LABELS[vMonth]} ${vYear}`,
          text: `Se prevén ${formatInt(Math.round(valley.prediccion!))} matriculaciones en ${MONTH_LABELS[vMonth]} ${vYear}, un ${formatDec(pctBelowMean)}% por debajo de la media prevista. Recomendación: ajustar pedidos a proveedores y concentrar esfuerzos comerciales o promociones para estimular la demanda.`,
        });
      }
    }

    // Trend: compare first 3 vs last 3 months of forecast
    if (future.length >= 6) {
      const first3Avg = future.slice(0, 3).reduce((s, d) => s + d.prediccion!, 0) / 3;
      const last3Avg = future.slice(-3).reduce((s, d) => s + d.prediccion!, 0) / 3;
      const trendPct = ((last3Avg - first3Avg) / first3Avg) * 100;
      const direction = trendPct > 2 ? "alcista" : trendPct < -2 ? "bajista" : "estable";
      results.push({
        category: "alerta",
        icon: direction === "alcista" ? "+" : direction === "bajista" ? "-" : "=",
        priority: 2,
        title: `Tendencia ${direction} en el horizonte de predicción`,
        text: `La demanda prevista para el segundo semestre del horizonte es un ${Math.abs(trendPct) > 0.1 ? formatDec(Math.abs(trendPct)) + "%" : "prácticamente igual"} ${trendPct > 0 ? "superior" : trendPct < 0 ? "inferior" : "similar"} al primer semestre. ${direction === "alcista" ? "Planificar incremento progresivo de inventario." : direction === "bajista" ? "Considerar ajustar aprovisionamiento a la baja." : "Mantener niveles actuales de stock."}`,
      });
    }

    // Month-over-month biggest jump in next 6
    if (next6.length >= 2) {
      let maxJump = 0;
      let jumpFrom = "";
      let jumpTo = "";
      let jumpPred = 0;
      for (let i = 1; i < next6.length; i++) {
        const jump = next6[i].prediccion! - next6[i - 1].prediccion!;
        if (jump > maxJump) {
          maxJump = jump;
          jumpFrom = next6[i - 1].fecha_mes;
          jumpTo = next6[i].fecha_mes;
          jumpPred = next6[i].prediccion!;
        }
      }
      if (maxJump > 0) {
        const fromMonth = new Date(jumpFrom).getMonth() + 1;
        const toMonth = new Date(jumpTo).getMonth() + 1;
        const pctJump = (maxJump / (jumpPred - maxJump)) * 100;
        results.push({
          category: "alerta",
          icon: "!",
          priority: 3,
          title: `Mayor salto de demanda: ${MONTH_LABELS[fromMonth]} a ${MONTH_LABELS[toMonth]}`,
          text: `El mayor incremento mensual previsto es de +${formatInt(Math.round(maxJump))} matriculaciones (+${formatDec(pctJump)}%) entre ${MONTH_LABELS[fromMonth]} y ${MONTH_LABELS[toMonth]}. Este salto requiere anticipar la logística de entrega al menos 4-6 semanas antes.`,
        });
      }
    }

    return results;
  }, [predData]);

  // ── 2. Geographic insights ──
  const geoInsights = useMemo((): Insight[] => {
    if (!latestData.length) return [];
    const results: Insight[] = [];

    // Top 10 municipalities by volume
    const byMat = [...latestData].sort((a, b) => b.matriculaciones - a.matriculaciones);
    const top10 = byMat.slice(0, 10);
    const totalMat = latestData.reduce((s, d) => s + d.matriculaciones, 0);
    const top10Mat = top10.reduce((s, d) => s + d.matriculaciones, 0);
    const top10Pct = (top10Mat / totalMat) * 100;

    results.push({
      category: "geografico",
      icon: "C",
      priority: 10,
      title: "Concentración geográfica de la demanda",
      text: `Los 10 municipios con más matriculaciones (${top10.slice(0, 5).map(d => d.municipio).join(", ")}...) concentran el ${formatDec(top10Pct)}% de todas las matriculaciones (${formatInt(top10Mat)} de ${formatInt(totalMat)}). Esto implica que la red de distribución debe priorizar estas plazas.`,
    });

    // Municipalities with 0 registrations ("desiertos")
    const deserts = latestData.filter(d => d.matriculaciones === 0);
    if (deserts.length > 0) {
      const desertPct = (deserts.length / latestData.length) * 100;
      results.push({
        category: "geografico",
        icon: "0",
        priority: 11,
        title: `${formatInt(deserts.length)} municipios sin matriculaciones`,
        text: `El ${formatDec(desertPct)}% de los municipios (${formatInt(deserts.length)} de ${formatInt(latestData.length)}) registró 0 matriculaciones en el último mes. Estos "desiertos de demanda" son predominantemente municipios rurales de menos de 500 habitantes, donde la distribución directa no es rentable.`,
      });
    }

    // Top municipality by ratio (hidden gems: high per-capita demand)
    const byRatio = [...latestData].filter(d => d.ratio_x1000 > 0 && d.matriculaciones >= 5).sort((a, b) => b.ratio_x1000 - a.ratio_x1000);
    if (byRatio.length >= 3) {
      const gems = byRatio.slice(0, 5);
      results.push({
        category: "geografico",
        icon: "G",
        priority: 12,
        title: "Municipios con demanda per cápita excepcional",
        text: `${gems.map(d => `${d.municipio} (${formatDec(d.ratio_x1000)}/1.000 hab.)`).join(", ")} lideran en ratio per cápita. Estos municipios pueden albergar flotas empresariales, concesionarios o actividad turística que impulsa las matriculaciones muy por encima de la media (${formatDec(globalMeanRatio)}).`,
      });
    }

    // Multi-month trend: compare first vs last available month
    const allDatesMap = Array.from(new Set<string>(mapData.map(d => d.fecha))).filter(d => DATE_RE.test(d)).sort();
    if (allDatesMap.length >= 2) {
      const firstDate = allDatesMap[0];
      const lastDate = allDatesMap[allDatesMap.length - 1];
      const firstMonth = mapData.filter(d => d.fecha === firstDate);
      const lastMonth = mapData.filter(d => d.fecha === lastDate);
      const totalFirst = firstMonth.reduce((s, d) => s + d.matriculaciones, 0);
      const totalLast = lastMonth.reduce((s, d) => s + d.matriculaciones, 0);
      if (totalFirst > 0) {
        const changePct = ((totalLast - totalFirst) / totalFirst) * 100;
        const firstLabel = formatMonth(firstDate);
        const lastLabel = formatMonth(lastDate);
        results.push({
          category: "geografico",
          icon: changePct >= 0 ? "+" : "-",
          priority: 13,
          title: `Evolución agregada: ${firstLabel} a ${lastLabel}`,
          text: `Las matriculaciones totales pasaron de ${formatInt(totalFirst)} (${firstLabel}) a ${formatInt(totalLast)} (${lastLabel}), un ${changePct >= 0 ? "+" : ""}${formatDec(changePct)}%. ${changePct > 10 ? "La tendencia alcista sugiere un mercado en expansión." : changePct < -10 ? "El descenso puede reflejar estacionalidad o contracción del mercado." : "El mercado se mantiene relativamente estable en este periodo."}`,
        });
      }
    }

    return results;
  }, [latestData, mapData, globalMeanRatio]);

  // ── 3. Brand/market insights ──
  const marketInsights = useMemo((): Insight[] => {
    if (!brandData.length) return [];
    const results: Insight[] = [];

    // Get latest month of brand data
    const brandDates = Array.from(new Set(brandData.map(d => d.fecha_mes))).sort();
    const latestBrandDate = brandDates[brandDates.length - 1];
    const latestBrands = brandData.filter(d => d.fecha_mes === latestBrandDate);

    // Aggregate by brand
    const brandTotals = new Map<string, number>();
    for (const d of latestBrands) {
      brandTotals.set(d.marca, (brandTotals.get(d.marca) ?? 0) + d.matriculaciones);
    }
    const sortedBrands = [...brandTotals.entries()].sort((a, b) => b[1] - a[1]);
    const totalBrandMat = sortedBrands.reduce((s, [, v]) => s + v, 0);

    if (sortedBrands.length >= 5) {
      const top5 = sortedBrands.slice(0, 5);
      const top5Total = top5.reduce((s, [, v]) => s + v, 0);
      const top5Pct = (top5Total / totalBrandMat) * 100;

      results.push({
        category: "mercado",
        icon: "M",
        priority: 20,
        title: "Dominio del top 5 de marcas",
        text: `Las 5 marcas líderes (${top5.map(([m, v]) => `${m}: ${formatInt(v)}`).join(", ")}) agrupan el ${formatDec(top5Pct)}% del total. ${top5Pct > 50 ? "El mercado está altamente concentrado: las decisiones de stock deben priorizarlas." : "El mercado está relativamente fragmentado."}`,
      });

      // Herfindahl index (market concentration)
      const shares = sortedBrands.map(([, v]) => v / totalBrandMat);
      const hhi = shares.reduce((s, sh) => s + sh * sh, 0);
      const hhiNorm = Math.round(hhi * 10000);
      const hhiLabel = hhiNorm > 2500 ? "altamente concentrado" : hhiNorm > 1500 ? "moderadamente concentrado" : "competitivo";
      results.push({
        category: "mercado",
        icon: "H",
        priority: 21,
        title: `Índice de concentración de mercado (HHI): ${formatInt(hhiNorm)}`,
        text: `El índice Herfindahl-Hirschman es ${formatInt(hhiNorm)} puntos, indicando un mercado ${hhiLabel}. ${hhiNorm > 2500 ? "Pocas marcas dominan: un cambio en la oferta de una marca líder impacta significativamente en la demanda total." : hhiNorm > 1500 ? "Hay concentración moderada: diversificar la cartera de marcas reduce el riesgo de dependencia." : "La competencia es intensa: la diferenciación por servicio y precio es clave."}`,
      });
    }

    // Month-over-month brand leader changes
    if (brandDates.length >= 2) {
      const prevDate = brandDates[brandDates.length - 2];
      const prevBrands = brandData.filter(d => d.fecha_mes === prevDate);
      const prevTotals = new Map<string, number>();
      for (const d of prevBrands) {
        prevTotals.set(d.marca, (prevTotals.get(d.marca) ?? 0) + d.matriculaciones);
      }

      // Find brand with biggest growth
      let maxGrowth = 0;
      let growthBrand = "";
      let growthFrom = 0;
      let growthTo = 0;
      for (const [marca, current] of brandTotals) {
        const prev = prevTotals.get(marca) ?? 0;
        if (prev >= 100) { // only established brands
          const growth = current - prev;
          if (growth > maxGrowth) {
            maxGrowth = growth;
            growthBrand = marca;
            growthFrom = prev;
            growthTo = current;
          }
        }
      }
      if (growthBrand) {
        const growthPct = ((growthTo - growthFrom) / growthFrom) * 100;
        results.push({
          category: "mercado",
          icon: "R",
          priority: 22,
          title: `Marca en mayor crecimiento: ${growthBrand}`,
          text: `${growthBrand} pasó de ${formatInt(growthFrom)} a ${formatInt(growthTo)} matriculaciones (+${formatDec(growthPct)}%) entre ${formatMonth(String(prevDate))} y ${formatMonth(String(latestBrandDate))}. Este crecimiento puede indicar un lanzamiento exitoso o una campaña comercial agresiva.`,
        });
      }
    }

    return results;
  }, [brandData]);

  // ── 4. Cluster insights ──
  const clusterInsights = useMemo((): Insight[] => {
    const active = clusterStats.filter(s => s.municipios > 0);
    if (!active.length || !clusterMap.size) return [];
    const results: Insight[] = [];
    const totalMat = active.reduce((s, c) => s + c.matriculacionesTotal, 0);

    const highCluster = active.reduce((a, b) => (b.ratioMedio > a.ratioMedio ? b : a));
    results.push({
      category: "cluster",
      icon: "A",
      priority: 30,
      title: `Mayor demanda per cápita: ${highCluster.cluster}`,
      text: `"${highCluster.cluster}" tiene el ratio medio más alto (${formatDec(highCluster.ratioMedio)} matriculaciones/1.000 hab.), un ${formatDec(((highCluster.ratioMedio - globalMeanRatio) / globalMeanRatio) * 100)}% por encima de la media nacional.`,
    });

    const urbanCluster = clusterStats.find(s => s.cluster === "Grandes núcleos urbanos");
    if (urbanCluster && urbanCluster.municipios > 0) {
      const urbanPct = (urbanCluster.matriculacionesTotal / totalMat) * 100;
      results.push({
        category: "cluster",
        icon: "U",
        priority: 31,
        title: "Peso de los grandes núcleos urbanos",
        text: `Los ${formatInt(urbanCluster.municipios)} grandes núcleos urbanos concentran ${formatInt(urbanCluster.matriculacionesTotal)} matriculaciones (${formatDec(urbanPct)}% del total), con una población media de ${formatInt(urbanCluster.poblacionMedia)} hab. Son el mercado prioritario para cualquier red de distribución.`,
      });
    }

    // Opportunity: periurban zones
    const periurban = clusterStats.find(s => s.cluster === "Periurbanos de alto poder adquisitivo");
    if (periurban && periurban.municipios > 0 && urbanCluster && urbanCluster.ratioMedio > 0) {
      const vsUrban = ((periurban.ratioMedio - urbanCluster.ratioMedio) / urbanCluster.ratioMedio) * 100;
      results.push({
        category: "cluster",
        icon: "O",
        priority: 32,
        title: "Oportunidad en zonas periurbanas",
        text: `Los ${formatInt(periurban.municipios)} municipios periurbanos de alto poder adquisitivo tienen un ratio de ${formatDec(periurban.ratioMedio)} matriculaciones/1.000 hab. (${vsUrban >= 0 ? "+" : ""}${formatDec(vsUrban)}% vs. grandes ciudades). Su capacidad de compra elevada los convierte en un segmento atractivo para modelos premium.`,
      });
    }

    const biggestCluster = active.reduce((a, b) => (b.municipios > a.municipios ? b : a));
    results.push({
      category: "cluster",
      icon: "N",
      priority: 33,
      title: `Cluster más numeroso: ${biggestCluster.cluster}`,
      text: `"${biggestCluster.cluster}" agrupa ${formatInt(biggestCluster.municipios)} municipios (${formatDec((biggestCluster.municipios / latestData.length) * 100)}% del total). ${biggestCluster.cluster.includes("rural") ? "Aunque individualmente generan poca demanda, en conjunto representan un mercado disperso difícil de atender con distribución tradicional." : ""}`,
    });

    const lowCluster = active.reduce((a, b) => (b.ratioMedio < a.ratioMedio ? b : a));
    if (lowCluster.cluster !== highCluster.cluster) {
      results.push({
        category: "cluster",
        icon: "B",
        priority: 34,
        title: `Menor demanda relativa: ${lowCluster.cluster}`,
        text: `"${lowCluster.cluster}" presenta el menor ratio medio (${formatDec(lowCluster.ratioMedio)}). La brecha con el cluster líder es de ${formatDec(highCluster.ratioMedio - lowCluster.ratioMedio)} puntos, indicando oportunidades limitadas o necesidad de estrategias diferenciadas (vehículos de ocasión, renting, etc.).`,
      });
    }

    return results;
  }, [clusterStats, clusterMap, globalMeanRatio, latestData]);

  // ── Merge & sort all insights ──
  const allInsights = useMemo(() => {
    return [...predInsights, ...geoInsights, ...marketInsights, ...clusterInsights].sort((a, b) => a.priority - b.priority);
  }, [predInsights, geoInsights, marketInsights, clusterInsights]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-500">Cargando análisis cognitivo...</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center py-20 text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-8">
      {/* ── Alertas de demanda (top priority) ── */}
      {predInsights.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Alertas de demanda</h2>
          <p className="text-slate-500 text-sm -mt-2">Basadas en las predicciones TBATS. Anticipar picos y valles para optimizar stock.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {predInsights.map((ins, i) => (
              <div
                key={i}
                className={`rounded-2xl border p-5 ${CATEGORY_STYLE[ins.category].bg} ${CATEGORY_STYLE[ins.category].border}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${CATEGORY_STYLE[ins.category].badge}`}>
                    {CATEGORY_STYLE[ins.category].label}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 mb-1">{ins.title}</h3>
                <p className="text-sm text-slate-700 leading-relaxed">{ins.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Cluster bar chart + summary cards ── */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-semibold mb-1">Ratio medio por cluster</h2>
          <p className="text-slate-500 text-sm mb-5">Matriculaciones por 1.000 habitantes (media del cluster).</p>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clusterStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={(v) => formatDec(Number(v))} />
                <YAxis type="category" dataKey="cluster" width={200} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: any) => [formatDec(Number(v)), "Ratio medio"]}
                  labelFormatter={(l) => String(l)}
                />
                <Bar dataKey="ratioMedio" name="Ratio medio x1.000" radius={[0, 8, 8, 0]}>
                  {clusterStats.map((s) => (
                    <Cell key={s.cluster} fill={CLUSTER_COLORS[s.cluster] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-semibold mb-2">Perfil de clusters</h2>
          {clusterStats.map((s) => (
            <div
              key={s.cluster}
              className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-4"
            >
              <div
                className="w-4 h-14 rounded-lg flex-shrink-0"
                style={{ backgroundColor: CLUSTER_COLORS[s.cluster] ?? "#94a3b8" }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 text-sm">{s.cluster}</div>
                <div className="text-sm text-slate-500 mt-1">
                  {formatInt(s.municipios)} municipios · Ratio medio: {formatDec(s.ratioMedio)} · Pob. media: {formatInt(s.poblacionMedia)}
                </div>
                <div className="text-sm text-slate-400">
                  Total matriculaciones: {formatInt(s.matriculacionesTotal)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Cluster map ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-1">Mapa de clusters municipales</h2>
        <p className="text-slate-500 text-sm mb-5">
          Cada municipio se clasifica según su ratio de matriculaciones y tamaño poblacional.
          Haz click en un municipio para ver su perfil.
        </p>

        {!geoJson ? (
          <div className="flex items-center justify-center h-[400px] bg-slate-50 rounded-2xl text-slate-400">
            Cargando mapa...
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6">
            <div className="relative border border-slate-100 rounded-2xl bg-slate-50 p-3">
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ center: [-3.5, 40.2], scale: 2400 }}
                style={{ width: "100%", height: "auto" }}
              >
                <Geographies geography={geoJson}>
                  {({ geographies }) =>
                    geographies.map((geo: any) => {
                      const provCode = String(geo.properties.prov ?? "");
                      const provName = String(geo.properties.name ?? "");
                      const pData = provClusterLookup[provCode];
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={pData ? (CLUSTER_COLORS[pData.clusterName] ?? "#e8e5e0") : "#e8e5e0"}
                          stroke="#94a3b8"
                          strokeWidth={0.4}
                          onMouseEnter={(evt) => {
                            if (pData) {
                              setMapTooltip({
                                name: provName,
                                clusterName: pData.clusterName,
                                ratio: pData.ratio,
                                x: evt.clientX,
                                y: evt.clientY,
                              });
                            }
                          }}
                          onMouseMove={(evt) => {
                            if (pData) {
                              setMapTooltip({
                                name: provName,
                                clusterName: pData.clusterName,
                                ratio: pData.ratio,
                                x: evt.clientX,
                                y: evt.clientY,
                              });
                            }
                          }}
                          onMouseLeave={() => setMapTooltip(null)}
                          style={{
                            default: { outline: "none", cursor: "pointer" },
                            hover: { outline: "none", opacity: 0.75 },
                            pressed: { outline: "none" },
                          }}
                        />
                      );
                    })
                  }
                </Geographies>
              </ComposableMap>
              {mapTooltip && (
                <div
                  className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-sm pointer-events-none"
                  style={{ left: mapTooltip.x + 12, top: mapTooltip.y + 12 }}
                >
                  <div className="font-semibold text-slate-900 mb-1">{mapTooltip.name}</div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: CLUSTER_COLORS[mapTooltip.clusterName] }} />
                    {mapTooltip.clusterName} · Ratio: <span className="font-semibold">{formatDec(mapTooltip.ratio)}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-4 mt-4 justify-center flex-wrap">
                {CLUSTER_NAMES.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: CLUSTER_COLORS[name] }} />
                    <span className="text-xs text-slate-600">{name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Municipality detail panel */}
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-700 mb-3">Perfil del municipio</h3>
              {selectedMuni ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-slate-500">Municipio</p>
                    <p className="text-lg font-bold text-slate-900">{selectedMuni.municipio}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: CLUSTER_COLORS[selectedMuni.clusterName] }}
                    />
                    <span className="font-semibold text-sm">{selectedMuni.clusterName}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white rounded-xl p-3 border border-slate-200">
                      <p className="text-xs text-slate-500">Ratio x1.000</p>
                      <p className="text-xl font-bold text-slate-900">{formatDec(selectedMuni.ratio_x1000)}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-200">
                      <p className="text-xs text-slate-500">Matriculaciones</p>
                      <p className="text-xl font-bold text-slate-900">{formatInt(selectedMuni.matriculaciones)}</p>
                    </div>
                    <div className="bg-white rounded-xl p-3 border border-slate-200 col-span-2">
                      <p className="text-xs text-slate-500">Población estimada</p>
                      <p className="text-xl font-bold text-slate-900">{formatInt(selectedMuni.poblacion)}</p>
                    </div>
                  </div>
                  {(() => {
                    const myCluster = clusterStats.find((s) => s.cluster === selectedMuni.clusterName);
                    if (!myCluster || myCluster.ratioMedio === 0) return null;
                    const diff = ((selectedMuni.ratio_x1000 - myCluster.ratioMedio) / myCluster.ratioMedio) * 100;
                    return (
                      <div className="bg-white rounded-xl p-3 border border-slate-200">
                        <p className="text-xs text-slate-500">vs. media del cluster</p>
                        <p className={`text-lg font-bold ${diff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {diff >= 0 ? "+" : ""}{formatDec(diff)}%
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">
                  Haz click en un municipio del mapa para ver sus datos.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── All insights panel ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-1">Insights automáticos</h2>
        <p className="text-slate-500 text-sm mb-5">
          Análisis generados dinámicamente cruzando predicciones TBATS, datos geográficos, marcas y clusters.
        </p>
        <div className="space-y-4">
          {allInsights.map((ins, i) => {
            const style = CATEGORY_STYLE[ins.category];
            return (
              <div key={i} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${style.badge}`}>
                    {style.label}
                  </span>
                  <span className="font-semibold text-slate-900 text-sm">{ins.title}</span>
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{ins.text}</p>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 mt-5">
          Los clusters se asignan combinando el ratio de matriculaciones per cápita y el tamaño poblacional estimado,
          siguiendo la metodología del análisis K-means del TFG. Las alertas de demanda usan el modelo TBATS de la pestaña predictiva.
        </p>
      </section>

      {/* ── Score Territorial de Oportunidad ── */}
      <ScoreTerritorialSection mapData={mapData} geoJson={geoJson} />
    </div>
  );
}
