// Registro, login e logout dos jogadores.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { queries, logEvent } from '../db.js';
import { sign } from '../middleware/auth.js';

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 12 * 60 * 60 * 1000,
};

function validName(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(u);
}

authRouter.post('/register', (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!validName(username)) {
    return res.status(400).json({ error: 'usuario deve ter 3 a 24 caracteres (letras, numeros, _ . -)' });
  }
  if (typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'senha deve ter ao menos 4 caracteres' });
  }
  if (queries.userByName.get(username)) {
    return res.status(409).json({ error: 'usuario ja existe' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = queries.createUser.run(username, hash, (displayName || username).slice(0, 40), Date.now());
  const user = queries.userById.get(info.lastInsertRowid);
  logEvent(user.id, 'register', username);
  res.cookie('wz_token', sign(user), cookieOpts);
  res.json({ ok: true, user: { username: user.username, displayName: user.display_name } });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = queries.userByName.get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'usuario ou senha invalidos' });
  }
  logEvent(user.id, 'login', username);
  res.cookie('wz_token', sign(user), cookieOpts);
  res.json({ ok: true, user: { username: user.username, displayName: user.display_name } });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('wz_token');
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { username: req.user.username, displayName: req.user.display_name } });
});
