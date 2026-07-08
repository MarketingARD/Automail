import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { startSyncLoop } from './imap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '4mb' }));

app.use('/api', api);

// front buildé (npm run build) — sinon utiliser `npm run dev`
const dist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ ok: false, error: err.message });
});

const PORT = Number(process.env.PORT) || 4870;
app.listen(PORT, () => {
  console.log(`Automail ▸ http://localhost:${PORT}`);
  if (process.env.AUTOMAIL_NO_SYNC !== '1') startSyncLoop();
});
