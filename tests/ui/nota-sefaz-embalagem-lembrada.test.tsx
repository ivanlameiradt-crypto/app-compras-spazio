// Memória de embalagem das notas fiscais, a TELA (fase 2, pedido do Ivan de 29/10/2026): o robô aprende sozinho, depois de uma nota lançada, quantas unidades do produto vêm em 1 unidade da nota
// ("6 UN" na nota = 6 fardos de 6 latas) e aplica sozinho na nota seguinte. A aba "Lançamento fiscal" mostra o que ele lembra no item da nota, deixa o Ivan corrigir ou esquecer, e oferece
// "Usar o lembrado" no item que ainda está sem produto. Tudo INVENTADO (repositório público).
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NfeAprendizado, NotaSefazLista, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '3'.repeat(44)
const CNPJ = '12345678000190'
const FANTA = 2722189
const COCA = 1836982
const ROTULO_UN = 'Quanto vale 1 unidade da nota em UN?'
const MOTIVO_UN_DIFERE = 'parou antes de gerar o pedido (nada lançado): UN DIFERE sem conversão na tela: CÓD. FOR 17253 (no app, informe a conversão desse item e lance de novo, ou registre no SisChef)'
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: COCA, nome: 'COCA COLA 350 ML', unidade: 'un' },
  { produto_id: FANTA, nome: 'FANTA LARANJA 350 ML', unidade: 'un' },
]
const FRASE = 'O robô lembra: 1 UN da nota = 12 UN no estoque (visto em 2 notas, a última em 28/10). Ao lançar ele aplica sozinho: entram 120 UN.'

/** A linha que o robô lembra: o código 17253 deste fornecedor, em UN, é a Fanta 350 em fardo de 12. */
const linha = (over: Partial<NfeAprendizado> = {}): NfeAprendizado => ({
  emitente_cnpj: CNPJ, cod_forn: '17253', unidade_nota: 'UN', produto_id: FANTA, produto_nome: 'FANTA LARANJA 350 ML', fator: 12, preco_ref: 30,
  descricao_exemplo: 'REFRIG FANTA LAR LT 350ML C/12', vezes: 2, ultima_chave: null, atualizado_em: '2026-10-28T20:15:00+00:00', ...over,
})
/** Uma nota com UM item já associado no SisChef (a Fanta, 10 UN = 10 fardos de 12). */
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: CNPJ, emitente: 'DISTRIBUIDORA TESTE LTDA', numero: '000090052', emissao: '2026-10-28', valor_nf: 1000,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, forma_pagamento: 'boleto', parcelas: [{ numero: '001', vencimento: '2026-11-20', valor: 1000 }],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 17253 REFRIG FANTA LAR LT 350ML C/12', qtd: 10, unidade_sischef: 'UN', produto_id: String(FANTA), produto_nome: 'FANTA LARANJA 350 ML', associacao: 'sischef' }],
  associacoes_app: null, lancamento_estado: null, lancamento_motivo: null,
  ...extra,
} as unknown as NotaSefazLista)
/** Uma nota com UM item ainda SEM produto: o fardo "SIX PACK" da Coca (a nota NF 90049 do Mateus, 28/10). */
const notaSemProduto = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => nota({
  itens: [{ n: 1, descricao: 'CÓD. FOR: 420713 REFRIG COCA COLA LT SIX PACK 350ML', qtd: 6, unidade_sischef: 'UN', produto_id: null }] as unknown as NotaSefazLista['itens'],
  ...extra,
})
const sixPack = (over: Partial<NfeAprendizado> = {}): NfeAprendizado => linha({ cod_forn: '420713', produto_id: COCA, produto_nome: 'COCA COLA 350 ML', fator: 6, ...over })
const decisaoDaCoca = (conversao: number | null) => ({ '1': { produto_id: COCA, produto_nome: 'COCA COLA 350 ML', unidade: 'un', conversao, origem: 'lista', por: 'ivan@spazio.invalid', em: '2026-10-29T12:00:00Z' } })

