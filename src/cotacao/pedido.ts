// "Confirmar pedido" como mapa por item (spec 8.2, item 7; ajuste Foozi 1; contrato 8.3, D44 e D45): monta a linha de
// pedido de cada item cotado com preço, em embalagens inteiras, sugere deixar para a loja o que subiu mais de 10% sobre
// o último preço e soma itens + frete. O Ivan decide tudo na tela; nada sai do pedido sem o toque dele. Item parcial
// começa no que o vendedor tem; item com unidade suspeita é apontado para o Ivan conferir (D64), e a quantidade muito
// acima da esperada também (D67).
import type { BaseCotacao, ItemCotacao, ItemPedidoEntrada } from '../lib/tipos'
import { arred, embalagensPara } from './conversao'

/** Mesmo corte do vermelho do Δ% (spec 7.3.8): acima de +10% sobre o último preço. */
export const LIMITE_SUGESTAO = 0.1

/** Acima de 1,5 vez a quantidade esperada, o mapa pede "Confira a quantidade" e um segundo toque (D67). */
export const LIMITE_QUANTIDADE = 1.5

/**
 * Fator da embalagem na linha do pedido (un ou kg do SisChef por embalagem), pela regra da 4.13: item un → as unidades
 * da embalagem; item kg cotado em gramas → kg por embalagem; item kg cotado em ml **com** kg por litro confirmado → kg
 * por caixa; em ml sem kg por litro → null (litro nunca vira kg sem o OK do Ivan).
 */
export function fatorDaEmbalagem(i: Pick<ItemCotacao, 'unidade' | 'emb_unidades' | 'emb_gramas' | 'emb_ml' | 'kg_por_litro'>): number | null {
  if (i.unidade === 'un') return i.emb_unidades != null ? Number(i.emb_unidades) : null
  if (i.emb_gramas != null) return Number(i.emb_gramas) / 1000
  if (i.emb_ml != null && i.kg_por_litro != null) return arred((Number(i.emb_ml) / 1000) * Number(i.kg_por_litro), 4)
  return null
}

/** O vendedor disse que tem só parte da quantidade aprovada ("Tenho só", `tenho_so` < qtd; o aviso `parcial`)? */
export const parcial = (i: Pick<ItemCotacao, 'tenho_so' | 'qtd'>) => i.tenho_so != null && Number(i.tenho_so) < Number(i.qtd)

/**
 * Uma linha por item marcado com resposta "tem", na ordem dos números, com a base e o preço da resposta. Embalagem com
 * fator → ⌈qtd ÷ fator⌉ embalagens e a quantidade que elas somam ("108 un no pedido × 104 aprovados"); sem fator,
 * `embalagens` fica null e a tela pede o número de caixas ao Ivan. Demais bases: a quantidade aprovada.
 * Item parcial (D64): começa no que o vendedor tem (`tenho_so`), nunca na aprovada; na embalagem, nas embalagens inteiras
 * que cabem no que ele tem (⌊tenho_so ÷ fator⌋; nenhuma inteira → `embalagens` null e o Ivan digita).
 */
export function montarPedido(itens: ItemCotacao[]): ItemPedidoEntrada[] {
  return itens
    .filter((i) => i.incluido && i.numero != null && i.estado === 'tem' && i.preco_digitado != null && i.base != null)
    .sort((a, b) => (a.numero as number) - (b.numero as number))
    .map((i) => {
      const soParte = parcial(i)
      const alvo = soParte ? Number(i.tenho_so) : Number(i.qtd)
      const linha: ItemPedidoEntrada = {
        numero: i.numero as number, qtd: alvo, base: i.base as BaseCotacao, embalagens: null, fator: null,
        preco_combinado: Number(i.preco_digitado),
      }
      if (i.base !== 'embalagem') return linha
      const fator = fatorDaEmbalagem(i)
      if (fator == null || fator <= 0) return linha
      const embalagens = soParte ? Math.floor(alvo / fator + 1e-9) : embalagensPara(alvo, fator)
      if (embalagens < 1) return { ...linha, fator }
      return { ...linha, embalagens, fator, qtd: arred(embalagens * fator, 4) }
    })
}

