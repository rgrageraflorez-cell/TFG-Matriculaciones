# ============================================================
# MD-DEEP: RED NEURONAL FEEDFORWARD DE DOS CAPAS
# ============================================================
# Compara el modelo MD-shallow (1 capa logística) con MD-deep
# (2 capas con H neuronas ocultas) para la distribución diaria
# de matriculaciones.
#
# Variables de entrada (3):
#   beta_dow_d  : coeficiente del día de la semana
#   delta_d     : proximidad a fin de mes = (D - d) / (D - 1)
#   quincena_d  : indicador binario primera/segunda quincena
#
# MD-shallow: q_d = sigma(alpha * beta_dow_d)
# MD-deep:    h_k = sigma(a1k * beta_dow + a2k * delta + a3k * quincena)
#             q_d = sigma(sum_k(wk * hk))
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
# 0) IMPORTAR FUNCIONES DE MD_diario.R
# ============================================================

source("MD diario.R", local = FALSE, echo = FALSE)

# ============================================================
# 1) CARGA DE DATOS (misma estructura que MD diario.R)
# ============================================================

ruta_excel <- "~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Datos diarios/Análisis diario.xlsx"

df_feb2026_raw <- read_excel(ruta_excel, sheet = 1)
df_mar2026_raw <- read_excel(ruta_excel, sheet = 2)

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

festivos_feb2026 <- as.Date(character())
festivos_mar2026 <- as.Date(character())

df_feb2026 <- preparar_dataset(df_feb2026_raw, festivos = festivos_feb2026)
df_mar2026 <- preparar_dataset(df_mar2026_raw, festivos = festivos_mar2026)

forecast_mensual_mar2026 <- 177686.6

# ============================================================
# 2) CONSTRUIR FEATURES PARA LA RED NEURONAL
# ============================================================

construir_features <- function(df_mes, beta_dow_df) {

  D <- max(day(df_mes$fecha))

  df_mes %>%
    left_join(beta_dow_df %>% select(dow_num, beta_dia), by = "dow_num") %>%
    mutate(
      delta_d    = (D - day(fecha)) / max(D - 1, 1),
      quincena_d = as.numeric(day(fecha) > 15)
    )
}

# ============================================================
# 3) FORWARD PASS DE MD-DEEP
# ============================================================

sigmoid <- function(x) 1 / (1 + exp(-x))

# par: vector de parámetros aplanado
#   [1 .. 3*H]        = pesos capa 1 (alpha_jk para j=1..3, k=1..H)
#   [3*H+1 .. 4*H]    = pesos capa 2 (w_k para k=1..H)
#   [4*H+1]            = w (ponderación estructural vs histórico)
forward_deep <- function(par, H, beta_dow, delta_d, quincena_d) {

  W1 <- matrix(par[1:(3 * H)], nrow = 3, ncol = H)  # 3 x H
  w2 <- par[(3 * H + 1):(4 * H)]                      # H x 1

  # Capa oculta: cada columna k -> h_k = sigma(W1[,k] . inputs)
  # inputs es una matrix N x 3
  inputs <- cbind(beta_dow, delta_d, quincena_d)  # N x 3
  z1 <- inputs %*% W1                              # N x H
  h  <- sigmoid(z1)                                 # N x H

  # Capa de salida: q_d = sigma(sum_k(w2_k * h_k))
  z2 <- h %*% w2                                    # N x 1
  q  <- sigmoid(as.numeric(z2))                     # N

  q
}

# ============================================================
# 4) FUNCIÓN DE COSTE MD-DEEP
# ============================================================

coste_md_deep <- function(par, H, df_features, eps = 1e-12) {

  w_blend <- par[4 * H + 1]

  lab_idx <- df_features$laborable == 1
  beta_dow   <- df_features$beta_dia[lab_idx]
  delta_d    <- df_features$delta_d[lab_idx]
  quincena_d <- df_features$quincena_d[lab_idx]
  p_m1       <- df_features$p_m1[lab_idx]
  peso_real  <- df_features$peso_real[lab_idx]

  q <- forward_deep(par, H, beta_dow, delta_d, quincena_d)

  scores <- (1 - w_blend) * q + w_blend * p_m1
  pesos_pred <- scores / sum(scores)
  pesos_pred <- pmax(pesos_pred, eps)

  -sum(peso_real * log(pesos_pred))
}

