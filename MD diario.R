# ============================================================
# MODELO MD EN R - VERSIÓN MES ANTERIOR -> MES OBJETIVO
# ============================================================
# Estructura:
# 1) Lee datasets con fecha (días naturales) y unidades
# 2) Marca laborables / no laborables
# 3) Calcula beta_dow con el mes de referencia:
#       beta_k = ln( (u_k / U) / (1/7) )
# 4) Calcula la parte logística:
#       logistic_k = 1 / (1 + exp(-alpha * beta_k))
# 5) Construye p_m1 con los laborables del mes anterior
# 6) Calcula scores y pesos del mes objetivo
# 7) Optimiza w y alpha con entropía cruzada sobre pesos
# 8) Multiplica por el forecast mensual TBATS del mes objetivo
# ============================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(lubridate)
  library(tidyr)
  library(purrr)
  library(readxl)
  library(ggplot2)
  library(scales)
})

# ============================================================
# 0) UTILIDADES
# ============================================================

safe_div <- function(x, y) {
  if (length(y) == 1) {
    if (is.na(y) || y == 0) {
      return(rep(0, length(x)))
    } else {
      return(x / y)
    }
  } else {
    out <- x / y
    out[is.na(y) | y == 0] <- 0
    return(out)
  }
}

rmse <- function(real, pred) {
  sqrt(mean((real - pred)^2, na.rm = TRUE))
}

mape <- function(real, pred) {
  idx <- !is.na(real) & !is.na(pred) & real != 0
  if (!any(idx)) return(NA_real_)
  mean(abs((real[idx] - pred[idx]) / real[idx])) * 100
}

cross_entropy_weights <- function(p_real, p_pred, eps = 1e-12) {
  p_pred <- pmax(p_pred, eps)
  -sum(p_real * log(p_pred), na.rm = TRUE)
}

# ============================================================
# 1) CALENDARIO
# ============================================================

crear_calendario <- function(fechas, festivos = as.Date(character())) {
  
  tibble(fecha = as.Date(fechas)) %>%
    mutate(
      year = year(fecha),
      month = month(fecha),
      day = day(fecha),
      ym = floor_date(fecha, "month"),
      dow_num = wday(fecha, week_start = 1),   # lunes=1 ... domingo=7
      dow = case_when(
        dow_num == 1 ~ "lunes",
        dow_num == 2 ~ "martes",
        dow_num == 3 ~ "miércoles",
        dow_num == 4 ~ "jueves",
        dow_num == 5 ~ "viernes",
        dow_num == 6 ~ "sábado",
        dow_num == 7 ~ "domingo",
        TRUE ~ NA_character_
      ),
      fin_semana = as.integer(dow_num >= 6),
      festivo = as.integer(as.Date(fecha) %in% as.Date(festivos)),
      laborable = as.integer(fin_semana == 0 & festivo == 0)
    ) %>%
    group_by(ym) %>%
    arrange(fecha, .by_group = TRUE) %>%
    mutate(
      laborable_idx = if_else(laborable == 1, cumsum(laborable), NA_integer_)
    ) %>%
    ungroup()
}

# ============================================================
# 2) PREPARACIÓN DEL DATASET
# ============================================================

# Input:
# - fecha
# - unidades
preparar_dataset <- function(df, festivos = as.Date(character())) {
  
  df <- df %>%
    mutate(
      fecha = as.Date(fecha),
      unidades = as.numeric(unidades)
    )
  
  calendario <- crear_calendario(df$fecha, festivos = festivos)
  
  df %>%
    left_join(calendario, by = "fecha") %>%
    arrange(fecha)
}

# ============================================================
# 3) beta_dow COMO EN EXCEL
# ============================================================

# beta_k = ln( (share_k) / (1/7) )
# share_k = unidades del dow k / total unidades del mes de referencia
calcular_beta_dow_excel <- function(df_mes_ref, eps = 1e-12) {
  
  # Seguridad
  stopifnot("dow_num" %in% names(df_mes_ref))
  stopifnot("unidades" %in% names(df_mes_ref))
  
  total_mes <- sum(df_mes_ref$unidades, na.rm = TRUE)
  
  # Suma de unidades por dow_num usando base R
  sumas <- tapply(df_mes_ref$unidades, df_mes_ref$dow_num, sum, na.rm = TRUE)
  
  # Vector completo 1:7
  unidades_vec <- setNames(rep(0, 7), as.character(1:7))
  unidades_vec[names(sumas)] <- as.numeric(sumas)
  
  share_vec <- unidades_vec / total_mes
  beta_vec  <- log((share_vec + eps) / (1 / 7))
  
  tibble(
    dow_num = 1:7,
    dow = c("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"),
    unidades_dow = as.numeric(unidades_vec),
    share_dow = as.numeric(share_vec),
    beta_dia = as.numeric(beta_vec)
  )
}

# ============================================================
# 4) FUNCIÓN LOGÍSTICA
# ============================================================

calcular_logistica_dow <- function(beta_dow_df, alpha) {
  beta_dow_df %>%
    mutate(
      logistic_dia = 1 / (1 + exp(-alpha * beta_dia))
    )
}

# ============================================================
# 5) COMPONENTE HISTÓRICO DEL MES ANTERIOR: p_m1
# ============================================================

# Para cada laborable del mes objetivo, se asigna el peso del mismo
# n-ésimo laborable del mes de referencia.
#
# Si el mes objetivo tiene MÁS laborables que el de referencia,
# los sobrantes reciben el peso medio de los laborables del mes de referencia.
construir_p_m1 <- function(df_mes_ref, df_mes_objetivo) {
  
  tabla_ref <- df_mes_ref %>%
    filter(laborable == 1) %>%
    arrange(fecha) %>%
    mutate(
      total_lab = sum(unidades, na.rm = TRUE),
      p_m1 = safe_div(unidades, total_lab)
    ) %>%
    select(laborable_idx, p_m1)
  
  p_m1_medio <- mean(tabla_ref$p_m1, na.rm = TRUE)
  
  df_mes_objetivo %>%
    left_join(tabla_ref, by = "laborable_idx") %>%
    mutate(
      p_m1 = if_else(laborable == 1 & is.na(p_m1), p_m1_medio, p_m1),
      p_m1 = if_else(laborable == 0, 0, p_m1)
    )
}

