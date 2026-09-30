import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as cad from '../../src/cadastros/api'
import type { FatorAConfirmar, ProdutoCadastro } from '../../src/lib/tipos'
import AConfirmar from '../../src/admin/cadastros/AConfirmar'

vi.mock('../../src/cadastros/api')
const m = vi.mocked(cad)

const base = (over: Partial<FatorAConfirmar>): FatorAConfirmar => ({
  produto_id: 101, produto: 'COCA COLA 350 ML', unidade: 'un', bebida: true, vendedor_id: 1, fator: 12,
  embalagem_sugerida: 'fardo', origem: 'resposta', ref: '55', vezes: 2, ultima: null, exemplos: [],
  padrao_embalagem: null, padrao_fator: null, padrao_confirmado_em: null, conflito: false, ...over,
})
const produto = (over: Partial<ProdutoCadastro>): ProdutoCadastro => ({
  produto_id: 201, produto: 'SHOYU TRADICIONAL (KG)', nome_limpo: 'SHOYU', unidade: 'kg', bebida: false,
  fornecedor_ultima: null, data_ultima_compra: null, vendedor_id: 1, via: 'catalogo', motivo: null, vendedor_motivo_id: null,
  catalogo_origem: null, escolhido_em: null, nome_para_vendedor: null, nota_vendedor: null, embalagem: null, fator: null,
  fator_confirmado_em: null, vende_por_litro: true, kg_por_litro: null, kg_por_litro_confirmado_em: null,
  descricao_fornecedor: null, codigo_fornecedor: null, categoria: 'Insumos', regra: null, regra_motivo: null,
  a_confirmar: 0, disputa: null, ...over,
})
const vendedores = [{ id: 1, codigo: 'fulano', nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', ativo: true }]

beforeEach(() => {
  vi.resetAllMocks()
  m.listarVendedores.mockResolvedValue(vendedores)
  m.produtosCadastro.mockResolvedValue([])
  m.confirmarFator.mockResolvedValue({})
  m.descartarFator.mockResolvedValue()
  m.confirmarKgPorLitro.mockResolvedValue()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('Cadastros — A confirmar (C.5)', () => {
  it('"Usar fardo c/12 como padrão" chama confirmarFator com origem resposta e a ref', async () => {
    m.fatoresAConfirmar.mockResolvedValue([base({})])
    render(<AConfirmar />)
    await userEvent.click(await screen.findByRole('button', { name: 'Usar fardo c/12 como padrão' }))
    expect(m.confirmarFator).toHaveBeenCalledWith(101, 1, 'fardo', 12, 'resposta', '55')
  })

  it('na fonte NF-e, chama com origem nfe e a chave', async () => {
    const chave = '15261012345678000190550010001234561000000017'
    m.fatoresAConfirmar.mockResolvedValue([base({ produto_id: 102, origem: 'nfe', ref: chave })])
    render(<AConfirmar />)
    await userEvent.click(await screen.findByRole('button', { name: 'Usar fardo c/12 como padrão' }))
    expect(m.confirmarFator).toHaveBeenCalledWith(102, 1, 'fardo', 12, 'nfe', chave)
  })

  it('trocar o tipo muda o texto do botão', async () => {
    m.fatoresAConfirmar.mockResolvedValue([base({})])
    render(<AConfirmar />)
    await screen.findByRole('button', { name: 'Usar fardo c/12 como padrão' })
    await userEvent.selectOptions(screen.getByLabelText('Tipo para COCA COLA 350 ML'), 'caixa')
    expect(screen.getByRole('button', { name: 'Usar caixa c/12 como padrão' })).toBeInTheDocument()
  })

  it('conflito pede confirmação antes de trocar o padrão', async () => {
    m.fatoresAConfirmar.mockResolvedValue([base({ conflito: true, padrao_embalagem: 'fardo', padrao_fator: 6 })])
    render(<AConfirmar />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar o padrão para fardo c/12' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(m.confirmarFator).toHaveBeenCalledWith(101, 1, 'fardo', 12, 'resposta', '55')
  })

  it('"Não usar" chama o descartar', async () => {
    m.fatoresAConfirmar.mockResolvedValue([base({})])
    render(<AConfirmar />)
    const cartao = (await screen.findByText('COCA COLA 350 ML · ATACADÃO')).closest('.cartao') as HTMLElement
    await userEvent.click(within(cartao).getByRole('button', { name: 'Não usar' }))
    expect(m.descartarFator).toHaveBeenCalledWith(101, 1, 12)
  })
})

describe('Cadastros — A confirmar: líquidos sem conversão (C.5)', () => {
  it('mostra os líquidos kg sem "1 L = ? kg" no fim, e [1 L = 1 kg] chama confirmarKgPorLitro com 1', async () => {
    m.fatoresAConfirmar.mockResolvedValue([])
    m.produtosCadastro.mockResolvedValue([
      produto({ produto_id: 201, produto: 'SHOYU TRADICIONAL (KG)' }),
      produto({ produto_id: 202, produto: 'AÇÚCAR (KG)', vende_por_litro: false }), // não é líquido: fica de fora
      produto({ produto_id: 203, produto: 'ÓLEO (KG)', kg_por_litro: 0.92 }), // já convertido: fica de fora
    ])
    render(<AConfirmar />)
    const cartao = (await screen.findByText('SHOYU TRADICIONAL (KG)')).closest('.cartao') as HTMLElement
    expect(screen.queryByText('AÇÚCAR (KG)')).not.toBeInTheDocument()
    expect(screen.queryByText('ÓLEO (KG)')).not.toBeInTheDocument()
    expect(screen.queryByText('Nada a confirmar.')).not.toBeInTheDocument()
    await userEvent.click(within(cartao).getByRole('button', { name: '1 L = 1 kg' }))
    expect(m.confirmarKgPorLitro).toHaveBeenCalledWith(201, 1)
  })

  it('[Outro valor…] pergunta o valor e grava o kg informado', async () => {
    m.fatoresAConfirmar.mockResolvedValue([])
    m.produtosCadastro.mockResolvedValue([produto({ produto_id: 201, produto: 'SHOYU TRADICIONAL (KG)' })])
    vi.spyOn(window, 'prompt').mockReturnValue('0,92')
    render(<AConfirmar />)
    await userEvent.click(await screen.findByRole('button', { name: 'Outro valor…' }))
    expect(m.confirmarKgPorLitro).toHaveBeenCalledWith(201, 0.92)
  })

  it('filtra o líquido pelo produtoInicial, como faz com as sugestões', async () => {
    m.fatoresAConfirmar.mockResolvedValue([])
    m.produtosCadastro.mockResolvedValue([
      produto({ produto_id: 201, produto: 'SHOYU TRADICIONAL (KG)' }),
      produto({ produto_id: 209, produto: 'VINAGRE (KG)' }),
    ])
    render(<AConfirmar produtoInicial="201" />)
    expect(await screen.findByText('SHOYU TRADICIONAL (KG)')).toBeInTheDocument()
    expect(screen.queryByText('VINAGRE (KG)')).not.toBeInTheDocument()
  })
})
