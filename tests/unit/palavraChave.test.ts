import { describe, expect, it } from 'vitest'
import { palavrasDe, sugerirPorPalavras } from '../../src/admin/palavraChave'
import type { ProdutoCatalogo } from '../../src/lib/tipos'
import { readFileSync } from 'node:fs'
import { palavrasDe as palavrasDoServidor } from '../../supabase/functions/enviar-cupom/palavras'

// Descrições da planilha do Ivan (as do SisChef) — um recorte com os casos que importam.
const nomes: [number, string, string][] = [
  [3482196, 'TOMATE ITALIANO - INSUMOS (KG)', 'KG'], [3476543, 'TOMATE LONGA VIDA - INSUMOS (KG)', 'KG'], [3476544, 'TOMATE CEREJA - INSUMOS (KG)', 'KG'],
  [3469574, 'ALHO COMUM DESCASCADO - INSUMOS (KG)', 'KG'], [3531993, 'MOLHO DE ALHO - INSUMOS (KG)', 'KG'], [3478968, 'PASTA DE ALHO NEGRO - INSUMOS (KG)', 'KG'],
  [1855900, 'CREME DE LEITE - INSUMOS (KG)', 'KG'], [3469626, 'LEITE CONDENSADO - INSUMOS (KG)', 'KG'], [3469635, 'LEITE LIQUIDO INTEGRAL - INSUMOS (KG)', 'KG'],
  [1836992, 'COCA COLA 1L', 'UN'], [1836997, 'COCA COLA 2L', 'UN'], [1836982, 'COCA COLA 350 ML', 'UN'], [2952974, 'COCA COLA S/ AÇÚCAR 1L', 'UN'],
  [1855909, 'IOGURTE NATURAL - INSUMOS (KG)', 'KG'], [1854713, 'Q. MUÇARELA - INSUMOS (KG)', 'KG'], [3484992, 'QUEIJO MUÇARELA DE BÚFALA - INSUMOS (KG)', 'KG'],
  [3469643, 'LIMÃO - INSUMOS (KG)', 'KG'], [3484974, 'LIMÃO SICILIANO - INSUMOS (KG)', 'KG'], [3454426, 'MOLHO CHEDDAR - INSUMOS (KG)', 'KG'],
  [3476411, 'FARINHA LACTA - INSUMOS (KG)', 'KG'], [3543752, 'CHOCOTINE - INSUMOS (KG)', 'KG'],
]
const catalogo: ProdutoCatalogo[] = nomes.map(([produto_id, nome, un]) => ({ produto_id, nome, descricao_sischef: nome, unidade: un.toLowerCase() }))
catalogo.push({ produto_id: 3476366, nome: 'CHOCOLATE BARRA LACTA LAKA OREO - INSUMOS', unidade: 'kg', palavras: 'LACTA LAKA OREO' })

const forte = (d: string, u?: string) => { const s = sugerirPorPalavras(catalogo, d, u); return s?.forca === 'forte' ? s.produto.produto_id : null }

describe('palavrasDe', () => {
  it('tira acento, embalagem e unidade; troca abreviações; junta número e unidade', () => {
    expect(palavrasDe('Q. MUÇARELA - INSUMOS (KG)')).toEqual(['queijo', 'mucarela'])
    expect(palavrasDe('COCA COLA 350 ML')).toEqual(['coca', 'cola', '350ml'])
    expect(palavrasDe('REF.COCA COLA ORIG. 1X1L')).toEqual(['refrigerante', 'coca', 'cola', 'orig', '1l'])
    expect(palavrasDe('FAR.LACTEA NESTLE 1X600G')).toEqual(['farinha', 'lacta', 'nestle', '600g'])
  })
})

