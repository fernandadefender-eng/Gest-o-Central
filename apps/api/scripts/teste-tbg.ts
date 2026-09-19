/** Testes do helper de valor acordado TBG. npx ts-node -T scripts/teste-tbg.ts */
import { ehPontoTbg, valorAcordadoTbg, ConfigTbg } from '../src/pagamentos/tbg';

let ok = 0, fail = 0;
const check = (nome: string, cond: boolean) => { if (cond) { ok++; } else { fail++; console.log('  FALHOU:', nome); } };

const cfg: ConfigTbg = {
  clienteValorFixo: 350,
  regraCamiseta: 'branca',
  apoios: [
    { nome: 'Adriano Silva', telefone: '4184717437', cpf: '', ponto: 'TBG Araucária', conta: '', cidade: 'Araucária', uf: 'PR', camisa: 'Enviar', atende: 'sim', valorAcordado: 70, obs: '' },
    { nome: 'Arthur Henrique', telefone: '4796599314', cpf: '', ponto: 'TBG Biguaçu', conta: '', cidade: 'Biguaçu', uf: 'SC', camisa: 'ok', atende: 'sim', valorAcordado: 150, obs: '' },
    { nome: 'Sem Valor', telefone: '11999999999', cpf: '', ponto: 'TBG X', conta: '', cidade: '', uf: '', camisa: 'ok', atende: 'sim', valorAcordado: null, obs: '' },
  ],
};

// ehPontoTbg
check('detecta TBG no estabelecimento', ehPontoTbg('TBG Araucária', null, 'Segurpro'));
check('detecta TBG no summary', ehPontoTbg(null, 'vistoria no ponto tbg campo grande', null));
check('não confunde outro ponto', !ehPontoTbg('Posto Fonseca', 'vistoria comum', 'Segurpro'));

// casa por telefone
const porTel = valorAcordadoTbg(cfg, { name: 'Adriano da Silva Souza', phone: '(41) 8471-7437' });
check('casa por telefone e traz R$70', porTel?.valor === 70);

// casa por nome
const porNome = valorAcordadoTbg(cfg, { name: 'Arthur Henrique', phone: '' });
check('casa por nome e traz R$150', porNome?.valor === 150);

// apoio sem valor não casa
const semValor = valorAcordadoTbg(cfg, { name: 'Sem Valor', phone: '11999999999' });
check('apoio sem valor acordado retorna null', semValor === null);

// desconhecido não casa
const desconhecido = valorAcordadoTbg(cfg, { name: 'Fulano de Tal', phone: '11888887777' });
check('prestador fora da tabela retorna null', desconhecido === null);

// config vazia
check('config nula retorna null', valorAcordadoTbg(null, { name: 'Adriano Silva', phone: '4184717437' }) === null);

console.log(`\nTBG: ${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
