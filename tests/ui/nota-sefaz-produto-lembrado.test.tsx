// Produto lembrado por fornecedor (pedido do Ivan, 14/11/2026): o item sem produto no SisChef cujo CÓD. FOR + unidade já teve produto escolhido nas notas lançadas daquele
// fornecedor é associado SOZINHO pelo app (mesmo caminho do toque do Ivan) e mostra "lembrado da nota de dd/mm". Tudo INVENTADO (repositório público).
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'
import type { ProdutoLembrado } from '../../src/admin/produtoLembrado'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '4'.repeat(44)
const CNPJ = '12345678000190'
const GUARANA = 3324211
const CATALOGO: ProdutoCatalogo[] = [{ produto_id: GUARANA, nome: 'GUARANA DIET LATA 350 ML', unidade: 'un' }]
const LEMBRADO: ProdutoLembrado = { cod_forn: '0009085', unidade_nota: 'CX', produto_id: GUARANA, produto_nome: 'GUARANA DIET LATA', conversao: 12, vezes: 2, ultima_em: '2026-11-08T02:30:00Z' }

let decisoes: Record<string, unknown> | null = null
const nota = (): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: CNPJ, emitente: 'OLIVEIRA E OLIVEIRA', numero: '000555', emissao: '2026-11-14', valor_nf: 300,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: 'boleto', parcelas: [{ numero: '001', vencimento: '2026-12-01', valor: 300 }],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET LT 350ML SH 32,3500', qtd: 2, unidade_sischef: 'CX', produto_id: null }],
  associacoes_app: decisoes, lancamento_estado: null, lancamento_motivo: null,
} as unknown as NotaSefazLista)

const item = async () => within((await within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item'))[0])
const leituraFeita = async () => {
  await waitFor(() => expect(m.produtoLembradoDoFornecedor).toHaveBeenCalled())
  await waitFor(() => expect(m.catalogoProdutos).toHaveBeenCalled())
  await act(async () => { await Promise.allSettled([...m.produtoLembradoDoFornecedor.mock.results, ...m.catalogoProdutos.mock.results].map((r) => r.value)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}

beforeEach(() => {
  vi.resetAllMocks()
  decisoes = null
  m.notasALancar.mockImplementation(async () => [nota()])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.memoriaDeEmbalagem.mockResolvedValue([])
  m.produtoLembradoDoFornecedor.mockResolvedValue([LEMBRADO])
  m.associarItem.mockImplementation(async (_c, n, produto, conversao) => {
    decisoes = produto == null ? null : { [String(n)]: { produto_id: produto, produto_nome: 'GUARANA DIET LATA', unidade: 'un', conversao, origem: 'lista' } }
  })
})

describe('NotaSefaz — produto lembrado por fornecedor', () => {
  it('associa sozinho UMA vez, com a conversão lembrada, e mostra "lembrado da nota de 07/11"', async () => {
    render(<NotaSefaz />)

    expect(await screen.findByTestId('item-lembrado', {}, { timeout: 4000 })).toHaveTextContent('lembrado da nota de 07/11')
    expect(m.produtoLembradoDoFornecedor).toHaveBeenCalledWith(CNPJ)
    expect(m.associarItem).toHaveBeenCalledTimes(1)
    expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, GUARANA, 12)
    expect((await item()).getByRole('button', { name: 'Editar' })).toBeEnabled()
  })

  it('sem nada lembrado: não associa e a tela é a de sempre', async () => {
    m.produtoLembradoDoFornecedor.mockResolvedValue([])
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarItem).not.toHaveBeenCalled()
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument()
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })

  it('produto lembrado fora da lista de insumos: não associa', async () => {
    m.catalogoProdutos.mockResolvedValue([{ produto_id: 999, nome: 'OUTRO', unidade: 'un' }])
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarItem).not.toHaveBeenCalled()
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument()
  })

  it('a leitura do lembrado falha: não associa e a tela é a de sempre', async () => {
    m.produtoLembradoDoFornecedor.mockRejectedValue(new Error('rede'))
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarItem).not.toHaveBeenCalled()
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })

  it('decisão que o Ivan já tomou não é sobreposta', async () => {
    decisoes = { '1': { produto_id: GUARANA, produto_nome: 'GUARANA DIET LATA', unidade: 'un', conversao: 6, origem: 'lista' } }
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarItem).not.toHaveBeenCalled()
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument() // a conversão dele (6) não é a lembrada (12)
  })

  it('o Ivan desfaz a escolha: o app não volta a associar', async () => {
    const user = userEvent.setup()
    render(<NotaSefaz />)
    await screen.findByTestId('item-lembrado', {}, { timeout: 4000 })
    await user.click((await item()).getByRole('button', { name: 'Editar' }))
    await user.click((await item()).getByRole('button', { name: 'Desfazer a escolha' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenLastCalledWith(CHAVE, 1, null, null))
    await waitFor(() => expect(screen.getByText('sem associação')).toBeInTheDocument())
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(m.associarItem).toHaveBeenCalledTimes(2)
  })

  it('a gravação automática falha: não tenta de novo em laço', async () => {
    m.associarItem.mockRejectedValue(new Error('rede'))
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(m.associarItem).toHaveBeenCalledTimes(1)
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })
})
