# ============================================================
# EXPORT_MD_DIARIO.R
# Genera el CSV de predicciones diarias del modelo MD
# para alimentar la pestana Predictiva del dashboard
#
# SALIDA:
#   df_md_diario.csv (fecha, real, pred_md, pred_baseline, dow, laborable)
#
# REQUISITOS:
#   - Análisis diario.xlsx con sheets de meses disponibles
#   - Forecast mensual TBATS (se calcula aqui si no existe)
# ============================================================

cat("========================================\n")
cat("EXPORT MD DIARIO\n")
cat(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n")
cat("========================================\n\n")

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(lubridate)
  library(tidyr)
  library(stringr)
  library(readr)
  library(forecast)
})

# ============================================================
# RUTAS
# ============================================================
BASE_DIR   <- normalizePath("~/4 Carrera/TFG/Practica", winslash = "/")
DAILY_FILE <- file.path(BASE_DIR, "Filtrado de datos/Dataset/Matriculaciones ES/Datos diarios/Análisis diario.xlsx")
OUT_DIR    <- file.path(BASE_DIR, "Analisis/Datasets web")
PUBLIC_DIR <- file.path(BASE_DIR, "Analisis/Datasets web/Web dashboard/public")

stopifnot("Fichero diario no encontrado" = file.exists(DAILY_FILE))

# ============================================================
# FUNCIONES MD (replicadas de MD diario.R)
# ============================================================

safe_div <- function(x, y) {
  if (length(y) == 1) {
    if (is.na(y) || y == 0) return(rep(0, length(x)))
    return(x / y)
  }
  out <- x / y
  out[is.na(y) | y == 0] <- 0
  out
}

cross_entropy_weights <- function(p_real, p_pred, eps = 1e-12) {
  p_pred <- pmax(p_pred, eps)
  -sum(p_real * log(p_pred), na.rm = TRUE)
}

crear_calendario <- function(fechas, festivos = as.Date(character())) {
  tibble(fecha = as.Date(fechas)) %>%
    mutate(
      year = year(fecha), month = month(fecha), day = day(fecha),
      ym = floor_date(fecha, "month"),
      dow_num = wday(fecha, week_start = 1),
      dow = c("lunes","martes","miercoles","jueves","viernes","sabado","domingo")[dow_num],
      fin_semana = as.integer(dow_num >= 6),
      festivo = as.integer(as.Date(fecha) %in% as.Date(festivos)),
      laborable = as.integer(fin_semana == 0 & festivo == 0)
    ) %>%
    group_by(ym) %>% arrange(fecha, .by_group = TRUE) %>%
    mutate(laborable_idx = if_else(laborable == 1, cumsum(laborable), NA_integer_)) %>%
    ungroup()
}

preparar_dataset <- function(df, festivos = as.Date(character())) {
  df <- df %>% mutate(fecha = as.Date(fecha), unidades = as.numeric(unidades))
  calendario <- crear_calendario(df$fecha, festivos = festivos)
  df %>% left_join(calendario, by = "fecha") %>% arrange(fecha)
}

calcular_beta_dow_excel <- function(df_mes_ref, eps = 1e-12) {
  total_mes <- sum(df_mes_ref$unidades, na.rm = TRUE)
  sumas <- tapply(df_mes_ref$unidades, df_mes_ref$dow_num, sum, na.rm = TRUE)
  unidades_vec <- setNames(rep(0, 7), as.character(1:7))
  unidades_vec[names(sumas)] <- as.numeric(sumas)
  share_vec <- unidades_vec / total_mes
  beta_vec <- log((share_vec + eps) / (1/7))
  tibble(dow_num = 1:7, beta_dia = as.numeric(beta_vec))
}

construir_p_m1 <- function(df_mes_ref, df_mes_objetivo) {
  tabla_ref <- df_mes_ref %>% filter(laborable == 1) %>% arrange(fecha) %>%
    mutate(total_lab = sum(unidades, na.rm = TRUE), p_m1 = safe_div(unidades, total_lab)) %>%
    select(laborable_idx, p_m1)
  p_m1_medio <- mean(tabla_ref$p_m1, na.rm = TRUE)
  df_mes_objetivo %>%
    left_join(tabla_ref, by = "laborable_idx") %>%
    mutate(p_m1 = if_else(laborable == 1 & is.na(p_m1), p_m1_medio, p_m1),
           p_m1 = if_else(laborable == 0, 0, p_m1))
}

calcular_scores_y_pesos_md <- function(df_mes_obj, beta_dow_df, alpha, w) {
  tabla_beta <- beta_dow_df %>%
    mutate(logistic_dia = 1 / (1 + exp(-alpha * beta_dia))) %>%
    select(dow_num, logistic_dia)
  df_out <- df_mes_obj %>%
    left_join(tabla_beta, by = "dow_num") %>%
    mutate(score = if_else(laborable == 1, ((1 - w) * logistic_dia + w * p_m1), 0))
  suma_scores <- sum(df_out$score, na.rm = TRUE)
  df_out %>% mutate(peso_md = safe_div(score, suma_scores))
}

