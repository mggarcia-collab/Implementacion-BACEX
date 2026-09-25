import { useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Crear Documentos (Post Facturación)",
  icon: "🧾",
  desc: "Crear Documentos Provisionales, Fiscales e Internos para una Referencia Operativa ya facturada",
  kind: "primary",
};

// Por ahora el módulo solo maneja Honduras y Guatemala (única División confirmada: "9095").
// El resto de países se agrega cuando el negocio confirme su propia División.
const PAISES = {
  honduras: { label: "Honduras" },
  guatemala: { label: "Guatemala" },
};

const MONEDAS = [
  { value: 340, label: "Lempiras (HNL)" },
  { value: 840, label: "Dólares (USD)" },
  { value: 558, label: "Córdobas (NIO)" },
  { value: 188, label: "Colones (CRC)" },
  { value: 320, label: "Quetzales (GTQ)" },
];

const DUENOS = [
  { value: 1, label: "Vesta" },
  { value: 2, label: "Cliente" },
];

// La respuesta de Azure normalmente trae el documento creado dentro de "Message" (a veces un
// objeto, a veces un arreglo con un elemento). Mismo helper que usa Documento Provisional NIC.
function extraerDocumento(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.Message)) return data.Message[0] || null;
  if (data.Message && typeof data.Message === "object") return data.Message;
  return data;
}

function obtenerValor(objeto, ruta) {
  return ruta.split(".").reduce((actual, parte) => (actual && typeof actual === "object" ? actual[parte] : undefined), objeto);
}
function buscarPrimerValor(objeto, rutas) {
  for (const ruta of rutas) {
    const valor = obtenerValor(objeto, ruta);
    if (valor !== undefined && valor !== null) return valor;
  }
  return null;
}
function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === "") return <span style={{ color: "#a3acb9" }}>—</span>;
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

const CAMPOS_RESUMEN = [
  { label: "Id", rutas: ["Id"] },
  { label: "Referencia Operativa", rutas: ["ReferenciaOperativa"] },
  { label: "Total Monto", rutas: ["TotalMonto"] },
  { label: "Moneda", rutas: ["Moneda.Value", "MonedaValue"] },
  { label: "Observación", rutas: ["Observacion", "Observación"] },
  { label: "Cliente", rutas: ["Cliente.Nombre", "ClienteNombre"] },
  { label: "Proveedor", rutas: ["Proveedor.Nombre", "ProveedorNombre"] },
  { label: "País", rutas: ["Pais.Descripcion", "PaisDescripcion"] },
  { label: "Dueño Documento", rutas: ["DueñoDocumento.DisplayName", "DueñoDocumentoDisplayName"] },
  { label: "División", rutas: ["Division"] },
];

