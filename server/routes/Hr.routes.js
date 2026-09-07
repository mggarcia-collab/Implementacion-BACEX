import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'

const app = Router();
app.use(requireAuth);

app.post('/hojaRutaPorReferencia', requirePermission('cfo', 'cambio'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La referencia operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.HojaDeRuta);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`
                SELECT TOP 1
                    NumeroHojaRuta,
                    NumeroGestion,
                    AduanaId,
                    AduanaDescripcion,
                    ClienteId,
                    ClienteDescripcion,
                    IsSoftDeleted
                FROM HojaRuta
                WHERE NumeroHojaRuta = @referencia
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en hojaRutaPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener datos de hoja de ruta", Error: error.message });
    }
});

app.post('/hojaRutaEjemplo', requirePermission('cfo', 'cambio'), async (req, res) => {
    try {
        const { clienteId, aduanaId, gestionPrefix, excluirNumeroHojaRuta } = req.body;
        if (!clienteId || !aduanaId || !gestionPrefix) {
            return res.status(400).json({ Message: "clienteId, aduanaId y gestionPrefix son requeridos." });
        }

        const pool = await conexion(BasesDeDatos.HojaDeRuta);
        const resultado = await pool.request()
            .input('clienteId', sql.VarChar, clienteId)
            .input('aduanaId', sql.VarChar, aduanaId)
            .input('gestionPrefix', sql.VarChar, `${gestionPrefix}%`)
            .input('excluir', sql.VarChar, excluirNumeroHojaRuta || '')
            .query(`
                SELECT TOP 10
                    NumeroHojaRuta,
                    NumeroGestion,
                    AduanaId,
                    AduanaDescripcion,
                    ClienteId,
                    ClienteDescripcion
                FROM [dbo].[HojaRuta]
                WHERE ClienteId = @clienteId
                  AND AduanaId = @aduanaId
                  AND IsSoftDeleted = 0
                  AND NumeroGestion LIKE @gestionPrefix
                  AND NumeroHojaRuta <> @excluir
                ORDER BY CreatedDate DESC
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en hojaRutaEjemplo:", error);
        return res.status(500).json({ Message: "Error al obtener datos de HR de ejemplo", Error: error.message });
    }
});

// Resuelve la Aduana/Cliente de una Referencia Operativa para el módulo Cuadrilla, bajo su
// propio permiso (en vez de reusar 'cambio') para no atar su acceso al de Cambio de Componente.
app.post('/aduanaPorReferenciaCuadrilla', requirePermission('cfo', 'cuadrilla'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La referencia operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.HojaDeRuta);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`
                SELECT TOP 1
                    NumeroHojaRuta,
                    NumeroGestion,
                    AduanaId,
                    AduanaDescripcion,
                    ClienteId,
                    ClienteDescripcion,
                    IsSoftDeleted
                FROM HojaRuta
                WHERE NumeroHojaRuta = @referencia
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en aduanaPorReferenciaCuadrilla:", error);
        return res.status(500).json({ Message: "Error al obtener datos de hoja de ruta", Error: error.message });
    }
});

export default app;
