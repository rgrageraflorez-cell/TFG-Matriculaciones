import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";
import type { MonthlyBrandRow } from "./types";
import { formatInt, formatDec, formatMonth, seriesTooltip } from "./utils.tsx";
import { getGrupo, colorParaGrupo } from "./utils/gruposEmpresariales";

type Props = {
  brandData: MonthlyBrandRow[];
  dateRange: { start: string; end: string };
};

const COLOR_VERDE = "#15803D";
const COLOR_ROJO = "#B91C1C";

export default function GruposEmpresarialesSection({ brandData, dateRange }: Props) {
  // ── Datos filtrados por rango temporal ─────────────────────────────────
  const filtrado = useMemo(() => {
    return brandData.filter((r) => {
      if (r.marca === "TOTAL MARCAS") return false;
      if (dateRange.start && r.fecha_mes < dateRange.start) return false;
      if (dateRange.end && r.fecha_mes > dateRange.end) return false;
      return true;
    });
  }, [brandData, dateRange]);

  // ── Agregación 1: total por grupo + cuota ──────────────────────────────
  const cuotas = useMemo(() => {
    const totals = new Map<string, number>();
    let granTotal = 0;
    for (const r of filtrado) {
      const g = getGrupo(r.marca);
      totals.set(g, (totals.get(g) ?? 0) + r.matriculaciones);
      granTotal += r.matriculaciones;
    }
    const arr = [...totals.entries()]
      .map(([grupo, total]) => ({
        grupo,
        total,
        cuota: granTotal > 0 ? (total / granTotal) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
    return { lista: arr, granTotal };
  }, [filtrado]);

  // ── Agregación 2: evolución mensual top 5 grupos + línea "Resto" ───────
  // La línea "Resto" agrega los grupos en posición 6+, de modo que la suma
  // de las series cuadra con el total mensual del mercado.
  const evolucion = useMemo(() => {
    const top5 = cuotas.lista.slice(0, 5).map((c) => c.grupo);
    if (top5.length === 0) return { series: [], grupos: [] };
    const top5Set = new Set(top5);
    const hayResto = cuotas.lista.length > 5;
    const RESTO_LABEL = "Resto";
    const byDate = new Map<string, Record<string, number>>();
    for (const r of filtrado) {
      const g = getGrupo(r.marca);
      const key = top5Set.has(g) ? g : (hayResto ? RESTO_LABEL : null);
      if (key === null) continue;
      let entry = byDate.get(r.fecha_mes);
      if (!entry) {
        entry = {};
        byDate.set(r.fecha_mes, entry);
      }
      entry[key] = (entry[key] ?? 0) + r.matriculaciones;
    }
    const grupos = hayResto ? [...top5, RESTO_LABEL] : top5;
    const series = [...byDate.entries()]
      .map(([fecha_mes, vals]) => {
        const row: Record<string, number | string> = { fecha_mes };
        for (const g of grupos) row[g] = vals[g] ?? 0;
        return row as { fecha_mes: string } & Record<string, number>;
      })
      .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));
    return { series, grupos };
  }, [filtrado, cuotas]);

  // ── Agregación 3: variación interanual ─────────────────────────────────
  // Buscar último año completo (12 meses presentes) y el anterior también completo.
  const variacion = useMemo(() => {
    // Meses únicos por año dentro del filtro
    const mesesPorAnio = new Map<number, Set<string>>();
    for (const r of filtrado) {
      const yyyy = parseInt(r.fecha_mes.slice(0, 4), 10);
      const yymm = r.fecha_mes.slice(0, 7);
      if (!mesesPorAnio.has(yyyy)) mesesPorAnio.set(yyyy, new Set());
      mesesPorAnio.get(yyyy)!.add(yymm);
    }
    const aniosCompletos = [...mesesPorAnio.entries()]
      .filter(([, s]) => s.size >= 12)
      .map(([y]) => y)
      .sort((a, b) => a - b);
    if (aniosCompletos.length < 2) {
      return { disponible: false, anioActual: 0, anioPrev: 0, variaciones: [] };
    }
    const anioActual = aniosCompletos[aniosCompletos.length - 1];
    const anioPrev = aniosCompletos[aniosCompletos.length - 2];

    const sumaPorGrupo = (anio: number) => {
      const acc = new Map<string, number>();
      for (const r of filtrado) {
        if (!r.fecha_mes.startsWith(String(anio))) continue;
        const g = getGrupo(r.marca);
        acc.set(g, (acc.get(g) ?? 0) + r.matriculaciones);
      }
      return acc;
    };
    const actual = sumaPorGrupo(anioActual);
    const prev = sumaPorGrupo(anioPrev);
    const grupos = new Set<string>([...actual.keys(), ...prev.keys()]);
    const variaciones = [...grupos]
      .map((grupo) => {
        const a = actual.get(grupo) ?? 0;
        const p = prev.get(grupo) ?? 0;
        const pct = p > 0 ? ((a - p) / p) * 100 : 0;
        return { grupo, anioActual: a, anioPrev: p, variacionPct: pct };
      })
      .sort((a, b) => b.variacionPct - a.variacionPct);
    return { disponible: true, anioActual, anioPrev, variaciones };
  }, [filtrado]);

  // ── KPIs ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const lider = cuotas.lista[0];
    const top3Pct = cuotas.lista.slice(0, 3).reduce((s, g) => s + g.cuota, 0);
    const concentrado = top3Pct >= 60;
    const mayorCrecimiento =
      variacion.disponible && variacion.variaciones.length
        ? variacion.variaciones.find((v) => v.variacionPct > 0) ?? null
        : null;
    return {
      lider,
      top3Pct,
      concentrado,
      mayorCrecimiento,
    };
  }, [cuotas, variacion]);

  // ── Línea vertical de cambio de año en evolución ───────────────────────
  const cambiosAnio = useMemo(() => {
    const out: string[] = [];
    let prev = "";
    for (const row of evolucion.series) {
      const yyyy = String(row.fecha_mes).slice(0, 4);
      if (prev && yyyy !== prev) out.push(String(row.fecha_mes));
      prev = yyyy;
    }
    return out;
  }, [evolucion]);

  if (cuotas.lista.length === 0) {
    return (
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-1">Análisis por Grupo Empresarial</h2>
        <p className="text-slate-500 text-sm">No hay datos en el período seleccionado.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Análisis por Grupo Empresarial</h2>
        <p className="text-slate-500 text-sm mt-1">
          Consolidación del mercado al nivel de grupo automovilístico (Volkswagen Group, Stellantis, etc.)
          aplicando el mapeo marca → matriz corporativa.
        </p>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="exec-label">Grupo líder</p>
          <p className="text-2xl font-bold text-slate-900 mt-2 tnum">
            {kpis.lider?.grupo ?? "—"}
          </p>
          <p className="text-sm exec-accent-gold font-semibold mt-1 tnum">
            {kpis.lider ? `${formatDec(kpis.lider.cuota)}% cuota` : ""}
          </p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="exec-label">Mayor crecimiento</p>
          {kpis.mayorCrecimiento ? (
            <>
              <p className="text-2xl font-bold text-slate-900 mt-2">
                {kpis.mayorCrecimiento.grupo}
              </p>
              <p className="text-sm font-semibold mt-1 tnum" style={{ color: COLOR_VERDE }}>
                +{formatDec(kpis.mayorCrecimiento.variacionPct)}% interanual
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-2">
              Necesarias 2 años completos en el período filtrado
            </p>
          )}
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="exec-label">Concentración Top 3</p>
          <p className="text-2xl font-bold text-slate-900 mt-2 tnum">
            {formatDec(kpis.top3Pct)}%
          </p>
          <p
            className="text-sm font-semibold mt-1"
            style={{ color: kpis.concentrado ? COLOR_ROJO : COLOR_VERDE }}
          >
            {kpis.concentrado ? "Mercado concentrado" : "Mercado competitivo"}
          </p>
        </div>
      </div>

      {/* ── Gráfico 1: cuotas (barras horizontales) ── */}
      <div>
        <h3 className="text-base font-semibold mb-1">Cuota de mercado por grupo empresarial</h3>
        <p className="text-slate-500 text-sm mb-4">
          Volumen total y cuota porcentual en el período seleccionado.
        </p>
        <div style={{ height: Math.max(280, cuotas.lista.length * 38) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={cuotas.lista}
              layout="vertical"
              margin={{ top: 6, right: 110, bottom: 6, left: 24 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => formatInt(Number(v))}
                tick={{ fontSize: 11, fill: "#6B7280" }}
              />
              <YAxis
                type="category"
                dataKey="grupo"
                tick={{ fontSize: 12, fill: "#1A2B4A", fontWeight: 600 }}
                width={150}
              />
              <Tooltip
                formatter={(v: any, _n, p: any) => [
                  `${formatInt(Number(v))} (${formatDec(p?.payload?.cuota ?? 0)}%)`,
                  "Matriculaciones",
                ]}
                labelStyle={{ color: "#1A2B4A", fontWeight: 600 }}
                contentStyle={{
                  background: "#fff",
                  border: "1px solid #E5E7EB",
                  borderRadius: 2,
                }}
              />
              <Bar dataKey="total" radius={[2, 2, 2, 2]}>
                {cuotas.lista.map((c, i) => (
                  <Cell key={c.grupo} fill={colorParaGrupo(c.grupo, i)} />
                ))}
                <LabelList
                  dataKey="cuota"
                  position="right"
                  formatter={(value: any) => `${formatDec(Number(value))}%`}
                  style={{ fill: "#1A2B4A", fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Gráfico 2: evolución top 5 ── */}
      <div>
        <h3 className="text-base font-semibold mb-1">Evolución mensual — Top 5 grupos + Resto</h3>
        <p className="text-slate-500 text-sm mb-4">
          Series temporales mensuales de los cinco grupos con mayor volumen acumulado en el período filtrado;
          la línea gris <strong>Resto</strong> agrega los grupos restantes para que la suma cuadre con el total mensual del mercado.
        </p>
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={evolucion.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="fecha_mes"
                tickFormatter={formatMonth}
                tick={{ fontSize: 11, fill: "#6B7280" }}
              />
              <YAxis
                tickFormatter={(v) => formatInt(Number(v))}
                tick={{ fontSize: 11, fill: "#6B7280" }}
              />
              <Tooltip content={seriesTooltip} />
              <Legend />
              {cambiosAnio.map((d) => (
                <ReferenceLine key={d} x={d} stroke="#94a3b8" strokeDasharray="6 4" />
              ))}
              {evolucion.grupos.map((g, i) => (
                <Line
                  key={g}
                  type="monotone"
                  dataKey={g}
                  name={g}
                  stroke={colorParaGrupo(g, i)}
                  strokeWidth={g === "Resto" ? 1.6 : 2.2}
                  strokeDasharray={g === "Resto" ? "6 4" : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Gráfico 3: variación interanual ── */}
      <div>
        <h3 className="text-base font-semibold mb-1">Variación interanual por grupo empresarial</h3>
        <p className="text-slate-500 text-sm mb-4">
          {variacion.disponible
            ? `Crecimiento porcentual ${variacion.anioActual} vs ${variacion.anioPrev}.`
            : "Selecciona un período de al menos 2 años para ver la variación interanual."}
        </p>
        {variacion.disponible ? (
          <div style={{ height: Math.max(300, variacion.variaciones.length * 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={variacion.variaciones}
                margin={{ top: 12, right: 24, bottom: 36, left: 12 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis
                  dataKey="grupo"
                  tick={{ fontSize: 11, fill: "#1A2B4A" }}
                  angle={-30}
                  textAnchor="end"
                  height={70}
                  interval={0}
                />
                <YAxis
                  tickFormatter={(v) => `${formatDec(Number(v))}%`}
                  tick={{ fontSize: 11, fill: "#6B7280" }}
                />
                <Tooltip
                  formatter={(v: any) => [`${formatDec(Number(v))}%`, "Variación"]}
                  labelStyle={{ color: "#1A2B4A", fontWeight: 600 }}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    borderRadius: 2,
                  }}
                />
                <ReferenceLine y={0} stroke="#1A2B4A" strokeWidth={1.5} />
                <Bar dataKey="variacionPct" radius={[2, 2, 0, 0]}>
                  {variacion.variaciones.map((v) => (
                    <Cell
                      key={v.grupo}
                      fill={v.variacionPct >= 0 ? COLOR_VERDE : COLOR_ROJO}
                    />
                  ))}
                  <LabelList
                    dataKey="variacionPct"
                    position="top"
                    formatter={(value: any) => `${Number(value) >= 0 ? "+" : ""}${formatDec(Number(value))}%`}
                    style={{ fill: "#1A2B4A", fontSize: 11, fontWeight: 600 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center bg-slate-50 border border-slate-200 rounded text-slate-500 text-sm">
            Sin datos suficientes — se requieren 2 años completos en el período filtrado.
          </div>
        )}
      </div>
    </section>
  );
}
