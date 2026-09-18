# Formulário "Adicionar Ocorrência" — referência do sistema antigo (2026-09-14)

> **Status: implementado** como assistente "Nova ocorrência" na tela Atendimentos (atalho `N`), com as duas verticais. Pendente: aba **Fotos** (legenda, girar, excluir) e aba **Pessoal** do Veicular, que dependem do armazenamento de arquivos. Onde cada campo é gravado: `docs/banco-de-dados.md` → `Atendimento.detalhes`.

Prints enviados pelo usuário do cadastro atual (pr7sistemas). Pedido: refazer **moderno e interativo, com a sensação de um jogo viciante** (progresso visível, recompensa a cada etapa, validação imediata). O sistema precisa **identificar se a ocorrência é Patrimonial ou Veicular** — os campos são bem diferentes. Os prints são antigos: confirmar campos atuais antes de fechar o layout.

## Patrimonial (abas: Informações, Fotos)

| Bloco | Campos |
|---|---|
| Cliente | Cliente (seleção), Conta, Id Validação, Filial, Estabelecimento, SAP, Insumos de Emergência, Valor, Solicitante, Motivo, Ordem de Serviço |
| Local | CEP, Estado, Cidade, Endereço, Número, Latitude, Longitude |
| Equipe | Agentes Aptos, Agente (seleção), Equipe, Responsável |
| Horários | Hora Solicitada, Hora no Local, Hora de Saída, Data Final |
| Situação | Status do Atendimento, Tipo de Serviço, Pagamentos (seleção), Contato Local (seleção) |
| Checklist da vistoria | Verificado a Fiação, Quadro Elétrico, Verificado Portas de Entrada e Arredores, Local Energizado, Sirene Disparada, Local Foi Violado? |
| Interno | Observação (**não vai para o cliente**) |

Lista do sistema antigo ("Atendimento Patrimonial"): Id, Data, Cliente, Conta, Nome Agente, Equipe, Responsável, Estabelecimento, Fotos, Data Final, Status (Finalizado / Em andamento), PDF, Link, Usuário; filtro por empresa e total de atendimentos.

## Veicular

| Bloco | Campos |
|---|---|
| Cliente | Cliente (seleção), Serviço (seleção), Id Validação, Valor, Solicitante, Motivo |
| Local | CEP, Estado, Cidade, Endereço da Ocorrência, Número, Latitude, Longitude |
| Equipe | Agentes Aptos, Prestador (seleção), Equipe |
| Ocorrência | Tipo de Ocorrência |
| Linha do tempo | Data/Hora do Evento, do Deslocamento, da Transmissão, Local, Início do Atendimento, Fim do Atendimento |
| Franquia e deslocamento | Franquia Hora, Franquia KM, KM Inicial, KM Final, Total de Horas (botão "Corrigir"), Total de KM Percorrido |
| Relato | Descrição dos Fatos, Gastos adicionais |
| Veículo | Tipo de equipamento embarcado, Placa, Renavam, Cor, Marca, Modelo, Cidade, Dados Adicionais |
| Dados da Carreta (opcional) | Placa, Renavam, Cor, Marca, Modelo, Cidade, Dados Adicionais |

Da planilha (aba Veicular) também: Placa, Modelo do Veículo, Franqueado, Recuperado, KM Excedente, Hora Excedente e valores, Pedágio, Alimentação, Combustível, Valor KM, Pilhas, Custos adicionais.

Abas do Veicular: Informações, Veículos, Pessoal, Fotos (legenda + foto, excluir, girar).

## Direção do novo formulário

> **Usuário: "não quero assim, fica extenso demais — minimizar essas informações."** O formulário antigo é uma parede de campos. O novo deve pedir o **mínimo na tela** e esconder/automatizar o resto.

- Tela inicial com só o essencial (tipo, cliente/conta ou placa, motivo); tudo o que dá para deduzir é preenchido sozinho e fica recolhido em "mais detalhes".

- Primeira escolha: **Patrimonial ou Veicular** (dois cartões grandes) — define o fluxo inteiro.
- Etapas curtas com barra de progresso e "missões" (Cliente → Local → Equipe → Linha do tempo → Checklist/KM → Fotos), cada etapa concluída dá feedback visual.
- Preenchimento automático: conta puxa estabelecimento/endereço (endereço travado, ver `Conta`), CEP puxa cidade/UF, prestador sugerido pelas áreas de atuação no mapa, totais de horas/KM calculados sozinhos.
- Checklist em botões grandes Sim/Não em vez de selects.
- Validações da operação: nome com sobrenome, telefone com DDD.
