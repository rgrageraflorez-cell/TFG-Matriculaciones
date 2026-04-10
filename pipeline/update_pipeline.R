# ============================================================
# UPDATE_PIPELINE.R
# Pipeline agentico de actualizacion de datos para el dashboard
# TFG - Analisis de la demanda automovilistica en Espana
#
# PROPOSITO:
# Script autocontenido que regenera los 5 CSVs del dashboard
# a partir de los ficheros Excel fuente de la DGT e INE.
# Disenado para ejecutarse con: Rscript update_pipeline.R
#
# SALIDA (5 CSVs):
#   1. df_mensual_agrupado.csv     (serie mensual total)
#   2. df_mensual_marca.csv        (serie mensual por marca)
#   3. df_mensual_marca_lugar.csv  (serie mensual marca+lugar)
#   4. df_mapa_densidad.csv        (mapa densidad municipios)
#   5. df_real_pred_mensual_total.csv (real + prediccion TBATS)
# ============================================================

cat("========================================\n")
cat("PIPELINE DE ACTUALIZACION DE DATOS\n")
cat(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n")
cat("========================================\n\n")

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
  library(tidyr)
  library(stringr)
  library(lubridate)
  library(readr)
  library(forecast)
  library(mapSpain)
  library(sf)
})

# ============================================================
# CONFIGURACION DE RUTAS
# ============================================================

# Raiz del proyecto
BASE_DIR <- normalizePath("~/4 Carrera/TFG/Practica", winslash = "/")

# Fuentes de datos
DATA_DIR    <- file.path(BASE_DIR, "Filtrado de datos/Dataset/Matriculaciones ES")
INE_DIR     <- file.path(BASE_DIR, "Filtrado de datos/Dataset")

# Directorio de salida
OUT_DIR     <- file.path(BASE_DIR, "Analisis/Datasets web")
PUBLIC_DIR  <- file.path(BASE_DIR, "Analisis/Datasets web/Web dashboard/public")

# Verificar que existen
stopifnot(
  "Directorio de datos no encontrado" = dir.exists(DATA_DIR),
  "Directorio INE no encontrado"      = dir.exists(INE_DIR),
  "Directorio de salida no encontrado" = dir.exists(OUT_DIR),
  "Directorio public no encontrado"    = dir.exists(PUBLIC_DIR)
)

# ============================================================
# 1. CARGA DE DATOS MENSUALES (TODOS LOS ANOS)
# ============================================================
cat("[1/6] Cargando ficheros Excel mensuales...\n")

# Funcion para cargar un Excel de analisis mensual (2 sheets: S1=ene-jun, S2=jul-dic)
load_analisis_mensual <- function(filepath) {
  sheets <- excel_sheets(filepath)
  dfs <- lapply(seq_along(sheets), function(i) {
    tryCatch(
      read_excel(filepath, sheet = i),
      error = function(e) {
        cat("  Aviso: no se pudo leer sheet", i, "de", basename(filepath), "\n")
        NULL
      }
    )
  })
  bind_rows(Filter(Negate(is.null), dfs))
}

# Funcion para cargar mensualidad agrupada (1 sheet por mes)
load_mensualidad_agrupada <- function(filepath) {
  sheets <- excel_sheets(filepath)
  dfs <- lapply(seq_along(sheets), function(i) {
    tryCatch(
      read_excel(filepath, sheet = i),
      error = function(e) {
        cat("  Aviso: no se pudo leer sheet", i, "de", basename(filepath), "\n")
        NULL
      }
    )
  })
  bind_rows(Filter(Negate(is.null), dfs))
}

# Detectar ficheros disponibles
analisis_files <- list.files(DATA_DIR, pattern = "^An.lisis mensual \\d{4}\\.xlsx$",
                              full.names = TRUE, ignore.case = TRUE)
agrupada_files <- list.files(DATA_DIR, pattern = "^mensualidad agrupada \\d{4}\\.xlsx$",
                              full.names = TRUE, ignore.case = TRUE)

cat("  Ficheros 'Analisis mensual' encontrados:", length(analisis_files), "\n")
cat("  Ficheros 'mensualidad agrupada' encontrados:", length(agrupada_files), "\n")

# Cargar todos
all_raw <- list()

for (f in analisis_files) {
  year_str <- str_extract(basename(f), "\\d{4}")
  cat("  Cargando:", basename(f), "\n")
  all_raw[[paste0("analisis_", year_str)]] <- load_analisis_mensual(f)
}

for (f in agrupada_files) {
  year_str <- str_extract(basename(f), "\\d{4}")
  cat("  Cargando:", basename(f), "\n")
  all_raw[[paste0("agrupada_", year_str)]] <- load_mensualidad_agrupada(f)
}

