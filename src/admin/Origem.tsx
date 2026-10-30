// Indicador de ONDE vem o texto ao lado (pedido do Ivan, 30/10/2026, nota fiscal e cupom): a descrição do item é a que o fornecedor escreveu ("da nota fiscal", "do cupom fiscal") e
// o produto ligado, com o ✓, é o que está no cadastro ("do SisChef"). Só um sinal pequeno, sem ação; fica no fim da linha e quebra junto com ela. O espaço antes do selo é de
// verdade (leitor de tela e copiar/colar não podem ler "SICILIANOdo cupom fiscal").
export type DeOnde = 'nota' | 'cupom' | 'sischef'

export const TEXTO_DA_ORIGEM: Record<DeOnde, string> = { nota: 'da nota fiscal', cupom: 'do cupom fiscal', sischef: 'do SisChef' }

export function Origem({ de }: { de: DeOnde }) {
  return <>{' '}<small className={`origem origem-${de}`} data-testid={`origem-${de}`}>{TEXTO_DA_ORIGEM[de]}</small></>
}