# ============================================================
# 5) PREPARAR DATOS PARA ENTRENAMIENTO / TEST
# ============================================================

beta_dow_df <- calcular_beta_dow_excel(df_feb2026)

# --- Train: febrero (ref = objetivo = febrero) ---
df_train <- construir_p_m1(df_feb2026, df_feb2026) %>%
  calcular_pesos_reales_laborables() %>%
  construir_features(beta_dow_df)

# --- Test: marzo (ref = febrero, objetivo = marzo) ---
df_test <- construir_p_m1(df_feb2026, df_mar2026) %>%
  calcular_pesos_reales_laborables() %>%
  construir_features(beta_dow_df)

# ============================================================
# 6) OPTIMIZACIÓN CON MÚLTIPLES INICIALIZACIONES
# ============================================================

optimizar_md_deep <- function(H, df_train, n_restarts = 10, verbose = FALSE) {

  n_par <- 4 * H + 1  # 3*H (capa1) + H (capa2) + 1 (w_blend)

  lower_bounds <- c(rep(-10, 4 * H), 0.2)
  upper_bounds <- c(rep( 10, 4 * H), 0.95)

  mejor_valor <- Inf
  mejor_resultado <- NULL

  for (i in seq_len(n_restarts)) {
    set.seed(42 + i)

    par_ini <- c(
      runif(4 * H, -0.5, 0.5),  # pesos de red
      runif(1, 0.3, 0.8)         # w_blend
    )

    resultado <- tryCatch({
      optim(
        par    = par_ini,
        fn     = coste_md_deep,
        H      = H,
        df_features = df_train,
        method = "L-BFGS-B",
        lower  = lower_bounds,
        upper  = upper_bounds,
        control = list(maxit = 1000)
      )
    }, error = function(e) NULL)

    if (!is.null(resultado) && resultado$value < mejor_valor) {
      mejor_valor <- resultado$value
      mejor_resultado <- resultado
      if (verbose) cat(sprintf("  H=%d restart=%d -> CE=%.6f (mejor)\n", H, i, resultado$value))
    }
  }

  mejor_resultado
}

# ============================================================
# 7) EVALUAR UN MODELO (TRAIN + TEST)
# ============================================================

evaluar_modelo_deep <- function(par_opt, H, df_train, df_test, forecast_mensual) {

  w_blend <- par_opt[4 * H + 1]

  # --- Métricas en train ---
  ce_train <- coste_md_deep(par_opt, H, df_train)

  # --- Predicción en test ---
  lab_idx_test <- df_test$laborable == 1
  beta_dow_t   <- df_test$beta_dia[lab_idx_test]
  delta_d_t    <- df_test$delta_d[lab_idx_test]
  quincena_d_t <- df_test$quincena_d[lab_idx_test]
  p_m1_t       <- df_test$p_m1[lab_idx_test]
  peso_real_t  <- df_test$peso_real[lab_idx_test]
  unidades_t   <- df_test$unidades[lab_idx_test]

  q_test <- forward_deep(par_opt, H, beta_dow_t, delta_d_t, quincena_d_t)
  scores_test <- (1 - w_blend) * q_test + w_blend * p_m1_t
  pesos_pred_test <- scores_test / sum(scores_test)

  ce_test <- -sum(peso_real_t * log(pmax(pesos_pred_test, 1e-12)))

  pred_unidades <- pesos_pred_test * forecast_mensual
  rmse_test <- sqrt(mean((unidades_t - pred_unidades)^2))

  idx_nz <- unidades_t != 0
  mape_test <- mean(abs((unidades_t[idx_nz] - pred_unidades[idx_nz]) / unidades_t[idx_nz])) * 100

  list(
    ce_train    = ce_train,
    ce_test     = ce_test,
    rmse_test   = rmse_test,
    mape_test   = mape_test,
    pesos_pred  = pesos_pred_test,
    pred_unidades = pred_unidades,
    w_blend     = w_blend
  )
}

