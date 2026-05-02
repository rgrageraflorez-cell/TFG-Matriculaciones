"""
alert_engine.py
───────────────────────────────────────────────────────────────────────────────
Motor de alertas push por email para el dashboard de matriculaciones.

Lee:
  - subscribers.json  (mismo directorio)
  - df_real_pred_mensual_total.csv  (mismo directorio)

Detecta cuatro eventos independientes sobre la serie `pred_prophet`:

  1. PICO           alguno de los próximos 6 meses supera en más del 10 %
                    la media histórica del mismo mes calendario.
  2. VALLE          alguno de los próximos 6 meses queda más del 10 %
                    por debajo de la media histórica del mismo mes.
  3. TENDENCIA      media de los primeros 3 meses de forecast vs últimos 3:
                    diferencia relativa superior al 5 %.
  4. SALTO BRUSCO   cambio relativo entre dos meses consecutivos del forecast
                    superior al 15 %.

Si se detecta al menos un evento, envía el mismo email (con saludo y provincia
personalizados) a todos los suscriptores vía Resend. Si no hay eventos, no se
envía nada.

Variables de entorno:
  RESEND_API_KEY     clave de API de Resend (obligatoria)
  ALERT_SENDER       remitente (opcional; por defecto alertas@matriculaciones.es)
  ALERT_CSV          CSV a analizar (opcional; por defecto df_real_pred_mensual_total.csv)
  ALERT_SUBS         JSON de suscriptores (opcional; por defecto subscribers.json)
  ALERT_LOG          fichero de log (opcional; por defecto alert_log.txt)

Uso:
  python alert_engine.py                        # ejecución directa
  from alert_engine import main; main()         # desde otro script

Requiere: pandas, python-dotenv, resend  (ver requirements.txt)
───────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # dotenv es opcional; el engine funciona igual con env nativas
    pass


# ── Rutas por defecto ──
# scripts/ es hermano de public/. Los CSV viven en public/ (servidos por la
# web); los logs y el subscribers.json local viven aqui en scripts/.
HERE = Path(__file__).resolve().parent
PUBLIC_DIR = HERE.parent / "public"
DEFAULT_SUBS = HERE / "subscribers.json"
DEFAULT_CSV = PUBLIC_DIR / "df_real_pred_mensual_total.csv"
DEFAULT_LOG = HERE / "alert_log.txt"
DEFAULT_SENDER = "alertas@matriculaciones.es"

# ── Umbrales ──
THR_PICO = 0.10       # > 10 % por encima de la media histórica
THR_VALLE = 0.10      # > 10 % por debajo
THR_TENDENCIA = 0.05  # > 5 % entre primeros 3 y últimos 3 meses de forecast
THR_SALTO = 0.15      # > 15 % entre meses consecutivos del forecast
MESES_HORIZONTE_ALERTA = 6  # ventana para picos/valles


# ────────────────────────────────────────────────────────────────────────────
# Modelos de datos
# ────────────────────────────────────────────────────────────────────────────
MESES_ES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def fmt_mes_anio(ts: pd.Timestamp) -> str:
    return f"{MESES_ES[ts.month - 1]} de {ts.year}"


def fmt_int(n: float) -> str:
    return f"{int(round(n)):,}".replace(",", ".")


def fmt_pct(x: float, signed: bool = True) -> str:
    sign = "+" if (signed and x >= 0) else ""
    return f"{sign}{x * 100:.1f} %"


@dataclass
class Evento:
    tipo: str              # "PICO" | "VALLE" | "TENDENCIA" | "SALTO"
    titulo: str            # título corto para la sección del email
    mes_afectado: str      # texto legible, ej. "julio de 2026" o "junio→julio de 2026"
    valor_pred: float      # valor de pred_prophet asociado
    referencia: float      # valor de referencia (media histórica o mes previo)
    desviacion: float      # desviación relativa (ej. 0.125 = +12.5 %)
    recomendacion: str     # texto plano accionable


@dataclass
class AnalisisForecast:
    eventos: list[Evento] = field(default_factory=list)
    future_rows: pd.DataFrame = field(default_factory=pd.DataFrame)
    hist_monthly_avg: dict[int, float] = field(default_factory=dict)

    @property
    def hay_eventos(self) -> bool:
        return len(self.eventos) > 0


# ────────────────────────────────────────────────────────────────────────────
# Carga de datos
# ────────────────────────────────────────────────────────────────────────────
def _blob_url() -> str | None:
    """Construye la URL del blob de suscriptores con pathname obfuscado.

    pathname = subscribers/<sha256(SUBSCRIBERS_SECRET + "v1")>.json

    Devuelve None si faltan SUBSCRIBERS_SECRET o BLOB_BASE_URL en el
    entorno (limitacion conocida en GitHub Actions sobre repo publico:
    los Secrets no se inyectan en workflows disparados desde forks).
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

    El blob es access:"public" (unico valor soportado por @vercel/blob v1.x),
    asi que se lee con fetch sin autenticacion. La privacidad se basa en
    que la URL no es enumerable (depende de SUBSCRIBERS_SECRET).
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


