import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CadastrarFornecedor, { type AcoesFornecedor } from '../../src/admin/CadastrarFornecedor'

// Cadastrar fornecedor dentro do app (pedido do Ivan, 08/10/2026): CNPJ -> consulta -> razão social + fantasia (só app) + UF/município -> cadastrar -> reenviar (só com o toque).
const MOTIVO = 'fornecedor não encontrado no Sischef (A. N. DA SILVA DESCARTAVEIS LTDA, CNPJ 63540861000182)'
const CUPOM = { id: 'c1', motivo: MOTIVO, emitente_nome: 'A. N. DA SILVA DESCARTAVEIS LTDA', emitente_cnpj: '63540861000182' }
const DADOS = { cnpj: '63540861000182', razao_social: 'A. N. DA SILVA DESCARTAVEIS LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Abaetetuba' }

function acoes(over: Partial<AcoesFornecedor> = {}): AcoesFornecedor {
  return {
    consultarCnpj: vi.fn().mockResolvedValue(DADOS),
    cadastrar: vi.fn().mockResolvedValue(undefined),
    statusDoCadastro: vi.fn().mockResolvedValue(null),
    reenviarCupom: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}
const abrir = (a: AcoesFornecedor, aoReenviar = vi.fn()) => render(<CadastrarFornecedor cupom={CUPOM} acoes={a} aoReenviar={aoReenviar} intervaloMs={20} />)

describe('CadastrarFornecedor', () => {
  it('abre com o CNPJ do cupom formatado e sem os campos até buscar', async () => {
    abrir(acoes())
    expect(screen.getByLabelText('CNPJ')).toHaveValue('63.540.861/0001-82')
    expect(screen.queryByLabelText(/Razão social/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('cadastrar')).not.toBeInTheDocument()
  })

  it('buscar o CNPJ preenche razão social, estado e município; a fantasia fica à parte e o aviso diz que é só do app', async () => {
    const a = acoes({ consultarCnpj: vi.fn().mockResolvedValue({ ...DADOS, nome_fantasia: 'AN DESCARTÁVEIS' }) })
    abrir(a)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(a.consultarCnpj).toHaveBeenCalledWith('63540861000182')
    expect(await screen.findByLabelText(/Razão social/)).toHaveValue('A. N. DA SILVA DESCARTAVEIS LTDA') // só a razão: sem a fantasia junto
    expect(screen.getByLabelText(/Nome fantasia/)).toHaveValue('AN DESCARTÁVEIS')
    expect(screen.getByLabelText('Estado')).toHaveValue('PA')
    expect(screen.getByLabelText('Município')).toHaveValue('Abaetetuba')
    expect(screen.getByTestId('regra-fantasia')).toHaveTextContent('O SisChef recebe só o CNPJ e a razão social')
  })

  it('"Cadastrar no SisChef" manda o pedido (com a fantasia, que o servidor guarda só no app) e fica "cadastrando"', async () => {
    const a = acoes()
    abrir(a)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.type(screen.getByLabelText(/Nome fantasia/), 'AN DESCARTÁVEIS')
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(a.cadastrar).toHaveBeenCalledWith({ cnpj: '63540861000182', razao_social: 'A. N. DA SILVA DESCARTAVEIS LTDA', nome_fantasia: 'AN DESCARTÁVEIS', uf: 'PA', municipio: 'Abaetetuba', cupom_id: 'c1' })
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
    expect(screen.queryByTestId('cadastrar')).not.toBeInTheDocument() // não dá para pedir duas vezes
  })

  it('acompanha o robô: quando vira CADASTRADO mostra o aviso e o botão; o cupom só é reenviado com o TOQUE', async () => {
    let pedido = false
    let cadastrado = false
    const a = acoes({
      cadastrar: vi.fn(async () => { pedido = true }),
      statusDoCadastro: vi.fn(async () => (!pedido ? null : cadastrado ? { estado: 'CADASTRADO' as const, motivo: null } : { estado: 'PENDENTE' as const, motivo: null })),
    })
    const aoReenviar = vi.fn()
    abrir(a, aoReenviar)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    await screen.findByTestId('cadastrando')
    cadastrado = true
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('Fornecedor cadastrado no SisChef')
    expect(a.reenviarCupom).not.toHaveBeenCalled() // nunca reenvia sozinho
    await userEvent.click(screen.getByTestId('reenviar-cupom'))
    expect(a.reenviarCupom).toHaveBeenCalledWith('c1')
    await waitFor(() => expect(aoReenviar).toHaveBeenCalledTimes(1))
  })

  it('CNPJ que já estava no SisChef (JA_EXISTIA): diz isso e oferece o reenvio', async () => {
    abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'JA_EXISTIA', motivo: null }) }))
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('já estava cadastrado')
    expect(screen.getByTestId('reenviar-cupom')).toBeEnabled()
  })

  it('o robô não conseguiu (REVISAR): mostra o motivo, sem botão de reenviar', async () => {
    abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'REVISAR', motivo: 'não achei o município X' }) }))
    expect(await screen.findByTestId('cadastro-revisar')).toHaveTextContent('não achei o município X')
    expect(screen.queryByTestId('reenviar-cupom')).not.toBeInTheDocument()
  })

  it('consulta do CNPJ fora do ar: avisa e deixa preencher à mão', async () => {
    const a = acoes({ consultarCnpj: vi.fn().mockRejectedValue(new Error('não consegui consultar o CNPJ agora: preencha os dados à mão')) })
    abrir(a)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(await screen.findByTestId('aviso-cnpj')).toHaveTextContent('preencha os dados à mão')
    await userEvent.type(screen.getByLabelText(/Razão social/), 'A. N. DA SILVA DESCARTAVEIS LTDA')
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'PA')
    await userEvent.type(screen.getByLabelText('Município'), 'Abaetetuba')
    expect(screen.getByTestId('cadastrar')).toBeEnabled()
  })

  it('CNPJ errado: não consulta e avisa', async () => {
    const a = acoes()
    abrir(a)
    await userEvent.clear(screen.getByLabelText('CNPJ'))
    await userEvent.type(screen.getByLabelText('CNPJ'), '63540861000183')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(await screen.findByTestId('erro-fornecedor')).toHaveTextContent('O CNPJ não está certo')
    expect(a.consultarCnpj).not.toHaveBeenCalled()
  })

  it('erro ao pedir o cadastro: mostra o texto e deixa tentar de novo', async () => {
    const a = acoes({ cadastrar: vi.fn().mockRejectedValue(new Error('este cupom não está parado por fornecedor não cadastrado: atualize a tela')) })
    abrir(a)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(await screen.findByTestId('erro-fornecedor')).toHaveTextContent('atualize a tela')
    expect(screen.getByTestId('cadastrar')).toBeEnabled()
    expect(screen.queryByTestId('cadastrando')).not.toBeInTheDocument()
  })
})

