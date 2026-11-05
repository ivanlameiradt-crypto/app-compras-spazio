// Cadastro de PRODUTO NOVO pelo app (pedido do Ivan, 13/10/2026): quando o produto de um cupom, de uma nota fiscal ou de uma compra avulsa não existe na lista do app nem no
// SisChef, ele o cadastra pelo app (nome, grupo e unidade, com os mesmos parâmetros do formulário "Novo produto" do SisChef) e o robô o cria no SisChef; o app guarda o código
// novo na planilha de produtos (a lista do app). Aqui só as regras puras: sem React nem rede.
import { ehUnidadeDaLista } from '../lib/unidadesDaLista'

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
/** O nome FINAL (com o " - INSUMOS") mais comprido que o app aceita. Limite do app; o SisChef não impõe limite medido (o campo Descrição não tem
 *  maxlength e já há nomes de 158 letras lá: SELETORES-REAIS-DO-SISCHEF.md, 14/10). A função cadastrar-produto aceita até 200. */
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

/** O produto INATIVO no SisChef: o robô põe "(inativo)" no fim da descrição do candidato (montar_candidatos). O robô nunca o reativa. */
export const candidatoInativo = (c: { descricao: string }): boolean => /\(inativo\)\s*$/i.test(c.descricao)
/** Quantos candidatos a tela mostra de início (1º uso real, 14/10: com 8 na tela, o botão que decide ficava fora dela). */
export const CANDIDATOS_DE_INICIO = 4
/** Os que aparecem de início (os mais parecidos ATIVOS, na ordem do robô) e os outros (os inativos e os que passam do limite), atrás de "Ver os outros". */
export function separarCandidatos<T extends { descricao: string }>(candidatos: T[], limite = CANDIDATOS_DE_INICIO): { primeiros: T[]; outros: T[] } {
  const primeiros = candidatos.filter((c) => !candidatoInativo(c)).slice(0, limite)
  return { primeiros, outros: candidatos.filter((c) => !primeiros.includes(c)) }
}

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
// "confira" não pode sair duas vezes (revisão 2, M2). Só o conselho GENÉRICO é cortado (do "confira" até o fim, com o separador que vem antes): um
// motivo com OUTRA instrução (o do produto inativo: "reative no SisChef…") fica inteiro, e aí a tela não junta o conselho dela.
const RE_CONSELHO = /\s*(?:[—–:;,.]\s*|\s-\s*)?\bconfira\b[\s\S]*$/i
const RE_OUTRA_INSTRUCAO = /(?<![\p{L}\d])(?:reative|escolha|corrija|exclua|apague|tente|peça)(?![\p{L}\d])/iu
const RE_CONFIRA = /\bconfira\b/i

/** O motivo sem o conselho final genérico: só o FATO ("a unidade do produto no SisChef é PCT…"); '' quando o motivo é só conselho. */
export function motivoSemConselho(motivo: string | null | undefined): string {
  const m = String(motivo ?? '').trim()
  const conselho = RE_CONSELHO.exec(m)?.[0] ?? ''
  const fato = conselho !== '' && !RE_OUTRA_INSTRUCAO.test(conselho) ? m.slice(0, m.length - conselho.length) : m
  return fato.replace(/[\s—–:;,.-]+$/, '').trim()
}

const RE_UNIDADE_FORA_DA_LISTA = /a unidade do produto no SisChef é\s*([^;]+?)\s*;\s*a lista do app só aceita/i
const RE_CODIGO_NO_MOTIVO = /confira o produto\s*(\d+)/i
// O robô clicou em Salvar, viu "Salvo com sucesso." e a URL não ganhou ?id= (3 de 3 vezes desde 14/10): o produto FOI criado. Sem a mensagem de salvo ("não vi a mensagem … nem o código") não se sabe.
const RE_SALVOU_SEM_CODIGO = /cliquei em Salvar e não vi o código do produto na URL/i

