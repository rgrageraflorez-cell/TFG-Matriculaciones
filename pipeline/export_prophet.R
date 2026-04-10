# ============================================================
# EXPORT_PROPHET.R
# Entrena Prophet sobre la serie mensual y anade pred_prophet
# al CSV df_real_pred_mensual_total.csv ya existente.
#
# Ejecutar:  Rscript pipeline/export_prophet.R
# ============================================================

library(dplyr)
library(readr)
library(lubridate)

if (!requireNamespace("prophet", quietly = TRUE)) install.packages("prophet")
library(prophet)

# ── Rutas (misma convención que update_pipeline.R) ──
BASE_DIR <- normalizePath("~/4 Carrera/TFG/Practica", winslash = "/")
OUT_DIR  <- file.path(BASE_DIR, "Analisis/Datasets web")
PUB_DIR  <- file.path(BASE_DIR, "Analisis/Datasets web/Web dashboard/public")
CSV_PATH <- file.path(PUB_DIR, "df_real_pred_mensual_total.csv")

cat("Leyendo CSV existente:", CSV_PATH, "\n")
df <- read_csv(CSV_PATH, show_col_types = FALSE)

# ── Preparar datos para Prophet ──
# Prophet necesita columnas ds (Date) e y (valor)
df_prophet_input <- df %>%
  filter(!is.na(real)) %>%
  transmute(ds = as.Date(fecha_mes), y = real)

# Train: hasta dic 2024 (igual que TBATS)
fecha_corte <- as.Date("2024-12-01")
df_train <- df_prophet_input %>% filter(ds <= fecha_corte)

cat(sprintf("Entrenando Prophet con %d meses (hasta %s)\n",
            nrow(df_train), as.character(fecha_corte)))

# ── Ajustar Prophet ──
m <- prophet(
  yearly.seasonality      = TRUE,
  weekly.seasonality      = FALSE,
  daily.seasonality       = FALSE,
  seasonality.mode        = "multiplicative",
  changepoint.prior.scale = 0.05,
  seasonality.prior.scale = 10
)
m <- add_country_holidays(m, country_name = "ES")
m <- fit.prophet(m, df_train)

# ── Forecast: cubrir todo el rango del CSV ──
all_dates <- as.Date(df$fecha_mes)
future_df <- data.frame(ds = all_dates)
fc <- predict(m, future_df)

# ── Agregar columna pred_prophet al CSV ──
df$pred_prophet <- fc$yhat

# ── Escribir ──
write_csv(df, CSV_PATH)

cat(sprintf("CSV actualizado con pred_prophet (%d filas)\n", nrow(df)))
cat("Archivo escrito:", CSV_PATH, "\n")
cat("Hecho.\n")
