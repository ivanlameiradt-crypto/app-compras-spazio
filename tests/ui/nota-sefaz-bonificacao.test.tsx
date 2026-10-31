// Bonificação sozinha, a TELA (pedido do Ivan de 27/10/2026: "você tem que identificar isso nas notas que são feitas de bonificação: sempre só estoque").
// Nota com CFOP 5910/6910 em TODOS os itens (etiquetados pelo robô em `itens[i].cfop`) E o XML lido sem boletos: a aba "Lançamento fiscal" abre já em "Só estoque (bonificação)"
// (forma cartão, única opção, travada), com uma etiqueta calma, sem pedir boleto nem parcelas e sem o aviso de forma não testada. Com boletos no XML ela NÃO marca nada
// (avisa para conferir com o fornecedor); com o XML por ler, a nota segue como qualquer outra. Tudo INVENTADO (repositório público).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { ItemNotaSefaz, NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '5'.repeat(44)
const chaveN = (c: string) => c.repeat(44)
const boleto = [{ numero: '1', vencimento: '2026-11-20', valor: 509.6 }]
const TODAS_AS_FORMAS = [
  'boleto', 'dinheiro', 'tesouraria',
  'pix:pangbank|ij', 'pix:pangbank|sp', 'pix:bradesco|ij', 'pix:bradesco|sp', 'pix:caixa|ij', 'pix:caixa|sp',
  'cartao',
]
const AVISO_COM_BOLETO = 'Esta nota tem CFOP de bonificação (5910/6910), mas traz boletos. Confira com o fornecedor se há algo a pagar antes de lançar.'
const TEXTO_BONIFICACAO = 'Nota de bonificação: o fornecedor mandou como brinde (CFOP 5910). Entra só no estoque, sem conta a pagar.'
/** A mensagem da trava nova do robô (PR do robô, 29/10/2026) para a bonificação que ele recebeu com uma forma que criaria conta a pagar. */
const MOTIVO_TRAVA_DO_ROBO = 'nota de bonificação (CFOP 5910/6910): é um brinde do fornecedor, entra só no estoque e não tem conta a pagar — a forma de pagamento escolhida (boleto) criaria um pagamento que não existe. '
  + 'Nada foi feito no SisChef. No app, escolha “só estoque” e lance de novo'

/** Um item já associado no SisChef; `cfop` undefined = sem a chave (nota que o robô ainda não re-etiquetou). */
const item = (cfop?: string | null, extra: Partial<ItemNotaSefaz> = {}): ItemNotaSefaz =>
  ({ n: 1, descricao: 'CÓD. FOR: 100 PÃO TESTE PCT 15', qtd: 240, unidade_sischef: 'UN', produto_id: 7001, associacao: 'sischef', produto_nome: 'PÃO TESTE', ...(cfop === undefined ? {} : { cfop }), ...extra })
