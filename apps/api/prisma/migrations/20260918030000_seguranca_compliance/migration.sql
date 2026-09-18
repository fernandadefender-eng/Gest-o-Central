-- CreateTable
CREATE TABLE "ItemCompliance" (
    "id" TEXT NOT NULL,
    "norma" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "automatico" BOOLEAN NOT NULL DEFAULT false,
    "responsavel" TEXT,
    "prazo" TIMESTAMP(3),
    "evidencia" TEXT,
    "atualizadoPor" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCompliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiscoOcupacional" (
    "id" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "perigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "severidade" INTEGER NOT NULL,
    "probabilidade" INTEGER NOT NULL,
    "medidas" TEXT NOT NULL,
    "responsavel" TEXT,
    "prazo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "atualizadoPor" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiscoOcupacional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidenteSeguranca" (
    "id" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "gravidade" TEXT NOT NULL,
    "dadosAfetados" TEXT,
    "titularesAfetados" INTEGER,
    "medidas" TEXT,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "detectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comunicadoAnpdEm" TIMESTAMP(3),
    "comunicadoTitularesEm" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "registradoPor" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidenteSeguranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContagemTabela" (
    "id" TEXT NOT NULL,
    "tabela" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "medidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContagemTabela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigSistema" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigSistema_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemCompliance_codigo_key" ON "ItemCompliance"("codigo");

-- CreateIndex
CREATE INDEX "ContagemTabela_tabela_medidoEm_idx" ON "ContagemTabela"("tabela", "medidoEm");


-- Auditoria é só inclusão: ninguém altera nem apaga um evento de segurança
CREATE OR REPLACE FUNCTION pr7_auditoria_imutavel() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('pr7.permitir_apagar_mensagem', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Registro de auditoria não pode ser alterado nem apagado (regra de segurança PR7)';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS auditoria_imutavel ON "EventoSeguranca";
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON "EventoSeguranca"
  FOR EACH ROW EXECUTE FUNCTION pr7_auditoria_imutavel();
