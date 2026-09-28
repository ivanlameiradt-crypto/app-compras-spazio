// Vocabulário da cotação (contrato 3.1) do lado do App, para decidir que botões mostrar. Quem manda é o banco: se a
// tela oferecer um botão que ele recusa, a mensagem dele aparece no cartão.
import type { Cotacao, ItemCotacao } from '../../lib/tipos'

const VIVAS = ['pronta', 'enviada', 'respondida']

/** Viva = preparada, enviada, respondida ou fechada sem resultado. */
export const ehViva = (c: Pick<Cotacao, 'status' | 'resultado'>) =>
  VIVAS.includes(c.status) || (c.status === 'fechada' && c.resultado == null)

/** Ainda aberta ao vendedor (antes do fechamento pelo robô). */
export const ehAberta = (c: Pick<Cotacao, 'status'>) => VIVAS.includes(c.status)

/**
 * "Com sinal de envio" (D36): qualquer status depois de pronta, ou a pronta com "Já enviei", link aberto, alguma resposta
 * (inclusive copiada da versão anterior) ou que substituiu outra versão (quem tem o link antigo já chega a ela).
 * `todas` = as cotações lidas (as substituídas inclusive), para saber se alguma aponta para esta.
 */
export function comSinalDeEnvio(c: Cotacao, itens: ItemCotacao[], todas: Cotacao[]): boolean {
  if (c.status !== 'pronta') return true
  return c.enviada_em != null || c.primeiro_acesso != null || c.respostas_rev > 0 || c.gerais_rev > 0 ||
    itens.some((i) => i.cotacao_id === c.id && i.estado !== 'sem_resposta') ||
    todas.some((x) => x.substituida_por === c.id)
}

/** "Pronta sem sinal": a única que "Desfazer (não enviei)" aceita e que Nova versão e Obrigado recusam. */
export const prontaSemSinal = (c: Cotacao, itens: ItemCotacao[], todas: Cotacao[]) =>
  c.status === 'pronta' && !comSinalDeEnvio(c, itens, todas)
