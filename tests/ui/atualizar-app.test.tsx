import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('Botão Atualizar do topo (pedido do Ivan, 07/10: não precisar sair e entrar no app)', () => {
  const montar = () => render(<MemoryRouter><Layout usuario={ADMIN}><p>tela</p></Layout></MemoryRouter>)

  it('o botão está no topo; sem versão nova ele recarrega a tela para ler os dados de novo', async () => {
    a.conferirVersao.mockResolvedValue('igual')
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(a.recarregarPagina).toHaveBeenCalledTimes(1))
    expect(a.conferirVersao).toHaveBeenCalledWith('manual')
  })

  it('com versão nova ele troca de versão (a página recarrega por conta própria): não recarrega duas vezes', async () => {
    a.conferirVersao.mockResolvedValue('aplicando')
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(a.conferirVersao).toHaveBeenCalledWith('manual'))
    expect(a.recarregarPagina).not.toHaveBeenCalled()
  })

  it('sem internet (servidor não responde): ainda recarrega a tela, e o botão não deixa tocar duas vezes enquanto trabalha', async () => {
    let liberar!: (v: 'sem_resposta') => void
    a.conferirVersao.mockReturnValue(new Promise((r) => { liberar = r }))
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    expect(screen.getByRole('button', { name: 'Atualizando…' })).toBeDisabled()
    await act(async () => { liberar('sem_resposta') })
    await waitFor(() => expect(a.recarregarPagina).toHaveBeenCalledTimes(1))
    expect(a.conferirVersao).toHaveBeenCalledTimes(1)
  })
})

describe('Faixa "Há uma versão nova do app"', () => {
  it('sem versão nova a faixa não aparece', () => {
    render(<AvisoNovaVersao />)
    expect(screen.queryByTestId('aviso-nova-versao')).not.toBeInTheDocument()
  })

  it('com versão nova aparece; "Atualizar agora" troca na hora para essa versão', async () => {
    a.useNovaVersao.mockReturnValue('xyz123')
    render(<AvisoNovaVersao />)
    expect(screen.getByTestId('aviso-nova-versao')).toHaveTextContent('Há uma versão nova do app.')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }))
    expect(a.aplicarNovaVersao).toHaveBeenCalledWith('xyz123')
  })

  it('o Layout mostra a faixa junto das outras avisos do topo', () => {
    a.useNovaVersao.mockReturnValue('xyz123')
    render(<MemoryRouter><Layout usuario={ADMIN}><p>tela</p></Layout></MemoryRouter>)
    expect(screen.getByTestId('aviso-nova-versao')).toBeInTheDocument()
  })
})
