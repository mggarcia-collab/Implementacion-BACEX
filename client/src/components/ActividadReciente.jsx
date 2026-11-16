import { useEffect, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { categoriaActividad, COLORES_ACTIVIDAD } from "./bitacoraEstilos.jsx";

const formatoFecha = new Intl.DateTimeFormat("es-HN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatearFecha(sqliteDateUtc) {
  // SQLite guarda datetime('now') en UTC sin indicarlo con "Z"; hay que agregarlo
  // para que el navegador no lo interprete como hora local y muestre la fecha mal.
  const fecha = new Date(sqliteDateUtc.replace(" ", "T") + "Z");
  return formatoFecha.format(fecha);
}

export default function ActividadReciente({ limite = 10, onVerTodo }) {
  const [actividades, setActividades] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const response = await apiFetch(`/actividad?limit=${limite}`);
        const data = await response.json().catch(() => []);
        if (!cancelado && response.ok) setActividades(Array.isArray(data) ? data : []);
      } catch {
        // Sin actividad si falla: no es información crítica para bloquear la pantalla.
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [limite]);

  if (!cargando && actividades.length === 0) return null;

  return (
    <div className="actividad-reciente" style={{ position: "relative", zIndex: 1, marginTop: "28px" }}>
      <div className="actividad-reciente-header">
        <h3 className="actividad-titulo">Actividad reciente</h3>
        {onVerTodo && (
          <button type="button" className="actividad-ver-todo" onClick={onVerTodo}>
            Ver toda la bitácora →
          </button>
        )}
      </div>
      <div className="actividad-tabla-wrap">
        <table className="actividad-reciente-tabla">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Módulo</th>
              <th>Actividad</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={4} className="actividad-vacio">Cargando…</td></tr>
            ) : (
              actividades.map((a) => {
                const colores = COLORES_ACTIVIDAD[categoriaActividad(a.accion)];
                return (
                  <tr key={a.id}>
                    <td>{formatearFecha(a.fecha)}</td>
                    <td className="col-modulo">{a.moduloLabel || a.areaLabel}</td>
                    <td style={{ color: colores.color, fontWeight: 600 }}>{a.accion}</td>
                    <td>{a.usuarioNombre}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