describe('sugerirPorPalavras — o app sugere forte só com TODAS as palavras do produto e sem empate', () => {
  it('descrição igual à do SisChef (com ou sem sobra de palavras do cupom)', () => {
    expect(forte('TOMATE ITALIANO')).toBe(3482196)
    expect(forte('TOMATE ITALIANO GRAUDO KG')).toBe(3482196)
    expect(forte('PEPINO JAPONES')).toBeNull()
  })
  it('mais palavras vencem: CREME DE LEITE não vira LEITE, LEITE COND vira condensado', () => {
    expect(forte('CREME DE LEITE')).toBe(1855900)
    expect(forte('LEITE COND TIROL SEMIDES TP 395G')).toBe(3469626)
    expect(forte('LEITE LIQUIDO INTREGAL')).toBe(3469635)
  })
  it('abreviações e grafias: QUEIJO MUSSARELA vira Q. MUÇARELA; IOG vira iogurte; LIMÃO TAITI vira LIMÃO', () => {
    expect(forte('QUEIJO MUSSARELA BARRA KG')).toBe(1854713)
    expect(forte('IOG CANTO MINAS NATURAL 850g')).toBe(1855909)
    expect(forte('LIMAO TAITI TROPICAL')).toBe(3469643)
  })
  it('o tamanho é palavra do produto: Coca de 1 L e de 2 L não se confundem; S/ACUC acha a sem açúcar', () => {
    expect(forte('REF.COCA COLA ORIG. 1X1L')).toBe(1836992)
    expect(forte('REF.COCA-COLA PET 1X2L')).toBe(1836997)
    expect(forte('REF.COCA COLA S/ACUC 1X1L')).toBe(2952974)
  })
  it('palavra solta NÃO basta: ALHO KG só dá candidatos (fraca), nunca escolhe sozinho', () => {
    const s = sugerirPorPalavras(catalogo, 'ALHO Kg A GRANEL')
    expect(s?.forca).toBe('fraca')
    expect([s?.produto, ...(s?.alternativas ?? [])].map((p) => p?.produto_id)).toEqual(expect.arrayContaining([3469574, 3531993, 3478968]))
  })
  it('as palavras-chave do Ivan valem: LACTA LAKA OREO acha o chocolate (e não o CHOCOTINE)', () => {
    expect(forte('CHOC.LACTA LAKA OREO 1X145G')).toBe(3476366)
  })
  it('itens sempre manuais (molho cheddar, Coca em pacote) não recebem sugestão', () => {
    expect(sugerirPorPalavras(catalogo, 'MOLHO QJO CHEDDAR 1X1,5Kg')).toBeNull()
    expect(sugerirPorPalavras(catalogo, 'COCA COLA BARCODE 1X6X350M', 'PCT')).toBeNull()
  })
  it('produto escondido não é sugerido; nenhuma palavra em comum = nada', () => {
    const escondido = catalogo.map((p) => (p.produto_id === 3482196 ? { ...p, oculto: true } : p))
    expect(forte('TOMATE ITALIANO')).toBe(3482196)
    expect(sugerirPorPalavras(escondido, 'TOMATE ITALIANO')?.produto.produto_id).not.toBe(3482196)
    expect(sugerirPorPalavras(catalogo, 'XYZ QWERTY')).toBeNull()
  })
})

describe('a cópia do servidor (enviar-cupom/palavras.ts) é a mesma do app', () => {
  const corpo = (f: string) => { const t = readFileSync(f, 'utf8').split(String.fromCharCode(13)).join(''); return t.slice(t.indexOf('/** Palavras')) }
  it('o código é idêntico do `/** Palavras` para baixo', () => {
    expect(corpo('supabase/functions/enviar-cupom/palavras.ts')).toBe(corpo('src/admin/palavrasDoItem.ts'))
  })
  it('e responde igual', () => {
    for (const t of ['Q. MUÇARELA - INSUMOS (KG)', 'COCA COLA 350 ML', 'REF.COCA COLA ORIG. 1X1L', 'TOMATE ITAL. GRAUDO KG']) expect(palavrasDoServidor(t)).toEqual(palavrasDe(t))
  })
})
