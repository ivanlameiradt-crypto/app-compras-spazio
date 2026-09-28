import { clear } from 'idb-keyval'
import { AuthRetryableFetchError } from '@supabase/supabase-js'

const rpc = vi.fn()
const upload = vi.fn()
const signOut = vi.fn()
const getSession = vi.fn()
const signInWithPassword = vi.fn()
const updateUser = vi.fn()
const refreshSession = vi.fn()
const invoke = vi.fn()
const from = vi.fn()
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a) }) },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: {
      signOut: () => signOut(),
      getSession: () => getSession(),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      refreshSession: (...a: unknown[]) => refreshSession(...a),
    },
  },
}))
import {
  ErroApi, abrirComoVendedor, adminFecharCompra, aprovarCompra, codigosDasCotacoes, comprasAbertasParaFechar,
  cotacoesAnterioresVivas, cotacoesSubstituidasPor, criarAcesso, definirNota, economiaSemanas, entrarComSenha, escolherSenhaInicial, executarOp,
  enviarOp, gravarPedido, itensDaSemana, itensDasCotacoes, marcasDaSemana, novaVersao, pedidosRecentes, prepararCotacoes,
  redefinirSenha, responderComoAdmin, sair, semanaTravandoAprovacao, trocarMinhaSenha,
} from '../../src/lib/api'
import { ErroRede, pendentes, type Op } from '../../src/lib/fila'
import { EVENTO_SAIU, guardarUsuario, ultimoUsuario, usuarioGuardado } from '../../src/auth/usuarioGuardado'

beforeEach(async () => {
  rpc.mockReset(); upload.mockReset(); signOut.mockReset(); getSession.mockReset()
  signInWithPassword.mockReset(); updateUser.mockReset(); refreshSession.mockReset(); invoke.mockReset(); from.mockReset()
  getSession.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })
  localStorage.clear()
  await clear()
})

describe('sair', () => {
  const joao = { email: 'joao@spazio.com', nome: 'João', papel: 'comprador' as const, ativo: true }

  it('esquece o usuário guardado e avisa o app', async () => {
    guardarUsuario(joao)
    signOut.mockResolvedValue({ error: null })
    const aviso = vi.fn()
    window.addEventListener(EVENTO_SAIU, aviso)
    await sair()
    window.removeEventListener(EVENTO_SAIU, aviso)
    expect(signOut).toHaveBeenCalled()
    expect(usuarioGuardado(joao.email)).toBeNull()
    expect(ultimoUsuario()).toBeNull()
    expect(aviso).toHaveBeenCalled()
  })

  it('sem internet (signOut devolve erro) também esquece o usuário', async () => {
    guardarUsuario(joao)
    signOut.mockResolvedValue({ error: new Error('Failed to fetch') })
    await sair()
    expect(ultimoUsuario()).toBeNull()
  })
})

