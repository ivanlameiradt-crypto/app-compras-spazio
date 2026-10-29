import { interpretarIA, montarPedidoIA, tratar, validarPagamento, type Deps, type ModeloResposta } from './logica'
import { ESQUEMA_CUPOM, type LeituraCupomIA } from './esquema'
import { SISTEMA } from './prompt'
import type { Aprendizado } from './casamento'
import type { CnpjConhecido } from './cnpj'

const LEITURA_OK: LeituraCupomIA = {
  legivel: true, chave: null, emitente_cnpj: '12345678000190', emitente_nome: 'ATACADAO', valor_total: 9,
  itens: [{ descricao: 'ARROZ 5KG', quantidade: 1, unidade: 'UN', valor_unitario: 9, desconto: null, codigo_barras: '789' }],
}
const RESP = (leitura: LeituraCupomIA): ModeloResposta => ({ stop_reason: 'end_turn', texto: JSON.stringify(leitura) })

function fakeDeps(over: Partial<Deps> & { aprendizado?: Aprendizado[] } = {}): Deps & { gravou: Record<string, unknown>[]; disparou: string[] } {
  const gravou: Record<string, unknown>[] = []
  const disparou: string[] = []
  const base: Deps = {
    async buscarUsuario() { return { papel: 'admin', ativo: true } },
    async acharCupomPorFoto() { return null },
    async baixarFoto() { return { media_type: 'image/jpeg', base64: 'AAAA' } },
    async chamarModelo() { return { ok: true, resp: RESP(LEITURA_OK) } },
    async buscarAprendizado() { return over.aprendizado ?? [] },
    async inserirCupom(linha) { gravou.push(linha); return { id: 'c-novo' } },
    async dispararLancamento(id) { disparou.push(id) },
  }
  return Object.assign(base, over, { gravou, disparou }) as Deps & { gravou: Record<string, unknown>[]; disparou: string[] }
}
const CONFIRMADO: Aprendizado = {
  codigo_barras: '789', emitente_cnpj: '12345678000190', descricao_norm: 'arroz 5kg', insumo_id: '333',
  insumo_nome: 'ARROZ', fator_conversao: 1, unidade_destino: 'un', confirmado: true,
}
const PG = { forma: 'sem_cartao' } as const
const IVAN = 'ivan@spazio.com'

describe('validarPagamento', () => {
  it('sem_cartao ok; à vista exige conta; forma inválida recusa', () => {
    expect(validarPagamento({ forma: 'sem_cartao' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'pix', conta: 'X' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'pix' }).ok).toBe(false)
    expect(validarPagamento({ forma: 'cartao', conta: 'X' }).ok).toBe(false)
    expect(validarPagamento(null).ok).toBe(false)
  })

  it('dinheiro/tesouraria também exigem conta; a conta é aparada; sem_cartao descarta a conta', () => {
    expect(validarPagamento({ forma: 'dinheiro', conta: '  CAIXA  ' })).toEqual({ ok: true, pagamento: { forma: 'dinheiro', conta: 'CAIXA' } })
    expect(validarPagamento({ forma: 'tesouraria', conta: 'TESOURARIA' }).ok).toBe(true)
    expect(validarPagamento({ forma: 'dinheiro', conta: '   ' }).ok).toBe(false)
    expect(validarPagamento({ forma: 'sem_cartao', conta: 'X' })).toEqual({ ok: true, pagamento: { forma: 'sem_cartao' } })
  })

  it('tipos errados não passam: conta não-texto, forma não-texto, pagamento que não é objeto', () => {
    expect(validarPagamento({ forma: 'pix', conta: { x: 1 } }).ok).toBe(false)
    expect(validarPagamento({ forma: ['pix'], conta: 'X' }).ok).toBe(false)
    expect(validarPagamento('pix').ok).toBe(false)
    expect(validarPagamento(undefined).ok).toBe(false)
  })
})

