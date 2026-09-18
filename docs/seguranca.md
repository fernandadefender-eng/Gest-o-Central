# Segurança — medidas aplicadas e pendências

> Atualizado em 2026-09-18. Revisar a cada mudança que envolva acesso, dados pessoais, valores ou serviços externos.

## Aba Segurança (painel · só ADMINISTRADOR)
Guarda `SomenteAdmin` no servidor — não é permissão que se libera a operador (operador com "Gerenciar usuários" recebe 403). Rotas `/seguranca/painel/*`.
- **Proteção de dados**: idade do último backup, verificação do arquivo (abre o `.sql.gz`, confere tabelas e o fim do dump), integridade (contagem das tabelas protegidas a cada hora — tabela que diminui vira alerta; Mensagem e auditoria = crítico), travas do banco, portas do Postgres/Redis (só 127.0.0.1), senha do banco, segredos.
- **Acessos**: logins, recusas, bloqueios, IPs, chamadas externas barradas, exportações, usuários sem uso e não-admins que gerenciam usuários. **Encerrar todas as sessões** (incidente): tokens emitidos antes do corte deixam de valer (`ConfigSistema.sessoesValidasDesde`).
- **LGPD** (15 itens) e **NR-1 / GRO-PGR** (10 itens): checklist com responsável, prazo e evidência; itens ⚙ são conferidos pelo sistema e não aceitam marcação manual.
- **NR-1**: inventário de riscos por função (inclui psicossociais) com matriz 5×5 e plano de ação; indicadores da operação (carga do Help Desk: média/dia, % noturno, pico por hora; exposição dos agentes a ocorrências de violência).
- **Incidentes** (dados e ocupacionais): gravidade, afetados, medidas, data de comunicação à ANPD.
- Roteiro de gestão — LGPD com o encarregado/jurídico; PGR validado pelo profissional de SST.

## Gestão de usuários por setor (18/09/2026)
Regra da operação: quem não é administrador e tem "Gerenciar usuários" cuida **só da equipe da Operação** (funções Help Desk e Operador de monitoramento): vê só esses usuários, só dá telas da operação (mapa, painel do mês, atendimentos, registrar ocorrências, monitoramento, SAC, prestadores), não mexe no administrador nem nas próprias permissões e não vê a auditoria (`/seguranca/eventos` é só do administrador). Conferido no servidor (`foraDaRegra` em `usuarios.module.ts`); testado com usuários temporários.

**Fora da regra → pedido de aprovação (18/09/2026)**: "sempre que ela cadastrar a equipe e algo sair da regra, peça a minha permissão ou a do Mendes". Quando quem não é administrador cria/altera alguém fora da regra (outra função, tela fora da Operação, usuário de outro setor, as próprias permissões), **nada é aplicado**: vira um `PedidoAprovacao` (PENDENTE) e só um administrador aprova ou recusa (`POST /usuarios/aprovacoes/:id/aprovar|recusar`, `SomenteAdmin`). No pedido a senha fica **só como hash** e nunca sai da API. Na aprovação o sistema confere de novo (e-mail já usado, usuário apagado, alvo virou admin) e o usuário nasce sempre como OPERADOR. Mexer em administrador continua proibido (403). Tudo vai para a auditoria (`APROVACAO`: aberto, aprovado, recusado — quem, quando, por quê). No painel: bloco "🔐 Pedidos fora da regra" na tela Usuários e contador amarelo no menu para o administrador; no cadastro, as opções fora da regra aparecem com 🔐. Para o Mendes aprovar, ele precisa de um usuário ADMINISTRADOR. Teste: `apps/api/scripts/teste-aprovacao.ts` (20 verificações, contas temporárias).

**Técnico de Segurança do Trabalho — NR-1 e eSocial (18/09/2026)**: função `TECNICO_SST` com a permissão `nr1`. Na aba Segurança ele vê **só**: checklist NR-1, inventário de riscos, indicadores, "Informar trabalhadores" e incidentes **ocupacionais** (com CAT/eSocial S-2210: data de envio e nº do recibo). Não vê proteção de dados, acessos, LGPD, auditoria, incidentes de dados, nem atendimentos/clientes (conferido no servidor por rota; teste `apps/api/scripts/teste-sst.ts`, 28 verificações).
- **Escopo**: NR-1 aplicada por enquanto **só à equipe interna** (sem serviço externo). Os riscos das funções de prestadores (pronta resposta, recuperação veicular, acompanhamento velado) ficaram guardados com `foraDoEscopo` — não contam no PGR, nos indicadores nem nos comunicados; NR1-06 (terceiros) = Não se aplica. Nada foi apagado.
- **Informar trabalhadores** (NR1-05, automático): o técnico escolhe funções e pessoas; cada uma recebe por e-mail um **link pessoal** (`/sst-info/<código>`, 256 bits, validade 1–90 dias) que mostra só perigo, tipo, nível e medidas, com "Li e estou ciente". O banco guarda só o **hash** do link; o e-mail não leva conteúdo de risco; reenviar gera outro código e derruba o anterior; revogar desativa todos. Se o risco mudar depois da ciência, a pessoa aparece como "desatualizada" para reenvio. Pelo túnel, além do webhook, só esse caminho abre (código malformado = 404). Aberturas e ciências vão para a auditoria com IP. Sem SMTP, o link aparece **uma única vez** para quem enviou repassar pessoalmente.