describe('executarOp', () => {
  it('chama a função com os argumentos da operação', async () => {
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o', tipo: 'abrir_compra', args: { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' } })
    expect(rpc).toHaveBeenCalledWith('abrir_compra', { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' })
  })

  it('envia a foto antes de fechar e passa o caminho', async () => {
    upload.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    expect(upload.mock.calls[0][0]).toBe('c/o1.jpg')
    expect(rpc).toHaveBeenCalledWith('fechar_compra', { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: 'c/o1.jpg' })
  })

  it('foto que já tinha subido numa tentativa anterior não é erro', async () => {
    upload.mockResolvedValue({ error: { message: 'The resource already exists' } })
    rpc.mockResolvedValue({ error: null })
    await executarOp({ id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: false, p_total: 1, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    expect(rpc).toHaveBeenCalled()
  })

  const desmarcar: Op = { id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } }

  it('sem sessão não chama a função (nunca como anônimo): ErroRede para tentar depois', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await expect(executarOp(desmarcar)).rejects.toBeInstanceOf(ErroRede)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['sem resposta (status 0)', 0, ''],
    ['401 sem login', 401, '42501'],
    ['408 tempo esgotado', 408, ''],
    ['429 limite de pedidos', 429, ''],
    ['500 erro no servidor', 500, ''],
    ['503 fora do ar', 503, ''],
    ['JWT vencido (PGRST301)', 401, 'PGRST301'],
    ['JWT inválido (PGRST303)', 400, 'PGRST303'],
  ])('temporário → ErroRede: %s', async (_nome, status, code) => {
    rpc.mockResolvedValue({ error: { message: 'algo deu errado', code }, status })
    await expect(executarOp(desmarcar)).rejects.toBeInstanceOf(ErroRede)
  })

  it.each([
    ['regra de negócio (P0001)', 400, 'P0001', 'esta compra já foi fechada'],
    ['sem acesso (42501 → 403)', 403, '42501', 'usuário sem acesso ao app'],
    ['função não existe (404)', 404, 'PGRST202', 'Could not find the function'],
    ['P0001 com texto que parece de rede', 400, 'P0001', 'token inválido na regra'],
  ])('definitivo → erro normal: %s', async (_nome, status, code, message) => {
    rpc.mockResolvedValue({ error: { message, code }, status })
    const p = executarOp(desmarcar)
    await expect(p).rejects.toThrow(message)
    await expect(p).rejects.not.toBeInstanceOf(ErroRede)
  })

  it('erro da função guarda status e código', async () => {
    rpc.mockResolvedValue({ error: { message: 'só dá para aprovar compra fechada', code: 'P0001' }, status: 400 })
    const e = await aprovarCompra('c').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroApi)
    expect(e).toMatchObject({ message: 'só dá para aprovar compra fechada', status: 400, code: 'P0001' })
  })

  it('foto: falha 5xx no envio é temporária; 4xx é definitiva', async () => {
    const fechar: Op = { id: 'o1', tipo: 'fechar_compra', args: { p_compra: 'c', p_com_nota: true, p_total: 10, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } }
    upload.mockResolvedValue({ error: { message: 'Internal Server Error', status: 502 } })
    await expect(executarOp(fechar)).rejects.toBeInstanceOf(ErroRede)
    upload.mockResolvedValue({ error: { message: 'mime type not supported', status: 415 } })
    await expect(executarOp(fechar)).rejects.not.toBeInstanceOf(ErroRede)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('falha de rede vira ErroRede; erro de regra passa como erro normal', async () => {
    rpc.mockResolvedValue({ error: { message: 'TypeError: Failed to fetch' } })
    await expect(executarOp({ id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } })).rejects.toBeInstanceOf(ErroRede)
    rpc.mockResolvedValue({ error: { message: 'esta compra já foi fechada' } })
    const p = executarOp({ id: 'o', tipo: 'desmarcar_item', args: { p_compra: 'c', p_item: 1 } })
    await expect(p).rejects.toThrow('esta compra já foi fechada')
    await expect(p).rejects.not.toBeInstanceOf(ErroRede)
  })
})

describe('enviarOp', () => {
  it('não espera o envio: resolve assim que a operação entra na fila', async () => {
    let liberar: (v: { error: null }) => void = () => {}
    rpc.mockReturnValue(new Promise((r) => { liberar = r }))
    const op = { id: 'z', tipo: 'abrir_compra', args: { p_id: 'c', p_semana: 1, p_loja: 'FEIRA' } } as const
    await expect(enviarOp(op)).resolves.toBeUndefined()
    expect((await pendentes()).map((o) => o.id)).toEqual(['z'])
    liberar({ error: null })
  })
})

describe('entrarComSenha (P1)', () => {
  it('mapeia o usuário digitado para o e-mail interno', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    await entrarComSenha(' Joana ', 'segredo123')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'joana@spazio.invalid', password: 'segredo123' })
  })

  it('credenciais erradas: erro repassado', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await expect(entrarComSenha('joao', 'errada')).rejects.toThrow('Invalid login credentials')
  })
})

