# TODO — Persistencia de predicciones históricas

Este documento describe qué hay que hacer para que el **Protocolo de Silencio**
del dashboard MatriX (Patrón 1) deje de operar en modo demostración y pase a
calcular el `rolling_mape` con datos reales.

## Estado actual

El dataset `Datasets web/Web dashboard/public/df_real_pred_mensual_total.csv`
contiene, para cada `fecha_mes`, el valor `real` (cuando ya es histórico) y
los valores `prediccion` y `pred_prophet` del **modelo recién reentrenado**.
Es decir, cada vez que el pipeline mensual ejecuta `update_pipeline.R`, los
valores de `prediccion`/`pred_prophet` para todos los meses se sobrescriben
con la salida del nuevo modelo.

Implicación: NO se puede medir cómo de bien fueron acertando las
predicciones del modelo *en operación* a medida que llegaba cada mes nuevo.
Solo tenemos el ajuste retrospectivo del modelo *actual* a la serie
histórica completa, que es una cosa distinta.

## Qué hace falta

Un log **append-only** que registre cada predicción tal como existía cuando
se generó. Estructura sugerida del CSV:

```
ingesta_fecha,fecha_mes_predicho,prediccion,pred_prophet
2024-02-01,2024-02-01,135422.10,131204.45
2024-02-01,2024-03-01,141220.85,138997.31
2024-02-01,2024-04-01,...
2024-03-01,2024-03-01,142005.20,140112.78
2024-03-01,2024-04-01,...
```

- `ingesta_fecha`: el primer día del mes en que se ejecutó el pipeline.
- `fecha_mes_predicho`: el mes que el modelo está prediciendo.
- `prediccion`/`pred_prophet`: lo que predijo en ese momento.

Cada ejecución mensual del pipeline **append**ea sus filas, no sobrescribe
las anteriores. Así, para evaluar el modelo en operación, se cruza con la
columna `real` de `df_real_pred_mensual_total.csv` cuando ese mes ya esté
cerrado.

## Cambio mínimo en el pipeline R

En `pipeline/update_pipeline.R` (o donde se genere `df_real_pred_mensual_total.csv`),
añadir tras el cálculo del forecast:

```r
log_path <- "Datasets web/Web dashboard/public/predicciones_historicas.csv"
filas_log <- df_forecast %>%
  mutate(ingesta_fecha = format(Sys.Date(), "%Y-%m-01")) %>%
  select(ingesta_fecha, fecha_mes_predicho = fecha_mes,
         prediccion, pred_prophet)
if (file.exists(log_path)) {
  write.table(filas_log, log_path, sep = ",", row.names = FALSE,
              col.names = FALSE, append = TRUE, fileEncoding = "UTF-8")
} else {
  write.csv(filas_log, log_path, row.names = FALSE, fileEncoding = "UTF-8")
}
```

## Cambio mínimo en el frontend

Una vez exista el CSV, sustituir en `src/PredictivaTab.tsx`:

```ts
// Antes (mock):
import { getSaludModeloMock } from "./utils/protocoloSilencio.mock";
const salud = getSaludModeloMock();

// Después (real):
import { evaluarSaludModelo } from "./utils/protocoloSilencio";
import { fetchCsv } from "./utils.tsx";

// dentro de useEffect, paralelo al resto de cargas:
const historicas = await fetchCsv("/predicciones_historicas.csv", (r) => ({
  ingesta_fecha: r.ingesta_fecha,
  fecha_mes: r.fecha_mes_predicho,
  prediccion: parseNumber(r.prediccion) ?? NaN,
  pred_prophet: parseNumber(r.pred_prophet) ?? NaN,
}));

// Pareamos cada prediccion historica con el real conocido del mismo mes.
// Para cada (ingesta_fecha, fecha_mes), tomamos la prediccion mas reciente
// previa al mes a predecir (la del mismo mes de ingesta = "prediccion en
// vivo del mes siguiente" si esa es la cadencia).
const serieEval = construirSerieEvaluable(historicas, predData);
const salud = evaluarSaludModelo(serieEval, 6);
```

Quitar el badge `DEMO` y borrar el banner de la ficha técnica.

## Calendario realista

El log empieza vacío. Los **primeros 6 meses tras activarlo** seguirán con
n insuficiente para un MAPE rolling fiable. A los 12 meses el indicador es
sólido y los umbrales se pueden recalibrar (sección 1.2 del Patrón 1).
