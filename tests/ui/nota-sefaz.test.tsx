import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import { lembrarForma } from '../../src/admin/notaSefazRegras'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

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
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz', () => {
  it('mostra o título e o modo "eu disparo"', async () => {
    render(<NotaSefaz />)
    expect(await screen.findByRole('heading', { name: 'Lançamento de nota SEFAZ' })).toBeInTheDocument()
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
      expect(itens[0]).toHaveTextContent('associado no SisChef')
      expect(itens[0]).not.toHaveTextContent('CÓD. FOR')
      expect(itens[1]).toHaveTextContent('produto 77') // sem o nome vindo do robô, mostra o código
      const par = within(painel).getAllByTestId('conferir-parcela')
      expect(par[0]).toHaveTextContent('Parcela 001 · vence 05/11/2026')
      expect(par[0]).toHaveTextContent(/R\$\s60,00/)
      expect(within(painel).getByTestId('fin-total')).toHaveTextContent(/Soma dos boletos R\$\s100,00 · valor da nota R\$\s100,00 · bate/)
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
