import { useState } from 'react'

export default function EscolherLoja({ lojas, onEscolher }: { lojas: string[]; onEscolher: (loja: string) => void }) {
  const [nova, setNova] = useState('')
  return (
    <section className="coluna">
      <h2>Em que loja você está?</h2>
      {lojas.map((l) => <button key={l} className="item" onClick={() => onEscolher(l)}>{l}</button>)}
      <form className="coluna" onSubmit={(e) => { e.preventDefault(); if (nova.trim()) onEscolher(nova) }}>
        <input placeholder="Outra loja (digite o nome)" value={nova} onChange={(e) => setNova(e.target.value)} />
        <button className="botao" type="submit" disabled={!nova.trim()}>Começar</button>
      </form>
    </section>
  )
}
