# Registro do Projeto — Plataforma de Atendimento, Prestadores e Despacho

Log cronológico das decisões e passos executados. Ver também `docs/plano.md` (arquitetura, roadmap completo e **checklist de pendências no topo**) e `README.md` (como rodar).

## 2026-09-18 (10) — Leitor de eventos (2 formatos), SAC numerado, aba Roteirizador
- **Eventos perdidos corrigidos**: o leitor da central (`monitoramento/evento-telemetria.ts`) só entendia "Descrição do Evento" sem dois-pontos e no formato A. Passou a ler também "**Descrição do Evento:**" (com dois-pontos) e o formato B ("**Evento:** / **Veículo:** / **Endereço:**"). Antes, eventos com esses formatos se perdiam — foi o caso dos 2 Painel Violado da manhã de 18/09. `scripts/recuperar-eventos-perdidos.ts` recuperou 8 eventos (EV-000008 a 000015). Grupo oficial de eventos a partir de 18/09: "Tratativas de Eventos (Contatos Sem Cadastro)".
- **SAC numerado** ("Sac-0001"): `ChamadoSac.numero` (sequência `sac_numero_seq`, migração `20260918100000_sac_numero`), formatado por `identificadorSac`. Regra do usuário: "tudo que for tratado como SAC segue desta forma (Sac-)".
- **Aba Roteirizador** (`roteirizador/roteirizador-aba.module.ts`, permissão `roteirizador`): gere os atendimentos do **Tom / Clayton Amorim** (prestadores + categoria Roteirizador do acompanhamento velado) com **abastecimento e despesas do veículo**. Despesas em `detalhes.despesas` (tipos: abastecimento com litros/km, pedágio, manutenção, alimentação, estacionamento, outro); soma os gastos que já vinham do retorno (combustível, pedágio, alimentação). Filtro por período, resumo (total, abastecimento, litros). **Motorista do dia** ajustável (padrão Tom; outro nome quando ele não atende). Teste: `scripts/teste-roteirizador.ts` (11 verificações). Liberada para Supervisão.

## 2026-09-18 (9) — Revisão das planilhas dos backups; avatares; equipe atual
- **Revisão (só leitura)**: `scripts/revisar-planilhas-backup.ts` abriu 597 planilhas (backup do HD, backup_arquivo, fechamentos, Operadores, PR7PAT, 01-FECHAMENTO...), 182 com tabela de atendimentos. Relatório: `logs/revisao-planilhas-2026-09-18.md` (+ `.json`).
  - **Buraco real: 01 a 15/08/2026 não está no sistema** — a planilha mestre ("De Mattos… 2025", salva em 08/09) não tem nenhuma linha dessa quinzena (só 16–31/08, IDs 36239–36588). Os IDs 35920–36238 aparecem só nas planilhas de fechamento por cliente (Orsegups Vistorias 116, Belfort 93, Segurpro 89, Allarmi, G4S, Neoguard).
  - Outros IDs das planilhas que não estão no banco: "Acionamentos Gerais Outubro 2025" (42), "Pr7 Sistema 2024 janeiro – Stephany" (19), "VALIDAÇÃO TOTAL MAIO" 2024 (18), e ~100 linhas das próprias mestres 2024/2025 — 475 IDs únicos no total. Nada foi importado ainda (aguardando o de acordo).
  - Operadores: "Cleverson" = **Cleverton** (2020–08/2024; hoje duplicado como "Cleverton" 91 + "Cleverton Jose de Oliveira" 404). **Gustavo**: só 2 linhas (2022 e 2025). **Roberto**: não aparece em nenhuma planilha. Histórico de 2020–2023 (controles "PR7 – Controle Acionamentos" 2022, Simone, Stephanie, Ludmila…) não está no sistema (o banco começa em 01/2024).
  - Nomes das planilhas de **medição dos clientes** (Allarmi: Caroline, Shirley, Fabiano, Adriel, Cassia, Linifer, Joarle, Sirlei; Segurpro/Orsegups/Belfort: Maria, Paulo, José, Valter, Leandro, Norma, Wesley, Jaqueline) são operadores **dos clientes**, não Help Desk da PR7.
  - **Lucas** (busca dirigida, `scripts/buscar-operadores-planilhas.ts`): nunca aparece como Help Desk da PR7 — é o operador/solicitante **do cliente** (G4S "Lucas Rocha", Segurpro, Allarmi "OP2-…"); nesses blocos o Help Desk da PR7 está na coluna seguinte e o banco está certo (19/19 linhas conferidas).
  - **Thaline**: 827 atendimentos como "ATENDENTE" em `backup_hd_pr7/Para Organizar/Nova pasta/Cópia de REGISTRAR CCO.xlsm` (28/06/2022 → 06/01/2023) — histórico anterior ao sistema (junto com Gustavo e os controles de 2022).
  - Lixo na coluna Help Desk do banco: "RJ", "SP", "CE", "21:20:00", "S/I", "não consta", 2 e-mails, "Jota/JOTA", 618 vazios — a limpar.
- **Equipe atual**: Edi Carlos e Julia Farias "fora do jogo" (`FORA_DA_EQUIPE` em `equipe/nomes-help-desk.ts`): saem do ranking, das comparações e do feedback; histórico mantido (aparecem no fim, apagados, "não faz mais parte da equipe").
- **Vanessa é da cliente Power** (`OPERADORES_DO_CLIENTE`): PR7-H-000092 corrigido (Help Desk vazio, `detalhes.contatoDoCliente`), auditado; a leitura nunca mais põe "Vanessa" como Help Desk.
- **Avatares** na Academia: operador ou operadora com headset, na cor do ranque (`AdminUser.avatar`, migração `20260918090000_avatar`); escolha na 1ª entrada e botão "Trocar avatar"; aparecem no ranking.

## 2026-09-18 (8) — Academia PR7 (aba Treinamento) e revisão do PGR da central
- Pedido: aba Treinamento "com todos os serviços", no estilo dos jogos atuais (2024–2026), "tratativa de eventos principalmente", certificado da empresa com logo no final. Power, GR Tracker, Sincro e Seven "são monitoramento" (material oficial ainda será enviado).
- **Mecânicas** (genéricas, sem marca de jogo): XP e níveis, 8 ranques (Recruta → Lenda da Central), temporada de 30 níveis com recompensas, missões diárias, ofensiva de dias seguidos, 7 conquistas, ranking semanal (primeiro nome + inicial), "Plantão ao vivo" contra o relógio.
- **Conteúdo** (`apps/api/src/treinamento/conteudo.ts`): 7 módulos com 38 questões + 5 plantões, tirados das regras já confirmadas no sistema; 4 módulos de central (Power, GR Tracker, Sincro, Seven) reservados até chegar o material. **Gabarito só no servidor**; XP só no 1º acerto (sem "farm"); plantão só dá XP ao superar o próprio recorde.
- **Supervisão** (permissão `equipe`): progresso da equipe e ponto fraco de cada um; **validação do conteúdo** (só Supervisão/Admin) — só módulo validado entra no certificado; conferência do código do certificado.
- **Certificado**: PDF A4 paisagem com o logo oficial (copiado de `Projeto Financeiro PR7/frontend/public/logo-pr7.png` para `apps/api/assets/`, original intocado), nome, trilha, módulos, aproveitamento, ranque, data e código `PR7-TR-AAAA-XXXXXXXX`. Exige: todos os módulos concluídos e validados + todos os plantões com ≥ 2/3.
- Permissão `treinamento` liberada para as funções da equipe (não para o técnico de SST); tabelas `TreinoResposta`, `TreinoSimulacao`, `TreinoValidacao`, `TreinoCertificado` (migração `20260918080000_treinamento`). Teste: `scripts/teste-treinamento.ts` (32 verificações).
- **PGR da central** ("acho que está fora de contexto"): função renomeada para "Central (Help Desk e Operador de monitoramento)"; NR1-04 sem referência a agentes de campo (prestadores); 5 riscos típicos de central sugeridos para o técnico validar (clientes/prestadores alterados, alertas e pop-ups repetidos, pressão por rankings, assédio/conflitos, fone/telefone — conferir Anexo II da NR-17). Marcados "sugestão — validar" na tela.

## 2026-09-18 (7) — Técnico de SST (NR-1/eSocial), informar trabalhadores, e-mails
- Regras do usuário: "NR1 tem o técnico responsável; ele faz toda a parte, dentro do eSocial também"; "cada cadastro envie e-mail"; "gere um link somente das informações necessárias e mantenha a segurança dos dados"; "NR1 por enquanto só para a equipe interna"; "não tem nenhum serviço externo".
- Função **Técnico de Segurança do Trabalho (NR-1)** + permissão `nr1`: acesso só à parte NR-1 da aba Segurança. CAT/eSocial (S-2210) no registro de acidente.
- **Informar trabalhadores**: comunicados com link pessoal por e-mail (hash no banco, validade, reenviar/revogar, ciência auditada, alerta quando o risco muda). NR1-05 passou a ser conferido pelo sistema.
- **Escopo**: 7 riscos de funções de prestadores marcados fora do escopo (guardados); NR1-06 = não se aplica; indicadores de campo retirados.
- **E-mails**: pedido fora da regra → administradores; decisão → quem pediu; aprovado → novo usuário (sem senha). Dependem do SMTP (pendente).
- Detalhes: `docs/seguranca.md`. Testes: `scripts/teste-sst.ts` (28), `scripts/teste-aprovacao.ts` (20), `testes-leitura.ts` — todos passando.

