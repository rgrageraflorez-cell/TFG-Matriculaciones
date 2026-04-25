# Despliegue de MatriX en Vercel

Esta guía cubre el despliegue público del dashboard MatriX en Vercel,
incluyendo el alojamiento externo del CSV pesado en Google Drive.

> **Nota previa:** el CSV `df_mensual_marca_lugar.csv` (~150 MB) supera el
> límite de 100 MB por archivo de GitHub. Está excluido del repositorio
> por `.gitignore` y se sirve desde Google Drive. La URL se inyecta en
> tiempo de build mediante la variable `VITE_CSV_MARCA_LUGAR_URL`.

---

## 1. Subir `df_mensual_marca_lugar.csv` a Google Drive

1. Entra en <https://drive.google.com> con tu cuenta personal o de la
   universidad.
2. Crea una carpeta llamada por ejemplo `MatriX – Datos públicos` y sube
   `df_mensual_marca_lugar.csv` (puedes arrastrarlo desde tu carpeta
   `public/`).
3. Cuando termine la subida, haz **clic derecho sobre el archivo →
   Compartir → Compartir**.
4. En *Acceso general*, cambia a **"Cualquier usuario con el enlace"** y
   confirma con permiso de **Lector**.
5. Copia el enlace que te genera Drive. Tendrá la forma:
   ```
   https://drive.google.com/file/d/1AbC2dEf3GhI4JkL5MnO6PqR7sTuV/view?usp=sharing
   ```
   El **ID del archivo** es el bloque entre `/d/` y `/view`:
   `1AbC2dEf3GhI4JkL5MnO6PqR7sTuV`.
6. Construye la URL pública de descarga directa sustituyendo el ID:
   ```
   https://drive.google.com/uc?export=download&id=1AbC2dEf3GhI4JkL5MnO6PqR7sTuV
   ```
7. **Verificación:** pega esa URL en una pestaña incógnita. Debe iniciar
   la descarga directamente (Drive puede mostrar primero un aviso
   "no se puede analizar el archivo" para archivos > 100 MB; en ese caso
   añade `&confirm=t` al final de la URL).
8. Guarda esa URL — la pegarás en Vercel en el paso 3.

---

## 2. Subir el proyecto a GitHub

1. Crea una cuenta en <https://github.com> si no tienes una.
2. En la esquina superior derecha → **+ → New repository**.
3. Asigna un nombre (`matrix-dashboard`), elige **Private** o **Public**
   (Vercel funciona con ambos en su plan gratuito) y **NO** marques
   "Add a README" — ya tienes uno.
4. Desde la raíz del proyecto (`Web dashboard/`) abre una terminal y
   ejecuta:

   ```bash
   git init
   git add .
   git status            # confirma que df_mensual_marca_lugar.csv NO aparece
   git commit -m "MatriX dashboard - initial commit"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/matrix-dashboard.git
   git push -u origin main
   ```

5. **Verificación crítica:** ve al repositorio en GitHub y confirma que
   **`df_mensual_marca_lugar.csv` NO está subido** (lo bloquea el
   `.gitignore`). Si por error apareciera, GitHub te lo habría rechazado
   con un error de tamaño.

---

## 3. Crear cuenta en Vercel y conectar el repositorio

1. Ve a <https://vercel.com> y regístrate con la cuenta de GitHub que
   acabas de usar (botón **"Continue with GitHub"**). El plan **Hobby**
   es gratuito y suficiente para este proyecto.
2. En el dashboard de Vercel pulsa **"Add New… → Project"**.
3. Vercel listará tus repositorios de GitHub. Si no aparece, pulsa
   **"Adjust GitHub App Permissions"** y concede acceso al repo
   `matrix-dashboard`.
4. Pulsa **Import** sobre `matrix-dashboard`.
5. En la pantalla de configuración:
   - **Framework Preset:** Vercel detecta automáticamente *Vite*. Déjalo.
   - **Build & Output Settings:** ya están definidos por `vercel.json`,
     no toques nada.
   - Despliega la sección **Environment Variables** y añade:

     | Name | Value | Environments |
     |---|---|---|
     | `VITE_CSV_MARCA_LUGAR_URL` | `https://drive.google.com/uc?export=download&id=<TU_ID>` | Production, Preview, Development |

   - Si más adelante usas Gemini desde el frontend, añade también
     `GEMINI_API_KEY` con tu clave.
6. Pulsa **Deploy**.

---

## 4. Primer despliegue y verificación

1. Vercel construirá el proyecto (`npm install` + `npm run build`) y
   publicará el resultado. La primera build tarda ~1-2 min.
2. Cuando termine, Vercel te muestra una URL del estilo
   `https://matrix-dashboard.vercel.app`. Ábrela.
3. **Checklist de verificación en producción:**
   - ✅ La cabecera "MatriX" aparece sobre fondo navy.
   - ✅ La pestaña *Descriptiva* carga datos (los CSV ligeros del
     `public/` se sirven desde Vercel).
   - ✅ La pestaña *Predictiva* muestra los modelos Prophet/TBATS y el
     simulador de escenarios.
   - ✅ La pestaña *Cognitiva* renderiza el mapa coroplético y el score
     territorial. Esta sección **descarga el CSV pesado de Google
     Drive** la primera vez que se accede — abre la consola del
     navegador (F12 → Network) y comprueba que la petición va a
     `drive.google.com` y devuelve `200 OK`.
   - ✅ El generador de informe PDF (botón en *Descriptiva*) completa la
     descarga del CSV pesado y produce el PDF.
4. Si la descarga del CSV falla con un error de CORS o de redirección de
   Drive, prueba estas alternativas:
   - Añade `&confirm=t` al final de `VITE_CSV_MARCA_LUGAR_URL` para
     saltar el aviso de virus de Drive.
   - Sube el CSV a un blob público de **Cloudflare R2**, **AWS S3** o
     **Vercel Blob** y usa esa URL — son backends pensados para
     descargas grandes y soportan CORS sin trucos.
5. Cualquier `git push` posterior a `main` despliega automáticamente una
   nueva versión. Para variables de entorno: **Settings → Environment
   Variables**; tras cambiarlas hay que pulsar **Redeploy**.

---

## Solución de problemas

- **"Build failed: tsc errors"** — ejecuta `npm run lint` en local para
  reproducir y corregir.
- **CSV pesado no se descarga** — abre la URL pública en incógnito.
  Si Drive muestra el aviso de tamaño, usa `&confirm=t` o cambia a un
  hosting tipo S3/R2/Blob.
- **`subscribers.json` no existe en producción** — está en el
  `.gitignore` por contener emails. El módulo de suscripción usa el
  endpoint Vite local solo en desarrollo; en Vercel necesitarás un
  servicio externo (Supabase, Notion API, formulario de Resend, etc.)
  o bien convertir el endpoint en una *Serverless Function* de Vercel
  (`api/subscribe.ts`).
