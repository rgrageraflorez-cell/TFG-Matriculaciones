import React from "react";
import type { DescomposicionOutput } from "./descomposicionEstacional";
import { formatDec } from "../utils.tsx";

const MESES_NOM = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

// Paleta coherente con SaludModeloBadge (Patron 1):
// verde para mejor, ambar para peor, gris-azulado neutro para esperado.
const ESTILO = {
  mejor_de_lo_esperado: { bg: "#ECFDF5", border: "#BBF7D0", fg: "#15803D" },
  esperado: { bg: "#EEF2FA", border: "#CBD5E0", fg: "#475569" },
  peor_de_lo_esperado: { bg: "#FEF8E6", border: "#F1D9A4", fg: "#7A5A12" },
} as const;

const ETIQUETA_INTERPRETACION: Record<DescomposicionOutput["interpretacion"], string> = {
  mejor_de_lo_esperado: "MEJOR DE LO ESPERADO",
  esperado: "DENTRO DE LO ESPERADO",
  peor_de_lo_esperado: "PEOR DE LO ESPERADO",
};

const ETIQUETA_MAGNITUD: Record<DescomposicionOutput["magnitud_residual"], string> = {
  pequeña: "DESVÍO PEQUEÑO",
  moderada: "DESVÍO MODERADO",
  fuerte: "DESVÍO FUERTE",
};

type Props = {
  descomposicion: DescomposicionOutput;
  /** Mes 1..12 al que se refiere la descomposicion (para narrar el tooltip). */
  mes: number;
};

function fmtSign(v: number): string {
  return `${v >= 0 ? "+" : ""}${formatDec(v)}%`;
}

/**
 * Linea pequeña explicando la descomposicion + badge interpretativo + tooltip
 * nativo con el texto largo del brief 3.1.
 *
 * Se renderiza DEBAJO del numero principal del KPI. NO sustituye el numero,
 * lo enriquece.
 */
export default function DescomposicionInline({ descomposicion, mes }: Props) {
  const { componente_estacional, residual_estructural, interpretacion, magnitud_residual } =
    descomposicion;
  const estilo = ESTILO[interpretacion];
  const nombreMes =
    mes >= 1 && mes <= 12 ? MESES_NOM[mes - 1] : "este mes";

  // Texto largo (tooltip nativo via title=). Brief 3.1 literal-esque.
  const tooltip =
    `COMPONENTE ESTACIONAL\n` +
    `Históricamente, ${nombreMes} presenta matriculaciones un ${fmtSign(componente_estacional)} ` +
    `respecto a la media anual. Esta variación es esperable por calendario y no indica ` +
    `${componente_estacional < 0 ? "deterioro" : "mejora"} de mercado.\n\n` +
    `DESVÍO ESTRUCTURAL\n` +
    `Tras descontar el componente estacional, este mes está un ${fmtSign(residual_estructural)} ` +
    `respecto a lo que cabría esperar. Esto sí sugiere un movimiento de mercado, no de ` +
    `calendario.\n\n` +
    `Calibrado sobre la serie histórica nacional 2021-2025 (mediana de ratios mensuales). ` +
    `Ver Capacidades y límites para detalles metodológicos.`;

  return (
    <div className="mt-2" title={tooltip}>
      <p
        className="text-xs"
        style={{ color: "#6B7280", margin: "0 0 6px 0", lineHeight: 1.4 }}
      >
        De los cuales{" "}
        <span style={{ color: "#1A2B4A", fontWeight: 600 }}>
          {fmtSign(componente_estacional)}
        </span>{" "}
        es estacional (típico de {nombreMes}) y{" "}
        <span style={{ color: estilo.fg, fontWeight: 600 }}>
          {fmtSign(residual_estructural)}
        </span>{" "}
        es desvío estructural.
      </p>
      <span
        role="status"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: estilo.bg,
          border: `1px solid ${estilo.border}`,
          color: estilo.fg,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          padding: "3px 8px",
          borderRadius: 2,
          textTransform: "uppercase",
        }}
      >
        {ETIQUETA_INTERPRETACION[interpretacion]} · {ETIQUETA_MAGNITUD[magnitud_residual]}
      </span>
    </div>
  );
}
