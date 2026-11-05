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

// 04/11/2026 (cupom da A. N. da Silva): o GRAMPO 26/6 sugeria "CAMARÃO 34/40" só porque as palavras-chave do camarão têm "26/30" e o "26" coincidia. Número SOZINHO nunca é parecido.
describe('número sozinho não vira "parecido" (o grampo 26/6 não pode sugerir camarão)', () => {
  const camarao34: ProdutoCatalogo = {
    produto_id: 3469588, nome: 'CAMARÃO 34/40 - INSUMO (KG)', nome_sischef: 'CAMARÃO ROSA 34/40 - INSUMO (KG)', unidade: 'kg',
    palavras: 'CAMARÃO 34/40 OU CAMARAO CINZA DESC G (FP 500G) OU CAMARAO CINZA DESC G 26/30 (CM 1KG)',
  }
  const camarao2630: ProdutoCatalogo = { produto_id: 3469589, nome: 'CAMARÃO 26/30 - INSUMO (KG)', unidade: 'kg' }
  it('GRAMPO GRAMPEADOR 26/6 (só o número 26 em comum com o camarão) não recebe sugestão nenhuma', () => {
    expect(sugerirPorPalavras([camarao34, ...catalogo], 'GRAMPO GRAMPEADOR 26/6 12X5000 BAZZE', 'UN')).toBeNull()
  })
  it('o número continua decidindo quando vem com o nome: CAMARAO 26/30 acha o 26/30 (forte) e CAMARAO 41/50 só dá candidatos (fraca)', () => {
    const dois = [{ ...camarao34, palavras: undefined, nome_sischef: undefined }, camarao2630]
    const s = sugerirPorPalavras(dois, 'CAMARAO CINZA 26/30 CONGELADO', 'KG')
    expect(s?.forca).toBe('forte')
    expect(s?.produto.produto_id).toBe(3469589)
    const sem = sugerirPorPalavras(dois, 'CAMARAO 41/50', 'KG')
    expect(sem?.forca).toBe('fraca')
  })
  it('palavra com letra junto do número ("2KG", "10kg", "600g") continua valendo como parecida', () => {
    const saco: ProdutoCatalogo = { produto_id: 3476484, nome: 'SACO 2KG - C/ 100 UND', unidade: 'un' }
    const s = sugerirPorPalavras([saco], 'SACO 19X37 2KG AD FONTEPLAST', 'ML')
    expect(s?.produto.produto_id).toBe(3476484)
  })
})

// 04/11/2026: o SisChef escreve AMENDOIN e MEZINHA (erro de digitação dele) e o fornecedor escreve certo; "10K" do cupom é o "10 KG" do SisChef.
describe('palavrasDe — grafias que são a mesma palavra', () => {
  it('AMENDOIN (SisChef) e AMENDOIM (cupom) viram a mesma palavra; MEZINHA vira mesinha', () => {
    expect(palavrasDe('AMENDOIN XEREM - INSUMOS')).toEqual(['amendoim', 'xerem'])
    expect(palavrasDe('AMENDOIM XEREM TRITURADO AMARI')).toEqual(['amendoim', 'xerem', 'triturado', 'amari'])
    expect(palavrasDe('MEZINHA P/ PIZZAS - PCT 250 UND')).toEqual(['mesinha', 'pizzas', '250'])
    expect(palavrasDe('SUPORTE P/ PIZZA (MESINHA) C/100 UNIDS')).toContain('mesinha')
  })
  it('"10K" no cupom é "10 KG" do SisChef (sem mexer em "10 KG", "2KG" nem "600G")', () => {
    expect(palavrasDe('SACOLA 42X53 10K BR. ESTRELA')).toEqual(['sacola', '10kg', 'br', 'estrela'])
    expect(palavrasDe('SACOLA 10 KG - 100 UND')).toEqual(['sacola', '10kg', '100'])
    expect(palavrasDe('SACO 2KG - C/ 100 UND')).toEqual(['saco', '2kg', '100'])
    expect(palavrasDe('FAR.LACTEA NESTLE 1X600G')).toEqual(['farinha', 'lacta', 'nestle', '600g'])
  })
  it('a sacola do cupom (42X53 10K) agora tem a sacola de 10 KG como candidato', () => {
    const sacolas: ProdutoCatalogo[] = [
      { produto_id: 3476488, nome: 'SACOLA 5 KG - 100 UND', unidade: 'ct' }, { produto_id: 3476486, nome: 'SACOLA 10 KG - 100 UND', unidade: 'ct' },
      { produto_id: 3476487, nome: 'SACOLA 15 KG - 100 UND', unidade: 'ct' },
    ]
    const s = sugerirPorPalavras(sacolas, 'SACOLA 42X53 10K BR. ESTRELA PLASCOLDRIL', 'UN')
    expect(s?.forca).toBe('fraca')
    expect(s?.produto.produto_id).toBe(3476486)   // o de 10 KG vem na frente (2 palavras: sacola e 10kg)
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