describe('interpretarIA', () => {
  const resp = (l: unknown, stop = 'end_turn'): ModeloResposta => ({ stop_reason: stop, texto: JSON.stringify(l) })
  const CHAVE = '12345678901234567890123456789012345678901234' // 44 dígitos

  it('aceita uma leitura bem formada', () => {
    const r = interpretarIA(resp(LEITURA_OK))
    expect(r).toEqual({ ok: true, leitura: LEITURA_OK })
  })

  it('refusal, max_tokens, JSON inválido e fora do formato ⇒ ilegível', () => {
    expect(interpretarIA(resp(LEITURA_OK, 'refusal')).ok).toBe(false)
    expect(interpretarIA(resp(LEITURA_OK, 'max_tokens')).ok).toBe(false)
    expect(interpretarIA({ stop_reason: 'end_turn', texto: 'isto não é json' }).ok).toBe(false)
    expect(interpretarIA(resp({ ...LEITURA_OK, extra: 1 })).ok).toBe(false)
    expect(interpretarIA(resp({ ...LEITURA_OK, valor_total: 'x' })).ok).toBe(false)
  })

  it('C: chave vira só os 44 dígitos (grupos de 4, espaços, pontuação); ≠ 44 dígitos ⇒ null', () => {
    const chave = (c: string | null) => {
      const r = interpretarIA(resp({ ...LEITURA_OK, chave: c }))
      if (!r.ok) throw new Error('leitura deveria ser aceita')
      return r.leitura.chave
    }
    expect(chave(CHAVE)).toBe(CHAVE)
    expect(chave(CHAVE.replace(/(\d{4})(?=\d)/g, '$1 '))).toBe(CHAVE) // grupos de 4
    expect(chave(`NFe${CHAVE}`)).toBe(CHAVE)
    expect(chave(CHAVE.replace(/(\d{4})(?=\d)/g, '$1.'))).toBe(CHAVE)
    expect(chave(CHAVE.slice(0, 43))).toBeNull()
    expect(chave(`${CHAVE}5`)).toBeNull()
    expect(chave('sem chave')).toBeNull()
    expect(chave('')).toBeNull()
    expect(chave(null)).toBeNull()
  })

  it('C: emitente_cnpj vira só os 14 dígitos; ≠ 14 dígitos ⇒ null', () => {
    const cnpj = (c: string | null) => {
      const r = interpretarIA(resp({ ...LEITURA_OK, emitente_cnpj: c }))
      if (!r.ok) throw new Error('leitura deveria ser aceita')
      return r.leitura.emitente_cnpj
    }
    expect(cnpj('12345678000190')).toBe('12345678000190')
    expect(cnpj('12.345.678/0001-90')).toBe('12345678000190')
    expect(cnpj(' 12 345 678 0001 90 ')).toBe('12345678000190')
    expect(cnpj('123456780001')).toBeNull() // 12 dígitos
    expect(cnpj('123.456.789-09')).toBeNull() // CPF (11)
    expect(cnpj('')).toBeNull()
    expect(cnpj(null)).toBeNull()
  })

  it('C: normaliza, não recusa — chave em grupos de 4 e CNPJ formatado NÃO tornam a leitura ilegível; o resto fica igual', () => {
    const bruto = { ...LEITURA_OK, chave: CHAVE.replace(/(\d{4})(?=\d)/g, '$1 '), emitente_cnpj: '12.345.678/0001-90' }
    const r = interpretarIA(resp(bruto))
    expect(r).toEqual({ ok: true, leitura: { ...LEITURA_OK, chave: CHAVE, emitente_cnpj: '12345678000190' } })
  })
})

describe('montarPedidoIA', () => {
  it('1 imagem em base64 + instrução, prompt fixo, saída estruturada json_schema', () => {
    const p = montarPedidoIA({ media_type: 'image/png', base64: 'QUJD' }, 'claude-sonnet-5')
    expect(p).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 8000, system: SISTEMA })
    expect(p.output_config).toEqual({ format: { type: 'json_schema', schema: ESQUEMA_CUPOM } })
    const msgs = p.messages as { role: string; content: Record<string, unknown>[] }[]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } })
    expect(msgs[0].content[1]).toMatchObject({ type: 'text' })
  })
})

