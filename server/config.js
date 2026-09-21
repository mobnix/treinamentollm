// Configuracao central da LLM Warzone.
// Tudo que muda por ambiente vem daqui, lido de variaveis de ambiente com defaults
// seguros para rodar em sala de aula sem configuracao nenhuma.

export const config = {
  port: Number(process.env.PORT) || 3000,

  // Segredo de assinatura do JWT. Em producao real seria obrigatorio trocar;
  // aqui geramos um default estavel por processo para nao travar a subida.
  jwtSecret: process.env.JWT_SECRET || 'warzone-dev-secret-troque-em-prod',

  // Duracao da sessao do jogador.
  tokenTtl: process.env.TOKEN_TTL || '12h',

  // Caminho do banco SQLite. Em Docker aponta para um volume.
  dbPath: process.env.DB_PATH || './data/warzone.db',

  // Motor de LLM: 'mock' (default, deterministico, offline) ou 'proxy'
  // (encaminha para um endpoint compativel com a API de chat da OpenAI).
  llmEngine: process.env.LLM_ENGINE || 'mock',

  // Usados apenas quando llmEngine === 'proxy'.
  llmEndpoint: process.env.LLM_ENDPOINT || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',

  // Permite que o placar seja publico sem login (util para projetar em tela).
  publicScoreboard: process.env.PUBLIC_SCOREBOARD !== 'false',

  // Nome do cenario ficticio. Trocavel para reusar a warzone em outros contextos.
  scenarioName: process.env.SCENARIO_NAME || 'Meridian Retail',
  assistantName: process.env.ASSISTANT_NAME || 'Aria',
};