def cargar_predicciones(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"No se encontró el CSV de predicciones: {path}")
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


# ────────────────────────────────────────────────────────────────────────────
# Detección de eventos
# ────────────────────────────────────────────────────────────────────────────
def _rec_pico(mes: str) -> str:
    return (
        f"Anticipe un incremento de demanda en {mes}: refuerce stock, reserve "
        "capacidad logística y prepare campañas comerciales con antelación para "
        "capturar ese volumen adicional."
    )


def _rec_valle(mes: str) -> str:
    return (
        f"Ajuste planificación a la baja para {mes}: modere pedidos al fabricante, "
        "concentre promociones de liquidación y revise la estructura de costes "
        "variables del concesionario."
    )


def _rec_tendencia(positiva: bool) -> str:
    if positiva:
        return (
            "Tendencia creciente en el horizonte de 6 meses. Valore reforzar "
            "plantilla comercial, ampliar financiación al cliente y negociar mayores "
            "cuotas con la marca."
        )
    return (
        "Tendencia decreciente en el horizonte de 6 meses. Priorice rotación de "
        "stock, contenga gastos no críticos y refuerce la comunicación de "
        "postventa para sostener ingresos."
    )


def _rec_salto(positivo: bool, mes: str) -> str:
    if positivo:
        return (
            f"Pico puntual esperado en {mes}. Coordine entregas y pruebas con "
            "antelación para evitar cuellos de botella y aproveche el momento "
            "para acciones de captación."
        )
    return (
        f"Caída brusca prevista en {mes}. Refuerce seguimiento de leads pendientes, "
        "evite sobrestock y considere promociones puntuales para suavizar el bache."
    )


def analizar(df: pd.DataFrame) -> AnalisisForecast:
    """Aplica las 4 reglas sobre pred_prophet y devuelve la lista de eventos."""
    historico = df[df["real"].notna()].copy()
    futuro = (
        df[df["real"].isna() & df["pred_prophet"].notna()]
        .copy()
        .sort_values("fecha_mes")
        .reset_index(drop=True)
    )

    analisis = AnalisisForecast(future_rows=futuro)

    if futuro.empty:
        return analisis

    hist_avg = (
        historico.groupby("mes_num")["real"].mean().dropna().to_dict()
    )
    analisis.hist_monthly_avg = hist_avg

    # ── 1 y 2. PICO / VALLE sobre los próximos N meses ──
    ventana = futuro.head(MESES_HORIZONTE_ALERTA)
    for _, row in ventana.iterrows():
        ref = hist_avg.get(int(row["mes_num"]))
        if ref is None or ref == 0:
            continue
        valor = float(row["pred_prophet"])
        desv = (valor - ref) / ref
        mes_txt = fmt_mes_anio(row["fecha_mes"])
        if desv > THR_PICO:
            analisis.eventos.append(Evento(
                tipo="PICO",
                titulo=f"Pico previsto en {mes_txt}",
                mes_afectado=mes_txt,
                valor_pred=valor,
                referencia=ref,
                desviacion=desv,
                recomendacion=_rec_pico(mes_txt),
            ))
        elif desv < -THR_VALLE:
            analisis.eventos.append(Evento(
                tipo="VALLE",
                titulo=f"Valle previsto en {mes_txt}",
                mes_afectado=mes_txt,
                valor_pred=valor,
                referencia=ref,
                desviacion=desv,
                recomendacion=_rec_valle(mes_txt),
            ))

    # ── 3. TENDENCIA: primeros 3 vs últimos 3 ──
    if len(futuro) >= 6:
        first3 = futuro["pred_prophet"].head(3).mean()
        last3 = futuro["pred_prophet"].tail(3).mean()
        if first3 and first3 != 0:
            diff = (last3 - first3) / first3
            if abs(diff) > THR_TENDENCIA:
                positiva = diff > 0
                titulo = (
                    "Tendencia alcista del forecast" if positiva
                    else "Tendencia bajista del forecast"
                )
                mes_ini = fmt_mes_anio(futuro["fecha_mes"].iloc[0])
                mes_fin = fmt_mes_anio(futuro["fecha_mes"].iloc[-1])
                analisis.eventos.append(Evento(
                    tipo="TENDENCIA",
                    titulo=titulo,
                    mes_afectado=f"{mes_ini} → {mes_fin}",
                    valor_pred=float(last3),
                    referencia=float(first3),
                    desviacion=float(diff),
                    recomendacion=_rec_tendencia(positiva),
                ))

    # ── 4. SALTO BRUSCO entre meses consecutivos del forecast ──
    vals = futuro["pred_prophet"].to_list()
    fechas = futuro["fecha_mes"].to_list()
    for i in range(1, len(vals)):
        prev, curr = vals[i - 1], vals[i]
        if not prev or prev == 0:
            continue
        rel = (curr - prev) / prev
        if abs(rel) > THR_SALTO:
            mes_prev = fmt_mes_anio(fechas[i - 1])
            mes_curr = fmt_mes_anio(fechas[i])
            positivo = rel > 0
            analisis.eventos.append(Evento(
                tipo="SALTO",
                titulo=(
                    f"Salto {'al alza' if positivo else 'a la baja'} "
                    f"{mes_prev} → {mes_curr}"
                ),
                mes_afectado=f"{mes_prev} → {mes_curr}",
                valor_pred=float(curr),
                referencia=float(prev),
                desviacion=float(rel),
                recomendacion=_rec_salto(positivo, mes_curr),
            ))

    return analisis


