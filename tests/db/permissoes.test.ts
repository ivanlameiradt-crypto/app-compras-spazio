import { bancoPorArquivo, como } from './banco'
import { semear, importar, idSemana, ADMIN, JOAO, PAYLOAD } from './fixture'

// Fase 1A (20260928000001) e 1B (20261001000001): o shim imita os privilégios padrão do Supabase (tudo
// liberado para anon, authenticated e service_role em objeto novo de public); as migrations revogam a
// escrita direta e reaplicam a lista completa de funções. Estes testes quebram se um revoke for esquecido.
// Desde a 1B (contrato 2.3, D27): anon executa só as 2 funções da página do vendedor, e authenticated não lê
// as 3 tabelas que só a chave de serviço usa.
// Fase 2 E1 (§8.6): +2 funções de admin para authenticated (cot_painel_economia, cot_historico_item); a view
// cot_economia_linhas e a tabela cot_categorias entram na leitura do admin (SO_SERVICO segue com 3).
// Fase 2 B (§8.6): +5 funções de admin (cot_ia_iniciar/concluir/gravada/status/ligar); a tabela cot_leituras_ia e a
// view cot_ia_uso entram na leitura do admin; cot_ia_config só a chave de serviço lê.
// Fase 2 D (§8.6): +10 funções de admin/ativo (recebimento, NF-e, desempenho, CNPJ); +3 do robô para anon (só com o
// segredo); 5 tabelas + a view cot_conferencia entram na leitura do admin; a view cot_desempenho só a chave de serviço
// lê (SO_SERVICO passa a 5). A lista completa é reaplicada pela última migration por nome de arquivo.
const atual = bancoPorArquivo(semear)
const banco = async () => atual()

const ESCRITA = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
/** MAINTAIN (Postgres 17+: VACUUM, ANALYZE, LOCK...) vem no 'grant all' padrão; o pglite é 18, então ele é checado. */
const ALEM_DA_LEITURA = [...ESCRITA, 'MAINTAIN']

/** Funções que o App (usuário logado) chama; todo o resto fica sem grant para authenticated (72 depois da C2:
 * 37 da 1B + 2 E1 + 10 D + 5 B + 14 C1 + 4 C2). */
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
  // Fase 1B: aba Cotações (admin), etiquetas (usuário ativo) e a prévia do vendedor
  'cot_cancelar(bigint)',
  'cot_confirmar_envio(bigint)',
  'cot_congelar(bigint)',
  'cot_dados_envio(bigint)',
  'cot_definir_nota(bigint,text)',
  'cot_definir_vendedor(bigint,bigint)',
  'cot_descongelar(bigint)',
  'cot_desfazer_pedido(bigint)',
  'cot_dispensar(bigint)',
  'cot_gravar_pedido(bigint,jsonb)',
  'cot_liberar_loja(bigint)',
  'cot_marcar_item(bigint,boolean)',
  'cot_marcas_semana(bigint)',
  'cot_nova_versao(bigint)',
  'cot_preparar(bigint)',
  'cot_responder_admin(bigint,uuid,jsonb,jsonb,text)',
  'cot_trocar_codigo(bigint)',
  'cot_voltar_a_cotar(bigint)',
  'cotacao_abrir(text,boolean)',
  'cotacao_responder(text,uuid,jsonb,jsonb)',
  // Fase 2 E1: painel de economia (admin)
  'cot_painel_economia(date,date)',
  'cot_historico_item(bigint,date,date)',
  // Fase 2 B: leitura com IA (admin)
  'cot_ia_iniciar(bigint,integer,integer,boolean)',
  'cot_ia_concluir(bigint,jsonb)',
  'cot_ia_gravada(bigint,uuid,jsonb)',
  'cot_ia_status()',
  'cot_ia_ligar(boolean)',
  // Fase 2 D: recebimento e NF-e (admin/ativo)
  'cot_pedidos_a_receber()',
  'cot_registrar_recebimento(bigint,uuid,timestampwithtimezone,jsonb,text,text)',
  'cot_desfazer_recebimento(bigint)',
  'cot_definir_entrega(bigint,date)',
  'cot_marcar_entrada(bigint,boolean)',
  'cot_nfe_vincular(text,bigint)',
  'cot_nfe_desvincular(text)',
  'cot_desempenho_vendedores()',
  'cot_cnpj_mover(text,bigint)',
  'cot_cnpj_remover(text)',
  // Fase 2 C1: cadastros no App (admin)
  'cot_vendedor_salvar(jsonb)',
  'cot_vendedor_excluir(bigint)',
  'cot_grafia_salvar(text,bigint)',
  'cot_grafia_remover(text)',
  'cot_feriado_salvar(date,text)',
  'cot_feriado_remover(date)',
  'cot_definir_nome(bigint,text)',
  'cot_definir_litro(bigint,boolean)',
  'cot_confirmar_kg_por_litro(bigint,numeric)',
  'cot_confirmar_fator(bigint,bigint,text,numeric,text,text)',
  'cot_tirar_fator(bigint)',
  'cot_catalogo_soltar_vendedor(bigint)',
  'cot_produtos_cadastro()',
  'cot_fornecedores_sem_vendedor(integer)',
  // Fase 2 C2: regras da lista e fatores a confirmar (admin)
  'lista_regra_salvar(bigint,text,text)',
  'lista_regra_remover(bigint)',
  'cot_fatores_a_confirmar()',
  'cot_descartar_fator(bigint,bigint,numeric)',
]

