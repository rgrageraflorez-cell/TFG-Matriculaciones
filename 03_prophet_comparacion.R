# ============================================================
# 03_PROPHET_COMPARACION.R
# Ajuste de Prophet + comparación con TBATS (serie mensual)
# TFG — Análisis de la demanda automovilística en España
#
# Secciones del TFG cubiertas:
#   5.2.2  Serie Mensual (modelos predictivos)
#   5.2.4  Métricas de evaluación
#   5.2.5  Visualización de los modelos
#   5.3.1  Serie mensual: diagnóstico y selección de modelo
#
# Asume en sesión: ts_mensual_turismos, df_mensual_agrupado,
#                  train, fit_tbats, fc_2025_2026, real_2025
# ============================================================

library(dplyr)
library(ggplot2)
library(tidyr)
library(lubridate)
library(forecast)

if (!requireNamespace("prophet", quietly = TRUE)) install.packages("prophet")
library(prophet)

# ============================================================
# 5.2.2  SERIE MENSUAL — Estrategia de validación
# ============================================================
# Partición idéntica a la usada para TBATS:
#   · Entrenamiento: enero 2021 – diciembre 2024
#   · Test        : meses disponibles de 2025

# Número de meses de test disponibles (heredado del script principal)
n_test <- length(real_2025)

cat(sprintf("Estrategia de validación: train 2021-01 / 2024-12  |  test: %d meses de 2025\n",
            n_test))

# ============================================================
# 5.2.2  PREPARACIÓN DE DATOS PARA PROPHET
# ============================================================
# Prophet exige un dataframe con columnas `ds` (Date) e `y` (valor).

df_prophet_full <- df_mensual_agrupado %>%
  mutate(ds = as.Date(paste(Año, Mes, "01", sep = "-")),
         y  = Turismos) %>%
  select(ds, y) %>%
  arrange(ds)

# Split train / test
fecha_corte    <- as.Date("2024-12-01")
df_prophet_train <- df_prophet_full %>% filter(ds <= fecha_corte)
df_prophet_test  <- df_prophet_full %>% filter(ds >  fecha_corte) %>% slice_head(n = n_test)

cat(sprintf("Filas train Prophet: %d  |  Filas test: %d\n",
            nrow(df_prophet_train), nrow(df_prophet_test)))

# ============================================================
# 5.2.2  AJUSTE DEL MODELO PROPHET
# ============================================================
# Componentes activos:
#   - Tendencia lineal (changepoint_prior_scale moderado)
#   - Estacionalidad anual (Fourier order = 5 para capturar armónicos)
#   - Festivos nacionales de España

m_prophet <- prophet(
  yearly.seasonality  = TRUE,
  weekly.seasonality  = FALSE,   # serie mensual: no hay ciclo semanal
  daily.seasonality   = FALSE,
  seasonality.mode    = "multiplicative",   # la amplitud de la estac. escala con la tendencia
  changepoint.prior.scale = 0.05,           # regularización de cambios de tendencia
  seasonality.prior.scale = 10
)

m_prophet <- add_country_holidays(m_prophet, country_name = "ES")
m_prophet <- fit.prophet(m_prophet, df_prophet_train)

cat("Modelo Prophet ajustado correctamente.\n")

# ============================================================
# 5.2.2  PRONÓSTICO PROPHET
# ============================================================

# Horizonte: suficiente para cubrir todo el test + margen hasta dic-2026
h_prophet  <- 24
future_df  <- make_future_dataframe(m_prophet, periods = h_prophet, freq = "month")
fc_prophet <- predict(m_prophet, future_df)

# Extraer predicciones para los meses de test (2025 disponibles)
pred_prophet_test <- fc_prophet %>%
  filter(ds %in% df_prophet_test$ds) %>%
  pull(yhat)

# Predicciones TBATS para el mismo periodo de test
pred_tbats_test <- as.numeric(fc_2025_2026$mean)[1:n_test]

# Valores reales del test
real_test <- as.numeric(real_2025)

cat(sprintf("Longitudes  real=%d  TBATS=%d  Prophet=%d\n",
            length(real_test), length(pred_tbats_test), length(pred_prophet_test)))

# ============================================================
# 5.2.4  MÉTRICAS DE EVALUACIÓN
# ============================================================
# MAE  : error medio absoluto (unidades de matriculaciones)
# RMSE : raíz del error cuadrático medio (penaliza errores grandes)
# MAPE : error porcentual medio absoluto (independiente de la escala)

