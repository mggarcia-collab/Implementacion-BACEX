import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { useToast } from "../components/Toast.jsx";
import { areas } from "../areas/index.js";
import { meta as adminUsuariosMeta } from "./AdminUsuarios.jsx";

export const meta = {
  label: "Bitácora",
  icon: "📜",
  desc: "Historial completo de actividad de todos los usuarios, descargable en PDF",
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
  const [usuarioFiltro, setUsuarioFiltro] = useState("");
  const [moduloFiltro, setModuloFiltro] = useState("");
  const showToast = useToast();

  // Lista de usuarios: solo los que realmente tienen actividad registrada.
  const usuariosDisponibles = useMemo(() => {
    const nombres = new Set(actividades.map((a) => a.usuarioNombre).filter(Boolean));
    return [...nombres].sort((a, b) => a.localeCompare(b));
  }, [actividades]);

  // Lista de módulos: el catálogo completo de módulos existentes en la app
  // (no solo los que ya tienen actividad), para poder filtrar por cualquiera.
  const modulosDisponibles = useMemo(() => {
    const etiquetas = new Set([adminUsuariosMeta.label]);
    Object.values(areas).forEach((area) => {
      Object.values(area.modules).forEach((modulo) => etiquetas.add(modulo.label));
    });
    return [...etiquetas].sort((a, b) => a.localeCompare(b));
  }, []);

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

  // Todos los filtros son opcionales (ninguno obligatorio) y se combinan entre
  // sí; el PDF descargable siempre coincide con lo que queda filtrado en pantalla.
  const actividadesFiltradas = useMemo(() => {
    const desdeMs = desde ? new Date(`${desde}T00:00:00`).getTime() : -Infinity;
    const hastaMs = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : Infinity;
    return actividades.filter((a) => {
      if (usuarioFiltro && a.usuarioNombre !== usuarioFiltro) return false;
      if (moduloFiltro && a.moduloLabel !== moduloFiltro) return false;
      if (desde || hasta) {
        const ms = parsearFecha(a.fecha).getTime();
        if (ms < desdeMs || ms > hastaMs) return false;
      }
      return true;
    });
  }, [actividades, desde, hasta, usuarioFiltro, moduloFiltro]);

  const limpiarFiltro = () => {
    setDesde("");
    setHasta("");
    setUsuarioFiltro("");
    setModuloFiltro("");
  };

  const hayFiltrosActivos = desde || hasta || usuarioFiltro || moduloFiltro;

  // Se genera un PDF (no Excel) a propósito: es el formato estándar para un
  // reporte final que se entrega a otra persona — no se edita con las
  // herramientas de oficina normales, a diferencia de un .xlsx (donde incluso
  // con la hoja protegida por contraseña, esa protección se puede quitar
  // fácilmente con herramientas gratuitas). jsPDF pesa bastante, así que se
  // carga solo al pedir la descarga, no en el bundle principal.
  const handleDescargarPDF = async () => {
    if (actividadesFiltradas.length === 0) {
      showToast("No hay actividad para descargar", "warn");
      return;
    }

    const [{ default: jsPDF }, { autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Bitácora", 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(105, 115, 134);
    const rango = desde || hasta ? `Rango: ${desde || "inicio"} a ${hasta || "hoy"}` : "Rango: todo el historial";
    doc.text(`${rango}  ·  Generado: ${new Date().toLocaleString("es-HN")}`, 14, 21);

    autoTable(doc, {
      startY: 27,
      head: [["Nombre", "Referencia", "Actividad", "Motivo", "Módulo", "Fecha y hora"]],
      body: actividadesFiltradas.map((a) => [
        a.usuarioNombre,
        a.referencia || "—",
        a.accion,
        a.motivo || "—",
        a.moduloLabel || "—",
        formatoFecha.format(parsearFecha(a.fecha)),
      ]),
      headStyles: { fillColor: [189, 215, 238], textColor: [26, 31, 54], fontStyle: "bold", halign: "center" },
      styles: { fontSize: 9, cellPadding: 3 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
    });

    const sufijo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    doc.save(`bitacora${sufijo}.pdf`);
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
        <button className="btn primary" onClick={handleDescargarPDF} disabled={cargando}>
          Descargar PDF
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Usuario</label>
          <select value={usuarioFiltro} onChange={(e) => setUsuarioFiltro(e.target.value)}>
            <option value="">Todos</option>
            {usuariosDisponibles.map((nombre) => (
              <option key={nombre} value={nombre}>{nombre}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Módulo</label>
          <select value={moduloFiltro} onChange={(e) => setModuloFiltro(e.target.value)}>
            <option value="">Todos</option>
            {modulosDisponibles.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        {hayFiltrosActivos && (
          <button className="btn" onClick={limpiarFiltro} style={{ marginBottom: "1px" }}>
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="actividad-tabla-wrap">
        <table className="actividad-tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Referencia</th>
              <th>Actividad</th>
              <th>Motivo</th>
              <th>Módulo</th>
              <th>Fecha y hora</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={6} className="actividad-vacio">Cargando…</td></tr>
            ) : actividadesFiltradas.length === 0 ? (
              <tr><td colSpan={6} className="actividad-vacio">
                {actividades.length === 0 ? "Todavía no hay actividad registrada." : "No hay actividad con los filtros seleccionados."}
              </td></tr>
            ) : (
              actividadesFiltradas.map((a) => (
                <tr key={a.id}>
                  <td>{a.usuarioNombre}</td>
                  <td>{a.referencia || "—"}</td>
                  <td>{a.accion}</td>
                  <td>{a.motivo || "—"}</td>
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
