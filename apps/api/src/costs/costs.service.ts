import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { usdToBrl } from '../classification/pricing';

@Injectable()
export class CostsService {
  constructor(private readonly prisma: PrismaService) {}

  private startOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /** Custo acumulado no mês corrente, em USD. Usado também pelo teto de gasto. */
  async currentMonthUsd(): Promise<number> {
    const result = await this.prisma.classificationRun.aggregate({
      where: { createdAt: { gte: this.startOfMonth() } },
      _sum: { costUsd: true },
    });
    return result._sum.costUsd ?? 0;
  }

  async summary() {
    const monthStart = this.startOfMonth();

    const [mes, total, atendimentosNoMes] = await Promise.all([
      this.prisma.classificationRun.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.classificationRun.aggregate({
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.atendimento.count({ where: { createdAt: { gte: monthStart } } }),
    ]);

    const mesUsd = mes._sum.costUsd ?? 0;
    const totalUsd = total._sum.costUsd ?? 0;
    const budgetUsd = Number(process.env.MONTHLY_BUDGET_USD ?? '0');

    return {
      mesAtual: {
        custoUsd: mesUsd,
        custoBrl: usdToBrl(mesUsd),
        classificacoes: mes._count,
        atendimentos: atendimentosNoMes,
        custoMedioPorAtendimentoBrl:
          atendimentosNoMes > 0 ? usdToBrl(mesUsd) / atendimentosNoMes : 0,
        tokensEntrada: mes._sum.inputTokens ?? 0,
        tokensSaida: mes._sum.outputTokens ?? 0,
      },
      acumulado: {
        custoUsd: totalUsd,
        custoBrl: usdToBrl(totalUsd),
        classificacoes: total._count,
      },
      teto: budgetUsd > 0
        ? {
            limiteUsd: budgetUsd,
            limiteBrl: usdToBrl(budgetUsd),
            percentualUsado: (mesUsd / budgetUsd) * 100,
            bloqueado: mesUsd >= budgetUsd,
          }
        : null,
    };
  }
}
