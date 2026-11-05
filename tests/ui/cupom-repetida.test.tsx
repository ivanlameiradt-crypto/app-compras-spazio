import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import Cupom from '../../src/admin/Cupom'
import type { CupomRecente, ItemCupomRecente } from '../../src/lib/tipos'

// E5 (compra repetida, pedido do Ivan de 04/11/2026): o cartão do cupom em "precisa de você" mostra o aviso "Parece repetida" com a frase do servidor e DOIS botões:
// "É o mesmo: excluir este envio" (o Excluir que já existe, com motivo "Repetido") e "É outra compra" (a decisão: o servidor grava a marca e tira o aviso). O aviso vem JUNTO do resto.
vi.mock('../../src/lib/api')
const m = vi.mocked(api)
const FRASE = 'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 163377089).'
// o aviso mostra a frase sem o prefixo e com a 1ª letra maiúscula
const TEXTO = 'Já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 163377089).'
const COM: ItemCupomRecente = { descricao_cupom: 'TOMATE', unidade_cupom: 'KG', valor_unitario: 8.9, desconto_item: 0, entrada_estoque: 13.472, sugestao_produto: { id: '3484974' }, casado_por: 'descricao', proposta: null, quantidade_cupom: 13.472 }
const SEM: ItemCupomRecente = { descricao_cupom: 'PEPINO', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, proposta: null, quantidade_cupom: 0.912 }
const cupom = (extra: Partial<CupomRecente> = {}): CupomRecente => ({
  id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 119.9, pedido_sischef: null, criado_em: '2026-11-05T12:00:00Z',
  motivo: FRASE, teste: false, itens: [COM], ...extra,
})

beforeEach(() => {
  vi.resetAllMocks()
  m.cuponsRecentes.mockResolvedValue([])
  m.cuponsExcluidos.mockResolvedValue([])
  m.fantasiasDosFornecedores.mockResolvedValue({})
  m.catalogoProdutos.mockResolvedValue([])
})
const aviso = () => screen.findByTestId('aviso-repetida')