# ============================================================
# 8) MD-SHALLOW: ENTRENAR Y EVALUAR (REFERENCIA)
# ============================================================

cat("\n========================================\n")
cat("Entrenando MD-shallow (modelo original)\n")
cat("========================================\n")

res_shallow <- optimizar_w_alpha(
  df_mes_ref      = df_feb2026,
  df_mes_objetivo = df_feb2026,
  w_ini           = 0.5,
  alpha_ini       = 1
)

# CE train shallow
ce_train_shallow <- res_shallow$entropia_opt

# Predicción test shallow
df_test_shallow <- ejecutar_md_mes(
  df_mes_ref             = df_feb2026,
  df_mes_objetivo        = df_mar2026,
  alpha                  = res_shallow$alpha_opt,
  w                      = res_shallow$w_opt,
  forecast_mensual_tbats = forecast_mensual_mar2026
)

pesos_real_test <- df_test_shallow$peso_real[df_test_shallow$laborable == 1]
pesos_pred_shallow <- df_test_shallow$peso_md[df_test_shallow$laborable == 1]
ce_test_shallow <- cross_entropy_weights(pesos_real_test, pesos_pred_shallow)

unidades_real_test <- df_test_shallow$unidades[df_test_shallow$laborable == 1]
pred_unid_shallow  <- df_test_shallow$pred_unidades[df_test_shallow$laborable == 1]
rmse_shallow <- sqrt(mean((unidades_real_test - pred_unid_shallow)^2))

idx_nz <- unidades_real_test != 0
mape_shallow <- mean(abs((unidades_real_test[idx_nz] - pred_unid_shallow[idx_nz]) / unidades_real_test[idx_nz])) * 100

cat(sprintf("  w=%.4f  alpha=%.4f  CE_train=%.6f  CE_test=%.6f  RMSE=%.1f  MAPE=%.2f%%\n",
            res_shallow$w_opt, res_shallow$alpha_opt,
            ce_train_shallow, ce_test_shallow, rmse_shallow, mape_shallow))

# ============================================================
# 9) MD-DEEP: ENTRENAR PARA H = 2, 3, 4, 5
# ============================================================

H_values <- c(2, 3, 4, 5)
resultados_deep <- list()

for (H in H_values) {
  cat(sprintf("\n========================================\n"))
  cat(sprintf("Entrenando MD-deep con H=%d neuronas\n", H))
  cat(sprintf("========================================\n"))

  opt <- optimizar_md_deep(H, df_train, n_restarts = 10, verbose = TRUE)

  if (is.null(opt)) {
    cat(sprintf("  ERROR: no convergió para H=%d\n", H))
    next
  }

  eval_res <- evaluar_modelo_deep(opt$par, H, df_train, df_test, forecast_mensual_mar2026)

  n_params <- 4 * H + 1

  cat(sprintf("  Parámetros: %d  w_blend=%.4f\n", n_params, eval_res$w_blend))
  cat(sprintf("  CE_train=%.6f  CE_test=%.6f  RMSE=%.1f  MAPE=%.2f%%\n",
              eval_res$ce_train, eval_res$ce_test, eval_res$rmse_test, eval_res$mape_test))

  resultados_deep[[as.character(H)]] <- list(
    H          = H,
    n_params   = n_params,
    opt        = opt,
    eval       = eval_res
  )
}

# ============================================================
# 10) TABLA COMPARATIVA
# ============================================================

cat("\n\n")
cat("============================================================\n")
cat("TABLA COMPARATIVA: MD-shallow vs MD-deep\n")
cat("============================================================\n")

tabla <- tibble(
  Modelo     = "MD-shallow",
  Parametros = 2L,
  CE_train   = ce_train_shallow,
  CE_test    = ce_test_shallow,
  RMSE_test  = rmse_shallow,
  MAPE_test  = mape_shallow
)

for (H_str in names(resultados_deep)) {
  r <- resultados_deep[[H_str]]
  tabla <- bind_rows(tabla, tibble(
    Modelo     = sprintf("MD-deep (H=%d)", r$H),
    Parametros = r$n_params,
    CE_train   = r$eval$ce_train,
    CE_test    = r$eval$ce_test,
    RMSE_test  = r$eval$rmse_test,
    MAPE_test  = r$eval$mape_test
  ))
}

