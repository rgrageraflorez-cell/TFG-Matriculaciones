import { describe, it, expect } from "vitest";
import {
  descomponerVariacion,
  getPerfilEstacionalEmpirico,
  UMBRAL_INTERPRETACION,
  UMBRAL_MAGNITUD_MODERADA,
  UMBRAL_MAGNITUD_FUERTE,
} from "./descomposicionEstacional";

const PERFIL_TIPICO = [-2.1, -5.3, 1.4, -3.0, 2.8, 6.1, 4.2, -1.5, -2.7, 1.0, 0.3, -1.2];

describe("descomponerVariacion", () => {
  it("YoY = componente estacional → residual ≈ 0, interpretación 'esperado'", () => {
    // Abril (mes=4) tiene componente estacional -3.0. Si YoY = -3.0, residual = 0.
    const r = descomponerVariacion({
      mes: 4,
      variacion_yoy: -3.0,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r.residual_estructural).toBeCloseTo(0, 6);
    expect(r.interpretacion).toBe("esperado");
    expect(r.magnitud_residual).toBe("pequeña");
  });

  it("YoY mucho peor que estacional → 'peor_de_lo_esperado' magnitud según valor", () => {
    // Abril: estacional -3, YoY -8 → residual -5 (moderada, peor)
    const r = descomponerVariacion({
      mes: 4,
      variacion_yoy: -8,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r.componente_estacional).toBe(-3.0);
    expect(r.residual_estructural).toBe(-5);
    expect(r.interpretacion).toBe("peor_de_lo_esperado");
    expect(r.magnitud_residual).toBe("moderada");
  });

  it("YoY mucho mejor que estacional → 'mejor_de_lo_esperado'", () => {
    // Abril: estacional -3, YoY +12 → residual +15 (fuerte, mejor)
    const r = descomponerVariacion({
      mes: 4,
      variacion_yoy: 12,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r.residual_estructural).toBe(15);
    expect(r.interpretacion).toBe("mejor_de_lo_esperado");
    expect(r.magnitud_residual).toBe("fuerte");
  });

  it("YoY = 0 con estacional positivo → residual negativo, peor de lo esperado", () => {
    // Junio (mes=6): estacional +6.1, YoY 0 → residual -6.1
    // El mercado no creció cuando el calendario decía que debía → peor
    const r = descomponerVariacion({
      mes: 6,
      variacion_yoy: 0,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r.residual_estructural).toBeCloseTo(-6.1, 6);
    expect(r.interpretacion).toBe("peor_de_lo_esperado");
    expect(r.magnitud_residual).toBe("moderada");
  });

  it("límite interpretación: residual = +1 exacto → 'esperado'", () => {
    // Mes con estacional 0 (artificial), YoY 1 → residual 1 → esperado
    const perfilCero = new Array(12).fill(0);
    const r = descomponerVariacion({
      mes: 1,
      variacion_yoy: UMBRAL_INTERPRETACION,
      perfil_estacional: perfilCero,
    });
    expect(r.residual_estructural).toBe(1);
    expect(r.interpretacion).toBe("esperado");
  });

  it("límite interpretación: residual = +1.001 → 'mejor_de_lo_esperado'", () => {
    const perfilCero = new Array(12).fill(0);
    const r = descomponerVariacion({
      mes: 1,
      variacion_yoy: UMBRAL_INTERPRETACION + 0.001,
      perfil_estacional: perfilCero,
    });
    expect(r.interpretacion).toBe("mejor_de_lo_esperado");
  });

  it("límite magnitud: |residual| = 3 exacto → 'moderada'", () => {
    const perfilCero = new Array(12).fill(0);
    const r = descomponerVariacion({
      mes: 1,
      variacion_yoy: UMBRAL_MAGNITUD_MODERADA,
      perfil_estacional: perfilCero,
    });
    expect(r.magnitud_residual).toBe("moderada");
  });

  it("límite magnitud: |residual| = 8 exacto → 'fuerte'", () => {
    const perfilCero = new Array(12).fill(0);
    const r = descomponerVariacion({
      mes: 1,
      variacion_yoy: UMBRAL_MAGNITUD_FUERTE,
      perfil_estacional: perfilCero,
    });
    expect(r.magnitud_residual).toBe("fuerte");
  });

  it("sin perfil_estacional → componente=0, descomposición = YoY (sin valor añadido)", () => {
    const r = descomponerVariacion({ mes: 4, variacion_yoy: -8 });
    expect(r.componente_estacional).toBe(0);
    expect(r.residual_estructural).toBe(-8);
  });

  it("mes inválido (0 o 13) → componente=0", () => {
    const r0 = descomponerVariacion({
      mes: 0,
      variacion_yoy: -8,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r0.componente_estacional).toBe(0);
    const r13 = descomponerVariacion({
      mes: 13,
      variacion_yoy: -8,
      perfil_estacional: PERFIL_TIPICO,
    });
    expect(r13.componente_estacional).toBe(0);
  });
});

describe("getPerfilEstacionalEmpirico", () => {
  it("serie de 2 años completos uniformes → todos los meses ≈ 0%", () => {
    const serie = [];
    for (const a of [2024, 2025]) {
      for (let m = 1; m <= 12; m++) {
        serie.push({
          fecha_mes: `${a}-${String(m).padStart(2, "0")}-01`,
          valor: 100,
        });
      }
    }
    const r = getPerfilEstacionalEmpirico(serie);
    expect(r.anios_usados).toEqual([2024, 2025]);
    r.valores.forEach((v) => expect(v).toBeCloseTo(0, 6));
  });

  it("serie con marcado patrón de junio (×2) → junio ≈ +85%", () => {
    // Cada año: 11 meses con 100, junio con 200. Media anual = (11*100+200)/12 = 108.33
    // Ratio junio = 200/108.33 = 1.846 → desviación = +84.6%
    const serie = [];
    for (const a of [2024, 2025]) {
      for (let m = 1; m <= 12; m++) {
        serie.push({
          fecha_mes: `${a}-${String(m).padStart(2, "0")}-01`,
          valor: m === 6 ? 200 : 100,
        });
      }
    }
    const r = getPerfilEstacionalEmpirico(serie);
    expect(r.valores[5]).toBeCloseTo(84.6, 1); // junio (índice 5)
    // Resto: 100 / 108.33 = 0.923 → -7.7%
    expect(r.valores[0]).toBeCloseTo(-7.7, 1);
  });

  it("descarta años incompletos del cálculo", () => {
    const serie = [
      // 2025 completo
      ...Array.from({ length: 12 }, (_, i) => ({
        fecha_mes: `2025-${String(i + 1).padStart(2, "0")}-01`,
        valor: 100,
      })),
      // 2026 incompleto (solo 4 meses) → debe ignorarse
      ...Array.from({ length: 4 }, (_, i) => ({
        fecha_mes: `2026-${String(i + 1).padStart(2, "0")}-01`,
        valor: 999,
      })),
    ];
    const r = getPerfilEstacionalEmpirico(serie);
    expect(r.anios_usados).toEqual([2025]);
    expect(r.n_observaciones_por_mes.every((n) => n === 1)).toBe(true);
  });

  it("serie vacía → 12 NaN", () => {
    const r = getPerfilEstacionalEmpirico([]);
    expect(r.anios_usados).toEqual([]);
    expect(r.valores.every((v) => Number.isNaN(v))).toBe(true);
  });
});
