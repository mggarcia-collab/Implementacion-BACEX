// Categoría de alto nivel de la actividad, para el color de la columna "Actividad"
// -- se deriva del verbo con el que ya arranca cada "accion" en vez de mantener un
// catálogo aparte que se desactualizaría cada vez que se agregue un endpoint nuevo.
export function categoriaActividad(accion) {
  const texto = (accion || "").toLowerCase();
  if (texto === "inició sesión") return "Inicio de sesión";
  if (texto.startsWith("eliminó") || texto.startsWith("anuló")) return "Eliminación";
  if (texto.startsWith("creó") || texto.startsWith("agregó")) return "Creación";
  return "Modificación";
}

export const ACTIVIDADES_DISPONIBLES = ["Modificación", "Creación", "Eliminación", "Inicio de sesión"];

export const COLORES_ACTIVIDAD = {
  "Modificación": { bg: "#e7f6ec", color: "#1a7f3c" },
  "Creación": { bg: "#e8f0fb", color: "#1d4ed8" },
  "Eliminación": { bg: "#fdeaea", color: "#c0392b" },
  "Inicio de sesión": { bg: "#eef0f2", color: "#51606e" },
};

// Colores del badge de "Área" -- un color fijo por área conocida y uno neutro de
// respaldo para cualquier área nueva que se agregue más adelante (no se rompe ni
// hay que acordarse de tocar esta lista).
export const COLORES_AREA = {
  "CFO": { bg: "#eaf2f8", color: "#1f3651" },
  "Análisis de Red": { bg: "#e7f6ec", color: "#1a7f3c" },
  "Panel Errores 25+": { bg: "#fdeaea", color: "#c0392b" },
  "Administración": { bg: "#fdf3e3", color: "#9a6a1c" },
  "Autenticación": { bg: "#eef0f2", color: "#51606e" },
};
export const COLOR_AREA_DEFAULT = { bg: "#eef0f2", color: "#51606e" };

export function Pill({ texto, colores }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: "11px",
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "999px",
        background: colores.bg,
        color: colores.color,
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}