/** Por padrão: bonificação (item 5910), XML lido e sem boletos. */
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '12345678000190', emitente: 'FORNECEDOR EXEMPLO LTDA', numero: '000777', emissao: '2026-10-27', valor_nf: 509.6,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: null, lancamento_estado: null, lancamento_motivo: null,
  itens: [item('5910')], parcelas: [], associacoes_app: null, ...extra,
})
const comoPagar = (dentro: Pick<typeof screen, 'getByLabelText'> = screen) => dentro.getByLabelText('Como pagar') as HTMLSelectElement
const valores = (s: HTMLSelectElement) => within(s).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
const botaoLancar = () => screen.getByRole('button', { name: 'Lançar' })
const etiqueta = () => screen.getByTestId('nota-etiqueta')
const abrir = async (...notas: NotaSefazLista[]) => {
  m.notasALancar.mockResolvedValue(notas)
  render(<NotaSefaz />)
  return screen.findAllByTestId('nota-a-lancar')
}
const visibilidade = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.lancarNota.mockResolvedValue(undefined)
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
  m.memoriaDeEmbalagem.mockResolvedValue([])
})
afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — bonificação sem cobrança (CFOP 5910/6910 e o XML sem boletos): abre sozinha em "só estoque"', () => {
  it('"Como pagar" tem UMA só opção, "Só estoque (bonificação)", já marcada e sem poder trocar', async () => {
    await abrir(nota())
    const s = comoPagar()
    expect(s.value).toBe('cartao')
    expect(valores(s)).toEqual(['cartao'])
    expect(within(s).getByRole('option', { name: 'Só estoque (bonificação)' })).toBeInTheDocument()
    expect(s).toBeDisabled()
  })

  it('mostra a etiqueta calma com o CFOP (informação, não aviso amarelo) e a nota fica "Pronta" com o Lançar liberado', async () => {
    await abrir(nota())
    const info = screen.getByTestId('nota-bonificacao')
    expect(info).toHaveTextContent(TEXTO_BONIFICACAO)
    expect(info).not.toHaveClass('amarelo')
    expect(info).not.toHaveClass('erro')
    expect(etiqueta()).toHaveTextContent('Pronta')
    expect(etiqueta()).toHaveClass('etq-ok')
    expect(screen.getByTestId('nota-pronta')).toHaveTextContent('Pronta para lançar: todos os itens associados. Não há boleto para conferir.')
    expect(botaoLancar()).toBeEnabled()
  })

  it('não pede boleto nem parcelas e não mostra os avisos de "nota sem boleto" nem de "forma não testada"', async () => {
    const [li] = await abrir(nota())
    for (const id of ['editor-parcelas', 'aviso-financeiro', 'aviso-forma', 'pagamento-fixo', 'aviso-bonificacao-com-boleto', 'bloqueio-nota', 'padrao-fornecedor', 'status-nota']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
    expect(li).not.toHaveTextContent(/digite as parcelas|escolha como pagar|não foi testada|XML da nota não traz boletos|Boletos ainda não lidos/i)
    expect(screen.queryByLabelText(/Vencimento da parcela/)).not.toBeInTheDocument()
  })

  it('o painel "Conferir itens e financeiro" não manda digitar parcelas de boleto: diz que não há conta a pagar', async () => {
    await abrir(nota())
    const painel = within(screen.getByTestId('conferir'))
    expect(painel.getByTestId('fin-bonificacao')).toHaveTextContent('Nota de bonificação: não tem boleto nem conta a pagar. Entra só no estoque.')
    expect(painel.queryByTestId('fin-sem-boleto')).not.toBeInTheDocument()
    expect(painel.queryByTestId('fin-nao-lido')).not.toBeInTheDocument()
  })

  it('Lançar → a pergunta diz que é bonificação e que entra só no estoque; Confirmar manda "cartao" (sem parcelas) uma vez', async () => {
    await abrir(nota())
    await userEvent.click(botaoLancar())
    expect(screen.getByText('Vai lançar a NF 000777 de FORNECEDOR EXEMPLO LTDA — nota de bonificação: entra só no estoque, sem conta a pagar. Confirmar?')).toBeInTheDocument()
    expect(m.lancarNota).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledTimes(1)
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao')
  })

  it('o texto diz o CFOP da nota: 6910 quando é 6910, "5910/6910" quando há os dois', async () => {
    const [seis, osDois] = await abrir(
      nota({ chave: chaveN('6'), itens: [item('6910')] }),
      nota({ chave: chaveN('7'), itens: [item('5910'), item('6910', { n: 2, produto_id: 7002 })] }),
    )
    expect(within(seis).getByTestId('nota-bonificacao')).toHaveTextContent('(CFOP 6910)')
    expect(within(osDois).getByTestId('nota-bonificacao')).toHaveTextContent('(CFOP 5910/6910)')
    expect(comoPagar(within(seis)).value).toBe('cartao')
    expect(comoPagar(within(osDois)).value).toBe('cartao')
  })

  it('CFOP com espaço nas pontas também vale', async () => {
    await abrir(nota({ itens: [item(' 5910 ')] }))
    expect(comoPagar().value).toBe('cartao')
    expect(screen.getByTestId('nota-bonificacao')).toHaveTextContent('(CFOP 5910)')
  })

  it('com a forma "boleto" gravada de uma tentativa antiga, a tela mostra cartão e é cartão que vai ao robô', async () => {
    await abrir(nota({ forma_pagamento: 'boleto' }))
    expect(comoPagar().value).toBe('cartao')
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao')
  })

  it('o padrão do fornecedor no banco e a forma lembrada neste celular também não vencem', async () => {
    m.formasPadraoPorFornecedor.mockResolvedValue({ '12345678000190': 'dinheiro' })
    localStorage.setItem('spazio.notaSefaz.forma.FORNECEDOR EXEMPLO LTDA', 'tesouraria')
    await abrir(nota())
    await waitFor(() => expect(m.formasPadraoPorFornecedor).toHaveBeenCalled())
    expect(comoPagar().value).toBe('cartao')
    expect(screen.queryByTestId('padrao-fornecedor')).not.toBeInTheDocument()
  })

  it('devolvida pelo robô por "sem boletos" (a tentativa antiga foi em Boleto): já está em cartão e o texto diz que é só lançar', async () => {
    await abrir(nota({ forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: 'sem boletos na nota — pagamento manual' }))
    expect(comoPagar().value).toBe('cartao')
    const estado = screen.getByTestId('status-nota')
    expect(estado).toHaveTextContent('Precisa de você — nada foi lançado.')
    expect(estado).toHaveTextContent('como é uma nota de bonificação, a forma certa já está marcada (só estoque, sem conta a pagar). Toque em Lançar.')
    expect(estado).not.toHaveTextContent('escolha como pagar')
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao')
  })

  it.each([
    ['como o robô a escreve', MOTIVO_TRAVA_DO_ROBO],
    ['com o começo "parou antes de gerar o pedido"', `parou antes de gerar o pedido (nada lançado): ${MOTIVO_TRAVA_DO_ROBO}`],
  ])('devolvida pela trava nova do robô (a bonificação saiu em Boleto antes de a tela existir), %s: já está em cartão e o texto diz que é só lançar', async (_nome, motivo) => {
    await abrir(nota({ forma_pagamento: 'boleto', lancamento_estado: 'revisar', lancamento_motivo: motivo }))
    expect(comoPagar().value).toBe('cartao')
    const estado = screen.getByTestId('status-nota')
    expect(estado).toHaveTextContent('Precisa de você — nada foi lançado.')
    expect(estado).toHaveTextContent('a forma certa já está marcada (só estoque, sem conta a pagar). Toque em Lançar.')
    expect(estado).not.toHaveTextContent('escolha “só estoque”')
    expect(botaoLancar()).toBeEnabled()
  })

  it('devolvida pelo robô por OUTRO motivo: o texto do robô continua valendo e o Lançar segue em "só estoque"', async () => {
    await abrir(nota({ lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' }))
    expect(comoPagar().value).toBe('cartao')
    expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: total diferente')
    expect(etiqueta()).toHaveTextContent('Precisa de você')
  })

  it('o que mais a nota exige continua valendo: item sem produto trava o Lançar (a forma segue "só estoque")', async () => {
    await abrir(nota({ itens: [item('5910', { produto_id: null, associacao: null })] }))
    expect(botaoLancar()).toBeDisabled()
    expect(screen.getByTestId('bloqueio-nota')).toHaveTextContent('Item sem produto no SisChef')
    expect(etiqueta()).toHaveTextContent('Falta decidir')
    expect(comoPagar().value).toBe('cartao')
    expect(screen.getByTestId('nota-bonificacao')).toBeInTheDocument()
    expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
  })

  it('o que mais a nota exige continua valendo: "Com frete" ainda não confirmado trava o Lançar', async () => {
    await abrir(nota())
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(screen.getByTestId('com-frete'))
    expect(screen.getByTestId('frete-pendente')).toBeInTheDocument()
    expect(botaoLancar()).toBeDisabled()
  })

  it('o robô lançando ou a nota pela metade: nada de mudar (Lançar travado), e a forma segue "só estoque"', async () => {
    const [lancando, metade] = await abrir(
      nota({ chave: chaveN('1'), lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() }),
      nota({ chave: chaveN('2'), lancamento_estado: 'erro', lancamento_motivo: 'pedido gerado' }),
    )
    for (const li of [lancando, metade]) {
      expect(comoPagar(within(li)).value).toBe('cartao')
      expect(within(li).getByRole('button', { name: 'Lançar' })).toBeDisabled()
    }
    expect(within(lancando).getByTestId('nota-etiqueta')).toHaveTextContent('Lançando…')
    expect(within(metade).getByTestId('nota-etiqueta')).toHaveTextContent('Ficou pela metade')
  })

  it('uma bonificação e uma nota comum lado a lado: cada uma com o seu "Como pagar"', async () => {
    const [bonificacao, comum] = await abrir(
      nota({ chave: chaveN('1') }),
      nota({ chave: chaveN('2'), numero: '000778', itens: [item('5102')] }), // venda, XML lido sem boletos: o Ivan digita as parcelas
    )
    expect(valores(comoPagar(within(bonificacao)))).toEqual(['cartao'])
    expect(valores(comoPagar(within(comum)))).toEqual(TODAS_AS_FORMAS)
    expect(comoPagar(within(comum)).value).toBe('boleto')
    expect(within(comum).queryByTestId('nota-bonificacao')).not.toBeInTheDocument()
    expect(within(bonificacao).getByTestId('nota-etiqueta')).toHaveTextContent('Pronta')
    expect(within(comum).getByTestId('nota-etiqueta')).toHaveTextContent('Falta as parcelas')
  })
})

describe('NotaSefaz — bonificação que TRAZ boletos: não marca nada sozinha, avisa para conferir', () => {
  const comBoleto = (extra: Partial<NotaSefazLista> = {}) => nota({ parcelas: boleto, ...extra })

  it('mostra o aviso amarelo, deixa o "Como pagar" completo com Boleto marcado e NÃO fica "Pronta"', async () => {
    const [li] = await abrir(comBoleto())
    const aviso = screen.getByTestId('aviso-bonificacao-com-boleto')
    expect(aviso).toHaveTextContent(AVISO_COM_BOLETO)
    expect(aviso).toHaveClass('amarelo')
    expect(valores(comoPagar())).toEqual(TODAS_AS_FORMAS)
    expect(comoPagar().value).toBe('boleto')
    expect(comoPagar()).toBeEnabled()
    expect(screen.queryByTestId('nota-bonificacao')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nota-pronta')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pagamento-fixo')).not.toBeInTheDocument()
    expect(screen.queryByTestId('fin-bonificacao')).not.toBeInTheDocument()
    expect(li).not.toHaveTextContent('Só estoque (bonificação)')
    expect(etiqueta()).toHaveTextContent('Confira o financeiro')
    expect(etiqueta()).toHaveClass('etq-aviso')
  })

  it('o Lançar não é travado: a pergunta fala em pagamento (Boleto) e vai "boleto" ao robô', async () => {
    await abrir(comBoleto())
    expect(botaoLancar()).toBeEnabled()
    await userEvent.click(botaoLancar())
    expect(screen.getByText('Vai lançar a NF 000777 de FORNECEDOR EXEMPLO LTDA — pagamento: Boleto. Confirmar?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'boleto')
  })

  it('o Ivan ainda pode escolher "Cartão (só estoque)" à mão (sem aviso de forma não testada) e vai "cartao"', async () => {
    await abrir(comBoleto())
    await userEvent.selectOptions(comoPagar(), 'cartao')
    expect(screen.queryByTestId('aviso-forma')).not.toBeInTheDocument()
    await userEvent.click(botaoLancar())
    expect(screen.getByText('Vai lançar a NF 000777 de FORNECEDOR EXEMPLO LTDA — pagamento: Cartão (só estoque). Confirmar?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao')
  })

  it('a forma gravada na nota continua valendo (nada de automático)', async () => {
    await abrir(comBoleto({ forma_pagamento: 'tesouraria' }))
    expect(comoPagar().value).toBe('tesouraria')
    expect(screen.getByTestId('aviso-bonificacao-com-boleto')).toBeInTheDocument()
  })

  it('o aviso só aparece enquanto dá para lançar: com o robô lançando ou a nota pela metade ele some', async () => {
    const [lancando, metade] = await abrir(
      comBoleto({ chave: chaveN('1'), lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() }),
      comBoleto({ chave: chaveN('2'), lancamento_estado: 'erro', lancamento_motivo: 'pedido gerado' }),
    )
    expect(within(lancando).queryByTestId('aviso-bonificacao-com-boleto')).not.toBeInTheDocument()
    expect(within(metade).queryByTestId('aviso-bonificacao-com-boleto')).not.toBeInTheDocument()
    expect(within(lancando).getByTestId('nota-etiqueta')).toHaveTextContent('Lançando…')
    expect(within(metade).getByTestId('nota-etiqueta')).toHaveTextContent('Ficou pela metade')
  })

  it('devolvida pelo robô por outro motivo: o aviso continua lá, junto do "Precisa de você"', async () => {
    await abrir(comBoleto({ lancamento_estado: 'revisar', lancamento_motivo: 'total diferente' }))
    expect(screen.getByTestId('aviso-bonificacao-com-boleto')).toBeInTheDocument()
    expect(etiqueta()).toHaveTextContent('Precisa de você')
  })

  it('devolvida pela trava do robô, mas a nota traz boletos: o texto do robô fica como ele escreveu (a tela não decide nada nessa nota)', async () => {
    await abrir(comBoleto({ lancamento_estado: 'revisar', lancamento_motivo: MOTIVO_TRAVA_DO_ROBO }))
    expect(screen.getByTestId('status-nota')).toHaveTextContent('Precisa de você: nota de bonificação (CFOP 5910/6910): é um brinde do fornecedor')
    expect(screen.getByTestId('status-nota')).not.toHaveTextContent('Toque em Lançar')
    expect(comoPagar().value).toBe('boleto')
  })
})

describe('NotaSefaz — bonificação com o XML ainda por ler (boletos nulos): segue como nota comum', () => {
  it('Boleto marcado, todas as opções, o editor de parcelas aberto, sem etiqueta e sem aviso', async () => {
    const [li] = await abrir(nota({ parcelas: null }))
    expect(comoPagar().value).toBe('boleto')
    expect(valores(comoPagar())).toEqual(TODAS_AS_FORMAS)
    expect(comoPagar()).toBeEnabled()
    expect(screen.getByTestId('editor-parcelas')).toBeInTheDocument()
    expect(screen.queryByTestId('nota-bonificacao')).not.toBeInTheDocument()
    expect(screen.queryByTestId('aviso-bonificacao-com-boleto')).not.toBeInTheDocument()
    expect(li).not.toHaveTextContent('bonificação')
    expect(etiqueta()).toHaveTextContent('Falta as parcelas')
    expect(botaoLancar()).toBeDisabled()
  })
})

describe('NotaSefaz — nota que NÃO é de bonificação continua exatamente como hoje', () => {
  it.each([
    ['mista: um item 5910 e um de venda (5102)', [item('5910'), item('5102', { n: 2, produto_id: 7002 })]],
    ['só venda (5102)', [item('5102')]],
    ['sem a chave cfop (o robô ainda não re-etiquetou)', [item()]],
    ['um item com cfop e outro sem', [item('5910'), item(undefined, { n: 2, produto_id: 7002 })]],
    ['cfop nulo', [item(null)]],
    ['amostra grátis (5911), que ficou de fora', [item('5911')]],
  ])('%s, sem boletos no XML: Boleto marcado, todas as opções, editor de parcelas, sem etiqueta de bonificação', async (_nome, itens) => {
    await abrir(nota({ itens }))
    expect(comoPagar().value).toBe('boleto')
    expect(valores(comoPagar())).toEqual(TODAS_AS_FORMAS)
    expect(comoPagar()).toBeEnabled()
    expect(screen.getByTestId('editor-parcelas')).toBeInTheDocument()
    expect(screen.queryByTestId('nota-bonificacao')).not.toBeInTheDocument()
    expect(screen.queryByTestId('aviso-bonificacao-com-boleto')).not.toBeInTheDocument()
    expect(etiqueta()).toHaveTextContent('Falta as parcelas')
    expect(botaoLancar()).toBeDisabled()
  })

  it('nota comum com boletos que fecham segue "Pronta", sem o aviso da bonificação', async () => {
    await abrir(nota({ itens: [item('5102')], parcelas: boleto }))
    expect(screen.getByTestId('nota-pronta')).toHaveTextContent('Pronta para lançar: todos os itens associados e 1 boleto fecha com o valor da nota.')
    expect(screen.getByTestId('pagamento-fixo')).toHaveTextContent('Pagamento: Boleto (1 parcela)')
    expect(screen.queryByTestId('aviso-bonificacao-com-boleto')).not.toBeInTheDocument()
    expect(etiqueta()).toHaveTextContent('Pronta')
  })

  it('"Cartão (só estoque)" escolhido à mão numa nota comum já não leva o aviso de forma não testada; Dinheiro ainda leva', async () => {
    await abrir(nota({ itens: [item('5102')], parcelas: boleto }))
    await userEvent.click(screen.getByRole('button', { name: 'mudar forma de pagamento' }))
    await userEvent.selectOptions(comoPagar(), 'cartao')
    expect(screen.queryByTestId('aviso-forma')).not.toBeInTheDocument()
    await userEvent.selectOptions(comoPagar(), 'dinheiro')
    expect(screen.getByTestId('aviso-forma')).toHaveTextContent('ainda não foi testada ao vivo')
  })
})

describe('NotaSefaz — a nota muda de classe com a tela aberta (o robô etiquetou ou leu os boletos depois)', () => {
  /** Dispara a releitura que a tela faz ao voltar para o app (mais de 15 s depois da última). */
  const reler = async (vezes: number) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    visibilidade('hidden')
    visibilidade('visible')
    await waitFor(() => expect(m.notasALancar).toHaveBeenCalledTimes(vezes))
  }

  it('o Ivan tinha escolhido Dinheiro numa nota que ainda não era bonificação; o robô a etiqueta: a tela passa a "só estoque" e o Lançar manda cartão', async () => {
    await abrir(nota({ itens: [item()] }))
    await userEvent.selectOptions(comoPagar(), 'dinheiro')
    expect(comoPagar().value).toBe('dinheiro')
    m.notasALancar.mockResolvedValue([nota({ itens: [item('5910')] })]) // a releitura traz o CFOP etiquetado
    await reler(2)
    await waitFor(() => expect(valores(comoPagar())).toEqual(['cartao']))
    expect(comoPagar().value).toBe('cartao')
    expect(screen.getByTestId('nota-bonificacao')).toBeInTheDocument()
    await userEvent.click(botaoLancar())
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE, 'cartao')
  })

  it('o contrário: a bonificação "só estoque" passa a trazer boletos na releitura — volta tudo ao normal e o aviso aparece', async () => {
    await abrir(nota())
    expect(valores(comoPagar())).toEqual(['cartao'])
    m.notasALancar.mockResolvedValue([nota({ parcelas: boleto })])
    await reler(2)
    await waitFor(() => expect(valores(comoPagar())).toEqual(TODAS_AS_FORMAS))
    expect(comoPagar().value).toBe('boleto')
    expect(comoPagar()).toBeEnabled()
    expect(screen.getByTestId('aviso-bonificacao-com-boleto')).toBeInTheDocument()
    expect(screen.queryByTestId('nota-bonificacao')).not.toBeInTheDocument()
  })
})