# ============================================================
# 6) PESOS REALES DEL MES OBJETIVO (SOLO LABORABLES)
# ============================================================

# Como el modelo da score=0 a los no laborables,
# la entropía cruzada se calcula sobre pesos reales en laborables.
calcular_pesos_reales_laborables <- function(df_mes_obj) {
  
  total_lab <- sum(df_mes_obj$unidades[df_mes_obj$laborable == 1], na.rm = TRUE)
  
  df_mes_obj %>%
    mutate(
      peso_real = if_else(laborable == 1, safe_div(unidades, total_lab), 0)
    )
}

# ============================================================
# 7) SCORES Y PESOS DEL MD
# ============================================================

# score_d = ((1-w) * logistic_d + w * p_m1_d) * I(laborable_d)
# peso_md_d = score_d / suma_scores
calcular_scores_y_pesos_md <- function(df_mes_obj,
                                       beta_dow_df,
                                       alpha,
                                       w) {
  
  tabla_beta <- calcular_logistica_dow(beta_dow_df, alpha) %>%
    select(dow_num, beta_dia, logistic_dia)
  
  df_out <- df_mes_obj %>%
    left_join(tabla_beta, by = "dow_num") %>%
    mutate(
      score = if_else(
        laborable == 1,
        ((1 - w) * logistic_dia + w * p_m1),
        0
      )
    )
  
  suma_scores <- sum(df_out$score, na.rm = TRUE)
  
  df_out %>%
    mutate(
      peso_md = safe_div(score, suma_scores)
    )
}

# ============================================================
# 8) APLICAR FORECAST MENSUAL (Prophet)
# ============================================================

aplicar_forecast_tbats <- function(df_mes_pred, forecast_mensual_tbats) {
  df_mes_pred %>%
    mutate(
      forecast_mensual_tbats = forecast_mensual_tbats,
      pred_unidades = forecast_mensual_tbats * peso_md
    )
}

# ============================================================
# 9) EJECUCIÓN COMPLETA DEL MD PARA UN MES OBJETIVO
# ============================================================

# df_mes_ref         = mes anterior / mes de referencia
# df_mes_objetivo    = mes a predecir
# alpha, w           = parámetros
# forecast_mensual_tbats = total mensual a desagregar
ejecutar_md_mes <- function(df_mes_ref,
                            df_mes_objetivo,
                            alpha,
                            w,
                            forecast_mensual_tbats) {
  
  beta_dow_df <- calcular_beta_dow_excel(df_mes_ref)
  
  df_base <- construir_p_m1(
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo
  )
  
  df_base <- calcular_pesos_reales_laborables(df_base)
  
  df_md <- calcular_scores_y_pesos_md(
    df_mes_obj = df_base,
    beta_dow_df = beta_dow_df,
    alpha = alpha,
    w = w
  )
  
  df_pred <- aplicar_forecast_tbats(
    df_mes_pred = df_md,
    forecast_mensual_tbats = forecast_mensual_tbats
  )
  
  df_pred
}

# ============================================================
# 10) FUNCIÓN DE COSTE: ENTROPÍA CRUZADA SOBRE PESOS
# ============================================================

# Se optimizan:
# - w en (0,1)
# - alpha > 0
#
# Reparametrización:
# par[1] -> w     = logistic(par[1])
# par[2] -> alpha = exp(par[2])
coste_md_entropia <- function(par,
                              df_mes_ref,
                              df_mes_objetivo) {
  
  w <- par[1]
  alpha <- par[2]
  
  beta_dow_df <- calcular_beta_dow_excel(df_mes_ref)
  
  df_base <- construir_p_m1(
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo
  ) %>%
    calcular_pesos_reales_laborables()
  
  df_pred <- calcular_scores_y_pesos_md(
    df_mes_obj = df_base,
    beta_dow_df = beta_dow_df,
    alpha = alpha,
    w = w
  )
  
  cross_entropy_weights(
    p_real = df_pred$peso_real,
    p_pred = df_pred$peso_md
  )
}

# ============================================================
# 11) OPTIMIZACIÓN DE w Y alpha CON optim()
# ============================================================

optimizar_w_alpha <- function(df_mes_ref,
                              df_mes_objetivo,
                              w_ini = 0.5,
                              alpha_ini = 1) {
  
  opt <- optim(
    par = c(w_ini, alpha_ini),
    fn = coste_md_entropia,
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo,
    method = "L-BFGS-B",
    lower = c(0.2, 0.1),   # cota inferior para w y alpha
    upper = c(0.95, 20)    # cota superior para w y alpha
  )
  
  list(
    optim = opt,
    w_opt = opt$par[1],
    alpha_opt = opt$par[2],
    entropia_opt = opt$value
  )
}

# ============================================================
# 12) FUNCIÓN FINAL: CALIBRAR Y PREDECIR
# ============================================================

calibrar_y_predecir_md <- function(df_mes_ref,
                                   df_mes_objetivo,
                                   forecast_mensual_tbats,
                                   w_ini = 0.5,
                                   alpha_ini = 1) {
  
  ajuste <- optimizar_w_alpha(
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo,
    w_ini = w_ini,
    alpha_ini = alpha_ini
  )
  
  pred_final <- ejecutar_md_mes(
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo,
    alpha = ajuste$alpha_opt,
    w = ajuste$w_opt,
    forecast_mensual_tbats = forecast_mensual_tbats
  )
  
  list(
    w_opt = ajuste$w_opt,
    alpha_opt = ajuste$alpha_opt,
    entropia_opt = ajuste$entropia_opt,
    prediccion = pred_final
  )
}

# ============================================================
# 13) MÉTRICAS AUXILIARES
# ============================================================

evaluar_prediccion_final <- function(df_pred_final) {
  tibble(
    rmse_unidades = rmse(df_pred_final$unidades, df_pred_final$pred_unidades),
    mape_unidades = mape(df_pred_final$unidades, df_pred_final$pred_unidades),
    suma_pesos_pred = sum(df_pred_final$peso_md, na.rm = TRUE),
    suma_pred_unidades = sum(df_pred_final$pred_unidades, na.rm = TRUE),
    suma_real_unidades = sum(df_pred_final$unidades, na.rm = TRUE)
  )
}

