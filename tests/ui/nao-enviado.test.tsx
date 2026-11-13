import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import * as api from '../../src/lib/api'
import * as atualizacao from '../../src/lib/atualizacao'
import Layout from '../../src/components/Layout'
import CompraAvulsa from '../../src/admin/CompraAvulsa'
import CorrigirCupom from '../../src/admin/CorrigirCupom'
import { PERGUNTA_NAO_ENVIADO, marcarNaoEnviado, temNaoEnviado } from '../../src/lib/naoEnviado'
import type { CupomRecente, ItemCupomRecente, ProdutoCatalogo, Usuario } from '../../src/lib/tipos'

// Reanálise de 13/11 (B4): o botão "Atualizar" do topo recarregava a página sem perguntar, e trocar de aba descartava a compra avulsa em preenchimento e a correção de cupom em andamento.
// Agora a tela marca "tenho dados não enviados" e o Atualizar e as abas perguntam antes. Sem dados pendentes, nada muda.
vi.mock('../../src/lib/api')
vi.mock('../../src/lib/atualizacao')
const a = vi.mocked(atualizacao)
const m = vi.mocked(api)

const ADMIN: Usuario = { email: 'ivan@spazio.invalid', nome: 'Ivan', papel: 'admin', ativo: true } as Usuario
const CATALOGO: ProdutoCatalogo[] = [{ produto_id: 1001, nome: 'TOMATE ITALIANO OU SALADETE - INSUMOS', unidade: 'kg' }]
const FORNECEDORES = [{ cnpj: '75315333032655', razao: 'ATACADAO S.A.', fantasia: 'ATACADÃO' }]

let confirmar: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.resetAllMocks()
  m.contarAguardando.mockResolvedValue(0)
  a.useNovaVersao.mockReturnValue(null)
  a.conferirVersao.mockResolvedValue('igual')
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.fornecedoresConhecidos.mockResolvedValue(FORNECEDORES)
  m.comprasAvulsasRecentes.mockResolvedValue([])
  m.enviarCompraAvulsa.mockResolvedValue({ cupom_id: 'c1', resumo: 'enviado para lançar', estado: 'PENDENTE', disparo_ok: true })
  confirmar = vi.spyOn(window, 'confirm')
})
afterEach(() => { marcarNaoEnviado('teste', false); confirmar.mockRestore() })

function Onde() { return <p data-testid="onde">{useLocation().pathname}</p> }
const montar = () => render(<MemoryRouter initialEntries={['/compra-avulsa']}><Layout usuario={ADMIN}><Onde /></Layout></MemoryRouter>)
const aba = (nome: string) => within(screen.getByRole('navigation', { name: 'Seções' })).getByRole('link', { name: new RegExp(nome) })

describe('Layout: o Atualizar do topo e as abas perguntam antes de jogar fora o que foi digitado (B4)', () => {
  it('SEM dados pendentes nada muda: o Atualizar recarrega e a aba troca, sem pergunta nenhuma', async () => {
    montar()
    await userEvent.click(aba('Lançamento de cupom'))
    expect(screen.getByTestId('onde')).toHaveTextContent('/cupom')
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(a.recarregarPagina).toHaveBeenCalledTimes(1))
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('COM dados pendentes o Atualizar pergunta; "Cancelar" não confere a versão nem recarrega, e o botão continua à mão', async () => {
    marcarNaoEnviado('teste', true)
    confirmar.mockReturnValue(false)
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_NAO_ENVIADO)
    expect(a.conferirVersao).not.toHaveBeenCalled()
    expect(a.recarregarPagina).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeEnabled()
  })

  it('COM dados pendentes e "OK" o Atualizar segue como sempre', async () => {
    marcarNaoEnviado('teste', true)
    confirmar.mockReturnValue(true)
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(a.recarregarPagina).toHaveBeenCalledTimes(1))
    expect(a.conferirVersao).toHaveBeenCalledWith('manual')
  })

  it('COM dados pendentes a aba pergunta: "Cancelar" fica na tela; "OK" troca de aba', async () => {
    marcarNaoEnviado('teste', true)
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true)
    montar()
    await userEvent.click(aba('Lançamento de cupom'))
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_NAO_ENVIADO)
    expect(screen.getByTestId('onde')).toHaveTextContent('/compra-avulsa')
    await userEvent.click(aba('Lançamento de cupom'))
    expect(screen.getByTestId('onde')).toHaveTextContent('/cupom')
  })

  it('tocar na aba da própria tela não pergunta nada (não sai dela)', async () => {
    marcarNaoEnviado('teste', true)
    montar()
    await userEvent.click(aba('Compras avulsas'))
    expect(confirmar).not.toHaveBeenCalled()
    expect(screen.getByTestId('onde')).toHaveTextContent('/compra-avulsa')
  })
})

