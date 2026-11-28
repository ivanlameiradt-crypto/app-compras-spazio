// "Ler boleto pela foto": a Marilane tira a foto do boleto (ou digita o número) e o app preenche vencimento e valor da parcela, sem digitar.
// Pedido do Ivan em 25/11/2026 (notas do MATEUS vêm sem boleto no XML). A foto é lida no próprio aparelho e não é guardada.
import { useEffect, useRef, useState } from 'react'
import LeitorAoVivo from './LeitorAoVivo'
import { lerDigitosDaFoto } from './boletoFoto'
import { lerBoleto, type BoletoLido } from './boletoRegras'

const MSG_NAO_ACHOU = 'Não consegui ler o código de barras nesta foto. Chegue mais perto, deixe o código reto e bem iluminado, ou digite o número do boleto.'

export default function LerBoletoPorFoto({ desabilitado, onBoleto, rotulo = 'Ler código de barras', abrirAgora = false, aoUsar }: {
  desabilitado: boolean
  rotulo?: string
  /** Sequência de boletos (pedido do Ivan, 27/11): quando passa a true, abre o leitor ao vivo sozinho (é a vez deste boleto). */
  abrirAgora?: boolean
  /** Chamado depois que o boleto lido foi aceito (o pai avança para o próximo da sequência). */
  aoUsar?: () => void
  /** Devolve a mensagem para mostrar (sucesso ou aviso) quando o boleto foi usado, ou null se recusou. */
  onBoleto: (b: BoletoLido) => { ok: boolean; texto: string }
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [lendo, setLendo] = useState(false)
  const [digitando, setDigitando] = useState(false)
  const [aoVivo, setAoVivo] = useState(false) // o leitor com a câmera ao vivo é o modo principal; a foto e o número ficam de reserva
  const [numero, setNumero] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  useEffect(() => { if (abrirAgora) { setAviso(null); setAoVivo(true) } }, [abrirAgora])
  const usar = (digitos: string) => {
    const r = lerBoleto(digitos)
    if (!r.ok) { setAviso({ ok: false, texto: r.motivo }); return }
    if (r.boleto.valor == null) { setAviso({ ok: false, texto: 'Este boleto não traz o valor (quem paga escolhe). Digite a parcela à mão.' }); return }
    const resposta = onBoleto(r.boleto)
    setAviso(resposta)
    setNumero('')
    setDigitando(false)
    if (resposta.ok) aoUsar?.()
  }
  const aoEscolherFoto = async (arquivo: File | undefined) => {
    if (!arquivo) return
    setLendo(true)
    setAviso(null)
    try {
      const digitos = await lerDigitosDaFoto(arquivo)
      if (!digitos) setAviso({ ok: false, texto: MSG_NAO_ACHOU })
      else usar(digitos)
    } catch {
      setAviso({ ok: false, texto: MSG_NAO_ACHOU })
    } finally {
      setLendo(false)
      if (entrada.current) entrada.current.value = '' // permite tirar outra foto igual
    }
  }

  return (
    <div className="leitor-boleto" data-testid="leitor-boleto">
      <div className="acoes">
        <button type="button" className="botao" disabled={desabilitado || lendo} onClick={() => { setAviso(null); setAoVivo(true) }} data-testid="boleto-foto-botao">
          {lendo ? 'Lendo a foto…' : rotulo}
        </button>
        <button type="button" className="link" disabled={desabilitado || lendo} onClick={() => entrada.current?.click()} data-testid="boleto-galeria-botao">Usar uma foto do aparelho</button>
        <button type="button" className="link" disabled={desabilitado || lendo} onClick={() => setDigitando((v) => !v)} data-testid="boleto-digitar-botao">
          {digitando ? 'Fechar' : 'Digitar o número do boleto'}
        </button>
      </div>
      <input
        ref={entrada} type="file" accept="image/*" capture="environment" hidden data-testid="boleto-foto-arquivo"
        onChange={(e) => void aoEscolherFoto(e.target.files?.[0])}
      />
      {digitando && (
        <div className="linha-parcela" data-testid="boleto-digitar">
          <label>Número do boleto (47 dígitos)
            <input type="text" inputMode="numeric" autoComplete="off" value={numero} placeholder="Cole ou digite o número abaixo do código de barras" onChange={(e) => setNumero(e.target.value)} />
          </label>
          <button type="button" className="botao secundario" disabled={desabilitado || numero.trim() === ''} onClick={() => usar(numero)}>Usar este número</button>
        </div>
      )}
      {aoVivo && (
        <LeitorAoVivo
          aoLer={(d) => { setAoVivo(false); usar(d) }}
          aoFechar={() => setAoVivo(false)}
          aoDigitar={() => { setAoVivo(false); setDigitando(true) }}
        />
      )}
      {aviso && <p className={aviso.ok ? 'ok' : 'erro'} role="status" data-testid="boleto-aviso">{aviso.texto}</p>}
    </div>
  )
}
