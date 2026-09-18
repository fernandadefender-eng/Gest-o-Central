import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { ehDoUsuario } from './painel.module';

/**
 * Relatório de fim de plantão: o que a operação fez entre o início e o fim do plantão
 * do Help Desk, separado em Patrimonial, Veicular e Eventos (centrais de telemetria:
 * Power, ACT, Seven, Sincro...). Mostra o total da operação e o que foi da pessoa.
 * Sem IA: só consultas no banco.
 */

/** Central de telemetria pelo nome do grupo/cliente do evento. */
export function centralDoEvento(texto: string): string {
  const t = texto.toLowerCase();
  if (/power/.test(t)) return 'Power';
  if (/\bact\b|act solu|cordenon|videira|translucas|barbieri/.test(t)) return 'ACT';
  if (/seven/.test(t)) return 'Seven';
  if (/sincro/.test(t)) return 'Sincro';
  return 'Outras centrais';
}

type Linha = { vertical: string; status: string; motivo: string | null; cliente: string; operador: string | null; qtd: number };

export async function relatorioPlantao(prisma: PrismaService, u: UsuarioLogado, deTxt?: string, ateTxt?: string) {
  const ate = ateTxt ? new Date(ateTxt) : new Date();
  const de = deTxt ? new Date(deTxt) : new Date(+ate - 12 * 3600e3);
  if (isNaN(+de) || isNaN(+ate) || de >= ate) throw new BadRequestException('Período do plantão inválido');
  if (+ate - +de > 36 * 3600e3) throw new BadRequestException('Plantão de no máximo 36 horas');
  const verts = verticaisPermitidas(u);

  const linhas = verts.length ? await prisma.$queryRaw<Linha[]>`
    SELECT a.vertical::text vertical, a.status::text status, a."motivoNaoAtendimento"::text motivo,
           coalesce(e."nomeFantasia", e."razaoSocial", c.name) cliente, a."operadorPR7" operador, count(*)::int qtd
      FROM "Atendimento" a
      JOIN "Client" c ON c.id = a."clientId"
      LEFT JOIN "Empresa" e ON e.id = a."empresaId"
     WHERE coalesce(a."solicitadoEm", a."createdAt") >= ${de} AND coalesce(a."solicitadoEm", a."createdAt") < ${ate}
       AND a.vertical::text IN (${Prisma.join(verts)})
     GROUP BY 1, 2, 3, 4, 5` : [];

  const bloco = (vertical: string) => {
    const ls = linhas.filter((l) => l.vertical === vertical);
    const soma = (f: (l: Linha) => boolean) => ls.filter(f).reduce((s, l) => s + l.qtd, 0);
    const porCliente = new Map<string, { nome: string; total: number; negativas: number; cancelados: number }>();
    for (const l of ls) {
      const k = l.cliente || '—';
      const x = porCliente.get(k) ?? { nome: k, total: 0, negativas: 0, cancelados: 0 };
      x.total += l.qtd;
      if (l.motivo === 'NEGATIVA_PRESTADOR') x.negativas += l.qtd;
      if (l.status === 'CANCELADO') x.cancelados += l.qtd;
      porCliente.set(k, x);
    }
    return {
      total: soma(() => true),
      meus: soma((l) => ehDoUsuario(l.operador, u.nome)),
      concluidos: soma((l) => l.status === 'CONCLUIDO'),
      emAndamento: soma((l) => l.status === 'NOVO' || l.status === 'EM_ANDAMENTO'),
      cancelados: soma((l) => l.status === 'CANCELADO'),
      naoAtendidos: soma((l) => l.status === 'NAO_ATENDIDO'),
      // Negativa = prestador recusou o acionamento
      negativas: soma((l) => l.motivo === 'NEGATIVA_PRESTADOR'),
      semPrestador: soma((l) => l.motivo === 'SEM_PRESTADOR_REGIAO'),
      porCliente: [...porCliente.values()].sort((a, b) => b.total - a.total),
    };
  };

  // Eventos das centrais de telemetria (só quem tem o Monitoramento / veicular)
  const eventos = verts.includes('VEICULAR') ? await prisma.$queryRaw<{ tipo: string; status: string; origem: string; meu: boolean; qtd: number }[]>`
    SELECT ev.tipo, ev.status::text status,
           coalesce((SELECT t.texto FROM "EventoTratativa" t WHERE t."eventoId" = ev.id ORDER BY t."criadoEm" LIMIT 1), '') || ' ' || coalesce(ev."clienteNome", '') origem,
           (ev."assumidoPor" = ${u.email} OR ev."encerradoPor" = ${u.email}) meu, count(*)::int qtd
      FROM "Evento" ev
     WHERE coalesce(ev."ocorridoEm", ev."recebidoEm") >= ${de} AND coalesce(ev."ocorridoEm", ev."recebidoEm") < ${ate}
     GROUP BY 1, 2, 3, 4` : [];
  const porCentral = new Map<string, number>(), porTipo = new Map<string, number>();
  for (const e of eventos) {
    const c = centralDoEvento(e.origem);
    porCentral.set(c, (porCentral.get(c) ?? 0) + e.qtd);
    porTipo.set(e.tipo, (porTipo.get(e.tipo) ?? 0) + e.qtd);
  }
  const ordenar = (m: Map<string, number>) => [...m.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);

  return {
    usuario: u.nome,
    de: de.toISOString(),
    ate: ate.toISOString(),
    patrimonial: verts.includes('PATRIMONIAL') ? bloco('PATRIMONIAL') : null,
    veicular: verts.includes('VEICULAR') ? bloco('VEICULAR') : null,
    eventos: verts.includes('VEICULAR') ? {
      total: eventos.reduce((s, e) => s + e.qtd, 0),
      tratadosPorMim: eventos.filter((e) => e.meu).reduce((s, e) => s + e.qtd, 0),
      semResponsavel: eventos.filter((e) => e.status === 'NOVO').reduce((s, e) => s + e.qtd, 0),
      porCentral: ordenar(porCentral),
      porTipo: ordenar(porTipo),
    } : null,
  };
}
