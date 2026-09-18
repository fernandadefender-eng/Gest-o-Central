-- Mensagem apagada ou editada no WhatsApp permanece no registro (regra de segurança)
ALTER TABLE "Message" ADD COLUMN "apagadaNoWhatsappEm" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "edicoes" JSONB;

-- Trava: nenhuma mensagem pode ser apagada do banco. Manutenção excepcional exige
-- ligar explicitamente: SET LOCAL pr7.permitir_apagar_mensagem = 'on';
CREATE OR REPLACE FUNCTION pr7_bloqueia_apagar_mensagem() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('pr7.permitir_apagar_mensagem', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Mensagens do WhatsApp não podem ser apagadas do registro (regra de segurança PR7)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mensagem_nunca_apagada ON "Message";
CREATE TRIGGER mensagem_nunca_apagada BEFORE DELETE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION pr7_bloqueia_apagar_mensagem();

-- O conteúdo original também não pode ser trocado (edições vão para "edicoes")
CREATE OR REPLACE FUNCTION pr7_bloqueia_trocar_conteudo() RETURNS trigger AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND coalesce(current_setting('pr7.permitir_apagar_mensagem', true), '') <> 'on' THEN
    RAISE EXCEPTION 'O texto original da mensagem não pode ser alterado (registre a edição em "edicoes")';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mensagem_conteudo_original ON "Message";
CREATE TRIGGER mensagem_conteudo_original BEFORE UPDATE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION pr7_bloqueia_trocar_conteudo();