calcular_metricas <- function(real, pred, nombre) {
  tibble(
    Modelo = nombre,
    MAE    = mean(abs(real - pred)),
    RMSE   = sqrt(mean((real - pred)^2)),
    MAPE   = mean(abs(real - pred) / abs(real)) * 100
  )
}

df_metricas <- bind_rows(
  calcular_metricas(real_test, pred_tbats_test,   "TBATS"),
  calcular_metricas(real_test, pred_prophet_test, "Prophet")
)

# --- AIC: criterio de información de Akaike (pseudo-AIC gaussiano) ---
# Para que ambos modelos sean comparables se usa la misma fórmula:
#   AIC = n·ln(RSS/n) + 2·k
# donde RSS = suma de residuos al cuadrado sobre el entrenamiento y
# k = nº de parámetros estimados por cada modelo.

# -- Residuos de entrenamiento de TBATS --
residuos_tbats_train <- as.numeric(residuals(fit_tbats))
n_train_tbats        <- length(residuos_tbats_train)
rss_tbats            <- sum(residuos_tbats_train^2)

# Parámetros de TBATS: el objeto almacena la dimensión del vector de estados
# k = p (AR) + q (MA) + componentes de nivel/tendencia/estacionalidad + sigma
k_tbats <- length(fit_tbats$parameters$vect) + 1   # +1 por sigma

aic_tbats <- n_train_tbats * log(rss_tbats / n_train_tbats) + 2 * k_tbats

# -- Residuos de entrenamiento de Prophet --
fitted_prophet_train <- fc_prophet %>%
  filter(ds %in% df_prophet_train$ds) %>%
  arrange(ds) %>%
  pull(yhat)
residuos_prophet_train <- df_prophet_train$y - fitted_prophet_train
n_train_prophet        <- length(residuos_prophet_train)
rss_prophet            <- sum(residuos_prophet_train^2)

# Parámetros de Prophet:
#   - Tendencia: 2 (m, delta_0) + nº changepoints
#   - Estacionalidad anual (multiplicativa): 2 * fourier_order
#   - Festivos ES: 1 coeficiente por festivo único
n_changepoints   <- length(m_prophet$changepoints)
fourier_order    <- m_prophet$seasonalities$yearly$fourier.order
n_holidays       <- nrow(m_prophet$holidays)
k_prophet        <- 2 + n_changepoints + 2 * fourier_order + n_holidays + 1  # +1 por sigma

aic_prophet <- n_train_prophet * log(rss_prophet / n_train_prophet) + 2 * k_prophet

df_metricas <- df_metricas %>%
  mutate(AIC = c(aic_tbats, aic_prophet))

cat("\n===== MÉTRICAS DE EVALUACIÓN (conjunto de prueba 2025) =====\n")
print(df_metricas, digits = 4)
cat(sprintf("\nAIC  →  TBATS: %.2f  |  Prophet: %.2f  (menor = mejor ajuste-complejidad)\n",
            aic_tbats, aic_prophet))

# ============================================================
# 5.2.5  VISUALIZACIÓN DE LOS MODELOS
# ============================================================

# --- 5.2.5.a  Gráfico real vs TBATS vs Prophet (periodo completo) ---

# Serie completa con fitted + forecast de TBATS
fitted_tbats   <- as.numeric(fitted(fit_tbats))
pred_tbats_all <- as.numeric(fc_2025_2026$mean)

fechas_full <- seq(as.Date("2021-01-01"),
                   by    = "month",
                   length.out = length(fitted_tbats) + length(pred_tbats_all))

# Serie completa de Prophet (fitted + forecast)
fitted_prophet_all <- fc_prophet %>%
  arrange(ds) %>%
  pull(yhat)

fechas_prophet_all <- fc_prophet %>% arrange(ds) %>% pull(ds)

df_plot <- bind_rows(
  # Real
  df_prophet_full %>%
    mutate(serie = "Real", valor = y) %>%
    select(fecha = ds, serie, valor),
  # TBATS
  tibble(
    fecha = fechas_full,
    serie = "TBATS",
    valor = c(fitted_tbats, pred_tbats_all)
  ),
  # Prophet
  tibble(
    fecha = as.Date(fechas_prophet_all),
    serie = "Prophet",
    valor = fitted_prophet_all
  )
) %>%
  filter(fecha >= as.Date("2021-01-01"))

