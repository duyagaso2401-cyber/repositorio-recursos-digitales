# -----------------------------------------------------------------------
# Dockerfile — Repositorio RED Inglés I.E. DEL VIOLO
# Compatible con Render, Railway, Fly.io, VPS y cualquier host Docker.
# -----------------------------------------------------------------------

# Imagen base oficial de Node.js (versión LTS ligera)
FROM node:20-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar solo los archivos de dependencias primero (mejor caché)
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev

# Copiar el resto del código fuente
COPY . .

# Puerto expuesto (se puede sobreescribir con la variable PORT)
EXPOSE 5000

# Variable de entorno por defecto (los servidores cloud la sobreescriben)
ENV PORT=5000
ENV NODE_ENV=production

# Comando de arranque
CMD ["node", "server.js"]
