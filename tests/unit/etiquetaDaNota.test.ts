import { etiquetaDaNota } from '../../src/admin/notaSefazRegras'

// A etiqueta curta no título da nota FECHADA (pedido do Ivan, 21/10/2026). A ordem é a de importância: o que o robô fez vem antes do que falta decidir.
const base = {
  estado: null, presa: false, freteAberto: false, bloqueada: false, faltaDecidir: false,
  faltaParcelas: false, financeiroNaoFecha: false, pronta: false, semForma: false,
} as const

describe('etiquetaDaNota', () => {
  it('sem nada a dizer: nenhuma etiqueta', () => {
    expect(etiquetaDaNota(base)).toBeNull()
  })

  it('pela metade: "Ficou pela metade", em vermelho', () => {
    expect(etiquetaDaNota({ ...base, estado: 'erro' })).toEqual({ texto: 'Ficou pela metade', tom: 'erro' })
  })

  it('pedido aberto no SisChef com o frete NÃO é falha: "Falta terminar no SisChef", em aviso (e vence o "erro" do mesmo estado)', () => {
    expect(etiquetaDaNota({ ...base, estado: 'erro', freteAberto: true })).toEqual({ texto: 'Falta terminar no SisChef', tom: 'aviso' })
  })

  it('o robô trabalhando: "Lançando…"; preso há mais de 30 min vira "Precisa de você"', () => {
    expect(etiquetaDaNota({ ...base, estado: 'lancando' })).toEqual({ texto: 'Lançando…', tom: 'aviso' })
    expect(etiquetaDaNota({ ...base, estado: 'lancando', presa: true })).toEqual({ texto: 'Precisa de você', tom: 'aviso' })
  })

  it('o robô parou pedindo algo: "Precisa de você"', () => {
    expect(etiquetaDaNota({ ...base, estado: 'revisar' })).toEqual({ texto: 'Precisa de você', tom: 'aviso' })
  })

  it('ensaio que passou: "Ensaio ok", em verde', () => {
    expect(etiquetaDaNota({ ...base, estado: 'ensaio_ok' })).toEqual({ texto: 'Ensaio ok', tom: 'ok' })
  })

  it('trava que o app não resolve (conta especial, nota sem itens): "Precisa de você"', () => {
    expect(etiquetaDaNota({ ...base, bloqueada: true })).toEqual({ texto: 'Precisa de você', tom: 'aviso' })
  })

  it('cada pendência tem a sua etiqueta', () => {
    expect(etiquetaDaNota({ ...base, faltaDecidir: true })).toEqual({ texto: 'Falta decidir', tom: 'aviso' })
    expect(etiquetaDaNota({ ...base, faltaParcelas: true })).toEqual({ texto: 'Falta as parcelas', tom: 'aviso' })
    expect(etiquetaDaNota({ ...base, financeiroNaoFecha: true })).toEqual({ texto: 'Confira o financeiro', tom: 'aviso' })
    expect(etiquetaDaNota({ ...base, semForma: true })).toEqual({ texto: 'Falta como pagar', tom: 'aviso' })
  })

  it('pronta para lançar: "Pronta", em verde', () => {
    expect(etiquetaDaNota({ ...base, pronta: true })).toEqual({ texto: 'Pronta', tom: 'ok' })
  })

  it('a ordem é a de importância', () => {
    const tudo = { ...base, bloqueada: true, faltaDecidir: true, faltaParcelas: true, financeiroNaoFecha: true, pronta: true, semForma: true }
    expect(etiquetaDaNota({ ...tudo, estado: 'erro' })?.texto).toBe('Ficou pela metade')
    expect(etiquetaDaNota({ ...tudo, estado: 'revisar' })?.texto).toBe('Precisa de você')
    expect(etiquetaDaNota(tudo)?.texto).toBe('Precisa de você')                                   // a trava vem antes do que falta decidir
    expect(etiquetaDaNota({ ...tudo, bloqueada: false })?.texto).toBe('Falta decidir')
    expect(etiquetaDaNota({ ...tudo, bloqueada: false, faltaDecidir: false })?.texto).toBe('Falta as parcelas')
    expect(etiquetaDaNota({ ...tudo, bloqueada: false, faltaDecidir: false, faltaParcelas: false })?.texto).toBe('Confira o financeiro')
    expect(etiquetaDaNota({ ...tudo, bloqueada: false, faltaDecidir: false, faltaParcelas: false, financeiroNaoFecha: false })?.texto).toBe('Pronta')
  })
})