function TabProvisionales({ onNavigate }) {
  const [referencia, setReferencia] = useState("");
  const [paisKey, setPaisKey] = useState("");
  const [buscandoReferencia, setBuscandoReferencia] = useState(false);
  const [clienteInfo, setClienteInfo] = useState(null);
  const [clienteError, setClienteError] = useState(null);

  const [moneda, setMoneda] = useState("");
  const [duenoDocumento, setDuenoDocumento] = useState("");

  const [proveedorNombreBusqueda, setProveedorNombreBusqueda] = useState("");
  const [buscandoProveedores, setBuscandoProveedores] = useState(false);
  const [proveedorResultados, setProveedorResultados] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
  const [buscandoProveedorCfo, setBuscandoProveedorCfo] = useState(false);
  const [proveedorCfoInfo, setProveedorCfoInfo] = useState(null);
  const [proveedorError, setProveedorError] = useState(null);

  const [materialSeleccionadoId, setMaterialSeleccionadoId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [observacionManual, setObservacionManual] = useState(false);
  const [cantidad, setCantidad] = useState("1");
  const [precioVenta, setPrecioVenta] = useState("");
  const [impuesto, setImpuesto] = useState("");

  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [eliminado, setEliminado] = useState(false);

  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const resetDesdeReferencia = () => {
    setClienteInfo(null);
    setClienteError(null);
    setProveedorNombreBusqueda("");
    setProveedorResultados([]);
    setProveedorSeleccionado(null);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setObservacion("");
    setObservacionManual(false);
    setCantidad("1");
    setPrecioVenta("");
    setImpuesto("");
    setResultado(null);
    setEliminando(false);
    setEliminado(false);
  };

  const handleBuscarReferencia = async () => {
    const referenciaTrim = referencia.trim();
    if (!referenciaTrim) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    if (!paisKey) {
      showToast("Seleccione un País", "warn");
      return;
    }
    setBuscandoReferencia(true);
    resetDesdeReferencia();
    try {
      const resp = await apiFetch(`/docProvisionalClientePorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setClienteError(data);
        showToast(data?.Message || "No se pudo resolver el Cliente", "warn");
        return;
      }
      setClienteInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoReferencia(false);
    }
  };

  const handleLimpiar = () => {
    setReferencia("");
    setPaisKey("");
    setMoneda("");
    setDuenoDocumento("");
    resetDesdeReferencia();
  };

  const handleBuscarProveedores = async () => {
    const nombreTrim = proveedorNombreBusqueda.trim();
    if (!nombreTrim) {
      showToast("Ingrese un nombre para buscar el Proveedor", "warn");
      return;
    }
    setBuscandoProveedores(true);
    setProveedorResultados([]);
    try {
      const resp = await apiFetch(`/docProvisionalBuscarProveedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Proveedores", "warn");
        return;
      }
      const lista = Array.isArray(data) ? data : [];
      setProveedorResultados(lista);
      if (lista.length === 0) showToast("No se encontraron Proveedores con ese nombre", "warn");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedores(false);
    }
  };

  const handleSeleccionarProveedor = async (p) => {
    setProveedorSeleccionado(p);
    setProveedorResultados([]);
    setProveedorNombreBusqueda(p.Nombre);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setObservacion("");
    setObservacionManual(false);
    setBuscandoProveedorCfo(true);
    try {
      const resp = await apiFetch(`/docProvisionalProveedorEnCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedorPersonaId: p.PersonaId, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setProveedorError(data);
        showToast(data?.Message || "No se pudo resolver el Proveedor en CFO", "warn");
        return;
      }
      setProveedorCfoInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedorCfo(false);
    }
  };

  const handleMaterialChange = (id) => {
    setMaterialSeleccionadoId(id);
    if (!observacionManual) {
      const mat = proveedorCfoInfo?.Materiales.find((m) => m.Id === id);
      setObservacion(mat?.Descripcion || "");
    }
  };

  const total = (() => {
    if (precioVenta.trim() === "" || impuesto.trim() === "") return null;
    const p = Number(precioVenta);
    const i = Number(impuesto);
    if (!Number.isFinite(p) || !Number.isFinite(i)) return null;
    return Math.round((p + i) * 100) / 100;
  })();

  const handleCrear = async () => {
    const referenciaTrim = referencia.trim();
    const observacionTrim = observacion.trim();
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!referenciaTrim || !paisKey || !clienteInfo?.ClienteId) {
      showToast("Busque primero la Referencia Operativa", "warn");
      return;
    }
    if (!moneda) {
      showToast("Seleccione la Moneda", "warn");
      return;
    }
    if (!duenoDocumento) {
      showToast("Seleccione el Dueño del Documento", "warn");
      return;
    }
    if (!proveedorSeleccionado || !proveedorCfoInfo?.ProveedorId) {
      showToast("Seleccione un Proveedor válido (creado en CFO)", "warn");
      return;
    }
    if (!materialSeleccionadoId) {
      showToast("Seleccione un Material", "warn");
      return;
    }
    if (!observacionTrim) {
      showToast("La Observación es requerida", "warn");
      return;
    }
    const cantidadNum = Number(cantidad);
    if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
      showToast("La Cantidad debe ser un número entero entre 1 y 10", "warn");
      return;
    }
    const precioVentaNum = Number(precioVenta);
    const impuestoNum = Number(impuesto);
    if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) {
      showToast("Ingrese un Precio de Venta válido", "warn");
      return;
    }
    if (!Number.isFinite(impuestoNum) || impuestoNum < 0) {
      showToast("Ingrese un Impuesto válido", "warn");
      return;
    }

    const material = proveedorCfoInfo.Materiales.find((m) => m.Id === materialSeleccionadoId);
    const monedaLabel = MONEDAS.find((m) => m.value === Number(moneda))?.label || moneda;

    if (!window.confirm(
      `¿Confirma crear el Documento Provisional?\n\n` +
      `Referencia: ${referenciaTrim}\nPaís: ${PAISES[paisKey]?.label}\nCliente: ${clienteInfo.ClienteDescripcion}\n` +
      `Proveedor: ${proveedorSeleccionado.Nombre}\nMaterial: ${material?.Descripcion || "—"}\n` +
      `Cantidad: ${cantidadNum}   Precio Venta: ${precioVentaNum}   Impuesto: ${impuestoNum}   Total: ${total}\n` +
      `Moneda: ${monedaLabel}\nObservación: ${observacionTrim}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearDocumentoProvisionalPostFacturacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referenciaTrim,
          PaisKey: paisKey,
          Moneda: Number(moneda),
          Observacion: observacionTrim,
          DuenoDocumento: Number(duenoDocumento),
          ProveedorPersonaId: proveedorSeleccionado.PersonaId,
          MaterialProveedorId: materialSeleccionadoId,
          Cantidad: cantidadNum,
          PrecioVenta: precioVentaNum,
          Impuesto: impuestoNum,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Documento Provisional", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento Provisional creado con éxito", "ok");
      setResultado(extraerDocumento(data?.Data));
      setEliminado(false);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  // Permite deshacer una creación equivocada sin salir del módulo ni ir a Eliminar Documento —
  // usa el Id del documento que se acaba de crear (ya lo tenemos en "resultado").
  const handleEliminarCreado = async () => {
    const documentoId = buscarPrimerValor(resultado, ["Id"]);
    if (!documentoId) {
      showToast("No se pudo determinar el Id del documento creado.", "warn");
      return;
    }
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const motivo = window.prompt("Motivo de la eliminación (obligatorio):", "Documento creado por error");
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar el documento", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar el Documento recién creado?\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }
    setEliminando(true);
    try {
      const resp = await apiFetch(`/docProvisionalEliminarCreado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar el documento", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento eliminado con éxito", "ok");
      setEliminado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label>Referencia Operativa</label>
            <input
              type="text"
              placeholder="Ej: CE-CE-H25-6206"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label>País</label>
            <select
              value={paisKey}
              onChange={(e) => setPaisKey(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {Object.entries(PAISES).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "12px" }}>
          Por ahora este módulo solo maneja Honduras y Guatemala; el resto de países se habilitará cuando se confirme su División.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn primary" onClick={handleBuscarReferencia} disabled={buscandoReferencia} style={{ padding: "0 16px" }}>
            {buscandoReferencia ? "Buscando..." : "Buscar"}
          </button>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscandoReferencia || creando} style={{ padding: "0 16px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {clienteError?.NoExisteClienteCfo && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ {clienteError.Message}
          </span>
          <button
            type="button"
            className="btn danger"
            onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
            style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
          >
            Ir a Crear Proveedor/Cliente
          </button>
        </div>
      )}
      {clienteError && !clienteError.NoExisteClienteCfo && (
        <div style={{
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px", color: "#9a3412", fontSize: "13px"
        }}>
          ⚠️ {clienteError.Message}
        </div>
      )}

      {clienteInfo && (
        <>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#166534", fontSize: "13px" }}>
            ✓ Cliente resuelto: <strong>{clienteInfo.ClienteDescripcion}</strong>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Datos del Documento
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Moneda</label>
                <select
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                >
                  <option value="">Seleccione...</option>
                  {MONEDAS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Dueño del Documento</label>
                <select
                  value={duenoDocumento}
                  onChange={(e) => setDuenoDocumento(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                >
                  <option value="">Seleccione...</option>
                  {DUENOS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Proveedor
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input
                type="text"
                placeholder="Buscar Proveedor por nombre..."
                value={proveedorNombreBusqueda}
                onChange={(e) => setProveedorNombreBusqueda(e.target.value)}
                disabled={buscandoProveedores}
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              <button type="button" className="btn soft" onClick={handleBuscarProveedores} disabled={buscandoProveedores} style={{ padding: "0 16px" }}>
                {buscandoProveedores ? "Buscando..." : "Buscar"}
              </button>
            </div>

            {proveedorResultados.length > 0 && (
              <div className="doc-table-wrap" style={{ marginBottom: "10px", maxHeight: "220px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>ID Fiscal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedorResultados.map((p) => (
                      <tr key={p.PersonaId}>
                        <td>{p.Nombre}</td>
                        <td>{p.IdFiscal}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn soft" type="button" onClick={() => handleSeleccionarProveedor(p)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                            Seleccionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {buscandoProveedorCfo && <p style={{ fontSize: "13px", color: "#697386" }}>Verificando Proveedor en CFO...</p>}

            {proveedorError?.NoExisteProveedorCfo && (
              <div style={{
                display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
                background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
                padding: "14px 16px", marginBottom: "10px"
              }}>
                <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
                  ⚠️ {proveedorError.Message}
                </span>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
                  style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
                >
                  Ir a Crear Proveedor/Cliente
                </button>
              </div>
            )}

            {proveedorCfoInfo && proveedorSeleccionado && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", color: "#166534", fontSize: "13px" }}>
                ✓ Proveedor resuelto: <strong>{proveedorSeleccionado.Nombre}</strong> — {proveedorCfoInfo.Materiales.length} material(es) disponible(s)
              </div>
            )}
          </div>
        </>
      )}

      {proveedorCfoInfo && (
        <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
            Detalle
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Material</label>
            <select
              value={materialSeleccionadoId}
              onChange={(e) => handleMaterialChange(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {proveedorCfoInfo.Materiales.map((m) => (
                <option key={m.Id} value={m.Id}>{m.Descripcion}{m.CodigoMaterial ? ` (${m.CodigoMaterial})` : ""}</option>
              ))}
            </select>
            {proveedorCfoInfo.Materiales.length === 0 && (
              <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                Este Proveedor no tiene Materiales agregados en CFO.
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Observación (debe ser el nombre del material)</label>
            <input
              type="text"
              value={observacion}
              onChange={(e) => { setObservacion(e.target.value); setObservacionManual(true); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>Cantidad (máx. 10)</label>
              <input
                type="number" min="1" max="10" step="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Precio de Venta</label>
              <input
                type="number" step="any"
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Impuesto</label>
              <input
                type="number" step="any"
                value={impuesto}
                onChange={(e) => setImpuesto(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Total (Precio + Impuesto)</label>
              <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9" }}>
                {total ?? "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {clienteInfo && (
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Autorizado por
          </label>
          <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
            {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
          </div>
        </div>
      )}

      {proveedorCfoInfo && (
        <button className="btn primary" type="button" onClick={handleCrear} disabled={creando} style={{ marginBottom: "20px" }}>
          {creando ? "Creando..." : "Crear Documento Provisional"}
        </button>
      )}

      {resultado && (
        <div style={{ border: eliminado ? "1px solid #fecaca" : "1px solid #d1fae5", background: eliminado ? "#fef2f2" : "#f0fdf9", borderRadius: "8px", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: eliminado ? "#991b1b" : "#065f46" }}>
              {eliminado ? "✗ Documento eliminado" : "✓ Documento Provisional creado"}
            </div>
            {!eliminado && (
              <button
                type="button"
                className="btn danger"
                onClick={handleEliminarCreado}
                disabled={eliminando}
                style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
              >
                {eliminando ? "Eliminando..." : "🗑️ Eliminar este Documento"}
              </button>
            )}
          </div>
          {eliminado && (
            <div style={{ fontSize: "13px", color: "#991b1b", marginBottom: "10px" }}>
              Si se creó por error, ya quedó eliminado — puede volver a crearlo con los datos correctos.
            </div>
          )}
          <div className="doc-table-wrap">
            <table className="doc-table" style={{ width: "100%" }}>
              <tbody>
                {CAMPOS_RESUMEN.map(({ label, rutas }) => (
                  <tr key={label}>
                    <td style={{ fontWeight: "600", color: "#334155", width: "220px" }}>{label}</td>
                    <td>{formatearValor(buscarPrimerValor(resultado, rutas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const CAMPOS_RESUMEN_FISCAL = [
  { label: "Id", rutas: ["Id"] },
  { label: "Referencia Operativa", rutas: ["ReferenciaOperativa"] },
  { label: "Número de Documento Fiscal", rutas: ["NumeroDocumentoFiscal"] },
  { label: "CAI", rutas: ["CAI"] },
  { label: "Fecha de Emisión", rutas: ["FechaEmision"] },
  { label: "Fecha de Vencimiento", rutas: ["FechaVencimiento"] },
  { label: "Total Monto", rutas: ["TotalMonto"] },
  { label: "Moneda", rutas: ["Moneda.Value", "MonedaValue"] },
  { label: "Observación", rutas: ["Observacion", "Observación"] },
  { label: "Cliente", rutas: ["Cliente.Nombre", "ClienteNombre"] },
  { label: "Proveedor", rutas: ["Proveedor.Nombre", "ProveedorNombre"] },
  { label: "País", rutas: ["Pais.Descripcion", "PaisDescripcion"] },
  { label: "Dueño Documento", rutas: ["DueñoDocumento.DisplayName", "DueñoDocumentoDisplayName"] },
  { label: "División", rutas: ["Division"] },
];

function TabFiscales({ onNavigate }) {
  const [referencia, setReferencia] = useState("");
  const [paisKey, setPaisKey] = useState("");
  const [buscandoReferencia, setBuscandoReferencia] = useState(false);
  const [clienteInfo, setClienteInfo] = useState(null);
  const [clienteError, setClienteError] = useState(null);

  const [moneda, setMoneda] = useState("");
  const [duenoDocumento, setDuenoDocumento] = useState("");

  const [proveedorNombreBusqueda, setProveedorNombreBusqueda] = useState("");
  const [buscandoProveedores, setBuscandoProveedores] = useState(false);
  const [proveedorResultados, setProveedorResultados] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
  const [buscandoProveedorCfo, setBuscandoProveedorCfo] = useState(false);
  const [proveedorCfoInfo, setProveedorCfoInfo] = useState(null);
  const [proveedorError, setProveedorError] = useState(null);

  const [materialSeleccionadoId, setMaterialSeleccionadoId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [observacionManual, setObservacionManual] = useState(false);
  const [cantidad, setCantidad] = useState("1");
  const [precioVenta, setPrecioVenta] = useState("");
  const [impuesto, setImpuesto] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [cai, setCai] = useState("");
  const [numeroDocumentoFiscal, setNumeroDocumentoFiscal] = useState("");

  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [eliminado, setEliminado] = useState(false);

  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const resetDesdeReferencia = () => {
    setClienteInfo(null);
    setClienteError(null);
    setProveedorNombreBusqueda("");
    setProveedorResultados([]);
    setProveedorSeleccionado(null);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setObservacion("");
    setObservacionManual(false);
    setCantidad("1");
    setPrecioVenta("");
    setImpuesto("");
    setFechaEmision("");
    setFechaVencimiento("");
    setCai("");
    setNumeroDocumentoFiscal("");
    setResultado(null);
    setEliminando(false);
    setEliminado(false);
  };

  const handleBuscarReferencia = async () => {
    const referenciaTrim = referencia.trim();
    if (!referenciaTrim) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    if (!paisKey) {
      showToast("Seleccione un País", "warn");
      return;
    }
    setBuscandoReferencia(true);
    resetDesdeReferencia();
    try {
      const resp = await apiFetch(`/docProvisionalClientePorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setClienteError(data);
        showToast(data?.Message || "No se pudo resolver el Cliente", "warn");
        return;
      }
      setClienteInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoReferencia(false);
    }
  };

  const handleLimpiar = () => {
    setReferencia("");
    setPaisKey("");
    setMoneda("");
    setDuenoDocumento("");
    resetDesdeReferencia();
  };

  const handleBuscarProveedores = async () => {
    const nombreTrim = proveedorNombreBusqueda.trim();
    if (!nombreTrim) {
      showToast("Ingrese un nombre para buscar el Proveedor", "warn");
      return;
    }
    setBuscandoProveedores(true);
    setProveedorResultados([]);
    try {
      const resp = await apiFetch(`/docProvisionalBuscarProveedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Proveedores", "warn");
        return;
      }
      const lista = Array.isArray(data) ? data : [];
      setProveedorResultados(lista);
      if (lista.length === 0) showToast("No se encontraron Proveedores con ese nombre", "warn");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedores(false);
    }
  };

  const handleSeleccionarProveedor = async (p) => {
    setProveedorSeleccionado(p);
    setProveedorResultados([]);
    setProveedorNombreBusqueda(p.Nombre);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setObservacion("");
    setObservacionManual(false);
    setBuscandoProveedorCfo(true);
    try {
      const resp = await apiFetch(`/docProvisionalProveedorEnCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedorPersonaId: p.PersonaId, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setProveedorError(data);
        showToast(data?.Message || "No se pudo resolver el Proveedor en CFO", "warn");
        return;
      }
      setProveedorCfoInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedorCfo(false);
    }
  };

  const handleMaterialChange = (id) => {
    setMaterialSeleccionadoId(id);
    if (!observacionManual) {
      const mat = proveedorCfoInfo?.Materiales.find((m) => m.Id === id);
      setObservacion(mat?.Descripcion || "");
    }
  };

  const total = (() => {
    if (precioVenta.trim() === "" || impuesto.trim() === "") return null;
    const p = Number(precioVenta);
    const i = Number(impuesto);
    if (!Number.isFinite(p) || !Number.isFinite(i)) return null;
    return Math.round((p + i) * 100) / 100;
  })();

  const handleCrear = async () => {
    const referenciaTrim = referencia.trim();
    const observacionTrim = observacion.trim();
    const numeroDocumentoFiscalTrim = numeroDocumentoFiscal.trim();
    const caiTrim = cai.trim();
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!referenciaTrim || !paisKey || !clienteInfo?.ClienteId) {
      showToast("Busque primero la Referencia Operativa", "warn");
      return;
    }
    if (!moneda) {
      showToast("Seleccione la Moneda", "warn");
      return;
    }
    if (!duenoDocumento) {
      showToast("Seleccione el Dueño del Documento", "warn");
      return;
    }
    if (!proveedorSeleccionado || !proveedorCfoInfo?.ProveedorId) {
      showToast("Seleccione un Proveedor válido (creado en CFO)", "warn");
      return;
    }
    if (!materialSeleccionadoId) {
      showToast("Seleccione un Material", "warn");
      return;
    }
    if (!observacionTrim) {
      showToast("La Observación es requerida", "warn");
      return;
    }
    const cantidadNum = Number(cantidad);
    if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
      showToast("La Cantidad debe ser un número entero entre 1 y 10", "warn");
      return;
    }
    const precioVentaNum = Number(precioVenta);
    const impuestoNum = Number(impuesto);
    if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) {
      showToast("Ingrese un Precio de Venta válido", "warn");
      return;
    }
    if (!Number.isFinite(impuestoNum) || impuestoNum < 0) {
      showToast("Ingrese un Impuesto válido", "warn");
      return;
    }
    if (!fechaEmision) {
      showToast("Seleccione la Fecha de Emisión", "warn");
      return;
    }
    if (!fechaVencimiento) {
      showToast("Seleccione la Fecha de Vencimiento", "warn");
      return;
    }
    if (!numeroDocumentoFiscalTrim) {
      showToast("Ingrese el Número de Documento Fiscal", "warn");
      return;
    }

    const material = proveedorCfoInfo.Materiales.find((m) => m.Id === materialSeleccionadoId);
    const monedaLabel = MONEDAS.find((m) => m.value === Number(moneda))?.label || moneda;

    if (!window.confirm(
      `¿Confirma crear el Documento Fiscal?\n\n` +
      `Referencia: ${referenciaTrim}\nPaís: ${PAISES[paisKey]?.label}\nCliente: ${clienteInfo.ClienteDescripcion}\n` +
      `Proveedor: ${proveedorSeleccionado.Nombre}\nMaterial: ${material?.Descripcion || "—"}\n` +
      `Cantidad: ${cantidadNum}   Precio Venta: ${precioVentaNum}   Impuesto: ${impuestoNum}   Total: ${total}\n` +
      `Moneda: ${monedaLabel}\nObservación: ${observacionTrim}\n` +
      `Número de Documento Fiscal: ${numeroDocumentoFiscalTrim}   CAI: ${caiTrim || "—"}\n` +
      `Fecha Emisión: ${fechaEmision}   Fecha Vencimiento: ${fechaVencimiento}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearDocumentoFiscalPostFacturacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referenciaTrim,
          PaisKey: paisKey,
          Moneda: Number(moneda),
          Observacion: observacionTrim,
          DuenoDocumento: Number(duenoDocumento),
          ProveedorPersonaId: proveedorSeleccionado.PersonaId,
          MaterialProveedorId: materialSeleccionadoId,
          Cantidad: cantidadNum,
          PrecioVenta: precioVentaNum,
          Impuesto: impuestoNum,
          FechaEmision: fechaEmision,
          FechaVencimiento: fechaVencimiento,
          CAI: caiTrim,
          NumeroDocumentoFiscal: numeroDocumentoFiscalTrim,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Documento Fiscal", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento Fiscal creado con éxito", "ok");
      setResultado(extraerDocumento(data?.Data));
      setEliminado(false);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  // Permite deshacer una creación equivocada sin salir del módulo ni ir a Eliminar Documento —
  // usa el Id del documento que se acaba de crear (ya lo tenemos en "resultado").
  const handleEliminarCreado = async () => {
    const documentoId = buscarPrimerValor(resultado, ["Id"]);
    if (!documentoId) {
      showToast("No se pudo determinar el Id del documento creado.", "warn");
      return;
    }
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const motivo = window.prompt("Motivo de la eliminación (obligatorio):", "Documento creado por error");
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar el documento", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar el Documento recién creado?\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }
    setEliminando(true);
    try {
      const resp = await apiFetch(`/docProvisionalEliminarCreado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar el documento", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento eliminado con éxito", "ok");
      setEliminado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label>Referencia Operativa</label>
            <input
              type="text"
              placeholder="Ej: CE-CE-H25-6206"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label>País</label>
            <select
              value={paisKey}
              onChange={(e) => setPaisKey(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {Object.entries(PAISES).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "12px" }}>
          Por ahora este módulo solo maneja Honduras y Guatemala; el resto de países se habilitará cuando se confirme su División.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn primary" onClick={handleBuscarReferencia} disabled={buscandoReferencia} style={{ padding: "0 16px" }}>
            {buscandoReferencia ? "Buscando..." : "Buscar"}
          </button>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscandoReferencia || creando} style={{ padding: "0 16px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {clienteError?.NoExisteClienteCfo && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ {clienteError.Message}
          </span>
          <button
            type="button"
            className="btn danger"
            onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
            style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
          >
            Ir a Crear Proveedor/Cliente
          </button>
        </div>
      )}
      {clienteError && !clienteError.NoExisteClienteCfo && (
        <div style={{
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px", color: "#9a3412", fontSize: "13px"
        }}>
          ⚠️ {clienteError.Message}
        </div>
      )}

      {clienteInfo && (
        <>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#166534", fontSize: "13px" }}>
            ✓ Cliente resuelto: <strong>{clienteInfo.ClienteDescripcion}</strong>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Datos del Documento
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Moneda</label>
                <select
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                >
                  <option value="">Seleccione...</option>
                  {MONEDAS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Dueño del Documento</label>
                <select
                  value={duenoDocumento}
                  onChange={(e) => setDuenoDocumento(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                >
                  <option value="">Seleccione...</option>
                  {DUENOS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Proveedor
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input
                type="text"
                placeholder="Buscar Proveedor por nombre..."
                value={proveedorNombreBusqueda}
                onChange={(e) => setProveedorNombreBusqueda(e.target.value)}
                disabled={buscandoProveedores}
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              <button type="button" className="btn soft" onClick={handleBuscarProveedores} disabled={buscandoProveedores} style={{ padding: "0 16px" }}>
                {buscandoProveedores ? "Buscando..." : "Buscar"}
              </button>
            </div>

            {proveedorResultados.length > 0 && (
              <div className="doc-table-wrap" style={{ marginBottom: "10px", maxHeight: "220px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>ID Fiscal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedorResultados.map((p) => (
                      <tr key={p.PersonaId}>
                        <td>{p.Nombre}</td>
                        <td>{p.IdFiscal}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn soft" type="button" onClick={() => handleSeleccionarProveedor(p)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                            Seleccionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {buscandoProveedorCfo && <p style={{ fontSize: "13px", color: "#697386" }}>Verificando Proveedor en CFO...</p>}

            {proveedorError?.NoExisteProveedorCfo && (
              <div style={{
                display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
                background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
                padding: "14px 16px", marginBottom: "10px"
              }}>
                <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
                  ⚠️ {proveedorError.Message}
                </span>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
                  style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
                >
                  Ir a Crear Proveedor/Cliente
                </button>
              </div>
            )}

            {proveedorCfoInfo && proveedorSeleccionado && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", color: "#166534", fontSize: "13px" }}>
                ✓ Proveedor resuelto: <strong>{proveedorSeleccionado.Nombre}</strong> — {proveedorCfoInfo.Materiales.length} material(es) disponible(s)
              </div>
            )}
          </div>
        </>
      )}

      {proveedorCfoInfo && (
        <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
            Detalle
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Material</label>
            <select
              value={materialSeleccionadoId}
              onChange={(e) => handleMaterialChange(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {proveedorCfoInfo.Materiales.map((m) => (
                <option key={m.Id} value={m.Id}>{m.Descripcion}{m.CodigoMaterial ? ` (${m.CodigoMaterial})` : ""}</option>
              ))}
            </select>
            {proveedorCfoInfo.Materiales.length === 0 && (
              <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                Este Proveedor no tiene Materiales agregados en CFO.
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Observación (debe ser el nombre del material)</label>
            <input
              type="text"
              value={observacion}
              onChange={(e) => { setObservacion(e.target.value); setObservacionManual(true); }}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>Cantidad (máx. 10)</label>
              <input
                type="number" min="1" max="10" step="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Precio de Venta</label>
              <input
                type="number" step="any"
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Impuesto</label>
              <input
                type="number" step="any"
                value={impuesto}
                onChange={(e) => setImpuesto(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Total (Precio + Impuesto)</label>
              <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9" }}>
                {total ?? "—"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Número de Documento Fiscal</label>
              <input
                type="text"
                value={numeroDocumentoFiscal}
                onChange={(e) => setNumeroDocumentoFiscal(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>CAI (opcional)</label>
              <input
                type="text"
                value={cai}
                onChange={(e) => setCai(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Fecha de Emisión</label>
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Fecha de Vencimiento</label>
              <input
                type="date"
                value={fechaVencimiento}
                onChange={(e) => setFechaVencimiento(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
          </div>
        </div>
      )}

      {clienteInfo && (
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Autorizado por
          </label>
          <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
            {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
          </div>
        </div>
      )}

      {proveedorCfoInfo && (
        <button className="btn primary" type="button" onClick={handleCrear} disabled={creando} style={{ marginBottom: "20px" }}>
          {creando ? "Creando..." : "Crear Documento Fiscal"}
        </button>
      )}

      {resultado && (
        <div style={{ border: eliminado ? "1px solid #fecaca" : "1px solid #d1fae5", background: eliminado ? "#fef2f2" : "#f0fdf9", borderRadius: "8px", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: eliminado ? "#991b1b" : "#065f46" }}>
              {eliminado ? "✗ Documento eliminado" : "✓ Documento Fiscal creado"}
            </div>
            {!eliminado && (
              <button
                type="button"
                className="btn danger"
                onClick={handleEliminarCreado}
                disabled={eliminando}
                style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
              >
                {eliminando ? "Eliminando..." : "🗑️ Eliminar este Documento"}
              </button>
            )}
          </div>
          {eliminado && (
            <div style={{ fontSize: "13px", color: "#991b1b", marginBottom: "10px" }}>
              Si se creó por error, ya quedó eliminado — puede volver a crearlo con los datos correctos.
            </div>
          )}
          <div className="doc-table-wrap">
            <table className="doc-table" style={{ width: "100%" }}>
              <tbody>
                {CAMPOS_RESUMEN_FISCAL.map(({ label, rutas }) => (
                  <tr key={label}>
                    <td style={{ fontWeight: "600", color: "#334155", width: "220px" }}>{label}</td>
                    <td>{formatearValor(buscarPrimerValor(resultado, rutas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const CAMPOS_RESUMEN_INTERNO = [
  { label: "Id", rutas: ["Id"] },
  { label: "Referencia Operativa", rutas: ["ReferenciaOperativa"] },
  { label: "Total Monto", rutas: ["TotalMonto"] },
  { label: "Moneda", rutas: ["Moneda.Value", "MonedaValue"] },
  { label: "Observación", rutas: ["Observacion", "Observación"] },
  { label: "Cliente", rutas: ["Cliente.Nombre", "ClienteNombre"] },
  { label: "Proveedor", rutas: ["Proveedor.Nombre", "ProveedorNombre"] },
  { label: "País", rutas: ["Pais.Descripcion", "PaisDescripcion"] },
];

function TabInternos({ onNavigate }) {
  const [referencia, setReferencia] = useState("");
  const [paisKey, setPaisKey] = useState("");
  const [buscandoReferencia, setBuscandoReferencia] = useState(false);
  const [clienteInfo, setClienteInfo] = useState(null);
  const [clienteError, setClienteError] = useState(null);

  const [moneda, setMoneda] = useState("");

  const [proveedorNombreBusqueda, setProveedorNombreBusqueda] = useState("");
  const [buscandoProveedores, setBuscandoProveedores] = useState(false);
  const [proveedorResultados, setProveedorResultados] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
  const [buscandoProveedorCfo, setBuscandoProveedorCfo] = useState(false);
  const [proveedorCfoInfo, setProveedorCfoInfo] = useState(null);
  const [proveedorError, setProveedorError] = useState(null);

  const [materialSeleccionadoId, setMaterialSeleccionadoId] = useState("");
  const [observacion, setObservacion] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [precioVenta, setPrecioVenta] = useState("");
  const [impuesto, setImpuesto] = useState("");

  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [eliminado, setEliminado] = useState(false);

  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const resetDesdeReferencia = () => {
    setClienteInfo(null);
    setClienteError(null);
    setProveedorNombreBusqueda("");
    setProveedorResultados([]);
    setProveedorSeleccionado(null);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setObservacion("");
    setCantidad("1");
    setPrecioVenta("");
    setImpuesto("");
    setResultado(null);
    setEliminando(false);
    setEliminado(false);
  };

  const handleBuscarReferencia = async () => {
    const referenciaTrim = referencia.trim();
    if (!referenciaTrim) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    if (!paisKey) {
      showToast("Seleccione un País", "warn");
      return;
    }
    setBuscandoReferencia(true);
    resetDesdeReferencia();
    try {
      const resp = await apiFetch(`/docProvisionalClientePorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setClienteError(data);
        showToast(data?.Message || "No se pudo resolver el Cliente", "warn");
        return;
      }
      setClienteInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoReferencia(false);
    }
  };

  const handleLimpiar = () => {
    setReferencia("");
    setPaisKey("");
    setMoneda("");
    resetDesdeReferencia();
  };

  const handleBuscarProveedores = async () => {
    const nombreTrim = proveedorNombreBusqueda.trim();
    if (!nombreTrim) {
      showToast("Ingrese un nombre para buscar el Proveedor", "warn");
      return;
    }
    setBuscandoProveedores(true);
    setProveedorResultados([]);
    try {
      const resp = await apiFetch(`/docProvisionalBuscarProveedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Proveedores", "warn");
        return;
      }
      const lista = Array.isArray(data) ? data : [];
      setProveedorResultados(lista);
      if (lista.length === 0) showToast("No se encontraron Proveedores con ese nombre", "warn");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedores(false);
    }
  };

  const handleSeleccionarProveedor = async (p) => {
    setProveedorSeleccionado(p);
    setProveedorResultados([]);
    setProveedorNombreBusqueda(p.Nombre);
    setProveedorCfoInfo(null);
    setProveedorError(null);
    setMaterialSeleccionadoId("");
    setBuscandoProveedorCfo(true);
    try {
      const resp = await apiFetch(`/docProvisionalProveedorEnCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedorPersonaId: p.PersonaId, paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setProveedorError(data);
        showToast(data?.Message || "No se pudo resolver el Proveedor en CFO", "warn");
        return;
      }
      setProveedorCfoInfo(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoProveedorCfo(false);
    }
  };

  const total = (() => {
    if (precioVenta.trim() === "" || impuesto.trim() === "") return null;
    const p = Number(precioVenta);
    const i = Number(impuesto);
    if (!Number.isFinite(p) || !Number.isFinite(i)) return null;
    return Math.round((p + i) * 100) / 100;
  })();

  const handleCrear = async () => {
    const referenciaTrim = referencia.trim();
    const observacionTrim = observacion.trim();
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!referenciaTrim || !paisKey || !clienteInfo?.ClienteId) {
      showToast("Busque primero la Referencia Operativa", "warn");
      return;
    }
    if (!moneda) {
      showToast("Seleccione la Moneda", "warn");
      return;
    }
    if (!proveedorSeleccionado || !proveedorCfoInfo?.ProveedorId) {
      showToast("Seleccione un Proveedor válido (creado en CFO)", "warn");
      return;
    }
    if (!materialSeleccionadoId) {
      showToast("Seleccione un Material", "warn");
      return;
    }
    if (!observacionTrim) {
      showToast("La Observación es requerida", "warn");
      return;
    }
    const cantidadNum = Number(cantidad);
    if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
      showToast("La Cantidad debe ser un número entero entre 1 y 10", "warn");
      return;
    }
    const precioVentaNum = Number(precioVenta);
    const impuestoNum = Number(impuesto);
    if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) {
      showToast("Ingrese un Precio de Venta válido", "warn");
      return;
    }
    if (!Number.isFinite(impuestoNum) || impuestoNum < 0) {
      showToast("Ingrese un Impuesto válido", "warn");
      return;
    }

    const material = proveedorCfoInfo.Materiales.find((m) => m.Id === materialSeleccionadoId);
    const monedaLabel = MONEDAS.find((m) => m.value === Number(moneda))?.label || moneda;

    if (!window.confirm(
      `¿Confirma crear el Documento Interno?\n\n` +
      `Referencia: ${referenciaTrim}\nPaís: ${PAISES[paisKey]?.label}\nCliente: ${clienteInfo.ClienteDescripcion}\n` +
      `Proveedor: ${proveedorSeleccionado.Nombre}\nMaterial: ${material?.Descripcion || "—"}\n` +
      `Cantidad: ${cantidadNum}   Precio Venta: ${precioVentaNum}   Impuesto: ${impuestoNum}   Total: ${total}\n` +
      `Moneda: ${monedaLabel}\nObservación: ${observacionTrim}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearDocumentoInternoPostFacturacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referenciaTrim,
          PaisKey: paisKey,
          Moneda: Number(moneda),
          Observacion: observacionTrim,
          ProveedorPersonaId: proveedorSeleccionado.PersonaId,
          MaterialProveedorId: materialSeleccionadoId,
          Cantidad: cantidadNum,
          PrecioVenta: precioVentaNum,
          Impuesto: impuestoNum,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Documento Interno", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento Interno creado con éxito", "ok");
      setResultado(extraerDocumento(data?.Data));
      setEliminado(false);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  // Permite deshacer una creación equivocada sin salir del módulo ni ir a Eliminar Documento —
  // usa el Id del documento que se acaba de crear (ya lo tenemos en "resultado").
  const handleEliminarCreado = async () => {
    const documentoId = buscarPrimerValor(resultado, ["Id"]);
    if (!documentoId) {
      showToast("No se pudo determinar el Id del documento creado.", "warn");
      return;
    }
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const motivo = window.prompt("Motivo de la eliminación (obligatorio):", "Documento creado por error");
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar el documento", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar el Documento recién creado?\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }
    setEliminando(true);
    try {
      const resp = await apiFetch(`/docProvisionalEliminarCreado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar el documento", "warn");
        return;
      }
      showToast(data?.Message || "✓ Documento eliminado con éxito", "ok");
      setEliminado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label>Referencia Operativa</label>
            <input
              type="text"
              placeholder="Ej: CE-CE-H25-6206"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label>País</label>
            <select
              value={paisKey}
              onChange={(e) => setPaisKey(e.target.value)}
              disabled={buscandoReferencia}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {Object.entries(PAISES).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "12px" }}>
          Por ahora este módulo solo maneja Honduras y Guatemala; el resto de países se habilitará cuando se confirme su División.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn primary" onClick={handleBuscarReferencia} disabled={buscandoReferencia} style={{ padding: "0 16px" }}>
            {buscandoReferencia ? "Buscando..." : "Buscar"}
          </button>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscandoReferencia || creando} style={{ padding: "0 16px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {clienteError?.NoExisteClienteCfo && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ {clienteError.Message}
          </span>
          <button
            type="button"
            className="btn danger"
            onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
            style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
          >
            Ir a Crear Proveedor/Cliente
          </button>
        </div>
      )}
      {clienteError && !clienteError.NoExisteClienteCfo && (
        <div style={{
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px", color: "#9a3412", fontSize: "13px"
        }}>
          ⚠️ {clienteError.Message}
        </div>
      )}

      {clienteInfo && (
        <>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#166534", fontSize: "13px" }}>
            ✓ Cliente resuelto: <strong>{clienteInfo.ClienteDescripcion}</strong>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Datos del Documento
            </div>
            <div className="field" style={{ maxWidth: "260px" }}>
              <label>Moneda</label>
              <select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {MONEDAS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Proveedor
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              <input
                type="text"
                placeholder="Buscar Proveedor por nombre..."
                value={proveedorNombreBusqueda}
                onChange={(e) => setProveedorNombreBusqueda(e.target.value)}
                disabled={buscandoProveedores}
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              <button type="button" className="btn soft" onClick={handleBuscarProveedores} disabled={buscandoProveedores} style={{ padding: "0 16px" }}>
                {buscandoProveedores ? "Buscando..." : "Buscar"}
              </button>
            </div>

            {proveedorResultados.length > 0 && (
              <div className="doc-table-wrap" style={{ marginBottom: "10px", maxHeight: "220px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>ID Fiscal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedorResultados.map((p) => (
                      <tr key={p.PersonaId}>
                        <td>{p.Nombre}</td>
                        <td>{p.IdFiscal}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn soft" type="button" onClick={() => handleSeleccionarProveedor(p)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                            Seleccionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {buscandoProveedorCfo && <p style={{ fontSize: "13px", color: "#697386" }}>Verificando Proveedor en CFO...</p>}

            {proveedorError?.NoExisteProveedorCfo && (
              <div style={{
                display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
                background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
                padding: "14px 16px", marginBottom: "10px"
              }}>
                <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
                  ⚠️ {proveedorError.Message}
                </span>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => onNavigate?.("cfo", "crearProveedorCliente")}
                  style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
                >
                  Ir a Crear Proveedor/Cliente
                </button>
              </div>
            )}

            {proveedorCfoInfo && proveedorSeleccionado && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", color: "#166534", fontSize: "13px" }}>
                ✓ Proveedor resuelto: <strong>{proveedorSeleccionado.Nombre}</strong> — {proveedorCfoInfo.Materiales.length} material(es) disponible(s)
              </div>
            )}
          </div>
        </>
      )}

      {proveedorCfoInfo && (
        <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
            Detalle
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Material</label>
            <select
              value={materialSeleccionadoId}
              onChange={(e) => setMaterialSeleccionadoId(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione...</option>
              {proveedorCfoInfo.Materiales.map((m) => (
                <option key={m.Id} value={m.Id}>{m.Descripcion}{m.CodigoMaterial ? ` (${m.CodigoMaterial})` : ""}</option>
              ))}
            </select>
            {proveedorCfoInfo.Materiales.length === 0 && (
              <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                Este Proveedor no tiene Materiales agregados en CFO.
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: "16px" }}>
            <label>Observación (motivo de negocio, ej. "Proveedor no está constituido")</label>
            <input
              type="text"
              value={observacion}
              onChange={(e) => setObservacion(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 140px" }}>
              <label>Cantidad (máx. 10)</label>
              <input
                type="number" min="1" max="10" step="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Precio de Venta</label>
              <input
                type="number" step="any"
                value={precioVenta}
                onChange={(e) => setPrecioVenta(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Impuesto</label>
              <input
                type="number" step="any"
                value={impuesto}
                onChange={(e) => setImpuesto(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Total (Precio + Impuesto)</label>
              <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9" }}>
                {total ?? "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {clienteInfo && (
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Autorizado por
          </label>
          <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
            {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
          </div>
        </div>
      )}

      {proveedorCfoInfo && (
        <button className="btn primary" type="button" onClick={handleCrear} disabled={creando} style={{ marginBottom: "20px" }}>
          {creando ? "Creando..." : "Crear Documento Interno"}
        </button>
      )}

      {resultado && (
        <div style={{ border: eliminado ? "1px solid #fecaca" : "1px solid #d1fae5", background: eliminado ? "#fef2f2" : "#f0fdf9", borderRadius: "8px", padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
            <div style={{ fontSize: "15px", fontWeight: "700", color: eliminado ? "#991b1b" : "#065f46" }}>
              {eliminado ? "✗ Documento eliminado" : "✓ Documento Interno creado"}
            </div>
            {!eliminado && (
              <button
                type="button"
                className="btn danger"
                onClick={handleEliminarCreado}
                disabled={eliminando}
                style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
              >
                {eliminando ? "Eliminando..." : "🗑️ Eliminar este Documento"}
              </button>
            )}
          </div>
          {eliminado && (
            <div style={{ fontSize: "13px", color: "#991b1b", marginBottom: "10px" }}>
              Si se creó por error, ya quedó eliminado — puede volver a crearlo con los datos correctos.
            </div>
          )}
          <div className="doc-table-wrap">
            <table className="doc-table" style={{ width: "100%" }}>
              <tbody>
                {CAMPOS_RESUMEN_INTERNO.map(({ label, rutas }) => (
                  <tr key={label}>
                    <td style={{ fontWeight: "600", color: "#334155", width: "220px" }}>{label}</td>
                    <td>{formatearValor(buscarPrimerValor(resultado, rutas))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CrearDocumentosPostFacturacion({ onNavigate }) {
  const [tab, setTab] = useState("provisional");

  const tabs = [
    { key: "provisional", label: "Documentos Provisionales" },
    { key: "fiscal", label: "Documentos Fiscales" },
    { key: "interno", label: "Documentos Internos" },
  ];

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "900px" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "20px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "20px", borderBottom: "1px solid #eaeaea" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: "10px 16px", fontSize: "13px", fontWeight: "600", border: "none", background: "none", cursor: "pointer",
              color: tab === t.key ? "#b42318" : "#697386",
              borderBottom: tab === t.key ? "2px solid #b42318" : "2px solid transparent"
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "provisional" && <TabProvisionales onNavigate={onNavigate} />}
      {tab === "fiscal" && <TabFiscales onNavigate={onNavigate} />}
      {tab === "interno" && <TabInternos onNavigate={onNavigate} />}
    </div>
  );
}
