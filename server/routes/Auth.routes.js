import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authDb, getPermisosDeUsuario, obtenerOficinasPermitidas, asignarOficinas, registrarActividad } from "../database/authDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { ADUANAS_CANONICAS } from "../aduanas.js";

const router = Router();
const JWT_EXPIRES = "12h";

// Resumen legible del User-Agent (ej. "Chrome en Windows") para la Bitácora -- no se usa una
// librería de parseo completa (innecesaria) porque solo interesa navegador + sistema operativo,
// no la versión exacta ni el motor de renderizado.
function describirDispositivo(userAgent) {
    const ua = userAgent || "";
    let so = "SO desconocido";
    if (/windows/i.test(ua)) so = "Windows";
    else if (/android/i.test(ua)) so = "Android";
    else if (/iphone|ipad|ipod/i.test(ua)) so = "iOS";
    else if (/mac os/i.test(ua)) so = "Mac";
    else if (/linux/i.test(ua)) so = "Linux";

    let navegador = "Navegador desconocido";
    if (/edg\//i.test(ua)) navegador = "Edge";
    else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) navegador = "Chrome";
    else if (/firefox\//i.test(ua)) navegador = "Firefox";
    else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) navegador = "Safari";

    return `${navegador} en ${so}`;
}

// req.ip respeta X-Forwarded-For solo si Express tiene "trust proxy" configurado; se revisa el
// header manualmente aparte por si en producción queda detrás de un proxy/balanceador sin esa
// configuración, para no perder la IP real del usuario.
function obtenerIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) return String(forwardedFor).split(",")[0].trim();
    return req.ip || req.socket?.remoteAddress || "IP desconocida";
}

