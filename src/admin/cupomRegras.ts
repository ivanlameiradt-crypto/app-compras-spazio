// Regras puras da tela "Lançar cupom": por que um envio ficou parado ("precisa de você") e o que fazer para o robô poder lançá-lo.
// Pedido do Ivan (06/10, à noite): em vez de "confira no Code", dizer o que está errado e qual é a solução. Sem rede nem React.
//
// As causas vêm de quem marca REVISAR: a Edge Function enviar-cupom (foto ilegível, item sem produto confirmado, total não lido), o robô
// (cupom_lancar / lancar_cupom_nuvem: validação, forma de pagamento, falha no SisChef) e o reaper (cupom preso). O roteiro de correção, que é o
// que o "Claude" segue quando o Ivan pede, está em docs/corrigir-cupom.md do repositório do robô (sischef-monitor-notas).
import { formatarReais } from '../lib/regras'
import type { CupomRecente, ItemCupomRecente } from '../lib/tipos'

export interface ItemComProblema { descricao: string; proposta: string | null; preco: string | null }
export interface DiagnosticoCupom {
  /** O que está errado, em uma frase que o Ivan entende. */
  problema: string
  /** Os itens que travam o cupom (só quando o problema é de produto). */
  itens: ItemComProblema[]
  /** O que fazer para o cupom ficar apto a ser lançado pelo robô. */
  solucao: string
}

const semProdutoConfirmado = (it: ItemCupomRecente): boolean => String(it.sugestao_produto?.id ?? '').trim() === ''

/** A proposta do sistema para o item ("LIMÃO SICILIANO - INSUMOS · cód. 3484974"), ou null se ele não teve proposta. */
function propostaDe(it: ItemCupomRecente): string | null {
  const id = String(it.proposta?.insumo_id ?? '').trim()
  if (id === '') return null
  const nome = (it.proposta?.insumo_nome ?? '').trim()
  return nome !== '' ? `${nome} · cód. ${id}` : `cód. ${id}`
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
  const sem = (problema: string, solucao: string): DiagnosticoCupom => ({ problema, itens: [], solucao })

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
    // item sem produto confirmado chega sem `entrada_estoque` (a quantidade do estoque só se calcula depois do casamento) e o envio não guarda a
    // quantidade lida: ela só existe na foto/no cupom de papel
    const semPeso = travando.some((it) => it.entrada_estoque == null)
    const quem = (c.emitente_nome ?? '').trim() || 'cupom'
    return {
      problema: `${n === 1 ? '1 item ainda não tem' : `${n} itens ainda não têm`} produto confirmado no SisChef (o robô nunca chuta: só lança item que você já confirmou uma vez para este fornecedor).${semTotal ? ' Além disso, o total do cupom não foi lido.' : ''}`,
      itens: travando.map((it) => ({ descricao: (it.descricao_cupom ?? '').trim() || 'item', proposta: propostaDe(it), preco: precoDe(it) })),
      solucao: `${CLAUDE}: “confirma os produtos do cupom do ${quem}”. Ele mostra as propostas, você confirma, ele grava a confirmação (nos próximos cupons desse fornecedor o item passa direto), põe o cupom na fila e o robô lança.${semPeso ? ' Deixe o cupom de papel à mão: o peso (kg) desses itens não ficou guardado.' : ''}`,
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
