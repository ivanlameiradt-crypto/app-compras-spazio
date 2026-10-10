import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import FreteDaNota, { type FreteConfirmado } from '../../src/admin/FreteDaNota'
import * as api from '../../src/lib/api'
import NotaSefaz from '../../src/admin/NotaSefaz'
import type { NotaSefazLista } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const CHAVE_SP = '35261008637193000106550010001207101371230333'
const ITENS = [{ descricao: 'EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND', valor: 1516, quantidade: 40, unidade: 'pct' }]

/** O componente com o estado que a nota dá a ele (controlado): "Com frete" escolhido e o frete confirmado. */
function Casca({ chave = CHAVE_SP, itens = ITENS as typeof ITENS | null }: { chave?: string; itens?: typeof ITENS | null }) {
  const [com, setCom] = useState(false)
  const [frete, setFrete] = useState<FreteConfirmado | null>(null)
  return <FreteDaNota chave={chave} valorNota={1516} itens={itens} comFrete={com} aoTrocarModo={(v) => { setCom(v); if (!v) setFrete(null) }} confirmado={frete} aoMudar={setFrete} />
}

describe('FreteDaNota', () => {
  it('nota de fora do Pará: pergunta se tem frete (com o estado), e "Sem frete" é o padrão: nada a preencher', () => {
    render(<Casca />)
    expect(screen.getByTestId('aviso-fora-do-para')).toHaveTextContent('fora do Pará (SP)')
    expect(screen.getByTestId('sem-frete')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('valor-frete')).not.toBeInTheDocument()
  })

  it('nota do Pará: sem o aviso (mas o botão "Com frete" continua ao alcance)', () => {
    render(<Casca chave={'15261003995515011363550020000892841000892852'} />)
    expect(screen.queryByTestId('aviso-fora-do-para')).not.toBeInTheDocument()
    expect(screen.getByTestId('com-frete')).toBeEnabled()
  })

  it('"Com frete" abre o valor e o tipo (as opções do SisChef; FOB por padrão); a conta aparece ao digitar', async () => {
    render(<Casca />)
    await userEvent.click(screen.getByTestId('com-frete'))
    expect(screen.getByTestId('tipo-frete')).toHaveValue('1')
    expect(within(screen.getByTestId('tipo-frete')).getAllByRole('option')).toHaveLength(6)
    await userEvent.type(screen.getByTestId('valor-frete'), '300,00')
    expect(screen.getByTestId('percentual-frete')).toHaveTextContent('19,79%')
    expect(screen.getByTestId('rateio-frete')).toHaveTextContent('R$ 37,90 + R$ 7,50 = R$ 45,40 por pct')
    expect(screen.getByTestId('preco-por-unidade')).toHaveTextContent('R$ 1,816')
    expect(screen.getByTestId('frete-fora-do-financeiro')).toHaveTextContent('boletos continuam com o valor da nota (R$ 1.516,00)')
  })

  it('confirmar sem valor: erro e nada confirmado; com valor: mostra "Frete confirmado" e deixa mudar', async () => {
    render(<Casca />)
    await userEvent.click(screen.getByTestId('com-frete'))
    expect(screen.getByTestId('confirmar-frete')).toBeDisabled()
    await userEvent.type(screen.getByTestId('valor-frete'), '300')
    await userEvent.click(screen.getByTestId('confirmar-frete'))
    expect(screen.getByTestId('frete-confirmado')).toHaveTextContent('Frete confirmado: R$ 300,00 (19,79% da nota)')
    // depois de confirmar, o preço unitário final continua à vista (junto do "Lançar"): R$ 37,90 da nota + R$ 7,50 de frete = R$ 45,40 por pct
    expect(screen.getByTestId('preco-final-frete')).toHaveTextContent('Preço unitário final: R$ 45,40 por pct')
    expect(screen.getByTestId('preco-final-frete')).toHaveTextContent('R$ 37,90 da nota + R$ 7,50 de frete')
    // o nome diz "PCT 25 UND": o preço de cada unidade solta = R$ 45,40 ÷ 25
    expect(screen.getByTestId('preco-por-unidade')).toHaveTextContent('Preço de cada unidade (pacote de 25): R$ 1,816')
    await userEvent.click(screen.getByTestId('mudar-frete'))
    expect(screen.getByTestId('valor-frete')).toHaveValue('300')
  })

  it('voltar para "Sem frete" apaga o frete confirmado', async () => {
    render(<Casca />)
    await userEvent.click(screen.getByTestId('com-frete'))
    await userEvent.type(screen.getByTestId('valor-frete'), '300')
    await userEvent.click(screen.getByTestId('confirmar-frete'))
    await userEvent.click(screen.getByTestId('sem-frete'))
    expect(screen.queryByTestId('frete-confirmado')).not.toBeInTheDocument()
    expect(screen.getByTestId('sem-frete')).toHaveAttribute('aria-pressed', 'true')
  })

  it('sem o valor de cada item (nota com vários itens): mostra o percentual e diz que o SisChef distribui', async () => {
    render(<Casca itens={null} />)
    await userEvent.click(screen.getByTestId('com-frete'))
    await userEvent.type(screen.getByTestId('valor-frete'), '300')
    expect(screen.getByTestId('percentual-frete')).toHaveTextContent('19,79%')
    expect(screen.queryByTestId('rateio-frete')).not.toBeInTheDocument()
    expect(screen.getByTestId('conta-frete')).toHaveTextContent('SisChef distribui o frete entre os itens')
  })
})