# Sombreado del periodo de test
fecha_ini_test <- as.Date("2025-01-01")
fecha_fin_test <- df_prophet_test$ds[n_test]

p_comparacion <- ggplot(df_plot, aes(x = fecha, y = valor, color = serie, linetype = serie)) +
  annotate("rect",
           xmin = fecha_ini_test, xmax = fecha_fin_test + 15,
           ymin = -Inf, ymax = Inf,
           alpha = 0.08, fill = "steelblue") +
  annotate("text",
           x     = fecha_ini_test + 30,
           y     = max(df_plot$valor, na.rm = TRUE) * 0.97,
           label = "Periodo de test",
           size  = 3.2, color = "steelblue4", hjust = 0) +
  geom_line(linewidth = 0.9) +
  geom_vline(xintercept = as.numeric(as.Date("2025-01-01")),
             linetype = "dashed", color = "grey50", linewidth = 0.6) +
  scale_color_manual(
    values   = c("Real" = "black", "TBATS" = "#E74C3C", "Prophet" = "#2980B9"),
    name     = "Serie"
  ) +
  scale_linetype_manual(
    values   = c("Real" = "solid", "TBATS" = "dashed", "Prophet" = "dotdash"),
    name     = "Serie"
  ) +
  scale_y_continuous(labels = scales::comma) +
  labs(
    title    = "Serie mensual de matriculaciones: real vs TBATS vs Prophet",
    subtitle = paste0("Entrenamiento: 2021–2024  |  Test: 2025 (", n_test, " meses)"),
    x        = "Fecha",
    y        = "Matriculaciones",
    caption  = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "bottom")

ggsave("comparacion_tbats_prophet.png", p_comparacion, width = 10, height = 6, dpi = 300)

# --- 5.2.5.b  Gráfico de error mensual en el test ---

fechas_test <- df_prophet_test$ds

df_error <- tibble(
  fecha         = fechas_test,
  Error_TBATS   = real_test - pred_tbats_test,
  Error_Prophet = real_test - pred_prophet_test
) %>%
  pivot_longer(cols = starts_with("Error"),
               names_to  = "Modelo",
               values_to = "Error",
               names_prefix = "Error_")

p_error <- ggplot(df_error, aes(x = fecha, y = Error, fill = Modelo)) +
  geom_col(position = "dodge", alpha = 0.8) +
  geom_hline(yintercept = 0, color = "black", linewidth = 0.6) +
  scale_fill_manual(values = c("TBATS" = "#E74C3C", "Prophet" = "#2980B9")) +
  scale_y_continuous(labels = scales::comma) +
  labs(
    title   = "Error de predicción mensual en el conjunto de test (2025)",
    x       = "Mes",
    y       = "Error (real − predicho)",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "bottom")

ggsave("error_mensual_test.png", p_error, width = 10, height = 5, dpi = 300)

# --- 5.2.5.c  Barplot comparativo de métricas ---

df_metricas_long <- df_metricas %>%
  pivot_longer(cols = c(MAE, RMSE, MAPE, AIC),
               names_to  = "Metrica",
               values_to = "Valor")

p_metricas <- ggplot(df_metricas_long,
                     aes(x = Metrica, y = Valor, fill = Modelo)) +
  geom_col(position = "dodge", width = 0.6, alpha = 0.9) +
  geom_text(aes(label = round(Valor, 1)),
            position = position_dodge(width = 0.6),
            vjust = -0.4, size = 3.5) +
  scale_fill_manual(values = c("TBATS" = "#E74C3C", "Prophet" = "#2980B9")) +
  facet_wrap(~ Metrica, scales = "free_y", nrow = 1) +
  labs(
    title   = "Comparación de métricas de evaluación: TBATS vs Prophet",
    subtitle = "Calculadas sobre el conjunto de prueba (2025)",
    x       = NULL,
    y       = "Valor de la métrica",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "bottom",
        strip.text      = element_text(face = "bold"))

ggsave("metricas_tbats_prophet.png", p_metricas, width = 10, height = 5, dpi = 300)

# ============================================================
# 5.2.2  DIAGNÓSTICO DE PROPHET (componentes y residuos)
# ============================================================

# Gráfico de componentes de Prophet
p_comp <- prophet_plot_components(m_prophet, fc_prophet)
# Se guarda manualmente si es necesario (es un gtable de ggplot2)

