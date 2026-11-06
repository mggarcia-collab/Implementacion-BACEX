import { useState, Fragment } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Materiales en Negociación",
  icon: "🧩",
  desc: "Revisar los Materiales Variables y Fijos configurados en una Negociación (solo Administradores)",
  kind: "primary",
};

function parseReferencias(texto) {
  return [...new Set((texto || "").split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean))];
}

function formatoMonto(valor) {
  if (valor === null || valor === undefined) return "—";
  return Number(valor).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatoFecha(valor) {
  if (!valor) return "—";
  return String(valor).slice(0, 10);
}

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

// Tabla de Hojas de Ruta (= Referencia Operativa) paginada de 5 en 5, con scroll, para no
// cargar la pantalla cuando un Componente se reutiliza en muchas (se vio un caso con 5000+).
// Incluye un buscador por Referencia Operativa que filtra sobre las ya cargadas, para ir
// localizando rápido si una Hoja de Ruta puntual está Activa o Eliminada.
function TablaHojasDeRutaPaginada({ hojasDeRuta }) {
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState("");
  const porPagina = 5;

  const filtroNormalizado = filtro.trim().toUpperCase();
  const filtradas = filtroNormalizado
    ? hojasDeRuta.filter((h) => h.ReferenciaOperativa.toUpperCase().includes(filtroNormalizado))
    : hojasDeRuta;

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaActual = Math.min(pagina, totalPaginas);
  const inicio = (paginaActual - 1) * porPagina;
  const pageItems = filtradas.slice(inicio, inicio + porPagina);

  return (
    <div>
      <input
        type="text"
        placeholder="Buscar Referencia Operativa..."
        value={filtro}
        onChange={(e) => { setFiltro(e.target.value); setPagina(1); }}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", marginBottom: "10px" }}
      />
      <div className="doc-table-wrap" style={{ maxHeight: "220px" }}>
        <table className="doc-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Hoja de Ruta (Referencia Operativa)</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr><td colSpan={2} style={{ color: "#697386" }}>Ninguna Hoja de Ruta coincide con "{filtro}".</td></tr>
            ) : pageItems.map((h) => (
              <tr key={h.ReferenciaOperativa}>
                <td>{h.ReferenciaOperativa}</td>
                <td>{h.Eliminada ? <span style={{ color: "#b42318" }}>Eliminada</span> : <span style={{ color: "#166534" }}>Activa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
        <button className="btn ghost" type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaActual === 1} style={{ padding: "4px 12px", fontSize: "12px" }}>
          ← Anterior
        </button>
        <span style={{ fontSize: "12px", color: "#697386" }}>Página {paginaActual} de {totalPaginas} ({filtradas.length} en total)</span>
        <button className="btn ghost" type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaActual === totalPaginas} style={{ padding: "4px 12px", fontSize: "12px" }}>
          Siguiente →
        </button>
      </div>
    </div>
  );
}

// Anchos compartidos entre Materiales Variables y Fijos (mismas columnas, mismo orden) para
// que ambas tablas queden alineadas visualmente una debajo de la otra.
const ANCHOS_COLUMNAS_MATERIALES = ["22%", "11%", "11%", "11%", "9%", "16%", "12%", "8%"];

// Las Escalas (MaterialVariableValorEscala) solo aplican a Materiales Variables, no a Fijos.
const OPERADORES_ESCALA = [">=", ">", "=", "<=", "<"];
// Ordinal entero que espera Azure (confirmado contra su Swagger: Cfo.App.Domain.Enums.TipoDeCalculo).
const TIPOS_DE_CALCULO = [
  { value: 1, label: "Valor Fijo" },
  { value: 2, label: "Multiplicación" },
  { value: 0, label: "No Aplica" },
];

// Formulario para agregar un tramo de Escala a un MaterialVariableValor ya creado. El Id llega
// siempre por prop -- ya sea recién creado (AgregarMaterial) o de un Material Variable ya
// configurado (TablaMaterialesVariables) -- nunca se pide a mano. AplicaTasaCambio siempre va
// en true (decisión del negocio), no es editable.
function FormularioEscala({ materialVariableValorId, nombreMaterial, onAgregada, onCerrar }) {
  const [operador, setOperador] = useState(">=");
  const [cota, setCota] = useState("");
  const [valor, setValor] = useState("");
  const [orden, setOrden] = useState("1");
  const [tipoDeCalculo, setTipoDeCalculo] = useState("1");
  const [guardando, setGuardando] = useState(false);
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  const handleAgregar = async () => {
    if (cota.trim() === "" || valor.trim() === "") {
      showToast("Ingrese Cota y Valor", "warn");
      return;
    }
    if (!autorizador?.id) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    setGuardando(true);
    try {
      const resp = await apiFetch(`/materialesNegCrearEscala`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          MaterialVariableValorId: materialVariableValorId,
          Operador: operador,
          Cota: Number(cota),
          Valor: Number(valor),
          Orden: Number(orden) || 0,
          TipoDeCalculo: Number(tipoDeCalculo),
          CreatedBy: autorizador.id
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al agregar la Escala", "warn");
        return;
      }
      showToast(data?.Message || "✓ Escala agregada con éxito", "ok");
      setCota("");
      setValor("");
      setOrden(String((Number(orden) || 0) + 1));
      onAgregada?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{ background: "#f5f3ff", border: "1px dashed #a78bfa", borderRadius: "8px", padding: "14px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "10px" }}>
        + Agregar Escala{nombreMaterial ? ` — ${nombreMaterial}` : ""}
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ width: "100px" }}>
          <label>Operador</label>
          <select value={operador} onChange={(e) => setOperador(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}>
            {OPERADORES_ESCALA.map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: "130px" }}>
          <label>Cota</label>
          <input type="number" step="0.01" value={cota} onChange={(e) => setCota(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ width: "130px" }}>
          <label>Valor</label>
          <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ width: "90px" }}>
          <label>Orden</label>
          <input type="number" step="1" value={orden} onChange={(e) => setOrden(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ width: "160px" }}>
          <label>Tipo de Cálculo</label>
          <select value={tipoDeCalculo} onChange={(e) => setTipoDeCalculo(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}>
            {TIPOS_DE_CALCULO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: "10px", fontSize: "12px", color: autorizador ? "#4f5b66" : "#b42318" }}>
        Autoriza: {autorizador?.name || "Tu usuario no está habilitado como autorizador"}
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
        <button className="btn primary" type="button" onClick={handleAgregar} disabled={guardando}>
          {guardando ? "Agregando..." : "Agregar Escala"}
        </button>
        {onCerrar && (
          <button className="btn ghost" type="button" onClick={onCerrar} disabled={guardando}>
            Terminar
          </button>
        )}
      </div>
    </div>
  );
}