describe('Cupom — aviso "Parece repetida" no cartão (E5)', () => {
  it('cupom parado SÓ pelo aviso (o do robô): mostra a frase sem o prefixo e os dois botões; o diagnóstico de sempre não aparece (o aviso já diz tudo)', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom()])
    render(<Cupom />)
    const a = await aviso()
    expect(a).toHaveTextContent('Parece repetida')
    expect(a).toHaveTextContent(TEXTO)
    expect(a).not.toHaveTextContent('POSSÍVEL REPETIDA')
    expect(within(a).getByRole('button', { name: 'É o mesmo: excluir este envio' })).toBeInTheDocument()
    expect(within(a).getByRole('button', { name: 'É outra compra: lançar mesmo assim' })).toBeInTheDocument()
    expect(screen.queryByTestId('cupom-problema')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('excluir-cupom')).toHaveLength(1)           // o Excluir de sempre não repete: o do aviso é o mesmo componente, com o motivo "Repetido"
    expect(within(a).getByTestId('excluir-cupom')).toHaveTextContent('É o mesmo: excluir este envio')
  })

  it('o aviso vem JUNTO do resto: com itens sem produto o diagnóstico (sem o trecho no "Motivo registrado") e a caixa de correção continuam; o botão é "seguir com o cupom"', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ motivo: `1 item(ns) sem casamento confirmado — confira no Code; ${FRASE}`, itens: [COM, SEM] })])
    render(<Cupom />)
    const a = await aviso()
    expect(within(a).getByRole('button', { name: 'É outra compra: seguir com o cupom' })).toBeInTheDocument()
    const problema = await screen.findByTestId('cupom-problema')
    expect(problema).toHaveTextContent('1 item ainda não tem produto confirmado')
    expect(problema).toHaveTextContent('Motivo registrado: 1 item(ns) sem casamento confirmado — confira no Code')
    expect(problema).not.toHaveTextContent('POSSÍVEL REPETIDA')
    expect(await screen.findByTestId('corrigir-cupom')).toBeInTheDocument()
  })

  it('sem o aviso no motivo: nada de aviso (e o Excluir de sempre continua)', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ motivo: '1 item(ns) sem casamento confirmado — confira no Code', itens: [COM, SEM] })])
    render(<Cupom />)
    await screen.findByTestId('cupom-problema')
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
    expect(screen.getByTestId('excluir-cupom')).toBeInTheDocument()
  })

  it('parou no meio do SisChef ou com pedido: NÃO há botões de decisão (a compra PODE existir lá); só o diagnóstico de conferir no SisChef', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ motivo: `CONFERIR NO SISCHEF antes de repetir: GERAR_COMPRA_CLICADO; ${FRASE}` })])
    render(<Cupom />)
    expect(await screen.findByTestId('cupom-problema')).toHaveTextContent('PODE já existir')
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
  })

  it('"É outra compra" (aviso era o único motivo): chama a decisão, a tela avisa que foi para a fila e recarrega a lista', async () => {
    m.cuponsRecentes.mockResolvedValueOnce([cupom()])
    m.cuponsRecentes.mockResolvedValue([cupom({ estado: 'PENDENTE', motivo: null })])
    m.confirmarOutraCompra.mockResolvedValue({ cupom_id: 'c9', estado: 'PENDENTE', resumo: 'confirmado como outra compra e enviado para lançar', disparo_ok: true })
    render(<Cupom />)
    await userEvent.click(within(await aviso()).getByRole('button', { name: 'É outra compra: lançar mesmo assim' }))
    expect(m.confirmarOutraCompra).toHaveBeenCalledWith('c9')
    expect(await screen.findByTestId('reenviado')).toHaveTextContent('reenviado para lançar')
    await waitFor(() => expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument())
  })

  it('"É outra compra" quando sobra motivo: só anota, mostra o recado e o cupom segue para os botões de sempre', async () => {
    m.cuponsRecentes.mockResolvedValueOnce([cupom({ motivo: `1 item(ns) sem casamento confirmado — confira no Code; ${FRASE}`, itens: [COM, SEM] })])
    m.cuponsRecentes.mockResolvedValue([cupom({ motivo: '1 item(ns) sem casamento confirmado — confira no Code', itens: [COM, SEM] })])
    m.confirmarOutraCompra.mockResolvedValue({ cupom_id: 'c9', estado: 'REVISAR', resumo: 'anotado: você disse que é outra compra. Siga com o cupom como de costume.', disparo_ok: false })
    render(<Cupom />)
    await userEvent.click(within(await aviso()).getByRole('button', { name: 'É outra compra: seguir com o cupom' }))
    expect(await screen.findByTestId('outra-compra-anotada')).toHaveTextContent('Anotado: você disse que é outra compra')
    await waitFor(() => expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument())
    expect(screen.getByTestId('corrigir-cupom')).toBeInTheDocument()
  })

  it('a decisão falhou (o cupom mudou, sem internet): mostra o texto do servidor no próprio aviso e o aviso continua à mão', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom()])
    m.confirmarOutraCompra.mockRejectedValue(new Error('este cupom mudou enquanto você decidia: atualize a tela'))
    render(<Cupom />)
    const a = await aviso()
    await userEvent.click(within(a).getByRole('button', { name: 'É outra compra: lançar mesmo assim' }))
    expect(await within(a).findByRole('alert')).toHaveTextContent('este cupom mudou enquanto você decidia: atualize a tela')
    expect(within(a).getByRole('button', { name: 'É outra compra: lançar mesmo assim' })).toBeEnabled()
  })

  it('"É o mesmo: excluir este envio": pergunta (com o motivo "Repetido" já escrito e a dica de que dá para desfazer), e só no 2º toque exclui, com esse motivo, e recarrega', async () => {
    m.cuponsRecentes.mockResolvedValueOnce([cupom()])
    m.cuponsRecentes.mockResolvedValue([])
    m.excluirCupom.mockResolvedValue(undefined)
    render(<Cupom />)
    const a = await aviso()
    await userEvent.click(within(a).getByRole('button', { name: 'É o mesmo: excluir este envio' }))
    expect(m.excluirCupom).not.toHaveBeenCalled()                        // o 1º toque só pergunta
    expect(screen.getByTestId('confirmar-exclusao-cupom')).toHaveTextContent('Dá para desfazer em “Cupons excluídos”')
    expect(screen.getByTestId('motivo-exclusao-cupom')).toHaveValue('Repetido')
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(m.excluirCupom).toHaveBeenCalledWith('c9', 'Repetido'))
    await waitFor(() => expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument())
  })

  it('o aviso NÃO aparece fora do REVISAR (um cupom já na fila ou lançado não pede decisão)', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ estado: 'LANCADO', pedido_sischef: '163377089' }), cupom({ id: 'c8', estado: 'PENDENTE' })])
    render(<Cupom />)
    await screen.findAllByTestId('cupom-recente')
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
  })
})

