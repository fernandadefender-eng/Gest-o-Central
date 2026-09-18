# Plataforma de Atendimento, Prestadores e Despacho (WhatsApp)

## 🚀 Estratégia de rollout (confirmada em 2026-09-12) — não interferir na operação atual

Preocupação central do usuário: como colocar o novo sistema em uso sem arriscar a operação real que já funciona hoje (sistema atual + grupos de WhatsApp). Estratégia acordada:

1. **Número de WhatsApp separado para testes** — nunca usar o número que já opera com clientes reais até o novo sistema estar validado. API oficial configurada num número novo/secundário.
2. **Rodar em paralelo, não substituir de uma vez** — sistema atual (`pr7sistemas.com.br` + grupos de WhatsApp) continua em uso normal enquanto o novo sistema roda ao lado.
3. **Migração por etapas**: (a) Fase 1 primeiro — só observação/classificação/relatórios, zero interferência; (b) um cliente ou região por vez adota o novo fluxo de despacho; (c) por último, e só quando a equipe estiver confortável, substituir os grupos de WhatsApp internos pela central dentro do app.
4. **Treinamento em paralelo** antes de qualquer corte definitivo (usa o tutorial guiado já planejado para a Fase 2).
5. **Atenção técnica**: se já existe um número de WhatsApp Business (app comum) usado com clientes, migrá-lo para a API oficial tem processo específico da Meta que pode gerar indisponibilidade se feito sem cuidado — outro motivo para começar num número separado.

**Confirmado sobre o comportamento atual da Fase 1**: o sistema é **passivo/somente observação** — lê e classifica as conversas (extrai cliente, categoria, resumo, status), mas **não envia nenhuma mensagem automática para o cliente**. Os operadores continuam respondendo manualmente como hoje, sem nenhuma mudança no dia a dia deles. Uma eventual resposta automática de confirmação (ligada ao princípio de agilidade, ver seção abaixo) é uma melhoria **ativa** a ser decidida separadamente no futuro, não algo já implementado ou implícito nesta fase.

## 🎯 Visão do produto (confirmada em 2026-09-12)

O objetivo não é só substituir o sistema atual (`pr7sistemas.com.br`) — é construir **uma das melhores plataformas do mercado brasileiro de segurança patrimonial/veicular**, com padrão visual e de usabilidade muito acima do que existe hoje (lento, quebrado, feio — ver achados abaixo). Isso deve guiar toda decisão de UI daqui pra frente: **visual e intuitivo antes de qualquer coisa**, não só funcional. Referências de qualidade já aplicadas no painel: paleta calma, modo escuro, cartões de resumo, mapas ao vivo, gráficos — esse é o nível a manter/elevar em cada tela nova, não só na primeira.

**Princípio operacional inegociável: agilidade no atendimento ao cliente.** O cliente sempre deve ser respondido com rapidez e em tempo hábil — isso não é só uma meta de atendimento humano, é um requisito de produto que deve aparecer em várias partes do sistema:
- Fase 1: considerar uma resposta automática imediata ao cliente confirmando o recebimento da solicitação, enquanto a classificação/despacho acontece em segundo plano (o cliente não deve ficar sem retorno nenhum enquanto isso).
- Fase 3: os prazos de despacho e escalonamento (15-30 min, alerta de SLA) já existem justamente para isso — reforça que devem ser levados a sério, não só como campo de dado.
- Fase 4 (SAC): tempo de resposta ao prestador também deve ser rápido, mesma lógica.
- **Sugestão a considerar**: expor tempo médio de resposta/atendimento como métrica visível no dashboard (cartão de estatística), já que é um princípio central do negócio — vira algo que a operação pode acompanhar, não só uma intenção.

## 📋 Checklist consolidado de pendências (atualizado 2026-09-13)

