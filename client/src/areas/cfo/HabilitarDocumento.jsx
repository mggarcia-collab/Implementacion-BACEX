import { useState, useLayoutEffect, useRef } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Habilitar Documento",
  icon: "✅",
  desc: "Buscar y habilitar documentos asociados a una Referencia Operativa",
  kind: "primary",
};

const currencyFmt = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// timeZone: "UTC" evita que el navegador reste el huso horario local: el driver de SQL
// etiqueta la fecha como UTC aunque en realidad ya es la hora local guardada en la BD.
const dateFmt = new Intl.DateTimeFormat("es-HN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });

const ESTADO_STYLE = {
  Habilitado: { background: "#d1fae5", color: "#065f46" },
  Inhabilitado: { background: "#fee2e2", color: "#991b1b" },
  Facturado: { background: "#dbeafe", color: "#1d4ed8" },
};
const DUENO_STYLE = {
  Vesta: { background: "#e0e7ff", color: "#3730a3" },
  Cliente: { background: "#fef3c7", color: "#92400e" },
};

function Badge({ text, style }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: "999px",
      fontSize: "11.5px", fontWeight: "600", whiteSpace: "nowrap",
      background: style?.background || "#f1f5f9", color: style?.color || "#475569"
    }}>
      {text}
    </span>
  );
}

