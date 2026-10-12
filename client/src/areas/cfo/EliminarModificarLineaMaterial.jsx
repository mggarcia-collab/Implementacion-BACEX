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
function TablaLineaMaterial({ titulo, tipo, filas, autorizador, onModificadoLocal, onEliminadoLocal, onEliminadosLoteLocal, mostrarReferencia }) {
  const [editandoId, setEditandoId] = useState(null);
  const [valorEdicion, setValorEdicion] = useState("");
  const [costoEdicion, setCostoEdicion] = useState("");
  const [monedaEdicion, setMonedaEdicion] = useState("");
  const [observacionEdicion, setObservacionEdicion] = useState("");
  const [guardandoId, setGuardandoId] = useState(null);
  const [eliminandoId, setEliminandoId] = useState(null);
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [eliminandoLote, setEliminandoLote] = useState(false);
  // Modificación en lote: un solo motivo para todas las líneas seleccionadas, pero cada una
  // conserva su propio Valor/Costo/Moneda editable (no tiene sentido compartir esos números
  // entre materiales distintos, solo la razón del cambio).
  const [modoLoteModificar, setModoLoteModificar] = useState(false);
  const [edicionLote, setEdicionLote] = useState({}); // { [id]: { valor, costo, moneda } }
  const [observacionLote, setObservacionLote] = useState("");
  const [guardandoLote, setGuardandoLote] = useState(false);
  const [resultadoLote, setResultadoLote] = useState(null); // [{ id, descripcion, estado, detalle }]
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
      // Si Azure rechazó algún lote a mitad de camino (ej. por el límite de 50 líneas por
      // llamada), el backend ya reparte en lotes, pero puede quedar un resultado parcial --
      // IdsEliminados trae solo las que sí se aplicaron, para no dar por eliminadas las que no.
      const idsEliminados = Array.isArray(data?.IdsEliminados) ? data.IdsEliminados : ids;
      showToast(data?.Message || "✓ Eliminadas con éxito", data?.Completo === false ? "warn" : "ok");
      onEliminadosLoteLocal(idsEliminados);
      setSeleccionados((prev) => {
        const next = new Set(prev);
        for (const id of idsEliminados) next.delete(id);
        return next;
      });
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoLote(false);
    }
  };

  const handleIniciarModificarLote = () => {
    const inicial = {};
    for (const f of filas) {
      if (seleccionados.has(f.Id)) {
        inicial[f.Id] = { valor: f.Valor ?? "", costo: f.Costo ?? "", moneda: f.Currency_Value ?? "" };
      }
    }
    setEdicionLote(inicial);
    setObservacionLote("");
    setResultadoLote(null);
    setModoLoteModificar(true);
  };

  const handleCancelarModificarLote = () => {
    setModoLoteModificar(false);
    setEdicionLote({});
    setObservacionLote("");
  };

  const actualizarCampoLote = (id, campo, valor) => {
    setEdicionLote((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));
  };

  const handleGuardarLote = async () => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!observacionLote.trim()) {
      showToast("Debe indicar la observación (motivo del cambio)", "warn");
      return;
    }
    const ids = Object.keys(edicionLote);
    if (ids.length === 0) return;
    if (!window.confirm(`¿Confirma modificar ${ids.length} Línea(s) de Material con el mismo motivo?\n\nMotivo: ${observacionLote.trim()}`)) {
      return;
    }
    setGuardandoLote(true);
    const resultados = [];
    try {
      for (const id of ids) {
        const f = filas.find((fila) => fila.Id === id);
        const cambio = edicionLote[id];
        try {
          const resp = await apiFetch(`/modificarLineaMaterial`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              Tipo: tipo,
              Id: id,
              Valor: cambio.valor,
              Costo: cambio.costo,
              MonedaValue: cambio.moneda,
              ModifiedBy: autorizador,
              Observacion: observacionLote.trim()
            })
          });
          const data = await resp.json().catch(() => null);
          if (!resp.ok) {
            resultados.push({ id, descripcion: f?.Descripcion || id, estado: "error", detalle: data?.Message || "Error al modificar" });
            continue;
          }
          const nuevaMoneda = cambio.moneda === "" ? null : MONEDAS.find((m) => m.value === Number(cambio.moneda));
          onModificadoLocal(id, {
            Valor: cambio.valor === "" ? null : Number(cambio.valor),
            Costo: cambio.costo === "" ? null : Number(cambio.costo),
            ...(nuevaMoneda ? { Currency_Value: nuevaMoneda.value, MonedaLabel: nuevaMoneda.label } : {})
          });
          resultados.push({ id, descripcion: f?.Descripcion || id, estado: "ok", detalle: data?.Message || "Modificado con éxito" });
        } catch {
          resultados.push({ id, descripcion: f?.Descripcion || id, estado: "error", detalle: "Error de conexión con el servidor" });
        }
      }
      setResultadoLote(resultados);
      const exitosas = resultados.filter((r) => r.estado === "ok").length;
      showToast(
        exitosas === 0 ? "No se pudo modificar ninguna línea" : `✓ Modificadas ${exitosas} de ${ids.length} línea(s)`,
        exitosas === ids.length ? "ok" : "warn"
      );
      setModoLoteModificar(false);
      setEdicionLote({});
      setObservacionLote("");
      setSeleccionados(new Set());
    } finally {
      setGuardandoLote(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {titulo} ({filas.length})
        </div>
        {seleccionados.size > 0 && !modoLoteModificar && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "#697386" }}>{seleccionados.size} seleccionado{seleccionados.size !== 1 ? "s" : ""}</span>
            <button
              className="btn soft"
              onClick={handleIniciarModificarLote}
              disabled={eliminandoLote}
              style={{ padding: "4px 12px", fontSize: "12px" }}
            >
              Modificar seleccionados
            </button>
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
        {modoLoteModificar && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "12px", color: "#697386" }}>Modificando {Object.keys(edicionLote).length} línea(s)</span>
            <button
              className="btn primary"
              onClick={handleGuardarLote}
              disabled={guardandoLote}
              style={{ padding: "4px 12px", fontSize: "12px" }}
            >
              {guardandoLote ? "Guardando..." : "Guardar cambios"}
            </button>
            <button
              className="btn ghost"
              onClick={handleCancelarModificarLote}
              disabled={guardandoLote}
              style={{ padding: "4px 12px", fontSize: "12px" }}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {modoLoteModificar && (
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px" }}>
            Motivo del cambio (aplica a las {Object.keys(edicionLote).length} líneas seleccionadas) *
          </label>
          <input
            type="text"
            placeholder="Ej: Corrección de valor según negociación"
            value={observacionLote}
            onChange={(e) => setObservacionLote(e.target.value)}
            disabled={guardandoLote}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
          />
        </div>
      )}

      {resultadoLote && (
        <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {resultadoLote.map((r) => (
            <div key={r.id} style={{
              background: r.estado === "ok" ? "#d1fae5" : "#fee2e2",
              color: r.estado === "ok" ? "#065f46" : "#991b1b",
              borderRadius: "6px", padding: "6px 10px", fontSize: "12px"
            }}>
              {r.estado === "ok" ? "✓" : "✗"} <b>{r.descripcion}</b> — {r.detalle}
            </div>
          ))}
        </div>
      )}

      {filas.length === 0 ? (
        <p style={{ color: "#697386", fontSize: "13px", margin: 0 }}>Sin registros.</p>
      ) : (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%", tableLayout: "fixed" }}>
            {/* Mismo colgroup en las dos tablas (Fijos/Variables) para que las columnas queden
                alineadas entre ambas, aunque el contenido de cada una sea distinto. */}
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: mostrarReferencia ? "20%" : "26%" }} />
              {mostrarReferencia && <col style={{ width: "14%" }} />}
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
                    disabled={eliminandoLote || !!editandoId || modoLoteModificar}
                  />
                </th>
                <th>Material</th>
                {mostrarReferencia && <th>Referencia Operativa</th>}
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
                const enEdicionLote = modoLoteModificar && Object.prototype.hasOwnProperty.call(edicionLote, f.Id);
                const cambioLote = edicionLote[f.Id];
                return (
                  <tr key={f.Id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={seleccionados.has(f.Id)}
                        onChange={() => toggleSeleccion(f.Id)}
                        disabled={eliminandoLote || eliminandoId === f.Id || enEdicion || modoLoteModificar}
                      />
                    </td>
                    <td style={{ whiteSpace: "normal", wordBreak: "break-word", minWidth: "160px" }}>{f.Descripcion}</td>
                    {mostrarReferencia && <td>{f.ReferenciaOperativa}</td>}
                    <td>{f.MaterialErp}</td>
                    {enEdicionLote ? (
                      <>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number" step="any"
                            value={cambioLote.valor}
                            onChange={(e) => actualizarCampoLote(f.Id, "valor", e.target.value)}
                            disabled={guardandoLote}
                            style={{ width: "100px", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number" step="any"
                            value={cambioLote.costo}
                            onChange={(e) => actualizarCampoLote(f.Id, "costo", e.target.value)}
                            disabled={guardandoLote}
                            style={{ width: "100px", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", textAlign: "right" }}
                          />
                        </td>
                        <td>
                          <select
                            value={cambioLote.moneda}
                            onChange={(e) => actualizarCampoLote(f.Id, "moneda", e.target.value)}
                            disabled={guardandoLote}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                          >
                            <option value="">Seleccione...</option>
                            {MONEDAS.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right", fontSize: "11px", color: "#8a94a6" }}>En lote</td>
                      </>
                    ) : enEdicion ? (
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
                            disabled={eliminandoId === f.Id || modoLoteModificar}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            Editar
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => handleEliminar(f)}
                            disabled={eliminandoId === f.Id || modoLoteModificar}
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

// El campo de Referencia Operativa acepta una o varias (separadas por coma, espacio o línea
// nueva) -- se usa tal cual para "Agregar Material" (los mismos materiales en cada una); para
// ver/editar/eliminar líneas ya creadas (que es inherentemente de una sola SalesOrder) solo se
// usa la primera.
function parseReferencias(texto) {
  return [...new Set((texto || "").split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean))];
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
  const [resultadoAgregarMultiple, setResultadoAgregarMultiple] = useState(null); // [{ referencia, estado, detalle }]
  // Filtro visual (no vuelve a consultar el servidor: ya se tienen todas las filas cargadas)
  // para encontrar rápido una línea puntual por su Código ERP dentro de lo ya buscado.
  const [filtroCodigoErp, setFiltroCodigoErp] = useState("");
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  // Acepta una o varias Referencias Operativas -- cuando son varias, junta las Líneas de
  // Material de todas en una sola lista (cada una marcada con su propia ReferenciaOperativa).
  const fetchDatos = async (listaReferencias) => {
    try {
      const resp = await apiFetch(`/lineasMaterialPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias: listaReferencias })
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
      if (data?.NoEncontradas?.length > 0) {
        showToast(`⚠️ No existe SalesOrder para: ${data.NoEncontradas.join(", ")}`, "warn");
      }
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
  // Recibe el texto tal cual (una o varias referencias); las líneas ya creadas se muestran de
  // TODAS juntas, pero los candidatos para "Agregar Material" solo se resuelven de la primera.
  const buscarReferencia = async (referenciasTexto, { autoAgregar = false } = {}) => {
    const lista = parseReferencias(referenciasTexto);
    setBuscando(true);
    setDatos(null);
    setMaterialesDisponibles(null);
    setSeleccionFijos(new Set());
    setSeleccionVariables(new Set());
    setNoExisteSalesOrder(false);
    setSearched(false);
    setVista("principal");
    setResultadoAgregarMultiple(null);
    setFiltroCodigoErp("");
    try {
      const [, materialesData] = await Promise.all([fetchDatos(lista), fetchMaterialesDisponibles(lista[0])]);
      // Si se pidió ir directo a la pantalla de Agregar Material (ej. desde el aviso de
      // Cuadrilla), solo se hace si la búsqueda sí encontró la SalesOrder/negociación.
      if (autoAgregar && materialesData) setVista("agregar");
    } finally {
      setBuscando(false);
      setSearched(true);
    }
  };

  const handleBuscar = async () => {
    if (parseReferencias(referencia).length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }
    await buscarReferencia(referencia);
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
    setResultadoAgregarMultiple(null);
    setFiltroCodigoErp("");
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

  // Empareja los materiales seleccionados (por nombre) contra los candidatos de una Referencia
  // Operativa puntual, para obtener los Ids propios de SU negociación -- el Material
  // FlatSegmentoId/MaterialVariableSegmentoId de una referencia no sirve para otra si
  // pertenecen a Componentes distintos, por eso cada una se resuelve por separado.
  const resolverIdsPorNombre = (disponibles, nombresFijos, nombresVariables) => {
    const flatIds = [];
    const faltantes = [];
    for (const nombre of nombresFijos) {
      const match = disponibles.MaterialesFijosDisponibles.find((m) => m.NombreMaterial === nombre);
      if (match) flatIds.push(match.MaterialFlatSegmentoId); else faltantes.push(nombre);
    }
    const variableIds = [];
    for (const nombre of nombresVariables) {
      const match = disponibles.MaterialesVariablesDisponibles.find((m) => m.NombreMaterial === nombre);
      if (match) variableIds.push(match.MaterialVariableSegmentoId); else faltantes.push(nombre);
    }
    return { flatIds, variableIds, faltantes };
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
    const nombresFijos = materialesDisponibles.MaterialesFijosDisponibles.filter((m) => seleccionFijos.has(m.MaterialFlatSegmentoId)).map((m) => m.NombreMaterial);
    const nombresVariables = materialesDisponibles.MaterialesVariablesDisponibles.filter((m) => seleccionVariables.has(m.MaterialVariableSegmentoId)).map((m) => m.NombreMaterial);
    const nombres = [...nombresFijos, ...nombresVariables].join(", ");

    // Todas las referencias que haya en el campo de arriba (una o varias) reciben los mismos
    // materiales seleccionados; la primera es la que ya se resolvió para mostrar los candidatos.
    const todasReferencias = parseReferencias(referencia);
    const referenciaBuscada = todasReferencias[0] || "";
    if (todasReferencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }

    const mensajeConfirm = todasReferencias.length > 1
      ? `¿Confirma agregar ${flatIds.length + variableIds.length} material(es) en ${todasReferencias.length} Referencias Operativas?\n\n${nombres}\n\nReferencias: ${todasReferencias.join(", ")}`
      : `¿Confirma agregar ${flatIds.length + variableIds.length} material(es)?\n\n${nombres}`;
    if (!window.confirm(mensajeConfirm)) return;

    setAgregando(true);
    setResultadoAgregarMultiple(null);
    const resultados = [];
    try {
      for (const ref of todasReferencias) {
        try {
          // La referencia que ya se buscó arriba reutiliza lo que ya se tiene resuelto (ahorra
          // una consulta); el resto de referencias resuelve su propia negociación aparte.
          let disp;
          if (ref === referenciaBuscada) {
            disp = materialesDisponibles;
          } else {
            const dispResp = await apiFetch(`/materialesDisponiblesPorReferencia`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ referencia: ref })
            });
            const dispData = await dispResp.json().catch(() => null);
            if (!dispResp.ok || !dispData) {
              resultados.push({ referencia: ref, estado: "error", detalle: dispData?.Message || "No se pudo resolver la negociación de esta referencia" });
              continue;
            }
            disp = dispData;
          }

          const { flatIds: flatIdsRef, variableIds: variableIdsRef, faltantes } = resolverIdsPorNombre(disp, nombresFijos, nombresVariables);

          // Un renglón por cada material que no existe en la negociación de esta referencia,
          // con el formato "Referencia no contiene el material: Nombre" -- así queda listo
          // para copiar/reportar tal cual, en vez de un solo mensaje con todos juntos.
          for (const nombreFaltante of faltantes) {
            resultados.push({ referencia: ref, estado: "omitido", detalle: `no contiene el material: ${nombreFaltante}` });
          }

          if (flatIdsRef.length === 0 && variableIdsRef.length === 0) {
            continue;
          }

          const addResp = await apiFetch(`/agregarLineaMaterial`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ReferenciaOperativa: ref,
              SegmentoId: disp.SegmentoId,
              MaterialFlatSegmentoIds: flatIdsRef,
              MaterialVariableSegmentoIds: variableIdsRef,
              CreatedBy: autorizador
            })
          });
          const addData = await addResp.json().catch(() => null);
          resultados.push({
            referencia: ref,
            estado: addResp.ok ? "ok" : "error",
            detalle: addResp.ok ? (addData?.Message || "Agregado con éxito") : (addData?.Message || "Error al agregar")
          });
        } catch {
          resultados.push({ referencia: ref, estado: "error", detalle: "Error de conexión con el servidor" });
        }
      }

      setResultadoAgregarMultiple(resultados);
      // Puede haber varios renglones por referencia (ej. un "ok" más uno o más "no contiene el
      // material" para la misma), así que el resumen cuenta referencias únicas, no renglones.
      const referenciasConExito = new Set(resultados.filter((r) => r.estado === "ok").map((r) => r.referencia));
      showToast(
        referenciasConExito.size === 0
          ? "No se pudo agregar en ninguna referencia"
          : `✓ Agregado en ${referenciasConExito.size} de ${todasReferencias.length} referencia(s)`,
        referenciasConExito.size === todasReferencias.length ? "ok" : "warn"
      );

      setSeleccionFijos(new Set());
      setSeleccionVariables(new Set());
      // Se recarga la lista combinada de las referencias procesadas (para ver ahí mismo lo
      // recién agregado) y los candidatos de la primera (para el flag "Ya agregado").
      await Promise.all([fetchDatos(todasReferencias), fetchMaterialesDisponibles(referenciaBuscada)]);
      // Siempre se vuelve a la pantalla principal al terminar, igual que antes -- ahí ya se ve
      // lo recién agregado (de todas las referencias juntas) en vez de quedarse en Agregar.
      setVista("principal");
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
          <label>Referencia(s) Operativa(s)</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="Ej: CH-CH-H26-1463 (para agregar material en varias, sepáralas por coma o espacio)"
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

      {resultadoAgregarMultiple && (
        <div style={{ marginBottom: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#4f5b66" }}>Resultado de la última vez que agregaste material:</div>
          {resultadoAgregarMultiple.map((r, i) => {
            const estilos = {
              ok: { background: "#d1fae5", color: "#065f46", icono: "✓" },
              omitido: { background: "#fef9c3", color: "#854d0e", icono: "⏭️" },
              error: { background: "#fee2e2", color: "#991b1b", icono: "✗" },
            }[r.estado];
            return (
              <div key={`${r.referencia}-${i}`} style={{ background: estilos.background, color: estilos.color, borderRadius: "6px", padding: "8px 10px", fontSize: "12.5px" }}>
                {estilos.icono} <b>{r.referencia}</b> — {r.detalle}
              </div>
            );
          })}
        </div>
      )}

      {datos && vista === "principal" && (() => {
        const referenciasDistintas = new Set([
          ...datos.MaterialesFijos.map((f) => f.ReferenciaOperativa),
          ...datos.MaterialesVariables.map((f) => f.ReferenciaOperativa),
        ].filter(Boolean));
        const mostrarReferencia = referenciasDistintas.size > 1;
        // Filtro por Código ERP: solo visual, sobre lo que ya está cargado -- no vuelve a
        // consultar el servidor, así que no hace falta ningún endpoint nuevo para esto.
        const codigosErp = [...new Set([
          ...datos.MaterialesFijos.map((f) => f.MaterialErp),
          ...datos.MaterialesVariables.map((f) => f.MaterialErp),
        ].filter(Boolean))].sort();
        const aplicarFiltro = (filas) => filtroCodigoErp ? filas.filter((f) => f.MaterialErp === filtroCodigoErp) : filas;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {codigosErp.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <label style={{ fontSize: "12px", fontWeight: "600", color: "#4f5b66" }}>Filtrar por Código ERP:</label>
                <select
                  value={filtroCodigoErp}
                  onChange={(e) => setFiltroCodigoErp(e.target.value)}
                  style={{ padding: "6px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                >
                  <option value="">Todos los códigos</option>
                  {codigosErp.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ border: "1px solid #e3e8ee", borderRadius: "8px", padding: "20px" }}>
              <TablaLineaMaterial
                titulo="Materiales Fijos" tipo="fijo" filas={aplicarFiltro(datos.MaterialesFijos)} autorizador={autorizador}
                mostrarReferencia={mostrarReferencia}
                onModificadoLocal={(id, cambios) => actualizarFila("MaterialesFijos", id, cambios)}
                onEliminadoLocal={(id) => quitarFila("MaterialesFijos", id)}
                onEliminadosLoteLocal={(ids) => quitarFilas("MaterialesFijos", ids)}
              />
            </div>
            <div style={{ border: "1px solid #e3e8ee", borderRadius: "8px", padding: "20px" }}>
              <TablaLineaMaterial
                titulo="Materiales Variables" tipo="variable" filas={aplicarFiltro(datos.MaterialesVariables)} autorizador={autorizador}
                mostrarReferencia={mostrarReferencia}
                onModificadoLocal={(id, cambios) => actualizarFila("MaterialesVariables", id, cambios)}
                onEliminadoLocal={(id) => quitarFila("MaterialesVariables", id)}
                onEliminadosLoteLocal={(ids) => quitarFilas("MaterialesVariables", ids)}
              />
            </div>
          </div>
        );
      })()}

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

          {parseReferencias(referencia).length > 1 && (
            <div style={{ marginBottom: "16px", fontSize: "12px", color: "#4f5b66", background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: "6px", padding: "8px 10px" }}>
              Se van a agregar los materiales seleccionados en las {parseReferencias(referencia).length} Referencias Operativas escritas arriba: {parseReferencias(referencia).join(", ")}.
              Si alguna no tiene esos materiales configurados en su propia negociación, se omite y se indica en el resultado.
            </div>
          )}

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
