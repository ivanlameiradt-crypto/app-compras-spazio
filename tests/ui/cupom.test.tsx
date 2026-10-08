import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import * as foto from '../../src/lib/foto'
import Cupom from '../../src/admin/Cupom'
import { CONTA_DINHEIRO, CONTA_TESOURARIA, CONTAS_PIX } from '../../src/cupom/formasPagamento'
import type { CupomRecente, ItemCupomRecente, ProdutoCatalogo, ResumoEnvioCupom } from '../../src/lib/tipos'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/foto')
const m = vi.mocked(api)
const mf = vi.mocked(foto)

const arquivo = () => new File([new Uint8Array(8)], 'cupom.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  vi.resetAllMocks()
  mf.reduzirFoto.mockImplementation(async (a) => a) // jsdom não tem canvas: devolve a própria foto, como o fallback real
  m.cuponsRecentes.mockResolvedValue([])
  m.subirFotoCupom.mockResolvedValue(undefined)
  m.enviarCupom.mockResolvedValue({ cupom_id: 'c1', resumo: 'enviado para lançar', estado: 'PENDENTE', disparo_ok: true })
})

describe('Cupom', () => {
  it('mostra as 4 formas de pagamento', async () => {
    render(<Cupom />)
    for (const rotulo of ['Dinheiro à vista', 'Tesouraria à vista', 'PIX', 'Sem cartão']) {
      expect(await screen.findByRole('button', { name: rotulo })).toBeInTheDocument()
    }
  })

  it('RF3: PIX sem banco/empresa não deixa enviar; ao escolher a conta, habilita', async () => {
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'PIX' }))
    await userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), arquivo())
    expect(await screen.findByRole('button', { name: /^Enviar/ })).toBeDisabled() // falta a conta PIX
    await userEvent.click(screen.getByRole('button', { name: 'Caixa — Spazio (I J Lameira)' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Enviar/ })).toBeEnabled())
  })

  it('caminho feliz (Sem cartão): sobe a foto e chama enviarCupom; mostra o resumo', async () => {
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sem cartão' }))
    await userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), arquivo())
    const enviar = await screen.findByRole('button', { name: /^Enviar/ })
    await waitFor(() => expect(enviar).toBeEnabled())
    await userEvent.click(enviar)
    await waitFor(() => expect(m.subirFotoCupom).toHaveBeenCalled())
    expect(m.enviarCupom).toHaveBeenCalledWith(expect.stringMatching(/^cupom\//), { forma: 'sem_cartao' }, false)
    expect(await screen.findByText(/enviado para lançar/)).toBeInTheDocument()
  })

  it('"Últimos envios" mostra o estado REVISAR como "precisa de você"', async () => {
    m.cuponsRecentes.mockResolvedValue([
      { id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO', valor_a_pagar: 42.9, pedido_sischef: null, criado_em: '2026-10-01T12:00:00Z', motivo: 'item sem casamento', teste: false, itens: [] },
    ])
    render(<Cupom />)
    expect(await screen.findByText(/precisa de você/)).toBeInTheDocument()
    expect(screen.getByText(/ATACADAO/)).toBeInTheDocument()
  })

  it('erro no envio mantém a foto para tentar de novo', async () => {
    m.enviarCupom.mockRejectedValueOnce(new Error('sem internet'))
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sem cartão' }))
    await userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), arquivo())
    const enviar = await screen.findByRole('button', { name: /^Enviar/ })
    await waitFor(() => expect(enviar).toBeEnabled())
    await userEvent.click(enviar)
    expect(await screen.findByText(/sem internet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Enviar/ })).toBeEnabled() // a foto continua lá
  })
})

// ---------- apoio dos testes abaixo
const escolher = async (rotulo: string) => userEvent.click(await screen.findByRole('button', { name: rotulo }))
const anexar = (f: File = arquivo()) => userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), f)
/** O botão "Enviar" já habilitado (espera a foto terminar de ser preparada). */
const enviarPronto = async () => {
  const botao = await screen.findByRole('button', { name: /^Enviar/ })
  await waitFor(() => expect(botao).toBeEnabled())
  return botao
}
const recente = (extra: Partial<CupomRecente>): CupomRecente => ({
  id: 'c1', estado: 'LANCADO', emitente_nome: 'ATACADAO', valor_a_pagar: 42.9, pedido_sischef: null,
  criado_em: '2026-10-01T12:00:00Z', motivo: null, teste: false, itens: [], ...extra,
})

describe('Cupom — foto_path estável por cupom (a dedup do servidor depende disso)', () => {
  it('o retry do MESMO cupom reusa o MESMO caminho: sobe e envia duas vezes com o mesmo foto_path', async () => {
    m.enviarCupom.mockRejectedValueOnce(new Error('sem internet'))
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    expect(await screen.findByText(/sem internet/)).toBeInTheDocument()

    await userEvent.click(await enviarPronto()) // tentar de novo, sem tirar outra foto
    expect(await screen.findByText(/enviado para lançar/)).toBeInTheDocument()

    const enviados = m.enviarCupom.mock.calls.map((c) => c[0])
    expect(enviados).toHaveLength(2)
    expect(enviados[0]).toMatch(/^cupom\/.+\.jpg$/)
    expect(enviados[1]).toBe(enviados[0]) // um caminho novo por Enviar duplicaria o cupom: a dedup é por foto_path
    expect(m.subirFotoCupom.mock.calls.map((c) => c[0])).toEqual([enviados[0], enviados[0]])
  })

  it('uma foto NOVA ganha caminho novo: o uuid é por captura, não por toque em Enviar', async () => {
    m.enviarCupom.mockRejectedValue(new Error('sem internet'))
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    await screen.findByText(/sem internet/)

    await anexar() // tirou/anexou outra foto
    await waitFor(() => expect(screen.queryByText(/sem internet/)).not.toBeInTheDocument()) // captura nova limpa o aviso
    await userEvent.click(await enviarPronto())
    await screen.findByText(/sem internet/)

    const enviados = m.enviarCupom.mock.calls.map((c) => c[0])
    expect(enviados).toHaveLength(2)
    expect(enviados[1]).not.toBe(enviados[0])
  })

  it('o retry reenvia a mesma foto (mesmo Blob), não uma cópia refeita', async () => {
    m.enviarCupom.mockRejectedValueOnce(new Error('sem internet'))
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    await screen.findByText(/sem internet/)
    await userEvent.click(await enviarPronto())
    await screen.findByText(/enviado para lançar/)

    expect(mf.reduzirFoto).toHaveBeenCalledTimes(1) // reduz uma vez por captura
    const [primeira, segunda] = m.subirFotoCupom.mock.calls.map((c) => c[1])
    expect(segunda).toBe(primeira)
  })
})

