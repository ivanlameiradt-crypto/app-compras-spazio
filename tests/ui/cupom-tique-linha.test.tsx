import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import CorrigirCupom from '../../src/admin/CorrigirCupom'
import type { CupomRecente, ItemCupomRecente, ProdutoCatalogo } from '../../src/lib/tipos'

// Pedido do Ivan (05/11/2026, cupom da A. N. da Silva): "se o valor da linha bater com o que está no cupom fiscal, um tique verde ao lado da informação de quanto entra no estoque".
// O tique confere o VALOR da linha (o que o Ivan confirmou, depois da conversão) com o que o robô leu na foto, mas só quando a leitura do cupom inteiro fecha o total impresso.
vi.mock('../../src/lib/api')
beforeEach(() => { vi.resetAllMocks() })

const pendente = (descricao_cupom: string, unidade_cupom: string, valor_unitario: number, quantidade_cupom: number | null): ItemCupomRecente => ({
  descricao_cupom, unidade_cupom, valor_unitario, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, quantidade_cupom, proposta: null,
})
const CANUDO_CASADO: ItemCupomRecente = {
  descricao_cupom: 'CANUDO BIO MASTER ENVEL. SACHE ULTRA 100UND', unidade_cupom: 'UN', valor_unitario: 7.8, desconto_item: 0, entrada_estoque: 1, sugestao_produto: { id: '3836906' },
  casado_por: 'descricao', quantidade_cupom: 1, proposta: null,
}
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: 3956705, nome: 'SACO 19X37 2KG - INSUMOS', unidade: 'un' },
  { produto_id: 3466666, nome: 'FITA ADESIVA TRANSPARENTE - INSUMOS', unidade: 'un' },
  { produto_id: 3836906, nome: 'CANUDO P/ MILK SHAKE - INSUMO (UN)', unidade: 'un' },
]
const SACO = pendente('SACO 19X37 2KG AD FONTEPLAST', 'ML', 42.8, 3)   // 3 ML × 42,80 = 128,40
const FITA = pendente('FITA PP TRANSP 18X50 FITAR', 'UN', 1.85, 14)     // 25,90
const cupom = (itens: ItemCupomRecente[], valor_a_pagar: number | null): CupomRecente => ({
  id: 'c1', estado: 'REVISAR', emitente_nome: 'A. N. DA SILVA DESCARTAVEIS LTDA', emitente_cnpj: '63540861000182', valor_a_pagar, pedido_sischef: null,
  criado_em: '2026-11-04T17:09:00Z', motivo: '2 item(ns) sem casamento confirmado — confira no Code', teste: false, itens,
})
const FECHA = cupom([SACO, FITA, CANUDO_CASADO], 162.1)   // 128,40 + 25,90 + 7,80
const tela = (c: CupomRecente) => render(<CorrigirCupom cupom={c} catalogo={CATALOGO} catalogoFalhou={false} aoReenviar={vi.fn()} />)
const itens = () => screen.getAllByTestId('corrigir-item')

/** Abre o item `i`, procura pelo texto e escolhe o primeiro produto achado (a caixa vem fechada; a busca é o caminho que o Ivan faz). */
async function escolherProduto(i: number, busca: string) {
  await userEvent.click(within(itens()[i]).getByTestId('item-cabecalho'))
  await userEvent.type(within(itens()[i]).getByLabelText('Produto do SisChef'), busca)
  await userEvent.click(within(within(itens()[i]).getByTestId('achados')).getAllByRole('button')[0])
}
const entrada = (i: number) => within(itens()[i]).getByLabelText(/Quanto entra no estoque/)
/** O parágrafo "Linha: 3 ml × R$ 42,80 = R$ 128,40 · entra 30 un no estoque" (o valor está num <b>, então o texto vem quebrado em vários elementos). */
const fraseDaLinha = (i: number) => within(itens()[i]).getByText((_c, el) => el?.tagName === 'P' && /^\s*Linha: 3 ml × R\$\s42,80 = R\$\s128,40/.test(el.textContent ?? ''))