**Fase 1 — status:**
- [x] ~~`ANTHROPIC_API_KEY` real~~ — configurada e **validada com sucesso** em 2026-09-13: IA classificou uma conversa de teste real corretamente (categoria, resumo, status). Fase 1 está funcionalmente completa e testada de ponta a ponta.
- [ ] Falta apenas conectar a um BSP de WhatsApp real (Z-API ou similar) para substituir a simulação do webhook por mensagens de clientes de verdade.
- **📅 Combinado para amanhã (próxima sessão)**: implantar a integração real do WhatsApp, seguindo a estratégia de rollout (ver seção no topo) — número **separado** do que já atende clientes hoje. **Número já definido: (11) 97476-1437** — está fisicamente na empresa e em uso agora, só estará disponível para configurar amanhã. **⚠️ Não enviar nada para esse número antes disso** (nem verificação, nem mensagem de teste) — combinado explicitamente com o usuário, porque isso interferiria no uso atual do aparelho. Usuário ainda precisa trazer/decidir: conta em um BSP (Z-API recomendado) ou disposição para criar uma na sessão. Do lado técnico já está pronto: webhook implementado e testado com dados simulados — falta só apontar o BSP real e ajustar o formato exato do payload contra o sandbox dele.

**O usuário vai trazer (aguardando, sem bloquear o resto):**
- [x] ~~Vídeo mostrando o fluxo real~~ — recebido e analisado (2 vídeos), achados abaixo.
- [ ] Campos detalhados dos demais subtipos de serviço dentro de "Patrimonial" e "Veicular" (já temos 3 mapeados: "Pronta Resposta", "Recuperação de Veículo", "Análise de Tecnologia Rastreável" — **nota**: "Manutenção Patrimonial" apareceu como item de menu separado no sistema atual, pode ser um 4º subtipo distinto de "Pronta Resposta", não confirmado ainda)
- [ ] Conta em um BSP do WhatsApp (Z-API ou similar) — número já definido, (11) 97476-1437, disponível a partir de amanhã
- [ ] Decisão: Clicksign ou Autentique para assinatura eletrônica
- [ ] Export/acesso aos dados do sistema atual (`pr7sistemas.com.br`) para planejar a migração (2000 atendimentos patrimoniais + 1000 ocorrências veiculares) — usuário confirmou que os dados têm muitos erros de digitação e vão precisar de limpeza/reestruturação antes da migração.
- [ ] Deploy de produção (Postgres + Redis + API) — recomendação Railway, ainda não iniciado (ambiente atual é só local/dev).

**Decisões de negócio pendentes (não bloqueiam código, mas precisam ser fechadas antes da fase correspondente):**
- [ ] O que acontece quando o contrato do prestador vence (5 anos) — bloquear novos chamados ou só alertar?
- [ ] Confirmar/corrigir a suposição de marca d'água (data/GPS) nas fotos do relatório de campo

**Achados do vídeo do fluxo real (levantado em 2026-09-12) — mudam suposições anteriores:**
- O usuário mandou um vídeo mostrando o processo real. Achados-chave:
  - **Existe uma plataforma de monitoramento de alarme de terceiros já em uso**, com tela de ocorrência mostrando Filial/CNPJ, conta do painel de alarme (ex: "#17DF"), endereço, prioridade, e um **histórico de eventos já estruturado** ("Solicitação enviada ao agente tático...", "Mudança de status para Deslocamento por [operador]", "Deslocamento sem evolução por 1 minuto" — este último parece um alerta automático de SLA). **Usuário reportou que essa plataforma "não está boa" e "sempre temos problemas com ela"** — vai mostrar mais detalhes antes de decidirmos se o novo sistema integra, substitui ou ignora essa plataforma. **Não decidir a arquitetura de ingestão de alarmes até essa demonstração acontecer.**
  - **A coordenação operacional real acontece em grupos de WhatsApp pessoal** (WhatsApp Web comum, não API oficial) entre operadores do PR7 e agentes de campo — um grupo por cliente/parceiro (ex: "PR7 & ORSEGUPS") e grupos por ocorrência (ex: "Preservação 232EC-13/09"). **Decisão confirmada**: essa coordenação interna operador↔agente deve migrar para **dentro do próprio app** (substituindo os grupos do WhatsApp), não ficar dependendo de WhatsApp pessoal — evita o risco de ToS/banimento. O WhatsApp Business oficial continua sendo o canal para conversa com o **cliente final** (não a coordenação interna).
  - **Nome real do serviço confirmado**: "**Pronta Resposta**" (não "Alarme/Vistoria" como suposto antes) — é assim que o operador se refere ao serviço no relatório manual.
  - **Template real do "Retorno Deslocamento"** que o operador digita manualmente no grupo ao final do atendimento (captado do vídeo, campo a campo): `ID`, `Conta` (código do painel de alarme, ex: "17DF6"), `Ocorrência` (número separado do ID), `Op.solicitante`, `Estabelecimento`, `Op. PR7` (operador interno, ex: "KEMILY"), `Agente` (técnico de campo, ex: "Francisco"), `Data da solicitação`, `Hr. solicitada`, `Hr. de chegada`, `Serviço de serviço` (ex: "Pronta Resposta"). Isso é uma ótima referência para o formulário estruturado que deve substituir esse texto manual dentro do app.
  - Exemplo real de negociação capturado: cliente ("Corporativo") pede para cancelar por o alarme ter sido desarmado remotamente; operador pergunta ao agente "No local?"; agente confirma "Sim" (já tinha chegado); atendimento segue normalmente em vez de ser cancelado.

