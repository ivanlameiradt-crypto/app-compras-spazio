import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Base e ordem das migrations da Fase 2 (desenho DESIGN-fase-2.md, §1.3 passo 1 e §10.3, X1 e X2).
//
// A BASE é 1A + 1B (o commit 74508da). Cada bloco da Fase 2 (E1, D1, C1, D2, B, A, C2, limpeza da C)
// acrescenta:
//   - o nome do arquivo da migration nova em ORDEM_ESPERADA, na ordem de aplicação (§8.2);
//   - em X2, os hashes de base do cabeçalho `-- base: <função>=<sha256>` das funções que ele reescreve
//     (tabela §8.4) e, para o E1 e a D1, a checagem de que o md5(prosrc) das funções existentes não muda.
// E1 (20261015000001_economia) já entrou: não reescreve nenhuma função da 1B (X2 do md5).

const AQUI = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(AQUI, '../../supabase/migrations')

// A migration de storage só existe no Supabase (igual ao filtro de tests/db/banco.ts): não entra no pglite.
function arquivosNoDisco(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && !f.includes('storage'))
    .sort()
}

// Ordem de aplicação (§8.2), sem a de storage. A Fase 2 acrescenta os nomes novos ao fim, em ordem:
// ...20261015000001_economia (E1), ...20261015000002_recebimento_nfe (D1), ...20261029000001_cadastros (C1),
// ...20261029000002_falta_definitiva (D2), ...20261104000001_ia_leitura (B), ...20261126000001_cadastros_regras (C2).
// A A (...20261111000001_cotacao_cruzada) e a limpeza (...20261203000001) ainda não estão no disco.
const BASE = [
  '20260922000001_esquema.sql',
  '20260922000002_rpc.sql',
  '20260922000004_ajustes.sql',
  '20260922000005_cancelar_idempotente.sql',
  '20260928000001_selos.sql',
  '20261001000001_cotacao.sql',
]
const E1 = '20261015000001_economia.sql'
const D1 = '20261015000002_recebimento_nfe.sql'
const C1 = '20261029000001_cadastros.sql'
const D2 = '20261029000002_falta_definitiva.sql'
const B = '20261104000001_ia_leitura.sql'
const C2 = '20261126000001_cadastros_regras.sql'
// Fase 3 (lançar a NF-e pelo App): a coluna da trava (lancamento_em) e a forma de pagamento + estado do disparo.
const F3A = '20261205000001_nfe_lancamento.sql'
const F3B = '20261206000001_nfe_lancar.sql'
const F3C = '20261207000001_nfe_parcelas.sql'
const F3D = '20261208000001_nfe_parcelas_manuais.sql'
const F3E = '20261209000001_nfe_descartar.sql'
const F3F = '20261210000001_nfe_associacao_app.sql'
const F3G = '20261211000001_produto_busca.sql' // palavras-chave e nome corrigido dos produtos (caixa de associação)
const F3H = '20261211000002_produto_busca_ocultar.sql' // produto de receita (não é de compra) some da caixa de associação
const F3I = '20261212000001_nfe_associacao_conversao.sql' // etapa 2 da associação: a decisão do app ganha a conversão de unidade (cot_nfe_associar c/ 4 parâmetros)
const F3J = '20261213000001_nfe_conversao_item_associado.sql' // conversão de unidade para item que já vem associado no SisChef com UN DIFERE (cot_nfe_converter_item)
const F3K = '20261214000001_produto_planilha.sql' // a unidade de cada produto vem da planilha do Ivan (produto_planilha)
const F3L = '20261215000001_nfe_associar_unidade_planilha.sql' // a unidade da decisão do app vem da planilha do Ivan (cot_nfe_associar)
const F3M = '20261216000001_produto_planilha_descricao.sql' // produto acrescentado pela planilha (descrição) entra na lista de insumos e em cot_nfe_associar
// A C1 entra entre a D1 e a D2 (nome 29-01 < 29-02); a C2 vem depois da B; as da Fase 3 são as últimas por nome.
const ATE_D1 = [...BASE, E1, D1]
const ATE_C1 = [...BASE, E1, D1, C1]
const ANTES_DE_B = [...BASE, E1, D1, C1, D2]
const ANTES_DE_C2 = [...BASE, E1, D1, C1, D2, B]
const ORDEM_ESPERADA = [...BASE, E1, D1, C1, D2, B, C2, F3A, F3B, F3C, F3D, F3E, F3F, F3G, F3H, F3I, F3J, F3K, F3L, F3M]

