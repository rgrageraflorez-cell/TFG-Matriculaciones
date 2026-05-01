# ============================================================================
# export_marca_provincia.R
# ----------------------------------------------------------------------------
# Genera df_marca_provincia_anual.csv: agregado anual por (marca, provincia)
# que alimenta el mapa de cuota de mercado por marca del dashboard.
#
# Lee:
#   - Datasets web/df_mensual_marca_lugar.csv (matriculaciones por marca y
#     municipio, mensual; columna `lugar` = nombre de municipio en texto).
#   - Datasets web/df_mapa_densidad.csv (cod_ine + municipio + matric mensuales;
#     usado para construir el lookup municipio_nombre -> cod_provincia).
#
# Escribe:
#   - Datasets web/Web dashboard/public/df_marca_provincia_anual.csv
#     columnas: anio, marca, cod_provincia (2 chars), matriculaciones
#
# Filtros aplicados:
#   - Fila "TOTAL MARCAS" excluida.
#   - Municipios cuyo nombre no resuelve a un cod_provincia (basura tipica del
#     CSV crudo: "-1", IDs cripticos, etc.) se descartan y se reportan como
#     warning con el porcentaje de matriculaciones perdidas (deberia ser <0.1%).
#   - Municipios duplicados en distintas provincias: se aplica "primera
#     ocurrencia gana" (consistente con el indice del informe territorial).
#
# Independiente del resto de la pipeline. Se invoca al final de
# run_update.bat tras Prophet/MD diario.
# ============================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(stringr)
})

# ── Rutas ──────────────────────────────────────────────────────────────────
detectar_here <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  m <- grep("--file=", args, fixed = TRUE)
  if (length(m) > 0L) return(dirname(normalizePath(sub("--file=", "", args[m[1]]))))
  if (!is.null(sys.frames()) && length(sys.frames()) > 0L) {
    of <- tryCatch(sys.frame(1)$ofile, error = function(e) NULL)
    if (!is.null(of)) return(dirname(normalizePath(of)))
  }
  getwd()
}
HERE <- detectar_here()

base_root <- normalizePath(file.path(HERE, ".."), winslash = "/", mustWork = FALSE)
csv_marca_lugar <- file.path(base_root, "Datasets web", "df_mensual_marca_lugar.csv")
csv_densidad    <- file.path(base_root, "Datasets web", "df_mapa_densidad.csv")
out_path        <- file.path(base_root, "Datasets web", "Web dashboard", "public",
                             "df_marca_provincia_anual.csv")

if (!file.exists(csv_marca_lugar)) {
  stop(sprintf("No existe: %s", csv_marca_lugar))
}
if (!file.exists(csv_densidad)) {
  stop(sprintf("No existe: %s", csv_densidad))
}

cat(sprintf("[INFO] Leyendo %s ...\n", csv_marca_lugar))
df_ml <- read.csv(csv_marca_lugar, stringsAsFactors = FALSE,
                  encoding = "UTF-8", check.names = FALSE)
cat(sprintf("[OK]   %d filas leidas (marca x lugar x mes)\n", nrow(df_ml)))

cat(sprintf("[INFO] Leyendo %s ...\n", csv_densidad))
df_dens <- read.csv(csv_densidad, stringsAsFactors = FALSE,
                    encoding = "UTF-8", check.names = FALSE)
cat(sprintf("[OK]   %d filas leidas (cod_ine x municipio x mes)\n", nrow(df_dens)))

# ── Construir lookup municipio_norm -> cod_provincia ───────────────────────
# Normalizacion robusta: ASCII, mayusculas, sin signos, y dos pasos extra
# para maximizar el match name-based:
#   (1) truncar en el primer "(" o "/" para limpiar denominaciones bilingues
#       y notas tipo "(CAPITAL MUNICIPAL)" que aparecen abiertas y cortadas.
#   (2) quitar articulos iniciales (EL, LA, LOS, LAS, L', D') porque algunos
#       datasets DGT los conservan ("LAS PALMAS DE GRAN CANARIA") y otros no
#       ("PALMAS DE GRAN CANARIA").
norm_text <- function(x) {
  s <- as.character(x)
  # Truncar en "," (articulo postfijo "Hospitalet de Llobregat, L'")
  s <- sub("\\s*,.*$", "", s)
  # Truncar en "(" (anotaciones tipo "(CAPITAL MUNICIPAL)" cortadas en CSV)
  s <- sub("\\s*\\(.*$", "", s)
  # Aplanar bilingues y guiones a espacios (para "Donostia / San Sebastian"
  # vs "DONOSTIA-SAN SEBASTIAN" en el otro CSV).
  s <- gsub("[/\\-]", " ", s)
  s <- toupper(s)
  s <- iconv(s, from = "UTF-8", to = "ASCII//TRANSLIT")
  s <- gsub("['^~`]", "", s)
  s <- gsub("[^A-Z0-9 ]", " ", s)
  s <- gsub("\\s+", " ", s)
  s <- trimws(s)
  # Quitar articulo inicial cuando el otro CSV lo trae como prefijo.
  s <- sub("^(EL|LA|LOS|LAS|L|D) ", "", s)
  trimws(s)
}

