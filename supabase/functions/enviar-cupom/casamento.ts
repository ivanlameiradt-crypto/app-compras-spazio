// supabase/functions/enviar-cupom/casamento.ts
// Casa cada item lido do cupom com um insumo do Sischef — SÓ quando há aprendizado CONFIRMADO. Nunca chuta: item sem
// aprendizado confirmado volta "incerto" (sem id) e vai a REVISAR, com a melhor PROPOSTA (candidato do catálogo pela
// descrição normalizada) só para pré-preencher a correção do Ivan. Puro: o aprendizado entra pronto por parâmetro.
import { normalizar } from './normalizar.ts'
import { CATALOGO } from './catalogo.ts'
import type { ItemLidoIA } from './esquema.ts'
import { entradaEmKg, kgPorUnidadeAbsurdo } from './regraQuilos.ts'

/** Uma linha de cupom_aprendizado (Plano 1). */
export interface Aprendizado {
  codigo_barras: string | null
  emitente_cnpj: string | null
  descricao_norm: string | null
  insumo_id: string
  insumo_nome: string | null
  fator_conversao: number
  unidade_destino: string | null
  confirmado: boolean
}

/** Item no formato do contrato (cupom_contrato): sem sugestao_produto.id ⇒ validar_cupom manda REVISAR. */
export interface ItemCasado {
  sugestao_produto: { id: string } | null
  entrada_estoque: number | null
  /** preço por unidade do ESTOQUE: o do cupom, ou (quando há conversão) o valor da linha ÷ entrada_estoque */
  valor_unitario: number
  desconto_item: number
  descricao_cupom: string
  unidade_cupom: string
  codigo_barras: string | null
  // descritivos (o lançador e validar_cupom ignoram): ajudam a correção por voz
  casado_por: 'ean' | 'descricao' | null
  proposta: { insumo_id: string; insumo_nome: string } | null
  /** A quantidade como está impressa no cupom (na unidade do cupom), também no item incerto: a caixa de correção do app a pré-preenche e
   *  "Ver a foto do cupom" a mostra. Antes (v1) o incerto a perdia e o Ivan tinha de ler o peso de novo na foto. */
  quantidade_cupom: number
}

/** Índice dos aprendizados CONFIRMADOS: por EAN, por `cnpj|descricao_norm` (do fornecedor) e por `descricao_norm` (sinônimo global). */
export function indexarAprendizado(aprendizados: Aprendizado[]): {
  porEan: Map<string, Aprendizado>; porDesc: Map<string, Aprendizado>; porDescGlobal: Map<string, Aprendizado>
} {
  const porEan = new Map<string, Aprendizado>()
  const porDesc = new Map<string, Aprendizado>()
  const porDescGlobal = new Map<string, Aprendizado>()
  for (const a of aprendizados) {
    if (!a.confirmado) continue
    if (a.codigo_barras) porEan.set(a.codigo_barras, a)
    if (a.descricao_norm) {
      // com CNPJ: aprendizado daquele fornecedor. Sem CNPJ: sinônimo global (mesmo produto, descrições de fornecedores diferentes → um insumo).
      if (a.emitente_cnpj) porDesc.set(`${a.emitente_cnpj}|${a.descricao_norm}`, a)
      else porDescGlobal.set(a.descricao_norm, a)
    }
  }
  return { porEan, porDesc, porDescGlobal }
}

/** Melhor candidato do catálogo pela descrição normalizada — SÓ proposta (pré-preenchimento), nunca auto-casa. */
function propor(descricao: string): { insumo_id: string; insumo_nome: string } | null {
  const alvo = normalizar(descricao)
  if (!alvo) return null
  for (const insumo of CATALOGO) if (normalizar(insumo.nome) === alvo) return { insumo_id: insumo.id, insumo_nome: insumo.nome }
  for (const insumo of CATALOGO) {
    const nome = normalizar(insumo.nome)
    if (nome && (nome.startsWith(alvo) || alvo.startsWith(nome))) return { insumo_id: insumo.id, insumo_nome: insumo.nome }
  }
  return null
}

