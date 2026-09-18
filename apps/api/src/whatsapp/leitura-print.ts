/**
 * Leitura da print do pedido (a tela da central que o cliente cola no grupo).
 *
 * O texto da mensagem quase nunca diz de qual ocorrência é a foto ("pode deslocar?"),
 * e duas solicitações podem chegar no mesmo horário — só a imagem tem o número da
 * ocorrência, o estabelecimento, a conta e o endereço, que o fechamento exige.
 *
 * Custo: uma chamada de visão por print (Haiku). Ligar com LER_PRINT_PEDIDO=true.
 */
import Anthropic from '@anthropic-ai/sdk';

export type PrintDoPedido = {
  ocorrencia?: string;
  estabelecimento?: string;
  cliente?: string;
  conta?: string;
  endereco?: string;
  cidade?: string;
  uf?: string;
  evento?: string;
  validacao?: string;
  sap?: string;
};

const FERRAMENTA = {
  name: 'registrar_print',
  description: 'Anota o que está escrito na tela da central. Campo que não aparece: deixe fora. Se a imagem não for uma tela de ocorrência, devolva tudo vazio.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ocorrencia: { type: 'string', description: 'Número da ocorrência (ex: 33730585), só dígitos' },
      estabelecimento: { type: 'string', description: 'Nome do local/loja como está na tela' },
      cliente: { type: 'string', description: 'Empresa/grupo dono da conta' },
      conta: { type: 'string', description: 'Código da conta (ex: 1FBE, 198D)' },
      endereco: { type: 'string' },
      cidade: { type: 'string' },
      uf: { type: 'string', description: 'Sigla de 2 letras' },
      evento: { type: 'string', description: 'Evento do alarme (ex: Disparo, Painel violado, Iminência)' },
      validacao: { type: 'string', description: 'Código de validação, se aparecer' },
      sap: { type: 'string', description: 'Número SAP, se aparecer' },
    },
    required: [],
  },
};

const TIPOS_OK = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

export function ehImagemSuportada(mime?: string | null): mime is (typeof TIPOS_OK)[number] {
  return !!mime && (TIPOS_OK as readonly string[]).includes(mime);
}

export async function lerPrintDoPedido(
  anthropic: Anthropic,
  model: string,
  imagemBase64: string,
  mimeType: (typeof TIPOS_OK)[number],
): Promise<{ dados: PrintDoPedido | null; usage: { input_tokens: number; output_tokens: number } }> {
  const resposta = await anthropic.messages.create({
    model,
    max_tokens: 400,
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: FERRAMENTA.name },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imagemBase64 } },
          { type: 'text', text: 'Print da tela de monitoramento colada no grupo. Anote os dados da ocorrência.' },
        ],
      },
    ],
  });
  const bloco = resposta.content.find((c) => c.type === 'tool_use');
  const usage = { input_tokens: resposta.usage.input_tokens, output_tokens: resposta.usage.output_tokens };
  if (!bloco || bloco.type !== 'tool_use') return { dados: null, usage };
  const bruto = bloco.input as PrintDoPedido;
  const limpo: PrintDoPedido = {
    ocorrencia: bruto.ocorrencia?.replace(/\D/g, '') || undefined,
    estabelecimento: bruto.estabelecimento?.trim() || undefined,
    cliente: bruto.cliente?.trim() || undefined,
    conta: bruto.conta?.replace(/^#/, '').trim() || undefined,
    endereco: bruto.endereco?.trim() || undefined,
    cidade: bruto.cidade?.trim() || undefined,
    uf: /^[A-Za-z]{2}$/.test(bruto.uf ?? '') ? bruto.uf!.toUpperCase() : undefined,
    evento: bruto.evento?.trim() || undefined,
    validacao: bruto.validacao?.trim() || undefined,
    sap: bruto.sap?.trim() || undefined,
  };
  const temAlgo = Object.values(limpo).some(Boolean);
  return { dados: temAlgo ? limpo : null, usage };
}

/** Linha que entra na transcrição da IA no lugar de "[Foto] pode deslocar?" */
export function descreverPrint(p: PrintDoPedido): string {
  const partes = [
    p.ocorrencia && `ocorrência ${p.ocorrencia}`,
    p.estabelecimento && `estabelecimento ${p.estabelecimento}`,
    p.cliente && p.cliente !== p.estabelecimento && `cliente ${p.cliente}`,
    p.conta && `conta ${p.conta}`,
    p.evento && `evento ${p.evento}`,
    p.endereco && `endereço ${p.endereco}`,
    p.cidade && `${p.cidade}${p.uf ? '/' + p.uf : ''}`,
    p.validacao && `validação ${p.validacao}`,
    p.sap && `SAP ${p.sap}`,
  ].filter(Boolean);
  return partes.length ? `[Print do pedido: ${partes.join(' · ')}]` : '';
}
