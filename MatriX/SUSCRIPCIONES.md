# Sistema de suscripciones — Runbook de provisión

Este documento describe los pasos de **infraestructura** necesarios para
que la pestaña **Suscripción** funcione en producción (Vercel) con
persistencia real y envío automatizado de alertas + informe mensual.

El código ya está implementado:

- `api/subscribe.ts` — Vercel Serverless Function que persiste en
  **Vercel Blob** con pathname obfuscado.
- `vite.config.ts` — middleware de dev (`/api/subscribe` con
  persistencia en `scripts/subscribers.json`) para `npm run dev`. Sin
  cambios.
- `scripts/alert_engine.py` y `scripts/monthly_report.py` — leen el
  blob obfuscado si `SUBSCRIBERS_SECRET` y `BLOB_BASE_URL` están en el
  entorno; fallback a `subscribers.json` local.
- `.github/workflows/monthly-alerts.yml` — cron mensual día 10 a las
  05:00 UTC, inyecta los Secrets para acceder al blob remoto.
- `pipeline/run_update.bat` — el cron local también dispara los dos
  scripts python tras el pipeline R.

## Modelo de privacidad

Vercel Blob v1.x **solo soporta `access: "public"`**. Toda URL es
accesible sin autenticación. La privacidad de este sistema se basa en
que el pathname del blob **no es enumerable**:

```
subscribers/<sha256(SUBSCRIBERS_SECRET + "v1")>.json
```

Quien no conozca `SUBSCRIBERS_SECRET` no puede construir la URL exacta
y por tanto no puede descargar la lista. Es **privacidad por
obfuscación**, no por autenticación. Implicaciones:

- Si el secret se filtra (logs, dump de env vars, repo público
  accidental), la URL queda comprometida y hay que **rotar** el
  secret. Cambiar `SUBSCRIBERS_SECRET` regenera el pathname; los
  suscriptores quedan en el pathname antiguo hasta migrar el blob a
  mano (download → put nuevo).
- El sufijo `"v1"` permite versionar la rotación (`"v2"`, `"v3"`…)
  cambiando el pathname sin tocar código.
- No es PII privacidad-real para un servicio comercial; es suficiente
  para un TFG académico con intención no maliciosa de los usuarios.

Para privacidad real haría falta migrar a Vercel Postgres, Upstash
Redis directo (con `@upstash/redis`) o cualquier KV con autenticación
por token. Decisión documentada: out-of-scope esta iteración.

## 1. Crear el Blob store en Vercel

1. Vercel dashboard → tu proyecto MatriX → pestaña **Storage**.
2. **Create Database → Blob**.
3. Vercel inyecta automáticamente:
   - `BLOB_READ_WRITE_TOKEN` — credencial server-side.
4. Anota la **URL base** del store (Storage → tu blob → "Domains" o
   "Settings"). Formato:
   `https://<store-id>.public.blob.vercel-storage.com`. Hay que
   añadirla manualmente como `BLOB_BASE_URL` (Vercel no la inyecta
   por defecto con ese nombre).

## 2. Configurar Resend (envío de emails)

1. Crear cuenta en https://resend.com (free 100 emails/día,
   3.000/mes).
2. Verificar un dominio O usar el sandbox `onboarding@resend.dev`
   (limitado a tu propio email registrado en Resend).
3. Crear API key.

## 3. Variables de entorno en Vercel

En Vercel → Project → Settings → Environment Variables, crear como
**Production** (también Preview/Development según convenga):

| Variable | Origen | Notas |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | inyectada por integración Blob | no tocar |
| `BLOB_BASE_URL` | manual | URL pública del store, sin trailing slash |
| `SUBSCRIBERS_SECRET` | manual | cadena aleatoria larga (≥32 chars). Generar con `openssl rand -hex 32` |
| `RESEND_API_KEY` | Resend dashboard | clave API |
| `ALERT_SENDER` | manual | p. ej. `alertas@tu-dominio.com` |
| `REPORT_SENDER` | manual | p. ej. `informes@tu-dominio.com` |
| `DASHBOARD_URL` | manual | URL pública del dashboard |

Tras añadir las variables: **Redeploy** desde Deployments → último →
⋯ → Redeploy. Las funciones serverless solo leen env vars al iniciar.

### Verificación

```bash
curl -X POST https://<tu-dominio>.vercel.app/api/subscribe \
  -H 'content-type: application/json' \
  -d '{"nombre":"Test","email":"test@example.com","provincia":"Madrid","cluster":"Grandes núcleos urbanos","informe_mensual":true}'
```

