import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import ListaSemana from '../../src/admin/ListaSemana'
import type { ProdutoHistorico } from '../../src/lib/sugestaoCompra'
import { item } from '../fabricas'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const sp = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

const semana = { id: 7, data_referencia: '2026-11-09', status: 'rascunho' as const, aprovada_por: null, aprovada_em: null }

const diaLocal = (atras: number) => {
  const d = new Date(Date.now() - atras * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Produto com 4 compras de 10 kg, de semana em semana, alternando os dois fornecedores (dados inventados). */
function hist(id: number, nome: string, custos: [string, number][] = [['FORNECEDOR A', 5], ['FORNECEDOR B', 6]]): ProdutoHistorico {
  const linhas = [3, 10, 17, 24].map((a, k) => ({
    data: diaLocal(a), fornecedor: custos[k % custos.length][0], qtd: 10, precoUnit: custos[k % custos.length][1], custoLiquido: custos[k % custos.length][1],
  }))
  return { produtoId: id, nome, unidade: 'kg', linhas }
}

const itens = [
  item({ id: 1, produto_id: 1, produto: 'FARINHA DE TRIGO', unidade: 'kg', estoque: 0, qtd_sugerida: 5, qtd_aprovada: 5, preco_estimado: 5 }),
  item({ id: 2, produto_id: 2, produto: 'QUEIJO MUSSARELA', unidade: 'kg', estoque: -3, qtd_sugerida: 5, qtd_aprovada: 5, preco_estimado: 30 }),
  item({ id: 3, produto_id: 3, produto: 'AZEITE', unidade: 'kg', estoque: 1, qtd_sugerida: 2, qtd_aprovada: 2, preco_estimado: 9 }),
]

beforeEach(() => {
  vi.resetAllMocks()
  m.semanaParaRevisar.mockResolvedValue(semana)
  m.itensDaSemana.mockResolvedValue(itens)
  m.contagemDaSemana.mockResolvedValue(new Map())
  m.historicoDeCompras.mockResolvedValue([
    hist(1, 'FARINHA DE TRIGO'),
    hist(2, 'QUEIJO MUSSARELA'),
    hist(3, 'AZEITE', [['FORNECEDOR A', 3], ['FORNECEDOR B', 9]]), // preço mais que o dobro: confira a unidade
  ])
  m.salvarContagem.mockResolvedValue()
  m.ajustarItem.mockResolvedValue()
  m.aprovarSemana.mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const cartaoDe = async (nome: string) => within((await screen.findByText(nome)).closest('.cartao') as HTMLElement)

type Rerender = ReturnType<typeof render>['rerender']
/** Chame logo depois de os dados aparecerem e ANTES de digitar. A 1ª desenhada com dados deixa para o React alguns efeitos pendentes (os `useEffect` que copiam o número
 *  para o campo); se um deles rodar DEPOIS de o teste digitar, ele devolve o campo ao valor antigo e o salvamento nunca acontece (visto no GitHub e reproduzido com o
 *  agendador do React atrasado). Redesenhar força o React a rodar os efeitos pendentes agora; esperar o `expect` com `waitFor` não resolve, porque o gesto não se repete. */
const assentar = (rerender: Rerender) => rerender(<ListaSemana />)

describe('Lista da semana', () => {
  it('mostra o item com precisa ter, melhor preço, diferença dos outros e comprar', async () => {
    render(<ListaSemana />)
    const c = await cartaoDe('FARINHA DE TRIGO')
    expect(c.getByText(/Precisa ter/)).toBeInTheDocument()
    expect(c.getByText('Melhor preço')).toBeInTheDocument()
    expect(c.getByText(/FORNECEDOR B:/)).toHaveTextContent('(+20%)')
    expect(c.getByLabelText('Comprar FARINHA DE TRIGO')).not.toHaveValue('')
    expect(screen.getByText(/Contagem rápida: 0 de 3 contados/)).toBeInTheDocument()
  })

  it('digitar a contagem chama a api ao sair do campo e recalcula', async () => {
    const { rerender } = render(<ListaSemana />)
    const c = await cartaoDe('FARINHA DE TRIGO')
    assentar(rerender)
    const antes = (c.getByLabelText('Comprar FARINHA DE TRIGO') as HTMLInputElement).value
    await userEvent.type(c.getByLabelText('Contei FARINHA DE TRIGO'), '1,5')
    await userEvent.tab()
    await waitFor(() => expect(m.salvarContagem).toHaveBeenCalledWith(7, 1, 1.5))
    await waitFor(() => expect(screen.getByText(/Contagem rápida: 1 de 3 contados/)).toBeInTheDocument())
    await waitFor(() => expect(c.getByLabelText('Comprar FARINHA DE TRIGO')).not.toHaveValue(antes)) // contar 1,5 em vez de estoque 0
  })

  it('campo vazio apaga a contagem', async () => {
    m.contagemDaSemana.mockResolvedValue(new Map([[1, 2]]))
    const { rerender } = render(<ListaSemana />)
    const campo = await screen.findByLabelText('Contei FARINHA DE TRIGO')
    expect(campo).toHaveValue('2')
    assentar(rerender)
    await userEvent.clear(campo)
    await userEvent.tab()
    // o salvamento sai um instante depois de o campo perder o foco: espera em vez de conferir na hora
    await waitFor(() => expect(m.salvarContagem).toHaveBeenCalledWith(7, 1, null))
  })

  it('estoque negativo sem contagem mostra aviso e "contar", sem número', async () => {
    render(<ListaSemana />)
    const c = await cartaoDe('QUEIJO MUSSARELA')
    expect(c.getByText('O SisChef mostra -3. Esse número está errado, por isso vale a contagem.')).toBeInTheDocument()
    expect(c.getByLabelText('Comprar QUEIJO MUSSARELA')).toHaveValue('')
    expect(c.getByLabelText('Comprar QUEIJO MUSSARELA')).toHaveAttribute('placeholder', 'contar')
  })

  it('conferirUnidade: aviso e nenhum selo de melhor preço; o item aparece em Conferir', async () => {
    render(<ListaSemana />)
    const c = await cartaoDe('AZEITE')
    expect(c.getByText(/Confira a unidade/)).toBeInTheDocument()
    expect(c.queryByText('Melhor preço')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Conferir/ }))
    expect(screen.getByText('AZEITE')).toBeInTheDocument()
    expect(screen.queryByText('FARINHA DE TRIGO')).toBeNull()
  })

  it('rodapé numa linha só: "Fora do total" e "Faltam contar", com texto completo para leitor de tela', async () => {
    const { rerender } = render(<ListaSemana />)
    await screen.findByText('AZEITE')
    assentar(rerender)
    const campo = within(screen.getByTestId('total').closest('.rodape') as HTMLElement)
    expect(campo.getByText(/Faltam contar: 3/)).toHaveAttribute('aria-label', 'Faltam contar 3 dos principais')
    // o azeite (unidade a conferir) não tem número até o admin digitar; digitando, ele conta como fora do total
    await userEvent.type(screen.getByLabelText('Comprar AZEITE'), '4')
    await userEvent.tab()
    expect(await campo.findByText('Fora do total: 1')).toHaveAttribute('aria-label', '1 item fora do total: confira a unidade')
  })

  it('a aba Principais limita a 20 itens', async () => {
    const muitos = Array.from({ length: 25 }, (_, k) => item({ id: k + 1, produto_id: k + 1, produto: `PRODUTO ${k + 1}`, unidade: 'kg', estoque: 0, preco_estimado: 1 }))
    m.itensDaSemana.mockResolvedValue(muitos)
    m.historicoDeCompras.mockResolvedValue(muitos.map((i) => hist(i.produto_id, i.produto)))
    render(<ListaSemana />)
    await screen.findByText(/Contagem rápida: 0 de 20 contados/)
    expect(screen.getAllByLabelText(/^Contei /)).toHaveLength(20)
    await userEvent.click(screen.getByRole('button', { name: /^Todos/ }))
    expect(screen.getAllByLabelText(/^Contei /)).toHaveLength(25)
  })

  it('aprovar grava as quantidades e aprova a semana', async () => {
    render(<ListaSemana />)
    await screen.findByText('FARINHA DE TRIGO')
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar lista' }))
    await waitFor(() => expect(m.aprovarSemana).toHaveBeenCalledWith(7))
    expect(m.ajustarItem).toHaveBeenCalledWith(1, expect.any(Number), true)
    // o item de estoque negativo sem contagem fica sem número e não é tocado
    expect(m.ajustarItem.mock.calls.some((c) => c[0] === 2)).toBe(false)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Faltam contar 3 dos principais'))
    expect(await screen.findByText(/Lista aprovada e liberada/)).toBeInTheDocument()
  })

  it('se o banco recusar a aprovação, mostra a mensagem', async () => {
    m.aprovarSemana.mockRejectedValue(new Error('Encerre a semana anterior antes de aprovar esta.'))
    render(<ListaSemana />)
    await screen.findByText('FARINHA DE TRIGO')
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar lista' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Encerre a semana anterior')
  })

  it('erro ao guardar a contagem fica visível', async () => {
    m.salvarContagem.mockRejectedValue(new Error('sem rede'))
    const { rerender } = render(<ListaSemana />)
    const c = await cartaoDe('FARINHA DE TRIGO')
    assentar(rerender)
    await userEvent.type(c.getByLabelText('Contei FARINHA DE TRIGO'), '2')
    await userEvent.tab()
    expect(await c.findByText(/Não consegui guardar a contagem. sem rede/)).toBeInTheDocument()
  })

  it('número digitado errado mostra erro e não chama a api', async () => {
    const { rerender } = render(<ListaSemana />)
    const c = await cartaoDe('FARINHA DE TRIGO')
    assentar(rerender)
    await userEvent.type(c.getByLabelText('Contei FARINHA DE TRIGO'), 'abc')
    await userEvent.tab()
    expect(c.getByText(/Digite só o número/)).toBeInTheDocument()
    expect(m.salvarContagem).not.toHaveBeenCalled()
  })

  it('ajuste manual vence o cálculo e dá para voltar ao calculado', async () => {
    const { rerender } = render(<ListaSemana />)
    const c = await cartaoDe('FARINHA DE TRIGO')
    assentar(rerender)
    const campo = c.getByLabelText('Comprar FARINHA DE TRIGO')
    await userEvent.clear(campo)
    await userEvent.type(campo, '99')
    await userEvent.tab()
    expect(c.getByText(/Ajustado por você/)).toBeInTheDocument()
    expect(campo).toHaveValue('99')
    expect(sp(screen.getByTestId('total').textContent)).toContain('495,00') // 99 × R$ 5; o azeite (unidade a conferir) fica fora do total
    await userEvent.click(c.getByRole('button', { name: 'Voltar ao calculado' }))
    expect(c.queryByText(/Ajustado por você/)).toBeNull()
  })

  it('erro de leitura mostra "Tentar de novo"', async () => {
    m.semanaParaRevisar.mockRejectedValueOnce(new Error('falhou'))
    render(<ListaSemana />)
    expect(await screen.findByRole('alert')).toHaveTextContent('falhou')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('FARINHA DE TRIGO')).toBeInTheDocument()
  })

  it('sem semana avisa e oferece a lista antiga', async () => {
    m.semanaParaRevisar.mockResolvedValue(null)
    render(<ListaSemana />)
    expect(await screen.findByText(/Nenhuma lista nova/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir a lista antiga' })).toHaveAttribute('href', '#/lista')
  })

  it('histórico vazio: a tela funciona com a lista antiga e avisa', async () => {
    m.historicoDeCompras.mockResolvedValue([])
    render(<ListaSemana />)
    expect(await screen.findByText(/O histórico de compras ainda não chegou/)).toBeInTheDocument()
    const c = await cartaoDe('FARINHA DE TRIGO')
    expect(c.getByText(/Compra de vez em quando/)).toBeInTheDocument()
    expect(c.getByLabelText('Comprar FARINHA DE TRIGO')).toHaveValue('5')
    expect(screen.queryByRole('button', { name: /^Principais/ })).toBeNull()
  })
})
