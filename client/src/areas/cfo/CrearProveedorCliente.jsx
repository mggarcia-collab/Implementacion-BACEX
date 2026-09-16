import { useState, useEffect, Fragment } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Crear Proveedor / Cliente",
  icon: "🏢",
  desc: "Crear un nuevo Proveedor o Cliente en el sistema",
  kind: "primary",
};

const TIPOS = [
  { value: "proveedor", label: "Proveedor" },
  { value: "cliente", label: "Cliente" },
];

// Mismo catálogo que en el backend (server/routes/Cfo.routes.js → PAISES_PROVEEDOR_CLIENTE),
// solo para mostrar las opciones; el backend es quien decide el PaisId/TipoIdFiscalId/Sociedad reales.
const PAISES = [
  { key: "honduras", label: "Honduras" },
  { key: "elSalvador", label: "El Salvador" },
  { key: "guatemala", label: "Guatemala" },
  { key: "nicaragua", label: "Nicaragua" },
  { key: "costaRica", label: "Costa Rica" },
];

// Mismo catálogo que en el backend (server/routes/Cfo.routes.js → TENANTS_PROVEEDOR_CFO). No
// corresponde 1:1 con los Países de arriba: El Salvador, Guatemala y Nicaragua comparten Tenant,
// y hay dos Tenants especiales que no son país (Corporación Dinant, Dinant Exports).
const TENANTS_CFO = [
  { key: "honduras", label: "Honduras" },
  { key: "elSalvador", label: "El Salvador" },
  { key: "guatemala", label: "Guatemala" },
  { key: "nicaragua", label: "Nicaragua" },
  { key: "costaRica", label: "Costa Rica" },
  { key: "corporacionDinant", label: "Corporación Dinant" },
  { key: "dinantExports", label: "Dinant Exports" },
];

// Mismo catálogo que en el backend (server/routes/Cfo.routes.js → MONEDAS_PROVEEDOR_CFO).
const MONEDAS_CFO = [
  { key: "lempiras", label: "Lempiras (HNL)", value: 340 },
  { key: "dolares", label: "Dólares (USD)", value: 840 },
  { key: "cordobas", label: "Córdobas (NIO)", value: 558 },
  { key: "colones", label: "Colones (CRC)", value: 188 },
  { key: "quetzales", label: "Quetzales (GTQ)", value: 320 },
];

// Numerito de paso (1, 2, 3...) que se antepone al título de cada tarjeta, para que Código ERP →
// Proveedor en CFO → Oficiales de Pago se lean como una secuencia aunque, en pantallas angostas,
// la cuadrícula las apile una debajo de otra en vez de dejarlas en fila.
function PasoBadge({ n }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: "20px", height: "20px", borderRadius: "50%", background: "#3b82f6", color: "#fff",
      fontSize: "11px", fontWeight: "700", marginRight: "8px", flexShrink: 0, verticalAlign: "middle"
    }}>
      {n}
    </span>
  );
}

// Vista previa en pantalla de la Referencia que va a generar el backend (mismo algoritmo que
// generarReferencia() en Cfo.routes.js) — el backend recalcula el valor real, esto es solo UX.
function previsualizarReferencia(nombre) {
  const palabras = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "";
  if (palabras.length === 1) return palabras[0].slice(0, 3).toUpperCase();
  return palabras.slice(0, 3).map((p) => p[0]).join("").toUpperCase();
}

