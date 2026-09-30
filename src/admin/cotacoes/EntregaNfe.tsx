// Fase 2, Bloco D (D.7.2): bloco "Entrega e NF-e" no cartão do vendedor com pedido (aba Cotações).
// Entrega prevista, estado do recebimento, a NF-e casada, a conferência, avisar o vendedor e a lista de
// NF-e sem pedido. Lido de cot_conferencia, cot_nfe e cot_desempenho_vendedores.
import { useEffect, useState } from 'react'
import * as api from '../../lib/api'
import type { Desempenho, LinhaConferencia, NfeResumo, Vendedor } from '../../lib/tipos'
import { ddmm, diaCurto, numeroBr, reais, mensagemDiferencaNf } from '../../cotacao/mensagens'

const dataLocal = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

export default function EntregaNfe({ cotacao, vendedor }: { cotacao: number; vendedor: Vendedor }) {
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([])
  const [nfes, setNfes] = useState<NfeResumo[]>([])
  const [semPedido, setSemPedido] = useState<NfeResumo[]>([])
  const [desemp, setDesemp] = useState<Desempenho | null>(null)
  const [erro, setErro] = useState('')

  const carregar = () => {
    setErro('')
    Promise.all([
      api.conferencia([cotacao]), api.nfesDosPedidos([cotacao]),
      api.desempenho(), api.nfesSemPedido(vendedor.id, quinzeDiasAtras()),
    ]).then(([l, n, d, sp]) => {
      setLinhas(l); setNfes(n); setDesemp(d.find((x) => x.vendedor_id === vendedor.id) ?? null); setSemPedido(sp)
    }).catch((e) => setErro(e.message))
  }
  useEffect(carregar, [cotacao, vendedor.id])

  const acao = (p: Promise<unknown>) => p.then(carregar).catch((e) => setErro((e as Error).message))
  const prevista = linhas[0]?.entrega_prevista ?? null
  const pedidoData = linhas[0]?.confirmado_em ? dataLocal(linhas[0].confirmado_em) : ''
  const rotulo = vendedor.empresa.split('(')[0].trim()

  return (
    <div className="entrega-nfe" data-testid="entrega-nfe">
      {desemp && desemp.pedidos > 0 && <p className="desempenho">{textoDesempenho(desemp)}</p>}

      <h4>Entrega</h4>
      <p>
        {prevista ? <>Entrega prevista {diaCurto(prevista)} {ddmm(prevista)} </> : <>Entrega prevista: definir </>}
        <button className="link" onClick={() => {
          const d = window.prompt('Data prevista (AAAA-MM-DD; vazio apaga):', prevista ?? '')
          if (d !== null) acao(api.definirEntrega(cotacao, d.trim() || null))
        }}>{prevista ? 'Mudar' : 'definir'}</button>
      </p>
      <p>{estadoRecebimento(linhas)}</p>

      <h4>NF-e</h4>
      {nfes.length === 0 && <p>NF-e ainda não apareceu.</p>}
      {nfes.map((n) => (
        <p key={n.chave}>
          NF-e {n.numero} · {ddmm(n.emissao)} · {reais(n.valor_nf)} · {textoSituacao(n)}
          {' '}<button className="link" onClick={() => acao(api.vincularNfe(n.chave, null))}>Não é deste pedido</button>
        </p>
      ))}
      <button className="link" onClick={() => acao(api.marcarEntrada(cotacao, true))}>Já entrou no estoque</button>

      {linhas.some((l) => l.nf_chaves.length > 0) && (
        <>
          <h4>Conferência</h4>
          <table className="conferencia">
            <thead><tr><th>nº</th><th>item</th><th>pedido</th><th>NF</th><th>recebido</th><th>situação</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.numero} className={corLinha(l)}>
                  <td>{l.numero}</td><td>{l.nome}</td>
                  <td>{numeroBr(l.qtd)} {l.unidade}{l.combinado_unit != null && <> · {reais(l.combinado_unit)}/{l.unidade}</>}</td>
                  <td>{l.nf_qtd != null ? `${numeroBr(l.nf_qtd)} ${l.unidade}` : '—'}</td>
                  <td>{l.chegou != null ? numeroBr(l.chegou) : '—'}</td>
                  <td>{situacaoLinha(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {temAcima(linhas) && (
            <button className="botao" onClick={() => navigator.clipboard?.writeText(
              mensagemDiferencaNf(rotulo, nfes[0]?.numero ?? '', pedidoData, linhas))}>
              Copiar mensagem de diferença para o {rotulo}
            </button>
          )}
        </>
      )}

      {nfes.length === 0 && semPedido.length > 0 && (
        <div className="sem-pedido">
          <h4>NF-e recentes do {rotulo} sem pedido</h4>
          {semPedido.map((n) => (
            <p key={n.chave}>
              NF {n.numero} · {ddmm(n.emissao)} · {reais(n.valor_nf)} · {n.emitente}
              {' '}<button className="link" onClick={() => acaoVincular(n, cotacao, vendedor.id, acao, setErro, rotulo)}>É deste pedido</button>
            </p>
          ))}
        </div>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}
    </div>
  )
}

function acaoVincular(n: NfeResumo, cotacao: number, vendedorPedidoId: number, acao: (p: Promise<unknown>) => void, setErro: (s: string) => void, rotulo: string) {
  api.vincularNfe(n.chave, cotacao).then(() => acao(Promise.resolve())).catch((e: Error) => {
    if (/outro vendedor/.test(e.message) && n.vendedor_id != null) {
      if (window.confirm(`${e.message}\n\nMover o CNPJ para ${rotulo} e ligar?`)) {
        acao(api.moverCnpj(n.cnpj_emitente, vendedorPedidoId).then(() => api.vincularNfe(n.chave, cotacao)))
      }
    } else {
      setErro(e.message)
    }
  })
}

function quinzeDiasAtras(): string {
  return new Date(Date.now() - 15 * 864e5).toISOString().slice(0, 10)
}
function textoSituacao(n: NfeResumo): string {
  if (n.situacao === 'lancada') return `lançada pelo robô em ${n.lancada_em ? ddmm(dataLocal(n.lancada_em)) : ''}${n.nf_sischef ? ` (NF ${n.nf_sischef})` : ''}`
  if (n.situacao === 'saiu_da_fila') return `saiu da fila em ${n.saiu_da_fila_em ? ddmm(dataLocal(n.saiu_da_fila_em)) : ''}`
  return 'na fila do SisChef, ainda não lançada'
}
function estadoRecebimento(linhas: LinhaConferencia[]): string {
  if (linhas.length === 0) return 'Aguardando entrega'
  const r = linhas[0].recebimento
  if (r === 'aguardando') return 'Aguardando entrega'
  if (r === 'completo') return 'Recebido — completo'
  const falta = linhas.find((l) => (l.falta ?? 0) > 0)
  if (r === 'parcial') return `Recebido em parte: faltam ${falta ? `${numeroBr(falta.falta ?? 0)} ${falta.unidade} de ${falta.nome}` : ''} (ainda vêm)`
  return `Faltou ${falta ? `${numeroBr(falta.falta ?? 0)} ${falta.unidade} de ${falta.nome}` : ''} (não vêm mais) — foi para a loja`
}
function situacaoLinha(l: LinhaConferencia): string {
  if (l.preco === 'sem_nf') return l.chegou != null ? 'recebido' : 'aguardando'
  if (l.preco === 'acima') return `+${reais(l.valor_acima)}`
  if (l.preco === 'abaixo') return 'veio a menos (preço)'
  if (l.preco === 'confira') return 'confira'
  if (l.preco === 'nao_conferivel') return `não conferido: ${l.motivos[0] ?? ''}`
  if (l.qtd_nf === 'a_mais') return 'veio a mais'
  if (l.qtd_nf === 'a_menos') return 'veio a menos'
  if (l.marca_nf === 'confira') return 'marca: confira'
  return 'igual'
}
function corLinha(l: LinhaConferencia): string {
  if (l.preco === 'acima' || l.qtd_nf === 'a_mais') return 'vermelho'
  if (l.preco === 'confira' || l.marca_nf === 'confira') return 'amarelo'
  if (l.preco === 'nao_conferivel') return 'cinza'
  return ''
}
const temAcima = (linhas: LinhaConferencia[]) => linhas.some((l) => l.preco === 'acima')

function textoDesempenho(d: Desempenho): string {
  const prazo = d.atrasados > 0 ? `${d.no_prazo} no prazo, ${d.atrasados} com ${numeroBr(d.atraso_medio_dias)} dia(s) de atraso` : `${d.no_prazo} no prazo`
  let t = `Últimas 8 semanas: ${d.pedidos} pedidos · ${prazo} · ${d.itens_completos} de ${d.itens} itens completos`
  if (d.itens_com_avaria > 0) t += `, ${d.itens_com_avaria} avaria`
  if (d.itens_conferidos > 0) t += ` · preço da NF igual ao combinado em ${d.itens_preco_igual} de ${d.itens_conferidos} itens`
  if (d.itens_acima > 0) t += ` (${d.itens_acima} acima, +${reais(d.valor_acima)})`
  if (d.entregue_nf > 0) t += ` · ${d.entregue_nf} entregues pela NF, sem registro na porta`
  if (d.nao_chegou > 0) t += ` · ${d.nao_chegou} não chegou`
  return t
}
