

#----------Librerias---------


library(readxl)
library(forecast)
library(ggplot2)
library(tidyverse)
library(dplyr)
library(keras)

# =========== Carga de datos===================

# Leer el Excel


  #df_anual: dataset con la informacion de matriculaciones anuales en españa por tipo de vehículo
df_anual <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Matriculaciones-Series-historicas-2024.xlsx", sheet= 1)
  #df_anual_electrico: dataset con las matriculaciones anuales de coches con tipo de combustible distinto a gasolina y gasoil (es una aproximacion a electricos)
df_anual_electrico <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Matriculaciones-Series-historicas-2024.xlsx", sheet = 6)

#df_mensual21.1: dataset de matriculaciones mensuales por marca de enero a julio de 2021. El df_mensual21.2: recoge las restantes de julio a diciembre
df_mensual21.1 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2021.xlsx", sheet = 1)
df_mensual21.2 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2021.xlsx", sheet = 2)

#df_mensual22.1: dataset de matriculaciones mensuales por marca de enero a julio de 2022. El df_mensual22.2: recoge las restantes de julio a diciembre
df_mensual22.1 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2022.xlsx", sheet = 1)
df_mensual22.2 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2022.xlsx", sheet = 2)

#df_mensual23.1: dataset de matriculaciones mensuales por marca de enero a julio de 2023. El df_mensual23.2: recoge las restantes de julio a diciembre
df_mensual23.1 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2023.xlsx", sheet = 1)
df_mensual23.2 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2023.xlsx", sheet = 2)

#pasa lo mismo con 2024, dos datasets uno de enero a julio de 2024 y otro de julio a diciembre:
df_mensual24.1 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2024.xlsx", sheet = 1)
df_mensual24.2 <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Análisis mensual 2024.xlsx", sheet = 2)

#ahora tenemos los datos de 2025: 
df251 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 1)
df252 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 2)
df253 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 3)
df254 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 4)
df255 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 5)
df256 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 6)
df257 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 7)
df258 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 8)
df259 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 9)
df2510 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 10)
df2511 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 11)
df2512 <-read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/mensualidad agrupada 2025.xlsx", sheet = 12)

df_mensual25 <- bind_rows(df251, df252, df253, df254, df256, df257, df258, df259, df2510, df2511, df2512)

#datasets diarios:

df_diario <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES/Datos diarios/Análisis diario.xlsx", sheet = 1)
view(df_diario)


library(stringr)

df_mensual25 <- df_mensual25 %>%
  mutate(
    lugar = str_replace(lugar, "^[0-9]+", "") %>%  # quita números al inicio
      str_trim()                            # elimina espacios sobrantes
  )

#----------Preparación de datos-----

##-------------------Limpieza del df_anual--------------------------
# Quitar los encabezados actuales (transformarlos en una fila)
df_anual <- df_anual
# Eliminar esa primera fila
df_anual <- df_anual[-1, ]

# Guardar la primera fila como nuevos nombres de columna
new_names <- as.character(df_anual[1, ])

# Asignar los nuevos encabezados
colnames(df_anual) <- new_names

# (Opcional) Resetear los índices de fila
rownames(df_anual) <- NULL
df_anual <- df_anual[-1, ]

#las últimas dos filas son NA'S, las eliminamos:
df_anual <- df_anual[1:(nrow(df_anual) - 2), ]


##-------------Limpieza del anual eléctrico-----------
# Quitar los encabezados actuales (transformarlos en una fila)
df_anual_electrico <- df_anual_electrico
# Eliminar esa primera fila
df_anual_electrico <- df_anual_electrico[-1, ]

# Guardar la primera fila como nuevos nombres de columna
new_names <- as.character(df_anual_electrico[1, ])

# Asignar los nuevos encabezados
colnames(df_anual_electrico) <- new_names

# (Opcional) Resetear los índices de fila

df_anual_electrico <- df_anual_electrico[-1, ]


##----Limpieza df_mensuales-----


#convertir la columna marca en texto

df_mensual23.1$marca <- as.character(df_mensual23.1$marca)

#agrupamos las filas por marca
df211 <- df_mensual21.1 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df211 <- df211 %>%
  arrange(Año, Mes)

df212 <- df_mensual21.2 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df212 <- df212 %>%
  arrange(Año, Mes)

df221 <- df_mensual22.1 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df221 <- df221 %>%
  arrange(Año, Mes)

df222 <- df_mensual22.2 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df222 <- df222 %>%
  arrange(Año, Mes)


df231 <- df_mensual23.1 %>%
  group_by(Año = year(`fecha matriculación`), Mes = month(`fecha matriculación`)) %>%
  summarize(Turismos = n())
df231 <- df231 %>%
  arrange(Año, Mes)

df232 <- df_mensual23.2 %>%
  group_by(Año = year(`fecha matriculación`), Mes = month(`fecha matriculación`)) %>%
  summarize(Turismos = n())
df232 <- df232 %>%
  arrange(Año, Mes)

df241 <- df_mensual24.1 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df241 <- df241 %>%
  arrange(Año, Mes)
df242 <- df_mensual24.2 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df242 <- df242 %>%
  arrange(Año, Mes)

df_mensual25 <- df_mensual25 %>%
  group_by(Año = year(fecha), Mes = month(fecha)) %>%
  summarize(Turismos = n())
df_mensual25 <- df_mensual25 %>%
  arrange(Año, Mes)

#unimos en un solo dataset los datos mensuales

df_mensual_agrupado <- bind_rows(df211, df212, df221, df222, df231, df232, df241, df242, df_mensual25)
df_mensual_agrupado <- df_mensual_agrupado %>%
  arrange(Año, Mes)

## ============================================================
## 0) Exploración previa (EDA rápida) - antes de limpiar/transformar
##    - Pensado para datos grandes: usa muestra aleatoria reproducible
## ============================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(stringr)
})

# ---- Configuración de muestreo (elige una estrategia) ----
set.seed(123)            # reproducibilidad
SAMPLE_N    <- 200000    # nº filas a muestrear (recomendado para df_mensual_agrupado)
SAMPLE_FRAC <- NULL      # alternativa: fracción (p.ej. 0.05). Si usas FRAC, pon SAMPLE_N <- NULL

# ---- Funciones auxiliares ----
is_blank_chr <- function(x) {
  # TRUE si es NA o cadena vacía/solo espacios (solo aplica a character/factor)
  if (is.factor(x)) x <- as.character(x)
  if (!is.character(x)) return(rep(FALSE, length(x)))
  is.na(x) | str_trim(x) == ""
}

quick_profile <- function(df, df_name = deparse(substitute(df)), sample_n = SAMPLE_N, sample_frac = SAMPLE_FRAC) {
  
  n_total <- nrow(df)
  
  # Muestra aleatoria (si no hay muchas filas, usa todo)
  df_s <- df
  if (!is.null(sample_frac) && is.numeric(sample_frac) && sample_frac > 0 && sample_frac < 1) {
    df_s <- df %>% slice_sample(prop = sample_frac)
  } else if (!is.null(sample_n) && is.numeric(sample_n) && sample_n > 0 && n_total > sample_n) {
    df_s <- df %>% slice_sample(n = sample_n)
  }
  
  n_sample <- nrow(df_s)
  
  # ---- Resumen global ----
  na_total <- sum(is.na(df_s))
  dup_rows <- sum(duplicated(df_s))
  
  # Blancos solo en columnas tipo character/factor
  blank_total <- 0L
  char_cols <- names(df_s)[vapply(df_s, function(x) is.character(x) || is.factor(x), logical(1))]
  if (length(char_cols) > 0) {
    blank_total <- sum(vapply(df_s[char_cols], function(x) sum(is_blank_chr(x)), numeric(1)))
  }
  
  cat("\n============================================================\n")
  cat("EDA rápida:", df_name, "\n")
  cat("Filas totales:", format(n_total, big.mark = "."), "\n")
  cat("Filas analizadas (muestra):", format(n_sample, big.mark = "."), "\n")
  cat("Columnas:", ncol(df_s), "\n")
  cat("NAs en muestra:", format(na_total, big.mark = "."), "\n")
  cat("Blancos (''/espacios) en muestra (solo char/factor):", format(blank_total, big.mark = "."), "\n")
  cat("Filas duplicadas (muestra):", format(dup_rows, big.mark = "."), "\n")
  cat("============================================================\n\n")
  
  # ---- Perfil por columna ----
  prof <- tibble(
    columna = names(df_s),
    clase   = vapply(df_s, function(x) paste(class(x), collapse = ","), character(1)),
    n_na    = vapply(df_s, function(x) sum(is.na(x)), numeric(1)),
    pct_na  = round(100 * n_na / n_sample, 3),
    n_blank = vapply(df_s, function(x) sum(is_blank_chr(x)), numeric(1)),
    pct_blank = round(100 * n_blank / n_sample, 3),
    n_unicos = vapply(df_s, function(x) dplyr::n_distinct(x, na.rm = TRUE), numeric(1))
  ) %>%
    arrange(desc(pct_na), desc(pct_blank))
  
  # Top 20 columnas con más NA/blank
  cat("Top columnas con más NA/blank (muestra):\n")
  print(head(prof, 20))
  
  # ---- Resúmenes específicos para numéricas ----
  num_cols <- names(df_s)[vapply(df_s, is.numeric, logical(1))]
  if (length(num_cols) > 0) {
    num_sum <- df_s %>%
      summarise(across(all_of(num_cols), list(
        min = ~ suppressWarnings(min(.x, na.rm = TRUE)),
        p25 = ~ suppressWarnings(quantile(.x, 0.25, na.rm = TRUE, names = FALSE)),
        med = ~ suppressWarnings(median(.x, na.rm = TRUE)),
        p75 = ~ suppressWarnings(quantile(.x, 0.75, na.rm = TRUE, names = FALSE)),
        max = ~ suppressWarnings(max(.x, na.rm = TRUE))
      ), .names = "{.col}__{.fn}"))
    
    cat("\nResumen numéricas (muestra):\n")
    print(num_sum)
  }
  
  # ---- Distribución rápida de fechas (si hay Date/POSIX) ----
  date_cols <- names(df_s)[vapply(df_s, function(x) inherits(x, c("Date", "POSIXct", "POSIXt")), logical(1))]
  if (length(date_cols) > 0) {
    date_sum <- df_s %>%
      summarise(across(all_of(date_cols), list(
        min = ~ suppressWarnings(min(.x, na.rm = TRUE)),
        max = ~ suppressWarnings(max(.x, na.rm = TRUE))
      ), .names = "{.col}__{.fn}"))
    
    cat("\nRango columnas fecha (muestra):\n")
    print(date_sum)
  }
  
  # Devuelve lista útil por si quieres guardarla
  invisible(list(sample = df_s, profile = prof))
}


# ---- Ejecuta EDA rápida (especialmente útil en df_mensual_agrupado) ----
# Ejemplo:
eda_mensual <- quick_profile(df_mensual_agrupado, "df_mensual_agrupado")

#Validación de serie anual-------------
## ============================================================
## EDA rápida - df_anual (antes de limpiar/transformar)
## ============================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(stringr)
})

# ---- Configuración de muestreo (df_anual suele ser más pequeño) ----
set.seed(123)
SAMPLE_N_ANUAL <- 50000   # ajusta si df_anual es pequeño/grande
SAMPLE_FRAC_ANUAL <- NULL # alternativa: p.ej. 0.2 (20%). Si usas FRAC, pon SAMPLE_N_ANUAL <- NULL

# ---- Auxiliar: detectar blancos en texto ----
is_blank_chr <- function(x) {
  if (is.factor(x)) x <- as.character(x)
  if (!is.character(x)) return(rep(FALSE, length(x)))
  is.na(x) | str_trim(x) == ""
}

# ---- Perfilado rápido ----
quick_profile_anual <- function(df_anual,
                                df_name = "df_anual",
                                sample_n = SAMPLE_N_ANUAL,
                                sample_frac = SAMPLE_FRAC_ANUAL) {
  
  n_total <- nrow(df_anual)
  
  # 1) Muestreo (si procede)
  df_s <- df_anual
  if (!is.null(sample_frac) && is.numeric(sample_frac) && sample_frac > 0 && sample_frac < 1) {
    df_s <- df_anual %>% slice_sample(prop = sample_frac)
  } else if (!is.null(sample_n) && is.numeric(sample_n) && sample_n > 0 && n_total > sample_n) {
    df_s <- df_anual %>% slice_sample(n = sample_n)
  }
  
  n_sample <- nrow(df_s)
  
  # 2) Métricas globales
  na_total <- sum(is.na(df_s))
  dup_rows <- sum(duplicated(df_s))
  
  char_cols <- names(df_s)[vapply(df_s, function(x) is.character(x) || is.factor(x), logical(1))]
  blank_total <- if (length(char_cols) > 0) {
    sum(vapply(df_s[char_cols], function(x) sum(is_blank_chr(x)), numeric(1)))
  } else 0L
  
  cat("\n============================================================\n")
  cat("EDA rápida:", df_name, "\n")
  cat("Filas totales:", format(n_total, big.mark = "."), "\n")
  cat("Filas analizadas (muestra):", format(n_sample, big.mark = "."), "\n")
  cat("Columnas:", ncol(df_s), "\n")
  cat("NAs en muestra:", format(na_total, big.mark = "."), "\n")
  cat("Blancos (''/espacios) en muestra (solo char/factor):", format(blank_total, big.mark = "."), "\n")
  cat("Filas duplicadas (muestra):", format(dup_rows, big.mark = "."), "\n")
  cat("============================================================\n\n")
  
  # 3) Perfil por columna
  prof <- tibble(
    columna = names(df_s),
    clase   = vapply(df_s, function(x) paste(class(x), collapse = ","), character(1)),
    n_na    = vapply(df_s, function(x) sum(is.na(x)), numeric(1)),
    pct_na  = round(100 * n_na / n_sample, 3),
    n_blank = vapply(df_s, function(x) sum(is_blank_chr(x)), numeric(1)),
    pct_blank = round(100 * n_blank / n_sample, 3),
    n_unicos = vapply(df_s, function(x) dplyr::n_distinct(x, na.rm = TRUE), numeric(1))
  ) %>%
    arrange(desc(pct_na), desc(pct_blank))
  
  cat("Top columnas con más NA/blank (muestra):\n")
  print(head(prof, 20))
  
  # 4) Resumen numéricas (rangos y cuantiles)
  num_cols <- names(df_s)[vapply(df_s, is.numeric, logical(1))]
  if (length(num_cols) > 0) {
    num_sum <- df_s %>%
      summarise(across(all_of(num_cols), list(
        min = ~ suppressWarnings(min(.x, na.rm = TRUE)),
        p25 = ~ suppressWarnings(quantile(.x, 0.25, na.rm = TRUE, names = FALSE)),
        med = ~ suppressWarnings(median(.x, na.rm = TRUE)),
        p75 = ~ suppressWarnings(quantile(.x, 0.75, na.rm = TRUE, names = FALSE)),
        max = ~ suppressWarnings(max(.x, na.rm = TRUE))
      ), .names = "{.col}__{.fn}"))
    
    cat("\nResumen numéricas (muestra):\n")
    print(num_sum)
  }
  
  # 5) Rango de fechas (si hay Date/POSIX)
  date_cols <- names(df_s)[vapply(df_s, function(x) inherits(x, c("Date", "POSIXct", "POSIXt")), logical(1))]
  if (length(date_cols) > 0) {
    date_sum <- df_s %>%
      summarise(across(all_of(date_cols), list(
        min = ~ suppressWarnings(min(.x, na.rm = TRUE)),
        max = ~ suppressWarnings(max(.x, na.rm = TRUE))
      ), .names = "{.col}__{.fn}"))
    
    cat("\nRango columnas fecha (muestra):\n")
    print(date_sum)
  }
  
  # 6) Devuelve objetos útiles para trazabilidad
  invisible(list(sample = df_s, profile = prof))
}

