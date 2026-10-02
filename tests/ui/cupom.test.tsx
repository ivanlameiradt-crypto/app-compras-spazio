import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import * as foto from '../../src/lib/foto'
import Cupom from '../../src/admin/Cupom'
import { CONTA_DINHEIRO, CONTA_TESOURARIA, CONTAS_PIX } from '../../src/cupom/formasPagamento'
import type { CupomRecente, ResumoEnvioCupom } from '../../src/lib/tipos'

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
      { id: 'c9', estado: 'REVISAR', emitente_nome: 'ATACADAO', valor_a_pagar: 42.9, criado_em: '2026-10-01T12:00:00Z', motivo: 'item sem casamento', teste: false },
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
  id: 'c1', estado: 'LANCADO', emitente_nome: 'ATACADAO', valor_a_pagar: 42.9, criado_em: '2026-10-01T12:00:00Z', motivo: null, teste: false, ...extra,
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
