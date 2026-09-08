import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { registrarActividad } from '../database/authDb.js'

const app = Router();
app.use(requireAuth);

app.post('/solicitudesAsociadas', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { gestion } = req.body;
        if (!gestion) {
            return res.status(400).json({ Message: "La Gestión / Hoja de Ruta es requerida." });
        }

        const pool = await conexion(BasesDeDatos.AnalisisDeRed);
        const resultado = await pool.request()
            .input('gestion', sql.VarChar, gestion)
            .query(`
                declare @gestionId uniqueidentifier
                set @gestionId = (
                    Select top (1) GestionId
                    from ReferenciaOperativa
                    where Referencia = @gestion
                      and IsSoftDeleted = 0
                    order by CreatedDate desc
                )

                Select Id as ReferenciaOperativaId, GestionId, Referencia, TipoReferenciaOperativaValue, HaSidoEvaluado, IsSoftDeleted, OperadorNombre, SitioId, RegimenId, CreatedDate
                from ReferenciaOperativa where GestionId = @gestionId

                Select a.Id as AnalisisId, a.GestionId, a.Vigente, s.Id as Solicitud, s.CreatedDate, s.Estado as Estado_Solicitud, a.TipoSolicitudId, ts.Nombre as TipoSolicitud, ts.MetodoNombre, es.Id as EncabezadoSolicitudId, es.Descripcion AS EncabezadoSolicitud, a.ReferenciaOperativaId, ro.Referencia, ro.TipoReferenciaOperativaValue as TipoReferenciaOperativa, m.Id as MatrizId
                from Analisis a
                INNER JOIN TipoSolicitud ts ON ts.Id = a.TipoSolicitudId
                INNER JOIN EncabezadoTipoSolicituRel ets ON ets.Id = a.EncabezadoTipoSolicitudId
                INNER JOIN EncabezadoSolicitud es ON es.Id = ets.EncabezadoSolicitudId
                INNER JOIN ReferenciaOperativa ro ON ro.Id = a.ReferenciaOperativaId
                INNER JOIN Matriz m ON m.GestionId = a.GestionId
                INNER JOIN Solicitud s ON s.MatrizId = m.Id and ts.Id = s.TipoSolicitudId
                Where a.GestionId = @gestionId
            `);

        return res.json({
            referenciasOperativas: resultado.recordsets[0] || [],
            solicitudes: resultado.recordsets[1] || []
        });

    } catch (error) {
        console.error("Error en solicitudesAsociadas:", error);
        return res.status(500).json({ Message: "Error al obtener solicitudes asociadas", Error: error.message });
    }
});

