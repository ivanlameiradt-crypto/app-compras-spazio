// Os botões que levam a mensagem ao WhatsApp. Nada aqui espera o banco: o link do WhatsApp é um <a> de verdade e a
// cópia acontece no próprio toque (Safari/iOS e o App instalado bloqueiam janela e cópia feitas depois de await).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copiarTexto } from '../../cotacao/copiar'
import { linkWhatsApp } from '../../cotacao/mensagens'

/** Link que abre o WhatsApp com o texto pronto. */
export function LinkWhatsApp({ numero, texto, children, onClick, secundario = false }: {
  numero: string; texto: string; children: ReactNode; onClick?: () => void; secundario?: boolean
}) {
  return (
    <a className={secundario ? 'botao secundario' : 'botao'} href={linkWhatsApp(numero, texto)} target="_blank" rel="noopener"
      onClick={onClick}>{children}</a>
  )
}

/** Plano B da cópia negada: o texto já selecionado, para copiar à mão. */
function TextoParaCopiar({ texto }: { texto: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [texto])
  return (
    <div className="copiar-manual">
      <p className="sub">Copie o texto abaixo (segure e escolha Copiar)</p>
      <textarea ref={ref} readOnly value={texto} rows={Math.min(12, texto.split('\n').length + 1)} aria-label="Texto para copiar" />
    </div>
  )
}

/**
 * "Copiar mensagem" (o mesmo texto do link do WhatsApp) e, onde há cotação aberta ao vendedor, "Copiar link" (a página
 * do vendedor). No pedido e no "Obrigado" não há "Copiar link" (D46): basta não passar `link`.
 */
export function BotoesCopiar({ mensagem, link, onCopiarMensagem }: {
  mensagem: string; link?: string | null; onCopiarMensagem?: () => void
}) {
  const [manual, setManual] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<'' | 'mensagem' | 'link'>('')
  const copiar = (texto: string, qual: 'mensagem' | 'link') => {
    const copia = copiarTexto(texto) // primeiro a cópia, ainda dentro do toque
    if (qual === 'mensagem') onCopiarMensagem?.()
    void copia.then((ok) => {
      setCopiado(ok ? qual : '')
      setManual(ok ? null : texto)
    })
  }
  return (
    <>
      <button type="button" className="botao secundario" onClick={() => copiar(mensagem, 'mensagem')}>Copiar mensagem</button>
      {link && <button type="button" className="botao secundario" onClick={() => copiar(link, 'link')}>Copiar link</button>}
      {copiado && <span className="sub copiado" role="status">{copiado === 'link' ? 'Link copiado.' : 'Mensagem copiada.'}</span>}
      {manual != null && <TextoParaCopiar texto={manual} />}
    </>
  )
}