**Achados do vídeo do sistema atual (`pr7sistemas.com.br`) — levantado em 2026-09-12:**
- **O PR7 já tem um sistema próprio completo**, não é uma planilha manual. Módulos existentes: Dashboard, Acionamentos, Ocorrência Veicular, Manutenção Patrimonial, Prestadores, Usuários, Financeiro, Pendentes, Chat, Histórico, Clientes, e configurações (Equipe, Serviço, Regra, Locação, Notificações, Banco).
- **Volume real de dados**: 2000 atendimentos patrimoniais e 1000 ocorrências veiculares já registrados (367 veículos recuperados, 535 ocorrências finalizadas).
- A lista "Atendimento Patrimonial" já tem: Id, Data, Cliente, Conta, Nome Agente, Equipe, Responsável, Estabelecimento, Fotos, Data Final, Status (badge colorido, ex: "Finalizado"), **exportação em PDF já funciona por atendimento**, Link (compartilhável), Usuário.
- Uma aba do navegador mostrou "OCOMON 5.5" (sistema de chamados open-source) — parte do sistema atual pode ser construído sobre ele; também apareceu um IP de servidor (104.210.149.42), sugerindo infraestrutura própria/terceirizada a ser investigada.
- **🚨 Bug crítico de integridade de dados reportado pelo usuário**: o sistema atual permite trocar o endereço vinculado a uma conta sem validação — ex: atendem a conta 320 com o endereço da conta 350 e vice-versa, e "o sistema aceita" essa troca sem alertar. Isso é um risco operacional sério (prestador pode ser despachado para o endereço errado). **Requisito não-negociável para o novo sistema**: a relação Conta ↔ Endereço/Estabelecimento deve ter integridade forte — no mínimo confirmação explícita e trilha de auditoria para qualquer alteração, idealmente validação que impeça a troca acidental entre contas diferentes.
- **Motivos confirmados para reconstruir** (usuário marcou todos): lentidão/travamentos (visto na prática — tela "aguarde, dados sendo carregados" ao abrir uma lista), funcionalidades quebradas/incompletas (ex: "Ocorrências Validadas: 0" de 1000 — funcionalidade não utilizada ou quebrada), visual/usabilidade ruim, e dependência de terceiro para manter/evoluir o sistema.
- **Migração de dados históricos**: confirmada como necessária, porém os dados atuais **têm muitos erros de digitação** e vão exigir limpeza/reestruturação antes de entrarem no novo sistema — não é uma migração direta 1:1. Isso deve ser tratado como uma etapa própria (provavelmente na Fase 5, ou uma mini-fase de ETL/limpeza de dados), não assumida como trivial.

**Mapas — decisão de custo (2026-09-13): usar Leaflet + OpenStreetMap (gratuito).**
Google Maps cobra por carregamento de mapa (~R$ 170/mês no cenário de ~10 operadores abrindo a tela ~20x/dia; a posição do prestador se movendo sobre um mapa já carregado não custa a mais). Decisão do usuário: começar pelo gratuito e reavaliar depois se o visual do Google justifica o custo. Para o mapa de incidência, vale gerar a imagem periodicamente (ex: mensal) e servir do nosso servidor com a data da última atualização — custo praticamente zero e suficiente, já que é dado histórico.

