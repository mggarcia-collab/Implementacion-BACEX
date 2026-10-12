import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../apiClient.js";

const formatoFecha = new Intl.DateTimeFormat("es-HN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatearFecha(sqliteDateUtc) {
  const fecha = new Date(sqliteDateUtc.replace(" ", "T") + "Z");
  return formatoFecha.format(fecha);
}

// Campanita en el topbar: se carga en segundo plano apenas entra a la app (para que el
// número ya aparezca aunque no haya abierto el desplegable) y vuelve a consultar cada vez
// que se abre, por si cambió algo desde el último vistazo. Tiene dos pestañas: "Pendientes"
// (lo que ve de entrada) e "Historial" (las que ya marcó leídas, cargadas solo al cambiar
// a esa pestaña para no pedirlas de más).
export default function AlertasCampana() {
  const [alertas, setAlertas] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [tab, setTab] = useState("pendientes");
  const [abierto, setAbierto] = useState(false);
  const [marcando, setMarcando] = useState(null);
  const ref = useRef(null);

  const cargarPendientes = async () => {
    try {
      const response = await apiFetch(`/alertas`);
      const data = await response.json().catch(() => []);
      if (response.ok) setAlertas(Array.isArray(data) ? data : []);
    } catch {
      // Sin alertas si falla: no es información crítica para bloquear la pantalla.
    }
  };

  const cargarHistorial = async () => {
    setCargandoHistorial(true);
    try {
      const response = await apiFetch(`/alertas/historial`);
      const data = await response.json().catch(() => []);
      if (response.ok) setHistorial(Array.isArray(data) ? data : []);
    } catch {
      // Igual, no bloquea la pantalla.
    } finally {
      setCargandoHistorial(false);
    }
  };

  useEffect(() => {
    cargarPendientes();
  }, []);

  useEffect(() => {
    if (!abierto) return;
    cargarPendientes();
    if (tab === "historial") cargarHistorial();
    const handleClickFuera = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const handleCambiarTab = (nuevaTab) => {
    setTab(nuevaTab);
    if (nuevaTab === "historial") cargarHistorial();
  };

  const handleMarcarLeida = async (id) => {
    setMarcando(id);
    try {
      const response = await apiFetch(`/alertas/${id}/leer`, { method: "POST" });
      if (response.ok) setAlertas((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setMarcando(null);
    }
  };

  const listaActual = tab === "pendientes" ? alertas : historial;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setAbierto((prev) => !prev)}
        title="Alertas"
        style={{
          position: "relative", background: "transparent", border: "none", cursor: "pointer",
          fontSize: "20px", padding: "8px", lineHeight: 1, borderRadius: "8px"
        }}
      >
        🔔
        {alertas.length > 0 && (
          <span style={{
            position: "absolute", top: "2px", right: "2px", background: "#dc2626", color: "#fff",
            borderRadius: "999px", fontSize: "10px", fontWeight: "700", minWidth: "16px", height: "16px",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px"
          }}>
            {alertas.length}
          </span>
        )}
      </button>

      {abierto && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: "380px", maxHeight: "460px",
          overflowY: "auto", background: "#fff", border: "1px solid #e3e8ee", borderRadius: "10px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)", zIndex: 50, padding: "10px"
        }}>
          <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid #eef1f5", marginBottom: "10px", paddingBottom: "4px" }}>
            <button
              type="button"
              onClick={() => handleCambiarTab("pendientes")}
              style={{
                flex: 1, padding: "6px 8px", fontSize: "12.5px", fontWeight: "700", border: "none",
                borderRadius: "6px", cursor: "pointer",
                background: tab === "pendientes" ? "#eef2ff" : "transparent",
                color: tab === "pendientes" ? "#3730a3" : "#697386"
              }}
            >
              Pendientes{alertas.length > 0 ? ` (${alertas.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => handleCambiarTab("historial")}
              style={{
                flex: 1, padding: "6px 8px", fontSize: "12.5px", fontWeight: "700", border: "none",
                borderRadius: "6px", cursor: "pointer",
                background: tab === "historial" ? "#eef2ff" : "transparent",
                color: tab === "historial" ? "#3730a3" : "#697386"
              }}
            >
              Historial
            </button>
          </div>

          {tab === "historial" && cargandoHistorial ? (
            <div style={{ fontSize: "13px", color: "#697386", padding: "10px 6px" }}>Cargando…</div>
          ) : listaActual.length === 0 ? (
            <div style={{ fontSize: "13px", color: "#697386", padding: "10px 6px" }}>
              {tab === "pendientes" ? "No tienes alertas pendientes." : "Todavía no has marcado ninguna alerta como leída."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {listaActual.map((a) => (
                <div key={a.id} style={{
                  border: tab === "pendientes" ? "1px solid #fde68a" : "1px solid #e3e8ee",
                  background: tab === "pendientes" ? "#fffbeb" : "#f8f9fa",
                  borderRadius: "8px", padding: "10px"
                }}>
                  <div style={{ fontSize: "12.5px", fontWeight: "700", color: tab === "pendientes" ? "#92400e" : "#1a1f36" }}>{a.titulo}</div>
                  <div style={{ fontSize: "12.5px", color: tab === "pendientes" ? "#78350f" : "#475569", marginTop: "3px" }}>{a.mensaje}</div>
                  <div style={{ fontSize: "11px", color: tab === "pendientes" ? "#a16207" : "#8a94a6", marginTop: "4px" }}>
                    {tab === "pendientes" ? formatearFecha(a.fecha) : `Leída el ${formatearFecha(a.leidaFecha)}`}
                  </div>
                  {tab === "pendientes" && (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => handleMarcarLeida(a.id)}
                      disabled={marcando === a.id}
                      style={{ padding: "3px 10px", fontSize: "11.5px", marginTop: "6px" }}
                    >
                      {marcando === a.id ? "..." : "Marcar como leída"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
