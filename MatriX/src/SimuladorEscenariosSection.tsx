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
import type { PredictionRow, TabId } from "./types";
import { formatInt, formatDec, formatMonth } from "./utils.tsx";
import { navigateToSection } from "./utils/scrollToSection";
import { TrendingUp, Minus, TrendingDown } from "lucide-react";
import {
  CATALOGO_EVENTOS_DEFAULT,
  cargarEscenariosCalibrados,
  calcularEscenario,
  resumenEscenario,
  kpisEscenario,
  setEscenarioActivo,
  buildCustomVector,
  type EventoId,
  type EventoCatalogo,
  type TipoImpacto,
} from "./utils/simuladorEscenarios";

type Props = {
  predData: PredictionRow[];
  cutoffDate: string;
  onNavigate?: (tab: TabId) => void;
};

// Indexado 1..12 (idx 0 vacio para escribir mesInicio 1..12 directo).
const MESES_ES = [
  "",
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export default function SimuladorEscenariosSection({ predData, cutoffDate, onNavigate }: Props) {
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

  // ── Estado del escenario personalizado (Cambio 4) ─────────────────────
  // Bloque aparte de los 6 eventos calibrados. customAplicado === null
  // significa "no hay personalizado activo"; cuando != null se inyecta
  // como un EventoCatalogo mas en eventosActivos sin tocar los toggles.
  const DURACIONES_OPCIONES = [1, 2, 3, 4, 6, 9, 12];
  const [customDraft, setCustomDraft] = useState<{
    magnitud: number;
    duracion: number;
    mesInicio: number; // calendar month 1..12
    tipoImpacto: TipoImpacto;
  }>({ magnitud: 10, duracion: 3, mesInicio: 1, tipoImpacto: "sostenido" });
  const [customAplicado, setCustomAplicado] = useState<EventoCatalogo | null>(null);

  // Meses del forecast disponibles (filas con real null y prediccion no null)
  // ordenados ascendentemente. Usados para poblar el selector "mes inicio"
  // y para validar la duracion contra el horizonte.
  const mesesForecast = useMemo(() => {
    return predData
      .filter((d) => d.real == null && (d.pred_prophet != null || d.prediccion != null))
      .map((d) => d.fecha_mes)
      .sort();
  }, [predData]);

  // Inicializa mesInicio al primer mes del forecast disponible, si existe.
  useEffect(() => {
    if (mesesForecast.length === 0) return;
    const primerMes = parseInt(mesesForecast[0].slice(5, 7), 10);
    if (Number.isFinite(primerMes)) {
      setCustomDraft((d) => ({ ...d, mesInicio: primerMes }));
    }
  }, [mesesForecast.length]);

  // Validaciones del escenario personalizado (4.4 del brief).
  const customError: string | null = useMemo(() => {
    if (customDraft.magnitud === 0) return "La magnitud no puede ser 0.";
    return null;
  }, [customDraft.magnitud]);

  // Recorte automatico: si mesInicio + duracion supera los meses disponibles
  // del forecast, recortamos y mostramos aviso.
  const horizonteDesdeInicio = useMemo(() => {
    if (mesesForecast.length === 0) return 0;
    const idxInicio = mesesForecast.findIndex(
      (f) => parseInt(f.slice(5, 7), 10) === customDraft.mesInicio,
    );
    if (idxInicio < 0) return mesesForecast.length;
    return mesesForecast.length - idxInicio;
  }, [mesesForecast, customDraft.mesInicio]);
  const duracionRecortada = Math.min(customDraft.duracion, horizonteDesdeInicio);
  const huboRecorte = duracionRecortada !== customDraft.duracion && horizonteDesdeInicio > 0;

  const aplicarPersonalizado = () => {
    if (customError) return;
    const vec = buildCustomVector(
      customDraft.magnitud,
      duracionRecortada,
      customDraft.mesInicio,
      customDraft.tipoImpacto,
    );
    const sumaTotal = vec.reduce((s, v) => s + v, 0);
    const sign = sumaTotal >= 0 ? "+" : "";
    const mesNombre = MESES_ES[customDraft.mesInicio] ?? `mes ${customDraft.mesInicio}`;
    const evento: EventoCatalogo = {
      id: "personalizado",
      nombre: "Escenario personalizado",
      descripcion: `Impacto definido por el usuario, aplicado sobre la baseline del forecast.`,
      impactoMensualPct: vec,
      impactoLabel: `${sign}${formatDec(sumaTotal)}% en ${duracionRecortada} mes${duracionRecortada === 1 ? "" : "es"}`,
      duracionMeses: null,
      duracionLabel: `Desde ${mesNombre} (${duracionRecortada} m)`,
      signo: sumaTotal >= 0 ? "positivo" : "negativo",
      aplicacionPosicional: false,
    };
    setCustomAplicado(evento);
  };

  const quitarPersonalizado = () => setCustomAplicado(null);

  /*
   * TODO Persistencia de escenarios personalizados (omitida en esta
   * iteracion por superar el umbral de 20 lineas que pidio el brief).
   * Para implementarla:
   *   1. Cargar al montar:
   *        const guardados = JSON.parse(
   *          localStorage.getItem("matrix.scenarios") ?? "[]"
   *        );
   *   2. Estado nuevo: const [guardados, setGuardados] = useState(guardados).
   *   3. Botones nuevos: "Guardar como..." (input nombre max 30) y lista
   *      de hasta 5 escenarios con [Cargar] [Eliminar].
   *   4. Al guardar:
   *        const list = [{ nombre, ...customDraft, savedAt: Date.now() },
   *                      ...guardados].slice(0, 5);
   *        localStorage.setItem("matrix.scenarios", JSON.stringify(list));
   *        setGuardados(list);
   *   5. Aviso fijo: "Los escenarios guardados solo persisten en este
   *      navegador."
   * Estimacion: 25-30 lineas TSX + 5 useEffect + 3 helpers.
   */

  // Combina toggles de catalogo + escenario personalizado activo.
  const eventosActivos: EventoCatalogo[] = useMemo(() => {
    const calibrados = catalogo.filter((e) => activos[e.id]);
    return customAplicado ? [...calibrados, customAplicado] : calibrados;
  }, [catalogo, activos, customAplicado]);

  const escenario = useMemo(
    () => calcularEscenario(predData, eventosActivos),
    [predData, eventosActivos],
  );

  // Solo el escenario personalizado, para mostrar como linea cyan
  // diferenciada del escenario combinado en el chart.
  const escenarioSoloPersonalizado = useMemo(() => {
    if (!customAplicado) return null;
    return calcularEscenario(predData, [customAplicado]);
  }, [predData, customAplicado]);

  // Enriquecemos el array del chart con el campo pred_solo_personalizado.
  const chartData = useMemo(() => {
    if (!escenarioSoloPersonalizado) return escenario;
    const lookup = new Map(
      escenarioSoloPersonalizado.map((r) => [r.fecha_mes, r.pred_escenario]),
    );
    return escenario.map((r) => ({
      ...r,
      pred_solo_personalizado: lookup.get(r.fecha_mes) ?? null,
    }));
  }, [escenario, escenarioSoloPersonalizado]);

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
                    {ev.id === "boom" && onNavigate && (
                      <button
                        type="button"
                        onClick={() =>
                          navigateToSection(onNavigate, "ficha-tecnica", "capacidades-limites")
                        }
                        style={{
                          marginTop: 6,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          color: "#7A5A12",
                          cursor: "pointer",
                          textDecoration: "underline",
                          textDecorationStyle: "dotted",
                          fontSize: 11,
                        }}
                      >
                        ⚠ Calibración limitada a un único episodio análogo — ver capacidades y límites
                      </button>
                    )}
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

          {/* ── Escenario personalizado (Cambio 4) ─────────────────────── */}
          <div
            className="rounded-xl border p-5"
            style={{
              borderColor: customAplicado ? "#06B6D4" : "#E5E7EB",
              borderLeft: customAplicado ? "4px solid #06B6D4" : "1px solid #E5E7EB",
              background: customAplicado ? "#F0FDFF" : "#FFFFFF",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Escenario personalizado
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Define tu propio impacto sobre la baseline.
                </p>
              </div>
              {customAplicado && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                  style={{ background: "#06B6D4", color: "#fff", letterSpacing: "0.06em" }}
                >
                  Activo
                </span>
              )}
            </div>

            {/* Magnitud: slider + input numerico sincronizados */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Impacto sobre la demanda (%)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={0.5}
                  value={customDraft.magnitud}
                  onChange={(e) =>
                    setCustomDraft((d) => ({ ...d, magnitud: Number(e.target.value) }))
                  }
                  className="flex-1"
                  style={{ accentColor: "#06B6D4" }}
                />
                <input
                  type="number"
                  min={-50}
                  max={50}
                  step={0.5}
                  value={customDraft.magnitud}
                  onChange={(e) =>
                    setCustomDraft((d) => ({ ...d, magnitud: Number(e.target.value) }))
                  }
                  className="w-20 px-2 py-1 border border-slate-300 rounded text-sm text-right"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                />
                <span className="text-sm font-semibold text-slate-700">%</span>
              </div>
              {customError && (
                <p className="text-xs mt-1" style={{ color: "#B91C1C" }}>
                  {customError}
                </p>
              )}
            </div>

            {/* Duracion + Mes inicio: dos selects en fila */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Duración del impacto
                </label>
                <select
                  value={customDraft.duracion}
                  onChange={(e) =>
                    setCustomDraft((d) => ({ ...d, duracion: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                >
                  {DURACIONES_OPCIONES.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "mes" : "meses"}
                    </option>
                  ))}
                </select>
                {huboRecorte && (
                  <p className="text-xs mt-1" style={{ color: "#7A5A12" }}>
                    Duración ajustada a {duracionRecortada} meses por el horizonte del forecast.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mes de inicio
                </label>
                <select
                  value={customDraft.mesInicio}
                  onChange={(e) =>
                    setCustomDraft((d) => ({ ...d, mesInicio: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                >
                  {mesesForecast.slice(0, 12).map((f) => {
                    const m = parseInt(f.slice(5, 7), 10);
                    const y = f.slice(0, 4);
                    return (
                      <option key={f} value={m}>
                        {MESES_ES[m]} {y}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Tipo de impacto: 3 botones radio con icono */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tipo de impacto
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "gradual", label: "Gradual", icon: TrendingUp, hint: "Rampa ascendente" },
                    { id: "sostenido", label: "Sostenido", icon: Minus, hint: "Constante" },
                    { id: "brusco", label: "Brusco", icon: TrendingDown, hint: "Rampa descendente" },
                  ] as const
                ).map(({ id, label, icon: Icon, hint }) => {
                  const sel = customDraft.tipoImpacto === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        setCustomDraft((d) => ({ ...d, tipoImpacto: id as TipoImpacto }))
                      }
                      className="rounded border p-2 text-left transition-colors"
                      style={{
                        borderColor: sel ? "#06B6D4" : "#E5E7EB",
                        background: sel ? "#F0FDFF" : "#fff",
                        color: sel ? "#0E7490" : "#475569",
                        cursor: "pointer",
                      }}
                      title={hint}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon size={14} />
                        <span className="text-xs font-semibold">{label}</span>
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: "#94A3B8" }}>
                        {hint}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Aplicar / Quitar */}
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={aplicarPersonalizado}
                disabled={!!customError || mesesForecast.length === 0}
                className="flex-1 px-4 py-2 rounded text-sm font-semibold transition-colors"
                style={{
                  background: customError ? "#94A3B8" : "#06B6D4",
                  color: "#fff",
                  cursor: customError ? "not-allowed" : "pointer",
                }}
              >
                {customAplicado ? "Reaplicar con cambios" : "Aplicar escenario"}
              </button>
              {customAplicado && (
                <button
                  type="button"
                  onClick={quitarPersonalizado}
                  className="px-4 py-2 rounded text-sm font-semibold border"
                  style={{
                    background: "#fff",
                    color: "#475569",
                    borderColor: "#E5E7EB",
                    cursor: "pointer",
                  }}
                >
                  Quitar
                </button>
              )}
            </div>

            {/* Disclaimer obligatorio (4.6) */}
            <p
              className="text-[11px] leading-relaxed mt-3 p-3 rounded"
              style={{
                background: "#FEF8E6",
                borderLeft: "3px solid #C4922A",
                color: "#7A5A12",
              }}
            >
              El escenario personalizado aplica el impacto definido sobre la
              predicción base mediante un vector de distribución mensual. No
              modela cambios de régimen ni recalibra el modelo subyacente.
              Interprete los resultados como exploración orientativa.
            </p>
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
              <LineChart data={chartData}>
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
                {customAplicado && (
                  <Line
                    type="monotone"
                    dataKey="pred_solo_personalizado"
                    name={`Escenario personalizado (${customDraft.magnitud >= 0 ? "+" : ""}${customDraft.magnitud}%, ${duracionRecortada} m desde ${MESES_ES[customDraft.mesInicio]})`}
                    stroke="#06B6D4"
                    strokeWidth={2.5}
                    strokeDasharray="2 4"
                    dot={{ r: 2.5, fill: "#06B6D4" }}
                    connectNulls={false}
                    isAnimationActive={false}
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
