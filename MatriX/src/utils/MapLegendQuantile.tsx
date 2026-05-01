import React from "react";

type Props = {
  /** Umbrales de los cuantiles Q20, Q40, Q60, Q80 ya calculados sobre los
   *  valores >0 del dataset proyectado. Longitud esperada = 4. */
  breaks: number[];
  /** 5 colores en orden ascendente (Q20-low, Q20-Q40, …, Q80-high). */
  colors: string[];
  /** Color para provincias con valor 0 (categoria visualmente separada). */
  zeroColor: string;
  /** Formateador para los numeros (ej. cuota en %). */
  format: (v: number) => string;
  /** Pie opcional: titulo a la derecha (ej. "cuota nacional: 4,7%"). */
  footer?: string;
  /** Swatch adicional opcional para "fiabilidad insuficiente" u otra
   *  categoria fuera de la escala numerica. Se renderiza al final, antes
   *  del footer. */
  unreliableSwatch?: { color: string; label: string };
};

/**
 * Leyenda discreta para escalas secuenciales monocromaticas por cuantiles.
 * Renderiza 5 swatches con los rangos numericos formateados, y un swatch
 * extra (gris muy claro) para provincias con valor 0.
 *
 * Reutilizable: cualquier mapa con escala por cuantiles puede consumirla
 * sin saber su libreria de pintado.
 */
export default function MapLegendQuantile({
  breaks,
  colors,
  zeroColor,
  format,
  footer,
  unreliableSwatch,
}: Props) {
  if (breaks.length !== 4 || colors.length !== 5) {
    return null;
  }
  // Etiquetas de cada cubo: "<X", "X–Y", "X–Y", "X–Y", ">Y"
  const labels: string[] = [
    `< ${format(breaks[0])}`,
    `${format(breaks[0])}–${format(breaks[1])}`,
    `${format(breaks[1])}–${format(breaks[2])}`,
    `${format(breaks[2])}–${format(breaks[3])}`,
    `> ${format(breaks[3])}`,
  ];

  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-center"
      style={{ gap: 6, fontSize: 11, color: "#6B7280" }}
      aria-label="Leyenda del mapa por cuantiles"
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 14,
            height: 10,
            background: zeroColor,
            border: "1px solid #E5E7EB",
            borderRadius: 2,
          }}
        />
        <span>0</span>
      </span>
      {colors.map((c, i) => (
        <span
          key={i}
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 22,
              height: 10,
              background: c,
              border: "1px solid #E5E7EB",
              borderRadius: 2,
            }}
          />
          <span>{labels[i]}</span>
        </span>
      ))}
      {unreliableSwatch && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 22,
              height: 10,
              background: unreliableSwatch.color,
              border: "1px solid #E5E7EB",
              borderRadius: 2,
            }}
          />
          <span>{unreliableSwatch.label}</span>
        </span>
      )}
      {footer && (
        <span style={{ marginLeft: 8, fontStyle: "italic", color: "#9CA3AF" }}>
          · {footer}
        </span>
      )}
    </div>
  );
}
