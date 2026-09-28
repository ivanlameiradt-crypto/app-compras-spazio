// "Colar resposta" (spec 8.2, item 6): o Ivan cola o texto que o vendedor devolveu no WhatsApp, confere a tabela e só
// então grava (origem 'ivan_colou'). A conferência mostra a linha colada de cada item (com a hora do cabeçalho do
// WhatsApp) ao lado do que foi lido e da resposta gravada inteira. O texto colado é dado: aparece como texto, nunca
// como HTML.
// Gravar por cima troca a resposta inteira (cot_aplicar_resposta): o que o texto não traz ("tem só", "a partir de",
// similar, marca, a confirmação do vendedor) some. Por isso o item que já tem resposta pelo link, ou com algum desses
// campos, fica FORA do Gravar até o Ivan marcar "substituir" naquela linha: o WhatsApp colado pode ser mais velho que a
// resposta do link, e a tela não adivinha qual vale.
import { useMemo, useState } from 'react'
import * as api from '../../lib/api'
import type { Cotacao } from '../../lib/tipos'
import { converter } from '../../cotacao/conversao'
import { lerColagem, type Colagem } from '../../cotacao/leitorTexto'
import { chaveCot, useCotacoes } from './contexto'
import { resumirResultado, useEnvioId } from './DigitarPrecos'
import { colarApagaResposta, comoCotou, cotadoSisChef, respostaGravada, textoAvisoIvan, textoAvisoVendedor } from './formato'

