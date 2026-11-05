import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import CorrigirCupom from '../../src/admin/CorrigirCupom'
import type { CupomRecente, ItemCupomRecente, ProdutoCatalogo } from '../../src/lib/tipos'

// Pedido do Ivan (04/11/2026, cupom da A. N. da Silva): "Tivesse um botão de abrir e fechar" em CADA item da tela "Confirmar os itens deste cupom": aberto, a caixa de preencher
// aparece; apertando de novo, fecha. A revisão independente (I3) exigiu que fechar NÃO desmonte a caixa (o cadastro de produto em andamento e o que foi digitado não se perdem).
vi.mock('../../src/lib/api')
const m = vi.mocked(api)
beforeEach(() => { vi.resetAllMocks() })

const item = (descricao_cupom: string, valor_unitario: number, quantidade_cupom: number): ItemCupomRecente => ({
  descricao_cupom, unidade_cupom: 'KG', valor_unitario, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, quantidade_cupom, proposta: null,
})
const CATALOGO: ProdutoCatalogo[] = [
  { produto_id: 3484974, nome: 'LIMÃO SICILIANO - INSUMOS', unidade: 'kg' },
  { produto_id: 3484991, nome: 'PEPINO JAPONÊS - INSUMOS', unidade: 'kg' },
  { produto_id: 3469643, nome: 'LIMÃO - INSUMOS', unidade: 'kg' },
]
const CUPOM: CupomRecente = {
  id: 'c1', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 21.76, pedido_sischef: null, criado_em: '2026-11-04T12:00:00Z',
  motivo: '3 item(ns) sem casamento confirmado — confira no Code', teste: false,
  itens: [item('LIMAO SICILIANO', 13.9, 0.5), item('PEPINO JAPONES', 5.79, 0.912), item('TOMATE ITALIANO', 4.5, 1)],
}
const tela = (cupom: CupomRecente = CUPOM, catalogo: ProdutoCatalogo[] = CATALOGO) =>
  render(<CorrigirCupom cupom={cupom} catalogo={catalogo} catalogoFalhou={false} aoReenviar={vi.fn()} />)
const cabecalhos = () => screen.getAllByTestId('item-cabecalho')
const itens = () => screen.getAllByTestId('corrigir-item')
const corpoDe = (i: number) => within(itens()[i]).getByTestId('item-corpo')

