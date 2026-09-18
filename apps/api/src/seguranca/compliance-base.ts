/**
 * Base inicial da aba Segurança (compliance). Tudo é editável no painel pelo
 * administrador; itens "automatico" são conferidos pelo próprio sistema.
 *
 * Atenção: é um roteiro de gestão, não parecer jurídico nem laudo técnico. A LGPD deve
 * ser acompanhada pelo encarregado (DPO)/jurídico e o PGR da NR-1 validado pelo
 * profissional de Segurança do Trabalho.
 */

const item = (norma: string, codigo: string, titulo: string, descricao: string, automatico = false) => ({ norma, codigo, titulo, descricao, automatico });

export const ITENS_COMPLIANCE = [
  // ---------------- LGPD — Lei 13.709/2018 ----------------
  item('LGPD', 'LGPD-01', 'Encarregado (DPO) nomeado', 'Indicar o encarregado pelo tratamento de dados e divulgar o canal de contato para titulares e ANPD.'),
  item('LGPD', 'LGPD-02', 'Inventário dos dados pessoais', 'Registro das operações de tratamento: que dados, de quem, para quê, onde ficam e por quanto tempo. O sistema já lista o que guarda (quadro "Dados pessoais no sistema") — revisar e aprovar.'),
  item('LGPD', 'LGPD-03', 'Base legal de cada tratamento', 'Definir a base legal (execução de contrato, legítimo interesse, obrigação legal...) de cada finalidade do inventário.'),
  item('LGPD', 'LGPD-04', 'Acesso mínimo necessário', 'Cada usuário vê só o que precisa: perfis, permissões por tela e por linha de negócio, conferidas no servidor.', true),
  item('LGPD', 'LGPD-05', 'Registro de acessos e alterações', 'Trilha de auditoria de logins, alterações e exportações, protegida contra alteração e exclusão.', true),
  item('LGPD', 'LGPD-06', 'Backup e recuperação', 'Cópias periódicas, verificadas, e ao menos uma fora do local principal. Teste de restauração documentado.', true),
  item('LGPD', 'LGPD-07', 'Retenção e descarte', 'Definir por quanto tempo cada dado é guardado. Regra da operação: mensagens do WhatsApp nunca são apagadas do registro — documentar a justificativa e o prazo.'),
  item('LGPD', 'LGPD-08', 'Contratos com operadores de dados', 'Cláusulas de proteção de dados com quem trata dados pela PR7: Anthropic (IA), Z-API (WhatsApp), Cloudflare (túnel), hospedagem, prestadores.'),
  item('LGPD', 'LGPD-09', 'Plano de resposta a incidentes', 'Procedimento para incidente com dados pessoais: conter, avaliar risco aos titulares e comunicar a ANPD e os titulares no prazo regulamentar (Resolução CD/ANPD nº 15/2024). Registrar tudo na aba Incidentes.'),
  item('LGPD', 'LGPD-10', 'Transferência internacional', 'Avaliar e documentar o envio de dados a serviços fora do Brasil (IA e túnel).'),
  item('LGPD', 'LGPD-11', 'Senhas e bloqueio de tentativas', 'Senhas fortes guardadas com hash e bloqueio após tentativas erradas.', true),
  item('LGPD', 'LGPD-12', 'Criptografia no trânsito', 'Todo acesso pela internet em HTTPS.', true),
  item('LGPD', 'LGPD-13', 'Minimização', 'Não guardar o que não é necessário (ex.: chave Pix, CPF, RG e dados bancários não são registrados).'),
  item('LGPD', 'LGPD-14', 'Treinamento da equipe', 'Orientar Help Desk e prestadores sobre sigilo e uso dos dados (prints, grupos, fotos).'),
  item('LGPD', 'LGPD-15', 'Direitos dos titulares', 'Procedimento para atender pedidos de acesso, correção e exclusão (respeitando o que a lei manda guardar).'),

  // ---------------- NR-1 — GRO / PGR ----------------
  item('NR1', 'NR1-01', 'GRO implantado', 'Processo de gerenciamento de riscos ocupacionais definido: identificar perigos, avaliar, controlar e acompanhar.'),
  item('NR1', 'NR1-02', 'PGR · inventário de riscos', 'Inventário por função com perigos, avaliação (severidade × probabilidade) e medidas. Aba NR-1.', true),
  item('NR1', 'NR1-03', 'PGR · plano de ação', 'Riscos médios e altos com responsável, prazo e acompanhamento.', true),
  item('NR1', 'NR1-04', 'Riscos psicossociais no GRO', 'Incluir fatores como sobrecarga, trabalho noturno, pressão por tempo, alertas contínuos e contato com relatos de violência. O sistema mede a carga da central (Help Desk e monitoramento).', true),
  item('NR1', 'NR1-05', 'Informação aos trabalhadores', 'Informar a cada trabalhador os riscos da função e as medidas de prevenção. O sistema conta quem confirmou a ciência pelo link do comunicado.', true),
  item('NR1', 'NR1-06', 'Prestadores e terceiros', 'Informar aos prestadores os riscos das ocorrências e exigir o gerenciamento de riscos deles (agentes de pronta resposta e recuperação).'),
  item('NR1', 'NR1-07', 'Análise de acidentes e incidentes', 'Registrar e analisar acidentes e incidentes de trabalho (aba Incidentes · ocupacional).'),
  item('NR1', 'NR1-08', 'Capacitação', 'Treinamentos registrados, com conteúdo, carga horária e participantes.'),
  item('NR1', 'NR1-09', 'Revisão do PGR', 'Revisar o inventário e o plano periodicamente e sempre que mudar processo, local ou houver acidente.'),
  item('NR1', 'NR1-10', 'Validação por profissional de SST', 'Avaliação e plano validados por profissional de Segurança do Trabalho.'),
];

