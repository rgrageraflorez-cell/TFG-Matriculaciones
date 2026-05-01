/**
 * protocoloSilencio.mock.ts
 * ────────────────────────────────────────────────────────────────────────────
 * MOCK: sustituir por datos reales cuando exista persistencia de predicciones
 * historicas mes a mes (ver TODO_PERSISTENCIA_PREDICCIONES.md en la raiz).
 *
 * Mientras tanto, este modulo devuelve un objeto SaludModelo sintetico para
 * que el componente del badge se renderice y el flujo del Patron 1 sea
 * verificable visualmente sin engañar al usuario sobre el estado real del
 * modelo (la UI siempre muestra la nota "datos de demostracion").
 *
 * Para QA visual de los tres estados, anade `?mock_silencio=ok|degraded|
 * silenced` en la URL al cargar la pagina.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
  type SaludModelo,
  UMBRAL_OK,
  UMBRAL_SILENCED,
  type EstadoSalud,
} from "./protocoloSilencio";

const MOCK_PRESETS: Record<EstadoSalud, SaludModelo> = {
  ok: {
    rolling_mape: 9.4,
    n_meses_evaluados: 6,
    ultimo_mes_evaluado: "2026-04",
    status: "ok",
    umbral_ok: UMBRAL_OK,
    umbral_silenced: UMBRAL_SILENCED,
  },
  degraded: {
    rolling_mape: 15.7,
    n_meses_evaluados: 6,
    ultimo_mes_evaluado: "2026-04",
    status: "degraded",
    umbral_ok: UMBRAL_OK,
    umbral_silenced: UMBRAL_SILENCED,
  },
  silenced: {
    rolling_mape: 23.2,
    n_meses_evaluados: 6,
    ultimo_mes_evaluado: "2026-04",
    status: "silenced",
    umbral_ok: UMBRAL_OK,
    umbral_silenced: UMBRAL_SILENCED,
  },
};

/**
 * Devuelve el preset segun ?mock_silencio=... o "ok" por defecto.
 * Indicador `isMock=true` para que la UI lo muestre claramente.
 */
export function getSaludModeloMock(): SaludModelo & { isMock: true } {
  let preset: EstadoSalud = "ok";
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("mock_silencio");
    if (q === "degraded" || q === "silenced" || q === "ok") preset = q;
  }
  return { ...MOCK_PRESETS[preset], isMock: true };
}
