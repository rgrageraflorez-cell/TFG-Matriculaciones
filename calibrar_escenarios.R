# ============================================================================
# calibrar_escenarios.R
# ----------------------------------------------------------------------------
# Calibra los seis vectores estacionales de impacto del simulador de
# escenarios del dashboard MatriX y los exporta como
#   public/escenarios_vectores.json
#
# Tres eventos calibrados empiricamente sobre la serie DGT 2021-2024 y
# la serie anual 1990-2024 (boom post-crisis, campana promocional,
# recesion 2020). Tres eventos definidos por literatura (Plan MOVES,
# subida de tipos BCE, escasez de semiconductores).
#
# Independiente: NO modifica ningun script existente. Reutiliza la
# logica de carga de "Analisis matriculaciones.R".
#
# Autor: TFG MatriX - Rodrigo Gragera
# ============================================================================

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(stringr)
  library(lubridate)
  library(jsonlite)
})

set.seed(42)

# ============================================================================
# Parametros configurables del Evento 1 (Boom post-crisis)
# ============================================================================
# alpha controla la atenuacion del perfil estacional heredado de 2021-2022.
# alpha=1 -> perfil original (estacionalidad fuerte, calibrada sobre n=2 anios)
# alpha=0 -> perfil plano (estacionalidad solo proviene de la baseline Prophet)
# alpha=0.5 -> compromiso por defecto. Reconoce la incertidumbre asociada a
# calibrar la forma del vector sobre un unico episodio analogo (post-COVID).
ALPHA_BOOM <- 0.5

# Umbral de caida interanual que define un "shock previo" para identificar
# episodios analogos de boom post-crisis sobre la serie anual 1990-2024.
UMBRAL_CAIDA_BOOM <- -0.10   # caida >= 10% interanual

# Flag de seguridad: con FALSE el script genera todos los archivos de
# validacion en validacion_evento1/ pero NO sobrescribe el JSON consumido
# por el dashboard. Cambiar a TRUE solo tras revisar la validacion.
APLICAR_AL_JSON <- TRUE

# ============================================================================
# PASO 1 - Carga de datos
# Replicada literal del script original (Analisis matriculaciones.R) para
# obtener df_mensual_agrupado (Año, Mes, Turismos desde 2021) y sa_turismos
# (vector anual desde 1990). No se hace source() del script original porque
# arrastra ~2000 lineas de modelado y graficos no necesarios aqui.
# ============================================================================

# Localiza la carpeta de Excel; soporta tanto RStudio (donde ~ apunta a
# OneDrive/Documentos) como Rscript (donde ~ es C:/Users/.../Documents).
base_excel_candidatos <- c(
  "~/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES",
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Filtrado de datos/Dataset/Matriculaciones ES"
)
base_excel <- base_excel_candidatos[file.exists(base_excel_candidatos)][1]
if (is.na(base_excel)) {
  stop("No encuentro la carpeta de Excel de matriculaciones; revisa base_excel_candidatos.")
}

# --- Anual ---
df_anual           <- read_excel(file.path(base_excel, "Matriculaciones-Series-historicas-2024.xlsx"), sheet = 1)
df_anual_electrico <- read_excel(file.path(base_excel, "Matriculaciones-Series-historicas-2024.xlsx"), sheet = 6)

# --- Mensual por anios ---
df_mensual21.1 <- read_excel(file.path(base_excel, "Análisis mensual 2021.xlsx"), sheet = 1)
df_mensual21.2 <- read_excel(file.path(base_excel, "Análisis mensual 2021.xlsx"), sheet = 2)
df_mensual22.1 <- read_excel(file.path(base_excel, "Análisis mensual 2022.xlsx"), sheet = 1)
df_mensual22.2 <- read_excel(file.path(base_excel, "Análisis mensual 2022.xlsx"), sheet = 2)
df_mensual23.1 <- read_excel(file.path(base_excel, "Análisis mensual 2023.xlsx"), sheet = 1)
df_mensual23.2 <- read_excel(file.path(base_excel, "Análisis mensual 2023.xlsx"), sheet = 2)
df_mensual24.1 <- read_excel(file.path(base_excel, "Análisis mensual 2024.xlsx"), sheet = 1)
df_mensual24.2 <- read_excel(file.path(base_excel, "Análisis mensual 2024.xlsx"), sheet = 2)

