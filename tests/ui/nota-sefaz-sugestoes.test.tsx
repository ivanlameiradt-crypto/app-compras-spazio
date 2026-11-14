// 14/11/2026 (pedido do Ivan, etapas 4 a 6 do inventário dos erros do robô): quando o robô para por um NÚMERO que o app tira com segurança de uma fonte certa (o nome do produto,
// os boletos da própria nota, a forma que o app lembra do fornecedor), a faixa amarela mostra a sugestão com a conta e um botão que a aceita. Nada é lançado sem o toque do Ivan.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '6'.repeat(44)
const CNPJ = '11222333000144'
const PREFIXO = 'parou antes de gerar o pedido (nada lançado): '
const UN_DIFERE = `${PREFIXO}UN DIFERE sem conversão na tela: CÓD. FOR 5510 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)`
const KETCHUP_B = 'ketchup sachê: a nota traz 10 caixa(s) de 168 un e a tela mostra 10 un; o certo é 1.680 un — no app, toque em Editar neste item e informe 1 UN = 168 (ou acerte a quantidade no SisChef) e lance de novo'
const BOLETOS = `${PREFIXO}o XML desta nota já traz boletos (R$ 60,00 em 05/11/2026 + R$ 40,00 em 12/11/2026) e as parcelas digitadas são outras: o XML prevalece e não uso as digitadas — no app, toque em Atualizar e lance de novo sem digitar parcelas — REVISAR`
const ITAU = "conta PIX 'itau|ij' não existe (esperado 'pix:<banco>|<empresa>' com uma destas: bradesco|ij, pangbank|ij)"
const KETCHUP = { n: 3, descricao: 'CÓD. FOR: 5510 KETCHUP SACHE HEINZ 168UN', qtd: 10, qtd_nota: 10, unidade_sischef: 'UN', unidade_nota: 'CX', produto_id: '777', produto_nome: 'KETCHUP SACHE - INSUMOS', associacao: 'sischef' }
const OUTRO = { n: 1, descricao: 'CÓD. FOR: 11 AGUA SEM GÁS 500ML', qtd: 60, unidade_sischef: 'UN', produto_id: '1836957', produto_nome: 'AGUA SEM GAS - INSUMOS', associacao: 'sischef' }
const nota = (extra: Record<string, unknown> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: CNPJ, emitente: 'HEINZ DISTRIBUIDORA LTDA', numero: '000321', emissao: '2026-11-13', valor_nf: 100,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [{ numero: '001', vencimento: '2026-11-05', valor: 60 }, { numero: '002', vencimento: '2026-11-12', valor: 40 }],
  itens: [OUTRO, KETCHUP], associacoes_app: null, forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: KETCHUP_B,
  ...extra,
} as unknown as NotaSefazLista)
const ketchupGravado = (conversao: number) => ({ '3': { produto_id: 777, produto_nome: 'KETCHUP SACHE - INSUMOS', unidade: null, conversao, origem: 'sischef', por: 'ivan@spazio.invalid', em: '2026-11-14T10:00:00Z' } })
const faixa = async () => { await screen.findByTestId('nota-a-lancar'); return screen.getByTestId('status-nota') }

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
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

