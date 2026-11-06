import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { registrarActividad } from '../database/authDb.js'

const app = Router();
app.use(requireAuth);

// Mismo formato de 3 letras (HNL, USD, etc.) usado en el resto del sistema para Currency_Value.
const MONEDA_DISPLAY = { 340: "HNL", 840: "USD", 558: "NIO", 188: "CRC", 320: "GTQ" };

// Azure a veces responde HTTP 200 aunque la operación se haya rechazado por una regla de
// negocio -- hay que revisar IsValid, no solo el código HTTP (mismo criterio que Cfo.routes.js).
function mensajeDeAzure(data) {
    if (!data) return null;
    if (Array.isArray(data.Message)) return data.Message.length ? data.Message.join(' ') : null;
    return data.Message || null;
}

// Módulo de uso personal (Kleimer) para revisar/configurar Materiales Variables y Fijos
// cuando faltan dentro de una Negociación -- solo para Administradores (mismo criterio que
// Caja Chica: requirePermission ya deja pasar a cualquier admin sin asignar el permiso a mano).
// Cadena real confirmada: Negociación → Componente → MaterialVariableValor / MaterialFlatValor
// (el precio cuelga del Componente, no directo de la Negociación).

// Resuelve un lote de PersonaId a Nombre en un solo viaje a Personas, para no mostrar los GUIDs
// crudos (ClienteId, CreatedBy, ModifiedBy) en pantalla.
async function resolverNombresPersonas(ids) {
    const idsUnicos = [...new Set(ids.filter(Boolean).map((id) => String(id).toUpperCase()))]
        .filter((id) => id !== "00000000-0000-0000-0000-000000000000");
    if (idsUnicos.length === 0) return {};

    const poolPersonas = await conexion(BasesDeDatos.Personas);
    const request = poolPersonas.request();
    const parametros = idsUnicos.map((id, i) => {
        const nombre = `p${i}`;
        request.input(nombre, sql.UniqueIdentifier, id);
        return `@${nombre}`;
    });
    const resultado = await request.query(`SELECT Id, Nombre FROM [dbo].[Persona] WHERE Id IN (${parametros.join(", ")})`);
    const mapa = {};
    for (const p of resultado.recordset) {
        mapa[String(p.Id).toUpperCase()] = p.Nombre;
    }
    return mapa;
}

// Negociacion.ClienteId no es un PersonaId directo -- confirmado contra un caso real que
// apunta a CfoNetCore.dbo.Cliente.Id, cuyo PersonaId hay que resolver aparte (mismo criterio
// ya usado en especiesFiscalesPorReferencia, Cfo.routes.js).
async function resolverNombresClientes(ids) {
    const idsUnicos = [...new Set(ids.filter(Boolean).map((id) => String(id).toUpperCase()))];
    if (idsUnicos.length === 0) return {};

    const nombresPorId = await resolverNombresPersonas(idsUnicos);

    const faltantes = idsUnicos.filter((id) => !nombresPorId[id]);
    if (faltantes.length > 0) {
        const poolCfo = await conexion(BasesDeDatos.CfoNetCore);
        const requestClientes = poolCfo.request();
        const parametrosClientes = faltantes.map((id, i) => {
            const nombre = `cli${i}`;
            requestClientes.input(nombre, sql.UniqueIdentifier, id);
            return `@${nombre}`;
        });
        const clientes = await requestClientes.query(`
            SELECT Id, PersonaId FROM [dbo].[Cliente] WHERE Id IN (${parametrosClientes.join(", ")})
        `);
        const nombresPersonaId = await resolverNombresPersonas(clientes.recordset.map((c) => c.PersonaId));
        for (const c of clientes.recordset) {
            const nombre = c.PersonaId && nombresPersonaId[String(c.PersonaId).toUpperCase()];
            if (nombre) nombresPorId[String(c.Id).toUpperCase()] = nombre;
        }
    }

    return nombresPorId;
}

