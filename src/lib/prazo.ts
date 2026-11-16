// Tempo limite das chamadas ao servidor (pedido do Ivan, 16/11/2026, depois da análise do app).
// Sem ele, com a internet "pendurada" (4G fraco, sem erro nem resposta), os botões ficavam em "Enviando…" por minutos, até o navegador desistir.
// Aqui cada tipo de chamada tem o seu prazo; passou dele, a chamada é cancelada com um TimeoutError e a tela mostra a mensagem de "sem resposta"
// (api.ts: TEXTO_SEM_RESPOSTA), que manda CONFERIR antes de repetir: o servidor pode ter feito o trabalho mesmo sem a resposta ter voltado
// (as funções são feitas para isso: reserva da nota, envio_id da compra avulsa e foto_path do cupom impedem o lançamento em dobro).
// O relógio vale só até chegar o começo da resposta; ler um corpo já iniciado não é cortado.

export const PRAZO_PADRAO_MS = 30_000

/** O primeiro trecho que aparecer na URL decide o prazo (do mais específico para o mais geral). */
const PRAZOS: ReadonlyArray<readonly [string, number]> = [
  ['/functions/v1/cot-ler-resposta', 130_000], // leitura com IA: o servidor tem até 110 s
  ['/functions/v1/lancar-nfe', 60_000], // a "verificação" do robô consulta o GitHub várias vezes
  ['/functions/v1/', 45_000], // as demais funções (GitHub 20 s, consulta de CNPJ em 3 sites de 8 s)
  ['/storage/v1/object/', 90_000], // envio da foto do cupom com internet fraca
]

export function prazoDe(url: string): number {
  for (const [trecho, ms] of PRAZOS) if (url.includes(trecho)) return ms
  return PRAZO_PADRAO_MS
}

function urlDe(entrada: RequestInfo | URL): string {
  if (typeof entrada === 'string') return entrada
  if (entrada instanceof URL) return entrada.href
  return entrada.url
}

/**
 * Envolve um `fetch` com o prazo da chamada. Quem chamou ainda pode cancelar pelo sinal dele. A mensagem do erro traz "timeout" de propósito:
 * a fila offline (fila.ts, ehErroTemporario) reconhece a palavra e tenta de novo depois.
 */
export function comPrazo(base: typeof fetch = (entrada, init) => fetch(entrada, init)): typeof fetch {
  return (entrada, init) => {
    const ms = prazoDe(urlDe(entrada))
    const controle = new AbortController()
    const dono = init?.signal ?? (typeof Request !== 'undefined' && entrada instanceof Request ? entrada.signal : undefined)
    const repassar = () => controle.abort(dono?.reason)
    if (dono?.aborted) repassar()
    else dono?.addEventListener('abort', repassar, { once: true })
    const relogio = setTimeout(
      // o nome é 'AbortError' DE PROPÓSITO: o cliente do banco (postgrest-js) repete sozinho até 3 vezes a leitura que falha por rede, mas nunca a que foi
      // abortada (AbortError); com outro nome, uma leitura pendurada esperaria 4 × 30 s em vez de 30 s
      () => controle.abort(new DOMException(`timeout: o servidor não respondeu em ${Math.round(ms / 1000)} s`, 'AbortError')),
      ms,
    )
    return base(entrada, { ...init, signal: controle.signal }).finally(() => {
      clearTimeout(relogio)
      dono?.removeEventListener('abort', repassar)
    })
  }
}
