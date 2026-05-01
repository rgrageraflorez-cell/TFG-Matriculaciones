/**
 * causalClaimsVerifier.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Verificador post-LLM para outputs estructurados segun
 * STRUCTURED_OUTPUT_INSTRUCTIONS.
 *
 * Aplica dos comprobaciones:
 *   1. Lenguaje causal fuerte fuera del bloque de hipotesis (BLOQUE 3).
 *   2. Cifras citadas en el bloque de hechos (BLOQUE 1) presentes en el
 *      contexto de datos suministrado.
 *
 * El verificador es DETERMINISTA y LOCAL: no hace llamadas externas, no
 * depende de embeddings ni de otro LLM.
 * ────────────────────────────────────────────────────────────────────────────
 */

// Lista de patrones causales fuertes en espanol. Detectarlos en BLOQUE 1
// (hechos) o BLOQUE 2 (patrones) implica que el LLM ha traspasado la
// barrera entre "describir" y "explicar". La lista es voluntariamente
// conservadora: prefiere falso positivo (regenerar el output) antes que
// falso negativo (publicar una causalidad no autorizada).
//
// La lista es FRASES, no palabras sueltas: evita el ruido de "causa" como
// sustantivo neutro ("la causa del expediente"). Todas en minusculas; el
// matcher normaliza el texto antes de comparar.
export const CAUSAL_PATTERNS: readonly string[] = [
  "debido a",
  "por causa de",
  "es consecuencia de",
  "provoca",
  "se debe a",
  "causa principal",
  "tiene como causa",
  "causado por",
  "como resultado de",
  "se traduce en",
  "genera un",
  "genera una",
  "ocasiona",
];

// Marcas de incertidumbre validas en BLOQUE 3 (hipotesis). Su presencia
// NO levanta issue; su ausencia en una hipotesis tampoco bloquea (el LLM
// puede formular hipotesis correctamente sin estas frases exactas).
export const HEDGE_PATTERNS: readonly string[] = [
  "una posible explicación",
  "podría estar relacionado",
  "consistente con la idea de que",
  "podría sugerir",
  "es plausible que",
  "una hipótesis razonable",
  "no se descarta que",
];

export type IssueType =
  | "causal_in_facts"
  | "causal_in_patterns"
  | "fact_not_in_data"
  | "block_missing";

export type Issue = {
  type: IssueType;
  location: string; // ej. "BLOQUE 1" o "BLOQUE 1 / cifra '4500'"
  detail: string;
};

export type Blocks = {
  hechos: string;
  patrones: string;
  hipotesis: string;
};

export type ValidationResult = {
  isValid: boolean;
  issues: Issue[];
  blocks?: Blocks;
};

// ────────────────────────────────────────────────────────────────────────────
// Parser de bloques
// ────────────────────────────────────────────────────────────────────────────

const HEADER_HECHOS = /^\s*BLOQUE\s*1\s*[-—–]\s*HECHOS\s*$/im;
const HEADER_PATRONES = /^\s*BLOQUE\s*2\s*[-—–]\s*PATRONES\s+OBSERVADOS\s*$/im;
const HEADER_HIPOTESIS = /^\s*BLOQUE\s*3\s*[-—–]\s*HIPÓTESIS\s*$/im;

/**
 * Separa el texto generado en sus tres bloques. Tolerante a variantes de
 * guion (-, —, –) y a mayusculas/minusculas en los headers, pero exige
 * que los tres bloques estén presentes en orden.
 */
export function extractBlocks(text: string): Blocks | null {
  const idxH = text.search(HEADER_HECHOS);
  const idxP = text.search(HEADER_PATRONES);
  const idxI = text.search(HEADER_HIPOTESIS);
  if (idxH < 0 || idxP < 0 || idxI < 0) return null;
  if (!(idxH < idxP && idxP < idxI)) return null;
  const hechos = stripHeader(text.slice(idxH, idxP)).trim();
  const patrones = stripHeader(text.slice(idxP, idxI)).trim();
  const hipotesis = stripHeader(text.slice(idxI)).trim();
  return { hechos, patrones, hipotesis };
}