# Unir todo
df_all <- bind_rows(all_raw)
cat("  Total filas cargadas:", format(nrow(df_all), big.mark = "."), "\n")

# ============================================================
# 2. NORMALIZACION Y LIMPIEZA
# ============================================================
cat("\n[2/6] Normalizando y limpiando datos...\n")

# Detectar columna de fecha (puede ser "fecha", "fecha matriculacion", etc.)
fecha_col <- names(df_all)[str_detect(tolower(names(df_all)), "fecha")][1]
marca_col <- names(df_all)[str_detect(tolower(names(df_all)), "marca")][1]
lugar_col <- names(df_all)[str_detect(tolower(names(df_all)), "lugar")][1]

if (is.na(fecha_col)) stop("No se encontro columna de fecha en los datos")
cat("  Columna de fecha detectada:", fecha_col, "\n")
cat("  Columna de marca detectada:", ifelse(is.na(marca_col), "NO ENCONTRADA", marca_col), "\n")
cat("  Columna de lugar detectada:", ifelse(is.na(lugar_col), "NO ENCONTRADA", lugar_col), "\n")

# Renombrar a nombres estandar
df_clean <- df_all %>%
  rename(fecha_raw = !!sym(fecha_col))

if (!is.na(marca_col)) df_clean <- df_clean %>% rename(marca = !!sym(marca_col))
if (!is.na(lugar_col)) df_clean <- df_clean %>% rename(lugar = !!sym(lugar_col))

# Limpiar
df_clean <- df_clean %>%
  mutate(
    fecha = as.Date(fecha_raw),
    marca = if ("marca" %in% names(.)) str_to_upper(str_trim(as.character(marca))) else NA_character_,
    lugar = if ("lugar" %in% names(.)) {
      str_trim(as.character(lugar)) %>%
        str_replace("^[0-9]+", "") %>%
        str_trim()
    } else NA_character_
  ) %>%
  filter(!is.na(fecha), !is.na(marca), marca != "") %>%
  mutate(
    fecha_mes = floor_date(fecha, "month"),
    Ano = year(fecha_mes),
    Mes = month(fecha_mes)
  )

cat("  Filas tras limpieza:", format(nrow(df_clean), big.mark = "."), "\n")
cat("  Rango de fechas:", as.character(min(df_clean$fecha)), "a", as.character(max(df_clean$fecha)), "\n")
cat("  Marcas unicas:", n_distinct(df_clean$marca), "\n")

# ============================================================
# 3. GENERAR CSVs MENSUALES
# ============================================================
cat("\n[3/6] Generando datasets mensuales...\n")

# 3a. df_mensual_agrupado (serie total)
df_mensual_agrupado <- df_clean %>%
  group_by(Ano, Mes) %>%
  summarise(Turismos = n(), .groups = "drop") %>%
  rename(`Año` = Ano) %>%
  arrange(`Año`, Mes)

cat("  df_mensual_agrupado:", nrow(df_mensual_agrupado), "filas\n")

# 3b. df_mensual_marca
df_mensual_marca <- df_clean %>%
  group_by(fecha_mes, Ano, Mes, marca) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  rename(`Año` = Ano) %>%
  arrange(fecha_mes, marca)

cat("  df_mensual_marca:", nrow(df_mensual_marca), "filas\n")

# 3c. df_mensual_marca_lugar
df_mensual_marca_lugar <- df_clean %>%
  filter(!is.na(lugar), lugar != "") %>%
  group_by(fecha_mes, Ano, Mes, marca, lugar) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  rename(`Año` = Ano) %>%
  arrange(fecha_mes, marca, lugar)

cat("  df_mensual_marca_lugar:", nrow(df_mensual_marca_lugar), "filas\n")

# ============================================================
# 4. MODELO TBATS Y PREDICCIONES
# ============================================================
cat("\n[4/6] Ajustando modelo TBATS y generando predicciones...\n")

ts_mensual <- ts(
  df_mensual_agrupado$Turismos,
  start = c(min(df_mensual_agrupado$`Año`), min(df_mensual_agrupado$Mes[df_mensual_agrupado$`Año` == min(df_mensual_agrupado$`Año`)])),
  frequency = 12
)

# Entrenar TBATS hasta el penultimo ano completo
ultimo_ano_completo <- max(df_mensual_agrupado$`Año`[df_mensual_agrupado$Mes == 12])
cat("  Ultimo ano completo:", ultimo_ano_completo, "\n")

train <- window(ts_mensual, end = c(ultimo_ano_completo, 12))
cat("  Entrenando TBATS con", length(train), "observaciones...\n")

fit_tbats <- tbats(train)
cat("  TBATS ajustado. AIC:", round(fit_tbats$AIC, 2), "\n")