// Sección de Código ERP para el proveedor con el que se está trabajando (ya sea uno recién
// creado o uno existente elegido en la validación). Un proveedor puede tener varios Códigos
// ERP (uno por País/Sociedad en el que opera); lo que no puede repetirse es el mismo Código
// en dos proveedores distintos — esa validación la hace el backend antes de crear.
function SeccionCodigoErp({ persona }) {
  const [codigosErp, setCodigosErp] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [creando, setCreando] = useState(false);
  const [agregarOtro, setAgregarOtro] = useState(null); // null = aún no responde, true = mostrar formulario, false = no por ahora
  const [editandoId, setEditandoId] = useState(null);
  const [valorEdicion, setValorEdicion] = useState("");
  const [guardandoId, setGuardandoId] = useState(null);
  const [eliminandoId, setEliminandoId] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const buscarCodigos = async (personaId) => {
    setCargando(true);
    setCodigosErp(null);
    setAgregarOtro(null);
    try {
      const resp = await apiFetch(`/codigosErpProveedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaJuridicaProveedorId: personaId })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al validar Código ERP", "warn");
        setCodigosErp([]);
        return;
      }
      setCodigosErp(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setCodigosErp([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (persona?.id) buscarCodigos(persona.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id]);

  const nuevoCodigoTrim = nuevoCodigo.trim();
  const puedeCrear = nuevoCodigoTrim && !creando;

  const handleCrearCodigo = async () => {
    if (!puedeCrear) return;
    if (!window.confirm(
      `¿Confirma crear el Código ERP "${nuevoCodigoTrim}"?\n\nProveedor: ${persona.nombre}\n\nEl País y la Sociedad se toman automáticamente del País con el que se registró el proveedor.`
    )) {
      return;
    }
    setCreando(true);
    try {
      const resp = await apiFetch(`/crearCodigoErpProveedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PersonaJuridicaProveedorId: persona.id,
          Codigo: nuevoCodigoTrim
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Código ERP", "warn");
        return;
      }
      showToast(data?.Message || `✓ Código ERP creado con éxito (${data?.Pais || ""} - Sociedad ${data?.Sociedad || ""})`, "ok");
      setNuevoCodigo("");
      await buscarCodigos(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  const handleIniciarEdicion = (c) => {
    setEditandoId(c.Id);
    setValorEdicion(c.Codigo);
  };

  const handleCancelarEdicion = () => {
    setEditandoId(null);
    setValorEdicion("");
  };

  const handleGuardarEdicion = async (c) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const nuevoValor = valorEdicion.trim();
    if (!nuevoValor) {
      showToast("El Código ERP es requerido", "warn");
      return;
    }
    if (nuevoValor === c.Codigo) {
      handleCancelarEdicion();
      return;
    }
    if (!window.confirm(`¿Confirma cambiar el Código ERP "${c.Codigo}" a "${nuevoValor}"?`)) {
      return;
    }
    setGuardandoId(c.Id);
    try {
      const resp = await apiFetch(`/modificarCodigoErpProveedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: c.Id, Codigo: nuevoValor, ModifiedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al modificar el Código ERP", "warn");
        return;
      }
      showToast(data?.Message || "✓ Código ERP modificado con éxito", "ok");
      handleCancelarEdicion();
      await buscarCodigos(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoId(null);
    }
  };

  const handleEliminar = async (c) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar el Código ERP "${c.Codigo}" (${c.Pais})? Esta acción no se puede deshacer.`)) {
      return;
    }
    setEliminandoId(c.Id);
    try {
      const resp = await apiFetch(`/eliminarCodigoErpProveedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: c.Id, ModifiedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar el Código ERP", "warn");
        return;
      }
      showToast(data?.Message || "✓ Código ERP eliminado con éxito", "ok");
      await buscarCodigos(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={1} />Código ERP
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong> (ID Fiscal: {persona.idFiscal})
      </div>

      <div style={{ marginBottom: "14px" }}>
        <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Autorizado por
        </label>
        <div style={{ padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
          {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
        </div>
      </div>

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Códigos ERP existentes...</div>}

      {!cargando && codigosErp && codigosErp.length > 0 && (
        <div className="doc-table-wrap" style={{ marginBottom: "16px", maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Sociedad</th>
                <th>País</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {codigosErp.map((c) => (
                <tr key={c.Id}>
                  {editandoId === c.Id ? (
                    <>
                      <td>
                        <input
                          type="text"
                          value={valorEdicion}
                          onChange={(e) => setValorEdicion(e.target.value)}
                          disabled={guardandoId === c.Id}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                        />
                      </td>
                      <td>{c.Sociedad}</td>
                      <td>{c.Pais}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn primary"
                          onClick={() => handleGuardarEdicion(c)}
                          disabled={guardandoId === c.Id}
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                        >
                          {guardandoId === c.Id ? "Guardando..." : "Guardar"}
                        </button>
                        <button
                          className="btn ghost"
                          onClick={handleCancelarEdicion}
                          disabled={guardandoId === c.Id}
                          style={{ padding: "4px 10px", fontSize: "12px", marginLeft: "6px" }}
                        >
                          Cancelar
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{c.Codigo}</td>
                      <td>{c.Sociedad}</td>
                      <td>{c.Pais}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn soft"
                          onClick={() => handleIniciarEdicion(c)}
                          disabled={eliminandoId === c.Id}
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                        >
                          Editar
                        </button>
                        <button
                          className="btn danger"
                          onClick={() => handleEliminar(c)}
                          disabled={eliminandoId === c.Id}
                          style={{ padding: "4px 10px", fontSize: "12px", marginLeft: "6px" }}
                        >
                          {eliminandoId === c.Id ? "Eliminando..." : "Eliminar"}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && codigosErp && codigosErp.length === 0 && (
        <div style={{ fontSize: "14px", color: "#697386", marginBottom: "16px" }}>
          Este proveedor aún no tiene Códigos ERP registrados.
        </div>
      )}

      {!cargando && codigosErp && codigosErp.length > 0 && agregarOtro === null && (
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", background: "#fff", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#334155" }}>
            El proveedor ya tiene {codigosErp.length > 1 ? "Códigos ERP registrados" : "un Código ERP registrado"}. ¿Deseas agregar otro?
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn soft" onClick={() => setAgregarOtro(true)}>Sí</button>
            <button type="button" className="btn ghost" onClick={() => setAgregarOtro(false)}>No</button>
          </div>
        </div>
      )}

      {!cargando && codigosErp && codigosErp.length > 0 && agregarOtro === false && (
        <button type="button" className="btn ghost" onClick={() => setAgregarOtro(true)} style={{ marginBottom: "16px" }}>
          + Agregar otro Código ERP
        </button>
      )}

      {!cargando && codigosErp && (codigosErp.length === 0 || agregarOtro === true) && (
      <>
      <div className="field" style={{ marginBottom: "8px" }}>
        <label>Código ERP *</label>
        <input
          type="text"
          placeholder="Ingrese el nuevo Código ERP"
          value={nuevoCodigo}
          onChange={(e) => setNuevoCodigo(e.target.value)}
          disabled={creando}
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
        />
      </div>

      <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "14px" }}>
        El País y la Sociedad se asignan automáticamente según el País con el que se registró este proveedor.
      </div>

      <button type="button" className="btn primary" onClick={handleCrearCodigo} disabled={!puedeCrear}>
        {creando ? "Creando..." : "Crear Código ERP"}
      </button>
      </>
      )}
    </div>
  );
}

// Tenants especiales que, para proveedores de Honduras, a veces también hay que dar de alta
// aparte (el mismo proveedor puede necesitar existir en CFO bajo varios Tenants a la vez).
const TENANTS_EXTRA_HONDURAS = ["corporacionDinant", "dinantExports"];

// Crea el registro del Proveedor en la base de datos de CFO (api/Proveedor/Create), enlazado
// al PersonaId ya validado/creado en Personas. El Nombre no lo escribe el usuario aquí: el
// backend lo extrae de Personas para garantizar que sea el mismo que se registró originalmente.
// Antes de crear, se valida contra CfoNetCore.dbo.Proveedor (no solo lo creado en esta sesión)
// qué Tenants ya existen para este proveedor, para poder avisar si se repite uno por error.
function SeccionProveedorCfo({ persona, existentes, cargando, onRecargar }) {
  const [tenantKey, setTenantKey] = useState("");
  const [aplicaRetencion, setAplicaRetencion] = useState("");
  const [sujetoExcluido, setSujetoExcluido] = useState("");
  const [creando, setCreando] = useState(false);
  const [ofrecerExtra, setOfrecerExtra] = useState(null); // null = sin decidir, true = mostrar formulario limitado, false = dijo que no
  const [editandoMonedaId, setEditandoMonedaId] = useState(null);
  const [monedaSeleccionada, setMonedaSeleccionada] = useState("");
  const [guardandoMonedaId, setGuardandoMonedaId] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const existentesKeys = new Set((existentes || []).map((e) => e.TenantKey));
  const esCasoHonduras = existentesKeys.has("honduras");
  const tenantsPendientesHonduras = TENANTS_EXTRA_HONDURAS.filter((k) => !existentesKeys.has(k));
  const puedeOfrecerExtraHonduras = esCasoHonduras && tenantsPendientesHonduras.length > 0;

  // Duplicado exacto de Honduras: se ofrece redirigir a los Tenants especiales pendientes.
  // Duplicado de cualquier otro Tenant: solo se avisa, no hay a dónde redirigir.
  const duplicadoHonduras = tenantKey === "honduras" && existentesKeys.has("honduras");
  const duplicadoOtro = tenantKey && tenantKey !== "honduras" && existentesKeys.has(tenantKey);

  // Al agregar un Tenant adicional (caso Honduras) solo se ofrecen los especiales pendientes;
  // en cualquier otro momento se puede elegir cualquier Tenant (para poder detectar duplicados).
  const opcionesTenant = ofrecerExtra === true
    ? TENANTS_CFO.filter((t) => tenantsPendientesHonduras.includes(t.key))
    : TENANTS_CFO;

  const mostrarFormulario = !duplicadoHonduras && !duplicadoOtro
    && (!existentes || existentes.length === 0 || ofrecerExtra === true);

  const tenantElegido = TENANTS_CFO.find((t) => t.key === tenantKey);
  const puedeCrear = tenantKey && !duplicadoHonduras && !duplicadoOtro
    && aplicaRetencion !== "" && sujetoExcluido !== "" && autorizador && !creando;

  const handleCrear = async () => {
    if (!puedeCrear) return;
    if (!window.confirm(
      `¿Confirma crear el Proveedor en CFO?\n\nProveedor: ${persona.nombre}\nPaís/Tenant: ${tenantElegido.label}\nAplica Retención: ${aplicaRetencion === "si" ? "Sí" : "No"}\nProveedor Sujeto Excluido: ${sujetoExcluido === "si" ? "Sí" : "No"}`
    )) {
      return;
    }
    setCreando(true);
    try {
      const resp = await apiFetch(`/crearProveedorCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PersonaId: persona.id,
          TenantKey: tenantKey,
          AplicaRetencion: aplicaRetencion === "si",
          IsProveedorSujetoExcluido: sujetoExcluido === "si",
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Proveedor en CFO", "warn");
        return;
      }
      showToast(data?.Message || "✓ Proveedor creado en CFO con éxito", "ok");
      setTenantKey("");
      setAplicaRetencion("");
      setSujetoExcluido("");
      setOfrecerExtra(null);
      await onRecargar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  const handleIniciarMoneda = (e) => {
    const actual = MONEDAS_CFO.find((m) => m.value === e.MonedaValue);
    setEditandoMonedaId(e.Id);
    setMonedaSeleccionada(actual?.key || "");
  };

  const handleCancelarMoneda = () => {
    setEditandoMonedaId(null);
    setMonedaSeleccionada("");
  };

  const handleGuardarMoneda = async (e) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!monedaSeleccionada) {
      showToast("Debe seleccionar una Moneda", "warn");
      return;
    }
    const monedaElegida = MONEDAS_CFO.find((m) => m.key === monedaSeleccionada);
    if (!window.confirm(`¿Confirma asignar la Moneda "${monedaElegida.label}" a este Proveedor (${e.Pais})?`)) {
      return;
    }
    setGuardandoMonedaId(e.Id);
    try {
      const resp = await apiFetch(`/asignarMonedaProveedorCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: e.Id, MonedaKey: monedaSeleccionada, ModifiedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al asignar la Moneda", "warn");
        return;
      }
      showToast(data?.Message || "✓ Moneda asignada con éxito", "ok");
      handleCancelarMoneda();
      await onRecargar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoMonedaId(null);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={2} />Proveedor en CFO
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong>
      </div>

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Proveedor en CFO...</div>}

      {!cargando && existentes && existentes.length > 0 && (
        <div style={{ border: "1px solid #d1fae5", background: "#f0fdf9", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#065f46", marginBottom: "8px" }}>
            ✓ Proveedor creado en CFO
          </div>
          <div className="doc-table-wrap" style={{ border: "none", boxShadow: "none", borderRadius: 0, maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>País / Tenant</th>
                <th>Aplica Retención</th>
                <th>Proveedor Sujeto Excluido</th>
                <th>Moneda</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {existentes.map((e) => {
                const monedaActual = MONEDAS_CFO.find((m) => m.value === e.MonedaValue);
                const editandoMoneda = editandoMonedaId === e.Id;
                return (
                  <tr key={e.TenantKey}>
                    <td>{e.Pais}</td>
                    <td>{e.AplicaRetencion ? "Sí" : "No"}</td>
                    <td>{e.IsProveedorSujetoExcluido ? "Sí" : "No"}</td>
                    <td>
                      {editandoMoneda ? (
                        <select
                          value={monedaSeleccionada}
                          onChange={(ev) => setMonedaSeleccionada(ev.target.value)}
                          disabled={guardandoMonedaId === e.Id}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                        >
                          <option value="">Seleccione...</option>
                          {MONEDAS_CFO.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                          ))}
                        </select>
                      ) : (
                        monedaActual?.label || "— Sin asignar —"
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {editandoMoneda ? (
                        <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                          <button
                            className="btn primary"
                            onClick={() => handleGuardarMoneda(e)}
                            disabled={guardandoMonedaId === e.Id}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            {guardandoMonedaId === e.Id ? "Guardando..." : "Guardar"}
                          </button>
                          <button
                            className="btn ghost"
                            onClick={handleCancelarMoneda}
                            disabled={guardandoMonedaId === e.Id}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn soft"
                          onClick={() => handleIniciarMoneda(e)}
                          style={{ padding: "4px 10px", fontSize: "12px" }}
                        >
                          {monedaActual ? "Cambiar Moneda" : "Asignar Moneda"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {duplicadoHonduras && (
        <div style={{ padding: "10px 12px", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#92400e" }}>
            Proveedor para este País ya existe. ¿Deseas crearlo para otro Tenant?
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn soft" onClick={() => { setTenantKey(""); setOfrecerExtra(true); }}>Sí</button>
            <button type="button" className="btn ghost" onClick={() => { setTenantKey(""); setOfrecerExtra(false); }}>No</button>
          </div>
        </div>
      )}

      {duplicadoOtro && (
        <div style={{ padding: "10px 12px", border: "1px solid #fde68a", background: "#fffbeb", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#92400e" }}>
            Ya existe un Proveedor en CFO para este País/Tenant.
          </span>
          <button type="button" className="btn ghost" onClick={() => setTenantKey("")}>Entendido</button>
        </div>
      )}

      {!cargando && puedeOfrecerExtraHonduras && ofrecerExtra === null && !duplicadoHonduras && !duplicadoOtro && (
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", background: "#fff", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#334155" }}>
            Este proveedor es de Honduras. ¿Deseas crearlo también para {tenantsPendientesHonduras.map((k) => TENANTS_CFO.find((t) => t.key === k)?.label).join(" y ")}?
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn soft" onClick={() => setOfrecerExtra(true)}>Sí</button>
            <button type="button" className="btn ghost" onClick={() => setOfrecerExtra(false)}>No</button>
          </div>
        </div>
      )}

      {!cargando && puedeOfrecerExtraHonduras && ofrecerExtra === false && (
        <button type="button" className="btn ghost" onClick={() => setOfrecerExtra(true)} style={{ marginBottom: "16px" }}>
          + Crear para otro Tenant
        </button>
      )}

      {!cargando && mostrarFormulario && (
        <>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Autorizado por
            </label>
            <div style={{ padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
              {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "8px", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>País / Tenant *</label>
              <select
                value={tenantKey}
                onChange={(e) => setTenantKey(e.target.value)}
                disabled={creando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {opcionesTenant.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>¿Aplica Retención? *</label>
              <select
                value={aplicaRetencion}
                onChange={(e) => setAplicaRetencion(e.target.value)}
                disabled={creando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label>¿Proveedor Sujeto Excluido? *</label>
              <select
                value={sujetoExcluido}
                onChange={(e) => setSujetoExcluido(e.target.value)}
                disabled={creando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
              <div style={{ fontSize: "11px", color: "#a3acb9", marginTop: "4px" }}>Ventas gravadas</div>
            </div>
          </div>

          <button type="button" className="btn primary" onClick={handleCrear} disabled={!puedeCrear}>
            {creando ? "Creando..." : "Crear Proveedor en CFO"}
          </button>
          {ofrecerExtra === true && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => { setOfrecerExtra(false); setTenantKey(""); setAplicaRetencion(""); setSujetoExcluido(""); }}
              disabled={creando}
              style={{ marginLeft: "8px" }}
            >
              ← Regresar
            </button>
          )}
        </>
      )}
    </div>
  );
}

const OFICIAL_LABELS = {
  pago: { titulo: "Oficial de Pago", endpoint: "/asignarOficialDePagoProveedorCfo", idField: "OficialDePagoId" },
  solicitud: { titulo: "Oficial de Solicitud de Pago", endpoint: "/asignarOficialSolicitudDePagoProveedorCfo", idField: "OficialSolicitudDePagoId" },
};

// Sección aparte (no mezclada con la tarjeta "Proveedor en CFO") para asignar el Oficial de
// Pago y el Oficial de Solicitud de Pago de cada registro del Proveedor en CFO. Usa la misma
// lista de "existentes" que ya trajo el padre (con nombre de cada oficial, vía LEFT JOIN a
// Operador en el backend), así que no vuelve a consultarla por su cuenta.
function SeccionOficialesPagoCfo({ persona, existentes, cargando, onRecargar }) {
  const [buscandoOficialPara, setBuscandoOficialPara] = useState(null); // { proveedorId, tipo: 'pago' | 'solicitud' }
  const [nombreBusquedaOficial, setNombreBusquedaOficial] = useState("");
  const [resultadosOficial, setResultadosOficial] = useState(null);
  const [buscandoOficial, setBuscandoOficial] = useState(false);
  const [guardandoOficialId, setGuardandoOficialId] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const handleAbrirBusquedaOficial = (proveedorId, tipo) => {
    setBuscandoOficialPara({ proveedorId, tipo });
    setNombreBusquedaOficial("");
    setResultadosOficial(null);
  };

  const handleCerrarBusquedaOficial = () => {
    setBuscandoOficialPara(null);
    setNombreBusquedaOficial("");
    setResultadosOficial(null);
  };

  const handleBuscarOficial = async () => {
    const nombreTrim = nombreBusquedaOficial.trim();
    if (!nombreTrim) {
      showToast("Ingrese al menos el nombre del Operador para buscar", "warn");
      return;
    }
    setBuscandoOficial(true);
    setResultadosOficial(null);
    try {
      const resp = await apiFetch(`/buscarOperador`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Nombre: nombreTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar el Operador", "warn");
        setResultadosOficial([]);
        return;
      }
      setResultadosOficial(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setResultadosOficial([]);
    } finally {
      setBuscandoOficial(false);
    }
  };

  const handleAsignarOficial = async (operador) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const { proveedorId, tipo } = buscandoOficialPara;
    const info = OFICIAL_LABELS[tipo];
    if (!window.confirm(`¿Confirma asignar a "${operador.Nombre}" como ${info.titulo}?`)) {
      return;
    }
    setGuardandoOficialId(proveedorId);
    try {
      const resp = await apiFetch(info.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProveedorId: proveedorId, [info.idField]: operador.Id, ModifiedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || `Error al asignar el ${info.titulo}`, "warn");
        return;
      }
      showToast(data?.Message || `✓ ${info.titulo} asignado con éxito`, "ok");
      handleCerrarBusquedaOficial();
      await onRecargar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoOficialId(null);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={3} />Oficiales de Pago
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong>
      </div>

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Proveedor en CFO...</div>}

      {!cargando && existentes && existentes.length === 0 && (
        <div style={{ fontSize: "14px", color: "#697386" }}>
          Este proveedor todavía no tiene ningún registro en CFO. Primero créalo en la sección "Proveedor en CFO" para poder asignar Oficiales.
        </div>
      )}

      {!cargando && existentes && existentes.length > 0 && (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>País / Tenant</th>
                <th>Oficial de Pago</th>
                <th>Oficial Solicitud de Pago</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {existentes.map((e) => {
                const buscandoAqui = buscandoOficialPara?.proveedorId === e.Id;
                return (
                  <Fragment key={e.TenantKey}>
                  <tr>
                    <td>{e.Pais}</td>
                    <td>{e.OficialDePagoNombre || "— Sin asignar —"}</td>
                    <td>{e.OficialSolicitudDePagoNombre || "— Sin asignar —"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
                        <button
                          className="btn soft"
                          onClick={() => handleAbrirBusquedaOficial(e.Id, "pago")}
                          disabled={buscandoAqui}
                          style={{ padding: "4px 10px", fontSize: "12px", width: "220px" }}
                        >
                          {e.OficialDePagoNombre ? "Cambiar Oficial de Pago" : "Asignar Oficial de Pago"}
                        </button>
                        <button
                          className="btn soft"
                          onClick={() => handleAbrirBusquedaOficial(e.Id, "solicitud")}
                          disabled={buscandoAqui}
                          style={{ padding: "4px 10px", fontSize: "12px", width: "220px" }}
                        >
                          {e.OficialSolicitudDePagoNombre ? "Cambiar Oficial Solicitud de Pago" : "Asignar Oficial Solicitud de Pago"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {buscandoAqui && (
                    <tr>
                      <td colSpan={4} style={{ background: "#f8fafc" }}>
                        <div style={{ padding: "10px 4px" }}>
                          <div style={{ fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "8px" }}>
                            Buscar Operador para {OFICIAL_LABELS[buscandoOficialPara.tipo].titulo} ({e.Pais})
                          </div>
                          <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                            <input
                              type="text"
                              placeholder="Ingrese al menos el nombre del Operador"
                              value={nombreBusquedaOficial}
                              onChange={(ev) => setNombreBusquedaOficial(ev.target.value)}
                              onKeyDown={(ev) => { if (ev.key === "Enter") handleBuscarOficial(); }}
                              disabled={buscandoOficial}
                              style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                            />
                            <button type="button" className="btn soft" onClick={handleBuscarOficial} disabled={buscandoOficial}>
                              {buscandoOficial ? "Buscando..." : "Buscar"}
                            </button>
                            <button type="button" className="btn ghost" onClick={handleCerrarBusquedaOficial} disabled={guardandoOficialId === e.Id}>
                              Cancelar
                            </button>
                          </div>

                          {resultadosOficial && resultadosOficial.length === 0 && (
                            <div style={{ fontSize: "13px", color: "#697386" }}>No se encontraron Operadores con ese nombre.</div>
                          )}

                          {resultadosOficial && resultadosOficial.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {resultadosOficial.map((op) => (
                                <div key={op.Id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", background: "#fff", border: "1px solid #e3e8ee", borderRadius: "6px", padding: "8px 10px" }}>
                                  <span style={{ fontSize: "13px" }}>{op.Nombre}</span>
                                  <button
                                    type="button"
                                    className="btn soft"
                                    onClick={() => handleAsignarOficial(op)}
                                    disabled={guardandoOficialId === e.Id}
                                    style={{ padding: "4px 10px", fontSize: "12px" }}
                                  >
                                    {guardandoOficialId === e.Id ? "Asignando..." : "Usar este"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Paso 4: Sitios del Proveedor en CFO. A diferencia de Moneda/Oficiales (un solo valor por
// registro), un Proveedor puede tener varios Sitios a la vez, así que aquí no se "cambia" un
// valor sino que se van agregando de a uno.
function SeccionSitiosProveedorCfo({ persona, existentes, cargando, onRecargar }) {
  const [sitios, setSitios] = useState(null); // catálogo completo de Sitios: [{ Id, Nombre }]
  const [agregandoSitioPara, setAgregandoSitioPara] = useState(null); // proveedorId del registro donde se está agregando un Sitio
  const [textoSitio, setTextoSitio] = useState(""); // lo que el usuario va escribiendo
  const [sitioSeleccionado, setSitioSeleccionado] = useState(""); // Id, solo se llena al elegir una coincidencia de la lista
  const [guardandoSitioId, setGuardandoSitioId] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch(`/listarSitios`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) {
          showToast(data?.Message || "Error al listar los Sitios", "warn");
          setSitios([]);
          return;
        }
        setSitios(Array.isArray(data) ? data : []);
      } catch (error) {
        showToast("⚠️ Error de conexión con el servidor", "warn");
        setSitios([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAbrirAgregarSitio = (proveedorId) => {
    setAgregandoSitioPara(proveedorId);
    setTextoSitio("");
    setSitioSeleccionado("");
  };

  const handleCerrarAgregarSitio = () => {
    setAgregandoSitioPara(null);
    setTextoSitio("");
    setSitioSeleccionado("");
  };

  const handleAgregarSitio = async (proveedor) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!sitioSeleccionado) {
      showToast("Debe seleccionar un Sitio", "warn");
      return;
    }
    const sitio = (sitios || []).find((s) => s.Id === sitioSeleccionado);
    if (!window.confirm(`¿Confirma agregar el Sitio "${sitio?.Nombre}" a este Proveedor (${proveedor.Pais})?`)) {
      return;
    }
    setGuardandoSitioId(proveedor.Id);
    try {
      const resp = await apiFetch(`/agregarSitioProveedorCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProveedorId: proveedor.Id, SitioId: sitioSeleccionado, CreatedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al agregar el Sitio", "warn");
        return;
      }
      showToast(data?.Message || "✓ Sitio agregado con éxito", "ok");
      handleCerrarAgregarSitio();
      await onRecargar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoSitioId(null);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={4} />Sitios del Proveedor
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong>
      </div>

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Proveedor en CFO...</div>}

      {!cargando && existentes && existentes.length === 0 && (
        <div style={{ fontSize: "14px", color: "#697386" }}>
          Este proveedor todavía no tiene ningún registro en CFO. Primero créalo en el Paso 2 para poder agregarle Sitios.
        </div>
      )}

      {!cargando && existentes && existentes.length > 0 && (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>País / Tenant</th>
                <th>Sitios asignados</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {existentes.map((e) => {
                const agregandoAqui = agregandoSitioPara === e.Id;
                const sitiosYaAsignadosIds = new Set((e.Sitios || []).map((s) => s.Id));
                const opcionesSitio = (sitios || []).filter((s) => !sitiosYaAsignadosIds.has(s.Id));
                const textoTrim = textoSitio.trim().toLowerCase();
                const coincidencias = agregandoAqui && textoTrim
                  ? opcionesSitio.filter((s) => s.Nombre.toLowerCase().includes(textoTrim)).slice(0, 8)
                  : [];
                return (
                  <Fragment key={e.TenantKey}>
                  <tr>
                    <td>{e.Pais}</td>
                    <td>
                      {(e.Sitios && e.Sitios.length > 0)
                        ? e.Sitios.map((s) => s.Nombre).join(" · ")
                        : "— Sin asignar —"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn soft"
                        onClick={() => handleAbrirAgregarSitio(e.Id)}
                        disabled={agregandoAqui || !sitios}
                        style={{ padding: "4px 10px", fontSize: "12px" }}
                      >
                        + Agregar Sitio
                      </button>
                    </td>
                  </tr>
                  {agregandoAqui && (
                    <tr>
                      <td colSpan={3} style={{ background: "#f8fafc" }}>
                        <div style={{ padding: "10px 4px", display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: "240px", position: "relative" }}>
                            <input
                              type="text"
                              placeholder="Escriba el nombre del Sitio..."
                              value={textoSitio}
                              onChange={(ev) => { setTextoSitio(ev.target.value); setSitioSeleccionado(""); }}
                              disabled={guardandoSitioId === e.Id}
                              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                            />
                            {textoTrim && !sitioSeleccionado && (
                              coincidencias.length > 0 ? (
                                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
                                  {coincidencias.map((s) => (
                                    <div
                                      key={s.Id}
                                      onClick={() => { setSitioSeleccionado(s.Id); setTextoSitio(s.Nombre); }}
                                      style={{ padding: "8px 10px", cursor: "pointer", fontSize: "13px", borderBottom: "1px solid #f1f3f6" }}
                                    >
                                      {s.Nombre}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", marginTop: "4px", padding: "8px 10px", fontSize: "13px", color: "#991b1b" }}>
                                  El Sitio no existe.
                                </div>
                              )
                            )}
                          </div>
                          <button
                            type="button"
                            className="btn soft"
                            onClick={() => handleAgregarSitio(e)}
                            disabled={guardandoSitioId === e.Id || !sitioSeleccionado}
                          >
                            {guardandoSitioId === e.Id ? "Agregando..." : "Agregar"}
                          </button>
                          <button type="button" className="btn ghost" onClick={handleCerrarAgregarSitio} disabled={guardandoSitioId === e.Id}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Paso 5: Materiales del Proveedor en CFO. Cada Material se busca por Cuenta Mayor + Código ERP
// (que identifican un MaterialTenant del Tenant de este registro) y el Nombre que el usuario le
// da genera automáticamente el Código de Material (mismo algoritmo que la Referencia del
// Proveedor), así que si se repite el mismo Nombre para Honduras/Corporación Dinant/Dinant
// Exports, el código sale idéntico sin esfuerzo extra.
function SeccionMaterialesProveedorCfo({ persona, existentes, cargando, onRecargar }) {
  const [agregandoMaterialPara, setAgregandoMaterialPara] = useState(null); // proveedorId del registro donde se está agregando un Material
  const [materialesTenantCache, setMaterialesTenantCache] = useState({}); // tenantKey -> [{ Id, Descripcion, CuentaMayor, CodigoErpReembolso }] | "cargando"
  const [cuentaMayor, setCuentaMayor] = useState("");
  const [codigoErp, setCodigoErp] = useState("");
  const [materialTenant, setMaterialTenant] = useState(null); // objeto elegido de la lista (trae su propia Descripcion), o null si aún no elige
  const [guardandoMaterialId, setGuardandoMaterialId] = useState(null);
  // Si el Material no existe para ningún Tenant, se puede dar de alta en el catálogo (Material
  // Tenant) con solo la Cuenta Mayor + Código ERP que el usuario ya tiene, más una Descripción y
  // el País/Tenant al que pertenece.
  const [creandoMaterialTenant, setCreandoMaterialTenant] = useState(false);
  const [descripcionNuevoMaterialTenant, setDescripcionNuevoMaterialTenant] = useState("");
  const [tenantKeyNuevoMaterialTenant, setTenantKeyNuevoMaterialTenant] = useState("");
  const [guardandoMaterialTenant, setGuardandoMaterialTenant] = useState(false);
  // Tras crear un Material para Honduras, si el proveedor también tiene registro en Corporación
  // Dinant y/o Dinant Exports, se ofrece automáticamente replicarlo ahí (o agregar uno distinto).
  // Solo aplica a este trío de Tenants — el resto simplemente usa el botón "+ Agregar Material".
  const [propagarPara, setPropagarPara] = useState(null); // { descripcion, codigoMaterial, cuentaMayor, codigoErp, pendientes }
  const [respuestaPropagar, setRespuestaPropagar] = useState(null); // null = pregunta inicial, "no" = mostrar la segunda pregunta
  const [propagando, setPropagando] = useState(false);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const cargarMaterialesTenant = async (tenantKey) => {
    setMaterialesTenantCache((prev) => ({ ...prev, [tenantKey]: "cargando" }));
    try {
      const resp = await apiFetch(`/listarMaterialesTenant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TenantKey: tenantKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al listar los Materiales Tenant", "warn");
        // Se deja sin guardar (no [] ) para que el próximo intento vuelva a consultar en vez de
        // quedarse con una lista vacía "para siempre" cuando en realidad falló la carga.
        setMaterialesTenantCache((prev) => {
          const next = { ...prev };
          delete next[tenantKey];
          return next;
        });
        return [];
      }
      const lista = Array.isArray(data) ? data : [];
      setMaterialesTenantCache((prev) => ({ ...prev, [tenantKey]: lista }));
      return lista;
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setMaterialesTenantCache((prev) => {
        const next = { ...prev };
        delete next[tenantKey];
        return next;
      });
      return [];
    }
  };

  const handleAbrirAgregarMaterial = (proveedorId, tenantKey) => {
    setAgregandoMaterialPara(proveedorId);
    setCuentaMayor("");
    setCodigoErp("");
    setMaterialTenant(null);
    setPropagarPara(null);
    setRespuestaPropagar(null);
    if (materialesTenantCache[tenantKey] === undefined) cargarMaterialesTenant(tenantKey);
  };

  const handleCerrarAgregarMaterial = () => {
    setAgregandoMaterialPara(null);
    setCuentaMayor("");
    setCodigoErp("");
    setMaterialTenant(null);
    setCreandoMaterialTenant(false);
    setDescripcionNuevoMaterialTenant("");
    setTenantKeyNuevoMaterialTenant("");
  };

  const handleAbrirCrearMaterialTenant = (tenantKeyDefault) => {
    setCreandoMaterialTenant(true);
    setDescripcionNuevoMaterialTenant("");
    setTenantKeyNuevoMaterialTenant(tenantKeyDefault);
  };

  const handleCancelarCrearMaterialTenant = () => {
    setCreandoMaterialTenant(false);
    setDescripcionNuevoMaterialTenant("");
    setTenantKeyNuevoMaterialTenant("");
  };

  const handleCrearMaterialTenant = async () => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const cuentaMayorTrim = cuentaMayor.trim();
    const codigoErpTrim = codigoErp.trim();
    const descripcionTrim = descripcionNuevoMaterialTenant.trim();
    if (!cuentaMayorTrim || !codigoErpTrim) {
      showToast("La Cuenta Mayor y el Código ERP son requeridos", "warn");
      return;
    }
    if (!descripcionTrim) {
      showToast("La Descripción es requerida", "warn");
      return;
    }
    if (!tenantKeyNuevoMaterialTenant) {
      showToast("Debe seleccionar un País/Tenant", "warn");
      return;
    }
    const tenantLabel = TENANTS_CFO.find((t) => t.key === tenantKeyNuevoMaterialTenant)?.label;
    if (!window.confirm(
      `¿Confirma crear el Material Tenant "${descripcionTrim}" (Cuenta Mayor: ${cuentaMayorTrim} · Código ERP: ${codigoErpTrim}) para ${tenantLabel}?`
    )) {
      return;
    }
    setGuardandoMaterialTenant(true);
    try {
      const resp = await apiFetch(`/crearMaterialTenant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          CuentaMayor: cuentaMayorTrim,
          CodigoErp: codigoErpTrim,
          Descripcion: descripcionTrim,
          TenantKey: tenantKeyNuevoMaterialTenant,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Material Tenant", "warn");
        return;
      }
      showToast(data?.Message || "✓ Material Tenant creado con éxito", "ok");

      const nuevo = { Id: data.Id, Descripcion: data.Descripcion, CuentaMayor: data.CuentaMayor, CodigoErpReembolso: data.CodigoErpReembolso };
      setMaterialesTenantCache((prev) => {
        const listaPrevia = Array.isArray(prev[tenantKeyNuevoMaterialTenant]) ? prev[tenantKeyNuevoMaterialTenant] : [];
        return { ...prev, [tenantKeyNuevoMaterialTenant]: [...listaPrevia, nuevo] };
      });

      // Si se creó para el mismo Tenant de la fila con la que se está trabajando, se deja
      // seleccionado de una vez para poder crear el Material del Proveedor a continuación.
      const filaActual = existentes.find((x) => x.Id === agregandoMaterialPara);
      if (filaActual && tenantKeyNuevoMaterialTenant === filaActual.TenantKey) {
        setMaterialTenant(nuevo);
      }
      handleCancelarCrearMaterialTenant();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoMaterialTenant(false);
    }
  };

  const handleAgregarMaterial = async (proveedor) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    // La Descripcion no la escribe el usuario: se usa tal cual quedó registrada en el Material
    // Tenant (mismas mayúsculas/minúsculas), para que sea idéntica entre Honduras, Corporación
    // Dinant y Dinant Exports y el Código de Material generado también coincida.
    if (!materialTenant) return;
    const nombreTrim = materialTenant.Descripcion.trim();
    if (!window.confirm(
      `¿Confirma agregar el Material "${nombreTrim}" (Código: ${previsualizarReferencia(nombreTrim)}) a este Proveedor (${proveedor.Pais})?`
    )) {
      return;
    }
    setGuardandoMaterialId(proveedor.Id);
    try {
      const resp = await apiFetch(`/agregarMaterialProveedorCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaId: persona.id, MaterialTenantId: materialTenant.Id, Descripcion: nombreTrim, CreatedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al agregar el Material", "warn");
        return;
      }
      showToast(data?.Message || "✓ Material agregado con éxito", "ok");

      // Si este Material se creó para Honduras, y el proveedor también tiene registro en
      // Corporación Dinant y/o Dinant Exports sin este mismo Material todavía, se ofrece
      // replicarlo — únicamente para este trío de Tenants.
      if (proveedor.TenantKey === "honduras") {
        const codigoGenerado = previsualizarReferencia(nombreTrim);
        const pendientes = TENANTS_EXTRA_HONDURAS.filter((tk) => {
          const fila = existentes.find((x) => x.TenantKey === tk);
          if (!fila) return false;
          return !(fila.Materiales || []).some((m) => m.CodigoMaterial === codigoGenerado);
        });
        if (pendientes.length > 0) {
          setPropagarPara({
            descripcion: nombreTrim,
            codigoMaterial: codigoGenerado,
            cuentaMayor: materialTenant.CuentaMayor,
            codigoErp: materialTenant.CodigoErpReembolso,
            pendientes
          });
          setRespuestaPropagar(null);
        }
      }

      handleCerrarAgregarMaterial();
      await onRecargar();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoMaterialId(null);
    }
  };

  const handlePropagarSi = async () => {
    if (!propagarPara) return;
    setPropagando(true);
    const mensajes = [];
    try {
      for (const tenantKey of propagarPara.pendientes) {
        const filaDestino = existentes.find((x) => x.TenantKey === tenantKey);
        if (!filaDestino) continue;
        let lista = materialesTenantCache[tenantKey];
        if (!Array.isArray(lista)) lista = await cargarMaterialesTenant(tenantKey);
        // La Cuenta Mayor y el Código ERP deben coincidir, y la Descripcion registrada en ese
        // Tenant debe ser EXACTAMENTE igual (mismas mayúsculas/minúsculas) a la usada en
        // Honduras — si no, el Código de Material no saldría idéntico, así que se trata como
        // que el Material no existe para ese Tenant en vez de crear una versión distinta.
        const match = lista.find((m) =>
          (m.CuentaMayor || "") === propagarPara.cuentaMayor &&
          (m.CodigoErpReembolso || "") === propagarPara.codigoErp &&
          (m.Descripcion || "").trim() === propagarPara.descripcion
        );
        if (!match) {
          mensajes.push(`Material para el tenant de ${filaDestino.Pais} no existe.`);
          continue;
        }
        const resp = await apiFetch(`/agregarMaterialProveedorCfo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ PersonaId: persona.id, MaterialTenantId: match.Id, Descripcion: propagarPara.descripcion, CreatedBy: autorizador })
        });
        const data = await resp.json().catch(() => null);
        mensajes.push(!resp.ok ? `${filaDestino.Pais}: ${data?.Message || "no se pudo agregar"}` : `${filaDestino.Pais}: ✓ agregado`);
      }
      showToast(mensajes.join(" · "), mensajes.every((m) => m.includes("✓")) ? "ok" : "warn");
      await onRecargar();
    } finally {
      setPropagando(false);
      setPropagarPara(null);
      setRespuestaPropagar(null);
    }
  };

  const handleAgregarOtroDistinto = () => {
    if (!propagarPara) return;
    const primeraFilaPendiente = existentes.find((x) => x.TenantKey === propagarPara.pendientes[0]);
    setPropagarPara(null);
    setRespuestaPropagar(null);
    if (primeraFilaPendiente) handleAbrirAgregarMaterial(primeraFilaPendiente.Id, primeraFilaPendiente.TenantKey);
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={5} />Materiales del Proveedor
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong>
      </div>

      {propagarPara && respuestaPropagar === null && (
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", background: "#fff", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#334155" }}>
            ¿Deseas agregar el mismo Material "{propagarPara.descripcion}" al proveedor de {propagarPara.pendientes.map((tk) => TENANTS_CFO.find((t) => t.key === tk)?.label).join(" y ")}?
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn soft" onClick={handlePropagarSi} disabled={propagando}>{propagando ? "Agregando..." : "Sí"}</button>
            <button type="button" className="btn ghost" onClick={() => setRespuestaPropagar("no")} disabled={propagando}>No</button>
          </div>
        </div>
      )}

      {propagarPara && respuestaPropagar === "no" && (
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", background: "#fff", borderRadius: "6px", marginBottom: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "14px", color: "#334155" }}>
            ¿Deseas agregar otro Material distinto a {propagarPara.pendientes.map((tk) => TENANTS_CFO.find((t) => t.key === tk)?.label).join(" y ")}?
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="btn soft" onClick={handleAgregarOtroDistinto}>Sí</button>
            <button type="button" className="btn ghost" onClick={() => { setPropagarPara(null); setRespuestaPropagar(null); }}>No</button>
          </div>
        </div>
      )}

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Proveedor en CFO...</div>}

      {!cargando && existentes && existentes.length === 0 && (
        <div style={{ fontSize: "14px", color: "#697386" }}>
          Este proveedor todavía no tiene ningún registro en CFO. Primero créalo en el Paso 2 para poder agregarle Materiales.
        </div>
      )}

      {!cargando && existentes && existentes.length > 0 && (
        <div className="doc-table-wrap" style={{ maxHeight: "none" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>País / Tenant</th>
                <th>Materiales agregados</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {existentes.map((e) => {
                const agregandoAqui = agregandoMaterialPara === e.Id;
                return (
                  <Fragment key={e.TenantKey}>
                  <tr>
                    <td>{e.Pais}</td>
                    <td>
                      {(e.Materiales && e.Materiales.length > 0)
                        ? e.Materiales.map((m) => `${m.Descripcion} (${m.CodigoMaterial})`).join(" · ")
                        : "— Sin asignar —"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn soft"
                        onClick={() => handleAbrirAgregarMaterial(e.Id, e.TenantKey)}
                        disabled={agregandoAqui}
                        style={{ padding: "4px 10px", fontSize: "12px" }}
                      >
                        + Agregar Material
                      </button>
                    </td>
                  </tr>
                  {agregandoAqui && (() => {
                    const cache = materialesTenantCache[e.TenantKey];
                    const cargandoLista = cache === "cargando";
                    const listaTenant = Array.isArray(cache) ? cache : [];
                    const cuentaMayorTrim = cuentaMayor.trim().toLowerCase();
                    const codigoErpTrim = codigoErp.trim().toLowerCase();
                    const hayFiltro = cuentaMayorTrim || codigoErpTrim;
                    const coincidencias = hayFiltro
                      ? listaTenant.filter((m) =>
                          (!cuentaMayorTrim || (m.CuentaMayor || "").toLowerCase().includes(cuentaMayorTrim)) &&
                          (!codigoErpTrim || (m.CodigoErpReembolso || "").toLowerCase().includes(codigoErpTrim))
                        ).slice(0, 8)
                      : [];
                    return (
                      <tr>
                        <td colSpan={3} style={{ background: "#f8fafc" }}>
                          <div style={{ padding: "10px 4px" }}>
                            <div style={{ display: "flex", gap: "8px", marginBottom: "10px", alignItems: "flex-start", flexWrap: "wrap" }}>
                              <div style={{ flex: 1, minWidth: "320px", position: "relative" }}>
                                <div style={{ display: "flex", gap: "8px" }}>
                                  <input
                                    type="text"
                                    placeholder={cargandoLista ? "Cargando Materiales Tenant..." : "Cuenta Mayor"}
                                    value={cuentaMayor}
                                    onChange={(ev) => { setCuentaMayor(ev.target.value); setMaterialTenant(null); setCreandoMaterialTenant(false); }}
                                    disabled={cargandoLista || guardandoMaterialId === e.Id}
                                    style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                                  />
                                  <input
                                    type="text"
                                    placeholder="Código ERP"
                                    value={codigoErp}
                                    onChange={(ev) => { setCodigoErp(ev.target.value); setMaterialTenant(null); setCreandoMaterialTenant(false); }}
                                    disabled={cargandoLista || guardandoMaterialId === e.Id}
                                    style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                                  />
                                </div>
                                <div style={{ fontSize: "11px", color: "#a3acb9", marginTop: "4px" }}>
                                  {cargandoLista ? "Cargando catálogo..." : `${listaTenant.length} Materiales Tenant cargados para ${e.Pais}.`}
                                </div>
                                {hayFiltro && !materialTenant && coincidencias.length > 0 && (
                                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "240px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
                                    {coincidencias.map((m) => (
                                      <div
                                        key={m.Id}
                                        onClick={() => { setMaterialTenant(m); setCuentaMayor(m.CuentaMayor); setCodigoErp(m.CodigoErpReembolso); }}
                                        style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f1f3f6" }}
                                      >
                                        <div style={{ fontSize: "13px" }}>{m.Descripcion}</div>
                                        <div style={{ fontSize: "11px", color: "#a3acb9" }}>Cuenta Mayor: {m.CuentaMayor} · Código ERP: {m.CodigoErpReembolso}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button type="button" className="btn ghost" onClick={handleCerrarAgregarMaterial} disabled={guardandoMaterialId === e.Id}>
                                Cancelar
                              </button>
                            </div>

                            {hayFiltro && !materialTenant && coincidencias.length === 0 && !cargandoLista && (
                              <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", padding: "10px 12px", marginBottom: "10px" }}>
                                <div style={{ fontSize: "13px", color: "#991b1b", marginBottom: creandoMaterialTenant ? "10px" : 0 }}>
                                  Material para el tenant de {e.Pais} no existe.
                                </div>
                                {!creandoMaterialTenant ? (
                                  <button
                                    type="button"
                                    className="btn soft"
                                    onClick={() => handleAbrirCrearMaterialTenant(e.TenantKey)}
                                    disabled={!cuentaMayor.trim() || !codigoErp.trim()}
                                    style={{ padding: "4px 10px", fontSize: "12px" }}
                                  >
                                    + Crear Material Tenant nuevo
                                  </button>
                                ) : (
                                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                    <input
                                      type="text"
                                      placeholder="Descripción del Material"
                                      value={descripcionNuevoMaterialTenant}
                                      onChange={(ev) => setDescripcionNuevoMaterialTenant(ev.target.value)}
                                      disabled={guardandoMaterialTenant}
                                      style={{ flex: 1, minWidth: "200px", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                                    />
                                    <select
                                      value={tenantKeyNuevoMaterialTenant}
                                      onChange={(ev) => setTenantKeyNuevoMaterialTenant(ev.target.value)}
                                      disabled={guardandoMaterialTenant}
                                      style={{ boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                                    >
                                      <option value="">País / Tenant...</option>
                                      {TENANTS_CFO.map((t) => (
                                        <option key={t.key} value={t.key}>{t.label}</option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="btn primary"
                                      onClick={handleCrearMaterialTenant}
                                      disabled={guardandoMaterialTenant || !descripcionNuevoMaterialTenant.trim() || !tenantKeyNuevoMaterialTenant}
                                    >
                                      {guardandoMaterialTenant ? "Creando..." : "Crear Material Tenant"}
                                    </button>
                                    <button type="button" className="btn ghost" onClick={handleCancelarCrearMaterialTenant} disabled={guardandoMaterialTenant}>
                                      Cancelar
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {materialTenant && (
                              <>
                                <div style={{ fontSize: "13px", color: "#166534", marginBottom: "10px" }}>
                                  ✓ Registrado como: <strong>{materialTenant.Descripcion}</strong> (Cuenta Mayor: {materialTenant.CuentaMayor} · Código ERP: {materialTenant.CodigoErpReembolso})
                                </div>
                                <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "10px" }}>
                                  El Nombre no se puede editar: se usa tal cual está registrado (mismas mayúsculas/minúsculas), para que sea idéntico entre Honduras, Corporación Dinant y Dinant Exports.
                                </div>
                                <button
                                  type="button"
                                  className="btn primary"
                                  onClick={() => handleAgregarMaterial(e)}
                                  disabled={guardandoMaterialId === e.Id}
                                >
                                  {guardandoMaterialId === e.Id ? "Agregando..." : "Crear Material"}
                                </button>
                                <div style={{ fontSize: "11px", color: "#a3acb9", marginTop: "6px" }}>
                                  Código de Material autogenerado: <strong>{previsualizarReferencia(materialTenant.Descripcion) || "—"}</strong>
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Mismo catálogo que en el backend (MONEDAS_CUENTA_BANCO) — aquí el código de Moneda va como
// texto ("HNL", "USD"...) porque así lo espera el API de Personas, a diferencia de los valores
// numéricos que usa Proveedor/SetMoneda en CFO.
const MONEDAS_CUENTA_BANCO = [
  { key: "lempiras", label: "Lempiras (HNL)" },
  { key: "dolares", label: "Dólares (USD)" },
  { key: "cordobas", label: "Córdobas (NIO)" },
  { key: "colones", label: "Colones (CRC)" },
  { key: "quetzales", label: "Quetzales (GTQ)" },
];

const TIPOS_CUENTA_BANCO = [
  { key: "cheques", label: "Cheques" },
  { key: "ahorro", label: "Ahorro" },
];

const TIPO_PERSONA_DESTINO_CUENTA_BANCO = [
  { key: "proveedor", label: "Proveedor" },
  { key: "cliente", label: "Cliente" },
];

// Paso 6: Cuentas de Banco del Proveedor. A diferencia de Moneda/Oficiales/Sitios/Materiales
// (por Tenant/Proveedor en CFO), la Cuenta de Banco cuelga directo de la Persona — por eso esta
// sección no recibe "existentes" del padre, consulta por su cuenta con persona.id.
function SeccionCuentasBancoProveedor({ persona }) {
  const [cuentas, setCuentas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [numero, setNumero] = useState("");
  const [bancos, setBancos] = useState(null); // catálogo completo: [{ Id, Nombre, PaisDescripcion }]
  const [textoBanco, setTextoBanco] = useState("");
  const [bancoSeleccionado, setBancoSeleccionado] = useState(null);
  const [creandoBanco, setCreandoBanco] = useState(false);
  const [paisNuevoBanco, setPaisNuevoBanco] = useState("");
  const [guardandoBanco, setGuardandoBanco] = useState(false);
  const [tipoCuentaKey, setTipoCuentaKey] = useState("");
  const [monedaKey, setMonedaKey] = useState("");
  const [tipoPersonaDestinoKey, setTipoPersonaDestinoKey] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Edición de una Cuenta ya existente: Banco + Número (un método) y Tipo Persona Destino (otro
  // método) son endpoints separados en el API, pero se editan juntos en un solo formulario.
  const [editandoId, setEditandoId] = useState(null);
  const [editNumero, setEditNumero] = useState("");
  const [editTextoBanco, setEditTextoBanco] = useState("");
  const [editBancoSeleccionado, setEditBancoSeleccionado] = useState(null);
  const [editTipoPersonaDestinoKey, setEditTipoPersonaDestinoKey] = useState("");
  const [guardandoEdicionId, setGuardandoEdicionId] = useState(null);
  const [eliminandoId, setEliminandoId] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const showToast = useToast();

  const buscarCuentas = async (personaId) => {
    setCargando(true);
    setCuentas(null);
    try {
      const resp = await apiFetch(`/cuentasBancoPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaId: personaId })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al listar las Cuentas de Banco", "warn");
        setCuentas([]);
        return;
      }
      setCuentas(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setCuentas([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (persona?.id) buscarCuentas(persona.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id]);

  const cargarBancos = async () => {
    setBancos("cargando");
    try {
      const resp = await apiFetch(`/listarBancos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al listar los Bancos", "warn");
        setBancos(undefined);
        return;
      }
      setBancos(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setBancos(undefined);
    }
  };

  const handleAbrirAgregar = () => {
    setAgregando(true);
    setNumero("");
    setTextoBanco("");
    setBancoSeleccionado(null);
    setCreandoBanco(false);
    setPaisNuevoBanco("");
    setTipoCuentaKey("");
    setMonedaKey("");
    setTipoPersonaDestinoKey("");
    if (bancos === null) cargarBancos();
  };

  const handleCerrarAgregar = () => {
    setAgregando(false);
    setNumero("");
    setTextoBanco("");
    setBancoSeleccionado(null);
    setCreandoBanco(false);
    setPaisNuevoBanco("");
  };

  const listaBancos = Array.isArray(bancos) ? bancos : [];
  const cargandoBancos = bancos === "cargando";
  const textoBancoTrim = textoBanco.trim().toLowerCase();
  const coincidenciasBanco = textoBancoTrim
    ? listaBancos.filter((b) => b.Nombre.toLowerCase().includes(textoBancoTrim)).slice(0, 8)
    : [];

  const handleAbrirCrearBanco = () => {
    setCreandoBanco(true);
    setPaisNuevoBanco("");
  };

  const handleCrearBanco = async () => {
    const nombreTrim = textoBanco.trim();
    if (!nombreTrim) {
      showToast("Ingrese el nombre del Banco", "warn");
      return;
    }
    if (!paisNuevoBanco) {
      showToast("Debe seleccionar un País", "warn");
      return;
    }
    const paisLabel = PAISES.find((p) => p.key === paisNuevoBanco)?.label;
    if (!window.confirm(`¿Confirma crear el Banco "${nombreTrim}" (${paisLabel})?`)) {
      return;
    }
    setGuardandoBanco(true);
    try {
      const resp = await apiFetch(`/crearBanco`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Nombre: nombreTrim, PaisKey: paisNuevoBanco })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Banco", "warn");
        return;
      }
      showToast(data?.Message || "✓ Banco creado con éxito", "ok");
      const nuevo = { Id: data.Id, Nombre: data.Nombre, PaisDescripcion: data.PaisDescripcion };
      setBancos((prev) => (Array.isArray(prev) ? [...prev, nuevo] : [nuevo]));
      setBancoSeleccionado(nuevo);
      setTextoBanco(nuevo.Nombre);
      setCreandoBanco(false);
      setPaisNuevoBanco("");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoBanco(false);
    }
  };

  const puedeCrear = numero.trim() && bancoSeleccionado && tipoCuentaKey && monedaKey && tipoPersonaDestinoKey && autorizador && !guardando;

  const handleCrearCuenta = async () => {
    if (!puedeCrear) return;
    const tipoCuentaLabel = TIPOS_CUENTA_BANCO.find((t) => t.key === tipoCuentaKey)?.label;
    const monedaLabel = MONEDAS_CUENTA_BANCO.find((m) => m.key === monedaKey)?.label;
    const tipoPersonaLabel = TIPO_PERSONA_DESTINO_CUENTA_BANCO.find((t) => t.key === tipoPersonaDestinoKey)?.label;
    if (!window.confirm(
      `¿Confirma crear la Cuenta de Banco?\n\nProveedor: ${persona.nombre}\nNúmero: ${numero.trim()}\nBanco: ${bancoSeleccionado.Nombre}\nTipo de Cuenta: ${tipoCuentaLabel}\nMoneda: ${monedaLabel}\nTipo Persona Destino: ${tipoPersonaLabel}`
    )) {
      return;
    }
    setGuardando(true);
    try {
      const resp = await apiFetch(`/crearCuentaBancoPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Numero: numero.trim(),
          PersonaId: persona.id,
          BancoId: bancoSeleccionado.Id,
          BancoNombre: bancoSeleccionado.Nombre,
          TipoCuentaKey: tipoCuentaKey,
          MonedaKey: monedaKey,
          TipoPersonaDestinoKey: tipoPersonaDestinoKey,
          CreatedBy: autorizador
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear la Cuenta de Banco", "warn");
        return;
      }
      showToast(data?.Message || "✓ Cuenta de Banco creada con éxito", "ok");
      handleCerrarAgregar();
      await buscarCuentas(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardando(false);
    }
  };

  const handleIniciarEdicion = (c) => {
    setEditandoId(c.Id);
    setEditNumero(c.Numero);
    setEditTextoBanco(c.BancoNombre);
    setEditBancoSeleccionado({ Id: c.BancoId, Nombre: c.BancoNombre });
    setEditTipoPersonaDestinoKey(c.TipoPersonaDestino === "Proveedor" ? "proveedor" : c.TipoPersonaDestino === "Cliente" ? "cliente" : "");
    if (bancos === null) cargarBancos();
  };

  const handleCancelarEdicion = () => {
    setEditandoId(null);
    setEditNumero("");
    setEditTextoBanco("");
    setEditBancoSeleccionado(null);
    setEditTipoPersonaDestinoKey("");
  };

  const handleGuardarEdicion = async (c) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const numeroTrim = editNumero.trim();
    if (!numeroTrim || !editBancoSeleccionado || !editTipoPersonaDestinoKey) {
      showToast("Complete el Banco, Número y Tipo Persona Destino", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma guardar los cambios de esta Cuenta de Banco?`)) {
      return;
    }
    setGuardandoEdicionId(c.Id);
    try {
      const respBanco = await apiFetch(`/modificarCuentaBancoNumero`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: c.Id, BancoId: editBancoSeleccionado.Id, BancoNombre: editBancoSeleccionado.Nombre, Numero: numeroTrim, ModifiedBy: autorizador })
      });
      const dataBanco = await respBanco.json().catch(() => null);
      if (!respBanco.ok) {
        showToast(dataBanco?.Message || "Error al modificar el Banco/Número", "warn");
        return;
      }

      const respTipo = await apiFetch(`/modificarCuentaBancoTipoPersonaDestino`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: c.Id, TipoPersonaDestinoKey: editTipoPersonaDestinoKey, ModifiedBy: autorizador })
      });
      const dataTipo = await respTipo.json().catch(() => null);
      if (!respTipo.ok) {
        showToast(dataTipo?.Message || "Error al modificar el Tipo Persona Destino", "warn");
        return;
      }

      showToast("✓ Cuenta de Banco modificada con éxito", "ok");
      handleCancelarEdicion();
      await buscarCuentas(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardandoEdicionId(null);
    }
  };

  const handleEliminar = async (c) => {
    if (!autorizador) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma eliminar la Cuenta de Banco "${c.Numero}" (${c.BancoNombre})? Esta acción no se puede deshacer.`)) {
      return;
    }
    setEliminandoId(c.Id);
    try {
      const resp = await apiFetch(`/eliminarCuentaBancoPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Id: c.Id, ModifiedBy: autorizador })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar la Cuenta de Banco", "warn");
        return;
      }
      showToast(data?.Message || "✓ Cuenta de Banco eliminada con éxito", "ok");
      await buscarCuentas(persona.id);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={6} />Cuentas de Banco del Proveedor
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Proveedor: <strong>{persona.nombre}</strong>
      </div>

      {cargando && <div style={{ fontSize: "14px", color: "#697386" }}>Buscando Cuentas de Banco...</div>}

      {!cargando && cuentas && cuentas.length > 0 && (
        <div className="doc-table-wrap" style={{ maxHeight: "none", marginBottom: "16px" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Número</th>
                <th>Banco</th>
                <th>Tipo de Cuenta</th>
                <th>Moneda</th>
                <th>Tipo Persona Destino</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => {
                const enEdicion = editandoId === c.Id;
                const editTextoBancoTrim = editTextoBanco.trim().toLowerCase();
                const editCoincidenciasBanco = enEdicion && editTextoBancoTrim && !editBancoSeleccionado
                  ? listaBancos.filter((b) => b.Nombre.toLowerCase().includes(editTextoBancoTrim)).slice(0, 8)
                  : [];
                return (
                  <tr key={c.Id}>
                    {enEdicion ? (
                      <>
                        <td>
                          <input
                            type="text"
                            value={editNumero}
                            onChange={(ev) => setEditNumero(ev.target.value)}
                            disabled={guardandoEdicionId === c.Id}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                          />
                        </td>
                        <td style={{ position: "relative" }}>
                          <input
                            type="text"
                            value={editTextoBanco}
                            onChange={(ev) => { setEditTextoBanco(ev.target.value); setEditBancoSeleccionado(null); }}
                            disabled={cargandoBancos || guardandoEdicionId === c.Id}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
                          />
                          {editCoincidenciasBanco.length > 0 && (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "200px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
                              {editCoincidenciasBanco.map((b) => (
                                <div
                                  key={b.Id}
                                  onClick={() => { setEditBancoSeleccionado(b); setEditTextoBanco(b.Nombre); }}
                                  style={{ padding: "6px 8px", cursor: "pointer", fontSize: "12px", borderBottom: "1px solid #f1f3f6" }}
                                >
                                  {b.Nombre}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>{c.TipoCuentaDescripcion}</td>
                        <td>{c.Moneda}</td>
                        <td>
                          <select
                            value={editTipoPersonaDestinoKey}
                            onChange={(ev) => setEditTipoPersonaDestinoKey(ev.target.value)}
                            disabled={guardandoEdicionId === c.Id}
                            style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                          >
                            <option value="">Seleccione...</option>
                            {TIPO_PERSONA_DESTINO_CUENTA_BANCO.map((t) => (
                              <option key={t.key} value={t.key}>{t.label}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn primary"
                            onClick={() => handleGuardarEdicion(c)}
                            disabled={guardandoEdicionId === c.Id}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            {guardandoEdicionId === c.Id ? "Guardando..." : "Guardar"}
                          </button>
                          <button
                            className="btn ghost"
                            onClick={handleCancelarEdicion}
                            disabled={guardandoEdicionId === c.Id}
                            style={{ padding: "4px 10px", fontSize: "12px", marginLeft: "6px" }}
                          >
                            Cancelar
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{c.Numero}</td>
                        <td>{c.BancoNombre}</td>
                        <td>{c.TipoCuentaDescripcion}</td>
                        <td>{c.Moneda}</td>
                        <td>{c.TipoPersonaDestino}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn soft"
                            onClick={() => handleIniciarEdicion(c)}
                            disabled={eliminandoId === c.Id}
                            style={{ padding: "4px 10px", fontSize: "12px" }}
                          >
                            Editar
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => handleEliminar(c)}
                            disabled={eliminandoId === c.Id}
                            style={{ padding: "4px 10px", fontSize: "12px", marginLeft: "6px" }}
                          >
                            {eliminandoId === c.Id ? "Eliminando..." : "Eliminar"}
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

      {!cargando && cuentas && cuentas.length === 0 && !agregando && (
        <div style={{ fontSize: "14px", color: "#697386", marginBottom: "16px" }}>
          Este proveedor aún no tiene Cuentas de Banco registradas.
        </div>
      )}

      {!cargando && !agregando && (
        <button type="button" className="btn soft" onClick={handleAbrirAgregar}>
          + Agregar Cuenta de Banco
        </button>
      )}

      {agregando && (
        <>
          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Autorizado por
            </label>
            <div style={{ padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
              {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "8px" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Número de Cuenta *</label>
              <input
                type="text"
                placeholder="Ingrese el número de cuenta"
                value={numero}
                onChange={(ev) => setNumero(ev.target.value)}
                disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, position: "relative" }}>
              <label>Banco *</label>
              <input
                type="text"
                placeholder={cargandoBancos ? "Cargando Bancos..." : "Escriba el nombre del Banco..."}
                value={textoBanco}
                onChange={(ev) => { setTextoBanco(ev.target.value); setBancoSeleccionado(null); setCreandoBanco(false); }}
                disabled={cargandoBancos || guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              {textoBancoTrim && !bancoSeleccionado && (
                coincidenciasBanco.length > 0 ? (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
                    {coincidenciasBanco.map((b) => (
                      <div
                        key={b.Id}
                        onClick={() => { setBancoSeleccionado(b); setTextoBanco(b.Nombre); }}
                        style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f1f3f6" }}
                      >
                        <div style={{ fontSize: "13px" }}>{b.Nombre}</div>
                        <div style={{ fontSize: "11px", color: "#a3acb9" }}>{b.PaisDescripcion}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", marginTop: "4px", padding: "8px 10px" }}>
                    <div style={{ fontSize: "13px", color: "#991b1b", marginBottom: creandoBanco ? "10px" : 0 }}>
                      El Banco que desea ingresar no existe, ¿deseas crear un nuevo banco?
                    </div>
                    {!creandoBanco ? (
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button type="button" className="btn soft" onClick={handleAbrirCrearBanco} style={{ padding: "4px 10px", fontSize: "12px" }}>Sí</button>
                        <button type="button" className="btn ghost" onClick={() => setTextoBanco("")} style={{ padding: "4px 10px", fontSize: "12px" }}>No</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <select
                          value={paisNuevoBanco}
                          onChange={(ev) => setPaisNuevoBanco(ev.target.value)}
                          disabled={guardandoBanco}
                          style={{ flex: 1, minWidth: "160px", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff" }}
                        >
                          <option value="">País...</option>
                          {PAISES.map((p) => (
                            <option key={p.key} value={p.key}>{p.label}</option>
                          ))}
                        </select>
                        <button type="button" className="btn primary" onClick={handleCrearBanco} disabled={guardandoBanco || !paisNuevoBanco} style={{ padding: "4px 10px", fontSize: "12px" }}>
                          {guardandoBanco ? "Creando..." : `Crear Banco "${textoBanco.trim()}"`}
                        </button>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Tipo de Cuenta *</label>
              <select
                value={tipoCuentaKey}
                onChange={(ev) => setTipoCuentaKey(ev.target.value)}
                disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {TIPOS_CUENTA_BANCO.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Moneda *</label>
              <select
                value={monedaKey}
                onChange={(ev) => setMonedaKey(ev.target.value)}
                disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {MONEDAS_CUENTA_BANCO.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>¿Proveedor o Cliente? *</label>
              <select
                value={tipoPersonaDestinoKey}
                onChange={(ev) => setTipoPersonaDestinoKey(ev.target.value)}
                disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {TIPO_PERSONA_DESTINO_CUENTA_BANCO.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="button" className="btn primary" onClick={handleCrearCuenta} disabled={!puedeCrear}>
            {guardando ? "Creando..." : "Crear Cuenta de Banco"}
          </button>
          <button type="button" className="btn ghost" onClick={handleCerrarAgregar} disabled={guardando} style={{ marginLeft: "8px" }}>
            Cancelar
          </button>
        </>
      )}
    </div>
  );
}

// El "Proveedor: NOMBRE ... Cambiar proveedor" y el resultado de la creación viven en el
// componente padre (personaTrabajo/resultado son props) para poder mostrarlos a la par del
// selector "¿Qué desea crear?" en vez de debajo de él.
function FormularioProveedor({ personaTrabajo, setPersonaTrabajo, resultado, setResultado }) {
  const [nombre, setNombre] = useState("");
  const [idFiscal, setIdFiscal] = useState("");
  const [paisKey, setPaisKey] = useState("");
  const [presentoComprobante, setPresentoComprobante] = useState("");
  const [validando, setValidando] = useState(false);
  const [validacion, setValidacion] = useState(null); // { nombre, idFiscal, existe, matches }
  const [creando, setCreando] = useState(false);
  // Registros del Proveedor en CFO (uno por Tenant): se cargan aquí, no dentro de cada sección,
  // para que "Proveedor en CFO" y "Oficiales de Pago" siempre vean los mismos datos.
  const [existentesCfo, setExistentesCfo] = useState(null);
  const [cargandoCfo, setCargandoCfo] = useState(false);
  const showToast = useToast();

  const nombreTrim = nombre.trim();
  const idFiscalTrim = idFiscal.trim();
  const necesitaValidar = !validacion || validacion.nombre !== nombreTrim || validacion.idFiscal !== idFiscalTrim;

  // Si "Cambiar proveedor" se dispara desde el padre (junto al selector), aquí se limpian los
  // campos de búsqueda locales para que la tarjeta de validación vuelva a aparecer en blanco.
  useEffect(() => {
    if (!personaTrabajo) {
      setNombre("");
      setIdFiscal("");
      setValidacion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaTrabajo]);

  const buscarExistentesCfo = async (personaId) => {
    setCargandoCfo(true);
    setExistentesCfo(null);
    try {
      const resp = await apiFetch(`/proveedoresCfoPorPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaId: personaId })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al validar Proveedor en CFO", "warn");
        setExistentesCfo([]);
        return;
      }
      setExistentesCfo(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setExistentesCfo([]);
    } finally {
      setCargandoCfo(false);
    }
  };

  useEffect(() => {
    if (personaTrabajo?.id) buscarExistentesCfo(personaTrabajo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaTrabajo?.id]);

  const handleValidar = async () => {
    if (!nombreTrim || !idFiscalTrim) {
      showToast("El Nombre y el ID Fiscal son obligatorios para validar", "warn");
      return;
    }
    setValidando(true);
    setResultado(null);
    setPersonaTrabajo(null);
    try {
      const resp = await apiFetch(`/personaExistente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "proveedor", nombre: nombreTrim, idFiscal: idFiscalTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al validar en Personas", "warn");
        return;
      }
      const matches = Array.isArray(data) ? data : [];
      setValidacion({ nombre: nombreTrim, idFiscal: idFiscalTrim, existe: matches.length > 0, matches });
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setValidando(false);
    }
  };

  const handleLimpiar = () => {
    setNombre("");
    setIdFiscal("");
    setPaisKey("");
    setPresentoComprobante("");
    setValidacion(null);
    setResultado(null);
    setPersonaTrabajo(null);
  };

  const puedeCrear = !necesitaValidar && validacion?.existe === false && nombreTrim && idFiscalTrim && paisKey && presentoComprobante !== "";

  const handleCrear = async () => {
    if (!puedeCrear) return;
    const paisLabel = PAISES.find((p) => p.key === paisKey)?.label || paisKey;
    if (!window.confirm(
      `¿Confirma crear el Proveedor "${nombreTrim}"?\n\nID Fiscal: ${idFiscalTrim}\nPaís: ${paisLabel}\nPresentó comprobante de pagos: ${presentoComprobante === "si" ? "Sí" : "No"}\nReferencia: ${previsualizarReferencia(nombreTrim)}`
    )) {
      return;
    }
    setCreando(true);
    setResultado(null);
    setPersonaTrabajo(null);
    try {
      const resp = await apiFetch(`/crearProveedor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Nombre: nombreTrim,
          IdFiscal: idFiscalTrim,
          PaisKey: paisKey,
          PresentoComprobantePagos: presentoComprobante === "si"
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Proveedor", "warn");
        return;
      }
      showToast(data?.Message || "✓ Proveedor creado con éxito", "ok");
      setResultado({ nombre: nombreTrim, idFiscal: idFiscalTrim, pais: paisLabel, referencia: data?.Referencia });
      if (data?.PersonaId) {
        setPersonaTrabajo({ id: data.PersonaId, nombre: nombreTrim, idFiscal: idFiscalTrim });
      }
      setNombre("");
      setIdFiscal("");
      setPaisKey("");
      setPresentoComprobante("");
      setValidacion(null);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <>
      {!personaTrabajo && (
        <>
          <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div className="field">
                <label>Nombre *</label>
                <input
                  type="text"
                  placeholder="Ingrese nombre del proveedor"
                  value={nombre}
                  onChange={(e) => { setNombre(e.target.value); setValidacion(null); }}
                  disabled={validando || creando}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                />
              </div>
              <div className="field">
                <label>ID Fiscal *</label>
                <input
                  type="text"
                  placeholder="Ingrese RTN o NIT"
                  value={idFiscal}
                  onChange={(e) => { setIdFiscal(e.target.value); setValidacion(null); }}
                  disabled={validando || creando}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button type="button" className="btn soft" onClick={handleValidar} disabled={validando || creando || !nombreTrim || !idFiscalTrim}>
                {validando ? "Validando..." : "Validar en Personas"}
              </button>
              <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={validando || creando}>
                Limpiar
              </button>
            </div>

            {validacion && (
              <div style={{ marginTop: "14px" }}>
                {validacion.existe ? (
                  <div style={{ padding: "10px 12px", border: "1px solid #fca5a5", background: "#fef2f2", borderRadius: "6px", fontSize: "14px", color: "#991b1b" }}>
                    <div style={{ fontWeight: "700" }}>⚠️ Proveedor ya existe</div>
                    <div style={{ fontWeight: "400", marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {validacion.matches.map((m) => (
                        <div key={m.Id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", background: "#fff", border: "1px solid #fecaca", borderRadius: "6px", padding: "8px 10px" }}>
                          <span>{m.Nombre} (ID Fiscal: {m.IdFiscal})</span>
                          <button
                            type="button"
                            className="btn soft"
                            onClick={() => setPersonaTrabajo({ id: m.Id, nombre: m.Nombre, idFiscal: m.IdFiscal })}
                          >
                            Usar este proveedor
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "10px 12px", border: "1px solid #86efac", background: "#f0fdf4", borderRadius: "6px", fontSize: "14px", color: "#166534", fontWeight: "700" }}>
                    ✓ No existe — se puede crear
                  </div>
                )}
              </div>
            )}
          </div>

          {validacion?.existe === false && !necesitaValidar && (
            <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                <div className="field">
                  <label>País *</label>
                  <select
                    value={paisKey}
                    onChange={(e) => setPaisKey(e.target.value)}
                    disabled={creando}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                  >
                    <option value="">Seleccione...</option>
                    {PAISES.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>¿Presentó comprobante de pagos? *</label>
                  <select
                    value={presentoComprobante}
                    onChange={(e) => setPresentoComprobante(e.target.value)}
                    disabled={creando}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                  >
                    <option value="">Seleccione...</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>

              <div style={{ fontSize: "12px", color: "#a3acb9", marginBottom: "14px" }}>
                Razón Social: <strong>{nombreTrim || "—"}</strong> · Referencia autogenerada: <strong>{previsualizarReferencia(nombreTrim) || "—"}</strong>
              </div>

              <button type="button" className="btn primary" onClick={handleCrear} disabled={!puedeCrear || creando}>
                {creando ? "Creando..." : "Crear Proveedor"}
              </button>
            </div>
          )}

          {resultado && (
            <div style={{ border: "1px solid #d1fae5", background: "#f0fdf9", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#065f46", marginBottom: "10px" }}>
                ✓ Proveedor creado
              </div>
              <div className="doc-table-wrap" style={{ border: "none", boxShadow: "none", borderRadius: 0, maxHeight: "none" }}>
              <table className="doc-table" style={{ width: "100%" }}>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155", width: "180px" }}>Nombre</td>
                    <td>{resultado.nombre}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155" }}>ID Fiscal</td>
                    <td>{resultado.idFiscal}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155" }}>País</td>
                    <td>{resultado.pais}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155" }}>Referencia</td>
                    <td>{resultado.referencia}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {personaTrabajo && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <SeccionCodigoErp persona={personaTrabajo} />
          <SeccionProveedorCfo
            persona={personaTrabajo}
            existentes={existentesCfo}
            cargando={cargandoCfo}
            onRecargar={() => buscarExistentesCfo(personaTrabajo.id)}
          />
          <SeccionOficialesPagoCfo
            persona={personaTrabajo}
            existentes={existentesCfo}
            cargando={cargandoCfo}
            onRecargar={() => buscarExistentesCfo(personaTrabajo.id)}
          />
          <SeccionSitiosProveedorCfo
            persona={personaTrabajo}
            existentes={existentesCfo}
            cargando={cargandoCfo}
            onRecargar={() => buscarExistentesCfo(personaTrabajo.id)}
          />
          <SeccionMaterialesProveedorCfo
            persona={personaTrabajo}
            existentes={existentesCfo}
            cargando={cargandoCfo}
            onRecargar={() => buscarExistentesCfo(personaTrabajo.id)}
          />
          <SeccionCuentasBancoProveedor persona={personaTrabajo} />
        </div>
      )}
    </>
  );
}

export default function CrearProveedorCliente() {
  const [tipo, setTipo] = useState("");
  // Viven aquí (no dentro de FormularioProveedor) para poder mostrar la barra "Proveedor: ...
  // Cambiar proveedor" a la par del selector "¿Qué desea crear?" en vez de debajo.
  const [personaTrabajo, setPersonaTrabajo] = useState(null); // { id, nombre, idFiscal }
  const [resultado, setResultado] = useState(null);

  const handleCambiarTipo = (nuevoTipo) => {
    setTipo(nuevoTipo);
    setPersonaTrabajo(null);
    setResultado(null);
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "1600px" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "12px", marginBottom: "16px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "20px", alignItems: "start", marginBottom: "12px" }}>
        <div style={{ background: "#f8f9fa", padding: "14px 20px", borderRadius: "8px", border: "1px solid #e3e8ee" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>¿Qué desea crear?</label>
            <select
              value={tipo}
              onChange={(e) => handleCambiarTipo(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
            >
              <option value="">Seleccione una opción...</option>
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {tipo === "proveedor" && personaTrabajo && (
          <div style={{ background: "#f0fdf9", padding: "14px 20px", borderRadius: "8px", border: "1px solid #d1fae5", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "14px", color: "#065f46" }}>
              {resultado ? "✓ Proveedor creado — " : "Proveedor: "}
              <strong>{personaTrabajo.nombre}</strong> (ID Fiscal: {personaTrabajo.idFiscal}
              {resultado?.referencia ? `, Referencia: ${resultado.referencia}` : ""})
            </div>
            <button type="button" className="btn ghost" onClick={() => { setPersonaTrabajo(null); setResultado(null); }}>
              Cambiar proveedor
            </button>
          </div>
        )}
      </div>

      {tipo === "proveedor" && (
        <FormularioProveedor
          personaTrabajo={personaTrabajo}
          setPersonaTrabajo={setPersonaTrabajo}
          resultado={resultado}
          setResultado={setResultado}
        />
      )}

      {tipo === "cliente" && (
        <div style={{ border: "1px dashed #cbd5e1", borderRadius: "8px", padding: "20px", color: "#697386", fontSize: "14px" }}>
          Formulario de Cliente pendiente de definir (campos y endpoint de creación).
        </div>
      )}
    </div>
  );
}
