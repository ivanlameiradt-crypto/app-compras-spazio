// Textos na tela dos cadastros (DESIGN-fase-2.md, C.6 — exatos). rotulo = a empresa até o "(".
import type { AvisoConfirmar } from '../lib/tipos'

/** "17h", "9h07" a partir de um ISO (hora de Brasília, −03 fixo, como o cot_hora_br do banco). */
export function horaBr(iso: string): string {
  const d = new Date(iso)
  const br = new Date(d.getTime() - 3 * 3600 * 1000)
  const h = br.getUTCHours()
  const m = br.getUTCMinutes()
  return `${h}h${m === 0 ? '' : String(m).padStart(2, '0')}`
}
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** "ter 27/10 12h" a partir de um ISO. */
export function dataHoraBr(iso: string): string {
  const br = new Date(new Date(iso).getTime() - 3 * 3600 * 1000)
  const dia = DIAS[br.getUTCDay()]
  const dd = String(br.getUTCDate()).padStart(2, '0')
  const mm = String(br.getUTCMonth() + 1).padStart(2, '0')
  return `${dia} ${dd}/${mm} ${horaBr(iso)}`
}

export const NOVO_VENDEDOR =
  "Vendedor novo começa desligado: os itens dele continuam em 'Sem vendedor' e são comprados na loja até você ligar."

export const ligarAguardando = (rotulo: string, a: AvisoConfirmar): string =>
  `Ligar o ${rotulo} agora? Os compradores passam a ver 'Aguardando cotação com ${rotulo} — não comprar na loja' em ${a.itens} itens ` +
  `até ter ${dataHoraBr(String(a.ate))}, e a coleta pode mandar o e-mail 'Cotações ainda não enviadas'. ` +
  `Se não vai cotar com ele nesta semana, ligue a partir de ${dataHoraBr(String(a.ate))}.`

export const desligarCotacaoViva = (rotulo: string, a: AvisoConfirmar): string => {
  const v = (a.versoes as { versao: number }[] | undefined)?.[0]
  return `A cotação v${v?.versao ?? 1} com o ${rotulo} continua valendo até você resolver (pedido, Obrigado ou Cancelar). ` +
    `Os itens que ainda não foram cotados vão para 'Sem vendedor'. Desligar?`
}

export const whatsappRepetido = (a: AvisoConfirmar): string =>
  `Este número já está no ${a.empresa}. Gravar assim mesmo?`

export const WHATSAPP_COM_COTACAO =
  "Há cotação aberta com ele: 'Abrir o WhatsApp de novo' e 'Cobrar' passam a abrir o número novo. O link da cotação continua o mesmo."

export const grafia = (grafiaOrig: string, rotulo: string, produtos: number): string =>
  `${grafiaOrig} → ${rotulo}. Muda ${produtos} produtos que ainda seguem a última compra; os fixados em outro vendedor não mudam ` +
  `(troque em Produtos). Vale a partir da próxima atualização da aba Cotações; item de cotação já enviada fica com quem está.`

export const fator = (texto: string, produto: string, rotulo: string): string =>
  `Usar ${texto} como padrão para ${produto} com o ${rotulo}? A partir da próxima cotação preparada, a mensagem mostra a embalagem, ` +
  `e a página avisa o vendedor se ele cotar outro fardo. A cotação já enviada não muda.`

export const kgPorLitro = (produto: string, kg: number): string =>
  `1 L de ${produto} = ${kg} kg no SisChef? O preço por litro passa a ser convertido para R$/kg nas próximas respostas.`

export const soltarVendedor = (rotulo: string): string =>
  `O produto volta a seguir o fornecedor da última compra e fica com ele a partir da próxima cotação. Descrição, código e fator do ${rotulo} são apagados.`

export const tirarSempre = (produto: string): string =>
  `Tirar ${produto} de todas as listas a partir de agora? Motivo (aparece na Revisão):`

export const FAIXA_VIRADA = 'Os cadastros agora são feitos aqui. Os arquivos CSV do robô foram aposentados em 29/10.'