describe('Cupom — o botão Enviar só habilita quando está tudo válido', () => {
  it('forma e foto: nenhuma das duas sozinha basta', async () => {
    render(<Cupom />)
    const enviar = await screen.findByRole('button', { name: /^Enviar/ })
    expect(enviar).toBeDisabled() // nada escolhido
    await anexar()
    expect(await screen.findByText(/Foto anexada/)).toBeInTheDocument()
    expect(enviar).toBeDisabled() // só a foto
    await escolher('Sem cartão')
    await waitFor(() => expect(enviar).toBeEnabled()) // forma + foto
  })

  it('só a forma, sem foto, também não habilita', async () => {
    render(<Cupom />)
    await escolher('Dinheiro à vista')
    expect(await screen.findByRole('button', { name: /^Enviar/ })).toBeDisabled()
  })

  it('trocar a foto: enquanto a nova é preparada, Enviar fica desabilitado (não manda a foto velha por engano)', async () => {
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    const enviar = await enviarPronto() // já há uma foto pronta

    let pronta!: (b: Blob) => void
    mf.reduzirFoto.mockReturnValueOnce(new Promise<Blob>((r) => { pronta = r }))
    await anexar() // outra foto: ainda sendo reduzida
    expect(await screen.findByText('Preparando a foto…')).toBeInTheDocument()
    expect(enviar).toBeDisabled()
    // os controles também travam enquanto reduz: uma 2ª captura que terminasse antes da 1ª deixaria a foto VELHA vencer
    expect(screen.getByLabelText('Anexar arquivo do cupom')).toBeDisabled()
    expect(screen.getByLabelText('Bater foto do cupom')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sem cartão' })).toBeDisabled()

    pronta(new Blob([new Uint8Array(2)], { type: 'image/jpeg' }))
    expect(await screen.findByText(/Foto anexada/)).toBeInTheDocument()
    expect(enviar).toBeEnabled()
    expect(screen.getByLabelText('Anexar arquivo do cupom')).toBeEnabled() // liberou
    expect(screen.getByRole('button', { name: 'Sem cartão' })).toBeEnabled()
  })

  it('PIX: as combinações de banco/empresa só aparecem depois de escolher PIX, e são as 7 do robô', async () => {
    render(<Cupom />)
    expect(screen.queryByRole('group', { name: 'Banco e empresa do PIX' })).not.toBeInTheDocument()
    await escolher('PIX')
    const grupo = await screen.findByRole('group', { name: 'Banco e empresa do PIX' })
    const rotulos = within(grupo).getAllByRole('button').map((b) => b.textContent)
    expect(rotulos).toEqual(CONTAS_PIX.map((c) => c.rotulo))
    expect(rotulos).toHaveLength(7)
  })

  it('PIX: trocar de forma e voltar ao PIX zera a conta — fica bloqueado de novo (não herda a escolha antiga)', async () => {
    render(<Cupom />)
    await escolher('PIX')
    await anexar()
    await escolher('Caixa — Spazio (I J Lameira)')
    const enviar = await enviarPronto()

    await escolher('Sem cartão') // as contas do PIX somem
    expect(screen.queryByRole('button', { name: 'Caixa — Spazio (I J Lameira)' })).not.toBeInTheDocument()
    await escolher('PIX') // voltou: a conta de antes NÃO pode ter ficado escolhida por baixo
    expect(screen.getByRole('button', { name: 'Caixa — Spazio (I J Lameira)' })).toHaveAttribute('aria-pressed', 'false')
    expect(enviar).toBeDisabled()
  })

  it('durante o envio: "Enviando…" desabilitado, controles travados, e o 2º toque não envia de novo', async () => {
    let concluir!: (r: ResumoEnvioCupom) => void
    m.enviarCupom.mockReturnValueOnce(new Promise<ResumoEnvioCupom>((r) => { concluir = r }))
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())

    const enviando = await screen.findByRole('button', { name: 'Enviando…' })
    expect(enviando).toBeDisabled()
    // trava os controles: trocar a foto/forma no meio do envio apagaria a escolha do próximo cupom quando o envio terminasse
    expect(screen.getByRole('button', { name: 'PIX' })).toBeDisabled()
    expect(screen.getByLabelText('Anexar arquivo do cupom')).toBeDisabled()
    expect(screen.getByLabelText('Bater foto do cupom')).toBeDisabled()
    await userEvent.click(enviando) // toque duplo
    expect(m.enviarCupom).toHaveBeenCalledTimes(1)

    concluir({ cupom_id: 'c1', resumo: 'enviado para lançar', estado: 'PENDENTE', disparo_ok: true })
    expect(await screen.findByText(/enviado para lançar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PIX' })).toBeEnabled() // liberou
  })
})

describe('Cupom — o que vai para o servidor', () => {
  it.each([
    ['Dinheiro à vista', { forma: 'dinheiro', conta: CONTA_DINHEIRO }],
    ['Tesouraria à vista', { forma: 'tesouraria', conta: CONTA_TESOURARIA }],
    ['Sem cartão', { forma: 'sem_cartao' }],
  ])('%s manda o pagamento certo', async (rotulo, pagamento) => {
    render(<Cupom />)
    await escolher(rotulo)
    await anexar()
    await userEvent.click(await enviarPronto())
    await waitFor(() => expect(m.enviarCupom).toHaveBeenCalledWith(expect.stringMatching(/^cupom\/.+\.jpg$/), pagamento, false))
  })

  it.each(CONTAS_PIX.map((c) => [c.rotulo, c.conta]))('PIX — %s manda a conta %s', async (rotulo, conta) => {
    render(<Cupom />)
    await escolher('PIX')
    await escolher(rotulo)
    await anexar()
    await userEvent.click(await enviarPronto())
    await waitFor(() => expect(m.enviarCupom).toHaveBeenCalledWith(expect.stringMatching(/^cupom\/.+\.jpg$/), { forma: 'pix', conta }, false))
  })

  it('"Modo teste" ligado manda teste=true', async () => {
    render(<Cupom />)
    await escolher('Sem cartão')
    await userEvent.click(screen.getByRole('checkbox', { name: /Modo teste/ }))
    await anexar()
    await userEvent.click(await enviarPronto())
    await waitFor(() => expect(m.enviarCupom).toHaveBeenCalledWith(expect.stringMatching(/^cupom\//), { forma: 'sem_cartao' }, true))
  })

  it('sobe a foto REDUZIDA (o Blob do reduzirFoto), não o arquivo original', async () => {
    const original = arquivo()
    const reduzida = new Blob([new Uint8Array(2)], { type: 'image/jpeg' })
    mf.reduzirFoto.mockResolvedValue(reduzida)
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar(original)
    await userEvent.click(await enviarPronto())
    await waitFor(() => expect(m.subirFotoCupom).toHaveBeenCalled())
    expect(mf.reduzirFoto.mock.calls[0][0]).toBe(original)
    expect(m.subirFotoCupom.mock.calls[0][1]).toBe(reduzida)
  })

  it('"Bater foto" (câmera) também prepara a foto; "Anexar" não força a câmera (serve no PC)', async () => {
    render(<Cupom />)
    await escolher('Sem cartão')
    const camera = screen.getByLabelText('Bater foto do cupom')
    expect(camera).toHaveAttribute('capture', 'environment')
    expect(screen.getByLabelText('Anexar arquivo do cupom')).not.toHaveAttribute('capture')
    await userEvent.upload(camera, arquivo())
    await enviarPronto()
  })
})

describe('Cupom — depois do envio', () => {
  it('limpa o formulário para o próximo cupom e recarrega os "Últimos envios"', async () => {
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    expect(await screen.findByText(/enviado para lançar/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /^Enviar/ })).toBeDisabled() // sem foto de novo
    expect(screen.getByRole('button', { name: 'Sem cartão' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText(/Foto anexada/)).not.toBeInTheDocument()
    expect(m.cuponsRecentes).toHaveBeenCalledTimes(2) // carga inicial + depois do envio
  })

  it('o seletor de arquivo não guarda a escolha antiga: o MESMO arquivo pode ser anexado de novo', async () => {
    const f = arquivo()
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar(f)
    await userEvent.click(await enviarPronto())
    await screen.findByText(/enviado para lançar/)

    await escolher('Sem cartão')
    await anexar(f) // num navegador de verdade, sem limpar o seletor, o mesmo arquivo nem dispararia "change"
    expect(await screen.findByText(/Foto anexada/)).toBeInTheDocument()
    await enviarPronto()
  })

  it('envio que pede atenção (REVISAR ou disparo que falhou) não aparece como sucesso verde', async () => {
    m.enviarCupom.mockResolvedValue({ cupom_id: 'c2', resumo: '2 item(ns) para você conferir', estado: 'REVISAR', disparo_ok: false })
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    const resultado = await screen.findByTestId('resultado')
    expect(resultado).toHaveTextContent('2 item(ns) para você conferir')
    expect(resultado).toHaveClass('amarelo')
    expect(resultado).not.toHaveClass('ok')
  })

  it('envio normal aparece como sucesso', async () => {
    render(<Cupom />)
    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    expect(await screen.findByTestId('resultado')).toHaveClass('ok')
  })
})

describe('Cupom — "Últimos envios"', () => {
  it('REVISAR com valor 0 (foto ilegível grava 0) não mostra "R$ 0,00": só o motivo', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ estado: 'REVISAR', emitente_nome: null, valor_a_pagar: 0, motivo: 'não consegui ler a foto do cupom' }),
    ])
    render(<Cupom />)
    const linha = await screen.findByTestId('cupom-recente')
    expect(linha).toHaveTextContent('precisa de você')
    expect(linha).toHaveTextContent('não consegui ler a foto do cupom')
    expect(linha).not.toHaveTextContent('R$')
    expect(linha).not.toHaveTextContent('0,00')
  })

  it('mostra o valor quando ele existe (REVISAR com total lido, LANCADO), no formato do app', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'c1', estado: 'REVISAR', emitente_nome: 'ATACADAO', valor_a_pagar: 42.9, motivo: '1 item(ns) sem casamento' }),
      recente({ id: 'c2', estado: 'LANCADO', emitente_nome: 'ASSAI', valor_a_pagar: 1234.5 }),
    ])
    render(<Cupom />)
    const [revisar, lancado] = await screen.findAllByTestId('cupom-recente')
    expect(revisar).toHaveTextContent(/R\$\s42,90/)
    expect(lancado).toHaveTextContent(/R\$\s1\.234,50/)
  })

  it('rótulo por estado: na fila / lançado / precisa de você / teste', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'a', estado: 'PENDENTE' }),
      recente({ id: 'b', estado: 'PROCESSANDO' }),
      recente({ id: 'c', estado: 'LANCADO' }),
      recente({ id: 'd', estado: 'REVISAR', motivo: 'item sem casamento' }),
      recente({ id: 'e', estado: 'TESTE' }),
    ])
    render(<Cupom />)
    const linhas = await screen.findAllByTestId('cupom-recente')
    expect(linhas.map((l) => l.querySelector('b')?.textContent)).toEqual(['na fila', 'na fila', 'lançado ✓', 'precisa de você ⚠', 'teste ✓'])
  })

  it('sem envios ainda: avisa', async () => {
    render(<Cupom />)
    expect(await screen.findByText('Nenhum envio ainda.')).toBeInTheDocument()
    expect(screen.queryByTestId('cupom-recente')).not.toBeInTheDocument()
  })

  it('falha ao carregar: avisa "Não consegui carregar" e NÃO "Nenhum envio ainda." (erro não pode parecer lista vazia)', async () => {
    m.cuponsRecentes.mockRejectedValue(new Error('relation "cupom" does not exist'))
    render(<Cupom />)
    expect(await screen.findByText('Não consegui carregar os últimos envios.')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum envio ainda.')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cupom-recente')).not.toBeInTheDocument()
  })

  it('a falha não fica grudada: o envio recarrega a lista e, se a recarga funciona, o aviso some', async () => {
    m.cuponsRecentes
      .mockRejectedValueOnce(new Error('sem rede')) // a carga inicial falha
      .mockResolvedValueOnce([recente({ id: 'n1', emitente_nome: 'ASSAI' })]) // a recarga depois do envio funciona
    render(<Cupom />)
    expect(await screen.findByText('Não consegui carregar os últimos envios.')).toBeInTheDocument()

    await escolher('Sem cartão')
    await anexar()
    await userEvent.click(await enviarPronto())
    expect(await screen.findByTestId('cupom-recente')).toHaveTextContent('ASSAI')
    expect(screen.queryByText('Não consegui carregar os últimos envios.')).not.toBeInTheDocument()
  })

  it('clicar num lançado abre o detalhe: nº do pedido, itens e a unidade do lado da quantidade', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'c1', estado: 'LANCADO', emitente_nome: 'ATACADAO', valor_a_pagar: 327.83, pedido_sischef: '163377325', itens: [
        { descricao_cupom: 'LIMAO TAITI TROPICAL', entrada_estoque: 3.86, unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 0, sugestao_produto: { id: '3469643' }, casado_por: 'descricao' },
        { descricao_cupom: 'ALFACE CRESPA HID.', entrada_estoque: 8, unidade_cupom: 'UND', valor_unitario: 3.7, desconto_item: 0, sugestao_produto: { id: '3469718' }, casado_por: 'descricao' },
      ] }),
    ])
    render(<Cupom />)
    const linha = await screen.findByTestId('cupom-recente')
    expect(screen.queryByText(/163377325/)).not.toBeInTheDocument() // fechado: detalhe escondido
    await userEvent.click(within(linha).getByRole('button'))
    expect(await screen.findByText(/163377325/)).toBeInTheDocument() // abre com o pedido
    expect(screen.getByText('LIMAO TAITI TROPICAL')).toBeInTheDocument()
    expect(screen.getByText('ALFACE CRESPA HID.')).toBeInTheDocument()
    // a unidade vem do cupom, colada na quantidade — sem ela o número não diz nada (3,86 é kg? unidade?)
    expect(screen.getByText(/3,86 kg/)).toBeInTheDocument()
    expect(screen.getByText(/8 und/)).toBeInTheDocument()
    expect(linha).not.toHaveTextContent(/qtd/)   // pedido do Ivan (08/10): sem a palavra "qtd" na frente — só o número, a unidade e o preço
  })

  it('o motivo aparece só na linha REVISAR (nas outras seria resto de um estado antigo)', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'a', estado: 'REVISAR', motivo: '1 item(ns) sem casamento' }),
      recente({ id: 'b', estado: 'LANCADO', motivo: 'resto de um motivo antigo' }),
    ])
    render(<Cupom />)
    await screen.findAllByTestId('cupom-recente')
    expect(screen.getByText('1 item(ns) sem casamento')).toBeInTheDocument()
    expect(screen.queryByText('resto de um motivo antigo')).not.toBeInTheDocument()
  })
})

