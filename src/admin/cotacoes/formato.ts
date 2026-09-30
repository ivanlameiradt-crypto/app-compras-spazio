// Textos da aba Cotações (só para o Ivan). Tudo que veio do vendedor entra como texto do React (escapado), nunca HTML.
import type {
  AvisoIvan, AvisoVendedor, Cotacao, ErroItem, ItemCotacao, MotivoSemVendedor, OrigemResposta, ResumoCotacao,
} from '../../lib/tipos'
import { ddmm, horaBr, horaLocal, numeroBr, peso, reais } from '../../cotacao/mensagens'

export function rotuloStatus(c: Pick<Cotacao, 'status' | 'resultado'>): string {
  if (c.status === 'fechada') return c.resultado === 'pedido' ? 'Pedido confirmado' : c.resultado === 'dispensado' ? 'Dispensada' : 'Fechada'
  return {
    rascunho: 'Rascunho', pronta: 'Preparada', enviada: 'Enviada', respondida: 'Respondida', substituida: 'Substituída',
    cancelada: 'Cancelada', liberada: 'Comprar na loja nesta semana',
  }[c.status]
}

/** "+55 91 9…": o suficiente para o Ivan conferir que é o número certo, sem o telefone inteiro na tela. */
export const telefoneCurto = (w: string) => `+${w.slice(0, 2)} ${w.slice(2, 4)} ${w.slice(4, 5)}…`

/** Carimbo → "15h42" (hoje) ou "23/09 às 15h42". */
export function quando(iso: string, agora: Date): string {
  const l = horaLocal(iso)
  return l.data === horaLocal(agora).data ? `às ${horaBr(l)}` : `em ${ddmm(l.data)} às ${horaBr(l)}`
}

export function situacaoCotacao(c: Cotacao, r: ResumoCotacao | undefined, agora: Date): string {
  const partes: string[] = []
  if (r) partes.push(`${r.respondidos} de ${r.itens} respondidos`)
  const respondeu = (r?.respondidos ?? 0) > 0 || r?.gerais_respondidas
  if (c.primeiro_acesso) partes.push(`link aberto ${quando(c.ultimo_acesso ?? c.primeiro_acesso, agora)}${respondeu ? '' : ' (pode ter sido você)'}`)
  else if (c.status !== 'fechada') partes.push('link ainda não aberto')
  return partes.join(' · ')
}

/**
 * A pergunta do "Cancelar cotação". A cancelada some da tela com as respostas dela, e a versão que o cot_preparar cria
 * depois começa vazia (o cot_congelar só copia as respostas da versão viva): com resposta, ou quando ela já substituiu
 * outra versão (o link antigo do vendedor passa a dizer "cancelada"), a pergunta diz o que se perde e, onde há o botão
 * (`novaVersao`), aponta a Nova versão, que muda os itens sem perder nada.
 */
export function perguntaCancelar(versao: number, rotulo: string, o: {
  respondidos: number; condicoes: boolean; substituiVersao: number | null; novaVersao: boolean
}): string {
  const linkAntigo = o.substituiVersao != null ? ` (e o da v${o.substituiVersao}, que o vendedor já tem, também)` : ''
  const pergunta = `Cancelar a cotação v${versao} de ${rotulo}? O link deixa de abrir a lista${linkAntigo}.`
  const perde = o.respondidos > 1 ? `As ${o.respondidos} respostas desta cotação somem da tela e não dá mais para fazer pedido com elas.`
    : o.respondidos === 1 ? 'A resposta desta cotação some da tela e não dá mais para fazer pedido com ela.'
      : o.condicoes ? 'As condições que o vendedor mandou somem da tela.' : ''
  if (!perde && o.substituiVersao == null) return pergunta
  const caminho = !o.novaVersao ? '' : perde ? 'Para mudar os itens sem perder as respostas, use Nova versão.' : 'Para mudar os itens, use Nova versão.'
  return [pergunta, [perde, caminho].filter(Boolean).join(' '), 'Cancelar assim mesmo?'].filter(Boolean).join('\n\n')
}

export function textoPrazo(c: Pick<Cotacao, 'prazo' | 'fechamento'>): string {
  if (!c.prazo || !c.fechamento) return ''
  const p = horaLocal(c.prazo)
  const f = horaLocal(c.fechamento)
  return `Prazo ${ddmm(p.data)} ${horaBr(p)} · fecha ${f.data === p.data ? '' : `${ddmm(f.data)} `}${horaBr(f)}`
}

