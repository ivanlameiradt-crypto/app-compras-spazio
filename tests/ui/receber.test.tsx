import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Recebimento from '../../src/recebimento/Recebimento'
import type { PedidoAReceber, Usuario } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const JOAO: Usuario = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador', ativo: true }
const pedido = (): PedidoAReceber => ({
  cotacao_id: 7, vendedor: 'MATEUS', confirmado_em: '2026-10-21T13:00:00Z', confirmado_local: '2026-10-21 10:15',
  entrega_prevista: '2026-10-22', recebimento: 'aguardando', entregas: [],
  itens: [
    { numero: 2, nome: 'COCA COLA 350 ML', unidade: 'un', qtd: 108, embalagens: 9, fator: 12, embalagem: 'fardo', marca: 'Marca X', chegou: 0, avaria: 0, resto: null },
    { numero: 3, nome: 'QUEIJO', unidade: 'kg', qtd: 20, embalagens: null, fator: null, embalagem: 'embalagem', marca: null, chegou: 0, avaria: 0, resto: null },
  ],
})

beforeEach(() => {
  m.pedidosAReceber.mockResolvedValue([pedido()])
  m.registrarRecebimento.mockResolvedValue({ recebimento_id: 1, recebimento: 'completo', faltas: [], avarias: [] })
})

it('lista os pedidos e "Chegou tudo certo" grava tudo o que falta em um toque, sem preço', async () => {
  render(<Recebimento usuario={JOAO} />)
  const abrir = await screen.findByRole('button', { name: /MATEUS/ })
  expect(screen.getByText(/entrega prevista qui 22\/10/)).toBeTruthy()
  await userEvent.click(abrir)
  const botao = await screen.findByRole('button', { name: 'Chegou tudo certo' })
  // nenhum "R$" na tela
  expect(document.body.textContent).not.toContain('R$')
  // a marca combinada aparece (conferir na porta)
  expect(screen.getByText(/marca: Marca X/)).toBeTruthy()
  await userEvent.click(botao)
  await waitFor(() => expect(m.registrarRecebimento).toHaveBeenCalled())
  const args = m.registrarRecebimento.mock.calls[0]
  expect(args[0]).toBe(7)
  expect(args[3]).toEqual([{ numero: 2, chegou: 108 }, { numero: 3, chegou: 20 }])
  expect(args[4]).toBeNull()
})

it('mudar o campo Chegou faz o botão virar "Registrar com as diferenças"', async () => {
  render(<Recebimento usuario={JOAO} />)
  await userEvent.click(await screen.findByRole('button', { name: /MATEUS/ }))
  await screen.findByRole('button', { name: 'Chegou tudo certo' })
  const campos = screen.getAllByRole('textbox')
  await userEvent.clear(campos[0])
  await userEvent.type(campos[0], '7')          // 7 fardos = 84 un (< 108)
  expect(await screen.findByRole('button', { name: 'Registrar com as diferenças' })).toBeTruthy()
})

// ---- digitar decimal tecla por tecla (item 4 da análise de 07/11/2026): antes, o campo era redesenhado a partir do número e a vírgula sumia
async function abrirCartao() {
  render(<Recebimento usuario={JOAO} />)
  await userEvent.click(await screen.findByRole('button', { name: /MATEUS/ }))
  await screen.findByRole('button', { name: 'Chegou tudo certo' })
  return screen.getAllByRole('textbox') as HTMLInputElement[]   // [0] = fardos (COCA COLA), [1] = kg (QUEIJO)
}