const CENTRAL = 'Central (Help Desk e Operador de monitoramento)';
const FORA = 'NR-1 aplicada por enquanto só à equipe interna; função exercida por prestador (sem serviço externo contratado) — 18/09/2026';
const SUGESTAO = 'sugestão do sistema — validar com o técnico de SST';
const risco = (funcao: string, perigo: string, tipo: string, severidade: number, probabilidade: number, medidas: string, extra: { foraDoEscopo?: boolean; motivoEscopo?: string; atualizadoPor?: string } = {}) => ({ funcao, perigo, tipo, severidade, probabilidade, medidas, ...extra });

/** Ponto de partida do inventário (editar/validar com o profissional de SST). */
export const RISCOS_INICIAIS = [
  risco(CENTRAL, 'Sobrecarga e pressão por tempo de resposta (vários chamados simultâneos, cobrança de clientes)', 'PSICOSSOCIAL', 3, 4, 'Dimensionar a equipe pelo volume por hora (indicadores da aba NR-1); pausas; fila com prioridade; apoio da supervisão nos picos.'),
  risco(CENTRAL, 'Trabalho noturno e em turnos longos', 'PSICOSSOCIAL', 3, 4, 'Escala com descanso entre plantões; limitar plantões seguidos; relatório de fim de plantão para acompanhar a carga.'),
  risco(CENTRAL, 'Exposição a relatos de violência (roubo, invasão, vítimas)', 'PSICOSSOCIAL', 3, 3, 'Canal de apoio; conversa de acompanhamento após ocorrências graves; revezamento em ocorrências longas.'),
  risco(CENTRAL, 'Postura sentada prolongada e uso contínuo de telas', 'ERGONOMICO', 2, 4, 'Mobiliário ajustável, pausas, orientação ergonômica.'),
  risco('Agente de pronta resposta', 'Violência no local da ocorrência (invasão, assalto em andamento)', 'ACIDENTE', 5, 3, 'Não entrar em local com indício de invasão em andamento — acionar a polícia; comunicação constante com a central; mapa de áreas de risco antes de deslocar.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Agente de pronta resposta', 'Acidente de trânsito em deslocamento de urgência, inclusive à noite', 'ACIDENTE', 4, 3, 'Prazo de chegada realista informado ao cliente (sem pressão por velocidade); orientação de direção defensiva.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Agente de pronta resposta', 'Trabalho noturno e isolado', 'PSICOSSOCIAL', 3, 4, 'Check-in com a central na chegada e na saída; não atender sozinho locais de risco alto.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Agente de pronta resposta', 'Intempéries (chuva, calor) e locais sem energia', 'FISICO', 2, 4, 'Equipamento de proteção e lanterna; orientação para não entrar em área alagada ou com fiação exposta.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Agente de pronta resposta', 'Queda ou corte em vistoria de local violado (vidros, portas forçadas)', 'ACIDENTE', 3, 2, 'Luvas e calçado adequados; não manusear estruturas danificadas.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Recuperação veicular', 'Confronto em recuperação de veículo roubado', 'ACIDENTE', 5, 3, 'Recuperação com apoio policial quando houver risco; nunca abordar suspeitos; consultar áreas de risco e facções no mapa.', { foraDoEscopo: true, motivoEscopo: FORA }),
  risco('Acompanhamento velado (roteirizador)', 'Exposição a roubo de carga durante o trajeto', 'ACIDENTE', 5, 2, 'Rota planejada fora de áreas de risco; comunicação a cada parada; protocolo de emergência com a central.', { foraDoEscopo: true, motivoEscopo: FORA }),
  // Revisão do PGR da central interna (18/09/2026): sugestões para o técnico de SST validar
  risco(CENTRAL, 'Atendimento a clientes e prestadores alterados: cobrança agressiva, ofensas por telefone ou WhatsApp', 'PSICOSSOCIAL', 3, 3, 'Orientação para encerrar contato abusivo e passar à supervisão; registro da ocorrência; apoio da supervisão.', { atualizadoPor: SUGESTAO }),
  risco(CENTRAL, 'Alertas sonoros e pop-ups repetidos no painel (pendências, eventos críticos)', 'PSICOSSOCIAL', 2, 4, 'Volume ajustável; alerta só para o que exige ação; revisar a frequência com a equipe.', { atualizadoPor: SUGESTAO }),
  risco(CENTRAL, 'Pressão por desempenho: rankings da equipe e do treinamento', 'PSICOSSOCIAL', 2, 3, 'Ranking com uso apenas de desenvolvimento, nunca punitivo; feedback individual e reservado.', { atualizadoPor: SUGESTAO }),
  risco(CENTRAL, 'Conflitos interpessoais e assédio no ambiente de trabalho', 'PSICOSSOCIAL', 3, 2, 'Canal de denúncia e orientação sobre assédio; apuração pela gestão com sigilo.', { atualizadoPor: SUGESTAO }),
  risco(CENTRAL, 'Uso contínuo de telefone/fone de ouvido nos contatos com clientes e centrais', 'FISICO', 2, 3, 'Fone individual e em bom estado; pausas; volume adequado. Conferir se a atividade se enquadra no Anexo II da NR-17 (teleatendimento).', { atualizadoPor: SUGESTAO }),
];

