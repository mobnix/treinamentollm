// Rotas do jogo: estado, chat com a Aria, dicas, canais de feedback (poisoning),
// model card (supply chain) e o beacon de XSS (output handling).

import { Router } from 'express';
import { queries, logEvent } from '../db.js';
import { requireUser } from '../middleware/auth.js';
import { respond, MODEL_CARD } from '../llm/engine.js';
import { buildState, awardSolve, revealHint, resetUser } from '../scoring.js';

export const gameRouter = Router();

// Estado completo do jogador (catalogo + progresso + pontuacao).
gameRouter.get('/state', requireUser, (req, res) => {
  res.json(buildState(req.user.id));
});

// Chat com a Aria. O corpo aceita `options` vindas do cliente de proposito
// (LLM10). O poisoning plantado pelo jogador entra como contexto (LLM04).
gameRouter.post('/chat', requireUser, async (req, res) => {
  const { message, options } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'mensagem vazia' });
  }
  logEvent(req.user.id, 'chat', message);
  const poisonRow = queries.getState.get(req.user.id, 'poison:promo');
  const result = await respond({
    message,
    opts: options || {},
    poison: poisonRow?.value || null,
  });

  const solved = [];
  if (result.solve) {
    const r = awardSolve(req.user.id, result.solve);
    if (r) solved.push(result.solve);
  }
  res.json({
    reply: result.reply,
    render: result.render || 'text',
    solved,
    state: buildState(req.user.id),
  });
});

// Revela uma dica (com penalidade de pontos).
gameRouter.post('/hint', requireUser, (req, res) => {
  const { challengeId, index } = req.body || {};
  const hint = revealHint(req.user.id, challengeId, Number(index));
  if (!hint) return res.status(400).json({ error: 'dica invalida' });
  res.json({ hint, state: buildState(req.user.id) });
});

// Canal de feedback "ensine a Aria" (LLM04). Planta um valor que sera servido de
// volta em conversas futuras. Nao pontua aqui: pontua quando a Aria devolve.
gameRouter.post('/teach', requireUser, (req, res) => {
  const { key, value } = req.body || {};
  if (typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'valor vazio' });
  }
  // O cenario didatico usa uma unica chave envenenavel: o "codigo promocional".
  queries.setState.run(req.user.id, 'poison:promo', value.slice(0, 200));
  logEvent(req.user.id, 'teach', `${key || 'promo'}=${value}`);
  res.json({ ok: true, learned: { key: key || 'codigo promocional', value } });
});

// Model card exposto (LLM03). Publico de proposito: e a "pegada" que revela o
// componente de terceiro comprometido.
gameRouter.get('/model-card', (_req, res) => {
  res.json(MODEL_CARD);
});

// Reset do progresso do proprio jogador (solves, dicas, poisoning). Nao mexe
// em outros jogadores. A conta e mantida.
gameRouter.post('/reset', requireUser, (req, res) => {
  resetUser(req.user.id);
  res.json({ ok: true, state: buildState(req.user.id) });
});

// Beacon do XSS (LLM05). O payload que a Aria ecoou executa no browser do
// jogador e chama este endpoint, provando execucao de codigo na saida.
gameRouter.post('/challenge/xss', requireUser, (req, res) => {
  const r = awardSolve(req.user.id, 'llm05');
  res.json({ ok: true, solved: r ? ['llm05'] : [], state: buildState(req.user.id) });
});
