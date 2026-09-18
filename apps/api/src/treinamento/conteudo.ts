/**
 * Conteúdo da Academia PR7 (aba Treinamento), 18/09/2026.
 *
 * Fonte: regras da operação já confirmadas e aplicadas no sistema (docs/registro-do-projeto.md,
 * monitoramento/prioridade.ts, pagamentos, SAC). Tudo com `validado: false` até a supervisão
 * conferir. Os módulos da Power e da GR Tracker ficam reservados até chegar o material oficial.
 *
 * As respostas certas ficam SÓ no servidor: o painel recebe as perguntas sem gabarito.
 */
export type Questao = {
  id: string;
  enunciado: string;
  opcoes: string[];
  certa: number; // índice em `opcoes`
  explicacao: string;
  dificuldade: 1 | 2 | 3;
};
export type Modulo = {
  codigo: string;
  titulo: string;
  area: 'MONITORAMENTO' | 'PATRIMONIAL' | 'VEICULAR' | 'HELP_DESK' | 'SAC' | 'SEGURANCA';
  icone: string;
  resumo: string;
  licoes: { titulo: string; pontos: string[] }[];
  questoes: Questao[];
  validado: boolean;
  aguardandoMaterial?: string;
};
export type Cenario = {
  id: string;
  titulo: string;
  area: Modulo['area'];
  alerta: string; // o que chega na tela, como no plantão
  tempoSeg: number;
  etapas: { pergunta: string; opcoes: string[]; certa: number; explicacao: string }[];
};

export const XP_POR_DIFICULDADE = { 1: 10, 2: 20, 3: 30 } as const;

