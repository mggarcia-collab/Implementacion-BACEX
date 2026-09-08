import { useState } from "react";
import { useToast } from "../../components/Toast.jsx";
import { apiFetch } from "../../apiClient.js";
import { useAutorizadorActual } from "./useAutorizadorActual.js";

export const meta = {
  label: "Anulación de Facturas",
  icon: "🧾",
  desc: "Habilitar una o más facturas para refacturación (anulación)",
  kind: "danger",
};

const ESTADO_STYLE = {
  Anulada: { background: "#fee2e2", color: "#991b1b" },
  Habilitada: { background: "#d1fae5", color: "#065f46" },
};

function Badge({ text, style }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: "999px",
      fontSize: "11.5px", fontWeight: "600", whiteSpace: "nowrap",
      background: style?.background || "#f1f5f9", color: style?.color || "#475569"
    }}>
      {text}
    </span>
  );
}

// Las facturas de este sistema siempre tienen 10 dígitos. Si viene más corta (típico
// al copiar desde Excel, que quita los ceros a la izquierda), se puede corregir
// rellenando con ceros; si no es numérica o tiene más de 10 dígitos, no se puede
// corregir sola y hay que avisarle al usuario en vez de enviarla como está.
function normalizarFactura(factura) {
  if (!/^\d+$/.test(factura)) {
    return { factura, valida: false, motivo: "contiene caracteres no numéricos" };
  }
  if (factura.length > 10) {
    return { factura, valida: false, motivo: "tiene más de 10 dígitos" };
  }
  if (factura.length < 10) {
    return { factura, valida: true, corregida: factura.padStart(10, "0") };
  }
  return { factura, valida: true };
}