describe('criarAcesso / redefinirSenha (Edge Function)', () => {
  it('criarAcesso chama a função com a ação certa e devolve o e-mail', async () => {
    invoke.mockResolvedValue({ data: { email: 'nova@spazio.invalid' }, error: null })
    const r = await criarAcesso({ login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' })
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'criar', login: 'nova', nome: 'Nova', papel: 'comprador', senha: '123456' },
    })
    expect(r).toEqual({ email: 'nova@spazio.invalid' })
  })

  it('criarAcesso: erro da função (corpo JSON) vira a mensagem certa', async () => {
    const context = { json: async () => ({ erro: 'esse usuário já existe' }) } as unknown as Response
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context } })
    await expect(criarAcesso({ login: 'joao', nome: 'João', papel: 'comprador', senha: '123456' })).rejects.toThrow('esse usuário já existe')
  })

  it('redefinirSenha chama a função com o e-mail e a senha', async () => {
    invoke.mockResolvedValue({ data: { ok: true, email: 'joao@spazio.invalid' }, error: null })
    await redefinirSenha('joao@spazio.invalid', '123456')
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123456' },
    })
  })

  it('redefinirSenha sem senha explícita usa a senha padrão', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await redefinirSenha('joao@spazio.invalid')
    expect(invoke).toHaveBeenCalledWith('gerenciar-usuarios', {
      body: { acao: 'redefinir_senha', email: 'joao@spazio.invalid', senha: '123456' },
    })
  })
})

describe('trocarMinhaSenha (P2)', () => {
  it('confere a senha atual e troca', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    signInWithPassword.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ error: null })
    await trocarMinhaSenha('atual123', 'nova12345')
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'joao@spazio.invalid', password: 'atual123' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'nova12345' })
  })

  it('senha atual errada: não troca', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await expect(trocarMinhaSenha('errada', 'nova12345')).rejects.toThrow('Senha atual incorreta.')
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('sem internet ao conferir a senha atual: repassa o erro de rede, não "Senha atual incorreta." (M-b)', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { email: 'joao@spazio.invalid' } } }, error: null })
    const semRede = new AuthRetryableFetchError('Failed to fetch', 0)
    signInWithPassword.mockResolvedValue({ error: semRede })
    await expect(trocarMinhaSenha('atual123', 'nova12345')).rejects.toBe(semRede)
    expect(updateUser).not.toHaveBeenCalled()
  })
})

describe('escolherSenhaInicial (P3 — primeiro acesso)', () => {
  it('troca a senha sem pedir a atual e limpa a marca de troca obrigatória', async () => {
    updateUser.mockResolvedValue({ error: null })
    refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    await escolherSenhaInicial('minhaSenhaSó123')
    expect(updateUser).toHaveBeenCalledWith({ password: 'minhaSenhaSó123', data: { trocar_senha: false } })
    expect(refreshSession).toHaveBeenCalled()
  })
})

/** Imita a consulta do supabase-js: cada filtro devolve a própria consulta e o await entrega a resposta. */
function consulta(resposta: { data: unknown; error: { message: string } | null }) {
  const q: Record<string, unknown> = {}
  for (const metodo of ['select', 'eq', 'neq', 'in', 'gte', 'or', 'order', 'limit', 'maybeSingle']) q[metodo] = vi.fn(() => q)
  q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, falha)
  return q as Record<string, ReturnType<typeof vi.fn>>
}

