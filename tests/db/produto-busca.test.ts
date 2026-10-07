import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { bancoPorArquivo, como } from './banco'
import { semear, ADMIN, JOAO } from './fixture'

// Fase 3 (20261211000001_produto_busca): palavras-chave e nome corrigido dos produtos, que a caixa de associação da aba "Lançamento fiscal"
// usa para achar e sugerir o produto. Só o admin lê; ninguém grava pelo app (a carga é do servidor, com a chave de serviço).
const atual = bancoPorArquivo(semear)
const banco = async () => atual()

const linhas = (db: Awaited<ReturnType<typeof banco>>, quem: string) =>
  como(db, quem, 'select produto_id::int as produto_id, palavras, nome_corrigido from cot_produto_busca order by produto_id')

describe('cot_produto_busca (palavras-chave e nome corrigido)', () => {
  it('a carga (chave de serviço) grava e atualiza por produto; o admin lê tudo', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras, nome_corrigido) values
      (3469626, 'leite semi condensado ou leite condensado', 'LEITE CONDENSADO - INSUMOS (KG)'),
      (1854713, 'queijo mussarela', null),
      (3138796, null, 'FARINHA DE SÊMOLA - INSUMOS (KG)')`)
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras) values (1854713, 'queijo mussarela OU queijo muss')
      on conflict (produto_id) do update set palavras = excluded.palavras, atualizado_em = now()`)
    expect(await linhas(db, ADMIN)).toEqual([
      { produto_id: 1854713, palavras: 'queijo mussarela OU queijo muss', nome_corrigido: null },
      { produto_id: 3138796, palavras: null, nome_corrigido: 'FARINHA DE SÊMOLA - INSUMOS (KG)' },
      { produto_id: 3469626, palavras: 'leite semi condensado ou leite condensado', nome_corrigido: 'LEITE CONDENSADO - INSUMOS (KG)' },
    ])
  })

  it('quem não é admin não lê (RLS: zero linhas) e anon nem chega à tabela (permission denied)', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras) values (1854713, 'queijo mussarela')`)
    expect(await linhas(db, JOAO)).toEqual([])
    await expect(como(db, 'anon', 'select * from cot_produto_busca')).rejects.toThrow(/permission denied/)
  })

  it('ninguém grava pelo app: admin e comprador levam permission denied em insert, update, delete e truncate', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras) values (1854713, 'queijo mussarela')`)
    const comandos = [
      `insert into cot_produto_busca (produto_id, palavras) values (1, 'x')`,
      `update cot_produto_busca set palavras = 'outra'`,
      `delete from cot_produto_busca`,
      `truncate cot_produto_busca`,
    ]
    for (const quem of [ADMIN, JOAO, 'anon']) {
      for (const sql of comandos) {
        await expect(como(db, quem, sql), `${quem}: ${sql}`).rejects.toThrow(/permission denied/)
      }
    }
    expect(await linhas(db, ADMIN)).toEqual([{ produto_id: 1854713, palavras: 'queijo mussarela', nome_corrigido: null }])
  })

  it('linha sem nada para dizer não existe, e os textos têm limite', async () => {
    const db = await banco()
    const gravar = (valores: string) => como(db, 'service', `insert into cot_produto_busca (produto_id, palavras, nome_corrigido) values (${valores})`)
    await expect(gravar(`1, null, null`)).rejects.toThrow(/check constraint/)
    await expect(gravar(`1, '   ', ''`)).rejects.toThrow(/check constraint/)
    await expect(gravar(`1, '${'a'.repeat(501)}', null`)).rejects.toThrow(/check constraint/)
    await expect(gravar(`1, null, '${'a'.repeat(201)}'`)).rejects.toThrow(/check constraint/)
    await gravar(`1, '${'a'.repeat(500)}', '${'b'.repeat(200)}'`)                 // no limite pode
    await gravar(`2, null, 'só o nome corrigido'`)
    expect((await linhas(db, ADMIN)).map((l) => l.produto_id)).toEqual([1, 2])
  })
})

const lembrar = async (db: Awaited<ReturnType<typeof banco>>, quem: string, produto: number | null, texto: string | null) =>
  (await como(db, quem, 'select cot_produto_lembrar($1, $2) as r', [produto, texto]))[0].r as boolean

