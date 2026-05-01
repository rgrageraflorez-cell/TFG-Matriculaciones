import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleQuantile } from "d3-scale";
import type { MonthlyBrandRow, GeoJsonType } from "./types";
import { formatInt, formatDec, formatMonth } from "./utils.tsx";
import { esMarcaChina, normalizarMarca } from "./config/marcasChinas";
import {
  calcularSerieCuotaChina,
  buildDesgloseMarcas,
  detectarAceleracion,
  type FilaMarcaMes,
} from "./utils/marcasChinasHelpers";
import {
  evaluarFiabilidad,
  COLOR_NO_FIABLE,
  UMBRAL_ABSOLUTO,
} from "./utils/fiabilidadMarcaProvincia";
import MapLegendQuantile from "./utils/MapLegendQuantile";
import type { MarcaProvinciaRow } from "./CuotaMarcaMapSection";

// ── Color reservado semanticamente para "marcas chinas" en este componente.
//    No se usa en ningun otro punto del proyecto (verificado en Fase 1). ──
const COLOR_CHINA = "#DC2626";
const COLOR_AREA_CHINA = "rgba(220, 38, 38, 0.15)";

// Escala secuencial monocromatica roja para el mapa territorial. Cinco
// niveles por cuantiles, igual logica que el mapa de cuota por marca.
const COLOR_BUCKETS = [
  "#FEE2E2",
  "#FCA5A5",
  "#F87171",
  "#EF4444",
  "#DC2626",
];
const COLOR_ZERO_MAPA = "#F1F2F4"; // gris claro para provincias con n=0

type Props = {
  brandData: MonthlyBrandRow[];
  marcaProvinciaRows: MarcaProvinciaRow[] | null;
  geoJson: GeoJsonType | null;
  hoveredProvince: string | null;
  setHoveredProvince: (p: string | null) => void;
};

const ANIO_MAPA = 2025; // ultimo anio cerrado completo (decision usuario)

