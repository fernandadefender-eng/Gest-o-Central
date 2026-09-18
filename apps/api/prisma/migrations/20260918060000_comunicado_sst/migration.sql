-- CreateTable
CREATE TABLE "ComunicadoSst" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "funcoes" TEXT[],
    "criadoPor" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "revogadoEm" TIMESTAMP(3),
    "revogadoPor" TEXT,

    CONSTRAINT "ComunicadoSst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComunicadoDestinatario" (
    "id" TEXT NOT NULL,
    "comunicadoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3),
    "envioErro" TEXT,
    "abertoEm" TIMESTAMP(3),
    "aberturas" INTEGER NOT NULL DEFAULT 0,
    "cienteEm" TIMESTAMP(3),
    "cienteIp" TEXT,

    CONSTRAINT "ComunicadoDestinatario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComunicadoDestinatario_tokenHash_key" ON "ComunicadoDestinatario"("tokenHash");

-- CreateIndex
CREATE INDEX "ComunicadoDestinatario_comunicadoId_idx" ON "ComunicadoDestinatario"("comunicadoId");

-- AddForeignKey
ALTER TABLE "ComunicadoDestinatario" ADD CONSTRAINT "ComunicadoDestinatario_comunicadoId_fkey" FOREIGN KEY ("comunicadoId") REFERENCES "ComunicadoSst"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
