# --- Etapa 1: build del cliente (Vite/React) ---
FROM node:24-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Etapa 2: servidor (Express), con el build del cliente ya listo ---
FROM node:24-alpine AS server
WORKDIR /app/server

# Dependencias de producción solamente
COPY server/package*.json ./
RUN npm install --omit=dev

# Código del servidor
COPY server/ ./

# Build del cliente, copiado a client/dist (server/index.js lo sirve desde ../client/dist)
COPY --from=client-build /app/client/dist /app/client/dist

# El auth.db del repo se usa solo como punto de partida si el volumen montado
# está vacío; en Azure Container Apps hay que montar un Azure Files en
# /app/server/database para que los usuarios y el registro de actividad
# persistan entre despliegues/reinicios (el filesystem del contenedor es efímero).
EXPOSE 3000
ENV PORT=3000

CMD ["node", "index.js"]
