import type { ComponentProps } from 'react'
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

// Reanálise de 13/11 (B2): na compra avulsa, quem abre o cadastro por engano precisa de um jeito de voltar para a busca.
describe('CadastrarFornecedor: "Voltar para a busca" (B2)', () => {
  it('com `aoVoltar` mostra o botão e o toque avisa quem chamou; sem ele (cupom e nota) o botão não existe', async () => {
    const aoVoltar = vi.fn()
    const { unmount } = render(<CadastrarFornecedor cupom={{ id: 'e1', motivo: null }} acoes={acoes()} aoReenviar={vi.fn()} aoUsar={vi.fn()} aoVoltar={aoVoltar} intervaloMs={20} />)
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para a busca' }))
    expect(aoVoltar).toHaveBeenCalledTimes(1)
    unmount()
    abrir(acoes())
    expect(screen.queryByRole('button', { name: 'Voltar para a busca' })).not.toBeInTheDocument()
  })

  // Revisão do PR 92 (S1): voltar no meio do cadastro jogava fora o acompanhamento do robô.
  it('durante "Cadastrando no SisChef…" e depois de "✓ Fornecedor cadastrado" o botão não fica disponível', async () => {
    const a = acoes()
    render(<CadastrarFornecedor cupom={{ id: 'e1', motivo: null }} acoes={a} aoReenviar={vi.fn()} aoUsar={vi.fn()} aoVoltar={vi.fn()} intervaloMs={20} />)
    await userEvent.type(screen.getByLabelText('CNPJ'), '63540861000182')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(screen.getByRole('button', { name: 'Voltar para a busca' })).toBeEnabled()          // preenchendo: ainda dá para voltar
    await userEvent.click(await screen.findByTestId('cadastrar'))
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voltar para a busca' })).not.toBeInTheDocument()
    vi.mocked(a.statusDoCadastro).mockResolvedValue({ estado: 'CADASTRADO', motivo: null })
    expect(await screen.findByTestId('cadastro-pronto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voltar para a busca' })).not.toBeInTheDocument()
  })
})

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

  // 06/11/2026: três toques seguidos na SIGMARINGA PLAZA. O aviso dizia "Nada foi cadastrado errado", mas o SisChef já tinha criado uma ficha sem CNPJ e cada toque criava outra.
  it('REVISAR: manda falar com o Claude ANTES de tocar de novo e não diz mais que "nada foi cadastrado errado"', async () => {
    abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'REVISAR', motivo: 'não achei o município X' }) }))
    const aviso = await screen.findByTestId('cadastro-revisar')
    expect(aviso).toHaveTextContent('Antes de tocar de novo em “Cadastrar no SisChef”, fale com o Claude: o SisChef pode ter criado uma ficha pela metade.')
    expect(aviso).not.toHaveTextContent('Nada foi cadastrado errado')
  })

  it('REVISAR: o motivo do robô sem ponto final ganha um ponto antes do conselho (o print de 06/11 saía "…tentar de novo Nada foi…")', async () => {
    const motivo = "cliquei em 'Salvar' e achei 0 pessoa(s) com o CNPJ 04632558000140 em Cadastros › Pessoas — confira à mão antes de tentar de novo"
    abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'REVISAR', motivo }) }))
    expect(await screen.findByTestId('cadastro-revisar')).toHaveTextContent('antes de tentar de novo. Antes de tocar de novo')
  })

  it('REVISAR: motivo que já termina em ponto não ganha outro; sem motivo, o aviso começa com "não conseguiu cadastrar."', async () => {
    const { unmount } = abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'REVISAR', motivo: 'o Sischef criou a ficha (id 7), mas SEM o CNPJ.' }) }))
    const comPonto = await screen.findByTestId('cadastro-revisar')
    expect(comPonto).toHaveTextContent('SEM o CNPJ. Antes de tocar de novo')
    expect(comPonto).not.toHaveTextContent('..')
    unmount()
    abrir(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'REVISAR', motivo: null }) }))
    expect(await screen.findByTestId('cadastro-revisar')).toHaveTextContent('O robô não conseguiu cadastrar. Antes de tocar de novo')
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

  it('o CNPJ fica TRAVADO na nota (o servidor só aceita o do emitente) — e no cupom continua editável', () => {
    abrirNota(acoes())
    expect(screen.getByLabelText('CNPJ')).toBeDisabled()
    expect(screen.queryByTestId('cnpj-lido-errado')).not.toBeInTheDocument()          // na nota o CNPJ vem da chave, não de uma foto
    abrir(acoes())
    expect(screen.getAllByLabelText('CNPJ')[1]).toBeEnabled()
  })

  it('na nota, sem a consulta do CNPJ (fora do ar), a razão social já vem preenchida com o emitente da nota', async () => {
    abrirNota(acoes({ consultarCnpj: vi.fn().mockRejectedValue(new Error('consulta fora do ar')) }))
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    expect(await screen.findByLabelText(/Razão social/)).toHaveValue('PLAST MAIS SOCIEDADE UNIPESSOAL LTDA')
  })
})

