import jwt from "jsonwebtoken";
import { authDb, getPermisosDeUsuario, obtenerOficinasPermitidas } from "../database/authDb.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ Message: "No autenticado." });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);

    // Los permisos y el estado se leen siempre de la BD (no del token) para que
    // los cambios hechos por un administrador surtan efecto de inmediato,
    // sin esperar a que la sesión expire o el usuario vuelva a iniciar sesión.
    const user = authDb
      .prepare(`SELECT id, nombre_usuario, nombre_completo, is_admin, activo FROM usuarios WHERE id = ?`)
      .get(payload.id);

    if (!user || !user.activo) {
      return res.status(401).json({ Message: "Sesión inválida o expirada." });
    }

    req.user = {
      id: user.id,
      nombreUsuario: user.nombre_usuario,
      nombreCompleto: user.nombre_completo,
      isAdmin: !!user.is_admin,
      permisos: getPermisosDeUsuario(user.id),
      // null = sin restricción (ve todas las Aduanas/Oficinas); array = restringido a esas
      // Oficinas de Venta. Se asigna al crear el usuario (o después, en Administración →
      // Usuarios). Un admin nunca queda restringido aunque tenga filas.
      oficinasPermitidas: obtenerOficinasPermitidas(user.id)
    };
    next();
  } catch (error) {
    return res.status(401).json({ Message: "Sesión inválida o expirada." });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ Message: "No tiene permisos de administrador." });
  }
  next();
}

export function requirePermission(area, modulo) {
  return (req, res, next) => {
    if (req.user?.isAdmin) return next();
    const permitido = (req.user?.permisos || []).some((p) => p.area === area && p.modulo === modulo);
    if (!permitido) {
      return res.status(403).json({ Message: "No tiene permiso para usar este módulo." });
    }
    next();
  };
}