/** O cupom do ATACADAO de 06/10 (R$ 35,27): 2 itens sem produto confirmado (só com a proposta do sistema) e 1 já aprendido. */
const ITENS_ATACADAO: ItemCupomRecente[] = [
  { descricao_cupom: 'LIMAO SICILIANO', unidade_cupom: 'KG', valor_unitario: 13.9, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null,
    proposta: { insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS' } },
  { descricao_cupom: 'PEPINO JAPONES', unidade_cupom: 'KG', valor_unitario: 5.79, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null,
    proposta: { insumo_id: '3484991', insumo_nome: 'PEPINO JAPONÊS - INSUMOS' } },
  { descricao_cupom: 'LIMAO TAITI TROPICAL', unidade_cupom: 'KG', valor_unitario: 9.9, desconto_item: 5.51, entrada_estoque: 2.884, sugestao_produto: { id: '3469643' },
    casado_por: 'descricao', proposta: null },
]

describe('Cupom — "precisa de você" diz o que está errado e como resolver (pedido do Ivan, 06/10 à noite)', () => {
  it('o cupom do ATACADAO: o bloco aparece SEM abrir o detalhe, com o problema, os itens com a proposta, a solução e o motivo registrado', async () => {
    m.cuponsRecentes.mockResolvedValue([recente({ id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', valor_a_pagar: 35.27,
      motivo: '2 item(ns) sem casamento confirmado — confira no Code', itens: ITENS_ATACADAO })])
    render(<Cupom />)
    const bloco = await screen.findByTestId('cupom-problema')
    expect(bloco).toHaveTextContent('O que está errado: 2 itens ainda não têm produto confirmado no SisChef')
    const itens = within(screen.getByTestId('cupom-problema-itens')).getAllByRole('listitem')
    expect(itens).toHaveLength(2)                                                            // o 3º (LIMAO TAITI) já está confirmado
    expect(itens[0]).toHaveTextContent(/LIMAO SICILIANO · R\$\s13,90 por KG/)
    expect(itens[1]).toHaveTextContent(/PEPINO JAPONES · R\$\s5,79 por KG/)
    const pedidos = within(screen.getByTestId('cupom-pedidos')).getAllByRole('listitem')
    expect(pedidos).toHaveLength(2)
    expect(pedidos[0]).toHaveTextContent('LIMAO SICILIANO: confirmar que é LIMÃO SICILIANO - INSUMOS (cód. 3484974) e dizer o peso (kg) que está no cupom.')
    expect(pedidos[1]).toHaveTextContent('PEPINO JAPONES: confirmar que é PEPINO JAPONÊS - INSUMOS (cód. 3484991) e dizer o peso (kg) que está no cupom.')
    expect(bloco).toHaveTextContent('O que preciso de você:')
    expect(screen.getByTestId('cupom-conferencia')).toHaveTextContent(/Para conferir a sua resposta: O cupom é R\$\s35,27 e os itens já confirmados somam R\$\s23,04: estes itens devem somar R\$\s12,23/)
    // com o total lido o cupom é corrigível NA TELA: a solução aponta para a caixa logo abaixo, não mais para o Claude
    expect(bloco).toHaveTextContent('Como resolver: Confirme cada item abaixo (o produto do SisChef e o peso que está no cupom) e toque em “Reenviar para lançar”.')
    expect(screen.getByText('2 item(ns) sem casamento confirmado — confira no Code')).toBeInTheDocument()   // o motivo técnico continua à mostra (pequeno)
    expect(bloco).toHaveClass('amarelo')
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()            // o detalhe dos itens segue fechado
  })

  it('envio repetido de um cupom já lançado: aparece como "já lançado ✓", sem bloco amarelo, sem foto e sem caixa (pedido do Ivan, 07/10)', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'r1', estado: 'REVISAR', emitente_nome: 'MATEUS SUPERMERCADOS SA', valor_a_pagar: 54.49, foto_path: 'cupom/r1.jpg',
        motivo: 'JÁ LANÇADO em outro envio — NÃO reenviar (duplicaria a compra)', itens: ITENS_ATACADAO }),
    ])
    render(<Cupom />)
    const linha = await screen.findByTestId('cupom-recente')
    expect(linha.querySelector('b')?.textContent).toBe('já lançado ✓')
    expect(screen.getByTestId('envio-repetido')).toHaveTextContent('Envio repetido: este cupom já tinha sido lançado em outro envio. Nada a fazer.')
    expect(screen.queryByTestId('cupom-problema')).not.toBeInTheDocument()                 // não é pendência: nada de "O que está errado"
    expect(screen.queryByRole('button', { name: /Ver a foto do cupom/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('corrigir-cupom')).not.toBeInTheDocument()
    expect(linha).not.toHaveTextContent('precisa de você')
  })

  it('foto ilegível: diz para tirar outra foto', async () => {
    m.cuponsRecentes.mockResolvedValue([recente({ estado: 'REVISAR', emitente_nome: null, valor_a_pagar: 0, motivo: 'não consegui ler a foto do cupom' })])
    render(<Cupom />)
    const bloco = await screen.findByTestId('cupom-problema')
    expect(bloco).toHaveTextContent('A foto não ficou legível')
    expect(bloco).toHaveTextContent('Tire outra foto, com o cupom inteiro, esticado e com boa luz, e envie de novo.')
    expect(screen.queryByTestId('cupom-problema-itens')).not.toBeInTheDocument()
  })

  it('só os REVISAR têm o bloco (o motivo de um LANCADO/na fila é resto de estado antigo)', async () => {
    m.cuponsRecentes.mockResolvedValue([
      recente({ id: 'a', estado: 'REVISAR', motivo: 'não consegui ler o total do cupom' }),
      recente({ id: 'b', estado: 'LANCADO', motivo: 'resto de um motivo antigo' }),
      recente({ id: 'c', estado: 'PENDENTE', motivo: 'outro resto' }),
    ])
    render(<Cupom />)
    await screen.findAllByTestId('cupom-recente')
    expect(screen.getAllByTestId('cupom-problema')).toHaveLength(1)
  })

  it('logo depois de enviar um cupom que foi para REVISAR: diz que NÃO foi lançado e manda olhar o motivo em "Últimos envios"', async () => {
    m.enviarCupom.mockResolvedValue({ cupom_id: 'c2', resumo: '2 item(ns) para você conferir', estado: 'REVISAR', disparo_ok: false })
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sem cartão' }))
    await userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), arquivo())
    await userEvent.click(await enviarPronto())
    const resultado = await screen.findByTestId('resultado')
    expect(resultado).toHaveTextContent('Cupom recebido, mas NÃO foi lançado: 2 item(ns) para você conferir.')
    expect(resultado).toHaveTextContent('Veja em “Últimos envios”, logo abaixo, o que está errado e como resolver.')
    expect(resultado).toHaveClass('amarelo')
  })

  it('envio que deu certo mantém o resumo de sempre (sem o texto de "não foi lançado")', async () => {
    render(<Cupom />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sem cartão' }))
    await userEvent.upload(screen.getByLabelText('Anexar arquivo do cupom'), arquivo())
    await userEvent.click(await enviarPronto())
    const resultado = await screen.findByTestId('resultado')
    expect(resultado).toHaveTextContent('enviado para lançar')
    expect(resultado).not.toHaveTextContent('NÃO foi lançado')
  })
})

