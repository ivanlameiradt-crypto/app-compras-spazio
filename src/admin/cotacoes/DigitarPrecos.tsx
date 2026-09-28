// "Digitar preços" (spec 8.2, item 5): os mesmos campos da página do vendedor (inclusive a Marca, ajuste Foozi 3), para
// o Ivan transcrever um áudio ou um print. Grava com origem 'ivan_digitou' e manda só o que mudou, cada item com o rev
// que a tela conhece (conflito por item se o vendedor respondeu no meio). O envio_id é reusado só se a gravação falhar
// e o Ivan tentar de novo SEM mudar nada; qualquer edição gera um novo (useEnvioId).
// A base (itens, condições e os revs) fica congelada na abertura: a releitura de 30 s não entra no formulário. Se ela
// entrasse, o que o vendedor mandou com o formulário aberto viraria a base da comparação e iria com o rev novo, e o
// Gravar apagaria a resposta dele sem conflito (a tela continuaria mostrando o valor da abertura).
import { useRef, useState } from 'react'
import * as api from '../../lib/api'
import { lerNumero } from '../../lib/regras'
import type { BaseCotacao, Cotacao, EntradaGerais, EntradaItem, EstadoItemCotacao, ItemCotacao, ResultadoEnvio } from '../../lib/tipos'
import { converter } from '../../cotacao/conversao'
import { numeroBr, peso } from '../../cotacao/mensagens'
import { chaveCot, useCotacoes } from './contexto'
import { comoCotou, reaisPrecisos, TEXTO_ERRO_ITEM, textoAvisoIvan, textoAvisoVendedor } from './formato'

type BaseTela = 'un' | 'emb_un' | 'kg' | 'emb_g' | 'litro' | 'emb_ml'
interface LinhaTela {
  estado: EstadoItemCotacao; preco: string; base: BaseTela; emb: string
  tenhoSo: string; similarDesc: string; similarPreco: string; aPartirDe: string; marca: string
}
interface GeraisTela { pagamento: string; validade: string; pedidoMinimo: string; frete: string; entrega: string; observacao: string }

const virgula = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','))

function baseTelaDe(i: ItemCotacao): BaseTela {
  if (i.base === 'embalagem') return i.unidade === 'un' ? 'emb_un' : i.emb_ml != null ? 'emb_ml' : 'emb_g'
  if (i.base) return i.base
  // sem resposta: como na página, a embalagem confirmada vem marcada; líquido começa pelo litro
  if (i.fator_confirmado && i.fator) return i.unidade === 'un' ? 'emb_un' : 'emb_g'
  return i.unidade === 'un' ? 'un' : i.vende_por_litro ? 'litro' : 'kg'
}
function linhaDe(i: ItemCotacao): LinhaTela {
  const base = baseTelaDe(i)
  const fatorConfirmado = i.fator_confirmado && i.fator ? Number(i.fator) : null
  const emb = base === 'emb_un' ? (i.emb_unidades ?? fatorConfirmado)
    : base === 'emb_g' ? (i.emb_gramas ?? (fatorConfirmado != null ? Math.round(fatorConfirmado * 1000 * 1000) / 1000 : null))
      : base === 'emb_ml' ? i.emb_ml : null
  return {
    estado: i.estado, preco: virgula(i.preco_digitado), base, emb: virgula(emb), tenhoSo: virgula(i.tenho_so),
    similarDesc: i.similar_desc ?? '', similarPreco: virgula(i.similar_preco), aPartirDe: virgula(i.a_partir_de),
    marca: i.marca_informada ?? '',
  }
}

/** Número digitado ("31,50", "R$ 1.234,50"); vazio → null; texto que não é número → NaN (erro na tela). */
const numeroDe = (t: string): number | null => (t.trim() ? (lerNumero(t) ?? Number.NaN) : null)
const textoDe = (t: string) => (t.trim() ? t.trim() : null)

