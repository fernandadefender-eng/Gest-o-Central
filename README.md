# Plataforma de Atendimento, Prestadores e Despacho (WhatsApp)

Monorepo (npm workspaces). Veja o plano completo em `docs/plano.md` — arquitetura, roadmap por fases e decisões tomadas.

Estrutura:
- `apps/api` — backend NestJS: ingestão de WhatsApp, classificação por IA, BI, mapa, prestadores/organograma, registro de ocorrências, usuários com permissões, auditoria, relatórios
- `apps/admin/index.html` — painel (Visão geral BI + mapa, Atendimentos Patrimonial/Veicular com assistente de nova ocorrência, Prestadores com organograma e restritos, Usuários e auditoria) — arquivo único servido pela API em `/painel`, sem build

Documentação: [banco de dados](docs/banco-de-dados.md) · [segurança](docs/seguranca.md) · [formulário de ocorrência](docs/formulario-ocorrencia.md) · [planilha de referência](docs/planilha-referencia.md) · [registro do projeto](docs/registro-do-projeto.md) · [plano](docs/plano.md)
- `apps/portal` — portal do prestador, a criar na Fase 2
- `packages/shared` — código compartilhado entre apps (a criar conforme necessário)

## Rodando localmente

### 1. Infraestrutura (Postgres + Redis)

```bash
docker compose up -d
```

Se não tiver Docker, instale PostgreSQL e Redis manualmente e ajuste `DATABASE_URL`/`REDIS_URL` no `.env`.

### 2. Configurar variáveis de ambiente

```bash
cp apps/api/.env.example apps/api/.env
```

Edite `apps/api/.env` e preencha pelo menos `ANTHROPIC_API_KEY` (necessária para a classificação das conversas) e `WEBHOOK_TOKEN` (um valor aleatório qualquer).

### 3. Instalar dependências

```bash
npm install
```

### 4. Rodar as migrações e criar o usuário admin

```bash
npm run prisma:migrate --workspace=apps/api
```

O comando acima aplica o schema no banco e roda o seed automaticamente, criando o usuário admin com o email/senha definidos no `.env` (`ADMIN_EMAIL`/`ADMIN_PASSWORD`).

### 5. Iniciar a API

```bash
npm run dev:api
```

A API sobe em `http://localhost:3000`. **No Windows**, se esse comando falhar por causa de caracteres especiais no caminho da pasta, use o modo compilado (mais estável, já testado e validado):

```bash
npm run start:api
```

### 6. Abrir o painel visual

Com a API rodando, acesse **http://localhost:3000/painel/** e faça login com o `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`. A própria API serve o painel — não precisa de build.

> Não abra o `index.html` com duplo clique: aberto como arquivo, o OpenStreetMap bloqueia o mapa (erro 403 "Access blocked"). Os totais dos cartões vêm de `GET /atendimentos/resumo`; a tabela mostra os 300 mais recentes (o relatório exporta tudo).

### 7. Operadores e acessos

Na tela **Usuários** (admin), crie um usuário por operador com nome completo, e-mail e senha inicial (10+ caracteres com letras e números). Marque as telas/ações liberadas e as linhas de negócio (Patrimonial/Veicular). O servidor bloqueia tudo que não estiver marcado, inclusive valores financeiros. Desativar um usuário corta o acesso na hora.

### 8. Importar histórico da planilha e fazer backup

```bash
powershell -ExecutionPolicy Bypass -File scripts/backup-banco.ps1
```

```bash
cd apps/api && npx ts-node -T scripts/importar-planilha.ts "C:/caminho/da/planilha.xlsx"
```

Reimportar é seguro: atendimentos do WhatsApp e do formulário, edições do organograma e prestadores restritos são preservados. Detalhes em [docs/banco-de-dados.md](docs/banco-de-dados.md).

Empresas clientes (planilha Clientes.xlsx do sistema atual):

```bash
cd apps/api && npx ts-node -T scripts/importar-clientes.ts "C:/caminho/Clientes.xlsx"
```

### 9. WhatsApp real (Z-API + túnel)

1. Z-API: instância conectada pelo QR Code; "Ler mensagens automaticamente", "Rejeitar chamadas" e anti-golpe **desligados**; "Notificar as enviadas por mim" **ligado**; token de segurança da conta ativado.
2. Chaves da instância no `apps/api/.env` (`ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`) — preenchidas por quem administra a conta, nunca coladas em chat.
3. Ligar o vigia do túnel (sobe o túnel, testa a cada minuto e reconfigura a Z-API se o endereço mudar):

```bash
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts/tunel-vigia.ps1
```

Conferir/configurar à mão: `npx ts-node -T scripts/zapi-webhook.ts status` ou `... configurar https://<túnel>.trycloudflare.com` (em `apps/api`). Logs: `logs/api-*.log` e `logs/tunel-vigia.log`.

4. Em **Monitoramento → Grupos**, definir cada grupo como Cliente, Prestador ou Interno (grupo sem tipo não abre chamado).

> ⚠️ Com o computador dormindo ou desligado nada é recebido, e a Z-API **não reenvia** o que perdeu nem entrega histórico (multi-device). Energia → suspensão: **Nunca**.

> **Segurança:** a API só aceita conexões deste computador (`127.0.0.1`), assim como banco e Redis. Não sobe sem `JWT_SECRET` (32+ caracteres) e `WEBHOOK_TOKEN` (24+). Ver [docs/seguranca.md](docs/seguranca.md).

## Testando o fluxo ponta a ponta

1. **Login**: `POST /auth/login` com `{ "email": ..., "password": ... }` → retorna `accessToken`.
2. **Simular mensagem do WhatsApp**: `POST /webhooks/whatsapp?token=<WEBHOOK_TOKEN>` com body:
   ```json
   {
     "phone": "5511999999999",
     "chatName": "Cliente Teste",
     "fromMe": false,
     "momment": 1700000000000,
     "messageId": "msg-1",
     "text": { "message": "O alarme da nossa loja disparou, precisamos de um técnico com urgência" }
   }
   ```
3. Aguarde ~60s (delay da fila para agrupar mensagens da mesma conversa) e confira em `GET /atendimentos` (com o `accessToken` no header `Authorization: Bearer ...`, ou direto no painel visual) que o atendimento foi criado com categoria/resumo/status extraídos pela IA.
4. Exporte o relatório: `GET /reports/atendimentos.xlsx` (ou pelo botão "Baixar relatório" no painel).

**Validado em produção de testes (2026-09-13)**: esse fluxo completo já rodou com a API real da Anthropic e funcionou corretamente.

## Próximas fases

Ver `docs/plano.md` para o roadmap completo e o **checklist de pendências no topo** (Fase 2: portal de prestadores + contrato; Fase 3: despacho por proximidade + mapas; Fase 4: SAC). Ver `docs/registro-do-projeto.md` para o histórico cronológico de decisões.

**Payload do webhook confirmado com mensagens reais da Z-API em 15/09/2026** (texto, foto, vídeo, áudio, grupos). Formato em `apps/api/src/whatsapp/dto/zapi-webhook.dto.ts`; eventos em formato inesperado são aceitos com 200 e registrados no log (só nomes de campos), para a Z-API não desativar a entrega.
