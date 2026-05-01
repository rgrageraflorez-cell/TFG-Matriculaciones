import React from "react";
import {
  COLOR_NEG_STRONG,
  COLOR_POS_STRONG,
  SATURATION_CAP,
  colorForVariation,
} from "./colorScales";

/**
 * Leyenda compacta del gradiente divergente para variaciones porcentuales.
 * Renderiza una barra horizontal CONTINUA que va de -SATURATION_CAP% (rojo)
 * a 0% (neutro) a +SATURATION_CAP% (verde), con ticks en -CAP, 0, +CAP.
 *
 * Es una escala continua, NO un listado discreto. La lectura es
 * "cuanto mas saturado, mas extrema la variacion". El color es redundante
 * con la altura de la barra del chart -- refuerza, no anade dimension.
 */
export default function DivergentLegend() {
  // Muestreamos el interpolador LAB en 21 stops uniformes para que el
  // gradiente CSS se vea suave a tamano leyenda (~240-360px de ancho).
  const stops: string[] = [];
  for (let i = -10; i <= 10; i++) {
    const v = (i / 10) * SATURATION_CAP;
    const pct = ((i + 10) / 20) * 100;
    stops.push(`${colorForVariation(v)} ${pct.toFixed(0)}%`);
  }
  const gradient = `linear-gradient(to right, ${stops.join(", ")})`;

  return (
    <div
      className="mt-3"
      role="img"
      aria-label={`Leyenda: gradiente de color para variacion interanual, de menos ${SATURATION_CAP}% en rojo a 0% neutro a mas ${SATURATION_CAP}% en verde`}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          maxWidth: 480,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: COLOR_NEG_STRONG,
            minWidth: 38,
            textAlign: "right",
          }}
        >
          {`-${SATURATION_CAP}%`}
        </span>

        <div
          style={{
            flex: 1,
            position: "relative",
            height: 12,
            background: gradient,
            border: "1px solid #E5E7EB",
            borderRadius: 2,
          }}
        >
          {/* Ticks en -CAP (0%), 0 (50%), +CAP (100%) */}
          {[0, 50, 100].map((pos) => (
            <span
              key={pos}
              style={{
                position: "absolute",
                left: `${pos}%`,
                top: -3,
                bottom: -3,
                width: 1,
                background: "#1A2B4A",
                opacity: 0.55,
                transform: "translateX(-0.5px)",
              }}
            />
          ))}
          {/* Etiqueta centro */}
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: 16,
              transform: "translateX(-50%)",
              fontSize: 10,
              fontWeight: 600,
              color: "#1A2B4A",
              whiteSpace: "nowrap",
            }}
          >
            0%
          </span>
        </div>

        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: COLOR_POS_STRONG,
            minWidth: 38,
          }}
        >
          {`+${SATURATION_CAP}%`}
        </span>
      </div>

      <p style={{ margin: "18px 0 0 0", fontSize: 10, color: "#9CA3AF" }}>
        Color saturado al alcanzar +/-{SATURATION_CAP}%. Variaciones por
        debajo de +/-0,5% se muestran en neutro.
      </p>
    </div>
  );
}