# ---- Ejecuta EDA rápida para df_anual ----
eda_anual <- quick_profile_anual(df_anual, "df_anual")

# ============================================================
# Visualización descriptivos (AJUSTADO A TU SCRIPT)
#   - df_mensual_agrupado: Año, Mes, Turismos
#   - df_anual / df_anual_electrico: Turismos (y otras cols si existen)
#   - Indicadores: opcional si existe df_indicadores
# ============================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(ggplot2)
  library(lubridate)
  library(scales)
  library(patchwork)
})

# ---------- helpers ----------
library(ggplot2)
library(dplyr)
library(scales)
library(gridExtra)

graficar_descriptivos <- function(data, variable, fecha = NULL) {
  
  var_name <- deparse(substitute(variable))
  
  if (is.null(fecha)) {
    df <- data %>%
      dplyr::select(all_of(var_name)) %>%
      dplyr::filter(!is.na(.data[[var_name]]))
  } else {
    fecha_name <- deparse(substitute(fecha))
    df <- data %>%
      dplyr::select(all_of(c(var_name, fecha_name))) %>%
      dplyr::filter(!is.na(.data[[var_name]]))
  }

  # Asegurar que la variable es numérica (puede venir como character)
  df[[var_name]] <- as.numeric(df[[var_name]])
  df <- df %>% dplyr::filter(!is.na(.data[[var_name]]))

  # Tema común profesional para descriptivos
  tema_desc <- theme_minimal(base_size = 12) +
    theme(
      plot.title       = element_text(face = "bold", size = 13, hjust = 0.5,
                                      color = "#1a1a2e", margin = margin(b = 6)),
      plot.subtitle    = element_text(size = 10, hjust = 0.5, color = "grey45"),
      axis.title       = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
      axis.text        = element_text(size = 9, color = "grey30"),
      panel.grid.minor = element_blank(),
      panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
      plot.background  = element_rect(fill = "white", color = NA)
    )

  p1 <- ggplot(df, aes(x = .data[[var_name]])) +
    geom_histogram(
      aes(y = after_stat(density)),
      bins = 25,
      fill = "#2980B9",
      color = "white",
      linewidth = 0.3,
      alpha = 0.85
    ) +
    geom_density(color = "#1a5276", linewidth = 0.9, alpha = 0) +
    labs(
      title = paste("Histograma de", var_name),
      x = var_name,
      y = "Densidad"
    ) +
    tema_desc

  p2 <- ggplot(df, aes(x = "", y = .data[[var_name]])) +
    geom_boxplot(
      fill     = "#AED6F1",
      color    = "#1a5276",
      width    = 0.4,
      outlier.color = "#E74C3C",
      outlier.alpha = 0.5,
      outlier.size  = 1.5
    ) +
    stat_summary(fun = mean, geom = "point", shape = 18,
                 size = 3.5, color = "#E74C3C") +
    labs(
      title = paste("Boxplot de", var_name),
      x = NULL,
      y = var_name
    ) +
    tema_desc

  p3 <- ggplot(df, aes(x = .data[[var_name]])) +
    geom_density(
      fill      = "#2980B9",
      alpha     = 0.2,
      color     = "#1a5276",
      linewidth = 1
    ) +
    geom_rug(alpha = 0.15, color = "#1a5276") +
    labs(
      title = paste("Densidad de", var_name),
      x = var_name,
      y = "Densidad"
    ) +
    tema_desc

  if (!is.null(fecha)) {
    p4 <- ggplot(df, aes(x = .data[[fecha_name]], y = .data[[var_name]])) +
      geom_area(fill = "#2980B9", alpha = 0.12) +
      geom_line(color = "#1a5276", linewidth = 0.8) +
      geom_point(color = "#1a5276", size = 1.2, alpha = 0.7) +
      labs(
        title = paste("Evolución temporal de", var_name),
        x = "Fecha",
        y = var_name
      ) +
      scale_y_continuous(labels = comma) +
      tema_desc +
      theme(axis.text.x = element_text(angle = 45, hjust = 1))

    grid.arrange(p1, p2, p3, p4, ncol = 2)
  } else {
    grid.arrange(
      p1, p2,
      p3,
      ncol    = 2,
      layout_matrix = rbind(c(1, 2),
                            c(3, 3))
    )
  }
}

#=============================================================
# DIARIO 
#=============================================================

# 1) Agrupar por día y contar

df_diario <- df_diario %>%
  filter(!is.na(fecha)) %>%
  group_by(fecha) %>%
  summarise(recuento = n(), .groups = "drop") %>%
  arrange(fecha)

print(df_diario)


# ============================================================
# 1) MENSUAL (df_mensual_agrupado: Año, Mes, Turismos)
# ============================================================

graficar_descriptivos(df_mensual_agrupado, Turismos)


# ============================================================
# 2) ANUAL (df_anual y df_anual_electrico)
#    En tu script usas df_anual$Turismos y df_anual_electrico$Turismos
# ============================================================

graficar_descriptivos(df_anual, Total)

# Extraer series anuales
sa_turismos <- df_anual$Turismos
sa_electricos <- df_anual_electrico$Turismos

# Definir series de tiempo (ts) especificando el año inicial y frecuenciaanual

ts_anual_turismos <- ts(sa_turismos, start = 1990, frequency = 1)
ts_anual_electricos <- ts(sa_electricos, start = 1990, frequency =
                            1)
ts_mensual_turismos <- ts(df_mensual_agrupado$Turismos, start = c(2021, 1),
                          frequency = 12)

ts_diario <- ts(df_diario$recuento, frequency = 7)

# ============================================================
# 2) DIARIO 
# ============================================================

graficar_descriptivos(df_diario, recuento)


#grafica df_anual
library(dplyr)
library(ggplot2)
library(scales)

df_anual_plot <- df_anual %>%
  mutate(
    Años = as.numeric(Años),
    Total = as.numeric(gsub(",", "", Total))
  ) %>%
  arrange(Años) %>%
  mutate(etiquetar = row_number() %% 3 == 1)

ggplot(df_anual_plot, aes(x = Años, y = Total)) +
  geom_area(fill = "#2980B9", alpha = 0.08) +
  geom_line(color = "#1a5276", linewidth = 0.9) +
  geom_point(color = "#1a5276", size = 2, alpha = 0.8) +
  geom_text(
    data = df_anual_plot %>% filter(etiquetar),
    aes(x = Años, y = Total, label = comma(Total)),
    vjust = -0.8, size = 2.8, color = "grey30",
    inherit.aes = FALSE
  ) +
  labs(
    title    = "Serie temporal anual de matriculaciones de turismos",
    subtitle = "España, 1990–2024",
    x = "Año", y = "Matriculaciones anuales",
    caption = "Fuente: elaboración propia a partir de datos de la DGT"
  ) +
  scale_x_continuous(breaks = pretty(df_anual_plot$Años, n = 8)) +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9.5, color = "grey30"),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

#grafica df_diario

library(dplyr)
library(ggplot2)
library(scales)

df_diario_plot <- df_diario %>%
  arrange(fecha) %>%
  mutate(
    etiquetar = row_number() %% 7 == 1
  )

d1 <- ggplot(df_diario_plot, aes(x = fecha, y = recuento)) +
  geom_area(fill = "#2980B9", alpha = 0.08) +
  geom_line(color = "#1a5276", linewidth = 0.5) +
  labs(
    title    = "Serie temporal diaria",
    subtitle = "Matriculaciones diarias de turismos",
    x = "Fecha", y = "Matriculaciones diarias",
    caption = "Fuente: elaboración propia"
  ) +
  scale_x_date(date_breaks = "3 months", date_labels = "%b %Y") +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 11) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9, color = "grey30"),
    axis.text.x   = element_text(angle = 45, hjust = 1),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )



#Gráfico df_mensual

library(ggplot2)
library(dplyr)
library(scales)

df_mensual_plot <- df_mensual_agrupado %>%
  mutate(
    Año = as.integer(Año),
    Mes = as.integer(Mes),
    Turismos = as.numeric(Turismos),
    fecha = as.Date(paste(Año, Mes, "1", sep = "-"))
  ) %>%
  arrange(fecha) %>%
  mutate(etiquetar = row_number() %% 3 == 1)

m1 <- ggplot(df_mensual_plot, aes(x = fecha, y = Turismos)) +
  geom_area(fill = "#E74C3C", alpha = 0.08) +
  geom_line(color = "#922B21", linewidth = 0.7) +
  geom_point(color = "#922B21", size = 1.2, alpha = 0.7) +
  labs(
    title    = "Serie temporal mensual",
    subtitle = "Matriculaciones mensuales de turismos",
    x = "Fecha", y = "Matriculaciones mensuales",
    caption = "Fuente: elaboración propia"
  ) +
  scale_x_date(date_breaks = "6 months", date_labels = "%b %Y") +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 11) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9, color = "grey30"),
    axis.text.x   = element_text(angle = 45, hjust = 1),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

#Análisis de los descriptivos

summary(ts_mensual_turismos)
summary(ts_diario)

#los datos anuales no se puede

#==========Análsis exploratorio y perioricidad================

#Análisis de perioricidad------
  ## -----perioricidad de la serie mensual-----

# Descomponer series mensuales y diarias para observar tendencia y estacionalidad
decomp_tur <- decompose(ts_mensual_turismos)
descom_di  <- decompose(ts_diario)
descomp_an <- decompose(ts_anual_turismos)

# Descomposición mensual — ggplot2
graficar_descomposicion <- function(decomp_obj, titulo_serie, unidad_x = "Tiempo") {
  n    <- length(decomp_obj$x)
  idx  <- seq_len(n)
  df_d <- data.frame(
    t         = idx,
    Observada = as.numeric(decomp_obj$x),
    Tendencia = as.numeric(decomp_obj$trend),
    Estacional = as.numeric(decomp_obj$seasonal),
    Residuo   = as.numeric(decomp_obj$random)
  ) %>%
    pivot_longer(-t, names_to = "Componente", values_to = "Valor") %>%
    mutate(Componente = factor(Componente,
                               levels = c("Observada", "Tendencia", "Estacional", "Residuo")))

  ggplot(df_d, aes(x = t, y = Valor)) +
    geom_line(color = "#1a5276", linewidth = 0.6) +
    facet_wrap(~ Componente, ncol = 1, scales = "free_y") +
    labs(title = paste("Descomposición —", titulo_serie),
         x = unidad_x, y = NULL,
         caption = "Fuente: elaboración propia") +
    theme_minimal(base_size = 11) +
    theme(
      plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
      strip.text    = element_text(face = "bold", size = 11, color = "#1a5276"),
      axis.text     = element_text(color = "grey30"),
      panel.grid.minor = element_blank(),
      plot.background  = element_rect(fill = "white", color = NA)
    )
}

p_decomp_mensual <- graficar_descomposicion(decomp_tur, "Serie mensual", "Mes")
p_decomp_diaria  <- graficar_descomposicion(descom_di,  "Serie diaria",  "Día")

ggsave("descomposicion_mensual.png", p_decomp_mensual, width = 9, height = 8, dpi = 300)
ggsave("descomposicion_diaria.png",  p_decomp_diaria,  width = 9, height = 8, dpi = 300)
p_decomp_mensual
p_decomp_diaria

library(stats)

#Cálculo de periodograma
#antes de calcular el periodograma, será necesario deshacer la tendencia mensual de la serie
##Test de Dickey fuller para detectar la estacionariedad (PARA VER SI HAY TENDENCIA)
library(tseries)
adf.test(ts_mensual_turismos)
adf.test(ts_diario)
adf.test(ts_anual_turismos)
##como el pvalor es de 0,013 (<0,05) la serie NO tiene tendencia

#test de KPSS 
kpss.test(ts_mensual_turismos)
kpss.test(ts_diario)
kpss.test(ts_anual_turismos)

#para el dataset mensual, no queda claro. Por lo que acudimos a analisis de FAC y FACP
library(forecast)

# FAC — ggplot2
acf_obj  <- Acf(ts_mensual_turismos, lag.max = 36, plot = FALSE)
df_acf   <- data.frame(lag = as.numeric(acf_obj$lag[-1]),
                        acf = as.numeric(acf_obj$acf[-1]))
ci_acf   <- qnorm(0.975) / sqrt(length(ts_mensual_turismos))

p_acf <- ggplot(df_acf, aes(x = lag, y = acf)) +
  geom_hline(yintercept = 0, color = "grey40", linewidth = 0.5) +
  geom_hline(yintercept =  ci_acf, linetype = "dashed", color = "#E74C3C", linewidth = 0.5) +
  geom_hline(yintercept = -ci_acf, linetype = "dashed", color = "#E74C3C", linewidth = 0.5) +
  geom_segment(aes(xend = lag, yend = 0), color = "#1a5276", linewidth = 0.7) +
  geom_point(color = "#2980B9", size = 2) +
  scale_x_continuous(breaks = seq(0, 36, by = 6)) +
  labs(title = "FAC — Serie mensual original",
       x = "Retardo", y = "Autocorrelación",
       caption = "Fuente: elaboración propia") +
  theme_minimal(base_size = 12) +
  theme(plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
        axis.title    = element_text(face = "bold", size = 10.5),
        axis.text     = element_text(color = "grey30"),
        panel.grid.minor = element_blank(),
        plot.background  = element_rect(fill = "white", color = NA))

# FACP — ggplot2
pacf_obj <- Pacf(ts_mensual_turismos, lag.max = 36, plot = FALSE)
df_pacf  <- data.frame(lag  = as.numeric(pacf_obj$lag),
                        pacf = as.numeric(pacf_obj$acf))

p_pacf <- ggplot(df_pacf, aes(x = lag, y = pacf)) +
  geom_hline(yintercept = 0, color = "grey40", linewidth = 0.5) +
  geom_hline(yintercept =  ci_acf, linetype = "dashed", color = "#E74C3C", linewidth = 0.5) +
  geom_hline(yintercept = -ci_acf, linetype = "dashed", color = "#E74C3C", linewidth = 0.5) +
  geom_segment(aes(xend = lag, yend = 0), color = "#1a5276", linewidth = 0.7) +
  geom_point(color = "#2980B9", size = 2) +
  scale_x_continuous(breaks = seq(0, 36, by = 6)) +
  labs(title = "FACP — Serie mensual original",
       x = "Retardo", y = "Autocorrelación parcial",
       caption = "Fuente: elaboración propia") +
  theme_minimal(base_size = 12) +
  theme(plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
        axis.title    = element_text(face = "bold", size = 10.5),
        axis.text     = element_text(color = "grey30"),
        panel.grid.minor = element_blank(),
        plot.background  = element_rect(fill = "white", color = NA))

