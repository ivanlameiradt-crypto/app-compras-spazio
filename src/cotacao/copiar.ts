// "Copiar mensagem" e "Copiar link" (ajuste Foozi 4, contrato 8.3, D46): plano B quando o wa.me abre o WhatsApp errado
// (pessoal em vez do Business) ou quando o Ivan está no WhatsApp Web. Como o window.open, a cópia só vale no próprio
// toque: quem chama faz isso direto no onClick, com o texto já montado e SEM nenhum await antes.

/** Copia o texto. true = copiou; false = o navegador não tem a API ou negou (a tela mostra o texto para copiar à mão). */
export function copiarTexto(texto: string): Promise<boolean> {
  try {
    // primeira linha: nada de await antes, senão o Safari/iOS considera que o toque já passou e nega
    const escrita = navigator.clipboard?.writeText(texto)
    if (!escrita) return Promise.resolve(false)
    return escrita.then(() => true, () => false)
  } catch {
    return Promise.resolve(false)
  }
}
