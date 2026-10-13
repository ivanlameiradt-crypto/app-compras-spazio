import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CadastrarProduto, { ProdutoNaoCadastrado, type AcoesProduto, type StatusProduto } from '../../src/admin/CadastrarProduto'

// Cadastrar produto novo dentro do app (pedido do Ivan, 13/10/2026): nome + grupo + unidade -> cadastrar -> andamento -> "Usar este produto" (só com o toque).
const ITEM = 'MAION.HELLMANNS 1X3Kg'
const NOME = 'MAION.HELLMANNS 1X3KG - INSUMOS'
const ORIGEM = { tipo: 'cupom' as const, id: 'cupom-1' }

const status = (over: Partial<StatusProduto> = {}): StatusProduto => ({
  id: 'ped-1', estado: 'CADASTRADO', produto_id: 3900001, motivo: null, candidatos: [], descricao: NOME, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', ...over,
})
function acoes(over: Partial<AcoesProduto> = {}): AcoesProduto {
  return { cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-1' }), status: vi.fn().mockResolvedValue(status()), ...over }
}
const abrir = (a: AcoesProduto, aoUsar = vi.fn(), extra: Partial<React.ComponentProps<typeof CadastrarProduto>> = {}) =>
  render(<CadastrarProduto descricaoDoItem={ITEM} acoes={a} origem={ORIGEM} aoUsar={aoUsar} intervaloMs={20} {...extra} />)
const preencher = async () => {
  await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
  await userEvent.selectOptions(screen.getByTestId('unidade-produto'), 'KG')
}

describe('CadastrarProduto', () => {
  it('abre com o nome pronto, a unidade VAZIA (só uma dica pelo nome do item) e o grupo sem escolha; só KG ou UN', () => {
    abrir(acoes())
    expect(screen.getByTestId('nome-produto')).toHaveValue(NOME)
    expect(screen.getByTestId('unidade-produto')).toHaveValue('')
    expect(screen.getByTestId('unidade-sugerida')).toHaveTextContent('KG')
    expect(screen.getByTestId('unidade-sugerida')).toHaveTextContent('Quem escolhe é você')
    expect([...screen.getByTestId('unidade-produto').querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['', 'UN', 'KG'])
    expect(screen.getByTestId('grupo-produto')).toHaveValue('')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeDisabled()
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Escolha o grupo')
    expect(screen.getByTestId('previa-cadastro')).toHaveTextContent('controla estoque')
  })

  it('sem escolher a unidade o botão não libera (nunca chuta)', async () => {
    abrir(acoes())
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeDisabled()
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Escolha a unidade')
  })

  it('escolhidos grupo e unidade, cadastra com os dados e a origem certos; nada é pedido antes do toque; depois acompanha PELO CÓDIGO do pedido', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    abrir(a)
    expect(a.cadastrar).not.toHaveBeenCalled()
    await preencher()
    await userEvent.clear(screen.getByTestId('nome-produto'))
    await userEvent.type(screen.getByTestId('nome-produto'), 'maionese hellmanns 3kg')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(a.cadastrar).toHaveBeenCalledWith({ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1' })
    expect(await screen.findByTestId('cadastrando-produto')).toHaveTextContent('2 minutos')
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-1' }))
    expect(a.status).not.toHaveBeenCalledWith(expect.objectContaining({ chave: expect.anything() }))
  })

  it('quando o robô termina: mostra o código novo e só "Usar este produto" entrega o produto (nome e unidade da lista do app)', async () => {
    const aoUsar = vi.fn()
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS' })) }), aoUsar)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('cód. 3900001')
    expect(aoUsar).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith({ produto_id: 3900001, nome: 'MAIONESE HELLMANNS 3KG - INSUMOS', unidade: 'kg' })
  })

  it('o produto já existia no SisChef (com a unidade de lá): avisa que entrou na lista e usa a unidade do SisChef', async () => {
    const aoUsar = vi.fn()
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'JA_EXISTIA', produto_id: 3469999, unidade: 'UN' })) }), aoUsar)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('já existia no SisChef')
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith(expect.objectContaining({ produto_id: 3469999, unidade: 'un' }))
  })

  it('"pronto" sem o código do produto nunca libera o uso: vira aviso para conferir', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'CADASTRADO', produto_id: null })) }))
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-revisar')).toHaveTextContent('sem o código do produto')
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
  })

  it('robô que não conseguiu: mostra o motivo, NÃO afirma que nada foi criado e pede para conferir no SisChef; não oferece usar o produto', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'grupo não encontrado' })) }))
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    const aviso = await screen.findByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('grupo não encontrado')
    expect(aviso).toHaveTextContent('Confira no SisChef')
    expect(aviso).not.toHaveTextContent('Nada foi cadastrado')
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
  })

  it('REVISAR com produtos parecidos: "usar este" pede o existente; "criar mesmo assim" pede forçado', async () => {
    const cands = [{ produto_id: 3469720, descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', unidade: 'KG' }]
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'achei produto parecido', candidatos: cands })) })
    abrir(a)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('candidatos-produto')).toHaveTextContent('MAIONESE HELLMANNS 3KG - INSUMOS')
    await userEvent.click(screen.getByTestId('usar-candidato'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenLastCalledWith(expect.objectContaining({ existente_id: 3469720 })))
    expect(a.cadastrar).toHaveBeenLastCalledWith(expect.not.objectContaining({ forcar: true }))
    expect(await screen.findByTestId('criar-mesmo-assim')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('criar-mesmo-assim'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenLastCalledWith(expect.objectContaining({ forcar: true })))
    expect(a.cadastrar).toHaveBeenLastCalledWith(expect.not.objectContaining({ existente_id: expect.anything() }))
  })

  it('passando do prazo sem terminar: avisa que está demorando e pede para não tocar de novo', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) }), vi.fn(), { demoraMs: 30 })
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-demorando')).toHaveTextContent('Não toque de novo')
  })

  it('reaberta no meio do cadastro (pedido que já existe): continua de onde estava, sem pedir de novo', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    abrir(a, vi.fn(), { inicial: status({ estado: 'PENDENTE', produto_id: null }) })
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(screen.getByTestId('grupo-produto')).toHaveValue('ESTOQUE CONTROLADO')
    expect(screen.queryByTestId('cadastrar-produto-botao')).not.toBeInTheDocument()
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-1' }))
    expect(a.cadastrar).not.toHaveBeenCalled()
  })

  it('reaberta depois de pronto: oferece "Usar este produto" direto', async () => {
    const aoUsar = vi.fn()
    abrir(acoes(), aoUsar, { inicial: status() })
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith({ produto_id: 3900001, nome: NOME, unidade: 'kg' })
  })

  it('erro ao pedir o cadastro: mostra a mensagem e deixa tentar de novo', async () => {
    const a = acoes({ cadastrar: vi.fn().mockRejectedValue(new Error('sem rede')) })
    abrir(a)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('erro-produto')).toHaveTextContent('sem rede')
    await waitFor(() => expect(screen.getByTestId('cadastrar-produto-botao')).toBeEnabled())
  })
})

