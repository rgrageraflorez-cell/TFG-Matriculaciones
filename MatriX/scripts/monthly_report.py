"""
monthly_report.py
───────────────────────────────────────────────────────────────────────────────
Informe ejecutivo mensual de matriculaciones por email.

Independiente de alert_engine.py — comparte solo la lectura de subscribers.json
y los CSVs. Lee los suscriptores con informe_mensual=true y envia a cada uno
un email HTML personalizado con cinco bloques: pulso del mercado, prediccion,
datos provinciales, score territorial y alerta (si hay eventos).

Variables de entorno:
  RESEND_API_KEY     clave de API de Resend (obligatoria)
  REPORT_SENDER      remitente (opcional; por defecto informes@matriculaciones.es)
  DASHBOARD_URL      URL del dashboard (opcional; por defecto http://localhost:5173)

Uso:
  python monthly_report.py                    # ejecucion directa
  from monthly_report import main; main()     # desde otro script

Requiere: pandas, python-dotenv, resend  (ver requirements.txt)
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import os
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ── Rutas por defecto ──────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
PUBLIC_DIR = HERE.parent / "public"
DEFAULT_SUBS = HERE / "subscribers.json"
DEFAULT_CSV_PRED = PUBLIC_DIR / "df_real_pred_mensual_total.csv"
DEFAULT_CSV_AGRUPADO = PUBLIC_DIR / "df_mensual_agrupado.csv"
DEFAULT_CSV_MAPA = PUBLIC_DIR / "df_mapa_densidad.csv"
DEFAULT_CSV_MARCA_LUGAR = PUBLIC_DIR / "df_mensual_marca_lugar.csv"
DEFAULT_GEOJSON = HERE / "provincias.geojson"
DEFAULT_LOG = HERE / "monthly_report_log.txt"
DEFAULT_SENDER = "informes@matriculaciones.es"
DEFAULT_DASHBOARD_URL = "http://localhost:5173"

# ── Paleta de diseño ejecutivo ─────────────────────────────────────────────
COLOR_NAVY = "#0A1628"
COLOR_GOLD = "#C9A84C"
COLOR_CARD = "#F8F9FA"
COLOR_BORDER = "#E2E8F0"
COLOR_TEXT = "#4A5568"
COLOR_TEXT_DARK = "#1A202C"
COLOR_GRAY_LIGHT = "#F3F4F6"
COLOR_ALERT_BG = "#FFFBEB"
COLOR_ALERT_BORDER = "#F59E0B"
COLOR_SUCCESS = "#059669"
COLOR_DANGER = "#DC2626"

# ── Umbrales (iguales a alert_engine.py) ───────────────────────────────────
THR_PICO = 0.10
THR_VALLE = 0.10
THR_TENDENCIA = 0.05
THR_SALTO = 0.15
MESES_HORIZONTE_ALERTA = 6

# ── Umbral clasificacion alcista/bajista del proximo mes ───────────────────
THR_PROX_MES = 0.03  # +/-3%

# ── Anomalias IVTM confirmadas (replicado de scoreTerritorial.ts) ──────────
ANOMALIAS_CONFIRMADAS = [
    {"nombre": "AGUILAR DE SEGARRA", "provincia": None},
    {"nombre": "RAJADELL", "provincia": None},
    {"nombre": "TORRENT", "provincia": "GIRONA"},
]

MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


# ═══════════════════════════════════════════════════════════════════════════
# UTILIDADES
# ═══════════════════════════════════════════════════════════════════════════
def norm(s: Any) -> str:
    """Mayusculas sin tildes, trim."""
    if s is None:
        return ""
    txt = str(s).strip()
    if not txt:
        return ""
    nfd = unicodedata.normalize("NFD", txt)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").upper()


def fmt_int(n: float) -> str:
    return f"{int(round(n)):,}".replace(",", ".")


def fmt_pct(x: float, signed: bool = True, decimals: int = 1) -> str:
    sign = "+" if signed and x >= 0 else ""
    return f"{sign}{x * 100:.{decimals}f}%"


def fmt_dec(n: float, decimals: int = 1) -> str:
    return f"{n:.{decimals}f}".replace(".", ",")


def fmt_mes_anio(year: int, month: int) -> str:
    return f"{MESES_ES[month - 1]} {year}"


# ═══════════════════════════════════════════════════════════════════════════
# CARGA DE DATOS
# ═══════════════════════════════════════════════════════════════════════════
def _blob_url() -> str | None:
    """Construye la URL del blob de suscriptores con pathname obfuscado.

    pathname = subscribers/<sha256(SUBSCRIBERS_SECRET + "v1")>.json

    Devuelve None si faltan SUBSCRIBERS_SECRET o BLOB_BASE_URL.
    """
    import hashlib
    secret = os.environ.get("SUBSCRIBERS_SECRET", "").strip()
    base = os.environ.get("BLOB_BASE_URL", "").strip().rstrip("/")
    if not secret or not base:
        return None
    h = hashlib.sha256((secret + "v1").encode("utf-8")).hexdigest()
    return f"{base}/subscribers/{h}.json"


def cargar_suscriptores(path: Path) -> list[dict[str, Any]]:
    """Carga suscriptores desde Vercel Blob (URL obfuscada con secret) si
    esta configurado, si no desde JSON local como fallback.
    """
    url = _blob_url()
    if url is not None:
        import urllib.request
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if isinstance(data, list):
                        print(f"[BLOB] {len(data)} suscriptores cargados desde Vercel Blob")
                        return data
        except Exception as exc:
            print(
                f"[BLOB] WARN: no se pudo leer suscriptores desde Blob ({exc}); "
                "intentando JSON local como fallback",
                file=sys.stderr,
            )
    else:
        print(
            "[BLOB] AVISO: SUBSCRIBERS_SECRET o BLOB_BASE_URL no presentes en "
            "el entorno. Lista de suscriptores remota no consultada (uso "
            "JSON local si existe).",
            file=sys.stderr,
        )
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def cargar_agrupado(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    # Normalizar nombre Año/Ano
    if "Año" not in df.columns and "Ano" in df.columns:
        df = df.rename(columns={"Ano": "Año"})
    for col in ("Año", "Mes", "Turismos"):
        if col not in df.columns:
            raise ValueError(f"Falta columna {col} en {path.name}")
    df["Año"] = pd.to_numeric(df["Año"], errors="coerce").astype("Int64")
    df["Mes"] = pd.to_numeric(df["Mes"], errors="coerce").astype("Int64")
    df["Turismos"] = pd.to_numeric(df["Turismos"], errors="coerce")
    df = df.dropna(subset=["Año", "Mes", "Turismos"]).reset_index(drop=True)
    return df


def cargar_predicciones(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    required = {"fecha_mes", "real", "prediccion", "pred_prophet"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Columnas ausentes en {path.name}: {sorted(missing)}")
    df["fecha_mes"] = pd.to_datetime(df["fecha_mes"], errors="coerce")
    df = df.dropna(subset=["fecha_mes"]).sort_values("fecha_mes").reset_index(drop=True)
    df["mes_num"] = df["fecha_mes"].dt.month
    for col in ("real", "prediccion", "pred_prophet"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def cargar_mapa(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    for col in ("cod_ine", "fecha", "municipio", "matriculaciones", "ratio_x1000"):
        if col not in df.columns:
            raise ValueError(f"Falta columna {col} en {path.name}")
    df["cod_ine"] = df["cod_ine"].astype(str).str.zfill(5)
    df["fecha"] = pd.to_datetime(df["fecha"], errors="coerce")
    df = df.dropna(subset=["fecha"])
    df["matriculaciones"] = pd.to_numeric(df["matriculaciones"], errors="coerce").fillna(0)
    df["ratio_x1000"] = pd.to_numeric(df["ratio_x1000"], errors="coerce").fillna(0)
    df["prov_code"] = df["cod_ine"].str[:2]
    return df


def cargar_geojson_provincias(path: Path) -> dict[str, str]:
    """Devuelve dict {prov_code: provincia_name}."""
    if not path.exists():
        return {}
    try:
        geo = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    out: dict[str, str] = {}
    for f in geo.get("features", []):
        props = f.get("properties", {}) or {}
        cod = str(props.get("prov", "")).zfill(2)
        name = str(props.get("name", "")).strip()
        if cod and name:
            out[cod] = name
    return out


def cargar_tendencia_provincial(
    path: Path, df_mapa: pd.DataFrame | None = None
) -> dict[str, dict[str, float]]:
    """
    Lee df_mensual_marca_lugar.csv y agrega totales MENSUALES por provincia.

    El CSV no incluye cod_ine; trae el nombre del municipio en la columna
    'lugar'. Se cruza por nombre normalizado (mayusculas sin tildes) contra
    df_mapa_densidad.csv (que si trae cod_ine) para deducir prov_code.

    Devuelve {prov_code: {"YYYY-MM": total_matriculaciones}}.
    """
    if not path.exists():
        return {}

    # 1) Construir muni_normalizado -> prov_code (una sola vez)
    if df_mapa is None:
        try:
            df_mapa = pd.read_csv(DEFAULT_CSV_MAPA, dtype={"cod_ine": str}, low_memory=False)
        except Exception as exc:
            print(f"AVISO: no se pudo cargar df_mapa_densidad.csv: {exc}", file=sys.stderr)
            return {}
    if "cod_ine" not in df_mapa.columns or "municipio" not in df_mapa.columns:
        return {}

    muni_to_prov: dict[str, str] = {}
    cod_series = df_mapa["cod_ine"].astype(str).str.zfill(5)
    prov_series = cod_series.str[:2]
    muni_norm = df_mapa["municipio"].astype(str).map(norm).str.strip()
    for muni_n, prov in zip(muni_norm, prov_series):
        if muni_n and len(prov) == 2 and muni_n not in muni_to_prov:
            muni_to_prov[muni_n] = prov

    # 2) Streaming del CSV pesado por chunks
    resultado: dict[str, dict[str, float]] = {}
    try:
        for chunk in pd.read_csv(path, chunksize=500_000, low_memory=False, encoding="utf-8"):
            chunk.columns = [c.strip() for c in chunk.columns]
            if "lugar" not in chunk.columns or "matriculaciones" not in chunk.columns:
                return {}
            # Excluir "TOTAL MARCAS" (doble conteo)
            if "marca" in chunk.columns:
                chunk = chunk[chunk["marca"].astype(str).str.upper().str.strip() != "TOTAL MARCAS"]

            # Extraer (año, mes) priorizando 'fecha_mes'
            ym: pd.Series
            if "fecha_mes" in chunk.columns:
                f = pd.to_datetime(chunk["fecha_mes"], errors="coerce")
                ym = f.dt.year.astype("Int64").astype(str) + "-" + f.dt.month.astype("Int64").astype(str).str.zfill(2)
                mask_valid = f.notna()
            else:
                ano_col = next((c for c in chunk.columns if c.lower() in ("año", "ano")), None)
                if ano_col is None or "Mes" not in chunk.columns:
                    continue
                ano = pd.to_numeric(chunk[ano_col], errors="coerce")
                mes = pd.to_numeric(chunk["Mes"], errors="coerce")
                mask_valid = ano.notna() & mes.notna() & mes.between(1, 12)
                ym = ano.fillna(0).astype(int).astype(str) + "-" + mes.fillna(0).astype(int).astype(str).str.zfill(2)
            chunk = chunk[mask_valid].copy()
            chunk["_ym"] = ym[mask_valid].values

            # Cruce por nombre de municipio normalizado
            lug_norm = chunk["lugar"].astype(str).map(norm).str.strip()
            chunk["_prov"] = lug_norm.map(muni_to_prov)
            chunk = chunk.dropna(subset=["_prov"])

            chunk["_mat"] = pd.to_numeric(chunk["matriculaciones"], errors="coerce").fillna(0)
            agg = chunk.groupby(["_prov", "_ym"])["_mat"].sum()
            for (prov, ymk), total in agg.items():
                serie = resultado.setdefault(prov, {})
                serie[ymk] = serie.get(ymk, 0.0) + float(total)
    except Exception as exc:
        print(f"AVISO: no se pudo procesar tendencia provincial: {exc}", file=sys.stderr)
        return {}
    return resultado


# ═══════════════════════════════════════════════════════════════════════════
# DETECCION DE EVENTOS (replicado de alert_engine.py)
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class Evento:
    tipo: str              # "PICO" | "VALLE" | "TENDENCIA" | "SALTO"
    titulo: str
    mes_afectado: str
    valor_pred: float
    referencia: float
    desviacion: float
    recomendacion: str


def _rec_pico(mes: str) -> str:
    return (f"Anticipe un incremento de demanda en {mes}: refuerce stock y "
            "prepare campañas comerciales con antelación.")


def _rec_valle(mes: str) -> str:
    return (f"Ajuste planificación a la baja para {mes}: modere pedidos y "
            "concentre promociones de liquidación.")


def _rec_tendencia(positiva: bool) -> str:
    if positiva:
        return "Tendencia creciente en el horizonte. Valore reforzar plantilla comercial y negociar mayores cuotas con la marca."
    return "Tendencia decreciente en el horizonte. Priorice rotación de stock y contenga gastos no críticos."


def _rec_salto(positivo: bool, mes: str) -> str:
    if positivo:
        return f"Pico puntual esperado en {mes}. Coordine entregas y aproveche para captación comercial."
    return f"Caída brusca prevista en {mes}. Refuerce seguimiento de leads y evite sobrestock."


def detectar_pico_valle(futuro: pd.DataFrame, hist_avg: dict[int, float]) -> list[Evento]:
    eventos: list[Evento] = []
    ventana = futuro.head(MESES_HORIZONTE_ALERTA)
    for _, row in ventana.iterrows():
        ref = hist_avg.get(int(row["mes_num"]))
        if not ref:
            continue
        valor = float(row["pred_prophet"])
        desv = (valor - ref) / ref
        mes_txt = fmt_mes_anio(int(row["fecha_mes"].year), int(row["fecha_mes"].month))
        if desv > THR_PICO:
            eventos.append(Evento("PICO", f"Pico previsto en {mes_txt}", mes_txt, valor, ref, desv, _rec_pico(mes_txt)))
        elif desv < -THR_VALLE:
            eventos.append(Evento("VALLE", f"Valle previsto en {mes_txt}", mes_txt, valor, ref, desv, _rec_valle(mes_txt)))
    return eventos


def detectar_tendencia(futuro: pd.DataFrame) -> list[Evento]:
    if len(futuro) < 6:
        return []
    first3 = futuro["pred_prophet"].head(3).mean()
    last3 = futuro["pred_prophet"].tail(3).mean()
    if not first3:
        return []
    diff = (last3 - first3) / first3
    if abs(diff) <= THR_TENDENCIA:
        return []
    positiva = diff > 0
    titulo = "Tendencia alcista del forecast" if positiva else "Tendencia bajista del forecast"
    mes_ini = fmt_mes_anio(int(futuro["fecha_mes"].iloc[0].year), int(futuro["fecha_mes"].iloc[0].month))
    mes_fin = fmt_mes_anio(int(futuro["fecha_mes"].iloc[-1].year), int(futuro["fecha_mes"].iloc[-1].month))
    return [Evento("TENDENCIA", titulo, f"{mes_ini} → {mes_fin}", float(last3), float(first3), float(diff), _rec_tendencia(positiva))]


def detectar_salto(futuro: pd.DataFrame) -> list[Evento]:
    eventos: list[Evento] = []
    vals = futuro["pred_prophet"].to_list()
    fechas = futuro["fecha_mes"].to_list()
    for i in range(1, len(vals)):
        prev, curr = vals[i - 1], vals[i]
        if not prev:
            continue
        rel = (curr - prev) / prev
        if abs(rel) > THR_SALTO:
            mes_prev = fmt_mes_anio(int(fechas[i - 1].year), int(fechas[i - 1].month))
            mes_curr = fmt_mes_anio(int(fechas[i].year), int(fechas[i].month))
            positivo = rel > 0
            eventos.append(Evento(
                "SALTO",
                f"Salto {'al alza' if positivo else 'a la baja'}: {mes_prev} → {mes_curr}",
                f"{mes_prev} → {mes_curr}", float(curr), float(prev), float(rel),
                _rec_salto(positivo, mes_curr),
            ))
    return eventos


def detectar_todos_eventos(df_pred: pd.DataFrame) -> list[Evento]:
    historico = df_pred[df_pred["real"].notna()].copy()
    futuro = df_pred[df_pred["real"].isna() & df_pred["pred_prophet"].notna()].copy().sort_values("fecha_mes").reset_index(drop=True)
    if futuro.empty:
        return []
    hist_avg = historico.groupby("mes_num")["real"].mean().dropna().to_dict()
    eventos: list[Evento] = []
    eventos.extend(detectar_pico_valle(futuro, hist_avg))
    eventos.extend(detectar_tendencia(futuro))
    eventos.extend(detectar_salto(futuro))
    return eventos


def evento_prioritario(eventos: list[Evento]) -> Evento | None:
    """Prioridad: PICO > SALTO > TENDENCIA > VALLE."""
    if not eventos:
        return None
    orden = {"PICO": 0, "SALTO": 1, "TENDENCIA": 2, "VALLE": 3}
    return sorted(eventos, key=lambda e: orden.get(e.tipo, 99))[0]


# ═══════════════════════════════════════════════════════════════════════════
# SCORE TERRITORIAL (replicado de scoreTerritorial.ts)
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class ScoreRow:
    provincia: str
    prov_code: str
    score_final: float
    score_demanda: float
    score_mercado: float
    score_tendencia: float
    penalizacion_ivtm: float
    ranking: int = 0
    matriculaciones_brutas: float = 0.0
    ratio_medio: float = 0.0
    crecimiento: float = 0.0
    anomalias_confirmadas: list[str] = field(default_factory=list)
    anomalias_potenciales: list[str] = field(default_factory=list)


def mediana(vals: list[float]) -> float:
    if not vals:
        return 0.0
    arr = sorted(vals)
    m = len(arr) // 2
    return (arr[m - 1] + arr[m]) / 2 if len(arr) % 2 == 0 else arr[m]


def minmax(v: float, vmin: float, vmax: float) -> float:
    if vmax <= vmin:
        return 50.0
    return ((v - vmin) / (vmax - vmin)) * 100


def minmax_log(v: float, vmin: float, vmax: float) -> float:
    """Normalizacion log-min-max a [0, 100].

    Aplica logaritmo natural antes del min-max para amortiguar la cola
    larga que generan provincias dominantes (Madrid, Barcelona) y evitar
    que el resto colapse a ~0. Se usa exclusivamente para la dimension
    de mercado (matriculaciones brutas).
    """
    import math
    if vmax <= vmin:
        return 50.0
    log_v = math.log(v + 1)
    log_min = math.log(vmin + 1)
    log_max = math.log(vmax + 1)
    if log_max <= log_min:
        return 50.0
    return ((log_v - log_min) / (log_max - log_min)) * 100


def calcular_score_territorial(
    df_mapa: pd.DataFrame,
    fecha_snapshot: pd.Timestamp,
    prov_lookup: dict[str, str],
    tendencia: dict[str, dict[str, float]],
) -> list[ScoreRow]:
    """Calcula score para todas las provincias usando un snapshot dado.

    La tendencia se calcula como TTM (trailing twelve months): suma de los
    12 meses mas recientes con datos en el CSV menos la suma de los 12
    meses inmediatamente anteriores, en porcentaje sobre la base. Las
    provincias que no tengan los 24 meses completos quedan con
    crecimiento = 0 y score_tendencia neutro = 50, sin afectar al min-max
    del resto.
    """
    snap = df_mapa[df_mapa["fecha"] == fecha_snapshot].copy()
    if snap.empty:
        return []

    # ── Determinar ventanas TTM globales ──
    all_months: set[str] = set()
    for serie in tendencia.values():
        all_months.update(serie.keys())
    sorted_months = sorted(all_months)
    months_current: list[str] = sorted_months[-12:] if len(sorted_months) >= 24 else []
    months_base: list[str] = sorted_months[-24:-12] if len(sorted_months) >= 24 else []

    def crec_ttm(prov_code: str) -> tuple[float, bool]:
        if not months_current or not months_base:
            return 0.0, False
        serie = tendencia.get(prov_code, {})
        if not serie:
            return 0.0, False
        if not all(k in serie for k in months_current):
            return 0.0, False
        if not all(k in serie for k in months_base):
            return 0.0, False
        sum_cur = sum(serie[k] for k in months_current)
        sum_base = sum(serie[k] for k in months_base)
        if sum_base <= 0:
            return 0.0, False
        return ((sum_cur - sum_base) / sum_base) * 100, True

    # Agregacion provincial
    base: list[dict[str, Any]] = []
    for prov_code, grp in snap.groupby("prov_code"):
        provincia = prov_lookup.get(prov_code)
        if not provincia:
            continue
        ratios = [r for r in grp["ratio_x1000"].tolist() if r > 0]
        ratio_medio = sum(ratios) / len(ratios) if ratios else 0.0
        mat_total = float(grp["matriculaciones"].sum())

        crecimiento, tendencia_valida = crec_ttm(prov_code)

        # Anomalias confirmadas
        anom_conf: list[str] = []
        munis_norm = {norm(m) for m in grp["municipio"].tolist()}
        for a in ANOMALIAS_CONFIRMADAS:
            match_muni = a["nombre"] in munis_norm
            match_prov = a["provincia"] is None or norm(provincia) == a["provincia"]
            if match_muni and match_prov:
                anom_conf.append(a["nombre"])

        # Anomalias potenciales: ratio > 3 * mediana provincial
        med = mediana(ratios)
        anom_pot: list[str] = []
        if med > 0:
            for _, row in grp.iterrows():
                if row["ratio_x1000"] > 3 * med and norm(row["municipio"]) not in anom_conf:
                    anom_pot.append(row["municipio"])

        base.append({
            "provincia": provincia,
            "prov_code": prov_code,
            "ratio_medio": ratio_medio,
            "mat_brutas": mat_total,
            "crecimiento": crecimiento,
            "tendencia_valida": tendencia_valida,
            "anom_conf": anom_conf,
            "anom_pot": anom_pot,
        })

    if not base:
        return []

    ratios = [b["ratio_medio"] for b in base]
    mats = [b["mat_brutas"] for b in base]
    crecs_validos = [b["crecimiento"] for b in base if b["tendencia_valida"]]
    r_min, r_max = min(ratios), max(ratios)
    m_min, m_max = min(mats), max(mats)
    c_min = min(crecs_validos) if crecs_validos else 0.0
    c_max = max(crecs_validos) if crecs_validos else 0.0

    filas: list[ScoreRow] = []
    for b in base:
        s_dem = minmax(b["ratio_medio"], r_min, r_max)
        s_mer = minmax_log(b["mat_brutas"], m_min, m_max)
        s_ten = minmax(b["crecimiento"], c_min, c_max) if b["tendencia_valida"] else 50.0
        score_base = s_dem * 0.4 + s_mer * 0.3 + s_ten * 0.25
        penal_conf = len(b["anom_conf"]) * 5
        penal_pot = min(len(b["anom_pot"]) * 2, 6)
        penal = penal_conf + penal_pot
        score_final = max(0.0, score_base - penal)
        filas.append(ScoreRow(
            provincia=b["provincia"],
            prov_code=b["prov_code"],
            score_final=round(score_final, 1),
            score_demanda=round(s_dem, 1),
            score_mercado=round(s_mer, 1),
            score_tendencia=round(s_ten, 1),
            penalizacion_ivtm=round(float(penal), 1),
            matriculaciones_brutas=b["mat_brutas"],
            ratio_medio=round(b["ratio_medio"], 2),
            crecimiento=round(b["crecimiento"], 1),
            anomalias_confirmadas=b["anom_conf"],
            anomalias_potenciales=b["anom_pot"],
        ))
    filas.sort(key=lambda r: r.score_final, reverse=True)
    for i, f in enumerate(filas, 1):
        f.ranking = i
    return filas


# ═══════════════════════════════════════════════════════════════════════════
# BLOQUES DE CONTENIDO
# ═══════════════════════════════════════════════════════════════════════════
@dataclass
class BloqueMercado:
    total_mes: int
    mes_txt: str
    var_interanual: float | None       # None si no hay comparativa
    acumulado_anio: int
    anio_act: int
    acumulado_prev: int | None
    var_acumulado: float | None
    etiqueta_acumulado: str             # "por encima" / "por debajo" / ""


@dataclass
class BloqueProvincia:
    disponible: bool
    total_prov: int = 0
    posicion_ranking: int = 0
    total_provs: int = 0
    var_interanual: float | None = None


@dataclass
class BloqueScore:
    disponible: bool
    score_actual: float = 0.0
    ranking: int = 0
    total_provs: int = 0
    score_prev: float | None = None
    delta: float | None = None
    score_row: ScoreRow | None = None


def calcular_bloque_mercado(df_agr: pd.DataFrame) -> tuple[BloqueMercado, int, int]:
    """Devuelve (bloque, año_informe, mes_informe)."""
    df = df_agr.dropna(subset=["Año", "Mes", "Turismos"])
    df = df[df["Turismos"] > 0]
    if df.empty:
        raise ValueError("df_mensual_agrupado no contiene datos válidos")
    latest = df.sort_values(["Año", "Mes"]).iloc[-1]
    anio_inf = int(latest["Año"])
    mes_inf = int(latest["Mes"])
    total_mes = int(latest["Turismos"])

    # Interanual
    prev_row = df[(df["Año"] == anio_inf - 1) & (df["Mes"] == mes_inf)]
    var_interanual = None
    if not prev_row.empty and prev_row.iloc[0]["Turismos"] > 0:
        prev_val = float(prev_row.iloc[0]["Turismos"])
        var_interanual = (total_mes - prev_val) / prev_val

    # Acumulado año
    acumulado_act = int(df[(df["Año"] == anio_inf) & (df["Mes"] <= mes_inf)]["Turismos"].sum())
    # Mismo acumulado año anterior
    acumulado_prev_df = df[(df["Año"] == anio_inf - 1) & (df["Mes"] <= mes_inf)]
    acumulado_prev: int | None = None
    var_acumulado = None
    etiqueta = ""
    if not acumulado_prev_df.empty:
        acumulado_prev = int(acumulado_prev_df["Turismos"].sum())
        if acumulado_prev > 0:
            var_acumulado = (acumulado_act - acumulado_prev) / acumulado_prev
            etiqueta = "por encima" if var_acumulado >= 0 else "por debajo"

    return BloqueMercado(
        total_mes=total_mes,
        mes_txt=fmt_mes_anio(anio_inf, mes_inf),
        var_interanual=var_interanual,
        acumulado_anio=acumulado_act,
        anio_act=anio_inf,
        acumulado_prev=acumulado_prev,
        var_acumulado=var_acumulado,
        etiqueta_acumulado=etiqueta,
    ), anio_inf, mes_inf


@dataclass
class BloquePrediccion:
    disponible: bool
    pred_proximo_mes: int
    mes_proximo_txt: str
    clasificacion: str                  # "alcista" | "bajista" | "estable"
    estimacion_cierre: int
    anio_act: int
    total_anio_prev: int | None
    var_esperada: float | None
    texto_cierre: str


def calcular_bloque_prediccion(df_pred: pd.DataFrame, df_agr: pd.DataFrame, anio_inf: int, mes_inf: int) -> BloquePrediccion:
    # Proximo mes
    next_year = anio_inf if mes_inf < 12 else anio_inf + 1
    next_month = mes_inf + 1 if mes_inf < 12 else 1
    target = pd.Timestamp(year=next_year, month=next_month, day=1)

    row = df_pred[df_pred["fecha_mes"] == target]
    pred_proximo = 0.0
    clasif = "estable"
    disponible = False
    if not row.empty and pd.notna(row.iloc[0]["pred_prophet"]):
        pred_proximo = float(row.iloc[0]["pred_prophet"])
        disponible = True
        # Media historica del mismo mes calendario
        hist = df_pred[(df_pred["mes_num"] == next_month) & df_pred["real"].notna()]["real"]
        if not hist.empty:
            media_hist = hist.mean()
            if media_hist > 0:
                desv = (pred_proximo - media_hist) / media_hist
                if desv > THR_PROX_MES:
                    clasif = "alcista"
                elif desv < -THR_PROX_MES:
                    clasif = "bajista"

    # Estimacion cierre anio_inf: acumulado real + suma pred_prophet meses restantes del mismo año
    agr = df_agr[(df_agr["Año"] == anio_inf)]
    real_acum = int(agr[agr["Mes"] <= mes_inf]["Turismos"].sum())
    fin_anio = pd.Timestamp(year=anio_inf, month=12, day=1)
    start_pred = pd.Timestamp(year=anio_inf, month=mes_inf + 1, day=1) if mes_inf < 12 else None
    pred_restantes = 0.0
    if start_pred is not None:
        mask = (df_pred["fecha_mes"] >= start_pred) & (df_pred["fecha_mes"] <= fin_anio) & df_pred["pred_prophet"].notna()
        pred_restantes = float(df_pred.loc[mask, "pred_prophet"].sum())
    estimacion_cierre = int(real_acum + pred_restantes)

    # Comparativa con total anio anterior completo
    total_prev_df = df_agr[df_agr["Año"] == anio_inf - 1]
    total_prev: int | None = None
    var_esperada: float | None = None
    texto_cierre = f"Se estima cerrar {anio_inf} con {fmt_int(estimacion_cierre)} matriculaciones."
    if not total_prev_df.empty:
        total_prev = int(total_prev_df["Turismos"].sum())
        if total_prev > 0:
            var_esperada = (estimacion_cierre - total_prev) / total_prev
            texto_cierre = (
                f"Se estima cerrar {anio_inf} con {fmt_int(estimacion_cierre)} matriculaciones, "
                f"un {fmt_pct(var_esperada)} respecto a {anio_inf - 1}."
            )

    return BloquePrediccion(
        disponible=disponible,
        pred_proximo_mes=int(round(pred_proximo)),
        mes_proximo_txt=fmt_mes_anio(next_year, next_month),
        clasificacion=clasif,
        estimacion_cierre=estimacion_cierre,
        anio_act=anio_inf,
        total_anio_prev=total_prev,
        var_esperada=var_esperada,
        texto_cierre=texto_cierre,
    )


def calcular_bloque_provincia(
    df_mapa: pd.DataFrame,
    prov_lookup: dict[str, str],
    provincia: str,
    anio_inf: int,
    mes_inf: int,
) -> BloqueProvincia:
    target = pd.Timestamp(year=anio_inf, month=mes_inf, day=1)
    snap = df_mapa[df_mapa["fecha"] == target]
    if snap.empty:
        return BloqueProvincia(disponible=False)

    prov_norm = norm(provincia)
    # Obtener prov_code para esta provincia
    inv = {norm(name): code for code, name in prov_lookup.items()}
    prov_code = inv.get(prov_norm)
    if not prov_code:
        return BloqueProvincia(disponible=False)

    # Total provincial del mes
    totales_por_prov = snap.groupby("prov_code")["matriculaciones"].sum().to_dict()
    total_prov = float(totales_por_prov.get(prov_code, 0))
    if total_prov <= 0:
        return BloqueProvincia(disponible=False)

    # Ranking nacional
    ordenado = sorted(totales_por_prov.items(), key=lambda kv: kv[1], reverse=True)
    posicion = next((i + 1 for i, (c, _) in enumerate(ordenado) if c == prov_code), 0)

    # Interanual
    prev_target = pd.Timestamp(year=anio_inf - 1, month=mes_inf, day=1)
    prev_snap = df_mapa[df_mapa["fecha"] == prev_target]
    var_inter = None
    if not prev_snap.empty:
        prev_total = float(prev_snap[prev_snap["prov_code"] == prov_code]["matriculaciones"].sum())
        if prev_total > 0:
            var_inter = (total_prov - prev_total) / prev_total

    return BloqueProvincia(
        disponible=True,
        total_prov=int(total_prov),
        posicion_ranking=posicion,
        total_provs=len(ordenado),
        var_interanual=var_inter,
    )


def calcular_bloque_score(
    df_mapa: pd.DataFrame,
    prov_lookup: dict[str, str],
    tendencia: dict[str, dict[int, float]],
    provincia: str,
    anio_inf: int,
    mes_inf: int,
) -> BloqueScore:
    target = pd.Timestamp(year=anio_inf, month=mes_inf, day=1)
    scores_actual = calcular_score_territorial(df_mapa, target, prov_lookup, tendencia)
    if not scores_actual:
        return BloqueScore(disponible=False)

    prov_norm = norm(provincia)
    row = next((r for r in scores_actual if norm(r.provincia) == prov_norm), None)
    if not row:
        return BloqueScore(disponible=False)

    # Mes anterior
    prev_year = anio_inf if mes_inf > 1 else anio_inf - 1
    prev_month = mes_inf - 1 if mes_inf > 1 else 12
    prev_target = pd.Timestamp(year=prev_year, month=prev_month, day=1)
    score_prev: float | None = None
    delta: float | None = None
    if (df_mapa["fecha"] == prev_target).any():
        scores_prev = calcular_score_territorial(df_mapa, prev_target, prov_lookup, tendencia)
        row_prev = next((r for r in scores_prev if norm(r.provincia) == prov_norm), None)
        if row_prev:
            score_prev = row_prev.score_final
            delta = row.score_final - row_prev.score_final

    return BloqueScore(
        disponible=True,
        score_actual=row.score_final,
        ranking=row.ranking,
        total_provs=len(scores_actual),
        score_prev=score_prev,
        delta=delta,
        score_row=row,
    )


# ═══════════════════════════════════════════════════════════════════════════
# RENDER DEL EMAIL HTML
# ═══════════════════════════════════════════════════════════════════════════
def kpi_card(valor: str, etiqueta: str, destacado_color: str = COLOR_NAVY) -> str:
    return f"""
    <td style="padding:8px;" valign="top" width="33%">
      <div style="background:{COLOR_CARD};border:1px solid {COLOR_BORDER};border-radius:10px;padding:14px 16px;">
        <div style="font-size:22px;font-weight:700;color:{destacado_color};line-height:1.1;">{escape(valor)}</div>
        <div style="font-size:11px;color:{COLOR_TEXT};text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;">{escape(etiqueta)}</div>
      </div>
    </td>"""


def titulo_bloque(texto: str) -> str:
    return f"""
    <tr><td style="padding:24px 28px 8px;">
      <div style="display:inline-block;vertical-align:middle;width:4px;height:18px;background:{COLOR_GOLD};margin-right:10px;"></div>
      <span style="display:inline-block;vertical-align:middle;font-size:13px;font-weight:700;color:{COLOR_NAVY};letter-spacing:1.5px;text-transform:uppercase;">{escape(texto)}</span>
    </td></tr>"""


def divisor() -> str:
    return f'<tr><td style="padding:0 28px;"><div style="height:1px;background:{COLOR_BORDER};margin:8px 0;"></div></td></tr>'


def parrafo(texto: str) -> str:
    return f'<tr><td style="padding:4px 28px 12px;font-size:13px;line-height:1.55;color:{COLOR_TEXT_DARK};">{texto}</td></tr>'


def render_bloque1(b: BloqueMercado) -> str:
    kpis_tabla = f"""
    <tr><td style="padding:4px 20px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          {kpi_card(fmt_int(b.total_mes), f"Matriculaciones · {b.mes_txt}")}
          {kpi_card(fmt_pct(b.var_interanual) if b.var_interanual is not None else "—", "Variación interanual",
                   COLOR_SUCCESS if (b.var_interanual or 0) >= 0 else COLOR_DANGER)}
          {kpi_card(fmt_int(b.acumulado_anio), f"Acumulado {b.anio_act}")}
        </tr>
      </table>
    </td></tr>"""

    interpret = []
    if b.var_interanual is not None:
        direc = "superior" if b.var_interanual >= 0 else "inferior"
        interpret.append(f"El mercado registra <strong>{fmt_int(b.total_mes)}</strong> matriculaciones en {b.mes_txt}, un {fmt_pct(b.var_interanual)} {direc} al mismo mes del año anterior.")
    else:
        interpret.append(f"El mercado registra <strong>{fmt_int(b.total_mes)}</strong> matriculaciones en {b.mes_txt}.")
    if b.var_acumulado is not None and b.acumulado_prev is not None:
        interpret.append(f"El acumulado de {b.anio_act} ({fmt_int(b.acumulado_anio)}) se sitúa <strong>{b.etiqueta_acumulado}</strong> del ritmo de {b.anio_act - 1} ({fmt_int(b.acumulado_prev)}), con una variación del {fmt_pct(b.var_acumulado)}.")

    return titulo_bloque("El mercado este mes") + kpis_tabla + parrafo(" ".join(interpret))


def render_bloque2(p: BloquePrediccion) -> str:
    if not p.disponible:
        return titulo_bloque("Predicción") + parrafo("No hay datos de predicción disponibles para el próximo mes.")
    color_clasif = COLOR_SUCCESS if p.clasificacion == "alcista" else COLOR_DANGER if p.clasificacion == "bajista" else COLOR_GOLD
    kpis_tabla = f"""
    <tr><td style="padding:4px 20px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          {kpi_card(fmt_int(p.pred_proximo_mes), f"Predicción · {p.mes_proximo_txt}")}
          {kpi_card(p.clasificacion.upper(), "Clasificación próximo mes", color_clasif)}
          {kpi_card(fmt_int(p.estimacion_cierre), f"Estimación cierre {p.anio_act}")}
        </tr>
      </table>
    </td></tr>"""
    interpret = (
        f"El modelo Prophet prevé <strong>{fmt_int(p.pred_proximo_mes)}</strong> matriculaciones en {p.mes_proximo_txt}, "
        f"clasificando el mes como <strong style=\"color:{color_clasif};\">{p.clasificacion}</strong> respecto a la media histórica del mismo mes. "
        f"{escape(p.texto_cierre)}"
    )
    return titulo_bloque("Predicción") + kpis_tabla + parrafo(interpret)


def render_bloque3(prov: BloqueProvincia, provincia: str, mes_txt: str) -> str:
    if not prov.disponible:
        return (titulo_bloque(f"Tu provincia este mes · {provincia}") +
                parrafo("Datos provinciales no disponibles para este período."))
    color_var = COLOR_SUCCESS if (prov.var_interanual or 0) >= 0 else COLOR_DANGER
    kpis_tabla = f"""
    <tr><td style="padding:4px 20px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          {kpi_card(fmt_int(prov.total_prov), f"Matriculaciones · {mes_txt}")}
          {kpi_card(f"#{prov.posicion_ranking} / {prov.total_provs}", "Ranking nacional")}
          {kpi_card(fmt_pct(prov.var_interanual) if prov.var_interanual is not None else "—", "Variación interanual", color_var)}
        </tr>
      </table>
    </td></tr>"""
    if prov.var_interanual is not None:
        direc = "superior" if prov.var_interanual >= 0 else "inferior"
        interpret = (f"{escape(provincia)} registra <strong>{fmt_int(prov.total_prov)}</strong> matriculaciones en {mes_txt} "
                     f"y ocupa la <strong>posición {prov.posicion_ranking}</strong> del ranking nacional, "
                     f"con un volumen {fmt_pct(prov.var_interanual)} {direc} al mismo mes del año anterior.")
    else:
        interpret = (f"{escape(provincia)} registra <strong>{fmt_int(prov.total_prov)}</strong> matriculaciones en {mes_txt} "
                     f"y ocupa la <strong>posición {prov.posicion_ranking}</strong> del ranking nacional.")
    return titulo_bloque(f"Tu provincia este mes · {provincia}") + kpis_tabla + parrafo(interpret)


def render_bloque4(sc: BloqueScore, provincia: str) -> str:
    if not sc.disponible:
        return (titulo_bloque("Score de oportunidad provincial") +
                parrafo("No se ha podido calcular el score para este período."))
    # Flecha de variacion
    flecha_html = ""
    if sc.delta is not None:
        if sc.delta > 0.05:
            flecha_html = f' <span style="color:{COLOR_SUCCESS};font-weight:700;">▲ +{fmt_dec(sc.delta)}</span>'
        elif sc.delta < -0.05:
            flecha_html = f' <span style="color:{COLOR_DANGER};font-weight:700;">▼ {fmt_dec(sc.delta)}</span>'
        else:
            flecha_html = f' <span style="color:{COLOR_TEXT};">=</span>'

    kpis_tabla = f"""
    <tr><td style="padding:4px 20px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          {kpi_card(f"{fmt_dec(sc.score_actual)}/100", "Score territorial", COLOR_GOLD)}
          {kpi_card(f"#{sc.ranking} / {sc.total_provs}", "Ranking nacional")}
          {kpi_card(fmt_dec(sc.score_prev) if sc.score_prev is not None else "—", "Score mes anterior")}
        </tr>
      </table>
    </td></tr>"""

    nivel = "alto" if sc.score_actual >= 66 else "medio" if sc.score_actual >= 33 else "bajo"
    interpret = (
        f"{escape(provincia)} obtiene un score de <strong>{fmt_dec(sc.score_actual)} sobre 100</strong>{flecha_html}, "
        f"posicionándose como un mercado de potencial <strong>{nivel}</strong> dentro del territorio nacional."
    )
    if sc.score_row and sc.score_row.penalizacion_ivtm > 0:
        interpret += f" Se han aplicado -{fmt_dec(sc.score_row.penalizacion_ivtm)} puntos por anomalías territoriales detectadas."

    return titulo_bloque("Score de oportunidad provincial") + kpis_tabla + parrafo(interpret)


def render_bloque5(ev: Evento | None) -> str:
    if ev is None:
        return ""
    return f"""
    <tr><td style="padding:16px 28px 8px;">
      <div style="background:{COLOR_ALERT_BG};border-left:4px solid {COLOR_ALERT_BORDER};
           border-radius:8px;padding:16px 20px;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1.5px;
            text-transform:uppercase;color:{COLOR_ALERT_BORDER};">
          ⚠ Alerta · {escape(ev.tipo)}
        </p>
        <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:{COLOR_TEXT_DARK};">
          {escape(ev.titulo)}
        </p>
        <p style="margin:0 0 6px;font-size:13px;color:{COLOR_TEXT_DARK};line-height:1.5;">
          Período afectado: <strong>{escape(ev.mes_afectado)}</strong> · Predicción: <strong>{fmt_int(ev.valor_pred)}</strong> · Desviación: <strong>{fmt_pct(ev.desviacion)}</strong>
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:{COLOR_TEXT_DARK};line-height:1.5;">
          <strong>Recomendación:</strong> {escape(ev.recomendacion)}
        </p>
      </div>
    </td></tr>"""


def construir_html_informe(
    nombre: str,
    provincia: str,
    mes_txt: str,
    bloque_mercado: BloqueMercado,
    bloque_pred: BloquePrediccion,
    bloque_prov: BloqueProvincia,
    bloque_score: BloqueScore,
    evento_alerta: Evento | None,
    dashboard_url: str,
) -> str:
    header = f"""
    <tr>
      <td style="background:{COLOR_NAVY};color:#ffffff;padding:26px 28px;">
        <p style="margin:0;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:{COLOR_GOLD};font-weight:600;">
          INFORME MENSUAL DE MATRICULACIONES
        </p>
        <p style="margin:10px 0 4px;font-size:22px;font-weight:700;color:{COLOR_GOLD};letter-spacing:0.5px;">
          {escape(mes_txt)}
        </p>
        <p style="margin:0;font-size:13px;color:#ffffff;font-weight:500;">
          {escape(nombre)}
        </p>
      </td>
    </tr>"""

    footer = f"""
    <tr>
      <td style="background:{COLOR_GRAY_LIGHT};padding:20px 28px;font-size:11px;color:{COLOR_TEXT};line-height:1.55;">
        Este informe se genera automáticamente a partir de datos DGT procesados mediante modelos Prophet y MD.<br>
        <a href="{escape(dashboard_url)}" style="color:{COLOR_NAVY};font-weight:600;text-decoration:underline;">Ver análisis completo en el dashboard</a><br>
        Para cancelar la suscripción al informe mensual, contacte con el administrador.
      </td>
    </tr>"""

    bloques = (
        render_bloque1(bloque_mercado)
        + divisor()
        + render_bloque2(bloque_pred)
        + divisor()
        + render_bloque3(bloque_prov, provincia, mes_txt)
        + divisor()
        + render_bloque4(bloque_score, provincia)
    )
    if evento_alerta is not None:
        bloques += divisor() + render_bloque5(evento_alerta)

    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Informe mensual de matriculaciones</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:{COLOR_TEXT_DARK};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;background:#ffffff;border:1px solid {COLOR_BORDER};border-radius:14px;overflow:hidden;">
        {header}
        {bloques}
        <tr><td style="height:16px;"></td></tr>
        {footer}
      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════════
# ENVIO + LOGGING
# ═══════════════════════════════════════════════════════════════════════════
def enviar_email(*, to: str, subject: str, html: str, sender: str, api_key: str) -> tuple[bool, str]:
    try:
        import resend
    except ImportError:
        return False, "Falta la dependencia 'resend' (pip install resend)"
    resend.api_key = api_key
    try:
        resp = resend.Emails.send({
            "from": sender, "to": [to], "subject": subject, "html": html,
        })
        return True, (resp or {}).get("id", "sent")
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def log_line(path: Path, message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}\n"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        print(line, file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════
def main() -> int:
    subs_path = Path(os.environ.get("REPORT_SUBS", DEFAULT_SUBS))
    log_path = Path(os.environ.get("REPORT_LOG", DEFAULT_LOG))
    sender = os.environ.get("REPORT_SENDER", DEFAULT_SENDER)
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    dashboard_url = os.environ.get("DASHBOARD_URL", DEFAULT_DASHBOARD_URL)

    # 1. Suscriptores
    all_subs = cargar_suscriptores(subs_path)
    # Filtrar por informe_mensual=true (por defecto true si no existe)
    activos = [s for s in all_subs if s.get("informe_mensual", True)]
    if not activos:
        log_line(log_path, "sin suscriptores con informe mensual activado")
        print("Sin suscriptores con informe mensual activado.")
        return 0

    # 2. CSVs
    try:
        df_agr = cargar_agrupado(DEFAULT_CSV_AGRUPADO)
        df_pred = cargar_predicciones(DEFAULT_CSV_PRED)
        df_mapa = cargar_mapa(DEFAULT_CSV_MAPA)
    except (FileNotFoundError, ValueError) as exc:
        log_line(log_path, f"ERROR lectura CSVs: {exc}")
        print(f"ERROR lectura CSVs: {exc}", file=sys.stderr)
        return 2

    prov_lookup = cargar_geojson_provincias(DEFAULT_GEOJSON)
    if not prov_lookup:
        log_line(log_path, "AVISO: no se pudo cargar provincias.geojson")
        print("AVISO: sin lookup de provincias, los bloques provinciales quedarán vacíos.", file=sys.stderr)

    print("Cargando tendencia provincial (CSV de marca/lugar ~150 MB)...")
    tendencia = cargar_tendencia_provincial(DEFAULT_CSV_MARCA_LUGAR, df_mapa=df_mapa)

    # 3. Bloques comunes (idem para todos los suscriptores)
    try:
        bloque_mercado, anio_inf, mes_inf = calcular_bloque_mercado(df_agr)
    except ValueError as exc:
        log_line(log_path, f"ERROR bloque mercado: {exc}")
        print(f"ERROR bloque mercado: {exc}", file=sys.stderr)
        return 2
    mes_txt = bloque_mercado.mes_txt
    bloque_pred = calcular_bloque_prediccion(df_pred, df_agr, anio_inf, mes_inf)
    eventos = detectar_todos_eventos(df_pred)
    evento_top = evento_prioritario(eventos)

    print(f"Mes del informe detectado: {mes_txt}")
    print(f"Suscriptores a procesar: {len(activos)}")

    # 4. Envio por suscriptor (personalizando bloques 3 y 4)
    if not api_key:
        log_line(log_path, f"ERROR: falta RESEND_API_KEY | {len(activos)} suscriptores procesados | 0 emails enviados")
        print("ERROR: falta RESEND_API_KEY en el entorno.", file=sys.stderr)
        return 3

    enviados = 0
    errores: list[str] = []
    for sub in activos:
        try:
            nombre = str(sub.get("nombre", "")).strip() or "concesionario"
            email = str(sub.get("email", "")).strip().lower()
            provincia = str(sub.get("provincia", "")).strip() or "España"
            if not email:
                errores.append("suscriptor sin email")
                continue

            bloque_prov = calcular_bloque_provincia(df_mapa, prov_lookup, provincia, anio_inf, mes_inf)
            bloque_score = calcular_bloque_score(df_mapa, prov_lookup, tendencia, provincia, anio_inf, mes_inf)

            html = construir_html_informe(
                nombre=nombre,
                provincia=provincia,
                mes_txt=mes_txt,
                bloque_mercado=bloque_mercado,
                bloque_pred=bloque_pred,
                bloque_prov=bloque_prov,
                bloque_score=bloque_score,
                evento_alerta=evento_top,
                dashboard_url=dashboard_url,
            )
            subject = f"Informe de Matriculaciones — {mes_txt.capitalize()} | {provincia}"
            ok, info = enviar_email(to=email, subject=subject, html=html, sender=sender, api_key=api_key)
            if ok:
                enviados += 1
            else:
                errores.append(f"{email}: {info}")
        except Exception as exc:
            errores.append(f"{sub.get('email', '?')}: {type(exc).__name__}: {exc}")

    resumen = (
        f"mes_informe={mes_txt} | {len(activos)} suscriptores procesados | "
        f"{enviados} emails enviados | errores: {len(errores)}"
    )
    if errores:
        resumen += " | detalles: " + "; ".join(errores[:5])
        if len(errores) > 5:
            resumen += f"; (+{len(errores) - 5} más)"
    log_line(log_path, resumen)
    print(resumen)
    return 0 if not errores else 1


if __name__ == "__main__":
    sys.exit(main())


# ═══════════════════════════════════════════════════════════════════════════
# PROGRAMACIÓN AUTOMÁTICA — PROGRAMADOR DE TAREAS DE WINDOWS
# ═══════════════════════════════════════════════════════════════════════════
# Para ejecutar este script el día 5 de cada mes a las 9:00 (garantizando que
# los datos DGT del mes anterior están disponibles), configura una tarea
# programada con los siguientes pasos:
#
# ─── OPCIÓN A — Desde la línea de comandos (cmd.exe como administrador) ────
#
# schtasks /Create /SC MONTHLY /D 5 /ST 09:00 /TN "MatriculacionesInformeMensual" ^
#   /TR "\"C:\Program Files\Python311\python.exe\" \"C:\Users\rgrag\OneDrive\Documentos\4 Carrera\TFG\Practica\Analisis\Datasets web\Web dashboard\public\monthly_report.py\"" ^
#   /RL LIMITED /F
#
#   • /SC MONTHLY → frecuencia mensual
#   • /D 5         → día 5 del mes
#   • /ST 09:00    → a las 9:00 horas
#   • /TN          → nombre de la tarea
#   • /TR          → comando a ejecutar (ruta al python.exe + script)
#   • /F           → sobreescribir si ya existe
#
# Ajusta las rutas de python.exe y monthly_report.py a las reales de tu
# sistema. Puedes verificar la ruta con:   where python
#
# ─── OPCIÓN B — Desde el GUI (taskschd.msc) ────────────────────────────────
#
#   1. Abre "Programador de tareas" (Win+R → taskschd.msc)
#   2. Acción → Crear tarea básica
#   3. Nombre: "MatriculacionesInformeMensual"
#   4. Desencadenador: Mensualmente → Todos los meses → Día 5 → 09:00
#   5. Acción: Iniciar un programa
#        Programa:  C:\Program Files\Python311\python.exe
#        Argumentos: "C:\...\Web dashboard\public\monthly_report.py"
#        Iniciar en: C:\...\Web dashboard\public\
#   6. Finalizar.
#   7. Clic derecho sobre la tarea creada → Propiedades → pestaña "General":
#      marca "Ejecutar tanto si el usuario inició sesión como si no".
#
# ─── CONFIGURACIÓN DE VARIABLES DE ENTORNO PARA LA TAREA ──────────────────
#
# La tarea programada NO hereda automáticamente las variables del shell
# interactivo. Hay dos maneras de configurar RESEND_API_KEY (y opcionales):
#
#   A) Variables de entorno del SISTEMA (permanentes, afectan a todo):
#        Panel de Control → Sistema → Configuración avanzada del sistema
#        → Variables de entorno → Nuevo (bajo "Variables del sistema"):
#             RESEND_API_KEY = re_tu_api_key_aqui
#             REPORT_SENDER  = informes@tudominio.es   (opcional)
#             DASHBOARD_URL  = https://tu-dashboard.com (opcional)
#
#   B) Fichero .env en la misma carpeta que monthly_report.py:
#      El script carga automáticamente public/.env gracias a python-dotenv.
#      Basta con copiar .env.example a .env y rellenar la clave. La tarea
#      programada lo detectará al cambiar "Iniciar en" a esa carpeta.
#
# ─── VERIFICACIÓN MANUAL ANTES DE PROGRAMAR ────────────────────────────────
#
#   cd "C:\Users\rgrag\OneDrive\Documentos\4 Carrera\TFG\Practica\Analisis\Datasets web\Web dashboard\public"
#   python monthly_report.py
#
# Debería imprimir "Mes del informe detectado: ..." y escribir en
# monthly_report_log.txt el resultado de la ejecución.
# ═══════════════════════════════════════════════════════════════════════════
