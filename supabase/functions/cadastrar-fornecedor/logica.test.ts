import { tratar, type Corpo, type CupomLinha, type Deps, type PedidoNovo } from './logica'

const CNPJ = '63540861000182'
const CUPOM = 'aaf54e6f-0b1c-4d2e-9f3a-4b5c6d7e8f90'
const PARADO: CupomLinha = { id: CUPOM, estado: 'REVISAR', pedido_sischef: null, motivo: `fornecedor não encontrado no Sischef (A. N. DA SILVA DESCARTAVEIS LTDA, CNPJ ${CNPJ})` }
const CORPO: Corpo = { cnpj: '63.540.861/0001-82', razao_social: ' A. N. DA SILVA  DESCARTAVEIS LTDA ', nome_fantasia: 'AN DESCARTÁVEIS', uf: 'pa', municipio: 'Abaetetuba', cupom_id: CUPOM }

function fakeDeps(over: Partial<Deps> & { cupom?: CupomLinha | null; usuario?: { papel: string; ativo: boolean } | null } = {}) {
  const reg = { fantasias: [] as unknown[][], pedidos: [] as PedidoNovo[], disparos: [] as string[], revisar: [] as string[][] }
  const deps: Deps = {
    buscarUsuario: async () => (over.usuario === undefined ? { papel: 'admin', ativo: true } : over.usuario),
    lerCupom: async () => (over.cupom === undefined ? PARADO : over.cupom),
    salvarFantasia: async (...a) => { reg.fantasias.push(a) },
    criarPedido: async (p) => { reg.pedidos.push(p); return { id: 'cad-1' } },
    dispararCadastro: async (id) => { reg.disparos.push(id) },
    marcarRevisar: async (id, m) => { reg.revisar.push([id, m]) },
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
})