df251  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 1)
df252  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 2)
df253  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 3)
df254  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 4)
df256  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 6)
df257  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 7)
df258  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 8)
df259  <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 9)
df2510 <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 10)
df2511 <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 11)
df2512 <- read_excel(file.path(base_excel, "mensualidad agrupada 2025.xlsx"), sheet = 12)
df_mensual25 <- bind_rows(df251, df252, df253, df254, df256, df257, df258, df259, df2510, df2511, df2512) %>%
  mutate(lugar = str_replace(lugar, "^[0-9]+", "") %>% str_trim())

# --- Limpieza df_anual (replicada) ---
df_anual <- df_anual[-1, ]
new_names <- as.character(df_anual[1, ])
colnames(df_anual) <- new_names
rownames(df_anual) <- NULL
df_anual <- df_anual[-1, ]
df_anual <- df_anual[1:(nrow(df_anual) - 2), ]

df_anual_electrico <- df_anual_electrico[-1, ]
new_names <- as.character(df_anual_electrico[1, ])
colnames(df_anual_electrico) <- new_names
rownames(df_anual_electrico) <- NULL
df_anual_electrico <- df_anual_electrico[-1, ]
df_anual_electrico <- df_anual_electrico[1:(nrow(df_anual_electrico) - 2), ]

# --- Agrupacion mensual por (Año, Mes, Turismos) replicada ---
# Cada fila del Excel = una matriculacion individual; el original agrega
# por conteo (n()), no suma una columna numerica.
df211 <- df_mensual21.1 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df212 <- df_mensual21.2 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df221 <- df_mensual22.1 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df222 <- df_mensual22.2 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df231 <- df_mensual23.1 %>% group_by(Año = year(`fecha matriculación`), Mes = month(`fecha matriculación`)) %>% summarise(Turismos = n(), .groups = "drop")
df232 <- df_mensual23.2 %>% group_by(Año = year(`fecha matriculación`), Mes = month(`fecha matriculación`)) %>% summarise(Turismos = n(), .groups = "drop")
df241 <- df_mensual24.1 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df242 <- df_mensual24.2 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")
df_mensual25_g <- df_mensual25 %>% group_by(Año = year(fecha), Mes = month(fecha)) %>% summarise(Turismos = n(), .groups = "drop")

df_mensual_agrupado <- bind_rows(df211, df212, df221, df222, df231, df232, df241, df242, df_mensual25_g) %>%
  arrange(Año, Mes) %>%
  group_by(Año, Mes) %>%                # algunos meses se solapan entre dos hojas (sheet 1 + sheet 2 del mismo año)
  summarise(Turismos = sum(Turismos, na.rm = TRUE), .groups = "drop")

# --- Vector anual sa_turismos (replicado) ---
sa_turismos <- as.numeric(df_anual$Turismos)
# El ts() del script original arranca en 1990 con frecuencia 1; el indice i=1 es 1990.
ANO_BASE_ANUAL <- 1990

# Nota: el Excel oficial "Series-historicas-2024" llega hasta 2024. NO sumamos
# el total 2025 desde df_mensual25_g porque ese Excel mensual 2025 se compone
# de 11 hojas con solapamientos que el agregado actual duplica (suma resultante
# ~1,76M, casi el doble de lo plausible). Mantenemos la serie 1990-2024 hasta
# disponer de un total anual 2025 verificado. Esto NO afecta a la calibracion
# del Evento 1: 2025 no es suelo de ningun episodio.

get_anual <- function(year) {
  idx <- year - ANO_BASE_ANUAL + 1
  if (idx < 1L || idx > length(sa_turismos)) return(NA_real_)
  sa_turismos[idx]
}

cat(sprintf("[OK] df_mensual_agrupado: %d filas, anos %d-%d.\n",
            nrow(df_mensual_agrupado), min(df_mensual_agrupado$Año), max(df_mensual_agrupado$Año)))
cat(sprintf("[OK] sa_turismos: %d anos (%d-%d).\n",
            length(sa_turismos), ANO_BASE_ANUAL, ANO_BASE_ANUAL + length(sa_turismos) - 1L))