**Mapas e geolocalização (levantado em 2026-09-12):**
- **Mapa de prestadores**: usuário pediu integração com Google My Maps. Ficou sem resposta se é o produto My Maps especificamente (atualização manual/periódica, sem tempo real) ou um mapa ao vivo dentro do próprio app. **Suposição de trabalho**: como a Fase 3 já prevê rastreamento em tempo real estilo Uber, o mapa de prestadores será **um mapa ao vivo dentro do próprio painel** (não o produto Google My Maps em si, que não suporta atualização em tempo real bem). Se o usuário realmente quiser o My Maps especificamente (ex: para compartilhar um link simples), isso pode ser adicionado como uma exportação periódica adicional, não como substituto do mapa ao vivo.
- **Mapa/relatório de incidência de atendimentos**: cada local atendido deve ser mapeado, com um relatório mostrando onde os chamados mais acontecem (mapa de calor por região/cliente). **Suposição de trabalho**: mapa de calor (heatmap) integrado ao painel, usando os endereços/coordenadas já registrados nos atendimentos — dado que reforça ainda mais a importância de resolver o bug de integridade Conta↔Endereço mencionado acima (um heatmap com endereços errados dá relatório errado).

**Acesso multi-atendente ao WhatsApp (levantado em 2026-09-12):**
- Cada atendente/operador do PR7 precisa ter **login e senha individuais** para acessar o WhatsApp (não uma conta compartilhada sem rastreabilidade). Isso confirma a necessidade de uma **central de atendimento multi-usuário** (inbox) dentro do nosso sistema — cada operador loga com sua própria credencial, vê/responde as conversas do número oficial do WhatsApp Business, e cada ação fica associada a ele (isso já é consistente com o campo "Op. PR7: KEMILY" visto no relatório real de despacho). Isso é adicional ao acesso admin já existente na Fase 1 — vai precisar de um novo perfil de usuário "atendente" com permissões mais restritas que o admin.

**Recomendações que dependem de profissional externo (fora do meu escopo técnico):**
- [ ] Revisão por advogado trabalhista sobre o grau de controle operacional do sistema sobre o prestador (risco de vínculo empregatício)
- [ ] Validação jurídica de LGPD (política de privacidade, base legal de tratamento de dados)
- [ ] Confirmar normas técnicas/registros profissionais aplicáveis a serviços de alarme (ABNT, CREA, alvará municipal)

## Contexto

O usuário administra atendimentos via WhatsApp e precisa unificar quatro necessidades em uma única plataforma:
1. Monitorar conversas do WhatsApp e transformá-las em registros de atendimento estruturados por cliente, com relatórios/planilhas.
2. Portal onde prestadores de serviço se cadastram e assinam contrato em PDF digitalmente.
3. Motor de despacho estilo Uber: ao abrir um atendimento, acionar automaticamente o prestador mais próximo disponível.
4. SAC — canal de chat entre a operação e os prestadores.

**⚠️ Restrição de escopo do negócio (confirmada em 2026-09-12 — vale para todas as fases):** o PR7 **não presta e não pode prestar** serviço de **vigilância** (segurança patrimonial armada/patrulhamento) nem **escolta armada** — atividades reguladas pela Lei 7.102/1983, que exigem licenciamento específico junto à Polícia Federal que a empresa não possui. Os serviços reais são: técnico de manutenção/vistoria de sistemas de alarme (Patrimonial) e recuperação/rastreamento de veículos (Veicular). Isso deve orientar todo o vocabulário do sistema (categorias de serviço, textos de notificação, papéis de usuário) — nunca usar termos como "vigilante", "segurança armada" ou "escolta" para descrever prestadores ou serviços.

Decisões confirmadas com o usuário:
- **WhatsApp**: sem acesso oficial ainda → começar com um BSP (Z-API) e abstrair a integração para permitir migrar depois para a Cloud API oficial da Meta sem reescrever o resto do sistema.
- **Classificação dos atendimentos**: API da Claude (Anthropic) lê cada conversa e extrai cliente, tipo de serviço, status e resumo automaticamente.
- **Assinatura de contrato**: serviço especializado (Clicksign ou Autentique) em vez de solução própria, pela força jurídica e trilha de auditoria.
- **Hospedagem**: recomendação — Railway para o MVP, com caminho de migração para AWS se o volume crescer.

