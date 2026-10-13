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

/** As unidades que a lista de produtos do app aceita (planilha: KG ou UN; a regra do Ivan é que a unidade do banco manda). O robô escolhe a unidade no SisChef pela sigla. */
export const UNIDADES: { sigla: 'KG' | 'UN'; rotulo: string }[] = [
  { sigla: 'UN', rotulo: 'UN — unidade' }, { sigla: 'KG', rotulo: 'KG — quilograma' },
]

const SUFIXO = ' - INSUMOS'

/** O nome como o SisChef vai guardar: sem o "CÓD. FOR: 123" da nota, em MAIÚSCULAS, espaços colapsados, terminado em " - INSUMOS" (o padrão dos insumos do Ivan). */
export function nomeNoSischef(texto: string | null | undefined): string {
  const t = String(texto ?? '').replace(/^\s*c[oó]d\.?\s*for\.?:?\s*\S+\s*(?:##\s*)?/i, '').replace(/\s+/g, ' ').trim().toUpperCase()
  if (t === '') return ''
  return /-\s*INSUMOS?\b/.test(t) ? t : `${t}${SUFIXO}`
}

/**
 * A unidade que o nome sugere (o Ivan escolhe; a regra de nunca chutar vale: é só uma dica ao lado do campo, o campo começa vazio): peso na embalagem ("1X3Kg", "(KG)") → KG;
 * qualquer outro caso (volume, gramas, bebida) → UN. A lista do app só aceita KG ou UN.
 */
export function sugerirUnidade(texto: string | null | undefined): 'KG' | 'UN' {
  return /(\d|\))\s*kg\b|\(kg\)|\bkg\b|quilo/.test(String(texto ?? '').toLowerCase()) ? 'KG' : 'UN'
}

/** A "chave" do nome: sem acento, minúsculo, só letras e números, espaços colapsados. Identifica o pedido de cadastro (a mesma conta da função cadastrar-produto). */
export function chaveDoNome(nome: string | null | undefined): string {
  return String(nome ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** As palavras do nome que viram palavra-chave de busca (sem o "- INSUMOS", sem medidas soltas, até 6). O Ivan pode editar. */
export function palavrasSugeridas(texto: string | null | undefined): string {
  const t = nomeNoSischef(texto).replace(SUFIXO, '').toLowerCase()
  const ruins = new Set(['de', 'da', 'do', 'com', 'para', 'p', 'c', 'insumo', 'insumos'])
  return [...new Set(t.split(/[^a-z0-9áàâãéêíóôõúç]+/i).filter((w) => w.length >= 3 && !/^\d/.test(w) && !ruins.has(w)))].slice(0, 6).join(' ')
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
