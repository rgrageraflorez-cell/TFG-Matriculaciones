import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { scaleQuantile } from "d3-scale";
import type { GeoJsonType } from "./types";
import { fetchCsv, parseNumber, formatInt, formatDec } from "./utils.tsx";
import MapLegendQuantile from "./utils/MapLegendQuantile";

// Paleta secuencial monocromatica (mismo tono navy/azul que el mapa de
// densidad para coherencia visual: la lectura cromatica unifica los dos
// mapas y el usuario interpreta "mas oscuro = mas valor" en ambos).
const COLOR_BUCKETS = [
  "#dbe7f5", // Q1 (mas claro)
  "#a9c4e7",
  "#5f88c2",
  "#2c5891",
  "#172554", // Q5 (mas oscuro)
];
const COLOR_ZERO = "#F1F2F4"; // gris muy claro, claramente distinto de Q1

type RawRow = {
  anio: string;
  marca: string;
  cod_provincia: string;
  matriculaciones: string;
};

type Aggregated = {
  // marca -> cod_prov -> matriculaciones (anio fijo)
  byMarcaProv: Map<string, Map<string, number>>;
  // cod_prov -> total provincial (todas las marcas, anio fijo)
  totalProv: Map<string, number>;
  // marca -> total nacional
  totalMarcaNacional: Map<string, number>;
  // total nacional global
  totalNacional: number;
  // catalogo ordenado de marcas
  marcas: string[];
  // anio que ha quedado seleccionado
  anioActivo: number;
  // listado de anios disponibles en el dataset
  aniosDisponibles: number[];
};

type Props = {
  geoJson: GeoJsonType | null;
  hoveredProvince: string | null;
  setHoveredProvince: (p: string | null) => void;
};