# ============================================================================
# PASO 2 - perfil_estacional()
# Indice estacional por mes (1..12) normalizado para que mean(perfil) = 1.
# El indice de un mes en un anio dado es Turismos_mes / mean(Turismos_anio).
# Para varios anios se promedia el indice mensual entre anios y luego se
# renormaliza.
# ============================================================================
perfil_estacional <- function(df, anios) {
  sub <- df %>% filter(Año %in% anios)
  if (nrow(sub) == 0L) {
    warning(sprintf("perfil_estacional: sin filas para anios %s", paste(anios, collapse = ",")))
    return(rep(1, 12))
  }
  pm <- sub %>%
    group_by(Año) %>%
    mutate(media_anual = mean(Turismos, na.rm = TRUE),
           idx = Turismos / media_anual) %>%
    ungroup() %>%
    group_by(Mes) %>%
    summarise(idx_medio = mean(idx, na.rm = TRUE), .groups = "drop") %>%
    arrange(Mes)

  perfil <- rep(1, 12)
  perfil[pm$Mes] <- pm$idx_medio
  perfil <- perfil / mean(perfil)   # renormaliza media = 1
  perfil
}

perfil_base_2021_2024 <- perfil_estacional(df_mensual_agrupado, 2021:2024)
cat("[OK] perfil_estacional 2021-2024 calculado (mean = ",
    round(mean(perfil_base_2021_2024), 4), ").\n", sep = "")

# Helpers de normalizacion --------------------------------------------------
escalar_a_media <- function(v, target) {
  m <- mean(v, na.rm = TRUE)
  if (!is.finite(m) || abs(m) < 1e-9) {
    warning("escalar_a_media: media original ~0; devolviendo vector uniforme con la media objetivo.")
    return(rep(target, length(v)))
  }
  v * (target / m)
}

# ============================================================================
# PASO 3 - Eventos calibrados empiricamente
# ============================================================================

# Tendencia mensual 2021-2024 y desviaciones - usado por Evento 1 (forma)
# y Evento 2 (campana promocional, repuntes >+1sd).
fit_df <- df_mensual_agrupado %>%
  filter(Año %in% 2021:2024) %>%
  arrange(Año, Mes) %>%
  mutate(t = row_number())

modelo_tend <- lm(Turismos ~ t, data = fit_df)
fit_df$tendencia <- as.numeric(predict(modelo_tend, newdata = fit_df))
fit_df$desv_pct  <- (fit_df$Turismos - fit_df$tendencia) / fit_df$tendencia * 100

## --- Evento 1: Boom post-crisis (estrategia A+B') -------------------------
# FORMA del vector: combinacion lineal del perfil estacional 2021-2022 con
# un vector plano. ALPHA_BOOM (=0.5) atenua la estacionalidad heredada del
# unico episodio mensual disponible (post-COVID), reconociendo que con n=1
# episodio mensual no es defendible asumir que el patron concreto se replicara
# en un boom futuro.
#
# MAGNITUD anual: media de las tasas de crecimiento interanual observadas en
# los rebotes del ano siguiente al suelo de cada caida >=10% en la serie
# anual 1990-2025. Sustituye el +15% arbitrario anterior.

# (A) Identificar episodios analogos sobre la serie anual ------------------
# Definicion: el "suelo" de una crisis es el minimo local cuya caida acumulada
# desde el pico inmediatamente anterior es >= umbral. Multiples minimos locales
# dentro del mismo periodo de crisis (ej. 2009 y 2012 en la crisis financiera)
# se fusionan: nos quedamos con el mas profundo. La "ventana de fusion" agrupa
# minimos separados por <= VENTANA_MERGE_ANOS anios. El "rebote" es la tasa
# del anio inmediatamente posterior al suelo.
VENTANA_MERGE_ANOS <- 5L

