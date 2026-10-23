import { Router } from "express";
import { conexion, BasesDeDatos } from '../database/database.js'
import sql from 'mssql'
import { requireAuth, requirePermission } from '../middleware/auth.js'
import { registrarActividad } from '../database/authDb.js'

const app = Router();
app.use(requireAuth);

// Módulo de Caja Chica: solo para usuarios Administrador (requirePermission ya deja pasar a
// cualquier admin sin necesidad de asignarle el permiso "cajaChica" a mano) -- como hoy en día
// los únicos administradores son Marilyn y Kleimer, el módulo queda restringido a ellos dos de
// forma automática, igual que Administración de Usuarios.

// Paso 1: validar si la Persona (solicitante) ya existe en Personas, por Nombre/Apellido o por
// Correo (NombreUsuario) -- mismas dos consultas que ya se usan para esto.
app.post('/cajaChicaBuscarPersona', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const { tipo, texto } = req.body;
        const textoTrim = (texto || "").trim();
        if (!textoTrim) {
            return res.status(400).json({ Message: "Ingrese un valor para buscar." });
        }
        const pool = await conexion(BasesDeDatos.Personas);
        const request = pool.request().input('texto', sql.VarChar, `%${textoTrim}%`);
        const condicion = tipo === 'correo'
            ? '[NombreUsuario] LIKE @texto'
            : '([Nombre] LIKE @texto OR [Apellido] LIKE @texto)';
        const resultado = await request.query(`
            SELECT TOP 20 *
            FROM [dbo].[Persona]
            WHERE ${condicion} AND [IsSoftDeleted] = 0
            ORDER BY [Nombre]
        `);
        return res.json(resultado.recordset);
    } catch (error) {
        console.error("Error en cajaChicaBuscarPersona:", error);
        return res.status(500).json({ Message: "Error al buscar Personas", Error: error.message });
    }
});

// Catálogo de Sitios Vesta (Discriminator = 'SitioVesta', no SitioCliente/SitioProveedor) para
// elegir dónde trabaja el solicitante -- búsqueda en vivo porque son demasiados para un combo fijo.
app.post('/cajaChicaBuscarSitiosVesta', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const textoTrim = (req.body.texto || "").trim();
        const pool = await conexion(BasesDeDatos.Personas);
        const request = pool.request();
        let filtro = '';
        if (textoTrim) {
            request.input('texto', sql.VarChar, `%${textoTrim}%`);
            filtro = 'AND [Nombre] LIKE @texto';
        }
        const resultado = await request.query(`
            SELECT TOP 50 [Id], [Nombre], [Direccion], [CiudadDescripcion]
            FROM [dbo].[Sitio]
            WHERE [Discriminator] = 'SitioVesta' AND [IsSoftDeleted] = 0 ${filtro}
            ORDER BY [Nombre]
        `);
        return res.json(resultado.recordset);
    } catch (error) {
        console.error("Error en cajaChicaBuscarSitiosVesta:", error);
        return res.status(500).json({ Message: "Error al buscar Sitios Vesta", Error: error.message });
    }
});

// Siguiente Código de Empleado disponible -- los códigos reales de RRHH no siguen un patrón
// limpio (se confirmaron duplicados y vacíos en datos reales), así que esto es solo un
// correlativo propio por si no se tiene a mano el código real; el campo queda editable en
// pantalla para poder corregirlo antes de crear. Se limita a códigos de exactamente 5 dígitos
// (el 99% de los reales lo son) porque hay un puñado de valores de 6-8 dígitos claramente
// erróneos (ej. "8401542" repetido en dos personas distintas) que distorsionarían el máximo.
app.post('/cajaChicaSiguienteCodigoEmpleado', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.Personas);
        const resultado = await pool.request().query(`
            SELECT MAX(TRY_CAST([CodigoEmpleado] AS INT)) AS Maximo
            FROM [dbo].[Persona]
            WHERE ISNUMERIC([CodigoEmpleado]) = 1 AND LEN(LTRIM(RTRIM([CodigoEmpleado]))) = 5
        `);
        const siguiente = (resultado.recordset[0]?.Maximo || 0) + 1;
        return res.json({ CodigoEmpleado: String(siguiente) });
    } catch (error) {
        console.error("Error en cajaChicaSiguienteCodigoEmpleado:", error);
        return res.status(500).json({ Message: "Error al calcular el Código de Empleado", Error: error.message });
    }
});

