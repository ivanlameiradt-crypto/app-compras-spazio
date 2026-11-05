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
    expect(corpo.itens).toEqual([{ produto_id: 1001, quantidade: 12.5, preco: 8.9, descricao: 'TOMATE ITALIANO OU SALADETE - INSUMOS' }])   // o nome vai junto: a compra o guarda
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

  it('o detalhe mostra o nome guardado na compra quando o produto não está na lista do app (nunca só o código)', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ itens: [{ descricao_cupom: 'EMBALAGEM P/ PIZZA N. 35 - INSUMOS', entrada_estoque: 1, unidade_cupom: null, valor_unitario: 2, desconto_item: 0, sugestao_produto: { id: '3862312' }, casado_por: null }] })])
    render(<CompraAvulsa />)
    const linha = (await screen.findAllByTestId('compra-recente'))[0]
    await userEvent.click(within(linha).getByRole('button', { name: /lançada/ }))
    expect(linha).toHaveTextContent('EMBALAGEM P/ PIZZA N. 35 - INSUMOS')
    expect(linha).not.toHaveTextContent('Produto 3862312')
  })
  describe('produto novo (cadastrar pelo app, pedido do Ivan de 13/10)', () => {
    beforeEach(() => { m.statusDoCadastroProduto.mockResolvedValue(null) })

    it('nada na lista com o que ele digitou: avisa "não cadastrado" com o botão', async () => {
      render(<CompraAvulsa />)
      await userEvent.type(screen.getByTestId('busca-produto'), 'maionese hellmanns 3kg')
      expect(await screen.findByTestId('aviso-nao-cadastrado')).toHaveTextContent('Não identifiquei este item')
      expect(screen.getByTestId('abrir-cadastro-produto')).toBeInTheDocument()
    })

    it('com resultados na busca: sem aviso amarelo, mas o botão "Não é nenhum destes?" continua à mão', async () => {
      render(<CompraAvulsa />)
      await userEvent.type(screen.getByTestId('busca-produto'), 'tomate')
      expect(await screen.findByTestId('achados')).toBeInTheDocument()
      expect(screen.queryByTestId('aviso-nao-cadastrado')).not.toBeInTheDocument()
      expect(screen.getByTestId('abrir-cadastro-produto')).toHaveTextContent('Não é nenhum destes?')
    })

    it('a lista de produtos não carregou: avisa o erro e NÃO oferece cadastrar (não dá para saber se o produto existe)', async () => {
      m.catalogoProdutos.mockRejectedValue(new Error('rede'))
      render(<CompraAvulsa />)
      await userEvent.type(screen.getByTestId('busca-produto'), 'maionese')
      expect(await screen.findByText('Não consegui carregar a lista de produtos. Atualize a página.')).toBeInTheDocument()
      expect(screen.queryByTestId('abrir-cadastro-produto')).not.toBeInTheDocument()
    })

    it('cadastrado: "Usar este produto" põe o produto na linha, na unidade da lista, pedindo quantidade e preço', async () => {
      m.pedirCadastroProduto.mockResolvedValue({ cadastro_id: 'ped-1' })
      m.statusDoCadastroProduto.mockImplementation(async (q) => ('id' in q ? { id: 'ped-1', estado: 'CADASTRADO', produto_id: 3924999, motivo: null, candidatos: [],
        descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', criado_em: '2026-10-14T12:00:00Z', atualizado_em: '2026-10-14T12:02:00Z' } : null))
      render(<CompraAvulsa />)
      await userEvent.type(screen.getByTestId('busca-produto'), 'maionese hellmanns 3kg')
      await userEvent.click(await screen.findByTestId('abrir-cadastro-produto'))
      await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
      await userEvent.selectOptions(screen.getByTestId('unidade-produto'), 'KG')
      await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
      expect(m.pedirCadastroProduto).toHaveBeenCalledWith(expect.objectContaining({ origem: 'avulsa', unidade: 'KG' }))
      await userEvent.click(await screen.findByTestId('usar-produto-novo'))
      expect(screen.getByTestId('produto-escolhido')).toHaveTextContent('MAIONESE HELLMANNS 3KG - INSUMOS')
      expect(screen.getByTestId('produto-escolhido')).toHaveTextContent('entra em KG')
      expect(screen.getByTestId('quantidade-avulsa')).toBeInTheDocument()
    })
  })
})

describe('CompraAvulsa — excluir a compra que não vai lançar (pedido do Ivan, 03/11/2026)', () => {
  it('"Excluir compra" aparece só na compra que precisa de você (não na que está na fila, nem na lançada, nem na que parou no meio do SisChef)', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([
      recente({ id: 'p1', estado: 'PENDENTE', pedido_sischef: null }),
      recente({ id: 'p2', estado: 'REVISAR', pedido_sischef: null, motivo: 'fornecedor não encontrado no Sischef' }),
      recente({ id: 'p3' }),                                                                 // LANCADO com pedido
      recente({ id: 'p4', estado: 'PROCESSANDO', pedido_sischef: null }),
      recente({ id: 'p5', estado: 'REVISAR', pedido_sischef: null, motivo: 'falha ao preencher o pagamento no Sischef: campo não achado' }),
    ])
    render(<CompraAvulsa />)
    const linhas = await screen.findAllByTestId('compra-recente')
    expect(linhas).toHaveLength(5)
    expect(linhas.map((l) => within(l).queryByTestId('excluir-cupom') !== null)).toEqual([false, true, false, false, false])
    expect(within(linhas[1]).getByTestId('excluir-cupom')).toHaveTextContent('Excluir compra')
  })

  it('excluir em 2 toques: a pergunta fala em compra avulsa, o motivo vai ao banco, a compra vai para "Compras excluídas" e "Voltar para a lista" a devolve', async () => {
    const c = recente({ id: 'p2', estado: 'REVISAR', pedido_sischef: null, motivo: 'fornecedor não encontrado no Sischef' })
    m.comprasAvulsasRecentes.mockResolvedValueOnce([c]).mockResolvedValueOnce([]).mockResolvedValue([c])
    m.cuponsExcluidos.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...c, estado: 'EXCLUIDO', excluido_motivo: 'compra errada', excluido_em: '2026-11-03T13:00:00Z' }]).mockResolvedValue([])
    m.excluirCupom.mockResolvedValue(undefined)
    m.restaurarCupom.mockResolvedValue(undefined)
    render(<CompraAvulsa />)
    const linha = await screen.findByTestId('compra-recente')
    await userEvent.click(within(linha).getByTestId('excluir-cupom'))
    const pergunta = within(linha).getByTestId('confirmar-exclusao-cupom')
    expect(pergunta).toHaveTextContent('Excluir esta compra avulsa de ATACADÃO?')
    expect(pergunta).toHaveTextContent('Não muda nada no SisChef')
    expect(pergunta).toHaveTextContent('Dá para desfazer em “Compras excluídas”')
    await userEvent.type(within(pergunta).getByLabelText('Motivo (opcional)'), 'compra errada')
    await userEvent.click(within(pergunta).getByRole('button', { name: 'Excluir' }))
    expect(m.excluirCupom).toHaveBeenCalledWith('p2', 'compra errada')
    expect(m.cuponsExcluidos).toHaveBeenCalledWith('avulsa')                              // a lista das excluídas é a das compras avulsas
    await waitFor(() => expect(screen.queryByTestId('compra-recente')).not.toBeInTheDocument())
    const secao = await screen.findByTestId('cupons-excluidos')
    expect(secao).toHaveTextContent('Compras excluídas (1)')
    expect(within(secao).getByTestId('cupom-excluido')).toHaveTextContent('ATACADÃO')
    expect(within(secao).getByTestId('cupom-excluido')).toHaveTextContent('Motivo: compra errada')
    await userEvent.click(within(secao).getByRole('button', { name: 'Voltar para a lista' }))
    expect(m.restaurarCupom).toHaveBeenCalledWith('p2')
    expect(await screen.findByTestId('compra-recente')).toBeInTheDocument()
  })

  it('o banco recusa: a mensagem aparece e a compra continua na lista; falha ao ler as excluídas não derruba a lista', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'p2', estado: 'REVISAR', pedido_sischef: null, motivo: 'fornecedor não encontrado no Sischef' })])
    m.cuponsExcluidos.mockRejectedValue(new Error('sem rede'))
    m.excluirCupom.mockRejectedValue(new Error('Este cupom já foi lançado no SisChef: para desfazer, cancele a entrada lá.'))
    render(<CompraAvulsa />)
    const linha = await screen.findByTestId('compra-recente')
    await userEvent.click(within(linha).getByTestId('excluir-cupom'))
    await userEvent.click(within(linha).getByRole('button', { name: 'Excluir' }))
    expect(await within(linha).findByRole('alert')).toHaveTextContent('já foi lançado no SisChef')
    expect(screen.getByTestId('compra-recente')).toBeInTheDocument()
    expect(screen.queryByTestId('cupons-excluidos')).not.toBeInTheDocument()
  })
})

