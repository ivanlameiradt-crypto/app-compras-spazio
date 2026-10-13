// Cadastro de PRODUTO NOVO pelo app (pedido do Ivan, 13/10/2026): quando o produto de um cupom, de uma nota fiscal ou de uma compra avulsa não existe na lista do app nem no
// SisChef, ele o cadastra pelo app (nome, grupo e unidade, com os mesmos parâmetros do formulário "Novo produto" do SisChef) e o robô o cria no SisChef; o app guarda o código
// novo na planilha de produtos (a lista do app). Aqui só as regras puras: sem React nem rede.

/** Os grupos de INSUMO do SisChef (Produtos/Taxas › Grupos de produto; o texto é o do SisChef, o robô escolhe o grupo por ele). Lista lida do SisChef em 13/10/2026. */
export const GRUPOS_DE_INSUMO: string[] = [
  'DESCARTAVEL E EMBALAGENS - ESTOQUE CONTROLADO', 'DESCARTAVEL E EMBALAGENS INSUMO - ESTOQUE CONTROLADO', 'ESTOQUE CONTROLADO', 'GELATO - ESTOQUE CÂMARA', 'GELATO - ESTOQUE SECO',
  'GELATO INSUMO - ESTOQ. CAMARA', 'GELATO INSUMO - ESTOQ. SECO', 'HAMBURGEURIA INSUMO - ESTOQ. CAMARA', 'HAMBURGEURIA INSUMO - ESTOQ. SECO', 'HAMBURGUERIA - ESTOQUE CÂMARA',
  'HAMBURGUERIA - ESTOQUE SECO', 'HORTIFRUT - INSUMOS CONTROLADOS', 'INSUMO - ESTOQUE CONTROLADO', 'INSUMOS PRODUTOS - HORTIFRUTI', 'INSUMOS PRODUTOS MANUTENÇÃO - GERAL',
  'INSUMOS SETORES - CAMARA', 'KUKAN - ESTOQUE CÂMARA', 'KUKAN - ESTOQUE SECO', 'KUKAN INSUMO - ESTOQ. CAMARA', 'KUKAN INSUMO - ESTOQ. SECO', 'PIZZARIA - ESTOQUE CÂMARA',
  'PIZZARIA - ESTOQUE SECO', 'PIZZARIA INSUMO - ESTOQ. CAMARA', 'PIZZARIA INSUMO - ESTOQ. SECO', 'PRODUÇÃO - ESTOQUE CÂMARA', 'PRODUÇAO ESTOQUE  - SECO',
  'PRODUÇÃO INSUMO - ESTOQ. CAMARA', 'PRODUÇÃO INSUMO - ESTOQ. SECO',
]

/** As unidades que um insumo usa (o texto é o da lista "Unidade de medida" do SisChef; o robô escolhe pela sigla). */
export const UNIDADES: { sigla: string; rotulo: string }[] = [
  { sigla: 'UN', rotulo: 'UN — unidade' }, { sigla: 'KG', rotulo: 'KG — quilograma' }, { sigla: 'L', rotulo: 'L — litro' }, { sigla: 'ML', rotulo: 'ML — mililitro' },
  { sigla: 'G', rotulo: 'G — grama' }, { sigla: 'PCT', rotulo: 'PCT — pacote' }, { sigla: 'CX', rotulo: 'CX — caixa' }, { sigla: 'FD', rotulo: 'FD — fardo' },
  { sigla: 'SC', rotulo: 'SC — saco' }, { sigla: 'PC', rotulo: 'PC — peça' }, { sigla: 'LT', rotulo: 'LT — lata' }, { sigla: 'GR', rotulo: 'GR — garrafa' },
]

const SUFIXO = ' - INSUMOS'

/** O nome como o SisChef vai guardar: sem o "CÓD. FOR: 123" da nota, em MAIÚSCULAS, espaços colapsados, terminado em " - INSUMOS" (o padrão dos insumos do Ivan). */
export function nomeNoSischef(texto: string | null | undefined): string {
  const t = String(texto ?? '').replace(/^\s*c[oó]d\.?\s*for\.?:?\s*\S+\s*(?:##\s*)?/i, '').replace(/\s+/g, ' ').trim().toUpperCase()
  if (t === '') return ''
  return /-\s*INSUMOS?\b/.test(t) ? t : `${t}${SUFIXO}`
}

/**
 * A unidade que o nome sugere (o Ivan confirma; a regra de nunca chutar vale: é só o ponto de partida): peso na embalagem ("1X3Kg", "(KG)", "500 g" de produto a granel) → KG;
 * volume em litros ("1,5 L", "LITRO") → L; qualquer outro caso (inclusive bebida em ML) → UN.
 */
export function sugerirUnidade(texto: string | null | undefined): string {
  const t = String(texto ?? '').toLowerCase()
  if (/(\d|\))\s*kg\b|\(kg\)|\bkg\b|quilo/.test(t)) return 'KG'
  if (/\d\s*(l|lt|litros?)\b(?!\w)/.test(t) && !/\d\s*ml\b/.test(t)) return 'L'
  return 'UN'
}

/** As palavras do nome que viram palavra-chave de busca (sem o "- INSUMOS", sem medidas soltas, até 6). O Ivan pode editar. */
export function palavrasSugeridas(texto: string | null | undefined): string {
  const t = nomeNoSischef(texto).replace(SUFIXO, '').toLowerCase()
  const ruins = new Set(['de', 'da', 'do', 'com', 'para', 'p', 'c', 'insumo', 'insumos'])
  return [...new Set(t.split(/[^a-z0-9áàâãéêíóôõúç]+/i).filter((w) => w.length >= 3 && !/^\d+(x|g|kg|ml|l)?$/.test(w) && !ruins.has(w)))].slice(0, 6).join(' ')
}

export interface DadosProduto { nome: string; grupo: string; unidade: string; palavras: string }

/** O que falta no formulário, em português (null = pronto). Grupo e unidade são escolhas do Ivan: nunca assumidas. */
export function problemaDoProduto(d: DadosProduto): string | null {
  if (nomeNoSischef(d.nome) === '') return 'Digite o nome do produto.'
  if (d.nome.trim().length > 120) return 'O nome está grande demais (máximo 120 letras).'
  if (!GRUPOS_DE_INSUMO.includes(d.grupo)) return 'Escolha o grupo do SisChef.'
  if (!UNIDADES.some((u) => u.sigla === d.unidade)) return 'Escolha a unidade.'
  return null
}

export type EstadoProduto = 'PENDENTE' | 'PROCESSANDO' | 'CADASTRADO' | 'JA_EXISTIA' | 'REVISAR'
export const PRODUTO_PRONTO = (e: EstadoProduto | null | undefined): boolean => e === 'CADASTRADO' || e === 'JA_EXISTIA'
