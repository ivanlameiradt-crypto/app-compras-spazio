import { get, set } from 'idb-keyval'
import type { Resultado } from './tipos'

/** Operações do comprador que precisam chegar ao servidor mesmo sem internet na hora. */
export type Op =
  | { id: string; tipo: 'abrir_compra'; args: { p_id: string; p_semana: number; p_loja: string } }
  | { id: string; tipo: 'registrar_item'; args: { p_id: string; p_compra: string; p_item: number; p_qtd: number; p_preco: number | null; p_resultado: Resultado } }
  | { id: string; tipo: 'desmarcar_item'; args: { p_compra: string; p_item: number } }
  | { id: string; tipo: 'fechar_compra'; args: { p_compra: string; p_com_nota: boolean; p_total: number; p_foto: string | null }; foto?: FotoGuardada }
  | { id: string; tipo: 'cancelar_compra'; args: { p_compra: string } }

/** Foto guardada como bytes: ArrayBuffer atravessa o IndexedDB em qualquer navegador. */
export interface FotoGuardada { dados: ArrayBuffer; tipo: string }

export interface ErroFila { op: Op; mensagem: string; quando: string }

export class ErroRede extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroRede'
  }
}

/**
 * Rede caída, sessão vencida, servidor sobrecarregado ou aparelho offline → tentar de novo depois
 * (não descartar). Usa o status HTTP e o código do PostgREST quando o erro traz (`ErroApi`); regra
 * de negócio das nossas funções (P0001) e demais 4xx são definitivos.
 */
export function ehErroTemporario(e: unknown, online = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  if (!online) return true
  const { status, code } = (typeof e === 'object' && e !== null ? e : {}) as { status?: unknown; code?: unknown }
  if (code === 'P0001') return false
  if (typeof code === 'string' && code.startsWith('PGRST30')) return true // JWT vencido/inválido, sem login
  if (typeof status === 'number') {
    if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return true
    if (status >= 400) return false
  }
  const msg = e instanceof Error ? e.message : String(e)
  return /failed to fetch|network|load failed|timeout|jwt|token|401/i.test(msg)
}

const CHAVE = 'fila'
const CHAVE_ERROS = 'fila-erros'

const ouvintes = new Set<() => void>()
export function ouvir(f: () => void): () => void {
  ouvintes.add(f)
  return () => { ouvintes.delete(f) }
}
function avisar() { ouvintes.forEach((f) => f()) }

let trava: Promise<unknown> = Promise.resolve()
function exclusivo<T>(f: () => Promise<T>): Promise<T> {
  const p = trava.then(f, f)
  trava = p.catch(() => undefined)
  return p
}

export async function pendentes(): Promise<Op[]> {
  return (await get<Op[]>(CHAVE)) ?? []
}

export async function enfileirar(op: Op): Promise<void> {
  await exclusivo(async () => {
    const fila = await pendentes()
    if (!fila.some((o) => o.id === op.id)) fila.push(op)
    await set(CHAVE, fila)
  })
  avisar()
}

export async function errosDaFila(): Promise<ErroFila[]> {
  return (await get<ErroFila[]>(CHAVE_ERROS)) ?? []
}

export async function limparErros(): Promise<void> {
  await exclusivo(() => set(CHAVE_ERROS, []))
  avisar()
}

/** "Tentar de novo": as operações com erro voltam para a frente da fila, na ordem em que foram feitas. */
export async function reenfileirarErros(): Promise<void> {
  await exclusivo(async () => {
    const fila = await pendentes()
    const voltam = (await errosDaFila()).map((e) => e.op).filter((op) => !fila.some((o) => o.id === op.id))
    await set(CHAVE, [...voltam, ...fila])
    await set(CHAVE_ERROS, [])
  })
  avisar()
}

/** Só um processamento por vez: uma segunda chamada entra na carona da que já está rodando. */
let emAndamento: Promise<{ enviadas: number; erros: number }> | null = null

/**
 * Manda a fila pro servidor. O `exec` (rede) roda FORA do cadeado de armazenamento —
 * senão um `enfileirar` no meio de um envio lento ficaria travado esperando.
 */
export function processar(exec: (op: Op) => Promise<void>): Promise<{ enviadas: number; erros: number }> {
  if (!emAndamento) emAndamento = executarFila(exec).finally(() => { emAndamento = null })
  return emAndamento
}

async function retirar(id: string): Promise<void> {
  await set(CHAVE, (await pendentes()).filter((o) => o.id !== id))
}

async function executarFila(exec: (op: Op) => Promise<void>): Promise<{ enviadas: number; erros: number }> {
  let enviadas = 0
  let erros = 0
  for (;;) {
    const op = await exclusivo(async () => (await pendentes())[0] ?? null)
    if (!op) break
    try {
      await exec(op)
      enviadas++
      await exclusivo(() => retirar(op.id))
    } catch (e) {
      if (e instanceof ErroRede) break
      erros++
      await exclusivo(async () => {
        const lista = await errosDaFila()
        // guarda a operação inteira (inclusive a foto): o comprador pode mandar tentar de novo
        lista.push({ op, mensagem: e instanceof Error ? e.message : String(e), quando: new Date().toISOString() })
        await set(CHAVE_ERROS, lista)
        await retirar(op.id)
      })
    }
  }
  avisar()
  return { enviadas, erros }
}