ejecutar_md_mes <- function(df_mes_ref, df_mes_objetivo, alpha, w, forecast_mensual) {
  beta_dow_df <- calcular_beta_dow_excel(df_mes_ref)
  df_base <- construir_p_m1(df_mes_ref, df_mes_objetivo)
  df_base <- df_base %>%
    mutate(peso_real = if_else(
      laborable == 1,
      safe_div(unidades, sum(unidades[laborable == 1], na.rm = TRUE)),
      0
    ))
  df_md <- calcular_scores_y_pesos_md(df_base, beta_dow_df, alpha, w)
  df_md %>% mutate(forecast_mensual = forecast_mensual, pred_unidades = forecast_mensual * peso_md)
}

coste_md_entropia <- function(par, df_mes_ref, df_mes_objetivo) {
  w <- par[1]; alpha <- par[2]
  beta_dow_df <- calcular_beta_dow_excel(df_mes_ref)
  df_base <- construir_p_m1(df_mes_ref, df_mes_objetivo)
  df_base <- df_base %>%
    mutate(peso_real = if_else(
      laborable == 1,
      safe_div(unidades, sum(unidades[laborable == 1], na.rm = TRUE)),
      0
    ))
  df_pred <- calcular_scores_y_pesos_md(df_base, beta_dow_df, alpha, w)
  cross_entropy_weights(df_pred$peso_real, df_pred$peso_md)
}

optimizar_w_alpha <- function(df_mes_ref, df_mes_objetivo) {
  opt <- optim(par = c(0.5, 1), fn = coste_md_entropia,
               df_mes_ref = df_mes_ref, df_mes_objetivo = df_mes_objetivo,
               method = "L-BFGS-B", lower = c(0.2, 0.1), upper = c(0.95, 20))
  list(w_opt = opt$par[1], alpha_opt = opt$par[2], entropia_opt = opt$value)
}

# ============================================================
# CARGA DE DATOS DIARIOS
# ============================================================
cat("[1/4] Cargando datos diarios...\n")

sheets <- excel_sheets(DAILY_FILE)
cat("  Sheets encontradas:", paste(sheets, collapse = ", "), "\n")

all_months <- list()
for (i in seq_along(sheets)) {
  df_raw <- tryCatch(
    read_excel(DAILY_FILE, sheet = i),
    error = function(e) { cat("  Error leyendo sheet", i, "\n"); NULL }
  )
  if (is.null(df_raw)) next

  # Detectar columna de fecha
  fecha_col <- names(df_raw)[str_detect(tolower(names(df_raw)), "fecha")][1]
  if (is.na(fecha_col)) next

  df_agg <- df_raw %>%
    rename(fecha = !!sym(fecha_col)) %>%
    filter(!is.na(fecha)) %>%
    mutate(fecha = as.Date(fecha)) %>%
    group_by(fecha) %>%
    summarise(unidades = n(), .groups = "drop") %>%
    arrange(fecha)

  if (nrow(df_agg) > 0) {
    month_label <- format(min(df_agg$fecha), "%Y-%m")
    all_months[[month_label]] <- df_agg
    cat("  Sheet", i, ":", month_label, "-", nrow(df_agg), "dias\n")
  }
}

if (length(all_months) < 2) {
  cat("AVISO: Se necesitan al menos 2 meses de datos diarios.\n")
  cat("Solo se encontraron:", length(all_months), "meses.\n")
  quit(status = 0)
}

# ============================================================
# FORECAST MENSUAL TBATS (para desagregar)
# ============================================================
cat("\n[2/4] Obteniendo forecasts mensuales TBATS...\n")

