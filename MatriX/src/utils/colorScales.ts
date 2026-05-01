/**
 * colorScales.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Escalas de color reutilizables para visualizaciones del dashboard MatriX.
 *
 * Por ahora solo el gradiente divergente rojo-blanco-verde para variaciones
 * porcentuales. Si en el futuro necesitamos otras escalas (secuencial,
 * categorica, etc.), viven aqui para mantener la paleta centralizada.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { interpolateLab } from "d3-interpolate";

// ── Constantes del gradiente divergente ───────────────────────────────────

/**
 * Cap de saturacion: a partir de esta magnitud absoluta (en puntos
 * porcentuales) el color esta completamente saturado y no se intensifica
 * mas. 40% es heuristico, elegido para que variaciones tipicas (+/-5-25%)
 * ocupen rango medio del gradiente, dejando saturacion reservada para casos
 * extremos. Cambialo si tu dataset tiene una varianza muy distinta.
 */
export const SATURATION_CAP = 40;

/**
 * Banda neutra: variaciones cuya magnitud absoluta no supera este umbral
 * se pintan en gris para evitar que el ojo lea como "subida" o "bajada"
 * lo que es practicamente ruido.
 */
export const NEUTRAL_BAND = 0.5;

// Extremos coherentes con la paleta semantica del dashboard
// (--color-pos / --color-neg de index.css). Centro neutro = fondo de la app.
export const COLOR_POS_STRONG = "#15803D"; // verde fuerte
export const COLOR_NEG_STRONG = "#B91C1C"; // rojo fuerte
export const COLOR_NEUTRAL = "#F7F7F5";    // gris neutro / fondo app

// Interpoladores precomputados para evitar reconstruirlos por barra.
const INTERP_POS = interpolateLab(COLOR_NEUTRAL, COLOR_POS_STRONG);
const INTERP_NEG = interpolateLab(COLOR_NEUTRAL, COLOR_NEG_STRONG);

/**
 * Devuelve el hex del color asignado a una variacion porcentual.
 *
 * NOTA: el color es REDUNDANTE con la altura de la barra (que ya codifica
 * signo y magnitud). Esto es decision consciente: refuerza la lectura sin
 * anadir dimension nueva. No invertir ni usar verde para negativos bajo
 * ningun concepto (rompe la convencion universal subida=verde / caida=rojo).
 *
 * @param v variacion en %; por ejemplo -25 para -25%, +18 para +18%.
 */
export function colorForVariation(v: number): string {
  if (!Number.isFinite(v)) return COLOR_NEUTRAL;
  if (Math.abs(v) <= NEUTRAL_BAND) return COLOR_NEUTRAL;
  const intensity = Math.min(Math.abs(v) / SATURATION_CAP, 1);
  return v > 0 ? INTERP_POS(intensity) : INTERP_NEG(intensity);
}
