import { useState } from "react";
import { areas } from "../areas/index.js";

// Piezas compartidas entre AdminUsuarios (cuenta/perfil) y AdminRolesPermisos (accesos),
// para no tener dos copias del mismo checklist de permisos/Aduanas.

export function permisoKey(area, modulo) {
  return `${area}:${modulo}`;
}

// Para la bitácora: nombres legibles de los módulos de cada permiso, uno por línea.
export function formatearPermisosParaBitacora(permisosList) {
  if (!permisosList || permisosList.length === 0) return "—";
  const modulos = permisosList.map((p) => areas[p.area]?.modules?.[p.modulo]?.label || p.modulo);
  return modulos.join("\n");
}

// Botón de acción de solo ícono: el nombre de la acción se ve al pasar el mouse
// (title nativo del navegador) en vez de texto siempre visible junto al ícono.
export function IconButton({ title, onClick, bg, fg, children }) {
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

export const IconPencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const IconShield = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);
export const IconLock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
export const IconUserPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </svg>
);
export const IconUserMinus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M22 11h-6" />
  </svg>
);
export const IconPower = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);
export const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

// Mismo criterio que el catálogo de Aduanas (/auth/aduanas): alfabético por nombre visible.
function modulosOrdenados(area) {
  return Object.entries(area.modules).sort(([, a], [, b]) => a.label.localeCompare(b.label));
}

export function PermisosChecklist({ selected, onChange, disabled }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {Object.entries(areas).map(([areaKey, area]) => (
        <div key={areaKey}>
          <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", marginBottom: "6px" }}>
            {area.icon} {area.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {modulosOrdenados(area).map(([moduloKey, modulo]) => {
              const key = permisoKey(areaKey, moduloKey);
              return (
                <label key={key} title={modulo.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#334155", width: "260px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={disabled}
                    style={{ flexShrink: 0 }}
                    onChange={(e) => onChange(areaKey, moduloKey, e.target.checked)}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    {modulo.label}
                  </span>
                </label>
              );
            })}
          </div>
          {/* Sub-permisos: capacidades extra DENTRO de un módulo (ej. "poder modificar" vs
              solo "poder ver"), no son una pantalla aparte así que no viven en area.modules. */}
          {modulosOrdenados(area)
            .filter(([, modulo]) => modulo.subPermiso)
            .map(([moduloKey, modulo]) => {
              const subKey = permisoKey(areaKey, modulo.subPermiso.key);
              return (
                <label key={subKey} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#697386", marginTop: "6px", marginLeft: "16px" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(subKey)}
                    disabled={disabled}
                    onChange={(e) => onChange(areaKey, modulo.subPermiso.key, e.target.checked)}
                  />
                  {modulo.label} — {modulo.subPermiso.label}
                </label>
              );
            })}
        </div>
      ))}
    </div>
  );
}

// Lista de Aduanas a las que está restringido un usuario. Sin ninguna marcada significa "sin
// restricción" (ve todas, igual que hoy) -- se avisa en el propio checklist para que no
// parezca un bloqueo total por accidente.
export function OficinasChecklist({ catalogo, selected, onChange, disabled }) {
  const [filtro, setFiltro] = useState("");
  const filtrado = filtro.trim()
    ? catalogo.filter((o) => o.label.toLowerCase().includes(filtro.trim().toLowerCase()))
    : catalogo;

  return (
    <div>
      <p style={{ fontSize: "12px", color: "#697386", marginBottom: "8px" }}>
        Sin ninguna marcada, el usuario ve Referencias Operativas de <strong>todas</strong> las Aduanas (sin restricción).
        Marcando una o varias, solo verá las de esas Aduanas.
      </p>
      <input
        type="text"
        placeholder="Filtrar por nombre..."
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        disabled={disabled}
        style={{ width: "260px", padding: "6px 10px", fontSize: "12.5px", border: "1px solid #dcdfe6", borderRadius: "6px", marginBottom: "10px" }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", maxHeight: "220px", overflowY: "auto", border: "1px solid #eef1f5", borderRadius: "8px", padding: "10px" }}>
        {catalogo.length === 0 && <span style={{ fontSize: "12.5px", color: "#94a3b8" }}>Cargando catálogo de Aduanas...</span>}
        {filtrado.map((o) => (
          <label key={o.clave} title={o.label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#334155", width: "260px" }}>
            <input
              type="checkbox"
              checked={selected.has(o.clave)}
              disabled={disabled}
              style={{ flexShrink: 0 }}
              onChange={(e) => onChange(o.clave, e.target.checked)}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