router.post("/login", async (req, res) => {
    try {
        const { nombreUsuario, password } = req.body;
        if (!nombreUsuario || !password) {
            return res.status(400).json({ Message: "Usuario y contraseña son requeridos." });
        }

        const user = authDb.prepare(`SELECT * FROM usuarios WHERE nombre_usuario = ?`).get(nombreUsuario);
        if (!user || !user.activo) {
            return res.status(401).json({ Message: "Usuario o contraseña incorrectos." });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ Message: "Usuario o contraseña incorrectos." });
        }

        const permisos = getPermisosDeUsuario(user.id);
        const isAdmin = !!user.is_admin;
        const token = jwt.sign(
            { id: user.id, nombreUsuario: user.nombre_usuario, isAdmin, permisos },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
        );

        registrarActividad({
            usuarioId: user.id,
            usuarioNombre: user.nombre_completo,
            areaKey: "auth",
            areaLabel: "Autenticación",
            moduloKey: "login",
            moduloLabel: "Inicio de Sesión",
            accion: "Inició sesión",
            referencia: obtenerIp(req),
            motivo: describirDispositivo(req.headers["user-agent"])
        });

        return res.json({
            Token: token,
            Usuario: {
                id: user.id,
                nombreUsuario: user.nombre_usuario,
                nombreCompleto: user.nombre_completo,
                isAdmin,
                permisos
            }
        });
    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

router.get("/me", requireAuth, (req, res) => {
    const user = authDb.prepare(`SELECT id, nombre_usuario, nombre_completo, is_admin FROM usuarios WHERE id = ?`).get(req.user.id);
    if (!user) return res.status(404).json({ Message: "Usuario no encontrado." });
    res.json({
        id: user.id,
        nombreUsuario: user.nombre_usuario,
        nombreCompleto: user.nombre_completo,
        isAdmin: !!user.is_admin,
        permisos: getPermisosDeUsuario(user.id)
    });
});

// --- Administración de usuarios (solo admin) ---

router.get("/usuarios", requireAuth, requireAdmin, (req, res) => {
    const usuarios = authDb
        .prepare(`SELECT id, nombre_usuario, nombre_completo, correo, persona_id, is_admin, activo FROM usuarios ORDER BY nombre_completo`)
        .all();
    res.json(usuarios.map((u) => ({
        id: u.id,
        nombreUsuario: u.nombre_usuario,
        nombreCompleto: u.nombre_completo,
        correo: u.correo,
        personaId: u.persona_id,
        isAdmin: !!u.is_admin,
        activo: !!u.activo,
        permisos: getPermisosDeUsuario(u.id),
        oficinasPermitidas: obtenerOficinasPermitidas(u.id)
    })));
});

// Catálogo de Aduanas para el selector de "Aduanas permitidas" de un usuario -- lista fija
// (ver server/aduanas.js), construida y verificada contra los valores reales de
// HojaDeRuta.dbo.HojaRuta.AduanaDescripcion, que es la fuente real de la Aduana de una
// Referencia Operativa (NO CfoNetCore.dbo.Sitio/OficinaVenta, que es otra cosa).
router.get("/aduanas", requireAuth, requireAdmin, (req, res) => {
    const lista = Object.entries(ADUANAS_CANONICAS)
        .map(([clave, a]) => ({ clave, label: a.label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    res.json(lista);
});

router.put("/usuarios/:id/oficinas", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { oficinas } = req.body;

    asignarOficinas(usuarioId, oficinas);

    const usuario = authDb.prepare(`SELECT nombre_completo FROM usuarios WHERE id = ?`).get(usuarioId);
    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: (oficinas || []).length > 0 ? `Restringió a ${(oficinas || []).length} Oficina(s) de Venta` : "Quitó la restricción por Oficina de Venta",
        referencia: usuario?.nombre_completo || "",
        despues: { "Oficinas permitidas": (oficinas || []).length > 0 ? oficinas.join(", ") : "Todas (sin restricción)" }
    });

    res.json({ Message: "ok", oficinasPermitidas: obtenerOficinasPermitidas(usuarioId) });
});

router.post("/usuarios", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { nombreUsuario, nombreCompleto, correo, personaId, password, isAdmin, permisos, oficinas } = req.body;
        if (!nombreUsuario?.trim() || !nombreCompleto?.trim() || !password) {
            return res.status(400).json({ Message: "Usuario, nombre completo y contraseña son requeridos." });
        }

        const existente = authDb.prepare(`SELECT id FROM usuarios WHERE nombre_usuario = ?`).get(nombreUsuario.trim());
        if (existente) {
            return res.status(400).json({ Message: "Ya existe un usuario con ese nombre." });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = authDb
            .prepare(`INSERT INTO usuarios (nombre_usuario, nombre_completo, correo, persona_id, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(nombreUsuario.trim(), nombreCompleto.trim(), correo?.trim() || null, personaId?.trim() || null, passwordHash, isAdmin ? 1 : 0);

        const usuarioId = Number(result.lastInsertRowid);
        const insertPermiso = authDb.prepare(`INSERT OR IGNORE INTO permisos (usuario_id, area_key, modulo_key) VALUES (?, ?, ?)`);
        for (const p of (permisos || [])) {
            insertPermiso.run(usuarioId, p.area, p.modulo);
        }
        asignarOficinas(usuarioId, oficinas);

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "admin",
            areaLabel: "Administración",
            moduloKey: "usuarios",
            moduloLabel: "Usuarios",
            accion: "Creó usuario",
            referencia: nombreCompleto.trim(),
            despues: {
                Usuario: nombreUsuario.trim(),
                Correo: correo?.trim() || "—",
                "Es administrador": isAdmin ? "Sí" : "No",
                Permisos: (permisos || []).length > 0 ? `${permisos.length} módulo(s)` : "Ninguno"
            }
        });

        return res.status(201).json({ Message: "Usuario creado con éxito", Id: usuarioId });
    } catch (error) {
        console.error("Error en crear usuario:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

router.put("/usuarios/:id/permisos", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { permisos, antesPermisos, despuesPermisos } = req.body;

    // Solo para la bitácora: texto legible si el frontend lo mandó; si no, se cae a
    // area_key/modulo_key crudo como respaldo.
    const permisosAntes = typeof antesPermisos === "string" && antesPermisos
        ? antesPermisos
        : getPermisosDeUsuario(usuarioId).map((p) => `${p.area}/${p.modulo}`).join(", ") || "—";

    authDb.prepare(`DELETE FROM permisos WHERE usuario_id = ?`).run(usuarioId);
    const insertPermiso = authDb.prepare(`INSERT OR IGNORE INTO permisos (usuario_id, area_key, modulo_key) VALUES (?, ?, ?)`);
    for (const p of (permisos || [])) {
        insertPermiso.run(usuarioId, p.area, p.modulo);
    }
    const permisosDespues = typeof despuesPermisos === "string" && despuesPermisos
        ? despuesPermisos
        : (permisos || []).map((p) => `${p.area}/${p.modulo}`).join(", ") || "—";

    const usuario = authDb.prepare(`SELECT nombre_completo FROM usuarios WHERE id = ?`).get(usuarioId);
    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: "Actualizó permisos",
        referencia: usuario?.nombre_completo || "",
        antes: permisosAntes,
        despues: permisosDespues
    });

    return res.json({ Message: "Permisos actualizados con éxito" });
});

router.put("/usuarios/:id/password", requireAuth, requireAdmin, async (req, res) => {
    try {
        const usuarioId = Number(req.params.id);
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ Message: "La contraseña debe tener al menos 6 caracteres." });
        }

        const usuario = authDb.prepare(`SELECT id, nombre_completo FROM usuarios WHERE id = ?`).get(usuarioId);
        if (!usuario) {
            return res.status(404).json({ Message: "No se encontró el usuario." });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        authDb.prepare(`UPDATE usuarios SET password_hash = ? WHERE id = ?`).run(passwordHash, usuarioId);

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "admin",
            areaLabel: "Administración",
            moduloKey: "usuarios",
            moduloLabel: "Usuarios",
            accion: "Cambió contraseña",
            referencia: usuario.nombre_completo,
            despues: { Acción: "Contraseña restablecida" }
        });

        return res.json({ Message: "Contraseña actualizada con éxito" });
    } catch (error) {
        console.error("Error en actualizar contraseña:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

router.put("/usuarios/:id/perfil", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { nombreCompleto, correo, personaId } = req.body;
    if (!nombreCompleto?.trim()) {
        return res.status(400).json({ Message: "El nombre completo es requerido." });
    }
    const usuario = authDb.prepare(`SELECT id, nombre_completo, correo, persona_id FROM usuarios WHERE id = ?`).get(usuarioId);
    if (!usuario) {
        return res.status(404).json({ Message: "No se encontró el usuario." });
    }
    // Si no se volvió a buscar/seleccionar una Persona al editar, se conserva la que ya tenía
    // en vez de borrarla (solo se reemplaza cuando personaId viene explícito en el body).
    const nuevoPersonaId = personaId?.trim() || usuario.persona_id || null;
    authDb
        .prepare(`UPDATE usuarios SET nombre_completo = ?, correo = ?, persona_id = ? WHERE id = ?`)
        .run(nombreCompleto.trim(), correo?.trim() || null, nuevoPersonaId, usuarioId);

    // El formulario manda Nombre y Correo juntos siempre (vienen precargados), así
    // que solo se incluye en la bitácora el que realmente cambió de valor.
    const correoNuevo = correo?.trim() || "—";
    const antesPerfil = {};
    const despuesPerfil = {};
    if (usuario.nombre_completo !== nombreCompleto.trim()) {
        antesPerfil.Nombre = usuario.nombre_completo;
        despuesPerfil.Nombre = nombreCompleto.trim();
    }
    if ((usuario.correo || "—") !== correoNuevo) {
        antesPerfil.Correo = usuario.correo || "—";
        despuesPerfil.Correo = correoNuevo;
    }

    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: "Actualizó perfil",
        referencia: nombreCompleto.trim(),
        antes: antesPerfil,
        despues: despuesPerfil
    });

    return res.json({ Message: "Perfil actualizado con éxito" });
});

router.put("/usuarios/:id/activo", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { activo } = req.body;

    const usuario = authDb.prepare(`SELECT nombre_completo, activo AS activo_anterior FROM usuarios WHERE id = ?`).get(usuarioId);
    authDb.prepare(`UPDATE usuarios SET activo = ? WHERE id = ?`).run(activo ? 1 : 0, usuarioId);

    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: activo ? "Activó usuario" : "Desactivó usuario",
        referencia: usuario?.nombre_completo || "",
        antes: { Estado: usuario?.activo_anterior ? "Activo" : "Inactivo" },
        despues: { Estado: activo ? "Activo" : "Inactivo" }
    });

    return res.json({ Message: activo ? "Usuario activado" : "Usuario desactivado" });
});

router.put("/usuarios/:id/admin", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { isAdmin } = req.body;

    const usuario = authDb.prepare(`SELECT id, nombre_completo, is_admin FROM usuarios WHERE id = ?`).get(usuarioId);
    if (!usuario) {
        return res.status(404).json({ Message: "No se encontró el usuario." });
    }

    if (!isAdmin) {
        if (usuarioId === req.user.id) {
            return res.status(400).json({ Message: "No puedes quitarte el rol de administrador a ti misma." });
        }
        const { total } = authDb.prepare(`SELECT COUNT(*) AS total FROM usuarios WHERE is_admin = 1`).get();
        if (total <= 1) {
            return res.status(400).json({ Message: "Debe existir al menos un administrador." });
        }
    }

    authDb.prepare(`UPDATE usuarios SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, usuarioId);

    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: isAdmin ? "Otorgó rol de administrador" : "Quitó rol de administrador",
        referencia: usuario.nombre_completo,
        antes: { Rol: usuario.is_admin ? "Administrador" : "Usuario" },
        despues: { Rol: isAdmin ? "Administrador" : "Usuario" }
    });

    return res.json({ Message: isAdmin ? "Ahora es administrador" : "Ya no es administrador" });
});

router.get("/autorizador-actual", requireAuth, (req, res) => {
    const user = authDb.prepare(`SELECT nombre_completo, correo, persona_id FROM usuarios WHERE id = ?`).get(req.user.id);
    if (!user || !user.persona_id) {
        return res.json(null);
    }
    res.json({ nombre: user.nombre_completo, externalId: user.persona_id, correo: user.correo });
});

export default router;