describe('campo Chegaram: o que a pessoa digita fica na tela', () => {
  it('2,5 kg digitado tecla por tecla fica "2,5" (a vírgula não some) e vale 2,5', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '2,5')
    expect(campos[1].value).toBe('2,5')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar com as diferenças' }))
    expect(await screen.findByText(/QUEIJO: faltaram 17,5 kg/)).toBeTruthy()      // 20 − 2,5
  })

  it('por embalagem: 7,5 fardos fica "7,5" e mostra 90 un', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[0])
    await userEvent.type(campos[0], '7,5')
    expect(campos[0].value).toBe('7,5')
    expect(screen.getByText(/fardos c\/12 = 90 un/)).toBeTruthy()
  })

  it('por embalagem com muitos decimais (0,33333 fardo): o texto não é refeito no meio da digitação', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[0])
    await userEvent.type(campos[0], '0,33333')
    expect(campos[0].value).toBe('0,33333')           // 0,33333 fardo = 3,99996 un → arredonda para 4 un → 0,3333: diferença só de arredondamento
  })

  it('milhar com ponto e decimal com vírgula: "1.234,5" fica como foi digitado', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '1.234,5')
    expect(campos[1].value).toBe('1.234,5')
  })

  it('"2.500" da balança (teclado só com ponto) é 2,5 kg, não 2.500 kg: fica "2.500" na tela e faltaram 17,5 kg', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '2.500')
    expect(campos[1].value).toBe('2.500')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar com as diferenças' }))
    expect(await screen.findByText(/QUEIJO: faltaram 17,5 kg/)).toBeTruthy()      // 20 − 2,5
  })

  it('apagar tudo deixa o campo vazio enquanto digita e volta a "0" ao sair do campo', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    expect(campos[1].value).toBe('')
    await userEvent.tab()
    expect(campos[1].value).toBe('0')
    expect(screen.getByRole('button', { name: 'Registrar com as diferenças' })).toBeTruthy()
  })

  it('"Não veio" zera o campo mesmo depois de digitar', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '2,5')
    await userEvent.click(screen.getAllByRole('button', { name: 'Não veio' })[1])
    expect(campos[1].value).toBe('0')
  })

  it('avaria também aceita decimal tecla por tecla: 0,5 fica "0,5"', async () => {
    const campos = await abrirCartao()
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais' })[1])
    const avaria = screen.getAllByRole('textbox')[2] as HTMLInputElement
    await userEvent.clear(avaria)
    await userEvent.type(avaria, '0,5')
    expect(avaria.value).toBe('0,5')
    expect(campos[1].value).toBe('20')                          // o Chegaram não mexeu
  })
})
// ---- correção de 08/11/2026 (revisão independente dos itens 3 e 4): o defeito de 07/11 (mexer em UM item zerava os outros) e a avaria sozinha
describe('Receber: itens que ninguém tocou e avaria digitada sozinha', () => {
  it('mexer em UM item não zera os outros: a COCA, que ninguém tocou, vai com 108 un (o que o campo mostra)', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '2,5')
    await userEvent.click(screen.getByRole('button', { name: 'Registrar com as diferenças' }))
    await userEvent.click(within(document.querySelector('.resto-todos') as HTMLElement).getByRole('button', { name: 'Ainda vem' }))
    await userEvent.click(screen.getByRole('button', { name: 'Registrar com as diferenças' }))
    await waitFor(() => expect(m.registrarRecebimento).toHaveBeenCalled())
    expect(m.registrarRecebimento.mock.calls[0][3]).toEqual([{ numero: 2, chegou: 108 }, { numero: 3, chegou: 2.5 }])
  })

  it('digitar só a avaria (sem mexer no Chegaram) não some: vai no registro e o botão vira "Registrar com as diferenças"', async () => {
    await abrirCartao()
    await userEvent.click(screen.getAllByRole('button', { name: 'Mais' })[1])
    const avaria = screen.getAllByRole('textbox')[2] as HTMLInputElement
    await userEvent.clear(avaria)
    await userEvent.type(avaria, '0,5')
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar com as diferenças' }))
    await waitFor(() => expect(m.registrarRecebimento).toHaveBeenCalled())
    expect(m.registrarRecebimento.mock.calls[0][3]).toEqual([{ numero: 2, chegou: 108 }, { numero: 3, chegou: 20, avaria: 0.5 }])
  })

  it('texto que não é número: aparece o aviso e o Registrar fica bloqueado; sair do campo não aceita o texto em silêncio', async () => {
    const campos = await abrirCartao()
    await userEvent.type(campos[1], 'x')                       // "20x"
    expect(screen.getByText(/Não entendi este número/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chegou tudo certo' })).toBeDisabled()
    await userEvent.tab()
    expect(campos[1].value).toBe('20x')
    expect(screen.getByText(/Não entendi este número/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chegou tudo certo' })).toBeDisabled()
    expect(m.registrarRecebimento).not.toHaveBeenCalled()
  })

  it('"2," ao sair do campo continua "2,"; quem volta para digitar o resto (5) tem 2,5 e nada se perde', async () => {
    const campos = await abrirCartao()
    await userEvent.clear(campos[1])
    await userEvent.type(campos[1], '2,')
    await userEvent.tab()
    expect(campos[1].value).toBe('2,')
    await userEvent.type(campos[1], '5')
    expect(campos[1].value).toBe('2,5')
  })
})
