import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clear } from 'idb-keyval'
import * as api from '../../src/lib/api'
import { enfileirar, errosDaFila, pendentes, processar, type Op } from '../../src/lib/fila'
import AvisoFila from '../../src/components/AvisoFila'

vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const abrir: Op = { id: 'a', tipo: 'abrir_compra', args: { p_id: 'c1', p_semana: 7, p_loja: 'FEIRA' } }

beforeEach(async () => {
  vi.resetAllMocks()
  await clear()
  await enfileirar(abrir)
  await processar(async () => { throw new Error('esta lista não está liberada para compra') })
})

describe('AvisoFila', () => {
  it('"Tentar de novo" devolve as operações com erro para a fila e envia', async () => {
    render(<AvisoFila />)
    expect(await screen.findByText(/não foi possível registrar: esta lista não está liberada/i)).toBeInTheDocument()
    m.executarOp.mockResolvedValue()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(m.executarOp).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' })))
    await waitFor(() => expect(screen.queryByText(/não foi possível registrar/i)).not.toBeInTheDocument())
    expect(await pendentes()).toEqual([])
    expect(await errosDaFila()).toEqual([])
  })

  it('"OK" descarta os erros', async () => {
    render(<AvisoFila />)
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }))
    await waitFor(() => expect(screen.queryByText(/não foi possível registrar/i)).not.toBeInTheDocument())
    expect(await errosDaFila()).toEqual([])
    expect(m.executarOp).not.toHaveBeenCalled()
  })
})
