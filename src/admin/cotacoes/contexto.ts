// O que as peças da aba Cotações compartilham: os dados lidos na última atualização, o estado "desta sessão" de cada
// cotação (a mensagem recém-preparada, o link novo, o pedido gravado — o que precisa do segundo toque) e as ações.
import { createContext, useContext } from 'react'
import type {
  Cotacao, DadosEnvio, ItemCotacao, ItemSemana, Pedido, Preparo, ResumoCotacao, Semana, Vendedor,
} from '../../lib/tipos'

export interface Sessao {
  /** Preparar: o que o cot_congelar devolveu, a checagem de saúde ('ok' ou o erro) e se o Ivan já tocou Abrir WhatsApp */
  dados?: DadosEnvio
  saude?: string
  abriu?: boolean
  /** Trocar link: a mensagem 10.5 espera o toque em "Abrir WhatsApp com o link novo" */
  linkNovo?: DadosEnvio
  /** depois do Trocar link: "Limpar respostas do link antigo" (D39) fica aberto até o Ivan fechar */
  limpar?: boolean
  /** Obrigado, desta vez não: a mensagem 10.4 espera o toque */
  obrigado?: boolean
  /** Confirmar pedido: o pedido gravado (a mensagem 10.3 espera o toque) e o campo Entrega da tela */
  pedido?: Pedido
  entrega?: string
  /** resultado do último Digitar/Colar */
  resultado?: string
}

export interface Contexto {
  /** relógio do banco na última atualização (cot_preparar), ou o do aparelho sem semana em compra */
  agora: Date
  /** a data de hoje em Brasília (AAAA-MM-DD), pelo mesmo relógio */
  hoje: string
  semanaEmCompra: Semana | null
  preparo: Preparo | null
  vendedor: (id: number) => Vendedor | undefined
  vendedoresAtivos: Vendedor[]
  itensDe: (cotacaoId: number) => ItemCotacao[]
  resumo: (cotacaoId: number) => ResumoCotacao | undefined
  codigo: (cotacaoId: number) => string | null
  pedido: (cotacaoId: number) => Pedido | null
  itemSemana: (itemSemanaId: number) => ItemSemana | undefined
  /** a versão que esta cotação substituiu (null se não substituiu nenhuma) */
  substituiVersao: (cotacaoId: number) => number | null
  /** "pronta sem sinal de envio" (contrato 3.1, D36) */
  semSinal: (c: Cotacao) => boolean
  /**
   * Preparada NESTE aparelho e a mensagem guardada ainda vale: a cotação continua pronta, o código relido é o da
   * mensagem (Trocar link, ou Desfazer e Preparar, em outro aparelho troca o código e a mensagem daqui morre) e o
   * fechamento ainda não passou (depois dele o vendedor abriria "Cotação encerrada": a aba aberta de um dia para o outro
   * não oferece mais o WhatsApp nem o "Já enviei" dessa mensagem)
   */
  preparadaAqui: (c: Cotacao) => boolean
  /** o mesmo formato de cot_dados_envio, montado das leituras (para os links não precisarem de await) */
  dadosDe: (c: Cotacao) => DadosEnvio | null
  sessao: (cotacaoId: number) => Sessao
  mudarSessao: (cotacaoId: number, s: Partial<Sessao>) => void
  ocupado: boolean
  erro: (chave: string) => string
  /** grava, mostra o erro do banco (se houver) na chave e relê a aba */
  acao: (chave: string, f: () => Promise<void>) => Promise<void>
  preparar: (c: Cotacao) => Promise<void>
  checarDeNovo: (c: Cotacao) => Promise<void>
}

export const ContextoCotacoes = createContext<Contexto | null>(null)

export function useCotacoes(): Contexto {
  const c = useContext(ContextoCotacoes)
  if (!c) throw new Error('fora da aba Cotações')
  return c
}

/** Chave de erro/ocupado de uma cotação. */
export const chaveCot = (c: Pick<Cotacao, 'id'>) => `c${c.id}`
