import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TituloDaTela, { SlotDoTitulo } from '../../src/components/TituloDaTela'

afterEach(() => { vi.unstubAllGlobals() })

describe('TituloDaTela', () => {
  it('sem barra (tela solta), fica no lugar como título de segundo nível', () => {
    render(<TituloDaTela>Resumo</TituloDaTela>)
    expect(screen.getByRole('heading', { level: 2, name: 'Resumo' })).toBeInTheDocument()
  })

  it('com a barra preta (celular e tablet), vai para dentro dela como título principal', () => {
    const barra = document.createElement('div')
    document.body.appendChild(barra)
    render(<SlotDoTitulo.Provider value={barra}><TituloDaTela>Lançamentos</TituloDaTela></SlotDoTitulo.Provider>)
    expect(within(barra).getByRole('heading', { level: 1, name: 'Lançamentos' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Lançamentos' })).toHaveLength(1)
    barra.remove()
  })

  it('no computador largo (1280 ou mais) o título fica no conteúdo, não na barra', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('1280'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const barra = document.createElement('div')
    document.body.appendChild(barra)
    render(<SlotDoTitulo.Provider value={barra}><TituloDaTela>Cupom</TituloDaTela></SlotDoTitulo.Provider>)
    expect(barra).toBeEmptyDOMElement()
    expect(screen.getByRole('heading', { level: 2, name: 'Cupom' })).toBeInTheDocument()
    barra.remove()
  })
})
