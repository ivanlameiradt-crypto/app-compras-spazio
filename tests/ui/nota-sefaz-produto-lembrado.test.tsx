// Produto lembrado por fornecedor (pedido do Ivan, 14/11/2026): o item sem produto no SisChef cujo CÓD. FOR + unidade já teve produto escolhido nas notas lançadas daquele
// fornecedor é associado SOZINHO (cot_nfe_associar_lembrado) só com o preço na faixa e a mesma unidade; senão vira o botão "Usar o lembrado". Tudo INVENTADO (repositório público).
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
const LEMBRADO: ProdutoLembrado = { cod_forn: '0009085', unidade_nota: 'CX', produto_id: GUARANA, produto_nome: 'GUARANA DIET LATA', unidade: 'un', conversao: 12, preco_ref: 36, vezes: 1, ultima_em: '2026-11-08T02:30:00Z' }
const MARCA = 'associado sozinho, igual à nota de 07/11 (1 CX = 12)'
const BOTAO = 'Usar o lembrado: GUARANA DIET LATA 350 ML × 12'

let decisoes: Record<string, unknown> | null = null
let recusados: number[] = []
let valorDaLinha = 75
const nota = (): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: CNPJ, emitente: 'OLIVEIRA E OLIVEIRA', numero: '000555', emissao: '2026-11-14', valor_nf: 300,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: 'boleto', parcelas: [{ numero: '001', vencimento: '2026-12-01', valor: 300 }],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 0009085 GUARANA ANTARCTICA DIET LT 350ML SH 32,3500', qtd: 2, valor: valorDaLinha, unidade_sischef: 'CX', produto_id: null }],
  associacoes_app: decisoes, lembrado_recusado: recusados, lancamento_estado: null, lancamento_motivo: null,
} as unknown as NotaSefazLista)
const decisao = (origem: string, conversao: number | null = 12) => ({ '1': { produto_id: GUARANA, produto_nome: 'GUARANA DIET LATA', unidade: 'un', conversao, origem } })

