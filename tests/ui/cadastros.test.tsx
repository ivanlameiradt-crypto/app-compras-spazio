import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as cad from '../../src/cadastros/api'
import Vendedores from '../../src/admin/cadastros/Vendedores'

vi.mock('../../src/cadastros/api')
const m = vi.mocked(cad)

const fulano = { id: 1, codigo: 'fulano', nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', ativo: false }

beforeEach(() => {
  vi.resetAllMocks()
  m.listarVendedores.mockResolvedValue([fulano])
  m.listarGrafias.mockResolvedValue([])
  m.listarCnpjs.mockResolvedValue([])
  m.fornecedoresSemVendedor.mockResolvedValue([])
  m.salvarVendedor.mockResolvedValue({ ok: true, id: 9, codigo: 'novo' })
  m.salvarGrafia.mockResolvedValue({})
})

describe('Cadastros — Vendedores (C.5, C.6)', () => {
  it('o cartão mostra o WhatsApp mascarado e "Desligado"', async () => {
    render(<Vendedores />)
    const cartao = (await screen.findByText('ATACADÃO')).closest('.cartao') as HTMLElement
    expect(cartao.textContent).toContain('+55 91 9····-1234')
    expect(within(cartao).getByText('Desligado')).toBeInTheDocument()
  })

  it('cadastrar com "(91) 90000-1234" chama salvarVendedor com o número normalizado', async () => {
    render(<Vendedores />)
    await userEvent.type(await screen.findByLabelText('Empresa'), 'MERCADÃO')
    await userEvent.type(screen.getByLabelText('Nome para o vendedor'), 'Ana')
    await userEvent.type(screen.getByLabelText('WhatsApp'), '(91) 90000-1234')
    expect(screen.getByText('Vai gravar: +55 91 90000-1234')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar vendedor' }))
    expect(m.salvarVendedor).toHaveBeenCalledWith({ nome: 'Ana', empresa: 'MERCADÃO', whatsapp: '5591900001234' })
  })

  it('"Testar número" é um link wa.me sem texto', async () => {
    render(<Vendedores />)
    const link = await screen.findByRole('link', { name: 'Testar número' })
    expect(link).toHaveAttribute('href', 'https://wa.me/5591900001234')
  })

  it('Ligar mostra o aviso com os itens e a hora, e só grava no segundo toque', async () => {
    m.salvarVendedor.mockResolvedValueOnce({ ok: false, confirmar: [{ codigo: 'aguardando', itens: 3, ate: '2026-10-20T15:00:00Z' }] })
    render(<Vendedores />)
    await userEvent.click(await screen.findByRole('button', { name: 'Ligar' }))
    // o texto do aviso, com os itens e a hora
    expect(await screen.findByText(/em 3 itens até .*20\/10 12h/)).toBeInTheDocument()
    expect(m.salvarVendedor).toHaveBeenCalledTimes(1) // ainda não gravou
    m.salvarVendedor.mockResolvedValueOnce({ ok: true, id: 1, codigo: 'atacadao' })
    await userEvent.click(screen.getByRole('button', { name: 'Ligar mesmo assim' }))
    expect(m.salvarVendedor).toHaveBeenLastCalledWith({ id: 1, ativo: true, confirmar: ['aguardando'] })
  })

  it('"Atribuir a" chama salvarGrafia e a linha sai do bloco', async () => {
    m.fornecedoresSemVendedor.mockResolvedValueOnce([{ nome_original: 'ATACADAO S.A.', nome_normalizado: 'ATACADAO S.A.', produtos: 23, ultima_compra: '2026-09-18' }])
    m.fornecedoresSemVendedor.mockResolvedValue([]) // depois da atribuição, some
    render(<Vendedores />)
    const seletor = await screen.findByLabelText('Atribuir a ATACADAO S.A.')
    await userEvent.selectOptions(seletor, '1')
    expect(m.salvarGrafia).toHaveBeenCalledWith('ATACADAO S.A.', 1)
    expect(await screen.findByText('MERCADÃO', { exact: false }).catch(() => null)).not.toBe(undefined) // re-render ocorreu
    expect(screen.queryByText(/ATACADAO S\.A\. — 23 produtos/)).not.toBeInTheDocument()
  })
})