/** A página do vendedor (chave anônima): estas duas + as 3 do robô de NF-e (só com o segredo, Fase 2 D). */
const DA_PAGINA = ['cotacao_abrir(text,boolean)', 'cotacao_responder(text,uuid,jsonb,jsonb)']
const DO_ROBO_NFE = ['cot_nfe_sincronizar(text,jsonb)', 'cot_nfe_marcar_notificado(text,text,text,text)', 'cot_nfe_marcar_lancadas(text,jsonb)']
const ANON = [...DA_PAGINA, ...DO_ROBO_NFE]

/** Chamadas pelo robô com a chave de serviço (grant explícito). */
const DO_ROBO = [
  'importar_semana(jsonb)',
  'cot_coleta(bigint)',
  'cot_marcar_notificado(bigint,text,text,timestampwithtimezone)', // sem espaços, como funcoesQue devolve
  'cot_marcar_cobranca(bigint)',
  'cot_liberar_cobranca(bigint)',
  'cot_marcar_aviso(bigint,bigint,text)',
  'cot_desmarcar_aviso(bigint,bigint[],text)',
  'cot_fechar_vencidas()',
  'cot_reservar_consolidado(bigint)',
  'cot_liberar_consolidado(jsonb)',
  // Fase 2 C1: a virada tira o cot_aplicar_cadastros do service_role e põe o cot_exportar_cadastros (backup semanal).
  'cot_exportar_cadastros()',
]

/** Só a chave de serviço lê (sem SELECT para authenticated, D27). Fase 2 D acrescenta a view cot_desempenho. */
const SO_SERVICO = ['cot_avisos', 'cot_cadastros_aplicados', 'cot_desempenho', 'cot_ia_config', 'cot_limites']

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
    const ts = await tabelas(db)
    expect(ts).toEqual(expect.arrayContaining([
      'cot_itens_admin', 'cot_resumo', 'cot_economia', 'cot_economia_linhas', 'cot_categorias',
      'cot_leituras_ia', 'cot_ia_uso', ...SO_SERVICO,
    ]))
    for (const t of ts) {
      const [sel] = (await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', $1, 'SELECT') as ok`, [`public.${t}`])).rows
      expect([t, sel.ok]).toEqual([t, !SO_SERVICO.includes(t)])
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
  it('anon executa as 2 da página do vendedor + as 3 do robô de NF-e (Fase 2 D)', async () => {
    const db = await banco()
    expect(await funcoesQue(db, 'anon')).toEqual([...ANON].sort())
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

  it('service_role executa importar_semana e as 10 do robô da cotação', async () => {
    const db = await banco()
    expect(DO_ROBO).toHaveLength(11)
    const tem = await funcoesQue(db, 'service_role')
    expect(tem).toEqual(expect.arrayContaining(DO_ROBO))
    expect((await importar(db)).resultado).toBe('criada')
  })

  it('as do robô ficam sem grant para anon e authenticated', async () => {
    const db = await banco()
    for (const papel of ['anon', 'authenticated']) {
      const tem = await funcoesQue(db, papel)
      for (const f of DO_ROBO) expect([papel, f, tem.includes(f)]).toEqual([papel, f, false])
    }
  })

  it('funções internas ficam sem grant para anon e authenticated', async () => {
    const db = await banco()
    for (const f of ['exigir_admin()', 'exigir_ativo()', 'minha_compra_aberta(uuid)', 'importar_semana(jsonb)',
      'cot_agora()', 'cot_mapa(bigint)', 'cot_sincronizar(bigint,bigint)', 'cot_aplicar_resposta(bigint,jsonb,text)',
      'cot_gerar_codigo()', 'cot_contar_limite(text,integer)', 'cot_estado_efetivo(bigint)']) {
      for (const papel of ['anon', 'authenticated']) {
        const [r] = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [papel, `public.${f}`])).rows
        expect([f, papel, r.ok]).toEqual([f, papel, false])
      }
    }
  })

  it('E1: cot_m_json é interna — nem anon/authenticated nem service_role a executam (§2.2 regra 6a)', async () => {
    const db = await banco()
    const f = 'public.cot_m_json(bigint,bigint,bigint,bigint,numeric,numeric)'
    for (const papel of ['anon', 'authenticated', 'service_role']) {
      const [r] = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [papel, f])).rows
      expect([papel, r.ok]).toEqual([papel, false])
    }
  })
})