# Intentar cargar df_mensual_agrupado para TBATS
agrupado_file <- file.path(PUBLIC_DIR, "df_mensual_agrupado.csv")
if (file.exists(agrupado_file)) {
  df_agrupado <- read_csv(agrupado_file, show_col_types = FALSE)

  # Detectar nombre de columna Año (puede ser "Año" o "Ano")
  ano_col <- names(df_agrupado)[str_detect(names(df_agrupado), "^A.o$|^Año$")][1]
  if (is.na(ano_col)) ano_col <- names(df_agrupado)[1]

  ts_mensual <- ts(df_agrupado$Turismos,
                   start = c(df_agrupado[[ano_col]][1], df_agrupado$Mes[1]),
                   frequency = 12)
  fit_tbats <- tbats(ts_mensual)
  fc <- forecast(fit_tbats, h = 24)

  # Crear lookup de forecast por YYYY-MM
  fechas_fc <- seq.Date(
    from = as.Date(sprintf("%d-%02d-01",
                           tsp(ts_mensual)[2] %/% 1 + (tsp(ts_mensual)[2] %% 1 > 0.9),
                           round((tsp(ts_mensual)[2] %% 1) * 12) + 1)),
    by = "month", length.out = length(fc$mean)
  )
  # Easier: use fitted + forecast
  all_fitted <- c(as.numeric(fitted(fit_tbats)), as.numeric(fc$mean))
  all_fc_dates <- seq.Date(
    from = as.Date(sprintf("%d-%02d-01", start(ts_mensual)[1], start(ts_mensual)[2])),
    by = "month", length.out = length(all_fitted)
  )
  fc_lookup <- setNames(all_fitted, format(all_fc_dates, "%Y-%m"))
  cat("  TBATS ajustado con", length(ts_mensual), "observaciones\n")
} else {
  cat("  AVISO: No se encontro df_mensual_agrupado.csv, usando total real por mes\n")
  fc_lookup <- NULL
}

# ============================================================
# EJECUTAR MD PARA CADA PAR DE MESES CONSECUTIVOS
# ============================================================
cat("\n[3/4] Ejecutando modelo MD para cada mes...\n")

month_keys <- sort(names(all_months))
results <- list()

for (i in 2:length(month_keys)) {
  ref_key <- month_keys[i - 1]
  obj_key <- month_keys[i]

  df_ref <- preparar_dataset(all_months[[ref_key]])
  df_obj <- preparar_dataset(all_months[[obj_key]])

  # Forecast mensual para el mes objetivo
  if (!is.null(fc_lookup) && obj_key %in% names(fc_lookup)) {
    forecast_mes <- fc_lookup[[obj_key]]
  } else {
    forecast_mes <- sum(df_obj$unidades, na.rm = TRUE)
    cat("  (Usando total real como forecast para", obj_key, ")\n")
  }

  cat("  MD:", ref_key, "->", obj_key, "(forecast:", round(forecast_mes), ")\n")

  # Optimizar w y alpha sobre el mes de referencia
  ajuste <- tryCatch(
    optimizar_w_alpha(df_ref, df_ref),
    error = function(e) list(w_opt = 0.5, alpha_opt = 1, entropia_opt = NA)
  )

  # Predecir mes objetivo con parametros optimizados
  pred_md <- ejecutar_md_mes(df_ref, df_obj, ajuste$alpha_opt, ajuste$w_opt, forecast_mes)

  # Baseline naive (w=1)
  pred_baseline <- ejecutar_md_mes(df_ref, df_obj, ajuste$alpha_opt, 1.0, forecast_mes)

  df_result <- pred_md %>%
    transmute(
      fecha = fecha,
      real = unidades,
      pred_md = round(pred_unidades, 2),
      pred_baseline = round(pred_baseline$pred_unidades, 2),
      dow = dow,
      laborable = laborable,
      w_opt = ajuste$w_opt,
      alpha_opt = ajuste$alpha_opt
    )

  results[[obj_key]] <- df_result
  cat("    w=", round(ajuste$w_opt, 4), " alpha=", round(ajuste$alpha_opt, 4), "\n")
}

# ============================================================
# ESCRIBIR CSV
# ============================================================
cat("\n[4/4] Escribiendo CSV...\n")

df_md_diario <- bind_rows(results) %>% arrange(fecha)

write_csv(df_md_diario, file.path(OUT_DIR, "df_md_diario.csv"))
file.copy(file.path(OUT_DIR, "df_md_diario.csv"),
          file.path(PUBLIC_DIR, "df_md_diario.csv"), overwrite = TRUE)

cat("  df_md_diario.csv:", nrow(df_md_diario), "filas\n")
cat("  Rango:", as.character(min(df_md_diario$fecha)), "a", as.character(max(df_md_diario$fecha)), "\n")

# Metricas globales
lab <- df_md_diario %>% filter(laborable == 1, real > 0)
rmse_md <- sqrt(mean((lab$real - lab$pred_md)^2, na.rm = TRUE))
rmse_bl <- sqrt(mean((lab$real - lab$pred_baseline)^2, na.rm = TRUE))
mape_md <- mean(abs((lab$real - lab$pred_md) / lab$real), na.rm = TRUE) * 100
mape_bl <- mean(abs((lab$real - lab$pred_baseline) / lab$real), na.rm = TRUE) * 100

cat("\n  Metricas (dias laborables):\n")
cat("    MD:       RMSE =", round(rmse_md), " MAPE =", round(mape_md, 2), "%\n")
cat("    Baseline: RMSE =", round(rmse_bl), " MAPE =", round(mape_bl, 2), "%\n")
cat("    Mejora MD vs Baseline:", round((rmse_bl - rmse_md) / rmse_bl * 100, 1), "%\n")

cat("\nExport completado.\n")