## 2026-09-18 (6) — Valores ao prestador, aprovação fora da regra, aviso de monitoramento
- **Tabela de preços** (`apps/api/src/pagamentos/precos.ts`): patrimonial R$ 70; preservação = horas exatas × taxa (a do prestador, R$ 25–30; sem histórico R$ 30 — a confirmar); veicular = base do cliente (R$ 200 padrão; Swint 150; Locca 180) + km acima de 50 × R$ 1,20 + horas acima de 3 × R$ 35 + gastos. Antenista (inclui "Análise de Tecnologia Rastreável") e acompanhamento/Roteirizador: **sem regra ainda → não calcula**.
- **Cálculo automático** (`valores-automaticos.ts`, a cada 10 min): só chamados **do WhatsApp**, concluídos, sem valor, sem ajuste manual, últimos 60 dias. Guarda a conta em `detalhes.valorCalculado` (regra, memória, o que conferir). Preservação com menos de 1 h não paga automático (horário provavelmente errado).
  - Erro corrigido na hora: a 1ª versão pegou também 338 linhas da **planilha** de agosto que vieram sem valor → revertidas ao estado original (valor vazio) e a regra passou a exigir conversa do WhatsApp.
- **Edição do valor** no chamado (quem tem "valores"): campo "Valor ao prestador" com a memória do cálculo; valor editado grava `detalhes.valorManual` (quem, quando, valor anterior) e nunca é recalculado — é o caminho para locais difíceis.
- **Pedido de aprovação** e **aviso de acesso monitorado**: ver `docs/seguranca.md` (Gestão de usuários por setor). Tabela nova `PedidoAprovacao` (migração `20260918040000_pedido_aprovacao`).

## 2026-09-18 (5) — Notebook fechado derrubou a noite; setor na gestão de usuários

- Notebook fechado de 01:30 a 08:30: o sistema inteiro ficou parado (mensagens da madrugada não chegaram; a Z-API multi-device não guarda histórico — recuperação só exportando as conversas do WhatsApp). Decisão: seguir para a hospedagem; chave SSH gerada em `~/.ssh/pr7_servidor` (a pública vai no painel da Hostinger; nenhuma senha passa pelo Claude).
- "Carlos" = Carlos Gabriel (confirmado): 533 atendimentos unificados.
- Gestão de usuários por setor (ver `docs/seguranca.md`).
- Aguardando: planilha de contatos para alinhar prestadores por estado; confirmação dos tipos de grupo; regra de valor dos chamados do WhatsApp (proposta: valor padrão por serviço — Ronda R$ 70, Preservação R$ 30, medianas de 2026 — editável no chamado).

## 2026-09-18 (4) — Aba Segurança (LGPD e NR-1) e revisão de duplicidades

**Aba 🛡 Segurança** (só administrador — ver `docs/seguranca.md`): proteção de dados, acessos, LGPD, NR-1 (GRO/PGR com riscos psicossociais e indicadores da operação) e incidentes. Tabelas `ItemCompliance`, `RiscoOcupacional`, `IncidenteSeguranca`, `ContagemTabela`, `ConfigSistema` (migração `20260918030000_seguranca_compliance`). Auditoria passou a ser imutável no banco; exportações auditadas; senha do banco trocada por senha forte. Testado: admin acessa tudo, operador (mesmo com "Gerenciar usuários") recebe 403; backup verificado íntegro (26 tabelas); item automático não aceita marcação manual.

**Revisão de duplicidades** (pedido da operação — "erros bobos de duplicidade"):
- Sem duplicidade: IDs PR7/internos, mensagens, pagamentos, atendimentos (mesma conta/placa no mesmo horário), telefones de prestador.
- **Help Desk**: a mesma pessoa em várias grafias — Ingridy (6 formas → 6.074 atend.), Eliane (5.262), João Victor (6 formas), Bruno, Hemily, Laysla, Marlon. Regra em `src/equipe/nomes-help-desk.ts` vale para planilha e WhatsApp; original em `detalhes.operadorOriginal`. "Carlos" não foi juntado (Carlos Gabriel ou Edi Carlos?).
- **Prestadores**: 176 cadastros duplicados juntados em 165 (`scripts/unificar-prestadores.ts`) — só com certeza: mesmo telefone escrito com/sem o 9 ou sem DDD, ou cópia "sem telefone" de nome completo com uma única pessoa com telefone. Nada perdido: atendimentos (22.723 com prestador, igual), negativas, pagamentos, SAC, agentes, áreas; restrição preservada. 400 celulares passaram ao formato com 9 (`telefoneCanonico`). Não juntados (lista em `logs/prestadores-para-revisar-2026-09-18.txt`): mesmo nome com telefones diferentes (podem ser pessoas diferentes) e mesmo telefone com nomes diferentes (pode ser o telefone da equipe — ex.: Alberto/Jailson em Recife).
- A importação da planilha não recria as duplicatas (telefone no formato único; linha sem telefone usa o cadastro de mesmo nome completo).
- Contas com mesmo estabelecimento e cidade e códigos diferentes (589) mantidas: uma loja pode ter mais de uma remota — aguarda confirmação.

Testes (`scripts/testes-leitura.ts`): 70, todos passando.

## 2026-09-18 (3) — Finalização: nada travando, nada perdido, registros corrigidos

**Mensagem nunca some do registro.** Trigger no banco impede apagar mensagem e trocar o texto original (`20260918010000_mensagem_nunca_apagada`). Apagada no WhatsApp vira marca "🗑 apagada no WhatsApp" (`apagadaNoWhatsappEm`); editada guarda a versão nova em `edicoes`, com o original intacto. Testado com mensagens simuladas.

**Nada travando.**
- Fila: job que falhava uma vez (queda de internet/banco) bloqueava a conversa para sempre — ORSEGUPS e SEGURPRO estavam parados. Agora: 5 tentativas com espera crescente, job falho é substituído e **varredura a cada 2 min** reagenda conversa com mensagem parada (mesma regra de custo do webhook). 6 jobs travados limpos.
- **Vigia do sistema** (`scripts/tunel-vigia.ps1`): a cada 30 s confere Docker (liga container parado), API (religa após 2 falhas) e túnel (só troca se a API estiver no ar — antes, API caída fazia trocar o túnel à toa). Testado: API derrubada voltou em ~50 s; Redis parado voltou em 16 s.
- `scripts/atualizar-api.ps1`: compila com a API no ar (repete se o OneDrive travar arquivo) e só reinicia se compilou — no ar de novo em ~6 s.
- **Backup automático** a cada 12 h pela própria API (`backups/*.sql.gz`, nenhum apagado). Backup feito após a reimportação.
- Token do webhook trocado sem perder mensagem: a API aceitou o antigo e o novo até a Z-API entregar com o novo; depois o antigo foi removido.

**Registros corrigidos (conferidos mensagem a mensagem — `scripts/corrigir-chamados-18-09.ts`):**
- Horário: hora citada pegava o dia em que a IA rodou (fila atrasada) → 36897 com chegada 24 h depois. Nova regra `encaixarHoras`: o pedido é ancorado na mensagem enviada naquele horário ou que cita a hora; os demais marcos contam a partir do pedido (virada de meia-noite certa, hora fora de ordem não empurra as outras).
- Mensagem sem ID em grupo caía no único chamado aberto — o "liberado" do Boticário encerrou a Clamed (PR7-H-000033). Agora só vale se for o único aberto, do mesmo estabelecimento e de até 12 h; "liberado/cancelado" só encerra chamado identificado.
- Fotos: ao nascer um chamado ele pegava todas as fotos soltas do grupo; foto nova ia para o aberto mais recente. Agora só liga com um chamado possível, legenda com nº da ocorrência, ou janela limitada (até 4 h após a chegada / 12 h após o pedido). 77 fotos reavaliadas; ficaram soltas as ambíguas — a ficha ganhou **"Fotos soltas do grupo neste horário"**, **"não é deste"** e **"− relatório"** (com auditoria; não deixa ligar foto de outro grupo).
- Help Desk: nome do grupo, "<UNKNOWN>" e a operadora do cliente ("Operador solicitante: MARIA") não entram mais; assinatura "*Eliane Lopes:*" vale.
- Formulário no formato "*Rótulo* valor" (Eliane) passou a ser lido; "Conta: Não possui" com estabelecimento é resposta válida; "Não foi informado" não vira validação.
- **5 chamados que nunca tinham sido registrados** (formulários com ID recusados pelo erro do OR): 36891, 36892, 36893, 36894, 36912 — recuperados (`scripts/recuperar-formularios.ts`). Formulários com ID sem chamado: **zero** (restam 4 IDs em grupos sem tipo definido).
- Chamado falso "positivo central / OK" (PR7-H-000099) removido; chamado novo em grupo exige ID, ocorrência, estabelecimento, placa ou a print do cliente.
- ID interno sai de sequência do banco (`pr7_id_interno_seq`) — nunca reaproveita número.

**Motivo do cancelamento**: além dos minutos, grava o motivo com as palavras do cliente (novo campo da IA, nunca inventado) ou o contexto — "cancelou no mesmo minuto em que a PR7 informou o prazo (15 min) — provável recusa do prazo" / "cancelou antes de a PR7 informar prazo".

