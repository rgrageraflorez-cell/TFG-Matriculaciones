# ============================================================
# 01_DIAGNOSTICO_REGRESION.R
# Diagnóstico formal de los modelos de regresión territorial
# TFG — Análisis de la demanda automovilística en España
# Asume que todos los objetos ya están cargados en la sesión
# ============================================================

library(dplyr)
library(ggplot2)
library(lmtest)
library(sandwich)
library(car)
library(spdep)
library(sf)
library(stringr)
library(patchwork)

# ============================================================
# 1.1. TABLA RESUMEN COMPARATIVA DE LOS 2 MODELOS
# ============================================================

# NOTA: mod_lin1 y mod_lin2 no tienen intercepto (~ 0 +).
# El R² de summary() para modelos sin intercepto se calcula respecto
# al origen (suma de cuadrados total = sum(y^2)), no respecto a la media,
# lo que infla artificialmente el R². Se usa R² centrado para comparación justa:
# R²_centrado = 1 - SS_res / SS_tot_centrado

calcular_r2_centrado <- function(modelo) {
  y      <- modelo$model[[1]]
  yhat   <- fitted(modelo)
  ss_res <- sum((y - yhat)^2)
  ss_tot <- sum((y - mean(y))^2)
  1 - ss_res / ss_tot
}

df_comparacion_modelos <- tibble(
  modelo      = c("mod_lin1", "mod_lin2"),
  R2_centrado = c(
    calcular_r2_centrado(mod_lin1),
    calcular_r2_centrado(mod_lin2)
  ),
  AIC     = c(AIC(mod_lin1), AIC(mod_lin2)),
  BIC     = c(BIC(mod_lin1), BIC(mod_lin2)),
  n_obs   = c(nobs(mod_lin1), nobs(mod_lin2)),
  n_coefs = c(length(coef(mod_lin1)), length(coef(mod_lin2)))
)

cat("\n===== TABLA COMPARATIVA DE MODELOS =====\n")
print(df_comparacion_modelos, digits = 4)

# ============================================================
# 1.2. DIAGNÓSTICO COMPLETO PARA CADA MODELO
# ============================================================

modelos   <- list(mod_lin1 = mod_lin1, mod_lin2 = mod_lin2)
datos_mod <- list(mod_lin1 = df_muni,  mod_lin2 = df_muni2)

# Vectores para tabla resumen final
shapiro_p_vec <- c()
bp_p_vec      <- c()
reset_p_vec   <- c(NA, NA)
max_vif_vec   <- c(NA, NA)
n_cook_vec    <- c()