library(patchwork)
p_acf + p_pacf + plot_layout(ncol = 2)
ggsave("fac_facp_mensual.png", p_acf + p_pacf, width = 12, height = 5, dpi = 300)


##el test da un pvalor de 0,01<0,05 hay tendencia para un nivel de significacion del 5%.
#No son concluyentes los test de hipótesis.
#el dataset diario claramente tiene tendencia

#NO PARECE QUE HAYA MUCHA TENDENCIA EN LA SERIE
dts_mensual_turismos <- diff(ts_mensual_turismos, differences=1)
dts_anual_turismos <- diff(ts_anual_turismos, differences = 1)
dts_diario <- diff(ts_diario, differences = 1)

#Grafico df_diario diferenciado
library(dplyr)
library(ggplot2)
library(scales)

df_diario_diff_plot <- df_diario %>%
  arrange(fecha) %>%
  mutate(
    recuento_diff = recuento - lag(recuento)
  ) %>%
  filter(!is.na(recuento_diff)) %>%
  mutate(
    etiquetar = row_number() %% 3 == 1
  )

d2 <- ggplot(df_diario_diff_plot, aes(x = fecha, y = recuento_diff)) +
  geom_hline(yintercept = 0, color = "grey50", linewidth = 0.5, linetype = "dashed") +
  geom_line(color = "#1a5276", linewidth = 0.5) +
  labs(
    title    = "Serie temporal diaria diferenciada",
    subtitle = "Cambio diario en matriculaciones",
    x = "Fecha", y = "Diferencia diaria",
    caption = "Fuente: elaboración propia"
  ) +
  scale_x_date(date_breaks = "3 months", date_labels = "%b %Y") +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 11) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9, color = "grey30"),
    axis.text.x   = element_text(angle = 45, hjust = 1),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )


library(patchwork)
d1 + d2 + plot_layout(ncol = 2)

#Grafico df_anual diferenciado
library(dplyr)
library(ggplot2)
library(scales)

df_anual_diff_plot <- df_anual %>%
  mutate(
    Turismos = as.numeric(Turismos),
    year = seq(1990, by = 1, length.out = n())
  ) %>%
  arrange(year) %>%
  mutate(
    turismos_diff = Turismos - lag(Turismos)
  ) %>%
  filter(!is.na(turismos_diff)) %>%
  mutate(
    etiquetar = row_number() %% 2 == 1
  )

a2 <- ggplot(df_anual_diff_plot, aes(x = year, y = turismos_diff)) +
  geom_hline(yintercept = 0, color = "grey50", linewidth = 0.5, linetype = "dashed") +
  geom_line(color = "#1a5276", linewidth = 0.9) +
  geom_point(color = "#1a5276", size = 2, alpha = 0.8) +
  geom_text(
    data = df_anual_diff_plot %>% filter(etiquetar),
    aes(x = year, y = turismos_diff, label = comma(turismos_diff)),
    vjust = -0.8, size = 2.8, color = "grey30",
    check_overlap = TRUE, inherit.aes = FALSE
  ) +
  labs(
    title    = "Serie temporal anual diferenciada",
    subtitle = "Variación interanual en matriculaciones",
    x = "Año", y = "Diferencia anual",
    caption = "Fuente: elaboración propia"
  ) +
  scale_x_continuous(
    breaks = seq(min(df_anual_diff_plot$year), max(df_anual_diff_plot$year), by = 3)
  ) +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9.5, color = "grey30"),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

a2

#Grafico df_mensual diferenciado
library(dplyr)
library(ggplot2)
library(scales)
library(patchwork)

# 2. Serie mensual diferenciada

library(ggplot2)
library(dplyr)
library(scales)

df_mensual_diff_plot <- df_mensual_agrupado %>%
  mutate(
    Año = as.integer(Año),
    Mes = as.integer(Mes),
    Turismos = as.numeric(Turismos),
    fecha = as.Date(paste(Año, Mes, "1", sep = "-"))
  ) %>%
  arrange(fecha) %>%
  mutate(
    Turismos_diff = Turismos - lag(Turismos)
  ) %>%
  filter(!is.na(Turismos_diff)) %>%
  mutate(
    etiquetar = row_number() %% 6 == 1
  )

m2 <- ggplot(df_mensual_diff_plot, aes(x = fecha, y = Turismos_diff)) +
  geom_hline(yintercept = 0, color = "grey50", linewidth = 0.5, linetype = "dashed") +
  geom_line(color = "#922B21", linewidth = 0.7) +
  geom_point(color = "#922B21", size = 1.2, alpha = 0.7) +
  labs(
    title    = "Serie temporal mensual diferenciada",
    subtitle = "Cambio mensual en matriculaciones",
    x = "Fecha", y = "Diferencia mensual",
    caption = "Fuente: elaboración propia"
  ) +
  scale_x_date(date_breaks = "1 year", date_labels = "%Y") +
  scale_y_continuous(labels = comma) +
  theme_minimal(base_size = 11) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", size = 10.5, color = "#1a1a2e"),
    axis.text     = element_text(size = 9, color = "grey30"),
    axis.text.x   = element_text(angle = 45, hjust = 1),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

# 3. Mostrar ambos gráficos

library(gridExtra)
grid.arrange(m1, m2, ncol = 2)

#Compts_anual_turismos#Comparemos el periodograma de la serie original frente a la diferenciada, para así poder ver si existe
#grandes variaciones entre una y otra.

# Los periodogramas de Fourier se generan con ggplot2 más abajo (secciones g1/g2)


##Tras la diferenciación, el gran pico en frecuencia baja desaparece, lo que confirma que esa energía provenía de la tendencia.

library(TSA)
par(mfrow = c(1, 1))
p <- periodogram(ts_mensual_turismos, log="no")
peak.freq <- p$freq[which.max(p$spec)] # frecuencia del pico principal
peak.freq

#lo mismo pero con la diaria:
p2 <- periodogram(ts_diario, log="no")
peak.freq2 <- p2$freq[which.max(p$spec)] # frecuencia del pico principal
peak.freq2
1/peak.freq2
#la frecuencia da: 

#aplicamos esta funcion que devuelve el periodograma tambien, pero usamos esta porque la funcion
# devuelve un objeto cuyos componentes $freq(vector de frecuencias) y $spec (potencia espectral) pueden inspeccionarse

p$freq
p$spec

#Esto le dará la frecuencia donde ocurre el mayor pico del periodograma. Luego puede obtener el
#periodo en unidades de la serie con 1/peak.freq .

1/peak.freq
#EL PERIODO MENSUAL DE LA SERIE ES DE : 6 MESES

##Análisis profundo de peridograma del df_diario------------
# Ordenar datos
df_diario <- df_diario %>%
  arrange(fecha)

# Serie numérica
y <- df_diario$recuento

# Quitar NA si los hubiera
y <- na.omit(y)
# Centramos la serie para el análisis espectral
y_centered <- y - mean(y, na.rm = TRUE)

# Periodograma
spec <- spectrum(y_centered, log = "no", plot = FALSE)

# Data frame del espectro
df_spec <- data.frame(
  frecuencia = spec$freq,
  espectro = spec$spec
) %>%
  mutate(
    periodo_dias = 1 / frecuencia
  )

# Gráfico del espectro en función del periodo
g1 <- ggplot(df_spec %>% filter(periodo_dias <= 400), 
       aes(x = periodo_dias, y = espectro)) +
  geom_line(linewidth = 0.8, color = "#2C4E6B") +
  labs(
    title = "Análisis de Fourier de la serie diaria",
    subtitle = "Periodograma para detectar estacionalidades dominantes",
    x = "Periodo estimado (días)",
    y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title = element_text(face = "bold", size = 15, hjust = 0.5),
    plot.subtitle = element_text(size = 11, hjust = 0.5, color = "gray35"),
    plot.caption = element_text(size = 9, color = "gray45"),
    axis.title = element_text(face = "bold"),
    axis.text = element_text(color = "gray20"),
    panel.grid.minor = element_blank(),
    panel.border = element_rect(color = "gray40", fill = NA, linewidth = 0.8),
    plot.background = element_rect(fill = "white", color = NA),
    panel.background = element_rect(fill = "white", color = NA)
  )
g2 <- ggplot(df_spec %>% filter(periodo_dias <= 400),
       aes(x = periodo_dias, y = espectro)) +
  geom_area(fill = "#2980B9", alpha = 0.1) +
  geom_line(linewidth = 0.8, color = "#1a5276") +
  geom_vline(xintercept = 7,      linetype = "dashed", color = "#E74C3C", linewidth = 0.6) +
  geom_vline(xintercept = 30.4,   linetype = "dashed", color = "#27AE60", linewidth = 0.6) +
  geom_vline(xintercept = 365.25, linetype = "dashed", color = "#8E44AD", linewidth = 0.6) +
  annotate("text", x = 7,      y = Inf, label = "7 d",   vjust = 1.5, size = 3, color = "#E74C3C", fontface = "bold") +
  annotate("text", x = 30.4,   y = Inf, label = "30 d",  vjust = 1.5, size = 3, color = "#27AE60", fontface = "bold") +
  annotate("text", x = 365.25, y = Inf, label = "365 d", vjust = 1.5, size = 3, color = "#8E44AD", fontface = "bold") +
  labs(
    title    = "Análisis de Fourier de la serie diaria",
    subtitle = "Detección de ciclos semanales, mensuales y anuales",
    x = "Periodo estimado (días)", y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", color = "#1a1a2e"),
    axis.text     = element_text(color = "grey30"),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

library(patchwork)
g1 + g2 + plot_layout(ncol = 2)

#periodos dominantes:
top_periodos <- df_spec %>%
  filter(periodo_dias >= 2, periodo_dias <= 400) %>%
  arrange(desc(espectro)) %>%
  slice(1:10) %>%
  mutate(
    periodo_dias = round(periodo_dias, 2),
    periodo_label = paste0(periodo_dias, " días")
  )

##graficamos los top_periodos:
ggplot(top_periodos,
       aes(x = reorder(periodo_label, espectro), y = espectro)) +
  geom_col(fill = "#2980B9", width = 0.65, alpha = 0.85) +
  geom_text(
    aes(label = format(round(espectro, 1), big.mark = ".")),
    hjust = -0.1, size = 3.5, color = "grey25"
  ) +
  coord_flip() +
  labs(
    title    = "Periodos dominantes de la serie diaria",
    subtitle = "Top 10 periodos con mayor potencia espectral",
    x = NULL, y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  expand_limits(y = max(top_periodos$espectro) * 1.18) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title       = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle    = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption     = element_text(size = 8.5, color = "grey50"),
    axis.title       = element_text(face = "bold", size = 11, color = "#1a1a2e"),
    axis.text        = element_text(size = 10, color = "grey30"),
    panel.grid.minor   = element_blank(),
    panel.grid.major.y = element_blank(),
    panel.grid.major.x = element_line(color = "grey90", linewidth = 0.3),
    plot.background    = element_rect(fill = "white", color = NA)
  )

##Análisis profundo de peridograma del df_mensual------------
library(dplyr)
library(ggplot2)
library(patchwork)

# =========================================================
# 1. Preparación de la serie mensual
# =========================================================
df_mensual_spec <- df_mensual_agrupado %>%
  mutate(
    Año = as.integer(Año),
    Mes = as.integer(Mes),
    Turismos = as.numeric(Turismos),
    fecha = as.Date(paste(Año, Mes, "1", sep = "-"))
  ) %>%
  arrange(fecha)

# Serie numérica
y <- df_mensual_spec$Turismos

# Quitar NA si los hubiera
y <- na.omit(y)

# Centramos la serie para el análisis espectral
y_centered <- y - mean(y, na.rm = TRUE)

# =========================================================
# 2. Periodograma
# =========================================================
spec <- spectrum(y_centered, log = "no", plot = FALSE)

# Data frame del espectro
df_spec <- data.frame(
  frecuencia = spec$freq,
  espectro = spec$spec
) %>%
  mutate(
    periodo_meses = 1 / frecuencia
  )

# =========================================================
# 3. Gráfico del espectro
# =========================================================
g1 <- ggplot(df_spec %>% filter(periodo_meses <= 60),
             aes(x = periodo_meses, y = espectro)) +
  geom_line(linewidth = 0.9, color = "#8B0000") +
  labs(
    title = "Análisis de Fourier de la serie mensual",
    subtitle = "Periodograma para detectar estacionalidades dominantes",
    x = "Periodo estimado (meses)",
    y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title = element_text(face = "bold", size = 15, hjust = 0.5),
    plot.subtitle = element_text(size = 11, hjust = 0.5, color = "gray35"),
    plot.caption = element_text(size = 9, color = "gray45"),
    axis.title = element_text(face = "bold"),
    axis.text = element_text(color = "gray20"),
    panel.grid.minor = element_blank(),
    panel.border = element_rect(color = "gray40", fill = NA, linewidth = 0.8),
    plot.background = element_rect(fill = "white", color = NA),
    panel.background = element_rect(fill = "white", color = NA)
  )

g2 <- ggplot(df_spec %>% filter(periodo_meses <= 60),
             aes(x = periodo_meses, y = espectro)) +
  geom_area(fill = "#E74C3C", alpha = 0.1) +
  geom_line(linewidth = 0.9, color = "#922B21") +
  geom_vline(xintercept = 3,  linetype = "dashed", color = "#E67E22", linewidth = 0.6) +
  geom_vline(xintercept = 6,  linetype = "dashed", color = "#27AE60", linewidth = 0.6) +
  geom_vline(xintercept = 12, linetype = "dashed", color = "#2980B9", linewidth = 0.6) +
  geom_vline(xintercept = 24, linetype = "dashed", color = "#8E44AD", linewidth = 0.6) +
  annotate("text", x = 3,  y = Inf, label = "3 m",  vjust = 1.5, size = 3, color = "#E67E22", fontface = "bold") +
  annotate("text", x = 6,  y = Inf, label = "6 m",  vjust = 1.5, size = 3, color = "#27AE60", fontface = "bold") +
  annotate("text", x = 12, y = Inf, label = "12 m", vjust = 1.5, size = 3, color = "#2980B9", fontface = "bold") +
  annotate("text", x = 24, y = Inf, label = "24 m", vjust = 1.5, size = 3, color = "#8E44AD", fontface = "bold") +
  labs(
    title    = "Análisis de Fourier de la serie mensual",
    subtitle = "Detección de ciclos trimestrales, semestrales, anuales y bianuales",
    x = "Periodo estimado (meses)", y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption  = element_text(size = 8.5, color = "grey50"),
    axis.title    = element_text(face = "bold", color = "#1a1a2e"),
    axis.text     = element_text(color = "grey30"),
    panel.grid.minor = element_blank(),
    panel.grid.major = element_line(color = "grey90", linewidth = 0.3),
    plot.background  = element_rect(fill = "white", color = NA)
  )

g1 + g2 + plot_layout(ncol = 2)

# =========================================================
# 4. Periodos dominantes
# =========================================================
top_periodos <- df_spec %>%
  filter(periodo_meses >= 2, periodo_meses <= 60) %>%
  arrange(desc(espectro)) %>%
  slice(1:10) %>%
  mutate(
    periodo_meses = round(periodo_meses, 2),
    periodo_label = paste0(periodo_meses, " meses")
  )

print(top_periodos)

# =========================================================
# 5. Gráfico de top periodos
# =========================================================
ggplot(top_periodos,
       aes(x = reorder(periodo_label, espectro), y = espectro)) +
  geom_col(fill = "#E74C3C", width = 0.65, alpha = 0.85) +
  geom_text(
    aes(label = format(round(espectro, 1), big.mark = ".")),
    hjust = -0.1, size = 3.5, color = "grey25"
  ) +
  coord_flip() +
  labs(
    title    = "Periodos dominantes de la serie mensual",
    subtitle = "Top 10 periodos con mayor potencia espectral",
    x = NULL, y = "Potencia espectral",
    caption = "Fuente: elaboración propia"
  ) +
  expand_limits(y = max(top_periodos$espectro) * 1.18) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title       = element_text(face = "bold", size = 14, hjust = 0.5, color = "#1a1a2e"),
    plot.subtitle    = element_text(size = 10.5, hjust = 0.5, color = "grey45"),
    plot.caption     = element_text(size = 8.5, color = "grey50"),
    axis.title       = element_text(face = "bold", size = 11, color = "#1a1a2e"),
    axis.text        = element_text(size = 10, color = "grey30"),
    panel.grid.minor   = element_blank(),
    panel.grid.major.y = element_blank(),
    panel.grid.major.x = element_line(color = "grey90", linewidth = 0.3),
    plot.background    = element_rect(fill = "white", color = NA)
  )
