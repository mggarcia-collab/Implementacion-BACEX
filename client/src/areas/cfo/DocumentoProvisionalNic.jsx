import { useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";

export const meta = {
  label: "Documento Provisional NIC (Proveedores)",
  icon: "📄",
  desc: "Crear Documentos Provisionales a partir de una o varias Referencias Operativas",
  kind: "primary",
};

// Únicas columnas que se muestran en el resumen tras crear los documentos. Cada
// una prueba primero la ruta anidada típica de este servicio (ej. Moneda.Value)
// y, si no existe, cae al nombre plano por si la API lo entrega así en su lugar.
const CAMPOS_RESUMEN = [
  { label: "Id", rutas: ["Id"] },
  { label: "Total Monto", rutas: ["TotalMonto"] },
  { label: "Referencia Operativa", rutas: ["ReferenciaOperativa"] },
  { label: "Moneda", rutas: ["Moneda.Value", "MonedaValue"] },
  { label: "Observación", rutas: ["Observacion", "Observación"] },
  { label: "Tipo (Valor)", rutas: ["Tipo.Value", "TipoValue"] },
  { label: "Tipo", rutas: ["Tipo.DisplayName", "TipoDisplayName"] },
  { label: "Vencido", rutas: ["Vencido"] },
  { label: "Cliente", rutas: ["Cliente.Nombre", "ClienteNombre"] },
  { label: "País", rutas: ["Pais.Descripcion", "PaisDescripcion"] },
  { label: "Dueño Documento", rutas: ["DueñoDocumento.DisplayName", "DueñoDocumentoDisplayName"] },
  { label: "División", rutas: ["Division"] },
  { label: "Proveedor", rutas: ["Proveedor.Nombre", "ProveedorNombre"] },
  { label: "N° Factura SAP", rutas: ["RegistroContable.NumeroFacturaSap", "RegistroContableNumeroFacturaSap"] },
];

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
  if (valor === null || valor === undefined || valor === "") {
    return <span style={{ color: "#a3acb9" }}>—</span>;
  }
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

// La respuesta de Azure normalmente trae el documento creado dentro de "Message"
// (a veces un objeto, a veces un arreglo con un elemento). Si no viene ahí, se
// intenta usar la respuesta completa como si fuera el documento directamente.
function extraerDocumento(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.Message)) return data.Message[0] || null;
  if (data.Message && typeof data.Message === "object") return data.Message;
  return data;
}

export default function DocumentoProvisionalNic() {
  const [referenciasTexto, setReferenciasTexto] = useState("");
  const [creando, setCreando] = useState(false);
  const [progreso, setProgreso] = useState(null);
  const [resultados, setResultados] = useState([]);
  const showToast = useToast();

  const handleCrear = async (e) => {
    e.preventDefault();

    const referencias = referenciasTexto.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }

    setCreando(true);
    setResultados([]);
    const nuevosResultados = [];
    let exitosos = 0;

    for (let i = 0; i < referencias.length; i++) {
      const referencia = referencias[i];
      setProgreso({ actual: i + 1, total: referencias.length });
      try {
        const response = await apiFetch(`/crearDocumentoProvisionalNic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ReferenciaOperativa: referencia })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          nuevosResultados.push({ referencia, documento: null, error: data?.Message || `Error ${response.status}` });
        } else {
          nuevosResultados.push({ referencia, documento: extraerDocumento(data?.Data), error: null });
          exitosos++;
        }
      } catch (error) {
        nuevosResultados.push({ referencia, documento: null, error: "Error de conexión con el servidor" });
      }
      // Se actualiza tras cada referencia (no solo al final) para que el cuadro se
      // vaya llenando en el mismo orden en que se van creando.
      setResultados([...nuevosResultados]);
    }

    setProgreso(null);
    setCreando(false);
    showToast(
      exitosos === referencias.length
        ? `✓ ${exitosos} documento(s) creado(s) con éxito`
        : `${exitosos} de ${referencias.length} documento(s) creado(s) con éxito`,
      exitosos === referencias.length ? "ok" : "warn"
    );
    if (exitosos === referencias.length) setReferenciasTexto("");
  };

  const handleLimpiar = () => {
    setReferenciasTexto("");
    setResultados([]);
    setProgreso(null);
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <form onSubmit={handleCrear} style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "24px", maxWidth: "640px" }}>
        <div className="field" style={{ marginBottom: "20px" }}>
          <label>Referencia(s) Operativa(s)</label>
          <textarea
            placeholder={"Ingrese una o varias Referencias Operativas...\nEj: NB-NB-N26-3045, NB-NB-N24-8207"}
            value={referenciasTexto}
            onChange={(e) => setReferenciasTexto(e.target.value)}
            disabled={creando}
            rows={3}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn primary" type="submit" disabled={creando}>
            {creando ? `Creando... (${progreso?.actual || 0}/${progreso?.total || 0})` : "Crear Documento(s) Provisional(es)"}
          </button>
          <button className="btn ghost" type="button" onClick={handleLimpiar} disabled={creando}>
            Limpiar
          </button>
        </div>
      </form>

      {resultados.length > 0 && (
        <div style={{ border: "1px solid #e3e8ee", borderRadius: "8px", padding: "20px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "14px" }}>
            Resumen — {resultados.length} documento{resultados.length !== 1 ? "s" : ""} procesado{resultados.length !== 1 ? "s" : ""}
          </div>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  {CAMPOS_RESUMEN.map(({ label }) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={`${r.referencia}-${i}`}>
                    <td>
                      {r.error ? (
                        <span style={{ color: "#b91c1c", fontWeight: "600", fontSize: "12px" }} title={r.error}>✗ Error</span>
                      ) : (
                        <span style={{ color: "#059669", fontWeight: "600", fontSize: "12px" }}>✓ Creado</span>
                      )}
                    </td>
                    {r.error ? (
                      <td colSpan={CAMPOS_RESUMEN.length} style={{ color: "#b91c1c" }}>
                        {r.referencia} — {r.error}
                      </td>
                    ) : (
                      CAMPOS_RESUMEN.map(({ label, rutas }) => (
                        <td key={label}>{formatearValor(buscarPrimerValor(r.documento, rutas))}</td>
                      ))
                    )}
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