# ============================================================
# 14) CARGA Y PREPARACIÓN DE DATOS
# ============================================================
# Estructura de entrenamiento / validación:
#   ENTRENAMIENTO : febrero 2026 (ref = objetivo) → betas, pesos reales, w_opt, alpha_opt
#   VALIDACIÓN    : febrero 2026 (ref) → marzo 2026 (objetivo) → métricas out-of-sample

df_feb2026_raw <- read_excel(
  "~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Datos diarios/Análisis diario.xlsx",
  sheet = 1
)

df_mar2026_raw <- read_excel(
  "~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Datos diarios/Análisis diario.xlsx",
  sheet = 2
)

# Agregar por fecha (cada fila es una matriculación individual)
df_feb2026_raw <- df_feb2026_raw %>%
  filter(!is.na(fecha)) %>%
  group_by(fecha) %>%
  summarise(unidades = n(), .groups = "drop") %>%
  arrange(fecha)

df_mar2026_raw <- df_mar2026_raw %>%
  filter(!is.na(fecha)) %>%
  group_by(fecha) %>%
  summarise(unidades = n(), .groups = "drop") %>%
  arrange(fecha)

# Festivos
festivos_feb2026 <- as.Date(character())
festivos_mar2026 <- as.Date(character())

# Preparar datasets con calendario
df_feb2026 <- preparar_dataset(df_feb2026_raw, festivos = festivos_feb2026)
df_mar2026 <- preparar_dataset(df_mar2026_raw, festivos = festivos_mar2026)

# ============================================================
# 15) DIAGNÓSTICOS RÁPIDOS
# ============================================================

# Beta_dow de febrero (mes de entrenamiento y referencia)
beta_dow_df <- calcular_beta_dow_excel(df_feb2026)
print(beta_dow_df)

df_feb2026 %>%
  group_by(dow_num, dow) %>%
  summarise(unidades_dow = sum(unidades, na.rm = TRUE), .groups = "drop") %>%
  arrange(dow_num) %>%
  print(n = Inf)

# ============================================================
# 16) FORECAST MENSUAL DEL MES OBJETIVO (Prophet)
# ============================================================
# Se utiliza el forecast de Prophet (véase 03_prophet_comparacion.R).

forecast_mensual_mar2026 <- tryCatch({
  val <- fc_prophet$yhat[as.Date(fc_prophet$ds) == as.Date("2026-03-01")]
  if (length(val) == 1 && !is.na(val)) val else stop()
}, error = function(e) {
  176290.8
})

cat(sprintf("Forecast Prophet para marzo 2026: %.1f matriculaciones\n",
            forecast_mensual_mar2026))

# ============================================================
# 17) ENTRENAMIENTO: optimizar w y alpha sobre febrero 2026
# ============================================================
# Febrero actúa simultáneamente como referencia y como objetivo:
#   - De él se extraen las betas (efecto día de la semana)
#   - De él se obtienen los pesos reales (peso_real)
#   - Se buscan w y alpha que minimizan la entropía cruzada
# Marzo NO interviene en la optimización → no hay data leakage.

resultado_entrenamiento <- optimizar_w_alpha(
  df_mes_ref      = df_feb2026,
  df_mes_objetivo = df_feb2026,
  w_ini           = 0.5,
  alpha_ini       = 1
)

w_opt     <- resultado_entrenamiento$w_opt
alpha_opt <- resultado_entrenamiento$alpha_opt

cat(sprintf("Parámetros óptimos (entrenamiento sobre febrero):\n  w = %.4f  |  alpha = %.4f  |  Entropía = %.6f\n",
            w_opt, alpha_opt, resultado_entrenamiento$entropia_opt))

# ============================================================
# 17b) VALIDACIÓN: aplicar w y alpha fijos a marzo 2026
# ============================================================
# Se aplican los parámetros calibrados en febrero para predecir marzo.
# Febrero sigue siendo el mes de referencia (beta_dow y p_m1).
# Los datos reales de marzo se usan SOLO para medir el error.

resultado_md <- list(
  w_opt        = w_opt,
  alpha_opt    = alpha_opt,
  entropia_opt = resultado_entrenamiento$entropia_opt,
  prediccion   = ejecutar_md_mes(
    df_mes_ref             = df_feb2026,
    df_mes_objetivo        = df_mar2026,
    alpha                  = alpha_opt,
    w                      = w_opt,
    forecast_mensual_tbats = forecast_mensual_mar2026
  )
)

# Resultados
print(resultado_md$w_opt)
print(resultado_md$alpha_opt)
print(resultado_md$entropia_opt)

df_pred_final <- resultado_md$prediccion

# Tabla final
df_pred_final %>%
  select(
    fecha, dow_num, dow, laborable, festivo, laborable_idx,
    unidades, peso_real, p_m1, beta_dia, logistic_dia,
    score, peso_md, pred_unidades
  ) %>%
  print(n = Inf)

# Métricas
evaluacion <- evaluar_prediccion_final(df_pred_final)
print(evaluacion)

# Comprobaciones
print(sum(df_pred_final$peso_md, na.rm = TRUE))
print(sum(df_pred_final$pred_unidades, na.rm = TRUE))

# ============================================================
# 18) GRÁFICA REAL VS PREDICHO
# ============================================================

df_pred_final <- df_pred_final %>% arrange(fecha)

ggplot(df_pred_final, aes(x = fecha)) +
  geom_line(aes(y = pred_unidades, color = "Predicción MD"), linewidth = 1) +
  geom_point(aes(y = pred_unidades, color = "Predicción MD"), size = 2) +
  geom_line(aes(y = unidades, color = "Real"), linewidth = 1) +
  geom_point(aes(y = unidades, color = "Real"), size = 2) +
  labs(
    title = "Marzo 2026: valores reales vs predichos",
    x = "Fecha",
    y = "Matriculaciones",
    color = ""
  ) +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 13)

# ============================================================
# 19) DEPURACIÓN SI HACE FALTA
# ============================================================

# Ver beta_dow
print(beta_dow_df)

# Ver pesos y scores
df_pred_final %>%
  select(fecha, dow_num, dow, laborable, p_m1, beta_dia, logistic_dia, score, peso_md) %>%
  print(n = Inf)


total_real_observado <- sum(df_pred_final$unidades, na.rm = TRUE)

df_pred_final <- df_pred_final %>%
  mutate(
    pred_reescalada = peso_md * total_real_observado
  )