describe('Fase 1A: selos, compras abertas e admin_fechar_compra', () => {
  it('itensDaSemana traz selos e custo médio; linha sem as colunas novas vale como "sem selo"', async () => {
    const selos = [{ codigo: 'linha_alta', texto: '≈ R$ 1.100,00 nesta linha (acima de R$ 1.000)' }]
    from.mockReturnValue(consulta({ data: [{ id: 1, produto: 'A' }, { id: 2, produto: 'B', selos, custo_medio: 9.5 }], error: null }))
    const r = await itensDaSemana(7)
    expect(from).toHaveBeenCalledWith('itens_semana')
    expect(r[0]).toMatchObject({ id: 1, selos: [], custo_medio: null })
    expect(r[1]).toMatchObject({ id: 2, selos, custo_medio: 9.5 })
  })

  it('comprasAbertasParaFechar: só as abertas da semana; conta os itens marcados e soma qtd × preço (sem preço conta 0)', async () => {
    const q = consulta({
      data: [
        {
          id: 'a1', semana_id: 7, loja: 'FEIRA', comprador: 'joao@spazio.com', aberta_em: '2026-09-23T13:05:00Z', status: 'aberta',
          usuarios: { nome: 'João' },
          compras_itens: [{ qtd: 2, preco_unit: 10.5 }, { qtd: 3, preco_unit: null }, { qtd: 0, preco_unit: 4 }, { qtd: '1.5', preco_unit: '2' }],
        },
        { id: 'a2', semana_id: 7, loja: 'PADARIA', comprador: 'maria@spazio.com', aberta_em: '2026-09-23T15:00:00Z', status: 'aberta', usuarios: null, compras_itens: [] },
      ],
      error: null,
    })
    from.mockReturnValue(q)
    const r = await comprasAbertasParaFechar(7)
    expect(from).toHaveBeenCalledWith('compras')
    expect(q.eq).toHaveBeenCalledWith('semana_id', 7)
    expect(q.eq).toHaveBeenCalledWith('status', 'aberta')
    expect(r).toEqual([
      { id: 'a1', loja: 'FEIRA', comprador: 'joao@spazio.com', aberta_em: '2026-09-23T13:05:00Z', comprador_nome: 'João', itens: 4, total_marcado: 24 },
      { id: 'a2', loja: 'PADARIA', comprador: 'maria@spazio.com', aberta_em: '2026-09-23T15:00:00Z', comprador_nome: 'maria@spazio.com', itens: 0, total_marcado: 0 },
    ])
  })

  describe('semanaTravandoAprovacao', () => {
    const emCompra = { id: 7, data_referencia: '2026-09-21', status: 'em_compra', aprovada_por: null, aprovada_em: null }
    const rascunho = { id: 8, data_referencia: '2026-09-28', status: 'rascunho', aprovada_por: null, aprovada_em: null }
    /** a primeira leitura é a semana em compra, a segunda a semana para revisar */
    const semanas = (emC: unknown, revisar: unknown) => from
      .mockReturnValueOnce(consulta({ data: emC, error: null }))
      .mockReturnValueOnce(consulta({ data: revisar, error: null }))

    it('lista nova em rascunho esperando e outra semana em compra: devolve a semana em compra', async () => {
      semanas(emCompra, rascunho)
      expect(await semanaTravandoAprovacao()).toEqual(emCompra)
    })
    it('sem rascunho esperando (a semana para revisar é a própria em compra): nada trava', async () => {
      semanas(emCompra, emCompra)
      expect(await semanaTravandoAprovacao()).toBeNull()
    })
    it('rascunho sem semana em compra: nada trava', async () => {
      semanas(null, rascunho)
      expect(await semanaTravandoAprovacao()).toBeNull()
    })
  })

  it('adminFecharCompra chama admin_fechar_compra com a compra, com/sem nota e o total', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await adminFecharCompra('c1', false, 123.4)).toBe(true)
    expect(rpc).toHaveBeenCalledWith('admin_fechar_compra', { p_compra: 'c1', p_com_nota: false, p_total: 123.4 })
  })

  it('adminFecharCompra devolve false quando o banco diz que a compra já estava fechada', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    expect(await adminFecharCompra('c1', true, 10)).toBe(false)
  })

  it('adminFecharCompra: recusa do banco vira erro com a mensagem', async () => {
    rpc.mockResolvedValue({ error: { message: 'compra sem itens: use Cancelar', code: 'P0001' }, status: 400 })
    await expect(adminFecharCompra('c1', true, 10)).rejects.toThrow('compra sem itens: use Cancelar')
  })
})