/**
 * Itens "tem" com unidade suspeita (o convertido muito longe do último preço, para cima ou para baixo: Δ < −40% ou
 * > +60%, spec 7.3.8): um preço de lata digitado como fardo sai −92% e pareceria economia. O mapa pede "confira" e o
 * Confirmar, o segundo toque de item mudado (D57, D64).
 */
export function unidadeSuspeita(itens: ItemCotacao[]): number[] {
  return itens
    .filter((i) => i.incluido && i.numero != null && i.estado === 'tem' && (i.avisos_ivan ?? []).includes('unidade_suspeita'))
    .map((i) => i.numero as number)
    .sort((a, b) => a - b)
}

/**
 * A quantidade da linha passa de 1,5 × a esperada (D67)? "90" fardos no lugar de "9" iria ao pedido e à economia 10
 * vezes maior, e o banco aceita qualquer inteiro. Esperada = a maior entre a aprovada arredondada para cima (1,2 kg
 * aprovado → 2 kg no pedido é comum), a que o mapa propôs (as embalagens inteiras que cobrem a aprovada: 1 fardo c/12
 * para 2 un não é engano) e o "a partir de" do vendedor (subir até ele para ter o preço é de propósito).
 */
export function quantidadeAlta(qtd: number, i: Pick<ItemCotacao, 'qtd' | 'a_partir_de'>, proposta: number): boolean {
  const esperada = Math.max(Math.ceil(Number(i.qtd) - 1e-9), Number(proposta), i.a_partir_de != null ? Number(i.a_partir_de) : 0)
  return Number(qtd) > arred(esperada * LIMITE_QUANTIDADE, 4)
}

/** Números dos itens "tem" com referência `ok` e Δ acima de +10%: a sugestão "deixar para a loja" (D45). */
export function sugestaoLoja(itens: ItemCotacao[]): number[] {
  return itens
    .filter((i) => i.incluido && i.numero != null && i.estado === 'tem' && i.ref_situacao === 'ok' && i.delta != null &&
      Number(i.delta) > LIMITE_SUGESTAO)
    .map((i) => i.numero as number)
    .sort((a, b) => a - b)
}

type LinhaValor = { base: BaseCotacao; qtd: number; embalagens: number | null; preco_combinado: number; preco_convertido: number | null }

/**
 * Valor da linha em R$: embalagem → embalagens × preço (null sem o número de embalagens); un e kg → qtd × preço;
 * litro → qtd × preço convertido (null quando o litro não tem conversão para kg). Arredonda a 2 casas.
 */
export function valorLinha(l: LinhaValor): number | null {
  if (l.base === 'embalagem') return l.embalagens == null ? null : arred(Number(l.embalagens) * Number(l.preco_combinado), 2)
  if (l.base === 'litro') return l.preco_convertido == null ? null : arred(Number(l.qtd) * Number(l.preco_convertido), 2)
  return arred(Number(l.qtd) * Number(l.preco_combinado), 2)
}

/** Itens + frete. `semTotal` = números das linhas sem valor (litro sem conversão, caixas ainda não digitadas). */
export function totalPedido(linhas: (LinhaValor & { numero: number })[], frete: number | null):
  { itens: number; frete: number; total: number; semTotal: number[] } {
  let itens = 0
  const semTotal: number[] = []
  for (const l of linhas) {
    const v = valorLinha(l)
    if (v == null) semTotal.push(l.numero)
    else itens += v
  }
  itens = arred(itens, 2)
  const f = arred(Number(frete ?? 0), 2)
  return { itens, frete: f, total: arred(itens + f, 2), semTotal: semTotal.sort((a, b) => a - b) }
}

/** Quanto falta para o pedido mínimo, comparando só a mercadoria (sem o frete, D45); null = sem mínimo ou já atingido. */
export function faltaParaMinimo(itens: number, pedidoMinimo: number | null): number | null {
  if (pedidoMinimo == null || Number(pedidoMinimo) === 0) return null
  const falta = arred(Number(pedidoMinimo) - itens, 2)
  return falta > 0 ? falta : null
}
