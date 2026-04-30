import React from "react";
import type { TabId } from "../types";

type Props = {
  onNavigate: (tab: TabId) => void;
};

const PILDORAS = [
  "Predicción mensual con MAPE 8,56%",
  "Modelo MD propio, validación externa",
  "4 tipologías territoriales municipales",
  "Actualización automática mensual",
];

export default function HomeIntro({ onNavigate }: Props) {
  return (
    <section
      aria-labelledby="hero-title"
      className="exec-card"
      style={{
        padding: "28px 32px",
        marginBottom: 28,
        borderLeft: "3px solid #1A2B4A",
      }}
    >
      <h1
        id="hero-title"
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: "#1A2B4A",
          letterSpacing: "-0.02em",
          margin: "0 0 6px 0",
          lineHeight: 1.1,
        }}
      >
        MatriX
      </h1>

      <p
        style={{
          fontSize: 15,
          fontWeight: 500,
          color: "#2C4A7C",
          margin: "0 0 14px 0",
          letterSpacing: "-0.005em",
        }}
      >
        Predicción y análisis territorial de la demanda automovilística en España.
      </p>

      <p
        className="exec-body"
        style={{ maxWidth: 880, margin: "0 0 18px 0" }}
      >
        Sistema integrado que combina modelos validados de series temporales
        (TBATS y Prophet) con un método propio de desagregación diaria
        (Modelo MD), análisis territorial municipal mediante clustering y un
        pipeline agéntico que actualiza el sistema con cada nueva publicación
        mensual de la DGT. Desarrollado como Trabajo Fin de Grado en Business
        Analytics.
      </p>

      <div
        className="flex flex-wrap"
        style={{ gap: 8, marginBottom: 20 }}
        aria-label="Datos destacados"
      >
        {PILDORAS.map((t) => (
          <span key={t} className="exec-pill">
            {t}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap" style={{ gap: 10 }}>
        <button
          type="button"
          className="exec-btn-secondary exec-btn"
          onClick={() => onNavigate("ficha-tecnica")}
        >
          Ficha técnica del proyecto
        </button>
        <button
          type="button"
          className="exec-btn"
          onClick={() => onNavigate("modelo-negocio")}
        >
          Modelo de negocio
        </button>
      </div>
    </section>
  );
}
