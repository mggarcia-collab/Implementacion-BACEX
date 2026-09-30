import { useState, useEffect, useRef } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Crear Especie Fiscal",
  icon: "🛃",
  desc: "Crear una Solicitud de Especie Fiscal para una Referencia Operativa",
  kind: "primary",
};

const ESPECIES_FISCALES = [
  { value: "1AA7D461-9CE7-42FF-85CE-15F033E6394D", label: "Sello de Botella" },
  { value: "AC1D4799-DE87-4ADD-8354-15F033FF8170", label: "Sello Plástico" },
  { value: "BC478EE0-C7C1-46EE-A880-14D3AA4788C5", label: "Marchamo Internacional" },
  { value: "BEF0D50A-EC1B-419E-9186-1610A396B181", label: "DUA / Poliza" },
  { value: "E2A7BDBA-D759-42E1-83FC-177148C81768", label: "Declaración BCH" },
  { value: "EA62F20C-552C-49B5-B497-1E1D71C5DC0C", label: "Marchamos de Uso Aduanero" },
  { value: "7D951863-A3BC-4188-ACD9-24E82EA20CEE", label: "Marchamo Nacional $" },
  { value: "B6A4CF72-E9F2-4B74-B4AF-2430D1AED16E", label: "Poliza $" },
];

const OBSERVACION_DEFAULT = "Creado desde Swagger";

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
  return String(valor);
}
// La respuesta de Azure normalmente trae el registro creado dentro de "Message" (a veces un
// objeto, a veces un arreglo con un elemento) — mismo patrón que Crear Documentos Post Facturación.
function extraerCreado(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.Message)) return data.Message[0] || null;
  if (data.Message && typeof data.Message === "object") return data.Message;
  return data;
}

const CAMPOS_RESUMEN = [
  { label: "Id", rutas: ["Id"] },
  { label: "Correlativo", rutas: ["Correlativo"] },
  { label: "Referencia Operativa", rutas: ["ReferenciaOperativa"] },
  { label: "Cantidad", rutas: ["Cantidad"] },
  { label: "Especie Fiscal", rutas: ["MaterialVariableDescripcion"] },
  { label: "Estado", rutas: ["Status.DisplayName", "StatusDisplayName"] },
  { label: "Cliente", rutas: ["ClienteNombre"] },
  { label: "Aduana", rutas: ["SitioNombre"] },
  { label: "Observación", rutas: ["Observacion", "Observación"] },
];

