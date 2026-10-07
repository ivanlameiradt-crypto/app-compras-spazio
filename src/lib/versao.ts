// Decide se o app rodando precisa trocar para a versão publicada (comparando a versão embutida no pacote
// com a que o version.json da rede informa). Pura de propósito, para dar para testar sem o navegador.
// A trava `jaTentou` evita recarregar em loop caso uma versão nunca "assente" (ex.: id do servidor
// diferente do id embutido no pacote por alguma inconsistência de publicação).
export function precisaAtualizar(
  versaoServidor: string | null | undefined,
  versaoRodando: string,
  jaTentou: string | null,
): boolean {
  if (!versaoServidor) return false // sem resposta / offline: fica como está
  if (versaoServidor === versaoRodando) return false // já está na versão do ar
  if (versaoServidor === jaTentou) return false // já tentou trocar para essa e não assentou: não repete
  return true
}

/** De onde veio a conferência de versão: abertura do app, volta do fundo (depois de um tempo longe), checagem periódica com o app em uso, ou o botão Atualizar. */
export type OrigemConferencia = 'abertura' | 'voltou' | 'periodica' | 'manual'
/** O que fazer com a versão nova: nada, trocar já (recarrega) ou só AVISAR (faixa "Atualizar agora"; o Ivan escolhe a hora). */
export type AcaoVersaoNova = 'nada' | 'aplicar' | 'avisar'

/**
 * Troca sozinha só quando é seguro: na abertura (ainda não digitou nada), ao voltar do fundo depois de um tempo e quando o Ivan toca em Atualizar. Com o app
 * EM USO (checagem periódica) a troca no meio do trabalho podia apagar o que ele estava digitando: aí só aparece a faixa "Há uma versão nova — Atualizar
 * agora". A trava anti-loop continua: versão para a qual já se tentou trocar e não assentou não é repetida (nem avisada), salvo no botão (pedido explícito).
 */
export function acaoParaVersaoNova(
  origem: OrigemConferencia,
  versaoServidor: string | null | undefined,
  versaoRodando: string,
  jaTentou: string | null,
): AcaoVersaoNova {
  if (!versaoServidor || versaoServidor === versaoRodando) return 'nada'
  if (origem === 'manual') return 'aplicar'
  if (versaoServidor === jaTentou) return 'nada'
  return origem === 'periodica' ? 'avisar' : 'aplicar'
}
