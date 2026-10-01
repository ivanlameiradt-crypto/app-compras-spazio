import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as cad from '../../src/cadastros/api'
import Vendedores from '../../src/admin/cadastros/Vendedores'

vi.mock('../../src/cadastros/api')
const m = vi.mocked(cad)

const fulano = { id: 1, codigo: 'fulano', nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', ativo: false }

// a lista de cadastrados começa recolhida; abri-la antes de mexer nos cartões
const abrirCadastrados = async () => userEvent.click(await screen.findByRole('button', { name: /Fornecedores cadastrados/ }))

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
    await abrirCadastrados()
    const cartao = (await screen.findByText('ATACADÃO')).closest('.cartao') as HTMLElement
    expect(cartao.textContent).toContain('+55 91 9····-1234')
    expect(within(cartao).getByText('Desligado')).toBeInTheDocument()
  })

  it('cadastrar com "(91) 90000-1234" chama salvarVendedor com o número normalizado', async () => {
    render(<Vendedores />)
    await userEvent.click(await screen.findByRole('button', { name: /Cadastrar novo fornecedor/ }))
    await userEvent.type(screen.getByLabelText('Empresa'), 'MERCADÃO')
    await userEvent.type(screen.getByLabelText('Nome para o vendedor'), 'Ana')
    await userEvent.type(screen.getByLabelText('WhatsApp'), '(91) 90000-1234')
    expect(screen.getByText('Vai gravar: +55 91 90000-1234')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar vendedor' }))
    expect(m.salvarVendedor).toHaveBeenCalledWith({ nome: 'Ana', empresa: 'MERCADÃO', whatsapp: '5591900001234' })
  })

  it('"Testar número" é um link wa.me sem texto', async () => {
    render(<Vendedores />)
    await abrirCadastrados()
    const link = await screen.findByRole('link', { name: 'Testar número' })
    expect(link).toHaveAttribute('href', 'https://wa.me/5591900001234')
  })

  it('Ligar mostra o aviso com os itens e a hora, e só grava no segundo toque', async () => {
    m.salvarVendedor.mockResolvedValueOnce({ ok: false, confirmar: [{ codigo: 'aguardando', itens: 3, ate: '2026-10-20T15:00:00Z' }] })
    render(<Vendedores />)
    await abrirCadastrados()
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
    await userEvent.click(await screen.findByRole('button', { name: /Fornecedores do SisChef sem vendedor/ }))
    const seletor = await screen.findByLabelText('Atribuir a ATACADAO S.A.')
    await userEvent.selectOptions(seletor, '1')
    expect(m.salvarGrafia).toHaveBeenCalledWith('ATACADAO S.A.', 1)
    await waitFor(() => expect(screen.queryByText(/ATACADAO S\.A\. — 23 produtos/)).not.toBeInTheDocument())
  })

  it('Editar abre o formulário preenchido e salva com o id e os campos alterados', async () => {
    render(<Vendedores />)
    await abrirCadastrados()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Editar empresa')).toHaveValue('ATACADÃO (Loja)')
    expect(screen.getByLabelText('Editar WhatsApp')).toHaveValue('+55 91 90000-1234')
    const nome = screen.getByLabelText('Editar nome')
    expect(nome).toHaveValue('Carlos')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Carlos Silva')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(m.salvarVendedor).toHaveBeenCalledWith({ id: 1, nome: 'Carlos Silva', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234' })
  })

  it('Editar com WhatsApp repetido só grava no segundo toque (confirmação)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    m.salvarVendedor.mockResolvedValueOnce({ ok: false, confirmar: [{ codigo: 'whatsapp_repetido', empresa: 'Outro' }] })
    m.salvarVendedor.mockResolvedValueOnce({ ok: true, id: 1, codigo: 'fulano' })
    render(<Vendedores />)
    await abrirCadastrados()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(m.salvarVendedor).toHaveBeenLastCalledWith({ id: 1, nome: 'Carlos', empresa: 'ATACADÃO (Loja)', whatsapp: '5591900001234', confirmar: ['whatsapp_repetido'] })
    confirmSpy.mockRestore()
  })

  it('a busca filtra os fornecedores pelo nome', async () => {
    m.listarVendedores.mockResolvedValue([
      fulano,
      { id: 2, codigo: 'mercadao', nome: 'Ana', empresa: 'MERCADÃO', whatsapp: '5591988887777', ativo: false },
    ])
    render(<Vendedores />)
    await abrirCadastrados()
    expect(await screen.findByText('ATACADÃO')).toBeInTheDocument()
    expect(screen.getByText('MERCADÃO')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Procurar fornecedor'), 'merc')
    expect(screen.queryByText('ATACADÃO')).not.toBeInTheDocument()
    expect(screen.getByText('MERCADÃO')).toBeInTheDocument()
  })

  it('Cancelar a edição volta para o cartão sem gravar', async () => {
    render(<Vendedores />)
    await abrirCadastrados()
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Editar nome')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(m.salvarVendedor).not.toHaveBeenCalled()
  })
})
