import sql from 'mssql'

const pools = {}; // diccionario de pools por DB

// RegistroActividades vive en un servidor Azure SQL aparte, con su propio login,
// distinto al servidor compartido donde están CfoNetCore/AnalisisDeRed/etc. Esta
// función se evalúa recién cuando se llama (no al cargar el módulo), para leer
// las variables de entorno ya cargadas por dotenv.config() en index.js -- si fuera
// un objeto literal a nivel de módulo, se evaluaría antes de que dotenv corra y
// las variables quedarían undefined para siempre.
function credencialesPara(databaseName) {
    if (databaseName === 'RegistroActividades') {
        return {
            user: process.env.BITACORA_DB_USER,
            password: process.env.BITACORA_DB_PASSWORD,
            server: process.env.BITACORA_DB_SERVER
        };
    }
    return null;
}

export async function conexion(databaseName) {
    if (pools[databaseName]) {
        return pools[databaseName];
    }
    const credenciales = credencialesPara(databaseName);
    const config = {
        user: credenciales?.user || process.env.DB_USER,
        password: credenciales?.password || process.env.DB_PASSWORD,
        database: databaseName,
        server: credenciales?.server || process.env.DB_SERVER,
        options: {
            encrypt: true,
            trustServerCertificate: true
        },
        // Las consultas de Validación de Sello (Seguimiento) hacen varios JOIN + CROSS APPLY
        // sobre tablas grandes y pueden tardar más de los 15s por defecto de mssql.
        requestTimeout: 60000,
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 30000
        }
    };

    try {
        const pool = new sql.ConnectionPool(config);
        await pool.connect();

        pools[databaseName] = pool;
        return pool;
    } catch (err) {
        throw err;
    }
}

export let BasesDeDatos = {
    CfoNetCore: 'CfoNetCore',
    AnalisisDeRed: 'AnalisisDeRed',
    Personas: 'Personas',
    HojaDeRuta: 'HojaDeRuta',
    Seguimiento: 'Seguimiento',
    AccionesPersonal: 'AccionesPersonal',
    RegistroActividades: 'RegistroActividades'
}