# Forecast: 24 meses adelante
h_forecast <- 24
fc <- forecast(fit_tbats, h = h_forecast)

# Construir serie completa: fitted + forecast
fitted_vals <- as.numeric(fitted(fit_tbats))
pred_vals <- as.numeric(fc$mean)
model_series <- ts(c(fitted_vals, pred_vals),
                   start = start(train),
                   frequency = 12)

# Crear df_real_pred
fechas_reales <- seq.Date(
  from = as.Date(sprintf("%d-%02d-01", start(ts_mensual)[1], start(ts_mensual)[2])),
  by = "month",
  length.out = length(ts_mensual)
)

df_real <- data.frame(
  fecha_mes = fechas_reales,
  real = as.numeric(ts_mensual)
)

fechas_pred <- seq.Date(
  from = as.Date(sprintf("%d-%02d-01", start(model_series)[1], start(model_series)[2])),
  by = "month",
  length.out = length(model_series)
)

df_pred <- data.frame(
  fecha_mes = fechas_pred,
  prediccion = as.numeric(model_series)
)

df_real_pred_mensual_total <- full_join(df_real, df_pred, by = "fecha_mes") %>%
  arrange(fecha_mes) %>%
  mutate(
    tipo_periodo = case_when(
      !is.na(real) & is.na(prediccion) ~ "Historico",
      !is.na(real) & !is.na(prediccion) ~ "Historico + prediccion",
      is.na(real)  & !is.na(prediccion) ~ "Prediccion",
      TRUE ~ "Sin dato"
    )
  )

cat("  Predicciones generadas:", nrow(df_real_pred_mensual_total), "filas\n")
cat("  Horizonte de prediccion hasta:", as.character(max(df_real_pred_mensual_total$fecha_mes)), "\n")

# ============================================================
# 5. MAPA DE DENSIDAD MUNICIPAL
# ============================================================
cat("\n[5/6] Construyendo mapa de densidad municipal...\n")

# 5a. Obtener shapefile de municipios
map_muni <- esp_get_munic()
map_muni <- map_muni %>%
  mutate(
    muni_id = paste0(ine.prov.name, "_", name),
    muni_UP = toupper(name)
  )

# 5b. Agregar matriculaciones por municipio y mes
# Usamos los datos del ultimo ano disponible (mas completo)
ultimo_ano <- max(df_clean$Ano)
cat("  Usando datos de", ultimo_ano, "para mapa de densidad\n")

df_muni_mensual <- df_clean %>%
  filter(Ano == ultimo_ano) %>%
  mutate(muni_UP = toupper(lugar)) %>%
  group_by(muni_UP, Ano, Mes) %>%
  summarise(matriculaciones = n(), .groups = "drop") %>%
  mutate(fecha = as.Date(sprintf("%d-%02d-01", Ano, Mes)))

# 5c. Join con shapefile
muni_ref <- map_muni %>%
  st_drop_geometry() %>%
  select(muni_id, muni_UP) %>%
  distinct()

df_muni_mensual_id <- df_muni_mensual %>%
  left_join(muni_ref, by = "muni_UP") %>%
  filter(!is.na(muni_id))

# Grid completo (todos los municipios x todas las fechas)
muni_ids <- unique(df_muni_mensual_id$muni_id)
fechas <- sort(unique(df_muni_mensual_id$fecha))

grid_muni_fecha <- expand.grid(
  muni_id = muni_ids,
  fecha = fechas,
  stringsAsFactors = FALSE
)

df_muni_full <- grid_muni_fecha %>%
  left_join(
    df_muni_mensual_id %>% select(muni_id, fecha, matriculaciones),
    by = c("muni_id", "fecha")
  ) %>%
  mutate(matriculaciones = ifelse(is.na(matriculaciones), 0, matriculaciones))

# 5d. Unir con geometria
map_muni_base <- map_muni %>%
  select(muni_id, LAU_CODE, name, geometry)

map_real_muni <- map_muni_base %>%
  left_join(df_muni_full, by = "muni_id")

# 5e. Anadir cod_ine
map_real_muni <- map_real_muni %>%
  mutate(cod_ine = sprintf("%05s", as.character(LAU_CODE))) %>%
  select(cod_ine, name, fecha, matriculaciones, geometry)