app.post('/jsonSolicitud', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { gestionId, tipoSolicitudId } = req.body;
        if (!gestionId || !tipoSolicitudId) {
            return res.status(400).json({ Message: "GestionId y TipoSolicitudId son requeridos." });
        }

        const resp = await fetch("https://analisisderedapi.vesta-accelerate.com/api/AnalisisCriterioTestApi/GetJsonTipoSolicitudGestion", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ GestionId: gestionId, TipoSolicitudId: tipoSolicitudId })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`AnalisisCriterioTestApi/GetJsonTipoSolicitudGestion → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        return res.status(200).json({ Data: data });

    } catch (error) {
        console.error("Error en jsonSolicitud:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/actualizarAnalisisVigente', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { analisisId, usuarioId, vigente } = req.body;
        if (!analisisId) {
            return res.status(400).json({ Message: "El Analisis (AnalisisId) es requerido." });
        }
        if (!usuarioId) {
            return res.status(400).json({ Message: "El usuario que autoriza (UsuarioId) es requerido." });
        }
        if (typeof vigente !== "boolean") {
            return res.status(400).json({ Message: "Debe indicar si queda Vigente (Sí/No)." });
        }

        const resp = await fetch("https://analisisderedapi.vesta-accelerate.com/api/AnalisisCrud/ActualizarAnalisisAVigente", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ AnalisisId: analisisId, UsuarioId: usuarioId, Vigente: vigente })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`AnalisisCrud/ActualizarAnalisisAVigente → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`AnalisisCrud/ActualizarAnalisisAVigente → ${analisisId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            const mensaje = Array.isArray(data.Message) ? data.Message.join(' ') : data.Message;
            return res.status(400).json({ Message: mensaje || "El servicio rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "red",
            areaLabel: "Análisis de Red",
            moduloKey: "matriz",
            moduloLabel: "Matriz",
            accion: `Marcó Análisis como ${vigente ? "Vigente" : "No Vigente"}`,
            referencia: analisisId
        });

        return res.status(200).json({ Message: "Análisis actualizado con éxito", Data: data });

    } catch (error) {
        console.error("Error en actualizarAnalisisVigente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/evaluarAnalisis', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { gestionId, tipoSolicitudId } = req.body;
        if (!gestionId || !tipoSolicitudId) {
            return res.status(400).json({ Message: "GestionId y TipoSolicitudId son requeridos." });
        }

        const resp = await fetch("https://analisisderedapi.vesta-accelerate.com/api/AnalisisCriterioTestApi/EvaluarAnalisisByGestionAndTipoSolicitud", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ GestionId: gestionId, TipoSolicitudId: tipoSolicitudId })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`AnalisisCriterioTestApi/EvaluarAnalisisByGestionAndTipoSolicitud → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        return res.status(200).json({ Data: data });

    } catch (error) {
        console.error("Error en evaluarAnalisis:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/actualizarHaSidoEvaluado', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { referenciaOperativaId, haSidoEvaluado, usuarioId } = req.body;
        if (!referenciaOperativaId) {
            return res.status(400).json({ Message: "La Referencia Operativa (ReferenciaOperativaId) es requerida." });
        }
        if (!usuarioId) {
            return res.status(400).json({ Message: "El usuario que autoriza (UsuarioId) es requerido." });
        }
        if (typeof haSidoEvaluado !== "boolean") {
            return res.status(400).json({ Message: "Debe indicar el valor de HaSidoEvaluado (Sí/No)." });
        }

        const resp = await fetch("https://analisisderedapi.vesta-accelerate.com/api/ReferenciaOperativaCrudApi/ActualizarHaSidoEvaluado", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ReferenciaOperativaId: referenciaOperativaId, HaSidoEvaluado: haSidoEvaluado, UsuarioId: usuarioId })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`ReferenciaOperativaCrudApi/ActualizarHaSidoEvaluado → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`ReferenciaOperativaCrudApi/ActualizarHaSidoEvaluado → ${referenciaOperativaId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            const mensaje = Array.isArray(data.Message) ? data.Message.join(' ') : data.Message;
            return res.status(400).json({ Message: mensaje || "El servicio rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "red",
            areaLabel: "Análisis de Red",
            moduloKey: "matriz",
            moduloLabel: "Matriz",
            accion: `Marcó Referencia Operativa como ${haSidoEvaluado ? "Evaluada" : "No Evaluada"}`,
            referencia: referenciaOperativaId
        });

        return res.status(200).json({ Message: "Referencia Operativa actualizada con éxito", Data: data });

    } catch (error) {
        console.error("Error en actualizarHaSidoEvaluado:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/evaluarReferenciaOperativa', requirePermission('red', 'matriz'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La Referencia es requerida." });
        }

        const resp = await fetch("https://analisisderedapi.vesta-accelerate.com/api/AnalisisCriterioTestApi/EvaluarReferenciaOperativaByReferencia", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Referencia: referencia })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`AnalisisCriterioTestApi/EvaluarReferenciaOperativaByReferencia → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`AnalisisCriterioTestApi/EvaluarReferenciaOperativaByReferencia → ${referencia}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            const mensaje = Array.isArray(data.Message) ? data.Message.join(' ') : data.Message;
            return res.status(400).json({ Message: mensaje || "El servicio rechazó la solicitud." });
        }

        return res.status(200).json({ Message: "Referencia Operativa reevaluada con éxito", Data: data });

    } catch (error) {
        console.error("Error en evaluarReferenciaOperativa:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

export default app;
