import { tratar, type Corpo, type CupomLinha, type Deps, type NotaLinha, type PedidoNovo } from './logica'

const CNPJ = '63540861000182'
const CUPOM = 'aaf54e6f-0b1c-4d2e-9f3a-4b5c6d7e8f90'
const PARADO: CupomLinha = { id: CUPOM, estado: 'REVISAR', pedido_sischef: null, motivo: `fornecedor não encontrado no Sischef (A. N. DA SILVA DESCARTAVEIS LTDA, CNPJ ${CNPJ})` }
const CORPO: Corpo = { cnpj: '63.540.861/0001-82', razao_social: ' A. N. DA SILVA  DESCARTAVEIS LTDA ', nome_fantasia: 'AN DESCARTÁVEIS', uf: 'pa', municipio: 'Abaetetuba', cupom_id: CUPOM }

function fakeDeps(over: Partial<Deps> & { cupom?: CupomLinha | null; usuario?: { papel: string; ativo: boolean } | null } = {}) {
  const reg = { fantasias: [] as unknown[][], pedidos: [] as PedidoNovo[], disparos: [] as string[], revisar: [] as string[][], expirados: [] as string[], ordem: [] as string[] }
  const deps: Deps = {
    buscarUsuario: async () => (over.usuario === undefined ? { papel: 'admin', ativo: true } : over.usuario),
    lerCupom: async () => (over.cupom === undefined ? PARADO : over.cupom),
    lerNota: async () => { throw new Error('o cupom não podia consultar nota') },
    salvarFantasia: async (...a) => { reg.fantasias.push(a) },
    criarPedido: async (p) => { reg.pedidos.push(p); return { id: 'cad-1' } },
    dispararCadastro: async (id) => { reg.disparos.push(id) },
    marcarRevisar: async (id, m) => { reg.revisar.push([id, m]) },
    expirarPedidosParados: async (cnpj) => { reg.expirados.push(cnpj); reg.ordem.push('expirar') },
    ...over,
  }
  return { deps, reg }
}

describe('cadastrar-fornecedor — tratar', () => {
  it('caminho feliz: guarda a fantasia só no app, grava o pedido (sem fantasia no pedido do Sischef: ela vai só como dado do app) e dispara o robô uma vez', async () => {
    const { deps, reg } = fakeDeps()
    const r = await tratar(CORPO, 'Ivan@Spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'cad-1' })
    expect(reg.fantasias).toEqual([[CNPJ, 'A. N. DA SILVA DESCARTAVEIS LTDA', 'AN DESCARTÁVEIS']])
    expect(reg.pedidos).toEqual([{ cnpj: CNPJ, razao_social: 'A. N. DA SILVA DESCARTAVEIS LTDA', nome_fantasia: 'AN DESCARTÁVEIS', uf: 'PA', municipio: 'Abaetetuba', cupom_id: CUPOM, criado_por: 'ivan@spazio.com' }])
    expect(reg.disparos).toEqual(['cad-1'])
  })
  it('sem fantasia: não grava fornecedor_app', async () => {
    const { deps, reg } = fakeDeps()
    await tratar({ ...CORPO, nome_fantasia: '  ' }, 'ivan@spazio.com', deps)
    expect(reg.fantasias).toEqual([])
    expect(reg.pedidos[0].nome_fantasia).toBeNull()
  })
  it('só o admin cadastra (403) e nada é gravado nem disparado', async () => {
    const { deps, reg } = fakeDeps({ usuario: { papel: 'comprador', ativo: true } })
    expect((await tratar(CORPO, 'joao@spazio.com', deps)).status).toBe(403)
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
  })
  it.each([
    ['CNPJ com dígito errado', { cnpj: '63540861000183' }],
    ['razão vazia', { razao_social: '  ' }],
    ['UF desconhecida', { uf: 'XX' }],
    ['município vazio', { municipio: '' }],
    ['cupom sem id', { cupom_id: 'x' }],
    ['fantasia gigante', { nome_fantasia: 'x'.repeat(201) }],
  ])('recusa %s (400) sem gravar nada', async (_n, mudanca) => {
    const { deps, reg } = fakeDeps()
    expect((await tratar({ ...CORPO, ...mudanca } as Corpo, 'ivan@spazio.com', deps)).status).toBe(400)
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
    expect(reg.fantasias).toEqual([])
  })
  it('cupom que não existe (404) ou que não parou por fornecedor (409): nada é gravado', async () => {
    expect((await tratar(CORPO, 'ivan@spazio.com', fakeDeps({ cupom: null }).deps)).status).toBe(404)
    for (const cupom of [{ ...PARADO, estado: 'LANCADO' }, { ...PARADO, motivo: '2 item(ns) sem casamento confirmado' }, { ...PARADO, pedido_sischef: '123' }]) {
      const { deps, reg } = fakeDeps({ cupom })
      expect((await tratar(CORPO, 'ivan@spazio.com', deps)).status).toBe(409)
      expect(reg.pedidos).toEqual([])
    }
  })
  it('toque duplo: já há pedido em andamento para o CNPJ — devolve o existente e NÃO dispara de novo', async () => {
    const { deps, reg } = fakeDeps({ criarPedido: async () => ({ id: 'cad-0', duplicado: true }) })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'cad-0', em_andamento: true })
    expect(reg.disparos).toEqual([])
  })
  it('o disparo falha: 502, e o pedido vai a REVISAR (não fica PENDENTE para sempre)', async () => {
    const { deps, reg } = fakeDeps({ dispararCadastro: async () => { throw new Error('HTTP 401') } })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(502)
    expect(reg.revisar[0][0]).toBe('cad-1')
  })
  it('sem cupom e sem nota: 400 "sem o cupom" e nada é consultado nem gravado', async () => {
    const { deps, reg } = fakeDeps()
    const { cupom_id: _c, ...semNada } = CORPO
    expect((await tratar(semNada, 'ivan@spazio.com', deps)).status).toBe(400)
    expect(reg.pedidos).toEqual([])
  })
})

