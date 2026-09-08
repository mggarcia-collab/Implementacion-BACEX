import { Router } from "express";
import { authDb } from "../database/authDb.js";
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
        fecha: f.created_date
    })));
});

export default app;
