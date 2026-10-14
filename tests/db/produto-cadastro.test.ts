import type { PGlite } from '@electric-sql/pglite'
import { bancoRecebimento, chamar, SEGREDO } from './fixture-recebimento'
import { como } from './banco'
import { ADMIN, JOAO } from './fixture'
import { erroDe } from './fixture-cotacao'

// Cadastro de PRODUTO novo pelo app (pedido do Ivan, 13/10/2026): produto_cadastro (pedidos) e produto_cadastro_concluir (a gravação final, atômica e idempotente).
const atual = bancoRecebimento(null)
const banco = async (): Promise<PGlite> => atual()
// produto_planilha não está no limpar() compartilhado: aqui cada teste começa com a planilha vazia (sem herdar a linha de outro teste)
beforeEach(async () => { await atual().exec('truncate produto_planilha') })
const NOME = 'MAIONESE HELLMANNS 3KG - INSUMOS'
const CHAVE = 'maionese hellmanns 3kg insumos'

const pedir = async (db: PGlite, over: Record<string, string> = {}): Promise<string> => {
  const c = { descricao: `'${NOME}'`, chave_nome: `'${CHAVE}'`, grupo: `'ESTOQUE CONTROLADO'`, unidade: `'KG'`, origem: `'cupom'`, ...over }
  const r = await db.query<{ id: string }>(`insert into produto_cadastro (${Object.keys(c).join(', ')}) values (${Object.values(c).join(', ')}) returning id`)
  return r.rows[0].id
}
const concluir = async (db: PGlite, id: string, estado: string, extra = ''): Promise<string> => {
  const r = await como(db, 'service', `select produto_cadastro_concluir('${id}'::uuid, '${estado}'${extra}) as e`)
  return (r[0] as { e: string }).e
}

describe('produto_cadastro', () => {
  it('só o admin lê; o comprador não vê nada; ninguém escreve direto pelo app', async () => {
    const db = await banco()
    await pedir(db)
    expect(await como(db, ADMIN, 'select estado from produto_cadastro')).toEqual([{ estado: 'PENDENTE' }])
    expect(await como(db, JOAO, 'select 1 from produto_cadastro')).toEqual([])
    await expect(como(db, ADMIN, `insert into produto_cadastro (descricao, chave_nome, grupo, unidade, origem) values ('X', 'x', 'G', 'KG', 'cupom')`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `update produto_cadastro set estado = 'CADASTRADO'`)).rejects.toThrow(/permission denied/)
    await expect(como(db, ADMIN, `select produto_cadastro_concluir(gen_random_uuid(), 'REVISAR')`)).rejects.toThrow(/permission denied/)   // a gravação final é do robô (service_role)
  })

  it('no máximo um pedido em andamento por nome; depois de concluído ou revisado pode pedir de novo', async () => {
    const db = await banco()
    await pedir(db)
    await expect(pedir(db)).rejects.toThrow(/produto_cadastro_em_andamento|duplicate key/)
    await db.exec(`update produto_cadastro set estado = 'PROCESSANDO'`)
    await expect(pedir(db)).rejects.toThrow(/duplicate key/)
    await db.exec(`update produto_cadastro set estado = 'REVISAR', motivo = 'grupo não encontrado'`)
    await pedir(db)
    expect(await como(db, ADMIN, 'select 1 from produto_cadastro')).toHaveLength(2)
  })

  it('só aceita unidade KG ou UN (as da planilha do app), estado conhecido e nunca "pronto" sem o código do produto', async () => {
    const db = await banco()
    await expect(pedir(db, { unidade: `'PCT'` })).rejects.toThrow()
    await expect(pedir(db, { unidade: `'kg'` })).rejects.toThrow()
    await expect(pedir(db, { origem: `'outra'` })).rejects.toThrow()
    await expect(pedir(db, { descricao: `'   '` })).rejects.toThrow()
    await expect(pedir(db, { estado: `'OUTRO'` })).rejects.toThrow()
    await expect(pedir(db, { estado: `'CADASTRADO'` })).rejects.toThrow(/produto_cadastro_pronto_com_id/)
  })
})

