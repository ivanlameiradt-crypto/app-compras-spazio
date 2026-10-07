// Regras puras da tela "Lançar cupom": por que um envio ficou parado ("precisa de você") e o que fazer para o robô poder lançá-lo.
// Pedido do Ivan (06/10, à noite): em vez de "confira no Code", dizer o que está errado e qual é a solução. Sem rede nem React.
//
// As causas vêm de quem marca REVISAR: a Edge Function enviar-cupom (foto ilegível, item sem produto confirmado, total não lido), o robô
// (cupom_lancar / lancar_cupom_nuvem: validação, forma de pagamento, falha no SisChef) e o reaper (cupom preso). O roteiro de correção, que é o
// que o "Claude" segue quando o Ivan pede, está em docs/corrigir-cupom.md do repositório do robô (sischef-monitor-notas).
import { formatarReais } from '../lib/regras'
import type { CupomRecente, ItemCupomRecente } from '../lib/tipos'

export interface ItemComProblema { descricao: string; preco: string | null }
export interface DiagnosticoCupom {
  /** O que está errado, em uma frase que o Ivan entende. */
  problema: string
  /** Os itens que travam o cupom (só quando o problema é de produto): o que o cupom diz de cada um. */
  itens: ItemComProblema[]
  /** O que o Ivan precisa INFORMAR, item a item ("LIMAO SICILIANO: confirmar que é LIMÃO SICILIANO - INSUMOS (cód. 3484974) e dizer o peso (kg) que está no cupom."). */
  pedidos: string[]
  /** Para ele conferir a própria resposta: quanto os itens sem peso devem somar (total do cupom − itens já confirmados), ou null se não dá para calcular. */
  conferencia: string | null
  /** O que fazer para o cupom ficar apto a ser lançado pelo robô. */
  solucao: string
  /**
   * A correção pode ser feita na própria tela (item sem produto confirmado, com o total lido): o Ivan escolhe o produto e digita a quantidade,
   * e a Edge Function confirmar-cupom refaz e reenvia. Nos outros casos o caminho continua sendo o Claude/SisChef.
   */
  corrigivel: boolean
}

const semProdutoConfirmado = (it: ItemCupomRecente): boolean => String(it.sugestao_produto?.id ?? '').trim() === ''

/** O que o cupom pede ao Ivan sobre UM item: confirmar o produto (a proposta do sistema, ou dizer qual é) e, se o peso não ficou guardado, dizer o peso. */
const GRANDEZA_PESO = /^(kg|g|gr|l|lt|ml)$/i
function pedidoDe(it: ItemCupomRecente): string {
  const desc = (it.descricao_cupom ?? '').trim() || 'item'
  const id = String(it.proposta?.insumo_id ?? '').trim()
  const nome = (it.proposta?.insumo_nome ?? '').trim()
  const produto = id === '' ? 'dizer qual é o produto do SisChef' : `confirmar que é ${nome !== '' ? `${nome} (cód. ${id})` : `o produto de cód. ${id}`}`
  const un = (it.unidade_cupom ?? '').trim().toLowerCase()
  const falta = it.entrada_estoque == null ? ` e dizer ${GRANDEZA_PESO.test(un) ? 'o peso' : 'a quantidade'}${un !== '' ? ` (${un})` : ''} que está no cupom` : ''
  return `${desc}: ${produto}${falta}.`
}

/** Pedaço da resposta de exemplo para UM item ("LIMAO SICILIANO: confirmo, __ kg"). */
function exemploDe(it: ItemCupomRecente): string {
  const desc = (it.descricao_cupom ?? '').trim() || 'item'
  const un = (it.unidade_cupom ?? '').trim().toLowerCase()
  const resposta = String(it.proposta?.insumo_id ?? '').trim() === '' ? 'é <produto>' : 'confirmo'
  return `${desc}: ${resposta}${it.entrada_estoque == null ? `, __ ${un || 'quantidade'}` : ''}`
}