Respuesta esperada: `{"ok":true,"updated":false,"email":"test@example.com","total":1}`.

Si responde `503 "falta BLOB_READ_WRITE_TOKEN"`: la integración Blob
no está vinculada o el redeploy no se ejecutó tras vincularla.

Si responde `503 "falta SUBSCRIBERS_SECRET"`: añade la variable a mano
en Settings y redeploy.

## 4. GitHub Actions: cron mensual desacoplado del PC

El workflow `.github/workflows/monthly-alerts.yml` se ejecuta el día
10 de cada mes a las 05:00 UTC y permite también ejecución manual.

### Secrets a crear en GitHub

Repo → **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret name | Valor |
|---|---|
| `BLOB_BASE_URL` | mismo valor que en Vercel |
| `SUBSCRIBERS_SECRET` | mismo valor que en Vercel |
| `RESEND_API_KEY` | misma clave Resend |
| `ALERT_SENDER` | mismo |
| `REPORT_SENDER` | mismo |
| `DASHBOARD_URL` | mismo |

⚠ **Limitación con repos públicos**: si tu repo es **público**, los
Secrets de Actions **NO se inyectan** en workflows disparados desde
forks o PRs externos. Para los workflows propios (`schedule` y
`workflow_dispatch` desde la rama `main`) sí se inyectan. Si en algún
momento el repo se hace público y alguien lo forkea, los workflows
del fork verán el blob URL como vacío y el script Python caerá al
fallback de fichero local (lista vacía → "0 emails enviados").

### Verificación

GitHub → **Actions** → workflow "Monthly alerts and executive report"
→ **Run workflow**. Tras 1-2 min: descarga el artefacto
`email-logs-<run_id>` con `alert_log.txt` y `monthly_report_log.txt`.

## 5. Cron local (tarea Windows)

La tarea programada `DGT_Pipeline_Monthly` corre el día 10 de cada
mes a las 04:00 (ver `pipeline/install_schedule.bat`). Tras
regenerar los CSVs ejecuta `alert_engine.py` y `monthly_report.py`
si hay credenciales. Para que lean del blob remoto, exportar las env
vars en el `.env` local del dashboard:

```
SUBSCRIBERS_SECRET=...
BLOB_BASE_URL=https://<store-id>.public.blob.vercel-storage.com
RESEND_API_KEY=re_...
```

Si el `.env` no está, los scripts caen al fichero local y reportan en
log "Lista de suscriptores remota no consultada".

## 6. Trazabilidad

- **GitHub Actions**: artefacto `email-logs-<run_id>` (retención 30
  días).
- **Cron local**: `scripts/alert_log.txt` y
  `scripts/monthly_report_log.txt`.

## 7. Rotación de secret

Para invalidar el pathname actual (p. ej. tras sospecha de filtración
del secret):

1. Generar nuevo `SUBSCRIBERS_SECRET` (`openssl rand -hex 32`).
2. Actualizar la variable en Vercel + GitHub Secrets.
3. Cambiar el sufijo en `api/subscribe.ts` de `"v1"` a `"v2"` (3
   ocurrencias: el `BLOB_PATH` del .ts, el `_blob_url()` de cada
   Python). Commit + redeploy.
4. Migrar el contenido del blob viejo al nuevo manualmente (descargar
   con la URL antigua mientras la sepas, hacer POST al nuevo endpoint
   con cada suscriptor uno a uno, o construir un script ad-hoc).
5. Borrar el blob viejo desde el dashboard de Vercel Blob.

## 8. Privacidad y eliminación de un suscriptor

Hoy el endpoint solo permite altas/upserts. Para baja de un usuario:
manualmente, desde Vercel Blob Browser → descargar el JSON del
pathname obfuscado → editar → re-subir. En una iteración futura
añadir endpoint `DELETE /api/subscribe`.

## 9. Costes estimados (free tier suficiente para TFG)

| Servicio | Free tier | Uso esperado |
|---|---|---|
| Vercel | 100 GB BW, 100k invocations/mes | <10k |
| Vercel Blob | 1 GB storage, 5 GB BW/mes | <100 KB, <100 MB BW |
| Resend | 100 emails/día, 3.000/mes | depende de #suscriptores × eventos |
| GitHub Actions | 2.000 min/mes (público: ilimitado) | ~5 min/mes |