// Paso 1: a partir de una o varias Referencias Operativas, encuentra el/los Componente(s) que
// usan sus líneas (SalesOrderDetalle → SalesOrder → Componente). Una misma Referencia puede
// traer varios Componentes si sus líneas usan Segmentos distintos.
app.post('/materialesNegComponentePorReferencia', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const referencias = Array.isArray(req.body.referencias)
            ? req.body.referencias.map((r) => String(r).trim()).filter(Boolean)
            : [];
        if (referencias.length === 0) {
            return res.status(400).json({ Message: "Indique al menos una Referencia Operativa." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = referencias.map((valor, i) => {
            const nombre = `ref${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
        const resultado = await request.query(`
            SELECT SO.ReferenciaOperativa, SD.Id AS SalesOrderDetalleId, SO.ClienteId,
                   C.Id AS ComponenteId, C.Descripcion AS ComponenteDescripcion,
                   SO.CentroSuministrador, SO.OficinaVenta, C.IsSoftDeleted AS ComponenteEliminado
            FROM [dbo].[SalesOrderDetalle] SD
            LEFT JOIN [dbo].[SalesOrder] SO ON SO.Id = SD.SalesOrderId
            LEFT JOIN [dbo].[Componente] C ON C.Id = SD.ComponenteId
            WHERE SO.ReferenciaOperativa IN (${parametros.join(", ")}) AND SO.IsSoftDeleted = 0
        `);

        const nombresPorId = await resolverNombresClientes(resultado.recordset.map((r) => r.ClienteId));
        const filas = resultado.recordset.map((r) => ({
            ReferenciaOperativa: r.ReferenciaOperativa,
            SalesOrderDetalleId: r.SalesOrderDetalleId,
            Cliente: r.ClienteId ? (nombresPorId[String(r.ClienteId).toUpperCase()] || null) : null,
            ComponenteId: r.ComponenteId,
            ComponenteDescripcion: r.ComponenteDescripcion,
            CentroSuministrador: r.CentroSuministrador,
            OficinaVenta: r.OficinaVenta,
            ComponenteEliminado: !!r.ComponenteEliminado,
        }));

        const encontradas = new Set(filas.map((f) => f.ReferenciaOperativa));
        const noEncontradas = referencias.filter((r) => !encontradas.has(r));

        return res.json({ Filas: filas, NoEncontradas: noEncontradas });
    } catch (error) {
        console.error("Error en materialesNegComponentePorReferencia:", error);
        return res.status(500).json({ Message: "Error al buscar el Componente", Error: error.message });
    }
});

// Paso 2a: Materiales Variables ya configurados (con precio) para uno o varios Componentes.
app.post('/materialesNegVariablesPorComponente', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const componentes = Array.isArray(req.body.componentes) ? req.body.componentes.filter(Boolean) : [];
        if (componentes.length === 0) {
            return res.status(400).json({ Message: "Indique al menos un Componente." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = componentes.map((valor, i) => {
            const nombre = `c${i}`;
            request.input(nombre, sql.UniqueIdentifier, valor);
            return `@${nombre}`;
        });
        const resultado = await request.query(`
            SELECT N.ClienteId, MVV.Id AS MaterialVariableValorId, MS.Id AS MaterialVariableSegmentoId,
                   MVV.Valor, MVV.Costo, MS.CodigoErp, MF.Descripcion AS NombreMaterial, MVV.IsSoftDeleted,
                   MS.Currency_Value, MVV.ModifiedBy, MVV.CreatedBy, MVV.CreatedDate,
                   C.Id AS ComponenteId, C.Descripcion AS ComponenteDescripcion
            FROM [dbo].[Negociacion] N
            LEFT JOIN Componente C ON C.NegociacionId = N.Id
            LEFT JOIN MaterialVariableValor MVV ON MVV.ComponenteId = C.Id
            LEFT JOIN MaterialVariableSegmento MS ON MS.Id = MVV.MaterialVariableSegmentoId
            LEFT JOIN MaterialVariable MF ON MF.Id = MS.MaterialVariableId
            WHERE C.Id IN (${parametros.join(", ")}) AND MVV.IsSoftDeleted = 0
        `);

        const [nombresClientes, nombresPersonas] = await Promise.all([
            resolverNombresClientes(resultado.recordset.map((r) => r.ClienteId)),
            resolverNombresPersonas(resultado.recordset.flatMap((r) => [r.CreatedBy, r.ModifiedBy])),
        ]);
        const nombresPorId = { ...nombresClientes, ...nombresPersonas };
        const filas = resultado.recordset.map((r) => ({
            MaterialVariableValorId: r.MaterialVariableValorId,
            MaterialVariableSegmentoId: r.MaterialVariableSegmentoId,
            NombreMaterial: r.NombreMaterial,
            CodigoErp: r.CodigoErp,
            Valor: r.Valor,
            Costo: r.Costo,
            Moneda: MONEDA_DISPLAY[r.Currency_Value] || r.Currency_Value,
            Cliente: r.ClienteId ? (nombresPorId[String(r.ClienteId).toUpperCase()] || null) : null,
            CreadoPor: r.CreatedBy ? (nombresPorId[String(r.CreatedBy).toUpperCase()] || null) : null,
            CreadoFecha: r.CreatedDate,
            ModificadoPor: r.ModifiedBy ? (nombresPorId[String(r.ModifiedBy).toUpperCase()] || null) : null,
            ComponenteId: r.ComponenteId,
            ComponenteDescripcion: r.ComponenteDescripcion,
        }));

        return res.json(filas);
    } catch (error) {
        console.error("Error en materialesNegVariablesPorComponente:", error);
        return res.status(500).json({ Message: "Error al buscar Materiales Variables", Error: error.message });
    }
});

// Paso 2b: Materiales Fijos (Flat) ya configurados (con precio) para uno o varios Componentes.
app.post('/materialesNegFijosPorComponente', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const componentes = Array.isArray(req.body.componentes) ? req.body.componentes.filter(Boolean) : [];
        if (componentes.length === 0) {
            return res.status(400).json({ Message: "Indique al menos un Componente." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = componentes.map((valor, i) => {
            const nombre = `c${i}`;
            request.input(nombre, sql.UniqueIdentifier, valor);
            return `@${nombre}`;
        });
        const resultado = await request.query(`
            SELECT N.ClienteId, MFV.Id AS MaterialFlatValorId, MS.Id AS MaterialFlatSegmentoId,
                   MFV.Valor, MFV.Costo, MFV.CreatedDate, MFV.CreatedBy, MS.CodigoErp, MF.Descripcion AS NombreMaterial,
                   MFV.IsSoftDeleted, MS.Currency_Value, C.Id AS ComponenteId, C.Descripcion AS ComponenteDescripcion
            FROM [dbo].[Negociacion] N
            LEFT JOIN Componente C ON C.NegociacionId = N.Id
            LEFT JOIN MaterialFlatValor MFV ON MFV.ComponenteId = C.Id
            LEFT JOIN MaterialFlatSegmento MS ON MS.Id = MFV.MaterialFlatSegmentoId
            LEFT JOIN MaterialFlat MF ON MF.Id = MS.MaterialFlatId
            WHERE C.Id IN (${parametros.join(", ")}) AND MFV.IsSoftDeleted = 0
        `);

        const [nombresClientes, nombresPersonas] = await Promise.all([
            resolverNombresClientes(resultado.recordset.map((r) => r.ClienteId)),
            resolverNombresPersonas(resultado.recordset.map((r) => r.CreatedBy)),
        ]);
        const nombresPorId = { ...nombresClientes, ...nombresPersonas };
        const filas = resultado.recordset.map((r) => ({
            MaterialFlatValorId: r.MaterialFlatValorId,
            MaterialFlatSegmentoId: r.MaterialFlatSegmentoId,
            NombreMaterial: r.NombreMaterial,
            CodigoErp: r.CodigoErp,
            Valor: r.Valor,
            Costo: r.Costo,
            Moneda: MONEDA_DISPLAY[r.Currency_Value] || r.Currency_Value,
            Cliente: r.ClienteId ? (nombresPorId[String(r.ClienteId).toUpperCase()] || null) : null,
            CreadoPor: r.CreatedBy ? (nombresPorId[String(r.CreatedBy).toUpperCase()] || null) : null,
            CreadoFecha: r.CreatedDate,
            ComponenteId: r.ComponenteId,
            ComponenteDescripcion: r.ComponenteDescripcion,
        }));

        return res.json(filas);
    } catch (error) {
        console.error("Error en materialesNegFijosPorComponente:", error);
        return res.status(500).json({ Message: "Error al buscar Materiales Fijos", Error: error.message });
    }
});

// Búsqueda inversa: dado un ComponenteId, a qué Cliente pertenece (vía su Negociación) y qué
// Referencias Operativas / Hojas de Ruta lo usan (puede haber muchas: una misma Negociación
// se reutiliza en varias Referencias con el mismo Segmento). "Hoja de Ruta" es el mismo valor
// que Referencia Operativa (confirmado: HojaDeRuta.dbo.HojaRuta.NumeroHojaRuta se cruza por el
// mismo valor que SalesOrder.ReferenciaOperativa en otras partes de este sistema), así que no
// hace falta otra base de datos -- sale de SalesOrderDetalle/SalesOrder, igual que el Paso 1.
app.post('/materialesNegClientePorComponente', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const componenteId = (req.body.componenteId || "").trim();
        if (!componenteId) {
            return res.status(400).json({ Message: "Indique el Id del Componente." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);

        const resultadoComponente = await pool.request()
            .input('componenteId', sql.UniqueIdentifier, componenteId)
            .query(`
                SELECT C.Id AS ComponenteId, C.Descripcion AS ComponenteDescripcion,
                       C.IsSoftDeleted AS ComponenteEliminado, N.ClienteId
                FROM [dbo].[Componente] C
                LEFT JOIN [dbo].[Negociacion] N ON N.Id = C.NegociacionId
                WHERE C.Id = @componenteId
            `);
        if (resultadoComponente.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró ningún Componente con ese Id." });
        }
        const filaComponente = resultadoComponente.recordset[0];
        const nombresPorId = await resolverNombresClientes([filaComponente.ClienteId]);

        const resultadoReferencias = await pool.request()
            .input('componenteId', sql.UniqueIdentifier, componenteId)
            .query(`
                SELECT DISTINCT SO.ReferenciaOperativa, SO.IsSoftDeleted
                FROM [dbo].[SalesOrderDetalle] SD
                JOIN [dbo].[SalesOrder] SO ON SO.Id = SD.SalesOrderId
                WHERE SD.ComponenteId = @componenteId
                ORDER BY SO.ReferenciaOperativa
            `);

        return res.json({
            ComponenteId: filaComponente.ComponenteId,
            ComponenteDescripcion: filaComponente.ComponenteDescripcion,
            ComponenteEliminado: !!filaComponente.ComponenteEliminado,
            Cliente: filaComponente.ClienteId ? (nombresPorId[String(filaComponente.ClienteId).toUpperCase()] || null) : null,
            HojasDeRuta: resultadoReferencias.recordset.map((r) => ({
                ReferenciaOperativa: r.ReferenciaOperativa,
                Eliminada: !!r.IsSoftDeleted,
            })),
        });
    } catch (error) {
        console.error("Error en materialesNegClientePorComponente:", error);
        return res.status(500).json({ Message: "Error al buscar el Componente", Error: error.message });
    }
});

// Búsqueda de Materiales (Variable y Fijo) por nombre, paso previo para llegar al Segmento
// (MaterialVariableSegmentoId / MaterialFlatSegmentoId) que se necesita para configurar el
// Material dentro de una Negociación cuando no existe todavía.
app.post('/materialesBuscarPorNombre', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const texto = (req.body.texto || "").trim();
        if (!texto) {
            return res.status(400).json({ Message: "Ingrese un texto para buscar." });
        }
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const like = `%${texto}%`;
        const [variables, fijos] = await Promise.all([
            pool.request().input('texto', sql.VarChar, like)
                .query(`SELECT Id, Descripcion FROM [dbo].[MaterialVariable] WHERE Descripcion LIKE @texto`),
            pool.request().input('texto', sql.VarChar, like)
                .query(`SELECT Id, Descripcion FROM [dbo].[MaterialFlat] WHERE Descripcion LIKE @texto`),
        ]);
        const filas = [
            ...variables.recordset.map((r) => ({ MaterialId: r.Id, Descripcion: r.Descripcion, Tipo: "Variable" })),
            ...fijos.recordset.map((r) => ({ MaterialId: r.Id, Descripcion: r.Descripcion, Tipo: "Fijo" })),
        ];
        return res.json(filas);
    } catch (error) {
        console.error("Error en materialesBuscarPorNombre:", error);
        return res.status(500).json({ Message: "Error al buscar Materiales", Error: error.message });
    }
});

// Dado un MaterialId (de /materialesBuscarPorNombre) y su Tipo, trae los Segmentos
// (MaterialVariableSegmentoId / MaterialFlatSegmentoId) disponibles para ese Material.
app.post('/materialesSegmentosPorMaterial', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const materialId = (req.body.materialId || "").trim();
        const tipo = req.body.tipo === "fijo" ? "fijo" : "variable";
        if (!materialId) {
            return res.status(400).json({ Message: "Indique el Id del Material." });
        }
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request().input('materialId', sql.UniqueIdentifier, materialId);
        const resultado = tipo === "variable"
            ? await request.query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MV.Descripcion
                FROM [dbo].[MaterialVariableSegmento] MS
                LEFT JOIN [dbo].[MaterialVariable] MV ON MV.Id = MS.MaterialVariableId
                WHERE MS.MaterialVariableId = @materialId
            `)
            : await request.query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MF.Descripcion
                FROM [dbo].[MaterialFlatSegmento] MS
                LEFT JOIN [dbo].[MaterialFlat] MF ON MF.Id = MS.MaterialFlatId
                WHERE MS.MaterialFlatId = @materialId
            `);
        const filas = resultado.recordset.map((r) => ({
            SegmentoId: r.SegmentoId,
            CodigoErp: r.CodigoErp,
            Moneda: MONEDA_DISPLAY[r.Currency_Value] || r.Currency_Value,
            Descripcion: r.Descripcion,
            Tipo: tipo === "variable" ? "Variable" : "Fijo",
        }));
        return res.json(filas);
    } catch (error) {
        console.error("Error en materialesSegmentosPorMaterial:", error);
        return res.status(500).json({ Message: "Error al buscar Segmentos", Error: error.message });
    }
});

// Búsqueda directa de Segmento (Variable y Fijo) por Código ERP -- trae el SegmentoId en un
// solo paso, sin pasar primero por el Material.
app.post('/materialesBuscarSegmentoPorCodigoErp', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const texto = (req.body.texto || "").trim();
        if (!texto) {
            return res.status(400).json({ Message: "Ingrese un Código ERP para buscar." });
        }
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const like = `%${texto}%`;
        const [variables, fijos] = await Promise.all([
            pool.request().input('texto', sql.VarChar, like).query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MV.Descripcion
                FROM [dbo].[MaterialVariableSegmento] MS
                LEFT JOIN [dbo].[MaterialVariable] MV ON MV.Id = MS.MaterialVariableId
                WHERE MS.CodigoErp LIKE @texto
            `),
            pool.request().input('texto', sql.VarChar, like).query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MF.Descripcion
                FROM [dbo].[MaterialFlatSegmento] MS
                LEFT JOIN [dbo].[MaterialFlat] MF ON MF.Id = MS.MaterialFlatId
                WHERE MS.CodigoErp LIKE @texto
            `),
        ]);
        const filas = [
            ...variables.recordset.map((r) => ({ SegmentoId: r.SegmentoId, CodigoErp: r.CodigoErp, Moneda: MONEDA_DISPLAY[r.Currency_Value] || r.Currency_Value, Descripcion: r.Descripcion, Tipo: "Variable" })),
            ...fijos.recordset.map((r) => ({ SegmentoId: r.SegmentoId, CodigoErp: r.CodigoErp, Moneda: MONEDA_DISPLAY[r.Currency_Value] || r.Currency_Value, Descripcion: r.Descripcion, Tipo: "Fijo" })),
        ];
        return res.json(filas);
    } catch (error) {
        console.error("Error en materialesBuscarSegmentoPorCodigoErp:", error);
        return res.status(500).json({ Message: "Error al buscar Segmentos", Error: error.message });
    }
});

// Búsqueda directa de Segmento por su propio Id (MaterialVariableSegmentoId o
// MaterialFlatSegmentoId) -- para cuando ya se tiene el Id a mano (ej. de otro reporte) y solo
// se necesita confirmar a qué Material corresponde antes de configurarlo.
app.post('/materialesSegmentoPorId', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const segmentoId = (req.body.segmentoId || "").trim();
        if (!segmentoId) {
            return res.status(400).json({ Message: "Ingrese el Id del Segmento." });
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segmentoId)) {
            return res.status(400).json({ Message: "El Id del Segmento no tiene el formato correcto (GUID)." });
        }
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const [variable, fijo] = await Promise.all([
            pool.request().input('id', sql.UniqueIdentifier, segmentoId).query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MV.Descripcion
                FROM [dbo].[MaterialVariableSegmento] MS
                LEFT JOIN [dbo].[MaterialVariable] MV ON MV.Id = MS.MaterialVariableId
                WHERE MS.Id = @id
            `),
            pool.request().input('id', sql.UniqueIdentifier, segmentoId).query(`
                SELECT MS.Id AS SegmentoId, MS.CodigoErp, MS.Currency_Value, MF.Descripcion
                FROM [dbo].[MaterialFlatSegmento] MS
                LEFT JOIN [dbo].[MaterialFlat] MF ON MF.Id = MS.MaterialFlatId
                WHERE MS.Id = @id
            `),
        ]);
        const encontrado = variable.recordset[0]
            ? { ...variable.recordset[0], Tipo: "Variable" }
            : fijo.recordset[0]
                ? { ...fijo.recordset[0], Tipo: "Fijo" }
                : null;
        if (!encontrado) {
            return res.status(404).json({ Message: "No se encontró ningún Segmento (Variable ni Fijo) con ese Id." });
        }
        return res.json({
            SegmentoId: encontrado.SegmentoId,
            CodigoErp: encontrado.CodigoErp,
            Moneda: MONEDA_DISPLAY[encontrado.Currency_Value] || encontrado.Currency_Value,
            Descripcion: encontrado.Descripcion,
            Tipo: encontrado.Tipo,
        });
    } catch (error) {
        console.error("Error en materialesSegmentoPorId:", error);
        return res.status(500).json({ Message: "Error al buscar el Segmento", Error: error.message });
    }
});

