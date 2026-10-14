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
/** O nome FINAL (com o " - INSUMOS") mais comprido que o app aceita. HIPOTESE: o limite real do campo Descrição do SisChef ainda não foi medido
 *  (virá de SELETORES-REAIS-DO-SISCHEF.md); a função cadastrar-produto aceita até 200. */
export const MAX_LETRAS_NOME = 120
/** Pedido em andamento sem resposta por este tempo é dado por perdido: a tela troca o aviso por "Tentar de novo". O MESMO prazo da função
 *  cadastrar-produto (que só aceita um pedido novo para o nome depois dele), contado também pela hora do pedido (`atualizado_em`). */
export const MINUTOS_SEM_RESPOSTA = 20

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
  const final = nomeNoSischef(d.nome)
  if (final === '') return 'Digite o nome do produto.'
  // conta o nome que vai ao SisChef (com o " - INSUMOS"), não o digitado: 115 letras + o sufixo passariam do limite
  if (final.length > MAX_LETRAS_NOME) return `O nome está grande demais (máximo ${MAX_LETRAS_NOME} letras, contando o “ - INSUMOS”).`
  if (!GRUPOS_DE_INSUMO.includes(d.grupo)) return 'Escolha o grupo do SisChef.'
  if (!UNIDADES.some((u) => u.sigla === d.unidade)) return 'Escolha a unidade.'
  return null
}

export type EstadoProduto = 'PENDENTE' | 'PROCESSANDO' | 'CADASTRADO' | 'JA_EXISTIA' | 'REVISAR'
export const PRODUTO_PRONTO = (e: EstadoProduto | null | undefined): boolean => e === 'CADASTRADO' || e === 'JA_EXISTIA'

/**
 * Há quanto tempo (ms) o pedido está parado: pela hora do pedido no servidor (`atualizado_em`, que muda quando o robô o pega), não pela hora em que a
 * tela abriu (um pedido retomado parado há 30 min já mostra a saída). Nunca menos que o tempo que a tela já o viu assim (`vistoEm`): com o relógio do
 * aparelho atrasado a hora do pedido parece "no futuro", e mesmo assim os botões aparecem.
 */
export function idadeDoPedido(hora: string | null | undefined, vistoEm: number, agora: number): number {
  const h = hora ? Date.parse(hora) : NaN
  return Math.max(0, agora - vistoEm, Number.isFinite(h) ? agora - h : 0)
}

// O motivo do robô e do servidor costuma terminar com o conselho deles ("— confira no SisChef…"); a tela dá o dela, com as palavras dela, e o
// "confira" não pode sair duas vezes (revisão 2, M2). Corta do "confira" até o fim, com o separador que vem antes.
const RE_CONSELHO = /\s*(?:[—–:;,.]\s*|\s-\s*)?\bconfira\b[\s\S]*$/i

/** O motivo sem o conselho final: só o FATO ("a unidade do produto no SisChef é PCT…"); '' quando o motivo é só conselho. */
export function motivoSemConselho(motivo: string | null | undefined): string {
  return String(motivo ?? '').replace(RE_CONSELHO, '').replace(/[\s—–:;,.-]+$/, '').trim()
}

/**
 * O aviso do REVISAR sem candidatos (os candidatos têm o aviso deles): o fato que o robô contou e UM conselho. Com o código do produto (o robô pode
 * ter criado o produto no SisChef), a saída é "Tentar de novo", que só traz ESTE produto para a lista; sem ele, conferir no SisChef antes de pedir de novo.
 * Nunca afirma que o produto não existe nem que nada foi criado.
 */
export function mensagemDoRevisar(motivo: string | null | undefined, produtoId: number | null): string {
  const fato = motivoSemConselho(motivo)
  const inicio = fato === '' ? 'O robô parou sem terminar.' : `O robô parou sem terminar: ${fato}${/[.!?]$/.test(fato) ? '' : '.'}`
  if (produtoId === null) return `${inicio} Confira no SisChef se o produto já existe antes de tentar de novo.`
  const conselho = `O produto pode ter sido criado no SisChef com o código ${produtoId}: confira os campos lá; se estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).`
  return fato === '' ? conselho : `${inicio} ${conselho}`
}