identificar_booms <- function(serie_anual, ano_base = ANO_BASE_ANUAL,
                              umbral_caida = UMBRAL_CAIDA_BOOM,
                              ventana_merge = VENTANA_MERGE_ANOS) {
  s <- as.numeric(serie_anual)
  n <- length(s)
  if (n < 3L) return(data.frame())
  anos <- seq.int(ano_base, ano_base + n - 1L)

  # Paso 1: detectar todos los minimos locales cuya caida acumulada
  # desde el pico inmediatamente anterior cumpla el umbral.
  candidatos <- list()
  for (i in seq.int(2L, n - 1L)) {
    if (!(s[i] < s[i - 1L] && s[i + 1L] > s[i])) next
    j <- i - 1L
    while (j > 1L && s[j - 1L] >= s[j]) j <- j - 1L
    pico <- j
    cum_drop <- (s[i] - s[pico]) / s[pico]
    if (cum_drop <= umbral_caida) {
      candidatos[[length(candidatos) + 1L]] <- list(
        idx = i, ano = anos[i], valor = s[i],
        pico_idx = pico, valor_pico = s[pico], cum_drop = cum_drop
      )
    }
  }
  if (length(candidatos) == 0L) return(data.frame())

  # Paso 2: fusionar candidatos consecutivos cercanos (misma crisis): de
  # cada par dentro de la ventana, quedarnos con el mas profundo.
  keep <- rep(TRUE, length(candidatos))
  for (k in seq_along(candidatos)) {
    if (!keep[k]) next
    for (m in seq_along(candidatos)) {
      if (m == k || !keep[m]) next
      if (abs(candidatos[[k]]$ano - candidatos[[m]]$ano) <= ventana_merge) {
        if (candidatos[[k]]$valor < candidatos[[m]]$valor) keep[m] <- FALSE
        else                                               keep[k] <- FALSE
      }
    }
  }

  # Paso 3: construir dataframe final con los suelos sobrevivientes.
  res <- list()
  for (k in which(keep)) {
    c <- candidatos[[k]]
    if (c$idx + 1L > n) next   # sin rebote disponible (suelo en ultimo ano)
    res[[length(res) + 1L]] <- data.frame(
      ano_pico_previo  = anos[c$pico_idx],
      valor_pico       = c$valor_pico,
      ano_suelo        = c$ano,
      valor_suelo      = c$valor,
      caida_acum_pct   = c$cum_drop * 100,
      ano_rebote       = anos[c$idx + 1L],
      valor_rebote     = s[c$idx + 1L],
      tasa_rebote_pct  = (s[c$idx + 1L] - s[c$idx]) / s[c$idx] * 100
    )
  }
  if (length(res) == 0L) return(data.frame())
  do.call(rbind, res)
}

rebotes <- identificar_booms(sa_turismos)
cat("\n[INFO] Episodios analogos de boom post-crisis (caida >= 10%):\n")
print(rebotes, row.names = FALSE)

if (nrow(rebotes) == 0L) {
  warning("No se han detectado booms post-crisis en la serie anual; usando 15% por defecto.")
  magnitud_pct_nueva <- 15
  sd_boom_pct        <- NA_real_
} else {
  magnitud_pct_nueva <- round(mean(rebotes$tasa_rebote_pct), 2)
  sd_boom_pct        <- round(sd(rebotes$tasa_rebote_pct),  2)
  cat(sprintf("[INFO] Magnitud nueva = %.2f%%  (sd=%.2f%%, n=%d episodios)\n",
              magnitud_pct_nueva, sd_boom_pct, nrow(rebotes)))
  cat(sprintf("[INFO] Magnitud actual del simulador = 15.00%%  ->  delta = %+.2f pp\n",
              magnitud_pct_nueva - 15))
}

# (B) Forma "actual" 2021-2022 bien calculada (tu opcion ii del plan) -------
# perfil_estacional() devuelve 12 indices con media 1; convertimos a desviacion
# porcentual sobre la media y le sumamos la magnitud calibrada para obtener
# un vector multiplicativo con la forma 2021-2022 fiel.
perfil_2021_2022 <- perfil_estacional(df_mensual_agrupado, 2021:2022)   # mean = 1
desv_pct_2122    <- (perfil_2021_2022 - 1) * 100                        # mean = 0
vec_alpha_1      <- magnitud_pct_nueva + desv_pct_2122                  # mean = magnitud

# (B') Vector plano (alpha = 0)
vec_alpha_0 <- rep(magnitud_pct_nueva, 12)

# Combinacion lineal final (alpha por defecto = 0.5)
vec_combinado <- ALPHA_BOOM * vec_alpha_1 + (1 - ALPHA_BOOM) * vec_alpha_0
# Renormalizar para que la media exacta coincida con la magnitud calibrada
vec_combinado <- vec_combinado - mean(vec_combinado) + magnitud_pct_nueva
vec_boom      <- round(vec_combinado, 2)

# VECTOR ANTERIOR (alpha=1, magnitud=15%, calibrado solo sobre 2021-2022,
# afectado por el bug de re-escalado por media-cero que producia oscilaciones
# de hasta +/-600%). Conservado por trazabilidad - descomentar las dos lineas
# siguientes y comentar el bloque (A)+(B) anterior si se desea revertir.
# vec_boom_v0 <- c(643.1, 201.8, -173.3, -94.8, -469.3, -535.4,
#                  -215.6,  519.6, 157.3, 170.1, 46.7, -70.2)

