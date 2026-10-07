import { CNPJS_PAGAMENTO_SEMANAL_QUARTA, ehPagamentoSemanal, planoSemanal, quartaDoPagamento, semanaDaCompra } from '../../src/admin/notaSefazRegras'
import type { NotaSefazLista } from '../../src/lib/tipos'

const MAUES = '37638932000174'
const nota = (extra: Partial<NotaSefazLista> = {}): NotaSefazLista => ({
  chave: '0'.repeat(44), cnpj_emitente: MAUES, emitente: 'MAUES FOOD BRASIL INDUSTRIA DE ALIMENTOS LTDA', numero: '000055100', emissao: '2026-10-07',
  valor_nf: 791.2, situacao: 'na_fila', lancada_em: null, nf_sischef: null,
  itens: [{ descricao: 'X', qtd: 1, unidade_sischef: 'KG', produto_id: 7, associacao: 'sischef' }],
  parcelas: [{ numero: '001', vencimento: '2026-10-08', valor: 791.2 }], ...extra,
})

describe('quartaDoPagamento (a mesma conta do robô: motor_logica.quarta_do_pagamento)', () => {
  it('a compra da semana (domingo a sábado) é paga na quarta seguinte ao sábado', () => {
    expect(quartaDoPagamento('2026-10-07')).toBe('2026-10-14') // quarta (a nota da MAUES 000055100)
    expect(quartaDoPagamento('2026-09-22')).toBe('2026-09-30') // terça -> sábado 26/09 -> quarta 30/09 (caso do robô)
    expect(quartaDoPagamento('2026-10-05')).toBe('2026-10-14') // segunda
  })

  it('domingo abre a semana e sábado a fecha', () => {
    expect(quartaDoPagamento('2026-10-04')).toBe('2026-10-14') // domingo 04/10: o sábado é o 10/10
    expect(quartaDoPagamento('2026-10-10')).toBe('2026-10-14') // sábado 10/10
    expect(quartaDoPagamento('2026-10-11')).toBe('2026-10-21') // domingo 11/10 já é a semana seguinte
  })

  it('virada de mês e de ano', () => {
    expect(quartaDoPagamento('2026-12-30')).toBe('2027-01-06') // quarta 30/12 -> sábado 02/01/2027 -> quarta 06/01
  })

  it('data inexistente ou fora do formato: null', () => {
    for (const ruim of ['', '2026-02-30', '07/10/2026', 'x', '2026-13-01']) expect(quartaDoPagamento(ruim)).toBeNull()
  })
})

describe('semanaDaCompra', () => {
  it('devolve o domingo e o sábado da semana da emissão', () => {
    expect(semanaDaCompra('2026-10-07')).toEqual({ inicio: '2026-10-04', fim: '2026-10-10' })
    expect(semanaDaCompra('2026-10-04')).toEqual({ inicio: '2026-10-04', fim: '2026-10-10' })
    expect(semanaDaCompra('2026-10-10')).toEqual({ inicio: '2026-10-04', fim: '2026-10-10' })
    expect(semanaDaCompra('lixo')).toBeNull()
  })
})

describe('ehPagamentoSemanal', () => {
  it('é a MAUES com boletos no XML e emissão válida', () => {
    expect(CNPJS_PAGAMENTO_SEMANAL_QUARTA[MAUES]).toBeTruthy()
    expect(ehPagamentoSemanal(nota())).toBe(true)
  })

  it('não é: outro fornecedor, XML por ler, XML sem boletos ou emissão inválida', () => {
    expect(ehPagamentoSemanal(nota({ cnpj_emitente: '03995515011363' }))).toBe(false)
    expect(ehPagamentoSemanal(nota({ cnpj_emitente: null }))).toBe(false)
    expect(ehPagamentoSemanal(nota({ parcelas: null }))).toBe(false)
    expect(ehPagamentoSemanal(nota({ parcelas: [] }))).toBe(false)
    expect(ehPagamentoSemanal(nota({ emissao: '' }))).toBe(false)
  })
})

describe('planoSemanal', () => {
  it('sem edição: cada parcela vence na quarta, com o valor do boleto do XML', () => {
    const p = planoSemanal(nota(), [])!
    expect(p.quarta).toBe('2026-10-14')
    expect(p.semana).toEqual({ inicio: '2026-10-04', fim: '2026-10-10' })
    expect(p.parcelas).toEqual([{ vencimento: '2026-10-14', valor: 791.2, vencimentoXml: '2026-10-08', editada: false }])
    expect(p.ok).toBe(true)
    expect(p.motivo).toBe('')
  })

  it('a data editada vale (e só a data): o valor continua o do XML', () => {
    const p = planoSemanal(nota(), ['2026-10-16'])!
    expect(p.parcelas).toEqual([{ vencimento: '2026-10-16', valor: 791.2, vencimentoXml: '2026-10-08', editada: true }])
    expect(p.ok).toBe(true)
  })

  it('editar para a própria quarta não conta como edição', () => {
    expect(planoSemanal(nota(), ['2026-10-14'])!.parcelas[0].editada).toBe(false)
  })

  it('vários boletos no XML: todos na quarta; cada data pode ser editada sozinha', () => {
    const n = nota({ valor_nf: 100, parcelas: [{ numero: '1', vencimento: '2026-10-08', valor: 60 }, { numero: '2', vencimento: '2026-10-15', valor: 40 }] })
    const p = planoSemanal(n, ['', '2026-10-21'])!
    expect(p.parcelas.map((x) => x.vencimento)).toEqual(['2026-10-14', '2026-10-21'])
    expect(p.parcelas.map((x) => x.valor)).toEqual([60, 40])
    expect(p.ok).toBe(true)
  })

  it('data editada vazia volta para a quarta; data inválida ou anterior à emissão trava com o motivo', () => {
    expect(planoSemanal(nota(), [''])!.parcelas[0].vencimento).toBe('2026-10-14')
    const invalida = planoSemanal(nota(), ['2026-02-30'])!
    expect(invalida.ok).toBe(false)
    expect(invalida.motivo).toBe('Parcela 1: informe uma data de vencimento válida')
    const antes = planoSemanal(nota(), ['2026-10-06'])!
    expect(antes.ok).toBe(false)
    expect(antes.motivo).toBe('Parcela 1: o vencimento é anterior à emissão da nota')
  })

  it('boletos do XML que não fecham com o valor da nota: não libera (o aviso de sempre cuida do resto)', () => {
    const p = planoSemanal(nota({ valor_nf: 800 }), [])!
    expect(p.ok).toBe(false)
    expect(p.motivo).toContain('não fecham com o valor da nota')
  })

  it('devolve null quando não é pagamento semanal', () => {
    expect(planoSemanal(nota({ cnpj_emitente: '03995515011363' }), [])).toBeNull()
    expect(planoSemanal(nota({ parcelas: null }), [])).toBeNull()
  })
})
