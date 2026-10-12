import nodemailer from "nodemailer";

let transporter = null;

// El transporter se crea una sola vez (reutiliza conexión SMTP), y solo si hay
// credenciales configuradas -- en entornos donde todavía no se configuró SMTP_USER/
// SMTP_PASS, enviarCorreo() falla con un error claro en vez de intentar conectar.
function obtenerTransporter() {
    if (transporter) return transporter;

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error("SMTP_USER / SMTP_PASS no están configurados en el servidor.");
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.office365.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false, // STARTTLS en el puerto 587, no SSL directo
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    return transporter;
}

export async function enviarCorreo({ destinatarios, asunto, html, replyTo }) {
    const t = obtenerTransporter();
    await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: destinatarios.join(", "),
        subject: asunto,
        html,
        ...(replyTo ? { replyTo } : {}),
    });
}