const item = async () => within((await within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item'))[0])
const leituraFeita = async () => {
  await waitFor(() => expect(m.produtoLembradoDoFornecedor).toHaveBeenCalled())
  await waitFor(() => expect(m.catalogoProdutos).toHaveBeenCalled())
  await act(async () => { await Promise.allSettled([...m.produtoLembradoDoFornecedor.mock.results, ...m.catalogoProdutos.mock.results].map((r) => r.value)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

beforeEach(() => {
  vi.resetAllMocks()
  decisoes = null; recusados = []; valorDaLinha = 75
  m.notasALancar.mockImplementation(async () => [nota()])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.memoriaDeEmbalagem.mockResolvedValue([])
  m.produtoLembradoDoFornecedor.mockResolvedValue([LEMBRADO])
  m.associarLembrado.mockImplementation(async (_c, _n, _p, conv) => {
    if (decisoes || recusados.includes(1)) return false
    decisoes = decisao('lembrado', conv); return true
  })
  m.recusarLembrado.mockImplementation(async (_c, n) => { if (!recusados.includes(n)) recusados = [...recusados, n] })
  m.associarItem.mockImplementation(async (_c, n, produto, conversao) => {
    decisoes = produto == null ? null : { [String(n)]: { produto_id: produto, produto_nome: 'GUARANA DIET LATA', unidade: 'un', conversao, origem: 'lista' } }
  })
})

describe('NotaSefaz — produto lembrado por fornecedor', () => {
  it('preço na faixa e mesma unidade: associa sozinho UMA vez (origem lembrado) e mostra a marca', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByTestId('item-lembrado', {}, { timeout: 4000 })).toHaveTextContent(MARCA)
    expect(m.produtoLembradoDoFornecedor).toHaveBeenCalledWith(CNPJ)
    expect(m.associarLembrado).toHaveBeenCalledTimes(1)
    expect(m.associarLembrado).toHaveBeenCalledWith(CHAVE, 1, GUARANA, 12)
    expect(m.associarItem).not.toHaveBeenCalled()
    expect((await item()).getByRole('button', { name: 'Editar' })).toBeEnabled()
  })

  it.each([
    ['fardo vizinho (preço 1,5× o lembrado)', () => { valorDaLinha = 108 }],
    ['sem preço de referência', () => { m.produtoLembradoDoFornecedor.mockResolvedValue([{ ...LEMBRADO, preco_ref: null }]) }],
    ['unidade do produto diferente da lembrada', () => { m.produtoLembradoDoFornecedor.mockResolvedValue([{ ...LEMBRADO, unidade: 'kg' }]) }],
    ['abaixo do limiar de notas', () => { m.produtoLembradoDoFornecedor.mockResolvedValue([{ ...LEMBRADO, vezes: 0 }]) }],
  ])('%s: NÃO grava sozinho; o botão de um toque associa', async (_nome, preparar) => {
    preparar()
    const user = userEvent.setup()
    render(<NotaSefaz />)
    const botao = await screen.findByRole('button', { name: BOTAO }, { timeout: 4000 })
    await leituraFeita()
    expect(m.associarLembrado).not.toHaveBeenCalled()
    await user.click(botao)
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, GUARANA, 12))
    await waitFor(() => expect(screen.queryByTestId('usar-lembrado')).not.toBeInTheDocument())
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument()
  })

  it('sem nada lembrado: tela de sempre', async () => {
    m.produtoLembradoDoFornecedor.mockResolvedValue([])
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarLembrado).not.toHaveBeenCalled()
    expect(screen.queryByTestId('usar-lembrado')).not.toBeInTheDocument()
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })

  it('produto lembrado fora da lista de insumos: nem grava nem sugere', async () => {
    m.catalogoProdutos.mockResolvedValue([{ produto_id: 999, nome: 'OUTRO', unidade: 'un' }])
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarLembrado).not.toHaveBeenCalled()
    expect(screen.queryByTestId('usar-lembrado')).not.toBeInTheDocument()
  })

  it('a leitura do lembrado falha: tela de sempre', async () => {
    m.produtoLembradoDoFornecedor.mockRejectedValue(new Error('rede'))
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarLembrado).not.toHaveBeenCalled()
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })

  it('decisão do Ivan igual à lembrada: não grava nada e NÃO ganha a marca', async () => {
    decisoes = decisao('lista')
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    expect(m.associarLembrado).not.toHaveBeenCalled()
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument()
  })

  it('o Ivan desfaz a associação automática: guarda a recusa e, REABRINDO a tela, o app não associa de novo (só sugere)', async () => {
    const user = userEvent.setup()
    const tela = render(<NotaSefaz />)
    await screen.findByTestId('item-lembrado', {}, { timeout: 4000 })
    await user.click((await item()).getByRole('button', { name: 'Editar' }))
    await user.click((await item()).getByRole('button', { name: 'Desfazer a escolha' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenLastCalledWith(CHAVE, 1, null, null))
    expect(m.recusarLembrado).toHaveBeenCalledWith(CHAVE, 1)
    tela.unmount()
    render(<NotaSefaz />)
    await screen.findByRole('button', { name: BOTAO }, { timeout: 4000 })
    await leituraFeita()
    expect(m.associarLembrado).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('item-lembrado')).not.toBeInTheDocument()
  })

  it('outra tela já gravou (a função devolve false): não sobrescreve nem insiste', async () => {
    m.associarLembrado.mockResolvedValue(false)
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(m.associarLembrado).toHaveBeenCalledTimes(1)
    expect(m.associarItem).not.toHaveBeenCalled()
  })

  it('a gravação automática falha: não tenta de novo em laço', async () => {
    m.associarLembrado.mockRejectedValue(new Error('rede'))
    render(<NotaSefaz />)
    await item()
    await leituraFeita()
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(m.associarLembrado).toHaveBeenCalledTimes(1)
    expect(screen.getByText('sem associação')).toBeInTheDocument()
  })
})