## Arquitetura

**Stack**
- Backend: Node.js + TypeScript, NestJS (módulos por domínio: whatsapp, classification, atendimentos, reports, auth; e futuramente providers, dispatch, sac)
- Banco de dados: PostgreSQL (Prisma ORM); PostGIS será adicionado na Fase 3 para busca por proximidade
- Fila: Redis + BullMQ (processamento assíncrono das mensagens recebidas)
- Frontend (fases futuras): Next.js — Admin/Dashboard e Portal do Prestador
- IA: Anthropic SDK (Claude) para classificação/extração das conversas
- E-signature (Fase 2): API do Clicksign ou Autentique
- Planilhas: `exceljs`

**Entidades do banco (já implementadas)**
- `Client`, `Provider` (mínimo), `Conta` (vínculo cliente↔endereço, com trava de integridade — ver achados do sistema atual), `Conversation`, `Message`, `Atendimento` (já com `contaId`, `ocorrencia`, `operadorPR7`), `AdminUser`

**Entidades futuras**
- `Contract` (Fase 2), `FieldReport` + campos de despacho no `Atendimento` (Fase 3), `ChatThread`/`ChatMessage` (Fase 4), tabela de preço por prestador/tipo de serviço (Fase 2)

## Roadmap por fases

- **Fase 0 — Fundação** ✅ implementada: monorepo, Prisma, auth JWT básica, docker-compose (Postgres+Redis)
- **Fase 1 — Ingestão WhatsApp + Relatórios** ✅ implementada: webhook, fila BullMQ, classificação via Claude, endpoints de listagem e exportação Excel
- **Fase 2 — Portal de Prestadores**: cadastro, geração de PDF de contrato, integração de assinatura eletrônica (Clicksign/Autentique)

  **Regras de negócio adicionais (levantadas em 2026-09-12):**
  - Cadastro do prestador precisa incluir **quais tipos de serviço** ele realiza (vinculado à taxonomia de serviços — ver seção da Fase 3) e o **valor acordado** por tipo de serviço com aquele prestador especificamente (tabela de preços por prestador, não um valor único global).
  - Aba "Contratos": os contratos ficam armazenados no próprio sistema (não só no provedor de assinatura externo) e são enviados para assinatura digital.
  - Contrato tem **validade de 5 anos** a partir da assinatura — precisa de um campo de data de vencimento (`assinadoEm + 5 anos`).
  - **Pendente de decisão**: o que acontece quando o contrato vence — bloquear o prestador de receber novos chamados, só alertar no painel, ou outra regra. Não implementar comportamento de bloqueio automático até isso ser confirmado.
  - **Verificação de antecedentes criminais** (levantado em 2026-09-12, corrigido em seguida): **correção importante** — o PR7 não presta serviço de vigilância/segurança armada, e sim **técnico de manutenção e vistoria de sistemas de alarme** (não se enquadra na Lei 7.102/1983 de vigilantes). Ainda assim, o usuário quer garantir que os prestadores sejam "pessoas íntegras" — a verificação de antecedentes criminais continua sendo um requisito, mas como **política interna de confiança do PR7** (já que o técnico acessa o imóvel e o sistema de segurança do cliente), não como exigência legal de categoria profissional regulada. Mecanismo definido: o prestador **anexa a certidão oficial de antecedentes criminais** (documento gratuito emitido pela Polícia Federal) como parte dos documentos do cadastro, e um **operador do PR7 revisa manualmente** antes de aprovar o prestador — sem integração automática com serviço de background check por enquanto. Isso se soma aos documentos já previstos no cadastro (Fase 2).
  - **Tutorial guiado no primeiro acesso** (levantado em 2026-09-12): em vez de vídeo de treinamento externo, o portal do prestador deve ter um **onboarding guiado dentro do próprio app** (como o Uber faz na primeira vez que o motorista abre o app) — telas de instrução passo a passo na primeira vez que o prestador loga. Não depende de produção externa de vídeo.
  - **Saldo a receber** (levantado em 2026-09-12): o portal do prestador deve mostrar o **saldo que ele tem a receber**, calculado a partir dos atendimentos concluídos e do valor acordado por tipo de serviço (já registrado no cadastro). Isso liga diretamente com o módulo "Financeiro" já existente no sistema atual (`pr7sistemas.com.br`) — vale investigar como ele calcula isso hoje antes de desenhar do zero. Implica que o modelo de dados precisa relacionar: `Atendimento` concluído → `Provider` → tabela de preços por tipo de serviço → soma acumulada não paga ainda (`saldoAReceber`), com algum registro de quando um pagamento é feito (baixa do saldo).
