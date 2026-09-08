import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authDb, getPermisosDeUsuario, registrarActividad } from "../database/authDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();
const JWT_EXPIRES = "12h";

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
        permisos: getPermisosDeUsuario(u.id)
    })));
});

router.post("/usuarios", requireAuth, requireAdmin, async (req, res) => {
    try {
        const { nombreUsuario, nombreCompleto, correo, personaId, password, isAdmin, permisos } = req.body;
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

        registrarActividad({
            usuarioId: req.user.id,
            usuarioNombre: req.user.nombreCompleto,
            areaKey: "admin",
            areaLabel: "Administración",
            moduloKey: "usuarios",
            moduloLabel: "Usuarios",
            accion: "Creó usuario",
            referencia: nombreCompleto.trim()
        });

        return res.status(201).json({ Message: "Usuario creado con éxito", Id: usuarioId });
    } catch (error) {
        console.error("Error en crear usuario:", error);
        return res.status(500).json({ Message: "Error interno del servidor", Error: error.message });
    }
});

router.put("/usuarios/:id/permisos", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { permisos } = req.body;

    authDb.prepare(`DELETE FROM permisos WHERE usuario_id = ?`).run(usuarioId);
    const insertPermiso = authDb.prepare(`INSERT OR IGNORE INTO permisos (usuario_id, area_key, modulo_key) VALUES (?, ?, ?)`);
    for (const p of (permisos || [])) {
        insertPermiso.run(usuarioId, p.area, p.modulo);
    }

    const usuario = authDb.prepare(`SELECT nombre_completo FROM usuarios WHERE id = ?`).get(usuarioId);
    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: "Actualizó permisos",
        referencia: usuario?.nombre_completo || ""
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
            referencia: usuario.nombre_completo
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
    const usuario = authDb.prepare(`SELECT id, persona_id FROM usuarios WHERE id = ?`).get(usuarioId);
    if (!usuario) {
        return res.status(404).json({ Message: "No se encontró el usuario." });
    }
    // Si no se volvió a buscar/seleccionar una Persona al editar, se conserva la que ya tenía
    // en vez de borrarla (solo se reemplaza cuando personaId viene explícito en el body).
    const nuevoPersonaId = personaId?.trim() || usuario.persona_id || null;
    authDb
        .prepare(`UPDATE usuarios SET nombre_completo = ?, correo = ?, persona_id = ? WHERE id = ?`)
        .run(nombreCompleto.trim(), correo?.trim() || null, nuevoPersonaId, usuarioId);

    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: "Actualizó perfil",
        referencia: nombreCompleto.trim()
    });

    return res.json({ Message: "Perfil actualizado con éxito" });
});

router.put("/usuarios/:id/activo", requireAuth, requireAdmin, (req, res) => {
    const usuarioId = Number(req.params.id);
    const { activo } = req.body;
    authDb.prepare(`UPDATE usuarios SET activo = ? WHERE id = ?`).run(activo ? 1 : 0, usuarioId);

    const usuario = authDb.prepare(`SELECT nombre_completo FROM usuarios WHERE id = ?`).get(usuarioId);
    registrarActividad({
        usuarioId: req.user.id,
        usuarioNombre: req.user.nombreCompleto,
        areaKey: "admin",
        areaLabel: "Administración",
        moduloKey: "usuarios",
        moduloLabel: "Usuarios",
        accion: activo ? "Activó usuario" : "Desactivó usuario",
        referencia: usuario?.nombre_completo || ""
    });

    return res.json({ Message: activo ? "Usuario activado" : "Usuario desactivado" });
});

router.get("/autorizador-actual", requireAuth, (req, res) => {
    const user = authDb.prepare(`SELECT nombre_completo, correo, persona_id FROM usuarios WHERE id = ?`).get(req.user.id);
    if (!user || !user.persona_id) {
        return res.json(null);
    }
    res.json({ nombre: user.nombre_completo, externalId: user.persona_id, correo: user.correo });
});

export default router;