#----------------Modelado de series con TBATS-----------------

#1)Ajustar modelos TBATS para cada serie-----------
#comfirmar que estamos ante una serie univariada,
is.ts(ts_anual_turismos)        # debe devolver TRUE
length(dim(ts_anual_turismos))  # debe devolver NULL o 1

any(is.na(ts_anual_turismos))
ts_anual_turismos <- na.interp(ts_anual_turismos)  # interpola usando forecast
str(ts_anual_turismos)
ts_anual_turismos <- ts(as.numeric(ts_anual_turismos), start = 1990, frequency = 1)

is.ts(ts_anual_electricos)        # debe devolver TRUE
length(dim(ts_anual_electricos))  # debe devolver NULL o 1

any(is.na(ts_anual_electricos))
ts_anual_electricos <- na.interp(ts_anual_electricos)  # interpola usando forecast
str(ts_anual_electricos)
ts_anual_electricos <- ts(as.numeric(ts_anual_electricos), start = 1990, frequency = 1)


library(forecast)

tbats_anual_tur <- tbats(ts_anual_turismos)
tbats_anual_elec <- tbats(ts_anual_electricos)
tbats_mensual_tur <- tbats(ts_mensual_turismos)

#2)Resumen de los modelos ajustados (opcional, para ver parámetros elegidos)-----------
summary(tbats_anual_tur)
summary(tbats_mensual_tur)


#Como en el análsis del periodograma nos salia que la serie tiene un periodo de 6 meses, mientras que el TBATS esta otorgando una estacionalidad
#de 12, veamos que modelo tiene menos AIC, uno con estacionalidad de 6 o 12 meses: 


tbats_mensual_tur_6 <- tbats(ts_mensual_turismos,
                             seasonal.periods = 6)
tbats_mensual_tur_6_12 <- tbats(ts_mensual_turismos,
                                seasonal.periods = c(6, 12))


tbats_mensual_tur$AIC          # AIC del modelo original

tbats_mensual_tur_6$AIC        # si has ajustado un modelo con periodo 6
tbats_mensual_tur_6_12$AIC     # modelo con periodos 6 y 12, por ejemplo

#En términos prácticos: el patrón de 6 meses que vi en el periodograma no es lo bastante fuerte/estable (con solo 3 años de datos) 
#como para que TBATS lo incluya cuando se le pide “optimizarse solo”.


#3)Obtener predicciones a 5 años (anual) y 2 años (mensual),(h=5 para anual -> 2025-2029, h=24 para mensual -> 24 meses = 2 años)-----
pron_tbats_anual_tur <- forecast(tbats_anual_tur, h = 5)
pron_tbats_anual_elec <- forecast(tbats_anual_elec, h = 5)
pron_tbats_mensual_tur <- forecast(tbats_mensual_tur, h = 24)

# Inspeccionar resultados de ejemplo
summary(pron_tbats_anual_tur)
summary(pron_tbats_mensual_tur)

##3.1)Graficar los resultados del pronóstico-----
plot(pron_tbats_anual_tur, 
     main = "Pronóstico TBATS: Turismos Anuales",
     xlab = "Año", ylab = "Matriculaciones",
     col = "blue", flty = 2)  # flty define tipo de línea para bandas de confianza


# Graficar los resultados del pronóstico
plot(pron_tbats_anual_elec, 
     main = "Pronóstico TBATS: Turismos eléctricos Anuales",
     xlab = "Año", ylab = "Matriculaciones",
     col = "red", flty = 2)  # flty define tipo de línea para bandas de confianza

# Graficar los resultados del pronóstico
plot(pron_tbats_mensual_tur, 
     main = "Pronóstico TBATS: Turismos mensuales",
     xlab = "Año", ylab = "Matriculaciones",
     col = "orange", flty = 2)  # flty define tipo de línea para bandas de confianza
#4)Validación del modelo TBATS-------------

train <- window(ts_mensual_turismos, end = c(2024, 12))
fit_tbats <- tbats(train)

# Pronóstico de 24 meses (enero–diciembre 2026)
fc_2025_2026 <- forecast(fit_tbats, h = 24)
# Datos reales disponibles: enero–dic 2025
real_2025 <- window(ts_mensual_turismos,
                    start = c(2025, 1),
                    end   = c(2025, 12))

length(real_2025)   # debería ser 10

# Predicciones TBATS para esos mismos meses:
# usamos solo los 10 primeros valores del forecast
pred_2025_2026 <- as.numeric(fc_2025_2026$mean[1:length(real_2025)])

##4.1)RMSE enero–octubre 2025-----
RMSE_2025_parcial <- sqrt(mean((pred_2025_2026 - as.numeric(real_2025))^2))
RMSE_2025_parcial
MAE_2025_parcial  <- mean(abs(pred_2025_2026 - as.numeric(real_2025)))
MAPE_2025_parcial <- mean(abs(pred_2025_2026 - as.numeric(real_2025)) / as.numeric(real_2025)) * 100

c(RMSE = RMSE_2025_parcial,
  MAE  = MAE_2025_parcial,
  MAPE = MAPE_2025_parcial)

accuracy(tbats_mensual_tur)   # te da, entre otras cosas, el RMSE in-sample
accuracy(fit_tbats)
#comparemos los valores de RMSE con la media de matriculaciones mensuales..
mean(ts_mensual_turismos)


#Por un lado tenemos un RMSE cuando incluimos 2025 en el TBATS de 12949, si excluimos 2025 y lo ponemos como test
#el RMSE pasa a ser de 22684,06 (SIGNIFICATIVA LA SUBIDA) esto significa que el comportamiento de 2025 es outlier.
#El RMSE del modelo sin tener en cuenta 2025 es de 9212

##4.2)Comparacion valores reales vs valores predichos----------------

# 1. Serie completa mensual (2021–2025, con 2025 ene–oct reales)
# Asegúrate de que ts_mensual_turismos empieza en 2021-01 y freq = 12
# ts_mensual_turismos <- ts(..., start = c(2021, 1), frequency = 12)

# 2. Entrenamos TBATS solo con datos hasta dic-2024
train <- window(ts_mensual_turismos, end = c(2024, 12))
fit_tbats <- tbats(train)

# 3. Pronóstico de 24 meses (enero–diciembre 2026)
fc_2025_2026 <- forecast(fit_tbats, h = 24)

#. Serie del modelo: fitted (2021–2024) + forecast (2025)
fitted_vals <- as.numeric(fitted(fit_tbats))          # valores ajustados 2021–2024
pred_2025_2026    <- as.numeric(fc_2025_2026$mean)              # pronóstico 2025 (12 meses)

model_series <- ts(c(fitted_vals, pred_2025_2026),
                   start     = start(train),          # 2021-01
                   frequency = frequency(ts_mensual_turismos))

###4.2.1)5. Gráfico comparando real (naranja) vs modelo TBATS (rojo)----
plot(ts_mensual_turismos,
     col  = "orange",
     lwd  = 2,
     xlab = "Año",
     ylab = "Matriculaciones",
     main = "Serie real vs modelo TBATS (2021–2025)")

lines(model_series,
      col = "red",
      lwd = 2,
      lty = 2)

legend("topleft",
       legend = c("Serie real", "TBATS (ajuste + pronóstico)"),
       col    = c("orange", "red"),
       lty    = c(1, 2),
       lwd    = 2,
       bty    = "n")

library(forecast)
acc_tbats <- accuracy(tbats_mensual_tur)
acc_snaive <- accuracy(snaive(ts_mensual_turismos))

acc_tbats
acc_snaive

##TBATS es claramente mejor que un modelo simple que solo repite el dato del mismo mes del año anterior.
##4.3)Análisis de residuos TBATS------

#manera rápida, pero con gráficos poco llamativos
checkresiduals(tbats_mensual_tur)
checkresiduals(tbats_anual_tur)

#manera manual: Análisis de residuos

###4.3.1)Estudio de los residuos del dataset mensual (ruido blanco)-----

residuos_mensuales <- residuals(tbats_mensual_tur)
mean(residuos_mensuales)

#miro si la varianza es constante
var(residuos_mensuales)

