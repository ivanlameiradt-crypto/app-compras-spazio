// "Com frete / Sem frete" na nota fiscal (pedido do Ivan, 09/10/2026). Sem frete (o padrão): nada a informar. Com frete: o Ivan digita o valor (e o tipo, igual ao SisChef), o
// app mostra a conta (percentual do frete sobre a nota e o preço final de cada produto) e ele CONFIRMA; só então a nota fica pronta para lançar com o frete. O frete forma o
// preço do produto e NUNCA entra no financeiro (o boleto do frete é lançado à mão no SisChef).
import { useMemo, useState } from 'react'
import { formatarReais } from '../lib/regras'
import type { FreteDaNotaConfirmado } from '../lib/tipos'
import { TIPOS_DE_FRETE, TIPO_DE_FRETE_PADRAO, lerFrete, ratearFrete, siglaDaChave, notaDeForaDoPara, type ItemParaRateio } from './freteRegras'

export type FreteConfirmado = FreteDaNotaConfirmado

interface Props {
  chave: string
  /** O valor da nota (para o percentual quando os itens não trazem valor). */
  valorNota: number | null
  /** Os itens da nota com valor e quantidade (na unidade do produto); null = a leitura ainda não trouxe os valores por item. */
  itens: ItemParaRateio[] | null
  /** "Com frete" está escolhido (a nota só pode ser lançada depois de confirmar o frete). Controlado pela nota, que também trava o "Lançar". */
  comFrete: boolean
  aoTrocarModo: (comFrete: boolean) => void
  /** O frete já confirmado desta nota (null = sem frete / ainda não confirmado). */
  confirmado: FreteConfirmado | null
  aoMudar: (frete: FreteConfirmado | null) => void
  desabilitado?: boolean
}

const pct = (v: number): string => `${v.toFixed(2).replace('.', ',')}%`
const unitario = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 })

export default function FreteDaNota({ chave, valorNota, itens, comFrete, aoTrocarModo, confirmado, aoMudar, desabilitado = false }: Props) {
  const [texto, setTexto] = useState(confirmado ? confirmado.valor.toFixed(2).replace('.', ',') : '')
  const [tipo, setTipo] = useState(confirmado?.tipo ?? TIPO_DE_FRETE_PADRAO)
  const [erro, setErro] = useState('')
  const valor = lerFrete(texto)
  const sigla = siglaDaChave(chave)
  const foraDoPara = notaDeForaDoPara(chave)
  const rateio = useMemo(() => (valor !== null && itens ? ratearFrete(itens, valor) : null), [valor, itens])
  const percentual = valor !== null && valorNota ? (valor / valorNota) * 100 : null

  function escolherSem() {
    aoTrocarModo(false); setErro('')
    if (confirmado) aoMudar(null)
  }
  function confirmar() {
    if (valor === null) { setErro('Digite o valor do frete (maior que zero).'); return }
    setErro('')
    aoMudar({ valor, tipo })
  }

  return (
    <div className="frete-nota" data-testid="frete-nota">
      <div className="grupo">Frete</div>
      {foraDoPara && !comFrete && !confirmado && (
        <p className="sub" data-testid="aviso-fora-do-para">Nota de fora do Pará ({sigla}): o frete costuma ser pago à parte, a outra empresa. Esta nota tem frete?</p>
      )}
      <div className="escolha-frete" role="group" aria-label="Esta nota tem frete?">
        <button type="button" className={!comFrete ? 'ativo' : ''} aria-pressed={!comFrete} disabled={desabilitado} onClick={escolherSem} data-testid="sem-frete">Sem frete</button>
        <button type="button" className={comFrete ? 'ativo' : ''} aria-pressed={comFrete} disabled={desabilitado} onClick={() => aoTrocarModo(true)} data-testid="com-frete">Com frete</button>
      </div>

      {comFrete && confirmado && (
        <div className="ok" role="status" data-testid="frete-confirmado">
          ✓ Frete confirmado: <b>{formatarReais(confirmado.valor)}</b>{percentual !== null && <> ({pct(percentual)} da nota)</>}. A nota está pronta para lançar com o frete: o robô põe o valor no pedido e distribui entre os itens.{' '}
          <button type="button" className="link" disabled={desabilitado} onClick={() => aoMudar(null)} data-testid="mudar-frete">Mudar</button>
        </div>
      )}

      {comFrete && !confirmado && (
        <>
          <label>Valor do frete (R$)
            <input type="text" inputMode="decimal" autoComplete="off" placeholder="0,00" value={texto} disabled={desabilitado}
              onChange={(e) => { setTexto(e.target.value); setErro('') }} data-testid="valor-frete" />
          </label>
          <label>Tipo do frete (como no SisChef)
            <select value={tipo} disabled={desabilitado} onChange={(e) => setTipo(e.target.value)} data-testid="tipo-frete">
              {TIPOS_DE_FRETE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
            </select>
          </label>

          {valor !== null && (
            <div className="conta-frete" data-testid="conta-frete">
              {percentual !== null && <p className="sub" data-testid="percentual-frete">O frete representa <b>{pct(percentual)}</b> do valor da nota ({formatarReais(valor)} ÷ {formatarReais(valorNota ?? 0)}).</p>}
              {rateio ? (
                <ul className="conferir-itens" data-testid="rateio-frete">
                  {rateio.itens.map((i, k) => (
                    <li key={k}>
                      <span>{i.descricao}</span>
                      <span className="sub">{i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {i.unidade} · frete deste item {formatarReais(i.frete)}</span>
                      <b>{unitario(i.precoNota)} + {unitario(i.frete / i.quantidade)} = {unitario(i.precoFinal)} por {i.unidade}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sub">O valor de cada item ainda não veio na leitura: o SisChef distribui o frete entre os itens (proporcional ao valor) quando a nota for lançada.</p>
              )}
              <p className="sub" data-testid="frete-fora-do-financeiro">O frete só forma o preço do produto: os boletos continuam com o valor da nota{valorNota != null ? ` (${formatarReais(valorNota)})`: ''}. O boleto do frete é lançado à mão no SisChef.</p>
            </div>
          )}
          <div className="acoes">
            <button type="button" className="botao" disabled={desabilitado || valor === null} onClick={confirmar} data-testid="confirmar-frete">Confirmar frete</button>
          </div>
          {erro && <p className="erro" role="alert" data-testid="erro-frete">{erro}</p>}
        </>
      )}
    </div>
  )
}
