/**
 * api/subscribe.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel Serverless Function que sustituye al middleware Vite en produccion.
 *
 * Almacenamiento: Vercel KV (Upstash Redis-compat).
 *   - Clave unica `subscribers` con un JSON (lista de objetos suscriptor).
 *   - Lectura: kv.get("subscribers")  -> array | string | null
 *   - Escritura: kv.set("subscribers", JSON.stringify(list))
 *
 * Variables de entorno requeridas en Vercel (las inyecta automaticamente la
 * integracion KV de Vercel cuando vinculas la base de datos al proyecto):
 *   KV_REST_API_URL
 *   KV_REST_API_TOKEN
 *   KV_REST_API_READ_ONLY_TOKEN  (no usado aqui pero conviene tenerlo)
 *
 * Si KV no esta configurado, la funcion responde 503 para que el frontend
 * muestre un mensaje claro en vez de un 500 opaco.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { kv } from "@vercel/kv";

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
const KV_KEY = "subscribers";

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function err(message: string, status = 400) {
  return ok({ ok: false, error: message }, status);
}

async function readAll(): Promise<Subscriber[]> {
  const raw = await kv.get<unknown>(KV_KEY);
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as Subscriber[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Subscriber[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function writeAll(list: Subscriber[]): Promise<void> {
  // Guardamos como JSON-string para evitar ambiguedades de serializacion KV.
  await kv.set(KV_KEY, JSON.stringify(list));
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  // Comprobacion temprana de KV: si las env vars no estan, devolvemos 503
  // con mensaje claro en vez de explotar al primer kv.get().
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return err(
      "Almacenamiento de suscripciones no configurado en el servidor (Vercel KV).",
      503,
    );
  }

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
    list = await readAll();
  } catch (e: any) {
    return err(`Error leyendo de KV: ${e?.message ?? e}`, 500);
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
    await writeAll(list);
  } catch (e: any) {
    return err(`Error escribiendo en KV: ${e?.message ?? e}`, 500);
  }

  return ok({ ok: true, updated, email, total: list.length });
}

// Vercel runtime hint: usar Edge si quisieramos baja latencia, pero @vercel/kv
// funciona en ambos. Dejamos node por compatibilidad amplia.
export const config = { runtime: "nodejs" };
