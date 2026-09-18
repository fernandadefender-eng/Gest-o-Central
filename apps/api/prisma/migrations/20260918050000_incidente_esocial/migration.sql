-- CAT (S-2210) do eSocial no registro de acidente de trabalho
ALTER TABLE "IncidenteSeguranca" ADD COLUMN "esocialEnviadoEm" TIMESTAMP(3), ADD COLUMN "esocialRecibo" TEXT;
