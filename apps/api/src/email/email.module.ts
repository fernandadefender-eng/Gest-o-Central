import { Global, Injectable, Logger, Module } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Envio de e-mail da operação (hoje: senha do painel para usuário novo).
 *
 * Configuração no `.env` (a senha de app fica só lá, nunca no código):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_USER=pr7.central@gmail.com
 *   SMTP_PASS=<senha de app do Gmail>
 *   SMTP_FROM="PR7 Atende <pr7.central@gmail.com>"
 *   PAINEL_URL=https://...   (link que vai no e-mail)
 *
 * Sem SMTP configurado nada quebra: o cadastro continua e a tela avisa que o
 * e-mail não saiu (a senha é mostrada para quem cadastrou repassar).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private transporte: nodemailer.Transporter | null = null;

  get configurado() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  private conectar() {
    if (this.transporte || !this.configurado) return this.transporte;
    const porta = Number(process.env.SMTP_PORT ?? 465);
    this.transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: porta,
      secure: porta === 465,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    });
    return this.transporte;
  }

  async enviar(para: string, assunto: string, texto: string, html?: string) {
    const t = this.conectar();
    if (!t) {
      this.logger.warn(`E-mail "${assunto}" não enviado para ${para}: SMTP não configurado`);
      return { enviado: false, motivo: 'SMTP não configurado no servidor' };
    }
    try {
      await t.sendMail({ from: process.env.SMTP_FROM ?? process.env.SMTP_USER, to: para, subject: assunto, text: texto, html });
      this.logger.log(`E-mail enviado para ${para}: ${assunto}`);
      return { enviado: true };
    } catch (err) {
      const motivo = (err as Error).message;
      this.logger.error(`Falha ao enviar e-mail para ${para}: ${motivo}`);
      return { enviado: false, motivo };
    }
  }

  /** Acesso ao painel de um usuário novo (ou senha redefinida). */
  enviarSenha(nome: string, email: string, senha: string, redefinida = false) {
    const url = process.env.PAINEL_URL ?? 'http://localhost:3000/painel/';
    const titulo = redefinida ? 'Sua senha do painel PR7 foi redefinida' : 'Seu acesso ao painel PR7';
    const texto =
      `Olá, ${nome.split(' ')[0]}.\n\n` +
      `${redefinida ? 'Sua senha do painel PR7 foi redefinida.' : 'Seu acesso ao painel PR7 foi criado.'}\n\n` +
      `Endereço: ${url}\nE-mail: ${email}\nSenha: ${senha}\n\n` +
      `Troque a senha no primeiro acesso e não compartilhe este e-mail.`;
    const html =
      `<p>Olá, <b>${nome.split(' ')[0]}</b>.</p>` +
      `<p>${redefinida ? 'Sua senha do painel PR7 foi redefinida.' : 'Seu acesso ao painel PR7 foi criado.'}</p>` +
      `<p><b>Endereço:</b> <a href="${url}">${url}</a><br><b>E-mail:</b> ${email}<br><b>Senha:</b> <code>${senha}</code></p>` +
      `<p style="color:#b45309">Troque a senha no primeiro acesso e não compartilhe este e-mail.</p>`;
    return this.enviar(email, titulo, texto, html);
  }
}

@Global()
@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
