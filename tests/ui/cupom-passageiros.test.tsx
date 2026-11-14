import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Cupom from '../../src/admin/Cupom'
import TentarDeNovoCupom from '../../src/admin/TentarDeNovoCupom'
import type { CupomRecente, ItemCupomRecente, RespostaConfirmacaoCupom } from '../../src/lib/tipos'

// Etapa 8 do inventário de 14/11: motivo PASSAGEIRO do robô (nada foi criado no SisChef) = frase curta; o botão "Tentar de novo" só existe com a função do servidor pronta (BOTAO_TENTAR_DE_NOVO_LIGADO),
// e o que PODE ter criado compra nunca ganha botão, nem a frase de "nada foi lançado".
vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const COM: ItemCupomRecente = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 13.472, sugestao_produto: { id: '3484974' }, casado_por: 'descricao', proposta: null, quantidade_cupom: 13.472 }
const NAO_COLOCOU = 'item 1: o Sischef não colocou o produto (código 3484974) na lista em ~15 s (demora do Sischef ou produto fora do catálogo)'
const cupom = (motivo: string, extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 119.9, pedido_sischef: null, criado_em: '2026-11-14T12:00:00Z',
  motivo, teste: false, itens: [COM], ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.cuponsRecentes.mockResolvedValue([])
  m.cuponsExcluidos.mockResolvedValue([])
  m.fantasiasDosFornecedores.mockResolvedValue({})
  m.catalogoProdutos.mockResolvedValue([])
})

describe('Cupom — motivo passageiro do robô', () => {
  it('mostra a frase curta, mantém o motivo cru em letra pequena e, com a função do servidor ainda não pronta, manda pedir ao Claude (sem botão)', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom(NAO_COLOCOU)])
    render(<Cupom />)
    const p = await screen.findByTestId('cupom-problema')
    expect(p).toHaveTextContent('O SisChef demorou para mostrar o produto do item 1. Nada foi lançado.')
    expect(p).toHaveTextContent(`Motivo registrado: ${NAO_COLOCOU}`)
    expect(p).not.toHaveTextContent('motivo que ainda não sei explicar')
    expect(screen.getByTestId('tentar-de-novo-pelo-claude')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })

  it('o que PODE ter criado compra mantém o texto de sempre, sem "nada foi lançado" e sem pedir para repetir', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom('CONFERIR NO SISCHEF antes de repetir: erro inesperado no robô (RuntimeError: Login no Sischef não foi concluído (senha, 2FA ou bloqueio).)')])
    render(<Cupom />)
    const p = await screen.findByTestId('cupom-problema')
    expect(p).toHaveTextContent('a compra PODE já existir lá')
    expect(p).not.toHaveTextContent('Nada foi lançado')
    expect(screen.queryByTestId('tentar-de-novo-pelo-claude')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })
})

describe('TentarDeNovoCupom (o botão)', () => {
  const OK: RespostaConfirmacaoCupom = { cupom_id: 'c9', estado: 'PENDENTE', resumo: 'enviado para lançar', disparo_ok: true } as RespostaConfirmacaoCupom

  it('um toque chama o servidor uma vez e avisa a tela de cima', async () => {
    const tentar = vi.fn().mockResolvedValue(OK)
    const aoSoltar = vi.fn()
    render(<TentarDeNovoCupom id="c9" acoes={{ tentar }} aoSoltar={aoSoltar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(aoSoltar).toHaveBeenCalledWith(OK))
    expect(tentar).toHaveBeenCalledTimes(1)
    expect(tentar).toHaveBeenCalledWith('c9')
  })

  it('se o servidor recusa, mostra o texto dele e o botão volta', async () => {
    const tentar = vi.fn().mockRejectedValue(new Error('este cupom não está parado por falha passageira: atualize a tela'))
    const aoSoltar = vi.fn()
    render(<TentarDeNovoCupom id="c9" acoes={{ tentar }} aoSoltar={aoSoltar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('não está parado por falha passageira')
    expect(aoSoltar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled()
  })
})