/** A entrada de cot_responder_admin que a linha da tela representa (sem numero/rev). */
function entradaDe(l: LinhaTela, unidade: 'un' | 'kg'): Omit<EntradaItem, 'numero' | 'rev_lida'> {
  if (l.estado === 'sem_resposta') return { estado: 'sem_resposta' }
  const similar = { similar_desc: textoDe(l.similarDesc), similar_preco: numeroDe(l.similarPreco) }
  if (l.estado === 'nao_tem') return { estado: 'nao_tem', ...similar }
  const base: BaseCotacao = l.base.startsWith('emb_') ? 'embalagem' : (l.base as BaseCotacao)
  const emb = numeroDe(l.emb)
  return {
    estado: 'tem', preco: numeroDe(l.preco), base,
    emb_unidades: l.base === 'emb_un' && unidade === 'un' ? emb : null,
    emb_gramas: l.base === 'emb_g' ? emb : null,
    emb_ml: l.base === 'emb_ml' ? emb : null,
    tenho_so: numeroDe(l.tenhoSo), a_partir_de: numeroDe(l.aPartirDe), ...similar, marca: textoDe(l.marca),
  }
}
const assinatura = (e: object) => JSON.stringify(e, Object.keys(e).sort())
const temNaN = (e: object) => Object.values(e).some((v) => typeof v === 'number' && Number.isNaN(v))

function geraisDe(c: Cotacao): GeraisTela {
  return {
    pagamento: c.pagamento ?? '', validade: c.validade ?? '', pedidoMinimo: virgula(c.pedido_minimo), frete: virgula(c.frete),
    entrega: c.entrega ?? '', observacao: c.observacao ?? '',
  }
}
function entradaGerais(g: GeraisTela, rev: number): EntradaGerais {
  return {
    rev_lida: rev, pagamento: textoDe(g.pagamento), validade: textoDe(g.validade), pedido_minimo: numeroDe(g.pedidoMinimo),
    frete: numeroDe(g.frete), entrega: textoDe(g.entrega), observacao: textoDe(g.observacao),
  }
}

/**
 * O envio_id de cada Gravar (spec 9, ENVIAR; contrato 4.9): o mesmo só para repetir um envio sem mudança (a resposta
 * se perdeu na rede e o Ivan toca de novo); conteúdo diferente, id novo. Reusado depois de uma edição, o banco, que já
 * tinha gravado o primeiro, devolveria o resultado dele ("já tinha sido gravado") e a correção nunca seria gravada.
 */
export function useEnvioId(): { para: (conteudo: unknown) => string; esquecer: () => void } {
  const ultimo = useRef<{ id: string; assinatura: string } | null>(null)
  return {
    para: (conteudo) => {
      const assinatura = JSON.stringify(conteudo)
      if (ultimo.current?.assinatura !== assinatura) ultimo.current = { id: crypto.randomUUID(), assinatura }
      return ultimo.current.id
    },
    /** depois de um envio confirmado: o próximo é outro envio, mesmo com o mesmo conteúdo */
    esquecer: () => { ultimo.current = null },
  }
}

/** "Gravado: 3 itens. Não gravado — item 5: mudou antes (agora R$ 8,00 a un)". */
export function resumirResultado(r: ResultadoEnvio, itens: ItemCotacao[]): string {
  const gravados = r.itens.filter((x) => x.resultado === 'gravado').length
  const partes = [`Gravado: ${gravados} ${gravados === 1 ? 'item' : 'itens'}${r.gerais?.resultado === 'gravado' ? ' e as condições' : ''}.`]
  const problemas: string[] = []
  for (const x of r.itens) {
    if (x.resultado === 'conflito') {
      const it = itens.find((i) => i.numero === x.numero)
      const atual = x.valor_atual && it ? comoCotou({ ...it, ...x.valor_atual }) : '?'
      problemas.push(`item ${x.numero}: mudou antes de gravar (agora ${atual})`)
    } else if (x.resultado === 'erro') {
      problemas.push(`item ${x.numero}: ${x.erro ? TEXTO_ERRO_ITEM[x.erro] : 'erro'}`)
    }
  }
  if (r.gerais?.resultado === 'conflito') problemas.push('condições: mudaram antes de gravar')
  if (r.gerais?.resultado === 'erro') problemas.push(`condições: ${r.gerais.erro === 'texto_invalido' ? 'texto inválido' : 'valor inválido'}`)
  if (problemas.length) partes.push(`Não gravado — ${problemas.join('; ')}.`)
  if (r.reenvio) partes.push('(Este envio já tinha sido gravado.)')
  return partes.join(' ')
}

