import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bugsRouter from './routes/bugs.js';
import projectsRouter from './routes/projects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

// Allow requests from the dashboard (same origin, no Origin header) and
// Chrome extension pages only — prevents arbitrary web pages from calling
// this API cross-origin even though it listens only on loopback.
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^chrome-extension:/.test(origin)) callback(null, true);
    else callback(new Error('Forbidden'));
  },
}));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/bugs', bugsRouter);
app.use('/api/projects', projectsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));

app.use((err, _req, res, _next) => {
  console.error('[Pinpoint]', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Pinpoint server running on http://localhost:${PORT}`);
});
