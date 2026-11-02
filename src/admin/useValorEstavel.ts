import { useEffect, useState } from 'react'

/**
 * Devolve `valor` só depois que ele ficou PARADO por `ms` milissegundos; enquanto ele muda, devolve o valor anterior. Serve para o aviso do "1" não piscar enquanto o Ivan digita
 * "15" ou "1,5" (o "1" sozinho aparecia por um instante e sumia no dígito seguinte, e a caixa pulava no celular). Quem usa compara com o valor atual: só mostra quando são iguais.
 */
export function useValorEstavel<T>(valor: T, ms = 600): T {
  const [estavel, setEstavel] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setEstavel(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return estavel
}
