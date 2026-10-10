import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import CompraAvulsa from '../../src/admin/CompraAvulsa'
import type { CupomRecente, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: 1001, nome: 'TOMATE ITALIANO OU SALADETE - INSUMOS', unidade: 'kg' },
  { produto_id: 3862312, nome: 'EMBALAGEM P/ PIZZA N. 35 - INSUMOS', unidade: 'un' },
]
const FORNECEDORES = [
  { cnpj: '75315333032655', razao: 'ATACADAO S.A.', fantasia: 'ATACADÃO' },
  { cnpj: '03995515011363', razao: 'MATEUS SUPERMERCADOS S.A.', fantasia: '' },
]
const recente = (o: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'r1', estado: 'LANCADO', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333032655', valor_a_pagar: 1627.25, pedido_sischef: '164200001', criado_em: '2026-10-10T14:00:00Z',
  atualizado_em: '2026-10-10T14:03:00Z', motivo: null, teste: false,
  itens: [{ descricao_cupom: null, entrada_estoque: 12.5, unidade_cupom: null, valor_unitario: 8.9, desconto_item: 0, sugestao_produto: { id: '1001' }, casado_por: null }], ...o,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  m.fornecedoresConhecidos.mockResolvedValue(FORNECEDORES)
  m.comprasAvulsasRecentes.mockResolvedValue([])
  m.enviarCompraAvulsa.mockResolvedValue({ cupom_id: 'c1', resumo: 'enviado para lançar', estado: 'PENDENTE', disparo_ok: true })
})

async function preencher() {
  render(<CompraAvulsa />)
  await userEvent.click(screen.getByRole('button', { name: 'Dinheiro à vista' }))
  await userEvent.type(screen.getByTestId('busca-fornecedor'), 'ata')
  await userEvent.click(await within(await screen.findByTestId('achados-fornecedor')).findByRole('button', { name: /ATACADÃO/ }))
  await userEvent.type(screen.getByTestId('busca-produto'), 'tomate')
  await userEvent.click(await within(await screen.findByTestId('achados')).findByRole('button'))
  await userEvent.type(screen.getByTestId('quantidade-avulsa'), '12,5')
  await userEvent.type(screen.getByTestId('preco-avulsa'), '8,90')
}

