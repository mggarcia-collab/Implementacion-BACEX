import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sql from "mssql";
import { conexion, BasesDeDatos } from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// El filesystem de un contenedor es efímero: sin esto, auth.db (usuarios,
// permisos, actividad) se resetea al contenido que quedó grabado en la imagen
// cada vez que el contenedor se reinicia o se vuelve a desplegar. DB_DATA_DIR
// permite apuntar a una carpeta persistente montada por el hosting (ej. en
// Azure App Service, /home sí persiste entre reinicios/despliegues). Si no se
// define, se usa la misma carpeta de siempre (comportamiento sin cambios en
// desarrollo local y en el PM2 de la oficina).
const dbDir = process.env.DB_DATA_DIR || __dirname;
const dbPath = path.join(dbDir, "auth.db");
const dbOriginal = path.join(__dirname, "auth.db");

fs.mkdirSync(dbDir, { recursive: true });

// Primera vez que se usa una carpeta persistente vacía: se parte del auth.db
// que trae la imagen (con los usuarios ya existentes) en vez de arrancar de
// cero sin ningún usuario para iniciar sesión.
if (dbDir !== __dirname && !fs.existsSync(dbPath) && fs.existsSync(dbOriginal)) {
  fs.copyFileSync(dbOriginal, dbPath);
}

export const authDb = new DatabaseSync(dbPath);

authDb.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_usuario TEXT UNIQUE NOT NULL,
    nombre_completo TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1,
    created_date TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS permisos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    area_key TEXT NOT NULL,
    modulo_key TEXT NOT NULL,
    UNIQUE(usuario_id, area_key, modulo_key)
  );

  CREATE TABLE IF NOT EXISTS actividad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_nombre TEXT NOT NULL,
    area_key TEXT NOT NULL,
    area_label TEXT NOT NULL,
    modulo_key TEXT,
    modulo_label TEXT,
    accion TEXT NOT NULL,
    created_date TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alertas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    referencia TEXT,
    created_date TEXT NOT NULL DEFAULT (datetime('now')),
    leida INTEGER NOT NULL DEFAULT 0,
    leida_date TEXT
  );
`);

// La tabla usuarios ya existía sin estas columnas; se agregan aparte porque
// ALTER TABLE ADD COLUMN falla si la columna ya existe en una corrida posterior.
// persona_id es el Id (uniqueidentifier) de la tabla Persona en la BD de Personas —
// reemplaza a la vieja tabla "autorizadores" como fuente del ID real para ModifiedBy/UsuarioId.
try {
  authDb.exec(`ALTER TABLE usuarios ADD COLUMN correo TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
