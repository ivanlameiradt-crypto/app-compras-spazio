import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CadastrarProduto, { ProdutoNaoCadastrado, type AcoesProduto } from '../../src/admin/CadastrarProduto'

// Cadastrar produto novo dentro do app (pedido do Ivan, 13/10/2026): nome + grupo + unidade -> cadastrar -> andamento -> "Usar este produto" (só com o toque).
const ITEM = 'MAION.HELLMANNS 1X3Kg'

function acoes(over: Partial<AcoesProduto> = {}): AcoesProduto {
  return {
    cadastrar: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ estado: 'CADASTRADO', produto_id: 3900001, motivo: null }),
    ...over,
  }
}
const abrir = (a: AcoesProduto, aoUsar = vi.fn()) => render(<CadastrarProduto descricaoDoItem={ITEM} acoes={a} aoUsar={aoUsar} intervaloMs={20} />)

describe('CadastrarProduto', () => {
  it('abre com o nome pronto (como vai ficar no SisChef), a unidade sugerida pelo item e o grupo SEM escolha', () => {
    abrir(acoes())
    expect(screen.getByTestId('nome-produto')).toHaveValue('MAION.HELLMANNS 1X3KG - INSUMOS')
    expect(screen.getByTestId('unidade-produto')).toHaveValue('KG')
    expect(screen.getByTestId('unidade-sugerida')).toHaveTextContent('confirme')
    expect(screen.getByTestId('grupo-produto')).toHaveValue('')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeDisabled()
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Escolha o grupo')
    expect(screen.getByTestId('previa-cadastro')).toHaveTextContent('controla estoque')
  })

  it('escolhido o grupo, cadastra com os dados certos e mostra o andamento; nada é pedido antes do toque', async () => {
    const a = acoes()
    abrir(a)
    expect(a.cadastrar).not.toHaveBeenCalled()
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.clear(screen.getByTestId('nome-produto'))
    await userEvent.type(screen.getByTestId('nome-produto'), 'maionese hellmanns 3kg')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(a.cadastrar).toHaveBeenCalledWith({ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns' })
    expect(await screen.findByTestId('cadastrando-produto')).toHaveTextContent('2 minutos')
  })

  it('quando o robô termina: mostra o código novo e só "Usar este produto" entrega o produto (na unidade em minúscula, como a lista)', async () => {
    const aoUsar = vi.fn()
    abrir(acoes(), aoUsar)
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('cód. 3900001')
    expect(aoUsar).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith({ produto_id: 3900001, nome: 'MAION.HELLMANNS 1X3KG - INSUMOS', unidade: 'kg' })
  })

  it('o produto já existia no SisChef: avisa que entrou na lista', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue({ estado: 'JA_EXISTIA', produto_id: 3469999, motivo: null }) }))
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('já existia no SisChef')
  })

  it('robô que não conseguiu: mostra o motivo e não oferece usar o produto', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue({ estado: 'REVISAR', produto_id: null, motivo: 'grupo não encontrado' }) }))
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-revisar')).toHaveTextContent('grupo não encontrado')
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
  })

  it('erro ao pedir o cadastro: mostra a mensagem e deixa tentar de novo', async () => {
    const a = acoes({ cadastrar: vi.fn().mockRejectedValue(new Error('sem rede')) })
    abrir(a)
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('erro-produto')).toHaveTextContent('sem rede')
    await waitFor(() => expect(screen.getByTestId('cadastrar-produto-botao')).toBeEnabled())
  })
})

describe('ProdutoNaoCadastrado', () => {
  it('avisa que o produto não está cadastrado e só abre o formulário no toque', async () => {
    render(<ProdutoNaoCadastrado descricaoDoItem={ITEM} acoes={acoes()} aoUsar={vi.fn()} />)
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveTextContent('precisa ser cadastrado')
    expect(screen.queryByTestId('cadastrar-produto')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('abrir-cadastro-produto'))
    expect(screen.getByTestId('cadastrar-produto')).toBeInTheDocument()
  })
})
