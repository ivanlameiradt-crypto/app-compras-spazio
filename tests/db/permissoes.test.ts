import { bancoPorArquivo, como } from './banco'
import { semear, importar, idSemana, ADMIN, JOAO, PAYLOAD } from './fixture'

// Fase 1A (20260928000001): o shim imita os privilégios padrão do Supabase (tudo liberado para anon,
// authenticated e service_role em objeto novo de public); a migration revoga a escrita direta e
// reaplica a lista completa de funções. Estes testes quebram se um revoke for esquecido.
const atual = bancoPorArquivo(semear)
const banco = async () => atual()

const ESCRITA = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
/** MAINTAIN (Postgres 17+: VACUUM, ANALYZE, LOCK...) vem no 'grant all' padrão; o pglite é 18, então ele é checado. */
const ALEM_DA_LEITURA = [...ESCRITA, 'MAINTAIN']

/** Funções que o App (usuário logado) chama; todo o resto fica sem grant para authenticated. */
const DO_APP = [
  'abrir_compra(uuid,bigint,text)',
  'admin_fechar_compra(uuid,boolean,numeric)',
  'ajustar_item(bigint,numeric,boolean)',
  'aprovar_compra(uuid)',
  'aprovar_semana(bigint)',
  'cancelar_compra(uuid)',
  'corrigir_compra(uuid,boolean,numeric)',
  'corrigir_item_compra(uuid,numeric,numeric)',
  'desmarcar_item(uuid,bigint)',
  'eh_admin()',
  'eh_ativo()',
  'email_atual()',
  'encerrar_semana(bigint)',
  'fechar_compra(uuid,boolean,numeric,text)',
  'marcar_lancada(uuid)',
  'nomes_equipe()',
  'registrar_item(uuid,uuid,bigint,numeric,numeric,text)',
]

async function tabelas(db: Awaited<ReturnType<typeof banco>>): Promise<string[]> {
  const r = await db.query<{ t: string }>(
    `select c.relname as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') order by 1`,
  )
  return r.rows.map((x) => x.t)
}

async function funcoesQue(db: Awaited<ReturnType<typeof banco>>, papel: string): Promise<string[]> {
  const r = await db.query<{ f: string }>(
    `select regexp_replace(p.oid::regprocedure::text, '\\s', '', 'g') as f
       from pg_proc p
      where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute')`,
    [papel],
  )
  return r.rows.map((x) => x.f.replace(/^public\./, '')).sort()
}

describe('shim imita os privilégios padrão do Supabase', () => {
  it('tabela, sequência e função novas de public nascem liberadas para anon e authenticated', async () => {
    const db = await banco()
    await db.exec(`
      create table public.tmp_padrao (id bigint generated always as identity primary key);
      create function public.tmp_padrao_f() returns int language sql as 'select 1';
    `)
    try {
      const [r] = (await db.query<Record<string, boolean>>(`
        select has_table_privilege('anon', 'public.tmp_padrao', 'insert') as anon_insere,
               has_table_privilege('authenticated', 'public.tmp_padrao', 'delete') as auth_apaga,
               has_sequence_privilege('authenticated', pg_get_serial_sequence('public.tmp_padrao', 'id'), 'usage') as auth_seq,
               has_function_privilege('anon', 'public.tmp_padrao_f()', 'execute') as anon_executa,
               has_table_privilege('authenticated', 'public.tmp_padrao', 'maintain') as auth_maintain
      `)).rows
      expect(r).toEqual({ anon_insere: true, auth_apaga: true, auth_seq: true, anon_executa: true, auth_maintain: true })
    } finally {
      await db.exec('drop function public.tmp_padrao_f(); drop table public.tmp_padrao;')
    }
  })
})

