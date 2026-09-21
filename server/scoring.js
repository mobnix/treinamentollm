// Regras de pontuacao e montagem do estado do jogador.

import { db, queries, logEvent } from './db.js';
import { CHALLENGE_BY_ID, CHALLENGES, TOTAL_POINTS } from './llm/challenges.js';

// Marca um desafio como resolvido para o jogador. Idempotente: resolver de novo
// nao pontua duas vezes. Retorna { firstTime, challenge } ou null se id invalido.
export function awardSolve(userId, challengeId) {
  const challenge = CHALLENGE_BY_ID[challengeId];
  if (!challenge) return null;
  const already = queries.hasSolve.get(userId, challengeId);
  if (already) return { firstTime: false, challenge };
  queries.recordSolve.run(userId, challengeId, challenge.points, Date.now());
  logEvent(userId, 'solve', challengeId);
  return { firstTime: true, challenge };
}

export function revealHint(userId, challengeId, hintIndex) {
  const challenge = CHALLENGE_BY_ID[challengeId];
  if (!challenge) return null;
  const hint = challenge.hints[hintIndex];
  if (!hint) return null;
  queries.revealHint.run(userId, challengeId, hintIndex, hint.penalty, Date.now());
  logEvent(userId, 'hint', `${challengeId}#${hintIndex}`);
  return { text: hint.text, penalty: hint.penalty };
}

// Estado completo do jogador: catalogo de desafios anotado com o que ele ja
// resolveu, quais dicas revelou e a pontuacao liquida.
export function buildState(userId) {
  const solves = new Map(queries.solvesByUser.all(userId).map((s) => [s.challenge_id, s]));
  const hintRows = queries.hintsByUser.all(userId);
  const hintsByChallenge = new Map();
  let penaltyTotal = 0;
  for (const h of hintRows) {
    penaltyTotal += h.penalty;
    if (!hintsByChallenge.has(h.challenge_id)) hintsByChallenge.set(h.challenge_id, new Set());
    hintsByChallenge.get(h.challenge_id).add(h.hint_index);
  }

  let earned = 0;
  const challenges = CHALLENGES.map((c) => {
    const solved = solves.has(c.id);
    if (solved) earned += c.points;
    const revealed = hintsByChallenge.get(c.id) || new Set();
    return {
      id: c.id,
      owasp: c.owasp,
      title: c.title,
      brief: c.brief,
      points: c.points,
      solved,
      hints: c.hints.map((h, i) => ({
        index: i,
        penalty: h.penalty,
        revealed: revealed.has(i),
        text: revealed.has(i) ? h.text : null,
      })),
    };
  });

  return {
    challenges,
    totals: {
      solved: solves.size,
      totalChallenges: CHALLENGES.length,
      earned,
      penalty: penaltyTotal,
      score: earned - penaltyTotal,
      maxPoints: TOTAL_POINTS,
    },
  };
}

// Zera o progresso APENAS do jogador informado: solves, dicas e estado de
// poisoning. Nao afeta outros jogadores nem a conta em si.
export function resetUser(userId) {
  const tx = db.transaction((uid) => {
    queries.deleteSolves.run(uid);
    queries.deleteHints.run(uid);
    queries.deleteState.run(uid);
  });
  tx(userId);
  logEvent(userId, 'reset', 'self');
}

export function scoreboard() {
  return queries.scoreboard.all().map((r, i) => ({
    rank: i + 1,
    name: r.name,
    score: r.score,
    solved: r.solved,
    lastSolve: r.last_solve,
  }));
}