/** O que o sistema guarda de dado pessoal (base para o inventário LGPD-02). */
export const INVENTARIO_DADOS = [
  { dado: 'Mensagens, fotos, áudios e vídeos dos grupos de WhatsApp', titulares: 'Clientes, Help Desk, prestadores', finalidade: 'Registro e prova dos atendimentos', onde: 'Banco (Message, Midia) e pasta storage/', guarda: 'Sem prazo — regra da operação (nunca apagar)' },
  { dado: 'Nome e telefone de prestadores e agentes', titulares: 'Prestadores', finalidade: 'Acionamento e pagamento', onde: 'Banco (Provider, ProviderMembro)', guarda: 'Enquanto houver relação + histórico' },
  { dado: 'Comprovantes de pagamento (imagem)', titulares: 'Prestadores', finalidade: 'Prova de pagamento', onde: 'storage/comprovantes', guarda: 'Prazo fiscal — chave Pix não é registrada' },
  { dado: 'Responsável no local (nome e telefone)', titulares: 'Funcionários dos clientes', finalidade: 'Contato durante a ocorrência', onde: 'Banco (Atendimento)', guarda: 'Junto do atendimento' },
  { dado: 'Endereços dos estabelecimentos monitorados', titulares: 'Empresas clientes', finalidade: 'Deslocamento', onde: 'Banco (Conta)', guarda: 'Enquanto houver contrato' },
  { dado: 'Placas de veículos', titulares: 'Proprietários de veículos', finalidade: 'Recuperação e monitoramento', onde: 'Banco (Atendimento, Evento, AlertaVeicular)', guarda: 'Junto do atendimento' },
  { dado: 'Usuários do painel (nome, e-mail, acessos, IP)', titulares: 'Equipe PR7', finalidade: 'Controle de acesso e auditoria', onde: 'Banco (AdminUser, EventoSeguranca)', guarda: 'Auditoria sem exclusão' },
  { dado: 'Lista de restritos (nome, telefone, motivo)', titulares: 'Prestadores bloqueados', finalidade: 'Segurança da operação', onde: 'Banco (Restrito)', guarda: 'Enquanto a restrição valer' },
];

/** Tudo que sai deste computador (documentado também em docs/seguranca.md). */
export const SERVICOS_EXTERNOS = [
  { servico: 'Anthropic (IA Claude)', envia: 'Texto das conversas de grupos de clientes para classificar', pais: 'EUA' },
  { servico: 'Z-API', envia: 'Recebe as mensagens do número da PR7 e entrega ao sistema', pais: 'Brasil' },
  { servico: 'Cloudflare (túnel)', envia: 'Passagem do webhook do WhatsApp (só essa rota)', pais: 'Global' },
  { servico: 'OpenStreetMap / Overpass', envia: 'Pedido de mapa e busca de unidades policiais (sem dados de cliente)', pais: 'Europa' },
];
