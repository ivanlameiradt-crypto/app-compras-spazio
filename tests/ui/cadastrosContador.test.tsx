import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import * as cad from '../../src/cadastros/api'
import type { FatorAConfirmar, ProdutoCadastro } from '../../src/lib/tipos'
import Cadastros from '../../src/admin/Cadastros'

vi.mock('../../src/cadastros/api')
const m = vi.mocked(cad)
const admin = { email: 'admin@spazio.com', nome: 'Admin', papel: 'admin' as const, ativo: true }

// só os campos que o contador lê importam; o resto é preenchido para satisfazer o tipo
const liquido = (id: number): ProdutoCadastro => ({
  produto_id: id, produto: `LÍQUIDO ${id}`, nome_limpo: 'X', unidade: 'kg', bebida: false, fornecedor_ultima: null,
  data_ultima_compra: null, vendedor_id: 1, via: 'catalogo', motivo: null, vendedor_motivo_id: null, catalogo_origem: null,
  escolhido_em: null, nome_para_vendedor: null, nota_vendedor: null, embalagem: null, fator: null, fator_confirmado_em: null,
  vende_por_litro: true, kg_por_litro: null, kg_por_litro_confirmado_em: null, descricao_fornecedor: null,
  codigo_fornecedor: null, categoria: 'Insumos', regra: null, regra_motivo: null, a_confirmar: 0, disputa: null,
})
const fator = { produto_id: 1 } as FatorAConfirmar

beforeEach(() => {
  vi.resetAllMocks()
  m.listarVendedores.mockResolvedValue([])
  m.listarGrafias.mockResolvedValue([])
  m.listarCnpjs.mockResolvedValue([])
  m.fornecedoresSemVendedor.mockResolvedValue([])
})

describe('Cadastros — contador "A confirmar" (C.5)', () => {
  it('N soma as sugestões de fator e os líquidos sem conversão pendentes', async () => {
    m.fatoresAConfirmar.mockResolvedValue([fator, fator]) // 2 sugestões
    m.produtosCadastro.mockResolvedValue([liquido(201), liquido(202)]) // + 2 líquidos pendentes = 4
    render(<MemoryRouter><Cadastros usuario={admin} /></MemoryRouter>)
    const badge = await screen.findByText('4')
    expect(badge).toHaveClass('contador')
  })

  it('sem nada pendente, o badge não aparece', async () => {
    m.fatoresAConfirmar.mockResolvedValue([])
    m.produtosCadastro.mockResolvedValue([])
    render(<MemoryRouter><Cadastros usuario={admin} /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Vendedores' })
    expect(document.querySelector('.contador')).toBeNull()
  })
})
