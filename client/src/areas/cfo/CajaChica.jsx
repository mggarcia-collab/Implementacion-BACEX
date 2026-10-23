import { useState, useEffect, useRef } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

// Mismo catálogo de Tenants que usa Crear Proveedor/Cliente (ver TENANTS_PROVEEDOR_CFO en
// Cfo.routes.js) -- se reutilizan los mismos endpoints /proveedoresCfoPorPersona y
// /crearProveedorCfo, así que las claves deben coincidir exactamente.
const TENANTS_PROVEEDOR_CFO = [
  { value: "honduras", label: "Honduras" },
  { value: "elSalvador", label: "El Salvador" },
  { value: "guatemala", label: "Guatemala" },
  { value: "nicaragua", label: "Nicaragua" },
  { value: "costaRica", label: "Costa Rica" },
  { value: "corporacionDinant", label: "Corporación Dinant" },
  { value: "dinantExports", label: "Dinant Exports" },
];

// Mismo catálogo de País/Sociedad que usa Crear Proveedor/Cliente para el Código ERP (ver
// PAISES_CAJA_CHICA en CajaChica.routes.js) -- las claves deben coincidir exactamente.
const PAISES_CODIGO_ERP = [
  { value: "honduras", label: "Honduras" },
  { value: "elSalvador", label: "El Salvador" },
  { value: "guatemala", label: "Guatemala" },
  { value: "nicaragua", label: "Nicaragua" },
  { value: "costaRica", label: "Costa Rica" },
];

export const meta = {
  label: "Caja Chica",
  icon: "💵",
  desc: "Administración de Caja Chica (solo Administradores)",
  kind: "primary",
};

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

const TIPOS_BUSQUEDA_PERSONA = [
  { value: "nombre", label: "Nombre y Apellido" },
  { value: "correo", label: "Correo Electrónico" },
];

// Las dos únicas fechas que vienen como datetime completo en Persona se guardan como
// "2026-02-23T00:00:00.000Z" -- se recorta a solo la parte de fecha para los <input type="date">.
function soloFecha(valor) {
  if (!valor) return "";
  return String(valor).slice(0, 10);
}

