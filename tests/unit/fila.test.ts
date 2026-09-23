import { clear } from 'idb-keyval'
import {
  enfileirar, pendentes, processar, errosDaFila, limparErros, reenfileirarErros, ErroRede, ehErroTemporario, ouvir, type Op,
} from '../../src/lib/fila'

const abrir = (id: string): Op => ({ id, tipo: 'abrir_compra', args: { p_id: 'c1', p_semana: 1, p_loja: 'FEIRA' } })

beforeEach(async () => { await clear() })

describe('fila offline', () => {
  it('guarda na ordem e não duplica o mesmo id', async () => {
    await enfileirar(abrir('a'))
    await enfileirar(abrir('b'))
    await enfileirar(abrir('a'))
    expect((await pendentes()).map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('envia tudo quando há internet', async () => {
    await enfileirar(abrir('a'))
    await enfileirar(abrir('b'))
    const feitas: string[] = []
    const r = await processar(async (op) => { feitas.push(op.id) })
    expect(feitas).toEqual(['a', 'b'])
    expect(r).toEqual({ enviadas: 2, erros: 0 })
    expect(await pendentes()).toEqual([])
  })

  it('para no primeiro erro de rede e mantém o resto', async () => {
    await enfileirar(abrir('a'))
    await enfileirar(abrir('b'))
    const r = await processar(async () => { throw new ErroRede('Failed to fetch') })
    expect(r).toEqual({ enviadas: 0, erros: 0 })
    expect((await pendentes()).map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('erro definitivo sai da fila e fica registrado com a foto (para poder tentar de novo)', async () => {
    await enfileirar({ id: 'f', tipo: 'fechar_compra', args: { p_compra: 'c1', p_com_nota: true, p_total: 1, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    await enfileirar(abrir('b'))
    const r = await processar(async (op) => { if (op.id === 'f') throw new Error('esta compra já foi fechada') })
    expect(r).toEqual({ enviadas: 1, erros: 1 })
    const erros = await errosDaFila()
    expect(erros[0].mensagem).toBe('esta compra já foi fechada')
    expect(erros[0].op).toMatchObject({ id: 'f', foto: { tipo: 'image/jpeg' } })
    await limparErros()
    expect(await errosDaFila()).toEqual([])
  })

  it('tentar de novo: os erros voltam para a frente da fila, na ordem, com a foto', async () => {
    await enfileirar(abrir('a'))
    await enfileirar({ id: 'f', tipo: 'fechar_compra', args: { p_compra: 'c1', p_com_nota: true, p_total: 1, p_foto: null }, foto: { dados: new ArrayBuffer(3), tipo: 'image/jpeg' } })
    await processar(async () => { throw new Error('esta lista não está liberada para compra') })
    expect((await errosDaFila()).map((e) => e.op.id)).toEqual(['a', 'f'])
    await enfileirar(abrir('depois'))
    const aviso = vi.fn()
    const parar = ouvir(aviso)
    await reenfileirarErros()
    parar()
    expect(aviso).toHaveBeenCalled()
    expect(await errosDaFila()).toEqual([])
    const fila = await pendentes()
    expect(fila.map((o) => o.id)).toEqual(['a', 'f', 'depois'])
    expect(fila[1]).toMatchObject({ foto: { tipo: 'image/jpeg' } })
    const feitas: string[] = []
    await processar(async (op) => { feitas.push(op.id) })
    expect(feitas).toEqual(['a', 'f', 'depois'])
  })

  it('tentar de novo não duplica uma operação que já voltou para a fila', async () => {
    await enfileirar(abrir('a'))
    await processar(async () => { throw new Error('x') })
    await enfileirar(abrir('a'))
    await reenfileirarErros()
    expect((await pendentes()).map((o) => o.id)).toEqual(['a'])
  })

  it('processamentos simultâneos não enviam a mesma operação duas vezes', async () => {
    await enfileirar(abrir('a'))
    const feitas: string[] = []
    const exec = async (op: Op) => { feitas.push(op.id) }
    await Promise.all([processar(exec), processar(exec)])
    expect(feitas).toEqual(['a'])
  })

  it('enfileirar não espera um envio em andamento terminar', async () => {
    await enfileirar(abrir('a'))
    let liberarPrimeira: () => void = () => {}
    const primeiroEnvio = new Promise<void>((r) => { liberarPrimeira = r })
    let vez = 0
    const rodando = processar(async () => { vez++; if (vez === 1) await primeiroEnvio })
    await new Promise((r) => setTimeout(r, 0)) // dá tempo do processar pegar 'a' e ficar esperando o exec
    await enfileirar(abrir('b'))
    expect((await pendentes()).map((o) => o.id)).toEqual(['a', 'b'])
    liberarPrimeira()
    await rodando
    expect(await pendentes()).toEqual([])
  })

  it('avisa quem está ouvindo', async () => {
    const f = vi.fn()
    const parar = ouvir(f)
    await enfileirar(abrir('a'))
    expect(f).toHaveBeenCalled()
    parar()
  })

  it('classifica pelo status HTTP e pelo código do erro', () => {
    const erro = (status: number | undefined, code = '', message = 'algo') => Object.assign(new Error(message), { status, code })
    for (const s of [0, 401, 408, 429, 500, 502, 503, 504]) expect(ehErroTemporario(erro(s), true)).toBe(true)
    expect(ehErroTemporario(erro(401, 'PGRST301'), true)).toBe(true)
    expect(ehErroTemporario(erro(400, 'PGRST302'), true)).toBe(true)
    expect(ehErroTemporario(erro(400, 'P0001'), true)).toBe(false)
    expect(ehErroTemporario(erro(400, 'P0001', 'jwt na mensagem da regra'), true)).toBe(false)
    expect(ehErroTemporario(erro(403, '42501'), true)).toBe(false)
    expect(ehErroTemporario(erro(404, 'PGRST202'), true)).toBe(false)
    expect(ehErroTemporario(erro(409, '23505', 'duplicate key'), true)).toBe(false)
    expect(ehErroTemporario(erro(undefined, '', 'Failed to fetch'), true)).toBe(true)
    expect(ehErroTemporario(erro(undefined, '', 'esta compra já foi fechada'), true)).toBe(false)
  })

  it('classifica erros temporários (rede, sessão vencida, offline)', () => {
    expect(ehErroTemporario(new Error('TypeError: Failed to fetch'), true)).toBe(true)
    expect(ehErroTemporario(new Error('JWT expired'), true)).toBe(true)
    expect(ehErroTemporario(new Error('esta compra já foi fechada'), false)).toBe(true) // sem internet: tenta depois
    expect(ehErroTemporario(new Error('esta compra já foi fechada'), true)).toBe(false)
  })
})