# ────────────────────────────────────────────────────────────────────────────
# Render del email
# ────────────────────────────────────────────────────────────────────────────
TIPO_COLOR = {
    "PICO":      "#047857",  # emerald-700
    "VALLE":     "#b91c1c",  # red-700
    "TENDENCIA": "#1d4ed8",  # blue-700
    "SALTO":     "#b45309",  # amber-700
}
TIPO_BG = {
    "PICO":      "#ecfdf5",
    "VALLE":     "#fef2f2",
    "TENDENCIA": "#eff6ff",
    "SALTO":     "#fffbeb",
}


def construir_asunto(eventos: list[Evento]) -> str:
    tipos = []
    for e in eventos:
        etiqueta = {
            "PICO": "Pico", "VALLE": "Valle",
            "TENDENCIA": "Tendencia", "SALTO": "Salto brusco",
        }[e.tipo]
        if etiqueta not in tipos:
            tipos.append(etiqueta)
    return f"Alerta matriculaciones — {' + '.join(tipos)} en el forecast nacional"


def construir_html(nombre: str, provincia: str, eventos: list[Evento]) -> str:
    secciones = []
    for ev in eventos:
        color = TIPO_COLOR.get(ev.tipo, "#0f172a")
        bg = TIPO_BG.get(ev.tipo, "#f8fafc")
        secciones.append(f"""
          <div style="background:{bg};border-left:4px solid {color};
               padding:16px 20px;border-radius:8px;margin:16px 0;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;
                 letter-spacing:.05em;text-transform:uppercase;color:{color};">
              {escape(ev.tipo)}
            </p>
            <p style="margin:0 0 10px;font-size:16px;font-weight:600;color:#0f172a;">
              {escape(ev.titulo)}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0"
                   style="width:100%;font-size:14px;color:#334155;">
              <tr>
                <td style="padding:3px 0;width:180px;color:#64748b;">Periodo afectado</td>
                <td style="padding:3px 0;font-weight:600;">{escape(ev.mes_afectado)}</td>
              </tr>
              <tr>
                <td style="padding:3px 0;color:#64748b;">Predicción (Prophet)</td>
                <td style="padding:3px 0;font-weight:600;">{fmt_int(ev.valor_pred)}</td>
              </tr>
              <tr>
                <td style="padding:3px 0;color:#64748b;">Referencia</td>
                <td style="padding:3px 0;">{fmt_int(ev.referencia)}</td>
              </tr>
              <tr>
                <td style="padding:3px 0;color:#64748b;">Desviación</td>
                <td style="padding:3px 0;font-weight:600;color:{color};">{fmt_pct(ev.desviacion)}</td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:14px;color:#0f172a;line-height:1.5;">
              <strong>Recomendación:</strong> {escape(ev.recomendacion)}
            </p>
          </div>
        """)

    ahora = datetime.now().strftime("%d/%m/%Y")

    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Alerta matriculaciones</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
         style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0"
               style="max-width:640px;width:100%;background:#ffffff;
                      border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:#0f172a;color:#ffffff;padding:22px 28px;">
              <p style="margin:0;font-size:12px;letter-spacing:.08em;
                   text-transform:uppercase;color:#94a3b8;">
                Dashboard de matriculaciones — {escape(ahora)}
              </p>
              <h1 style="margin:6px 0 0;font-size:22px;line-height:1.3;">
                Se han detectado eventos relevantes en el forecast nacional
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;">
              <p style="margin:0 0 6px;font-size:16px;font-weight:600;">
                Hola {escape(nombre)},
              </p>
              <p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">
                Como concesionario en {escape(provincia)}, le informamos de la
                siguiente evolución prevista del mercado nacional de
                matriculaciones para los próximos meses, según el modelo Prophet.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              {''.join(secciones) if secciones else '<p style="color:#64748b;">Sin eventos.</p>'}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;border-top:1px solid #e2e8f0;
                       font-size:12px;color:#94a3b8;line-height:1.5;">
              Esta alerta se genera automáticamente al ejecutar
              <span style="font-family:Consolas,Menlo,monospace;color:#475569;">alert_engine.py</span>
              sobre la serie <span style="font-family:Consolas,Menlo,monospace;color:#475569;">pred_prophet</span>.
              Puede darse de baja gestionando su suscripción en el dashboard.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


