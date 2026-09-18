# Hospedagem definitiva (servidor com endereço fixo)

## Por que
Hoje o sistema roda no computador da operação, com um túnel gratuito cujo endereço muda sozinho.
O vigia (`scripts/tunel-vigia.ps1`) religa Docker, API e túnel e reconfigura a Z-API, mas não resolve:

- computador desligado, sem internet ou reiniciando = sistema parado;
- cada troca de túnel é uma janela em que o WhatsApp pode não entregar;
- OneDrive sincronizando a pasta pode travar arquivos na hora de atualizar (EBUSY).

No servidor: endereço fixo com HTTPS, tudo reinicia sozinho (`restart: always`), backup diário e o computador da operação deixa de ser ponto único de falha.

## Opções e custo (preços consultados em 18/09/2026 · dólar R$ 5,40)

| | VPS Hostinger KVM 2 **(recomendado)** | Railway (plataforma gerenciada) |
|---|---|---|
| Máquina | 2 vCPU · 8 GB RAM · 100 GB NVMe | cobra por uso de CPU/RAM |
| Custo mensal | **R$ 43,99** (promoção, contrato de 24 meses) · renova a **R$ 77,99** | plano US$ 5 + uso ≈ **US$ 25 ≈ R$ 135** |
| Espaço p/ fotos | 100 GB inclusos (hoje: 0,5 GB) | US$ 0,15/GB/mês |
| Quem administra | nós (arquivos prontos em `deploy/`) | a plataforma |
| Observação | confirmar na compra o datacenter na América do Sul | preço varia com o uso |

Domínio: usar um subdomínio do que já existe (ex.: `gestaosystemas.pr7.seg.br`) — **R$ 0**. Só é preciso criar um registro DNS apontando para o servidor.

Nada é contratado sem aprovação do valor.

## O que está pronto (testado em 18/09/2026)
- `apps/api/Dockerfile` — imagem da API + painel; aplica as migrações ao subir; tem `pg_dump` para o backup.
- `deploy/docker-compose.producao.yml` — Postgres, Redis, API e Caddy (HTTPS automático), todos com `restart: always`, banco sem porta exposta.
- `deploy/Caddyfile`, `deploy/.env.exemplo`, `.dockerignore` (nada de `.env`, backups, fotos ou logs dentro da imagem).
- Teste feito num ambiente isolado com banco vazio: 32 migrações aplicadas do zero, travas de mensagem criadas, API saudável, login respondendo, painel servido, `pg_dump 16.15` disponível.

## Passo a passo da migração (≈ 1 hora, de madrugada)
1. **Você**: contrata o plano e cria o acesso por **chave SSH** (eu gero a chave; você cola a parte pública no painel da Hostinger — nenhuma senha passa por mim).
2. **Você**: cria o registro DNS `gestaosystemas` → IP do servidor.
3. Eu instalo Docker no servidor, copio o projeto e preencho `deploy/.env` com os mesmos segredos do `apps/api/.env`.
4. Backup final aqui (`scripts/backup-agora.ts`) → restauro no servidor; copio `storage/` (fotos e comprovantes).
5. `docker compose -f deploy/docker-compose.producao.yml --env-file deploy/.env up -d --build`
6. Aponto a Z-API para `https://gestaosystemas.pr7.seg.br/webhooks/whatsapp?token=…` e confiro a primeira mensagem real.
7. Desligo o túnel e o vigia daqui. O painel passa a ser `https://gestaosystemas.pr7.seg.br/painel/`.

## Atualizar a API no computador (enquanto não migra)
Sempre com `powershell -ExecutionPolicy Bypass -File scripts\atualizar-api.ps1` — compila com a API no ar
(tenta de novo se o OneDrive travar arquivo) e só reinicia se compilou. **Não encadear a saída** (`| tail`):
o terminal fica esperando o processo da API, que herda a saída.