try {
  authDb.exec(`ALTER TABLE usuarios ADD COLUMN persona_id TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
// usuario_id en actividad: permite filtrar "solo lo mío" de forma confiable (por id,
// no por el nombre guardado como texto) para que cada usuario no-admin vea únicamente
// su propia actividad, mientras un admin sigue viendo la de todos.
try {
  authDb.exec(`ALTER TABLE actividad ADD COLUMN usuario_id INTEGER`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
// referencia guarda el dato puntual sobre el que se actuó (referencia operativa,
// número de factura, nombre del usuario afectado, etc.), separado del texto de
// "accion" (el verbo), para que la bitácora/Excel tengan una columna propia de
// "Referencia o trámite" en vez de un solo texto largo mezclando todo.
try {
  authDb.exec(`ALTER TABLE actividad ADD COLUMN referencia TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
// motivo guarda la Observación que la persona escribió al hacer la acción
// (por qué eliminó/cambió algo), cuando el módulo la pide.
try {
  authDb.exec(`ALTER TABLE actividad ADD COLUMN motivo TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
// datos_antes / datos_despues guardan, en JSON, el valor del dato puntual antes y
// después de la acción (ej. { "Componente": "A" } -> { "Componente": "B" }), para que
// la bitácora muestre exactamente qué cambió y no solo que "se cambió algo". Quedan en
// null en acciones donde no aplica (ej. una simple consulta) o solo uno de los dos en
// creaciones (sin "antes") y eliminaciones (sin "después").
try {
  authDb.exec(`ALTER TABLE actividad ADD COLUMN datos_antes TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}
try {
  authDb.exec(`ALTER TABLE actividad ADD COLUMN datos_despues TEXT`);
} catch {
  // La columna ya existe, no hay nada que hacer.
}

export function getPermisosDeUsuario(usuarioId) {
  return authDb
    .prepare(`SELECT area_key AS area, modulo_key AS modulo FROM permisos WHERE usuario_id = ?`)
    .all(usuarioId);
}

// Acepta tanto un objeto (lo serializa a JSON) como un string ya armado (lo deja tal
// cual), para que cada caller pueda pasar el dato puntual de la forma que le quede
// más natural (ej. { Componente: "A" } o ya un texto corto como "Vigente: Sí").
function serializarDatos(valor) {
  if (valor === undefined || valor === null) return null;
  return typeof valor === "string" ? valor : JSON.stringify(valor);
}

function registrarActividadLocal({ usuarioId, usuarioNombre, areaKey, areaLabel, moduloKey, moduloLabel, accion, referencia, motivo, antes, despues }) {
  authDb
    .prepare(`INSERT INTO actividad (usuario_id, usuario_nombre, area_key, area_label, modulo_key, modulo_label, accion, referencia, motivo, datos_antes, datos_despues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(usuarioId || null, usuarioNombre || "—", areaKey, areaLabel, moduloKey || null, moduloLabel || null, accion, referencia || null, motivo || null, serializarDatos(antes), serializarDatos(despues));
}

// Registro de actividad para el widget "Actividad reciente" de Inicio y la bitácora
// completa de Administración. Se llama desde las rutas después de que una acción se
// aplicó con éxito de verdad (no antes de validar).
//
// Vive en RegistroActividades.dbo.Bitacora (SQL Server dedicado, creado para esto), no
// en el SQLite local: así la bitácora ya no se pierde si el contenedor se reinicia sin
// disco persistente. Cualquier fallo al escribir ahí (ej. tabla aún no creada) cae de
// vuelta al SQLite local, para que la bitácora no se quede sin registrar nada. Ningún
// caller hace `await` de esta función (son ~47 sitios): queda async a propósito para no
// bloquear la respuesta HTTP por el registro del log, y cualquier error se atrapa aquí
// adentro para que nunca se vuelva un unhandled rejection.
export async function registrarActividad({ usuarioId, usuarioNombre, areaKey, areaLabel, moduloKey, moduloLabel, accion, referencia, motivo, antes, despues }) {
  const datos = { usuarioId, usuarioNombre, areaKey, areaLabel, moduloKey, moduloLabel, accion, referencia, motivo, antes, despues };
  try {
    const pool = await conexion(BasesDeDatos.RegistroActividades);
    await pool
      .request()
      .input("usuarioId", sql.Int, usuarioId || null)
      .input("usuarioNombre", sql.VarChar(150), usuarioNombre || "—")
      .input("areaKey", sql.VarChar(50), areaKey)
      .input("areaLabel", sql.VarChar(100), areaLabel)
      .input("moduloKey", sql.VarChar(50), moduloKey || null)
      .input("moduloLabel", sql.VarChar(100), moduloLabel || null)
      .input("accion", sql.VarChar(200), accion)
      .input("referencia", sql.VarChar(300), referencia || null)
      .input("motivo", sql.VarChar(800), motivo || null)
      .input("datosAntes", sql.NVarChar(sql.MAX), serializarDatos(antes))
      .input("datosDespues", sql.NVarChar(sql.MAX), serializarDatos(despues))
      .query(`
        INSERT INTO dbo.Bitacora
          (UsuarioId, UsuarioNombre, AreaKey, AreaLabel, ModuloKey, ModuloLabel, Accion, Referencia, Motivo, DatosAntes, DatosDespues)
        VALUES
          (@usuarioId, @usuarioNombre, @areaKey, @areaLabel, @moduloKey, @moduloLabel, @accion, @referencia, @motivo, @datosAntes, @datosDespues)
      `);
  } catch (error) {
    console.error("No se pudo registrar actividad en SQL Server, se guarda en local:", error.message);
    try {
      registrarActividadLocal(datos);
    } catch (errorLocal) {
      console.error("Error al registrar actividad en local:", errorLocal);
    }
  }
}

// Usado para resolver, a partir de un correo fijo (ej. destinatarios de una alerta de
// negocio), a qué usuario de BAC-EX le corresponde crearle la alerta dentro de la app.
export function resolverUsuarioIdPorCorreo(correo) {
  const fila = authDb.prepare(`SELECT id FROM usuarios WHERE correo = ?`).get(correo);
  return fila?.id || null;
}

// Alertas dentro de la app (ej. widget de Inicio) para avisos que antes se pensaban mandar
// por correo. No duplica: si ya existe una alerta sin leer del mismo tipo+referencia para
// ese usuario, no crea otra -- así no se acumulan copias cada vez que se vuelve a detectar
// lo mismo, hasta que la persona la marque como leída. Devuelve true si creó una alerta
// nueva, false si ya existía una pendiente (o si falló).
export function crearAlerta({ usuarioId, tipo, titulo, mensaje, referencia }) {
  try {
    const yaExiste = authDb
      .prepare(`SELECT id FROM alertas WHERE usuario_id = ? AND tipo = ? AND referencia = ? AND leida = 0`)
      .get(usuarioId, tipo, referencia || null);
    if (yaExiste) return false;

    authDb
      .prepare(`INSERT INTO alertas (usuario_id, tipo, titulo, mensaje, referencia) VALUES (?, ?, ?, ?, ?)`)
      .run(usuarioId, tipo, titulo, mensaje, referencia || null);
    return true;
  } catch (error) {
    console.error("Error al crear alerta:", error);
    return false;
  }
}

export function obtenerAlertasPendientes(usuarioId) {
  return authDb
    .prepare(`SELECT * FROM alertas WHERE usuario_id = ? AND leida = 0 ORDER BY created_date DESC`)
    .all(usuarioId);
}

export function marcarAlertaLeida(alertaId, usuarioId) {
  authDb
    .prepare(`UPDATE alertas SET leida = 1, leida_date = datetime('now') WHERE id = ? AND usuario_id = ?`)
    .run(alertaId, usuarioId);
}

// Historial de alertas ya leídas (para poder revisarlas después, igual que la Bitácora
// con la actividad). Ordenadas por cuándo se marcaron como leídas, no por cuándo se crearon.
export function obtenerAlertasHistorial(usuarioId, limite = 50) {
  return authDb
    .prepare(`SELECT * FROM alertas WHERE usuario_id = ? AND leida = 1 ORDER BY leida_date DESC LIMIT ?`)
    .all(usuarioId, limite);
}