describe('NotaSefaz — conversão sugerida pelo nome do produto (UN DIFERE sem conversão)', () => {
  it('a frase curta com a conta e o botão; o texto cru do robô fica em "Ver o texto do robô"', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Nada foi lançado.')
    expect(aviso).toHaveTextContent('Item 3 (KETCHUP SACHE HEINZ 168UN): falta a conversão de unidade. Sugestão: 1 unidade da nota = 168 (o nome diz 168UN). Conta: 10 × 168 = 1.680 UN.')
    expect(aviso).not.toHaveTextContent('UN DIFERE')
    expect(within(aviso).getByRole('button', { name: 'Usar 168 e lançar' })).toBeEnabled()
    const cru = screen.getByTestId('texto-do-robo')
    expect(cru).toHaveTextContent('ketchup sachê: a nota traz 10 caixa(s) de 168 un')
  })

  it('o toque grava a conversão pela função do item e SÓ DEPOIS dispara o mesmo lançamento do botão Lançar; enquanto grava, o botão fica travado', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    let soltar!: () => void
    m.converterItem.mockReturnValue(new Promise<void>((ok) => { soltar = ok }))
    m.lancarNota.mockImplementation(async () => { m.notasALancar.mockResolvedValue([nota({ associacoes_app: ketchupGravado(168), lancamento_estado: 'lancando', lancamento_em: new Date().toISOString() } as unknown as Partial<NotaSefazLista>)]) })
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: 'Usar 168 e lançar' }))
    const gravando = screen.getByRole('button', { name: 'Gravando…' })
    expect(gravando).toBeDisabled()
    expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168)
    expect(m.lancarNota).not.toHaveBeenCalled()
    await userEvent.click(gravando)
    expect(m.converterItem).toHaveBeenCalledTimes(1)
    await act(async () => { soltar() })
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('status-nota')).toHaveTextContent('Lançando…'))
  })

  it('peso no nome (395G), produto em KG: sugere 0,395 com a conta em KG', async () => {
    m.notasALancar.mockResolvedValue([nota({
      itens: [OUTRO, { n: 4, descricao: 'CÓD. FOR: 99 LEITE COND TIROL SEMIDES TP 395G', qtd: 24, qtd_nota: 24, unidade_sischef: 'KG', unidade_nota: 'UN', produto_id: '888', produto_nome: 'LEITE CONDENSADO - INSUMOS', associacao: 'sischef' }],
      lancamento_motivo: UN_DIFERE.replace('5510', '99'),
    } as unknown as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Conta: 24 × 0,395 = 9,48 KG.')
    await userEvent.click(within(aviso).getByRole('button', { name: 'Usar 0,395 e lançar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 4, 0.395))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
  })

  it('outra nota está lançando: o botão só grava (não lança) e a frase manda tocar em Lançar', async () => {
    const outra = nota({ chave: '8'.repeat(44), numero: '000099', emitente: 'OUTRA LTDA', lancamento_estado: 'lancando', lancamento_motivo: null, lancamento_em: new Date().toISOString(), itens: [OUTRO] } as unknown as Partial<NotaSefazLista>)
    m.notasALancar.mockResolvedValue([nota(), outra])
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([nota({ associacoes_app: ketchupGravado(168) }), outra]) })
    render(<NotaSefaz />)
    await screen.findAllByTestId('nota-a-lancar')
    const aviso = screen.getAllByTestId('status-nota').find((x) => (x.textContent ?? '').includes('Item 3'))!
    expect(within(aviso).queryByRole('button', { name: 'Usar 168 e lançar' })).not.toBeInTheDocument()
    await userEvent.click(within(aviso).getByRole('button', { name: 'Usar 168' }))
    expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168)
    await waitFor(() => expect(aviso).toHaveTextContent('conversão 168 gravada (10 × 168 = 1.680 UN). Agora toque em Lançar.'))
    expect(m.lancarNota).not.toHaveBeenCalled()
  })

  it('falhou ao gravar: mensagem simples, nada é lançado e o botão continua', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.converterItem.mockRejectedValue(new Error('Não consegui guardar a conversão agora. Confira a internet e tente de novo.'))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: 'Usar 168 e lançar' }))
    expect(await screen.findByTestId('sugestao-erro')).toHaveTextContent('Não consegui guardar a conversão agora. Confira a internet e tente de novo.')
    expect(m.lancarNota).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('status-nota')).getByRole('button', { name: 'Usar 168 e lançar' })).toBeEnabled()
  })

  it('gravou mas o lançamento falhou: diz que gravou e manda tocar em Lançar', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([nota({ associacoes_app: ketchupGravado(168) })]) })
    m.lancarNota.mockRejectedValue(new Error('O robô está ocupado. Tente daqui a pouco.'))
    render(<NotaSefaz />)
    await userEvent.click(within(await faixa()).getByRole('button', { name: 'Usar 168 e lançar' }))
    expect(await screen.findByTestId('sugestao-erro')).toHaveTextContent('Gravei a conversão, mas não consegui lançar agora: O robô está ocupado. Tente daqui a pouco. Toque em Lançar para tentar de novo.')
    await waitFor(() => expect(screen.getByTestId('status-nota')).toHaveTextContent('conversão 168 gravada'))
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })

  it('sem número seguro no nome: nada muda (o texto de hoje, sem botão de sugestão)', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: UN_DIFERE, itens: [OUTRO, { ...KETCHUP, descricao: 'CÓD. FOR: 5510 KETCHUP SACHE HEINZ' }] } as unknown as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('o app ainda não tem o número')
    expect(aviso).not.toHaveTextContent('Sugestão')
    expect(within(aviso).queryByRole('button')).not.toBeInTheDocument()
  })

  it('ketchup: o robô disse o fator do nome e o app tinha outro; o botão troca para o do nome', async () => {
    m.notasALancar.mockResolvedValue([nota({
      lancamento_motivo: 'ketchup sachê: o nome diz 168 un por caixa e o app tem 1 UN = 12: no app, toque em Editar neste item e informe 168 (ou acerte no SisChef) e lance de novo',
      associacoes_app: ketchupGravado(12),
    } as unknown as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Hoje o app tem 12.')
    await userEvent.click(within(aviso).getByRole('button', { name: 'Usar 168 e lançar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
  })
})

describe('NotaSefaz — usar os boletos da nota (as parcelas digitadas eram outras)', () => {
  it('a frase com a conta e o botão; o toque lança em boleto SEM parcelas digitadas', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: BOLETOS })])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Conta: R$ 60,00 (05/11/2026) + R$ 40,00 (12/11/2026) = R$ 100,00, o valor da nota.')
    expect(aviso).not.toHaveTextContent('o XML prevalece')
    expect(screen.getByTestId('texto-do-robo')).toHaveTextContent('o XML prevalece')
    await userEvent.click(within(aviso).getByRole('button', { name: 'Usar os boletos da nota e lançar' }))
    await waitFor(() => expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto'))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    expect(m.converterItem).not.toHaveBeenCalled()
  })

  it('outra nota lançando: o botão fica apagado (as mesmas travas do Lançar)', async () => {
    const outra = nota({ chave: '8'.repeat(44), numero: '000099', emitente: 'OUTRA LTDA', lancamento_estado: 'lancando', lancamento_motivo: null, lancamento_em: new Date().toISOString(), itens: [OUTRO] } as unknown as Partial<NotaSefazLista>)
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: BOLETOS }), outra])
    render(<NotaSefaz />)
    await screen.findAllByTestId('nota-a-lancar')
    const aviso = screen.getAllByTestId('status-nota').find((x) => (x.textContent ?? '').includes('boletos da nota'))!
    expect(within(aviso).getByRole('button', { name: 'Usar os boletos da nota e lançar' })).toBeDisabled()
  })

  it('os boletos do app são outros: nada muda (texto de hoje)', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_motivo: BOLETOS, parcelas: [{ numero: '001', vencimento: '2026-11-05', valor: 100 }] } as unknown as Partial<NotaSefazLista>)])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(within(aviso).queryByRole('button')).not.toBeInTheDocument()
    expect(aviso).toHaveTextContent('o XML prevalece')
  })
})

