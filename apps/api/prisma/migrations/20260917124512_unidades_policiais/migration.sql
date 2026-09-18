-- CreateTable
CREATE TABLE "UnidadePolicial" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cidade" TEXT,
    "bairro" TEXT,
    "endereco" TEXT,
    "telefone" TEXT,
    "horario" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "fonte" TEXT NOT NULL DEFAULT 'OpenStreetMap',
    "idExterno" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnidadePolicial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnidadePolicial_idExterno_key" ON "UnidadePolicial"("idExterno");

-- CreateIndex
CREATE INDEX "UnidadePolicial_uf_tipo_idx" ON "UnidadePolicial"("uf", "tipo");

-- CreateIndex
CREATE INDEX "UnidadePolicial_cidade_idx" ON "UnidadePolicial"("cidade");