for (nm in names(modelos)) {

  mod <- modelos[[nm]]
  df  <- datos_mod[[nm]]
  res <- residuals(mod)
  fit <- fitted(mod)
  n   <- length(res)

  cat("\n\n========================================\n")
  cat("DIAGNÓSTICO:", nm, "\n")
  cat("========================================\n")

  # ---- a) Normalidad ----

  set.seed(42)
  idx_sw <- if (n > 5000) sample(n, 5000) else seq_len(n)
  sw     <- shapiro.test(res[idx_sw])
  shapiro_p_vec <- c(shapiro_p_vec, sw$p.value)
  cat(sprintf("Shapiro-Wilk: W = %.4f, p = %.4e\n", sw$statistic, sw$p.value))

  df_qq <- data.frame(res = res)
  p_qq  <- ggplot(df_qq, aes(sample = res)) +
    stat_qq(alpha = 0.4, color = "steelblue", size = 0.8) +
    stat_qq_line(color = "firebrick", linewidth = 0.8) +
    labs(
      title   = paste("QQ-plot de residuos —", nm),
      x       = "Cuantiles teóricos",
      y       = "Cuantiles muestrales",
      caption = "Fuente: elaboración propia"
    ) +
    theme_minimal(base_size = 12)

  ggsave(paste0("qq_plot_", nm, ".png"), p_qq, width = 8, height = 6, dpi = 300)

  p_hist <- ggplot(df_qq, aes(x = res)) +
    geom_histogram(aes(y = after_stat(density)), bins = 50,
                   fill = "steelblue", color = "white", alpha = 0.7) +
    stat_function(
      fun  = dnorm,
      args = list(mean = mean(res), sd = sd(res)),
      color = "firebrick", linewidth = 1
    ) +
    labs(
      title   = paste("Histograma de residuos —", nm),
      x       = "Residuos",
      y       = "Densidad",
      caption = "Fuente: elaboración propia"
    ) +
    theme_minimal(base_size = 12)

  ggsave(paste0("hist_residuos_", nm, ".png"), p_hist, width = 8, height = 6, dpi = 300)

  # ---- b) Heterocedasticidad ----

  # bptest requiere intercepto + al menos un regresor en la regresión auxiliar;
  # mod_lin1 (sin intercepto, un solo regresor) no cumple esa condición.
  bp <- tryCatch(bptest(mod), error = function(e) NULL)
  if (!is.null(bp)) {
    bp_p_vec <- c(bp_p_vec, bp$p.value)
    cat(sprintf("Breusch-Pagan: BP = %.4f, p = %.4e\n", bp$statistic, bp$p.value))
  } else {
    bp_p_vec <- c(bp_p_vec, NA)
    cat("Breusch-Pagan: no aplicable para modelos sin intercepto con un único regresor.\n")
  }

  df_res_fit <- data.frame(fitted = fit, residuos = res)
  p_res <- ggplot(df_res_fit, aes(x = fitted, y = residuos)) +
    geom_point(alpha = 0.3, size = 0.8, color = "steelblue") +
    geom_hline(yintercept = 0, color = "black", linewidth = 0.7) +
    geom_smooth(method = "loess", color = "firebrick",
                se = FALSE, linewidth = 0.9, formula = y ~ x) +
    labs(
      title   = paste("Residuos vs. valores ajustados —", nm),
      x       = "Valores ajustados",
      y       = "Residuos",
      caption = "Fuente: elaboración propia"
    ) +
    theme_minimal(base_size = 12)
df_res_fit
  ggsave(paste0("residuos_vs_fitted_", nm, ".png"), p_res, width = 8, height = 6, dpi = 300)

  # ---- c) Multicolinealidad (solo mod_lin2) ----

  if (nm == "mod_lin2") {
    vif_vals <- tryCatch(car::vif(mod), error = function(e) NULL)
    if (!is.null(vif_vals)) {
      idx_mod <- which(names(modelos) == nm)
      max_vif_vec[idx_mod] <- max(vif_vals)
      cat("VIF:\n")
      print(round(vif_vals, 3))
      if (any(vif_vals > 10)) {
        cat("AVISO: VIF > 10 en alguna variable — multicolinealidad severa.\n")
      } else if (any(vif_vals > 5)) {
        cat("AVISO: VIF > 5 en alguna variable — multicolinealidad moderada.\n")
      } else {
        cat("VIF dentro de límites aceptables (todos < 5).\n")
      }
    }
  }

  # ---- d) Observaciones influyentes (distancia de Cook) ----

  cook   <- cooks.distance(mod)
  umbral <- 4 / n
  n_cook <- sum(cook > umbral, na.rm = TRUE)
  n_cook_vec <- c(n_cook_vec, n_cook)
  cat(sprintf("Observaciones con Cook > 4/n (%.5f): %d\n", umbral, n_cook))

  top20_idx <- order(cook, decreasing = TRUE)[1:min(20, n)]

  # Los índices de Cook corresponden al model.frame (tras eliminar NAs),
  # no a las filas del sf original — se recuperan los índices reales.
  orig_idx   <- as.integer(rownames(model.frame(mod)))
  top20_orig <- orig_idx[top20_idx]

  cols_base  <- c("name", "poblacion", "matriculaciones")
  cols_extra <- if (nm == "mod_lin2") "Indice2023" else character(0)
  cols_sel   <- intersect(c(cols_base, cols_extra), names(df))

  resid_st <- tryCatch(
    rstandard(mod),
    error = function(e) residuals(mod) / summary(mod)$sigma
  )

  df_inf <- df %>%
    st_drop_geometry() %>%
    slice(top20_orig) %>%
    select(all_of(cols_sel)) %>%
    mutate(
      cook_dist = cook[top20_idx],
      resid_std = resid_st[top20_idx]
    ) %>%
    arrange(desc(cook_dist))

  assign(paste0("df_influyentes_", nm), df_inf)
  cat("Top 20 municipios más influyentes:\n")
  print(df_inf, digits = 3)

  df_cook_plot <- data.frame(idx = seq_along(cook), cook = cook)
  p_cook <- ggplot(df_cook_plot, aes(x = idx, y = cook)) +
    geom_point(size = 0.6, alpha = 0.5, color = "steelblue") +
    geom_hline(yintercept = umbral, color = "firebrick",
               linetype = "dashed", linewidth = 0.8) +
    annotate("text", x = n * 0.8, y = umbral * 1.15,
             label = paste0("Umbral = 4/n = ", round(umbral, 5)),
             color = "firebrick", size = 3.5) +
    labs(
      title   = paste("Distancia de Cook —", nm),
      x       = "Índice de observación",
      y       = "Distancia de Cook",
      caption = "Fuente: elaboración propia"
    ) +
    theme_minimal(base_size = 12)
df_cook_plot
  ggsave(paste0("cook_", nm, ".png"), p_cook, width = 8, height = 6, dpi = 300)

  # ---- e) Test RESET de Ramsey (solo mod_lin2) ----

  if (nm == "mod_lin2") {
    reset_res <- tryCatch(
      resettest(mod, power = 2:3, type = "fitted"),
      error = function(e) NULL
    )
    if (!is.null(reset_res)) {
      idx_mod <- which(names(modelos) == nm)
      reset_p_vec[idx_mod] <- reset_res$p.value
      cat(sprintf("Test RESET: F = %.4f, p = %.4e\n",
                  reset_res$statistic, reset_res$p.value))
      if (reset_res$p.value < 0.05) {
        cat("  → El test RESET sugiere no linealidad omitida (p < 0.05).\n")
      } else {
        cat("  → El test RESET no rechaza la hipótesis de linealidad (p >= 0.05).\n")
      }
    }
  }
}

