// Autenticacao por JWT em cookie httpOnly. Simples e suficiente para a sala.

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { queries } from '../db.js';

export function sign(user) {
  return jwt.sign({ uid: user.id, u: user.username }, config.jwtSecret, {
    expiresIn: config.tokenTtl,
  });
}

// Popula req.user quando ha token valido; nunca bloqueia por si so.
export function attachUser(req, _res, next) {
  const token = req.cookies?.wz_token;
  if (token) {
    try {
      const { uid } = jwt.verify(token, config.jwtSecret);
      const user = queries.userById.get(uid);
      if (user) req.user = user;
    } catch {
      // token invalido/expirado: segue sem usuario
    }
  }
  next();
}

// Exige login. Use nas rotas que precisam de jogador autenticado.
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'login necessario' });
  next();
}
