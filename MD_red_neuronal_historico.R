# ============================================================
# COMPARACIÓN HISTÓRICA: MD-shallow vs MD-deep vs Prophet
# ============================================================
# Datos: matriz diaria 2010-2025 (filas = día natural 1..31,
#        columnas = añomes 201001..202512)
#
# Esquema de evaluación:
#   - Test    : últimos 12 meses (2025-01 .. 2025-12)
#   - Para cada mes test:
#       * MD-shallow / MD-deep: calibrados con el mes anterior
#       * Prophet: entrenado con todo el histórico hasta el día
#                  anterior al primer día del mes test
#   - Forecast mensual usado para reescalar pesos -> unidades:
#     TOTAL REAL del propio mes (aísla error de distribución
#     diaria del error mensual)
# ============================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(lubridate)
  library(readr)
  library(ggplot2)
  library(scales)
  library(purrr)
})

# --- Importar SOLO las definiciones (sin ejecutar pipelines) ---
# Lee los scripts y extrae las funciones evaluándolas en el entorno actual.
cargar_funciones <- function(ruta) {
  exprs <- parse(ruta, encoding = "UTF-8")
  for (e in exprs) {
    if (is.call(e) && length(e) >= 3) {
      op <- as.character(e[[1]])
      if (op %in% c("<-", "=") && is.call(e[[3]]) &&
          identical(as.character(e[[3]][[1]]), "function")) {
        eval(e, envir = globalenv())
      }
    }
  }
}

cargar_funciones("MD diario.R")
cargar_funciones("MD_red_neuronal.R")

# Verificar que las funciones clave están disponibles
stopifnot(exists("preparar_dataset"), exists("optimizar_w_alpha"),
          exists("ejecutar_md_mes"), exists("cross_entropy_weights"),
          exists("calcular_beta_dow_excel"), exists("construir_p_m1"),
          exists("calcular_pesos_reales_laborables"),
          exists("construir_features"), exists("forward_deep"),
          exists("coste_md_deep"), exists("optimizar_md_deep"),
          exists("evaluar_modelo_deep"))

# ============================================================
# 1) CARGA DE LA MATRIZ DIARIA HISTÓRICA
# ============================================================

ruta_csv <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Unidades diarias 2010-2026.csv"

# UTF-16 LE con tabs. Primera fila es metadata duplicada -> skip = 1
mat_raw <- read.delim(
  ruta_csv,
  sep          = "\t",
  fileEncoding = "UTF-16LE",
  skip         = 1,
  check.names  = FALSE,
  stringsAsFactors = FALSE
)

# La primera columna se llama "Día de Fecha Pago Contrato"
# (con caracteres potencialmente raros). Renombrar.
names(mat_raw)[1] <- "dia"

# Forzar a numérico
mat_raw$dia <- as.integer(mat_raw$dia)
for (j in 2:ncol(mat_raw)) {
  mat_raw[[j]] <- suppressWarnings(as.numeric(mat_raw[[j]]))
}

cat(sprintf("Matriz leída: %d filas (días), %d columnas (incluye 'dia')\n",
            nrow(mat_raw), ncol(mat_raw)))

# ============================================================
# 2) PIVOTAR A FORMATO LARGO (fecha, unidades)
# ============================================================

df_largo <- mat_raw %>%
  pivot_longer(
    cols      = -dia,
    names_to  = "anomes",
    values_to = "unidades"
  ) %>%
  mutate(
    anomes   = trimws(anomes),
    year     = as.integer(substr(anomes, 1, 4)),
    month    = as.integer(substr(anomes, 5, 6)),
    unidades = ifelse(is.na(unidades), 0, unidades)
  ) %>%
  filter(!is.na(year), !is.na(month), !is.na(dia))

# Construir fecha válida; eliminar combinaciones imposibles (ej. 31-feb)
df_largo <- df_largo %>%
  mutate(
    fecha = suppressWarnings(make_date(year, month, dia))
  ) %>%
  filter(!is.na(fecha)) %>%
  arrange(fecha) %>%
  select(fecha, unidades)

cat(sprintf("Histórico diario: %d filas | %s a %s\n",
            nrow(df_largo),
            format(min(df_largo$fecha)),
            format(max(df_largo$fecha))))

