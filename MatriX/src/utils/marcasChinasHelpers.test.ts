import { describe, it, expect } from "vitest";
import {
  calcularCuotaChina,
  calcularSerieCuotaChina,
  buildDesgloseMarcas,
  detectarAceleracion,
} from "./marcasChinasHelpers";

const FILAS_TEST = [
  // 2025-01: total 1000, chinas 50 -> cuota 5%
  { fecha_mes: "2025-01-01", marca: "BYD", matriculaciones: 30 },
  { fecha_mes: "2025-01-01", marca: "OMODA", matriculaciones: 20 },
  { fecha_mes: "2025-01-01", marca: "TOYOTA", matriculaciones: 500 },
  { fecha_mes: "2025-01-01", marca: "MG", matriculaciones: 200 }, // MG NO china
  { fecha_mes: "2025-01-01", marca: "VOLKSWAGEN", matriculaciones: 250 },
  // 2025-02: total 1000, chinas 100 -> cuota 10%
  { fecha_mes: "2025-02-01", marca: "BYD", matriculaciones: 60 },
  { fecha_mes: "2025-02-01", marca: "OMODA", matriculaciones: 40 },
  { fecha_mes: "2025-02-01", marca: "TOYOTA", matriculaciones: 500 },
  { fecha_mes: "2025-02-01", marca: "VOLKSWAGEN", matriculaciones: 400 },
];

describe("calcularCuotaChina", () => {
  it("calcula la cuota porcentual del mes indicado", () => {
    expect(calcularCuotaChina(FILAS_TEST, "2025-01-01")).toBeCloseTo(5, 5);
    expect(calcularCuotaChina(FILAS_TEST, "2025-02-01")).toBeCloseTo(10, 5);
  });

  it("ignora 'TOTAL MARCAS' del cómputo", () => {
    const con = [
      ...FILAS_TEST,
      { fecha_mes: "2025-01-01", marca: "TOTAL MARCAS", matriculaciones: 1000 },
    ];
    expect(calcularCuotaChina(con, "2025-01-01")).toBeCloseTo(5, 5);
  });

  it("mes inexistente -> 0", () => {
    expect(calcularCuotaChina(FILAS_TEST, "1999-01-01")).toBe(0);
  });
});

describe("calcularSerieCuotaChina", () => {
  it("devuelve 1 punto por mes ordenado ascendente", () => {
    const serie = calcularSerieCuotaChina(FILAS_TEST);
    expect(serie).toHaveLength(2);
    expect(serie[0].fecha_mes).toBe("2025-01-01");
    expect(serie[1].fecha_mes).toBe("2025-02-01");
    expect(serie[0].cuota_pct).toBeCloseTo(5);
    expect(serie[1].cuota_pct).toBeCloseTo(10);
  });

  it("rellena total y chinas correctamente", () => {
    const serie = calcularSerieCuotaChina(FILAS_TEST);
    expect(serie[0].total).toBe(1000);
    expect(serie[0].chinas).toBe(50);
  });
});

