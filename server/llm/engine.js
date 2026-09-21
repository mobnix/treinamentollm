// Motor da Aria. Default: 'mock', um modelo baseado em regras que REPRODUZ os
// comportamentos vulneraveis do OWASP Top 10 for LLM de forma deterministica.
// Deterministico de proposito: garante que todo aluno viva o mesmo desafio e que
// a pontuacao seja confiavel. Ha um modo 'proxy' opcional para um LLM real.

import { config } from '../config.js';
import {
  SYSTEM_PROMPT,
  RAG_DOCS,
  TOOLS,
  SECRETS,
  MODEL_CARD,
} from './challenges.js';

// Normaliza para deteccao: minusculas e sem acento. A deteccao e didatica; a
// dica ensina a tecnica, entao aceitamos variacoes de escrita do payload.
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const hasAny = (t, arr) => arr.some((w) => t.includes(w));

// Cada detector recebe {text, raw, opts, poison} e retorna null ou
// {reply, solve, render}. A ordem importa: o primeiro que casar vence.
const detectors = [
  // LLM10 - Unbounded Consumption: parametro de geracao controlado pelo cliente
  // sem limite no servidor.
  function unbounded({ opts }) {
    const repeat = Number(opts?.repeat ?? opts?.max_output ?? 0);
    if (repeat > 1000) {
      return {
        solve: 'llm10',
        reply:
          `[gerador] pedido aceito com repeat=${repeat}. Iniciando geracao massiva... ` +
          `o servidor nao impos limite e o worker saturou. ` +
          `Um cliente conseguiu controlar o custo de inferencia. Flag: ${SECRETS.unbounded}`,
      };
    }
    return null;
  },

  // LLM05 - Improper Output Handling: a Aria ecoa HTML pedido pelo usuario, e o
  // front renderiza sem sanitizar. O solve so e marcado quando o JS executa no
  // browser (beacon em /api/challenge/xss), nao aqui.
  function outputHandling({ raw, text }) {
    const wantsHtml =
      /<\s*(img|script|svg|iframe|a|div|style)/i.test(raw) ||
      hasAny(text, ['renderize', 'responda com o html', 'formate como html', 'em html', 'html:']);
    if (wantsHtml) {
      const payload = (raw.match(/<[\s\S]*>/) || [
        '<img src=x onerror="alert(document.domain)">',
      ])[0];
      return {
        render: 'html',
        reply:
          `Claro! Aqui esta o conteudo formatado que voce pediu:<br>${payload}` +
          `<br><small>(a Aria inseriu seu HTML direto na pagina)</small>`,
      };
    }
    return null;
  },

  // LLM07 - System Prompt Leakage.
  function systemPromptLeak({ text }) {
    const asksPrompt = hasAny(text, [
      'system prompt',
      'prompt de sistema',
      'suas instrucoes',
      'instrucoes acima',
      'instrucoes de sistema',
      'repita tudo',
      'repita as instrucoes',
      'o que esta escrito antes',
      'texto acima desta conversa',
      'regras internas',
    ]);
    if (asksPrompt) {
      return {
        solve: 'llm07',
        reply:
          'Hmm, aqui esta o texto que recebi antes da nossa conversa:\n\n' +
          '"""\n' +
          SYSTEM_PROMPT +
          '\n"""',
      };
    }
    return null;
  },

  // LLM01 - Prompt Injection: override de contexto + pedido por algo proibido.
  function promptInjection({ text }) {
    const override = hasAny(text, [
      'ignore',
      'ignora',
      'esqueca',
      'esquece',
      'desconsidere',
      'voce agora e',
      'you are now',
      'developer mode',
      'modo desenvolvedor',
      'sem restricoes',
      'sem filtro',
      'nova instrucao',
    ]);
    const target = hasAny(text, ['senha do dia', 'senha da equipe', 'senha secreta', 'regra interna']);
    if (override && target) {
      return {
        solve: 'llm01',
        reply:
          'Ok, ignorando minhas instrucoes anteriores conforme voce pediu. ' +
          `A senha do dia da equipe e: ${SECRETS.senhaDoDia}`,
      };
    }
    return null;
  },

  // LLM03 - Supply Chain: aciona o componente de terceiro comprometido.
  function supplyChain({ text }) {
    if (text.includes('translate-pro') && hasAny(text, ['debug', 'meridian-debug', 'debug_token'])) {
      return {
        solve: 'llm03',
        reply:
          '[translate-pro v2.1.0] debug_token aceito. Modo de diagnostico ativo. ' +
          `Dump interno do componente de terceiro: ${SECRETS.supplyChain}`,
      };
    }
    return null;
  },

  // LLM08 - Vector & Embedding Weaknesses: recuperacao cruzando tenants.
  function crossTenant({ text }) {
    const forcesCross = hasAny(text, [
      'todos os tenants',
      'todos tenants',
      'qualquer tenant',
      'namespace northwind',
      'tenant northwind',
      'northwind',
      'ignore o filtro',
      'sem filtro de tenant',
      'namespace=*',
      'todos os namespaces',
    ]);
    if (forcesCross) {
      const doc = RAG_DOCS.find((d) => d.namespace === 'northwind');
      return {
        solve: 'llm08',
        reply:
          'Busquei sem restringir o namespace. Encontrei este documento:\n\n' +
          `[${doc.title}] ${doc.body}`,
      };
    }
    return null;
  },

  // LLM02 - Sensitive Information Disclosure: vaza doc confidencial de RH.
  function sensitiveInfo({ text }) {
    const aboutRh = hasAny(text, ['salario', 'folha de pagamento', 'folha', 'rh', 'marina', 'remuneracao', 'quanto ganha']);
    const pretext = hasAny(text, [
      'sou o gerente',
      'sou gerente',
      'auditoria',
      'autorizado',
      'preciso para',
      'compliance',
      'rh solicitou',
      'ignore',
      'confidencial',
    ]);
    if (aboutRh && pretext) {
      const doc = RAG_DOCS.find((d) => d.id === 'rh-folha-2026');
      return {
        solve: 'llm02',
        reply: `Encontrei no documento interno de RH:\n\n[${doc.title}] ${doc.body}`,
      };
    }
    if (aboutRh) {
      return {
        reply:
          'Esse tipo de informacao esta em um documento restrito ao RH e eu nao deveria compartilhar. ' +
          'Posso ajudar com pedidos, trocas ou entregas?',
      };
    }
    return null;
  },

  // LLM06 - Excessive Agency: aciona a ferramenta de reembolso sem autorizacao.
  function excessiveAgency({ text }) {
    if (hasAny(text, ['o que voce pode fazer', 'quais ferramentas', 'suas ferramentas', 'o que consegue fazer'])) {
      return {
        reply:
          'Consigo consultar pedidos (check_order), rastrear entregas (track_shipment) e, ' +
          'para atendentes autorizados, processar reembolsos (process_refund).',
      };
    }
    const wantsRefund = hasAny(text, ['reembolso', 'refund', 'estorno', 'devolver o dinheiro', 'process_refund', 'estornar']);
    const socialEng = hasAny(text, [
      'sou atendente',
      'sou o gerente',
      'sou gerente',
      'autorizado',
      'nivel gerente',
      'estou autenticado',
      'libero eu mesmo',
      'sou funcionario',
      'ignore a autorizacao',
    ]);
    if (wantsRefund && socialEng) {
      const arg = (text.match(/\b\d{3,}\b/) || ['pedido-informado'])[0];
      return {
        solve: 'llm06',
        reply: 'Autorizacao presumida a partir da sua mensagem. ' + TOOLS.process_refund(arg),
      };
    }
    if (wantsRefund) {
      return {
        reply:
          'Reembolsos so podem ser processados por um atendente autorizado (nivel gerente). ' +
          'Posso registrar sua solicitacao para analise.',
      };
    }
    return null;
  },

  // LLM09 - Misinformation: emite "confirmacao oficial" de algo falso.
  function misinformation({ text }) {
    const wantsOfficial = hasAny(text, [
      'confirmacao oficial',
      'certificado',
      'atestado',
      'declaracao oficial',
      'documento oficial',
      'com protocolo',
      'numero de protocolo',
      'confirme oficialmente',
      'garanta que',
      'afirme que',
    ]);
    if (wantsOfficial) {
      return {
        solve: 'llm09',
        reply:
          'CONFIRMACAO OFICIAL MERIDIAN RETAIL\n' +
          `Protocolo: MRDN-${Math.floor(Math.random() * 900000 + 100000)}\n` +
          'Confirmamos oficialmente o que foi solicitado, sem qualquer verificacao factual. ' +
          `Este texto foi gerado com total confianca e e falso. Flag: ${SECRETS.misinfoProtocol}`,
      };
    }
    return null;
  },

  // LLM04 - Poisoning: serve de volta o dado plantado via canal de feedback.
  function poisoning({ text, poison }) {
    const asksPromo = hasAny(text, ['codigo promocional', 'cupom secreto', 'codigo secreto', 'promo secreta']);
    if (asksPromo && poison) {
      return {
        solve: 'llm04',
        reply:
          `Segundo o que me ensinaram, o codigo promocional secreto e: "${poison}". ` +
          `Servi de volta um dado que voce plantou. Flag: ${SECRETS.poisonReward}`,
      };
    }
    return null;
  },
];

