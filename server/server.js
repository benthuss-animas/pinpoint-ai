import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bugsRouter from './routes/bugs.js';
import projectsRouter from './routes/projects.js';
import githubRouter from './routes/github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/bugs', bugsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/github', githubRouter); // kept for future use

app.get('/health', (_req, res) => res.json({ status: 'ok', port: PORT }));

app.listen(PORT, () => {
  console.log(`Pinpoint server running on http://localhost:${PORT}`);
});
