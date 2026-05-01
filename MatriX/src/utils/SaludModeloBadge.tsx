import React from "react";
import type { SaludModelo } from "./protocoloSilencio";
import { formatDec } from "../utils.tsx";

type Props = {
  salud: SaludModelo;
  /** Si true, anade marca visible "DEMO" para subrayar que el dato es mock. */
  showMockTag?: boolean;
};

const PALETA = {
  ok: { bg: "#ECFDF5", border: "#BBF7D0", fg: "#15803D" },
  degraded: { bg: "#FEF8E6", border: "#F1D9A4", fg: "#7A5A12" },
  // No usamos rojo: la suspension es decision tecnica, no emergencia.
  silenced: { bg: "#EEF2FA", border: "#CBD5E0", fg: "#475569" },
};

const ETIQUETAS: Record<SaludModelo["status"], string> = {
  ok: "Modelo: fiable",
  degraded: "Modelo: degradado",
  silenced: "Modelo: predicción suspendida",
};

const TOOLTIP_RETROSPECTIVO =
  "El MAPE 6m es el error medio de las predicciones del modelo sobre los " +
  "últimos 6 meses cerrados. No representa el error de la predicción " +
  "futura, sino la calidad reciente del modelo.";

export default function SaludModeloBadge({ salud, showMockTag }: Props) {
  const { bg, border, fg } = PALETA[salud.status];
  const mapeTxt = Number.isFinite(salud.rolling_mape)
    ? `MAPE ${salud.n_meses_evaluados}m: ${formatDec(salud.rolling_mape)}%`
    : `sin datos suficientes`;

  return (
    <span
      role="status"
      aria-live="polite"
      title={TOOLTIP_RETROSPECTIVO}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: bg,
        border: `1px solid ${border}`,
        color: fg,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.01em",
        padding: "4px 10px",
        borderRadius: 2,
        whiteSpace: "nowrap",
      }}
    >
      <span>{ETIQUETAS[salud.status]}</span>
      <span style={{ opacity: 0.75, fontWeight: 500 }}>· {mapeTxt}</span>
      {showMockTag && (
        <span
          aria-label="dato de demostración"
          style={{
            background: "#FFFFFF",
            border: `1px solid ${border}`,
            padding: "1px 6px",
            borderRadius: 2,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: fg,
          }}
        >
          DEMO
        </span>
      )}
    </span>
  );
}