# ============================================================
# 1.3. ESPECIFICACIÓN ALTERNATIVA LOG-LOG
# ============================================================

cat("\n\n========================================\n")
cat("DIAGNÓSTICO: mod_log (log-log)\n")
cat("========================================\n")

df_log <- df_muni2 %>%
  st_drop_geometry() %>%
  filter(matriculaciones > 0, poblacion > 0, Indice2023 > 0)

mod_log <- lm(log(matriculaciones) ~ log(poblacion) + log(Indice2023), data = df_log)
cat("Resumen mod_log:\n")
print(summary(mod_log))

r2_log  <- summary(mod_log)$adj.r.squared
res_log <- residuals(mod_log)
fit_log <- fitted(mod_log)
n_log   <- length(res_log)

# Shapiro-Wilk
set.seed(42)
idx_sw_log <- if (n_log > 5000) sample(n_log, 5000) else seq_len(n_log)
sw_log     <- shapiro.test(res_log[idx_sw_log])
cat(sprintf("Shapiro-Wilk (log-log): W = %.4f, p = %.4e\n",
            sw_log$statistic, sw_log$p.value))

# QQ-plot
df_qq_log <- data.frame(res = res_log)
p_qq_log  <- ggplot(df_qq_log, aes(sample = res)) +
  stat_qq(alpha = 0.4, color = "steelblue", size = 0.8) +
  stat_qq_line(color = "firebrick", linewidth = 0.8) +
  labs(
    title   = "QQ-plot de residuos — mod_log",
    x       = "Cuantiles teóricos",
    y       = "Cuantiles muestrales",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12)

ggsave("qq_plot_mod_log.png", p_qq_log, width = 8, height = 6, dpi = 300)

# Breusch-Pagan
bp_log <- bptest(mod_log)
cat(sprintf("Breusch-Pagan (log-log): BP = %.4f, p = %.4e\n",
            bp_log$statistic, bp_log$p.value))

# Residuos vs fitted
df_res_log <- data.frame(fitted = fit_log, residuos = res_log)
p_res_log  <- ggplot(df_res_log, aes(x = fitted, y = residuos)) +
  geom_point(alpha = 0.3, size = 0.8, color = "steelblue") +
  geom_hline(yintercept = 0, color = "black", linewidth = 0.7) +
  geom_smooth(method = "loess", color = "firebrick",
              se = FALSE, linewidth = 0.9, formula = y ~ x) +
  labs(
    title   = "Residuos vs. valores ajustados — mod_log",
    x       = "Valores ajustados (log)",
    y       = "Residuos",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12)

