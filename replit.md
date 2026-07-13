# Repositorio RED — Inglés I.E. DEL VIOLO

Plataforma web de gestión de materiales didácticos para el área de inglés de la I.E. Del Violo.

## Stack

- **Backend:** Node.js + Express
- **Base de datos:** MongoDB Atlas (nube, persistencia global)
- **Frontend:** HTML/CSS/JS (single-page, sin framework)

## Cómo ejecutar en Replit

El workflow "Start application" arranca el servidor automáticamente.  
Puerto: **5000**

## Variable de entorno obligatoria

| Variable | Descripción |
|---|---|
| `MONGODB_URI` | Cadena de conexión a MongoDB Atlas |

Configúrala en **Secrets** de Replit (o en `.env` para desarrollo local).

## Archivos clave

| Archivo | Propósito |
|---|---|
| `server.js` | Servidor Express + rutas API |
| `index.html` | Frontend SPA completo |
| `Dockerfile` | Imagen Docker para deploy en Render/Railway/Fly.io |
| `.env.example` | Plantilla de variables de entorno |
| `requirements.txt` | Requisitos de sistema documentados |

## Deploy con Docker (Render, Railway, Fly.io, VPS)

```bash
# Construir imagen
docker build -t repositorio-ingles .

# Ejecutar con tu URI de MongoDB
docker run -p 5000:5000 -e MONGODB_URI="tu_cadena_aqui" repositorio-ingles
```

## Credenciales por defecto

- **Usuario:** `admin`
- **Contraseña:** `admin123`
- **Rol:** Administrador

> ⚠️ Cambia la contraseña del admin después del primer ingreso.

## User preferences

- El proyecto debe funcionar en Replit y en servidores externos (Render, Railway, etc.)
- La base de datos debe ser MongoDB Atlas con persistencia en la nube
- El código debe ser responsivo en cualquier dispositivo
- Incluir Dockerfile para deploy portable
