import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
import * as api from '../../src/lib/api'
import TerminarPedido from '../../src/admin/TerminarPedido'
import { podeTerminarPedido } from '../../src/admin/notaSefazRegras'

const MOTIVO = "erro no lançamento (pedido JÁ gerado 167483685 — conferir no Sischef; pedido: https://x/pedido.jsf?keyPedido=ab; tela no erro: https://x/gerarCompraVenda.jsf?id=167483685) no passo 'pagamento': pagamento não confere antes de finalizar"
const NOTA: NotaSefazLista = {
  chave: '15261102914460060722550010001923231201244920', emitente: 'SEARA ALIMENTOS LTDA', numero: '000192323', emissao: '2026-11-09',
  valor_nf: 621, situacao: 'na_fila', lancada_em: null, nf_sischef: null, itens: [], forma_pagamento: 'boleto',
  lancamento_estado: 'erro', lancamento_motivo: MOTIVO, parcelas: [{ numero: '001', vencimento: '2026-12-07', valor: 621 }], parcelas_manuais: null,
}

beforeEach(() => { vi.mocked(api.terminarPedidoDaNota).mockReset() })

describe('podeTerminarPedido (quando o botão aparece)', () => {
  it('boleto parado no pagamento, com o número do pedido: aparece', () => {
    expect(podeTerminarPedido(NOTA)).toBe(true)
  })
  it.each([
    ['nota que não está pela metade', { lancamento_estado: 'revisar' as const }],
    ['sem o número do pedido', { lancamento_motivo: "erro no lançamento no passo 'pagamento': x" }],
    ['parou depois de finalizar a compra', { lancamento_motivo: MOTIVO.replace("'pagamento'", "'Gerar nota fiscal'") }],
    ['compra já FINALIZADA', { lancamento_motivo: MOTIVO + ' compra FINALIZADA' }],
    ['pedido aberto por causa do frete', { lancamento_motivo: 'pedido 1 aberto na tela de pagamento com o frete de R$ 10,00' }],
    ['forma que não é boleto', { forma_pagamento: 'dinheiro' }],
    ['parcelas digitadas', { parcelas_manuais: [{ vencimento: '2026-12-07', valor: 621 }] }],
    ['sem boletos lidos', { parcelas: [] }],
  ])('%s: não aparece', (_n, mudanca) => {
    expect(podeTerminarPedido({ ...NOTA, ...mudanca })).toBe(false)
  })
})

describe('TerminarPedido', () => {
  it('não mostra nada quando o robô não sabe terminar a nota', () => {
    const { container } = render(<TerminarPedido nota={{ ...NOTA, forma_pagamento: 'dinheiro' }} ocupado={false} aoPedir={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('um toque chama o robô uma vez, avisa e não deixa pedir de novo', async () => {
    vi.mocked(api.terminarPedidoDaNota).mockResolvedValue(undefined)
    const aoPedir = vi.fn()
    render(<TerminarPedido nota={NOTA} ocupado={false} aoPedir={aoPedir} />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminar pedido' }))
    expect(api.terminarPedidoDaNota).toHaveBeenCalledTimes(1)
    expect(api.terminarPedidoDaNota).toHaveBeenCalledWith(NOTA.chave)
    expect(await screen.findByRole('status')).toHaveTextContent(/Pedi ao robô para terminar/)
    expect(screen.queryByRole('button', { name: 'Terminar pedido' })).not.toBeInTheDocument()
    expect(aoPedir).toHaveBeenCalledTimes(1)
  })

  it('se o robô não atende, mostra o motivo e o botão continua valendo', async () => {
    vi.mocked(api.terminarPedidoDaNota).mockRejectedValue(new Error('Não consegui chamar o robô agora, tente de novo.'))
    render(<TerminarPedido nota={NOTA} ocupado={false} aoPedir={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminar pedido' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não consegui chamar o robô/)
    expect(screen.getByRole('button', { name: 'Terminar pedido' })).toBeEnabled()
  })

  it('com o robô ocupado em outra nota, o botão fica apagado', () => {
    render(<TerminarPedido nota={NOTA} ocupado aoPedir={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Terminar pedido' })).toBeDisabled()
  })
})
