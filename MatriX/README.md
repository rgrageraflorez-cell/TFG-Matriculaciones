# MatriX

**MatriX — Sistema de Análisis de la Demanda Automovilística**

Dashboard ejecutivo para el análisis de matriculaciones de vehículos en España (datos DGT).
Incluye módulos descriptivo, predictivo (Prophet, TBATS, MD diario), cognitivo (score territorial,
detección de anomalías) y suscripción a alertas e informes mensuales por email.

## Run Locally

**Prerequisites:** Node.js 20+

1. Instalar dependencias:
   ```
   npm install
   ```
2. Definir `GEMINI_API_KEY` en `.env.local` con tu clave de Gemini API.
3. Arrancar la app:
   ```
   npm run dev
   ```
