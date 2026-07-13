const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' }));

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

const client = new MongoClient(uri);
let db;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('repositorio_ingles_violo');
        console.log('✅ Conexión segura establecida con MongoDB Atlas en la nube.');

        // Inicializar estadísticas si no existen
        const statsCount = await db.collection('platform_stats').countDocuments();
        if (statsCount === 0) {
            await db.collection('platform_stats').insertOne({
                views: 0, uploads: 0, downloads: 0, logs: []
            });
        }

        // Inicializar configuración institucional si no existe
        const configCount = await db.collection('institution_config').countDocuments();
        if (configCount === 0) {
            await db.collection('institution_config').insertOne({
                name: 'REPOSITORIO RED - INGLÉS DE LA I.E. DEL VIOLO',
                logo: ''
            });
        }

        // Crear administrador por defecto si no existe
        const adminExists = await db.collection('users').findOne({ username: 'admin' });
        if (!adminExists) {
            await db.collection('users').insertOne({
                username: 'admin',
                fullname: 'Administrador General',
                role: 'Administrador',
                pass: 'admin123'
            });
            console.log('👤 Usuario admin creado con contraseña por defecto: admin123');
        }
    } catch (e) {
        console.error('❌ Error de conexión a MongoDB:', e.message);
        process.exit(1);
    }
}

connectDB();

// -----------------------------------------------------------------------
// AUTENTICACIÓN
// -----------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { userIn, passIn, selectedRole } = req.body;
    try {
        const found = await db.collection('users').findOne({
            username: userIn, pass: passIn, role: selectedRole
        });
        if (found) {
            const now = new Date();
            const logEntry = {
                user: found.fullname, role: found.role,
                action: 'Ingresó a la plataforma',
                timestamp: now.toLocaleDateString('es-PE') + ' ' + now.toLocaleTimeString('es-PE')
            };
            await db.collection('platform_stats').updateOne(
                {},
                { $push: { logs: { $each: [logEntry], $position: 0 } }, $inc: { views: 1 } }
            );
            res.json({ success: true, user: found });
        } else {
            res.json({ success: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------
// GESTIÓN DE USUARIOS
// -----------------------------------------------------------------------
app.get('/api/users', async (req, res) => {
    try {
        const users = await db.collection('users').find({ username: { $ne: 'admin' } }).toArray();
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
    const { user, name, role, pass } = req.body;
    try {
        const result = await db.collection('users').insertOne({
            username: user, fullname: name, role, pass
        });
        res.json({ success: true, id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:username', async (req, res) => {
    try {
        await db.collection('users').deleteOne({ username: req.params.username });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:username', async (req, res) => {
    const { name, role, pass } = req.body;
    try {
        const update = { fullname: name, role };
        if (pass) update.pass = pass;
        await db.collection('users').updateOne(
            { username: req.params.username },
            { $set: update }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------
// MATERIALES DIDÁCTICOS (RECURSOS)
// -----------------------------------------------------------------------
app.get('/api/resources', async (req, res) => {
    try {
        const items = await db.collection('resources').find().toArray();
        res.json(items);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources', async (req, res) => {
    try {
        const resource = { ...req.body, ratingSum: 0, ratingCount: 0, comments: [] };
        const result = await db.collection('resources').insertOne(resource);
        await db.collection('platform_stats').updateOne({}, { $inc: { uploads: 1 } });
        res.json({ success: true, id: result.insertedId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/resources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        delete req.body._id;
        await db.collection('resources').updateOne(
            { _id: new ObjectId(id) },
            { $set: req.body }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/resources/:id', async (req, res) => {
    try {
        await db.collection('resources').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/rate', async (req, res) => {
    const { rating } = req.body;
    try {
        await db.collection('resources').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $inc: { ratingSum: rating, ratingCount: 1 } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resources/:id/comment', async (req, res) => {
    const { user, text, date } = req.body;
    try {
        await db.collection('resources').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $push: { comments: { user, text, date } } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// -----------------------------------------------------------------------
// ESTADÍSTICAS Y CONFIGURACIÓN INSTITUCIONAL
// -----------------------------------------------------------------------
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await db.collection('platform_stats').findOne({});
        res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stats/download', async (req, res) => {
    try {
        await db.collection('platform_stats').updateOne({}, { $inc: { downloads: 1 } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', async (req, res) => {
    try {
        const cfg = await db.collection('institution_config').findOne({});
        res.json(cfg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config', async (req, res) => {
    const { name, logo } = req.body;
    try {
        await db.collection('institution_config').updateOne(
            {},
            { $set: { name, logo } }
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ruta catch-all: devuelve el frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en http://0.0.0.0:${port}`);
});
