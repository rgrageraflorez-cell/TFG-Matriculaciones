import React, { useState } from "react";

// ── 52 provincias españolas (50 + Ceuta + Melilla) ──
const PROVINCIAS = [
  "A Coruña", "Álava", "Albacete", "Alicante", "Almería", "Asturias",
  "Ávila", "Badajoz", "Baleares", "Barcelona", "Bizkaia", "Burgos",
  "Cáceres", "Cádiz", "Cantabria", "Castellón", "Ceuta", "Ciudad Real",
  "Córdoba", "Cuenca", "Gipuzkoa", "Girona", "Granada", "Guadalajara",
  "Huelva", "Huesca", "Jaén", "La Rioja", "Las Palmas", "León",
  "Lleida", "Lugo", "Madrid", "Málaga", "Melilla", "Murcia",
  "Navarra", "Ourense", "Palencia", "Pontevedra", "Salamanca",
  "Santa Cruz de Tenerife", "Segovia", "Sevilla", "Soria", "Tarragona",
  "Teruel", "Toledo", "Valencia", "Valladolid", "Zamora", "Zaragoza",
];

// ── 4 clusters territoriales ──
const CLUSTERS = [
  "Grandes núcleos urbanos",
  "Municipios periurbanos",
  "Municipios rurales",
  "Municipios de alta demanda per cápita",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormState = {
  nombre: string;
  email: string;
  provincia: string;
  cluster: string;
  informe_mensual: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; updated: boolean; email: string }
  | { kind: "error"; message: string };

const initial: FormState = { nombre: "", email: "", provincia: "", cluster: "", informe_mensual: true };

export default function SuscripcionTab() {
  const [form, setForm] = useState<FormState>(initial);
  const [touched, setTouched] = useState<Record<keyof FormState, boolean>>({
    nombre: false, email: false, provincia: false, cluster: false,
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!form.nombre.trim()) errors.nombre = "El nombre del concesionario es obligatorio";
  if (!form.email.trim()) errors.email = "El email es obligatorio";
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = "Formato de email no válido";
  if (!form.provincia) errors.provincia = "Selecciona una provincia";
  if (!form.cluster) errors.cluster = "Selecciona un cluster";

  const isValid = Object.keys(errors).length === 0;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus({ kind: "idle" });
  };

  const markTouched = (key: keyof FormState) =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ nombre: true, email: true, provincia: true, cluster: true });
    if (!isValid) return;

    setStatus({ kind: "submitting" });
    try {
      // Timeout de 10s defensivo: si la funcion serverless de Vercel no
      // responde (p.ej. cold start patologico, runtime mal configurado,
      // SPA fallback que devuelve HTML stream sin cerrar), abortamos y
      // mostramos error en vez de spinner infinito.
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          email: form.email.trim().toLowerCase(),
          provincia: form.provincia,
          cluster: form.cluster,
          informe_mensual: form.informe_mensual,
        }),
        signal: AbortSignal.timeout(10000),
      });

      // Manejo defensivo del cuerpo: si el endpoint no esta desplegado o
      // Vercel devuelve el SPA index.html (HTML), parsear como JSON
      // colgaria. Comprobamos content-type primero.
      const contentType = res.headers.get("content-type") ?? "";
      let data: any;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(
          `Respuesta inesperada del servidor (status ${res.status}): ${text.slice(0, 100)}`,
        );
      }

      if (!res.ok) {
        throw new Error(
          (data && data.error) ?? `Error ${res.status} al procesar la suscripción`,
        );
      }

      setStatus({ kind: "success", updated: !!data.updated, email: form.email.trim().toLowerCase() });
      setForm(initial);
      setTouched({ nombre: false, email: false, provincia: false, cluster: false });
    } catch (err: any) {
      const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
      const isNetwork =
        err?.message?.includes("Failed to fetch") ||
        err?.message?.includes("NetworkError");
      setStatus({
        kind: "error",
        message: isTimeout
          ? "El servidor tardó demasiado en responder (>10 s). Inténtalo de nuevo."
          : isNetwork
          ? "No se pudo conectar con el servidor de suscripciones. Arranca el dashboard con 'npm run dev' para habilitar el endpoint."
          : err?.message ?? "Error desconocido al registrar la suscripción",
      });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">
          Alertas push por email
        </h2>
        <p className="text-slate-600 mt-2 max-w-3xl">
          Recibe alertas automáticas en tu correo cuando el modelo Prophet detecte
          eventos relevantes en la evolución del mercado nacional de matriculaciones:
          picos y valles respecto a la media histórica, cambios de tendencia y
          saltos bruscos entre meses consecutivos.
        </p>
      </div>

      {/* ── Formulario ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
        <h3 className="text-xl font-semibold mb-1">Formulario de suscripción</h3>
        <p className="text-slate-500 text-sm mb-6">
          Todos los campos son obligatorios. Solo se envía un email cuando se detecta
          al menos un evento en la serie de predicción nacional.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-5 max-w-xl">
          {/* Nombre */}
          <div>
            <label htmlFor="sub-nombre" className="block text-sm font-medium text-slate-700 mb-1.5">
              Nombre del concesionario
            </label>
            <input
              id="sub-nombre"
              type="text"
              value={form.nombre}
              onChange={(e) => update("nombre", e.target.value)}
              onBlur={() => markTouched("nombre")}
              placeholder="Ej. Automóviles Ejemplo S.L."
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none ${
                touched.nombre && errors.nombre
                  ? "border-red-300 bg-red-50 focus:border-red-500"
                  : "border-slate-200 focus:border-slate-900 focus:bg-slate-50"
              }`}
            />
            {touched.nombre && errors.nombre && (
              <p className="text-xs text-red-600 mt-1">{errors.nombre}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="sub-email" className="block text-sm font-medium text-slate-700 mb-1.5">
              Correo electrónico
            </label>
            <input
              id="sub-email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              onBlur={() => markTouched("email")}
              placeholder="nombre@empresa.es"
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none ${
                touched.email && errors.email
                  ? "border-red-300 bg-red-50 focus:border-red-500"
                  : "border-slate-200 focus:border-slate-900 focus:bg-slate-50"
              }`}
            />
            {touched.email && errors.email && (
              <p className="text-xs text-red-600 mt-1">{errors.email}</p>
            )}
          </div>

          {/* Provincia */}
          <div>
            <label htmlFor="sub-provincia" className="block text-sm font-medium text-slate-700 mb-1.5">
              Provincia de interés
            </label>
            <select
              id="sub-provincia"
              value={form.provincia}
              onChange={(e) => update("provincia", e.target.value)}
              onBlur={() => markTouched("provincia")}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none bg-white ${
                touched.provincia && errors.provincia
                  ? "border-red-300 bg-red-50 focus:border-red-500"
                  : "border-slate-200 focus:border-slate-900"
              }`}
            >
              <option value="">— Selecciona una provincia —</option>
              {PROVINCIAS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {touched.provincia && errors.provincia && (
              <p className="text-xs text-red-600 mt-1">{errors.provincia}</p>
            )}
          </div>

          {/* Cluster */}
          <div>
            <label htmlFor="sub-cluster" className="block text-sm font-medium text-slate-700 mb-1.5">
              Cluster territorial de interés
            </label>
            <select
              id="sub-cluster"
              value={form.cluster}
              onChange={(e) => update("cluster", e.target.value)}
              onBlur={() => markTouched("cluster")}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-colors outline-none bg-white ${
                touched.cluster && errors.cluster
                  ? "border-red-300 bg-red-50 focus:border-red-500"
                  : "border-slate-200 focus:border-slate-900"
              }`}
            >
              <option value="">— Selecciona un cluster —</option>
              {CLUSTERS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {touched.cluster && errors.cluster && (
              <p className="text-xs text-red-600 mt-1">{errors.cluster}</p>
            )}
          </div>

          {/* Opt-in informe mensual */}
          <div>
            <label className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors">
              <input
                id="sub-informe-mensual"
                type="checkbox"
                checked={form.informe_mensual}
                onChange={(e) => update("informe_mensual", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
              />
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Recibir informe ejecutivo mensual de matriculaciones
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Resumen mensual con el pulso del mercado, predicción del próximo mes,
                  score de oportunidad de tu provincia y alerta si se detectan eventos relevantes.
                </p>
              </div>
            </label>
          </div>

          {/* Botón submit */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={status.kind === "submitting"}
              className="px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm shadow-md hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status.kind === "submitting" ? "Registrando..." : "Suscribirme"}
            </button>
          </div>
        </form>

        {/* Mensajes de estado */}
        {status.kind === "success" && (
          <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-sm font-semibold text-emerald-800">
              {status.updated
                ? "Suscripción actualizada correctamente"
                : "Suscripción registrada correctamente"}
            </p>
            <p className="text-sm text-emerald-700 mt-1">
              {status.updated
                ? `Ya existía una suscripción para ${status.email}; se han actualizado tus preferencias.`
                : `Te hemos dado de alta con el correo ${status.email}. Recibirás alertas cuando se detecten eventos relevantes en el forecast nacional.`}
            </p>
          </div>
        )}
        {status.kind === "error" && (
          <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm font-semibold text-red-800">No se pudo completar la suscripción</p>
            <p className="text-sm text-red-700 mt-1">{status.message}</p>
          </div>
        )}
      </section>

      {/* ── Panel informativo: lógica de eventos ── */}
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
        <h3 className="text-xl font-semibold mb-5">¿Qué eventos se monitorizan?</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
            <p className="text-sm font-semibold text-emerald-800">Pico</p>
            <p className="text-xs text-emerald-700 mt-1">
              Alguno de los próximos 6 meses supera en más del 10 % la media histórica del mismo mes calendario.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-red-50 border border-red-100">
            <p className="text-sm font-semibold text-red-800">Valle</p>
            <p className="text-xs text-red-700 mt-1">
              Alguno de los próximos 6 meses queda más de un 10 % por debajo de la media histórica del mismo mes calendario.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
            <p className="text-sm font-semibold text-blue-800">Tendencia</p>
            <p className="text-xs text-blue-700 mt-1">
              La media de los primeros 3 meses del forecast difiere en más de un 5 % respecto a la de los últimos 3.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-sm font-semibold text-amber-800">Salto brusco</p>
            <p className="text-xs text-amber-700 mt-1">
              Dos meses consecutivos del forecast muestran un cambio relativo superior al 15 %.
            </p>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-5">
          Los emails se envían automáticamente cuando <span className="font-mono">alert_engine.py</span> detecta
          al menos un evento sobre la serie <span className="font-mono">pred_prophet</span>. El contenido se
          personaliza con el nombre y la provincia del concesionario.
        </p>
      </section>
    </div>
  );
}
