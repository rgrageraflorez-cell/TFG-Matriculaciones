export type MonthlyAggRow = {
  Año: number;
  Mes: number;
  Turismos: number;
};

export type MonthlyBrandRow = {
  fecha_mes: string;
  marca: string;
  matriculaciones: number;
};

export type PredictionRow = {
  fecha_mes: string;
  real: number | null;
  prediccion: number | null;
  pred_prophet: number | null;
  tipo_periodo?: string;
};

export type MapDensityRow = {
  cod_ine?: string | number;
  fecha: string;
  municipio: string;
  matriculaciones: number;
  ratio_x1000: number;
};

export type GeoFeature = {
  type: string;
  properties: Record<string, any>;
  geometry: any;
};

export type GeoJsonType = {
  type: string;
  features: GeoFeature[];
};

export type DailyPredRow = {
  fecha: string;
  real: number;
  pred_md: number;
  pred_baseline: number;
  dow: string;
  laborable: number;
  w_opt: number;
  alpha_opt: number;
};

export type TabId = "descriptiva" | "predictiva" | "cognitiva" | "suscripcion";

export type Subscriber = {
  nombre: string;
  email: string;
  provincia: string;
  cluster: string;
  informe_mensual?: boolean;
  created_at: string;
  updated_at: string;
};
