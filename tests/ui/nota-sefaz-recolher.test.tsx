import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

/**
 * Pedido do Ivan (21/10/2026): "as telas das notas estão muito compridas dentro do app; eu só preciso enxergar o que precisa ser feito quando eu
 * apertar no tópico da nota. Quando eu apertar, ela abre; quando eu apertar de novo, ela fecha todas as informações."
 * A nota começa FECHADA (só o título + uma etiqueta curta com o estado); tocar no título abre tudo; tocar de novo fecha tudo.
 */
const CHAVE = '0'.repeat(44)
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, emitente: 'MERCURIO ALIMENTOS S/A', numero: '002284503', emissao: '2026-10-20', valor_nf: 2106.38, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [{ n: 1, descricao: 'CÓD. FOR: 11570 Q. GORGONZOLA - INSUMOS', qtd: 3.18, unidade_sischef: 'KG', produto_id: 3474203, associacao: 'sischef', produto_nome: 'Q. GORGONZOLA - INSUMOS' }],
  parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 2106.38 }], ...extra,
})
const tituloDe = (li: HTMLElement) => li.querySelector('summary.nota-titulo') as HTMLElement
const blocoDe = (li: HTMLElement) => within(li).getByTestId('nota-recolhivel') as HTMLDetailsElement
const visibilidade = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([nota()])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  m.fantasiasDosFornecedores.mockResolvedValue({})
})
afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); vi.restoreAllMocks() })

describe('NotaSefaz — a nota abre e fecha pelo título', () => {
  it('começa FECHADA: o título mostra nome · NF · data · valor e o resto fica escondido', async () => {
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    expect(blocoDe(li).open).toBe(false)
    expect(tituloDe(li)).toHaveTextContent('MERCURIO ALIMENTOS S/A · NF 002284503 · 20/10 · R$ 2.106,38')
    expect(tituloDe(li)).toBeVisible()
    expect(within(li).getByTestId('pagamento-fixo')).not.toBeVisible()
    expect(within(li).getByRole('button', { name: 'Lançar', hidden: true })).not.toBeVisible()
    expect(within(li).getByText('Conferir itens e financeiro')).not.toBeVisible()
  })

  it('tocar no título ABRE tudo (conferir itens e financeiro, pagamento, Lançar); tocar de novo FECHA tudo', async () => {
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(tituloDe(li))
    expect(blocoDe(li).open).toBe(true)
    expect(within(li).getByTestId('pagamento-fixo')).toBeVisible()
    expect(within(li).getByRole('button', { name: 'Lançar' })).toBeVisible()
    expect(within(li).getByText('Conferir itens e financeiro')).toBeVisible()
    await userEvent.click(tituloDe(li))
    expect(blocoDe(li).open).toBe(false)
    expect(within(li).getByTestId('pagamento-fixo')).not.toBeVisible()
    expect(within(li).getByText('Conferir itens e financeiro')).not.toBeVisible()
    expect(tituloDe(li)).toBeVisible()
  })

  it('cada nota abre e fecha sozinha: abrir uma não abre as outras', async () => {
    m.notasALancar.mockResolvedValue([nota(), nota({ chave: '1'.repeat(44), emitente: 'SEARA ALIMENTOS LTDA', numero: '000189274', valor_nf: 473.95 })])
    render(<NotaSefaz />)
    await waitFor(() => expect(screen.getAllByTestId('nota-a-lancar')).toHaveLength(2))
    const [a, b] = screen.getAllByTestId('nota-a-lancar')
    await userEvent.click(tituloDe(b))
    expect(blocoDe(a).open).toBe(false)
    expect(blocoDe(b).open).toBe(true)
  })

  it('abrir ou fechar o "Conferir itens e financeiro" de dentro NÃO fecha a nota', async () => {
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(tituloDe(li))
    const conferir = within(li).getByTestId('conferir') as HTMLDetailsElement
    await userEvent.click(conferir.querySelector('summary') as HTMLElement)
    expect(conferir.open).toBe(true)
    expect(blocoDe(li).open).toBe(true)
    await userEvent.click(conferir.querySelector('summary') as HTMLElement)
    expect(conferir.open).toBe(false)
    expect(blocoDe(li).open).toBe(true)
  })

  it('a nota aberta continua aberta quando a lista é relida (o app relê sozinho ao voltar para ele)', async () => {
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(tituloDe(li))
    m.notasALancar.mockResolvedValue([nota({ valor_nf: 2106.38 }), nota({ chave: '1'.repeat(44), emitente: 'SEARA ALIMENTOS LTDA', numero: '000189274' })])
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    visibilidade('hidden')
    visibilidade('visible')
    await waitFor(() => expect(screen.getAllByTestId('nota-a-lancar')).toHaveLength(2))
    const [primeira, segunda] = screen.getAllByTestId('nota-a-lancar')
    expect(blocoDe(primeira).open).toBe(true)     // a que o Ivan abriu segue aberta
    expect(blocoDe(segunda).open).toBe(false)     // a nova chega fechada
  })

  it('o que o Ivan digitou dentro da nota não se perde ao fechar e abrir de novo', async () => {
    m.notasALancar.mockResolvedValue([nota({ parcelas: [], valor_nf: 100 })])   // XML sem boletos: o Ivan digita a parcela
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(tituloDe(li))
    const valor = within(li).getByLabelText(/Valor da parcela 1/) as HTMLInputElement
    await userEvent.type(valor, '100,00')
    const antes = valor.value
    expect(antes).not.toBe('')
    await userEvent.click(tituloDe(li))     // fecha
    await userEvent.click(tituloDe(li))     // abre de novo
    expect((within(li).getByLabelText(/Valor da parcela 1/) as HTMLInputElement).value).toBe(antes)
  })
})

