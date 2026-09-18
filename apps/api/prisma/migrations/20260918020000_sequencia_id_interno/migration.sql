-- ID interno (PR7-H-000001) sai de uma sequência: nunca repete, nem se um chamado for
-- removido (antes pegava o maior + 1 e reaproveitava o número do removido).
CREATE SEQUENCE IF NOT EXISTS pr7_id_interno_seq;
SELECT setval('pr7_id_interno_seq', greatest(
  100,
  coalesce((SELECT max(substring("idInterno" from 7)::int) FROM "Atendimento" WHERE "idInterno" ~ '^PR7-H-[0-9]+$'), 0)
));