# 5f. Anadir poblacion del INE
pob_file <- file.path(INE_DIR, "Poblacion por municipio- INE.xlsx")
if (file.exists(pob_file)) {
  pobla_muni <- read_excel(pob_file)
  pobla_muni_clean <- pobla_muni %>%
    rename(cod_raw = cod_ine, poblacion = `Población`) %>%
    mutate(cod_ine = sprintf("%05d", as.integer(cod_raw))) %>%
    select(cod_ine, poblacion)

  map_real_muni <- map_real_muni %>%
    left_join(pobla_muni_clean, by = "cod_ine")

  # Calcular ratio
  map_real_muni <- map_real_muni %>%
    mutate(
      ratio_mat_pob = ifelse(!is.na(poblacion) & poblacion > 0,
                              matriculaciones / poblacion, NA_real_),
      ratio_x1000 = ratio_mat_pob * 1000
    )
  cat("  Poblacion y ratio calculados\n")
} else {
  cat("  AVISO: Fichero de poblacion no encontrado, ratio no disponible\n")
  map_real_muni <- map_real_muni %>%
    mutate(ratio_x1000 = NA_real_)
}

# 5g. Generar CSV sin geometria
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

cat("  df_mapa_densidad:", nrow(df_mapa_densidad), "filas,",
    n_distinct(df_mapa_densidad$municipio), "municipios,",
    n_distinct(df_mapa_densidad$fecha), "meses\n")

# 5h. Regenerar GeoJSON si es necesario (solo geometrias unicas, sin duplicados por fecha)
geojson_path <- file.path(PUBLIC_DIR, "espana.geojson")
if (!file.exists(geojson_path)) {
  cat("  Generando espana.geojson...\n")
  geo_unique <- map_muni_base %>%
    mutate(cod_ine = sprintf("%05s", as.character(LAU_CODE))) %>%
    select(cod_ine, name, geometry) %>%
    distinct(cod_ine, .keep_all = TRUE)
  st_write(geo_unique, geojson_path, delete_dsn = TRUE, quiet = TRUE)
  cat("  GeoJSON generado:", nrow(geo_unique), "municipios unicos\n")
}

# ============================================================
# 6. ESCRIBIR CSVs
# ============================================================
cat("\n[6/6] Escribiendo CSVs...\n")

# Escribir a Datasets web/
write.csv(df_mensual_marca, file.path(OUT_DIR, "df_mensual_marca.csv"), row.names = FALSE)
write.csv(df_mensual_marca_lugar, file.path(OUT_DIR, "df_mensual_marca_lugar.csv"), row.names = FALSE)
write.csv(df_mensual_agrupado, file.path(OUT_DIR, "df_mensual_agrupado.csv"), row.names = FALSE)
write_csv(df_mapa_densidad, file.path(OUT_DIR, "df_mapa_densidad.csv"))
write_csv(df_real_pred_mensual_total, file.path(OUT_DIR, "df_real_pred_mensual_total.csv"))

# Copiar a public/ del dashboard
file.copy(file.path(OUT_DIR, "df_mensual_marca.csv"), file.path(PUBLIC_DIR, "df_mensual_marca.csv"), overwrite = TRUE)
file.copy(file.path(OUT_DIR, "df_mensual_marca_lugar.csv"), file.path(PUBLIC_DIR, "df_mensual_marca_lugar.csv"), overwrite = TRUE)
file.copy(file.path(OUT_DIR, "df_mensual_agrupado.csv"), file.path(PUBLIC_DIR, "df_mensual_agrupado.csv"), overwrite = TRUE)
file.copy(file.path(OUT_DIR, "df_mapa_densidad.csv"), file.path(PUBLIC_DIR, "df_mapa_densidad.csv"), overwrite = TRUE)
file.copy(file.path(OUT_DIR, "df_real_pred_mensual_total.csv"), file.path(PUBLIC_DIR, "df_real_pred_mensual_total.csv"), overwrite = TRUE)

cat("  CSVs escritos en:", OUT_DIR, "\n")
cat("  CSVs copiados a:", PUBLIC_DIR, "\n")

# ============================================================
# RESUMEN FINAL
# ============================================================
cat("\n========================================\n")
cat("PIPELINE COMPLETADO\n")
cat(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), "\n")
cat("========================================\n")
cat("Datasets generados:\n")
cat("  1. df_mensual_agrupado.csv    :", nrow(df_mensual_agrupado), "filas\n")
cat("  2. df_mensual_marca.csv       :", nrow(df_mensual_marca), "filas\n")
cat("  3. df_mensual_marca_lugar.csv :", nrow(df_mensual_marca_lugar), "filas\n")
cat("  4. df_mapa_densidad.csv       :", nrow(df_mapa_densidad), "filas\n")
cat("  5. df_real_pred_mensual_total :", nrow(df_real_pred_mensual_total), "filas\n")
cat("\nPrediccion TBATS hasta:", as.character(max(df_real_pred_mensual_total$fecha_mes)), "\n")
cat("Ultimo dato real:", as.character(max(df_real$fecha_mes)), "\n")
cat("\nPara reconstruir el dashboard ejecutar:\n")
cat("  cd 'Datasets web/Web dashboard' && npm run build\n")