// ---------- E5: o servidor também barra "Confirmar e lançar" e "Reenviar este cupom" (fornecedor) por repetida: o texto aparece e o cartão passa a mostrar o aviso com os botões.
describe('Cupom — o servidor barra "Confirmar e lançar" por repetida (E5)', () => {
  const MOTIVO_CONFIRMAR = 'CONFIRMAR: 1 item(ns) já conhecido(s) — confira e confirme no app'
  it('o 409 do "Confirmar e lançar": o texto aparece, a lista recarrega e o cartão passa a mostrar o aviso (o servidor gravou o trecho no motivo)', async () => {
    const todoConhecido = cupom({ motivo: MOTIVO_CONFIRMAR })
    m.cuponsRecentes.mockResolvedValueOnce([todoConhecido])
    m.cuponsRecentes.mockResolvedValue([{ ...todoConhecido, motivo: `${MOTIVO_CONFIRMAR}; ${FRASE}` }])
    m.confirmarCupom.mockRejectedValue(new Error(FRASE))
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar e lançar' }))
    expect(m.confirmarCupom).toHaveBeenCalledWith('c9', [], true)
    const a = await aviso()
    expect(a).toHaveTextContent(TEXTO)
    expect(within(a).getByRole('button', { name: 'É outra compra: seguir com o cupom' })).toBeInTheDocument()   // sobra o CONFIRMAR: o "É outra compra" só anota
    expect(m.cuponsRecentes.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('erro que NÃO é de repetida (a soma, a internet) não recarrega a lista nem inventa aviso', async () => {
    m.cuponsRecentes.mockResolvedValue([cupom({ motivo: MOTIVO_CONFIRMAR })])
    m.confirmarCupom.mockRejectedValue(new Error('sem internet'))
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar e lançar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sem internet')
    expect(m.cuponsRecentes).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('aviso-repetida')).not.toBeInTheDocument()
  })

  it('o 409 do "Reenviar este cupom" (depois de cadastrar o fornecedor) também recarrega: o cartão passa a mostrar o aviso', async () => {
    const motivoFornecedor = 'fornecedor não encontrado no Sischef (A. N. DA SILVA DESCARTAVEIS LTDA, CNPJ 63540861000182)'
    const parado = cupom({ motivo: motivoFornecedor, emitente_cnpj: '63540861000182', emitente_nome: 'A. N. DA SILVA DESCARTAVEIS LTDA' })
    m.cuponsRecentes.mockResolvedValueOnce([parado])
    m.cuponsRecentes.mockResolvedValue([{ ...parado, motivo: `${motivoFornecedor}; ${FRASE}` }])
    m.statusDoCadastroFornecedor.mockResolvedValue({ estado: 'CADASTRADO', motivo: null })
    m.reenviarCupomDoFornecedor.mockRejectedValue(new Error(FRASE))
    render(<Cupom />)
    await userEvent.click(await screen.findByTestId('reenviar-cupom'))
    expect(m.reenviarCupomDoFornecedor).toHaveBeenCalledWith('c9')
    expect(await aviso()).toHaveTextContent(TEXTO)
  })
})