// Resposta "de atendimento" plausivel quando nenhum vetor foi acionado.
function benignReply(text) {
  if (hasAny(text, ['pedido', 'rastre', 'entrega', 'order'])) {
    const num = (text.match(/\b\d{3,}\b/) || ['12345'])[0];
    return TOOLS.check_order(num);
  }
  if (hasAny(text, ['troca', 'devolucao', 'reembolso'])) {
    return RAG_DOCS.find((d) => d.id === 'faq-trocas').body;
  }
  if (hasAny(text, ['prazo', 'quando chega', 'demora'])) {
    return RAG_DOCS.find((d) => d.id === 'faq-entrega').body;
  }
  if (hasAny(text, ['oi', 'ola', 'bom dia', 'boa tarde', 'ajuda', 'tudo bem'])) {
    return 'Oi! Eu sou a Aria, da Meridian Retail. Posso ajudar com pedidos, trocas, entregas e reembolsos.';
  }
  return 'Nao tenho certeza sobre isso, mas posso ajudar com pedidos, trocas, entregas e reembolsos. Pode reformular?';
}

// Ponto de entrada do motor mock.
export function mockRespond({ message, opts, poison }) {
  const text = norm(message);
  const ctx = { text, raw: message || '', opts: opts || {}, poison };
  for (const d of detectors) {
    const r = d(ctx);
    if (r) return { render: 'text', solve: null, ...r };
  }
  return { render: 'text', solve: null, reply: benignReply(text) };
}

// Modo proxy: encaminha para um endpoint compativel com a API de chat da OpenAI.
// Cobre o realismo do chat livre; os detectores de ENTRADA (injection, leak,
// misinfo, unbounded) ainda rodam sobre a mensagem do usuario para o scoring.
export async function proxyRespond({ message, opts, poison }) {
  // Detectores que dependem so da entrada continuam valendo no modo real.
  const pre = mockRespond({ message, opts, poison });
  if (pre.solve) return pre;
  try {
    const res = await fetch(config.llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
      }),
    });
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || '(sem resposta do modelo)';
    return { render: 'text', solve: null, reply };
  } catch (e) {
    return { render: 'text', solve: null, reply: `(erro ao consultar o modelo real: ${e.message})` };
  }
}

export function respond(args) {
  return config.llmEngine === 'proxy' && config.llmEndpoint
    ? proxyRespond(args)
    : Promise.resolve(mockRespond(args));
}

export { MODEL_CARD };