// Crea el MaterialVariableValor o MaterialFlatValor (según Tipo) que le da precio a un
// Segmento ya encontrado (/materialesSegmentosPorMaterial o /materialesBuscarSegmentoPorCodigoErp)
// dentro de un Componente -- el paso final para "configurar" un Material que faltaba en la Negociación.
app.post('/materialesNegCrearValor', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const { ComponenteId, SegmentoId, Tipo, Valor, Costo, CreatedBy } = req.body;

        if (!ComponenteId) return res.status(400).json({ Message: "El Id del Componente es requerido." });
        if (!SegmentoId) return res.status(400).json({ Message: "El Id del Segmento es requerido." });
        if (Tipo !== "Variable" && Tipo !== "Fijo") return res.status(400).json({ Message: "El Tipo debe ser Variable o Fijo." });
        if (!CreatedBy) return res.status(400).json({ Message: "No se pudo identificar al usuario que autoriza." });
        const valorNum = Number(Valor);
        const costoNum = Number(Costo);
        if (!Number.isFinite(valorNum) || valorNum < 0) return res.status(400).json({ Message: "El Valor debe ser un número válido." });
        if (!Number.isFinite(costoNum) || costoNum < 0) return res.status(400).json({ Message: "El Costo debe ser un número válido." });

        const url = Tipo === "Variable"
            ? "https://cfows.azurewebsites.net/api/MaterialVariableValor/Create"
            : "https://cfows.azurewebsites.net/api/MaterialFlatValor/Create";
        const body = Tipo === "Variable"
            ? { ComponenteId, MaterialVariableSegmentoId: SegmentoId, Valor: valorNum, Costo: costoNum, CreatedBy }
            : { ComponenteId, MaterialFlatSegmentoId: SegmentoId, Valor: valorNum, Costo: costoNum, CreatedBy };

        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errText = await resp.text();
            let errData = null;
            try { errData = JSON.parse(errText); } catch { /* no era JSON */ }
            if (errData && errData.IsValid === false) {
                console.warn(`${url} → HTTP ${resp.status} (regla de negocio):`, errText);
                return res.status(400).json({ Message: errData.Exception?.Message || mensajeDeAzure(errData) || "Azure rechazó la solicitud." });
            }
            console.error(`${url} → HTTP ${resp.status}:`, errText);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errText });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${url} →`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: data.Exception?.Message || mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "materialesNegociacion",
            moduloLabel: "Materiales en Negociación",
            accion: `Agregó Material ${Tipo} (Segmento ${SegmentoId}) al Componente ${ComponenteId}, Valor ${valorNum}, Costo ${costoNum}`,
            referencia: ComponenteId
        });

        // El Id recién creado (data.Message.Id, confirmado contra una respuesta real de Azure) se
        // devuelve aparte para que el formulario pueda encadenar directo la creación de Escalas
        // (solo aplica a Variable) sin que el usuario tenga que ir a buscarlo de nuevo.
        const nuevoId = data?.Message?.Id || null;
        return res.status(200).json({ Message: "Material agregado con éxito", Data: data, MaterialValorId: nuevoId });
    } catch (error) {
        console.error("Error en materialesNegCrearValor:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Agrega una Escala (tramo) a un MaterialVariableValor ya creado -- solo aplica a Materiales
// Variables, no a Fijos. AplicaTasaCambio siempre va en true por decisión del negocio.
app.post('/materialesNegCrearEscala', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const { MaterialVariableValorId, Operador, Cota, Valor, Orden, TipoDeCalculo, CreatedBy } = req.body;

        if (!MaterialVariableValorId) return res.status(400).json({ Message: "El Id del Material Variable Valor es requerido." });
        if (!Operador) return res.status(400).json({ Message: "El Operador es requerido." });
        if (!CreatedBy) return res.status(400).json({ Message: "No se pudo identificar al usuario que autoriza." });

        const cotaNum = Number(Cota);
        const valorNum = Number(Valor);
        const ordenNum = Number.isFinite(Number(Orden)) ? Number(Orden) : 0;
        const tipoCalculoNum = Number(TipoDeCalculo);
        if (!Number.isFinite(cotaNum)) return res.status(400).json({ Message: "La Cota debe ser un número válido." });
        if (!Number.isFinite(valorNum)) return res.status(400).json({ Message: "El Valor debe ser un número válido." });
        if (![0, 1, 2].includes(tipoCalculoNum)) return res.status(400).json({ Message: "El Tipo de Cálculo no es válido." });

        const url = "https://cfows.azurewebsites.net/api/MaterialVariableValorEscala/Create";
        const body = {
            Operador,
            Cota: cotaNum,
            Valor: valorNum,
            Orden: ordenNum,
            TipoDeCalculo: tipoCalculoNum,
            MaterialVariableValorId,
            CreatedBy,
            AplicaTasaCambio: true,
        };

        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errText = await resp.text();
            let errData = null;
            try { errData = JSON.parse(errText); } catch { /* no era JSON */ }
            if (errData && errData.IsValid === false) {
                console.warn(`${url} → HTTP ${resp.status} (regla de negocio):`, errText);
                return res.status(400).json({ Message: errData.Exception?.Message || mensajeDeAzure(errData) || "Azure rechazó la solicitud." });
            }
            console.error(`${url} → HTTP ${resp.status}:`, errText);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errText });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${url} →`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: data.Exception?.Message || mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "materialesNegociacion",
            moduloLabel: "Materiales en Negociación",
            accion: `Agregó Escala (${Operador} ${cotaNum} → ${valorNum}, Orden ${ordenNum}) al Material Variable Valor ${MaterialVariableValorId}`,
            referencia: MaterialVariableValorId
        });

        return res.status(200).json({ Message: "Escala agregada con éxito", Data: data });
    } catch (error) {
        console.error("Error en materialesNegCrearEscala:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// POST a un endpoint de lista de Azure (mismos 3 usados para eliminar: MaterialVariableValor,
// MaterialFlatValor, MaterialVariableValorEscala) -- todos reciben {ModifiedBy, List} y responden
// con el mismo sobre {IsValid, Message, Exception}, así que se centraliza el manejo de error aquí
// en vez de repetirlo tres veces (mismo criterio IsValid/Exception que el resto del archivo).
async function eliminarListaEnAzure(url, modifiedBy, list) {
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ModifiedBy: modifiedBy, List: list })
    });

    if (!resp.ok) {
        const errText = await resp.text();
        let errData = null;
        try { errData = JSON.parse(errText); } catch { /* no era JSON */ }
        if (errData && errData.IsValid === false) {
            console.warn(`${url} → HTTP ${resp.status} (regla de negocio):`, errText);
            return { ok: false, message: errData.Exception?.Message || mensajeDeAzure(errData) || "Azure rechazó la solicitud." };
        }
        console.error(`${url} → HTTP ${resp.status}:`, errText);
        return { ok: false, message: "Error al comunicarse con el servicio externo" };
    }

    const data = await resp.json().catch(() => null);
    console.log(`${url} →`, JSON.stringify(data));
    if (data?.IsValid === false) {
        return { ok: false, message: data.Exception?.Message || mensajeDeAzure(data) || "Azure rechazó la solicitud." };
    }
    return { ok: true, data };
}