# Residuos de Prophet en entrenamiento
df_prophet_train_fitted <- fc_prophet %>%
  filter(ds %in% df_prophet_train$ds) %>%
  left_join(df_prophet_train, by = "ds") %>%
  mutate(residuo = y - yhat)

p_res_prophet <- ggplot(df_prophet_train_fitted, aes(x = ds, y = residuo)) +
  geom_line(color = "#2980B9", linewidth = 0.8) +
  geom_point(color = "#2980B9", size = 1.5) +
  geom_hline(yintercept = 0, color = "black", linewidth = 0.6) +
  geom_smooth(method = "loess", se = FALSE, color = "firebrick",
              linewidth = 0.7, formula = y ~ x) +
  scale_y_continuous(labels = scales::comma) +
  labs(
    title   = "Residuos del modelo Prophet (conjunto de entrenamiento)",
    x       = "Fecha",
    y       = "Residuo (real − ajustado)",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12)

ggsave("residuos_prophet_train.png", p_res_prophet, width = 9, height = 5, dpi = 300)

# ============================================================
# 5.3.1  DIAGNÓSTICO Y SELECCIÓN DE MODELO (serie mensual)
# ============================================================

mejor_modelo <- df_metricas$Modelo[which.min(df_metricas$RMSE)]
peor_modelo  <- df_metricas$Modelo[which.max(df_metricas$RMSE)]

rmse_tbats   <- df_metricas$RMSE[df_metricas$Modelo == "TBATS"]
rmse_prophet <- df_metricas$RMSE[df_metricas$Modelo == "Prophet"]
mape_tbats   <- df_metricas$MAPE[df_metricas$Modelo == "TBATS"]
mape_prophet <- df_metricas$MAPE[df_metricas$Modelo == "Prophet"]
mae_tbats    <- df_metricas$MAE[df_metricas$Modelo  == "TBATS"]
mae_prophet  <- df_metricas$MAE[df_metricas$Modelo  == "Prophet"]

mejora_rmse  <- abs(rmse_tbats - rmse_prophet) / max(rmse_tbats, rmse_prophet) * 100

cat("\n\n===== 5.3.1  DIAGNÓSTICO Y SELECCIÓN DE MODELO — SERIE MENSUAL =====\n")
cat(sprintf(
  "TBATS   → MAE = %7.1f  |  RMSE = %7.1f  |  MAPE = %.2f%%  |  AIC = %.2f\n",
  mae_tbats, rmse_tbats, mape_tbats, aic_tbats
))
cat(sprintf(
  "Prophet → MAE = %7.1f  |  RMSE = %7.1f  |  MAPE = %.2f%%  |  AIC = %.2f\n",
  mae_prophet, rmse_prophet, mape_prophet, aic_prophet
))
cat(sprintf(
  "\nModelo seleccionado: %s (RMSE %.1f%% %s que %s)\n",
  mejor_modelo,
  mejora_rmse,
  ifelse(rmse_tbats < rmse_prophet, "inferior", "inferior"),
  peor_modelo
))

cat("\nINTERPRETACIÓN:\n")
cat(sprintf(
  "- El modelo %s obtiene el menor RMSE (%.0f matr.) y el menor MAPE (%.2f%%), lo que indica
  que sus predicciones se aproximan más a los datos reales del periodo de test.\n",
  mejor_modelo, min(rmse_tbats, rmse_prophet), min(mape_tbats, mape_prophet)
))
cat(sprintf(
  "- TBATS captura estacionalidades múltiples mediante series de Fourier de forma automática,
  lo que lo hace especialmente adecuado para la serie mensual de matriculaciones, cuyo
  periodograma revela componentes a 12 y 6 meses simultáneamente.\n"
))
cat(sprintf(
  "- Prophet modela la tendencia mediante changepoints y la estacionalidad también con Fourier,
  incorporando además festivos nacionales (ES). Su rendimiento %s al de TBATS en este contexto,
  lo que %s la hipótesis planteada en el marco teórico: la capacidad de TBATS para gestionar
  estacionalidades simultáneas %s la ventaja de Prophet en festivos.\n",
  ifelse(mape_prophet > mape_tbats, "es inferior", "es superior"),
  ifelse(mape_prophet > mape_tbats, "confirma", "refuta"),
  ifelse(mape_prophet > mape_tbats, "supera", "no compensa")
))
cat(sprintf(
  "- Se selecciona %s como modelo definitivo para la predicción de la serie mensual.\n",
  mejor_modelo
))

