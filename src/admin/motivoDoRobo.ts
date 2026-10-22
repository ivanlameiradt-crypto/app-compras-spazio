// O que o robô de lançamento escreve no "motivo" de uma nota que ele NÃO lançou, dito em português simples: o produto pelo NOME, o que aconteceu e o que fazer.
// Pedido do Ivan (21/10/2026, depois de ver "item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)"): "essa informação tem que
// ser mais clara quando houve o problema por que não foi lançado". Só regras puras (sem rede nem React). O texto original do robô continua guardado na nota e
// nada é apagado: quando nenhuma regra daqui reconhece o motivo, a tela mostra o texto dele como sempre (só trocando o começo técnico por "nada foi lançado").
import type { ItemNotaSefaz } from '../lib/tipos'

export interface ExplicacaoDoRobo {
  /** O que aconteceu, em uma ou duas frases. */
  porque: string
  /** O que o Ivan faz agora. */
  fazer: string
}

/** Começo técnico que o robô põe quando para antes de gerar o pedido (motor.MSG_ANTES_DO_PEDIDO). */
const PREFIXO_ANTES_DO_PEDIDO = /^parou antes de gerar o pedido \(nada lançado\):\s*/i

/** Número como o robô escreve ("3", "9,6", "0,395", às vezes "1.680") → número; fora do formato → null. */
export function numeroDoRobo(texto: string): number | null {
  const t = texto.trim()
  let limpo: string | null = null
  if (/^\d+(,\d+)?$/.test(t)) limpo = t.replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) limpo = t.replace(/\./g, '').replace(',', '.')
  if (limpo == null) return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/** Quantidade no jeito brasileiro, até 4 casas ("3", "0,395", "1.680"). */
const formatar = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

const codDoItem = (it: ItemNotaSefaz): string | null => /C[OÓ]D\.?\s*FOR:?\s*(\S+)/i.exec(it.descricao ?? '')?.[1] ?? null

