import { timingSafeEqual } from 'crypto';

/**
 * Lê um segredo obrigatório do .env. Sem valor padrão de propósito: um
 * segredo "de exemplo" esquecido em produção abriria o sistema inteiro.
 */
export function segredoObrigatorio(nome: string, tamanhoMinimo = 24): string {
  const valor = process.env[nome];
  if (!valor || valor.length < tamanhoMinimo) {
    throw new Error(`${nome} ausente ou curto demais no .env (mínimo ${tamanhoMinimo} caracteres). A API não sobe sem ele.`);
  }
  return valor;
}

/** Compara segredos em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres acertou). */
export function segredoConfere(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Lista branca de origens externas do painel (Content-Security-Policy).
 * O navegador bloqueia qualquer script, estilo, imagem ou conexão fora daqui —
 * inclusive envio de dados para outro domínio, caso algum código malicioso entre.
 * Única saída de dados permitida: a própria API ('self').
 */
export const CSP = [
  "default-src 'self'",
  // 'unsafe-inline': o painel é um arquivo único com script embutido
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  // blob: fotos dos atendimentos, carregadas com login e exibidas a partir da memória do navegador
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

type Req = { ip?: string; socket?: { remoteAddress?: string } };
type Res = { setHeader(n: string, v: string): void; statusCode: number; end(body?: string): void };

/** Cabeçalhos de segurança em todas as respostas. */
export function cabecalhosDeSeguranca(_req: Req, res: Res, next: () => void) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // strict-origin-when-cross-origin: o OpenStreetMap exige a origem para liberar o mapa
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

/**
 * Requisição que chega pelo túnel público (Cloudflare) só pode usar o webhook
 * do WhatsApp. Painel, login e dados continuam acessíveis apenas deste computador.
 * O Cloudflare sempre acrescenta o cabeçalho cf-connecting-ip; acesso local não tem.
 */
export function somenteWebhookPeloTunel(aoBloquear?: (ip: string, caminho: string) => void) {
  return (req: Req & { headers: Record<string, string | string[] | undefined>; path?: string; url?: string }, res: Res, next: () => void) => {
    const ipExterno = req.headers['cf-connecting-ip'];
    if (!ipExterno) return next();
    const caminho = (req.path ?? req.url ?? '').split('?')[0];
    if (caminho === '/webhooks/whatsapp') {
      // Diagnóstico: toda chamada externa ao webhook fica no log com o resultado
      // (sem conteúdo), para saber se a Z-API está chamando e se foi aceita.
      const inicio = Date.now();
      const r = res as Res & { on?: (ev: string, cb: () => void) => void };
      r.on?.('finish', () => console.log(`[Webhook] chamada externa ${String((req as { method?: string }).method)} → ${res.statusCode} em ${Date.now() - inicio} ms (${new Date().toLocaleTimeString('pt-BR')})`));
      return next();
    }
    // Link pessoal do comunicado de riscos (NR-1) enviado por e-mail aos trabalhadores:
    // só a página do código e o "estou ciente". Código de 256 bits; nada mais do painel abre.
    if (/^\/sst-info\/[A-Za-z0-9_-]{43}(\/ciente)?$/.test(caminho)) return next();
    // Raiz: serviços externos (como a Z-API) testam se o endereço responde. Devolve só "ok",
    // sem nenhuma informação — painel, login e dados continuam fechados.
    if (caminho === '/' || caminho === '') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('ok');
    }
    aoBloquear?.(String(ipExterno), caminho);
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ statusCode: 404, message: 'Não encontrado' }));
  };
}

/** IP real do cliente: atrás do túnel, o Cloudflare informa em cf-connecting-ip. */
export function ipReal(req: Req & { headers?: Record<string, string | string[] | undefined> }) {
  const cf = req.headers?.['cf-connecting-ip'];
  return (Array.isArray(cf) ? cf[0] : cf) ?? req.ip ?? req.socket?.remoteAddress ?? '?';
}

/**
 * Limite geral por IP (padrão 600 requisições/minuto): contém robôs e abuso
 * do webhook quando ele estiver exposto pelo túnel. Ajustável em RATE_LIMIT_PER_MIN.
 */
export function limitePorIp(aoExceder?: (ip: string) => void) {
  const limite = Number(process.env.RATE_LIMIT_PER_MIN ?? 600);
  const contagem = new Map<string, { inicio: number; n: number }>();
  setInterval(() => {
    const agora = Date.now();
    for (const [ip, c] of contagem) if (agora - c.inicio > 60_000) contagem.delete(ip);
  }, 60_000).unref();

  return (req: Req, res: Res, next: () => void) => {
    const ip = ipReal(req as Parameters<typeof ipReal>[0]);
    const agora = Date.now();
    const c = contagem.get(ip);
    if (!c || agora - c.inicio > 60_000) contagem.set(ip, { inicio: agora, n: 1 });
    else if (++c.n > limite) {
      if (c.n === limite + 1) aoExceder?.(ip); // registra uma vez por minuto, não a cada requisição
      res.statusCode = 429;
      res.setHeader('Retry-After', '60');
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ statusCode: 429, message: 'Muitas requisições. Aguarde um minuto.' }));
    }
    next();
  };
}

/**
 * Limite de tentativas de login, em memória: após 5 erros em 15 minutos para
 * o mesmo IP + e-mail (ou 20 do mesmo IP), bloqueia por 15 minutos.
 * Suficiente para uma instância única; com várias instâncias, mover para o Redis.
 */
export class LimiteDeTentativas {
  private readonly janelaMs = 15 * 60 * 1000;
  private readonly falhas = new Map<string, number[]>();

  private recentes(chave: string) {
    const agora = Date.now();
    const lista = (this.falhas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    if (lista.length) this.falhas.set(chave, lista);
    else this.falhas.delete(chave);
    return lista;
  }

  /** Minutos restantes de bloqueio, ou 0 se pode tentar. */
  bloqueio(ip: string, email: string): number {
    const porConta = this.recentes(`${ip}|${email.toLowerCase()}`);
    const porIp = this.recentes(ip);
    const lista = porConta.length >= 5 ? porConta : porIp.length >= 20 ? porIp : null;
    if (!lista) return 0;
    return Math.ceil((lista[0] + this.janelaMs - Date.now()) / 60000);
  }

  registrarFalha(ip: string, email: string) {
    const agora = Date.now();
    for (const chave of [`${ip}|${email.toLowerCase()}`, ip]) {
      this.falhas.set(chave, [...this.recentes(chave), agora]);
    }
  }

  limpar(ip: string, email: string) {
    this.falhas.delete(`${ip}|${email.toLowerCase()}`);
  }
}
