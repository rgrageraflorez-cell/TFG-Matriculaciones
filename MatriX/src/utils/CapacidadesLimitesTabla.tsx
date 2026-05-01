import React from "react";

/**
 * Cada fila representa un par capacidad / limite directamente relacionado.
 * El texto literal viene del brief del Patron 3 y NO debe suavizarse.
 */
type Fila = {
  puede: string;
  noPuede: string;
  /** Componente opcional a renderizar dentro de la celda "puede"
   *  (usado por el banner de mock del Patron 1). */
  bannerPuede?: React.ReactNode;
};

const FILAS: Fila[] = [
  {
    puede:
      "Predecir la demanda mensual nacional de turismos con MAPE de 8,56% (Prophet, validado sobre 12 meses de test).",
    noPuede:
      "Predecir cambios de régimen estructural: crisis económicas, disrupciones tecnológicas, cambios regulatorios disruptivos.",
  },
  {
    puede:
      "Distribuir la predicción mensual a nivel diario mediante el Modelo MD, contribución metodológica original.",
    noPuede:
      "Predecir matriculaciones a nivel municipal individual con la misma precisión que a nivel agregado nacional.",
  },
  {
    puede:
      "Identificar cuatro tipologías municipales mediante clustering k-means sobre variables socioeconómicas.",
    noPuede:
      "Atribuir causalidad a las diferencias observadas entre clusters.",
  },
  {
    puede:
      "Detectar municipios con ratios de matriculación anómalos asociados a bonificación IVTM.",
    noPuede:
      "Determinar la intencionalidad de la domiciliación fiscal en municipios con ventajas tributarias.",
  },
  {
    puede:
      "Simular el impacto de escenarios cualitativos sobre la predicción base mediante vectores de impacto mensual.",
    noPuede:
      "Predecir el comportamiento real del mercado bajo el escenario simulado: el simulador deforma la baseline, no recalibra el modelo bajo régimen distinto.",
  },
  {
    puede:
      "Actualizarse automáticamente con cada publicación mensual de microdatos DGT.",
    noPuede:
      "Operar sin disponibilidad de los microdatos públicos DGT o ante cambios sustanciales en su formato de publicación.",
  },
  {
    puede:
      "Identificar combinaciones marca×provincia con muestra estadísticamente suficiente y marcar como orientativas las consultas con baja fiabilidad.",
    noPuede:
      "Producir estimaciones robustas para marcas con presencia minoritaria en provincias pequeñas (p. ej. supermarcas en provincias rurales).",
  },
  {
    puede:
      "Descomponer variaciones interanuales en componente estacional esperable y desvío estructural, distinguiendo caídas de calendario de cambios reales de mercado.",
    noPuede:
      "Atribuir causalidad a los desvíos estructurales detectados (qué los provoca, cuánto durarán).",
  },
  {
    puede:
      "Analizar la penetración agregada de fabricantes con sede en China en el mercado español, con evolución temporal y distribución provincial.",
    noPuede:
      "Clasificar automáticamente marcas por origen. La clasificación es un listado estático que requiere actualización manual cuando entran nuevos fabricantes al mercado.",
  },
];

// Tonos de fondo: izquierda crema neutro, derecha ambar muy suave (no rojo:
// la columna derecha es advertencia, no emergencia, segun la restriccion 3.2).
const BG_PUEDE = "#FAFAF8";
const BG_NO_PUEDE = "#FEF8E6";
const BORDER_PUEDE = "#E5E7EB";
const BORDER_NO_PUEDE = "#F1D9A4";

type Props = {
  /** Banner opcional para inyectar dentro de la primera celda "puede"
   *  (usado por el Patron 1 para indicar que el monitor opera en modo mock). */
  bannerPredictivo?: React.ReactNode;
};

export default function CapacidadesLimitesTabla({ bannerPredictivo }: Props) {
  const filasConBanner = FILAS.map((f, i) =>
    i === 0 ? { ...f, bannerPuede: bannerPredictivo } : f,
  );

  return (
    <>
      {/* Cabeceras de columna - solo visibles en >= md */}
      <div
        className="hidden md:grid"
        style={{
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div
          className="exec-label"
          style={{ paddingLeft: 14, color: "#1A2B4A", fontWeight: 700 }}
        >
          Lo que MatriX puede hacer
        </div>
        <div
          className="exec-label"
          style={{ paddingLeft: 14, color: "#7A5A12", fontWeight: 700 }}
        >
          Lo que MatriX NO puede hacer
        </div>
      </div>

      {/* Filas: en >=md, dos columnas; en mobile, apilado con encabezados */}
      <div
        className="grid"
        style={{
          gap: 12,
          gridTemplateColumns: "1fr",
        }}
      >
        {/* MOBILE: bloques apilados con sub-encabezados */}
        <div className="md:hidden">
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1A2B4A",
              margin: "0 0 8px 0",
            }}
          >
            Capacidades
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 18px 0" }}>
            {filasConBanner.map((f, i) => (
              <li
                key={`m-p-${i}`}
                style={{
                  background: BG_PUEDE,
                  border: `1px solid ${BORDER_PUEDE}`,
                  borderLeft: "3px solid #1A2B4A",
                  borderRadius: 4,
                  padding: 14,
                  marginBottom: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#2D2D2D",
                }}
              >
                {f.puede}
                {f.bannerPuede ? <div style={{ marginTop: 10 }}>{f.bannerPuede}</div> : null}
              </li>
            ))}
          </ul>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#7A5A12",
              margin: "0 0 8px 0",
            }}
          >
            Limitaciones
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {FILAS.map((f, i) => (
              <li
                key={`m-n-${i}`}
                style={{
                  background: BG_NO_PUEDE,
                  border: `1px solid ${BORDER_NO_PUEDE}`,
                  borderLeft: "3px solid #C4922A",
                  borderRadius: 4,
                  padding: 14,
                  marginBottom: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#2D2D2D",
                }}
              >
                {f.noPuede}
              </li>
            ))}
          </ul>
        </div>

        {/* DESKTOP: dos columnas pareadas por fila */}
        <div className="hidden md:block">
          {filasConBanner.map((f, i) => (
            <div
              key={`d-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  background: BG_PUEDE,
                  border: `1px solid ${BORDER_PUEDE}`,
                  borderLeft: "3px solid #1A2B4A",
                  borderRadius: 4,
                  padding: 14,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#2D2D2D",
                }}
              >
                {f.puede}
                {f.bannerPuede ? <div style={{ marginTop: 12 }}>{f.bannerPuede}</div> : null}
              </div>
              <div
                style={{
                  background: BG_NO_PUEDE,
                  border: `1px solid ${BORDER_NO_PUEDE}`,
                  borderLeft: "3px solid #C4922A",
                  borderRadius: 4,
                  padding: 14,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#2D2D2D",
                }}
              >
                {f.noPuede}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
