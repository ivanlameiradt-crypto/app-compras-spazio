import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { clear } from 'idb-keyval'
import * as api from '../../src/lib/api'
import { enfileirar, ErroRede, limparErros, pendentes, processar } from '../../src/lib/fila'
import type { LinhaCompra } from '../../src/lib/tipos'
import * as fotoLib from '../../src/lib/foto'
import Comprar from '../../src/comprador/Comprar'
import { item, linha } from '../fabricas'

vi.mock('../../src/lib/api')
vi.mock('../../src/lib/foto')
const m = vi.mocked(api)
const mFoto = vi.mocked(fotoLib)
const joao = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador' as const, ativo: true }
const semana = { id: 7, data_referencia: '2026-09-22', status: 'em_compra' as const, aprovada_por: null, aprovada_em: null }
const itens = [
  item({ id: 1, produto: 'COCA COLA 350 ML', qtd_aprovada: 52, preco_estimado: 2.79 }),
  item({ id: 2, produto: 'MOSTARDA - INSUMO (KG)', bebida: false, unidade: 'kg', qtd_aprovada: 1.2, preco_estimado: 18.5 }),
]

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  await clear()
  m.semanaEmCompra.mockResolvedValue(semana)
  m.itensDaSemana.mockResolvedValue(itens)
  m.linhasDaSemana.mockResolvedValue([])
  m.lojasUsadas.mockResolvedValue(['ATACADÃO'])
  m.enviarOp.mockResolvedValue()
  m.nomesEquipe.mockResolvedValue({})
  // I2: por padrão a "compra aberta no servidor" é a mesma que está guardada no celular (o caso
  // comum) — testes de retomar/trocar de loja sobrescrevem isto quando querem outro cenário.
  m.minhaCompraAberta.mockImplementation(async () => {
    const c = JSON.parse(localStorage.getItem('compra-aberta') ?? 'null') as { id: string; semanaId: number; loja: string } | null
    if (!c) return null
    return {
      id: c.id, semana_id: c.semanaId, loja: c.loja, comprador: joao.email,
      com_nota: null, foto_cupom: null, total_pago: null, status: 'aberta', aberta_em: '2026-09-22T10:00:00Z', fechada_em: null,
    }
  })
})

function abrirCompra(id = 'c1') {
  localStorage.setItem('compra-aberta', JSON.stringify({ id, semanaId: 7, loja: 'ATACADÃO' }))
}

/** A compra que o servidor diz estar aberta para o comprador. */
function abertaNoServidor(id: string, loja: string) {
  return {
    id, semana_id: 7, loja, comprador: joao.email, com_nota: null, foto_cupom: null, total_pago: null,
    status: 'aberta' as const, aberta_em: '2026-09-22T10:00:00Z', fechada_em: null,
  }
}

/**
 * Faz `acao` e espera terminar uma recarga que COMEÇOU depois dela. As recargas rodam uma de cada
 * vez; cada uma chama semanaEmCompra no começo e, dando certo, lojasUsadas no fim.
 */
async function comRecargaDepois(acao: () => Promise<void>) {
  await waitFor(() => expect(m.lojasUsadas.mock.calls.length).toBe(m.semanaEmCompra.mock.calls.length))
  const iniciadas = m.semanaEmCompra.mock.calls.length
  await acao()
  await waitFor(() => expect(m.lojasUsadas.mock.calls.length).toBeGreaterThan(iniciadas))
}

function compraGuardada() {
  return JSON.parse(localStorage.getItem('compra-aberta') ?? 'null') as { id: string; loja: string } | null
}

