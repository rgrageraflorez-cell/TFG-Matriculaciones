# `src/lib/llm/` — Andamiaje para textos generados con LLM

Este módulo es **andamiaje preparado** para cuando MatriX integre un modelo
de lenguaje (Claude, Gemini, OpenAI…) que genere texto interpretativo
sobre los datos. Hoy MatriX **no usa LLM en producción**: las dependencias
`@google/genai` y `GEMINI_API_KEY` están en el proyecto desde una
preparación previa, pero ningún flujo activo las invoca. Por eso este
módulo existe como código local sin enchufar a nada.

## Por qué existe

Cualquier texto que un LLM escriba sobre los datos del dashboard puede
incluir afirmaciones causales no verificables ("la subida es debida a la
caída del PIB") que serían engañosas. La política del proyecto es
distinguir explícitamente:

- **HECHOS** — derivables directamente de los datos.
- **PATRONES OBSERVADOS** — relaciones presentes sin atribución de causa.
- **HIPÓTESIS** — interpretaciones causales, con marca verbal de
  incertidumbre obligatoria.

Las afirmaciones causales fuera del bloque de hipótesis se rechazan
automáticamente.

## Componentes

### `prompts/structuredOutputPrompt.ts`

Constante `STRUCTURED_OUTPUT_INSTRUCTIONS`: instrucciones a anexar al
system prompt de cualquier llamada al LLM. Define los tres bloques con
sus reglas. **No renombrar los headers** sin actualizar el parser del
verificador (busca `BLOQUE 1 — HECHOS`, etc.).

### `verifiers/causalClaimsVerifier.ts`

- `extractBlocks(text)`: separa el output en hechos / patrones / hipótesis.
- `detectCausalLanguage(blockText)`: busca patrones causales fuertes
  (`debido a`, `provoca`, `causa principal`…) y devuelve el primer
  match o null.
- `verifyFactualClaims(factsBlock, dataContext, tolerance?)`: comprueba
  que las cifras citadas en el bloque de hechos aparecen en el contexto
  de datos suministrado. Tolerancia 0.5% por defecto.
- `validateOutput(text, dataContext?, options?)`: aplica los anteriores y
  devuelve `{ isValid, issues, blocks? }`.

### `verifiers/causalClaimsVerifier.test.ts`

Tests de Vitest. Cobertura: detección de patrones, marcas de
incertidumbre, estructura ausente, parser de números en formato español.

Ejecutar: `npm test` desde la raíz del dashboard.

## Flujo previsto cuando se integre un LLM real

```ts
import { STRUCTURED_OUTPUT_INSTRUCTIONS } from "./prompts/structuredOutputPrompt";
import { validateOutput } from "./verifiers/causalClaimsVerifier";

async function generarTextoSeguro(prompt: string, dataContext: number[]) {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n${STRUCTURED_OUTPUT_INSTRUCTIONS}`;
  let intentos = 0;
  let lastResult, lastText = "";

  while (intentos < 2) {
    intentos++;
    const temp = intentos === 1 ? 0.7 : 0.3; // bajamos creatividad en reintento
    lastText = await llamarLLM({ system: systemPrompt, prompt, temperature: temp });
    lastResult = validateOutput(lastText, dataContext);
    if (lastResult.isValid) break;
    // En el reintento, le decimos al LLM qué falló para que se autocorrija.
    prompt = `${prompt}\n\n[Tu respuesta anterior tuvo estos issues: ${
      lastResult.issues.map((i) => i.detail).join(" | ")
    }. Reescríbela respetando la separación de bloques.]`;
  }

  if (!lastResult!.isValid) {
    // Mostrar con disclaimer + log para revisar
    persistLog({
      timestamp: new Date().toISOString(),
      promptOriginal: prompt,
      outputRechazado: lastText,
      issues: lastResult!.issues,
    });
    return {
      text: lastText,
      disclaimer: "Texto generado automáticamente. Verificación parcial.",
      issues: lastResult!.issues,
    };
  }
  return { text: lastText };
}
```

## Por qué la lista negra de causales es la que es

Los patrones en `CAUSAL_PATTERNS` se eligieron para flaggear las
construcciones causales **explícitas e inequívocas** del español: "debido
a", "es consecuencia de", "provoca", etc. Quedan fuera deliberadamente:

- "causa" como sustantivo aislado ("la causa del expediente"): produce
  demasiados falsos positivos.
- "explica" ("la varianza explica el 60%"): es vocabulario estadístico
  legítimo en bloque de patrones.
- Adverbios de probabilidad ("probablemente", "quizás"): son la marca
  *contraria* a la causalidad fuerte y el LLM debería poder usarlos.

La lista es voluntariamente conservadora: prefiere falso positivo
(forzar regeneración) antes que falso negativo (publicar causalidad sin
autorizar). Si en operación real se detectan falsos positivos
sistemáticos, ajustar aquí, no relajando el umbral del verificador.

## Política de regeneración

- **1er intento**: temperature 0.7, prompt original + instrucciones.
- **2º intento**: temperature 0.3, prompt original + instrucciones +
  detalle de issues del intento 1.
- **Tras 2 fallos**: mostrar el output con disclaimer visible + log de
  issues. No reintentar más (gasto de tokens + ciclo de espera del usuario).

El log debe persistirse (localStorage en frontend, tabla en backend si
hay) para auditoría posterior y para ajustar la lista negra si emergen
falsos positivos.

## Cuándo activar

Cuando se añada la primera llamada real a un LLM en `src/`. Mientras
tanto, este módulo es código muerto que no se importa desde ningún sitio
del frontend (verificable: `grep -r "from.*lib/llm" src/`). Esto es
deliberado, no un olvido.
