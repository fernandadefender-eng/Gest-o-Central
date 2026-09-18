-- CreateTable
CREATE TABLE "AreaRisco" (
    "id" TEXT NOT NULL,
    "faccao" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cidade" TEXT,
    "bairro" TEXT,
    "nome" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "raioMetros" INTEGER,
    "geojson" JSONB,
    "populacao" INTEGER,
    "situacao" TEXT,
    "fonte" TEXT NOT NULL,
    "referencia" TEXT,
    "vigenteEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaRisco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcorrenciaPublica" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "idExterno" TEXT,
    "uf" TEXT NOT NULL,
    "cidade" TEXT,
    "bairro" TEXT,
    "endereco" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "mortos" INTEGER,
    "feridos" INTEGER,
    "detalhes" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OcorrenciaPublica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AreaRisco_uf_faccao_idx" ON "AreaRisco"("uf", "faccao");

-- CreateIndex
CREATE INDEX "AreaRisco_cidade_idx" ON "AreaRisco"("cidade");

-- CreateIndex
CREATE UNIQUE INDEX "OcorrenciaPublica_idExterno_key" ON "OcorrenciaPublica"("idExterno");

-- CreateIndex
CREATE INDEX "OcorrenciaPublica_uf_ocorridoEm_idx" ON "OcorrenciaPublica"("uf", "ocorridoEm");

-- CreateIndex
CREATE INDEX "OcorrenciaPublica_tipo_ocorridoEm_idx" ON "OcorrenciaPublica"("tipo", "ocorridoEm");