# Gráfico de residuos en el tiempo
plot(residuos_mensuales, type = "l", col = "blue", main = "Residuos del TBATS mensual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)
# Agregar una ventana móvil para ver la varianza cambiante
library(zoo)
lines(rollapply(residuos_mensuales^2, width = 20, FUN = mean, align = "right"), col = "red")

#Prueba de Ljung Box (para saber si están corraladas)

Box.test(residuals(tbats_mensual_tur), type="Ljung-Box")
## pvalor = 0,86>>0,05 (se acepta H0) --> los residuos nos estan autocorrelacionados
# Graficar los residuos
par(mfrow = c(2,2))  # Dividir la pantalla en 2x2 gráficos

# Gráfico de residuos en el tiempo
plot(residuos_mensuales, type = "l", col = "blue", main = "Residuos del TBATS mensual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)

# Histograma de residuos
# Histograma de residuos en densidad
hist(residuos_mensuales,
     freq = FALSE,                # muy importante: densidad, no frecuencias
     col = "lightblue",
     main = "Histograma de Residuos",
     xlab = "Residuos",
     breaks = 20)

# Secuencia de x para dibujar la curva
x <- seq(min(residuos_mensuales, na.rm = TRUE),
         max(residuos_mensuales, na.rm = TRUE),
         length.out = 200)

# Curva normal con misma media y sd que los residuos
curve_norm <- dnorm(x,
                    mean = mean(residuos_mensuales, na.rm = TRUE),
                    sd   = sd(residuos_mensuales, na.rm = TRUE))

# Añadir la curva en rojo
lines(x, curve_norm, col = "red", lwd = 2)

# Gráfico QQ-plot para ver normalidad
qqnorm(residuos_mensuales, main = "QQ-Plot de Residuos")
qqline(residuos_mensuales, col = "red")

# ACF de residuos (para ver autocorrelación)
acf(residuos_mensuales, main = "ACF de Residuos")

Box.test(residuos_mensuales)
shapiro.test(residuos_mensuales)

###4.3.2)Estudio de los residuos del dataset anual (ruido blanco)-----

residuos_anuales <- residuals(tbats_anual_tur)
mean(residuos_anuales)

#miro si la varianza es constante
var(residuos_anuales)

# Gráfico de residuos en el tiempo
plot(residuos_anuales, type = "l", col = "blue", main = "Residuos del TBATS anual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)
# Agregar una ventana móvil para ver la varianza cambiante
library(zoo)
lines(rollapply(residuos_anuales^2, width = 20, FUN = mean, align = "right"), col = "red")

#Prueba de Ljung Box (para saber si están corraladas)

Box.test(residuals(tbats_anual_tur), type="Ljung-Box")
##pvalor = 0,8522 >> 0,05 (se acepta H0) --> los residuos no están autocorrelacionados
# Graficar los residuos
par(mfrow = c(2,2))  # Dividir la pantalla en 2x2 gráficos

# Gráfico de residuos en el tiempo
plot(residuos_anuales, type = "l", col = "blue", main = "Residuos del TBATS anual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)

# Histograma de residuos
# Histograma de residuos en densidad
hist(residuos_anuales,
     freq = FALSE,                # muy importante: densidad, no frecuencias
     col = "lightblue",
     main = "Histograma de Residuos",
     xlab = "Residuos",
     breaks = 20)

# Secuencia de x para dibujar la curva
x <- seq(min(residuos_anuales, na.rm = TRUE),
         max(residuos_anuales, na.rm = TRUE),
         length.out = 200)

# Curva normal con misma media y sd que los residuos
curve_norm <- dnorm(x,
                    mean = mean(residuos_anuales, na.rm = TRUE),
                    sd   = sd(residuos_anuales, na.rm = TRUE))

# Añadir la curva en rojo
lines(x, curve_norm, col = "red", lwd = 2)

# Gráfico QQ-plot para ver normalidad
qqnorm(residuos_anuales, main = "QQ-Plot de Residuos")
qqline(residuos_anuales, col = "red")

# ACF de residuos (para ver autocorrelación)
acf(residuos_anuales, main = "ACF de Residuos")

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


# Extraemos el valor de la predicción de Prophet para marzo de 2026
fc_prophet %>%
  filter(ds == as.Date("2026-03-01")) %>%
  pull(yhat)

###4.3.3)Estudio de los residuos de Prophet (ruido blanco)-----

residuos_prophet <- df_prophet_train_fitted$residuo
mean(residuos_prophet)

# Varianza de los residuos
var(residuos_prophet)

# Gráfico de residuos en el tiempo
plot(residuos_prophet, type = "l", col = "blue",
     main = "Residuos del Prophet mensual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)
# Ventana móvil para ver la varianza cambiante
library(zoo)
lines(rollapply(residuos_prophet^2, width = 12, FUN = mean, align = "right"), col = "red")

# Prueba de Ljung-Box (para saber si están autocorrelados)
Box.test(residuos_prophet, type = "Ljung-Box")

# Graficar los residuos
par(mfrow = c(2,2))

# Gráfico de residuos en el tiempo
plot(residuos_prophet, type = "l", col = "blue",
     main = "Residuos del Prophet mensual", ylab = "Residuos", xlab = "Tiempo")
abline(h = 0, col = "red", lty = 2)

# Histograma de residuos en densidad
hist(residuos_prophet,
     freq = FALSE,
     col = "lightblue",
     main = "Histograma de Residuos",
     xlab = "Residuos",
     breaks = 20)

# Secuencia de x para dibujar la curva
x <- seq(min(residuos_prophet, na.rm = TRUE),
         max(residuos_prophet, na.rm = TRUE),
         length.out = 200)

# Curva normal con misma media y sd que los residuos
curve_norm <- dnorm(x,
                    mean = mean(residuos_prophet, na.rm = TRUE),
                    sd   = sd(residuos_prophet, na.rm = TRUE))

# Añadir la curva en rojo
lines(x, curve_norm, col = "red", lwd = 2)

# Gráfico QQ-plot para ver normalidad
qqnorm(residuos_prophet, main = "QQ-Plot de Residuos Prophet")
qqline(residuos_prophet, col = "red")

# ACF de residuos (para ver autocorrelación)
acf(residuos_prophet, main = "ACF de Residuos Prophet")

# Shapiro-Wilk (normalidad)
shapiro.test(residuos_prophet)
Box.test(residuos_prophet)

#Series temporales por marca/lugar y ambas----------------------------------

library(dplyr)
library(lubridate)
library(tidyr)
library(ggplot2)
library(stringr)

# =========================================================
# 1) Unir todos los datasets mensuales en uno solo
# =========================================================

df_mensual_base <- bind_rows(
  df_mensual21.1,
  df_mensual21.2,
  df_mensual22.1,
  df_mensual22.2,
  df_mensual23.1,
  df_mensual23.2,
  df_mensual24.1,
  df_mensual24.2,
  df_mensual25
)

# =========================================================
# 2) Normalizar variables clave
# =========================================================

df_mensual_base <- df_mensual_base %>%
  mutate(
    fecha = as.Date(fecha),
    marca = as.character(marca),
    lugar = as.character(lugar)
  ) %>%
  filter(!is.na(fecha), !is.na(marca), str_trim(marca) != "") %>%
  mutate(
    marca = str_to_upper(str_trim(marca)),
    lugar = str_trim(lugar),
    fecha_mes = floor_date(fecha, "month"),
    Año = year(fecha_mes),
    Mes = month(fecha_mes)
  )

# =========================================================
# 3) Serie mensual TOTAL (todas las marcas)
# =========================================================

df_mensual_total <- df_mensual_base %>%
  group_by(fecha_mes, Año, Mes) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  arrange(fecha_mes)

# =========================================================
# 4) Serie mensual POR MARCA
# =========================================================

df_mensual_marca <- df_mensual_base %>%
  group_by(fecha_mes, Año, Mes, marca) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  arrange(fecha_mes, marca)

# =========================================================
# 5) Serie mensual POR MARCA/ LUGAR y ambas
# =========================================================
#df_mensual_marca
df_mensual_marca <- df_mensual_base %>%
  group_by(fecha_mes, Año, Mes, marca) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  arrange(fecha_mes, marca)

#df_mensual_marca_lugar
df_mensual_marca_lugar <- df_mensual_base %>%
  filter(!is.na(lugar), lugar != "") %>%
  group_by(fecha_mes, Año, Mes, marca, lugar) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  arrange(fecha_mes, marca, lugar)

#=========================================================
# 6) Gráfico de df_mensual_marca (para BMW, Mercedes...)
#=========================================================

df_grafico <- df_mensual_marca %>%
  filter(marca %in% c("BMW", "MERCEDES-BENZ", "AUDI", "VOLKSWAGEN")) %>%
  arrange(fecha_mes)

ggplot(df_grafico, aes(x = fecha_mes, y = matriculaciones, color = marca)) +
  geom_line(linewidth = 1.35) +
  scale_color_manual(values = c(
    "BMW" = "#0066B1",
    "MERCEDES-BENZ" = "#8E9499",
    "AUDI" = "#8B1E3F",
    "VOLKSWAGEN" = "#004B6B"
  )) +
  scale_x_date(date_breaks = "4 months", date_labels = "%b %Y") +
  scale_y_continuous(labels = label_number(big.mark = ".", decimal.mark = ",")) +
  labs(
    title = "Matriculaciones mensuales por marca",
    subtitle = "Comparativa de demanda en marcas premium y generalistas",
    x = NULL,
    y = "Matriculaciones",
    color = NULL
  ) +
  theme_classic(base_size = 13) +
  theme(
    plot.title = element_text(face = "bold", size = 16, color = "#1F1F1F"),
    plot.subtitle = element_text(size = 11, color = "#5C5C5C"),
    axis.text.x = element_text(angle = 45, hjust = 1, color = "#444444"),
    axis.text.y = element_text(color = "#444444"),
    axis.title.y = element_text(face = "bold"),
    legend.position = "top",
    legend.text = element_text(size = 11),
    legend.margin = margin(b = 5),
    panel.border = element_blank()
  )

#Ahora creamos csv reales+predicciones-------------------------------
library(dplyr)
library(lubridate)
library(readr)

# =========================================================
# 1) Serie real mensual total
# =========================================================
# Asegúrate de que ts_mensual_turismos empieza en 2021-01 y tiene frequency = 12

fechas_reales <- seq.Date(
  from = as.Date("2021-01-01"),
  by = "month",
  length.out = length(ts_mensual_turismos)
)

df_real_mensual_total <- data.frame(
  fecha_mes = fechas_reales,
  real = as.numeric(ts_mensual_turismos)
)

# =========================================================
# 2) Predicción TBATS 2025 y atrás
# =========================================================
# fc_2025 ya lo tienes creado con:
# fc_2025 <- forecast(fit_tbats, h = 12)

fechas_pred <- seq.Date(
  from = as.Date("2021-01-01"),
  by = "month",
  length.out = length(model_series)
)

df_pred_mensual_total <- data.frame(
  fecha_mes = fechas_pred,
  prediccion = as.numeric(model_series)
)

# =========================================================
# 3) Unir reales + predicción
# =========================================================
df_real_pred_mensual_total <- full_join(
  df_real_mensual_total,
  df_pred_mensual_total,
  by = "fecha_mes"
) %>%
  arrange(fecha_mes) %>%
  mutate(
    tipo_periodo = case_when(
      !is.na(real) & is.na(prediccion) ~ "Histórico",
      !is.na(real) & !is.na(prediccion) ~ "Histórico + predicción",
      is.na(real) & !is.na(prediccion) ~ "Predicción",
      TRUE ~ "Sin dato"
    )
  )


#Guardamos dataset para la web--------------------------

ruta1 <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_mensual_marca.csv"
ruta2 <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_mensual_marca_lugar.csv"
ruta3 <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_mensual_agrupado.csv"
ruta4 <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_muni_completo.csv"

write.csv(df_mensual_marca, ruta1, row.names = FALSE)
write.csv(df_mensual_marca_lugar, ruta2, row.names = FALSE)
write.csv(df_mensual_agrupado, ruta3, row.names = FALSE)
write.csv(df_muni_completo, ruta4, row.names = FALSE)
write_csv(
  df_mapa_densidad,
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_mapa_densidad.csv"
)
write_csv(
  df_real_pred_mensual_total,
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_real_pred_mensual_total.csv"
)


#5)Mapa de calor de España con las predicciones obtenidas-----------
library(mapSpain)
library(ggplot2)
library(dplyr)

# Shapefile de municipios
map_muni <- esp_get_munic()    # objeto sf con municipios

names(map_muni)  # para ver cómo se llaman las columnas
# normalmente hay algo como "name" (nombre municipio) y "prov.name" (provincia)


#7)Mapa de España datos reales evolutivo-----------
##Cremos las tablas que necesitamos: usaremos los datos df_mensual25, pero eliminaremos la columna de bastidor
df_mensual25 <- df_mensual25[, -3]

library(dplyr)
library(lubridate)

df_muni_mensual <- df_mensual25 %>%
  mutate(
    fecha = as.Date(fecha),
    año   = year(fecha),
    mes   = month(fecha)
  ) %>%
  group_by(lugar, año, mes) %>%
  summarise(
    matriculaciones = n(),
    .groups = "drop"
  ) %>%
  arrange(lugar, año, mes) %>%
  mutate(
    fecha = as.Date(sprintf("%d-%02d-01", año, mes))
  )
map_muni <- map_muni %>%
  mutate(
    muni_id  = paste0(ine.prov.name, "_", name),  # ID único
    muni_UP  = toupper(name)                     # nombre en mayúsculas
  )
df_muni_mensual <- df_muni_mensual %>%
  mutate(muni_UP = toupper(lugar))

# Tabla simple municipio–ID (sin geometría)
library(sf)
muni_ref <- map_muni %>%
  st_drop_geometry() %>%
  select(muni_id, muni_UP)

df_muni_mensual_id <- df_muni_mensual %>%
  left_join(muni_ref, by = "muni_UP") %>%
  filter(!is.na(muni_id))   # quitamos los que no han matcheado
library(dplyr)

muni_ids <- unique(df_muni_mensual_id$muni_id)
fechas   <- sort(unique(df_muni_mensual_id$fecha))

grid_muni_fecha <- expand.grid(
  muni_id = muni_ids,
  fecha   = fechas,
  stringsAsFactors = FALSE
)

df_muni_full <- grid_muni_fecha %>%
  left_join(
    df_muni_mensual_id %>%
      select(muni_id, fecha, matriculaciones),
    by = c("muni_id", "fecha")
  ) %>%
  mutate(
    matriculaciones = ifelse(is.na(matriculaciones), 0, matriculaciones)
  )

map_muni_base <- map_muni %>%
  select(muni_id, LAU_CODE, name, geometry)

map_real_muni <- map_muni_base %>%
  left_join(df_muni_full, by = "muni_id")

library(ggplot2)
library(gganimate)
library(dplyr)
library(ggplot2)
library(RColorBrewer)

# Usamos cuantiles para definir cortes
qs <- quantile(map_real_muni$matriculaciones,
               probs = c(0, 0.5, 0.75, 0.9, 0.99, 1),
               na.rm = TRUE)

map_real_muni <- map_real_muni %>%
  mutate(
    cat_mat = cut(
      matriculaciones,
      breaks = qs,
      include.lowest = TRUE,
      dig.lab = 6
    )
  )

p_real_muni <- ggplot(map_real_muni) +
  geom_sf(aes(fill = cat_mat, group = muni_id), color = NA) +
  scale_fill_brewer(
    palette = "YlOrRd",
    name    = "Matriculaciones\n(cuantiles)"
  ) +
  labs(
    title    = "Matriculaciones reales por municipio 2025",
    subtitle = "Clases por cuantiles (más contraste)"
  ) +
  theme_minimal() +
  theme(
    axis.title = element_blank(),
    axis.text  = element_blank()
  )
p_real_muni

ggsave(
  filename = "mapa_matriculaciones_reales_municipio_2025.png",
  plot = p_real_muni,
  path = "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Análisis",
  width = 8,
  height = 6,
  dpi = 300
)


#--------------------Matriculaciones vs poblacion--------------------------
#El mapa de matriculaciones se parece mucho al mapa de densidad poblacional en España
#Tiene sentido, pues a mayor poblacion es más probable que haya mas matriculaciones.
#Vamos a sacar un ratio: que sea igual a: Matriculaciones / población. Este ratio debe mantenerse 
#dentro de lo posible constante por municipio...

library(mapSpain)
library(sf)
library(dplyr)

#1)Tabla de referencia de municipios (sin geometría)-------
map_real_muni <- map_real_muni %>%
  mutate(
    cod_ine = sprintf("%05s", as.character(LAU_CODE))  # por si acaso
  ) %>%
  select(cod_ine, name, fecha, matriculaciones, geometry)

unique(map_real_muni$cod_ine[1:10])
nchar(map_real_muni$cod_ine[1])


#creamos el dataset poblacion del INE

library(dplyr)
library(tidyverse)

#2)Dataset poblacion por municipio----------------
pobla_muni <- read_excel("~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Población por municipio- INE.xlsx")

pobla_muni_clean <- pobla_muni %>%
  rename(
    cod_raw   = cod_ine,     # <-- NOMBRE REAL DE LA COLUMNA DE CÓDIGO
    poblacion = Población   # <-- NOMBRE REAL DE LA COLUMNA DE POBLACIÓN
  ) %>%
  mutate(
    # pasamos a integer y forzamos SIEMPRE 5 dígitos
    cod_ine = sprintf("%05d", as.integer(cod_raw))
  ) %>%
  select(cod_ine, poblacion)

unique(pobla_muni_clean$cod_ine[1:10])
nchar(pobla_muni_clean$cod_ine[1])

length(unique(map_real_muni$cod_ine))
length(unique(pobla_muni_clean$cod_ine))

length(
  intersect(unique(map_real_muni$cod_ine),
            unique(pobla_muni_clean$cod_ine))
)

#3)unimos ambas tablas------------
map_real_muni <- map_real_muni %>%
  left_join(pobla_muni_clean, by = "cod_ine")
summary(map_real_muni$poblacion)

#4)creamos el ratio mat/pob-------------
map_real_muni <- map_real_muni %>%
  mutate(
    ratio_mat_pob = ifelse(!is.na(poblacion) & poblacion > 0,
                           matriculaciones / poblacion,
                           NA_real_),
    ratio_x1000 = ratio_mat_pob * 1000
  )
#5)graficamos matriculaciones por 100o habitantes--------------

p_1000hab <- ggplot(map_real_muni) +
  geom_sf(aes(fill = ratio_x1000), color = NA) +
  scale_fill_viridis_c(option = "magma", trans = "log10",
                       name = "Matriculaciones\npor 1.000 hab.") +
  theme_minimal()

ggsave(
  filename = "matriculaciones por 1000 habitantes.png",
  plot = p_1000hab,
  path = "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Análisis",
  width = 8,
  height = 6,
  dpi = 300
)



#6)desarrollo ratio: mat/pob---------
#veamos el ratio matriculaciones/ poblacion. matriculaciones/Poblacion = ratio.Podemos reescribir esta formula de la forma: mat = alpha*poblacion + error
#Si las matriculaciones dependen enteramente de la poblacion, entonces el error será bajo, y tenderá a 0 para la mayoria de municipios (E(error)=0)

##6.1)descripcion de matriculacion (de un municipio) como relacion lineal con la poblacion de ese municipio----------
#donde mat(i) = theta1*pob(i) + error(i), matriculaciones de un municipio i es igual a su poblacion por alpha más el término de error...
#Calculemos esto, si las matriculaciones se explican enteramente por la poblacion de cierto municipio, su error serás: E(e)=0; var(e)= cte; Cov(ei,ej)=0

#filtramos antes por el mes de octubre
df_muni <- map_real_muni %>%
  filter(fecha == as.Date("2025-10-01")) %>%   # octubre 2025                     # ¡IMPORTANTE! quitar geometry
  select(municipio = name,
         poblacion,
         matriculaciones, ratio_x1000) %>%
  mutate(
    poblacion        = as.numeric(poblacion),
    matriculaciones  = as.numeric(matriculaciones)
  )
#Dataset mapa densidad de matriculaciones para todo 2025...
df_mapa_densidad <- map_real_muni %>%
  st_drop_geometry() %>%
  transmute(
    cod_ine = as.character(cod_ine),
    municipio = as.character(name),
    fecha = as.Date(fecha),
    matriculaciones = as.numeric(matriculaciones),
    ratio_x1000 = as.numeric(ratio_x1000)
  ) %>%
  arrange(fecha, municipio)

#para la web necesitamos el componente Geografico
library(sf)

class(df_mapa_densidad)
class(map_real_muni)
library(sf)

st_write(
  map_real_muni,
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/Web dashboard/public/espana.geojson",
  delete_dsn = TRUE
)
names(map_real_muni)
head(map_real_muni)
sort(unique(map_real_muni$name))[1:50]
library(readr)

df_mapa_densidad <- read_csv(
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_mapa_densidad.csv"
)
sort(unique(df_mapa_densidad$municipio))[1:50]
setdiff(sort(unique(df_mapa_densidad$municipio)), sort(unique(map_real_muni$name)))
setdiff(sort(unique(map_real_muni$name)), sort(unique(df_mapa_densidad$municipio)))

# Modelo matric = theta1 * poblacion + error
mod_lin1 <- lm(matriculaciones ~ 0 + poblacion, data = df_muni)

summary(mod_lin1)
#veamos los residuos del modelo
residuos_modlin1 <- residuals(mod_lin1)
summary(residuos_modlin1)

checkresiduals(mod_lin1)
#veamos los municipios de cuyos residuos se alejan mas

# Residuos estandarizados
df_muni$resid_std1 <- rstandard(mod_lin1)

# Top 20 municipios con mayor desviación (en valor absoluto)
df_top <- df_muni %>%
  arrange(desc(abs(resid_std1))) %>%
  slice(1:20)

df_top <- df_top %>%
  st_drop_geometry()
df_top

mean(df_muni$ratio_x1000)

##los residuos del modelo lineal1 que más se alejan más altos, son los correspondientes a estos municipios:
## Alcobendas, Majadahonda, Venturada, Boadilla del monte...
##¿Por qué estos lugares?
##coincide que estos municipios son los mas ricos de España!!!
#Por ello deberiamos añadir una variable de RENTA a nuestro modelo. 
#Vamos a hacer ambos modelos (incluyendo Renta para todos los municipios y solo Renta a los municipios con mas ricos), y vemos los residuos de ambos modelos...

##No he encontrado datos de PIB por municipio (sería lo ideal), voy a usar datos de PIB por provincia..
##6.2)descripcion de matriculaciones como regresion de pob y renta-------

library(readxl)
library(dplyr)
library(stringi)


ruta_pib <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/PIB provincia - INE.xlsx"

df_pib_prov <- read_excel(ruta_pib, sheet = 2)
#eliminamos ciertas columnas
df_pib_prov <- df_pib_prov[, -c(18:21)]
df_pib_prov <- df_pib_prov[, -c(2, 6, 10, 14)]   # elimina columnas 2 y 4

#eliminamos filas
df_pib_prov <- df_pib_prov[-c(65:75), ]
df_pib_prov <- df_pib_prov[-c(2), ]

#renombramos encabezados
colnames(df_pib_prov) <- c("provincia", "Valor2020", "Indice2020", "TVI2020", "Valor 2021", "Indice2021", "TVI2021", "Valor 2022", "Indice2022", "TVI2022", "Valor 2023", "Indice2023", "TVI2023")

# Normalizamos provincia EN PIB con la MISMA función que usaremos luego
clean_name <- function(x) {
  x %>%
    stri_trans_general("Latin-ASCII") %>%  # quita tildes
    str_to_lower() %>%
    str_replace_all("[^a-z0-9 ]", " ") %>% # quita signos
    str_squish()
}
df_pib_prov <- df_pib_prov %>%
  mutate(
    provincia_key = clean_name(provincia),
    Indice2023 = parse_number(as.character(Indice2023))
  ) %>%
  select(provincia, provincia_key, Indice2023)

# --- Referencia municipal desde map_muni
map_muni_ref <- map_muni %>%
  st_drop_geometry() %>%
  transmute(
    municipio = name,             # ajusta si el campo se llama distinto
    provincia = ine.prov.name      # ajusta si el campo se llama distinto
    # ccaa = ine.ccaa.name         # si luego lo quieres
  ) %>%
  mutate(
    municipio_key = clean_name(municipio),
    provincia_key = clean_name(provincia),
    muni_prov_key = paste0(municipio_key, "||", provincia_key)
  )

# OJO: NO uses distinct(municipio_key) porque colapsa municipios homónimos.
# Si necesitas deduplicar, deduplica por muni_prov_key:
map_muni_ref <- map_muni_ref %>%
  distinct(muni_prov_key, .keep_all = TRUE)

# --- 1) Asignar provincia a df_muni (solo por nombre de municipio)
# Esto puede seguir siendo ambiguo si df_muni trae municipios repetidos sin provincia.
# Lo mejor es tener un código INE/ID. Si NO lo tienes, esto es lo máximo "razonable":

df_muni2 <- df_muni %>%
  mutate(municipio_key = clean_name(municipio)) %>%
  left_join(
    map_muni_ref %>% select(municipio_key, provincia, provincia_key),
    by = "municipio_key",
    relationship = "many-to-many"
  )

# Si te salen duplicados por homónimos, los verás aquí:
dups <- df_muni2 %>%
  count(municipio, municipio_key) %>%
  filter(n > 1)

# --- 2) Unir PIB provincial (por provincia_key ya normalizada)
df_muni2 <- df_muni2 %>%
  left_join(
    df_pib_prov %>% select(provincia_key, Indice2023),
    by = "provincia_key"
  )

# Diagnóstico rápido
df_muni2 %>%
  filter(is.na(provincia)) %>%
  count(municipio, sort = TRUE) %>%
  head(30)

df_muni2 %>%
  filter(!is.na(provincia) & is.na(Indice2023)) %>%
  count(provincia, sort = TRUE) %>%
  head(30)

#creamos la regresion lineal: matriculaciones = theta1*poblacion + theta2*Indice renta2023 + error

mod_lin2 <- lm(matriculaciones ~ 0 + poblacion + Indice2023, data = df_muni2)

summary(mod_lin2)
#veamos los residuos del modelo
residuos_modlin2 <- residuals(mod_lin2)
summary(residuos_modlin2)

checkresiduals(mod_lin2)
#veamos los municipios de cuyos residuos se alejan mas

mf <- model.frame(mod_lin2)  # data usada realmente por lm (ya sin NAs)
idx <- as.integer(rownames(mf))  # filas originales de df_muni2 que entraron al modelo

df_muni2$resid_std2 <- NA_real_
df_muni2$resid_std2[idx] <- rstandard(mod_lin2)

df_top2 <- df_muni2 %>%
  arrange(desc(abs(.data$resid_std2))) %>%
  slice(1:20) %>%
  st_drop_geometry()
##vamos a comparar los municipios con mayor error de ambos modelos
df_top
df_top2 %>%
  select(municipio, Indice2023, resid_std2)
##ahora los municipios mas ricos dejan de estar dentro de los municipios con mayor error..
##claramente los municipios con mayor error ahora tienen un error mas bajo...
summary(residuos_modlin1)
summary(residuos_modlin2)

#El modelo 2 parece mejor que el primero, vamos a añadir otra variable al modelo..
##6.3)descripcion de regresion añadiendo la edad del municipio-----

ruta_edad <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/edad por municipio-INE.xlsx"

edad_muni <- read_excel(ruta_edad)
colnames(edad_muni) <- c("municipio", "total", "menor18", "entre1865", "mayor65")

edad_muni <- edad_muni %>%
  mutate(
    municipio_key = clean_name(municipio),
    pct_menor18  = as.numeric(menor18),
    pct_18_65    = as.numeric(entre1865),
    pct_mayor65  = as.numeric(mayor65)
  ) %>%
  select(municipio_key, pct_menor18, pct_18_65, pct_mayor65)
#left join con dataset principal
view(df_muni2)
view(edad_muni)
df_muni3 <- df_muni2 %>%
  mutate(municipio_key = clean_name(municipio)) %>%
  left_join(edad_muni, by = "municipio_key")

#Creamos la regresion añadiendo esta variable:
mod_lin3 <- lm(
  matriculaciones ~ poblacion + Indice2023 +
    pct_18_65 + pct_mayor65,
  data = df_muni3
)

summary(mod_lin3)

#7) Estudio de autocorrelacion y multicolinealidad------------
library(dplyr)
library(car)      # vif
library(lmtest)   # dwtest, bptest
library(sandwich) # vcovHC
library(ggplot2)

# -------------------------------------------------
# 7.1) Dataset usado realmente por el modelo (sin NA), miramos el modelo 2
# -------------------------------------------------
mf2 <- model.frame(mod_lin2) 

# -------------------------------------------------
# 7.2) MULTICOLINEALIDAD: Correlación + VIF
# -------------------------------------------------

# Dataset del modelo 2 (solo observaciones usadas por lm)
mf2 <- model.frame(mod_lin2)

# (A) Matriz de correlación entre TODAS las variables numéricas,
#     incluyendo la variable objetivo: matriculaciones
vars_cor <- mf2 %>%
  dplyr::select(where(is.numeric))

cor_all <- cor(vars_cor, use = "complete.obs")
print(cor_all)

# Heatmap completo (incluye matriculaciones)
cor_long_all <- as.data.frame(as.table(cor_all))
names(cor_long_all) <- c("var1", "var2", "corr")

cor_long_all <- cor_long_all %>%
  mutate(diagonal = var1 == var2)

ggplot(cor_long_all, aes(var1, var2, fill = corr)) +
  geom_tile(aes(alpha = !diagonal), color = "white") +
  geom_tile(
    data = subset(cor_long_all, diagonal),
    fill = "#B22222", color = "grey"
  ) +
  geom_text(aes(label = sprintf("%.2f", corr)), size = 3, color = "black") +
  scale_fill_gradient2(low = "#2166AC", mid = "grey", high = "darkred", midpoint = 0) +
  scale_alpha_manual(values = c(`TRUE` = 1, `FALSE` = 1), guide = "none") +
  labs(title = "Correlación entre explicativas y variable objetivo") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1))

# (B) Correlación de cada explicativa con la variable objetivo
cor_objetivo <- vars_cor %>%
  dplyr::select(-matriculaciones) %>%
  summarise(across(
    everything(),
    ~ cor(.x, mf2$matriculaciones, use = "complete.obs")
  )) %>%
  pivot_longer(
    cols = everything(),
    names_to = "variable",
    values_to = "corr_con_matriculaciones"
  ) %>%
  arrange(desc(abs(corr_con_matriculaciones)))

print(cor_objetivo)

# Gráfico específico: correlación explicativas vs matriculaciones
ggplot(cor_objetivo,
       aes(x = reorder(variable, corr_con_matriculaciones),
           y = corr_con_matriculaciones)) +
  geom_col() +
  coord_flip() +
  geom_text(aes(label = sprintf("%.2f", corr_con_matriculaciones)),
            hjust = ifelse(cor_objetivo$corr_con_matriculaciones >= 0, -0.1, 1.1),
            size = 3) +
  labs(
    title = "Correlación de las variables explicativas con matriculaciones",
    x = NULL,
    y = "Correlación"
  ) +
  theme_minimal()

# (C) Matriz solo entre explicativas, por si la quieres mantener aparte
X <- mf2 %>%
  dplyr::select(-matriculaciones) %>%
  dplyr::select(where(is.numeric))

cor_X <- cor(X, use = "complete.obs")
print(cor_X)

cor_long <- as.data.frame(as.table(cor_X))
names(cor_long) <- c("var1", "var2", "corr")

ggplot(cor_long, aes(var1, var2, fill = corr)) +
  geom_tile() +
  geom_text(aes(label = sprintf("%.2f", corr)), size = 3) +
  labs(title = "Correlación entre variables explicativas") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1))

# (A') Matriz de correlación con densidad de matriculaciones (ratio_x1000)
#      en lugar de matriculaciones brutas
vars_cor_dens <- mf2 %>%
  dplyr::select(where(is.numeric)) %>%
  dplyr::select(-matriculaciones) %>%
  mutate(ratio_x1000 = df_muni2$ratio_x1000[as.integer(rownames(mf2))])

cor_all_dens <- cor(vars_cor_dens, use = "complete.obs")
print(cor_all_dens)

# Heatmap completo (incluye ratio_x1000)
cor_long_all_dens <- as.data.frame(as.table(cor_all_dens))
names(cor_long_all_dens) <- c("var1", "var2", "corr")

cor_long_all_dens <- cor_long_all_dens %>%
  mutate(diagonal = var1 == var2)

ggplot(cor_long_all_dens, aes(var1, var2, fill = corr)) +
  geom_tile(aes(alpha = !diagonal), color = "white") +
  geom_tile(
    data = subset(cor_long_all_dens, diagonal),
    fill = "#B22222", color = "grey"
  ) +
  geom_text(aes(label = sprintf("%.2f", corr)), size = 3, color = "black") +
  scale_fill_gradient2(low = "#2166AC", mid = "grey", high = "darkred", midpoint = 0) +
  scale_alpha_manual(values = c(`TRUE` = 1, `FALSE` = 1), guide = "none") +
  labs(title = "Correlación entre explicativas y densidad de matriculaciones (x1000 hab.)") +
  theme_minimal() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1))

