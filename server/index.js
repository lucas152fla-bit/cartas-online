import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { api } from './api.js';
import { setupRealtime } from './realtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/api', api);

app.use(
  express.static(publicDir, {
    extensions: ['html'],
    setHeaders: (res, path) => {
      if (path.endsWith('sw.js') || path.endsWith('.js') || path.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  })
);

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.includes('.')) {
    return res.sendFile(join(publicDir, 'index.html'));
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: 'Não encontrado.' }));

const server = createServer(app);
const io = setupRealtime(server);
app.set('io', io);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  const dbExists = existsSync(join(__dirname, '..', 'data', 'cartas.db'));
  console.log(`\n🃏  Cartas Online rodando em http://localhost:${PORT}`);
  console.log(`    Banco: ${dbExists ? 'data/cartas.db' : 'novo'}\n`);
});
