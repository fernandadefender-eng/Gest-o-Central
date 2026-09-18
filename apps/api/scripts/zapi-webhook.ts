/**
 * Configura e confere o webhook da Z-API pela API dela.
 *
 * Faz SOMENTE: consultar status da instância, apontar o webhook "Ao receber"
 * e ligar "notificar enviadas por mim". Não existe aqui (nem em lugar nenhum do
 * sistema) chamada de envio de mensagem.
 *
 * Chaves no apps/api/.env (preenchidas pelo usuário, nunca no chat):
 *   ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN (só se o "Token de segurança da conta" estiver ativo)
 *
 * Uso:
 *   npx ts-node -T scripts/zapi-webhook.ts status
 *   npx ts-node -T scripts/zapi-webhook.ts configurar https://SEU-TUNEL.trycloudflare.com
 */
import 'dotenv/config';

const id = process.env.ZAPI_INSTANCE_ID?.trim();
const token = process.env.ZAPI_INSTANCE_TOKEN?.trim();
const clientToken = process.env.ZAPI_CLIENT_TOKEN?.trim();
const webhookToken = process.env.WEBHOOK_TOKEN?.trim();

if (!id || !token) {
  console.error('Faltam ZAPI_INSTANCE_ID e/ou ZAPI_INSTANCE_TOKEN no apps/api/.env');
  process.exit(1);
}

const base = `https://api.z-api.io/instances/${id}/token/${token}`;
// Nunca imprime as chaves: só os 4 últimos caracteres do ID, para conferência
const mascara = (s: string) => `…${s.slice(-4)}`;

async function chamar(metodo: 'GET' | 'PUT', caminho: string, corpo?: unknown) {
  const res = await fetch(`${base}/${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(clientToken ? { 'Client-Token': clientToken } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let json: unknown = texto;
  try { json = JSON.parse(texto); } catch { /* resposta em texto */ }
  return { status: res.status, json };
}

async function main() {
  const [acao, tunel] = process.argv.slice(2);
  console.log(`Instância ${mascara(id!)} · Client-Token ${clientToken ? 'informado' : 'não informado'}`);

  const st = await chamar('GET', 'status');
  console.log(`status (${st.status}):`, JSON.stringify(st.json));
  if (st.status === 401 || st.status === 403) {
    console.log('→ Z-API recusou as chaves. Se o "Token de segurança da conta" estiver ativo, preencha ZAPI_CLIENT_TOKEN.');
    return;
  }

  if (acao === 'configurar') {
    if (!tunel?.startsWith('https://')) throw new Error('Informe o endereço do túnel (https://...)');
    if (!webhookToken) throw new Error('WEBHOOK_TOKEN ausente no .env');
    const url = `${tunel.replace(/\/+$/, '')}/webhooks/whatsapp?token=${webhookToken}`;
    const r1 = await chamar('PUT', 'update-webhook-received', { value: url });
    console.log(`webhook "Ao receber" (${r1.status}):`, JSON.stringify(r1.json));
    const r2 = await chamar('PUT', 'update-notify-sent-by-me', { notifySentByMe: true });
    console.log(`notificar enviadas por mim (${r2.status}):`, JSON.stringify(r2.json));
  }
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
