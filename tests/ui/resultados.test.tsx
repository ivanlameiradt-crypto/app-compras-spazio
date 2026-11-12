import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import * as api from '../../src/lib/api'
import Resultados from '../../src/admin/Resultados'
import CompraHome from '../../src/admin/CompraHome'
import { SlotDoTitulo } from '../../src/components/TituloDaTela'
import { item, linha } from '../fabricas'
import type { PainelEconomia } from '../../src/lib/tipos'

// Etapa 5 do redesenho da Compra (12/11/2026): Resumo e Economia viram duas abas de uma tela só, /resultados. Dados inventados.
vi.mock('../../src/lib/api')
const m = vi.mocked(api)

const SEMANA = { id: 7, data_referencia: '2026-09-22', status: 'em_compra' as const, aprovada_por: null, aprovada_em: null }
const met = { pedidos: 1, itens: 1, comparados: 1, sem_comparacao: 0, acima: 0, total_pedido: 200, total_ultimo: 240, diferenca: -40, pct: 200 / 240 - 1 }
const PAINEL: PainelEconomia = {
  de: '2026-09-01', ate: '2026-10-31', inicio: '2026-09-28', total: met, desde_inicio: { diferenca: -40, semanas: 1 },
  semanas: [{ ...met, semana_id: 1, data_referencia: '2026-09-28', status: 'encerrada', acumulado: -40, acumulado_desde_inicio: -40 }],
  meses: [{ ...met, mes: '2026-09-01' }], vendedores: [], categorias: [], itens: [], sem_comparacao: [], sischef: { altas: [], quedas: [] },
}

/** Mostra onde o roteador está (caminho + ?aba=) para o teste conferir a URL. */
function Local() {
  const l = useLocation()
  return <output data-testid="local">{l.pathname + l.search}</output>
}
function abrir(rota: string, slot: HTMLElement | null = null) {
  return render(
    <SlotDoTitulo.Provider value={slot}>
      <MemoryRouter initialEntries={[rota]}><Resultados /><Local /></MemoryRouter>
    </SlotDoTitulo.Provider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  m.listarSemanas.mockResolvedValue([SEMANA])
  m.itensDaSemana.mockResolvedValue([item({ id: 1, produto: 'PRODUTO TESTE UM', qtd_aprovada: 10, preco_estimado: 2 })])
  m.linhasDaSemana.mockResolvedValue([linha({ item_semana_id: 1, qtd: 10, preco_unit: 2 })])
  m.comprasAbertas.mockResolvedValue([])
  m.encerrarSemana.mockResolvedValue()
  m.painelEconomia.mockResolvedValue(PAINEL)
})

describe('Resultados: Semana (Resumo) e Economia numa tela só', () => {
  it('abre na aba Semana, que é o Resumo (com o "Encerrar semana"), e não lê a Economia', async () => {
    abrir('/resultados')
    expect(await screen.findByRole('button', { name: 'Encerrar semana' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Semana' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Economia' })).toHaveAttribute('aria-selected', 'false')
    expect(m.itensDaSemana).toHaveBeenCalledWith(7)
    expect(m.painelEconomia).not.toHaveBeenCalled()
  })

  it('?aba=economia abre direto na Economia (e não lê a semana do Resumo)', async () => {
    abrir('/resultados?aba=economia')
    expect(await screen.findByTestId('economia-valor')).toHaveTextContent('R$ 40,00')
    expect(screen.getByRole('tab', { name: 'Economia' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Semana' })).toHaveAttribute('aria-selected', 'false')
    expect(m.listarSemanas).not.toHaveBeenCalled()
  })

  it('aba desconhecida na URL cai na Semana', async () => {
    abrir('/resultados?aba=qualquer')
    expect(await screen.findByRole('button', { name: 'Encerrar semana' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Semana' })).toHaveAttribute('aria-selected', 'true')
  })

  it('tocar na aba Economia troca de tela e grava ?aba=economia na URL; voltar à Semana tira o parâmetro', async () => {
    abrir('/resultados')
    await screen.findByRole('button', { name: 'Encerrar semana' })
    await userEvent.click(screen.getByRole('tab', { name: 'Economia' }))
    expect(await screen.findByTestId('economia-valor')).toBeInTheDocument()
    expect(screen.getByTestId('local')).toHaveTextContent('/resultados?aba=economia')
    expect(screen.queryByRole('button', { name: 'Encerrar semana' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Semana' }))
    expect(await screen.findByRole('button', { name: 'Encerrar semana' })).toBeInTheDocument()
    expect(screen.getByTestId('local').textContent).toBe('/resultados')
  })

  it('o "Encerrar semana" do Resumo continua funcionando dentro da aba', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    abrir('/resultados')
    await userEvent.click(await screen.findByRole('button', { name: 'Encerrar semana' }))
    expect(m.encerrarSemana).toHaveBeenCalledWith(7)
  })

  it('a Economia continua trocando de período dentro da aba (chips de período e abas não se confundem)', async () => {
    abrir('/resultados?aba=economia')
    await screen.findByTestId('economia-valor')
    await userEvent.click(screen.getByRole('tab', { name: 'Este mês' }))
    expect(m.painelEconomia).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('tab', { name: 'Economia' })).toHaveAttribute('aria-selected', 'true')
  })

  it('só um título na barra do topo: "Resultados" (Resumo e Economia não escrevem título próprio)', async () => {
    const barra = document.createElement('div')
    document.body.appendChild(barra)
    abrir('/resultados', barra)
    await screen.findByRole('button', { name: 'Encerrar semana' })
    const titulos = screen.getAllByRole('heading')
    expect(titulos).toHaveLength(1)
    expect(titulos[0]).toHaveTextContent('Resultados')
    expect(barra).toContainElement(titulos[0])
    barra.remove()
  })

  it('na aba Economia continua um título só', async () => {
    const barra = document.createElement('div')
    document.body.appendChild(barra)
    abrir('/resultados?aba=economia', barra)
    await screen.findByTestId('economia-valor')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    barra.remove()
  })
})

describe('Menu Compra: 4 cartões e o link Ajustes', () => {
  it('tem Lista · Pedidos · Receber · Resultados, nessa ordem', () => {
    render(<MemoryRouter><CompraHome /></MemoryRouter>)
    const grade = screen.getByRole('navigation', { name: 'Telas de compra' })
    const links = [...grade.querySelectorAll('a')]
    expect(links.map((a) => a.textContent)).toEqual(['Lista', 'Pedidos', 'Receber', 'Resultados'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/lista-semana', '/pedidos', '/receber', '/resultados'])
  })

  it('"Ajustes (produtos, vendedores, feriados)" leva a /cadastros, com ícone de engrenagem, fora da grade', () => {
    render(<MemoryRouter><CompraHome /></MemoryRouter>)
    const ajustes = screen.getByRole('link', { name: 'Ajustes (produtos, vendedores, feriados)' })
    expect(ajustes).toHaveAttribute('href', '/cadastros')
    expect(ajustes.querySelector('svg[data-icone="engrenagem"]')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Telas de compra' })).not.toContainElement(ajustes)
  })
})