// Valores fijos (por ahora) del JSON de PersonaColaboradorVestaServiceApi/Create -- ninguno de
// estos se muestra en pantalla, según lo indicado.
const CAJA_CHICA_PERSONA_FIJOS = {
    TipoIdFiscalId: "65507ECF-249E-454B-A95A-0061BA0FA2BA",
    TipoIdFiscalDescripcion: "IDENTIDAD",
    GrupoPersonaId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    GrupoPersonaNombre: "Grupo Vesta",
    GrupoOcupacional: "III",
    Nivel: "2",
    Ingles: "NO",
    GO: "III",
    AreaColaboradorId: "A4A61E33-349C-46D4-B8C3-1CE3FA4214C0",
    CategoriaColaboradorId: "735C7235-681F-4452-95B4-1CEBEE1BD95D",
    GrupoOperacionalId: "ACBCF9BF-1FB4-4338-B6D0-1CEBF60C6A33",
    PuestoId: "93A27A80-93E4-44CB-8746-1E8753294D70",
};

app.post('/cajaChicaCrearPersona', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const {
            Nombre, Apellido, IdFiscal, FechaNacimiento, FechaIngreso,
            Cargo, Carrera, SitioVestaId, JefeInmediatoId, NombreUsuario, CodigoEmpleado
        } = req.body;

        const nombreTrim = (Nombre || "").trim();
        const apellidoTrim = (Apellido || "").trim();
        const idFiscalTrim = (IdFiscal || "").trim();
        const cargoTrim = (Cargo || "").trim();
        const carreraTrim = (Carrera || "").trim();
        const nombreUsuarioTrim = (NombreUsuario || "").trim();
        const codigoEmpleadoTrim = (CodigoEmpleado || "").trim();

        if (!nombreTrim) return res.status(400).json({ Message: "El Nombre es requerido." });
        if (!apellidoTrim) return res.status(400).json({ Message: "El Apellido es requerido." });
        if (!idFiscalTrim) return res.status(400).json({ Message: "El Id Fiscal es requerido." });
        if (!FechaNacimiento) return res.status(400).json({ Message: "La Fecha de Nacimiento es requerida." });
        if (!FechaIngreso) return res.status(400).json({ Message: "La Fecha de Ingreso es requerida." });
        if (!cargoTrim) return res.status(400).json({ Message: "El Cargo es requerido." });
        if (!carreraTrim) return res.status(400).json({ Message: "La Carrera es requerida." });
        if (!SitioVestaId) return res.status(400).json({ Message: "Seleccione el Sitio Vesta." });
        if (!JefeInmediatoId) return res.status(400).json({ Message: "Seleccione el Jefe Inmediato." });
        if (!nombreUsuarioTrim) return res.status(400).json({ Message: "El correo (Nombre de Usuario) es requerido." });

        const body = {
            Nombre: nombreTrim,
            IdFiscal: idFiscalTrim,
            ...CAJA_CHICA_PERSONA_FIJOS,
            Apellido: apellidoTrim,
            FechaNacimiento,
            FechaIngreso,
            NombreUsuario: nombreUsuarioTrim,
            Cargo: cargoTrim,
            Carrera: carreraTrim,
            SitioVestaId,
            JefeInmediatoId,
            CodigoEmpleado: codigoEmpleadoTrim,
            UsuarioId: nombreUsuarioTrim,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/PersonaColaboradorVestaServiceApi/Create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`PersonaColaboradorVestaServiceApi/Create → HTTP ${resp.status} para ${nombreTrim} ${apellidoTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`PersonaColaboradorVestaServiceApi/Create → ${nombreTrim} ${apellidoTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: data?.Message || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "cajaChica",
            moduloLabel: "Caja Chica",
            accion: `Creó la Persona "${nombreTrim} ${apellidoTrim}" en Personas`,
            referencia: nombreUsuarioTrim
        });

        return res.status(200).json({ Message: "Persona creada con éxito", Data: data });

    } catch (error) {
        console.error("Error en cajaChicaCrearPersona:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Paso 2: verificar si la Persona (la que creamos o ya existía) tiene un Código ERP vinculado.
// La tabla [dbo].[CodigoErp] es compartida entre varios tipos de entidad (Cliente, Proveedor,
// Agente, Vesta, y Persona física -- diferenciados por Discriminator), y cada tipo usa una
// columna de FK distinta. Para colaboradores (personas naturales, como los de Caja Chica) el
// vínculo real vive en PersonaProveedorId con Discriminator='CodigoErpPersonaProveedor' --
// confirmado contra datos reales que PersonaJuridicaProveedorId es para personas jurídicas
// (empresas) y casi nunca aplica a un colaborador (solo 1 caso aislado, parece un error de
// captura) -- por eso se revisan ambas columnas para no perder ningún caso.
app.post('/cajaChicaVerificarCodigoErp', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const { personaId } = req.body;
        if (!personaId) {
            return res.status(400).json({ Message: "Indique la Persona a verificar." });
        }
        const pool = await conexion(BasesDeDatos.Personas);

        const resultadoPersona = await pool.request()
            .input('personaId', sql.UniqueIdentifier, personaId)
            .query(`SELECT [CodigoErp] FROM [dbo].[Persona] WHERE [Id] = @personaId`);
        const codigoErpPersona = resultadoPersona.recordset[0]?.CodigoErp || null;

        const resultadoVinculos = await pool.request()
            .input('personaId', sql.UniqueIdentifier, personaId)
            .query(`
                SELECT [Id], [Codigo], [Sociedad], [Pais], [SistemaDescripcion], [Discriminator]
                FROM [dbo].[CodigoErp]
                WHERE (PersonaProveedorId = @personaId OR PersonaJuridicaProveedorId = @personaId)
                    AND [IsSoftDeleted] = 0
            `);

        return res.json({
            CodigoErpPersona: codigoErpPersona,
            VinculosErp: resultadoVinculos.recordset
        });
    } catch (error) {
        console.error("Error en cajaChicaVerificarCodigoErp:", error);
        return res.status(500).json({ Message: "Error al verificar el Código ERP", Error: error.message });
    }
});

