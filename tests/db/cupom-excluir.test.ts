import type { PGlite } from '@electric-sql/pglite'
import { bancoPorArquivo, como } from './banco'
import { semear, ADMIN, JOAO } from './fixture'
import { erroDe } from './fixture-cotacao'

// Excluir cupom e compra avulsa (pedido do Ivan, 03/11/2026): cupom_excluir / cupom_restaurar (20261225000001_cupom_excluir.sql).
// A tabela `cupom` é do robô do cupom (copiada no shim); o estado novo 'EXCLUIDO' faz o robô ignorar a linha (ele só reivindica PENDENTE).
// Revisão independente de 04/11: o que está na fila (PENDENTE) NÃO se exclui; a frase que o reaper grava num PENDENTE parado é a única exceção da trava do "parou no meio do SisChef".
const atual = bancoPorArquivo(semear)
const banco = async () => atual()

const ID = '00000000-0000-0000-0000-0000000000c1'
const ID2 = '00000000-0000-0000-0000-0000000000c2'
const ID3 = '00000000-0000-0000-0000-0000000000c3'
const AVISO = 'CONFERIR NO SISCHEF antes de repetir'                      // o AVISO_CONFERIR do robô (cupom_lancar.py)
const PAROU_NO_MEIO = 'o robô começou a lançar este cupom e parou no meio: confira no SisChef antes de excluir'

/** Insere uma linha de cupom como o robô/as funções do servidor a deixariam (o teste entra como dono do banco). */
async function criar(db: PGlite, estado: string, extra: { id?: string; motivo?: string | null; pedido?: string | null; origem?: string; teste?: boolean; processando?: string | null } = {}): Promise<string> {
  const id = extra.id ?? ID
  await db.query(
    `insert into cupom (id, estado, motivo, pedido_sischef, teste, origem, valor_a_pagar, itens, pagamento, processando_desde)
     values ($1, $2, $3, $4, $5, $6, 12.5, '[]'::jsonb, '{}'::jsonb, $7)`,
    [id, estado, extra.motivo ?? null, extra.pedido ?? null, extra.teste ?? false, extra.origem ?? 'cupom', extra.processando ?? null])
  return id
}
const excluir = (db: PGlite, quem: string, id = ID, motivo: string | null = 'devolvido') => como(db, quem, 'select cupom_excluir($1, $2)', [id, motivo])
const restaurar = (db: PGlite, quem: string, id = ID) => como(db, quem, 'select cupom_restaurar($1)', [id])
async function linha(db: PGlite, id = ID) {
  const [r] = await como(db, ADMIN, `select estado, motivo, pedido_sischef, excluido_em, excluido_por, excluido_motivo, estado_antes_de_excluir
    from cupom where id = $1`, [id])
  return r
}
/** O que o robô faz ao pegar um cupom (reivindicar_cupom, do repositório do robô): só vence se ainda estava PENDENTE e sem pedido. */
async function robôReivindica(db: PGlite, id = ID): Promise<boolean> {
  const r = await db.query(`update cupom set estado = 'PROCESSANDO', processando_desde = now() where id = $1 and estado = 'PENDENTE' and pedido_sischef is null returning id`, [id])
  return r.rows.length === 1
}

