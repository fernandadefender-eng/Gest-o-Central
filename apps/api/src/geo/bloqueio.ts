import { PrismaService } from '../prisma/prisma.service';
import { normalizar, telefoneCanonico } from './normalizar';

/** Carrega a lista de bloqueio ativa para checagens em lote. */
export async function carregarBloqueio(prisma: PrismaService) {
  const itens = await prisma.restrito.findMany({ where: { ativo: true }, select: { nomeBusca: true, telefone: true, nomeCompleto: true, motivo: true } });
  // Telefone no formato único (com o 9 do celular): restrito cadastrado "43 9907-1221"
  // bloqueia também quem aparece como "43 99907-1221" — nenhuma variação escapa
  const porTelefone = new Map(itens.filter((i) => i.telefone).map((i) => [telefoneCanonico(i.telefone)!, i]));
  const porNome = new Map(itens.map((i) => [i.nomeBusca, i]));
  return {
    vazio: itens.length === 0,
    /** Bloqueado por telefone igual ou nome completo igual (sem acento/caixa). Nome de uma palavra só não bloqueia sozinho. */
    verificar(nome?: string | null, telefone?: string | null) {
      const tel = telefoneCanonico(telefone) ?? '';
      if (tel && porTelefone.has(tel)) return porTelefone.get(tel)!;
      const n = nome ? normalizar(nome) : '';
      if (n.split(' ').length >= 2 && porNome.has(n)) return porNome.get(n)!;
      return null;
    },
  };
}
