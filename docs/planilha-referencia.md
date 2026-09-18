# Planilha de referência do sistema atual (2026-09-14)

Arquivo analisado: `De Mattos-PAGAMENTOS DE JAN A DEZEMBRO 2025.xlsx` — planilha real de pagamentos de prestadores, usada hoje na operação. **O usuário confirmou: todas as informações da planilha são utilizadas.** Não tratar nenhuma coluna como descartável sem perguntar.

> ⚠️ A planilha contém dados pessoais reais (nomes e telefones de prestadores, nomes e e-mails de contatos nos clientes). Não replicar esses dados em documentação, exportações públicas ou logs.

## Abas e colunas

| Aba | Linhas | Colunas |
|---|---|---|
| **Patrimonial PG PRS 2025** | 15.329 | Id, Cliente, Estabelecimento, Data da solicitação, Data Final, Conta, Sap, Ordem, Validação, Filial, Endereço, Cidade, Estado, Tipo de Serviço, Pagamento, Motivo, Solicitante, Operador Pr7, Data Solicitada, Data Deslocamento, Data Local, Data Termino (+ demais já mapeadas antes) |
| **Veicular** | 802 | Id, Data, Hora Solicitação, Cliente, Placa, **Modelo do Veículo**, Motivo, **Franqueado**, Recuperado, Solicitante, Op. PR7, Cidade, Estado, Latitude, Longitude, Agente, Equipes, Km Inicial/Final/Total/Excedente, Data Deslocamento |
| **Faturamento Geral** | 624 | QTD., DATA, UF, CIDADE, **OPERADOR FORNECEDOR**, **OPERADOR iSOC**, TIPO DE SERVIÇO, MOTIVO, **REMOTA/CÓD.**, NOME DO AGENTE, DATA E HR. ACIONAMENTO, DATA E HR. DE CHEGADA, DATA E HR. DE SAÍDA, ATENDIMENTO EM HORAS, **VALOR HORA**, VALOR TOTAL, OBSERVAÇÕES, ID, **Faps/OC**, **NF**, **Cancelada** |
| **Pagamentos 2026** | 24 | Data, Entrada/Saída, Valores, Forma, Fornecedor, Base de Pgto, Cliente, Serviços, Andamento, **Juros** |
| **Calculo de Preservações** | 46 | Código do Cliente, Nome do cliente, Ocorrência, Dia/Hora Início, Dia/Hora Término, Hora Total, **Valor Hora**, Valor Total, PG |
| **Postos** | 9 | REMOTA, ESTABELECIMENTO, ENDEREÇO, CIDADE, UF, DATA, H.INÍCIO, H.FINAL, TOTAL DIÁRIO, EQUIPE, **Diurno**, **Noturno**, Total, Pgto |
| **Dados 2026** / **Dados Patrimonial 2026** | 5.779 cada | Fonte, Data, Mês Nº, Mês, Cidade de atendimento, Usuário/Operador PR7, Equipe de atendimento, Valor pago, Empresa |
| **X** | 382 | Mesmo formato do Patrimonial (parece recorte/rascunho) |
| Gráfico 2026, Patrimonial Jan-Set 2026 | 37 / 220 | Painéis/resumos gerados a partir das abas de dados |
| ISA-MOGI, Ordenancia | 52 / 10 | Sem cabeçalho estruturado; "Ordenancia" tem células marcadas "não mexer nos azul" |

## Como o sistema lê a planilha (importador)

| Coluna | Vai para | Observação |
|---|---|---|
| Patrimonial · **Equipe** | `Provider` (nome + telefone do responsável / adm da região) | Chave = telefone com DDD |
| Patrimonial · **Nome do Agente** | `ProviderMembro.nome` + `Atendimento.agenteNome` | Pode ser apelido; nome completo é completado no organograma |
| Patrimonial · **Valor** | `Atendimento.valorPrestador` | Pago ao prestador (a confirmar com a operação) |
| Patrimonial · **Valor Total** | `valorTotalPrestador` | Com adicionais |
| Patrimonial · **Preservação cliente** | `valorCliente` | Cobrado do cliente |
| Patrimonial · **Pagamento** | `formaPagamento` | Semanal, Quinzenal, 48 Hrs |
| Veicular · todas | `Atendimento` com `vertical = VEICULAR`, `placa`, `latitude/longitude`, resto em `detalhes` | **Dados deslocados 1 coluna à direita a partir de "Placa"** — o importador detecta pelo campo Estado e corrige. Só 384 das 802 linhas têm UF válida |
| Veicular · valores/KM | `detalhes` | Ainda não entram nos totais financeiros — confirmar significado das colunas |
| Patrimonial · **Data Solicitada** | `solicitadoEm` | Pedido (hora 00:00 = sem hora, fica vazio) |
| Patrimonial · **Data Deslocamento** | não importado | **Não é horário: é a DURAÇÃO do deslocamento** (Data Local − Data Solicitada), gravada como hora. Conferido linha a linha. Consequência: a planilha **não registra quando o prestador foi acionado** — histórico só mede tempo de resposta (pedido → chegada; mediana 28 min, 90% em até 1h32) |
| Patrimonial · **Data Local** / **Data Termino** | `chegadaEm` / `concluidoEm` | |
| Pix, DATA DE PGTO | não importados | Colunas desalinhadas em várias linhas (contêm documentos pessoais fora do lugar); tratar só com validação da operação |

