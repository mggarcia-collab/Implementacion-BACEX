import { useEffect, useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";

export const meta = {
  label: "Cuadrilla",
  icon: "👷",
  desc: "Crea Documento Provisional + Línea Material (Cuadrilla) para una Referencia Operativa",
  kind: "primary",
};

// Normaliza texto para poder comparar "ADUANA TERRESTRE EL AMATILLO HN" contra "Amatillo"
// sin que importen acentos, mayúsculas, ni los prefijos/sufijos que agrega cada usuario al
// escribir la descripción de la Aduana en HojaRuta (el texto ahí no viene limpio).
// Rango Unicode "Combining Diacritical Marks" (0x0300-0x036F), construido por código de
// caracter en vez de escribir el símbolo directo, para no arriesgar un problema de
// codificación del archivo fuente.
const RANGO_DIACRITICOS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function normalizar(texto) {
  return (texto || "")
    .normalize("NFD").replace(RANGO_DIACRITICOS, "")
    .toUpperCase()
    .replace(/ADUANA\s+TERRESTRE|ADUANA/g, "")
    .replace(/[,.]/g, " ")
    .replace(/\b(HN|GT|NIC|SV)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Cuadrilla({ onNavigate }) {
  const [referencia, setReferencia] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [datosCuadrilla, setDatosCuadrilla] = useState(null);
  const [aduanaInfo, setAduanaInfo] = useState(null);
  const [aduanas, setAduanas] = useState([]);
  const [aduanaKey, setAduanaKey] = useState("");
  const [ordenElegido, setOrdenElegido] = useState("");
  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch(`/aduanasCuadrilla`);
        const data = await resp.json().catch(() => null);
        if (resp.ok) setAduanas(Array.isArray(data) ? data : []);
      } catch {
        // Si falla, el dropdown queda vacío y no se podrá crear hasta recargar.
      }
    })();
  }, []);

  const handleBuscar = async () => {
    if (!referencia.trim()) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    setBuscando(true);
    setDatosCuadrilla(null);
    setAduanaInfo(null);
    setAduanaKey("");
    setOrdenElegido("");
    setResultado(null);
    try {
      const [respCuadrilla, respAduana] = await Promise.all([
        apiFetch(`/cuadrillaPorReferencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referencia: referencia.trim() })
        }),
        apiFetch(`/aduanaPorReferenciaCuadrilla`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referencia: referencia.trim() })
        })
      ]);

      const dataCuadrilla = await respCuadrilla.json().catch(() => null);
      if (!respCuadrilla.ok) {
        showToast(dataCuadrilla?.Message || "Error al buscar datos de Cuadrilla", "warn");
        return;
      }
      setDatosCuadrilla(dataCuadrilla);

      const dataAduana = await respAduana.json().catch(() => null);
      const filaAduana = respAduana.ok && Array.isArray(dataAduana) ? dataAduana[0] : null;
      setAduanaInfo(filaAduana || null);

      // Intento de resolver la Aduana automáticamente comparando el texto (normalizado)
      // contra el catálogo de 7 aduanas. Si no hay una coincidencia clara, se deja sin
      // seleccionar y el usuario debe elegirla (o corregirla con Cambio de Componente).
      if (filaAduana?.AduanaDescripcion) {
        const textoNormalizado = normalizar(filaAduana.AduanaDescripcion);
        const coincidencia = aduanas.find((a) => textoNormalizado.includes(normalizar(a.label)));
        if (coincidencia) {
          setAduanaKey(coincidencia.key);
        }
      }
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscando(false);
    }
  };

  const escalaElegida = datosCuadrilla?.Escalas?.find((e) => String(e.Orden) === ordenElegido) || null;

  const handleCrear = async () => {
    if (!datosCuadrilla) {
      showToast("Busque primero la Referencia Operativa", "warn");
      return;
    }
    if (!aduanaKey) {
      showToast("Confirme a qué Aduana pertenece esta referencia", "warn");
      return;
    }
    if (!escalaElegida) {
      showToast("Seleccione el tipo de escala (Muestreo, Parcial o Completa)", "warn");
      return;
    }
    const aduanaLabel = aduanas.find((a) => a.key === aduanaKey)?.label || aduanaKey;
    if (!window.confirm(
      `¿Confirma crear el Documento Provisional + Línea Material (Cuadrilla) para ${referencia.trim()}?\n\nAduana: ${aduanaLabel}\nEscala: ${escalaElegida.Nombre} (Valor ${escalaElegida.Valor} ${datosCuadrilla.Moneda}, Costo ${escalaElegida.Costo ?? "—"} ${datosCuadrilla.Moneda})`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearCuadrilla`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referencia.trim(),
          AduanaKey: aduanaKey,
          SegmentoId: datosCuadrilla.SegmentoId,
          MaterialVariableSegmentoId: datosCuadrilla.MaterialVariableSegmentoId,
          Parametro: escalaElegida.Orden
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear Documento + Cuadrilla", "warn");
        return;
      }
      showToast(data?.Message || "✓ Creado con éxito", "ok");
      setResultado({ referencia: referencia.trim(), aduana: aduanaLabel, escala: escalaElegida, moneda: datosCuadrilla.Moneda, data: data?.Data });
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "720px" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "24px" }}>
        <div className="field" style={{ marginBottom: "16px" }}>
          <label>Referencia Operativa</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="Ej: BH-BH-H26-1987"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={buscando}
              style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
            <button type="button" className="btn primary" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 16px" }}>
              {buscando ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>

        {datosCuadrilla && (
          <>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
                Cuadrilla encontrada en la negociación — {datosCuadrilla.ComponenteDescripcion || "—"}
              </div>
              <table className="doc-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}></th>
                    <th>Tipo de Revisión</th>
                    <th>Moneda</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th style={{ textAlign: "right" }}>Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {(datosCuadrilla.Escalas || []).map((e) => (
                    <tr key={e.Orden}>
                      <td>
                        <input
                          type="radio"
                          name="escala"
                          checked={ordenElegido === String(e.Orden)}
                          onChange={() => setOrdenElegido(String(e.Orden))}
                        />
                      </td>
                      <td>{e.Nombre}</td>
                      <td>{datosCuadrilla.Moneda}</td>
                      <td style={{ textAlign: "right" }}>{e.Valor ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{e.Costo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="field" style={{ marginBottom: "12px" }}>
              <label>Aduana (asignada automáticamente por el sistema)</label>
              {aduanaKey ? (
                <div style={{ padding: "10px 12px", border: "1px solid #86efac", background: "#f0fdf4", borderRadius: "6px", fontSize: "14px", color: "#166534", fontWeight: "700" }}>
                  {aduanas.find((a) => a.key === aduanaKey)?.label}
                </div>
              ) : (
                <div style={{ padding: "10px 12px", border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: "6px", fontSize: "14px", color: "#991b1b" }}>
                  No se pudo determinar la Aduana automáticamente para esta referencia — no se puede crear hasta corregirlo.
                </div>
              )}
              <div style={{ fontSize: "12px", color: "#a3acb9", marginTop: "4px" }}>
                Texto de la Aduana según el sistema: {aduanaInfo?.AduanaDescripcion || "no se encontró"}
                {aduanaInfo?.ClienteDescripcion && <> — Cliente: {aduanaInfo.ClienteDescripcion}</>}
              </div>
            </div>

            <div style={{
              display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
              background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
              padding: "12px 14px", marginBottom: "16px"
            }}>
              <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "220px" }}>
                ⚠️ Si esta Referencia Operativa está asignada a una Aduana incorrecta, debe hacer
                <strong> Cambio de Componente</strong> antes de crear la Cuadrilla.
              </span>
              <button
                type="button"
                className="btn danger"
                onClick={() => onNavigate?.("cfo", "cambio")}
                style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
              >
                Ir a Cambio de Componente
              </button>
            </div>

            <button className="btn primary" type="button" onClick={handleCrear} disabled={creando || !aduanaKey || !escalaElegida}>
              {creando ? "Creando..." : "Crear Docto + Cuadrilla"}
            </button>
          </>
        )}
      </div>

      {resultado && (
        <div style={{ border: "1px solid #d1fae5", background: "#f0fdf9", borderRadius: "8px", padding: "20px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#065f46", marginBottom: "10px" }}>
            ✓ Documento Provisional + Línea Material creado
          </div>
          <table className="doc-table" style={{ width: "100%", marginBottom: "14px" }}>
            <tbody>
              <tr>
                <td style={{ fontWeight: "600", color: "#334155", width: "180px" }}>Referencia Operativa</td>
                <td>{resultado.referencia}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: "600", color: "#334155" }}>Aduana</td>
                <td>{resultado.aduana}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: "600", color: "#334155" }}>Escala</td>
                <td>{resultado.escala?.Nombre} (Valor {resultado.escala?.Valor} {resultado.moneda}, Costo {resultado.escala?.Costo ?? "—"} {resultado.moneda})</td>
              </tr>
            </tbody>
          </table>
          {resultado.data && (
            <pre style={{
              background: "#0f172a", color: "#e2e8f0", padding: "14px", borderRadius: "8px",
              fontSize: "12px", overflow: "auto", maxHeight: "300px", whiteSpace: "pre-wrap", wordBreak: "break-word"
            }}>
              {JSON.stringify(resultado.data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