/** O nome do produto do item com este CÓD. FOR ("SHOYU TRADICIONAL"), como a nota mostra, sem o "- INSUMOS" do cadastro; sem o item na nota, null. */
export function nomeDoItem(itens: ItemNotaSefaz[] | undefined, cod: string): string | null {
  const it = (itens ?? []).find((x) => codDoItem(x) === cod)
  if (!it) return null
  const bruto = (it.produto_nome ?? '').trim() || (it.descricao ?? '').replace(/^\s*C[OÓ]D\.?\s*FOR:?\s*\S+\s*(?:##)?\s*/i, '').trim()
  return bruto.replace(/\s*-\s*INSUMOS\s*$/i, '').replace(/\s+/g, ' ').trim() || null
}
/** Como chamar o item numa frase: o nome do produto, ou "item 263230" quando a nota não tem o item. */
const rotuloDoItem = (itens: ItemNotaSefaz[] | undefined, cod: string): string => nomeDoItem(itens, cod) ?? `item ${cod}`

/** A unidade do item como se lê numa frase ("kg", "un"), ou '' quando a nota não a trouxe. */
function unidadeDoItem(itens: ItemNotaSefaz[] | undefined, cod: string): string {
  const it = (itens ?? []).find((x) => codDoItem(x) === cod)
  return (it?.unidade_sischef ?? '').replace(/[^A-Za-z]/g, '').toLowerCase()
}
const comUnidade = (n: number, un: string): string => (un ? `${formatar(n)} ${un}` : formatar(n))

// "item CÓD. FOR 263230 já associado: Qtde Conver. na tela 3 ≠ 1 x 1 (conversão do painel)" — a conta do SisChef e a do app brigam (motor._conferir_na_tela)
const RE_CONTA_NAO_BATE = /item C[OÓ]D\.? FOR (\S+) já associado: Qtde Conver\. na tela ([\d.,]+) ≠ ([\d.,]+) x ([\d.,]+) \(conversão do painel\)/i
// "nota com frete (R$ 492,82): o lançamento com frete ainda não está ligado (secret NFE_FRETE_LIGADO) — nada foi lançado; ..." (lancar_nfe_nuvem.validar_nota)
const RE_FRETE_DESLIGADO = /nota com frete \(R\$ ([\d.,]+)\): o lançamento com frete ainda não está ligado/i
// "UN DIFERE sem conversão na tela: CÓD. FOR 17253; 999 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)" (motor._conferir_na_tela)
const RE_UN_DIFERE = /UN DIFERE sem convers[ãa]o na tela: C[OÓ]D\.? FOR ([^()]+?)\s*\(/i

/**
 * O motivo do robô explicado ao Ivan, ou null quando nenhuma regra reconhece o texto (a tela então mostra o texto do robô). Cada explicação diz o produto pelo
 * nome (com `itens` da nota), o que aconteceu e o que fazer. Sempre que o robô para antes de gerar o pedido, nada foi lançado: a explicação começa por aí na tela.
 */
export function explicarMotivoDoRobo(motivo: string | null | undefined, itens?: ItemNotaSefaz[]): ExplicacaoDoRobo | null {
  const t = (motivo ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return null

  const conta = RE_CONTA_NAO_BATE.exec(t)
  if (conta) {
    const cod = conta[1]
    const tela = numeroDoRobo(conta[2]); const xml = numeroDoRobo(conta[3]); const noApp = numeroDoRobo(conta[4])
    if (tela != null && xml != null && xml > 0 && noApp != null) {
      const nome = rotuloDoItem(itens, cod)
      const un = unidadeDoItem(itens, cod)
      const porUnidade = Math.round((tela / xml) * 10000) / 10000
      const unidades = xml === 1 ? '1 unidade' : `${formatar(xml)} unidades`
      const sisChef = xml === 1
        ? `o SisChef converte isso para ${comUnidade(tela, un)}`
        : `o SisChef converte isso para ${comUnidade(tela, un)} (${comUnidade(porUnidade, un)} por unidade)`
      return {
        porque: `No ${nome} a conta não bate: a nota traz ${unidades} e ${sisChef}, mas no app a conversão está em ${comUnidade(noApp, un)} por unidade.`,
        fazer: `Veja qual é o certo. Se cada unidade tem ${comUnidade(porUnidade, un)}, toque em Editar no ${nome} e informe ${formatar(porUnidade)}. `
          + `Se o certo é ${comUnidade(noApp, un)}, corrija a conversão do produto no SisChef. Depois lance de novo.`,
      }
    }
  }

  const frete = RE_FRETE_DESLIGADO.exec(t)
  if (frete) {
    return {
      porque: `Esta nota tem frete (R$ ${frete[1]}) e o robô ainda não lança nota com frete sozinho.`,
      fazer: 'Lance esta nota à mão no SisChef, ou peça o teste acompanhado do frete.',
    }
  }

  const difere = RE_UN_DIFERE.exec(t)
  if (difere) {
    const cods = difere[1].split(/\s*;\s*/).map((c) => c.trim()).filter(Boolean)
    const nomes = cods.map((c) => rotuloDoItem(itens, c))
    const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
    return {
      porque: `O SisChef pede a conversão de unidade de ${lista}: a nota vem numa unidade, o produto está em outra, e o app ainda não tem o número.`,
      fazer: `Toque em Editar ${nomes.length === 1 ? 'nesse item' : 'em cada um desses itens'} e informe quanto vale 1 unidade da nota. Depois lance de novo.`,
    }
  }

  return null
}

/** O motivo sem o começo técnico "parou antes de gerar o pedido (nada lançado):" — que vira "Nada foi lançado." na frente do resto. Sem o começo, igual. */
export function motivoSemPrefixoTecnico(motivo: string): string {
  const t = motivo.replace(/\s+/g, ' ').trim()
  return PREFIXO_ANTES_DO_PEDIDO.test(t) ? `Nada foi lançado. ${t.replace(PREFIXO_ANTES_DO_PEDIDO, '')}` : t
}
