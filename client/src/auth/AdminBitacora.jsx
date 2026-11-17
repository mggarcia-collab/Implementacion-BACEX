import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../apiClient.js";
import { useToast } from "../components/Toast.jsx";
import { areas } from "../areas/index.js";
import { meta as adminUsuariosMeta } from "./AdminUsuarios.jsx";
import {
  categoriaActividad,
  ACTIVIDADES_DISPONIBLES,
  COLORES_ACTIVIDAD,
  COLORES_AREA,
  COLOR_AREA_DEFAULT,
  Pill,
} from "../components/bitacoraEstilos.jsx";

export const meta = {
  label: "Bitácora",
  icon: "📜",
  desc: "Historial completo de actividades",
};

const formatoFecha = new Intl.DateTimeFormat("es-HN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TAMANO_PAGINA = 10;

function parsearFecha(valorFecha) {
  // SQL Server (Bitacora real) ya manda ISO con "T" y "Z"; el respaldo local en
  // SQLite guarda "YYYY-MM-DD HH:MM:SS" sin zona, así que solo a ese formato hay
  // que agregarle la "Z" para que el navegador no lo interprete como hora local.
  const texto = String(valorFecha);
  return texto.includes("T") ? new Date(texto) : new Date(texto.replace(" ", "T") + "Z");
}

// datosAntes/datosDespues llegan como JSON ({ Campo: valor, ... }) cuando el módulo
// pudo capturar el dato puntual, o como texto simple si el caller ya armó el mensaje
// a mano. Arma, por cada campo, una fila { campo, antes, despues } para que la
// Bitácora la muestre en dos columnas separadas en vez de un solo texto con flecha
// (más fácil de leer de un vistazo que "Campo: antes → después").
function parsearDatos(valor) {
  if (!valor) return null;
  try {
    return JSON.parse(valor);
  } catch {
    return valor;
  }
}

function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  return String(valor);
}

function armarFilasCambio(antesRaw, despuesRaw) {
  const antes = parsearDatos(antesRaw);
  const despues = parsearDatos(despuesRaw);
  if (antes === null && despues === null) return [];

  const antesEsObjeto = antes && typeof antes === "object";
  const despuesEsObjeto = despues && typeof despues === "object";

  if (!antesEsObjeto && !despuesEsObjeto) {
    return [{ campo: null, antes: antes !== null ? formatearValor(antes) : null, despues: despues !== null ? formatearValor(despues) : null }];
  }

  const camposAntes = antesEsObjeto ? antes : {};
  const camposDespues = despuesEsObjeto ? despues : {};
  const campos = [...new Set([...Object.keys(camposAntes), ...Object.keys(camposDespues)])];

  return campos.map((campo) => ({
    campo,
    antes: campo in camposAntes ? formatearValor(camposAntes[campo]) : null,
    despues: campo in camposDespues ? formatearValor(camposDespues[campo]) : null,
  }));
}

// Si el dato viene con nombre de campo (ej. Valor, Costo, Moneda) se antepone --
// el backend solo lo nombra cuando hace falta distinguirlo de otro dato de la
// misma actividad. Un dato suelto (ej. permisos) no trae nombre y no antepone nada.
function formatearColumnaCambio(filas, lado) {
  if (filas.length === 0) return "—";
  return filas
    .map((f) => {
      const valor = f[lado];
      const prefijo = f.campo ? `${f.campo}: ` : "";
      if (valor === null || valor === undefined) return `${prefijo}—`;
      const lineas = String(valor).split("\n").filter(Boolean);
      return lineas.length > 1
        ? [prefijo ? `${prefijo}` : "", ...lineas.map((l) => `• ${l}`)].filter(Boolean).join("\n")
        : `${prefijo}${valor}`;
    })
    .join("\n");
}

