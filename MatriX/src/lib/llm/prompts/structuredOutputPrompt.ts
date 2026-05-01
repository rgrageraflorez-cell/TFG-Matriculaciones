/**
 * Instrucciones a anadir al system prompt de cualquier llamada a LLM cuyo
 * output vaya a mostrarse al usuario en MatriX. Garantiza que el LLM
 * separe HECHOS / PATRONES / HIPOTESIS y reserve la causalidad para el
 * tercer bloque, donde se exige marca verbal de incertidumbre.
 *
 * Esta plantilla es leida por el verificador (causalClaimsVerifier.ts):
 * los nombres exactos de los bloques (BLOQUE 1 - HECHOS, etc.) se usan
 * como delimitadores en el parser. NO renombrar sin actualizar el parser.
 */
export const STRUCTURED_OUTPUT_INSTRUCTIONS = `
Estructura tu respuesta en tres bloques claramente diferenciados:

BLOQUE 1 — HECHOS
Solo afirmaciones que se derivan directamente de los datos proporcionados,
sin interpretación. Cada hecho debe poder verificarse contra los datos.

BLOQUE 2 — PATRONES OBSERVADOS
Relaciones presentes en los datos sin atribución de causa.
Ejemplo: "Los municipios del Cluster A presentan ratios superiores al promedio."

BLOQUE 3 — HIPÓTESIS
Interpretaciones causales o explicativas. CADA hipótesis debe:
- Empezar con marca verbal de incertidumbre: "una posible explicación",
  "podría estar relacionado con", "consistente con la idea de que".
- Evitar términos causales fuertes: "debido a", "por causa de", "provoca".
- Cuando sea posible, referenciar evidencia (literatura, análisis previo).

NO incluyas afirmaciones causales en los Bloques 1 o 2.
`;
