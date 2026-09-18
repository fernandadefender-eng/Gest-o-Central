import { BadRequestException, Controller, Get, Injectable, Module, Query, Req } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Protegido, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { relatorioPlantao } from './plantao';

/**
 * Painel do mês — o que o Help Desk (e demais funções sem a visão geral) enxerga:
 * só o mês corrente, com o total da operação e o total da própria pessoa, dia a dia.
 *
 *  - Atendimentos: "meus" = campo Help Desk (operadorPR7) com o nome do usuário.
 *    A planilha às vezes traz só o primeiro nome ("Laysla"), que também conta.
 *  - Monitoramento: "meus" = eventos que o usuário assumiu ou encerrou.
 *
 * Mês no horário de Brasília (UTC−3): o dia 1º começa às 03:00 UTC.
 */
const FUSO_MS = 3 * 3600e3;

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** O texto do campo Help Desk se refere a este usuário? */
export function ehDoUsuario(operador: string | null | undefined, nomeUsuario: string): boolean {
  if (!operador) return false;
  const op = normalizar(operador), nome = normalizar(nomeUsuario);
  if (!op || !nome) return false;
  if (op === nome) return true;
  // Só o primeiro nome ("Laysla") vale como a pessoa; sobrenome diferente não
  const partesOp = op.split(' '), partesNome = nome.split(' ');
  if (partesOp.length === 1) return partesOp[0] === partesNome[0];
  return partesOp[0] === partesNome[0] && partesNome.slice(1).some((p) => partesOp.includes(p));
}

function limitesDoMes(mes?: string) {
  const agoraBr = new Date(Date.now() - FUSO_MS);
  const [ano, m] = mes && /^\d{4}-\d{2}$/.test(mes) ? mes.split('-').map(Number) : [agoraBr.getUTCFullYear(), agoraBr.getUTCMonth() + 1];
  if (m < 1 || m > 12) throw new BadRequestException('Mês inválido');
  const inicio = new Date(Date.UTC(ano, m - 1, 1) + FUSO_MS);
  const fim = new Date(Date.UTC(ano, m, 1) + FUSO_MS);
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return { ano, m, inicio, fim, dias, chave: `${ano}-${String(m).padStart(2, '0')}` };
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

@Injectable()
export class PainelService {
  constructor(private readonly prisma: PrismaService) {}

  async atendimentos(u: UsuarioLogado, mes?: string) {
    const p = limitesDoMes(mes);
    const verts = verticaisPermitidas(u);
    if (!verts.length) return this.vazio(p, 'atendimentos');
    const linhas = await this.prisma.$queryRaw<{ dia: number; operador: string | null; status: string; qtd: number }[]>`
      select extract(day from (coalesce(a."solicitadoEm", a."createdAt") - interval '3 hours'))::int dia,
             a."operadorPR7" operador, a.status::text status, count(*)::int qtd
        from "Atendimento" a
       where coalesce(a."solicitadoEm", a."createdAt") >= ${p.inicio} and coalesce(a."solicitadoEm", a."createdAt") < ${p.fim}
         and a.vertical::text in (${Prisma.join(verts)})
       group by 1, 2, 3`;
    return this.montar(p, 'atendimentos', linhas.map((l) => ({ ...l, meu: ehDoUsuario(l.operador, u.nome) })));
  }

  async monitoramento(u: UsuarioLogado, mes?: string) {
    const p = limitesDoMes(mes);
    const linhas = await this.prisma.$queryRaw<{ dia: number; meu: boolean; status: string; qtd: number }[]>`
      select extract(day from (coalesce(e."ocorridoEm", e."recebidoEm") - interval '3 hours'))::int dia,
             (e."assumidoPor" = ${u.email} or e."encerradoPor" = ${u.email}) meu, e.status::text status, count(*)::int qtd
        from "Evento" e
       where coalesce(e."ocorridoEm", e."recebidoEm") >= ${p.inicio} and coalesce(e."ocorridoEm", e."recebidoEm") < ${p.fim}
         and e.vertical = 'VEICULAR'
       group by 1, 2, 3`;
    return this.montar(p, 'monitoramento', linhas);
  }

  private montar(p: ReturnType<typeof limitesDoMes>, area: string, linhas: { dia: number; meu: boolean; status: string; qtd: number }[]) {
    const dias = Array.from({ length: p.dias }, (_, i) => ({ dia: i + 1, total: 0, meus: 0 }));
    const porStatus: Record<string, { total: number; meus: number }> = {};
    let total = 0, meus = 0;
    for (const l of linhas) {
      const d = dias[l.dia - 1];
      if (!d) continue;
      d.total += l.qtd; total += l.qtd;
      const s = (porStatus[l.status] ??= { total: 0, meus: 0 });
      s.total += l.qtd;
      if (l.meu) { d.meus += l.qtd; meus += l.qtd; s.meus += l.qtd; }
    }
    return { area, mes: p.chave, rotulo: `${MESES[p.m - 1]}/${p.ano}`, total, meus, porStatus, dias };
  }

  private vazio(p: ReturnType<typeof limitesDoMes>, area: string) {
    return this.montar(p, area, []);
  }
}

// Rota fora de /painel: esse prefixo serve os arquivos do painel web
@Protegido('painel_mes')
@Controller('meu-mes')
class PainelController {
  constructor(private readonly painel: PainelService) {}

  @Get()
  mes(@Req() req: { user: UsuarioLogado }, @Query('area') area?: string, @Query('mes') mes?: string) {
    if (area === 'monitoramento') return this.painel.monitoramento(req.user, mes);
    return this.painel.atendimentos(req.user, mes);
  }
}

/** Relatório de fim de plantão (o Help Desk recebe ao encerrar o plantão / sair). */
@Protegido('atendimentos', 'monitoramento', 'painel_mes')
@Controller('plantao')
class PlantaoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('relatorio')
  relatorio(@Req() req: { user: UsuarioLogado }, @Query('de') de?: string, @Query('ate') ate?: string) {
    return relatorioPlantao(this.prisma, req.user, de, ate);
  }
}

@Module({ controllers: [PainelController, PlantaoController], providers: [PainelService] })
export class PainelModule {}