// ---------- E5: compra repetida (pedido do Ivan, 04/11/2026). Na compra avulsa o servidor recusa com 409 "POSSÍVEL REPETIDA: …" ANTES de gravar: a tela mostra o aviso (frase em português simples) com
// "É outra compra: lançar mesmo assim" (reenvia o MESMO envio com outra_compra: true) e "Cancelar" (o formulário continua como está). Nas "Últimas compras avulsas" o cartão parado pelo aviso do robô
// mostra o mesmo aviso com os dois botões.
describe('CompraAvulsa — compra repetida (E5)', () => {
  const FRASE = 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 111,25): cupom de 03/10, lançado no SisChef (pedido 163377089).'
  const TEXTO = 'Já existe compra deste fornecedor com o mesmo total (R$ 111,25): cupom de 03/10, lançado no SisChef (pedido 163377089).'
  async function enviarAteRecusar() {
    await preencher()
    await userEvent.click(screen.getByTestId('lancar-avulsa'))
    await userEvent.click(screen.getByTestId('confirmar-lancamento'))
  }

  it('o servidor recusa por repetida: mostra o aviso com a frase, NÃO limpa o que foi digitado, e não mostra como erro vermelho', async () => {
    m.enviarCompraAvulsa.mockRejectedValue(new Error(FRASE))
    await enviarAteRecusar()
    const aviso = await screen.findByTestId('aviso-repetida-avulsa')
    expect(aviso).toHaveTextContent('Parece repetida')
    expect(aviso).toHaveTextContent(TEXTO)
    expect(aviso).not.toHaveTextContent('POSSÍVEL REPETIDA')
    expect(within(aviso).getByRole('button', { name: 'É outra compra: lançar mesmo assim' })).toBeEnabled()
    expect(within(aviso).getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(screen.queryByTestId('erro-avulsa')).not.toBeInTheDocument()
    expect(screen.getByTestId('total-geral')).toHaveTextContent('R$ 111,25')           // o formulário continua como estava
    expect(screen.getByTestId('quantidade-avulsa')).toHaveValue('12,5')
  })

  it('"É outra compra: lançar mesmo assim" reenvia o MESMO envio (mesmo envio_id e itens) com outra_compra: true e, aceito, limpa e avisa como sempre', async () => {
    m.enviarCompraAvulsa.mockRejectedValueOnce(new Error(FRASE))
    await enviarAteRecusar()
    const primeiro = m.enviarCompraAvulsa.mock.calls[0][0]
    expect(primeiro).not.toHaveProperty('outra_compra')
    await userEvent.click(within(await screen.findByTestId('aviso-repetida-avulsa')).getByRole('button', { name: 'É outra compra: lançar mesmo assim' }))
    await waitFor(() => expect(m.enviarCompraAvulsa).toHaveBeenCalledTimes(2))
    const segundo = m.enviarCompraAvulsa.mock.calls[1][0]
    expect(segundo).toEqual({ ...primeiro, outra_compra: true })
    expect(segundo.envio_id).toBe(primeiro.envio_id)
    expect(await screen.findByTestId('resultado-avulsa')).toHaveTextContent('Compra enviada')
    expect(screen.queryByTestId('aviso-repetida-avulsa')).not.toBeInTheDocument()
    expect(screen.getByTestId('total-geral')).toHaveTextContent('R$ 0,00')              // formulário limpo para a próxima
  })

  it('"Cancelar" some com o aviso e deixa tudo como está (nada é enviado de novo)', async () => {
    m.enviarCompraAvulsa.mockRejectedValue(new Error(FRASE))
    await enviarAteRecusar()
    await userEvent.click(within(await screen.findByTestId('aviso-repetida-avulsa')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByTestId('aviso-repetida-avulsa')).not.toBeInTheDocument()
    expect(m.enviarCompraAvulsa).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('total-geral')).toHaveTextContent('R$ 111,25')
    expect(screen.getByTestId('lancar-avulsa')).toBeEnabled()
  })

  it('mexer na compra (trocar a quantidade) apaga o aviso: ele já não descreve o que está na tela', async () => {
    m.enviarCompraAvulsa.mockRejectedValue(new Error(FRASE))
    await enviarAteRecusar()
    await screen.findByTestId('aviso-repetida-avulsa')
    await userEvent.type(screen.getByTestId('quantidade-avulsa'), '0')
    expect(screen.queryByTestId('aviso-repetida-avulsa')).not.toBeInTheDocument()
  })

  it('o reenvio "é outra compra" que também falha (sem internet): mostra o erro e o aviso continua à mão para tentar de novo', async () => {
    m.enviarCompraAvulsa.mockRejectedValueOnce(new Error(FRASE)).mockRejectedValueOnce(new Error('Failed to send a request'))
    await enviarAteRecusar()
    await userEvent.click(within(await screen.findByTestId('aviso-repetida-avulsa')).getByRole('button', { name: 'É outra compra: lançar mesmo assim' }))
    expect(await screen.findByTestId('erro-avulsa')).toHaveTextContent('Failed to send a request')
    expect(screen.getByTestId('aviso-repetida-avulsa')).toBeInTheDocument()
  })

  it('erro que NÃO é de repetida (o 503 de "não consegui conferir", a soma…) continua erro vermelho, sem botão de "é outra compra"', async () => {
    m.enviarCompraAvulsa.mockRejectedValue(new Error('Não consegui conferir se esta compra é repetida agora. Tente de novo em instantes.'))
    await enviarAteRecusar()
    expect(await screen.findByTestId('erro-avulsa')).toHaveTextContent('Tente de novo em instantes')
    expect(screen.queryByTestId('aviso-repetida-avulsa')).not.toBeInTheDocument()
  })

  it('nas "Últimas compras avulsas": o cartão parado pelo aviso do robô mostra o aviso com os dois botões; "É outra compra" chama a decisão e recarrega', async () => {
    m.comprasAvulsasRecentes.mockResolvedValueOnce([recente({ id: 'r9', estado: 'REVISAR', pedido_sischef: null, motivo: FRASE })])
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'r9', estado: 'PENDENTE', pedido_sischef: null, motivo: null })])
    m.cuponsExcluidos.mockResolvedValue([])
    m.confirmarOutraCompra.mockResolvedValue({ cupom_id: 'r9', estado: 'PENDENTE', resumo: 'confirmado como outra compra e enviado para lançar', disparo_ok: true })
    render(<CompraAvulsa />)
    const aviso = await screen.findByTestId('aviso-repetida')
    expect(aviso).toHaveTextContent(TEXTO)
    expect(screen.queryByTestId('motivo-recente')).not.toBeInTheDocument()            // o aviso tem o bloco próprio: o motivo cru não repete
    expect(within(aviso).getByTestId('excluir-cupom')).toHaveTextContent('É o mesmo: excluir este envio')
    await userEvent.click(within(aviso).getByRole('button', { name: 'É outra compra: lançar mesmo assim' }))
    expect(m.confirmarOutraCompra).toHaveBeenCalledWith('r9')
    await waitFor(() => expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument())
    expect(await screen.findByText(/na fila/)).toBeInTheDocument()
  })

  it('compra parada por OUTRO motivo continua mostrando o motivo cru (sem aviso de repetida)', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'r8', estado: 'REVISAR', pedido_sischef: null, motivo: 'forma de pagamento ausente' })])
    m.cuponsExcluidos.mockResolvedValue([])
    render(<CompraAvulsa />)
    expect(await screen.findByTestId('motivo-recente')).toHaveTextContent('forma de pagamento ausente')
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
  })
})

