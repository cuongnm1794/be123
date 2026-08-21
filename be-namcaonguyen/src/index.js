import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { apiKeyAuth } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';
import questionsRouter from './routes/questions.js';
import simulationRouter from './routes/simulation.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ success: false, status: 'degraded', database: 'disconnected' });
  }
});

app.use('/api', apiKeyAuth, questionsRouter);
app.use('/api', apiKeyAuth, simulationRouter);

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Không tìm thấy route' });
});

app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});
