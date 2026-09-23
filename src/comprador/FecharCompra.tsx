import { useState } from 'react'
import { formatarReais, lerNumero } from '../lib/regras'
import { reduzirFoto } from '../lib/foto'

export default function FecharCompra({ loja, totalSugerido, onConfirmar, onVoltar }: {
  loja: string
  totalSugerido: number
  onConfirmar: (comNota: boolean, total: number, foto: Blob | null) => void
  onVoltar: () => void
}) {
  const [comNota, setComNota] = useState<boolean | null>(null)
  const [total, setTotal] = useState(totalSugerido.toFixed(2).replace('.', ','))
  const [foto, setFoto] = useState<Blob | null>(null)
  const [processandoFoto, setProcessandoFoto] = useState(false)
  const [erro, setErro] = useState('')

  function enviar() {
    const t = lerNumero(total)
    if (t === null) return setErro('Informe o total pago.')
    if (comNota === null) return setErro('Diga se a compra foi com nota ou sem nota.')
    onConfirmar(comNota, t, foto)
  }

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) { setFoto(null); return }
    setProcessandoFoto(true)
    try {
      setFoto(await reduzirFoto(arquivo))
    } finally {
      setProcessandoFoto(false)
    }
  }

  return (
    <section className="coluna">
      <h2>Fechar compra — {loja}</h2>
      <fieldset className="coluna" style={{ border: 0, padding: 0 }}>
        <label style={{ flexDirection: 'row', gap: 8 }}><input type="radio" name="nota" checked={comNota === true} onChange={() => setComNota(true)} />Com nota</label>
        <label style={{ flexDirection: 'row', gap: 8 }}><input type="radio" name="nota" checked={comNota === false} onChange={() => setComNota(false)} />Sem nota</label>
      </fieldset>
      <label>Total pago<input aria-label="Total pago" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      {lerNumero(total) !== null && <p className="sub">= {formatarReais(lerNumero(total)!)}</p>}
      <label>
        Foto do cupom (opcional)
        <input type="file" accept="image/*" capture="environment"
          onChange={(e) => { void escolherFoto(e.target.files?.[0]) }} />
      </label>
      {processandoFoto && <p className="sub">Preparando foto…</p>}
      {erro && <p className="erro">{erro}</p>}
      <button className="botao" disabled={comNota === null || processandoFoto} onClick={enviar}>Enviar para aprovação</button>
      <button className="link" onClick={onVoltar}>Voltar para a lista</button>
    </section>
  )
}
