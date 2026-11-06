import { useState } from "react";
import { useToast } from "../../../components/Toast.jsx";
import { apiFetch } from "../../../apiClient.js";
import { useAutorizadorActual } from "../../cfo/useAutorizadorActual.js";

export const meta = {
  label: "Evaluar Matriz",
  icon: "🔁",
  desc: "Actualizar el estado Vigente/No vigente y volver a evaluar la solicitud seleccionada en Json Solicitud",
};

export default function EvaluarMatriz({ solicitudes = [], tipoSolicitudId, onEvaluado }) {
  const [vigente, setVigente] = useState("true");
  const autorizadorActual = useAutorizadorActual();
  const autorizador = autorizadorActual?.id || "";
  const [resultado, setResultado] = useState(null);
  // Cada botón tiene su propio estado de "procesando" (en vez de uno solo compartido)
  // para que al evaluar no parezca que "Actualizar" también está trabajando, y viceversa.
  // Mientras cualquiera de los dos corre, ambos quedan deshabilitados para no disparar
  // dos acciones a la vez sobre la misma solicitud.
  const [procesandoActualizar, setProcesandoActualizar] = useState(false);
  const [procesandoEvaluar, setProcesandoEvaluar] = useState(false);
  const procesando = procesandoActualizar || procesandoEvaluar;
  const showToast = useToast();

  const solicitud = solicitudes.find((s) => s.TipoSolicitudId === tipoSolicitudId) || null;
  const gestionId = solicitudes[0]?.GestionId || "";

  if (!tipoSolicitudId || !solicitud) {
    return <p style={{ color: "#697386", fontSize: "14px" }}>Seleccione un Tipo de Solicitud en "Json Solicitud" para poder reiniciarla.</p>;
  }

  const handleActualizar = async () => {
    if (!autorizador) {
      showToast("Seleccione quién autoriza antes de continuar", "warn");
      return;
    }
    if (!window.confirm(`¿Confirma marcar este análisis como Vigente = ${vigente === "true" ? "Sí" : "No"}?`)) {
      return;
    }

    setProcesandoActualizar(true);
    try {
      const respActualizar = await apiFetch(`/actualizarAnalisisVigente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analisisId: solicitud.AnalisisId,
          usuarioId: autorizador,
          // El campo Vigente usa la convención invertida de este dominio (igual que en
          // Solicitudes Asociadas): 0/false = SI, 1/true = NO. El selector de abajo
          // muestra "Sí"/"No" en el sentido normal, así que aquí se invierte antes de
          // mandarlo al servicio externo.
          vigente: vigente === "false"
        })
      });
      const dataActualizar = await respActualizar.json().catch(() => null);
      if (!respActualizar.ok) {
        showToast(dataActualizar?.Message || "Error al actualizar el análisis", "warn");
        return;
      }
      showToast(dataActualizar?.Message || "✓ Análisis actualizado", "ok");
      await onEvaluado?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setProcesandoActualizar(false);
    }
  };

  const handleEvaluar = async () => {
    if (!window.confirm("¿Confirma volver a evaluar esta solicitud?")) {
      return;
    }

    setProcesandoEvaluar(true);
    setResultado(null);
    try {
      const respEvaluar = await apiFetch(`/evaluarAnalisis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gestionId, tipoSolicitudId })
      });
      const dataEvaluar = await respEvaluar.json().catch(() => null);
      if (!respEvaluar.ok) {
        showToast(dataEvaluar?.Message || "Error al evaluar el análisis", "warn");
        return;
      }
      setResultado(dataEvaluar?.Data ?? dataEvaluar);
      showToast("✓ Análisis evaluado con éxito", "ok");
      await onEvaluado?.();
    } catch (error) {
      showToast("⚠️ Error de conexión con el servidor", "warn");
    } finally {
      setProcesandoEvaluar(false);
    }
  };

  return (
    <div>
      <div style={{ background: "#f8f9fa", padding: "12px 14px", borderRadius: "8px", border: "1px solid #e3e8ee", marginBottom: "16px", fontSize: "13px", color: "#475569" }}>
        <div><strong>Tipo de Solicitud:</strong> {solicitud.TipoSolicitud}</div>
        <div><strong>AnalisisId:</strong> {solicitud.AnalisisId}</div>
      </div>

      <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" }}>
        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px" }}>
            Vigente
          </label>
          <select
            value={vigente}
            onChange={(e) => setVigente(e.target.value)}
            disabled={procesando}
            style={{ padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#fff", minWidth: "140px" }}
          >
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f5b66", marginBottom: "6px" }}>
            Autorizado por
          </label>
          <div style={{ padding: "8px 12px", border: "1px solid #dcdfe6", borderRadius: "6px", fontSize: "13px", background: "#f1f5f9", minWidth: "200px", color: autorizadorActual ? "#1a1f36" : "#b42318" }}>
            {autorizadorActual?.name || "Tu usuario no está habilitado como autorizador"}
          </div>
        </div>

        <button className="btn soft" onClick={handleActualizar} disabled={procesando} style={{ padding: "9px 18px", fontSize: "13px" }}>
          {procesandoActualizar ? "Procesando..." : "Actualizar"}
        </button>

        <button className="btn primary" onClick={handleEvaluar} disabled={procesando} style={{ padding: "9px 18px", fontSize: "13px" }}>
          {procesandoEvaluar ? "Procesando..." : "Evaluar"}
        </button>
      </div>

      {resultado !== null && (
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setResultado(null)}
            title="Quitar JSON de la pantalla"
            style={{
              position: "absolute", top: "8px", right: "8px", zIndex: 1,
              background: "rgba(255,255,255,0.1)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "6px", width: "26px", height: "26px", cursor: "pointer", fontSize: "14px", lineHeight: 1
            }}
          >
            ✕
          </button>
          <pre style={{
            background: "#0f172a", color: "#e2e8f0", padding: "14px", borderRadius: "8px",
            fontSize: "12px", overflow: "auto", maxHeight: "420px", whiteSpace: "pre-wrap", wordBreak: "break-word"
          }}>
            {JSON.stringify(resultado, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