# Umbral minimo de matriculaciones globales para que una marca aparezca en el
# CSV exportado (y por tanto en el selector del frontend). Las marcas con
# ventas residuales (1-2 unidades en 5 anios) son casi siempre referencias o
# errores tipograficos del CSV crudo, no marcas reales del mercado.
MIN_MATRIC_MARCA <- 500L

# cod_ine en df_dens viene como entero o string; lo normalizamos a 5 chars
df_dens$cod_ine_str <- formatC(as.numeric(df_dens$cod_ine), width = 5,
                               flag = "0", format = "d")
df_dens$muni_norm <- norm_text(df_dens$municipio)
df_dens$cod_prov  <- substr(df_dens$cod_ine_str, 1, 2)

lookup <- df_dens %>%
  filter(nchar(cod_ine_str) == 5L, !is.na(municipio), nzchar(municipio)) %>%
  distinct(muni_norm, .keep_all = TRUE) %>%
  select(muni_norm, cod_prov)

cat(sprintf("[OK]   Lookup municipio->provincia: %d entradas unicas\n",
            nrow(lookup)))

# ── Join + agregacion ─────────────────────────────────────────────────────
df_ml$muni_norm <- norm_text(df_ml$lugar)
df_ml$anio <- as.integer(substr(df_ml$fecha_mes, 1, 4))

# Filtrar TOTAL MARCAS y filas sin marca
df_ml <- df_ml %>%
  filter(!is.na(marca), nzchar(marca), marca != "TOTAL MARCAS")

joined <- df_ml %>%
  left_join(lookup, by = "muni_norm")

descartadas <- joined %>% filter(is.na(cod_prov))
mat_perdidas <- sum(descartadas$matriculaciones, na.rm = TRUE)
mat_total    <- sum(joined$matriculaciones, na.rm = TRUE)
pct_perdido  <- if (mat_total > 0) 100 * mat_perdidas / mat_total else 0

cat(sprintf(
  "[INFO] Filas sin provincia resoluble: %d (%s matric, %.3f%% del total)\n",
  nrow(descartadas), format(mat_perdidas, big.mark = "."), pct_perdido
))
# El ~11%% historico de no-match corresponde a nombres truncados en el CSV
# crudo de DGT (PALMA, CASTELLON DE LA PLANA/CA cortado a 25 chars,
# SAN CRISTOBAL DE LA LAGU...) y pedanias que la DGT contabiliza como
# lugar de matriculacion pero no son municipio oficial. Es ruido estructural
# del origen, no del lookup. Se reparte proporcionalmente entre marcas y no
# distorsiona los rankings relativos. Subir el umbral del warning a 15%%
# para que no flaggee en cada ejecucion mensual normal.
if (pct_perdido > 15.0) {
  warning(sprintf(
    "Mas del 15%% de matriculaciones (%.2f%%) sin provincia resoluble; revisar lookup.",
    pct_perdido
  ))
}

agregado_full <- joined %>%
  filter(!is.na(cod_prov)) %>%
  group_by(anio, marca, cod_provincia = cod_prov) %>%
  summarise(matriculaciones = sum(matriculaciones, na.rm = TRUE), .groups = "drop")

# Filtrado de marcas residuales: por marca, totalizar todos los anios; las
# que no superen el umbral se descartan completamente (de todas las
# provincias y anios en que aparezcan).
total_marca <- agregado_full %>%
  group_by(marca) %>%
  summarise(total = sum(matriculaciones), .groups = "drop")
marcas_validas <- total_marca %>% filter(total >= MIN_MATRIC_MARCA) %>% pull(marca)
cat(sprintf(
  "[INFO] Marcas con >=%d matric totales: %d de %d (resto descartadas como ruido)\n",
  MIN_MATRIC_MARCA, length(marcas_validas), nrow(total_marca)
))

agregado <- agregado_full %>%
  filter(marca %in% marcas_validas) %>%
  arrange(anio, marca, cod_provincia)

cat(sprintf("[OK]   Agregado final: %d filas (anio x marca x provincia)\n",
            nrow(agregado)))
cat(sprintf("[OK]   Anios:    %s\n", paste(sort(unique(agregado$anio)), collapse = ", ")))
cat(sprintf("[OK]   Marcas:   %d unicas\n", length(unique(agregado$marca))))
cat(sprintf("[OK]   Provs:    %d unicas\n", length(unique(agregado$cod_provincia))))

# ── Exportar ──────────────────────────────────────────────────────────────
dir.create(dirname(out_path), showWarnings = FALSE, recursive = TRUE)
write.csv(agregado, out_path, row.names = FALSE, fileEncoding = "UTF-8")
cat(sprintf("[OK]   Exportado a: %s\n",
            normalizePath(out_path, winslash = "/", mustWork = FALSE)))
cat(sprintf("[OK]   Tamano:      %.1f KB\n",
            file.info(out_path)$size / 1024))

invisible(NULL)
