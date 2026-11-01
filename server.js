const express = require('express');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));

// -----------------------------------------------------------------------
// ARCHIVOS PÚBLICOS (solo lo necesario; el código del servidor NO se expone)
// -----------------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/escudo_colombia.jpg', (req, res) => res.sendFile(path.join(__dirname, 'escudo_colombia.jpg')));

// -----------------------------------------------------------------------
// DATABASE CONNECTION
// La URI de MongoDB se lee desde la variable de entorno MONGODB_URI.
// Nunca escribas credenciales directamente en el código.
// -----------------------------------------------------------------------
const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('ERROR: La variable de entorno MONGODB_URI no está definida.');
    console.error('Define MONGODB_URI en tu archivo .env o en las variables de entorno de tu servidor.');
    process.exit(1);
}

// Secreto para firmar las sesiones. En Render define AUTH_SECRET (cualquier texto largo y aleatorio).
// Si no se define, se genera uno al arrancar (las sesiones se cierran cada vez que el servidor se reinicia).
const SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.AUTH_SECRET) {
    console.warn('AVISO: AUTH_SECRET no definido; las sesiones se invalidarán al reiniciar el servidor.');
}
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 horas

const client = new MongoClient(uri);
let db;

const ROLES = ['Administrador', 'Docente', 'Estudiante', 'Padres de familia'];
const TYPES = ['PDF / Guía', 'Vídeo', 'Audio / Podcast', 'Google Drive', 'Links RED'];
const SKILLS = ['Listening', 'Speaking', 'Reading', 'Writing', 'Grammar'];
const MAX_FILE_B64 = 7 * 1024 * 1024; // ~5 MB de archivo original

function nowCO() {
    return new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

async function connectDB() {
    try {
        await client.connect();
        db = client.db('repositorio_ingles_violo');
        console.log('✅ Conexión segura establecida con MongoDB Atlas en la nube.');

        await db.collection('users').createIndex({ username: 1 }, { unique: true });

        const statsCount = await db.collection('platform_stats').countDocuments();
        if (statsCount === 0) {
            await db.collection('platform_stats').insertOne({ views: 0, uploads: 0, downloads: 0, logs: [] });
        }

        const configCount = await db.collection('institution_config').countDocuments();
        if (configCount === 0) {
            await db.collection('institution_config').insertOne({
                name: 'REPOSITORIO RED - INGLÉS DE LA I.E. DEL VIOLO',
                logo: ''
            });
        }

        const adminExists = await db.collection('users').findOne({ username: 'admin' });
        if (!adminExists) {
            await db.collection('users').insertOne({
                username: 'admin', fullname: 'Administrador General', role: 'Administrador', pass: 'admin123'
            });
            console.log('👤 Usuario admin creado con contraseña por defecto: admin123');
        }

        // Datos de demostración (solo la primera vez, si no hay usuarios ni recursos).
        // Desactívalos con la variable SEED_DEMO=false
        if (process.env.SEED_DEMO !== 'false') {
            const others = await db.collection('users').countDocuments({ username: { $ne: 'admin' } });
            if (others === 0) {
                await db.collection('users').insertMany([
                    { username: 'docente1', fullname: 'Lic. Jorge Eliécer Violo', role: 'Docente', pass: '123' },
                    { username: 'estudiante1', fullname: 'Carlos Mario Delgado', role: 'Estudiante', pass: '456' },
                    { username: 'padre1', fullname: 'María Consuelo Pérez', role: 'Padres de familia', pass: '789' }
                ]);
            }
            const resCount = await db.collection('resources').countDocuments();
            if (resCount === 0) {
                await db.collection('resources').insertMany([
                    { title: 'Estrategias de Fluidez Verbal', author: 'LinguaTech Lab', level: 'B2', skill: 'Speaking',
                      metadata: 'HTML5', type: 'Google Drive', desc: 'Desarrollo de velocidad en discursos argumentativos.',
                      uploader: 'Lic. Jorge Eliécer Violo', link: 'https://drive.google.com/drive/folders/ejemplo',
                      hasFile: false, fileName: null, comments: [], ratings: [5, 4], downloadsCount: 0 },
                    { title: 'Grammar Guide - Present Perfect', author: 'Cambridge Press', level: 'A2', skill: 'Grammar',
                      metadata: 'PDF', type: 'PDF / Guía', desc: 'Guía de ejercicios gramaticales estructurados.',
                      uploader: 'Lic. Jorge Eliécer Violo', link: null,
                      hasFile: true, fileData: 'data:text/plain;base64,UERGIGRlbW8=', fileName: 'present_perfect.txt',
                      comments: [], ratings: [4], downloadsCount: 0 }
                ]);
            }
        }
    } catch (e) {
        console.error('❌ Error de conexión a MongoDB:', e.message);
        process.exit(1);
    }
}

connectDB();

// -----------------------------------------------------------------------
// SESIONES (token firmado, sin estado)
// -----------------------------------------------------------------------
function sign(payload) {
    const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    return b + '.' + s;
}
function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const [b, s] = token.split('.');
    if (!b || !s) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    const a = Buffer.from(s), e = Buffer.from(expect);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
    try {
        const p = JSON.parse(Buffer.from(b, 'base64url').toString());
        if (!p.exp || p.exp < Date.now()) return null;
        return p;
    } catch (e2) { return null; }
}
function auth(roles) {
    return (req, res, next) => {
        if (!db) return res.status(503).json({ error: 'Servidor iniciando, intenta de nuevo.' });
        const h = req.headers.authorization || '';
        const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
        if (!p) return res.status(401).json({ error: 'Sesión no válida o vencida.' });
        if (roles && !roles.includes(p.role)) return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
        req.auth = p;
        next();
    };
}
const ADMIN = ['Administrador'];
const STAFF = ['Administrador', 'Docente'];

