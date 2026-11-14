// 14/11/2026 (pedido do Ivan): o robô parou na nota da LONG WAY porque o 0,24 digitado na conversão do item 5 não servia (a nota e o produto já estão em UN), e o app
// mostrava o texto cru do robô, sem botão. Agora: uma frase curta e o botão "Tirar a conversão e lançar de novo" — apaga o número (mantendo o produto) e lança.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '7'.repeat(44)
const GUIOZA = 3971031
const MOTIVO = 'item 5 (CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G): a nota e o produto estão na mesma unidade (UN) no SisChef e o número informado (0,24) não é de embalagem '
  + '(embalagem é maior que 1 e vale para UN, PCT, CX ou FD): no app, toque em Editar neste item, deixe a conversão vazia e lance de novo (ou associe no SisChef)'
const FRASE = 'Item 5 (LONG WAY GUIOZA LW LEGUMES 240G): o número 0,24 que foi informado não serve como conversão, porque a nota e o produto já estão na mesma unidade. Recomendo tirar esse número.'
const decisao = (conversao: number | null) => ({ '5': { produto_id: GUIOZA, produto_nome: 'GUIOZA DE LEGUMES - INSUMOS', unidade: 'un', conversao, origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-11-14T10:00:00Z' } })
const longWay = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '11222333000144', emitente: 'LONG WAY ALIMENTOS LTDA', numero: '000012345', emissao: '2026-11-13', valor_nf: 500,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  parcelas: [{ numero: '001', vencimento: '2026-12-13', valor: 500 }],
  itens: [
    { n: 4, descricao: 'CÓD. FOR: 2890 LONG WAY HARUMAKI 300G', qtd: 5, unidade_sischef: 'UN', produto_id: '111', produto_nome: 'HARUMAKI - INSUMOS', associacao: 'sischef' },
    { n: 5, descricao: 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G', qtd: 10, unidade_sischef: 'UN', produto_id: null },
  ],
  associacoes_app: decisao(0.24), forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: MOTIVO,
  ...extra,
} as unknown as NotaSefazLista)
const faixa = async () => { await screen.findByTestId('nota-a-lancar'); return screen.getByTestId('status-nota') }
const BOTAO = 'Tirar a conversão e lançar de novo'

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  m.associarItem.mockResolvedValue(undefined)
  m.converterItem.mockResolvedValue(undefined)
  m.lancarNota.mockResolvedValue(undefined)
})

