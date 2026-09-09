import { useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";
import Aduana, { meta as aduanaMeta } from "./cambioComponente/Aduana.jsx";
import ValidacionSello, { meta as selloMeta } from "./cambioComponente/ValidacionSello.jsx";

export const meta = {
  label: "Habilitar SalesOrder",
  icon: "📄",
  desc: "Habilitar una o más ordenes de venta",
  kind: "primary",
};

const fields = [
  { id: "so_num", label: "Referencia Operativa", type: "textarea", placeholder: "SO-01-01\nSO-01-02" },
];

// El backend local valida el estado en SQL Server antes de llamar a Azure:
// éxito = pasó de Creada(1) a Habilitada; "ya habilitada" = estado 2; "facturada" = estado 3, bloqueada.
const RESULT_STYLE = {
  success: { background: "#e6fffa", border: "#38b2ac", color: "#065f46" },
  already: { background: "#eff6ff", border: "#93c5fd", color: "#1d4ed8" },
  blocked: { background: "#fff5f5", border: "#feb2b2", color: "#991b1b" },
  notfound: { background: "#f3f4f6", border: "#d1d5db", color: "#374151" },
  error: { background: "#fffbeb", border: "#fcd34d", color: "#92400e" },
};

function classify(ok, message) {
  if (ok) return "success";
  const msg = (message || "").toLowerCase();
  if (msg.includes("no se encontró")) return "notfound";
  if (msg.includes("facturada")) return "blocked";
  if (msg.includes("ya se encuentra habilitada")) return "already";
  return "error";
}

export default function SalesOrder() {
  const autorizadorActual = useAutorizadorActual();
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [soResults, setSoResults] = useState([]);
  const [aduanaResultados, setAduanaResultados] = useState([]);
  const [aduanaLoading, setAduanaLoading] = useState(false);
  const [aduanaSearched, setAduanaSearched] = useState(false);
  const [selloResultados, setSelloResultados] = useState([]);
  const [selloLoading, setSelloLoading] = useState(false);
  const [selloSearched, setSelloSearched] = useState(false);
  const showToast = useToast();

  const handleFieldChange = (id, val) => {
    setFormValues((prev) => ({ ...prev, [id]: val }));
  };

  const handleClear = () => {
    setFormValues({});
    setSoResults([]);
    setAduanaResultados([]);
    setAduanaSearched(false);
    setSelloResultados([]);
    setSelloSearched(false);
  };

  const fetchAduana = async (listaOrders) => {
    setAduanaLoading(true);
    setAduanaResultados([]);
    try {
      const resultadosPorReferencia = await Promise.all(
        listaOrders.map(async (referencia) => {
          const resp = await apiFetch(`/aduanaPorReferencia`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ referencia })
          });
          const data = await resp.json().catch(() => null);
          return resp.ok && Array.isArray(data) ? data : [];
        })
      );
      setAduanaResultados(resultadosPorReferencia.flat());
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setAduanaLoading(false);
      setAduanaSearched(true);
    }
  };

  const fetchSello = async (listaOrders) => {
    setSelloLoading(true);
    setSelloResultados([]);
    try {
      const resp = await apiFetch(`/validacionSello`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias: listaOrders })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || `Error ${resp.status} al consultar validación de sello`, "warn");
        setSelloResultados([]);
        return;
      }
      setSelloResultados(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setSelloResultados([]);
    } finally {
      setSelloLoading(false);
      setSelloSearched(true);
    }
  };

  const handleConsultarAduanaYSello = async () => {
    const rawInput = formValues["so_num"];
    const listaOrders = rawInput?.split(/[\n,]/).map((item) => item.replace(/['"]/g, "").trim()).filter((item) => item.length > 0) || [];
    if (listaOrders.length === 0) {
      showToast("Ingrese al menos una SalesOrder para consultar", "warn");
      return;
    }
    await Promise.all([fetchAduana(listaOrders), fetchSello(listaOrders)]);
  };

  const handleSubmit = async () => {
    const rawInput = formValues["so_num"];
    const autorizador = autorizadorActual?.id;
    if (!rawInput?.trim() || !autorizador) {
      showToast("Complete los campos obligatorios", "warn");
      return;
    }
    const listaOrders = rawInput.split(/[\n,]/).map((item) => item.replace(/['"]/g, "").trim()).filter((item) => item.length > 0);
    if (listaOrders.length === 0) {
      showToast("Ingrese al menos una SalesOrder válida", "warn");
      return;
    }

    setLoading(true);
    setSoResults([]);
    for (const referencia of listaOrders) {
      try {
        const response = await apiFetch(`/habilitarSalesOrder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ReferenciaOperativa: referencia, ModifiedBy: autorizador })
        });
        const data = await response.json().catch(() => null);
        const message = data?.Message || (response.ok ? "Procesado correctamente" : `Error ${response.status}`);
        setSoResults((prev) => [...prev, { referencia, message, kind: classify(response.ok, message) }]);
      } catch (error) {
        setSoResults((prev) => [...prev, { referencia, message: "Error de conexión con el servidor", kind: "error" }]);
      }
    }
    setLoading(false);
    showToast("✓ Procesamiento finalizado", "ok");

    // Refresca Aduana y Sello con el estado recién actualizado, para no tener
    // que darle clic aparte a "Aduana y Sello" después de habilitar.
    await Promise.all([fetchAduana(listaOrders), fetchSello(listaOrders)]);
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
      <div className="form-sub" style={{ color: "#697386", marginBottom: "20px" }}>{meta.desc}</div>

      <div style={{ display: "flex", gap: "20px", flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 240px" }}>
          <div className="field">
            <label>{fields[0].label}</label>
            <textarea
              placeholder={fields[0].placeholder}
              value={formValues[fields[0].id] || ""}
              onChange={(e) => handleFieldChange(fields[0].id, e.target.value)}
              disabled={loading}
              rows={3}
            />
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button className="btn soft" onClick={handleConsultarAduanaYSello} disabled={loading || aduanaLoading || selloLoading} style={{ width: "100%" }}>
              {(aduanaLoading || selloLoading) ? "Consultando..." : "Aduana y Sello"}
            </button>
          </div>

          <div style={{ marginTop: "24px" }}>
            <div className="field">
              <label>Autorizado por</label>
              <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
                {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button className="btn primary" onClick={handleSubmit} disabled={loading} style={{ width: "100%" }}>
                {loading ? "Procesando..." : "Habilitar SalesOrder"}
              </button>
              <button className="btn ghost" onClick={handleClear} disabled={loading} style={{ width: "100%" }}>
                Limpiar
              </button>
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: "16px", border: "1px solid #e3e8ee", borderRadius: "10px", padding: "16px", background: "#fbfcfd" }}>
          {(aduanaSearched || aduanaLoading) ? (
            <div className="cuadro-box">
              <div className="cuadro-box-header">
                <div className="cuadro-box-icon">{aduanaMeta.icon}</div>
                <div>
                  <div className="cuadro-box-title">{aduanaMeta.label}</div>
                  <div className="cuadro-box-desc">{aduanaMeta.desc}</div>
                </div>
              </div>
              <Aduana resultados={aduanaResultados} loading={aduanaLoading} searched={aduanaSearched} />
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: "13px", padding: "12px" }}>
              Use "Aduana y Sello" para ver el estado en CFO y el sello de liberación de las referencias ingresadas.
            </div>
          )}

          {(selloSearched || selloLoading) && (
            <div className="cuadro-box">
              <div className="cuadro-box-header">
                <div className="cuadro-box-icon">{selloMeta.icon}</div>
                <div>
                  <div className="cuadro-box-title">{selloMeta.label}</div>
                  <div className="cuadro-box-desc">{selloMeta.desc}</div>
                </div>
              </div>
              <ValidacionSello resultados={selloResultados} loading={selloLoading} searched={selloSearched} />
            </div>
          )}
        </div>
      </div>

      {soResults.length > 0 && (
        <div className="cuadro-box" style={{ marginTop: "20px" }}>
          <div className="cuadro-box-header">
            <div className="cuadro-box-icon" style={{ background: "#22c55e" }}>✓</div>
            <div className="cuadro-box-title">Resultado del procesamiento</div>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {soResults.map((res, index) => {
              const style = RESULT_STYLE[res.kind] || RESULT_STYLE.error;
              return (
                <li key={index} style={{
                  padding: "10px 14px", borderRadius: "6px", marginBottom: "8px", fontSize: "14px",
                  background: style.background, border: `1px solid ${style.border}`, color: style.color
                }}>
                  <strong>{res.referencia}:</strong> {res.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