/** Como o vendedor cotou, na base dele: "R$ 42,00 fardo c/12", "R$ 12,40 pacote 400 g", "R$ 6,00 o litro". */
export function comoCotou(i: Pick<ItemCotacao, 'estado' | 'preco_digitado' | 'base' | 'emb_unidades' | 'emb_gramas' | 'emb_ml' |
  'similar_desc' | 'similar_preco' | 'rotulo' | 'embalagem'>): string {
  if (i.estado === 'nao_tem') return 'não tem'
  if (i.estado !== 'tem' || i.preco_digitado == null) return '—'
  const p = reais(Number(i.preco_digitado))
  switch (i.base) {
    case 'un': return i.rotulo === 'saco' ? `${p} o saco` : `${p} a un`
    case 'kg': return `${p} o kg`
    case 'litro': return `${p} o litro`
    case 'embalagem': {
      const nome = i.embalagem ?? 'embalagem'
      if (i.emb_unidades != null) return `${p} ${nome} c/${numeroBr(Number(i.emb_unidades))}`
      if (i.emb_gramas != null) return `${p} ${nome} ${peso(Number(i.emb_gramas) / 1000)}`
      if (i.emb_ml != null) return `${p} ${nome} ${numeroBr(Number(i.emb_ml))} ml`
      return `${p} ${nome}`
    }
    default: return p
  }
}

/**
 * A resposta gravada inteira, para o "Antes" do "Colar resposta": além do preço e da base, o que um envio sem esses
 * campos apaga ("tem só", "a partir de", similar, marca, a confirmação do vendedor) e de onde e quando veio: "R$ 3,20 o
 * kg · tem só 3 kg · preço a partir de 10 kg · marca X · pelo link às 15h". Sem resposta → ''.
 */
export function respostaGravada(i: ItemCotacao, agora: Date): string {
  if (i.estado === 'sem_resposta') return ''
  const partes = [comoCotou(i)]
  if (i.estado === 'tem' && i.tenho_so != null) partes.push(textoAvisoIvan('parcial', i))
  if (i.estado === 'tem' && i.a_partir_de != null) partes.push(textoAvisoIvan('a_partir_de', i))
  if (i.similar_desc != null || i.similar_preco != null) partes.push(textoAvisoIvan('similar', i))
  if (i.marca_informada) partes.push(`marca ${i.marca_informada}`)
  if (i.confirmado_pelo_vendedor) partes.push('vendedor confirmou')
  if (i.origem) {
    const de = { vendedor: 'pelo link', ivan_digitou: 'digitado', ivan_colou: 'colado', ivan_ia: 'lido pela IA' }[i.origem]
    const copiada = i.copiada_da_versao != null ? ` (da v${i.copiada_da_versao})` : ''
    partes.push(`${de}${copiada}${i.respondido_em ? ` ${quando(i.respondido_em, agora)}` : ''}`)
  }
  return partes.join(' · ')
}

/**
 * Gravar por cima desta resposta apaga o que um texto colado nunca traz: a resposta veio pelo link (o vendedor pode ter
 * marcado "tem só", "a partir de", similar, marca ou confirmado) ou tem algum desses campos. O "Colar resposta" deixa
 * esse item fora do Gravar até o Ivan marcar "substituir".
 */
export const colarApagaResposta = (i: ItemCotacao) => i.estado !== 'sem_resposta' && (
  i.origem === 'vendedor' || i.tenho_so != null || i.a_partir_de != null || i.similar_desc != null ||
  i.similar_preco != null || i.marca_informada != null || i.confirmado_pelo_vendedor)

/** Preço convertido na unidade do SisChef: "R$ 2,6250/un"; null → "sem conversão". */
export function cotadoSisChef(i: Pick<ItemCotacao, 'estado' | 'preco_convertido' | 'unidade'>): string {
  if (i.estado !== 'tem') return '—'
  if (i.preco_convertido == null) return 'sem conversão'
  return `${reaisPrecisos(Number(i.preco_convertido))}/${i.unidade}`
}
/** Até 4 casas, sem zeros à toa além dos centavos: 2,625 → "R$ 2,625"; 31 → "R$ 31,00". */
export const reaisPrecisos = (v: number) =>
  `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`

/** Δ% do cotado contra o último preço (spec 7.3.8): vermelho acima de +10%, verde abaixo de −5%, cinza quando antiga. */
export function delta(i: Pick<ItemCotacao, 'delta' | 'ref_situacao' | 'ref_data'>): { texto: string; classe: string } {
  if (i.delta == null || !(i.ref_situacao === 'ok' || i.ref_situacao === 'antiga')) return { texto: '—', classe: 'delta' }
  const pct = Math.round(Number(i.delta) * 100)
  const texto = `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`
  if (i.ref_situacao === 'antiga') return { texto: `${texto} (ref. ${i.ref_data ? ddmm(i.ref_data) : 'antiga'})`, classe: 'delta antiga' }
  if (Number(i.delta) > 0.1) return { texto, classe: 'delta sobe' }
  if (Number(i.delta) < -0.05) return { texto, classe: 'delta desce' }
  return { texto, classe: 'delta' }
}