# ============================================================
# 2b) FESTIVOS NACIONALES DE ESPAÑA
# ============================================================
# Festivos de ámbito nacional aplicables a toda España.
# Incluye los 10 fijos + Viernes Santo (calculado con la fórmula
# de Pascua de Gauss/Anonymous Gregorian).

fecha_pascua <- function(year) {
  a <- year %% 19
  b <- year %/% 100
  c <- year %% 100
  d <- b %/% 4
  e <- b %% 4
  f <- (b + 8) %/% 25
  g <- (b - f + 1) %/% 3
  h <- (19 * a + b - d - g + 15) %% 30
  i <- c %/% 4
  k <- c %% 4
  L <- (32 + 2 * e + 2 * i - h - k) %% 7
  m <- (a + 11 * h + 22 * L) %/% 451
  mes <- (h + L - 7 * m + 114) %/% 31
  dia <- ((h + L - 7 * m + 114) %% 31) + 1
  make_date(year, mes, dia)
}

construir_festivos_es <- function(years) {
  festivos <- list()
  for (y in years) {
    pascua <- fecha_pascua(y)
    festivos[[as.character(y)]] <- c(
      make_date(y, 1, 1),    # Año Nuevo
      make_date(y, 1, 6),    # Reyes
      pascua - days(2),      # Viernes Santo
      make_date(y, 5, 1),    # Día del Trabajador
      make_date(y, 8, 15),   # Asunción de la Virgen
      make_date(y, 10, 12),  # Hispanidad
      make_date(y, 11, 1),   # Todos los Santos
      make_date(y, 12, 6),   # Constitución
      make_date(y, 12, 8),   # Inmaculada Concepción
      make_date(y, 12, 25)   # Navidad
    )
  }
  sort(unique(do.call(c, festivos)))
}

festivos_es <- construir_festivos_es(2010:2026)
cat(sprintf("Festivos nacionales construidos: %d fechas (%s a %s)\n",
            length(festivos_es),
            format(min(festivos_es)),
            format(max(festivos_es))))

# ============================================================
# 3) DEFINICIÓN DE MESES TEST
# ============================================================

ultimo_mes <- floor_date(max(df_largo$fecha), "month")
meses_test <- seq.Date(
  from = ultimo_mes %m-% months(11),
  to   = ultimo_mes,
  by   = "month"
)

cat("Meses test (últimos 12):\n")
print(meses_test)

# ============================================================
# 4) PROPHET (predicción diaria por mes test)
# ============================================================

# Entrena Prophet con todo el histórico anterior al mes test
# y predice los días del mes test.
predecir_prophet_mes <- function(df_largo, mes_inicio, festivos = festivos_es) {

  if (!requireNamespace("prophet", quietly = TRUE)) {
    stop("Falta el paquete 'prophet'. Instálalo con install.packages('prophet').")
  }

  df_train <- df_largo %>%
    filter(fecha < mes_inicio) %>%
    transmute(ds = fecha, y = unidades)

  # Festivos como regresor de Prophet (mismo conjunto que MD)
  df_holidays <- data.frame(
    holiday = "festivo_es",
    ds      = festivos,
    lower_window = 0,
    upper_window = 0
  )

  m <- prophet::prophet(
    df_train,
    holidays           = df_holidays,
    daily.seasonality  = FALSE,
    weekly.seasonality = TRUE,
    yearly.seasonality = TRUE,
    changepoint.prior.scale = 0.05
  )

  fin_mes <- ceiling_date(mes_inicio, "month") - days(1)
  fechas_pred <- seq.Date(mes_inicio, fin_mes, by = "day")

  fc <- predict(m, data.frame(ds = fechas_pred))
  tibble(
    fecha = as.Date(fc$ds),
    pred_prophet = pmax(fc$yhat, 0)
  )
}

# ============================================================
# 5) BUCLE PRINCIPAL: PARA CADA MES TEST
# ============================================================

# Vamos a entrenar todos los modelos por mes y guardar:
#   - métricas
#   - predicciones diarias para el gráfico final

resultados_meses <- list()
predicciones_diarias <- list()

H_values <- c(2, 3, 4, 5)

