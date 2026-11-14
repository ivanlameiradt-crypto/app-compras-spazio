// supabase/functions/confirmar-cupom/passageiro.ts
// "Tentar de novo" do cupom parado por falha PASSAGEIRA do robô (14/11/2026): o próprio texto que o robô gravou prova que NADA foi criado no SisChef.
// Os moldes são os MESMOS de src/admin/cupomRegras.ts (o app só mostra o botão para o que este arquivo também aceita; um teste compara os dois). Cada molde é ancorado no INÍCIO do texto, onde o robô põe o prefixo.
// O motivo é cortado em ~2000 caracteres no banco: só se reconhece texto CURTO e nunca se conclui "é seguro" pela AUSÊNCIA de um aviso no fim (ele pode ter sido cortado). Todas as partes de um motivo composto ("; ") têm de ser reconhecidas.
import { trechoDaFalha, trechoDaRepetida } from './parecida.ts'

export const MOTIVO_CURTO_MAX = 1500
const MOLDE_NAO_COLOCOU = /^item (\d+): o Sischef não colocou o produto \(código [^)]*\) na lista em ~\d+ s \(demora do Sischef ou produto fora do catálogo\)$/
const MOLDE_GRADE = /^(?:item \d+: )?a grade do Sischef tem \d+ linha\(s\), esperava \d+: uma linha pode ter entrado duas vezes \(nada foi gerado\)$/
const MOLDE_MONTAR = /^(?:item \d+: )?falha ao montar o pedido no Sischef(?: ao preencher a linha \(código [^)]*\))?: \S/
const MOLDE_TESTE = /^erro inesperado no teste \(dry-run, nada foi criado no Sischef\): \S|^PROCESSANDO preso há mais de \d+ min \(cupom de teste: o dry-run nunca cria compra\)$/
/** Qualquer sinal de que a compra PODE existir: em QUALQUER ponto do texto, não se repete (cinto e suspensório). */
const SINAL_DE_COMPRA = /CONFERIR NO SISCHEF|conferir no sischef|_CLICADO|pedido criado|pedido gerado|Gerar compra|Finalizar compra|pagamento no Sischef|preso há mais de \d+ min(?! \(cupom de teste)|nunca lançado/i

const reconhecida = (parte: string) => MOLDE_NAO_COLOCOU.test(parte) || MOLDE_GRADE.test(parte) || MOLDE_MONTAR.test(parte) || MOLDE_TESTE.test(parte)

/** true só se o motivo é CURTO, sem sinal de compra, sem o aviso de repetida/falha de conferência e TODAS as partes são moldes de falha passageira. */
export function motivoEhPassageiro(motivoBruto: string | null): boolean {
  const motivo = (motivoBruto ?? '').trim()
  if (motivo === '' || motivo.length >= MOTIVO_CURTO_MAX) return false
  if (SINAL_DE_COMPRA.test(motivo) || trechoDaRepetida(motivo) !== null || trechoDaFalha(motivo) !== null) return false
  // o '; ' de dentro do molde do teste ('(dry-run; nada foi criado…)') não separa partes
  return motivo.replace('(dry-run; nada', '(dry-run, nada').split('; ').every((parte) => reconhecida(parte.trim()))
}