// 31/10/2026 (Plast Mais 8928): o fornecedor da NOTA FISCAL não está no SisChef. A caixa é a mesma; o texto fala da nota e, pronto o cadastro, o Ivan toca em "Lançar" na própria nota.
describe('CadastrarFornecedor — dentro da nota fiscal (paraNota)', () => {
  const NOTA = { id: 'u-1', motivo: null, emitente_nome: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', emitente_cnpj: '55384032000120' }
  const PLAST = { cnpj: '55384032000120', razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Belém' }
  const abrirNota = (a: AcoesFornecedor, aoReenviar = vi.fn()) => render(<CadastrarFornecedor paraNota cupom={NOTA} acoes={a} aoReenviar={aoReenviar} intervaloMs={20} />)

  it('abre com o CNPJ e o nome da nota, e o texto diz que depois é só tocar em Lançar', () => {
    abrirNota(acoes())
    expect(screen.getByLabelText('CNPJ')).toHaveValue('55.384.032/0001-20')
    expect(screen.getByTestId('intro-nota')).toHaveTextContent('O robô não achou PLAST MAIS SOCIEDADE UNIPESSOAL LTDA (CNPJ 55.384.032/0001-20) no SisChef.')
    expect(screen.getByTestId('intro-nota')).toHaveTextContent('Cadastre aqui e depois toque em “Lançar” na nota.')
    expect(screen.getByTestId('intro-nota')).toHaveTextContent('só cadastra quando você tocar em “Cadastrar no SisChef”')
    expect(screen.queryByText(/reenvie o cupom/)).not.toBeInTheDocument()
  })

  it('a razão social já vem da nota; o pedido de cadastro leva o CNPJ, a razão e a CHAVE DA NOTA (nota_chave), nunca um cupom_id', async () => {
    const a = acoes({ consultarCnpj: vi.fn().mockResolvedValue(PLAST) })
    abrirNota(a)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(await screen.findByLabelText(/Razão social/)).toHaveValue('PLAST MAIS SOCIEDADE UNIPESSOAL LTDA')
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(a.cadastrar).toHaveBeenCalledWith({ cnpj: '55384032000120', razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Belém', nota_chave: 'u-1' })
    expect(vi.mocked(a.cadastrar).mock.calls[0][0]).not.toHaveProperty('cupom_id')
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
  })

  it('pronto o cadastro: diz para tocar em Lançar; o botão só pede a releitura da nota e NUNCA reenvia cupom', async () => {
    let pedido = false
    const a = acoes({
      consultarCnpj: vi.fn().mockResolvedValue(PLAST),
      cadastrar: vi.fn(async () => { pedido = true }),
      statusDoCadastro: vi.fn(async () => (pedido ? { estado: 'CADASTRADO' as const, motivo: null } : null)),
    })
    const aoReenviar = vi.fn()
    abrirNota(a, aoReenviar)
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('Agora é só tocar em “Lançar” na nota.')
    expect(screen.getByTestId('reenviar-cupom')).toHaveTextContent('Atualizar a nota')
    await userEvent.click(screen.getByTestId('reenviar-cupom'))
    expect(aoReenviar).toHaveBeenCalledTimes(1)
    expect(a.reenviarCupom).not.toHaveBeenCalled()
  })

  it('CNPJ que já estava no SisChef (JA_EXISTIA): diz isso e oferece atualizar a nota', async () => {
    abrirNota(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'JA_EXISTIA', motivo: null }) }))
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('já estava cadastrado')
    expect(screen.getByTestId('reenviar-cupom')).toHaveTextContent('Atualizar a nota')
  })

  it('sem o paraNota nada muda: o cupom continua com o texto e o botão de sempre', () => {
    abrir(acoes())
    expect(screen.queryByTestId('intro-nota')).not.toBeInTheDocument()
    expect(screen.getByText(/reenvie o cupom/)).toBeInTheDocument()
  })
})
