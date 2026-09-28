// "Limpar respostas do link antigo" (spec 7.3.3; contrato 4.8 e 8.3, D39), logo depois do "Trocar link": o banco não
// sabe quando o link vazou, então quem escolhe o que apagar é o Ivan. A lista traz as respostas que vieram pelo link
// (origem vendedor), todas DESMARCADAS; o que ele marcar volta a "sem resposta" por cot_responder_admin.
// Cada caixa guarda o rev de QUANDO foi marcada (e a das condições, o gerais_rev): a lista é relida a cada 30 s, e se o
// vendedor responder pelo link novo depois da marca, o Limpar volta como "conflito" em vez de apagar a resposta nova.
import { useState } from 'react'
import * as api from '../../lib/api'
import type { Cotacao, EntradaGerais, EntradaItem } from '../../lib/tipos'
import { chaveCot, useCotacoes } from './contexto'
import { resumirResultado, useEnvioId } from './DigitarPrecos'
import { comoCotou, quando } from './formato'

export default function LimparRespostas({ c }: { c: Cotacao }) {
  const ctx = useCotacoes()
  const doLink = ctx.itensDe(c.id).filter((i) => i.incluido && i.numero != null && i.origem === 'vendedor')
  const geraisDoLink = c.gerais_origem === 'vendedor'
  /** id do item → rev dele quando o Ivan marcou */
  const [marcados, setMarcados] = useState<Map<number, number>>(() => new Map())
  /** gerais_rev quando o Ivan marcou "condições gerais" (null = desmarcada) */
  const [geraisRev, setGeraisRev] = useState<number | null>(null)
  // o mesmo envio_id numa nova tentativa sem mudança depois de falha de rede (sem duplicar); marcou outra coisa (ou
  // depois de cada gravação, que zera as marcas), um novo
  const envioId = useEnvioId()
  const fechar = () => ctx.mudarSessao(c.id, { limpar: false })

  const alternar = (i: { id: number; rev: number }) => setMarcados((m) => {
    const novo = new Map(m)
    if (novo.has(i.id)) novo.delete(i.id)
    else novo.set(i.id, i.rev)
    return novo
  })

  async function limpar() {
    const itens: EntradaItem[] = doLink.filter((i) => marcados.has(i.id))
      .map((i) => ({ numero: i.numero as number, rev_lida: marcados.get(i.id) as number, estado: 'sem_resposta' }))
    const condicoes: EntradaGerais | null = geraisRev != null && geraisDoLink
      ? { rev_lida: geraisRev, pagamento: null, validade: null, pedido_minimo: null, frete: null, entrega: null, observacao: null }
      : null
    if (itens.length === 0 && !condicoes) return
    const id = envioId.para({ itens, condicoes })
    await ctx.acao(chaveCot(c), async () => {
      const r = await api.responderComoAdmin(c.id, id, itens, condicoes, 'ivan_digitou')
      envioId.esquecer()
      setMarcados(new Map())
      setGeraisRev(null)
      // conflito (o vendedor mandou de novo no meio): a aba relê e a lista mostra o valor atual para o Ivan decidir
      ctx.mudarSessao(c.id, { resultado: resumirResultado(r, ctx.itensDe(c.id)) })
    })
  }

  const nada = marcados.size === 0 && geraisRev == null
  return (
    <div className="formulario" data-testid="limpar-respostas">
      <p className="aviso">Se o link antigo foi usado por outra pessoa, marque as respostas que não são do vendedor e limpe.</p>
      {doLink.length === 0 && !geraisDoLink && <p className="sub">Nenhuma resposta veio pelo link.</p>}
      {doLink.map((i) => (
        <label key={i.id} className="marcar">
          <input type="checkbox" checked={marcados.has(i.id)} onChange={() => alternar(i)}
            aria-label={`Limpar item ${i.numero}`} />
          <span>
            <b>{i.numero}.</b> {i.nome} — {comoCotou(i)}{i.respondido_em ? ` — ${quando(i.respondido_em, ctx.agora)}` : ''}
          </span>
        </label>
      ))}
      {geraisDoLink && (
        <label className="marcar">
          <input type="checkbox" checked={geraisRev != null} onChange={() => setGeraisRev((g) => (g == null ? c.gerais_rev : null))}
            aria-label="Limpar condições gerais" />
          <span>condições gerais</span>
        </label>
      )}
      <div className="acoes">
        <button className="botao" disabled={ctx.ocupado || nada} onClick={limpar}>Limpar respostas do link antigo</button>
        <button className="botao secundario" onClick={fechar}>Fechar</button>
      </div>
    </div>
  )
}
