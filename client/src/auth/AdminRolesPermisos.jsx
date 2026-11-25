import { Fragment, useEffect, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { useToast } from "../components/Toast.jsx";
import {
  permisoKey, formatearPermisosParaBitacora,
  IconButton, IconShield,
  PermisosChecklist, OficinasChecklist
} from "./permisosCompartido.jsx";

export const meta = {
  label: "Módulos y Aduanas",
  icon: "🛡️",
  desc: "Define a qué módulos y Aduanas tiene acceso cada usuario",
};

export default function AdminRolesPermisos() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalogoOficinas, setCatalogoOficinas] = useState([]);
  const showToast = useToast();

  const [editingUserId, setEditingUserId] = useState(null);
  const [editingPermisos, setEditingPermisos] = useState(() => new Set());
  const [editingOficinas, setEditingOficinas] = useState(() => new Set());
  const [savingPermisos, setSavingPermisos] = useState(false);

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
    (async () => {
      try {
        const response = await apiFetch("/auth/aduanas");
        const data = await response.json().catch(() => []);
        if (response.ok) setCatalogoOficinas(Array.isArray(data) ? data : []);
      } catch {
        // Si falla, el checklist se queda vacío/"Cargando..." -- no bloquea el resto de la pantalla.
      }
    })();
  }, []);

  const abrirEdicionPermisos = (usuario) => {
    setEditingUserId(usuario.id);
    setEditingPermisos(new Set(usuario.permisos.map((p) => permisoKey(p.area, p.modulo))));
    setEditingOficinas(new Set(usuario.oficinasPermitidas || []));
  };

  const cancelarEdicionPermisos = () => {
    setEditingUserId(null);
    setEditingPermisos(new Set());
    setEditingOficinas(new Set());
  };

  const toggleEditingPermiso = (area, modulo, checked) => {
    setEditingPermisos((prev) => {
      const next = new Set(prev);
      const key = permisoKey(area, modulo);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };

  const toggleEditingOficina = (oficinaVenta, checked) => {
    setEditingOficinas((prev) => {
      const next = new Set(prev);
      if (checked) next.add(oficinaVenta); else next.delete(oficinaVenta);
      return next;
    });
  };

  // Guarda permisos de módulo y Oficinas permitidas juntos (un solo botón en pantalla),
  // aunque sean dos endpoints distintos -- evita que quede ambiguo cuál de los dos quedó
  // guardado si solo uno fallara.
  const guardarPermisos = async (usuarioId) => {
    setSavingPermisos(true);
    try {
      const permisosArray = [...editingPermisos].map((key) => {
        const [area, modulo] = key.split(":");
        return { area, modulo };
      });
      const usuarioActual = usuarios.find((u) => u.id === usuarioId);
      const antesPermisos = formatearPermisosParaBitacora(usuarioActual?.permisos);
      const despuesPermisos = formatearPermisosParaBitacora(permisosArray);
      const oficinasArray = [...editingOficinas];

      const [respPermisos, respOficinas] = await Promise.all([
        apiFetch(`/auth/usuarios/${usuarioId}/permisos`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permisos: permisosArray, antesPermisos, despuesPermisos })
        }),
        apiFetch(`/auth/usuarios/${usuarioId}/oficinas`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oficinas: oficinasArray })
        })
      ]);
      const dataPermisos = await respPermisos.json().catch(() => null);
      const dataOficinas = await respOficinas.json().catch(() => null);
      if (!respPermisos.ok || !respOficinas.ok) {
        showToast((!respPermisos.ok ? dataPermisos?.Message : dataOficinas?.Message) || "No se pudieron actualizar los accesos", "warn");
        return;
      }
      setUsuarios((prev) => prev.map((u) => (
        u.id === usuarioId ? { ...u, permisos: permisosArray, oficinasPermitidas: oficinasArray.length > 0 ? oficinasArray : null } : u
      )));
      showToast("✓ Accesos actualizados", "ok");
      cancelarEdicionPermisos();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setSavingPermisos(false);
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "none" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>Módulos y Aduanas</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>Define a qué módulos y Aduanas tiene acceso cada usuario</div>
      </div>

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
                <th>Tipo</th>
                <th>Módulos</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <Fragment key={u.id}>
                  <tr>
                    <td style={{ fontWeight: "600", color: "#334155" }}>{u.nombreUsuario}</td>
                    <td>{u.nombreCompleto}</td>
                    <td>{u.isAdmin ? "Administrador" : "Estándar"}</td>
                    <td>
                      {u.isAdmin ? "Todos" : (u.permisos.length || "Ninguno")}
                      {!u.isAdmin && u.oficinasPermitidas && (
                        <div style={{ fontSize: "11px", color: "#b45309", marginTop: "2px" }}>
                          🛃 Restringido a {u.oficinasPermitidas.length} Aduana{u.oficinasPermitidas.length !== 1 ? "s" : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <IconButton
                        title={editingUserId === u.id ? "Cerrar edición de permisos" : "Editar permisos"}
                        bg="#e0e7ff" fg="#4338ca"
                        onClick={() => (editingUserId === u.id ? cancelarEdicionPermisos() : abrirEdicionPermisos(u))}
                      >
                        <IconShield />
                      </IconButton>
                    </td>
                  </tr>
                  {editingUserId === u.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "#f8f9fa", padding: "18px" }}>
                        {u.isAdmin && (
                          <p style={{ fontSize: "12px", color: "#b45309", marginBottom: "12px" }}>
                            {u.nombreCompleto} es administrador: ya tiene acceso a todos los módulos sin importar lo que se marque aquí.
                          </p>
                        )}
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "12px" }}>
                          Módulos permitidos
                        </div>
                        <PermisosChecklist selected={editingPermisos} onChange={toggleEditingPermiso} disabled={savingPermisos} />
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginTop: "20px", marginBottom: "12px" }}>
                          Aduanas permitidas
                        </div>
                        <OficinasChecklist catalogo={catalogoOficinas} selected={editingOficinas} onChange={toggleEditingOficina} disabled={savingPermisos} />
                        <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                          <button className="btn primary" onClick={() => guardarPermisos(u.id)} disabled={savingPermisos} style={{ padding: "6px 14px", fontSize: "12px" }}>
                            {savingPermisos ? "Guardando..." : "Guardar accesos"}
                          </button>
                          <button className="btn ghost" onClick={cancelarEdicionPermisos} disabled={savingPermisos} style={{ padding: "6px 14px", fontSize: "12px" }}>
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
