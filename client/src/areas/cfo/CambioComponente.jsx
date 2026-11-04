import { useState, useEffect, useRef } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import Aduana, { meta as aduanaMeta } from "./cambioComponente/Aduana.jsx";
import AduanaHR, { meta as aduanaHrMeta } from "./cambioComponente/AduanaHR.jsx";
import Componente, { meta as componenteMeta } from "./cambioComponente/Componente.jsx";
import UpdateComponente, { meta as updateComponenteMeta } from "./cambioComponente/UpdateComponente.jsx";

export const meta = {
  label: "Cambio de Componente",
  icon: "🔄",
  desc: "Herramientas de gestión sobre componentes de Sales Order",
  kind: "primary",
};

export default function CambioComponente({ navParams }) {
  const [referencia, setReferencia] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [aduanaCfo, setAduanaCfo] = useState([]);
  const [aduanaHr, setAduanaHr] = useState([]);
  const [hrEjemplo, setHrEjemplo] = useState([]);
  const [componenteData, setComponenteData] = useState([]);
  const [componenteExtra, setComponenteExtra] = useState("");
  const [actualizandoComponente, setActualizandoComponente] = useState(false);
  const showToast = useToast();

  const fetchComponente = async (referencias) => {
    try {
      const resp = await apiFetch(`/componentePorReferencias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar en Componente", "warn");
        setComponenteData([]);
        return;
      }
      setComponenteData(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setComponenteData([]);
    }
  };

  const handleAgregarComponenteExtra = (extraRef) => {
    setComponenteExtra(extraRef);
    fetchComponente([referencia.trim(), extraRef]);
  };

  const handleQuitarComponenteExtra = () => {
    setComponenteExtra("");
    fetchComponente([referencia.trim()]);
  };

  const handleActualizarComponente = async ({ componenteId, autorizador, motivo }) => {
    const filaActual = componenteData.find((r) => r.ReferenciaOperativa === referencia.trim());
    if (!filaActual) {
      showToast("No se encontró el detalle de la referencia principal", "warn");
      return;
    }
    // El Centro Suministrador y la Oficina de Venta deben quedar como los del componente
    // nuevo (tomado de la referencia de comparación), no los de la referencia original.
    const filaComponenteNuevo = componenteData.find((r) => r.Componente_ID === componenteId);
    if (!filaComponenteNuevo) {
      showToast("No se encontró el detalle del componente nuevo seleccionado", "warn");
      return;
    }
    setActualizandoComponente(true);
    try {
      const resp = await apiFetch(`/actualizarComponente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          SalesOrderDetalleId: filaActual.SalesOrderDetalleId,
          ComponenteId: componenteId,
          OficinaVenta: filaComponenteNuevo.OficinaVenta,
          CentroSuministrador: filaComponenteNuevo.CentroSuministrador,
          ModifiedBy: autorizador,
          Observacion: motivo
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al actualizar el componente", "warn");
        return;
      }
      showToast(data?.Message || "✓ Componente actualizado con éxito", "ok");
      const referenciasActuales = componenteExtra ? [referencia.trim(), componenteExtra] : [referencia.trim()];
      fetchComponente(referenciasActuales);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setActualizandoComponente(false);
    }
  };

  // Núcleo compartido por la búsqueda manual (botón Buscar) y por la búsqueda automática
  // cuando se llega desde otro módulo (ej. Habilitar SalesOrder) con una Referencia
  // Operativa ya conocida. Recibe el valor tal cual (no el estado `referencia`, que
  // todavía no se actualizó cuando llega por navegación) para no quedar con un texto viejo.
  const buscarReferencia = async (referenciaValor) => {
    setLoading(true);
    setComponenteExtra("");
    try {
      const [respCfo, respHr] = await Promise.all([
        apiFetch(`/aduanaPorReferencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referencia: referenciaValor })
        }),
        apiFetch(`/hojaRutaPorReferencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ referencia: referenciaValor })
        }),
        fetchComponente([referenciaValor]),
      ]);

      const dataCfo = await respCfo.json().catch(() => null);
      const dataHr = await respHr.json().catch(() => null);

      if (!respCfo.ok) showToast(dataCfo?.Message || "Error al buscar en Aduana CFO", "warn");
      if (!respHr.ok) showToast(dataHr?.Message || "Error al buscar en Aduana HR", "warn");

      setAduanaCfo(respCfo.ok && Array.isArray(dataCfo) ? dataCfo : []);
      const listaHr = respHr.ok && Array.isArray(dataHr) ? dataHr : [];
      setAduanaHr(listaHr);

      // "HR de Ejemplo" depende de los datos que traiga "Aduana En HR" (cliente, aduana
      // y los primeros 5 caracteres de la gestión), así que solo se consulta si hubo resultado.
      if (listaHr.length > 0) {
        const { ClienteId, AduanaId, NumeroGestion } = listaHr[0];
        const respEjemplo = await apiFetch(`/hojaRutaEjemplo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clienteId: ClienteId,
            aduanaId: AduanaId,
            gestionPrefix: (NumeroGestion || "").slice(0, 5),
            excluirNumeroHojaRuta: referenciaValor
          })
        });
        const dataEjemplo = await respEjemplo.json().catch(() => null);
        if (!respEjemplo.ok) showToast(dataEjemplo?.Message || "Error al buscar en HR de Ejemplo", "warn");
        setHrEjemplo(respEjemplo.ok && Array.isArray(dataEjemplo) ? dataEjemplo : []);
      } else {
        setHrEjemplo([]);
      }

      setSearched(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setLoading(false);
    }
  };

  const handleBuscar = async () => {
    if (!referencia.trim()) {
      showToast("Ingrese una Referencia Operativa / Hoja de Ruta para buscar", "warn");
      return;
    }
    await buscarReferencia(referencia.trim());
  };

  // Llegada automática desde otro módulo (ej. Habilitar SalesOrder) con una Referencia
  // Operativa ya conocida -- se busca sola, sin tener que copiarla y pegarla a mano. El
  // "token" distingue cada navegación para no repetir la búsqueda si el componente ya
  // estaba montado y solo cambian otras props.
  const ultimoTokenNav = useRef(null);
  useEffect(() => {
    if (navParams?.referencia && navParams.token !== ultimoTokenNav.current) {
      ultimoTokenNav.current = navParams.token;
      setReferencia(navParams.referencia);
      buscarReferencia(navParams.referencia.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navParams]);

  const handleClear = () => {
    setReferencia("");
    setAduanaCfo([]);
    setAduanaHr([]);
    setHrEjemplo([]);
    setComponenteData([]);
    setComponenteExtra("");
    setSearched(false);
  };

  const renderCuadro = (c) => (
    <div className="cuadro-box" style={c.full ? { gridColumn: "1 / -1" } : undefined} key={c.key}>
      <div className="cuadro-box-header">
        <div className="cuadro-box-icon">{c.icon}</div>
        <div>
          <div className="cuadro-box-title">{c.label}</div>
          <div className="cuadro-box-desc">{c.desc}</div>
        </div>
      </div>
      <c.Component resultados={c.resultados} loading={loading} searched={searched} {...c.extraProps} />
    </div>
  );

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "10px", marginBottom: "14px" }}>
        <div className="form-title" style={{ fontSize: "19px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "2px", fontSize: "12px" }}>{meta.desc}</div>
      </div>

      <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", background: "#f8f9fa", padding: "8px 10px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "16px" }}>
        <span style={{ fontSize: "12px", fontWeight: "600", color: "#4f5b66", whiteSpace: "nowrap", paddingLeft: "4px" }}>
          🔍 Referencia / HR
        </span>
        <input
          type="text"
          placeholder="Ej: MM-MM-H26-717"
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          style={{ width: "220px", padding: "7px 10px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px" }}
          disabled={loading}
        />
        <button className="btn primary" onClick={handleBuscar} disabled={loading} style={{ padding: "6px 16px", fontSize: "13px" }}>
          {loading ? "Buscando..." : "Buscar"}
        </button>
        <button className="btn ghost" onClick={handleClear} disabled={loading} style={{ padding: "6px 16px", fontSize: "13px" }}>
          Limpiar
        </button>
      </div>

      <div className="cuadro-grid">
        {renderCuadro({ key: "aduanaCfo", ...aduanaMeta, Component: Aduana, resultados: aduanaCfo })}
        {renderCuadro({ key: "aduanaHr", ...aduanaHrMeta, Component: AduanaHR, resultados: aduanaHr })}
        {renderCuadro({
          key: "componente",
          ...componenteMeta,
          Component: Componente,
          resultados: componenteData,
          full: true,
          extraProps: {
            opciones: hrEjemplo.map((r) => r.NumeroHojaRuta).filter((ref) => ref !== componenteExtra),
            extra: componenteExtra,
            onAgregarExtra: handleAgregarComponenteExtra,
            onQuitarExtra: handleQuitarComponenteExtra,
          },
        })}
        {renderCuadro({
          key: "updateComponente",
          ...updateComponenteMeta,
          Component: UpdateComponente,
          full: true,
          extraProps: {
            filaActual: componenteData.find((r) => r.ReferenciaOperativa === referencia.trim()) || null,
            opciones: componenteData
              .filter((r) => r.ReferenciaOperativa !== referencia.trim())
              .map((r) => ({ value: r.Componente_ID, label: `${r.Descripcion} — ${r.ReferenciaOperativa}` })),
            onActualizar: handleActualizarComponente,
            actualizando: actualizandoComponente,
          },
        })}
      </div>
    </div>
  );
}