describe('tabelas: leitura pela RLS, escrita só pelas funções', () => {
  it('o banco de teste é Postgres 17+: o MAINTAIN existe e é mesmo checado abaixo', async () => {
    const db = await banco()
    const [r] = (await db.query<{ v: number }>(`select current_setting('server_version_num')::int as v`)).rows
    expect(r.v).toBeGreaterThanOrEqual(170000)
  })

  it('anon não tem privilégio nenhum em tabela de public', async () => {
    const db = await banco()
    const ts = await tabelas(db)
    expect(ts).toEqual(expect.arrayContaining(['usuarios', 'semanas', 'itens_semana', 'compras', 'compras_itens', 'historico_alteracoes']))
    for (const t of ts) {
      for (const priv of ['SELECT', ...ALEM_DA_LEITURA]) {
        const [r] = (await db.query<{ ok: boolean }>(`select has_table_privilege('anon', $1, $2) as ok`, [`public.${t}`, priv])).rows
        expect([t, priv, r.ok]).toEqual([t, priv, false])
      }
    }
  })

  it('authenticated só lê (sem MAINTAIN); a única escrita direta é insert/update em usuarios (tela Pessoas)', async () => {
    const db = await banco()
    for (const t of await tabelas(db)) {
      const [sel] = (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', $1, 'SELECT') as ok`, [`public.${t}`])).rows
      expect([t, sel.ok]).toEqual([t, true])
      for (const priv of ALEM_DA_LEITURA) {
        const esperado = t === 'usuarios' && (priv === 'INSERT' || priv === 'UPDATE')
        const [r] = (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', $1, $2) as ok`, [`public.${t}`, priv])).rows
        expect([t, priv, r.ok]).toEqual([t, priv, esperado])
      }
    }
  })

  it('anon e authenticated não usam sequência nenhuma de public', async () => {
    const db = await banco()
    const r = await db.query<{ s: string; papel: string }>(`
      select c.relname as s, p.papel
        from pg_class c cross join (values ('anon'), ('authenticated')) as p(papel)
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
         and (has_sequence_privilege(p.papel, c.oid, 'usage') or has_sequence_privilege(p.papel, c.oid, 'select')
              or has_sequence_privilege(p.papel, c.oid, 'update'))`)
    expect(r.rows).toEqual([])
  })

  it('comprador e admin não gravam direto nas tabelas (permission denied, não só RLS)', async () => {
    const db = await banco()
    await importar(db)
    await como(db, ADMIN, 'select aprovar_semana($1)', [await idSemana(db)])
    const comandos = [
      `update itens_semana set qtd_aprovada = 999`,
      `delete from itens_semana`,
      `insert into semanas (data_referencia) values ('2026-10-05')`,
      `update semanas set status = 'encerrada'`,
      `insert into compras (id, semana_id, loja, comprador) select '00000000-0000-0000-0000-00000000000a', id, 'X', '${JOAO}' from semanas`,
      `delete from compras_itens`,
      `insert into historico_alteracoes (quem, tabela, registro) values ('x', 'y', 'z')`,
      `truncate itens_semana`,
      `lock table compras in access exclusive mode`,
      `delete from usuarios where email = '${JOAO}'`,
    ]
    for (const quem of [JOAO, ADMIN]) {
      for (const sql of comandos) {
        await expect(como(db, quem, sql), `${quem}: ${sql}`).rejects.toThrow(/permission denied/)
      }
    }
    expect(await como(db, ADMIN, 'select * from itens_semana')).toHaveLength(PAYLOAD.itens.length)
  })

  it('RLS continua valendo em usuarios: comprador não cadastra, admin cadastra e altera', async () => {
    const db = await banco()
    await expect(
      como(db, JOAO, `insert into usuarios (email, nome, papel) values ('x@y.com', 'X', 'admin')`),
    ).rejects.toThrow(/row-level security/)
    await como(db, ADMIN, `insert into usuarios (email, nome, papel) values ('nova@spazio.com', 'Nova', 'comprador')`)
    await como(db, ADMIN, `update usuarios set ativo = false where email = 'nova@spazio.com'`)
    const [u] = await como(db, ADMIN, `select ativo from usuarios where email = 'nova@spazio.com'`)
    expect(u.ativo).toBe(false)
  })
})

describe('funções: lista completa de grants', () => {
  it('anon não executa função nenhuma de public', async () => {
    const db = await banco()
    expect(await funcoesQue(db, 'anon')).toEqual([])
    await expect(como(db, 'anon', 'select eh_admin()')).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', `select importar_semana($1::jsonb)`, [JSON.stringify(PAYLOAD)])).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', `select admin_fechar_compra(gen_random_uuid(), true, 1)`)).rejects.toThrow(/permission denied/)
  })

  it('authenticated executa exatamente as funções do App (sem as internas e sem importar_semana)', async () => {
    const db = await banco()
    expect(await funcoesQue(db, 'authenticated')).toEqual([...DO_APP].sort())
  })

  it('authenticated (comprador ou admin) não executa importar_semana', async () => {
    const db = await banco()
    for (const quem of [JOAO, ADMIN]) {
      await expect(como(db, quem, `select importar_semana($1::jsonb)`, [JSON.stringify(PAYLOAD)])).rejects.toThrow(/permission denied/)
    }
    expect(await como(db, ADMIN, 'select * from semanas')).toHaveLength(0)
  })

  it('service_role executa importar_semana', async () => {
    const db = await banco()
    const [r] = (await db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.importar_semana(jsonb)', 'execute') as ok`)).rows
    expect(r.ok).toBe(true)
    expect((await importar(db)).resultado).toBe('criada')
  })

  it('funções internas ficam sem grant para anon e authenticated', async () => {
    const db = await banco()
    for (const f of ['exigir_admin()', 'exigir_ativo()', 'minha_compra_aberta(uuid)', 'importar_semana(jsonb)']) {
      for (const papel of ['anon', 'authenticated']) {
        const [r] = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [papel, `public.${f}`])).rows
        expect([f, papel, r.ok]).toEqual([f, papel, false])
      }
    }
  })
})