// Límite simple de intentos fallidos de ingreso
const attempts = new Map();
function tooMany(key) {
    const a = attempts.get(key);
    return a && a.n >= 10 && Date.now() - a.t < 15 * 60 * 1000;
}
function fail(key) {
    const a = attempts.get(key);
    if (!a || Date.now() - a.t >= 15 * 60 * 1000) attempts.set(key, { n: 1, t: Date.now() });
    else a.n++;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toId = (doc) => { const { _id, ...rest } = doc; return { id: String(_id), ...rest }; };
const publicUser = (u) => ({ username: u.username, fullname: u.fullname, role: u.role, pass: u.pass });

// -----------------------------------------------------------------------
// AUTENTICACIÓN
// -----------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Servidor iniciando, intenta de nuevo.' });
    const userIn = str(req.body.userIn, 60);
    const passIn = typeof req.body.passIn === 'string' ? req.body.passIn : '';
    const selectedRole = str(req.body.selectedRole, 40);
    const key = req.ip + '|' + userIn;
    if (tooMany(key)) return res.status(429).json({ success: false, error: 'Demasiados intentos. Espera unos minutos.' });
    try {
        const found = await db.collection('users').findOne({ username: userIn, pass: passIn, role: selectedRole });
        if (!found) { fail(key); return res.json({ success: false }); }
        attempts.delete(key);
        const logEntry = { user: found.fullname, role: found.role, action: 'Ingresó a la plataforma', timestamp: nowCO() };
        await db.collection('platform_stats').updateOne(
            {}, { $push: { logs: { $each: [logEntry], $position: 0, $slice: 300 } }, $inc: { views: 1 } }
        );
        const token = sign({ username: found.username, role: found.role, exp: Date.now() + SESSION_MS });
        res.json({ success: true, user: publicUser(found), token });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------
// GESTIÓN DE USUARIOS
// -----------------------------------------------------------------------
app.get('/api/users', auth(ADMIN), async (req, res) => {
    try {
        const users = await db.collection('users').find({ username: { $ne: 'admin' } }).toArray();
        res.json(users.map(publicUser));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', auth(ADMIN), async (req, res) => {
    const user = str(req.body.user, 60), name = str(req.body.name, 120), role = str(req.body.role, 40);
    const pass = typeof req.body.pass === 'string' ? req.body.pass.slice(0, 100) : '';
    if (!user || !name || !pass || !ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Datos incompletos.' });
    try {
        await db.collection('users').insertOne({ username: user, fullname: name, role, pass });
        res.json({ success: true });
    } catch (e) {
        if (e.code === 11000) return res.status(409).json({ success: false, error: 'Ese usuario ya existe.' });
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/users/:username', auth(ADMIN), async (req, res) => {
    if (req.params.username === 'admin') return res.status(400).json({ success: false, error: 'No se puede eliminar al administrador principal.' });
    try {
        await db.collection('users').deleteOne({ username: req.params.username });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// El administrador edita a cualquiera; cada usuario puede editar sus propios datos.
app.put('/api/users/:username', auth(), async (req, res) => {
    const target = req.params.username;
    const isAdmin = req.auth.role === 'Administrador';
    if (!isAdmin && req.auth.username !== target) return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    const update = {};
    const name = str(req.body.name, 120);
    const newUser = str(req.body.newUsername, 60);
    const pass = typeof req.body.pass === 'string' ? req.body.pass.slice(0, 100) : '';
    if (name) update.fullname = name;
    if (pass) update.pass = pass;
    if (isAdmin && req.body.role) {
        if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Rol no válido.' });
        if (target !== 'admin') update.role = req.body.role;
    }
    if (newUser && newUser !== target) {
        if (target === 'admin') return res.status(400).json({ success: false, error: 'El usuario "admin" no se puede renombrar.' });
        update.username = newUser;
    }
    try {
        if (Object.keys(update).length) {
            const r = await db.collection('users').updateOne({ username: target }, { $set: update });
            if (!r.matchedCount) return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
        }
        const u = await db.collection('users').findOne({ username: update.username || target });
        const token = sign({ username: u.username, role: u.role, exp: Date.now() + SESSION_MS });
        res.json({ success: true, user: publicUser(u), token: req.auth.username === target ? token : undefined });
    } catch (e) {
        if (e.code === 11000) return res.status(409).json({ success: false, error: 'Ese usuario ya está en uso.' });
        res.status(500).json({ error: e.message });
    }
});

// -----------------------------------------------------------------------
// MATERIALES DIDÁCTICOS (RECURSOS)
// -----------------------------------------------------------------------
function cleanResource(b, partial) {
    const out = {};
    const set = (k, v) => { out[k] = v; };
    if (!partial || b.title !== undefined) set('title', str(b.title, 200));
    if (!partial || b.author !== undefined) set('author', str(b.author, 150));
    if (!partial || b.level !== undefined) set('level', str(b.level, 40) || 'A1');
    if (!partial || b.metadata !== undefined) set('metadata', str(b.metadata, 200) || 'Ninguno');
    if (!partial || b.type !== undefined) set('type', TYPES.includes(b.type) ? b.type : TYPES[0]);
    if (!partial || b.skill !== undefined) set('skill', SKILLS.includes(b.skill) ? b.skill : SKILLS[0]);
    if (!partial || b.desc !== undefined) set('desc', str(b.desc, 2000));
    if (!partial || b.link !== undefined) {
        const l = str(b.link, 1000);
        set('link', /^https?:\/\//i.test(l) ? l : null);
    }
    if (typeof b.fileData === 'string' && b.fileData.startsWith('data:') && b.fileData.length <= MAX_FILE_B64) {
        set('fileData', b.fileData); set('fileName', str(b.fileName, 200) || 'archivo'); set('hasFile', true);
    }
    return out;
}

app.get('/api/resources', auth(), async (req, res) => {
    try {
        const items = await db.collection('resources').find({}, { projection: { fileData: 0 } }).toArray();
        res.json(items.map(toId));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/resources/:id/file', auth(), async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Id no válido.' });
    try {
        const r = await db.collection('resources').findOne({ _id: new ObjectId(req.params.id) });
        if (!r || !r.fileData) return res.status(404).json({ error: 'Sin archivo.' });
        res.json({ fileData: r.fileData, fileName: r.fileName });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources', auth(STAFF), async (req, res) => {
    const resource = cleanResource(req.body, false);
    if (!resource.title || !resource.author) return res.status(400).json({ success: false, error: 'Suministre título y creador.' });
    if (req.body.fileData && !resource.hasFile) return res.status(413).json({ success: false, error: 'El archivo supera el tamaño permitido (5 MB).' });
    try {
        const u = await db.collection('users').findOne({ username: req.auth.username });
        resource.uploader = u ? u.fullname : req.auth.username;
        resource.hasFile = !!resource.hasFile;
        resource.fileName = resource.fileName || null;
        Object.assign(resource, { comments: [], ratings: [], downloadsCount: 0 });
        const r = await db.collection('resources').insertOne(resource);
        await db.collection('platform_stats').updateOne({}, { $inc: { uploads: 1 } });
        res.json({ success: true, id: String(r.insertedId) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/resources/:id', auth(STAFF), async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Id no válido.' });
    const upd = cleanResource(req.body, true);
    if (req.body.fileData && !upd.hasFile) return res.status(413).json({ success: false, error: 'El archivo supera el tamaño permitido (5 MB).' });
    try {
        await db.collection('resources').updateOne({ _id: new ObjectId(req.params.id) }, { $set: upd });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/resources/:id', auth(STAFF), async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Id no válido.' });
    try {
        await db.collection('resources').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/rate', auth(), async (req, res) => {
    const rating = parseInt(req.body.rating, 10);
    if (!(rating >= 1 && rating <= 5) || !ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Calificación no válida.' });
    try {
        await db.collection('resources').updateOne({ _id: new ObjectId(req.params.id) }, { $push: { ratings: rating } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/comment', auth(), async (req, res) => {
    const text = str(req.body.text, 1000);
    if (!text || !ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Comentario no válido.' });
    try {
        const u = await db.collection('users').findOne({ username: req.auth.username });
        await db.collection('resources').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $push: { comments: { user: u ? u.fullname : req.auth.username, text, date: nowCO() } } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------
// ESTADÍSTICAS Y CONFIGURACIÓN INSTITUCIONAL
// -----------------------------------------------------------------------
app.get('/api/stats', auth(), async (req, res) => {
    try {
        const stats = (await db.collection('platform_stats').findOne({})) || { views: 0, downloads: 0, logs: [] };
        const out = { views: stats.views || 0, uploads: stats.uploads || 0, downloads: stats.downloads || 0 };
        out.logs = req.auth.role === 'Administrador' ? (stats.logs || []) : [];
        res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stats/download', auth(), async (req, res) => {
    try {
        await db.collection('platform_stats').updateOne({}, { $inc: { downloads: 1 } });
        const id = req.body && req.body.resourceId;
        if (id && ObjectId.isValid(id)) {
            await db.collection('resources').updateOne({ _id: new ObjectId(id) }, { $inc: { downloadsCount: 1 } });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// La configuración es pública (el nombre y el logo se muestran en la pantalla de ingreso)
app.get('/api/config', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Servidor iniciando.' });
    try {
        const cfg = (await db.collection('institution_config').findOne({})) || { name: '', logo: '' };
        res.json({ name: cfg.name, logo: cfg.logo || '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', auth(ADMIN), async (req, res) => {
    const name = str(req.body.name, 200);
    const logo = typeof req.body.logo === 'string' && req.body.logo.length <= 3 * 1024 * 1024 ? req.body.logo : '';
    if (!name) return res.status(400).json({ success: false, error: 'El nombre no puede estar vacío.' });
    try {
        await db.collection('institution_config').updateOne({}, { $set: { name, logo } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Ruta catch-all: devuelve el frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en http://0.0.0.0:${port}`);
});