## Outras fontes recebidas

| Arquivo | Conteúdo | Uso no sistema |
|---|---|---|
| `Clientes.xlsx` (15/09) | 40 empresas contratantes (todas PJ): Tipo, Razão Social, Nome Fantasia, CPF/CNPJ, Insc. Municipal/Estadual, E-mail, Telefone, Endereço, Bairro, Cidade, UF, CEP, Ativo, Situação, Qtd. OS, Cadastrado em. Segurpro aparece com 18 filiais por cidade | Tabela `Empresa` (`scripts/importar-clientes.ts`) |
| `Restrições.docx` (15/09) | 18 nomes + prints de e-mails "não cadastrado, não acionar" (com CPF, RG, Pix, banco) | Aguardando conferência do usuário. Só nome, telefone, região e motivo serão registrados em `Restrito` (dúvidas: Tiago × Pauliano, Adenilson, Pointer) |
| Formulário "Retorno Deslocamento" (WhatsApp) | ID, Conta, Ocorrência, Estabelecimento, Op. solicitante, Op. PR7, Agente, Data de solicitação, Hr. solicitada, Hr. de chegada, Serviço, Relato (+ Validação, SAP, Contato no local quando houver) | Lido sem IA (`src/whatsapp/formulario-retorno.ts`) |

**Atenção a colisões:** o nº de conta se repete entre clientes (ex.: conta 4618 da Belfort × contas da planilha Prosegur). Sempre conferir cliente, horário da solicitação, validação e SAP.

## Regras de negócio confirmadas

- **Nome sempre com nome e sobrenome** — validar no cadastro, não aceitar só primeiro nome.
- **Telefone sempre com DDD** — validar formato na entrada.
- **Não vai para o cliente** (campos internos): contato do apoio, e-mails do apoio, e o campo **Observação**. Tudo isso fica só no uso interno — o relatório do cliente não pode conter esses dados.
- **Relatório em PDF precisa conter**: fotos do atendimento, datas, e o **nome do responsável pelo atendimento**.

## Cliente identificado: Prosegur ("PG PRS")

A aba principal é "Patrimonial PG PRS 2025" — PG PRS = Prosegur. Confirmado por uma ordem de compra real enviada pelo usuário:

- Serviço contratado: **"17.01 - SERVIÇO DE PRONTA RESPOSTA A ALARMES"** — confirma o nome do serviço já identificado nos vídeos.
- Valor unitário: **R$ 105,00** por atendimento.
- Condição de pagamento: **45 dias**.
- Nº de fornecedor do PR7 junto ao cliente: 035904646.
- A OC traz um solicitante nomeado do lado do cliente, com e-mail corporativo — é exatamente o tipo de dado que o usuário classificou como **interno** (não replicar em relatório de cliente).

Isso explica os campos `Ordem`, `Faps/OC` e `NF` da planilha: são o encadeamento ordem de compra → atendimento → nota fiscal.

## Implicações para o sistema

1. O modelo de dados atual (`Atendimento`) cobre só uma fração disso. Faltam as dimensões **financeira** (valor hora, valor total, NF, OC, juros, forma de pagamento, base de pagamento) e de **equipe** (agente, equipe, operador, franqueado).
2. Existem **dois eixos de valor**: o que se **cobra do cliente** e o que se **paga ao prestador** — a planilha separa isso (Faturamento Geral × Pagamentos). O sistema precisa dos dois para fechar a conta.
3. Há serviços cobrados **por hora** (preservações, postos com turno diurno/noturno), não só por atendimento — o cálculo não é um valor fixo por chamado.
4. O relatório de fechamento do cliente é um recorte filtrado: **sem** observação, **sem** contatos/e-mails internos.