// Sugerencia de correo a partir de Nombre + Apellido: inicial de cada palabra del Nombre, más
// la primera palabra del Apellido, en minúscula, @grupovesta.net. Confirmado contra datos
// reales que esta es la regla dominante, pero NO es 100% exacta (hay excepciones reales sin
// explicación clara, ej. cuando usan el segundo apellido en vez del primero) -- por eso el
// campo en pantalla queda editable en vez de fijo, esto es solo el punto de partida.
function sugerirCorreo(nombre, apellido) {
  const iniciales = (nombre || "").trim().split(/\s+/).filter(Boolean).map((p) => p[0]).join("");
  const primerApellido = (apellido || "").trim().split(/\s+/).filter(Boolean)[0] || "";
  if (!iniciales || !primerApellido) return "";
  return `${iniciales}${primerApellido}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + "@grupovesta.net";
}

// Tabla genérica para mostrar TODOS los campos no vacíos de la Persona encontrada (son ~70
// columnas en total; no tiene caso listarlas todas a mano) -- se pidió explícitamente ver toda
// la información que trae la consulta, no un resumen curado como en el resto de módulos.
function DetallePersona({ persona }) {
  const entradas = Object.entries(persona).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "");
  return (
    <div className="doc-table-wrap" style={{ maxHeight: "360px" }}>
      <table className="doc-table" style={{ width: "100%" }}>
        <tbody>
          {entradas.map(([campo, valor]) => (
            <tr key={campo}>
              <td style={{ fontWeight: "600", color: "#334155", width: "220px", whiteSpace: "nowrap" }}>{campo}</td>
              <td style={{ wordBreak: "break-word" }}>{String(valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Búsqueda en vivo contra Personas (reutilizada para Jefe Inmediato) -- mismo patrón de
// debounce que el resto del sistema.
function useBusquedaPersonaEnVivo() {
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const ultimaSeleccionRef = useRef("");

  useEffect(() => {
    const textoTrim = texto.trim();
    if (textoTrim.length < 2 || textoTrim === ultimaSeleccionRef.current) {
      setResultados([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await apiFetch(`/cajaChicaBuscarPersona`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: "nombre", texto: textoTrim })
        });
        const data = await resp.json().catch(() => null);
        setResultados(resp.ok && Array.isArray(data) ? data : []);
      } catch (error) {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [texto]);

  return { texto, setTexto, buscando, resultados, setResultados, ultimaSeleccionRef };
}

function SeccionCrearPersona({ onCreada }) {
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [idFiscal, setIdFiscal] = useState("");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [fechaIngreso, setFechaIngreso] = useState("");
  const [cargo, setCargo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [correo, setCorreo] = useState("");
  const [correoManual, setCorreoManual] = useState(false);
  const [codigoEmpleado, setCodigoEmpleado] = useState("");

  const [sitioBusqueda, setSitioBusqueda] = useState("");
  const [buscandoSitios, setBuscandoSitios] = useState(false);
  const [sitiosResultados, setSitiosResultados] = useState([]);
  const [sitioSeleccionado, setSitioSeleccionado] = useState(null);
  const ultimaSeleccionSitioRef = useRef("");

  const jefe = useBusquedaPersonaEnVivo();
  const [jefeSeleccionado, setJefeSeleccionado] = useState(null);

  const [creando, setCreando] = useState(false);
  const showToast = useToast();

  // Sugiere el correo mientras no se haya editado a mano.
  useEffect(() => {
    if (correoManual) return;
    setCorreo(sugerirCorreo(nombre, apellido));
  }, [nombre, apellido, correoManual]);

  // Trae el siguiente Código de Empleado correlativo apenas se abre esta sección.
  useEffect(() => {
    (async () => {
      try {
        const resp = await apiFetch(`/cajaChicaSiguienteCodigoEmpleado`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data?.CodigoEmpleado) setCodigoEmpleado(data.CodigoEmpleado);
      } catch (error) {
        // Si falla, el campo queda vacío y se llena a mano -- no bloquea el resto del formulario.
      }
    })();
  }, []);

  useEffect(() => {
    const textoTrim = sitioBusqueda.trim();
    if (textoTrim.length < 2 || textoTrim === ultimaSeleccionSitioRef.current) {
      setSitiosResultados([]);
      setBuscandoSitios(false);
      return;
    }
    setBuscandoSitios(true);
    const timer = setTimeout(async () => {
      try {
        const resp = await apiFetch(`/cajaChicaBuscarSitiosVesta`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto: textoTrim })
        });
        const data = await resp.json().catch(() => null);
        setSitiosResultados(resp.ok && Array.isArray(data) ? data : []);
      } catch (error) {
        setSitiosResultados([]);
      } finally {
        setBuscandoSitios(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [sitioBusqueda]);

  const handleSeleccionarSitio = (s) => {
    setSitioSeleccionado(s);
    setSitiosResultados([]);
    ultimaSeleccionSitioRef.current = s.Nombre;
    setSitioBusqueda(s.Nombre);
  };

  const handleSeleccionarJefe = (p) => {
    setJefeSeleccionado(p);
    jefe.setResultados([]);
    jefe.ultimaSeleccionRef.current = p.Nombre;
    jefe.setTexto(p.Nombre);
  };

  const handleCrear = async () => {
    const nombreTrim = nombre.trim();
    const apellidoTrim = apellido.trim();
    const idFiscalTrim = idFiscal.trim();
    const cargoTrim = cargo.trim();
    const carreraTrim = carrera.trim();
    const correoTrim = correo.trim();
    const codigoEmpleadoTrim = codigoEmpleado.trim();

    if (!nombreTrim || !apellidoTrim) { showToast("El Nombre y Apellido son requeridos", "warn"); return; }
    if (!idFiscalTrim) { showToast("El Id Fiscal es requerido", "warn"); return; }
    if (!fechaNacimiento) { showToast("La Fecha de Nacimiento es requerida", "warn"); return; }
    if (!fechaIngreso) { showToast("La Fecha de Ingreso es requerida", "warn"); return; }
    if (!cargoTrim) { showToast("El Cargo es requerido", "warn"); return; }
    if (!carreraTrim) { showToast("La Carrera es requerida", "warn"); return; }
    if (!sitioSeleccionado) { showToast("Seleccione el Sitio Vesta", "warn"); return; }
    if (!jefeSeleccionado) { showToast("Seleccione el Jefe Inmediato", "warn"); return; }
    if (!correoTrim) { showToast("El correo (Nombre de Usuario) es requerido", "warn"); return; }

    if (!window.confirm(
      `¿Confirma crear a "${nombreTrim} ${apellidoTrim}" en Personas?\n\n` +
      `Id Fiscal: ${idFiscalTrim}\nCorreo: ${correoTrim}\nCargo: ${cargoTrim}\n` +
      `Sitio Vesta: ${sitioSeleccionado.Nombre}\nJefe Inmediato: ${jefeSeleccionado.Nombre}\n` +
      `Código de Empleado: ${codigoEmpleadoTrim || "—"}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/cajaChicaCrearPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Nombre: nombreTrim,
          Apellido: apellidoTrim,
          IdFiscal: idFiscalTrim,
          FechaNacimiento: fechaNacimiento,
          FechaIngreso: fechaIngreso,
          Cargo: cargoTrim,
          Carrera: carreraTrim,
          SitioVestaId: sitioSeleccionado.Id,
          JefeInmediatoId: jefeSeleccionado.Id,
          NombreUsuario: correoTrim,
          CodigoEmpleado: codigoEmpleadoTrim
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear la Persona", "warn");
        return;
      }
      showToast(data?.Message || "✓ Persona creada con éxito", "ok");
      onCreada?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <div style={{ background: "#f6fbf3", border: "1px solid #b6d7a8", borderRadius: "8px", padding: "20px", marginTop: "16px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "16px" }}>
        ➕ Crear nueva Persona
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Nombre</label>
          <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Apellido</label>
          <input type="text" value={apellido} onChange={(e) => setApellido(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label>Id Fiscal</label>
          <input type="text" value={idFiscal} onChange={(e) => setIdFiscal(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label>Fecha de Nacimiento</label>
          <input type="date" value={fechaNacimiento} onChange={(e) => setFechaNacimiento(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label>Fecha de Ingreso</label>
          <input type="date" value={fechaIngreso} onChange={(e) => setFechaIngreso(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label>Código de Empleado</label>
          <input type="text" value={codigoEmpleado} onChange={(e) => setCodigoEmpleado(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
          <div style={{ fontSize: "11px", color: "#a3acb9", marginTop: "4px" }}>Correlativo propio, editable.</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Cargo</label>
          <input type="text" value={cargo} onChange={(e) => setCargo(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Carrera</label>
          <input type="text" value={carrera} onChange={(e) => setCarrera(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
        </div>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label>Correo (Nombre de Usuario)</label>
          <input
            type="text"
            value={correo}
            onChange={(e) => { setCorreo(e.target.value); setCorreoManual(true); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
          <div style={{ fontSize: "11px", color: "#a3acb9", marginTop: "4px" }}>
            Sugerido automáticamente a partir del Nombre y Apellido — puedes corregirlo.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div className="field" style={{ flex: "1 1 280px", position: "relative" }}>
          <label>Sitio Vesta</label>
          <input
            type="text"
            placeholder="Empiece a escribir el nombre del sitio..."
            value={sitioBusqueda}
            onChange={(e) => { setSitioBusqueda(e.target.value); setSitioSeleccionado(null); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
          {buscandoSitios && <p style={{ fontSize: "12px", color: "#697386", margin: "6px 0 0" }}>Buscando...</p>}
          {sitiosResultados.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
              {sitiosResultados.map((s) => (
                <div key={s.Id} onClick={() => handleSeleccionarSitio(s)} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f1f3f6" }}>
                  <div style={{ fontSize: "13px" }}>{s.Nombre}</div>
                  <div style={{ fontSize: "11px", color: "#a3acb9" }}>{s.CiudadDescripcion} — {s.Direccion}</div>
                </div>
              ))}
            </div>
          )}
          {sitioSeleccionado && (
            <div style={{ fontSize: "12px", color: "#166534", marginTop: "4px" }}>✓ {sitioSeleccionado.Nombre}</div>
          )}
        </div>

        <div className="field" style={{ flex: "1 1 280px", position: "relative" }}>
          <label>Jefe Inmediato</label>
          <input
            type="text"
            placeholder="Empiece a escribir el nombre..."
            value={jefe.texto}
            onChange={(e) => { jefe.setTexto(e.target.value); setJefeSeleccionado(null); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
          {jefe.buscando && <p style={{ fontSize: "12px", color: "#697386", margin: "6px 0 0" }}>Buscando...</p>}
          {jefe.resultados.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1px solid #dcdfe6", borderRadius: "6px", marginTop: "4px", maxHeight: "220px", overflowY: "auto", boxShadow: "0 4px 10px rgba(0,0,0,0.1)" }}>
              {jefe.resultados.map((p) => (
                <div key={p.Id} onClick={() => handleSeleccionarJefe(p)} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #f1f3f6" }}>
                  <div style={{ fontSize: "13px" }}>{p.Nombre} {p.Apellido}</div>
                  <div style={{ fontSize: "11px", color: "#a3acb9" }}>{p.NombreUsuario}</div>
                </div>
              ))}
            </div>
          )}
          {jefeSeleccionado && (
            <div style={{ fontSize: "12px", color: "#166534", marginTop: "4px" }}>✓ {jefeSeleccionado.Nombre} {jefeSeleccionado.Apellido}</div>
          )}
        </div>
      </div>

      <button className="btn primary" type="button" onClick={handleCrear} disabled={creando}>
        {creando ? "Creando..." : "Crear Persona"}
      </button>
    </div>
  );
}

function SeccionBuscarPersona({ onPersonaConfirmada }) {
  const [tipoCriterio, setTipoCriterio] = useState("nombre");
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [personaSeleccionada, setPersonaSeleccionada] = useState(null);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const showToast = useToast();

  const handleBuscar = async () => {
    const textoTrim = texto.trim();
    if (!textoTrim) {
      showToast(`Ingrese ${tipoCriterio === "correo" ? "un correo" : "un nombre"} para buscar`, "warn");
      return;
    }
    setBuscando(true);
    setResultados([]);
    setPersonaSeleccionada(null);
    setMostrarCrear(false);
    try {
      const resp = await apiFetch(`/cajaChicaBuscarPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: tipoCriterio, texto: textoTrim })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al buscar la Persona", "warn");
        return;
      }
      setResultados(Array.isArray(data) ? data : []);
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setBuscando(false);
    }
  };

  const handleLimpiar = () => {
    setTexto("");
    setResultados([]);
    setPersonaSeleccionada(null);
    setMostrarCrear(false);
    setBuscado(false);
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={1} />Validar si la Persona ya existe en Personas
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Busca al solicitante antes de registrar una Caja Chica a su nombre.
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label>Buscar por</label>
          <select
            value={tipoCriterio}
            onChange={(e) => { setTipoCriterio(e.target.value); setTexto(""); handleLimpiar(); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
          >
            {TIPOS_BUSQUEDA_PERSONA.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "2 1 300px" }}>
          <label>{TIPOS_BUSQUEDA_PERSONA.find((t) => t.value === tipoCriterio)?.label}</label>
          <input
            type="text"
            placeholder={tipoCriterio === "correo" ? "Ej: ccfernandez@grupovesta.net" : "Ej: Maradiaga Sandoval"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={buscando}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
          <button type="button" className="btn primary" onClick={handleBuscar} disabled={buscando} style={{ padding: "0 16px", height: "42px" }}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscando} style={{ padding: "0 16px", height: "42px" }}>
            Limpiar
          </button>
        </div>
      </div>

      {buscado && resultados.length === 0 && !mostrarCrear && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ No se encontró ninguna Persona con ese criterio.
          </span>
          <button type="button" className="btn danger" onClick={() => setMostrarCrear(true)} style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}>
            + Crear nueva Persona
          </button>
        </div>
      )}

      {resultados.length > 0 && !personaSeleccionada && (
        <div className="doc-table-wrap" style={{ maxHeight: "260px" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Apellido</th>
                <th>Id Fiscal</th>
                <th>Correo</th>
                <th>Cargo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((p) => (
                <tr key={p.Id}>
                  <td>{p.Nombre}</td>
                  <td>{p.Apellido}</td>
                  <td>{p.IdFiscal}</td>
                  <td>{p.NombreUsuario}</td>
                  <td>{p.Cargo}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn soft" type="button" onClick={() => setPersonaSeleccionada(p)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                      Ver / Usar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {personaSeleccionada && (
        <div style={{ marginTop: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#166534" }}>
              ✓ Persona encontrada — toda la información del registro:
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button className="btn ghost" type="button" onClick={() => setPersonaSeleccionada(null)} style={{ padding: "4px 10px", fontSize: "12px" }}>
                ← Volver a resultados
              </button>
              <button className="btn primary" type="button" onClick={() => onPersonaConfirmada?.(personaSeleccionada)} style={{ padding: "4px 12px", fontSize: "12px" }}>
                Usar esta Persona
              </button>
            </div>
          </div>
          <DetallePersona persona={personaSeleccionada} />
        </div>
      )}

      {mostrarCrear && (
        <SeccionCrearPersona onCreada={() => { setMostrarCrear(false); handleBuscar(); }} />
      )}
    </div>
  );
}

function SeccionVerificarCodigoErp({ persona, onCodigoConfirmado }) {
  const [cargando, setCargando] = useState(true);
  const [codigoErpPersona, setCodigoErpPersona] = useState(null);
  const [vinculosErp, setVinculosErp] = useState([]);
  const [codigoNuevo, setCodigoNuevo] = useState("");
  const [paisKey, setPaisKey] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [verificado, setVerificado] = useState(false);
  const [conflictos, setConflictos] = useState([]);
  const [creando, setCreando] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const resp = await apiFetch(`/cajaChicaVerificarCodigoErp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId: persona.Id })
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok) {
          setCodigoErpPersona(data?.CodigoErpPersona || null);
          setVinculosErp(Array.isArray(data?.VinculosErp) ? data.VinculosErp : []);
        } else {
          showToast(data?.Message || "Error al verificar el Código ERP", "warn");
        }
      } catch (error) {
        showToast("⚠️ Error de conexión con el servidor", "warn");
      } finally {
        setCargando(false);
      }
    })();
  }, [persona.Id]);

  const handleVerificarDisponibilidad = async () => {
    const codigoTrim = codigoNuevo.trim();
    if (!codigoTrim) { showToast("Ingrese el Código ERP a verificar", "warn"); return; }
    setVerificando(true);
    setVerificado(false);
    setConflictos([]);
    try {
      const resp = await apiFetch(`/cajaChicaVerificarCodigoErpDisponible`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigoTrim, personaIdActual: persona.Id })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al verificar disponibilidad", "warn");
        return;
      }
      setVerificado(true);
      setConflictos(Array.isArray(data?.Conflictos) ? data.Conflictos : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setVerificando(false);
    }
  };

  const handleCrearCodigoErp = async () => {
    const codigoTrim = codigoNuevo.trim();
    if (!paisKey) { showToast("Seleccione el País/Sociedad", "warn"); return; }
    setCreando(true);
    try {
      const resp = await apiFetch(`/cajaChicaCrearCodigoErp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaProveedorId: persona.Id, Codigo: codigoTrim, PaisKey: paisKey })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Código ERP", "warn");
        return;
      }
      showToast(data?.Message || "✓ Código ERP creado con éxito", "ok");
      onCodigoConfirmado?.(codigoTrim);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  const tieneVinculoExistente = codigoErpPersona || vinculosErp.length > 0;
  const disponible = verificado && conflictos.length === 0;

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={2} />Verificar Código ERP de {persona.Nombre} {persona.Apellido}
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Confirma si esta Persona ya tiene un Código ERP vinculado antes de continuar.
      </div>

      {cargando && <p style={{ fontSize: "13px", color: "#697386" }}>Verificando...</p>}

      {!cargando && tieneVinculoExistente && (
        <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "8px", padding: "14px 16px" }}>
          <div style={{ fontSize: "13px", color: "#1e40af", fontWeight: "700", marginBottom: "8px" }}>
            Código ERP encontrado para {persona.Nombre} {persona.Apellido}:
          </div>
          {codigoErpPersona && (
            <div style={{ fontSize: "13px", color: "#1e3a8a", marginBottom: "4px" }}>
              • Campo directo en Persona: <strong>{codigoErpPersona}</strong>
            </div>
          )}
          {vinculosErp.map((v) => (
            <div key={v.Id} style={{ fontSize: "13px", color: "#1e3a8a", marginBottom: "4px" }}>
              • {v.Codigo} — {v.SistemaDescripcion} ({v.Pais}, Sociedad {v.Sociedad || "—"})
            </div>
          ))}
          <button className="btn primary" type="button" style={{ marginTop: "10px", padding: "4px 12px", fontSize: "12px" }}
            onClick={() => onCodigoConfirmado?.(codigoErpPersona || vinculosErp[0]?.Codigo)}>
            Continuar con este Código ERP
          </button>
        </div>
      )}

      {!cargando && !tieneVinculoExistente && (
        <div>
          <div style={{ background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px", padding: "14px 16px", marginBottom: "14px" }}>
            <span style={{ color: "#9a3412", fontSize: "13px" }}>
              ⚠️ {persona.Nombre} {persona.Apellido} no tiene ningún Código ERP vinculado todavía.
            </span>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label>Código ERP a asignar</label>
              <input
                type="text"
                value={codigoNuevo}
                onChange={(e) => { setCodigoNuevo(e.target.value); setVerificado(false); setConflictos([]); }}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
            </div>
            <button type="button" className="btn primary" onClick={handleVerificarDisponibilidad} disabled={verificando} style={{ padding: "0 16px", height: "42px" }}>
              {verificando ? "Verificando..." : "Verificar disponibilidad"}
            </button>
          </div>

          {verificado && conflictos.length > 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "14px 16px", marginTop: "14px" }}>
              <div style={{ fontSize: "13px", color: "#991b1b", fontWeight: "700", marginBottom: "8px" }}>
                Este Código ERP ya está en uso:
              </div>
              {conflictos.map((c, i) => (
                <div key={i} style={{ fontSize: "13px", color: "#991b1b" }}>
                  • {c.Nombre} {c.Apellido || ""} ({c.Tipo})
                </div>
              ))}
            </div>
          )}

          {disponible && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "14px 16px", marginTop: "14px" }}>
              <span style={{ color: "#166534", fontSize: "13px" }}>✓ El Código ERP "{codigoNuevo.trim()}" está disponible.</span>
              <div style={{ marginTop: "10px" }}>
                <div className="field" style={{ maxWidth: "260px", marginBottom: "10px" }}>
                  <label>País / Sociedad</label>
                  <select
                    value={paisKey}
                    onChange={(e) => setPaisKey(e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
                  >
                    <option value="">Seleccione...</option>
                    {PAISES_CODIGO_ERP.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn primary" type="button" style={{ padding: "4px 12px", fontSize: "12px" }}
                    onClick={handleCrearCodigoErp} disabled={creando}>
                    {creando ? "Creando..." : "Crear y usar este Código ERP"}
                  </button>
                  <button className="btn ghost" type="button" style={{ padding: "4px 12px", fontSize: "12px" }}
                    onClick={() => { setVerificado(false); setConflictos([]); }} disabled={creando}>
                    Modificar código
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Verifica si la Persona ya está creada en CFO como Proveedor (CfoNetCore.dbo.Proveedor), y si
// no, permite crearlo -- reutiliza los mismos endpoints /proveedoresCfoPorPersona y
// /crearProveedorCfo que ya usa Crear Proveedor/Cliente (ver SeccionProveedorCfo en
// CrearProveedorCliente.jsx), en vez de duplicar esa lógica (incluye el SetTipoPersonaDestino
// automático tras crear). Esos endpoints ya resuelven los nombres de Tenant/Oficiales en vez de
// devolver los Ids crudos.
function SeccionVerificarProveedorCfo({ persona, onConfirmado }) {
  const [cargando, setCargando] = useState(true);
  const [existentes, setExistentes] = useState([]);
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [tenantKey, setTenantKey] = useState("");
  const [aplicaRetencion, setAplicaRetencion] = useState("");
  const [sujetoExcluido, setSujetoExcluido] = useState("");
  const [creando, setCreando] = useState(false);
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  const cargarExistentes = async () => {
    setCargando(true);
    try {
      const resp = await apiFetch(`/proveedoresCfoPorPersona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ PersonaId: persona.Id })
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok) {
        setExistentes(Array.isArray(data) ? data : []);
      } else {
        showToast(data?.Message || "Error al validar Proveedor en CFO", "warn");
      }
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarExistentes();
  }, [persona.Id]);

  const handleCrear = async () => {
    if (!tenantKey) { showToast("Seleccione el País/Tenant", "warn"); return; }
    if (aplicaRetencion !== "si" && aplicaRetencion !== "no") { showToast("Indique si aplica Retención", "warn"); return; }
    if (sujetoExcluido !== "si" && sujetoExcluido !== "no") { showToast("Indique si es Proveedor Sujeto Excluido", "warn"); return; }
    if (!autorizador?.id) { showToast("No se pudo identificar al usuario que autoriza", "warn"); return; }

    setCreando(true);
    try {
      const resp = await apiFetch(`/crearProveedorCfo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          PersonaId: persona.Id,
          TenantKey: tenantKey,
          AplicaRetencion: aplicaRetencion === "si",
          IsProveedorSujetoExcluido: sujetoExcluido === "si",
          CreatedBy: autorizador.id
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear el Proveedor en CFO", "warn");
        return;
      }
      showToast(data?.Message || "✓ Proveedor creado en CFO", "ok");
      setMostrarCrear(false);
      setTenantKey("");
      setAplicaRetencion("");
      setSujetoExcluido("");
      await cargarExistentes();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={3} />Verificar Proveedor en CFO de {persona.Nombre} {persona.Apellido}
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Confirma si esta Persona ya está creada como Proveedor en CFO antes de continuar.
      </div>

      {cargando && <p style={{ fontSize: "13px", color: "#697386" }}>Verificando...</p>}

      {!cargando && existentes.length > 0 && (
        <div className="doc-table-wrap" style={{ maxHeight: "260px" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>País / Tenant</th>
                <th>Aplica Retención</th>
                <th>Proveedor Sujeto Excluido</th>
                <th>Oficial de Pago</th>
                <th>Oficial Solicitud de Pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {existentes.map((e) => (
                <tr key={e.Id + e.TenantKey}>
                  <td>{e.Pais}</td>
                  <td>{e.AplicaRetencion ? "Sí" : "No"}</td>
                  <td>{e.IsProveedorSujetoExcluido ? "Sí" : "No"}</td>
                  <td>{e.OficialDePagoNombre || "—"}</td>
                  <td>{e.OficialSolicitudDePagoNombre || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn soft" type="button" style={{ padding: "4px 10px", fontSize: "12px" }}
                      onClick={() => onConfirmado?.(e)}>
                      Usar este
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!cargando && existentes.length === 0 && !mostrarCrear && (
        <div style={{
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          background: "#fff7ed", border: "1px solid #fdba74", borderRadius: "8px",
          padding: "14px 16px"
        }}>
          <span style={{ color: "#9a3412", fontSize: "13px", flex: 1, minWidth: "240px" }}>
            ⚠️ {persona.Nombre} {persona.Apellido} no está creado como Proveedor en CFO.
          </span>
          <button type="button" className="btn danger" onClick={() => setMostrarCrear(true)} style={{ padding: "6px 14px", fontSize: "12px", whiteSpace: "nowrap" }}>
            + Crear Proveedor en CFO
          </button>
        </div>
      )}

      {mostrarCrear && (
        <div style={{ background: "#f6fbf3", border: "1px solid #b6d7a8", borderRadius: "8px", padding: "20px", marginTop: "16px" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "16px" }}>
            ➕ Crear Proveedor en CFO
          </div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label>País / Tenant</label>
              <select
                value={tenantKey}
                onChange={(e) => setTenantKey(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {TENANTS_PROVEEDOR_CFO.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label>¿Aplica Retención?</label>
              <select
                value={aplicaRetencion}
                onChange={(e) => setAplicaRetencion(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label>¿Es Proveedor Sujeto Excluido?</label>
              <select
                value={sujetoExcluido}
                onChange={(e) => setSujetoExcluido(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn primary" type="button" onClick={handleCrear} disabled={creando}>
              {creando ? "Creando..." : "Crear Proveedor en CFO"}
            </button>
            <button className="btn ghost" type="button" onClick={() => setMostrarCrear(false)} disabled={creando}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Formatea montos como moneda simple (sin símbolo, ya que la Moneda de cada fila puede ser
// distinta): separador de miles y 2 decimales.
function formatoMonto(valor) {
  if (valor === null || valor === undefined) return "—";
  return Number(valor).toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatoFecha(valor) {
  if (!valor) return "—";
  return String(valor).slice(0, 10);
}

// Paso 4: verificar si ya existe una Caja Chica creada -- se listan TODAS las activas (no solo
// las de la Persona en curso) para que el usuario pueda revisarlas manualmente y detectar
// duplicados, con un filtro de texto para no tener que recorrer las 30+ a mano.
function SeccionVerificarCajaChica({ persona, onConfirmado }) {
  const [cargando, setCargando] = useState(true);
  const [cajasChicas, setCajasChicas] = useState([]);
  const [filtro, setFiltro] = useState(() => `${persona.Nombre} ${persona.Apellido || ""}`.trim());
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const resp = await apiFetch(`/cajaChicaListar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await resp.json().catch(() => null);
        if (resp.ok) {
          setCajasChicas(Array.isArray(data) ? data : []);
        } else {
          showToast(data?.Message || "Error al listar Cajas Chicas", "warn");
        }
      } catch (error) {
        showToast("⚠️ Error de conexión con el servidor", "warn");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const filtroLower = filtro.trim().toLowerCase();
  const filtradas = filtroLower
    ? cajasChicas.filter((c) =>
        (c.Descripcion || "").toLowerCase().includes(filtroLower) ||
        (c.Duenio || "").toLowerCase().includes(filtroLower) ||
        (c.Sitio || "").toLowerCase().includes(filtroLower)
      )
    : cajasChicas;

  return (
    <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "20px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "4px" }}>
        <PasoBadge n={4} />Verificar si ya existe una Caja Chica creada
      </div>
      <div style={{ fontSize: "13px", color: "#697386", marginBottom: "14px" }}>
        Revisa el listado para evitar crear una Caja Chica duplicada.
      </div>

      <div className="field" style={{ maxWidth: "360px", marginBottom: "14px" }}>
        <label>Filtrar por Descripción, Dueño o Sitio</label>
        <input
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
        />
      </div>

      {cargando && <p style={{ fontSize: "13px", color: "#697386" }}>Cargando...</p>}

      {!cargando && (
        <div className="doc-table-wrap" style={{ maxHeight: "320px" }}>
          <table className="doc-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Dueño</th>
                <th>Sitio</th>
                <th>País</th>
                <th>Fondo</th>
                <th>Saldo</th>
                <th>Moneda</th>
                <th>Creado por</th>
                <th>Fecha Creación</th>
                <th>Última Modificación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((c) => (
                <tr key={c.Id}>
                  <td>{c.Descripcion}</td>
                  <td>{c.Duenio}</td>
                  <td>{c.Sitio || "—"}</td>
                  <td>{c.Pais}</td>
                  <td>{formatoMonto(c.Fondo)}</td>
                  <td>{formatoMonto(c.Saldo)}</td>
                  <td>{c.Moneda}</td>
                  <td>{c.CreatedByNombre || "—"}</td>
                  <td>{formatoFecha(c.CreatedDate)}</td>
                  <td>{formatoFecha(c.ModifiedDate)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn soft" type="button" style={{ padding: "4px 10px", fontSize: "12px" }}
                      onClick={() => onConfirmado?.(c)}>
                      Usar esta
                    </button>
                  </td>
                </tr>
              ))}
              {filtradas.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "#a3acb9" }}>Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: "14px" }}>
        <button className="btn danger" type="button" style={{ padding: "6px 14px", fontSize: "12px" }}
          onClick={() => onConfirmado?.(null)}>
          No existe — continuar para crear una nueva
        </button>
      </div>
    </div>
  );
}

// Paso 5: crear la Caja Chica -- Contexto, Sitio y Moneda se ofrecen como listas de lo ya usado
// entre los registros existentes (no un catálogo completo), tal como se pidió. Descripción y
// Fondo los ingresa el usuario; Dueño/DuenioId se traen automáticos de la Persona ya confirmada,
// y CreatedBy del administrador que inició sesión.
function SeccionCrearCajaChica({ persona, onCreada }) {
  const [descripcion, setDescripcion] = useState("");
  const [fondo, setFondo] = useState("");
  const [contextos, setContextos] = useState([]);
  const [contextoId, setContextoId] = useState("");
  const [sitios, setSitios] = useState([]);
  const [sitioId, setSitioId] = useState("");
  const [monedas, setMonedas] = useState([]);
  const [monedaValue, setMonedaValue] = useState("");
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  const [creando, setCreando] = useState(false);
  const autorizador = useAutorizadorActual();
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      setCargandoCatalogos(true);
      try {
        const [respContextos, respSitios, respMonedas] = await Promise.all([
          apiFetch(`/cajaChicaContextosUsados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
          apiFetch(`/cajaChicaSitiosUsados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
          apiFetch(`/cajaChicaMonedasUsadas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
        ]);
        const [dataContextos, dataSitios, dataMonedas] = await Promise.all([
          respContextos.json().catch(() => null),
          respSitios.json().catch(() => null),
          respMonedas.json().catch(() => null),
        ]);
        setContextos(Array.isArray(dataContextos) ? dataContextos : []);
        setSitios(Array.isArray(dataSitios) ? dataSitios : []);
        setMonedas(Array.isArray(dataMonedas) ? dataMonedas : []);
      } catch (error) {
        showToast("⚠️ Error al cargar los catálogos", "warn");
      } finally {
        setCargandoCatalogos(false);
      }
    })();
  }, []);

  const handleCrear = async () => {
    const descripcionTrim = descripcion.trim();
    const fondoNum = Number(fondo);

    if (!descripcionTrim) { showToast("La Descripción es requerida", "warn"); return; }
    if (!Number.isFinite(fondoNum) || fondoNum <= 0) { showToast("El Fondo debe ser un número mayor a 0", "warn"); return; }
    if (!contextoId) { showToast("Seleccione el Contexto", "warn"); return; }
    if (!sitioId) { showToast("Seleccione el Sitio", "warn"); return; }
    if (!monedaValue) { showToast("Seleccione la Moneda", "warn"); return; }
    if (!autorizador?.id) { showToast("No se pudo identificar al usuario que autoriza", "warn"); return; }

    const monedaElegida = monedas.find((m) => String(m.Value) === String(monedaValue));
    const duenioNombre = `${persona.Nombre} ${persona.Apellido || ""}`.trim();

    if (!window.confirm(
      `¿Confirma crear la Caja Chica "${descripcionTrim}" para ${duenioNombre}?\n\n` +
      `Fondo: ${fondoNum}\nMoneda: ${monedaElegida?.DisplayName || monedaValue}`
    )) {
      return;
    }

    setCreando(true);
    try {
      const resp = await apiFetch(`/cajaChicaCrear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Descripcion: descripcionTrim,
          DuenioId: persona.Id,
          Duenio: duenioNombre,
          MonedaValue: Number(monedaValue),
          MonedaDisplayName: monedaElegida?.DisplayName || null,
          Fondo: fondoNum,
          ContextoId: contextoId,
          SitioId: sitioId,
          CreatedBy: autorizador.id
        })
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        showToast(data?.Message || "Error al crear la Caja Chica", "warn");
        return;
      }
      showToast(data?.Message || "✓ Caja Chica creada con éxito", "ok");
      onCreada?.({ Id: data?.Id, Descripcion: descripcionTrim });
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  return (
    <div style={{ background: "#f6fbf3", border: "1px solid #b6d7a8", borderRadius: "8px", padding: "20px", marginTop: "16px" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#1a1f36", marginBottom: "16px" }}>
        <PasoBadge n={5} />Crear Caja Chica para {persona.Nombre} {persona.Apellido}
      </div>

      {cargandoCatalogos ? (
        <p style={{ fontSize: "13px", color: "#697386" }}>Cargando catálogos...</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "2 1 300px" }}>
              <label>Descripción</label>
              <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
            </div>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label>Fondo</label>
              <input type="number" min="0" step="0.01" value={fondo} onChange={(e) => setFondo(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }} />
            </div>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label>Contexto</label>
              <select
                value={contextoId}
                onChange={(e) => setContextoId(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {contextos.map((c) => (
                  <option key={c.ContextoId} value={c.ContextoId}>{c.Pais}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label>Sitio</label>
              <select
                value={sitioId}
                onChange={(e) => setSitioId(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {sitios.map((s) => (
                  <option key={s.SitioId} value={s.SitioId}>{s.Nombre}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label>Moneda</label>
              <select
                value={monedaValue}
                onChange={(e) => setMonedaValue(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#fff" }}
              >
                <option value="">Seleccione...</option>
                {monedas.map((m) => (
                  <option key={m.Value} value={m.Value}>{m.DisplayName}</option>
                ))}
              </select>
            </div>
          </div>

          <button className="btn primary" type="button" onClick={handleCrear} disabled={creando}>
            {creando ? "Creando..." : "Crear Caja Chica"}
          </button>
        </>
      )}
    </div>
  );
}

// Modal de solo lectura para ver TODAS las Cajas Chicas existentes sin pasar por los pasos del
// asistente (buscar/crear Persona, Código ERP, Proveedor en CFO) -- reutiliza el mismo endpoint
// /cajaChicaListar que ya usa el paso 4, pero aquí es independiente de cualquier Persona.
function ModalTodasCajasChicas({ onCerrar }) {
  const [cargando, setCargando] = useState(true);
  const [cajasChicas, setCajasChicas] = useState([]);
  const [filtro, setFiltro] = useState("");
  const showToast = useToast();

  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const resp = await apiFetch(`/cajaChicaListar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await resp.json().catch(() => null);
        if (resp.ok) {
          setCajasChicas(Array.isArray(data) ? data : []);
        } else {
          showToast(data?.Message || "Error al listar Cajas Chicas", "warn");
        }
      } catch (error) {
        showToast("⚠️ Error de conexión con el servidor", "warn");
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const filtroLower = filtro.trim().toLowerCase();
  const filtradas = filtroLower
    ? cajasChicas.filter((c) =>
        (c.Descripcion || "").toLowerCase().includes(filtroLower) ||
        (c.Duenio || "").toLowerCase().includes(filtroLower) ||
        (c.Sitio || "").toLowerCase().includes(filtroLower)
      )
    : cajasChicas;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
      onClick={onCerrar}
    >
      <div
        style={{ background: "#fff", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "1100px", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#1a1f36" }}>Todas las Cajas Chicas</div>
          <button className="btn ghost" type="button" onClick={onCerrar} style={{ padding: "4px 12px", fontSize: "12px" }}>
            ✕ Cerrar
          </button>
        </div>

        <div className="field" style={{ maxWidth: "360px", marginBottom: "14px" }}>
          <label>Filtrar por Descripción, Dueño o Sitio</label>
          <input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
          />
        </div>

        {cargando ? (
          <p style={{ fontSize: "13px", color: "#697386" }}>Cargando...</p>
        ) : (
          <div className="doc-table-wrap" style={{ maxHeight: "55vh" }}>
            <table className="doc-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Descripción</th>
                  <th>Dueño</th>
                  <th>Sitio</th>
                  <th>SitioId</th>
                  <th>País</th>
                  <th>ContextoId</th>
                  <th>Fondo</th>
                  <th>Saldo</th>
                  <th>Moneda</th>
                  <th>Creado por</th>
                  <th>Fecha Creación</th>
                  <th>Última Modificación</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.Id}>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{c.Id}</td>
                    <td>{c.Descripcion}</td>
                    <td>{c.Duenio}</td>
                    <td>{c.Sitio || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{c.SitioId || "—"}</td>
                    <td>{c.Pais}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{c.ContextoId || "—"}</td>
                    <td>{formatoMonto(c.Fondo)}</td>
                    <td>{formatoMonto(c.Saldo)}</td>
                    <td>{c.Moneda}</td>
                    <td>{c.CreatedByNombre || "—"}</td>
                    <td>{formatoFecha(c.CreatedDate)}</td>
                    <td>{formatoFecha(c.ModifiedDate)}</td>
                  </tr>
                ))}
                {filtradas.length === 0 && (
                  <tr><td colSpan={13} style={{ textAlign: "center", color: "#a3acb9" }}>Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CajaChica() {
  const [personaConfirmada, setPersonaConfirmada] = useState(null);
  const [codigoErpConfirmado, setCodigoErpConfirmado] = useState(null);
  const [proveedorCfoConfirmado, setProveedorCfoConfirmado] = useState(null);
  const [cajaChicaVerificada, setCajaChicaVerificada] = useState(undefined);
  const [cajaChicaEsNueva, setCajaChicaEsNueva] = useState(false);
  const [mostrarTodas, setMostrarTodas] = useState(false);

  const handleCambiarPersona = () => {
    setPersonaConfirmada(null);
    setCodigoErpConfirmado(null);
    setProveedorCfoConfirmado(null);
    setCajaChicaVerificada(undefined);
    setCajaChicaEsNueva(false);
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "100%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div>
          <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
          <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
        </div>
        <button className="btn primary" type="button" onClick={() => setMostrarTodas(true)} style={{ padding: "8px 16px", whiteSpace: "nowrap" }}>
          📋 Ver todas las Cajas Chicas
        </button>
      </div>

      {!personaConfirmada ? (
        <SeccionBuscarPersona onPersonaConfirmada={setPersonaConfirmada} />
      ) : (
        <>
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ fontSize: "14px", color: "#166534" }}>
                ✓ Solicitante: <strong>{personaConfirmada.Nombre} {personaConfirmada.Apellido}</strong> ({personaConfirmada.NombreUsuario})
              </div>
              <button className="btn ghost" type="button" onClick={handleCambiarPersona} style={{ padding: "4px 12px", fontSize: "12px" }}>
                Cambiar Persona
              </button>
            </div>
          </div>

          {!codigoErpConfirmado ? (
            <SeccionVerificarCodigoErp persona={personaConfirmada} onCodigoConfirmado={setCodigoErpConfirmado} />
          ) : (
            <>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  <div style={{ fontSize: "14px", color: "#166534" }}>
                    ✓ Código ERP: <strong>{codigoErpConfirmado}</strong>
                  </div>
                  <button className="btn ghost" type="button" onClick={() => setCodigoErpConfirmado(null)} style={{ padding: "4px 12px", fontSize: "12px" }}>
                    Cambiar Código ERP
                  </button>
                </div>
              </div>

              {!proveedorCfoConfirmado ? (
                <SeccionVerificarProveedorCfo persona={personaConfirmada} onConfirmado={setProveedorCfoConfirmado} />
              ) : (
                <>
                  <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                      <div style={{ fontSize: "14px", color: "#166534" }}>
                        ✓ Proveedor en CFO: <strong>{proveedorCfoConfirmado.Pais}</strong>
                      </div>
                      <button className="btn ghost" type="button" onClick={() => setProveedorCfoConfirmado(null)} style={{ padding: "4px 12px", fontSize: "12px" }}>
                        Cambiar Proveedor en CFO
                      </button>
                    </div>
                  </div>

                  {cajaChicaVerificada === undefined ? (
                    <SeccionVerificarCajaChica
                      persona={personaConfirmada}
                      onConfirmado={(c) => { setCajaChicaVerificada(c); setCajaChicaEsNueva(false); }}
                    />
                  ) : cajaChicaVerificada === null ? (
                    <SeccionCrearCajaChica
                      persona={personaConfirmada}
                      onCreada={(c) => { setCajaChicaVerificada(c); setCajaChicaEsNueva(true); }}
                    />
                  ) : (
                    <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "16px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                        <div style={{ fontSize: "14px", color: "#166534" }}>
                          ✓ Caja Chica: <strong>{cajaChicaVerificada.Descripcion}</strong>
                        </div>
                        <button className="btn ghost" type="button" onClick={() => { setCajaChicaVerificada(undefined); setCajaChicaEsNueva(false); }} style={{ padding: "4px 12px", fontSize: "12px" }}>
                          Volver a verificar
                        </button>
                      </div>

                      {cajaChicaEsNueva && (
                        <div style={{ marginTop: "16px" }}>
                          <div style={{ fontSize: "13px", fontWeight: "700", color: "#1a1f36", marginBottom: "8px" }}>
                            Comparte estos Ids con el compañero que hará configuraciones externas:
                          </div>
                          <div className="doc-table-wrap">
                            <table className="doc-table" style={{ width: "100%" }}>
                              <thead>
                                <tr>
                                  <th>PersonaId</th>
                                  <th>ProveedorId</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{personaConfirmada.Id}</td>
                                  <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{proveedorCfoConfirmado?.Id || "—"}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div style={{ fontSize: "13px", color: "#697386", marginTop: "12px" }}>
                        El resto del módulo (solicitud, monto, saldo del fondo, etc.) se agrega en el próximo paso.
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {mostrarTodas && <ModalTodasCajasChicas onCerrar={() => setMostrarTodas(false)} />}
    </div>
  );
}
