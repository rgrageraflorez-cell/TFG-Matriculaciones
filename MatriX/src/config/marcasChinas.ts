// src/config/marcasChinas.ts
//
// Lista de fabricantes con sede principal en China con presencia
// documentada en el mercado español de turismos.
// Fuente de clasificación: sede fiscal del fabricante según datos
// públicos del sector (ANFAC, IDEAUTO, DGT).
//
// EXCLUIDAS conscientemente:
// - MG (capital SAIC/chino, pero clasificada fuera por decisión metodológica
//   del proyecto — ver sección de Capacidades y Límites)
// - Volvo, Polestar (capital Geely/chino, misma razón)
// - SEAT/Cupra (fabricación en España, capital VW)
// - BYD FORKLIFT (vehículo industrial, fuera del alcance del análisis
//   de turismos; aparece en df_mensual_marca.csv como "BYD FORKLIFT")
//
// Los nombres son los que aparecen EXACTAMENTE en df_mensual_marca.csv
// (verificados manualmente sobre el dataset). Tras la normalización via
// `normalizarMarca`, las variantes ortográficas convergen al mismo token:
//   - "DONG FENG" y "DONGFENG"  -> mismo (espacios eliminados)
//   - "G.A.C." y "GAC"           -> mismo (puntos eliminados)
//
// Marcas añadidas respecto al borrador inicial del brief (descubiertas en
// la auditoría del CSV real, todas con sede confirmada en China):
//   - DFSK (Dongfeng Sokon, JV Dongfeng-Sokon, Chongqing)
//   - G.A.C. / GAC (Guangzhou Automobile Group, Guangzhou)
//
// Si en el futuro nuevas marcas chinas entran al mercado español, hay
// que añadirlas aquí explícitamente. La clasificación NO se hace de
// forma automática.

export const MARCAS_CHINAS_PURAS: string[] = [
  // Top 5 por volumen 2021-2026
  "BYD",
  "OMODA",
  "JAECOO",
  "DFSK",
  "LEAPMOTOR",
  // Cola larga
  "XPENG",
  "FAW",
  "FOTON",
  "DONGFENG",
  "DONG FENG", // variante con espacio del CSV (mismo fabricante)
  "AIWAYS",
  "LIFAN",
  "GAC",
  "G.A.C.",    // variante con puntos del CSV (mismo fabricante)
  "BAIC",
  "JAC",
  "SKYWELL",
  "CHERY",
  "HAVAL",
  "GEELY",
  "ZEEKR",
];

/**
 * Normaliza el nombre de una marca para matching robusto: mayusculas,
 * sin signos de puntuacion, sin espacios. Esto colapsa variantes como
 * "DONG FENG" / "DONGFENG" o "G.A.C." / "GAC" al mismo token.
 */
export function normalizarMarca(marca: string | undefined | null): string {
  if (!marca) return "";
  return String(marca)
    .toUpperCase()
    .trim()
    .replace(/[.\-_]/g, "")     // elimina puntos, guiones, underscores
    .replace(/\s+/g, "");        // elimina TODOS los espacios (dedupe estricto)
}

const SET_NORMALIZADO: Set<string> = new Set(
  MARCAS_CHINAS_PURAS.map(normalizarMarca),
);

/**
 * True si la marca corresponde a un fabricante con sede en China segun
 * la lista MARCAS_CHINAS_PURAS, comparando tras normalizar.
 */
export function esMarcaChina(marca: string | undefined | null): boolean {
  if (marca == null) return false;
  return SET_NORMALIZADO.has(normalizarMarca(marca));
}