ggsave("residuos_vs_fitted_mod_log.png", p_res_log, width = 8, height = 6, dpi = 300)

# Comparación con mod_lin2
mejor_norm   <- if (isTRUE(sw_log$p.value > shapiro_p_vec[2])) "mejor" else "peor"
menor_hetero <- if (isTRUE(bp_log$p.value > bp_p_vec[2]))      "menor" else "mayor"
cat(sprintf(
  "\nEl modelo log-log presenta %s normalidad de residuos y %s heterocedasticidad que el modelo lineal 2.\n",
  mejor_norm, menor_hetero
))

# ============================================================
# 1.4. TABLA RESUMEN FINAL DE DIAGNÓSTICOS
# ============================================================

df_diagnosticos <- tibble(
  modelo             = c("mod_lin1", "mod_lin2", "mod_log"),
  R2                 = c(
    calcular_r2_centrado(mod_lin1),
    calcular_r2_centrado(mod_lin2),
    r2_log
  ),
  shapiro_p          = c(shapiro_p_vec, sw_log$p.value),
  bp_p               = c(bp_p_vec, bp_log$p.value),
  reset_p            = c(reset_p_vec, NA),
  max_vif            = c(max_vif_vec, NA),
  n_cook_influyentes = c(n_cook_vec, sum(cooks.distance(mod_log) > 4 / n_log, na.rm = TRUE))
)

cat("\n===== TABLA RESUMEN DE DIAGNÓSTICOS =====\n")
print(df_diagnosticos, digits = 4)

# ============================================================
# INTERPRETACIÓN FINAL
# ============================================================

modelos_shapiro_rechazan <- df_diagnosticos$modelo[
  !is.na(df_diagnosticos$shapiro_p) & df_diagnosticos$shapiro_p < 0.05
]
modelos_bp_rechazan <- df_diagnosticos$modelo[
  !is.na(df_diagnosticos$bp_p) & df_diagnosticos$bp_p < 0.05
]
modelos_reset_rechazan <- df_diagnosticos$modelo[
  !is.na(df_diagnosticos$reset_p) & df_diagnosticos$reset_p < 0.05
]
max_vif_global  <- max(df_diagnosticos$max_vif, na.rm = TRUE)
n_cook_mod2     <- df_diagnosticos$n_cook_influyentes[df_diagnosticos$modelo == "mod_lin2"]
top_influyentes <- paste(df_influyentes_mod_lin2$name[1:5], collapse = ", ")

cat("\n\n===== INTERPRETACIÓN =====\n")
cat(sprintf(
  "- Normalidad: %s rechazan H0 de normalidad (p < 0.05). Esto es habitual con datos municipales (n grande).\n",
  if (length(modelos_shapiro_rechazan) == 0) "ningún modelo"
  else paste(modelos_shapiro_rechazan, collapse = ", ")
))
cat(sprintf(
  "- Heterocedasticidad: %s presenta%s heterocedasticidad significativa (BP p < 0.05), lo que sugiere usar errores robustos.\n",
  if (length(modelos_bp_rechazan) == 0) "ningún modelo" else paste(modelos_bp_rechazan, collapse = ", "),
  if (length(modelos_bp_rechazan) == 1) "" else "n"
))
cat(sprintf(
  "- Multicolinealidad: VIF máximo = %.2f, por %s del umbral de 5.\n",
  max_vif_global,
  if (max_vif_global > 5) "encima" else "debajo"
))
cat(sprintf(
  "- No linealidad: el test RESET %s la hipótesis de linealidad para mod_lin2.\n",
  if (length(modelos_reset_rechazan) > 0) paste("rechaza en", paste(modelos_reset_rechazan, collapse = ", "))
  else "no rechaza"
))
cat(sprintf(
  "- Observaciones influyentes: %d municipios superan el umbral de Cook en mod_lin2. Los más influyentes son: %s.\n",
  n_cook_mod2, top_influyentes
))