- **Fase 3 — Motor de Despacho**: PostGIS, fluxo de oferta/aceite/recusa com escalonamento por proximidade

  **Regras de negócio detalhadas (levantadas em 2026-09-12):**
  - Ao chegar no local, o prestador tem uma **janela de análise** (15-30 min) para inspecionar o sistema de alarme e o local. O tempo é **variável por tipo/categoria de chamado** (ex: alarme residencial vs comercial podem ter prazos diferentes) — precisa de um campo de prazo configurável por categoria, não um valor fixo global.
  - Se o prazo estourar sem o prestador enviar o relatório, o sistema deve **alertar/escalar para o SAC/operador** (não é só um indicador passivo no painel).
  - **Rastreamento em tempo real estilo Uber** (levantado em 2026-09-12): a tela de despacho precisa mostrar o **deslocamento do prestador em um mapa ao vivo**, do mesmo jeito que o app do Uber mostra o motorista se movendo até o passageiro. Isso exige: geolocalização contínua do prestador (não só um ponto fixo), atualização em tempo real (Socket.io já está no plano da Fase 3), e o app do prestador precisa **solicitar/ativar as permissões de dispositivo necessárias** (localização — inclusive em segundo plano, se vier a ser app nativo/PWA — câmera para fotos, notificações). Isso é um requisito de UI/UX relevante e deve ser considerado desde o design da tela, não só o backend de geolocalização.
  - **Marca d'água nas fotos do relatório de campo (suposição de trabalho, a confirmar com o usuário)**: como é padrão em apps de vistoria/segurança patrimonial (tipo "GPS Map Camera"), presumindo que cada foto enviada no relatório de campo deve vir com **data/hora e localização GPS marcadas na própria imagem** (marca d'água), como prova de que o prestador estava de fato no local. Essa suposição precisa ser confirmada ou corrigida pelo usuário antes de implementar.
  - Após a inspeção, o prestador envia um **relatório de campo**: fotos + informações que podem ser em **áudio ou texto**. Isso é um novo tipo de conteúdo além das mensagens de WhatsApp — precisa de armazenamento de mídia (fotos/áudio) vinculado ao atendimento/despacho.
  - Cada solicitação de serviço (vinculada a conta + endereço do cliente) gera um **ID de atendimento único por cliente** — já coberto pelo modelo `Atendimento` da Fase 1 (cada registro tem UUID próprio vinculado ao `Client`); confirmar que esse ID também aparece no relatório de campo da Fase 3.

  **Impacto no modelo de dados (a detalhar quando a Fase 3 começar):**
  - `ServiceRequest` (ou o próprio `Atendimento`) precisa de: `arrivalAt` (chegada do prestador), `inspectionDeadlineMinutes` (prazo configurável por categoria), `reportSubmittedAt`.
  - Nova entidade `FieldReport` (ou similar): fotos (upload de arquivo), notas em áudio (upload + possível transcrição), notas em texto, vinculada ao atendimento e ao prestador.
  - Mecanismo de alerta/escalonamento: quando `now > arrivalAt + prazo` e não há `reportSubmittedAt`, disparar notificação para o SAC/operador (provavelmente via a mesma fila BullMQ usada na Fase 1).

  **Exportação multi-formato do relatório de campo (levantado em 2026-09-12):**
  - O `FieldReport` (relatório de vistoria do prestador) precisa poder ser exportado em **PDF, Word (.docx), Excel (.xlsx) e XML** — não só visualizado na tela do painel.
  - O XML especificamente vai alimentar/representar o **banco de dados consolidado de todos os atendimentos** (é uma exportação estrutural do histórico, não um formato pontual por relatório individual).
  - **Pendente**: o usuário vai enviar uma planilha com os campos exatos que precisam ser coletados no relatório de campo. A estrutura final do `FieldReport` e dos exports só deve ser fechada depois de receber essa planilha — não adiantar suposições sobre os campos.

  **Taxonomia de tipos de serviço (levantado em 2026-09-12):**
  O PR7 (marca/empresa do usuário — domínio `pr7.seg.br`, empresa de segurança) presta múltiplos tipos de serviço agrupados em pelo menos duas categorias:
  - **Patrimonial** — inclui "Alarme/Vistoria" (detalhado acima) e outros subtipos ainda não especificados pelo usuário.
  - **Veicular** — inclui "Recuperação de veículo" (furto/roubo) e "Análise de tecnologia rastreável / rastreamento veicular" (levantado em 2026-09-12 — serviço distinto de instalação/análise/monitoramento de tecnologia de rastreamento GPS no veículo, não reativo a um furto específico) — e possivelmente outros subtipos ainda não especificados.

  O usuário vai enviar os campos dos demais subtipos depois — **pendente de acompanhamento, o usuário pediu explicitamente para ser lembrado/cobrado disso**.

  **Decisão de arquitetura de dados confirmada:** núcleo comum (`Atendimento`: cliente, conta, filial, datas do ciclo de vida, agente, valores, usuário) + uma tabela de detalhe específica por tipo de serviço (ex: `VehicleRecoveryDetail`, `AlarmInspectionDetail`), em vez de uma tabela única com todas as colunas de todos os tipos misturadas.

  **Campos levantados para "Recuperação de Veículo" (planilha real, linha de exemplo/modelo):**
  Status, Id, Data, Hora Solicitação, Cliente, Placa, Motivo, Recuperado (Sim/Não), Solicitante, Cidade, Estado, Latitude, Longitude, Agente, Pix, Equipes, Km Inicial, Km Final, Km Total, Km Excedente, Valor do Km Excedente, Data Deslocamento, Data Local, Data Final, Total (tempo), Valor, Gasto adicional, Hora Excedente, Valor da Hora Excedente, Valor total, Observação, Usuário.

  **Campos levantados para "Alarme/Vistoria" (cabeçalho de planilha):**
  Id, Cliente, Estabelecimento, Data da solicitação, Data Final, Conta, SAP (código de integração com sistema SAP externo — integração futura, não detalhada ainda), Ordem (código SAP), Validação (código que o cliente usa para validar/aprovar o atendimento), Filial, Endereço, Cidade, Estado, Tipo de Serviço, Pagamento, Motivo, Solicitante (cliente que pediu), Operador Pr7 (colaborador interno que atende), Data Deslocamento, Data Local, Data de Finalização, Total de Horas, Data de Pagamento, Nome do Agente, Equipe, Pix, Insumos de emergência, Valor, Valor cobrado, Usuário (quem digitou o registro), Observação.

  **Hierarquia do cliente confirmada:** Filial (matriz, por Estado) → várias Contas/unidades vinculadas a ela → Estabelecimento (endereço específico onde o serviço é prestado).

  **Linha do tempo operacional confirmada (sem duplicidade):** Data da solicitação → Data de Deslocamento (hora) → Data Local/chegada (hora) → Data de Finalização (hora).
