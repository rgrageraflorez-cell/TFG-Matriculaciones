import React, { useRef, useState } from "react";
import type { TabId } from "./types";
import TabNav from "./TabNav";
import DescriptivaTab from "./DescriptivaTab";
import PredictivaTab from "./PredictivaTab";
import CognitivaTab from "./CognitivaTab";
import SuscripcionTab from "./SuscripcionTab";
import FichaTecnicaTab from "./FichaTecnicaTab";
import ModeloNegocioTab from "./ModeloNegocioTab";
import HomeIntro from "./components/HomeIntro";
import HeroBienvenida from "./components/HeroBienvenida";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("descriptiva");

  // Track which tabs have been visited to keep them mounted (preserve state)
  const visited = useRef(new Set<TabId>(["descriptiva"]));
  const handleTabChange = (tab: TabId) => {
    visited.current.add(tab);
    setActiveTab(tab);
  };

  // Ref al header navy para hacer scroll suave desde el hero ("Explorar dashboard")
  const headerRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  const scrollToDashboard = () => {
    headerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const handleFichaTecnicaDesdeHero = () => {
    handleTabChange("ficha-tecnica");
    // Pequeno delay para que React monte la tab antes de scroll
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  return (
    <div className="min-h-screen exec-app-bg">
      {/* ── Hero de bienvenida (data-noir, primer 100vh) ── */}
      <HeroBienvenida
        onExplorar={scrollToDashboard}
        onFichaTecnica={handleFichaTecnicaDesdeHero}
      />

      {/* ── Cabecera ejecutiva ── */}
      <header ref={headerRef} className="exec-header w-full">
        <div className="max-w-7xl mx-auto w-full px-8 flex items-center">
          <div className="flex flex-col leading-tight">
            <span className="text-white font-bold tracking-tight" style={{ fontSize: 20 }}>
              MatriX
            </span>
            <span style={{ fontSize: 12, color: "#CBD5E0", letterSpacing: "0.01em" }}>
              Sistema de Análisis de la Demanda Automovilística
            </span>
          </div>
        </div>
      </header>

      {/* ── Navegación de pestañas ── */}
      <div ref={tabsRef} className="bg-white" style={{ borderBottom: "1px solid #E5E7EB" }}>
        <div className="max-w-7xl mx-auto px-8">
          <TabNav active={activeTab} onChange={handleTabChange} />
        </div>
      </div>

      {/* ── Contenido ── */}
      <main className="max-w-7xl mx-auto px-8" style={{ paddingTop: 32, paddingBottom: 48 }}>
        <div style={{ display: activeTab === "descriptiva" ? "block" : "none" }}>
          {visited.current.has("descriptiva") && (
            <>
              <HomeIntro onNavigate={handleTabChange} />
              <DescriptivaTab />
            </>
          )}
        </div>
        <div style={{ display: activeTab === "predictiva" ? "block" : "none" }}>
          {visited.current.has("predictiva") && <PredictivaTab onNavigate={handleTabChange} />}
        </div>
        <div style={{ display: activeTab === "cognitiva" ? "block" : "none" }}>
          {visited.current.has("cognitiva") && <CognitivaTab onNavigate={handleTabChange} />}
        </div>
        <div style={{ display: activeTab === "suscripcion" ? "block" : "none" }}>
          {visited.current.has("suscripcion") && <SuscripcionTab />}
        </div>
        <div style={{ display: activeTab === "ficha-tecnica" ? "block" : "none" }}>
          {visited.current.has("ficha-tecnica") && <FichaTecnicaTab />}
        </div>
        <div style={{ display: activeTab === "modelo-negocio" ? "block" : "none" }}>
          {visited.current.has("modelo-negocio") && <ModeloNegocioTab />}
        </div>
      </main>
    </div>
  );
}
