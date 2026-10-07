import { pesoPeloNome } from '../../src/admin/associacaoRegras'

describe('pesoPeloNome: sugestão de conversão tirada do nome da nota (o Ivan confere e corrige)', () => {
  it('nota em UN com UM peso claro no nome: devolve em kg e o trecho que o gerou', () => {
    expect(pesoPeloNome('CÓD. FOR: 249693 LEITE COND TIROL SEMIDES TP 395G', 'UN')).toEqual({ kg: 0.395, trecho: '395G' })
    expect(pesoPeloNome('LEITE COND TIROL SEMIDES TP 395G', 'un')).toEqual({ kg: 0.395, trecho: '395G' })
    expect(pesoPeloNome('FARINHA DE TRIGO 1KG', 'UN')).toEqual({ kg: 1, trecho: '1KG' })
    expect(pesoPeloNome('CHICKEN SUPREME 2,5KG', 'UN')).toEqual({ kg: 2.5, trecho: '2,5KG' })
    expect(pesoPeloNome('MOLHO 500 G', 'UN')).toEqual({ kg: 0.5, trecho: '500G' })
    expect(pesoPeloNome('CHOC LACTA BIS ORIGINAL PACK 302,4G', 'UN')).toEqual({ kg: 0.3024, trecho: '302,4G' })
    expect(pesoPeloNome('SAL 750GR', 'UN')).toEqual({ kg: 0.75, trecho: '750GR' })
  })

  it('nota que não está em UN não recebe sugestão: a caixa/pacote pode ter vários itens (a "2,5KG" da SEARA é o pacote, não a caixa)', () => {
    for (const un of ['CX', 'PCT', 'KG', 'L', '', null, undefined]) expect(pesoPeloNome('CHICKEN SUPREME FS 2,5KG', un)).toBeNull()
  })

  it('embalagem múltipla, dois pesos ou nenhum peso: nada', () => {
    expect(pesoPeloNome('LEITE COND 12X395G', 'UN')).toBeNull()
    expect(pesoPeloNome('LEITE COND 12 X 395G', 'UN')).toBeNull()
    expect(pesoPeloNome('MISTURA 500G COM 2KG', 'UN')).toBeNull()
    expect(pesoPeloNome('OLEO SOJA VITALIV PET 900ML', 'UN')).toBeNull()   // ml não é peso
    expect(pesoPeloNome('AGUA SEM GAS 500ML', 'UN')).toBeNull()
    expect(pesoPeloNome('', 'UN')).toBeNull()
    expect(pesoPeloNome(undefined, 'UN')).toBeNull()
  })

  it('não confunde letras com unidade (KG/G dentro de palavra) nem aceita peso absurdo', () => {
    expect(pesoPeloNome('PRODUTO 395GRANDE', 'UN')).toBeNull()
    expect(pesoPeloNome('CAIXA 60KG', 'UN')).toBeNull()     // mais de 50 kg: não é uma unidade de balcão
    expect(pesoPeloNome('ITEM 0G', 'UN')).toBeNull()
  })
})