describe('Cupom — "Ver a foto do cupom" num envio parado (pedido do Ivan, 07/10)', () => {
  const COM_FOTO = recente({ id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', valor_a_pagar: 35.27,
    motivo: '2 item(ns) sem casamento confirmado — confira no Code', itens: ITENS_ATACADAO, foto_path: 'cupom/aaf54e6f.jpg' })
  const botaoFoto = () => screen.findByRole('button', { name: /Ver a foto do cupom/ })

  it('o botão aparece só no envio parado (REVISAR) que tem a foto guardada; nos outros estados seria ruído', async () => {
    m.cuponsRecentes.mockResolvedValue([
      COM_FOTO,
      recente({ id: 'b', estado: 'REVISAR', motivo: 'item sem casamento', foto_path: null }),       // semeado à mão: sem foto
      recente({ id: 'c', estado: 'LANCADO', foto_path: 'cupom/c.jpg' }),
      recente({ id: 'd', estado: 'PENDENTE', foto_path: 'cupom/d.jpg' }),
    ])
    render(<Cupom />)
    const linhas = await screen.findAllByTestId('cupom-recente')
    expect(within(linhas[0]).getByRole('button', { name: /Ver a foto do cupom/ })).toBeInTheDocument()
    for (const l of linhas.slice(1)) expect(within(l).queryByRole('button', { name: /Ver a foto do cupom/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()                               // fechada até ele tocar
  })

  it('tocar pede a URL assinada com o foto_path, mostra a imagem e o que o robô leu (com a quantidade e a unidade do cupom); "Fechar a foto" recolhe', async () => {
    m.urlCupom.mockResolvedValue('https://exemplo.test/assinada.jpg')
    m.cuponsRecentes.mockResolvedValue([COM_FOTO])
    render(<Cupom />)
    await userEvent.click(await botaoFoto())
    expect(m.urlCupom).toHaveBeenCalledWith('cupom/aaf54e6f.jpg')
    expect(await screen.findByRole('img', { name: 'Foto do cupom fiscal enviada' })).toHaveAttribute('src', 'https://exemplo.test/assinada.jpg')
    const leitura = within(screen.getByTestId('leitura-robo')).getAllByRole('listitem')
    expect(leitura).toHaveLength(3)
    expect(leitura[0]).toHaveTextContent(/LIMAO SICILIANO · qtd não guardada · R\$\s13,90/)   // envio antigo: o peso do item sem produto só existe na foto
    // envio antigo (antes da v2): só a ENTRADA no estoque ficou guardada, e ela pode estar em outra unidade — por isso não ganha a unidade do cupom
    expect(leitura[2]).toHaveTextContent(/LIMAO TAITI TROPICAL · entrou 2,884 no estoque \(qtd do cupom não guardada\) · R\$\s9,90 · desconto R\$\s5,51/)
    expect(screen.getByText(/Total lido: R\$\s35,27/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Fechar a foto' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(await botaoFoto()).toBeEnabled()

    await userEvent.click(await botaoFoto())                                                  // abrir de novo pede OUTRA URL: a anterior vence em 10 min e viraria imagem quebrada
    await screen.findByRole('img', { name: 'Foto do cupom fiscal enviada' })
    expect(m.urlCupom).toHaveBeenCalledTimes(2)
  })

  it('item casado com conversão (5 un → 0,4 kg): a lista mostra quantidade e preço COMO ESTÃO NO CUPOM (R$ 7,99), não o preço por kg do estoque', async () => {
    m.urlCupom.mockResolvedValue('https://exemplo.test/assinada.jpg')
    m.cuponsRecentes.mockResolvedValue([recente({ id: 'v2', estado: 'REVISAR', valor_a_pagar: 50, motivo: '1 item(ns) sem casamento confirmado — confira no Code',
      foto_path: 'cupom/v2.jpg', itens: [
        { descricao_cupom: 'OVO BRANCO DZ', unidade_cupom: 'UN', valor_unitario: 99.875, desconto_item: 0, entrada_estoque: 0.4, sugestao_produto: { id: '3487562' },
          casado_por: 'ean', quantidade_cupom: 5 },
        { descricao_cupom: 'ALFACE', unidade_cupom: 'UN', valor_unitario: 3.7, desconto_item: 0, entrada_estoque: null, sugestao_produto: null, casado_por: null, quantidade_cupom: 2 },
      ] })])
    render(<Cupom />)
    await userEvent.click(await botaoFoto())
    const leitura = within(await screen.findByTestId('leitura-robo')).getAllByRole('listitem')
    expect(leitura[0]).toHaveTextContent(/OVO BRANCO DZ · 5 un · R\$\s7,99/)     // o papel diz 7,99; o 99,875 é o preço por kg que o robô digita no estoque
    expect(leitura[0]).not.toHaveTextContent(/99,8/)
    expect(leitura[1]).toHaveTextContent(/ALFACE · 2 un · R\$\s3,70/)             // v2: a quantidade do item sem produto fica guardada
  })

  it('a URL assinada falhou: avisa com o motivo e deixa tentar de novo', async () => {
    m.urlCupom.mockRejectedValue(new Error('Object not found'))
    m.cuponsRecentes.mockResolvedValue([COM_FOTO])
    render(<Cupom />)
    await userEvent.click(await botaoFoto())
    expect(await screen.findByRole('alert')).toHaveTextContent('Não consegui abrir a foto: Object not found')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(await botaoFoto()).toBeEnabled()
  })
})

describe('Cupom — corrigir o cupom parado dentro do app: produto + quantidade + conferência da soma + "Reenviar para lançar" (pedido do Ivan, 07/10)', () => {
  const CATALOGO: ProdutoCatalogo[] = [
    { produto_id: 3484974, nome: 'LIMÃO SICILIANO - INSUMOS', unidade: 'kg', palavras: 'LIMÃO SICILIANO' },
    { produto_id: 3484991, nome: 'PEPINO JAPONÊS - INSUMOS', unidade: 'kg' },
    { produto_id: 3469643, nome: 'LIMÃO - INSUMOS', unidade: 'kg' },
  ]
  // com o CNPJ do emitente: é por ele (+ a descrição) que o servidor guarda o aprendizado destes itens, que não têm código de barras
  const ATACADAO = recente({ id: 'aaf54e6f', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '75315333000109', valor_a_pagar: 35.27,
    motivo: '2 item(ns) sem casamento confirmado — confira no Code', itens: ITENS_ATACADAO })
  type RespostaConfirmar = Awaited<ReturnType<typeof api.confirmarCupom>>
  const ACEITO: RespostaConfirmar = { cupom_id: 'aaf54e6f', estado: 'PENDENTE', resumo: 'corrigido e reenviado para lançar', disparo_ok: true, lembrados: 2, nao_lembrados: 0 }
  /** A lista: o ATACADAO parado e, depois de um reenvio aceito, ele já "na fila" (PENDENTE, sem motivo) — como o banco devolve de verdade. */
  const naFila = () => m.cuponsRecentes.mockResolvedValueOnce([ATACADAO]).mockResolvedValue([{ ...ATACADAO, estado: 'PENDENTE', motivo: null }])

  beforeEach(() => {
    m.catalogoProdutos.mockResolvedValue(CATALOGO)
    m.confirmarCupom.mockResolvedValue(ACEITO)
  })

  /** Os blocos de item pendente da caixa de correção (um por item sem produto). */
  const itensDaCaixa = async () => within(await screen.findByTestId('corrigir-cupom')).getAllByTestId('corrigir-item')
  const reenviar = () => screen.getByTestId('reenviar')
  const soma = () => screen.getByTestId('corrigir-soma')
  /** Aceita a proposta do sistema, digita o peso e confirma o item. */
  const confirmarPelaProposta = async (item: HTMLElement, nome: string, peso: string) => {
    await userEvent.click(await within(item).findByRole('button', { name: nome }))
    await userEvent.type(within(item).getByLabelText('Peso (kg) que está no cupom'), peso)
    await userEvent.click(within(item).getByRole('button', { name: 'Confirmar este item' }))
  }

  it('a caixa aparece só no cupom corrigível: item sem produto E total lido (não na foto ilegível, no "conferir no SisChef", no total não lido nem fora de REVISAR)', async () => {
    m.cuponsRecentes.mockResolvedValue([
      ATACADAO,
      recente({ id: 'b', estado: 'REVISAR', emitente_nome: null, valor_a_pagar: 0, motivo: 'não consegui ler a foto do cupom' }),
      recente({ id: 'c', estado: 'REVISAR', motivo: 'CONFERIR NO SISCHEF: GERAR_COMPRA_CLICADO', itens: ITENS_ATACADAO }),
      recente({ id: 'd', estado: 'REVISAR', valor_a_pagar: 0, motivo: '2 item(ns) sem casamento confirmado; não consegui ler o total do cupom', itens: ITENS_ATACADAO }),
      recente({ id: 'e', estado: 'LANCADO', itens: ITENS_ATACADAO }),
    ])
    render(<Cupom />)
    const linhas = await screen.findAllByTestId('cupom-recente')
    expect(within(linhas[0]).getByTestId('corrigir-cupom')).toBeInTheDocument()
    for (const l of linhas.slice(1)) expect(within(l).queryByTestId('corrigir-cupom')).not.toBeInTheDocument()
    expect(within(linhas[0]).getByTestId('cupom-problema-itens')).toBeInTheDocument()        // o bloco "O que está errado" continua lá
    expect(screen.getAllByTestId('cupom-problema')).toHaveLength(4)
  })

  it('sem cupom corrigível a lista de produtos nem é lida', async () => {
    m.cuponsRecentes.mockResolvedValue([recente({ id: 'e', estado: 'LANCADO' }), recente({ id: 'f', estado: 'REVISAR', motivo: 'não consegui ler a foto do cupom', valor_a_pagar: 0 })])
    render(<Cupom />)
    await screen.findAllByTestId('cupom-recente')
    expect(m.catalogoProdutos).not.toHaveBeenCalled()
  })

  it('fluxo completo: proposta + peso, busca + peso, a soma bate, "Reenviar para lançar" manda as confirmações e a tela avisa e recarrega', async () => {
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    expect(itens).toHaveLength(2)                                                            // só os 2 sem produto; o LIMAO TAITI já está confirmado
    expect(itens[0]).toHaveTextContent(/LIMAO SICILIANO · R\$\s13,90 por KG/)
    expect(itens[1]).toHaveTextContent(/PEPINO JAPONES · R\$\s5,79 por KG/)
    expect(reenviar()).toBeDisabled()
    expect(soma()).toHaveTextContent(/Soma R\$\s23,04 · cupom R\$\s35,27 · falta confirmar os itens acima/)  // só o LIMAO TAITI conta por enquanto
    expect(soma()).toHaveClass('sub')

    // 1º item: a proposta do sistema vira o produto com um toque; o peso é o que está impresso no cupom
    await userEvent.click(await within(itens[0]).findByRole('button', { name: 'LIMÃO SICILIANO - INSUMOS' }))
    expect(within(itens[0]).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()   // escolhido: o campo dá lugar ao produto
    expect(itens[0]).toHaveTextContent('cód. 3484974 · KG')
    expect(within(itens[0]).getByRole('button', { name: 'Confirmar este item' })).toBeDisabled()   // sem o peso não confirma
    await userEvent.type(within(itens[0]).getByLabelText('Peso (kg) que está no cupom'), '0,5')
    expect(itens[0]).toHaveTextContent(/Linha: 0,5 kg × R\$\s13,90 = R\$\s6,95/)
    await userEvent.click(within(itens[0]).getByRole('button', { name: 'Confirmar este item' }))
    expect(itens[0]).toHaveTextContent(/✓ LIMÃO SICILIANO - INSUMOS · 0,5 kg → R\$\s6,95/)
    expect(within(itens[0]).getByRole('button', { name: 'Trocar' })).toBeInTheDocument()
    expect(reenviar()).toBeDisabled()                                                        // ainda falta o pepino

    // 2º item: pela busca na lista de insumos
    await userEvent.type(within(itens[1]).getByLabelText('Produto do SisChef'), 'pepino')
    const achados = within(within(itens[1]).getByTestId('achados'))
    expect(achados.getAllByRole('button')).toHaveLength(1)
    expect(achados.getByRole('button')).toHaveTextContent('PEPINO JAPONÊS - INSUMOS')
    expect(achados.getByRole('button')).toHaveTextContent('cód. 3484991 · KG')
    await userEvent.click(achados.getByRole('button'))
    await userEvent.type(within(itens[1]).getByLabelText('Peso (kg) que está no cupom'), '0,912')
    await userEvent.click(within(itens[1]).getByRole('button', { name: 'Confirmar este item' }))

    // a conferência: uma linha por item do cupom, os já confirmados marcados; a soma fecha em R$ 35,27
    const conferencia = within(screen.getByTestId('corrigir-conferencia')).getAllByRole('listitem')
    expect(conferencia).toHaveLength(3)
    expect(conferencia[0]).toHaveTextContent(/^LIMAO SICILIANO\s*R\$\s6,95$/)
    expect(conferencia[1]).toHaveTextContent(/^PEPINO JAPONES\s*R\$\s5,28$/)                 // 0,912 × 5,79 = 5,28048 → 5,28 (a 2 casas, como o robô)
    expect(conferencia[2]).toHaveTextContent(/^LIMAO TAITI TROPICAL \(já confirmado\)\s*R\$\s23,04$/)
    expect(soma()).toHaveTextContent(/Soma R\$\s35,27 · cupom R\$\s35,27 · bate/)
    expect(soma()).toHaveClass('ok')
    expect(reenviar()).toBeEnabled()

    await userEvent.click(reenviar())
    await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('aaf54e6f', [
      { indice: 0, insumo_id: '3484974', quantidade: 0.5, lembrar: true },
      { indice: 1, insumo_id: '3484991', quantidade: 0.912, lembrar: true },
    ]))
    const aviso = await screen.findByTestId('reenviado')
    expect(aviso).toHaveTextContent('Cupom corrigido e reenviado para lançar. Em 2 ou 3 minutos ele aparece como “lançado ✓” ou volta com um motivo novo.')
    expect(aviso).toHaveClass('ok')
    expect(m.cuponsRecentes).toHaveBeenCalledTimes(2)                                        // carga inicial + depois do reenvio
    expect(m.catalogoProdutos).toHaveBeenCalledTimes(1)                                       // a lista de produtos é lida uma vez só
  })

  it('peso errado: a soma não bate, o botão fica apagado e a tela diz a diferença; "Trocar" deixa corrigir o peso', async () => {
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '2')                   // 2 kg × R$ 5,79 = R$ 11,58 (o certo era 0,912 kg)
    expect(soma()).toHaveTextContent(/Soma R\$\s41,57 · cupom R\$\s35,27 · diferença de R\$\s6,30: confira os pesos/)
    expect(soma()).toHaveClass('erro')
    expect(reenviar()).toBeDisabled()
    expect(m.confirmarCupom).not.toHaveBeenCalled()

    await userEvent.click(within(itens[1]).getByRole('button', { name: 'Trocar' }))
    const peso = within(itens[1]).getByLabelText('Peso (kg) que está no cupom')
    expect(peso).toHaveValue('2')                                                             // volta com o que ele tinha digitado
    await userEvent.clear(peso)
    await userEvent.type(peso, '0,912')
    await userEvent.click(within(itens[1]).getByRole('button', { name: 'Confirmar este item' }))
    expect(soma()).toHaveClass('ok')
    expect(reenviar()).toBeEnabled()
  })

  it('o servidor recusa (409: o cupom já não está parado): o erro aparece como alerta, nada recarrega e o botão volta a habilitar', async () => {
    m.confirmarCupom.mockRejectedValue(new Error('este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela'))
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    expect(await screen.findByRole('alert')).toHaveTextContent('este cupom não está mais parado (já foi reenviado ou lançado): atualize a tela')
    expect(reenviar()).toBeEnabled()
    expect(screen.queryByTestId('reenviado')).not.toBeInTheDocument()
    expect(m.cuponsRecentes).toHaveBeenCalledTimes(1)
  })

  it('durante o reenvio: "Reenviando…" apagado, os itens travados, e o 2º toque não manda de novo', async () => {
    let concluir!: (r: RespostaConfirmar) => void
    m.confirmarCupom.mockReturnValueOnce(new Promise<RespostaConfirmar>((r) => { concluir = r }))
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    const botao = await screen.findByRole('button', { name: 'Reenviando…' })
    expect(botao).toBeDisabled()
    expect(within(itens[0]).getByRole('button', { name: 'Trocar' })).toBeDisabled()          // trocar no meio do envio mandaria uma coisa e mostraria outra
    await userEvent.click(botao)
    expect(m.confirmarCupom).toHaveBeenCalledTimes(1)
    concluir(ACEITO)
    expect(await screen.findByTestId('reenviado')).toBeInTheDocument()
  })

  it('servidor aceitou mas o disparo automático falhou: o aviso fica amarelo, com o resumo do servidor', async () => {
    m.confirmarCupom.mockResolvedValue({ ...ACEITO, disparo_ok: false, resumo: 'corrigido, mas o disparo automático falhou — o cupom ficou na fila' })
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    const aviso = await screen.findByTestId('reenviado')
    expect(aviso).toHaveTextContent('corrigido, mas o disparo automático falhou — o cupom ficou na fila')
    expect(aviso).toHaveClass('amarelo')
    expect(aviso).not.toHaveClass('ok')
  })

  it('servidor aceitou mas não conseguiu guardar a confirmação de algum item (nao_lembrados): aviso amarelo dizendo que ele vai parar de novo', async () => {
    m.confirmarCupom.mockResolvedValue({ ...ACEITO, lembrados: 1, nao_lembrados: 1 })
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    const aviso = await screen.findByTestId('reenviado')
    expect(aviso).toHaveTextContent(
      'Cupom corrigido e reenviado para lançar, mas a confirmação de 1 item(ns) não ficou guardada: no próximo cupom ele para de novo.',
    )
    expect(aviso).toHaveClass('amarelo')
    expect(m.cuponsRecentes).toHaveBeenCalledTimes(2)                                        // a correção em si foi aceita: a lista recarrega
  })

  it('o aviso "reenviado" só vale enquanto o cupom está na fila: se ele volta REVISAR com outro motivo (ou vira lançado), o aviso some', async () => {
    m.cuponsRecentes.mockResolvedValueOnce([ATACADAO])
      .mockResolvedValue([{ ...ATACADAO, estado: 'REVISAR', motivo: 'falha ao preencher o pagamento no Sischef: campo X' }])
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await confirmarPelaProposta(itens[0], 'LIMÃO SICILIANO - INSUMOS', '0,5')
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    await waitFor(() => expect(m.cuponsRecentes).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/pedido ABERTO e nada foi pago/)).toBeInTheDocument()     // o estado novo manda
    expect(screen.queryByTestId('reenviado')).not.toBeInTheDocument()                        // um "reenviado" verde em cima do problema novo seria contradição
  })

  it('o app lembra sozinho (sem caixinha): o item manda lembrar:true e a tela diz que vai lembrar', async () => {
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await userEvent.click(await within(itens[0]).findByRole('button', { name: 'LIMÃO SICILIANO - INSUMOS' }))
    expect(within(itens[0]).queryByRole('checkbox')).not.toBeInTheDocument()                  // regra do Ivan (08/10): associou uma vez, o app guarda
    expect(within(itens[0]).getByTestId('vai-lembrar')).toHaveTextContent('Vou lembrar: da próxima vez, “LIMAO SICILIANO” deste fornecedor já passa direto, sem perguntar.')
    await userEvent.type(within(itens[0]).getByLabelText('Peso (kg) que está no cupom'), '0,5')
    await userEvent.click(within(itens[0]).getByRole('button', { name: 'Confirmar este item' }))
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('aaf54e6f', [
      { indice: 0, insumo_id: '3484974', quantidade: 0.5, lembrar: true },
      { indice: 1, insumo_id: '3484991', quantidade: 0.912, lembrar: true },
    ]))
  })

  it('cupom sem CNPJ do emitente (e item sem código de barras): não oferece o "Lembrar", explica por quê e manda lembrar:false', async () => {
    m.cuponsRecentes.mockResolvedValue([{ ...ATACADAO, emitente_cnpj: null }])
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await userEvent.click(await within(itens[0]).findByRole('button', { name: 'LIMÃO SICILIANO - INSUMOS' }))
    expect(within(itens[0]).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(itens[0]).toHaveTextContent('Não dá para lembrar este item (o cupom não trouxe o CNPJ do emitente nem um código de barras válido).')
    await userEvent.type(within(itens[0]).getByLabelText('Peso (kg) que está no cupom'), '0,5')
    await userEvent.click(within(itens[0]).getByRole('button', { name: 'Confirmar este item' }))
    await confirmarPelaProposta(itens[1], 'PEPINO JAPONÊS - INSUMOS', '0,912')
    await userEvent.click(reenviar())
    // sem chave o servidor não teria como guardar: lembrar:false, para o `nao_lembrados` da resposta só contar falha de verdade
    await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('aaf54e6f', [
      { indice: 0, insumo_id: '3484974', quantidade: 0.5, lembrar: false },
      { indice: 1, insumo_id: '3484991', quantidade: 0.912, lembrar: false },
    ]))
  })

  it('sem CNPJ, só o item cujo código de barras é um GTIN válido pode ser lembrado (código cortado ou interno não serve de chave)', async () => {
    const itens = [{ ...ITENS_ATACADAO[0], codigo_barras: '7891234567895' }, { ...ITENS_ATACADAO[1], codigo_barras: '7891234' }, ITENS_ATACADAO[2]]
    m.cuponsRecentes.mockResolvedValue([{ ...ATACADAO, emitente_cnpj: null, itens }])
    render(<Cupom />)
    const caixas = await itensDaCaixa()
    await userEvent.click(await within(caixas[0]).findByRole('button', { name: 'LIMÃO SICILIANO - INSUMOS' }))
    expect(within(caixas[0]).getByTestId('vai-lembrar')).toBeInTheDocument()
    await userEvent.click(await within(caixas[1]).findByRole('button', { name: 'PEPINO JAPONÊS - INSUMOS' }))
    expect(within(caixas[1]).queryByTestId('vai-lembrar')).not.toBeInTheDocument()
    expect(caixas[1]).toHaveTextContent('Não dá para lembrar este item')
  })

  it('cupom em UN e produto em KG: pergunta o peso de 1 un, o app multiplica e manda `entrada`; a quantidade lida no cupom já vem preenchida', async () => {
    const QUEIJO: ItemCupomRecente = { descricao_cupom: 'QUEIJO MINAS PC', unidade_cupom: 'UN', valor_unitario: 25, desconto_item: 0, entrada_estoque: null,
      sugestao_produto: null, casado_por: null, proposta: null, quantidade_cupom: 1 }
    m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 3500001, nome: 'QUEIJO MINAS - INSUMOS', unidade: 'kg' }])
    m.cuponsRecentes.mockResolvedValue([recente({ id: 'q1', estado: 'REVISAR', emitente_nome: 'MERCADO X', emitente_cnpj: '12345678000199', valor_a_pagar: 25,
      motivo: '1 item(ns) sem casamento confirmado — confira no Code', itens: [QUEIJO] })])
    render(<Cupom />)
    const [item] = await itensDaCaixa()
    expect(item).toHaveTextContent(/QUEIJO MINAS PC · R\$\s25,00 por UN/)
    await userEvent.type(await within(item).findByLabelText('Produto do SisChef'), 'queijo')
    await userEvent.click(within(within(item).getByTestId('achados')).getByRole('button', { name: /QUEIJO MINAS - INSUMOS/ }))
    expect(within(item).getByLabelText('Quantidade (un) que está no cupom')).toHaveValue('1')   // o robô leu "1" no cupom: ele só confere
    expect(item).toHaveTextContent('O produto é controlado em KG no SisChef e o cupom está em UN. Quanto pesa 1 UN, em kg?')
    const confirmar = within(item).getByRole('button', { name: 'Confirmar este item' })
    expect(confirmar).toBeDisabled()                                                          // sem a entrada o servidor recusaria: nem deixa confirmar
    await userEvent.type(within(item).getByLabelText('Peso de 1 UN (kg)'), '0,8')
    expect(item).toHaveTextContent(/Linha: 1 un × R\$\s25,00 = R\$\s25,00 · entra 0,8 kg no estoque/)   // a conversão preserva o valor da linha
    // com conversão o "Lembrar" começa DESMARCADO e diz que o fator também fica guardado: numa peça de peso variável o fator desta compra lançaria a
    // próxima com o peso errado sem ninguém ver; só pacote de peso fixo merece a marca
    expect(within(item).getByTestId('vai-lembrar')).toHaveTextContent('Vou lembrar: da próxima vez, “QUEIJO MINAS PC” deste fornecedor entra com 1 UN = 0,8 KG, sem perguntar.')
    await userEvent.click(confirmar)
    expect(item).toHaveTextContent(/✓ QUEIJO MINAS - INSUMOS · 1 un → R\$\s25,00/)
    expect(soma()).toHaveClass('ok')
    await userEvent.click(reenviar())
    await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('q1', [{ indice: 0, insumo_id: '3500001', quantidade: 1, entrada: 0.8, lembrar: true }]))
  })

  describe('caixa do peso de 1 unidade (regras do Ivan, 08/10)', () => {
    const item = (over: Partial<ItemCupomRecente>): ItemCupomRecente => ({ descricao_cupom: 'X', unidade_cupom: 'UN', valor_unitario: 18, desconto_item: 0,
      entrada_estoque: null, sugestao_produto: null, casado_por: null, proposta: null, quantidade_cupom: 3, ...over })
    const cupomCom = (it: ItemCupomRecente, total: number) => recente({ id: 'p1', estado: 'REVISAR', emitente_nome: 'ATACADAO S.A.', emitente_cnpj: '12345678000199',
      valor_a_pagar: total, motivo: '1 item(ns) sem casamento confirmado — confira no Code', itens: [it] })
    const escolherProduto = async (item0: HTMLElement, busca: string, nome: RegExp) => {
      await userEvent.type(await within(item0).findByLabelText('Produto do SisChef'), busca)
      await userEvent.click(within(within(item0).getByTestId('achados')).getByRole('button', { name: nome }))
    }

    it('farinha láctea: 3 UN sem peso no nome — pergunta o peso de 1 un, 0,600 vira 1,8 kg e o fator guardado é 1 UN = 0,6 KG', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 3476411, nome: 'FARINHA LÁCTEA - INSUMOS (KG)', unidade: 'kg' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'FAR.LACTEA NESTLE' }), 54)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'lactea', /FARINHA LÁCTEA/)
      expect(item0).toHaveTextContent('Quanto pesa 1 UN, em kg?')
      expect(within(item0).getByLabelText('Peso de 1 UN (kg)')).toHaveValue('')               // sem peso no nome: o app não chuta
      expect(within(item0).getByRole('button', { name: 'Confirmar este item' })).toBeDisabled()
      await userEvent.type(within(item0).getByLabelText('Peso de 1 UN (kg)'), '0,600')
      expect(within(item0).getByTestId('vai-entrar')).toHaveTextContent('Vai entrar no estoque: 3 un × 0,6 kg = 1,8 kg')
      expect(within(item0).getByTestId('vai-lembrar')).toHaveTextContent('entra com 1 UN = 0,6 KG, sem perguntar')
      await userEvent.click(within(item0).getByRole('button', { name: 'Confirmar este item' }))
      await userEvent.click(reenviar())
      await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('p1', [{ indice: 0, insumo_id: '3476411', quantidade: 3, entrada: 1.8, lembrar: true }]))
    })

    it('iogurte: o peso (850g) está no nome — o campo já vem com 0,85 e entram 8,5 kg', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 1855909, nome: 'IOGURTE NATURAL - INSUMOS (KG)', unidade: 'kg' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'IOG CANTO MINAS NATURAL 850g', unidade_cupom: 'GF', quantidade_cupom: 10, valor_unitario: 18.88 }), 188.8)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'iogurte', /IOGURTE NATURAL/)
      expect(within(item0).getByLabelText('Peso de 1 GF (kg)')).toHaveValue('0,85')
      expect(within(item0).getByTestId('peso-do-nome')).toBeInTheDocument()
      expect(within(item0).getByTestId('vai-entrar')).toHaveTextContent('10 gf × 0,85 kg = 8,5 kg')
      expect(within(item0).getByTestId('vai-lembrar')).toBeInTheDocument()                     // a conta saiu do próprio nome do cupom
      await userEvent.click(within(item0).getByRole('button', { name: 'Confirmar este item' }))
      await userEvent.click(reenviar())
      await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('p1', [{ indice: 0, insumo_id: '1855909', quantidade: 10, entrada: 8.5, lembrar: true }]))
    })

    it('trava: 850 kg por unidade parece errado — "Usar 0,85" corrige; "Não, é isso mesmo" libera', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 1855909, nome: 'IOGURTE NATURAL - INSUMOS (KG)', unidade: 'kg' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'IOGURTE SEM PESO NO NOME', quantidade_cupom: 10, valor_unitario: 18.88 }), 188.8)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'iogurte', /IOGURTE NATURAL/)
      await userEvent.type(within(item0).getByLabelText('Peso de 1 UN (kg)'), '850')
      expect(within(item0).getByTestId('numero-absurdo')).toHaveTextContent('850 kg por UN parece errado')
      expect(within(item0).getByTestId('numero-absurdo')).toHaveTextContent('Você quis dizer 0,85 kg?')
      expect(within(item0).getByRole('button', { name: 'Confirmar este item' })).toBeDisabled()
      await userEvent.click(within(item0).getByRole('button', { name: 'Não, é isso mesmo' }))
      expect(within(item0).getByRole('button', { name: 'Confirmar este item' })).toBeEnabled()    // o Ivan decidiu: libera (a soma do cupom ainda confere)
      await userEvent.type(within(item0).getByLabelText('Peso de 1 UN (kg)'), '0')                // mexeu no número: pergunta de novo
      expect(within(item0).getByTestId('numero-absurdo')).toBeInTheDocument()
      await userEvent.clear(within(item0).getByLabelText('Peso de 1 UN (kg)'))
      await userEvent.type(within(item0).getByLabelText('Peso de 1 UN (kg)'), '850')
      await userEvent.click(within(item0).getByRole('button', { name: 'Usar 0,85' }))
      expect(within(item0).getByLabelText('Peso de 1 UN (kg)')).toHaveValue('0,85')
      expect(within(item0).queryByTestId('numero-absurdo')).not.toBeInTheDocument()
      expect(within(item0).getByTestId('vai-entrar')).toHaveTextContent('= 8,5 kg')
    })

    it('abacate em gramas e produto em kg: converte sozinho (500 g = 0,5 kg), sem campo para digitar', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 3469827, nome: 'ABACATE - INSUMOS (KG)', unidade: 'kg' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'ABACATE', unidade_cupom: 'G', quantidade_cupom: 500, valor_unitario: 0.009 }), 4.5)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'abacate', /ABACATE/)
      expect(within(item0).getByTestId('entrada-automatica')).toHaveTextContent('entram 0,5 kg (500 g ÷ 1.000)')
      expect(within(item0).queryByLabelText(/Peso de 1/)).not.toBeInTheDocument()
      await userEvent.click(within(item0).getByRole('button', { name: 'Confirmar este item' }))
      await userEvent.click(reenviar())
      await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('p1', [{ indice: 0, insumo_id: '3469827', quantidade: 500, entrada: 0.5, lembrar: true }]))
    })

    it('molho cheddar e Coca em pacote: sempre manuais — nada de "Vou lembrar" e o envio manda lembrar:false', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 3469720, nome: 'MOLHO AMERICAN CHEESE - INSUMOS (KG)', unidade: 'kg' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'MOLHO QJO CHEDDAR', quantidade_cupom: 2, valor_unitario: 58.9 }), 117.8)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'american', /MOLHO AMERICAN CHEESE/)
      await userEvent.type(within(item0).getByLabelText('Peso de 1 UN (kg)'), '1,5')
      expect(within(item0).getByTestId('sempre-manual')).toHaveTextContent('Este item é sempre manual (regra sua)')
      expect(within(item0).queryByTestId('vai-lembrar')).not.toBeInTheDocument()
      await userEvent.click(within(item0).getByRole('button', { name: 'Confirmar este item' }))
      await userEvent.click(reenviar())
      await waitFor(() => expect(m.confirmarCupom).toHaveBeenCalledWith('p1', [{ indice: 0, insumo_id: '3469720', quantidade: 2, entrada: 3, lembrar: false }]))
    })

    it('pacote com produto em UN: pergunta quantas unidades vêm em 1 pacote', async () => {
      m.catalogoProdutos.mockResolvedValue([...CATALOGO, { produto_id: 1836982, nome: 'COCA COLA 350 ML', unidade: 'un' }])
      m.cuponsRecentes.mockResolvedValue([cupomCom(item({ descricao_cupom: 'COCA COLA BARCODE', unidade_cupom: 'PCT', quantidade_cupom: 12, valor_unitario: 21.9 }), 262.8)])
      render(<Cupom />)
      const [item0] = await itensDaCaixa()
      await escolherProduto(item0, 'coca', /COCA COLA 350/)
      expect(item0).toHaveTextContent('Quantas unidades vêm em 1 PCT?')
      await userEvent.type(within(item0).getByLabelText('Unidades em 1 PCT'), '6')
      expect(within(item0).getByTestId('vai-entrar')).toHaveTextContent('12 pct × 6 un = 72 un')
    })
  })

  it('proposta do sistema que não está na lista de insumos vira só um aviso (o servidor a recusaria): ele procura na busca', async () => {
    m.catalogoProdutos.mockResolvedValue([CATALOGO[1], CATALOGO[2]])                           // sem o LIMÃO SICILIANO
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    await within(itens[0]).findByLabelText('Produto do SisChef')
    expect(itens[0]).toHaveTextContent('Proposta do sistema: LIMÃO SICILIANO - INSUMOS (cód. 3484974) — não está na sua lista: procure abaixo')
    expect(within(itens[0]).queryByRole('button', { name: 'LIMÃO SICILIANO - INSUMOS' })).not.toBeInTheDocument()
    await userEvent.type(within(itens[0]).getByLabelText('Produto do SisChef'), 'xyzxyz')
    expect(itens[0]).toHaveTextContent('Nada na sua lista de insumos com isso.')
    expect(within(itens[0]).queryByTestId('achados')).not.toBeInTheDocument()
  })

  it('a lista de produtos não carregou: a caixa avisa e não tem como escolher produto', async () => {
    m.catalogoProdutos.mockRejectedValue(new Error('rede'))
    naFila()
    render(<Cupom />)
    const itens = await itensDaCaixa()
    expect(await within(itens[0]).findByRole('alert')).toHaveTextContent('Não consegui carregar a lista de produtos. Atualize a página.')
    expect(within(itens[0]).queryByLabelText('Produto do SisChef')).not.toBeInTheDocument()
    expect(reenviar()).toBeDisabled()
  })
})