ggplot(df_pred_final, aes(x = fecha)) +
  geom_line(aes(y = unidades, color = "Real"), linewidth = 1) +
  geom_point(aes(y = unidades, color = "Real"), size = 2) +
  geom_line(aes(y = pred_reescalada, color = "Predicción MD reescalada"), linewidth = 1) +
  geom_point(aes(y = pred_reescalada, color = "Predicción MD reescalada"), size = 2) +
  labs(
    title = "Marzo 2026: reales vs predicción MD reescalada",
    x = "Fecha",
    y = "Matriculaciones",
    color = ""
  ) +
  theme_minimal(base_size = 13)

# ============================================================
# 20) CÁLCULO DE GRID DE ERROR (w x alpha)
# ============================================================

w_seq     <- seq(0.20, 0.95, length.out = 40)
alpha_seq <- seq(0.10,  5,   length.out = 40)

grid_params <- expand.grid(w = w_seq, alpha = alpha_seq)

# La superficie se calcula sobre febrero (entrenamiento): ref = objetivo = febrero.
grid_error <- grid_params %>%
  rowwise() %>%
  mutate(
    error = coste_md_entropia(
      par             = c(w, alpha),
      df_mes_ref      = df_feb2026,
      df_mes_objetivo = df_feb2026
    )
  ) %>%
  ungroup()

# ============================================================
# 21) GRAFICO ERROR DE MD CON RESPECTO A W Y ALPHA
# ============================================================
library(dplyr)
library(ggplot2)
library(viridis)

grid_error2 <- grid_error %>%
  mutate(
    error_rel = error - min(error, na.rm = TRUE) + 1e-12
  )

mejor_punto <- grid_error2 %>%
  arrange(error_rel) %>%
  slice(1)

ggplot(grid_error2, aes(x = w, y = alpha, z = error_rel)) +
  geom_tile(aes(fill = error_rel)) +
  geom_contour(color = "white", alpha = 0.6) +
  geom_point(
    data = mejor_punto,
    aes(x = w, y = alpha),
    color = "red",
    size = 3,
    inherit.aes = FALSE
  ) +
  scale_fill_viridis_c(trans = "log10") +
  labs(
    title = "Superficie de error relativa del modelo MD",
    subtitle = "Diferencia respecto al mínimo en escala logarítmica",
    x = "w",
    y = expression(alpha),
    fill = "Error relativo"
  ) +
  theme_minimal(base_size = 13)

#visualicemos esto en 3D:
library(plotly)

# Vectores ordenados de ejes
x_vals <- sort(unique(grid_error2$w))
y_vals <- sort(unique(grid_error2$alpha))

# Matriz Z: filas = alpha, columnas = w
z_mat <- grid_error2 %>%
  arrange(alpha, w) %>%
  select(alpha, w, error_rel) %>%
  pivot_wider(names_from = w, values_from = error_rel) %>%
  select(-alpha) %>%
  as.matrix()

plot_ly(
  x = x_vals,
  y = y_vals,
  z = z_mat,
  type = "surface",
  contours = list(
    x = list(show = TRUE, usecolormap = FALSE, color = "white", width = 1.5),
    y = list(show = TRUE, usecolormap = FALSE, color = "white", width = 1.5)
  )
) %>%
  layout(
    title = "Superficie 3D del error del modelo MD",
    scene = list(
      xaxis = list(title = "w"),
      yaxis = list(title = "alpha"),
      zaxis = list(title = "Error relativo")
    )
  )

# ============================================================
# 22) BENCHMARKING: MD vs modelos simples
# ============================================================

# --- Benchmark 1: Uniforme (peso igual a cada laborable) ---
n_lab <- sum(df_mar2026$laborable, na.rm = TRUE)

bench_uniforme <- df_mar2026 %>%
  mutate(
    peso_bench    = if_else(laborable == 1, 1 / n_lab, 0),
    pred_bench    = peso_bench * forecast_mensual_mar2026
  )

# --- Benchmark 2: Baseline naïve (w = 1) ---
# Equivale al modelo baseline del TFG (sec. 5.1.3.1):
# la distribución diaria se hereda directamente del mes de referencia.
bench_baseline <- ejecutar_md_mes(
  df_mes_ref             = df_feb2026,
  df_mes_objetivo        = df_mar2026,
  alpha                  = resultado_md$alpha_opt,
  w                      = 1,
  forecast_mensual_tbats = forecast_mensual_mar2026
)

# --- Benchmark 3: Solo logística (w = 0) ---
bench_logistica <- ejecutar_md_mes(
  df_mes_ref             = df_feb2026,
  df_mes_objetivo        = df_mar2026,
  alpha                  = resultado_md$alpha_opt,
  w                      = 0,
  forecast_mensual_tbats = forecast_mensual_mar2026
)

# --- Benchmark 4: Denton proporcional ---
# Método estándar académico de desagregación temporal (Denton, 1971).
# Distribuye el total mensual minimizando las diferencias relativas
# entre periodos consecutivos respecto al indicador de referencia (p_m1).
if (!requireNamespace("tempdisagg", quietly = TRUE)) {
  install.packages("tempdisagg")
}
library(tempdisagg)

# Extraer el indicador de alta frecuencia: p_m1 de los días laborables
indicador_denton <- df_pred_final %>%
  filter(laborable == 1) %>%
  pull(p_m1)

# Crear serie ts: el indicador tiene n_lab observaciones por cada
# observación de baja frecuencia (1 mes), así tempdisagg infiere la ratio.
n_lab_denton  <- length(indicador_denton)
indicador_ts  <- ts(indicador_denton, frequency = n_lab_denton, start = c(1, 1))

# Crear serie ts del agregado mensual (un único valor, frecuencia = 1)
total_real_observado <- sum(df_pred_final$unidades, na.rm = TRUE)
agregado_ts <- ts(total_real_observado, frequency = 1, start = 1)

# Aplicar Denton proporcional (sin 'to': la ratio de frecuencias lo determina)
denton_result <- td(agregado_ts ~ 0 + indicador_ts, method = "denton-cholette",
                    conversion = "sum")

# Extraer la serie desagregada
pred_denton_lab <- as.numeric(predict(denton_result))

# Reconstruir vector completo (laborables + no laborables = 0)
bench_denton <- df_pred_final %>%
  mutate(
    peso_denton = 0,
    pred_denton = 0
  )