export default function AdminBitacora() {
  const [actividades, setActividades] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [usuarioFiltro, setUsuarioFiltro] = useState("");
  const [moduloFiltro, setModuloFiltro] = useState("");
  const [areaFiltro, setAreaFiltro] = useState("");
  const [actividadFiltro, setActividadFiltro] = useState("");
  const [pagina, setPagina] = useState(1);
  const showToast = useToast();

  // Lista de usuarios: solo los que realmente tienen actividad registrada.
  const usuariosDisponibles = useMemo(() => {
    const nombres = new Set(actividades.map((a) => a.usuarioNombre).filter(Boolean));
    return [...nombres].sort((a, b) => a.localeCompare(b));
  }, [actividades]);

  // Lista de módulos: el catálogo completo de módulos existentes en la app
  // (no solo los que ya tienen actividad), para poder filtrar por cualquiera. "Inicio de
  // Sesión" no es un módulo real (no vive en ninguna área), se agrega aparte a mano.
  const modulosDisponibles = useMemo(() => {
    const etiquetas = new Set([adminUsuariosMeta.label, "Inicio de Sesión"]);
    Object.values(areas).forEach((area) => {
      Object.values(area.modules).forEach((modulo) => etiquetas.add(modulo.label));
    });
    return [...etiquetas].sort((a, b) => a.localeCompare(b));
  }, []);

  // Lista de áreas: el catálogo completo (no solo las que ya tienen actividad), más
  // "Administración" que -- igual que los módulos de arriba -- no vive en "areas".
  const areasDisponibles = useMemo(() => {
    const etiquetas = new Set(["Administración", "Autenticación", ...Object.values(areas).map((area) => area.label)]);
    return [...etiquetas].sort((a, b) => a.localeCompare(b));
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const response = await apiFetch("/actividad?limit=5000");
        const data = await response.json().catch(() => []);
        if (!cancelado && response.ok) setActividades(Array.isArray(data) ? data : []);
      } catch {
        // sin datos si falla
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // Todos los filtros son opcionales (ninguno obligatorio) y se combinan entre
  // sí; el PDF descargable siempre coincide con lo que queda filtrado en pantalla.
  const actividadesFiltradas = useMemo(() => {
    const desdeMs = desde ? new Date(`${desde}T00:00:00`).getTime() : -Infinity;
    const hastaMs = hasta ? new Date(`${hasta}T23:59:59.999`).getTime() : Infinity;
    return actividades.filter((a) => {
      if (usuarioFiltro && a.usuarioNombre !== usuarioFiltro) return false;
      if (moduloFiltro && a.moduloLabel !== moduloFiltro) return false;
      if (areaFiltro && (a.areaLabel || "—") !== areaFiltro) return false;
      if (actividadFiltro && categoriaActividad(a.accion) !== actividadFiltro) return false;
      if (desde || hasta) {
        const ms = parsearFecha(a.fecha).getTime();
        if (ms < desdeMs || ms > hastaMs) return false;
      }
      return true;
    });
  }, [actividades, desde, hasta, usuarioFiltro, moduloFiltro, areaFiltro, actividadFiltro]);

  // Cifras de resumen: reaccionan a los filtros activos (si se filtra por un
  // usuario, por ejemplo, el panel muestra sus cifras, no las globales).
  const estadisticas = useMemo(() => {
    const hoy = new Date();
    const movimientosHoy = actividadesFiltradas.filter((a) => {
      const fecha = parsearFecha(a.fecha);
      return fecha.getFullYear() === hoy.getFullYear() && fecha.getMonth() === hoy.getMonth() && fecha.getDate() === hoy.getDate();
    }).length;
    return {
      total: actividadesFiltradas.length,
      usuarios: new Set(actividadesFiltradas.map((a) => a.usuarioNombre).filter(Boolean)).size,
      modulos: new Set(actividadesFiltradas.map((a) => a.moduloLabel).filter(Boolean)).size,
      hoy: movimientosHoy,
    };
  }, [actividadesFiltradas]);

  const limpiarFiltro = () => {
    setDesde("");
    setHasta("");
    setUsuarioFiltro("");
    setModuloFiltro("");
    setAreaFiltro("");
    setActividadFiltro("");
  };

  const hayFiltrosActivos = desde || hasta || usuarioFiltro || moduloFiltro || areaFiltro || actividadFiltro;

  // Al cambiar cualquier filtro, se vuelve a la primera página en vez de quedarse
  // en una página que podría ya no existir con los nuevos resultados filtrados.
  useEffect(() => {
    setPagina(1);
  }, [desde, hasta, usuarioFiltro, moduloFiltro, areaFiltro, actividadFiltro]);

  const totalPaginas = Math.max(1, Math.ceil(actividadesFiltradas.length / TAMANO_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const actividadesPagina = actividadesFiltradas.slice(
    (paginaActual - 1) * TAMANO_PAGINA,
    paginaActual * TAMANO_PAGINA
  );

  // Se genera un PDF (no Excel) a propósito: es el formato estándar para un
  // reporte final que se entrega a otra persona — no se edita con las
  // herramientas de oficina normales, a diferencia de un .xlsx (donde incluso
  // con la hoja protegida por contraseña, esa protección se puede quitar
  // fácilmente con herramientas gratuitas). jsPDF pesa bastante, así que se
  // carga solo al pedir la descarga, no en el bundle principal.
  const handleDescargarPDF = async () => {
    if (actividadesFiltradas.length === 0) {
      showToast("No hay actividad para descargar", "warn");
      return;
    }

    const [{ default: jsPDF }, { autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Bitácora", 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(105, 115, 134);
    const rango = desde || hasta ? `Rango: ${desde || "inicio"} a ${hasta || "hoy"}` : "Rango: todo el historial";
    doc.text(`${rango}  ·  Generado: ${new Date().toLocaleString("es-HN")}`, 14, 21);

    autoTable(doc, {
      startY: 27,
      head: [["Fecha y hora", "Nombre", "Área", "Módulo", "Actividad", "Referencia", "Antes", "Después", "Motivo"]],
      body: actividadesFiltradas.map((a) => {
        const filasCambio = armarFilasCambio(a.datosAntes, a.datosDespues);
        return [
          formatoFecha.format(parsearFecha(a.fecha)),
          a.usuarioNombre,
          a.areaLabel || "—",
          a.moduloLabel || "—",
          a.accion,
          a.referencia || "—",
          formatearColumnaCambio(filasCambio, "antes"),
          formatearColumnaCambio(filasCambio, "despues"),
          a.motivo || "—",
        ];
      }),
      headStyles: { fillColor: [189, 215, 238], textColor: [26, 31, 54], fontStyle: "bold", halign: "center" },
      styles: { fontSize: 9, cellPadding: 3 },
      alternateRowStyles: { fillColor: [248, 249, 250] },
    });

    const sufijo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    doc.save(`bitacora${sufijo}.pdf`);
  };

  // .xlsx real (no CSV): un CSV separado por comas se desordena en Excel apenas
  // la configuración regional del equipo usa punto y coma como separador de lista
  // (normal en configuración en español), porque Excel entonces no separa las
  // columnas. ExcelJS pesa bastante, así que se carga solo al pedir la descarga.
  const handleExportarExcel = async () => {
    if (actividadesFiltradas.length === 0) {
      showToast("No hay actividad para exportar", "warn");
      return;
    }

    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const hoja = workbook.addWorksheet("Bitácora");

    hoja.columns = [
      { header: "Fecha y hora", key: "fecha", width: 20 },
      { header: "Nombre", key: "nombre", width: 26 },
      { header: "Área", key: "area", width: 16 },
      { header: "Módulo", key: "modulo", width: 26 },
      { header: "Actividad", key: "actividad", width: 34 },
      { header: "Referencia", key: "referencia", width: 22 },
      { header: "Antes", key: "antes", width: 32 },
      { header: "Después", key: "despues", width: 32 },
      { header: "Motivo", key: "motivo", width: 22 },
    ];

    // Antes/Después/Actividad pueden traer varias líneas (ej. permisos) -- con
    // salto de línea dentro de la celda en vez de una sola línea gigante, igual
    // que se ve en pantalla. Se fija antes de llenar filas para que cada celda
    // nueva ya nazca con este alineado en vez de depender de aplicarlo después.
    ["actividad", "antes", "despues"].forEach((key) => {
      hoja.getColumn(key).alignment = { wrapText: true, vertical: "top" };
    });

    actividadesFiltradas.forEach((a) => {
      const filasCambio = armarFilasCambio(a.datosAntes, a.datosDespues);
      const antesTexto = formatearColumnaCambio(filasCambio, "antes");
      const despuesTexto = formatearColumnaCambio(filasCambio, "despues");
      const fila = hoja.addRow({
        fecha: formatoFecha.format(parsearFecha(a.fecha)),
        nombre: a.usuarioNombre,
        area: a.areaLabel || "—",
        modulo: a.moduloLabel || "—",
        actividad: a.accion,
        referencia: a.referencia || "—",
        antes: antesTexto,
        despues: despuesTexto,
        motivo: a.motivo || "—",
      });
      // Excel no agranda la fila solo porque la celda tenga varias líneas -- si
      // no se fija la altura a mano, el texto de los permisos (varias líneas)
      // queda cortado dentro de una fila de una sola línea.
      const lineas = Math.max(antesTexto.split("\n").length, despuesTexto.split("\n").length, 1);
      if (lineas > 1) fila.height = lineas * 14;
    });

    // Encabezado: mismo azul corporativo que el resto del sistema, con el texto
    // en blanco y negrita; fila congelada para que no se pierda al bajar.
    hoja.getRow(1).eachCell((celda) => {
      celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
      celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3651" } };
      celda.alignment = { vertical: "middle", horizontal: "center" };
    });
    hoja.getRow(1).height = 22;
    hoja.views = [{ state: "frozen", ySplit: 1 }];

    hoja.eachRow((fila, numeroFila) => {
      if (numeroFila === 1) return;
      const parEntreFilas = numeroFila % 2 === 0;
      fila.eachCell((celda) => {
        celda.border = { bottom: { style: "thin", color: { argb: "FFEDEEF0" } } };
        if (!celda.alignment) celda.alignment = { vertical: "top" };
        if (parEntreFilas) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const sufijo = desde || hasta ? `_${desde || "inicio"}_a_${hasta || "hoy"}` : "";
    const link = document.createElement("a");
    link.href = url;
    link.download = `bitacora${sufijo}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Paginación numerada: siempre primera, última, la actual y una a cada lado;
  // el resto se resume con "…" en vez de listar las ~100 páginas que puede haber.
  const paginasAMostrar = useMemo(() => {
    const paginas = new Set([1, totalPaginas, paginaActual - 1, paginaActual, paginaActual + 1]);
    return [...paginas]
      .filter((p) => p >= 1 && p <= totalPaginas)
      .sort((a, b) => a - b);
  }, [paginaActual, totalPaginas]);

  return (
    <div>
      <div className="bitacora-header">
        <div className="bitacora-header-icon">{meta.icon}</div>
        <div className="bitacora-header-text">
          <h2>Bitácora de auditoría</h2>
          <p>Control y seguimiento de actividades del sistema</p>
        </div>
        <span className="bitacora-estado-pill">● Sistema activo</span>
      </div>

      <div className="bitacora-stats">
        <div className="stat-card">
          <div className="stat-card-icon">🕒</div>
          <div>
            <div className="stat-card-valor">{estadisticas.total}</div>
            <div className="stat-card-label">Total registros</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon verde">👥</div>
          <div>
            <div className="stat-card-valor">{estadisticas.usuarios}</div>
            <div className="stat-card-label">Usuarios activos</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon morado">🗂️</div>
          <div>
            <div className="stat-card-valor">{estadisticas.modulos}</div>
            <div className="stat-card-label">Módulos utilizados</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon ambar">📅</div>
          <div>
            <div className="stat-card-valor">{estadisticas.hoy}</div>
            <div className="stat-card-label">Movimientos hoy</div>
          </div>
        </div>
      </div>

      <div className="bitacora-card">
        <div className="bitacora-card-titulo">🔎 Filtros de búsqueda</div>
        <div className="bitacora-filtros-grid">
          <div className="field" style={{ margin: 0 }}>
            <label>Usuario</label>
            <select value={usuarioFiltro} onChange={(e) => setUsuarioFiltro(e.target.value)}>
              <option value="">Todos los usuarios</option>
              {usuariosDisponibles.map((nombre) => (
                <option key={nombre} value={nombre}>{nombre}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Módulo</label>
            <select value={moduloFiltro} onChange={(e) => setModuloFiltro(e.target.value)}>
              <option value="">Todos los módulos</option>
              {modulosDisponibles.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Área</label>
            <select value={areaFiltro} onChange={(e) => setAreaFiltro(e.target.value)}>
              <option value="">Todas las áreas</option>
              {areasDisponibles.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Actividad</label>
            <select value={actividadFiltro} onChange={(e) => setActividadFiltro(e.target.value)}>
              <option value="">Todas las actividades</option>
              {ACTIVIDADES_DISPONIBLES.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
        </div>
        {hayFiltrosActivos && (
          <button className="btn ghost" onClick={limpiarFiltro} style={{ marginTop: "14px" }}>
            ↺ Limpiar filtros
          </button>
        )}
      </div>

      <div className="bitacora-card">
        <div className="bitacora-tabla-header">
          <div className="bitacora-card-titulo">📋 Registro de actividades</div>
          <div className="bitacora-tabla-acciones">
            <span className="bitacora-resultados-pill">
              {actividadesFiltradas.length} resultado{actividadesFiltradas.length !== 1 ? "s" : ""}
            </span>
            <button className="btn soft" onClick={handleExportarExcel} disabled={cargando}>
              📊 Exportar Excel
            </button>
            <button className="btn primary" onClick={handleDescargarPDF} disabled={cargando}>
              📄 Exportar PDF
            </button>
          </div>
        </div>

        <div className="actividad-tabla-wrap">
          <table className="actividad-tabla">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Área</th>
                <th>Módulo</th>
                <th>Actividad</th>
                <th>Referencia</th>
                <th>Antes</th>
                <th>Después</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={9} className="actividad-vacio">Cargando…</td></tr>
              ) : actividadesFiltradas.length === 0 ? (
                <tr><td colSpan={9} className="actividad-vacio">
                  {actividades.length === 0 ? "Todavía no hay actividad registrada." : "No hay actividad con los filtros seleccionados."}
                </td></tr>
              ) : (
                actividadesPagina.map((a) => {
                  const filasCambio = armarFilasCambio(a.datosAntes, a.datosDespues);
                  const categoria = categoriaActividad(a.accion);
                  // Un valor puede traer varios ítems juntos (ej. varios módulos de
                  // permisos) separados por salto de línea; se listan con viñeta y
                  // espacio entre cada uno en vez de un bloque de texto pegado. Y si el
                  // dato viene con nombre de campo (ej. Valor, Costo, Moneda), se antepone
                  // -- es porque el backend lo necesitó para distinguirlo de otro dato de
                  // la misma actividad. Cuando es un solo dato suelto (ej. permisos) no
                  // trae nombre de campo y no se antepone nada.
                  const renderColumna = (lado) => filasCambio.length === 0 ? "—" : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {filasCambio.map((f, i) => {
                        const valor = f[lado];
                        const etiqueta = f.campo ? (
                          <span style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#6b7280" }}>{f.campo}</span>
                        ) : null;
                        if (valor === null || valor === undefined) {
                          return (
                            <span key={i} style={{ fontSize: "12px" }}>
                              {etiqueta}
                              <span style={{ color: "#9aa1ab" }}>—</span>
                            </span>
                          );
                        }
                        const lineas = String(valor).split("\n").filter(Boolean);
                        if (lineas.length <= 1) {
                          return (
                            <span key={i} style={{ fontSize: "12px" }}>
                              {etiqueta}
                              {valor}
                            </span>
                          );
                        }
                        return (
                          <div key={i}>
                            {etiqueta}
                            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "4px" }}>
                              {lineas.map((linea, j) => (
                                <li key={j} style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "flex-start" }}>
                                  <span style={{ color: "#bcc3cc" }}>•</span>
                                  <span>{linea}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  );
                  return (
                    <tr key={a.id}>
                      <td>{formatoFecha.format(parsearFecha(a.fecha))}</td>
                      <td>{a.usuarioNombre}</td>
                      <td><Pill texto={a.areaLabel || "—"} colores={COLORES_AREA[a.areaLabel] || COLOR_AREA_DEFAULT} /></td>
                      <td>{a.moduloLabel || "—"}</td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                          <Pill texto={categoria} colores={COLORES_ACTIVIDAD[categoria]} />
                          <span style={{ fontSize: "12px", color: "#51606e" }}>{a.accion}</span>
                        </div>
                      </td>
                      <td>{a.referencia || "—"}</td>
                      <td>{renderColumna("antes")}</td>
                      <td>{renderColumna("despues")}</td>
                      <td>{a.motivo || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {actividadesFiltradas.length > 0 && (
          <div className="bitacora-paginacion">
            <span className="bitacora-paginacion-info">
              Mostrando {(paginaActual - 1) * TAMANO_PAGINA + 1}-{Math.min(paginaActual * TAMANO_PAGINA, actividadesFiltradas.length)} de {actividadesFiltradas.length} registros
            </span>
            {totalPaginas > 1 && (
              <div className="bitacora-paginacion-nums">
                <button className="btn ghost pagina-flecha" onClick={() => setPagina((p) => p - 1)} disabled={paginaActual === 1} title="Página anterior">
                  ←
                </button>
                {paginasAMostrar.map((p, i) => (
                  <span key={p}>
                    {i > 0 && p - paginasAMostrar[i - 1] > 1 && <span className="pagina-num-puntos">…</span>}
                    <button
                      className={`pagina-num${p === paginaActual ? " active" : ""}`}
                      onClick={() => setPagina(p)}
                    >
                      {p}
                    </button>
                  </span>
                ))}
                <button className="btn ghost pagina-flecha" onClick={() => setPagina((p) => p + 1)} disabled={paginaActual === totalPaginas} title="Página siguiente">
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