for (mt in seq_along(meses_test)) {

  mes_obj_inicio <- meses_test[mt]
  mes_ref_inicio <- mes_obj_inicio %m-% months(1)

  cat(sprintf("\n---- Mes test %d/%d: %s ----\n", mt, length(meses_test),
              format(mes_obj_inicio, "%Y-%m")))

  # Subconjuntos
  df_ref <- df_largo %>%
    filter(fecha >= mes_ref_inicio,
           fecha <  ceiling_date(mes_ref_inicio, "month")) %>%
    preparar_dataset(festivos = festivos_es)

  df_obj <- df_largo %>%
    filter(fecha >= mes_obj_inicio,
           fecha <  ceiling_date(mes_obj_inicio, "month")) %>%
    preparar_dataset(festivos = festivos_es)

  if (nrow(df_obj) == 0 || nrow(df_ref) == 0) {
    cat("  (sin datos suficientes, omitiendo)\n")
    next
  }

  # Forecast mensual = total real del propio mes
  total_real_mes <- sum(df_obj$unidades, na.rm = TRUE)

  # ----------------------------------------------------------
  # 5.1) MD-SHALLOW
  # ----------------------------------------------------------
  res_shallow <- tryCatch(
    optimizar_w_alpha(df_ref, df_ref, w_ini = 0.5, alpha_ini = 1),
    error = function(e) NULL
  )

  if (is.null(res_shallow)) {
    cat("  MD-shallow falló\n")
    next
  }

  pred_shallow_obj <- ejecutar_md_mes(
    df_mes_ref             = df_ref,
    df_mes_objetivo        = df_obj,
    alpha                  = res_shallow$alpha_opt,
    w                      = res_shallow$w_opt,
    forecast_mensual_tbats = total_real_mes
  )

  lab_idx <- pred_shallow_obj$laborable == 1
  peso_real_v <- pred_shallow_obj$peso_real[lab_idx]
  peso_pred_shallow <- pred_shallow_obj$peso_md[lab_idx]
  unidades_real_v <- pred_shallow_obj$unidades[lab_idx]
  pred_unid_shallow <- pred_shallow_obj$pred_unidades[lab_idx]

  ce_shallow   <- cross_entropy_weights(peso_real_v, peso_pred_shallow)
  rmse_shallow <- sqrt(mean((unidades_real_v - pred_unid_shallow)^2))
  idx_nz <- unidades_real_v > 0
  mape_shallow <- mean(abs((unidades_real_v[idx_nz] - pred_unid_shallow[idx_nz]) /
                             unidades_real_v[idx_nz])) * 100

  # ----------------------------------------------------------
  # 5.2) MD-DEEP (varios H, nos quedamos con el mejor por CE_train)
  # ----------------------------------------------------------
  beta_dow_df <- calcular_beta_dow_excel(df_ref)

  df_train_deep <- construir_p_m1(df_ref, df_ref) %>%
    calcular_pesos_reales_laborables() %>%
    construir_features(beta_dow_df)

  df_test_deep <- construir_p_m1(df_ref, df_obj) %>%
    calcular_pesos_reales_laborables() %>%
    construir_features(beta_dow_df)

  mejor_eval <- NULL
  mejor_H    <- NA
  mejor_ce_train <- Inf

  for (H in H_values) {
    opt_h <- tryCatch(
      optimizar_md_deep(H, df_train_deep, n_restarts = 5, verbose = FALSE),
      error = function(e) NULL
    )
    if (is.null(opt_h)) next

    eval_h <- evaluar_modelo_deep(
      par_opt           = opt_h$par,
      H                 = H,
      df_train          = df_train_deep,
      df_test           = df_test_deep,
      forecast_mensual  = total_real_mes
    )

    if (eval_h$ce_train < mejor_ce_train) {
      mejor_ce_train <- eval_h$ce_train
      mejor_eval <- eval_h
      mejor_H    <- H
    }
  }

  if (is.null(mejor_eval)) {
    cat("  MD-deep falló para todos los H\n")
    next
  }

  # ----------------------------------------------------------
  # 5.3) PROPHET
  # ----------------------------------------------------------
  pred_prophet <- tryCatch(
    predecir_prophet_mes(df_largo, mes_obj_inicio),
    error = function(e) {
      message("  Prophet falló: ", conditionMessage(e))
      NULL
    }
  )

  if (is.null(pred_prophet)) next

  df_prophet_eval <- df_obj %>%
    select(fecha, unidades, laborable) %>%
    left_join(pred_prophet, by = "fecha") %>%
    mutate(
      pred_prophet = ifelse(is.na(pred_prophet), 0, pred_prophet),
      # Forzar a 0 en festivos y fines de semana (igual que MD)
      pred_prophet = ifelse(laborable == 1, pred_prophet, 0)
    )

  # Reescalar Prophet al total real del mes para comparar SOLO la
  # capacidad de reparto diario (mismo trato que MD)
  suma_prophet <- sum(df_prophet_eval$pred_prophet, na.rm = TRUE)
  if (suma_prophet > 0) {
    df_prophet_eval <- df_prophet_eval %>%
      mutate(pred_prophet_resc = pred_prophet / suma_prophet * total_real_mes)
  } else {
    df_prophet_eval$pred_prophet_resc <- 0
  }

  # Métricas Prophet sobre laborables (mismo dominio que MD)
  prophet_lab <- df_prophet_eval %>% filter(laborable == 1)
  pesos_real_p <- prophet_lab$unidades / sum(prophet_lab$unidades)
  pesos_pred_p <- prophet_lab$pred_prophet_resc / sum(prophet_lab$pred_prophet_resc)

  ce_prophet   <- cross_entropy_weights(pesos_real_p, pesos_pred_p)
  rmse_prophet <- sqrt(mean((prophet_lab$unidades - prophet_lab$pred_prophet_resc)^2))
  idx_nz_p <- prophet_lab$unidades > 0
  mape_prophet <- mean(abs((prophet_lab$unidades[idx_nz_p] -
                              prophet_lab$pred_prophet_resc[idx_nz_p]) /
                             prophet_lab$unidades[idx_nz_p])) * 100

  # ----------------------------------------------------------
  # 5.4) GUARDAR RESULTADOS DEL MES
  # ----------------------------------------------------------
  resultados_meses[[mt]] <- tibble(
    mes        = mes_obj_inicio,
    H_mejor    = mejor_H,
    CE_shallow = ce_shallow,
    CE_deep    = mejor_eval$ce_test,
    CE_prophet = ce_prophet,
    RMSE_shallow = rmse_shallow,
    RMSE_deep    = mejor_eval$rmse_test,
    RMSE_prophet = rmse_prophet,
    MAPE_shallow = mape_shallow,
    MAPE_deep    = mejor_eval$mape_test,
    MAPE_prophet = mape_prophet
  )

  # Predicciones diarias para gráfico (sobre todos los días, no
  # solo laborables — los no laborables tienen pred MD = 0)
  fechas_obj <- df_obj$fecha

  pred_shallow_dia <- pred_shallow_obj %>% select(fecha, pred_unidades)
  names(pred_shallow_dia)[2] <- "MD_shallow"

  # Reconstruir vector deep alineado a todos los días
  pred_deep_full <- rep(0, nrow(df_obj))
  pred_deep_full[df_obj$laborable == 1] <- mejor_eval$pred_unidades

  predicciones_diarias[[mt]] <- tibble(
    fecha       = df_obj$fecha,
    Real        = df_obj$unidades,
    MD_shallow  = pred_shallow_dia$MD_shallow,
    MD_deep     = pred_deep_full,
    Prophet     = df_prophet_eval$pred_prophet_resc
  )

  cat(sprintf("  shallow: CE=%.4f RMSE=%.1f MAPE=%.2f%%\n",
              ce_shallow, rmse_shallow, mape_shallow))
  cat(sprintf("  deep H=%d: CE=%.4f RMSE=%.1f MAPE=%.2f%%\n",
              mejor_H, mejor_eval$ce_test, mejor_eval$rmse_test, mejor_eval$mape_test))
  cat(sprintf("  prophet:  CE=%.4f RMSE=%.1f MAPE=%.2f%%\n",
              ce_prophet, rmse_prophet, mape_prophet))
}

