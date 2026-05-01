import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleQuantile } from "d3-scale";
import type { MonthlyAggRow, MonthlyBrandRow, MapDensityRow, GeoJsonType } from "./types";
import { parseNumber, normalizeName, formatInt, formatDec, formatMonth, formatISODate, fetchCsv, seriesTooltip } from "./utils.tsx";
import { generarInformeTerritorial } from "./utils/generarInformeTerritorial";
import GruposEmpresarialesSection from "./GruposEmpresarialesSection";
import CuotaMarcaMapSection from "./CuotaMarcaMapSection";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BRAND_COLORS = [
  "#1e3a8a", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#65a30d", "#ea580c", "#6366f1",
];

export default function DescriptivaTab() {
  const [monthlyData, setMonthlyData] = useState<MonthlyAggRow[]>([]);
  const [brandData, setBrandData] = useState<MonthlyBrandRow[]>([]);
  const [mapData, setMapData] = useState<MapDensityRow[]>([]);
  const [geoJson, setGeoJson] = useState<GeoJsonType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMapDate, setSelectedMapDate] = useState("");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  // Hover sincronizado entre los dos mapas (densidad y cuota por marca):
  // pasar el raton por una provincia en cualquiera de los dos resalta la
  // misma provincia en ambos. El tooltip sigue siendo local de cada mapa.
  const [hoveredProvince, setHoveredProvince] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [mapTooltip, setMapTooltip] = useState<{
    name: string;
    matriculaciones: number;
    ratio_x1000: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Load small CSVs immediately, lazy load GeoJSON
        const [monthly, brands, map] = await Promise.all([
          fetchCsv<MonthlyAggRow>("/df_mensual_agrupado.csv", (r) => {
            const año = parseNumber(r["Año"] ?? r.Año);
            const mes = parseNumber(r.Mes);
            const t = parseNumber(r.Turismos);
            if (!año || !mes || t === null) return null;
            return { Año: año, Mes: mes, Turismos: t };
          }),
          fetchCsv<MonthlyBrandRow>("/df_mensual_marca.csv", (r) => {
            const fecha = String(r.fecha_mes ?? "").slice(0, 10);
            const marca = String(r.marca ?? "").trim();
            const mat = parseNumber(r.matriculaciones) ?? 0;
            if (!fecha || !marca) return null;
            return { fecha_mes: fecha, marca, matriculaciones: mat };
          }),
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
        ]);

        if (cancelled) return;
        setMonthlyData(monthly);
        setBrandData(brands);
        setMapData(map);

        const mapDates = [...new Set(map.map((d) => d.fecha))].sort();
        setSelectedMapDate(mapDates[mapDates.length - 1] ?? "");

        // Load province-level GeoJSON (52 features, fast render)
        fetch("/provincias.geojson?v=4")
          .then((r) => r.json())
          .then((geo) => { if (!cancelled) setGeoJson(geo); })
          .catch(() => {}); // non-critical

      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Error al cargar datos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Monthly series for the line chart
  const monthlySeries = useMemo(() => {
    return monthlyData
      .map((d) => ({
        fecha_mes: `${d.Año}-${String(d.Mes).padStart(2, "0")}-01`,
        matriculaciones: d.Turismos,
      }))
      .filter(
        (d) =>
          (!dateRange.start || d.fecha_mes >= dateRange.start) &&
          (!dateRange.end || d.fecha_mes <= dateRange.end)
      )
      .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
  }, [monthlyData, dateRange]);

  // KPIs
  const kpis = useMemo(() => {
    if (!monthlySeries.length) return { total: 0, media: 0, max: 0, variacion: 0 };
    const vals = monthlySeries.map((d) => d.matriculaciones);
    const total = vals.reduce((s, v) => s + v, 0);
    const max = Math.max(...vals);

    // Year-over-year variation
    const lastDate = monthlySeries[monthlySeries.length - 1].fecha_mes;
    const lastYear = parseInt(lastDate.slice(0, 4));
    const currentYearTotal = monthlySeries
      .filter((d) => d.fecha_mes.startsWith(String(lastYear)))
      .reduce((s, d) => s + d.matriculaciones, 0);
    const prevYearTotal = monthlySeries
      .filter((d) => d.fecha_mes.startsWith(String(lastYear - 1)))
      .reduce((s, d) => s + d.matriculaciones, 0);
    const variacion = prevYearTotal > 0 ? ((currentYearTotal - prevYearTotal) / prevYearTotal) * 100 : 0;

    return { total, media: total / vals.length, max, variacion };
  }, [monthlySeries]);

  // Top 10 brands evolution
  const top10BrandsSeries = useMemo(() => {
    // Find top 10 brands by total
    const brandTotals = new Map<string, number>();
    for (const r of brandData) {
      if (r.marca === "TOTAL MARCAS") continue;
      brandTotals.set(r.marca, (brandTotals.get(r.marca) ?? 0) + r.matriculaciones);
    }
    const top10 = [...brandTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([m]) => m);

    // Build series: fecha_mes -> { marca1: val, marca2: val, ... }
    const byDate = new Map<string, Record<string, number>>();
    for (const r of brandData) {
      if (!top10.includes(r.marca)) continue;
      if (!byDate.has(r.fecha_mes)) byDate.set(r.fecha_mes, {});
      const entry = byDate.get(r.fecha_mes)!;
      entry[r.marca] = (entry[r.marca] ?? 0) + r.matriculaciones;
    }

    const series = [...byDate.entries()]
      .map(([fecha_mes, brands]) => ({ fecha_mes, ...brands }))
      .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));

    return { series, brands: top10 };
  }, [brandData]);

  // Map data — aggregated by province (first 2 digits of cod_ine)
  const mapDates = useMemo(() => [...new Set(mapData.map((d) => d.fecha))].sort(), [mapData]);
  const currentMapData = useMemo(() => mapData.filter((d) => d.fecha === selectedMapDate), [mapData, selectedMapDate]);

  // Aggregate municipality data to province level
  const provLookup = useMemo(() => {
    const agg: Record<string, { matriculaciones: number; ratio_sum: number; count: number }> = {};
    for (const row of currentMapData) {
      const prov = String(row.cod_ine ?? "").substring(0, 2);
      if (!prov || prov.length < 2) continue;
      if (!agg[prov]) agg[prov] = { matriculaciones: 0, ratio_sum: 0, count: 0 };
      agg[prov].matriculaciones += row.matriculaciones;
      agg[prov].ratio_sum += row.ratio_x1000;
      agg[prov].count += 1;
    }
    // Compute average ratio per province
    const lookup: Record<string, { matriculaciones: number; ratio_x1000: number }> = {};
    for (const [prov, v] of Object.entries(agg)) {
      lookup[prov] = { matriculaciones: v.matriculaciones, ratio_x1000: v.count > 0 ? v.ratio_sum / v.count : 0 };
    }
    return lookup;
  }, [currentMapData]);

  const colorScale = useMemo(() => {
    const values = Object.values(provLookup).map((d) => d.ratio_x1000).filter((v) => Number.isFinite(v) && v > 0);
    if (!values.length) return () => "#e5e7eb";
    return scaleQuantile<string>().domain(values).range(["#93c5fd", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#172554"]);
  }, [provLookup]);

  // Find peak month
  const peakMonth = useMemo(() => {
    if (!monthlySeries.length) return "";
    const peak = monthlySeries.reduce((a, b) => (b.matriculaciones > a.matriculaciones ? b : a));
    return formatMonth(peak.fecha_mes);
  }, [monthlySeries]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-500">Cargando datos descriptivos...</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center py-20 text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-8">
      {/* KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Total matriculaciones</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatInt(kpis.total)}</p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Media mensual</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatDec(kpis.media)}</p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Variación interanual</p>
          <p className={`text-3xl font-bold mt-2 ${kpis.variacion >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {kpis.variacion >= 0 ? "+" : ""}{formatDec(kpis.variacion)}%
          </p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Mes pico</p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{peakMonth}</p>
          <p className="text-sm text-slate-400 mt-1">{formatInt(kpis.max)} uds.</p>
        </div>
      </section>

      {/* Filters */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Filtros temporales</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Fecha inicio</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Fecha fin</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
            />
          </div>
        </div>
      </section>

      {/* Monthly time series */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-1">Serie temporal mensual</h2>
        <p className="text-slate-500 text-sm mb-5">Matriculaciones de turismos en España.</p>
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="fecha_mes" tickFormatter={formatMonth} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatInt(Number(v))} />
              <Tooltip content={seriesTooltip} />
              <Legend />
              <Line type="monotone" dataKey="matriculaciones" name="Matriculaciones" stroke="#1e3a8a" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Top 10 brands */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-1">Evolución por marca (Top 10)</h2>
        <p className="text-slate-500 text-sm mb-5">Matriculaciones mensuales de las 10 marcas con mayor volumen.</p>
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={top10BrandsSeries.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="fecha_mes" tickFormatter={formatMonth} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatInt(Number(v))} />
              <Tooltip content={seriesTooltip} />
              <Legend />
              {top10BrandsSeries.brands.map((brand, i) => (
                <Line
                  key={brand}
                  type="monotone"
                  dataKey={brand}
                  name={brand}
                  stroke={BRAND_COLORS[i % BRAND_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Análisis por grupo empresarial */}
      <GruposEmpresarialesSection brandData={brandData} dateRange={dateRange} />

      {/* Mapas territoriales: densidad + cuota por marca, lado a lado en
          desktop, apilados en movil/tablet. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold">Mapa de densidad</h2>
            <p className="text-slate-500 text-sm mt-1">Matriculaciones por 1.000 habitantes por municipio.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Fecha</label>
            <select
              value={selectedMapDate}
              onChange={(e) => setSelectedMapDate(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
            >
              {mapDates.map((d) => (
                <option key={d} value={d}>{formatISODate(d)}</option>
              ))}
            </select>
          </div>
        </div>

        {!geoJson ? (
          <div className="flex items-center justify-center h-[400px] bg-slate-50 rounded-2xl text-slate-400">
            Cargando mapa...
          </div>
        ) : (
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
                    const provData = provLookup[provCode];
                    const isSelected = selectedProvince === provName;
                    const isHovered = hoveredProvince === provName;
                    // Prioridad visual: hover (gold) > selected (red) > default
                    const stroke = isHovered ? "#C4922A" : isSelected ? "#dc2626" : "#94a3b8";
                    const strokeWidth = isHovered || isSelected ? 2 : 0.4;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={provData ? colorScale(provData.ratio_x1000) : "#e8e5e0"}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        onClick={() => setSelectedProvince(provName)}
                        onMouseEnter={(evt) => {
                          setHoveredProvince(provName);
                          setMapTooltip({
                            name: provName,
                            matriculaciones: provData?.matriculaciones ?? 0,
                            ratio_x1000: provData?.ratio_x1000 ?? 0,
                            x: evt.clientX,
                            y: evt.clientY,
                          });
                        }}
                        onMouseMove={(evt) => {
                          setMapTooltip({
                            name: provName,
                            matriculaciones: provData?.matriculaciones ?? 0,
                            ratio_x1000: provData?.ratio_x1000 ?? 0,
                            x: evt.clientX,
                            y: evt.clientY,
                          });
                        }}
                        onMouseLeave={() => {
                          setHoveredProvince(null);
                          setMapTooltip(null);
                        }}
                        style={{
                          default: { outline: "none" },
                          hover: { outline: "none", opacity: 0.75, cursor: "pointer" },
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
                <div className="text-slate-600">
                  Matriculaciones: <span className="font-semibold text-slate-900">{formatInt(mapTooltip.matriculaciones)}</span>
                </div>
                <div className="text-slate-600">
                  Ratio x1.000: <span className="font-semibold text-blue-700">{formatDec(mapTooltip.ratio_x1000)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Map legend */}
        <div className="flex items-center gap-1 mt-4 justify-center">
          <span className="text-xs text-slate-500 mr-2">Menor</span>
          {["#93c5fd", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#172554"].map((c) => (
            <div key={c} className="w-8 h-4 rounded" style={{ backgroundColor: c }} />
          ))}
          <span className="text-xs text-slate-500 ml-2">Mayor</span>
        </div>
      </section>

      <CuotaMarcaMapSection
        geoJson={geoJson}
        hoveredProvince={hoveredProvince}
        setHoveredProvince={setHoveredProvince}
      />
      </div>

      {/* Informe territorial: bloque independiente debajo de los mapas.
          Reacciona al click en el mapa de densidad (selectedProvince). */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Informe territorial</h3>
              <p className="text-sm text-slate-500 mt-1">
                {selectedProvince
                  ? <>Provincia seleccionada: <span className="font-semibold text-slate-900">{selectedProvince}</span></>
                  : "Selecciona una provincia en el mapa para generar el informe"}
              </p>
              {progressMessage && (
                <p className={`text-sm mt-2 ${progressMessage.startsWith("Error") ? "text-red-600" : "text-blue-600"}`}>{progressMessage}</p>
              )}
            </div>
            <button
              disabled={!selectedProvince || generating}
              onClick={async () => {
                if (!selectedProvince) return;
                setGenerating(true);
                setProgressMessage("Iniciando generación (puede tardar 1-2 min por el CSV de 150MB)...");
                try {
                  await generarInformeTerritorial(selectedProvince, setProgressMessage);
                  setProgressMessage("Informe descargado correctamente.");
                } catch (e: any) {
                  console.error("[Informe territorial] Error:", e);
                  setProgressMessage("Error: " + (e?.message ?? String(e)) + " (ver consola para detalles)");
                } finally {
                  setGenerating(false);
                }
              }}
              className={`rounded-xl px-6 py-3 font-semibold transition-colors ${
                !selectedProvince || generating
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-slate-900 text-white hover:bg-slate-800"
              }`}
            >
              {generating ? "Generando..." : "Descargar informe territorial"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