// ---------- ajuste 2 da revisão do código (05/11): nas "Últimas compras avulsas", a compra parada porque o robô NÃO conseguiu conferir se é repetida mostra "Tentar de novo" (e não o texto técnico).
describe('CompraAvulsa — "não consegui conferir": Tentar de novo (E5, ajuste 2)', () => {
  const FALHA = 'CONFERÊNCIA DE REPETIDA FALHOU: não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef).'
  it('compra parada pela falha do robô: mostra o aviso próprio com "Tentar de novo" (sem o motivo cru); o toque chama a conferência e recarrega a lista', async () => {
    m.comprasAvulsasRecentes.mockResolvedValueOnce([recente({ id: 'r7', estado: 'REVISAR', pedido_sischef: null, motivo: FALHA })])
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'r7', estado: 'PENDENTE', pedido_sischef: null, motivo: null })])
    m.cuponsExcluidos.mockResolvedValue([])
    m.tentarConferirDeNovo.mockResolvedValue({ cupom_id: 'r7', estado: 'PENDENTE', resumo: 'conferido de novo e enviado para lançar', disparo_ok: true })
    render(<CompraAvulsa />)
    const b = await screen.findByTestId('aviso-falha-conferir')
    expect(b).toHaveTextContent('Não consegui conferir se esta compra já foi lançada')
    expect(b).not.toHaveTextContent('CONFERÊNCIA DE REPETIDA FALHOU')
    expect(screen.queryByTestId('motivo-recente')).not.toBeInTheDocument()            // o aviso tem o bloco próprio: o motivo cru não repete
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
    await userEvent.click(within(b).getByRole('button', { name: 'Tentar de novo' }))
    expect(m.tentarConferirDeNovo).toHaveBeenCalledWith('r7')
    await waitFor(() => expect(screen.queryByTestId('aviso-falha-conferir')).not.toBeInTheDocument())
    expect(await screen.findByText(/na fila/)).toBeInTheDocument()
  })

  it('achou compra igual: a lista recarrega e o cartão passa a mostrar "Parece repetida" com os dois botões', async () => {
    const FRASE = 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 111,25): cupom de 03/10, lançado no SisChef (pedido 163377089).'
    m.comprasAvulsasRecentes.mockResolvedValueOnce([recente({ id: 'r7', estado: 'REVISAR', pedido_sischef: null, motivo: FALHA })])
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'r7', estado: 'REVISAR', pedido_sischef: null, motivo: FRASE })])
    m.cuponsExcluidos.mockResolvedValue([])
    m.tentarConferirDeNovo.mockRejectedValue(new Error(FRASE))
    render(<CompraAvulsa />)
    await userEvent.click(within(await screen.findByTestId('aviso-falha-conferir')).getByRole('button', { name: 'Tentar de novo' }))
    const a = await screen.findByTestId('aviso-repetida')
    expect(within(a).getByRole('button', { name: 'É outra compra: lançar mesmo assim' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('aviso-falha-conferir')).not.toBeInTheDocument())
  })

  it('a conferência falhou de novo (503): o texto do servidor aparece no bloco e o botão continua à mão', async () => {
    m.comprasAvulsasRecentes.mockResolvedValue([recente({ id: 'r7', estado: 'REVISAR', pedido_sischef: null, motivo: FALHA })])
    m.cuponsExcluidos.mockResolvedValue([])
    m.tentarConferirDeNovo.mockRejectedValue(new Error('Não consegui conferir se esta compra é repetida agora. Tente de novo em instantes.'))
    render(<CompraAvulsa />)
    const b = await screen.findByTestId('aviso-falha-conferir')
    await userEvent.click(within(b).getByRole('button', { name: 'Tentar de novo' }))
    expect(await within(b).findByRole('alert')).toHaveTextContent('Tente de novo em instantes')
    expect(within(b).getByRole('button', { name: 'Tentar de novo' })).toBeEnabled()
  })
})