export default function DigitarPrecos({ c, onFechar }: { c: Cotacao; onFechar: () => void }) {
  const ctx = useCotacoes()
  // o que a tela mostrou ao abrir: é contra isto que o Gravar compara, e daqui saem os rev_lida
  const [itens] = useState(() => ctx.itensDe(c.id).filter((i) => i.incluido && i.numero != null))
  const [cotLida] = useState(() => c)
  const [linhas, setLinhas] = useState<Record<number, LinhaTela>>(() => Object.fromEntries(itens.map((i) => [i.id, linhaDe(i)])))
  const [gerais, setGerais] = useState<GeraisTela>(() => geraisDe(cotLida))
  const envioId = useEnvioId()
  const [aviso, setAviso] = useState('')

  const mudar = (id: number, p: Partial<LinhaTela>) => setLinhas((ls) => ({ ...ls, [id]: { ...ls[id], ...p } }))

  async function gravar() {
    const envio: EntradaItem[] = []
    const problemas: string[] = []
    for (const i of itens) {
      const agora = entradaDe(linhas[i.id], i.unidade)
      // (NaN vira null no JSON: o número inválido é checado antes de comparar com o que estava gravado)
      if (temNaN(agora)) { problemas.push(`item ${i.numero}: número inválido`); continue }
      if (assinatura(agora) === assinatura(entradaDe(linhaDe(i), i.unidade))) continue
      const entrada: EntradaItem = { numero: i.numero as number, rev_lida: i.rev, ...agora }
      const conta = converter(i, entrada)
      if (conta.erro) problemas.push(`item ${i.numero}: ${TEXTO_ERRO_ITEM[conta.erro]}`)
      else envio.push(entrada)
    }
    const g = entradaGerais(gerais, cotLida.gerais_rev)
    if (temNaN(g)) problemas.push('condições: número inválido')
    const mudouGerais = assinatura(g) !== assinatura(entradaGerais(geraisDe(cotLida), cotLida.gerais_rev))
    if (problemas.length) { setAviso(problemas.join('; ')); return }
    if (envio.length === 0 && !mudouGerais) { setAviso('Nada mudou.'); return }
    setAviso('')
    const condicoes = mudouGerais ? g : null
    const id = envioId.para({ envio, condicoes })
    await ctx.acao(chaveCot(c), async () => {
      const r = await api.responderComoAdmin(c.id, id, envio, condicoes, 'ivan_digitou')
      ctx.mudarSessao(c.id, { resultado: resumirResultado(r, itens) })
      onFechar()
    })
  }

  return (
    <div className="formulario" data-testid="digitar-precos">
      <div className="nome">Digitar preços — v{c.versao}</div>
      {itens.map((i) => {
        const l = linhas[i.id]
        const entrada: EntradaItem = { numero: i.numero as number, rev_lida: i.rev, ...entradaDe(l, i.unidade) }
        const conta = l.estado === 'tem' && !temNaN(entrada) && entrada.preco != null ? converter(i, entrada) : null
        const opcoes: [BaseTela, string][] = i.unidade === 'un'
          ? [['un', i.rotulo === 'saco' ? '1 saco' : '1 un'], ['emb_un', i.rotulo === 'saco' ? 'fardo com ___ sacos' : 'fardo/caixa com ___ un']]
          : [['kg', '1 kg'], ['emb_g', 'embalagem de ___ g'], ['litro', '1 L'], ['emb_ml', 'embalagem de ___ ml']]
        return (
          <div key={i.id} className="linha-form" role="group" aria-label={`Item ${i.numero}`}>
            <div><b>{i.numero}.</b> {i.nome} <span className="sub">— {numeroBr(i.qtd)} {i.rotulo === 'saco' ? 'sacos' : i.unidade}</span></div>
            <div className="campos">
              <select aria-label={`Resposta do item ${i.numero}`} value={l.estado}
                onChange={(e) => mudar(i.id, { estado: e.target.value as EstadoItemCotacao })}>
                <option value="sem_resposta">— sem resposta</option>
                <option value="tem">tem</option>
                <option value="nao_tem">não tem</option>
              </select>
              {l.estado === 'tem' && (
                <>
                  <input aria-label={`Preço do item ${i.numero}`} inputMode="decimal" placeholder="R$" value={l.preco}
                    onChange={(e) => mudar(i.id, { preco: e.target.value })} />
                  <select aria-label={`Esse preço é de (item ${i.numero})`} value={l.base}
                    onChange={(e) => mudar(i.id, { base: e.target.value as BaseTela, emb: '' })}>
                    {opcoes.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  {l.base.startsWith('emb_') && (
                    <input aria-label={`Quanto vem na embalagem (item ${i.numero})`} inputMode="decimal"
                      placeholder={l.base === 'emb_un' ? 'un' : l.base === 'emb_g' ? 'g' : 'ml'} value={l.emb}
                      onChange={(e) => mudar(i.id, { emb: e.target.value })} />
                  )}
                </>
              )}
            </div>
            {l.estado !== 'sem_resposta' && (
              <details>
                <summary>Mais opções</summary>
                <div className="campos">
                  {l.estado === 'tem' && (
                    <>
                      <label>Tenho só<input inputMode="decimal" value={l.tenhoSo} onChange={(e) => mudar(i.id, { tenhoSo: e.target.value })} /></label>
                      <label>Vale a partir de<input inputMode="decimal" value={l.aPartirDe} onChange={(e) => mudar(i.id, { aPartirDe: e.target.value })} /></label>
                      <label>Marca<input aria-label={`Marca do item ${i.numero}`} maxLength={60} value={l.marca}
                        onChange={(e) => mudar(i.id, { marca: e.target.value })} /></label>
                    </>
                  )}
                  <label>Tenho similar<input value={l.similarDesc} onChange={(e) => mudar(i.id, { similarDesc: e.target.value })} /></label>
                  <label>a R$<input inputMode="decimal" value={l.similarPreco} onChange={(e) => mudar(i.id, { similarPreco: e.target.value })} /></label>
                </div>
              </details>
            )}
            {conta && (
              <div className="sub" data-testid={`conta-${i.numero}`}>
                {conta.erro
                  ? <span className="erro">{TEXTO_ERRO_ITEM[conta.erro]}</span>
                  : conta.preco_convertido != null
                    ? `= ${reaisPrecisos(conta.preco_convertido)}/${i.unidade}${conta.fator_informado != null && i.unidade === 'kg' ? ` (embalagem de ${peso(conta.fator_informado)})` : ''}`
                    : 'sem conversão (preço por litro sem kg por litro confirmado)'}
                {!conta.erro && [...conta.avisos_vendedor.map(textoAvisoVendedor), ...conta.avisos_ivan.map((a) => textoAvisoIvan(a, {
                  ...i, fator_informado: conta.fator_informado, tenho_so: entrada.tenho_so ?? null, a_partir_de: entrada.a_partir_de ?? null,
                  similar_desc: entrada.similar_desc ?? null, similar_preco: entrada.similar_preco ?? null,
                }))].map((t) => <span key={t} className="pill">{t}</span>)}
              </div>
            )}
          </div>
        )
      })}
      <div className="nome" style={{ marginTop: 12 }}>Condições</div>
      <div className="campos">
        <label>Pagamento<input value={gerais.pagamento} onChange={(e) => setGerais({ ...gerais, pagamento: e.target.value })} /></label>
        <label>Preço válido até<input type="date" value={gerais.validade} onChange={(e) => setGerais({ ...gerais, validade: e.target.value })} /></label>
        <label>Pedido mínimo (0 = sem)<input inputMode="decimal" value={gerais.pedidoMinimo} onChange={(e) => setGerais({ ...gerais, pedidoMinimo: e.target.value })} /></label>
        <label>Frete (0 = grátis)<input inputMode="decimal" value={gerais.frete} onChange={(e) => setGerais({ ...gerais, frete: e.target.value })} /></label>
        <label>Entrega<input value={gerais.entrega} onChange={(e) => setGerais({ ...gerais, entrega: e.target.value })} /></label>
        <label>Observação<textarea value={gerais.observacao} onChange={(e) => setGerais({ ...gerais, observacao: e.target.value })} /></label>
      </div>
      {aviso && <p className="erro">{aviso}</p>}
      <div className="acoes">
        <button className="botao" disabled={ctx.ocupado} onClick={gravar}>Gravar preços digitados</button>
        <button className="botao secundario" onClick={onFechar}>Fechar</button>
      </div>
    </div>
  )
}