export const MODULOS: Modulo[] = [
  {
    codigo: 'mon-fundamentos', titulo: 'Tratativa de eventos · Fundamentos', area: 'MONITORAMENTO', icone: '🛰️', validado: false,
    resumo: 'O que é evento de monitoramento, a fila, as prioridades e como um evento termina.',
    licoes: [
      { titulo: 'O que entra no Monitoramento', pontos: [
        'Só eventos VEICULARES de telemetria vindos da central de rastreamento.',
        'São 6 eventos oficiais: Painel violado, Desconexão de bateria, Remoção de bateria, Veículo bloqueado, Cerca e Perda de sinal.',
        'Patrimonial não entra no Monitoramento: é acompanhado na tela de Atendimentos.',
        'Roubo e furto NÃO são evento de monitoramento: são ocorrência de atendimento Veicular (recuperação de veículo).',
      ] },
      { titulo: 'Prioridade', pontos: [
        'CRÍTICA: violação de painel, remoção de bateria (e qualquer sinal de roubo, invasão, pânico ou coação).',
        'ALTA: veículo bloqueado e desconexão de bateria.',
        'MÉDIA: cerca e perda de sinal.',
        'Crítico primeiro, sempre: o tempo de reação é o que salva o veículo.',
      ] },
      { titulo: 'Caminho do evento', pontos: [
        'NOVO (na fila) → EM TRATATIVA (alguém assumiu) → AGUARDANDO (esperando retorno) → ENCAMINHADO (prestador acionado) → ENCERRADO.',
        'Assuma o evento antes de tratar: fica registrado quem cuidou e quando.',
        'Cada contato, tentativa e retorno vira uma linha na tratativa — é a prova do que foi feito.',
        'Prestador RESTRITO não pode ser acionado: o sistema bloqueia.',
      ] },
      { titulo: 'Como o evento termina (desfecho)', pontos: [
        'Atendimento realizado · Resolvido remotamente pela central · Falso alarme · Sem prestador na região · Sem contato · Cancelado pelo cliente · Duplicado.',
        'Cancelado pelo cliente: o sistema registra quantos minutos depois da solicitação ele cancelou.',
        'Evento encerrado não é reaberto nem reescrito.',
      ] },
    ],
    questoes: [
      { id: 'mf1', dificuldade: 1, enunciado: 'Qual destes NÃO é um evento de monitoramento?', opcoes: ['Painel violado', 'Roubo do veículo', 'Perda de sinal', 'Cerca'], certa: 1, explicacao: 'Roubo e furto são ocorrência de atendimento Veicular (recuperação), não tratativa de evento.' },
      { id: 'mf2', dificuldade: 1, enunciado: 'Um alarme de loja (patrimonial) disparou. Onde ele é acompanhado?', opcoes: ['Na fila do Monitoramento', 'Na tela de Atendimentos', 'No SAC', 'Não é acompanhado'], certa: 1, explicacao: 'O Monitoramento trata só telemetria veicular. Patrimonial fica em Atendimentos.' },
      { id: 'mf3', dificuldade: 2, enunciado: 'Chegaram ao mesmo tempo: Cerca, Remoção de bateria e Perda de sinal. Qual tratar primeiro?', opcoes: ['Cerca', 'Perda de sinal', 'Remoção de bateria', 'Tanto faz'], certa: 2, explicacao: 'Remoção de bateria é CRÍTICA; cerca e perda de sinal são MÉDIA.' },
      { id: 'mf4', dificuldade: 1, enunciado: 'Qual a prioridade de "Veículo bloqueado"?', opcoes: ['Crítica', 'Alta', 'Média', 'Baixa'], certa: 1, explicacao: 'Bloqueio e desconexão de bateria são ALTA.' },
      { id: 'mf5', dificuldade: 2, enunciado: 'Você ligou para o cliente e está esperando ele retornar. Qual status do evento?', opcoes: ['Novo', 'Aguardando', 'Encaminhado', 'Encerrado'], certa: 1, explicacao: 'AGUARDANDO = esperando retorno de cliente, responsável ou prestador.' },
      { id: 'mf6', dificuldade: 2, enunciado: 'O prestador foi acionado e está a caminho. Qual status?', opcoes: ['Em tratativa', 'Aguardando', 'Encaminhado', 'Encerrado'], certa: 2, explicacao: 'ENCAMINHADO = prestador acionado, a central acompanha.' },
      { id: 'mf7', dificuldade: 3, enunciado: 'O sistema recusou acionar um prestador. Qual o motivo mais provável?', opcoes: ['Ele está RESTRITO', 'Ele é novo', 'O evento é de cerca', 'Faltou foto'], certa: 0, explicacao: 'Prestador RESTRITO nunca é acionado — o bloqueio é do próprio sistema.' },
      { id: 'mf8', dificuldade: 2, enunciado: 'O mesmo evento chegou duas vezes. Como encerrar o segundo?', opcoes: ['Falso alarme', 'Duplicado', 'Sem contato', 'Resolvido remoto'], certa: 1, explicacao: 'Duplicado — assim a estatística não conta o evento duas vezes.' },
      { id: 'mf9', dificuldade: 3, enunciado: 'Por que registrar cada tentativa de contato na tratativa?', opcoes: ['Para ganhar XP', 'É a prova do que a central fez e de quando fez', 'Só se o cliente pedir', 'Não precisa registrar'], certa: 1, explicacao: 'A linha do tempo da tratativa é a evidência do atendimento — vale para o cliente e para a auditoria.' },
    ],
  },
  {
    codigo: 'mon-eventos', titulo: 'Tratativa de eventos · Evento a evento', area: 'MONITORAMENTO', icone: '🚨', validado: false,
    resumo: 'Os 6 eventos veiculares: o que cada um indica e o que não esquecer.',
    licoes: [
      { titulo: 'Painel violado (CRÍTICA)', pontos: ['Indica tentativa de mexer no rastreador ou no painel do veículo.', 'É sinal típico de preparação para furto/roubo: reação imediata.', 'Se virar roubo ou furto, a ocorrência passa a ser atendimento Veicular (recuperação).'] },
      { titulo: 'Remoção de bateria (CRÍTICA)', pontos: ['A bateria principal foi retirada — o rastreador passa a depender da bateria interna.', 'Tempo curto até perder a comunicação: priorize.'] },
      { titulo: 'Desconexão de bateria (ALTA)', pontos: ['A alimentação foi cortada ou teve falha.', 'Pode ser manutenção ou sabotagem: confirme com o cliente/motorista.'] },
      { titulo: 'Veículo bloqueado (ALTA)', pontos: ['O veículo está bloqueado pelo rastreador.', 'Registre quem pediu/autorizou e a posição.'] },
      { titulo: 'Cerca (MÉDIA)', pontos: ['O veículo entrou ou saiu de uma área definida.', 'Confira se o trajeto era esperado.'] },
      { titulo: 'Perda de sinal (MÉDIA)', pontos: ['O rastreador parou de comunicar.', 'Pode ser área de sombra (garagem, subsolo) ou bloqueador de sinal (jammer): acompanhe a última posição.'] },
      { titulo: 'Como o evento chega', pontos: ['A central manda em bloco rótulo/valor: "Descrição do Evento / Placa / Localização..."', 'O sistema lê esse bloco sem IA e encaixa num dos 6 eventos oficiais.'] },
    ],
    questoes: [
      { id: 'me1', dificuldade: 1, enunciado: 'Qual evento é CRÍTICO?', opcoes: ['Cerca', 'Perda de sinal', 'Painel violado', 'Veículo bloqueado'], certa: 2, explicacao: 'Painel violado e remoção de bateria são críticos.' },
      { id: 'me2', dificuldade: 2, enunciado: 'Remoção de bateria é mais grave que desconexão porque...', opcoes: ['A bateria foi retirada e o rastreador fica só na bateria interna', 'É mais cara', 'O cliente paga mais', 'Não é mais grave'], certa: 0, explicacao: 'Sem a bateria principal, o tempo até perder o rastreio é curto.' },
      { id: 'me3', dificuldade: 2, enunciado: 'O veículo parou de comunicar dentro de um estacionamento subterrâneo. O que considerar?', opcoes: ['Com certeza é roubo', 'Pode ser área de sombra; acompanhe a última posição', 'Encerrar como falso alarme na hora', 'Bloquear o veículo sempre'], certa: 1, explicacao: 'Perda de sinal pode ser sombra; acompanhe e confirme antes de concluir.' },
      { id: 'me4', dificuldade: 3, enunciado: 'Durante um "Painel violado", o cliente confirma que o veículo foi levado. E agora?', opcoes: ['Continua só como evento de monitoramento', 'Vira atendimento Veicular (recuperação de veículo)', 'Encerra como cancelado', 'Abre SAC'], certa: 1, explicacao: 'Roubo/furto é atendimento Veicular de recuperação, não evento.' },
      { id: 'me5', dificuldade: 1, enunciado: '"Cerca" significa que o veículo...', opcoes: ['Perdeu a bateria', 'Entrou ou saiu de uma área definida', 'Foi bloqueado', 'Teve o painel aberto'], certa: 1, explicacao: 'Cerca = limite geográfico cruzado.' },
      { id: 'me6', dificuldade: 2, enunciado: 'Qual é a prioridade de "Desconexão de bateria"?', opcoes: ['Crítica', 'Alta', 'Média', 'Baixa'], certa: 1, explicacao: 'Desconexão é ALTA; remoção é CRÍTICA.' },
      { id: 'me7', dificuldade: 3, enunciado: 'Qual informação é indispensável no evento veicular?', opcoes: ['Placa e localização', 'Cor do banco', 'Nome do posto', 'CNPJ do prestador'], certa: 0, explicacao: 'Sem placa e posição não há como tratar nem acionar.' },
    ],
  },
  {
    codigo: 'patrimonial', titulo: 'Atendimento patrimonial', area: 'PATRIMONIAL', icone: '🏢', validado: false,
    resumo: 'Serviços patrimoniais, linha do tempo do chamado e o ID do PR7.',
    licoes: [
      { titulo: 'Serviços', pontos: ['Ronda · Pronta resposta · Preservação · Vistoria · Rondas periódicas · Manutenção patrimonial.', 'Preservação é paga por hora (horas exatas × taxa do prestador).', 'Ronda e pronta resposta têm valor fixo por atendimento.'] },
      { titulo: 'Linha do tempo do chamado', pontos: ['Solicitação → autorização pedida → cliente liberou → chegada ao local → término.', 'Cada horário tem que ser o real: é ele que calcula tempo de resposta e valores.', 'Horário sem data certa estraga o relatório do cliente.'] },
      { titulo: 'ID PR7 e ocorrência do cliente', pontos: ['O ID PR7 tem de 4 a 6 dígitos e liga pedido, repasse e retorno do prestador.', 'Número maior (ex.: 33760663) é a ocorrência do sistema do cliente — não é o ID PR7.', 'Sem ID, o sistema cria um ID interno (PR7-H-000123) que nunca se repete.'] },
      { titulo: 'Retorno e fotos', pontos: ['O formulário de retorno traz ID, conta/estabelecimento, horários e relato.', 'Foto só vai no chamado certo: na dúvida, deixe solta e vincule depois.', 'O relatório em PDF para o cliente não mostra valores.'] },
    ],
    questoes: [
      { id: 'pa1', dificuldade: 1, enunciado: 'Qual serviço é pago por hora?', opcoes: ['Ronda', 'Pronta resposta', 'Preservação', 'Vistoria'], certa: 2, explicacao: 'Preservação: horas exatas × taxa.' },
      { id: 'pa2', dificuldade: 2, enunciado: 'O cliente mandou "ocorrência 33760663". Isso é o ID PR7?', opcoes: ['Sim', 'Não: é a ocorrência do cliente; ID PR7 tem 4 a 6 dígitos', 'Depende do dia', 'Só se tiver foto'], certa: 1, explicacao: 'Número grande é ocorrência do cliente.' },
      { id: 'pa3', dificuldade: 2, enunciado: 'Qual a ordem certa da linha do tempo?', opcoes: ['Chegada → solicitação → término', 'Solicitação → autorização → liberação → chegada → término', 'Término → chegada → solicitação', 'Liberação → solicitação → chegada'], certa: 1, explicacao: 'É essa sequência que mede tempo de resposta.' },
      { id: 'pa4', dificuldade: 3, enunciado: 'Chegou uma foto e há dois chamados abertos no grupo. O que fazer?', opcoes: ['Vincular no mais antigo', 'Deixar solta e vincular ao chamado certo depois', 'Apagar a foto', 'Vincular nos dois'], certa: 1, explicacao: 'Foto no chamado errado vai parar no relatório errado.' },
      { id: 'pa5', dificuldade: 1, enunciado: 'O PDF do relatório para o cliente mostra o valor pago ao prestador?', opcoes: ['Sim', 'Não', 'Só se o cliente pedir', 'Só no fim do mês'], certa: 1, explicacao: 'Valores nunca vão para o cliente.' },
      { id: 'pa6', dificuldade: 2, enunciado: 'Um ID interno PR7-H apagado pode ser reaproveitado?', opcoes: ['Sim', 'Não, a sequência nunca repete', 'Só no mês seguinte', 'Só pelo admin'], certa: 1, explicacao: 'IDs não se repetem para não misturar histórico.' },
    ],
  },
  {
    codigo: 'veicular', titulo: 'Atendimento veicular', area: 'VEICULAR', icone: '🚗', validado: false,
    resumo: 'Recuperação de veículo, acompanhamento velado (Roteirizador), antenista e alertas.',
    licoes: [
      { titulo: 'Serviços veiculares', pontos: ['Recuperação de veículo (roubo/furto).', 'Acompanhamento velado — o grupo "Roteirizador": um atendimento por dia, com as paradas.', 'Antenista (Técnico de RF em Geolocalização) e Análise de Tecnologia Rastreável: busca por radiofrequência.'] },
      { titulo: 'Valor do veicular', pontos: ['Base do cliente + km acima da franquia + horas acima da franquia + gastos adicionais.', 'Por isso km rodados, horários e gastos têm que ser informados.'] },
      { titulo: 'Divulgação de furto/roubo', pontos: ['Divulgação na rede é ALERTA, não chamado.', 'Não abre atendimento nem entra no faturamento.'] },
    ],
    questoes: [
      { id: 've1', dificuldade: 1, enunciado: 'Um grupo divulgou placa de veículo roubado para a rede ficar atenta. Isso é...', opcoes: ['Chamado de recuperação', 'Alerta', 'Evento de monitoramento', 'SAC'], certa: 1, explicacao: 'Divulgação é só alerta.' },
      { id: 've2', dificuldade: 2, enunciado: 'Por que registrar km rodados no veicular?', opcoes: ['Entra no cálculo do valor', 'Não precisa', 'Só para estatística', 'Para o cliente ver'], certa: 0, explicacao: 'Km acima da franquia soma no valor ao prestador.' },
      { id: 've3', dificuldade: 2, enunciado: 'O acompanhamento velado do grupo Roteirizador gera...', opcoes: ['Um chamado por mensagem', 'Um atendimento por dia com as paradas', 'Nada', 'Um evento de cerca'], certa: 1, explicacao: 'Um atendimento por dia (horário de Brasília), paradas registradas.' },
      { id: 've4', dificuldade: 1, enunciado: 'O antenista trabalha com...', opcoes: ['Radiofrequência / geolocalização', 'Portaria', 'Limpeza', 'Pagamentos'], certa: 0, explicacao: 'Técnico de RF em Geolocalização.' },
    ],
  },
  {
    codigo: 'help-desk', titulo: 'Help Desk · Registro sem erro', area: 'HELP_DESK', icone: '🎧', validado: false,
    resumo: 'Cancelamentos, não atendidos, duplicidades e as regras de ouro do registro.',
    licoes: [
      { titulo: 'Regras de ouro', pontos: ['Nada é enviado ao cliente pelo sistema: pop-ups e avisos são só do painel.', 'Chamado encerrado não é reescrito.', 'Chamado novo em grupo precisa de identificação: ID, ocorrência, estabelecimento, placa ou foto do cliente.'] },
      { titulo: 'Quando não acontece', pontos: ['CANCELADO = o cliente cancelou (registre o motivo; o sistema conta os minutos).', 'NÃO ATENDIDO = o PR7 não conseguiu: prestador recusou, demora, sem prestador na região, falso alarme, duplicado.', '"Positivo central / OK" não é chamado.'] },
      { titulo: 'Nomes certos', pontos: ['A mesma pessoa tem um nome só no sistema.', 'Nome do grupo (ex.: "PR7 & ORSEGUPS") ou o operador do cliente não é Help Desk.'] },
    ],
    questoes: [
      { id: 'hd1', dificuldade: 1, enunciado: 'O cliente desistiu do atendimento. Status?', opcoes: ['Não atendido', 'Cancelado', 'Concluído', 'Novo'], certa: 1, explicacao: 'Cliente desistiu = CANCELADO, com o motivo.' },
      { id: 'hd2', dificuldade: 2, enunciado: 'Nenhum prestador disponível na cidade. Status e motivo?', opcoes: ['Cancelado · cliente', 'Não atendido · sem prestador na região', 'Concluído', 'Duplicado'], certa: 1, explicacao: 'O PR7 não conseguiu atender = NÃO ATENDIDO.' },
      { id: 'hd3', dificuldade: 2, enunciado: 'Mensagem "positivo central, ok" no grupo. É chamado novo?', opcoes: ['Sim', 'Não: não identifica nenhum atendimento', 'Só à noite', 'Só se tiver foto'], certa: 1, explicacao: 'Chamado novo precisa de identificação.' },
      { id: 'hd4', dificuldade: 1, enunciado: 'O sistema manda a piadinha do pop-up para o cliente?', opcoes: ['Sim', 'Não, fica só no painel', 'Só às sextas', 'Só se o cliente pedir'], certa: 1, explicacao: 'Nada sai do sistema para o cliente.' },
      { id: 'hd5', dificuldade: 3, enunciado: 'No campo Help Desk apareceu "PR7 & ORSEGUPS". Está certo?', opcoes: ['Sim', 'Não: é o nome do grupo, não de quem atendeu', 'Só se for Orsegups', 'Tanto faz'], certa: 1, explicacao: 'Help Desk é a pessoa da PR7 que atendeu.' },
    ],
  },
  {
    codigo: 'sac', titulo: 'SAC e pagamentos do prestador', area: 'SAC', icone: '💬', validado: false,
    resumo: 'Reclamação de prestador, fechamento e comprovante.',
    licoes: [
      { titulo: 'SAC do prestador', pontos: ['Reclamação de prestador (pagamento ou atendimento em atraso) não é chamado de cliente: vira ticket de SAC, prioridade alta.', 'O comprovante postado pela supervisão no grupo de pagamentos resolve o ticket.'] },
      { titulo: 'Calendário de pagamento', pontos: ['Regimes: 48 horas, semanal, quinzenal e mensal.', 'A quinzena fecha no dia 16 às 23h59 (e no último dia do mês).', 'Depois do fechamento, até 5 dias úteis para iniciar os pagamentos.', 'O comprovante é a prova do pagamento.'] },
    ],
    questoes: [
      { id: 'sa1', dificuldade: 1, enunciado: 'Prestador reclama que não recebeu. Isso vira...', opcoes: ['Chamado de cliente', 'Ticket de SAC, prioridade alta', 'Evento de monitoramento', 'Nada'], certa: 1, explicacao: 'Reclamação de prestador = SAC.' },
      { id: 'sa2', dificuldade: 2, enunciado: 'Quando fecha a primeira quinzena?', opcoes: ['Dia 15, meio-dia', 'Dia 16, 23h59', 'Dia 20', 'Dia 1º'], certa: 1, explicacao: 'Fecha dia 16 às 23h59.' },
      { id: 'sa3', dificuldade: 2, enunciado: 'Depois do fechamento, o prazo para iniciar os pagamentos é de...', opcoes: ['24 horas', '5 dias úteis', '30 dias', 'Sem prazo'], certa: 1, explicacao: '5 dias úteis.' },
      { id: 'sa4', dificuldade: 3, enunciado: 'O que prova que o prestador foi pago?', opcoes: ['A palavra do supervisor', 'O comprovante postado no grupo de pagamentos', 'Um áudio', 'O extrato do prestador'], certa: 1, explicacao: 'O comprovante é a prova.' },
    ],
  },
  {
    codigo: 'seguranca-info', titulo: 'Segurança da informação e LGPD', area: 'SEGURANCA', icone: '🔒', validado: false,
    resumo: 'Acesso monitorado, dados restritos e o que nunca fazer.',
    licoes: [
      { titulo: 'Uso restrito', pontos: ['Todo acesso ao painel é monitorado e registrado.', 'Dados de clientes, prestadores, ocorrências, valores e mapas são de uso interno.', 'Não fotografe a tela, não copie e não repasse dados para fora dos canais da empresa.'] },
      { titulo: 'Senha e acesso', pontos: ['Senha pessoal, forte (10+ caracteres com letras e números), nunca compartilhada.', 'Suspeita de acesso indevido: avise a administração na hora.'] },
    ],
    questoes: [
      { id: 'si1', dificuldade: 1, enunciado: 'Um colega pede sua senha para "adiantar" um registro. Você...', opcoes: ['Passa a senha', 'Não passa: senha é pessoal', 'Passa só hoje', 'Anota num papel para ele'], certa: 1, explicacao: 'Cada acesso é registrado em nome de quem entrou.' },
      { id: 'si2', dificuldade: 1, enunciado: 'Pode mandar print do mapa operacional para um amigo?', opcoes: ['Pode', 'Não: é informação restrita', 'Se cortar o logo', 'Se for de noite'], certa: 1, explicacao: 'Proibida a divulgação fora da empresa.' },
      { id: 'si3', dificuldade: 2, enunciado: 'Você suspeita que alguém entrou com seu usuário. O que fazer?', opcoes: ['Nada', 'Avisar a administração na hora', 'Esperar o fim do mês', 'Criar outro usuário'], certa: 1, explicacao: 'O administrador pode encerrar todas as sessões na hora.' },
    ],
  },
  // Centrais de monitoramento (18/09/2026: "Power, GR Tracker, Sincro e Seven são monitoramento").
  // Conteúdo entra quando chegar o material oficial de cada central.
  {
    codigo: 'central-power', titulo: 'Monitoramento · Central Power', area: 'MONITORAMENTO', icone: '⚡', validado: false,
    resumo: 'Tratativa de eventos na central Power.', aguardandoMaterial: 'Aguardando o material de treinamento da Power',
    licoes: [], questoes: [],
  },
  {
    codigo: 'central-gr', titulo: 'Monitoramento · GR Tracker', area: 'MONITORAMENTO', icone: '📡', validado: false,
    resumo: 'Tratativa de eventos na GR Tracker.', aguardandoMaterial: 'Aguardando o material de treinamento da GR Tracker',
    licoes: [], questoes: [],
  },
  {
    codigo: 'central-sincro', titulo: 'Monitoramento · Sincro', area: 'MONITORAMENTO', icone: '🔄', validado: false,
    resumo: 'Tratativa de eventos na central Sincro.', aguardandoMaterial: 'Aguardando o material de treinamento da Sincro',
    licoes: [], questoes: [],
  },
  {
    codigo: 'central-seven', titulo: 'Monitoramento · Seven', area: 'MONITORAMENTO', icone: '7️⃣', validado: false,
    resumo: 'Tratativa de eventos na central Seven.', aguardandoMaterial: 'Aguardando o material de treinamento da Seven',
    licoes: [], questoes: [],
  },
];

