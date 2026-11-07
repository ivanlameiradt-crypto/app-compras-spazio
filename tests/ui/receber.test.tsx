import { render, screen, waitFor } from '@testing-library/react'
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

  it('texto que não é número é marcado como inválido, não vira 0 em silêncio, e ao sair volta ao último valor bom', async () => {
    const campos = await abrirCartao()
    expect(campos[1].value).toBe('20')
    await userEvent.type(campos[1], 'x')                       // "20x"
    expect(campos[1].value).toBe('20x')
    expect(campos[1].getAttribute('aria-invalid')).toBe('true')
    await userEvent.tab()
    expect(campos[1].value).toBe('20')
    expect(campos[1].getAttribute('aria-invalid')).not.toBe('true')
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
