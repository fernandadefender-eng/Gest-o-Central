/**
 * Junta cadastros duplicados de prestador — SÓ quando é certo que é a mesma pessoa:
 *  A) mesmo nome e mesmo telefone escrito de jeitos diferentes (com/sem o 9 do celular);
 *  B) mesmo nome, um dos números sem DDD e os 8 últimos dígitos iguais a UM outro;
 *  C) mesmo NOME COMPLETO, cópia "sem telefone" e existe UMA só pessoa com telefone com esse nome.
 * Nome igual com telefones realmente diferentes (ex: dois "Alan" em estados diferentes)
 * NÃO é juntado — fica na lista para a operação confirmar.
 *
 * Nada se perde: atendimentos, negativas, pagamentos, SAC, agentes e áreas passam para o
 * cadastro que fica; restrição de qualquer cópia vale para o cadastro final.
 *   npx ts-node -T scripts/unificar-prestadores.ts [--aplicar]
 */
import { PrismaClient, ProviderStatus } from '@prisma/client';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { telefoneCanonico } from '../src/geo/normalizar';

const prisma = new PrismaClient();
const chaveNome = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const semTelefone = (p: string) => p.startsWith('sem-telefone');
// Nome "bonito": prefere o que não está todo em maiúsculas
const melhorNome = (a: string, b: string) => (a === a.toUpperCase() && b !== b.toUpperCase() ? b : a);

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const todos = await prisma.provider.findMany({ select: { id: true, name: true, apelido: true, phone: true, email: true, status: true, motivoRestricao: true, restritoEm: true, restritoPor: true, ultimoAtendimento: true, regimePagamento: true, cidadeBase: true, estadoBase: true, _count: { select: { atendimentos: true } } } });
  const grupos = new Map<string, typeof todos>();
  for (const p of todos) {
    if (/^\(sem nome\)$/i.test(p.name.trim())) continue;
    const k = chaveNome(p.name);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  }

  const fusoes: { alvo: (typeof todos)[number]; origens: (typeof todos)[number][]; regra: string }[] = [];
  const paraRevisar: string[] = [];
  for (const [, ps] of grupos) {
    if (ps.length < 2) continue;
    // Agrupa por pessoa: telefone canônico igual, ou mesmo final de 8 dígitos (número sem DDD)
    const comTel = ps.filter((p) => !semTelefone(p.phone));
    const pessoas: (typeof todos)[] = [];
    for (const p of comTel.sort((a, b) => b.phone.length - a.phone.length)) {
      const can = telefoneCanonico(p.phone) ?? p.phone;
      const fim8 = can.slice(-8);
      const alvo = pessoas.find((grupo) => grupo.some((q) => {
        const cq = telefoneCanonico(q.phone) ?? q.phone;
        if (cq === can) return true;
        // Sem DDD (8–9 dígitos): mesmo final a um número completo
        return (can.length <= 9 || cq.length <= 9) && cq.slice(-8) === fim8;
      }));
      if (alvo) alvo.push(p); else pessoas.push([p]);
    }
    const semTel = ps.filter((p) => semTelefone(p.phone));
    for (const grupo of pessoas) {
      if (grupo.length < 2) continue;
      const alvo = [...grupo].sort((a, b) => b._count.atendimentos - a._count.atendimentos)[0];
      fusoes.push({ alvo, origens: grupo.filter((p) => p.id !== alvo.id), regra: 'mesmo telefone (com/sem 9 ou DDD)' });
    }
    // Juntar pelo NOME só vale com nome e sobrenome ("Antonio" sozinho pode ser outra pessoa)
    const nomeCompleto = ps[0].name.trim().split(/\s+/).filter((x) => x.length > 1).length >= 2;
    if (semTel.length && !nomeCompleto) paraRevisar.push(`${ps[0].name}: ${semTel.length} cópia(s) sem telefone — nome sem sobrenome, não juntado`);
    else if (semTel.length) {
      if (pessoas.length === 1) {
        const alvo = [...pessoas[0]].sort((a, b) => b._count.atendimentos - a._count.atendimentos)[0];
        const ja = fusoes.find((f) => f.alvo.id === alvo.id);
        if (ja) ja.origens.push(...semTel); else fusoes.push({ alvo, origens: semTel, regra: 'cópia sem telefone' });
      } else if (pessoas.length === 0 && semTel.length > 1) {
        const alvo = [...semTel].sort((a, b) => b._count.atendimentos - a._count.atendimentos)[0];
        fusoes.push({ alvo, origens: semTel.filter((p) => p.id !== alvo.id), regra: 'cópias sem telefone' });
      } else {
        paraRevisar.push(`${ps[0].name}: ${semTel.length} sem telefone + ${pessoas.length} pessoas com telefones diferentes`);
      }
    }
    if (pessoas.length > 1) paraRevisar.push(`${ps[0].name}: ${pessoas.map((g) => `${telefoneCanonico(g[0].phone)} (${g[0].cidadeBase ?? '?'}/${g[0].estadoBase ?? '?'} · ${g.reduce((s, x) => s + x._count.atendimentos, 0)} atend.)`).join(' | ')}`);
  }

  const cadastrosRemovidos = fusoes.reduce((s, f) => s + f.origens.length, 0);
  console.log(`grupos a juntar: ${fusoes.length} · cadastros duplicados que somem: ${cadastrosRemovidos} · nomes para a operação revisar: ${paraRevisar.length}`);
  for (const f of fusoes.slice(0, 12)) console.log(`  ${f.alvo.name} (${telefoneCanonico(f.alvo.phone) ?? f.alvo.phone}) ← ${f.origens.map((o) => o.phone.replace(/^sem-telefone:.*/, 'sem telefone')).join(', ')} · ${f.regra}`);
  if (fusoes.length > 12) console.log(`  ... e mais ${fusoes.length - 12}`);

  const log: string[] = ['alvo;telefone_final;juntados;regra'];
  if (aplicar) {
    for (const f of fusoes) {
      const ids = f.origens.map((o) => o.id);
      const restrito = [f.alvo, ...f.origens].find((p) => p.status === ProviderStatus.RESTRITO);
      await prisma.$transaction(async (tx) => {
        await tx.atendimento.updateMany({ where: { providerId: { in: ids } }, data: { providerId: f.alvo.id } });
        await tx.atendimento.updateMany({ where: { recusadoPorId: { in: ids } }, data: { recusadoPorId: f.alvo.id } });
        await tx.pagamento.updateMany({ where: { providerId: { in: ids } }, data: { providerId: f.alvo.id } });
        await tx.chamadoSac.updateMany({ where: { providerId: { in: ids } }, data: { providerId: f.alvo.id } });
        // Agentes: mesmo nome soma; o resto muda de equipe
        for (const m of await tx.providerMembro.findMany({ where: { providerId: { in: ids } } })) {
          const igual = await tx.providerMembro.findUnique({ where: { providerId_nome: { providerId: f.alvo.id, nome: m.nome } } });
          if (igual) {
            await tx.providerMembro.update({ where: { id: igual.id }, data: {
              atendimentos: igual.atendimentos + m.atendimentos, telefone: igual.telefone ?? m.telefone, nomeCompleto: igual.nomeCompleto ?? m.nomeCompleto,
              apelido: igual.apelido ?? m.apelido, email: igual.email ?? m.email,
              ...(m.restrito && !igual.restrito ? { restrito: true, motivoRestricao: m.motivoRestricao, restritoEm: m.restritoEm, restritoPor: m.restritoPor } : {}),
            } });
            await tx.providerMembro.delete({ where: { id: m.id } });
          } else await tx.providerMembro.update({ where: { id: m.id }, data: { providerId: f.alvo.id } });
        }
        // Áreas: mesma cidade soma
        for (const a of await tx.providerArea.findMany({ where: { providerId: { in: ids } } })) {
          const igual = await tx.providerArea.findUnique({ where: { providerId_cidade_estado: { providerId: f.alvo.id, cidade: a.cidade, estado: a.estado } } });
          if (igual) {
            await tx.providerArea.update({ where: { id: igual.id }, data: { atendimentos: igual.atendimentos + a.atendimentos, ultimoAtendimento: [igual.ultimoAtendimento, a.ultimoAtendimento].filter(Boolean).sort().at(-1) ?? null } });
            await tx.providerArea.delete({ where: { id: a.id } });
          } else await tx.providerArea.update({ where: { id: a.id }, data: { providerId: f.alvo.id } });
        }
        const ultimo = [f.alvo, ...f.origens].map((p) => p.ultimoAtendimento).filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;
        const nome = [f.alvo, ...f.origens].reduce((n, p) => melhorNome(n, p.name), f.alvo.name);
        await tx.provider.deleteMany({ where: { id: { in: ids } } });
        const telFinal = semTelefone(f.alvo.phone) ? f.alvo.phone : telefoneCanonico(f.alvo.phone) ?? f.alvo.phone;
        const ocupado = telFinal !== f.alvo.phone && (await tx.provider.findUnique({ where: { phone: telFinal } }));
        await tx.provider.update({
          where: { id: f.alvo.id },
          data: {
            name: nome, ultimoAtendimento: ultimo, ...(ocupado ? {} : { phone: telFinal }),
            apelido: f.alvo.apelido ?? f.origens.find((o) => o.apelido)?.apelido ?? null,
            email: f.alvo.email ?? f.origens.find((o) => o.email)?.email ?? null,
            regimePagamento: f.alvo.regimePagamento ?? f.origens.find((o) => o.regimePagamento)?.regimePagamento ?? null,
            ...(restrito ? { status: ProviderStatus.RESTRITO, motivoRestricao: restrito.motivoRestricao, restritoEm: restrito.restritoEm, restritoPor: restrito.restritoPor } : {}),
          },
        });
      }, { timeout: 60_000 });
      log.push(`${f.alvo.name};${telefoneCanonico(f.alvo.phone) ?? f.alvo.phone};${f.origens.length};${f.regra}`);
    }
    await prisma.eventoSeguranca.create({ data: { tipo: 'CADASTRO_ALTERADO', usuario: 'revisão de duplicidades', detalhe: `prestadores: ${fusoes.length} grupos juntados, ${cadastrosRemovidos} cadastros duplicados removidos (dados movidos para o cadastro que ficou)` } });
    // Lista local (pasta logs/, fora do git) para conferência
    writeFileSync(join(__dirname, '..', '..', '..', 'logs', 'prestadores-unificados-2026-09-18.csv'), log.join('\n'));
    writeFileSync(join(__dirname, '..', '..', '..', 'logs', 'prestadores-para-revisar-2026-09-18.txt'), paraRevisar.join('\n'));
  }
  // Telefones que ficaram no formato antigo (sem o 9) em cadastros que não tinham duplicata
  const antigos = (await prisma.provider.findMany({ select: { id: true, phone: true } })).filter((p) => !semTelefone(p.phone) && telefoneCanonico(p.phone) !== p.phone && (telefoneCanonico(p.phone) ?? '').length === 11);
  console.log(`\ntelefones de celular sem o 9 (outros cadastros): ${antigos.length}`);
  if (aplicar) {
    let ajustados = 0;
    for (const p of antigos) {
      const c = telefoneCanonico(p.phone)!;
      if (await prisma.provider.findUnique({ where: { phone: c } })) continue;
      await prisma.provider.update({ where: { id: p.id }, data: { phone: c } });
      ajustados++;
    }
    console.log(`ajustados para o formato com 9: ${ajustados}`);
  }
  console.log(aplicar ? '\nAplicado. Listas em logs/prestadores-*.csv/.txt' : '\n(simulação — rode com --aplicar)');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
