-- Numeração legível do SAC ("Sac-0001"), sequência própria que nunca repete.
-- A numeração vem do código (proximoNumeroSac), como o PR7-H — sem default no banco.
CREATE SEQUENCE IF NOT EXISTS sac_numero_seq START 1;
ALTER TABLE "ChamadoSac" ADD COLUMN "numero" INTEGER;
UPDATE "ChamadoSac" SET "numero" = nextval('sac_numero_seq') WHERE "numero" IS NULL;
ALTER TABLE "ChamadoSac" ALTER COLUMN "numero" SET NOT NULL;
CREATE UNIQUE INDEX "ChamadoSac_numero_key" ON "ChamadoSac"("numero");
