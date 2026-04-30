# Sistema de suscripciones — Runbook de provisión

Este documento describe los pasos de **infraestructura** que hay que dar
para que la pestaña **Suscripción** funcione en producción (Vercel) con
persistencia real y envío automatizado de alertas e informes mensuales.

El código ya está implementado:

- `api/subscribe.ts` — Vercel Serverless Function que persiste en Vercel KV.
- `vite.config.ts` — sigue manteniendo el middleware de dev (`/api/subscribe`
  con persistencia en `scripts/subscribers.json`) para `npm run dev`.
- `scripts/alert_engine.py` y `scripts/monthly_report.py` — leen de Vercel KV
  si las env vars `KV_REST_API_URL` / `KV_REST_API_TOKEN` están definidas;
  si no, caen al JSON local.
- `.github/workflows/monthly-alerts.yml` — cron mensual independiente del PC.
- `pipeline/run_update.bat` — el cron local también dispara `monthly_report.py`.

## 1. Crear la base de datos Vercel KV

1. En el dashboard de Vercel del proyecto MatriX → pestaña **Storage**.
2. **Create Database → KV**. Elige región Frankfurt (eu-central) o París.
3. Vercel creará automáticamente las env vars en el proyecto:
   `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`,
   `KV_URL`. No hace falta tocarlas a mano — están vinculadas al proyecto.
4. **Redeploy** el proyecto (Deployments → último → ⋯ → Redeploy) para que
   el endpoint `/api/subscribe` cargue las env vars nuevas.

### Verificación

```bash
curl -X POST https://<tu-dominio>.vercel.app/api/subscribe \
     -H 'content-type: application/json' \
     -d '{"nombre":"Test","email":"test@example.com","provincia":"Madrid","cluster":"Grandes núcleos urbanos","informe_mensual":true}'
```

Debe responder `{"ok":true,"updated":false,"email":"test@example.com","total":1}`.

Si responde `503 "Almacenamiento de suscripciones no configurado"`, faltan
las env vars de KV en el proyecto Vercel.

## 2. Configurar Resend (envío de emails)

1. Crear cuenta en https://resend.com (free tier: 100 emails/día, 3.000/mes).
2. Verificar un dominio propio O usar el sandbox `onboarding@resend.dev`
   (solo permite enviar a tu propio email registrado en Resend).
3. Crear una API key (dashboard Resend → API Keys → Create).
4. Variables que usan los scripts Python:
   - `RESEND_API_KEY` — la clave anterior.
   - `ALERT_SENDER` — remitente para alertas (debe ser de un dominio
     verificado en Resend; ejemplo: `alertas@tu-dominio.com`).
   - `REPORT_SENDER` — remitente para informe mensual.
   - `DASHBOARD_URL` — URL pública del dashboard (para enlaces dentro del
     email). Ejemplo: `https://matrix-dashboard.vercel.app`.

## 3. GitHub Actions: cron mensual desacoplado del PC

El workflow `.github/workflows/monthly-alerts.yml` se ejecuta el día 1 de
cada mes a las 05:00 UTC y también puede dispararse manualmente desde la
pestaña **Actions** del repo.

### Secrets a crear

En el repo GitHub `rgrageraflorez-cell/TFG-Matriculaciones` →
**Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Valor |
|---|---|
| `KV_REST_API_URL` | Copiar de Vercel → Project → Settings → Environment Variables |
| `KV_REST_API_TOKEN` | Idem |
| `RESEND_API_KEY` | Resend dashboard → API Keys |
| `ALERT_SENDER` | p.ej. `alertas@tu-dominio.com` |
| `REPORT_SENDER` | p.ej. `informes@tu-dominio.com` |
| `DASHBOARD_URL` | URL pública del dashboard |

### Verificación

GitHub → **Actions** → workflow "Monthly alerts and executive report" →
**Run workflow** (botón). Tras ~1-2 minutos verás el resultado y los logs
adjuntos como artefacto descargable.

## 4. Cron local (opcional, redundante con GitHub Actions)

La tarea programada de Windows `DGT_Pipeline_Monthly` sigue funcionando.
Tras estos cambios, además de `alert_engine.py` ahora también dispara
`monthly_report.py` (los días 1-3 del mes). Si configuras KV en el `.env`
de tu PC, ambos cron (local y GitHub) leerán la misma fuente de
suscriptores.

Para evitar emails duplicados (mismo mes enviado dos veces), basta con:

- **Opción A (recomendada)**: deshabilitar la tarea local
  `DGT_Pipeline_Monthly` (PowerShell: `Disable-ScheduledTask -TaskName
  DGT_Pipeline_Monthly`) y dejar solo el GitHub Action.
- **Opción B**: mantener ambas y aceptar que cada suscriptor recibe el
  email dos veces el día 1.
- **Opción C**: dejar el cron local solo para regenerar CSVs y comentar
  `call :run_alerts` y `call :run_monthly_report` en `run_update.bat`.

## 5. Trazabilidad

Cada ejecución se registra:

- **GitHub Actions**: artefacto `email-logs-<run_id>` con `alert_log.txt` y
  `monthly_report_log.txt` (retención 30 días).
- **Cron local**: los logs se sobrescriben en `scripts/alert_log.txt` y
  `scripts/monthly_report_log.txt`.

## 6. Privacidad

- `subscribers.test.json` se ha movido a `scripts/fixtures/` (fuera de la
  carpeta servida por Vercel) para evitar fuga de PII.
- `scripts/*.py` ya no están en `public/`, así que no se sirven como
  estáticos.
- `subscribers.json` real **nunca** debe subirse al repo (ya lo cubre
  `.gitignore`).

## 7. Costes estimados (free tier suficiente para TFG)

| Servicio | Free tier | Uso esperado MatriX |
|---|---|---|
| Vercel | 100 GB bandwidth, 100k serverless invocations/mes | <10k invocaciones |
| Vercel KV | 30k requests/mes, 256 MB storage | <1k requests, <1 MB |
| Resend | 100 emails/día, 3.000/mes, 1 dominio | depende de #suscriptores × eventos |
| GitHub Actions | 2.000 minutos/mes (repo público: ilimitado) | ~5 minutos/mes |
