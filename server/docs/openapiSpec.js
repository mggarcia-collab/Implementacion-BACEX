// Documento OpenAPI que alimenta /swagger (Swagger UI), igual a como el equipo de
// sistemas documenta cfows en https://cfows.azurewebsites.net/swagger/index.html.
// Por ahora solo describe los métodos pensados para que sistemas EXTERNOS llamen a
// IMS (no las rutas internas que usa el propio cliente web).
export const openapiSpec = {
    openapi: "3.0.3",
    info: {
        title: "IMS - API de Integraciones",
        description:
            "Métodos de IMS (Incident Management System, Grupo Vesta) pensados para que otros sistemas se integren con nosotros. " +
            "Por ahora: dejar un registro en la Bitácora de IMS desde un sistema externo.",
        version: "1.0.0"
    },
    servers: [
        { url: "https://vestamantenimientosbacex-b3ggdbcfaxeucfbc.centralus-01.azurewebsites.net", description: "Producción" }
    ],
    tags: [
        { name: "Bitacora", description: "Registro de actividad (auditoría) de IMS" }
    ],
    paths: {
        "/api/Bitacora/Create": {
            post: {
                tags: ["Bitacora"],
                summary: "Crear un registro en la Bitácora de IMS",
                description:
                    "Permite que un sistema externo deje su propio registro en la Bitácora de IMS. " +
                    "El registro queda guardado con área \"Integraciones Externas\" y el módulo igual al valor de 'Sistema'.",
                security: [{ BitacoraWebhookSecret: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/BitacoraCreateRequest" },
                            examples: {
                                ejemplo: {
                                    value: {
                                        Sistema: "VestaLink",
                                        Accion: "Actualizó el estado de un ticket",
                                        Referencia: "TCK-00123",
                                        Motivo: "Cierre automático por SLA vencido",
                                        Antes: { Estado: "Abierto" },
                                        Despues: { Estado: "Cerrado" }
                                    }
                                }
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: "Registro creado",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { Message: { type: "string", example: "ok" } } }
                            }
                        }
                    },
                    400: {
                        description: "Faltan campos requeridos",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { Message: { type: "string" } } }
                            }
                        }
                    },
                    401: {
                        description: "Secreto ausente o incorrecto",
                        content: {
                            "application/json": {
                                schema: { type: "object", properties: { Message: { type: "string" } } }
                            }
                        }
                    }
                }
            }
        }
    },
    components: {
        securitySchemes: {
            BitacoraWebhookSecret: {
                type: "apiKey",
                in: "header",
                name: "X-Webhook-Secret",
                description: "Secreto compartido asignado a este sistema (no es una sesión de usuario de IMS)."
            }
        },
        schemas: {
            BitacoraCreateRequest: {
                type: "object",
                required: ["Sistema", "Accion"],
                properties: {
                    Sistema: { type: "string", description: "Nombre del sistema que llama.", example: "VestaLink" },
                    Accion: { type: "string", description: "Descripción de la acción realizada.", example: "Actualizó el estado de un ticket" },
                    Referencia: { type: "string", nullable: true, description: "Folio o ID relacionado (opcional)." },
                    Motivo: { type: "string", nullable: true, description: "Texto libre (opcional)." },
                    Antes: { type: "object", nullable: true, description: "Estado antes del cambio (opcional)." },
                    Despues: { type: "object", nullable: true, description: "Estado después del cambio (opcional)." }
                }
            }
        }
    }
};