- **Fase 4 — SAC**: chat em tempo real operação ↔ prestador
- **Fase 5 — Consolidação**: dashboard único, testes ponta a ponta, deploy de produção

## Conformidade (Meta WhatsApp + LGPD)

Levantado em 2026-09-12 — requisitos técnicos que impactam a implementação (não substitui aconselhamento jurídico formal, que o usuário deve buscar separadamente para validar política de privacidade e base legal de tratamento de dados).

**WhatsApp Business Platform (Meta):**
- Canal **exclusivamente oficial** (BSP/Cloud API) — já é a decisão tomada na Fase 1, especificamente para evitar banimento do número.
- **Opt-in obrigatório**: só iniciar conversa com um cliente que já deu consentimento (cadastro prévio, aceite explícito). Não enviar mensagem para número que nunca teve contato/consentimento com a empresa. → Fase 1/2: o cadastro de cliente/prestador precisa de um campo de consentimento (`optInAt` ou similar).
- **Janela de 24h**: fora desse período após a última mensagem do cliente, só é possível reabrir contato com um **template de mensagem pré-aprovado pelo Meta** (HSM). Isso afeta diretamente as notificações de despacho (ex: "prestador a caminho") e do SAC — não podem depender de mensagem livre se o cliente não escreveu recentemente. → Fase 3/4: mapear quais notificações automáticas exigem template aprovado, e cadastrar esses templates no BSP com antecedência (processo de aprovação do Meta pode levar dias).
- **Rating de qualidade do número**: volume de mensagens novas e taxa de bloqueio/denúncia afetam o limite diário de envio — monitorar isso quando o volume crescer.
- **Categoria de negócio**: segurança patrimonial/veicular deve ser aceita, mas comunicações com tom "emergencial" (ex: alarme disparado) podem passar por revisão mais rígida na aprovação de templates — testar cedo com o BSP escolhido, antes de depender disso em produção.

