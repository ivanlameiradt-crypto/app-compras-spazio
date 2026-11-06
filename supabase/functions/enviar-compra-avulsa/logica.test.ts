import { tratar, validarItens, validarPagamento, totalDosItens, itemDoCupom, type Deps } from './logica'
import type { Impressao, Parecida } from './parecida.ts'

const ENVIO = '3f2b8c1e-5d4a-4e7b-9a10-6c2d8f0b1a23'
const IVAN = 'ivan@spazio.com'
const FORNECEDOR = { cnpj: '75.315.333/0326-55', nome: 'ATACADAO S.A.' }
const ITENS = [{ produto_id: 1001, quantidade: 12.5, preco: 8.9, descricao: 'TOMATE ITALIANO' }, { produto_id: '3862312', quantidade: 1000, preco: 1.516 }]
const CORPO = { envio_id: ENVIO, fornecedor: FORNECEDOR, pagamento: { forma: 'dinheiro', conta: 'DINHEIRO - À Vista' }, itens: ITENS }

function fakeDeps(over: Partial<Deps> = {}): Deps & { gravou: Record<string, unknown>[]; disparou: string[] } {
  const gravou: Record<string, unknown>[] = []
  const disparou: string[] = []
  const base: Deps = {
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async produtosExistentes(ids) { return new Set(ids) },
    async inserirCupom(linha) { gravou.push(linha); return { id: 'c-novo' } },
    async dispararLancamento(id) { disparou.push(id) },
  }
  return Object.assign(base, over, { gravou, disparou }) as Deps & { gravou: Record<string, unknown>[]; disparou: string[] }
}

