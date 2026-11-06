import { useState } from "react";

export const meta = {
  label: "Componente",
  icon: "🧩",
  desc: "Componente del Sales Order; permite comparar con una Referencia Operativa de Ejemplo",
};

export default function Componente({
  resultados = [],
  loading = false,
  searched = false,
  opciones = [],
  extra = "",
  onAgregarExtra,
  onQuitarExtra,
  opcionesExternas = [],
  externo = null,
  onAgregarExterno,
  onQuitarExterno,
}) {
  const [seleccion, setSeleccion] = useState("");
  const [preguntarExterno, setPreguntarExterno] = useState(false);
  const [seleccionExterna, setSeleccionExterna] = useState("");

  const handleAgregar = () => {
    if (!seleccion) return;
    onAgregarExtra?.(seleccion);
    setSeleccion("");
  };

  const handleUsarExterno = () => {
    if (!seleccionExterna) return;
    onAgregarExterno?.(seleccionExterna);
    setPreguntarExterno(false);
    setSeleccionExterna("");
  };

  const sinReferenciasDeEjemplo = opciones.length === 0 && !extra;

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
        <select
          value={seleccion}
          onChange={(e) => setSeleccion(e.target.value)}
          disabled={loading || opciones.length === 0}
          style={{ padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", minWidth: "260px" }}
        >
          <option value="">
            {opciones.length === 0 ? "Sin Referencias Operativas de Ejemplo disponibles" : "Agregar Referencia Operativa de Ejemplo..."}
          </option>
          {opciones.map((ref) => (
            <option key={ref} value={ref}>{ref}</option>
          ))}
        </select>
        <button className="btn ghost" onClick={handleAgregar} disabled={!seleccion || loading} style={{ padding: "8px 16px", fontSize: "13px" }}>
          Agregar a comparación
        </button>
        {extra && (
          <button className="btn ghost" onClick={onQuitarExtra} disabled={loading} style={{ padding: "8px 16px", fontSize: "13px" }}>
            Quitar {extra} ✕
          </button>
        )}
      </div>

      {sinReferenciasDeEjemplo && !externo && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "10px 14px", marginBottom: "14px" }}>
          {!preguntarExterno ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: "600", color: "#92400e" }}>
                No hay Referencias Operativas de Ejemplo disponibles.
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#92400e" }}>
                  ¿Desea utilizar un Componente externo?
                </span>
                <button className="btn ghost" onClick={() => setPreguntarExterno(true)} disabled={loading} style={{ padding: "6px 14px", fontSize: "12px" }}>
                  Sí, elegir uno
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <select
                value={seleccionExterna}
                onChange={(e) => setSeleccionExterna(e.target.value)}
                disabled={loading}
                style={{ padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", minWidth: "260px" }}
              >
                <option value="">Seleccione un Componente externo...</option>
                {opcionesExternas.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <button className="btn primary" onClick={handleUsarExterno} disabled={!seleccionExterna || loading} style={{ padding: "6px 16px", fontSize: "13px" }}>
                Usar este Componente
              </button>
              <button className="btn ghost" onClick={() => setPreguntarExterno(false)} disabled={loading} style={{ padding: "6px 14px", fontSize: "12px" }}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {externo && (
        <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "8px", padding: "10px 14px", marginBottom: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
          <span style={{ fontSize: "13px", color: "#1e3a8a" }}>
            Usando Componente externo: <strong>{externo.Descripcion}</strong>
          </span>
          <button className="btn ghost" onClick={onQuitarExterno} disabled={loading} style={{ padding: "6px 14px", fontSize: "12px" }}>
            Quitar ✕
          </button>
        </div>
      )}

      {searched && !loading && resultados.length === 0 && (
        <p style={{ color: "#697386", fontSize: "14px" }}>No se encontraron componentes para esa referencia.</p>
      )}

      {resultados.length > 0 && (
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Referencia Operativa</th>
                <th>Componente ID</th>
                <th>Descripción</th>
                <th>Centro Suministrador</th>
                <th>Oficina Venta</th>
                <th>Eliminado</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, i) => (
                <tr key={r.SalesOrderDetalleId || `${r.ReferenciaOperativa}-${r.Componente_ID}-${i}`}>
                  <td style={{ fontWeight: "600", color: "#334155" }}>{r.ReferenciaOperativa}</td>
                  <td>{r.Componente_ID}</td>
                  <td>{r.Descripcion}</td>
                  <td>{r.CentroSuministrador}</td>
                  <td>{r.OficinaVenta}</td>
                  <td>{r.IsSoftDeleted ? "SI" : "NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
