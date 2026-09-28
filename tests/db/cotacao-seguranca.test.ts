import { bancoPorArquivo, como } from './banco'
import { ADMIN, JOAO } from './fixture'
import { semearCotacao, prontaDoFulano, erroDe, marcas, FULANO } from './fixture-cotacao'

// Fase 1B — a matriz de segurança da spec (seção 14): anon não lê tabela nenhuma e só chama as 2 funções da
// página; comprador não lê cot_* e recebe "apenas o administrador" nas funções do admin; ninguém além da
// chave de serviço chama as funções do robô; escrita direta em cot_* é negada até para o admin.
const atual = bancoPorArquivo(semearCotacao)
const banco = async () => atual()

const LEITURA_ADMIN = ['cot_vendedores', 'cot_fornecedores', 'cot_catalogo', 'cot_feriados', 'cot_cotacoes', 'cot_codigos', 'cot_itens',
  'cot_envios', 'cot_pedidos', 'cot_itens_admin', 'cot_resumo', 'cot_economia']
const SO_SERVICO = ['cot_limites', 'cot_avisos', 'cot_cadastros_aplicados']

const DO_ADMIN = [
  'cot_preparar(1)', 'cot_definir_vendedor(101, 1)', `cot_definir_nota(101, 'x')`, 'cot_marcar_item(1, true)', 'cot_congelar(1)',
  'cot_dados_envio(1)', 'cot_descongelar(1)', 'cot_confirmar_envio(1)', 'cot_trocar_codigo(1)',
  `cot_responder_admin(1, gen_random_uuid(), '[]'::jsonb, null, 'ivan_digitou')`, 'cot_nova_versao(1)', 'cot_cancelar(1)',
  'cot_dispensar(1)', `cot_gravar_pedido(1, '[]'::jsonb)`, 'cot_desfazer_pedido(1)', 'cot_liberar_loja(1)', 'cot_voltar_a_cotar(1)',
]
const DO_ROBO = [
  'cot_coleta(null)', `cot_marcar_notificado(1, null, 'h', now())`, 'cot_marcar_cobranca(1)', 'cot_liberar_cobranca(1)',
  `cot_marcar_aviso(1, 1, 'preparar')`, `cot_desmarcar_aviso(1, '{1}'::bigint[], 'preparar')`, 'cot_fechar_vencidas()',
  'cot_reservar_consolidado(1)', `cot_liberar_consolidado('{}'::jsonb)`, `cot_aplicar_cadastros('{}'::jsonb)`,
]

describe('matriz de segurança (spec 14)', () => {
  it('anon: nenhuma tabela ou view cot_*, nenhuma função de admin ou do robô', async () => {
    const db = await banco()
    await prontaDoFulano(db)
    for (const t of [...LEITURA_ADMIN, ...SO_SERVICO]) {
      await expect(como(db, 'anon', `select * from ${t}`), t).rejects.toThrow(/permission denied/)
    }
    for (const f of [...DO_ADMIN, ...DO_ROBO, 'cot_marcas_semana(1)']) {
      await expect(como(db, 'anon', `select ${f}`), f).rejects.toThrow(/permission denied/)
    }
  })

  it('comprador: não lê nada de cot_* (as 3 do robô negadas), recebe "apenas o administrador" e não chama o robô', async () => {
    const db = await banco()
    const { semana } = await prontaDoFulano(db)
    for (const t of LEITURA_ADMIN) expect([t, await como(db, JOAO, `select * from ${t}`)]).toEqual([t, []])
    for (const t of SO_SERVICO) await expect(como(db, JOAO, `select * from ${t}`), t).rejects.toThrow(/permission denied/)
    for (const f of DO_ADMIN) expect([f, await erroDe(como(db, JOAO, `select ${f}`))]).toEqual([f, 'apenas o administrador pode fazer isso'])
    for (const f of DO_ROBO) await expect(como(db, JOAO, `select ${f}`), f).rejects.toThrow(/permission denied/)
    // o que o comprador usa: as etiquetas
    expect(Object.keys(await marcas(db, semana, JOAO)).length).toBeGreaterThan(0)
  })

  it('admin: lê cot_* (o telefone inclusive), mas não as 3 do robô, não grava direto e não chama o robô', async () => {
    const db = await banco()
    await prontaDoFulano(db)
    const [v] = await como(db, ADMIN, 'select whatsapp from cot_vendedores order by id limit 1')
    expect(v.whatsapp).toBe(FULANO.whatsapp)
    expect((await como(db, ADMIN, 'select * from cot_codigos')).length).toBe(1)
    for (const t of SO_SERVICO) await expect(como(db, ADMIN, `select * from ${t}`), t).rejects.toThrow(/permission denied/)
    for (const sql of [
      `insert into cot_vendedores (codigo, nome, empresa, whatsapp) values ('x', 'X', 'X', '5511900000009')`,
      `update cot_itens set preco_digitado = 1`,
      `delete from cot_codigos`,
      `update cot_catalogo set vendedor_id = 2`,
      `insert into cot_limites (balde, janela_inicio) values ('validos', now())`,
      `truncate cot_envios`,
    ]) {
      await expect(como(db, ADMIN, sql), sql).rejects.toThrow(/permission denied/)
    }
    for (const f of DO_ROBO) await expect(como(db, ADMIN, `select ${f}`), f).rejects.toThrow(/permission denied/)
  })

  it('funções security definer com search_path fixo; cot_agora() sem grant e com os atributos da migration', async () => {
    const db = await banco()
    const r = await db.query<{ f: string; secdef: boolean; cfg: string[] | null }>(`
      select p.proname as f, p.prosecdef as secdef, p.proconfig as cfg from pg_proc p
       where p.pronamespace = 'public'::regnamespace and (p.proname like 'cot\\_%' or p.proname like 'cotacao\\_%')`)
    expect(r.rows.length).toBeGreaterThan(40)
    for (const x of r.rows) expect([x.f, x.cfg]).toEqual([x.f, ['search_path=public']])
    const expostas = ['cotacao_abrir', 'cotacao_responder', 'cot_preparar', 'cot_congelar', 'cot_marcas_semana', 'cot_coleta',
      'cot_aplicar_cadastros', 'cot_definir_nota', 'cot_gravar_pedido']
    for (const f of expostas) expect([f, r.rows.find((x) => x.f === f)?.secdef]).toEqual([f, true])
    const [a] = (await db.query<{ vol: string; secdef: boolean }>(
      `select provolatile as vol, prosecdef as secdef from pg_proc where oid = 'public.cot_agora()'::regprocedure`)).rows
    expect(a).toEqual({ vol: 's', secdef: false })
  })
})
