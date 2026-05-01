import { describe, it, expect } from "vitest";
import { buildCustomVector } from "./simuladorEscenarios";

describe("buildCustomVector", () => {
  it("caso del brief: +12%, duracion 4, enero, sostenido → [3,3,3,3,0,...]", () => {
    const v = buildCustomVector(12, 4, 1, "sostenido");
    expect(v).toEqual([3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(12, 9);
  });

  it("magnitud negativa sostenido: -20%, 4 meses, enero", () => {
    const v = buildCustomVector(-20, 4, 1, "sostenido");
    expect(v.slice(0, 4).every((x) => x === -5)).toBe(true);
    expect(v.slice(4).every((x) => x === 0)).toBe(true);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(-20, 9);
  });

  it("gradual: pesos crecientes, suma = magnitud", () => {
    const v = buildCustomVector(10, 4, 1, "gradual");
    // Pesos 1+2+3+4 = 10, valores = 10*peso/10 = peso
    expect(v.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(v.slice(4).every((x) => x === 0)).toBe(true);
    // Estrictamente creciente dentro del rango
    for (let i = 1; i < 4; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
  });

  it("brusco: pesos decrecientes, suma = magnitud", () => {
    const v = buildCustomVector(10, 4, 1, "brusco");
    expect(v.slice(0, 4)).toEqual([4, 3, 2, 1]);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 9);
    for (let i = 1; i < 4; i++) expect(v[i]).toBeLessThan(v[i - 1]);
  });

  it("inicio mid-year: +6%, 3 meses, julio sostenido", () => {
    const v = buildCustomVector(6, 3, 7, "sostenido");
    expect(v).toEqual([0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0]);
  });

  it("duracion 1: el unico mes recibe la magnitud completa", () => {
    const v = buildCustomVector(15, 1, 5, "sostenido");
    expect(v[4]).toBe(15);
    expect(v.filter((x) => x !== 0).length).toBe(1);
  });

  it("duracion 12 sostenido: vector constante", () => {
    const v = buildCustomVector(24, 12, 1, "sostenido");
    expect(v.every((x) => x === 2)).toBe(true);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(24, 9);
  });

  it("recorte implicito: si fin supera 12, solo se aplica lo que cabe", () => {
    // Duracion 5 desde octubre (mes 10): cabe oct, nov, dic = 3 meses.
    // El caller debe haber pre-recortado segun brief 4.4, pero la funcion
    // se comporta defensivamente: solo escribe en los meses que existen.
    const v = buildCustomVector(15, 5, 10, "sostenido");
    // len efectivo = 12 - 9 = 3, valor = 15/3 = 5 cada uno.
    expect(v).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5]);
  });

  it("magnitud cero produce vector cero", () => {
    const v = buildCustomVector(0, 4, 1, "sostenido");
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it("duracion 0 produce vector cero", () => {
    const v = buildCustomVector(15, 0, 1, "sostenido");
    expect(v.every((x) => x === 0)).toBe(true);
  });
});