// Verifica si un Código ERP candidato ya está en uso por OTRA Persona, Cliente, Proveedor,
// Agente, etc. -- revisa tanto el campo directo [dbo].[Persona].[CodigoErp] como la tabla
// compartida [dbo].[CodigoErp] (resolviendo a qué Persona pertenece vía COALESCE de todas sus
// columnas de FK posibles, ya que cada Discriminator usa una distinta).
app.post('/cajaChicaVerificarCodigoErpDisponible', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const { codigo, personaIdActual } = req.body;
        const codigoTrim = (codigo || "").trim();
        if (!codigoTrim) {
            return res.status(400).json({ Message: "Indique el Código ERP a verificar." });
        }
        const pool = await conexion(BasesDeDatos.Personas);

        const requestPersona = pool.request().input('codigo', sql.VarChar, codigoTrim);
        let filtroPersona = '';
        if (personaIdActual) {
            requestPersona.input('personaIdActual', sql.UniqueIdentifier, personaIdActual);
            filtroPersona = 'AND [Id] <> @personaIdActual';
        }
        const resultadoPersona = await requestPersona.query(`
            SELECT TOP 5 [Id], [Nombre], [Apellido], [Discriminator]
            FROM [dbo].[Persona]
            WHERE [CodigoErp] = @codigo AND [IsSoftDeleted] = 0 ${filtroPersona}
        `);

        const requestErp = pool.request().input('codigo', sql.VarChar, codigoTrim);
        let filtroErp = '';
        if (personaIdActual) {
            requestErp.input('personaIdActual', sql.UniqueIdentifier, personaIdActual);
            filtroErp = 'AND COALESCE(ce.PersonaProveedorId, ce.PersonaJuridicaProveedorId, ce.PersonaJuridicaClienteId, ce.PersonaJuridicaAgenteId, ce.PersonaJuridicaVestaId) <> @personaIdActual';
        }
        const resultadoErp = await requestErp.query(`
            SELECT TOP 5 ce.[Id], ce.[Discriminator], p.[Nombre], p.[Apellido], p.[Discriminator] AS TipoPersona
            FROM [dbo].[CodigoErp] ce
            LEFT JOIN [dbo].[Persona] p
                ON p.[Id] = COALESCE(ce.PersonaProveedorId, ce.PersonaJuridicaProveedorId, ce.PersonaJuridicaClienteId, ce.PersonaJuridicaAgenteId, ce.PersonaJuridicaVestaId)
            WHERE ce.[Codigo] = @codigo AND ce.[IsSoftDeleted] = 0 ${filtroErp}
        `);

        const conflictos = [
            ...resultadoPersona.recordset.map((p) => ({ Nombre: p.Nombre, Apellido: p.Apellido, Tipo: p.Discriminator })),
            ...resultadoErp.recordset.map((r) => ({ Nombre: r.Nombre, Apellido: r.Apellido, Tipo: r.TipoPersona || r.Discriminator })),
        ];

        return res.json({
            Disponible: conflictos.length === 0,
            Conflictos: conflictos
        });
    } catch (error) {
        console.error("Error en cajaChicaVerificarCodigoErpDisponible:", error);
        return res.status(500).json({ Message: "Error al verificar disponibilidad del Código ERP", Error: error.message });
    }
});

