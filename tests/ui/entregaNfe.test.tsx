import { render, screen, waitFor } from '@testing-library/react'
import * as api from '../../src/lib/api'
import EntregaNfe from '../../src/admin/cotacoes/EntregaNfe'
import type { Desempenho, LinhaConferencia, NfeResumo, Vendedor } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const V: Vendedor = { id: 1, codigo: 'mateus', nome: 'Fulano', empresa: 'MATEUS (Mix)', whatsapp: '5511900000001', ativo: true }

function linha(over: Partial<LinhaConferencia> = {}): LinhaConferencia {
  return {
    cotacao_id: 7, confirmado_em: '2026-10-21T13:00:00Z', entrega_prevista: '2026-10-22',
    numero: 2, produto_id: 1001, nome: 'COCA', unidade: 'un', qtd: 108, base: 'embalagem', embalagens: 9, fator: 12,
    preco_combinado: 42, preco_convertido: 3.5, marca: null, chegou: 108, avaria: 0, falta: 0, resto: null,
    falta_definitiva: 0, recebimento: 'completo', nf_chaves: ['k'], nf_qtd: 108, qtd_nf: 'igual', preco: 'igual',
    valor_acima: 0, combinado_unit: 3.5, cobrado_unit: 3.5, imposto: 0, marca_nf: 'ok', motivos: [], ...over,
  }
}
const nfe = (over: Partial<NfeResumo> = {}): NfeResumo => ({
  chave: 'k', numero: '123456', emissao: '2026-10-21', valor_nf: 408, emitente: 'MATEUS SA', cnpj_emitente: '12345678000190',
  situacao: 'na_fila', saiu_da_fila_em: null, lancada_em: null, nf_sischef: null, vendedor_id: 1, cotacao_id: 7, vinculo: 'auto', ...over,
})

beforeEach(() => {
  m.conferencia.mockResolvedValue([linha()])
  m.nfesDosPedidos.mockResolvedValue([nfe()])
  m.desempenho.mockResolvedValue([])
  m.nfesSemPedido.mockResolvedValue([])
})

it('mostra a entrega prevista, o estado do recebimento e a NF-e casada', async () => {
  render(<EntregaNfe cotacao={7} vendedor={V} />)
  expect(await screen.findByText(/Entrega prevista qui 22\/10/)).toBeTruthy()
  expect(screen.getByText(/Recebido — completo/)).toBeTruthy()
  expect(screen.getByText(/NF-e 123456/)).toBeTruthy()
  expect(screen.getByText(/na fila do SisChef, ainda não lançada/)).toBeTruthy()
})

it('item acima aparece em vermelho e oferece copiar a mensagem de diferença', async () => {
  m.conferencia.mockResolvedValue([linha({ preco: 'acima', valor_acima: 18, cobrado_unit: 3.6667 })])
  render(<EntregaNfe cotacao={7} vendedor={V} />)
  await waitFor(() => expect(screen.getByText('+R$ 18,00')).toBeTruthy())
  expect(screen.getByRole('button', { name: /Copiar mensagem de diferença/ })).toBeTruthy()
})

it('sem NF casada, lista as NF-e do vendedor sem pedido com "É deste pedido"', async () => {
  m.nfesDosPedidos.mockResolvedValue([])
  m.conferencia.mockResolvedValue([linha({ nf_chaves: [], preco: 'sem_nf', qtd_nf: 'sem_nf', marca_nf: null })])
  m.nfesSemPedido.mockResolvedValue([nfe({ chave: 'z', cotacao_id: null, vinculo: null })])
  render(<EntregaNfe cotacao={7} vendedor={V} />)
  expect(await screen.findByText(/NF-e ainda não apareceu/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'É deste pedido' })).toBeTruthy()
})
