// src/cupom/formasPagamento.ts
// Espelho em TS do cupom_formas_pagamento.MAPA_PIX (robô, repo sischef-monitor-notas). FONTE DA VERDADE: o Python.
// tests/unit/formasPagamento.test.ts trava estes valores verbatim; um valor diferente faz o robô recusar o cupom.
import type { FormaCupom } from '../lib/tipos'

export const CONTA_DINHEIRO = 'DINHEIRO - À Vista'
export const CONTA_TESOURARIA = 'TESOURARIA - À Vista'

export type Banco = 'pangbank' | 'bradesco' | 'caixa'
export type Empresa = 'ij' | 'sp'
export interface ContaPix { banco: Banco; empresa: Empresa; rotulo: string; conta: string }

// As 6 combinações válidas (iguais às chaves/valores do MAPA_PIX do robô). I J Lameira = Spazio; S P Delivery = Kūkan.
// 31/10/2026: o SisChef RENOMEOU as contas ('PANG BANK' virou 'PAG BANK', todas ganharam o sufixo '- À Vista') e a conta Itaú NÃO existe mais
// (robô PR 79, conferido ao vivo). A chave 'pangbank|ij' continua a mesma — só o texto da conta mudou.
export const CONTAS_PIX: ContaPix[] = [
  { banco: 'pangbank', empresa: 'ij', rotulo: 'Pag Bank — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - PAG BANK - I J LAMEIRA - À Vista' },
  { banco: 'pangbank', empresa: 'sp', rotulo: 'Pag Bank — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - PAG BANK - S P DELIVERY - À Vista' },
  { banco: 'bradesco', empresa: 'ij', rotulo: 'Bradesco — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA - À Vista' },
  { banco: 'bradesco', empresa: 'sp', rotulo: 'Bradesco — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY - À Vista' },
  { banco: 'caixa', empresa: 'ij', rotulo: 'Caixa — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - CAIXA - I J LAMEIRA - À Vista' },
  { banco: 'caixa', empresa: 'sp', rotulo: 'Caixa — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - CAIXA - S P DELIVERY - À Vista' },
]

export const FORMAS: { forma: FormaCupom; rotulo: string }[] = [
  { forma: 'dinheiro', rotulo: 'Dinheiro à vista' },
  { forma: 'tesouraria', rotulo: 'Tesouraria à vista' },
  { forma: 'pix', rotulo: 'PIX' },
  { forma: 'sem_cartao', rotulo: 'Sem cartão' },
]
