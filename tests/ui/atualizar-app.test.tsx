import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../../src/lib/api'
import * as atualizacao from '../../src/lib/atualizacao'
import Layout from '../../src/components/Layout'
import AvisoNovaVersao from '../../src/components/AvisoNovaVersao'
import type { Usuario } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/atualizacao')
const a = vi.mocked(atualizacao)
const m = vi.mocked(api)

const ADMIN: Usuario = { email: 'ivan@spazio.invalid', nome: 'Ivan', papel: 'admin', ativo: true } as Usuario

beforeEach(() => {
  vi.resetAllMocks()
  m.contarAguardando.mockResolvedValue(0)
  a.useNovaVersao.mockReturnValue(null)
})

describe('O botão "Atualizar" do topo saiu (pedido do Ivan, 24/11/2026): a janela obrigatória de versão nova já pede a atualização', () => {
  it('a barra de cima não tem mais o botão Atualizar', () => {
    render(<MemoryRouter><Layout usuario={ADMIN}><p>tela</p></Layout></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument()
  })
})

describe('Janela "Tem uma versão nova do app." (regra do dono, 13/11: nunca recarrega sozinho; só quando a pessoa clica. Desde 16/11 é janela obrigatória: ver aviso-versao-obrigatorio.test.tsx)', () => {
  it('sem versão nova a janela não aparece', () => {
    render(<AvisoNovaVersao />)
    expect(screen.queryByTestId('aviso-nova-versao')).not.toBeInTheDocument()
  })

  it('com versão nova aparece a janela (role=alertdialog) com o texto e o botão "Atualizar agora"; ao aparecer NÃO troca nem recarrega nada', () => {
    a.useNovaVersao.mockReturnValue('xyz123')
    render(<AvisoNovaVersao />)
    const janela = screen.getByRole('alertdialog')
    expect(screen.getByTestId('aviso-nova-versao')).toContainElement(janela)
    expect(janela).toHaveTextContent('Tem uma versão nova do app.')
    expect(within(janela).getByRole('button', { name: 'Atualizar agora' })).toBeInTheDocument()
    expect(a.aplicarNovaVersao).not.toHaveBeenCalled()
    expect(a.recarregarPagina).not.toHaveBeenCalled()
  })

  it('só ao clicar em "Atualizar" troca para essa versão', () => {
    a.useNovaVersao.mockReturnValue('xyz123')
    render(<AvisoNovaVersao />)
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(a.aplicarNovaVersao).toHaveBeenCalledTimes(1)
    expect(a.aplicarNovaVersao).toHaveBeenCalledWith('xyz123')
  })

  it('o Layout mostra a janela (e só ela: o botão Atualizar do topo saiu)', () => {
    a.useNovaVersao.mockReturnValue('xyz123')
    render(<MemoryRouter><Layout usuario={ADMIN}><p>tela</p></Layout></MemoryRouter>)
    expect(screen.getByTestId('aviso-nova-versao')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atualizar' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Atualizar agora' })).toHaveLength(1) // o da janela
  })
})