export default function AnulacionFacturas() {
  const [facturasSeleccionadas, setFacturasSeleccionadas] = useState([]);
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState(null);
  const autorizadorActual = useAutorizadorActual();
  const showToast = useToast();

  const [referenciasTexto, setReferenciasTexto] = useState("");
  const [facturaBusqueda, setFacturaBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [facturasEncontradas, setFacturasEncontradas] = useState([]);

  // Orden de lectura: primero agrupadas por Tipo (todas las Fiscal juntas, luego todas
  // las Nota de Reembolso), y dentro de cada grupo por Referencia Operativa y N° Factura —
  // así la tabla en pantalla, el CSV descargado y el resumen copiado siempre salen en el
  // mismo orden consistente, sin mezclar los dos tipos entre referencias distintas.
  const compararFacturas = (a, b) => {
    const tipoA = a.Tipo || "";
    const tipoB = b.Tipo || "";
    if (tipoA !== tipoB) return tipoA.localeCompare(tipoB);
    const refA = a.ReferenciaOperativa || "";
    const refB = b.ReferenciaOperativa || "";
    if (refA !== refB) return refA.localeCompare(refB);
    return String(a.NumeroFacturaSap || "").localeCompare(String(b.NumeroFacturaSap || ""));
  };

  // Cada buscador reemplaza sus propios resultados anteriores al volver a buscar (para no
  // ir acumulando búsquedas viejas), pero deja intactos los resultados que haya traído el
  // otro buscador — así se puede combinar una búsqueda por referencia con otra por número,
  // y dentro de una misma búsqueda sí se pueden traer varias facturas a la vez.
  const reemplazarResultados = (origen, nuevos) => {
    const nuevosConOrigen = nuevos.map((f) => ({ ...f, _origen: origen }));
    setFacturasEncontradas((prev) => {
      const combinados = prev.filter((f) => f._origen !== origen);
      for (const nuevo of nuevosConOrigen) {
        const yaEsta = combinados.some((f) =>
          f.Tipo === nuevo.Tipo && f.ReferenciaOperativa === nuevo.ReferenciaOperativa && f.NumeroFacturaSap === nuevo.NumeroFacturaSap
        );
        if (!yaEsta) combinados.push(nuevo);
      }
      return combinados.sort(compararFacturas);
    });
  };

  const handleBuscarPorReferencia = async () => {
    const referencias = referenciasTexto.split(/[,\s\n]+/).map((r) => r.trim()).filter(Boolean);
    if (referencias.length === 0) {
      showToast("Ingrese al menos una Referencia Operativa para buscar", "warn");
      return;
    }
    setBuscando(true);
    try {
      const response = await apiFetch(`/facturasPorReferencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referencias })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al buscar facturas`, "warn");
        setBuscado(true);
        return;
      }
      reemplazarResultados("referencia", Array.isArray(data) ? data : []);
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setBuscado(true);
    } finally {
      setBuscando(false);
    }
  };

  const handleBuscarPorNumero = async () => {
    const ingresadas = facturaBusqueda.split(/[,\s\n]+/).map((f) => f.trim()).filter(Boolean);
    if (ingresadas.length === 0) {
      showToast("Ingrese al menos un número de factura para buscar", "warn");
      return;
    }

    // Se rellenan con ceros a la izquierda antes de buscar (típico al copiar desde
    // Excel, que quita los ceros iniciales); si no, la búsqueda no encontraría nada
    // porque en la BD la factura sí tiene sus 10 dígitos completos.
    const analizadas = ingresadas.map(normalizarFactura);
    const invalidas = analizadas.filter((a) => !a.valida);
    if (invalidas.length > 0) {
      showToast(`Factura(s) inválida(s): ${invalidas.map((a) => `${a.factura} (${a.motivo})`).join("; ")}`, "warn");
      return;
    }
    const facturas = analizadas.map((a) => a.corregida || a.factura);
    if (analizadas.some((a) => a.corregida)) {
      setFacturaBusqueda(facturas.join(", "));
    }

    setBuscando(true);
    try {
      const response = await apiFetch(`/facturasPorNumero`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturas })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al buscar facturas`, "warn");
        setBuscado(true);
        return;
      }
      reemplazarResultados("numero", Array.isArray(data) ? data : []);
      setBuscado(true);
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
      setBuscado(true);
    } finally {
      setBuscando(false);
    }
  };

  const handleLimpiar = () => {
    setReferenciasTexto("");
    setFacturaBusqueda("");
    setBuscando(false);
    setBuscado(false);
    setFacturasEncontradas([]);
    setFacturasSeleccionadas([]);
    setObservacion("");
  };

  const filasResumen = () => facturasEncontradas.map((f) => ({
    referencia: f.ReferenciaOperativa || "",
    tipo: f.Tipo || "",
    factura: f.NumeroFacturaSap || "",
    estado: f.Estado || ""
  }));

  const handleCopiarResumen = async () => {
    const encabezado = "Referencia Operativa\tTipo\tN° Factura SAP\tEstado";
    const filas = filasResumen().map((f) => `${f.referencia}\t${f.tipo}\t${f.factura}\t${f.estado}`);
    const texto = [encabezado, ...filas].join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      showToast("✓ Resumen copiado al portapapeles", "ok");
    } catch {
      showToast("No se pudo copiar al portapapeles", "warn");
    }
  };

  const handleDescargarResumen = () => {
    const escapar = (valor) => `"${String(valor).replace(/"/g, '""')}"`;
    const encabezado = ["Referencia Operativa", "Tipo", "N° Factura SAP", "Estado"].map(escapar).join(";");
    const filas = filasResumen().map((f) => [f.referencia, f.tipo, f.factura, f.estado].map(escapar).join(";"));
    // "sep=;" en la primera línea le dice a Excel qué separador usar, sin importar la
    // configuración regional de quien lo abra (en español, Excel espera ";" porque usa
    // "," como separador decimal — por eso antes se veía todo apretujado en una sola columna).
    const csv = ["sep=;", encabezado, ...filas].join("\n");
    // El BOM (bytes EF BB BF, no un carácter especial en el código fuente, que se
    // puede corromper al guardar el archivo) es necesario para que Excel en Windows
    // detecte UTF-8 y muestre bien los acentos (Número, Reembolso, etc.); sin él,
    // suele verlos como símbolos raros (Ã©, Ã³, etc.).
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `facturas_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  };

  const handleAgregarFactura = (numeroFacturaSap) => {
    const factura = String(numeroFacturaSap).trim();
    if (facturasSeleccionadas.includes(factura)) {
      showToast("Esa factura ya está en la lista", "warn");
      return;
    }
    setFacturasSeleccionadas((prev) => [...prev, factura]);
  };

  const handleQuitarFactura = (factura) => {
    setFacturasSeleccionadas((prev) => prev.filter((f) => f !== factura));
  };

  const handleAnular = async (e) => {
    e.preventDefault();

    const facturasIngresadas = facturasSeleccionadas;
    if (facturasIngresadas.length === 0) {
      showToast("Agregue al menos una factura desde la búsqueda de arriba", "warn");
      return;
    }
    if (!observacion.trim()) {
      showToast("Indique la observación (motivo de la anulación)", "warn");
      return;
    }
    if (!autorizadorActual) {
      showToast("Tu usuario no está habilitado como autorizador", "warn");
      return;
    }

    const analizadas = facturasIngresadas.map(normalizarFactura);
    const invalidas = analizadas.filter((a) => !a.valida);
    if (invalidas.length > 0) {
      showToast(`Factura(s) inválida(s): ${invalidas.map((a) => `${a.factura} (${a.motivo})`).join("; ")}`, "warn");
      return;
    }

    const porRellenar = analizadas.filter((a) => a.corregida);
    if (porRellenar.length > 0) {
      const lista = porRellenar.map((a) => `${a.factura} → ${a.corregida}`).join("\n");
      const confirmarRelleno = window.confirm(
        `${porRellenar.length} factura(s) no tienen 10 dígitos. ¿Rellenar con ceros a la izquierda antes de continuar?\n\n${lista}`
      );
      if (!confirmarRelleno) return;
    }

    const facturas = analizadas.map((a) => a.corregida || a.factura);

    if (!window.confirm(`¿Confirma anular ${facturas.length} factura(s)?\n\n${facturas.join(", ")}\n\nMotivo: ${observacion.trim()}`)) {
      return;
    }

    setEnviando(true);
    try {
      const response = await apiFetch(`/anularFacturas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Facturas: facturas,
          Observacion: observacion.trim(),
          UsuarioId: autorizadorActual.id,
          Correo: autorizadorActual.correo
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(data?.Message || `Error ${response.status} al anular las facturas`, "warn");
        return;
      }
      showToast(data?.Message || "✓ Factura(s) anulada(s) con éxito", "ok");
      setUltimoResultado({ facturas, observacion: observacion.trim(), correo: autorizadorActual.correo });
      setFacturasSeleccionadas([]);
      setObservacion("");
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="form-wrap" style={{ position: "relative", zIndex: 1, maxWidth: "900px" }}>
      <div style={{ borderBottom: "1px solid #eaeaea", paddingBottom: "15px", marginBottom: "25px" }}>
        <div className="form-title" style={{ fontSize: "22px", fontWeight: "700", color: "#1a1f36" }}>{meta.label}</div>
        <div className="form-sub" style={{ color: "#697386", marginTop: "4px" }}>{meta.desc}</div>
      </div>

      <div style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Buscar por Referencia Operativa
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Una o varias Referencias Operativas..."
                value={referenciasTexto}
                onChange={(e) => setReferenciasTexto(e.target.value)}
                disabled={buscando}
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              <button type="button" className="btn primary" onClick={handleBuscarPorReferencia} disabled={buscando} style={{ padding: "0 16px" }}>
                Buscar
              </button>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Buscar por Número de Factura
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="Uno o varios números de factura..."
                value={facturaBusqueda}
                onChange={(e) => setFacturaBusqueda(e.target.value)}
                disabled={buscando}
                style={{ flex: 1, padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px" }}
              />
              <button type="button" className="btn primary" onClick={handleBuscarPorNumero} disabled={buscando} style={{ padding: "0 16px" }}>
                Buscar
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "12px" }}>
          <button type="button" className="btn ghost" onClick={handleLimpiar} disabled={buscando || enviando} style={{ padding: "6px 20px", fontSize: "13px" }}>
            Limpiar
          </button>
        </div>

        {buscado && facturasEncontradas.length === 0 && (
          <p style={{ color: "#697386", fontSize: "13px", margin: "16px 0 0" }}>No se encontraron facturas (Fiscal ni Nota de Reembolso) para esa búsqueda.</p>
        )}

        {facturasEncontradas.length > 0 && (
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "8px" }}>
              <button type="button" className="btn ghost" onClick={handleCopiarResumen} style={{ padding: "4px 12px", fontSize: "12px" }}>
                Copiar resumen
              </button>
              <button type="button" className="btn ghost" onClick={handleDescargarResumen} style={{ padding: "4px 12px", fontSize: "12px" }}>
                Descargar CSV
              </button>
            </div>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Referencia Operativa</th>
                    <th>Tipo</th>
                    <th>N° Factura SAP</th>
                    <th>Estado</th>
                    <th style={{ textAlign: "right" }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {facturasEncontradas.map((f, i) => {
                    const yaAnulada = f.Estado === "Anulada";
                    const yaAgregada = !!f.NumeroFacturaSap && facturasSeleccionadas.includes(f.NumeroFacturaSap);
                    return (
                      <tr key={`${f.ReferenciaOperativa}-${f.Tipo}-${i}`}>
                        <td style={{ color: "#697386" }}>{i + 1}</td>
                        <td>{f.ReferenciaOperativa}</td>
                        <td>{f.Tipo}</td>
                        <td>{f.NumeroFacturaSap || <span style={{ color: "#a3acb9" }}>—</span>}</td>
                        <td>
                          {f.NumeroFacturaSap
                            ? <Badge text={f.Estado} style={ESTADO_STYLE[f.Estado]} />
                            : <span style={{ color: "#a3acb9" }}>—</span>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className={yaAgregada ? "btn soft" : "btn ghost"}
                            onClick={() => handleAgregarFactura(f.NumeroFacturaSap)}
                            disabled={!f.NumeroFacturaSap || yaAnulada || yaAgregada}
                            title={yaAnulada ? "Esta factura ya fue anulada anteriormente" : yaAgregada ? "Ya está en la lista para anular" : undefined}
                            style={{ padding: "4px 12px", fontSize: "12px" }}
                          >
                            {yaAgregada ? "✓ Agregada" : "Agregar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleAnular} style={{ background: "#f8f9fa", padding: "20px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "24px" }}>
        <div className="field" style={{ marginBottom: "20px" }}>
          <label>Número(s) de Factura</label>
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px",
            minHeight: "38px", padding: "6px 8px", border: "1px solid #dcdfe6", borderRadius: "6px",
            background: "#fff"
          }}>
            {facturasSeleccionadas.length === 0 ? (
              <span style={{ color: "#a3acb9", fontSize: "13px", padding: "2px 4px" }}>
                Ninguna factura agregada — búscala arriba y presiona "Agregar".
              </span>
            ) : (
              facturasSeleccionadas.map((factura) => (
                <span key={factura} style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  background: "#f1f5f9", color: "#334155", borderRadius: "999px",
                  padding: "3px 6px 3px 10px", fontSize: "13px", fontWeight: "600"
                }}>
                  {factura}
                  <button
                    type="button"
                    onClick={() => handleQuitarFactura(factura)}
                    disabled={enviando}
                    title="Quitar"
                    style={{
                      border: "none", background: "transparent", color: "#697386", cursor: "pointer",
                      fontSize: "14px", lineHeight: 1, padding: "2px 4px", borderRadius: "999px"
                    }}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="field" style={{ marginBottom: "20px" }}>
          <label>Observación (motivo de la anulación)</label>
          <textarea
            placeholder="Ej: Se elimina para refacturación"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            disabled={enviando}
            rows={2}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", fontFamily: "inherit", resize: "vertical" }}
          />
        </div>

        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Autorizado por
        </label>
        <div style={{ padding: "10px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "14px", background: "#f1f5f9", color: autorizadorActual ? "#1a1f36" : "#b42318", marginBottom: "20px" }}>
          {autorizadorActual
            ? `${autorizadorActual.name}${autorizadorActual.correo ? ` (${autorizadorActual.correo})` : " — sin correo configurado"}`
            : "Tu usuario no está habilitado como autorizador"}
        </div>

        <button className="btn danger" type="submit" disabled={enviando}>
          {enviando ? "Anulando..." : "Anular Factura(s)"}
        </button>
      </form>

      {ultimoResultado && (
        <div style={{ border: "1px solid #d1fae5", background: "#f0fdf9", borderRadius: "8px", padding: "20px", maxWidth: "100%", overflow: "hidden" }}>
          <div style={{ fontSize: "15px", fontWeight: "700", color: "#065f46", marginBottom: "14px" }}>
            ✓ Última anulación realizada
          </div>

          <div style={{ marginBottom: "14px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "6px" }}>
              Facturas ({ultimoResultado.facturas.length})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {ultimoResultado.facturas.map((factura) => (
                <span key={factura} style={{
                  background: "#d1fae5", color: "#065f46", borderRadius: "999px",
                  padding: "3px 10px", fontSize: "13px", fontWeight: "600"
                }}>
                  {factura}
                </span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
              Observación
            </div>
            <div style={{ fontSize: "14px", color: "#334155", wordBreak: "break-word" }}>{ultimoResultado.observacion}</div>
          </div>

          <div>
            <div style={{ fontSize: "12px", fontWeight: "700", color: "#4f5b66", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>
              Notificado a
            </div>
            <div style={{ fontSize: "14px", color: "#334155", wordBreak: "break-word" }}>{ultimoResultado.correo || "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