function aplicar(a: Aprendizado, item: ItemLidoIA, por: 'ean' | 'descricao'): ItemCasado {
  // Produto "(KG)": vale a regra do Ivan (08/10) — peso da embalagem no nome × unidades, ou a quantidade do cupom (kg; g ÷ 1.000) — e ela manda
  // sobre um fator guardado de antes (o do iogurte estava em 850, grama por pote, num produto em kg). Sem regra que se aplique, vale o fator confirmado.
  const destinoKg = String(a.unidade_destino ?? '').trim().toLowerCase() === 'kg'
  const regra = destinoKg ? entradaEmKg(item.descricao, item.unidade, item.quantidade) : null
  // Fator que não é número positivo (0, negativo, NaN, nulo) NÃO é um fator confirmado: não vira 1 em silêncio (isso
  // seria chutar a conversão). Vai a REVISAR. Number() porque o PostgREST pode entregar numeric como texto.
  const fatorGuardado = Number(a.fator_conversao)
  if (!regra && (!Number.isFinite(fatorGuardado) || fatorGuardado <= 0)) return incerto(item)
  const entrada = regra ? regra.kg : Number((item.quantidade * fatorGuardado).toFixed(3))
  const fator = regra ? entrada / item.quantidade : fatorGuardado
  // Trava: mais de 50 kg por unidade num produto "(KG)" é número absurdo (850 em vez de 0,85): vai a REVISAR para o Ivan olhar, não ao estoque.
  if (destinoKg && kgPorUnidadeAbsurdo(entrada, item.quantidade)) return incerto(item)
  // Com conversão (fator ≠ 1) o preço acompanha a unidade nova: o robô calcula a linha como entrada_estoque × valor_unitario
  // − desconto_item e a confere contra o valor_a_pagar. Preço do estoque = valor da linha (qtd × preço do cupom) ÷ a entrada
  // JÁ arredondada, assim entrada × preço devolve o valor da linha (5 un × R$ 3, fator 0,08 → 0,4 kg a R$ 37,50/kg, não a
  // R$ 3). NÃO arredonda o preço: o robô arredonda ao digitar. Entrada ≤ 0 não tem preço (dividiria por zero) → incerto.
  let valorUnitario = item.valor_unitario
  if (Math.abs(fator - 1) > 1e-9) {
    if (!(entrada > 0)) return incerto(item)
    valorUnitario = (item.quantidade * item.valor_unitario) / entrada
  }
  return {
    sugestao_produto: { id: a.insumo_id },
    entrada_estoque: entrada,
    valor_unitario: valorUnitario,
    desconto_item: item.desconto ?? 0,
    descricao_cupom: item.descricao,
    unidade_cupom: item.unidade,
    codigo_barras: item.codigo_barras,
    casado_por: por,
    proposta: null,
    quantidade_cupom: item.quantidade,
  }
}

function incerto(item: ItemLidoIA): ItemCasado {
  return {
    sugestao_produto: null,
    entrada_estoque: null,
    valor_unitario: item.valor_unitario,
    desconto_item: item.desconto ?? 0,
    descricao_cupom: item.descricao,
    unidade_cupom: item.unidade,
    codigo_barras: item.codigo_barras,
    casado_por: null,
    proposta: propor(item.descricao),
    quantidade_cupom: item.quantidade,
  }
}

export function casarItem(item: ItemLidoIA, emitenteCnpj: string | null,
  idx: ReturnType<typeof indexarAprendizado>): ItemCasado {
  // 1. EAN confirmado manda.
  if (item.codigo_barras) {
    const porEan = idx.porEan.get(item.codigo_barras)
    if (porEan) return aplicar(porEan, item, 'ean')
  }
  const descNorm = normalizar(item.descricao)
  // cross-check: EAN presente que diverge do aprendizado por descrição → não confia, vai a REVISAR.
  const eanDiverge = (a: Aprendizado) => !!(item.codigo_barras && a.codigo_barras && a.codigo_barras !== item.codigo_barras)
  // 2. (emitente_cnpj, descricao_norm) confirmado daquele fornecedor.
  if (emitenteCnpj) {
    const porDesc = idx.porDesc.get(`${emitenteCnpj}|${descNorm}`)
    if (porDesc) return eanDiverge(porDesc) ? incerto(item) : aplicar(porDesc, item, 'descricao')
  }
  // 2.5. sinônimo global (descricao_norm, qualquer fornecedor) — o aprendizado do próprio fornecedor acima tem precedência.
  const porDescGlobal = idx.porDescGlobal.get(descNorm)
  if (porDescGlobal) return eanDiverge(porDescGlobal) ? incerto(item) : aplicar(porDescGlobal, item, 'descricao')
  // 3. nada confirmado → incerto (REVISAR), com proposta p/ pré-preencher.
  return incerto(item)
}

export function casarItens(itens: ItemLidoIA[], emitenteCnpj: string | null, aprendizados: Aprendizado[]): ItemCasado[] {
  const idx = indexarAprendizado(aprendizados)
  return itens.map((i) => casarItem(i, emitenteCnpj, idx))
}