/** Produto que JÁ existe no SisChef numa unidade que o app não conhece (CX, RL…) e a frase que o Ivan manda ao Claude para trocá-la para UN (ação nomeada, como em 31/10). */
export interface TrocaDeUnidade { unidade: string; produtoId: number; frase: string }

/** O motivo do banco "a unidade do produto no SisChef é CX; a lista do app só aceita KG, UN, CT ou PCT — confira o produto N no SisChef": a unidade, o código e a frase. null se não é isso. */
export function trocaDeUnidade(motivo: string | null | undefined, produtoId: number | null): TrocaDeUnidade | null {
  const m = String(motivo ?? '')
  const un = RE_UNIDADE_FORA_DA_LISTA.exec(m)?.[1]?.trim().toUpperCase()
  if (!un || un === '?' || ehUnidadeDaLista(un)) return null   // o texto antigo do banco dizia "só aceita KG ou UN" também para PCT, que hoje o app aceita
  const id = produtoId ?? (Number(RE_CODIGO_NO_MOTIVO.exec(m)?.[1]) || null)
  if (id === null || !Number.isInteger(id) || id <= 0) return null
  return { unidade: un, produtoId: id, frase: `pode trocar a unidade do produto ${id} de ${un} para UN no SisChef` }
}

/**
 * O aviso do REVISAR sem candidatos (os candidatos têm o aviso deles): o fato que o robô contou e UM conselho. Com o código do produto (o robô pode
 * ter criado o produto no SisChef), a saída é "Tentar de novo", que só traz ESTE produto para a lista; sem ele, conferir no SisChef antes de pedir de novo.
 * Nunca afirma que o produto não existe nem que nada foi criado, salvo nos dois casos que o robô prova (04/11/2026, cupom da A. N. da Silva): o produto JÁ existe em unidade que o app não
 * conhece (o "pode ter sido criado" era falso e "Tentar de novo" repetia o erro) e o robô salvou mas não leu o código (o produto existe; o 2º pedido o acha pelo nome).
 */
export function mensagemDoRevisar(motivo: string | null | undefined, produtoId: number | null): string {
  const troca = trocaDeUnidade(motivo, produtoId)
  if (troca) {
    const saida = produtoId !== null ? 'toque em “Tentar de novo”' : 'toque de novo em “Cadastrar no SisChef e no app”'
    return `Este produto JÁ EXISTE no SisChef (código ${troca.produtoId}), mas está em ${troca.unidade} e o app só trabalha com KG, UN, CT e PCT. Primeiro troque a unidade dele para UN (peça ao Claude com a frase abaixo, ou troque você mesmo no SisChef); depois ${saida}. Antes disso ele repete este aviso.`
  }
  if (produtoId === null && RE_SALVOU_SEM_CODIGO.test(String(motivo ?? ''))) {
    return 'O robô clicou em Salvar no SisChef, mas não conseguiu ler o código do produto: ele provavelmente foi criado. Toque de novo em “Cadastrar no SisChef e no app”: o robô procura o produto pelo nome e traz o código para a sua lista. Se ele não aparecer, confira em Produtos no SisChef antes de tentar outra vez, para não criar dois.'
  }
  const fato = motivoSemConselho(motivo)
  const inicio = fato === '' ? 'O robô parou sem terminar.' : `O robô parou sem terminar: ${fato}${/[.!?]$/.test(fato) ? '' : '.'}`
  if (produtoId === null) return RE_CONFIRA.test(fato) || RE_OUTRA_INSTRUCAO.test(fato) ? inicio : `${inicio} Confira no SisChef se o produto já existe antes de tentar de novo.`
  const conselho = RE_CONFIRA.test(fato)
    ? `O produto pode ter sido criado no SisChef com o código ${produtoId}; se os campos lá estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).`
    : `O produto pode ter sido criado no SisChef com o código ${produtoId}: confira os campos lá; se estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).`
  return fato === '' ? conselho : `${inicio} ${conselho}`
}