describe('Comprar', () => {
  it('sem lista liberada avisa', async () => {
    m.semanaEmCompra.mockResolvedValue(null)
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText(/nenhuma lista liberada/i)).toBeInTheDocument()
  })

  it('escolher loja abre a compra', async () => {
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: 'ATACADÃO' }))
    const op = m.enviarOp.mock.calls[0][0]
    expect(op.tipo).toBe('abrir_compra')
    expect(op.args).toMatchObject({ p_semana: 7, p_loja: 'ATACADÃO' })
    expect(await screen.findByText(/Compra no ATACADÃO/)).toBeInTheDocument()
  })

  it('digitar loja nova', async () => {
    render(<Comprar usuario={joao} />)
    await userEvent.type(await screen.findByPlaceholderText(/outra loja/i), 'feira da 25')
    await userEvent.click(screen.getByRole('button', { name: 'Começar' }))
    expect(m.enviarOp.mock.calls[0][0].args).toMatchObject({ p_loja: 'FEIRA DA 25' })
  })

  it('tocar no item abre o quadro já preenchido e Comprei registra', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /COCA COLA 350 ML/ }))
    const quadro = screen.getByRole('group', { name: 'COCA COLA 350 ML' })
    expect(within(quadro).getByLabelText('Quantidade')).toHaveValue('52')
    expect(within(quadro).getByLabelText('Preço unitário')).toHaveValue('2,79')
    await userEvent.click(within(quadro).getByRole('button', { name: 'Comprei' }))
    expect(m.enviarOp.mock.calls[0][0]).toMatchObject({
      tipo: 'registrar_item', args: { p_compra: 'c1', p_item: 1, p_qtd: 52, p_preco: 2.79, p_resultado: 'comprado' },
    })
  })

  it('aceita vírgula na quantidade em kg', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /MOSTARDA/ }))
    const quadro = screen.getByRole('group', { name: 'MOSTARDA - INSUMO (KG)' })
    const q = within(quadro).getByLabelText('Quantidade')
    await userEvent.clear(q)
    await userEvent.type(q, '0,8')
    await userEvent.click(within(quadro).getByRole('button', { name: 'Achei só parte' }))
    expect(m.enviarOp.mock.calls[0][0].args).toMatchObject({ p_qtd: 0.8, p_resultado: 'parcial' })
  })

  it('quantidade inválida não envia', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /COCA COLA 350 ML/ }))
    const quadro = screen.getByRole('group', { name: 'COCA COLA 350 ML' })
    await userEvent.clear(within(quadro).getByLabelText('Quantidade'))
    await userEvent.click(within(quadro).getByRole('button', { name: 'Comprei' }))
    expect(m.enviarOp).not.toHaveBeenCalled()
    expect(within(quadro).getByText(/informe a quantidade/i)).toBeInTheDocument()
  })

  it('Não achei registra zero', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /COCA COLA 350 ML/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Não achei' }))
    expect(m.enviarOp.mock.calls[0][0].args).toMatchObject({ p_qtd: 0, p_preco: null, p_resultado: 'nao_achei' })
  })

  it('mostra quem já comprou e sugere só o que falta', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'OUTRA', item_semana_id: 1, qtd: 30, marcado_por: 'maria@spazio.com' })])
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText(/Comprado por maria \(30 un\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /COCA COLA 350 ML/ }))
    expect(screen.getByLabelText('Quantidade')).toHaveValue('22')
  })

  it('item marcado aparece como feito e a barra avança', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText('1 de 2 itens')).toBeInTheDocument()
    expect(screen.getByText(/52 un · R\$\s2,79/)).toBeInTheDocument()
  })

  it('mostra a lista do cache quando está offline', async () => {
    abrirCompra()
    localStorage.setItem('cache-comprar', JSON.stringify({ semana, itens }))
    m.semanaEmCompra.mockRejectedValue(new Error('Failed to fetch'))
    render(<Comprar usuario={joao} />)
    expect(await screen.findByRole('button', { name: /COCA COLA 350 ML/ })).toBeInTheDocument()
  })

  it('reidrata do cache as linhas já marcadas quando recarrega offline', async () => {
    abrirCompra()
    localStorage.setItem('cache-comprar', JSON.stringify({
      semana, itens, linhas: [linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })],
    }))
    m.semanaEmCompra.mockRejectedValue(new Error('Failed to fetch'))
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText('1 de 2 itens')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fechar compra desta loja/i })).not.toBeDisabled()
  })

  it('fila esvaziada em segundo plano (fora do enviarOp) não perde a marca já feita', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await screen.findByRole('button', { name: /COCA COLA 350 ML/ })
    // alguém marcou o item e a operação foi para a fila (fora do fluxo mockado de enviarOp)
    await enfileirar({ id: 'x', tipo: 'registrar_item', args: { p_id: 'y', p_compra: 'c1', p_item: 1, p_qtd: 52, p_preco: 2.79, p_resultado: 'comprado' } })
    expect(await screen.findByText('1 de 2 itens')).toBeInTheDocument()
    // a fila esvazia em segundo plano (ex.: AvisoFila) e o servidor já tem a linha
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    const chamadasAntes = m.linhasDaSemana.mock.calls.length
    await processar(async () => {})
    // prova que a fila esvaziando de fato disparou um recarregar() (não só que a tela ficou como estava)
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBeGreaterThan(chamadasAntes))
    expect(await screen.findByText('1 de 2 itens')).toBeInTheDocument()
  })

  it('depois do envio em segundo plano o item segue marcado enquanto a busca não volta — e se ela falhar', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await screen.findByRole('button', { name: /COCA COLA 350 ML/ })
    await enfileirar({ id: 'x', tipo: 'registrar_item', args: { p_id: 'y', p_compra: 'c1', p_item: 1, p_qtd: 52, p_preco: 2.79, p_resultado: 'comprado' } })
    expect(await screen.findByText(/aguardando envio/)).toBeInTheDocument()
    expect(screen.getByText('1 de 2 itens')).toBeInTheDocument()
    let falhar: (e: Error) => void = () => {}
    m.linhasDaSemana.mockReturnValue(new Promise<LinhaCompra[]>((_, rej) => { falhar = rej }))
    const chamadasAntes = m.linhasDaSemana.mock.calls.length
    await processar(async () => {}) // a fila esvazia (enviada), o servidor ainda não respondeu a busca
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBeGreaterThan(chamadasAntes))
    await waitFor(() => expect(screen.queryByText(/aguardando envio/)).not.toBeInTheDocument())
    expect(screen.getByText('1 de 2 itens')).toBeInTheDocument()
    falhar(new Error('TypeError: Failed to fetch'))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByText('1 de 2 itens')).toBeInTheDocument()
    const cache = JSON.parse(localStorage.getItem('cache-comprar') ?? 'null')
    expect(cache.linhas).toEqual([expect.objectContaining({ compra_id: 'c1', item_semana_id: 1, qtd: 52 })])
  })

  it('resposta velha que chega depois não desfaz a tela', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await screen.findByRole('button', { name: /COCA COLA 350 ML/ })
    const maria = linha({ compra_id: 'OUTRA', item_semana_id: 1, qtd: 30, marcado_por: 'maria@spazio.com' })
    let velha: ((v: LinhaCompra[]) => void) | undefined
    m.linhasDaSemana.mockResolvedValue([maria])
    m.linhasDaSemana.mockReturnValueOnce(new Promise<LinhaCompra[]>((r) => { velha = r }))
    await limparErros() // dispara a 1ª recarga, que fica presa esperando `velha`
    await waitFor(() => expect(velha).toBeDefined())
    await limparErros() // coalescida: só marca "recarrega de novo assim que a atual terminar" (síncrono)
    velha!([]) // a 1ª (mais velha) resolve vazia; dispara a coalescida, que busca de novo e traz [maria]
    // waitFor (não um sleep fixo) pra suportar a suíte inteira rodando em paralelo sob carga
    await waitFor(() => expect(screen.getByText(/Comprado por maria \(30 un\)/)).toBeInTheDocument())
  })

  it('I-3: marcação que entra na fila e é enviada no meio de uma recarga continua marcada (e no cache)', async () => {
    abrirCompra()
    m.enviarOp.mockImplementation(async (op) => { await enfileirar(op); void processar(async () => {}) }) // enviada na hora
    render(<Comprar usuario={joao} />)
    await screen.findByRole('button', { name: /COCA COLA 350 ML/ })
    await waitFor(() => expect(m.lojasUsadas.mock.calls.length).toBe(m.semanaEmCompra.mock.calls.length))
    let servirVelha: (v: LinhaCompra[]) => void = () => {}
    m.linhasDaSemana.mockReturnValueOnce(new Promise<LinhaCompra[]>((r) => { servirVelha = r })) // servida antes do commit
    m.linhasDaSemana.mockReturnValueOnce(new Promise<LinhaCompra[]>(() => {})) // a recarga seguinte fica sem resposta
    const chamadas = m.linhasDaSemana.mock.calls.length
    await limparErros() // dispara a recarga, que já leu a fila (vazia) e fica esperando as linhas
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBe(chamadas + 1))
    await userEvent.click(screen.getByRole('button', { name: /COCA COLA 350 ML/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'COCA COLA 350 ML' })).getByRole('button', { name: 'Comprei' }))
    await waitFor(async () => expect(await pendentes()).toEqual([])) // já saiu da fila: enviada
    servirVelha([])
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBe(chamadas + 2)) // aquela recarga terminou
    expect(screen.getByText('1 de 2 itens')).toBeInTheDocument()
    const cache = JSON.parse(localStorage.getItem('cache-comprar') ?? 'null')
    expect(cache.linhas).toEqual([expect.objectContaining({ compra_id: 'c1', item_semana_id: 1, qtd: 52 })])
  })

  it('recargas seguidas: uma em andamento e no máximo uma esperando', async () => {
    abrirCompra()
    render(<Comprar usuario={joao} />)
    await screen.findByRole('button', { name: /COCA COLA 350 ML/ })
    await new Promise((r) => setTimeout(r, 30))
    const antes = m.linhasDaSemana.mock.calls.length
    let liberar: (v: LinhaCompra[]) => void = () => {}
    m.linhasDaSemana.mockReturnValueOnce(new Promise<LinhaCompra[]>((r) => { liberar = r }))
    await limparErros()
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBe(antes + 1))
    await limparErros()
    await limparErros()
    await limparErros()
    liberar([])
    await waitFor(() => expect(m.linhasDaSemana.mock.calls.length).toBe(antes + 2))
    await new Promise((r) => setTimeout(r, 50))
    expect(m.linhasDaSemana.mock.calls.length).toBe(antes + 2)
  })

  it('fechar compra: com nota, total pré-preenchido, envia e volta para escolher loja', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    expect(screen.getByLabelText('Total pago')).toHaveValue('145,08')
    await userEvent.click(screen.getByLabelText('Com nota'))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }))
    expect(m.enviarOp.mock.calls[0][0]).toMatchObject({
      tipo: 'fechar_compra', args: { p_compra: 'c1', p_com_nota: true, p_total: 145.08, p_foto: null },
    })
    expect(await screen.findByText(/enviada para aprovação/i)).toBeInTheDocument()
    expect(localStorage.getItem('compra-aberta')).toBeNull()
  })

  it('fechar compra offline: avisa que vai enviar quando a internet voltar, sem dizer "enviada" (M5)', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    m.enviarOp.mockImplementation(async (op) => { await enfileirar(op) }) // a fila real fica com o fechar_compra
    m.executarOp.mockRejectedValue(new ErroRede('sem internet'))
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    await userEvent.click(screen.getByLabelText('Com nota'))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }))
    expect(await screen.findByText(/será enviada para aprovação quando a internet voltar/i)).toBeInTheDocument()
    expect(screen.queryByText(/^compra enviada para aprovação do administrador\.?$/i)).not.toBeInTheDocument()
  })

  it('fechar compra que falha de vez (vai para os erros) não diz "enviada para aprovação" (M-d)', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    m.enviarOp.mockImplementation(async (op) => { await enfileirar(op) })
    m.executarOp.mockRejectedValue(new Error('compra não encontrada')) // erro definitivo: sai da fila para os erros
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    await userEvent.click(screen.getByLabelText('Com nota'))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }))
    expect(await screen.findByText('Não foi possível fechar a compra: compra não encontrada')).toBeInTheDocument()
    expect(screen.queryByText(/enviada para aprovação/i)).not.toBeInTheDocument()
  })

  it('ecoa o total interpretado abaixo do campo, no padrão brasileiro (M1)', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    const total = screen.getByLabelText('Total pago')
    await userEvent.clear(total)
    await userEvent.type(total, '1.250')
    expect(await screen.findByText('= R$ 1.250,00')).toBeInTheDocument()
  })

  it('fechar exige escolher com ou sem nota', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 1, preco_unit: 1 })])
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    expect(screen.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()
  })

  it('desabilita "Enviar para aprovação" enquanto prepara a foto do cupom', async () => {
    abrirCompra()
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    let liberarFoto: (b: Blob) => void = () => {}
    mFoto.reduzirFoto.mockReturnValue(new Promise<Blob>((r) => { liberarFoto = r }))
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
    await userEvent.click(screen.getByLabelText('Com nota'))
    const arquivo = new File([new Uint8Array(10)], 'cupom.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText(/foto do cupom/i), arquivo)
    expect(screen.getByRole('button', { name: 'Enviar para aprovação' })).toBeDisabled()
    expect(screen.getByText(/preparando foto/i)).toBeInTheDocument()
    liberarFoto(new Blob())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar para aprovação' })).not.toBeDisabled())
  })

  it('I2: sem nada guardado no celular, retoma a compra aberta do comprador no servidor', async () => {
    m.minhaCompraAberta.mockResolvedValue({
      id: 'srv1', semana_id: 7, loja: 'FEIRA', comprador: joao.email, com_nota: null,
      foto_cupom: null, total_pago: null, status: 'aberta', aberta_em: '2026-09-22T09:00:00Z', fechada_em: null,
    })
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText('Compra no FEIRA')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('compra-aberta') ?? 'null')).toMatchObject({ id: 'srv1', loja: 'FEIRA' })
  })

  it('I2: compra guardada no celular mas cancelada no servidor volta para escolher loja', async () => {
    abrirCompra('c1')
    m.minhaCompraAberta.mockResolvedValue(null) // administrador cancelou a compra vazia
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText('Em que loja você está?')).toBeInTheDocument()
    expect(localStorage.getItem('compra-aberta')).toBeNull()
  })

  it('I2: Trocar de loja sem marcas cancela pela fila e volta para escolher loja', async () => {
    abrirCompra('c1')
    render(<Comprar usuario={joao} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar de loja' }))
    expect(m.enviarOp).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'cancelar_compra', args: { p_compra: 'c1' } }))
    expect(await screen.findByText('Em que loja você está?')).toBeInTheDocument()
  })

  it('I2: Trocar de loja com item marcado pede pra fechar a compra antes, sem cancelar', async () => {
    abrirCompra('c1')
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'c1', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
    render(<Comprar usuario={joao} />)
    await screen.findByText('1 de 2 itens')
    await userEvent.click(screen.getByRole('button', { name: 'Trocar de loja' }))
    expect(await screen.findByText(/feche a compra antes de trocar de loja/i)).toBeInTheDocument()
    expect(m.enviarOp).not.toHaveBeenCalledWith(expect.objectContaining({ tipo: 'cancelar_compra' }))
    expect(screen.getByText('Compra no ATACADÃO')).toBeInTheDocument()
  })

  describe('I2: a fila ainda tem abrir/fechar/cancelar compra → o celular manda, não o servidor', () => {
    beforeEach(() => {
      m.enviarOp.mockImplementation(async (op) => { await enfileirar(op) }) // a fila real guarda
      m.executarOp.mockRejectedValue(new ErroRede('sem internet')) // e nada chega ao servidor
      m.lojasUsadas.mockResolvedValue(['ATACADÃO', 'MATEUS'])
    })

    it('fechar A ainda na fila e loja B escolhida: continua na B', async () => {
      abrirCompra('A')
      m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'A', item_semana_id: 1, qtd: 52, preco_unit: 2.79 })])
      m.minhaCompraAberta.mockResolvedValue(abertaNoServidor('A', 'ATACADÃO')) // o servidor ainda não recebeu o fechar
      render(<Comprar usuario={joao} />)
      await userEvent.click(await screen.findByRole('button', { name: /fechar compra desta loja/i }))
      await userEvent.click(screen.getByLabelText('Com nota'))
      await comRecargaDepois(() => userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' })))
      expect(screen.getByText('Em que loja você está?')).toBeInTheDocument()
      await comRecargaDepois(() => userEvent.click(screen.getByRole('button', { name: 'MATEUS' })))
      expect(screen.getByText('Compra no MATEUS')).toBeInTheDocument()
      expect(compraGuardada()).toMatchObject({ loja: 'MATEUS' })
      expect(compraGuardada()?.id).not.toBe('A')
    })

    it('abrir B ainda na fila e o servidor sem compra aberta: continua na B', async () => {
      m.minhaCompraAberta.mockResolvedValue(null) // o abrir_compra ainda não chegou
      render(<Comprar usuario={joao} />)
      await screen.findByRole('button', { name: 'MATEUS' })
      await comRecargaDepois(() => userEvent.click(screen.getByRole('button', { name: 'MATEUS' })))
      expect(screen.getByText('Compra no MATEUS')).toBeInTheDocument()
      expect(compraGuardada()).toMatchObject({ loja: 'MATEUS' })
    })

    it('"Trocar de loja" com o cancelar_compra ainda na fila: não volta para a compra cancelada', async () => {
      abrirCompra('A')
      m.minhaCompraAberta.mockResolvedValue(abertaNoServidor('A', 'ATACADÃO')) // o cancelar ainda não chegou
      render(<Comprar usuario={joao} />)
      await screen.findByText('Compra no ATACADÃO')
      await comRecargaDepois(() => userEvent.click(screen.getByRole('button', { name: 'Trocar de loja' })))
      expect(screen.getByText('Em que loja você está?')).toBeInTheDocument()
      expect(compraGuardada()).toBeNull()
    })

    it('fila sem operação de compra: volta a seguir o servidor', async () => {
      abrirCompra('A')
      await enfileirar({ id: 'x', tipo: 'registrar_item', args: { p_id: 'y', p_compra: 'A', p_item: 1, p_qtd: 52, p_preco: 2.79, p_resultado: 'comprado' } })
      m.minhaCompraAberta.mockResolvedValue(abertaNoServidor('S', 'MATEUS'))
      render(<Comprar usuario={joao} />)
      expect(await screen.findByText('Compra no MATEUS')).toBeInTheDocument()
    })
  })

  it('M12: "Comprado por" usa o nome cadastrado, não o e-mail', async () => {
    abrirCompra('c1')
    m.nomesEquipe.mockResolvedValue({ 'maria@spazio.com': 'Maria Silva' })
    m.linhasDaSemana.mockResolvedValue([linha({ compra_id: 'OUTRA', item_semana_id: 1, qtd: 30, marcado_por: 'maria@spazio.com' })])
    render(<Comprar usuario={joao} />)
    expect(await screen.findByText(/Comprado por Maria Silva \(30 un\)/)).toBeInTheDocument()
  })
})