// Mismo catálogo de País/Sociedad que usa Crear Proveedor/Cliente (PAISES_PROVEEDOR_CLIENTE en
// Cfo.routes.js). Ahí el Pais/Sociedad se deriva de Persona.PaisId, pero ese campo casi nunca
// está lleno para colaboradores (personas naturales, confirmado: solo 636 de 9342 lo tienen),
// así que aquí se le pide directamente al usuario.
const PAISES_CAJA_CHICA = {
    honduras: { descripcion: "HONDURAS", sociedad: "9095" },
    elSalvador: { descripcion: "EL SALVADOR", sociedad: "SV01" },
    guatemala: { descripcion: "GUATEMALA", sociedad: "GT01" },
    nicaragua: { descripcion: "NICARAGUA", sociedad: "NI01" },
    costaRica: { descripcion: "COSTA RICA", sociedad: "CR01" },
};

// Mismos valores fijos que CODIGO_ERP_DEFAULTS en Cfo.routes.js (CodigoErpProveedorServiceApi/Create
// no varía entre proveedores jurídicos y personas naturales, solo el campo de FK que se envía).
const CODIGO_ERP_DEFAULTS = {
    SistemaId: "30D1014C-D443-42EE-8015-005FB0D9FA00",
    SistemaDescripcion: "SAP",
    TipoPersonaDestino: "4",
};

