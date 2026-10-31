// A linha da CONTA de um item já ligado ao produto do SisChef (pedido do Ivan, 31/10/2026): "48 PC × 15 = 720 UN" + a etiqueta "automático" + quem faz a conta. Só mostra, não tem botão:
// o Ivan não precisa digitar nada neste item (o "Editar" continua ao lado para quem quiser corrigir). As regras de quando ela aparece estão em contaDoItem.ts.
import type { ContaDoItem, QuemFazAConta } from './contaDoItem'

export const TEXTO_DE_QUEM_FAZ: Record<QuemFazAConta, string> = {
  sischef: 'O SisChef já faz esta conta: não precisa digitar nada. Se algo não bater, o robô para e avisa.',
  robo: 'O robô já tem a regra deste produto e multiplica ao lançar: não precisa digitar nada.',
}

export function ContaAutomatica({ conta }: { conta: ContaDoItem }) {
  return (
    <p className="conta-item" data-testid="conta-item" data-quem={conta.quem}>
      <span className="conta-formula" data-testid="conta-item-formula">{conta.conta}</span>{' '}
      <small className="automatico" data-testid="conta-item-automatico">automático</small>
      <small className="conta-quem" data-testid="conta-item-quem">{TEXTO_DE_QUEM_FAZ[conta.quem]}</small>
    </p>
  )
}
