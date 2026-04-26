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
} from "recharts";
import type { PredictionRow } from "./types";
import { formatInt, formatDec, formatMonth } from "./utils.tsx";
import {
  CATALOGO_EVENTOS_DEFAULT,
  cargarEscenariosCalibrados,
  calcularEscenario,
  resumenEscenario,
  kpisEscenario,
  setEscenarioActivo,
  type EventoId,
  type EventoCatalogo,
} from "./utils/simuladorEscenarios";

type Props = {
  predData: PredictionRow[];
  cutoffDate: string;
};

export default function SimuladorEscenariosSection({ predData, cutoffDate }: Props) {
  const [activos, setActivos] = useState<Record<EventoId, boolean>>({
    moves: false,
    tipos_bce: false,
    recesion: false,
    boom: false,
    semiconductores: false,
    campana_sectorial: false,
  });

  // Catálogo "vivo": arranca con los vectores por defecto y se sustituye
  // por los calibrados cuando se carga `escenarios_vectores.json`.
  const [catalogo, setCatalogo] = useState<EventoCatalogo[]>(CATALOGO_EVENTOS_DEFAULT);
  useEffect(() => {
    let cancel = false;
    cargarEscenariosCalibrados().then((c) => { if (!cancel) setCatalogo(c); });
    return () => { cancel = true; };
  }, []);

  const eventosActivos: EventoCatalogo[] = useMemo(
    () => catalogo.filter((e) => activos[e.id]),
    [catalogo, activos],
  );

  const escenario = useMemo(
    () => calcularEscenario(predData, eventosActivos),
    [predData, eventosActivos],
  );

  const resumen = useMemo(
    () => resumenEscenario(predData, eventosActivos),
    [predData, eventosActivos],
  );

  const kpis = useMemo(() => kpisEscenario(escenario), [escenario]);

  // Sincroniza el escenario con el store global para el generador de PDF
  useEffect(() => {
    setEscenarioActivo({
      eventosActivos,
      predicciones: predData,
    });
    return () => setEscenarioActivo(null);
  }, [eventosActivos, predData]);

  const toggle = (id: EventoId) => setActivos((s) => ({ ...s, [id]: !s[id] }));

  const hayEventos = eventosActivos.length > 0;

  return (
    <section className="border-t border-slate-200 pt-8">
      <h2 className="text-2xl font-bold text-slate-900">Simulador de Escenarios</h2>
      <p className="text-slate-500 text-sm mt-1 mb-6">
        Activa uno o varios eventos para visualizar su impacto combinado sobre
        la predicción Prophet. Los efectos se combinan con amortiguación
        progresiva para evitar escenarios irreales.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Columna izquierda: panel de eventos ── */}
        <div className="space-y-3">
          {catalogo.map((ev) => {
            const act = activos[ev.id];
            const badgeClass =
              ev.signo === "positivo"
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-red-100 text-red-700 border border-red-200";
            const borderClass = act
              ? ev.signo === "positivo"
                ? "border-l-4 border-l-emerald-500 bg-white"
                : "border-l-4 border-l-red-500 bg-white"
              : "bg-slate-50 opacity-60";

            return (
              <div
                key={ev.id}
                className={`rounded-xl border border-slate-200 p-4 transition-all ${borderClass}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="font-semibold text-slate-900 text-sm">
                        {ev.nombre}
                      </h4>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}
                      >
                        {ev.impactoLabel}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        {ev.duracionLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{ev.descripcion}</p>
                  </div>

                  {/* Toggle switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={act}
                    onClick={() => toggle(ev.id)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                      act
                        ? ev.signo === "positivo"
                          ? "bg-emerald-500"
                          : "bg-red-500"
                        : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        act ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Bloque resumen */}
          <div className="mt-4 p-4 rounded-xl bg-slate-900/5 border border-slate-200">
            {hayEventos ? (
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Eventos activos
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {resumen.numEventos}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Amortiguación
                  </p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">
                    {formatDec(resumen.factorAmortiguacion * 100)}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Impacto neto
                  </p>
                  <p
                    className={`text-2xl font-bold mt-1 ${
                      resumen.impactoNetoPct >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {resumen.impactoNetoPct >= 0 ? "+" : ""}
                    {formatDec(resumen.impactoNetoPct)}%
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-2">
                Activa eventos para ver su impacto combinado.
              </p>
            )}
          </div>
        </div>

        {/* ── Columna derecha: gráfico ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900 mb-1">
            Impacto sobre la predicción
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Escala en miles de matriculaciones.
          </p>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={escenario}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="fecha_mes"
                  tickFormatter={formatMonth}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  labelFormatter={(l) => formatMonth(String(l))}
                  formatter={(v: any, name: string) => [
                    v == null ? "—" : formatInt(Math.round(Number(v))),
                    name,
                  ]}
                />
                <Legend />
                {cutoffDate && (
                  <ReferenceLine
                    x={cutoffDate}
                    stroke="#94a3b8"
                    strokeDasharray="8 4"
                    label={{
                      value: "Forecast",
                      position: "top",
                      fill: "#64748b",
                      fontSize: 11,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="real"
                  name="Real histórico"
                  stroke="#0A1628"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="pred_prophet"
                  name="Predicción base (Prophet)"
                  stroke="#0A1628"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {hayEventos && (
                  <Line
                    type="monotone"
                    dataKey="pred_escenario"
                    name="Escenario simulado"
                    stroke="#C9A84C"
                    strokeWidth={3}
                    dot={{ r: 3, fill: "#C9A84C" }}
                    connectNulls={false}
                    isAnimationActive={true}
                    animationDuration={600}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* KPIs */}
          {hayEventos && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Impacto acumulado
                </p>
                <p
                  className={`text-xl font-bold mt-1 ${
                    kpis.impactoAcumulado >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {kpis.impactoAcumulado >= 0 ? "+" : ""}
                  {formatInt(Math.round(kpis.impactoAcumulado))}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  matriculaciones sobre el horizonte
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Variación media
                </p>
                <p
                  className={`text-xl font-bold mt-1 ${
                    kpis.variacionMediaPct >= 0
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}
                >
                  {kpis.variacionMediaPct >= 0 ? "+" : ""}
                  {formatDec(kpis.variacionMediaPct)}%
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  mensual respecto a base
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Mayor divergencia
                </p>
                <p className="text-xl font-bold text-slate-900 mt-1">
                  {kpis.mesMayorDivergencia
                    ? formatMonth(kpis.mesMayorDivergencia)
                    : "—"}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {kpis.magnitudMayorDivergencia >= 0 ? "+" : ""}
                  {formatInt(Math.round(kpis.magnitudMayorDivergencia))} matric.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