// Crea el Código ERP para una Persona natural (colaborador) -- mismo endpoint y forma de JSON
// que /crearCodigoErpProveedor (Cfo.routes.js) usa para proveedores jurídicos, pero enviando
// PersonaProveedorId en vez de PersonaJuridicaProveedorId (ver nota en cajaChicaVerificarCodigoErp
// sobre por qué un colaborador usa esa columna distinta).
app.post('/cajaChicaCrearCodigoErp', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const { PersonaProveedorId, Codigo, PaisKey } = req.body;
        const codigoTrim = (Codigo || "").trim();
        const pais = PAISES_CAJA_CHICA[PaisKey];

        if (!PersonaProveedorId) {
            return res.status(400).json({ Message: "La Persona es requerida." });
        }
        if (!codigoTrim) {
            return res.status(400).json({ Message: "El Código ERP es requerido." });
        }
        if (!pais) {
            return res.status(400).json({ Message: "Debe seleccionar un País/Sociedad válido." });
        }

        const pool = await conexion(BasesDeDatos.Personas);

        // Se revalida justo antes de crear (no confiar únicamente en lo ya verificado en
        // pantalla, por si cambió desde que se mostró disponible).
        const validacion = await pool.request()
            .input('codigo', sql.VarChar, codigoTrim)
            .query(`SELECT TOP 1 [Id] FROM [dbo].[CodigoErp] WHERE [Codigo] = @codigo AND [IsSoftDeleted] = 0`);
        if (validacion.recordset.length > 0) {
            return res.status(400).json({ Message: "Este Código ERP ya está en uso." });
        }

        const body = {
            Codigo: codigoTrim,
            Sociedad: pais.sociedad,
            Pais: pais.descripcion,
            PersonaProveedorId,
            SistemaId: CODIGO_ERP_DEFAULTS.SistemaId,
            SistemaDescripcion: CODIGO_ERP_DEFAULTS.SistemaDescripcion,
            TipoPersonaDestino: CODIGO_ERP_DEFAULTS.TipoPersonaDestino,
        };

        const resp = await fetch("https://personasapi.vesta-accelerate.com/api/CodigoErpProveedorServiceApi/Create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CodigoErpProveedorServiceApi/Create (Caja Chica) → HTTP ${resp.status} para ${codigoTrim}:`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CodigoErpProveedorServiceApi/Create (Caja Chica) → ${codigoTrim}:`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: data?.Message || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "cajaChica",
            moduloLabel: "Caja Chica",
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
        console.error("Error en cajaChicaCrearCodigoErp:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

// Mismos Tenants que TENANTS_PROVEEDOR_CFO en Cfo.routes.js (confirmado: ContextoId en
// CajaChica usa los mismos Ids) -- se duplica aquí solo para resolver el nombre en pantalla.
const PAISES_POR_CONTEXTO_ID = {
    "30D1014C-D443-42EE-8015-005FB0D9FA00": "Honduras",
    "C7194841-BB94-4903-ADD7-0065CC7AF42C": "El Salvador",
    "174E784C-CEDA-4758-A7F5-0063C3454B73": "Guatemala",
    "2B45F90A-6691-4829-BA76-0F7B53790453": "Nicaragua",
    "13A8389D-9064-4A5B-A156-2235B8A2751A": "Costa Rica",
    "8092E57D-03A5-44D3-B271-0F27EBF3D818": "Corporación Dinant",
    "CF884F18-6C35-4703-A48B-21FD0680B2CE": "Dinant Exports",
};

// Mismos valores que MONEDAS_PROVEEDOR_CFO en Cfo.routes.js (códigos ISO 4217 numéricos).
const MONEDAS_POR_VALUE = {
    340: "Lempiras (HNL)",
    840: "Dólares (USD)",
    558: "Córdobas (NIO)",
    188: "Colones (CRC)",
    320: "Quetzales (GTQ)",
};

// Paso 4: verificar si ya existe una Caja Chica creada -- se listan todas las activas (no solo
// las de la Persona en curso) para que el usuario pueda revisarlas y detectar duplicados antes
// de crear una nueva. Solo se exponen las columnas pedidas; [Duenio] ya viene como texto en la
// tabla (no es un Id), pero [CreatedBy] y [SitioId] sí son GUIDs crudos y se resuelven a nombre
// (mismo criterio de "nunca mostrar el Id crudo en pantalla" de los pasos anteriores).
app.post('/cajaChicaListar', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request().query(`
            SELECT cc.[Id], cc.[ContextoId], cc.[CreatedBy], cc.[CreatedDate], cc.[Descripcion],
                   cc.[Duenio], cc.[Fondo], cc.[ModifiedDate], cc.[Saldo], cc.[SitioId], cc.[Moneda_Value],
                   s.[Nombre] AS SitioNombre
            FROM [dbo].[CajaChica] cc
            LEFT JOIN [dbo].[Sitio] s ON s.[Id] = cc.[SitioId]
            WHERE cc.[IsSoftDeleted] = 0
            ORDER BY cc.[Descripcion]
        `);

        // CfoNetCore y Personas son bases separadas (Azure SQL no soporta JOIN entre bases), así
        // que el nombre de quién creó cada Caja Chica se resuelve aparte, en un segundo query.
        const idsCreatedBy = [...new Set(resultado.recordset.map((r) => r.CreatedBy).filter(Boolean))];
        let nombresPorId = {};
        if (idsCreatedBy.length > 0) {
            const poolPersonas = await conexion(BasesDeDatos.Personas);
            const requestPersonas = poolPersonas.request();
            const parametros = idsCreatedBy.map((id, i) => {
                const nombre = `id${i}`;
                requestPersonas.input(nombre, sql.UniqueIdentifier, id);
                return `@${nombre}`;
            });
            const resultadoPersonas = await requestPersonas.query(`
                SELECT [Id], [Nombre], [Apellido] FROM [dbo].[Persona] WHERE [Id] IN (${parametros.join(", ")})
            `);
            nombresPorId = Object.fromEntries(
                resultadoPersonas.recordset.map((p) => [String(p.Id).toUpperCase(), `${p.Nombre || ""} ${p.Apellido || ""}`.trim()])
            );
        }

        const filas = resultado.recordset.map((r) => ({
            Id: r.Id,
            ContextoId: r.ContextoId,
            Pais: PAISES_POR_CONTEXTO_ID[String(r.ContextoId).toUpperCase()] || r.ContextoId,
            CreatedByNombre: nombresPorId[String(r.CreatedBy).toUpperCase()] || null,
            CreatedDate: r.CreatedDate,
            Descripcion: r.Descripcion,
            Duenio: r.Duenio,
            Fondo: r.Fondo,
            ModifiedDate: r.ModifiedDate,
            Saldo: r.Saldo,
            SitioId: r.SitioId,
            Sitio: r.SitioNombre,
            Moneda: MONEDAS_POR_VALUE[r.Moneda_Value] || r.Moneda_Value,
        }));

        return res.json(filas);
    } catch (error) {
        console.error("Error en cajaChicaListar:", error);
        return res.status(500).json({ Message: "Error al listar Cajas Chicas", Error: error.message });
    }
});

// Paso 5 (creación): los 3 catálogos de abajo (Contexto, Sitio, Moneda) se arman a partir de lo
// ya usado en los 30 registros de CajaChica -- no se inventa un catálogo nuevo ni se usa el
// catálogo completo de Sitios/Tenants del sistema, tal como se pidió ("usa los contextos/sitios
// que ya existen entre los registros de Caja Chica").
app.post('/cajaChicaContextosUsados', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request().query(`
            SELECT DISTINCT [ContextoId] FROM [dbo].[CajaChica] WHERE [ContextoId] IS NOT NULL
        `);
        const filas = resultado.recordset.map((r) => ({
            ContextoId: r.ContextoId,
            Pais: PAISES_POR_CONTEXTO_ID[String(r.ContextoId).toUpperCase()] || "Otro (sin nombre registrado)"
        }));
        return res.json(filas);
    } catch (error) {
        console.error("Error en cajaChicaContextosUsados:", error);
        return res.status(500).json({ Message: "Error al listar Contextos", Error: error.message });
    }
});