describe('Fase 1B: cotações (contrato 8.2)', () => {
  it('prepararCotacoes chama cot_preparar; "atravessados" ausente vira lista vazia', async () => {
    rpc.mockResolvedValue({ data: { semana_id: 3, cartoes: [], itens: [] }, error: null })
    const r = await prepararCotacoes(3)
    expect(rpc).toHaveBeenCalledWith('cot_preparar', { p_semana: 3 })
    expect(r.atravessados).toEqual([])
  })

  it('itensDasCotacoes: sem ids não chama o banco; com ids lê cot_itens_admin com nota e marca e converte os números', async () => {
    expect(await itensDasCotacoes([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
    const q = consulta({ data: [{ id: 1, cotacao_id: 7, qtd: '104', fator: '12', preco_convertido: '3.5000', delta: '0.1800', avisos_vendedor: null, avisos_ivan: null }], error: null })
    from.mockReturnValue(q)
    const [i] = await itensDasCotacoes([7, 8])
    expect(from).toHaveBeenCalledWith('cot_itens_admin')
    expect(q.in).toHaveBeenCalledWith('cotacao_id', [7, 8])
    expect(q.select.mock.calls[0][0]).toMatch(/nota_vendedor/)
    expect(q.select.mock.calls[0][0]).toMatch(/marca_informada/)
    expect(i).toMatchObject({ qtd: 104, fator: 12, preco_convertido: 3.5, delta: 0.18, avisos_vendedor: [], avisos_ivan: [], nota_vendedor: null, marca_informada: null })
  })

  it('cotacoesAnterioresVivas: outras semanas, vivas ou fechadas sem resultado há menos de 7 dias', async () => {
    const q = consulta({ data: [{ id: 5, semana_id: 2, pedido_minimo: '300', frete: null }], error: null })
    from.mockReturnValue(q)
    const r = await cotacoesAnterioresVivas(3)
    expect(from).toHaveBeenCalledWith('cot_cotacoes')
    expect(q.neq).toHaveBeenCalledWith('semana_id', 3)
    const filtro = String(q.or.mock.calls[0][0])
    expect(filtro.startsWith('status.in.(pronta,enviada,respondida),and(status.eq.fechada,resultado.is.null,fechada_em.gt.')).toBe(true)
    expect(r[0]).toMatchObject({ pedido_minimo: 300, frete: null })
  })

  it('cotacoesSubstituidasPor: sem ids não chama o banco; com ids lê cot_cotacoes com substituida_por in ids', async () => {
    expect(await cotacoesSubstituidasPor([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
    const q = consulta({ data: [{ id: 4, semana_id: 2, status: 'substituida', substituida_por: 5, pedido_minimo: null, frete: '30' }], error: null })
    from.mockReturnValue(q)
    const r = await cotacoesSubstituidasPor([5, 9])
    expect(from).toHaveBeenCalledWith('cot_cotacoes')
    expect(q.in).toHaveBeenCalledWith('substituida_por', [5, 9])
    expect(r[0]).toMatchObject({ id: 4, substituida_por: 5, frete: 30 })
  })

  it('codigosDasCotacoes: mapa id → código', async () => {
    from.mockReturnValue(consulta({ data: [{ cotacao_id: 7, codigo: 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG' }], error: null }))
    expect(await codigosDasCotacoes([7])).toEqual({ 7: 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG' })
  })

  it('definirNota, novaVersao, gravarPedido, responderComoAdmin e abrirComoVendedor chamam as funções com os nomes do contrato', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await definirNota(10, 'fardo c/12')
    expect(rpc).toHaveBeenLastCalledWith('cot_definir_nota', { p_produto_id: 10, p_nota: 'fardo c/12' })
    rpc.mockResolvedValue({ data: '12', error: null })
    expect(await novaVersao(7)).toBe(12)
    expect(rpc).toHaveBeenLastCalledWith('cot_nova_versao', { p_cotacao: 7 })
    const linha = { numero: 2, qtd: 108, base: 'embalagem' as const, embalagens: 9, fator: 12, preco_combinado: 42 }
    rpc.mockResolvedValue({ data: { cotacao_id: 7, confirmado_por: 'ivan@spazio.com', confirmado_em: 'x', itens: [{ ...linha, produto_id: 10, preco_convertido: '3.5', qtd: '108' }] }, error: null })
    const p = await gravarPedido(7, [linha])
    expect(rpc).toHaveBeenLastCalledWith('cot_gravar_pedido', { p_cotacao: 7, p_itens: [linha] })
    expect(p.itens[0]).toMatchObject({ qtd: 108, preco_convertido: 3.5, marca: null })
    rpc.mockResolvedValue({ data: { ok: true, reenvio: false, recebido_em: 'x', itens: [], gerais: null }, error: null })
    await responderComoAdmin(7, 'e1', [{ numero: 1, rev_lida: 0, estado: 'nao_tem' }], null, 'ivan_colou')
    expect(rpc).toHaveBeenLastCalledWith('cot_responder_admin', {
      p_cotacao: 7, p_envio_id: 'e1', p_itens: [{ numero: 1, rev_lida: 0, estado: 'nao_tem' }], p_gerais: null, p_origem: 'ivan_colou',
    })
    rpc.mockResolvedValue({ data: { ok: false, erro: 'codigo_invalido', texto: 'Este link não vale mais.' }, error: null })
    await abrirComoVendedor('q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG')
    expect(rpc).toHaveBeenLastCalledWith('cotacao_abrir', { p_codigo: 'q7Lm2vT9xKp4RsW8nB3yZc6Hd1FjA5eG', p_previa: true })
  })

  it('recusa do banco numa função de admin vira ErroApi com a mensagem exata', async () => {
    rpc.mockResolvedValue({ error: { message: 'pedido já confirmado', code: 'P0001' }, status: 400 })
    await expect(gravarPedido(7, [])).rejects.toThrow('pedido já confirmado')
  })

  it('marcasDaSemana: função ainda inexistente (App antes da migration) → sem etiqueta; outro erro sobe', async () => {
    rpc.mockResolvedValue({ error: { message: 'Could not find the function', code: 'PGRST202' }, status: 404 })
    expect(await marcasDaSemana(3)).toEqual([])
    rpc.mockResolvedValue({ error: { message: 'usuário sem acesso ao app', code: '42501' }, status: 403 })
    await expect(marcasDaSemana(3)).rejects.toBeInstanceOf(ErroApi)
  })

  it('economiaSemanas: view ausente → []; números convertidos, na ordem da semana', async () => {
    const q = consulta({ data: [{ semana_id: 3, data_referencia: '2026-10-19', total_pedido: '2380', total_ultimo: '2520', diferenca: '-140' }], error: null })
    from.mockReturnValue(q)
    expect((await economiaSemanas())[0]).toMatchObject({ total_pedido: 2380, total_ultimo: 2520, diferenca: -140 })
    expect(from).toHaveBeenCalledWith('cot_economia')
    expect(q.order).toHaveBeenCalledWith('data_referencia')
    from.mockReturnValue(consulta({ data: null, error: { message: 'relation "cot_economia" does not exist', code: '42P01' } as never }))
    expect(await economiaSemanas()).toEqual([])
    from.mockReturnValue(consulta({ data: null, error: { message: 'Could not find the table', code: 'PGRST205' } as never }))
    expect(await economiaSemanas()).toEqual([])
  })

  it('pedidosRecentes: pedidos desde a data, de cotações de OUTRAS semanas, com semana e vendedor', async () => {
    const pedidos = consulta({ data: [
      { cotacao_id: 5, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-10-14T13:00:00Z', itens: [{ numero: 1, produto_id: 10, qtd: '60', base: 'un', embalagens: null, fator: null, preco_combinado: '2', preco_convertido: '2' }] },
      { cotacao_id: 9, confirmado_por: 'ivan@spazio.com', confirmado_em: '2026-10-21T13:00:00Z', itens: [] },
    ], error: null })
    const cotacoes = consulta({ data: [{ id: 5, semana_id: 2, vendedor_id: 1 }, { id: 9, semana_id: 3, vendedor_id: 1 }], error: null })
    from.mockReturnValueOnce(pedidos).mockReturnValueOnce(cotacoes)
    const r = await pedidosRecentes(3, '2026-10-12T03:00:00.000Z')
    expect(from.mock.calls.map((c) => c[0])).toEqual(['cot_pedidos', 'cot_cotacoes'])
    expect(pedidos.gte).toHaveBeenCalledWith('confirmado_em', '2026-10-12T03:00:00.000Z')
    expect(cotacoes.in).toHaveBeenCalledWith('id', [5, 9])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cotacao_id: 5, semana_id: 2, vendedor_id: 1 })
    expect(r[0].itens[0]).toMatchObject({ produto_id: 10, qtd: 60, preco_combinado: 2, marca: null })
  })

  it('pedidosRecentes: tabela ausente → []', async () => {
    from.mockReturnValue(consulta({ data: null, error: { message: 'Could not find the table', code: 'PGRST205' } as never }))
    expect(await pedidosRecentes(3, '2026-10-12T03:00:00.000Z')).toEqual([])
  })
})
