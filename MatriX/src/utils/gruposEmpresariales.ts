/**
 * gruposEmpresariales.ts
 * ────────────────────────────────────────────────────────────────
 * Mapeo marca → grupo empresarial para el análisis consolidado del
 * mercado automovilístico. Las claves están normalizadas (mayúsculas
 * sin tildes) para coincidir con el formato del CSV de matriculaciones.
 * Las marcas no listadas caen en "Otros".
 * ────────────────────────────────────────────────────────────────
 */

export const MARCA_GRUPO: Record<string, string> = {
  // Volkswagen Group
  "VW": "Volkswagen Group",
  "VOLKSWAGEN": "Volkswagen Group",
  "AUDI": "Volkswagen Group",
  "SEAT": "Volkswagen Group",
  "SKODA": "Volkswagen Group",
  "PORSCHE": "Volkswagen Group",
  "CUPRA": "Volkswagen Group",

  // Stellantis
  "PEUGEOT": "Stellantis",
  "CITROEN": "Stellantis",
  "OPEL": "Stellantis",
  "FIAT": "Stellantis",
  "ALFA ROMEO": "Stellantis",
  "ALFA-ROMEO": "Stellantis",
  "JEEP": "Stellantis",
  "DS": "Stellantis",
  "LANCIA": "Stellantis",

  // Renault Group
  "RENAULT": "Renault Group",
  "DACIA": "Renault Group",

  // Toyota Group
  "TOYOTA": "Toyota Group",
  "LEXUS": "Toyota Group",

  // Hyundai Group
  "HYUNDAI": "Hyundai Group",
  "KIA": "Hyundai Group",

  // BMW Group
  "BMW": "BMW Group",
  "MINI": "BMW Group",

  // Mercedes Group
  "MERCEDES": "Mercedes Group",
  "MERCEDES-BENZ": "Mercedes Group",
  "SMART": "Mercedes Group",

  // Independientes
  "FORD": "Ford",
  "HONDA": "Honda",
  "NISSAN": "Nissan",
  "MAZDA": "Mazda",
  "VOLVO": "Volvo",
};

export const getGrupo = (marca: string): string => {
  const marcaNorm = String(marca ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  return MARCA_GRUPO[marcaNorm] ?? "Otros";
};

/** Paleta consistente con el sistema ejecutivo del dashboard.
 *  Tonos navy de oscuro a claro + gris para "Otros". */
export const COLORES_GRUPOS: string[] = [
  "#1A2B4A", // navy primario (líder)
  "#243C66", // navy secundario
  "#2C4A7C", // azul medio
  "#3B5A8A", // azul medio claro
  "#4D6E9D", // azul claro
  "#5F82AF", // azul muy claro
  "#7396C2", // azul pastel
  "#88AAD5", // azul pastel claro
  "#9DBEE7", // azul claro neutro
  "#B3D2F9", // azul muy claro neutro
];

export const COLOR_OTROS = "#6B7280";

/** Devuelve el color asignado al grupo según su posición en el ranking. */
export const colorParaGrupo = (grupo: string, ranking: number): string => {
  if (grupo === "Otros") return COLOR_OTROS;
  return COLORES_GRUPOS[Math.min(ranking, COLORES_GRUPOS.length - 1)];
};
