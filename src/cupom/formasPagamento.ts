// src/cupom/formasPagamento.ts
// Espelho em TS do cupom_formas_pagamento.MAPA_PIX (robô, repo sischef-monitor-notas). FONTE DA VERDADE: o Python.
// tests/unit/formasPagamento.test.ts trava estes valores verbatim; um valor diferente faz o robô recusar o cupom.
import type { FormaCupom } from '../lib/tipos'

export const CONTA_DINHEIRO = 'DINHEIRO - À Vista'
export const CONTA_TESOURARIA = 'TESOURARIA - À Vista'

export type Banco = 'pangbank' | 'bradesco' | 'itau' | 'caixa'
export type Empresa = 'ij' | 'sp'
export interface ContaPix { banco: Banco; empresa: Empresa; rotulo: string; conta: string }

// As 7 combinações válidas (iguais às chaves/valores do MAPA_PIX do robô). I J Lameira = Spazio; S P Delivery = Kūkan.
export const CONTAS_PIX: ContaPix[] = [
  { banco: 'pangbank', empresa: 'ij', rotulo: 'Pang Bank — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - PANG BANK - I J LAMEIRA' },
  { banco: 'pangbank', empresa: 'sp', rotulo: 'Pang Bank — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - PANG BANK - S P DELIVERY' },
  { banco: 'bradesco', empresa: 'ij', rotulo: 'Bradesco — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - BRADESCO - I J LAMEIRA' },
  { banco: 'bradesco', empresa: 'sp', rotulo: 'Bradesco — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - BRADESCO - S P DELIVERY' },
  { banco: 'itau', empresa: 'ij', rotulo: 'Itaú — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - PANG ITAU - I J LAMEIRA' },
  { banco: 'caixa', empresa: 'ij', rotulo: 'Caixa — Spazio (I J Lameira)', conta: 'CONTA BANCÁRIA - CAIXA - I J LAMEIRA' },
  { banco: 'caixa', empresa: 'sp', rotulo: 'Caixa — Kūkan (S P Delivery)', conta: 'CONTA BANCÁRIA - CAIXA - S P DELIVERY' },
]

export const FORMAS: { forma: FormaCupom; rotulo: string }[] = [
  { forma: 'dinheiro', rotulo: 'Dinheiro à vista' },
  { forma: 'tesouraria', rotulo: 'Tesouraria à vista' },
  { forma: 'pix', rotulo: 'PIX' },
  { forma: 'sem_cartao', rotulo: 'Sem cartão' },
]
