// supabase/functions/enviar-cupom/normalizar.ts
// Normalizador ÚNICO da descrição do cupom. Usado pelo casamento (casamento.ts) E pela chave de aprendizado
// (emitente_cnpj + descricao_norm) que o Ivan grava ao corrigir pelo Code. Mesma regra do _norm do
// cupom_formas_pagamento.py do robô: se divergirem, o aprendizado nunca casa — por isso é um módulo só.
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // tira os acentos (combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // só letras/dígitos
    .trim()
    .replace(/\s+/g, ' ')
}
