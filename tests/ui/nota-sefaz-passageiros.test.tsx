// 14/11/2026 (pedido do Ivan, leigo): quando o robô devolve a nota por um motivo PASSAGEIRO (SisChef lento, conexão, login que caiu...) a faixa dizia o texto cru ("Timeout 90000ms exceeded").
// Agora: uma frase curta que diz que nada foi lançado e o botão "Tentar de novo", que faz exatamente o que o Lançar faz (mesmas travas). O texto do robô fica em "Ver o texto do robô".
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '6'.repeat(44)
const ANTES = 'parou antes de gerar o pedido (nada lançado): '
const CRU = `${ANTES}TimeoutError: Page.goto: Timeout 90000ms exceeded.`
const FRASE = 'Nada foi lançado. O SisChef demorou ou a conexão caiu e o robô parou. Toque em Tentar de novo.'
const TALVEZ = 'o robô parou antes de terminar: TargetClosedError: Target page, context or browser has been closed — confira no SisChef se algo foi criado antes de lançar de novo'
const BOTAO = 'Tentar de novo'

const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '11222333000144', emitente: 'ACME ALIMENTOS LTDA', numero: '000012345', emissao: '2026-11-13', valor_nf: 500,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  parcelas: [{ numero: '001', vencimento: '2026-12-13', valor: 500 }],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 10 ARROZ 5KG', qtd: 10, unidade_sischef: 'UN', produto_id: '111', produto_nome: 'ARROZ - INSUMOS', associacao: 'sischef' }],
  associacoes_app: null, forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: CRU,
  ...extra,
} as unknown as NotaSefazLista)
const faixa = async (): Promise<HTMLElement> => { await screen.findByTestId('nota-a-lancar'); return screen.getByTestId('status-nota') }

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
})

describe('NotaSefaz — motivo passageiro: frase curta e "Tentar de novo"', () => {
  it('no lugar do texto cru: a frase curta e o botão; o texto do robô fica recolhido em "Ver o texto do robô"', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent(FRASE)
    expect(aviso).not.toHaveTextContent('Timeout')
    expect(within(aviso).getByRole('button', { name: BOTAO })).toBeEnabled()
    const detalhe = screen.getByTestId('texto-do-robo') as HTMLDetailsElement
    expect(detalhe.open).toBe(false)                                                    // recolhido
    expect(within(detalhe).getByText('Ver o texto do robô')).toBeInTheDocument()
    expect(detalhe).toHaveTextContent(CRU)                                              // o texto exato do robô continua guardado e visível ao abrir
  })

  it('o toque dispara o MESMO lançamento do botão Lançar (forma, sem pedir confirmação de novo), uma vez só, e a nota passa a "Lançando…"', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.lancarNota.mockImplementation(async () => { m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'lancando', lancamento_motivo: null, lancamento_em: new Date().toISOString() } as Partial<NotaSefazLista>)]) })
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('status-nota')).toHaveTextContent('Lançando…'))
    expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    expect(screen.queryByTestId('texto-do-robo')).not.toBeInTheDocument()
  })

  it('enquanto envia o botão fica travado (toque repetido não lança duas vezes)', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    let soltar!: () => void
    m.lancarNota.mockReturnValue(new Promise<void>((ok) => { soltar = ok }))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    const enviando = await screen.findByRole('button', { name: 'Enviando…' })
    expect(enviando).toBeDisabled()
    await userEvent.click(enviando)
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    soltar()
  })

  it('o envio falhou: mostra a mensagem simples do app, a faixa e o botão continuam', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.lancarNota.mockRejectedValue(new Error('Não consegui chamar o robô agora, tente de novo.'))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: BOTAO }))
    expect(await screen.findByText('Não consegui chamar o robô agora, tente de novo.')).toBeInTheDocument()
    expect(within(screen.getByTestId('status-nota')).getByRole('button', { name: BOTAO })).toBeEnabled()
  })

  it('boleto sem parcelas lidas: o botão fica travado como o Lançar (mesmas travas) e nada é enviado', async () => {
    m.notasALancar.mockResolvedValue([nota({ parcelas: null } as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(within(aviso).getByRole('button', { name: BOTAO })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
    expect(m.lancarNota).not.toHaveBeenCalled()
  })

  it('outra nota está lançando: o botão fica desabilitado, como o Lançar', async () => {
    const outra = nota({ chave: '8'.repeat(44), numero: '000099999', emitente: 'OUTRA LTDA', lancamento_estado: 'lancando', lancamento_motivo: null, lancamento_em: new Date().toISOString() } as Partial<NotaSefazLista>)
    m.notasALancar.mockResolvedValue([nota(), outra])
    render(<NotaSefaz />)
    await screen.findAllByTestId('nota-a-lancar')
    const aviso = screen.getAllByTestId('status-nota').find((x) => (x.textContent ?? '').includes('Nada foi lançado'))!
    expect(within(aviso).getByRole('button', { name: BOTAO })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Lançar' })[0]).toBeDisabled()
  })

  it('pode ter sido lançado em parte: só manda conferir, SEM o botão "Tentar de novo" e sem a frase de repetir', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: TALVEZ })])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Pode ter sido lançado em parte')
    expect(aviso).toHaveTextContent('Confira no SisChef')
    expect(aviso).not.toHaveTextContent('Tentar de novo')
    expect(within(aviso).queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    expect(screen.getByTestId('texto-do-robo')).toHaveTextContent(TALVEZ)               // o texto cru continua à mão
  })

  it('motivo que a regra não reconhece: o comportamento de sempre (texto do robô, sem botão novo, sem "Ver o texto")', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: 'uma coisa nova que o robô inventou' })])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Precisa de você: uma coisa nova que o robô inventou')
    expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    expect(screen.queryByTestId('texto-do-robo')).not.toBeInTheDocument()
  })

  it('nota que ficou pela metade (erro) não ganha o botão, mesmo com um texto de tempo esgotado', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'erro', lancamento_motivo: CRU })])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Ficou pela metade')
    expect(screen.queryByRole('button', { name: BOTAO })).not.toBeInTheDocument()
    expect(screen.queryByTestId('texto-do-robo')).not.toBeInTheDocument()
  })
})