/**
 * Quanto os itens pendentes devem somar para o cupom fechar: total do cupom − o que os itens já confirmados valem (entrada × preço − desconto, a mesma conta
 * do robô). Só quando NENHUM item pendente tem peso (senão a conta mistura o que já se sabe) e o total foi lido.
 */
function conferenciaDaSoma(c: CupomRecente, itens: ItemCupomRecente[], travando: ItemCupomRecente[]): string | null {
  const total = c.valor_a_pagar
  if (total == null || !(total > 0) || !travando.every((it) => it.entrada_estoque == null)) return null
  let confirmados = 0
  for (const it of itens) {
    if (semProdutoConfirmado(it)) continue
    const q = Number(it.entrada_estoque)
    const v = Number(it.valor_unitario)
    if (!Number.isFinite(q) || !Number.isFinite(v)) return null
    const d = Number(it.desconto_item ?? 0)
    confirmados += q * v - (Number.isFinite(d) ? d : 0)
  }
  confirmados = Math.round(confirmados * 100) / 100
  const resto = Math.round((total - confirmados) * 100) / 100
  if (!(resto > 0)) return null
  const n = travando.length
  return `O cupom é ${formatarReais(total)}${confirmados > 0 ? ` e os itens já confirmados somam ${formatarReais(confirmados)}` : ''}: ${n === 1 ? 'este item deve dar' : 'estes itens devem somar'} ${formatarReais(resto)} (peso × preço, com até 2 centavos de diferença).`
}

/** "R$ 13,90 por KG": o valor_unitario do cupom é o preço de UMA unidade (kg, un). */
function precoDe(it: ItemCupomRecente): string | null {
  if (it.valor_unitario == null || !Number.isFinite(Number(it.valor_unitario))) return null
  const un = (it.unidade_cupom ?? '').trim()
  return `${formatarReais(Number(it.valor_unitario))}${un !== '' ? ` por ${un.toUpperCase()}` : ''}`
}

const CLAUDE = 'Peça ao Claude'

/**
 * O diagnóstico de um envio que está em REVISAR (null para os outros estados). A ordem importa: primeiro o que pode ter chegado ao SisChef
 * (conferir antes de qualquer coisa), depois o que é só dado do cupom. Texto que ninguém reconhece vira o motivo cru + o pedido genérico.
 */
