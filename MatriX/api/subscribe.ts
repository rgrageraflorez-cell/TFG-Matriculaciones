/**
 * api/subscribe.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel Serverless Function: persistencia de suscriptores en Vercel Blob.
 *
 * Almacenamiento: un unico JSON en Blob con pathname OBFUSCADO.
 *   pathname: subscribers/<sha256(SUBSCRIBERS_SECRET + "v1")>.json
 *   contenido: array de Subscriber[]
 *
 * Modelo de privacidad:
 *   @vercel/blob v1.x solo soporta access: "public", asi que toda URL
 *   resultante es accesible sin autenticacion. La privacidad se basa en
 *   que el pathname depende de SUBSCRIBERS_SECRET, conocido solo por
 *   este server y por los scripts Python autorizados. La URL no es
 *   enumerable (no hay pista visible del nombre exacto del blob).
 *   Limitacion: si el secret se filtra, la URL queda comprometida y
 *   hay que rotarlo (cambiar SUBSCRIBERS_SECRET regenera el pathname).
 *   No es privacidad por autenticacion sino por URL no enumerable.
 *
 * Variables de entorno requeridas en Vercel:
 *   BLOB_READ_WRITE_TOKEN  (la inyecta la integracion Blob)
 *   SUBSCRIBERS_SECRET     (anadida a mano antes del deploy)
 *
 * Si alguna falta, la funcion responde 503 con mensaje claro.
 *
 * Migracion historica:
 *   1. Inicio con @vercel/kv (deprecated v3, KV no provisionada).
 *   2. Migracion a @vercel/blob, access "public" pathname predecible
 *      (leak de PII).
 *   3. Pathname obfuscado por sha256(secret + "v1") (esta version).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { put, head } from "@vercel/blob";
import { createHash } from "node:crypto";

type Subscriber = {
  nombre: string;
  email: string;
  provincia: string;
  cluster: string;
  informe_mensual: boolean;
  created_at: string;
  updated_at: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pathname OBFUSCADO calculado UNA SOLA VEZ al cargar el modulo (no por
// request). El sufijo "v1" permite rotar todo el pathname cambiando solo
// el secret, sin tocar codigo. Si SUBSCRIBERS_SECRET no esta presente al
// arrancar, dejamos un valor centinela que el handler detecta y responde
// 503 antes de hacer cualquier IO.
const SUBSCRIBERS_SECRET = process.env.SUBSCRIBERS_SECRET ?? "";
const BLOB_PATH = SUBSCRIBERS_SECRET
  ? `subscribers/${createHash("sha256")
      .update(SUBSCRIBERS_SECRET + "v1")
      .digest("hex")}.json`
  : "";

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function err(message: string, status = 400) {
  return ok({ ok: false, error: message }, status);
}

/**
 * Lee la lista de suscriptores del Blob. Si el blob aun no existe
 * (primera suscripcion), devuelve array vacio sin propagar el error.
 *
 * - head() con abortSignal de 8s para no agotar el limite de 10s del
 *   runtime serverless si el servicio Blob no responde.
 * - fetch() del CDN con cache:"no-store" para garantizar lectura fresca
 *   tras un put(), sin necesidad de query-params custom de cache-busting.
 */
