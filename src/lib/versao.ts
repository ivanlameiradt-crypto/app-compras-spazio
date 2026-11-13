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
/** O que fazer com a versão nova: nada, trocar já (recarrega) ou só AVISAR (faixa "Tem uma versão nova do app" + botão Atualizar; a pessoa escolhe a hora). */
export type AcaoVersaoNova = 'nada' | 'aplicar' | 'avisar'

/**
 * Regra do dono (13/11/2026): o app NUNCA recarrega sozinho com a pessoa trabalhando, para ninguém perder o que está digitando, um lançamento ou uma
 * compra em andamento. Só troca sozinho na ABERTURA (a página acabou de abrir, nada foi digitado: decisão de 07/10 de ele não precisar "sair e entrar")
 * e quando a pessoa CLICA em Atualizar (botão do topo ou da faixa). Ao voltar do fundo e com o app em uso (checagem periódica) só aparece a faixa.
 * A trava anti-loop continua: versão para a qual já se tentou trocar e não assentou não é repetida (nem avisada), salvo no botão (pedido explícito).
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
  return origem === 'abertura' ? 'aplicar' : 'avisar'
}