describe('ProdutoNaoCadastrado', () => {
  const caixa = (a: AcoesProduto) => render(<ProdutoNaoCadastrado descricaoDoItem={ITEM} acoes={a} origem={ORIGEM} aoUsar={vi.fn()} />)

  it('avisa que o produto não está na lista do app, diz que o robô confere o SisChef, e só abre o formulário no toque', async () => {
    caixa(acoes({ status: vi.fn().mockResolvedValue(null) }))
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveTextContent('precisa ser cadastrado')
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveTextContent('confere no SisChef')
    expect(screen.queryByTestId('cadastrar-produto')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('abrir-cadastro-produto'))
    expect(screen.getByTestId('cadastrar-produto')).toBeInTheDocument()
  })

  it('já existe um cadastro deste nome em andamento ou pronto: abre sozinha, já retomada (consulta pelo nome)', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    caixa(a)
    expect(await screen.findByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(a.status).toHaveBeenCalledWith({ chave: 'maion hellmanns 1x3kg insumos' })
  })

  it('um pedido antigo que terminou em REVISAR não abre sozinho: o Ivan começa do aviso', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'x' })) })
    caixa(a)
    await waitFor(() => expect(a.status).toHaveBeenCalled())
    expect(screen.queryByTestId('cadastrar-produto')).not.toBeInTheDocument()
    expect(screen.getByTestId('abrir-cadastro-produto')).toBeInTheDocument()
  })
})