# (B') Correlación de cada explicativa con ratio_x1000
cor_objetivo_dens <- vars_cor_dens %>%
  dplyr::select(-ratio_x1000) %>%
  summarise(across(
    everything(),
    ~ cor(.x, vars_cor_dens$ratio_x1000, use = "complete.obs")
  )) %>%
  pivot_longer(
    cols = everything(),
    names_to = "variable",
    values_to = "corr_con_ratio_x1000"
  ) %>%
  arrange(desc(abs(corr_con_ratio_x1000)))

print(cor_objetivo_dens)

# Gráfico específico: correlación explicativas vs ratio_x1000
ggplot(cor_objetivo_dens,
       aes(x = reorder(variable, corr_con_ratio_x1000),
           y = corr_con_ratio_x1000)) +
  geom_col() +
  coord_flip() +
  geom_text(aes(label = sprintf("%.2f", corr_con_ratio_x1000)),
            hjust = ifelse(cor_objetivo_dens$corr_con_ratio_x1000 >= 0, -0.1, 1.1),
            size = 3) +
  labs(
    title = "Correlación de las variables explicativas con densidad de matriculaciones",
    x = NULL,
    y = "Correlación"
  ) +
  theme_minimal()

# (D) VIF
vif_vals <- vif(mod_lin2)
print(vif_vals)

