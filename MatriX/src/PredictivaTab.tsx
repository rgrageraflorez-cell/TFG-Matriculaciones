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
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import type { PredictionRow, DailyPredRow } from "./types";
import { parseNumber, formatInt, formatDec, formatMonth, fetchCsv, seriesTooltip } from "./utils.tsx";
import SimuladorEscenariosSection from "./SimuladorEscenariosSection";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DOW_LABELS: Record<string, string> = {
  lunes: "L", martes: "M", miercoles: "X", jueves: "J",
  viernes: "V", sabado: "S", domingo: "D",
};

export default function PredictivaTab() {
  const [predData, setPredData] = useState<PredictionRow[]>([]);
  const [dailyData, setDailyData] = useState<DailyPredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [pred, daily] = await Promise.all([
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
          fetchCsv<DailyPredRow>("/df_md_diario.csv", (r) => {
            const fecha = String(r.fecha ?? "").slice(0, 10);
            if (!fecha || !DATE_RE.test(fecha)) return null;
            return {
              fecha: fecha,
              real: parseNumber(r.real) ?? 0,
              pred_md: parseNumber(r.pred_md) ?? 0,
              pred_baseline: parseNumber(r.pred_baseline) ?? 0,
              dow: String(r.dow ?? ""),
              laborable: parseNumber(r.laborable) ?? 0,
              w_opt: parseNumber(r.w_opt) ?? 0,
              alpha_opt: parseNumber(r.alpha_opt) ?? 0,
            };
          }).catch(() => [] as DailyPredRow[]),
        ]);
        if (!cancelled) {
          setPredData(pred.sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes)));
          setDailyData(daily.sort((a, b) => a.fecha.localeCompare(b.fecha)));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Error al cargar predicciones");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── TBATS metrics ──
  const cutoffDate = useMemo(() => {
    const lastReal = [...predData].reverse().find((d) => d.real !== null);
    return lastReal?.fecha_mes ?? "";
  }, [predData]);

  const metrics = useMemo(() => {
    const overlap = predData.filter((d) => d.real !== null && d.prediccion !== null);
    if (!overlap.length) return { rmse: 0, mape: 0, n: 0 };
    let sumSqErr = 0, sumAbsPctErr = 0, count = 0;
    for (const d of overlap) {
      const r = d.real!, p = d.prediccion!;
      sumSqErr += (r - p) ** 2;
      if (r !== 0) { sumAbsPctErr += Math.abs((r - p) / r); count++; }
    }
    return { rmse: Math.sqrt(sumSqErr / overlap.length), mape: count > 0 ? (sumAbsPctErr / count) * 100 : 0, n: overlap.length };
  }, [predData]);

  const prophetMetrics = useMemo(() => {
    const overlap = predData.filter((d) => d.real !== null && d.pred_prophet !== null);
    if (!overlap.length) return null;
    let sumSqErr = 0, sumAbsPctErr = 0, count = 0;
    for (const d of overlap) {
      const r = d.real!, p = d.pred_prophet!;
      sumSqErr += (r - p) ** 2;
      if (r !== 0) { sumAbsPctErr += Math.abs((r - p) / r); count++; }
    }
    return { rmse: Math.sqrt(sumSqErr / overlap.length), mape: count > 0 ? (sumAbsPctErr / count) * 100 : 0, n: overlap.length };
  }, [predData]);

  const hasProphet = predData.some((d) => d.pred_prophet !== null);

  const predKPIs = useMemo(() => {
    const realEntries = predData.filter((d) => d.real !== null);
    // Preferir Prophet como modelo principal; TBATS como fallback
    const futureEntries = predData.filter(
      (d) => d.real === null && (d.pred_prophet !== null || d.prediccion !== null)
    );
    const lastReal = realEntries.length ? Number(realEntries[realEntries.length - 1].real) : 0;
    const lastRealDate = realEntries.length ? realEntries[realEntries.length - 1].fecha_mes : "";
    const nextRow = futureEntries[0];
    const nextPred = nextRow
      ? Number(nextRow.pred_prophet ?? nextRow.prediccion ?? 0)
      : 0;
    const horizonte = futureEntries.length;
    return { lastReal, lastRealDate, nextPred, horizonte };
  }, [predData]);

  // ── MD Daily metrics ──
  const dailyMetrics = useMemo(() => {
    if (!dailyData.length) return null;
    const lab = dailyData.filter(d => d.laborable === 1 && d.real > 0);
    if (!lab.length) return null;

    const rmse_md = Math.sqrt(lab.reduce((s, d) => s + (d.real - d.pred_md) ** 2, 0) / lab.length);
    const rmse_bl = Math.sqrt(lab.reduce((s, d) => s + (d.real - d.pred_baseline) ** 2, 0) / lab.length);
    const mape_md = (lab.reduce((s, d) => s + Math.abs((d.real - d.pred_md) / d.real), 0) / lab.length) * 100;
    const mape_bl = (lab.reduce((s, d) => s + Math.abs((d.real - d.pred_baseline) / d.real), 0) / lab.length) * 100;
    const mejora = ((rmse_bl - rmse_md) / rmse_bl) * 100;

    // Get model parameters (from last row)
    const lastRow = dailyData[dailyData.length - 1];

    // Monthly breakdown
    const months = Array.from(new Set(dailyData.map(d => d.fecha.slice(0, 7)))).sort();

    return { rmse_md, rmse_bl, mape_md, mape_bl, mejora, months, w: lastRow.w_opt, alpha: lastRow.alpha_opt, nDays: lab.length };
  }, [dailyData]);

  // Daily error chart data
  const dailyErrorData = useMemo(() => {
    if (!dailyData.length) return [];
    return dailyData.filter(d => d.laborable === 1).map(d => ({
      fecha: d.fecha,
      error_md: Math.round(d.real - d.pred_md),
      error_baseline: Math.round(d.real - d.pred_baseline),
    }));
  }, [dailyData]);

  // Daily chart data with formatted labels
  const dailyChartData = useMemo(() => {
    return dailyData.map(d => ({
      ...d,
      label: `${d.fecha.slice(8, 10)} ${DOW_LABELS[d.dow] ?? d.dow}`,
    }));
  }, [dailyData]);

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-500">Cargando modelos predictivos...</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center py-20 text-red-600">{error}</div>;
  }

  return (
    <div className="space-y-8">
      {/* ══ PROPHET SECTION (modelo mensual principal) ══ */}
      <h2 className="text-2xl font-bold text-slate-900">Serie mensual: {hasProphet ? "modelo Prophet (principal) vs TBATS" : "modelo TBATS"}</h2>

      {/* Prediction KPIs */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Ultimo dato real</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{formatInt(predKPIs.lastReal)}</p>
          <p className="text-xs text-slate-400 mt-1">{formatMonth(predKPIs.lastRealDate)}</p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Proxima prediccion {hasProphet ? "(Prophet)" : "(TBATS)"}</p>
          <p className="text-3xl font-bold text-emerald-600 mt-2">{formatInt(predKPIs.nextPred)}</p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">Horizonte de prediccion</p>
          <p className="text-3xl font-bold text-slate-900 mt-2">{predKPIs.horizonte}</p>
          <p className="text-xs text-slate-400 mt-1">meses futuros</p>
        </div>
        <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
          <p className="text-sm text-slate-500">MAPE (backtest) {hasProphet ? "Prophet" : "TBATS"}</p>
          <p className="text-3xl font-bold text-emerald-600 mt-2">
            {formatDec(hasProphet && prophetMetrics ? prophetMetrics.mape : metrics.mape)}%
          </p>
          <p className="text-xs text-slate-400 mt-1">
            sobre {hasProphet && prophetMetrics ? prophetMetrics.n : metrics.n} meses
          </p>
        </div>
      </section>

      {/* Main prediction chart */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-xl font-semibold mb-1">{hasProphet ? "Real vs Prophet vs TBATS" : "TBATS: Real vs Prediccion"}</h3>
        <p className="text-slate-500 text-sm mb-5">
          Serie historica real (naranja){hasProphet ? ", prediccion Prophet (verde, modelo principal) y TBATS (azul punteado, comparativa)" : " y prediccion TBATS (azul)"}. La linea vertical punteada marca el inicio de la prediccion futura.
        </p>
        <div className="h-[460px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={predData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="fecha_mes" tickFormatter={formatMonth} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => formatInt(Number(v))} />
              <Tooltip content={seriesTooltip} />
              <Legend />
              {cutoffDate && (
                <ReferenceLine x={cutoffDate} stroke="#94a3b8" strokeDasharray="8 4"
                  label={{ value: "Prediccion", position: "top", fill: "#64748b", fontSize: 12 }} />
              )}
              <Line type="monotone" dataKey="real" name="Real" stroke="#f97316" strokeWidth={3} dot={false} connectNulls={false} />
              {hasProphet && (
                <Line type="monotone" dataKey="pred_prophet" name="Prophet (principal)" stroke="#10b981" strokeWidth={3} dot={false} connectNulls={false} />
              )}
              <Line
                type="monotone"
                dataKey="prediccion"
                name={hasProphet ? "TBATS (comparativa)" : "Prediccion TBATS"}
                stroke="#2563eb"
                strokeWidth={hasProphet ? 2 : 3}
                strokeDasharray={hasProphet ? "6 3" : undefined}
                dot={false}
                connectNulls={false}
              />

            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ══ MD DAILY SECTION ══ */}
      {dailyData.length > 0 && dailyMetrics && (
        <>
          <div className="border-t border-slate-200 pt-8">
            <h2 className="text-2xl font-bold text-slate-900">Serie diaria: modelo MD</h2>
            <p className="text-slate-500 text-sm mt-1">
              Modelo de distribucion diaria (MD) que desagrega el forecast mensual en predicciones por dia,
              usando efecto dia de la semana y pesos historicos. Parametros optimizados: w = {formatDec(dailyMetrics.w)}, alpha = {formatDec(dailyMetrics.alpha)}.
            </p>
          </div>

          {/* MD KPIs */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
              <p className="text-sm text-slate-500">RMSE Modelo MD</p>
              <p className="text-3xl font-bold text-blue-700 mt-2">{formatInt(Math.round(dailyMetrics.rmse_md))}</p>
              <p className="text-xs text-slate-400 mt-1">matriculaciones/dia</p>
            </div>
            <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
              <p className="text-sm text-slate-500">RMSE Baseline Naive</p>
              <p className="text-3xl font-bold text-red-600 mt-2">{formatInt(Math.round(dailyMetrics.rmse_bl))}</p>
              <p className="text-xs text-slate-400 mt-1">matriculaciones/dia</p>
            </div>
            <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
              <p className="text-sm text-slate-500">Mejora MD vs Baseline</p>
              <p className="text-3xl font-bold text-emerald-600 mt-2">{formatDec(dailyMetrics.mejora)}%</p>
              <p className="text-xs text-slate-400 mt-1">reduccion del RMSE</p>
            </div>
            <div className="bg-white border border-[#E5E7EB] border-l-[3px] border-l-[#1A2B4A] rounded p-5">
              <p className="text-sm text-slate-500">MAPE Modelo MD</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">{formatDec(dailyMetrics.mape_md)}%</p>
              <p className="text-xs text-slate-400 mt-1">sobre {dailyMetrics.nDays} dias laborables</p>
            </div>
          </section>

          {/* Daily prediction chart: Real vs MD vs Baseline */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-semibold mb-1">Distribucion diaria: Real vs MD vs Baseline</h3>
            <p className="text-slate-500 text-sm mb-5">
              Matriculaciones reales (negro) frente a la prediccion del modelo MD (azul) y el baseline naive (rojo).
              Los fines de semana y festivos muestran 0 matriculaciones por diseno del modelo.
            </p>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="fecha" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tickFormatter={(v) => formatInt(Number(v))} />
                  <Tooltip
                    formatter={(v: any, name: string) => [formatInt(Math.round(Number(v))), name]}
                    labelFormatter={(l) => String(l)}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="real" name="Real" stroke="#1e293b" strokeWidth={2.5} dot={{ r: 2.5 }} />
                  <Line type="monotone" dataKey="pred_md" name="Modelo MD" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 2 }} />
                  <Line type="monotone" dataKey="pred_baseline" name="Baseline naive" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 1.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Daily error chart */}
          {dailyErrorData.length > 0 && (
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-xl font-semibold mb-1">Error diario: MD vs Baseline (dias laborables)</h3>
              <p className="text-slate-500 text-sm mb-5">
                Error = Real - Prediccion. Valores cercanos a 0 indican mayor precision.
              </p>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyErrorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="fecha" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tickFormatter={(v) => formatInt(Number(v))} />
                    <Tooltip formatter={(v: any, name: string) => [formatInt(Number(v)), name]} />
                    <Legend />
                    <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
                    <Bar dataKey="error_md" name="Error MD" fill="#2563eb" opacity={0.8} />
                    <Bar dataKey="error_baseline" name="Error Baseline" fill="#dc2626" opacity={0.5} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </>
      )}

      {/* ══ METRICS TABLE ══ */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-semibold mb-5">Metricas de evaluacion</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Modelo</th>
                <th className="text-left py-3 px-4 font-semibold text-slate-700">Frecuencia</th>
                <th className="text-right py-3 px-4 font-semibold text-slate-700">RMSE</th>
                <th className="text-right py-3 px-4 font-semibold text-slate-700">MAPE (%)</th>
                <th className="text-right py-3 px-4 font-semibold text-slate-700">Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {prophetMetrics && (
                <tr className="border-b border-slate-100 bg-emerald-50/70">
                  <td className="py-3 px-4 font-semibold text-emerald-700">Prophet (principal)</td>
                  <td className="py-3 px-4 text-slate-500">Mensual</td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-700">{formatInt(Math.round(prophetMetrics.rmse))}</td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-700">{formatDec(prophetMetrics.mape)}</td>
                  <td className="py-3 px-4 text-right">{prophetMetrics.n} meses</td>
                </tr>
              )}
              <tr className="border-b border-slate-100">
                <td className="py-3 px-4 font-medium text-slate-600">TBATS {prophetMetrics ? "(comparativa)" : ""}</td>
                <td className="py-3 px-4 text-slate-500">Mensual</td>
                <td className="py-3 px-4 text-right font-mono">{formatInt(Math.round(metrics.rmse))}</td>
                <td className="py-3 px-4 text-right font-mono">{formatDec(metrics.mape)}</td>
                <td className="py-3 px-4 text-right">{metrics.n} meses</td>
              </tr>
              {dailyMetrics && (
                <>
                  <tr className="border-b border-slate-100 bg-blue-50/50">
                    <td className="py-3 px-4 font-medium text-blue-700">Modelo MD</td>
                    <td className="py-3 px-4 text-slate-500">Diaria</td>
                    <td className="py-3 px-4 text-right font-mono text-blue-700">{formatInt(Math.round(dailyMetrics.rmse_md))}</td>
                    <td className="py-3 px-4 text-right font-mono text-blue-700">{formatDec(dailyMetrics.mape_md)}</td>
                    <td className="py-3 px-4 text-right">{dailyMetrics.nDays} dias lab.</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 px-4 font-medium text-red-600">Baseline naive</td>
                    <td className="py-3 px-4 text-slate-500">Diaria</td>
                    <td className="py-3 px-4 text-right font-mono text-red-600">{formatInt(Math.round(dailyMetrics.rmse_bl))}</td>
                    <td className="py-3 px-4 text-right font-mono text-red-600">{formatDec(dailyMetrics.mape_bl)}</td>
                    <td className="py-3 px-4 text-right">{dailyMetrics.nDays} dias lab.</td>
                  </tr>
                </>
              )}
              {!dailyMetrics && (
                <tr className="border-b border-slate-100 text-slate-400">
                  <td className="py-3 px-4 font-medium">Modelo MD (diario)</td>
                  <td className="py-3 px-4">Diaria</td>
                  <td className="py-3 px-4 text-right italic" colSpan={3}>
                    Ejecutar: Rscript pipeline/export_md_diario.R
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-4">
          RMSE = Error cuadratico medio. MAPE = Error porcentual absoluto medio.
          El modelo MD desagrega el forecast mensual en pesos diarios optimizados por entropia cruzada.
          El baseline naive replica los pesos del mes anterior sin aprendizaje parametrico (w=1).
        </p>
      </section>

      {/* ══ SIMULADOR DE ESCENARIOS ══ */}
      <SimuladorEscenariosSection predData={predData} cutoffDate={cutoffDate} />
    </div>
  );
}
