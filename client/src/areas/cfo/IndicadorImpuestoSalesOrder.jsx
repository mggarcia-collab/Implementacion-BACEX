import { useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";
import { useAuth } from "../../auth/AuthContext.jsx";

export const meta = {
  label: "Indicador de Impuesto",
  icon: "🏷️",
  desc: "Consultar y aplicar el Indicador de Impuesto de una o más Sales Order",
  kind: "primary",
  // Capacidad extra dentro de este mismo módulo (no es una pantalla aparte): quien solo tenga
  // el permiso base del módulo puede buscar/ver, pero solo quien tenga también este sub-permiso
  // puede aplicar el cambio. Lo administra AdminUsuarios.jsx junto al resto de permisos.
  subPermiso: { key: "indicadorImpuestoModificar", label: "Modificar" },
};

function parseReferencias(texto) {
  return [...new Set((texto || "").split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean))];
}

const ETIQUETA_INDICADOR = { "1": "Aplica", "0": "No aplica" };

function BadgeIndicador({ valor, label }) {
  const estilos = valor === 1
    ? { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }
    : valor === 0
      ? { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }
      : { background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74" };
  return (
    <span style={{ ...estilos, display: "inline-block", padding: "3px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: "600" }}>
      {label}
    </span>
  );
}

export default function IndicadorImpuestoSalesOrder() {
  const autorizadorActual = useAutorizadorActual();
  const { hasPermission } = useAuth();
  const puedeModificar = hasPermission("cfo", meta.subPermiso.key);

  const [referenciasTexto, setReferenciasTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [filas, setFilas] = useState([]);
  const [noEncontradas, setNoEncontradas] = useState([]);
  const [seleccionadas, setSeleccionadas] = useState(() => new Set());
  const [nuevoIndicador, setNuevoIndicador] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const showToast = useToast();

  const handleBuscar = async () => {
    const referencias = parseReferencias(referenciasTexto);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }
    setBuscando(true);
    setResultado(null);
    try {
      const resp = await apiFetch(`/buscarIndicadorImpuestoSalesOrder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar las Sales Order", "warn");
        setFilas([]);
        setNoEncontradas([]);
        return;
      }
      const filasNuevas = Array.isArray(data?.Filas) ? data.Filas : [];
      setFilas(filasNuevas);
      setNoEncontradas(Array.isArray(data?.NoEncontradas) ? data.NoEncontradas : []);
      setSeleccionadas(new Set(filasNuevas.map((f) => f.ReferenciaOperativa)));
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscando(false);
    }
  };

  const handleLimpiar = () => {
    setReferenciasTexto("");
    setFilas([]);
    setNoEncontradas([]);
    setSeleccionadas(new Set());
    setBuscado(false);
    setNuevoIndicador("");
    setResultado(null);
  };

  const toggleSeleccion = (referencia) => {
    setSeleccionadas((prev) => {
      const next = new Set(prev);
      if (next.has(referencia)) next.delete(referencia); else next.add(referencia);
      return next;
    });
  };

  const handleAplicar = async () => {
    if (nuevoIndicador !== "0" && nuevoIndicador !== "1") {
      showToast("Seleccione el nuevo valor del Indicador de Impuesto", "warn");
      return;
    }
    if (!autorizadorActual?.id) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const referencias = [...seleccionadas];
    if (referencias.length === 0) {
      showToast("Seleccione al menos una Sales Order", "warn");
      return;
    }

    if (!window.confirm(
      `¿Confirma aplicar el Indicador de Impuesto "${ETIQUETA_INDICADOR[nuevoIndicador]}" a ${referencias.length} Sales Order?`
    )) {
      return;
    }

    setAplicando(true);
    setResultado(null);
    try {
      const resp = await apiFetch(`/aplicarIndicadorImpuestoSalesOrder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias, Indicador: Number(nuevoIndicador), ModifiedBy: autorizadorActual.id })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al aplicar el Indicador de Impuesto", "warn");
        setResultado({ ok: false, message: data?.Message || "Error al aplicar el Indicador de Impuesto" });
        return;
      }
      showToast(data?.Message || "✓ Indicador de Impuesto aplicado con éxito", "ok");
      setResultado({ ok: true, message: data?.Message });
      await handleBuscar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      {!puedeModificar && (
        <div style={{
          display: "flex", alignItems: "center", gap: "10px", background: "#eff6ff", border: "1px solid #93c5fd",
          borderRadius: "8px", padding: "10px 14px", marginBottom: "20px", fontSize: "13px", color: "#1e40af"
        }}>
          👁️ Tienes acceso de solo lectura: puedes consultar el Indicador de Impuesto, pero no modificarlo.
        </div>
      )}

      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 320px" }}>
            <label>Referencia Operativa (una o varias, separadas por coma o salto de línea)</label>
            <textarea
              placeholder={"SO-01-01\nSO-01-02"}
              value={referenciasTexto}
              onChange={(e) => setReferenciasTexto(e.target.value)}
              disabled={buscando || aplicando}
              rows={2}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
          <button className="btn primary" type="button" onClick={handleBuscar} disabled={buscando || aplicando} style={{ padding: "0 20px", height: "42px" }}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          <button className="btn ghost" type="button" onClick={handleLimpiar} disabled={buscando || aplicando} style={{ padding: "0 20px", height: "42px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {buscado && (
        <>
          {noEncontradas.length > 0 && (
            <div style={{
              background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
              padding: "12px 14px", marginBottom: "14px", fontSize: "13px", color: "#9a3412"
            }}>
              ⚠️ No se encontraron estas Referencias: {noEncontradas.join(", ")}
            </div>
          )}

          {filas.length > 0 ? (
            <>
              <div className="doc-table-wrap" style={{ maxHeight: "360px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      {puedeModificar && <th style={{ width: "36px" }}></th>}
                      <th>Referencia Operativa</th>
                      <th>Indicador de Impuesto actual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.ReferenciaOperativa}>
                        {puedeModificar && (
                          <td>
                            <input
                              type="checkbox"
                              checked={seleccionadas.has(f.ReferenciaOperativa)}
                              onChange={() => toggleSeleccion(f.ReferenciaOperativa)}
                              disabled={aplicando}
                            />
                          </td>
                        )}
                        <td>{f.ReferenciaOperativa}</td>
                        <td><BadgeIndicador valor={f.IndicadorValor} label={f.IndicadorLabel} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {puedeModificar && (
                <div style={{
                  display: "flex", alignItems: "flex-end", gap: "12px", flexWrap: "wrap",
                  marginTop: "16px", background: "#f6fbf3", padding: "16px", borderRadius: "8px", border: "1px solid #b6d7a8"
                }}>
                  <div className="field" style={{ flex: "0 0 220px" }}>
                    <label>Nuevo valor del Indicador de Impuesto</label>
                    <select
                      value={nuevoIndicador}
                      onChange={(e) => setNuevoIndicador(e.target.value)}
                      disabled={aplicando}
                      style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                    >
                      <option value="">Seleccione...</option>
                      <option value="1">Aplica</option>
                      <option value="0">No aplica</option>
                    </select>
                  </div>
                  <button className="btn primary" type="button" onClick={handleAplicar} disabled={aplicando} style={{ padding: "0 18px", height: "42px" }}>
                    {aplicando ? "Aplicando..." : `Aplicar a ${seleccionadas.size} seleccionada${seleccionadas.size !== 1 ? "s" : ""}`}
                  </button>
                  <div style={{ fontSize: "12px", color: "#4b5563" }}>
                    Autorizado por: <strong>{autorizadorActual?.name || "—"}</strong>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: "13px", color: "#697386" }}>No se encontró ninguna Sales Order con esas Referencias.</p>
          )}
        </>
      )}

      {resultado && (
        <div style={{
          marginTop: "16px", padding: "12px 14px", borderRadius: "8px", fontSize: "13px",
          background: resultado.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${resultado.ok ? "#86efac" : "#fca5a5"}`,
          color: resultado.ok ? "#166534" : "#991b1b"
        }}>
          {resultado.ok ? "✓ " : "⚠️ "}{resultado.message}
        </div>
      )}
    </div>
  );
}
