import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import { lembrarForma } from '../../src/admin/notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '0'.repeat(44)
const item = (extra: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  ({ descricao: 'TOMATE ITALIANO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196, associacao: 'sischef', ...extra })
const nota = (extra: Partial<NotaSefazLista>): NotaSefazLista => ({
  chave: CHAVE, emitente: 'ATACADAO S.A.', numero: '123', emissao: '2026-10-03',
  valor_nf: 100, situacao: 'na_fila', lancada_em: null, nf_sischef: null, itens: [item()], ...extra,
})
const aLancar = (...n: NotaSefazLista[]) => m.notasALancar.mockResolvedValue(n)
/**
 * XML já lido pelo robô, com 1 boleto que fecha com os R$ 100 da nota. Regra do Ivan (07/10): com o XML por ler (`parcelas` null, o padrão da
 * fixture `nota`) e Boleto marcado, o Ivan DIGITA as parcelas e o Lançar só libera quando a soma fecha. Os testes que não são sobre parcelas e
 * querem uma nota em boleto que já dá para lançar usam esta leitura.
 */
const LIDA: Partial<NotaSefazLista> = { parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }] }
const comoPagar = () => screen.getByLabelText('Como pagar') as HTMLSelectElement
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.descartarNota.mockResolvedValue(undefined)
  m.restaurarNota.mockResolvedValue(undefined)
  m.catalogoProdutos.mockResolvedValue([])
  m.associarItem.mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz', () => {
  it('mostra o título e o modo "eu disparo"', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByRole('heading', { name: 'Lançamento fiscal' })).toBeInTheDocument()
    expect(screen.getByText(/eu disparo/)).toBeInTheDocument()
  })

  it('sem notas: avisa que não há pendentes nem lançadas', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByText('Nenhuma nota pendente da SEFAZ agora.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma nota lançada ainda.')).toBeInTheDocument()
  })

  it('nome fantasia do app (pedido do Ivan, 08/10): as linhas mostram a fantasia (CNPJ lido da chave), sem fantasia a razão; o detalhe da lançada traz "Fornecedor: razão · CNPJ"', async () => {
    const chaveMateus = '15' + '2610' + '03995515011363' + '55'.padEnd(24, '0')
    m.fantasiasDosFornecedores.mockResolvedValue({ '03995515011363': 'MATEUS SUPERMERCADOS' })
    aLancar(nota({ chave: chaveMateus, emitente: 'MATEUS SUPERMERCADOS SA', numero: '89284', valor_nf: 500 }), nota({ chave: '2'.repeat(44), emitente: 'MERCURIO ALIMENTOS S/A', numero: '9', valor_nf: 10 }))
    m.notasLancadas.mockResolvedValue([nota({ chave: chaveMateus, emitente: 'MATEUS SUPERMERCADOS SA', numero: '89000', valor_nf: 321, situacao: 'lancada', lancada_em: '2026-10-07T12:00:00Z', nf_sischef: '777' })])
    render(<NotaSefaz />)
    await waitFor(() => expect(screen.getAllByTestId('nota-a-lancar')[0]).toHaveTextContent('MATEUS SUPERMERCADOS · NF 89284'))
    expect(screen.getAllByTestId('nota-a-lancar')[0]).not.toHaveTextContent('MATEUS SUPERMERCADOS SA')
    expect(screen.getAllByTestId('nota-a-lancar')[1]).toHaveTextContent('MERCURIO ALIMENTOS S/A')               // sem fantasia: a razão
    const lancada = await screen.findByTestId('nota-lancada')
    expect(lancada).toHaveTextContent('lançada ✓ · MATEUS SUPERMERCADOS · NF 89000')
    await userEvent.click(within(lancada).getByRole('button'))
    expect(await screen.findByTestId('detalhe-fornecedor')).toHaveTextContent('Fornecedor: MATEUS SUPERMERCADOS SA · CNPJ 03.995.515/0113-63')
  })

  it('regra do Ivan (09/10): o detalhe da nota lançada mostra a unidade do produto no banco (planilha), não a que a tela do SisChef trouxe na linha', async () => {
    m.catalogoProdutos.mockResolvedValue([{ produto_id: 3469726, nome: 'BATATA CRINKLE - INSUMOS (KG)', unidade: 'kg' }])
    m.notasLancadas.mockResolvedValue([nota({ chave: '3'.repeat(44), emitente: 'MATEUS', numero: '77', valor_nf: 10, situacao: 'lancada', lancada_em: '2026-10-09T12:00:00Z', nf_sischef: '99',
      itens: [item({ descricao: 'BATATA CRINKLE', qtd: 24, unidade_sischef: 'UN', produto_id: 3469726 })] })])
    render(<NotaSefaz />)
    await userEvent.click(within(await screen.findByTestId('nota-lancada')).getByRole('button'))
    await waitFor(() => expect(screen.getByText(/BATATA CRINKLE/).closest('li')).toHaveTextContent('24 kg'))
  })

  it('lista as notas a lançar (emitente, NF, valor)', async () => {
    aLancar(nota({ chave: '1'.repeat(44), emitente: 'MATEUS', numero: '555', valor_nf: 1291.3 }))
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    expect(linha).toHaveTextContent('MATEUS')
    expect(linha).toHaveTextContent('NF 555')
    expect(linha).toHaveTextContent(/R\$\s1\.291,30/)
  })

  it('clica numa nota lançada e abre o detalhe (NF no SisChef + itens)', async () => {
    m.notasLancadas.mockResolvedValue([nota({
      chave: '2'.repeat(44), emitente: 'ATACADAO', numero: '777', situacao: 'lancada',
      lancada_em: '2026-10-05T12:00:00Z', nf_sischef: '63980',
      itens: [{ descricao: 'TOMATE ITALIANO', qtd: 8, unidade_sischef: 'KG', produto_id: 3482196 }],
    })])
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-lancada')
    expect(screen.queryByText(/63980/)).not.toBeInTheDocument() // fechado
    await userEvent.click(within(linha).getByRole('button'))
    expect(await screen.findByText(/NF no SisChef/)).toBeInTheDocument()
    expect(screen.getByText(/63980/)).toBeInTheDocument()
    expect(screen.getByText('TOMATE ITALIANO')).toBeInTheDocument()
    expect(screen.getByText('8 kg')).toBeInTheDocument()                                 // só o peso e a unidade, sem "qtd"
    expect(screen.getByTestId('detalhe-quando')).toHaveTextContent('Lançada em: 05/10 às 09h00') // 12:00 UTC = 09h00 em Brasília/Belém
  })

  it('detalhe da nota lançada: o número do produto no SisChef no lugar do "CÓD. FOR" do fornecedor, e o dia e a hora do lançamento', async () => {
    m.notasLancadas.mockResolvedValue([nota({
      chave: '2'.repeat(44), emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089282', situacao: 'lancada',
      lancada_em: '2026-10-06T22:05:59.459928+00:00', nf_sischef: '89282',
      itens: [
        { descricao: 'CÓD. FOR: 28236 ## GUARANÁ ANTARC. 350ML', qtd: 180, unidade_sischef: 'UN', produto_id: '1836986' as unknown as number, associacao: 'sischef', produto_nome: 'GUARANÁ ANTARC. 350ML' },
        { descricao: 'CÓD. FOR: 55 SEM PRODUTO NO REGISTRO', qtd: 2, unidade_sischef: 'KG', produto_id: null },
        { descricao: 'CÓD. FOR: 11570 Q. GORGONZOLA - INSUMOS', qtd: 3.09, unidade_sischef: 'KG', produto_id: 3474203, associacao: 'sischef' },
      ],
    })])
    render(<NotaSefaz />)
    await userEvent.click(within(await screen.findByTestId('nota-lancada')).getByRole('button'))
    const detalhe = (await screen.findByText(/NF no SisChef/)).closest('.detalhe') as HTMLElement
    const linhas = within(detalhe).getAllByRole('listitem')
    expect(linhas[0]).toHaveTextContent('1836986 ## GUARANÁ ANTARC. 350ML')
    expect(linhas[0]).toHaveTextContent(/180 un$/)                                   // só a quantidade e a unidade, sem a abreviação "qtd"
    expect(detalhe).not.toHaveTextContent(/qtd/i)
    expect(linhas[0].querySelector('b.cod')).toHaveTextContent('1836986')           // o número do produto fica em destaque
    expect(linhas[1]).toHaveTextContent('SEM PRODUTO NO REGISTRO')                  // sem produto_id: sem número, e mesmo assim sem o código do fornecedor
    expect(linhas[1].querySelector('b.cod')).toBeNull()
    expect(linhas[2]).toHaveTextContent(/3474203 Q\. GORGONZOLA - INSUMOS3,09 kg$/)  // peso com vírgula e a unidade cadastrada, sem "qtd"
    expect(detalhe).not.toHaveTextContent(/CÓD\. FOR/)
    expect(detalhe).not.toHaveTextContent('28236')                                   // o código do fornecedor sumiu de vez
    expect(within(detalhe).getByTestId('detalhe-quando')).toHaveTextContent('Lançada em: 06/10 às 19h05') // 22:05 UTC = 19h05 em Belém
    expect(detalhe.textContent!.indexOf('Lançada em')).toBeLessThan(detalhe.textContent!.indexOf('NF no SisChef'))
  })

  it('detalhe da nota lançada sem a data gravada: não mostra a linha "Lançada em"', async () => {
    m.notasLancadas.mockResolvedValue([nota({ chave: '3'.repeat(44), situacao: 'lancada', lancada_em: null, nf_sischef: '1' })])
    render(<NotaSefaz />)
    await userEvent.click(within(await screen.findByTestId('nota-lancada')).getByRole('button'))
    await screen.findByText(/NF no SisChef/)
    expect(screen.queryByTestId('detalhe-quando')).not.toBeInTheDocument()
  })

  describe('Como pagar', () => {
    it('Boleto já vem marcado por padrão e as opções são as combinadas (7 contas PIX)', async () => {
      aLancar(nota({}))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
      const valores = within(comoPagar()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
      expect(valores).toEqual([
        'boleto', 'dinheiro', 'tesouraria',
        'pix:pangbank|ij', 'pix:pangbank|sp', 'pix:bradesco|ij', 'pix:bradesco|sp', 'pix:itau|ij', 'pix:caixa|ij', 'pix:caixa|sp',
        'cartao',
      ])
      expect(screen.getByRole('option', { name: 'Caixa — Kūkan (S P Delivery)' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Cartão (só estoque)' })).toBeInTheDocument()
    })

    it('lembra a última escolha por fornecedor (e outro fornecedor continua em Boleto)', async () => {
      aLancar(nota({ emitente: 'ATACADAO S.A.' }), nota({ chave: '1'.repeat(44), emitente: 'MATEUS', numero: '9' }))
      const { unmount } = render(<NotaSefaz />)
      const [atacadao, mateus] = await screen.findAllByTestId('nota-a-lancar')
      await userEvent.selectOptions(within(atacadao).getByLabelText('Como pagar'), 'dinheiro')
      expect((within(mateus).getByLabelText('Como pagar') as HTMLSelectElement).value).toBe('boleto')
      unmount()

      render(<NotaSefaz />)
      const [atacadao2, mateus2] = await screen.findAllByTestId('nota-a-lancar')
      expect((within(atacadao2).getByLabelText('Como pagar') as HTMLSelectElement).value).toBe('dinheiro')
      expect((within(mateus2).getByLabelText('Como pagar') as HTMLSelectElement).value).toBe('boleto')
    })

    it('PIX nunca é lembrado: na próxima vez a tela volta em Boleto e a conta tem de ser escolhida de novo', async () => {
      aLancar(nota({ emitente: 'ATACADAO S.A.' }))
      const { unmount } = render(<NotaSefaz />)
      await userEvent.selectOptions(await screen.findByLabelText('Como pagar'), 'pix:caixa|sp')
      unmount()

      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
    })

    it('a memória ignora valor inválido e a tela funciona sem localStorage', async () => {
      aLancar(nota({}))
      localStorage.setItem('spazio.notaSefaz.forma.ATACADAO S.A.', 'qualquer-coisa')
      const { unmount } = render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
      unmount()

      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado') })
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
      await userEvent.selectOptions(comoPagar(), 'dinheiro') // gravar falha em silêncio
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'dinheiro')
    })

    it('a forma já gravada na nota vale mais que a memória', async () => {
      lembrarForma('ATACADAO S.A.', 'dinheiro')
      aLancar(nota({ forma_pagamento: 'pix:bradesco|ij', lancamento_estado: 'ensaio_ok' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('pix:bradesco|ij')
    })

    it('"sem boletos": não adivinha — pede para escolher e só libera o Lançar depois', async () => {
      aLancar(nota({ forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('')
      expect(botaoLancar()).toBeDisabled()
      await userEvent.selectOptions(comoPagar(), 'tesouraria')
      expect(botaoLancar()).toBeEnabled()
    })
  })

  describe('Lançar em dois toques', () => {
    it('1º toque só pergunta; Confirmar chama lancarNota(chave, forma) UMA vez e recarrega a lista', async () => {
      aLancar(nota({}))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      await userEvent.selectOptions(comoPagar(), 'pix:pangbank|ij')
      await userEvent.click(botaoLancar())
      expect(m.lancarNota).not.toHaveBeenCalled()
      expect(screen.getByText('Vai lançar a NF 123 de ATACADAO S.A. — pagamento: PIX — Pang Bank — Spazio (I J Lameira). Confirmar?')).toBeInTheDocument()
      const chamadasAntes = m.notasALancar.mock.calls.length
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      expect(m.lancarNota).toHaveBeenCalledTimes(1)
      expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'pix:pangbank|ij')
      await waitFor(() => expect(m.notasALancar.mock.calls.length).toBe(chamadasAntes + 1))
      expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
    })

    it('Cancelar não chama nada; trocar a forma desfaz a pergunta', async () => {
      aLancar(nota({}))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      await userEvent.selectOptions(comoPagar(), 'dinheiro') // regra 07/10: em Boleto com o XML por ler o Lançar espera as parcelas; à vista não
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
      await userEvent.click(botaoLancar())
      await userEvent.selectOptions(comoPagar(), 'tesouraria')
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
      expect(m.lancarNota).not.toHaveBeenCalled()
    })

    it('duplo toque em Confirmar não manda duas vezes (botão trava enquanto envia)', async () => {
      aLancar(nota(LIDA))
      let liberar!: () => void
      m.lancarNota.mockImplementation(() => new Promise<void>((r) => { liberar = r }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      await userEvent.click(botaoLancar())
      const confirmar = screen.getByRole('button', { name: 'Confirmar' })
      await userEvent.dblClick(confirmar)
      expect(m.lancarNota).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled()
      await act(async () => { liberar() })
    })

    it('erro do servidor aparece em português e a nota pode ser tentada de novo', async () => {
      aLancar(nota(LIDA))
      m.lancarNota.mockRejectedValue(new Error('Não consegui chamar o robô agora, tente de novo.'))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui chamar o robô agora, tente de novo.')
      expect(botaoLancar()).toBeEnabled()
    })
  })

  describe('bloqueios', () => {
    it('item sem produto no SisChef (produto_id vazio): bloqueia e explica', async () => {
      aLancar(nota({ itens: [item(), item({ descricao: 'SEARA FRANGO', produto_id: null })] }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef: escolha o produto na caixa de associação (ou associe no SisChef) antes de lançar')
      expect(botaoLancar()).toBeDisabled()
    })

    it('item associado só pelo "painel" também bloqueia', async () => {
      aLancar(nota({ itens: [item({ associacao: 'painel' })] }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef')
      expect(botaoLancar()).toBeDisabled()
    })

    it.each(['KONDO COMERCIO LTDA', 'Mercado Livre Brasil', 'MERCADO LIVRE.COM'])('conta especial (%s) bloqueia', async (emitente) => {
      aLancar(nota({ emitente }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Conta especial: essa nota não é lançada pelo app')
      expect(botaoLancar()).toBeDisabled()
      await userEvent.click(botaoLancar())
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
    })

    it('nota boa (todos os itens com produto) não tem bloqueio', async () => {
      aLancar(nota({ ...LIDA, itens: [item(), item({ associacao: null })] }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
      expect(botaoLancar()).toBeEnabled()
    })
  })

  describe('estado do robô', () => {
    it("'erro' (pela metade): avisa para NÃO lançar de novo e bloqueia o Lançar", async () => {
      aLancar(nota({ lancamento_estado: 'erro', lancamento_motivo: 'faltou gerar a NF' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Ficou pela metade — NÃO lance de novo')
      expect(botaoLancar()).toBeDisabled()
      await userEvent.click(botaoLancar())
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
      expect(m.lancarNota).not.toHaveBeenCalled()
    })

    it("'revisar': mostra o motivo, traduzindo o do boleto", async () => {
      aLancar(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: A nota não tem boleto: escolha como pagar')
    })

    it("'revisar' com outro motivo mostra o motivo como veio e deixa tentar de novo", async () => {
      aLancar(nota({ ...LIDA, lancamento_estado: 'revisar', lancamento_motivo: 'item   X sem  unidade' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: item X sem unidade')
      expect(botaoLancar()).toBeEnabled()
    })

    it("'ensaio_ok': mostra o que o robô faria e nada foi criado", async () => {
      aLancar(nota({ ...LIDA, lancamento_estado: 'ensaio_ok', lancamento_motivo: 'criaria compra com 3 itens e 3 boletos' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Ensaio ok (nada foi criado): criaria compra com 3 itens e 3 boletos')
      expect(botaoLancar()).toBeEnabled()
    })

    it("'lancando': mostra que o robô trabalha e não deixa lançar", async () => {
      aLancar(nota({ lancamento_estado: 'lancando' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Lançando… (o robô está trabalhando)')
      expect(botaoLancar()).toBeDisabled()
    })

    it("'lancando' preso há mais de 30 min: avisa para conferir no SisChef e deixa lançar de novo", async () => {
      const velho = new Date(Date.now() - 31 * 60_000).toISOString()
      aLancar(nota({ ...LIDA, lancamento_estado: 'lancando', lancamento_estado_em: velho }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('O robô não respondeu em 30 min. Confira no SisChef')
      expect(botaoLancar()).toBeEnabled()
    })

    it("com outra nota 'lancando', o Lançar das demais fica bloqueado com aviso (o robô é um por vez)", async () => {
      const agora = new Date().toISOString()
      aLancar(
        nota({ chave: '1'.repeat(44), emitente: 'A LTDA', lancamento_estado: 'lancando', lancamento_estado_em: agora }),
        nota({ chave: '2'.repeat(44), emitente: 'B LTDA' }),
      )
      render(<NotaSefaz />)
      const [lancandoA, livreB] = await screen.findAllByTestId('nota-a-lancar')
      expect(within(lancandoA).getByRole('button', { name: 'Lançar' })).toBeDisabled()
      expect(within(livreB).getByRole('button', { name: 'Lançar' })).toBeDisabled()
      expect(within(livreB).getByTestId('aviso-outra')).toHaveTextContent('o robô está lançando outra nota')
      expect(within(lancandoA).queryByTestId('aviso-outra')).not.toBeInTheDocument() // a própria nota só mostra "Lançando…"
    })

    it("nota 'lancando' presa (> 30 min) NÃO bloqueia as outras", async () => {
      const velho = new Date(Date.now() - 31 * 60_000).toISOString()
      aLancar(
        nota({ chave: '1'.repeat(44), emitente: 'A LTDA', lancamento_estado: 'lancando', lancamento_estado_em: velho }),
        nota({ ...LIDA, chave: '2'.repeat(44), emitente: 'B LTDA' }),
      )
      render(<NotaSefaz />)
      const [, livreB] = await screen.findAllByTestId('nota-a-lancar')
      expect(within(livreB).getByRole('button', { name: 'Lançar' })).toBeEnabled()
      expect(within(livreB).queryByTestId('aviso-outra')).not.toBeInTheDocument()
    })

    it('enquanto um Confirmar está enviando, as outras notas ficam bloqueadas (sem 2 disparos juntos)', async () => {
      let liberar: () => void = () => undefined
      m.lancarNota.mockImplementation(() => new Promise<void>((ok) => { liberar = ok }))
      aLancar(nota({ ...LIDA, chave: '1'.repeat(44), emitente: 'A LTDA' }), nota({ ...LIDA, chave: '2'.repeat(44), emitente: 'B LTDA' }))
      render(<NotaSefaz />)
      const [a, b] = await screen.findAllByTestId('nota-a-lancar')
      await userEvent.click(within(a).getByRole('button', { name: 'Lançar' }))
      await userEvent.click(within(a).getByRole('button', { name: 'Confirmar' }))
      expect(within(b).getByRole('button', { name: 'Lançar' })).toBeDisabled()
      expect(m.lancarNota).toHaveBeenCalledTimes(1)
      await act(async () => { liberar() })
      await waitFor(() => expect(m.lancarNota).toHaveBeenCalledTimes(1))
    })

    it('sem estado: nenhum status aparece', async () => {
      aLancar(nota({}))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('status-nota')).not.toBeInTheDocument()
    })
  })

  describe('releitura automática', () => {
    const INTERVALO = 15_000
    const avancar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    // Sem findBy/waitFor aqui: eles usam setInterval, que está falso. Avançar 0 ms já solta as promessas da primeira leitura.
    const montar = async () => { const r = render(<NotaSefaz />); await avancar(0); return r }

    it("recarrega a cada ~15 s enquanto houver nota 'lancando' e para quando não houver mais", async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      m.notasALancar.mockResolvedValueOnce([nota({ lancamento_estado: 'lancando' })])
      await montar()
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      expect(m.notasALancar).toHaveBeenCalledTimes(1)
      await avancar(INTERVALO - 1000)
      expect(m.notasALancar).toHaveBeenCalledTimes(1)

      // a próxima leitura traz a nota já pronta (ensaio_ok): o intervalo deve ser desligado
      m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'ensaio_ok', lancamento_motivo: 'ok' })])
      await avancar(1000)
      expect(m.notasALancar).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Ensaio ok')
      await avancar(INTERVALO * 3)
      expect(m.notasALancar).toHaveBeenCalledTimes(2)
    })

    it("sem nota 'lancando' não fica recarregando", async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      aLancar(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'x' }))
      await montar()
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      await avancar(INTERVALO * 4)
      expect(m.notasALancar).toHaveBeenCalledTimes(1)
    })

    it("nota 'lancando' presa (> 30 min) não fica recarregando", async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      aLancar(nota({ lancamento_estado: 'lancando', lancamento_estado_em: new Date(Date.now() - 40 * 60_000).toISOString() }))
      await montar()
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      await avancar(INTERVALO * 4)
      expect(m.notasALancar).toHaveBeenCalledTimes(1)
    })

    it('ao sair da tela o intervalo é limpo', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      aLancar(nota({ lancamento_estado: 'lancando' }))
      const { unmount } = await montar()
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      expect(vi.getTimerCount()).toBe(2)   // a releitura de 15 s (nota lançando) + a releitura de 3 min com o app aberto (07/10)
      unmount()
      expect(vi.getTimerCount()).toBe(0)
      await avancar(INTERVALO * 2)
      expect(m.notasALancar).toHaveBeenCalledTimes(1)
    })

    it('falha passageira na releitura não esconde a lista', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      aLancar(nota({ lancamento_estado: 'lancando' }))
      await montar()
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      m.notasALancar.mockRejectedValue(new Error('sem rede'))
      await avancar(INTERVALO)
      expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
      expect(screen.queryByText('Não consegui carregar as notas.')).not.toBeInTheDocument()
    })
  })

  describe('padrão do fornecedor (vem do banco)', () => {
    const CNPJ = '12345678000190'
    it('pré-marca a forma da última nota lançada do fornecedor e diz de onde veio', async () => {
      m.formasPadraoPorFornecedor.mockResolvedValue({ [CNPJ]: 'dinheiro' })
      aLancar(nota({ cnpj_emitente: CNPJ }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('dinheiro')
      expect(screen.getByTestId('padrao-fornecedor')).toHaveTextContent('Padrão deste fornecedor: Dinheiro à vista')
    })

    it('o padrão do banco vale mais que o lembrado neste celular, e outro fornecedor segue em Boleto', async () => {
      lembrarForma('ATACADAO S.A.', 'tesouraria')
      m.formasPadraoPorFornecedor.mockResolvedValue({ [CNPJ]: 'dinheiro' })
      aLancar(nota({ cnpj_emitente: CNPJ }), nota({ chave: '9'.repeat(44), emitente: 'OUTRO LTDA', cnpj_emitente: '99999999000199' }))
      render(<NotaSefaz />)
      const linhas = await screen.findAllByTestId('nota-a-lancar')
      expect((within(linhas[0]).getByLabelText('Como pagar') as HTMLSelectElement).value).toBe('dinheiro')
      expect((within(linhas[1]).getByLabelText('Como pagar') as HTMLSelectElement).value).toBe('boleto')
    })

    it('PIX e cartão nunca viram padrão: a última nota em PIX deixa o fornecedor em Boleto', async () => {
      m.formasPadraoPorFornecedor.mockResolvedValue({ [CNPJ]: 'pix:bradesco|ij' })
      aLancar(nota({ cnpj_emitente: CNPJ }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
      expect(screen.queryByTestId('padrao-fornecedor')).not.toBeInTheDocument()
    })

    it('falha ao ler o padrão não derruba a aba (segue em Boleto)', async () => {
      m.formasPadraoPorFornecedor.mockRejectedValue(new Error('sem rede'))
      aLancar(nota({ cnpj_emitente: CNPJ }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(comoPagar().value).toBe('boleto')
      expect(screen.queryByText('Não consegui carregar as notas.')).not.toBeInTheDocument()
    })
  })

  describe('nota pronta e painel de conferir (regra 2)', () => {
    const parcelas = [{ numero: '001', vencimento: '2026-11-05', valor: 60 }, { numero: '002', vencimento: '2026-11-12', valor: 40 }]
    const pronta = (extra: Partial<NotaSefazLista> = {}) => nota({ valor_nf: 100, parcelas, cnpj_emitente: '12345678000190', ...extra })

    it('nota pronta (itens associados + boletos fecham): mostra "Pronta", só o Lançar e esconde o Como pagar', async () => {
      aLancar(pronta())
      render(<NotaSefaz />)
      const linha = await screen.findByTestId('nota-a-lancar')
      expect(within(linha).getByTestId('nota-pronta')).toHaveTextContent('Pronta para lançar')
      expect(within(linha).getByTestId('nota-pronta')).toHaveTextContent('2 boletos fecham')
      expect(within(linha).getByTestId('pagamento-fixo')).toHaveTextContent('Pagamento: Boleto (2 parcelas)')
      expect(within(linha).queryByLabelText('Como pagar')).not.toBeInTheDocument()
      expect(botaoLancar()).toBeEnabled()
    })

    it('"mudar forma de pagamento" devolve o Como pagar e tira o modo "só lançar"', async () => {
      aLancar(pronta())
      render(<NotaSefaz />)
      await screen.findByTestId('nota-pronta')
      await userEvent.click(screen.getByRole('button', { name: 'mudar forma de pagamento' }))
      expect(comoPagar().value).toBe('boleto')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
    })

    it('Lançar da nota pronta manda a chave e Boleto (dois toques, como sempre)', async () => {
      aLancar(pronta())
      render(<NotaSefaz />)
      await screen.findByTestId('nota-pronta')
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
    })

    it('fornecedor aprendido (3 notas seguidas em boleto) é dito na nota pronta', async () => {
      m.lancamentosSeguidosEmBoleto.mockResolvedValue({ '12345678000190': 3 })
      aLancar(pronta())
      render(<NotaSefaz />)
      expect(await screen.findByTestId('nota-pronta')).toHaveTextContent('Fornecedor aprendido (3 notas seguidas lançadas em boleto sem problema)')
    })

    it('boletos que não fecham: não é pronta, avisa o motivo e mantém o Como pagar', async () => {
      aLancar(pronta({ parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 10 }] }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(screen.getByTestId('aviso-financeiro')).toHaveTextContent('Os boletos não fecham com o valor da nota')
      expect(comoPagar()).toBeInTheDocument()
    })

    // Regra do Ivan (07/10): "quando não vier informando nada na nota, o que vai prevalecer é o que eu determinar dentro do app". Antes, com o XML por
    // ler, a tela só avisava "próxima leitura" e o Lançar em Boleto ia sem parcelas; agora, em Boleto, abre o editor e o que ele digitar vale.
    describe('XML ainda não lido (parcelas null) — regra do Ivan, 07/10', () => {
      const digitar = async (i: number, venc: string, valor: string) => {
        fireEvent.change(screen.getByLabelText(`Vencimento da parcela ${i}`), { target: { value: venc } })
        await userEvent.type(screen.getByLabelText(`Valor da parcela ${i}`), valor)
      }

      it('com Boleto: não é pronta, abre o editor com a ajuda de "XML não lido" (sem o aviso financeiro duplicado) e mantém o Como pagar', async () => {
        aLancar(pronta({ parcelas: null }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(comoPagar().value).toBe('boleto')
        expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
        expect(screen.queryByTestId('aviso-financeiro')).not.toBeInTheDocument()
        const editor = screen.getByTestId('editor-parcelas')
        expect(within(editor).getByTestId('parcelas-xml-nao-lido'))
          .toHaveTextContent('O XML desta nota ainda não foi lido: as parcelas que você digitar valem. Se a leitura trouxer boletos diferentes, o robô para e avisa.')
        expect(editor).not.toHaveTextContent('O XML desta nota não traz os boletos') // isso ainda não se sabe: o XML nem foi lido
        expect(within(screen.getByTestId('conferir')).getByTestId('fin-nao-lido'))
          .toHaveTextContent('O XML ainda não foi lido. Escolha a forma de pagamento; se for boleto, digite as parcelas abaixo: o que você digitar vale para o lançamento.')
      })

      it('com Boleto: o Lançar fica apagado até a soma fechar; depois lança com as parcelas digitadas', async () => {
        aLancar(pronta({ parcelas: null }))
        render(<NotaSefaz />)
        await screen.findByTestId('editor-parcelas')
        expect(botaoLancar()).toBeDisabled()
        await digitar(1, '2026-11-05', '60,00')
        expect(botaoLancar()).toBeDisabled()                                            // faltam 40
        expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Faltam 40,00 para fechar com o valor da nota')
        await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
        await digitar(2, '2026-12-05', '40,00')
        expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('bate')
        expect(botaoLancar()).toBeEnabled()
        await userEvent.click(botaoLancar())
        expect(screen.getByTestId('parcelas-confirmar')).toHaveTextContent('Parcela 2 · vence 05/12/2026')
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-12-05', valor: 40 }]))
      })

      it('com PIX (ou outra forma que não é boleto): sem editor; o aviso financeiro explica a regra e o Lançar vai sem parcelas', async () => {
        aLancar(pronta({ parcelas: null }))
        render(<NotaSefaz />)
        await screen.findByTestId('editor-parcelas')
        await userEvent.selectOptions(comoPagar(), 'pix:pangbank|ij')
        expect(screen.queryByTestId('editor-parcelas')).not.toBeInTheDocument()
        expect(screen.getByTestId('aviso-financeiro'))
          .toHaveTextContent('Boletos ainda não lidos do XML: se for boleto, digite as parcelas (o que você digitar vale; se o XML trouxer boletos, eles prevalecem e o robô avisa)')
        expect(botaoLancar()).toBeEnabled()
        await userEvent.click(botaoLancar())
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'pix:pangbank|ij'))
      })
    })

    it('nota sem boleto no XML: não é pronta; em vez do aviso aparece o editor para digitar as parcelas (e o Como pagar segue)', async () => {
      aLancar(pronta({ parcelas: [] }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(screen.queryByTestId('aviso-financeiro')).not.toBeInTheDocument()
      expect(screen.getByTestId('editor-parcelas')).toBeInTheDocument()
      expect(comoPagar()).toBeInTheDocument()
    })

    it('com padrão do fornecedor diferente de Boleto a nota não fica no modo "só lançar"', async () => {
      m.formasPadraoPorFornecedor.mockResolvedValue({ '12345678000190': 'dinheiro' })
      aLancar(pronta())
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(comoPagar().value).toBe('dinheiro')
    })

    it('painel de conferir: itens com o produto associado e o financeiro (parcelas, soma e total)', async () => {
      aLancar(pronta({ itens: [{ descricao: 'CÓD. FOR: 515972 CREME DE LEITE', qtd: 10, unidade_sischef: 'KG', produto_id: 1855900, associacao: 'sischef', produto_nome: 'CREME DE LEITE - INSUMOS' },
        { descricao: 'CÓD. FOR: 9 ITEM SEM NOME', qtd: 2, unidade_sischef: 'UN', produto_id: 77, associacao: 'sischef' }] }))
      render(<NotaSefaz />)
      const painel = await screen.findByTestId('conferir')
      const itens = within(painel).getAllByTestId('conferir-item')
      expect(itens[0]).toHaveTextContent('CREME DE LEITE · 10 KG')
      expect(itens[0]).toHaveTextContent('CREME DE LEITE - INSUMOS')
      expect(within(itens[0]).getByTestId('item-ok')).toHaveAccessibleName('produto associado no SisChef') // ✓ verde na frente do produto
      expect(itens[0]).not.toHaveTextContent('associado no SisChef') // o texto embaixo do produto foi tirado (pedido do Ivan, 06/10)
      expect(within(itens[1]).getByTestId('item-ok')).toBeInTheDocument()
      expect(itens[0]).not.toHaveTextContent('CÓD. FOR')
      expect(itens[1]).toHaveTextContent('produto 77') // sem o nome vindo do robô, mostra o código
      const par = within(painel).getAllByTestId('conferir-parcela')
      expect(par[0]).toHaveTextContent('Parcela 001 · vence 05/11/2026')
      expect(par[0]).toHaveTextContent(/R\$\s60,00/)
      expect(within(painel).getByTestId('fin-total')).toHaveTextContent(/Soma dos boletos R\$\s100,00 · valor da nota R\$\s100,00 · bate/)
    })

    it('painel de conferir: só o item com produto leva o ✓; o sem produto e o decidido só no app ficam sem ✓ e com o aviso escrito', async () => {
      aLancar(pronta({ itens: [
        { descricao: 'CÓD. FOR: 1 AGUA SEM GÁS 500ML', qtd: 60, unidade_sischef: 'UN', produto_id: 10, associacao: 'sischef', produto_nome: 'AGUA SEM GÁS 500ML' },
        { descricao: 'CÓD. FOR: 2 CHOC LACTA BIS', qtd: 15, unidade_sischef: 'UN', produto_id: null, associacao: null },
        { descricao: 'CÓD. FOR: 3 LEITE COND', qtd: 4, unidade_sischef: 'UN', produto_id: 55, associacao: 'painel', produto_nome: 'LEITE CONDENSADO' },
        { descricao: 'CÓD. FOR: 4 OLEO', qtd: 2, unidade_sischef: 'UN', produto_id: 56 }, // robô sem o campo associacao, mas com produto: o Lançar não trava por ele
      ] }))
      render(<NotaSefaz />)
      const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
      expect(within(itens[0]).getByTestId('item-ok')).toBeInTheDocument()
      expect(itens[0]).toHaveTextContent('AGUA SEM GÁS 500ML')
      expect(within(itens[1]).queryByTestId('item-ok')).not.toBeInTheDocument()
      expect(itens[1]).toHaveTextContent('sem produto')
      expect(itens[1]).toHaveTextContent('sem associação')
      expect(within(itens[2]).queryByTestId('item-ok')).not.toBeInTheDocument()
      expect(itens[2]).toHaveTextContent('decidido no app (ainda não está no SisChef)')
      expect(within(itens[3]).getByTestId('item-ok')).toBeInTheDocument()
      // sem ✓ em algum item ⇒ o aviso vermelho aparece e o Lançar fica travado (o ✓ não contradiz o bloqueio)
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef')
      expect(botaoLancar()).toBeDisabled()
    })

    it('nota com todos os itens associados: todos levam ✓ e o Lançar fica liberado', async () => {
      aLancar(pronta({ itens: [
        { descricao: 'CÓD. FOR: 1 A', qtd: 1, unidade_sischef: 'UN', produto_id: 1, associacao: 'sischef', produto_nome: 'A' },
        { descricao: 'CÓD. FOR: 2 B', qtd: 2, unidade_sischef: 'UN', produto_id: 2, associacao: 'sischef', produto_nome: 'B' },
      ] }))
      render(<NotaSefaz />)
      const painel = await screen.findByTestId('conferir')
      expect(within(painel).getAllByTestId('item-ok')).toHaveLength(2)
      expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
      expect(botaoLancar()).toBeEnabled()
    })

    it('painel de conferir mostra a quantidade no jeito brasileiro (19,918 e não 19.918, que parece dezenove mil)', async () => {
      aLancar(pronta({ itens: [
        { descricao: 'CÓD. FOR: 1 LAGARTO RESF', qtd: 19.918, unidade_sischef: 'KG', produto_id: 5, associacao: 'sischef' },
        { descricao: 'CÓD. FOR: 2 BACON', qtd: 1000.5, unidade_sischef: 'KG', produto_id: 6, associacao: 'sischef' },
        { descricao: 'CÓD. FOR: 3 SEM QTD', qtd: null, unidade_sischef: 'UN', produto_id: 7, associacao: 'sischef' },
      ] }))
      render(<NotaSefaz />)
      const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
      expect(itens[0]).toHaveTextContent('LAGARTO RESF · 19,918 KG')
      expect(itens[1]).toHaveTextContent('BACON · 1.000,5 KG')
      expect(itens[2]).toHaveTextContent('SEM QTD · ? UN')
    })

    it('nota que chegou sem itens: o painel avisa, o aviso vermelho aparece e o Lançar fica travado (não há o que conferir)', async () => {
      aLancar(pronta({ itens: [], parcelas: null }))
      render(<NotaSefaz />)
      const painel = await screen.findByTestId('conferir')
      expect(within(painel).getByTestId('conferir-sem-itens')).toBeInTheDocument()
      expect(within(painel).queryAllByTestId('conferir-item')).toHaveLength(0)
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('chegou sem itens')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(botaoLancar()).toBeDisabled()
    })

    it('painel de conferir mostra a diferença quando os boletos não fecham, e o aviso de XML não lido / sem boleto', async () => {
      aLancar(pronta({ parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 90 }] }), pronta({ chave: '8'.repeat(44), parcelas: null }), pronta({ chave: '7'.repeat(44), parcelas: [] }))
      render(<NotaSefaz />)
      const paineis = await screen.findAllByTestId('conferir')
      expect(within(paineis[0]).getByTestId('fin-total')).toHaveTextContent(/diferença de R\$\s10,00/)
      expect(within(paineis[1]).getByTestId('fin-nao-lido')).toHaveTextContent('O XML ainda não foi lido. Escolha a forma de pagamento; se for boleto, digite as parcelas abaixo')
      expect(within(paineis[2]).getByTestId('fin-sem-boleto')).toBeInTheDocument()
    })
  })

  describe('parcelas digitadas (boleto cujo XML não traz as duplicatas — MATEUS)', () => {
    const MATEUS = '03995515011363'
    const semDuplicata = (extra: Partial<NotaSefazLista> = {}) => nota({ emitente: 'MATEUS SUPERMERCADOS SA', cnpj_emitente: MATEUS, valor_nf: 100, emissao: '2026-10-05', parcelas: [], ...extra })
    const digitar = async (i: number, venc: string, valor: string) => {
      fireEvent.change(screen.getByLabelText(`Vencimento da parcela ${i}`), { target: { value: venc } })
      const campo = screen.getByLabelText(`Valor da parcela ${i}`)
      await userEvent.clear(campo)
      if (valor) await userEvent.type(campo, valor)
    }

    it('mostra o editor com o aviso da falha do fornecedor e trava o Lançar até a soma fechar', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      const editor = await screen.findByTestId('editor-parcelas')
      expect(editor).toHaveTextContent('O XML da MATEUS SUPERMERCADOS não traz a forma de pagamento nem os boletos (falha do fornecedor)')
      expect(botaoLancar()).toBeDisabled()
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Parcela 1: informe o vencimento')
      await digitar(1, '2026-11-05', '60,00')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Faltam 40,00 para fechar com o valor da nota')
      expect(botaoLancar()).toBeDisabled()
    })

    it('adicionar parcela, completar o que falta e lançar: manda as parcelas à função e confirma com a lista', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      await digitar(1, '2026-11-05', '60,00')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
      fireEvent.change(screen.getByLabelText('Vencimento da parcela 2'), { target: { value: '2026-11-12' } })
      await userEvent.click(screen.getByRole('button', { name: 'Preencher o que falta na última' }))
      expect((screen.getByLabelText('Valor da parcela 2') as HTMLInputElement).value).toBe('40,00')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Soma R$ 100,00')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('bate')
      await userEvent.click(botaoLancar())
      const lista = screen.getByTestId('parcelas-confirmar')
      expect(lista).toHaveTextContent('Parcela 1 · vence 05/11/2026')
      expect(lista).toHaveTextContent('Parcela 2 · vence 12/11/2026')
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40 }]))
    })

    it('regra 4: 3 parcelas de valores diferentes que somam o valor da nota liberam o Lançar e vão como foram digitadas', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      expect(screen.getByTestId('editor-parcelas')).toHaveTextContent('Podem ser iguais ou diferentes; o que vale é a soma ser igual ao valor da nota')
      await digitar(1, '2026-11-05', '70,00')
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
      fireEvent.change(screen.getByLabelText('Vencimento da parcela 2'), { target: { value: '2026-11-15' } })
      fireEvent.change(screen.getByLabelText('Vencimento da parcela 3'), { target: { value: '2026-11-25' } })
      await userEvent.type(screen.getByLabelText('Valor da parcela 2'), '20,50')
      await userEvent.type(screen.getByLabelText('Valor da parcela 3'), '9,50')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('bate')
      expect(botaoLancar()).toBeEnabled()
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [
        { vencimento: '2026-11-05', valor: 70 }, { vencimento: '2026-11-15', valor: 20.5 }, { vencimento: '2026-11-25', valor: 9.5 }]))
    })

    it('regra 4: 1 centavo a mais ou a menos no total trava o Lançar e diz quanto passou ou falta (e oferece completar a última)', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      await digitar(1, '2026-11-05', '100,01')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Passou 0,01 do valor da nota')
      expect(botaoLancar()).toBeDisabled()
      await digitar(1, '2026-11-05', '99,99')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('Faltam 0,01 para fechar com o valor da nota')
      expect(botaoLancar()).toBeDisabled()
      await userEvent.click(screen.getByRole('button', { name: 'Preencher o que falta na última' }))
      expect((screen.getByLabelText('Valor da parcela 1') as HTMLInputElement).value).toBe('100,00')
      expect(botaoLancar()).toBeEnabled()
    })

    it('parcela única com o valor total já libera o Lançar', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      await digitar(1, '2026-11-05', '100')
      expect(botaoLancar()).toBeEnabled()
    })

    it('remover parcela (só com 2 ou mais) e vencimento antes da emissão trava', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      expect(screen.queryByRole('button', { name: /Remover parcela/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remover parcela 2' }))
      expect(screen.queryByLabelText('Vencimento da parcela 2')).not.toBeInTheDocument()
      await digitar(1, '2025-11-05', '100')
      expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('o vencimento é anterior à emissão da nota')
      expect(botaoLancar()).toBeDisabled()
    })

    it('outra forma de pagamento (cartão, dinheiro) esconde o editor e não manda parcelas', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      await userEvent.selectOptions(comoPagar(), 'cartao')
      expect(screen.queryByTestId('editor-parcelas')).not.toBeInTheDocument()
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao'))
    })

    it('nota com boletos no XML não mostra o editor (os boletos do XML prevalecem); com o XML ainda não lido, mostra (regra do Ivan, 07/10)', async () => {
      // até 06/10 o XML não lido também ficava SEM editor (esperava a próxima leitura); agora o que o Ivan digitar vale
      aLancar(semDuplicata({ parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }] }), semDuplicata({ chave: '8'.repeat(44), parcelas: null }))
      render(<NotaSefaz />)
      const [comBoleto, naoLida] = await screen.findAllByTestId('nota-a-lancar')
      expect(within(comBoleto).queryByTestId('editor-parcelas')).not.toBeInTheDocument()
      const editor = within(naoLida).getByTestId('editor-parcelas')
      expect(within(editor).getByTestId('parcelas-xml-nao-lido')).toBeInTheDocument()
      expect(editor).toHaveTextContent('O XML da MATEUS SUPERMERCADOS não traz a forma de pagamento nem os boletos (falha do fornecedor)') // o aviso da MATEUS continua
    })

    it('fornecedor fora da regra provisória: aviso genérico, mesmo editor', async () => {
      aLancar(semDuplicata({ emitente: 'OUTRO LTDA', cnpj_emitente: '99999999000199' }))
      render(<NotaSefaz />)
      expect(await screen.findByTestId('editor-parcelas')).toHaveTextContent('O XML desta nota não traz os boletos.')
    })

    it('nota que voltou do robô reabre com as parcelas que o Ivan já tinha digitado', async () => {
      aLancar(semDuplicata({ parcelas_manuais: [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40 }] }))
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      expect((screen.getByLabelText('Valor da parcela 1') as HTMLInputElement).value).toBe('60,00')
      expect((screen.getByLabelText('Vencimento da parcela 2') as HTMLInputElement).value).toBe('2026-11-12')
      expect(botaoLancar()).toBeEnabled()
    })

    describe('nota que ainda espera produto ser associado no SisChef (bug do Ivan, 06/10): dá para digitar as parcelas já', () => {
      const semProduto = (extra: Partial<NotaSefazLista> = {}) => semDuplicata({ itens: [item({ produto_id: null, associacao: null, n: 1 })], ...extra })

      it('o editor de parcelas e o Como pagar ABREM mesmo com item sem produto; o Lançar continua travado, com o aviso', async () => {
        aLancar(semProduto())
        render(<NotaSefaz />)
        const editor = await screen.findByTestId('editor-parcelas')
        expect(within(editor).getByTestId('parcelas-aguardando')).toHaveTextContent('Pode digitar as parcelas já: elas ficam guardadas neste aparelho')
        expect(comoPagar()).toBeEnabled()
        expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef: escolha o produto na caixa de associação (ou associe no SisChef) antes de lançar')
        await digitar(1, '2026-11-05', '100,00')
        expect(screen.getByTestId('resumo-parcelas')).toHaveTextContent('bate')
        expect(botaoLancar()).toBeDisabled()                                            // a soma fecha, mas falta produto: não lança
      })

      it('com o produto confirmado no app em outra unidade e sem a conversão (aviso amarelo) também abre, e o Lançar segue travado', async () => {
        // o item é em UN e o produto confirmado é "(KG)" na lista: é certo que falta dizer quanto vale 1 UN em KG (conversão obrigatória)
        aLancar(semProduto({ itens: [item({ produto_id: null, associacao: null, n: 1, unidade_sischef: 'UN' })],
          associacoes_app: { '1': { produto_id: 1854713, produto_nome: 'Q. MUÇARELA - INSUMOS (KG)', unidade: 'kg' } } }))
        render(<NotaSefaz />)
        expect(await screen.findByTestId('editor-parcelas')).toBeInTheDocument()
        expect(screen.getByTestId('bloqueio-nota')).toHaveClass('amarelo')
        expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('falta a conversão de unidade')
        await digitar(1, '2026-11-05', '100,00')
        expect(botaoLancar()).toBeDisabled()
      })

      it('nota em KG com produto "un" na lista (palpite) e sem conversão: NÃO trava mais (a conversão é opcional, o robô confere no SisChef); o Lançar libera com a soma', async () => {
        // o item é em KG (fixture padrão) e o produto confirmado tem "un" na lista — que é só um chute pelo nome: no SisChef pode estar em KG mesmo
        aLancar(semProduto({ associacoes_app: { '1': { produto_id: 3138573, produto_nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' } } }))
        render(<NotaSefaz />)
        expect(await screen.findByTestId('editor-parcelas')).toBeInTheDocument()
        expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
        expect(screen.queryByTestId('parcelas-aguardando')).not.toBeInTheDocument()
        expect(screen.getByTestId('lancar-associa-item')).toHaveTextContent('unidade no SisChef não confirmada pelo app')
        await digitar(1, '2026-11-05', '100,00')
        expect(botaoLancar()).toBeEnabled()
      })

      it('com a decisão do app completa (etapa 2) nada trava: o editor abre sem o aviso de "aguardando produto" e o Lançar libera quando a soma fecha', async () => {
        aLancar(semProduto({ associacoes_app: { '1': { produto_id: 1854713, produto_nome: 'Q. MUÇARELA - INSUMOS (KG)', unidade: 'kg' } } }))
        render(<NotaSefaz />)
        expect(await screen.findByTestId('editor-parcelas')).toBeInTheDocument()
        expect(screen.queryByTestId('parcelas-aguardando')).not.toBeInTheDocument()
        expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
        expect(screen.getByTestId('lancar-associa')).toHaveTextContent('Q. MUÇARELA - INSUMOS (KG) (cód. 1854713)')
        expect(botaoLancar()).toBeDisabled()                                            // ainda falta a soma das parcelas fechar
        await digitar(1, '2026-11-05', '100,00')
        expect(botaoLancar()).toBeEnabled()
      })

      it('o que foi digitado fica guardado: recarregar a página (e a leitura trazer o produto já associado) não perde as parcelas; ao lançar, o rascunho some', async () => {
        aLancar(semProduto())
        const { unmount } = render(<NotaSefaz />)
        await screen.findByTestId('editor-parcelas')
        await digitar(1, '2026-11-05', '60,00')
        await userEvent.click(screen.getByRole('button', { name: 'Adicionar parcela' }))
        fireEvent.change(screen.getByLabelText('Vencimento da parcela 2'), { target: { value: '2026-11-12' } })
        await userEvent.type(screen.getByLabelText('Valor da parcela 2'), '40,00')
        expect(localStorage.getItem(`spazio.notaSefaz.parcelas.${CHAVE}`)).not.toBeNull()   // guardou no aparelho
        unmount()                                                                         // fecha o app...

        aLancar(semDuplicata())                                                           // ...e reabre depois de o Ivan associar no SisChef (todos os itens com produto)
        render(<NotaSefaz />)
        await screen.findByTestId('editor-parcelas')
        expect((screen.getByLabelText('Vencimento da parcela 1') as HTMLInputElement).value).toBe('2026-11-05')
        expect((screen.getByLabelText('Valor da parcela 1') as HTMLInputElement).value).toBe('60,00')
        expect((screen.getByLabelText('Valor da parcela 2') as HTMLInputElement).value).toBe('40,00')
        expect(screen.queryByTestId('parcelas-aguardando')).not.toBeInTheDocument()       // não está mais esperando produto
        expect(botaoLancar()).toBeEnabled()
        await userEvent.click(botaoLancar())
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto', [{ vencimento: '2026-11-05', valor: 60 }, { vencimento: '2026-11-12', valor: 40 }]))
        await waitFor(() => expect(localStorage.getItem(`spazio.notaSefaz.parcelas.${CHAVE}`)).toBeNull()) // lançou: o rascunho não fica para trás
      })

      it('o rascunho é por nota: outra nota abre em branco', async () => {
        aLancar(semProduto(), semProduto({ chave: '9'.repeat(44), numero: '999' }))
        render(<NotaSefaz />)
        await screen.findAllByTestId('editor-parcelas')
        fireEvent.change(screen.getAllByLabelText('Vencimento da parcela 1')[0], { target: { value: '2026-11-05' } })
        expect((screen.getAllByLabelText('Vencimento da parcela 1')[1] as HTMLInputElement).value).toBe('')
        expect(localStorage.getItem(`spazio.notaSefaz.parcelas.${CHAVE}`)).not.toBeNull()
        expect(localStorage.getItem(`spazio.notaSefaz.parcelas.${'9'.repeat(44)}`)).toBeNull()
      })

      it('trava por outro motivo (conta especial, nota sem itens, robô lançando, nota pela metade): nada para preparar, sem editor e sem trocar a forma', async () => {
        const agora = new Date().toISOString()
        const casos: Partial<NotaSefazLista>[] = [
          { emitente: 'KONDO COMERCIO', cnpj_emitente: '11111111000111' },
          { itens: [] },
          { lancamento_estado: 'lancando', lancamento_estado_em: agora, lancamento_em: agora } as Partial<NotaSefazLista>,
          { lancamento_estado: 'erro', lancamento_estado_em: agora } as Partial<NotaSefazLista>,
        ]
        for (const extra of casos) {
          aLancar(semProduto(extra))
          const { unmount } = render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(screen.queryByTestId('editor-parcelas')).not.toBeInTheDocument()
          expect(comoPagar()).toBeDisabled()
          unmount()
        }
      })

      it('nota com boleto no XML e item sem produto: continua sem editor (não precisa digitar nada), com o Como pagar liberado', async () => {
        aLancar(semProduto({ parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }] }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(screen.queryByTestId('editor-parcelas')).not.toBeInTheDocument()
        expect(comoPagar()).toBeEnabled()
        expect(botaoLancar()).toBeDisabled()
      })
    })

    it('nunca é "pronta" nem mostra o aviso financeiro duplicado', async () => {
      aLancar(semDuplicata())
      render(<NotaSefaz />)
      await screen.findByTestId('editor-parcelas')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(screen.queryByTestId('aviso-financeiro')).not.toBeInTheDocument()
    })
  })

  it('avisa quando a forma escolhida ainda não foi provada ao vivo (e não avisa no boleto)', async () => {
    aLancar(nota({}))
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    expect(screen.queryByTestId('aviso-forma')).not.toBeInTheDocument() // padrão = Boleto
    await userEvent.selectOptions(comoPagar(), 'dinheiro')
    expect(await screen.findByTestId('aviso-forma')).toHaveTextContent(/ainda não foi testada ao vivo/)
    await userEvent.selectOptions(comoPagar(), 'boleto')
    expect(screen.queryByTestId('aviso-forma')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — descartar a nota que não dá para lançar (regra 3 do Ivan)', () => {
  const semItens = (extra: Partial<NotaSefazLista> = {}) =>
    nota({ emitente: 'MC CONTENTE LTDA', numero: '2278', valor_nf: 1275, itens: [], parcelas: null, ...extra })
  const k = (c: string) => c.repeat(44)

  it('"Descartar nota" aparece só na nota que não dá para lançar (sem itens, item sem produto, conta especial, robô parou)', async () => {
    aLancar(
      semItens({ chave: k('1') }),
      nota({ chave: k('2'), itens: [item({ produto_id: null })] }),
      nota({ chave: k('3'), emitente: 'KONDO COMERCIO' }),
      nota({ chave: k('4'), lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' }),
      nota({ chave: k('5') }),
    )
    render(<NotaSefaz />)
    const linhas = await screen.findAllByTestId('nota-a-lancar')
    expect(linhas.map((l) => within(l).queryByTestId('descartar-nota') !== null)).toEqual([true, true, true, true, false])
  })

  it('nunca na nota pela metade (erro) nem na que o robô está lançando agora', async () => {
    aLancar(
      semItens({ chave: k('1'), lancamento_estado: 'erro', lancamento_motivo: 'pedido gerado' }),
      semItens({ chave: k('2'), lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() }),
    )
    render(<NotaSefaz />)
    const linhas = await screen.findAllByTestId('nota-a-lancar')
    for (const l of linhas) expect(within(l).queryByTestId('descartar-nota')).not.toBeInTheDocument()
  })

  it('descartar em 2 toques: a pergunta diz o que muda e o que NÃO muda, manda ao banco com o motivo e a nota passa para "Notas descartadas"', async () => {
    const n = semItens({ chave: k('1') })
    m.notasALancar.mockResolvedValueOnce([n]).mockResolvedValue([])
    m.notasDescartadas.mockResolvedValueOnce([]).mockResolvedValue([{ ...n, descartada_em: '2026-10-06T20:00:00Z', descartada_motivo: 'Sem itens (XML resumido)' }])
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(within(linha).getByTestId('descartar-nota'))
    const pergunta = within(linha).getByTestId('confirmar-descarte')
    expect(pergunta).toHaveTextContent('Descartar a NF 2278 de MC CONTENTE LTDA?')
    expect(pergunta).toHaveTextContent('nada é lançado')
    expect(pergunta).toHaveTextContent('Não muda nada no SisChef nem na SEFAZ')
    expect(pergunta).toHaveTextContent('Dá para desfazer em “Notas descartadas”')
    expect(pergunta).toHaveTextContent('Se o XML completo chegar depois')
    expect(m.descartarNota).not.toHaveBeenCalled() // o 1º toque só pergunta
    await userEvent.click(within(pergunta).getByRole('button', { name: 'Descartar' }))
    expect(m.descartarNota).toHaveBeenCalledWith(k('1'), 'Sem itens (XML resumido)')
    await waitFor(() => expect(screen.queryByTestId('nota-a-lancar')).not.toBeInTheDocument())
    const secao = await screen.findByTestId('descartadas')
    expect(secao).toHaveTextContent('Notas descartadas (1)')
    expect(within(secao).getByTestId('nota-descartada')).toHaveTextContent('MC CONTENTE LTDA · NF 2278')
    expect(within(secao).getByTestId('nota-descartada')).toHaveTextContent('Motivo: Sem itens (XML resumido)')
  })

  it('"Cancelar" fecha a pergunta sem descartar nada', async () => {
    aLancar(semItens())
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(within(linha).getByTestId('descartar-nota'))
    await userEvent.click(within(linha).getByRole('button', { name: 'Cancelar' }))
    expect(within(linha).queryByTestId('confirmar-descarte')).not.toBeInTheDocument()
    expect(within(linha).getByTestId('descartar-nota')).toBeInTheDocument()
    expect(m.descartarNota).not.toHaveBeenCalled()
  })

  it('motivo guardado para item sem produto não fala em "XML completo" (só a nota sem itens fala)', async () => {
    aLancar(nota({ itens: [item({ produto_id: null })] }))
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(within(linha).getByTestId('descartar-nota'))
    expect(within(linha).getByTestId('confirmar-descarte')).not.toHaveTextContent('XML completo')
    await userEvent.click(within(linha).getByRole('button', { name: 'Descartar' }))
    expect(m.descartarNota).toHaveBeenCalledWith(CHAVE, 'Item sem produto no SisChef')
  })

  it('se o banco recusar, mostra o motivo em português, fecha a pergunta e a nota continua na lista', async () => {
    aLancar(semItens())
    m.descartarNota.mockRejectedValue(new Error('Esta nota ficou pela metade: confira no SisChef antes de descartar.'))
    render(<NotaSefaz />)
    const linha = await screen.findByTestId('nota-a-lancar')
    await userEvent.click(within(linha).getByTestId('descartar-nota'))
    await userEvent.click(within(linha).getByRole('button', { name: 'Descartar' }))
    expect(await within(linha).findByRole('alert')).toHaveTextContent('ficou pela metade')
    expect(within(linha).queryByTestId('confirmar-descarte')).not.toBeInTheDocument()
    expect(screen.getByTestId('nota-a-lancar')).toBeInTheDocument()
  })

  it('Notas descartadas: lista com o motivo; "Voltar para a fila" desfaz e a nota volta para "Notas a lançar"', async () => {
    const d = semItens({ chave: k('1'), itens: [item({ produto_id: null })], descartada_em: '2026-10-06T20:00:00Z', descartada_motivo: 'Item sem produto no SisChef' })
    m.notasDescartadas.mockResolvedValueOnce([d]).mockResolvedValue([])
    m.notasALancar.mockResolvedValueOnce([]).mockResolvedValue([{ ...d, descartada_em: null, descartada_motivo: null }])
    render(<NotaSefaz />)
    const secao = await screen.findByTestId('descartadas')
    expect(secao).toHaveTextContent('Notas descartadas (1)')
    expect(within(secao).getByTestId('nota-descartada')).toHaveTextContent('Motivo: Item sem produto no SisChef')
    expect(screen.queryByTestId('descartadas-aviso')).not.toBeInTheDocument()
    await userEvent.click(within(secao).getByRole('button', { name: 'Voltar para a fila' }))
    expect(m.restaurarNota).toHaveBeenCalledWith(k('1'))
    expect(await screen.findByTestId('nota-a-lancar')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('descartadas')).not.toBeInTheDocument())
  })

  it('descartada por falta de itens que AGORA veio com itens: avisa no resumo e na própria nota', async () => {
    const d = nota({ chave: k('1'), descartada_em: '2026-10-06T20:00:00Z', descartada_motivo: 'Sem itens (XML resumido)', itens: [item(), item({ descricao: 'OUTRO' })] })
    m.notasDescartadas.mockResolvedValue([d, semItens({ chave: k('2'), descartada_em: '2026-10-06T20:00:00Z', descartada_motivo: 'Sem itens (XML resumido)' })])
    render(<NotaSefaz />)
    const secao = await screen.findByTestId('descartadas')
    expect(within(secao).getByTestId('descartadas-aviso')).toHaveTextContent('uma delas agora veio com itens')
    const avisos = within(secao).getAllByTestId('descartada-com-itens')
    expect(avisos).toHaveLength(1) // só a que tem itens
    expect(avisos[0]).toHaveTextContent('Esta nota agora veio com 2 itens (o XML completo chegou)')
  })

  it('erro ao voltar para a fila mostra a mensagem e a nota continua descartada', async () => {
    const d = semItens({ chave: k('1'), descartada_em: '2026-10-06T20:00:00Z', descartada_motivo: 'Sem itens (XML resumido)' })
    m.notasDescartadas.mockResolvedValue([d])
    m.restaurarNota.mockRejectedValue(new Error('Não consegui voltar a nota para a fila agora. Confira a internet e tente de novo.'))
    render(<NotaSefaz />)
    const secao = await screen.findByTestId('descartadas')
    await userEvent.click(within(secao).getByRole('button', { name: 'Voltar para a fila' }))
    expect(await within(secao).findByRole('alert')).toHaveTextContent('Não consegui voltar a nota para a fila')
    expect(screen.getByTestId('descartadas')).toBeInTheDocument()
  })

  it('falha ao ler as descartadas não derruba a lista de notas a lançar', async () => {
    aLancar(nota({ chave: k('1') }))
    m.notasDescartadas.mockRejectedValue(new Error('sem rede'))
    render(<NotaSefaz />)
    expect(await screen.findByTestId('nota-a-lancar')).toBeInTheDocument()
    expect(screen.queryByText('Não consegui carregar as notas.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('descartadas')).not.toBeInTheDocument()
  })
  describe('Associar produto (item sem produto no SisChef): escolher, confirmar e o ✓ de "confirmado"', () => {
    const OLEO = 3138573
    const CATALOGO: ProdutoCatalogo[] = [
      { produto_id: OLEO, nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' },
      { produto_id: 3469626, nome: 'LEITE CONDESSADO - INSUMOS (KG)', unidade: 'kg' },
      { produto_id: 3469635, nome: 'LEITE LIQUIDO INTREGAL - INSUMOS (KG)', unidade: 'kg' },
      { produto_id: 1854713, nome: 'Q. MUÇARELA - INSUMOS (KG)', unidade: 'kg' },
    ]
    const sem = (n: number | null, extra: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
      ({ descricao: 'CÓD. FOR: 454513 OLEO SOJA VITALIV PET 900ML', qtd: 60, unidade_sischef: 'UN', produto_id: null, n, ...extra })
    /** Decisão do app como vem do banco; `conversao` só existe desde a etapa 2 (quanto vale 1 unidade da nota em unidades do produto). */
    const decisao = (id: number, nome: string, unidade = 'un', conversao?: number | null) =>
      ({ produto_id: id, produto_nome: nome, unidade, ...(conversao === undefined ? {} : { conversao }), por: 'ivan@spazio.com', em: '2026-10-06T23:00:00Z' })
    /** O campo da conversão OBRIGATÓRIA (nota em UN, produto "(KG)" na lista: é certo que o SisChef vai pedir). */
    const campoConversao = (un: string, kg: string) => screen.getByLabelText(`Quanto vale 1 ${un} em ${kg}?`)
    /** O campo da conversão OPCIONAL (a lista do app só desconfia da unidade do produto: "un" é palpite, produto novo não tem). */
    const campoOpcional = (un: string) => screen.getByLabelText(`Quanto vale 1 ${un} na unidade do produto no SisChef? (opcional)`)
    const painel = async () => within(await screen.findByTestId('conferir'))
    /**
     * O campo de busca do produto. Desde 07/10 (pedido do Ivan), quando o app tem um produto indicado (sugestão do robô, palavras-chave ou decisão sem a
     * conversão) o cartão já abre com ele e o Confirmar; a busca fica atrás de "Não é este produto? Escolher outro". Este auxiliar abre a busca nesse caso.
     */
    const campo = async () => {
      const p = await painel()
      await waitFor(() => expect(p.queryByLabelText('Produto do SisChef') ?? p.queryByRole('button', { name: /Escolher outro/ })).toBeTruthy())
      const outro = p.queryByRole('button', { name: /Escolher outro/ })
      if (outro) fireEvent.click(outro)
      return p.findByLabelText('Produto do SisChef')
    }
    /** O botão de um produto NA LISTA de achados (o mesmo produto pode aparecer também como sugestão, fora dela). */
    const achado = async (nome: RegExp) => within(await screen.findByTestId('achados')).getByRole('button', { name: nome })

    beforeEach(() => { m.catalogoProdutos.mockResolvedValue(CATALOGO) })

    it('item sem produto: mostra o aviso escrito e o campo para digitar o produto; sem escolher, não há botão Confirmar', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      render(<NotaSefaz />)
      const p = await painel()
      const item = p.getByTestId('conferir-item')
      expect(item).toHaveTextContent('sem produto')
      expect(item).toHaveTextContent('sem associação')
      expect(within(item).queryByTestId('item-ok')).not.toBeInTheDocument()
      expect(await campo()).toBeInTheDocument()
      expect(within(item).queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
      expect(m.catalogoProdutos).toHaveBeenCalledTimes(1)
    })

    it('digita, escolhe na lista e confirma: guarda a escolha (nota, número do item, código) e o item ganha o ✓ de confirmado, sem o campo', async () => {
      const antes = nota({ itens: [sem(1)] })
      const depois = nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } })
      aLancar(antes)
      m.associarItem.mockImplementation(async () => { aLancar(depois) })
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'oleo soja')
      const achados = within(await screen.findByTestId('achados'))
      expect(achados.getAllByRole('button')).toHaveLength(1)
      await userEvent.click(achados.getByRole('button', { name: /ÓLEO DE SOJA - INSUMOS \(UN\)/ }))
      expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent(`ÓLEO DE SOJA - INSUMOS (UN) cód. ${OLEO} · UN`)
      expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()   // escolhido: o campo dá lugar ao produto
      expect(m.associarItem).not.toHaveBeenCalled()                                    // escolher NÃO guarda: só o Confirmar
      expect(screen.queryByText(/Quanto vale 1/)).not.toBeInTheDocument()                // unidades iguais (UN × UN): não pede conversão
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))   // sem conversão: null explícito (a RPC tem 4 parâmetros)
      const item = (await painel()).getByTestId('conferir-item')
      await waitFor(() => expect(within(item).getByTestId('item-confirmado')).toBeInTheDocument())  // o ✓ de confirmado
      expect(within(item).getByTestId('item-confirmado')).toHaveAccessibleName('produto confirmado no app')
      expect(item).toHaveTextContent('ÓLEO DE SOJA - INSUMOS (UN)')
      expect(item).toHaveTextContent(`confirmado no app · cód. ${OLEO}`)
      expect(item).not.toHaveTextContent('sem produto')
      expect(within(item).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
      expect(within(item).getByRole('button', { name: 'Trocar' })).toBeInTheDocument()
    })

    it('a sugestão do robô já abre no cartão "Produto que eu indiquei": quem guarda é o Confirmar (sem Trocar nem busca)', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: '3469626', nome: 'LEITE CONDENSADO - INSUMOS' } })] }))
      render(<NotaSefaz />)
      const escolhido = await screen.findByTestId('produto-escolhido')
      expect(escolhido).toHaveTextContent('Produto que eu indiquei no SisChef')
      expect(escolhido).toHaveTextContent('LEITE CONDESSADO - INSUMOS (KG)')   // o nome vem da lista do app, não do palpite
      expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
      expect(m.associarItem).not.toHaveBeenCalled()
      await userEvent.type(campoConversao('UN', 'KG'), '0,395')                           // LEITE CONDESSADO é em KG e a nota em UN: a conversão é obrigatória
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626, 0.395))
    })

    it('produto NOVO (o robô já o vê no SisChef, mas ele não está na lista semanal do app): o cartão o indica marcado como novo; a conversão é OPCIONAL e vazia confirma', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: '3476455', nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS' } })] }))
      render(<NotaSefaz />)
      const escolhido = await screen.findByTestId('produto-escolhido')
      expect(escolhido).toHaveTextContent('Produto que eu indiquei no SisChef')
      expect(escolhido).toHaveTextContent('CHOCOLATE BIS ORIGINAL - INSUMOS')
      expect(escolhido).toHaveTextContent('cód. 3476455 · novo, ainda fora da lista semanal')
      // sem unidade conhecida não há como comparar: o campo aparece, mas OPCIONAL (o robô decide com o cadastro vivo; se precisar, para pedindo)
      const pedido = screen.getByTestId('pedir-conversao')
      expect(pedido).not.toHaveClass('amarelo')
      expect(campoOpcional('UN')).toBeInTheDocument()
      expect(pedido).toHaveTextContent('Produto fora da lista semanal: o app não conhece a unidade dele no SisChef. Se lá ele também for em UN, deixe vazio.')
      expect(pedido).toHaveTextContent('Se o robô parar pedindo a conversão, volte aqui (Trocar) e informe.')
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3476455, null))
    })

    it('palpite sem código válido não vira sugestão', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: 'abc', nome: 'SEM CÓDIGO' } })] }))
      render(<NotaSefaz />)
      await campo()
      expect(screen.queryByTestId('sugestao-robo')).not.toBeInTheDocument()
    })

    describe('conversão de unidade (etapa 2: o robô digita no modal "UN DIFERE" do SisChef o que o Ivan informar aqui)', () => {
      it('nota em UN, produto em KG: pede "Quanto vale 1 UN em KG?" (obrigatório); Confirmar só libera com um número válido e manda a conversão', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        const pedido = await screen.findByTestId('pedir-conversao')
        expect(pedido).toHaveTextContent('Ex.: lata de 395 g = 0,395. O robô grava essa conversão no SisChef junto com a associação.')
        const entrada = campoConversao('UN', 'KG') as HTMLInputElement
        expect(entrada).toHaveAttribute('inputmode', 'decimal')
        expect(entrada).toHaveAttribute('placeholder', '0,000')
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()          // vazio: não dá para confirmar sem a conversão
        expect(pedido).toHaveClass('amarelo')                                              // obrigatório: amarelo de "falta algo"
        expect(screen.queryByTestId('conversao-eco')).not.toBeInTheDocument()
        await userEvent.type(entrada, '0,395')
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
        expect(screen.queryByTestId('conversao-invalida')).not.toBeInTheDocument()
        expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 0,395 KG')   // eco do que foi entendido, antes de confirmar
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626, 0.395))
      })

      it('o eco lê o número como o robô vai gravar: "0.395" e "0,395" são o mesmo; "1000" é mil (e não "1.000", que o campo leria como 1)', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        await userEvent.type(campoConversao('UN', 'KG'), '0.395')
        expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 0,395 KG')
        await userEvent.clear(campoConversao('UN', 'KG'))
        await userEvent.type(campoConversao('UN', 'KG'), '1000')
        expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 1000 KG')
        await userEvent.clear(campoConversao('UN', 'KG'))
        expect(screen.queryByTestId('conversao-eco')).not.toBeInTheDocument()
      })

      it.each([
        ['0', 'zero não é conversão'],
        ['-1', 'negativo'],
        ['abc', 'texto'],
        ['0,39555', 'cinco casas: o SisChef aceita até quatro'],
        ['10000,5', 'acima de 10000'],
        ['1.000,5', 'ponto de milhar não vale (ponto é decimal)'],
      ])('valor "%s" (%s) não libera o Confirmar e explica o formato', async (valor) => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        await userEvent.type(campoConversao('UN', 'KG'), valor)
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
        expect(screen.getByTestId('conversao-invalida')).toHaveTextContent('Número maior que zero, até 10000, com até 4 casas (vírgula ou ponto).') // sem milhar: é como se digita
        expect(screen.queryByTestId('conversao-eco')).not.toBeInTheDocument()            // inválido: nada a ecoar
        expect(m.associarItem).not.toHaveBeenCalled()
      })

      it('ponto também é decimal ("0.395" = 0,395) e um inteiro vale ("2" = 1 CX de 2 KG)', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        await userEvent.type(campoConversao('UN', 'KG'), '0.395')
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
        await userEvent.clear(campoConversao('UN', 'KG'))
        await userEvent.type(campoConversao('UN', 'KG'), '2')
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626, 2))
      })

      it('unidade igual (UN × UN): sem campo de conversão, e a escolha vai com conversão nula; trocar para produto em KG abre o campo', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'oleo')
        await userEvent.click(await achado(/ÓLEO DE SOJA/))
        expect(await screen.findByTestId('produto-escolhido')).toBeInTheDocument()
        expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
        await userEvent.click(screen.getByRole('button', { name: /Escolher outro/ }))
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        expect(await screen.findByTestId('pedir-conversao')).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', { name: /Escolher outro/ }))
        await userEvent.type(await campo(), 'oleo')
        await userEvent.click(await achado(/ÓLEO DE SOJA/))
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
      })

      it('decisão confirmada com conversão: a linha "confirmado no app" mostra "1 UN = 0,395 KG" (e o ✓ também a lê)', async () => {
        aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395) } }))
        render(<NotaSefaz />)
        const item = (await painel()).getByTestId('conferir-item')
        expect(within(item).getByTestId('associacao-confirmada')).toHaveTextContent('confirmado no app · cód. 3469626 · 1 UN = 0,395 KG')
        expect(within(item).getByTestId('item-confirmado')).toHaveAccessibleName('produto confirmado no app, 1 UN = 0,395 KG')
      })

      it('decisão confirmada sem conversão (unidades iguais): a linha não inventa conversão nenhuma', async () => {
        aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un', null) } }))
        render(<NotaSefaz />)
        const item = (await painel()).getByTestId('conferir-item')
        expect(within(item).getByTestId('associacao-confirmada')).toHaveTextContent(`confirmado no app · cód. ${OLEO}`)
        expect(item).not.toHaveTextContent('1 UN =')
        expect(within(item).getByTestId('item-confirmado')).toHaveAccessibleName('produto confirmado no app')
      })

      it('"Trocar" para corrigir só a conversão: escolhendo o mesmo produto, o valor antigo já vem preenchido', async () => {
        aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395) } }))
        render(<NotaSefaz />)
        await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        expect((campoConversao('UN', 'KG') as HTMLInputElement).value).toBe('0,395')
        await userEvent.clear(campoConversao('UN', 'KG'))
        await userEvent.type(campoConversao('UN', 'KG'), '0,4')
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626, 0.4))
      })

      it('"Trocar" com conversão 1000 gravada: pré-preenche "1000" (sem ponto de milhar) e, confirmando sem mexer, reenvia 1000 — nunca 1', async () => {
        // Achado 2 da revisão: "1.000" no campo era lido como 1 e gravado em silêncio — um de-para 1000 vezes errado e permanente no SisChef
        aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 1000) } }))
        render(<NotaSefaz />)
        await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
        await userEvent.type(await campo(), 'leite cond')
        await userEvent.click(await achado(/LEITE CONDESSADO/))
        expect((campoConversao('UN', 'KG') as HTMLInputElement).value).toBe('1000')
        expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 1000 KG')
        expect(screen.queryByTestId('conversao-invalida')).not.toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626, 1000))
      })

      describe('a unidade da lista do app é só um palpite: a conversão fica OPCIONAL (ou escondida com um link) e o robô confere no SisChef', () => {
        /** Nota em KG (queijo de peso) para um produto cujo nome não tem "(KG)": a lista diz "un", mas isso é chute — no SisChef pode estar em KG. */
        const emKg = (extra: Partial<ItemNotaSefaz> = {}) => sem(1, { descricao: 'CÓD. FOR: 77 OLEO SOJA GRANEL', qtd: 20, unidade_sischef: 'KG', ...extra })

        it('nota em KG × produto "un": campo opcional (sem amarelo), com a ajuda certa; Confirmar liberado com o campo vazio e a escolha vai com conversão nula', async () => {
          // Impasse (a) da revisão: antes a caixa OBRIGAVA "1 KG em UN"; o Ivan digitava 1 e o robô recusava ("mesma unidade: tire a conversão")
          aLancar(nota({ itens: [emKg()] }))
          render(<NotaSefaz />)
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          const pedido = await screen.findByTestId('pedir-conversao')
          expect(pedido).not.toHaveClass('amarelo')
          expect(campoOpcional('KG')).toHaveAttribute('inputmode', 'decimal')
          expect(screen.queryByLabelText(/Quanto vale 1 KG em UN\?/)).not.toBeInTheDocument()    // não é a pergunta obrigatória
          expect(pedido).toHaveTextContent('A lista do app não sabe ao certo a unidade deste produto no SisChef. Se lá ele também for em KG, deixe vazio. Se o robô parar pedindo a conversão, volte aqui (Trocar) e informe.')
          expect(screen.queryByTestId('abrir-conversao')).not.toBeInTheDocument()                 // o campo já está aberto: não precisa de link
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()                // vazio NÃO bloqueia
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
        })

        it('nota em KG × produto "un" preenchido com 2: manda 2, o eco diz "na unidade do produto" (a unidade da lista não é confiável) e inválido ainda trava', async () => {
          aLancar(nota({ itens: [emKg()] }))
          render(<NotaSefaz />)
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          await userEvent.type(campoOpcional('KG'), 'abc')
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()               // texto inválido trava mesmo no opcional (nunca se grava palpite)
          expect(screen.getByTestId('conversao-invalida')).toBeInTheDocument()
          await userEvent.clear(campoOpcional('KG'))
          await userEvent.type(campoOpcional('KG'), '2')
          expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 KG = 2 na unidade do produto')
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, 2))
        })

        it('nota em KG × produto "un" confirmado SEM conversão: o Lançar NÃO trava (o robô confere no SisChef) e a linha do item avisa que a unidade não foi confirmada', async () => {
          aLancar(nota({ ...LIDA, itens: [emKg()], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un') } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
          expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
          expect(botaoLancar()).toBeEnabled()
          const linha = screen.getByTestId('lancar-associa-item')
          expect(linha).toHaveTextContent(`item 1 OLEO SOJA GRANEL → ÓLEO DE SOJA - INSUMOS (UN) (cód. ${OLEO}) · unidade no SisChef não confirmada pelo app: o robô confere lá e pode parar pedindo a conversão`)
          expect(linha).not.toHaveTextContent('1 KG =')
        })

        it('nota em KG × produto "un" confirmado COM conversão 2: a linha diz "1 KG = 2 na unidade do produto no SisChef" (nunca "= 2 UN") e não avisa de unidade incerta', async () => {
          // Revisão adversarial: a linha dizia "1 KG = 2 UN", nomeando justamente a unidade em que o app não confia ("un" é chute pelo nome; no
          // SisChef pode ser PCT). Agora a linha, o ✓ e o bloco do Lançar usam a mesma frase do eco "Vai gravar".
          aLancar(nota({ ...LIDA, itens: [emKg()], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un', 2) } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(botaoLancar()).toBeEnabled()
          const linha = screen.getByTestId('lancar-associa-item')
          expect(linha).toHaveTextContent('1 KG = 2 na unidade do produto no SisChef')
          expect(linha).not.toHaveTextContent('= 2 UN')
          expect(linha).not.toHaveTextContent('não confirmada pelo app')
          const item = (await painel()).getByTestId('conferir-item')
          expect(within(item).getByTestId('associacao-confirmada')).toHaveTextContent(`confirmado no app · cód. ${OLEO} · 1 KG = 2 na unidade do produto no SisChef`)
          expect(within(item).getByTestId('item-confirmado')).toHaveAccessibleName('produto confirmado no app, 1 KG = 2 na unidade do produto no SisChef')
        })

        it('nota em UN × produto "kg": continua OBRIGATÓRIO (certeza de que o SisChef pede) — vazio não confirma e o Lançar segue travado sem o valor', async () => {
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg') } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(botaoLancar()).toBeDisabled()
          expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('falta a conversão de unidade')
          // decisão sem a conversão: o cartão abre já com o produto indicado (sem Trocar nem busca) e o campo obrigatório vazio
          expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent('LEITE CONDESSADO - INSUMOS (KG)')
          expect(campoConversao('UN', 'KG')).toBeInTheDocument()
          expect(screen.queryByText(/\(opcional\)/)).not.toBeInTheDocument()
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
        })

        it('nota em UN × produto "un" (unidades iguais): sem campo, mas com o link "Informar a conversão"; o link abre o campo opcional e o valor 12 vai na chamada', async () => {
          // Impasse (b) da revisão: produto "un" na lista mas PCT/CX no SisChef — o robô pedia a conversão num campo que não existia
          aLancar(nota({ itens: [sem(1)] }))
          render(<NotaSefaz />)
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          expect(await screen.findByTestId('produto-escolhido')).toBeInTheDocument()
          expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()
          const link = screen.getByTestId('abrir-conversao')
          expect(link).toHaveTextContent('O produto no SisChef está em outra unidade? Informar a conversão')
          expect(link).toHaveClass('link')
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
          await userEvent.click(link)
          expect(screen.queryByTestId('abrir-conversao')).not.toBeInTheDocument()
          const pedido = screen.getByTestId('pedir-conversao')
          expect(pedido).not.toHaveClass('amarelo')
          expect(pedido).toHaveTextContent('Se lá ele também for em UN, deixe vazio.')
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()                // abrir o campo não obriga a preencher
          await userEvent.type(campoOpcional('UN'), '12')
          expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 12 na unidade do produto')
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, 12))
        })

        it('"Escolher outro" fecha o campo aberto pelo link e esquece o que foi digitado (o produto seguinte começa limpo)', async () => {
          aLancar(nota({ itens: [sem(1)] }))
          render(<NotaSefaz />)
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          await userEvent.click(screen.getByTestId('abrir-conversao'))
          await userEvent.type(campoOpcional('UN'), '12')
          await userEvent.click(screen.getByRole('button', { name: /Escolher outro/ }))
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()
          expect(screen.getByTestId('abrir-conversao')).toBeInTheDocument()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
        })

        it('"Trocar" no mesmo produto com conversão gravada e unidades iguais: o campo (escondido por padrão) abre já preenchido, para o Ivan ver o que vai regravar', async () => {
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un', 3) } }))
          render(<NotaSefaz />)
          // antes "1 UN = 3 UN" (absurdo: se o Ivan informou 3 é porque no SisChef a unidade é outra); agora a frase do eco
          expect((await painel()).getByTestId('associacao-confirmada')).toHaveTextContent('1 UN = 3 na unidade do produto no SisChef')
          await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          expect((campoOpcional('UN') as HTMLInputElement).value).toBe('3')
          expect(screen.queryByTestId('abrir-conversao')).not.toBeInTheDocument()
          await userEvent.clear(campoOpcional('UN'))                                               // apagar = tirar a conversão (o robô dizia "mesma unidade: tire a conversão")
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
        })

        it('"Trocar" no mesmo produto SEM conversão gravada e unidades iguais: o campo abre (opcional, sem link) — é o caminho de volta que o robô manda', async () => {
          // Revisão adversarial: o robô para a nota dizendo "toque em Trocar, escolha o mesmo produto, preencha a conversão" justamente quando a
          // conversão está VAZIA (nota UN × produto "un" na lista, mas PCT no SisChef). Antes, nesse caso, o campo só aparecia com conversão já gravada:
          // o Ivan seguia a instrução e não achava campo nenhum, só o link. Agora escolher o mesmo produto sempre abre o campo.
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un') } }))
          render(<NotaSefaz />)
          await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          const pedido = await screen.findByTestId('pedir-conversao')
          expect(pedido).not.toHaveClass('amarelo')                                                 // continua opcional: vazio confirma
          expect((campoOpcional('UN') as HTMLInputElement).value).toBe('')
          expect(pedido).toHaveTextContent('Pelo nome, o produto parece estar na mesma unidade da nota no SisChef. Se lá ele também for em UN, deixe vazio.')
          expect(screen.queryByTestId('abrir-conversao')).not.toBeInTheDocument()
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
          await userEvent.type(campoOpcional('UN'), '2')
          expect(screen.getByTestId('conversao-eco')).toHaveTextContent('Vai gravar: 1 UN = 2 na unidade do produto no SisChef')
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, 2))
        })

        it('"Trocar" para OUTRO produto não herda nada: campo fechado (unidades iguais) e sem valor pré-preenchido', async () => {
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(3469626, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395) } }))
          render(<NotaSefaz />)
          await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          expect(await screen.findByTestId('produto-escolhido')).toBeInTheDocument()
          expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()
          expect(screen.getByTestId('abrir-conversao')).toBeInTheDocument()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
        })

        it('nota SEM unidade (a leitura não a trouxe): a caixa avisa que o robô vai parar antes de associar, sem campo nem link de conversão; vazio confirma', async () => {
          // Revisão adversarial: a tela liberava o Lançar sem aviso e o robô parava em "não trouxe a unidade" — e, se a tela do SisChef realmente não
          // mostra a unidade, uma nova leitura não muda nada: a saída é associar no SisChef, e o Ivan precisa saber disso antes de lançar.
          const semUnidade = sem(1, { unidade_sischef: null })
          aLancar(nota({ itens: [semUnidade] }))
          render(<NotaSefaz />)
          await userEvent.type(await campo(), 'oleo')
          await userEvent.click(await achado(/ÓLEO DE SOJA/))
          expect(await screen.findByTestId('produto-escolhido')).toBeInTheDocument()
          expect(screen.getByTestId('nota-sem-unidade')).toHaveTextContent('A leitura do SisChef não trouxe a unidade deste item na nota. A escolha fica guardada, mas ao lançar o robô vai parar antes de associar e pedir para atualizar a lista de notas; se a unidade continuar em branco, associe este item no SisChef.')
          expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()                 // sem a unidade da nota não há o que perguntar
          expect(screen.queryByTestId('abrir-conversao')).not.toBeInTheDocument()
          expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO, null))
        })

        it('nota SEM unidade já confirmada no app: o Lançar libera, mas a linha do item avisa que o robô vai parar antes de associar (e a saída)', async () => {
          aLancar(nota({ ...LIDA, itens: [sem(1, { unidade_sischef: null })], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un') } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(botaoLancar()).toBeEnabled()
          const linha = screen.getByTestId('lancar-associa-item')
          expect(linha).toHaveTextContent('a leitura não trouxe a unidade deste item na nota: o robô vai parar antes de associar (atualize a lista de notas ou associe no SisChef)')
          expect(linha).not.toHaveTextContent('pode parar pedindo a conversão')
        })

        it('produto novo (fora da lista) confirmado sem conversão: a linha do "lancar-associa" também avisa que a unidade não foi confirmada', async () => {
          aLancar(nota({ ...LIDA, itens: [emKg()], associacoes_app: { '1': { produto_id: 3476455, produto_nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS', unidade: null } } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(botaoLancar()).toBeEnabled()
          expect(screen.getByTestId('lancar-associa-item')).toHaveTextContent('CHOCOLATE BIS ORIGINAL - INSUMOS (cód. 3476455) · unidade no SisChef não confirmada pelo app')
        })

        it('unidades iguais confirmadas (UN × "un") sem conversão: nenhum aviso de unidade incerta na linha do item', async () => {
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)', 'un') } }))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(screen.getByTestId('lancar-associa-item')).not.toHaveTextContent('não confirmada pelo app')
        })
      })
    })

    it('nada na lista (nem uma palavra casa): avisa em vez de ficar mudo, mantém o campo e não oferece Confirmar', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'chocolate bis')
      expect(await screen.findByTestId('sem-resultado')).toHaveTextContent('associe-o direto no SisChef')
      expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
    })

    it('nota já com a escolha confirmada (decisão completa): ✓ + "confirmado no app", sem campo; nada trava e o Lançar fica liberado (etapa 2)', async () => {
      aLancar(nota({ ...LIDA, itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      const item = (await painel()).getByTestId('conferir-item')
      expect(within(item).getByTestId('item-confirmado')).toBeInTheDocument()
      expect(within(item).queryByTestId('item-ok')).not.toBeInTheDocument()               // não é o ✓ de "associado no SisChef"
      expect(item).toHaveTextContent(`confirmado no app · cód. ${OLEO}`)
      expect(within(item).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
      expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()               // o robô aplica a decisão ao lançar: não há mais o que travar
      expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
      expect(botaoLancar()).toBeEnabled()
    })

    describe('etapa 2: "confirmou no app → pode lançar" (o robô associa no SisChef ao lançar)', () => {
      const LEITE_COND = 3469626
      const lata = (extra: Partial<ItemNotaSefaz> = {}) => sem(1, { descricao: 'CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', qtd: 24, unidade_sischef: 'UN', ...extra })

      it('item sem produto no SisChef com decisão completa: o Lançar habilita, lança como sempre e o bloco "lancar-associa" diz o que o robô vai associar', async () => {
        aLancar(nota({ ...LIDA, itens: [item(), sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        // XML lido com boleto que fecha + decisão completa = nota "pronta" (regra 2): Boleto fixo em vez do Como pagar
        expect(screen.getByTestId('pagamento-fixo')).toHaveTextContent('Pagamento: Boleto (1 parcela)')
        expect(botaoLancar()).toBeEnabled()
        const aviso = screen.getByTestId('lancar-associa')
        expect(aviso).toHaveClass('amarelo')
        expect(aviso).toHaveTextContent('Ao lançar, o robô vai associar no SisChef:')
        const [linha] = within(aviso).getAllByTestId('lancar-associa-item')
        expect(linha).toHaveTextContent(`item 1 OLEO SOJA VITALIV PET 900ML → ÓLEO DE SOJA - INSUMOS (UN) (cód. ${OLEO})`)
        expect(linha).not.toHaveTextContent('1 UN =')                                      // unidades iguais: sem conversão
        expect(aviso).toHaveTextContent('Essa associação fica gravada no SisChef para as próximas notas deste fornecedor.')
        expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
        // o aviso fica junto do botão (depois dele), e continua à vista na pergunta "Confirmar?"
        expect(botaoLancar().compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        await userEvent.click(botaoLancar())
        expect(screen.getByText(/Vai lançar a NF 123/)).toBeInTheDocument()
        expect(screen.getByTestId('lancar-associa')).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto')                        // a decisão vai ao robô pela Edge Function (associacoes_app), não daqui
      })

      it('decisão completa COM conversão (nota em UN, produto em KG): habilita e o bloco mostra "1 UN = 0,395 KG" com o nome corrigido da lista', async () => {
        m.catalogoProdutos.mockResolvedValue([{ produto_id: LEITE_COND, nome: 'LEITE CONDENSADO - INSUMOS (KG)', nome_sischef: 'LEITE CONDESSADO - INSUMOS (KG)', unidade: 'kg' }])
        aLancar(nota({ ...LIDA, itens: [lata()], associacoes_app: { '1': decisao(LEITE_COND, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg', 0.395) } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(botaoLancar()).toBeEnabled()
        expect(screen.queryByTestId('bloqueio-nota')).not.toBeInTheDocument()
        const linha = within(screen.getByTestId('lancar-associa')).getByTestId('lancar-associa-item')
        await waitFor(() => expect(linha).toHaveTextContent(
          `item 1 LEITE COND TIROL SEMIDES TP 395G → LEITE CONDENSADO - INSUMOS (KG) (cód. ${LEITE_COND}) (no SisChef: LEITE CONDESSADO - INSUMOS (KG)) · 1 UN = 0,395 KG`,
        ))
      })

      it('decisão com unidades diferentes SEM conversão: o Lançar continua travado (aviso amarelo) e o bloco "lancar-travado" pede a conversão', async () => {
        aLancar(nota({ itens: [lata()], associacoes_app: { '1': decisao(LEITE_COND, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg') } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(botaoLancar()).toBeDisabled()
        const bloqueio = screen.getByTestId('bloqueio-nota')
        expect(bloqueio).toHaveTextContent('Produto confirmado no app, mas falta a conversão de unidade: informe na caixa de associação antes de lançar')
        expect(bloqueio).toHaveClass('amarelo')                                             // resolve-se aqui no app, não é o vermelho de "associe no SisChef"
        const travado = screen.getByTestId('lancar-travado')
        expect(travado).toHaveTextContent('O Lançar está apagado porque falta a conversão de unidade de algum item.')
        expect(within(travado).getByTestId('lancar-travado-item')).toHaveTextContent(
          `LEITE COND TIROL SEMIDES TP 395G → ${LEITE_COND} LEITE CONDESSADO - INSUMOS (KG) · informe quanto vale 1 UN em KG na caixa de associação`,
        )
        expect(screen.queryByTestId('lancar-associa')).not.toBeInTheDocument()
        expect(comoPagar()).toBeEnabled()                                                   // o resto dá para preparar enquanto isso
      })

      it('decisão com conversão mas produto de unidade desconhecida (produto novo, fora da lista): o app não exige nada, o robô decide com o cadastro vivo', async () => {
        aLancar(nota({ ...LIDA, itens: [lata()], associacoes_app: { '1': { produto_id: 3476455, produto_nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS', unidade: null } } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(botaoLancar()).toBeEnabled()
        expect(screen.getByTestId('lancar-associa-item')).toHaveTextContent('item 1 LEITE COND TIROL SEMIDES TP 395G → CHOCOLATE BIS ORIGINAL - INSUMOS (cód. 3476455)')
      })

      it('um item completo e outro ainda sem produto: trava (vermelho), o travado só lista o que falta e o "lancar-associa" não aparece', async () => {
        aLancar(nota({ itens: [sem(1), sem(2, { descricao: 'CÓD. FOR: 1 LEITE COND TIROL' })], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(botaoLancar()).toBeDisabled()
        expect(screen.getByTestId('bloqueio-nota')).toHaveClass('erro')
        const travado = screen.getByTestId('lancar-travado')
        expect(travado).toHaveTextContent('O Lançar está apagado porque falta produto no SisChef em algum item.')
        expect(within(travado).getAllByTestId('lancar-travado-item')).toHaveLength(1)
        expect(within(travado).getByTestId('lancar-travado-item')).toHaveTextContent('LEITE COND TIROL → escolha o produto em “Conferir itens e financeiro”')
        expect(screen.queryByTestId('lancar-associa')).not.toBeInTheDocument()
      })

      it('com o robô lançando a nota, ou com conta especial, o "lancar-associa" não aparece (não há o que lançar agora)', async () => {
        aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') }, lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() }))
        const a = render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(screen.queryByTestId('lancar-associa')).not.toBeInTheDocument()
        a.unmount()
        aLancar(nota({ emitente: 'KONDO COMERCIO LTDA', itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
        render(<NotaSefaz />)
        await screen.findByTestId('nota-a-lancar')
        expect(screen.queryByTestId('lancar-associa')).not.toBeInTheDocument()
        expect(botaoLancar()).toBeDisabled()
      })
    })

    it('com o item só pela metade decidido (um confirmado, um não): o aviso é o vermelho de sempre e o outro item continua com o campo', async () => {
      aLancar(nota({ itens: [sem(1), sem(2, { descricao: 'CÓD. FOR: 1 LEITE COND TIROL' })], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      const itens = (await painel()).getAllByTestId('conferir-item')
      expect(within(itens[0]).getByTestId('item-confirmado')).toBeInTheDocument()
      expect(within(itens[1]).queryByTestId('item-confirmado')).not.toBeInTheDocument()
      // o cartão do outro item só aparece quando a lista de produtos termina de carregar; as palavras-chave ("leite cond") indicam o LEITE CONDESSADO
      expect(await within(itens[1]).findByTestId('produto-escolhido')).toHaveTextContent('Produto que eu indiquei no SisChef')
      expect(screen.getByTestId('bloqueio-nota')).toHaveClass('erro')
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef: escolha o produto na caixa de associação (ou associe no SisChef) antes de lançar')
    })

    it('Trocar: reabre o campo (com Cancelar e Desfazer a escolha); trocar de produto e confirmar guarda o novo', async () => {
      aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
      expect(await campo()).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()   // voltou ao confirmado
      await userEvent.click(screen.getByRole('button', { name: 'Trocar' }))
      await userEvent.type(await campo(), 'muçarela')
      await userEvent.click(await achado(/Q\. MUÇARELA/))
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()            // muçarela é em KG e a nota em UN: falta a conversão
      await userEvent.type(campoConversao('UN', 'KG'), '1')                                // peça de 1 kg
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 1854713, 1))
    })

    it('Desfazer a escolha: manda produto nulo (a decisão some no banco) e conversão nula', async () => {
      aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer a escolha' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, null, null))
    })

    it('se guardar falhar: mostra o motivo em português, mantém o produto escolhido e dá para tentar de novo', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      m.associarItem.mockRejectedValueOnce(new Error('Este item já está associado no SisChef.'))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'oleo')
      await userEvent.click(await achado(/ÓLEO DE SOJA/))
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      expect(await screen.findByText('Este item já está associado no SisChef.')).toBeInTheDocument()
      expect(screen.getByTestId('produto-escolhido')).toHaveTextContent('ÓLEO DE SOJA')
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledTimes(2))
    })

    it('duplo toque no Confirmar guarda uma vez só', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      let liberar: () => void = () => undefined
      m.associarItem.mockImplementation(() => new Promise<void>((r) => { liberar = r }))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'oleo')
      await userEvent.click(await achado(/ÓLEO DE SOJA/))
      const botao = screen.getByRole('button', { name: 'Confirmar' })
      await userEvent.click(botao)
      await userEvent.click(screen.getByRole('button', { name: 'Confirmando…' }))
      expect(m.associarItem).toHaveBeenCalledTimes(1)
      liberar()
    })

    it('lista de produtos que não carrega: avisa em vez de deixar o campo morto', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      m.catalogoProdutos.mockRejectedValue(new Error('rede'))
      render(<NotaSefaz />)
      expect(await screen.findByText('Não consegui carregar a lista de produtos. Atualize a página.')).toBeInTheDocument()
      expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
    })

    it('só lê a lista de produtos quando alguma nota tem item sem produto', async () => {
      aLancar(nota({ itens: [item()] }))                                               // tudo associado no SisChef
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(m.catalogoProdutos).not.toHaveBeenCalled()
    })

    it('item já associado no SisChef não tem caixa; item sem número (n) não dá para associar pelo app', async () => {
      aLancar(nota({ itens: [item({ n: 1 }), sem(null)] }))
      render(<NotaSefaz />)
      const itens = (await painel()).getAllByTestId('conferir-item')
      expect(within(itens[0]).queryByTestId('associar-produto')).not.toBeInTheDocument()
      expect(within(itens[0]).getByTestId('item-ok')).toBeInTheDocument()
      expect(within(itens[1]).queryByTestId('associar-produto')).not.toBeInTheDocument()
      expect(itens[1]).toHaveTextContent('sem associação')
    })

    it('com o robô lançando a nota (ou ela pela metade) não dá para escolher produto: o campo some', async () => {
      for (const estado of ['lancando', 'erro'] as const) {
        aLancar(nota({ itens: [sem(1)], lancamento_estado: estado, lancamento_estado_em: new Date().toISOString(), lancamento_em: new Date().toISOString() } as Partial<NotaSefazLista>))
        const { unmount } = render(<NotaSefaz />)
        const item = (await painel()).getByTestId('conferir-item')
        expect(within(item).queryByTestId('associar-produto')).not.toBeInTheDocument()
        expect(item).toHaveTextContent('sem associação')
        unmount()
      }
    })

    describe('palavras-chave do Ivan, "Lembrar esta descrição" e o motivo do Lançar apagado (06/10 à noite)', () => {
      const MUCARELA = 1854713
      const NUGGETS = 3469754
      const LEITE = 3469626
      const COM_PALAVRAS: ProdutoCatalogo[] = [
        { produto_id: MUCARELA, nome: 'Q. MUÇARELA - INSUMOS (KG)', unidade: 'kg', palavras: 'queijo mussarela mozarela mozzarella' },
        { produto_id: NUGGETS, nome: 'NUGGETS SUPREME - INSUMOS (KG)', nome_sischef: 'NUGGSTES SUPREME - INSUMOS (KG)', unidade: 'kg', palavras: 'nuggets ou Chicken Supreme 2,5Kg' },
        { produto_id: LEITE, nome: 'LEITE CONDENSADO - INSUMOS (KG)', nome_sischef: 'LEITE CONDESSADO - INSUMOS (KG)', unidade: 'kg', palavras: 'leite semi condensado ou leite condensado' },
        { produto_id: OLEO, nome: 'ÓLEO DE SOJA - INSUMOS (UN)', unidade: 'un' },
      ]
      const DESC_SEARA = 'CÓD. FOR: 031647 CHICKEN SUPREME FS 2,5KG'
      const seara = (extra: Partial<ItemNotaSefaz> = {}) => sem(1, { descricao: DESC_SEARA, qtd: 2, unidade_sischef: 'CX', ...extra })
      const queijo = (extra: Partial<ItemNotaSefaz> = {}) =>
        sem(1, { descricao: 'CÓD. FOR: 221430 QUEIJO MUSS ARGE LA PAULINA BARR KG', qtd: 148.46, unidade_sischef: 'KG', ...extra })
      beforeEach(() => { m.catalogoProdutos.mockResolvedValue(COM_PALAVRAS) })

      it('a busca acha pela palavra-chave e pelo nome errado do SisChef, e mostra o nome corrigido com o original em letra pequena', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'chicken')                                  // só existe nas palavras-chave
        let achados = within(await screen.findByTestId('achados'))
        expect(achados.getAllByRole('button')).toHaveLength(1)
        expect(achados.getByRole('button')).toHaveTextContent('NUGGETS SUPREME - INSUMOS (KG)')
        expect(achados.getByRole('button')).toHaveTextContent('no SisChef: NUGGSTES SUPREME - INSUMOS (KG)')
        await userEvent.clear(await campo())
        await userEvent.type(await campo(), 'nuggstes')                                 // o nome como está (errado) no SisChef
        achados = within(await screen.findByTestId('achados'))
        expect(achados.getAllByRole('button')).toHaveLength(1)
        await userEvent.click(achados.getByRole('button'))
        expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent(`NUGGETS SUPREME - INSUMOS (KG) cód. ${NUGGETS} · KG · no SisChef: NUGGSTES SUPREME`)
      })

      it('nenhum produto com todas as palavras: mostra os que têm alguma (não fica no "nada") e dá para escolher', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'leite chocolate')
        expect(await screen.findByTestId('busca-parcial')).toHaveTextContent('Nenhum produto tem todas essas palavras')
        expect(screen.queryByTestId('sem-resultado')).not.toBeInTheDocument()
        await userEvent.click(await achado(/LEITE CONDENSADO/))
        expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent('LEITE CONDENSADO - INSUMOS (KG)')
      })

      it('sem palpite do robô, as palavras-chave indicam o produto (SEARA: "chicken supreme" → NUGGETS SUPREME): o cartão já abre com ele e o Confirmar (pedido do Ivan, 07/10)', async () => {
        aLancar(nota({ itens: [seara()] }))
        render(<NotaSefaz />)
        const escolhido = await screen.findByTestId('produto-escolhido')
        expect(escolhido).toHaveTextContent('Produto que eu indiquei no SisChef')
        expect(escolhido).toHaveTextContent('NUGGETS SUPREME - INSUMOS (KG)')
        expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()     // sem busca, sem Trocar: é só conferir e confirmar
        expect(screen.getByTestId('pedir-conversao')).toHaveTextContent('Quanto vale 1 CX em KG?')  // a nota vem em CX e o produto é em KG: pede a conversão
        expect(screen.queryByTestId('conversao-sugerida')).not.toBeInTheDocument()        // "2,5KG" é o pacote, não a caixa (nota em CX): nada de sugerir o peso
        expect(screen.getByLabelText('Quanto vale 1 CX em KG?')).toHaveValue('')
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()          // obrigatória e vazia
        expect(m.associarItem).not.toHaveBeenCalled()                                    // indicar não guarda: só o Confirmar
      })

      it('"queijo muss" = mussarela: a nota em KG já abre com o produto indicado e o Confirmar liberado (sem conversão)', async () => {
        aLancar(nota({ itens: [queijo({ sugestao: { id: String(MUCARELA), nome: 'Q. MUÇARELA - INSUMOS' } })] }))
        render(<NotaSefaz />)
        const escolhido = await screen.findByTestId('produto-escolhido')
        expect(escolhido).toHaveTextContent('Q. MUÇARELA - INSUMOS (KG)')
        expect(screen.queryByTestId('pedir-conversao')).not.toBeInTheDocument()           // KG × KG
        expect(screen.getByRole('button', { name: 'Confirmar' })).toBeEnabled()
        await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
        await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, MUCARELA, null))
      })

      it('robô e palavras-chave discordam: o cartão abre com o do robô; "Escolher outro" mostra as duas sugestões, cada uma com o seu rótulo', async () => {
        aLancar(nota({ itens: [queijo({ sugestao: { id: String(OLEO), nome: 'ÓLEO DE SOJA - INSUMOS' } })] }))
        render(<NotaSefaz />)
        expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent('ÓLEO DE SOJA - INSUMOS (UN)')
        await userEvent.click(screen.getByRole('button', { name: /Escolher outro/ }))
        expect(await screen.findByTestId('sugestao-robo')).toHaveTextContent('Sugestão do robô: ÓLEO DE SOJA - INSUMOS (UN)')
        expect(screen.getByTestId('sugestao-palavras')).toHaveTextContent('Pelas suas palavras-chave (queijo, muss): Q. MUÇARELA - INSUMOS (KG)')
      })

      describe('Lembrar esta descrição', () => {
        /** O cartão já abre com a sugestão (NUGGETS, em KG): informa a conversão (a caixa SEARA vem em CX: 1 CX = 2,5 KG), que a etapa 2 exige para confirmar. */
        const escolherSugestao = async () => {
          await userEvent.type(await screen.findByLabelText('Quanto vale 1 CX em KG?'), '2,5')
          return screen.findByTestId('lembrar-descricao')
        }

        it('vem marcado; ao confirmar guarda a escolha (com a conversão) E a descrição da nota (nessa ordem) e recarrega a lista de produtos', async () => {
          aLancar(nota({ itens: [seara()] }))
          m.lembrarDescricao.mockResolvedValue(true)
          render(<NotaSefaz />)
          const lembrar = await escolherSugestao()
          expect(within(lembrar).getByRole('checkbox')).toBeChecked()
          expect(lembrar).toHaveTextContent('Lembrar esta descrição: da próxima vez, “CHICKEN SUPREME FS 2,5KG” já sugere este produto')
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.lembrarDescricao).toHaveBeenCalledWith(NUGGETS, DESC_SEARA))
          expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, NUGGETS, 2.5)
          expect(m.associarItem.mock.invocationCallOrder[0]).toBeLessThan(m.lembrarDescricao.mock.invocationCallOrder[0])
          await waitFor(() => expect(m.catalogoProdutos).toHaveBeenCalledTimes(2))        // a lista nova já traz a descrição como palavra-chave
        })

        it('desmarcado, a descrição não é guardada (e a lista não é lida de novo)', async () => {
          aLancar(nota({ itens: [seara()] }))
          render(<NotaSefaz />)
          const lembrar = await escolherSugestao()
          await userEvent.click(within(lembrar).getByRole('checkbox'))
          expect(within(lembrar).getByRole('checkbox')).not.toBeChecked()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, NUGGETS, 2.5))
          expect(m.lembrarDescricao).not.toHaveBeenCalled()
          expect(m.catalogoProdutos).toHaveBeenCalledTimes(1)
        })

        it('se lembrar falhar, a confirmação fica valendo (o ✓ aparece e nenhum erro é mostrado)', async () => {
          const antes = nota({ itens: [seara()] })
          const depois = nota({ itens: [seara()], associacoes_app: { '1': decisao(NUGGETS, 'NUGGSTES SUPREME - INSUMOS (KG)', 'kg', 2.5) } })
          aLancar(antes)
          m.associarItem.mockImplementation(async () => { aLancar(depois) })
          m.lembrarDescricao.mockRejectedValue(new Error('sem rede'))
          render(<NotaSefaz />)
          await escolherSugestao()
          await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
          const item = (await painel()).getByTestId('conferir-item')
          await waitFor(() => expect(within(item).getByTestId('item-confirmado')).toBeInTheDocument())
          expect(within(item).queryByRole('alert')).not.toBeInTheDocument()
          expect(item).toHaveTextContent('NUGGETS SUPREME - INSUMOS (KG)')                // o ✓ mostra o nome corrigido da lista, não o do SisChef
        })

        it('Desfazer a escolha nunca guarda descrição nenhuma', async () => {
          aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
          render(<NotaSefaz />)
          await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
          await userEvent.click(await screen.findByRole('button', { name: 'Desfazer a escolha' }))
          await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, null, null))
          expect(m.lembrarDescricao).not.toHaveBeenCalled()
        })
      })

      it('produto escondido (receita da casa, não é de compra) não aparece na busca nem como sugestão do robô', async () => {
        m.catalogoProdutos.mockResolvedValue([
          ...COM_PALAVRAS,
          { produto_id: 3661383, nome: 'MAIONESE DA CASA (KG)', unidade: 'kg', oculto: true },
          { produto_id: 3474674, nome: 'MAIONESE MARIANA - INSUMOS (KG)', unidade: 'kg', palavras: 'MAIONESE MARIANA' },
        ])
        aLancar(nota({ itens: [sem(1, { descricao: 'CÓD. FOR: 55 MAIONESE GALAO 3KG', sugestao: { id: '3661383', nome: 'MAIONESE DA CASA' } })] }))
        render(<NotaSefaz />)
        await userEvent.type(await campo(), 'maionese')
        const achados = within(await screen.findByTestId('achados'))
        expect(achados.getAllByRole('button')).toHaveLength(1)
        expect(achados.getByRole('button')).toHaveTextContent('MAIONESE MARIANA')
        expect(screen.queryByTestId('sugestao-robo')).not.toBeInTheDocument()            // o palpite do robô era o produto escondido
      })

      it('nada sugere o produto (nem o robô, nem as palavras-chave): a caixa diz o que fazer; some ao digitar e não aparece quando há sugestão', async () => {
        aLancar(nota({ itens: [sem(1, { descricao: 'CÓD. FOR: 4471 PEITO FGO CONG IQF 1KG' })] }))
        const a = render(<NotaSefaz />)
        const dica = await screen.findByTestId('sem-sugestao')
        expect(dica).toHaveTextContent('Não achei este produto pelas suas palavras-chave. Digite o nome para procurar na sua lista')
        expect(dica).toHaveTextContent('da próxima vez o app já sugere')
        await userEvent.type(await campo(), 'frango')
        expect(screen.queryByTestId('sem-sugestao')).not.toBeInTheDocument()            // já está procurando
        a.unmount()
        aLancar(nota({ itens: [seara()] }))                                              // as palavras-chave indicam o produto: não precisa da dica
        render(<NotaSefaz />)
        await screen.findByTestId('produto-escolhido')
        expect(screen.queryByTestId('sem-sugestao')).not.toBeInTheDocument()
      })

      it('o painel de conferir abre sozinho enquanto falta escolher produto, e fica fechado quando tudo já está associado', async () => {
        aLancar(nota({ itens: [sem(1)] }))
        const a = render(<NotaSefaz />)
        expect(await screen.findByTestId('conferir')).toHaveAttribute('open')
        a.unmount()
        aLancar(nota({ itens: [item({ n: 1 })] }))
        render(<NotaSefaz />)
        expect(await screen.findByTestId('conferir')).not.toHaveAttribute('open')
      })

      describe('motivo do Lançar apagado, logo embaixo do botão', () => {
        it('produto confirmado em KG para nota em UN sem a conversão: diz que falta a conversão e qual item (código e nome da lista, com o nome do SisChef quando foi corrigido)', async () => {
          aLancar(nota({ itens: [sem(1, { descricao: 'CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', unidade_sischef: 'UN' })],
            associacoes_app: { '1': decisao(LEITE, 'LEITE CONDESSADO - INSUMOS (KG)', 'kg') } }))
          render(<NotaSefaz />)
          const aviso = await screen.findByTestId('lancar-travado')
          expect(aviso).toHaveTextContent('O Lançar está apagado porque falta a conversão de unidade de algum item.')
          expect(aviso).toHaveTextContent('Decida aqui no app: ao lançar, o robô associa no SisChef')
          expect(aviso).not.toHaveTextContent('o robô ainda não a aplica lá')                 // etapa 1: já era
          const [linha] = within(aviso).getAllByTestId('lancar-travado-item')
          // o nome corrigido vem da lista de produtos, que carrega um instante depois do aviso (antes disso vale o nome guardado na decisão)
          await waitFor(() => expect(linha).toHaveTextContent(
            `LEITE COND TIROL SEMIDES TP 395G → ${LEITE} LEITE CONDENSADO - INSUMOS (KG) (no SisChef: LEITE CONDESSADO - INSUMOS (KG)) · informe quanto vale 1 UN em KG na caixa de associação`,
          ))
          expect(botaoLancar()).toBeDisabled()
          // o aviso fica DEPOIS do botão (junto dele), não só lá em cima
          expect(botaoLancar().compareDocumentPosition(aviso) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        })

        it('item ainda sem escolha no app: manda escolher o produto em "Conferir itens e financeiro"', async () => {
          aLancar(nota({ itens: [sem(1)] }))
          render(<NotaSefaz />)
          expect(await screen.findByTestId('lancar-travado-item')).toHaveTextContent('OLEO SOJA VITALIV PET 900ML → escolha o produto em “Conferir itens e financeiro”')
          expect(screen.getByTestId('lancar-travado')).toHaveTextContent('O Lançar está apagado porque falta produto no SisChef em algum item.')
          expect(screen.getByTestId('lancar-travado')).toHaveTextContent('Se associar no SisChef, o botão libera na próxima leitura de lá.')
        })

        it('item sem número na nota (n nulo) não dá para decidir pelo app: o travado manda associar no SisChef', async () => {
          aLancar(nota({ itens: [sem(null)] }))
          render(<NotaSefaz />)
          expect(await screen.findByTestId('lancar-travado-item')).toHaveTextContent('OLEO SOJA VITALIV PET 900ML → este item veio sem número na nota: associe no SisChef')
        })

        it('nota que pode ser lançada, ou com o robô trabalhando nela, não mostra esse aviso', async () => {
          aLancar(nota({ itens: [item()] }))
          const a = render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
          a.unmount()
          aLancar(nota({ itens: [sem(1)], lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString(), lancamento_em: new Date().toISOString() } as Partial<NotaSefazLista>))
          render(<NotaSefaz />)
          await screen.findByTestId('nota-a-lancar')
          expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument()
        })
      })
    })
  })
})
