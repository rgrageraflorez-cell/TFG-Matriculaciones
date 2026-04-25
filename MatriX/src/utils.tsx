import Papa from "papaparse";

export const parseNumber = (value: any): number | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s.toUpperCase() === "NA" || s.toUpperCase() === "NULL") return null;
  const normalized = s.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

export const normalizeName = (value: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export const formatInt = (n: number) =>
  n.toLocaleString("es-ES", { maximumFractionDigits: 0 });

export const formatDec = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const formatMonth = (dateStr: string) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("es-ES", { year: "numeric", month: "short" });
};

export const formatISODate = (dateStr: string) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
};

export async function fetchCsv<T>(url: string, transform: (row: any) => T | null): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar ${url}`);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true }).data as any[];
  return parsed.map(transform).filter((r): r is T => r !== null);
}

export const seriesTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E5E7EB",
        borderRadius: 2,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        padding: "10px 14px",
        fontSize: 12,
        color: "#2D2D2D",
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#6B7280",
          marginBottom: 6,
        }}
      >
        {formatMonth(String(label))}
      </div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4" style={{ marginTop: 2 }}>
          <span style={{ color: p.color, fontSize: 12 }}>{p.name}</span>
          <span style={{ color: "#1A2B4A", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {formatInt(Number(p.value ?? 0))}
          </span>
        </div>
      ))}
    </div>
  );
};