# ============================================================
# 6) TABLA DE RESULTADOS POR MES
# ============================================================

tabla_meses <- bind_rows(resultados_meses)

cat("\n============================================================\n")
cat("RESULTADOS POR MES\n")
cat("============================================================\n")
print(tabla_meses, n = Inf, width = Inf)

# ============================================================
# 7) RESUMEN AGREGADO (medias)
# ============================================================

resumen <- tibble(
  Modelo  = c("MD-shallow", "MD-deep", "Prophet"),
  CE_med  = c(mean(tabla_meses$CE_shallow),
              mean(tabla_meses$CE_deep),
              mean(tabla_meses$CE_prophet)),
  RMSE_med = c(mean(tabla_meses$RMSE_shallow),
               mean(tabla_meses$RMSE_deep),
               mean(tabla_meses$RMSE_prophet)),
  MAPE_med = c(mean(tabla_meses$MAPE_shallow),
               mean(tabla_meses$MAPE_deep),
               mean(tabla_meses$MAPE_prophet))
)

cat("\n============================================================\n")
cat("RESUMEN GLOBAL (media sobre los 12 meses test)\n")
cat("============================================================\n")
print(resumen)

# Identificar mejor modelo por cada criterio
cat("\nMejor modelo por criterio:\n")
cat(sprintf("  CE   : %s\n", resumen$Modelo[which.min(resumen$CE_med)]))
cat(sprintf("  RMSE : %s\n", resumen$Modelo[which.min(resumen$RMSE_med)]))
cat(sprintf("  MAPE : %s\n", resumen$Modelo[which.min(resumen$MAPE_med)]))

