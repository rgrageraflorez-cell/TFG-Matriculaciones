import type { TabId } from "../types";

/**
 * Helper de navegacion deep-link interno: cambia la tab activa y, una vez
 * el componente destino esta montado, hace scroll al anchor indicado.
 *
 * El doble requestAnimationFrame es un workaround para esperar a que
 * React monte la tab destino (lazy mount con visited.current en App.tsx)
 * antes de buscar el elemento. Sin un router real es lo mas limpio.
 */
export function navigateToSection(
  setActiveTab: (t: TabId) => void,
  tabId: TabId,
  anchorId: string,
): void {
  setActiveTab(tabId);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}