export function referencia(i: Pick<ItemCotacao, 'ref_preco' | 'ref_data' | 'ref_situacao'>): string {
  if (i.ref_situacao === 'sem_referencia' || i.ref_preco == null) return 'sem referência'
  return `${reaisPrecisos(Number(i.ref_preco))}${i.ref_data ? ` (${ddmm(i.ref_data)})` : ''}${i.ref_situacao === 'antiga' ? ' antiga' : ''}`
}

export function textoOrigem(origem: OrigemResposta | null, copiada: number | null): string {
  if (!origem) return ''
  const t = { vendedor: 'link', ivan_digitou: 'digitado', ivan_colou: 'colado', ivan_ia: 'IA' }[origem]
  return copiada != null ? `${t} (da v${copiada})` : t
}

export function textoAvisoIvan(a: AvisoIvan, i: ItemCotacao): string {
  switch (a) {
    case 'unidade_suspeita': return 'unidade suspeita: muito longe do último preço'
    case 'acima_500_sem_ref': return 'acima de R$ 500 sem referência'
    case 'fator_nao_confirmado': return i.fator_informado == null ? 'embalagem não confirmada no cadastro'
      : i.unidade === 'un' ? `embalagem c/${numeroBr(Number(i.fator_informado))} não confirmada no cadastro`
        : `embalagem de ${peso(Number(i.fator_informado))} não confirmada no cadastro`
    case 'litro_sem_fator': return 'cotado por litro; confirme quanto 1 L vale em kg'
    case 'parcial': return `tem só ${numeroBr(Number(i.tenho_so))} ${i.unidade}`
    case 'similar': return `similar: ${i.similar_desc ?? ''}${i.similar_preco != null ? ` a ${reais(Number(i.similar_preco))}` : ''}`
    case 'a_partir_de': return `preço a partir de ${numeroBr(Number(i.a_partir_de))} ${i.unidade}`
    default: return a
  }
}
export function textoAvisoVendedor(a: AvisoVendedor): string {
  return { centavos: 'confira: centavos?', valor_alto: 'confira: valor alto', fator_diferente: 'confira: embalagem diferente do cadastro' }[a] ?? a
}

export const TEXTO_ERRO_ITEM: Record<ErroItem, string> = {
  numero_inexistente: 'número não existe nesta versão',
  sem_preco: 'falta o preço',
  sem_embalagem: 'falta dizer quanto vem na embalagem',
  valor_invalido: 'valor fora dos limites (preço com no máximo 2 casas)',
  base_incompativel: 'unidade não combina com o item',
  texto_invalido: 'texto inválido',
}

export function textoMotivo(motivo: MotivoSemVendedor, fornecedor: string | null, vendedorInativo: string | null): string {
  if (motivo === 'nunca_comprado') return 'nunca comprado'
  if (motivo === 'fornecedor_sem_vendedor') return `fornecedor sem vendedor cadastrado: ${fornecedor ?? '?'}`
  return `vendedor inativo${vendedorInativo ? `: ${vendedorInativo}` : ''}`
}

/** "104 un → 9 fardos c/12 (108 un)" quando a embalagem está confirmada no cadastro. */
export function dicaEmbalagem(i: Pick<ItemCotacao, 'qtd' | 'unidade' | 'rotulo' | 'embalagem' | 'fator' | 'fator_confirmado'>): string {
  const base = i.rotulo === 'saco' ? `${numeroBr(i.qtd)} ${Number(i.qtd) === 1 ? 'saco' : 'sacos'}` : `${numeroBr(i.qtd)} ${i.unidade}`
  if (!i.fator_confirmado || !i.fator || !i.embalagem) return base
  const n = Math.ceil(Number(i.qtd) / Number(i.fator) - 1e-9)
  const plural = { fardo: 'fardos', caixa: 'caixas', pacote: 'pacotes', saco: 'sacos' }[i.embalagem]
  const nome = n === 1 ? i.embalagem : plural
  const total = numeroBr(Math.round(n * Number(i.fator) * 1000) / 1000)
  return i.unidade === 'un'
    ? `${base} → ${n} ${nome} c/${numeroBr(Number(i.fator))} (${total} ${i.rotulo === 'saco' ? 'sacos' : 'un'})`
    : `${base} → ${n} ${nome} de ${peso(Number(i.fator))} (${total} kg)`
}