describe('tratar', () => {
  it('não-admin: 403, nada gravado nem disparado', async () => {
    const deps = fakeDeps({ async buscarUsuario() { return { papel: 'comprador', ativo: true } } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, 'joao@spazio.com', deps)
    expect(r.status).toBe(403)
    expect(deps.gravou).toHaveLength(0); expect(deps.disparou).toHaveLength(0)
  })

  it('admin inativo ou usuário que não existe: 403, sem baixar a foto nem chamar a IA', async () => {
    for (const usuario of [{ papel: 'admin', ativo: false }, null]) {
      let baixou = 0, modelo = 0
      const deps = fakeDeps({
        async buscarUsuario() { return usuario },
        async baixarFoto() { baixou++; return { media_type: 'image/jpeg', base64: 'AAAA' } },
        async chamarModelo() { modelo++; return { ok: false } },
      })
      const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
      expect(r.status).toBe(403)
      expect(baixou).toBe(0); expect(modelo).toBe(0)
      expect(deps.gravou).toHaveLength(0)
    }
  })

  it('o e-mail do chamador chega aparado e em minúsculas', async () => {
    let recebido = ''
    const deps = fakeDeps({ async buscarUsuario(email) { recebido = email; return { papel: 'admin', ativo: true } } })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, '  Ivan@Spazio.COM ', deps)
    expect(recebido).toBe('ivan@spazio.com')
  })

  it('sem foto_path: 400', async () => {
    const deps = fakeDeps()
    expect((await tratar({ pagamento: PG }, IVAN, deps)).status).toBe(400)
  })

  it('pagamento inválido: 400, nada gravado nem disparado', async () => {
    const deps = fakeDeps()
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: { forma: 'pix' } }, IVAN, deps)
    expect(r.status).toBe(400)
    expect(deps.gravou).toHaveLength(0); expect(deps.disparou).toHaveLength(0)
  })

  it('corpo que não é objeto (null): 400 em vez de estourar', async () => {
    const deps = fakeDeps()
    const r = await tratar(null as unknown as Record<string, unknown>, IVAN, deps)
    expect(r.status).toBe(400)
  })

  it('RF1: dedup por foto_path — já existe ⇒ devolve o id existente, sem 2º insert nem disparo', async () => {
    const deps = fakeDeps({ async acharCupomPorFoto() { return { id: 'c-velho' } } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-velho', duplicado: true })
    expect(deps.gravou).toHaveLength(0); expect(deps.disparou).toHaveLength(0)
  })

  it('RF1: o dedup vem ANTES de baixar a foto e de chamar a IA (reenvio não gasta a leitura)', async () => {
    let baixou = 0, modelo = 0
    const deps = fakeDeps({
      async acharCupomPorFoto() { return { id: 'c-velho' } },
      async baixarFoto() { baixou++; return { media_type: 'image/jpeg', base64: 'AAAA' } },
      async chamarModelo() { modelo++; return { ok: false } },
    })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(baixou).toBe(0); expect(modelo).toBe(0)
  })

  it('RF2: foto ilegível (IA falha) ⇒ grava REVISAR "não consegui ler", não dispara', async () => {
    const deps = fakeDeps({ async chamarModelo() { return { ok: false } } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' })
    expect(String(deps.gravou[0].motivo)).toMatch(/ler a foto/i)
    expect(deps.disparou).toHaveLength(0)
    expect(r.corpo).toMatchObject({ estado: 'REVISAR' })
  })

  it('RF2: valor_a_pagar é NOT NULL no Plano 1 — a linha de foto ilegível grava 0, nunca null', async () => {
    const deps = fakeDeps({ async chamarModelo() { return { ok: false } } })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0].valor_a_pagar).toBe(0)
    expect(deps.gravou[0]).toMatchObject({ itens: [], pagamento: { forma: 'sem_cartao' }, foto_path: 'cupom/a.jpg' })
  })

  it('RF2: saída do modelo fora do formato (texto solto / recusa) ⇒ REVISAR, não dispara', async () => {
    for (const resp of [
      { stop_reason: 'end_turn', texto: 'não consigo ler' },
      { stop_reason: 'refusal', texto: JSON.stringify(LEITURA_OK) },
    ]) {
      const deps = fakeDeps({ aprendizado: [CONFIRMADO], async chamarModelo() { return { ok: true, resp } } })
      await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
      expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' }); expect(deps.disparou).toHaveLength(0)
    }
  })

  it('RF2b: legivel=false (0 itens) ⇒ REVISAR, não dispara', async () => {
    const vazio = { ...LEITURA_OK, legivel: false, itens: [] }
    const deps = fakeDeps({ async chamarModelo() { return { ok: true, resp: RESP(vazio) } } })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' }); expect(deps.disparou).toHaveLength(0)
  })

  it('tudo casado (aprendizado confirmado) ⇒ PENDENTE + dispara uma vez', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO] })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'PENDENTE', foto_path: 'cupom/a.jpg' })
    expect(deps.disparou).toEqual(['c-novo'])
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true })
  })

  it('confirmar antes (pedido do Ivan, 08/10): tudo casado ⇒ REVISAR com motivo CONFIRMAR:, itens já associados e NADA é disparado', async () => {
    const deps = { ...fakeDeps({ aprendizado: [CONFIRMADO] }), exigirConfirmacao: true }
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR', foto_path: 'cupom/a.jpg' })
    expect(String(deps.gravou[0].motivo)).toMatch(/^CONFIRMAR: 1 item\(ns\) já conhecido\(s\)/)
    expect((deps.gravou[0].itens as { sugestao_produto: { id: string } }[])[0].sugestao_produto).toEqual({ id: '333' })   // já vem associado
    expect(deps.disparou).toEqual([])
    expect(r.corpo).toMatchObject({ estado: 'REVISAR', disparo_ok: false, resumo: 'todos os itens já conhecidos — confira e confirme no app' })
  })

  it('confirmar antes não muda os outros casos: item incerto continua REVISAR com o motivo de sempre', async () => {
    const deps = { ...fakeDeps({ aprendizado: [] }), exigirConfirmacao: true }
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(String(deps.gravou[0].motivo)).toMatch(/sem casamento confirmado/)
    expect(String(deps.gravou[0].motivo)).not.toMatch(/CONFIRMAR:/)
  })

  it('a linha PENDENTE sai no formato do contrato do robô (itens, pagamento, total, emitente)', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO] })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: { forma: 'pix', conta: 'PIX ITAU IJ' } }, IVAN, deps)
    expect(deps.gravou[0]).toEqual({
      estado: 'PENDENTE', pagamento: { forma: 'pix', conta: 'PIX ITAU IJ' }, foto_path: 'cupom/a.jpg', teste: false,
      chave: null, emitente_cnpj: '12345678000190', emitente_nome: 'ATACADAO', valor_a_pagar: 9, motivo: null,
      itens: [{
        sugestao_produto: { id: '333' }, entrada_estoque: 1, valor_unitario: 9, desconto_item: 0,
        descricao_cupom: 'ARROZ 5KG', unidade_cupom: 'UN', codigo_barras: '789', casado_por: 'ean', proposta: null, quantidade_cupom: 1,
      }],
    })
  })

  it('o aprendizado é buscado pelos EANs e pelas chaves (cnpj + descrição normalizada) da leitura', async () => {
    let recebido: { eans: string[]; chaves: { cnpj: string; desc: string }[] } | null = null
    const deps = fakeDeps({ async buscarAprendizado(eans, chaves) { recebido = { eans, chaves }; return [] } })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(recebido).toEqual({ eans: ['789'], chaves: [{ cnpj: '12345678000190', desc: 'arroz 5kg' }] })
  })

  it('RF4: um item incerto (sem aprendizado) ⇒ a linha toda vira REVISAR, não dispara', async () => {
    const deps = fakeDeps({ aprendizado: [] }) // nada confirmado
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' }); expect(deps.disparou).toHaveLength(0)
    expect(String(deps.gravou[0].motivo)).toMatch(/1 item/)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-novo', estado: 'REVISAR', disparo_ok: false }) // nada foi disparado
  })

  it('RF4: aprendizado só NÃO confirmado não auto-casa ⇒ REVISAR (a busca já traz só confirmados, e o casamento confere de novo)', async () => {
    const deps = fakeDeps({ aprendizado: [{ ...CONFIRMADO, confirmado: false }] })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' }); expect(deps.disparou).toHaveLength(0)
  })

  it('um item casado e outro incerto ⇒ REVISAR; a linha guarda os dois, o casado já convertido', async () => {
    const leitura: LeituraCupomIA = {
      ...LEITURA_OK, valor_total: 20,
      itens: [...LEITURA_OK.itens, { descricao: 'ITEM NOVO', quantidade: 1, unidade: 'UN', valor_unitario: 11, desconto: null, codigo_barras: null }],
    }
    const deps = fakeDeps({ aprendizado: [CONFIRMADO], async chamarModelo() { return { ok: true, resp: RESP(leitura) } } })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR' })
    const itens = deps.gravou[0].itens as { sugestao_produto: { id: string } | null }[]
    expect(itens.map((i) => i.sugestao_produto)).toEqual([{ id: '333' }, null])
    expect(deps.disparou).toHaveLength(0)
  })

  it('RF5: disparo falha ⇒ devolve cupom_id com disparo_ok:false, sem lançar exceção (reaper reconcilia)', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO], async dispararLancamento() { throw new Error('sem GITHUB_PAT') } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-novo', estado: 'PENDENTE', disparo_ok: false })
    expect(deps.gravou[0]).toMatchObject({ estado: 'PENDENTE' })
  })

  it('RF5: a mensagem do disparo que falhou diz a verdade — ficou PENDENTE, nada o relança sozinho, o reaper só marca para conferir depois de ~60 min', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO], async dispararLancamento() { throw new Error('sem GITHUB_PAT') } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    const resumo = String(r.corpo.resumo)
    expect(resumo).toMatch(/PENDENTE/)
    expect(resumo).toMatch(/sozinho/)
    expect(resumo).toMatch(/60 min/)
    expect(resumo).not.toMatch(/recuperad/i) // o antigo "vai ser recuperado" prometia o que não acontece
    // quando o disparo dá certo, a mensagem segue a de sempre
    const ok = await tratar({ foto_path: 'cupom/b.jpg', pagamento: PG }, IVAN, fakeDeps({ aprendizado: [CONFIRMADO] }))
    expect(ok.corpo.resumo).toBe('enviado para lançar')
  })

  it('passa teste=true para a linha gravada (e só teste === true liga o marcador)', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO] })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG, teste: true }, IVAN, deps)
    expect(deps.gravou[0]).toMatchObject({ teste: true })
    const deps2 = fakeDeps({ aprendizado: [CONFIRMADO] })
    await tratar({ foto_path: 'cupom/b.jpg', pagamento: PG, teste: 'true' }, IVAN, deps2)
    expect(deps2.gravou[0]).toMatchObject({ teste: false })
  })

  // ---- Correção B: o insert pode bater em índice único (23505) — corrida no mesmo foto_path, ou 2ª foto do mesmo cupom
  // (mesma chave). inserirCupom devolve a linha existente com duplicado:true; nunca se dispara o workflow nesse caso.
  it('B: inserirCupom devolve duplicado (23505) ⇒ devolve o existente, duplicado:true, NUNCA dispara', async () => {
    const deps = fakeDeps({ aprendizado: [CONFIRMADO], async inserirCupom() { return { id: 'c-existente', duplicado: true } } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-existente', duplicado: true })
    expect(r.corpo.estado).toBeUndefined()
    expect(deps.disparou).toHaveLength(0)
  })

  it('B: o mesmo vale no caminho da foto ilegível (duplicado ⇒ sem disparo, duplicado:true)', async () => {
    const deps = fakeDeps({ async chamarModelo() { return { ok: false } }, async inserirCupom() { return { id: 'c-existente', duplicado: true } } })
    const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(r.corpo).toMatchObject({ cupom_id: 'c-existente', duplicado: true })
    expect(deps.disparou).toHaveLength(0)
  })

  // ---- Correção C: chave e CNPJ normalizados em interpretarIA estabilizam o índice único da chave e a chave de aprendizado.
  it('C: CNPJ formatado e chave em grupos de 4 — a linha grava só dígitos e o aprendizado (cnpj só dígitos) casa pela descrição', async () => {
    const CHAVE = '12345678901234567890123456789012345678901234'
    const leitura: LeituraCupomIA = {
      ...LEITURA_OK, chave: CHAVE.replace(/(\d{4})(?=\d)/g, '$1 '), emitente_cnpj: '12.345.678/0001-90',
      itens: [{ ...LEITURA_OK.itens[0], codigo_barras: null }], // sem EAN: só a descrição + emitente casa
    }
    let chavesRecebidas: { cnpj: string; desc: string }[] = []
    const deps = fakeDeps({
      async chamarModelo() { return { ok: true, resp: RESP(leitura) } },
      async buscarAprendizado(_eans, chaves) { chavesRecebidas = chaves; return [{ ...CONFIRMADO, codigo_barras: null }] },
    })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(chavesRecebidas).toEqual([{ cnpj: '12345678000190', desc: 'arroz 5kg' }])
    expect(deps.gravou[0]).toMatchObject({ estado: 'PENDENTE', chave: CHAVE, emitente_cnpj: '12345678000190' })
    expect(deps.disparou).toEqual(['c-novo'])
  })

  it('C: CNPJ que não tem 14 dígitos vira null — sem chave de aprendizado por descrição (só EAN), e a linha grava null', async () => {
    const leitura: LeituraCupomIA = { ...LEITURA_OK, emitente_cnpj: '12345' }
    let chavesRecebidas: { cnpj: string; desc: string }[] | null = null
    const deps = fakeDeps({
      async chamarModelo() { return { ok: true, resp: RESP(leitura) } },
      async buscarAprendizado(_eans, chaves) { chavesRecebidas = chaves; return [] },
    })
    await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
    expect(chavesRecebidas).toEqual([])
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: null })
  })

  // ---- valor_a_pagar é NOT NULL no Plano 1 e o robô confere a soma dos itens contra ele: sem total legível não se lança.
  it('total ilegível (valor_total null ou ≤ 0) ⇒ REVISAR, não dispara, motivo cita o total, valor_a_pagar 0', async () => {
    for (const valor_total of [null, 0, -3]) {
      const leitura: LeituraCupomIA = { ...LEITURA_OK, valor_total }
      const deps = fakeDeps({ aprendizado: [CONFIRMADO], async chamarModelo() { return { ok: true, resp: RESP(leitura) } } })
      const r = await tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)
      expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR', valor_a_pagar: 0 })
      expect(String(deps.gravou[0].motivo)).toMatch(/total/i)
      expect(deps.disparou).toHaveLength(0)
      expect(r.corpo).toMatchObject({ estado: 'REVISAR', disparo_ok: false })
    }
  })
})