**E-mails automáticos**: usuário criado recebe o acesso; pedido fora da regra avisa os administradores; decisão avisa quem pediu; usuário aprovado recebe o aviso de acesso (sem senha). **Pendente: configurar SMTP** (`SMTP_HOST/PORT/USER/PASS/FROM` no `apps/api/.env`) — até lá nada sai e a tela avisa.

**Aviso de acesso monitorado (18/09/2026)**: a cada entrada de quem não é administrador, o painel só abre depois do "Estou ciente" no aviso *acesso monitorado e registrado · uso interno e restrito · proibida a divulgação · LGPD e normas internas*. A ciência vai para a auditoria (`CIENCIA_MONITORAMENTO`, com IP) e um selo "🔒 Acesso monitorado · uso restrito" fica fixo na tela.

## Resumo
| Camada | Medida | Onde |
|---|---|---|
| Rede | Banco (5432) e Redis (6379) aceitam só `127.0.0.1` — antes estavam abertos para a rede local, Redis sem senha | `docker-compose.yml` |
| Rede | API escuta só `127.0.0.1` (`HOST` no `.env` para mudar) | `apps/api/src/main.ts` |
| Acesso | Login com bcrypt; bloqueio após 5 erros/15 min (IP+e-mail) ou 20/IP; tempo de resposta igual para e-mail inexistente | `auth/auth.service.ts`, `seguranca/seguranca.ts` |
| Acesso | Perfis **ADMIN / OPERADOR** com permissões por tela/ação e por linha de negócio (Patrimonial/Veicular), checadas **no servidor** | `auth/permissoes.ts` |
| Acesso | Token revalidado a cada requisição: usuário desativado ou senha trocada perde acesso na hora | `auth/jwt.strategy.ts` |
| Acesso | Senhas de usuários: 10+ caracteres com letras e números; operador não cria nem promove admin | `usuarios/usuarios.module.ts` |
| Dados | Valores financeiros removidos das respostas para quem não tem `valores` | `atendimentos`, `bi`, `geo` |
| Dados | Observação interna / contatos do apoio nunca vão para relatório de cliente | `detalhes.observacaoInterna` |
| Segredos | API não sobe sem `JWT_SECRET` (32+) e `WEBHOOK_TOKEN` (24+); sem valores padrão inseguros | `seguranca/seguranca.ts` |
| Segredos | Webhook do WhatsApp compara token em tempo constante; antes, token ausente dos dois lados passava | `whatsapp.controller.ts` |
| Navegador | **Content-Security-Policy**: painel só carrega scripts/estilos/imagens de origens da lista branca e só envia dados para a própria API | `seguranca/seguranca.ts` (`CSP`) |
| Navegador | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, sem `X-Powered-By`; CORS fechado | `main.ts` |
| Navegador | Leaflet carregado com **SRI** (hash conferido): arquivo adulterado no CDN é recusado | `apps/admin/index.html` |
| Rede | **Túnel público (Cloudflare) só expõe o webhook**: qualquer outra rota vinda de fora responde 404 e é auditada; IP real lido de `cf-connecting-ip` | `somenteWebhookPeloTunel` em `seguranca.ts` |
| Rede | Raiz do túnel responde só "ok" (serviços externos testam se o endereço existe); `GET /webhooks/whatsapp` responde "ativo" sem dados | `seguranca.ts`, `whatsapp.controller.ts` |
| Rede | **Vigia do túnel**: testa a cada 60 s (DNS público + HTTP); se cair, sobe outro e reconfigura o webhook da Z-API sozinho | `scripts/tunel-vigia.ps1` (log em `logs/tunel-vigia.log`) |
| Segredos | Chaves da Z-API (`ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`) só no `.env`, preenchidas pelo usuário; usadas **só** por `scripts/zapi-webhook.ts` (status e webhook) — o sistema continua sem nenhum código de envio | `.env`, `scripts/zapi-webhook.ts` |
| Z-API | "Token de segurança da conta" ativado (exige Client-Token em toda chamada à API da instância); recomendado 2FA na conta | painel da Z-API |
| Dados | Mídias: baixadas só de URL http(s), tipos permitidos, até 50 MB, hash SHA-256; servidas só com login e vertical liberada; caminho preso a `storage/midias` | `midias/midias.module.ts` |
| Navegador | CSP permite `blob:` em `img-src`/`media-src` (fotos carregadas com login e exibidas da memória, sem URL pública) | `seguranca.ts` |
| Operação | Retorno só liga ao chamado com ID PR7 ou com conta + empresa + horário + validação/SAP conferindo (1 candidato); conta cadastrada só se o estabelecimento bater — evita despacho/relatório no endereço errado | `classification.service.ts` |
| Logs | Logs da API em `logs/api-AAAAMMDD-HHMM.log` (não sobrescreve); webhook registra só metadados (nunca o conteúdo); pasta no `.gitignore` | `main.ts`, `logs/` |
| Abuso | Limite de 600 requisições/min por IP (`RATE_LIMIT_PER_MIN`); corpo JSON até 1 MB | `main.ts` |
| Auditoria | Tabela `EventoSeguranca` (só inclusão): logins, bloqueios, webhook recusado, limite, alterações | ver `docs/banco-de-dados.md` |
| Operação | Prestador/agente **RESTRITO** não aparece na sugestão e a API recusa acioná-lo | `geo.service.ts`, `atendimentos.service.ts` |
| Continuidade | Backup completo do banco em 1 comando, 14 cópias | `scripts/backup-banco.ps1` |
| Auditoria | **Imutável**: trigger recusa UPDATE/DELETE em `EventoSeguranca`; exportações (planilha, PDF) e ações da aba Segurança auditadas | migração `20260918030000` |
| Dados | Mensagens: trigger recusa apagar e trocar o texto original; apagada/editada no WhatsApp fica marcada | migração `20260918010000` |
| Segredos | Senha do Postgres trocada por senha forte (18/09); docker-compose lê do `.env` da raiz (não versionado) | `docker-compose.yml`, `.env` |
| Segredos | Token do webhook trocado (18/09) sem perder mensagem | `whatsapp.controller.ts` |
| Continuidade | Backup automático a cada 12 h (`.sql.gz`, nenhum apagado) + verificação pela aba Segurança | `backup/backup.module.ts` |
| Continuidade | Vigia do sistema (Docker, API, túnel) + atualização segura | `scripts/tunel-vigia.ps1`, `scripts/atualizar-api.ps1` |
| Operação | Lista de restritos compara telefone no formato único (com/sem 9, com/sem 55) — variação de escrita não escapa do bloqueio | `geo/bloqueio.ts` |
| Dependências | `bcrypt` trocado por `bcryptjs` (eliminou a falha **crítica** do `tar`); `npm audit fix` aplicado | `apps/api/package.json` |

