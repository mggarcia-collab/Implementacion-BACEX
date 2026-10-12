import { Router } from "express";
import { authDb, obtenerAlertasPendientes, marcarAlertaLeida, obtenerAlertasHistorial } from "../database/authDb.js";
import { requireAuth } from "../middleware/auth.js";

const app = Router();
app.use(requireAuth);

// Un usuario normal solo ve su propia actividad (útil tanto en el widget de Inicio
// como si más adelante consulta su propio historial); un admin ve la de todos —
// se usa tanto para el widget de Inicio (limit chico) como para la bitácora
// completa de Administración (limit grande).
app.get("/actividad", requireAuth, (req, res) => {
    const limite = Math.min(Number(req.query.limit) || 10, 5000);
    const filas = req.user.isAdmin
        ? authDb.prepare(`SELECT * FROM actividad ORDER BY created_date DESC LIMIT ?`).all(limite)
        : authDb
            .prepare(`SELECT * FROM actividad WHERE usuario_id = ? ORDER BY created_date DESC LIMIT ?`)
            .all(req.user.id, limite);

    res.json(filas.map((f) => ({
        id: f.id,
        usuarioNombre: f.usuario_nombre,
        areaKey: f.area_key,
        areaLabel: f.area_label,
        moduloKey: f.modulo_key,
        moduloLabel: f.modulo_label,
        accion: f.accion,
        referencia: f.referencia,
        motivo: f.motivo,
        fecha: f.created_date
    })));
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
