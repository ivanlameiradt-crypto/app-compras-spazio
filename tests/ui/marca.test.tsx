import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogoComprar, NomeComprar, SimboloComprar } from '../../src/components/marca/Comprar'
import { Icone } from '../../src/components/Icones'
import TelaAbertura from '../../src/components/marca/TelaAbertura'

describe('marca Comprar', () => {
  it('o logo e o nome falam "Comprar" para quem usa leitor de tela; o símbolo é só enfeite', () => {
    const { container } = render(<><LogoComprar /><NomeComprar /><SimboloComprar /></>)
    expect(screen.getAllByRole('img', { name: 'Comprar' })).toHaveLength(2)
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  })

  it('usa as cores do manual da Spazio: amarelo #FFD201 e preto #231F20', () => {
    const { container } = render(<LogoComprar />)
    const cores = [...container.querySelectorAll('[fill], [stroke]')].flatMap((e) => [e.getAttribute('fill'), e.getAttribute('stroke')])
    expect(cores).toContain('#FFD201')
    expect(cores).toContain('#231F20')
  })

  it('a tela de abertura mostra o nome, a mensagem e o selo da Spazio', () => {
    render(<TelaAbertura mensagem="Conferindo seu acesso…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Conferindo seu acesso…')
    expect(screen.getByText('Spazio Gourmet e Kūkan Sushi')).toBeInTheDocument()
    expect(screen.getByText('Lançamento de compra e estoque')).toBeInTheDocument()
  })

  it('os ícones são desenho de traço e enfeite (nunca falam sozinhos nem usam emoji)', () => {
    const { container } = render(<Icone nome="carrinho" tamanho={30} />)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg).toHaveAttribute('width', '30')
    expect(container.textContent).toBe('')
  })
})