describe('Compra avulsa marca "tenho dados não enviados" (B4)', () => {
  it('tela aberta e vazia não marca nada; escolher a forma de pagamento marca; sair da tela desmarca', async () => {
    const { unmount } = render(<CompraAvulsa />)
    expect(temNaoEnviado()).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Dinheiro à vista' }))
    expect(temNaoEnviado()).toBe(true)
    unmount()
    expect(temNaoEnviado()).toBe(false)
  })

  it('digitar num item marca; escolher o fornecedor marca', async () => {
    const { unmount } = render(<CompraAvulsa />)
    await userEvent.type(screen.getByTestId('busca-produto'), 'to')
    expect(temNaoEnviado()).toBe(true)
    await userEvent.clear(screen.getByTestId('busca-produto'))
    expect(temNaoEnviado()).toBe(false)
    await userEvent.type(screen.getByTestId('busca-fornecedor'), 'ata')
    await userEvent.click(await within(await screen.findByTestId('achados-fornecedor')).findByRole('button', { name: /ATACADÃO/ }))
    expect(temNaoEnviado()).toBe(true)
    unmount()
  })

  it('enviar com sucesso desmarca (a forma de pagamento fica escolhida para a próxima, mas não há mais nada a perder)', async () => {
    const { unmount } = render(<CompraAvulsa />)
    await userEvent.click(screen.getByRole('button', { name: 'Dinheiro à vista' }))
    await userEvent.type(screen.getByTestId('busca-fornecedor'), 'ata')
    await userEvent.click(await within(await screen.findByTestId('achados-fornecedor')).findByRole('button', { name: /ATACADÃO/ }))
    await userEvent.type(screen.getByTestId('busca-produto'), 'tomate')
    await userEvent.click(await within(await screen.findByTestId('achados')).findByRole('button'))
    await userEvent.type(screen.getByTestId('quantidade-avulsa'), '2')
    await userEvent.type(screen.getByTestId('preco-avulsa'), '3')
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    await userEvent.click(screen.getByTestId('confirmar-lancamento'))
    expect(await screen.findByTestId('resultado-avulsa')).toHaveTextContent('Compra enviada')
    expect(screen.getByRole('button', { name: 'Dinheiro à vista' })).toHaveAttribute('aria-pressed', 'true')
    expect(temNaoEnviado()).toBe(false)
    unmount()
  }, 60000)
})

describe('Correção de cupom marca "tenho dados não enviados" (B4)', () => {
  const item = (descricao_cupom: string, valor_unitario: number, quantidade_cupom: number): ItemCupomRecente => ({
    descricao_cupom, unidade_cupom: 'KG', valor_unitario, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, quantidade_cupom, proposta: null,
  })
  const CUPOM: CupomRecente = {
    id: 'c1', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 4.5, pedido_sischef: null, criado_em: '2026-11-04T12:00:00Z',
    motivo: '1 item(ns) sem casamento confirmado — confira no Code', teste: false, itens: [item('TOMATE ITALIANO', 4.5, 1)],
  }

  it('aberta sem mexer não marca; escolher o produto de um item marca; sair da tela desmarca', async () => {
    const { unmount } = render(<CorrigirCupom cupom={CUPOM} catalogo={CATALOGO} catalogoFalhou={false} aoReenviar={vi.fn()} />)
    expect(temNaoEnviado()).toBe(false)
    await userEvent.click(screen.getByTestId('item-cabecalho'))
    await userEvent.type(screen.getByLabelText('Produto do SisChef'), 'tomate')
    await userEvent.click(await screen.findByRole('button', { name: /TOMATE ITALIANO OU SALADETE/ }))
    expect(temNaoEnviado()).toBe(true)
    unmount()
    expect(temNaoEnviado()).toBe(false)
  })
})