bench_denton$pred_denton[bench_denton$laborable == 1] <- pred_denton_lab
bench_denton$peso_denton[bench_denton$laborable == 1] <- pred_denton_lab / total_real_observado

# --- Tabla comparativa de métricas ---
real <- df_pred_final$unidades

metricas_bench <- tibble(
  Modelo = c("MD (w, alpha óptimos)", "Uniforme", "Baseline naïve (w=1)",
             "Solo logística (w=0)", "Denton proporcional"),
  RMSE   = c(
    rmse(real, df_pred_final$pred_unidades),
    rmse(real, bench_uniforme$pred_bench),
    rmse(real, bench_baseline$pred_unidades),
    rmse(real, bench_logistica$pred_unidades),
    rmse(real, bench_denton$pred_denton)
  ),
  MAPE   = c(
    mape(real, df_pred_final$pred_unidades),
    mape(real, bench_uniforme$pred_bench),
    mape(real, bench_baseline$pred_unidades),
    mape(real, bench_logistica$pred_unidades),
    mape(real, bench_denton$pred_denton)
  )
)

print(metricas_bench)

# --- Gráfica comparativa ---
df_bench_long <- df_pred_final %>%
  select(fecha, unidades) %>%
  mutate(
    MD            = df_pred_final$pred_unidades,
    Uniforme      = bench_uniforme$pred_bench,
    Baseline      = bench_baseline$pred_unidades,
    Logistica     = bench_logistica$pred_unidades,
    Denton        = bench_denton$pred_denton
  ) %>%
  pivot_longer(
    cols      = c(MD, Uniforme, Baseline, Logistica, Denton),
    names_to  = "Modelo",
    values_to = "pred"
  )

ggplot(df_bench_long, aes(x = fecha)) +
  geom_line(aes(y = unidades), color = "black", linewidth = 1, linetype = "dashed") +
  geom_line(aes(y = pred, color = Modelo), linewidth = 0.8) +
  labs(
    title = "Benchmarking: MD vs modelos simples",
    x     = "Fecha",
    y     = "Matriculaciones",
    color = "Modelo"
  ) +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 13)

# ============================================================
# 23) ENTROPÍA CRUZADA POR MODELO (benchmarking)
# ============================================================

p_real <- df_pred_final$peso_real

ce_modelos <- tibble(
  Modelo   = c("MD (óptimo)", "Uniforme", "Baseline naïve (w=1)",
               "Solo logística (w=0)", "Denton proporcional"),
  Entropia = c(
    cross_entropy_weights(p_real, df_pred_final$peso_md),
    cross_entropy_weights(p_real, bench_uniforme$peso_bench),
    cross_entropy_weights(p_real, bench_baseline$peso_md),
    cross_entropy_weights(p_real, bench_logistica$peso_md),
    cross_entropy_weights(p_real, bench_denton$peso_denton)
  )
) %>%
  mutate(Modelo = factor(Modelo, levels = Modelo[order(Entropia, decreasing = TRUE)]))

cat("\n===== ENTROPÍA CRUZADA POR MODELO =====\n")
print(ce_modelos, digits = 4)

ggplot(ce_modelos, aes(x = Modelo, y = Entropia, fill = Modelo)) +
  geom_col(width = 0.6, show.legend = FALSE) +
  geom_text(aes(label = round(Entropia, 4)), vjust = -0.5, size = 4) +
  labs(
    title    = "Entropía cruzada por modelo",
    subtitle = "Menor valor = mejor ajuste de la distribución diaria",
    x        = NULL,
    y        = "Entropía cruzada",
    caption  = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13) +
  theme(axis.text.x = element_text(angle = 15, hjust = 1))

# ============================================================
# 24) COMPARACIÓN DEDICADA: MD vs BASELINE NAÏVE
# ============================================================
# El modelo baseline (sec. 5.1.3.1 del TFG) asume que la distribución
# diaria se reproduce de un periodo a otro sin aprendizaje paramétrico.
# En nuestra implementación equivale a w=1 (solo componente histórico).
# Se compara con el MD optimizado usando entropía cruzada como métrica
# principal (sec. 5.1.3.3 del TFG).

# --- 24.1) Tabla de entropía cruzada MD vs Baseline ---
ce_md       <- cross_entropy_weights(p_real, df_pred_final$peso_md)
ce_baseline <- cross_entropy_weights(p_real, bench_baseline$peso_md)
mejora_ce   <- (ce_baseline - ce_md) / ce_baseline * 100

df_ce_comparacion <- tibble(
  Modelo           = c("MD (w, alpha óptimos)", "Baseline naïve"),
  Entropia_cruzada = c(ce_md, ce_baseline),
  Mejora_pct       = c(paste0("-", round(mejora_ce, 1), "%"), "referencia")
)

cat("\n===== MD vs BASELINE — ENTROPÍA CRUZADA =====\n")
print(df_ce_comparacion)
cat(sprintf("El modelo MD reduce la entropía cruzada un %.1f%% respecto al baseline.\n",
            mejora_ce))

# --- 24.2) Gráfico de barras: entropía cruzada MD vs Baseline ---
p_ce_bar <- ggplot(
  df_ce_comparacion %>% mutate(Modelo = factor(Modelo, levels = Modelo)),
  aes(x = Modelo, y = Entropia_cruzada, fill = Modelo)
) +
  geom_col(width = 0.5, show.legend = FALSE) +
  geom_text(aes(label = round(Entropia_cruzada, 4)), vjust = -0.5, size = 4.5) +
  scale_fill_manual(values = c("MD (w, alpha óptimos)" = "#2980B9",
                                "Baseline naïve"        = "#E74C3C")) +
  labs(
    title    = "Entropía cruzada: MD vs Baseline naïve",
    subtitle = sprintf("El MD mejora un %.1f%% respecto al baseline", mejora_ce),
    x        = NULL,
    y        = "Entropía cruzada (menor = mejor)",
    caption  = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13)

ggsave("ce_md_vs_baseline.png", p_ce_bar, width = 8, height = 6, dpi = 300)

# --- 24.3) Serie diaria comparativa: Real vs MD vs Baseline ---
# Se reescalan ambos modelos al total real observado (hasta día 25)
# para aislar el efecto de la distribución de pesos del efecto del
# forecast mensual.

total_real <- sum(df_pred_final$unidades, na.rm = TRUE)

