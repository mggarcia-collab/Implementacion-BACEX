import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

export function getPermisosDeUsuario(usuarioId) {
  return authDb
    .prepare(`SELECT area_key AS area, modulo_key AS modulo FROM permisos WHERE usuario_id = ?`)
    .all(usuarioId);
}

// Registro de actividad para el widget "Actividad reciente" de Inicio y la bitácora
// completa de Administración. Se llama desde las rutas después de que una acción se
// aplicó con éxito de verdad (no antes de validar).
export function registrarActividad({ usuarioId, usuarioNombre, areaKey, areaLabel, moduloKey, moduloLabel, accion, referencia, motivo }) {
  try {
    authDb
      .prepare(`INSERT INTO actividad (usuario_id, usuario_nombre, area_key, area_label, modulo_key, modulo_label, accion, referencia, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(usuarioId || null, usuarioNombre || "—", areaKey, areaLabel, moduloKey || null, moduloLabel || null, accion, referencia || null, motivo || null);
  } catch (error) {
    console.error("Error al registrar actividad:", error);
  }
}