function stripHeader(chunk: string): string {
  // Elimina la primera linea (el header BLOQUE N -- ...)
  const nl = chunk.indexOf("\n");
  return nl < 0 ? "" : chunk.slice(nl + 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Detector de lenguaje causal
// ────────────────────────────────────────────────────────────────────────────

// Orden por longitud descendente: las frases mas especificas se prueban
// primero, asi "genera una" se detecta como tal y no como "genera un"
// (que seria un match parcial confuso para el reporte de issues).
const CAUSAL_PATTERNS_SORTED: readonly string[] = [...CAUSAL_PATTERNS].sort(
  (a, b) => b.length - a.length,
);

/**
 * Devuelve el primer patron causal encontrado en el texto, o null si no
 * hay ninguno. Compara minusculas y normaliza espacios. Los patrones se
 * prueban en orden de longitud descendente.
 */
export function detectCausalLanguage(blockText: string): string | null {
  const norm = blockText.toLowerCase().replace(/\s+/g, " ");
  for (const p of CAUSAL_PATTERNS_SORTED) {
    if (norm.includes(p)) return p;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Verificacion numerica de hechos
// ────────────────────────────────────────────────────────────────────────────

// Captura numeros en formato espanol o ingles. Dos alternativas en orden:
//   1. "1.234.567,89" o "1 234 567,89" (con grupos de miles obligatorios)
//   2. "45200" o "4.56" o "4,5" (numero simple sin separador de miles)
// Importante: la primera alternativa exige al menos UN grupo de miles
// ({3}+) para evitar capturar parcialmente numeros simples como "45200"
// (que matchearia con "45" si el grupo de miles fuera opcional).
const NUMBER_RE =
  /-?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;

/**
 * Extrae todos los numeros que aparecen en el bloque de hechos y los
 * compara contra el dataContext. Cualquier cifra del bloque que no
 * corresponda a ningun valor del contexto (con tolerancia configurable)
 * se reporta como issue.
 *
 * dataContext: array de numeros que el LLM tenia disponibles (los que
 * deben aparecer si los cita).
 *
 * tolerance: error relativo aceptable. 0.005 = 0.5% (default segun brief).
 */
export function verifyFactualClaims(
  factsBlock: string,
  dataContext: number[],
  tolerance: number = 0.005,
): Issue[] {
  const matches = factsBlock.match(NUMBER_RE) || [];
  const issues: Issue[] = [];
  for (const raw of matches) {
    const num = parseSpanishNumber(raw);
    if (num === null || !Number.isFinite(num)) continue;
    // 0 y numeros pequeños (1, 2, 3) suelen ser referencias estructurales
    // ("tres bloques", "cluster 1") y no datos. Filtramos los unicos digito.
    if (Math.abs(num) < 10) continue;
    const matched = dataContext.some((v) => withinTolerance(num, v, tolerance));
    if (!matched) {
      issues.push({
        type: "fact_not_in_data",
        location: `BLOQUE 1 / cifra '${raw}'`,
        detail: `La cifra ${raw} (parsed=${num}) no aparece en el contexto de datos suministrado dentro de la tolerancia ${tolerance * 100}%.`,
      });
    }
  }
  return issues;
}

function withinTolerance(a: number, b: number, tol: number): boolean {
  if (a === 0 || b === 0) return Math.abs(a - b) < 1e-9;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

/**
 * Convierte un numero en formato espanol (separador miles "." o " ", decimal ",")
 * o ingles a Number. Devuelve null si no es parseable.
 */
export function parseSpanishNumber(s: string): number | null {
  if (!s) return null;
  let str = s.trim().replace(/\s/g, "");
  // Heuristica: si tiene "." y "," -> "." es miles, "," es decimal.
  // Si solo tiene "," -> es decimal.
  // Si solo tiene "." y aparece varias veces -> miles. Si aparece una vez con
  //  exactamente 3 digitos despues -> miles. Si tras "." hay !=3 digitos -> decimal.
  if (str.includes(".") && str.includes(",")) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (str.includes(",")) {
    str = str.replace(",", ".");
  } else if (str.includes(".")) {
    const parts = str.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      // 1.234 -> 1234 (miles)
      str = parts.join("");
    } else if (parts.length > 2) {
      // 1.234.567 -> 1234567
      str = parts.join("");
    }
    // si parts[1].length != 3 lo tratamos como decimal y dejamos como esta
  }
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Validacion compuesta
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aplica todos los verificadores. Devuelve isValid=false si hay alguna
 * issue. Las cifras del bloque de hechos solo se verifican si se pasa
 * dataContext con al menos un numero.
 */
export function validateOutput(
  text: string,
  dataContext: number[] = [],
  options: { tolerance?: number } = {},
): ValidationResult {
  const blocks = extractBlocks(text);
  if (!blocks) {
    return {
      isValid: false,
      issues: [
        {
          type: "block_missing",
          location: "estructura completa",
          detail: "El output no contiene los tres bloques BLOQUE 1 / 2 / 3 en orden.",
        },
      ],
    };
  }
  const issues: Issue[] = [];
  const causalEnHechos = detectCausalLanguage(blocks.hechos);
  if (causalEnHechos) {
    issues.push({
      type: "causal_in_facts",
      location: "BLOQUE 1",
      detail: `Patron causal detectado en el bloque de hechos: "${causalEnHechos}".`,
    });
  }
  const causalEnPatrones = detectCausalLanguage(blocks.patrones);
  if (causalEnPatrones) {
    issues.push({
      type: "causal_in_patterns",
      location: "BLOQUE 2",
      detail: `Patron causal detectado en el bloque de patrones: "${causalEnPatrones}".`,
    });
  }
  if (dataContext.length > 0) {
    issues.push(
      ...verifyFactualClaims(blocks.hechos, dataContext, options.tolerance),
    );
  }
  return { isValid: issues.length === 0, issues, blocks };
}
