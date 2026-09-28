// Regra 3.10 do contrato em TS (conta ao vivo do "Digitar preços"): os mesmos números que o banco. Dados INVENTADOS.
import { arred, converter, validar } from '../../src/cotacao/conversao'
import type { EntradaItem } from '../../src/lib/tipos'
import { itemCotacao } from '../fabricas'

const un = itemCotacao({ unidade: 'un', rotulo: 'un', qtd: 60, ref_preco: 5, ref_situacao: 'ok' })
const kg = itemCotacao({ unidade: 'kg', rotulo: 'kg', qtd: 1.2, ref_preco: 30, ref_situacao: 'ok' })
const litro = itemCotacao({ unidade: 'kg', rotulo: 'kg', qtd: 1.2, ref_preco: 30, ref_situacao: 'ok', vende_por_litro: true })
const e = (p: Partial<EntradaItem>): EntradaItem => ({ numero: 1, rev_lida: 0, estado: 'tem', ...p })

describe('conversão para a unidade do SisChef (4 casas)', () => {
  it('R$ 31,50 fardo c/6 → 5,2500 por un', () => {
    const c = converter(un, e({ preco: 31.5, base: 'embalagem', emb_unidades: 6 }))
    expect([c.erro, c.preco_convertido, c.fator_informado]).toEqual([null, 5.25, 6])
  })
  it('R$ 12,40 pacote de 400 g → 31,0000 por kg', () => {
    const c = converter(kg, e({ preco: 12.4, base: 'embalagem', emb_gramas: 400 }))
    expect([c.preco_convertido, c.fator_informado]).toEqual([31, 0.4])
  })
  it('"pacote 500 g" contra fator confirmado 0,5 → sem fator_diferente e sem fator_nao_confirmado', () => {
    const c = converter({ ...kg, fator: 0.5, fator_confirmado: true }, e({ preco: 15, base: 'embalagem', emb_gramas: 500 }))
    expect(c.avisos_vendedor).not.toContain('fator_diferente')
    expect(c.avisos_ivan).not.toContain('fator_nao_confirmado')
  })
  it('fardo c/6 contra fator confirmado 12 → fator_diferente (vendedor) e fator_nao_confirmado (Ivan)', () => {
    const c = converter({ ...un, fator: 12, fator_confirmado: true }, e({ preco: 31.5, base: 'embalagem', emb_unidades: 6 }))
    expect(c.avisos_vendedor).toContain('fator_diferente')
    expect(c.avisos_ivan).toContain('fator_nao_confirmado')
  })
  it('preço por litro sem kg por litro → convertido null + litro_sem_fator; com kg por litro 1 → convertido', () => {
    const sem = converter(litro, e({ preco: 6, base: 'litro' }))
    expect([sem.preco_convertido, sem.avisos_ivan]).toEqual([null, ['litro_sem_fator']])
    const com = converter({ ...litro, kg_por_litro: 1 }, e({ preco: 6, base: 'litro' }))
    expect([com.preco_convertido, com.avisos_ivan]).toEqual([6, ['unidade_suspeita']])
    const caixa = converter({ ...litro, kg_por_litro: 1 }, e({ preco: 5, base: 'embalagem', emb_ml: 1000 }))
    expect(caixa.preco_convertido).toBe(5)
  })
})