**Relatório em PDF do atendimento** (📄 na ficha, permissão `relatorios`): cliente, local, Remota/Conta, validação, SAP, serviço, Help Desk, agente, horários, relato e fotos marcadas para o relatório — sem valores, Pix ou observação interna.

**Roteirizador** (grupo "PR7 Acompanhamento Velado"): cada dia vira um atendimento Veicular "Roteirizador" com a linha do tempo das paradas (a caminho, no cliente, descarregando, saiu) e as fotos; sem IA. Histórico de 15/09 registrado (PR7-H-000101).

**Relatório de fim de plantão** (🏁 Finalizar plantão / ao clicar em Sair): Patrimonial e Veicular — total, meus, negativas, cancelados, em aberto, por cliente — e Eventos por central (Power, ACT, Seven, Sincro). Copiar texto para o grupo ou imprimir.

**Lista de atendimentos**: coluna **ID** em destaque; data e ordem pela data do PEDIDO (não da criação do registro).

**Help Desk com e-mail de login** (a própria planilha de jan–abr/2024 e jul/2025 trazia o login no campo "Operador"): convertido para o nome — o ranking não divide mais a mesma pessoa. **Nenhum e-mail fica no código**: `src/equipe/nomes-help-desk.ts` reconhece a pessoa pelas palavras antes do "@" comparadas com os nomes que já existem; com duas pessoas de mesmo primeiro nome (duas "Ingridy"), não adivinha. O valor original da planilha fica em `detalhes.operadorOriginal` (não aparece no painel). Nada disso saiu do computador: a importação é local, sem IA.

**Hospedagem**: `docs/hospedagem.md` — imagem Docker e produção prontas e testadas; custo VPS R$ 43,99/mês (renova R$ 77,99) ou Railway ≈ R$ 135/mês. Aguardando aprovação.

Testes (`scripts/testes-leitura.ts`): 66, todos passando.

## 2026-09-18 (2) — Equipe: Monitoramento e feedback; boas-vindas; pop-up de pendências

**Equipe ganhou a aba Monitoramento** (`GET /equipe/monitoramento`): por quem assumiu o evento — eventos, tempo para assumir (meta 5 min), tempo de tratativa, anotações por evento, eventos sem responsável. Hoje os 5 eventos da fila ainda não foram assumidos por ninguém, então a aba mostra a fila e fica sem ranking até alguém assumir.

**Feedback para cada Help Desk** (cards da Equipe e perfil): "pode melhorar" com os 2 pontos em que a pessoa está mais atrás da equipe, sempre com o número e a meta, e um "ponto forte". Compara tempo até o prestador chegar, % de chegadas acima de 1 h, acionamento (quando medido), volume por dia trabalhado (contra a mediana individual, não o total da equipe), chamados em aberto, não atendidos, demoras e negativas; no perfil entra também o horário em que a resposta fica mais lenta. Regras fixas em `feedbackAtendimento()`/`feedbackMonitoramento()` — sem IA, custo zero. Um corte fixo ("15% pior") deixava todo mundo "na média" porque a equipe é parecida; por isso a comparação é relativa.

**Boas-vindas a cada login**: saudação pelo horário (bom dia/boa tarde/boa noite + nome) e uma de 28 mensagens motivacionais, sem repetir a do login anterior. Ao reabrir o painel já logado, aparece uma vez por sessão do navegador.

**Pop-up de pendências volta até tratar** (só no painel do Help Desk — nada é enviado ao cliente): além do "motivo do não atendimento", cobra **cliente aguardando** (`GET /atendimentos/pendencias-cliente`: chamado novo do WhatsApp/painel há mais de 10 min sem prestador acionado, últimas 24 h). "Lembrar em 2 min" adia; Esc também adia. Cada vez traz uma piadinha e toca uma musiquinha curta gerada no navegador (sem arquivo de áudio), que respeita o botão de som do radar.

**Período na Visão geral e na Equipe**: novas opções **Últimos 30 dias**, **Este mês** e **Por período…** (data inicial e final, a final inclui o dia inteiro; já abre com os últimos 30 dias). Conferido: 30 dias = 448 atendimentos e 01–31/08 = 351, iguais à contagem direta no banco.

**Painel sem cache**: `/painel` responde com `Cache-Control: no-cache` — o navegador passa a buscar a versão nova depois de cada atualização (antes ficava mostrando textos antigos, como "Operadores ativos").

## 2026-09-18 — Funções dos usuários, mapa operacional e painel do mês

**Funções**: Help Desk, Auxiliar Adm., Operador de monitoramento, Analista e Supervisão (`AdminUser.funcao`, migração `20260918000000_funcao_do_usuario`). Escolher a função na tela de usuário marca as telas padrão dela; o administrador ajusta caixa a caixa. A lista de usuários mostra a função no lugar do papel.

**Help Desk sem visão geral**: vê o **Mapa operacional** (nova tela — o mesmo mapa com estabelecimentos, prestadores, áreas de risco, roubo/furto e polícia, sem os números do BI; o servidor libera `/mapa/*` para a permissão `mapa`) e o **painel do mês** no topo de Atendimentos e Monitoramento: total de ocorrências/eventos do mês e os dele, com barras por dia. Testado com usuário Help Desk temporário: visão geral e pagamentos recusados (403), mapa liberado, painel de setembro com 165 no total e 49 da Eliane — igual à contagem direta no banco.

## 2026-09-17 (noite) — Leitura por bloco da planilha, roubo/furto fora do Monitoramento

**Roubo e furto são ocorrência de atendimento Veicular, não evento de tratativa** (regra da operação). Saíram da lista `EVENTOS_VEICULARES`: o Monitoramento trata só telemetria da central — painel violado, desconexão de bateria, remoção de bateria, veículo bloqueado, cerca, perda de sinal. Os dois eventos já gravados (EV-2026-000002 "Furto" e EV-2026-000006 "Roubo / furto de veículo") foram tirados da fila por `scripts/tirar-roubo-furto-do-monitoramento.ts`, que antes copia as tratativas do operador para `detalhes.historicoMonitoramento` do chamado — o atendimento continua completo. A fila ficou só com os 5 "Painel violado" da Cordenonsi. Mensagem no formato da central que não seja evento oficial **não sai mais da fila da IA**: segue para classificação como atendimento (antes era descartada).

**Cada tabela da planilha é lida pelo seu próprio cabeçalho.** Descoberta a causa raiz dos campos trocados ("prestador no lugar de placa"): as abas têm **várias tabelas empilhadas**, uma por mês, cada uma com sua ordem de colunas — "Patrimonial Janeiro" tem 11, "Patrimonial PG PRS 2025" tem 21, "Veicular" 2025 tem 21. Tudo era lido com o cabeçalho da linha 1, o que embaralhava **~23.000 linhas**. Agora `blocosDeCabecalho()` acha cada cabeçalho e cada bloco é lido com o dele; os padrões de coluna aceitam as variações de escrita ("Estado"/"UF", "Data da/de Solicitação", "Operador PR7"/"Op. PR7", "Tipo de Serviço"/"Serviço", "Hora Término"/"Hr Final"). Ferramenta de conferência: `scripts/conferir-blocos-da-planilha.ts`.

Resultado da reimportação (sem duplicidade, os do WhatsApp intactos): 26.218 → **26.490 atendimentos**; sem data 120 → **5**; data 1899 26 → **0**; com prestador 15.481 → **22.734**; veicular com placa 516 → **740**; linhas com layout não confiável 149 → 42. Auditoria: duração > 24 h 83 → 54, tempo invertido 31 → 25.

**Prestador tem que ser gente.** A coluna Equipe às vezes traz marcação da planilha ("X", "Sim", "Não", "R$ 500") — o importador passou a recusar isso (nome sem letras ou telefone sem DDD não vira cadastro) e `scripts/limpar-prestadores-invalidos.ts` removeu os 6 que já existiam, mantendo os atendimentos (só ficam sem prestador).

**ID do PR7 tem 4 a 6 dígitos** (`idPR7Valido()` em `src/atendimentos/identificador.ts`). Número fora disso é ocorrência do cliente — o chamado com `idPR7 = 33760663` (ORSEGUPS) virou ocorrência + `PR7-H-000095`. Vale para a IA e para o formulário de retorno. Hoje: 26.418 com ID PR7, 72 com ID interno, **zero sem identificação**.

**Correções de vínculo e de fila:**
- Retorno sem ID buscava pela conta com **dois `OR` no mesmo objeto** — o segundo apagava o primeiro e a busca trazia todos os chamados abertos da empresa (daí o aviso "confere com 121 chamados"). Agora as duas condições ficam dentro de `AND`.
- Grupo de comprovantes não era agendado para classificação porque o filtro exigia `ID:`/`Conta:` com dois-pontos, e o comprovante chega como "Nome/ Cidade/ IDs 36575". Corrigido em `whatsapp.service.ts`; `scripts/reprocessar-comprovantes-grupo.ts` recuperou o atraso.
- `scripts/processar-pendentes.ts` força a classificação quando a fila fica para trás (reinício da API, Redis fora, rajada).

**Novo evento veicular (registro manual)** ganhou **data e hora em que o evento ocorreu** (vem preenchida com "agora", editável, sem futuro) e **relato** em caixa de texto — os dois obrigatórios. A lista de eventos do formulário ficou igual à do servidor (sem roubo/furto e sem "Outro evento veicular"), e a API recusa tipo fora da lista. Testado contra a API: sem horário, sem relato, roubo e horário no futuro são recusados; o completo grava `ocorridoEm` exato.