export default function ColarResposta({ c, onFechar }: { c: Cotacao; onFechar: () => void }) {
  const ctx = useCotacoes()
  const itens = useMemo(() => ctx.itensDe(c.id), [ctx, c.id])
  const noEnvio = itens.filter((i) => i.incluido && i.numero != null)
  const [texto, setTexto] = useState('')
  const [lida, setLida] = useState<Colagem | null>(null)
  // os itens em que o Ivan marcou "substituir" (a resposta gravada some e vale a colada); um novo Ler começa sem nenhum
  const [substituir, setSubstituir] = useState<Set<number>>(() => new Set())
  // o mesmo id só para repetir o mesmo conteúdo; um novo Ler com outro texto (ou outros rev), ou outra marca de
  // "substituir", é outro envio
  const envioId = useEnvioId()

  const atual = (numero: number) => noEnvio.find((x) => x.numero === numero)
  // a resposta gravada de agora (a releitura de 30 s entra): a que chegou pelo link depois do Ler também fica protegida
  const protegido = (numero: number) => { const i = atual(numero); return i != null && colarApagaResposta(i) }
  const aGravar = lida ? lida.reconhecidos.filter((e) => !protegido(e.numero) || substituir.has(e.numero)) : []
  const protegidos = lida ? lida.reconhecidos.filter((e) => protegido(e.numero)).length : 0

  function ler() {
    setLida(lerColagem(texto, itens))
    setSubstituir(new Set())
  }

  function marcar(numero: number, sim: boolean) {
    setSubstituir((atuais) => {
      const novo = new Set(atuais)
      if (sim) novo.add(numero)
      else novo.delete(numero)
      return novo
    })
  }

  async function gravar() {
    if (aGravar.length === 0) return
    const envio = aGravar
    const id = envioId.para(envio)
    await ctx.acao(chaveCot(c), async () => {
      const r = await api.responderComoAdmin(c.id, id, envio, null, 'ivan_colou')
      ctx.mudarSessao(c.id, { resultado: resumirResultado(r, itens) })
      onFechar()
    })
  }

  return (
    <div className="formulario" data-testid="colar-resposta">
      <div className="nome">Colar resposta — v{c.versao}</div>
      <p className="sub">Cole a mensagem do vendedor (pode ser a lista inteira com os preços). Vale o número do item, não a ordem das linhas.</p>
      <textarea aria-label="Resposta colada" rows={8} value={texto} onChange={(e) => { setTexto(e.target.value); setLida(null) }} />
      <div className="acoes">
        <button className="botao secundario" disabled={!texto.trim()} onClick={ler}>Ler</button>
        <button className="botao secundario" onClick={onFechar}>Fechar</button>
      </div>
      {lida && (
        <>
          <p data-testid="contagem">
            {lida.reconhecidos.length} de {noEnvio.length} itens reconhecidos
            {lida.naoEntendidas.length > 0 ? '; linhas não entendidas:' : ''}
          </p>
          {lida.naoEntendidas.length > 0 && (
            <ul className="nao-entendidas">{lida.naoEntendidas.map((l, n) => <li key={n}>{l}</li>)}</ul>
          )}
          {lida.foraDaVersao.map((n) => <p key={n} className="erro">item {n} não está na v{c.versao}</p>)}
          {protegidos > 0 && (
            <p className="aviso" data-testid="aviso-substituir">
              {protegidos === 1 ? 'Um item já tem resposta' : `${protegidos} itens já têm resposta`} pelo link ou com "tem só",
              "a partir de", similar ou marca (veja "Antes"). Gravar por cima apaga o que o texto colado não traz: esses itens
              só são gravados se você marcar "substituir".
            </p>
          )}
          {lida.reconhecidos.length > 0 && (
            <div className="rolagem">
              <table className="tabela-cot">
                <thead><tr><th>nº</th><th>Item</th><th>Linha</th><th>Resposta</th><th>Cotado</th><th>Antes</th><th>Avisos</th></tr></thead>
                <tbody>
                  {lida.reconhecidos.map((e) => {
                    const i = atual(e.numero)!
                    const conta = converter(i, e)
                    const como = { ...i, estado: e.estado, preco_digitado: e.preco ?? null, base: e.base ?? null,
                      emb_unidades: e.emb_unidades ?? null, emb_gramas: e.emb_gramas ?? null, emb_ml: e.emb_ml ?? null }
                    const horas = lida.horas[e.numero] ?? []
                    const apaga = colarApagaResposta(i)
                    return (
                      <tr key={e.numero} data-testid={`colar-item-${e.numero}`}>
                        <td>{e.numero}</td>
                        <td>{i.nome}</td>
                        {/* o que o vendedor escreveu, com a hora da mensagem, ao lado do que foi lido: o Ivan confere antes de gravar */}
                        <td data-testid={`linha-colada-${e.numero}`}>
                          {(lida.linhas[e.numero] ?? []).map((l, n) => (
                            <div key={n}>{horas[n] ? <span className="sub">[{horas[n]}] </span> : null}{l}</div>
                          ))}
                        </td>
                        <td>{comoCotou(como)}</td>
                        <td>{cotadoSisChef({ estado: e.estado, preco_convertido: conta.preco_convertido, unidade: i.unidade })}</td>
                        <td data-testid={`antes-${e.numero}`}>{respostaGravada(i, ctx.agora)}</td>
                        <td>
                          {[...conta.avisos_vendedor.map(textoAvisoVendedor), ...conta.avisos_ivan.map((a) => textoAvisoIvan(a, { ...i, fator_informado: conta.fator_informado }))]
                            .map((t) => <span key={t} className="pill">{t}</span>)}
                          {apaga && (
                            <>
                              <span className="pill">{i.origem === 'vendedor' ? 'substitui a resposta do link' : 'substitui a resposta gravada'}</span>
                              <label className="marcar">
                                <input type="checkbox" checked={substituir.has(e.numero)}
                                  aria-label={`Substituir a resposta gravada do item ${e.numero}`}
                                  onChange={(ev) => marcar(e.numero, ev.target.checked)} />
                                substituir
                              </label>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="acoes">
            <button className="botao" disabled={ctx.ocupado || aGravar.length === 0} onClick={gravar}>
              Gravar {aGravar.length} {aGravar.length === 1 ? 'item' : 'itens'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