// Revisão independente do PR 63 (31/10/2026), A2/A3/A4: o pedido que o robô nunca pegou não pode deixar a caixa em "Cadastrando…" para sempre, o cadastro velho não pode virar um
// ✓ sem saída quando o robô recusou a nota DEPOIS dele, e o cadastro não pode disputar a fila do robô com outro lançamento.
describe('CadastrarFornecedor — nota: pedido parado, cadastro antigo e robô ocupado', () => {
  const NOTA = { id: 'u-1', motivo: null, emitente_nome: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', emitente_cnpj: '55384032000120' }
  const PLAST = { cnpj: '55384032000120', razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Belém' }
  const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const abrirNotaCom = (a: AcoesFornecedor, extra: Partial<ComponentProps<typeof CadastrarFornecedor>> = {}) =>
    render(<CadastrarFornecedor paraNota cupom={NOTA} acoes={a} aoReenviar={vi.fn()} intervaloMs={20} {...extra} />)

  it('PENDENTE há mais de 15 min: dado como PARADO — aviso, formulário de novo e nada de "Cadastrando…" sem saída', async () => {
    abrirNotaCom(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'PENDENTE', motivo: null, criado_em: minutosAtras(20), atualizado_em: minutosAtras(20) }) }))
    expect(await screen.findByTestId('pedido-parado')).toHaveTextContent('Pode pedir de novo')
    expect(screen.queryByTestId('cadastrando')).not.toBeInTheDocument()
    expect(screen.getByTestId('buscar-cnpj')).toBeInTheDocument()
  })

  it('PENDENTE de 2 minutos: continua "Cadastrando…", sem aviso e sem botão', async () => {
    abrirNotaCom(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'PENDENTE', motivo: null, criado_em: minutosAtras(2), atualizado_em: minutosAtras(2) }) }))
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
    expect(screen.queryByTestId('pedido-parado')).not.toBeInTheDocument()
    expect(screen.queryByTestId('buscar-cnpj')).not.toBeInTheDocument()
  })

  it('depois do aviso de parado, pedir de novo volta a "Cadastrando…" (o pedido novo não é dado como parado de imediato)', async () => {
    let pedido = false
    const a = acoes({
      consultarCnpj: vi.fn().mockResolvedValue(PLAST),
      cadastrar: vi.fn(async () => { pedido = true }),
      statusDoCadastro: vi.fn(async () => (pedido
        ? { estado: 'PENDENTE' as const, motivo: null, criado_em: minutosAtras(0), atualizado_em: minutosAtras(0) }
        : { estado: 'PENDENTE' as const, motivo: null, criado_em: minutosAtras(30), atualizado_em: minutosAtras(30) })),
    })
    abrirNotaCom(a)
    await screen.findByTestId('pedido-parado')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(a.cadastrar).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 120))                                       // algumas conferências do robô depois: continua cadastrando
    expect(screen.queryByTestId('pedido-parado')).not.toBeInTheDocument()
    expect(screen.getByTestId('cadastrando')).toBeInTheDocument()
  })

  it('cadastro JA_EXISTIA mais antigo que a recusa da nota: aviso (pode estar sem a marca de fornecedor), formulário de novo e SEM o ✓ nem o "Atualizar a nota"', async () => {
    abrirNotaCom(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'JA_EXISTIA', motivo: null, criado_em: minutosAtras(120), atualizado_em: minutosAtras(120) }) }),
      { recusadaEm: minutosAtras(10) })
    expect(await screen.findByTestId('cadastro-antigo')).toHaveTextContent('marca de fornecedor')
    expect(screen.queryByTestId('cadastro-pronto')).not.toBeInTheDocument()
    expect(screen.queryByTestId('reenviar-cupom')).not.toBeInTheDocument()
    expect(screen.getByTestId('buscar-cnpj')).toBeInTheDocument()
  })

  it('cadastro CADASTRADO mais antigo que a recusa: mensagem própria (peça de novo)', async () => {
    abrirNotaCom(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'CADASTRADO', motivo: null, criado_em: minutosAtras(120), atualizado_em: minutosAtras(119) }) }),
      { recusadaEm: minutosAtras(10) })
    expect(await screen.findByTestId('cadastro-antigo')).toHaveTextContent('Peça o cadastro de novo')
    expect(screen.queryByTestId('cadastro-pronto')).not.toBeInTheDocument()
  })

  it('cadastro concluído DEPOIS da recusa da nota, ou sem a data da recusa (compatibilidade): ✓ normal', async () => {
    const a = acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'CADASTRADO', motivo: null, criado_em: minutosAtras(5), atualizado_em: minutosAtras(3) }) })
    abrirNotaCom(a, { recusadaEm: minutosAtras(10) })
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('Agora é só tocar em “Lançar” na nota.')
    expect(screen.queryByTestId('cadastro-antigo')).not.toBeInTheDocument()
  })

  it('cadastro concluído sem datas no status (resposta antiga do servidor): vale como pronto, nunca como antigo nem como parado', async () => {
    abrirNotaCom(acoes({ statusDoCadastro: vi.fn().mockResolvedValue({ estado: 'JA_EXISTIA', motivo: null }) }), { recusadaEm: minutosAtras(10) })
    expect(await screen.findByTestId('cadastro-pronto')).toBeInTheDocument()
    expect(screen.queryByTestId('cadastro-antigo')).not.toBeInTheDocument()
  })

  it('robô ocupado com outra nota: o botão Cadastrar espera (o GitHub guarda só um pedido na fila e cancelaria um dos dois)', async () => {
    const a = acoes({ consultarCnpj: vi.fn().mockResolvedValue(PLAST) })
    abrirNotaCom(a, { ocupado: true })
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    expect(screen.getByTestId('aguarde-robo')).toHaveTextContent('Aguarde o robô terminar de lançar a outra nota')
    expect(screen.getByTestId('cadastrar')).toBeDisabled()
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(a.cadastrar).not.toHaveBeenCalled()
  })

  it('robô livre: o botão Cadastrar funciona e não há aviso de espera', async () => {
    const a = acoes({ consultarCnpj: vi.fn().mockResolvedValue(PLAST) })
    abrirNotaCom(a, { ocupado: false })
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    expect(screen.queryByTestId('aguarde-robo')).not.toBeInTheDocument()
    expect(screen.getByTestId('cadastrar')).toBeEnabled()
  })
})

