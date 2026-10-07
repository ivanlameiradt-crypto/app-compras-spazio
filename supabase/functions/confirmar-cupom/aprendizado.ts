// supabase/functions/confirmar-cupom/aprendizado.ts
// Grava UMA linha de cupom_aprendizado confirmada sem depender do insert-ou-atualiza do PostgREST: os índices únicos da tabela são
// PARCIAIS (`where codigo_barras is not null` / `where descricao_norm is not null and emitente_cnpj is not null`) e o `on conflict` que o
// PostgREST gera não traz o predicado — o Postgres recusa com 42P10 (o mesmo problema de enviar-cupom/gravacao.ts). Por isso: insert simples
// e, se bater no índice (23505), UPDATE pela chave (EAN, ou emitente + descrição). Puro: o banco entra por `io`.
import type { LinhaAprendizado } from './logica.ts'

export interface ErroBanco { code?: string; message: string }
export type CamposAprendizado = Pick<LinhaAprendizado, 'insumo_id' | 'insumo_nome' | 'fator_conversao' | 'unidade_destino' | 'confirmado'>

export interface IoAprendizado {
  /** Insert simples. Devolve ok ou o erro do banco (não lança). */
  inserir(linha: LinhaAprendizado): Promise<{ ok: true } | { erro: ErroBanco }>
  /** UPDATE da linha com este EAN; true se alterou uma linha. */
  atualizarPorEan(ean: string, campos: CamposAprendizado): Promise<boolean>
  /** UPDATE da linha deste (emitente, descrição normalizada); true se alterou uma linha. */
  atualizarPorDescricao(cnpj: string, descricaoNorm: string, campos: CamposAprendizado): Promise<boolean>
}

export async function gravarAprendizado(linha: LinhaAprendizado, io: IoAprendizado): Promise<void> {
  const r = await io.inserir(linha)
  if ('ok' in r) return
  // qualquer erro que não seja "já existe" (not null, rede, permissão…) é erro de verdade: sobe.
  if (r.erro.code !== '23505') throw new Error(r.erro.message || 'não consegui gravar o aprendizado')
  const campos: CamposAprendizado = {
    insumo_id: linha.insumo_id, insumo_nome: linha.insumo_nome, fator_conversao: linha.fator_conversao,
    unidade_destino: linha.unidade_destino, confirmado: true,
  }
  const alterou = linha.codigo_barras
    ? await io.atualizarPorEan(linha.codigo_barras, campos)
    : linha.emitente_cnpj && linha.descricao_norm
      ? await io.atualizarPorDescricao(linha.emitente_cnpj, linha.descricao_norm, campos)
      : false
  // nunca finge sucesso: a linha existia (23505) mas o UPDATE não a achou pela chave — algo está fora do esperado.
  if (!alterou) throw new Error('não consegui atualizar o aprendizado que já existia')
}
