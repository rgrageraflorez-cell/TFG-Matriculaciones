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
