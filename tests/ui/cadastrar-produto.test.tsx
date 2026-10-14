import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as api from '../../src/lib/api'
import { ACOES_PRODUTO } from '../../src/admin/acoesProduto'
import CadastrarProduto, { ProdutoNaoCadastrado, type AcoesProduto, type StatusProduto } from '../../src/admin/CadastrarProduto'

// Cadastrar produto novo dentro do app (pedido do Ivan, 13/10/2026): nome + grupo + unidade -> cadastrar -> andamento -> "Usar este produto" (só com o toque).
// Quase todos os testes passam as ações pela prop `acoes`; os da trava de 3 minutos usam as ações de verdade (ACOES_PRODUTO) com o api simulado,
// para provar que pedirCadastroProduto não é chamado de novo.
vi.mock('../../src/lib/api')
const m = vi.mocked(api)
beforeEach(() => { vi.clearAllMocks() })   // as chamadas de um teste não contam no outro
const ITEM = 'MAION.HELLMANNS 1X3Kg'
const NOME = 'MAION.HELLMANNS 1X3KG - INSUMOS'
const ORIGEM = { tipo: 'cupom' as const, id: 'cupom-1' }

/** A hora (ISO) de `min` minutos atrás: a hora do pedido no servidor (`atualizado_em`). */
const haMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const status = (over: Partial<StatusProduto> = {}): StatusProduto => ({
  id: 'ped-1', estado: 'CADASTRADO', produto_id: 3900001, motivo: null, candidatos: [], descricao: NOME, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG',
  criado_em: haMin(0), atualizado_em: haMin(0), ...over,
})
/** Quantas vezes "confira" aparece no texto (o conselho não pode sair repetido). */
const vezesConfira = (el: HTMLElement) => (el.textContent?.match(/confira/gi) ?? []).length
function acoes(over: Partial<AcoesProduto> = {}): AcoesProduto {
  return { cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-1' }), status: vi.fn().mockResolvedValue(status()), ...over }
}
const abrir = (a: AcoesProduto, aoUsar = vi.fn(), extra: Partial<React.ComponentProps<typeof CadastrarProduto>> = {}) =>
  render(<CadastrarProduto descricaoDoItem={ITEM} acoes={a} origem={ORIGEM} aoUsar={aoUsar} intervaloMs={20} {...extra} />)
const preencher = async () => {
  await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
  await userEvent.selectOptions(screen.getByTestId('unidade-produto'), 'KG')
}

describe('CadastrarProduto', () => {
  it('abre com o nome pronto, a unidade VAZIA (só uma dica pelo nome do item) e o grupo sem escolha; só KG ou UN', () => {
    abrir(acoes())
    expect(screen.getByTestId('nome-produto')).toHaveValue(NOME)
    expect(screen.getByTestId('unidade-produto')).toHaveValue('')
    expect(screen.getByTestId('unidade-sugerida')).toHaveTextContent('KG')
    expect(screen.getByTestId('unidade-sugerida')).toHaveTextContent('Quem escolhe é você')
    expect([...screen.getByTestId('unidade-produto').querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['', 'UN', 'KG'])
    expect(screen.getByTestId('grupo-produto')).toHaveValue('')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeDisabled()
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Escolha o grupo')
    expect(screen.getByTestId('previa-cadastro')).toHaveTextContent('controla estoque')
  })

  it('sem escolher a unidade o botão não libera (nunca chuta)', async () => {
    abrir(acoes())
    await userEvent.selectOptions(screen.getByTestId('grupo-produto'), 'ESTOQUE CONTROLADO')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeDisabled()
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Escolha a unidade')
  })

  it('escolhidos grupo e unidade, cadastra com os dados e a origem certos; nada é pedido antes do toque; depois acompanha PELO CÓDIGO do pedido', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    abrir(a)
    expect(a.cadastrar).not.toHaveBeenCalled()
    await preencher()
    await userEvent.clear(screen.getByTestId('nome-produto'))
    await userEvent.type(screen.getByTestId('nome-produto'), 'maionese hellmanns 3kg')
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(a.cadastrar).toHaveBeenCalledWith({ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1' })
    expect(await screen.findByTestId('cadastrando-produto')).toHaveTextContent('2 minutos')
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-1' }))
    expect(a.status).not.toHaveBeenCalledWith(expect.objectContaining({ chave: expect.anything() }))
  })

  it('quando o robô termina: mostra o código novo e só "Usar este produto" entrega o produto (nome e unidade da lista do app)', async () => {
    const aoUsar = vi.fn()
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS' })) }), aoUsar)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('cód. 3900001')
    expect(aoUsar).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith({ produto_id: 3900001, nome: 'MAIONESE HELLMANNS 3KG - INSUMOS', unidade: 'kg' })
  })

  it('o produto já existia no SisChef (com a unidade de lá): avisa que entrou na lista e usa a unidade do SisChef', async () => {
    const aoUsar = vi.fn()
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'JA_EXISTIA', produto_id: 3469999, unidade: 'UN' })) }), aoUsar)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('já existia no SisChef')
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith(expect.objectContaining({ produto_id: 3469999, unidade: 'un' }))
  })

  it('"pronto" sem o código do produto nunca libera o uso: vira aviso para conferir', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'CADASTRADO', produto_id: null })) }))
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-revisar')).toHaveTextContent('sem o código do produto')
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
  })

  it('robô que não conseguiu: mostra o motivo, NÃO afirma que nada foi criado e pede para conferir no SisChef; não oferece usar o produto', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'grupo não encontrado' })) }))
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    const aviso = await screen.findByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('O robô parou sem terminar: grupo não encontrado. Confira no SisChef se o produto já existe antes de tentar de novo.')
    expect(aviso).not.toHaveTextContent('Nada foi cadastrado')
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeEnabled()   // sem código nem candidatos: o Ivan confere e pede de novo pelo botão de sempre
  })

  it('REVISAR com produtos parecidos: "usar este" pede o existente; "criar mesmo assim" pede forçado', async () => {
    const cands = [{ produto_id: 3469720, descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', unidade: 'KG' }]
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'achei produto parecido', candidatos: cands })) })
    abrir(a)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('candidatos-produto')).toHaveTextContent('MAIONESE HELLMANNS 3KG - INSUMOS')
    await userEvent.click(screen.getByTestId('usar-candidato'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenLastCalledWith(expect.objectContaining({ existente_id: 3469720 })))
    expect(a.cadastrar).toHaveBeenLastCalledWith(expect.not.objectContaining({ forcar: true }))
    expect(await screen.findByTestId('criar-mesmo-assim')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('criar-mesmo-assim'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenLastCalledWith(expect.objectContaining({ forcar: true })))
    expect(a.cadastrar).toHaveBeenLastCalledWith(expect.not.objectContaining({ existente_id: expect.anything() }))
  })

  it('passando do prazo sem terminar: avisa que está demorando e oferece "Chamar o robô de novo" (não mais "não toque de novo" sem saída)', async () => {
    abrir(acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) }), vi.fn(), { demoraMs: 30 })
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('produto-demorando')).toHaveTextContent('Está demorando mais que o normal')
    expect(screen.getByTestId('produto-demorando')).not.toHaveTextContent('Não toque de novo')
    expect(screen.getByTestId('chamar-robo')).toHaveTextContent('Chamar o robô de novo')
  })

  it('reaberta no meio do cadastro (pedido que já existe): continua de onde estava, sem pedir de novo', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    abrir(a, vi.fn(), { inicial: status({ estado: 'PENDENTE', produto_id: null }) })
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(screen.getByTestId('grupo-produto')).toHaveValue('ESTOQUE CONTROLADO')
    expect(screen.queryByTestId('cadastrar-produto-botao')).not.toBeInTheDocument()
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-1' }))
    expect(a.cadastrar).not.toHaveBeenCalled()
  })

  it('reaberta depois de pronto: oferece "Usar este produto" direto', async () => {
    const aoUsar = vi.fn()
    abrir(acoes(), aoUsar, { inicial: status() })
    await userEvent.click(screen.getByTestId('usar-produto-novo'))
    expect(aoUsar).toHaveBeenCalledWith({ produto_id: 3900001, nome: NOME, unidade: 'kg' })
  })

  it('erro ao pedir o cadastro: mostra a mensagem e deixa tentar de novo', async () => {
    const a = acoes({ cadastrar: vi.fn().mockRejectedValue(new Error('sem rede')) })
    abrir(a)
    await preencher()
    await userEvent.click(screen.getByTestId('cadastrar-produto-botao'))
    expect(await screen.findByTestId('erro-produto')).toHaveTextContent('sem rede')
    await waitFor(() => expect(screen.getByTestId('cadastrar-produto-botao')).toBeEnabled())
  })
})