async function readAll(): Promise<Subscriber[]> {
  const t0 = Date.now();
  try {
    console.log(`[subscribe][readAll] +0ms head() inicio`);
    const blob = await head(BLOB_PATH, {
      abortSignal: AbortSignal.timeout(8000),
    });
    console.log(`[subscribe][readAll] +${Date.now() - t0}ms head() OK url=${blob?.url ? "set" : "null"}`);
    if (!blob || !blob.url) return [];
    console.log(`[subscribe][readAll] +${Date.now() - t0}ms fetch() inicio`);
    const res = await fetch(blob.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    console.log(`[subscribe][readAll] +${Date.now() - t0}ms fetch() OK status=${res.status}`);
    if (!res.ok) return [];
    const data = await res.json();
    console.log(`[subscribe][readAll] +${Date.now() - t0}ms json() OK n=${Array.isArray(data) ? data.length : "noarr"}`);
    return Array.isArray(data) ? (data as Subscriber[]) : [];
  } catch (e: any) {
    console.log(`[subscribe][readAll] +${Date.now() - t0}ms catch: ${e?.name ?? "?"}: ${e?.message ?? e}`);
    // head() lanza BlobNotFoundError si nunca se ha escrito el blob.
    // Es el caso normal en la primera suscripcion: devolvemos vacio.
    // Tambien capturamos AbortError si head()/fetch() superan el timeout.
    return [];
  }
}

/**
 * Sobrescribe el blob con la lista actualizada. addRandomSuffix=false
 * mantiene el pathname estable; allowOverwrite=true permite sustitucion.
 *
 * NO se pasa cacheControlMaxAge: el SDK rechaza valores < 60 (1 minuto)
 * y reintenta internamente, lo que provocaba timeouts del runtime
 * serverless. El default del SDK (1 mes) esta bien — el readAll()
 * fuerza frescura via fetch(..., { cache: "no-store" }).
 */
async function writeAll(list: Subscriber[]): Promise<void> {
  const t0 = Date.now();
  try {
    console.log(`[subscribe][writeAll] +0ms put() inicio n=${list.length}`);
    await put(BLOB_PATH, JSON.stringify(list), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      abortSignal: AbortSignal.timeout(8000),
    });
    console.log(`[subscribe][writeAll] +${Date.now() - t0}ms put() OK`);
  } catch (e: any) {
    console.log(`[subscribe][writeAll] +${Date.now() - t0}ms catch: ${e?.name ?? "?"}: ${e?.message ?? e}`);
    throw e;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const tH = Date.now();
  console.log(`[subscribe][handler] +0ms entrada method=${req.method}`);

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  // Comprobacion temprana de credenciales: 503 con mensaje claro en vez
  // de explotar al primer put().
  console.log(`[subscribe][handler] +${Date.now() - tH}ms validando secrets`);
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms 503 falta BLOB_READ_WRITE_TOKEN`);
    return err(
      "Almacenamiento de suscripciones no configurado en el servidor (falta BLOB_READ_WRITE_TOKEN).",
      503,
    );
  }
  if (!BLOB_PATH) {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms 503 falta SUBSCRIBERS_SECRET`);
    return err(
      "Almacenamiento de suscripciones no configurado en el servidor (falta SUBSCRIBERS_SECRET).",
      503,
    );
  }
  console.log(`[subscribe][handler] +${Date.now() - tH}ms secrets OK`);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return err("JSON invalido en el cuerpo de la peticion.", 400);
  }

  const nombre = String(payload?.nombre ?? "").trim();
  const email = String(payload?.email ?? "").trim().toLowerCase();
  const provincia = String(payload?.provincia ?? "").trim();
  const cluster = String(payload?.cluster ?? "").trim();
  const informe_mensual =
    payload?.informe_mensual === undefined ? true : Boolean(payload.informe_mensual);

  if (!nombre || !email || !provincia || !cluster || !EMAIL_RE.test(email)) {
    return err("Campos invalidos o incompletos", 400);
  }

  const now = new Date().toISOString();
  let list: Subscriber[];
  try {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms readAll() inicio`);
    list = await readAll();
    console.log(`[subscribe][handler] +${Date.now() - tH}ms readAll() OK n=${list.length}`);
  } catch (e: any) {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms readAll() ERROR ${e?.message ?? e}`);
    return err(`Error leyendo de Blob: ${e?.message ?? e}`, 500);
  }

  const idx = list.findIndex((s) => (s.email ?? "").toLowerCase() === email);
  let updated = false;
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      nombre,
      email,
      provincia,
      cluster,
      informe_mensual,
      updated_at: now,
    };
    updated = true;
  } else {
    list.push({
      nombre,
      email,
      provincia,
      cluster,
      informe_mensual,
      created_at: now,
      updated_at: now,
    });
  }

  try {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms writeAll() inicio`);
    await writeAll(list);
    console.log(`[subscribe][handler] +${Date.now() - tH}ms writeAll() OK`);
  } catch (e: any) {
    console.log(`[subscribe][handler] +${Date.now() - tH}ms writeAll() ERROR ${e?.message ?? e}`);
    return err(`Error escribiendo en Blob: ${e?.message ?? e}`, 500);
  }

  console.log(`[subscribe][handler] +${Date.now() - tH}ms 200 OK updated=${updated} total=${list.length}`);
  return ok({ ok: true, updated, email, total: list.length });
}

// runtime: Vercel Node.js por defecto (no declarar
// runtime: "nodejs" — valor invalido en Vercel; antes lo declarabamos y
// provocaba que la funcion no se desplegara, devolviendo HTML como
// fallback y colgando el await res.json() del frontend).
