import { useState, useLayoutEffect, useRef } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Eliminar Documento",
  icon: "❌",
  desc: "Buscar y eliminar documentos del sistema mediante Referencia Operativa",
  kind: "danger",
};

const currencyFmt = new Intl.NumberFormat("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// timeZone: "UTC" evita que el navegador reste el huso horario local: el driver de SQL
// etiqueta la fecha como UTC aunque en realidad ya es la hora local guardada en la BD.
const dateFmt = new Intl.DateTimeFormat("es-HN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });

const TIPOS_CRITERIO = [
  { value: "referencia", label: "Referencia Operativa", placeholder: "Ej: LP-LP-H26-389 (una o varias)" },
  { value: "sp", label: "Solicitud de Pago (SP)", placeholder: "Ej: SP-000123 (una o varias)" },
  { value: "documentoFiscal", label: "Número de Documento Fiscal", placeholder: "Ej: 000123 (uno o varios)" },
  { value: "documentoSap", label: "Número de Documento SAP", placeholder: "Ej: 500001234 (uno o varios)" },
];

const ESTADO_STYLE = {
  Habilitado: { background: "#d1fae5", color: "#065f46" },
  Eliminado: { background: "#fee2e2", color: "#991b1b" },
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

export default function EliminarDocumento() {
  const [tipoCriterio, setTipoCriterio] = useState("referencia");
  const [valorCriterio, setValorCriterio] = useState("");
  const [codigoErp, setCodigoErp] = useState("");
  const [codigoErpOptions, setCodigoErpOptions] = useState([]);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const [documentos, setDocumentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [eliminandoIds, setEliminandoIds] = useState(() => new Set());
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

  // El valor admite varios elementos separados por coma, espacio o salto de línea.
  const partirValores = (texto) => texto.split(/[,\s\n]+/).map((v) => v.trim()).filter(Boolean);

  const tipoCriterioActual = TIPOS_CRITERIO.find((t) => t.value === tipoCriterio) || TIPOS_CRITERIO[0];

  // Según el tipo elegido en el combo, los valores ingresados van a una sola de estas listas;
  // las demás quedan vacías (el backend ya soporta combinarlas, pero aquí solo se usa una a la vez).
  const criteriosBusqueda = () => {
    const valores = partirValores(valorCriterio);
    return {
      referencias: tipoCriterio === "referencia" ? valores : [],
      sps: tipoCriterio === "sp" ? valores : [],
      documentosFiscales: tipoCriterio === "documentoFiscal" ? valores : [],
      documentosSap: tipoCriterio === "documentoSap" ? valores : [],
    };
  };

  const hayCriterio = Boolean(valorCriterio.trim());

  const handleTipoCriterioChange = (e) => {
    setTipoCriterio(e.target.value);
    setValorCriterio("");
    setCodigoErp("");
    setCodigoErpOptions([]);
  };

  const handleBuscar = async () => {
    if (!hayCriterio) {
      showToast(`Ingrese al menos un valor de ${tipoCriterioActual.label} para buscar`, "warn");
      return;
    }
    const { referencias, sps, documentosFiscales, documentosSap } = criteriosBusqueda();
    setLoading(true);
    try {
      const response = await apiFetch(`/documentosParaEliminar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias, sps, documentosFiscales, documentosSap, codigoErp: codigoErp.trim() || undefined })
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
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setTipoCriterio("referencia");
    setValorCriterio("");
    setCodigoErp("");
    setCodigoErpOptions([]);
    setDocumentos([]);
    setSearched(false);
  };

  // Se dispara al salir del campo de valor: llena el desplegable de Código ERP solo con los
  // códigos que realmente están ligados a algún documento que coincida con el criterio actual.
  // Solo aplica cuando se busca por Referencia Operativa (el material/Código ERP se identifica
  // por referencia; con SP, Documento Fiscal o Documento SAP el filtro queda deshabilitado).
  const fetchCodigosErp = async () => {
    if (tipoCriterio !== "referencia" || !hayCriterio) {
      setCodigoErpOptions([]);
      return;
    }
    const { referencias, sps, documentosFiscales, documentosSap } = criteriosBusqueda();
    try {
      const response = await apiFetch(`/codigosErpParaEliminar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias, sps, documentosFiscales, documentosSap })
      });
      const data = await response.json().catch(() => []);
      const opciones = Array.isArray(data) ? data : [];
      setCodigoErpOptions(opciones);
      setCodigoErp((actual) => (actual && !opciones.includes(actual) ? "" : actual));
    } catch (error) {
      setCodigoErpOptions([]);
    }
  };

  const handleEliminar = async (doc) => {
    const documentoId = doc.Documento_ID;

    if (!autorizador) {
      showToast("Seleccione quién autoriza antes de eliminar", "warn");
      return;
    }
    const motivo = window.prompt("Motivo de la eliminación (obligatorio):");
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar el documento", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar este documento?\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }

    setEliminandoIds((prev) => new Set(prev).add(documentoId));
    try {
      const response = await apiFetch(`/eliminarDocumento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentoId: documentoId, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al eliminar el documento`, "warn");
        return;
      }
      setDocumentos((prev) => prev.filter((d) => d.Documento_ID !== documentoId));
      showToast(data?.Message || "✓ Documento eliminado con éxito", "ok");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoIds((prev) => {
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
        <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#697386" }}>
          Elija con qué desea buscar y luego ingrese uno o varios valores (separados por coma, espacio o salto de línea).
        </p>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", marginBottom: "12px" }}>
          <div style={{ flex: 1, minWidth: "220px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Buscar por
            </label>
            <select
              value={tipoCriterio}
              onChange={handleTipoCriterioChange}
              disabled={loading}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              {TIPOS_CRITERIO.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {tipoCriterioActual.label}
            </label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#a3acb9", fontSize: "16px" }}>🔍</span>
              <input
                type="text"
                placeholder={tipoCriterioActual.placeholder}
                value={valorCriterio}
                onChange={(e) => setValorCriterio(e.target.value)}
                onBlur={fetchCodigosErp}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 38px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: "180px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Filtrar por Código ERP
            </label>
            <select
              value={codigoErp}
              onChange={(e) => setCodigoErp(e.target.value)}
              disabled={loading || tipoCriterio !== "referencia" || !hayCriterio || codigoErpOptions.length === 0}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">
                {tipoCriterio !== "referencia"
                  ? "Solo disponible al buscar por Referencia Operativa"
                  : !hayCriterio
                  ? "Ingrese primero una Referencia Operativa"
                  : codigoErpOptions.length === 0
                  ? "Sin códigos ERP"
                  : "Todos los códigos"}
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
        <p style={{ color: "#697386", fontSize: "14px" }}>No se encontraron documentos habilitados para esos criterios de búsqueda.</p>
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
                  <tr key={doc.Documento_ID}>
                    <td className="sticky-col" style={{ left: leftOffsets.proveedor, fontWeight: "600", color: "#334155" }}>{doc.Proveedor}</td>
                    <td className="sticky-col" style={{ left: leftOffsets.cliente }}>{doc.Cliente}</td>
                    <td className="sticky-col sticky-col-last" style={{ left: leftOffsets.tipo }}><Badge text={doc.Tipo_Documento} /></td>
                    <td>{doc.MaterialProveedor}</td>
                    <td>{doc.Referencia_Operativa}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#334155" }}>
                      {typeof doc.Monto_Documento === "number" ? currencyFmt.format(doc.Monto_Documento) : doc.Monto_Documento}
                    </td>
                    <td>
                      <Badge text={doc.Dueñodocumento_value} style={DUENO_STYLE[doc.Dueñodocumento_value]} />
                    </td>
                    <td>
                      <Badge text={doc.IsSoftDeleted} style={ESTADO_STYLE[doc.IsSoftDeleted]} />
                    </td>
                    <td>{doc.Fecha ? dateFmt.format(new Date(doc.Fecha)) : ""}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn danger"
                        onClick={() => handleEliminar(doc)}
                        disabled={eliminandoIds.has(doc.Documento_ID)}
                        style={{ padding: "6px 12px", fontSize: "12px" }}
                      >
                        {eliminandoIds.has(doc.Documento_ID) ? "Eliminando..." : "Eliminar"}
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
