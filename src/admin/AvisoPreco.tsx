import { formatarReais } from '../lib/regras'
import { textoDoPrecoForaDoNormal, type PrecoForaDoNormal } from './precoForaDoNormal'

/**
 * O quadro amarelo "Preço fora do normal" de UM item (nota fiscal e cupom; pedido do Ivan, 29/10/2026): o preço por unidade de estoque que o SisChef vai gravar não se parece com o das
 * últimas compras do produto. Só avisa (nunca trava): o Ivan confere a embalagem e, se for o caso, acerta a conversão — e o quadro some sozinho. Sem aviso, não desenha nada.
 */
export default function AvisoPreco({ aviso, testid = 'preco-fora-do-normal' }: { aviso: PrecoForaDoNormal | null | undefined; testid?: string }) {
  if (!aviso) return null
  return <div className="amarelo aviso-preco" role="status" data-testid={testid}>{textoDoPrecoForaDoNormal(aviso, formatarReais)}</div>
}
