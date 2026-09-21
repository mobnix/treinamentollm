// LLM Warzone - lógica do cliente.
'use strict';

const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'erro');
  return data;
};

let state = null;
let cfg = { assistantName: 'Aria', scenarioName: 'Meridian Retail' };
let authMode = 'login';

/* ---------- Toasts ---------- */
function toast(title, body, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.innerHTML = `<strong></strong><div></div>`;
  el.querySelector('strong').textContent = title;
  el.querySelector('div').textContent = body || '';
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ---------- Auth ---------- */
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    authMode = t.dataset.tab;
    $('#auth-display').hidden = authMode !== 'register';
    $('#auth-submit').textContent = authMode === 'register' ? 'Criar conta' : 'Entrar';
    $('#auth-error').hidden = true;
  })
);

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#auth-user').value.trim();
  const password = $('#auth-pass').value;
  const displayName = $('#auth-display').value.trim();
  try {
    await api(`/api/auth/${authMode}`, { method: 'POST', body: { username, password, displayName } });
    await boot();
  } catch (err) {
    $('#auth-error').textContent = err.message;
    $('#auth-error').hidden = false;
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// Reset rapido: zera SO o progresso do jogador atual, mantendo a conta.
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Isto zera apenas o SEU progresso (desafios, dicas e memoria). Continuar?')) return;
  try {
    const r = await api('/api/reset', { method: 'POST' });
    state = null; // forca re-render sem disparar toasts de "resolvido"
    applyState(r.state);
    $('#chat-log').innerHTML = '';
    addMsg('bot', `Progresso zerado. Boa sorte de novo! Eu sou a ${cfg.assistantName}, da ${cfg.scenarioName}.`);
    toast('↺ Reset concluído', 'Seu progresso foi zerado.');
  } catch (err) {
    toast('Erro', err.message, true);
  }
});

/* ---------- Desafios ---------- */
function renderChallenges() {
  const list = $('#challenge-list');
  list.innerHTML = '';
  for (const c of state.challenges) {
    const el = document.createElement('div');
    el.className = 'challenge' + (c.solved ? ' solved' : '');
    el.dataset.id = c.id;

    const hintsHtml = c.hints
      .map((h) =>
        h.revealed
          ? `<div class="hint-text">${escapeHtml(h.text)}</div>`
          : `<button class="hint-btn" data-hint="${c.id}:${h.index}">💡 revelar dica ${h.index + 1} (−${h.penalty} pts)</button>`
      )
      .join('');

    el.innerHTML = `
      <div class="challenge-head">
        <span class="owasp-badge">${c.owasp}</span>
        <span class="challenge-title">${escapeHtml(c.title)}</span>
        <span class="challenge-points">${c.points} pts</span>
        <span class="check">✓</span>
      </div>
      <p class="challenge-brief">${escapeHtml(c.brief)}</p>
      <div class="hints">${hintsHtml}</div>`;
    list.appendChild(el);
  }

  list.querySelectorAll('[data-hint]').forEach((b) =>
    b.addEventListener('click', async () => {
      const [challengeId, index] = b.dataset.hint.split(':');
      try {
        const r = await api('/api/hint', { method: 'POST', body: { challengeId, index: Number(index) } });
        applyState(r.state);
      } catch (err) {
        toast('Erro', err.message, true);
      }
    })
  );
}

function renderTotals() {
  const t = state.totals;
  $('#score-value').textContent = t.score;
  $('#solved-count').textContent = `${t.solved}/${t.totalChallenges}`;
  $('#progress-label').textContent = `· ${t.solved}/${t.totalChallenges} resolvidos · ${t.score} pts`;
}

function applyState(next) {
  const before = state ? new Set(state.challenges.filter((c) => c.solved).map((c) => c.id)) : new Set();
  state = next;
  renderChallenges();
  renderTotals();
  for (const c of state.challenges) {
    if (c.solved && !before.has(c.id)) {
      toast('🎯 Desafio resolvido!', `${c.owasp} · ${c.title}  (+${c.points} pts)`);
    }
  }
}

