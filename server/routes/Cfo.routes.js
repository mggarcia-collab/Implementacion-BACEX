import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { registrarActividad } from '../database/authDb.js'

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
                SELECT [Status_Value]
                FROM [dbo].[SalesOrder]
                WHERE [ReferenciaOperativa] = @referencia
            `);

        if (validacion.recordset.length === 0) {
            return res.status(404).json({ Message: "No se encontró la Sales Order." });
        }

        const status = validacion.recordset[0].Status_Value;

        // 2. Aplicar regla de negocio (Solo permitir si el Status_Value es 1)
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
        const { referencia, referencias, codigoErp } = req.body;
        const listaReferencias = Array.isArray(referencias)
            ? referencias.map((r) => String(r).trim()).filter(Boolean)
            : (referencia ? [String(referencia).trim()] : []);

        if (listaReferencias.length === 0) {
            return res.status(400).json({ Message: "La referencia operativa es requerida." });
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = listaReferencias.map((valor, i) => {
            const nombre = `ref${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });
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
                WHERE d.ReferenciaOperativa IN (${parametros.join(", ")})
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
// realmente están ligados a algún documento de la(s) Referencia(s) Operativa(s) ingresada(s)
// (mismo filtro base que documentosPorReferencia, sin el filtro de codigoErp).
app.post('/codigosErpPorReferencia', requirePermission('cfo', 'habDoc'), async (req, res) => {
    try {
        const { referencia, referencias } = req.body;
        const listaReferencias = Array.isArray(referencias)
            ? referencias.map((r) => String(r).trim()).filter(Boolean)
            : (referencia ? [String(referencia).trim()] : []);

        if (listaReferencias.length === 0) {
            return res.json([]);
        }

        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const request = pool.request();
        const parametros = listaReferencias.map((valor, i) => {
            const nombre = `ref${i}`;
            request.input(nombre, sql.VarChar, valor);
            return `@${nombre}`;
        });

        const resultado = await request.query(`
            SELECT DISTINCT MT.CodigoErpReembolso AS CodigoErp
            FROM Documento d
            JOIN dbo.DocumentoDetalle DD ON DD.DocumentoId = d.Id
            JOIN dbo.MaterialProveedor MP ON MP.Id = DD.MaterialProveedorId
            JOIN dbo.MaterialTenant MT ON MT.Id = MP.MaterialTenantId
            WHERE d.ReferenciaOperativa IN (${parametros.join(", ")})
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
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.SalesOrder SO
            LEFT JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE REPLACE(SO.ReferenciaOperativa, '-', '') IN (${parametrosSinGuion.join(", ")})
              AND SO.Status_Value = 3

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.Documento D
            LEFT JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE D.ReferenciaOperativa IN (${parametrosResueltos.join(", ")})
              AND D.ReembolsoStatus_Value = 2

            -- Al anular una factura, el Status_Value/ReembolsoStatus_Value del SalesOrder o
            -- Documento cambia, así que las dos consultas de arriba dejan de encontrarla y
            -- desaparecería de los resultados. Esta consulta aparte la vuelve a traer,
            -- buscando directamente RegistroContable ya anulados (IsSoftDeleted = 1) para
            -- la misma referencia, sin importar el estado actual del SalesOrder/Documento.
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.SalesOrder SO
            INNER JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE REPLACE(SO.ReferenciaOperativa, '-', '') IN (${parametrosSinGuion.join(", ")})
              AND RC.IsSoftDeleted = 1

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.Documento D
            INNER JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE D.ReferenciaOperativa IN (${parametrosResueltos.join(", ")})
              AND RC.IsSoftDeleted = 1
        `);

        const facturas = [...(resultado.recordsets[0] || []), ...(resultado.recordsets[1] || []), ...(resultado.recordsets[2] || []), ...(resultado.recordsets[3] || [])]
            .map((f) => ({ ...f, Estado: f.IsSoftDeleted ? "Anulada" : "Habilitada" }));
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
            SELECT 'Fiscal' AS Tipo, SO.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.SalesOrder SO
            INNER JOIN dbo.RegistroContable RC ON RC.Id = SO.RegistroContableId
            WHERE RC.NumeroFacturaSap IN (${parametros.join(", ")})

            SELECT 'Nota de Reembolso' AS Tipo, D.ReferenciaOperativa, RC.NumeroFacturaSap, RC.IsSoftDeleted
            FROM dbo.Documento D
            INNER JOIN dbo.RegistroContable RC ON RC.Id = D.RegistroContableFacturaId
            WHERE RC.NumeroFacturaSap IN (${parametros.join(", ")})
        `);

        const resultados = [...(resultado.recordsets[0] || []), ...(resultado.recordsets[1] || [])]
            .map((f) => ({ ...f, Estado: f.IsSoftDeleted ? "Anulada" : "Habilitada" }));
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

export default app;