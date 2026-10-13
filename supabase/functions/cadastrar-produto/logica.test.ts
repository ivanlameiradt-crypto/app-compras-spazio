import { GRUPOS_DE_INSUMO as GRUPOS_DO_APP, chaveDoNome as chaveDoApp } from '../../../src/admin/produtoRegras'
import { GRUPOS_DE_INSUMO, MINUTOS_PRESO, chaveDoNome, tratar, type Concluido, type Corpo, type Deps, type PedidoNovo } from './logica'

const CORPO: Corpo = { descricao: ' MAIONESE  HELLMANNS 3KG - INSUMOS ', grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', origem_item: 3 }
const CHAVE = 'maionese hellmanns 3kg insumos'

function fakeDeps(over: Partial<Deps> & { usuario?: { papel: string; ativo: boolean } | null; concluido?: Concluido | null } = {}) {
  const reg = { pedidos: [] as PedidoNovo[], disparos: [] as string[], revisar: [] as string[][], expirados: [] as [string, number][], ordem: [] as string[] }
  const deps: Deps = {
    buscarUsuario: async () => (over.usuario === undefined ? { papel: 'admin', ativo: true } : over.usuario),
    ultimoConcluido: async () => (over.concluido === undefined ? null : over.concluido),
    expirarPresos: async (chave, min) => { reg.ordem.push('expirar'); reg.expirados.push([chave, min]) },
    criarPedido: async (p) => { reg.ordem.push('criar'); reg.pedidos.push(p); return { id: 'prod-1' } },
    dispararCadastro: async (id) => { reg.disparos.push(id) },
    marcarRevisar: async (id, m) => { reg.revisar.push([id, m]) },
    ...over,
  }
  return { deps, reg }
}

describe('cadastrar-produto — chave e lista de grupos', () => {
  it('a chave do nome é a mesma no app e na função (sem acento, minúsculas, só letras e números)', () => {
    for (const n of ['MAIONESE  HELLMANNS 3KG - INSUMOS', 'Açúcar Cristal 1Kg (União) - INSUMOS', 'ÓLEO D\'ÁGUA / 900ml']) expect(chaveDoNome(n)).toBe(chaveDoApp(n))
    expect(chaveDoNome('MAIONESE HELLMANNS 3KG - INSUMOS')).toBe(CHAVE)
    expect(chaveDoNome('Açúcar Cristal 1Kg (União)')).toBe('acucar cristal 1kg uniao')
  })
  it('a lista de grupos da função é igual à do app', () => {
    expect(GRUPOS_DE_INSUMO).toEqual(GRUPOS_DO_APP)
    expect(GRUPOS_DE_INSUMO).toHaveLength(28)
  })
})

describe('cadastrar-produto — tratar', () => {
  it('caminho feliz: normaliza, grava o pedido (com origem e chave) e dispara o robô uma vez', async () => {
    const { deps, reg } = fakeDeps()
    const r = await tratar(CORPO, 'Ivan@Spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'prod-1', chave_nome: CHAVE })
    expect(reg.pedidos).toEqual([{ descricao: 'MAIONESE HELLMANNS 3KG - INSUMOS', chave_nome: CHAVE, grupo: 'ESTOQUE CONTROLADO', unidade: 'KG', palavras: 'maion hellmanns', origem: 'cupom', origem_id: 'cupom-1', origem_item: 3, forcar: false, existente_id: null, criado_por: 'ivan@spazio.com' }])
    expect(reg.disparos).toEqual(['prod-1'])
  })
  it('pedido preso há mais de 20 minutos é dado como perdido ANTES de gravar o novo', async () => {
    const { deps, reg } = fakeDeps()
    await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(reg.expirados).toEqual([[CHAVE, MINUTOS_PRESO]])
    expect(reg.ordem).toEqual(['expirar', 'criar'])
  })
  it('campos opcionais ausentes viram null (palavras, origem_id, origem_item)', async () => {
    const { deps, reg } = fakeDeps()
    await tratar({ descricao: 'X', grupo: 'ESTOQUE CONTROLADO', unidade: 'UN', origem: 'avulsa' }, 'ivan@spazio.com', deps)
    expect(reg.pedidos[0]).toMatchObject({ palavras: null, origem_id: null, origem_item: null, forcar: false, existente_id: null, unidade: 'UN', origem: 'avulsa' })
  })
  it('"Usar este" (existente_id) e "Criar mesmo assim" (forcar) vão no pedido', async () => {
    const a = fakeDeps(); await tratar({ ...CORPO, existente_id: 3469720 }, 'ivan@spazio.com', a.deps)
    expect(a.reg.pedidos[0]).toMatchObject({ existente_id: 3469720, forcar: false })
    const b = fakeDeps(); await tratar({ ...CORPO, forcar: true }, 'ivan@spazio.com', b.deps)
    expect(b.reg.pedidos[0]).toMatchObject({ forcar: true, existente_id: null })
  })
  it('só o admin cadastra (403) e nada é gravado nem disparado', async () => {
    for (const usuario of [{ papel: 'comprador', ativo: true }, { papel: 'admin', ativo: false }, null]) {
      const { deps, reg } = fakeDeps({ usuario })
      expect((await tratar(CORPO, 'joao@spazio.com', deps)).status).toBe(403)
      expect(reg.pedidos).toEqual([])
      expect(reg.disparos).toEqual([])
    }
  })
  it.each([
    ['nome vazio', { descricao: '   ' }],
    ['nome só com símbolos', { descricao: '- / -' }],
    ['nome gigante', { descricao: 'x'.repeat(201) }],
    ['grupo fora da lista', { grupo: 'BEBIDAS' }],
    ['grupo vazio', { grupo: '' }],
    ['unidade PCT (a lista do app só aceita KG ou UN)', { unidade: 'PCT' }],
    ['unidade em minúscula', { unidade: 'kg' }],
    ['palavras gigantes', { palavras: 'a'.repeat(501) }],
    ['origem desconhecida', { origem: 'outra' }],
    ['origem sem valor', { origem: undefined }],
    ['origem_id gigante', { origem_id: 'x'.repeat(81) }],
    ['item negativo', { origem_item: -1 }],
    ['item quebrado', { origem_item: 1.5 }],
    ['existente_id zero', { existente_id: 0 }],
    ['existente_id texto', { existente_id: '3469720' }],
    ['forcar texto', { forcar: 'sim' }],
  ])('recusa %s (400) sem gravar nada', async (_n, mudanca) => {
    const { deps, reg } = fakeDeps()
    expect((await tratar({ ...CORPO, ...mudanca } as Corpo, 'ivan@spazio.com', deps)).status).toBe(400)
    expect(reg.pedidos).toEqual([])
    expect(reg.disparos).toEqual([])
    expect(reg.expirados).toEqual([])
  })
  it('já cadastrado com este nome: devolve o pedido feito, sem gravar nem disparar; "forcar" ou "existente_id" ignoram isso', async () => {
    const concluido: Concluido = { id: 'velho-1', estado: 'CADASTRADO', produto_id: 3924999 }
    const a = fakeDeps({ concluido })
    const r = await tratar(CORPO, 'ivan@spazio.com', a.deps)
    expect(r).toEqual({ status: 200, corpo: expect.objectContaining({ cadastro_id: 'velho-1', ja_cadastrado: true, estado: 'CADASTRADO', produto_id: 3924999 }) })
    expect(a.reg.pedidos).toEqual([])
    expect(a.reg.disparos).toEqual([])
    const b = fakeDeps({ concluido }); await tratar({ ...CORPO, forcar: true }, 'ivan@spazio.com', b.deps)
    expect(b.reg.pedidos).toHaveLength(1)
    const c = fakeDeps({ concluido }); await tratar({ ...CORPO, existente_id: 5 }, 'ivan@spazio.com', c.deps)
    expect(c.reg.pedidos).toHaveLength(1)
  })
  it('pedido em andamento para o mesmo nome: devolve o existente e NÃO dispara de novo', async () => {
    const { deps, reg } = fakeDeps({ criarPedido: async () => ({ id: 'andando-1', duplicado: true }) })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cadastro_id: 'andando-1', em_andamento: true })
    expect(reg.disparos).toEqual([])
  })
  it('se o disparo falhar, o pedido vira REVISAR com o aviso e a resposta é 502 (com o id, para a tela acompanhar)', async () => {
    const { deps, reg } = fakeDeps({ dispararCadastro: async () => { throw new Error('GitHub fora do ar') } })
    const r = await tratar(CORPO, 'ivan@spazio.com', deps)
    expect(r.status).toBe(502)
    expect(r.corpo).toMatchObject({ cadastro_id: 'prod-1', chave_nome: CHAVE })
    expect(reg.revisar).toHaveLength(1)
    expect(reg.revisar[0][0]).toBe('prod-1')
  })
  it('se até o "marcar REVISAR" falhar, ainda responde 502 (não explode)', async () => {
    const { deps } = fakeDeps({ dispararCadastro: async () => { throw new Error('x') }, marcarRevisar: async () => { throw new Error('y') } })
    expect((await tratar(CORPO, 'ivan@spazio.com', deps)).status).toBe(502)
  })
})
