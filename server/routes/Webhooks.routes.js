import { Router } from "express";
import { resolverUsuarioIdPorCorreo, crearAlerta } from "../database/authDb.js";

const app = Router();

// El sistema de Incidentes (Vesta Link) no tiene webhook ni API propia -- lo único real
// con lo que contamos es el correo que YA le llega al usuario cada vez que se crea un
// ticket. Por eso la notificación "inmediata" dentro de BAC-EX se dispara desde un flujo
// de Power Automate (trigger "Cuando llega un correo nuevo" sobre ese correo), que llama
// este endpoint en vez de que nosotros tengamos que inventar un acceso que no existe.
// No pasa por requireAuth porque quien llama es el flujo, no un usuario con sesión en
// BAC-EX -- se protege en su lugar con un secreto propio.
app.post("/webhooks/nuevoTicket", (req, res) => {
    const secretoEsperado = process.env.TICKET_WEBHOOK_SECRET;
    const secretoRecibido = req.headers["x-webhook-secret"] || req.query.secret;
    if (!secretoEsperado || secretoRecibido !== secretoEsperado) {
        return res.status(401).json({ Message: "No autorizado." });
    }

    const { para, asunto, referencia } = req.body || {};
    if (!para) {
        return res.status(400).json({ Message: "Falta 'para' (correo del destinatario del ticket)." });
    }

    const usuarioId = resolverUsuarioIdPorCorreo(String(para).trim());
    if (!usuarioId) {
        return res.status(404).json({ Message: `No hay un usuario de BAC-EX con el correo ${para}.` });
    }

    crearAlerta({
        usuarioId,
        tipo: "ticket_nuevo",
        titulo: "🎫 Nuevo ticket de Incidentes",
        mensaje: asunto ? String(asunto).trim() : "Se generó un nuevo ticket en Incidentes de Sistemas.",
        referencia: referencia ? String(referencia).trim() : (asunto ? String(asunto).trim() : null),
    });

    res.json({ Message: "ok" });
});

export default app;
