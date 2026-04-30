import React from "react";

const PROPUESTA: { titulo: string; texto: string }[] = [
  {
    titulo: "Reducción de incertidumbre",
    texto:
      "Predicciones actualizadas mensualmente con un error medio inferior al 9% (MAPE Prophet = 8,56% en test).",
  },
  {
    titulo: "Depuración del análisis territorial",
    texto:
      "Eliminación del ruido estadístico que introducen los municipios con bonificación IVTM, anomalía fiscal documentada que distorsiona los ratios de demanda aparente.",
  },
  {
    titulo: "Automatización de la inteligencia de mercado",
    texto:
      "Generación y distribución de informes sin intervención manual recurrente, gracias al pipeline agéntico que ingiere los datos DGT en cuanto se publican.",
  },
];

const SEGMENTOS: { titulo: string; nivel: string; necesidad: string }[] = [
  {
    titulo: "Fabricantes y distribuidores nacionales",
    nivel: "Cliente primario de mayor valor",
    necesidad:
      "Planificación de producción y red de distribución a medio plazo. El score territorial de oportunidad y el clustering municipal permite identificar zonas de expansión con base empírica.",
  },
  {
    titulo: "Entidades financieras del sector automovilístico",
    nivel: "Cliente primario de alto potencial",
    necesidad:
      "Anticipar el volumen de contratos de financiación, que comparte estructura de calendario intermensual con las matriculaciones. La validación externa del Modelo MD confirma la transferibilidad directa del sistema a este segmento.",
  },
  {
    titulo: "Concesionarios independientes",
    nivel: "Cliente secundario y canal de validación",
    necesidad:
      "Anticipar picos de demanda para ajustar stock y planificar entregas. El sistema de alertas y el informe mensual automatizado responden directamente a esta necesidad sin requerir conocimiento técnico del usuario.",
  },
];

export default function ModeloNegocioTab() {
  return (
    <div>
      <header style={{ marginBottom: 24 }}>
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
          Modelo de negocio propuesto
        </h1>
        <p
          className="exec-muted"
          style={{ fontSize: 14, fontStyle: "italic", margin: 0 }}
        >
          Análisis de viabilidad y propuesta comercial elaborada en el marco
          del Trabajo Fin de Grado.
        </p>
      </header>

      <div className="exec-callout-warn" style={{ marginBottom: 28 }}>
        <p className="exec-body" style={{ margin: 0 }}>
          Esta sección presenta el modelo de negocio propuesto como parte del
          análisis de viabilidad del proyecto académico. Las cifras
          orientativas reflejan una estimación inicial sujeta a validación de
          mercado.
        </p>
      </div>

      <h2 className="exec-section-title" style={{ marginBottom: 12 }}>
        Contexto y problema
      </h2>
      <div className="exec-card" style={{ padding: 20, marginBottom: 32 }}>
        <p className="exec-body" style={{ margin: "0 0 12px 0" }}>
          El mercado automovilístico español matriculó 1.009.514 turismos en
          2024. La toma de decisiones comerciales en el sector —
          dimensionamiento de stock, planificación de entregas, apertura de
          delegaciones, política de financiación — se apoya con frecuencia en
          información histórica agregada, sin acceso a predicciones
          actualizadas ni a un análisis territorial que distinga la demanda
          orgánica real de los patrones artificiales o estadísticamente
          anómalos.
        </p>
        <p className="exec-body" style={{ margin: 0 }}>
          El problema no es la ausencia de datos: la DGT publica microdatos de
          matriculaciones con periodicidad mensual. El problema es la ausencia
          de herramientas que los transformen en información accionable.
        </p>
      </div>

      <h2 className="exec-section-title" style={{ marginBottom: 14 }}>
        Propuesta de valor
      </h2>
      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 16, marginBottom: 32 }}
      >
        {PROPUESTA.map((p) => (
          <article
            key={p.titulo}
            className="exec-card"
            style={{ padding: 20, borderLeft: "3px solid #1A2B4A" }}
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
        Público objetivo
      </h2>
      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 16, marginBottom: 32 }}
      >
        {SEGMENTOS.map((s) => (
          <article
            key={s.titulo}
            className="exec-card"
            style={{ padding: 20 }}
          >
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#1A2B4A",
                margin: "0 0 4px 0",
              }}
            >
              {s.titulo}
            </h3>
            <p
              className="exec-label"
              style={{ margin: "0 0 10px 0", color: "#C4922A" }}
            >
              {s.nivel}
            </p>
            <p className="exec-body" style={{ margin: 0 }}>
              <strong>Necesidad:</strong> {s.necesidad}
            </p>
          </article>
        ))}
      </div>

      <h2 className="exec-section-title" style={{ marginBottom: 14 }}>
        Estructura del modelo
      </h2>
      <div
        className="grid grid-cols-1 md:grid-cols-2"
        style={{ gap: 16, marginBottom: 24 }}
      >
        <article
          className="exec-card"
          style={{ padding: 20, borderLeft: "3px solid #1A2B4A" }}
        >
          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#1A2B4A",
              margin: "0 0 8px 0",
            }}
          >
            Fase 1 — Proyecto de implantación
          </h3>
          <p className="exec-body" style={{ margin: 0 }}>
            Consultoría analítica de duración acotada (4–8 semanas según
            segmento) que incluye personalización del sistema, integración de
            datos propios del cliente si los hubiera, formación de los equipos
            usuarios y validación del pipeline agéntico en el entorno del
            cliente.
          </p>
        </article>
        <article
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
            Fase 2 — Suscripción de mantenimiento y actualización
          </h3>
          <p className="exec-body" style={{ margin: 0 }}>
            Servicio mensual que garantiza la actualización automática del
            sistema con los nuevos datos DGT, mantenimiento del pipeline
            agéntico, distribución del informe ejecutivo mensual y soporte
            técnico.
          </p>
        </article>
      </div>

      {/* ── OPCIÓN A (activa): SIN precios concretos ───────────────────── */}
      <p
        className="exec-body"
        style={{
          margin: 0,
          padding: "16px 18px",
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderLeft: "3px solid #1A2B4A",
          borderRadius: 4,
        }}
      >
        Las tarifas concretas de cada fase se ajustan en función del segmento
        de cliente y del alcance de personalización requerido. La memoria del
        Trabajo Fin de Grado incluye un detalle pormenorizado de la estructura
        tarifaria estimada por segmento.
      </p>

      {/* ── OPCIÓN B (comentada): CON precios — descomentar si se elige ──
      <div className="exec-card" style={{ overflowX: "auto" }}>
        <table className="exec-table">
          <thead>
            <tr>
              <th>Segmento</th>
              <th>Implantación (Fase 1)</th>
              <th>Suscripción mensual (Fase 2)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 600, color: "#1A2B4A" }}>
                Fabricantes y distribuidores
              </td>
              <td>3.000–8.000 €</td>
              <td>(a definir en memoria del TFG)</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: "#1A2B4A" }}>
                Entidades financieras
              </td>
              <td>3.000–8.000 €</td>
              <td>(a definir en memoria del TFG)</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 600, color: "#1A2B4A" }}>
                Concesionarios independientes
              </td>
              <td>500–1.500 €</td>
              <td>(a definir en memoria del TFG)</td>
            </tr>
          </tbody>
        </table>
      </div>
      ─────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
