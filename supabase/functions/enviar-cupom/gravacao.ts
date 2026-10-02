// supabase/functions/enviar-cupom/gravacao.ts
// Grava a linha `cupom` SEM duplicar (correções A e B do L3). O índice único de foto_path do Plano 1 é PARCIAL
// (`where foto_path is not null`) e o PostgREST gera `on conflict (foto_path)` sem o predicado: o Postgres recusa com
// 42P10 e TODA gravação falharia. Por isso não se usa o insert-ou-atualiza do PostgREST: faz-se um insert simples e,
// se ele bater num índice único (23505), devolve-se a linha que já existe — achada por foto_path (corrida/reenvio) ou,
// se não for essa, pela chave fiscal (2ª foto do MESMO cupom: foto_path novo, mesma `chave`, índice cupom_chave_uniq).
// Quem recebe `duplicado: true` NÃO dispara o workflow (quem criou a linha é quem dispara). Puro: o banco entra por `io`.

export interface ErroBanco { code?: string; message: string }

export interface IoGravacao {
  /** Insert simples da linha. Devolve o id criado ou o erro do banco (não lança). */
  inserir(linha: Record<string, unknown>): Promise<{ id: string } | { erro: ErroBanco }>
  acharPorFoto(fotoPath: string): Promise<{ id: string } | null>
  acharPorChave(chave: string): Promise<{ id: string } | null>
}

const textoNaoVazio = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export async function gravarSemDuplicar(
  linha: Record<string, unknown>, io: IoGravacao,
): Promise<{ id: string; duplicado?: boolean }> {
  const r = await io.inserir(linha)
  if ('id' in r) return { id: r.id }
  // qualquer erro que não seja "já existe" (not null, rede, permissão…) é erro de verdade: sobe e nada é disparado.
  if (r.erro.code !== '23505') throw new Error(r.erro.message || 'não consegui gravar o cupom')

  // violação de índice único: a linha já existe — foto_path primeiro (é a chave de idempotência do envio), depois a chave fiscal.
  const foto = textoNaoVazio(linha.foto_path)
  const porFoto = foto ? await io.acharPorFoto(foto) : null
  if (porFoto) return { id: porFoto.id, duplicado: true }
  const chave = textoNaoVazio(linha.chave)
  const porChave = chave ? await io.acharPorChave(chave) : null
  if (porChave) return { id: porChave.id, duplicado: true }
  // nunca finge sucesso: sem a linha existente não há id para devolver.
  throw new Error('não consegui gravar o cupom: já existe um duplicado, mas não achei a linha dele')
}
