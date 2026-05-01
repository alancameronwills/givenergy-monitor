import express from 'express';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import readRoutes from './routes/read.js';
import writeRoutes from './routes/write.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(resolve(__dirname, '../public')));
app.use(readRoutes);
app.use(writeRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

export default app;