describe('NotaSefaz — etiqueta curta no título (para saber o estado sem abrir)', () => {
  const etiqueta = (li: HTMLElement) => within(tituloDe(li)).queryByTestId('nota-etiqueta')

  it('pela metade: "Ficou pela metade" em vermelho', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'erro', lancamento_motivo: 'erro no lançamento (pedido JÁ gerado)' })])
    render(<NotaSefaz />)
    const e = etiqueta(await screen.findByTestId('nota-a-lancar'))
    expect(e).toHaveTextContent('Ficou pela metade')
    expect(e).toHaveClass('etq-erro')
  })

  it('o robô lançando: "Lançando…"', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() })])
    render(<NotaSefaz />)
    expect(etiqueta(await screen.findByTestId('nota-a-lancar'))).toHaveTextContent('Lançando…')
  })

  it('o robô parou pedindo algo: "Precisa de você"', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'revisar', lancamento_motivo: 'item 1 sem conversão' })])
    render(<NotaSefaz />)
    expect(etiqueta(await screen.findByTestId('nota-a-lancar'))).toHaveTextContent('Precisa de você')
  })

  it('tudo certo para lançar (itens com produto e boletos que fecham, em Boleto): "Pronta" em verde', async () => {
    render(<NotaSefaz />)
    const e = etiqueta(await screen.findByTestId('nota-a-lancar'))
    expect(e).toHaveTextContent('Pronta')
    expect(e).toHaveClass('etq-ok')
  })

  it('item sem produto: "Falta decidir"', async () => {
    m.notasALancar.mockResolvedValue([nota({ itens: [{ n: 1, descricao: 'CÓD. FOR: 9114 MOLHO DE SOJA SACHE', qtd: 6, unidade_sischef: 'CX', produto_id: null, associacao: null }] })])
    render(<NotaSefaz />)
    expect(etiqueta(await screen.findByTestId('nota-a-lancar'))).toHaveTextContent('Falta decidir')
  })

  it('boleto sem as parcelas do XML: "Falta as parcelas"', async () => {
    m.notasALancar.mockResolvedValue([nota({ parcelas: [] })])
    render(<NotaSefaz />)
    expect(etiqueta(await screen.findByTestId('nota-a-lancar'))).toHaveTextContent('Falta as parcelas')
  })

  it('a etiqueta fica visível com a nota fechada e o título continua com o nome da nota', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'erro', lancamento_motivo: 'x' })])
    render(<NotaSefaz />)
    const li = await screen.findByTestId('nota-a-lancar')
    expect(blocoDe(li).open).toBe(false)
    expect(etiqueta(li)).toBeVisible()
    expect(tituloDe(li)).toHaveTextContent('MERCURIO ALIMENTOS S/A · NF 002284503')
  })
})