Testes (`scripts/testes-leitura.ts`): 26, todos passando — incluídos os três novos de roubo/furto/recuperação fora do Monitoramento.

## 2026-09-17 — IDs, busca, mapa de risco e polícia, pagamentos por regime

**Identificador de todo acionamento.** O **ID PR7** (coluna "Id") segue sendo o oficial — é ele que amarra retorno do prestador, comprovante e evento; 26.178 chamados têm o seu, sem repetição. Quem chegou sem ID (anterior ao sistema ou aberto aqui) recebeu **ID interno** `PR7-H-000001`, e os eventos de tratativa ganharam `EV-2026-000001`. Daqui para frente é automático em toda porta de entrada (WhatsApp, painel, retorno do prestador, Monitoramento). 34 linhas quebradas da aba desalinhada de 2024 (cliente = "06:00:00", data 1899) foram removidas em vez de numeradas.

**Busca no banco, por campo** (aba Atendimentos): ID do acionamento · cliente · estabelecimento · técnico/prestador · **Help Desk** · cidade/UF · placa — ou tudo de uma vez. Antes filtrava só o que estava na tela; agora varre o histórico inteiro.

**"Help Desk" substitui "operador"/"atendente"** em toda a interface e nos relatórios (o campo no banco continua `operadorPR7`).

**Mapa de alerta do Veicular:** camadas de **áreas de risco** (vermelho por nível — crítico ≥ 2.000 ocorrências/ano, alto ≥ 500, médio ≥ 100 —, com gráfico de 12 meses ao clicar), **roubo/furto de veículo** ponto a ponto e **unidades policiais**. Botão de expandir o mapa em tela cheia. Fontes públicas: ISP-RJ (82 municípios), SSP-RS (311) e OpenStreetMap para as **5.769 unidades policiais** dos 27 estados (1.782 PM, 1.521 PC, 513 PRF, 183 PF, 95 guardas). A base nacional do SINESP exige chave de API — pendente.

**Pagamentos:** regime passou a ser do **prestador** (48H, semanal, quinzenal, mensal, TX), lido da coluna "Pagamento" — 1.164 de 1.225 prestadores classificados. O comprovante herda o regime do atendimento que pagou (antes todo comprovante virava 48H por causa do nome do grupo). Prazo de 5 dias úteis vale para todos os regimes; a tela mostra "venceu o prazo em" em vermelho e "foi pago em" nos comprovantes. Em aberto: só setembro/2026.

**Qualidade dos dados** (auditoria em `scripts/analisar-qualidade.ts`): placa inválida 19 → 0, agente com número 51 → 0, tempo invertido 73 → 31, duração absurda 113 → 83. A aba "Veicular Janeiro" de 2024 tem um segundo bloco de tabela com layout diferente — o importador detecta que o cabeçalho não bate (9 de 40 linhas com placa) e passa a ler pelo conteúdo, deixando vazio o que depende de posição em vez de gravar dado do vizinho.

## 2026-09-16 — Pagamentos, SAC, edição na lista e monitoramento veicular

**Pagamentos (aba nova, permissão `pagamentos`).** O usuário extraiu o grupo "Patrimonial/Comprovantes/Pagamentos em 48 HRS" (417 MB) e mandou por aqui. Importados **8.704 comprovantes** (13/04/2023 → hoje), **6.871 fotos** guardadas em `storage/comprovantes`, **6.436 vínculos** com atendimento. A chave **Pix não é gravada** (`Pix: [removido]`) — só nome, região, valor, data, IDs e a imagem.

Para isso funcionar foi preciso **reimportar a planilha De Mattos**: dos 15.653 atendimentos, só 4 tinham `idPR7`, então nenhum comprovante casava. Depois da reimportação (que recria só as linhas da planilha), 5.939 dos 7.748 IDs citados encontraram o atendimento. Os 2.063 restantes são de 2023/2024 — anos que o banco ainda não tem (planilhas já enviadas pelo usuário, importação pendente).

**Regras de fechamento** confirmadas pela operação: regimes 48H, semanal (fecha domingo), quinzenal (**fecha dia 16** e último dia do mês, 23h59) e mensal; depois do fechamento, **5 dias úteis** para pagar. A quinzena de 16/09/2026 aparece com "pagar até 23/09".

**Histórico confirmado:** o usuário informou que tudo até 31/08/2026 já foi pago; os 9.585 atendimentos concluídos sem comprovante individual foram marcados como pagos com a data do fechamento do período e um registro `CONFIRMACAO` (sem valor, sem comprovante inventado). Sobraram **146 atendimentos em aberto** — o período 01–16/09, que é o que a operação ainda vai pagar.

**Correção dos gráficos (rastreada com o usuário).** Setembro aparecia com R$ 93: eram duas linhas **sem data de solicitação** na planilha (Caedu R$ 50 de jan/2025 e Terreno Teresina R$ 43 de set/2025) que o importador carimbava com a data de hoje, caindo no mês corrente. Além disso, nas linhas recentes a operação preenche só a coluna **"Valor total"**, e o importador só lia "Valor". Dois ajustes aprovados pelo usuário:
- importador: `valorPrestador` usa "Valor" e, quando vazio, **"Valor total"**;
- BI: o gráfico mensal agrupa por `solicitadoEm`/`concluidoEm` (não mais `createdAt`) e **ignora linha sem data**.
Resultado: agosto/2026 passou de R$ 9.140 para **R$ 30.998** e setembro de R$ 93 para **R$ 8.460**; "a pagar" ficou em **146 atendimentos · R$ 8.315**, todos da 1ª quinzena de setembro (prazo 23/09).

**Restrições:** Hebert Bertolazze (Joinville/SC, 47 9236-6012) e Lucas Gomes entraram na lista de bloqueio (não tinham cadastro). Corrigida a acentuação quebrada da região do Carlito.

**Incidente do dia:** o Docker Desktop quebrou com socket travado (`sailor-ingest.sock`), derrubando Postgres e API por ~7 h; o túnel caiu junto e a Z-API ficou sem destino — mensagens desse intervalo **não foram gravadas** (a Z-API não reentrega). Correção: renomear `%LOCALAPPDATA%\Docker
un` (nunca "Reset to factory defaults", que apagaria o banco) e subir túnel + webhook de novo.

## 2026-09-15 — Monitoramento, grupos, formulário de retorno, empresas, mídias

**WhatsApp real funcionando** (01:03). Túnel rápido caiu 2× e o PC dormiu 02:39–06:30 → plantão da noite não capturado. Criado `scripts/tunel-vigia.ps1` (testa a cada 60 s, sobe túnel novo e reconfigura a Z-API sozinho pela API dela — chaves `ZAPI_*` no `.env`, só status/webhook, nada de envio). Histórico anterior **não é recuperável**: `chat-messages` da Z-API não funciona em multi-device (testado na ocorrência X-Global "Antena 433" de 14/09).

**Monitoramento** (aba nova, permissão `monitoramento`): `Evento` + `EventoTratativa`. Fila Novos/Em tratativa/Aguardando/Prestador acionado com cronômetro de SLA (5/10 min), prioridade por palavras (violação/invasão = crítica), ficha com quem atende na região + acionar, anotações, contato com cliente, encerramento com desfecho (reflete no atendimento).

**Grupos** (`Conversation.tipoGrupo`): CLIENTE abre evento; PRESTADOR nunca abre (retorno liga ao chamado); INTERNO só lê formulários (correções encaminhadas ao Suporte). Sugestão pelo nome ("&" = cliente). Monitoramento → Grupos.

**Formulário de retorno** (`src/whatsapp/formulario-retorno.ts`, sem IA), no grupo do cliente, do prestador e interno: ID, Conta, Ocorrência, Estabelecimento, Op. PR7, Agente, horários, Validação, SAP, Contato no local, Relato. Obrigatórios: ID, Conta, Estabelecimento, Agente, Hr. chegada, Relato → faltando = NÃO ATENDIDO + pop-up de motivo obrigatório. "Contato no local" é só pendência (retorno real bem-sucedido veio sem ele). **Repasse** ("ID: 36878" enviado aos prestadores) não é retorno — erro real corrigido (36878 tinha sido marcado não atendido e foi revertido).

**Vínculo sem erro** (pedido: "analisar cliente, horário, validação e SAP"): ID PR7 é único; sem ID, conta só liga se empresa, horário (±3 h) e validação/SAP conferem e sobrar 1 candidato. Conta cadastrada só é usada se o estabelecimento bater (nº de conta se repete entre empresas). Campos novos: `idPR7`, `codigoValidacao`, `sap` (também importados da planilha).

**Resumo operacional** (IA recebe o horário de cada mensagem): "Cliente solicita… às 13:22. Laysla pede autorização (apoio em 20 min) às 13:32. Cliente libera às 13:32. Técnico… chega às 13:57, realiza vistoria e laudo fotográfico. Relata: … Laysla analisa… e retorna ao cliente. Envia laudo fotográfico com localização às 14:19. Estando tudo ok, cliente libera o técnico às 14:20. Atendimento encerrado." "Liberado" do cliente após o retorno = CONCLUÍDO mesmo com revisão manual. Campos: `autorizacaoPedidaEm`, `liberadoEm`, `responsavelLocalNome/Telefone`. Belfort 36877 reprocessado e conferido (US$ 0,005).

