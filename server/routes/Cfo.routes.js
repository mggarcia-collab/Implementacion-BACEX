import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { registrarActividad, authDb } from '../database/authDb.js'

const app = Router();
app.use(requireAuth);

// Azure a veces responde HTTP 200 aunque la operación se haya rechazado por una
// regla de negocio (ej. "Documento se encuentra pagado"). Hay que revisar IsValid,
// no solo el código HTTP, para saber si realmente se aplicó el cambio.
function mensajeDeAzure(data) {
    if (!data) return null;
    if (Array.isArray(data.Message)) return data.Message.length ? data.Message.join(' ') : null;
    return data.Message || null;
}

// RegistroContable.ModifiedBy (CfoNetCore) guarda el mismo Id de Persona que usuarios.persona_id
// (auth.db) — el mismo que se manda como UsuarioId/CreatedBy/ModifiedBy al crear/anular cosas
// desde esta app. Sirve para poder mostrar "quién" hizo algo (ej. quién anuló una factura) a
// partir de ese Id, sin tener que exponer el GUID crudo en pantalla. Si el Id no pertenece a
// ningún usuario de esta app (lo modificó alguien desde el sistema CFO directamente, por fuera
// de esta herramienta), se busca como segundo intento en CfoNetCore.dbo.Operador (la misma
// tabla de operadores/colaboradores que ya usa /buscarOperador) antes de darse por vencido.
async function resolverNombresPorPersonaId(ids, poolCfo) {
    const idsUnicos = [...new Set(ids.filter(Boolean).map((id) => String(id).toUpperCase()))]
        .filter((id) => id !== "00000000-0000-0000-0000-000000000000");
    if (idsUnicos.length === 0) return {};

    const mapa = {};
    const placeholders = idsUnicos.map(() => "?").join(", ");
    const filasUsuarios = authDb.prepare(`SELECT persona_id, nombre_completo FROM usuarios WHERE UPPER(persona_id) IN (${placeholders})`).all(...idsUnicos);
    for (const fila of filasUsuarios) {
        mapa[String(fila.persona_id).toUpperCase()] = fila.nombre_completo;
    }

    const faltantes = idsUnicos.filter((id) => !mapa[id]);
    if (faltantes.length > 0 && poolCfo) {
        const request = poolCfo.request();
        const parametros = faltantes.map((id, i) => {
            const nombre = `op${i}`;
            request.input(nombre, sql.UniqueIdentifier, id);
            return `@${nombre}`;
        });
        const resultado = await request.query(`SELECT Id, Nombre FROM [dbo].[Operador] WHERE Id IN (${parametros.join(", ")})`);
        for (const fila of resultado.recordset) {
            mapa[String(fila.Id).toUpperCase()] = fila.Nombre;
        }
    }

    return mapa;
}

// Único requisito para poder redondear: que el documento tenga un monto numérico válido.
function puedeRedondear(monto) {
    return typeof monto === 'number' && isFinite(monto);
}

// Acepta tanto un campo singular (ej. "sp") como su versión en lista (ej. "sps") y devuelve
// siempre un arreglo de strings recortados y sin vacíos.
function normalizarLista(lista, valorUnico) {
    return Array.isArray(lista)
        ? lista.map((v) => String(v).trim()).filter(Boolean)
        : (valorUnico ? [String(valorUnico).trim()] : []);
}