describe("buildDesgloseMarcas", () => {
  it("ordena descendente por matriculaciones del año", () => {
    const d = buildDesgloseMarcas(FILAS_TEST, 2025, 10);
    expect(d.length).toBeGreaterThan(0);
    // BYD: 30+60=90, OMODA: 20+40=60
    expect(d[0].marca).toBe("BYD");
    expect(d[0].matric_anio).toBe(90);
    expect(d[1].marca).toBe("OMODA");
    expect(d[1].matric_anio).toBe(60);
  });

  it("agrupa marcas con < umbralMin en 'Otras chinas'", () => {
    const filas = [
      { fecha_mes: "2025-01-01", marca: "BYD", matriculaciones: 100 },
      { fecha_mes: "2025-01-01", marca: "ZEEKR", matriculaciones: 5 }, // <10
      { fecha_mes: "2025-01-01", marca: "GEELY", matriculaciones: 3 }, // <10
      { fecha_mes: "2025-01-01", marca: "TOYOTA", matriculaciones: 1000 },
    ];
    const d = buildDesgloseMarcas(filas, 2025, 10);
    expect(d).toHaveLength(2); // BYD + Otras
    expect(d[0].marca).toBe("BYD");
    expect(d[1].marca).toMatch(/^Otras chinas/);
    expect(d[1].matric_anio).toBe(8);
    expect(d[1].esOtras).toBe(true);
  });

  it("cuota_sobre_chinas y cuota_sobre_total correctas", () => {
    const d = buildDesgloseMarcas(FILAS_TEST, 2025, 10);
    const byd = d.find((x) => x.marca === "BYD")!;
    // BYD 90, total chinas 150 -> 60% sobre chinas
    expect(byd.cuota_sobre_chinas).toBeCloseTo(60, 1);
    // BYD 90, total mercado 2000 -> 4.5% sobre total
    expect(byd.cuota_sobre_total).toBeCloseTo(4.5, 2);
  });

  it("dedupe de variantes: 'G.A.C.' y 'GAC' colapsan a una sola fila", () => {
    const filas = [
      { fecha_mes: "2025-01-01", marca: "G.A.C.", matriculaciones: 30 },
      { fecha_mes: "2025-02-01", marca: "GAC", matriculaciones: 50 },
      { fecha_mes: "2025-03-01", marca: "DONG FENG", matriculaciones: 40 },
      { fecha_mes: "2025-04-01", marca: "DONGFENG", matriculaciones: 100 },
      { fecha_mes: "2025-01-01", marca: "TOYOTA", matriculaciones: 10000 },
    ];
    const d = buildDesgloseMarcas(filas, 2025, 10);
    // Solo 2 marcas chinas tras dedupe (GAC + DONGFENG)
    const chinasPuras = d.filter((x) => !x.esOtras);
    expect(chinasPuras).toHaveLength(2);
    // El nombre canonico es la variante con MAS matric
    const dongfeng = chinasPuras.find((x) =>
      ["DONGFENG", "DONG FENG"].includes(x.marca),
    )!;
    expect(dongfeng.marca).toBe("DONGFENG"); // 100 > 40
    expect(dongfeng.matric_anio).toBe(140);
    const gac = chinasPuras.find((x) => ["GAC", "G.A.C."].includes(x.marca))!;
    expect(gac.marca).toBe("GAC"); // 50 > 30
    expect(gac.matric_anio).toBe(80);
  });
});

describe("detectarAceleracion", () => {
  it("detecta el cambio de pendiente cuando supera el umbral", () => {
    // Serie con pendiente plana y luego rampa fuerte
    const serie = Array.from({ length: 12 }, (_, i) => ({
      fecha_mes: `2025-${String(i + 1).padStart(2, "0")}-01`,
      total: 1000,
      chinas: 0,
      cuota_pct: i < 6 ? 1 : 1 + (i - 6) * 1.5, // rampa fuerte desde mes 6
    }));
    const r = detectarAceleracion(serie, 3, 0.3);
    expect(r).not.toBeNull();
  });

  it("devuelve null cuando la serie es plana", () => {
    const serie = Array.from({ length: 12 }, (_, i) => ({
      fecha_mes: `2025-${String(i + 1).padStart(2, "0")}-01`,
      total: 1000,
      chinas: 50,
      cuota_pct: 5,
    }));
    expect(detectarAceleracion(serie, 3, 0.3)).toBeNull();
  });

  it("devuelve null si la serie es muy corta", () => {
    const serie: ReturnType<typeof calcularSerieCuotaChina> = [
      { fecha_mes: "2025-01-01", total: 1000, chinas: 50, cuota_pct: 5 },
    ];
    expect(detectarAceleracion(serie, 3, 0.3)).toBeNull();
  });
});
