import { describe, it, expect } from "vitest";
import {
  CAUSAL_PATTERNS,
  detectCausalLanguage,
  extractBlocks,
  parseSpanishNumber,
  validateOutput,
  verifyFactualClaims,
} from "./causalClaimsVerifier";

const OUTPUT_OK = `BLOQUE 1 — HECHOS
La provincia con mayor cuota es Madrid con 45200 matriculaciones.

BLOQUE 2 — PATRONES OBSERVADOS
Los municipios del Cluster A presentan ratios superiores al promedio.

BLOQUE 3 — HIPÓTESIS
Una posible explicación es que el mayor poder adquisitivo en esos
municipios podría estar relacionado con la mayor demanda observada.`;

const OUTPUT_CAUSAL_EN_HECHOS = `BLOQUE 1 — HECHOS
Madrid registra 45200 matriculaciones debido a su tamano poblacional.

BLOQUE 2 — PATRONES OBSERVADOS
Cluster A presenta ratios superiores.

BLOQUE 3 — HIPÓTESIS
Una posible explicación es la concentración de renta.`;

const OUTPUT_CAUSAL_EN_PATRONES = `BLOQUE 1 — HECHOS
Las matriculaciones del Cluster A suman 45200.

BLOQUE 2 — PATRONES OBSERVADOS
El Cluster A provoca una distorsion en el agregado nacional.

BLOQUE 3 — HIPÓTESIS
Es plausible que la causa estructural sea la fiscalidad.`;

const OUTPUT_SIN_BLOQUES = `Madrid tiene 45200 matriculaciones y el Cluster A es el mayor.`;

describe("extractBlocks", () => {
  it("separa los tres bloques cuando estan en orden", () => {
    const blocks = extractBlocks(OUTPUT_OK);
    expect(blocks).not.toBeNull();
    expect(blocks!.hechos).toMatch(/Madrid/);
    expect(blocks!.patrones).toMatch(/Cluster A/);
    expect(blocks!.hipotesis).toMatch(/posible explicación/);
  });

  it("devuelve null si falta algun bloque", () => {
    expect(extractBlocks(OUTPUT_SIN_BLOQUES)).toBeNull();
  });

  it("acepta variantes de guion", () => {
    const txt = OUTPUT_OK
      .replace("BLOQUE 1 —", "BLOQUE 1 -")
      .replace("BLOQUE 2 —", "BLOQUE 2 –");
    const blocks = extractBlocks(txt);
    expect(blocks).not.toBeNull();
    expect(blocks!.hechos).toMatch(/Madrid/);
  });
});

describe("detectCausalLanguage", () => {
  it("detecta los patrones causales conocidos", () => {
    for (const p of CAUSAL_PATTERNS) {
      expect(detectCausalLanguage(`Esto se observa ${p} algun motivo.`)).toBe(p);
    }
  });

  it("no detecta nada en texto neutral", () => {
    expect(
      detectCausalLanguage("Madrid registra 45200 matriculaciones."),
    ).toBeNull();
  });

  it("no se confunde con la palabra 'causa' suelta como sustantivo", () => {
    // "causa" suelta no esta en la lista; solo "causa principal", "causado por", etc.
    expect(detectCausalLanguage("Es la causa del expediente.")).toBeNull();
  });
});

describe("parseSpanishNumber", () => {
  it("parsea formato espanol con miles y decimales", () => {
    expect(parseSpanishNumber("1.234")).toBe(1234);
    expect(parseSpanishNumber("1.234.567")).toBe(1234567);
    expect(parseSpanishNumber("4,5")).toBe(4.5);
    expect(parseSpanishNumber("1.234,56")).toBe(1234.56);
    expect(parseSpanishNumber("45200")).toBe(45200);
  });

  it("respeta decimal con punto si no son 3 digitos", () => {
    expect(parseSpanishNumber("4.56")).toBe(4.56);
  });
});

describe("verifyFactualClaims", () => {
  it("acepta cifras presentes en el contexto con tolerancia", () => {
    const issues = verifyFactualClaims("Madrid: 45200.", [45200]);
    expect(issues).toHaveLength(0);
  });

  it("acepta cifras dentro de la tolerancia", () => {
    const issues = verifyFactualClaims("Madrid: 45225.", [45200], 0.005);
    expect(issues).toHaveLength(0);
  });

  it("flaggea cifras fuera de tolerancia", () => {
    const issues = verifyFactualClaims("Madrid: 90000.", [45200]);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("fact_not_in_data");
  });

  it("ignora numeros pequenos (referencias estructurales)", () => {
    const issues = verifyFactualClaims("Cluster 1, 2 y 3.", []);
    expect(issues).toHaveLength(0);
  });
});

describe("validateOutput", () => {
  it("output bien formado y sin causalidad indebida pasa", () => {
    const r = validateOutput(OUTPUT_OK, [45200]);
    expect(r.isValid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("flaggea causalidad en bloque de hechos", () => {
    const r = validateOutput(OUTPUT_CAUSAL_EN_HECHOS, [45200]);
    expect(r.isValid).toBe(false);
    expect(r.issues.some((i) => i.type === "causal_in_facts")).toBe(true);
  });

  it("flaggea causalidad en bloque de patrones", () => {
    const r = validateOutput(OUTPUT_CAUSAL_EN_PATRONES, [45200]);
    expect(r.isValid).toBe(false);
    expect(r.issues.some((i) => i.type === "causal_in_patterns")).toBe(true);
  });

  it("flaggea estructura ausente", () => {
    const r = validateOutput(OUTPUT_SIN_BLOQUES);
    expect(r.isValid).toBe(false);
    expect(r.issues[0].type).toBe("block_missing");
  });

  it("acepta marcas de incertidumbre en hipotesis sin issue", () => {
    const r = validateOutput(OUTPUT_OK);
    // El bloque de hipotesis usa "podría estar relacionado": no debe levantar
    // ningun causal_in_patterns ni causal_in_facts.
    expect(r.isValid).toBe(true);
  });
});