describe('cot_produto_lembrar (a descrição confirmada vira palavra-chave do produto)', () => {
  it('cria a linha na 1ª vez (sem o "CÓD. FOR" e com espaço simples), acrescenta com " OU " e não repete', async () => {
    const db = await banco()
    expect(await lembrar(db, ADMIN, 1854713, 'CÓD. FOR: 221430   QUEIJO MUSS ARGE  LA PAULINA BARR KG')).toBe(true)
    expect(await linhas(db, ADMIN)).toEqual([{ produto_id: 1854713, palavras: 'QUEIJO MUSS ARGE LA PAULINA BARR KG', nome_corrigido: null }])
    expect(await lembrar(db, ADMIN, 1854713, 'Queijo mussarela fatiado')).toBe(true)
    expect((await linhas(db, ADMIN))[0].palavras).toBe('QUEIJO MUSS ARGE LA PAULINA BARR KG OU Queijo mussarela fatiado')
    expect(await lembrar(db, ADMIN, 1854713, 'queijo muss arge la paulina barr kg')).toBe(false)     // já estava (sem ligar para maiúscula)
    expect((await linhas(db, ADMIN))[0].palavras).toBe('QUEIJO MUSS ARGE LA PAULINA BARR KG OU Queijo mussarela fatiado')
  })

  it('não mexe no nome corrigido que já existia e deixa o antes/depois no histórico', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras, nome_corrigido) values (3469626, 'leite condensado', 'LEITE CONDENSADO - INSUMOS (KG)')`)
    expect(await lembrar(db, ADMIN, 3469626, 'LEITE COND TIROL SEMIDES TP 395G')).toBe(true)
    expect(await linhas(db, ADMIN)).toEqual([{ produto_id: 3469626, palavras: 'leite condensado OU LEITE COND TIROL SEMIDES TP 395G',
      nome_corrigido: 'LEITE CONDENSADO - INSUMOS (KG)' }])
    const [h] = await como(db, ADMIN, `select quem, antes, depois from historico_alteracoes where tabela = 'cot_produto_busca' and registro = '3469626'`)
    expect(h.quem).toBe(ADMIN)
    expect(h.antes).toEqual({ palavras: 'leite condensado' })
    expect(h.depois).toMatchObject({ palavras: 'leite condensado OU LEITE COND TIROL SEMIDES TP 395G' })
  })

  it('não cabendo nos 500 caracteres, devolve false e deixa as palavras como estão', async () => {
    const db = await banco()
    const quase = 'a'.repeat(480)
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras) values (1, '${quase}')`)
    expect(await lembrar(db, ADMIN, 1, 'LEITE COND TIROL SEMIDES TP 395G')).toBe(false)
    expect((await linhas(db, ADMIN))[0].palavras).toBe(quase)
  })

  it('só o admin: comprador e anon não executam; texto vazio, texto grande e produto inválido são recusados', async () => {
    const db = await banco()
    await expect(lembrar(db, JOAO, 1854713, 'queijo')).rejects.toThrow(/administrador/i)
    await expect(como(db, 'anon', 'select cot_produto_lembrar(1854713, $1)', ['queijo'])).rejects.toThrow(/permission denied/)
    await expect(lembrar(db, ADMIN, 1854713, '   ')).rejects.toThrow(/texto vazio/)
    await expect(lembrar(db, ADMIN, 1854713, 'CÓD. FOR: 123')).rejects.toThrow(/texto vazio/)          // sobrou só o prefixo
    await expect(lembrar(db, ADMIN, 1854713, null)).rejects.toThrow(/texto vazio/)
    await expect(lembrar(db, ADMIN, 1854713, 'x'.repeat(151))).rejects.toThrow(/texto grande demais/)
    await expect(lembrar(db, ADMIN, 0, 'queijo')).rejects.toThrow(/produto inválido/)
    await expect(lembrar(db, ADMIN, null, 'queijo')).rejects.toThrow(/produto inválido/)
    expect(await linhas(db, ADMIN)).toEqual([])
  })
})