describe('produto_cadastro_concluir', () => {
  it('CADASTRADO: o produto entra na planilha (a lista do app) com a unidade e as palavras-chave são mescladas, tudo junto com o estado', async () => {
    const db = await banco()
    const id = await pedir(db, { palavras: `'maion hellmanns'` })
    expect(await concluir(db, id, 'CADASTRADO', `, 3924999, null, 'KG', '${NOME}'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select produto_id::text, descricao, unidade from produto_planilha where produto_id = 3924999')).toEqual([{ produto_id: '3924999', descricao: NOME, unidade: 'KG' }])
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 3924999')).toEqual([{ palavras: 'maion hellmanns' }])
    expect(await como(db, ADMIN, 'select estado, produto_id::text, motivo from produto_cadastro')).toEqual([{ estado: 'CADASTRADO', produto_id: '3924999', motivo: null }])
  })

  it('palavras já existentes não são sobrescritas: a mescla usa " OU " e não repete', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade) values (3924888, '${NOME}', 'KG')`)
    await db.exec(`insert into cot_produto_busca (produto_id, palavras) values (3924888, 'maionese balde')`)
    const id = await pedir(db, { palavras: `'maion hellmanns'` })
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3924888, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 3924888')).toEqual([{ palavras: 'maionese balde OU maion hellmanns' }])
  })

  it('JA_EXISTIA: vale a unidade e a descrição do SisChef (não as digitadas); sem palavras não cria linha de busca', async () => {
    const db = await banco()
    const id = await pedir(db, { unidade: `'UN'` })
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3469720, null, 'KG', 'MOLHO AMERICAN CHEESE - INSUMOS'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select descricao, unidade from produto_planilha where produto_id = 3469720')).toEqual([{ descricao: 'MOLHO AMERICAN CHEESE - INSUMOS', unidade: 'KG' }])
    expect(await como(db, ADMIN, 'select 1 from cot_produto_busca where produto_id = 3469720')).toEqual([])
  })

  it('produto criado com unidade diferente da escolhida, ou unidade do SisChef fora de KG/UN: vira REVISAR e NADA entra na planilha', async () => {
    const db = await banco()
    const a = await pedir(db)
    expect(await concluir(db, a, 'CADASTRADO', `, 3925001, null, 'UN'`)).toBe('REVISAR')
    const b = await pedir(db, { chave_nome: `'outro nome'` })
    expect(await concluir(db, b, 'JA_EXISTIA', `, 3925002, null, 'PCT'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select 1 from produto_planilha where produto_id in (3925001, 3925002)')).toEqual([])
    const motivos = await como(db, ADMIN, 'select motivo from produto_cadastro order by criado_em')
    expect(String((motivos[0] as { motivo: string }).motivo)).toMatch(/foi criado no SisChef com a unidade UN/)
    expect(String((motivos[1] as { motivo: string }).motivo)).toMatch(/só aceita KG ou UN/)
  })

  it('a planilha já tem o produto com outra unidade: REVISAR e a linha dela não muda', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade) values (3925003, 'JA TINHA', 'UN')`)
    const id = await pedir(db)
    expect(await concluir(db, id, 'JA_EXISTIA', `, 3925003, null, 'KG'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select unidade from produto_planilha where produto_id = 3925003')).toEqual([{ unidade: 'UN' }])
  })

  it('REVISAR guarda o motivo e os candidatos (parecidos achados no SisChef)', async () => {
    const db = await banco()
    const id = await pedir(db)
    const cands = JSON.stringify([{ produto_id: 111, descricao: 'MAIONESE HELLMANNS 3KG', unidade: 'KG' }])
    expect(await concluir(db, id, 'REVISAR', `, null, 'Achei produto parecido', null, null, '${cands}'::jsonb`)).toBe('REVISAR')
    const r = await como(db, ADMIN, 'select motivo, candidatos from produto_cadastro')
    expect(r).toEqual([{ motivo: 'Achei produto parecido', candidatos: [{ produto_id: 111, descricao: 'MAIONESE HELLMANNS 3KG', unidade: 'KG' }] }])
  })

  it('idempotente: pedido já concluído não muda de novo (devolve o estado em que está) e produto sem código é recusado', async () => {
    const db = await banco()
    const id = await pedir(db)
    expect(await concluir(db, id, 'CADASTRADO', `, 3925010, null, 'KG'`)).toBe('CADASTRADO')
    expect(await concluir(db, id, 'REVISAR', `, null, 'tentativa tardia'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select estado, motivo from produto_cadastro')).toEqual([{ estado: 'CADASTRADO', motivo: null }])
    const outro = await pedir(db, { chave_nome: `'sem codigo'` })
    await expect(concluir(db, outro, 'CADASTRADO', `, null, null, 'KG'`)).rejects.toThrow(/sem código/)
    await expect(concluir(db, outro, 'PENDENTE')).rejects.toThrow(/estado inválido/)
  })
})

// A regra do app para aceitar produto FORA de itens_semana, reproduzida em SQL: src/lib/api.ts (lerPlanilhaDeUnidades + catalogoProdutos) e
// supabase/functions/confirmar-cupom/index.ts (buscarProduto) só aceitam a linha da planilha com unidade kg/un e descrição com algo além de espaço
// (`String(unidade ?? '').trim().toLowerCase()` em kg/un e `String(descricao ?? '').replace(/\s+/g, ' ').trim() !== ''`).
const ACEITO_PELO_APP = `select produto_id::text as produto_id from produto_planilha
  where lower(btrim(coalesce(unidade, ''))) in ('kg', 'un') and btrim(regexp_replace(coalesce(descricao, ''), '\\s+', ' ', 'g')) <> ''`

describe('produto_cadastro_concluir — correções da revisão nº 2 (14/10/2026)', () => {
  it('I3: a planilha tinha o produto SÓ com a unidade (descrição nula, em branco ou só tabulação): o JA_EXISTIA preenche a descrição, a unidade fica e o produto passa a valer para o app fora de itens_semana', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade) values (5006, null, 'KG'), (5007, '   ', 'UN'), (5008, E'\\t', 'KG')`)
    expect(await como(db, ADMIN, `${ACEITO_PELO_APP} and produto_id in (5006, 5007, 5008)`)).toEqual([])   // antes: fora da lista do app
    const casos: [number, string, string][] = [[5006, 'KG', 'MAIONESE X - INSUMOS'], [5007, 'UN', 'GUARDANAPO X - INSUMOS'], [5008, 'KG', 'AÇÚCAR X - INSUMOS']]
    for (const [pid, un, nome] of casos) {
      const id = await pedir(db, { chave_nome: `'item ${pid}'`, unidade: `'${un}'` })
      expect(await concluir(db, id, 'JA_EXISTIA', `, ${pid}, null, '${un}', '${nome}'`)).toBe('JA_EXISTIA')
    }
    expect(await como(db, ADMIN, 'select produto_id::int as produto_id, descricao, unidade from produto_planilha order by produto_id')).toEqual([
      { produto_id: 5006, descricao: 'MAIONESE X - INSUMOS', unidade: 'KG' },
      { produto_id: 5007, descricao: 'GUARDANAPO X - INSUMOS', unidade: 'UN' },
      { produto_id: 5008, descricao: 'AÇÚCAR X - INSUMOS', unidade: 'KG' },
    ])
    expect(await como(db, ADMIN, `${ACEITO_PELO_APP} order by produto_id`)).toEqual([{ produto_id: '5006' }, { produto_id: '5007' }, { produto_id: '5008' }])
    expect(await como(db, ADMIN, 'select 1 from itens_semana where produto_id in (5006, 5007, 5008)')).toEqual([])   // quem o põe na lista é a planilha
  })

  it('I3: sem a descrição lida vale a do pedido; com a unidade da planilha diferente nada muda (nem a descrição vazia é preenchida)', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, unidade) values (5011, 'KG'), (5012, 'UN')`)
    const a = await pedir(db)
    expect(await concluir(db, a, 'JA_EXISTIA', `, 5011, null, 'KG', null`)).toBe('JA_EXISTIA')
    const b = await pedir(db, { chave_nome: `'outro nome'` })
    expect(await concluir(db, b, 'JA_EXISTIA', `, 5012, null, 'KG', 'OUTRO NOME - INSUMOS'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select produto_id::int as produto_id, descricao, unidade from produto_planilha order by produto_id')).toEqual([
      { produto_id: 5011, descricao: NOME, unidade: 'KG' },
      { produto_id: 5012, descricao: null, unidade: 'UN' },
    ])
  })

  it('I3 de ponta a ponta: depois da função, o produto que a planilha tinha só com a unidade é aceito na nota fiscal (cot_nfe_associar) com o nome da planilha', async () => {
    const db = await banco()
    const CHAVE_NF = '15261012345678000190550010001234561000000017'
    const item = { n: 1, cod_forn: '555', descricao: 'MAION.HELLMANNS 1X3KG', qtd_nf: 2, unidade_nf: 'UN', produto_id: null, associacao: null, qtd: null,
      unidade_sischef: 'UN', v_prod: 0, v_desc: 0, v_ipi: 0, v_st: 0, v_outro: 0 }
    const nota = { chave: CHAVE_NF, emitente: 'FORNECEDOR A LTDA', numero: '000123456', emissao: '2026-10-18', valor_nf: 378,
      totais: { v_prod: 378, v_desc: 0, v_ipi: 0, v_st: 0, v_frete: 0, v_outro: 0 }, itens: [item] }
    await chamar(db, 'anon', 'cot_nfe_sincronizar($1, $2::jsonb)', [SEGREDO, JSON.stringify({ lida_em: '2026-10-20T15:03:10Z', completa: true, origem: 'agendada', notas: [nota] })])
    const associar = () => chamar(db, ADMIN, 'cot_nfe_associar($1, $2, $3)', [CHAVE_NF, 1, 5009])
    await db.exec(`insert into produto_planilha (produto_id, unidade) values (5009, 'KG')`)
    expect(await erroDe(associar())).toBe('produto fora da lista de insumos')   // só com a unidade: ainda não é produto da lista
    const id = await pedir(db)
    expect(await concluir(db, id, 'JA_EXISTIA', `, 5009, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    await associar()
    const [r] = await como(db, ADMIN, 'select associacoes_app from cot_nfe where chave = $1', [CHAVE_NF])
    expect(r.associacoes_app['1']).toMatchObject({ produto_id: 5009, produto_nome: NOME, unidade: 'kg', origem: 'planilha' })
    expect(await como(db, ADMIN, `${ACEITO_PELO_APP} and produto_id = 5009`)).toEqual([{ produto_id: '5009' }])   // e na lista do app e na confirmação do cupom
  })

  it('S-M4: a descrição que a planilha JÁ tem (com a unidade igual) não é sobrescrita pela do SisChef, nem a unidade, nem a data da linha', async () => {
    const db = await banco()
    await db.exec(`insert into produto_planilha (produto_id, descricao, unidade, atualizado_em) values (5010, 'MAIONESE (NOME QUE O IVAN ESCREVEU)', 'KG', '2026-10-08T12:00:00Z')`)
    const id = await pedir(db)
    expect(await concluir(db, id, 'JA_EXISTIA', `, 5010, null, 'KG', 'MAIONESE HELLMANNS - INSUMOS (NOME DO SISCHEF)'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, `select descricao, unidade, atualizado_em = '2026-10-08T12:00:00Z'::timestamptz as mesma_data from produto_planilha where produto_id = 5010`))
      .toEqual([{ descricao: 'MAIONESE (NOME QUE O IVAN ESCREVEU)', unidade: 'KG', mesma_data: true }])
  })

  it('M6: CADASTRADO sem a unidade lida no SisChef (nula, vazia ou só espaço) vira REVISAR "unidade lida ausente": nada entra na planilha e o código fica no pedido', async () => {
    const db = await banco()
    for (const [i, un] of ['null', `''`, `'   '`].entries()) {
      const id = await pedir(db, { chave_nome: `'sem unidade ${i}'` })
      expect(await concluir(db, id, 'CADASTRADO', `, ${5020 + i}, null, ${un}, '${NOME}'`)).toBe('REVISAR')
    }
    expect(await como(db, ADMIN, 'select 1 from produto_planilha')).toEqual([])
    expect(await como(db, ADMIN, 'select estado, produto_id::int as produto_id, motivo from produto_cadastro order by produto_id')).toEqual(
      [5020, 5021, 5022].map((pid) => ({ estado: 'REVISAR', produto_id: pid, motivo: `unidade lida ausente: confira no SisChef a unidade do produto ${pid}` })))
  })

  it('S-M10: JA_EXISTIA sem a unidade lida também vira REVISAR: nunca vale a unidade que o Ivan escolheu no pedido', async () => {
    const db = await banco()
    const id = await pedir(db)   // unidade escolhida: KG
    expect(await concluir(db, id, 'JA_EXISTIA', `, 5030, null, null, '${NOME}'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select 1 from produto_planilha')).toEqual([])
    expect(await como(db, ADMIN, 'select motivo from produto_cadastro')).toEqual([{ motivo: 'unidade lida ausente: confira no SisChef a unidade do produto 5030' }])
  })

  it('I5 (C2): o REVISAR guarda o código do produto quando o robô o informa; sem código continua sem; código inválido é ignorado e o REVISAR é gravado assim mesmo', async () => {
    const db = await banco()
    const ids: Record<string, string> = {}
    for (const [chave, pid] of [['a com codigo', '3925020'], ['b sem codigo', 'null'], ['c codigo zero', '0'], ['d codigo negativo', '-7']]) {
      ids[chave] = await pedir(db, { chave_nome: `'${chave}'` })
      expect(await concluir(db, ids[chave], 'REVISAR', `, ${pid}, 'Confira os campos no SisChef'`)).toBe('REVISAR')
    }
    // o REVISAR por divergência de unidade também guarda o código (o produto existe no SisChef com ele)
    const e = await pedir(db, { chave_nome: `'e unidade diferente'` })
    expect(await concluir(db, e, 'CADASTRADO', `, 3925021, null, 'UN'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select chave_nome, estado, produto_id::int as produto_id from produto_cadastro order by chave_nome')).toEqual([
      { chave_nome: 'a com codigo', estado: 'REVISAR', produto_id: 3925020 },
      { chave_nome: 'b sem codigo', estado: 'REVISAR', produto_id: null },
      { chave_nome: 'c codigo zero', estado: 'REVISAR', produto_id: null },
      { chave_nome: 'd codigo negativo', estado: 'REVISAR', produto_id: null },
      { chave_nome: 'e unidade diferente', estado: 'REVISAR', produto_id: 3925021 },
    ])
    // idempotente: o REVISAR com código não vira pronto depois nem põe o produto na planilha
    expect(await concluir(db, ids['a com codigo'], 'CADASTRADO', `, 3925020, null, 'KG'`)).toBe('REVISAR')
    expect(await como(db, ADMIN, 'select 1 from produto_planilha')).toEqual([])
  })

  it('M3 (S1): a mescla das palavras compara a ENTRADA inteira, não pedaço de texto: "sal" entra mesmo havendo "salsicha"', async () => {
    const db = await banco()
    await db.exec(`insert into cot_produto_busca (produto_id, palavras) values (5040, 'salsicha')`)
    const id = await pedir(db, { palavras: `'sal'` })
    expect(await concluir(db, id, 'JA_EXISTIA', `, 5040, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 5040')).toEqual([{ palavras: 'salsicha OU sal' }])
  })

  it('M3 (S-M5): entrada que o produto já tem (outras maiúsculas, espaço duplo, separada por " ou ") não entra de novo; a nova entra uma vez só; repetir o pedido não muda nada', async () => {
    const db = await banco()
    await db.exec(`insert into cot_produto_busca (produto_id, palavras) values (5041, 'nuggets ou Chicken Supreme 2,5Kg')`)
    const um = await pedir(db, { palavras: `'CHICKEN  supreme 2,5kg OU nuggets OU empanado OU Empanado'` })
    expect(await concluir(db, um, 'JA_EXISTIA', `, 5041, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 5041')).toEqual([{ palavras: 'nuggets ou Chicken Supreme 2,5Kg OU empanado' }])
    // outro toque com as mesmas palavras, depois do 1º terminar: nada entra duas vezes e não há auditoria de "mudança"
    const dois = await pedir(db, { palavras: `'empanado OU nuggets'` })
    expect(await concluir(db, dois, 'JA_EXISTIA', `, 5041, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 5041')).toEqual([{ palavras: 'nuggets ou Chicken Supreme 2,5Kg OU empanado' }])
    expect(await como(db, ADMIN, `select count(*)::int as n from historico_alteracoes where tabela = 'cot_produto_busca' and registro = '5041'`)).toEqual([{ n: 1 }])
    // produto sem linha de busca: a mesma entrada repetida no pedido entra uma vez
    const tres = await pedir(db, { chave_nome: `'novo'`, palavras: `'maion hellmanns OU Maion Hellmanns'` })
    expect(await concluir(db, tres, 'CADASTRADO', `, 5044, null, 'KG', '${NOME}'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select palavras from cot_produto_busca where produto_id = 5044')).toEqual([{ palavras: 'maion hellmanns' }])
  })

  it('M3 (S-M6): a mescla passaria de 500 caracteres: o produto entra na planilha, as palavras ficam como estavam e nada quebra; com exatamente 500, entra', async () => {
    const db = await banco()
    await db.exec(`insert into cot_produto_busca (produto_id, palavras) values (5042, '${'a'.repeat(495)}'), (5043, '${'b'.repeat(481)}')`)
    const a = await pedir(db, { palavras: `'maion hellmanns'` })
    expect(await concluir(db, a, 'CADASTRADO', `, 5042, null, 'KG', '${NOME}'`)).toBe('CADASTRADO')
    expect(await como(db, ADMIN, 'select descricao, unidade from produto_planilha where produto_id = 5042')).toEqual([{ descricao: NOME, unidade: 'KG' }])
    expect(await como(db, ADMIN, 'select char_length(palavras) as n from cot_produto_busca where produto_id = 5042')).toEqual([{ n: 495 }])
    expect(await como(db, ADMIN, `select estado, motivo from produto_cadastro where id = '${a}'`)).toEqual([{ estado: 'CADASTRADO', motivo: null }])
    expect(await como(db, ADMIN, `select 1 from historico_alteracoes where tabela = 'cot_produto_busca' and registro = '5042'`)).toEqual([])
    const b = await pedir(db, { chave_nome: `'outro nome'`, palavras: `'maion hellmanns'` })   // 481 + " OU " + 15 = 500: cabe
    expect(await concluir(db, b, 'JA_EXISTIA', `, 5043, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, 'select char_length(palavras) as n from cot_produto_busca where produto_id = 5043')).toEqual([{ n: 500 }])
  })

  it('M4 (S3): a auditoria da mudança das palavras diz "via robô: cadastro de produto" (não "via app") e o app.via de antes volta depois da função', async () => {
    const db = await banco()
    const a = await pedir(db, { palavras: `'maion hellmanns'` })
    const viaDepois = await db.transaction(async (tx) => {
      await tx.exec('set local role service_role')
      await tx.query(`select set_config('app.via', 'claude', true)`)
      await tx.query(`select produto_cadastro_concluir('${a}'::uuid, 'CADASTRADO', 5050, null, 'KG', '${NOME}')`)
      return (await tx.query<{ v: string | null }>(`select current_setting('app.via', true) as v`)).rows[0].v
    })
    expect(viaDepois).toBe('claude')
    // como o robô chama (PostgREST, sem app.via): a auditoria diz o mesmo
    const b = await pedir(db, { chave_nome: `'outro nome'`, palavras: `'balde'` })
    expect(await concluir(db, b, 'JA_EXISTIA', `, 5050, null, 'KG', '${NOME}'`)).toBe('JA_EXISTIA')
    expect(await como(db, ADMIN, `select depois->>'via' as via, depois->>'palavras' as palavras from historico_alteracoes where tabela = 'cot_produto_busca' and registro = '5050' order by id`))
      .toEqual([{ via: 'robô: cadastro de produto', palavras: 'maion hellmanns' }, { via: 'robô: cadastro de produto', palavras: 'maion hellmanns OU balde' }])
  })
})