**LGPD (Lei Geral de Proteção de Dados):**
- O sistema processa dados pessoais reais (nome, telefone, endereço, e potencialmente dados sensíveis ligados a ocorrências de segurança). Isso exige, no mínimo:
  - Política de privacidade acessível aos clientes e prestadores.
  - Base legal definida para o tratamento (provavelmente execução de contrato/legítimo interesse, a confirmar com jurídico).
  - Controle de acesso: quem no sistema pode ver quais dados (já começamos com JWT + roles; expandir conforme mais perfis de usuário forem criados nas próximas fases).
  - Mecanismo para atender pedidos de titular (acesso/exclusão de dados), mesmo que manual no início.
- **Pendente**: usuário não tem advogado/consultor de LGPD envolvido ainda no momento deste registro — os itens acima ficam como requisitos técnicos a implementar por padrão (privacy-by-design), mas a validação jurídica formal (política de privacidade, base legal) deve ser buscada separadamente pelo usuário.

**Outras áreas regulatórias levantadas (2026-09-12) — não é parecer jurídico, são pontos para o usuário validar com profissional especializado:**
- **Alarmes (Patrimonial)**: possíveis normas técnicas ABNT para sistemas de alarme/segurança eletrônica; possível exigência de registro profissional (CREA ou similar) para quem assina laudos técnicos, dependendo da complexidade; alvará municipal para empresa de segurança eletrônica (varia por cidade).
- **Recuperação de veículo (Veicular)**: o papel do prestador deve ser localização/rastreamento — abordagem/apreensão do veículo deve envolver a polícia, não o agente sozinho, pelo risco de responsabilização civil/criminal. Dados de geolocalização em tempo real reforçam a exigência de LGPD já registrada.
- **⚠️ Risco trabalhista (vínculo empregatício)**: o grau de controle que o sistema exerce sobre o prestador (despacho automático, prazo de 15-30min, rastreamento GPS obrigatório, tutorial obrigatório, aprovação de cadastro) é o mesmo tipo de controle que gerou disputas judiciais no Brasil sobre motoristas de app (Uber, iFood) serem reclassificados de autônomos para empregados CLT. **Recomendação forte**: revisão por advogado trabalhista antes de produção, especificamente sobre o grau de controle operacional exercido pelo sistema.

## Verificação

- Fase 0: `docker compose up` local sobe Postgres/Redis; API inicia sem erros.
- Fase 1: enviar mensagem de teste no webhook, confirmar que gera `Atendimento` classificado e que o relatório `.xlsx` reflete os dados (ver `README.md` para o passo a passo).
- Fase 2: fluxo completo de cadastro → geração de PDF → assinatura em sandbox do provedor de e-signature.
- Fase 3: simular coordenadas de prestadores e confirmar que o despacho escala corretamente entre eles.
- Fase 4: teste de ida e volta de mensagens no chat SAC entre duas sessões (admin e prestador).
