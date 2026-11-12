// Tela Pedidos (etapa 4 da Compra): a tela de Cotações com título "Pedidos" e os itens sem vendedor em cartões
// "Compra na loja", por fornecedor. Dados INVENTADOS (repositório público).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import * as api from '../../src/lib/api'
import Cotacoes from '../../src/admin/Cotacoes'
import type { ItemSemVendedor } from '../../src/lib/tipos'
import { cotacao, item, preparo, vendedor } from '../fabricas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const SEMANA = { id: 3, data_referencia: '2026-10-19', status: 'em_compra' as const, aprovada_por: 'ivan@spazio.com', aprovada_em: '2026-10-19T11:02:00Z' }
const FULANO = vendedor()
const diaLocal = (atras: number) => {
  const d = new Date(Date.now() - atras * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const sv = (p: Partial<ItemSemVendedor>): ItemSemVendedor => ({
  item_semana_id: 1, produto_id: 1, produto: 'X', nome: 'X', unidade: 'kg', qtd: 1, motivo: 'nunca_comprado', fornecedor: null, vendedor_id: null, ...p,
})

function Local() { return <p data-testid="local">{useLocation().pathname}</p> }
const tela = () => render(
  <MemoryRouter initialEntries={['/pedidos']}>
    <Routes>
      <Route path="/pedidos" element={<Cotacoes />} />
      <Route path="/comprar" element={<Local />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  m.semanaEmCompra.mockResolvedValue(SEMANA)
  m.listarVendedores.mockResolvedValue([FULANO])
  m.cotacoesDaSemana.mockResolvedValue([cotacao({ id: 7, status: 'rascunho' })])
  m.cotacoesAnterioresVivas.mockResolvedValue([])
  m.cotacoesSubstituidasPor.mockResolvedValue([])
  m.itensDasCotacoes.mockResolvedValue([])
  m.resumosDasCotacoes.mockResolvedValue([])
  m.codigosDasCotacoes.mockResolvedValue({})
  m.pedidoDaCotacao.mockResolvedValue(null)
  m.itensDaSemana.mockResolvedValue([
    item({ id: 150, produto_id: 50, produto: 'ALHO', unidade: 'kg', preco_estimado: 20, fornecedor_ultima: 'MERCADO UM' }),
    item({ id: 151, produto_id: 51, produto: 'CEBOLA', unidade: 'kg', preco_estimado: 4, fornecedor_ultima: 'mercado  um' }),
    item({ id: 152, produto_id: 52, produto: 'SAL', unidade: 'kg', preco_estimado: null }),
    item({ id: 153, produto_id: 53, produto: 'OREGANO', unidade: 'kg', preco_estimado: 8 }),
  ])
  m.historicoDeCompras.mockResolvedValue([{
    produtoId: 53, nome: 'OREGANO', unidade: 'kg',
    linhas: [3, 10, 17].map((a) => ({ data: diaLocal(a), fornecedor: 'ATACADO NORTE', qtd: 2, precoUnit: 10, custoLiquido: 10 })),
  }])
  m.prepararCotacoes.mockResolvedValue(preparo({
    cartoes: [{ vendedor_id: 1, itens: 2, estimado: 100, cotacoes: [7] }],
    sem_vendedor: [
      sv({ item_semana_id: 150, produto_id: 50, nome: 'ALHO', qtd: 2, motivo: 'nunca_comprado' }),
      sv({ item_semana_id: 151, produto_id: 51, nome: 'CEBOLA', qtd: 3, motivo: 'fornecedor_sem_vendedor', fornecedor: 'Mercado Um' }),
      sv({ item_semana_id: 152, produto_id: 52, nome: 'SAL', qtd: 1 }),
      sv({ item_semana_id: 153, produto_id: 53, nome: 'OREGANO', qtd: 1.5 }),
    ],
  }))
})

describe('Pedidos', () => {
  it('o título é Pedidos', async () => {
    tela()
    expect(await screen.findByRole('heading', { name: /^Pedidos · semana/ })).toBeInTheDocument()
    expect(screen.queryByText('Sem vendedor (4)')).not.toBeInTheDocument()
  })

  it('mostra um cartão "Compra na loja" por fornecedor, com linhas, subtotal e o sem fornecedor por último', async () => {
    tela()
    const mercado = within(await screen.findByTestId('loja-MERCADO UM'))
    expect(mercado.getByText('Compra na loja')).toBeInTheDocument()
    expect(mercado.getByText('ALHO · 2 kg')).toBeInTheDocument()
    expect(mercado.getByText('CEBOLA · 3 kg')).toBeInTheDocument()
    expect(mercado.getByTestId('sem-vendedor-50')).toHaveTextContent(/R\$\s*40,00/)
    expect(mercado.getByTestId('sem-vendedor-51')).toHaveTextContent(/R\$\s*12,00/)
    expect(mercado.getByText('Subtotal').closest('.linha')).toHaveTextContent(/R\$\s*52,00/)
    // o motivo continua visível, em letra menor
    expect(mercado.getByText('Hoje sem vendedor: nunca comprado')).toBeInTheDocument()
    expect(mercado.getByText('Hoje sem vendedor: fornecedor sem vendedor cadastrado: Mercado Um')).toBeInTheDocument()
    // o fornecedor do histórico ganha dos outros caminhos (preço = o do histórico)
    const atacado = within(screen.getByTestId('loja-ATACADO NORTE'))
    expect(atacado.getByTestId('sem-vendedor-53')).toHaveTextContent(/R\$\s*15,00/)
    // sem fornecedor e sem preço: por último, com o aviso
    const cartoes = screen.getAllByTestId(/^loja-/).map((c) => c.getAttribute('data-testid'))
    expect(cartoes).toEqual(['loja-MERCADO UM', 'loja-ATACADO NORTE', 'loja-Sem fornecedor definido'])
    const sem = within(screen.getByTestId('loja-Sem fornecedor definido'))
    expect(sem.getByTestId('sem-vendedor-52')).toHaveTextContent('sem preço')
    expect(sem.getByText('Subtotal (1 sem preço)')).toBeInTheDocument()
  })

  it('"Fazer esta compra agora" leva para /comprar', async () => {
    tela()
    const link = within(await screen.findByTestId('loja-MERCADO UM')).getByRole('link', { name: 'Fazer esta compra agora' })
    await userEvent.click(link)
    expect(await screen.findByTestId('local')).toHaveTextContent('/comprar')
  })

  it('o "Pedir a:" de cada item continua, e grava o vendedor', async () => {
    m.definirVendedor.mockResolvedValue()
    tela()
    const caixa = within(await screen.findByTestId('sem-vendedor-50')).getByRole('combobox', { name: 'Pedir ALHO a' })
    await userEvent.selectOptions(caixa, '1')
    expect(m.definirVendedor).toHaveBeenCalledWith(50, 1)
  })

  it('rodapé: N fornecedores · M produtos e o total estimado (cotações + loja)', async () => {
    tela()
    const r = await screen.findByTestId('resumo-pedidos')
    // 1 vendedor + 3 grupos de loja; 2 itens de cotação + 4 de loja; 100 + 52 + 15 + 0
    expect(r).toHaveTextContent('4 fornecedores · 6 produtos')
    expect(r).toHaveTextContent(/Total estimado: R\$\s*167,00/)
  })

  it('se o histórico falhar, a tela continua com o fornecedor do item e da última compra', async () => {
    m.historicoDeCompras.mockRejectedValue(new Error('sem tabela'))
    tela()
    expect(await screen.findByTestId('loja-MERCADO UM')).toBeInTheDocument()
    // sem histórico, o orégano cai em "Sem fornecedor definido" (preço estimado 8 × 1,5 = 12)
    const sem = within(screen.getByTestId('loja-Sem fornecedor definido'))
    expect(sem.getByTestId('sem-vendedor-53')).toHaveTextContent(/R\$\s*12,00/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('resumo-pedidos')).toBeInTheDocument())
  })

  it('o histórico é lido uma vez só: o botão Atualizar relê as cotações, não o histórico', async () => {
    tela()
    await screen.findByTestId('loja-ATACADO NORTE')
    const leituras = m.prepararCotacoes.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(m.prepararCotacoes.mock.calls.length).toBeGreaterThan(leituras))
    expect(m.historicoDeCompras).toHaveBeenCalledTimes(1)
  })

  it('sem item sem vendedor, não há seção de loja', async () => {
    m.prepararCotacoes.mockResolvedValue(preparo({ cartoes: [{ vendedor_id: 1, itens: 2, estimado: 100, cotacoes: [7] }] }))
    tela()
    expect(await screen.findByTestId('resumo-pedidos')).toHaveTextContent('1 fornecedor · 2 produtos')
    expect(screen.queryByText('Compra na loja')).not.toBeInTheDocument()
  })
})