describe('NotaSefaz — "Tirar a conversão e lançar de novo" (o número informado não serve como conversão)', () => {
  it('no lugar do texto cru do robô: a frase curta e o botão', async () => {
    m.notasALancar.mockResolvedValue([longWay()])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent(FRASE)
    expect(aviso).toHaveTextContent('Precisa de você — nada foi lançado.')
    expect(aviso).not.toHaveTextContent('CÓD. FOR')
    expect(aviso).not.toHaveTextContent('embalagem é maior que 1')
    expect(aviso).not.toHaveTextContent('associe no SisChef')
    expect(within(aviso).getByRole('button', { name: BOTAO })).toBeEnabled()
  })

  it('o toque apaga a conversão mantendo o produto e dispara o mesmo lançamento do botão Lançar, nessa ordem; enquanto grava o botão fica travado em "Gravando…"', async () => {
    m.notasALancar.mockResolvedValue([longWay()])
    let soltar!: () => void
    m.associarItem.mockReturnValue(new Promise<void>((ok) => { soltar = ok }))
    m.lancarNota.mockImplementation(async () => { m.notasALancar.mockResolvedValue([longWay({ associacoes_app: decisao(null), lancamento_estado: 'lancando', lancamento_em: new Date().toISOString() } as Partial<NotaSefazLista>)]) })
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    const gravando = screen.getByRole('button', { name: 'Gravando…' })
    expect(gravando).toBeDisabled()
    expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 5, GUIOZA, null)
    expect(m.lancarNota).not.toHaveBeenCalled()                                        // só lança depois de o número estar apagado no banco
    await userEvent.click(gravando)
    expect(m.associarItem).toHaveBeenCalledTimes(1)                                    // toque repetido não grava duas vezes
    await act(async () => { soltar() })
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    expect(m.converterItem).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId('status-nota')).toHaveTextContent('Lançando…'))
    expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
  })

  it('falhou ao apagar: mensagem simples, a faixa e o botão continuam, e nada é lançado', async () => {
    m.notasALancar.mockResolvedValue([longWay()])
    m.associarItem.mockRejectedValue(new Error('Não consegui guardar a escolha agora. Confira a internet e tente de novo.'))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    expect(await screen.findByTestId('tirar-conversao-erro')).toHaveTextContent('Não consegui guardar a escolha agora. Confira a internet e tente de novo.')
    expect(m.lancarNota).not.toHaveBeenCalled()
    const aviso = screen.getByTestId('status-nota')
    expect(aviso).toHaveTextContent(FRASE)
    expect(within(aviso).getByRole('button', { name: BOTAO })).toBeEnabled()
  })

  it('apagou mas o lançamento falhou: diz que o número saiu e manda tocar em Lançar; o botão de tirar some (não há mais o que tirar)', async () => {
    m.notasALancar.mockResolvedValue([longWay()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([longWay({ associacoes_app: decisao(null) })]) })
    m.lancarNota.mockRejectedValue(new Error('O robô está ocupado. Tente daqui a pouco.'))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    const erro = await screen.findByTestId('tirar-conversao-erro')
    expect(erro).toHaveTextContent('Tirei o número, mas não consegui lançar agora: O robô está ocupado. Tente daqui a pouco. Toque em Lançar para tentar de novo.')
    const aviso = screen.getByTestId('status-nota')
    await waitFor(() => expect(aviso).toHaveTextContent('Item 5 (LONG WAY GUIOZA LW LEGUMES 240G): o número 0,24 já foi tirado. Agora toque em Lançar.'))
    expect(within(aviso).queryByRole('button', { name: /Tirar a conversão/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })

  it('outra nota está lançando: o botão só tira a conversão (não lança) e depois a frase manda tocar em Lançar', async () => {
    const outra = longWay({ chave: '8'.repeat(44), numero: '000099999', emitente: 'OUTRA LTDA', associacoes_app: null, lancamento_estado: 'lancando', lancamento_motivo: null, lancamento_em: new Date().toISOString(),
      itens: [{ n: 1, descricao: 'CÓD. FOR: 1 X', qtd: 1, unidade_sischef: 'UN', produto_id: '9', produto_nome: 'X', associacao: 'sischef' }] } as unknown as Partial<NotaSefazLista>)
    m.notasALancar.mockResolvedValue([longWay(), outra])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([longWay({ associacoes_app: decisao(null) }), outra]) })
    render(<NotaSefaz />)
    await screen.findAllByTestId('nota-a-lancar')
    const aviso = screen.getAllByTestId('status-nota').find((x) => (x.textContent ?? '').includes('Item 5'))!
    expect(within(aviso).queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    await userEvent.click(within(aviso).getByRole('button', { name: 'Tirar a conversão' }))
    expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 5, GUIOZA, null)
    await waitFor(() => expect(aviso).toHaveTextContent('o número 0,24 já foi tirado. Agora toque em Lançar.'))
    expect(m.lancarNota).not.toHaveBeenCalled()
  })

  it('conversão de item que já vem associado do SisChef (origem "sischef"): apaga pela função da conversão do item', async () => {
    m.notasALancar.mockResolvedValue([longWay({
      itens: [{ n: 5, descricao: 'CÓD. FOR: 2894 LONG WAY GUIOZA LW LEGUMES 240G', qtd: 10, unidade_sischef: 'UN', produto_id: String(GUIOZA), produto_nome: 'GUIOZA DE LEGUMES - INSUMOS', associacao: 'sischef' }],
      associacoes_app: { '5': { produto_id: GUIOZA, produto_nome: 'GUIOZA DE LEGUMES - INSUMOS', unidade: null, conversao: 0.24, origem: 'sischef' } },
    } as unknown as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 5, null))
    expect(m.associarItem).not.toHaveBeenCalled()
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
  })
})