describe('avisos', () => {
  it('ao vendedor não dependem da referência (ref 1, 10 e 100 dão o mesmo)', () => {
    const entrada = e({ preco: 0.42, base: 'embalagem', emb_gramas: 1000 })
    const avisos = [1, 10, 100].map((ref) => converter({ ...kg, ref_preco: ref }, entrada).avisos_vendedor)
    expect(avisos).toEqual([['centavos'], ['centavos'], ['centavos']])
  })
  it('valor alto acima de R$ 300 por kg; "Está certo" (confirmado) limpa os avisos do vendedor', () => {
    expect(converter(kg, e({ preco: 1707, base: 'kg' })).avisos_vendedor).toEqual(['valor_alto'])
    expect(converter(kg, e({ preco: 1707, base: 'kg', confirmado: true })).avisos_vendedor).toEqual([])
  })
  it('acima de R$ 500 sem referência só avisa o Ivan (não recusa)', () => {
    const c = converter({ ...kg, ref_preco: null, ref_situacao: 'sem_referencia' }, e({ preco: 600, base: 'kg' }))
    expect([c.erro, c.avisos_ivan]).toEqual([null, ['acima_500_sem_ref']])
  })
  it('parcial, similar e "a partir de"', () => {
    const c = converter(un, e({ preco: 5, base: 'un', tenho_so: 30, a_partir_de: 100, similar_desc: 'marca B', similar_preco: 4 }))
    expect(c.avisos_ivan).toEqual(['parcial', 'similar', 'a_partir_de'])
  })
})

describe('erros (o item não é gravado)', () => {
  it.each([
    ['tem sem preço', un, e({ base: 'un' }), 'sem_preco'],
    ['tem sem base', un, e({ preco: 5 }), 'base_incompativel'],
    ['un cotado em kg', un, e({ preco: 5, base: 'kg' }), 'base_incompativel'],
    ['kg cotado por un', kg, e({ preco: 5, base: 'un' }), 'base_incompativel'],
    ['embalagem sem quantidade', un, e({ preco: 5, base: 'embalagem' }), 'sem_embalagem'],
    ['gramas e ml juntos', kg, e({ preco: 5, base: 'embalagem', emb_gramas: 500, emb_ml: 500 }), 'base_incompativel'],
    ['preço com 3 casas', un, e({ preco: 5.123, base: 'un' }), 'valor_invalido'],
    ['preço zero', un, e({ preco: 0, base: 'un' }), 'valor_invalido'],
    ['não tem com preço', un, e({ estado: 'nao_tem', preco: 5 }), 'valor_invalido'],
    ['não tem com marca', un, e({ estado: 'nao_tem', marca: 'Marca A' }), 'valor_invalido'],
    ['sem resposta com marca', un, e({ estado: 'sem_resposta', marca: 'Marca A' }), 'valor_invalido'],
    ['marca com 61 caracteres', un, e({ preco: 5, base: 'un', marca: 'M'.repeat(61) }), 'texto_invalido'],
    ['marca com caractere de controle', un, e({ preco: 5, base: 'un', marca: 'Marca\u0007' }), 'texto_invalido'],
  ] as const)('%s', (_nome, item, entrada, erro) => {
    expect(validar(item, entrada)).toBe(erro)
  })
  it('marca de até 60 caracteres com "tem" é aceita; vazia vale como sem marca', () => {
    expect(validar(un, e({ preco: 5, base: 'un', marca: 'M'.repeat(60) }))).toBeNull()
    expect(validar(un, e({ estado: 'nao_tem', marca: '  ' }))).toBeNull()
  })
  it('sem resposta limpa (só o estado)', () => {
    expect(validar(un, e({ estado: 'sem_resposta' }))).toBeNull()
  })
  it('similar só com espaços vale como ausente, como no banco (1.2): sem erro e sem o aviso "similar"', () => {
    expect(validar(un, e({ estado: 'sem_resposta', similar_desc: '   ' }))).toBeNull()
    expect(converter(un, e({ estado: 'nao_tem', similar_desc: '  ' })).avisos_ivan).toEqual([])
    expect(converter(un, e({ preco: 5, base: 'un', similar_desc: ' ' })).avisos_ivan).not.toContain('similar')
    expect(validar(un, e({ estado: 'nao_tem', similar_desc: ` ${'S'.repeat(200)} ` }))).toBeNull()
  })
})

describe('arred', () => {
  it('meio para longe do zero, sem ruído do ponto flutuante', () => {
    expect(arred(5.25, 4)).toBe(5.25)
    expect(arred(12.4 / 0.4, 4)).toBe(31)
    expect(arred(2.345, 2)).toBe(2.35)
  })
})
