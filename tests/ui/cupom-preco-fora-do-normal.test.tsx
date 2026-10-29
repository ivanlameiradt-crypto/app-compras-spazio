// Preço fora do normal no CUPOM, a TELA (pedido do Ivan, 29/10/2026): ao confirmar um item do cupom parado, o preço por unidade de ESTOQUE da linha (o que o SisChef vai gravar) é comparado com as últimas
// compras do produto. Longe de todas (3× ou mais, para cima ou para baixo) = quadro amarelo na caixa do item, e de novo no resumo do fim; NUNCA trava. Com a conversão certa o quadro some sozinho.
// O item que o servidor já casou também é conferido no resumo. Tudo INVENTADO (repositório público).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CorrigirCupom from '../../src/admin/CorrigirCupom'
import type { CupomRecente, ItemCupomRecente, ProdutoCatalogo } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')

const COCA = 1836984
const catalogo = (compras: ProdutoCatalogo['compras'] = [{ preco: 3.55, data: '2026-10-21', unidade: 'un' }]): ProdutoCatalogo[] => [
  { produto_id: COCA, nome: 'COCA COLA - ZERO 350 ML', unidade: 'un', compras },
]
const itemPendente = (over: Partial<ItemCupomRecente> = {}): ItemCupomRecente => ({
  descricao_cupom: 'REFRIG COCA ZERO LT 350ML', entrada_estoque: null, unidade_cupom: 'UN', valor_unitario: 21.25, desconto_item: null, sugestao_produto: null, casado_por: null,
  quantidade_cupom: 20, ...over,
})
const itemConhecido = (over: Partial<ItemCupomRecente> = {}): ItemCupomRecente =>
  itemPendente({ entrada_estoque: 20, sugestao_produto: { id: String(COCA) }, casado_por: 'aprendizado', ...over })
const cupom = (itens: ItemCupomRecente[], valor = 425): CupomRecente => ({
  id: 'cupom-1', estado: 'REVISAR', emitente_nome: 'ATACADO EXEMPLO', emitente_cnpj: '12345678000190', valor_a_pagar: valor, pedido_sischef: null, criado_em: '2026-10-29T15:00:00Z',
  motivo: 'precisa confirmar', teste: false, itens,
})
const mostrar = (c: CupomRecente, cat: ProdutoCatalogo[] | null = catalogo()) =>
  render(<CorrigirCupom cupom={c} catalogo={cat} catalogoFalhou={false} aoReenviar={() => {}} />)
const escolherCoca = async () => {
  await userEvent.type(screen.getByLabelText('Produto do SisChef'), 'coca')
  await userEvent.click(within(await screen.findByTestId('achados')).getByRole('button', { name: /COCA COLA - ZERO 350 ML/ }))
}

describe('CorrigirCupom — preço fora do normal na caixa do item pendente', () => {
  it('Coca Zero a R$ 21,25 por UN contra R$ 3,55: ao escolher o produto, o quadro amarelo aparece junto da linha, com o conselho', async () => {
    mostrar(cupom([itemPendente()]))
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()       // sem produto escolhido ainda não há o que conferir
    await escolherCoca()
    const aviso = await screen.findByTestId('preco-fora-do-normal')
    expect(aviso).toHaveClass('amarelo')
    expect(aviso).toHaveTextContent('Preço fora do normal: R$ 21,25 por UN. Na última compra custou R$ 3,55 (21/10): 6 vezes mais caro.')
    expect(aviso).toHaveTextContent('Confira a embalagem (fardo, caixa, pacote) e a conversão.')
    expect(screen.getByText(/Linha: 20 un/)).toBeInTheDocument()
  })

  it('NUNCA trava: "Confirmar este item" segue liberado e o item vai para o resumo, que repete o aviso', async () => {
    mostrar(cupom([itemPendente()]))
    await escolherCoca()
    const confirmar = await screen.findByRole('button', { name: 'Confirmar este item' })
    expect(confirmar).toBeEnabled()
    await userEvent.click(confirmar)
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()      // a caixa fechou
    const resumo = await screen.findByTestId('resumo-confirmado')
    expect(within(resumo).getByTestId('preco-fora-do-normal-resumo')).toHaveTextContent('Preço fora do normal: R$ 21,25 por UN')
  })

  it('o cupom em CX com 6 por caixa: R$ 21,25 por CX vira R$ 3,54 por UN e NÃO avisa', async () => {
    mostrar(cupom([itemPendente({ unidade_cupom: 'CX', quantidade_cupom: 20 })]))
    await escolherCoca()
    await userEvent.type(await screen.findByLabelText('Unidades em 1 CX'), '6')
    expect(await screen.findByText(/Linha: 20 cx/)).toBeInTheDocument()
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('digitar a conversão errada ao contrário (1 CX = 1) avisa; corrigir para 6 faz o aviso sumir', async () => {
    mostrar(cupom([itemPendente({ unidade_cupom: 'CX', quantidade_cupom: 20 })]))
    await escolherCoca()
    const campo = await screen.findByLabelText('Unidades em 1 CX')
    await userEvent.type(campo, '1')
    expect(await screen.findByTestId('preco-fora-do-normal')).toHaveTextContent('R$ 21,25 por UN')
    await userEvent.clear(campo)
    await userEvent.type(campo, '6')
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('preço normal: nenhum quadro', async () => {
    mostrar(cupom([itemPendente({ valor_unitario: 3.6, quantidade_cupom: 120 })], 432))
    await escolherCoca()
    await screen.findByText(/Linha: 120 un/)
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('produto sem compras na lista (novo): nenhum quadro, nem erro', async () => {
    mostrar(cupom([itemPendente()]), catalogo([]))
    await escolherCoca()
    await screen.findByText(/Linha: 20 un/)
    expect(screen.queryByTestId('preco-fora-do-normal')).not.toBeInTheDocument()
  })

  it('o preço MUITO mais barato também avisa (R$ 0,17 por UN contra R$ 3,55)', async () => {
    mostrar(cupom([itemPendente({ valor_unitario: 0.17, quantidade_cupom: 20 })], 3.4))
    await escolherCoca()
    expect(await screen.findByTestId('preco-fora-do-normal')).toHaveTextContent('21 vezes mais barato')
  })
})

describe('CorrigirCupom — o item que o servidor já casou também é conferido no resumo', () => {
  it('item conhecido a R$ 21,25 por UN: o resumo mostra o aviso ao lado do ✓', async () => {
    mostrar(cupom([itemConhecido()]))
    const conhecido = await screen.findByTestId('item-conhecido')
    expect(within(conhecido).getByTestId('preco-fora-do-normal-resumo')).toHaveTextContent('Preço fora do normal: R$ 21,25 por UN. Na última compra custou R$ 3,55 (21/10)')
  })

  it('item conhecido com preço normal, sem quantidade que entra, ou com produto fora da lista: calado', async () => {
    mostrar(cupom([itemConhecido({ valor_unitario: 3.6 }), itemConhecido({ entrada_estoque: null }), itemConhecido({ sugestao_produto: { id: '999' } })]), catalogo())
    expect((await screen.findAllByTestId('item-conhecido'))).toHaveLength(3)
    expect(screen.queryByTestId('preco-fora-do-normal-resumo')).not.toBeInTheDocument()
  })

  it('a lista de produtos ainda carregando: calado', async () => {
    mostrar(cupom([itemConhecido()]), null)
    await screen.findByTestId('item-conhecido')
    expect(screen.queryByTestId('preco-fora-do-normal-resumo')).not.toBeInTheDocument()
  })
})