describe('excluir cupom e compra avulsa (cupom_excluir / cupom_restaurar)', () => {
  it('o admin exclui o cupom que precisa dele (REVISAR) ou o de teste (TESTE): guarda de onde veio, quem, quando e por quê', async () => {
    const db = await banco()
    for (const [i, estado] of (['REVISAR', 'TESTE'] as const).entries()) {
      const id = `00000000-0000-0000-0000-00000000010${i}`
      await criar(db, estado, { id, motivo: estado === 'REVISAR' ? 'fornecedor não encontrado no Sischef' : null })
      await excluir(db, ADMIN, id, 'devolvido ao fornecedor')
      const l = await linha(db, id)
      expect([estado, l.estado, l.estado_antes_de_excluir, l.excluido_motivo]).toEqual([estado, 'EXCLUIDO', estado, 'devolvido ao fornecedor'])
      expect(l.excluido_em).not.toBeNull()
      expect(String(l.excluido_por)).toContain('@')
    }
  })

  it('sem motivo (vazio ou só espaços) vira NULL e o motivo longo é cortado em 300; o banco recusa mais que isso por outra via', async () => {
    const db = await banco()
    await criar(db, 'REVISAR', { id: ID })
    await criar(db, 'REVISAR', { id: ID2 })
    await criar(db, 'REVISAR', { id: ID3 })
    await excluir(db, ADMIN, ID, '   ')
    expect((await linha(db, ID)).excluido_motivo).toBeNull()
    await excluir(db, ADMIN, ID2, null)
    expect((await linha(db, ID2)).excluido_motivo).toBeNull()
    await excluir(db, ADMIN, ID3, 'x'.repeat(500))
    expect(String((await linha(db, ID3)).excluido_motivo).length).toBe(300)
    await expect(db.query(`update cupom set excluido_motivo = $1 where id = $2`, ['y'.repeat(301), ID3])).rejects.toThrow(/check/)
  })

  it('compra avulsa (origem avulsa) se exclui e se restaura do mesmo jeito', async () => {
    const db = await banco()
    await criar(db, 'REVISAR', { origem: 'avulsa', motivo: 'fornecedor não encontrado no Sischef' })
    await excluir(db, ADMIN)
    expect((await linha(db)).estado).toBe('EXCLUIDO')
    await restaurar(db, ADMIN)
    expect((await linha(db)).estado).toBe('REVISAR')
  })

  it('restaurar devolve EXATAMENTE como estava (REVISAR com o motivo do robô intacto, ou TESTE) e limpa as marcas', async () => {
    const db = await banco()
    const casos = [['REVISAR', 'CONFIRMAR:3 itens'], ['TESTE', null]] as const
    for (const [i, [estado, motivo]] of casos.entries()) {
      const id = `00000000-0000-0000-0000-00000000020${i}`
      await criar(db, estado, { id, motivo })
      await excluir(db, ADMIN, id)
      await restaurar(db, ADMIN, id)
      const l = await linha(db, id)
      expect([estado, l.estado, l.motivo, l.excluido_em, l.excluido_por, l.excluido_motivo, l.estado_antes_de_excluir])
        .toEqual([estado, estado, motivo, null, null, null, null])
    }
  })

  it('é idempotente: excluir de novo não troca quem nem o motivo; restaurar o que não está excluído não faz nada; id desconhecido é recusado', async () => {
    const db = await banco()
    await criar(db, 'REVISAR')
    await excluir(db, ADMIN, ID, 'primeiro motivo')
    const antes = await linha(db)
    await excluir(db, ADMIN, ID, 'outro motivo')
    expect(await linha(db)).toEqual(antes)
    await restaurar(db, ADMIN)
    await restaurar(db, ADMIN)                                                // já estava na lista: nada a fazer, sem erro
    expect((await linha(db)).estado).toBe('REVISAR')
    expect(await erroDe(excluir(db, ADMIN, ID2))).toBe('cupom não encontrado')
    expect(await erroDe(restaurar(db, ADMIN, ID2))).toBe('cupom não encontrado')
    await criar(db, 'PENDENTE', { id: ID3 })
    await restaurar(db, ADMIN, ID3)                                           // nunca foi excluído: continua PENDENTE (não vira REVISAR) e não gera histórico
    expect((await linha(db, ID3)).estado).toBe('PENDENTE')
    expect(await como(db, ADMIN, `select 1 from historico_alteracoes where tabela = 'cupom' and registro = $1`, [ID3])).toHaveLength(0)
  })

  it('NUNCA o cupom já lançado (LANCADO ou com pedido no SisChef), o que o robô está lançando agora (PROCESSANDO) nem o que está na fila (PENDENTE)', async () => {
    const db = await banco()
    await criar(db, 'LANCADO', { id: ID, pedido: '987654' })
    expect(await erroDe(excluir(db, ADMIN, ID))).toBe('este cupom já foi lançado no SisChef: para desfazer, cancele a entrada lá')
    await criar(db, 'REVISAR', { id: ID2, pedido: '555', motivo: 'CONFIRMAR:1 item' })           // parado, mas já com pedido no SisChef
    expect(await erroDe(excluir(db, ADMIN, ID2))).toBe('este cupom já foi lançado no SisChef: para desfazer, cancele a entrada lá')
    await criar(db, 'PROCESSANDO', { id: ID3 })
    expect(await erroDe(excluir(db, ADMIN, ID3))).toBe('o robô está lançando este cupom agora: aguarde terminar')
    const NA_FILA = '00000000-0000-0000-0000-0000000000c4'
    await criar(db, 'PENDENTE', { id: NA_FILA })                                                 // revisão de 04/11: na fila o robô vai lançar; não se exclui
    expect(await erroDe(excluir(db, ADMIN, NA_FILA))).toBe('este cupom está na fila e o robô vai lançá-lo: se ele travar, o app o mostra como "precisa de você" depois de cerca de 1 hora, e aí dá para excluir')
    for (const id of [ID, ID2, ID3, NA_FILA]) expect((await linha(db, id)).excluido_em).toBeNull()
    expect((await linha(db, NA_FILA)).estado).toBe('PENDENTE')
  })

  it('NUNCA o REVISAR que o robô deixou no meio do SisChef (a compra PODE existir lá): as mesmas palavras que a tela usa, sem ligar para maiúsculas nem espaços; os outros motivos de REVISAR podem', async () => {
    const db = await banco()
    const noMeio = [
      'CONFERIR NO SISCHEF: o pedido foi aberto e o robô parou',
      'parou depois de GERAR_COMPRA_CLICADO',
      'parou depois de FINALIZAR_COMPRA_CLICADO',
      'falha ao preencher o pagamento no Sischef: campo não achado',
      'conferir no sischef: tudo em minúsculas',                       // a tela e o banco ignoram maiúsculas (flag i / ~*)
      '\nCONFERIR NO SISCHEF: erro inesperado',   // a quebra de linha também é tirada nas pontas (o banco tira espaço, tab, CR e LF, como o .trim() da tela)
      '   CONFERIR NO SISCHEF com espaços antes',                       // a tela e o banco tiram os espaços das pontas
    ]
    for (const [i, motivo] of noMeio.entries()) {
      const id = `00000000-0000-0000-0000-00000000030${i}`
      await criar(db, 'REVISAR', { id, motivo })
      expect([motivo, await erroDe(excluir(db, ADMIN, id))]).toEqual([motivo, PAROU_NO_MEIO])
      expect((await linha(db, id)).estado).toBe('REVISAR')
    }
    const livres = [
      'fornecedor não encontrado no Sischef',
      'CONFIRMAR:2 itens',
      'não consegui ler a foto',
      'já lançado em outro envio',
      '3 itens sem produto confirmado',
      // E5 (05/11): os dois avisos de compra repetida nada tocam no SisChef, então o Ivan pode excluir ("É o mesmo: excluir este envio" e o Excluir do aviso "não consegui conferir")
      'POSSÍVEL REPETIDA: já existe compra deste fornecedor com o mesmo total (R$ 119,90): cupom de 03/10, lançado no SisChef (pedido 163377089).',
      'CONFERÊNCIA DE REPETIDA FALHOU: não consegui conferir se esta compra já foi lançada (nada foi feito no SisChef).',
    ]
    for (const [i, motivo] of livres.entries()) {
      const id = `00000000-0000-0000-0000-00000000040${i}`
      await criar(db, 'REVISAR', { id, motivo })
      await excluir(db, ADMIN, id)
      expect([motivo, (await linha(db, id)).estado]).toEqual([motivo, 'EXCLUIDO'])
    }
  })

  it('o REVISAR que o reaper deixou num PENDENTE parado ("PENDENTE nunca lançado há mais de N min") PODE ser excluído (o robô nunca o pegou); o do PROCESSANDO preso e as variações da frase NÃO', async () => {
    const db = await banco()
    const livres = [`${AVISO}: PENDENTE nunca lançado há mais de 60 min`, `  ${AVISO}: PENDENTE nunca lançado há mais de 120 min  `, `${AVISO}: PENDENTE nunca lançado há mais de 90 min\n`]
    for (const [i, motivo] of livres.entries()) {
      const id = `00000000-0000-0000-0000-00000000050${i}`
      await criar(db, 'REVISAR', { id, motivo })
      await excluir(db, ADMIN, id)
      expect([motivo, (await linha(db, id)).estado]).toEqual([motivo, 'EXCLUIDO'])
    }
    const travados = [
      `${AVISO}: PROCESSANDO preso há mais de 40 min`,                                         // o run morreu depois de reivindicar: a compra PODE existir
      `${AVISO}: PENDENTE nunca lançado há mais de 60 min; o pedido 123 foi aberto`,           // só a frase exata do reaper
      'GERAR_COMPRA_CLICADO: PENDENTE nunca lançado há mais de 60 min',
      `${AVISO}: pendente nunca lançado há mais de 60 min`,                                    // minúsculas: não é a frase do reaper
    ]
    for (const [i, motivo] of travados.entries()) {
      const id = `00000000-0000-0000-0000-00000000060${i}`
      await criar(db, 'REVISAR', { id, motivo })
      expect([motivo, await erroDe(excluir(db, ADMIN, id))]).toEqual([motivo, PAROU_NO_MEIO])
    }
  })

  it('a corrida do reaper atrasado (re-revisão de 04/11): o robô reivindicou o PENDENTE e a escrita atrasada do reaper pôs a frase "PENDENTE nunca lançado": NÃO se exclui (o robô já tocou no SisChef)', async () => {
    const db = await banco()
    await criar(db, 'PENDENTE', { id: ID })
    expect(await robôReivindica(db, ID)).toBe(true)                                    // o robô reivindicou (a reivindicação grava processando_desde)
    // ... e o reaper, com a leitura velha (PENDENTE há mais de 60 min), grava por cima, só por id (marcar_estado)
    await db.query(`update cupom set estado = 'REVISAR', motivo = $2 where id = $1`, [ID, `${AVISO}: PENDENTE nunca lançado há mais de 60 min`])
    expect((await linha(db, ID)).estado).toBe('REVISAR')
    expect(await erroDe(excluir(db, ADMIN, ID))).toBe(PAROU_NO_MEIO)
    expect((await linha(db, ID)).excluido_em).toBeNull()
    // o mesmo cupom que o robô NUNCA pegou (a frase do reaper sem a reivindicação) continua podendo ser excluído
    await criar(db, 'REVISAR', { id: ID2, motivo: `${AVISO}: PENDENTE nunca lançado há mais de 60 min` })
    await excluir(db, ADMIN, ID2)
    expect((await linha(db, ID2)).estado).toBe('EXCLUIDO')
  })

  it('o robô só pega o PENDENTE sem pedido: o PENDENTE que ele pegou não se exclui, e o cupom excluído nunca é pego', async () => {
    const db = await banco()
    await criar(db, 'PENDENTE', { id: ID })
    expect(await robôReivindica(db, ID)).toBe(true)                                    // o robô pega o que está na fila
    expect(await erroDe(excluir(db, ADMIN, ID))).toBe('o robô está lançando este cupom agora: aguarde terminar')
    await criar(db, 'REVISAR', { id: ID2, motivo: 'não consegui ler a foto' })
    await excluir(db, ADMIN, ID2)
    expect(await robôReivindica(db, ID2)).toBe(false)                                  // o excluído não é PENDENTE: o robô nunca o pega
    expect((await linha(db, ID2)).estado).toBe('EXCLUIDO')
  })

  it('as duas funções travam a linha (for update): a exclusão e a reivindicação do robô nunca passam juntas (o pglite tem uma conexão só: o teste confere o texto)', async () => {
    const db = await banco()
    for (const f of ['cupom_excluir', 'cupom_restaurar']) {
      const r = await db.query<{ s: string }>(`select prosrc as s from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [f])
      expect([f, /select \* into c from cupom where id = p_id for update/.test(r.rows[0].s)]).toEqual([f, true])
    }
  })

  it('o CHECK do estado aceita EXCLUIDO e continua recusando estado desconhecido; o estado de antes só aceita REVISAR ou TESTE', async () => {
    const db = await banco()
    await criar(db, 'REVISAR')
    await db.query(`update cupom set estado = 'EXCLUIDO' where id = $1`, [ID])
    await expect(db.query(`update cupom set estado = 'APAGADO' where id = $1`, [ID])).rejects.toThrow(/cupom_estado_check/)
    await expect(db.query(`update cupom set estado_antes_de_excluir = 'LANCADO' where id = $1`, [ID])).rejects.toThrow(/check/)
    await expect(db.query(`update cupom set estado_antes_de_excluir = 'PENDENTE' where id = $1`, [ID])).rejects.toThrow(/check/)
  })

  it('só o admin exclui e restaura (comprador é recusado) e a anon nem executa; cada mudança fica no histórico', async () => {
    const db = await banco()
    await criar(db, 'REVISAR')
    expect(await erroDe(excluir(db, JOAO))).toBe('apenas o administrador pode fazer isso')
    expect(await erroDe(restaurar(db, JOAO))).toBe('apenas o administrador pode fazer isso')
    await expect(como(db, 'anon', `select cupom_excluir($1, 'x')`, [ID])).rejects.toThrow(/permission denied/)
    await expect(como(db, 'anon', `select cupom_restaurar($1)`, [ID])).rejects.toThrow(/permission denied/)
    expect((await linha(db)).estado).toBe('REVISAR')
    await excluir(db, ADMIN, ID, 'devolvido')
    await restaurar(db, ADMIN)
    const h = await como(db, ADMIN, `select antes, depois from historico_alteracoes where tabela = 'cupom' and registro = $1 order by id`, [ID])
    expect(h.map((x) => [x.antes.estado, x.depois.estado])).toEqual([['REVISAR', 'EXCLUIDO'], ['EXCLUIDO', 'REVISAR']])
    expect(h[0].depois.motivo).toBe('devolvido')
  })
})