// Retrato do esquema da base (1A + 1B). Cresce a cada bloco que cria tabela ou view.
const TABELAS_ESPERADAS = [
  'compras',
  'compras_itens',
  'cot_avisos',
  'cot_cadastros_aplicados',
  'cot_catalogo',
  'cot_categorias',
  'cot_codigos',
  'cot_cotacoes',
  'cot_envios',
  'cot_fator_descartes', // C2
  'cot_feriados',
  'cot_fornecedores',
  'cot_fornecedores_cnpj',
  'cot_ia_config',
  'cot_itens',
  'cot_leituras_ia',
  'cot_limites',
  'cot_nfe',
  'cot_nfe_leituras',
  'cot_pedidos',
  'cot_pedidos_acomp',
  'cot_produto_busca', // Fase 3: palavras-chave e nome corrigido dos produtos
  'cot_recebimentos',
  'cot_vendedores',
  'historico_alteracoes',
  'itens_semana',
  'lista_regras', // C2
  'produto_planilha', // a unidade do SisChef de cada produto, da planilha do Ivan
  'semanas',
  'usuarios',
]
const VIEWS_ESPERADAS = ['cot_conferencia', 'cot_desempenho', 'cot_economia', 'cot_economia_linhas',
  'cot_historico_itens', 'cot_historico_semanas', 'cot_ia_uso', 'cot_itens_admin', 'cot_resumo'] // C2 acrescenta as duas de histórico

const shim = () => readFileSync(join(AQUI, 'shim-supabase.sql'), 'utf8')
const migration = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8')

