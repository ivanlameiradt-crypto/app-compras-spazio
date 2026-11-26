import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BarreiraDeErro from '../../src/components/BarreiraDeErro'
import VerMais, { Recolher } from '../../src/components/pecas/VerMais'

// Revisão final de 25/11/2026: quando uma tela quebrava ao ser desenhada ficava tudo branco, sem aviso. Agora aparece o aviso de erro do manual
// (faixa vermelha + frase simples + "Tentar de novo"). E as peças "Ver mais" e "Recolher" só encurtam a tela no celular.

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function Quebra({ quebrar }: { quebrar: boolean }) {
  if (quebrar) throw new Error('daSemana is not iterable')
  return <p>tela boa</p>
}

describe('BarreiraDeErro', () => {
  it('sem erro, mostra a tela como ela é', () => {
    render(<BarreiraDeErro><Quebra quebrar={false} /></BarreiraDeErro>)
    expect(screen.getByText('tela boa')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('tela que quebra: aviso com frase simples (sem o texto técnico) e o botão "Tentar de novo", que recarrega a tela', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recarregar = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: recarregar })
    render(<BarreiraDeErro><Quebra quebrar /></BarreiraDeErro>)
    const aviso = screen.getByRole('alert')
    expect(aviso).toHaveTextContent('Não consegui abrir esta tela.')
    expect(aviso).not.toHaveTextContent('is not iterable')
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(recarregar).toHaveBeenCalledTimes(1)
  })

  it('trocar de tela (a chave muda) limpa o aviso: as outras telas continuam abrindo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(<BarreiraDeErro chave="/pessoas"><Quebra quebrar /></BarreiraDeErro>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(<BarreiraDeErro chave="/compra"><Quebra quebrar={false} /></BarreiraDeErro>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('tela boa')).toBeInTheDocument()
  })
})

const lista = (itens: string[]) => (
  <VerMais itens={itens} primeiros={2} unidade={['produto', 'produtos']}>
    {(mostrados) => <ul>{mostrados.map((i) => <li key={i}>{i}</li>)}</ul>}
  </VerMais>
)
const celular = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 767px'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }))

describe('VerMais e Recolher (tela de até 2,5 alturas no celular)', () => {
  it('no tablet e no computador a lista aparece inteira, sem botão', () => {
    render(lista(['a', 'b', 'c', 'd', 'e']))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('no celular mostra os primeiros e "Ver mais N produtos" abre todos, na mesma ordem', async () => {
    celular()
    render(lista(['a', 'b', 'c', 'd', 'e']))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Ver mais 3 produtos' }))
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('no celular, lista com só um item a mais que o corte aparece inteira (não vale um botão para um item)', () => {
    celular()
    render(lista(['a', 'b', 'c']))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('Recolher: aberto no computador, fechado no celular; o conteúdo continua na tela', () => {
    const { unmount } = render(<Recolher titulo="Por vendedor"><p>tabela</p></Recolher>)
    expect(screen.getByText('Por vendedor').closest('details')).toHaveAttribute('open')
    unmount()
    celular()
    render(<Recolher titulo="Por vendedor"><p>tabela</p></Recolher>)
    expect(screen.getByText('Por vendedor').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('tabela')).toBeInTheDocument()
  })
})