## Serviços externos (tudo que sai do computador)
| Serviço | O que é enviado | Por quê | Custo |
|---|---|---|---|
| Anthropic (Claude) | Texto das conversas de WhatsApp a classificar | Extração de atendimentos | Teto mensal `MONTHLY_BUDGET_USD` |
| OpenStreetMap tiles | Pedidos de imagens do mapa (área visível) | Fundo do mapa | Gratuito |
| Nominatim (OSM) | Só nome da cidade + UF, 1 vez por cidade | Posição das cidades | Gratuito |
| unpkg.com | Download do Leaflet (com SRI) | Biblioteca do mapa | Gratuito |
| Google Fonts | Download das fontes | Tipografia | Gratuito |
| WhatsApp (wa.me) | Nada automático — só abre quando o operador clica no telefone | Contato manual | — |
| Z-API | Recebe as mensagens do número da operação e repassa ao webhook; o sistema só consulta status e configura o webhook | Integração WhatsApp (não oficial — risco de banimento do número aceito pelo usuário) | R$ 99,99/mês |
| Cloudflare (túnel rápido) | Tráfego do webhook até este computador | Receber mensagens sem abrir porta | Gratuito (endereço muda; domínio próprio ~R$ 40/ano para fixar) |

O sistema **não envia mensagens** de WhatsApp.

## Pendências (em ordem de prioridade)
1. **Trocar a senha do admin** e o e-mail `admin@example.com` — a senha atual foi exibida no chat. Editar `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `apps/api/.env` e rodar `npx prisma db seed` (em `apps/api`), ou criar um admin novo pela tela Usuários e desativar o antigo.
2. **Chave da Anthropic e `.env` estão numa pasta do OneDrive** (sincroniza com a nuvem). Considerar mover o projeto para fora do OneDrive ou girar a chave periodicamente.
3. **13 vulnerabilidades restantes** (3 altas, 10 médias) exigem subir o NestJS para a v12 (mudança grande). Planejar fora de período de testes. As altas (multer, lodash via config) não são usadas por rotas expostas hoje (não há upload de arquivo).
4. **Hospedar localmente** Leaflet e fontes (remove unpkg/Google da lista branca).
5. **Backup automático diário** (Agendador de Tarefas do Windows) e cópia fora da máquina, criptografada.
6. **Produção:** HTTPS obrigatório + HSTS, senha no Redis, usuário do Postgres com privilégio mínimo, limite de tentativas no Redis (hoje é em memória, 1 instância).
7. **2FA** para administradores (painel) e **na conta da Z-API**.
8. **Trocar o `WEBHOOK_TOKEN`** — foi colado no chat em 15/09 (baixo risco: só permite enviar mensagens falsas ao webhook). Após trocar, rodar `scripts/zapi-webhook.ts configurar <túnel>`.
9. **Computador não pode dormir** (Energia → suspensão: Nunca) e, para operação real, **servidor 24 h na nuvem** (~R$ 50–150/mês) — hoje este PC é ponto único de falha (plantão de 14→15/09 perdido).
10. Mídias no OneDrive: mover `storage/` para armazenamento próprio com backup em produção.