describe('CorrigirCupom — abrir e fechar cada item (E1)', () => {
  it('cada item pendente começa FECHADO: só o cabeçalho (descrição, preço, "falta escolher o produto"), sem a caixa de busca', () => {
    tela()
    expect(cabecalhos()).toHaveLength(3)
    for (const c of cabecalhos()) expect(c).toHaveAttribute('aria-expanded', 'false')
    expect(cabecalhos()[0]).toHaveTextContent(/LIMAO SICILIANO · R\$\s13,90 por KG/)
    expect(cabecalhos()[0]).toHaveTextContent('falta escolher o produto')
    expect(screen.queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()   // a caixa nem foi montada: não consulta nada à toa
    expect(screen.queryAllByTestId('produto-nao-cadastrado')).toHaveLength(0)
  })

  it('tocar abre o item (aria-expanded e a caixa aparecem) e tocar de novo fecha', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    expect(cabecalhos()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(within(itens()[0]).getByLabelText('Produto do SisChef')).toBeVisible()
    expect(corpoDe(0)).toBeVisible()
    await userEvent.click(cabecalhos()[0])
    expect(cabecalhos()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(within(itens()[0]).getByLabelText('Produto do SisChef')).not.toBeVisible()   // continua no documento, só escondida (I3)
  })

  it('I3: fechar NÃO apaga o que foi digitado nem desmonta o cadastro de produto: ao abrir de novo está tudo lá', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    await userEvent.type(within(itens()[0]).getByLabelText('Produto do SisChef'), 'pepi')
    await userEvent.click(within(itens()[0]).getByTestId('abrir-cadastro-produto'))
    expect(within(itens()[0]).getByTestId('cadastrar-produto')).toBeInTheDocument()
    await userEvent.type(within(itens()[0]).getByTestId('palavras-produto'), ' teste')
    await userEvent.click(cabecalhos()[0])                       // fecha
    expect(within(itens()[0]).getByTestId('cadastrar-produto')).not.toBeVisible()
    await userEvent.click(cabecalhos()[0])                       // abre de novo
    expect(within(itens()[0]).getByLabelText('Produto do SisChef')).toHaveValue('pepi')
    expect(within(itens()[0]).getByTestId('cadastrar-produto')).toBeVisible()
    expect((within(itens()[0]).getByTestId('palavras-produto') as HTMLInputElement).value).toContain('teste')   // o que ele digitou no cadastro continua lá
  })

  // Revisão independente do PR 69: o REVISAR NÃO é retomado pela tela (o pedido de cadastro só volta se não estiver em REVISAR), então se a caixa fosse desmontada ao fechar o aviso
  // vermelho, o código e o "Tentar de novo" sumiriam. Aqui o MESMO elemento volta à vista e o pedido não é refeito.
  it('I3 no REVISAR: o aviso vermelho do cadastro continua lá (o mesmo elemento) depois de fechar e abrir o item, sem pedir o cadastro de novo', async () => {
    const agora = new Date().toISOString()
    m.pedirCadastroProduto.mockResolvedValue({ cadastro_id: 'p1' })
    m.statusDoCadastroProduto.mockResolvedValue({
      id: 'p1', estado: 'REVISAR', produto_id: 3476468, candidatos: [], descricao: 'TOMATE ITALIANO - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'UN', criado_em: agora, atualizado_em: agora,
      motivo: 'a unidade do produto no SisChef é CX; a lista do app só aceita KG, UN, CT ou PCT — confira o produto 3476468 no SisChef',
    })
    tela()
    await userEvent.click(cabecalhos()[2])                       // o TOMATE: nada na lista casa
    await userEvent.click(within(itens()[2]).getByTestId('abrir-cadastro-produto'))
    await userEvent.selectOptions(within(itens()[2]).getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.selectOptions(within(itens()[2]).getByTestId('unidade-produto'), 'UN')
    await userEvent.click(within(itens()[2]).getByTestId('cadastrar-produto-botao'))
    const aviso = await within(itens()[2]).findByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('Este produto JÁ EXISTE no SisChef (código 3476468)')
    await userEvent.click(cabecalhos()[2])                       // fecha
    expect(aviso).not.toBeVisible()
    await userEvent.click(cabecalhos()[2])                       // abre de novo
    expect(within(itens()[2]).getByTestId('produto-revisar')).toBe(aviso)
    expect(aviso).toBeVisible()
    expect(within(itens()[2]).getByTestId('tentar-de-novo')).toBeEnabled()
    expect(m.pedirCadastroProduto).toHaveBeenCalledTimes(1)
  })

  it('vários itens podem ficar abertos ao mesmo tempo (abrir um não fecha o outro)', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    await userEvent.click(cabecalhos()[1])
    expect(cabecalhos()[0]).toHaveAttribute('aria-expanded', 'true')
    expect(cabecalhos()[1]).toHaveAttribute('aria-expanded', 'true')
    expect(cabecalhos()[2]).toHaveAttribute('aria-expanded', 'false')
    expect(within(itens()[0]).getByLabelText('Produto do SisChef')).toBeVisible()
    expect(within(itens()[1]).getByLabelText('Produto do SisChef')).toBeVisible()
    expect(screen.queryAllByTestId('produto-nao-cadastrado')).toHaveLength(2)         // só os itens abertos montaram a caixa
  })

  it('aria-controls do cabeçalho aponta para o corpo do item, que existe desde o início e fica escondido (hidden) enquanto fechado', async () => {
    tela()
    const c = cabecalhos()[1]
    const id = c.getAttribute('aria-controls')
    expect(id).toBeTruthy()
    expect(document.getElementById(id as string)).toBe(corpoDe(1))
    expect(corpoDe(1)).toHaveAttribute('hidden')
    await userEvent.click(c)
    expect(corpoDe(1)).not.toHaveAttribute('hidden')
  })

  it('o cabeçalho mostra o andamento SEM abrir: depois de escolher o produto diz "<produto> · falta confirmar"; confirmado, o item sai da lista', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    await userEvent.type(within(itens()[0]).getByLabelText('Produto do SisChef'), 'siciliano')
    await userEvent.click(within(within(itens()[0]).getByTestId('achados')).getByRole('button'))
    await userEvent.click(cabecalhos()[0])                       // fecha
    expect(cabecalhos()[0]).toHaveTextContent('LIMÃO SICILIANO - INSUMOS · falta confirmar')
    await userEvent.click(cabecalhos()[0])                       // abre: a quantidade lida do cupom já vem preenchida
    await userEvent.click(within(itens()[0]).getByRole('button', { name: 'Confirmar este item' }))
    expect(itens()).toHaveLength(2)                              // confirmado sai da lista e vai para o resumo do fim, como antes
    expect(screen.getByTestId('corrigir-progresso')).toHaveTextContent('Faltam confirmar 2 de 3 itens.')
  })
})