**Empresas clientes** (`Empresa`, 40 da Clientes.xlsx; `scripts/importar-clientes.ts`): grupos ligados por nome (Orsegups, Belfort, Ceabs). **Mídias** (`Midia`, `storage/midias`, fora do git): arquivos baixados na chegada (link da Z-API expira), ligados ao chamado, servidos só com login. Galeria no detalhe do chamado e no Monitoramento.

**Revisão do dia (aprovada pelo usuário)**, feita à mão, sem IA (`scripts/revisao-15-09.ts`), com backup antes:
- ORSEGUPS ID 36878 (Sind. dos Trabalhadores) → **Concluído** (cliente liberou às 14:12), resumo operacional refeito, responsável Fabiana.
- ORSEGUPS ocorrência 33713267 → **Não atendido / sem prestador na região** (agentes empenhados às 12:52).
- ORSEGUPS 33721223 → **Cancelado pelo cliente 10 min após a solicitação** (resumo estava misturado com outro chamado).
- SEGURPRO Posto PortoSeco → **Cancelado 33 min depois** (imprevisto com veículo da central).
- SEGURPRO ID 36879 (Drogaria Nissei) → resumo reescrito (estava misturado com o PortoSeco), agente João Victor, responsável Denise.
- CEABS FPG8A47 → **Concluído** (resultado positivo confirmado às 16:27).
- CIEP PUY2G95 → não era chamado: virou **alerta veicular divulgado**; chamado apagado.
- Grupo "Centrais" marcado como **interno** e o chamado 28A8F apagado.
Pedido do usuário atendido: todo cancelamento agora registra **em quanto tempo o cliente cancelou** (IA, painel e encerramento manual).

**Divulgação de furto/roubo** deixou de virar chamado: vira `AlertaVeicular` (busca por placa/chassi em `GET /atendimentos/alertas-veiculares`; o chamado da mesma placa mostra o alerta).

**Chamado encerrado é intocável**: a IA não reabre nem reescreve `CONCLUIDO`/`CANCELADO`/`NAO_ATENDIDO`, e retorno incompleto não derruba chamado fechado pela central. A correção completa reenviada (ex.: no Suporte) reabre só o que tinha caído por retorno incompleto.

**Chamado abre na própria lista** (pedido do usuário, por vídeo): clicar na linha empurra as de baixo e abre a ficha ali mesmo, em duas colunas, **com edição** — status, motivo, serviço, ID/validação/SAP, operador, técnico, responsável no local, horários, resumo, relato e observação interna. `PATCH /atendimentos/:id` grava só o que mudou, exige motivo ao fechar, calcula o tempo de cancelamento, reabre limpando o encerramento e registra tudo na tratativa do evento + auditoria. O painel lateral continua para quem chega pelo aviso de acionamento.

**Monitoramento é só veicular** (regra da operação: "não entra patrimonial"). O segmento da tela virou filtro por **evento**: Painel violado, Desconexão de bateria, Remoção de bateria, Veículo bloqueado, Cerca, Perda de sinal, Roubo/furto. Eventos da central (TRANSPORTES CORDENONSI, formato "Descrição do Evento / … / Placa / Localização") são lidos **sem IA** (`evento-telemetria.ts`), com data convertida de Brasília e cidade/UF do endereço. Os 4 eventos do dia entraram na fila (um já ligado ao atendimento concluído); 9 eventos patrimoniais saíram da fila.

**SAC do prestador** (aba e permissão `sac`): reclamação de prestador não é chamado de cliente. Ticket com tipo (pagamento/atendimento em atraso, reclamação, dúvida), prioridade (atraso entra como ALTA), IDs citados, tratativas e resolução. Grupo de comprovantes/pagamentos passou a ser **interno**: o comprovante postado pela supervisão ("[Foto] Alberto Fonseca/ Recife/ IDs 36259/36467") **resolve sozinho** o SAC daquele prestador. Caso do dia registrado: Alberto Fonseca (Recife) cobrou atendimento em atraso → SAC prioritário, resolvido pelo comprovante das 16:36.

**Testes automáticos** rodados antes de cada entrega: leitura de formulário (repasse × retorno, SAP/validação), horários de Brasília (incl. virada de dia), categoria oficial, conta de outra empresa não liga, fluxo completo de retorno completo/incompleto, API do Monitoramento de ponta a ponta, leitura da divulgação de furto, responsável extraído do relato, tempo de cancelamento, evento da central (tipo, placa, cidade/UF, data em UTC) e sintaxe do painel.

## 2026-09-14 (noite) — Não atendidos, desempenho da equipe, lista de bloqueio

**Não atendimento com motivo** (pedido: "atendimentos que não foram atendidos anotados com o motivo — cancelado, negativa, demora"): novo status `NAO_ATENDIDO`, enum de 7 motivos, prestador que recusou (`recusadoPorId`), quem encerrou. Detalhe do chamado ganhou "✓ Concluído / ✕ Não foi atendido" com escolha de motivo, e a IA reconhece não atendimento nas conversas (+ poucas palavras no esquema, custo desprezível). Linha do tempo (pedido → acionado → no local → concluído) com botões "marcar agora".

**Descoberta na planilha:** "Data Deslocamento" é a **duração** do deslocamento, não um horário (Data Local − Data Solicitada, conferido linha a linha). A primeira versão da análise tratou como horário e deu mediana irreal de 8 h — corrigido antes de ir para a tela. O histórico não registra o momento do acionamento; a medida justa por operador é o **tempo de resposta** (pedido → chegada): mediana 28–29 min, 90% em até 1h32. Planilha tem só 5 não atendidos (é de pagamento).

**Tela Equipe** (permissão nova `equipe`): cartão por operador com chamados, tempo de resposta vs. equipe, não atendidos, alertas automáticos (ex.: um operador 17% acima da equipe e 25% das chegadas após 1 h); perfil com posição no ranking, evolução mensal, turnos por hora, motivos, serviços, cidades e prestadores mais acionados. Custo zero (só banco).

**Restritos por e-mail:** usuário não quer usar o e-mail pessoal; definido **pr7.central@gmail.com** como caixa oficial. A sessão do Claude ainda aponta para o Gmail pessoal (troca de conector só vale após reiniciar o app) — nenhum conteúdo pessoal foi aberto, só remetente/data para confirmar a conta. Primeiro restrito recebido por print: **Carlito Pedro da Silva**. Confirmado pelo usuário que é o agente "Carlito" da equipe de Sidnei de Paula → nome completo e telefone preenchidos, agente restrito e inativo. Criada a **lista de bloqueio** (`Restrito`): barra por telefone ou nome completo mesmo sem cadastro, em sugestão, ocorrência e importação. Guardado só nome, telefone, região e motivo — CPF, RG, e-mail pessoal e dados bancários do e-mail **não** foram registrados. Testado: ocorrência com o agente é recusada.

**Pendências abertas:**
1. **Z-API não chamou o webhook nenhuma vez** (vigia de 1 h + 30 min sem nada; nenhuma tentativa recusada). Conferir se "Ao receber" ficou gravado e testar mensagem num grupo.
2. Reiniciar o app do Claude para o Gmail passar a ser pr7.central e ler os próximos restritos direto.
3. Reclamações → fila do SAC (pedido do usuário, não iniciado).
4. Vincular operadores da planilha (nomes de uma palavra) aos usuários com nome completo.

## 2026-09-14 (tarde) — Radar de acionamentos e preparação do WhatsApp real

**Pedido:** "Quando chegar um acionamento, já indica na tela quem atende naquela região."

- **IA extrai o local:** a ferramenta de extração ganhou `vertical`, `cidade`, `uf` e `placa` (+~40 tokens de instrução e ~15 de resposta, ≈ R$ 0,001 a mais por classificação). Se o nº da ocorrência bate com o código de uma `Conta`, usa a cidade/UF cadastrada (mais confiável que a citada). Categorias agora incluem Ronda e Preservação.
- **API:** `GET /atendimentos/acionamentos?desde=` devolve chamados em aberto chegados depois da data, com `quemAtende` (até 4 prestadores da cidade — ou do estado se ninguém atendeu na cidade — ativos e mais experientes primeiro, restritos nunca). A lista e o detalhe também trazem a sugestão para chamados em aberto sem prestador.
- **Painel:** radar consulta a cada 10 s; novo acionamento aparece como cartão pulsando no canto (bipe gerado no navegador, pode silenciar), com os 3 prestadores da região e o WhatsApp de cada um. Tabela mostra "💡 sugerido" na coluna Prestador; o detalhe tem o bloco "Quem atende nessa região".
- **Teste ponta a ponta com IA real:** mensagem simulada de grupo citando Campinas/SP → classificada como Ronda em Campinas/SP → 4 prestadores sugeridos (1º: equipe ativa com 410 atendimentos na cidade). Custo: US$ 0,0019. Dados de teste removidos.

**Conexão em andamento:** conta Z-API criada pelo usuário (teste grátis de 2 dias entrou automaticamente; depois R$ 99,99/mês por instância). Aguardando backup do celular para escanear o QR. Orientado a deixar desligado "ler mensagens automaticamente"/rejeitar chamadas/respostas automáticas e ligado "notificar enviadas por mim". Confirmado ao usuário que o sistema não tem nenhuma função de envio.

