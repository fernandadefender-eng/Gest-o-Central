import { Controller, Get, Injectable, Module, Query, Req } from '@nestjs/common';
import { AtendimentoStatus, Prisma, Vertical } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Protegido, temPermissao, UsuarioLogado, verticaisPermitidas } from '../auth/permissoes';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRO_UF } from '../mapa/estados';

class FiltroBiDto {
  @IsOptional() @IsString() @Length(2, 2) uf?: string;
  @IsOptional() @IsString() categoria?: string;
  @IsOptional() @IsEnum(AtendimentoStatus) status?: AtendimentoStatus;
  @IsOptional() @IsString() operador?: string;
  @IsOptional() @IsUUID() clienteId?: string;
  @IsOptional() @IsUUID() prestadorId?: string;
  @IsOptional() @IsEnum(Vertical) vertical?: Vertical;
  @IsOptional() @IsDateString() de?: string;
  @IsOptional() @IsDateString() ate?: string;
}

type Dimensao = 'uf' | 'categoria' | 'status' | 'operador' | 'clienteId' | 'prestadorId';
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/**
 * Agregações do painel BI numa única chamada. Estilo Power BI: cada gráfico
 * ignora o próprio filtro (o mapa continua mostrando todos os estados quando
 * um estado está selecionado, só destacando o escolhido).
 */
@Injectable()
class BiService {
  constructor(private readonly prisma: PrismaService) {}

  // Veicular não tem Conta: cidade/UF ficam em detalhes (JSON)
  private readonly UF = Prisma.sql`upper(coalesce(ct.estado, a.detalhes->>'estado'))`;
  private readonly CIDADE = Prisma.sql`coalesce(ct.cidade, a.detalhes->>'cidade')`;

  private where(f: FiltroBiDto, verticais: Vertical[], ignorar?: Dimensao) {
    // Restrição de acesso: nunca consulta vertical não liberada ao usuário
    const c: Prisma.Sql[] = [verticais.length ? Prisma.sql`a.vertical::text IN (${Prisma.join(verticais)})` : Prisma.sql`FALSE`];
    if (f.uf && ignorar !== 'uf') c.push(Prisma.sql`${this.UF} = ${f.uf.toUpperCase()}`);
    if (f.categoria && ignorar !== 'categoria') c.push(Prisma.sql`a.category = ${f.categoria}`);
    if (f.status && ignorar !== 'status') c.push(Prisma.sql`a.status::text = ${f.status}`);
    if (f.operador && ignorar !== 'operador') c.push(Prisma.sql`a."operadorPR7" = ${f.operador}`);
    if (f.clienteId && ignorar !== 'clienteId') c.push(Prisma.sql`a."clientId" = ${f.clienteId}`);
    if (f.prestadorId && ignorar !== 'prestadorId') c.push(Prisma.sql`a."providerId" = ${f.prestadorId}`);
    if (f.de) c.push(Prisma.sql`a."createdAt" >= ${new Date(f.de)}`);
    if (f.ate) c.push(Prisma.sql`a."createdAt" < ${new Date(f.ate)}`);
    return Prisma.sql`FROM "Atendimento" a
      LEFT JOIN "Conta" ct ON ct.id = a."contaId"
      LEFT JOIN "Client" cl ON cl.id = a."clientId"
      LEFT JOIN "Provider" p ON p.id = a."providerId"
      WHERE ${Prisma.join(c, ' AND ')}`;
  }

