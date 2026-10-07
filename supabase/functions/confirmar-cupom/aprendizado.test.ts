// supabase/functions/confirmar-cupom/aprendizado.test.ts
// gravarAprendizado com banco falso (molde: enviar-cupom/gravacao.test.ts). Os índices únicos de cupom_aprendizado são PARCIAIS, então o
// insert-ou-atualiza do PostgREST falharia com 42P10: a gravação é insert simples e, no 23505, UPDATE pela chave (EAN, ou emitente +
// descrição normalizada). Aqui se prova cada ramo e que a função nunca finge sucesso.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gravarAprendizado, type CamposAprendizado, type IoAprendizado } from './aprendizado'
import type { LinhaAprendizado } from './logica'

const EAN = '7891234567895'
const CNPJ_ATACADAO = '75315333000109'
/** Só o que o UPDATE pode mudar: o produto, o fator e a unidade — a chave (EAN / emitente + descrição) fica como está. */
const CAMPOS: CamposAprendizado = {
  insumo_id: '3484974', insumo_nome: 'LIMÃO SICILIANO - INSUMOS', fator_conversao: 1, unidade_destino: 'KG', confirmado: true,
}
const POR_EAN: LinhaAprendizado = { codigo_barras: EAN, emitente_cnpj: null, descricao_norm: null, ...CAMPOS }
const POR_DESCRICAO: LinhaAprendizado = { codigo_barras: null, emitente_cnpj: CNPJ_ATACADAO, descricao_norm: 'limao siciliano', ...CAMPOS }
const JA_EXISTE = { erro: { code: '23505', message: 'duplicate key value violates unique constraint "cupom_aprendizado_ean_uniq"' } }

interface Registro {
  inseridas: LinhaAprendizado[]
  porEan: { ean: string; campos: CamposAprendizado }[]
  porDescricao: { cnpj: string; desc: string; campos: CamposAprendizado }[]
}
/** Banco falso: o insert devolve o que o teste mandar; os UPDATEs registram chave e campos e devolvem true (acharam a linha). */
function fakeIo(over: Partial<IoAprendizado> = {}): IoAprendizado & Registro {
  const registro: Registro = { inseridas: [], porEan: [], porDescricao: [] }
  const base: IoAprendizado = {
    async inserir(linha) { registro.inseridas.push(linha); return { ok: true } },
    async atualizarPorEan(ean, campos) { registro.porEan.push({ ean, campos }); return true },
    async atualizarPorDescricao(cnpj, desc, campos) { registro.porDescricao.push({ cnpj, desc, campos }); return true },
  }
  return Object.assign(base, over, registro)
}

