import { render, screen } from '@testing-library/react'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { clear } from 'idb-keyval'
import { item } from '../fabricas'

const getSession = vi.fn()
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}))
vi.mock('../../src/lib/api')

import * as api from '../../src/lib/api'
import App from '../../src/App'
import { guardarUsuario } from '../../src/auth/usuarioGuardado'

const m = vi.mocked(api)
const joao = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador' as const, ativo: true }
const semana = { id: 7, data_referencia: '2026-09-22', status: 'em_compra' as const, aprovada_por: null, aprovada_em: null }

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  await clear()
  const semRede = new Error('TypeError: Failed to fetch')
  m.semanaEmCompra.mockRejectedValue(semRede)
  m.itensDaSemana.mockRejectedValue(semRede)
  m.linhasDaSemana.mockRejectedValue(semRede)
  m.lojasUsadas.mockRejectedValue(semRede)
  m.contarAguardando.mockRejectedValue(semRede)
  m.nomesEquipe.mockRejectedValue(semRede)
})
afterEach(() => { vi.restoreAllMocks() })

describe('reabrir o app sem internet', () => {
  it('token vencido e sem internet: mostra o checklist, não o login', async () => {
    guardarUsuario(joao)
    localStorage.setItem('compra-aberta', JSON.stringify({ id: 'c1', semanaId: 7, loja: 'ATACADÃO' }))
    localStorage.setItem('cache-comprar', JSON.stringify({ semana, itens: [item({ id: 1, produto: 'COCA COLA 350 ML', qtd_aprovada: 52 })], linhas: [] }))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })

    render(<App />)

    expect(await screen.findByRole('button', { name: /COCA COLA 350 ML/ })).toBeInTheDocument()
    expect(screen.getByText(/sem internet — seus itens serão enviados quando voltar/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument()
  })

  it('sem usuário guardado continua indo para o login', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('P3: troca de senha pendente e offline não deixa entrar no checklist', async () => {
    guardarUsuario(joao, { trocarSenha: true })
    localStorage.setItem('compra-aberta', JSON.stringify({ id: 'c1', semanaId: 7, loja: 'ATACADÃO' }))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })

    render(<App />)

    expect(await screen.findByText('Escolha sua senha')).toBeInTheDocument()
    expect(screen.getByText('Sem internet. Conecte para escolher sua senha.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /COCA COLA/ })).not.toBeInTheDocument()
  })
})