# ============================================================
# 8) GRÁFICO 1: SERIES DIARIAS REALES vs 3 MODELOS
# ============================================================

df_pred_all <- bind_rows(predicciones_diarias)

df_pred_long <- df_pred_all %>%
  pivot_longer(
    cols      = c(Real, MD_shallow, MD_deep, Prophet),
    names_to  = "Modelo",
    values_to = "Matriculaciones"
  ) %>%
  mutate(
    Modelo = factor(Modelo, levels = c("Real", "MD_shallow", "MD_deep", "Prophet"),
                    labels = c("Real", "MD-shallow", "MD-deep", "Prophet"))
  )

colores <- c("Real" = "black",
             "MD-shallow" = "#2196F3",
             "MD-deep"    = "#E91E63",
             "Prophet"    = "#4CAF50")

g1 <- ggplot(df_pred_long, aes(x = fecha, y = Matriculaciones, color = Modelo)) +
  geom_line(linewidth = 0.6, alpha = 0.9) +
  scale_color_manual(values = colores) +
  scale_y_continuous(labels = comma) +
  labs(
    title    = "Comparación diaria: Real vs MD-shallow vs MD-deep vs Prophet",
    subtitle = "Últimos 12 meses (predicciones reescaladas al total real del mes)",
    x        = "Fecha",
    y        = "Matriculaciones",
    color    = "Modelo"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "bottom")

print(g1)

# ============================================================
# 9) GRÁFICO 2: BARRAS DE ERROR MEDIO POR MODELO
# ============================================================

resumen_long <- resumen %>%
  pivot_longer(cols = -Modelo, names_to = "Metrica", values_to = "Valor")

g2 <- ggplot(resumen_long, aes(x = Modelo, y = Valor, fill = Modelo)) +
  geom_col(width = 0.6) +
  geom_text(aes(label = sprintf("%.3f", Valor)), vjust = -0.3, size = 3.5) +
  facet_wrap(~ Metrica, scales = "free_y") +
  scale_fill_manual(values = c("MD-shallow" = "#2196F3",
                               "MD-deep"    = "#E91E63",
                               "Prophet"    = "#4CAF50")) +
  labs(
    title = "Error medio por modelo (12 meses test)",
    x = NULL, y = NULL
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "none",
        axis.text.x = element_text(angle = 20, hjust = 1))

print(g2)

# ============================================================
# 10) GRÁFICO 3: EVOLUCIÓN MENSUAL DEL CE
# ============================================================

tabla_long_ce <- tabla_meses %>%
  select(mes, CE_shallow, CE_deep, CE_prophet) %>%
  pivot_longer(-mes, names_to = "Modelo", values_to = "CE") %>%
  mutate(Modelo = recode(Modelo,
                         CE_shallow = "MD-shallow",
                         CE_deep    = "MD-deep",
                         CE_prophet = "Prophet"))

g3 <- ggplot(tabla_long_ce, aes(x = mes, y = CE, color = Modelo)) +
  geom_line(linewidth = 1) +
  geom_point(size = 2.5) +
  scale_color_manual(values = c("MD-shallow" = "#2196F3",
                                "MD-deep"    = "#E91E63",
                                "Prophet"    = "#4CAF50")) +
  scale_x_date(date_breaks = "1 month", date_labels = "%Y-%m") +
  labs(
    title = "Entropía cruzada por mes test",
    x = "Mes objetivo", y = "CE (sobre laborables)"
  ) +
  theme_minimal(base_size = 12) +
  theme(legend.position = "bottom",
        axis.text.x = element_text(angle = 45, hjust = 1))

print(g3)