**Preparação para o tráfego real:** webhook passou a registrar foto/vídeo/documento (legenda), áudio (marca, sem transcrição), localização e contato; ignora figurinha, reação, status, canais, listas e eventos de grupo. **Só grupos vão para a IA** (`CLASSIFICAR_CONVERSAS_INDIVIDUAIS=false`): ao conectar, todas as conversas do número chegam, e as individuais não são da operação — economia e privacidade. Log de chegada só com metadados (nunca conteúdo) e alerta quando a Z-API recebe erro de formato. Testado pelo túnel com payloads no formato Z-API.

**WhatsApp:** o usuário decidiu usar o número verificado mesmo com o risco ("Vamos arriscar utilizar este whatsapp mesmo"). Túnel Cloudflare gratuito ligado; por segurança, o túnel só expõe `/webhooks/whatsapp` (painel/login/dados respondem 404 de fora — testado pela internet). O endereço do túnel rápido muda quando o computador reinicia.

## 2026-09-14 (madrugada/manhã) — Segurança, operadores, Atendimentos Patrimonial × Veicular, organograma, restritos

Trabalho autônomo com o usuário ausente ("pode aprovar tudo", meta: 70% pronto para os testes de atendimento).

**Segurança** (detalhes em `docs/seguranca.md`): banco e Redis estavam expostos na rede local — fechados em `127.0.0.1` (backup feito antes). API em `127.0.0.1`, CSP com lista branca de origens externas, cabeçalhos de segurança, limite por IP, bloqueio de login por tentativas, auditoria em `EventoSeguranca`. **Bugs reais corrigidos:** o `JWT_SECRET` era lido antes do `.env` carregar (tokens podiam estar assinados com o segredo de exemplo) e o webhook aceitava chamadas sem token se `WEBHOOK_TOKEN` faltasse. `bcrypt` → `bcryptjs` eliminou a vulnerabilidade crítica; restam 13 que dependem do NestJS v12.

**Usuários e permissões:** ADMIN/OPERADOR, 9 permissões (visão geral, atendimentos, registrar, prestadores, editar prestadores, valores, relatórios, custo IA, usuários) e verticais liberadas. Validado com operador de teste: 403 em tudo que não foi liberado, só atendimentos da vertical liberada, sem valores, desativação vale na hora.

**Dados:** importador reescrito — lê também a aba Veicular (dados deslocados uma coluna a partir de "Placa", detectado automaticamente; 384 atendimentos com placa/coordenadas), importa valores (R$ 1,02 mi pagos a prestadores, R$ 143 mil de preservação cobrada) e não apaga mais edições manuais, restritos, nem ocorrências do formulário/WhatsApp. Geocodificação ganhou busca em texto livre (143 cidades refeitas).

**Organograma:** prestador = adm (nome completo + apelido + contato), agentes abaixo com nome completo obrigatório, apelido e contato; edição pelo painel com validação (nome + sobrenome, DDD). Ficha mostra evolução mensal de atendimentos e valores (valor = pago ao adm; repasse à equipe é da própria equipe).

**Restritos:** status `RESTRITO` para prestador e flag para agente, com motivo/quem/quando; somem da sugestão, API recusa acionar; aplicação em lote colando lista (casa por telefone, ou nome completo exato; devolve não encontrados e ambíguos). Aguardando a lista do usuário.

**Atendimentos:** tela no visual da Visão geral, com seletor Todos/Patrimonial/Veicular, KPIs, busca instantânea, painel lateral com todos os detalhes (observação interna destacada). **Nova ocorrência** em assistente curto (atalho `N`): escolha da vertical → local (busca de conta com endereço travado, ou conta nova) / veículo (placa puxa histórico) → serviço + motivo → prestador sugerido por experiência na cidade → vistoria/detalhes opcionais recolhidos (checklist Sim/Não, KM e horas calculados) → confirmar. Cronômetro, contador do dia, combo e tela de vitória com o tempo de registro. Testado ponta a ponta na API (Patrimonial e Veicular) e na interface.

**Documentação:** `docs/banco-de-dados.md` (todas as tabelas, campos, JSON de detalhes, importação, backup, migrações) e `docs/seguranca.md`.

## 2026-09-14 — Central de Operações (BI), mapa de estabelecimentos e prestadores

**Painel servido pela API** em `http://localhost:3000/painel/` (aberto como arquivo, o OpenStreetMap bloqueava o mapa com 403). Cartões de totais agora vêm de `GET /atendimentos/resumo` e a tabela limita a 300 linhas — antes o navegador travava baixando 15 mil atendimentos.

**Visão geral (BI)** — `GET /bi/visao-geral` devolve todas as agregações numa chamada (KPIs, série mensal, status, serviços, estados, cidades, clientes, operadores, prestadores, ritmo semanal). Filtros cruzados estilo Power BI: clicar num estado, mês, status, serviço, cliente, prestador ou operador filtra o painel inteiro; cada gráfico ignora o próprio filtro para destacar o item escolhido. Atualiza sozinho a cada 60 s (só banco, sem custo de IA). Gráficos desenhados à mão em SVG/CSS — nenhuma biblioteca de gráficos.

**Mapa operacional** — Leaflet carregado só quando a Visão geral abre; tiles do OpenStreetMap com filtro escuro. `GET /mapa/pontos` entrega estabelecimentos e prestadores em formato compacto (~550 KB). Zoom de país: bolhas por cidade; zoom ≥ 7: ícone individual só do que está na tela (acima de 900 pontos vira ponto simples). Clique num prestador mostra a ficha e linhas de cobertura até as cidades onde já atendeu.

**Prestadores importados da planilha** (`scripts/importar-planilha.ts`, sem IA): a coluna "Equipe" é o contato acionado (nome + telefone do responsável/adm da região) e "Nome do Agente" é quem foi ao local. Resultado: 1.150 prestadores (270 equipes), 2.493 agentes, 2.164 cidades de atuação, 15.179 atendimentos vinculados. Regras aplicadas: telefone com DDD e nome com sobrenome viram `pendencias` (430 cadastros incompletos). Status ATIVO = atendeu nos últimos 90 dias. Novos modelos: `ProviderMembro`, `ProviderArea`, `Cidade`; `Provider` ganhou tipo/base/pendências; `Atendimento.agenteNome`.

**Localização das cidades** — `GeocodificacaoService` consulta o Nominatim (gratuito, 1 req/s, só nome da cidade + UF saem do sistema) em segundo plano ao subir a API e grava em `Cidade`. ~770 cidades ≈ 15 min, uma única vez. Cidade não localizada cai no centro do estado, marcada como aproximada. Desligável com `GEOCODING_ENABLED=false`.

**Tela Prestadores** — busca por nome/telefone/cidade/agente, filtros de tipo, status, UF e cadastro incompleto; telefone abre o WhatsApp (ação manual do operador, o sistema não envia nada); botão 📍 leva ao prestador no mapa.

**Pedidos registrados para a sequência:** novo formulário de ocorrência enxuto e "viciante", separando Patrimonial × Veicular (campos em `docs/formulario-ocorrencia.md`).

## 2026-09-13 — Limpeza e consolidação da documentação

Passada uma revisão geral no `docs/plano.md` para manter tudo consistente e sem redundância:
- Removida a seção "O que falta para a Fase 1 entrar em produção" (desatualizada, duplicava o checklist do topo).
- Checklist do topo atualizado: item da `ANTHROPIC_API_KEY` marcado como concluído, item de BSP atualizado com o número já definido `(11) 97476-1437`, adicionado item de deploy de produção (ainda não iniciado — ambiente é só local/dev hoje).
- `Entidades do banco` corrigida para refletir o model `Conta` já implementado.
- Sinalizada uma ambiguidade de nomenclatura a resolver: "Manutenção Patrimonial" apareceu como item de menu separado no sistema atual — pode ser um 4º subtipo de serviço distinto de "Pronta Resposta", ainda não confirmado.

**Bug real corrigido**: o script `start` de `apps/api/package.json` apontava para `dist/main.js`, mas o build do Nest (com `sourceRoot: "src"`) gera em `dist/src/main.js` — o comando nunca teria funcionado em produção. Corrigido, e criado um script de conveniência `npm run start:api` na raiz (build + start em um comando só), testado e validado.

## 2026-09-13 — Atualização do schema com achados reais (Conta, Ocorrência, correção de integridade)

Sem conexão de WhatsApp real ainda (número disponível, mas físico na empresa e não configurado como Business — fica para quando houver acesso presencial a ele). Enquanto isso, atualizado o código com tudo aprendido dos vídeos:

- **Novo model `Conta`** no Prisma: representa o vínculo cliente↔endereço/estabelecimento monitorado (ex: painel de alarme de uma loja). Campo `enderecoTravado` (padrão `true`) documenta a decisão de que o endereço de uma conta não deve ser editado depois de criado — qualquer mudança real de endereço deve gerar uma nova Conta. Isso é a correção direta do bug crítico encontrado no sistema atual (troca de endereço entre contas sem validação).
- `Atendimento` ganhou os campos `contaId`, `ocorrencia` e `operadorPR7`, alinhados com o template real de "Retorno Deslocamento" visto no vídeo.
- Prompt de classificação da IA atualizado: agora usa a terminologia real dos serviços do PR7 ("Pronta Resposta", "Recuperação de Veículo", "Análise de Tecnologia Rastreável", "Manutenção Patrimonial") como exemplos, em vez de categorias genéricas, e tenta extrair um número de ocorrência/conta quando mencionado na conversa (sem inventar).
- Relatório Excel e painel visual (`apps/admin/index.html`) atualizados com as novas colunas (Conta, Ocorrência).
- Migração `add_conta_e_campos_reais` aplicada; build e teste de regressão confirmam que o dado já existente (classificado na sessão anterior) continua íntegro após a mudança de schema.