## --- Evento 2: Campana promocional sectorial (repuntes >1 sd en 2021-2024) -
sigma <- sd(fit_df$desv_pct, na.rm = TRUE)
fit_df$es_repunte <- fit_df$desv_pct > sigma   # >1 sd POSITIVO

n_repuntes <- sum(fit_df$es_repunte, na.rm = TRUE)
cat(sprintf("[INFO] Repuntes >+1sd identificados en 2021-2024: %d.\n", n_repuntes))

if (n_repuntes >= 6L) {
  campana_raw <- fit_df %>%
    filter(es_repunte) %>%
    group_by(Mes) %>%
    summarise(d = mean(desv_pct, na.rm = TRUE), .groups = "drop") %>%
    right_join(tibble(Mes = 1:12), by = "Mes") %>%
    arrange(Mes) %>%
    mutate(d = ifelse(is.na(d), 0, d)) %>%
    pull(d)
  vec_campana <- round(escalar_a_media(campana_raw, 5), 1)
  campana_modo <- "empirico"
} else {
  warning(sprintf(
    "Evento 2 (campana promocional): solo %d meses con repunte >1sd. Fallback uniforme +5%%.",
    n_repuntes
  ))
  vec_campana <- rep(5.0, 12)
  campana_modo <- "fallback_uniforme"
}

## --- Evento 3: Recesion moderada (2020 vs 2019, perfil de 2019 como proxy) -
val_2019 <- get_anual(2019)
val_2020 <- get_anual(2020)
cat(sprintf("[INFO] Anual: 2019=%s, 2020=%s.\n",
            ifelse(is.na(val_2019), "NA", format(val_2019)),
            ifelse(is.na(val_2020), "NA", format(val_2020))))

if (is.finite(val_2019) && is.finite(val_2020) && val_2019 > 0) {
  caida_anual_pct <- (val_2020 - val_2019) / val_2019 * 100
  cat(sprintf("[INFO] Caida anual 2020 vs 2019: %.2f%%.\n", caida_anual_pct))
} else {
  warning("Evento 3: faltan datos 2019/2020 en sa_turismos. Usando -32%% por defecto.")
  caida_anual_pct <- -32
}

# 2019 no esta en df_mensual_agrupado (la serie mensual empieza en 2021),
# usamos el perfil de 2021-2024 como proxy (estacionalidad estable).
perfil_proxy_2019 <- perfil_base_2021_2024

# Distribuye la caida proporcionalmente al peso estacional.
recesion_raw <- caida_anual_pct * perfil_proxy_2019
vec_recesion <- round(escalar_a_media(recesion_raw, -12), 1)

# ============================================================================
# PASO 4 - Eventos definidos por literatura (no calibrables empiricamente)
# ============================================================================

## --- Evento 4: Plan MOVES (Cantos-Sanchez et al. 2015) -------------------
# Los planes de achatarramiento espanoles concentran el efecto en otono
# (oct-dic) y en marzo-abril. Vector razonado mes a mes:
moves_raw <- c(
  ene = 6,   # Mes "normal": efecto medio del incentivo de fondo
  feb = 6,   # Mes "normal"
  mar = 9,   # Marzo: arranque comercial primaveral, alto retiro de coches viejos
  abr = 8,   # Abril: continuacion del impulso primaveral
  may = 6,   # Mes "normal"
  jun = 6,   # Mes "normal"
  jul = 3,   # Verano bajo: clientes en vacaciones, tramites parados
  ago = 3,   # Verano bajo
  sep = 6,   # Mes "normal" (rentree)
  oct = 14,  # Octubre: pico de la convocatoria, fin de presupuesto y picos historicos del MOVES
  nov = 12,  # Noviembre: campanas comerciales (Black Friday) + cola del MOVES
  dic = 10   # Diciembre: cierre fiscal, ultimas adjudicaciones del ano
)
vec_moves <- round(escalar_a_media(unname(moves_raw), 8), 1)