async function tabelas(db: PGlite): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )
  return r.rows.map((x) => x.table_name)
}
async function views(db: PGlite): Promise<string[]> {
  const r = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'VIEW' order by table_name`,
  )
  return r.rows.map((x) => x.table_name)
}

/** Mapa assinatura → md5(prosrc) de toda função de public (para conferir que uma migration não reescreve). */
async function md5Funcoes(db: PGlite): Promise<Map<string, string>> {
  const r = await db.query<{ f: string; h: string }>(
    `select regexp_replace(p.oid::regprocedure::text, '\\s', '', 'g') as f, md5(p.prosrc) as h
       from pg_proc p where p.pronamespace = 'public'::regnamespace`,
  )
  return new Map(r.rows.map((x) => [x.f, x.h]))
}

/** O corpo (prosrc) de uma função de public pela assinatura, como está gravado. */
async function prosrc(db: PGlite, assinatura: string): Promise<string> {
  const r = await db.query<{ s: string }>(
    `select p.prosrc as s from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and regexp_replace(p.oid::regprocedure::text, '\\s', '', 'g') = $1`,
    [assinatura],
  )
  return r.rows[0]?.s ?? ''
}

describe('Fase 2 — base e ordem das migrations', () => {
  it('X1: aplica a base em ordem no pglite sem erro e o esquema bate', async () => {
    // Nenhuma migration foi acrescentada sem entrar na ordem esperada (senão o bloco a esqueceu).
    expect(arquivosNoDisco()).toEqual(ORDEM_ESPERADA)

    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ORDEM_ESPERADA) {
        await db.exec(migration(f)) // db.exec rejeita se a migration tiver erro de SQL
      }
      expect(await tabelas(db)).toEqual(TABELAS_ESPERADAS)
      expect(await views(db)).toEqual(VIEWS_ESPERADAS)
    } finally {
      await db.close()
    }
  })

  it('X2: nenhuma migration referencia objeto ainda não criado', async () => {
    // Aplica uma por uma, em ordem. Se uma migration referenciar um objeto que só é criado por outra
    // mais nova, o db.exec dela quebra aqui, apontando o arquivo.
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ORDEM_ESPERADA) {
        try {
          await db.exec(migration(f))
        } catch (e) {
          throw new Error(`migration fora de ordem ou referenciando objeto ainda não criado: ${f}\n${(e as Error).message}`)
        }
      }
    } finally {
      await db.close()
    }
  })

  it('X2: o E1 não reescreve nenhuma função da 1B (md5(prosrc) igual antes e depois)', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of BASE) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      await db.exec(migration(E1))
      const depois = await md5Funcoes(db)
      // toda função que existia antes do E1 continua com o mesmo corpo (o E1 só cria objetos novos)
      for (const [nome, hash] of antes) {
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
    } finally {
      await db.close()
    }
  })

  it('X2 (D1): a migration de recebimento/NF-e não reescreve nenhuma função da 1B/E1 (md5 igual)', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of [...BASE, E1]) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      await db.exec(migration(D1))
      const depois = await md5Funcoes(db)
      // toda função que existia antes da D1 continua com o mesmo corpo (a D1 só cria objetos novos)
      for (const [nome, hash] of antes) {
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
    } finally {
      await db.close()
    }
  })

  const COT_MARCAS = 'cot_marcas(bigint)'
  it('X2 (D2): a migration da falta definitiva reescreve SÓ a cot_marcas (partindo da versão da 1B)', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ATE_D1) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      await db.exec(migration(D2))
      const depois = await md5Funcoes(db)
      // toda função de antes, menos a cot_marcas, continua com o corpo idêntico
      for (const [nome, hash] of antes) {
        if (nome === COT_MARCAS) continue
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
      // a cot_marcas muda
      expect(depois.get(COT_MARCAS)).not.toEqual(antes.get(COT_MARCAS))
    } finally {
      await db.close()
    }
  })

  // md5Funcoes/prosrc usam oid::regprocedure::text, que omite o schema public quando ele está no search_path.
  const COT_RESPONDER = 'cot_responder_admin(bigint,uuid,jsonb,jsonb,text)'

  it('X2 (B): a migration da IA reescreve SÓ cot_responder_admin, e só a lista de origens (B.6.1)', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ANTES_DE_B) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      const corpoAntes = await prosrc(db, COT_RESPONDER)
      await db.exec(migration(B))
      const depois = await md5Funcoes(db)
      const corpoDepois = await prosrc(db, COT_RESPONDER)

      // toda função de antes, menos a cot_responder_admin, continua com o corpo idêntico
      for (const [nome, hash] of antes) {
        if (nome === COT_RESPONDER) continue
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
      // a cot_responder_admin muda; a única diferença é o 'ivan_ia' a mais na lista de origens (fim de linha CRLF/LF
      // não conta: não muda o comportamento da função)
      const semCr = (s: string) => s.replace(/\r/g, '')
      expect(semCr(corpoDepois)).not.toEqual(semCr(corpoAntes))
      expect(semCr(corpoDepois).replace(", 'ivan_ia'", '')).toEqual(semCr(corpoAntes))
    } finally {
      await db.close()
    }
  })

  it('X2 (C1): a migration dos cadastros no App não reescreve nenhuma função da 1A/1B/E1/D1 (só cria)', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ATE_D1) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      await db.exec(migration(C1))
      const depois = await md5Funcoes(db)
      // toda função que existia antes da C1 continua com o mesmo corpo (a C1 só acrescenta objetos)
      for (const [nome, hash] of antes) {
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
    } finally {
      await db.close()
    }
  })

  // md5Funcoes/prosrc usam oid::regprocedure::text, que omite o schema public quando ele está no search_path.
  const REESCRITAS_C2 = ['importar_semana(jsonb)', 'cot_exportar_cadastros()', 'cot_produtos_cadastro()']
  it('X2 (C2): a última migration reescreve SÓ importar_semana, cot_exportar_cadastros e cot_produtos_cadastro', async () => {
    const db = new PGlite()
    try {
      await db.exec(shim())
      for (const f of ANTES_DE_C2) await db.exec(migration(f))
      const antes = await md5Funcoes(db)
      await db.exec(migration(C2))
      const depois = await md5Funcoes(db)
      // toda função de antes, menos as três reescritas, continua com o corpo idêntico
      for (const [nome, hash] of antes) {
        if (REESCRITAS_C2.includes(nome)) continue
        expect([nome, depois.get(nome)]).toEqual([nome, hash])
      }
      // as três mudam
      for (const nome of REESCRITAS_C2) {
        expect([nome, depois.get(nome)]).not.toEqual([nome, antes.get(nome)])
      }
    } finally {
      await db.close()
    }
  })
})
