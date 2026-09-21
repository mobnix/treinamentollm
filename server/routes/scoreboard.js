// Placar. Publico por padrao (para projetar em tela), configuravel.

import { Router } from 'express';
import { config } from '../config.js';
import { scoreboard } from '../scoring.js';
import { requireUser } from '../middleware/auth.js';

export const scoreboardRouter = Router();

const guard = config.publicScoreboard ? (_req, _res, next) => next() : requireUser;

scoreboardRouter.get('/scoreboard', guard, (_req, res) => {
  res.json({ players: scoreboard(), scenario: config.scenarioName });
});
