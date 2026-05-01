import { describe, it, expect } from "vitest";
import {
  esMarcaChina,
  normalizarMarca,
  MARCAS_CHINAS_PURAS,
} from "./marcasChinas";

describe("normalizarMarca", () => {
  it("elimina puntos: 'G.A.C.' y 'GAC' colapsan al mismo token", () => {
    expect(normalizarMarca("G.A.C.")).toBe(normalizarMarca("GAC"));
    expect(normalizarMarca("G.A.C.")).toBe("GAC");
  });

  it("elimina espacios: 'DONG FENG' y 'DONGFENG' colapsan", () => {
    expect(normalizarMarca("DONG FENG")).toBe(normalizarMarca("DONGFENG"));
    expect(normalizarMarca("DONG FENG")).toBe("DONGFENG");
  });

  it("convierte a mayusculas", () => {
    expect(normalizarMarca("byd")).toBe("BYD");
    expect(normalizarMarca("Byd")).toBe("BYD");
  });

  it("trata cadenas vacias / null / undefined defensivamente", () => {
    expect(normalizarMarca("")).toBe("");
    expect(normalizarMarca(null)).toBe("");
    expect(normalizarMarca(undefined)).toBe("");
  });

  it("elimina guiones y underscores", () => {
    expect(normalizarMarca("BY-D")).toBe("BYD");
    expect(normalizarMarca("BY_D")).toBe("BYD");
  });
});

describe("esMarcaChina", () => {
  it("acepta variantes mayus/minus/punto del brief", () => {
    expect(esMarcaChina("BYD")).toBe(true);
    expect(esMarcaChina("byd")).toBe(true);
    expect(esMarcaChina("B.Y.D.")).toBe(true);
  });

  it("acepta todas las marcas de la lista", () => {
    for (const m of MARCAS_CHINAS_PURAS) {
      expect(esMarcaChina(m)).toBe(true);
    }
  });

  it("rechaza marcas no chinas (MG, Volvo, Polestar, Toyota)", () => {
    expect(esMarcaChina("MG")).toBe(false);
    expect(esMarcaChina("Volvo")).toBe(false);
    expect(esMarcaChina("POLESTAR")).toBe(false);
    expect(esMarcaChina("TOYOTA")).toBe(false);
    expect(esMarcaChina("VOLKSWAGEN")).toBe(false);
  });

  it("rechaza variantes industriales (BYD FORKLIFT) y mixtas (MG ROEWE)", () => {
    // BYD FORKLIFT NO esta en la lista -> false aunque empiece por BYD.
    expect(esMarcaChina("BYD FORKLIFT")).toBe(false);
    expect(esMarcaChina("MG ROEWE")).toBe(false);
    expect(esMarcaChina("MG ROVER")).toBe(false);
  });

  it("dedupe estricto: DONG FENG y DONGFENG ambos se reconocen", () => {
    expect(esMarcaChina("DONG FENG")).toBe(true);
    expect(esMarcaChina("DONGFENG")).toBe(true);
    expect(esMarcaChina("dong fENg")).toBe(true);
  });

  it("dedupe G.A.C. / GAC", () => {
    expect(esMarcaChina("G.A.C.")).toBe(true);
    expect(esMarcaChina("GAC")).toBe(true);
  });

  it("trata cadenas vacias y null defensivamente", () => {
    expect(esMarcaChina("")).toBe(false);
    expect(esMarcaChina(null)).toBe(false);
    expect(esMarcaChina(undefined)).toBe(false);
  });
});
