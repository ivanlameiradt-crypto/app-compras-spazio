import type { PGlite } from '@electric-sql/pglite'
import { como } from './banco'

export const ADMIN = 'ivan@spazio.com'
export const JOAO = 'joao@spazio.com'
export const MARIA = 'maria@spazio.com'
export const EX = 'ex@spazio.com' // desativado
export const ESTRANHO = 'alguem@gmail.com' // nunca cadastrado

export async function semear(db: PGlite) {
  await db.exec(`
    insert into usuarios (email, nome, papel, ativo) values
      ('${ADMIN}', 'Ivan', 'admin', true),
      ('${JOAO}', 'João', 'comprador', true),
      ('${MARIA}', 'Maria', 'comprador', true),
      ('${EX}', 'Ex', 'comprador', false);
  `)
}

export const PAYLOAD = {
  data_referencia: '2026-09-22',
  itens: [
    { produto_id: 1, produto: 'COCA COLA 350 ML', bebida: true, estoque: 41, estoque_minimo: 0, qtd_sugerida: 52, preco_estimado: 2.79, data_ultima_compra: '2026-09-11', fornecedor_ultima: 'ATACADAO S.A.', situacao: 'Repor' },
    { produto_id: 2, produto: 'GUARANÁ ANTARC. S/ AÇÚCAR 350 ML', bebida: true, estoque: -5, estoque_minimo: 0, qtd_sugerida: 148, preco_estimado: 2.49, data_ultima_compra: '2026-09-10', fornecedor_ultima: 'MATEUS SUPERMERCADOS SA', situacao: 'ESTOQUE NEGATIVO' },
    { produto_id: 3, produto: 'MOSTARDA - INSUMO (KG)', bebida: false, estoque: 0.8, estoque_minimo: 2, qtd_sugerida: 1.2, preco_estimado: 18.5, data_ultima_compra: null, fornecedor_ultima: null, situacao: 'ABAIXO DO MÍNIMO' },
    { produto_id: 4, produto: 'CEBOLA EM PÓ - INSUMOS (KG)', bebida: false, estoque: -0.04, estoque_minimo: 0, qtd_sugerida: 0.04, preco_estimado: 30, data_ultima_compra: null, fornecedor_ultima: null, situacao: 'ESTOQUE NEGATIVO' },
    { produto_id: 5, produto: 'COCA COLA KS 290ML', bebida: true, estoque: 48, estoque_minimo: 0, qtd_sugerida: 0, preco_estimado: 3.1, data_ultima_compra: null, fornecedor_ultima: null, situacao: 'Coberto por estoque' },
  ],
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importar(db: PGlite, payload: any = PAYLOAD) {
  const [r] = await como(db, 'service', 'select importar_semana($1::jsonb) as r', [JSON.stringify(payload)])
  return r.r as { resultado: string; semana_id: number; itens?: number }
}

export async function idItem(db: PGlite, produtoId: number, dataRef = '2026-09-22'): Promise<number> {
  const r = await db.query<{ id: number }>(
    `select i.id from itens_semana i join semanas s on s.id = i.semana_id
      where i.produto_id = $1 and s.data_referencia = $2`,
    [produtoId, dataRef],
  )
  return Number(r.rows[0].id)
}

export async function idSemana(db: PGlite, dataRef = '2026-09-22'): Promise<number> {
  const r = await db.query<{ id: number }>('select id from semanas where data_referencia = $1', [dataRef])
  return Number(r.rows[0].id)
}