// El mismo documento se puede buscar por distintos identificadores (Referencia Operativa,
// SP, Número de Documento Fiscal, Número de Documento SAP). Arma un arreglo de condiciones
// SQL (una por cada identificador que el usuario realmente ingresó) para unirlas con OR;
// las que vienen vacías simplemente no se agregan, para no generar "IN ()" inválido.
function condicionesIdentificadoresDocumento(request, { referencias, sps, documentosFiscales, documentosSap }, prefijo) {
    const condiciones = [];

    if (referencias.length) {
        const params = referencias.map((valor, i) => {
            const nombre = `${prefijo}ref${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
        condiciones.push(`d.ReferenciaOperativa IN (${params.join(", ")})`);
    }
    if (sps.length) {
        const params = sps.map((valor, i) => {
            const nombre = `${prefijo}sp${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
        condiciones.push(`sp.[Unique] IN (${params.join(", ")})`);
    }
    if (documentosFiscales.length) {
        const params = documentosFiscales.map((valor, i) => {
            const nombre = `${prefijo}fis${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
        condiciones.push(`d.NumeroDocumentoFiscal IN (${params.join(", ")})`);
    }
    if (documentosSap.length) {
        const params = documentosSap.map((valor, i) => {
            const nombre = `${prefijo}sap${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
        condiciones.push(`rc.NumeroDocumentoSap IN (${params.join(", ")})`);
    }

    return condiciones;
}

app.post('/habilitarSalesOrder', requirePermission('cfo', 'salesorder'), async (req, res) => {
    try {
        const { ReferenciaOperativa, ModifiedBy } = req.body;

        if (!ReferenciaOperativa) {
            return res.status(400).json({ Message: "La referencia operativa es requerida." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // 1. Consultar el estado actual en la BD
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('referencia', sql.VarChar, ReferenciaOperativa)
            .query(`
                SELECT [Status_Value], [IsSoftDeleted]
                FROM [dbo].[SalesOrder]
                WHERE [ReferenciaOperativa] = @referencia
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró la Sales Order." });
        }

        const { Status_Value: status, IsSoftDeleted: eliminada } = validacion.recordset[0];

        // 2. Aplicar regla de negocio (IsSoftDeleted: 0 = activa, 1 = eliminada)
        if (eliminada) {
            return res.status(400).json({ Message: "La Sales Order está eliminada y no se puede habilitar." });
        }
        if (status === 2) {
            return res.status(400).json({ Message: "La Sales Order ya se encuentra habilitada." });
        }
        if (status === 3) {
            return res.status(400).json({ Message: "La Sales Order ya fue facturada y no se puede habilitar." });
        }
        if (status !== 1) {
            return res.status(400).json({ Message: `La Sales Order no está en un estado válido para habilitarse (Estado: ${status}).` });
        }

        // 3. Si pasa la validación, consumir la API externa
        const resp = await fetch("https://cfows.azurewebsites.net/api/SalesOrder/SetEntregaDeDocumentos", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ReferenciaOperativas: [ReferenciaOperativa], ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`SetEntregaDeDocumentos → HTTP ${resp.status} para ${ReferenciaOperativa}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json();
        console.log(`SetEntregaDeDocumentos → ${ReferenciaOperativa}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "salesorder",
            moduloLabel: "Habilitar SalesOrder",
            accion: "Habilitó Sales Order",
            referencia: ReferenciaOperativa
        });

        return res.status(200).json({ Message: "Sales Order Habilitada con éxito", Data: data });

    } catch (error) {
        console.error("Error en habilitarSalesOrder:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/getCliente', requirePermission('cfo', 'salesorder'), async (req, res) => {
    try {
        const { referencia } = req.body;
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        
        // Uso de .input() para evitar inyección SQL
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`SELECT 
                [ReferenciaOperativa]
               ,[Status_Value] AS [StatusId]
               ,CASE [Status_Value]
                    WHEN 1 THEN 'Habilitar (La orden pasará a Sales Order Habilitada)'
                    WHEN 2 THEN 'Sales Order ya está habilitada'
                    WHEN 3 THEN 'Sales Order Facturada'
                    ELSE 'Estado Desconocido (' + CAST([Status_Value] AS VARCHAR(10)) + ')'
                END AS [Mensaje_Validacion]
            FROM [dbo].[SalesOrder]
            WHERE [ReferenciaOperativa] = @referencia;`);

        return res.json(resultado.recordset);

    } catch (error) {
        return res.status(500).json({ Message: "Error al obtener cliente", Error: error.message });
    }
});

app.post('/documentosPorReferencia', requirePermission('cfo', 'habDoc'), async (req, res) => {
    try {
        const { referencia, referencias, sp, sps, documentoFiscal, documentosFiscales, documentoSap, documentosSap, codigoErp } = req.body;
        const listaReferencias = normalizarLista(referencias, referencia);
        const listaSps = normalizarLista(sps, sp);
        const listaFiscales = normalizarLista(documentosFiscales, documentoFiscal);
        const listaSap = normalizarLista(documentosSap, documentoSap);

        if (listaReferencias.length === 0 && listaSps.length === 0 && listaFiscales.length === 0 && listaSap.length === 0) {
            return res.status(400).json({ Message: "Ingrese al menos un criterio de búsqueda: Referencia Operativa, SP, Número de Documento Fiscal o Número de Documento SAP." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const condiciones = condicionesIdentificadoresDocumento(request, {
            referencias: listaReferencias,
            sps: listaSps,
            documentosFiscales: listaFiscales,
            documentosSap: listaSap
        }, "doc");
        // Opcional: filtra a solo los documentos cuyo material tenga este Código ERP
        // (MaterialTenant.CodigoErpReembolso). Si no se manda, se comporta igual que antes.
        request.input('codigoErp', sql.VarChar, codigoErp ? String(codigoErp).trim() : null);

        const resultado = await request
            .query(`
                SELECT
                    d.Id AS DocumentoId,
                    pr.Nombre AS Proveedor,
                    MP.Descripcion AS MaterialProveedor,
                    c.Nombre AS Cliente,
                    d.Discriminator AS Tipo_Documento,
                    d.ReferenciaOperativa AS Referencia_Operativa,
                    d.TotalMonto AS Monto_Documento,
                    CASE
                        WHEN d.DueñoDocumento_Value = '1' THEN 'Vesta'
                        WHEN d.DueñoDocumento_Value = '2' THEN 'Cliente'
                        ELSE CAST(d.DueñoDocumento_Value AS VARCHAR)
                    END AS [Dueño Documento],
                    CASE
                        WHEN d.ReembolsoStatus_Value = '0' THEN 'Inhabilitado'
                        WHEN d.ReembolsoStatus_Value = '1' THEN 'Habilitado'
                        WHEN d.ReembolsoStatus_Value = '2' THEN 'Facturado'
                        ELSE CAST(d.ReembolsoStatus_Value AS VARCHAR)
                    END AS [Estado de documento],
                    d.CreatedDate AS Fecha
                FROM Documento d
                LEFT JOIN SolicitudDePago AS sp ON (d.Id = sp.Id)
                LEFT JOIN RegistroContable rc ON (d.RegistroContableId = rc.Id)
                LEFT JOIN Cliente c ON d.ClienteId = c.Id
                LEFT JOIN Proveedor pr ON d.ProveedorId = pr.Id
                OUTER APPLY (
                    SELECT TOP 1 MP2.Descripcion
                    FROM dbo.DocumentoDetalle DD2
                    JOIN dbo.MaterialProveedor MP2 ON MP2.Id = DD2.MaterialProveedorId
                    LEFT JOIN dbo.MaterialTenant MT2 ON MT2.Id = MP2.MaterialTenantId
                    WHERE DD2.DocumentoId = d.Id
                      AND (@codigoErp IS NULL OR MT2.CodigoErpReembolso = @codigoErp)
                    ORDER BY MP2.Descripcion ASC
                ) MP
                WHERE (${condiciones.join(" OR ")})
                  AND d.IsSoftDeleted = 0
                  AND (@codigoErp IS NULL OR EXISTS (
                      SELECT 1 FROM dbo.DocumentoDetalle DD3
                      JOIN dbo.MaterialProveedor MP3 ON MP3.Id = DD3.MaterialProveedorId
                      JOIN dbo.MaterialTenant MT3 ON MT3.Id = MP3.MaterialTenantId
                      WHERE DD3.DocumentoId = d.Id AND MT3.CodigoErpReembolso = @codigoErp
                  ))
                ORDER BY d.ReferenciaOperativa ASC, MP.Descripcion ASC
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en documentosPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener documentos", Error: error.message });
    }
});

// Lista de Códigos ERP disponibles para llenar el desplegable de filtro: solo los que
// realmente están ligados a algún documento que coincida con el criterio actual (mismo filtro
// base que documentosPorReferencia, sin el filtro de codigoErp).
app.post('/codigosErpPorReferencia', requirePermission('cfo', 'habDoc'), async (req, res) => {
    try {
        const { referencia, referencias, sp, sps, documentoFiscal, documentosFiscales, documentoSap, documentosSap } = req.body;
        const listaReferencias = normalizarLista(referencias, referencia);
        const listaSps = normalizarLista(sps, sp);
        const listaFiscales = normalizarLista(documentosFiscales, documentoFiscal);
        const listaSap = normalizarLista(documentosSap, documentoSap);

        if (listaReferencias.length === 0 && listaSps.length === 0 && listaFiscales.length === 0 && listaSap.length === 0) {
            return res.json([]);
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const condiciones = condicionesIdentificadoresDocumento(request, {
            referencias: listaReferencias,
            sps: listaSps,
            documentosFiscales: listaFiscales,
            documentosSap: listaSap
        }, "erp");

        const resultado = await request.query(`
            SELECT DISTINCT MT.CodigoErpReembolso AS CodigoErp
            FROM Documento d
            LEFT JOIN SolicitudDePago AS sp ON (d.Id = sp.Id)
            LEFT JOIN RegistroContable rc ON (d.RegistroContableId = rc.Id)
            JOIN dbo.DocumentoDetalle DD ON DD.DocumentoId = d.Id
            JOIN dbo.MaterialProveedor MP ON MP.Id = DD.MaterialProveedorId
            JOIN dbo.MaterialTenant MT ON MT.Id = MP.MaterialTenantId
            WHERE (${condiciones.join(" OR ")})
              AND d.IsSoftDeleted = 0
              AND MT.CodigoErpReembolso IS NOT NULL
            ORDER BY MT.CodigoErpReembolso ASC
        `);

        return res.json(resultado.recordset.map((r) => r.CodigoErp));

    } catch (error) {
        console.error("Error en codigosErpPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener códigos ERP", Error: error.message });
    }
});

app.post('/habilitarDocumento', requirePermission('cfo', 'habDoc'), async (req, res) => {
    try {
        const { DocumentoId, ModifiedBy } = req.body;

        if (!DocumentoId) {
            return res.status(400).json({ Message: "El documento es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // 1. Consultar el estado actual en la BD
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('documentoId', sql.UniqueIdentifier, DocumentoId)
            .query(`
                SELECT [ReembolsoStatus_Value], [DueñoDocumento_Value], [ReferenciaOperativa]
                FROM [dbo].[Documento]
                WHERE [Id] = @documentoId
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el documento." });
        }

        const status = String(validacion.recordset[0].ReembolsoStatus_Value).trim();
        const referenciaOperativa = validacion.recordset[0].ReferenciaOperativa;

        // 2. Aplicar regla de negocio (Solo permitir si el estado es 0 = Inhabilitado)
        if (status === '1') {
            return res.status(400).json({ Message: "El documento ya se encuentra habilitado." });
        }
        if (status === '2') {
            return res.status(400).json({ Message: "El documento ya fue facturado y no se puede habilitar." });
        }
        if (status !== '0') {
            return res.status(400).json({ Message: `El documento no está en un estado válido para habilitarse (Estado: ${status}).` });
        }

        // 3. Si pasa la validación, consumir la API externa
        const resp = await fetch("https://cfows.azurewebsites.net/api/Documento/UpdateStatus", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ DocuementoId: [DocumentoId], ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`UpdateStatus → HTTP ${resp.status} para ${DocumentoId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`UpdateStatus → ${DocumentoId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        // Azure ya actualiza tanto el estado como el dueño (Vesta → Cliente) en su respuesta;
        // no hace falta (ni tenemos permiso de UPDATE) tocar la tabla directamente nosotros.
        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "habDoc",
            moduloLabel: "Habilitar Documento",
            accion: "Habilitó documento",
            referencia: referenciaOperativa || DocumentoId
        });

        return res.status(200).json({ Message: "Documento habilitado con éxito", Data: data });

    } catch (error) {
        console.error("Error en habilitarDocumento:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/deshabilitarDocumento', requirePermission('cfo', 'habDoc'), async (req, res) => {
    try {
        const { DocumentoId, ModifiedBy } = req.body;

        if (!DocumentoId) {
            return res.status(400).json({ Message: "El documento es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // 1. Consultar el estado actual en la BD
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('documentoId', sql.UniqueIdentifier, DocumentoId)
            .query(`
                SELECT [ReembolsoStatus_Value], [DueñoDocumento_Value], [ReferenciaOperativa]
                FROM [dbo].[Documento]
                WHERE [Id] = @documentoId
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el documento." });
        }

        const status = String(validacion.recordset[0].ReembolsoStatus_Value).trim();
        const referenciaOperativa = validacion.recordset[0].ReferenciaOperativa;

        // 2. Aplicar regla de negocio (Solo permitir si el estado es 1 = Habilitado)
        if (status === '0') {
            return res.status(400).json({ Message: "El documento ya se encuentra inhabilitado." });
        }
        if (status === '2') {
            return res.status(400).json({ Message: "El documento ya fue facturado y no se puede deshabilitar." });
        }
        if (status !== '1') {
            return res.status(400).json({ Message: `El documento no está en un estado válido para deshabilitarse (Estado: ${status}).` });
        }

        // 3. Si pasa la validación, consumir la API externa
        const resp = await fetch("https://cfows.azurewebsites.net/api/Documento/DeshabilitarDocumentos", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ DocumentoId: [DocumentoId], ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`DeshabilitarDocumentos → HTTP ${resp.status} para ${DocumentoId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`DeshabilitarDocumentos → ${DocumentoId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "habDoc",
            moduloLabel: "Habilitar Documento",
            accion: "Deshabilitó documento",
            referencia: referenciaOperativa || DocumentoId
        });

        return res.status(200).json({ Message: "Documento deshabilitado con éxito", Data: data });

    } catch (error) {
        console.error("Error en deshabilitarDocumento:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/documentosParaEliminar', requirePermission('cfo', 'elimDoc'), async (req, res) => {
    try {
        const { referencia, referencias, sp, sps, documentoFiscal, documentosFiscales, documentoSap, documentosSap, codigoErp } = req.body;
        const listaReferencias = normalizarLista(referencias, referencia);
        const listaSps = normalizarLista(sps, sp);
        const listaFiscales = normalizarLista(documentosFiscales, documentoFiscal);
        const listaSap = normalizarLista(documentosSap, documentoSap);

        if (listaReferencias.length === 0 && listaSps.length === 0 && listaFiscales.length === 0 && listaSap.length === 0) {
            return res.status(400).json({ Message: "Ingrese al menos un criterio de búsqueda: Referencia Operativa, SP, Número de Documento Fiscal o Número de Documento SAP." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const condiciones = condicionesIdentificadoresDocumento(request, {
            referencias: listaReferencias,
            sps: listaSps,
            documentosFiscales: listaFiscales,
            documentosSap: listaSap
        }, "doc");
        // Opcional: filtra a solo los documentos cuyo material tenga este Código ERP
        // (MaterialTenant.CodigoErpReembolso). Si no se manda, se comporta igual que antes.
        request.input('codigoErp', sql.VarChar, codigoErp ? String(codigoErp).trim() : null);

        const resultado = await request
            .query(`
                SELECT
                    d.Id AS Documento_ID,
                    pr.Nombre AS Proveedor,
                    MP.Descripcion AS MaterialProveedor,
                    c.Nombre AS Cliente,
                    CASE
                        WHEN d.IsSoftDeleted = 0 THEN 'Habilitado'
                        WHEN d.IsSoftDeleted = 1 THEN 'Eliminado'
                        ELSE 'Desconocido'
                    END AS IsSoftDeleted,
                    d.Discriminator AS Tipo_Documento,
                    d.ReferenciaOperativa AS Referencia_Operativa,
                    d.TotalMonto AS Monto_Documento,
                    CASE
                        WHEN d.DueñoDocumento_Value = 1 THEN 'Vesta'
                        WHEN d.DueñoDocumento_Value = 2 THEN 'Cliente'
                        ELSE 'Desconocido'
                    END AS Dueñodocumento_value,
                    d.CreatedDate AS Fecha
                FROM Documento d
                LEFT JOIN SolicitudDePago AS sp ON (d.Id = sp.Id)
                LEFT JOIN Pago p ON (sp.PagoId = p.Id)
                LEFT JOIN Cliente c ON (d.ClienteId = c.Id)
                LEFT JOIN Proveedor pr ON (d.ProveedorId = pr.Id)
                LEFT JOIN RegistroContable rc ON (d.RegistroContableId = rc.Id)
                OUTER APPLY (
                    SELECT TOP 1 MP2.Descripcion, MP2.MaterialTenantId
                    FROM dbo.DocumentoDetalle DD2
                    JOIN dbo.MaterialProveedor MP2 ON MP2.Id = DD2.MaterialProveedorId
                    LEFT JOIN dbo.MaterialTenant MT2 ON MT2.Id = MP2.MaterialTenantId
                    WHERE DD2.DocumentoId = d.Id
                      AND (@codigoErp IS NULL OR MT2.CodigoErpReembolso = @codigoErp)
                    ORDER BY MP2.Descripcion ASC
                ) MP
                LEFT JOIN MaterialTenant MT ON MP.MaterialTenantId = MT.Id
                WHERE (${condiciones.join(" OR ")})
                  AND d.IsSoftDeleted = '0'
                  AND (@codigoErp IS NULL OR EXISTS (
                      SELECT 1 FROM dbo.DocumentoDetalle DD3
                      JOIN dbo.MaterialProveedor MP3 ON MP3.Id = DD3.MaterialProveedorId
                      JOIN dbo.MaterialTenant MT3 ON MT3.Id = MP3.MaterialTenantId
                      WHERE DD3.DocumentoId = d.Id AND MT3.CodigoErpReembolso = @codigoErp
                  ))
                ORDER BY d.ReferenciaOperativa ASC, MP.Descripcion ASC
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en documentosParaEliminar:", error);
        return res.status(500).json({ Message: "Error al obtener documentos", Error: error.message });
    }
});

// Lista de Códigos ERP disponibles para llenar el desplegable de filtro: solo los que
// realmente están ligados a algún documento eliminable de la(s) Referencia(s) Operativa(s)
// ingresada(s) (mismo filtro base que documentosParaEliminar, sin el filtro de codigoErp).
app.post('/codigosErpParaEliminar', requirePermission('cfo', 'elimDoc'), async (req, res) => {
    try {
        const { referencia, referencias, sp, sps, documentoFiscal, documentosFiscales, documentoSap, documentosSap } = req.body;
        const listaReferencias = normalizarLista(referencias, referencia);
        const listaSps = normalizarLista(sps, sp);
        const listaFiscales = normalizarLista(documentosFiscales, documentoFiscal);
        const listaSap = normalizarLista(documentosSap, documentoSap);

        if (listaReferencias.length === 0 && listaSps.length === 0 && listaFiscales.length === 0 && listaSap.length === 0) {
            return res.json([]);
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const condiciones = condicionesIdentificadoresDocumento(request, {
            referencias: listaReferencias,
            sps: listaSps,
            documentosFiscales: listaFiscales,
            documentosSap: listaSap
        }, "erp");

        const resultado = await request.query(`
            SELECT DISTINCT MT.CodigoErpReembolso AS CodigoErp
            FROM Documento d
            LEFT JOIN SolicitudDePago AS sp ON (d.Id = sp.Id)
            LEFT JOIN RegistroContable rc ON (d.RegistroContableId = rc.Id)
            JOIN dbo.DocumentoDetalle DD ON DD.DocumentoId = d.Id
            JOIN dbo.MaterialProveedor MP ON MP.Id = DD.MaterialProveedorId
            JOIN dbo.MaterialTenant MT ON MT.Id = MP.MaterialTenantId
            WHERE (${condiciones.join(" OR ")})
              AND d.IsSoftDeleted = '0'
              AND MT.CodigoErpReembolso IS NOT NULL
            ORDER BY MT.CodigoErpReembolso ASC
        `);

        return res.json(resultado.recordset.map((r) => r.CodigoErp));

    } catch (error) {
        console.error("Error en codigosErpParaEliminar:", error);
        return res.status(500).json({ Message: "Error al obtener códigos ERP", Error: error.message });
    }
});

app.post('/eliminarDocumento', requirePermission('cfo', 'elimDoc'), async (req, res) => {
    try {
        const { DocumentoId, ModifiedBy, Observacion } = req.body;

        if (!DocumentoId) {
            return res.status(400).json({ Message: "El documento es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar el motivo de la eliminación." });
        }

        // 1. Consultar el documento actual en la BD
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('documentoId', sql.UniqueIdentifier, DocumentoId)
            .query(`
                SELECT [IsSoftDeleted], [Discriminator], [ReferenciaOperativa]
                FROM [dbo].[Documento]
                WHERE [Id] = @documentoId
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el documento." });
        }

        const { IsSoftDeleted, Discriminator, ReferenciaOperativa: referenciaOperativa } = validacion.recordset[0];

        // 2. Aplicar reglas de negocio
        if (IsSoftDeleted) {
            return res.status(400).json({ Message: "El documento ya fue eliminado." });
        }

        // 3. Los DocumentoFiscalLiquidacion usan un endpoint distinto al resto de documentos.
        const esFiscalLiquidacion = Discriminator === 'DocumentoFiscalLiquidacion';
        const urlEliminar = esFiscalLiquidacion
            ? "https://cfows.azurewebsites.net/api/DocumentoFiscalLiquidacion/DCUpdateISDCreatedFiscal"
            : "https://cfows.azurewebsites.net/api/Documento/DCUpdateISDCreated";

        const resp = await fetch(urlEliminar, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id: DocumentoId, ModifiedBy, Observacion, EnviarCorreo: true })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`${urlEliminar} → HTTP ${resp.status} para ${DocumentoId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${urlEliminar} → ${DocumentoId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "elimDoc",
            moduloLabel: "Eliminar Documento",
            accion: "Eliminó documento",
            referencia: referenciaOperativa || DocumentoId,
            motivo: Observacion
        });

        return res.status(200).json({ Message: "Documento eliminado con éxito", Data: data });

    } catch (error) {
        console.error("Error en eliminarDocumento:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/contrarecibosPorCodigo', requirePermission('cfo', 'contrarecibo'), async (req, res) => {
    try {
        const { codigoInterno, codigosInternos } = req.body;
        const listaCodigos = Array.isArray(codigosInternos)
            ? codigosInternos.map((c) => String(c).trim()).filter(Boolean)
            : (codigoInterno ? [String(codigoInterno).trim()] : []);

        if (listaCodigos.length === 0) {
            return res.status(400).json({ Message: "El código interno es requerido." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = listaCodigos.map((valor, i) => {
            const nombre = `codigo${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request
            .query(`
                SELECT
                    cr.Id,
                    cr.ClienteId,
                    c.Nombre AS Cliente,
                    cr.CodigoInterno,
                    cr.Observacion,
                    cr.TotalMonto_Amount AS Monto,
                    CASE WHEN cr.IsSoftDeleted = 1 THEN 'Eliminado' ELSE 'Activo' END AS Estado
                FROM ContraRecibo cr
                LEFT JOIN Cliente c ON cr.ClienteId = c.Id
                WHERE cr.CodigoInterno IN (${parametros.join(", ")})
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en contrarecibosPorCodigo:", error);
        return res.status(500).json({ Message: "Error al obtener contrarecibos", Error: error.message });
    }
});

app.post('/eliminarContrarecibo', requirePermission('cfo', 'contrarecibo'), async (req, res) => {
    try {
        const { Id, ModifiedBy, Observacion } = req.body;

        if (!Id) {
            return res.status(400).json({ Message: "El contrarecibo es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar el motivo de la eliminación." });
        }

        // 1. Consultar el contrarecibo actual en la BD
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('id', sql.UniqueIdentifier, Id)
            .query(`
                SELECT [IsSoftDeleted], [CodigoInterno]
                FROM [dbo].[ContraRecibo]
                WHERE [Id] = @id
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el contrarecibo." });
        }
        if (validacion.recordset[0].IsSoftDeleted) {
            return res.status(400).json({ Message: "El contrarecibo ya fue eliminado." });
        }
        const codigoInterno = validacion.recordset[0].CodigoInterno;

        // 2. Si pasa la validación, consumir la API externa
        const resp = await fetch("https://cfows.azurewebsites.net/api/Contrarecibo/Delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, Observacion, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Contrarecibo/Delete → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`Contrarecibo/Delete → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "contrarecibo",
            moduloLabel: "Eliminar ContraRecibo",
            accion: "Eliminó contrarecibo",
            referencia: codigoInterno || Id,
            motivo: Observacion
        });

        return res.status(200).json({ Message: "Contrarecibo eliminado con éxito", Data: data });

    } catch (error) {
        console.error("Error en eliminarContrarecibo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/documentosParaRedondeo', requirePermission('cfo', 'redondeo'), async (req, res) => {
    try {
        const { sp, sps } = req.body;
        const listaSps = Array.isArray(sps)
            ? sps.map((s) => String(s).trim()).filter(Boolean)
            : (sp ? [String(sp).trim()] : []);

        if (listaSps.length === 0) {
            return res.status(400).json({ Message: "El número de Solicitud de Pago (SP) es requerido." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = listaSps.map((valor, i) => {
            const nombre = `sp${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request
            .query(`
                SELECT
                    d.Id,
                    pr.Nombre AS Proveedor,
                    pr.PersonaId,
                    c.Id AS Cliente_Id,
                    c.Nombre AS Cliente,
                    d.Discriminator AS Tipo_Documento,
                    d.ReferenciaOperativa AS Referencia_Operativa,
                    d.NumeroDocumentoFiscal AS Numero_DocumentoFiscal,
                    d.TotalMonto AS Monto_Documento,
                    d.DueñoDocumento_Value,
                    d.ReembolsoStatus_Value,
                    dd.PrecioVenta,
                    dd.Impuesto,
                    d.Moneda_Value,
                    d.FlagTasaDeSeguridad,
                    rc.NumeroDocumentoSap AS NumeroDocumento_Sap,
                    sp.FechaPago AS Fecha_Solicitud_Pago,
                    p.CreatedDate AS Fecha_Creacion_Pago,
                    p.FechaDigitalizacion AS Fecha_oficial_Pago,
                    sp.[Unique] AS Numero_SolicitudDePago,
                    p.ReferenciaBancaria AS ReferenciaBancaria,
                    p.[Unique] AS NumeroSolicitudDePago,
                    p.RegistroSap AS Registro_Sap,
                    MP.Descripcion AS MaterialProveedor,
                    MP.Id AS MaterialProveedorId,
                    MT.CodigoErpReembolso,
                    MT.CuentaMayor,
                    d.CreatedBy,
                    d.CreatedDate,
                    d.RegistroContableFacturaId,
                    d.RegistroContableId,
                    rc.MensajeSAp
                FROM Documento d
                LEFT JOIN SolicitudDePago AS sp ON (d.Id = sp.Id)
                LEFT JOIN Pago p ON (sp.PagoId = p.Id)
                LEFT JOIN Cliente c ON (d.ClienteId = c.Id)
                LEFT JOIN Proveedor pr ON (d.ProveedorId = pr.Id)
                LEFT JOIN RegistroContable rc ON (d.RegistroContableId = rc.Id)
                OUTER APPLY (
                    SELECT TOP 1 DD.PrecioVenta, DD.Impuesto, DD.MaterialProveedorId
                    FROM dbo.DocumentoDetalle DD
                    WHERE DD.DocumentoId = d.Id
                    ORDER BY DD.PrecioVenta DESC
                ) dd
                LEFT JOIN dbo.MaterialProveedor MP ON MP.Id = dd.MaterialProveedorId
                LEFT JOIN MaterialTenant MT ON MP.MaterialTenantId = MT.Id
                WHERE sp.[Unique] IN (${parametros.join(", ")})
                  AND d.IsSoftDeleted = 0
                ORDER BY d.Id ASC
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en documentosParaRedondeo:", error);
        return res.status(500).json({ Message: "Error al obtener documentos", Error: error.message });
    }
});

app.post('/redondearDocumentos', requirePermission('cfo', 'redondeo'), async (req, res) => {
    try {
        const { Ids, ModifiedBy } = req.body;

        if (!Array.isArray(Ids) || Ids.length === 0) {
            return res.status(400).json({ Message: "Debe seleccionar al menos un documento para redondear." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // Validar contra el monto real en base de datos que ningún documento exceda el límite de redondeo.
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = Ids.map((id, i) => {
            const nombre = `id${i}`;
            request.input(nombre, sql.UniqueIdentifier, id);
            return `@${nombre}`;
        });
        const validacion = await request.query(`
            SELECT Id, TotalMonto, ReferenciaOperativa
            FROM Documento
            WHERE Id IN (${parametros.join(", ")})
        `);

        const noRedondeables = validacion.recordset.filter((doc) => !puedeRedondear(doc.TotalMonto));
        if (noRedondeables.length > 0) {
            return res.status(400).json({
                Message: `No se puede redondear: ${noRedondeables.length} documento(s) no tienen un monto válido.`
            });
        }

        const referenciasOperativas = [...new Set(validacion.recordset.map((doc) => doc.ReferenciaOperativa).filter(Boolean))];

        const resp = await fetch("https://cfows.azurewebsites.net/api/Documento/Redondeo", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Ids, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Documento/Redondeo → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`Documento/Redondeo → ${JSON.stringify(Ids)}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "redondeo",
            moduloLabel: "Redondeo de Documentos",
            accion: `Redondeó ${Ids.length} documento(s)`,
            referencia: referenciasOperativas.join(", ") || Ids.join(", ")
        });

        return res.status(200).json({ Message: "Documentos redondeados con éxito", Data: data });

    } catch (error) {
        console.error("Error en redondearDocumentos:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/aduanaPorReferencia', requirePermission('cfo', 'cambio'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La referencia operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`
                SELECT
                    SO.ReferenciaOperativa,
                    SO.CentroSuministrador,
                    S.Nombre,
                    SO.Status_Value,
                    CASE
                        WHEN SO.Status_Value = 3 THEN 'Facturado'
                        WHEN SO.Status_Value = 2 THEN 'Entregada de Documentos'
                        WHEN SO.Status_Value = 1 THEN 'Creado'
                        ELSE 'Estado Desconocido'
                    END AS Status_DisplayName,
                    SO.Digitalizado,
                    SO.IsSoftDeleted
                FROM dbo.SalesOrder SO
                LEFT JOIN dbo.Sitio S ON S.OficinaVenta = SO.OficinaVenta
                WHERE SO.ReferenciaOperativa = @referencia
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en aduanaPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener datos de aduana", Error: error.message });
    }
});

app.post('/componentePorReferencias', requirePermission('cfo', 'cambio'), async (req, res) => {
    try {
        const { referencias } = req.body;
        const lista = Array.isArray(referencias)
            ? referencias.map((r) => String(r).trim()).filter(Boolean)
            : [];

        if (lista.length === 0) {
            return res.status(400).json({ Message: "Debe indicar al menos una Referencia Operativa." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = lista.map((valor, i) => {
            const nombre = `ref${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request.query(`
            SELECT
                SO.ReferenciaOperativa,
                SD.id AS SalesOrderDetalleId,
                C.ID AS Componente_ID,
                C.Descripcion,
                SO.CentroSuministrador,
                SO.OficinaVenta,
                SO.IsSoftDeleted,
                LEN(SO.Observacion) AS ObservacionLongitud
            FROM [dbo].[SalesOrderDetalle] SD
            LEFT JOIN [dbo].[SalesOrder] SO ON SO.id = SD.salesOrderId
            LEFT JOIN [dbo].[Componente] C ON C.ID = SD.ComponenteID
            WHERE SO.ReferenciaOperativa IN (${parametros.join(", ")})
              AND SO.IsSoftDeleted = 0
        `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en componentePorReferencias:", error);
        return res.status(500).json({ Message: "Error al obtener componentes", Error: error.message });
    }
});

app.post('/actualizarComponente', requirePermission('cfo', 'cambio'), async (req, res) => {
    try {
        const { SalesOrderDetalleId, ComponenteId, OficinaVenta, CentroSuministrador, ModifiedBy, Observacion } = req.body;

        if (!SalesOrderDetalleId) {
            return res.status(400).json({ Message: "El detalle del Sales Order (SalesOrderDetalleId) es requerido." });
        }
        if (!ComponenteId) {
            return res.status(400).json({ Message: "Debe seleccionar el nuevo componente." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar el motivo del cambio." });
        }

        // Solo para la bitácora: la Referencia Operativa es más útil que el
        // SalesOrderDetalleId (un GUID interno) para saber a qué se le hizo el cambio.
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const infoSalesOrder = await pool.request()
            .input('salesOrderDetalleId', sql.UniqueIdentifier, SalesOrderDetalleId)
            .query(`
                SELECT SO.ReferenciaOperativa
                FROM [dbo].[SalesOrderDetalle] SD
                LEFT JOIN [dbo].[SalesOrder] SO ON SO.id = SD.salesOrderId
                WHERE SD.id = @salesOrderDetalleId
            `);
        const referenciaOperativa = infoSalesOrder.recordset[0]?.ReferenciaOperativa;

        const resp = await fetch("https://cfows.azurewebsites.net/api/SalesOrder/UpdateComponenteList", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ModifiedBy,
                Observacion: Observacion.trim(),
                List: [
                    { SalesOrderDetalleId, ComponenteId, OficinaVenta, CentroSuministrador }
                ]
            })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`SalesOrder/UpdateComponenteList → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`SalesOrder/UpdateComponenteList → ${SalesOrderDetalleId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "cambio",
            moduloLabel: "Cambio de Componente",
            accion: "Actualizó componente",
            referencia: referenciaOperativa || SalesOrderDetalleId,
            motivo: Observacion
        });

        return res.status(200).json({ Message: "Componente actualizado con éxito", Data: data });

    } catch (error) {
        console.error("Error en actualizarComponente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Valores fijos para todo Documento Provisional NIC creado desde este módulo.
// Lo único que varía por creación es la ReferenciaOperativa; todo lo demás es
// exactamente el mismo JSON de ejemplo, sin modificar nada.
const DOCUMENTO_PROVISIONAL_NIC = {
    Moneda: 558,
    PaisId: "C7194841-BB94-4903-ADD7-0065CC7AF42C",
    Observacion: "Creado despues de facturacion, revisar como costearlo",
    DueñoDocumento: 1,
    Division: "9095",
    ProveedorId: "2AD9E57F-6C10-420A-9334-10EDE479CAFB",
    ClienteId: "2F51BA44-3A35-4AF9-ABC1-12E08D47F362",
    CreatedBy: "72545B19-EE37-4343-8383-1F5B35DB65D7",
    Cantidad: 1,
    PrecioVenta: 183.12,
    Impuesto: 27.47,
    Total: 210.59,
    MaterialProveedorId: "3147E0F0-5F78-481A-9160-163C94291198",
    TenantId: "2B45F90A-6691-4829-BA76-0F7B53790453",
    ContextoId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    SolicitanteDocumentoId: "72545B19-EE37-4343-8383-1F5B35DB65D7",
};

app.post('/crearDocumentoProvisionalNic', requirePermission('cfo', 'docProvisionalNic'), async (req, res) => {
    try {
        const { ReferenciaOperativa } = req.body;

        if (!ReferenciaOperativa) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/DocumentoProvisional/CreateMany", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                DocumentoProvisionales: [{
                    ReferenciaOperativa,
                    Moneda: DOCUMENTO_PROVISIONAL_NIC.Moneda,
                    PaisId: DOCUMENTO_PROVISIONAL_NIC.PaisId,
                    Observacion: DOCUMENTO_PROVISIONAL_NIC.Observacion,
                    DueñoDocumento: DOCUMENTO_PROVISIONAL_NIC.DueñoDocumento,
                    Division: DOCUMENTO_PROVISIONAL_NIC.Division,
                    ProveedorId: DOCUMENTO_PROVISIONAL_NIC.ProveedorId,
                    ClienteId: DOCUMENTO_PROVISIONAL_NIC.ClienteId,
                    CreatedBy: DOCUMENTO_PROVISIONAL_NIC.CreatedBy,
                    DocumentoProvisionalDetalles: [{
                        Cantidad: DOCUMENTO_PROVISIONAL_NIC.Cantidad,
                        PrecioVenta: DOCUMENTO_PROVISIONAL_NIC.PrecioVenta,
                        Impuesto: DOCUMENTO_PROVISIONAL_NIC.Impuesto,
                        Total: DOCUMENTO_PROVISIONAL_NIC.Total,
                        MaterialProveedorId: DOCUMENTO_PROVISIONAL_NIC.MaterialProveedorId
                    }],
                    TenantId: DOCUMENTO_PROVISIONAL_NIC.TenantId
                }],
                ContextoId: DOCUMENTO_PROVISIONAL_NIC.ContextoId,
                SolicitanteDocumentoId: DOCUMENTO_PROVISIONAL_NIC.SolicitanteDocumentoId
            })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`DocumentoProvisional/CreateMany → HTTP ${resp.status} para ${ReferenciaOperativa}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`DocumentoProvisional/CreateMany → ${ReferenciaOperativa}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "docProvisionalNic",
            moduloLabel: "Documento Provisional NIC (Proveedores)",
            accion: "Creó Documento Provisional NIC",
            referencia: ReferenciaOperativa
        });

        return res.status(200).json({ Message: "Documento Provisional creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearDocumentoProvisionalNic:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/facturasPorReferencia', requirePermission('cfo', 'anulacionFacturas'), async (req, res) => {
    try {
        const { referencias } = req.body;
        const listaReferencias = Array.isArray(referencias)
            ? referencias.map((r) => String(r).trim()).filter(Boolean)
            : [];

        if (listaReferencias.length === 0) {
            return res.status(400).json({ Message: "Debe indicar al menos una Referencia Operativa." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);

        // REPLACE(columna, '-', '') = @valor vuelve la búsqueda no-sargable (no puede usar
        // índice); en la tabla Documento (grande) eso causa un escaneo completo demasiado
        // lento (probado: >60s y vence el timeout). Combinarlo con OR/subquery en el mismo
        // WHERE es igual de lento incluso contra SalesOrder, porque hace que el optimizador
        // deseche el índice para todo el predicado (probado también). Por eso va en dos
        // pasos separados: 1) resolver la forma exacta (con guiones) contra SalesOrder, que
        // sí tolera el REPLACE por ser una tabla chica; 2) buscar en Documento con IN plano
        // (rápido, sí usa índice) usando esa forma resuelta más lo que el usuario escribió
        // tal cual (por si ya tecleó los guiones correctos).
        const parametrosSinGuion1 = listaReferencias.map((valor, i) => {
            const nombre = `refS${i}`;
            return { nombre, valor: valor.replace(/-/g, '') };
        });

        const requestResolver = pool.request();
        parametrosSinGuion1.forEach(({ nombre, valor }) => requestResolver.input(nombre, sql.VarChar, valor));
        const resueltos = await requestResolver.query(`
            SELECT DISTINCT ReferenciaOperativa FROM dbo.SalesOrder
            WHERE REPLACE(ReferenciaOperativa, '-', '') IN (${parametrosSinGuion1.map((p) => `@${p.nombre}`).join(", ")})
        `);

        const referenciasResueltas = [...new Set([
            ...listaReferencias,
            ...resueltos.recordset.map((r) => r.ReferenciaOperativa)
        ])];

        const request = pool.request();
        const parametrosSinGuion = listaReferencias.map((valor, i) => {
            const nombre = `refS${i}`;
            request.input(nombre, sql.VarChar, valor.replace(/-/g, ''));
            return `@${nombre}`;
        });
        const parametrosResueltos = referenciasResueltas.map((valor, i) => {
            const nombre = `refR${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request.query(`
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.SalesOrder SO
            LEFT JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE REPLACE(SO.ReferenciaOperativa, '-', '') IN (${parametrosSinGuion.join(", ")})
              AND SO.Status_Value = 3

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.Documento D
            LEFT JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE D.ReferenciaOperativa IN (${parametrosResueltos.join(", ")})
              AND D.ReembolsoStatus_Value = 2

            -- Al anular una factura, el Status_Value/ReembolsoStatus_Value del SalesOrder o
            -- Documento cambia, así que las dos consultas de arriba dejan de encontrarla y
            -- desaparecería de los resultados. Esta consulta aparte la vuelve a traer,
            -- buscando directamente RegistroContable ya anulados (IsSoftDeleted = 1) para
            -- la misma referencia, sin importar el estado actual del SalesOrder/Documento.
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.SalesOrder SO
            INNER JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE REPLACE(SO.ReferenciaOperativa, '-', '') IN (${parametrosSinGuion.join(", ")})
              AND RC.IsSoftDeleted = 1

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.Documento D
            INNER JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE D.ReferenciaOperativa IN (${parametrosResueltos.join(", ")})
              AND RC.IsSoftDeleted = 1
        `);

        const crudas = [...(resultado.recordsets[0] || []), ...(resultado.recordsets[1] || []), ...(resultado.recordsets[2] || []), ...(resultado.recordsets[3] || [])];
        const nombresPorId = await resolverNombresPorPersonaId(crudas.filter((f) => f.IsSoftDeleted).map((f) => f.ModifiedBy), pool);
        const facturas = crudas.map((f) => ({
            Tipo: f.Tipo,
            ReferenciaOperativa: f.ReferenciaOperativa,
            NumeroFacturaSap: f.NumeroFacturaSap,
            Estado: f.IsSoftDeleted ? "Anulada" : "Habilitada",
            AnuladoPor: f.IsSoftDeleted ? (nombresPorId[String(f.ModifiedBy).toUpperCase()] || null) : null,
            AnuladoFecha: f.IsSoftDeleted ? f.ModifiedDate : null,
        }));
        return res.json(facturas);

    } catch (error) {
        console.error("Error en facturasPorReferencia:", error);
        return res.status(500).json({ Message: "Error al buscar facturas", Error: error.message });
    }
});

// Igual que facturasPorReferencia pero filtrando directamente por NumeroFacturaSap: para
// cuando solo se conoce el número de factura. Como ya se tiene el número exacto, no se
// exige que el SalesOrder/Documento esté en un estado en particular (a diferencia de
// facturasPorReferencia) — así una factura ya anulada también aparece, con su Estado real,
// en vez de no encontrarse.
app.post('/facturasPorNumero', requirePermission('cfo', 'anulacionFacturas'), async (req, res) => {
    try {
        const { facturas } = req.body;
        const listaFacturas = Array.isArray(facturas)
            ? facturas.map((f) => String(f).trim()).filter(Boolean)
            : [];

        if (listaFacturas.length === 0) {
            return res.status(400).json({ Message: "Debe indicar al menos un número de factura." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = listaFacturas.map((valor, i) => {
            const nombre = `fac${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request.query(`
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.SalesOrder SO
            INNER JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE RC.NumeroFacturaSap IN (${parametros.join(", ")})

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted, RC.ModifiedBy, RC.ModifiedDate
            FROM dbo.Documento D
            INNER JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE RC.NumeroFacturaSap IN (${parametros.join(", ")})
        `);

        const crudas = [...(resultado.recordsets[0] || []), ...(resultado.recordsets[1] || [])];
        const nombresPorId = await resolverNombresPorPersonaId(crudas.filter((f) => f.IsSoftDeleted).map((f) => f.ModifiedBy), pool);
        const resultados = crudas.map((f) => ({
            Tipo: f.Tipo,
            ReferenciaOperativa: f.ReferenciaOperativa,
            NumeroFacturaSap: f.NumeroFacturaSap,
            Estado: f.IsSoftDeleted ? "Anulada" : "Habilitada",
            AnuladoPor: f.IsSoftDeleted ? (nombresPorId[String(f.ModifiedBy).toUpperCase()] || null) : null,
            AnuladoFecha: f.IsSoftDeleted ? f.ModifiedDate : null,
        }));
        return res.json(resultados);

    } catch (error) {
        console.error("Error en facturasPorNumero:", error);
        return res.status(500).json({ Message: "Error al buscar facturas", Error: error.message });
    }
});

app.post('/anularFacturas', requirePermission('cfo', 'anulacionFacturas'), async (req, res) => {
    try {
        const { Facturas, Observacion, UsuarioId, Correo } = req.body;

        const facturas = Array.isArray(Facturas) ? Facturas.map((f) => String(f).trim()).filter(Boolean) : [];
        if (facturas.length === 0) {
            return res.status(400).json({ Message: "Debe indicar al menos una factura." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar la observación (motivo de la anulación)." });
        }
        if (!UsuarioId) {
            return res.status(400).json({ Message: "El usuario que autoriza es requerido." });
        }
        if (!Correo) {
            return res.status(400).json({ Message: "Tu usuario autorizador no tiene un correo configurado. Pide a un administrador que lo agregue en Administración → Autorizadores." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/RegistroContable/HabilitarParaRefacturacion", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                UsuarioId,
                Facturas: facturas,
                Observacion: Observacion.trim(),
                correos: [Correo],
                EnviarCorreo: true
            })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`RegistroContable/HabilitarParaRefacturacion → HTTP ${resp.status} para ${JSON.stringify(facturas)}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`RegistroContable/HabilitarParaRefacturacion → ${JSON.stringify(facturas)}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "anulacionFacturas",
            moduloLabel: "Anulación de Facturas",
            accion: `Anuló ${facturas.length} factura(s)`,
            referencia: facturas.join(", "),
            motivo: Observacion
        });

        return res.status(200).json({ Message: "Factura(s) anulada(s) con éxito", Data: data });

    } catch (error) {
        console.error("Error en anularFacturas:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Resuelve, a partir de la Referencia Operativa, los dos IDs que "AddLineaMaterialNewApp"
// necesita y que NO dependen de la Aduana: Componente.SegmentoId (Segmentos[0].Id) y el
// MaterialVariableSegmentoId del material "Cuadrilla" dentro de ese Componente (se probó con
// 2 referencias/negociaciones distintas y ambos valores salieron iguales en las dos, por lo
// que parecen fijos/globales — pero se resuelven en vivo por si alguna negociación no tiene
// Cuadrilla configurada, en vez de asumirlos como constante).
app.post('/cuadrillaPorReferencia', requirePermission('cfo', 'cuadrilla'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`
                SELECT TOP 1
                    C.Id AS ComponenteId,
                    C.SegmentoId,
                    C.Descripcion AS ComponenteDescripcion
                FROM [dbo].[SalesOrderDetalle] SD
                LEFT JOIN [dbo].[SalesOrder] SO ON SO.id = SD.salesOrderId
                LEFT JOIN [dbo].[Componente] C ON C.ID = SD.ComponenteID
                WHERE SO.ReferenciaOperativa = @referencia
                  AND SO.IsSoftDeleted = 0
            `);

        const fila = resultado.recordset[0];
        if (!fila || !fila.ComponenteId) {
            return res.status(404).json({ Message: "No se encontró un Componente para esa Referencia Operativa." });
        }

        // "Cuadrilla" del lado del Componente (da el Valor a cobrar) y del ComponenteSELF
        // (da el Costo interno) — mismo MaterialVariableSegmentoId en ambos casos, solo
        // cambia el MaterialVariableValorId (y por lo tanto sus escalas).
        const cuadrilla = await pool.request()
            .input('cid', sql.UniqueIdentifier, fila.ComponenteId)
            .query(`
                SELECT MVV.Id AS MaterialVariableValorId, MS.ID AS MaterialVariableSegmentoId, MS.Currency_Value
                FROM Componente C
                LEFT JOIN MaterialVariableValor MVV ON MVV.ComponenteId = C.Id
                LEFT JOIN MaterialVariableSegmento MS ON MS.ID = MVV.MaterialVariableSegmentoId
                LEFT JOIN MaterialVariable MF ON MF.ID = MS.MaterialVariableId
                WHERE C.Id = @cid AND MVV.IsSoftDeleted = 0 AND MF.Descripcion = 'Cuadrilla'
            `);
        const filaCuadrilla = cuadrilla.recordset[0];
        if (!filaCuadrilla) {
            return res.status(404).json({ Message: "Esa Referencia Operativa no tiene 'Cuadrilla' configurada en su negociación." });
        }

        const cuadrillaSelf = await pool.request()
            .input('cid', sql.UniqueIdentifier, fila.ComponenteId)
            .query(`
                SELECT MVV.Id AS MaterialVariableValorId
                FROM Componente C
                LEFT JOIN MaterialVariableValor MVV ON MVV.ComponenteId = C.Id
                LEFT JOIN MaterialVariableSegmento MS ON MS.ID = MVV.MaterialVariableSegmentoId
                LEFT JOIN MaterialVariable MF ON MF.ID = MS.MaterialVariableId
                WHERE C.ComponenteId = @cid AND MVV.IsSoftDeleted = 0 AND MF.Descripcion = 'Cuadrilla'
            `);
        const filaCuadrillaSelf = cuadrillaSelf.recordset[0];

        // Escalas: cada Orden (1=Muestreo, 2=Parcial, 3=Completa) trae su propio Valor.
        // El Costo sale de la escala equivalente (mismo Orden) del lado ComponenteSELF.
        const idsEscala = [filaCuadrilla.MaterialVariableValorId, filaCuadrillaSelf?.MaterialVariableValorId].filter(Boolean);
        const requestEscalas = pool.request();
        const paramsEscala = idsEscala.map((id, i) => {
            const nombre = `esc${i}`;
            requestEscalas.input(nombre, sql.UniqueIdentifier, id);
            return `@${nombre}`;
        });
        const escalasResultado = await requestEscalas.query(`
            SELECT MaterialVariableValorId, Orden, Valor
            FROM [dbo].[MaterialVariableValorEscala]
            WHERE MaterialVariableValorId IN (${paramsEscala.join(", ")}) AND IsSoftDeleted = 0
        `);

        const NOMBRES_ORDEN = { 1: "Muestreo", 2: "Parcial", 3: "Completa" };
        const escalasComponente = escalasResultado.recordset.filter((e) => e.MaterialVariableValorId === filaCuadrilla.MaterialVariableValorId);
        const escalasSelf = escalasResultado.recordset.filter((e) => e.MaterialVariableValorId === filaCuadrillaSelf?.MaterialVariableValorId);
        const escalas = escalasComponente.map((e) => ({
            Orden: e.Orden,
            Nombre: NOMBRES_ORDEN[e.Orden] || `Escala ${e.Orden}`,
            Valor: e.Valor,
            Costo: escalasSelf.find((s) => s.Orden === e.Orden)?.Valor ?? null
        })).sort((a, b) => a.Orden - b.Orden);

        // Mismos códigos de moneda usados en el resto del sistema (ej. las respuestas de
        // Azure ya traen Moneda: { Value: 340, DisplayName: 'HNL' }).
        const MONEDAS = { 340: "HNL", 840: "USD" };
        const monedaValue = filaCuadrilla.Currency_Value;

        return res.json({
            ComponenteId: fila.ComponenteId,
            ComponenteDescripcion: fila.ComponenteDescripcion,
            SegmentoId: fila.SegmentoId,
            MaterialVariableSegmentoId: filaCuadrilla.MaterialVariableSegmentoId,
            MonedaValue: monedaValue,
            Moneda: MONEDAS[monedaValue] || (monedaValue != null ? String(monedaValue) : "—"),
            Escalas: escalas
        });

    } catch (error) {
        console.error("Error en cuadrillaPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener datos de Cuadrilla", Error: error.message });
    }
});

// CreatedBy y ProveedorId por Aduana para el módulo Cuadrilla — dato fijo proporcionado
// directamente (no hay tabla en BD que los relacione de forma confiable, ver AduanaDescripcion
// que trae texto inconsistente). El usuario elige la Aduana manualmente para evitar mandar el
// ProveedorId/CreatedBy equivocado si el texto de la Referencia no calza limpio con ninguna.
const ADUANAS_CUADRILLA = {
    elPoy: { label: "El Poy", createdBy: "93DDFC85-4BC6-4B77-874B-15D8383F50C8", proveedorId: "48367417-0D98-40D5-82B6-22E0EBE314B9" },
    corinto: { label: "Corinto", createdBy: "1E3C0993-CAEB-46A4-BFB7-1D9CDD0A2F59", proveedorId: "66304F92-C28A-46FB-9E6F-219104CDFB07" },
    lasManos: { label: "Las Manos", createdBy: "74BEDB3B-9561-4983-A4F4-13E0C26AF28D", proveedorId: "80C8DBBC-6767-46AA-9EB0-14D398EA0B69" },
    laMesa: { label: "La Mesa", createdBy: "AEE24082-F052-4851-AD73-0F62B3102E0C", proveedorId: "94ABFBAB-40D1-4C63-9DD0-26DC994CC574" },
    elFlorido: { label: "El Florido", createdBy: "7656E091-4C67-4155-B192-15C8138215F0", proveedorId: "A7DE0768-3AEC-4B97-A8F8-14D56F506575" },
    guasaule: { label: "Guasaule", createdBy: "F5D934A6-55BD-47E7-9041-13E0C29C2137", proveedorId: "D2887BF9-4FCD-49F7-991F-170CFCE2B884" },
    amatillo: { label: "Amatillo", createdBy: "B2EA3ED7-2130-4D88-92CA-13E0C1DC292E", proveedorId: "E7EE603E-BC46-4017-8A3D-16CC73903C7A" },
};

app.get('/aduanasCuadrilla', requirePermission('cfo', 'cuadrilla'), (req, res) => {
    res.json(Object.entries(ADUANAS_CUADRILLA).map(([key, a]) => ({ key, label: a.label })));
});

// Mismos códigos de Moneda usados en el resto del sistema, con etiqueta completa para
// mostrar en pantalla (a diferencia del MONEDAS corto de /cuadrillaPorReferencia).
const MONEDAS_CUADRILLA_DISPLAY = { 340: "Lempiras (HNL)", 840: "Dólares (USD)" };
function monedaCuadrillaLabel(value) {
    return MONEDAS_CUADRILLA_DISPLAY[value] || (value != null ? String(value) : "—");
}

// Documento(s) Provisional(es) de Cuadrilla ya creados para una Referencia Operativa.
// "1006" es el Código ERP (CodigoErpReembolso) del material "Cuadrilla" — confirmado contra
// datos reales (Honduras y Corporación Dinant usan el mismo código para este material) — se
// usa para no mezclar el Documento Provisional de Cuadrilla con otros Documentos no
// relacionados que pueda tener la misma referencia.
app.post('/documentosProvisionalesCuadrilla', requirePermission('cfo', 'cuadrilla'), async (req, res) => {
    try {
        const { referencia } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .query(`
                SELECT
                    d.Id,
                    pr.Nombre AS Proveedor,
                    c.Nombre AS Cliente,
                    d.Discriminator AS Tipo_Documento,
                    d.ReferenciaOperativa AS Referencia_Operativa,
                    d.TotalMonto AS Monto_Documento,
                    dd.PrecioVenta,
                    d.Moneda_Value,
                    MP.Descripcion AS MaterialProveedor,
                    MT.CodigoErpReembolso,
                    d.CreatedDate
                FROM Documento d
                LEFT JOIN Cliente c ON d.ClienteId = c.Id
                LEFT JOIN Proveedor pr ON d.ProveedorId = pr.Id
                LEFT JOIN dbo.DocumentoDetalle dd ON dd.DocumentoId = d.Id
                LEFT JOIN dbo.MaterialProveedor MP ON MP.Id = dd.MaterialProveedorId
                LEFT JOIN MaterialTenant MT ON MP.MaterialTenantId = MT.Id
                WHERE d.ReferenciaOperativa = @referencia
                  AND d.IsSoftDeleted = 0
                  AND MT.CodigoErpReembolso = '1006'
                ORDER BY d.CreatedDate DESC
            `);

        return res.json(resultado.recordset.map((f) => ({ ...f, MonedaLabel: monedaCuadrillaLabel(f.Moneda_Value) })));

    } catch (error) {
        console.error("Error en documentosProvisionalesCuadrilla:", error);
        return res.status(500).json({ Message: "Error al obtener Documentos Provisionales de Cuadrilla", Error: error.message });
    }
});

// Línea(s) de Material de Cuadrilla ya creadas para una Referencia Operativa. Se filtra por el
// mismo MaterialVariableSegmentoId que ya resuelve /cuadrillaPorReferencia (el material
// "Cuadrilla" de esa negociación) para no mezclarlo con otras Líneas de Material no
// relacionadas que pueda tener el mismo SalesOrder.
app.post('/lineasMaterialCuadrilla', requirePermission('cfo', 'cuadrilla'), async (req, res) => {
    try {
        const { referencia, materialVariableSegmentoId } = req.body;
        if (!referencia) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }
        if (!materialVariableSegmentoId) {
            return res.status(400).json({ Message: "Falta el MaterialVariableSegmentoId (vuelva a buscar la Referencia Operativa)." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('referencia', sql.VarChar, referencia)
            .input('segmentoId', sql.UniqueIdentifier, materialVariableSegmentoId)
            .query(`
                SELECT
                    S.ReferenciaOperativa,
                    LV.Id AS LineaMaterialId,
                    LV.Descripcion AS MaterialDescripcion,
                    LV.MaterialErp,
                    LV.Valor,
                    LV.Costo,
                    LV.Currency_Value,
                    LV.CreatedDate
                FROM [dbo].[SalesOrder] S
                LEFT JOIN SalesOrderDetalle SD ON SD.SalesOrderId = S.Id
                LEFT JOIN LineaMaterialVariable LV ON LV.SalesOrderDetalleId = SD.Id
                LEFT JOIN MaterialVariableValor MVV ON MVV.Id = LV.MaterialVariableValorId
                WHERE S.ReferenciaOperativa = @referencia
                  AND S.IsSoftDeleted = 0
                  AND LV.IsSoftDeleted = 0
                  AND MVV.MaterialVariableSegmentoId = @segmentoId
                ORDER BY LV.CreatedDate DESC
            `);

        return res.json(resultado.recordset.map((f) => ({ ...f, MonedaLabel: monedaCuadrillaLabel(f.Currency_Value) })));

    } catch (error) {
        console.error("Error en lineasMaterialCuadrilla:", error);
        return res.status(500).json({ Message: "Error al obtener Líneas de Material de Cuadrilla", Error: error.message });
    }
});

app.post('/crearCuadrilla', requirePermission('cfo', 'cuadrilla'), async (req, res) => {
    try {
        const { ReferenciaOperativa, AduanaKey, SegmentoId, MaterialVariableSegmentoId, Parametro } = req.body;

        if (!ReferenciaOperativa) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }
        const aduana = ADUANAS_CUADRILLA[AduanaKey];
        if (!aduana) {
            return res.status(400).json({ Message: "Debe seleccionar una Aduana válida." });
        }
        if (!SegmentoId || !MaterialVariableSegmentoId) {
            return res.status(400).json({ Message: "Faltan datos de Cuadrilla resueltos para esta referencia. Vuelva a buscarla." });
        }
        if (![1, 2, 3].includes(Number(Parametro))) {
            return res.status(400).json({ Message: "Debe seleccionar el tipo de escala (Muestreo, Parcial o Completa)." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/SalesOrder/AddLineaMaterialNewApp", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ReferenciaOperativa,
                Tipo: "1",
                CreatedBy: aduana.createdBy,
                Segmentos: [{
                    Id: SegmentoId,
                    MaterialVariableSegmentos: [{ Id: MaterialVariableSegmentoId, Parametro: Number(Parametro) }],
                    ProveedorId: aduana.proveedorId,
                    TenantId: "30d1014c-d443-42ee-8015-005fb0d9fa00"
                }]
            })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`SalesOrder/AddLineaMaterialNewApp → HTTP ${resp.status} para ${ReferenciaOperativa}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`SalesOrder/AddLineaMaterialNewApp → ${ReferenciaOperativa}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "cuadrilla",
            moduloLabel: "Cuadrilla",
            accion: `Creó Cuadrilla (${{ 1: "Muestreo", 2: "Parcial", 3: "Completa" }[Number(Parametro)]}, Aduana ${aduana.label})`,
            referencia: ReferenciaOperativa
        });

        return res.status(200).json({ Message: "Documento Provisional + Línea Material creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearCuadrilla:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Discriminator real en Persona según el tipo que se está creando/buscando.
const DISCRIMINATOR_POR_TIPO = {
    proveedor: "PersonaJuridicaProveedor",
    cliente: "PersonaJuridicaCliente",
};

// Catálogo fijo de Países para Crear Proveedor/Cliente. TipoIdFiscalId no corresponde 1:1 con
// el país (así lo confirmó el negocio): Honduras usa un Id, y El Salvador/Guatemala/Nicaragua/
// Costa Rica comparten otro — son valores fijos del sistema externo, no un error de transcripción.
const PAISES_PROVEEDOR_CLIENTE = {
    honduras: { id: "65507ECF-249E-454B-A95A-0061BA0FA2BA", descripcion: "HONDURAS", tipoIdFiscalId: "30D1014C-D443-42EE-8015-005FB0D9FA00", sociedad: "9095" },
    elSalvador: { id: "174E784C-CEDA-4758-A7F5-0063C3454B73", descripcion: "EL SALVADOR", tipoIdFiscalId: "174E784C-CEDA-4758-A7F5-0063C3454B73", sociedad: "SV01" },
    guatemala: { id: "30D1014C-D443-42EE-8015-005FB0D9FA00", descripcion: "GUATEMALA", tipoIdFiscalId: "174E784C-CEDA-4758-A7F5-0063C3454B73", sociedad: "GT01" },
    nicaragua: { id: "C7194841-BB94-4903-ADD7-0065CC7AF42C", descripcion: "NICARAGUA", tipoIdFiscalId: "174E784C-CEDA-4758-A7F5-0063C3454B73", sociedad: "NI01" },
    costaRica: { id: "27E0710C-A5BC-4C77-AFC7-137AF86DE6AA", descripcion: "COSTA RICA", tipoIdFiscalId: "174E784C-CEDA-4758-A7F5-0063C3454B73", sociedad: "CR01" },
};

// Campos fijos que exige CodigoErpProveedorServiceApi/Create y no varían nunca entre códigos.
const CODIGO_ERP_DEFAULTS = {
    SistemaId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    SistemaDescripcion: "SAP",
    TipoPersonaDestino: "4",
};

// Campos fijos para CodigoErpClienteServiceApi/Create. A diferencia de Proveedor, aquí "Pais"
// va como el Id (GUID) del País y no como su descripción (confirmado con el JSON de ejemplo:
// Pais coincide con PAISES_PROVEEDOR_CLIENTE.guatemala.id, no con "GUATEMALA").
const CODIGO_ERP_CLIENTE_DEFAULTS = {
    SistemaId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    SistemaDescripcion: "SAP",
    GestionDocumento: true,
    TipoPersonaDestino: "3",
};

// Únicos dos Tipos de Sitio habilitados para crear un Sitio de Cliente (confirmado por el
// negocio; si se agrega un tercero más adelante, avisan para actualizar este catálogo).
const TIPOS_SITIO_CLIENTE = {
    sitioFel: { id: "24482BCB-665F-47F1-93DF-2442D490D809", descripcion: "Sitio Cliente FEL" },
    casaMatriz: { id: "45A91678-6B1B-465A-811B-24350D2F6028", descripcion: "Dirección de Casa Matriz" },
};

// El Tipo de Sitio de un Sitio de Cliente no lo elige el usuario: depende del País del Sitio
// (confirmado por el negocio). Nicaragua y Costa Rica todavía no tienen regla definida — si se
// intenta crear un Sitio en esos Países, se bloquea hasta que confirmen cuál aplica.
const TIPO_SITIO_POR_PAIS = {
    honduras: TIPOS_SITIO_CLIENTE.casaMatriz,
    elSalvador: TIPOS_SITIO_CLIENTE.casaMatriz,
    guatemala: TIPOS_SITIO_CLIENTE.sitioFel,
};

// Resto de campos fijos que exige PersonaProveedorServiceApi/Create pero que no varían nunca
// entre proveedores (no se le piden al usuario).
const PROVEEDOR_DEFAULTS = {
    TipoIdFiscalDescripcion: "NIT",
    GrupoPersonaId: "51B0C7C0-3928-4BD6-BCF4-0F7AD764AD0F",
    GrupoPersonaNombre: "Grupo Varios",
    Url: "",
    LimiteDeCredito: 0,
    TiempoDeCredito: 0,
    SegmentoId: "F47793A7-BCEC-4DFC-91AA-0F7AD952C6C1",
    SegmentoNombre: "Varios",
};

// Referencia corta autogenerada a partir del Nombre: la primera letra de cada una de las
// primeras 3 palabras (ej. "ALMACEN FISCAL SANDAL S.A" → "AFS"); si el nombre es una sola
// palabra, se toman sus primeras 3 letras.
function generarReferencia(nombre) {
    const palabras = String(nombre || "").trim().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return "";
    if (palabras.length === 1) return palabras[0].slice(0, 3).toUpperCase();
    return palabras.slice(0, 3).map((p) => p[0]).join("").toUpperCase();
}

// Campos fijos que exige PersonaClienteServiceApi/Create pero que no varían nunca entre
// clientes (no se le piden al usuario). GrupoPersona/Segmento son distintos a los de Proveedor.
const CLIENTE_DEFAULTS = {
    TipoIdFiscalDescripcion: "NIT",
    GrupoPersonaId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    GrupoPersonaNombre: "Grupo Vesta",
    SegmentoId: "5727BD7B-6A2E-4799-9D3A-12296ACEB804",
    SegmentoNombre: "Logística",
};

// Carácter autogenerado para el Cliente: 2 caracteres alfanuméricos, únicos en toda la tabla
// Persona (el servicio externo rechaza la creación si ya está en uso por cualquier Persona,
// no solo por otro Cliente). Se intenta primero con letras derivadas del Nombre para que el
// código sea reconocible, y si ya están ocupadas se recorre el resto del alfabeto/dígitos.
async function generarCaracterUnico(nombre, poolPersonas) {
    const usados = await poolPersonas.request().query(`
        SELECT DISTINCT Caracter FROM [dbo].[Persona] WHERE Caracter IS NOT NULL AND Caracter <> ''
    `);
    const ocupados = new Set(usados.recordset.map((r) => String(r.Caracter).toUpperCase()));

    const ALFANUMERICO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const limpio = String(nombre || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    const candidatos = [];
    if (limpio.length >= 2) candidatos.push(limpio.slice(0, 2));
    if (limpio.length >= 1) {
        for (const c of ALFANUMERICO) candidatos.push(limpio[0] + c);
    }
    for (const a of ALFANUMERICO) {
        for (const b of ALFANUMERICO) {
            candidatos.push(a + b);
        }
    }

    for (const candidato of candidatos) {
        if (!ocupados.has(candidato)) return candidato;
    }
    throw new Error("No fue posible generar un Carácter único: todas las combinaciones están en uso.");
}

app.post('/personaExistente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { tipo, nombre, idFiscal } = req.body;
        const discriminator = DISCRIMINATOR_POR_TIPO[tipo];
        if (!discriminator) {
            return res.status(400).json({ Message: "Tipo inválido: debe ser 'proveedor' o 'cliente'." });
        }
        const nombreTrim = (nombre || "").trim();
        const idFiscalTrim = (idFiscal || "").trim();
        if (!nombreTrim && !idFiscalTrim) {
            return res.status(400).json({ Message: "Ingrese un Nombre o un ID Fiscal para validar." });
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const request = pool.request();
        request.input('discriminator', sql.VarChar, discriminator);
        const condiciones = [];
        if (nombreTrim) {
            request.input('nombre', sql.VarChar, `%${nombreTrim}%`);
            condiciones.push('Nombre LIKE @nombre');
        }
        if (idFiscalTrim) {
            request.input('idFiscal', sql.VarChar, idFiscalTrim);
            condiciones.push('IdFiscal = @idFiscal');
        }

        const resultado = await request.query(`
            SELECT TOP 10 Id, Nombre, IdFiscal, Discriminator
            FROM [dbo].[Persona]
            WHERE Discriminator = @discriminator
              AND IsSoftDeleted = 0
              AND (${condiciones.join(" OR ")})
            ORDER BY Nombre
        `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en personaExistente:", error);
        return res.status(500).json({ Message: "Error al validar en Personas", Error: error.message });
    }
});

app.post('/crearProveedor', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Nombre, IdFiscal, PaisKey, PresentoComprobantePagos } = req.body;

        const nombreTrim = (Nombre || "").trim();
        const idFiscalTrim = (IdFiscal || "").trim();
        const pais = PAISES_PROVEEDOR_CLIENTE[PaisKey];

        if (!nombreTrim) {
            return res.status(400).json({ Message: "El Nombre es requerido." });
        }
        if (!idFiscalTrim) {
            return res.status(400).json({ Message: "El ID Fiscal es requerido." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País válido." });
        }
        if (typeof PresentoComprobantePagos !== "boolean") {
            return res.status(400).json({ Message: "Debe indicar si presentó comprobante de pagos." });
        }

        // Revalida en Personas justo antes de crear (no confiar únicamente en la validación
        // que ya hizo el usuario en pantalla, por si cambió el Nombre/ID Fiscal después).
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const validacion = await poolPersonas.request()
            .input('discriminator', sql.VarChar, DISCRIMINATOR_POR_TIPO.proveedor)
            .input('idFiscal', sql.VarChar, idFiscalTrim)
            .query(`
                SELECT TOP 1 Id FROM [dbo].[Persona]
                WHERE Discriminator = @discriminator AND IsSoftDeleted = 0 AND IdFiscal = @idFiscal
            `);
        if (validacion.recordset.length > 0) {
            return res.status(400).json({ Message: "Ya existe un Proveedor con ese ID Fiscal." });
        }

        const body = {
            Nombre: nombreTrim,
            IdFiscal: idFiscalTrim,
            TipoIdFiscalId: pais.tipoIdFiscalId,
            TipoIdFiscalDescripcion: PROVEEDOR_DEFAULTS.TipoIdFiscalDescripcion,
            GrupoPersonaId: PROVEEDOR_DEFAULTS.GrupoPersonaId,
            GrupoPersonaNombre: PROVEEDOR_DEFAULTS.GrupoPersonaNombre,
            Url: PROVEEDOR_DEFAULTS.Url,
            RazonSocial: nombreTrim,
            PaisId: pais.id,
            PaisDescripcion: pais.descripcion,
            LimiteDeCredito: PROVEEDOR_DEFAULTS.LimiteDeCredito,
            TiempoDeCredito: PROVEEDOR_DEFAULTS.TiempoDeCredito,
            SegmentoId: PROVEEDOR_DEFAULTS.SegmentoId,
            SegmentoNombre: PROVEEDOR_DEFAULTS.SegmentoNombre,
            PresentoComprobantePagos,
            Referencia: generarReferencia(nombreTrim),
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/PersonaProveedorServiceApi/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`PersonaProveedorServiceApi/Create → HTTP ${resp.status} para ${nombreTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`PersonaProveedorServiceApi/Create → ${nombreTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Proveedor "${nombreTrim}" (${pais.descripcion})`,
            referencia: idFiscalTrim
        });

        // La respuesta de Azure no garantiza un campo de Id estable; se vuelve a consultar por
        // IdFiscal (recién validado como único) para obtener el Id real y poder usarlo después
        // en la creación del Código ERP.
        const personaCreada = await poolPersonas.request()
            .input('discriminatorNuevo', sql.VarChar, DISCRIMINATOR_POR_TIPO.proveedor)
            .input('idFiscalNuevo', sql.VarChar, idFiscalTrim)
            .query(`
                SELECT TOP 1 Id FROM [dbo].[Persona]
                WHERE Discriminator = @discriminatorNuevo AND IsSoftDeleted = 0 AND IdFiscal = @idFiscalNuevo
            `);
        const personaId = personaCreada.recordset[0]?.Id || null;

        return res.status(200).json({ Message: "Proveedor creado con éxito", Data: data, Referencia: body.Referencia, PersonaId: personaId });

    } catch (error) {
        console.error("Error en crearProveedor:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/crearCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Nombre, IdFiscal, PaisKey } = req.body;

        const nombreTrim = (Nombre || "").trim();
        const idFiscalTrim = (IdFiscal || "").trim();
        const pais = PAISES_PROVEEDOR_CLIENTE[PaisKey];

        if (!nombreTrim) {
            return res.status(400).json({ Message: "El Nombre es requerido." });
        }
        if (!idFiscalTrim) {
            return res.status(400).json({ Message: "El ID Fiscal es requerido." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País válido." });
        }

        // Revalida en Personas justo antes de crear (no confiar únicamente en la validación
        // que ya hizo el usuario en pantalla, por si cambió el Nombre/ID Fiscal después).
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const validacion = await poolPersonas.request()
            .input('discriminator', sql.VarChar, DISCRIMINATOR_POR_TIPO.cliente)
            .input('idFiscal', sql.VarChar, idFiscalTrim)
            .query(`
                SELECT TOP 1 Id FROM [dbo].[Persona]
                WHERE Discriminator = @discriminator AND IsSoftDeleted = 0 AND IdFiscal = @idFiscal
            `);
        if (validacion.recordset.length > 0) {
            return res.status(400).json({ Message: "Ya existe un Cliente con ese ID Fiscal." });
        }

        const caracter = await generarCaracterUnico(nombreTrim, poolPersonas);

        const body = {
            Nombre: nombreTrim,
            IdFiscal: idFiscalTrim,
            TipoIdFiscalId: pais.tipoIdFiscalId,
            TipoIdFiscalDescripcion: CLIENTE_DEFAULTS.TipoIdFiscalDescripcion,
            GrupoPersonaId: CLIENTE_DEFAULTS.GrupoPersonaId,
            GrupoPersonaNombre: CLIENTE_DEFAULTS.GrupoPersonaNombre,
            PaisId: pais.id,
            PaisDescripcion: pais.descripcion,
            SegmentoId: CLIENTE_DEFAULTS.SegmentoId,
            SegmentoNombre: CLIENTE_DEFAULTS.SegmentoNombre,
            Caracter: caracter,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/PersonaClienteServiceApi/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`PersonaClienteServiceApi/Create → HTTP ${resp.status} para ${nombreTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`PersonaClienteServiceApi/Create → ${nombreTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Cliente "${nombreTrim}" (${pais.descripcion})`,
            referencia: idFiscalTrim
        });

        // La respuesta de Azure no garantiza un campo de Id estable; se vuelve a consultar por
        // IdFiscal (recién validado como único) para obtener el Id real y poder usarlo después.
        const personaCreada = await poolPersonas.request()
            .input('discriminatorNuevo', sql.VarChar, DISCRIMINATOR_POR_TIPO.cliente)
            .input('idFiscalNuevo', sql.VarChar, idFiscalTrim)
            .query(`
                SELECT TOP 1 Id FROM [dbo].[Persona]
                WHERE Discriminator = @discriminatorNuevo AND IsSoftDeleted = 0 AND IdFiscal = @idFiscalNuevo
            `);
        const personaId = personaCreada.recordset[0]?.Id || null;

        return res.status(200).json({ Message: "Cliente creado con éxito", Data: data, Caracter: caracter, PersonaId: personaId });

    } catch (error) {
        console.error("Error en crearCliente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Códigos ERP activos ya registrados para un proveedor puntual. Un mismo proveedor puede tener
// varios (uno por Sociedad/País en el que opera); lo que no puede repetirse es el mismo Código
// en dos proveedores distintos (ver /crearCodigoErpProveedor).
app.post('/codigosErpProveedor', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaJuridicaProveedorId } = req.body;
        if (!PersonaJuridicaProveedorId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaJuridicaProveedorId)
            .query(`
                SELECT [Id], [Codigo], [Sociedad], [Pais]
                FROM [dbo].[CodigoErp]
                WHERE [PersonaJuridicaProveedorId] = @personaId
                  AND [IsSoftDeleted] = 0
                ORDER BY [Codigo]
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en codigosErpProveedor:", error);
        return res.status(500).json({ Message: "Error al validar Código ERP", Error: error.message });
    }
});

app.post('/crearCodigoErpProveedor', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaJuridicaProveedorId, Codigo } = req.body;

        const codigoTrim = (Codigo || "").trim();

        if (!PersonaJuridicaProveedorId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }
        if (!codigoTrim) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }

        // El País/Sociedad no lo elige el usuario en este paso: se toma del País con el que
        // ya quedó registrado el proveedor en Personas (Persona.PaisId), no de una selección nueva.
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const personaInfo = await poolPersonas.request()
            .input('personaId', sql.UniqueIdentifier, PersonaJuridicaProveedorId)
            .query(`SELECT [PaisId] FROM [dbo].[Persona] WHERE [Id] = @personaId`);

        if (personaInfo.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el proveedor." });
        }

        const paisIdPersona = personaInfo.recordset[0].PaisId;
        const pais = Object.values(PAISES_PROVEEDOR_CLIENTE).find(
            (p) => String(p.id).toUpperCase() === String(paisIdPersona).toUpperCase()
        );
        if (!pais) {
            return res.status(400).json({ Message: "No se pudo determinar el País/Sociedad de este proveedor." });
        }

        // El mismo Código no puede pertenecer a dos proveedores distintos (un proveedor sí
        // puede tener varios Códigos ERP distintos, uno por País/Sociedad).
        const validacion = await poolPersonas.request()
            .input('codigo', sql.VarChar, codigoTrim)
            .query(`
                SELECT TOP 1 [Id], [PersonaJuridicaProveedorId]
                FROM [dbo].[CodigoErp]
                WHERE [Codigo] = @codigo AND [IsSoftDeleted] = 0
            `);

        if (validacion.recordset.length > 0) {
            const existente = validacion.recordset[0];
            const mismoProveedor = String(existente.PersonaJuridicaProveedorId).toUpperCase() === String(PersonaJuridicaProveedorId).toUpperCase();
            return res.status(400).json({
                Message: mismoProveedor
                    ? "Este Código ERP ya está registrado para este proveedor."
                    : "Este Código ERP ya pertenece a otro proveedor."
            });
        }

        const body = {
            Codigo: codigoTrim,
            Sociedad: pais.sociedad,
            Pais: pais.descripcion,
            PersonaJuridicaProveedorId,
            SistemaId: CODIGO_ERP_DEFAULTS.SistemaId,
            SistemaDescripcion: CODIGO_ERP_DEFAULTS.SistemaDescripcion,
            TipoPersonaDestino: CODIGO_ERP_DEFAULTS.TipoPersonaDestino,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErpProveedorServiceApi/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErpProveedorServiceApi/Create → HTTP ${resp.status} para ${codigoTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErpProveedorServiceApi/Create → ${codigoTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Código ERP "${codigoTrim}" (${pais.descripcion})`,
            referencia: codigoTrim
        });

        return res.status(200).json({
            Message: "Código ERP creado con éxito",
            Data: data,
            Codigo: codigoTrim,
            Sociedad: pais.sociedad,
            Pais: pais.descripcion
        });

    } catch (error) {
        console.error("Error en crearCodigoErpProveedor:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/modificarCodigoErpProveedor', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, Codigo, ModifiedBy } = req.body;
        const codigoTrim = (Codigo || "").trim();

        if (!Id) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!codigoTrim) {
            return res.status(400).json({ Message: "El nuevo Código ERP es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // El mismo Código no puede pertenecer a otro proveedor (excluyendo el propio registro
        // que se está editando, si el usuario no cambió el valor).
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const validacion = await poolPersonas.request()
            .input('codigo', sql.VarChar, codigoTrim)
            .input('id', sql.UniqueIdentifier, Id)
            .query(`
                SELECT TOP 1 [Id]
                FROM [dbo].[CodigoErp]
                WHERE [Codigo] = @codigo AND [IsSoftDeleted] = 0 AND [Id] <> @id
            `);
        if (validacion.recordset.length > 0) {
            return res.status(400).json({ Message: "Este Código ERP ya pertenece a otro proveedor." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErp/ModificarCodigo", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ModifiedBy, Id, Codigo: codigoTrim })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErp/ModificarCodigo → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErp/ModificarCodigo → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Modificó el Código ERP a "${codigoTrim}"`,
            referencia: codigoTrim
        });

        return res.status(200).json({ Message: "Código ERP modificado con éxito", Data: data });

    } catch (error) {
        console.error("Error en modificarCodigoErpProveedor:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/eliminarCodigoErpProveedor', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, ModifiedBy } = req.body;

        if (!Id) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErp/Delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ModifiedBy, Id })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErp/Delete → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErp/Delete → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Eliminó un Código ERP",
            referencia: Id
        });

        return res.status(200).json({ Message: "Código ERP eliminado con éxito", Data: data });

    } catch (error) {
        console.error("Error en eliminarCodigoErpProveedor:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Códigos ERP activos ya registrados para un cliente puntual. Igual que en Proveedor, un mismo
// cliente puede tener varios (uno por Sociedad/País), pero un Código no puede repetirse entre
// dos clientes/proveedores distintos (ver /crearCodigoErpCliente).
app.post('/codigosErpCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaJuridicaClienteId } = req.body;
        if (!PersonaJuridicaClienteId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaJuridicaClienteId)
            .query(`
                SELECT [Id], [Codigo], [Sociedad], [Pais]
                FROM [dbo].[CodigoErp]
                WHERE [PersonaJuridicaClienteId] = @personaId
                  AND [IsSoftDeleted] = 0
                ORDER BY [Codigo]
            `);

        // A diferencia de Proveedor, en Cliente la columna [Pais] guarda el Id (GUID) y no la
        // descripción; se resuelve aquí a texto legible para que la lista se vea igual de clara.
        const filas = resultado.recordset.map((fila) => {
            const pais = Object.values(PAISES_PROVEEDOR_CLIENTE).find(
                (p) => String(p.id).toUpperCase() === String(fila.Pais).toUpperCase()
            );
            return { ...fila, Pais: pais?.descripcion || fila.Pais };
        });

        return res.json(filas);

    } catch (error) {
        console.error("Error en codigosErpCliente:", error);
        return res.status(500).json({ Message: "Error al validar Código ERP", Error: error.message });
    }
});

app.post('/crearCodigoErpCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaJuridicaClienteId, Codigo } = req.body;

        const codigoTrim = (Codigo || "").trim();

        if (!PersonaJuridicaClienteId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }
        if (!codigoTrim) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }

        // El País/Sociedad no lo elige el usuario en este paso: se toma del País con el que
        // ya quedó registrado el cliente en Personas (Persona.PaisId), no de una selección nueva.
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const personaInfo = await poolPersonas.request()
            .input('personaId', sql.UniqueIdentifier, PersonaJuridicaClienteId)
            .query(`SELECT [PaisId] FROM [dbo].[Persona] WHERE [Id] = @personaId`);

        if (personaInfo.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el cliente." });
        }

        const paisIdPersona = personaInfo.recordset[0].PaisId;
        const pais = Object.values(PAISES_PROVEEDOR_CLIENTE).find(
            (p) => String(p.id).toUpperCase() === String(paisIdPersona).toUpperCase()
        );
        if (!pais) {
            return res.status(400).json({ Message: "No se pudo determinar el País/Sociedad de este cliente." });
        }

        // El mismo Código no puede pertenecer a otro proveedor/cliente distinto (CodigoErp es una
        // tabla compartida entre ambos tipos).
        const validacion = await poolPersonas.request()
            .input('codigo', sql.VarChar, codigoTrim)
            .query(`
                SELECT TOP 1 [Id], [PersonaJuridicaClienteId]
                FROM [dbo].[CodigoErp]
                WHERE [Codigo] = @codigo AND [IsSoftDeleted] = 0
            `);

        if (validacion.recordset.length > 0) {
            const existente = validacion.recordset[0];
            const mismoCliente = existente.PersonaJuridicaClienteId &&
                String(existente.PersonaJuridicaClienteId).toUpperCase() === String(PersonaJuridicaClienteId).toUpperCase();
            return res.status(400).json({
                Message: mismoCliente
                    ? "Este Código ERP ya está registrado para este cliente."
                    : "Este Código ERP ya pertenece a otro cliente o proveedor."
            });
        }

        const body = {
            Codigo: codigoTrim,
            Sociedad: pais.sociedad,
            Pais: pais.id,
            PersonaJuridicaClienteId,
            SistemaId: CODIGO_ERP_CLIENTE_DEFAULTS.SistemaId,
            SistemaDescripcion: CODIGO_ERP_CLIENTE_DEFAULTS.SistemaDescripcion,
            GestionDocumento: CODIGO_ERP_CLIENTE_DEFAULTS.GestionDocumento,
            TipoPersonaDestino: CODIGO_ERP_CLIENTE_DEFAULTS.TipoPersonaDestino,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErpClienteServiceApi/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErpClienteServiceApi/Create → HTTP ${resp.status} para ${codigoTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErpClienteServiceApi/Create → ${codigoTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Código ERP "${codigoTrim}" (${pais.descripcion})`,
            referencia: codigoTrim
        });

        return res.status(200).json({
            Message: "Código ERP creado con éxito",
            Data: data,
            Codigo: codigoTrim,
            Sociedad: pais.sociedad,
            Pais: pais.descripcion
        });

    } catch (error) {
        console.error("Error en crearCodigoErpCliente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/modificarCodigoErpCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, Codigo, ModifiedBy } = req.body;
        const codigoTrim = (Codigo || "").trim();

        if (!Id) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!codigoTrim) {
            return res.status(400).json({ Message: "El nuevo Código ERP es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        // El mismo Código no puede pertenecer a otro cliente/proveedor (excluyendo el propio
        // registro que se está editando, si el usuario no cambió el valor).
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const validacion = await poolPersonas.request()
            .input('codigo', sql.VarChar, codigoTrim)
            .input('id', sql.UniqueIdentifier, Id)
            .query(`
                SELECT TOP 1 [Id]
                FROM [dbo].[CodigoErp]
                WHERE [Codigo] = @codigo AND [IsSoftDeleted] = 0 AND [Id] <> @id
            `);
        if (validacion.recordset.length > 0) {
            return res.status(400).json({ Message: "Este Código ERP ya pertenece a otro cliente o proveedor." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErp/ModificarCodigo", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ModifiedBy, Id, Codigo: codigoTrim })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErp/ModificarCodigo → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErp/ModificarCodigo → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Modificó el Código ERP a "${codigoTrim}"`,
            referencia: codigoTrim
        });

        return res.status(200).json({ Message: "Código ERP modificado con éxito", Data: data });

    } catch (error) {
        console.error("Error en modificarCodigoErpCliente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/eliminarCodigoErpCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, ModifiedBy } = req.body;

        if (!Id) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErp/Delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ModifiedBy, Id })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErp/Delete → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErp/Delete → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Eliminó un Código ERP de Cliente",
            referencia: Id
        });

        return res.status(200).json({ Message: "Código ERP eliminado con éxito", Data: data });

    } catch (error) {
        console.error("Error en eliminarCodigoErpCliente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Catálogo de Ciudades: vive en un tercer servicio externo (seguimientoapi.vesta-accelerate.com,
// distinto de personasapi/cfows), sin filtro por País en el propio endpoint — trae las ~1000
// ciudades de todos los países y se filtra aquí por el País seleccionado para el Sitio.
app.post('/ciudadesPorPais', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PaisKey } = req.body;
        const pais = PAISES_PROVEEDOR_CLIENTE[PaisKey];
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País válido." });
        }

        const resp = await fetch("https://seguimientoapi.vesta-accelerate.com/api/Ciudad/Index");

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Ciudad/Index → HTTP ${resp.status}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        const todas = Array.isArray(data?.Message) ? data.Message : [];
        const filtradas = todas
            .filter((c) => String(c.PaisId).toUpperCase() === String(pais.id).toUpperCase())
            .map((c) => ({ Id: c.Id, Descripcion: c.Descripcion }))
            .sort((a, b) => a.Descripcion.localeCompare(b.Descripcion));

        return res.json(filtradas);

    } catch (error) {
        console.error("Error en ciudadesPorPais:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Sitios ya registrados para un cliente puntual (Sitio.Discriminator = 'SitioCliente'), para
// mostrar la lista y ofrecer "agregar otro" igual que en los demás pasos.
app.post('/sitiosCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaClienteId } = req.body;
        if (!PersonaClienteId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaClienteId)
            .query(`
                SELECT [Id], [Direccion], [PaisDescripcion], [CiudadDescripcion], [TipoDeSitioDescripcion], [Codigo]
                FROM [dbo].[Sitio]
                WHERE [PersonaJuridicaClienteId] = @personaId
                  AND [Discriminator] = 'SitioCliente'
                  AND [IsSoftDeleted] = 0
                ORDER BY [CreatedDate] DESC
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en sitiosCliente:", error);
        return res.status(500).json({ Message: "Error al validar Sitios del cliente", Error: error.message });
    }
});

app.post('/crearSitioCliente', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaClienteId, Direccion, PaisKey, CiudadId, CiudadDescripcion, CoordenadaX, CoordenadaY } = req.body;

        const direccionTrim = (Direccion || "").trim();
        const ciudadIdTrim = (CiudadId || "").trim();
        const ciudadDescTrim = (CiudadDescripcion || "").trim();
        const pais = PAISES_PROVEEDOR_CLIENTE[PaisKey];
        const coordX = Number(CoordenadaX);
        const coordY = Number(CoordenadaY);

        if (!PersonaClienteId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }
        if (!direccionTrim) {
            return res.status(400).json({ Message: "La Dirección es requerida." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País válido." });
        }
        if (!ciudadIdTrim || !ciudadDescTrim) {
            return res.status(400).json({ Message: "Debe seleccionar una Ciudad." });
        }
        if (!Number.isFinite(coordX) || !Number.isFinite(coordY)) {
            return res.status(400).json({ Message: "Las Coordenadas deben ser numéricas." });
        }

        // El Tipo de Sitio no lo elige el usuario: depende del País (regla del negocio). Nicaragua
        // y Costa Rica todavía no tienen una regla confirmada.
        const tipoSitio = TIPO_SITIO_POR_PAIS[PaisKey];
        if (!tipoSitio) {
            return res.status(400).json({ Message: `El Tipo de Sitio para ${pais.descripcion} todavía no está definido. Contacta a un administrador.` });
        }

        // El Nombre no lo escribe el usuario: es el mismo con el que el cliente quedó registrado
        // en Personas. El Código ERP tampoco: se toma del Código ERP ya creado para este cliente
        // en el mismo País del Sitio (ver /crearCodigoErpCliente, paso previo obligatorio).
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const personaInfo = await poolPersonas.request()
            .input('personaId', sql.UniqueIdentifier, PersonaClienteId)
            .query(`SELECT [Nombre] FROM [dbo].[Persona] WHERE [Id] = @personaId`);
        if (personaInfo.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el cliente." });
        }
        const nombrePersona = personaInfo.recordset[0].Nombre;

        const codigoErpInfo = await poolPersonas.request()
            .input('personaId2', sql.UniqueIdentifier, PersonaClienteId)
            .input('paisId', sql.VarChar, pais.id)
            .query(`
                SELECT TOP 1 [Codigo] FROM [dbo].[CodigoErp]
                WHERE [PersonaJuridicaClienteId] = @personaId2 AND [Pais] = @paisId AND [IsSoftDeleted] = 0
                ORDER BY [CreatedDate] DESC
            `);
        if (codigoErpInfo.recordset.length === 0) {
            return res.status(400).json({ Message: `Debe crear primero un Código ERP para ${pais.descripcion} antes de agregar un Sitio en ese País.` });
        }
        const codigoErp = codigoErpInfo.recordset[0].Codigo;

        const body = {
            Nombre: nombrePersona,
            Direccion: direccionTrim,
            PaisId: pais.id,
            PaisDescripcion: pais.descripcion,
            CiudadId: ciudadIdTrim,
            CiudadDescripcion: ciudadDescTrim,
            CoordenadaX: coordX,
            CoordenadaY: coordY,
            // El campo real que exige SitioClienteServiceApi/Create es "PersonaJuridicaClienteId"
            // (confirmado en el swagger; el ejemplo original decía "PersonaClienteId" y la API lo
            // rechazaba con "PersonaJuridicaClienteId no null, no empty").
            PersonaJuridicaClienteId: PersonaClienteId,
            TipoDeSitioId: tipoSitio.id,
            TipoDeSitioDescripcion: tipoSitio.descripcion,
            Referencia: generarReferencia(nombrePersona),
            TipoPersonaDestino: "3",
            Codigo: codigoErp,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/SitioClienteServiceApi/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`SitioClienteServiceApi/Create → HTTP ${resp.status} para ${nombrePersona}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`SitioClienteServiceApi/Create → ${nombrePersona}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Sitio "${direccionTrim}" (${tipoSitio.descripcion}) para el Cliente "${nombrePersona}"`,
            referencia: direccionTrim
        });

        return res.status(200).json({ Message: "Sitio creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearSitioCliente:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Campos fijos que exige Cliente/Create y no se le piden al usuario. TipoPersonaDestino aquí
// SÍ viaja dentro del propio Create (a diferencia de Proveedor, que lo asigna en una llamada
// aparte a SetTipoPersonaDestino porque Proveedor/Create no lo acepta).
const CLIENTE_CFO_DEFAULTS = {
    SolicitudEspecieFiscalTipo: 1,
    TipoPersonaDestino: 3,
};

// Tenants (bases contables) disponibles para crear el Proveedor/Cliente en CFO. Cada uno es un
// Tenant real e independiente — verificado contra CfoNetCore.dbo.Tenant (Nombre y SociedadFiscal,
// que coincide exactamente con el campo "sociedad" de PAISES_PROVEEDOR_CLIENTE: 9095/SV01/GT01/
// NI01/CR01). OJO: antes este catálogo tenía El Salvador, Guatemala y Nicaragua apuntando los
// tres al mismo TenantId "174E784C..." (pensando que compartían Tenant); en realidad ese Id es
// SOLO el de Guatemala ("VESTA LOGISTIC, S.A. (GT)") — El Salvador y Nicaragua tienen cada uno
// su propio Tenant real, que no estaba en el catálogo. Se corrigió aquí.
const TENANTS_PROVEEDOR_CFO = {
    honduras: { id: "30D1014C-D443-42EE-8015-005FB0D9FA00", label: "Honduras" },
    elSalvador: { id: "C7194841-BB94-4903-ADD7-0065CC7AF42C", label: "El Salvador" },
    guatemala: { id: "174E784C-CEDA-4758-A7F5-0063C3454B73", label: "Guatemala" },
    nicaragua: { id: "2B45F90A-6691-4829-BA76-0F7B53790453", label: "Nicaragua" },
    costaRica: { id: "13A8389D-9064-4A5B-A156-2235B8A2751A", label: "Costa Rica" },
    corporacionDinant: { id: "8092E57D-03A5-44D3-B271-0F27EBF3D818", label: "Corporación Dinant" },
    dinantExports: { id: "CF884F18-6C35-4703-A48B-21FD0680B2CE", label: "Dinant Exports" },
};

// Tenants en los que un proveedor (por PersonaId) ya está creado en CFO. Se consulta directo
// contra CfoNetCore.dbo.Proveedor (no solo lo creado en esta sesión) para poder avisar si el
// usuario intenta crear de nuevo un Tenant que ya existe, aunque sea en una sesión distinta.
app.post('/proveedoresCfoPorPersona', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId } = req.body;
        if (!PersonaId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaId)
            .query(`
                SELECT
                    p.[Id], p.[TenantId], p.[AplicaRetencion], p.[IsProveedorSujetoExcluido], p.[Moneda_Value],
                    p.[OficialDePagoId], opPago.[Nombre] AS OficialDePagoNombre,
                    p.[OficialSolicitudDePagoId], opSolicitud.[Nombre] AS OficialSolicitudDePagoNombre
                FROM [dbo].[Proveedor] p
                LEFT JOIN [dbo].[Operador] opPago ON opPago.[Id] = p.[OficialDePagoId]
                LEFT JOIN [dbo].[Operador] opSolicitud ON opSolicitud.[Id] = p.[OficialSolicitudDePagoId]
                WHERE p.[PersonaId] = @personaId AND p.[IsSoftDeleted] = 0
            `);

        // Los Sitios y Materiales son varios por Proveedor, así que se traen aparte y se agrupan
        // por ProveedorId en vez de venir en la misma fila que Moneda/Oficiales.
        const proveedorIds = resultado.recordset.map((row) => row.Id);
        const sitiosPorProveedor = {};
        const materialesPorProveedor = {};
        if (proveedorIds.length > 0) {
            const requestSitios = pool.request();
            const paramsSitios = proveedorIds.map((id, i) => {
                const nombre = `pid${i}`;
                requestSitios.input(nombre, sql.UniqueIdentifier, id);
                return `@${nombre}`;
            });
            const resultadoSitios = await requestSitios.query(`
                SELECT ps.[ProveedorId], s.[Id], s.[Nombre]
                FROM [dbo].[ProveedorSitio] ps
                JOIN [dbo].[Sitio] s ON s.[Id] = ps.[SitioId]
                WHERE ps.[ProveedorId] IN (${paramsSitios.join(', ')})
                  AND ps.[IsSoftDeleted] = 0 AND s.[IsSoftDeleted] = 0
                ORDER BY s.[Nombre]
            `);
            resultadoSitios.recordset.forEach((row) => {
                const clave = String(row.ProveedorId).toUpperCase();
                if (!sitiosPorProveedor[clave]) sitiosPorProveedor[clave] = [];
                sitiosPorProveedor[clave].push({ Id: row.Id, Nombre: row.Nombre });
            });

            const requestMateriales = pool.request();
            const paramsMateriales = proveedorIds.map((id, i) => {
                const nombre = `mid${i}`;
                requestMateriales.input(nombre, sql.UniqueIdentifier, id);
                return `@${nombre}`;
            });
            const resultadoMateriales = await requestMateriales.query(`
                SELECT [ProveedorId], [Id], [Descripcion], [CodigoMaterial]
                FROM [dbo].[MaterialProveedor]
                WHERE [ProveedorId] IN (${paramsMateriales.join(', ')}) AND [IsSoftDeleted] = 0
                ORDER BY [Descripcion]
            `);
            resultadoMateriales.recordset.forEach((row) => {
                const clave = String(row.ProveedorId).toUpperCase();
                if (!materialesPorProveedor[clave]) materialesPorProveedor[clave] = [];
                materialesPorProveedor[clave].push({ Id: row.Id, Descripcion: row.Descripcion, CodigoMaterial: row.CodigoMaterial });
            });
        }

        // El Salvador/Guatemala/Nicaragua comparten el mismo TenantId real (una sola fila en la
        // base), pero se muestran como renglones individuales — uno por cada País que coincide —
        // en vez de fusionarlos en un solo renglón combinado: así se puede seguir viendo/editando
        // cada País por separado en pantalla. Lo que si no debe pasar es permitir "crear" de nuevo
        // para otro País del mismo grupo pensando que es un registro aparte — eso lo evita
        // /crearProveedorCfo consultando existentesKeys (ver SeccionProveedorCfo), que marca los
        // 3 como "ya existe" aunque solo haya una fila real detrás.
        const filas = resultado.recordset.flatMap((row) =>
            Object.entries(TENANTS_PROVEEDOR_CFO)
                .filter(([, t]) => String(t.id).toUpperCase() === String(row.TenantId).toUpperCase())
                .map(([key, t]) => ({
                    Id: row.Id,
                    TenantKey: key,
                    Pais: t.label,
                    AplicaRetencion: !!row.AplicaRetencion,
                    IsProveedorSujetoExcluido: !!row.IsProveedorSujetoExcluido,
                    MonedaValue: row.Moneda_Value ?? null,
                    OficialDePagoNombre: row.OficialDePagoNombre || null,
                    OficialSolicitudDePagoNombre: row.OficialSolicitudDePagoNombre || null,
                    Sitios: sitiosPorProveedor[String(row.Id).toUpperCase()] || [],
                    Materiales: materialesPorProveedor[String(row.Id).toUpperCase()] || []
                }))
        );

        return res.json(filas);

    } catch (error) {
        console.error("Error en proveedoresCfoPorPersona:", error);
        return res.status(500).json({ Message: "Error al validar Proveedor en CFO", Error: error.message });
    }
});

// TipoPersonaDestino en el sistema externo: 4 = Proveedor, 3 = Cliente. Este módulo por ahora
// solo crea Proveedores, así que siempre se asigna 4 automáticamente al crear — no es una opción
// que el usuario deba elegir. El 3 se usará cuando se implemente la creación de Clientes.
const TIPO_PERSONA_DESTINO_PROVEEDOR = 4;

app.post('/crearProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId, TenantKey, AplicaRetencion, IsProveedorSujetoExcluido, CreatedBy } = req.body;
        const tenant = TENANTS_PROVEEDOR_CFO[TenantKey];

        if (!PersonaId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }
        if (!tenant) {
            return res.status(400).json({ Message: "Debe seleccionar un País/Tenant válido." });
        }
        if (typeof AplicaRetencion !== "boolean") {
            return res.status(400).json({ Message: "Debe indicar si aplica retención." });
        }
        if (typeof IsProveedorSujetoExcluido !== "boolean") {
            return res.status(400).json({ Message: "Debe indicar si es Proveedor Sujeto Excluido." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        // El Nombre no se toma de un campo libre del frontend: se extrae de Personas, que es
        // donde quedó registrado cuando se creó/validó el proveedor.
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const personaInfo = await poolPersonas.request()
            .input('personaId', sql.UniqueIdentifier, PersonaId)
            .query(`SELECT [Nombre] FROM [dbo].[Persona] WHERE [Id] = @personaId`);

        if (personaInfo.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el proveedor en Personas." });
        }
        const nombre = personaInfo.recordset[0].Nombre;

        const body = {
            Nombre: nombre,
            AplicaRetencion,
            CreatedBy,
            PersonaId,
            TenantId: tenant.id,
            IsProveedorSujetoExcluido,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/Proveedor/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Proveedor/Create → HTTP ${resp.status} para ${PersonaId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`Proveedor/Create → ${PersonaId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        // Todo Proveedor creado desde este módulo es, por definición, un Proveedor (no un
        // Cliente), así que el TipoPersonaDestino se asigna aquí mismo, automáticamente, sin
        // pedírselo al usuario. Si esta llamada fallara no se revierte la creación del
        // Proveedor (ya se confirmó con éxito); solo se deja registrado en el log del servidor.
        const proveedorCfoId = data?.ProveedorVm?.Id;
        if (proveedorCfoId) {
            try {
                const respTipo = await fetch("https://cfows.azurewebsites.net/api/Proveedor/SetTipoPersonaDestino", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ Id: proveedorCfoId, TipoPersonaDestino: TIPO_PERSONA_DESTINO_PROVEEDOR, ModifiedBy: CreatedBy })
                });
                if (!respTipo.ok) {
                    console.error(`Proveedor/SetTipoPersonaDestino (automático) → HTTP ${respTipo.status} para ${proveedorCfoId}:`, await respTipo.text());
                }
            } catch (errorTipo) {
                console.error("Error al asignar TipoPersonaDestino automáticamente:", errorTipo);
            }
        } else {
            console.error(`Proveedor/Create no devolvió ProveedorVm.Id para ${PersonaId}; no se pudo asignar TipoPersonaDestino automáticamente.`);
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Proveedor en CFO "${nombre}" (${tenant.label})`,
            referencia: nombre
        });

        return res.status(200).json({ Message: "Proveedor creado en CFO con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Catálogo de Monedas de pago disponibles para un Proveedor en CFO (api/Proveedor/SetMoneda).
// Los valores son los códigos ISO 4217 numéricos que ya usa el sistema (ver también Moneda:
// 558 en DOCUMENTO_PROVISIONAL_NIC más abajo).
const MONEDAS_PROVEEDOR_CFO = {
    lempiras: { value: 340, label: "Lempiras (HNL)" },
    dolares: { value: 840, label: "Dólares (USD)" },
    cordobas: { value: 558, label: "Córdobas (NIO)" },
    colones: { value: 188, label: "Colones (CRC)" },
    quetzales: { value: 320, label: "Quetzales (GTQ)" },
};

app.post('/asignarMonedaProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, MonedaKey, ModifiedBy } = req.body;
        const moneda = MONEDAS_PROVEEDOR_CFO[MonedaKey];

        if (!Id) {
            return res.status(400).json({ Message: "El Proveedor en CFO es requerido." });
        }
        if (!moneda) {
            return res.status(400).json({ Message: "Debe seleccionar una Moneda válida." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/Proveedor/SetMoneda", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, Moneda: moneda.value, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Proveedor/SetMoneda → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        // A diferencia de Create, SetMoneda devuelve el ProveedorVm directo (sin campo IsValid),
        // así que un HTTP 200 ya es la confirmación de éxito.
        const data = await resp.json().catch(() => null);
        console.log(`Proveedor/SetMoneda → ${Id}:`, JSON.stringify(data));

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Asignó la Moneda "${moneda.label}" al Proveedor en CFO`,
            referencia: Id
        });

        return res.status(200).json({ Message: "Moneda asignada con éxito", Data: data });

    } catch (error) {
        console.error("Error en asignarMonedaProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Tenants en los que un cliente (por PersonaId) ya está creado en CFO. Igual que
// /proveedoresCfoPorPersona, se consulta directo contra CfoNetCore.dbo.Cliente (no solo lo
// creado en esta sesión) para avisar si el usuario intenta repetir un Tenant ya existente.
app.post('/clientesCfoPorPersona', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId } = req.body;
        if (!PersonaId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaId)
            .query(`
                SELECT [Id], [TenantId], [Moneda_Value], [MonedaPagoMinimo_Value]
                FROM [dbo].[Cliente]
                WHERE [PersonaId] = @personaId AND [IsSoftDeleted] = 0
            `);

        // Varias claves del catálogo pueden compartir el mismo TenantId real (El Salvador,
        // Guatemala y Nicaragua usan la misma base contable), pero se muestran como renglones
        // individuales — uno por País — igual que en /proveedoresCfoPorPersona; lo que se evita
        // es permitir crear de nuevo para otro País del mismo grupo (ver existentesKeys en
        // SeccionClienteCfo del frontend, si se agrega esa validación ahí también).
        const filas = resultado.recordset.flatMap((row) =>
            Object.entries(TENANTS_PROVEEDOR_CFO)
                .filter(([, t]) => String(t.id).toUpperCase() === String(row.TenantId).toUpperCase())
                .map(([key, t]) => ({
                    Id: row.Id,
                    TenantKey: key,
                    Pais: t.label,
                    MonedaValue: row.Moneda_Value ?? null,
                    MonedaPagoMinimoValue: row.MonedaPagoMinimo_Value ?? null,
                }))
        );

        return res.json(filas);

    } catch (error) {
        console.error("Error en clientesCfoPorPersona:", error);
        return res.status(500).json({ Message: "Error al validar Cliente en CFO", Error: error.message });
    }
});

app.post('/crearClienteCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId, TenantKey, MonedaKey, MonedaPagoMinimoKey, CreatedBy } = req.body;
        const tenant = TENANTS_PROVEEDOR_CFO[TenantKey];
        const moneda = MONEDAS_PROVEEDOR_CFO[MonedaKey];
        const monedaPagoMinimo = MONEDAS_PROVEEDOR_CFO[MonedaPagoMinimoKey];

        if (!PersonaId) {
            return res.status(400).json({ Message: "El cliente es requerido." });
        }
        if (!tenant) {
            return res.status(400).json({ Message: "Debe seleccionar un País/Tenant válido." });
        }
        if (!moneda) {
            return res.status(400).json({ Message: "Debe seleccionar una Moneda válida." });
        }
        if (!monedaPagoMinimo) {
            return res.status(400).json({ Message: "Debe seleccionar una Moneda de Pago Mínimo válida." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        // El Nombre no se toma de un campo libre del frontend: se extrae de Personas, que es
        // donde quedó registrado cuando se creó/validó el cliente.
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const personaInfo = await poolPersonas.request()
            .input('personaId', sql.UniqueIdentifier, PersonaId)
            .query(`SELECT [Nombre] FROM [dbo].[Persona] WHERE [Id] = @personaId`);

        if (personaInfo.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el cliente en Personas." });
        }
        const nombre = personaInfo.recordset[0].Nombre;

        const body = {
            Nombre: nombre,
            CreatedBy,
            Moneda: moneda.value,
            SolicitudEspecieFiscalTipo: CLIENTE_CFO_DEFAULTS.SolicitudEspecieFiscalTipo,
            PersonaId,
            TenantId: tenant.id,
            TipoPersonaDestino: CLIENTE_CFO_DEFAULTS.TipoPersonaDestino,
            MonedaPagoMinimo: monedaPagoMinimo.value,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/Cliente/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Cliente/Create → HTTP ${resp.status} para ${PersonaId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`Cliente/Create → ${PersonaId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Cliente en CFO "${nombre}" (${tenant.label})`,
            referencia: nombre
        });

        return res.status(200).json({ Message: "Cliente creado en CFO con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearClienteCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Operadores (CfoNetCore.dbo.Operador) candidatos a Oficial de Pago / Oficial de Solicitud de
// Pago de un Proveedor. Se busca por nombre parcial porque el usuario solo conoce el nombre del
// operador, no su Id.
app.post('/buscarOperador', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Nombre } = req.body;
        const nombreTrim = (Nombre || "").trim();
        if (!nombreTrim) {
            return res.status(400).json({ Message: "Ingrese al menos el nombre del Operador para buscar." });
        }

        // Se busca palabra por palabra (nombre, apellido, sea el primero o el segundo, en
        // cualquier orden) en vez de la frase completa tal cual, para que "Maria Fiallos"
        // encuentre a "Maria Alejandra Fiallos Pineda" aunque no queden juntas en el campo.
        const palabras = nombreTrim.split(/\s+/).filter(Boolean);

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const condiciones = palabras.map((palabra, i) => {
            const nombreParam = `palabra${i}`;
            request.input(nombreParam, sql.VarChar, `%${palabra}%`);
            return `[Nombre] LIKE @${nombreParam}`;
        });

        const resultado = await request.query(`
            SELECT TOP 20 [Id], [Nombre]
            FROM [dbo].[Operador]
            WHERE (${condiciones.join(' AND ')}) AND [IsSoftDeleted] = 0
            ORDER BY [Nombre]
        `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en buscarOperador:", error);
        return res.status(500).json({ Message: "Error al buscar el Operador", Error: error.message });
    }
});

app.post('/asignarOficialSolicitudDePagoProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { ProveedorId, OficialSolicitudDePagoId, ModifiedBy } = req.body;

        if (!ProveedorId) {
            return res.status(400).json({ Message: "El Proveedor en CFO es requerido." });
        }
        if (!OficialSolicitudDePagoId) {
            return res.status(400).json({ Message: "Debe seleccionar un Operador." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/Proveedor/SetOficialSolicitudDePago", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ProveedorId, OficialSolicitudDePagoId, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Proveedor/SetOficialSolicitudDePago → HTTP ${resp.status} para ${ProveedorId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Asignó el Oficial de Solicitud de Pago al Proveedor en CFO",
            referencia: ProveedorId
        });

        return res.status(200).json({ Message: "Oficial de Solicitud de Pago asignado con éxito" });

    } catch (error) {
        console.error("Error en asignarOficialSolicitudDePagoProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/asignarOficialDePagoProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { ProveedorId, OficialDePagoId, ModifiedBy } = req.body;

        if (!ProveedorId) {
            return res.status(400).json({ Message: "El Proveedor en CFO es requerido." });
        }
        if (!OficialDePagoId) {
            return res.status(400).json({ Message: "Debe seleccionar un Operador." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/Proveedor/SetOficialDePago", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ProveedorId, OficialDePagoId, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Proveedor/SetOficialDePago → HTTP ${resp.status} para ${ProveedorId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Asignó el Oficial de Pago al Proveedor en CFO",
            referencia: ProveedorId
        });

        return res.status(200).json({ Message: "Oficial de Pago asignado con éxito" });

    } catch (error) {
        console.error("Error en asignarOficialDePagoProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Catálogo completo de Sitios (CfoNetCore.dbo.Sitio) para el desplegable de "agregar Sitio" a
// un Proveedor en CFO. Es una lista corta (decenas de filas), así que se trae completa en vez
// de buscarla por nombre.
app.post('/listarSitios', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request().query(`
            SELECT [Id], [Nombre]
            FROM [dbo].[Sitio]
            WHERE [IsSoftDeleted] = 0
            ORDER BY [Nombre]
        `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en listarSitios:", error);
        return res.status(500).json({ Message: "Error al listar los Sitios", Error: error.message });
    }
});

// Marca fija que exige AddProveedorSitio y no varía entre asignaciones (así lo confirmó el
// negocio con el ejemplo de JSON compartido).
const MARCA_SITIO_DEFAULT = 0;

app.post('/agregarSitioProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { ProveedorId, SitioId, CreatedBy } = req.body;

        if (!ProveedorId) {
            return res.status(400).json({ Message: "El Proveedor en CFO es requerido." });
        }
        if (!SitioId) {
            return res.status(400).json({ Message: "Debe seleccionar un Sitio." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        const resp = await fetch("https://cfows.azurewebsites.net/api/Proveedor/AddProveedorSitio", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ProveedorId, SitioId, CreatedBy, Marca: MARCA_SITIO_DEFAULT })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Proveedor/AddProveedorSitio → HTTP ${resp.status} para ${ProveedorId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Agregó un Sitio al Proveedor en CFO",
            referencia: ProveedorId
        });

        return res.status(200).json({ Message: "Sitio agregado con éxito" });

    } catch (error) {
        console.error("Error en agregarSitioProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Catálogo completo de MaterialTenant (CfoNetCore.dbo.MaterialTenant) para el Tenant del
// registro de Proveedor en CFO con el que se está trabajando, para que el usuario elija el más
// adecuado de la lista en vez de tener que saber de memoria la Cuenta Mayor y el Código ERP.
app.post('/listarMaterialesTenant', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { TenantKey } = req.body;
        const tenant = TENANTS_PROVEEDOR_CFO[TenantKey];

        if (!tenant) {
            return res.status(400).json({ Message: "No se pudo determinar el País/Tenant de este registro." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request()
            .input('tenantId', sql.UniqueIdentifier, tenant.id)
            .query(`
                SELECT [Id], [Descripcion], [CuentaMayor], [CodigoErpReembolso]
                FROM [dbo].[MaterialTenant]
                WHERE [TenantId] = @tenantId AND [IsSoftDeleted] = 0
                ORDER BY [Descripcion]
            `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en listarMaterialesTenant:", error);
        return res.status(500).json({ Message: "Error al listar los Materiales Tenant", Error: error.message });
    }
});

app.post('/agregarMaterialProveedorCfo', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId, MaterialTenantId, Descripcion, CreatedBy } = req.body;
        const descripcionTrim = (Descripcion || "").trim();

        if (!PersonaId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }
        if (!MaterialTenantId) {
            return res.status(400).json({ Message: "Debe buscar y encontrar el Material Tenant (Cuenta Mayor + Código ERP) antes de crear." });
        }
        if (!descripcionTrim) {
            return res.status(400).json({ Message: "El Nombre del Material es requerido." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        // Igual que la Referencia del Proveedor: primera letra de cada una de las primeras 3
        // palabras del Nombre (o las primeras 3 letras si es una sola palabra). Al reutilizar
        // siempre el mismo Nombre para Honduras/Corporación Dinant/Dinant Exports, este código
        // sale idéntico en los tres sin necesidad de lógica extra.
        const codigoMaterial = generarReferencia(descripcionTrim);

        const body = {
            Descripcion: descripcionTrim,
            // A diferencia de lo que parecía por la columna guardada, el API SÍ espera aquí el
            // Id crudo de la Persona (Personas.dbo.Persona.Id): internamente busca el Proveedor
            // por PersonaId + el Tenant del MaterialTenantId dado. Mandar el Id de Proveedor en
            // CFO por Tenant (como Moneda/Oficiales/Sitios) da "No existe proveedor".
            PersonaId,
            MaterialTenantId,
            CreatedBy,
            CodigoMaterial: codigoMaterial,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/MaterialProveedor/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`MaterialProveedor/Create → HTTP ${resp.status} para ${PersonaId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`MaterialProveedor/Create → ${PersonaId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Agregó el Material "${descripcionTrim}" (${codigoMaterial}) al Proveedor en CFO`,
            referencia: PersonaId
        });

        return res.status(200).json({ Message: "Material agregado con éxito", Data: data, CodigoMaterial: codigoMaterial });

    } catch (error) {
        console.error("Error en agregarMaterialProveedorCfo:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Da de alta un Material Tenant nuevo en el catálogo (CfoNetCore.dbo.MaterialTenant) cuando el
// usuario ya tiene la Cuenta Mayor y el Código ERP pero todavía no existe para el País/Tenant
// que necesita. El TenantId se resuelve del mismo catálogo fijo que usa el resto del módulo.
app.post('/crearMaterialTenant', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { CuentaMayor, CodigoErp, Descripcion, TenantKey, CreatedBy } = req.body;
        const cuentaMayorTrim = (CuentaMayor || "").trim();
        const codigoErpTrim = (CodigoErp || "").trim();
        const descripcionTrim = (Descripcion || "").trim();
        const tenant = TENANTS_PROVEEDOR_CFO[TenantKey];

        if (!cuentaMayorTrim) {
            return res.status(400).json({ Message: "La Cuenta Mayor es requerida." });
        }
        if (!codigoErpTrim) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!descripcionTrim) {
            return res.status(400).json({ Message: "La Descripción es requerida." });
        }
        if (!tenant) {
            return res.status(400).json({ Message: "Debe seleccionar un País/Tenant válido." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        const body = {
            CodigoErpReembolso: codigoErpTrim,
            CuentaMayor: cuentaMayorTrim,
            CreatedBy,
            Descripcion: descripcionTrim,
            TenantId: tenant.id,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/MaterialTenant/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`MaterialTenant/Create → HTTP ${resp.status} para ${cuentaMayorTrim}/${codigoErpTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`MaterialTenant/Create → ${descripcionTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Material Tenant "${descripcionTrim}" (${tenant.label})`,
            referencia: `${cuentaMayorTrim} / ${codigoErpTrim}`
        });

        return res.status(200).json({
            Message: "Material Tenant creado con éxito",
            Data: data,
            Id: data?.MaterialTenantVm?.Id,
            Descripcion: descripcionTrim,
            CuentaMayor: cuentaMayorTrim,
            CodigoErpReembolso: codigoErpTrim
        });

    } catch (error) {
        console.error("Error en crearMaterialTenant:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// --- Cuentas de Banco del Proveedor (api de Personas: CuentaBancoPersonaService/Banco/TipoCuenta) ---
// A diferencia de Moneda/Oficiales/Sitios/Materiales (que son por Tenant/Proveedor en CFO), la
// Cuenta de Banco cuelga directo de la Persona (PersonaId = Personas.dbo.Persona.Id), verificado
// contra Personas.dbo.CuentaBancoPersona.PersonaId.

// Mismos 5 países que PAISES_PROVEEDOR_CLIENTE (mismos Ids), pero con la descripción en el mismo
// formato (Title Case) que ya usan los Bancos reales existentes en Personas.dbo.Banco — a
// diferencia de PAISES_PROVEEDOR_CLIENTE.descripcion, que está en MAYÚSCULAS para otro consumo.
const PAISES_BANCO = {
    honduras: { id: "65507ECF-249E-454B-A95A-0061BA0FA2BA", descripcion: "Honduras" },
    elSalvador: { id: "174E784C-CEDA-4758-A7F5-0063C3454B73", descripcion: "El Salvador" },
    guatemala: { id: "30D1014C-D443-42EE-8015-005FB0D9FA00", descripcion: "Guatemala" },
    nicaragua: { id: "C7194841-BB94-4903-ADD7-0065CC7AF42C", descripcion: "Nicaragua" },
    costaRica: { id: "27E0710C-A5BC-4C77-AFC7-137AF86DE6AA", descripcion: "Costa Rica" },
};

// El API de Personas espera el código de Moneda como texto (enum serializado por nombre), pero
// en Personas.dbo.CuentaBancoPersona.Moneda queda guardado como el mismo entero ISO 4217 que ya
// usa CfoNetCore.dbo.Proveedor.Moneda_Value — se verificó contra datos reales de esa tabla.
const MONEDAS_CUENTA_BANCO = {
    lempiras: { codigo: "HNL", valorIso: 340, label: "Lempiras (HNL)" },
    dolares: { codigo: "USD", valorIso: 840, label: "Dólares (USD)" },
    cordobas: { codigo: "NIO", valorIso: 558, label: "Córdobas (NIO)" },
    colones: { codigo: "CRC", valorIso: 188, label: "Colones (CRC)" },
    quetzales: { codigo: "GTQ", valorIso: 320, label: "Quetzales (GTQ)" },
};

// Create espera el entero crudo (probado contra el servicio real: mandar el nombre del enum
// como texto da "Input string was not in a correct format"), pero ModificarTipoPersonaDestino
// sí espera el nombre del enum como texto — también probado contra el servicio real. 4/3 son
// los mismos valores que ya usa CfoNetCore.dbo.Proveedor.TipoPersonaDestino, y el API los
// nombra como "JuridicaProveedor"/"JuridicaCliente" (con el prefijo "Juridica").
const TIPO_PERSONA_DESTINO_CUENTA_BANCO = {
    proveedor: { valorCreate: 4, valorModificar: "JuridicaProveedor", label: "Proveedor" },
    cliente: { valorCreate: 3, valorModificar: "JuridicaCliente", label: "Cliente" },
};

// Solo estas dos opciones (Cheques/Ahorro), con los Ids reales de Personas.dbo.TipoCuenta — hay
// una tercera fila duplicada ("AHORRO") en esa tabla que no se expone aquí a propósito.
const TIPOS_CUENTA_BANCO = {
    cheques: { id: "6FAC7AE8-491E-4078-87F9-148C89B76DD7", descripcion: "Cheques" },
    ahorro: { id: "899C726F-99C6-4C15-8913-148C89CE0A12", descripcion: "Ahorro" },
};

app.post('/cuentasBancoPersona', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { PersonaId } = req.body;
        if (!PersonaId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }

        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request()
            .input('personaId', sql.UniqueIdentifier, PersonaId)
            .query(`
                SELECT [Id], [BancoId], [Numero], [BancoNombre], [TipoCuentaDescripcion], [Moneda], [TipoPersonaDestino], [CuentaH2H]
                FROM [dbo].[CuentaBancoPersona]
                WHERE [PersonaId] = @personaId AND [IsSoftDeleted] = 0
                ORDER BY [BancoNombre]
            `);

        const filas = resultado.recordset.map((row) => {
            const monedaEntry = Object.values(MONEDAS_CUENTA_BANCO).find((m) => m.valorIso === row.Moneda);
            return {
                Id: row.Id,
                BancoId: row.BancoId,
                Numero: row.Numero,
                BancoNombre: row.BancoNombre,
                TipoCuentaDescripcion: row.TipoCuentaDescripcion,
                Moneda: monedaEntry?.label || String(row.Moneda),
                TipoPersonaDestino: row.TipoPersonaDestino === 4 ? "Proveedor" : row.TipoPersonaDestino === 3 ? "Cliente" : String(row.TipoPersonaDestino),
                CuentaH2H: !!row.CuentaH2H
            };
        });

        return res.json(filas);

    } catch (error) {
        console.error("Error en cuentasBancoPersona:", error);
        return res.status(500).json({ Message: "Error al listar las Cuentas de Banco", Error: error.message });
    }
});

// Catálogo completo de Bancos (Personas.dbo.Banco) para el buscador de "agregar Cuenta de
// Banco". Es una lista corta (decenas de filas), así que se trae completa.
app.post('/listarBancos', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request().query(`
            SELECT [Id], [Nombre], [PaisDescripcion]
            FROM [dbo].[Banco]
            WHERE [IsSoftDeleted] = 0
            ORDER BY [Nombre]
        `);

        return res.json(resultado.recordset);

    } catch (error) {
        console.error("Error en listarBancos:", error);
        return res.status(500).json({ Message: "Error al listar los Bancos", Error: error.message });
    }
});

app.post('/crearBanco', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Nombre, PaisKey } = req.body;
        const nombreTrim = (Nombre || "").trim();
        const pais = PAISES_BANCO[PaisKey];

        if (!nombreTrim) {
            return res.status(400).json({ Message: "El Nombre del Banco es requerido." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País válido." });
        }

        const body = {
            Nombre: nombreTrim,
            PaisId: pais.id,
            PaisDescripcion: pais.descripcion,
            Swift: "",
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/Banco/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`Banco/Create → HTTP ${resp.status} para ${nombreTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`Banco/Create → ${nombreTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "El servicio externo rechazó la solicitud." });
        }

        // La respuesta cruda no tiene schema documentado (no se sabe con certeza el campo del
        // Id), así que se re-consulta el Banco recién creado por Nombre + País, igual que se
        // hace con Persona/Proveedor tras crearlo.
        const poolPersonas = await conexion(BasesDeDatos.Personas);
        const nuevoBanco = await poolPersonas.request()
            .input('nombre', sql.VarChar, nombreTrim)
            .input('paisId', sql.UniqueIdentifier, pais.id)
            .query(`
                SELECT TOP 1 [Id] FROM [dbo].[Banco]
                WHERE [Nombre] = @nombre AND [PaisId] = @paisId AND [IsSoftDeleted] = 0
                ORDER BY [CreatedDate] DESC
            `);
        const bancoId = nuevoBanco.recordset[0]?.Id || null;

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó el Banco "${nombreTrim}" (${pais.descripcion})`,
            referencia: nombreTrim
        });

        return res.status(200).json({ Message: "Banco creado con éxito", Id: bancoId, Nombre: nombreTrim, PaisDescripcion: pais.descripcion });

    } catch (error) {
        console.error("Error en crearBanco:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/crearCuentaBancoPersona', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Numero, PersonaId, BancoId, BancoNombre, TipoCuentaKey, MonedaKey, TipoPersonaDestinoKey, CreatedBy } = req.body;
        const numeroTrim = (Numero || "").trim();
        const bancoNombreTrim = (BancoNombre || "").trim();
        const tipoCuenta = TIPOS_CUENTA_BANCO[TipoCuentaKey];
        const moneda = MONEDAS_CUENTA_BANCO[MonedaKey];
        const tipoPersonaDestino = TIPO_PERSONA_DESTINO_CUENTA_BANCO[TipoPersonaDestinoKey];

        if (!numeroTrim) {
            return res.status(400).json({ Message: "El Número de Cuenta es requerido." });
        }
        if (!PersonaId) {
            return res.status(400).json({ Message: "El proveedor es requerido." });
        }
        if (!BancoId || !bancoNombreTrim) {
            return res.status(400).json({ Message: "Debe seleccionar un Banco." });
        }
        if (!tipoCuenta) {
            return res.status(400).json({ Message: "Debe seleccionar el Tipo de Cuenta." });
        }
        if (!moneda) {
            return res.status(400).json({ Message: "Debe seleccionar la Moneda." });
        }
        if (!tipoPersonaDestino) {
            return res.status(400).json({ Message: "Debe indicar si es Proveedor o Cliente." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        const body = {
            Numero: numeroTrim,
            PersonaId,
            BancoId,
            BancoNombre: bancoNombreTrim,
            TipoCuentaId: tipoCuenta.id,
            TipoCuentaDescripcion: tipoCuenta.descripcion,
            Moneda: moneda.codigo,
            TipoPersonaDestino: tipoPersonaDestino.valorCreate,
            CuentaH2H: true,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CuentaBancoPersonaService/Create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CuentaBancoPersonaService/Create → HTTP ${resp.status} para ${numeroTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CuentaBancoPersonaService/Create → ${numeroTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "El servicio externo rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Creó la Cuenta de Banco "${numeroTrim}" (${bancoNombreTrim})`,
            referencia: PersonaId
        });

        return res.status(200).json({ Message: "Cuenta de Banco creada con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearCuentaBancoPersona:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/modificarCuentaBancoNumero', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, BancoId, BancoNombre, Numero, ModifiedBy } = req.body;
        const numeroTrim = (Numero || "").trim();
        const bancoNombreTrim = (BancoNombre || "").trim();

        if (!Id) {
            return res.status(400).json({ Message: "La Cuenta de Banco es requerida." });
        }
        if (!BancoId || !bancoNombreTrim) {
            return res.status(400).json({ Message: "Debe seleccionar un Banco." });
        }
        if (!numeroTrim) {
            return res.status(400).json({ Message: "El Número de Cuenta es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CuentaBancoPersonaService/ModificarBancoIdNombreYNumero", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, ModifiedBy, BancoId, BancoNombre: bancoNombreTrim, Numero: numeroTrim })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CuentaBancoPersonaService/ModificarBancoIdNombreYNumero → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CuentaBancoPersonaService/ModificarBancoIdNombreYNumero → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "El servicio externo rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Modificó la Cuenta de Banco a "${numeroTrim}" (${bancoNombreTrim})`,
            referencia: Id
        });

        return res.status(200).json({ Message: "Cuenta de Banco modificada con éxito" });

    } catch (error) {
        console.error("Error en modificarCuentaBancoNumero:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/modificarCuentaBancoTipoPersonaDestino', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, TipoPersonaDestinoKey, ModifiedBy } = req.body;
        const tipoPersonaDestino = TIPO_PERSONA_DESTINO_CUENTA_BANCO[TipoPersonaDestinoKey];

        if (!Id) {
            return res.status(400).json({ Message: "La Cuenta de Banco es requerida." });
        }
        if (!tipoPersonaDestino) {
            return res.status(400).json({ Message: "Debe indicar si es Proveedor o Cliente." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CuentaBancoPersonaService/ModificarTipoPersonaDestino", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, ModifiedBy, TipoPersonaDestino: tipoPersonaDestino.valorModificar })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CuentaBancoPersonaService/ModificarTipoPersonaDestino → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CuentaBancoPersonaService/ModificarTipoPersonaDestino → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "El servicio externo rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: `Modificó el Tipo Persona Destino de la Cuenta de Banco a "${tipoPersonaDestino.label}"`,
            referencia: Id
        });

        return res.status(200).json({ Message: "Tipo Persona Destino modificado con éxito" });

    } catch (error) {
        console.error("Error en modificarCuentaBancoTipoPersonaDestino:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/eliminarCuentaBancoPersona', requirePermission('cfo', 'crearProveedorCliente'), async (req, res) => {
    try {
        const { Id, ModifiedBy } = req.body;

        if (!Id) {
            return res.status(400).json({ Message: "La Cuenta de Banco es requerida." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CuentaBancoPersonaService/Delete", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, ModifiedBy })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CuentaBancoPersonaService/Delete → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CuentaBancoPersonaService/Delete → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "El servicio externo rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearProveedorCliente",
            moduloLabel: "Crear Proveedor / Cliente",
            accion: "Eliminó una Cuenta de Banco",
            referencia: Id
        });

        return res.status(200).json({ Message: "Cuenta de Banco eliminada con éxito" });

    } catch (error) {
        console.error("Error en eliminarCuentaBancoPersona:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// --- Eliminar y Modificar Línea Material (CfoNetCore: LineaMaterialFlat / LineaMaterialVariable) ---
// Ambas cuelgan de SalesOrderDetalle → SalesOrder, así que sin una SalesOrder ya creada para la
// Referencia Operativa no hay nada que buscar (el usuario debe validar primero en la Matriz de
// Acción y en Habilitar SalesOrder).

const MONEDAS_LINEA_MATERIAL = { 340: "Lempiras (HNL)", 840: "Dólares (USD)", 558: "Córdobas (NIO)", 188: "Colones (CRC)", 320: "Quetzales (GTQ)" };
function monedaLineaMaterialLabel(value) {
    return MONEDAS_LINEA_MATERIAL[value] || (value != null ? String(value) : "—");
}

// Material Fijo y Material Variable son la misma clase de comando en la API externa
// (SalesOrderService+UpdateLineaMaterialFlat/Variable+Command: Id, Valor, Costo, Currency_Value,
// Observacion, ModifiedBy, IsSoftDeleted) — eliminar es la misma llamada que modificar, solo que
// con IsSoftDeleted:true, confirmado en el swagger de cfows.
const TIPOS_LINEA_MATERIAL = {
    fijo: { url: "https://cfows.azurewebsites.net/api/SalesOrder/UpdateLineaMaterialFlat", label: "Material Fijo" },
    variable: { url: "https://cfows.azurewebsites.net/api/SalesOrder/UpdateLineaMaterialVariable", label: "Material Variable" },
};

// Variante "List" de los mismos dos comandos: un solo ModifiedBy/Observacion compartido para
// todo el lote, más un arreglo con un {Id, IsSoftDeleted} por cada Línea — permite eliminar
// varias de una sola llamada en vez de una por una.
const TIPOS_LINEA_MATERIAL_LOTE = {
    fijo: { url: "https://cfows.azurewebsites.net/api/SalesOrder/UpdateLineaMaterialFlatList", label: "Material Fijo" },
    variable: { url: "https://cfows.azurewebsites.net/api/SalesOrder/UpdateLineaMaterialVariableList", label: "Material Variable" },
};

app.post('/lineasMaterialPorReferencia', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { referencia } = req.body;
        const referenciaTrim = (referencia || "").trim();
        if (!referenciaTrim) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const so = await pool.request()
            .input('referencia', sql.VarChar, referenciaTrim)
            .query(`SELECT [Id], [Status_Value] FROM [dbo].[SalesOrder] WHERE [ReferenciaOperativa] = @referencia AND [IsSoftDeleted] = 0`);

        if (so.recordset.length === 0) {
            return res.status(404).json({
                Message: "No existe una SalesOrder creada para esta Referencia Operativa. Valide primero en la Matriz de Acción y en Habilitar SalesOrder.",
                NoExisteSalesOrder: true
            });
        }
        const salesOrderId = so.recordset[0].Id;

        const fijos = await pool.request()
            .input('soId', sql.UniqueIdentifier, salesOrderId)
            .query(`
                SELECT LMF.[Id], LMF.[Descripcion], LMF.[MaterialErp], LMF.[Valor], LMF.[Costo], LMF.[Currency_Value], LMF.[Observacion], LMF.[CreatedDate]
                FROM [dbo].[LineaMaterialFlat] LMF
                JOIN [dbo].[SalesOrderDetalle] SD ON SD.[Id] = LMF.[SalesOrderDetalleId]
                WHERE SD.[SalesOrderId] = @soId AND LMF.[IsSoftDeleted] = 0
                ORDER BY LMF.[Descripcion] ASC
            `);

        const variables = await pool.request()
            .input('soId', sql.UniqueIdentifier, salesOrderId)
            .query(`
                SELECT LV.[Id], LV.[Descripcion], LV.[MaterialErp], LV.[Valor], LV.[Costo], LV.[Currency_Value], LV.[Observacion], LV.[CreatedDate]
                FROM [dbo].[LineaMaterialVariable] LV
                JOIN [dbo].[SalesOrderDetalle] SD ON SD.[Id] = LV.[SalesOrderDetalleId]
                WHERE SD.[SalesOrderId] = @soId AND LV.[IsSoftDeleted] = 0
                ORDER BY LV.[Descripcion] ASC
            `);

        const conMoneda = (filas) => filas.map((f) => ({ ...f, MonedaLabel: monedaLineaMaterialLabel(f.Currency_Value) }));

        return res.json({
            SalesOrderId: salesOrderId,
            StatusValue: so.recordset[0].Status_Value,
            MaterialesFijos: conMoneda(fijos.recordset),
            MaterialesVariables: conMoneda(variables.recordset),
        });

    } catch (error) {
        console.error("Error en lineasMaterialPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener Líneas de Material", Error: error.message });
    }
});

// Materiales Fijos/Variables que SÍ están configurados en la negociación (Componente) de esta
// Referencia Operativa, pero que no necesariamente están agregados todavía como Línea de
// Material del SalesOrder — son los candidatos que se pueden agregar con /agregarLineaMaterial.
// Solo se puede agregar un material si su MaterialFlatSegmento/MaterialVariableSegmento existe
// en la negociación; por eso se resuelven aparte del listado de líneas ya creadas.
app.post('/materialesDisponiblesPorReferencia', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { referencia } = req.body;
        const referenciaTrim = (referencia || "").trim();
        if (!referenciaTrim) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);

        // Mismo primer paso que /cuadrillaPorReferencia: resolver el Componente (y su Segmento,
        // el "Segmentos[0].Id" que exige AddLineaMaterial) de la negociación de esta referencia.
        const base = await pool.request()
            .input('referencia', sql.VarChar, referenciaTrim)
            .query(`
                SELECT TOP 1 SO.[Id] AS SalesOrderId, C.[Id] AS ComponenteId, C.[SegmentoId], C.[Descripcion] AS ComponenteDescripcion
                FROM [dbo].[SalesOrderDetalle] SD
                LEFT JOIN [dbo].[SalesOrder] SO ON SO.[Id] = SD.[SalesOrderId]
                LEFT JOIN [dbo].[Componente] C ON C.[Id] = SD.[ComponenteId]
                WHERE SO.[ReferenciaOperativa] = @referencia AND SO.[IsSoftDeleted] = 0
            `);

        const fila = base.recordset[0];
        if (!fila || !fila.ComponenteId) {
            return res.status(404).json({
                Message: "No existe una SalesOrder creada para esta Referencia Operativa. Valide primero en la Matriz de Acción y en Habilitar SalesOrder.",
                NoExisteSalesOrder: true
            });
        }

        const variables = await pool.request()
            .input('cid', sql.UniqueIdentifier, fila.ComponenteId)
            .input('soId', sql.UniqueIdentifier, fila.SalesOrderId)
            .query(`
                SELECT
                    MVV.[Id] AS MaterialVariableValorId,
                    MS.[Id] AS MaterialVariableSegmentoId,
                    MVV.[Valor],
                    MVV.[Costo],
                    MS.[CodigoErp],
                    MF.[Descripcion] AS NombreMaterial,
                    MS.[Currency_Value],
                    CASE WHEN EXISTS (
                        SELECT 1 FROM [dbo].[LineaMaterialVariable] LV
                        JOIN [dbo].[SalesOrderDetalle] SD2 ON SD2.[Id] = LV.[SalesOrderDetalleId]
                        WHERE SD2.[SalesOrderId] = @soId AND LV.[MaterialVariableValorId] = MVV.[Id] AND LV.[IsSoftDeleted] = 0
                    ) THEN 1 ELSE 0 END AS YaAgregado
                FROM [dbo].[MaterialVariableValor] MVV
                JOIN [dbo].[MaterialVariableSegmento] MS ON MS.[Id] = MVV.[MaterialVariableSegmentoId]
                JOIN [dbo].[MaterialVariable] MF ON MF.[Id] = MS.[MaterialVariableId]
                WHERE MVV.[ComponenteId] = @cid AND MVV.[IsSoftDeleted] = 0
                ORDER BY MF.[Descripcion] ASC
            `);

        const fijos = await pool.request()
            .input('cid', sql.UniqueIdentifier, fila.ComponenteId)
            .input('soId', sql.UniqueIdentifier, fila.SalesOrderId)
            .query(`
                SELECT
                    MFV.[Id] AS MaterialFlatValorId,
                    MS.[Id] AS MaterialFlatSegmentoId,
                    MFV.[Valor],
                    MFV.[Costo],
                    MS.[CodigoErp],
                    MF.[Descripcion] AS NombreMaterial,
                    MS.[Currency_Value],
                    CASE WHEN EXISTS (
                        SELECT 1 FROM [dbo].[LineaMaterialFlat] LF
                        JOIN [dbo].[SalesOrderDetalle] SD2 ON SD2.[Id] = LF.[SalesOrderDetalleId]
                        WHERE SD2.[SalesOrderId] = @soId AND LF.[MaterialFlatValorId] = MFV.[Id] AND LF.[IsSoftDeleted] = 0
                    ) THEN 1 ELSE 0 END AS YaAgregado
                FROM [dbo].[MaterialFlatValor] MFV
                JOIN [dbo].[MaterialFlatSegmento] MS ON MS.[Id] = MFV.[MaterialFlatSegmentoId]
                JOIN [dbo].[MaterialFlat] MF ON MF.[Id] = MS.[MaterialFlatId]
                WHERE MFV.[ComponenteId] = @cid AND MFV.[IsSoftDeleted] = 0
                ORDER BY MF.[Descripcion] ASC
            `);

        const conMoneda = (filas) => filas.map((f) => ({ ...f, MonedaLabel: monedaLineaMaterialLabel(f.Currency_Value), YaAgregado: !!f.YaAgregado }));

        return res.json({
            SalesOrderId: fila.SalesOrderId,
            SegmentoId: fila.SegmentoId,
            ComponenteDescripcion: fila.ComponenteDescripcion,
            MaterialesFijosDisponibles: conMoneda(fijos.recordset),
            MaterialesVariablesDisponibles: conMoneda(variables.recordset),
        });

    } catch (error) {
        console.error("Error en materialesDisponiblesPorReferencia:", error);
        return res.status(500).json({ Message: "Error al obtener materiales disponibles", Error: error.message });
    }
});

app.post('/agregarLineaMaterial', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { ReferenciaOperativa, SegmentoId, MaterialFlatSegmentoIds, MaterialVariableSegmentoIds, CreatedBy } = req.body;
        const referenciaTrim = (ReferenciaOperativa || "").trim();
        const flatIds = Array.isArray(MaterialFlatSegmentoIds) ? MaterialFlatSegmentoIds.filter(Boolean) : [];
        const variableIds = Array.isArray(MaterialVariableSegmentoIds) ? MaterialVariableSegmentoIds.filter(Boolean) : [];

        if (!referenciaTrim) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }
        if (!SegmentoId) {
            return res.status(400).json({ Message: "Falta el Segmento de la negociación (vuelva a buscar la Referencia Operativa)." });
        }
        if (flatIds.length === 0 && variableIds.length === 0) {
            return res.status(400).json({ Message: "Debe seleccionar al menos un material para agregar." });
        }
        if (!CreatedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });
        }

        // Un mismo Segmento puede llevar materiales Fijos y Variables mezclados en la misma
        // llamada (confirmado en el swagger de cfows: CommandSegmento acepta ambos arreglos).
        const segmento = { Id: SegmentoId };
        if (flatIds.length > 0) segmento.MaterialFlatSegmentoIds = flatIds;
        if (variableIds.length > 0) segmento.MaterialVariableSegmentos = variableIds.map((id) => ({ Id: id, Parametro: 1 }));

        const body = {
            ReferenciaOperativa: referenciaTrim,
            Tipo: 1,
            CreatedBy,
            Segmentos: [segmento]
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/SalesOrder/AddLineaMaterial", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`SalesOrder/AddLineaMaterial → HTTP ${resp.status} para ${referenciaTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`SalesOrder/AddLineaMaterial → ${referenciaTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "eliminarModificarLineaMaterial",
            moduloLabel: "Eliminar y Modificar Línea Material",
            accion: `Agregó ${flatIds.length + variableIds.length} material(es) (${flatIds.length} fijo(s), ${variableIds.length} variable(s))`,
            referencia: referenciaTrim
        });

        return res.status(200).json({ Message: "Material(es) agregado(s) con éxito", Data: data });

    } catch (error) {
        console.error("Error en agregarLineaMaterial:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/modificarLineaMaterial', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { Tipo, Id, Valor, Costo, MonedaValue, ModifiedBy, Observacion } = req.body;
        const tipo = TIPOS_LINEA_MATERIAL[Tipo];

        if (!tipo) {
            return res.status(400).json({ Message: "Tipo de Línea de Material inválido." });
        }
        if (!Id) {
            return res.status(400).json({ Message: "La Línea de Material es requerida." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar la observación (motivo del cambio)." });
        }

        const body = { Id, ModifiedBy, Observacion: Observacion.trim(), IsSoftDeleted: false };
        if (Valor !== undefined && Valor !== null && Valor !== "") body.Valor = Number(Valor);
        if (Costo !== undefined && Costo !== null && Costo !== "") body.Costo = Number(Costo);
        if (MonedaValue !== undefined && MonedaValue !== null && MonedaValue !== "") body.Currency_Value = Number(MonedaValue);

        const resp = await fetch(tipo.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`${tipo.url} (modificar) → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${tipo.url} (modificar) → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "eliminarModificarLineaMaterial",
            moduloLabel: "Eliminar y Modificar Línea Material",
            accion: `Modificó ${tipo.label}`,
            referencia: Id,
            motivo: Observacion
        });

        return res.status(200).json({ Message: `${tipo.label} modificado con éxito`, Data: data });

    } catch (error) {
        console.error("Error en modificarLineaMaterial:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

app.post('/eliminarLineaMaterial', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { Tipo, Id, ModifiedBy, Observacion } = req.body;
        const tipo = TIPOS_LINEA_MATERIAL[Tipo];

        if (!tipo) {
            return res.status(400).json({ Message: "Tipo de Línea de Material inválido." });
        }
        if (!Id) {
            return res.status(400).json({ Message: "La Línea de Material es requerida." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar la observación (motivo de la eliminación)." });
        }

        const resp = await fetch(tipo.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ Id, ModifiedBy, Observacion: Observacion.trim(), IsSoftDeleted: true })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`${tipo.url} (eliminar) → HTTP ${resp.status} para ${Id}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${tipo.url} (eliminar) → ${Id}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "eliminarModificarLineaMaterial",
            moduloLabel: "Eliminar y Modificar Línea Material",
            accion: `Eliminó ${tipo.label}`,
            referencia: Id,
            motivo: Observacion
        });

        return res.status(200).json({ Message: `${tipo.label} eliminado con éxito`, Data: data });

    } catch (error) {
        console.error("Error en eliminarLineaMaterial:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Elimina varias Líneas de Material del mismo tipo (todas Fijas o todas Variables) de una sola
// vez, con un único motivo compartido para todo el lote.
app.post('/eliminarLineasMaterial', requirePermission('cfo', 'eliminarModificarLineaMaterial'), async (req, res) => {
    try {
        const { Tipo, Ids, ModifiedBy, Observacion } = req.body;
        const tipo = TIPOS_LINEA_MATERIAL_LOTE[Tipo];
        const idsLista = Array.isArray(Ids) ? Ids.filter(Boolean) : [];

        if (!tipo) {
            return res.status(400).json({ Message: "Tipo de Línea de Material inválido." });
        }
        if (idsLista.length === 0) {
            return res.status(400).json({ Message: "Debe seleccionar al menos una Línea de Material." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar la observación (motivo de la eliminación)." });
        }

        const body = {
            ModifiedBy,
            Observacion: Observacion.trim(),
            List: idsLista.map((id) => ({ Id: id, IsSoftDeleted: true }))
        };

        const resp = await fetch(tipo.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`${tipo.url} (eliminar lote) → HTTP ${resp.status} para ${idsLista.length} líneas:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${tipo.url} (eliminar lote) → ${idsLista.length} líneas:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "eliminarModificarLineaMaterial",
            moduloLabel: "Eliminar y Modificar Línea Material",
            accion: `Eliminó ${idsLista.length} ${tipo.label}(s) en lote`,
            referencia: idsLista.join(", "),
            motivo: Observacion
        });

        return res.status(200).json({ Message: `${idsLista.length} ${tipo.label}(s) eliminado(s) con éxito`, Data: data });

    } catch (error) {
        console.error("Error en eliminarLineasMaterial:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// --- Crear Documentos (después de Facturación): Provisionales / Fiscales / Internos ---
// Un solo módulo con varias secciones, construidas una a la vez. Esta primera parte es
// Documentos Provisionales (api/DocumentoProvisional/CreateMany).

// Por ahora estos documentos solo se manejan para Honduras y Guatemala (División confirmada
// como "9095" para ambas); el resto de países se habilita cuando el negocio confirme su
// propia División — no se debe adivinar ese valor, causaría un documento mal enrutado.
const PAISES_DOCUMENTO_POST_FACTURACION = {
    honduras: { paisId: PAISES_PROVEEDOR_CLIENTE.honduras.id, tenantId: TENANTS_PROVEEDOR_CFO.honduras.id, division: "9095", label: "Honduras" },
    guatemala: { paisId: PAISES_PROVEEDOR_CLIENTE.guatemala.id, tenantId: TENANTS_PROVEEDOR_CFO.guatemala.id, division: "9095", label: "Guatemala" },
};

const MONEDAS_DOCUMENTO_POST_FACTURACION = { 340: "Lempiras (HNL)", 840: "Dólares (USD)", 558: "Córdobas (NIO)", 188: "Colones (CRC)", 320: "Quetzales (GTQ)" };

const DUENOS_DOCUMENTO = { 1: "Vesta", 2: "Cliente" };

app.post('/docProvisionalBuscarProveedores', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const nombreTrim = (req.body.nombre || "").trim();
        if (!nombreTrim) {
            return res.status(400).json({ Message: "Ingrese un nombre para buscar." });
        }
        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request()
            .input('nombre', sql.VarChar, `%${nombreTrim}%`)
            .query(`
                SELECT TOP 15 Id AS PersonaId, Nombre, IdFiscal
                FROM [dbo].[Persona]
                WHERE Discriminator = 'PersonaJuridicaProveedor'
                  AND IsSoftDeleted = 0
                  AND Nombre LIKE @nombre
                ORDER BY Nombre
            `);
        return res.json(resultado.recordset);
    } catch (error) {
        console.error("Error en docProvisionalBuscarProveedores:", error);
        return res.status(500).json({ Message: "Error al buscar Proveedores", Error: error.message });
    }
});

// Resuelve el Cliente (dbo.Cliente en CFO) de una Referencia Operativa: primero se busca en
// HojaDeRuta (su ClienteId ahí ES directamente el PersonaId real — confirmado contra datos
// reales, no hace falta cruzar por nombre) y luego se busca la fila de CFO para ese
// PersonaId + el Tenant del País elegido (el Id propio de dbo.Cliente NO es igual al
// PersonaId de forma confiable, se probó contra la tabla real: solo coincide en un % de
// los casos, así que siempre hay que resolverlo con esta consulta).
async function resolverClienteCfoPorReferencia(referencia, tenantId) {
    const poolHr = await conexion(BasesDeDatos.HojaDeRuta);
    const hr = await poolHr.request()
        .input('referencia', sql.VarChar, referencia)
        .query(`SELECT TOP 1 ClienteId, ClienteDescripcion FROM HojaRuta WHERE NumeroHojaRuta = @referencia`);
    const filaHr = hr.recordset[0];
    if (!filaHr || !filaHr.ClienteId) {
        return { error: "No existe Hoja de Ruta para esta Referencia Operativa.", NoExisteHojaRuta: true };
    }
    const poolCfo = await conexion(BasesDeDatos.CfoNetCore);
    const cliente = await poolCfo.request()
        .input('personaId', sql.UniqueIdentifier, filaHr.ClienteId)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`SELECT TOP 1 Id FROM [dbo].[Cliente] WHERE PersonaId = @personaId AND TenantId = @tenantId AND IsSoftDeleted = 0`);
    if (!cliente.recordset[0]) {
        return {
            error: `El Cliente "${filaHr.ClienteDescripcion}" no está creado en CFO para este País. Créelo primero en Crear Proveedor/Cliente.`,
            NoExisteClienteCfo: true,
            ClienteDescripcion: filaHr.ClienteDescripcion
        };
    }
    return { ClienteId: cliente.recordset[0].Id, ClienteDescripcion: filaHr.ClienteDescripcion };
}

app.post('/docProvisionalClientePorReferencia', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const { referencia, paisKey } = req.body;
        const referenciaTrim = (referencia || "").trim();
        const pais = PAISES_DOCUMENTO_POST_FACTURACION[paisKey];
        if (!referenciaTrim) {
            return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Seleccione un País válido." });
        }
        const resultado = await resolverClienteCfoPorReferencia(referenciaTrim, pais.tenantId);
        if (resultado.error) {
            return res.status(404).json(resultado);
        }
        return res.json(resultado);
    } catch (error) {
        console.error("Error en docProvisionalClientePorReferencia:", error);
        return res.status(500).json({ Message: "Error al resolver el Cliente de la Referencia Operativa", Error: error.message });
    }
});

// Resuelve el Proveedor (dbo.Proveedor en CFO) de una Persona + Tenant (mismo motivo que
// resolverClienteCfoPorReferencia: el Id de dbo.Proveedor no es igual al PersonaId de forma
// confiable), y trae la lista de Materiales que ese Proveedor ya tiene agregados en CFO.
async function resolverProveedorCfoPorPersona(proveedorPersonaId, tenantId) {
    const poolCfo = await conexion(BasesDeDatos.CfoNetCore);
    const proveedor = await poolCfo.request()
        .input('personaId', sql.UniqueIdentifier, proveedorPersonaId)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`SELECT TOP 1 Id FROM [dbo].[Proveedor] WHERE PersonaId = @personaId AND TenantId = @tenantId AND IsSoftDeleted = 0`);
    const filaProveedor = proveedor.recordset[0];
    if (!filaProveedor) {
        return { error: "Este Proveedor no está creado en CFO para el País seleccionado. Créelo primero en Crear Proveedor/Cliente.", NoExisteProveedorCfo: true };
    }
    const materiales = await poolCfo.request()
        .input('proveedorId', sql.UniqueIdentifier, filaProveedor.Id)
        .query(`
            SELECT Id, Descripcion, CodigoMaterial
            FROM [dbo].[MaterialProveedor]
            WHERE ProveedorId = @proveedorId AND IsSoftDeleted = 0
            ORDER BY Descripcion
        `);
    return { ProveedorId: filaProveedor.Id, Materiales: materiales.recordset };
}

app.post('/docProvisionalProveedorEnCfo', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const { proveedorPersonaId, paisKey } = req.body;
        const pais = PAISES_DOCUMENTO_POST_FACTURACION[paisKey];
        if (!proveedorPersonaId) {
            return res.status(400).json({ Message: "Seleccione un Proveedor." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Seleccione un País válido." });
        }
        const resultado = await resolverProveedorCfoPorPersona(proveedorPersonaId, pais.tenantId);
        if (resultado.error) {
            return res.status(404).json(resultado);
        }
        return res.json(resultado);
    } catch (error) {
        console.error("Error en docProvisionalProveedorEnCfo:", error);
        return res.status(500).json({ Message: "Error al resolver el Proveedor en CFO", Error: error.message });
    }
});

app.post('/crearDocumentoProvisionalPostFacturacion', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const {
            ReferenciaOperativa, PaisKey, Moneda, Observacion, DuenoDocumento,
            ProveedorPersonaId, MaterialProveedorId, Cantidad, PrecioVenta, Impuesto, CreatedBy
        } = req.body;

        const referenciaTrim = (ReferenciaOperativa || "").trim();
        const observacionTrim = (Observacion || "").trim();
        const pais = PAISES_DOCUMENTO_POST_FACTURACION[PaisKey];
        const cantidadNum = Number(Cantidad);
        const precioVentaNum = Number(PrecioVenta);
        const impuestoNum = Number(Impuesto);

        if (!referenciaTrim) return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        if (!pais) return res.status(400).json({ Message: "Seleccione un País válido." });
        if (!MONEDAS_DOCUMENTO_POST_FACTURACION[Moneda]) return res.status(400).json({ Message: "Seleccione una Moneda válida." });
        if (!observacionTrim) return res.status(400).json({ Message: "La Observación es requerida." });
        if (!DUENOS_DOCUMENTO[DuenoDocumento]) return res.status(400).json({ Message: "Seleccione el Dueño del Documento." });
        if (!ProveedorPersonaId) return res.status(400).json({ Message: "Seleccione un Proveedor." });
        if (!MaterialProveedorId) return res.status(400).json({ Message: "Seleccione un Material." });
        if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
            return res.status(400).json({ Message: "La Cantidad debe ser un número entero entre 1 y 10." });
        }
        if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) return res.status(400).json({ Message: "El Precio de Venta debe ser un número válido." });
        if (!Number.isFinite(impuestoNum) || impuestoNum < 0) return res.status(400).json({ Message: "El Impuesto debe ser un número válido." });
        if (!CreatedBy) return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });

        // Se vuelve a resolver Cliente y Proveedor (no se confía en lo que ya se resolvió en
        // pantalla) por si algo cambió entre que se buscó y que se dio "Crear".
        const [datosCliente, datosProveedor] = await Promise.all([
            resolverClienteCfoPorReferencia(referenciaTrim, pais.tenantId),
            resolverProveedorCfoPorPersona(ProveedorPersonaId, pais.tenantId)
        ]);
        if (datosCliente.error) return res.status(404).json(datosCliente);
        if (datosProveedor.error) return res.status(404).json(datosProveedor);

        const materialValido = datosProveedor.Materiales.some((m) => String(m.Id).toUpperCase() === String(MaterialProveedorId).toUpperCase());
        if (!materialValido) {
            return res.status(400).json({ Message: "El Material seleccionado no pertenece a este Proveedor. Vuelva a seleccionarlo." });
        }

        const total = Math.round((precioVentaNum + impuestoNum) * 100) / 100;

        const resp = await fetch("https://cfows.azurewebsites.net/api/DocumentoProvisional/CreateMany", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                DocumentoProvisionales: [{
                    ReferenciaOperativa: referenciaTrim,
                    Moneda: Number(Moneda),
                    Observacion: observacionTrim,
                    PaisId: pais.paisId,
                    DueñoDocumento: Number(DuenoDocumento),
                    Division: pais.division,
                    ProveedorId: datosProveedor.ProveedorId,
                    ClienteId: datosCliente.ClienteId,
                    CreatedBy,
                    DocumentoProvisionalDetalles: [{
                        Cantidad: cantidadNum,
                        PrecioVenta: precioVentaNum,
                        Impuesto: impuestoNum,
                        Total: total,
                        MaterialProveedorId
                    }],
                    TenantId: pais.tenantId
                }],
                ContextoId: pais.tenantId,
                SolicitanteDocumentoId: CreatedBy
            })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`DocumentoProvisional/CreateMany → HTTP ${resp.status} para ${referenciaTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`DocumentoProvisional/CreateMany → ${referenciaTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearDocumentosPostFacturacion",
            moduloLabel: "Crear Documentos (Post Facturación)",
            accion: `Creó Documento Provisional (${pais.label})`,
            referencia: referenciaTrim
        });

        return res.status(200).json({ Message: "Documento Provisional creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearDocumentoProvisionalPostFacturacion:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Segunda parte del módulo: Documentos Fiscales (api/DocumentoFiscal/CreateMany). Mismo
// Cliente/Proveedor/País/Tenant que Provisionales (mismas funciones resolverClienteCfoPorReferencia
// / resolverProveedorCfoPorPersona); lo que cambia es el endpoint externo, el nombre del arreglo
// de detalle (DocumentoFiscalDetalles) y los campos propios de Fiscal: FechaEmision,
// FechaVencimiento y NumeroDocumentoFiscal (obligatorios) y CAI (opcional — no todos los
// documentos fiscales tienen CAI asignado).
app.post('/crearDocumentoFiscalPostFacturacion', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const {
            ReferenciaOperativa, PaisKey, Moneda, Observacion, DuenoDocumento,
            ProveedorPersonaId, MaterialProveedorId, Cantidad, PrecioVenta, Impuesto,
            FechaEmision, FechaVencimiento, CAI, NumeroDocumentoFiscal, CreatedBy
        } = req.body;

        const referenciaTrim = (ReferenciaOperativa || "").trim();
        const observacionTrim = (Observacion || "").trim();
        const caiTrim = (CAI || "").trim();
        const numeroDocumentoFiscalTrim = (NumeroDocumentoFiscal || "").trim();
        const pais = PAISES_DOCUMENTO_POST_FACTURACION[PaisKey];
        const cantidadNum = Number(Cantidad);
        const precioVentaNum = Number(PrecioVenta);
        const impuestoNum = Number(Impuesto);

        if (!referenciaTrim) return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        if (!pais) return res.status(400).json({ Message: "Seleccione un País válido." });
        if (!MONEDAS_DOCUMENTO_POST_FACTURACION[Moneda]) return res.status(400).json({ Message: "Seleccione una Moneda válida." });
        if (!observacionTrim) return res.status(400).json({ Message: "La Observación es requerida." });
        if (!DUENOS_DOCUMENTO[DuenoDocumento]) return res.status(400).json({ Message: "Seleccione el Dueño del Documento." });
        if (!ProveedorPersonaId) return res.status(400).json({ Message: "Seleccione un Proveedor." });
        if (!MaterialProveedorId) return res.status(400).json({ Message: "Seleccione un Material." });
        if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
            return res.status(400).json({ Message: "La Cantidad debe ser un número entero entre 1 y 10." });
        }
        if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) return res.status(400).json({ Message: "El Precio de Venta debe ser un número válido." });
        if (!Number.isFinite(impuestoNum) || impuestoNum < 0) return res.status(400).json({ Message: "El Impuesto debe ser un número válido." });
        if (!FechaEmision) return res.status(400).json({ Message: "La Fecha de Emisión es requerida." });
        if (!FechaVencimiento) return res.status(400).json({ Message: "La Fecha de Vencimiento es requerida." });
        if (!numeroDocumentoFiscalTrim) return res.status(400).json({ Message: "El Número de Documento Fiscal es requerido." });
        if (!CreatedBy) return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });

        // Se vuelve a resolver Cliente y Proveedor (no se confía en lo que ya se resolvió en
        // pantalla) por si algo cambió entre que se buscó y que se dio "Crear".
        const [datosCliente, datosProveedor] = await Promise.all([
            resolverClienteCfoPorReferencia(referenciaTrim, pais.tenantId),
            resolverProveedorCfoPorPersona(ProveedorPersonaId, pais.tenantId)
        ]);
        if (datosCliente.error) return res.status(404).json(datosCliente);
        if (datosProveedor.error) return res.status(404).json(datosProveedor);

        const materialValido = datosProveedor.Materiales.some((m) => String(m.Id).toUpperCase() === String(MaterialProveedorId).toUpperCase());
        if (!materialValido) {
            return res.status(400).json({ Message: "El Material seleccionado no pertenece a este Proveedor. Vuelva a seleccionarlo." });
        }

        const total = Math.round((precioVentaNum + impuestoNum) * 100) / 100;

        const resp = await fetch("https://cfows.azurewebsites.net/api/DocumentoFiscal/CreateMany", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                Documentos: [{
                    ReferenciaOperativa: referenciaTrim,
                    Moneda: Number(Moneda),
                    Observacion: observacionTrim,
                    PaisId: pais.paisId,
                    DueñoDocumento: Number(DuenoDocumento),
                    Division: pais.division,
                    ProveedorId: datosProveedor.ProveedorId,
                    ClienteId: datosCliente.ClienteId,
                    CreatedBy,
                    DocumentoFiscalDetalles: [{
                        Cantidad: cantidadNum,
                        PrecioVenta: precioVentaNum,
                        Impuesto: impuestoNum,
                        Total: total,
                        MaterialProveedorId
                    }],
                    FechaEmision,
                    FechaVencimiento,
                    TenantId: pais.tenantId,
                    CAI: caiTrim || null,
                    NumeroDocumentoFiscal: numeroDocumentoFiscalTrim
                }],
                ContextoId: pais.tenantId,
                SolicitanteDocumentoId: CreatedBy
            })
        });

        // A diferencia de los demás endpoints de este módulo, DocumentoFiscal/CreateMany no usa
        // "IsValid" de forma confiable para indicar éxito/error (se confirmó contra un caso real:
        // devolvió IsValid:false, HTTP 200 y el documento ya creado dentro de "Message" — tratarlo
        // como error habría hecho que el usuario reintentara y duplicara el documento). Tampoco usa
        // el HTTP status de forma confiable para errores de negocio (ej. "No existe cliente" llega
        // como HTTP 400 pero con un body JSON completo). Lo único confiable es "Exception": si viene
        // con contenido, sí falló; si viene null, se creó el documento aunque IsValid diga false.
        const rawBody = await resp.text();
        let data = null;
        try { data = JSON.parse(rawBody); } catch { /* body no es JSON */ }

        console.log(`DocumentoFiscal/CreateMany → ${referenciaTrim}: HTTP ${resp.status}`, rawBody);

        if (!data) {
            console.error(`DocumentoFiscal/CreateMany → respuesta no-JSON para ${referenciaTrim}:`, rawBody);
            return res.status(resp.status || 500).json({ Message: "Error al comunicarse con el servicio externo", Detail: rawBody });
        }

        if (data.Exception) {
            return res.status(400).json({ Message: data.Exception.Message || mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearDocumentosPostFacturacion",
            moduloLabel: "Crear Documentos (Post Facturación)",
            accion: `Creó Documento Fiscal (${pais.label})`,
            referencia: referenciaTrim
        });

        return res.status(200).json({ Message: "Documento Fiscal creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearDocumentoFiscalPostFacturacion:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Tercera parte del módulo: Documentos Internos (api/DocumentoInterno/CreateMany). Mismo
// Cliente/Proveedor/País/Tenant que Provisionales y Fiscales, pero a diferencia de esos dos,
// el contrato de este endpoint NO lleva DueñoDocumento ni Division, y el body tampoco lleva
// SolicitanteDocumentoId a nivel raíz (confirmado contra el JSON de ejemplo real). La
// Observación aquí es un motivo de negocio que escribe el usuario (ej. "proveedor no está
// constituido"), no el nombre del material como en Provisional/Fiscal.
app.post('/crearDocumentoInternoPostFacturacion', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const {
            ReferenciaOperativa, PaisKey, Moneda, Observacion,
            ProveedorPersonaId, MaterialProveedorId, Cantidad, PrecioVenta, Impuesto, CreatedBy
        } = req.body;

        const referenciaTrim = (ReferenciaOperativa || "").trim();
        const observacionTrim = (Observacion || "").trim();
        const pais = PAISES_DOCUMENTO_POST_FACTURACION[PaisKey];
        const cantidadNum = Number(Cantidad);
        const precioVentaNum = Number(PrecioVenta);
        const impuestoNum = Number(Impuesto);

        if (!referenciaTrim) return res.status(400).json({ Message: "La Referencia Operativa es requerida." });
        if (!pais) return res.status(400).json({ Message: "Seleccione un País válido." });
        if (!MONEDAS_DOCUMENTO_POST_FACTURACION[Moneda]) return res.status(400).json({ Message: "Seleccione una Moneda válida." });
        if (!observacionTrim) return res.status(400).json({ Message: "La Observación es requerida." });
        if (!ProveedorPersonaId) return res.status(400).json({ Message: "Seleccione un Proveedor." });
        if (!MaterialProveedorId) return res.status(400).json({ Message: "Seleccione un Material." });
        if (!Number.isInteger(cantidadNum) || cantidadNum < 1 || cantidadNum > 10) {
            return res.status(400).json({ Message: "La Cantidad debe ser un número entero entre 1 y 10." });
        }
        if (!Number.isFinite(precioVentaNum) || precioVentaNum < 0) return res.status(400).json({ Message: "El Precio de Venta debe ser un número válido." });
        if (!Number.isFinite(impuestoNum) || impuestoNum < 0) return res.status(400).json({ Message: "El Impuesto debe ser un número válido." });
        if (!CreatedBy) return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });

        // Se vuelve a resolver Cliente y Proveedor (no se confía en lo que ya se resolvió en
        // pantalla) por si algo cambió entre que se buscó y que se dio "Crear".
        const [datosCliente, datosProveedor] = await Promise.all([
            resolverClienteCfoPorReferencia(referenciaTrim, pais.tenantId),
            resolverProveedorCfoPorPersona(ProveedorPersonaId, pais.tenantId)
        ]);
        if (datosCliente.error) return res.status(404).json(datosCliente);
        if (datosProveedor.error) return res.status(404).json(datosProveedor);

        const materialValido = datosProveedor.Materiales.some((m) => String(m.Id).toUpperCase() === String(MaterialProveedorId).toUpperCase());
        if (!materialValido) {
            return res.status(400).json({ Message: "El Material seleccionado no pertenece a este Proveedor. Vuelva a seleccionarlo." });
        }

        const total = Math.round((precioVentaNum + impuestoNum) * 100) / 100;

        const resp = await fetch("https://cfows.azurewebsites.net/api/DocumentoInterno/CreateMany", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                Documentos: [{
                    ReferenciaOperativa: referenciaTrim,
                    Moneda: Number(Moneda),
                    Observacion: observacionTrim,
                    PaisId: pais.paisId,
                    ProveedorId: datosProveedor.ProveedorId,
                    ClienteId: datosCliente.ClienteId,
                    CreatedBy,
                    TenantId: pais.tenantId,
                    DocumentoDetalles: [{
                        Cantidad: cantidadNum,
                        PrecioVenta: precioVentaNum,
                        Impuesto: impuestoNum,
                        Total: total,
                        MaterialProveedorId
                    }]
                }],
                ContextoId: pais.tenantId
            })
        });

        // Mismo cuidado que en DocumentoFiscal/CreateMany: no confiar en "IsValid" ni en el HTTP
        // status para decidir éxito/error — solo "Exception" es confiable.
        const rawBody = await resp.text();
        let data = null;
        try { data = JSON.parse(rawBody); } catch { /* body no es JSON */ }

        console.log(`DocumentoInterno/CreateMany → ${referenciaTrim}: HTTP ${resp.status}`, rawBody);

        if (!data) {
            console.error(`DocumentoInterno/CreateMany → respuesta no-JSON para ${referenciaTrim}:`, rawBody);
            return res.status(resp.status || 500).json({ Message: "Error al comunicarse con el servicio externo", Detail: rawBody });
        }

        if (data.Exception) {
            return res.status(400).json({ Message: data.Exception.Message || mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearDocumentosPostFacturacion",
            moduloLabel: "Crear Documentos (Post Facturación)",
            accion: `Creó Documento Interno (${pais.label})`,
            referencia: referenciaTrim
        });

        return res.status(200).json({ Message: "Documento Interno creado con éxito", Data: data });

    } catch (error) {
        console.error("Error en crearDocumentoInternoPostFacturacion:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Elimina un Documento (Provisional/Fiscal/Interno) recién creado desde este mismo módulo, sin
// tener que ir al módulo Eliminar Documento — misma llamada externa que usa ese módulo
// (Documento/DCUpdateISDCreated, o el de DocumentoFiscalLiquidacion según Discriminator), pero
// bajo el permiso propio de este módulo, para que "deshacer" no dependa de tener también acceso
// a Eliminar Documento.
app.post('/docProvisionalEliminarCreado', requirePermission('cfo', 'crearDocumentosPostFacturacion'), async (req, res) => {
    try {
        const { DocumentoId, ModifiedBy, Observacion } = req.body;

        if (!DocumentoId) {
            return res.status(400).json({ Message: "El documento es requerido." });
        }
        if (!ModifiedBy) {
            return res.status(400).json({ Message: "El usuario que autoriza (ModifiedBy) es requerido." });
        }
        if (!Observacion || !Observacion.trim()) {
            return res.status(400).json({ Message: "Debe indicar el motivo de la eliminación." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const validacion = await pool.request()
            .input('documentoId', sql.UniqueIdentifier, DocumentoId)
            .query(`
                SELECT [IsSoftDeleted], [Discriminator], [ReferenciaOperativa]
                FROM [dbo].[Documento]
                WHERE [Id] = @documentoId
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró el documento." });
        }

        const { IsSoftDeleted, Discriminator, ReferenciaOperativa: referenciaOperativa } = validacion.recordset[0];

        if (IsSoftDeleted) {
            return res.status(400).json({ Message: "El documento ya fue eliminado." });
        }

        const esFiscalLiquidacion = Discriminator === 'DocumentoFiscalLiquidacion';
        const urlEliminar = esFiscalLiquidacion
            ? "https://cfows.azurewebsites.net/api/DocumentoFiscalLiquidacion/DCUpdateISDCreatedFiscal"
            : "https://cfows.azurewebsites.net/api/Documento/DCUpdateISDCreated";

        const resp = await fetch(urlEliminar, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ Id: DocumentoId, ModifiedBy, Observacion, EnviarCorreo: true })
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`${urlEliminar} → HTTP ${resp.status} para ${DocumentoId}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`${urlEliminar} → ${DocumentoId}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: mensajeDeAzure(data) || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "crearDocumentosPostFacturacion",
            moduloLabel: "Crear Documentos (Post Facturación)",
            accion: "Eliminó Documento recién creado (creado por error)",
            referencia: referenciaOperativa || DocumentoId,
            motivo: Observacion
        });

        return res.status(200).json({ Message: "Documento eliminado con éxito", Data: data });

    } catch (error) {
        console.error("Error en docProvisionalEliminarCreado:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

export default app;