describe('CompraAvulsa', () => {
  it('a unidade é a do banco: o produto mostra "entra em KG" e os campos pedem KG', async () => {
    render(<CompraAvulsa />)
    await userEvent.type(screen.getByTestId('busca-produto'), 'tomate')
    await userEvent.click(await within(await screen.findByTestId('achados')).findByRole('button'))
    expect(screen.getByTestId('produto-escolhido')).toHaveTextContent('entra em KG')
    expect(screen.getByText('Quantidade (em KG)')).toBeInTheDocument()
    expect(screen.getByText('Preço por KG (R$)')).toBeInTheDocument()
  })

  it('o Lançar só acende com forma, fornecedor e itens completos; mostra a soma e o que falta', async () => {
    render(<CompraAvulsa />)
    expect(screen.getByTestId('lancar-avulsa')).toBeDisabled()
    expect(screen.getByTestId('falta-forma')).toBeInTheDocument()
    expect(screen.getByTestId('falta-fornecedor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sem cartão' }))
    expect(screen.getByTestId('aviso-sem-financeiro')).toHaveTextContent('nada vai para o financeiro')
    expect(screen.queryByTestId('falta-forma')).not.toBeInTheDocument()
  })

  it('PIX pede banco e empresa antes de liberar', async () => {
    render(<CompraAvulsa />)
    await userEvent.click(screen.getByRole('button', { name: 'PIX' }))
    expect(screen.getByTestId('falta-forma')).toHaveTextContent('banco e empresa do PIX')
    await userEvent.click(screen.getByRole('button', { name: 'Bradesco — Kūkan (S P Delivery)' }))
    expect(screen.queryByTestId('falta-forma')).not.toBeInTheDocument()
  })

  it('Lançar pede confirmação e envia o corpo certo (fornecedor por CNPJ, conta do dinheiro, quantidade e preço na unidade do banco); depois limpa e avisa', async () => {
    await preencher()
    expect(screen.getByTestId('total-geral')).toHaveTextContent('R$ 111,25')
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    expect(screen.getByTestId('confirmar-avulsa')).toHaveTextContent('R$ 111,25')
    expect(screen.getByTestId('confirmar-avulsa')).toHaveTextContent('dinheiro à vista')
    expect(m.enviarCompraAvulsa).not.toHaveBeenCalled()              // só depois do Confirmar
    await userEvent.click(screen.getByTestId('confirmar-lancamento'))
    await waitFor(() => expect(m.enviarCompraAvulsa).toHaveBeenCalledTimes(1))
    const corpo = m.enviarCompraAvulsa.mock.calls[0][0]
    expect(corpo.fornecedor).toEqual({ cnpj: '75315333032655', nome: 'ATACADAO S.A.' })
    expect(corpo.pagamento).toEqual({ forma: 'dinheiro', conta: 'DINHEIRO - À Vista' })
    expect(corpo.itens).toEqual([{ produto_id: 1001, quantidade: 12.5, preco: 8.9 }])
    expect(corpo.envio_id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(await screen.findByTestId('resultado-avulsa')).toHaveTextContent('Compra enviada')
    expect(screen.queryByTestId('fornecedor-escolhido')).not.toBeInTheDocument()   // fornecedor e itens limpos
    expect(screen.getAllByTestId('linha-avulsa')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Dinheiro à vista' })).toHaveAttribute('aria-pressed', 'true') // a forma fica
  })

  it('Voltar na confirmação não envia nada', async () => {
    await preencher()
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(m.enviarCompraAvulsa).not.toHaveBeenCalled()
    expect(screen.getByTestId('lancar-avulsa')).toBeEnabled()
  })

  it('erro do servidor: mostra o motivo e NÃO limpa o que foi digitado (dá para tentar de novo)', async () => {
    m.enviarCompraAvulsa.mockRejectedValue(new Error('item 1: produto não encontrado na lista'))
    await preencher()
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    await userEvent.click(screen.getByTestId('confirmar-lancamento'))
    expect(await screen.findByTestId('erro-avulsa')).toHaveTextContent('produto não encontrado')
    expect(screen.getByTestId('fornecedor-escolhido')).toBeInTheDocument()
    expect(screen.getByTestId('quantidade-avulsa')).toHaveValue('12,5')
  })

  it('disparo que falhou no servidor vira aviso amarelo (a compra ficou na fila e nada a lança sozinha)', async () => {
    m.enviarCompraAvulsa.mockResolvedValue({ cupom_id: 'c1', resumo: 'enviado, mas o disparo automático falhou — nada vai lançá-la sozinha', estado: 'PENDENTE', disparo_ok: false })
    await preencher()
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    await userEvent.click(screen.getByTestId('confirmar-lancamento'))
    const aviso = await screen.findByTestId('resultado-avulsa')
    expect(aviso).toHaveClass('amarelo')
    expect(aviso).toHaveTextContent('nada vai lançá-la sozinha')
  })

  it('fornecedor desconhecido: avisa e o botão de cadastro abre a mesma caixa do cupom; "Usar este fornecedor" escolhe o novo', async () => {
    m.consultarCnpj.mockResolvedValue({ cnpj: '11222333000181', razao_social: 'PADARIA BOM PAO LTDA', nome_fantasia: 'BOM PÃO', uf: 'PA', municipio: 'Belém' })
    m.statusDoCadastroFornecedor.mockResolvedValue({ estado: 'CADASTRADO', motivo: null })
    m.pedirCadastroFornecedor.mockResolvedValue(undefined)
    render(<CompraAvulsa />)
    await userEvent.type(screen.getByTestId('busca-fornecedor'), 'padaria')
    expect(await screen.findByTestId('fornecedor-nao-achado')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('cadastrar-fornecedor-novo'))
    await userEvent.type(screen.getByLabelText('CNPJ'), '11222333000181')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await userEvent.click(await screen.findByTestId('cadastrar'))
    expect(m.pedirCadastroFornecedor).toHaveBeenCalledWith(expect.objectContaining({ cnpj: '11222333000181', razao_social: 'PADARIA BOM PAO LTDA', nome_fantasia: 'BOM PÃO' }))
    await userEvent.click(await screen.findByTestId('reenviar-cupom', undefined, { timeout: 8000 }))
    expect(screen.getByTestId('fornecedor-escolhido')).toHaveTextContent('BOM PÃO')
  }, 15000)

  it('últimas compras: mostra o estado, o nome (fantasia) e o detalhe com a unidade do banco; compra parada mostra o motivo', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([
      recente(),
      recente({ id: 'r2', estado: 'REVISAR', pedido_sischef: null, motivo: 'fornecedor não encontrado no Sischef (ATACADAO S.A.)', valor_a_pagar: 50 }),
    ])
    render(<CompraAvulsa />)
    const linhas = await screen.findAllByTestId('compra-recente')
    expect(linhas[0]).toHaveTextContent('lançada ✓ · ATACADÃO · R$ 1.627,25')
    expect(linhas[1]).toHaveTextContent('precisa de você ⚠')
    expect(screen.getByTestId('motivo-recente')).toHaveTextContent('fornecedor não encontrado')
    await userEvent.click(within(linhas[0]).getByRole('button', { name: /lançada/ }))
    expect(linhas[0]).toHaveTextContent('164200001')
    expect(linhas[0]).toHaveTextContent('12,5 kg')
    expect(linhas[0]).toHaveTextContent('R$ 111,25')
  })
})