// Elimina uno o varios Materiales Variables de una Negociación. Antes de eliminarlos, busca y
// elimina de una vez sus Escalas (MaterialVariableValorEscala) -- si no se hace así quedan
// Escalas huérfanas apuntando a un MaterialVariableValor ya eliminado.
app.post('/materialesNegEliminarVariables', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
        const modifiedBy = req.body.modifiedBy;
        if (ids.length === 0) return res.status(400).json({ Message: "Indique al menos un Material a eliminar." });
        if (!modifiedBy) return res.status(400).json({ Message: "No se pudo identificar al usuario que autoriza." });

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = ids.map((valor, i) => {
            const nombre = `id${i}`;
            request.input(nombre, sql.UniqueIdentifier, valor);
            return `@${nombre}`;
        });
        const resultadoEscalas = await request.query(`
            SELECT Id FROM MaterialVariableValorEscala
            WHERE MaterialVariableValorId IN (${parametros.join(", ")}) AND IsSoftDeleted = 0
        `);
        const escalaIds = resultadoEscalas.recordset.map((r) => r.Id);

        if (escalaIds.length > 0) {
            const resultadoEscala = await eliminarListaEnAzure(
                "https://cfows.azurewebsites.net/api/MaterialVariableValorEscala/DeleteMaterialVariableValorEscalaList",
                modifiedBy, escalaIds
            );
            if (!resultadoEscala.ok) {
                return res.status(400).json({ Message: `No se pudieron eliminar las Escalas: ${resultadoEscala.message}` });
            }
        }

        const resultadoMaterial = await eliminarListaEnAzure(
            "https://cfows.azurewebsites.net/api/MaterialVariableValor/DeleteMaterialVariableValorList",
            modifiedBy, ids
        );
        if (!resultadoMaterial.ok) {
            return res.status(400).json({ Message: resultadoMaterial.message });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "materialesNegociacion",
            moduloLabel: "Materiales en Negociación",
            accion: `Eliminó ${ids.length} Material${ids.length !== 1 ? "es" : ""} Variable${ids.length !== 1 ? "s" : ""} (y ${escalaIds.length} Escala${escalaIds.length !== 1 ? "s" : ""} asociada${escalaIds.length !== 1 ? "s" : ""}): ${ids.join(", ")}`,
            referencia: ids[0]
        });

        return res.status(200).json({ Message: `✓ ${ids.length} Material${ids.length !== 1 ? "es" : ""} eliminado${ids.length !== 1 ? "s" : ""} con éxito`, EscalasEliminadas: escalaIds.length });
    } catch (error) {
        console.error("Error en materialesNegEliminarVariables:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Elimina uno o varios Materiales Fijos de una Negociación. A diferencia de los Variables, los
// Fijos no tienen Escalas asociadas, así que es un solo llamado a Azure.
app.post('/materialesNegEliminarFijos', requirePermission('cfo', 'materialesNegociacion'), async (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
        const modifiedBy = req.body.modifiedBy;
        if (ids.length === 0) return res.status(400).json({ Message: "Indique al menos un Material a eliminar." });
        if (!modifiedBy) return res.status(400).json({ Message: "No se pudo identificar al usuario que autoriza." });

        const resultado = await eliminarListaEnAzure(
            "https://cfows.azurewebsites.net/api/MaterialFlatValor/DeleteMaterialFlatValorList",
            modifiedBy, ids
        );
        if (!resultado.ok) {
            return res.status(400).json({ Message: resultado.message });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "materialesNegociacion",
            moduloLabel: "Materiales en Negociación",
            accion: `Eliminó ${ids.length} Material${ids.length !== 1 ? "es" : ""} Fijo${ids.length !== 1 ? "s" : ""}: ${ids.join(", ")}`,
            referencia: ids[0]
        });

        return res.status(200).json({ Message: `✓ ${ids.length} Material${ids.length !== 1 ? "es" : ""} eliminado${ids.length !== 1 ? "s" : ""} con éxito` });
    } catch (error) {
        console.error("Error en materialesNegEliminarFijos:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

export default app;