# -------------------------------------------------
# 7.3) AUTOCORRELACIÓN en residuos (temporal) - Durbin-Watson
# -------------------------------------------------
# IMPORTANTE: DW tiene sentido si los datos están ordenados en una dimensión temporal.
# En tu caso estás filtrando un único mes (2025-10-01), así que NO hay orden temporal real.
# Aun así, lo dejamos por completitud (pero interpreta con cautela).
dw <- dwtest(mod_lin2)
print(dw)

# -------------------------------------------------
# 7.4) Heterocedasticidad (muy habitual en municipal)
# -------------------------------------------------
bp <- bptest(mod_lin2)
print(bp)

# Si hay heterocedasticidad, usa errores robustos (para inferencia)
coefs_rob <- coeftest(mod_lin2, vcov = vcovHC(mod_lin3, type = "HC1"))
print(coefs_rob)

#---------------------------------
# 7.5)Autocorrelación espacial
#-----------------------------------

library(dplyr)
library(sf)
library(spdep)

# Base espacial para octubre 2025
sf_oct <- map_real_muni %>%
  filter(fecha == as.Date("2025-10-01")) %>%
  select(name, geometry, matriculaciones) %>%
  distinct(name, .keep_all = TRUE)

# Dataset explicativo (sin geometría y sin duplicados)
df_expl <- df_muni2 %>%
  st_drop_geometry() %>%
  select(municipio, poblacion, Indice2023) %>%
  distinct(municipio, .keep_all = TRUE)

# Join limpio
sf_oct <- sf_oct %>%
  left_join(df_expl, by = c("name" = "municipio")) %>%
  filter(!is.na(poblacion), !is.na(Indice2023))

#Reestimar Modelo 2 sobre el sf (alineado)

mod_sp2 <- lm(
  matriculaciones ~ 0 + poblacion + Indice2023,
  data = sf_oct
)

sf_oct$resid <- residuals(mod_sp2)

#Crear matriz de vecindad (contigüidad tipo Queen)
nb <- poly2nb(sf_oct, queen = TRUE)
lw <- nb2listw(nb, style = "W", zero.policy = TRUE)

#moran_res <- moran.test(sf_oct$resid, lw, zero.policy = TRUE)

moran_res <- moran.test(sf_oct$resid, lw, zero.policy = TRUE)
moran_res

#Cómo interpretar Moran's I

#I ≈ 0 → no hay autocorrelación espacial --> ESTE ES EL CASO
#I > 0 y p < 0.05 → residuos agrupados espacialmente
#I < 0 → patrón disperso
#Si sale significativo → el modelo 2 no captura toda la estructura espacial.

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


# ============================================================
# 02_CLUSTERING_MUNICIPIOS.R
# Segmentación de municipios por perfil de demanda automovilística
# TFG — Análisis de la demanda automovilística en España
# Asume que todos los objetos ya están cargados en la sesión
# ============================================================

library(dplyr)
library(ggplot2)
library(sf)
library(tidyr)
library(cluster)
library(stringr)

if (!requireNamespace("factoextra", quietly = TRUE)) install.packages("factoextra")
library(factoextra)

if (!requireNamespace("patchwork", quietly = TRUE)) install.packages("patchwork")
library(patchwork)

# ============================================================
# 2.1. PREPARACIÓN DEL DATASET DE CLUSTERING
# ============================================================

df_cluster_prep <- df_muni2 %>%
  st_drop_geometry() %>%
  filter(
    poblacion       > 0,
    matriculaciones >= 0,
    !is.na(ratio_x1000),
    !is.na(Indice2023)
  ) %>%
  # Eliminar duplicados por municipio_key generados por el join many-to-many
  # al construir df_muni2. Sin esto, municipios como "torrent" aparecen
  # varias veces con distinto Indice2023, inflando el conteo de clusters.
  distinct(municipio_key, .keep_all = TRUE)

# Log de población antes de estandarizar (reduce el efecto de ciudades muy grandes)
df_cluster_prep <- df_cluster_prep %>%
  mutate(log_poblacion = log(poblacion))

vars_escalar <- c("ratio_x1000", "log_poblacion", "Indice2023")

mat_scaled <- scale(df_cluster_prep[, vars_escalar])

# Identificador para joins posteriores
id_col <- if ("cod_ine" %in% names(df_cluster_prep)) "cod_ine" else "name"
id_col <- "municipio_key"

df_cluster_input <- df_cluster_prep %>%
  select(all_of(id_col)) %>%
  bind_cols(as.data.frame(mat_scaled))

cat(sprintf(
  "Dataset de clustering preparado: %d municipios, 3 variables estandarizadas.\n",
  nrow(df_cluster_input)
))

# ============================================================
# 2.2. DETERMINACIÓN DEL NÚMERO ÓPTIMO DE CLUSTERS
# ============================================================

X <- as.matrix(df_cluster_input[, vars_escalar])

# ---- a) Método del codo (WSS) ----

wss_vals <- sapply(2:10, function(k) {
  set.seed(123)
  kmeans(X, centers = k, nstart = 25)$tot.withinss
})

df_wss <- data.frame(k = 2:10, wss = wss_vals)

p_codo <- ggplot(df_wss, aes(x = k, y = wss)) +
  geom_line(color = "steelblue", linewidth = 1) +
  geom_point(color = "steelblue", size = 3) +
  scale_x_continuous(breaks = 2:10) +
  labs(
    title   = "Método del codo — WSS por número de clusters",
    x       = "Número de clusters (k)",
    y       = "Suma de cuadrados intra-cluster (WSS)",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12)

ggsave("clustering_codo.png", p_codo, width = 8, height = 6, dpi = 300)

# ---- b) Silueta media ----

sil_vals <- sapply(2:10, function(k) {
  set.seed(123)
  km  <- kmeans(X, centers = k, nstart = 25)
  sil <- silhouette(km$cluster, dist(X))
  mean(sil[, 3])
})

df_sil <- data.frame(k = 2:10, silueta = sil_vals)

p_sil <- ggplot(df_sil, aes(x = k, y = silueta)) +
  geom_line(color = "darkorange", linewidth = 1) +
  geom_point(color = "darkorange", size = 3) +
  scale_x_continuous(breaks = 2:10) +
  labs(
    title   = "Silueta media por número de clusters",
    x       = "Número de clusters (k)",
    y       = "Silueta media",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12)

ggsave("clustering_silueta.png", p_sil, width = 8, height = 6, dpi = 300)

# ---- c) Valores WSS y silueta para cada k ----
cat("\nWSS:\n")
for (k in 2:10) {
  set.seed(123)
  km <- kmeans(X, centers = k, nstart = 25)
  cat(sprintf("k=%d -> WSS=%.1f\n", k, km$tot.withinss))
}

cat("\nSilueta:\n")
d <- dist(X)
for (k in 2:10) {
  set.seed(123)
  km <- kmeans(X, centers = k, nstart = 25)
  s <- mean(silhouette(km$cluster, d)[, 3])
  cat(sprintf("k=%d -> Silueta=%.4f\n", k, s))
}

# ---- d) Elección de k ----
# Se elige k = 4: balance entre diferenciación de perfiles de negocio
# e interpretabilidad. El codo suele ser poco pronunciado en datos
# municipales heterogéneos; k=4 permite distinguir rural, periurbano,
# urbano y municipios atípicos sin fragmentar en exceso.
k_optimo <- 4

# ---- d) Resumen silueta + WSS para k = 3, 4, 5 ----
cat("\n===== COMPARATIVA SILUETA / WSS =====\n")
for (k in 3:5) {
  set.seed(123)
  km  <- kmeans(X, centers = k, nstart = 25)
  sil <- silhouette(km$cluster, dist(X))
  cat(sprintf("k=%d  |  Silueta media = %.4f  |  WSS = %.1f\n",
              k, mean(sil[, 3]), km$tot.withinss))
}

# ============================================================
# 2.3. K-MEANS CLUSTERING
# ============================================================

set.seed(123)
km_resultado <- kmeans(X, centers = k_optimo, nstart = 25, iter.max = 100)

# Añadir cluster al dataframe sin geometría
df_cluster_prep$cluster <- km_resultado$cluster

# Perfil de clusters (variables originales, sin estandarizar)
df_perfil_clusters <- df_cluster_prep %>%
  group_by(cluster) %>%
  summarise(
    n_municipios    = n(),
    ratio_x1000     = mean(ratio_x1000, na.rm = TRUE),
    poblacion_media = mean(poblacion,   na.rm = TRUE),
    Indice2023      = mean(Indice2023,  na.rm = TRUE),
    .groups = "drop"
  ) %>%
  arrange(cluster)

cat("\n===== PERFIL DE CLUSTERS =====\n")
print(df_perfil_clusters, digits = 3)

# ============================================================
# 2.4. CARACTERIZACIÓN DE CLUSTERS
# ============================================================

# ---- a) Heatmap de perfiles estandarizados ----

df_centros <- as.data.frame(km_resultado$centers)
colnames(df_centros) <- vars_escalar
df_centros$cluster   <- factor(1:k_optimo)

df_heatmap <- df_centros %>%
  pivot_longer(cols = all_of(vars_escalar), names_to = "variable", values_to = "valor")