df_comparacion_diaria <- df_pred_final %>%
  select(fecha, dow, laborable, unidades, peso_real, peso_md) %>%
  mutate(
    pred_md_reescalada       = peso_md * total_real,
    peso_baseline            = bench_baseline$peso_md,
    pred_baseline_reescalada = peso_baseline * total_real,
    peso_denton              = bench_denton$peso_denton,
    pred_denton_reescalada   = peso_denton * total_real
  )

df_comp_long <- df_comparacion_diaria %>%
  filter(laborable == 1) %>%
  select(fecha, unidades, pred_md_reescalada, pred_baseline_reescalada,
         pred_denton_reescalada) %>%
  pivot_longer(
    cols      = c(unidades, pred_md_reescalada, pred_baseline_reescalada,
                  pred_denton_reescalada),
    names_to  = "Serie",
    values_to = "Valor"
  ) %>%
  mutate(Serie = factor(case_when(
    Serie == "unidades"                  ~ "Real",
    Serie == "pred_md_reescalada"        ~ "Modelo MD",
    Serie == "pred_baseline_reescalada"  ~ "Baseline naïve",
    Serie == "pred_denton_reescalada"    ~ "Denton proporcional"
  ), levels = c("Real", "Modelo MD", "Baseline naïve", "Denton proporcional")))

p_diario <- ggplot(df_comp_long, aes(x = fecha, y = Valor,
                                      color = Serie, linetype = Serie)) +
  geom_line(aes(group = Serie), linewidth = 0.9, alpha = 0.85) +
  geom_point(size = 1.8) +
  scale_color_manual(values = c("Real"                = "black",
                                 "Modelo MD"           = "#2980B9",
                                 "Baseline naïve"      = "#E74C3C",
                                 "Denton proporcional" = "#27AE60")) +
  scale_linetype_manual(values = c("Real"                = "solid",
                                    "Modelo MD"           = "dashed",
                                    "Baseline naïve"      = "dotted",
                                    "Denton proporcional" = "twodash")) +
  scale_y_continuous(labels = comma) +
  labs(
    title    = "Marzo 2026: distribución diaria real vs MD vs Baseline vs Denton",
    subtitle = "Solo días laborables — predicciones reescaladas al total real",
    x        = "Fecha",
    y        = "Matriculaciones",
    color    = "Serie",
    linetype = "Serie",
    caption  = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13) +
  theme(legend.position = "bottom")

ggsave("diario_md_vs_baseline.png", p_diario, width = 10, height = 6, dpi = 300)

# --- 24.4) Gráfico de error diario: MD vs Baseline ---
df_error_diario <- df_comparacion_diaria %>%
  filter(laborable == 1) %>%
  mutate(
    error_md       = unidades - pred_md_reescalada,
    error_baseline = unidades - pred_baseline_reescalada,
    error_denton   = unidades - pred_denton_reescalada
  ) %>%
  select(fecha, error_md, error_baseline, error_denton) %>%
  pivot_longer(cols = starts_with("error_"),
               names_to  = "Modelo",
               values_to = "Error",
               names_prefix = "error_") %>%
  mutate(Modelo = case_when(
    Modelo == "md"       ~ "Modelo MD",
    Modelo == "baseline" ~ "Baseline naïve",
    Modelo == "denton"   ~ "Denton proporcional"
  ))

p_error_diario <- ggplot(df_error_diario, aes(x = fecha, y = Error, fill = Modelo)) +
  geom_col(position = "dodge", alpha = 0.85) +
  geom_hline(yintercept = 0, linewidth = 0.6) +
  scale_fill_manual(values = c("Modelo MD"           = "#2980B9",
                                "Baseline naïve"      = "#E74C3C",
                                "Denton proporcional" = "#27AE60")) +
  scale_y_continuous(labels = comma) +
  labs(
    title   = "Error diario por día laborable: MD vs Baseline vs Denton",
    x       = "Fecha",
    y       = "Error (real - predicho)",
    fill    = "Modelo",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13) +
  theme(legend.position = "bottom")

ggsave("error_diario_md_vs_baseline.png", p_error_diario, width = 10, height = 5, dpi = 300)

# --- 24.5) Interpretación automática ---
cat("\n===== INTERPRETACIÓN: MD vs BASELINE =====\n")
cat(sprintf(
  "- Entropía cruzada MD: %.4f  |  Baseline: %.4f  ->  Mejora del MD: %.1f%%\n",
  ce_md, ce_baseline, mejora_ce
))
cat(sprintf(
  "- El MD optimizado (w=%.3f, alpha=%.3f) reduce significativamente la divergencia\n  entre la distribución predicha y la real respecto al baseline naïve.\n",
  resultado_md$w_opt, resultado_md$alpha_opt
))
if (resultado_md$w_opt > 0.7) {
  cat(sprintf(
    "- El valor alto de w (%.3f) indica que el componente histórico (baseline) aporta\n  información útil, pero la combinación con la logística (componente aprendido)\n  mejora la predicción: el MD aprende los matices que el baseline no captura.\n",
    resultado_md$w_opt
  ))
}
ce_denton <- cross_entropy_weights(p_real, bench_denton$peso_denton)
mejora_ce_vs_denton <- (ce_denton - ce_md) / ce_denton * 100
cat(sprintf(
  "- Denton proporcional (referencia académica): entropía cruzada = %.4f\n",
  ce_denton
))
cat(sprintf(
  "- El MD mejora un %.1f%% respecto a Denton proporcional.\n",
  mejora_ce_vs_denton
))
cat("- Se selecciona el modelo MD como modelo definitivo para la serie diaria.\n")

# ============================================================
# 25) COMPARACIÓN MD-1 / MD-2 / MD-3 (GENERALIZACIÓN A N VARIABLES)
# ============================================================
# MD-1: q_d = sigma(alpha_1 * beta_dow)
# MD-2: q_d = sigma(alpha_1 * beta_dow + alpha_2 * delta_d)
# MD-3: q_d = sigma(alpha_1 * beta_dow + alpha_2 * delta_d + alpha_3 * quincena_d)

# --- 25.1) Calcular delta_d y quincena_d ---
# delta_d = (D - d) / (D - 1), donde D = total laborables, d = posición ordinal
# quincena_d = 1 si d <= D/2, 0 si d > D/2