// ---- CNPJ lido errado na foto (pedido do Ivan, 29/10/2026). A leitura às vezes troca UM número do CNPJ (22/10: "8" virou "0" no da A. N. da Silva) e o cupom para em
// "fornecedor não encontrado", com o aprendizado gravado no CNPJ errado. Se o CNPJ lido NÃO fecha as contas e existe UM só CNPJ conhecido (válido, a um dígito, nome
// compatível), a leitura passa a usar esse: a busca do aprendizado, o casamento e a linha gravada recebem o certo. A dep `cnpjsConhecidos` é opcional e NUNCA derruba o envio.
describe('tratar — CNPJ lido errado na foto', () => {
  const SILVA_ERRADO = '63540861000102' // o caso real de 22/10
  const SILVA_CERTO = '63540861000182'
  const NOME_SILVA = 'A. N. DA SILVA DESCARTAVEIS LTDA'
  const CONHECIDOS: CnpjConhecido[] = [
    { cnpj: '03995515011363', nome: 'MATEUS SUPERMERCADOS SA' },
    { cnpj: '75315333032655', nome: 'ATACADAO S.A.' },
    { cnpj: '05054671003840', nome: 'LIDER COMERCIO E INDUSTRIA LTDA' },
    { cnpj: SILVA_CERTO, nome: NOME_SILVA },
  ]
  const FRASE_CORRIGIDO = `corrigi o CNPJ lido na foto: era 63.540.861/0001-02, agora 63.540.861/0001-82, o da ${NOME_SILVA}`
  const FRASE_INVALIDO = 'o CNPJ lido na foto (63.540.861/0001-02) não fecha as contas dos números: confira na foto'
  const APRENDIDO_DA_SILVA: Aprendizado = { ...CONFIRMADO, codigo_barras: null, emitente_cnpj: SILVA_CERTO }

  /** Sem EAN no item: só o CNPJ + a descrição casam, então só o CNPJ CERTO acha o aprendizado. */
  const leituraSilva = (over: Partial<LeituraCupomIA> = {}): LeituraCupomIA => ({
    ...LEITURA_OK, emitente_cnpj: SILVA_ERRADO, emitente_nome: 'A. N. DA SILVA DESCARTAVEIS',
    itens: [{ ...LEITURA_OK.itens[0], codigo_barras: null }], ...over,
  })
  /** O aprendizado confirmado só existe para o CNPJ certo e só vem quando a busca o pede (como o filtro `emitente_cnpj.in.(…)` do SQL). */
  function depsSilva(over: Partial<Deps> = {}, leitura: LeituraCupomIA = leituraSilva()) {
    const buscas: { eans: string[]; chaves: { cnpj: string; desc: string }[] }[] = []
    const deps = fakeDeps({
      async chamarModelo() { return { ok: true, resp: RESP(leitura) } },
      async buscarAprendizado(eans, chaves) { buscas.push({ eans, chaves }); return chaves.some((k) => k.cnpj === SILVA_CERTO) ? [APRENDIDO_DA_SILVA] : [] },
      async cnpjsConhecidos() { return CONHECIDOS },
      ...over,
    })
    return Object.assign(deps, { buscas })
  }
  const enviar = (deps: Deps) => tratar({ foto_path: 'cupom/a.jpg', pagamento: PG }, IVAN, deps)

  it('corrigido: o CNPJ certo é o que chega na busca do aprendizado, no casamento e na linha gravada; o nome lido fica como veio', async () => {
    const deps = depsSilva()
    await enviar(deps)
    // 1) buscarAprendizado
    expect(deps.buscas).toEqual([{ eans: [], chaves: [{ cnpj: SILVA_CERTO, desc: 'arroz 5kg' }] }])
    // 2) casarItens: o aprendizado é do CNPJ certo, então o item só casa se o casamento usou o CNPJ corrigido
    // 3) inserirCupom: a linha leva o CNPJ certo
    expect(deps.gravou[0]).toMatchObject({ estado: 'PENDENTE', emitente_cnpj: SILVA_CERTO, emitente_nome: 'A. N. DA SILVA DESCARTAVEIS' })
    expect((deps.gravou[0].itens as { sugestao_produto: { id: string } | null; casado_por: string }[])[0]).toMatchObject({ sugestao_produto: { id: '333' }, casado_por: 'descricao' })
    expect(deps.disparou).toEqual(['c-novo'])
  })

  it('o resto da leitura não muda: itens, total e chave seguem como a IA leu', async () => {
    const CHAVE = '12345678901234567890123456789012345678901234'
    const deps = depsSilva({}, leituraSilva({ chave: CHAVE, valor_total: 9 }))
    await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ chave: CHAVE, valor_a_pagar: 9 })
    expect((deps.gravou[0].itens as { descricao_cupom: string; quantidade_cupom: number }[])[0]).toMatchObject({ descricao_cupom: 'ARROZ 5KG', quantidade_cupom: 1 })
  })

  it('o resumo ganha a frase da correção (cupom que sai para lançar), sem ponto final', async () => {
    const r = await enviar(depsSilva())
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: true, resumo: `enviado para lançar; ${FRASE_CORRIGIDO}` })
  })

  it('o resumo da correção também vem no cupom que espera o Ivan: item incerto, ou "confirmar antes"', async () => {
    const incerto = await enviar(depsSilva({ async buscarAprendizado() { return [] } }))
    expect(incerto.corpo).toMatchObject({ estado: 'REVISAR', resumo: `1 item(ns) para você conferir; ${FRASE_CORRIGIDO}` })
    const confirmar = await enviar({ ...depsSilva(), exigirConfirmacao: true })
    expect(confirmar.corpo).toMatchObject({ estado: 'REVISAR', resumo: `todos os itens já conhecidos — confira e confirme no app; ${FRASE_CORRIGIDO}` })
  })

  it('o disparo que falhou continua dito por inteiro, e a frase da correção vem depois', async () => {
    const r = await enviar(depsSilva({ async dispararLancamento() { throw new Error('sem GITHUB_PAT') } }))
    const resumo = String(r.corpo.resumo)
    expect(resumo).toMatch(/^enviado, mas o disparo automático falhou/)
    expect(resumo.endsWith(`; ${FRASE_CORRIGIDO}`)).toBe(true)
    expect(r.corpo).toMatchObject({ estado: 'PENDENTE', disparo_ok: false })
  })

  it('sem a correção o mesmo cupom NÃO casaria: o CNPJ errado não acha o aprendizado do certo (prova de que é o certo que casa)', async () => {
    const deps = depsSilva({ cnpjsConhecidos: undefined })
    const r = await enviar(deps)
    expect(deps.buscas).toEqual([{ eans: [], chaves: [{ cnpj: SILVA_ERRADO, desc: 'arroz 5kg' }] }])
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR', emitente_cnpj: SILVA_ERRADO })
    expect(r.corpo.resumo).toBe('1 item(ns) para você conferir')
  })

  it('CNPJ que fecha as contas NUNCA é tocado: a lista de conhecidos nem é pedida e o resumo é o de sempre', async () => {
    let pedidos = 0
    const deps = depsSilva({ async cnpjsConhecidos() { pedidos++; return CONHECIDOS } }, leituraSilva({ emitente_cnpj: SILVA_CERTO }))
    const r = await enviar(deps)
    expect(pedidos).toBe(0)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_CERTO })
    expect(r.corpo.resumo).toBe('enviado para lançar')
  })

  it('CNPJ válido com outro CNPJ válido a UM dígito na lista: continua o que a IA leu', async () => {
    // 02164629000100 e 22164629000100 fecham as contas e diferem em um dígito (raro, mas existe)
    const lido = '22164629000100'
    const deps = depsSilva({ async cnpjsConhecidos() { return [{ cnpj: '02164629000100', nome: null }] } }, leituraSilva({ emitente_cnpj: lido }))
    const r = await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: lido })
    expect(String(r.corpo.resumo)).not.toMatch(/CNPJ/)
  })

  it('sem CNPJ lido: a lista de conhecidos nem é pedida, nada é avisado', async () => {
    let pedidos = 0
    const deps = depsSilva({ async cnpjsConhecidos() { pedidos++; return CONHECIDOS } }, leituraSilva({ emitente_cnpj: null }))
    const r = await enviar(deps)
    expect(pedidos).toBe(0)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: null })
    expect(r.corpo.resumo).toBe('1 item(ns) para você conferir')
  })

  it('o CNPJ lido com pontuação ("63.540.861/0001-02") também é corrigido (interpretarIA já o normaliza para os 14 dígitos)', async () => {
    const deps = depsSilva({}, leituraSilva({ emitente_cnpj: '63.540.861/0001-02' }))
    await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_CERTO })
  })

  it('o mesmo CNPJ conhecido por várias fontes conta UMA vez e corrige', async () => {
    const repetidos = [...CONHECIDOS, { cnpj: SILVA_CERTO, nome: 'A. N. DA SILVA DESCARTAVEIS' }, { cnpj: SILVA_CERTO, nome: null }]
    const deps = depsSilva({ async cnpjsConhecidos() { return repetidos } })
    const r = await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_CERTO })
    expect(r.corpo.resumo).toBe(`enviado para lançar; ${FRASE_CORRIGIDO}`)
  })

  it('dois candidatos distintos a um dígito: não corrige, o CNPJ fica como veio e o resumo avisa', async () => {
    // 12345678000195 e 02348678000195 fecham as contas; o lido 02345678000195 está a UM dígito dos dois
    const lido = '02345678000195'
    const deps = depsSilva({ async cnpjsConhecidos() { return [{ cnpj: '12345678000195', nome: null }, { cnpj: '02348678000195', nome: null }] } },
      leituraSilva({ emitente_cnpj: lido, emitente_nome: null }))
    const r = await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: lido })
    expect(r.corpo.resumo).toBe('1 item(ns) para você conferir; o CNPJ lido na foto (02.345.678/0001-95) não fecha as contas dos números: confira na foto')
  })

  it('nenhum candidato (lista vazia, só outros fornecedores, ou o CNPJ certo a 2 dígitos): não corrige, o CNPJ fica como veio e o resumo avisa', async () => {
    const casos: [CnpjConhecido[], string, string][] = [
      [[], SILVA_ERRADO, '63.540.861/0001-02'],
      [CONHECIDOS.slice(0, 3), SILVA_ERRADO, '63.540.861/0001-02'], // a A. N. da Silva não está na lista
      [CONHECIDOS, '53540861000102', '53.540.861/0001-02'],          // dois dígitos trocados ("6" virou "5" e "8" virou "0"): fora do alcance, de propósito
    ]
    for (const [conhecidos, lido, formatado] of casos) {
      const deps = depsSilva({ async cnpjsConhecidos() { return conhecidos } }, leituraSilva({ emitente_cnpj: lido }))
      const r = await enviar(deps)
      expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR', emitente_cnpj: lido })
      expect(deps.buscas[0].chaves).toEqual([{ cnpj: lido, desc: 'arroz 5kg' }])
      expect(r.corpo.resumo).toBe(`1 item(ns) para você conferir; o CNPJ lido na foto (${formatado}) não fecha as contas dos números: confira na foto`)
    }
  })

  it('candidato com nome incompatível: não corrige e avisa', async () => {
    const deps = depsSilva({}, leituraSilva({ emitente_nome: 'PADARIA PAO QUENTE' }))
    const r = await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_ERRADO, emitente_nome: 'PADARIA PAO QUENTE' })
    expect(r.corpo.resumo).toBe(`1 item(ns) para você conferir; ${FRASE_INVALIDO}`)
  })

  it('nome ausente no cupom lido: vale, corrige só pelo número', async () => {
    const deps = depsSilva({}, leituraSilva({ emitente_nome: null }))
    await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_CERTO, emitente_nome: null })
  })

  it('sem a dep `cnpjsConhecidos`: nada muda, nem o resumo (CNPJ inválido continua passando em silêncio, como hoje)', async () => {
    const deps = depsSilva({ cnpjsConhecidos: undefined })
    const r = await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_ERRADO })
    expect(String(r.corpo.resumo)).not.toMatch(/CNPJ/)
  })

  it('a dep que falha (rejeita, lança na hora, ou devolve lixo) NUNCA derruba o envio: vale a leitura como veio, sem frase', async () => {
    const falhas: (() => Promise<CnpjConhecido[]>)[] = [
      async () => { throw new Error('connection reset') },
      () => { throw new Error('lançou na hora') },
      async () => undefined as unknown as CnpjConhecido[],
      async () => null as unknown as CnpjConhecido[],
      async () => 'isto não é uma lista' as unknown as CnpjConhecido[],
    ]
    for (const cnpjsConhecidos of falhas) {
      const deps = depsSilva({ cnpjsConhecidos })
      const r = await enviar(deps)
      expect(r.status).toBe(200)
      expect(deps.gravou).toHaveLength(1)
      expect(deps.gravou[0]).toMatchObject({ emitente_cnpj: SILVA_ERRADO })
      expect(r.corpo.resumo).toBe('1 item(ns) para você conferir')
    }
  })

  it('foto ilegível ou cupom já recebido: a lista de conhecidos nem é pedida; o duplicado não leva a frase', async () => {
    let pedidos = 0
    const contar = { async cnpjsConhecidos() { pedidos++; return CONHECIDOS } }
    await enviar(depsSilva({ ...contar, async chamarModelo() { return { ok: false } } }))
    await enviar(depsSilva({ ...contar, async acharCupomPorFoto() { return { id: 'c-velho' } } }))
    expect(pedidos).toBe(0)
    const corrida = await enviar(depsSilva({ async inserirCupom() { return { id: 'c-existente', duplicado: true } } }))
    expect(corrida.corpo).toEqual({ cupom_id: 'c-existente', resumo: 'já recebido', duplicado: true })
  })

  it('a frase não muda o estado nem o motivo: o cupom segue o caminho de sempre (incerto ⇒ REVISAR com o motivo de sempre)', async () => {
    const deps = depsSilva({ async buscarAprendizado() { return [] } })
    await enviar(deps)
    expect(deps.gravou[0]).toMatchObject({ estado: 'REVISAR', motivo: '1 item(ns) sem casamento confirmado — confira no Code' })
  })
})