describe('NotaSefaz — forma de pagamento que o app lembra do fornecedor', () => {
  const notaItau = () => nota({ forma_pagamento: 'pix:itau|ij', parcelas: [], lancamento_motivo: `${PREFIXO}${ITAU}` } as unknown as Partial<NotaSefazLista>)
  it('a frase diz de onde vem; o toque só ESCOLHE a forma (não lança: o Lançar normal ainda pede o Confirmar)', async () => {
    m.formasPadraoPorFornecedor.mockResolvedValue({ [CNPJ]: 'dinheiro' })
    m.notasALancar.mockResolvedValue([notaItau()])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(aviso).toHaveTextContent('Sugestão: Dinheiro à vista, a forma da última nota lançada deste fornecedor.')
    await userEvent.click(within(aviso).getByRole('button', { name: 'Usar Dinheiro à vista' }))
    await waitFor(() => expect(screen.getByLabelText('Como pagar')).toHaveValue('dinheiro'))
    expect(m.lancarNota).not.toHaveBeenCalled()
    expect(screen.getByTestId('status-nota')).toHaveTextContent('Ela já está marcada')
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
  })

  it('nada lembrado: nada muda (sem botão de sugestão)', async () => {
    m.notasALancar.mockResolvedValue([notaItau()])
    render(<NotaSefaz />)
    const aviso = await faixa()
    expect(within(aviso).queryByRole('button')).not.toBeInTheDocument()
    expect(aviso).toHaveTextContent('não existe')
  })
})
