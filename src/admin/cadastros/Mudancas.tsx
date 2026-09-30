import { useEffect, useState } from 'react'
import { mensagemDeErro } from '../../lib/regras'
import * as cad from '../../cadastros/api'
import { resumoMudanca, type Mudanca } from '../../cadastros/regras'
import { dataHoraBr } from '../../cadastros/textos'
import { usuarioDoEmail } from '../../lib/login'

export default function Mudancas() {
  const [mudancas, setMudancas] = useState<Mudanca[]>([])
  const [erro, setErro] = useState('')
  useEffect(() => { cad.mudancas().then(setMudancas).catch((e) => setErro(mensagemDeErro(e))) }, [])
  return (
    <div className="coluna">
      {erro && <p className="erro">{erro}</p>}
      {mudancas.length === 0 && <p className="sub">Nenhuma mudança ainda.</p>}
      {mudancas.map((m) => (
        <p key={m.id} className="sub linha-mudanca">
          {dataHoraBr(m.quando)} · {usuarioDoEmail(m.quem)} · {resumoMudanca(m)}
        </p>
      ))}
    </div>
  )
}