# ────────────────────────────────────────────────────────────────────────────
# Envío via Resend
# ────────────────────────────────────────────────────────────────────────────
def enviar_email(
    *, to: str, subject: str, html: str, sender: str, api_key: str
) -> tuple[bool, str]:
    try:
        import resend  # se importa aquí para no romper el import del módulo si falta
    except ImportError:
        return False, "Falta la dependencia 'resend' (pip install resend)"

    resend.api_key = api_key
    try:
        resp = resend.Emails.send({
            "from": sender,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        email_id = (resp or {}).get("id", "")
        return True, email_id or "sent"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ────────────────────────────────────────────────────────────────────────────
# Logging
# ────────────────────────────────────────────────────────────────────────────
def log_line(path: Path, message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {message}\n"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        # No interrumpir el flujo si el log no se puede escribir
        print(line, file=sys.stderr)


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────
def main() -> int:
    subs_path = Path(os.environ.get("ALERT_SUBS", DEFAULT_SUBS))
    csv_path = Path(os.environ.get("ALERT_CSV", DEFAULT_CSV))
    log_path = Path(os.environ.get("ALERT_LOG", DEFAULT_LOG))
    sender = os.environ.get("ALERT_SENDER", DEFAULT_SENDER)
    api_key = os.environ.get("RESEND_API_KEY", "").strip()

    # 1. Suscriptores
    subs = cargar_suscriptores(subs_path)
    if not subs:
        log_line(log_path, "sin suscriptores")
        print("Sin suscriptores. Nada que enviar.")
        return 0

    # 2. Predicciones
    try:
        df = cargar_predicciones(csv_path)
    except (FileNotFoundError, ValueError) as exc:
        log_line(log_path, f"ERROR lectura CSV: {exc}")
        print(f"ERROR lectura CSV: {exc}", file=sys.stderr)
        return 2

    # 3. Análisis
    analisis = analizar(df)
    if not analisis.hay_eventos:
        log_line(
            log_path,
            f"{len(subs)} suscriptores procesados | 0 emails enviados | "
            "sin eventos detectados",
        )
        print("Sin eventos detectados. No se envían emails.")
        return 0

    # 4. Envío
    if not api_key:
        log_line(
            log_path,
            f"{len(subs)} suscriptores procesados | 0 emails enviados | "
            "ERROR: falta RESEND_API_KEY",
        )
        print("ERROR: falta RESEND_API_KEY en el entorno.", file=sys.stderr)
        return 3

    subject = construir_asunto(analisis.eventos)
    enviados = 0
    errores: list[str] = []
    for sub in subs:
        try:
            nombre = str(sub.get("nombre", "")).strip() or "concesionario"
            provincia = str(sub.get("provincia", "")).strip() or "su provincia"
            email = str(sub.get("email", "")).strip()
            if not email:
                errores.append("suscriptor sin email")
                continue
            html = construir_html(nombre, provincia, analisis.eventos)
            ok, info = enviar_email(
                to=email, subject=subject, html=html,
                sender=sender, api_key=api_key,
            )
            if ok:
                enviados += 1
            else:
                errores.append(f"{email}: {info}")
        except Exception as exc:  # defensa ante cualquier fallo por suscriptor
            errores.append(f"{sub.get('email', '?')}: {type(exc).__name__}: {exc}")

    tipos_ev = ", ".join(sorted({e.tipo for e in analisis.eventos}))
    resumen = (
        f"{len(subs)} suscriptores procesados | {enviados} emails enviados | "
        f"eventos: {tipos_ev} | errores: {len(errores)}"
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