describe('validarPagamento', () => {
  it('sem_cartao ok; dinheiro/tesouraria/PIX só com a conta certa; cartão e texto solto recusam', () => {
    expect(validarPagamento({ forma: 'sem_cartao' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'dinheiro', conta: 'DINHEIRO - À Vista' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'tesouraria', conta: 'TESOURARIA - À Vista' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'pix', conta: 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY - À Vista' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'pix', conta: 'CONTA BANCÁRIA - PAG BANK - I J LAMEIRA - À Vista' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'pix', conta: 'CONTA BANCÁRIA - PANG ITAU - I J LAMEIRA' }).ok).toBe(false) // o SisChef não tem mais Itaú
    expect(validarPagamento({ forma: 'pix', conta: 'CONTA BANCÁRIA - PANG BANK - I J LAMEIRA' }).ok).toBe(false) // o nome antigo, sem o "- À Vista", é recusado
    expect(validarPagamento({ forma: 'dinheiro', conta: 'TESOURARIA - À Vista' }).ok).toBe(false) // conta de outra forma
    expect(validarPagamento({ forma: 'pix' }).ok).toBe(false)
    expect(validarPagamento({ forma: 'cartao', conta: 'X' }).ok).toBe(false)
    expect(validarPagamento(null).ok).toBe(false)
  })
})

describe('validarItens', () => {
  it('aceita os itens e arredonda quantidade (3 casas) e preço (4 casas)', () => {
    const r = validarItens([{ produto_id: 7, quantidade: 1.23456, preco: 2.123456 }])
    expect(r).toEqual({ ok: true, itens: [{ produto_id: '7', quantidade: 1.235, preco: 2.1235, descricao: '' }] })
  })
  it.each([
    ['lista vazia', []],
    ['produto inválido', [{ produto_id: 'x', quantidade: 1, preco: 1 }]],
    ['quantidade zero', [{ produto_id: 1, quantidade: 0, preco: 1 }]],
    ['preço negativo', [{ produto_id: 1, quantidade: 1, preco: -1 }]],
    ['quantidade enorme', [{ produto_id: 1, quantidade: 1e6, preco: 1 }]],
    ['produto repetido', [{ produto_id: 1, quantidade: 1, preco: 1 }, { produto_id: '1', quantidade: 2, preco: 1 }]],
    ['quantidade em texto', [{ produto_id: 1, quantidade: '2', preco: 1 }]],
  ])('recusa %s', (_n, itens) => { expect(validarItens(itens).ok).toBe(false) })
  it('o total é a soma de quantidade × preço, ao centavo; o item sai no formato que o robô do cupom lê', () => {
    const r = validarItens(ITENS)
    if (!r.ok) throw new Error('esperava ok')
    expect(totalDosItens(r.itens)).toBe(1627.25)
    expect(itemDoCupom(r.itens[0])).toEqual({ descricao_cupom: 'TOMATE ITALIANO', sugestao_produto: { id: '1001' }, entrada_estoque: 12.5, quantidade_cupom: 12.5, valor_unitario: 8.9, desconto_item: 0 })
    expect(itemDoCupom(r.itens[1]).descricao_cupom).toBeNull()                       // sem nome enviado: null (a tela cai no nome da lista)
  })
})

describe('tratar', () => {
  it('grava PENDENTE como compra avulsa (sem foto nem chave fiscal) e dispara o robô do cupom', async () => {
    const d = fakeDeps()
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-novo', estado: 'PENDENTE', disparo_ok: true })
    expect(d.disparou).toEqual(['c-novo'])
    expect(d.gravou).toHaveLength(1)
    expect(d.gravou[0]).toMatchObject({
      estado: 'PENDENTE', origem: 'avulsa', teste: false, chave: null, foto_path: `avulsa/${ENVIO}`, emitente_cnpj: '75315333032655', emitente_nome: 'ATACADAO S.A.',
      valor_a_pagar: 1627.25, pagamento: { forma: 'dinheiro', conta: 'DINHEIRO - À Vista' }, motivo: null,
    })
    expect((d.gravou[0].itens as unknown[]).length).toBe(2)
  })
  it('só o administrador ativo envia', async () => {
    for (const u of [null, { papel: 'comprador', ativo: true }, { papel: 'admin', ativo: false }]) {
      const d = fakeDeps({ async buscarUsuario() { return u } })
      expect((await tratar(CORPO, IVAN, d)).status).toBe(403)
      expect(d.gravou).toEqual([])
      expect(d.disparou).toEqual([])
    }
  })
  it.each([
    ['sem identificador do envio', { ...CORPO, envio_id: 'abc' }],
    ['CNPJ curto', { ...CORPO, fornecedor: { cnpj: '123', nome: 'X' } }],
    ['fornecedor sem nome', { ...CORPO, fornecedor: { cnpj: '75315333032655', nome: ' ' } }],
    ['forma inválida', { ...CORPO, pagamento: { forma: 'cartao' } }],
    ['sem itens', { ...CORPO, itens: [] }],
  ])('400 e nada gravado: %s', async (_n, corpo) => {
    const d = fakeDeps()
    expect((await tratar(corpo as never, IVAN, d)).status).toBe(400)
    expect(d.gravou).toEqual([])
    expect(d.disparou).toEqual([])
  })
  it('produto que não está na lista do app: 400 apontando o item', async () => {
    const d = fakeDeps({ async produtosExistentes() { return new Set(['1001']) } })
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(400)
    expect(String(r.corpo.erro)).toMatch(/item 2/)
    expect(d.gravou).toEqual([])
  })
  it('duplo toque (mesmo envio): devolve já recebido e NÃO dispara de novo', async () => {
    const d = fakeDeps({ async inserirCupom() { return { id: 'c-antigo', duplicado: true } } })
    const r = await tratar(CORPO, IVAN, d)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-antigo', duplicado: true })
    expect(d.disparou).toEqual([])
  })
  it('o disparo falhou: a compra fica PENDENTE e a resposta avisa que nada vai lançá-la sozinha', async () => {
    const d = fakeDeps({ async dispararLancamento() { throw new Error('sem GITHUB_PAT') } })
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: false })
    expect(String(r.corpo.resumo)).toMatch(/nada vai lançá-la sozinha/)
  })
})

// ---------- E5: compra repetida (pedido do Ivan, 04/11/2026). Só AVISA: o Ivan decide. O desenho está em E5-DESENHO-v5.md.
const PARECIDA: Parecida = { tipo: 'cupom', id: 'c-lancado', estado: 'LANCADO', quando: '2026-10-03T18:04:00Z', centavos: 162725, pedido: '163377089', numero: null, motivo: null }
const NAO_TOCOU = 'não deve consultar'

describe('tratar — compra repetida (E5)', () => {
  function comParecidas(achadas: Parecida[] | Error, over: Partial<Deps> = {}) {
    const consultas: Impressao[] = []
    const d = fakeDeps({
      async buscarParecidas(imp) { consultas.push(imp); if (achadas instanceof Error) throw achadas; return achadas },
      ...over,
    })
    return Object.assign(d, { consultas })
  }

  it('sem a dependência (como antes do E5) nada muda: grava e dispara', async () => {
    const d = fakeDeps()
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(200)
    expect(d.disparou).toEqual(['c-novo'])
    expect(d.gravou[0]).not.toHaveProperty('outra_compra_ok_em')
  })
  it('achou compra parecida e o Ivan ainda não disse que é outra: 409 com a frase, NADA gravado e NADA disparado; a consulta leva o CNPJ e o total em centavos', async () => {
    const d = comParecidas([PARECIDA])
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(409)
    expect(String(r.corpo.erro)).toBe('POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 1627,25): cupom de 03/10, lançado no SisChef (pedido 163377089).')
    expect(d.gravou).toEqual([])
    expect(d.disparou).toEqual([])
    expect(d.consultas).toEqual([{ cnpj: '75315333032655', centavos: 162725 }])
  })
  it('não achou nada parecido: grava e dispara como sempre, sem marca', async () => {
    const d = comParecidas([])
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(200)
    expect(d.disparou).toEqual(['c-novo'])
    expect(d.gravou[0].outra_compra_ok_em ?? null).toBeNull()
  })
  it('o Ivan disse "é outra compra" (outra_compra: true): grava com a marca (quando e quem), dispara, e nem consulta', async () => {
    const d = comParecidas([PARECIDA])
    const r = await tratar({ ...CORPO, outra_compra: true } as never, '  Ivan@Spazio.com ', d)
    expect(r.status).toBe(200)
    expect(d.disparou).toEqual(['c-novo'])
    expect(d.gravou[0]).toMatchObject({ outra_compra_ok_por: 'ivan@spazio.com' })
    expect(String(d.gravou[0].outra_compra_ok_em)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(d.consultas).toEqual([])
  })
  it.each([['"true" em texto', 'true'], ['o número 1', 1], ['falso', false], ['nulo', null]])('só o booleano true vale como "é outra compra": %s continua 409', async (_n, valor) => {
    const d = comParecidas([PARECIDA])
    const r = await tratar({ ...CORPO, outra_compra: valor } as never, IVAN, d)
    expect(r.status).toBe(409)
    expect(d.gravou).toEqual([])
  })
  it('duplo toque / reenvio depois de a rede cair (o MESMO envio já gravado): "já recebido" ANTES da procura; não acusa a própria compra e não consulta', async () => {
    const d = comParecidas([PARECIDA], { async cupomDoEnvio(foto) { return foto === `avulsa/${ENVIO}` ? { id: 'c-antigo' } : null } })
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-antigo', resumo: 'já recebido', duplicado: true })
    expect(d.consultas).toEqual([])
    expect(d.gravou).toEqual([])
    expect(d.disparou).toEqual([])
  })
  it('a consulta falhou: 503 em texto simples (sem o prefixo, para o app mostrar como erro comum), NADA gravado nem disparado — nunca libera às cegas', async () => {
    const d = comParecidas(new Error('banco fora'))
    const r = await tratar(CORPO, IVAN, d)
    expect(r.status).toBe(503)
    expect(String(r.corpo.erro)).toBe('Não consegui conferir se esta compra é repetida agora. Tente de novo em instantes.')
    expect(String(r.corpo.erro)).not.toContain('POSSÍVEL REPETIDA')
    expect(d.gravou).toEqual([])
    expect(d.disparou).toEqual([])
  })
  it('entrada inválida (400) vem antes de qualquer consulta; só o administrador consulta', async () => {
    const d = comParecidas([PARECIDA], { async buscarParecidas() { throw new Error(NAO_TOCOU) } })
    expect((await tratar({ ...CORPO, itens: [] } as never, IVAN, d)).status).toBe(400)
    const d2 = comParecidas([PARECIDA], { async buscarUsuario() { return null }, async buscarParecidas() { throw new Error(NAO_TOCOU) } })
    expect((await tratar(CORPO, IVAN, d2)).status).toBe(403)
  })
})