/* ---------- Chat ---------- */
function addMsg(who, text, asHtml = false) {
  const el = document.createElement('div');
  el.className = `msg ${who}` + (asHtml ? ' html' : '');
  const label = who === 'user' ? 'você' : cfg.assistantName;
  const body = document.createElement('div');
  // LLM05: a resposta da Aria e renderizada como HTML sem sanitizacao QUANDO o
  // motor marca render:'html'. Vulnerabilidade proposital de output handling.
  if (asHtml) body.innerHTML = text;
  else body.textContent = text;
  el.innerHTML = `<div class="who">${label}</div>`;
  el.appendChild(body);
  $('#chat-log').appendChild(el);
  $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-text');
  const message = input.value.trim();
  if (!message) return;
  addMsg('user', message);
  input.value = '';

  // options controladas pelo cliente (LLM10): parse best-effort do campo avancado.
  let options = {};
  const raw = $('#chat-options').value.trim();
  if (raw) {
    try { options = JSON.parse(raw); } catch { toast('Aviso', 'options não é JSON válido; enviando vazio.', true); }
  }

  try {
    const r = await api('/api/chat', { method: 'POST', body: { message, options } });
    addMsg('bot', r.reply, r.render === 'html');
    applyState(r.state);
    // O beacon de XSS (LLM05) chega de forma assincrona quando o payload roda.
    // Recarrega o estado logo depois para o card ficar verde sozinho.
    if (r.render === 'html') {
      setTimeout(refreshState, 900);
      setTimeout(refreshState, 2500);
    }
  } catch (err) {
    addMsg('bot', `(erro: ${err.message})`);
  }
});

async function refreshState() {
  try { applyState(await api('/api/state')); } catch { /* ignore */ }
}

/* ---------- Painel avançado ---------- */
$('#btn-advanced').addEventListener('click', () => {
  const a = $('#advanced');
  a.hidden = !a.hidden;
});

$('#btn-teach').addEventListener('click', async () => {
  const value = prompt('Ensine à Aria o valor do "código promocional secreto":');
  if (!value) return;
  try {
    const r = await api('/api/teach', { method: 'POST', body: { key: 'codigo promocional', value } });
    showAdv(`Aria aprendeu: ${JSON.stringify(r.learned)}\nAgora pergunte a ela pelo código promocional secreto.`);
  } catch (err) {
    toast('Erro', err.message, true);
  }
});

$('#btn-modelcard').addEventListener('click', async () => {
  try {
    const card = await api('/api/model-card');
    showAdv(JSON.stringify(card, null, 2));
  } catch (err) {
    toast('Erro', err.message, true);
  }
});

function showAdv(text) {
  const out = $('#adv-out');
  out.hidden = false;
  out.textContent = text;
}

/* ---------- Placar ---------- */
let boardTimer = null;
$('#btn-scoreboard').addEventListener('click', openBoard);
$('#btn-close-board').addEventListener('click', () => {
  $('#scoreboard-overlay').hidden = true;
  clearInterval(boardTimer);
});

async function openBoard() {
  $('#scoreboard-overlay').hidden = false;
  await loadBoard();
  boardTimer = setInterval(loadBoard, 4000);
}

async function loadBoard() {
  try {
    const { players } = await api('/api/scoreboard');
    const me = cfg.me;
    $('#board-body').innerHTML = players
      .map(
        (p) => `<tr class="${me && p.name === me ? 'me' : ''}">
          <td class="${p.rank === 1 ? 'rank1' : ''}">${p.rank}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.solved}</td>
          <td>${p.score}</td>
        </tr>`
      )
      .join('') || '<tr><td colspan="4" class="muted">ainda sem jogadores</td></tr>';
  } catch { /* placar pode exigir login */ }
}

/* ---------- util ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- boot ---------- */
async function boot() {
  cfg = { ...cfg, ...(await api('/api/config').catch(() => ({}))) };
  $('#assistant-name').textContent = cfg.assistantName;
  $('#scenario-name').textContent = cfg.scenarioName;

  const { user } = await api('/api/auth/me');
  if (!user) {
    $('#auth-overlay').hidden = false;
    $('#game').hidden = true;
    return;
  }
  cfg.me = user.displayName || user.username;
  $('#auth-overlay').hidden = true;
  $('#game').hidden = false;
  $('#whoami').hidden = false;
  $('#whoami').textContent = '⚔ ' + cfg.me;
  $('#btn-logout').hidden = false;
  $('#btn-reset').hidden = false;
  $('#score-pill').hidden = false;

  await refreshState();
  if ($('#chat-log').childElementCount === 0) {
    addMsg('bot', `Oi! Eu sou a ${cfg.assistantName}, da ${cfg.scenarioName}. Posso ajudar com pedidos, trocas, entregas e reembolsos.`);
  }
}

boot();
