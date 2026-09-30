import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as cad from '../../src/cadastros/api'
import * as api from '../../src/lib/api'
import type { ProdutoCadastro } from '../../src/lib/tipos'
import Produtos from '../../src/admin/cadastros/Produtos'

vi.mock('../../src/cadastros/api')
vi.mock('../../src/lib/api')
const mc = vi.mocked(cad)
const ma = vi.mocked(api)

const base = (over: Partial<ProdutoCadastro>): ProdutoCadastro => ({
  produto_id: 1, produto: 'X', nome_limpo: 'X', unidade: 'un', bebida: true, fornecedor_ultima: null, data_ultima_compra: null,
  vendedor_id: null, via: null, motivo: null, vendedor_motivo_id: null, catalogo_origem: null, escolhido_em: null,
  nome_para_vendedor: null, nota_vendedor: null, embalagem: null, fator: null, fator_confirmado_em: null,
  vende_por_litro: false, kg_por_litro: null, kg_por_litro_confirmado_em: null, descricao_fornecedor: null,
  codigo_fornecedor: null, categoria: 'Bebidas', regra: null, regra_motivo: null, a_confirmar: 0, disputa: null, ...over,
})
const agua = base({ produto_id: 101, produto: 'ÁGUA 500ML', nome_limpo: 'ÁGUA 500ML', vendedor_id: 1, via: 'ultima_compra' })
const acucar = base({ produto_id: 103, produto: 'AÇÚCAR (KG)', nome_limpo: 'AÇÚCAR', unidade: 'kg', bebida: false, vendedor_id: 1, via: 'catalogo', vende_por_litro: true })
const orfao = base({ produto_id: 108, produto: 'ALHO (KG)', unidade: 'kg', bebida: false, motivo: 'nunca_comprado' })
const vendedores = [{ id: 1, codigo: 'fulano', nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', ativo: true }]

beforeEach(() => {
  vi.resetAllMocks()
  mc.produtosCadastro.mockResolvedValue([agua, acucar, orfao])
  mc.listarVendedores.mockResolvedValue(vendedores)
  ma.historicoItem.mockResolvedValue(null)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Cadastros — Produtos e detalhe (C.5)', () => {
  it('o filtro "Sem vendedor" mostra só quem não tem vendedor', async () => {
    render(<Produtos />)
    expect(await screen.findByText('ÁGUA 500ML')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sem vendedor' }))
    expect(screen.getByText('ALHO (KG)')).toBeInTheDocument()
    expect(screen.queryByText('ÁGUA 500ML')).not.toBeInTheDocument()
  })

  it('nome com "R$" pede confirmação', async () => {
    ma.definirNota.mockResolvedValue()
    render(<Produtos />)
    await userEvent.click(await screen.findByText('ÁGUA 500ML'))
    const campo = await screen.findByLabelText('Nome para o vendedor')
    await userEvent.type(campo, 'R$ 5,00')
    const cartaoNome = campo.closest('.cartao') as HTMLElement
    await userEvent.click(within(cartaoNome).getByRole('button', { name: 'Gravar' }))
    expect(window.confirm).toHaveBeenCalled()
  })

  it('fator 12,5 em item por unidade é recusado na tela (sem chamar a api)', async () => {
    render(<Produtos />)
    await userEvent.click(await screen.findByText('ÁGUA 500ML'))
    await userEvent.type(await screen.findByLabelText('Fator'), '12,5')
    await userEvent.click(screen.getByRole('button', { name: 'Definir' }))
    expect(screen.getByText('em item por unidade o fator é um número inteiro, ex.: 12')).toBeInTheDocument()
    expect(mc.confirmarFator).not.toHaveBeenCalled()
  })

  it('[1 L = 1 kg] chama confirmarKgPorLitro com 1', async () => {
    mc.confirmarKgPorLitro.mockResolvedValue()
    render(<Produtos />)
    await userEvent.click(await screen.findByText('AÇÚCAR (KG)'))
    await userEvent.click(await screen.findByRole('button', { name: '1 L = 1 kg' }))
    expect(mc.confirmarKgPorLitro).toHaveBeenCalledWith(103, 1)
  })

  it('"Últimas cotações" lê o cot_historico_item', async () => {
    render(<Produtos />)
    await userEvent.click(await screen.findByText('ÁGUA 500ML'))
    expect(await screen.findByText('Últimas cotações')).toBeInTheDocument()
    expect(ma.historicoItem).toHaveBeenCalledWith(101, null, null)
  })
})
