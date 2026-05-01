import { describe, it, expect } from "vitest";
import {
  evaluarFiabilidad,
  UMBRAL_ABSOLUTO,
  UMBRAL_RELATIVO,
} from "./fiabilidadMarcaProvincia";

describe("evaluarFiabilidad", () => {
  it("n=0 → no fiable, motivo 'sin_datos'", () => {
    const r = evaluarFiabilidad({ n_provincia: 0, n_nacional_marca: 1000 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("sin_datos");
  });

  it("n=5 (absoluto bajo) → no fiable, motivo 'n_absoluto_bajo'", () => {
    const r = evaluarFiabilidad({ n_provincia: 5, n_nacional_marca: 100 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_absoluto_bajo");
  });

  it("Ferrari Soria (n=2, nacional=600) → no fiable por absoluto", () => {
    const r = evaluarFiabilidad({ n_provincia: 2, n_nacional_marca: 600 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_absoluto_bajo");
    // Ratio relativo seria 0.0033 (0.33%), pasaria el filtro relativo,
    // pero el absoluto lo bloquea primero.
    expect(r.detalle.ratio_relativo).toBeCloseTo(2 / 600, 6);
  });

  it("Ferrari Madrid (n=200, nacional=600) → fiable", () => {
    const r = evaluarFiabilidad({ n_provincia: 200, n_nacional_marca: 600 });
    expect(r.fiable).toBe(true);
    expect(r.motivo).toBeUndefined();
  });

  it("Toyota Soria (n=15, nacional=85000) → falla relativo, motivo 'n_relativo_bajo'", () => {
    const r = evaluarFiabilidad({ n_provincia: 15, n_nacional_marca: 85000 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_relativo_bajo");
    // 15 / 85000 = 0.000176 (0.0176%) < 0.001 (0.1%)
    expect(r.detalle.ratio_relativo).toBeLessThan(UMBRAL_RELATIVO);
  });

  it("Toyota Madrid (n=8000, nacional=85000) → fiable", () => {
    const r = evaluarFiabilidad({ n_provincia: 8000, n_nacional_marca: 85000 });
    expect(r.fiable).toBe(true);
  });

  it("límite absoluto exacto: n=10 con ratio justo en umbral → fiable", () => {
    // n = 10, nacional tal que ratio = 0.001 exacto -> nacional = 10000
    const r = evaluarFiabilidad({ n_provincia: UMBRAL_ABSOLUTO, n_nacional_marca: 10000 });
    expect(r.fiable).toBe(true);
    expect(r.detalle.ratio_relativo).toBeCloseTo(UMBRAL_RELATIVO, 9);
  });

  it("límite absoluto justo por debajo: n=9 → no fiable", () => {
    const r = evaluarFiabilidad({ n_provincia: 9, n_nacional_marca: 10000 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_absoluto_bajo");
  });

  it("límite relativo justo por debajo: n=10, nacional=11000 → no fiable por relativo", () => {
    // ratio = 10 / 11000 = 0.000909... < 0.001
    const r = evaluarFiabilidad({ n_provincia: 10, n_nacional_marca: 11000 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_relativo_bajo");
  });

  it("nacional = 0 → no fiable (ratio NaN, motivo 'n_relativo_bajo')", () => {
    // Caso defensivo: si la marca no tiene matriculaciones nacionales pero
    // sí provinciales (no deberia ocurrir, pero el codigo no debe explotar).
    const r = evaluarFiabilidad({ n_provincia: 50, n_nacional_marca: 0 });
    expect(r.fiable).toBe(false);
    expect(r.motivo).toBe("n_relativo_bajo");
  });
});