export function diagnosticoDoCupom(c: CupomRecente): DiagnosticoCupom | null {
  if (c.estado !== 'REVISAR') return null
  const motivo = (c.motivo ?? '').trim()
  const sem = (problema: string, solucao: string): DiagnosticoCupom => ({ problema, itens: [], pedidos: [], conferencia: null, solucao, corrigivel: false })

  // Pode já existir compra no SisChef: nunca reenviar sem conferir.
  if (/^CONFERIR NO SISCHEF|GERAR_COMPRA_CLICADO|FINALIZAR_COMPRA_CLICADO/i.test(motivo)) {
    return sem('O robô começou a lançar no SisChef e parou no meio: a compra PODE já existir lá.',
      `Não envie de novo (duplicaria a compra). Confira no SisChef se a compra aparece (só olhe, não clique em nada) e ${CLAUDE.toLowerCase()}: ele confere e libera.`)
  }
  if (/^falha ao preencher o pagamento no Sischef/i.test(motivo)) {
    return sem('O robô abriu o pedido no SisChef, mas não conseguiu preencher o pagamento: ficou um pedido ABERTO e nada foi pago.',
      `${CLAUDE}: ele confere o pedido aberto, cancela com o seu OK e lança de novo.`)
  }
  if (/já lançado em outro envio/i.test(motivo)) {
    return sem('Este cupom já foi lançado em outro envio.', 'Nada a fazer: não envie de novo (duplicaria a compra no SisChef).')
  }
  if (/não consegui ler a foto/i.test(motivo)) {
    return sem('A foto não ficou legível (ou não mostra os itens do cupom).',
      'Tire outra foto, com o cupom inteiro, esticado e com boa luz, e envie de novo.')
  }

  // Itens sem produto confirmado: o robô nunca chuta; só lança item que o Ivan já confirmou uma vez para o fornecedor.
  const itens = Array.isArray(c.itens) ? c.itens : []
  const travando = itens.filter(semProdutoConfirmado)
  if (travando.length > 0) {
    const n = travando.length
    const semTotal = /não consegui ler o total/i.test(motivo)
    // Só dá para corrigir na tela com o total lido: sem ele nem a tela nem a Edge Function confirmar-cupom conseguem conferir a soma (ela recusa).
    // a mesma trava do servidor (confirmar-cupom): com pedido já aberto no SisChef, reenviar poderia duplicar a compra — não se corrige pelo app
    const corrigivel = !semTotal && c.valor_a_pagar != null && Number(c.valor_a_pagar) > 0 && c.pedido_sischef == null
    // item sem produto confirmado chega sem `entrada_estoque` (a quantidade do estoque só se calcula depois do casamento) e o envio não guarda a
    // quantidade lida: ela só existe na foto/no cupom de papel
    return {
      problema: `${n === 1 ? '1 item ainda não tem' : `${n} itens ainda não têm`} produto confirmado no SisChef (o robô nunca chuta: só lança item que você já confirmou uma vez para este fornecedor).${semTotal ? ' Além disso, o total do cupom não foi lido.' : ''}`,
      itens: travando.map((it) => ({ descricao: (it.descricao_cupom ?? '').trim() || 'item', preco: precoDe(it) })),
      pedidos: travando.map(pedidoDe),
      conferencia: conferenciaDaSoma(c, itens, travando),
      solucao: corrigivel
        ? 'Confirme cada item abaixo (o produto do SisChef e o peso que está no cupom) e toque em “Reenviar para lançar”. O app guarda a confirmação (nos próximos cupons desse fornecedor o item passa direto), confere a soma e o robô lança.'
        : `${CLAUDE} e responda, por exemplo: “${travando.map(exemploDe).join('; ')}”. Ele grava a confirmação (nos próximos cupons desse fornecedor o item passa direto), refaz o cupom, confere a soma e o robô lança.`,
      corrigivel,
    }
  }

  if (/não consegui ler o total/i.test(motivo)) {
    return sem('O total do cupom não foi lido, e sem ele o robô não consegue conferir a soma dos itens.',
      `${CLAUDE}: ele lê o total na foto, confere a soma dos itens e libera o lançamento.`)
  }
  if (/forma de pagamento não suportada/i.test(motivo)) {
    return sem('O robô não paga com esta forma de pagamento (ele paga só dinheiro, tesouraria, PIX e sem cartão).',
      'Lance este cupom à mão no SisChef.')
  }
  if (/forma de pagamento ausente|sem a conta/i.test(motivo)) {
    return sem('Faltou a forma de pagamento (ou a conta) do cupom.', `${CLAUDE}: ele corrige o pagamento e libera o lançamento.`)
  }
  if (/sem produto associado|sem quantidade|quantidade inválida|cupom sem itens|dados numéricos inválidos/i.test(motivo)) {
    return sem('O cupom chegou ao robô com dados incompletos (produto ou quantidade de algum item).',
      `${CLAUDE}: ele confere os itens com a foto, corrige e libera.`)
  }

  // motivo que ninguém reconhece: não repete o texto aqui (a tela já o mostra, em letra pequena, como "Motivo registrado")
  return sem(motivo !== '' ? 'O sistema parou este cupom por um motivo que ainda não sei explicar (veja o motivo registrado abaixo).' : 'O robô não conseguiu lançar este cupom.',
    `${CLAUDE}: ele confere este cupom, segue o roteiro de correção e diz o que falta da sua parte.`)
}
