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
      await userEvent.click(botaoLancar())
      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
      await userEvent.click(botaoLancar())
      await userEvent.selectOptions(comoPagar(), 'dinheiro')
      expect(screen.queryByText(/Confirmar\?/)).not.toBeInTheDocument()
      expect(m.lancarNota).not.toHaveBeenCalled()
    })

    it('duplo toque em Confirmar não manda duas vezes (botão trava enquanto envia)', async () => {
      aLancar(nota({}))
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
      aLancar(nota({}))
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
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef: associe lá antes de lançar')
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
      aLancar(nota({ itens: [item(), item({ associacao: null })] }))
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
      aLancar(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'item   X sem  unidade' }))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: item X sem unidade')
      expect(botaoLancar()).toBeEnabled()
    })

    it("'ensaio_ok': mostra o que o robô faria e nada foi criado", async () => {
      aLancar(nota({ lancamento_estado: 'ensaio_ok', lancamento_motivo: 'criaria compra com 3 itens e 3 boletos' }))
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
      aLancar(nota({ lancamento_estado: 'lancando', lancamento_estado_em: velho }))
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
        nota({ chave: '2'.repeat(44), emitente: 'B LTDA' }),
      )
      render(<NotaSefaz />)
      const [, livreB] = await screen.findAllByTestId('nota-a-lancar')
      expect(within(livreB).getByRole('button', { name: 'Lançar' })).toBeEnabled()
      expect(within(livreB).queryByTestId('aviso-outra')).not.toBeInTheDocument()
    })

    it('enquanto um Confirmar está enviando, as outras notas ficam bloqueadas (sem 2 disparos juntos)', async () => {
      let liberar: () => void = () => undefined
      m.lancarNota.mockImplementation(() => new Promise<void>((ok) => { liberar = ok }))
      aLancar(nota({ chave: '1'.repeat(44), emitente: 'A LTDA' }), nota({ chave: '2'.repeat(44), emitente: 'B LTDA' }))
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
      expect(vi.getTimerCount()).toBe(1)
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

    it.each([
      ['boletos que não fecham', { parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 10 }] }, 'Os boletos não fecham com o valor da nota'],
      ['XML não lido', { parcelas: null }, 'Boletos ainda não lidos do XML (próxima leitura)'],
    ])('%s: não é pronta, avisa o motivo e mantém o Como pagar', async (_n, extra, motivo) => {
      aLancar(pronta(extra as Partial<NotaSefazLista>))
      render(<NotaSefaz />)
      await screen.findByTestId('nota-a-lancar')
      expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
      expect(screen.getByTestId('aviso-financeiro')).toHaveTextContent(motivo)
      expect(comoPagar()).toBeInTheDocument()
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
      expect(within(paineis[1]).getByTestId('fin-nao-lido')).toBeInTheDocument()
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

    it('nota com boletos no XML, ou XML ainda não lido, não mostra o editor', async () => {
      aLancar(semDuplicata({ parcelas: [{ numero: '1', vencimento: '2026-11-05', valor: 100 }] }), semDuplicata({ chave: '8'.repeat(44), parcelas: null }))
      render(<NotaSefaz />)
      await screen.findAllByTestId('nota-a-lancar')
      expect(screen.queryByTestId('editor-parcelas')).not.toBeInTheDocument()
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
    const decisao = (id: number, nome: string, unidade = 'un') => ({ produto_id: id, produto_nome: nome, unidade, por: 'ivan@spazio.com', em: '2026-10-06T23:00:00Z' })
    const painel = async () => within(await screen.findByTestId('conferir'))
    const campo = async () => (await painel()).findByLabelText('Produto do SisChef')

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
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, OLEO))
      const item = (await painel()).getByTestId('conferir-item')
      await waitFor(() => expect(within(item).getByTestId('item-confirmado')).toBeInTheDocument())  // o ✓ de confirmado
      expect(within(item).getByTestId('item-confirmado')).toHaveAccessibleName('produto confirmado no app')
      expect(item).toHaveTextContent('ÓLEO DE SOJA - INSUMOS (UN)')
      expect(item).toHaveTextContent(`confirmado no app · cód. ${OLEO}`)
      expect(item).not.toHaveTextContent('sem produto')
      expect(within(item).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
      expect(within(item).getByRole('button', { name: 'Trocar' })).toBeInTheDocument()
    })

    it('a sugestão do robô é só atalho: um toque a escolhe, mas quem guarda é o Confirmar', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: '3469626', nome: 'LEITE CONDENSADO - INSUMOS' } })] }))
      render(<NotaSefaz />)
      const sug = await screen.findByTestId('sugestao-robo')
      expect(sug).toHaveTextContent('Sugestão do robô: LEITE CONDESSADO - INSUMOS (KG)')   // o nome vem da lista do app, não do palpite
      await userEvent.click(within(sug).getByRole('button'))
      expect(await screen.findByTestId('produto-escolhido')).toHaveTextContent('LEITE CONDESSADO - INSUMOS (KG)')
      expect(m.associarItem).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3469626))
    })

    it('produto NOVO (o robô já o vê no SisChef, mas ele não está na lista semanal do app): a sugestão aparece marcada como nova e dá para confirmar', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: '3476455', nome: 'CHOCOLATE BIS ORIGINAL - INSUMOS' } })] }))
      render(<NotaSefaz />)
      const sug = await screen.findByTestId('sugestao-robo')
      expect(sug).toHaveTextContent('Sugestão do robô: CHOCOLATE BIS ORIGINAL - INSUMOS · produto novo no SisChef')
      await userEvent.click(within(sug).getByRole('button', { name: 'CHOCOLATE BIS ORIGINAL - INSUMOS' }))
      const escolhido = await screen.findByTestId('produto-escolhido')
      expect(escolhido).toHaveTextContent('CHOCOLATE BIS ORIGINAL - INSUMOS')
      expect(escolhido).toHaveTextContent('cód. 3476455 · novo, ainda fora da lista semanal')
      expect(screen.queryByTestId('aviso-unidade')).not.toBeInTheDocument()            // sem unidade conhecida, não há como comparar
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 3476455))
    })

    it('palpite sem código válido não vira sugestão', async () => {
      aLancar(nota({ itens: [sem(1, { sugestao: { id: 'abc', nome: 'SEM CÓDIGO' } })] }))
      render(<NotaSefaz />)
      await campo()
      expect(screen.queryByTestId('sugestao-robo')).not.toBeInTheDocument()
    })

    it('unidade diferente (nota em UN, produto em KG): avisa que vai precisar de conversão; unidade igual: sem aviso', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'leite cond')
      await userEvent.click(await screen.findByRole('button', { name: /LEITE CONDESSADO/ }))
      expect(await screen.findByTestId('aviso-unidade')).toHaveTextContent('A nota vem em UN e este produto é em KG')
      expect(screen.getByTestId('aviso-unidade')).toHaveTextContent('1 UN em KG')
      await userEvent.click(screen.getByRole('button', { name: 'Escolher outro' }))
      await userEvent.type(await campo(), 'oleo')
      await userEvent.click(await screen.findByRole('button', { name: /ÓLEO DE SOJA/ }))
      expect(await screen.findByTestId('produto-escolhido')).toBeInTheDocument()
      expect(screen.queryByTestId('aviso-unidade')).not.toBeInTheDocument()
    })

    it('nada na lista: avisa que o produto precisa existir (cadastre no SisChef) e não oferece Confirmar', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'chocolate bis')
      expect(await screen.findByTestId('sem-resultado')).toHaveTextContent('cadastre-o no SisChef')
      expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument()
    })

    it('nota já com a escolha confirmada: ✓ + "confirmado no app", sem campo; o aviso do Lançar vira amarelo e o Lançar segue travado', async () => {
      aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      const item = (await painel()).getByTestId('conferir-item')
      expect(within(item).getByTestId('item-confirmado')).toBeInTheDocument()
      expect(within(item).queryByTestId('item-ok')).not.toBeInTheDocument()               // não é o ✓ de "associado no SisChef"
      expect(item).toHaveTextContent(`confirmado no app · cód. ${OLEO}`)
      expect(within(item).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
      const aviso = screen.getByTestId('bloqueio-nota')
      expect(aviso).toHaveTextContent('Os produtos já estão confirmados no app, mas o robô ainda não os aplica no SisChef')
      expect(aviso).toHaveClass('amarelo')
      expect(botaoLancar()).toBeDisabled()
    })

    it('com o item só pela metade decidido (um confirmado, um não): o aviso é o vermelho de sempre e o outro item continua com o campo', async () => {
      aLancar(nota({ itens: [sem(1), sem(2, { descricao: 'CÓD. FOR: 1 LEITE COND TIROL' })], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      const itens = (await painel()).getAllByTestId('conferir-item')
      expect(within(itens[0]).getByTestId('item-confirmado')).toBeInTheDocument()
      expect(within(itens[1]).queryByTestId('item-confirmado')).not.toBeInTheDocument()
      expect(await within(itens[1]).findByLabelText('Produto do SisChef')).toBeInTheDocument()   // o campo só aparece quando a lista de produtos termina de carregar
      expect(screen.getByTestId('bloqueio-nota')).toHaveClass('erro')
      expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef: associe lá antes de lançar')
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
      await userEvent.click(await screen.findByRole('button', { name: /Q\. MUÇARELA/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 1854713))
    })

    it('Desfazer a escolha: manda produto nulo (a decisão some no banco)', async () => {
      aLancar(nota({ itens: [sem(1)], associacoes_app: { '1': decisao(OLEO, 'ÓLEO DE SOJA - INSUMOS (UN)') } }))
      render(<NotaSefaz />)
      await userEvent.click((await painel()).getByRole('button', { name: 'Trocar' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Desfazer a escolha' }))
      await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, null))
    })

    it('se guardar falhar: mostra o motivo em português, mantém o produto escolhido e dá para tentar de novo', async () => {
      aLancar(nota({ itens: [sem(1)] }))
      m.associarItem.mockRejectedValueOnce(new Error('Este item já está associado no SisChef.'))
      render(<NotaSefaz />)
      await userEvent.type(await campo(), 'oleo')
      await userEvent.click(await screen.findByRole('button', { name: /ÓLEO DE SOJA/ }))
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
      await userEvent.click(await screen.findByRole('button', { name: /ÓLEO DE SOJA/ }))
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
  })
})
