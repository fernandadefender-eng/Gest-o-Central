CREATE TABLE "TreinoResposta" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "questaoId" TEXT NOT NULL, "moduloCodigo" TEXT NOT NULL,
    "correta" BOOLEAN NOT NULL, "primeira" BOOLEAN NOT NULL, "xp" INTEGER NOT NULL DEFAULT 0, "tempoMs" INTEGER,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreinoResposta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TreinoResposta_userId_criadoEm_idx" ON "TreinoResposta"("userId", "criadoEm");
CREATE INDEX "TreinoResposta_userId_questaoId_idx" ON "TreinoResposta"("userId", "questaoId");

CREATE TABLE "TreinoSimulacao" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "cenarioId" TEXT NOT NULL, "acertos" INTEGER NOT NULL, "total" INTEGER NOT NULL,
    "tempoMs" INTEGER NOT NULL, "xp" INTEGER NOT NULL, "respostas" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreinoSimulacao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TreinoSimulacao_userId_criadoEm_idx" ON "TreinoSimulacao"("userId", "criadoEm");

CREATE TABLE "TreinoValidacao" (
    "moduloCodigo" TEXT NOT NULL, "validadoPor" TEXT NOT NULL,
    "validadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "observacao" TEXT,
    CONSTRAINT "TreinoValidacao_pkey" PRIMARY KEY ("moduloCodigo")
);

CREATE TABLE "TreinoCertificado" (
    "id" TEXT NOT NULL, "codigo" TEXT NOT NULL, "userId" TEXT NOT NULL, "nome" TEXT NOT NULL, "email" TEXT NOT NULL,
    "trilha" TEXT NOT NULL, "modulos" TEXT[], "nota" INTEGER NOT NULL, "xp" INTEGER NOT NULL, "ranque" TEXT NOT NULL,
    "emitidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreinoCertificado_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TreinoCertificado_codigo_key" ON "TreinoCertificado"("codigo");
CREATE INDEX "TreinoCertificado_userId_idx" ON "TreinoCertificado"("userId");