// ---- dentro da nota (lancarNota leva o frete; "Com frete" sem confirmar trava o Lançar) ----
const nota = (): NotaSefazLista => ({
  chave: CHAVE_SP, cnpj_emitente: '08637193000106', emitente: 'TAMAROZZI COMERCIO DE EMBALAGENS LTDA', numero: '000120710', emissao: '2026-10-08', valor_nf: 1516, situacao: 'na_fila',
  lancada_em: null, nf_sischef: null, parcelas: [{ numero: '001', vencimento: '2026-11-05', valor: 758 }, { numero: '002', vencimento: '2026-11-12', valor: 758 }],
  itens: [{ n: 1, qtd: 40, descricao: 'CÓD. FOR: 2350LG EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND', associacao: 'sischef', produto_id: 3716228, produto_nome: 'EMBALAGEM P/ PIZZA N. 35 - PCT 25 UND', unidade_sischef: 'PCT' }],
} as NotaSefazLista)

describe('NotaSefaz com frete', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.notasALancar.mockResolvedValue([nota()])
    m.notasLancadas.mockResolvedValue([])
    m.notasDescartadas.mockResolvedValue([])
    m.formasPadraoPorFornecedor.mockResolvedValue({})
    m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
    m.catalogoProdutos.mockResolvedValue([])
    m.fantasiasDosFornecedores.mockResolvedValue({})
    m.lancarNota.mockResolvedValue(undefined)
  })

  it('"Com frete" ainda sem confirmar trava o Lançar e avisa; confirmado, o Lançar leva o frete (e a parcela do XML) ao servidor', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByTestId('com-frete'))
    expect(screen.getByRole('button', { name: 'Lançar' })).toBeDisabled()
    expect(screen.getByTestId('frete-pendente')).toHaveTextContent('Confirme o frete')
    await userEvent.type(screen.getByTestId('valor-frete'), '300')
    await userEvent.click(screen.getByTestId('confirmar-frete'))
    expect(screen.queryByTestId('frete-pendente')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lançar' }))
    expect(screen.getByText(/com frete de R\$ 300,00/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE_SP, 'boleto', undefined, { valor: 300, tipo: '1' })
  })

  it('"Sem frete" (o padrão) lança como sempre: o 4º argumento nem existe', async () => {
    render(<NotaSefaz />)
    await screen.findByTestId('nota-a-lancar')
    await userEvent.click(screen.getByRole('button', { name: 'Lançar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(m.lancarNota).toHaveBeenCalledWith(CHAVE_SP, 'boleto')
  })
})
