import { interpretarIA, montarPedidoIA, tratar, validarPagamento, type Deps, type ModeloResposta } from './logica'
import { ESQUEMA_CUPOM, type LeituraCupomIA } from './esquema'
import { SISTEMA } from './prompt'
import type { Aprendizado } from './casamento'

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
