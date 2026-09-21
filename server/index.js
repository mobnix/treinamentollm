// Servidor da LLM Warzone. Monta as rotas, serve o front e sobe na porta.

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import './db.js'; // inicializa o schema
import { attachUser } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { gameRouter } from './routes/game.js';
import { scoreboardRouter } from './routes/scoreboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(attachUser);

// Config publica consumida pelo front (nomes do cenario, flags de UI).
app.get('/api/config', (_req, res) => {
  res.json({
    scenarioName: config.scenarioName,
    assistantName: config.assistantName,
    publicScoreboard: config.publicScoreboard,
    engine: config.llmEngine,
  });
});

app.use('/api/auth', authRouter);
app.use('/api', gameRouter);
app.use('/api', scoreboardRouter);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(config.port, () => {
  console.log(`LLM Warzone no ar em http://localhost:${config.port}  (motor: ${config.llmEngine})`);
});
