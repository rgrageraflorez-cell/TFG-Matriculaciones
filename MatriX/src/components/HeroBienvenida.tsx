import React, { useEffect, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { GeoJsonType } from "../types";

type Props = {
  onExplorar: () => void;
  onFichaTecnica: () => void;
};

// ── Utilidad: contador animado simple ───────────────────────────────────────
// Implementacion con requestAnimationFrame y easing easeOutCubic. Se evita
// anadir libreria de animacion solo para esto: framer-motion ya esta en deps
// pero el contador es una operacion suficientemente simple para 30 lineas.
function useCountUp(
  target: number,
  durationMs: number,
  delayMs: number,
  enabled: boolean,
): number {
  const [v, setV] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setV(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const elapsed = t - start - delayMs;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs, enabled]);
  return v;
}

// Provincias destacadas: Madrid (28), Barcelona (08), Valencia (46).
const PROV_DESTACADAS = new Set(["28", "08", "46"]);

export default function HeroBienvenida({ onExplorar, onFichaTecnica }: Props) {
  const [geoJson, setGeoJson] = useState<GeoJsonType | null>(null);
  const reducedRef = useRef(
    typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const animEnabled = !reducedRef.current;

  useEffect(() => {
    let cancelled = false;
    fetch("/provincias.geojson?v=4")
      .then((r) => r.json())
      .then((g) => {
        if (!cancelled) setGeoJson(g);
      })
      .catch(() => {
        /* sin mapa, el resto del hero sigue funcionando */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Contadores: arrancan en t=1.0s (segun timeline del brief).
  const mape = useCountUp(8.56, 1000, 1000, animEnabled);
  const tipologias = useCountUp(4, 800, 1000, animEnabled);
  const municipios = useCountUp(8077, 1200, 1000, animEnabled);

  const fmtMape = (v: number) => `${v.toFixed(2).replace(".", ",")}%`;
  // Separador de miles forzado: toLocaleString("es-ES") no agrupa numeros
  // de 4 digitos en algunas locales/navegadores. Con esto garantizamos "8.077".
  const fmtMuni = (v: number) =>
    Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return (
    <section
      role="banner"
      className="hero-bienvenida"
      aria-label="Bienvenida a MatriX"
    >
      <div className="hero-noise" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="hero-content">
        <h1 className="hero-titulo">MatriX</h1>
        <p className="hero-subtitulo">
          Predicción y análisis territorial de la demanda automovilística en España
        </p>

        <div className="hero-cuerpo">
          {/* Mapa SVG con animacion stagger por provincia */}
          <div className="hero-mapa">
            {geoJson && (
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ center: [-3.5, 40.2], scale: 1800 }}
                style={{ width: "100%", height: "auto" }}
              >
                <Geographies geography={geoJson}>
                  {({ geographies }) =>
                    geographies.map((geo: any, i: number) => {
                      const cod = String(geo.properties.prov ?? "").padStart(2, "0");
                      const destacada = PROV_DESTACADAS.has(cod);
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          style={{
                            default: {
                              fill: destacada ? "#2C4A7C" : "#1a2035",
                              stroke: destacada ? "#C4922A" : "rgba(196,146,42,0.4)",
                              strokeWidth: destacada ? 1.2 : 0.6,
                              outline: "none",
                              opacity: 0,
                              animation: animEnabled
                                ? `hero-prov-in 0.55s ${0.7 + i * 0.025}s cubic-bezier(0.16,1,0.3,1) forwards`
                                : "none",
                            },
                            hover: { outline: "none" },
                            pressed: { outline: "none" },
                          }}
                        />
                      );
                    })
                  }
                </Geographies>
              </ComposableMap>
            )}
          </div>

          {/* Badges + botones */}
          <div className="hero-derecha">
            <div className="hero-badges">
              <div className="hero-badge">
                <p className="hero-badge-num">{fmtMape(mape)}</p>
                <p className="hero-badge-label">MAPE Prophet</p>
                <p className="hero-badge-sub">en test out-of-sample</p>
              </div>
              <div className="hero-badge">
                <p className="hero-badge-num">{Math.round(tipologias)}</p>
                <p className="hero-badge-label">Tipologías territoriales</p>
                <p className="hero-badge-sub">municipales identificadas</p>
              </div>
              <div className="hero-badge">
                <p className="hero-badge-num">{fmtMuni(municipios)}</p>
                <p className="hero-badge-label">Municipios analizados</p>
                <p className="hero-badge-sub">en España</p>
              </div>
              <div className="hero-badge">
                <p className="hero-badge-niveles">Nacional · Provincial · Municipal</p>
                <p className="hero-badge-label">Cobertura</p>
                <p className="hero-badge-sub">Tres niveles geográficos</p>
              </div>
            </div>

            <div className="hero-botones">
              <button
                type="button"
                className="hero-btn hero-btn-primary"
                onClick={onExplorar}
                aria-label="Explorar el dashboard de MatriX"
              >
                Explorar el dashboard
              </button>
              <button
                type="button"
                className="hero-btn hero-btn-secondary"
                onClick={onFichaTecnica}
                aria-label="Ir a la ficha técnica del proyecto"
              >
                Ficha técnica
              </button>
            </div>
          </div>
        </div>
      </div>

      <span className="hero-pie" aria-hidden="true">
        TFG · Business Analytics
      </span>
    </section>
  );
}