## --- Evento 5: Subida de tipos BCE (patron 2022-2023, +450 pb) -----------
# Serie 2022-2023 muestra mayor sensibilidad a financiacion en Q3-Q4.
bce_raw <- c(
  ene = -5,  # Q1 con financiacion mas costosa, demanda contenida
  feb = -5,
  mar = -5,
  abr = -5,
  may = -7,  # May-jun: clientes deciden compra antes del verano y sienten el coste
  jun = -7,
  jul = -3,  # Verano con menor sensibilidad (decisiones aplazadas)
  ago = -3,
  sep = -8,  # Septiembre: vuelta al consumo, financiacion clave
  oct = -9,  # Q4: alto volumen de financiacion concentrado
  nov = -9,
  dic = -10  # Cierre de ano: campanas y compras financiadas, max sensibilidad
)
vec_bce <- round(escalar_a_media(unname(bce_raw), -6), 1)

## --- Evento 6: Escasez de semiconductores (3 meses, demanda alta) --------
# Cuello de botella se agrava con el tiempo: el inventario se vacia y
# se acumulan los pedidos. Vector estricto de 3 valores.
vec_semis <- c(-7, -10, -13)

# ============================================================================
# PASO 6 - Verificacion (precede al paso 5 para abortar antes de exportar
# si algun vector se desvia mucho del impacto medio objetivo)
# ============================================================================
TOL <- 0.5
verificar <- function(nombre, v, target) {
  m <- mean(v)
  ok <- abs(m - target) <= TOL
  cat(sprintf("  %-22s media=%6.2f%%  objetivo=%5.1f%%  %s\n",
              nombre, m, target, if (ok) "OK" else "WARN"))
  if (!ok) {
    warning(sprintf(
      "Evento %s: media %.2f%% se desvia del objetivo %.1f%% (>|%.1f| pp).",
      nombre, m, target, TOL))
  }
  invisible(ok)
}

cat("\n=== Tabla resumen de vectores ===\n")
meses_lbl <- c("Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic")
tabla <- data.frame(
  Mes              = meses_lbl,
  Boom             = vec_boom,
  Campana          = vec_campana,
  Recesion         = vec_recesion,
  MOVES            = vec_moves,
  BCE              = vec_bce
)
print(tabla, row.names = FALSE)
cat(sprintf("\nSemiconductores (3 meses): %s  (media=%.2f%%, objetivo=-10.0%%)\n",
            paste(vec_semis, collapse = ", "), mean(vec_semis)))

cat("\n=== Verificacion de impactos medios anuales (tolerancia +/- ", TOL,
    " pp) ===\n", sep = "")
verificar("boom_postcrisis",      vec_boom,      magnitud_pct_nueva)
verificar("campana_promocional",  vec_campana,    5)
verificar("recesion_moderada",    vec_recesion, -12)
verificar("plan_moves",           vec_moves,      8)
verificar("subida_tipos",         vec_bce,       -6)
verificar("semiconductores",      vec_semis,    -10)

# ============================================================================
# PASO 4b - Validacion del Evento 1 (Boom post-crisis) - SIEMPRE se genera
# ============================================================================
val_dir <- file.path(
  "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis",
  "validacion_evento1"
)
dir.create(val_dir, showWarnings = FALSE, recursive = TRUE)

# 1. Serie anual completa
serie_anual_df <- data.frame(
  ano      = seq.int(ANO_BASE_ANUAL, ANO_BASE_ANUAL + length(sa_turismos) - 1L),
  turismos = sa_turismos
)
write.csv(serie_anual_df,
          file.path(val_dir, "serie_anual_turismos_1990_2024.csv"),
          row.names = FALSE, fileEncoding = "UTF-8")

# 2. Episodios identificados
if (nrow(rebotes) > 0L) {
  write.csv(rebotes,
            file.path(val_dir, "episodios_boom.csv"),
            row.names = FALSE, fileEncoding = "UTF-8")
}

# 3. Vectores side-by-side
vectores_df <- data.frame(
  mes          = c("Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"),
  vec_alpha_1  = round(vec_alpha_1, 2),    # forma original 2021-2022 + magnitud nueva
  vec_alpha_05 = round(vec_boom,    2),    # combinado por defecto
  vec_alpha_0  = round(vec_alpha_0, 2)     # plano
)
write.csv(vectores_df,
          file.path(val_dir, "vectores_boom.csv"),
          row.names = FALSE, fileEncoding = "UTF-8")

# 4. Grafico de los tres vectores
png(file.path(val_dir, "grafico_vectores.png"),
    width = 1200, height = 700, res = 130)