describe('CorrigirCupom — texto da busca: o app diz onde procurou (pergunta do Ivan, 04/11: "por que o app não puxa esses itens?")', () => {
  it('diz em quantos produtos da sua lista procura (os escondidos não contam)', async () => {
    tela(CUPOM, [...CATALOGO, { produto_id: 1, nome: 'RECEITA X', unidade: 'kg', oculto: true }])
    await userEvent.click(cabecalhos()[0])
    expect(within(itens()[0]).getByTestId('busca-tamanho')).toHaveTextContent('Procurando entre 3 produtos da sua lista.')
  })

  it('quando nada acha, lembra que produto do SisChef em CX/RL (unidade que o app não conhece) não aparece aqui, e diz a saída', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    await userEvent.type(within(itens()[0]).getByLabelText('Produto do SisChef'), 'xyzxyz')
    const aviso = within(itens()[0]).getByTestId('nada-achado')
    expect(aviso).toHaveTextContent('Nada na sua lista de insumos com isso.')
    expect(aviso).toHaveTextContent(/CX|RL/)
    expect(aviso).toHaveTextContent('Cadastrar produto novo')
  })
})

describe('CorrigirCupom — "Outras opções" com espaço entre as opções (E3 e)', () => {
  it('as alternativas da sugestão fraca vêm separadas por " · " (antes saíam coladas umas nas outras)', async () => {
    const alhos: ProdutoCatalogo[] = [
      { produto_id: 1, nome: 'ALHO COMUM DESCASCADO - INSUMOS (KG)', unidade: 'kg' }, { produto_id: 2, nome: 'MOLHO DE ALHO - INSUMOS (KG)', unidade: 'kg' },
      { produto_id: 3, nome: 'PASTA DE ALHO NEGRO - INSUMOS (KG)', unidade: 'kg' },
    ]
    tela({ ...CUPOM, itens: [item('ALHO Kg A GRANEL', 20, 1)] }, alhos)
    await userEvent.click(cabecalhos()[0])
    const outras = within(itens()[0]).getByTestId('outras-opcoes')
    expect(outras.textContent).toMatch(/^Outras opções:\s+\S.* · \S.*/)
    expect(within(outras).getAllByRole('button').length).toBeGreaterThanOrEqual(2)
  })
})

// Se a tela some e volta (confirmar um item muda o resto da lista), o estado de abrir/fechar de cada item continua o do item, não o da posição na tela
describe('CorrigirCupom — o aberto/fechado acompanha o ITEM, não a posição', () => {
  it('confirmar o 1º item não fecha nem abre os outros', async () => {
    tela()
    await userEvent.click(cabecalhos()[0])
    await userEvent.click(cabecalhos()[2])
    await userEvent.type(within(itens()[0]).getByLabelText('Produto do SisChef'), 'siciliano')
    await userEvent.click(within(within(itens()[0]).getByTestId('achados')).getByRole('button'))
    await userEvent.click(within(itens()[0]).getByRole('button', { name: 'Confirmar este item' }))
    await waitFor(() => expect(itens()).toHaveLength(2))
    // sobraram o PEPINO (fechado) e o TOMATE (aberto)
    expect(cabecalhos()[0]).toHaveTextContent('PEPINO JAPONES')
    expect(cabecalhos()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(cabecalhos()[1]).toHaveTextContent('TOMATE ITALIANO')
    expect(cabecalhos()[1]).toHaveAttribute('aria-expanded', 'true')
  })
})