**Observação**: a `Conta` ainda não é populada por nada automaticamente (nenhum fluxo cria uma Conta ainda) — isso é groundwork para a Fase 3, feito agora para não deixar a base de dados desalinhada com o que já sabemos da operação real.

## 2026-09-12/13 — 🎉 Marco: classificação por IA funcionando de ponta a ponta com dado real

Usuário criou a chave de API da Anthropic (console.anthropic.com, sem expiração) e configurou em `apps/api/.env`. API reiniciada, mensagem de teste realista enviada ao webhook ("alarme disparou na loja do centro, precisamos de técnico com urgência").

**Resultado**: a Claude classificou a conversa corretamente:
- Categoria: "suporte técnico"
- Resumo: "Cliente relata disparo de alarme na loja do centro e solicita atendimento urgente de um técnico para verificação do sistema de alarme."
- Status: NOVO
- Cliente extraído corretamente (nome e telefone)

Relatório `.xlsx` testado também e reflete o dado real corretamente.

**Isso fecha a Fase 1 como funcionalmente completa e validada de ponta a ponta**: webhook → fila → classificação por IA → listagem → exportação. Não há mais nenhum bloqueio técnico conhecido nessa fase — o que falta agora é conectar a um BSP de WhatsApp real (Z-API ou similar) para substituir a simulação do webhook por mensagens reais de clientes.

## 2026-09-12 (continuação) — Sessão extensa de levantamento de requisitos de negócio

Sem mudanças de código nesta sessão — foco em capturar corretamente o modelo de negócio real do PR7 antes de avançar para as Fases 2/3. Pontos-chave (detalhes completos em `docs/plano.md`):

- **Correção crítica de escopo**: PR7 não presta vigilância nem escolta armada (Lei 7.102/1983 não se aplica) — os serviços reais são técnico de manutenção/vistoria de alarmes (Patrimonial) e rastreamento/recuperação de veículos (Veicular). Essa restrição foi gravada tanto no plano do projeto quanto na memória de longo prazo do assistente, para nunca ser reintroduzida por engano.
- **Taxonomia de serviços**: 3 subtipos mapeados com campos detalhados (Alarme/Vistoria, Recuperação de Veículo, Análise de Tecnologia Rastreável); usuário confirmou que há mais subtipos e vai enviar os campos depois.
- **Fase 2 (Prestadores)** ganhou requisitos novos: tipos de serviço + valores acordados por prestador, aba de contratos com validade de 5 anos, verificação de antecedentes criminais (documento da Polícia Federal + aprovação manual, como política interna de confiança, não exigência legal), e tutorial guiado de onboarding (estilo Uber) em vez de vídeo de treinamento externo.
- **Fase 3 (Despacho)** ganhou requisitos novos: rastreamento em tempo real no mapa (estilo Uber, com permissões de dispositivo), suposição de marca d'água (data/GPS) nas fotos do relatório de campo (pendente de confirmação), exportação do relatório de campo em PDF/Word/Excel/XML.
- **Nova seção de Conformidade**: regras do WhatsApp Business Platform (opt-in, janela de 24h, templates aprovados), LGPD, e riscos regulatórios adicionais — com destaque para o **risco de vínculo empregatício** (paralelo aos casos Uber/iFood no Brasil), sinalizado como prioridade para revisão por advogado trabalhista.
- Painel visual (`apps/admin/index.html`) redesenhado a pedido do usuário: paleta calma verde-azulada, modo escuro, saudação personalizada — pensado para bem-estar de quem usa o sistema no dia a dia.
- Usuário vai gravar um vídeo mostrando o fluxo real de atendimento na empresa hoje, para validar/ajustar o modelo de dados antes de implementar a Fase 2/3.

## 2026-09-11 — Definição do escopo e arquitetura

**Pedido original**: sistema que analisa conversas do WhatsApp e extrai resultados por atendimento, com relatórios/planilhas por cliente; aba de cadastro de prestadores com assinatura de contrato em PDF; despacho automático estilo Uber (prestador mais próximo); e um SAC (chat) para prestadores.

**Decisões tomadas com o usuário:**
| Decisão | Escolha | Motivo |
|---|---|---|
| Acesso ao WhatsApp | BSP (Z-API) para começar, com abstração para migrar depois à Cloud API oficial da Meta | Ler mensagens de forma legal e estável exige número de negócio conectado à API oficial; bibliotecas não-oficiais arriscam banimento |
| Classificação das conversas | IA (Claude/Anthropic) extrai cliente, categoria, status e resumo automaticamente | Mais preciso e flexível que regras manuais |
| Assinatura de contrato | Serviço especializado (Clicksign ou Autentique) | Força jurídica e trilha de auditoria maiores que uma solução própria |
| Hospedagem | A definir — recomendação inicial: Railway para MVP | Custo previsível, sem servidor para gerenciar; migração para AWS possível depois |
| Prioridade de módulos | Todos os 4 (análise/relatórios, prestadores/contrato, despacho, SAC) | — |
| Local do projeto | Pasta própria do usuário (fora da área temporária da sessão), não compartilhada | Persistência e privacidade |

**Plano de fases definido** (detalhado em `docs/plano.md`):
- Fase 0 — Fundação (monorepo, banco, auth, deploy)
- Fase 1 — Ingestão WhatsApp + classificação por IA + relatórios ← **em construção**
- Fase 2 — Portal de prestadores + contrato PDF + assinatura eletrônica
- Fase 3 — Motor de despacho por proximidade
- Fase 4 — SAC (chat)
- Fase 5 — Consolidação/deploy de produção

## 2026-09-11/12 — Implementação da Fase 0 + Fase 1

1. **Ambiente**: máquina não tinha Node.js nem Docker instalados.
   - Node.js LTS instalado (via winget, já estava presente mas fora do PATH da sessão).
   - pnpm apresentou erro de permissão no Windows (EPERM ao criar shims) → decidido usar **npm workspaces** em vez de pnpm (mesmo resultado, sem esse atrito).
2. **Estrutura criada**: monorepo com `apps/api` (backend), `apps/admin` e `apps/portal` (placeholders para fases futuras), `packages/shared`.
3. **Backend (`apps/api`)** — NestJS + TypeScript + Prisma (PostgreSQL) + BullMQ (Redis):
   - `prisma/schema.prisma`: modelos `Client`, `Provider` (mínimo), `Conversation`, `Message`, `Atendimento`, `AdminUser`.
   - Módulo `whatsapp`: endpoint `POST /webhooks/whatsapp` recebe mensagens (formato aproximado de BSP tipo Z-API — **precisa ser validado contra o payload real em sandbox**), protegido por token simples (`WEBHOOK_TOKEN`).
   - Módulo `classification`: fila BullMQ que agrupa mensagens por 60s e chama a API da Claude (tool-use estruturado) para extrair categoria, resumo, status e resultado, gravando um `Atendimento`.
   - Módulo `atendimentos`: `GET /atendimentos` (com filtros) e `GET /atendimentos/:id`, protegidos por JWT.
   - Módulo `reports`: `GET /reports/atendimentos.xlsx` gera planilha Excel (`exceljs`) com os atendimentos filtrados.
   - Módulo `auth`: login simples (`POST /auth/login`) com usuário admin único, seedado via `.env`.
4. **Validação de código**: `npm install` (564 pacotes), `npx prisma generate` e `npm run build` executados com sucesso — sem erros de compilação.
5. **Segurança aplicada**:
   - `.gitignore` cobre `.env`, `node_modules`, `dist` etc. desde o início.
   - Segredos reais gerados aleatoriamente (não os valores fracos do `.env.example`) e salvos apenas em `apps/api/.env` (arquivo local, nunca commitado): `JWT_SECRET`, `WEBHOOK_TOKEN`, `ADMIN_PASSWORD`.
   - Confirmado: nenhum repositório Git foi iniciado ainda, nenhum remoto configurado, pasta não compartilhada — nada foi exposto publicamente.
6. **Infraestrutura local**: tentativa de usar Docker Desktop (já instalado) falhou por depender do WSL2, que não estava habilitado; habilitar WSL2 exige privilégios de administrador que a sessão não tinha (não é possível responder a prompts do UAC automaticamente). Usuário optou por seguir com Docker mesmo assim — orientado a rodar `wsl --install` manualmente em um PowerShell aberto como Administrador (isso vai pedir reinício do Windows). Enquanto isso, instalação de **PostgreSQL nativo** iniciada via winget como caminho alternativo para não bloquear o progresso.

## 2026-09-12 — Infraestrutura local finalizada e teste ponta a ponta

**Percalços de ambiente (documentados para referência futura):**
- Tentativa de instalar PostgreSQL nativo no Windows gerou um estado inconsistente (a sessão não tinha privilégios de administrador para gerenciar o serviço do Windows corretamente) — decidido abandonar esse caminho.
- Habilitado o WSL2 (usuário rodou `wsl --install` manualmente como Administrador + reiniciou o Windows) para viabilizar o Docker Desktop.
- Docker Desktop instalado e funcionando após o reboot. `docker compose up -d` sobe Postgres 16 e Redis 7 sem problemas.

