import React, { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { MapDensityRow, GeoJsonType } from "./types";
import { formatInt, formatDec } from "./utils.tsx";
import {
  calcularScoreTerritorial,
  cargarProvinciasLookup,
  cargarTendenciaProvincial,
  colorForScore,
  ESCALA_COLORES_EXPORT,
  type ScoreRow,
} from "./utils/scoreTerritorial";

type Props = {
  mapData: MapDensityRow[];
  geoJson: GeoJsonType | null;
};

type SortKey = "ranking" | "provincia" | "score_final" | "score_demanda" | "score_mercado" | "score_tendencia" | "anomalias";

export default function ScoreTerritorialSection({ mapData, geoJson }: Props) {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>("Inicializando...");
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [provLookup, setProvLookup] = useState<Map<string, string>>(new Map());
  const [tooltip, setTooltip] = useState<{ row: ScoreRow; x: number; y: number } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ranking");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (!mapData.length) return;
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);
        setProgress("Cargando referencia geográfica...");
        const lookup = await cargarProvinciasLookup();
        if (cancelled) return;
        setProvLookup(lookup);

        setProgress("Cargando series temporales (150 MB)...");
        const tend = await cargarTendenciaProvincial(lookup, (m) => !cancelled && setProgress(m));
        if (cancelled) return;

        setProgress("Calculando scores...");
        const rows = await calcularScoreTerritorial(mapData, lookup, tend, (m) =>
          !cancelled && setProgress(m)
        );
        if (cancelled) return;

        setScores(rows);
        setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setLoading(false);
        }
      }
    }
    run();
    return () => { cancelled = true; };
  }, [mapData]);

  // ── Lookup por provincia (normalizada) para el mapa ──
  const scoreByProvCode = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    const nameToCode = new Map<string, string>();
    for (const [code, name] of provLookup) nameToCode.set(name, code);
    for (const r of scores) {
      const code = nameToCode.get(r.provincia);
      if (code) m.set(code, r);
    }
    return m;
  }, [scores, provLookup]);

  const { minScore, maxScore } = useMemo(() => {
    if (!scores.length) return { minScore: 0, maxScore: 100 };
    const vals = scores.map((s) => s.score_final);
    return { minScore: Math.min(...vals), maxScore: Math.max(...vals) };
  }, [scores]);

  // ── Insights automaticos ──
  const insights = useMemo(() => {
    if (!scores.length) return null;
    const top = scores[0];
    const top5 = scores.slice(0, 5);
    const totalNacional = scores.reduce((s, r) => s + r.matriculaciones_brutas, 0);
    const top5Mat = top5.reduce((s, r) => s + r.matriculaciones_brutas, 0);
    const pct = totalNacional > 0 ? (top5Mat / totalNacional) * 100 : 0;
    const nAnomalias = scores.filter(
      (r) => r.anomalias_confirmadas.length > 0 || r.anomalias_potenciales.length > 0
    ).length;
    const topGrowth = [...scores].sort((a, b) => b.crecimiento - a.crecimiento)[0];
    return {
      frase1: `La provincia con mayor oportunidad comercial es ${top.provincia} con un score de ${formatDec(top.score_final, 1)}, impulsada por ${top.dimension_dominante.toLowerCase()}.`,
      frase2: `Las 5 provincias con mayor potencial concentran el ${formatDec(pct, 1)}% del mercado nacional en matriculaciones.`,
      frase3: `${nAnomalias} provincias presentan anomalías territoriales que aconsejan depurar el análisis de demanda antes de tomar decisiones de inversión.`,
      frase4: `La provincia con mayor crecimiento interanual es ${topGrowth.provincia} con un ${formatDec(topGrowth.crecimiento, 1)}% de incremento, independientemente de su posición en el ranking global.`,
    };
  }, [scores]);

  // ── Tabla ordenada ──
  const tabla = useMemo(() => {
    const copy = [...scores];
    const mult = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      let x: number | string = 0, y: number | string = 0;
      switch (sortKey) {
        case "ranking": x = a.ranking; y = b.ranking; break;
        case "provincia": x = a.provincia; y = b.provincia; break;
        case "score_final": x = a.score_final; y = b.score_final; break;
        case "score_demanda": x = a.score_demanda; y = b.score_demanda; break;
        case "score_mercado": x = a.score_mercado; y = b.score_mercado; break;
        case "score_tendencia": x = a.score_tendencia; y = b.score_tendencia; break;
        case "anomalias":
          x = a.anomalias_confirmadas.length * 10 + a.anomalias_potenciales.length;
          y = b.anomalias_confirmadas.length * 10 + b.anomalias_potenciales.length;
          break;
      }
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * mult;
      return ((x as number) - (y as number)) * mult;
    });
    return copy;
  }, [scores, sortKey, sortDir]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "provincia" ? "asc" : "desc");
    }
  };

  const sortIndicator = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  // ── Render ──
  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Score Territorial de Oportunidad</h2>
        <p className="text-slate-500 text-sm mt-1">
          Índice sintético de atractivo comercial por provincia para decisiones de red de distribución.
          Combina demanda actual, tamaño de mercado, tendencia e indicadores de riesgo territorial.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#94a3b8" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="text-sm">{progress}</span>
        </div>
      )}

      {error && (
        <div className="py-6 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4">
          Error al calcular el score: {error}
        </div>
      )}

      {!loading && !error && scores.length > 0 && (
        <>
          {/* ── Insights automaticos ── */}
          {insights && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InsightCard text={insights.frase1} color="emerald" />
              <InsightCard text={insights.frase2} color="blue" />
              <InsightCard text={insights.frase3} color="amber" />
              <InsightCard text={insights.frase4} color="purple" />
            </div>
          )}

          {/* ── Mapa coropleta ── */}
          {geoJson && (
            <div className="relative bg-slate-50 border border-slate-200 rounded-2xl p-3">
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ center: [-3.5, 40.2], scale: 2400 }}
                style={{ width: "100%", height: "auto" }}
              >
                <Geographies geography={geoJson}>
                  {({ geographies }) =>
                    geographies.map((geo: any) => {
                      const provCode = String(geo.properties.prov ?? "").padStart(2, "0");
                      const row = scoreByProvCode.get(provCode);
                      const fill = row ? colorForScore(row.score_final, minScore, maxScore) : "#e5e7eb";
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={fill}
                          stroke="#ffffff"
                          strokeWidth={0.6}
                          onMouseEnter={(evt) => row && setTooltip({ row, x: evt.clientX, y: evt.clientY })}
                          onMouseMove={(evt) => row && setTooltip({ row, x: evt.clientX, y: evt.clientY })}
                          onMouseLeave={() => setTooltip(null)}
                          style={{
                            default: { outline: "none", cursor: "pointer" },
                            hover: { outline: "none", opacity: 0.8 },
                            pressed: { outline: "none" },
                          }}
                        />
                      );
                    })
                  }
                </Geographies>
              </ComposableMap>

              {/* Leyenda */}
              <div className="flex items-center gap-3 mt-4 justify-center">
                <span className="text-xs text-slate-600">Menor oportunidad</span>
                <div className="flex h-3 rounded overflow-hidden border border-slate-300">
                  {ESCALA_COLORES_EXPORT.map((c) => (
                    <div key={c} className="w-10" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="text-xs text-slate-600">Mayor oportunidad</span>
              </div>

              {tooltip && (
                <div
                  className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl px-4 py-3 text-sm pointer-events-none"
                  style={{ left: tooltip.x + 12, top: tooltip.y + 12, minWidth: 240 }}
                >
                  <div className="font-semibold text-slate-900 mb-1">{tooltip.row.provincia}</div>
                  <div className="text-xs text-slate-500 mb-2">Ranking nacional #{tooltip.row.ranking} de {scores.length}</div>
                  <div className="space-y-1">
                    <Row label="Score final" value={formatDec(tooltip.row.score_final, 1)} bold />
                    <Row label="Ratio medio" value={formatDec(tooltip.row.ratio_medio, 2)} />
                    <Row label="Matriculaciones" value={formatInt(tooltip.row.matriculaciones_brutas)} />
                    <Row
                      label="Crecimiento interanual"
                      value={`${tooltip.row.crecimiento >= 0 ? "+" : ""}${formatDec(tooltip.row.crecimiento, 1)}%`}
                    />
                  </div>
                  {(tooltip.row.anomalias_confirmadas.length > 0 || tooltip.row.anomalias_potenciales.length > 0) && (
                    <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-amber-700 flex items-center gap-1">
                      <span>⚠</span> Anomalía territorial detectada
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Tabla ── */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200 text-slate-700">
                  <Th label={`Ranking${sortIndicator("ranking")}`} onClick={() => handleSort("ranking")} />
                  <Th label={`Provincia${sortIndicator("provincia")}`} onClick={() => handleSort("provincia")} align="left" />
                  <Th label={`Score final${sortIndicator("score_final")}`} onClick={() => handleSort("score_final")} />
                  <Th label={`Demanda${sortIndicator("score_demanda")}`} onClick={() => handleSort("score_demanda")} />
                  <Th label={`Mercado${sortIndicator("score_mercado")}`} onClick={() => handleSort("score_mercado")} />
                  <Th label={`Tendencia${sortIndicator("score_tendencia")}`} onClick={() => handleSort("score_tendencia")} />
                  <Th label={`Anomalías${sortIndicator("anomalias")}`} onClick={() => handleSort("anomalias")} />
                </tr>
              </thead>
              <tbody>
                {tabla.map((r) => {
                  const medalla = r.ranking === 1 ? "🥇" : r.ranking === 2 ? "🥈" : r.ranking === 3 ? "🥉" : "";
                  const anomIcon =
                    r.anomalias_confirmadas.length > 0
                      ? { color: "#dc2626", text: "●", title: `Anomalías confirmadas: ${r.anomalias_confirmadas.join(", ")}` }
                      : r.anomalias_potenciales.length > 0
                      ? { color: "#d97706", text: "●", title: `Anomalías potenciales: ${r.anomalias_potenciales.join(", ")}` }
                      : { color: "#059669", text: "●", title: "Sin anomalías detectadas" };
                  return (
                    <tr key={r.provincia} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 text-center font-medium">
                        {medalla} {r.ranking}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900">{r.provincia}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-200 rounded overflow-hidden min-w-[80px]">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${r.score_final}%`,
                                backgroundColor: colorForScore(r.score_final, minScore, maxScore),
                              }}
                            />
                          </div>
                          <span className="font-semibold text-slate-900 w-12 text-right">
                            {formatDec(r.score_final, 1)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">{formatDec(r.score_demanda, 0)}</td>
                      <td className="py-2 px-3 text-center">{formatDec(r.score_mercado, 0)}</td>
                      <td className="py-2 px-3 text-center">{formatDec(r.score_tendencia, 0)}</td>
                      <td className="py-2 px-3 text-center" title={anomIcon.title}>
                        <span style={{ color: anomIcon.color, fontSize: 16 }}>{anomIcon.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function InsightCard({ text, color }: { text: string; color: "emerald" | "blue" | "amber" | "purple" }) {
  const styles: Record<string, string> = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    purple: "bg-purple-50 border-purple-200 text-purple-900",
  };
  return (
    <div className={`rounded-xl border p-4 text-sm leading-relaxed ${styles[color]}`}>
      {text}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={bold ? "font-bold text-slate-900" : "text-slate-700"}>{value}</span>
    </div>
  );
}

function Th({ label, onClick, align = "center" }: { label: string; onClick: () => void; align?: "left" | "center" }) {
  return (
    <th
      className={`py-2 px-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none hover:bg-slate-100 ${
        align === "left" ? "text-left" : "text-center"
      }`}
      onClick={onClick}
    >
      {label}
    </th>
  );
}