op <- par(mar = c(4.5, 4.5, 3.5, 1))
ylim <- range(c(vec_alpha_1, vec_alpha_0, vec_boom)) + c(-2, 2)
plot(1:12, vec_alpha_1, type = "b", pch = 19, col = "#C4922A",
     ylim = ylim, xaxt = "n",
     xlab = "Mes", ylab = "Impacto mensual (%)",
     main = sprintf("Evento 1 - Boom post-crisis: comparativa de vectores (magnitud=%.2f%%)",
                    magnitud_pct_nueva))
axis(1, at = 1:12, labels = vectores_df$mes)
lines(1:12, vec_boom,    type = "b", pch = 19, col = "#1A2B4A", lwd = 2)
lines(1:12, vec_alpha_0, type = "b", pch = 19, col = "#9CA3AF", lty = 2)
abline(h = magnitud_pct_nueva, col = "#9CA3AF", lty = 3)
legend("topright", bty = "n",
       legend = c(
         expression(alpha == 1 ~ "(forma 2021-2022 fiel)"),
         expression(alpha == 0.5 ~ "(combinado, default)"),
         expression(alpha == 0 ~ "(plano)")
       ),
       col = c("#C4922A", "#1A2B4A", "#9CA3AF"),
       lty = c(1, 1, 2), pch = 19)
par(op); dev.off()

# 5. Forecast comparado: aplicar vector original (15%) vs nuevo sobre la
# ultima pred_prophet disponible. La baseline se lee del CSV de la web.
csv_pred <- "C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/df_real_pred_mensual_total.csv"
if (file.exists(csv_pred)) {
  pred <- read.csv(csv_pred, stringsAsFactors = FALSE)
  # Forecast = filas con pred_prophet no nulo y real nulo (los proximos 12)
  forecast_rows <- pred[!is.na(pred$pred_prophet) & is.na(pred$real), ]
  forecast_rows <- forecast_rows[order(forecast_rows$fecha_mes), ]
  if (nrow(forecast_rows) > 0L) {
    fr <- head(forecast_rows, 12)
    fr$mes_calendario <- as.integer(substr(fr$fecha_mes, 6, 7))
    # Vector original del JSON anterior (alpha=1, magnitud=15%, con bug)
    vec_orig_v0 <- c(643.1, 201.8, -173.3, -94.8, -469.3, -535.4,
                     -215.6,  519.6, 157.3, 170.1, 46.7, -70.2)
    fr$pred_v0  <- fr$pred_prophet * (1 + vec_orig_v0[fr$mes_calendario] / 100)
    fr$pred_new <- fr$pred_prophet * (1 + vec_boom[fr$mes_calendario] / 100)

    png(file.path(val_dir, "grafico_forecast_comparado.png"),
        width = 1200, height = 700, res = 130)
    op <- par(mar = c(4.5, 4.5, 3.5, 1))
    ylim <- range(c(fr$pred_prophet, fr$pred_new, fr$pred_v0), na.rm = TRUE)
    plot(seq_len(nrow(fr)), fr$pred_prophet, type = "b", pch = 19,
         col = "#9CA3AF", ylim = ylim, xaxt = "n",
         xlab = "Mes del forecast", ylab = "Matriculaciones previstas",
         main = "Forecast 12m: baseline Prophet vs Boom (vector anterior vs nuevo)")
    axis(1, at = seq_len(nrow(fr)), labels = fr$fecha_mes, las = 2, cex.axis = 0.8)
    lines(seq_len(nrow(fr)), fr$pred_v0,  type = "b", pch = 17, col = "#B91C1C", lty = 2)
    lines(seq_len(nrow(fr)), fr$pred_new, type = "b", pch = 19, col = "#1A2B4A", lwd = 2)
    legend("topright", bty = "n",
           legend = c("Baseline Prophet",
                      "Boom vector anterior (alpha=1, mag=15%, con bug)",
                      sprintf("Boom vector nuevo (alpha=0.5, mag=%.2f%%)", magnitud_pct_nueva)),
           col = c("#9CA3AF", "#B91C1C", "#1A2B4A"),
           lty = c(1, 2, 1), pch = c(19, 17, 19))
    par(op); dev.off()

    write.csv(fr[, c("fecha_mes","pred_prophet","pred_v0","pred_new")],
              file.path(val_dir, "forecast_comparado.csv"),
              row.names = FALSE, fileEncoding = "UTF-8")
  }
} else {
  warning(sprintf("No encuentro %s; salto el grafico de forecast comparado.", csv_pred))
}

