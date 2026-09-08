import { Router } from "express";
import sql from "mssql";
import { conexion, BasesDeDatos } from "../database/database.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// --- Búsqueda de Personas (solo admin, para elegir a quién vincular un usuario) ---
// Reemplaza a la vieja tabla "autorizadores": en vez de mantener una lista aparte,
// se busca en vivo contra la BD real de Personas y se toma su Id (uniqueidentifier)
// como el ID real que se manda como ModifiedBy/UsuarioId a los servicios externos.

router.post("/personas/buscar", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { texto } = req.body;
        const palabras = (texto || "").trim().split(/\s+/).filter(Boolean);
        if (palabras.length === 0) {
            return res.json([]);
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const request = pool.request();
        const condiciones = palabras.map((palabra, i) => {
            const nombre = `p${i}`;
            request.input(nombre, sql.VarChar, `%${palabra}%`);
            return `(Nombre LIKE @${nombre} OR Apellido LIKE @${nombre})`;
        });

        const resultado = await request.query(`
            SELECT TOP 10 Id, Nombre, Apellido, NombreUsuario
            FROM [dbo].[Persona]
            WHERE ${condiciones.join(" AND ")}
              AND IsSoftDeleted = 0
            ORDER BY Nombre, Apellido
        `);

        res.json(resultado.recordset.map((p) => ({
            id: p.Id,
            nombre: `${p.Nombre} ${p.Apellido}`.trim(),
            correo: p.NombreUsuario
        })));
    } catch (error) {
        console.error("Error en buscar personas:", error);
        return res.status(500).json({ Message: "Error al buscar en Personas", Error: error.message });
    }
});

export default router;
