// src/admin/palavrasDoItem.ts — as palavras que identificam um produto ou item (regra da palavra-chave, Ivan, 08/10/2026). Sem imports.
// Há uma CÓPIA em supabase/functions/enviar-cupom/palavras.ts, do `/** Palavras` para baixo; o teste tests/unit/palavraChave.test.ts confere que são iguais.

/** Palavras que não identificam produto (embalagem, unidade, ligação). */
const PARADAS = new Set(['insumos', 'insumo', 'kg', 'un', 'und', 'unid', 'pct', 'cx', 'de', 'da', 'do', 'das', 'dos', 'e', 'c', 'com', 's', 'p', 'a', 'o', 'ks', 'sc', 'em', 'tp', 'granel'])
/** Abreviações do cupom e do SisChef que são a mesma palavra (o Ivan pode acrescentar mais aqui). */
const APELIDOS: Record<string, string> = {
  iog: 'iogurte', cond: 'condensado', mussarela: 'mucarela', intregal: 'integral', intrego: 'integral', lactea: 'lacta', qjo: 'queijo', q: 'queijo',
  far: 'farinha', choc: 'chocolate', ref: 'refrigerante', acuc: 'acucar',
}

const semAcento = (t: unknown): string => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** As palavras que identificam o produto/item: sem acento, sem as de embalagem, com as abreviações trocadas, e "350 ML" / "1X1L" vistos como "350ml" / "1l". */
export function palavrasDe(texto: unknown): string[] {
  const t = semAcento(texto)
    .replace(/(\d+)\s*(ml|l|g|kg)\b/g, '$1$2')
    .replace(/\dx(\d+(?:,\d+)?(?:ml|l|g|kg))/g, ' $1 ')
  const saida: string[] = []
  for (let w of t.match(/[a-z0-9]+/g) ?? []) {
    w = APELIDOS[w] ?? w
    if (PARADAS.has(w) || (w.length < 2 && !/\d/.test(w)) || /^\d+x\d+/.test(w)) continue
    if (!saida.includes(w)) saida.push(w)
  }
  return saida
}