describe('supabase/dados/produto_busca_2026-10-06.sql (a carga da planilha do Ivan)', () => {
  const ARQUIVO = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/dados/produto_busca_2026-10-06.sql')

  it('é SQL válido para a tabela: 230 produtos (227 com palavras, 35 com nome corrigido) + 2 escondidos, sem repetir produto, e rodar de novo não quebra', async () => {
    const db = await banco()
    const sql = readFileSync(ARQUIVO, 'utf8')
    await db.exec(sql)
    const [c] = await como(db, ADMIN, `select count(*)::int as total, count(palavras)::int as com_palavras, count(nome_corrigido)::int as com_nome, count(*) filter (where ocultar)::int as ocultos from cot_produto_busca`)
    expect(c).toEqual({ total: 232, com_palavras: 227, com_nome: 35, ocultos: 2 })              // 230 da planilha + as 2 maioneses (só escondem)
    await db.exec(sql)                                                                       // a carga é idempotente (on conflict)
    expect((await como(db, ADMIN, `select count(*)::int as total from cot_produto_busca`))[0].total).toBe(232)
  })

  it('os dois ajustes avisados ao Ivan estão lá, e o resto está como ele escreveu (com " OU" e vírgula de número)', async () => {
    const db = await banco()
    await db.exec(readFileSync(ARQUIVO, 'utf8'))
    const por = async (id: number) => (await como(db, ADMIN, 'select palavras, nome_corrigido from cot_produto_busca where produto_id = $1', [id]))[0]
    expect(await por(3138796)).toEqual({ palavras: 'FARINHA SEMOLA OU SÊMOLA', nome_corrigido: 'FARINHA DE SÊMOLA - INSUMOS (KG)' })
    expect((await por(1854713)).palavras).toBe('queijo mussarela mozarela mozzarella OU queijo muss')
    expect(await por(3469754)).toEqual({ palavras: 'nuggets ou Chicken Supreme 2,5Kg', nome_corrigido: 'NUGGETS SUPREME - INSUMOS (KG)' })
    expect(await por(3484974)).toEqual({ palavras: 'LIMÃO SICILIANO', nome_corrigido: null })  // o do cupom do ATACADAO: continua um produto à parte
    expect((await por(3469643)).palavras).toBe('LIMÃO OU LIMÃO TAHITI OU LIMÃO TAITI')         // "o limão Tahiti é o mesmo limão" (Ivan)
    expect(await por(3469590)).toEqual({ palavras: 'CARNE LAGARTO OU CARNE RESFRIADA LARGATO', nome_corrigido: null })
    const escondidos = await como(db, ADMIN, 'select produto_id::int as produto_id, palavras, nome_corrigido from cot_produto_busca where ocultar order by produto_id')
    expect(escondidos).toEqual([{ produto_id: 3661381, palavras: null, nome_corrigido: null }, { produto_id: 3661383, palavras: null, nome_corrigido: null }])   // as maioneses
  })
})

describe('cot_produto_busca.ocultar (produto de receita some da caixa de associação)', () => {
  it('a linha pode existir só para esconder o produto; sem esconder, continua precisando dizer alguma coisa; o padrão é não esconder', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, ocultar) values (3661383, true)`)
    await como(db, 'service', `insert into cot_produto_busca (produto_id, palavras) values (1854713, 'queijo mussarela')`)
    expect(await como(db, ADMIN, 'select produto_id::int as produto_id, ocultar from cot_produto_busca order by produto_id'))
      .toEqual([{ produto_id: 1854713, ocultar: false }, { produto_id: 3661383, ocultar: true }])
    await expect(como(db, 'service', `insert into cot_produto_busca (produto_id, ocultar) values (1, false)`)).rejects.toThrow(/check constraint/)
    await expect(como(db, 'service', `update cot_produto_busca set ocultar = false where produto_id = 3661383`)).rejects.toThrow(/check constraint/)   // voltaria a ser linha vazia
    await como(db, 'service', `update cot_produto_busca set ocultar = false, palavras = 'maionese' where produto_id = 3661383`)                        // desfazer: dizendo algo
    expect((await como(db, ADMIN, 'select ocultar from cot_produto_busca where produto_id = 3661383'))[0].ocultar).toBe(false)
  })

  it('"Lembrar esta descrição" num produto escondido acrescenta as palavras e não desfaz o esconder', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, ocultar) values (3661383, true)`)
    expect(await lembrar(db, ADMIN, 3661383, 'MAIONESE CASEIRA 1KG')).toBe(true)
    expect(await como(db, ADMIN, 'select palavras, ocultar from cot_produto_busca where produto_id = 3661383')).toEqual([{ palavras: 'MAIONESE CASEIRA 1KG', ocultar: true }])
  })

  it('só o admin lê a coluna nova; ninguém grava pelo app', async () => {
    const db = await banco()
    await como(db, 'service', `insert into cot_produto_busca (produto_id, ocultar) values (3661383, true)`)
    expect(await como(db, JOAO, 'select ocultar from cot_produto_busca')).toEqual([])
    await expect(como(db, ADMIN, `update cot_produto_busca set ocultar = false`)).rejects.toThrow(/permission denied/)
  })
})