// 31/10/2026 (Plast Mais 8928): o fornecedor da NOTA FISCAL não está no SisChef. O pedido vem com a chave da nota (nota_chave), sem cupom; só vale para a nota que o robô
// devolveu por isso e para o CNPJ do EMITENTE dela (dígitos 7 a 20 da chave).
describe('cadastrar-fornecedor — tratar (nota fiscal)', () => {
  const CNPJ_PLAST = '55384032000120'
  const CHAVE = `262610${CNPJ_PLAST}55001000008928144282112`.slice(0, 44).padEnd(44, '1')   // UF 26 + AAMM 2610 + CNPJ do emitente + o resto
  const NOTA_PARADA: NotaLinha = { chave: CHAVE, situacao: 'na_fila', lancamento_estado: 'revisar', descartada_em: null,
    lancamento_motivo: 'fornecedor não cadastrado no Sischef e sem autorização do Ivan (autorize no app) — nada lançado' }
  const CORPO_NOTA: Corpo = { cnpj: '55.384.032/0001-20', razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: '', uf: 'pa', municipio: 'Belém', nota_chave: CHAVE }
  const comNota = (nota: NotaLinha | null, extra: Partial<Deps> = {}) => {
    const cenario = fakeDeps({ lerCupom: async () => { throw new Error('a nota não podia consultar cupom') }, ...extra })
    cenario.deps.lerNota = async () => nota
    return cenario
  }

  it('a chave de teste tem 44 dígitos e o CNPJ do emitente nas posições 7 a 20', () => {
    expect(CHAVE).toHaveLength(44)
    expect(CHAVE.slice(6, 20)).toBe(CNPJ_PLAST)
  })
  it('caminho feliz: grava o pedido SEM cupom (cupom_id null) e dispara o robô uma vez', async () => {
    const { deps, reg } = comNota(NOTA_PARADA)
    const r = await tratar(CORPO_NOTA, 'Ivan@Spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'cad-1' })
    expect(reg.pedidos).toEqual([{ cnpj: CNPJ_PLAST, razao_social: 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', nome_fantasia: null, uf: 'PA', municipio: 'Belém', cupom_id: null, criado_por: 'ivan@spazio.com' }])
    expect(reg.disparos).toEqual(['cad-1'])
  })
  it('o aviso do ensaio ("cadastraria … num clique") e o estado ensaio_ok também valem', async () => {
    const { deps, reg } = comNota({ ...NOTA_PARADA, lancamento_estado: 'ensaio_ok', lancamento_motivo: 'fornecedor: cadastraria PLAST MAIS SOCIEDADE UNIPESSOAL LTDA CNPJ 55.384.032/0001-20 num clique (cadastra do XML)' })
    expect((await tratar(CORPO_NOTA, 'ivan@spazio.com', deps)).status).toBe(200)
    expect(reg.disparos).toEqual(['cad-1'])
  })
  it('chave inválida (400) e nota que não existe (404): nada é gravado', async () => {
    const a = comNota(NOTA_PARADA)
    expect((await tratar({ ...CORPO_NOTA, nota_chave: '123' }, 'ivan@spazio.com', a.deps)).status).toBe(400)
    const b = comNota(null)
    expect((await tratar(CORPO_NOTA, 'ivan@spazio.com', b.deps)).status).toBe(404)
    expect(a.reg.pedidos).toEqual([])
    expect(b.reg.pedidos).toEqual([])
  })
  it.each([
    ['nota já lançada', { situacao: 'lancada' }],
    ['robô lançando agora', { lancamento_estado: 'lancando' }],
    ['nota pela metade', { lancamento_estado: 'erro' }],
    ['parou por outro motivo', { lancamento_motivo: 'não consegui ler o XML da nota (sem XML)' }],
    ['nota descartada pelo Ivan', { descartada_em: '2026-10-31T10:00:00Z' }],
    ['sem motivo', { lancamento_motivo: null }],
  ])('nota que não está parada por fornecedor novo (%s): 409 e nada é gravado', async (_n, mudanca) => {
    const { deps, reg } = comNota({ ...NOTA_PARADA, ...mudanca } as NotaLinha)
    expect((await tratar(CORPO_NOTA, 'ivan@spazio.com', deps)).status).toBe(409)
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
  })
  it('o CNPJ tem de ser o do EMITENTE da nota: outro CNPJ (mesmo válido) é recusado (400) e nada é gravado', async () => {
    const { deps, reg } = comNota(NOTA_PARADA)
    expect((await tratar({ ...CORPO_NOTA, cnpj: CNPJ }, 'ivan@spazio.com', deps)).status).toBe(400)   // CNPJ válido, mas de outra empresa
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
    expect(reg.fantasias).toEqual([])
  })
  it('só o admin (403) e os campos do formulário continuam validados também no caminho da nota', async () => {
    const a = comNota(NOTA_PARADA, { buscarUsuario: async () => ({ papel: 'comprador', ativo: true }) })
    expect((await tratar(CORPO_NOTA, 'joao@spazio.com', a.deps)).status).toBe(403)
    const b = comNota(NOTA_PARADA)
    expect((await tratar({ ...CORPO_NOTA, uf: 'XX' }, 'ivan@spazio.com', b.deps)).status).toBe(400)
    expect((await tratar({ ...CORPO_NOTA, municipio: '' }, 'ivan@spazio.com', b.deps)).status).toBe(400)
    expect(a.reg.pedidos).toEqual([])
    expect(b.reg.pedidos).toEqual([])
  })
  it('chave com MAIS de 44 dígitos é recusada como inválida (400) sem consultar o banco', async () => {
    let leu = 0
    const { deps } = comNota(NOTA_PARADA, { lerNota: async () => { leu++; return NOTA_PARADA } })
    deps.lerNota = async () => { leu++; return NOTA_PARADA }
    const r = await tratar({ ...CORPO_NOTA, nota_chave: `${CHAVE}9` }, 'ivan@spazio.com', deps)
    expect(r.status).toBe(400)
    expect(r.corpo.erro).toBe('chave da nota inválida')
    expect(leu).toBe(0)
  })
  it('nota_chave E cupom_id juntos: vale a NOTA (o cupom nem é lido) e o pedido sai com cupom_id null', async () => {
    const { deps, reg } = comNota(NOTA_PARADA)            // o lerCupom do cenário estoura se for chamado
    const r = await tratar({ ...CORPO_NOTA, cupom_id: CUPOM }, 'ivan@spazio.com', deps)
    expect(r.status).toBe(200)
    expect(reg.pedidos[0].cupom_id).toBeNull()
  })
  it('antes de gravar o pedido o servidor encerra os pedidos PARADOS deste CNPJ (um pedido que o robô nunca pegou não bloqueia o CNPJ para sempre) — na nota e no cupom', async () => {
    const nota = comNota(NOTA_PARADA)
    const ordem: string[] = []
    nota.deps.expirarPedidosParados = async (c) => { ordem.push(`expirar:${c}`) }
    const criar = nota.deps.criarPedido
    nota.deps.criarPedido = async (p) => { ordem.push('criar'); return criar(p) }
    expect((await tratar(CORPO_NOTA, 'ivan@spazio.com', nota.deps)).status).toBe(200)
    expect(ordem).toEqual([`expirar:${CNPJ_PLAST}`, 'criar'])
    const cupom = fakeDeps()
    expect((await tratar(CORPO, 'ivan@spazio.com', cupom.deps)).status).toBe(200)
    expect(cupom.reg.expirados).toEqual([CNPJ])
  })
  it('pedido recusado (403/400/404/409) não encerra nada: a limpeza só roda quando o pedido novo vai ser gravado', async () => {
    const a = comNota(NOTA_PARADA, { buscarUsuario: async () => ({ papel: 'comprador', ativo: true }) })
    const b = comNota({ ...NOTA_PARADA, lancamento_estado: 'lancando' })
    const c = comNota(NOTA_PARADA)
    await tratar(CORPO_NOTA, 'joao@spazio.com', a.deps)
    await tratar(CORPO_NOTA, 'ivan@spazio.com', b.deps)
    await tratar({ ...CORPO_NOTA, cnpj: CNPJ }, 'ivan@spazio.com', c.deps)
    expect([a.reg.expirados, b.reg.expirados, c.reg.expirados]).toEqual([[], [], []])
  })
  it('a nota com a fantasia: ela vai só para o app (fornecedor_app), como no cupom', async () => {
    const { deps, reg } = comNota(NOTA_PARADA)
    await tratar({ ...CORPO_NOTA, nome_fantasia: 'PLAST MAIS' }, 'ivan@spazio.com', deps)
    expect(reg.fantasias).toEqual([[CNPJ_PLAST, 'PLAST MAIS SOCIEDADE UNIPESSOAL LTDA', 'PLAST MAIS']])
    expect(reg.pedidos[0].nome_fantasia).toBe('PLAST MAIS')
  })
})