/** "Plantão ao vivo": o alerta chega e o operador decide, contra o relógio. */
export const CENARIOS: Cenario[] = [
  {
    id: 'sim-bateria', titulo: 'Madrugada: bateria removida', area: 'MONITORAMENTO', tempoSeg: 90,
    alerta: 'Descrição do Evento: REMOÇÃO DE BATERIA · Placa: ABC1D23 · Localização: Av. Brasil, Rio de Janeiro/RJ · 03:12',
    etapas: [
      { pergunta: 'Qual a prioridade?', opcoes: ['Baixa', 'Média', 'Alta', 'Crítica'], certa: 3, explicacao: 'Remoção de bateria é CRÍTICA.' },
      { pergunta: 'Primeira ação no sistema?', opcoes: ['Encerrar como falso alarme', 'Assumir o evento', 'Abrir SAC', 'Esperar amanhecer'], certa: 1, explicacao: 'Assumir registra quem está tratando e quando.' },
      { pergunta: 'Ligou para o cliente e ele vai retornar. Status?', opcoes: ['Aguardando', 'Encaminhado', 'Encerrado', 'Novo'], certa: 0, explicacao: 'Esperando retorno = AGUARDANDO.' },
      { pergunta: 'O cliente confirma que o veículo foi levado. E agora?', opcoes: ['Encerrar como resolvido remoto', 'Vira atendimento Veicular de recuperação', 'Encerrar como cancelado', 'Ignorar'], certa: 1, explicacao: 'Roubo/furto = atendimento Veicular.' },
    ],
  },
  {
    id: 'sim-fila', titulo: 'Fila cheia na troca de turno', area: 'MONITORAMENTO', tempoSeg: 60,
    alerta: '3 eventos na fila: CERCA (placa XYZ9A87) · PAINEL VIOLADO (placa QWE4R56) · PERDA DE SINAL (placa JKL2M34)',
    etapas: [
      { pergunta: 'Qual assumir primeiro?', opcoes: ['Cerca', 'Painel violado', 'Perda de sinal', 'O mais antigo'], certa: 1, explicacao: 'Painel violado é CRÍTICO.' },
      { pergunta: 'A perda de sinal é de um veículo que entrou num shopping subterrâneo. Melhor leitura?', opcoes: ['Roubo certo', 'Possível área de sombra: acompanhar a última posição', 'Encerrar como duplicado', 'Bloquear o veículo'], certa: 1, explicacao: 'Confirme antes de concluir.' },
      { pergunta: 'O evento de cerca chegou repetido 2 vezes. O segundo se encerra como...', opcoes: ['Falso alarme', 'Duplicado', 'Sem contato', 'Cancelado'], certa: 1, explicacao: 'Duplicado não conta duas vezes.' },
    ],
  },
  {
    id: 'sim-restrito', titulo: 'Acionamento bloqueado', area: 'MONITORAMENTO', tempoSeg: 60,
    alerta: 'Descrição do Evento: VEÍCULO BLOQUEADO · Placa: BRA2E19 · Localização: Rod. Anhanguera km 32 · o prestador mais próximo aparece como RESTRITO',
    etapas: [
      { pergunta: 'Prioridade?', opcoes: ['Crítica', 'Alta', 'Média', 'Baixa'], certa: 1, explicacao: 'Bloqueio = ALTA.' },
      { pergunta: 'O prestador mais próximo está RESTRITO. Você...', opcoes: ['Aciona mesmo assim', 'Aciona o próximo disponível que não é restrito', 'Encerra sem prestador', 'Pede para o restrito ir escondido'], certa: 1, explicacao: 'Restrito nunca é acionado.' },
      { pergunta: 'Prestador a caminho. Status?', opcoes: ['Aguardando', 'Encaminhado', 'Encerrado', 'Em tratativa'], certa: 1, explicacao: 'Prestador acionado = ENCAMINHADO.' },
    ],
  },
  {
    id: 'sim-patrimonial', titulo: 'Chamado de ronda no grupo', area: 'PATRIMONIAL', tempoSeg: 90,
    alerta: 'Grupo do cliente: "Solicito ronda na loja Centro, ocorrência 33760663, disparo setor 3" · 22:40',
    etapas: [
      { pergunta: '33760663 é...', opcoes: ['O ID PR7', 'A ocorrência do cliente', 'O telefone', 'O valor'], certa: 1, explicacao: 'ID PR7 tem 4 a 6 dígitos.' },
      { pergunta: 'Onde este chamado é acompanhado?', opcoes: ['Monitoramento', 'Atendimentos', 'SAC', 'Pagamentos'], certa: 1, explicacao: 'Patrimonial = Atendimentos.' },
      { pergunta: '15 min depois o cliente escreve "pode cancelar, era teste". Status?', opcoes: ['Não atendido', 'Cancelado (com motivo)', 'Concluído', 'Duplicado'], certa: 1, explicacao: 'Cliente cancelou = CANCELADO; o sistema conta os minutos.' },
    ],
  },
  {
    id: 'sim-sac', titulo: 'Prestador cobrando pagamento', area: 'SAC', tempoSeg: 60,
    alerta: 'Prestador no privado: "Fiz 3 rondas dia 10 e até hoje (dia 20) não caiu nada"',
    etapas: [
      { pergunta: 'Isso vira...', opcoes: ['Chamado de cliente', 'Ticket de SAC, prioridade alta', 'Evento', 'Nada'], certa: 1, explicacao: 'Reclamação de prestador = SAC.' },
      { pergunta: 'Rondas do dia 10 entram em qual fechamento?', opcoes: ['Quinzena que fecha dia 16', 'Mês seguinte', 'Fechamento do dia 30 do mês anterior', 'Nenhum'], certa: 0, explicacao: 'Dias 1–16 fecham no dia 16 às 23h59.' },
      { pergunta: 'O ticket se resolve quando...', opcoes: ['O prestador para de reclamar', 'O comprovante é postado no grupo de pagamentos', 'Passa uma semana', 'O cliente paga'], certa: 1, explicacao: 'O comprovante é a prova.' },
    ],
  },
];

/** Ranques (como nos jogos competitivos atuais): por XP total. */
export const RANQUES = [
  { nome: 'Recruta', xp: 0, cor: '#94a3b8' },
  { nome: 'Bronze', xp: 150, cor: '#b45309' },
  { nome: 'Prata', xp: 400, cor: '#cbd5e1' },
  { nome: 'Ouro', xp: 800, cor: '#fbbf24' },
  { nome: 'Platina', xp: 1300, cor: '#2dd4bf' },
  { nome: 'Diamante', xp: 2000, cor: '#38bdf8' },
  { nome: 'Elite', xp: 3000, cor: '#a78bfa' },
  { nome: 'Lenda da Central', xp: 4500, cor: '#f472b6' },
];

export function modulo(codigo: string) { return MODULOS.find((m) => m.codigo === codigo); }
export function questao(id: string) {
  for (const m of MODULOS) { const q = m.questoes.find((x) => x.id === id); if (q) return { m, q }; }
  return null;
}