export default function CuotaMarcaMapSection({
  geoJson,
  hoveredProvince,
  setHoveredProvince,
}: Props) {
  const [rows, setRows] = useState<RawRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marcaSel, setMarcaSel] = useState<string>("");
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    provName: string;
    matric: number;
    cuota: number;
    cuotaNacional: number;
  } | null>(null);

  // ── Carga del CSV pre-agregado ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetchCsv<RawRow>("/df_marca_provincia_anual.csv", (r) => {
      const anio = String(r.anio ?? "").trim();
      const marca = String(r.marca ?? "").trim();
      const cod = String(r.cod_provincia ?? "").trim().padStart(2, "0");
      const mat = parseNumber(r.matriculaciones);
      if (!anio || !marca || !cod || mat == null) return null;
      return {
        anio,
        marca,
        cod_provincia: cod,
        matriculaciones: String(mat),
      };
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message ?? "No se pudo cargar el dataset por marca y provincia");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Agregaciones derivadas ──────────────────────────────────────────────
  const data: Aggregated | null = useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const aniosSet = new Set<number>();
    for (const r of rows) {
      const a = parseInt(r.anio, 10);
      if (Number.isFinite(a)) aniosSet.add(a);
    }
    const aniosDisponibles = [...aniosSet].sort((a, b) => a - b);
    if (aniosDisponibles.length === 0) return null;

    // Por defecto: ano mas reciente con datos (puede ser parcial).
    const anioActivo = aniosDisponibles[aniosDisponibles.length - 1];

    const filas = rows.filter((r) => parseInt(r.anio, 10) === anioActivo);
    const byMarcaProv = new Map<string, Map<string, number>>();
    const totalProv = new Map<string, number>();
    const totalMarcaNacional = new Map<string, number>();
    let totalNacional = 0;
    for (const r of filas) {
      const m = parseInt(r.matriculaciones, 10) || 0;
      let provs = byMarcaProv.get(r.marca);
      if (!provs) {
        provs = new Map<string, number>();
        byMarcaProv.set(r.marca, provs);
      }
      provs.set(r.cod_provincia, (provs.get(r.cod_provincia) ?? 0) + m);
      totalProv.set(r.cod_provincia, (totalProv.get(r.cod_provincia) ?? 0) + m);
      totalMarcaNacional.set(r.marca, (totalMarcaNacional.get(r.marca) ?? 0) + m);
      totalNacional += m;
    }
    const marcas = [...byMarcaProv.keys()].sort((a, b) => a.localeCompare(b, "es"));
    return {
      byMarcaProv,
      totalProv,
      totalMarcaNacional,
      totalNacional,
      marcas,
      anioActivo,
      aniosDisponibles,
    };
  }, [rows]);

  // Inicializa la marca por defecto: la de mayor cuota nacional.
  useEffect(() => {
    if (!data || marcaSel) return;
    let best = "";
    let bestVal = -1;
    for (const [m, v] of data.totalMarcaNacional) {
      if (v > bestVal) {
        bestVal = v;
        best = m;
      }
    }
    setMarcaSel(best);
  }, [data, marcaSel]);

  // ── Lookup por provincia para la marca seleccionada ─────────────────────
  const provLookup: Record<
    string,
    { matric: number; cuota: number }
  > = useMemo(() => {
    const out: Record<string, { matric: number; cuota: number }> = {};
    if (!data || !marcaSel) return out;
    const provs = data.byMarcaProv.get(marcaSel);
    if (!provs) return out;
    for (const [cod, mat] of provs) {
      const totalP = data.totalProv.get(cod) ?? 0;
      const cuota = totalP > 0 ? (mat / totalP) * 100 : 0;
      out[cod] = { matric: mat, cuota };
    }
    return out;
  }, [data, marcaSel]);

  // ── Escala por cuantiles sobre los valores >0 de la marca ───────────────
  // Escala por cuantiles, no lineal: las cuotas de marca tienen distribucion
  // muy asimetrica (la mayoria de provincias en valores bajos, unas pocas en
  // valores altos). Una escala lineal aplastaria visualmente las diferencias
  // en el rango bajo, donde mas informacion hay. Cuantiles distribuyen
  // uniformemente la atencion visual.
  const scale = useMemo(() => {
    const values = Object.values(provLookup)
      .map((d) => d.cuota)
      .filter((v) => v > 0);
    if (!values.length) {
      return {
        breaks: [0, 0, 0, 0],
        colorOf: (_v: number) => COLOR_ZERO,
      };
    }
    const q = scaleQuantile<string>().domain(values).range(COLOR_BUCKETS);
    const [b1, b2, b3, b4] = q.quantiles();
    return {
      breaks: [b1 ?? 0, b2 ?? 0, b3 ?? 0, b4 ?? 0],
      colorOf: (v: number) => (v <= 0 ? COLOR_ZERO : q(v)),
    };
  }, [provLookup]);

  const cuotaNacional = useMemo(() => {
    if (!data || !marcaSel) return 0;
    const totalMarca = data.totalMarcaNacional.get(marcaSel) ?? 0;
    return data.totalNacional > 0 ? (totalMarca / data.totalNacional) * 100 : 0;
  }, [data, marcaSel]);

  if (error) {
    return (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <p className="text-sm text-red-600">No se pudo cargar el dataset: {error}</p>
      </section>
    );
  }
  if (!data || !marcaSel) {
    return (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <p className="text-sm text-slate-500">Cargando datos por marca…</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Cuota de mercado provincial — {marcaSel}
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Porcentaje de matriculaciones de la marca sobre el total provincial · año{" "}
            {data.anioActivo}
            {/* Si solo hay datos parciales del ano (mes en curso), lo flag */}
            {data.aniosDisponibles[data.aniosDisponibles.length - 1] === data.anioActivo &&
              " (puede incluir datos parciales del año en curso)"}
          </p>
        </div>
        <div>
          <label
            htmlFor="cuota-marca-select"
            className="block text-sm font-semibold text-slate-700 mb-2"
          >
            Marca
          </label>
          <select
            id="cuota-marca-select"
            value={marcaSel}
            onChange={(e) => setMarcaSel(e.target.value)}
            className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
          >
            {data.marcas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!geoJson ? (
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
                  const provCode = String(geo.properties.prov ?? "").padStart(2, "0");
                  const provName = String(geo.properties.name ?? "");
                  const cell = provLookup[provCode];
                  const cuota = cell?.cuota ?? 0;
                  const isHovered = hoveredProvince === provName;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={scale.colorOf(cuota)}
                      stroke={isHovered ? "#C4922A" : "#94a3b8"}
                      strokeWidth={isHovered ? 2 : 0.4}
                      onMouseEnter={(evt) => {
                        setHoveredProvince(provName);
                        setTooltip({
                          x: evt.clientX,
                          y: evt.clientY,
                          provName,
                          matric: cell?.matric ?? 0,
                          cuota,
                          cuotaNacional,
                        });
                      }}
                      onMouseMove={(evt) => {
                        setTooltip((t) =>
                          t ? { ...t, x: evt.clientX, y: evt.clientY } : null,
                        );
                      }}
                      onMouseLeave={() => {
                        setHoveredProvince(null);
                        setTooltip(null);
                      }}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", opacity: 0.8, cursor: "pointer" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
          {tooltip && (
            <div
              className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-sm pointer-events-none"
              style={{ left: tooltip.x + 12, top: tooltip.y + 12, maxWidth: 320 }}
            >
              <div className="font-semibold text-slate-900 mb-1">{tooltip.provName}</div>
              <div className="text-slate-600">
                Matriculaciones {marcaSel}:{" "}
                <span className="font-semibold text-slate-900">
                  {formatInt(tooltip.matric)}
                </span>
              </div>
              <div className="text-slate-600">
                Cuota provincial:{" "}
                <span className="font-semibold text-blue-700">
                  {formatDec(tooltip.cuota)}%
                </span>
              </div>
              <div className="text-slate-600 mt-1 text-xs">
                {(() => {
                  const delta = tooltip.cuota - tooltip.cuotaNacional;
                  const sign = delta >= 0 ? "+" : "";
                  const verb = delta >= 0 ? "sobre" : "respecto a";
                  return `${sign}${formatDec(delta)} pp ${verb} la media nacional (${formatDec(
                    tooltip.cuotaNacional,
                  )}%)`;
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      <MapLegendQuantile
        breaks={scale.breaks}
        colors={COLOR_BUCKETS}
        zeroColor={COLOR_ZERO}
        format={(v) => `${formatDec(v)}%`}
        footer={`cuota nacional ${marcaSel}: ${formatDec(cuotaNacional)}%`}
      />
    </section>
  );
}
