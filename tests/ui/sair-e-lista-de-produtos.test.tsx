// 13/11/2026 (pedido do Ivan: "pode fazer os dois pequenos"), sobras da reanálise das telas de lançamento:
// 1. "Sair" e "Trocar minha senha" (topo do app) saíam da tela sem perguntar, jogando fora a compra avulsa ou a correção de cupom em preenchimento;
//    agora perguntam como o "Atualizar" e as abas já faziam (lib/naoEnviado). Sem dados pendentes, nada muda.
// 2. Na nota fiscal, quando a lista de produtos não carregava, a caixa de associar dizia "Atualize a página" (o app instalado não tem esse botão do
//    navegador); agora oferece "Tentar de novo", igual ao cupom.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import * as api from '../../src/lib/api'
import * as atualizacao from '../../src/lib/atualizacao'
import Layout from '../../src/components/Layout'
import NotaSefaz from '../../src/admin/NotaSefaz'
import { PERGUNTA_NAO_ENVIADO, marcarNaoEnviado } from '../../src/lib/naoEnviado'
import type { NotaSefazLista, ProdutoCatalogo, Usuario } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/atualizacao')
const a = vi.mocked(atualizacao)
const m = vi.mocked(api)

const ADMIN: Usuario = { email: 'ivan@spazio.invalid', nome: 'Ivan', papel: 'admin', ativo: true } as Usuario
const CATALOGO: ProdutoCatalogo[] = [{ produto_id: 1001, nome: 'TOMATE ITALIANO OU SALADETE - INSUMOS', unidade: 'kg' }]

let confirmar: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.resetAllMocks()
  m.contarAguardando.mockResolvedValue(0)
  a.useNovaVersao.mockReturnValue(null)
  a.conferirVersao.mockResolvedValue('igual')
  m.notasALancar.mockResolvedValue([])
  m.notasLancadas.mockResolvedValue([])
  m.formasPadraoPorFornecedor.mockResolvedValue({})
  m.lancamentosSeguidosEmBoleto.mockResolvedValue({})
  m.notasDescartadas.mockResolvedValue([])
  m.catalogoProdutos.mockResolvedValue(CATALOGO)
  confirmar = vi.spyOn(window, 'confirm')
})
afterEach(() => { marcarNaoEnviado('teste', false); confirmar.mockRestore() })

function Onde() { return <p data-testid="onde">{useLocation().pathname}</p> }
const montar = () => render(<MemoryRouter initialEntries={['/compra-avulsa']}><Layout usuario={ADMIN}><Onde /></Layout></MemoryRouter>)

describe('Topo do app: "Sair" e "Trocar minha senha" perguntam antes de jogar fora o que foi digitado', () => {
  it('SEM dados pendentes nada muda: "Sair" sai e "Trocar minha senha" abre a tela da senha, sem pergunta', async () => {
    montar()
    await userEvent.click(screen.getByRole('link', { name: 'Trocar minha senha' }))
    expect(screen.getByTestId('onde')).toHaveTextContent('/senha')
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(m.sair).toHaveBeenCalledTimes(1)
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('COM dados pendentes o "Sair" pergunta: "Cancelar" não sai; "OK" sai', async () => {
    marcarNaoEnviado('teste', true)
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true)
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_NAO_ENVIADO)
    expect(m.sair).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }))
    expect(m.sair).toHaveBeenCalledTimes(1)
  })

  it('COM dados pendentes o "Trocar minha senha" pergunta: "Cancelar" fica na tela; "OK" abre a tela da senha', async () => {
    marcarNaoEnviado('teste', true)
    confirmar.mockReturnValueOnce(false).mockReturnValueOnce(true)
    montar()
    await userEvent.click(screen.getByRole('link', { name: 'Trocar minha senha' }))
    expect(confirmar).toHaveBeenCalledWith(PERGUNTA_NAO_ENVIADO)
    expect(screen.getByTestId('onde')).toHaveTextContent('/compra-avulsa')
    await userEvent.click(screen.getByRole('link', { name: 'Trocar minha senha' }))
    expect(screen.getByTestId('onde')).toHaveTextContent('/senha')
  })
})

const CHAVE = '3'.repeat(44)
const notaComItemSemProduto = (): NotaSefazLista => ({
  chave: CHAVE, cnpj_emitente: '03995515011363', emitente: 'MATEUS SUPERMERCADOS SA', numero: '000090001', emissao: '2026-11-12', valor_nf: 100,
  situacao: 'na_fila', lancada_em: null, nf_sischef: null, parcelas: [],
  itens: [{ n: 1, descricao: 'CÓD. FOR: 555 TOMATE ITALIANO KG', qtd: 2, unidade_sischef: 'KG', produto_id: null, produto_nome: null, associacao: null }],
  associacoes_app: null, lancamento_estado: null, lancamento_motivo: null,
} as unknown as NotaSefazLista)

describe('Nota fiscal: lista de produtos que não carregou oferece "Tentar de novo" (não manda mais "Atualizar a página")', () => {
  it('falhou: mostra o aviso com o botão; tocar busca a lista de novo e a caixa de escolher o produto aparece', async () => {
    m.notasALancar.mockResolvedValue([notaComItemSemProduto()])
    m.catalogoProdutos.mockRejectedValueOnce(new Error('sem internet')).mockResolvedValue(CATALOGO)
    render(<NotaSefaz />)
    const caixa = within(await screen.findByTestId('associar-produto'))
    const aviso = await caixa.findByRole('alert')
    expect(aviso).toHaveTextContent('Não consegui carregar a lista de produtos. Confira a internet e toque em “Tentar de novo”.')
    expect(aviso).not.toHaveTextContent(/Atualize a página/)
    expect(m.catalogoProdutos).toHaveBeenCalledTimes(1)
    await userEvent.click(caixa.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(m.catalogoProdutos).toHaveBeenCalledTimes(2))
    // a lista chegou: o aviso e o botão somem e a caixa volta a funcionar (com a lista, ela já pode até sugerir o produto pelo nome)
    await waitFor(() => expect(caixa.queryByRole('alert')).not.toBeInTheDocument())
    expect(caixa.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    expect(caixa.queryByText('Carregando a lista de produtos…')).not.toBeInTheDocument()
  })
})