describe('tique da linha: o valor que o Ivan confirmou é o que o robô leu na foto', () => {
  it('o caso do Ivan: 3 ML que entram como 30 un valem R$ 128,40 e a leitura fecha o total: tique verde ao lado de "entra 30 un no estoque", com a frase que explica', async () => {
    tela(FECHA)
    await escolherProduto(0, 'saco 19x37')
    expect(within(itens()[0]).queryByTestId('linha-confere')).not.toBeInTheDocument()   // ainda não disse quanto entra: nem a linha existe
    await userEvent.type(entrada(0), '30')
    const caixa = itens()[0]
    expect(within(caixa).getByText(/entra 30 un no estoque/)).toBeInTheDocument()
    const tique = within(caixa).getByTestId('linha-confere')
    expect(tique).toHaveTextContent('bate com o cupom')
    // o ✓ é desenhado pelo CSS: no texto da tela o ✓ quer dizer "item confirmado pelo Ivan" (as outras telas e os testes do cupom usam isso para saber se o item foi confirmado)
    expect(within(caixa).queryByText(/✓/)).not.toBeInTheDocument()
    expect(within(caixa).getByTestId('linha-confere-explica')).toHaveTextContent(/O robô leu R\$\s128,40 nesta linha na foto/)
    expect(within(caixa).getByTestId('linha-confere-explica')).toHaveTextContent(/fecha o total do cupom \(R\$\s162,10\)/)
    expect(within(caixa).queryByTestId('linha-diferente')).not.toBeInTheDocument()
    // o tique mora na MESMA frase da linha, ao lado do "entra 30 un no estoque"
    expect(tique.closest('p')).toHaveTextContent(/Linha: 3 ml × R\$\s42,80 = R\$\s128,40 · entra 30 un no estoque\s*bate com o cupom/)
  })

  it('o valor NÃO depende do "30": entrando 20 ou 300 o valor da linha é o mesmo, e o tique só fala do dinheiro (a conversão em si o app não tem como conferir)', async () => {
    tela(FECHA)
    await escolherProduto(0, 'saco 19x37')
    await userEvent.type(entrada(0), '300')
    expect(within(itens()[0]).getByTestId('linha-confere')).toBeInTheDocument()
  })

  it('o Ivan troca a quantidade do cupom (3 → 30): o valor passa de R$ 128,40 para R$ 1.284,00, o tique some e aparece o aviso amarelo com os dois valores', async () => {
    tela(FECHA)
    await escolherProduto(0, 'saco 19x37')
    await userEvent.type(entrada(0), '30')
    const quantidade = within(itens()[0]).getByLabelText(/que está no cupom/)
    await userEvent.clear(quantidade)
    await userEvent.type(quantidade, '30')
    expect(within(itens()[0]).queryByTestId('linha-confere')).not.toBeInTheDocument()
    expect(within(itens()[0]).queryByTestId('linha-confere-explica')).not.toBeInTheDocument()
    const aviso = within(itens()[0]).getByTestId('linha-diferente')
    expect(aviso).toHaveTextContent(/O robô leu R\$\s128,40 nesta linha na foto e aqui deu R\$\s1\.284,00/)
    expect(aviso).toHaveTextContent('Confira a quantidade')
    // só avisa: o botão de confirmar continua à mão (quem decide é o Ivan; a soma do cupom é a trava no fim)
    expect(within(itens()[0]).getByRole('button', { name: 'Confirmar este item' })).toBeEnabled()
  })

  it('a leitura do cupom NÃO fecha o total (R$ 170,00 em vez de 162,10): sem tique e sem aviso (a leitura não serve de régua)', async () => {
    tela(cupom([SACO, FITA, CANUDO_CASADO], 170))
    await escolherProduto(0, 'saco 19x37')
    await userEvent.type(entrada(0), '30')
    expect(fraseDaLinha(0)).toBeInTheDocument()   // a linha continua aparecendo como sempre
    expect(within(itens()[0]).queryByTestId('linha-confere')).not.toBeInTheDocument()
    expect(within(itens()[0]).queryByTestId('linha-diferente')).not.toBeInTheDocument()
  })

  it('cupom antigo, sem a quantidade lida na foto: o campo vem vazio, o Ivan digita 3 e não há tique nem aviso (nada a conferir)', async () => {
    tela(cupom([{ ...SACO, quantidade_cupom: null }, FITA, CANUDO_CASADO], 162.1))
    await escolherProduto(0, 'saco 19x37')
    await userEvent.type(within(itens()[0]).getByLabelText(/que está no cupom/), '3')
    await userEvent.type(entrada(0), '30')
    expect(fraseDaLinha(0)).toBeInTheDocument()
    expect(within(itens()[0]).queryByTestId('linha-confere')).not.toBeInTheDocument()
    expect(within(itens()[0]).queryByTestId('linha-diferente')).not.toBeInTheDocument()
  })

  it('sem total lido no cupom: sem tique e sem aviso', async () => {
    tela(cupom([SACO, FITA, CANUDO_CASADO], null))
    await escolherProduto(0, 'saco 19x37')
    await userEvent.type(entrada(0), '30')
    expect(within(itens()[0]).queryByTestId('linha-confere')).not.toBeInTheDocument()
    expect(within(itens()[0]).queryByTestId('linha-diferente')).not.toBeInTheDocument()
  })

  it('sem conversão (cupom em UN e produto em UN): o tique também aparece, logo depois de escolher o produto, ao lado do valor da linha', async () => {
    tela(FECHA)
    await escolherProduto(1, 'fita adesiva')
    const tique = within(itens()[1]).getByTestId('linha-confere')
    expect(tique.closest('p')).toHaveTextContent(/Linha: 14 un × R\$\s1,85 = R\$\s25,90\s*bate com o cupom/)
    expect(within(itens()[1]).getByTestId('linha-confere-explica')).toHaveTextContent(/O robô leu R\$\s25,90/)
  })
})
