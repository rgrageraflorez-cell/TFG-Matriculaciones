import React from "react";
import CapacidadesLimitesTabla from "./utils/CapacidadesLimitesTabla";

const PERSPECTIVAS: { titulo: string; texto: string }[] = [
  {
    titulo: "Descriptiva",
    texto:
      "Exploración de la evolución histórica de las matriculaciones a nivel nacional, provincial y municipal, con análisis temporal en escala anual, mensual y diaria.",
  },
  {
    titulo: "Predictiva",
    texto:
      "Predicción mensual mediante TBATS y Prophet, distribución diaria intermensual con el Modelo MD y simulador de escenarios de impacto sobre la demanda.",
  },
  {
    titulo: "Cognitiva",
    texto:
      "Detección automática de alertas de mercado, análisis de concentración de marcas, identificación de anomalías fiscales (bonificación IVTM) y caracterización tipológica del territorio.",
  },
];

const FICHA: { campo: string; valor: string }[] = [
  { campo: "Fuente principal", valor: "Dirección General de Tráfico (DGT)" },
  {
    campo: "Fuentes complementarias",
    valor:
      "Instituto Nacional de Estadística (INE) — población y renta municipal",
  },
  { campo: "Variable objetivo", valor: "Matriculaciones de turismos" },
  {
    campo: "Ámbito geográfico",
    valor: "España: nacional, provincial y municipal",
  },
  { campo: "Granularidad temporal", valor: "Anual, mensual y diaria" },
  {
    campo: "Modelos de predicción mensual",
    valor:
      "TBATS y Prophet. Prophet seleccionado por mejor generalización post-COVID (MAPE 8,56% en test)",
  },
  {
    campo: "Modelo de desagregación diaria",
    valor:
      "Modelo MD: pesos normalizados con función logística, memoria histórica mensual y entropía cruzada categórica. Contribución metodológica original validada externamente sobre datos del sector financiero.",
  },
  {
    campo: "Análisis territorial",
    valor:
      "Regresión y clustering k-means a nivel municipal. Cuatro tipologías identificadas. Detección automática de anomalías por bonificación IVTM.",
  },
  {
    campo: "Automatización",
    valor:
      "Pipeline agéntico de actualización ante nuevos datos publicados mensualmente por la DGT.",
  },
];

const LIMITACIONES: { titulo: string; texto: string }[] = [
  {
    titulo: "Validación temporal del Modelo MD sobre datos DGT",
    texto:
      "restringida a febrero–marzo 2026 por la política de eliminación de ficheros diarios de la DGT. La validación externa sobre datos del sector financiero (2010–2025) mitiga parcialmente esta restricción.",
  },
  {
    titulo: "Divergencia entre análisis y dashboard",
    texto:
      "el clustering territorial del dashboard reproduce los cuatro grupos mediante reglas heurísticas en lugar de exportar directamente las asignaciones del k-means validado en R.",
  },
  {
    titulo: "Pipeline agéntico",
    texto:
      "no verificado en entorno de producción real con datos DGT en vivo.",
  },
];

export default function FichaTecnicaTab() {
  return (
    <div>
      <header style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: "#1A2B4A",
            letterSpacing: "-0.02em",
            margin: "0 0 6px 0",
            lineHeight: 1.15,
          }}
        >
          Ficha técnica del proyecto
        </h1>
        <p
          className="exec-muted"
          style={{ fontSize: 14, fontStyle: "italic", margin: 0 }}
        >
          MatriX — Análisis de series temporales y modelización territorial de
          la demanda automovilística en España.
        </p>
      </header>

      <h2 className="exec-section-title" style={{ marginBottom: 14 }}>
        Tres perspectivas del dashboard
      </h2>
      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 16, marginBottom: 32 }}
      >
        {PERSPECTIVAS.map((p) => (
          <article
            key={p.titulo}
            className="exec-card"
            style={{ padding: 20, borderLeft: "3px solid #C4922A" }}
          >
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#1A2B4A",
                margin: "0 0 8px 0",
              }}
            >
              {p.titulo}
            </h3>
            <p className="exec-body" style={{ margin: 0 }}>
              {p.texto}
            </p>
          </article>
        ))}
      </div>

      <h2 className="exec-section-title" style={{ marginBottom: 14 }}>
        Ficha técnica
      </h2>
      <div className="exec-card" style={{ overflowX: "auto", marginBottom: 32 }}>
        <table className="exec-table">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Campo</th>
              <th>Valor</th>
            </tr>
          </thead>
          <tbody>
            {FICHA.map((f) => (
              <tr key={f.campo}>
                <td style={{ fontWeight: 600, color: "#1A2B4A" }}>{f.campo}</td>
                <td>{f.valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2
        id="capacidades-limites"
        className="exec-section-title"
        style={{ marginBottom: 8, scrollMarginTop: 80 }}
      >
        Capacidades y límites del sistema
      </h2>
      <p className="exec-body" style={{ margin: "0 0 18px 0", maxWidth: 880 }}>
        MatriX se ha diseñado con criterios explícitos de honestidad
        metodológica. La siguiente tabla declara las capacidades validadas
        del sistema y las limitaciones que el usuario debe tener presentes
        al interpretar los resultados.
      </p>
      <div style={{ marginBottom: 32 }}>
        <CapacidadesLimitesTabla
          bannerPredictivo={
            <p
              style={{
                margin: 0,
                padding: "8px 12px",
                background: "#FFFFFF",
                border: "1px solid #E5E7EB",
                borderLeft: "3px solid #C4922A",
                borderRadius: 4,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#6B7280",
              }}
            >
              <strong style={{ color: "#7A5A12" }}>Aviso de
              monitorización:</strong> el sistema de seguimiento de salud del
              modelo (Protocolo de Silencio) está implementado en el
              dashboard pero opera con datos de demostración hasta que se
              acumule histórico de predicciones mes a mes. Detalle técnico
              en TODO_PERSISTENCIA_PREDICCIONES.md.
            </p>
          }
        />
      </div>

      <h2 className="exec-section-title" style={{ marginBottom: 14 }}>
        Limitaciones reconocidas
      </h2>
      <div className="exec-callout-warn">
        <p className="exec-body" style={{ margin: "0 0 14px 0" }}>
          El proyecto reconoce explícitamente las siguientes limitaciones
          metodológicas:
        </p>
        <ol style={{ margin: 0, paddingLeft: 22 }}>
          {LIMITACIONES.map((l, i) => (
            <li
              key={l.titulo}
              className="exec-body"
              style={{ marginBottom: i === LIMITACIONES.length - 1 ? 0 : 10 }}
            >
              <strong style={{ color: "#1A2B4A" }}>{l.titulo}</strong>: {l.texto}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