describe('gravarAprendizado — insert simples + 23505 tratado pela chave', () => {
  it('insert ok ⇒ não atualiza nada', async () => {
    const io = fakeIo()
    await expect(gravarAprendizado(POR_DESCRICAO, io)).resolves.toBeUndefined()
    expect(io.inseridas).toEqual([POR_DESCRICAO])
    expect(io.porEan).toHaveLength(0)
    expect(io.porDescricao).toHaveLength(0)
  })

  it('23505 numa linha por EAN ⇒ UPDATE pelo codigo_barras com os campos (insumo_id, insumo_nome, fator_conversao, unidade_destino, confirmado)', async () => {
    const io = fakeIo({ async inserir() { return JA_EXISTE } })
    await gravarAprendizado(POR_EAN, io)
    expect(io.porEan).toEqual([{ ean: EAN, campos: CAMPOS }])
    expect(io.porDescricao).toHaveLength(0)
  })

  it('23505 numa linha por descrição ⇒ UPDATE por (emitente_cnpj, descricao_norm) com os mesmos campos', async () => {
    const io = fakeIo({ async inserir() { return JA_EXISTE } })
    await gravarAprendizado(POR_DESCRICAO, io)
    expect(io.porDescricao).toEqual([{ cnpj: CNPJ_ATACADAO, desc: 'limao siciliano', campos: CAMPOS }])
    expect(io.porEan).toHaveLength(0)
  })

  it('os campos do UPDATE são SÓ os 5: a chave (EAN, emitente, descrição) nunca vai no SET, e confirmado é sempre true', async () => {
    const io = fakeIo({ async inserir() { return JA_EXISTE } })
    await gravarAprendizado({ ...POR_DESCRICAO, fator_conversao: 0.08, unidade_destino: 'kg' }, io)
    const { campos } = io.porDescricao[0]
    expect(Object.keys(campos).sort()).toEqual(['confirmado', 'fator_conversao', 'insumo_id', 'insumo_nome', 'unidade_destino'])
    expect(campos).toEqual({ ...CAMPOS, fator_conversao: 0.08, unidade_destino: 'kg', confirmado: true })
  })

  it('linha com EAN e também emitente + descrição: o EAN manda (é a chave global)', async () => {
    const io = fakeIo({ async inserir() { return JA_EXISTE } })
    await gravarAprendizado({ ...POR_DESCRICAO, codigo_barras: EAN }, io)
    expect(io.porEan).toHaveLength(1)
    expect(io.porDescricao).toHaveLength(0)
  })

  it('erro que não é 23505 (23502 not null, rede, permissão) ⇒ lança com a mensagem do banco e não tenta atualizar', async () => {
    for (const erro of [
      { code: '23502', message: 'null value in column "insumo_id" of relation "cupom_aprendizado" violates not-null constraint' },
      { message: 'connection reset' },
      { code: '42501', message: 'permission denied for table cupom_aprendizado' },
    ]) {
      const io = fakeIo({ async inserir() { return { erro } } })
      await expect(gravarAprendizado(POR_DESCRICAO, io)).rejects.toThrow(erro.message)
      expect(io.porEan).toHaveLength(0)
      expect(io.porDescricao).toHaveLength(0)
    }
  })

  it('erro sem mensagem ⇒ lança com texto padrão', async () => {
    const io = fakeIo({ async inserir() { return { erro: { code: '08006', message: '' } } } })
    await expect(gravarAprendizado(POR_DESCRICAO, io)).rejects.toThrow(/não consegui gravar o aprendizado/)
  })

  it('23505 mas o UPDATE não acha a linha ⇒ lança "não consegui atualizar" (nunca finge sucesso)', async () => {
    const porEan = fakeIo({ async inserir() { return JA_EXISTE }, async atualizarPorEan() { return false } })
    await expect(gravarAprendizado(POR_EAN, porEan)).rejects.toThrow(/não consegui atualizar o aprendizado que já existia/)
    const porDesc = fakeIo({ async inserir() { return JA_EXISTE }, async atualizarPorDescricao() { return false } })
    await expect(gravarAprendizado(POR_DESCRICAO, porDesc)).rejects.toThrow(/não consegui atualizar/)
  })

  it('23505 numa linha sem chave nenhuma (malformada: sem EAN, sem emitente ou sem descrição) ⇒ lança sem tentar UPDATE', async () => {
    for (const linha of [
      { ...POR_DESCRICAO, emitente_cnpj: null },
      { ...POR_DESCRICAO, descricao_norm: null },
      { ...POR_DESCRICAO, descricao_norm: '' },
    ]) {
      const io = fakeIo({ async inserir() { return JA_EXISTE } })
      await expect(gravarAprendizado(linha, io)).rejects.toThrow(/não consegui atualizar/)
      expect(io.porEan).toHaveLength(0)
      expect(io.porDescricao).toHaveLength(0)
    }
  })

  it('erro do banco no próprio UPDATE sobe como veio (quem conta como "não lembrado" é o tratar)', async () => {
    const io = fakeIo({ async inserir() { return JA_EXISTE }, async atualizarPorDescricao() { throw new Error('connection reset') } })
    await expect(gravarAprendizado(POR_DESCRICAO, io)).rejects.toThrow('connection reset')
  })
})

describe('index.ts — trava contra a volta do upsert (índices parciais ⇒ 42P10)', () => {
  // index.ts usa globais do Deno e o tsc o exclui: a checagem é no texto do código (sem as linhas de comentário), como na enviar-cupom.
  const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  it('grava com insert simples via gravarAprendizado; nunca upsert/onConflict', () => {
    expect(codigo).not.toMatch(/\.upsert\(|onConflict|on_conflict/)
    expect(codigo).toMatch(/\.insert\(/)
    expect(codigo).toMatch(/gravarAprendizado\(/)
  })
})