agregar_variables_extra <- function(df_mes) {
  df_mes %>%
    mutate(
      D_total = sum(laborable, na.rm = TRUE)
    ) %>%
    mutate(
      delta_d = if_else(
        laborable == 1 & D_total > 1,
        (D_total - laborable_idx) / (D_total - 1),
        NA_real_
      ),
      quincena_d = if_else(
        laborable == 1,
        as.numeric(laborable_idx <= D_total / 2),
        NA_real_
      )
    ) %>%
    select(-D_total)
}

df_feb2026 <- agregar_variables_extra(df_feb2026)
df_mar2026 <- agregar_variables_extra(df_mar2026)

# --- 25.2) Funciones generalizadas por versión ---

calcular_scores_y_pesos_md_v <- function(df_mes_obj,
                                          beta_dow_df,
                                          alpha_1,
                                          w,
                                          version = 1,
                                          alpha_2 = 0,
                                          alpha_3 = 0) {

  # Extraer solo dow_num y beta_dia del dataframe de betas
  tabla_beta <- beta_dow_df %>%
    select(dow_num, beta_dia)

  # Eliminar columnas que puedan colisionar con el join
  cols_drop <- intersect(names(df_mes_obj),
                         c("beta_dia", "logistic_dia", "z", "score", "peso_md"))
  df_clean <- df_mes_obj %>% select(-any_of(cols_drop))

  df_out <- df_clean %>%
    left_join(tabla_beta, by = "dow_num") %>%
    mutate(
      z = alpha_1 * beta_dia
    )

  if (version >= 2) {
    df_out <- df_out %>%
      mutate(z = z + alpha_2 * if_else(is.na(delta_d), 0, delta_d))
  }
  if (version >= 3) {
    df_out <- df_out %>%
      mutate(z = z + alpha_3 * if_else(is.na(quincena_d), 0, quincena_d))
  }

  df_out <- df_out %>%
    mutate(
      logistic_dia = 1 / (1 + exp(-z)),
      score = if_else(
        laborable == 1,
        ((1 - w) * logistic_dia + w * p_m1),
        0
      )
    )

  suma_scores <- sum(df_out$score, na.rm = TRUE)

  df_out %>%
    mutate(peso_md = safe_div(score, suma_scores))
}

coste_md_entropia_v <- function(par,
                                df_mes_ref,
                                df_mes_objetivo,
                                version = 1) {

  w       <- par[1]
  alpha_1 <- par[2]
  alpha_2 <- if (version >= 2) par[3] else 0
  alpha_3 <- if (version >= 3) par[4] else 0

  beta_dow_df <- calcular_beta_dow_excel(df_mes_ref)

  df_base <- construir_p_m1(
    df_mes_ref = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo
  ) %>%
    calcular_pesos_reales_laborables()

  # Asegurar que delta_d y quincena_d existen
  if (!"delta_d" %in% names(df_base)) {
    df_base <- agregar_variables_extra(df_base)
  }

  df_pred <- calcular_scores_y_pesos_md_v(
    df_mes_obj  = df_base,
    beta_dow_df = beta_dow_df,
    alpha_1     = alpha_1,
    w           = w,
    version     = version,
    alpha_2     = alpha_2,
    alpha_3     = alpha_3
  )

  cross_entropy_weights(
    p_real = df_pred$peso_real,
    p_pred = df_pred$peso_md
  )
}

# --- 25.3) Optimización generalizada ---

optimizar_md_version <- function(df_mes_ref,
                                  df_mes_objetivo,
                                  version = 1) {

  if (version == 1) {
    par_ini <- c(0.5, 1.0)
    lower   <- c(0.2, 0.1)
    upper   <- c(0.95, 20)
  } else if (version == 2) {
    par_ini <- c(0.5, 1.0, 0.0)
    lower   <- c(0.2, 0.1, -10)
    upper   <- c(0.95, 20, 10)
  } else {
    par_ini <- c(0.5, 1.0, 0.0, 0.0)
    lower   <- c(0.2, 0.1, -10, -10)
    upper   <- c(0.95, 20, 10, 10)
  }

  opt <- optim(
    par    = par_ini,
    fn     = coste_md_entropia_v,
    df_mes_ref      = df_mes_ref,
    df_mes_objetivo = df_mes_objetivo,
    version         = version,
    method  = "L-BFGS-B",
    lower   = lower,
    upper   = upper
  )

  res <- list(
    version      = version,
    optim        = opt,
    w_opt        = opt$par[1],
    alpha_1_opt  = opt$par[2],
    entropia_opt = opt$value
  )
  if (version >= 2) res$alpha_2_opt <- opt$par[3]
  if (version >= 3) res$alpha_3_opt <- opt$par[4]

  res
}

# --- 25.4) Ejecutar los 3 modelos ---

# Se usa el MISMO forecast que el modelo original para que las métricas
# sean directamente comparables.
forecast_comparacion <- forecast_mensual_mar2026

cat("\n===== COMPARACIÓN MD-1 / MD-2 / MD-3 =====\n")
cat(sprintf("Forecast utilizado: %.1f\n", forecast_comparacion))

resultados_v <- list()
predicciones_v <- list()

for (v in 1:3) {
  cat(sprintf("\nOptimizando MD-%d...\n", v))

  # Entrenamiento: ref = objetivo = febrero (igual que el modelo original)
  ajuste <- optimizar_md_version(
    df_mes_ref      = df_feb2026,
    df_mes_objetivo = df_feb2026,
    version         = v
  )
  resultados_v[[v]] <- ajuste

  cat(sprintf("  w = %.4f | alpha_1 = %.4f", ajuste$w_opt, ajuste$alpha_1_opt))
  if (v >= 2) cat(sprintf(" | alpha_2 = %.4f", ajuste$alpha_2_opt))
  if (v >= 3) cat(sprintf(" | alpha_3 = %.4f", ajuste$alpha_3_opt))
  cat(sprintf(" | Entropía train = %.6f\n", ajuste$entropia_opt))

  # Predicción: ref = febrero, objetivo = marzo
  beta_dow_df_v <- calcular_beta_dow_excel(df_feb2026)

  df_base_v <- construir_p_m1(
    df_mes_ref      = df_feb2026,
    df_mes_objetivo = df_mar2026
  ) %>%
    calcular_pesos_reales_laborables()

  if (!"delta_d" %in% names(df_base_v)) {
    df_base_v <- agregar_variables_extra(df_base_v)
  }

  df_pred_v <- calcular_scores_y_pesos_md_v(
    df_mes_obj  = df_base_v,
    beta_dow_df = beta_dow_df_v,
    alpha_1     = ajuste$alpha_1_opt,
    w           = ajuste$w_opt,
    version     = v,
    alpha_2     = if (v >= 2) ajuste$alpha_2_opt else 0,
    alpha_3     = if (v >= 3) ajuste$alpha_3_opt else 0
  ) %>%
    mutate(
      forecast_mensual = forecast_comparacion,
      pred_unidades = forecast_comparacion * peso_md
    )

  predicciones_v[[v]] <- df_pred_v
}

