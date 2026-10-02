import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gravarSemDuplicar, type IoGravacao } from './gravacao'

const CHAVE = '12345678901234567890123456789012345678901234'
const LINHA = { estado: 'PENDENTE', foto_path: 'cupom/a.jpg', chave: CHAVE }

/** Banco falso: `inserir` devolve o que o teste mandar; os achados registram o que foi procurado. */
function fakeIo(over: Partial<IoGravacao> = {}): IoGravacao & { porFoto: string[]; porChave: string[]; inseridas: Record<string, unknown>[] } {
  const porFoto: string[] = []
  const porChave: string[] = []
  const inseridas: Record<string, unknown>[] = []
  const base: IoGravacao = {
    async inserir(linha) { inseridas.push(linha); return { id: 'c-novo' } },
    async acharPorFoto(f) { porFoto.push(f); return null },
    async acharPorChave(c) { porChave.push(c); return null },
  }
  return Object.assign(base, over, { porFoto, porChave, inseridas })
}
const UNICO = { erro: { code: '23505', message: 'duplicate key value violates unique constraint' } }

describe('gravarSemDuplicar — insert simples + tratamento do 23505 (correções A e B)', () => {
  it('insert ok ⇒ devolve o id novo, sem procurar nada e sem marcar duplicado', async () => {
    const io = fakeIo()
    const r = await gravarSemDuplicar(LINHA, io)
    expect(r).toEqual({ id: 'c-novo' })
    expect(io.inseridas).toEqual([LINHA])
    expect(io.porFoto).toHaveLength(0); expect(io.porChave).toHaveLength(0)
  })

  it('B: 23505 no foto_path (corrida/reenvio) ⇒ devolve a linha existente por foto_path, duplicado:true', async () => {
    const io = fakeIo({
      async inserir() { return UNICO },
      async acharPorFoto(f) { io.porFoto.push(f); return { id: 'c-da-foto' } },
    })
    const r = await gravarSemDuplicar(LINHA, io)
    expect(r).toEqual({ id: 'c-da-foto', duplicado: true })
    expect(io.porFoto).toEqual(['cupom/a.jpg'])
    expect(io.porChave).toHaveLength(0) // a foto já resolveu
  })

  it('B: 23505 na chave (2ª foto do MESMO cupom, foto_path novo) ⇒ não acha por foto, acha por chave, duplicado:true', async () => {
    const io = fakeIo({
      async inserir() { return UNICO },
      async acharPorFoto(f) { io.porFoto.push(f); return null },
      async acharPorChave(c) { io.porChave.push(c); return { id: 'c-da-chave' } },
    })
    const r = await gravarSemDuplicar(LINHA, io)
    expect(r).toEqual({ id: 'c-da-chave', duplicado: true })
    expect(io.porFoto).toEqual(['cupom/a.jpg'])
    expect(io.porChave).toEqual([CHAVE])
  })

  it('B: foto_path tem prioridade sobre a chave quando os dois já existem', async () => {
    const io = fakeIo({
      async inserir() { return UNICO },
      async acharPorFoto() { return { id: 'c-da-foto' } },
      async acharPorChave() { return { id: 'c-da-chave' } },
    })
    expect((await gravarSemDuplicar(LINHA, io)).id).toBe('c-da-foto')
  })

  it('B: linha sem chave (chave null) ⇒ só procura por foto_path', async () => {
    const io = fakeIo({ async inserir() { return UNICO } })
    await expect(gravarSemDuplicar({ ...LINHA, chave: null }, io)).rejects.toThrow(/duplicad/i)
    expect(io.porFoto).toEqual(['cupom/a.jpg'])
    expect(io.porChave).toHaveLength(0)
  })

  it('23505 mas a linha existente não é achada ⇒ lança (nunca finge sucesso nem devolve um id inventado)', async () => {
    const io = fakeIo({ async inserir() { return UNICO } })
    await expect(gravarSemDuplicar(LINHA, io)).rejects.toThrow(/duplicad/i)
  })

  it('erro que não é 23505 (ex.: 23502 not null, rede) ⇒ lança com a mensagem do banco e não procura duplicata', async () => {
    const io = fakeIo({
      async inserir() { return { erro: { code: '23502', message: 'null value in column "valor_a_pagar" violates not-null constraint' } } },
    })
    await expect(gravarSemDuplicar(LINHA, io)).rejects.toThrow(/valor_a_pagar/)
    expect(io.porFoto).toHaveLength(0); expect(io.porChave).toHaveLength(0)
  })

  it('erro sem código nem mensagem ⇒ lança com texto padrão', async () => {
    const io = fakeIo({ async inserir() { return { erro: { message: '' } } } })
    await expect(gravarSemDuplicar(LINHA, io)).rejects.toThrow(/gravar o cupom/i)
  })

  it('foto_path/chave que não são texto (linha malformada) ⇒ não procura por eles', async () => {
    const io = fakeIo({ async inserir() { return UNICO } })
    await expect(gravarSemDuplicar({ estado: 'PENDENTE', foto_path: 7, chave: '' }, io)).rejects.toThrow(/duplicad/i)
    expect(io.porFoto).toHaveLength(0); expect(io.porChave).toHaveLength(0)
  })
})

describe('index.ts — trava contra a volta do upsert (correção A)', () => {
  // O índice único cupom_foto_path_uniq do Plano 1 é PARCIAL (where foto_path is not null) e o PostgREST gera
  // `on conflict (foto_path)` sem o predicado → 42P10 em toda gravação (conferido em Postgres real). O plano e o brief
  // da Task 8 ainda mostram upsert; esta checagem impede que alguém "conserte" de volta. index.ts usa globais do Deno,
  // então não roda no vitest — olhamos o código (sem as linhas de comentário).
  const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  it('grava com insert simples via gravarSemDuplicar; nunca upsert/onConflict', () => {
    expect(codigo).not.toMatch(/\.upsert\(|onConflict|on_conflict/)
    expect(codigo).toMatch(/\.insert\(/)
    expect(codigo).toMatch(/gravarSemDuplicar\(/)
  })
})
