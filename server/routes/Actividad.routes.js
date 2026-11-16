import { Router } from "express";
import { authDb, obtenerAlertasPendientes, marcarAlertaLeida, obtenerAlertasHistorial } from "../database/authDb.js";
import sql from "mssql";
import { conexion, BasesDeDatos } from "../database/database.js";
import { requireAuth } from "../middleware/auth.js";

const app = Router();
app.use(requireAuth);

function consultarActividadLocal(req, limite) {
    const filas = req.user.isAdmin
        ? authDb.prepare(`SELECT * FROM actividad ORDER BY created_date DESC LIMIT ?`).all(limite)
        : authDb
            .prepare(`SELECT * FROM actividad WHERE usuario_id = ? ORDER BY created_date DESC LIMIT ?`)
            .all(req.user.id, limite);

    return filas.map((f) => ({
        id: f.id,
        usuarioNombre: f.usuario_nombre,
        areaKey: f.area_key,
        areaLabel: f.area_label,
        moduloKey: f.modulo_key,
        moduloLabel: f.modulo_label,
        accion: f.accion,
        referencia: f.referencia,
        motivo: f.motivo,
        datosAntes: f.datos_antes,
        datosDespues: f.datos_despues,
        fecha: f.created_date
    }));
}

// Un usuario normal solo ve su propia actividad (útil tanto en el widget de Inicio
// como si más adelante consulta su propio historial); un admin ve la de todos —
// se usa tanto para el widget de Inicio (limit chico) como para la bitácora
// completa de Administración (limit grande).
//
// Lee de RegistroActividades.dbo.Bitacora (SQL Server dedicado), donde registrarActividad()
// en authDb.js escribe cada registro. Si la consulta falla cae de vuelta al SQLite local
// (mismo respaldo que usa registrarActividad).
app.get("/actividad", requireAuth, async (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 10, 5000);
    try {
        const pool = await conexion(BasesDeDatos.RegistroActividades);
        const request = pool.request().input("limite", sql.Int, limite);
        if (!req.user.isAdmin) {
            request.input("usuarioId", sql.Int, req.user.id);
        }

        const resultado = await request.query(`
            SELECT TOP (@limite) *
            FROM dbo.Bitacora
            ${req.user.isAdmin ? "" : "WHERE UsuarioId = @usuarioId"}
            ORDER BY CreatedDate DESC
        `);

        res.json(resultado.recordset.map((f) => ({
            id: f.Id,
            usuarioNombre: f.UsuarioNombre,
            areaKey: f.AreaKey,
            areaLabel: f.AreaLabel,
            moduloKey: f.ModuloKey,
            moduloLabel: f.ModuloLabel,
            accion: f.Accion,
            referencia: f.Referencia,
            motivo: f.Motivo,
            datosAntes: f.DatosAntes,
            datosDespues: f.DatosDespues,
            fecha: f.CreatedDate
        })));
    } catch (error) {
        console.error("No se pudo consultar actividad en SQL Server, se muestra la local:", error.message);
        try {
            res.json(consultarActividadLocal(req, limite));
        } catch (errorLocal) {
            console.error("Error al consultar actividad local:", errorLocal);
            res.status(500).json({ Message: "Error al consultar la bitácora", Error: errorLocal.message });
        }
    }
});

// Alertas pendientes del usuario logueado (ej. widget de Inicio). Solo las propias —
// a diferencia de /actividad, aquí no hay excepción para admin: la alerta ya se crea
// apuntada a usuarios concretos (los destinatarios de negocio), no es un log general.
app.get("/alertas", requireAuth, (req, res) => {
    const filas = obtenerAlertasPendientes(req.user.id);
    res.json(filas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        titulo: f.titulo,
        mensaje: f.mensaje,
        referencia: f.referencia,
        fecha: f.created_date
    })));
});

app.post("/alertas/:id/leer", requireAuth, (req, res) => {
    marcarAlertaLeida(Number(req.params.id), req.user.id);
    res.json({ Message: "ok" });
});

// Historial de alertas ya leídas del usuario logueado (pestaña "Historial" de la campanita).
app.get("/alertas/historial", requireAuth, (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 50, 500);
    const filas = obtenerAlertasHistorial(req.user.id, limite);
    res.json(filas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        titulo: f.titulo,
        mensaje: f.mensaje,
        referencia: f.referencia,
        fecha: f.created_date,
        leidaFecha: f.leida_date
    })));
});

export default app;
