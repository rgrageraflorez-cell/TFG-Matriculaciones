import React from "react";
import type { TabId } from "./types";

const TABS: { id: TabId; label: string }[] = [
  { id: "descriptiva", label: "Descriptiva" },
  { id: "predictiva", label: "Predictiva" },
  { id: "cognitiva", label: "Cognitiva" },
  { id: "suscripcion", label: "Suscripción" },
  { id: "ficha-tecnica", label: "Ficha técnica" },
  { id: "modelo-negocio", label: "Modelo de negocio" },
];

type Props = {
  active: TabId;
  onChange: (tab: TabId) => void;
};

export default function TabNav({ active, onChange }: Props) {
  return (
    <nav className="flex flex-wrap" role="tablist">
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="cursor-pointer transition-colors"
            style={{
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "#1A2B4A" : "#6B7280",
              padding: "16px 20px",
              background: "transparent",
              borderBottom: isActive ? "2px solid #1A2B4A" : "2px solid transparent",
              marginBottom: "-1px",
              letterSpacing: "0.01em",
            }}
            onMouseEnter={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "#2C4A7C";
            }}
            onMouseLeave={(e) => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "#6B7280";
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
