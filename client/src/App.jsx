import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { areas } from "./areas/index.js";
import { ToastProvider } from "./components/Toast.jsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import Login from "./auth/Login.jsx";
import AdminUsuarios, { meta as adminUsuariosMeta } from "./auth/AdminUsuarios.jsx";
import AdminBitacora, { meta as adminBitacoraMeta } from "./auth/AdminBitacora.jsx";
import ActividadReciente from "./components/ActividadReciente.jsx";

const ADMIN_KEY = "__admin__";

function saludoSegunHora() {
  const hora = new Date().getHours();
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

const fechaFormatter = new Intl.DateTimeFormat("es-HN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// Administración no depende de permisos por módulo (es todo o nada según isAdmin),
// así que se arma aparte en vez de pasar por el filtro de permisos de "areas".
const adminArea = {
  label: "Administración",
  modules: {
    usuarios: { ...adminUsuariosMeta, Component: AdminUsuarios },
    bitacora: { ...adminBitacoraMeta, Component: AdminBitacora },
  },
};

function AppShell() {
  const { usuario, logout, hasPermission } = useAuth();
  const saludo = saludoSegunHora();
  const fechaHoy = fechaFormatter.format(new Date());

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClickFuera = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickFuera);
    return () => document.removeEventListener("mousedown", handleClickFuera);
  }, [userMenuOpen]);

  const visibleAreas = useMemo(() => {
    const result = {};
    for (const [areaKey, area] of Object.entries(areas)) {
      const visibleModules = Object.fromEntries(
        Object.entries(area.modules).filter(([moduloKey]) => hasPermission(areaKey, moduloKey))
      );
      if (Object.keys(visibleModules).length > 0) {
        result[areaKey] = { ...area, modules: visibleModules };
      }
    }
    return result;
  }, [hasPermission]);

  const areaKeys = Object.keys(visibleAreas);
  // Nada seleccionado al entrar: se ve una bienvenida hasta que se elija un módulo
  // puntual desde el sidebar, en vez de aterrizar de una vez en el Panel de Control
  // de la primera área.
  const [activeArea, setActiveArea] = useState(null);
  const [activeModule, setActiveModule] = useState(null);
  const [expandedAreas, setExpandedAreas] = useState(() => new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Qué área quedó "abierta" dentro de las tarjetas de acceso directo de Inicio,
  // para mostrar sus submódulos ahí mismo en vez de mandar a mirar el sidebar.
  const [homeAreaKey, setHomeAreaKey] = useState(null);

  const toggleAreaExpand = (areaKey) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(areaKey)) next.delete(areaKey); else next.add(areaKey);
      return next;
    });
  };

  // Clic en un ícono del riel colapsado: siempre abre el sidebar completo con esa
  // área desplegada (a diferencia del acordeón normal, nunca la vuelve a cerrar).
  const handleRailClick = (areaKey) => {
    setSidebarOpen(true);
    setExpandedAreas((prev) => new Set(prev).add(areaKey));
  };

  const handleSelectModule = (areaKey, moduloKey) => {
    setActiveArea(areaKey);
    setActiveModule(moduloKey);
    setExpandedAreas((prev) => new Set(prev).add(areaKey));
  };

  const handleExitModule = () => {
    setActiveArea(null);
    setActiveModule(null);
  };

  const isAdminScreen = activeArea === ADMIN_KEY;
  const currentAreaObj = isAdminScreen ? adminArea : (activeArea ? visibleAreas[activeArea] : null);
  const currentModules = currentAreaObj?.modules || {};
  const mod = currentAreaObj && activeModule ? currentModules[activeModule] : null;
  const ActiveComponent = mod?.Component;

  const renderSubmodulo = (areaKey, moduloKey, modulo) => (
    <div
      key={moduloKey}
      className={`submod-item${activeArea === areaKey && activeModule === moduloKey ? " active" : ""}`}
      onClick={() => handleSelectModule(areaKey, moduloKey)}
    >
      <span className="submod-icon">{modulo.icon}</span>
      <span>{modulo.label}</span>
    </div>
  );

  // Si el área define "groups" (ej. CFO), los módulos se agrupan bajo un encabezado
  // para que una lista larga no se vea como un bloque plano; si no, se listan directo.
  const renderSubmodulos = (areaKey, area) => {
    if (area.groups) {
      return (
        <div className="submod-list">
          {area.groups.map((grupo) => {
            const modulosDelGrupo = grupo.modules.filter((k) => area.modules[k]);
            if (modulosDelGrupo.length === 0) return null;
            return (
              <div key={grupo.label} className="submod-group">
                <div className="submod-group-label">{grupo.label}</div>
                {modulosDelGrupo.map((moduloKey) => renderSubmodulo(areaKey, moduloKey, area.modules[moduloKey]))}
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div className="submod-list">
        {Object.entries(area.modules).map(([moduloKey, modulo]) => renderSubmodulo(areaKey, moduloKey, modulo))}
      </div>
    );
  };

  return (
    <div className="app">
      <header className="topbar" style={{ display: "grid", gridTemplateColumns: "260px 1fr 260px", alignItems: "center", height: "70px" }}>
        <div className="topbar-left" style={{ display: "flex", alignItems: "center", gap: "12px", paddingLeft: "20px" }}>
          <button className="topbar-hamburger" onClick={() => setSidebarOpen((prev) => !prev)} title={sidebarOpen ? "Ocultar módulos" : "Mostrar módulos"}>☰</button>
          <img src="/vesta-logo.png" alt="" style={{ width: "26px", height: "26px", borderRadius: "50%", objectFit: "cover" }} />
          <span className="brand">Bac<span>-Ex</span></span>
        </div>
        <div className="topbar-center" style={{ justifySelf: "center" }}>
          <button className="topbar-home" onClick={handleExitModule} title="Ir al inicio">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
            </svg>
            Inicio
          </button>
        </div>
        <div className="topbar-right" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "20px" }}>
          <div className="topbar-user" ref={userMenuRef}>
            <button className="topbar-user-trigger" onClick={() => setUserMenuOpen((prev) => !prev)}>
              <span className="topbar-user-name">{usuario.nombreCompleto}</span>
              <div className="topbar-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                </svg>
              </div>
              <span className="topbar-user-chevron" style={{ transform: userMenuOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
            </button>
            {userMenuOpen && (
              <div className="topbar-user-menu">
                <button className="topbar-user-menu-item" onClick={logout}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="main">
        {/* SIDEBAR NAVEGACIÓN GLOBAL */}
        {!sidebarOpen && (
          <div className="sidebar-collapsed-rail">
            {visibleAreas.cfo && (
              <div className="mod-icon blue" style={{ cursor: "pointer" }} title="CFO" onClick={() => handleRailClick("cfo")}>📊</div>
            )}
            {visibleAreas.red && (
              <div className="mod-icon green" style={{ cursor: "pointer" }} title="Análisis de Red" onClick={() => handleRailClick("red")}>🔗</div>
            )}
            {visibleAreas.errores25 && (
              <div className="mod-icon red" style={{ cursor: "pointer" }} title="Errores" onClick={() => handleRailClick("errores25")}>⚠️</div>
            )}
            {usuario.isAdmin && (
              <div className="mod-icon amber" style={{ cursor: "pointer" }} title="Administración" onClick={() => handleRailClick(ADMIN_KEY)}>👤</div>
            )}
          </div>
        )}
        <aside className="sidebar" style={sidebarOpen ? undefined : { display: "none" }}>
          <div className="sidebar-label">
            <span>Módulos</span>
          </div>

          {visibleAreas.cfo && (
            <div>
              <div className={`mod-item m-cfo${activeArea === "cfo" ? " active" : ""}`} onClick={() => toggleAreaExpand("cfo")}>
                <div className="mod-icon blue">📊</div>
                <div className="mod-name"><strong>CFO</strong><span>Finanzas</span></div>
                <div className="mod-chevron" style={{ transform: expandedAreas.has("cfo") ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</div>
              </div>
              {expandedAreas.has("cfo") && renderSubmodulos("cfo", visibleAreas.cfo)}
            </div>
          )}

          {visibleAreas.red && (
            <div>
              <div className={`mod-item m-red${activeArea === "red" ? " active" : ""}`} onClick={() => toggleAreaExpand("red")}>
                <div className="mod-icon green">🔗</div>
                <div className="mod-name"><strong>Análisis de Red</strong><span>Conectividad</span></div>
                <div className="mod-chevron" style={{ transform: expandedAreas.has("red") ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</div>
              </div>
              {expandedAreas.has("red") && renderSubmodulos("red", visibleAreas.red)}
            </div>
          )}

          {visibleAreas.errores25 && (
            <div>
              <div className={`mod-item m-err${activeArea === "errores25" ? " active" : ""}`} onClick={() => toggleAreaExpand("errores25")}>
                <div className="mod-icon red">⚠️</div>
                <div className="mod-name">
                  <strong>Errores <span className="badge">25+</span></strong>
                  <span>Seguimiento</span>
                </div>
                <div className="mod-chevron" style={{ transform: expandedAreas.has("errores25") ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</div>
              </div>
              {expandedAreas.has("errores25") && renderSubmodulos("errores25", visibleAreas.errores25)}
            </div>
          )}

          {usuario.isAdmin && (
            <div>
              <div className={`mod-item${isAdminScreen ? " active" : ""}`} onClick={() => toggleAreaExpand(ADMIN_KEY)}>
                <div className="mod-icon amber">👤</div>
                <div className="mod-name"><strong>Administración</strong><span>Usuarios y permisos</span></div>
                <div className="mod-chevron" style={{ transform: expandedAreas.has(ADMIN_KEY) ? "rotate(0deg)" : "rotate(-90deg)" }}>▾</div>
              </div>
              {expandedAreas.has(ADMIN_KEY) && renderSubmodulos(ADMIN_KEY, adminArea)}
            </div>
          )}
        </aside>

        <main className="content" style={{ position: "relative" }}>
          {areaKeys.length === 0 && !usuario.isAdmin ? (
            <div className="panel" style={{ position: "relative" }}>
              <div className="panel-header">
                <h1>Sin módulos asignados</h1>
                <p>Todavía no tienes acceso a ningún módulo. Pídele a un administrador que te asigne permisos.</p>
              </div>
            </div>
          ) : !mod ? (
            <div className="panel" style={{ position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                zIndex: 0, opacity: 0.08, pointerEvents: "none", userSelect: "none",
                width: "420px", height: "420px", display: "flex", justifyContent: "center", alignItems: "center"
              }}>
                <img src="/vesta-logo.png" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              </div>
              <div className="panel-header" style={{ position: "relative", zIndex: 1 }}>
                <h1>{saludo}{usuario.nombreCompleto ? `, ${usuario.nombreCompleto}` : ""}</h1>
                <p style={{ textTransform: "capitalize" }}>{fechaHoy}</p>
              </div>

              {(() => {
                const todasAreas = [...Object.entries(visibleAreas), ...(usuario.isAdmin ? [[ADMIN_KEY, adminArea]] : [])];
                const areaAbierta = todasAreas.find(([areaKey]) => areaKey === homeAreaKey);

                if (areaAbierta) {
                  const [areaKey, area] = areaAbierta;
                  return (
                    <div style={{ position: "relative", zIndex: 1 }}>
                      <button className="back-btn" onClick={() => setHomeAreaKey(null)} style={{ marginBottom: "12px" }}>← {area.label}</button>
                      <div className="home-grid">
                        {Object.entries(area.modules).map(([moduloKey, modulo]) => (
                          <div
                            key={moduloKey}
                            className={`home-card${modulo.kind === "danger" ? " danger" : ""}`}
                            onClick={() => handleSelectModule(areaKey, moduloKey)}
                          >
                            <div className={`card-icon${modulo.kind === "danger" ? " red" : ""}`}>{modulo.icon}</div>
                            <h4>{modulo.label}</h4>
                            <p>{modulo.desc}</p>
                            <div className="card-arr">→</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="home-grid" style={{ position: "relative", zIndex: 1 }}>
                    {todasAreas.map(([areaKey, area]) => (
                      <div key={areaKey} className="home-card" onClick={() => setHomeAreaKey(areaKey)}>
                        <div className="card-icon">{area.icon || "👤"}</div>
                        <h4>{area.label}</h4>
                        <p>{Object.keys(area.modules).length} módulo{Object.keys(area.modules).length !== 1 ? "s" : ""}</p>
                        <div className="card-arr">→</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <ActividadReciente limite={10} />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <button className="back-btn" onClick={handleExitModule} title="Salir" style={{ fontSize: "18px", lineHeight: 1 }}>←</button>
                <div className="breadcrumb">{currentAreaObj.label} › <span>{mod.label}</span></div>
              </div>

              <div className="panel" style={{ position: "relative" }}>
                {/* Watermark */}
                <div style={{
                  position: "absolute", bottom: "15px", right: "25px", zIndex: 0, opacity: 0.15,
                  pointerEvents: "none", userSelect: "none", width: "160px", height: "160px",
                  display: "flex", justifyContent: "center", alignItems: "center"
                }}>
                  <img src="/vesta-logo.png" alt="Vesta Watermark" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "darken" }} />
                </div>

                <div style={{ position: "relative", zIndex: 1 }}>
                  <ActiveComponent onNavigate={handleSelectModule} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function AuthGate() {
  const { usuario } = useAuth();
  return usuario ? <AppShell /> : <Login />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ToastProvider>
  );
}