export default function MarcasChinasSection({
  brandData,
  marcaProvinciaRows,
  geoJson,
  hoveredProvince,
  setHoveredProvince,
}: Props) {
  const [tooltipMapa, setTooltipMapa] = useState<{
    x: number;
    y: number;
    provName: string;
    matricChinas: number;
    cuotaChina: number;
    cuotaNacional: number;
    marcaLider: string | null;
    cuotaMarcaLider: number;
    fiable: boolean;
  } | null>(null);

  // ── A. SERIE TEMPORAL Y KPIS ────────────────────────────────────────────
  const filasMarcaMes: FilaMarcaMes[] = useMemo(
    () =>
      brandData.map((d) => ({
        fecha_mes: d.fecha_mes,
        marca: d.marca,
        matriculaciones: d.matriculaciones,
      })),
    [brandData],
  );

  const serie = useMemo(
    () => calcularSerieCuotaChina(filasMarcaMes),
    [filasMarcaMes],
  );

  // KPIs: ultimo mes, cuota hace 24 meses, delta pp.
  const kpis = useMemo(() => {
    if (serie.length === 0) {
      return { actual: 0, fechaActual: "", hace2y: 0, delta: 0 };
    }
    const ult = serie[serie.length - 1];
    // Mismo mes 2 anios antes
    const dosAniosAtras = ult.fecha_mes.replace(
      /^(\d{4})/,
      (m) => String(parseInt(m, 10) - 2),
    );
    const prev = serie.find((p) => p.fecha_mes === dosAniosAtras);
    return {
      actual: ult.cuota_pct,
      fechaActual: ult.fecha_mes,
      hace2y: prev?.cuota_pct ?? 0,
      delta: ult.cuota_pct - (prev?.cuota_pct ?? 0),
    };
  }, [serie]);

  // Anotaciones: primera matriculacion BYD y primera matriculacion china.
  const anotaciones = useMemo(() => {
    let primeraBYD: string | null = null;
    let primeraChina: string | null = null;
    for (const r of brandData) {
      if (!r.fecha_mes || r.matriculaciones <= 0) continue;
      if (esMarcaChina(r.marca)) {
        if (!primeraChina || r.fecha_mes < primeraChina) primeraChina = r.fecha_mes;
        if (normalizarMarca(r.marca) === "BYD") {
          if (!primeraBYD || r.fecha_mes < primeraBYD) primeraBYD = r.fecha_mes;
        }
      }
    }
    const aceleracion = detectarAceleracion(serie);
    return { primeraBYD, primeraChina, aceleracion };
  }, [brandData, serie]);

  // ── A.2. DESGLOSE POR MARCA (ultimo anio cerrado disponible) ────────────
  const ultimoAnioCerrado = useMemo(() => {
    if (serie.length === 0) return null;
    // Calculamos el ultimo año del que tenemos los 12 meses.
    const porAnio = new Map<string, number>();
    for (const p of serie) {
      const y = p.fecha_mes.slice(0, 4);
      porAnio.set(y, (porAnio.get(y) ?? 0) + 1);
    }
    const candidatos = [...porAnio.entries()]
      .filter(([, n]) => n >= 12)
      .map(([y]) => parseInt(y, 10))
      .sort((a, b) => b - a);
    return candidatos[0] ?? null;
  }, [serie]);

  const desglose = useMemo(() => {
    if (ultimoAnioCerrado == null) return [];
    return buildDesgloseMarcas(filasMarcaMes, ultimoAnioCerrado, 10);
  }, [filasMarcaMes, ultimoAnioCerrado]);

  // ── B. MAPA TERRITORIAL ───────────────────────────────────────────────
  // Para 2025 (ANIO_MAPA), agrupar por cod_provincia el total de chinas y el
  // total de mercado. Calcular cuota provincial = chinas / total.
  const datosMapa = useMemo(() => {
    if (!marcaProvinciaRows) return null;
    const filas2025 = marcaProvinciaRows.filter(
      (r) => r.anio === String(ANIO_MAPA),
    );
    const totalProv = new Map<string, number>(); // cod -> matric totales
    const chinasProv = new Map<string, number>(); // cod -> matric chinas
    const marcaLiderPorProv = new Map<
      string,
      Map<string, number>
    >(); // cod -> (marca china -> matric)
    let totalChinasNac = 0;
    let totalNac = 0;
    for (const r of filas2025) {
      const cod = r.cod_provincia.padStart(2, "0");
      const n = parseInt(r.matriculaciones, 10) || 0;
      totalProv.set(cod, (totalProv.get(cod) ?? 0) + n);
      totalNac += n;
      if (esMarcaChina(r.marca)) {
        chinasProv.set(cod, (chinasProv.get(cod) ?? 0) + n);
        totalChinasNac += n;
        let mlp = marcaLiderPorProv.get(cod);
        if (!mlp) {
          mlp = new Map();
          marcaLiderPorProv.set(cod, mlp);
        }
        mlp.set(r.marca, (mlp.get(r.marca) ?? 0) + n);
      }
    }
    const cuotaNacional = totalNac > 0 ? (totalChinasNac / totalNac) * 100 : 0;
    const provLookup: Record<
      string,
      {
        matricChinas: number;
        matricTotal: number;
        cuotaChina: number;
        marcaLider: string | null;
        cuotaMarcaLider: number; // % sobre chinas de la provincia
        fiable: boolean;
      }
    > = {};
    for (const cod of totalProv.keys()) {
      const mc = chinasProv.get(cod) ?? 0;
      const mt = totalProv.get(cod) ?? 0;
      const cuota = mt > 0 ? (mc / mt) * 100 : 0;
      let marcaLider: string | null = null;
      let cuotaLider = 0;
      const mlp = marcaLiderPorProv.get(cod);
      if (mlp && mlp.size > 0) {
        const top = [...mlp.entries()].sort((a, b) => b[1] - a[1])[0];
        marcaLider = top[0];
        cuotaLider = mc > 0 ? (top[1] / mc) * 100 : 0;
      }
      // Filtro de fiabilidad: aplicado al numerador (chinas en la provincia).
      const fiable = evaluarFiabilidad({
        n_provincia: mc,
        n_nacional_marca: totalChinasNac,
      }).fiable;
      provLookup[cod] = {
        matricChinas: mc,
        matricTotal: mt,
        cuotaChina: cuota,
        marcaLider,
        cuotaMarcaLider: cuotaLider,
        fiable,
      };
    }
    return { provLookup, cuotaNacional, totalChinasNac, totalNac };
  }, [marcaProvinciaRows]);

  const escalaMapa = useMemo(() => {
    if (!datosMapa) {
      return { breaks: [0, 0, 0, 0], colorOf: () => COLOR_ZERO_MAPA };
    }
    const valores = Object.values(datosMapa.provLookup)
      .filter((v) => v.fiable && v.cuotaChina > 0)
      .map((v) => v.cuotaChina);
    if (valores.length === 0) {
      return {
        breaks: [0, 0, 0, 0],
        colorOf: (_v: number, fiable: boolean = true) =>
          fiable ? COLOR_ZERO_MAPA : COLOR_NO_FIABLE,
      };
    }
    const q = scaleQuantile<string>().domain(valores).range(COLOR_BUCKETS);
    const [b1, b2, b3, b4] = q.quantiles();
    return {
      breaks: [b1 ?? 0, b2 ?? 0, b3 ?? 0, b4 ?? 0],
      colorOf: (v: number, fiable: boolean = true) => {
        if (!fiable) return COLOR_NO_FIABLE;
        if (v <= 0) return COLOR_ZERO_MAPA;
        return q(v);
      },
    };
  }, [datosMapa]);

  const yMaxSerie = useMemo(() => {
    if (serie.length === 0) return 5;
    const max = Math.max(...serie.map((p) => p.cuota_pct));
    return Math.ceil(max * 1.2 * 10) / 10;
  }, [serie]);

  // ── RENDER ─────────────────────────────────────────────────────────────
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Irrupción de fabricantes chinos en el mercado español
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Evolución de la cuota de mercado agregada y distribución territorial
          de los fabricantes con sede en China.
        </p>
        <p className="text-slate-400 text-xs italic mt-2">
          Incluye fabricantes con sede principal en China. Excluye marcas de
          capital chino con identidad de marca no china (MG, Volvo, Polestar).
          Ver Capacidades y Límites para el detalle de la clasificación.
        </p>
      </div>

      {/* ─── SUBSECCION A: Evolucion temporal ──────────────────────── */}
      <div>
        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div
            className="bg-white border border-[#E5E7EB] rounded p-4"
            style={{ borderLeft: `3px solid ${COLOR_CHINA}` }}
          >
            <p className="exec-label">Cuota actual</p>
            <p
              className="text-2xl font-bold mt-2 tnum"
              style={{ color: COLOR_CHINA }}
            >
              {formatDec(kpis.actual)}%
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {kpis.fechaActual ? formatMonth(kpis.fechaActual) : "—"}
            </p>
          </div>
          <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-slate-300 rounded p-4">
            <p className="exec-label">Cuota hace 2 años</p>
            <p className="text-2xl font-bold text-slate-900 mt-2 tnum">
              {formatDec(kpis.hace2y)}%
            </p>
            <p className="text-xs text-slate-400 mt-1">mismo mes calendario</p>
          </div>
          <div
            className="bg-white border border-[#E5E7EB] rounded p-4"
            style={{ borderLeft: `3px solid ${COLOR_CHINA}` }}
          >
            <p className="exec-label">Crecimiento en 2 años</p>
            <p
              className="text-2xl font-bold mt-2 tnum"
              style={{ color: kpis.delta >= 0 ? COLOR_CHINA : "#475569" }}
            >
              {kpis.delta >= 0 ? "+" : ""}
              {formatDec(kpis.delta)} pp
            </p>
            <p className="text-xs text-slate-400 mt-1">
              cambio en puntos porcentuales
            </p>
          </div>
        </div>

        <h3 className="text-base font-semibold text-slate-900 mb-1">
          Evolución mensual de la cuota china agregada
        </h3>
        <p className="text-slate-500 text-xs mb-3">
          Porcentaje de matriculaciones de fabricantes chinos sobre el total
          mensual del mercado.
        </p>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie}>
              <defs>
                <linearGradient id="gradChina" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_CHINA} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLOR_CHINA} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="fecha_mes"
                tickFormatter={formatMonth}
                tick={{ fontSize: 11, fill: "#6B7280" }}
              />
              <YAxis
                domain={[0, yMaxSerie]}
                tickFormatter={(v) => `${formatDec(Number(v))}%`}
                tick={{ fontSize: 11, fill: "#6B7280" }}
                label={{
                  value: "Cuota de mercado (%)",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#6B7280",
                  fontSize: 11,
                }}
              />
              <Tooltip
                formatter={(v: any) => [`${formatDec(Number(v))}%`, "Cuota"]}
                labelFormatter={(l) => formatMonth(String(l))}
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 2,
                }}
              />
              {anotaciones.primeraChina && (
                <ReferenceLine
                  x={anotaciones.primeraChina}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{
                    value: "Primera china",
                    position: "insideTopRight",
                    fill: "#64748b",
                    fontSize: 10,
                  }}
                />
              )}
              {anotaciones.primeraBYD &&
                anotaciones.primeraBYD !== anotaciones.primeraChina && (
                  <ReferenceLine
                    x={anotaciones.primeraBYD}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    label={{
                      value: "Primera BYD",
                      position: "insideTopRight",
                      fill: "#64748b",
                      fontSize: 10,
                    }}
                  />
                )}
              {anotaciones.aceleracion && (
                <ReferenceLine
                  x={anotaciones.aceleracion}
                  stroke={COLOR_CHINA}
                  strokeDasharray="2 4"
                  label={{
                    value: "Aceleración",
                    position: "insideTopRight",
                    fill: COLOR_CHINA,
                    fontSize: 10,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="cuota_pct"
                name="Cuota china"
                stroke={COLOR_CHINA}
                strokeWidth={2.5}
                fill="url(#gradChina)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* A.2 Desglose por marca */}
        {desglose.length > 0 && ultimoAnioCerrado != null && (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              Desglose por marca — año {ultimoAnioCerrado}
            </h3>
            <p className="text-slate-500 text-xs mb-3">
              Marcas con &lt; 10 matriculaciones en el año se agrupan en
              "Otras chinas".
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #E5E7EB" }}>
                    <th className="text-left exec-label py-2">Marca</th>
                    <th className="text-right exec-label py-2">
                      Matric. {ultimoAnioCerrado}
                    </th>
                    <th className="text-right exec-label py-2">
                      Cuota sobre chinas
                    </th>
                    <th className="text-right exec-label py-2">
                      Cuota sobre mercado total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {desglose.map((d) => {
                    const maxBar = desglose[0]?.matric_anio || 1;
                    const barW = (d.matric_anio / maxBar) * 100;
                    return (
                      <tr
                        key={d.marca}
                        style={{ borderBottom: "1px solid #F1F2F4" }}
                        className={d.esOtras ? "italic text-slate-500" : ""}
                      >
                        <td className="py-2.5 font-medium" style={{ minWidth: 180 }}>
                          <div className="flex items-center gap-2">
                            <div
                              style={{
                                flex: 1,
                                height: 6,
                                background: "#F1F2F4",
                                borderRadius: 3,
                                overflow: "hidden",
                                maxWidth: 120,
                              }}
                            >
                              <div
                                style={{
                                  width: `${barW}%`,
                                  height: "100%",
                                  background: d.esOtras ? "#94A3B8" : COLOR_CHINA,
                                }}
                              />
                            </div>
                            <span>{d.marca}</span>
                          </div>
                        </td>
                        <td className="text-right py-2.5 tnum">
                          {formatInt(d.matric_anio)}
                        </td>
                        <td className="text-right py-2.5 tnum">
                          {formatDec(d.cuota_sobre_chinas)}%
                        </td>
                        <td className="text-right py-2.5 tnum">
                          {formatDec(d.cuota_sobre_total)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ─── SUBSECCION B: Mapa territorial ────────────────────────── */}
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Penetración provincial — fabricantes chinos
        </h3>
        <p className="text-slate-500 text-xs mt-1 mb-3">
          Cuota sobre matriculaciones totales de turismos · año {ANIO_MAPA}
        </p>

        {!geoJson || !datosMapa ? (
          <div className="flex items-center justify-center h-[400px] bg-slate-50 rounded-2xl text-slate-400">
            Cargando mapa…
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
                    const cod = String(geo.properties.prov ?? "").padStart(2, "0");
                    const provName = String(geo.properties.name ?? "");
                    const cell = datosMapa.provLookup[cod];
                    const cuota = cell?.cuotaChina ?? 0;
                    const fiable = cell?.fiable ?? false;
                    const isHovered = hoveredProvince === provName;
                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={escalaMapa.colorOf(cuota, fiable)}
                        stroke={isHovered ? "#C4922A" : "#94a3b8"}
                        strokeWidth={isHovered ? 2 : 0.4}
                        onMouseEnter={(evt) => {
                          setHoveredProvince(provName);
                          setTooltipMapa({
                            x: evt.clientX,
                            y: evt.clientY,
                            provName,
                            matricChinas: cell?.matricChinas ?? 0,
                            cuotaChina: cuota,
                            cuotaNacional: datosMapa.cuotaNacional,
                            marcaLider: cell?.marcaLider ?? null,
                            cuotaMarcaLider: cell?.cuotaMarcaLider ?? 0,
                            fiable,
                          });
                        }}
                        onMouseMove={(evt) => {
                          setTooltipMapa((t) =>
                            t ? { ...t, x: evt.clientX, y: evt.clientY } : null,
                          );
                        }}
                        onMouseLeave={() => {
                          setHoveredProvince(null);
                          setTooltipMapa(null);
                        }}
                        style={{
                          default: { outline: "none" },
                          hover: { outline: "none", opacity: 0.85, cursor: "pointer" },
                          pressed: { outline: "none" },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ComposableMap>
            {tooltipMapa && (
              <div
                className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-sm pointer-events-none"
                style={{
                  left: tooltipMapa.x + 12,
                  top: tooltipMapa.y + 12,
                  maxWidth: 320,
                }}
              >
                <div className="font-semibold text-slate-900 mb-1">
                  {tooltipMapa.provName}
                </div>
                {tooltipMapa.fiable ? (
                  <>
                    <div className="text-slate-600">
                      Cuota fabricantes chinos:{" "}
                      <span className="font-semibold" style={{ color: COLOR_CHINA }}>
                        {formatDec(tooltipMapa.cuotaChina)}%
                      </span>
                    </div>
                    <div className="text-slate-600">
                      Matriculaciones chinas:{" "}
                      <span className="font-semibold text-slate-900">
                        {formatInt(tooltipMapa.matricChinas)}
                      </span>{" "}
                      <span className="text-slate-400">(año {ANIO_MAPA})</span>
                    </div>
                    {tooltipMapa.marcaLider && (
                      <div className="text-slate-600 mt-1 text-xs">
                        Marca china líder:{" "}
                        <span className="font-semibold text-slate-900">
                          {tooltipMapa.marcaLider}
                        </span>{" "}
                        ({formatDec(tooltipMapa.cuotaMarcaLider)}% de las
                        chinas en esta provincia)
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className="text-xs font-semibold mb-2"
                      style={{ color: "#475569" }}
                    >
                      Fiabilidad insuficiente para estimación robusta
                    </div>
                    <div className="text-slate-600 text-xs">
                      Matriculaciones chinas año {ANIO_MAPA}:{" "}
                      <span className="font-semibold text-slate-900">
                        {formatInt(tooltipMapa.matricChinas)}
                      </span>
                    </div>
                    <div className="text-slate-500 text-xs">
                      Umbral mínimo recomendado: {UMBRAL_ABSOLUTO}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {datosMapa && (
          <MapLegendQuantile
            breaks={escalaMapa.breaks}
            colors={COLOR_BUCKETS}
            zeroColor={COLOR_ZERO_MAPA}
            format={(v) => `${formatDec(v)}%`}
            unreliableSwatch={{
              color: COLOR_NO_FIABLE,
              label: `Fiabilidad insuficiente (n < ${UMBRAL_ABSOLUTO})`,
            }}
            footer={`cuota nacional chinas año ${ANIO_MAPA}: ${formatDec(
              datosMapa.cuotaNacional,
            )}%`}
          />
        )}
      </div>
    </section>
  );
}
