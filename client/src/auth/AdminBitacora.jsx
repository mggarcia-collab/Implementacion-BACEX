import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { useToast } from "../components/Toast.jsx";

export const meta = {
  label: "Bitácora",
  icon: "📜",
  desc: "Historial completo de actividad de todos los usuarios, descargable en Excel",
};

const formatoFecha = new Intl.DateTimeFormat("es-HN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function parsearFecha(sqliteDateUtc) {
  // SQLite guarda datetime('now') en UTC sin indicarlo con "Z"; hay que agregarlo
  // para que el navegador no lo interprete como hora local y muestre la fecha mal.
  return new Date(sqliteDateUtc.replace(" ", "T") + "Z");
}

export default function AdminBitacora() {
  const [actividades, setActividades] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const showToast = useToast();

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const response = await apiFetch("/actividad?limit=5000");
        const data = await response.json().catch(() => []);
        if (!cancelado && response.ok) setActividades(Array.isArray(data) ? data : []);
      } catch {
        // sin datos si falla
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // El filtro de fecha aplica tanto a lo que se ve en pantalla como a lo que
  // se descarga, para que el Excel siempre coincida con lo que se está viendo.
  const actividadesFiltradas = useMemo(() => {
    if (!desde && !hasta) return actividades;
    const desdeMs = desde ? new Date(`${desde}T00:00:00`).getTime() : -Infinity;
    const hastaMs = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : Infinity;
    return actividades.filter((a) => {
      const ms = parsearFecha(a.fecha).getTime();
      return ms >= desdeMs && ms <= hastaMs;
    });
  }, [actividades, desde, hasta]);

  const limpiarFiltro = () => {
    setDesde("");
    setHasta("");
  };

  const handleDescargarExcel = () => {
    if (actividadesFiltradas.length === 0) {
      showToast("No hay actividad para descargar", "warn");
      return;
    }
    const escapar = (valor) => `"${String(valor ?? "").replace(/"/g, '""')}"`;
    const encabezado = ["Nombre", "Referencia o trámite", "Qué realizó", "Módulo", "Fecha y hora"].map(escapar).join(";");
    const filas = actividadesFiltradas.map((a) =>
      [a.usuarioNombre, a.referencia || "", a.accion, a.moduloLabel || "", formatoFecha.format(parsearFecha(a.fecha))]
        .map(escapar)
        .join(";")
    );
    // "sep=;" le dice a Excel qué separador usar sin depender de la configuración
    // regional de quien lo abra; el BOM asegura que se vean bien los acentos.
    const csv = ["sep=;", encabezado, ...filas].join("\n");
    const bom = "﻿";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    const sufijo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    enlace.download = `bitacora${sufijo}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Bitácora</h2>
          <p style={{ color: "#697386", margin: "4px 0 0" }}>
            Historial completo de actividad de todos los usuarios ({actividadesFiltradas.length} registro{actividadesFiltradas.length !== 1 ? "s" : ""})
          </p>
        </div>
        <button className="btn primary" onClick={handleDescargarExcel} disabled={cargando}>
          Descargar Excel
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        {(desde || hasta) && (
          <button className="btn" onClick={limpiarFiltro} style={{ marginBottom: "1px" }}>
            Limpiar filtro
          </button>
        )}
      </div>

      <div className="actividad-tabla-wrap">
        <table className="actividad-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Referencia o trámite</th>
              <th>Qué realizó</th>
              <th>Módulo</th>
              <th>Fecha y hora</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={5} className="actividad-vacio">Cargando…</td></tr>
            ) : actividadesFiltradas.length === 0 ? (
              <tr><td colSpan={5} className="actividad-vacio">
                {actividades.length === 0 ? "Todavía no hay actividad registrada." : "No hay actividad en el rango de fechas seleccionado."}
              </td></tr>
            ) : (
              actividadesFiltradas.map((a) => (
                <tr key={a.id}>
                  <td>{a.usuarioNombre}</td>
                  <td>{a.referencia || "—"}</td>
                  <td>{a.accion}</td>
                  <td>{a.moduloLabel || "—"}</td>
                  <td>{formatoFecha.format(parsearFecha(a.fecha))}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