/** O item da nota (o <li> do painel Conferir) pelo trecho da descrição. */
const itemDe = async (trecho: string) => {
  const itens = within(await screen.findByTestId('conferir')).getAllByTestId('conferir-item')
  const li = itens.find((x) => x.textContent?.includes(trecho))
  if (!li) throw new Error(`item ${trecho} não achado entre ${itens.length} itens`)
  return within(li)
}
const fanta = () => itemDe('REFRIG FANTA LAR')
const coca = () => itemDe('COCA COLA LT SIX PACK')
/** Espera a leitura da memória terminar (de verdade, para os testes de "não aparece nada" não passarem antes de ela chegar). */
const memoriaLida = async () => {
  await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalled())
  await act(async () => { await Promise.allSettled(m.memoriaDeEmbalagem.mock.results.map((r) => r.value)) })
}
const visibilidade = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.memoriaDeEmbalagem.mockResolvedValue([])
  m.associarItem.mockResolvedValue(undefined)
})
afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — item que JÁ vem associado: o que o robô lembra', () => {
  it('mostra a frase com a conta e os botões Corrigir e Esquecer; a memória é lida uma vez ao abrir', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const caixa = within(await (await fanta()).findByTestId('embalagem-lembrada'))
    expect(screen.getByTestId('embalagem-lembrada')).toHaveTextContent(FRASE)
    expect(caixa.getByRole('button', { name: 'Corrigir' })).toBeEnabled()
    expect(caixa.getByRole('button', { name: 'Esquecer' })).toBeEnabled()
    expect(screen.getByRole('group', { name: 'O que o robô lembra deste item' })).toBe(screen.getByTestId('embalagem-lembrada'))
    expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(1)
  })

  it('uma nota só: "visto em 1 nota, em 28/10"; sem a quantidade da leitura não há conta, mas a frase continua', async () => {
    m.notasALancar.mockResolvedValue([nota({ itens: [{ n: 1, descricao: 'CÓD. FOR: 17253 REFRIG FANTA', qtd: null, unidade_sischef: 'UN', produto_id: String(FANTA), produto_nome: 'FANTA', associacao: 'sischef' }] as unknown as NotaSefazLista['itens'] })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha({ vezes: 1 })])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('embalagem-lembrada')).toHaveTextContent('O robô lembra: 1 UN da nota = 12 UN no estoque (visto em 1 nota, em 28/10). Ao lançar ele aplica sozinho.')
  })

  it('o CNPJ da nota com pontuação também acha a linha (só os dígitos contam)', async () => {
    m.notasALancar.mockResolvedValue([nota({ cnpj_emitente: '12.345.678/0001-90' })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('embalagem-lembrada')).toBeInTheDocument()
  })

  it.each([
    ['outro código', { cod_forn: '17254' }],
    ['outra unidade', { unidade_nota: 'CX' }],
    ['outro fornecedor', { emitente_cnpj: '99887766000155' }],
  ])('a linha de %s NÃO aparece neste item', async (_nome, outra) => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha(outra as Partial<NfeAprendizado>)])
    render(<NotaSefaz />)
    await fanta()
    await memoriaLida()
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByTestId('embalagem-lembrada-outro-produto')).not.toBeInTheDocument()
  })

  it.each([[null], [undefined], ['']])('nota sem CNPJ (%j): não mostra nada, nem com a linha certa na memória', async (cnpj) => {
    m.notasALancar.mockResolvedValue([nota({ cnpj_emitente: cnpj as string | null | undefined })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    await fanta()
    await memoriaLida()
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByTestId('embalagem-lembrada-outro-produto')).not.toBeInTheDocument()
    expect(screen.queryByTestId('embalagem-lembrada-vale-o-seu')).not.toBeInTheDocument()
  })

  it('sem nada lembrado a tela é a de sempre: só o Editar', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    render(<NotaSefaz />)
    const item = await fanta()
    await memoriaLida()
    expect(item.getByRole('button', { name: 'Editar' })).toBeEnabled()
    expect(item.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument()
    expect(item.queryByRole('button', { name: 'Esquecer' })).not.toBeInTheDocument()
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — o número que o Ivan informa nesta nota vence a memória', () => {
  it('já informou um número DIFERENTE do lembrado: a caixa some e fica só a linha pequena', async () => {
    m.notasALancar.mockResolvedValue([nota({ associacoes_app: { '1': { produto_id: FANTA, produto_nome: 'FANTA', unidade: null, conversao: 6, origem: 'sischef', por: 'ivan', em: '2026-10-29T12:00:00Z' } } })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('embalagem-lembrada-vale-o-seu')).toHaveTextContent('Nesta nota vale o número que você informou.')
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.getByTestId('conversao-item-informada')).toHaveTextContent('1 unidade da nota = 6 UN')
  })

  it('informou exatamente o número lembrado: nem a caixa nem a linha pequena (a linha "Conversão informada" já diz tudo)', async () => {
    m.notasALancar.mockResolvedValue([nota({ associacoes_app: { '1': { produto_id: FANTA, produto_nome: 'FANTA', unidade: null, conversao: 12, origem: 'sischef', por: 'ivan', em: '2026-10-29T12:00:00Z' } } })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    await screen.findByTestId('conversao-item-informada')
    await memoriaLida()
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByTestId('embalagem-lembrada-vale-o-seu')).not.toBeInTheDocument()
  })

  it('informar um número agora (Editar → 6 → Confirmar): a caixa dá lugar à linha pequena, e a memória é lida de novo', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.converterItem.mockImplementation(async () => {
      m.notasALancar.mockResolvedValue([nota({ associacoes_app: { '1': { produto_id: FANTA, produto_nome: 'FANTA', unidade: null, conversao: 6, origem: 'sischef', por: 'ivan', em: '2026-10-29T12:00:00Z' } } })])
    })
    render(<NotaSefaz />)
    const item = await fanta()
    await item.findByTestId('embalagem-lembrada')
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()            // com a caixa de editar aberta, a da memória sai do caminho
    await userEvent.type(item.getByLabelText(ROTULO_UN), '6')
    await userEvent.click(item.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 1, 6))
    expect(await item.findByTestId('embalagem-lembrada-vale-o-seu')).toBeInTheDocument()
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(2))            // ao abrir + depois de corrigir
  })

  it('"Desfazer a conversão" devolve a caixa do que o robô lembra', async () => {
    m.notasALancar.mockResolvedValue([nota({ associacoes_app: { '1': { produto_id: FANTA, produto_nome: 'FANTA', unidade: null, conversao: 6, origem: 'sischef', por: 'ivan', em: '2026-10-29T12:00:00Z' } } })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.converterItem.mockResolvedValue(undefined)
    render(<NotaSefaz />)
    const item = await fanta()
    await item.findByTestId('embalagem-lembrada-vale-o-seu')
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    await userEvent.click(item.getByRole('button', { name: 'Desfazer a conversão' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenLastCalledWith(CHAVE, 1, null))
    expect(await item.findByTestId('embalagem-lembrada')).toHaveTextContent(FRASE)
    expect(item.queryByTestId('embalagem-lembrada-vale-o-seu')).not.toBeInTheDocument()
  })

  it('o robô parou pedindo a conversão (UN DIFERE) e ninguém informou: a caixa pede o número e não mostra a memória', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'revisar', lancamento_motivo: MOTIVO_UN_DIFERE })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('conversao-item-pendente')).toBeInTheDocument()
    await memoriaLida()
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — Corrigir abre o Editar já com o número lembrado', () => {
  it('Corrigir abre a caixa de editar com 12 no campo e a conta; Cancelar volta para a caixa do que o robô lembra', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Corrigir' }))
    const editar = within(await item.findByTestId('editar-item-caixa'))
    expect(editar.getByLabelText(ROTULO_UN)).toHaveValue('12')
    expect(editar.getByLabelText(ROTULO_UN)).toHaveFocus()
    expect(editar.getByTestId('conversao-item-previa')).toHaveTextContent('10 × 12 = 120 UN')
    expect(m.converterItem).not.toHaveBeenCalled()                                       // abrir não grava nada
    await userEvent.click(editar.getByRole('button', { name: 'Cancelar' }))
    expect(item.queryByTestId('editar-item-caixa')).not.toBeInTheDocument()
    expect(item.getByTestId('embalagem-lembrada')).toHaveTextContent(FRASE)
    expect(m.converterItem).not.toHaveBeenCalled()
  })

  it('corrigir para 6 e confirmar grava 6 nesta nota', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.converterItem.mockResolvedValue(undefined)
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Corrigir' }))
    const campo = item.getByLabelText(ROTULO_UN)
    await userEvent.clear(campo)
    await userEvent.type(campo, '6')
    await userEvent.click(item.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 1, 6))
  })

  it('com o robô lançando a nota, Corrigir e Esquecer ficam apagados (como o Editar)', async () => {
    m.notasALancar.mockResolvedValue([nota({ lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const item = await fanta()
    await item.findByTestId('embalagem-lembrada')
    expect(item.getByRole('button', { name: 'Corrigir' })).toBeDisabled()
    expect(item.getByRole('button', { name: 'Esquecer' })).toBeDisabled()
    expect(item.getByRole('button', { name: 'Editar' })).toBeDisabled()
  })
})

describe('NotaSefaz — Esquecer pede confirmação no próprio lugar', () => {
  const PERGUNTA = 'Esquecer este número? O robô volta a não multiplicar este código.'

  it('Esquecer só pergunta (sem confirm() nem alert() do navegador) e não apaga nada', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const avisar = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Esquecer' }))
    const pergunta = await item.findByTestId('embalagem-esquecer-confirmar')
    expect(pergunta).toHaveTextContent(PERGUNTA)
    expect(within(pergunta).getByRole('button', { name: 'Sim, esquecer' })).toBeEnabled()
    expect(within(pergunta).getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(item.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument()      // enquanto pergunta, só as duas respostas
    expect(m.esquecerEmbalagem).not.toHaveBeenCalled()
    expect(confirmar).not.toHaveBeenCalled()
    expect(avisar).not.toHaveBeenCalled()
  })

  it('Cancelar fecha a pergunta, volta Corrigir e Esquecer e não apaga nada', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await item.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Cancelar' }))
    expect(item.queryByTestId('embalagem-esquecer-confirmar')).not.toBeInTheDocument()
    expect(item.getByTestId('embalagem-lembrada')).toHaveTextContent(FRASE)
    expect(item.getByRole('button', { name: 'Corrigir' })).toBeEnabled()
    expect(item.getByRole('button', { name: 'Esquecer' })).toBeEnabled()
    expect(m.esquecerEmbalagem).not.toHaveBeenCalled()
  })

  it('"Sim, esquecer" apaga a linha do fornecedor + código + unidade, a caixa some e a memória é lida de novo', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.esquecerEmbalagem.mockImplementation(async () => { m.memoriaDeEmbalagem.mockResolvedValue([]); return 1 })
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await item.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    await waitFor(() => expect(m.esquecerEmbalagem).toHaveBeenCalledWith(CNPJ, '17253', 'UN'))
    expect(m.esquecerEmbalagem).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument())
    expect(await item.findByTestId('embalagem-esquecida')).toHaveTextContent('Pronto: o robô esqueceu este número.')
    await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(2))             // ao abrir + depois de esquecer
    expect(item.getByRole('button', { name: 'Editar' })).toBeEnabled()                      // o item segue como um item comum
  })

  it('a linha some da tela mesmo que a releitura da memória falhe depois de esquecer', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.esquecerEmbalagem.mockImplementation(async () => { m.memoriaDeEmbalagem.mockRejectedValue(new Error('rede')); return 1 })
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await item.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    await waitFor(() => expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument())
    await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(2))
    await memoriaLida()
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('erro ao esquecer: a mensagem aparece na caixa, a linha continua lá e dá para tentar de novo', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    m.esquecerEmbalagem.mockRejectedValueOnce(new Error('Não consegui esquecer agora. Confira a internet e tente de novo.'))
      .mockImplementationOnce(async () => { m.memoriaDeEmbalagem.mockResolvedValue([]); return 1 })
    render(<NotaSefaz />)
    const item = await fanta()
    await userEvent.click(await item.findByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await item.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    expect(await item.findByRole('alert')).toHaveTextContent('Não consegui esquecer agora. Confira a internet e tente de novo.')
    expect(item.getByTestId('embalagem-lembrada')).toBeInTheDocument()
    expect(item.queryByTestId('embalagem-esquecida')).not.toBeInTheDocument()
    await userEvent.click(within(item.getByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    await waitFor(() => expect(m.esquecerEmbalagem).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument())
  })

  it('esquecer uma linha tira só ela da tela: o outro código e o mesmo código em outra unidade continuam (a releitura falha, então só a retirada local conta)', async () => {
    m.notasALancar.mockResolvedValue([nota({ itens: [
      { n: 1, descricao: 'CÓD. FOR: 17253 REFRIG FANTA LAR LT 350ML C/12', qtd: 10, unidade_sischef: 'UN', produto_id: String(FANTA), produto_nome: 'FANTA', associacao: 'sischef' },
      { n: 2, descricao: 'CÓD. FOR: 17254 REFRIG GUARANA LT 350ML C/12', qtd: 4, unidade_sischef: 'UN', produto_id: '555', produto_nome: 'GUARANA', associacao: 'sischef' },
      { n: 3, descricao: 'CÓD. FOR: 17253 REFRIG FANTA LAR CAIXA 24', qtd: 2, unidade_sischef: 'CX', produto_id: String(FANTA), produto_nome: 'FANTA', associacao: 'sischef' },
    ] as unknown as NotaSefazLista['itens'] })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha(), linha({ cod_forn: '17254', produto_id: 555, produto_nome: 'GUARANA', fator: 24 }), linha({ unidade_nota: 'CX', fator: 24 })])
    m.esquecerEmbalagem.mockImplementation(async () => { m.memoriaDeEmbalagem.mockRejectedValue(new Error('rede')); return 1 })
    render(<NotaSefaz />)
    const guarana = await itemDe('REFRIG GUARANA')
    const caixa = await itemDe('FANTA LAR CAIXA')
    await guarana.findByTestId('embalagem-lembrada')
    await caixa.findByTestId('embalagem-lembrada')
    const primeiro = await fanta()
    await userEvent.click(await primeiro.findByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await primeiro.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    await waitFor(() => expect(m.esquecerEmbalagem).toHaveBeenCalledWith(CNPJ, '17253', 'UN'))
    await waitFor(() => expect(primeiro.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument())
    await memoriaLida()
    expect(guarana.getByTestId('embalagem-lembrada')).toHaveTextContent('1 UN da nota = 24 UN no estoque')   // a do outro código continua
    expect(caixa.getByTestId('embalagem-lembrada')).toHaveTextContent('1 CX da nota = 24 CX no estoque')     // a do mesmo código em outra unidade continua
  })
})

describe('NotaSefaz — memória de OUTRO produto: aviso amarelo, sem botão de usar', () => {
  it('o item está ligado à Coca e o robô lembra o código como Fanta: o aviso diz que o robô vai parar e pedir para conferir', async () => {
    m.notasALancar.mockResolvedValue([nota({ itens: [
      { n: 1, descricao: 'CÓD. FOR: 17253 REFRIG FANTA LAR LT 350ML C/12', qtd: 10, unidade_sischef: 'UN', produto_id: String(COCA), produto_nome: 'COCA COLA 350 ML', associacao: 'sischef' },
    ] as unknown as NotaSefazLista['itens'] })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const aviso = await screen.findByTestId('embalagem-lembrada-outro-produto')
    expect(aviso).toHaveTextContent('Eu lembrava este código como FANTA LARANJA 350 ML (1 UN = 12). Este item está ligado a outro produto: o robô vai parar e pedir para você conferir.')
    expect(aviso).toHaveClass('amarelo')
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Corrigir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Esquecer' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /usar/i })).not.toBeInTheDocument()
  })

  it('o aviso fala do número lembrado, não de um que o Ivan informou: com um número informado nesta nota vale só a linha pequena', async () => {
    m.notasALancar.mockResolvedValue([nota({
      itens: [{ n: 1, descricao: 'CÓD. FOR: 17253 REFRIG FANTA LAR LT 350ML C/12', qtd: 10, unidade_sischef: 'UN', produto_id: String(COCA), produto_nome: 'COCA COLA 350 ML', associacao: 'sischef' }] as unknown as NotaSefazLista['itens'],
      associacoes_app: { '1': { produto_id: COCA, produto_nome: 'COCA', unidade: null, conversao: 6, origem: 'sischef', por: 'ivan', em: '2026-10-29T12:00:00Z' } },
    })])
    m.memoriaDeEmbalagem.mockResolvedValue([linha()])
    render(<NotaSefaz />)
    expect(await screen.findByTestId('embalagem-lembrada-vale-o-seu')).toBeInTheDocument()
    expect(screen.queryByTestId('embalagem-lembrada-outro-produto')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — a leitura da memória é só um complemento', () => {
  it('leitura falhando: a tela segue como hoje, sem memória e sem erro na frente do Ivan', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockRejectedValue(new Error('permission denied for table nfe_aprendizado'))
    render(<NotaSefaz />)
    const item = await fanta()
    await memoriaLida()
    expect(item.getByRole('button', { name: 'Editar' })).toBeEnabled()
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/nfe_aprendizado|permission denied/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()                    // e o resto da nota funciona
  })

  it('resposta que não é lista (indefinida, nula): ignorada, sem quebrar', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockResolvedValue(undefined as unknown as NfeAprendizado[])
    render(<NotaSefaz />)
    await fanta()
    await memoriaLida()
    expect(screen.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a primeira leitura falhou e a próxima funciona: ao voltar para o app a memória aparece', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    m.memoriaDeEmbalagem.mockRejectedValueOnce(new Error('rede')).mockResolvedValue([linha()])
    render(<NotaSefaz />)
    const item = await fanta()
    await memoriaLida()
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    visibilidade('hidden')
    visibilidade('visible')
    expect(await item.findByTestId('embalagem-lembrada')).toHaveTextContent(FRASE)
    expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(2)
  })

  it('uma resposta atrasada de antes não traz de volta o que o Ivan acabou de esquecer', async () => {
    m.notasALancar.mockResolvedValue([nota()])
    let atrasada: (l: NfeAprendizado[]) => void = () => undefined
    m.memoriaDeEmbalagem.mockResolvedValueOnce([linha()])                                    // abertura
    render(<NotaSefaz />)
    const item = await fanta()
    await item.findByTestId('embalagem-lembrada')
    m.memoriaDeEmbalagem.mockReturnValueOnce(new Promise<NfeAprendizado[]>((r) => { atrasada = r }))   // releitura ao voltar para o app: demora
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    visibilidade('hidden')
    visibilidade('visible')
    await waitFor(() => expect(m.memoriaDeEmbalagem).toHaveBeenCalledTimes(2))
    m.esquecerEmbalagem.mockResolvedValue(1)
    m.memoriaDeEmbalagem.mockResolvedValue([])                                               // a leitura depois de esquecer
    await userEvent.click(item.getByRole('button', { name: 'Esquecer' }))
    await userEvent.click(within(await item.findByTestId('embalagem-esquecer-confirmar')).getByRole('button', { name: 'Sim, esquecer' }))
    await waitFor(() => expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument())
    await act(async () => { atrasada([linha()]) })                                           // chega tarde, com a linha que já foi esquecida
    await new Promise((r) => setTimeout(r, 30))
    expect(item.queryByTestId('embalagem-lembrada')).not.toBeInTheDocument()
  })
})

describe('NotaSefaz — item SEM produto: "Usar o lembrado"', () => {
  it('mostra o produto lembrado e o número, com o botão Usar o lembrado', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    render(<NotaSefaz />)
    const caixa = await (await coca()).findByTestId('produto-lembrado')
    expect(caixa).toHaveTextContent('Da última vez este código foi COCA COLA 350 ML (1 UN = 6).')
    expect(within(caixa).getByRole('button', { name: 'Usar o lembrado' })).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Produto que o robô lembra para este código' })).toBe(caixa)
  })

  it('Usar o lembrado grava o produto E a conversão lembrados (como se o Ivan os tivesse confirmado à mão) e o item passa a confirmado', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([notaSemProduto({ associacoes_app: decisaoDaCoca(6) as never })]) })
    render(<NotaSefaz />)
    const item = await coca()
    await userEvent.click(await item.findByRole('button', { name: 'Usar o lembrado' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, COCA, 6))
    expect(m.associarItem).toHaveBeenCalledTimes(1)
    // confirmado, o item sai da lista do que falta e vai para a dos confirmados: o <li> é outro, então a busca é refeita
    await waitFor(async () => expect(within(await screen.findByTestId('conferir-confirmados')).getByTestId('associacao-confirmada')).toHaveTextContent('1 UN = 6'))
    expect(screen.queryByTestId('produto-lembrado')).not.toBeInTheDocument()                // já tem decisão: a oferta sai
    expect(m.lembrarDescricao).not.toHaveBeenCalled()                                        // "Usar o lembrado" não mexe nas palavras-chave
  })

  it('resolve o aviso do fardo ("SIX PACK" pede o número): com o lembrado o Lançar libera', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    m.associarItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([notaSemProduto({ associacoes_app: decisaoDaCoca(6) as never })]) })
    render(<NotaSefaz />)
    expect(await screen.findByTestId('lancar-travado')).toHaveTextContent('falta produto no SisChef em algum item')
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
    await userEvent.click(await (await coca()).findByRole('button', { name: 'Usar o lembrado' }))
    await waitFor(() => expect(screen.queryByTestId('lancar-travado')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeEnabled()
    expect(screen.getByTestId('lancar-associa')).toHaveTextContent('COCA COLA 350 ML')
  })

  it('já existe decisão do Ivan para o item: a oferta fica fora (mesmo decisão antiga, sem o número)', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto({ associacoes_app: decisaoDaCoca(null) as never })])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    render(<NotaSefaz />)
    await coca()
    await memoriaLida()
    expect(screen.queryByTestId('produto-lembrado')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Usar o lembrado' })).not.toBeInTheDocument()
  })

  it('outro código, outra unidade, outro fornecedor ou nota sem CNPJ: nenhuma oferta', async () => {
    for (const [nome, memoria, cnpj] of [
      ['outro código', sixPack({ cod_forn: '420714' }), CNPJ],
      ['outra unidade', sixPack({ unidade_nota: 'CX' }), CNPJ],
      ['outro fornecedor', sixPack({ emitente_cnpj: '99887766000155' }), CNPJ],
      ['nota sem CNPJ', sixPack(), null],
    ] as const) {
      vi.clearAllMocks()
      m.notasALancar.mockResolvedValue([notaSemProduto({ cnpj_emitente: cnpj })])
      m.memoriaDeEmbalagem.mockResolvedValue([memoria])
      const { unmount } = render(<NotaSefaz />)
      await coca()
      await memoriaLida()
      expect([nome, screen.queryByTestId('produto-lembrado')]).toEqual([nome, null])
      unmount()
    }
  })

  it('o nome vem da lista do app quando ela já carregou (o corrigido pelo Ivan), senão o que o robô guardou', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.catalogoProdutos.mockResolvedValue([{ produto_id: COCA, nome: 'COCA-COLA LATA 350 ML', unidade: 'un', nome_sischef: 'COCA COLA 350 ML' }])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack({ produto_nome: 'NOME ANTIGO' })])
    render(<NotaSefaz />)
    const item = await coca()
    await waitFor(() => expect(item.getByTestId('produto-lembrado')).toHaveTextContent('Da última vez este código foi COCA-COLA LATA 350 ML (1 UN = 6).'))
  })

  it('o banco recusa: a mensagem aparece na caixa e nada é dado como gravado', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    m.associarItem.mockRejectedValue(new Error('O robô está lançando esta nota agora: aguarde terminar.'))
    render(<NotaSefaz />)
    const item = await coca()
    await userEvent.click(await item.findByRole('button', { name: 'Usar o lembrado' }))
    expect(await item.findByRole('alert')).toHaveTextContent('aguarde terminar')
    expect(item.getByTestId('produto-lembrado')).toBeInTheDocument()
    expect(item.queryByTestId('associacao-confirmada')).not.toBeInTheDocument()
  })

  it('o produto lembrado não precisa estar na lista carregada: a oferta aparece e grava o código lembrado', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto()])
    m.catalogoProdutos.mockResolvedValue([])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack({ produto_id: 4242, produto_nome: 'PRODUTO FORA DA LISTA' })])
    render(<NotaSefaz />)
    const item = await coca()
    expect(await item.findByTestId('produto-lembrado')).toHaveTextContent('Da última vez este código foi PRODUTO FORA DA LISTA (1 UN = 6).')
    await userEvent.click(item.getByRole('button', { name: 'Usar o lembrado' }))
    await waitFor(() => expect(m.associarItem).toHaveBeenCalledWith(CHAVE, 1, 4242, 6))
  })

  it('com o robô lançando a nota a caixa de associação nem aparece (e a oferta junto)', async () => {
    m.notasALancar.mockResolvedValue([notaSemProduto({ lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() })])
    m.memoriaDeEmbalagem.mockResolvedValue([sixPack()])
    render(<NotaSefaz />)
    await screen.findByTestId('conferir')
    await memoriaLida()
    expect(screen.queryByTestId('produto-lembrado')).not.toBeInTheDocument()
  })
})
