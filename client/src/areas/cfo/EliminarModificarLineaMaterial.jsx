import { useEffect, useRef, useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Agregar, Modificar y Eliminar Línea Material",
  icon: "🧮",
  desc: "Buscar, modificar o eliminar Materiales Fijos y Variables de una SalesOrder",
  kind: "danger",
};

// Mismos códigos de Moneda usados en el resto del sistema.
const MONEDAS = [
  { value: 340, label: "Lempiras (HNL)" },
  { value: 840, label: "Dólares (USD)" },
  { value: 558, label: "Córdobas (NIO)" },
  { value: 188, label: "Colones (CRC)" },
  { value: 320, label: "Quetzales (GTQ)" },
];

// Tabla de Materiales Fijos o Variables (misma estructura de columnas y acciones para ambas,
// solo cambia "tipo" (fijo/variable) que se le manda al backend para saber a cuál de los dos
// comandos externos (UpdateLineaMaterialFlat / UpdateLineaMaterialVariable) debe llamar.
function TablaLineaMaterial({ titulo, tipo, filas, autorizador, onModificadoLocal, onEliminadoLocal, onEliminadosLoteLocal }) {
  const [editandoId, setEditandoId] = useState(null);
  const [valorEdicion, setValorEdicion] = useState("");
  const [costoEdicion, setCostoEdicion] = useState("");
  const [monedaEdicion, setMonedaEdicion] = useState("");
  const [observacionEdicion, setObservacionEdicion] = useState("");
  const [guardandoId, setGuardandoId] = useState(null);
  const [eliminandoId, setEliminandoId] = useState(null);
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);
  const showToast = useToast();

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const todosSeleccionados = filas.length > 0 && filas.every((f) => seleccionados.has(f.Id));
  const toggleSeleccionTodos = () => {
    setSeleccionados(todosSeleccionados ? new Set() : new Set(filas.map((f) => f.Id)));
  };

  const handleIniciarEdicion = (f) => {
    setEditandoId(f.Id);
    setValorEdicion(f.Valor ?? "");
    setCostoEdicion(f.Costo ?? "");
    setMonedaEdicion(f.Currency_Value ?? "");
    setObservacionEdicion("");
  };

  const handleCancelarEdicion = () => {
    setEditandoId(null);
    setValorEdicion("");
    setCostoEdicion("");
    setMonedaEdicion("");
    setObservacionEdicion("");
  };

  const handleGuardarEdicion = async (f) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!observacionEdicion.trim()) {
      showToast("Debe indicar la observación (motivo del cambio)", "warn");
      return;
    }
    if (!window.confirm(
      `¿Confirma modificar "${f.Descripcion}"?\n\nValor: ${valorEdicion || 0}\nCosto: ${costoEdicion || 0}\nMoneda: ${MONEDAS.find((m) => m.value === Number(monedaEdicion))?.label || monedaEdicion}\nObservación: ${observacionEdicion.trim()}`
    )) {
      return;
    }
    setGuardandoId(f.Id);
    try {
      const resp = await apiFetch(`/modificarLineaMaterial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Tipo: tipo,
          Id: f.Id,
          Valor: valorEdicion,
          Costo: costoEdicion,
          MonedaValue: monedaEdicion,
          ModifiedBy: autorizador,
          Observacion: observacionEdicion.trim()
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al modificar la Línea de Material", "warn");
        return;
      }
      showToast(data?.Message || "✓ Modificado con éxito", "ok");
      // Se actualiza en pantalla con los mismos valores que se acaban de enviar (ya los
      // conocemos con certeza) en vez de esperar a volver a consultar el servidor — la
      // relectura inmediata después de guardar a veces todavía traía el valor viejo.
      const nuevaMoneda = monedaEdicion === "" ? null : MONEDAS.find((m) => m.value === Number(monedaEdicion));
      onModificadoLocal(f.Id, {
        Valor: valorEdicion === "" ? null : Number(valorEdicion),
        Costo: costoEdicion === "" ? null : Number(costoEdicion),
        ...(nuevaMoneda ? { Currency_Value: nuevaMoneda.value, MonedaLabel: nuevaMoneda.label } : {})
      });
      handleCancelarEdicion();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoId(null);
    }
  };

  const handleEliminar = async (f) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const motivo = window.prompt(`Motivo de la eliminación de "${f.Descripcion}" (obligatorio):`);
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar la Línea de Material", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar "${f.Descripcion}"? Esta acción no se puede deshacer.\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }
    setEliminandoId(f.Id);
    try {
      const resp = await apiFetch(`/eliminarLineaMaterial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Tipo: tipo, Id: f.Id, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar la Línea de Material", "warn");
        return;
      }
      showToast(data?.Message || "✓ Eliminado con éxito", "ok");
      // Se quita de la lista al instante en vez de esperar a volver a consultar el servidor
      // (mismo motivo que en Guardar: la relectura inmediata a veces todavía traía la fila).
      onEliminadoLocal(f.Id);
      setSeleccionados((prev) => {
        if (!prev.has(f.Id)) return prev;
        const next = new Set(prev);
        next.delete(f.Id);
        return next;
      });
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoId(null);
    }
  };

  const handleEliminarLote = async () => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const ids = [...seleccionados];
    if (ids.length === 0) return;
    const motivo = window.prompt(`Motivo de la eliminación de ${ids.length} Línea(s) de Material seleccionada(s) (obligatorio):`);
    if (!motivo || !motivo.trim()) {
      showToast("Debe indicar un motivo para eliminar las Líneas de Material", "warn");
      return;
    }
    const nombres = filas.filter((f) => seleccionados.has(f.Id)).map((f) => f.Descripcion).join(", ");
    if (!window.confirm(`¿Confirma eliminar ${ids.length} Línea(s) de Material?\n\n${nombres}\n\nEsta acción no se puede deshacer.\n\nMotivo: ${motivo.trim()}`)) {
      return;
    }
    setEliminandoLote(true);
    try {
      const resp = await apiFetch(`/eliminarLineasMaterial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Tipo: tipo, Ids: ids, ModifiedBy: autorizador, Observacion: motivo.trim() })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar las Líneas de Material", "warn");
        return;
      }
      showToast(data?.Message || "✓ Eliminadas con éxito", "ok");
      onEliminadosLoteLocal(ids);
      setSeleccionados(new Set());
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoLote(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {titulo} ({filas.length})
        </div>
        {seleccionados.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "#697386" }}>{seleccionados.size} seleccionado{seleccionados.size !== 1 ? "s" : ""}</span>
            <button
              className="btn danger"
              onClick={handleEliminarLote}
              disabled={eliminandoLote}
              style={{ padding: "4px 12px", fontSize: "12px" }}
            >
              {eliminandoLote ? "Eliminando..." : "Eliminar seleccionados"}
            </button>
          </div>
        )}
      </div>
      {filas.length === 0 ? (
        <p style={{ color: "#697386", fontSize: "13px", margin: 0 }}>Sin registros.</p>
      ) : (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%", tableLayout: "fixed" }}>
            {/* Mismo colgroup en las dos tablas (Fijos/Variables) para que las columnas queden
                alineadas entre ambas, aunque el contenido de cada una sea distinto. */}
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={todosSeleccionados}
                    onChange={toggleSeleccionTodos}
                    disabled={eliminandoLote || !!editandoId}
                  />
                </th>
                <th>Material</th>
                <th>Código ERP</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "right" }}>Costo</th>
                <th>Moneda</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const enEdicion = editandoId === f.Id;
                return (
                  <tr key={f.Id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={seleccionados.has(f.Id)}
                        onChange={() => toggleSeleccion(f.Id)}
                        disabled={eliminandoLote || eliminandoId === f.Id || enEdicion}
                      />
                    </td>
                    <td style={{ whiteSpace: "normal", wordBreak: "break-word", minWidth: "160px" }}>{f.Descripcion}</td>
                    <td>{f.MaterialErp}</td>
                    {enEdicion ? (
                      <>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number" step="any"
                            value={valorEdicion}
                            onChange={(e) => setValorEdicion(e.target.value)}
                            disabled={guardandoId === f.Id}
                            style={{ width: "100px", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number" step="any"
                            value={costoEdicion}
                            onChange={(e) => setCostoEdicion(e.target.value)}
                            disabled={guardandoId === f.Id}
                            style={{ width: "100px", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", textAlign: "right" }}
                          />
                        </td>
                        <td>
                          <select
                            value={monedaEdicion}
                            onChange={(e) => setMonedaEdicion(e.target.value)}
                            disabled={guardandoId === f.Id}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                          >
                            <option value="">Seleccione...</option>
                            {MONEDAS.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                            <button
                              className="btn primary"
                              onClick={() => handleGuardarEdicion(f)}
                              disabled={guardandoId === f.Id}
                              style={{ padding: "4px 10px", fontSize: "12px" }}
                            >
                              {guardandoId === f.Id ? "Guardando..." : "Guardar"}
                            </button>
                            <button
                              className="btn ghost"
                              onClick={handleCancelarEdicion}
                              disabled={guardandoId === f.Id}
                              style={{ padding: "4px 10px", fontSize: "12px" }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ textAlign: "right" }}>{f.Valor ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{f.Costo ?? "—"}</td>
                        <td>{f.MonedaLabel}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn soft"
                            onClick={() => handleIniciarEdicion(f)}
                            disabled={eliminandoId === f.Id}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            Editar
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => handleEliminar(f)}
                            disabled={eliminandoId === f.Id}
                            style={{ padding: "4px 10px", fontSize: "12px", marginLeft: "6px" }}
                          >
                            {eliminandoId === f.Id ? "Eliminando..." : "Eliminar"}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editandoId && (
        <div style={{ marginTop: "10px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px" }}>
            Observación (motivo del cambio) *
          </label>
          <input
            type="text"
            placeholder="Ej: Corrección de valor según negociación"
            value={observacionEdicion}
            onChange={(e) => setObservacionEdicion(e.target.value)}
            disabled={guardandoId === editandoId}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
          />
        </div>
      )}
    </div>
  );
}

// Tabla de materiales candidatos (configurados en la negociación del Componente) que se pueden
// agregar como nueva Línea de Material — sin edición ni eliminación, solo selección con checkbox
// para /agregarLineaMaterial. Espacio exclusivo, separado de las tablas de Fijos/Variables ya
// creados: agregar no debe mezclarse con editar/eliminar.
function TablaMaterialesDisponibles({ titulo, filas, idField, seleccionados, onToggle, onToggleTodos, disabled }) {
  // "Ya agregado" es solo informativo: algunos trámites llevan el mismo material varias veces,
  // así que no se deshabilita — el usuario puede volver a seleccionarlo y agregarlo de nuevo.
  const todosSeleccionados = filas.length > 0 && filas.every((f) => seleccionados.has(f[idField]));

  return (
    <div>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "8px" }}>
        {titulo} ({filas.length})
      </div>
      {filas.length === 0 ? (
        <p style={{ color: "#697386", fontSize: "13px", margin: 0 }}>Sin materiales configurados en la negociación.</p>
      ) : (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: "28%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={todosSeleccionados}
                    onChange={() => onToggleTodos(filas.map((f) => f[idField]))}
                    disabled={disabled || filas.length === 0}
                  />
                </th>
                <th>Material</th>
                <th>Código ERP</th>
                <th style={{ textAlign: "right" }}>Valor</th>
                <th style={{ textAlign: "right" }}>Costo</th>
                <th>Moneda</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f[idField]}>
                  <td>
                    <input
                      type="checkbox"
                      checked={seleccionados.has(f[idField])}
                      onChange={() => onToggle(f[idField])}
                      disabled={disabled}
                    />
                  </td>
                  <td style={{ whiteSpace: "normal", wordBreak: "break-word", minWidth: "160px" }}>{f.NombreMaterial}</td>
                  <td>{f.CodigoErp}</td>
                  <td style={{ textAlign: "right" }}>{f.Valor ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{f.Costo ?? "—"}</td>
                  <td>{f.MonedaLabel}</td>
                  <td>
                    {f.YaAgregado ? (
                      <span style={{ color: "#0f9d58", fontSize: "12px", fontWeight: "600" }}>Ya agregado</span>
                    ) : (
                      <span style={{ color: "#8a94a6", fontSize: "12px" }}>Disponible</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function EliminarModificarLineaMaterial({ onNavigate, navParams }) {
  const [referencia, setReferencia] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [searched, setSearched] = useState(false);
  const [datos, setDatos] = useState(null); // { SalesOrderId, StatusValue, MaterialesFijos, MaterialesVariables }
  const [noExisteSalesOrder, setNoExisteSalesOrder] = useState(false);
  const [materialesDisponibles, setMaterialesDisponibles] = useState(null); // { SalesOrderId, SegmentoId, ComponenteDescripcion, MaterialesFijosDisponibles, MaterialesVariablesDisponibles }
  const [seleccionFijos, setSeleccionFijos] = useState(() => new Set());
  const [seleccionVariables, setSeleccionVariables] = useState(() => new Set());
  const [agregando, setAgregando] = useState(false);
  const [vista, setVista] = useState("principal"); // "principal" | "agregar"
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const fetchDatos = async (referenciaTrim) => {
    try {
      const resp = await apiFetch(`/lineasMaterialPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        if (data?.NoExisteSalesOrder) {
          setNoExisteSalesOrder(true);
          setDatos(null);
        } else {
          showToast(data?.Message || "Error al buscar Líneas de Material", "warn");
        }
        return;
      }
      setNoExisteSalesOrder(false);
      setDatos(data);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    }
  };

  // Materiales configurados en la negociación pero no necesariamente agregados aún — candidatos
  // para el espacio de "Agregar Material". Si la SalesOrder no existe, simplemente queda vacío
  // (el aviso de "no existe SalesOrder" ya lo muestra fetchDatos).
  const fetchMaterialesDisponibles = async (referenciaTrim) => {
    try {
      const resp = await apiFetch(`/materialesDisponiblesPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencia: referenciaTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        setMaterialesDisponibles(null);
        return null;
      }
      setMaterialesDisponibles(data);
      return data;
    } catch (error) {
      setMaterialesDisponibles(null);
      return null;
    }
  };

  // Núcleo compartido por la búsqueda manual (botón Buscar) y por la búsqueda automática
  // cuando se llega desde otro módulo (ej. Cuadrilla) con una Referencia Operativa ya conocida.
  const buscarReferencia = async (referenciaTrim, { autoAgregar = false } = {}) => {
    setBuscando(true);
    setDatos(null);
    setMaterialesDisponibles(null);
    setSeleccionFijos(new Set());
    setSeleccionVariables(new Set());
    setNoExisteSalesOrder(false);
    setSearched(false);
    setVista("principal");
    try {
      const [, materialesData] = await Promise.all([fetchDatos(referenciaTrim), fetchMaterialesDisponibles(referenciaTrim)]);
      // Si se pidió ir directo a la pantalla de Agregar Material (ej. desde el aviso de
      // Cuadrilla), solo se hace si la búsqueda sí encontró la SalesOrder/negociación.
      if (autoAgregar && materialesData) setVista("agregar");
    } finally {
      setBuscando(false);
      setSearched(true);
    }
  };

  const handleBuscar = async () => {
    const referenciaTrim = referencia.trim();
    if (!referenciaTrim) {
      showToast("Ingrese una Referencia Operativa", "warn");
      return;
    }
    await buscarReferencia(referenciaTrim);
  };

  const handleLimpiar = () => {
    setReferencia("");
    setDatos(null);
    setMaterialesDisponibles(null);
    setSeleccionFijos(new Set());
    setSeleccionVariables(new Set());
    setNoExisteSalesOrder(false);
    setSearched(false);
    setVista("principal");
  };

  // Llegada automática desde otro módulo (ej. Cuadrilla: "Documento Provisional sin Línea
  // Material") con una Referencia Operativa ya resuelta — se busca sola, sin que el usuario
  // tenga que volver a escribirla. El "token" distingue cada navegación para no repetir la
  // búsqueda si este componente ya estaba montado y solo cambian otras props.
  const ultimoTokenNav = useRef(null);
  useEffect(() => {
    if (navParams?.referencia && navParams.token !== ultimoTokenNav.current) {
      ultimoTokenNav.current = navParams.token;
      setReferencia(navParams.referencia);
      buscarReferencia(navParams.referencia.trim(), { autoAgregar: !!navParams.autoAgregar });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navParams]);

  // Actualiza (o quita) una fila directamente en el estado local, sin volver a consultar al
  // servidor — el usuario acaba de confirmar esos mismos valores, así que no hay que adivinar
  // nada, y evita el retraso/inconsistencia de re-consultar justo después de guardar.
  const actualizarFila = (campo, id, cambios) => {
    setDatos((prev) => {
      if (!prev) return prev;
      return { ...prev, [campo]: prev[campo].map((f) => (f.Id === id ? { ...f, ...cambios } : f)) };
    });
  };
  const quitarFila = (campo, id) => {
    setDatos((prev) => {
      if (!prev) return prev;
      return { ...prev, [campo]: prev[campo].filter((f) => f.Id !== id) };
    });
  };
  const quitarFilas = (campo, ids) => {
    setDatos((prev) => {
      if (!prev) return prev;
      const idsSet = new Set(ids);
      return { ...prev, [campo]: prev[campo].filter((f) => !idsSet.has(f.Id)) };
    });
  };

  const toggleSeleccionFijo = (id) => {
    setSeleccionFijos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSeleccionVariable = (id) => {
    setSeleccionVariables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleTodosFijos = (ids) => {
    setSeleccionFijos((prev) => {
      const todos = ids.length > 0 && ids.every((id) => prev.has(id));
      return todos ? new Set() : new Set(ids);
    });
  };
  const toggleTodosVariables = (ids) => {
    setSeleccionVariables((prev) => {
      const todos = ids.length > 0 && ids.every((id) => prev.has(id));
      return todos ? new Set() : new Set(ids);
    });
  };

  const handleAgregarMateriales = async () => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const flatIds = [...seleccionFijos];
    const variableIds = [...seleccionVariables];
    if (flatIds.length === 0 && variableIds.length === 0) {
      showToast("Seleccione al menos un material para agregar", "warn");
      return;
    }
    const nombres = [
      ...materialesDisponibles.MaterialesFijosDisponibles.filter((m) => seleccionFijos.has(m.MaterialFlatSegmentoId)).map((m) => m.NombreMaterial),
      ...materialesDisponibles.MaterialesVariablesDisponibles.filter((m) => seleccionVariables.has(m.MaterialVariableSegmentoId)).map((m) => m.NombreMaterial),
    ].join(", ");
    if (!window.confirm(`¿Confirma agregar ${flatIds.length + variableIds.length} material(es)?\n\n${nombres}`)) {
      return;
    }
    setAgregando(true);
    try {
      const resp = await apiFetch(`/agregarLineaMaterial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ReferenciaOperativa: referencia.trim(),
          SegmentoId: materialesDisponibles.SegmentoId,
          MaterialFlatSegmentoIds: flatIds,
          MaterialVariableSegmentoIds: variableIds,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al agregar material(es)", "warn");
        return;
      }
      showToast(data?.Message || "✓ Material(es) agregado(s) con éxito", "ok");
      setSeleccionFijos(new Set());
      setSeleccionVariables(new Set());
      // Se recarga tanto lo ya creado (nuevas filas) como los candidatos (para actualizar
      // el flag "Ya agregado") — a diferencia de editar/eliminar, aquí sí conviene reconsultar
      // porque el recién agregado necesita su Id real de LineaMaterial, no lo tenemos localmente.
      const referenciaTrim = referencia.trim();
      await Promise.all([fetchDatos(referenciaTrim), fetchMaterialesDisponibles(referenciaTrim)]);
      // Una vez agregado, se vuelve a la pantalla inicial del módulo (listado de Fijos/Variables ya creados).
      setVista("principal");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setAgregando(false);
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
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
              placeholder="Ej: CH-CH-H26-1463"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              disabled={buscando}
              style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
            <button type="button" className="btn primary" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 16px" }}>
              {buscando ? "Buscando..." : "Buscar"}
            </button>
            <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscando} style={{ padding: "0 16px" }}>
              Limpiar
            </button>
            <button
              type="button"
              className="btn soft"
              onClick={() => setVista("agregar")}
              disabled={buscando || !materialesDisponibles || vista === "agregar"}
              style={{ padding: "0 16px", whiteSpace: "nowrap" }}
            >
              ➕ Agregar Material
            </button>
          </div>
        </div>

        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Autorizado por
        </label>
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
          {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
        </div>
      </div>

      {searched && noExisteSalesOrder && vista === "principal" && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px", marginBottom: "24px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ No existe una SalesOrder creada para esta Referencia Operativa. Valide primero en la
            <strong> Matriz de Acción</strong> y luego en <strong>Habilitar SalesOrder</strong>.
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="btn danger"
              onClick={() => onNavigate?.("red", "matriz")}
              style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
            >
              Ir a Matriz de Acción
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => onNavigate?.("cfo", "salesorder")}
              style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}
            >
              Ir a Habilitar SalesOrder
            </button>
          </div>
        </div>
      )}

      {datos && vista === "principal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ border: "1px solid #e3e8ee", borderRadius: "8px", padding: "20px" }}>
            <TablaLineaMaterial
              titulo="Materiales Fijos" tipo="fijo" filas={datos.MaterialesFijos} autorizador={autorizador}
              onModificadoLocal={(id, cambios) => actualizarFila("MaterialesFijos", id, cambios)}
              onEliminadoLocal={(id) => quitarFila("MaterialesFijos", id)}
              onEliminadosLoteLocal={(ids) => quitarFilas("MaterialesFijos", ids)}
            />
          </div>
          <div style={{ border: "1px solid #e3e8ee", borderRadius: "8px", padding: "20px" }}>
            <TablaLineaMaterial
              titulo="Materiales Variables" tipo="variable" filas={datos.MaterialesVariables} autorizador={autorizador}
              onModificadoLocal={(id, cambios) => actualizarFila("MaterialesVariables", id, cambios)}
              onEliminadoLocal={(id) => quitarFila("MaterialesVariables", id)}
              onEliminadosLoteLocal={(ids) => quitarFilas("MaterialesVariables", ids)}
            />
          </div>
        </div>
      )}

      {materialesDisponibles && vista === "agregar" && (
        <div style={{ border: "1px solid #b6d7a8", background: "#f6fbf3", borderRadius: "8px", padding: "20px", marginTop: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36" }}>➕ Agregar Material</div>
              <div style={{ fontSize: "12px", color: "#697386", marginTop: "2px" }}>
                Materiales configurados en la negociación ({materialesDisponibles.ComponenteDescripcion || "—"}) disponibles para agregar a esta SalesOrder.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {(seleccionFijos.size > 0 || seleccionVariables.size > 0) && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleAgregarMateriales}
                  disabled={agregando}
                  style={{ padding: "8px 16px", fontSize: "13px" }}
                >
                  {agregando ? "Agregando..." : `Agregar seleccionados (${seleccionFijos.size + seleccionVariables.size})`}
                </button>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setVista("principal")}
                disabled={agregando}
                style={{ padding: "8px 16px", fontSize: "13px" }}
              >
                ← Volver
              </button>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <TablaMaterialesDisponibles
              titulo="Materiales Fijos Disponibles"
              filas={materialesDisponibles.MaterialesFijosDisponibles}
              idField="MaterialFlatSegmentoId"
              seleccionados={seleccionFijos}
              onToggle={toggleSeleccionFijo}
              onToggleTodos={toggleTodosFijos}
              disabled={agregando}
            />
            <TablaMaterialesDisponibles
              titulo="Materiales Variables Disponibles"
              filas={materialesDisponibles.MaterialesVariablesDisponibles}
              idField="MaterialVariableSegmentoId"
              seleccionados={seleccionVariables}
              onToggle={toggleSeleccionVariable}
              onToggleTodos={toggleTodosVariables}
              disabled={agregando}
            />
          </div>
        </div>
      )}
    </div>
  );
}
