-- NR-1 só para a equipe interna: riscos de funções de prestadores ficam fora do escopo (nada é apagado)
ALTER TABLE "RiscoOcupacional" ADD COLUMN "foraDoEscopo" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "motivoEscopo" TEXT;
UPDATE "RiscoOcupacional" SET "foraDoEscopo" = true,
  "motivoEscopo" = 'NR-1 aplicada por enquanto só à equipe interna; função exercida por prestador (sem serviço externo contratado) — 18/09/2026'
 WHERE funcao IN ('Agente de pronta resposta', 'Recuperação veicular', 'Acompanhamento velado (roteirizador)');
UPDATE "ItemCompliance" SET status = 'NAO_SE_APLICA', "atualizadoPor" = 'regra da operação 18/09/2026',
  evidencia = 'Sem serviço externo: NR-1 aplicada por enquanto só à equipe interna', "atualizadoEm" = now()
 WHERE codigo = 'NR1-06';
