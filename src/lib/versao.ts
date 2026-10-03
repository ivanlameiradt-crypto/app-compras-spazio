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