export default function HabilitarDocumento() {
  const [referencia, setReferencia] = useState("");
  const [codigoErp, setCodigoErp] = useState("");
  const [codigoErpOptions, setCodigoErpOptions] = useState([]);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const [documentos, setDocumentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [habilitandoIds, setHabilitandoIds] = useState(() => new Set());
  const [deshabilitandoIds, setDeshabilitandoIds] = useState(() => new Set());
  const showToast = useToast();

  // Proveedor, Cliente y Tipo Documento van fijos a la izquierda, con su ancho real
  // (sin truncar). Medimos el ancho de cada uno ya renderizado para calcular dónde
  // debe empezar la columna fija siguiente; si no, se encimarían al hacer scroll.
  const proveedorRef = useRef(null);
  const clienteRef = useRef(null);
  const [leftOffsets, setLeftOffsets] = useState({ proveedor: 0, cliente: 0, tipo: 0 });

  useLayoutEffect(() => {
    if (documentos.length === 0) return;
    const proveedorWidth = proveedorRef.current?.offsetWidth || 0;
    const clienteWidth = clienteRef.current?.offsetWidth || 0;
    setLeftOffsets({
      proveedor: 0,
      cliente: proveedorWidth,
      tipo: proveedorWidth + clienteWidth,
    });
  }, [documentos]);

  const fetchDocumentos = async (referencias) => {
    try {
      const response = await apiFetch(`/documentosPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias, codigoErp: codigoErp.trim() || undefined })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al buscar documentos`, "warn");
        setDocumentos([]);
        setSearched(true);
        return;
      }
      setDocumentos(Array.isArray(data) ? data : []);
      setSearched(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setDocumentos([]);
      setSearched(true);
    }
  };

  // Refresca la tabla con la referencia actualmente filtrada, para que el Estado/Dueño
  // que se ve en pantalla siempre sea el real del servidor después de habilitar/deshabilitar
  // (y no una suposición local que puede quedar desactualizada si algo más modificó el documento).
  const refrescarDocumentos = async () => {
    const referencias = referencia.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) return;
    await fetchDocumentos(referencias);
  };

  const handleBuscar = async () => {
    const referencias = referencia.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa para buscar", "warn");
      return;
    }
    setLoading(true);
    try {
      await fetchDocumentos(referencias);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setReferencia("");
    setCodigoErp("");
    setCodigoErpOptions([]);
    setDocumentos([]);
    setSearched(false);
  };

  // Se dispara al salir del campo de Referencia: llena el desplegable de Código ERP
  // solo con los códigos que realmente están ligados a algún documento de esa(s) referencia(s).
  const fetchCodigosErp = async () => {
    const referencias = referencia.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) {
      setCodigoErpOptions([]);
      return;
    }
    try {
      const response = await apiFetch(`/codigosErpPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await response.json().catch(() => []);
      const opciones = Array.isArray(data) ? data : [];
      setCodigoErpOptions(opciones);
      setCodigoErp((actual) => (actual && !opciones.includes(actual) ? "" : actual));
    } catch (error) {
      setCodigoErpOptions([]);
    }
  };

  const handleHabilitar = async (doc) => {
    const documentoId = doc.DocumentoId;

    if (!autorizador) {
      showToast("Seleccione quién autoriza antes de habilitar", "warn");
      return;
    }
    setHabilitandoIds((prev) => new Set(prev).add(documentoId));
    try {
      const response = await apiFetch(`/habilitarDocumento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al habilitar el documento`, "warn");
        await refrescarDocumentos();
        return;
      }
      showToast(data?.Message || "✓ Documento habilitado con éxito", "ok");
      await refrescarDocumentos();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setHabilitandoIds((prev) => {
        const next = new Set(prev);
        next.delete(documentoId);
        return next;
      });
    }
  };

  const handleDeshabilitar = async (doc) => {
    const documentoId = doc.DocumentoId;

    if (!autorizador) {
      showToast("Seleccione quién autoriza antes de deshabilitar", "warn");
      return;
    }
    setDeshabilitandoIds((prev) => new Set(prev).add(documentoId));
    try {
      const response = await apiFetch(`/deshabilitarDocumento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al deshabilitar el documento`, "warn");
        await refrescarDocumentos();
        return;
      }
      showToast(data?.Message || "✓ Documento deshabilitado con éxito", "ok");
      await refrescarDocumentos();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setDeshabilitandoIds((prev) => {
        const next = new Set(prev);
        next.delete(documentoId);
        return next;
      });
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
          <div style={{ flex: 2 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Referencia Operativa
            </label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#a3acb9", fontSize: "16px" }}>🔍</span>
              <input
                type="text"
                placeholder="Ingrese una o varias Referencias Operativas..."
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                onBlur={fetchCodigosErp}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 38px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                disabled={loading}
              />
            </div>
          </div>
          <div style={{ flex: 1, minWidth: "180px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Filtrar por Código ERP
            </label>
            <select
              value={codigoErp}
              onChange={(e) => setCodigoErp(e.target.value)}
              disabled={loading || !referencia.trim() || codigoErpOptions.length === 0}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">
                {!referencia.trim() ? "Ingrese primero la Referencia" : codigoErpOptions.length === 0 ? "Sin códigos ERP" : "Todos los códigos"}
              </option>
              {codigoErpOptions.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button
            className="btn primary"
            onClick={handleBuscar}
            disabled={loading}
          >
            {loading ? "Buscando..." : "Buscar Registros"}
          </button>
          <button
            className="btn ghost"
            onClick={handleClear}
            disabled={loading}
          >
            Limpiar
          </button>
        </div>

        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", margin: "16px 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Autorizado por
        </label>
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
          {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
        </div>
      </div>

      {searched && documentos.length === 0 && (
        <p style={{ color: "#697386", fontSize: "14px" }}>No se encontraron documentos para esa referencia.</p>
      )}

      {documentos.length > 0 && (
        <>
          <div style={{ marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", color: "#697386" }}>
              {documentos.length} documento{documentos.length !== 1 ? "s" : ""} encontrado{documentos.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th ref={proveedorRef} className="sticky-col" style={{ left: leftOffsets.proveedor }}>Proveedor</th>
                  <th ref={clienteRef} className="sticky-col" style={{ left: leftOffsets.cliente }}>Cliente</th>
                  <th className="sticky-col sticky-col-last" style={{ left: leftOffsets.tipo }}>Tipo Documento</th>
                  <th>Material</th>
                  <th>Referencia</th>
                  <th style={{ textAlign: "right" }}>Monto</th>
                  <th>Dueño</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: "right" }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {documentos.map((doc) => (
                  <tr key={doc.DocumentoId}>
                    <td className="sticky-col" style={{ left: leftOffsets.proveedor, fontWeight: "600", color: "#334155" }}>{doc.Proveedor}</td>
                    <td className="sticky-col" style={{ left: leftOffsets.cliente }}>{doc.Cliente}</td>
                    <td className="sticky-col sticky-col-last" style={{ left: leftOffsets.tipo }}><Badge text={doc.Tipo_Documento} /></td>
                    <td>{doc.MaterialProveedor}</td>
                    <td>{doc.Referencia_Operativa}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#334155" }}>
                      {typeof doc.Monto_Documento === "number" ? currencyFmt.format(doc.Monto_Documento) : doc.Monto_Documento}
                    </td>
                    <td>
                      <Badge text={doc["Dueño Documento"]} style={DUENO_STYLE[doc["Dueño Documento"]]} />
                    </td>
                    <td>
                      <Badge text={doc["Estado de documento"]} style={ESTADO_STYLE[doc["Estado de documento"]]} />
                    </td>
                    <td>{doc.Fecha ? dateFmt.format(new Date(doc.Fecha)) : ""}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn primary"
                        onClick={() => handleHabilitar(doc)}
                        disabled={habilitandoIds.has(doc.DocumentoId) || deshabilitandoIds.has(doc.DocumentoId)}
                        style={{ padding: "6px 12px", fontSize: "12px" }}
                      >
                        {habilitandoIds.has(doc.DocumentoId) ? "Habilitando..." : "Habilitar"}
                      </button>
                      <button
                        className="btn danger"
                        onClick={() => handleDeshabilitar(doc)}
                        disabled={habilitandoIds.has(doc.DocumentoId) || deshabilitandoIds.has(doc.DocumentoId)}
                        style={{ padding: "6px 12px", fontSize: "12px", marginLeft: "6px" }}
                      >
                        {deshabilitandoIds.has(doc.DocumentoId) ? "Deshabilitando..." : "Deshabilitar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
