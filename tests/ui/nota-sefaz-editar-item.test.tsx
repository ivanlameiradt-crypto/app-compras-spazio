// 21/10/2026 (pedido do Ivan): "Editar" em TODO item da nota, também no que já está certo. O caso: KETCHUP SACHE 168UN da MATEUS 000089465 — a nota traz
// 10 UN e cada UN é uma caixa com 168 sachês; no estoque têm de entrar 1.680. O produto já vem associado no SisChef, então a caixa é a da conversão do item
// (ConversaoItemAssociado): o Ivan informa 168, vê a conta "10 × 168 = 1.680 UN" e confirma; o robô aplica ao lançar (regras_embalagem).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE = '2'.repeat(44)
const KETCHUP = 3469734
const ROTULO_UN = 'Quanto vale 1 unidade da nota em UN?'
const mateusKetchup = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000089465', emissao: '2026-10-20', valor_nf: 2400,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [
    { n: 2, descricao: 'CÓD. FOR: 473185 ÓLEO DE ALGODÃO - INSUMOS', qtd: 20, unidade_sischef: 'UN', produto_id: '3469755', produto_nome: 'ÓLEO DE ALGODÃO - INSUMOS', associacao: 'sischef' },
    { n: 3, descricao: 'CÓD. FOR: 594614 KETCHUP SACHE 168UN - INSUMOS', qtd: 10, unidade_sischef: 'UN', produto_id: String(KETCHUP), produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', associacao: 'sischef' },
  ],
  associacoes_app: null, lancamento_estado: null, lancamento_motivo: null,
  ...extra,
} as unknown as NotaSefazLista)
const embalagemGravada = (conversao: number) => ({
  '3': { produto_id: KETCHUP, produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', unidade: null, conversao, origem: 'sischef', por: 'ivan@spazio.invalid', em: '2026-10-21T20:10:00Z' },
})
const itens = async () => within(await screen.findByTestId('conferir')).findAllByTestId('conferir-item')
const itemKetchup = async () => (await itens())[1]

beforeEach(() => {
  vi.resetAllMocks()
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('NotaSefaz — "Editar" em todo item associado: embalagem de várias unidades (ketchup 168UN, 21/10)', () => {
  it('Editar abre a caixa vazia; a sugestão do nome (168UN) só preenche ao toque; a prévia mostra 10 × 168 = 1.680 UN; Confirmar grava 168', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup()])
    m.converterItem.mockImplementation(async () => { m.notasALancar.mockResolvedValue([mateusKetchup({ associacoes_app: embalagemGravada(168) })]) })
    render(<NotaSefaz />)
    const item = within(await itemKetchup())
    expect(item.queryByTestId('editar-item-caixa')).not.toBeInTheDocument()           // fechado de início: o produto está certo, a nota não pediu nada
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    const caixa = within(await item.findByTestId('editar-item-caixa'))
    expect(caixa.getByLabelText(ROTULO_UN)).toHaveValue('')                            // vazio: quem define é o Ivan
    expect(caixa.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    expect(caixa.getByTestId('conversao-item-sugestao')).toHaveTextContent('168UN')
    await userEvent.click(caixa.getByRole('button', { name: 'usar 168' }))
    expect(caixa.getByLabelText(ROTULO_UN)).toHaveValue('168')
    expect(m.converterItem).not.toHaveBeenCalled()                                     // sugerir não grava
    expect(caixa.getByTestId('conversao-item-previa')).toHaveTextContent('10 × 168 = 1.680 UN')
    expect(caixa.getByTestId('conversao-item-aviso-conta')).toHaveTextContent('quantidade que o SisChef mostra hoje (10)')
    await userEvent.click(caixa.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168))
    const informada = await item.findByTestId('conversao-item-informada')
    expect(informada).toHaveTextContent('1 unidade da nota = 168 UN')
    expect(informada).toHaveTextContent('Entram no estoque: 10 × 168 = 1.680 UN')
    expect(item.queryByTestId('editar-item-caixa')).not.toBeInTheDocument()
    expect(item.getByRole('button', { name: 'Editar' })).toBeEnabled()                // e dá para editar de novo
  })

  it('digitando o 168 à mão o eco aparece na hora; sem a quantidade da leitura não há conta (mas dá para gravar)', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup({ itens: [
      { n: 3, descricao: 'CÓD. FOR: 594614 KETCHUP SACHE 168UN - INSUMOS', qtd: null, unidade_sischef: 'UN', produto_id: String(KETCHUP), produto_nome: 'KETCHUP SACHE 168UN - INSUMOS', associacao: 'sischef' },
    ] as unknown as NotaSefazLista['itens'] })])
    m.converterItem.mockResolvedValue(undefined)
    render(<NotaSefaz />)
    const item = within((await itens())[0])
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    await userEvent.type(item.getByLabelText(ROTULO_UN), '168')
    expect(item.getByTestId('conversao-item-eco')).toHaveTextContent('1 unidade da nota = 168 UN')
    expect(item.queryByTestId('conversao-item-previa')).not.toBeInTheDocument()
    await userEvent.click(item.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenCalledWith(CHAVE, 3, 168))
  })

  it('Cancelar fecha a caixa sem gravar nada, e a sugestão some quando já tem número digitado', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup()])
    render(<NotaSefaz />)
    const item = within(await itemKetchup())
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    await userEvent.type(item.getByLabelText(ROTULO_UN), '12')
    expect(item.queryByTestId('conversao-item-sugestao')).not.toBeInTheDocument()
    await userEvent.click(item.getByRole('button', { name: 'Cancelar' }))
    expect(item.queryByTestId('editar-item-caixa')).not.toBeInTheDocument()
    expect(item.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(m.converterItem).not.toHaveBeenCalled()
  })

  it('já com a embalagem gravada: a linha mostra a conta; Editar reabre com o número, e "Desfazer a conversão" grava nulo', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup({ associacoes_app: embalagemGravada(168) })])
    m.converterItem.mockResolvedValue(undefined)
    render(<NotaSefaz />)
    const item = within(await itemKetchup())
    expect(await item.findByTestId('conversao-item-informada')).toHaveTextContent('Entram no estoque: 10 × 168 = 1.680 UN')
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    expect(item.getByLabelText(ROTULO_UN)).toHaveValue('168')
    await userEvent.click(item.getByRole('button', { name: 'Desfazer a conversão' }))
    await waitFor(() => expect(m.converterItem).toHaveBeenLastCalledWith(CHAVE, 3, null))
    expect(await item.findByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(item.queryByTestId('conversao-item-informada')).not.toBeInTheDocument()
  })

  it('com o robô lançando a nota o Editar fica apagado em todos os itens: o banco também recusa', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup({ lancamento_estado: 'lancando', lancamento_estado_em: new Date().toISOString() })])
    render(<NotaSefaz />)
    await itens()
    for (const botao of within(screen.getByTestId('conferir')).getAllByRole('button', { name: 'Editar' })) expect(botao).toBeDisabled()
  })

  it('com a nota pela metade (estado erro) o Editar também fica apagado', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup({ lancamento_estado: 'erro', lancamento_motivo: 'erro no lançamento (pedido JÁ gerado — conferir no Sischef)' })])
    render(<NotaSefaz />)
    await itens()
    for (const botao of within(screen.getByTestId('conferir')).getAllByRole('button', { name: 'Editar' })) expect(botao).toBeDisabled()
  })

  it('nome sem número de embalagem (óleo): Editar abre sem sugestão', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup()])
    render(<NotaSefaz />)
    const oleo = within((await itens())[0])
    await userEvent.click(oleo.getByRole('button', { name: 'Editar' }))
    expect(oleo.getByLabelText(ROTULO_UN)).toBeInTheDocument()
    expect(oleo.queryByTestId('conversao-item-sugestao')).not.toBeInTheDocument()
  })

  it('o erro do banco aparece na caixa e nada é dado como gravado', async () => {
    m.notasALancar.mockResolvedValue([mateusKetchup()])
    m.converterItem.mockRejectedValue(new Error('A conversão deve ser maior que zero e ter até 4 casas.'))
    render(<NotaSefaz />)
    const item = within(await itemKetchup())
    await userEvent.click(item.getByRole('button', { name: 'Editar' }))
    await userEvent.type(item.getByLabelText(ROTULO_UN), '168')
    await userEvent.click(item.getByRole('button', { name: 'Confirmar' }))
    expect(await item.findByRole('alert')).toHaveTextContent('maior que zero')
    expect(item.queryByTestId('conversao-item-informada')).not.toBeInTheDocument()
  })
})
