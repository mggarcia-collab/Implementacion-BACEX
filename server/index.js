import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
const app = express()
import cfoRoutes from './routes/Cfo.routes.js'
import hrRoutes from './routes/Hr.routes.js'
import analisisRoutes from './routes/Analisis.routes.js'
import seguimientoRoutes from './routes/Seguimiento.routes.js'
import authRoutes from './routes/Auth.routes.js'
import actividadRoutes from './routes/Actividad.routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clienteDist = path.join(__dirname, '../client/dist')

// Ruta explícita (no relativa al directorio actual) para que las variables de entorno
// se carguen igual sin importar desde dónde se arranque el proceso (pm2, un servicio de
// Windows, doble clic, etc. suelen usar un cwd distinto al de esta carpeta).
dotenv.config({ path: path.join(__dirname, '.env') })

const port = process.env.PORT || 3000

app.use(express.json()); //para que acepte jsons

// El check de CORS solo aplica a /api: el cliente y el servidor viven en el mismo origen
// en producción, así que los assets estáticos (JS/CSS) no deben pasar por esta validación
// (el navegador les manda un header Origin por el atributo "crossorigin" del build de Vite,
// y si se aplicara aquí, el checkeo de "solo localhost" los rechazaría con 500 en producción).
// RENDER_EXTERNAL_URL lo define Render automáticamente con la URL pública del servicio.
// PUBLIC_URL es el equivalente manual para otros hosts (ej. Azure Container Apps, que no
// inyecta esa variable solo): hay que definirla a mano con el FQDN público asignado
// (https://<app>.<region>.azurecontainerapps.io) en la configuración del Container App.
// El rango de IP privada cubre el acceso por red local/VPN (ej. http://192.168.x.x:4000)
// cuando el servidor corre en una PC dentro de la oficina en vez de en la nube.
const origenesPermitidos = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/(192\.168|10\.|172\.(1[6-9]|2\d|3[0-1]))\.[\d.]+:\d+$/
];
if (process.env.RENDER_EXTERNAL_URL) origenesPermitidos.push(process.env.RENDER_EXTERNAL_URL);
if (process.env.PUBLIC_URL) origenesPermitidos.push(process.env.PUBLIC_URL);

const corsOptions = cors({
    origin: (origin, callback) => {
        const permitido = !origin || origenesPermitidos.some((o) =>
            o instanceof RegExp ? o.test(origin) : o === origin
        );
        if (permitido) {
            callback(null, true);
        } else {
            callback(new Error("Origen no permitido por CORS"));
        }
    },
    credentials: true
})

app.use('/api/auth', corsOptions, authRoutes);
app.use('/api', corsOptions, cfoRoutes);
app.use('/api', corsOptions, hrRoutes);
app.use('/api', corsOptions, analisisRoutes);
app.use('/api', corsOptions, seguimientoRoutes);
app.use('/api', corsOptions, actividadRoutes);

// En producción, el mismo servidor sirve el build del cliente (client/dist), evitando
// tener que desplegar y configurar dos servicios/dominios separados.
app.use(express.static(clienteDist));
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clienteDist, 'index.html'));
});

app.listen(port, () => {
    console.log(`servidor corriendo ${port}`)
})