describe('ProdutoNaoCadastrado', () => {
  const caixa = (a: AcoesProduto) => render(<ProdutoNaoCadastrado descricaoDoItem={ITEM} acoes={a} origem={ORIGEM} aoUsar={vi.fn()} />)

  it('avisa que NÃO IDENTIFICOU o item na lista (sem afirmar que não existe), diz que o robô confere o SisChef, e só abre o formulário no toque', async () => {
    caixa(acoes({ status: vi.fn().mockResolvedValue(null) }))
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveTextContent('Não identifiquei este item')
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveTextContent('confere no SisChef')
    expect(screen.queryByTestId('cadastrar-produto')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('abrir-cadastro-produto'))
    expect(screen.getByTestId('cadastrar-produto')).toBeInTheDocument()
  })

  it('com o app já sugerindo algo (discreto): sem aviso amarelo, só o botão "Não é nenhum destes?", que abre o formulário', async () => {
    render(<ProdutoNaoCadastrado descricaoDoItem={ITEM} acoes={acoes({ status: vi.fn().mockResolvedValue(null) })} origem={ORIGEM} aoUsar={vi.fn()} discreto />)
    expect(screen.queryByTestId('aviso-nao-cadastrado')).not.toBeInTheDocument()
    expect(screen.getByTestId('abrir-cadastro-produto')).toHaveTextContent('Não é nenhum destes? Cadastrar produto novo')
    await userEvent.click(screen.getByTestId('abrir-cadastro-produto'))
    expect(screen.getByTestId('cadastrar-produto')).toBeInTheDocument()
  })

  it('já existe um cadastro deste nome em andamento ou pronto: abre sozinha, já retomada (consulta pelo nome)', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null })) })
    caixa(a)
    expect(await screen.findByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(a.status).toHaveBeenCalledWith({ chave: 'maion hellmanns 1x3kg insumos' })
  })

  it('um pedido antigo que terminou em REVISAR não abre sozinho: o Ivan começa do aviso', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'REVISAR', produto_id: null, motivo: 'x' })) })
    caixa(a)
    await waitFor(() => expect(a.status).toHaveBeenCalled())
    expect(screen.queryByTestId('cadastrar-produto')).not.toBeInTheDocument()
    expect(screen.getByTestId('abrir-cadastro-produto')).toBeInTheDocument()
  })

  it('revisão 2 (U1b): retomado um pedido PRESO há 30 min (run morto), a caixa abre com a saída ("Tentar de novo"), não com "Cadastrando…" para sempre', async () => {
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ estado: 'PROCESSANDO', produto_id: null, atualizado_em: haMin(30) })), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-2' }) })
    caixa(a)
    expect(await screen.findByTestId('produto-sem-resposta')).toHaveTextContent('O robô não respondeu em 20 minutos')
    expect(screen.queryByTestId('cadastrando-produto')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('tentar-de-novo'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenCalledWith(expect.objectContaining({ descricao: NOME, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', origem: 'cupom', origem_id: 'cupom-1' })))
  })

  it('revisão 2 (M13): o aviso amarelo é anunciado ao leitor de tela (role=status) e, aberto pelo toque, o cursor já vai para o nome', async () => {
    caixa(acoes({ status: vi.fn().mockResolvedValue(null) }))
    expect(screen.getByTestId('aviso-nao-cadastrado')).toHaveAttribute('role', 'status')
    await userEvent.click(screen.getByTestId('abrir-cadastro-produto'))
    expect(screen.getByTestId('nome-produto')).toHaveFocus()
  })
})

describe('pedido que não termina (revisão 2: I2 e M14): a tela nunca fica sem saída', () => {
  const emAndamento = (over: Partial<StatusProduto> = {}) => status({ estado: 'PROCESSANDO', produto_id: null, ...over })
  const MESMO_PEDIDO = { descricao: NOME, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1' }

  it('a demora conta pela hora do PEDIDO (atualizado_em), não pela abertura da tela: retomado parado há 6 min, já avisa e oferece "Chamar o robô de novo"', () => {
    const p = emAndamento({ estado: 'PENDENTE', atualizado_em: haMin(6) })
    abrir(acoes({ status: vi.fn().mockResolvedValue(p) }), vi.fn(), { inicial: p, intervaloMs: 5000 })   // prazos de verdade (5 e 20 min)
    expect(screen.getByTestId('produto-demorando')).toHaveTextContent('Está demorando mais que o normal')
    expect(screen.getByTestId('chamar-robo')).toBeEnabled()                                // nenhum toque nesta tela: destravado
    expect(screen.getByTestId('chamar-robo')).toHaveTextContent('Chamar o robô de novo')
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
  })

  it('retomado há 1 minuto: só "Cadastrando…", sem aviso de demora', () => {
    const p = emAndamento({ estado: 'PENDENTE', atualizado_em: haMin(1) })
    abrir(acoes({ status: vi.fn().mockResolvedValue(p) }), vi.fn(), { inicial: p, intervaloMs: 5000 })
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(screen.queryByTestId('produto-demorando')).not.toBeInTheDocument()
    expect(screen.queryByTestId('produto-sem-resposta')).not.toBeInTheDocument()
  })

  it('o prazo é de 20 minutos pela hora do pedido: com 19 min ainda é "demorando"; com 21 min, "o robô não respondeu" + "Tentar de novo"', () => {
    const p19 = emAndamento({ atualizado_em: haMin(19) })
    const v = abrir(acoes({ status: vi.fn().mockResolvedValue(p19) }), vi.fn(), { inicial: p19, intervaloMs: 5000 })
    expect(screen.getByTestId('produto-demorando')).toBeInTheDocument()
    expect(screen.queryByTestId('produto-sem-resposta')).not.toBeInTheDocument()
    v.unmount()
    const p21 = emAndamento({ atualizado_em: haMin(21) })
    abrir(acoes({ status: vi.fn().mockResolvedValue(p21) }), vi.fn(), { inicial: p21, intervaloMs: 5000 })
    expect(screen.getByTestId('produto-sem-resposta')).toBeInTheDocument()
    expect(screen.queryByTestId('produto-demorando')).not.toBeInTheDocument()
  })

  it('"Chamar o robô de novo" repete o MESMO pedido (mesmos dados) e diz o que o servidor fez; o botão fica travado ("Aguarde alguns minutos…")', async () => {
    const p = emAndamento({ estado: 'PENDENTE', atualizado_em: haMin(6), palavras: 'maion hellmanns' })
    const a = acoes({ status: vi.fn().mockResolvedValue(p), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-1', reenviado: true }) })
    abrir(a, vi.fn(), { inicial: p })
    await userEvent.click(screen.getByTestId('chamar-robo'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenCalledWith(MESMO_PEDIDO))
    expect(await screen.findByTestId('aviso-robo')).toHaveTextContent('Chamei o robô de novo')
    expect(screen.getByTestId('chamar-robo')).toBeDisabled()
    expect(screen.getByTestId('chamar-robo')).toHaveTextContent('Aguarde alguns minutos…')
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-1' }))      // continua acompanhando o mesmo pedido
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
  })

  it('o servidor não chamou o robô de novo (ele já pegou o pedido): diz para esperar', async () => {
    const p = emAndamento({ atualizado_em: haMin(6) })
    const a = acoes({ status: vi.fn().mockResolvedValue(p), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-1', reenviado: false }) })
    abrir(a, vi.fn(), { inicial: p })
    await userEvent.click(screen.getByTestId('chamar-robo'))
    expect(await screen.findByTestId('aviso-robo')).toHaveTextContent('O robô já está com este pedido. Espere mais um pouco.')
  })

  // Cada disparo do robô entra na fila compartilhada do GitHub (sischef-session: só 1 run espera por grupo) e pode cancelar o run de OUTRO robô
  // que esperava: depois do toque, o botão trava 3 minutos (relógio do aparelho, não a hora do servidor) e reabilita sozinho.
  it('"Chamar o robô de novo": retomado depois dos 5 min aparece destravado; depois do toque trava 3 minutos e toques repetidos NÃO chamam pedirCadastroProduto de novo; depois reabilita sozinho', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const p = emAndamento({ estado: 'PENDENTE', atualizado_em: haMin(6) })
      m.pedirCadastroProduto.mockResolvedValue({ cadastro_id: 'ped-1', reenviado: true })
      m.statusDoCadastroProduto.mockResolvedValue(p)
      render(<CadastrarProduto descricaoDoItem={ITEM} acoes={ACOES_PRODUTO} origem={ORIGEM} aoUsar={vi.fn()} inicial={p} />)
      const botao = () => screen.getByTestId('chamar-robo')
      expect(botao()).toBeEnabled()                                                   // nenhum toque nesta tela ainda
      expect(botao()).toHaveTextContent('Chamar o robô de novo')
      await user.click(botao())
      await waitFor(() => expect(botao()).toHaveTextContent('Aguarde alguns minutos…'))
      expect(botao()).toBeDisabled()
      await user.click(botao())
      await user.click(botao())
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000 + 50_000) })   // 2 min 50 s depois: ainda travado
      expect(botao()).toBeDisabled()
      await user.click(botao())
      expect(m.pedirCadastroProduto).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })                // passou dos 3 min
      await waitFor(() => expect(botao()).toBeEnabled())
      expect(botao()).toHaveTextContent('Chamar o robô de novo')
      await user.click(botao())
      await waitFor(() => expect(m.pedirCadastroProduto).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('U1 convertido: preso há 30 min em PROCESSANDO (run morto): "o robô não respondeu em 20 minutos" + "Tentar de novo"; o toque repete o pedido e a tela segue o NOVO', async () => {
    const preso = emAndamento({ atualizado_em: haMin(30), palavras: 'maion hellmanns' })
    const novo = status({ id: 'ped-2', estado: 'PENDENTE', produto_id: null, atualizado_em: haMin(0) })
    const a = acoes({ status: vi.fn().mockImplementation(async (q: { id?: string }) => (q.id === 'ped-2' ? novo : preso)), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-2' }) })
    abrir(a, vi.fn(), { inicial: preso })
    const aviso = screen.getByTestId('produto-sem-resposta')
    expect(aviso).toHaveTextContent('O robô não respondeu em 20 minutos. Confira no SisChef (Produtos) se o produto já foi criado; se não foi, toque em “Tentar de novo”.')
    expect(aviso).not.toHaveTextContent('Não toque')
    expect(screen.queryByTestId('cadastrando-produto')).not.toBeInTheDocument()
    expect(screen.getByTestId('nome-produto')).toBeDisabled()                      // o pedido repetido é o mesmo: o nome não muda
    await userEvent.click(screen.getByTestId('tentar-de-novo'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenCalledWith(MESMO_PEDIDO))
    await waitFor(() => expect(a.status).toHaveBeenCalledWith({ id: 'ped-2' }))
    expect(await screen.findByTestId('cadastrando-produto')).toBeInTheDocument()
    expect(screen.queryByTestId('produto-sem-resposta')).not.toBeInTheDocument()
  })

  it('"Tentar de novo" cedo demais para o servidor (ele devolve o MESMO pedido): avisa para esperar; o botão trava 3 minutos, toques repetidos NÃO chamam pedirCadastroProduto e depois ele volta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const preso = emAndamento({ atualizado_em: haMin(30) })
      m.pedirCadastroProduto.mockResolvedValue({ cadastro_id: 'ped-1', reenviado: false })
      m.statusDoCadastroProduto.mockResolvedValue(preso)
      render(<CadastrarProduto descricaoDoItem={ITEM} acoes={ACOES_PRODUTO} origem={ORIGEM} aoUsar={vi.fn()} inicial={preso} />)
      const botao = () => screen.getByTestId('tentar-de-novo')
      await user.click(botao())
      expect(await screen.findByTestId('aviso-robo')).toHaveTextContent('O pedido ainda está em andamento. Espere alguns minutos e toque de novo.')
      expect(botao()).toBeDisabled()
      expect(botao()).toHaveTextContent('Aguarde alguns minutos…')
      await user.click(botao())
      await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000 + 50_000) })
      await user.click(botao())
      expect(m.pedirCadastroProduto).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
      await waitFor(() => expect(botao()).toBeEnabled())
      expect(botao()).toHaveTextContent('Tentar de novo')
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Tentar de novo" do REVISAR com o código também trava 3 minutos depois do toque (mesmo se o pedido falhar) e reabilita sozinho', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const rev = status({ estado: 'REVISAR', produto_id: 3924999, motivo: null })
      const a = acoes({ cadastrar: vi.fn().mockRejectedValue(new Error('Não consegui pedir o cadastro agora. Confira a internet e tente de novo.')) })
      abrir(a, vi.fn(), { inicial: rev })
      const botao = () => screen.getByTestId('tentar-de-novo')
      await user.click(botao())
      expect(await screen.findByTestId('erro-produto')).toHaveTextContent('Não consegui pedir o cadastro agora')
      expect(botao()).toBeDisabled()
      expect(botao()).toHaveTextContent('Aguarde alguns minutos…')
      await user.click(botao())
      expect(a.cadastrar).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000 + 10_000) })
      await waitFor(() => expect(botao()).toBeEnabled())
    } finally {
      vi.useRealTimers()
    }
  })

  it('pedido de "Criar mesmo assim" preso: "Tentar de novo" repete com o forcar (o mesmo pedido), também quando a tela foi reaberta', async () => {
    const preso = emAndamento({ atualizado_em: haMin(30), forcar: true, existente_id: null, palavras: null })
    const a = acoes({ status: vi.fn().mockResolvedValue(preso), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-2' }) })
    abrir(a, vi.fn(), { inicial: preso })
    expect(screen.getByTestId('palavras-produto')).toHaveValue('')                  // as palavras do pedido, não as sugeridas pelo nome do item
    await userEvent.click(screen.getByTestId('tentar-de-novo'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenCalledWith({ ...MESMO_PEDIDO, palavras: '', forcar: true }))
  })

  it('a contagem recomeça quando o pedido muda de hora (o robô o pegou agora): o aviso de demora sai', async () => {
    const parado = emAndamento({ estado: 'PENDENTE', atualizado_em: haMin(6) })
    const a = acoes({ status: vi.fn().mockResolvedValue(emAndamento({ atualizado_em: haMin(0) })) })
    abrir(a, vi.fn(), { inicial: parado })
    expect(screen.getByTestId('produto-demorando')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('produto-demorando')).not.toBeInTheDocument())
    expect(screen.getByTestId('cadastrando-produto')).toBeInTheDocument()
  })

  it('relógio do aparelho atrasado (hora do pedido "no futuro"): a saída aparece mesmo assim, contada pela tela', async () => {
    const p = emAndamento({ atualizado_em: new Date(Date.now() + 2 * 60 * 60_000).toISOString() })
    abrir(acoes({ status: vi.fn().mockResolvedValue(p) }), vi.fn(), { inicial: p, demoraMs: 50, limiteMs: 150 })
    expect(await screen.findByTestId('tentar-de-novo', {}, { timeout: 3000 })).toBeEnabled()
  })
})

describe('REVISAR (revisão 2: I5, M1, M2)', () => {
  const cands = [{ produto_id: 3469720, descricao: 'MAIONESE HELLMANNS 7,5KG - INSUMOS', unidade: 'KG' }]

  it('U2 convertido: com candidatos, NÃO há o botão principal (ele pediria de novo e repetiria o mesmo REVISAR): só "usar este" e "criar mesmo assim"', () => {
    const rev = status({ estado: 'REVISAR', produto_id: null, motivo: 'Achei no SisChef produto(s) parecido(s): 3469720 MAIONESE HELLMANNS 7,5KG - INSUMOS — confira antes de criar outro', candidatos: cands })
    abrir(acoes({ status: vi.fn().mockResolvedValue(rev) }), vi.fn(), { inicial: rev })
    expect(screen.getByTestId('candidatos-produto')).toBeInTheDocument()
    expect(screen.queryByTestId('cadastrar-produto-botao')).not.toBeInTheDocument()
    expect(screen.getByTestId('usar-candidato')).toBeEnabled()
    expect(screen.getByTestId('criar-mesmo-assim')).toBeEnabled()
  })

  it('U5 convertido: com candidatos o aviso diz "Achei no SisChef…" (não "O robô parou sem terminar") e não repete "confira"', () => {
    const rev = status({ estado: 'REVISAR', produto_id: null, motivo: 'Achei no SisChef produto(s) parecido(s): 10 MAIONESE X — confira antes de criar outro', candidatos: [{ produto_id: 10, descricao: 'MAIONESE X', unidade: 'KG' }] })
    abrir(acoes({ status: vi.fn().mockResolvedValue(rev) }), vi.fn(), { inicial: rev })
    const aviso = screen.getByTestId('produto-revisar')
    expect(aviso).toHaveTextContent(/^Achei no SisChef um produto parecido/)
    expect(aviso).not.toHaveTextContent('O robô parou sem terminar')
    expect(vezesConfira(aviso)).toBeLessThanOrEqual(1)
  })

  it('sem candidatos, com um motivo que já manda conferir (pedido dado por perdido): "confira" sai uma vez só', () => {
    const rev = status({ estado: 'REVISAR', produto_id: null, motivo: 'o robô não respondeu a tempo: confira no SisChef se o produto foi criado antes de tentar de novo' })
    abrir(acoes({ status: vi.fn().mockResolvedValue(rev) }), vi.fn(), { inicial: rev })
    const aviso = screen.getByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('O robô parou sem terminar: o robô não respondeu a tempo. Confira no SisChef se o produto já existe antes de tentar de novo.')
    expect(vezesConfira(aviso)).toBe(1)
  })

  it('motivo do robô de produto INATIVO no SisChef: o motivo aparece inteiro (com o "reative"), sem conselho repetido, e o botão de sempre continua', () => {
    const motivo = 'existe no SisChef um produto INATIVO com esse nome (cód. 3924284): reative no SisChef antes de tentar de novo'
    const rev = status({ estado: 'REVISAR', produto_id: null, motivo })
    abrir(acoes({ status: vi.fn().mockResolvedValue(rev) }), vi.fn(), { inicial: rev })
    const aviso = screen.getByTestId('produto-revisar')
    expect(aviso).toHaveTextContent(`O robô parou sem terminar: ${motivo}.`)
    expect(aviso).not.toHaveTextContent('Confira no SisChef se o produto já existe')
    expect(screen.getByTestId('cadastrar-produto-botao')).toBeEnabled()
  })

  it('I5: REVISAR com o código (o robô pode ter criado o produto): diz o código; "Tentar de novo" pede ESTE produto (existente_id), com o resto igual', async () => {
    const rev = status({ estado: 'REVISAR', produto_id: 3924999, motivo: 'Confira os campos no SisChef (código 3924999); se estiverem certos, toque de novo: o robô só vai trazer o produto para a sua lista (não cria outro)', palavras: 'maion hellmanns' })
    const a = acoes({ status: vi.fn().mockResolvedValue(status({ id: 'ped-2', estado: 'JA_EXISTIA', produto_id: 3924999 })), cadastrar: vi.fn().mockResolvedValue({ cadastro_id: 'ped-2' }) })
    abrir(a, vi.fn(), { inicial: rev })
    const aviso = screen.getByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('O produto pode ter sido criado no SisChef com o código 3924999: confira os campos lá; se estiverem certos, toque em “Tentar de novo” — o robô só vai trazê-lo para a sua lista (não cria outro).')
    expect(vezesConfira(aviso)).toBe(1)
    expect(screen.queryByTestId('cadastrar-produto-botao')).not.toBeInTheDocument()   // a saída é a que só traz o produto
    expect(screen.getByTestId('nome-produto')).toBeDisabled()
    expect(screen.queryByTestId('usar-produto-novo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('tentar-de-novo'))
    await waitFor(() => expect(a.cadastrar).toHaveBeenCalledWith({ descricao: NOME, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', existente_id: 3924999 }))
    expect(await screen.findByTestId('produto-pronto')).toHaveTextContent('já existia no SisChef (cód. 3924999)')
  })

  it('I5: REVISAR com o código e o motivo do banco (unidade fora de KG/UN): mostra o motivo e o conselho, "confira" uma vez', () => {
    const rev = status({ estado: 'REVISAR', produto_id: 3924999, motivo: 'a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN — confira o produto 3924999 no SisChef' })
    abrir(acoes({ status: vi.fn().mockResolvedValue(rev) }), vi.fn(), { inicial: rev })
    const aviso = screen.getByTestId('produto-revisar')
    expect(aviso).toHaveTextContent('O robô parou sem terminar: a unidade do produto no SisChef é PCT; a lista do app só aceita KG ou UN. O produto pode ter sido criado no SisChef com o código 3924999')
    expect(vezesConfira(aviso)).toBe(1)
    expect(screen.getByTestId('tentar-de-novo')).toBeEnabled()
  })
})

describe('formulário: acessibilidade e textos simples (revisão 2: M13)', () => {
  it('o motivo do botão apagado fica ligado a ele (aria-describedby)', () => {
    abrir(acoes())
    expect(screen.getByTestId('cadastrar-produto-botao')).toHaveAccessibleDescription('Escolha o grupo do SisChef.')
  })

  it('a prévia não usa jargão ("de terceiros", "NCM 00"): diz que o resto fica como nos outros insumos do SisChef', () => {
    abrir(acoes())
    const previa = screen.getByTestId('previa-cadastro')
    expect(previa).not.toHaveTextContent(/terceiros|revenda|NCM/i)
    expect(previa).toHaveTextContent('como nos outros insumos do SisChef')
    expect(previa).toHaveTextContent('controla estoque')
  })

  it('item sem descrição: o nome começa vazio (nunca "ITEM - INSUMOS") e o botão pede o nome', () => {
    render(<CadastrarProduto descricaoDoItem="" acoes={acoes()} origem={ORIGEM} aoUsar={vi.fn()} />)
    expect(screen.getByTestId('nome-produto')).toHaveValue('')
    expect(screen.getByTestId('falta-produto')).toHaveTextContent('Digite o nome do produto.')
  })
})