# 6. Resumen JSON
resumen_payload <- list(
  episodios_identificados      = if (nrow(rebotes) > 0L) rebotes else list(),
  magnitudes_individuales      = if (nrow(rebotes) > 0L) round(rebotes$tasa_rebote_pct, 2) else list(),
  media                        = magnitud_pct_nueva,
  desviacion_tipica            = sd_boom_pct,
  magnitud_actual_simulador    = 15,
  magnitud_nueva_propuesta     = magnitud_pct_nueva,
  alpha_atenuacion             = ALPHA_BOOM,
  vector_alpha_1               = round(vec_alpha_1, 2),
  vector_alpha_05_default      = round(vec_boom,    2),
  vector_alpha_0               = round(vec_alpha_0, 2),
  aplicar_al_json              = APLICAR_AL_JSON
)
write_json(resumen_payload,
           path = file.path(val_dir, "resumen.json"),
           pretty = TRUE, auto_unbox = TRUE, digits = 4, na = "null")

cat(sprintf("\n[OK] Validacion del Evento 1 generada en:\n  %s\n",
            normalizePath(val_dir, winslash = "/", mustWork = FALSE)))

# ============================================================================
# PASO 5 - Exportacion JSON
# ============================================================================
out_dir <- file.path("C:/Users/rgrag/OneDrive/Documentos/4 Carrera/TFG/Practica/Analisis/Datasets web/Web dashboard/public")
out_path <- file.path(out_dir, "escenarios_vectores.json")
if (!dir.exists(out_dir)) {
  stop(sprintf("No existe el directorio destino: %s", out_dir))
}

payload <- list(
  metadata = list(
    generado     = format(Sys.time(), "%Y-%m-%d %H:%M:%S %Z"),
    metodologia  = "Calibracion empirica sobre serie DGT mensual 2021-2025 y serie anual 1990-2024. Boom: magnitud media de booms post-crisis identificados, forma 2021-2022 atenuada con alpha. Eventos no calibrables basados en literatura especializada.",
    fuentes      = c("Cantos-Sanchez et al. 2015", "BCE tipos 2022-2023", "DGT serie mensual 2021-2025", "DGT series historicas anuales 1990-2024")
  ),
  eventos = list(
    boom_postcrisis = list(
      impacto_mensual     = vec_boom,
      impacto_medio_anual = magnitud_pct_nueva,
      tipo                = "empirico",
      periodo_referencia  = sprintf(
        "Forma 2021-2022 atenuada (alpha=%.2f); magnitud media de %d booms post-crisis 1990-2024",
        ALPHA_BOOM, nrow(rebotes)
      ),
      n_episodios         = nrow(rebotes),
      desviacion_tipica   = sd_boom_pct,
      alpha_atenuacion    = ALPHA_BOOM
    ),
    campana_promocional = list(
      impacto_mensual     = vec_campana,
      impacto_medio_anual = 5,
      tipo                = if (campana_modo == "empirico") "empirico" else "empirico_fallback",
      periodo_referencia  = "2021-2024"
    ),
    recesion_moderada = list(
      impacto_mensual     = vec_recesion,
      impacto_medio_anual = -12,
      tipo                = "empirico_aproximado",
      periodo_referencia  = "2020 distribuido por perfil 2019"
    ),
    plan_moves = list(
      impacto_mensual     = vec_moves,
      impacto_medio_anual = 8,
      tipo                = "literatura",
      fuente              = "Cantos-Sanchez et al. 2015"
    ),
    subida_tipos = list(
      impacto_mensual     = vec_bce,
      impacto_medio_anual = -6,
      tipo                = "literatura",
      fuente              = "BCE 2022-2023"
    ),
    semiconductores = list(
      impacto_mensual     = vec_semis,
      impacto_medio_anual = -10,
      tipo                = "literatura",
      duracion_meses      = 3
    )
  )
)

if (isTRUE(APLICAR_AL_JSON)) {
  write_json(
    payload, path = out_path, pretty = TRUE,
    auto_unbox = TRUE, digits = 4, na = "null"
  )
  cat(sprintf("\n[OK] JSON exportado a:\n  %s\n",
              normalizePath(out_path, winslash = "/", mustWork = FALSE)))
} else {
  cat("\n[SKIP] APLICAR_AL_JSON=FALSE: NO se sobrescribe escenarios_vectores.json.\n")
  cat("       Revisa la validacion en validacion_evento1/ y vuelve a correr el script\n")
  cat("       con APLICAR_AL_JSON=TRUE cuando estes conforme.\n")
}

invisible(NULL)