// Si se pasa onEliminados, agrega casillas de selección y un botón para eliminar uno o varios
// Materiales Variables a la vez (DeleteMaterialVariableValorList), borrando de paso sus Escalas
// (el servidor ya se encarga de encontrarlas y eliminarlas primero).
function TablaMaterialesVariables({ filas, onEliminados }) {
  const [escalaAbierta, setEscalaAbierta] = useState(null);
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  if (filas.length === 0) {
    return <p style={{ fontSize: "13px", color: "#697386" }}>No hay Materiales Variables configurados.</p>;
  }

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleEliminar = async () => {
    if (!autorizador?.id) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const ids = [...seleccionados];
    setEliminando(true);
    try {
      const resp = await apiFetch(`/materialesNegEliminarVariables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, modifiedBy: autorizador.id })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar los Materiales", "warn");
        return;
      }
      showToast(data?.Message || "✓ Materiales eliminados con éxito", "ok");
      setSeleccionados(new Set());
      setConfirmando(false);
      onEliminados?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      {onEliminados && seleccionados.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          {!confirmando ? (
            <button className="btn danger" type="button" style={{ padding: "6px 14px", fontSize: "12px" }} onClick={() => setConfirmando(true)}>
              Eliminar {seleccionados.size} Material{seleccionados.size !== 1 ? "es" : ""} seleccionado{seleccionados.size !== 1 ? "s" : ""}
            </button>
          ) : (
            <>
              <span style={{ fontSize: "12px", color: "#b42318" }}>
                ¿Confirmar? También se eliminarán sus Escalas asociadas.
              </span>
              <button className="btn danger" type="button" disabled={eliminando} onClick={handleEliminar} style={{ padding: "6px 14px", fontSize: "12px" }}>
                {eliminando ? "Eliminando..." : "Sí, eliminar"}
              </button>
              <button className="btn ghost" type="button" disabled={eliminando} onClick={() => setConfirmando(false)} style={{ padding: "6px 14px", fontSize: "12px" }}>
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
      <div className="doc-table-wrap" style={{ maxHeight: "320px" }}>
        <table className="doc-table" style={{ width: "100%", tableLayout: "fixed", whiteSpace: "normal", wordBreak: "break-word" }}>
          <colgroup>
            {onEliminados && <col style={{ width: "32px" }} />}
            {ANCHOS_COLUMNAS_MATERIALES.map((ancho, i) => <col key={i} style={{ width: ancho }} />)}
            <col style={{ width: "110px" }} />
          </colgroup>
          <thead>
            <tr>
              {onEliminados && <th></th>}
              <th>Material</th>
              <th>Código ERP</th>
              <th>Valor</th>
              <th>Costo</th>
              <th>Moneda</th>
              <th>Componente</th>
              <th>Creado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((m) => (
              <Fragment key={m.MaterialVariableValorId}>
                <tr>
                  {onEliminados && (
                    <td>
                      <input type="checkbox" checked={seleccionados.has(m.MaterialVariableValorId)} onChange={() => toggleSeleccion(m.MaterialVariableValorId)} />
                    </td>
                  )}
                  <td>{m.NombreMaterial}</td>
                  <td>{m.CodigoErp}</td>
                  <td>{formatoMonto(m.Valor)}</td>
                  <td>{formatoMonto(m.Costo)}</td>
                  <td>{m.Moneda}</td>
                  <td>{m.ComponenteDescripcion}</td>
                  <td>{m.CreadoPor || "—"}</td>
                  <td>{formatoFecha(m.CreadoFecha)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn ghost" type="button" style={{ padding: "4px 10px", fontSize: "12px", whiteSpace: "nowrap" }}
                      onClick={() => setEscalaAbierta((prev) => (prev === m.MaterialVariableValorId ? null : m.MaterialVariableValorId))}>
                      {escalaAbierta === m.MaterialVariableValorId ? "Cerrar" : "+ Escala"}
                    </button>
                  </td>
                </tr>
                {escalaAbierta === m.MaterialVariableValorId && (
                  <tr>
                    <td colSpan={10} style={{ background: "#fff", padding: "12px" }}>
                      <FormularioEscala
                        materialVariableValorId={m.MaterialVariableValorId}
                        nombreMaterial={m.NombreMaterial}
                        onCerrar={() => setEscalaAbierta(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Mismas columnas y anchos que TablaMaterialesVariables (checkbox + columna final reservada)
// para que ambas tablas queden alineadas visualmente una debajo de la otra, aunque los Fijos
// no tengan Escalas -- esa última columna simplemente queda vacía en vez de desaparecer.
function TablaMaterialesFijos({ filas, onEliminados }) {
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  if (filas.length === 0) {
    return <p style={{ fontSize: "13px", color: "#697386" }}>No hay Materiales Fijos configurados.</p>;
  }

  const toggleSeleccion = (id) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleEliminar = async () => {
    if (!autorizador?.id) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    const ids = [...seleccionados];
    setEliminando(true);
    try {
      const resp = await apiFetch(`/materialesNegEliminarFijos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, modifiedBy: autorizador.id })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al eliminar los Materiales", "warn");
        return;
      }
      showToast(data?.Message || "✓ Materiales eliminados con éxito", "ok");
      setSeleccionados(new Set());
      setConfirmando(false);
      onEliminados?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div>
      {onEliminados && seleccionados.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
          {!confirmando ? (
            <button className="btn danger" type="button" style={{ padding: "6px 14px", fontSize: "12px" }} onClick={() => setConfirmando(true)}>
              Eliminar {seleccionados.size} Material{seleccionados.size !== 1 ? "es" : ""} seleccionado{seleccionados.size !== 1 ? "s" : ""}
            </button>
          ) : (
            <>
              <span style={{ fontSize: "12px", color: "#b42318" }}>¿Confirmar eliminación?</span>
              <button className="btn danger" type="button" disabled={eliminando} onClick={handleEliminar} style={{ padding: "6px 14px", fontSize: "12px" }}>
                {eliminando ? "Eliminando..." : "Sí, eliminar"}
              </button>
              <button className="btn ghost" type="button" disabled={eliminando} onClick={() => setConfirmando(false)} style={{ padding: "6px 14px", fontSize: "12px" }}>
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
      <div className="doc-table-wrap" style={{ maxHeight: "320px" }}>
        <table className="doc-table" style={{ width: "100%", tableLayout: "fixed", whiteSpace: "normal", wordBreak: "break-word" }}>
          <colgroup>
            {onEliminados && <col style={{ width: "32px" }} />}
            {ANCHOS_COLUMNAS_MATERIALES.map((ancho, i) => <col key={i} style={{ width: ancho }} />)}
            <col style={{ width: "110px" }} />
          </colgroup>
          <thead>
            <tr>
              {onEliminados && <th></th>}
              <th>Material</th>
              <th>Código ERP</th>
              <th>Valor</th>
              <th>Costo</th>
              <th>Moneda</th>
              <th>Componente</th>
              <th>Creado por</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((m) => (
              <tr key={m.MaterialFlatValorId}>
                {onEliminados && (
                  <td>
                    <input type="checkbox" checked={seleccionados.has(m.MaterialFlatValorId)} onChange={() => toggleSeleccion(m.MaterialFlatValorId)} />
                  </td>
                )}
                <td>{m.NombreMaterial}</td>
                <td>{m.CodigoErp}</td>
                <td>{formatoMonto(m.Valor)}</td>
                <td>{formatoMonto(m.Costo)}</td>
                <td>{m.Moneda}</td>
                <td>{m.ComponenteDescripcion}</td>
                <td>{m.CreadoPor || "—"}</td>
                <td>{formatoFecha(m.CreadoFecha)}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Si se pasa onSelect, cada fila trae un botón "Usar" que entrega ese Segmento a quien lo
// use (SegmentoId, Tipo, Moneda, CodigoErp, Descripcion) -- evita copiar/pegar el Id a mano.
function TablaSegmentos({ filas, onSelect }) {
  if (filas.length === 0) {
    return <p style={{ fontSize: "13px", color: "#697386" }}>No se encontraron Segmentos.</p>;
  }
  return (
    <div className="doc-table-wrap" style={{ maxHeight: "260px" }}>
      <table className="doc-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Material</th>
            <th>Tipo</th>
            <th>Código ERP</th>
            <th>Moneda</th>
            <th>Segmento Id</th>
            {onSelect && <th></th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((s) => (
            <tr key={s.SegmentoId}>
              <td>{s.Descripcion}</td>
              <td>{s.Tipo}</td>
              <td>{s.CodigoErp}</td>
              <td>{s.Moneda}</td>
              <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{s.SegmentoId}</td>
              {onSelect && (
                <td>
                  <button className="btn primary" type="button" onClick={() => onSelect(s)} style={{ padding: "4px 12px", fontSize: "12px" }}>
                    Usar
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Buscador para llegar al MaterialVariableSegmentoId / MaterialFlatSegmentoId que se necesita
// para configurar un Material dentro de una Negociación cuando no existe todavía: por Nombre
// (Material → sus Segmentos) o directo por Código ERP (ya da el Segmento en un solo paso).
// Si se pasa onSelect, cada Segmento encontrado trae un botón "Usar" para entregarlo directo
// a quien lo pidió (ej. el formulario de Agregar Material), sin tener que cambiar de pestaña.
function SelectorDeSegmento({ onSelect }) {
  const [submodo, setSubmodo] = useState("nombre");
  const showToast = useToast();

  const [textoNombre, setTextoNombre] = useState("");
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  const [materiales, setMateriales] = useState(null);
  const [materialAbierto, setMaterialAbierto] = useState(null);
  const [segmentosPorMaterial, setSegmentosPorMaterial] = useState({});
  const [cargandoSegmentos, setCargandoSegmentos] = useState(null);

  const [textoCodigo, setTextoCodigo] = useState("");
  const [buscandoCodigo, setBuscandoCodigo] = useState(false);
  const [segmentosCodigo, setSegmentosCodigo] = useState(null);

  const [textoId, setTextoId] = useState("");
  const [buscandoId, setBuscandoId] = useState(false);
  const [segmentoPorId, setSegmentoPorId] = useState(null); // null = aún no se buscó, [] = no encontrado, [fila] = encontrado

  const handleBuscarNombre = async () => {
    const texto = textoNombre.trim();
    if (!texto) {
      showToast("Ingrese un texto para buscar", "warn");
      return;
    }
    setBuscandoNombre(true);
    setMateriales(null);
    setMaterialAbierto(null);
    setSegmentosPorMaterial({});
    try {
      const resp = await apiFetch(`/materialesBuscarPorNombre`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Materiales", "warn");
        return;
      }
      setMateriales(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoNombre(false);
    }
  };

  const handleVerSegmentos = async (material) => {
    if (materialAbierto === material.MaterialId) {
      setMaterialAbierto(null);
      return;
    }
    setMaterialAbierto(material.MaterialId);
    if (segmentosPorMaterial[material.MaterialId]) return;
    setCargandoSegmentos(material.MaterialId);
    try {
      const resp = await apiFetch(`/materialesSegmentosPorMaterial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId: material.MaterialId, tipo: material.Tipo === "Variable" ? "variable" : "fijo" })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Segmentos", "warn");
        return;
      }
      setSegmentosPorMaterial((prev) => ({ ...prev, [material.MaterialId]: Array.isArray(data) ? data : [] }));
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCargandoSegmentos(null);
    }
  };

  const handleBuscarCodigo = async () => {
    const texto = textoCodigo.trim();
    if (!texto) {
      showToast("Ingrese un Código ERP para buscar", "warn");
      return;
    }
    setBuscandoCodigo(true);
    setSegmentosCodigo(null);
    try {
      const resp = await apiFetch(`/materialesBuscarSegmentoPorCodigoErp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar Segmentos", "warn");
        return;
      }
      setSegmentosCodigo(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoCodigo(false);
    }
  };

  const handleBuscarId = async () => {
    const texto = textoId.trim();
    if (!texto) {
      showToast("Ingrese el Id del Segmento", "warn");
      return;
    }
    setBuscandoId(true);
    setSegmentoPorId(null);
    try {
      const resp = await apiFetch(`/materialesSegmentoPorId`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentoId: texto })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar el Segmento", "warn");
        setSegmentoPorId([]);
        return;
      }
      setSegmentoPorId([data]);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscandoId(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button className={submodo === "nombre" ? "btn primary" : "btn ghost"} type="button" onClick={() => setSubmodo("nombre")} style={{ padding: "6px 14px", fontSize: "12px" }}>
          Por Nombre
        </button>
        <button className={submodo === "codigo" ? "btn primary" : "btn ghost"} type="button" onClick={() => setSubmodo("codigo")} style={{ padding: "6px 14px", fontSize: "12px" }}>
          Por Código ERP
        </button>
        <button className={submodo === "id" ? "btn primary" : "btn ghost"} type="button" onClick={() => setSubmodo("id")} style={{ padding: "6px 14px", fontSize: "12px" }}>
          Por Segmento Id
        </button>
      </div>

      {submodo === "nombre" && (
        <div>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "1 1 320px" }}>
              <label>Nombre del Material</label>
              <input
                type="text"
                placeholder="destruccion de producto"
                value={textoNombre}
                onChange={(e) => setTextoNombre(e.target.value)}
                disabled={buscandoNombre}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <button className="btn primary" type="button" onClick={handleBuscarNombre} disabled={buscandoNombre} style={{ padding: "0 20px", height: "42px" }}>
              {buscandoNombre ? "Buscando..." : "Buscar"}
            </button>
          </div>

          {materiales !== null && (
            materiales.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#697386" }}>No se encontraron Materiales.</p>
            ) : (
              <div className="doc-table-wrap" style={{ maxHeight: "320px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Tipo</th>
                      <th style={{ width: "150px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materiales.map((m) => (
                      <Fragment key={m.MaterialId}>
                        <tr>
                          <td>{m.Descripcion}</td>
                          <td>{m.Tipo}</td>
                          <td>
                            <button className="btn ghost" type="button" onClick={() => handleVerSegmentos(m)} style={{ padding: "4px 12px", fontSize: "12px" }}>
                              {cargandoSegmentos === m.MaterialId ? "Cargando..." : materialAbierto === m.MaterialId ? "Ocultar Segmentos" : "Ver Segmentos"}
                            </button>
                          </td>
                        </tr>
                        {materialAbierto === m.MaterialId && segmentosPorMaterial[m.MaterialId] && (
                          <tr>
                            <td colSpan={3} style={{ background: "#fff", padding: "10px" }}>
                              <TablaSegmentos filas={segmentosPorMaterial[m.MaterialId]} onSelect={onSelect} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {submodo === "codigo" && (
        <div>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "1 1 320px" }}>
              <label>Código ERP</label>
              <input
                type="text"
                placeholder="1493"
                value={textoCodigo}
                onChange={(e) => setTextoCodigo(e.target.value)}
                disabled={buscandoCodigo}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <button className="btn primary" type="button" onClick={handleBuscarCodigo} disabled={buscandoCodigo} style={{ padding: "0 20px", height: "42px" }}>
              {buscandoCodigo ? "Buscando..." : "Buscar"}
            </button>
          </div>

          {segmentosCodigo !== null && <TablaSegmentos filas={segmentosCodigo} onSelect={onSelect} />}
        </div>
      )}

      {submodo === "id" && (
        <div>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "1 1 320px" }}>
              <label>Segmento Id (MaterialVariableSegmentoId o MaterialFlatSegmentoId)</label>
              <input
                type="text"
                placeholder="BFE3505D-EC5E-486B-AA09-14C6FED906F6"
                value={textoId}
                onChange={(e) => setTextoId(e.target.value)}
                disabled={buscandoId}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", fontFamily: "monospace" }}
              />
            </div>
            <button className="btn primary" type="button" onClick={handleBuscarId} disabled={buscandoId} style={{ padding: "0 20px", height: "42px" }}>
              {buscandoId ? "Buscando..." : "Buscar"}
            </button>
          </div>

          {segmentoPorId !== null && <TablaSegmentos filas={segmentoPorId} onSelect={onSelect} />}
        </div>
      )}
    </div>
  );
}

// Pestaña "Buscar Material" independiente -- mismo buscador de arriba, solo para consultar
// sin necesidad de estar agregando un Material a un Componente.
function BusquedaMaterial() {
  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        Buscar Material (Segmento)
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Encuentra el Segmento (MaterialVariableSegmentoId o MaterialFlatSegmentoId) necesario para configurar un Material en una Negociación.
      </div>
      <SelectorDeSegmento />
    </div>
  );
}

// Formulario final para "configurar" un Material: busca el Material/Segmento sin salir de este
// formulario (antes había que cambiar a la pestaña "Buscar Material" y copiar el Id a mano) y
// crea el MaterialVariableValor/MaterialFlatValor sobre un Componente con el Segmento elegido.
// Si viene `componenteId` fijo (modo "Por Id de Componente") se usa directo; si viene `componentes`
// (modo "Por Referencia Operativa", donde puede haber más de uno) se deja elegir con un selector.
function AgregarMaterial({ componenteId, componentes, onAgregado }) {
  const [componenteElegido, setComponenteElegido] = useState(componentes?.[0]?.ComponenteId || "");
  const [segmentoElegido, setSegmentoElegido] = useState(null); // { SegmentoId, CodigoErp, Moneda, Descripcion, Tipo }
  const [valor, setValor] = useState("");
  const [costo, setCosto] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Material Variable recién creado -- se ofrece agregarle Escalas de inmediato, con el Id que
  // ya devolvió /materialesNegCrearValor, sin que el usuario tenga que ir a buscarlo de nuevo.
  const [materialRecienCreado, setMaterialRecienCreado] = useState(null); // { id, nombre } | null
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  const componenteDestino = componenteId || componenteElegido;

  const handleAgregar = async () => {
    if (!componenteDestino) {
      showToast("Seleccione el Componente al que se agregará el Material", "warn");
      return;
    }
    if (!segmentoElegido) {
      showToast("Busque y elija el Material (Segmento) a configurar", "warn");
      return;
    }
    if (valor.trim() === "" || costo.trim() === "") {
      showToast("Ingrese Valor y Costo", "warn");
      return;
    }
    if (!autorizador?.id) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }
    setGuardando(true);
    try {
      const resp = await apiFetch(`/materialesNegCrearValor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ComponenteId: componenteDestino,
          SegmentoId: segmentoElegido.SegmentoId,
          Tipo: segmentoElegido.Tipo,
          Valor: Number(valor),
          Costo: Number(costo),
          CreatedBy: autorizador.id
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al agregar el Material", "warn");
        return;
      }
      showToast(data?.Message || "✓ Material agregado con éxito", "ok");
      if (segmentoElegido.Tipo === "Variable" && data?.MaterialValorId) {
        setMaterialRecienCreado({ id: data.MaterialValorId, nombre: segmentoElegido.Descripcion });
      }
      setSegmentoElegido(null);
      setValor("");
      setCosto("");
      onAgregado?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{ marginTop: "20px", background: "#fff", border: "1px dashed #93c5fd", borderRadius: "8px", padding: "16px" }}>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        + Agregar Material {componenteId ? "a este Componente" : ""}
      </div>

      {!componenteId && (
        <div className="field" style={{ maxWidth: "420px", marginBottom: "14px" }}>
          <label>Componente</label>
          <select value={componenteElegido} onChange={(e) => setComponenteElegido(e.target.value)} disabled={guardando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}>
            <option value="">Seleccione...</option>
            {(componentes || []).map((c) => (
              <option key={c.ComponenteId} value={c.ComponenteId}>{c.Descripcion || c.ComponenteId}</option>
            ))}
          </select>
        </div>
      )}

      {materialRecienCreado && (
        <div style={{ marginBottom: "16px" }}>
          <FormularioEscala
            materialVariableValorId={materialRecienCreado.id}
            nombreMaterial={materialRecienCreado.nombre}
            onCerrar={() => setMaterialRecienCreado(null)}
          />
        </div>
      )}

      {!segmentoElegido ? (
        <div>
          <div style={{ fontSize: "12px", color: "#697386", marginBottom: "10px" }}>
            Busque el Material por Nombre o Código ERP y presione "Usar" en el Segmento correcto (ya trae Tipo y Moneda).
          </div>
          <SelectorDeSegmento onSelect={(s) => { setSegmentoElegido(s); setMaterialRecienCreado(null); }} />
        </div>
      ) : (
        <div>
          <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "6px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ fontSize: "13px", color: "#1e3a8a" }}>
              <strong>{segmentoElegido.Descripcion}</strong> — {segmentoElegido.Tipo}, Código ERP {segmentoElegido.CodigoErp}, Moneda <strong>{segmentoElegido.Moneda}</strong>
            </div>
            <button className="btn ghost" type="button" onClick={() => setSegmentoElegido(null)} disabled={guardando} style={{ padding: "4px 12px", fontSize: "12px" }}>
              Cambiar
            </button>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end", marginTop: "14px" }}>
            <div className="field" style={{ width: "140px" }}>
              <label>Valor</label>
              <input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
            </div>
            <div className="field" style={{ width: "140px" }}>
              <label>Costo</label>
              <input type="number" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} disabled={guardando}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
            </div>
          </div>

          <div style={{ marginTop: "10px", fontSize: "12px", color: autorizador ? "#4f5b66" : "#b42318" }}>
            Autoriza: {autorizador?.name || "Tu usuario no está habilitado como autorizador"}
          </div>

          <button className="btn primary" type="button" onClick={handleAgregar} disabled={guardando} style={{ marginTop: "12px" }}>
            {guardando ? "Agregando..." : "Agregar Material"}
          </button>
        </div>
      )}
    </div>
  );
}

function BusquedaPorComponente() {
  const [componenteIdTexto, setComponenteIdTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [materialesVariables, setMaterialesVariables] = useState(null);
  const [materialesFijos, setMaterialesFijos] = useState(null);
  const showToast = useToast();

  const cargarMateriales = async (componenteId) => {
    const [respVariables, respFijos] = await Promise.all([
      apiFetch(`/materialesNegVariablesPorComponente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentes: [componenteId] })
      }),
      apiFetch(`/materialesNegFijosPorComponente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentes: [componenteId] })
      }),
    ]);
    const dataVariables = await respVariables.json().catch(() => null);
    const dataFijos = await respFijos.json().catch(() => null);
    if (!respVariables.ok) {
      showToast(dataVariables?.Message || "Error al buscar Materiales Variables", "warn");
    }
    if (!respFijos.ok) {
      showToast(dataFijos?.Message || "Error al buscar Materiales Fijos", "warn");
    }
    setMaterialesVariables(respVariables.ok && Array.isArray(dataVariables) ? dataVariables : []);
    setMaterialesFijos(respFijos.ok && Array.isArray(dataFijos) ? dataFijos : []);
  };

  const handleBuscar = async () => {
    const componenteId = componenteIdTexto.trim();
    if (!componenteId) {
      showToast("Ingrese el Id del Componente", "warn");
      return;
    }
    setBuscando(true);
    setResultado(null);
    setMaterialesVariables(null);
    setMaterialesFijos(null);
    try {
      const respComponente = await apiFetch(`/materialesNegClientePorComponente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componenteId })
      });
      const dataComponente = await respComponente.json().catch(() => null);
      if (!respComponente.ok) {
        showToast(dataComponente?.Message || "Error al buscar el Componente", "warn");
        return;
      }
      setResultado(dataComponente);
      await cargarMateriales(componenteId);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        Buscar por Id de Componente
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Muestra a qué Cliente pertenece, qué Hojas de Ruta (Referencias Operativas) lo usan, y sus Materiales Variables y Fijos configurados.
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: "1 1 320px" }}>
          <label>Id del Componente</label>
          <input
            type="text"
            placeholder="A969B39E-2B1A-4776-BEDB-24EC30C5D67B"
            value={componenteIdTexto}
            onChange={(e) => setComponenteIdTexto(e.target.value)}
            disabled={buscando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
        </div>
        <button className="btn primary" type="button" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 20px", height: "42px" }}>
          {buscando ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {resultado && (
        <div style={{ marginTop: "16px" }}>
          <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "8px", padding: "14px 16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "13px", color: "#1e3a8a", marginBottom: "4px" }}>
              <strong>Componente:</strong> {resultado.ComponenteDescripcion || "—"}{" "}
              {resultado.ComponenteEliminado && <span style={{ color: "#b42318" }}>(Eliminado)</span>}
            </div>
            <div style={{ fontSize: "13px", color: "#1e3a8a" }}>
              <strong>Cliente:</strong> {resultado.Cliente || "—"}
            </div>
          </div>

          <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "8px" }}>
            Hojas de Ruta que usan este Componente ({resultado.HojasDeRuta?.length || 0})
          </div>
          {resultado.HojasDeRuta?.length > 0 ? (
            <TablaHojasDeRutaPaginada hojasDeRuta={resultado.HojasDeRuta} />
          ) : (
            <p style={{ fontSize: "13px", color: "#697386" }}>Ninguna Hoja de Ruta usa este Componente todavía.</p>
          )}

          {materialesVariables !== null && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "8px" }}>
                Materiales Variables configurados
              </div>
              <TablaMaterialesVariables filas={materialesVariables} onEliminados={() => cargarMateriales(resultado.ComponenteId)} />
            </div>
          )}

          {materialesFijos !== null && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "8px" }}>
                Materiales Fijos configurados
              </div>
              <TablaMaterialesFijos filas={materialesFijos} onEliminados={() => cargarMateriales(resultado.ComponenteId)} />
            </div>
          )}

          {!resultado.ComponenteEliminado && (
            <AgregarMaterial componenteId={resultado.ComponenteId} onAgregado={() => cargarMateriales(resultado.ComponenteId)} />
          )}
        </div>
      )}
    </div>
  );
}

export default function MaterialesNegociacion() {
  const [modo, setModo] = useState("referencia");
  const [referenciasTexto, setReferenciasTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [componentes, setComponentes] = useState([]);
  const [noEncontradas, setNoEncontradas] = useState([]);
  const [seleccionados, setSeleccionados] = useState(() => new Set());

  const [cargandoMateriales, setCargandoMateriales] = useState(false);
  const [materialesVariables, setMaterialesVariables] = useState(null);
  const [materialesFijos, setMaterialesFijos] = useState(null);

  const showToast = useToast();

  const handleBuscar = async () => {
    const referencias = parseReferencias(referenciasTexto);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa", "warn");
      return;
    }
    setBuscando(true);
    setMaterialesVariables(null);
    setMaterialesFijos(null);
    try {
      const resp = await apiFetch(`/materialesNegComponentePorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar el Componente", "warn");
        setComponentes([]);
        setNoEncontradas([]);
        return;
      }
      const filas = Array.isArray(data?.Filas) ? data.Filas : [];
      setComponentes(filas);
      setNoEncontradas(Array.isArray(data?.NoEncontradas) ? data.NoEncontradas : []);
      setSeleccionados(new Set(filas.filter((f) => f.ComponenteId).map((f) => f.ComponenteId)));
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscando(false);
    }
  };

  const handleLimpiar = () => {
    setReferenciasTexto("");
    setComponentes([]);
    setNoEncontradas([]);
    setSeleccionados(new Set());
    setBuscado(false);
    setMaterialesVariables(null);
    setMaterialesFijos(null);
  };

  const toggleSeleccion = (componenteId) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(componenteId)) next.delete(componenteId); else next.add(componenteId);
      return next;
    });
  };

  const handleVerMateriales = async () => {
    const componentesElegidos = [...seleccionados];
    if (componentesElegidos.length === 0) {
      showToast("Seleccione al menos un Componente", "warn");
      return;
    }
    setCargandoMateriales(true);
    try {
      const [respVariables, respFijos] = await Promise.all([
        apiFetch(`/materialesNegVariablesPorComponente`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ componentes: componentesElegidos })
        }),
        apiFetch(`/materialesNegFijosPorComponente`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ componentes: componentesElegidos })
        }),
      ]);
      const dataVariables = await respVariables.json().catch(() => null);
      const dataFijos = await respFijos.json().catch(() => null);

      if (!respVariables.ok) {
        showToast(dataVariables?.Message || "Error al buscar Materiales Variables", "warn");
      }
      if (!respFijos.ok) {
        showToast(dataFijos?.Message || "Error al buscar Materiales Fijos", "warn");
      }

      setMaterialesVariables(respVariables.ok && Array.isArray(dataVariables) ? dataVariables : []);
      setMaterialesFijos(respFijos.ok && Array.isArray(dataFijos) ? dataFijos : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCargandoMateriales(false);
    }
  };

  const opcionesComponentes = [...new Map(
    componentes
      .filter((c) => c.ComponenteId)
      .map((c) => [c.ComponenteId, { ComponenteId: c.ComponenteId, Descripcion: `${c.ComponenteDescripcion || c.ComponenteId} — ${c.ReferenciaOperativa}` }])
  ).values()];

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button
          className={modo === "referencia" ? "btn primary" : "btn ghost"}
          type="button"
          onClick={() => setModo("referencia")}
          style={{ padding: "6px 16px", fontSize: "13px" }}
        >
          Por Referencia Operativa
        </button>
        <button
          className={modo === "componente" ? "btn primary" : "btn ghost"}
          type="button"
          onClick={() => setModo("componente")}
          style={{ padding: "6px 16px", fontSize: "13px" }}
        >
          Por Id de Componente
        </button>
        <button
          className={modo === "material" ? "btn primary" : "btn ghost"}
          type="button"
          onClick={() => setModo("material")}
          style={{ padding: "6px 16px", fontSize: "13px" }}
        >
          Buscar Material
        </button>
      </div>

      {modo === "componente" && <BusquedaPorComponente />}
      {modo === "material" && <BusquedaMaterial />}

      {modo === "referencia" && (
      <>
      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
        <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
          <PasoBadge n={1} />Buscar el Componente a partir de la Referencia Operativa
        </div>
        <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
          Una Referencia puede traer más de un Componente si sus líneas usan Segmentos distintos.
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 320px", marginBottom: 0 }}>
            <label>Referencia Operativa (una o varias, separadas por coma)</label>
            <input
              type="text"
              placeholder="MM-MM-H26-505, MM-MM-H26-510"
              value={referenciasTexto}
              onChange={(e) => setReferenciasTexto(e.target.value)}
              disabled={buscando}
              style={{ width: "100%", boxSizing: "border-box", height: "38px", padding: "0 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
            />
          </div>
          <button className="btn primary" type="button" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 20px", height: "38px" }}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          <button className="btn ghost" type="button" onClick={handleLimpiar} disabled={buscando} style={{ padding: "0 20px", height: "38px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {buscado && (
        <>
          {noEncontradas.length > 0 && (
            <div style={{
              background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
              padding: "12px 14px", marginBottom: "14px", fontSize: "13px", color: "#9a3412"
            }}>
              ⚠️ No se encontraron estas Referencias: {noEncontradas.join(", ")}
            </div>
          )}

          {componentes.length > 0 ? (
            <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
              <div className="doc-table-wrap" style={{ maxHeight: "260px" }}>
                <table className="doc-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "36px" }}></th>
                      <th>Referencia Operativa</th>
                      <th>Cliente</th>
                      <th>Componente Id</th>
                      <th>Componente Descripción</th>
                      <th>Centro Suministrador</th>
                      <th>Oficina Venta</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {componentes.map((c, i) => (
                      <tr key={c.SalesOrderDetalleId || i}>
                        <td>
                          {c.ComponenteId && (
                            <input
                              type="checkbox"
                              checked={seleccionados.has(c.ComponenteId)}
                              onChange={() => toggleSeleccion(c.ComponenteId)}
                            />
                          )}
                        </td>
                        <td>{c.ReferenciaOperativa}</td>
                        <td>{c.Cliente || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{c.ComponenteId || "—"}</td>
                        <td>{c.ComponenteDescripcion || "—"}</td>
                        <td>{c.CentroSuministrador || "—"}</td>
                        <td>{c.OficinaVenta || "—"}</td>
                        <td>
                          {!c.ComponenteId ? (
                            <span style={{ color: "#9a3412" }}>Sin Componente</span>
                          ) : c.ComponenteEliminado ? (
                            <span style={{ color: "#b42318" }}>Eliminado</span>
                          ) : (
                            <span style={{ color: "#166534" }}>Activo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button className="btn primary" type="button" onClick={handleVerMateriales} disabled={cargandoMateriales} style={{ marginTop: "14px" }}>
                {cargandoMateriales ? "Cargando..." : `Ver Materiales de ${seleccionados.size} Componente${seleccionados.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          ) : (
            <p style={{ fontSize: "13px", color: "#697386" }}>No se encontró ninguna línea para esas Referencias.</p>
          )}
        </>
      )}

      {materialesVariables !== null && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
            <PasoBadge n={2} />Materiales Variables configurados
          </div>
          <TablaMaterialesVariables filas={materialesVariables} onEliminados={handleVerMateriales} />
        </div>
      )}

      {materialesFijos !== null && (
        <div>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
            <PasoBadge n={3} />Materiales Fijos configurados
          </div>
          <TablaMaterialesFijos filas={materialesFijos} onEliminados={handleVerMateriales} />
        </div>
      )}

      {opcionesComponentes.length > 0 && (
        <AgregarMaterial componentes={opcionesComponentes} onAgregado={handleVerMateriales} />
      )}
      </>
      )}
    </div>
  );
}