  async visaoGeral(f: FiltroBiDto, u: UsuarioLogado) {
    const v = verticaisPermitidas(u, f.vertical);
    const verValores = temPermissao(u, 'valores');
    const q = <T>(sql: Prisma.Sql) => this.prisma.$queryRaw<T[]>(sql);
    const [kpi] = await q<Record<string, bigint | Date>>(Prisma.sql`
      SELECT count(*) total,
             count(*) FILTER (WHERE a.status = 'CONCLUIDO') concluidos,
             count(*) FILTER (WHERE a.status IN ('NOVO','EM_ANDAMENTO')) abertos,
             count(DISTINCT a."clientId") clientes,
             count(DISTINCT a."contaId") estabelecimentos,
             count(DISTINCT a."providerId") prestadores,
             count(DISTINCT lower(${this.CIDADE}) || ${this.UF}) cidades,
             count(DISTINCT ${this.UF}) estados,
             count(*) FILTER (WHERE a.vertical = 'PATRIMONIAL') patrimonial,
             count(*) FILTER (WHERE a.vertical = 'VEICULAR') veicular,
             coalesce(sum(a."valorPrestador"), 0) "valorPrestador",
             coalesce(sum(a."valorCliente"), 0) "valorCliente"
      ${this.where(f, v)}`);

    const [mensal, status, categorias, estados, cidades, clientes, operadores, prestadores, semana] = await Promise.all([
      q<{ mes: string; total: bigint; concluidos: bigint; valor: unknown }>(Prisma.sql`
        SELECT to_char(date_trunc('month', coalesce(a."solicitadoEm", a."concluidoEm", a."createdAt")), 'YYYY-MM') mes, count(*) total,
               count(*) FILTER (WHERE a.status = 'CONCLUIDO') concluidos,
               coalesce(sum(a."valorPrestador"), 0) valor
        ${this.where(f, v)} AND coalesce(a.detalhes->>'semData', 'nao') <> 'true' GROUP BY 1 ORDER BY 1`),
      q<{ nome: string; q: bigint }>(Prisma.sql`SELECT a.status::text nome, count(*) q ${this.where(f, v, 'status')} GROUP BY 1`),
      q<{ nome: string; q: bigint }>(Prisma.sql`
        SELECT coalesce(a.category, 'Sem categoria') nome, count(*) q ${this.where(f, v, 'categoria')} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q<{ nome: string; q: bigint }>(Prisma.sql`
        SELECT ${this.UF} nome, count(*) q ${this.where(f, v, 'uf')} AND ${this.UF} IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
      q<{ nome: string; uf: string; q: bigint }>(Prisma.sql`
        SELECT min(${this.CIDADE}) nome, ${this.UF} uf, count(*) q ${this.where(f, v)} AND ${this.CIDADE} <> ''
        GROUP BY lower(${this.CIDADE}), ${this.UF} ORDER BY 3 DESC LIMIT 8`),
      q<{ id: string; nome: string; q: bigint }>(Prisma.sql`
        SELECT cl.id, cl.name nome, count(*) q ${this.where(f, v, 'clienteId')} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`),
      q<{ nome: string; q: bigint }>(Prisma.sql`
        SELECT a."operadorPR7" nome, count(*) q ${this.where(f, v, 'operador')} AND coalesce(a."operadorPR7", '') <> ''
        GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
      q<{ id: string; nome: string; tipo: string; q: bigint; valor: unknown }>(Prisma.sql`
        SELECT p.id, p.name nome, p.tipo::text tipo, count(*) q, coalesce(sum(a."valorPrestador"), 0) valor ${this.where(f, v, 'prestadorId')} AND p.id IS NOT NULL
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 8`),
      q<{ mes: string; dow: number; q: bigint }>(Prisma.sql`
        SELECT to_char(date_trunc('month', a."createdAt"), 'YYYY-MM') mes, extract(dow FROM a."createdAt")::int dow, count(*) q
        ${this.where(f, v)} GROUP BY 1, 2`),
    ]);

    const lista = <T extends { q: bigint }>(rows: T[]) => rows.map((r) => ({ ...r, q: num(r.q) }));
    // Sem permissão "valores": os campos financeiros nem saem do servidor
    const semValor = <T extends Record<string, unknown>>(o: T) => {
      if (verValores) return o;
      const { valor: _v, valorPrestador: _p, valorCliente: _c, ...resto } = o as Record<string, unknown>;
      return resto as T;
    };
    return {
      verValores,
      kpis: semValor(Object.fromEntries(Object.entries(kpi).map(([k, val]) => [k, num(val as unknown as bigint)]))),
      mensal: mensal.map((m) => semValor({ mes: m.mes, total: num(m.total), concluidos: num(m.concluidos), valor: Number(m.valor ?? 0) })),
      status: lista(status),
      categorias: lista(categorias),
      estados: lista(estados).filter((e) => CENTRO_UF[e.nome]).map((e) => ({ ...e, estado: CENTRO_UF[e.nome].nome })),
      cidades: lista(cidades),
      clientes: lista(clientes),
      operadores: lista(operadores),
      prestadores: lista(prestadores).map((p) => semValor({ ...p, valor: Number(p.valor ?? 0) })),
      semana: lista(semana),
      geradoEm: new Date().toISOString(),
    };
  }
}

@Protegido('visao_geral')
@Controller('bi')
class BiController {
  constructor(private readonly bi: BiService) {}

  @Get('visao-geral')
  visaoGeral(@Query() filtro: FiltroBiDto, @Req() req: { user: UsuarioLogado }) {
    return this.bi.visaoGeral(filtro, req.user);
  }
}

@Module({ controllers: [BiController], providers: [BiService] })
export class BiModule {}