print(tabla, n = Inf, width = Inf)

# ============================================================
# 11) SELECCIONAR MEJOR MODELO DEEP
# ============================================================

mejor_H <- NULL
mejor_ce_test <- Inf

for (H_str in names(resultados_deep)) {
  r <- resultados_deep[[H_str]]
  if (r$eval$ce_test < mejor_ce_test) {
    mejor_ce_test <- r$eval$ce_test
    mejor_H <- H_str
  }
}

cat(sprintf("\nMejor MD-deep: H=%s (CE_test=%.6f)\n", mejor_H, mejor_ce_test))

# ============================================================
# 12) GRÁFICO COMPARATIVO: REAL vs MD-SHALLOW vs MEJOR MD-DEEP
# ============================================================

# Preparar datos de marzo con fechas laborables
fechas_lab <- df_test$fecha[df_test$laborable == 1]

df_plot <- tibble(
  fecha          = fechas_lab,
  Real           = unidades_real_test,
  MD_shallow     = pred_unid_shallow,
  MD_deep_mejor  = resultados_deep[[mejor_H]]$eval$pred_unidades
)

mejor_label <- sprintf("MD-deep (H=%s)", mejor_H)

df_plot_long <- df_plot %>%
  pivot_longer(
    cols      = c(Real, MD_shallow, MD_deep_mejor),
    names_to  = "Serie",
    values_to = "Matriculaciones"
  ) %>%
  mutate(
    Serie = case_when(
      Serie == "Real"          ~ "Real",
      Serie == "MD_shallow"    ~ "MD-shallow",
      Serie == "MD_deep_mejor" ~ mejor_label
    ),
    Serie = factor(Serie, levels = c("Real", "MD-shallow", mejor_label))
  )

colores <- c("Real" = "black", "MD-shallow" = "#2196F3", setNames("#E91E63", mejor_label))

g <- ggplot(df_plot_long, aes(x = fecha, y = Matriculaciones, color = Serie)) +
  geom_line(linewidth = 0.9) +
  geom_point(size = 2) +
  scale_color_manual(values = colores) +
  scale_y_continuous(labels = comma) +
  scale_x_date(date_breaks = "2 days", date_labels = "%d %b") +
  labs(
    title    = "Marzo 2026: Real vs MD-shallow vs mejor MD-deep",
    subtitle = sprintf("Forecast mensual: %s matriculaciones", format(forecast_mensual_mar2026, big.mark = ".")),
    x        = "Fecha",
    y        = "Matriculaciones",
    color    = "Modelo"
  ) +
  theme_minimal(base_size = 13) +
  theme(
    axis.text.x     = element_text(angle = 45, hjust = 1),
    legend.position = "bottom"
  )

print(g)

# ============================================================
# 13) RESUMEN FINAL
# ============================================================

cat("\n============================================================\n")
cat("RESUMEN FINAL\n")
cat("============================================================\n")
cat(sprintf("MD-shallow:  w=%.4f  alpha=%.4f  | CE_test=%.6f  RMSE=%.1f  MAPE=%.2f%%\n",
            res_shallow$w_opt, res_shallow$alpha_opt,
            ce_test_shallow, rmse_shallow, mape_shallow))

r_best <- resultados_deep[[mejor_H]]
cat(sprintf("Mejor deep:  H=%s  w_blend=%.4f  | CE_test=%.6f  RMSE=%.1f  MAPE=%.2f%%\n",
            mejor_H, r_best$eval$w_blend,
            r_best$eval$ce_test, r_best$eval$rmse_test, r_best$eval$mape_test))

if (mejor_ce_test < ce_test_shallow) {
  mejora_ce <- (ce_test_shallow - mejor_ce_test) / ce_test_shallow * 100
  cat(sprintf("\nMD-deep mejora la CE_test en un %.2f%% respecto a MD-shallow.\n", mejora_ce))
} else {
  cat("\nMD-shallow tiene igual o mejor CE_test que todos los MD-deep.\n")
  cat("La capa adicional no aporta mejora → el modelo simple es preferible (parsimonia).\n")
}