app.post('/cajaChicaSitiosUsados', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request().query(`
            SELECT DISTINCT cc.[SitioId], s.[Nombre]
            FROM [dbo].[CajaChica] cc
            LEFT JOIN [dbo].[Sitio] s ON s.[Id] = cc.[SitioId]
            WHERE cc.[SitioId] IS NOT NULL
            ORDER BY s.[Nombre]
        `);
        return res.json(resultado.recordset);
    } catch (error) {
        console.error("Error en cajaChicaSitiosUsados:", error);
        return res.status(500).json({ Message: "Error al listar Sitios", Error: error.message });
    }
});

// DisplayName de 3 letras (HNL, USD, etc.) -- mismo formato que ya devuelve Azure en otras
// respuestas (ver comentario en Cfo.routes.js: "Moneda: { Value: 340, DisplayName: 'HNL' }").
const MONEDA_DISPLAY_NAME = {
    340: "HNL",
    840: "USD",
    558: "NIO",
    188: "CRC",
    320: "GTQ",
};

app.post('/cajaChicaMonedasUsadas', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const resultado = await pool.request().query(`
            SELECT DISTINCT [Moneda_Value] FROM [dbo].[CajaChica] WHERE [Moneda_Value] IS NOT NULL AND [Moneda_Value] <> 0
        `);
        const filas = resultado.recordset.map((r) => ({
            Value: r.Moneda_Value,
            DisplayName: MONEDA_DISPLAY_NAME[r.Moneda_Value] || String(r.Moneda_Value)
        }));
        return res.json(filas);
    } catch (error) {
        console.error("Error en cajaChicaMonedasUsadas:", error);
        return res.status(500).json({ Message: "Error al listar Monedas", Error: error.message });
    }
});

