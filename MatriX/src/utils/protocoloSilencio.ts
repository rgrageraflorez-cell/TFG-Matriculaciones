/**
 * protocoloSilencio.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Evalua la salud del modelo predictivo a partir del historico de
 * predicciones vs valores reales.
 *
 * El nivel REAL (calculo sobre predicciones historicas persistidas mes a mes)
 * NO esta operativo todavia: el dataset df_real_pred_mensual_total.csv solo
 * contiene la prediccion del modelo *actual*, sobreescrita en cada
 * reentrenamiento. Falta un log append-only del estilo
 * (ingesta_fecha, fecha_mes_predicho, prediccion). Cuando exista, este
 * modulo pasa a usarse con datos reales sin cambios; mientras tanto se
 * acompana de protocoloSilencio.mock.ts.
 * Detalle en TODO_PERSISTENCIA_PREDICCIONES.md.
 * ────────────────────────────────────────────────────────────────────────────
 */

// ── Umbrales del Protocolo de Silencio ──────────────────────────────────────
// Calibrados a partir del MAPE de referencia del modelo (8,56% en test).
// 12% = aproximadamente 1,5x el MAPE de referencia: degradacion moderada.
// 20% = aproximadamente 2,5x el MAPE de referencia: prediccion no fiable.
// Estos umbrales son heuristicos. Revision recomendada tras 12 meses de
// operacion con datos reales acumulados.
export const UMBRAL_OK = 12;
export const UMBRAL_SILENCED = 20;

export type EstadoSalud = "ok" | "degraded" | "silenced";

export type SaludModelo = {
  rolling_mape: number;
  n_meses_evaluados: number;
  ultimo_mes_evaluado: string; // YYYY-MM
  status: EstadoSalud;
  umbral_ok: number;
  umbral_silenced: number;
};

/**
 * Par de series para evaluacion. Ambas alineadas por indice (mismo mes
 * en la misma posicion) y restringidas a meses cerrados (real conocido).
 */
export type SerieEvaluable = {
  fecha_mes: string; // YYYY-MM-01 o YYYY-MM
  prediccion: number;
  real: number;
};

/**
 * Calcula el MAPE de los ultimos N meses cerrados disponibles. Devuelve
 * el objeto SaludModelo con el status segun los umbrales.
 *
 * Importante: el MAPE devuelto es RETROSPECTIVO (mide la calidad reciente
 * del modelo sobre meses pasados con valor real conocido). NO es un
 * indicador del error del forecast actual. La UI debe dejarlo claro.
 */
export function evaluarSaludModelo(
  serie: SerieEvaluable[],
  ventanaMeses: number = 6,
): SaludModelo {
  // Filtramos filas validas y ordenamos por fecha ascendente
  const validas = serie
    .filter(
      (r) =>
        Number.isFinite(r.prediccion) &&
        Number.isFinite(r.real) &&
        r.real > 0,
    )
    .sort((a, b) => a.fecha_mes.localeCompare(b.fecha_mes));

  if (validas.length === 0) {
    return {
      rolling_mape: NaN,
      n_meses_evaluados: 0,
      ultimo_mes_evaluado: "",
      status: "silenced",
      umbral_ok: UMBRAL_OK,
      umbral_silenced: UMBRAL_SILENCED,
    };
  }

  const ventana = validas.slice(-ventanaMeses);
  const errores = ventana.map(
    (r) => Math.abs(r.prediccion - r.real) / r.real,
  );
  const mape = (errores.reduce((s, e) => s + e, 0) / errores.length) * 100;

  let status: EstadoSalud;
  if (mape < UMBRAL_OK) status = "ok";
  else if (mape < UMBRAL_SILENCED) status = "degraded";
  else status = "silenced";

  return {
    rolling_mape: mape,
    n_meses_evaluados: ventana.length,
    ultimo_mes_evaluado: ventana[ventana.length - 1].fecha_mes.slice(0, 7),
    status,
    umbral_ok: UMBRAL_OK,
    umbral_silenced: UMBRAL_SILENCED,
  };
}