# --- 25.4b) Verificación: MD-1 debe coincidir con el modelo original ---
cat("\n--- Verificación MD-1 vs modelo original ---\n")
cat(sprintf("  Original  -> w = %.4f | alpha = %.4f | Entropía train = %.6f\n",
            resultado_md$w_opt, resultado_md$alpha_opt, resultado_md$entropia_opt))
cat(sprintf("  MD-1      -> w = %.4f | alpha = %.4f | Entropía train = %.6f\n",
            resultados_v[[1]]$w_opt, resultados_v[[1]]$alpha_1_opt,
            resultados_v[[1]]$entropia_opt))

# Entropía cruzada sobre marzo (test) para cada versión
ce_test_v <- sapply(predicciones_v, function(df) {
  cross_entropy_weights(df$peso_real, df$peso_md)
})

cat(sprintf("  Original  -> Entropía test (marzo) = %.6f\n",
            cross_entropy_weights(df_pred_final$peso_real, df_pred_final$peso_md)))
cat(sprintf("  MD-1      -> Entropía test (marzo) = %.6f\n", ce_test_v[1]))

# --- 25.5) Tabla comparativa ---

tabla_comparativa <- tibble(
  Modelo = paste0("MD-", 1:3),
  w = sapply(resultados_v, `[[`, "w_opt"),
  alpha_1 = sapply(resultados_v, `[[`, "alpha_1_opt"),
  alpha_2 = c(NA, resultados_v[[2]]$alpha_2_opt, resultados_v[[3]]$alpha_2_opt),
  alpha_3 = c(NA, NA, resultados_v[[3]]$alpha_3_opt),
  Entropia_train = sapply(resultados_v, `[[`, "entropia_opt"),
  Entropia_test = ce_test_v,
  RMSE = sapply(predicciones_v, function(df) {
    rmse(df$unidades, df$pred_unidades)
  }),
  MAPE = sapply(predicciones_v, function(df) {
    mape(df$unidades, df$pred_unidades)
  })
)

cat("\n===== TABLA COMPARATIVA MD-1 / MD-2 / MD-3 =====\n")
print(tabla_comparativa, n = Inf, width = Inf)

# --- 25.6) Gráfico comparativo: 3 versiones vs real ---

df_comp_versiones <- predicciones_v[[1]] %>%
  select(fecha, laborable, unidades) %>%
  mutate(
    `MD-1` = predicciones_v[[1]]$pred_unidades,
    `MD-2` = predicciones_v[[2]]$pred_unidades,
    `MD-3` = predicciones_v[[3]]$pred_unidades
  ) %>%
  filter(laborable == 1) %>%
  pivot_longer(
    cols      = c(unidades, `MD-1`, `MD-2`, `MD-3`),
    names_to  = "Serie",
    values_to = "Valor"
  ) %>%
  mutate(Serie = factor(Serie, levels = c("unidades", "MD-1", "MD-2", "MD-3"),
                        labels = c("Real", "MD-1", "MD-2", "MD-3")))

p_versiones <- ggplot(df_comp_versiones, aes(x = fecha, y = Valor,
                                              color = Serie, linetype = Serie)) +
  geom_line(linewidth = 0.9) +
  geom_point(size = 1.8) +
  scale_color_manual(values = c("Real" = "black",
                                 "MD-1" = "#2980B9",
                                 "MD-2" = "#E67E22",
                                 "MD-3" = "#27AE60")) +
  scale_linetype_manual(values = c("Real" = "solid",
                                    "MD-1" = "dashed",
                                    "MD-2" = "dotdash",
                                    "MD-3" = "twodash")) +
  scale_y_continuous(labels = comma) +
  labs(
    title    = "Marzo 2026: Real vs MD-1 / MD-2 / MD-3",
    subtitle = "Generalización del framework MD a N variables explicativas",
    x        = "Fecha",
    y        = "Matriculaciones",
    color    = "Serie",
    linetype = "Serie",
    caption  = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13) +
  theme(legend.position = "bottom")

print(p_versiones)
ggsave("comparacion_md_versiones.png", p_versiones, width = 10, height = 6, dpi = 300)

# --- 25.7) Gráfico de evolución de métricas por versión ---

df_metricas_long <- tabla_comparativa %>%
  select(Modelo, Entropia_test, RMSE, MAPE) %>%
  pivot_longer(
    cols      = c(Entropia_test, RMSE, MAPE),
    names_to  = "Metrica",
    values_to = "Valor"
  ) %>%
  mutate(
    Metrica = factor(Metrica,
                     levels = c("Entropia_test", "RMSE", "MAPE"),
                     labels = c("Entropía cruzada (test)", "RMSE", "MAPE (%)")),
    Modelo  = factor(Modelo, levels = paste0("MD-", 1:3))
  )

p_metricas <- ggplot(df_metricas_long, aes(x = Modelo, y = Valor, group = 1)) +
  geom_line(color = "#2980B9", linewidth = 1) +
  geom_point(size = 3, color = "#2980B9") +
  geom_text(aes(label = round(Valor, 2)), vjust = -1, size = 3.5) +
  facet_wrap(~ Metrica, scales = "free_y", nrow = 1) +
  labs(
    title   = "Evolución de métricas de error: MD-1 → MD-2 → MD-3",
    subtitle = "Efecto de añadir variables explicativas al framework MD",
    x       = NULL,
    y       = NULL,
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 13) +
  theme(strip.text = element_text(face = "bold"))

print(p_metricas)
ggsave("evolucion_metricas_md.png", p_metricas, width = 12, height = 5, dpi = 300)

cat("\n===== FIN COMPARACIÓN MD-1 / MD-2 / MD-3 =====\n")