p_heatmap <- ggplot(df_heatmap, aes(x = variable, y = cluster, fill = valor)) +
  geom_tile(color = "white", linewidth = 0.5) +
  geom_text(aes(label = round(valor, 2)), size = 3.5) +
  scale_fill_gradient2(
    low      = "#2166ac",
    mid      = "white",
    high     = "#d73027",
    midpoint = 0,
    name     = "Z-score"
  ) +
  scale_x_discrete(labels = c(
    "ratio_x1000"   = "Ratio x1000",
    "log_poblacion" = "log(Población)",
    "Indice2023"    = "Índice renta"
  )) +
  labs(
    title   = "Perfiles estandarizados por cluster",
    x       = "Variable",
    y       = "Cluster",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(axis.text.x = element_text(angle = 20, hjust = 1))

ggsave("clustering_heatmap_perfiles.png", p_heatmap, width = 8, height = 6, dpi = 300)

# ---- b) Boxplots ----

df_box <- df_cluster_prep %>%
  mutate(cluster = factor(cluster))

p_box1 <- ggplot(df_box, aes(x = cluster, y = ratio_x1000, fill = cluster)) +
  geom_boxplot(outlier.alpha = 0.3, show.legend = FALSE) +
  labs(title = "Ratio de matriculaciones (x1000 hab.)",
       x = "Cluster", y = "Matriculaciones / 1.000 hab.",
       caption = "Fuente: elaboración propia") +
  theme_minimal(base_size = 12)

p_box2 <- ggplot(df_box, aes(x = cluster, y = log(poblacion), fill = cluster)) +
  geom_boxplot(outlier.alpha = 0.3, show.legend = FALSE) +
  labs(title = "Tamaño de municipio (log población)",
       x = "Cluster", y = "log(Población)",
       caption = "Fuente: elaboración propia") +
  theme_minimal(base_size = 12)

p_box3 <- ggplot(df_box, aes(x = cluster, y = Indice2023, fill = cluster)) +
  geom_boxplot(outlier.alpha = 0.3, show.legend = FALSE) +
  labs(title = "Índice de renta provincial (2023)",
       x = "Cluster", y = "Índice de renta",
       caption = "Fuente: elaboración propia") +
  theme_minimal(base_size = 12)

p_boxplots <- p_box1 + p_box2 + p_box3 + plot_layout(ncol = 3)
ggsave("clustering_boxplots.png", p_boxplots, width = 14, height = 5, dpi = 300)

# ---- c) Nombres descriptivos ----
# Se asignan según los valores del df_perfil_clusters.
# El cluster con ratio extremadamente alto y población muy baja corresponde
# a municipios donde se registran vehículos de flotas/renting por domicilio
# fiscal de la empresa, no a demanda real de particulares.

# Asignación secuencial: se marca cada cluster por orden de prioridad
# y se excluyen los ya asignados para evitar que un cluster acapare
# varias condiciones (p.ej. Cluster 1 tiene max ratio Y max renta).
df_perfil_clusters$nombre_cluster <- NA_character_

# 1) Micromunicipios con efecto sede fiscal (ratio extremo + población muy baja)
idx <- which(
  df_perfil_clusters$ratio_x1000 == max(df_perfil_clusters$ratio_x1000) &
    df_perfil_clusters$poblacion_media < 1000 &
    is.na(df_perfil_clusters$nombre_cluster)
)
df_perfil_clusters$nombre_cluster[idx] <- "Micromunicipios con efecto sede fiscal"

# 2) Grandes nucleos urbanos (mayor población media de los restantes)
restantes <- which(is.na(df_perfil_clusters$nombre_cluster))
idx <- restantes[which.max(df_perfil_clusters$poblacion_media[restantes])]
df_perfil_clusters$nombre_cluster[idx] <- "Grandes nucleos urbanos"

# 3) Periurbanos de alto poder adquisitivo (mayor renta de los restantes)
restantes <- which(is.na(df_perfil_clusters$nombre_cluster))
idx <- restantes[which.max(df_perfil_clusters$Indice2023[restantes])]
df_perfil_clusters$nombre_cluster[idx] <- "Periurbanos de alto poder adquisitivo"

# 4) El resto → rural / baja demanda
df_perfil_clusters$nombre_cluster[is.na(df_perfil_clusters$nombre_cluster)] <-
  "Municipios rurales de baja demanda"

cat("\n===== PERFIL FINAL CON NOMBRES =====\n")
print(
  df_perfil_clusters %>%
    select(cluster, nombre_cluster, n_municipios, ratio_x1000, poblacion_media, Indice2023),
  digits = 3
)

# Join con df_muni3 (sf) por id_col — se usa df_muni2 como base ya que el clustering
# se preparó desde df_muni2 (sin variables demográficas incompletas)
df_muni3_cluster <- df_muni2 %>%
  left_join(
    df_cluster_prep %>% select(all_of(id_col), cluster),
    by = id_col
  )

# Propagar nombre_cluster al sf
df_muni3_cluster <- df_muni3_cluster %>%
  left_join(
    df_perfil_clusters %>% select(cluster, nombre_cluster),
    by = "cluster"
  )
df_muni3_cluster %>%
  st_drop_geometry() %>%
  filter(!is.na(cluster)) %>%
  group_by(cluster) %>%
  summarise(
    n = n(),
    ratio_mat1000_media = round(mean(ratio_x1000, na.rm = TRUE), 2),
    log_pob_media = round(mean(poblacion, na.rm = TRUE), 2),
    renta_media = round(mean(Indice2023, na.rm = TRUE), 2)
  )
# ============================================================
# 2.5. MAPA DE CLUSTERS
# ============================================================

paleta_clusters <- c(
  "Grandes nucleos urbanos"                = "#66c2a5",
  "Periurbanos de alto poder adquisitivo"  = "#fc8d62",
  "Micromunicipios con efecto sede fiscal" = "#8da0cb",
  "Municipios rurales de baja demanda"     = "#e78ac3"
)

p_mapa_base <- ggplot(df_muni3_cluster) +
  geom_sf(aes(fill = nombre_cluster), color = NA, size = 0.1) +
  scale_fill_manual(
    values = paleta_clusters,
    name   = "Tipología",
    na.value = "grey85"
  ) +
  labs(
    title   = "Tipología de municipios según perfil de demanda automovilística",
    caption = "Fuente: elaboración propia"
  ) +
  theme_void(base_size = 11) +
  theme(legend.position = "bottom",
        legend.text  = element_text(size = 8),
        legend.title = element_text(size = 9))
p_mapa_base
ggsave("mapa_clusters_nacional.png", p_mapa_base, width = 10, height = 8, dpi = 300)

# Zoom Madrid
p_mapa_madrid <- p_mapa_base +
  coord_sf(xlim = c(-4.1, -3.3), ylim = c(40.1, 40.8), expand = FALSE) +
  labs(title = "Tipología de municipios — Área metropolitana de Madrid")
p_mapa_madrid
ggsave("mapa_clusters_madrid.png", p_mapa_madrid, width = 8, height = 6, dpi = 300)

# Zoom Barcelona
p_mapa_bcn <- p_mapa_base +
  coord_sf(xlim = c(1.6, 2.5), ylim = c(41.1, 41.6), expand = FALSE) +
  labs(title = "Tipología de municipios — Área metropolitana de Barcelona")

ggsave("mapa_clusters_barcelona.png", p_mapa_bcn, width = 8, height = 6, dpi = 300)

# ============================================================
# 2.6. ANÁLISIS COMPLEMENTARIO: CLUSTER VS. RESIDUOS
# ============================================================

# Calcular resid_std2 directamente de mod_lin2 para evitar depender de que
# la columna exista en df_muni2 o df_muni3 (puede no haberse guardado antes).
idx_mod2     <- as.integer(rownames(model.frame(mod_lin2)))
resid_std2_v <- tryCatch(
  rstandard(mod_lin2),
  error = function(e) residuals(mod_lin2) / summary(mod_lin2)$sigma
)

df_resid_fuente <- df_muni2 %>%
  st_drop_geometry() %>%
  slice(idx_mod2) %>%
  select(all_of(id_col)) %>%
  mutate(resid_std2 = resid_std2_v)

if (!"resid_std2" %in% names(df_muni3_cluster)) {
  df_muni3_cluster <- df_muni3_cluster %>%
    left_join(df_resid_fuente, by = id_col)
}

df_resid_cluster <- df_muni3_cluster %>%
  st_drop_geometry() %>%
  filter(!is.na(resid_std2), !is.na(nombre_cluster)) %>%
  mutate(nombre_cluster = factor(nombre_cluster))

p_resid_box <- ggplot(df_resid_cluster, aes(x = nombre_cluster, y = resid_std2,
                                            fill = nombre_cluster)) +
  geom_boxplot(outlier.alpha = 0.3, show.legend = FALSE) +
  geom_hline(yintercept = 0,  color = "black",    linewidth = 0.8) +
  geom_hline(yintercept =  2, color = "firebrick", linewidth = 0.7, linetype = "dashed") +
  geom_hline(yintercept = -2, color = "firebrick", linewidth = 0.7, linetype = "dashed") +
  scale_fill_manual(values = paleta_clusters) +
  labs(
    title   = "Residuos estandarizados de mod_lin2 por cluster",
    x       = NULL,
    y       = "Residuo estandarizado",
    caption = "Fuente: elaboración propia"
  ) +
  theme_minimal(base_size = 12) +
  theme(axis.text.x = element_text(angle = 15, hjust = 1))

ggsave("clustering_residuos_por_cluster.png", p_resid_box, width = 9, height = 6, dpi = 300)

# ANOVA: diferencias entre clusters
anova_res <- tryCatch(
  summary(aov(resid_std2 ~ factor(nombre_cluster), data = df_resid_cluster)),
  error = function(e) NULL
)
if (!is.null(anova_res)) {
  cat("\n===== ANOVA: Residuos por cluster =====\n")
  print(anova_res)
}

# Medias de residuos por cluster para interpretación automática
medias_resid <- df_resid_cluster %>%
  group_by(nombre_cluster) %>%
  summarise(media_resid = mean(resid_std2, na.rm = TRUE), .groups = "drop") %>%
  arrange(desc(abs(media_resid)))

cluster_alto  <- medias_resid$nombre_cluster[medias_resid$media_resid > 0][1]
cluster_bajo  <- medias_resid$nombre_cluster[medias_resid$media_resid < 0][1]

anova_p <- if (!is.null(anova_res)) anova_res[[1]]["factor(nombre_cluster)", "Pr(>F)"] else NA

cat(sprintf(
  "\nLos clusters '%s' presentan residuos estandarizados positivos, lo que indica que el modelo de regresión subestima sistemáticamente la demanda en estos tipos de municipios. Esto sugiere que factores no recogidos en el modelo (turismo, sedes empresariales, efecto flota) impulsan las matriculaciones en estas tipologías.\n",
  cluster_alto
))

if (!is.na(cluster_bajo)) {
  cat(sprintf(
    "Los clusters '%s' presentan residuos negativos, indicando sobreestimación de la demanda. El modelo predice más matriculaciones de las observadas, posiblemente por baja motorización real o predominio de desplazamientos compartidos.\n",
    cluster_bajo
  ))
}

if (!is.na(anova_p)) {
  cat(sprintf(
    "El ANOVA confirma que las diferencias de residuos entre clusters son %s (p = %.4f).\n",
    if (anova_p < 0.05) "estadísticamente significativas" else "no significativas",
    anova_p
  ))
}

# ============================================================
# 2.7. MAPA DE MUNICIPIOS DEL CLUSTER 1 (micromunicipios sede fiscal)
# ============================================================

if (!requireNamespace("ggrepel", quietly = TRUE)) install.packages("ggrepel")
library(ggrepel)

# Obtener municipio_key únicos del cluster 1 desde df_cluster_prep (sin duplicados)
keys_cluster1 <- df_cluster_prep %>%
  filter(cluster == 1) %>%
  pull(municipio_key) %>%
  unique()

# Filtrar en df_muni3_cluster y eliminar duplicados por municipio_key
df_cluster1 <- df_muni3_cluster %>%
  filter(municipio_key %in% keys_cluster1) %>%
  distinct(municipio_key, .keep_all = TRUE)

cat(sprintf("\nCluster 1: %d municipios\n", nrow(df_cluster1)))

# Diagnóstico detallado: nombre original, provincia y coordenadas
# para identificar sin ambigüedad cada municipio (p.ej. cuál "torrent" es)
cols_diag <- intersect(
  c("municipio", "municipio_key", "provincia", "poblacion",
    "matriculaciones", "ratio_x1000", "Indice2023"),
  names(df_cluster1)
)
df_diag_c1 <- df_cluster1 %>%
  st_centroid() %>%
  mutate(
    lon = round(st_coordinates(.)[, 1], 3),
    lat = round(st_coordinates(.)[, 2], 3)
  ) %>%
  st_drop_geometry() %>%
  select(all_of(cols_diag), lon, lat)

cat("\n===== IDENTIFICACIÓN COMPLETA — CLUSTER 1 =====\n")
print(as_tibble(df_diag_c1))
cat("\n   Usa lon/lat para verificar en Google Maps: https://maps.google.com/?q=LAT,LON\n")

# Centroides para etiquetas
df_cluster1_centroids <- df_cluster1 %>%
  st_centroid() %>%
  mutate(
    lon = st_coordinates(.)[, 1],
    lat = st_coordinates(.)[, 2]
  )

p_mapa_cluster1 <- ggplot() +
  geom_sf(data = df_muni3_cluster, fill = "grey90", color = "grey80", linewidth = 0.05) +
  geom_sf(data = df_cluster1, fill = "#e41a1c", color = "black", linewidth = 0.3) +
  geom_label_repel(
    data    = df_cluster1_centroids,
    aes(x = lon, y = lat, label = municipio_key),
    size          = 2.8,
    fontface      = "bold",
    fill          = alpha("white", 0.85),
    label.size    = 0.2,
    box.padding   = 0.5,
    point.padding = 0.3,
    max.overlaps  = 20,
    seed          = 42
  ) +
  labs(
    title    = "Cluster 1 — Micromunicipios con efecto sede fiscal",
    subtitle = sprintf("n = %d municipios | Ratio medio: %.0f matriculaciones/1.000 hab.",
                       nrow(df_cluster1),
                       mean(df_cluster1$ratio_x1000, na.rm = TRUE)),
    caption = "Fuente: elaboración propia"
  ) +
  theme_void(base_size = 12) +
  theme(
    plot.title    = element_text(face = "bold", size = 14),
    plot.subtitle = element_text(size = 11, color = "grey30"),
    plot.caption  = element_text(size = 8, color = "grey50")
  )

p_mapa_cluster1
ggsave("mapa_cluster1_municipios.png", p_mapa_cluster1, width = 12, height = 9, dpi = 300)

# ============================================================
# 2.8. DIAGNÓSTICO DE CONSISTENCIA DE CLUSTERS
# ============================================================
# Ejecutar ANTES de rellenar la Tabla 4 del TFG para verificar
# que no hay inconsistencias entre datos, etiquetas y mapa.

cat("\n")
cat("##########################################################\n")
cat("#          DIAGNÓSTICO DE CONSISTENCIA                   #\n")
cat("##########################################################\n")

# --- 1) Conteo real por cluster (desde df_cluster_prep, sin duplicados) ---
cat("\n--- 1) N municipios REAL por cluster (fuente: df_cluster_prep) ---\n")
conteo_real <- df_cluster_prep %>%
  group_by(cluster) %>%
  summarise(n_real = n(), .groups = "drop")
print(conteo_real)

# --- 2) Detalle completo del Cluster 1: identificar cada municipio ---
cat("\n--- 2) Municipios del Cluster 1: detalle con provincia ---\n")
detalle_c1 <- df_cluster_prep %>%
  filter(cluster == 1) %>%
  select(municipio_key, poblacion, ratio_x1000, Indice2023)

# Intentar añadir provincia si existe en df_muni2
if ("provincia" %in% names(df_muni2)) {
  detalle_c1 <- detalle_c1 %>%
    left_join(
      df_muni2 %>% st_drop_geometry() %>%
        select(municipio_key, provincia) %>%
        distinct(municipio_key, .keep_all = TRUE),
      by = "municipio_key"
    )
}
print(as_tibble(detalle_c1))

cat("\n   -> Verifica si 'torrent' es Torrent (Valencia, ~80.000 hab)")
cat("\n      o Torrent de Cinca (Huesca, ~500 hab).\n")
cat("      Si la poblacion que aparece arriba es < 1.000, es el de Huesca.\n")
cat("      Si es > 50.000, hay un problema de asignación de cluster.\n")

# --- 3) Coherencia ratio x1000: efecto denominador pequeño ---
cat("\n--- 3) Ratio x1000 en Cluster 1: ¿efecto denominador pequeño? ---\n")
detalle_c1_ratio <- df_cluster_prep %>%
  filter(cluster == 1) %>%
  mutate(
    matriculaciones_estimadas = round(ratio_x1000 * poblacion / 1000, 0)
  ) %>%
  select(municipio_key, poblacion, matriculaciones, ratio_x1000, matriculaciones_estimadas)
print(as_tibble(detalle_c1_ratio))

cat("\n   -> Si la poblacion es muy baja y las matriculaciones son altas,\n")
cat("      probablemente son sedes fiscales de empresas de renting/flotas.\n")
cat("      Esto DEBE explicarse en el TFG (no basta con decir 'alta demanda').\n")

# --- 4) Etiquetas cualitativas: relativas entre clusters ---
cat("\n--- 4) Comparación de Indice2023 entre clusters ---\n")
cat("   (para verificar si las etiquetas Alta/Baja son coherentes)\n")
resumen_renta <- df_cluster_prep %>%
  group_by(cluster) %>%
  summarise(
    renta_media  = round(mean(Indice2023, na.rm = TRUE), 3),
    renta_min    = round(min(Indice2023, na.rm = TRUE), 3),
    renta_max    = round(max(Indice2023, na.rm = TRUE), 3),
    .groups = "drop"
  ) %>%
  arrange(renta_media)
print(resumen_renta)

cat("\n   -> Si el índice está normalizado a 1.00 = media nacional:\n")
cat("      - Valores < 1 = por debajo de la media nacional\n")
cat("      - Valores > 1 = por encima de la media nacional\n")
cat("      Etiquetar como 'Alta' un cluster con indice < 1 es incorrecto\n")
cat("      en términos absolutos. Usa etiquetas RELATIVAS al resto de clusters\n")
cat("      (p.ej. 'la más alta/baja de los 4 clusters').\n")

# --- 5) Discrepancia mapa vs tabla: comparar keys ---
cat("\n--- 5) Discrepancia mapa vs datos ---\n")
cat(sprintf("   Keys en df_cluster_prep (cluster 1):  %d\n", length(keys_cluster1)))
cat(sprintf("   Filas en df_cluster1 (mapa, tras distinct): %d\n", nrow(df_cluster1)))

keys_mapa <- df_cluster1 %>% st_drop_geometry() %>% pull(municipio_key)
perdidos  <- setdiff(keys_cluster1, keys_mapa)
sobrantes <- setdiff(keys_mapa, keys_cluster1)

if (length(perdidos) > 0) {
  cat("   MUNICIPIOS PERDIDOS (están en cluster_prep pero NO en el mapa):\n")
  cat("   ", paste(perdidos, collapse = ", "), "\n")
  cat("   -> Probablemente no tienen geometría en df_muni2.\n")
} else {
  cat("   No hay municipios perdidos.\n")
}
if (length(sobrantes) > 0) {
  cat("   MUNICIPIOS SOBRANTES en mapa: ", paste(sobrantes, collapse = ", "), "\n")
}

cat("\n##########################################################\n")
cat("#       FIN DIAGNÓSTICO — revisa antes de redactar       #\n")
cat("##########################################################\n")

# ============================================================
# 2.9. TABLA RESUMEN DE CLUSTERS (para rellenar Tabla 4)
# ============================================================

tabla_clusters <- df_perfil_clusters %>%
  select(cluster, nombre_cluster, n_municipios, ratio_x1000, poblacion_media, Indice2023) %>%
  mutate(
    ratio_x1000     = round(ratio_x1000, 2),
    poblacion_media = round(poblacion_media, 0),
    Indice2023      = round(Indice2023, 2)
  ) %>%
  arrange(cluster)

cat("\n===== TABLA 4: DESCRIPCIÓN DE CLUSTERS =====\n")
cat(sprintf("%-10s %-45s %8s %15s %15s %12s\n",
            "Cluster", "Perfil", "N munic.", "Ratio x1000", "Pobl. media", "Ind. Renta"))
cat(strrep("-", 110), "\n")
for (i in seq_len(nrow(tabla_clusters))) {
  cat(sprintf("%-10d %-45s %8d %15.2f %15s %12.2f\n",
              tabla_clusters$cluster[i],
              tabla_clusters$nombre_cluster[i],
              tabla_clusters$n_municipios[i],
              tabla_clusters$ratio_x1000[i],
              format(tabla_clusters$poblacion_media[i], big.mark = "."),
              tabla_clusters$Indice2023[i]))
}
cat("\n")