**Validação end-to-end realizada com sucesso:**
1. `docker compose up -d` → containers `postgres` e `redis` no ar.
2. `npm run prisma:migrate --workspace=apps/api` → schema criado no banco.
3. Seed do admin executado (`admin@example.com`).
4. API iniciada (`node dist/src/main.js`) → sobe sem erros em `http://localhost:3000`.
5. `POST /auth/login` → retorna JWT corretamente.
6. `POST /webhooks/whatsapp` (mensagem simulada) → cria `Client`, `Conversation` e `Message` no banco; enfileira o job de classificação (BullMQ) com delay de 60s.
7. Job de classificação disparou após o delay (log: `Classificando conversa ...`), mas falhou silenciosamente na chamada à API da Claude — **esperado**, pois `ANTHROPIC_API_KEY` está vazio no `.env`.
8. `GET /atendimentos` → retorna lista vazia (consistente com o item 7).
9. `GET /reports/atendimentos.xlsx` → retorna um arquivo `.xlsx` válido (Microsoft Excel 2007+), mesmo sem dados.

**Conclusão**: a Fase 0 + Fase 1 está completa e funcionando de ponta a ponta. O único item pendente para o pipeline de classificação funcionar de verdade é o usuário preencher `ANTHROPIC_API_KEY` em `apps/api/.env` com uma chave real da Anthropic (console.anthropic.com).

## Estado atual

- Código da Fase 0 + Fase 1 completo, compilando e **validado rodando localmente**.
- Infraestrutura local (Docker + Postgres + Redis) funcionando.
- **Pendente do usuário**:
  - Preencher `ANTHROPIC_API_KEY` em `apps/api/.env` (único bloqueio para a classificação por IA funcionar de fato).
  - Obter conta em um BSP do WhatsApp (Z-API ou similar) para receber mensagens reais.
  - Decidir provedor de assinatura eletrônica (Clicksign/Autentique) para a Fase 2.

## 2026-09-12 — Painel visual (MVP) + regras de negócio da Fase 3

- Criado `apps/admin/index.html`: painel web standalone (login, cartões de resumo, tabela de atendimentos, filtros, exportação de relatório) que conversa direto com a API em `localhost:3000`. Não usa framework/build — arquivo único, aberto direto no navegador. Identidade visual própria ("Atende": logo, paleta roxo/azul, tipografia Inter, sidebar com módulos futuros já listados (Prestadores, Deslocando, SAC) como "em breve".
- Validado no navegador real do usuário (o painel de preview interno do Claude não tem acesso a `localhost` da máquina do usuário — usar sempre o navegador do próprio usuário para testar apps locais).

**Novas regras de negócio levantadas para a Fase 3 (despacho/"Deslocando"):**
- Ao chegar no local, o prestador tem uma janela de 15-30 min (variável por categoria do chamado) para inspecionar o sistema de alarme e o local.
- Se estourar o prazo sem envio do relatório, o sistema deve alertar/escalar para o SAC/operador (não é passivo).
- Depois da inspeção, o prestador envia um relatório de campo: fotos + notas em áudio ou texto.
- Cada solicitação (conta + endereço do cliente) gera um ID de atendimento único por cliente — já coberto pelo modelo atual (`Atendimento.id` vinculado a `Client`).
- Detalhes completos e impacto no modelo de dados registrados em `docs/plano.md` (seção Fase 3).

**Exportação multi-formato (relatório de campo, Fase 3):** deve sair em PDF, Word, Excel e XML. O XML vai representar o banco de dados consolidado de todos os atendimentos. Usuário vai enviar uma planilha com os campos exatos a coletar — aguardando isso antes de fechar a estrutura do `FieldReport`.

**Taxonomia de serviços (empresa: PR7, pr7.seg.br — segurança patrimonial/veicular):** o usuário enviou dois cabeçalhos de planilha reais:
- "Alarme/Vistoria" (categoria Patrimonial): Id, Cliente, Estabelecimento, Data da solicitação, Data Final, Conta, SAP, Ordem, Validação, Filial, Endereço, Cidade, Estado, Tipo de Serviço, Pagamento, Motivo, Solicitante, Operador Pr7, Data Deslocamento, Data Local, Data de Finalização, Total de Horas, Data de Pagamento, Nome do Agente, Equipe, Pix, Insumos de emergência, Valor, Valor cobrado, Usuário, Observação.
- "Recuperação de Veículo" (categoria Veicular): Status, Id, Data, Hora Solicitação, Cliente, Placa, Motivo, Recuperado, Solicitante, Cidade, Estado, Latitude, Longitude, Agente, Pix, Equipes, Km Inicial/Final/Total/Excedente (+valor), Data Deslocamento, Data Local, Data Final, Total, Valor, Gasto adicional, Hora Excedente (+valor), Valor total, Observação, Usuário.

O usuário confirmou que há **mais subtipos de serviço** dentro de "Patrimonial" e "Veicular" além desses dois exemplos, e que vai enviar os campos depois — **pediu explicitamente para ser lembrado/cobrado disso**. Decisão de arquitetura confirmada: núcleo comum (`Atendimento`) + tabela de detalhe específica por tipo de serviço. Detalhes completos em `docs/plano.md` (seção Fase 3).

## Próximos passos imediatos

1. Usuário adiciona a `ANTHROPIC_API_KEY` real para validar a classificação de ponta a ponta com dados reais.
2. Conectar a um BSP de WhatsApp real (substituindo a simulação do webhook).
3. Iniciar Fase 2 (portal de prestadores + contrato) quando o usuário confirmar o provedor de e-signature.
4. Quando chegar a Fase 3: aguardar a planilha de campos do usuário, então detalhar o schema de `FieldReport` (fotos/áudio/texto) + exportação PDF/Word/Excel/XML + o mecanismo de alerta de prazo estourado.

## 2026-09-18 (11) — Treinamentos da base, aba Fechamentos (cliente, só ADM)
- **Academia**: módulos Pointer/Powerfleet, GR-Tracker e Bodycam preenchidos com o material da pasta `02-Base PR7` (aguardam validação da supervisão). Vídeos ficam como apoio (não transcritos).
- **Aba Fechamentos** (`fechamentos/fechamentos.module.ts`, `@SomenteAdmin()`): o **valor do cliente** (faturamento) fica só aqui, exclusivo do ADMINISTRADOR — a supervisão não vê (403). Resumo por cliente/período (faturamento, atendimentos, quantos sem valor), define `valorCliente` por atendimento (auditado, com `detalhes.valorClienteManual`), e "fechar período" marca `detalhes.faturado`. Aba `💰 Fechamentos` no painel gated por `__admin`. Regra: **valor de cliente → Fechamentos; valor de apoio → nos atendimentos**. Teste: `scripts/teste-fechamentos.ts` (8).
- **Pendências levantadas** (memória `project_pr7_regras_operacao`): TBG (valor 350 é do cliente, não do apoio; valor ao apoio é acordado por pessoa; camiseta branca); planilha de cadeados físicos ainda não localizada; `Senhas base.xlsx` tem logins em texto puro (risco — não importado); negativas atual a definir.

## 2026-09-18 (12) — Acessos dos postos (chave/cadeado), preenchido nos atendimentos
- Aba **Acessos dos postos** (`acessos/acessos-posto.module.ts`, permissão `prestadores` + ADM): registra por posto se o acesso é **chave física** ou **cadeado de senha**, o segredo (restrito), e o **histórico de trocas** — inclusive quando **outra empresa atende e troca a senha** (`outraEmpresa`). Preenchido conforme os atendimentos. Segredo nunca vai na lista (só em "ver", auditado como `SEGURANCA`); toda alteração auditada. Modelo `AcessoPosto` (migração `20260918110000_acesso_posto`). Teste: `scripts/teste-acessos-posto.ts` (10).
- Regra do usuário: cobrir os postos conforme os atendimentos, documentando chave×senha e as trocas por terceiros.

## 2026-09-18 (13) — Relatórios (PDF sem valores / Excel com valores) e procedimentos veiculares
- **Relatórios de atendimentos**: `GET /reports/atendimentos.pdf` (lista, **sem valores** — regra do usuário) e `GET /reports/atendimentos.xlsx` (agora com **colunas de valor só para quem tem `valores`/ADM**). Botões "⬇ Excel" e "📄 PDF" na aba Atendimentos, respeitando os filtros. Gerador `reports/relatorio-lista-pdf.ts` (logo PR7, paisagem, rodapé "sem valores"). PDF por atendimento (com fotos, sem valores) já existia. Tudo auditado como EXPORTAÇÃO. Acesso: permissão `relatorios` (analista/aux.adm/supervisão/ADM — não os operadores base).
- Pendências de relatório: replicar os botões PDF/Excel nas demais abas (monitoramento, SAC, roteirizador); relatório da **equipe de monitoramento** em PDF (conteúdo a definir com o usuário).

## 2026-09-18 (14) — Observação peculiar (valor acordado no momento) → supervisão + Fechamentos
- No atendimento, campo **"⚠ Observação peculiar"** (ex.: valor acordado no local): o operador registra e a **supervisão é notificada** (lista + badge no menu) e o chamado aparece na **aba Fechamentos** (ADM) e na **Equipe** (supervisão) para tratar. Só supervisão/ADM resolve. `detalhes.observacaoPeculiar {texto,por,em,resolvida,...}`; endpoints em atendimentos (`observacoes-peculiares/abertas`, `:id/observacao-peculiar`, `.../resolver`). Auditado.
