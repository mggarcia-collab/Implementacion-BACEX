import { Fragment, useEffect, useRef, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { areas } from "../areas/index.js";
import { useToast } from "../components/Toast.jsx";
import PasswordField from "../components/PasswordField.jsx";

function permisoKey(area, modulo) {
  return `${area}:${modulo}`;
}

// Botón de acción de solo ícono: el nombre de la acción se ve al pasar el mouse
// (title nativo del navegador) en vez de texto siempre visible junto al ícono.
function IconButton({ title, onClick, bg, fg, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "32px", height: "32px", borderRadius: "8px", border: "none", cursor: "pointer",
        background: bg, color: fg, flexShrink: 0
      }}
    >
      {children}
    </button>
  );
}

const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);
const IconLock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const IconUserPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </svg>
);
const IconUserMinus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 11h-6" />
  </svg>
);
const IconPower = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

// Busca en vivo contra la BD de Personas mientras se escribe el nombre completo, y al
// elegir una coincidencia llena también el correo y guarda el Id real (personaId) que
// se manda como ModifiedBy/UsuarioId a los servicios externos.
function PersonaBuscador({ nombre, onChangeNombre, onSeleccionar, disabled }) {
  const [resultados, setResultados] = useState([]);
  const [mostrando, setMostrando] = useState(false);
  const debounceRef = useRef(null);

  const buscar = (texto) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!texto.trim()) {
      setResultados([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const response = await apiFetch("/auth/personas/buscar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto })
        });
        const data = await response.json().catch(() => null);
        if (response.ok) setResultados(Array.isArray(data) ? data : []);
      } catch {
        // Sin resultados si falla; se puede seguir escribiendo el nombre manualmente.
      }
    }, 350);
  };

  const handleChange = (e) => {
    const texto = e.target.value;
    onChangeNombre(texto);
    setMostrando(true);
    buscar(texto);
  };

  const handleSeleccionar = (persona) => {
    onSeleccionar(persona);
    setResultados([]);
    setMostrando(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={nombre}
        onChange={handleChange}
        onFocus={() => setMostrando(true)}
        onBlur={() => setTimeout(() => setMostrando(false), 150)}
        disabled={disabled}
        placeholder="Escriba para buscar en Personas..."
        autoComplete="off"
      />
      {mostrando && resultados.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
          background: "white", border: "1px solid #dcdfe6", borderRadius: "6px",
          boxShadow: "0 8px 20px rgba(0,0,0,0.12)", maxHeight: "220px", overflowY: "auto"
        }}>
          {resultados.map((p) => (
            <div
              key={p.id}
              onMouseDown={() => handleSeleccionar(p)}
              style={{ padding: "8px 12px", fontSize: "13px", cursor: "pointer", borderBottom: "1px solid #f1f2f4" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f8f9fa")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <div style={{ fontWeight: "600", color: "#1a1f36" }}>{p.nombre}</div>
              <div style={{ color: "#94a3b8", fontSize: "11px" }}>{p.correo}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PermisosChecklist({ selected, onChange, disabled }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {Object.entries(areas).map(([areaKey, area]) => (
        <div key={areaKey}>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "6px" }}>
            {area.icon} {area.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {Object.entries(area.modules).map(([moduloKey, modulo]) => {
              const key = permisoKey(areaKey, moduloKey);
              return (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#334155" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={disabled}
                    onChange={(e) => onChange(areaKey, moduloKey, e.target.checked)}
                  />
                  {modulo.label}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export const meta = {
  label: "Usuarios",
  icon: "👤",
  desc: "Crea usuarios y define a qué módulos tiene acceso cada uno",
};

export default function AdminUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  const [nombreUsuario, setNombreUsuario] = useState("");
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [correo, setCorreo] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [permisos, setPermisos] = useState(() => new Set());
  const [creando, setCreando] = useState(false);

  const [editingUserId, setEditingUserId] = useState(null);
  const [editingPermisos, setEditingPermisos] = useState(() => new Set());
  const [savingPermisos, setSavingPermisos] = useState(false);

  const [editingPasswordUserId, setEditingPasswordUserId] = useState(null);
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [editingPerfilUserId, setEditingPerfilUserId] = useState(null);
  const [editNombreCompleto, setEditNombreCompleto] = useState("");
  const [editCorreo, setEditCorreo] = useState("");
  const [editPersonaId, setEditPersonaId] = useState("");
  const [savingPerfil, setSavingPerfil] = useState(false);

  const cargarUsuarios = async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/auth/usuarios");
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudieron cargar los usuarios", "warn");
        return;
      }
      setUsuarios(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleSeleccionarPersona = (persona) => {
    setNombreCompleto(persona.nombre);
    setCorreo(persona.correo || "");
    setPersonaId(persona.id);
  };

  const togglePermiso = (area, modulo, checked) => {
    setPermisos((prev) => {
      const next = new Set(prev);
      const key = permisoKey(area, modulo);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };

  const limpiarFormulario = () => {
    setNombreUsuario("");
    setNombreCompleto("");
    setCorreo("");
    setPersonaId("");
    setPassword("");
    setIsAdmin(false);
    setPermisos(new Set());
  };

  const handleCrear = async (e) => {
    e.preventDefault();
    if (!nombreUsuario.trim() || !nombreCompleto.trim() || !password) {
      showToast("Complete usuario, nombre completo y contraseña", "warn");
      return;
    }
    setCreando(true);
    try {
      const permisosArray = [...permisos].map((key) => {
        const [area, modulo] = key.split(":");
        return { area, modulo };
      });
      const response = await apiFetch("/auth/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombreUsuario: nombreUsuario.trim(),
          nombreCompleto: nombreCompleto.trim(),
          correo: correo.trim(),
          personaId,
          password,
          isAdmin,
          permisos: permisosArray
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al crear el usuario`, "warn");
        return;
      }
      showToast("✓ Usuario creado con éxito", "ok");
      limpiarFormulario();
      cargarUsuarios();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setCreando(false);
    }
  };

  const toggleEditingPermiso = (area, modulo, checked) => {
    setEditingPermisos((prev) => {
      const next = new Set(prev);
      const key = permisoKey(area, modulo);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };

  const abrirEdicionPermisos = (usuario) => {
    setEditingUserId(usuario.id);
    setEditingPermisos(new Set(usuario.permisos.map((p) => permisoKey(p.area, p.modulo))));
  };

  const cancelarEdicionPermisos = () => {
    setEditingUserId(null);
    setEditingPermisos(new Set());
  };

  const guardarPermisos = async (usuarioId) => {
    setSavingPermisos(true);
    try {
      const permisosArray = [...editingPermisos].map((key) => {
        const [area, modulo] = key.split(":");
        return { area, modulo };
      });
      const response = await apiFetch(`/auth/usuarios/${usuarioId}/permisos`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permisos: permisosArray })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudieron actualizar los permisos", "warn");
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === usuarioId ? { ...u, permisos: permisosArray } : u)));
      showToast("✓ Permisos actualizados", "ok");
      cancelarEdicionPermisos();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setSavingPermisos(false);
    }
  };

  const abrirEdicionPerfil = (usuario) => {
    setEditingPerfilUserId(usuario.id);
    setEditNombreCompleto(usuario.nombreCompleto);
    setEditCorreo(usuario.correo || "");
    setEditPersonaId(usuario.personaId || "");
  };

  const handleSeleccionarPersonaEdicion = (persona) => {
    setEditNombreCompleto(persona.nombre);
    setEditCorreo(persona.correo || "");
    setEditPersonaId(persona.id);
  };

  const cancelarEdicionPerfil = () => {
    setEditingPerfilUserId(null);
  };

  const guardarPerfil = async (usuarioId) => {
    if (!editNombreCompleto.trim()) {
      showToast("El nombre completo es requerido", "warn");
      return;
    }
    setSavingPerfil(true);
    try {
      const response = await apiFetch(`/auth/usuarios/${usuarioId}/perfil`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreCompleto: editNombreCompleto.trim(), correo: editCorreo.trim(), personaId: editPersonaId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudo actualizar el perfil", "warn");
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === usuarioId ? { ...u, nombreCompleto: editNombreCompleto.trim(), correo: editCorreo.trim(), personaId: editPersonaId || u.personaId } : u)));
      showToast("✓ Perfil actualizado", "ok");
      cancelarEdicionPerfil();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setSavingPerfil(false);
    }
  };

  const abrirCambioPassword = (usuario) => {
    setEditingPasswordUserId(usuario.id);
    setNuevaPassword("");
  };

  const cancelarCambioPassword = () => {
    setEditingPasswordUserId(null);
    setNuevaPassword("");
  };

  const guardarPassword = async (usuarioId) => {
    if (!nuevaPassword || nuevaPassword.length < 6) {
      showToast("La contraseña debe tener al menos 6 caracteres", "warn");
      return;
    }
    setSavingPassword(true);
    try {
      const response = await apiFetch(`/auth/usuarios/${usuarioId}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nuevaPassword })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudo actualizar la contraseña", "warn");
        return;
      }
      showToast("✓ Contraseña actualizada", "ok");
      cancelarCambioPassword();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setSavingPassword(false);
    }
  };

  const toggleAdmin = async (usuario) => {
    const nuevoValor = !usuario.isAdmin;
    if (!nuevoValor && !window.confirm(`¿Quitarle el rol de administrador a ${usuario.nombreCompleto}?`)) {
      return;
    }
    try {
      const response = await apiFetch(`/auth/usuarios/${usuario.id}/admin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: nuevoValor })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudo actualizar el rol del usuario", "warn");
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, isAdmin: nuevoValor } : u)));
      showToast(data?.Message || "Actualizado", "ok");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    }
  };

  const toggleActivo = async (usuario) => {
    try {
      const response = await apiFetch(`/auth/usuarios/${usuario.id}/activo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !usuario.activo })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || "No se pudo actualizar el usuario", "warn");
        return;
      }
      setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, activo: !u.activo } : u)));
      showToast(data?.Message || "Actualizado", "ok");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "none" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>Administración de Usuarios</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>Crea usuarios y define a qué módulos tiene acceso cada uno</div>
      </div>

      <form onSubmit={handleCrear} style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "30px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Usuario</label>
            <input type="text" value={nombreUsuario} onChange={(e) => setNombreUsuario(e.target.value)} disabled={creando} autoComplete="off" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Nombre completo (busca en Personas)</label>
            <PersonaBuscador
              nombre={nombreCompleto}
              onChangeNombre={(texto) => { setNombreCompleto(texto); setPersonaId(""); }}
              onSeleccionar={handleSeleccionarPersona}
              disabled={creando}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Correo</label>
            <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={creando} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Contraseña</label>
            <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} disabled={creando} autoComplete="new-password" />
          </div>
          <div className="field" style={{ marginBottom: 0, display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "500" }}>
              <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} disabled={creando} />
              Administrador (acceso a todo, incluida esta pantalla)
            </label>
          </div>
        </div>

        {!isAdmin && (
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Módulos permitidos
            </label>
            <PermisosChecklist selected={permisos} onChange={togglePermiso} disabled={creando} />
          </div>
        )}

        <button className="btn primary" type="submit" disabled={creando}>
          {creando ? "Creando..." : "Crear usuario"}
        </button>
      </form>

      <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "#1a1f36" }}>Usuarios existentes</h3>
      {loading ? (
        <p style={{ color: "#697386", fontSize: "14px" }}>Cargando...</p>
      ) : usuarios.length === 0 ? (
        <p style={{ color: "#697386", fontSize: "14px" }}>No hay usuarios registrados todavía.</p>
      ) : (
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre completo</th>
                <th>Correo</th>
                <th>Tipo</th>
                <th>Módulos</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <Fragment key={u.id}>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155" }}>{u.nombreUsuario}</td>
                    <td>{u.nombreCompleto}</td>
                    <td>{u.correo || "—"}</td>
                    <td>{u.isAdmin ? "Administrador" : "Estándar"}</td>
                    <td>{u.isAdmin ? "Todos" : (u.permisos.length || "Ninguno")}</td>
                    <td>{u.activo ? "Activo" : "Inactivo"}</td>
                    <td style={{ textAlign: "right", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <IconButton
                        title={editingPerfilUserId === u.id ? "Cerrar edición de perfil" : "Editar perfil"}
                        bg="#e0edff" fg="#2563eb"
                        onClick={() => (editingPerfilUserId === u.id ? cancelarEdicionPerfil() : abrirEdicionPerfil(u))}
                      >
                        <IconPencil />
                      </IconButton>
                      <IconButton
                        title={editingUserId === u.id ? "Cerrar edición de permisos" : "Editar permisos"}
                        bg="#e0e7ff" fg="#4338ca"
                        onClick={() => (editingUserId === u.id ? cancelarEdicionPermisos() : abrirEdicionPermisos(u))}
                      >
                        <IconShield />
                      </IconButton>
                      <IconButton
                        title={editingPasswordUserId === u.id ? "Cerrar cambio de contraseña" : "Cambiar contraseña"}
                        bg="#eef0f2" fg="#475569"
                        onClick={() => (editingPasswordUserId === u.id ? cancelarCambioPassword() : abrirCambioPassword(u))}
                      >
                        <IconLock />
                      </IconButton>
                      <IconButton
                        title={u.isAdmin ? "Quitar administrador" : "Hacer administrador"}
                        bg={u.isAdmin ? "#f3e8ff" : "#dcfce7"}
                        fg={u.isAdmin ? "#7e22ce" : "#16a34a"}
                        onClick={() => toggleAdmin(u)}
                      >
                        {u.isAdmin ? <IconUserMinus /> : <IconUserPlus />}
                      </IconButton>
                      <IconButton
                        title={u.activo ? "Desactivar" : "Activar"}
                        bg={u.activo ? "#fee2e2" : "#dcfce7"}
                        fg={u.activo ? "#dc2626" : "#16a34a"}
                        onClick={() => toggleActivo(u)}
                      >
                        {u.activo ? <IconTrash /> : <IconPower />}
                      </IconButton>
                    </td>
                  </tr>
                  {editingPerfilUserId === u.id && (
                    <tr>
                      <td colSpan={7} style={{ background: "#f8f9fa", padding: "18px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "12px" }}>
                          Editar perfil de {u.nombreCompleto}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "560px" }}>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Nombre completo (busca en Personas)</label>
                            <PersonaBuscador
                              nombre={editNombreCompleto}
                              onChangeNombre={(texto) => setEditNombreCompleto(texto)}
                              onSeleccionar={handleSeleccionarPersonaEdicion}
                              disabled={savingPerfil}
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Correo</label>
                            <input type="email" value={editCorreo} onChange={(e) => setEditCorreo(e.target.value)} disabled={savingPerfil} />
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                          <button className="btn primary" onClick={() => guardarPerfil(u.id)} disabled={savingPerfil} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            {savingPerfil ? "Guardando..." : "Guardar perfil"}
                          </button>
                          <button className="btn ghost" onClick={cancelarEdicionPerfil} disabled={savingPerfil} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {editingUserId === u.id && (
                    <tr>
                      <td colSpan={7} style={{ background: "#f8f9fa", padding: "18px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "12px" }}>
                          Permisos de {u.nombreCompleto}
                        </div>
                        <PermisosChecklist selected={editingPermisos} onChange={toggleEditingPermiso} disabled={savingPermisos} />
                        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                          <button className="btn primary" onClick={() => guardarPermisos(u.id)} disabled={savingPermisos} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            {savingPermisos ? "Guardando..." : "Guardar permisos"}
                          </button>
                          <button className="btn ghost" onClick={cancelarEdicionPermisos} disabled={savingPermisos} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {editingPasswordUserId === u.id && (
                    <tr>
                      <td colSpan={7} style={{ background: "#f8f9fa", padding: "18px" }}>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "12px" }}>
                          Nueva contraseña para {u.nombreCompleto}
                        </div>
                        <div style={{ maxWidth: "320px" }}>
                          <PasswordField
                            value={nuevaPassword}
                            onChange={(e) => setNuevaPassword(e.target.value)}
                            disabled={savingPassword}
                            autoComplete="new-password"
                          />
                        </div>
                        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                          <button className="btn primary" onClick={() => guardarPassword(u.id)} disabled={savingPassword} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            {savingPassword ? "Guardando..." : "Guardar contraseña"}
                          </button>
                          <button className="btn ghost" onClick={cancelarCambioPassword} disabled={savingPassword} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