app.post('/cajaChicaCrear', requirePermission('cfo', 'cajaChica'), async (req, res) => {
    try {
        const {
            Descripcion, DuenioId, Duenio, MonedaValue, MonedaDisplayName,
            Fondo, ContextoId, SitioId, CreatedBy
        } = req.body;

        const descripcionTrim = (Descripcion || "").trim();
        const duenioTrim = (Duenio || "").trim();
        const fondoNum = Number(Fondo);

        if (!descripcionTrim) return res.status(400).json({ Message: "La Descripción es requerida." });
        if (!DuenioId) return res.status(400).json({ Message: "El Dueño es requerido." });
        if (!duenioTrim) return res.status(400).json({ Message: "No se pudo determinar el nombre del Dueño." });
        if (!MonedaValue) return res.status(400).json({ Message: "Debe seleccionar una Moneda." });
        if (!Number.isFinite(fondoNum) || fondoNum <= 0) return res.status(400).json({ Message: "El Fondo debe ser un número mayor a 0." });
        if (!ContextoId) return res.status(400).json({ Message: "Debe seleccionar un Contexto." });
        if (!SitioId) return res.status(400).json({ Message: "Debe seleccionar un Sitio." });
        if (!CreatedBy) return res.status(400).json({ Message: "El usuario que autoriza (CreatedBy) es requerido." });

        const body = {
            Descripcion: descripcionTrim,
            DuenioId,
            Duenio: duenioTrim,
            Moneda: { Value: MonedaValue, DisplayName: MonedaDisplayName || MONEDA_DISPLAY_NAME[MonedaValue] || String(MonedaValue) },
            Fondo: fondoNum,
            ContextoId,
            SitioId,
            CreatedBy,
        };

        const resp = await fetch("https://cfows.azurewebsites.net/api/CajaChica/Create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (!resp.ok) {
            const errData = await resp.text();
            console.error(`CajaChica/Create → HTTP ${resp.status} para "${descripcionTrim}":`, errData);
            return res.status(resp.status).json({ Message: "Error al comunicarse con el servicio externo", Detail: errData });
        }

        const data = await resp.json().catch(() => null);
        console.log(`CajaChica/Create → "${descripcionTrim}":`, JSON.stringify(data));

        if (data?.IsValid === false) {
            return res.status(400).json({ Message: data?.Message || "Azure rechazó la solicitud." });
        }

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "cfo",
            areaLabel: "CFO",
            moduloKey: "cajaChica",
            moduloLabel: "Caja Chica",
            accion: `Creó la Caja Chica "${descripcionTrim}" para ${duenioTrim}`,
            referencia: duenioTrim
        });

        // La respuesta de Azure no garantiza un campo de Id estable (ver mismo criterio en
        // /crearProveedor); se vuelve a consultar por Dueño + Descripción (recién creada) para
        // obtener el Id real, por si algún paso futuro del módulo necesita referenciarla.
        const pool = await conexion(BasesDeDatos.CfoNetCore);
        const creada = await pool.request()
            .input('duenioId', sql.UniqueIdentifier, DuenioId)
            .input('descripcion', sql.VarChar, descripcionTrim)
            .query(`
                SELECT TOP 1 [Id] FROM [dbo].[CajaChica]
                WHERE [DuenioId] = @duenioId AND [Descripcion] = @descripcion AND [IsSoftDeleted] = 0
                ORDER BY [CreatedDate] DESC
            `);

        return res.status(200).json({
            Message: "Caja Chica creada con éxito",
            Data: data,
            Id: creada.recordset[0]?.Id || null
        });

    } catch (error) {
        console.error("Error en cajaChicaCrear:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

export default app;