// 02/11/2026: aba "Compras avulsas". Não há cupom nem nota: `cupom.id` é o identificador da compra e o pedido de cadastro leva `avulsa_id` (antes ia como `cupom_id` e o servidor respondia 404).
describe('CadastrarFornecedor — dentro da compra avulsa (aoUsar)', () => {
  const COMPRA = { id: '3f2b8c1e-7d4a-4e5b-9a60-1c2d3e4f5a6b', motivo: null }
  const abrirAvulsa = (a: AcoesFornecedor, aoUsar = vi.fn()) =>
    render(<CadastrarFornecedor cupom={COMPRA} acoes={a} aoReenviar={vi.fn()} aoUsar={aoUsar} intervaloMs={20} />)

  it('o pedido de cadastro leva o identificador da compra como avulsa_id, nunca como cupom_id nem nota_chave', async () => {
    const a = acoes()
    abrirAvulsa(a)
    await userEvent.type(screen.getByLabelText('CNPJ'), '63540861000182')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(a.cadastrar).toHaveBeenCalledWith({ cnpj: '63540861000182', razao_social: 'A. N. DA SILVA DESCARTAVEIS LTDA', nome_fantasia: '', uf: 'PA', municipio: 'Abaetetuba', avulsa_id: COMPRA.id })
    const pedido = vi.mocked(a.cadastrar).mock.calls[0][0]
    expect(pedido).not.toHaveProperty('cupom_id')
    expect(pedido).not.toHaveProperty('nota_chave')
    expect(await screen.findByTestId('cadastrando')).toBeInTheDocument()
  })

  it('pronto o cadastro: o botão vira "Usar este fornecedor", entrega os dados a quem chamou e NUNCA reenvia cupom', async () => {
    let pedido = false
    const a = acoes({
      cadastrar: vi.fn(async () => { pedido = true }),
      statusDoCadastro: vi.fn(async () => (pedido ? { estado: 'CADASTRADO' as const, motivo: null } : null)),
    })
    const aoUsar = vi.fn()
    abrirAvulsa(a, aoUsar)
    await userEvent.type(screen.getByLabelText('CNPJ'), '63540861000182')
    await userEvent.click(screen.getByTestId('buscar-cnpj'))
    await screen.findByLabelText(/Razão social/)
    await userEvent.click(screen.getByTestId('cadastrar'))
    expect(await screen.findByTestId('cadastro-pronto')).toHaveTextContent('Agora é só usar este fornecedor na compra.')
    expect(screen.getByTestId('reenviar-cupom')).toHaveTextContent('Usar este fornecedor')
    await userEvent.click(screen.getByTestId('reenviar-cupom'))
    expect(aoUsar).toHaveBeenCalledWith({ cnpj: '63540861000182', razao: 'A. N. DA SILVA DESCARTAVEIS LTDA', fantasia: '' })
    expect(a.reenviarCupom).not.toHaveBeenCalled()
  })
})