function TabCrear({ onCreado }) {
  const [referencia, setReferencia] = useState("");
  const [buscandoReferencia, setBuscandoReferencia] = useState(false);
  const [datosReferencia, setDatosReferencia] = useState(null);
  const [referenciaError, setReferenciaError] = useState(null);

  const [personaNombreBusqueda, setPersonaNombreBusqueda] = useState("");
  const [buscandoPersonas, setBuscandoPersonas] = useState(false);
  const [personaResultados, setPersonaResultados] = useState([]);
  const [personaSeleccionada, setPersonaSeleccionada] = useState(null);
  // Evita que, justo después de seleccionar una persona, el autocompletado vuelva a
  // dispararse (el texto del input queda igual al nombre elegido).
  const ultimaSeleccionRef = useRef("");

  const [especieFiscalId, setEspecieFiscalId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [observacion, setObservacion] = useState(OBSERVACION_DEFAULT);

  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const showToast = useToast();

  const resetDesdeReferencia = () => {
    setDatosReferencia(null);
    setReferenciaError(null);
    setPersonaNombreBusqueda("");
    setPersonaResultados([]);
    setPersonaSeleccionada(null);
    setEspecieFiscalId("");
    setCantidad("1");
    setObservacion(OBSERVACION_DEFAULT);
    setResultado(null);
  };

  const handleBuscarReferencia = async () => {
    const referenciaTrim = referencia.trim();
    if (!referenciaTrim) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    setBuscandoReferencia(true);
    resetDesdeReferencia();
    try {
      const resp = await apiFetch(`/especieFiscalDatosPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setReferenciaError(data);
        showToast(data?.Message || "No se pudo resolver el Cliente/Aduana", "warn");
        return;
      }
      setDatosReferencia(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoReferencia(false);
    }
  };

  const handleLimpiar = () => {
    setReferencia("");
    resetDesdeReferencia();
  };

  // Autocompletado: busca a medida que se escribe (sin botón "Buscar"), con un pequeño
  // debounce para no disparar una consulta por cada tecla.
  useEffect(() => {
    const nombreTrim = personaNombreBusqueda.trim();
    if (nombreTrim.length < 2 || nombreTrim === ultimaSeleccionRef.current) {
      setPersonaResultados([]);
      setBuscandoPersonas(false);
      return;
    }
    setBuscandoPersonas(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await apiFetch(`/especieFiscalBuscarPersonas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: nombreTrim })
        });
        const data = await resp.json().catch(() => null);
        setPersonaResultados(resp.ok && Array.isArray(data) ? data : []);
      } catch (error) {
        setPersonaResultados([]);
      } finally {
        setBuscandoPersonas(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [personaNombreBusqueda]);

  const handleSeleccionarPersona = (p) => {
    setPersonaSeleccionada(p);
    setPersonaResultados([]);
    ultimaSeleccionRef.current = p.Nombre;
    setPersonaNombreBusqueda(p.Nombre);
  };

  const handleCrear = async () => {
    const referenciaTrim = referencia.trim();
    const observacionTrim = observacion.trim();
    if (!referenciaTrim || !datosReferencia?.ClienteId) {
      showToast("Busque primero la Referencia Operativa", "warn");
      return;
    }
    if (!personaSeleccionada?.PersonaId) {
      showToast("Seleccione a nombre de quién se crea la Especie Fiscal", "warn");
      return;
    }
    if (!especieFiscalId) {
      showToast("Seleccione una Especie Fiscal", "warn");
      return;
    }
    const cantidadNum = Number(cantidad);
    if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
      showToast("La Cantidad debe ser un número entero mayor o igual a 1", "warn");
      return;
    }
    if (!observacionTrim) {
      showToast("La Observación es requerida", "warn");
      return;
    }

    const especieFiscalLabel = ESPECIES_FISCALES.find((e) => e.value === especieFiscalId)?.label || especieFiscalId;

    if (!window.confirm(
      `¿Confirma crear la Especie Fiscal?\n\n` +
      `Referencia: ${referenciaTrim}\nCliente: ${datosReferencia.ClienteDescripcion}\nAduana: ${datosReferencia.AduanaDescripcion}\n` +
      `Especie Fiscal: ${especieFiscalLabel}\nCantidad: ${cantidadNum}\n` +
      `A nombre de: ${personaSeleccionada.Nombre}\nObservación: ${observacionTrim}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearEspecieFiscal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referenciaTrim,
          Cantidad: cantidadNum,
          CreatedBy: personaSeleccionada.PersonaId,
          EspecieFiscalId: especieFiscalId,
          Observacion: observacionTrim
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear la Especie Fiscal", "warn");
        return;
      }
      showToast(data?.Message || "✓ Especie Fiscal creada con éxito", "ok");
      setResultado(extraerCreado(data?.Data));
      onCreado?.(referenciaTrim);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div className="field" style={{ marginBottom: "16px" }}>
          <label>Referencia Operativa</label>
          <input
            type="text"
            placeholder="Ej: CH-CH-H26-3505"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            disabled={buscandoReferencia}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
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

      {referenciaError && (
        <div style={{
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "20px", color: "#9a3412", fontSize: "13px"
        }}>
          ⚠️ {referenciaError.Message}
        </div>
      )}

      {datosReferencia && (
        <>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", color: "#166534", fontSize: "13px" }}>
            ✓ Cliente: <strong>{datosReferencia.ClienteDescripcion}</strong> — Aduana: <strong>{datosReferencia.AduanaDescripcion}</strong>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Indique el nombre de usuario en pantalla:
            </div>
            <div style={{ marginBottom: "10px" }}>
              <input
                type="text"
                placeholder="Empiece a escribir el nombre..."
                value={personaNombreBusqueda}
                onChange={(e) => setPersonaNombreBusqueda(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              {buscandoPersonas && <p style={{ fontSize: "12px", color: "#697386", margin: "6px 0 0" }}>Buscando...</p>}
            </div>

            {personaResultados.length > 0 && (
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
                    {personaResultados.map((p) => (
                      <tr key={p.PersonaId}>
                        <td>{p.Nombre}</td>
                        <td>{p.IdFiscal}</td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn soft" type="button" onClick={() => handleSeleccionarPersona(p)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                            Seleccionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {personaSeleccionada && (
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "12px 16px", color: "#166534", fontSize: "13px" }}>
                ✓ Persona seleccionada: <strong>{personaSeleccionada.Nombre}</strong>
              </div>
            )}
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Detalle
            </div>

            <div className="field" style={{ marginBottom: "16px" }}>
              <label>Especie Fiscal</label>
              <select
                value={especieFiscalId}
                onChange={(e) => setEspecieFiscalId(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {ESPECIES_FISCALES.map((e) => (
                  <option key={e.value} value={e.value}>{e.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Cantidad</label>
                <input
                  type="number" min="1" step="1"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                />
              </div>
              <div className="field" style={{ flex: "2 1 260px" }}>
                <label>Observación</label>
                <input
                  type="text"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                />
                <div style={{ fontSize: "12px", color: "#a3acb9", marginTop: "4px" }}>
                  Agregue su propia observación. Ejemplo: Número de inventario.
                </div>
              </div>
            </div>
          </div>

          <button className="btn primary" type="button" onClick={handleCrear} disabled={creando || !personaSeleccionada} style={{ marginBottom: "20px" }}>
            {creando ? "Creando..." : "Crear Especie Fiscal"}
          </button>
        </>
      )}

      {resultado && (
        <div style={{ border: "1px solid #d1fae5", background: "#f0fdf9", borderRadius: "8px", padding: "20px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#065f46", marginBottom: "10px" }}>
            ✓ Especie Fiscal creada
          </div>
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

function TabConsultar({ initParams }) {
  const [referenciasTexto, setReferenciasTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [seleccionados, setSeleccionados] = useState([]);
  const [observacionEliminar, setObservacionEliminar] = useState("");
  const [eliminando, setEliminando] = useState(false);

  const autorizadorActual = useAutorizadorActual();
  const showToast = useToast();

  // Recibe el texto explícito (en vez de leerlo del estado) para poder buscar de inmediato
  // al llegar desde "Crear" sin depender de que el setState ya se haya aplicado.
  const buscarConTexto = async (texto) => {
    const referencias = texto.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }
    setBuscando(true);
    setSeleccionados([]);
    try {
      const resp = await apiFetch(`/especiesFiscalesPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Especies Fiscales", "warn");
        setResultados([]);
        setBuscado(true);
        return;
      }
      setResultados(Array.isArray(data) ? data : []);
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setBuscado(true);
    } finally {
      setBuscando(false);
    }
  };

  const handleBuscar = () => buscarConTexto(referenciasTexto);

  // Llegada automática desde "Crear" justo después de crear una Especie Fiscal: ya se sabe
  // la Referencia Operativa, así que se busca sola para confirmar que sí quedó creada, sin
  // que el usuario tenga que volver a escribirla. El "token" distingue cada creación para
  // repetir la búsqueda aunque sea la misma referencia dos veces seguidas.
  const ultimoTokenRef = useRef(null);
  useEffect(() => {
    if (initParams?.referencia && initParams.token !== ultimoTokenRef.current) {
      ultimoTokenRef.current = initParams.token;
      setReferenciasTexto(initParams.referencia);
      buscarConTexto(initParams.referencia);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initParams]);

  const handleLimpiar = () => {
    setReferenciasTexto("");
    setBuscando(false);
    setBuscado(false);
    setResultados([]);
    setSeleccionados([]);
    setObservacionEliminar("");
  };

  const toggleSeleccionado = (id) => {
    setSeleccionados((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const handleEliminar = async () => {
    if (seleccionados.length === 0) {
      showToast("Seleccione al menos una Especie Fiscal para eliminar", "warn");
      return;
    }
    const observacionTrim = observacionEliminar.trim();
    if (!observacionTrim) {
      showToast("Indique el motivo de la eliminación", "warn");
      return;
    }
    if (!autorizadorActual) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar ${seleccionados.length} Especie(s) Fiscal(es)?\n\nMotivo: ${observacionTrim}`)) {
      return;
    }

    setEliminando(true);
    try {
      const resp = await apiFetch(`/eliminarEspecieFiscal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          List: seleccionados,
          Observacion: observacionTrim,
          ModifiedBy: autorizadorActual.id
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar la(s) Especie(s) Fiscal(es)", "warn");
        return;
      }
      showToast(data?.Message || "✓ Especie(s) Fiscal(es) eliminada(s) con éxito", "ok");
      setResultados((prev) => prev.filter((r) => !seleccionados.includes(r.Id)));
      setSeleccionados([]);
      setObservacionEliminar("");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div className="field" style={{ marginBottom: "16px" }}>
          <label>Referencia Operativa</label>
          <input
            type="text"
            placeholder="Una o varias Referencias Operativas..."
            value={referenciasTexto}
            onChange={(e) => setReferenciasTexto(e.target.value)}
            disabled={buscando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" className="btn primary" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 16px" }}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscando} style={{ padding: "0 16px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {buscado && resultados.length === 0 && (
        <p style={{ color: "#697386", fontSize: "13px" }}>No se encontraron Especies Fiscales para esa búsqueda.</p>
      )}

      {resultados.length > 0 && (
        <>
          <div className="doc-table-wrap" style={{ marginBottom: "20px" }}>
            <table className="doc-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th></th>
                  <th>Correlativo</th>
                  <th>Referencia Operativa</th>
                  <th>Especie Fiscal</th>
                  <th>Cliente</th>
                  <th>Creado por</th>
                  <th>Observación</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r) => (
                  <tr key={r.Id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={seleccionados.includes(r.Id)}
                        onChange={() => toggleSeleccionado(r.Id)}
                        disabled={eliminando}
                      />
                    </td>
                    <td>{formatearValor(r.Correlativo)}</td>
                    <td>{formatearValor(r.ReferenciaOperativa)}</td>
                    <td>{formatearValor(r.EspecieFiscal)}</td>
                    <td>{formatearValor(r.Cliente)}</td>
                    <td>{formatearValor(r.CreadoPor)}</td>
                    <td>{formatearValor(r.Observacion)}</td>
                    <td>{formatearValor(r.Estado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "12px" }}>
              Eliminar seleccionadas ({seleccionados.length})
            </div>
            <div className="field" style={{ marginBottom: "16px" }}>
              <label>Observación (motivo de la eliminación)</label>
              <input
                type="text"
                value={observacionEliminar}
                onChange={(e) => setObservacionEliminar(e.target.value)}
                disabled={eliminando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Autorizado por
              </label>
              <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
                {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
              </div>
            </div>
            <button
              type="button"
              className="btn danger"
              onClick={handleEliminar}
              disabled={eliminando || seleccionados.length === 0}
              style={{ padding: "8px 20px" }}
            >
              {eliminando ? "Eliminando..." : `Eliminar ${seleccionados.length || ""} Especie(s) Fiscal(es)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function CrearEspecieFiscal() {
  const [tab, setTab] = useState("consultar");
  // Referencia + token que "Crear" le pasa a "Consultar" justo después de crear una Especie
  // Fiscal, para que la busque sola al cambiar de tab (ver TabConsultar).
  const [consultarInit, setConsultarInit] = useState(null);

  const handleCreado = (referencia) => {
    setConsultarInit({ referencia, token: Date.now() });
    setTab("consultar");
  };

  const tabs = [
    { key: "consultar", label: "Consultar" },
    { key: "crear", label: "Crear" },
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

      {tab === "crear" && <TabCrear onCreado={handleCreado} />}
      {tab === "consultar" && <TabConsultar initParams={consultarInit} />}
    </div>
  );
}
