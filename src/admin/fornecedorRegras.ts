// Regras puras do "Cadastrar fornecedor" (pedido do Ivan, 08/10/2026): quando o robô para com "fornecedor não encontrado no Sischef", o app deixa o Ivan
// cadastrar o fornecedor (razão social, nome fantasia e CNPJ) com os dados da consulta pública do CNPJ. Sem React nem rede.

/** O motivo que o robô grava (cupom_navegador.py): "fornecedor não encontrado no Sischef (NOME, CNPJ 63540861000182)". */
const RE_MOTIVO = /^fornecedor não encontrado no Sischef \((.*), CNPJ ([0-9?]*)\)\s*$/i

export interface FornecedorDoCupom { nome: string; cnpj: string }

/** O fornecedor que o robô não achou, lido do motivo do cupom; null se o motivo é outro. O CNPJ vem só com dígitos (vazio se o cupom não o trouxe). */
export function fornecedorNaoEncontrado(motivo: string | null | undefined): FornecedorDoCupom | null {
  const m = RE_MOTIVO.exec((motivo ?? '').trim())
  if (!m) return null
  const nome = m[1].trim() === 'sem nome' ? '' : m[1].trim()
  return { nome, cnpj: m[2].replace(/\D/g, '') }
}

/** Só os dígitos do que o Ivan digitou ou colou ("63.540.861/0001-82" → "63540861000182"). */
export const soDigitos = (v: string): string => v.replace(/\D/g, '')

/** "63540861000182" → "63.540.861/0001-82" (o que tiver menos de 14 dígitos fica como veio). */
export function formatarCnpj(v: string): string {
  const d = soDigitos(v)
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v
}

/** CNPJ válido: 14 dígitos, não todos iguais, com os dois dígitos verificadores certos. */
export function cnpjValido(v: string): boolean {
  const d = soDigitos(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  const d1 = dv(d.slice(0, 12))
  return d1 === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13])
}

const limpar = (t: string | null | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim()

/**
 * Regra do Ivan (08/10/2026): o SisChef recebe só o CNPJ e a RAZÃO SOCIAL (mais estado e município, que ele exige). O nome FANTASIA fica só no app (tabela
 * fornecedor_app): aparece nas informações do lançamento dos fornecedores que o Ivan cadastrou por aqui. Devolve "FANTASIA · RAZÃO" para mostrar, ou só a razão
 * quando não há fantasia (ou ela é igual à razão).
 */
export function nomeParaMostrar(razao: string | null | undefined, fantasia: string | null | undefined): string {
  const r = limpar(razao)
  const f = limpar(fantasia)
  if (!f) return r
  if (!r) return f
  return f.toUpperCase() === r.toUpperCase() ? r : `${f} · ${r}`
}

/** O que a consulta pública do CNPJ devolve (a Edge Function consultar-cnpj). */
export interface DadosCnpj { cnpj: string; razao_social: string; nome_fantasia: string; uf: string; municipio: string }

/** O pedido de cadastro como o app o manda ao servidor. */
export interface PedidoCadastro { cnpj: string; razao_social: string; nome_fantasia: string; uf: string; municipio: string; cupom_id: string }

/** Por que o formulário ainda não pode ser enviado (texto para o Ivan), ou null quando está pronto. */
export function problemaDoFormulario(f: { cnpj: string; razao: string; uf: string; municipio: string }): string | null {
  if (!cnpjValido(f.cnpj)) return 'O CNPJ não está certo (confira os 14 números).'
  if (!limpar(f.razao)) return 'Falta a razão social.'
  if (!/^[A-Za-z]{2}$/.test(f.uf.trim())) return 'Falta o estado (UF).'
  if (!limpar(f.municipio)) return 'Falta o município.'
  return null
}

/** O estado do cadastro pedido, como a tela o conta (tabela fornecedor_cadastro). */
export type EstadoCadastro = 'PENDENTE' | 'PROCESSANDO' | 'CADASTRADO' | 'JA_EXISTIA' | 'REVISAR'
export const CADASTRO_CONCLUIDO = (e: EstadoCadastro | null | undefined): boolean => e === 'CADASTRADO' || e === 'JA_EXISTIA'
